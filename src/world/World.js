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
//   boxes   oriented boxes with a base and a top (static architecture that can float:
//           slabs, walls, glass, roofs; see boxColliders.js and addBox())
//
// The ground is a heightfield (USGS 3DEP, 4 m grid; see public/data/
// bentonville-terrain.json). terrainHeight(x, z) samples it bilinearly. Prisms
// and cylinders stand on it: every collider has a base y0 (the lowest terrain
// under its footprint) and an ABSOLUTE top `h` (y0 + height). Pitched roofs
// carry roof planes (see roofPlanes()) so their walkable / hittable top follows
// the slope; `h` is then the ridge.
//
// Enterable buildings: most OSM buildings are hollow shells (collider.shell,
// planned by finishBuildings() / _planShell()). The footprint prism is kept for
// footprint lookups (polyAt), the roof (standable, hit by rays from above) and
// anything above the interior ceiling; below the ceiling only thin outer walls
// collide, door openings let actors and rays through, and the interior floor is
// the building base. Tall buildings are hollow on the ground storey only (the
// floors above stay a solid block). Loot / spawn helpers: buildingInteriors(),
// randomInteriorPoint(), interiorAt(), blockedAt(x, z, r, true).

import { planInterior } from './Interiors.js';
import { inHole, stairHeight, FLOOR_THICKNESS } from './interiors/storeys.js';
import { tileIdAt } from './interiors/floorTiles.js';
import { toLocal as planLocal } from './interiors/layout.js';
import { makeBox, boxContains, boxPushCircle, boxRay } from './boxColliders.js';
import { foundationBand, footprintDistance, foundationHeight } from './foundations.js';
import { applyBhsOverrides } from './bhs/data.js';

const CELL = 32;
const STEP = 0.62;
// A wedge piece (ramp / cone) appearing around an actor lifts it at most this far.
const WEDGE_LIFT = 3.2;
// Ramps are thin planks (piece.slab): this thick under their walkable surface.
const SLAB = 0.3;
// A slab piece younger than this (s) still lifts an actor it was built around onto it.
const SLAB_LIFT_AGE = 0.6;
// a built floor tile's thickness (Structures FLOOR_THICK): its underside is the ceiling below it
const FLOOR_THICK = 0.22;
const WALL_HALF = 0.14;
// Pieces whose base is below this count as 'at ground level' for blockedAt / randomOpenPoint.
const PIECE_GROUND_BAND = 2.5;
// A built surface within this distance of the ground hit wins the ray (a floor on the ground level can sit flush with the terrain).
const PIECE_TIE = 0.02;
// Ray-vs-terrain march step (m). The DEM is a 4 m grid, so 2 m catches every ridge that matters.
const GROUND_STEP = 2;

// ---- enterable buildings (hollow shells), see addBuilding() / finishBuildings()
// Outer wall thickness (m). Collision walls are capsules of radius SHELL_T / 2
// running along the footprint offset inward by SHELL_T / 2.
const SHELL_T = 0.4;
// Door opening: clear width (m) along the wall and height (m) above the floor.
// PLAYER.radius is 0.42, so 1.8 m leaves ~0.5 m of slack on each side.
const DOOR_W = 1.8;
const DOOR_H = 2.4;
// Keep a door at least this far (m) from the wall's corners.
const DOOR_MARGIN = 1.0;
// Roof slab thickness (m): the interior ceiling of a single-storey shell sits this far below the roof.
const ROOF_T = 0.35;
// Buildings taller than this are hollow on the ground storey only: the floors above are a
// solid block (no unreachable 20 m void). The ground storey height is h / levels, clamped.
const SINGLE_SPACE_MAX = 7;
const STOREY_MIN = 3.2;
const STOREY_MAX = 4.5;
// Footprint filters for hollowing (m^2 / m): tiny sheds stay solid prisms.
const HOLLOW_MIN_AREA = 30;
const HOLLOW_MIN_A_OVER_P = 0.65; // area / perimeter; ~ half the narrow width for a rectangle
const HOLLOW_MAX_VERTS = 350;

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
  const terrain = meta && bin ? await get(async () => ({ meta, heights: decodeTerrain(meta, bin) })) : null;
  return { terrain, trees, groundImage };
}

