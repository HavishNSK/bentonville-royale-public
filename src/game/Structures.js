// BENTONVILLE ROYALE — player-built pieces (wall / floor / ramp / cone).
//
//   const structures = new Structures({ scene, world, fx, sfx });
//   const pl = structures.plan('ramp', actor.pos, actor.heading, actor.pitch);
//   structures.setGhost(pl, 'wood');                  // every frame in build mode; null hides it
//   if (pl.valid && inv.spendMats('wood', BUILD.cost)) structures.place(pl, 'wood', actor);
//   structures.damage(piece, 30, hitPoint);           // true when destroyed
//   structures.update(dt);                            // build-up animation, HP tint and cracks
//
// Grid: BUILD.cell (4 m) cells whose corners sit on multiples of 4 in x/z, and
// BUILD.level (3 m) height steps (level k starts at y = 3k). Floors, ramps and
// cones occupy a cell at a level; walls occupy one cell EDGE at a level. Each
// slot (kind + cell/edge + level) holds at most one piece; a floor, a ramp, a
// cone and four walls can share one cell.
//
// Conventions: pitch > 0 looks up, pitch < 0 looks down. heading 0 = north (-z),
// clockwise. placement.rot is a heading: for ramps the direction the ramp RISES
// toward (always away from the player); for walls 0 = wall runs along x (an
// east-west wall on a z grid line), PI/2 = wall runs along z. Three.js
// rotation.y of the mesh is -rot.
//
// Shape of `piece` (what World.addPiece / resolveCircle / groundHeight /
// ceilingAbove / raycast read):
//   minX, maxX, minZ, maxZ   xz bounds used to bin the piece into world cells
//                            (walls are padded by WALL_PAD so a player circle
//                            touching a wall that lies on a 32 m world-cell
//                            border still finds it)
//   tris    Float32Array, 9 floats per triangle (x,y,z ×3) — ray casts (all kinds)
//   surf(x, z) -> y          walkable surface height (floor, ramp, cone only)
//   seg     [ax, az, bx, bz] blocking segment (walls only), with
//   y0, y1                   vertical extent (all kinds)
//   wedge   true for ramps / cones: World treats them as solid from y0 up to
//           surf() for side collision (walk up the low end, blocked by the
//           high sides / back)
//
// Structural support: a piece is grounded when its base is on the ground or it
// rests on / abuts a building or vehicle. When a piece is destroyed by damage,
// every connected group (pieces sharing an edge or face, not just a corner) of
// its former neighbours that no longer reaches a grounded piece collapses.
// plus Structures' own fields: id, kind, mat, level, ci, cj, key, x, y, z (base
// centre), rot, hp, maxHp, owner, isStructure = true. World sets type/alive/stamp.

import * as THREE from 'three';
import { toToon } from '../render/Toon.js';
import { BUILD, MATERIALS, MATERIAL_COLOR, clamp } from '../core/config.js';

const CELL = BUILD.cell;
const LEVEL = BUILD.level;
const HALF = CELL / 2;
const WALL_PAD = 0.6; // >= PLAYER.radius + World WALL_HALF
const WALL_THICK = 0.22;
const FLOOR_THICK = 0.22;
const CONE_PEAK = LEVEL * 0.5; // cone rises 1.5 m to its apex
const RISE_TIME = 0.26; // visual build-up (seconds)
// Seconds for a fresh piece's HP to grow from START_HP_FRAC to full.
const BUILD_TIME = { wood: 1.6, brick: 2.6, metal: 3.6 };
const START_HP_FRAC = 0.2;
const GHOST_OK = 0x5ec8ff;
const GHOST_BAD = 0xff4848;
const SOUND = { wood: 'build_wood', brick: 'build_stone', metal: 'build_metal' };
// building inside enterable buildings (see fits())
const INSIDE_CEIL_SLACK = 0.35; // a piece may reach this far into the roof slab
const INSIDE_INSET = 0.35; // footprint sample inset (m) from the piece's edges
const _fitPts = new Float64Array(10);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _pale = new THREE.Color(0xd8ecff);

// ------------------------------------------------------------------ geometry

function wallGeometry() {
  const g = new THREE.BoxGeometry(CELL, LEVEL, WALL_THICK);
  g.translate(0, LEVEL / 2, 0);
  return g;
}

