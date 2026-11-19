// BENTONVILLE ROYALE — BHS classrooms: helpers shared by every room type (wall claims, props
// against walls, teacher desk, closet, perimeter fill, clutter, loot, lighting).

import { place, teacherDesk, closet, bookshelf, cubbies, filing, cart, miniFridge, bins, floorPlant, backpack, hoodie, deskClutter, deskLamp, counter } from './props.js';
import { whiteboard, smartboard, projectorScreen, poster, bulletin, flag, clock, wallTv, coatHooks, sharpener, accentWall, blinds, bunting, workRow } from './walls.js';
import { C, BAGS, PAPER, pick, range } from './util.js';

// ------------------------------------------------------------------ wall claims

/** Claim an along-wall span [s0, s1] x [y0, y1] on a wall (no doors, windows or earlier claims). */
export function claimWall(rc, wall, s0, s1, y0, y1, o = {}) {
  if (!rc.wallFree(wall, s0, s1, { windows: o.windows !== false, pad: o.pad ?? 0.3 })) return false;
  const used = rc.wallUse[wall];
  if (used.some((q) => s1 > q[0] - 0.08 && s0 < q[1] + 0.08 && y1 > q[2] && y0 < q[3])) return false;
  used.push([s0, s1, y0, y1]);
  return true;
}

/** Along-wall positions from `pref` outward (both ways), in 0.15 m steps, keeping hs inside the wall. */
function* spots(w, hs, pref) {
  const lo = w.s0 + hs + 0.06;
  const hi = w.s1 - hs - 0.06;
  if (hi < lo) return;
  const p = Math.max(lo, Math.min(hi, pref));
  yield p;
  for (let k = 1; k < 200; k++) {
    const a = p + k * 0.15;
    const b = p - k * 0.15;
    if (a > hi && b < lo) return;
    if (a <= hi) yield a;
    if (b >= lo) yield b;
  }
}

/** Find + claim a wall-mounted span; returns s or null. */
export function wallSpot(rc, wall, hs, y0, y1, pref = 0, o = {}) {
  for (const s of spots(rc.walls[wall], hs, pref)) if (claimWall(rc, wall, s - hs, s + hs, y0, y1, o)) return s;
  return null;
}

/**
 * A floor prop against a wall (its back to the wall, open face to the room): hs along the wall, hd
 * deep, h tall. Returns a placer for it (prop frame: -dv faces the room) or null.
 */
export function againstWall(rc, wall, hs, hd, h, pref = 0, o = {}) {
  const w = rc.walls[wall];
  for (const s of spots(w, hs, pref)) {
    const [u, v] = w.pt(s, hd + 0.02);
    const a = w.a + Math.PI;
    if (!rc.fits(u, v, a, hs, hd, { pad: 0.04 })) continue;
    if (!claimWall(rc, wall, s - hs, s + hs, 0, h, { windows: o.windows ?? h > 0.75 })) continue;
    rc.reserve(u, v, a, hs, hd, o.pad ?? 0.25);
    const P = place(rc, u, v, a);
    P.s = s;
    P.wall = wall;
    return P;
  }
  return null;
}

/** Interior walls (no windows), longest first. */
export function plainWalls(rc, skip = []) {
  return Object.values(rc.walls)
    .filter((w) => !w.ext && !w.glazed && !skip.includes(w.name))
    .sort((a, b) => b.s1 - b.s0 - (a.s1 - a.s0))
    .map((w) => w.name);
}

// ------------------------------------------------------------------ teaching wall

