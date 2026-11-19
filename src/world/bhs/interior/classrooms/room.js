// BENTONVILLE ROYALE — BHS classrooms: per-room geometry and a local placement API.
//
//   const rc = makeRoom(K, room, opts)
//
// Every room gets a local frame: u runs along the FRONT wall (the teaching wall: board, flag),
// v runs from the front wall (v = -D/2) to the back wall (v = +D/2). A prop at local yaw a = 0 faces
// the front (its sitter looks toward -v). The usable rect is the plan rect inset to the partition
// faces and shrunk off any exterior wall that clips it (rooms are clipped by the building outline).
// Placement helpers refuse spots in a door's clear zone, outside the building, or on a reserved
// footprint, so a generator can try a spot and move on.

import { frame } from '../../kit/builder.js';
import { SIZE } from '../../kit/palette.js';
import { insideOutline, wallDistance, buildingOf } from './util.js';

const STOREYS = { north: 3, south: 2 };
export const DOOR_CLEAR = 2.2; // m kept free inside every door (the test checks 1.6 m)
const PARTITION = SIZE.wallInt / 2; // 0.1

/** Usable rect: inset to the partition faces, then shrunk off exterior walls (greedy, 0.1 m steps). */
export function innerRect(room, building) {
  const r = { x0: room.x0 + PARTITION, x1: room.x1 - PARTITION, z0: room.z0 + PARTITION, z1: room.z1 - PARTITION };
  const ok = (x, z) => insideOutline(building, x, z, 0.2);
  const samples = (side) => {
    const out = [];
    if (side === 'x0' || side === 'x1') {
      const x = r[side];
      const n = Math.max(4, Math.ceil((r.z1 - r.z0) / 0.4));
      for (let i = 0; i <= n; i++) out.push([x, r.z0 + ((r.z1 - r.z0) * i) / n]);
    } else {
      const z = r[side];
      const n = Math.max(4, Math.ceil((r.x1 - r.x0) / 0.4));
      for (let i = 0; i <= n; i++) out.push([r.x0 + ((r.x1 - r.x0) * i) / n, z]);
    }
    return out;
  };
  for (let it = 0; it < 400; it++) {
    let worst = null;
    let worstN = 0;
    for (const s of ['x0', 'x1', 'z0', 'z1']) {
      const all = samples(s);
      const bad = all.filter(([x, z]) => !ok(x, z)).length;
      // the side with the largest failing FRACTION moves in first (a notch cuts the short side whole)
      const n = bad ? bad / all.length + bad * 1e-4 : 0;
      if (n > worstN) {
        worstN = n;
        worst = s;
      }
    }
    if (!worst) break;
    const sign = worst === 'x0' || worst === 'z0' ? 1 : -1;
    r[worst] += 0.1 * sign;
    if (r.x1 - r.x0 < 2 || r.z1 - r.z0 < 2) return null;
  }
  return r;
}

const SIDE_YAW = { z0: 0, z1: Math.PI, x0: -Math.PI / 2, x1: Math.PI / 2 };
const OPP = { z0: 'z1', z1: 'z0', x0: 'x1', x1: 'x0' };

/** Glass panes (kit parts, role 'glass') on this room's exterior walls, with their inward normal. */
function findWindows(K, room, building, y, ceil, glassParts) {
  const out = [];
  for (const g of glassParts) {
    if (g.cx < room.x0 - 0.5 || g.cx > room.x1 + 0.5 || g.cz < room.z0 - 0.5 || g.cz > room.z1 + 0.5) continue;
    if (g.y1 < y + 0.4 || g.y0 > ceil - 0.2) continue;
    const vx = -Math.sin(g.yaw);
    const vz = Math.cos(g.yaw);
    const inRoom = (x, z) => x > room.x0 && x < room.x1 && z > room.z0 && z < room.z1 && insideOutline(building, x, z, 0);
    let sgn = 0;
    if (inRoom(g.cx + vx * 0.7, g.cz + vz * 0.7)) sgn = 1;
    else if (inRoom(g.cx - vx * 0.7, g.cz - vz * 0.7)) sgn = -1;
    if (!sgn) continue;
    // glazing into a hallway (the outward side is still inside the building) vs an exterior window
    const interior = insideOutline(building, g.cx - vx * sgn * 0.8, g.cz - vz * sgn * 0.8, 0.3);
    out.push({ part: g, cx: g.cx, cz: g.cz, yaw: g.yaw, hx: g.hx, y0: g.y0, y1: g.y1, nx: vx * sgn, nz: vz * sgn, interior });
  }
  return out;
}

