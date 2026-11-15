// BENTONVILLE ROYALE — the static world: map data plus every spatial query the
// game needs (ground height, circle-vs-world collision, ray casts, "what is
// under this point"). No rendering here; see WorldMeshes.js.
//
// Everything lives in one uniform grid of CELL-metre cells. A cell holds:
//   polys   solid prisms (buildings, parked vehicles): footprint + height
//   circles solid cylinders (tree trunks, rocks, lamp posts ...)
//   dyn     player-built pieces (registered by Structures.js)
//   roads   road centre-line segments (surface lookup only, never collide)
//   areas   land-cover polygons (surface lookup only)
//   decks   bridge decks (walkable surfaces above the terrain)
//
// The ground is a heightfield (USGS 3DEP, 4 m grid; see public/data/
// bentonville-terrain.json). terrainHeight(x, z) samples it bilinearly. Prisms
// and cylinders stand on it: every collider has a base y0 (the lowest terrain
// under its footprint) and an ABSOLUTE top `h` (y0 + height). Pitched roofs
// carry roof planes (see roofPlanes()) so their walkable / hittable top follows
// the slope; `h` is then the ridge.

const CELL = 32;
const STEP = 0.62;
const WALL_HALF = 0.14;
// Pieces whose base is below this count as 'at ground level' for blockedAt / randomOpenPoint.
const PIECE_GROUND_BAND = 2.5;
// A built surface within this distance of the ground hit wins the ray (level-0 floors sit at y = 0).
const PIECE_TIE = 0.02;
// Ray-vs-terrain march step (m). The DEM is a 4 m grid, so 2 m catches every ridge that matters.
const GROUND_STEP = 2;

function pointInPoly(p, n, x, z) {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2];
    const zi = p[i * 2 + 1];
    const xj = p[j * 2];
    const zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Roof planes for a pitched roof over footprint `pts` ([[x, z], ...]): returns
 * { planes: Float32Array [A, B, C, ...], rise } where the roof height above
 * the eave at (x, z) is max(0, min_i(A_i x + B_i z + C_i)), or null when the
 * shape stays flat. Ridge direction follows the footprint's minimum-area
 * oriented bounding box. Shared by WorldMeshes (geometry) and World (collision).
 */
function roofPlanes(pts, shape, rise) {
  const n = pts.length;
  if (n < 3 || !(rise > 0.2)) return null;
  // minimum-area OBB over the edge directions
  let best = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const l = Math.hypot(ex, ez);
    if (l < 0.5) continue;
    const ux = ex / l;
    const uz = ez / l;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = p[0] * ux + p[1] * uz;
      const v = -p[0] * uz + p[1] * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  let { ux, uz, u0, u1, v0, v1 } = best;
  // u = the long axis (ridge direction)
  if (v1 - v0 > u1 - u0) {
    // new u axis = old v axis (-uz, ux); new v = -(old u)
    const tx = ux;
    ux = -uz;
    uz = tx;
    const a0 = u0;
    const a1 = u1;
    u0 = v0;
    u1 = v1;
    v0 = -a1;
    v1 = -a0;
  }
  const hl = (u1 - u0) / 2;
  const hw = (v1 - v0) / 2;
  if (hw < 1) return null;
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  // u(x,z) = x*ux + z*uz - uc ; v(x,z) = -x*uz + z*ux - vc
  const P = [];
  const plane = (ku, kv, k0) => {
    // height = ku*u + kv*v + k0
    P.push(ku * ux - kv * uz, ku * uz + kv * ux, k0 - ku * uc - kv * vc);
  };
  const s = rise / hw;
  if (shape === 'skillion') {
    plane(0, -rise / (2 * hw), rise / 2);
  } else if (shape === 'pyramid' || shape === 'dome' || shape === 'round') {
    plane(0, -s, rise);
    plane(0, s, rise);
    plane(-rise / hl, 0, rise);
    plane(rise / hl, 0, rise);
  } else if (shape === 'hip' || shape === 'mansard' || shape === 'gambrel') {
    plane(0, -s, rise);
    plane(0, s, rise);
    plane(-s, 0, s * hl);
    plane(s, 0, s * hl);
  } else {
    // gable
    plane(0, -s, rise);
    plane(0, s, rise);
  }
  return { planes: new Float32Array(P), rise, hl, hw };
}

/** Roof height above the eave at (x, z) for a plane set from roofPlanes(). */
function roofRise(planes, x, z) {
  let m = Infinity;
  for (let i = 0; i < planes.length; i += 3) {
    const v = planes[i] * x + planes[i + 1] * z + planes[i + 2];
    if (v < m) m = v;
  }
  return m > 0 ? m : 0;
}

/**
 * Fetch the terrain heightfield and NAIP tree points (browser). Every part is
 * optional: a missing file just leaves that part null (the world falls back to
 * flat ground / procedural trees).
 *   -> { terrain: { meta, heights: Float32Array } | null, trees: number[] | null, groundImage: HTMLImageElement | null }
 */
