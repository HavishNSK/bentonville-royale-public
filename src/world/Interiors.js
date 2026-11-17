// BENTONVILLE ROYALE — building interior plans (pure JS: no three.js, no DOM).
//
// planInterior(bd, shell, ctx) runs once per hollow building in World.finishBuildings() and is
// read by collision (World.js), rendering (WorldMeshes.js / InteriorMeshes.js), and later by
// loot, bots and player building. Every client derives it from the same map JSON, so it MUST
// be deterministic: inputs are only the building record, shell.doors / shell.inner, the map
// POIs and integer hashing of the building id. No random numbers, Date, hypot or trig functions in
// this file or interiors/*; local coordinates are quantised to 1/64 m; ties break on index.
// Bump INTERIOR_VERSION whenever the output can change (it is part of Game.mapId).
//
// ============================================================== PLAN SHAPE (v3)
// plan = {
//   v          INTERIOR_VERSION
//   id         building id (bd.id)
//   recipe     recipe name ('house', 'shop', 'hall', 'landmark', ... see interiors/archetypes.js)
//   frame      { ox, oz, ux, uz, vx, vz, L, W }  oriented frame of the footprint:
//              world = (ox, oz) + a * (ux, uz) + b * (vx, vz), a in [0, L] (long axis), b in [0, W].
//              The main exterior door sits on the low side (a = 0 or b = 0) of one axis.
//   levels     [{
//     i          storey index (0 = ground)
//     y          absolute floor height (m)
//     ceil       absolute ceiling height (m)
//     rooms      [{ id, kind, label, a0, b0, a1, b1, cx, cz, area }]
//                id = index in this array; a0..b1 = the room's rect in the frame (local m);
//                (cx, cz) = a standable world point well inside the room; area = m^2 inside
//                the footprint. kind: living bedroom kitchen dining bath corridor hall lobby
//                sales storage office vault break restroom apartment greenhouse garage open
//     walls      Float32Array, stride 7: ax, az, bx, bz, r, y0, y1  (world; capsule of radius r
//                around a->b, solid for y0 <= y <= y1). Solid partition runs (one per panel)
//                and door lintels (y0 = door top) are both entries.
//     wallMeta   [{ kind: 'wall' | 'lintel', panel, door, ra, rb, nx, nz }] parallel to walls:
//                panel = index in plan.panels (-1 for lintels), door = index in doors (-1 none),
//                ra / rb = room on the -n / +n side (-1 none), (nx, nz) = unit normal toward rb
//     doors      [{ x, z, nx, nz, w, roomA, roomB, open? }]  interior doorways (centre on the wall
//                line, normal toward roomB, clear width w, open from y to y + doorH; open: true =
//                a full-height gap where a wall too short for a door was left out)
//     holes      [{ a0, b0, a1, b1 }]  local floor openings for stairs
//     floorArea  m^2 of walkable floor on this level
//     props      Float32Array, stride 7: ax, az, bx, bz, r, y0, y1 (same format as walls): one capsule
//                per solid furniture item on this level (spine along its longer side, r = half the
//                shorter side, y0..y1 = its bottom..top). Built by interiors/furnishings.js.
//     propBlock  Uint8Array, one per props capsule: 1 = stops bullets / sight rays, 0 = movement only
//   }]
//   stairs     [{ level, x0, z0, x1, z1, y0, y1, w, room0, room1, a0, b0, a1, b1, axis }]
//   furniture  [{ kind, level, room, a0, b0, a1, b1, y, lift, height, face, color, accent, solid, block, tier }]
//              kind from interiors/furnishings.js CATALOG; a0..b1 = local footprint; y = level floor;
//              lift = bottom above the floor (wall-mounted items); face = 'a+'|'a-'|'b+'|'b-' (front);
//              solid -> a levels[i].props capsule; block -> stops bullets; tier 0 core .. 3 clutter
//   lights     [{ level, a0, b0, a1, b1, y }]  ceiling light panels (y = that level's ceiling)
//   lootSpots  [{ x, y, z, level, room }]  one per room (room centre)
//   signs      [{ level, room, text, x, y, z, nx, nz, width, height }]
//   panels     [panel]  breakable wall panels; panel id = its index (stable per INTERIOR_VERSION)
//   doorH      interior door clear height (m)
//   hash       uint32 FNV-1a over the quantised plan
// }
// panel = {
//   id, kind: 'outer' | 'inner' | 'floor', level   ('floor': a slab tile, see interiors/floorTiles.js)
//   e, f0, f1         outer only: footprint edge e (vertex e -> e + 1) between fractions f0 < f1
//   ax, az, bx, bz    inner only: the wall centre line (world); the matching walls entry is wall
//   wall              inner only: index of its entry in levels[level].walls (stride 7 index / 7)
//   y0, y1            absolute height range (floor -> ceiling of its storey)
//   mat               'wood' | 'brick' | 'metal' (outer = building material, inner = 'wood')
//   hp, maxHp, alive  mutable state (World.breakPanel / restorePanel flip alive)
//   x, z              centre (world; outer = on the outer face)
// }
// Outer panels come first (by edge, then f0), inner panels after. Outer panels split every
// solid run of the outer wall (between doors) into pieces <= BUILDING_WALL.panelW wide and span
// the ground storey only (floor -> shell.ceil; tall buildings keep a solid upper block).
// ======================================================================================