/** Side of a room rect an inward normal (nx, nz) belongs to. */
const sideOfNormal = (nx, nz) => (Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 'x0' : 'x1') : nz > 0 ? 'z0' : 'z1');

/**
 * Analyse one plan room (pure geometry; no pieces added). Returns null for rooms too clipped to dress.
 * opts: { glassParts, wallParts, rnd, frontSide? }
 */
export function analyseRoom(K, room, opts) {
  const building = buildingOf(room);
  const base = room.level * SIZE.storey; // slab top (collider base)
  const y = base + (room.level === 0 ? 0.04 : 0.012); // drawn floor top
  const n = STOREYS[building];
  const drop = 0; // ceilings are the slab underside (no dropped ceiling)
  const ceil = base + SIZE.storey - (room.level + 1 < n ? SIZE.slab : 0.4) - drop;
  const ir = innerRect(room, building);
  if (!ir) return null;
  // other plan rooms overlapping this one (plan overlaps, e.g. a stair hall): cut the rect back
  for (const o of opts.others || []) {
    if (o.building !== building || o.id === room.id) continue;
    if (!(o.level <= room.level && room.level < o.level + (o.tall || 1))) continue;
    const ox = Math.min(ir.x1, o.x1) - Math.max(ir.x0, o.x0);
    const oz = Math.min(ir.z1, o.z1) - Math.max(ir.z0, o.z0);
    if (ox <= 0.05 || oz <= 0.05) continue;
    // remove the smaller overlap slice from the nearest side
    const cut = [
      ['x0', o.x1 + PARTITION - ir.x0, ox <= oz && o.x0 <= ir.x0],
      ['x1', ir.x1 - (o.x0 - PARTITION), ox <= oz && o.x1 >= ir.x1],
      ['z0', o.z1 + PARTITION - ir.z0, oz < ox && o.z0 <= ir.z0],
      ['z1', ir.z1 - (o.z0 - PARTITION), oz < ox && o.z1 >= ir.z1],
    ].filter((c) => c[2]);
    if (!cut.length) continue;
    const [side, d] = cut.sort((a, b) => a[1] - b[1])[0];
    ir[side] += side.endsWith('0') ? d : -d;
    if (ir.x1 - ir.x0 < 2 || ir.z1 - ir.z0 < 2) return null;
  }
  const windows = findWindows(K, room, building, y, ceil, opts.glassParts || []);
  const ext = { x0: false, x1: false, z0: false, z1: false };
  const glazed = { x0: false, x1: false, z0: false, z1: false };
  for (const w of windows) (w.interior ? glazed : ext)[sideOfNormal(w.nx, w.nz)] = true;
  // a side is exterior when the outline runs along it (sample the plan edge)
  const near = (x, z) => wallDistance(building, x, z) < 0.6;
  if (near(room.x0, (room.z0 + room.z1) / 2) || ir.x0 - room.x0 > 0.3) ext.x0 = true;
  if (near(room.x1, (room.z0 + room.z1) / 2) || room.x1 - ir.x1 > 0.3) ext.x1 = true;
  if (near((room.x0 + room.x1) / 2, room.z0) || ir.z0 - room.z0 > 0.3) ext.z0 = true;
  if (near((room.x0 + room.x1) / 2, room.z1) || room.z1 - ir.z1 > 0.3) ext.z1 = true;
  const doorSides = new Set((room.doors || []).map((d) => d.side));
  return { room, building, base, y, ceil, ir, windows, ext, glazed, doorSides };
}