function floorGeometry() {
  const g = new THREE.BoxGeometry(CELL, FLOOR_THICK, CELL);
  g.translate(0, -FLOOR_THICK / 2, 0);
  return g;
}

function rampGeometry() {
  // slab rising toward local -z: top surface from (z=+2, y=0) to (z=-2, y=LEVEL)
  const len = Math.hypot(CELL, LEVEL);
  const ang = Math.atan2(LEVEL, CELL);
  const g = new THREE.BoxGeometry(CELL, FLOOR_THICK, len);
  g.translate(0, -FLOOR_THICK / 2, 0);
  g.rotateX(ang);
  g.translate(0, LEVEL / 2, 0);
  return g;
}

function coneGeometry() {
  // four-sided pyramid whose base corners are the cell corners
  const g = new THREE.ConeGeometry(HALF * Math.SQRT2, CONE_PEAK, 4, 1, true);
  g.rotateY(Math.PI / 4);
  g.translate(0, CONE_PEAK / 2, 0);
  return g;
}

const GEOMETRY = { wall: wallGeometry, floor: floorGeometry, ramp: rampGeometry, cone: coneGeometry };

// ------------------------------------------------------------- textures (DOM)

function makeTexture(mat) {
  if (typeof document === 'undefined') return null;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  if (mat === 'wood') {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#e6e6e6' : '#f6f6f6';
      g.fillRect(0, i * 32, S, 32);
      g.fillStyle = '#9a9a9a';
      g.fillRect(0, i * 32 + 30, S, 2);
      g.fillStyle = '#bdbdbd';
      for (let k = 0; k < 6; k++) g.fillRect(((i * 37 + k * 23) % S), i * 32 + 6 + k * 4, 18 + k * 3, 1);
    }
  } else if (mat === 'brick') {
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, S, S);
    for (let r = 0; r < 8; r++) {
      const off = r % 2 ? 16 : 0;
      for (let c = -1; c < 4; c++) {
        g.fillStyle = (r + c) % 3 ? '#fafafa' : '#ececec';
        g.fillRect(c * 32 + off + 1, r * 16 + 1, 30, 14);
      }
    }
  } else {
    g.fillStyle = '#f0f0f0';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#a8a8a8';
    g.lineWidth = 2;
    g.strokeRect(2, 2, S - 4, S - 4);
    g.strokeRect(2, 2, S / 2 - 2, S - 4);
    g.fillStyle = '#9a9a9a';
    for (const [x, y] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8], [S / 2, 8], [S / 2, S - 8]]) {
      g.beginPath();
      g.arc(x, y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Instance-coloured material with a per-instance damage attribute that draws cracks. */
function makeMaterial(kind, mat) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: makeTexture(mat),
    roughness: mat === 'metal' ? 0.45 : 0.85,
    metalness: mat === 'metal' ? 0.55 : 0,
    side: kind === 'cone' ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDmg;\nvarying float vDmg;\nvarying vec2 vCrackUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDmg = aDmg;\nvCrackUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDmg;\nvarying vec2 vCrackUv;\n' +
        'float crackLine(vec2 p, float f, float s){ float w = sin(p.x * f + sin(p.y * f * 0.7 + s) * 2.3) * sin(p.y * f * 1.3 + sin(p.x * f * 0.6 + s * 1.7) * 2.1); return 1.0 - smoothstep(0.0, 0.07, abs(w)); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' +
        'if (vDmg > 0.02) {\n' +
        '  float c = crackLine(vCrackUv, 9.0, 1.3) * step(0.25, vDmg) + crackLine(vCrackUv + 0.37, 15.0, 4.1) * step(0.55, vDmg);\n' +
        '  diffuseColor.rgb *= 1.0 - clamp(c, 0.0, 1.0) * 0.75;\n' +
        '}');
  };
  m.customProgramCacheKey = () => 'structure-crack';
  // cel-shaded; the crack patch hooks <map_fragment>, which MeshToonMaterial also has
  return toToon(m, { dispose: true });
}

// --------------------------------------------------------------- piece shapes

function tris(arr) {
  return new Float32Array(arr);
}