import { BUILDING_WALL } from '../core/config.js';
import { q, inPoly, polyArea, toLocal, toWorld, partition, placeDoors, roomPoint, WALL_R } from './interiors/layout.js';
import { RECIPES } from './interiors/archetypes.js';
import { LANDMARK_RECIPES, classify } from './interiors/landmarks.js';

import { storeyCount, addStoreys, FLOOR_THICKNESS } from './interiors/storeys.js';
import { furnishInterior } from './interiors/furnishings.js';
import { addFloorTiles } from './interiors/floorTiles.js';

export const INTERIOR_VERSION = 6;

const HUB = { corridor: 1, hall: 1, lobby: 1, sales: 1, living: 1, open: 1 };

/** Integer hash of (n, salt) -> [0, 1). Same as WorldMeshes.hash01. */
export function hash01(n, salt) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** FNV-1a step over one 32-bit integer word. */
export function fnv(h, v) {
  return Math.imul(h ^ (v | 0), 0x01000193) >>> 0;
}

const flatPts = (pts) => {
  if (typeof pts[0] === 'number') return Array.from(pts);
  const out = [];
  for (const p of pts) out.push(p[0], p[1]);
  return out;
};

/**
 * Oriented frame of a footprint (flat [x, z, ...] or [[x, z], ...]): the minimum-area
 * bounding box over the edge directions, u = its long side. -> { ox, oz, ux, uz, vx, vz, L, W }
 */
export function frameOf(pts) {
  const P = flatPts(pts);
  const n = P.length >> 1;
  let best = null;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const ex = P[k * 2] - P[i * 2];
    const ez = P[k * 2 + 1] - P[i * 2 + 1];
    const l = Math.sqrt(ex * ex + ez * ez);
    if (l < 0.5) continue;
    const ux = ex / l;
    const uz = ez / l;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (let j = 0; j < n; j++) {
      const x = P[j * 2];
      const z = P[j * 2 + 1];
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-9) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) best = { ux: 1, uz: 0, u0: 0, u1: 1, v0: 0, v1: 1 };
  let { ux, uz, u0, u1, v0, v1 } = best;
  // v axis = (-uz, ux); make u the long side
  let vx = -uz;
  let vz = ux;
  if (v1 - v0 > u1 - u0) {
    const tx = ux;
    const tz = uz;
    ux = vx;
    uz = vz;
    vx = -tx;
    vz = -tz;
    const a0 = u0;
    const a1 = u1;
    u0 = v0;
    u1 = v1;
    v0 = -a1;
    v1 = -a0;
  }
  return {
    ox: q(u0 * ux + v0 * vx),
    oz: q(u0 * uz + v0 * vz),
    ux,
    uz,
    vx,
    vz,
    L: q(u1 - u0),
    W: q(v1 - v0),
  };
}

/** World point-in-polygon on a flat array. */
const inFlat = (P, x, z) => inPoly(P, x, z);

/**
 * Plan the interior of one hollow building.
 *   bd     map record { id, t, n?, h, lv, mat, a, p: [[x, z], ...] }
 *   shell  World collider.shell ({ t, floor, ceil, doorH, doors, inner, area, ... })
 *   ctx    { pois: map POIs [{ n, k, x, z }] }
 */