/** Choose the teaching (front) wall: no door, no windows, a classroom depth of 7-11 m. */
export function chooseFront(geo, rnd) {
  const { ir, ext, doorSides } = geo;
  let best = null;
  let bestS = -Infinity;
  for (const s of ['x0', 'x1', 'z0', 'z1']) {
    const along = s[0] === 'x' ? ir.z1 - ir.z0 : ir.x1 - ir.x0;
    const depth = s[0] === 'x' ? ir.x1 - ir.x0 : ir.z1 - ir.z0;
    let score = rnd() * 0.8;
    if (doorSides.has(s)) score -= 3;
    if (ext[s]) score -= 2.2;
    if (geo.glazed[s]) score -= 2.6;
    if (along < 5) score -= 2;
    score -= Math.max(0, depth - 12) * 0.25 + Math.max(0, 6.5 - depth) * 0.6;
    if (score > bestS) {
      bestS = score;
      best = s;
    }
  }
  return best;
}

/**
 * The room context: frame, walls, doors, reservations and placement helpers. Every y passed to
 * dec / part / cyl is relative to the drawn floor (rc.y); colliders that touch the floor start at the
 * slab top (rc.base) so they stand on it.
 */
export function makeRoom(K, geo, front, extra) {
  const { ir, room, building } = geo;
  const yaw = SIDE_YAW[front];
  const cx = (ir.x0 + ir.x1) / 2;
  const cz = (ir.z0 + ir.z1) / 2;
  const F = frame(cx, cz, yaw);
  const xs = front[0] === 'z';
  const W = xs ? ir.x1 - ir.x0 : ir.z1 - ir.z0;
  const D = xs ? ir.z1 - ir.z0 : ir.x1 - ir.x0;
  const reserved = [];
  const rc = {
    K,
    geo,
    room,
    building,
    F,
    W,
    D,
    u0: -W / 2,
    u1: W / 2,
    v0: -D / 2,
    v1: D / 2,
    y: geo.y,
    base: geo.base,
    H: geo.ceil - geo.y, // floor to ceiling
    front,
    reserved,
    seats: [], // { u, v, a, dep } chairs (for backpacks, hoodies)
    tops: [], // { u, v, a, hu, hv, h, dep } work surfaces (for papers, books)
    stats: { colliders: 0, decor: 0 },
    ...extra,
  };

  // ---- local walls: world side of each local wall
  const sideAt = (u, v) => {
    const [x, z] = F.toW(u, v);
    const d = { x0: Math.abs(x - ir.x0), x1: Math.abs(x - ir.x1), z0: Math.abs(z - ir.z0), z1: Math.abs(z - ir.z1) };
    return Object.keys(d).reduce((a, b) => (d[a] < d[b] ? a : b));
  };
  const walls = {
    front: { name: 'front', a: 0, s0: -W / 2, s1: W / 2, pt: (s, d) => [s, -D / 2 + d] },
    back: { name: 'back', a: Math.PI, s0: -W / 2, s1: W / 2, pt: (s, d) => [s, D / 2 - d] },
    left: { name: 'left', a: -Math.PI / 2, s0: -D / 2, s1: D / 2, pt: (s, d) => [-W / 2 + d, s] },
    right: { name: 'right', a: Math.PI / 2, s0: -D / 2, s1: D / 2, pt: (s, d) => [W / 2 - d, s] },
  };
  walls.front.side = front;
  walls.back.side = OPP[front];
  walls.left.side = sideAt(-W / 2, 0);
  walls.right.side = sideAt(W / 2, 0);
  for (const w of Object.values(walls)) {
    w.ext = !!geo.ext[w.side];
    w.glazed = !!geo.glazed[w.side];
    w.doors = [];
    w.windows = [];
    // along-wall coordinate of a local point on this wall
    w.sOf = (u, v) => (w.name === 'front' || w.name === 'back' ? u : v);
  }
  rc.walls = walls;
  const wallBySide = (s) => Object.values(walls).find((w) => w.side === s);

  // ---- doors (local) and their clear zones
  rc.doors = [];
  for (const d of room.doors || []) {
    const along = d.at === 'mid' || d.at === undefined ? null : d.at;
    let wx;
    let wz;
    if (d.side === 'z0' || d.side === 'z1') {
      wx = along === null ? (room.x0 + room.x1) / 2 : room.x0 + along;
      wz = d.side === 'z0' ? ir.z0 : ir.z1;
    } else {
      wz = along === null ? (room.z0 + room.z1) / 2 : room.z0 + along;
      wx = d.side === 'x0' ? ir.x0 : ir.x1;
    }
    const w = wallBySide(d.side);
    const [lu, lv] = F.toL(wx, wz);
    const s = w.sOf(lu, lv);
    const dw = d.w || 1.0;
    w.doors.push({ s, w: dw });
    // the clear zone: along the wall s +- (w / 2 + 0.6), DOOR_CLEAR deep, as a local AABB
    const pa = w.pt(s - dw / 2 - 0.6, 0);
    const pb = w.pt(s + dw / 2 + 0.6, DOOR_CLEAR);
    const zone = { u0: Math.min(pa[0], pb[0]), u1: Math.max(pa[0], pb[0]), v0: Math.min(pa[1], pb[1]), v1: Math.max(pa[1], pb[1]) };
    rc.doors.push({ wall: w.name, s, w: dw, x: wx, z: wz, zone, world: d });
  }
  for (const win of geo.windows) {
    const w = wallBySide(sideOfNormal(win.nx, win.nz));
    const [lu, lv] = F.toL(win.cx, win.cz);
    w.windows.push({ ...win, s: w.sOf(lu, lv) });
  }

  // ---- local <-> world, placement checks
  rc.toW = (u, v) => F.toW(u, v);
  rc.at = (u, v, a, du, dv) => [u + du * Math.cos(a) - dv * Math.sin(a), v + du * Math.sin(a) + dv * Math.cos(a)];
  const corners = (u, v, a, hu, hv) => [[-hu, -hv], [hu, -hv], [hu, hv], [-hu, hv]].map(([du, dv]) => rc.at(u, v, a, du, dv));
  const aabb = (u, v, a, hu, hv, pad = 0) => {
    const cs = corners(u, v, a, hu, hv);
    return { u0: Math.min(...cs.map((c) => c[0])) - pad, u1: Math.max(...cs.map((c) => c[0])) + pad, v0: Math.min(...cs.map((c) => c[1])) - pad, v1: Math.max(...cs.map((c) => c[1])) + pad };
  };
  const hit = (A, B) => A.u0 < B.u1 && A.u1 > B.u0 && A.v0 < B.v1 && A.v1 > B.v0;
  rc.inDoorZone = (A) => rc.doors.some((d) => hit(A, d.zone));
  /** Can a footprint (centre u, v, yaw a, half sizes) stand here? opts: { pad, door: false, reserve: false } */
  rc.fits = (u, v, a, hu, hv, o = {}) => {
    const A = aabb(u, v, a, hu, hv, o.pad || 0);
    const tol = 0.02;
    if (A.u0 < -W / 2 - tol || A.u1 > W / 2 + tol || A.v0 < -D / 2 - tol || A.v1 > D / 2 + tol) return false;
    if (o.door !== false && rc.inDoorZone(aabb(u, v, a, hu, hv, 0))) return false;
    if (o.reserve !== false && reserved.some((R) => hit(A, R))) return false;
    for (const [lu, lv] of corners(u, v, a, hu, hv)) {
      const [x, z] = F.toW(lu, lv);
      if (!insideOutline(building, x, z, 0.2)) return false;
    }
    const [x, z] = F.toW(u, v);
    return insideOutline(building, x, z, Math.min(0.6, Math.min(hu, hv) + 0.2));
  };
  rc.reserve = (u, v, a, hu, hv, pad = 0) => reserved.push(aabb(u, v, a, hu, hv, pad));
  rc.reserveRect = (R) => reserved.push(R);
  /** fits + reserve (with a walking pad around it). */
  rc.take = (u, v, a, hu, hv, pad = 0.1, o = {}) => {
    if (!rc.fits(u, v, a, hu, hv, { ...o, pad })) return false;
    rc.reserve(u, v, a, hu, hv, pad);
    return true;
  };

  // ---- emitters (relative y)
  const absY = (y) => rc.y + y;
  // upper floors are breakable tiles: loose decor rests on (and hides with) the tile under it
  const tiles = ((extra && extra.slabParts) || []).filter((p) => Math.abs(p.y1 - geo.base) < 0.05);
  const tileAt = (x, z) => tiles.find((p) => Math.abs(x - p.cx) <= p.hx && Math.abs(z - p.cz) <= p.hz) || null;
  rc.dec = (u, v, a, hu, hv, y0, y1, look, o = {}) => {
    const [x, z] = F.toW(u, v);
    rc.stats.decor++;
    const opts = !o.dep && tiles.length && y0 < 1.3 ? { ...o, dep: tileAt(x, z) } : o;
    return K.decor({ cx: x, cz: z, hx: hu, hz: hv, yaw: F.yaw + a, y0: absY(y0), y1: absY(y1) }, look, opts);
  };
  /** A flat floor finish (rug, carpet, wood) over a local rect. */
  rc.floorPatch = (u, v, a, hu, hv, look, lift = 0) =>
    rc.dec(u, v, a, hu, hv, -0.008 + lift, 0.004 + lift, look, { faces: { top: look, pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  rc.cyl = (u, v, r, y0, y1, look, o = {}) => rc.dec(u, v, 0, r, r, y0, y1, look, { ...o, shape: 'cyl' });
  rc.part = (u, v, a, hu, hv, y0, y1, o = {}) => {
    const [x, z] = F.toW(u, v);
    rc.stats.colliders++;
    const opts = { mat: 'wood', hp: 120, look: 'none', role: 'prop', ...o };
    if (opts.mat === 'solid') delete opts.hp;
    const p = K.box({ cx: x, cz: z, hx: hu, hz: hv, yaw: F.yaw + a, y0: y0 <= 0.001 ? rc.base : absY(y0), y1: absY(y1) }, opts);
    if (p) p.classroom = room.id;
    return p;
  };

  // ---- the wall piece behind a wall point (decor on a wall hides when that panel breaks)
  const wallParts = (extra && extra.wallParts) || [];
  rc.wallPartAt = (wname, s, yRel) => {
    const w = walls[wname];
    const [u, v] = w.pt(s, -0.12);
    const [x, z] = F.toW(u, v);
    const y = absY(yRel);
    for (const p of wallParts) {
      const dx = x - p.cx;
      const dz = z - p.cz;
      const c = Math.cos(p.yaw);
      const sn = Math.sin(p.yaw);
      const du = dx * c + dz * sn;
      const dv = -dx * sn + dz * c;
      if (Math.abs(du) <= p.hx + 0.02 && Math.abs(dv) <= p.hz + 0.12 && y >= p.y0 - 0.01 && y <= p.y1 + 0.01) return p;
    }
    return null;
  };
  /** A flat panel on a wall: along-wall centre s, half width hs, y0..y1, standing d0..d1 off the face. */
  rc.wdec = (wname, s, hs, y0, y1, look, d0 = 0, d1 = 0.02, o = {}) => {
    const w = walls[wname];
    const [u, v] = w.pt(s, (d0 + d1) / 2);
    const dep = o.dep === undefined ? rc.wallPartAt(wname, s, (y0 + y1) / 2) : o.dep;
    return rc.dec(u, v, w.a, hs, (d1 - d0) / 2, y0, y1, look, { ...o, dep });
  };
  /** Is the along-wall span [s0, s1] of a wall clear of its doors (and windows when asked)? */
  rc.wallFree = (wname, s0, s1, { windows = false, pad = 0.35 } = {}) => {
    const w = walls[wname];
    if (s0 < w.s0 + 0.05 || s1 > w.s1 - 0.05) return false;
    if (w.doors.some((d) => s1 > d.s - d.w / 2 - pad && s0 < d.s + d.w / 2 + pad)) return false;
    if (windows && w.windows.some((g) => s1 > g.s - g.hx - pad && s0 < g.s + g.hx + pad)) return false;
    // the wall must be inside the building along the span (clipped rooms)
    for (const s of [s0, (s0 + s1) / 2, s1]) {
      const [x, z] = F.toW(...w.pt(s, 0.25));
      if (!insideOutline(building, x, z, 0.15)) return false;
    }
    return true;
  };
  return rc;
}