/** The front (teaching) wall: board variant, flag, clock, TV. */
export function teachingWall(rc, o = {}) {
  const rnd = rc.rnd;
  const W = rc.W;
  const hsMax = Math.max(0.8, Math.min(2.2, W / 2 - 1.3));
  const variant = o.variant || pick(rnd, ['wb', 'wb+smart', 'wb+screen', 'smart+wb2']);
  const off = (rnd() - 0.5) * Math.max(0, W - 2 * hsMax - 2) * 0.5;
  if (variant === 'wb') {
    const s = wallSpot(rc, 'front', hsMax, 0.85, 2.2, off);
    if (s !== null) whiteboard(rc, 'front', s, hsMax, { strokes: 8 });
  } else if (variant === 'wb+smart') {
    const s = wallSpot(rc, 'front', 1.0, 0.9, 2.6, off);
    if (s !== null) smartboard(rc, 'front', s);
    for (const side of [-1, 1]) {
      const hs = Math.min(1.2, (W / 2 - 1.6) / 2);
      if (hs < 0.5) continue;
      const s2 = wallSpot(rc, 'front', hs, 0.85, 2.2, (s ?? 0) + side * (1.2 + hs));
      if (s2 !== null) whiteboard(rc, 'front', s2, hs, { strokes: 4 });
    }
  } else if (variant === 'wb+screen') {
    const s = wallSpot(rc, 'front', hsMax, 0.85, 2.2, off);
    if (s !== null) {
      whiteboard(rc, 'front', s, hsMax, { strokes: 5 });
      projectorScreen(rc, 'front', s, Math.min(1.3, hsMax), range(rnd, 0.3, 1.0));
      rc.wallUse.front.push([s - hsMax, s + hsMax, 2.2, rc.H]);
      // the ceiling projector
      const [u, v] = rc.walls.front.pt(s, 3.2);
      rc.dec(u, v, 0, 0.2, 0.17, rc.H - 0.32, rc.H - 0.18, C.white);
      rc.dec(u, v, 0, 0.02, 0.02, rc.H - 0.18, rc.H, C.charcoal);
    }
  } else {
    const s = wallSpot(rc, 'front', 1.0, 0.9, 2.6, off);
    if (s !== null) smartboard(rc, 'front', s);
    const hs = Math.min(1.5, W / 2 - 2.4);
    if (hs > 0.5) {
      const s2 = wallSpot(rc, 'front', hs, 0.85, 2.2, (s ?? 0) + (rnd() < 0.5 ? -1 : 1) * (1.3 + hs));
      if (s2 !== null) whiteboard(rc, 'front', s2, hs, { strokes: 6 });
    }
  }
  // flag in one front corner, TV or clock in the other
  const fl = rnd() < 0.5 ? -1 : 1;
  const fs = wallSpot(rc, 'front', 0.42, 1.9, 2.6, fl * (W / 2));
  if (fs !== null) flag(rc, 'front', fs);
  if (rnd() < 0.55) {
    const ts = wallSpot(rc, 'front', 0.62, 2.0, 2.75, -fl * (W / 2));
    if (ts !== null) wallTv(rc, 'front', ts, 2.08, rnd() < 0.3);
  }
  return variant;
}