async function loadTerrainData(base = '/data/') {
  const get = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn('[world] optional map data missing:', err && err.message);
      return null;
    }
  };
  const ok = (r) => {
    if (!r.ok) throw new Error(r.status + ' ' + r.url);
    return r;
  };
  const [meta, bin, trees, groundImage] = await Promise.all([
    get(async () => ok(await fetch(base + 'bentonville-terrain.json')).json()),
    get(async () => ok(await fetch(base + 'bentonville-terrain.bin')).arrayBuffer()),
    get(async () => (await ok(await fetch(base + 'bentonville-trees.json')).json()).t),
    get(async () => {
      const img = new Image();
      img.src = base + 'bentonville-ground.webp';
      await img.decode();
      return img;
    }),
  ]);
  return { terrain: meta && bin ? { meta, heights: decodeTerrain(meta, bin) } : null, trees, groundImage };
}

/** int16 little-endian centimetres -> Float32Array metres. */
function decodeTerrain(meta, buf) {
  const dv = new DataView(buf);
  const n = meta.cols * meta.rows;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 100;
  return out;
}

export class World {
  constructor(mapData, extras = null) {
    this.data = mapData;
    const b = mapData.meta.bounds;
    this.bounds = { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    this.minX = Math.floor(b.minX / CELL) * CELL - CELL * 2;
    this.minZ = Math.floor(b.minZ / CELL) * CELL - CELL * 2;
    this.cols = Math.ceil((b.maxX - this.minX) / CELL) + 3;
    this.rows = Math.ceil((b.maxZ - this.minZ) / CELL) + 3;
    this.cells = new Array(this.cols * this.rows).fill(null);
    this.landmarks = mapData.landmarks || {};
    this.stamp = 1;
    // result of the last resolveCircle(): summed push direction (not normalised)
    this.pushX = 0;
    this.pushZ = 0;
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, collider: null, kind: 'none' };
    this.counts = { polys: 0, circles: 0 };
    this.terrain = null;
    this.terrainMin = 0;
    this.terrainMax = 0;
    this._tTop = null; // highest terrain per world cell (ray march early-out)
    if (extras && extras.terrain) this.setTerrain(extras.terrain.meta, extras.terrain.heights);
  }

  // --------------------------------------------------------------- terrain

