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
//   slab    ramps only: a thin plank instead of a solid wedge (World walks you up it
//           from the low end, lets you walk UNDER it where it is above your head);
//           rise = [dx, dz] uphill direction
//
// Vertical grid: one global lattice (y = 3k, k may be negative) so neighbouring pieces
// line up. A piece planned from the terrain snaps to the ground level of its own cell
// (see _groundLevel), and a placement is only valid when it is supported: resting on the
// terrain / a building, or sharing an edge with a live piece (which is itself supported,
// because unsupported groups collapse).
//
// Editing: piece.edit is a bitmask of REMOVED tiles — walls 3x3 (bit = row*3 + col, row 0
// at the bottom, col 0 at local -x), floors 2x2 (bit = qi + 2*qj, local -x/-z first), cones
// one bit per sloped face (0 = -z, 1 = +x, 2 = +z, 3 = -x). Ramps have no tiles; editing a
// ramp turns it (mask = quarter turns, 0..3). Edited walls add `segs` ([ax,az,bx,bz,y0,y1]
// per solid run) for World collision; tris / surf leave the removed tiles open.
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
const DOOR_TIME = 0.25; // door swing (seconds)
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
const TILE_W = CELL / 3; // wall tile width
const TILE_H = LEVEL / 3; // wall tile height
// Edited walls / floors render one instance per remaining tile; edited cones are reshaped
// (one shared geometry per edit mask, see coneEditGeometry).
const TILE_COUNT = { wall: 9, floor: 4, cone: 0, ramp: 0 };
const TILE_KINDS = ['wall', 'floor'];
// Edit grids (what the player clicks): ramps get a 2x2 grid too; dragging across it turns the ramp.
const EDIT_GRID = { wall: 9, floor: 4, cone: 4, ramp: 4 };
const EDIT_KINDS = ['wall', 'floor', 'cone', 'ramp'];
const RAMP_LEN = Math.hypot(CELL, LEVEL);
const RAMP_ANG = Math.atan2(LEVEL, CELL);
// Ground snapping: the ground level of a cell is the highest grid level whose base is at
// most GROUND_SNAP * LEVEL (0.3 m) above the terrain there (slopes bury a piece rather than float it).
const GROUND_SNAP = 0.1;
// A piece whose base is within this of the terrain (anywhere under it) rests on the ground.
const GROUND_TOL = 0.75;
// Feet this close to the terrain count as "standing on the ground" for planning.
const ON_GROUND = 0.6;
/** The level grid's offset (0..LEVEL) for a surface at height y, to the cm. */
function levelPhase(y) {
  if (!Number.isFinite(y)) return 0;
  const m = Math.round((((y % LEVEL) + LEVEL) % LEVEL) * 100) / 100;
  return m >= LEVEL - 0.01 ? 0 : m;
}
// A piece may start this far below a roof top and clip into it: roofs are not on the 3 m grid,
// so on a 4 m roof the nearest level (3 m) would otherwise always be refused.
const ROOF_CLIP = LEVEL * 0.5;
const EDIT_OK = 0x5ec8ff;
const EDIT_GONE = 0xbfe6ff; // selected tiles read as open frames, like the cut they make
const EDIT_HOVER = 0xffffff;
const EDIT_PENDING = 0xffb340; // selected tiles while the selection is not a valid shape

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _pale = new THREE.Color(0xd8ecff);
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _cDoor = new THREE.Color();

// ------------------------------------------------------------------ geometry

function wallGeometry() {
  const g = new THREE.BoxGeometry(CELL, LEVEL, WALL_THICK);
  g.translate(0, LEVEL / 2, 0);
  return g;
}

// Floor tops sit FLOOR_LIFT above their level: a ground-level floor would otherwise share a
// plane with the ground (y = 0) and flicker against it (z-fighting). Collision is unchanged.
const FLOOR_LIFT = 0.02;