/** Clock above a board / on the back wall; bulletin boards, posters on the plain walls. */
export function dressWalls(rc, o = {}) {
  const rnd = rc.rnd;
  const H = rc.H;
  const cw = rnd() < 0.5 ? 'front' : 'back';
  const cs = wallSpot(rc, cw, 0.18, Math.min(2.35, H - 0.6), Math.min(2.7, H - 0.25), 0);
  if (cs !== null) clock(rc, cw, cs, Math.min(2.52, H - 0.42));
  // bulletin boards: back wall + the door wall (beside the door)
  const nb = o.bulletins ?? 1 + Math.floor(rnd() * 2);
  for (let k = 0; k < nb; k++) {
    const wall = k === 0 ? 'back' : pick(rnd, plainWalls(rc, ['front']));
    if (!wall) continue;
    const hs = range(rnd, 0.6, 1.2);
    const s = wallSpot(rc, wall, hs + 0.05, 1.0, 2.2, range(rnd, -2, 2));
    if (s !== null) bulletin(rc, wall, s, hs, { papers: 4 + Math.round(rnd() * 6) });
  }
  // the door wall: a small board by the door, the pencil sharpener, maybe coat hooks
  for (const d of rc.doors) {
    const w = rc.walls[d.wall];
    const side = d.s > (w.s0 + w.s1) / 2 ? -1 : 1;
    const s = wallSpot(rc, d.wall, 0.35, 1.2, 1.95, d.s + side * (d.w / 2 + 0.75));
    if (s !== null) bulletin(rc, d.wall, s, 0.3, { y0: 1.25, y1: 1.9, papers: 3 });
    const sp = wallSpot(rc, d.wall, 0.06, 0.9, 1.15, d.s + side * (d.w / 2 + 0.4));
    if (sp !== null) sharpener(rc, d.wall, sp);
    if (rnd() < 0.5) {
      const hs = range(rnd, 0.6, 1.1);
      const hk = wallSpot(rc, d.wall, hs, 0.8, 1.7, d.s + side * (d.w / 2 + 1.6 + hs));
      if (hk !== null) coatHooks(rc, d.wall, hk, hs, BAGS);
    }
  }
  // the upper walls (4 m ceilings): pennant strings and rows of student work above the boards
  for (const wall of ['back', 'left', 'right', 'front']) {
    const w = rc.walls[wall];
    if (w.ext || rnd() < 0.3) continue;
    const y = Math.min(H - 0.35, range(rnd, 2.85, 3.3));
    if (rnd() < 0.5) {
      if (claimWall(rc, wall, w.s0 + 0.3, w.s1 - 0.3, y - 0.25, y + 0.02, { windows: false, pad: 0 })) bunting(rc, wall, w.s0 + 0.3, w.s1 - 0.3, y);
    } else {
      const a = w.s0 + range(rnd, 0.3, 1.5);
      const b = w.s1 - range(rnd, 0.3, 1.5);
      if (claimWall(rc, wall, a, b, 2.4, 2.8, { windows: false, pad: 0 })) workRow(rc, wall, a, b, 2.42);
    }
  }
  // generic posters on the plain walls
  const np = o.posters ?? 2 + Math.floor(rnd() * 5);
  for (let k = 0; k < np; k++) {
    const walls = plainWalls(rc, rnd() < 0.7 ? ['front'] : []);
    if (!walls.length) break;
    const wall = pick(rnd, walls);
    const w = rc.walls[wall];
    const pw = range(rnd, 0.35, 0.6);
    const ph = range(rnd, 0.45, 0.8);
    const y = range(rnd, 1.35, Math.max(1.4, Math.min(2.0, H - ph - 0.3)));
    const s = wallSpot(rc, wall, pw / 2, y, y + ph, range(rnd, w.s0, w.s1));
    if (s !== null) poster(rc, wall, s, y, pw, ph);
  }
}

// ------------------------------------------------------------------ windows

/** Blinds, unit ventilators under the windows, sill plants. */
export function windowWall(rc, o = {}) {
  const rnd = rc.rnd;
  const level = o.blinds ?? pick(rnd, [0.15, 0.35, 0.5, 0.7, 0.9]);
  blinds(rc, level, o.blindLook || pick(rnd, [C.blind, C.blind, C.blindTan, C.blindGrey]), o.plants ?? range(rnd, 0.1, 0.6));
  if (o.vents === false) return;
  // unit ventilator cabinets under the windows (classic US classroom), drawn only
  for (const w of Object.values(rc.walls))
    for (const g of w.windows) {
      if (g.interior) continue;
      const top = g.y0 - 0.06 - rc.y;
      if (top < 0.45) continue;
      const cx = g.cx + g.nx * 0.42;
      const cz = g.cz + g.nz * 0.42;
      rc.K.decor({ cx, cz, hx: g.hx + 0.15, hz: 0.2, yaw: g.yaw, y0: rc.y, y1: rc.y + Math.min(0.72, top) }, C.cream, { dep: g.part });
      rc.K.decor({ cx: cx + g.nx * 0.2, cz: cz + g.nz * 0.2, hx: g.hx, hz: 0.01, yaw: g.yaw, y0: rc.y + Math.min(0.72, top) - 0.2, y1: rc.y + Math.min(0.72, top) - 0.06 }, C.greyLight, { dep: g.part });
      rc.stats.decor += 2;
      // its strip of floor stays clear of props
      const [u, v] = rc.F.toL(cx, cz);
      rc.reserve(u, v, g.yaw - rc.F.yaw, g.hx + 0.15, 0.22, 0.1);
    }
}