/** Slot key and collision data for a placement. Pure function of the placement. */
function shapeFor(kind, x, y, z, rot) {
  const y0 = y;
  if (kind === 'wall') {
    const alongX = Math.abs(Math.sin(rot)) < 0.5;
    const ax = alongX ? x - HALF : x;
    const bx = alongX ? x + HALF : x;
    const az = alongX ? z : z - HALF;
    const bz = alongX ? z : z + HALF;
    const y1 = y0 + LEVEL;
    return {
      minX: Math.min(ax, bx) - WALL_PAD,
      maxX: Math.max(ax, bx) + WALL_PAD,
      minZ: Math.min(az, bz) - WALL_PAD,
      maxZ: Math.max(az, bz) + WALL_PAD,
      y0,
      y1,
      seg: [ax, az, bx, bz],
      surf: null,
      tris: tris([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az]),
    };
  }
  const x0 = x - HALF;
  const x1 = x + HALF;
  const z0 = z - HALF;
  const z1 = z + HALF;
  const base = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0, seg: null };
  if (kind === 'floor') {
    return {
      ...base,
      y1: y0,
      surf: () => y0,
      tris: tris([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z0, x1, y0, z1, x0, y0, z1]),
    };
  }
  if (kind === 'ramp') {
    const dx = Math.round(Math.sin(rot));
    const dz = Math.round(-Math.cos(rot));
    // corner heights: rises toward (dx, dz)
    const h = (cx, cz) => y0 + LEVEL * clamp(((cx - x) * dx + (cz - z) * dz) / CELL + 0.5, 0, 1);
    return {
      ...base,
      y1: y0 + LEVEL,
      wedge: true, // World.resolveCircle: solid from y0 up to the surface
      surf: (px, pz) => h(px, pz),
      tris: tris([
        x0, h(x0, z0), z0, x1, h(x1, z0), z0, x1, h(x1, z1), z1,
        x0, h(x0, z0), z0, x1, h(x1, z1), z1, x0, h(x0, z1), z1,
      ]),
    };
  }
  // cone
  const py = y0 + CONE_PEAK;
  return {
    ...base,
    y1: py,
    wedge: true,
    surf: (px, pz) => y0 + CONE_PEAK * clamp(1 - Math.max(Math.abs(px - x), Math.abs(pz - z)) / HALF, 0, 1),
    tris: tris([
      x0, y0, z0, x1, y0, z0, x, py, z,
      x1, y0, z0, x1, y0, z1, x, py, z,
      x1, y0, z1, x0, y0, z1, x, py, z,
      x0, y0, z1, x0, y0, z0, x, py, z,
    ]),
  };
}

/** Two pieces are connected when their bounds share at least an edge (a corner touch does not count). */
function connected(a, b) {
  const E = 0.05;
  const ex = Math.min(a.bx1, b.bx1) - Math.max(a.bx0, b.bx0);
  const ey = Math.min(a.by1, b.by1) - Math.max(a.by0, b.by0);
  const ez = Math.min(a.bz1, b.bz1) - Math.max(a.bz0, b.bz0);
  if (ex < -E || ey < -E || ez < -E) return false;
  return ex > 0.5 || ey > 0.5 || ez > 0.5;
}

function slotKey(kind, x, y, z, rot) {
  const k = Math.round(y / LEVEL);
  if (kind === 'wall') {
    const alongX = Math.abs(Math.sin(rot)) < 0.5;
    // edge id by its midpoint on the half-cell lattice
    return `w${Math.round(x * 2 / CELL)},${Math.round(z * 2 / CELL)},${k},${alongX ? 'x' : 'z'}`;
  }
  return `${kind[0]}${Math.floor(x / CELL)},${Math.floor(z / CELL)},${k}`;
}

// =================================================================== Structures

export class Structures {
  constructor({ scene, world, fx = null, sfx = null }) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sfx = sfx;
    this.pieces = []; // live pieces, placement order
    this.slots = new Map(); // slot key -> piece
    this._nextId = 1;
    this._time = 0;
    this._grid = new Map(); // "ci,cj" -> Set of pieces whose bounds touch that build cell
    this.collapsed = 0; // pieces destroyed by losing support (stats / QA)

    this.group = new THREE.Group();
    this.group.name = 'structures';
    if (scene) scene.add(this.group);