export function planInterior(bd, shell, ctx = {}) {
  const id = bd.id | 0;
  const P = flatPts(bd.p);
  const n = P.length >> 1;
  const t = shell.t;
  const doors = shell.doors || [];

  // ---- frame, flipped so the main door is on the low side of its nearest axis
  let F = frameOf(P);
  const main = doors.find((d) => d.main) || doors[0];
  let front = 'b';
  if (main) {
    const [da, db] = toLocal(F, main.x - main.nx * t, main.z - main.nz * t);
    const ds = [da, F.L - da, db, F.W - db];
    let k = 0;
    for (let i = 1; i < 4; i++) if (ds[i] < ds[k] - 1e-9) k = i;
    if (k === 1) {
      const [ox, oz] = toWorld(F, F.L, 0);
      F = { ...F, ox: q(ox), oz: q(oz), ux: -F.ux, uz: -F.uz };
    } else if (k === 3) {
      const [ox, oz] = toWorld(F, 0, F.W);
      F = { ...F, ox: q(ox), oz: q(oz), vx: -F.vx, vz: -F.vz };
    }
    front = k < 2 ? 'a' : 'b';
  }

  // ---- local inner polygon and exterior door zones
  const inner = shell.inner;
  const ni = inner.length >> 1;
  const Ploc = new Array(ni * 2);
  for (let i = 0; i < ni; i++) {
    const [a, b] = toLocal(F, inner[i * 2], inner[i * 2 + 1]);
    Ploc[i * 2] = q(a);
    Ploc[i * 2 + 1] = q(b);
  }
  const zones = [];
  for (const d of doors) {
    const ax = P[d.e * 2];
    const az = P[d.e * 2 + 1];
    const k = (d.e + 1) % n;
    const ex = P[k * 2] - ax;
    const ez = P[k * 2 + 1] - az;
    const l = Math.sqrt(ex * ex + ez * ez) || 1;
    const pts = [];
    for (const u of [d.u0, d.u1]) {
      const x = ax + (ex / l) * u;
      const z = az + (ez / l) * u;
      pts.push(toLocal(F, x, z), toLocal(F, x - d.nx * (t + 1), z - d.nz * (t + 1)));
    }
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const [a, b] of pts) {
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
    zones.push({ a0: q(a0), b0: q(b0), a1: q(a1), b1: q(b1) });
  }
  const mainLocal = main ? toLocal(F, main.x - main.nx * (t + 0.5), main.z - main.nz * (t + 0.5)) : [F.L / 2, 0];

  // ---- recipe
  const pois = [];
  for (const p of ctx.pois || []) {
    if (!inFlat(P, p.x, p.z)) continue;
    const [a, b] = toLocal(F, p.x, p.z);
    pois.push({ n: p.n, k: p.k, x: p.x, z: p.z, a: q(a), b: q(b) });
  }
  const recipe = classify(bd, pois, shell.area);
  const fn = recipe === 'landmark' ? LANDMARK_RECIPES[id] : RECIPES[recipe] || RECIPES.hall;
  const count = ctx._single ? 1 : storeyCount(bd, shell);
  const f = {
    levels: count,
    L: F.L,
    W: F.W,
    area: shell.area,
    lv: bd.lv || 1,
    front,
    side: front === 'a' ? 'b' : 'a',
    door: { a: q(mainLocal[0]), b: q(mainLocal[1]) },
    id,
    bd,
    pois,
    hash: (salt) => hash01(id, salt),
  };
  const authored = fn(f);
  const trees = authored?.levels || [authored];
  const tree = ctx._tree || trees[0];

  // ---- level 0 layout
  const lay = partition(tree, Ploc, F, zones);
  placeDoors(lay.rooms, lay.pieces, (k) => q(1.6 + 0.2 * hash01(id, 31 + k)), (r) => !!HUB[r.kind]);

  const y = shell.floor;
  const ceil = count > 1 ? q(Math.min(shell.ceil, shell.floor + (bd.h - 0.2) / count - FLOOR_THICKNESS)) : shell.ceil;
  const doorH = shell.doorH;
  const rooms = lay.rooms.map((r, i) => {
    const [ca, cb] = roomPoint(r, Ploc);
    const [cx, cz] = toWorld(F, ca, cb);
    return { id: i, kind: r.kind, label: r.label, a0: r.a0, b0: r.b0, a1: r.a1, b1: r.b1, cx, cz, area: q(r.area) };
  });

  const panels = [];
  const mat = bd.mat === 'wood' || bd.mat === 'metal' || bd.mat === 'brick' ? bd.mat : 'brick';
  const W = BUILDING_WALL;
  // outer panels: every solid run between doors, per edge, split into <= panelW pieces
  for (let e = 0; e < n; e++) {
    const k = (e + 1) % n;
    const ax = P[e * 2];
    const az = P[e * 2 + 1];
    const ex = P[k * 2] - ax;
    const ez = P[k * 2 + 1] - az;
    const l = Math.sqrt(ex * ex + ez * ez);
    if (l < 1e-4) continue;
    const runs = [];
    let fpos = 0;
    for (const d of doors) {
      if (d.e !== e) continue;
      if (d.f0 > fpos) runs.push([fpos, d.f0]);
      fpos = d.f1;
    }
    if (fpos < 1) runs.push([fpos, 1]);
    for (const [r0, r1] of runs) {
      const cnt = Math.max(1, Math.ceil(((r1 - r0) * l) / W.panelW - 1e-6));
      for (let j = 0; j < cnt; j++) {
        const f0 = j === 0 ? r0 : r0 + ((r1 - r0) * j) / cnt;
        const f1 = j === cnt - 1 ? r1 : r0 + ((r1 - r0) * (j + 1)) / cnt;
        const fm = (f0 + f1) / 2;
        const hp = W.hp[mat];
        panels.push({ id: panels.length, kind: 'outer', level: 0, e, f0, f1, y0: y, y1: ceil, mat, hp, maxHp: hp, alive: true, x: ax + ex * fm, z: az + ez * fm });
      }
    }
  }

  // inner walls: solid runs (one walls entry per panel) and door lintels
  const walls = [];
  const wallMeta = [];
  const ldoors = [];
  const R = WALL_R;
  for (const p of lay.pieces) {
    const isA = p.axis === 'a';
    const nrm = isA ? [F.ux, F.uz] : [F.vx, F.vz];
    const W0 = (s) => toWorld(F, isA ? p.c : s, isA ? s : p.c);
    if (p.open) {
      // a wall too short for a door that was left out to connect two rooms: a full-height gap
      const [cx, cz] = W0((p.s0 + p.s1) / 2);
      ldoors.push({ x: cx, z: cz, nx: nrm[0], nz: nrm[1], w: q(p.s1 - p.s0), roomA: p.ra, roomB: p.rb, open: true });
      continue;
    }
    const solid = (s0, s1, doorIdx) => {
      const len = s1 - s0;
      if (len < 0.05) return;
      const cnt = Math.max(1, Math.ceil(len / W.panelW - 1e-6));
      for (let j = 0; j < cnt; j++) {
        const u0 = q(s0 + (len * j) / cnt);
        const u1 = j === cnt - 1 ? s1 : q(s0 + (len * (j + 1)) / cnt);
        const [ax, az] = W0(u0);
        const [bx, bz] = W0(u1);
        const pid = panels.length;
        const wi = walls.length / 7;
        walls.push(ax, az, bx, bz, R, y, ceil);
        wallMeta.push({ kind: 'wall', panel: pid, door: doorIdx, ra: p.ra, rb: p.rb, nx: nrm[0], nz: nrm[1] });
        panels.push({
          id: pid, kind: 'inner', level: 0, ax, az, bx, bz, wall: wi, y0: y, y1: ceil, mat: 'wood',
          hp: W.innerHp, maxHp: W.innerHp, alive: true, x: (ax + bx) / 2, z: (az + bz) / 2,
        });
      }
    };
    if (p.door) {
      const d0 = q(p.door.s - p.door.w / 2);
      const d1 = q(p.door.s + p.door.w / 2);
      const di = ldoors.length;
      const [cx, cz] = W0(p.door.s);
      ldoors.push({ x: cx, z: cz, nx: nrm[0], nz: nrm[1], w: p.door.w, roomA: p.ra, roomB: p.rb });
      // capsule end caps reach R past a run's end: stop the runs short of the opening
      solid(p.s0, q(d0 - R), di);
      const [lax, laz] = W0(d0);
      const [lbx, lbz] = W0(d1);
      walls.push(lax, laz, lbx, lbz, R, y + doorH, ceil);
      wallMeta.push({ kind: 'lintel', panel: -1, door: di, ra: p.ra, rb: p.rb, nx: nrm[0], nz: nrm[1] });
      solid(q(d1 + R), p.s1, di);
    } else solid(p.s0, p.s1, -1);
  }

  let floorArea = 0;
  for (const r of rooms) floorArea += r.area;
  const lootSpots = rooms.map((r) => ({ x: r.cx, y, z: r.cz, level: 0, room: r.id }));
  const level = {
    i: 0,
    y,
    ceil,
    rooms,
    walls: new Float32Array(walls),
    wallMeta,
    doors: ldoors,
    holes: [],
    floorArea: q(Math.abs(polyArea(Ploc)) || floorArea),
  };

  // ---- hash (quantised)
  const Q = (v) => Math.round(v * 64);
  let h = 0x811c9dc5;
  h = fnv(h, INTERIOR_VERSION);
  h = fnv(h, id);
  for (let i = 0; i < recipe.length; i++) h = fnv(h, recipe.charCodeAt(i));
  for (const v of [F.ox, F.oz, F.L, F.W, Math.round(F.ux * 65536), Math.round(F.uz * 65536)]) h = fnv(h, Q(v));
  for (const r of rooms) for (const v of [r.a0, r.b0, r.a1, r.b1, r.cx, r.cz]) h = fnv(h, Q(v));
  const wf = level.walls;
  for (let i = 0; i < wf.length; i++) h = fnv(h, Q(wf[i]));
  for (const d of ldoors) for (const v of [d.x, d.z, d.w]) h = fnv(h, Q(v));
  for (const pn of panels) {
    h = fnv(h, pn.kind === 'outer' ? 1 : 2);
    if (pn.kind === 'outer') {
      h = fnv(h, pn.e);
      h = fnv(h, Math.round(pn.f0 * 65536));
      h = fnv(h, Math.round(pn.f1 * 65536));
    } else h = fnv(h, pn.wall);
    h = fnv(h, Q(pn.y0));
    h = fnv(h, Q(pn.y1));
    h = fnv(h, pn.maxHp);
  }

  const plan = {
    v: INTERIOR_VERSION,
    id,
    recipe,
    frame: F,
    levels: [level],
    stairs: [],
    furniture: [],
    lootSpots,
    signs: [],
    panels,
    doorH,
    hash: h >>> 0,
  };
  if (ctx._single) return plan;
  const complete = addStoreys(plan, bd, { ...shell, ceil }, count, trees, authored?.stairs, (upperShell, upperTree) =>
    planInterior(bd, upperShell, { ...ctx, _single: true, _tree: upperTree }));
  return addFloorTiles(furnishInterior(complete, shell), shell); // breakable slabs between storeys
}