function floorGeometry() {
  const g = new THREE.BoxGeometry(CELL, FLOOR_THICK, CELL);
  g.translate(0, -FLOOR_THICK / 2 + FLOOR_LIFT, 0);
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

// ---- cone edits (Fortnite style): a 2x2 grid of quarters; each selected quarter raises its
// outer corner a full level (LEVEL). Corners k = 0..3 are (-x,-z), (+x,-z), (+x,+z), (-x,+z);
// corner k belongs to quarter CONE_CORNER_Q[k] (quarter q = qi + 2*qj, as for floors).
const CONE_CORNER_Q = [0, 1, 3, 2];
const CONE_CORNER_XZ = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

/** Corner heights [4] and centre height of a cone edited with `mask` (0 = the plain pyramid). */
function coneHeights(mask) {
  // a raised corner goes up a full level, so two raised quarters make a slope exactly as tall
  // as a ramp (the plain cone's peak stays at CONE_PEAK)
  const hk = CONE_CORNER_Q.map((q) => (mask & (1 << q) ? LEVEL : 0));
  const hc = mask ? (hk[0] + hk[1] + hk[2] + hk[3]) / 4 : CONE_PEAK;
  return { hk, hc };
}

/** Render geometry of an edited cone: four triangles, each side edge to the centre. */
function coneEditGeometry(mask) {
  const { hk, hc } = coneHeights(mask);
  const pos = [];
  const uv = [];
  for (let f = 0; f < 4; f++) {
    const a = f;
    const b = (f + 1) % 4;
    pos.push(CONE_CORNER_XZ[a][0] * HALF, hk[a], CONE_CORNER_XZ[a][1] * HALF, CONE_CORNER_XZ[b][0] * HALF, hk[b], CONE_CORNER_XZ[b][1] * HALF, 0, hc, 0);
    uv.push(0, 0, 1, 0, 0.5, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Edit-overlay quarter of a plain cone (the -x,-z one), laid on its two sloped faces. */
function coneQuarterGeometry() {
  const P = CONE_PEAK;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-HALF, 0, -HALF, 0, 0, -HALF, 0, P, 0, -HALF, 0, -HALF, 0, P, 0, -HALF, 0, 0], 3));
  g.computeVertexNormals();
  return g;
}

// ---- wall edits: any tile selection is allowed (except all 9). Tile bit = row * 3 + col,
// row 0 at the bottom, col 0 at local -x.

/**
 * Door columns of a wall edit (bit c set): B and M of column c removed, its top tile kept
 * (the lintel), and the bottom tile of each neighbouring column kept. Doors, window doors and
 * double doors qualify; arches, half arches and half-wall doors are plain openings.
 */
export function doorColumns(edit) {
  if (!edit) return 0;
  let out = 0;
  for (let c = 0; c < 3; c++) {
    const b = 1 << c;
    const m = 1 << (3 + c);
    const t = 1 << (6 + c);
    if (!(edit & b) || !(edit & m) || edit & t) continue;
    if (c > 0 && edit & (1 << (c - 1))) continue;
    if (c < 2 && edit & (1 << (c + 1))) continue;
    out |= 1 << c;
  }
  return out;
}

/** Geometry of one tile of an edited piece, centred on its local tile origin (see TILE_LOCAL). */
const TILE_GEOMETRY = {
  wall: (s = 1, t = 1) => new THREE.BoxGeometry(TILE_W * s, TILE_H * s, WALL_THICK * t),
  floor: (s = 1, t = 1) => new THREE.BoxGeometry(HALF * s, FLOOR_THICK * t, HALF * s).translate(0, (-FLOOR_THICK * t) / 2 + FLOOR_LIFT, 0),
  cone: () => coneQuarterGeometry(), // edit overlay only
  // edit overlay only: a quarter of the ramp slab, laid on the slope
  ramp: (s = 1, t = 1) =>
    new THREE.BoxGeometry(HALF * s, FLOOR_THICK * t, ((HALF * RAMP_LEN) / CELL) * s).translate(0, (-FLOOR_THICK * t) / 2, 0).rotateX(RAMP_ANG),
};

/** Local matrix of each tile relative to its piece's base transform. */
const TILE_LOCAL = {
  wall: Array.from({ length: 9 }, (_, t) => new THREE.Matrix4().makeTranslation(((t % 3) - 1) * TILE_W, (Math.floor(t / 3) + 0.5) * TILE_H, 0)),
  floor: Array.from({ length: 4 }, (_, q) => new THREE.Matrix4().makeTranslation(((q & 1) - 0.5) * HALF, 0, ((q >> 1) - 0.5) * HALF)),
  // cone quarters (overlay only): the (-x,-z) quarter mirrored into place
  cone: Array.from({ length: 4 }, (_, q) => new THREE.Matrix4().makeScale(q & 1 ? -1 : 1, 1, q >> 1 ? -1 : 1)),
  // ramp quarters (overlay only), on the slope that rises toward local -z
  ramp: Array.from({ length: 4 }, (_, q) => {
    const zc = ((q >> 1) - 0.5) * HALF;
    return new THREE.Matrix4().makeTranslation(((q & 1) - 0.5) * HALF, LEVEL * (0.5 - zc / CELL), zc);
  }),
};

/**
 * Ramp edit (Fortnite style): drag across the 2x2 grid from tile `a` to a side-neighbour tile
 * `b` and the ramp rises in that direction. Returns the new quarter-turn index, or -1.
 */
export function rampDragQuarter(rot, a, b) {
  if (a < 0 || b < 0 || a === b) return -1;
  const di = (b & 1) - (a & 1);
  const dj = (b >> 1) - (a >> 1);
  if (di !== 0 && dj !== 0) return -1; // diagonal drags do nothing
  // local direction -> quarter turns from the ramp's current heading (local -z = 0, +x = 1, +z = 2, -x = 3)
  const lq = dj < 0 ? 0 : di > 0 ? 1 : dj > 0 ? 2 : 3;
  return (rampQuarter(rot) + lq) % 4;
}

/**
 * Is `mask` a legal edit for a piece of this kind? Walls: any tiles but all nine. Floors: any
 * quarters but all four. Cones: any raised quarters but all four. Ramps: a quarter-turn index.
 */
export function validEdit(kind, mask) {
  if (!Number.isInteger(mask) || mask < 0) return false;
  if (kind === 'ramp') return mask < 4;
  if (kind === 'wall') return mask < 0x1ff; // any selection, just not every tile
  if (kind === 'floor' || kind === 'cone') return mask < 15;
  return false;
}

/** Cone face under local offset (dx, dz): 0 = -z, 1 = +x, 2 = +z, 3 = -x. */
function coneFace(dx, dz) {
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 0 : 2;
  return dx > 0 ? 1 : 3;
}

/** Ramp quarter-turn index of a rot (0..3). */
function rampQuarter(rot) {
  return ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4;
}

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
    // a small pull toward the camera: far-away floors lying 2 cm over the ground stay clear of
    // it even where the depth buffer is too coarse to tell them apart
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDmg;\nvarying float vDmg;\nvarying vec2 vCrackUv;')
      // World-space texture mapping (one texture per 4 m x 3 m of wall, 4 m x 4 m of floor):
      // an edited piece is drawn as separate tiles, and with per-tile UVs every tile repeated
      // the whole texture (a 3x3 grid of mini planks / bricks). Mapping by world position keeps
      // the pattern continuous across tiles and neighbouring pieces, and unstretched on edges.
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDmg = aDmg;\nvCrackUv = uv;\n' +
        '#ifdef USE_INSTANCING\n' +
        '  vec4 sWp = modelMatrix * instanceMatrix * vec4(position, 1.0);\n' +
        '  vec3 sWn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);\n' +
        '  vec2 sUv = abs(sWn.y) > 0.5 ? sWp.xz / ' + CELL.toFixed(1) + ' : (abs(sWn.x) > abs(sWn.z) ? vec2(sWp.z / ' + CELL.toFixed(1) + ', sWp.y / ' + LEVEL.toFixed(1) + ') : vec2(sWp.x / ' + CELL.toFixed(1) + ', sWp.y / ' + LEVEL.toFixed(1) + '));\n' +
        '  vCrackUv = sUv;\n' +
        '  #ifdef USE_MAP\n    vMapUv = sUv;\n  #endif\n' +
        '#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDmg;\nvarying vec2 vCrackUv;\n' +
        'float crackLine(vec2 p, float f, float s){ float w = sin(p.x * f + sin(p.y * f * 0.7 + s) * 2.3) * sin(p.y * f * 1.3 + sin(p.x * f * 0.6 + s * 1.7) * 2.1); return 1.0 - smoothstep(0.0, 0.07, abs(w)); }')
      .replace('#include <map_fragment>', '#include <map_fragment>\n' +
        'if (vDmg > 0.02) {\n' +
        '  float c = crackLine(vCrackUv, 9.0, 1.3) * step(0.25, vDmg) + crackLine(vCrackUv + 0.37, 15.0, 4.1) * step(0.55, vDmg);\n' +
        '  diffuseColor.rgb *= 1.0 - clamp(c, 0.0, 1.0) * 0.75;\n' +
        '}');
  };
  m.customProgramCacheKey = () => 'structure-crack-worlduv';
  // cel-shaded; the crack patch hooks <map_fragment>, which MeshToonMaterial also has
  return toToon(m, { dispose: true });
}

// --------------------------------------------------------------- piece shapes

function tris(arr) {
  return new Float32Array(arr);
}