    // one InstancedMesh per kind × material
    this.batches = {};
    for (const kind of BUILD.pieces) {
      const geo = GEOMETRY[kind]();
      for (const mat of MATERIALS) {
        const g = geo.clone();
        const dmg = new THREE.InstancedBufferAttribute(new Float32Array(BUILD.maxPieces), 1);
        dmg.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aDmg', dmg);
        const mesh = new THREE.InstancedMesh(g, makeMaterial(kind, mat), BUILD.maxPieces);
        mesh.name = `build-${kind}-${mat}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, _c.set(MATERIAL_COLOR[mat]));
        mesh.count = 0;
        mesh.visible = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // instances span the map; bounds would be stale
        this.group.add(mesh);
        this.batches[kind + ':' + mat] = { mesh, dmg, list: [], dirty: false };
      }
      geo.dispose();
    }

    // ghosts: one translucent mesh + outline per kind
    this.ghostMat = new THREE.MeshBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.ghostLineMat = new THREE.LineBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.9 });
    this.ghosts = {};
    for (const kind of BUILD.pieces) {
      const geo = GEOMETRY[kind]();
      const mesh = new THREE.Mesh(geo, this.ghostMat);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), this.ghostLineMat));
      mesh.visible = false;
      mesh.renderOrder = 10;
      mesh.name = `build-ghost-${kind}`;
      this.group.add(mesh);
      this.ghosts[kind] = mesh;
    }
    this.ghost = null; // currently shown placement
  }

  get count() {
    return this.pieces.length;
  }

  // ---------------------------------------------------------------- planning

  /**
   * Snap a piece in front of an actor. pos = feet. Returns a placement
   * { kind, x, y, z, rot, valid, level, key } — x/z are the piece's base
   * centre (cell centre, or edge midpoint for walls), y its base height.
   */
  plan(kind, pos, heading, pitch = 0, out = {}) {
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const kBase = Math.max(0, Math.floor(pos.y / LEVEL + 0.34));
    let k = kBase;
    let x;
    let z;
    let rot = 0;

    if (kind === 'wall') {
      // nearest grid line in front of the player along the dominant axis
      if (Math.abs(fx) >= Math.abs(fz)) {
        const lineX = fx > 0 ? Math.ceil((pos.x + 0.5) / CELL) * CELL : Math.floor((pos.x - 0.5) / CELL) * CELL;
        const tz = pos.z + fz * Math.abs((lineX - pos.x) / (fx || 1e-6));
        x = lineX;
        z = (Math.floor(clamp(tz, pos.z - CELL, pos.z + CELL) / CELL) + 0.5) * CELL;
        rot = Math.PI / 2;
      } else {
        const lineZ = fz > 0 ? Math.ceil((pos.z + 0.5) / CELL) * CELL : Math.floor((pos.z - 0.5) / CELL) * CELL;
        const tx = pos.x + fx * Math.abs((lineZ - pos.z) / (fz || 1e-6));
        z = lineZ;
        x = (Math.floor(clamp(tx, pos.x - CELL, pos.x + CELL) / CELL) + 0.5) * CELL;
        rot = 0;
      }
      if (pitch > 0.6) k += 1;
      else if (pitch < -0.6) k -= 1;
    } else {
      // floor / ramp / cone: the cell ahead, or the own cell when looking steeply down (up for cones)
      const own = kind === 'cone' ? pitch > 0.75 : pitch < -0.9;
      const reach = own ? 0 : CELL * 0.8;
      x = (Math.floor((pos.x + fx * reach) / CELL) + 0.5) * CELL;
      z = (Math.floor((pos.z + fz * reach) / CELL) + 0.5) * CELL;
      if (kind === 'ramp') {
        rot = (Math.round(heading / (Math.PI / 2)) * Math.PI) / 2;
        if (pitch < -0.6 && !own) k -= 1;
      } else if (kind === 'floor') {
        if (pitch > 0.45) k += 1;
      } else if (own || pitch > 0.2) {
        k += 1; // cone as a roof
      }
    }
    k = Math.max(0, k);
    rot = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    out.kind = kind;
    out.x = x;
    out.y = k * LEVEL;
    out.z = z;
    out.rot = rot;
    out.level = k;
    out.key = slotKey(kind, x, out.y, z, rot);
    out.valid = this._valid(out);
    return out;
  }

  _valid(pl) {
    if (this.pieces.length >= BUILD.maxPieces) return false;
    if (this.slots.has(pl.key)) return false;
    return this.fits(pl);
  }

  /**
   * World rules only (no piece cap / slot check): the host re-checks a client's piece with
   * this, so the client's ghost colour and the host's verdict come from the same test.
   * Outside: not inside a building / vehicle taller than the piece's base (roofs are fine).
   * Inside an enterable building (collider.shell): allowed below the interior ceiling when
   * the piece fits under it and its footprint stays in the walkable interior (clear of the walls).
   */
  fits(pl) {
    const w = this.world;
    if (!w) return true;
    if (!pl || !Number.isFinite(pl.x) || !Number.isFinite(pl.y) || !Number.isFinite(pl.z)) return false;
    if (!w.inBounds(pl.x, pl.z, 2)) return false;
    const c = w.polyAt(pl.x, pl.z);
    if (!(c && c.h > pl.y + 0.5)) return true;
    const s = c.shell;
    if (!s || pl.y >= s.ceil) return false; // solid prism, or the solid upper floors of a tall building
    return this._fitsInside(c, pl);
  }

  /** Does placement pl fit inside hollow building c (under the ceiling, within the outline)? */
  _fitsInside(c, pl) {
    const s = c.shell;
    const top = pl.y + (pl.kind === 'floor' ? 0 : pl.kind === 'cone' ? CONE_PEAK : LEVEL);
    if (top > s.ceil + INSIDE_CEIL_SLACK || pl.y < s.floor - LEVEL * 0.75) return false;
    if (pl.kind === 'floor' && pl.y < s.floor + 0.5) return false; // a floor slab buried in the ground floor
    // footprint samples (inset a little) must all be inside this building's outline
    const w = this.world;
    const pts = _fitPts;
    let n = 0;
    if (pl.kind === 'wall') {
      const ax = Math.abs(Math.cos(pl.rot)) > 0.5; // runs along x
      const e = HALF - INSIDE_INSET;
      pts[n++] = pl.x + (ax ? e : 0);
      pts[n++] = pl.z + (ax ? 0 : e);
      pts[n++] = pl.x - (ax ? e : 0);
      pts[n++] = pl.z - (ax ? 0 : e);
      pts[n++] = pl.x;
      pts[n++] = pl.z;
    } else {
      const e = HALF - INSIDE_INSET;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          pts[n++] = pl.x + sx * e;
          pts[n++] = pl.z + sz * e;
        }
      }
      pts[n++] = pl.x;
      pts[n++] = pl.z;
    }
    // each sample must be in this building's walkable interior: inside the outline AND clear
    // of the wall band (a piece in a doorway or poking through the wall does not count)
    for (let k = 0; k < n; k += 2) {
      const x = pts[k];
      const z = pts[k + 1];
      if (w.polyAt(x, z) !== c) return false;
      if (w.interiorAt && w.interiorAt(x, z) !== c) return false;
    }
    return true;
  }

  /** Show / hide the translucent ghost (blue = valid, red = blocked). `mat` is remembered in this.ghostMaterial. */
  setGhost(placement, mat) {
    for (const k in this.ghosts) {
      if (!placement || k !== placement.kind) this.ghosts[k].visible = false;
    }
    this.ghost = placement || null;
    this.ghostMaterial = mat || null;
    if (!placement) return;
    const g = this.ghosts[placement.kind];
    if (!g) return;
    g.visible = true;
    g.position.set(placement.x, placement.y, placement.z);
    g.rotation.set(0, -placement.rot, 0);
    const col = placement.valid ? GHOST_OK : GHOST_BAD;
    this.ghostMat.color.setHex(col);
    this.ghostLineMat.color.setHex(col);
  }

  // ----------------------------------------------------------------- placing

  /** Compact list of live pieces for the host to broadcast. */
  exportNet() {
    const out = [];
    for (const p of this.pieces) {
      if (p.alive === false) continue;
      out.push([p.kind, p.mat, p.x, p.y, p.z, Math.round(p.rot * 100), Math.round(p.hp), p.key]);
    }
    return out;
  }

  /** Client: make the local grid match the host's list. */
  importNet(rows) {
    const keep = new Set();
    for (const row of rows || []) {
      const [kind, mat, x, y, z, rot100, hp, key] = row;
      keep.add(key);
      const have = this.slots.get(key);
      if (have) {
        have.hp = Math.max(1, Math.min(have.maxHp, hp));
        continue;
      }
      const piece = this.place({ kind, x, y, z, rot: rot100 / 100, key, level: Math.round(y / 3), valid: true }, mat, null);
      if (piece) {
        piece.hp = hp;
        piece.growing = false;
        piece.age = 99;
      }
    }
    for (const p of this.pieces.slice()) {
      if (!keep.has(p.key)) this.remove(p, false);
    }
  }

  /** Build it. Caller has already checked and spent BUILD.cost mats. */
  place(placement, mat, owner = null) {
    if (!placement || !BUILD.pieces.includes(placement.kind)) return null;
    if (!MATERIALS.includes(mat)) mat = 'wood';
    const key = placement.key || slotKey(placement.kind, placement.x, placement.y, placement.z, placement.rot);
    if (this.pieces.length >= BUILD.maxPieces || this.slots.has(key)) {
      if (this.sfx) this.sfx.play('build_denied');
      return null;
    }
    const { kind, x, y, z, rot } = placement;
    const shape = shapeFor(kind, x, y, z, rot);
    const maxHp = BUILD.hp[mat];
    const piece = {
      id: this._nextId++,
      isStructure: true,
      kind,
      mat,
      level: Math.round(y / LEVEL),
      ci: Math.floor(x / CELL),
      cj: Math.floor(z / CELL),
      key,
      x,
      y,
      z,
      rot,
      ...shape,
      hp: maxHp * START_HP_FRAC,
      maxHp,
      owner,
      age: 0,
      taken: 0,
      growing: true,
      _batch: null,
      _index: -1,
    };
    this._bounds(piece);
    piece.grounded = this._grounded(piece);
    if (this.world) this.world.addPiece(piece);
    this._gridAdd(piece);
    this.slots.set(key, piece);
    this.pieces.push(piece);
    this._addInstance(piece);

    const c = this._center(piece, _p);
    if (this.fx) this.fx.buildPlace(c, this._size(piece, _s), mat);
    if (this.sfx) this.sfx.play(SOUND[mat], { x: c.x, y: c.y, z: c.z });
    return piece;
  }

  /** Apply damage. Returns true when the piece was destroyed. */
  damage(piece, amount, hitPos = null) {
    if (!piece || !piece.alive || !piece.isStructure) return false;
    piece.hp -= amount;
    piece.taken += amount;
    if (piece.hp > 0) {
      this._paint(piece);
      return false;
    }
    this._destroy(piece, hitPos, true);
    this._collapseAround(piece);
    return true;
  }

  /** Is this piece connected (through shared edges) to a grounded piece? */
  isSupported(piece) {
    if (!piece || !piece.alive) return false;
    return this._component(piece, new Set()).grounded;
  }

  /** After `gone` was destroyed: drop every neighbouring group that no longer reaches the ground. */
  _collapseAround(gone) {
    const seen = new Set([gone]);
    let n = 0;
    for (const nb of this._neighbours(gone)) {
      if (seen.has(nb) || !nb.alive) continue;
      const comp = this._component(nb, seen);
      if (comp.grounded) continue;
      for (const p of comp.list) {
        if (!p.alive) continue;
        this._destroy(p, null, true, n < 3); // debris for all, break sound for the first few
        n++;
      }
    }
    this.collapsed += n;
    return n;
  }

  /** Flood fill from `start` over connected live pieces. Stops early once a grounded piece is found. */
  _component(start, seen) {
    const list = [start];
    seen.add(start);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.grounded) return { grounded: true, list };
      for (const nb of this._neighbours(p)) {
        if (seen.has(nb) || !nb.alive) continue;
        seen.add(nb);
        list.push(nb);
      }
    }
    return { grounded: false, list };
  }

  _neighbours(p) {
    const out = [];
    const i0 = Math.floor((p.bx0 - 0.05) / CELL);
    const i1 = Math.floor((p.bx1 + 0.05) / CELL);
    const j0 = Math.floor((p.bz0 - 0.05) / CELL);
    const j1 = Math.floor((p.bz1 + 0.05) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const set = this._grid.get(i + ',' + j);
        if (!set) continue;
        for (const q of set) if (q !== p && q.alive && !out.includes(q) && connected(p, q)) out.push(q);
      }
    }
    return out;
  }

  _gridKeys(p, fn) {
    const i0 = Math.floor((p.bx0 - 0.05) / CELL);
    const i1 = Math.floor((p.bx1 + 0.05) / CELL);
    const j0 = Math.floor((p.bz0 - 0.05) / CELL);
    const j1 = Math.floor((p.bz1 + 0.05) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(i + ',' + j);
  }

  _gridAdd(p) {
    this._gridKeys(p, (k) => {
      let set = this._grid.get(k);
      if (!set) this._grid.set(k, (set = new Set()));
      set.add(p);
    });
  }

  _gridRemove(p) {
    this._gridKeys(p, (k) => {
      const set = this._grid.get(k);
      if (!set) return;
      set.delete(p);
      if (!set.size) this._grid.delete(k);
    });
  }

  /** Tight 3D bounds used for adjacency (walls have zero thickness on their grid line). */
  _bounds(p) {
    if (p.seg) {
      const s = p.seg;
      p.bx0 = Math.min(s[0], s[2]);
      p.bx1 = Math.max(s[0], s[2]);
      p.bz0 = Math.min(s[1], s[3]);
      p.bz1 = Math.max(s[1], s[3]);
    } else {
      p.bx0 = p.minX;
      p.bx1 = p.maxX;
      p.bz0 = p.minZ;
      p.bz1 = p.maxZ;
    }
    p.by0 = p.y0;
    p.by1 = p.y1;
  }

  /** On the ground, or resting on / against a building or vehicle whose top is within a level below the base. */
  _grounded(p) {
    if (p.y0 <= 0.05) return true;
    const w = this.world;
    if (!w || !w.polyAt) return false;
    const lim = p.y0 - LEVEL + 0.01;
    const o = 0.35;
    const pts = p.seg
      ? (() => {
          const s = p.seg;
          const mx = (s[0] + s[2]) / 2;
          const mz = (s[1] + s[3]) / 2;
          const nx = s[3] === s[1] ? 0 : 1; // wall along z -> normal x
          const nz = 1 - nx;
          return [[mx + nx * o, mz + nz * o], [mx - nx * o, mz - nz * o], [s[0], s[1]], [s[2], s[3]]];
        })()
      : [[p.x, p.z], [p.minX - o, p.z], [p.maxX + o, p.z], [p.x, p.minZ - o], [p.x, p.maxZ + o]];
    for (const [x, z] of pts) {
      const c = w.polyAt(x, z);
      if (c && c.h >= lim) return true;
    }
    return false;
  }

  /** Remove a piece without damage (e.g. owner cleanup). */
  remove(piece, effects = false) {
    if (piece && piece.alive) this._destroy(piece, null, effects);
  }

  isPiece(collider) {
    return !!(collider && collider.isStructure && collider.type === 'piece');
  }

  /** Piece occupying a slot, or null (bots: "is there already a wall here"). */
  at(placement) {
    return this.slots.get(placement.key || slotKey(placement.kind, placement.x, placement.y, placement.z, placement.rot)) || null;
  }

  clear() {
    for (const p of this.pieces) {
      if (this.world) this.world.remove(p);
      p.alive = false;
    }
    this.pieces.length = 0;
    this.slots.clear();
    this._grid.clear();
    for (const k in this.batches) {
      const b = this.batches[k];
      b.list.length = 0;
      b.mesh.count = 0;
      b.mesh.visible = false;
    }
    this.setGhost(null);
  }

  // ----------------------------------------------------------------- per frame

  update(dt) {
    this._time += dt;
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      if (!p.growing) continue;
      const before = p.age;
      p.age += dt;
      if (before < RISE_TIME) this._writeMatrix(p);
      const grow = (p.maxHp * (1 - START_HP_FRAC) * dt) / BUILD_TIME[p.mat];
      p.hp = Math.min(p.maxHp, p.hp + grow);
      if (p.age >= BUILD_TIME[p.mat]) p.growing = false;
      this._paint(p);
    }
    for (const k in this.batches) {
      const b = this.batches[k];
      if (!b.dirty) continue;
      b.dirty = false;
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      b.dmg.needsUpdate = true;
    }
  }

  dispose() {
    this.clear();
    for (const k in this.batches) {
      const m = this.batches[k].mesh;
      m.geometry.dispose();
      if (m.material.map) m.material.map.dispose();
      m.material.dispose();
    }
    for (const k in this.ghosts) {
      this.ghosts[k].geometry.dispose();
      this.ghosts[k].children[0].geometry.dispose();
    }
    this.ghostMat.dispose();
    this.ghostLineMat.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  // --------------------------------------------------------------- internals

  _destroy(piece, hitPos, effects, sound = true) {
    if (this.world) this.world.remove(piece);
    if (piece.bx0 !== undefined) this._gridRemove(piece);
    piece.alive = false;
    piece.hp = 0;
    if (this.slots.get(piece.key) === piece) this.slots.delete(piece.key);
    const i = this.pieces.indexOf(piece);
    if (i >= 0) this.pieces.splice(i, 1);
    this._removeInstance(piece);
    if (effects) {
      const c = this._center(piece, _p);
      if (this.fx) {
        this.fx.debris(c, piece.mat, { count: 18, size: 0.4, spread: 2.2 });
        if (hitPos) this.fx.debris(hitPos, piece.mat, { count: 6, size: 0.3, spread: 1.4 });
      }
      if (this.sfx && sound) this.sfx.play('build_break', { x: c.x, y: c.y, z: c.z });
    }
  }

  _center(p, out) {
    if (p.kind === 'wall') return out.set(p.x, p.y + LEVEL / 2, p.z);
    if (p.kind === 'floor') return out.set(p.x, p.y, p.z);
    if (p.kind === 'ramp') return out.set(p.x, p.y + LEVEL / 2, p.z);
    return out.set(p.x, p.y + CONE_PEAK / 2, p.z);
  }

  _size(p, out) {
    if (p.kind === 'wall') {
      const alongX = Math.abs(Math.sin(p.rot)) < 0.5;
      return out.set(alongX ? CELL : WALL_THICK, LEVEL, alongX ? WALL_THICK : CELL);
    }
    if (p.kind === 'floor') return out.set(CELL, FLOOR_THICK, CELL);
    if (p.kind === 'ramp') return out.set(CELL, LEVEL, CELL);
    return out.set(CELL, CONE_PEAK, CELL);
  }

  _addInstance(p) {
    const b = this.batches[p.kind + ':' + p.mat];
    p._batch = b;
    p._index = b.list.length;
    b.list.push(p);
    b.mesh.count = b.list.length;
    b.mesh.visible = true;
    this._writeMatrix(p);
    this._paint(p);
  }

  _removeInstance(p) {
    const b = p._batch;
    if (!b) return;
    const last = b.list.pop();
    if (last !== p) {
      // move the last instance into the hole
      b.list[p._index] = last;
      last._index = p._index;
      this._writeMatrix(last);
      this._paint(last);
    }
    b.mesh.count = b.list.length;
    b.mesh.visible = b.list.length > 0;
    b.dirty = true;
    p._batch = null;
    p._index = -1;
  }

  _writeMatrix(p) {
    const b = p._batch;
    if (!b) return;
    // pop up from the base with a little overshoot
    const t = clamp(p.age / RISE_TIME, 0, 1);
    const k = 1.70158;
    const e = t >= 1 ? 1 : 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
    const sy = Math.max(0.04, e);
    const sxz = 0.85 + 0.15 * Math.min(1, t * 1.4);
    _q.setFromAxisAngle(_up, -p.rot);
    _s.set(sxz, sy, sxz);
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s);
    b.mesh.setMatrixAt(p._index, _m);
    b.dirty = true;
  }

  _paint(p) {
    const b = p._batch;
    if (!b) return;
    // damage taken (not HP still filling up) darkens the piece and draws cracks
    const lost = clamp(p.taken / p.maxHp, 0, 1);
    _c.set(MATERIAL_COLOR[p.mat]);
    // a piece still building reads pale, fading to its true colour
    if (p.growing) _c.lerp(_pale, 0.45 * (1 - clamp(p.age / BUILD_TIME[p.mat], 0, 1)));
    _c.multiplyScalar(1 - 0.45 * lost);
    b.mesh.setColorAt(p._index, _c);
    b.dmg.setX(p._index, lost);
    b.dirty = true;
  }
}