/**
 * Room-graph route on one level: breadth-first over interior doors from room `fromRoom` to
 * `toRoom`. Fills `out` with door indices (into plan.levels[level].doors) in walking order and
 * returns it, or null when unreachable. opts.level (0) picks the level.
 */
export function route(plan, fromRoom, toRoom, out = [], level = 0) {
  out.length = 0;
  const L = plan && plan.levels[level];
  if (!L || fromRoom < 0 || toRoom < 0 || fromRoom >= L.rooms.length || toRoom >= L.rooms.length) return null;
  if (fromRoom === toRoom) return out;
  const n = L.rooms.length;
  const prevDoor = new Int32Array(n).fill(-1);
  const prevRoom = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  seen[fromRoom] = 1;
  const queue = [fromRoom];
  for (let qi = 0; qi < queue.length; qi++) {
    const r = queue[qi];
    if (r === toRoom) break;
    for (let di = 0; di < L.doors.length; di++) {
      const d = L.doors[di];
      const o = d.roomA === r ? d.roomB : d.roomB === r ? d.roomA : -1;
      if (o < 0 || seen[o]) continue;
      seen[o] = 1;
      prevDoor[o] = di;
      prevRoom[o] = r;
      queue.push(o);
    }
  }
  if (!seen[toRoom]) return null;
  for (let r = toRoom; r !== fromRoom; r = prevRoom[r]) out.push(prevDoor[r]);
  out.reverse();
  return out;
}