/** Slot key and collision data for a placement. Pure function of the placement. */
function shapeFor(kind, x, y, z, rot, edit = 0, doors = null) {
  const y0 = y;
  if (kind === 'wall') {
    const alongX = Math.abs(Math.sin(rot)) < 0.5;
    const ax = alongX ? x - HALF : x;
    const bx = alongX ? x + HALF : x;
    const az = alongX ? z : z - HALF;
    const bz = alongX ? z : z + HALF;
    const y1 = y0 + LEVEL;
    const out = {
      minX: Math.min(ax, bx) - WALL_PAD,
      maxX: Math.max(ax, bx) + WALL_PAD,
      minZ: Math.min(az, bz) - WALL_PAD,
      maxZ: Math.max(az, bz) + WALL_PAD,
      y0,
      y1,
      seg: [ax, az, bx, bz], // full extent (bounds / support); World uses segs when present
      segs: null,
      wedge: false,
      surf: null,
      tris: null,
    };
    if (!edit) {
      out.tris = tris([ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az]);
      return out;
    }
    // solid tiles only; one collision segment per vertical run of solid tiles in a column.
    // A closed door fills its column's bottom two tiles (blocks movement and shots).
    const dc = doorColumns(edit);
    for (let c = 0; c < 3; c++) if (dc & (1 << c) && !(doors && doors[c])) edit &= ~((1 << c) | (1 << (3 + c)));
    const ux = alongX ? 1 : 0;
    const uz = alongX ? 0 : 1;
    const t = [];
    const segs = [];
    for (let c = 0; c < 3; c++) {
      const u0 = -HALF + c * TILE_W;
      const u1 = u0 + TILE_W;
      const sx0 = x + ux * u0;
      const sz0 = z + uz * u0;
      const sx1 = x + ux * u1;
      const sz1 = z + uz * u1;
      let run = -1;
      for (let r = 0; r <= 3; r++) {
        const solid = r < 3 && !(edit & (1 << (r * 3 + c)));
        if (solid) {
          const ya = y0 + r * TILE_H;
          const yb = ya + TILE_H;
          t.push(sx0, ya, sz0, sx1, ya, sz1, sx1, yb, sz1, sx0, ya, sz0, sx1, yb, sz1, sx0, yb, sz0);
          if (run < 0) run = r;
        } else if (run >= 0) {
          segs.push([sx0, sz0, sx1, sz1, y0 + run * TILE_H, y0 + r * TILE_H]);
          run = -1;
        }
      }
    }
    out.tris = tris(t);
    out.segs = segs;
    return out;
  }
  const x0 = x - HALF;
  const x1 = x + HALF;
  const z0 = z - HALF;
  const z1 = z + HALF;
  const base = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0, seg: null, segs: null, wedge: false };
  if (kind === 'floor') {
    if (!edit) {
      return {
        ...base,
        y1: y0,
        surf: () => y0,
        tris: tris([x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z0, x1, y0, z1, x0, y0, z1]),
      };
    }
    const t = [];
    for (let q = 0; q < 4; q++) {
      if (edit & (1 << q)) continue;
      const qa = (q & 1) ? x : x0;
      const qb = qa + HALF;
      const qc = (q >> 1) ? z : z0;
      const qd = qc + HALF;
      t.push(qa, y0, qc, qb, y0, qc, qb, y0, qd, qa, y0, qc, qb, y0, qd, qa, y0, qd);
    }
    return {
      ...base,
      y1: y0,
      // holes in removed quarters: nothing to stand on there
      surf: (px, pz) => ((edit & (1 << ((px < x ? 0 : 1) + (pz < z ? 0 : 2)))) ? -Infinity : y0),
      tris: tris(t),
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
      wedge: true,
      slab: true, // World: a thin plank you can walk under, not a solid wedge
      rise: [dx, dz],
      surf: (px, pz) => h(px, pz),
      tris: tris([
        x0, h(x0, z0), z0, x1, h(x1, z0), z0, x1, h(x1, z1), z1,
        x0, h(x0, z0), z0, x1, h(x1, z1), z1, x0, h(x0, z1), z1,
      ]),
    };
  }
  // cone: four triangles, side edge f (corners f, f+1) to the centre; an edit raises corners
  const { hk, hc } = coneHeights(edit);
  const cx = (k) => x + CONE_CORNER_XZ[k][0] * HALF;
  const cz = (k) => z + CONE_CORNER_XZ[k][1] * HALF;
  const t = [];
  for (let f = 0; f < 4; f++) {
    const b = (f + 1) % 4;
    t.push(cx(f), y0 + hk[f], cz(f), cx(b), y0 + hk[b], cz(b), x, y0 + hc, z);
  }
  // face under (px, pz): coneFace gives the side (0 = -z, 1 = +x, 2 = +z, 3 = -x), which is
  // the triangle of corners (f, f+1) in CONE_CORNER_XZ order
  const surf = (px, pz) => {
    const dx = clamp((px - x) / HALF, -1, 1);
    const dz = clamp((pz - z) / HALF, -1, 1);
    const f = coneFace(dx, dz);
    const a = f;
    const b = (f + 1) % 4;
    // barycentric in the triangle (A, B, centre) in unit coordinates
    const ax = CONE_CORNER_XZ[a][0];
    const az = CONE_CORNER_XZ[a][1];
    const bx = CONE_CORNER_XZ[b][0];
    const bz = CONE_CORNER_XZ[b][1];
    const det = ax * bz - bx * az;
    const wa = (dx * bz - bx * dz) / det;
    const wb = (ax * dz - dx * az) / det;
    const wc = 1 - wa - wb;
    return y0 + wa * hk[a] + wb * hk[b] + wc * hc;
  };
  return {
    ...base,
    y1: y0 + Math.max(hc, ...hk),
    wedge: true,
    surf,
    tris: tris(t),
  };
}

/** Nearest ray hit (t) against a flat triangle list, or Infinity. */
function rayTris(tr, ox, oy, oz, dx, dy, dz, maxT) {
  let best = Infinity;
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
    if (t > 0 && t < maxT && t < best) best = t;
  }
  return best;
}

/**
 * The real edges of a piece (Fortnite-style connectivity: two pieces hold each other up only
 * when they share a whole edge). Floor / cone: the 4 base edges. Wall: bottom, top and both
 * sides. Ramp: its low edge, its high edge and the two sloped sides — so a ramp is held by
 * what its low or high edge rests on (a floor, a wall top, the ramp before it), not by a
 * corner that merely touches its bounding box. Returns a Set of canonical edge keys.
 */
function edgeKeys(kind, x, y, z, rot, edit = 0) {
  const out = new Set();
  const pt = (px, py, pz) => Math.round(px * 2) + ',' + Math.round(py * 2) + ',' + Math.round(pz * 2);
  const add = (ax, ay, az, bx, by, bz) => {
    const a = pt(ax, ay, az);
    const b = pt(bx, by, bz);
    out.add(a < b ? a + '|' + b : b + '|' + a);
  };
  if (kind === 'wall') {
    const alongX = Math.abs(Math.sin(rot)) < 0.5;
    const ax = alongX ? x - HALF : x;
    const bx = alongX ? x + HALF : x;
    const az = alongX ? z : z - HALF;
    const bz = alongX ? z : z + HALF;
    const y1 = y + LEVEL;
    add(ax, y, az, bx, y, bz);
    add(ax, y1, az, bx, y1, bz);
    add(ax, y, az, ax, y1, az);
    add(bx, y, bz, bx, y1, bz);
    return out;
  }
  let h = () => y;
  if (kind === 'cone' && edit) {
    // an edited cone's edges follow its raised corners (corner order matches cs below)
    const { hk } = coneHeights(edit);
    // corners: 0 = (-x,-z), 1 = (+x,-z), 2 = (+x,+z), 3 = (-x,+z)
    h = (cx, cz) => y + hk[cz < z ? (cx < x ? 0 : 1) : cx > x ? 2 : 3];
  } else if (kind === 'ramp') {
    const dx = Math.round(Math.sin(rot));
    const dz = Math.round(-Math.cos(rot));
    h = (cx, cz) => y + LEVEL * clamp(((cx - x) * dx + (cz - z) * dz) / CELL + 0.5, 0, 1);
  }
  const cs = [[x - HALF, z - HALF], [x + HALF, z - HALF], [x + HALF, z + HALF], [x - HALF, z + HALF]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = cs[k];
    const [bx, bz] = cs[(k + 1) % 4];
    add(ax, h(ax, az), az, bx, h(bx, bz), bz);
  }
  return out;
}

function edgesOf(p) {
  if (!p._edges) p._edges = edgeKeys(p.kind, p.x, p.y, p.z, p.rot || 0, p.edit | 0);
  return p._edges;
}

/** Do two pieces share an edge? */
function connected(a, b) {
  const ea = edgesOf(a);
  for (const k of edgesOf(b)) if (ea.has(k)) return true;
  return false;
}