/** int16 little-endian centimetres -> Float32Array metres. */
/** Bilinear sample of a heightfield grid { minX, minZ, cell, cols, rows, h }, clamped at the edges. */
function sampleGrid(T, x, z) {
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

function decodeTerrain(meta, buf) {
  const n = meta.cols * meta.rows;
  if (!Number.isSafeInteger(n) || n < 4 || n > 16000000 || buf.byteLength !== n * 2) throw new Error('Invalid terrain payload');
  const dv = new DataView(buf);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 100;
  return out;
}

export class World {
  constructor(mapData, extras = null) {
    applyBhsOverrides(mapData); // Bentonville High floors + stadium site (src/world/bhs/data.js)
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
    this._hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, collider: null, kind: 'none', edge: -1, u: 0, panel: null };
    this._pnx = 0; // normal of the last _rayProps() hit
    this._pny = 0;
    this._pnz = 0;
    this.interiorHash = null; // set by finishBuildings(): FNV-1a over every interior plan
    this.onPanelChange = null; // (collider, panel, alive) after breakPanel / restorePanel
    this.counts = { polys: 0, circles: 0 };
    this.terrain = null;
    this.terrainOverlay = null; // a landmark's local heightfield over the map terrain (setTerrainOverlay)
    this.terrainMin = 0;
    this.terrainMax = 0;
    this._tTop = null; // highest terrain per world cell (ray march early-out)
    if (extras && extras.terrain) this.setTerrain(extras.terrain.meta, extras.terrain.heights);
  }

  // --------------------------------------------------------------- terrain

  /** meta: bentonville-terrain.json; heights: Float32Array of metres (row-major, z rows). */
  setTerrain(meta, heights) {
    if (!meta || !Number.isFinite(meta.minX) || !Number.isFinite(meta.minZ) || !Number.isFinite(meta.cell) || meta.cell <= 0 ||
        !Number.isSafeInteger(meta.cols) || !Number.isSafeInteger(meta.rows) || meta.cols < 2 || meta.rows < 2 ||
        meta.cols * meta.rows > 16000000 || !(heights instanceof Float32Array) || heights.length !== meta.cols * meta.rows ||
        heights.some((v) => !Number.isFinite(v))) throw new Error('Invalid terrain grid');
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

  /**
   * A detailed local heightfield laid over the map terrain: a bespoke landmark (the Crystal
   * Bridges ravine) built around street level `edge` (0). Inside its rectangle the overlay IS
   * the terrain; within `blend` m outside it the map terrain eases to `edge`, so the landmark
   * sits in the hills without moving every collider it registers. Without map terrain this is
   * plain setTerrain.
   */
  setTerrainOverlay(meta, heights, { blend = 60, edge = 0 } = {}) {
    if (!this.terrain) return this.setTerrain(meta, heights);
    if (!meta || !Number.isFinite(meta.minX) || !Number.isFinite(meta.minZ) || !Number.isFinite(meta.cell) || meta.cell <= 0 ||
        !Number.isSafeInteger(meta.cols) || !Number.isSafeInteger(meta.rows) || meta.cols < 2 || meta.rows < 2 ||
        meta.cols * meta.rows > 16000000 || !(heights instanceof Float32Array) || heights.length !== meta.cols * meta.rows ||
        heights.some((v) => !Number.isFinite(v)) || !Number.isFinite(blend) || !Number.isFinite(edge)) throw new Error('Invalid terrain overlay');
    const O = {
      minX: meta.minX,
      minZ: meta.minZ,
      cell: meta.cell,
      cols: meta.cols,
      rows: meta.rows,
      maxX: meta.minX + (meta.cols - 1) * meta.cell,
      maxZ: meta.minZ + (meta.rows - 1) * meta.cell,
      h: heights,
      blend: Math.max(1, blend),
      edge,
    };
    this.terrainOverlay = O;
    for (let i = 0; i < heights.length; i++) {
      if (heights[i] < this.terrainMin) this.terrainMin = heights[i];
      if (heights[i] > this.terrainMax) this.terrainMax = heights[i];
    }
    this.terrainMin = Math.min(this.terrainMin, edge);
    this.terrainMax = Math.max(this.terrainMax, edge);
    // per-cell terrain maxima must stay an upper bound where the overlay / blend rises above the map
    const top = this._tTop;
    if (!top) return;
    const x0 = O.minX - O.blend;
    const x1 = O.maxX + O.blend;
    const z0 = O.minZ - O.blend;
    const z1 = O.maxZ + O.blend;
    const step = Math.min(O.cell, this.terrain.cell);
    for (let cz = 0; cz < this.rows; cz++) {
      const sz0 = this.minZ + cz * CELL;
      if (sz0 + CELL < z0 || sz0 > z1) continue;
      for (let cx = 0; cx < this.cols; cx++) {
        const sx0 = this.minX + cx * CELL;
        if (sx0 + CELL < x0 || sx0 > x1) continue;
        let m = edge;
        for (let sz = sz0; sz <= sz0 + CELL + 1e-6; sz += step) for (let sx = sx0; sx <= sx0 + CELL + 1e-6; sx += step) m = Math.max(m, this.terrainHeight(sx, sz));
        top[cz * this.cols + cx] = Math.max(top[cz * this.cols + cx], m + 0.05);
      }
    }
  }

  /** Bilinear terrain height (m) at (x, z); 0 without a heightfield. Clamped at the edges. */
  terrainHeight(x, z) {
    const O = this.terrainOverlay;
    if (O) {
      if (x >= O.minX && x <= O.maxX && z >= O.minZ && z <= O.maxZ) return sampleGrid(O, x, z);
      const d = Math.hypot(Math.max(O.minX - x, 0, x - O.maxX), Math.max(O.minZ - z, 0, z - O.maxZ));
      if (d < O.blend) {
        const t = d / O.blend;
        return O.edge + (this._mapTerrainHeight(x, z) - O.edge) * t * t * (3 - 2 * t);
      }
    }
    return this._mapTerrainHeight(x, z);
  }

  /** The map heightfield alone (no overlay); 0 without one. */
  _mapTerrainHeight(x, z) {
    const T = this.terrain;
    return T ? sampleGrid(T, x, z) : 0;
  }

  /** Ground after foundation grading, shared by rendering, movement, rays and placement. */
  surfaceHeight(x, z) {
    const raw = this.terrainHeight(x, z);
    const foundations = this.cellAt(x, z)?.foundations;
    if (!foundations) return raw;
    let height = raw;
    let floor = Infinity;
    for (const c of foundations) {
      const d = footprintDistance(c, x, z);
      if (d === 0) floor = Math.min(floor, c.y0);
      else height = Math.min(height, foundationHeight(c, raw, d));
    }
    return floor < Infinity ? floor : height;
  }

  /** Unit terrain normal at (x, z) written to out ({x, y, z}); returns out. */
  terrainNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 1.5;
    const gx = (this.surfaceHeight(x + e, z) - this.surfaceHeight(x - e, z)) / (2 * e);
    const gz = (this.surfaceHeight(x, z + e) - this.surfaceHeight(x, z - e)) / (2 * e);
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
    const hs = [];
    for (let i = 0; i < n; i++) {
      const y = this.terrainHeight(p[i * 2], p[i * 2 + 1]);
      hs.push(y);
      if (y < m) m = y;
    }
    const s = this.terrain.cell;
    for (let z = Math.ceil(minZ / s) * s; z < maxZ; z += s) {
      for (let x = Math.ceil(minX / s) * s; x < maxX; x += s) {
        if (!pointInPoly(p, n, x, z)) continue;
        const y = this.terrainHeight(x, z);
        hs.push(y);
        if (y < m) m = y;
      }
    }
    if (m === Infinity) return this.terrainHeight((minX + maxX) / 2, (minZ + maxZ) / 2);
    // a ditch / creek spike under one corner must not sink a whole building into a pit (its
    // foundation would undercut the neighbours): never more than 1 m below the 10th-percentile
    // ground under the footprint. Footprints with <= 10 samples keep the exact minimum.
    hs.sort((a, b) => a - b);
    return Math.max(m, hs[Math.floor(0.1 * (hs.length - 1))] - 1);
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
      c = { polys: [], circles: [], dyn: [], roads: [], areas: [], decks: [], boxes: [] };
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
    const y0 = opts && opts.y0 != null ? opts.y0 : kind === 'building'
      ? this.terrainMinUnder(p, n, minX, minZ, maxX, maxZ)
      : this.surfaceHeight((minX + maxX) / 2, (minZ + maxZ) / 2);
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

  // ------------------------------------------------------ enterable buildings

  /**
   * Register an OSM building (map-data record { id, p, h, lv, a, mat, n? }) as a
   * prism collider. Every building is queued as a hollow-shell candidate; call
   * finishBuildings() once ALL buildings and roads are registered (doors look
   * for the nearest road and avoid opening into a neighbouring building).
   */
  addBuilding(bd) {
    const c = this.addPoly(bd.p, bd.h, 'building', bd.mat, bd);
    c.foundationBand = foundationBand(c, (x, z) => this.terrainHeight(x, z));
    const band = c.foundationBand;
    this._each(c.minX - band, c.minZ - band, c.maxX + band, c.maxZ + band, true,
      (cell) => (cell.foundations || (cell.foundations = [])).push(c));
    if (!this._shellQueue) this._shellQueue = [];
    this._shellQueue.push(c);
    return c;
  }

  /**
   * Turn the queued buildings that are big enough into hollow shells (sets
   * collider.shell, see _planShell). Returns the number of hollow buildings.
   */
  finishBuildings() {
    const q = this._shellQueue || [];
    this._shellQueue = null;
    this._interiors = null;
    if (!this._shells) this._shells = [];
    const ctx = { pois: (this.data && this.data.pois) || [] };
    for (const c of q) {
      const s = this._planShell(c);
      if (!s) continue;
      c.shell = s;
      this._installInterior(c, ctx);
      this._shells.push(c);
    }
    this.counts.hollow = this._shells.length;
    // FNV-1a over every plan's hash (building order): equal on every client with the same map
    let h = 0x811c9dc5;
    for (const c of this._shells) h = Math.imul(h ^ (c.shell.plan ? c.shell.plan.hash : 0), 0x01000193) >>> 0;
    this.interiorHash = h.toString(16).padStart(8, '0');
    return this._shells.length;
  }

  // ------------------------------------------------- interiors + wall panels

  /** Plan shell c's interior (Interiors.planInterior) and install its walls and panels. */
  _installInterior(c, ctx) {
    const s = c.shell;
    let plan = null;
    try {
      plan = planInterior(c.ref || {}, s, ctx);
    } catch (err) {
      console.warn('[world] interior plan failed for building', c.ref && c.ref.id, err);
    }
    s.plan = plan;
    s.groundCeil = plan ? plan.levels[0].ceil : s.ceil;
    if (plan) s.ceil = plan.levels[plan.levels.length - 1].ceil;
    s.panels = plan ? plan.panels : [];
    s.dead = 0; // number of broken panels
    s.edgePanels = [];
    for (const pn of s.panels) {
      if (pn.kind !== 'outer') continue;
      (s.edgePanels[pn.e] || (s.edgePanels[pn.e] = [])).push(pn);
    }
    // per level: 1 = wall entry solid (lintels always 1, a wall entry follows its panel)
    s.wallOn = plan ? plan.levels.map((L) => new Uint8Array(L.walls.length / 7).fill(1)) : [];
    if (plan) this._rebuildShellSegs(c);
    if (!this._shellById) this._shellById = new Map();
    if (c.ref && c.ref.id != null) this._shellById.set(c.ref.id, c);
  }

  /**
   * Outer-wall collision capsules from the alive outer panels (the same capsules _planShell
   * builds, split at panel boundaries; a broken panel leaves an opening like a door).
   */
  _rebuildShellSegs(c) {
    const s = c.shell;
    const mid = s.mid;
    const n = c.n;
    const R = s.t / 2;
    const segs = [];
    const over = []; // broken panels: the wall band above them still blocks a head above the ceiling
    for (const pn of s.panels) {
      if (pn.kind !== 'outer') continue;
      if (!pn.alive) {
        const i = pn.e;
        const k = (i + 1) % n;
        const ax = mid[i * 2];
        const az = mid[i * 2 + 1];
        const ex = mid[k * 2] - ax;
        const ez = mid[k * 2 + 1] - az;
        over.push(ax + ex * pn.f0, az + ez * pn.f0, ax + ex * pn.f1, az + ez * pn.f1);
        continue;
      }
      const i = pn.e;
      const k = (i + 1) % n;
      const ax = mid[i * 2];
      const az = mid[i * 2 + 1];
      const bx = mid[k * 2];
      const bz = mid[k * 2 + 1];
      const lm = Math.hypot(bx - ax, bz - az);
      if (lm < 1e-4) continue;
      const cap = R / lm; // capsule end caps reach R past a segment end: stop short of a door
      let f0 = pn.f0;
      let f1 = pn.f1;
      for (const d of s.doors) {
        if (d.e !== i) continue;
        if (d.f1 === pn.f0) f0 += cap;
        if (d.f0 === pn.f1) f1 -= cap;
      }
      if (f1 <= f0) continue;
      segs.push(ax + (bx - ax) * f0, az + (bz - az) * f0, ax + (bx - ax) * f1, az + (bz - az) * f1);
    }
    s.segs = new Float32Array(segs);
    s.overHoles = new Float32Array(over);
  }

  /** The hollow-building collider with map id `id` (or c itself when given a collider). */
  buildingById(id) {
    if (id && typeof id === 'object') return id.shell ? id : null;
    return (this._shellById && this._shellById.get(id)) || null;
  }

  /** The outer panel of building c covering fraction u of edge `edge` at height y, or null. */
  panelAt(c, edge, u, y) {
    c = this.buildingById(c);
    const list = c && c.shell.edgePanels[edge];
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const pn = list[i];
      if (u >= pn.f0 && u <= pn.f1 && y >= pn.y0 - 1e-3 && y <= pn.y1 + 1e-3) return pn;
    }
    return null;
  }

  /** The panel a raycast() result hit (hit.panel, else resolved from hit.edge / hit.u), or null. */
  panelHit(hit) {
    if (!hit || !hit.collider || !hit.collider.shell) return null;
    if (hit.panel) return hit.panel;
    if (hit.edge >= 0) return this.panelAt(hit.collider, hit.edge, hit.u, hit.y);
    return null;
  }

  /** Break panel `id` of building c (collider or building id). Never removes the collider. */
  breakPanel(c, id) {
    c = this.buildingById(c);
    const pn = c && c.shell.panels[id];
    if (!pn || !pn.alive) return false;
    pn.alive = false;
    pn.hp = 0;
    this._panelState(c, pn);
    return true;
  }

  /** Put panel `id` of building c back at full health. */
  restorePanel(c, id) {
    c = this.buildingById(c);
    const pn = c && c.shell.panels[id];
    if (!pn) return false;
    pn.hp = pn.maxHp;
    if (pn.alive) return false;
    pn.alive = true;
    this._panelState(c, pn);
    return true;
  }

  /** Every panel of every building back at full health (match restart). Returns the number rebuilt. */
  restoreAllPanels() {
    let k = 0;
    for (const c of this._shells || []) {
      for (const pn of c.shell.panels) {
        if (!pn.alive) {
          this.restorePanel(c, pn.id);
          k++;
        } else pn.hp = pn.maxHp;
      }
    }
    return k;
  }

  _panelState(c, pn) {
    const s = c.shell;
    s.dead += pn.alive ? -1 : 1;
    if (pn.kind === 'outer') this._rebuildShellSegs(c);
    else if (pn.kind === 'floor') s.deadFloors = (s.deadFloors || 0) + (pn.alive ? -1 : 1);
    else s.wallOn[pn.level][pn.wall] = pn.alive ? 1 : 0;
    if (this.onPanelChange) this.onPanelChange(c, pn, pn.alive);
  }

  /**
   * Is the slab of level L (its floor, i.e. the ceiling of the storey below) open at (x, z):
   * a stairwell hole, or a broken floor tile (interiors/floorTiles.js)?
   */
  _slabOpen(s, L, x, z) {
    if (inHole(s.plan, L, x, z)) return true;
    if (!s.deadFloors) return false;
    const [a, b] = planLocal(s.plan.frame, x, z);
    const id = tileIdAt(L, a, b);
    return id >= 0 && !s.panels[id].alive;
  }

  /** The alive floor tile of level L at (x, z), or null. */
  _tileAt(s, L, x, z) {
    if (!L.tiles || !L.tiles.length) return null;
    const [a, b] = planLocal(s.plan.frame, x, z);
    const id = tileIdAt(L, a, b);
    const pn = id >= 0 ? s.panels[id] : null;
    return pn && pn.alive ? pn : null;
  }

  /** Is fraction u of outer edge e at height y inside a broken panel? */
  _deadAt(s, e, u, y) {
    const list = s.edgePanels[e];
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const pn = list[i];
      if (!pn.alive && u >= pn.f0 && u <= pn.f1 && y >= pn.y0 && y <= pn.y1) return true;
    }
    return false;
  }

  /**
   * Push a circle out of the interior partitions of shell c (capsules with a y-range) and out of
   * its solid furniture (levels[i].props, same capsule format; optional). A capsule whose top is
   * within `step` of the feet is stepped over (groundHeight lifts the feet onto it).
   */
  _wallsPush(c, pos, r, feet, head, step) {
    const s = c.shell;
    let moved = false;
    const levels = s.plan.levels;
    for (let li = 0; li < levels.length; li++) {
      const W = levels[li].walls;
      const on = s.wallOn[li];
      for (let k = 0, w = 0; k < W.length; k += 7, w++) {
        if (!on[w] || feet >= W[k + 6] - step || head <= W[k + 5] + 0.05) continue;
        if (this._capsulePush(W, k, pos, r)) moved = true;
      }
      const P = levels[li].props;
      if (!P) continue;
      for (let k = 0; k < P.length; k += 7) {
        if (feet >= P[k + 6] - step || head <= P[k + 5] + 0.05) continue;
        if (this._capsulePush(P, k, pos, r)) moved = true;
      }
    }
    return moved;
  }

  /** Push circle (pos.x, pos.z, r) out of capsule k of W (stride 7); adds to pushX / pushZ. */
  _capsulePush(W, k, pos, r) {
    const ax = W[k];
    const az = W[k + 1];
    const ex = W[k + 2] - ax;
    const ez = W[k + 3] - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((pos.x - ax) * ex + (pos.z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = pos.x - (ax + ex * t);
    const dz = pos.z - (az + ez * t);
    const lim = r + W[k + 4];
    const d2 = dx * dx + dz * dz;
    if (d2 >= lim * lim) return false;
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
    return true;
  }

  /**
   * Does a circle (x, z, r) overlap a solid interior partition or solid furniture capsule of
   * shell c on the storey holding feetY (default: the ground storey)?
   */
  _wallsNear(c, x, z, r, feetY = c.shell.floor) {
    const s = c.shell;
    if (!s.plan) return false;
    const levels = s.plan.levels;
    let li = 0;
    for (let i = 1; i < levels.length; i++) if (levels[i].y <= feetY + 0.15) li = i;
    const L = levels[li];
    const W = L.walls;
    const on = s.wallOn[li];
    const band = feetY + 0.5;
    for (let k = 0, w = 0; k < W.length; k += 7, w++) {
      if (!on[w] || W[k + 5] > band || W[k + 6] <= feetY + 0.1) continue;
      const lim = r + W[k + 4];
      if (this._segD2(W, k, x, z) < lim * lim) return true;
    }
    // solid furniture on that storey (spawn / loot / build placement keep off it)
    const P = L.props;
    if (P) {
      for (let k = 0; k < P.length; k += 7) {
        if (P[k + 5] > band || P[k + 6] <= feetY + 0.1) continue;
        const lim = r + P[k + 4];
        if (this._segD2(P, k, x, z) < lim * lim) return true;
      }
    }
    return false;
  }

  _segD2(W, k, x, z) {
    const ax = W[k];
    const az = W[k + 1];
    const ex = W[k + 2] - ax;
    const ez = W[k + 3] - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + ex * t);
    const dz = z - (az + ez * t);
    return dx * dx + dz * dz;
  }

  /** Does the ray's (x, z) shadow, for t in [0, best], cross collider c's bounding box? */
  _rayBox(c, ox, oz, dx, dz, best) {
    let t0 = 0;
    let t1 = best;
    if (dx > -1e-12 && dx < 1e-12) {
      if (ox < c.minX || ox > c.maxX) return false;
    } else {
      let a = (c.minX - ox) / dx;
      let b = (c.maxX - ox) / dx;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    if (dz > -1e-12 && dz < 1e-12) {
      if (oz < c.minZ || oz > c.maxZ) return false;
    } else {
      let a = (c.minZ - oz) / dz;
      let b = (c.maxZ - oz) / dz;
      if (a > b) [a, b] = [b, a];
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }

  /** Nearest road point within R of (x, z): { x, z, d, k } (shared object) or null. */
  _nearestRoad(x, z, R) {
    let best = null;
    let bd = R * R;
    const out = this._roadHit || (this._roadHit = { x: 0, z: 0, d: 0, k: null });
    this._each(x - R, z - R, x + R, z + R, false, (cell) => {
      const roads = cell.roads;
      for (let i = 0; i < roads.length; i++) {
        const s = roads[i];
        const dx = s.bx - s.ax;
        const dz = s.bz - s.az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = s.ax + dx * t;
        const pz = s.az + dz * t;
        const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);
        if (d2 < bd) {
          bd = d2;
          out.x = px;
          out.z = pz;
          out.k = s.k;
          best = out;
        }
      }
    });
    if (best) best.d = Math.sqrt(bd);
    return best;
  }

  /** Another building's footprint contains (x, z)? */
  _otherBuildingAt(c, x, z) {
    const cell = this.cellAt(x, z);
    if (!cell) return false;
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const o = polys[i];
      if (o === c || x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue;
      if (pointInPoly(o.p, o.n, x, z)) return true;
    }
    return false;
  }

  /**
   * Plan the hollow shell of building collider c, or null to keep it a solid prism.
   *
   * shell = {
   *   t           wall thickness (m)
   *   floor       absolute floor height (= c.y0, the building base)
   *   ceil        absolute interior ceiling (roof slab underside, or the ground-storey
   *               ceiling of a tall building whose upper floors stay solid)
   *   ceilRel     ceil - floor
   *   doorH       door height above the floor; doorTop = floor + doorH
   *   doors       [{ e, u0, u1, f0, f1, x, z, nx, nz }]  edge index e (vertex e -> e+1),
   *               opening [u0, u1] metres from vertex e (fractions f0, f1), centre (x, z)
   *               on the outer face, outward normal (nx, nz)
   *   doorF       Float32Array [e, f0, f1, ...] (raycast door test)
   *   segs        Float32Array [ax, az, bx, bz, ...] solid wall centre lines (capsules of radius t/2)
   *   lintels     Float32Array, same layout: the wall above each door (blocks only above doorTop)
   *   inner       Float32Array [x, z, ...] interior face polygon (footprint offset inward by t)
   *   mid         Float32Array [x, z, ...] wall centre-line polygon (offset inward by t / 2)
   *   area        footprint area (m^2)
   * finishBuildings() then adds (see _installInterior): plan (Interiors.planInterior), panels,
   * edgePanels, wallOn, dead; segs is rebuilt from the alive outer panels.
   * }
   */
  _planShell(c) {
    const p = c.p;
    const n = c.n;
    const bd = c.ref || {};
    if (n < 3 || n > HOLLOW_MAX_VERTS) return null;
    let A2 = 0;
    let P = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      A2 += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1];
      P += Math.hypot(p[i * 2] - p[j * 2], p[i * 2 + 1] - p[j * 2 + 1]);
    }
    const area = Math.abs(A2) / 2;
    if (area < HOLLOW_MIN_AREA || area / P < HOLLOW_MIN_A_OVER_P) return null;
    const hgt = c.hgt;
    const lv = Math.max(1, bd.lv || Math.round(hgt / 3.5) || 1);
    const ceilRel = hgt <= SINGLE_SPACE_MAX ? hgt - ROOF_T : Math.max(STOREY_MIN, Math.min(STOREY_MAX, hgt / lv));
    if (ceilRel < 2.6) return null;
    const doorH = Math.min(DOOR_H, ceilRel - 0.15);
    const t = SHELL_T;
    const sgn = A2 > 0 ? 1 : -1; // interior lies left of each edge for a CCW (A2 > 0) ring

    // per-edge unit direction / inward normal / length (edge i: vertex i -> i + 1)
    const ex = new Float32Array(n);
    const ez = new Float32Array(n);
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const dx = p[k * 2] - p[i * 2];
      const dz = p[k * 2 + 1] - p[i * 2 + 1];
      const l = Math.hypot(dx, dz);
      L[i] = l;
      ex[i] = l > 1e-6 ? dx / l : 1;
      ez[i] = l > 1e-6 ? dz / l : 0;
    }
    // inward normal of edge i: sgn * (-ez, ex)
    const inner = new Float32Array(n * 2);
    const mid = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const n1x = -ez[j] * sgn;
      const n1z = ex[j] * sgn;
      const n2x = -ez[i] * sgn;
      const n2z = ex[i] * sgn;
      let mx = n1x + n2x;
      let mz = n1z + n2z;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-6) {
        mx = n2x;
        mz = n2z;
      } else {
        mx /= ml;
        mz /= ml;
      }
      const k = 1 / Math.max(0.35, mx * n2x + mz * n2z); // miter, clamped at sharp corners
      inner[i * 2] = p[i * 2] + mx * t * k;
      inner[i * 2 + 1] = p[i * 2 + 1] + mz * t * k;
      mid[i * 2] = p[i * 2] + mx * t * 0.5 * k;
      mid[i * 2 + 1] = p[i * 2 + 1] + mz * t * 0.5 * k;
    }

    // ---- door candidates
    const minLen = DOOR_W + 2 * DOOR_MARGIN;
    const cands = [];
    for (let i = 0; i < n; i++) {
      const l = L[i];
      if (l < minLen) continue;
      const ax = p[i * 2];
      const az = p[i * 2 + 1];
      const ox = ez[i] * sgn; // outward normal
      const oz = -ex[i] * sgn;
      const lo = DOOR_MARGIN + DOOR_W / 2;
      const hi = l - lo;
      const us = [l / 2];
      const mxp = ax + ex[i] * (l / 2) + ox * 2;
      const mzp = az + ez[i] * (l / 2) + oz * 2;
      const road = this._nearestRoad(mxp, mzp, 60);
      let roadFacing = false;
      if (road && (road.x - mxp) * ox + (road.z - mzp) * oz > 0.3 * road.d) {
        roadFacing = true;
        const ur = (road.x - ax) * ex[i] + (road.z - az) * ez[i];
        us.push(ur < lo ? lo : ur > hi ? hi : ur);
      }
      for (let u = lo; l > 30 && u <= hi; u += 20) us.push(u);
      for (const u of us) {
        const x = ax + ex[i] * u;
        const z = az + ez[i] * u;
        // the step outside must be open ground, the step inside must be roomy interior
        let ok = true;
        for (const s of [-0.7, 0, 0.7]) {
          if (this._otherBuildingAt(c, x + ox * 1.1 + ex[i] * s, z + oz * 1.1 + ez[i] * s)) ok = false;
        }
        const ix = x - ox * (t + 0.7);
        const iz = z - oz * (t + 0.7);
        if (!ok || !pointInPoly(p, n, ix, iz) || this._polyDist2(c, ix, iz) < (t + 0.4) * (t + 0.4)) continue;
        let score = 80;
        if (roadFacing) {
          const r2 = this._nearestRoad(x + ox, z + oz, 60);
          score = r2 ? r2.d : 60;
        }
        cands.push({ e: i, u, x, z, ox, oz, score });
      }
    }
    if (!cands.length) return null;
    const want = area < 200 ? 1 : area < 900 ? 2 : area < 4000 ? 3 : Math.min(6, 3 + Math.floor(area / 8000));
    cands.sort((a, b) => a.score - b.score);
    const chosen = [cands[0]];
    while (chosen.length < want) {
      let best = null;
      let bestV = -Infinity;
      for (const cd of cands) {
        let md = Infinity;
        for (const ch of chosen) md = Math.min(md, Math.hypot(cd.x - ch.x, cd.z - ch.z));
        if (md < 8) continue;
        const v = md - cd.score * 0.25;
        if (v > bestV) {
          bestV = v;
          best = cd;
        }
      }
      if (!best) break;
      chosen.push(best);
    }

    const doors = chosen.map((d, k) => {
      const l = L[d.e];
      const u0 = d.u - DOOR_W / 2;
      const u1 = d.u + DOOR_W / 2;
      // main: the best-scoring (road-facing) door; interiors put the front rooms behind it
      return { e: d.e, u0, u1, f0: u0 / l, f1: u1 / l, x: d.x, z: d.z, nx: d.ox, nz: d.oz, main: k === 0 };
    });
    doors.sort((a, b) => a.e - b.e || a.f0 - b.f0);
    const doorF = new Float32Array(doors.length * 3);
    doors.forEach((d, k) => {
      doorF[k * 3] = d.e;
      doorF[k * 3 + 1] = d.f0;
      doorF[k * 3 + 2] = d.f1;
    });

    // ---- collision centre lines (the wall band's middle), split at the doors
    const segs = [];
    const lintels = [];
    const R = t / 2;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n;
      const ax = mid[i * 2];
      const az = mid[i * 2 + 1];
      const bx = mid[k * 2];
      const bz = mid[k * 2 + 1];
      const lm = Math.hypot(bx - ax, bz - az);
      if (lm < 1e-4) continue;
      const cap = R / lm; // capsule end caps reach R past a segment end: stop short of the opening
      let f = 0;
      const at = (q) => [ax + (bx - ax) * q, az + (bz - az) * q];
      for (const d of doors) {
        if (d.e !== i) continue;
        const f0 = d.f0 - cap;
        if (f0 > f) segs.push(...at(f), ...at(f0));
        lintels.push(...at(d.f0), ...at(d.f1));
        f = d.f1 + cap;
      }
      if (f < 1) segs.push(...at(f), ...at(1));
    }

    return {
      t,
      floor: c.y0,
      ceil: c.y0 + ceilRel,
      ceilRel,
      doorH,
      doorTop: c.y0 + doorH,
      doors,
      doorF,
      segs: new Float32Array(segs),
      lintels: new Float32Array(lintels),
      inner,
      mid,
      area,
    };
  }

  /** Is fraction u of edge e inside one of the shell's door openings? */
  _inDoor(s, e, u) {
    const F = s.doorF;
    for (let k = 0; k < F.length; k += 3) if (F[k] === e && u >= F[k + 1] && u <= F[k + 2]) return true;
    return false;
  }

  /** Squared distance from (x, z) to the nearest capsule centre line in A (stride 4). */
  _segsDist2(A, x, z) {
    let best = Infinity;
    for (let k = 0; k < A.length; k += 4) {
      const ax = A[k];
      const az = A[k + 1];
      const ex = A[k + 2] - ax;
      const ez = A[k + 3] - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (ax + ex * t);
      const dz = z - (az + ez * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return best;
  }

  /** Push a circle out of shell walls (and lintels when the head is above the door top). */
  _shellPush(c, pos, r, head) {
    const s = c.shell;
    const lim = r + s.t * 0.5;
    const lim2 = lim * lim;
    let moved = false;
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 1 && head <= s.doorTop + 0.02) continue;
      if (pass === 2 && (!s.overHoles || head <= (s.groundCeil ?? s.ceil) + 0.02)) continue;
      const A = pass === 0 ? s.segs : pass === 1 ? s.lintels : s.overHoles;
      for (let k = 0; k < A.length; k += 4) {
        const ax = A[k];
        const az = A[k + 1];
        const ex = A[k + 2] - ax;
        const ez = A[k + 3] - az;
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((pos.x - ax) * ex + (pos.z - az) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = pos.x - (ax + ex * t);
        const dz = pos.z - (az + ez * t);
        const d2 = dx * dx + dz * dz;
        if (d2 >= lim2) continue;
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
        moved = true;
      }
    }
    return moved;
  }

  /**
   * The hollow building whose interior contains (x, z) (inside the footprint and
   * clear of the wall band), or null. The collider's .shell has floor / ceil / doors.
   */
  interiorAt(x, z, feetY = null) {
    const cell = this.cellAt(x, z);
    if (!cell) return null;
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      if (!c.shell || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (feetY != null && (feetY < c.shell.floor - 0.5 || feetY >= c.shell.ceil)) continue;
      if (this._onInteriorFloor(c, x, z, 0, feetY ?? c.shell.floor)) return c;
    }
    return null;
  }

  /**
   * Is a circle (x, z, r) on shell c's interior floor: centre inside the footprint and
   * clear of the wall capsules (and of the lintel capsules across the door openings, so a
   * doorway is not "inside")? Uses the same capsules (radius t/2) as blockedAt(..., true)
   * and the player's wall collision, so interiorAt(x, z) === c implies
   * !blockedAt(x, z, 0, true) as far as c's walls go, and the loot / spawn checks agree.
   */
  _onInteriorFloor(c, x, z, r, feetY = c.shell.floor) {
    const s = c.shell;
    if (!pointInPoly(c.p, c.n, x, z)) return false;
    const lim = r + s.t * 0.5;
    const lim2 = lim * lim;
    return (
      this._segsDist2(s.segs, x, z) >= lim2 &&
      (!s.lintels.length || this._segsDist2(s.lintels, x, z) >= lim2) &&
      !(s.plan && this._wallsNear(c, x, z, r, feetY))
    );
  }

  /**
   * Every enterable building (cached; built by finishBuildings()):
   *   [{ id, name, collider, x, z, area, floorY, ceilY, topY,
   *      doors: [{ x, z, nx, nz, width, height }] }]
   * (x, z) is the footprint's vertex average; floorY is the walkable interior floor,
   * ceilY the interior ceiling, topY the (standable) roof; doors sit on the outer
   * wall face with an outward normal.
   */
  buildingInteriors() {
    if (this._interiors) return this._interiors;
    const list = [];
    for (const c of this._shells || []) {
      const s = c.shell;
      let x = 0;
      let z = 0;
      for (let i = 0; i < c.n; i++) {
        x += c.p[i * 2];
        z += c.p[i * 2 + 1];
      }
      list.push({
        id: c.ref && c.ref.id,
        name: (c.ref && c.ref.n) || null,
        collider: c,
        x: x / c.n,
        z: z / c.n,
        area: s.area,
        floorY: s.floor,
        ceilY: s.ceil,
        topY: c.h,
        doors: s.doors.map((d) => ({ x: d.x, z: d.z, nx: d.nx, nz: d.nz, width: DOOR_W, height: s.doorH })),
      });
    }
    this._interiors = list;
    return list;
  }

  /**
   * A random standable point on the ground floor of an enterable building.
   *   opts: { x, z, radius }   only buildings whose centre is within radius of (x, z)
   *         clearance (0.5)    min distance (m) from the inner wall face
   *         minArea (0)        skip smaller footprints
   *         weight ('sqrt')    'sqrt' (sqrt of area), 'area' or 'uniform' building choice
   * Returns out = { x, y, z, building } (building = a buildingInteriors() entry) or null.
   */
  randomInteriorPoint(rng, opts = {}, out = { x: 0, y: 0, z: 0, building: null }) {
    const clr = opts.clearance != null ? opts.clearance : 0.5;
    const minArea = opts.minArea || 0;
    const r2 = opts.radius != null ? opts.radius * opts.radius : Infinity;
    const wmode = opts.weight || 'sqrt';
    const all = this.buildingInteriors();
    const pool = [];
    const cum = [];
    let tot = 0;
    for (const b of all) {
      if (b.area < minArea) continue;
      if (r2 !== Infinity && (b.x - opts.x) * (b.x - opts.x) + (b.z - opts.z) * (b.z - opts.z) > r2) continue;
      tot += wmode === 'uniform' ? 1 : wmode === 'area' ? b.area : Math.sqrt(b.area);
      pool.push(b);
      cum.push(tot);
    }
    if (!pool.length) return null;
    for (let tryB = 0; tryB < 12; tryB++) {
      const pick = rng() * tot;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (cum[m] < pick) lo = m + 1;
        else hi = m;
      }
      const b = pool[lo];
      const c = b.collider;
      for (let k = 0; k < 24; k++) {
        const x = c.minX + rng() * (c.maxX - c.minX);
        const z = c.minZ + rng() * (c.maxZ - c.minZ);
        if (!this._onInteriorFloor(c, x, z, clr)) continue;
        if (this._circleAt(x, z, clr)) continue;
        out.x = x;
        out.y = c.shell.floor;
        out.z = z;
        out.building = b;
        return out;
      }
    }
    return null;
  }

  /** Any solid cylinder overlapping a circle at (x, z)? */
  _circleAt(x, z, r) {
    const cell = this.cellAt(x, z);
    if (!cell) return false;
    const circles = cell.circles;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      const lim = r + c.r;
      if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < lim * lim) return true;
    }
    return false;
  }

  /** h: height above the terrain at (x, z). The collider stores y0 (base) and h (absolute top). */
  addCircle(x, z, r, h, kind, mat, hp, ref) {
    const y0 = this.surfaceHeight(x, z);
    const c = { type: 'circle', kind, x, z, r, h: y0 + h, y0, hgt: h, mat, hp, maxHp: hp, ref, stamp: 0, alive: true };
    this._each(x - r, z - r, x + r, z + r, true, (cell) => cell.circles.push(c));
    this.counts.circles++;
    return c;
  }

  /**
   * Oriented box collider (see boxColliders.js): { cx, cz, hx, hz, yaw, y0, y1, kind, mat, hp, ref }
   * with ABSOLUTE y0 / y1. Gets a sequential id (stable for the same build order on every
   * client: multiplayer destroy events name boxes by id). Returns the collider.
   */
  addBox(o) {
    if (!this._boxes) this._boxes = [];
    const c = makeBox({ ...o, id: this._boxes.length });
    this._boxes.push(c);
    this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.boxes.push(c));
    this.counts.boxes = this._boxes.length;
    return c;
  }

  /**
   * A moving box (drivable car body): solid for movement, standing and building like any box,
   * but skipped by raycast() (`noRay`; Vehicles traces shots so glass can break). Not given an
   * id (multiplayer destroy events never name it). Move it with moveDynBox.
   */
  addDynBox(o) {
    const c = makeBox({ ...o, id: -1 });
    c.noRay = true;
    c.dynBox = true;
    this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.boxes.push(c));
    return c;
  }

  /** Re-place a moving box (from addDynBox); `alive: false` boxes stay out until moved back in. */
  moveDynBox(c, cx, cz, yaw, y0, y1) {
    if (!c) return;
    if (c.alive) this.remove(c);
    const n = makeBox({ cx, cz, hx: c.hx, hz: c.hz, yaw, y0, y1, kind: c.kind, mat: c.mat, id: -1 });
    for (const k of ['cx', 'cz', 'cos', 'sin', 'y0', 'y1', 'h', 'hgt', 'minX', 'maxX', 'minZ', 'maxZ']) c[k] = n[k];
    c.alive = true;
    this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.boxes.push(c));
  }

  /**
   * Reserve a plan polygon ([[x, z], ...]) for a bespoke landmark (Crystal Bridges): generic
   * scatter (trees, rocks, parked cars) and generic loot stay out; the landmark places its own.
   */
  reserve(pts) {
    if (!this._reserved) this._reserved = [];
    const p = new Float32Array(pts.length * 2);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pts.forEach(([x, z], i) => {
      p[i * 2] = x;
      p[i * 2 + 1] = z;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    });
    this._reserved.push({ p, n: pts.length, minX, maxX, minZ, maxZ });
  }

  reservedAt(x, z) {
    const R = this._reserved;
    if (!R) return false;
    for (const r of R) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && pointInPoly(r.p, r.n, x, z)) return true;
    return false;
  }

  boxById(id) {
    return (this._boxes && this._boxes[id]) || null;
  }

  remove(c) {
    if (!c || !c.alive) return;
    c.alive = false;
    if (c.type === 'box') {
      this._each(c.minX, c.minZ, c.maxX, c.maxZ, false, (cell) => {
        const i = cell.boxes.indexOf(c);
        if (i >= 0) cell.boxes.splice(i, 1);
      });
    } else if (c.type === 'poly') {
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
    if (c.type === 'box') this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.boxes.push(c));
    else if (c.type === 'poly') this._each(c.minX, c.minZ, c.maxX, c.maxZ, true, (cell) => cell.polys.push(c));
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

  /**
   * Swimming: feet on the terrain (not a bridge deck, build, floor or roof) inside a water
   * area. feetY: the actor's feet height.
   */
  inWater(x, z, feetY) {
    if (this.areaAt(x, z) !== 'water') return false;
    return feetY - this.surfaceHeight(x, z) < 0.4;
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

  /**
   * True when a circle of radius r at ground level would overlap something solid.
   * By default an enterable building blocks its whole footprint (spawn / scatter
   * code keeps out of buildings). With interiors = true only its walls block, so
   * points inside (and in the door openings) count as open.
   */
  blockedAt(x, z, r, interiors = false) {
    let hit = false;
    const band = this.surfaceHeight(x, z) + PIECE_GROUND_BAND;
    this._each(x - r, z - r, x + r, z + r, false, (cell) => {
      if (hit) return;
      const polys = cell.polys;
      for (let i = 0; i < polys.length && !hit; i++) {
        const c = polys[i];
        if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
        if (interiors && c.shell) {
          const lim = r + c.shell.t * 0.5;
          if (this._segsDist2(c.shell.segs, x, z) < lim * lim || (c.shell.plan && this._wallsNear(c, x, z, r))) hit = true;
          continue;
        }
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
      // architecture boxes that reach down into the ground band (a slab high overhead is no
      // obstacle; a `walkable` floor slab, e.g. a museum floor over the ravine, is walked on)
      const boxes = cell.boxes;
      for (let i = 0; i < boxes.length && !hit; i++) {
        const c = boxes[i];
        if (!c.passable && !c.walkable && c.y0 < band && c.y1 > band - PIECE_GROUND_BAND && boxContains(c, x, z, r)) hit = true;
      }
    });
    return hit;
  }

  /** Does a circle (x, z, r) overlap piece `c` in plan, for a piece whose base is below `belowY`? */
  _pieceOverlaps(c, x, z, r, belowY) {
    if (!c.alive || c.y0 >= belowY) return false;
    if (c.seg) {
      const segs = c.segs; // edited wall: only its solid runs count
      const ns = segs ? segs.length : 1;
      for (let si = 0; si < ns; si++) {
        const s = segs ? segs[si] : c.seg;
        if (segs && s[4] >= belowY) continue;
        const ex = s[2] - s[0];
        const ez = s[3] - s[1];
        const l2 = ex * ex + ez * ez;
        let t = l2 > 0 ? ((x - s[0]) * ex + (z - s[1]) * ez) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = x - (s[0] + ex * t);
        const qz = z - (s[1] + ez * t);
        const lim = r + WALL_HALF;
        if (qx * qx + qz * qz < lim * lim) return true;
      }
      return false;
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
   * Sets this.surface to 'ground' | 'roof' | 'vehicle' | 'build' | 'floor'
   * ('floor' = the ground floor inside an enterable building, when it is above the terrain).
   */
  groundHeight(x, z, feetY, step = STEP, cap = Infinity) {
    let y = this.surfaceHeight(x, z);
    this.surface = 'ground';
    const cell = this.cellAt(x, z);
    if (!cell) return y;
    const lim = feetY + step;
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      if (c.h <= y || (!c.planes && !c.shell && c.h > lim)) continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (pointInPoly(c.p, c.n, x, z)) {
        const top = c.planes ? c.eave + roofRise(c.planes, x, z) : c.h;
        if (top > y && top <= lim && top < cap) {
          y = top;
          this.surface = c.kind === 'vehicle' ? 'vehicle' : 'roof';
        } else if (c.shell && top > lim && c.shell.floor > y && c.shell.floor <= lim) {
          // below the roof of an enterable building: its ground floor
          y = c.shell.floor;
          this.surface = 'floor';
        }
      }
      if (c.shell?.plan && pointInPoly(c.p, c.n, x, z)) {
        const plan = c.shell.plan;
        for (const L of plan.levels) {
          if (L.y > y && L.y <= lim && L.y < cap && !this._slabOpen(c.shell, L, x, z)) {
            y = L.y;
            this.surface = 'floor';
          }
        }
        for (const s of plan.stairs) {
          const sy = stairHeight(s, x, z);
          if (sy > y && sy <= lim && sy < cap) { y = sy; this.surface = 'floor'; }
        }
        // the top of solid furniture (stepped onto when low, landed on from a jump)
        for (const L of plan.levels) {
          const P = L.props;
          if (!P) continue;
          for (let k = 0; k < P.length; k += 7) {
            const top = P[k + 6];
            if (top <= y || top > lim || top >= cap) continue;
            const pr = P[k + 4];
            if (this._segD2(P, k, x, z) < pr * pr) {
              y = top;
              this.surface = 'floor';
            }
          }
        }
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
    const boxes = cell.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (c.passable || c.y1 <= y || c.y1 > lim || c.y1 >= cap || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (boxContains(c, x, z)) {
        y = c.y1;
        this.surface = 'floor';
      }
    }
    const dyn = cell.dyn;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i];
      if (!d.surf || x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      const sy = d.surf(x, z);
      // a ramp / cone built around the feet (centre strictly inside it, feet within its
      // height) lifts them onto its surface even past the step height
      const around =
        d.wedge && feetY >= d.y0 - 0.3 && sy - feetY <= WEDGE_LIFT &&
        (!d.slab || (d.age || 0) < SLAB_LIFT_AGE) && // walking under an old ramp never lifts you onto it
        x > d.minX + 0.01 && x < d.maxX - 0.01 && z > d.minZ + 0.01 && z < d.maxZ - 0.01;
      if (sy > y && sy < cap && (sy <= lim || around)) {
        y = sy;
        this.surface = 'build';
      }
    }
    return y;
  }

  /**
   * Lowest built surface above the feet (for head bumps and "something cuts through my body"):
   * built pieces, the interior ceiling of an enterable building, and a door's lintel.
   */
  ceilingAbove(x, z, feetY, step = STEP) {
    let y = Infinity;
    const cell = this.cellAt(x, z);
    if (!cell) return y;
    const lim = feetY + step;
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      const s = c.shell;
      if (!s || feetY >= s.ceil || x < c.minX - 1 || x > c.maxX + 1 || z < c.minZ - 1 || z > c.maxZ + 1) continue;
      let cy = Infinity;
      if (pointInPoly(c.p, c.n, x, z)) cy = s.ceil;
      if (feetY < s.doorTop && s.lintels.length) {
        const ll = s.t * 0.5 + 0.3;
        if (this._segsDist2(s.lintels, x, z) < ll * ll) cy = Math.min(cy, s.doorTop);
      }
      if (s.plan) {
        // interior door lintels (and any partition span that starts above the floor)
        for (const L of s.plan.levels) {
          const underside = L.y - FLOOR_THICKNESS;
          if (L.i > 0 && underside > lim && !this._slabOpen(s, L, x, z) && pointInPoly(c.p, c.n, x, z)) cy = Math.min(cy, underside);
          const W = L.walls;
          for (let k = 0, wi = 0; k < W.length; k += 7, wi++) {
            if (!s.wallOn[L.i][wi] || W[k + 5] <= L.y + 0.5 || feetY >= W[k + 5]) continue;
            const ll = W[k + 4] + 0.3;
            if (this._segD2(W, k, x, z) < ll * ll && W[k + 5] < cy) cy = W[k + 5];
          }
        }
        for (const stair of s.plan.stairs) {
          const underside = stairHeight(stair,x,z) - FLOOR_THICKNESS;
          if (underside > lim) cy = Math.min(cy, underside);
        }
      }
      if (cy > lim && cy < y) y = cy;
    }
    // the underside of an architecture box overhead (bridge slab, roof, upper floor)
    const boxes = cell.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (c.passable || c.y0 <= lim || c.y0 >= y || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (boxContains(c, x, z)) y = c.y0;
    }
    const dyn = cell.dyn;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i];
      if (!d.surf || x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      // under a ramp / cone (feet below its base): it is solid from its base up, so the base
      // is the ceiling — jumping up into one bonks instead of phasing in and popping on top
      // a ramp is a plank: its underside is the ceiling (you can stand under its high end)
      const sy = d.slab
        ? d.surf(x, z) - SLAB
        : d.wedge && feetY < d.y0 - 0.3
          ? d.y0
          : d.kind === 'floor'
            ? d.surf(x, z) - FLOOR_THICK // a floor's underside, not its top
            : d.surf(x, z);
      if (sy > lim && sy < y) y = sy;
    }
    return y;
  }

  /**
   * Top of the lowest settled built floor (or ramp plank) above the feet at (x, z), or Infinity.
   * Something already above you can't be stepped / snapped onto from below: the caller passes
   * this (taken where the body WAS) as groundHeight's `cap`, so walking uphill or jumping under
   * a floor never pops you through it. Fresh pieces (still rising) are skipped so a floor or ramp
   * built at your feet still lifts you.
   */
  builtAbove(x, z, feetY) {
    let y = Infinity;
    const cell = this.cellAt(x, z);
    if (!cell) return y;
    // an enterable building's own ceilings count too: the upper storey's floor over our head
    // (outside its stair holes), else the roof slab over the top storey. Returned as a "top"
    // FLOOR_THICK above the underside, like a built floor, so callers' underside maths holds.
    const polys = cell.polys;
    for (let i = 0; i < polys.length; i++) {
      const c = polys[i];
      const s = c.shell;
      if (!s || feetY >= s.ceil - 0.05 || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (!pointInPoly(c.p, c.n, x, z)) continue;
      let top = s.ceil + FLOOR_THICK;
      if (s.plan) {
        for (const L of s.plan.levels) {
          if (L.i > 0 && L.y - FLOOR_THICKNESS > feetY + 0.05 && L.y < top && !this._slabOpen(s, L, x, z)) top = L.y;
        }
      }
      if (top < y) y = top;
    }
    // an architecture box whose underside is above the feet can't be stepped onto from below
    const boxes = cell.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (c.passable || c.y0 <= feetY + 0.05 || c.y1 >= y || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (boxContains(c, x, z)) y = c.y1;
    }
    const dyn = cell.dyn;
    for (let i = 0; i < dyn.length; i++) {
      const d = dyn[i];
      if (!d.surf || (d.kind !== 'floor' && !d.slab) || (d.age || 0) < SLAB_LIFT_AGE) continue;
      if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      const sy = d.surf(x, z);
      const under = sy - (d.slab ? SLAB : FLOOR_THICK);
      if (under > feetY + 0.05 && sy < y) y = sy;
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
            const x = pos.x;
            const z = pos.z;
            if (feet >= (c.planes ? c.eave + roofRise(c.planes, x, z) : c.h) - step) {
              // on top of it / can step onto it, unless the feet are inside an enterable
              // building's interior (just under a thin roof): its walls still hold there
              if (!c.shell || feet >= c.shell.ceil || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ || !pointInPoly(c.p, c.n, x, z))
                continue;
            }
            if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
            if (c.shell && feet < c.shell.ceil) {
              // enterable building, feet below its interior ceiling: only the walls (and
              // the lintels above the doors) are solid. The walls trace the whole outline,
              // so this blocks from outside exactly like the solid prism, and a body inside
              // (mid-jump, or standing on a built floor / ramp) is never pushed out through
              // a wall. The solid prism only applies above the ceiling: a tall building's
              // solid upper floors, and the roof (stepped onto via the check above).
              if (head > c.y0 && this._shellPush(c, pos, r, head)) moved = touched = true;
              if (c.shell.plan && this._wallsPush(c, pos, r, feet, head, step)) moved = touched = true;
              continue;
            }
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

          // architecture boxes: solid between y0 and y1, stepped onto when the top is within step
          const boxes = cell.boxes;
          for (let i = 0; i < boxes.length; i++) {
            const c = boxes[i];
            if (c.stamp === stamp) continue;
            c.stamp = stamp;
            if (c.passable) continue;
            if (feet >= c.y1 - step || head <= c.y0 + 0.05) continue;
            if (pos.x < c.minX - r || pos.x > c.maxX + r || pos.z < c.minZ - r || pos.z > c.maxZ + r) continue;
            const p = boxPushCircle(c, pos.x, pos.z, r);
            if (!p) continue;
            pos.x += p.x;
            pos.z += p.z;
            const pl = Math.hypot(p.x, p.z) || 1;
            this.pushX += p.x / pl;
            this.pushZ += p.z / pl;
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
              // a ramp plank high enough above the head: walk right under it
              if (c.slab && head <= sy - SLAB) continue;
              const ddx = x - qx;
              const ddz = z - qz;
              const d2 = ddx * ddx + ddz * ddz;
              let nx;
              let nz;
              let push;
              if (d2 <= 1e-10 && c.slab && c.rise && (c.age || 0) >= SLAB_LIFT_AGE) {
                // under the ramp, walking toward its low end: the plank meets the head. Back
                // off uphill (where it is higher) until the head clears it.
                const slope = (c.y1 - c.y0) / Math.max(1e-3, c.maxX - c.minX);
                push = Math.min(0.6, (head - (sy - SLAB)) / Math.max(0.2, slope));
                nx = c.rise[0];
                nz = c.rise[1];
                pos.x += nx * push;
                pos.z += nz * push;
                this.pushX += nx;
                this.pushZ += nz;
                moved = touched = true;
                continue;
              }
              if (d2 > 1e-10) {
                if (d2 >= r * r) continue;
                const d = Math.sqrt(d2);
                nx = ddx / d;
                nz = ddz / d;
                push = r - d;
              } else {
                // centre is inside the footprint below the surface: the wedge was built around
                // this actor. No sideways shove (that went through an adjacent wall);
                // groundHeight() lifts the actor onto the surface instead, like Fortnite.
                continue;
              }
              pos.x += nx * push;
              pos.z += nz * push;
              this.pushX += nx;
              this.pushZ += nz;
              moved = touched = true;
              continue;
            }
            c.stamp = stamp;
            // a wall whose top is within step height of the feet is stepped over (the top of a
            // ramp meeting a wall on its high edge, which used to leave a lip you had to jump)
            if (feet >= c.y1 - step || head <= c.y0 + 0.05) continue;
            // an edited wall (door / window) blocks with one segment per solid run of tiles,
            // each with its own [y0, y1]: s = [ax, az, bx, bz, y0, y1]
            const segs = c.segs;
            const ns = segs ? segs.length : 1;
            for (let si = 0; si < ns; si++) {
              const s = segs ? segs[si] : c.seg;
              if (segs && (feet >= s[5] - step || head <= s[4] + 0.05)) continue;
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
    // building wall hits: which edge / fraction (outer face or inner ring) or interior panel
    let edgeT = -1;
    let edgeE = -1;
    let edgeU = 0;
    let wallT = -1;
    let wallPanel = null;
    let slabT = -1; // upper-floor slab hit (top or underside) and its floor tile, if breakable
    let slabPanel = null;
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
        const h = this.surfaceHeight(ox, oz);
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
              const d = oy + dy * t - this.surfaceHeight(ox + dx * t, oz + dz * t);
              if (gD > 0 && d <= 0) {
                // crossed between gT (above) and t (below): bisect, then interpolate
                let a = gT;
                let da = gD;
                let b = t;
                let db = d;
                for (let k = 0; k < 4; k++) {
                  const m = (a + b) * 0.5;
                  const dm = oy + dy * m - this.surfaceHeight(ox + dx * m, oz + dz * m);
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
            if (c.shell && y < c.shell.doorTop && this._inDoor(c.shell, b, u)) continue; // through a door
            if (c.shell && c.shell.dead && this._deadAt(c.shell, b, u, y)) continue; // through a broken panel
            best = t;
            found = true;
            if (c.shell) {
              edgeT = t;
              edgeE = b;
              edgeU = u;
            }
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
          if (c.shell && !flat && this._rayBox(c, ox, oz, dx, dz, best)) {
            // hollow building: the inner face of the outer wall (so shots from inside hit the
            // visible face) and the interior partitions
            const s = c.shell;
            const I = s.inner;
            for (let a = 0, b = n - 1; a < n; b = a++) {
              const ax = I[b * 2];
              const az = I[b * 2 + 1];
              const ex = I[a * 2] - ax;
              const ez = I[a * 2 + 1] - az;
              const den = dx * ez - dz * ex;
              if (den > -1e-9 && den < 1e-9) continue;
              const wx = ax - ox;
              const wz = az - oz;
              const t = (wx * ez - wz * ex) / den;
              if (t <= 1e-4 || t >= best) continue;
              const u = (wx * dz - wz * dx) / den;
              if (u < 0 || u > 1) continue;
              const y = oy + dy * t;
              if (y < s.floor || y > s.ceil) continue;
              if (y < s.doorTop && this._inDoor(s, b, u)) continue;
              if (s.dead && this._deadAt(s, b, u, y)) continue;
              best = t;
              found = true;
              edgeT = t;
              edgeE = b;
              edgeU = u;
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
            if (s.plan) {
              const levels = s.plan.levels;
              for (let li = 0; li < levels.length; li++) {
                const W = levels[li].walls;
                const meta = levels[li].wallMeta;
                const on = s.wallOn[li];
                for (let k = 0, w = 0; k < W.length; k += 7, w++) {
                  if (!on[w]) continue;
                  const ax = W[k];
                  const az = W[k + 1];
                  const ex = W[k + 2] - ax;
                  const ez = W[k + 3] - az;
                  const den = dx * ez - dz * ex;
                  if (den > -1e-9 && den < 1e-9) continue;
                  const l = Math.sqrt(ex * ex + ez * ez);
                  if (l < 1e-6) continue;
                  const r = W[k + 4];
                  const pnx = -ez / l;
                  const pnz = ex / l;
                  // solid runs are drawn r past their ends (the capsule's reach); lintels exactly span the door
                  const m = meta[w].kind === 'wall' ? r / l : 0;
                  for (let side = -1; side <= 1; side += 2) {
                    const wx = ax + pnx * r * side - ox;
                    const wz = az + pnz * r * side - oz;
                    const t = (wx * ez - wz * ex) / den;
                    if (t <= 1e-4 || t >= best) continue;
                    const u = (wx * dz - wz * dx) / den;
                    if (u < -m || u > 1 + m) continue;
                    const y = oy + dy * t;
                    if (y < W[k + 5] || y > W[k + 6]) continue;
                    best = t;
                    found = true;
                    wallT = t;
                    wallPanel = meta[w].panel >= 0 ? s.panels[meta[w].panel] : null;
                    let nx = pnx;
                    let nz = pnz;
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
                }
                // furniture that stops bullets / sight (never a breakable panel)
                const P = levels[li].props;
                if (P) {
                  const t = this._rayProps(P, levels[li].propBlock, ox, oy, oz, dx, dy, dz, best);
                  if (t > 0) {
                    best = t;
                    found = true;
                    out.nx = this._pnx;
                    out.ny = this._pny;
                    out.nz = this._pnz;
                    out.collider = c;
                    out.kind = c.kind;
                  }
                }
              }
            }
          }
          if (c.shell?.plan) {
            const plan = c.shell.plan;
            const surfaceHit = (t, nx, ny, nz) => {
              if (!(t > 1e-4 && t < best)) return;
              best = t; found = true;
              out.nx=nx; out.ny=ny; out.nz=nz; out.collider=c; out.kind=c.kind;
            };
            if (Math.abs(dy)>1e-9) for (const L of plan.levels) {
              if (!L.i) continue;
              for (const sy of [L.y,L.y-FLOOR_THICKNESS]) {
                const t=(sy-oy)/dy,x=ox+dx*t,z=oz+dz*t;
                if (pointInPoly(c.shell.inner,c.n,x,z)&&!this._slabOpen(c.shell,L,x,z)) { const was=best; surfaceHit(t,0,dy<0?1:-1,0); if (best!==was) { slabT=best; slabPanel=this._tileAt(c.shell,L,x,z); } }
              }
            }
            for (const stair of plan.stairs) {
              const ex=stair.x1-stair.x0,ez=stair.z1-stair.z0,len2=ex*ex+ez*ez;
              const rise=stair.y1-stair.y0,gx=rise*ex/len2,gz=rise*ez/len2;
              const den=dy-gx*dx-gz*dz;
              if(Math.abs(den)<1e-9)continue;
              for(const thickness of [0,FLOOR_THICKNESS]) {
                const t=(stair.y0-thickness-oy+gx*(ox-stair.x0)+gz*(oz-stair.z0))/den;
                if(!Number.isFinite(stairHeight(stair,ox+dx*t,oz+dz*t)))continue;
                const len=Math.hypot(gx,1,gz),side=den<0?1:-1;
                surfaceHit(t,-gx/len*side,1/len*side,-gz/len*side);
              }
            }
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
            // enterable building: from below its interior ceiling a ray can only meet the
            // ceiling (going up) or the floor (going down; the ground handles that)
            const inside = c.shell && oy < c.shell.ceil + 1e-3;
            if (inside && dy < 0) continue;
            const t = ((inside ? c.shell.ceil : c.h) - oy) / dy;
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

        // ---- architecture boxes (any direction, including straight down / up)
        const boxes = cell.boxes;
        for (let i = 0; i < boxes.length; i++) {
          const c = boxes[i];
          if (c.stamp === stamp || c === ignore) continue;
          c.stamp = stamp;
          if (c.noRay) continue; // drivable cars: shots / sight lines are traced by Vehicles (windows)
          const h = boxRay(c, ox, oy, oz, dx, dy, dz, 1e-4, best);
          if (!h) continue;
          best = h.t;
          found = true;
          out.nx = h.nx;
          out.ny = h.ny;
          out.nz = h.nz;
          out.collider = c;
          out.kind = c.kind;
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
            const d = oy + dy * t - this.surfaceHeight(ox + dx * t, oz + dz * t);
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
    // building wall hit: edge / fraction (outer face or inner ring) and the panel, for Combat
    out.edge = -1;
    out.u = 0;
    out.panel = null;
    if (best === edgeT) {
      out.edge = edgeE;
      out.u = edgeU;
      out.panel = this.panelAt(out.collider, edgeE, edgeU, out.y);
    } else if (best === wallT) out.panel = wallPanel;
    else if (best === slabT) out.panel = slabPanel;
    return out;
  }

  /**
   * Nearest hit (t in (1e-4, best)) of a ray with the blocking furniture capsules P (stride 7),
   * each treated as its box: spine a->b extended by r at both ends, half-width r, y0..y1.
   * Sides and the top / bottom faces count. Returns t (normal in this._pnx/_pny/_pnz) or -1.
   * block: Uint8Array per capsule (1 = stops rays), or missing (every capsule blocks).
   */
  _rayProps(P, block, ox, oy, oz, dx, dy, dz, best) {
    let hitT = -1;
    for (let k = 0, i = 0; k < P.length; k += 7, i++) {
      if (block && block[i] === 0) continue; // only an explicit 0 lets rays pass (short/missing entries block)
      const ax = P[k];
      const az = P[k + 1];
      let ex = P[k + 2] - ax;
      let ez = P[k + 3] - az;
      const l = Math.sqrt(ex * ex + ez * ez);
      const r = P[k + 4];
      if (l > 1e-6) {
        ex /= l;
        ez /= l;
      } else {
        ex = 1;
        ez = 0;
      }
      // ray in the box frame: s along the spine (from a), n across it
      const rx = ox - ax;
      const rz = oz - az;
      const os = rx * ex + rz * ez;
      const on = rz * ex - rx * ez;
      const ds = dx * ex + dz * ez;
      const dn = dz * ex - dx * ez;
      // slab s in [-r, l + r], slab n in [-r, r]; sS / sN: sign of the entered face's normal
      let sIn = -Infinity;
      let sOut = Infinity;
      let sS = 0;
      if (ds > -1e-12 && ds < 1e-12) {
        if (os < -r || os > l + r) continue;
      } else if (ds > 0) {
        sIn = (-r - os) / ds;
        sOut = (l + r - os) / ds;
        sS = -1;
      } else {
        sIn = (l + r - os) / ds;
        sOut = (-r - os) / ds;
        sS = 1;
      }
      let nIn = -Infinity;
      let nOut = Infinity;
      let sN = 0;
      if (dn > -1e-12 && dn < 1e-12) {
        if (on < -r || on > r) continue;
      } else if (dn > 0) {
        nIn = (-r - on) / dn;
        nOut = (r - on) / dn;
        sN = -1;
      } else {
        nIn = (r - on) / dn;
        nOut = (-r - on) / dn;
        sN = 1;
      }
      const tOut = sOut < nOut ? (sOut < best ? sOut : best) : nOut < best ? nOut : best;
      let tIn = sIn > nIn ? sIn : nIn;
      if (tOut <= 1e-4 || tIn >= tOut) continue;
      const y0 = P[k + 5];
      const y1 = P[k + 6];
      let t = -1;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (tIn > 1e-4) {
        const yIn = oy + dy * tIn;
        if (yIn >= y0 && yIn <= y1) {
          t = tIn;
          if (sIn > nIn) {
            nx = ex * sS;
            nz = ez * sS;
          } else {
            nx = -ez * sN;
            nz = ex * sN;
          }
        }
      } else tIn = 0; // origin above / below the box: only its top / bottom face
      if (t < 0) {
        const yIn = oy + dy * tIn;
        if (dy < -1e-9 && yIn > y1) {
          const tt = (y1 - oy) / dy; // down onto the top face
          if (tt > tIn && tt < tOut) {
            t = tt;
            ny = 1;
          }
        } else if (dy > 1e-9 && yIn < y0) {
          const tt = (y0 - oy) / dy; // up into the underside
          if (tt > tIn && tt < tOut) {
            t = tt;
            ny = -1;
          }
        }
      }
      if (t > 1e-4 && t < best) {
        best = t;
        hitT = t;
        this._pnx = nx;
        this._pny = ny;
        this._pnz = nz;
      }
    }
    return hitT;
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