// ------------------------------------------------------------------ teacher, closet

/** Teacher desk: one of front-left / front-right / back corner / side; returns { top, y, P, where } or null. */
export function placeTeacher(rc, pref) {
  const { W, D } = rc;
  const opts = {
    frontLeft: [-W / 2 + 1.25, -D / 2 + 1.35, Math.PI],
    frontRight: [W / 2 - 1.25, -D / 2 + 1.35, Math.PI],
    backLeft: [-W / 2 + 1.25, D / 2 - 1.4, 0],
    backRight: [W / 2 - 1.25, D / 2 - 1.4, 0],
    sideLeft: [-W / 2 + 1.35, range(rc.rnd, -D / 6, D / 6), Math.PI / 2],
    sideRight: [W / 2 - 1.35, range(rc.rnd, -D / 6, D / 6), -Math.PI / 2],
  };
  const order = [pref, ...Object.keys(opts).filter((k) => k !== pref)];
  for (const k of order) {
    const [u, v, a] = opts[k];
    // desk + the teacher's chair behind it (+dv)
    const [cu, cv] = rc.at(u, v, a, 0, 0.3);
    if (!rc.fits(cu, cv, a, 0.9, 0.85, { pad: 0.05 })) continue;
    rc.reserve(cu, cv, a, 0.9, 0.85, 0.3);
    const t = teacherDesk(rc, u, v, a, rc.accent);
    if (!t) continue;
    t.where = k;
    t.u = u;
    t.v = v;
    t.a = a;
    return t;
  }
  return null;
}

/** The storage closet (cover, wood), its front is where a chest goes. */
export function placeCloset(rc) {
  const walls = plainWalls(rc, ['front']);
  for (const wall of walls) {
    const w = rc.walls[wall];
    const pref = rc.rnd() < 0.5 ? w.s0 : w.s1;
    const P = againstWall(rc, wall, 0.5, 0.3, 2.1, pref, { pad: 0.7 });
    if (!P) continue;
    const dep = P.part(0, 0, 0.5, 0.3, 0, 2.1, { mat: 'wood', hp: 160 });
    closet(P, 0.5, 2.1, rc.closetCol, dep);
    // boxes on top
    P.dec(0.15, 0, 0.2, 0.2, 2.1, 2.36, C.cream === rc.closetCol ? C.laminate : '#c8a97e', { dep });
    return { P, dep };
  }
  return null;
}

// ------------------------------------------------------------------ perimeter