  /** meta: bentonville-terrain.json; heights: Float32Array of metres (row-major, z rows). */
  setTerrain(meta, heights) {
    const T = {
      minX: meta.minX,
      minZ: meta.minZ,
      cell: meta.cell,
      cols: meta.cols,
      rows: meta.rows,
      maxX: meta.minX + (meta.cols - 1) * meta.cell,
      maxZ: meta.minZ + (meta.rows - 1) * meta.cell,
      h: heights,
    };
    this.terrain = T;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < heights.length; i++) {
      const v = heights[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    this.terrainMin = lo;
    this.terrainMax = hi;
    // per world cell: max terrain over the samples that can influence it
    const top = new Float32Array(this.cols * this.rows);
    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const x0 = this.minX + cx * CELL;
        const z0 = this.minZ + cz * CELL;
        const c0 = Math.max(0, Math.min(T.cols - 1, Math.floor((x0 - T.minX) / T.cell)));
        const c1 = Math.max(0, Math.min(T.cols - 1, Math.ceil((x0 + CELL - T.minX) / T.cell)));
        const r0 = Math.max(0, Math.min(T.rows - 1, Math.floor((z0 - T.minZ) / T.cell)));
        const r1 = Math.max(0, Math.min(T.rows - 1, Math.ceil((z0 + CELL - T.minZ) / T.cell)));
        let m = -Infinity;
        for (let r = r0; r <= r1; r++) {
          const row = r * T.cols;
          for (let c = c0; c <= c1; c++) if (heights[row + c] > m) m = heights[row + c];
        }
        top[cz * this.cols + cx] = m;
      }
    }
    this._tTop = top;
  }

  /** Bilinear terrain height (m) at (x, z); 0 without a heightfield. Clamped at the edges. */
  terrainHeight(x, z) {
    const T = this.terrain;
    if (!T) return 0;
    let fx = (x - T.minX) / T.cell;
    let fz = (z - T.minZ) / T.cell;
    const cm = T.cols - 1;
    const rm = T.rows - 1;
    if (fx < 0) fx = 0;
    else if (fx > cm) fx = cm;
    if (fz < 0) fz = 0;
    else if (fz > rm) fz = rm;
    let c = fx | 0;
    let r = fz | 0;
    if (c >= cm) c = cm - 1;
    if (r >= rm) r = rm - 1;
    const tx = fx - c;
    const tz = fz - r;
    const h = T.h;
    const i = r * T.cols + c;
    const a = h[i] + (h[i + 1] - h[i]) * tx;
    const b = h[i + T.cols] + (h[i + T.cols + 1] - h[i + T.cols]) * tx;
    return a + (b - a) * tz;
  }

  /** Unit terrain normal at (x, z) written to out ({x, y, z}); returns out. */
  terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 1.5;
    const gx = (this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z)) / (2 * e);
    const gz = (this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    out.x = -gx / l;
    out.y = 1 / l;
    out.z = -gz / l;
    return out;
  }

  /** Lowest terrain under a footprint (vertices plus interior samples on the DEM spacing). */
  terrainMinUnder(p, n, minX, minZ, maxX, maxZ) {
    if (!this.terrain) return 0;
    let m = Infinity;
    for (let i = 0; i < n; i++) {
      const y = this.terrainHeight(p[i * 2], p[i * 2 + 1]);
      if (y < m) m = y;
    }
    const s = this.terrain.cell;
    for (let z = Math.ceil(minZ / s) * s; z < maxZ; z += s) {
      for (let x = Math.ceil(minX / s) * s; x < maxX; x += s) {
        if (!pointInPoly(p, n, x, z)) continue;
        const y = this.terrainHeight(x, z);
        if (y < m) m = y;
      }
    }
    return m === Infinity ? this.terrainHeight((minX + maxX) / 2, (minZ + maxZ) / 2) : m;
  }

  /** Walkable / hittable top of prism c at (x, z) (pitched roofs follow their planes). */
  topAt(c, x, z) {
    return c.planes ? c.eave + roofRise(c.planes, x, z) : c.h;
  }

  // ------------------------------------------------------------------ grid

  _cell(cx, cz, create) {
    if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) return null;
    const i = cz * this.cols + cx;
    let c = this.cells[i];
    if (!c && create) {
      c = { polys: [], circles: [], dyn: [], roads: [], areas: [], decks: [] };
      this.cells[i] = c;
    }
    return c;
  }

  _each(minX, minZ, maxX, maxZ, create, fn) {
    const x0 = Math.floor((minX - this.minX) / CELL);
    const x1 = Math.floor((maxX - this.minX) / CELL);
    const z0 = Math.floor((minZ - this.minZ) / CELL);
    const z1 = Math.floor((maxZ - this.minZ) / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = this._cell(cx, cz, create);
        if (c) fn(c);
      }
    }
  }

  cellAt(x, z) {
    return this._cell(Math.floor((x - this.minX) / CELL), Math.floor((z - this.minZ) / CELL), false);
  }

  inBounds(x, z, margin = 0) {
    const b = this.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  // ------------------------------------------------------------ registering

  /**
   * pts: [[x,z],...] or flat array; h: height above the base. Returns the collider
   * (c.y0 = base, c.h = absolute top). opts: { y0, roof: roofPlanes() result,
   * eaveH: wall height under a pitched roof }.
   */
  addPoly(pts, h, kind, mat, ref, opts = null) {
    const flat = typeof pts[0] === 'number';
    const n = flat ? pts.length / 2 : pts.length;
    const p = new Float32Array(n * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = flat ? pts[i * 2] : pts[i][0];
      const z = flat ? pts[i * 2 + 1] : pts[i][1];
      p[i * 2] = x;
      p[i * 2 + 1] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const y0 = opts && opts.y0 != null ? opts.y0 : this.terrainMinUnder(p, n, minX, minZ, maxX, maxZ);
    const c = { type: 'poly', kind, p, n, h: y0 + h, y0, hgt: h, minX, maxX, minZ, maxZ, mat, ref, stamp: 0, alive: true, hp: Infinity, maxHp: Infinity };
    if (opts && opts.roof) {
      c.planes = opts.roof.planes;
      c.eave = y0 + opts.eaveH;
      c.h = c.eave + opts.roof.rise;
    }
    this._each(minX, minZ, maxX, maxZ, true, (cell) => cell.polys.push(c));
    this.counts.polys++;
    return c;
  }

  /** h: height above the terrain at (x, z). The collider stores y0 (base) and h (absolute top). */
  addCircle(x, z, r, h, kind, mat, hp, ref) {
    const y0 = this.terrainHeight(x, z);
    const c = { type: 'circle', kind, x, z, r, h: y0 + h, y0, hgt: h, mat, hp, maxHp: hp, ref, stamp: 0, alive: true };
    this._each(x - r, z - r, x + r, z + r, true, (cell) => cell.circles.push(c));
    this.counts.circles++;
    return c;
  }

  remove(c) {
    if (!c || !c.alive) return;
    c.alive = false;
    if (c.type === 'poly') {
      this._each(c.minX, c.minZ, c.maxX, c.maxZ, false, (cell) => {
        const i = cell.polys.indexOf(c);
        if (i >= 0) cell.polys.splice(i, 1);
      });
    } else if (c.type === 'circle') {
      this._each(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, false, (cell) => {
        const i = cell.circles.indexOf(c);
        if (i >= 0) cell.circles.splice(i, 1);
      });
    } else if (c.type === 'piece') {
      this._each(c.minX, c.minZ, c.maxX, c.maxZ, false, (cell) => {
        const i = cell.dyn.indexOf(c);
        if (i >= 0) cell.dyn.splice(i, 1);
      });
    }
  }

  /** Put a removed prism / cylinder back at full health (match restart). */
  restore(c) {
    if (!c || c.alive || c.type === 'piece') return;
    c.alive = true;
    c.hp = c.maxHp;
    if (c.type === 'poly') this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.polys.push(c));
    else this._each(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, true, (cell) => cell.circles.push(c));
  }

  /** Player-built piece (see Structures.js for the shape of `piece`). */
  addPiece(piece) {
    piece.type = 'piece';
    piece.alive = true;
    piece.stamp = 0;
    this._each(piece.minX, piece.minZ, piece.maxX, piece.maxZ, true, (cell) => cell.dyn.push(piece));
  }

  addRoadSegment(ax, az, bx, bz, w, k) {
    const s = { ax, az, bx, bz, hw: w / 2, k };
    const m = w / 2 + 1;
    this._each(Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m, true, (cell) => cell.roads.push(s));
  }

  /**
   * Bridge deck segment: walkable surface from (ax, ay, az) to (bx, by, bz),
   * half-width hw. groundHeight() stands on it; it does not block or stop rays.
   */
  addDeck(ax, ay, az, bx, by, bz, hw) {
    const d = { ax, ay, az, bx, by, bz, hw };
    this._each(Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw, true, (cell) => cell.decks.push(d));
    return d;
  }

  _deckY(d, x, z) {
    const ex = d.bx - d.ax;
    const ez = d.bz - d.az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - d.ax) * ex + (z - d.az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = d.ax + ex * t - x;
    const qz = d.az + ez * t - z;
    if (qx * qx + qz * qz > d.hw * d.hw) return -Infinity;
    return d.ay + (d.by - d.ay) * t;
  }

  addArea(pts, k) {
    const n = pts.length;
    const p = new Float32Array(n * 2);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = pts[i][0];
      const z = pts[i][1];
      p[i * 2] = x;
      p[i * 2 + 1] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const a = { k, p, n, minX, maxX, minZ, maxZ };
    this._each(minX, minZ, maxX, maxZ, true, (cell) => cell.areas.push(a));
    return a;
  }

  // ---------------------------------------------------------------- lookups

  /** Distance-checked "is this point on a road". Returns the road class or null. */
  roadAt(x, z, extra = 0) {
    const cell = this.cellAt(x, z);
    if (!cell) return null;
    const roads = cell.roads;
    for (let i = 0; i < roads.length; i++) {
      const s = roads[i];
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + dx * t - x;
      const pz = s.az + dz * t - z;
      const lim = s.hw + extra;
      if (px * px + pz * pz <= lim * lim) return s.k;
    }
    return null;
  }

  /** Land-cover kind at a point ('water', 'wood', 'park', 'parking', ...) or null. */
  areaAt(x, z) {
    const cell = this.cellAt(x, z);
    if (!cell) return null;
    const areas = cell.areas;
    let found = null;
    for (let i = 0; i < areas.length; i++) {
      const a = areas[i];
      if (x < a.minX || x > a.maxX || z < a.minZ || z > a.maxZ) continue;
      if (pointInPoly(a.p, a.n, x, z)) {
        if (a.k === 'water') return 'water';
        found = a.k;
      }
    }
    return found;
  }

  /** The solid prism (building / vehicle) whose footprint contains the point, or null. */
  polyAt(x, z) {
    const cell = this.cellAt(x, z);
    if (!cell) return null;
    const polys = cell.polys;
    let best = null;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (pointInPoly(c.p, c.n, x, z) && (!best || c.h > best.h)) best = c;
    }
    return best;
  }

  /** True when a circle of radius r at ground level would overlap something solid. */
  blockedAt(x, z, r) {
    let hit = false;
    const band = this.terrainHeight(x, z) + PIECE_GROUND_BAND;
    this._each(x - r, z - r, x + r, z + r, false, (cell) => {
      if (hit) return;
      const polys = cell.polys;
      for (let i = 0; i < polys.length && !hit; i++) {
        const c = polys[i];
        if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
        if (pointInPoly(c.p, c.n, x, z) || this._polyDist2(c, x, z) < r * r) hit = true;
      }
      const circles = cell.circles;
      for (let i = 0; i < circles.length && !hit; i++) {
        const c = circles[i];
        const dx = x - c.x;
        const dz = z - c.z;
        const lim = r + c.r;
        if (dx * dx + dz * dz < lim * lim) hit = true;
      }
      // player-built pieces that reach the ground band (spawning inside a build)
      const dyn = cell.dyn;
      for (let i = 0; i < dyn.length && !hit; i++) {
        if (this._pieceOverlaps(dyn[i], x, z, r, band)) hit = true;
      }
    });
    return hit;
  }

  /** Does a circle (x, z, r) overlap piece `c` in plan, for a piece whose base is below `belowY`? */
  _pieceOverlaps(c, x, z, r, belowY) {
    if (!c.alive || c.y0 >= belowY) return false;
    if (c.seg) {
      const s = c.seg;
      const ex = s[2] - s[0];
      const ez = s[3] - s[1];
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - s[0]) * ex + (z - s[1]) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = x - (s[0] + ex * t);
      const qz = z - (s[1] + ez * t);
      const lim = r + WALL_HALF;
      return qx * qx + qz * qz < lim * lim;
    }
    return x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r;
  }

  _polyDist2(c, x, z) {
    const p = c.p;
    const n = c.n;
    let best = Infinity;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = p[j * 2];
      const az = p[j * 2 + 1];
      const dx = p[i * 2] - ax;
      const dz = p[i * 2 + 1] - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - x;
      const qz = az + dz * t - z;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        this._cx = ax + dx * t;
        this._cz = az + dz * t;
        this._ex = dx;
        this._ez = dz;
      }
    }
    return best;
  }

  /**
   * Highest walkable surface at (x, z) that is no higher than feetY + step.
   * Sets this.surface to 'ground' | 'roof' | 'vehicle' | 'build'.
   */
  groundHeight(x, z, feetY, step = STEP) {
    let y = this.terrainHeight(x, z);
    this.surface = 'ground';
    const cell = this.cellAt(x, z);
    if (!cell) return y;
    const lim = feetY + step;
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      if (c.h <= y || (!c.planes && c.h > lim)) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (pointInPoly(c.p, c.n, x, z)) {
        const top = c.planes ? c.eave + roofRise(c.planes, x, z) : c.h;
        if (top <= y || top > lim) continue;
        y = top;
        this.surface = c.kind === 'vehicle' ? 'vehicle' : 'roof';
      }
    }
    const decks = cell.decks;
    for (let i = 0; i < decks.length; i++) {
      const sy = this._deckY(decks[i], x, z);
      if (sy > y && sy <= lim) {
        y = sy;
        this.surface = 'ground';
      }
    }
    const dyn = cell.dyn;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i];
      if (!d.surf || x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      const sy = d.surf(x, z);
      if (sy > y && sy <= lim) {
        y = sy;
        this.surface = 'build';
      }
    }
    return y;
  }

  /** Lowest built surface above the feet (for head bumps and "something cuts through my body"). */
  ceilingAbove(x, z, feetY, step = STEP) {
    let y = Infinity;
    const cell = this.cellAt(x, z);
    if (!cell) return y;
    const dyn = cell.dyn;
    const lim = feetY + step;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i];
      if (!d.surf || x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      const sy = d.surf(x, z);
      if (sy > lim && sy < y) y = sy;
    }
    return y;
  }

  /**
   * Push a vertical cylinder (feet at pos.y) out of everything solid.
   * Mutates pos.x / pos.z. Returns true when anything was touched and leaves
   * the summed push direction in this.pushX / this.pushZ.
   */
  resolveCircle(pos, r, height, step = STEP) {
    let touched = false;
    this.pushX = 0;
    this.pushZ = 0;
    const feet = pos.y;
    const head = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const stamp = ++this.stamp;
      const x0 = Math.floor((pos.x - r - this.minX) / CELL);
      const x1 = Math.floor((pos.x + r - this.minX) / CELL);
      const z0 = Math.floor((pos.z - r - this.minZ) / CELL);
      const z1 = Math.floor((pos.z + r - this.minZ) / CELL);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this._cell(cx, cz, false);
          if (!cell) continue;

          const polys = cell.polys;
          for (let i = 0; i < polys.length; i++) {
            const c = polys[i];
            if (c.stamp === stamp) continue;
            c.stamp = stamp;
            if (feet >= (c.planes ? c.eave + roofRise(c.planes, pos.x, pos.z) : c.h) - step) continue; // on top of it / can step onto it
            const x = pos.x;
            const z = pos.z;
            if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
            const d2 = this._polyDist2(c, x, z);
            const inside = pointInPoly(c.p, c.n, x, z);
            if (!inside && d2 >= r * r) continue;
            const d = Math.sqrt(d2);
            let nx;
            let nz;
            if (d > 1e-5) {
              nx = (x - this._cx) / d;
              nz = (z - this._cz) / d;
              if (inside) {
                nx = -nx;
                nz = -nz;
              }
            } else {
              const l = Math.hypot(this._ex, this._ez) || 1;
              nx = this._ez / l;
              nz = -this._ex / l;
            }
            const push = inside ? d + r : r - d;
            pos.x += nx * push;
            pos.z += nz * push;
            this.pushX += nx;
            this.pushZ += nz;
            moved = touched = true;
          }

          const circles = cell.circles;
          for (let i = 0; i < circles.length; i++) {
            const c = circles[i];
            if (c.stamp === stamp) continue;
            c.stamp = stamp;
            if (feet >= c.h - 0.05 || head <= c.y0) continue;
            const dx = pos.x - c.x;
            const dz = pos.z - c.z;
            const lim = r + c.r;
            const d2 = dx * dx + dz * dz;
            if (d2 >= lim * lim) continue;
            const d = Math.sqrt(d2);
            const nx = d > 1e-5 ? dx / d : 1;
            const nz = d > 1e-5 ? dz / d : 0;
            pos.x += nx * (lim - d);
            pos.z += nz * (lim - d);
            this.pushX += nx;
            this.pushZ += nz;
            moved = touched = true;
          }

          const dyn = cell.dyn;
          for (let i = 0; i < dyn.length; i++) {
            const c = dyn[i];
            if (c.stamp === stamp) continue;
            if (!c.seg) {
              // ramps and cones are solid wedges from their base up to their surface:
              // walkable where the surface at the nearest point is within step height,
              // blocking from the high sides / back unless the feet are above them.
              if (!c.wedge) continue;
              c.stamp = stamp;
              if (feet >= c.y1 - step || head <= c.y0 + 0.05) continue;
              const x = pos.x;
              const z = pos.z;
              if (x <= c.minX - r || x >= c.maxX + r || z <= c.minZ - r || z >= c.maxZ + r) continue;
              const qx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
              const qz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
              const sy = c.surf(qx, qz);
              if (feet >= sy - step) continue;
              const ddx = x - qx;
              const ddz = z - qz;
              const d2 = ddx * ddx + ddz * ddz;
              let nx;
              let nz;
              let push;
              if (d2 > 1e-10) {
                if (d2 >= r * r) continue;
                const d = Math.sqrt(d2);
                nx = ddx / d;
                nz = ddz / d;
                push = r - d;
              } else {
                // centre is inside the footprint below the surface: leave by the nearest side
                const l = x - c.minX;
                const rr = c.maxX - x;
                const t = z - c.minZ;
                const b = c.maxZ - z;
                const m = Math.min(l, rr, t, b);
                nx = m === l ? -1 : m === rr ? 1 : 0;
                nz = nx !== 0 ? 0 : m === t ? -1 : 1;
                push = m + r;
              }
              pos.x += nx * push;
              pos.z += nz * push;
              this.pushX += nx;
              this.pushZ += nz;
              moved = touched = true;
              continue;
            }
            c.stamp = stamp;
            if (feet >= c.y1 - 0.05 || head <= c.y0 + 0.05) continue;
            const s = c.seg;
            const ex = s[2] - s[0];
            const ez = s[3] - s[1];
            const l2 = ex * ex + ez * ez;
            let t = l2 > 0 ? ((pos.x - s[0]) * ex + (pos.z - s[1]) * ez) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = pos.x - (s[0] + ex * t);
            const dz = pos.z - (s[1] + ez * t);
            const lim = r + WALL_HALF;
            const d2 = dx * dx + dz * dz;
            if (d2 >= lim * lim) continue;
            const d = Math.sqrt(d2);
            let nx;
            let nz;
            if (d > 1e-5) {
              nx = dx / d;
              nz = dz / d;
            } else {
              const l = Math.sqrt(l2) || 1;
              nx = ez / l;
              nz = -ex / l;
            }
            pos.x += nx * (lim - d);
            pos.z += nz * (lim - d);
            this.pushX += nx;
            this.pushZ += nz;
            moved = touched = true;
          }
        }
      }
      if (!moved) break;
    }
    return touched;
  }

  // ---------------------------------------------------------------- raycast

  /**
   * Nearest hit of a ray against ground, prisms, cylinders and built pieces.
   * Returns a shared result object ({t,x,y,z,nx,ny,nz,collider,kind}) or null.
   * `kind` is 'ground' or the collider's kind. Copy what you need before the
   * next call.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, ignore) {
    const out = this._hit;
    let best = maxT;
    let found = false;
    out.collider = null;
    const T = this.terrain;
    // Terrain: marched cell by cell below. Exactly level rays (dy === 0: bot steering
    // feelers) skip it, because every slope is walkable. A ray that starts under the
    // terrain only hits it after it has come back above (like the old y = 0 plane).
    let groundT = -1;
    let gT = -1; // last marched t
    let gD = NaN; // ray height above the terrain at gT
    const marchGround = T ? dy !== 0 : false;
    if (!T && dy < -1e-6) {
      const t = -oy / dy;
      if (t > 0 && t < best) {
        best = t;
        found = true;
        out.nx = 0;
        out.ny = 1;
        out.nz = 0;
        out.kind = 'ground';
        groundT = best;
      }
    }

    const stamp = ++this.stamp;
    let cx = Math.floor((ox - this.minX) / CELL);
    let cz = Math.floor((oz - this.minZ) / CELL);
    const flat = Math.abs(dx) < 1e-7 && Math.abs(dz) < 1e-7;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-9 ? ((cx + (dx > 0 ? 1 : 0)) * CELL + this.minX - ox) / dx : Infinity;
    let tMaxZ = Math.abs(dz) > 1e-9 ? ((cz + (dz > 0 ? 1 : 0)) * CELL + this.minZ - oz) / dz : Infinity;
    let tEnter = 0;

    for (let guard = 0; guard < 512; guard++) {
      // ---- terrain within this cell's stretch of the ray
      if (marchGround && groundT < 0 && flat) {
        const h = this.terrainHeight(ox, oz);
        if (dy < 0 && oy > h) {
          const th = (oy - h) / -dy;
          if (th > 1e-4 && th < best) {
            best = th;
            found = true;
            this.terrainNormal(ox, oz, out);
            out.nx = out.x;
            out.ny = out.y;
            out.nz = out.z;
            out.kind = 'ground';
            groundT = best;
          }
        }
      } else if (marchGround && groundT < 0) {
        const tExit = Math.min(tMaxX, tMaxZ, best);
        if (tExit > tEnter) {
          const inGrid = cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows;
          const top = inGrid ? this._tTop[cz * this.cols + cx] : this.terrainMax;
          const yA = oy + dy * tEnter;
          const yB = oy + dy * tExit;
          if ((yA < yB ? yA : yB) > top + 0.01) {
            gT = tExit;
            gD = 1;
          } else {
            let t = tEnter;
            for (;;) {
              const d = oy + dy * t - this.terrainHeight(ox + dx * t, oz + dz * t);
              if (gD > 0 && d <= 0) {
                // crossed between gT (above) and t (below): bisect, then interpolate
                let a = gT;
                let da = gD;
                let b = t;
                let db = d;
                for (let k = 0; k < 4; k++) {
                  const m = (a + b) * 0.5;
                  const dm = oy + dy * m - this.terrainHeight(ox + dx * m, oz + dz * m);
                  if (dm > 0) {
                    a = m;
                    da = dm;
                  } else {
                    b = m;
                    db = dm;
                  }
                }
                const th = a + ((b - a) * da) / (da - db || 1e-9);
                if (th > 1e-4 && th < best) {
                  best = th;
                  found = true;
                  const nn = this.terrainNormal(ox + dx * th, oz + dz * th, out);
                  out.nx = nn.x;
                  out.ny = nn.y;
                  out.nz = nn.z;
                  out.collider = null;
                  out.kind = 'ground';
                  groundT = best;
                }
                break;
              }
              gT = t;
              gD = d;
              if (t >= tExit) break;
              t = t + GROUND_STEP < tExit ? t + GROUND_STEP : tExit;
            }
          }
        }
      }

      const cell = this._cell(cx, cz, false);
      if (cell) {
        // ---- prisms
        const polys = cell.polys;
        for (let i = 0; i < polys.length; i++) {
          const c = polys[i];
          if (c.stamp === stamp || c === ignore) continue;
          c.stamp = stamp;
          const p = c.p;
          const n = c.n;
          const planes = c.planes;
          for (let a = 0, b = n - 1; a < n; b = a++) {
            const ax = p[b * 2];
            const az = p[b * 2 + 1];
            const ex = p[a * 2] - ax;
            const ez = p[a * 2 + 1] - az;
            const den = dx * ez - dz * ex;
            if (den > -1e-9 && den < 1e-9) continue;
            const wx = ax - ox;
            const wz = az - oz;
            const t = (wx * ez - wz * ex) / den;
            if (t <= 1e-4 || t >= best) continue;
            const u = (wx * dz - wz * dx) / den;
            if (u < 0 || u > 1) continue;
            const y = oy + dy * t;
            if (y < c.y0 || y > (planes ? c.eave + roofRise(planes, ox + dx * t, oz + dz * t) : c.h)) continue;
            best = t;
            found = true;
            const l = Math.hypot(ex, ez) || 1;
            let nx = ez / l;
            let nz = -ex / l;
            if (nx * dx + nz * dz > 0) {
              nx = -nx;
              nz = -nz;
            }
            out.nx = nx;
            out.ny = 0;
            out.nz = nz;
            out.collider = c;
            out.kind = c.kind;
          }
          if (planes) {
            // pitched roof: each plane where it is the lowest one (the visible roof face)
            for (let k = 0; k < planes.length; k += 3) {
              const A = planes[k];
              const B = planes[k + 1];
              const C = planes[k + 2];
              const den = dy - A * dx - B * dz;
              if (den > -1e-9 && den < 1e-9) continue;
              const t = (c.eave + A * ox + B * oz + C - oy) / den;
              if (t <= 1e-4 || t >= best) continue;
              const x = ox + dx * t;
              const z = oz + dz * t;
              if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ || !pointInPoly(p, n, x, z)) continue;
              if (roofRise(planes, x, z) < A * x + B * z + C - 1e-3) continue;
              best = t;
              found = true;
              const l = Math.hypot(A, 1, B);
              const s = den < 0 ? 1 : -1; // face the ray
              out.nx = (-A / l) * s;
              out.ny = (1 / l) * s;
              out.nz = (-B / l) * s;
              out.collider = c;
              out.kind = c.kind;
            }
          } else if (dy !== 0) {
            const t = (c.h - oy) / dy;
            if (t > 1e-4 && t < best) {
              const x = ox + dx * t;
              const z = oz + dz * t;
              if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ && pointInPoly(p, n, x, z)) {
                best = t;
                found = true;
                out.nx = 0;
                out.ny = dy < 0 ? 1 : -1;
                out.nz = 0;
                out.collider = c;
                out.kind = c.kind;
              }
            }
          }
        }

        // ---- cylinders
        if (!flat) {
          const circles = cell.circles;
          const a2 = dx * dx + dz * dz;
          for (let i = 0; i < circles.length; i++) {
            const c = circles[i];
            if (c.stamp === stamp || c === ignore) continue;
            c.stamp = stamp;
            const fx = ox - c.x;
            const fz = oz - c.z;
            const hb = fx * dx + fz * dz;
            const cc = fx * fx + fz * fz - c.r * c.r;
            const disc = hb * hb - a2 * cc;
            if (disc < 0) continue;
            const t = (-hb - Math.sqrt(disc)) / a2;
            if (t <= 1e-4 || t >= best) continue;
            const y = oy + dy * t;
            if (y < c.y0 - 0.4 || y > c.h) continue;
            best = t;
            found = true;
            out.nx = (ox + dx * t - c.x) / c.r;
            out.ny = 0;
            out.nz = (oz + dz * t - c.z) / c.r;
            out.collider = c;
            out.kind = c.kind;
          }
        }

        // ---- built pieces (triangles, double sided)
        const dyn = cell.dyn;
        for (let i = 0; i < dyn.length; i++) {
          const c = dyn[i];
          if (c.stamp === stamp || c === ignore) continue;
          c.stamp = stamp;
          const tr = c.tris;
          for (let k = 0; k < tr.length; k += 9) {
            const e1x = tr[k + 3] - tr[k];
            const e1y = tr[k + 4] - tr[k + 1];
            const e1z = tr[k + 5] - tr[k + 2];
            const e2x = tr[k + 6] - tr[k];
            const e2y = tr[k + 7] - tr[k + 1];
            const e2z = tr[k + 8] - tr[k + 2];
            const px = dy * e2z - dz * e2y;
            const py = dz * e2x - dx * e2z;
            const pz = dx * e2y - dy * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (det > -1e-9 && det < 1e-9) continue;
            const inv = 1 / det;
            const tx = ox - tr[k];
            const ty = oy - tr[k + 1];
            const tz = oz - tr[k + 2];
            const u = (tx * px + ty * py + tz * pz) * inv;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (dx * qx + dy * qy + dz * qz) * inv;
            if (v < 0 || u + v > 1) continue;
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
            // a piece lying on the ground (level-0 floor) beats the ground plane it is coplanar with
            const lim = best === groundT ? best - PIECE_TIE / dy : best;
            if (t <= 1e-4 || t >= lim) continue;
            best = t;
            found = true;
            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l;
            ny /= l;
            nz /= l;
            if (nx * dx + ny * dy + nz * dz > 0) {
              nx = -nx;
              ny = -ny;
              nz = -nz;
            }
            out.nx = nx;
            out.ny = ny;
            out.nz = nz;
            out.collider = c;
            out.kind = 'piece';
          }
        }
      }
      if (flat) break;
      // advance to the next cell unless the best hit is already closer than it
      if (tMaxX < tMaxZ) {
        if (tMaxX > best) break;
        tEnter = tMaxX;
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        if (tMaxZ > best) break;
        tEnter = tMaxZ;
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) {
        // outside the collision grid only the terrain remains
        if (marchGround && groundT < 0 && best > tEnter) {
          let t = tEnter;
          for (let g = 0; g < 4000 && t < best; g++) {
            const d = oy + dy * t - this.terrainHeight(ox + dx * t, oz + dz * t);
            if (gD > 0 && d <= 0) {
              const th = gT + ((t - gT) * gD) / (gD - d || 1e-9);
              if (th > 1e-4 && th < best) {
                best = th;
                found = true;
                this.terrainNormal(ox + dx * th, oz + dz * th, out);
                out.nx = out.x;
                out.ny = out.y;
                out.nz = out.z;
                out.collider = null;
                out.kind = 'ground';
              }
              break;
            }
            gT = t;
            gD = d;
            if (oy + dy * t > this.terrainMax + 1 && dy >= 0) break;
            t += GROUND_STEP * 4;
          }
        }
        break;
      }
    }

    if (!found) return null;
    out.t = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    return out;
  }

  /** True when nothing solid lies on the straight segment between two points. */
  clearLine(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05);
    return !hit;
  }

  /**
   * Nearest harvestable cylinder (tree, rock, prop) close to a short ray —
   * a forgiving target test for the pickaxe. Returns the collider or null.
   */
  probeCircle(ox, oz, dx, dz, range, slack) {
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    let best = null;
    let bestScore = Infinity;
    this._each(ox - range - 2, oz - range - 2, ox + range + 2, oz + range + 2, false, (cell) => {
      const circles = cell.circles;
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i];
        const fx = c.x - ox;
        const fz = c.z - oz;
        const along = fx * ux + fz * uz;
        if (along < -0.3 || along > range + c.r) continue;
        const side = Math.abs(fx * uz - fz * ux);
        if (side > c.r + slack) continue;
        const score = along + side * 2;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    });
    return best;
  }

  /**
   * A random standable ground point within `radius` of (cx, cz): inside the
   * map, not in a building, tree or water. Falls back to the centre.
   */
  randomOpenPoint(rng, cx, cz, radius, clearance = 0.8, out = { x: 0, z: 0 }) {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (!this.inBounds(x, z, 20)) continue;
      if (this.blockedAt(x, z, clearance)) continue;
      if (this.areaAt(x, z) === 'water') continue;
      out.x = x;
      out.z = z;
      return out;
    }
    out.x = cx;
    out.z = cz;
    return out;
  }
}

export { pointInPoly, roofPlanes, roofRise, loadTerrainData, decodeTerrain, CELL as WORLD_CELL };