function slotKey(kind, x, y, z, rot) {
  const k = Math.round(y / LEVEL);
  if (kind === 'wall') {
    const alongX = Math.abs(Math.sin(rot)) < 0.5;
    // edge id by its midpoint on the half-cell lattice
    return `w${Math.round(x * 2 / CELL)},${Math.round(z * 2 / CELL)},${k},${alongX ? 'x' : 'z'}`;
  }
  // a floor, a ramp and a cone each get their own slot per cell and level, so they can share
  // a cell (a ramp inside a floored box, a cone roof over a ramp)
  return `${kind === 'floor' ? 'f' : kind === 'ramp' ? 'r' : 'c'}${Math.floor(x / CELL)},${Math.floor(z / CELL)},${k}`;
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
    this._doorsMoving = new Set();
    // Box Fights: { minX, maxX, minZ, maxZ, minY, maxY } or null. Pieces must have their centre
    // strictly inside the rect (never on the barrier lines) and sit between minY and maxY.
    this.buildArea = null;
    // Box Fights: { minX, maxX, minZ, maxZ } where nothing may be placed (the middle wall's line until it lifts)
    this.buildBlock = null;

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
    // tile batches for edited pieces: one instance per solid tile
    for (const kind of TILE_KINDS) {
      const geo = TILE_GEOMETRY[kind]();
      const cap = BUILD.maxPieces * TILE_COUNT[kind];
      for (const mat of MATERIALS) {
        const g = geo.clone();
        const dmg = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        dmg.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute('aDmg', dmg);
        const mesh = new THREE.InstancedMesh(g, makeMaterial(kind, mat), cap);
        mesh.name = `build-tile-${kind}-${mat}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.setColorAt(0, _c.set(MATERIAL_COLOR[mat]));
        mesh.count = 0;
        mesh.visible = false;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.batches['tile-' + kind + ':' + mat] = { mesh, dmg, list: [], dirty: false };
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

    // edit overlay: one translucent tile (+ outline) per editable tile, per kind
    // the edit grid draws on top of everything, like Fortnite's
    const editMat = (col, op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const editLine = (col, op) => new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false });
    this.editMats = { ok: editMat(EDIT_OK, 0.3), gone: editMat(EDIT_GONE, 0.04), pending: editMat(EDIT_PENDING, 0.22), hover: editMat(EDIT_HOVER, 0.45) };
    this.editLineMats = { ok: editLine(EDIT_OK, 0.95), gone: editLine(EDIT_GONE, 0.45), pending: editLine(EDIT_PENDING, 0.9), hover: editLine(EDIT_HOVER, 1) };
    this.editGhosts = {};
    for (const kind of EDIT_KINDS) {
      const grp = new THREE.Group();
      grp.name = `build-edit-${kind}`;
      grp.visible = false;
      const geo = TILE_GEOMETRY[kind](0.94, 1.9);
      const edges = new THREE.EdgesGeometry(geo, 20);
      for (let t = 0; t < EDIT_GRID[kind]; t++) {
        const m = new THREE.Mesh(geo, this.editMats.ok);
        m.add(new THREE.LineSegments(edges, this.editLineMats.ok));
        m.matrixAutoUpdate = false;
        m.matrix.copy(TILE_LOCAL[kind][t]);
        m.renderOrder = 11;
        grp.add(m);
      }
      this.group.add(grp);
      this.editGhosts[kind] = grp;
    }
    this.editPiece = null;
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
    // the level the feet are on; a player standing on the terrain builds at the ground
    // level of the target cell instead (so pieces sit on slopes, not float off them)
    const w = this.world;
    const standOn = this._onBuild(pos);
    // a landmark slab (the museum's floors sit 0.45 m above the clamped terrain under them) is
    // not the terrain: build on its own grid, flush with it
    const surf = w && w.groundHeight ? w.groundHeight(pos.x, pos.z, pos.y + 0.3) : -Infinity;
    const onSlab = !!(w && w.terrainHeight) && surf > w.terrainHeight(pos.x, pos.z) + 0.15;
    const onGround = !!(w && w.terrainHeight) && pos.y - w.terrainHeight(pos.x, pos.z) < ON_GROUND && !standOn && !onSlab;
    // off the terrain the level grid follows what the feet stand on: a built piece keeps its own
    // grid, and a landmark slab (the museum's floors at -7 / -11, its roofs) starts a grid at
    // its surface, so the first piece sits flush instead of 1 m above or below the floor
    // In the air over a built piece (jumping on a ramp), the surface below is the ramp's slope
    // at some odd height: its own base keeps the grid instead (the slope height shifted every
    // piece off the levels for the length of the jump)
    const under = !onGround && !standOn && Number.isFinite(surf) ? this._pieceAtSurface(pos.x, pos.z, surf) : null;
    const phase = onGround ? 0 : standOn ? levelPhase(standOn.y) : under ? levelPhase(under.y) : levelPhase(Number.isFinite(surf) ? surf : 0);
    const kFeet = Math.floor((pos.y - phase) / LEVEL + 0.34);
    let dk = 0;
    let x;
    let blocked = false; // floor / ramp / cone kept in our own cell by a wall in between
    let z;
    let rot = 0;

    // the cell the feet are in
    const ci = Math.floor(pos.x / CELL);
    const cj = Math.floor(pos.z / CELL);

    if (kind === 'wall') {
      // the front edge of the player's own cell along the dominant axis (never a line past
      // it: hugging a wall used to skip to the next grid line, i.e. build behind that wall)
      if (Math.abs(fx) >= Math.abs(fz)) {
        x = (ci + (fx > 0 ? 1 : 0)) * CELL;
        z = (cj + 0.5) * CELL;
        rot = Math.PI / 2;
      } else {
        z = (cj + (fz > 0 ? 1 : 0)) * CELL;
        x = (ci + 0.5) * CELL;
        rot = 0;
      }
      if (pitch > 0.6) dk = 1;
      else if (pitch < -0.6) dk = -1;
    } else {
      // floor / ramp / cone: the cell ahead, or the own cell when looking steeply down (up for
      // cones). "Ahead" is a side neighbour, never a diagonal one through a corner, and a wall
      // (built or a building's) between the two cells keeps the piece in the own cell.
      const own = kind === 'cone' ? pitch > 0.75 : pitch < -0.9;
      let ti = ci;
      let tj = cj;
      if (!own) {
        ti = Math.floor((pos.x + fx * CELL * 0.8) / CELL);
        tj = Math.floor((pos.z + fz * CELL * 0.8) / CELL);
        // feet in the back of the cell: the lookahead fell short of the next cell. "Ahead" is
        // always a neighbour (a ramp here went under our own feet, lifted us onto it, and the
        // held click then stacked a second ramp right over our head)
        if (ti === ci && tj === cj) {
          if (Math.abs(fx) >= Math.abs(fz)) ti = ci + (fx > 0 ? 1 : -1);
          else tj = cj + (fz > 0 ? 1 : -1);
        }
        if (ti !== ci && tj !== cj) {
          if (Math.abs(fx) >= Math.abs(fz)) tj = cj;
          else ti = ci;
        }
        if (this._blockedBetween(pos, ci, cj, ti, tj)) {
          blocked = true;
          ti = ci;
          tj = cj;
        }
      }
      x = (ti + 0.5) * CELL;
      z = (tj + 0.5) * CELL;
      const ahead = ti !== ci || tj !== cj;
      if (kind === 'ramp') {
        rot = (Math.round(heading / (Math.PI / 2)) * Math.PI) / 2;
        // looking down at the next cell: a ramp down into it. Not when a wall kept the ramp in
        // our own cell (boxed in): one level down there is under our own feet / the ground.
        if (pitch < -0.6 && !own && ahead) dk = -1;
      } else if (kind === 'floor') {
        if (pitch > 0.45) dk = 1;
      } else if (own || pitch > 0.2) {
        dk = 1; // cone as a roof
      }
    }
    let k = (onGround ? this._groundLevel(x, z) : kFeet) + dk;
    rot = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // standing on a ramp in a box and ramping again: that spot is taken by the ramp we are on,
    // so the new one goes up a level (keeps climbing, like a ramp rush in a box). Only boxed in
    // (a wall kept the ramp in our own cell) and only for the ramp under our feet
    if (kind === 'ramp' && dk >= 0 && blocked) {
      const here = this.slots.get(slotKey('ramp', x, phase + k * LEVEL, z, rot));
      if (here && here.alive && here === standOn && pos.y > phase + k * LEVEL + 0.4) k += 1;
    }

    out.kind = kind;
    out.x = x;
    out.y = Math.round((phase + k * LEVEL) * 100) / 100;
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
    return this.fits(pl) && this.supported(pl);
  }

  /**
   * Is there a wall at body height between the player's cell (ci, cj) and the side-neighbour
   * cell (ti, tj)? Built walls count unless the crossing point is an edited opening; building
   * and vehicle sides are found with a chest-height ray toward the target cell (trees are not
   * walls: pieces clip through them).
   */
  _blockedBetween(pos, ci, cj, ti, tj) {
    if (ti === ci && tj === cj) return false;
    const lo = pos.y + 0.3; // body band
    const hi = pos.y + 1.7;
    const tx = (ti + 0.5) * CELL;
    const tz = (tj + 0.5) * CELL;
    // shared edge: along z at x = ex (ti != ci), or along x at z = ez
    const alongZ = ti !== ci;
    const ex = alongZ ? Math.max(ci, ti) * CELL : (ci + 0.5) * CELL;
    const ez = alongZ ? (cj + 0.5) * CELL : Math.max(cj, tj) * CELL;
    const rot = alongZ ? Math.PI / 2 : 0;
    // where the line from the feet to the target cell centre crosses that edge
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const f = alongZ ? (ex - pos.x) / (dx || 1e-6) : (ez - pos.z) / (dz || 1e-6);
    const cu = alongZ ? pos.z + dz * f - ez : pos.x + dx * f - ex; // offset along the edge from its midpoint
    for (let k = Math.floor(lo / LEVEL); k <= Math.floor(hi / LEVEL); k++) {
      const w = this.slots.get(slotKey('wall', ex, k * LEVEL, ez, rot));
      if (!w || !w.alive) continue;
      if (!w.edit) return true;
      // edited wall: blocked unless every tile of the crossed column at body height is open
      const c = clamp(Math.floor((cu + HALF) / TILE_W), 0, 2);
      for (let r = 0; r < 3; r++) {
        const y0 = w.y + r * TILE_H;
        if (y0 + TILE_H <= lo || y0 >= hi) continue;
        if (!(w.edit & (1 << (r * 3 + c)))) return true;
      }
    }
    const world = this.world;
    if (world && world.raycast) {
      const d = Math.hypot(dx, dz);
      const oy = pos.y + 1.2;
      const hit = d > 0.01 ? world.raycast(pos.x, oy, pos.z, dx / d, 0, dz / d, d, null) : null;
      if (hit && hit.collider && hit.collider.type === 'poly') return true; // a building / vehicle side
    }
    // an arena barrier (the Box Fights middle wall before it lifts): nothing goes through it, even
    // when a nearer piece (our own ramp) would stop a ray first
    if (this._arenaBetween(pos.x, pos.z, tx, tz, lo, hi)) return true;
    return false;
  }

  /** Does the segment (x0, z0) -> (x1, z1) cross a live arena wall that spans the body band lo..hi? */
  _arenaBetween(x0, z0, x1, z1, lo, hi) {
    const boxes = this.world && this.world._boxes;
    if (!boxes) return false;
    for (const b of boxes) {
      // walls only: a barrier standing across the whole body band (not the arena floor / ceiling slabs)
      if (!b || b.kind !== 'arena' || b.alive === false || b.y0 > lo || b.y1 < hi) continue;
      // slab test against the box footprint (arena boxes are axis-aligned)
      let t0 = 0;
      let t1 = 1;
      const dx = x1 - x0;
      const dz = z1 - z0;
      for (const [o, d, mn, mx] of [[x0, dx, b.minX, b.maxX], [z0, dz, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) {
            t0 = 2;
            break;
          }
          continue;
        }
        let a = (mn - o) / d;
        let c = (mx - o) / d;
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
      }
      if (t0 <= t1) return true;
    }
    return false;
  }

  /** Are the feet on a built surface (floor / ramp / cone surface, or the top of a wall)? */
  /** The live built piece the feet stand on (a floor / ramp top, or the top of a wall), or null. */
  _onBuild(pos) {
    const set = this._grid.get(Math.floor(pos.x / CELL) + ',' + Math.floor(pos.z / CELL));
    if (!set) return null;
    for (const q of set) {
      if (!q.alive) continue;
      if (q.surf) {
        if (pos.x < q.minX || pos.x > q.maxX || pos.z < q.minZ || pos.z > q.maxZ) continue;
        if (Math.abs(q.surf(pos.x, pos.z) - pos.y) < 0.35) return q;
      } else if (q.seg && Math.abs(q.y1 - pos.y) < 0.35) {
        const s = q.seg;
        const ex = s[2] - s[0];
        const ez = s[3] - s[1];
        const l2 = ex * ex + ez * ez || 1;
        const t = clamp(((pos.x - s[0]) * ex + (pos.z - s[1]) * ez) / l2, 0, 1);
        if (Math.hypot(pos.x - s[0] - ex * t, pos.z - s[1] - ez * t) < 0.6) return q;
      }
    }
    return null;
  }

  /** The built piece whose top is the surface `y` at (x, z) (within 5 cm), or null. */
  _pieceAtSurface(x, z, y) {
    const set = this._grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!set) return null;
    for (const q of set) {
      if (!q.alive) continue;
      if (q.surf) {
        if (x < q.minX || x > q.maxX || z < q.minZ || z > q.maxZ) continue;
        if (Math.abs(q.surf(x, z) - y) < 0.05) return q;
      } else if (q.seg && Math.abs(q.y1 - y) < 0.05) return q;
    }
    return null;
  }

  /** Ground level (grid level index) of the terrain at (x, z). */
  _groundLevel(x, z) {
    const w = this.world;
    const h = w && w.terrainHeight ? w.terrainHeight(x, z) : 0;
    return Math.floor(h / LEVEL + GROUND_SNAP);
  }

  /**
   * Would this placement be held up? True when it rests on the terrain / a building, or
   * shares an edge with any live piece (live pieces are always supported: unsupported
   * groups collapse). The host re-checks client pieces with this too.
   */
  supported(pl) {
    if (!pl || !Number.isFinite(pl.x) || !Number.isFinite(pl.y) || !Number.isFinite(pl.z)) return false;
    const p = shapeFor(pl.kind, pl.x, pl.y, pl.z, pl.rot || 0);
    p.kind = pl.kind;
    p.x = pl.x;
    p.y = pl.y;
    p.z = pl.z;
    p.rot = pl.rot || 0;
    this._bounds(p);
    if (this._grounded(p)) return true;
    return this._neighbours(p).length > 0;
  }

  /** Is the whole piece under the terrain (a wall / ramp / cone you could never see or use)? */
  _buried(pl) {
    const w = this.world;
    if (pl.kind === 'floor' || !w || !w.terrainHeight) return false;
    const top = pl.y + (pl.kind === 'cone' ? CONE_PEAK : LEVEL);
    const e = HALF - 0.2;
    const pts = pl.kind === 'wall'
      ? (Math.abs(Math.sin(pl.rot)) < 0.5 ? [[-e, 0], [0, 0], [e, 0]] : [[0, -e], [0, 0], [0, e]])
      : [[-e, -e], [e, -e], [e, e], [-e, e], [0, 0]];
    for (const [ox, oz] of pts) if (w.terrainHeight(pl.x + ox, pl.z + oz) < top - 0.1) return false;
    return true;
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
    if (this.buildArea && !this._inBuildArea(pl)) return false;
    const bb = this.buildBlock;
    if (bb && pl.x >= bb.minX && pl.x <= bb.maxX && pl.z >= bb.minZ && pl.z <= bb.maxZ) return false;
    if (this._buried(pl)) return false;
    const c = w.polyAt(pl.x, pl.z);
    if (!(c && c.h > pl.y + ROOF_CLIP)) return true;
    const s = c.shell;
    if (!s || pl.y >= s.ceil) return false; // solid prism, or the solid upper floors of a tall building
    return this._fitsInside(c, pl);
  }

  /** Box Fights arena rule (see buildArea): centre strictly inside, base and top within the vertical range. */
  _inBuildArea(pl) {
    const a = this.buildArea;
    if (!(pl.x > a.minX && pl.x < a.maxX && pl.z > a.minZ && pl.z < a.maxZ)) return false;
    const top = pl.y + (pl.kind === 'floor' ? 0 : pl.kind === 'cone' ? CONE_PEAK : LEVEL);
    if (pl.kind === 'floor' && pl.y >= a.maxY - 1e-6) return false; // flush with the ceiling: nobody can stand on it
    return pl.y >= a.minY - 1e-6 && top <= a.maxY + 1e-6;
  }

  /** Does placement pl fit inside hollow building c (under the ceiling, within the outline)? */
  _fitsInside(c, pl) {
    const s = c.shell;
    const top = pl.y + (pl.kind === 'floor' ? 0 : pl.kind === 'cone' ? CONE_PEAK : LEVEL);
    // the storey the piece stands in (its base within 0.5 m of that floor or above it): the piece
    // must fit under THAT storey's ceiling, not the top one, or it pokes up through the floor above
    let ceil = s.ceil;
    let floor = s.floor;
    if (s.plan && s.plan.levels.length > 1) {
      for (const L of s.plan.levels) {
        if (L.y <= pl.y + 0.5 && L.y >= floor) {
          floor = L.y;
          ceil = L.ceil;
        }
      }
    }
    if (top > ceil + INSIDE_CEIL_SLACK || pl.y < floor - LEVEL * 0.75) return false;
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
      out.push([p.kind, p.mat, p.x, p.y, p.z, Math.round(p.rot * 100), Math.round(p.hp), p.key, p.edit | 0, p.doors.map((v) => v + 1).join('')]);
    }
    return out;
  }

  /** Client: make the local grid match the host's list. */
  importNet(rows) {
    const keep = new Set();
    for (const row of rows || []) {
      const [kind, mat, x, y, z, rot100, hp, key, ed = 0, dr] = row;
      keep.add(key);
      let have = this.slots.get(key);
      if (!have) {
        have = this.placeBuilt({ kind, x, y, z, rot: rot100 / 100, key, level: Math.round(y / 3), valid: true }, mat, null, { quiet: false });
        if (!have) continue;
      }
      have.hp = Math.max(1, Math.min(have.maxHp, hp));
      if (kind === 'ramp') {
        const q = rampQuarter(rot100 / 100);
        if (q !== rampQuarter(have.rot)) this.edit(have, q);
      } else if ((have.edit | 0) !== (ed | 0)) this.edit(have, ed | 0);
      if (typeof dr === 'string') for (let c = 0; c < 3; c++) this.setDoor(have, c, Number(dr[c]) - 1);
    }
    for (const p of this.pieces.slice()) {
      if (!keep.has(p.key)) this.remove(p, false);
    }
  }

  /**
   * Place a finished piece: full hp, already grown (no build-up). `quiet` (default) suppresses the
   * build sound and fx. Returns the piece or null (slot taken / cap / bad kind).
   */
  placeBuilt(placement, mat, owner = null, { quiet = true } = {}) {
    const p = this.place(placement, mat, owner, quiet);
    if (!p) return null;
    p.hp = p.maxHp;
    p.growing = false;
    p.age = 99;
    return p;
  }

  /** Build it. Caller has already checked and spent BUILD.cost mats. */
  place(placement, mat, owner = null, quiet = false) {
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
      edit: 0,
      rot0: rot, // as placed: a ramp's edit reset turns it back to this
      doors: [0, 0, 0], // per wall column: 0 closed, +1 / -1 open toward local +z / -z
      doorAnim: [0, 0, 0], // 0 closed .. 1 open (eased)
      doorSign: [1, 1, 1], // swing side of the last opening (kept while it closes)
      _inst: null,
      _fullTris: null,
    };
    this._bounds(piece);
    piece.grounded = this._grounded(piece);
    if (this.world) this.world.addPiece(piece);
    this._gridAdd(piece);
    this.slots.set(key, piece);
    this.pieces.push(piece);
    this._addInstance(piece);

    const c = this._center(piece, _p);
    if (!quiet) {
      if (this.fx) this.fx.buildPlace(c, this._size(piece, _s), mat);
      if (this.sfx) this.sfx.play(SOUND[mat], { x: c.x, y: c.y, z: c.z });
    }
    return piece;
  }

  // ----------------------------------------------------------------- editing

  /**
   * Re-shape a live piece: walls / floors / cones take a mask of removed tiles (0 = whole
   * piece), ramps a quarter-turn index (0..3). HP, owner and slot are kept. Returns true when
   * the piece changed. No mats are spent.
   */
  edit(piece, mask) {
    if (!piece || !piece.alive || !piece.isStructure || !validEdit(piece.kind, mask)) return false;
    if (piece.kind === 'ramp') {
      if (mask === rampQuarter(piece.rot)) return false;
      piece.rot = (mask * Math.PI) / 2;
    } else {
      if ((piece.edit | 0) === mask) return false;
      piece.edit = mask;
    }
    piece.doors = [0, 0, 0]; // a re-edit closes every door
    piece.doorAnim = [0, 0, 0];
    this._doorsMoving.delete(piece);
    this._reshape(piece);
    this._removeInstance(piece);
    this._addInstance(piece);
    if (this.sfx) {
      const c = this._center(piece, _p);
      this.sfx.play(SOUND[piece.mat], { x: c.x, y: c.y, z: c.z, volume: 0.45 });
    }
    return true;
  }

  /** Rebuild a live piece's collision shape after its edit or a door changed. */
  _reshape(piece) {
    if (this.world) this.world.remove(piece);
    this._gridRemove(piece);
    Object.assign(piece, shapeFor(piece.kind, piece.x, piece.y, piece.z, piece.rot, piece.edit, piece.doors));
    piece._fullTris = null;
    piece._edges = null; // a turned ramp has different edges
    this._bounds(piece);
    if (this.world) this.world.addPiece(piece);
    else piece.alive = true;
    this._gridAdd(piece);
  }

  // ------------------------------------------------------------------ doors

  /** Door columns (bitmask) of a piece: only edited walls have doors. */
  doorColumns(piece) {
    return piece && piece.kind === 'wall' ? doorColumns(piece.edit | 0) : 0;
  }

  /** Open (away from `sign`'s side: +1 swings toward local +z) or close door column c. */
  toggleDoor(piece, c, sign = 1) {
    if (!piece || !piece.alive || !(this.doorColumns(piece) & (1 << c))) return false;
    return this.setDoor(piece, c, piece.doors[c] ? 0 : sign >= 0 ? 1 : -1);
  }

  /** Set door column c: 0 closed, +1 / -1 open toward local +z / -z. Returns true on change. */
  setDoor(piece, c, v) {
    if (!piece || !piece.alive || !(this.doorColumns(piece) & (1 << c))) return false;
    v = v > 0 ? 1 : v < 0 ? -1 : 0;
    if (piece.doors[c] === v) return false;
    if (v) piece.doorSign[c] = v;
    piece.doors[c] = v;
    this._reshape(piece);
    this._doorsMoving.add(piece);
    if (this.sfx) {
      const at = this.doorPoint(piece, c, _p);
      this.sfx.play(SOUND[piece.mat], { x: at.x, y: at.y, z: at.z, volume: 0.35 });
    }
    return true;
  }

  /** World centre of door column c (at chest height) written to out. */
  doorPoint(piece, c, out) {
    const alongX = Math.abs(Math.sin(piece.rot)) < 0.5;
    const u = -HALF + (c + 0.5) * TILE_W;
    return out.set(piece.x + (alongX ? u : 0), piece.y + TILE_H, piece.z + (alongX ? 0 : u));
  }

  /**
   * The closest door to an actor's feet within maxD (horizontal; anywhere in the cell next to it), or null:
   * { piece, c, open, sign } where sign opens it away from the actor.
   */
  doorNear(pos, maxD = 3.2) {
    let best = null;
    let bestD = maxD;
    for (const p of this.pieces) {
      if (p.kind !== 'wall' || !p.edit || !p.alive) continue;
      if (Math.abs(p.x - pos.x) > maxD + HALF || Math.abs(p.z - pos.z) > maxD + HALF) continue;
      if (pos.y < p.y - 0.6 || pos.y > p.y + LEVEL * 0.6) continue;
      const dc = doorColumns(p.edit);
      if (!dc) continue;
      for (let c = 0; c < 3; c++) {
        if (!(dc & (1 << c))) continue;
        const at = this.doorPoint(p, c, _s);
        const d = Math.hypot(at.x - pos.x, at.z - pos.z);
        if (d >= bestD) continue;
        bestD = d;
        const lz = -(pos.x - p.x) * Math.sin(p.rot) + (pos.z - p.z) * Math.cos(p.rot);
        best = { piece: p, c, open: !!p.doors[c], sign: lz < 0 ? 1 : -1 };
      }
    }
    return best;
  }

  /** The current edit value of a piece in the form edit() takes. */
  editValue(piece) {
    if (!piece) return 0;
    return piece.kind === 'ramp' ? rampQuarter(piece.rot) : piece.edit | 0;
  }

  /** Number of tiles in a kind's edit grid. */
  tileCount(kind) {
    return EDIT_GRID[kind] || 0;
  }

  /** The edit value that restores a piece as placed (whole piece; a ramp's original heading). */
  resetValue(piece) {
    return piece && piece.kind === 'ramp' ? rampQuarter(piece.rot0 != null ? piece.rot0 : piece.rot) : 0;
  }

  _fullTrisOf(p) {
    if (!p._fullTris) p._fullTris = p.edit ? shapeFor(p.kind, p.x, p.y, p.z, p.rot, 0).tris : p.tris;
    return p._fullTris;
  }

  /**
   * Nearest piece along a ray (origin / dir are Vector3-likes, dir unit) within maxT, counting
   * removed tiles as solid so an edited piece can be re-edited through its own openings.
   * Returns { piece, t } or null. World geometry (terrain, buildings) in front blocks it.
   */
  pickPiece(origin, dir, maxT = 7) {
    let best = null;
    let bestT = maxT;
    for (const p of this.pieces) {
      if (!p.alive) continue;
      const cx = p.x - origin.x;
      const cy = p.y + LEVEL / 2 - origin.y;
      const cz = p.z - origin.z;
      if (cx * cx + cy * cy + cz * cz > (maxT + CELL) * (maxT + CELL)) continue;
      const t = rayTris(this._fullTrisOf(p), origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestT);
      if (t < bestT) {
        bestT = t;
        best = p;
      }
    }
    if (!best) return null;
    const w = this.world;
    if (w && w.raycast) {
      const hit = w.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, bestT - 0.05, null);
      if (hit && !this.isPiece(hit.collider) && hit.t < bestT - 0.05) return null;
    }
    return { piece: best, t: bestT };
  }

  /** Edit-grid tile of `piece` under a ray (removed tiles included), or -1. */
  aimTile(piece, origin, dir, maxT = 12) {
    if (!piece || !EDIT_GRID[piece.kind]) return -1;
    const t = rayTris(this._fullTrisOf(piece), origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT);
    if (t === Infinity) return -1;
    return this.tileAt(piece, origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
  }

  /** Tile index of a world point on a piece (see the header for the numbering). */
  tileAt(piece, hx, hy, hz) {
    const dx = hx - piece.x;
    const dz = hz - piece.z;
    const cr = Math.cos(piece.rot);
    const sr = Math.sin(piece.rot);
    const lx = dx * cr + dz * sr;
    const lz = -dx * sr + dz * cr;
    if (piece.kind === 'wall') {
      const c = clamp(Math.floor((lx + HALF) / TILE_W), 0, 2);
      const r = clamp(Math.floor((hy - piece.y) / TILE_H), 0, 2);
      return r * 3 + c;
    }
    if (piece.kind === 'floor' || piece.kind === 'ramp') return (lx < 0 ? 0 : 1) + (lz < 0 ? 0 : 2);
    if (piece.kind === 'cone') return (lx < 0 ? 0 : 1) + (lz < 0 ? 0 : 2);
    return -1;
  }

  /**
   * Show the edit overlay on `piece` for a pending `mask` (null hides it): blue tiles stay,
   * red tiles will be removed, the `hover` tile is white. Ramps preview the turned ramp.
   */
  setEditGhost(piece, mask = 0, hover = -1) {
    for (const k in this.editGhosts) this.editGhosts[k].visible = false;
    this.editPiece = piece || null;
    if (!piece) {
      if (this.ghost === null) this.ghosts.ramp.visible = false;
      return;
    }
    if (piece.kind === 'ramp') {
      // preview the turned ramp (hidden while the pending heading is the current one)
      if (mask !== rampQuarter(piece.rot)) {
        this.setGhost({ kind: 'ramp', x: piece.x, y: piece.y, z: piece.z, rot: (mask * Math.PI) / 2, valid: true }, piece.mat);
        this.ghost = null;
      } else if (this.ghost === null) this.ghosts.ramp.visible = false;
      mask = 0; // the ramp grid has no removed tiles
    }
    const grp = this.editGhosts[piece.kind];
    if (!grp) return;
    grp.visible = true;
    grp.position.set(piece.x, piece.y, piece.z);
    grp.rotation.set(0, -piece.rot, 0);
    // selected tiles read open; while the selection is not a valid shape they read amber
    const bad = piece.kind !== 'ramp' && !validEdit(piece.kind, mask);
    grp.children.forEach((m, t) => {
      const bit = 1 << t;
      const st = t === hover ? 'hover' : mask & bit ? (bad ? 'pending' : 'gone') : 'ok';
      m.material = this.editMats[st];
      m.children[0].material = this.editLineMats[st];
    });
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

  /** On the terrain, or resting on / against a building or vehicle whose top is within a level below the base. */
  _grounded(p) {
    const w = this.world;
    // terrain: any sample under the piece within GROUND_TOL of its base (or above it)
    // ground = the terrain or any walkable world surface (the museum's floors, slabs and roofs)
    const th = w && w.groundHeight
      ? (x, z) => Math.max(w.terrainHeight(x, z), w.groundHeight(x, z, p.y0 + 0.3))
      : w && w.terrainHeight ? (x, z) => w.terrainHeight(x, z) : () => 0;
    const lo = p.y0 - GROUND_TOL;
    if (p.seg) {
      const s = p.seg;
      if (th(s[0], s[1]) >= lo || th(s[2], s[3]) >= lo || th((s[0] + s[2]) / 2, (s[1] + s[3]) / 2) >= lo) return true;
    } else {
      const e = HALF - 0.2;
      if (th(p.x, p.z) >= lo || th(p.x - e, p.z - e) >= lo || th(p.x + e, p.z - e) >= lo || th(p.x + e, p.z + e) >= lo || th(p.x - e, p.z + e) >= lo) return true;
    }
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
    this._doorsMoving.clear();
    for (const k in this.batches) {
      const b = this.batches[k];
      b.list.length = 0;
      b.mesh.count = 0;
      b.mesh.visible = false;
    }
    this.setGhost(null);
    this.setEditGhost(null);
  }

  // ----------------------------------------------------------------- per frame

  update(dt) {
    this._time += dt;
    for (const p of this._doorsMoving) {
      let moving = false;
      for (let c = 0; c < 3; c++) {
        const want = p.doors[c] ? 1 : 0;
        const a = p.doorAnim[c];
        if (a === want) continue;
        p.doorAnim[c] = want > a ? Math.min(want, a + dt / DOOR_TIME) : Math.max(want, a - dt / DOOR_TIME);
        moving = true;
      }
      if (p.alive) this._writeMatrix(p);
      if (!moving || !p.alive) this._doorsMoving.delete(p);
    }
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
    for (const k in this.editGhosts) {
      const m = this.editGhosts[k].children[0];
      if (m) {
        m.geometry.dispose();
        m.children[0].geometry.dispose();
      }
    }
    for (const k in this.editMats) this.editMats[k].dispose();
    for (const k in this.editLineMats) this.editLineMats[k].dispose();
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

  /** Instances for a piece: one in its kind batch, or one per solid tile when edited. */
  _addInstance(p) {
    p._inst = [];
    if (p.edit && p.kind === 'cone') {
      this._pushInst(p, this._coneBatch(p.edit, p.mat), null);
    } else if (p.edit && TILE_COUNT[p.kind]) {
      const b = this.batches['tile-' + p.kind + ':' + p.mat];
      const L = TILE_LOCAL[p.kind];
      for (let t = 0; t < L.length; t++) if (!(p.edit & (1 << t))) this._pushInst(p, b, L[t]);
      // door panels fill door columns (their matrix follows the swing, see _localOf)
      const dc = p.kind === 'wall' ? doorColumns(p.edit) : 0;
      for (let c = 0; c < 3; c++) {
        if (!(dc & (1 << c))) continue;
        this._pushInst(p, this._doorBatch(p.mat), null);
        p._inst[p._inst.length - 1].door = c;
      }
    } else {
      this._pushInst(p, this.batches[p.kind + ':' + p.mat], null);
    }
    this._writeMatrix(p);
    this._paint(p);
  }

  /** Instanced batch of door panels for one material (made on first use). */
  _doorBatch(mat) {
    const key = 'door:' + mat;
    let b = this.batches[key];
    if (b) return b;
    // panel with its hinge edge on local x = 0, standing on y = 0
    const g = new THREE.BoxGeometry(TILE_W * 0.92, TILE_H * 2 * 0.97, WALL_THICK * 0.6).translate(TILE_W * 0.46, TILE_H * 0.97, 0);
    const dmg = new THREE.InstancedBufferAttribute(new Float32Array(BUILD.maxPieces * 3), 1);
    dmg.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aDmg', dmg);
    const mesh = new THREE.InstancedMesh(g, makeMaterial('wall', mat), BUILD.maxPieces * 3);
    mesh.name = `build-${key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.set(MATERIAL_COLOR[mat]));
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    b = this.batches[key] = { mesh, dmg, list: [], dirty: false };
    return b;
  }

  /** Local matrix of an instance entry: its tile offset, or a door panel's hinge + swing. */
  _localOf(e) {
    if (e.door == null) return e.local;
    const p = e.p;
    const c = e.door;
    const a = p.doorAnim ? p.doorAnim[c] : 0;
    const ease = a * a * (3 - 2 * a);
    _m3.makeRotationY(-(p.doorSign ? p.doorSign[c] : 1) * (Math.PI / 2) * ease);
    _m3.setPosition(-HALF + c * TILE_W + TILE_W * 0.04, 0.005, 0);
    return _m3;
  }

  /** Instanced batch of cones reshaped by one edit mask (made on first use). */
  _coneBatch(mask, mat) {
    const key = 'cone-e' + mask + ':' + mat;
    let b = this.batches[key];
    if (b) return b;
    const g = coneEditGeometry(mask);
    const dmg = new THREE.InstancedBufferAttribute(new Float32Array(BUILD.maxPieces), 1);
    dmg.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aDmg', dmg);
    const mesh = new THREE.InstancedMesh(g, makeMaterial('cone', mat), BUILD.maxPieces);
    mesh.name = `build-${key}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.set(MATERIAL_COLOR[mat]));
    mesh.count = 0;
    mesh.visible = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    b = this.batches[key] = { mesh, dmg, list: [], dirty: false };
    return b;
  }

  _pushInst(p, b, local) {
    const e = { p, b, i: b.list.length, local };
    b.list.push(e);
    b.mesh.count = b.list.length;
    b.mesh.visible = true;
    p._inst.push(e);
  }

  _removeInstance(p) {
    if (!p._inst) return;
    for (const e of p._inst) {
      const b = e.b;
      const last = b.list.pop();
      if (last !== e) {
        // move the last instance into the hole
        b.list[e.i] = last;
        last.i = e.i;
        this._writeEntry(last);
        this._paintEntry(last);
      }
      b.mesh.count = b.list.length;
      b.mesh.visible = b.list.length > 0;
      b.dirty = true;
    }
    p._inst = null;
  }

  /** Base transform of a piece, with the build-up pop (a little overshoot). */
  _pieceMatrix(p, out) {
    const t = clamp(p.age / RISE_TIME, 0, 1);
    const k = 1.70158;
    const e = t >= 1 ? 1 : 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
    const sy = Math.max(0.04, e);
    const sxz = 0.85 + 0.15 * Math.min(1, t * 1.4);
    _q.setFromAxisAngle(_up, -p.rot);
    _s.set(sxz, sy, sxz);
    return out.compose(_p.set(p.x, p.y, p.z), _q, _s);
  }

  _writeMatrix(p) {
    if (!p._inst) return;
    this._pieceMatrix(p, _m);
    for (const e of p._inst) {
      const L = this._localOf(e);
      e.b.mesh.setMatrixAt(e.i, L ? _m2.multiplyMatrices(_m, L) : _m);
      e.b.dirty = true;
    }
  }

  _writeEntry(e) {
    this._pieceMatrix(e.p, _m);
    const L = this._localOf(e);
    e.b.mesh.setMatrixAt(e.i, L ? _m2.multiplyMatrices(_m, L) : _m);
    e.b.dirty = true;
  }

  _colorOf(p, out) {
    // damage taken (not HP still filling up) darkens the piece and draws cracks
    const lost = clamp(p.taken / p.maxHp, 0, 1);
    out.set(MATERIAL_COLOR[p.mat]);
    // a piece still building reads pale, fading to its true colour
    if (p.growing) out.lerp(_pale, 0.45 * (1 - clamp(p.age / BUILD_TIME[p.mat], 0, 1)));
    out.multiplyScalar(1 - 0.45 * lost);
    return lost;
  }

  _paintEntry(e) {
    const lost = this._colorOf(e.p, _c);
    e.b.mesh.setColorAt(e.i, e.door != null ? _cDoor.copy(_c).multiplyScalar(0.78) : _c);
    e.b.dmg.setX(e.i, lost);
    e.b.dirty = true;
  }

  _paint(p) {
    if (!p._inst) return;
    const lost = this._colorOf(p, _c);
    _cDoor.copy(_c).multiplyScalar(0.78); // door panels read darker than the wall
    for (const e of p._inst) {
      e.b.mesh.setColorAt(e.i, e.door != null ? _cDoor : _c);
      e.b.dmg.setX(e.i, lost);
      e.b.dirty = true;
    }
  }
}