/** Shelving and storage along the plain walls; amount 0..1. */
export function perimeter(rc, amount, o = {}) {
  const rnd = rc.rnd;
  const items = o.items || ['bookshelf', 'bookshelf', 'cubbies', 'filing', 'fridge', 'cart', 'plant', 'lowshelf', 'counter'];
  const n = Math.round(4 + amount * 6);
  // low storage under the hallway glass (below the 1.0 m sill)
  for (const w of Object.values(rc.walls)) {
    if (!w.glazed || w.ext) continue;
    for (let k = 0; k < 2; k++) {
      const hs = pick(rnd, [0.7, 1.0]);
      const P = againstWall(rc, w.name, hs, 0.18, 0.85, range(rnd, w.s0, w.s1), { windows: false });
      if (!P) continue;
      const dep = P.part(0, 0, hs, 0.18, 0, 0.85, { mat: 'wood', hp: 120 });
      if (rnd() < 0.5) cubbies(P, hs, 2, C.woodLight, [rc.accent.base, rc.accent.light, ...PAPER.slice(0, 4)], dep);
      else bookshelf(P, hs, 0.85, C.woodLight, dep, 0.75);
    }
  }
  for (let k = 0; k < n; k++) {
    const walls = plainWalls(rc, rnd() < 0.8 ? ['front'] : []);
    if (!walls.length) return;
    const wall = pick(rnd, walls);
    const w = rc.walls[wall];
    const kind = pick(rnd, items);
    const pref = range(rnd, w.s0, w.s1);
    if (kind === 'bookshelf') {
      const hs = pick(rnd, [0.45, 0.6, 0.9]);
      const h = pick(rnd, [1.2, 1.8, 2.0]);
      const P = againstWall(rc, wall, hs, 0.18, h, pref);
      if (!P) continue;
      const dep = P.part(0, 0, hs, 0.18, 0, h, { mat: 'wood', hp: 140 });
      bookshelf(P, hs, h, pick(rnd, [C.woodLight, C.woodMid, C.laminate]), dep, range(rnd, 0.5, 0.95));
    } else if (kind === 'lowshelf') {
      const hs = pick(rnd, [0.6, 0.9]);
      const P = againstWall(rc, wall, hs, 0.18, 0.95, pref, { windows: false });
      if (!P) continue;
      const dep = P.part(0, 0, hs, 0.18, 0, 0.95, { mat: 'wood', hp: 120 });
      bookshelf(P, hs, 0.95, C.woodLight, dep, 0.7);
      if (rnd() < 0.5) {
        P.cyl(hs * 0.5, 0, 0.09, 0.95, 1.09, C.pot, { dep });
        P.cyl(hs * 0.5, 0, 0.15, 1.09, 1.3, C.green, { dep });
      }
    } else if (kind === 'cubbies') {
      const hs = pick(rnd, [0.7, 1.0]);
      const P = againstWall(rc, wall, hs, 0.16, 1.0, pref, { windows: false });
      if (!P) continue;
      const dep = P.part(0, 0, hs, 0.16, 0, 1.0, { mat: 'wood', hp: 120 });
      cubbies(P, hs, 3, C.woodLight, [rc.accent.base, rc.accent.light, ...PAPER.slice(0, 4)], dep);
    } else if (kind === 'filing') {
      const P = againstWall(rc, wall, 0.23, 0.32, 1.32, pref);
      if (P) filing(P, pick(rnd, [C.greyLight, C.charcoal, C.cream]), P.part(0, 0, 0.23, 0.32, 0, 1.32, { mat: 'metal', hp: 200 }));
    } else if (kind === 'fridge') {
      const P = againstWall(rc, wall, 0.26, 0.26, 1.15, pref, { windows: false });
      if (P) miniFridge(P, rnd() < 0.5);
    } else if (kind === 'cart') {
      const P = againstWall(rc, wall, 0.44, 0.28, 1.1, pref, { windows: false });
      if (P) cart(P, pick(rnd, [C.charcoal, C.plasticBlue, C.greyLight]));
    } else if (kind === 'plant') {
      const P = againstWall(rc, wall, 0.33, 0.33, 1.4, pref, { windows: false });
      if (P) floorPlant(P);
    } else if (kind === 'counter') {
      const hs = pick(rnd, [0.9, 1.2, 1.5]);
      const P = againstWall(rc, wall, hs, 0.3, 0.9, pref, { windows: false });
      if (!P) continue;
      const dep = P.part(0, 0, hs, 0.3, 0, 0.9, { mat: 'wood', hp: 140 });
      counter(P, hs, 0.9, C.woodLight, C.laminate, dep);
      rc.counters.push({ P, hs, dep });
    }
  }
  // trash + recycling, near a door
  for (const d of rc.doors.slice(0, 1)) {
    const w = rc.walls[d.wall];
    const side = d.s > (w.s0 + w.s1) / 2 ? -1 : 1;
    const P = againstWall(rc, d.wall, 0.45, 0.22, 0.65, d.s + side * (d.w / 2 + 3.0), { windows: false });
    if (P) bins(P);
  }
}

// ------------------------------------------------------------------ clutter

/** Backpacks on chairs / the floor, a lost hoodie, papers and books on desks; amount 0..1. */
export function clutter(rc, amount) {
  const rnd = rc.rnd;
  for (const s of rc.seats) {
    if (s.task) continue;
    const r = rnd();
    if (r < amount * 0.18) backpack(place(rc, ...rc.at(s.u, s.v, s.a, 0, 0.05), s.a + range(rnd, -0.4, 0.4), s.y || 0), pick(rnd, BAGS), 0.46);
    else if (r < amount * 0.3) backpack(place(rc, ...rc.at(s.u, s.v, s.a, 0.33, 0.1), s.a + range(rnd, -1, 1), s.y || 0), pick(rnd, BAGS), 0);
  }
  // the lost hoodie (one per room at most)
  if (rc.seats.length && rnd() < 0.35 + amount * 0.4) {
    const s = rc.seats[Math.floor(rnd() * rc.seats.length)];
    if (!s.task) hoodie(place(rc, s.u, s.v, s.a, s.y || 0), pick(rnd, [rc.accent.dark, ...BAGS]));
  }
  for (const t of rc.tops) deskClutter(rc, t, amount * 0.7);
}

// ------------------------------------------------------------------ loot

/**
 * About one loot spot per room: a chest in front of the closet in ~1 room in 4 (by the room hash),
 * otherwise an item or an ammo box on the teacher desk / a counter / the floor.
 */
export function placeLoot(rc, teacher, closetInfo) {
  const K = rc.K;
  const roll = (rc.hash % 1000) / 1000;
  const world = (u, v) => rc.F.toW(u, v);
  let chest = null;
  if (roll < 0.64) {
    if (closetInfo) {
      const [u, v] = closetInfo.P.pt(0, -0.85);
      const [x, z] = world(u, v);
      K.loot({ kind: 'chest', x, y: rc.base, z, yaw: rc.F.yaw + closetInfo.P.a + Math.PI });
      chest = 'chest';
    } else if (teacher) {
      const [u, v] = rc.at(teacher.u, teacher.v, teacher.a, -1.15, 0.45);
      if (rc.fits(u, v, 0, 0.3, 0.3, { reserve: false })) {
        const [x, z] = world(u, v);
        K.loot({ kind: 'chest', x, y: rc.base, z, yaw: rc.F.yaw + teacher.a });
        chest = 'chest';
      }
    }
    if (chest && !teacher) return chest;
  }
  const kind = ((rc.hash >>> 10) % 100) < 55 ? 'item' : 'ammoBox';
  if (chest) {
    const [u, v] = rc.at(teacher.u, teacher.v, teacher.a, 0.1, 0.05);
    const [x, z] = world(u, v);
    K.loot({ kind, x, y: rc.y + teacher.y, z, yaw: rc.F.yaw + teacher.a });
    return chest;
  }
  if (teacher) {
    const [u, v] = rc.at(teacher.u, teacher.v, teacher.a, 0.1, 0.05);
    const [x, z] = world(u, v);
    K.loot({ kind, x, y: rc.y + teacher.y, z, yaw: rc.F.yaw + teacher.a });
    return kind;
  }
  const c = rc.counters[0];
  if (c) {
    const [u, v] = c.P.pt(0, 0);
    const [x, z] = world(u, v);
    K.loot({ kind, x, y: rc.y + (c.h || 0.9), z, yaw: rc.F.yaw + c.P.a });
    return kind;
  }
  // the floor near the room centre, clear of reserved props
  for (let k = 0; k < 40; k++) {
    const u = range(rc.rnd, -rc.W / 3, rc.W / 3);
    const v = range(rc.rnd, -rc.D / 3, rc.D / 3);
    if (!rc.fits(u, v, 0, 0.4, 0.4)) continue;
    const [x, z] = world(u, v);
    K.loot({ kind, x, y: rc.base, z, yaw: 0 });
    return kind;
  }
  return null;
}

// ------------------------------------------------------------------ lighting

const MOODS = {
  normal: { intensity: 0.8, color: 0xfff3e0 },
  bright: { intensity: 1.0, color: 0xfffaf0 },
  warm: { intensity: 0.65, color: 0xffe2b8 },
  cool: { intensity: 0.85, color: 0xdde9ff },
  dim: { intensity: 0.38, color: 0xc9d6ea },
};
export const MOOD_NAMES = Object.keys(MOODS);

/**
 * Room light by mood: retune the plan's ceiling light for this room (or add one and lay-in fixtures
 * where the plan draws none: labs, music rooms, galleries), switch off fixture rows in a dim room,
 * and a warm desk-lamp spot on the teacher desk.
 */
export function lightRoom(rc, teacher) {
  const K = rc.K;
  const { room } = rc;
  const m = MOODS[rc.mood] || MOODS.normal;
  const cx = (room.x0 + room.x1) / 2;
  const cz = (room.z0 + room.z1) / 2;
  const own = K.lights.find((L) => L.room === room.id && Math.abs(L.x - cx) < 0.05 && Math.abs(L.z - cz) < 0.05 && Math.abs(L.y - rc.y - rc.H) < 1.2);
  const ceilY = rc.y + rc.H;
  if (own) {
    own.intensity = m.intensity;
    own.color = m.color;
  } else {
    // fixtures on a 2.4 x 3 m grid over the usable rect + a centre light
    const { ir } = rc.geo;
    for (let x = ir.x0 + 1.2; x < ir.x1 - 0.6; x += 2.4)
      for (let z = ir.z0 + 1.5; z < ir.z1 - 0.6; z += 3.0) {
        const ok = rc.mood !== 'dim' || Math.round((x - ir.x0) / 2.4) % 2 === 0;
        K.decor({ cx: x, cz: z, hx: 0.3, hz: 0.6, yaw: 0, y0: ceilY - 0.03, y1: ceilY - 0.005 }, ok ? 'fixture' : C.greyLight);
        K.decor({ cx: x, cz: z, hx: 0.015, hz: 0.015, yaw: 0, y0: ceilY - 0.005, y1: ceilY + 0.6 }, C.charcoal);
        rc.stats.decor += 2;
      }
    K.light({ x: cx, y: ceilY - 0.5, z: cz, range: Math.max(9, Math.hypot(room.x1 - room.x0, room.z1 - room.z0) * 0.6), intensity: m.intensity, color: m.color, room: room.id });
  }
  if (rc.mood === 'dim' && own) {
    // every other fixture row off
    for (const d of K.decors) {
      if (d.look !== 'fixture' || d.group !== K.group) continue;
      if (d.cx < room.x0 || d.cx > room.x1 || d.cz < room.z0 || d.cz > room.z1 || Math.abs(d.y1 - ceilY) > 0.2) continue;
      if (Math.round((d.cz - room.z0 - 1.5) / 3) % 2 === 0) d.look = C.greyLight;
    }
  }
  if (teacher && (rc.mood === 'warm' || rc.mood === 'dim')) {
    const L = teacher.P.sub(0.55, 0.1);
    deskLamp(L, teacher.y, teacher.top);
    const [x, z] = rc.F.toW(...L.pt(0, 0));
    K.light({ x, y: rc.y + 1.3, z, range: 4.5, intensity: 0.55, color: 0xffc98a, room: room.id });
  }
}

