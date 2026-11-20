// BENTONVILLE ROYALE — Bentonville High School: Tiger Arena (competition gym) + auxiliary gym.
// Owned by the gym subagent (docs/bhs/BHS_CONTRACT.md). Called by src/world/bhs/south.js with the kit
// K and ctx (hero rects, plan, storey height). Builds ONLY inside ctx.ARENA / ctx.AUX_GYM.
//
// There are no photos of either gym, so everything here is *approximate*: typical US high school
// competition-gym detailing in the style-bible palette (STYLE_BIBLE.md §4 "Gym / arena") and the
// school colours, black and gold. The exterior photos [3DF, L3D] show the big white roof with a
// barrel skylight: it is lit from inside here as a daylight panel over centre court.
//
// Tiger Arena (50 x 59 m, 13.6 m roof):
//   - maple floor (board strips), a high-school basketball court (84 x 50 ft) along z: white lines,
//     gold lanes, a black out-of-bounds border, a centre circle with an original tiger emblem drawn
//     in floor paint (simple shapes; not the school's artwork), volleyball lines + net-post sleeves
//   - telescoping bleachers along both long sides: 12 rows, 0.4 m rise / 0.8 m tread, aisles with
//     half steps, gold step nosings, end rails; the east side opens at the floor-level entry
//   - an upper concourse / running-track balcony behind the top rows at y = 4.8 on both long sides,
//     reached by four corner stairs (K.stairs), with railings
//   - ceiling-hung main backstops at the court ends (the hall is 59 m long: the end walls are 15 m
//     behind the baselines, so wall-mounted goals cannot reach), fold-up practice hoops and wall
//     pads on the end walls, a blank scoreboard on each end wall, black / gold banners (emblem only)
//   - exposed steel trusses + bar joists under a white metal deck, high-bay fixtures, blue ducts
//   - wall clock, exit door frames + signs (blank), scorer's table, team benches
// Auxiliary gym (30 x 25 m, 11.6 m roof): practice court along x with wall-mounted goals, wall
//   pads, a climbing wall, climbing ropes, stacked mats and a portable 4-row bleacher.
// Gameplay: rows / aisles are walkable steps (rise 0.4 <= 0.6) and solid cover; loot on surfaces,
// one high-tier chest on the west concourse. Groups: 'int:south:0' floor level, 'int:south:1' upper.

import { subtractRects } from '../../kit/builder.js';

// ---------------------------------------------------------------- dimensions (m)
export const RISE = 0.4; // bleacher row rise (walkable: < STEP 0.62)
export const TREAD = 0.8; // bleacher row depth
export const ROWS = 12;
export const CONC = 4.0; // concourse depth from the long walls
export const CONC_Y = ROWS * RISE; // 4.8: concourse deck = top row
const FRONT = CONC + ROWS * TREAD; // 13.6: bleacher front, from the wall face
const WALL = 0.12; // inner wall faces (0.2 m partitions + 2 cm)
const WALL_HI = 0.2; // above 8.4 the raised walls are 0.35 m thick
const AISLE_W = 1.1;
const Y0 = 0.04; // floor top (the map's ground layers draw over y = 0)
const LAYER = (n) => Y0 + 0.004 * n;

// colours (approximate: no photos)
const COL = {
  mapleTones: ['#cda672', '#c7a06a', '#d2ad78', '#c29b63', '#cba46e'],
  maple: '#c8a16a',
  black: '#1b1c1f',
  gold: '#c9a54a',
  white: '#f1efe8',
  navy: '#2b3036',
  steel: '#3a3d42',
  truss: '#7d828a',
  joist: '#c9cac6',
  riser: '#2a2c30',
  foot: '#7f7a72',
  bench: '#c49d72',
  track: '#9a5546',
  pad: '#1f2126',
  orange: '#d8682a',
  net: '#eeeeea',
  segOff: '#4a1d16',
  window: '#141212',
  exit: '#3a9a58',
};

/** Information for tests (filled by buildGym; deterministic). */
export const GYM = {};

const TOP_ONLY = (look) => ({ top: look, pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' });
const BOTTOM_ONLY = (look) => ({ bottom: look, top: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none' });
const rect = (x0, x1, z0, z1, y0, y1) => ({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hz: Math.abs(z1 - z0) / 2, yaw: 0, y0, y1 });

// ---------------------------------------------------------------- floor paint helpers

/** A flat painted rect (top face only) whose top is at y. */
function flat(K, x0, x1, z0, z1, y, look) {
  return K.decor(rect(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), y - 0.003, y), look, { faces: TOP_ONLY(look) });
}
/** A flat oriented rect centred at (cx, cz). */
function flatO(K, cx, cz, hx, hz, yaw, y, look) {
  return K.decor({ cx, cz, hx, hz, yaw, y0: y - 0.003, y1: y }, look, { faces: TOP_ONLY(look) });
}
/** A painted stroke a -> b, w wide (slightly extended so joints close). */
function stroke(K, a, b, w, y, look) {
  const o = K.along(a, b, w, y - 0.003, y);
  o.hx += w / 2;
  return K.decor(o, look, { faces: TOP_ONLY(look) });
}
/** A painted disc: the union of 6 inscribed rects (24-gon, edge >= 0.966 r). */
function disc(K, cx, cz, r, y, look) {
  const a = Math.cos(Math.PI / 12) * r;
  const b = Math.sin(Math.PI / 12) * r;
  for (let k = 0; k < 6; k++) flatO(K, cx, cz, a, b, (k * Math.PI) / 6, y, look);
}
/** A painted arc line (centre, radius r, angles a0 -> a1 in the x-z plane: angle 0 = +x, PI/2 = +z). */
function arc(K, cx, cz, r, a0, a1, w, y, look, n = 24, dashed = false) {
  for (let i = 0; i < n; i++) {
    if (dashed && i % 2) continue;
    const t0 = a0 + ((a1 - a0) * i) / n;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
    stroke(K, [cx + Math.cos(t0) * r, cz + Math.sin(t0) * r], [cx + Math.cos(t1) * r, cz + Math.sin(t1) * r], w, y, look);
  }
}

/**
 * Maple floor: board strips (0.25 m, 1.8-4.4 m long, staggered, a few tones). along: 'z' | 'x'
 * (board direction). hidden(x0, x1, z0, z1) -> true where something solid covers the floor (skipped).
 */
function maple(K, R, along, hidden) {
  const W = 0.25;
  const [s0, s1, t0, t1] = along === 'z' ? [R.x0, R.x1, R.z0, R.z1] : [R.z0, R.z1, R.x0, R.x1];
  const tones = COL.mapleTones;
  // one underlay quad: the seams between staggered strips never show the ground through
  K.decor(rect(R.x0, R.x1, R.z0, R.z1, Y0 - 0.008, Y0 - 0.005), COL.maple, { faces: TOP_ONLY(COL.maple) });
  for (let s = s0; s < s1 - 1e-6; s += W) {
    const sa = s;
    const sb = Math.min(s1, s + W);
    let t = t0 - K.rnd() * 3;
    while (t < t1 - 1e-6) {
      const L = 1.8 + K.rnd() * 2.6;
      const look = tones[Math.floor(K.rnd() * tones.length)];
      const ta = Math.max(t0, t);
      const tb = Math.min(t1, t + L);
      t += L;
      if (tb - ta < 0.02) continue;
      const [x0, x1, z0, z1] = along === 'z' ? [sa, sb, ta, tb] : [ta, tb, sa, sb];
      if (hidden(x0, x1, z0, z1)) continue;
      flat(K, x0, x1, z0, z1, Y0, look);
    }
  }
}

// ---------------------------------------------------------------- wall-plane helpers

/**
 * A wall frame: the inner face of a wall. axis 'x' = the wall runs along z at x = c; axis 'z' = it runs
 * along x at z = c. n = +1 / -1: the direction into the room. u = position along the wall (world x
 * for an axis-'z' wall, world z for an axis-'x' wall); off = distance out from the face.
 */
const wallF = (axis, c, n) => ({ axis, c, n, front: axis === 'z' ? (n > 0 ? 'pv' : 'nv') : n > 0 ? 'pu' : 'nu' });
function wbox(W, u0, u1, off0, off1, y0, y1) {
  const o0 = W.c + W.n * off0;
  const o1 = W.c + W.n * off1;
  return W.axis === 'z' ? rect(u0, u1, Math.min(o0, o1), Math.max(o0, o1), y0, y1) : rect(Math.min(o0, o1), Math.max(o0, o1), u0, u1, y0, y1);
}
const wdecor = (K, W, u0, u1, off0, off1, y0, y1, look, opts) => K.decor(wbox(W, u0, u1, off0, off1, y0, y1), look, opts);
/** Decor with only its front face (toward the room) drawn. */
function wface(K, W, u0, u1, off0, off1, y0, y1, look) {
  const f = { top: 'none', bottom: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none' };
  f[W.front] = look;
  return K.decor(wbox(W, u0, u1, off0, off1, y0, y1), look, { faces: f });
}
/** A world point [x, z] on wall W at (u, off). */
const wpt = (W, u, off) => (W.axis === 'z' ? [u, W.c + W.n * off] : [W.c + W.n * off, u]);

/** Painted band on a wall (covers the slab-edge reveal at the first-floor line). */
function wallBand(K, W, u0, u1, y0, y1, look) {
  wdecor(K, W, u0, u1, 0, 0.025, y0, y1, look);
}

/** Wall pads: 1.2 m panels with reveals, y 0.1..2.0, skipping [a, b] spans. */
function wallPads(K, W, u0, u1, skip = []) {
  const P = 1.2;
  for (let u = u0; u < u1 - 0.3; u += P) {
    const a = u + 0.012;
    const b = Math.min(u1, u + P) - 0.012;
    if (skip.some(([s0, s1]) => b > s0 && a < s1)) continue;
    wdecor(K, W, a, b, 0, 0.07, 0.1, 2.0, COL.pad);
  }
  // gold cap line along the top
  const runs = subtractRects({ x0: u0, x1: u1, z0: 0, z1: 1 }, skip.map(([s0, s1]) => ({ x0: s0, x1: s1, z0: -1, z1: 2 })));
  for (const r of runs) wdecor(K, W, r.x0, r.x1, 0, 0.08, 2.0, 2.06, COL.gold);
}

/** Door surround on the room side: steel frame + a blank exit sign above (no text). */
function exitFrame(K, W, u, w) {
  const h = 2.26;
  for (const s of [-1, 1]) wdecor(K, W, u + s * (w / 2 + 0.05) - 0.06, u + s * (w / 2 + 0.05) + 0.06, 0, 0.06, 0, h, COL.riser);
  wdecor(K, W, u - w / 2 - 0.11, u + w / 2 + 0.11, 0, 0.06, h - 0.08, h + 0.04, COL.riser);
  wdecor(K, W, u - 0.2, u + 0.2, 0, 0.1, h + 0.22, h + 0.42, COL.exit);
  wface(K, W, u - 0.15, u + 0.15, 0.1, 0.105, h + 0.27, h + 0.37, 'fixture');
}

/** Wall clock: a round face (stacked slices) with a black rim and two hands, centre (u, y). */
function clock(K, W, u, y, r = 0.32) {
  const n = 7;
  for (let i = 0; i < n; i++) {
    const yy0 = -r + (2 * r * i) / n;
    const yy1 = -r + (2 * r * (i + 1)) / n;
    const ym = Math.abs((yy0 + yy1) / 2);
    const hw = Math.sqrt(Math.max(0, r * r - ym * ym));
    wdecor(K, W, u - hw, u + hw, 0, 0.06, y + yy0, y + yy1, COL.black);
    const hi = Math.sqrt(Math.max(0, (r - 0.04) ** 2 - ym * ym));
    if (hi > 0.02) wface(K, W, u - hi, u + hi, 0.06, 0.065, Math.max(y + yy0, y - r + 0.04), Math.min(y + yy1, y + r - 0.04), '#f4f2ea');
  }
  wface(K, W, u - 0.012, u + 0.012, 0.065, 0.07, y, y + r * 0.7, COL.black); // minute hand (12)
  wface(K, W, u, u + r * 0.5, 0.065, 0.07, y - 0.012, y + 0.012, COL.black); // hour hand (3)
}

/** Hanging banner: body + trim + pointed foot, emblem disc (no text). */
function banner(K, W, u, y0, y1, body, trim) {
  const hw = 0.7;
  wdecor(K, W, u - hw - 0.05, u + hw + 0.05, 0, 0.04, y1 - 0.08, y1, COL.steel); // hanging rod
  wdecor(K, W, u - hw, u + hw, 0.01, 0.04, y0 + 0.5, y1 - 0.08, body);
  for (let i = 0; i < 4; i++) {
    const w = hw * (1 - (i + 1) / 5);
    wdecor(K, W, u - w, u + w, 0.01, 0.04, y0 + 0.5 - 0.125 * (i + 1), y0 + 0.5 - 0.125 * i, body);
  }
  wface(K, W, u - hw, u + hw, 0.04, 0.045, y1 - 0.3, y1 - 0.22, trim);
  wface(K, W, u - hw, u + hw, 0.04, 0.045, y0 + 0.62, y0 + 0.7, trim);
  wface(K, W, u - 0.5, u + 0.5, 0.045, 0.05, y1 - 1.4, y1 - 0.4, 'emblem');
}

/** Dim 7-segment digit (all segments off: a blank board), lower-left (u, y), 0.42 x 0.72. */
function digit(K, W, u, y, off) {
  const w = 0.42;
  const h = 0.72;
  const t = 0.06;
  const seg = (a0, a1, b0, b1) => wface(K, W, u + a0, u + a1, off, off + 0.005, y + b0, y + b1, COL.segOff);
  seg(t, w - t, h - t, h); // a
  seg(t, w - t, h / 2 - t / 2, h / 2 + t / 2); // g
  seg(t, w - t, 0, t); // d
  for (const x of [0, w - t]) {
    seg(x, x + t, t, h / 2 - t / 2);
    seg(x, x + t, h / 2 + t / 2, h - t);
  }
}

/** Blank scoreboard centred at u on an end wall (body y0..y0 + 3). */
function scoreboard(K, W, u, y0) {
  const hw = 3.2;
  const d = 0.35;
  wdecor(K, W, u - hw - 0.12, u + hw + 0.12, WALL_HI, WALL_HI + d - 0.05, y0 - 0.12, y0 + 3.12, COL.gold);
  wdecor(K, W, u - hw, u + hw, WALL_HI, WALL_HI + d, y0, y0 + 3.0, COL.black);
  const f = WALL_HI + d; // front face offset
  wface(K, W, u - hw, u + hw, f, f + 0.01, y0 + 2.35, y0 + 3.0, COL.gold); // blank fascia
  wface(K, W, u - 0.3, u + 0.3, f + 0.01, f + 0.015, y0 + 2.38, y0 + 2.98, 'emblem');
  wface(K, W, u - hw, u + hw, f, f + 0.01, y0, y0 + 0.08, COL.gold);
  // score windows (2 digits each), the clock (4 digits), period / bonus windows
  const win = (a, b, c0, c1) => wface(K, W, u + a, u + b, f, f + 0.012, y0 + c0, y0 + c1, COL.window);
  const digits = (a, n, yy) => {
    for (let i = 0; i < n; i++) digit(K, W, u + a + 0.08 + i * 0.5, y0 + yy, f + 0.012);
  };
  win(-3.0, -1.85, 1.25, 2.15);
  digits(-3.0, 2, 1.34);
  win(1.85, 3.0, 1.25, 2.15);
  digits(1.85, 2, 1.34);
  win(-1.1, 1.1, 1.25, 2.15);
  digits(-1.08, 4, 1.34);
  wface(K, W, u - 0.03, u + 0.03, f + 0.012, f + 0.017, y0 + 1.6, y0 + 1.66, COL.segOff); // colon
  wface(K, W, u - 0.03, u + 0.03, f + 0.012, f + 0.017, y0 + 1.8, y0 + 1.86, COL.segOff);
  for (const a of [-2.7, -0.3, 2.1]) {
    win(a, a + 0.6, 0.25, 1.0);
    digit(K, W, u + a + 0.09, y0 + 0.27, f + 0.012);
  }
  // possession arrows (dim) and horn grille
  wface(K, W, u - 1.7, u - 1.4, f, f + 0.012, y0 + 0.5, y0 + 0.7, COL.segOff);
  wface(K, W, u + 1.4, u + 1.7, f, f + 0.012, y0 + 0.5, y0 + 0.7, COL.segOff);
}

// ---------------------------------------------------------------- basketball goals

/** Rim (10 segments), net (3 rings + 8 strings) at centre (x, z), rim height y. */
function rimNet(K, x, z, y) {
  const r = 0.23;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const o = K.along([x + Math.cos(a0) * r, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, z + Math.sin(a1) * r], 0.025, y - 0.015, y + 0.015);
    o.hx += 0.012;
    K.decor(o, COL.orange);
  }
  for (const [rr, yy] of [[0.21, y - 0.12], [0.18, y - 0.26], [0.15, y - 0.4]]) {
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2;
      const a1 = ((i + 1) / 8) * Math.PI * 2;
      const o = K.along([x + Math.cos(a0) * rr, z + Math.sin(a0) * rr], [x + Math.cos(a1) * rr, z + Math.sin(a1) * rr], 0.012, yy - 0.008, yy + 0.008);
      K.decor(o, COL.net);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    K.decor({ cx: x + Math.cos(a) * 0.19, cz: z + Math.sin(a) * 0.19, hx: 0.006, hz: 0.006, yaw: a, y0: y - 0.42, y1: y - 0.01 }, COL.net);
  }
}

/**
 * Backboard + rim + net. P(u, off) -> [x, z]: u across the board, off toward the court from the
 * board face; yaw of the board plane. Board 1.83 x 1.07, bottom at 2.9, rim 3.05 (regulation).
 */
function goal(K, P, yaw, { glass = true } = {}) {
  const c = P(0, -0.02);
  K.decor({ cx: c[0], cz: c[1], hx: 0.915, hz: 0.015, yaw, y0: 2.9, y1: 3.97 }, glass ? 'glass' : COL.white);
  // white border + shooter's square (on the court side)
  const bar = (u0, u1, y0, y1) => {
    const m = P((u0 + u1) / 2, 0.002);
    K.decor({ cx: m[0], cz: m[1], hx: (u1 - u0) / 2, hz: 0.006, yaw, y0, y1 }, COL.white);
  };
  bar(-0.915, 0.915, 3.92, 3.97);
  bar(-0.915, 0.915, 2.9, 2.95);
  bar(-0.915, -0.865, 2.9, 3.97);
  bar(0.865, 0.915, 2.9, 3.97);
  bar(-0.305, 0.305, 3.46, 3.51);
  bar(-0.305, -0.26, 3.05, 3.51);
  bar(0.26, 0.305, 3.05, 3.51);
  bar(-0.305, 0.305, 3.05, 3.1);
  // bottom edge pad
  const pd = P(0, -0.02);
  K.decor({ cx: pd[0], cz: pd[1], hx: 0.93, hz: 0.06, yaw, y0: 2.82, y1: 2.93 }, COL.black);
  // rim bracket + rim + net
  const br = P(0, 0.08);
  K.decor({ cx: br[0], cz: br[1], hx: 0.12, hz: 0.08, yaw, y0: 2.98, y1: 3.06 }, COL.orange);
  const rc = P(0, 0.15 + 0.23);
  rimNet(K, rc[0], rc[1], 3.05);
}

/** A slanted member a -> b in a vertical plane (stepped boxes, like a truss diagonal). */
function slant(K, a, ya, b, yb, t, look, n = 5) {
  for (let i = 0; i < n; i++) {
    const f0 = i / n;
    const f1 = (i + 1) / n;
    const p0 = [a[0] + (b[0] - a[0]) * f0, a[1] + (b[1] - a[1]) * f0];
    const p1 = [a[0] + (b[0] - a[0]) * f1, a[1] + (b[1] - a[1]) * f1];
    const y0 = ya + (yb - ya) * f0;
    const y1 = ya + (yb - ya) * f1;
    const o = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.01 ? K.along(p0, p1, t, Math.min(y0, y1) - t / 2, Math.max(y0, y1) + t / 2) : { cx: p0[0], cz: p0[1], hx: t / 2, hz: t / 2, yaw: 0, y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
    K.decor(o, look);
  }
}

/** Ceiling-hung backstop: board facing dir (+1 = +z), mast at zMast up to yTop. */
function hungBackstop(K, x, zFace, dir, zMast, yTop) {
  const P = (u, off) => [x + u, zFace + dir * off];
  goal(K, P, 0);
  const S = COL.steel;
  // board frame behind the board, arm back to the mast, the mast up to the truss
  const zf0 = Math.min(zFace - dir * 0.1, zFace - dir * 0.04);
  const zf1 = Math.max(zFace - dir * 0.1, zFace - dir * 0.04);
  for (const s of [-0.5, 0.5]) K.decor(rect(x + s - 0.04, x + s + 0.04, zf0, zf1, 3.0, 4.35), S);
  K.decor(rect(x - 0.55, x + 0.55, zf0, zf1, 3.4, 3.48), S);
  K.decor(rect(x - 0.07, x + 0.07, Math.min(zFace - dir * 0.1, zMast), Math.max(zFace - dir * 0.1, zMast), 4.2, 4.35), S);
  K.decor(rect(x - 0.09, x + 0.09, zMast - 0.09, zMast + 0.09, 4.2, yTop), S);
  slant(K, [x, zFace - dir * 0.1], 4.3, [x, zMast], 7.2, 0.09, S, 7);
  // side sway braces from the mast to the truss
  for (const s of [-1, 1]) slant(K, [x, zMast], 8.2, [x + s * 3.2, zMast], yTop, 0.07, S, 8);
  // a small shot clock on the frame (blank)
  K.decor(rect(x - 0.25, x + 0.25, Math.min(zFace - dir * 0.1, zFace - dir * 0.3), Math.max(zFace - dir * 0.1, zFace - dir * 0.3), 4.36, 4.66), COL.black);
  K.decor({ cx: x, cz: zFace - dir * 0.1 + dir * 0.005, hx: 0.18, hz: 0.004, yaw: 0, y0: 4.42, y1: 4.6 }, COL.segOff);
}

/** Wall-mounted goal on wall W at u, board face `reach` m out from the wall (frame braced to the wall). */
function wallGoal(K, W, u, reach) {
  const yaw = W.axis === 'z' ? 0 : Math.PI / 2;
  goal(K, (uu, off) => wpt(W, u + uu, reach + off), yaw);
  const S = COL.steel;
  // frame: a box truss from the wall to the board (top + bottom rails, posts, diagonal)
  for (const s of [-0.5, 0.5]) {
    wdecor(K, W, u + s - 0.05, u + s + 0.05, 0, reach - 0.04, 4.2, 4.32, S);
    wdecor(K, W, u + s - 0.05, u + s + 0.05, 0, reach - 0.04, 3.0, 3.1, S);
    wdecor(K, W, u + s - 0.06, u + s + 0.06, 0, 0.12, 2.6, 5.2, S);
    slant(K, wpt(W, u + s, 0.12), 5.1, wpt(W, u + s, reach - 0.1), 4.3, 0.07, S, 6);
  }
  wdecor(K, W, u - 0.55, u + 0.55, reach - 0.1, reach - 0.04, 2.95, 4.32, S);
}

/** Fold-up practice goal on wall W at u, folded up: board horizontal under the bracket. */
function foldedGoal(K, W, u) {
  const S = COL.steel;
  for (const s of [-0.5, 0.5]) {
    wdecor(K, W, u + s - 0.05, u + s + 0.05, 0, 0.14, 3.6, 5.6, S);
    slant(K, wpt(W, u + s, 0.14), 3.8, wpt(W, u + s, 1.3), 5.3, 0.06, S, 6);
  }
  // the board, swung up flat (face down) and its rim hanging below it
  K.decor(wbox(W, u - 0.915, u + 0.915, 0.2, 1.27, 5.3, 5.34), 'glass');
  wdecor(K, W, u - 0.915, u + 0.915, 1.22, 1.27, 5.26, 5.36, COL.white);
  wdecor(K, W, u - 0.915, u + 0.915, 0.2, 0.25, 5.26, 5.36, COL.white);
  wdecor(K, W, u - 0.04, u + 0.04, 0.6, 0.66, 4.85, 5.3, COL.orange);
  wdecor(K, W, u - 0.23, u + 0.23, 0.6, 0.66, 4.82, 4.86, COL.orange);
  for (const s of [-1, 1]) wdecor(K, W, u + s * 0.23 - 0.02, u + s * 0.23 + 0.02, 0.6, 0.66, 4.4, 4.86, COL.orange);
  wdecor(K, W, u - 0.23, u + 0.23, 0.6, 0.66, 4.38, 4.42, COL.orange);
  wdecor(K, W, u - 0.2, u + 0.2, 0.62, 0.64, 4.0, 4.38, COL.net);
}

// ---------------------------------------------------------------- roof structure

/** A steel truss in the vertical plane: axis 'x' = runs along x at z = c (s0..s1); 'z' = along z at x = c. */
function truss(K, axis, c, s0, s1, yb, yt, panel = 2.5) {
  const S = COL.truss;
  const P = (u) => (axis === 'x' ? [u, c] : [c, u]);
  const box = (u0, u1, y0, y1, t) => {
    const a = P(u0);
    const b = P(u1);
    K.decor(axis === 'x' ? rect(a[0], b[0], c - t, c + t, y0, y1) : rect(c - t, c + t, a[1], b[1], y0, y1), S);
  };
  box(s0, s1, yt - 0.18, yt, 0.1);
  box(s0, s1, yb, yb + 0.16, 0.1);
  const n = Math.max(2, Math.round((s1 - s0) / panel));
  for (let i = 0; i <= n; i++) {
    const u = s0 + ((s1 - s0) * i) / n;
    box(u - 0.05, u + 0.05, yb, yt, 0.06);
    if (i < n) {
      const u1 = s0 + ((s1 - s0) * (i + 1)) / n;
      if (i % 2) slant(K, P(u), yb + 0.1, P(u1), yt - 0.1, 0.07, S, 4);
      else slant(K, P(u), yt - 0.1, P(u1), yb + 0.1, 0.07, S, 4);
    }
  }
}

/** High-bay fixture hung at y (lens bottom) on a rod up to yRod. */
function highBay(K, x, z, y, yRod) {
  K.decor({ cx: x, cz: z, hx: 0.42, hz: 0.42, yaw: 0, y0: y + 0.04, y1: y + 0.32 }, '#d9dad6', { shape: 'cyl' });
  K.decor(rect(x - 0.38, x + 0.38, z - 0.38, z + 0.38, y, y + 0.05), 'fixture', { faces: { bottom: 'fixture', top: 'none', pu: 'fixture', nu: 'fixture', pv: 'fixture', nv: 'fixture' } });
  K.decor({ cx: x, cz: z, hx: 0.12, hz: 0.12, yaw: 0, y0: y + 0.32, y1: y + 0.5 }, '#b9bcbe', { shape: 'cyl' });
  K.decor(rect(x - 0.015, x + 0.015, z - 0.015, z + 0.015, y + 0.5, yRod), 'picket');
}

/** White metal roof deck under the roof slab (bottom face only), minus holes. */
function deck(K, R, y, roofTop, holes = [], look = 'metalWhite') {
  for (const t of roofTiles(K, R, roofTop)) {
    const q0 = { x0: Math.max(R.x0, t.x0), x1: Math.min(R.x1, t.x1), z0: Math.max(R.z0, t.z0), z1: Math.min(R.z1, t.z1) };
    if (q0.x1 - q0.x0 < 0.01 || q0.z1 - q0.z0 < 0.01) continue;
    for (const q of subtractRects(q0, holes)) K.decor(rect(q.x0, q.x1, q.z0, q.z1, y - 0.02, y), look, { faces: BOTTOM_ONLY(look), dep: t.part });
  }
}

/** The plan's raised-roof tiles (top at roofTop) over rect R, so ceiling decor hides with its tile. */
function roofTiles(K, R, roofTop) {
  const out = [];
  for (const p of K.parts) {
    if (p.role !== 'slab' || Math.abs(p.y1 - roofTop) > 1e-6 || p.yaw) continue;
    const t = { x0: p.cx - p.hx, x1: p.cx + p.hx, z0: p.cz - p.hz, z1: p.cz + p.hz, part: p };
    if (t.x1 > R.x0 && t.x0 < R.x1 && t.z1 > R.z0 && t.z0 < R.z1) out.push(t);
  }
  if (!out.length) out.push({ ...R, part: null }); // (older plan: one roof slab)
  return out;
}

// ---------------------------------------------------------------- Tiger Arena

function arena(K, A, ctx) {
  const I = { x0: A.x0 + WALL, x1: A.x1 - WALL, z0: A.z0 + WALL, z1: A.z1 - WALL };
  const CX = (A.x0 + A.x1) / 2; // -69
  const CZ = (A.z0 + A.z1) / 2; // 341.5
  const H = ctx.H;
  const ROOF_IN = A.top - 0.5 - 0.1; // underside of the raised roof slab (0.5 thick), deck 0.1 below
  const out = { I, CX, CZ, sides: [], stairs: [], loot: [] };

  // ------------------------------------------------ the two long sides (bleachers + concourse)
  // side frame: d = distance from the long wall face into the room
  const BZ0 = 323.5;
  const BZ1 = 359.5;
  const sides = [
    { name: 'west', s: 1, xw: I.x0, aisles: [329.5, 335.5, 341.5, 347.5, 353.5], gap: null },
    { name: 'east', s: -1, xw: I.x1, aisles: [329.5, 335.5, 347.5, 353.5], gap: [340.2, 343.8] },
  ];
  const xd = (S, d) => S.xw + S.s * d;
  const box = (S, d0, d1, z0, z1, y0, y1) => rect(Math.min(xd(S, d0), xd(S, d1)), Math.max(xd(S, d0), xd(S, d1)), z0, z1, y0, y1);
  const courtFace = (S) => (S.s > 0 ? 'pu' : 'nu'); // the face toward the court
  const rowTop = (k) => (k + 1) * RISE;
  const rowFront = (k) => CONC + (ROWS - k) * TREAD; // d of the row's front edge (court side)
  const rowBack = (k) => CONC + (ROWS - 1 - k) * TREAD;

  // stairs to the concourse: one at each end of each side, along the end walls (rise 4.8 over 8.7 m)
  const STAIR_L = 8.7;
  const STAIR_W = 2.0;
  const stairZ = [I.z0 + 0.25 + STAIR_W / 2, I.z1 - 0.25 - STAIR_W / 2];

  for (const S of sides) {
    K.setGroup('int:south:0');
    // sections between aisles / the entry gap
    const cuts = [];
    for (const a of S.aisles) cuts.push([a - AISLE_W / 2, a + AISLE_W / 2]);
    if (S.gap) cuts.push(S.gap);
    const sections = subtractRects({ x0: BZ0, x1: BZ1, z0: 0, z1: 1 }, cuts.map(([a, b]) => ({ x0: a, x1: b, z0: -1, z1: 2 }))).map((r) => [r.x0, r.x1]).sort((p, q) => p[0] - q[0]);
    const info = { name: S.name, s: S.s, xw: S.xw, sections, aisles: S.aisles.slice(), gap: S.gap, rows: [] };
    for (let k = 0; k < ROWS; k++) info.rows.push({ k, top: rowTop(k), x0: Math.min(xd(S, rowBack(k)), xd(S, rowFront(k))), x1: Math.max(xd(S, rowBack(k)), xd(S, rowFront(k))) });

    // rows: solid stepped boxes (walkable tops, cover), black risers, grey footboards, wood benches
    for (const [z0, z1] of sections) {
      for (let k = 0; k < ROWS; k++) {
        const top = rowTop(k);
        const faces = { top: COL.foot, pu: COL.riser, nu: COL.riser, pv: COL.riser, nv: COL.riser, bottom: 'none' };
        const p = K.box(box(S, rowBack(k), rowFront(k), z0, z1, 0, top), { mat: 'solid', harvest: 'metal', look: COL.riser, faces, role: 'bleacher' });
        // bench: on the front edge of the next row up (seat 0.45 above this row's footboard)
        if (k < ROWS - 1) {
          const d1 = rowFront(k + 1);
          K.decor(box(S, d1 - 0.34, d1 + 0.03, z0 + 0.03, z1 - 0.03, top + RISE, top + RISE + 0.05), COL.bench, { dep: p });
          K.decor(box(S, d1 - 0.02, d1 + 0.03, z0 + 0.03, z1 - 0.03, top + RISE - 0.06, top + RISE), COL.black, { dep: p });
        }
        // front kick-plate line (a thin gold stripe on the riser top edge of the first row)
        if (k === 0) K.decor(box(S, rowFront(0), rowFront(0) + 0.01, z0, z1, top - 0.06, top), COL.gold, { faces: { [courtFace(S)]: COL.gold, top: 'none', bottom: 'none', pv: 'none', nv: 'none', [courtFace(S) === 'pu' ? 'nu' : 'pu']: 'none' } });
      }
    }
    // aisles: two half steps per row (0.2 m each), gold nosings, a stepped centre handrail
    for (const a of S.aisles) {
      const z0 = a - AISLE_W / 2;
      const z1 = a + AISLE_W / 2;
      for (let k = 0; k < ROWS; k++) {
        const f = rowFront(k);
        const b = rowBack(k);
        const lo = rowTop(k) - RISE / 2;
        const hi = rowTop(k);
        const faces = (lk) => ({ top: lk, pu: COL.riser, nu: COL.riser, pv: COL.riser, nv: COL.riser, bottom: 'none' });
        const p1 = K.box(box(S, f - TREAD / 2, f, z0, z1, 0, lo), { mat: 'solid', harvest: 'metal', look: COL.riser, faces: faces(COL.foot), role: 'aisle' });
        const p2 = K.box(box(S, b, b + TREAD / 2, z0, z1, 0, hi), { mat: 'solid', harvest: 'metal', look: COL.riser, faces: faces(COL.foot), role: 'aisle' });
        K.decor(box(S, f - 0.06, f, z0, z1, lo - 0.003, lo + 0.004), COL.gold, { dep: p1 });
        K.decor(box(S, b + TREAD / 2 - 0.06, b + TREAD / 2, z0, z1, hi - 0.003, hi + 0.004), COL.gold, { dep: p2 });
        // centre handrail (drawn only): a post per row and a stepped rail
        if (k % 2 === 0) K.decor(box(S, f - 0.45, f - 0.41, a - 0.02, a + 0.02, lo, lo + 0.86), 'railCap', { dep: p1 });
        K.decor(box(S, b, f, a - 0.025, a + 0.025, hi + 0.84, hi + 0.88), 'railCap', { dep: p2 });
      }
    }
    // end rails (stepped, one per row from row 1) at the section ends and along the entry gap
    const ends = [[BZ0 + 0.04, 'n'], [BZ1 - 0.04, 's']];
    if (S.gap) ends.push([S.gap[0] - 0.04, 'g0'], [S.gap[1] + 0.04, 'g1']);
    for (const [z] of ends) {
      for (let k = 1; k < ROWS; k++) K.railing([xd(S, rowBack(k)), z], [xd(S, rowFront(k)), z], rowTop(k), { style: 'picket' });
    }

    // concourse deck (running-track surface) behind the top row, full length
    K.setGroup('int:south:1');
    const cx0 = Math.min(xd(S, 0), xd(S, CONC));
    const cx1 = Math.max(xd(S, 0), xd(S, CONC));
    // (6 m breakable tiles, like the plan's floors: a blast opens a hole, not the whole balcony)
    for (let z = I.z0; z < I.z1 - 1e-6; z += 6) {
      const z1 = Math.min(I.z1, z + 6);
      const [tile] = K.slab({ x0: cx0, x1: cx1, z0: z, z1 }, CONC_Y, { t: 0.3, lookTop: COL.track, lookBottom: 'metalWhite', lookEdge: COL.black });
      // lane lines on the running track (they go with their tile)
      for (const d of [1.35, 2.7]) K.decor(box(S, d - 0.025, d + 0.025, Math.max(z, I.z0 + 0.2), Math.min(z1, I.z1 - 0.2), CONC_Y, CONC_Y + 0.004), COL.white, { faces: TOP_ONLY(COL.white), dep: tile });
    }
    // a gold edge stripe on the fascia
    K.decor(box(S, CONC, CONC + 0.012, I.z0, I.z1, CONC_Y - 0.3, CONC_Y - 0.05), COL.black);
    K.decor(box(S, CONC + 0.012, CONC + 0.016, I.z0, I.z1, CONC_Y - 0.2, CONC_Y - 0.14), COL.gold);
    // the concourse railing at d = CONC: open at the aisles (from the top row) and the stair landings
    const railCuts = S.aisles.map((a) => [a - AISLE_W / 2, a + AISLE_W / 2]);
    railCuts.push([I.z0, stairZ[0] + STAIR_W / 2 + 0.05], [stairZ[1] - STAIR_W / 2 - 0.05, I.z1]);
    const runs = subtractRects({ x0: I.z0, x1: I.z1, z0: 0, z1: 1 }, railCuts.map(([a, b]) => ({ x0: a, x1: b, z0: -1, z1: 2 }))).sort((p, q) => p.x0 - q.x0);
    for (const r of runs) K.railing([xd(S, CONC) - S.s * 0.04, r.x0], [xd(S, CONC) - S.s * 0.04, r.x1], CONC_Y, { style: 'picket' });
    // steel columns under the open concourse edge (where no bleacher carries it)
    const colZ = [318, 323.0, 360.0, 365];
    if (S.gap) colZ.push(S.gap[0] + 0.25, S.gap[1] - 0.25);
    K.setGroup('int:south:0');
    for (const z of colZ) K.column(xd(S, CONC - 0.2), z, 0, CONC_Y - 0.3, { r: 0.14, look: COL.steel, mat: 'metal', round: false });

    // stairs from the end-zone floor up to the concourse (picket rails)
    for (const z of stairZ) {
      const a = [xd(S, CONC + STAIR_L), z];
      const b = [xd(S, CONC), z];
      K.stairs(a, b, 0, CONC_Y, STAIR_W, { rail: 'picket' });
      out.stairs.push({ side: S.name, a, b, y0: 0, y1: CONC_Y, w: STAIR_W });
    }
    out.sides.push(info);
  }

  // ------------------------------------------------ floor: maple boards, court paint
  K.setGroup('int:south:0');
  const covered = (x0, x1, z0, z1) =>
    sides.some((S) => {
      const bx0 = Math.min(xd(S, CONC), xd(S, FRONT));
      const bx1 = Math.max(xd(S, CONC), xd(S, FRONT));
      return x0 >= bx0 - 1e-6 && x1 <= bx1 + 1e-6 && z0 >= BZ0 && z1 <= BZ1 && !(S.gap && z1 > S.gap[0] && z0 < S.gap[1]) && !S.aisles.some((a) => z1 > a - AISLE_W / 2 && z0 < a + AISLE_W / 2);
    });
  maple(K, I, 'z', covered);

  const CL = 25.6; // 84 ft
  const CW = 15.24; // 50 ft
  const LW = 0.08;
  const zb = [CZ - CL / 2, CZ + CL / 2];
  const xs = [CX - CW / 2, CX + CW / 2];
  // black out-of-bounds border (1.5 m) around the court
  const B = 1.5;
  flat(K, xs[0] - B, xs[0], zb[0] - B, zb[1] + B, LAYER(1), COL.black);
  flat(K, xs[1], xs[1] + B, zb[0] - B, zb[1] + B, LAYER(1), COL.black);
  flat(K, xs[0], xs[1], zb[0] - B, zb[0], LAYER(1), COL.black);
  flat(K, xs[0], xs[1], zb[1], zb[1] + B, LAYER(1), COL.black);
  // boundary + half-court line
  const L2 = LAYER(2);
  stroke(K, [xs[0] + LW / 2, zb[0]], [xs[0] + LW / 2, zb[1]], LW, L2, COL.white);
  stroke(K, [xs[1] - LW / 2, zb[0]], [xs[1] - LW / 2, zb[1]], LW, L2, COL.white);
  stroke(K, [xs[0], zb[0] + LW / 2], [xs[1], zb[0] + LW / 2], LW, L2, COL.white);
  stroke(K, [xs[0], zb[1] - LW / 2], [xs[1], zb[1] - LW / 2], LW, L2, COL.white);
  stroke(K, [xs[0], CZ], [xs[1], CZ], LW, L2, COL.white);
  // the two ends: lane (gold), free-throw circle, 3-point line, lane marks
  for (const e of [0, 1]) {
    const z0 = zb[e];
    const s = e === 0 ? 1 : -1; // inward
    const bz = z0 + s * 1.6; // basket centre
    const ft = z0 + s * 5.79;
    flat(K, CX - 1.83, CX + 1.83, z0 + s * 0.05, ft, LAYER(1), COL.gold);
    stroke(K, [CX - 1.83, z0], [CX - 1.83, ft], LW, L2, COL.white);
    stroke(K, [CX + 1.83, z0], [CX + 1.83, ft], LW, L2, COL.white);
    stroke(K, [CX - 1.83, ft], [CX + 1.83, ft], LW, L2, COL.white);
    const inward = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    arc(K, CX, ft, 1.83, inward - Math.PI / 2, inward + Math.PI / 2, LW, L2, COL.white, 12);
    arc(K, CX, ft, 1.83, inward + Math.PI / 2, inward + Math.PI * 1.5, LW, L2, COL.white, 12, true);
    arc(K, CX, bz, 6.02, inward - Math.PI / 2, inward + Math.PI / 2, LW, L2, COL.white, 28);
    stroke(K, [CX - 6.02, z0], [CX - 6.02, bz], LW, L2, COL.white);
    stroke(K, [CX + 6.02, z0], [CX + 6.02, bz], LW, L2, COL.white);
    for (const m of [2.13, 3.05, 3.96, 4.88]) {
      for (const sx of [-1, 1]) stroke(K, [CX + sx * 1.83, z0 + s * m], [CX + sx * 2.03, z0 + s * m], m === 3.05 ? 0.3 : LW, L2, m === 3.05 ? COL.black : COL.white);
    }
    // coaching box / hash marks on the sidelines
    for (const sx of [0, 1]) stroke(K, [xs[sx], z0 + s * 8.53], [xs[sx] + (sx ? 0.6 : -0.6), z0 + s * 8.53], LW, L2, COL.white);
  }
  // volleyball court (thin navy lines) + net-post floor sleeves
  const VL = LAYER(2);
  stroke(K, [CX - 4.5, CZ - 9], [CX - 4.5, CZ + 9], 0.07, VL, COL.navy);
  stroke(K, [CX + 4.5, CZ - 9], [CX + 4.5, CZ + 9], 0.07, VL, COL.navy);
  stroke(K, [CX - 4.5, CZ - 9], [CX + 4.5, CZ - 9], 0.07, VL, COL.navy);
  stroke(K, [CX - 4.5, CZ + 9], [CX + 4.5, CZ + 9], 0.07, VL, COL.navy);
  for (const s of [-1, 1]) stroke(K, [CX - 4.5, CZ + s * 3], [CX + 4.5, CZ + s * 3], 0.07, VL, COL.navy);
  for (const s of [-1, 1]) {
    K.decor(rect(CX + s * 5.5 - 0.11, CX + s * 5.5 + 0.11, CZ - 0.11, CZ + 0.11, Y0, LAYER(3)), 'alu');
    K.decor(rect(CX + s * 5.5 - 0.05, CX + s * 5.5 + 0.05, CZ - 0.05, CZ + 0.05, LAYER(3), LAYER(3) + 0.002), COL.black, { faces: TOP_ONLY(COL.black) });
  }
  // centre circle: black field, white ring, gold disc + the tiger emblem in floor paint
  centreEmblem(K, CX, CZ);

  // ------------------------------------------------ walls: band, pads, goals, scoreboards, banners, doors
  const Wn = wallF('z', A.z0 + 0.1, 1);
  const Ws = wallF('z', A.z1 - 0.1, -1);
  const Ww = wallF('x', A.x0 + 0.1, 1);
  const We = wallF('x', A.x1 - 0.1, -1);
  // painted bond-beam band at the first-floor line (black with a gold line)
  for (const W of [Wn, Ws]) {
    wallBand(K, W, I.x0, I.x1, 3.95, 4.55, COL.black);
    wface(K, W, I.x0, I.x1, 0.025, 0.03, 4.18, 4.26, COL.gold);
  }
  for (const W of [Ww, We]) wallBand(K, W, I.z0, I.z1, 3.95, 4.5, COL.black);
  // end walls: pads between the stairs, practice goals (one lowered, one folded up), scoreboard, clock
  const padU = [I.x0 + CONC + STAIR_L + 0.6, I.x1 - CONC - STAIR_L - 0.6];
  for (const W of [Wn, Ws]) {
    wallPads(K, W, padU[0], padU[1]);
    wallGoal(K, W, CX - 8, 1.25);
    foldedGoal(K, W, CX + 8);
    K.setGroup('int:south:1');
    scoreboard(K, W, CX, 7.4);
    K.setGroup('int:south:0');
  }
  clock(K, Wn, CX - 4.6, 6.2);
  // main backstops, hung from the trusses at the court ends
  const TR = trussZ(CZ);
  K.setGroup('int:south:1');
  hungBackstop(K, CX, zb[0] + 1.22, 1, TR.find((z) => Math.abs(z - (zb[0] - 1.2)) < 0.6), A.top - 2.4);
  hungBackstop(K, CX, zb[1] - 1.22, -1, TR.find((z) => Math.abs(z - (zb[1] + 1.2)) < 0.6), A.top - 2.4);
  // banners on the long walls above the concourse (black / gold, emblem only)
  for (const W of [Ww, We]) {
    for (let i = 0; i < 8; i++) {
      const u = CZ + (i - 3.5) * 6.2;
      const gold = i % 2 === 1;
      banner(K, { ...W, c: W.c + W.n * (WALL_HI - 0.1) }, u, 6.6, 10.4, gold ? COL.gold : COL.black, gold ? COL.black : COL.gold);
    }
  }
  K.setGroup('int:south:0');
  // exit door surrounds (plan doors: x0 at 8 / 50 m, x1 at 30 m)
  exitFrame(K, Ww, A.z0 + 8, 2.4);
  exitFrame(K, Ww, A.z0 + 50, 2.4);
  exitFrame(K, We, A.z0 + 30, 2.4);

  // ------------------------------------------------ courtside: scorer's table, team benches, ball cart
  const tx = xs[0] - 0.95;
  const table = K.box(rect(tx - 0.38, tx + 0.38, CZ - 3, CZ + 3, 0, 0.76), { mat: 'wood', look: COL.black, faces: { top: '#3a3a3c', pu: COL.black, nu: COL.black, pv: COL.black, nv: COL.black, bottom: 'none' }, role: 'prop' });
  K.decor(rect(tx + 0.38, tx + 0.39, CZ - 3, CZ + 3, 0.5, 0.6), COL.gold, { dep: table });
  for (let i = 0; i < 6; i++) chair(K, tx - 0.75, CZ - 2.5 + i, 0);
  out.table = { x: tx, z: CZ, top: 0.76 };
  const bx = xs[1] + 1.6;
  for (const [z0, z1] of [[CZ - 10, CZ - 2.4], [CZ + 2.4, CZ + 10]]) for (let z = z0 + 0.3; z < z1; z += 0.75) chair(K, bx, z, Math.PI);
  K.box(rect(bx - 0.3, bx + 0.3, CZ - 11.2, CZ - 10.5, 0, 0.7), { mat: 'wood', look: '#3a3a3c', role: 'prop' });
  K.decor({ cx: bx, cz: CZ - 10.85, hx: 0.22, hz: 0.22, yaw: 0, y0: 0.7, y1: 1.2 }, COL.orange, { shape: 'cyl' });
  // ball cart in the north end zone
  const cart = K.box(rect(CX + 4.2, CX + 5.4, I.z0 + 4.2, I.z0 + 4.8, 0, 0.9), { mat: 'metal', look: 'none', faces: { top: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' }, role: 'prop' });
  for (const [x, z] of [[CX + 4.2, I.z0 + 4.2], [CX + 5.4, I.z0 + 4.2], [CX + 4.2, I.z0 + 4.8], [CX + 5.4, I.z0 + 4.8]]) K.decor(rect(x - 0.02, x + 0.02, z - 0.02, z + 0.02, 0, 0.9), 'railCap', { dep: cart });
  for (const y of [0.3, 0.86]) K.decor(rect(CX + 4.2, CX + 5.4, I.z0 + 4.2, I.z0 + 4.8, y, y + 0.03), 'railCap', { dep: cart });
  for (let i = 0; i < 5; i++) for (const r of [0, 1]) K.decor({ cx: CX + 4.35 + i * 0.24, cz: I.z0 + 4.36 + r * 0.26, hx: 0.12, hz: 0.12, yaw: 0, y0: 0.33 + (i % 2) * 0.24 + r * 0.04, y1: 0.57 + (i % 2) * 0.24 + r * 0.04 }, COL.orange, { shape: 'cyl', dep: cart });

  // ------------------------------------------------ roof structure, lights, skylight
  K.setGroup('int:south:1');
  const sky = { x0: CX - 3.6, x1: CX + 3.6, z0: 334.4, z1: 348.6 };
  deck(K, { x0: A.x0 + WALL_HI, x1: A.x1 - WALL_HI, z0: A.z0 + WALL_HI, z1: A.z1 - WALL_HI }, ROOF_IN, A.top, [sky]);
  // the barrel skylight seen from below: a daylight panel with aluminium ribs [3DF, L3D]
  deck(K, sky, ROOF_IN + 0.06, A.top, [], 'fixture');
  for (let z = sky.z0; z <= sky.z1 + 1e-6; z += (sky.z1 - sky.z0) / 10) K.decor(rect(sky.x0, sky.x1, z - 0.05, z + 0.05, ROOF_IN - 0.08, ROOF_IN + 0.02), 'alu');
  for (const x of [sky.x0, CX, sky.x1]) K.decor(rect(x - 0.06, x + 0.06, sky.z0, sky.z1, ROOF_IN - 0.12, ROOF_IN + 0.02), 'alu');
  const yb = A.top - 2.4; // truss bottom chord
  const yt = ROOF_IN - 0.02;
  for (const z of TR) truss(K, 'x', z, A.x0 + WALL_HI, A.x1 - WALL_HI, yb, yt, 2.5);
  // bar joists along z between the trusses (top chords + a light bottom chord)
  for (let x = A.x0 + 5; x < A.x1 - 1; x += 5) K.decor(rect(x - 0.05, x + 0.05, A.z0 + WALL_HI, A.z1 - WALL_HI, yt - 0.35, yt), COL.joist);
  // supply ducts along the long sides (blue, like the commons [CB])
  for (const x of [CX - 13.5, CX + 13.5]) {
    K.decor(rect(x - 0.42, x + 0.42, A.z0 + 1.2, A.z1 - 1.2, yb - 0.9, yb - 0.1), 'duct');
    for (let z = A.z0 + 4; z < A.z1 - 3; z += 9) K.decor(rect(x - 0.3, x + 0.3, z - 0.3, z + 0.3, yb - 1.1, yb - 0.9), '#cfd1d2');
  }
  // high-bay fixtures over the court and the bleachers
  for (const x of [CX - 7, CX, CX + 7]) for (const z of [327.5, 334.5, 341.5, 348.5, 355.5]) highBay(K, x, z + (x === CX ? 0 : 2.33), yb - 1.6, yb);
  for (const S of sides) for (const z of [321, 332, 343, 354, 365]) highBay(K, xd(S, 8), z, yb - 1.6, yb);
  for (const [x, z] of [[CX, 330], [CX, 353], [CX - 15, 341.5], [CX + 15, 341.5], [CX, 341.5]]) K.light({ x, y: 9, z, range: 26, intensity: 0.9, color: 0xfff4e4 });
  for (const S of sides) K.light({ x: xd(S, 2), y: 3.6, z: CZ, range: 16, intensity: 0.5, color: 0xfff0dc });
  out.TR = TR;
  return out;
}

/** Truss z positions: symmetric about centre court, the backstop masts on two of them. */
function trussZ(CZ) {
  const out = [];
  for (let i = -4; i <= 4; i++) out.push(CZ + i * 7);
  return out;
}

/** A black folding chair (drawn), facing yaw (seat centre at x, z). */
function chair(K, x, z, yaw, y = 0, dep = null) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const o = { dep };
  K.decor({ cx: x, cz: z, hx: 0.21, hz: 0.21, yaw, y0: y + 0.43, y1: y + 0.47 }, '#1b1b1d', o);
  K.decor({ cx: x - c * 0.2, cz: z - s * 0.2, hx: 0.02, hz: 0.2, yaw, y0: y + 0.6, y1: y + 0.86 }, '#1b1b1d', o);
  for (const [lu, lv] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) K.decor({ cx: x + c * lu - s * lv, cz: z + s * lu + c * lv, hx: 0.012, hz: 0.012, yaw, y0: y, y1: y + 0.43 }, '#9a9ca0', o);
  K.decor({ cx: x - c * 0.19, cz: z - s * 0.19, hx: 0.012, hz: 0.19, yaw, y0: y + 0.47, y1: y + 0.6 }, '#9a9ca0', o);
}

/**
 * Centre-court emblem in floor paint: the kit's original tiger emblem (materials.js emblemTex) redrawn
 * from the same simple shapes (black ring, gold disc, orange head and ears, cream muzzle, black
 * stripes, eyes and nose). Texture px (256 tile) -> metres; the head points east (+x).
 */
function centreEmblem(K, CX, CZ) {
  const s = 1.62 / 114;
  const T = (px, py) => [CX + (128 - py) * s, CZ + (px - 128) * s];
  // texture direction angle a (x right, y down) -> world yaw
  const yawOf = (a) => Math.atan2(Math.cos(a), -Math.sin(a));
  const blob = (px, py, hu, hv, a, y, look) => {
    const [x, z] = T(px, py);
    flatO(K, x, z, hu * s, hv * s, yawOf(a), y, look);
  };
  disc(K, CX, CZ, 1.83, LAYER(1), COL.black);
  arc(K, CX, CZ, 1.83, 0, Math.PI * 2, 0.08, LAYER(2), COL.white, 32);
  disc(K, CX, CZ, 1.62, LAYER(2), COL.gold);
  const ORANGE = '#e0912f';
  const L3 = LAYER(3);
  for (const sd of [-1, 1]) {
    blob(128 + sd * 60, 70, 17, 20, sd * -0.6, L3, ORANGE);
    blob(128 + sd * 66, 58, 8, 10, sd * -0.6, L3, ORANGE);
  }
  {
    const [x, z] = T(128, 140);
    disc(K, x, z, 68 * s, L3, ORANGE);
  }
  const L4 = LAYER(4);
  for (const sd of [-1, 1]) {
    const [x, z] = T(128 + sd * 20, 168);
    disc(K, x, z, 22 * s, L4, '#f6efe0');
  }
  const STR = '#141414';
  // forehead stripes
  blob(128, 95, 15, 5, Math.PI / 2, L4, STR);
  for (const sd of [-1, 1]) {
    const a = Math.PI / 2 - sd * 0.25;
    blob(128 + sd * 14 + Math.cos(a) * 12, 82 + Math.sin(a) * 12, 12, 4, a, L4, STR);
  }
  // cheek stripes from the head edge inward
  for (const sd of [-1, 1]) {
    for (const [x0, y0, a0, l] of [[70, 130, 0, 26], [68, 150, 0.15, 22], [62, 168, 0.3, 18]]) {
      const a = sd < 0 ? a0 : Math.PI - a0;
      const px = 128 + sd * x0;
      blob(px + Math.cos(a) * l * 0.5, y0 + Math.sin(a) * l * 0.5, l * 0.5, 4, a, L4, STR);
    }
  }
  const L5 = LAYER(5);
  for (const sd of [-1, 1]) {
    blob(128 + sd * 26, 126, 11, 6.5, sd * -0.35, L5, STR);
    blob(128 + sd * 26, 126, 3.5, 3.5, 0, LAYER(6), COL.gold);
  }
  blob(128, 153, 13, 4, 0, L5, '#2a1a14');
  blob(128, 158.5, 7, 3, 0, L5, '#2a1a14');
}

// ---------------------------------------------------------------- auxiliary gym

function auxGym(K, X) {
  const I = { x0: X.x0 + WALL, x1: X.x1 - WALL, z0: X.z0 + WALL, z1: X.z1 - WALL };
  const CX = (X.x0 + X.x1) / 2; // -79
  const CZ = (X.z0 + X.z1) / 2; // 383.5
  const ROOF_IN = X.top - 0.5 - 0.1;
  const out = { I, CX, CZ };
  K.setGroup('int:south:0');
  // the portable 4-row bleacher along the north wall (aluminium, breakable)
  const PB = { x0: CX - 6, x1: CX + 6, rows: 4, tread: 0.6 };
  const pbRows = [];
  for (let k = 0; k < PB.rows; k++) {
    const z1 = I.z0 + 0.1 + (PB.rows - k) * PB.tread;
    const z0 = z1 - PB.tread;
    const top = (k + 1) * RISE;
    pbRows.push(K.box(rect(PB.x0, PB.x1, z0, z1, 0, top), { mat: 'metal', look: 'alu', faces: { top: 'alu', pv: '#8d9092', nv: '#8d9092', pu: '#8d9092', nu: '#8d9092', bottom: 'none' }, role: 'bleacher' }));
    if (k < PB.rows - 1) K.decor(rect(PB.x0 + 0.05, PB.x1 - 0.05, z0 - 0.02, z0 + 0.3, top + RISE, top + RISE + 0.04), 'railCap', { dep: pbRows[k] });
  }
  out.portable = { x0: PB.x0, x1: PB.x1, z0: I.z0 + 0.1, z1: I.z0 + 0.1 + PB.rows * PB.tread, rows: PB.rows };
  // maple floor, boards along x (the court runs along x)
  const covered = (x0, x1, z0, z1) => x0 >= PB.x0 && x1 <= PB.x1 && z1 <= I.z0 + 0.1 + PB.rows * PB.tread;
  maple(K, I, 'x', covered);
  // practice court: 80 x 50 ft, lines white, lanes gold, centre circle black
  const CL = 24.4;
  const CW = 15.24;
  const LW = 0.08;
  const xb = [CX - CL / 2, CX + CL / 2];
  const zs = [CZ - CW / 2, CZ + CW / 2];
  const L2 = LAYER(2);
  stroke(K, [xb[0], zs[0] + LW / 2], [xb[1], zs[0] + LW / 2], LW, L2, COL.white);
  stroke(K, [xb[0], zs[1] - LW / 2], [xb[1], zs[1] - LW / 2], LW, L2, COL.white);
  stroke(K, [xb[0] + LW / 2, zs[0]], [xb[0] + LW / 2, zs[1]], LW, L2, COL.white);
  stroke(K, [xb[1] - LW / 2, zs[0]], [xb[1] - LW / 2, zs[1]], LW, L2, COL.white);
  stroke(K, [CX, zs[0]], [CX, zs[1]], LW, L2, COL.white);
  disc(K, CX, CZ, 1.83, LAYER(1), COL.black);
  arc(K, CX, CZ, 1.83, 0, Math.PI * 2, LW, L2, COL.white, 32);
  disc(K, CX, CZ, 0.9, L2, COL.gold);
  for (const e of [0, 1]) {
    const x0 = xb[e];
    const s = e === 0 ? 1 : -1;
    const bx = x0 + s * 1.6;
    const ft = x0 + s * 5.79;
    flat(K, x0 + s * 0.05, ft, CZ - 1.83, CZ + 1.83, LAYER(1), COL.gold);
    stroke(K, [x0, CZ - 1.83], [ft, CZ - 1.83], LW, L2, COL.white);
    stroke(K, [x0, CZ + 1.83], [ft, CZ + 1.83], LW, L2, COL.white);
    stroke(K, [ft, CZ - 1.83], [ft, CZ + 1.83], LW, L2, COL.white);
    const inward = s > 0 ? 0 : Math.PI;
    arc(K, ft, CZ, 1.83, inward - Math.PI / 2, inward + Math.PI / 2, LW, L2, COL.white, 12);
    arc(K, bx, CZ, 6.02, inward - Math.PI / 2, inward + Math.PI / 2, LW, L2, COL.white, 28);
    stroke(K, [x0, CZ - 6.02], [bx, CZ - 6.02], LW, L2, COL.white);
    stroke(K, [x0, CZ + 6.02], [bx, CZ + 6.02], LW, L2, COL.white);
  }
  // walls
  const Wn = wallF('z', X.z0 + 0.1, 1);
  const Ws = wallF('z', X.z1 - 0.1, -1);
  const Ww = wallF('x', X.x0 + 0.1, 1);
  const We = wallF('x', X.x1 - 0.1, -1);
  for (const W of [Wn, Ws]) wallBand(K, W, I.x0, I.x1, 3.95, 4.55, COL.black);
  for (const W of [Ww, We]) wallBand(K, W, I.z0, I.z1, 3.95, 4.55, COL.black);
  for (const W of [Wn, Ws]) wface(K, W, I.x0, I.x1, 0.025, 0.03, 4.18, 4.26, COL.gold);
  for (const W of [Ww, We]) wface(K, W, I.z0, I.z1, 0.025, 0.03, 4.18, 4.26, COL.gold);
  const doorW = X.z0 + 12; // x0 door (plan), 2.0 wide
  wallPads(K, Ww, I.z0 + 4.6, I.z1 - 4.6, [[doorW - 1.3, doorW + 1.3]]);
  wallPads(K, We, I.z0 + 4.6, I.z1 - 4.6);
  wallGoal(K, Ww, CZ, xb[0] + 1.22 - (X.x0 + 0.1));
  wallGoal(K, We, CZ, X.x1 - 0.1 - (xb[1] - 1.22));
  exitFrame(K, Ww, doorW, 2.0);
  exitFrame(K, Ws, X.x0 + 15, 2.0);
  clock(K, Wn, CX, 6.0);
  for (const u of [CX - 8, CX + 8]) banner(K, Wn, u, 5.4, 8.6, u < CX ? COL.black : COL.gold, u < CX ? COL.gold : COL.black);
  // climbing wall on the south wall: plywood panels, coloured holds, a crash mat
  const cw = { u0: I.x0 + 1.2, u1: I.x0 + 10.6 };
  const CWL = '#6b7480';
  const climb = K.box(wbox(Ws, cw.u0, cw.u1, 0, 0.08, 0.3, 7.2), { mat: 'wood', look: CWL, faces: { top: COL.steel, pu: COL.steel, nu: COL.steel, pv: CWL, nv: CWL, bottom: 'none' }, role: 'prop' });
  for (let u = cw.u0 + 1.2; u < cw.u1 - 0.1; u += 1.2) wface(K, Ws, u - 0.015, u + 0.015, 0.08, 0.085, 0.3, 7.2, '#4b525b');
  for (let y = 1.5; y < 7.2; y += 1.2) wface(K, Ws, cw.u0, cw.u1, 0.08, 0.085, y - 0.015, y + 0.015, '#4b525b');
  // a gold trim frame around the wall
  for (const u of [cw.u0, cw.u1]) wdecor(K, Ws, u - 0.06, u + 0.06, 0, 0.11, 0.3, 7.25, COL.gold);
  wdecor(K, Ws, cw.u0 - 0.06, cw.u1 + 0.06, 0, 0.11, 7.2, 7.3, COL.gold);
  const holds = ['#d8682a', '#c9a54a', '#3a9a58', '#2f6db0', '#c23b3b', '#1b1c1f', '#e8e4da'];
  for (let i = 0; i < 120; i++) {
    const u = cw.u0 + 0.3 + K.rnd() * (cw.u1 - cw.u0 - 0.6);
    const y = 0.6 + K.rnd() * 6.3;
    const r = 0.05 + K.rnd() * 0.07;
    wdecor(K, Ws, u - r, u + r, 0.08, 0.14 + K.rnd() * 0.06, y - r * 0.8, y + r * 0.8, holds[Math.floor(K.rnd() * holds.length)], { dep: climb });
  }
  K.box(wbox(Ws, cw.u0, cw.u1, 0.08, 2.2, 0, 0.3), { mat: 'wood', look: '#2b4c7e', faces: { top: '#2b4c7e', pu: COL.black, nu: COL.black, pv: COL.black, nv: COL.black, bottom: 'none' }, role: 'prop' });
  // stacked folding mats in the north-east corner (cover; the top stack carries loot)
  const mats = [];
  for (const [z0, z1, n] of [[I.z0 + 0.3, I.z0 + 2.5, 5], [I.z0 + 2.9, I.z0 + 5.1, 3]]) {
    const x0 = I.x1 - 2.4;
    const x1 = I.x1 - 0.2;
    const m = K.box(rect(x0, x1, z0, z1, 0, n * 0.2), { mat: 'wood', look: COL.black, faces: { top: COL.gold, pu: COL.black, nu: COL.black, pv: COL.black, nv: COL.black, bottom: 'none' }, role: 'prop' });
    for (let i = 0; i < n; i++) K.decor(rect(x0 - 0.01, x1 + 0.01, z0 - 0.01, z1 + 0.01, i * 0.2 + 0.08, i * 0.2 + 0.12), i % 2 ? COL.black : COL.gold, { dep: m });
    mats.push({ x0, x1, z0, z1, top: n * 0.2 });
  }
  out.mats = mats;
  // climbing ropes hung from a beam off the truss
  const ROPE_Z = I.z0 + 3.6;
  K.setGroup('int:south:1');
  K.decor(rect(I.x1 - 8.4, I.x1 - 4.4, ROPE_Z - 0.08, ROPE_Z + 0.08, X.top - 2.25, X.top - 2.1), COL.steel);
  for (let i = 0; i < 3; i++) {
    const x = I.x1 - 7.6 + i * 1.2;
    K.decor({ cx: x, cz: ROPE_Z, hx: 0.035, hz: 0.035, yaw: 0, y0: 1.1, y1: X.top - 2.25 }, '#c9b48a', { shape: 'cyl' });
    K.decor({ cx: x, cz: ROPE_Z, hx: 0.07, hz: 0.07, yaw: 0, y0: 1.0, y1: 1.2 }, '#b39e74', { shape: 'cyl' });
  }
  // roof: deck, trusses spanning z, joists, fixtures
  deck(K, { x0: X.x0 + WALL_HI, x1: X.x1 - WALL_HI, z0: X.z0 + WALL_HI, z1: X.z1 - WALL_HI }, ROOF_IN, X.top);
  const yb = X.top - 2.2;
  const yt = ROOF_IN - 0.02;
  for (let x = X.x0 + 3; x < X.x1 - 1; x += 5) truss(K, 'z', x, X.z0 + WALL_HI, X.z1 - WALL_HI, yb, yt, 2.5);
  for (let z = X.z0 + 5; z < X.z1 - 1; z += 5) K.decor(rect(X.x0 + WALL_HI, X.x1 - WALL_HI, z - 0.05, z + 0.05, yt - 0.35, yt), COL.joist);
  for (const x of [CX - 7.5, CX, CX + 7.5]) for (const z of [CZ - 6, CZ, CZ + 6]) highBay(K, x + 0.5, z, yb - 1.4, yb);
  K.light({ x: CX, y: 7.5, z: CZ, range: 24, intensity: 0.9, color: 0xfff4e4 });
  K.light({ x: CX + 8, y: 7.5, z: CZ - 6, range: 16, intensity: 0.6, color: 0xfff4e4 });
  return out;
}

// ---------------------------------------------------------------- props (fill)

const NONE = { top: 'none', bottom: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none' };

/** A rolling cart (collider: cover), w along x, d along z; load(part) draws what it carries. */
function cart(K, x, z, w, d, h, load) {
  const p = K.box(rect(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h), { mat: 'metal', look: 'none', faces: NONE, role: 'prop' });
  for (const [cx, cz] of [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2]]) {
    K.decor(rect(cx - 0.025, cx + 0.025, cz - 0.025, cz + 0.025, 0.06, h), 'railCap', { dep: p });
    K.decor(rect(cx - 0.04, cx + 0.04, cz - 0.04, cz + 0.04, 0, 0.08), COL.black, { dep: p });
  }
  K.decor(rect(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0.12, 0.16), COL.steel, { dep: p });
  K.decor(rect(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h - 0.04, h), 'railCap', { faces: { ...NONE, pu: 'railCap', nu: 'railCap', pv: 'railCap', nv: 'railCap' }, dep: p });
  if (load) load(p);
  return p;
}

/** Balls (short cylinders) packed in a w x d tray at height y. */
function balls(K, p, x, z, w, d, y, look, r = 0.12) {
  const nx = Math.max(1, Math.floor(w / (2 * r)));
  const nz = Math.max(1, Math.floor(d / (2 * r)));
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const cx = x - w / 2 + r + (nx > 1 ? (i * (w - 2 * r)) / (nx - 1) : w / 2 - r);
      const cz = z - d / 2 + r + (nz > 1 ? (j * (d - 2 * r)) / (nz - 1) : d / 2 - r);
      const yy = y + ((i + j) % 2) * r * 0.6;
      K.decor({ cx, cz, hx: r, hz: r, yaw: 0, y0: yy, y1: yy + 2 * r * 0.9 }, look, { shape: 'cyl', dep: p });
    }
}

/** A stack of grey folding chairs on a dolly (collider). */
function chairStack(K, x, z, n = 10) {
  const h = 0.25 + n * 0.08;
  const p = K.box(rect(x - 0.3, x + 0.3, z - 0.35, z + 0.35, 0, h), { mat: 'metal', look: 'none', faces: NONE, role: 'prop' });
  K.decor(rect(x - 0.33, x + 0.33, z - 0.38, z + 0.38, 0, 0.12), COL.black, { dep: p });
  for (let i = 0; i < n; i++) K.decor(rect(x - 0.24, x + 0.24, z - 0.3 + i * 0.008, z + 0.2 + i * 0.008, 0.14 + i * 0.08, 0.19 + i * 0.08), i % 2 ? '#5d6066' : '#6d7076', { dep: p });
  K.decor(rect(x - 0.24, x + 0.24, z + 0.24, z + 0.3, 0.14, h + 0.4), '#5d6066', { dep: p });
  return p;
}

/** A grey trash can (collider) with a black rim. */
function trashCan(K, x, z, y = 0) {
  const p = K.box(rect(x - 0.26, x + 0.26, z - 0.26, z + 0.26, y, y + 0.82), { mat: 'metal', look: 'none', faces: NONE, role: 'prop' });
  K.decor({ cx: x, cz: z, hx: 0.28, hz: 0.28, yaw: 0, y0: y, y1: y + 0.8 }, '#6f747a', { shape: 'cyl', dep: p });
  K.decor({ cx: x, cz: z, hx: 0.3, hz: 0.3, yaw: 0, y0: y + 0.8, y1: y + 0.86 }, COL.black, { shape: 'cyl', dep: p });
  return p;
}

/** A low wall bench (collider, cover) with steel ends. */
function bench(K, x0, x1, z0, z1, y = 0) {
  return K.box(rect(x0, x1, z0, z1, y, y + 0.45), { mat: 'wood', look: COL.bench, faces: { top: COL.bench, pu: COL.steel, nu: COL.steel, pv: COL.steel, nv: COL.steel, bottom: 'none' }, role: 'prop' });
}

/** A folding table: collider top at 0.74, drawn legs. */
function table(K, x0, x1, z0, z1, look = '#d9d6cf') {
  const p = K.box(rect(x0, x1, z0, z1, 0.7, 0.74), { mat: 'wood', look, faces: { top: look, pu: '#8d9092', nu: '#8d9092', pv: '#8d9092', nv: '#8d9092', bottom: '#8d9092' }, role: 'prop' });
  for (const [x, z] of [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]]) K.decor(rect(x - 0.015, x + 0.015, z - 0.015, z + 0.015, 0, 0.7), '#9a9ca0', { dep: p });
  return p;
}

/** An orange training cone (drawn). */
function cone(K, x, z) {
  K.decor(rect(x - 0.14, x + 0.14, z - 0.14, z + 0.14, Y0, Y0 + 0.03), COL.orange);
  K.decor({ cx: x, cz: z, hx: 0.09, hz: 0.09, yaw: 0, y0: Y0 + 0.03, y1: Y0 + 0.2 }, COL.orange, { shape: 'cyl' });
  K.decor({ cx: x, cz: z, hx: 0.05, hz: 0.05, yaw: 0, y0: Y0 + 0.2, y1: Y0 + 0.32 }, COL.orange, { shape: 'cyl' });
}

/** Volleyball standards lying on their cart (posts, pads and the rolled net). */
function standardCart(K, x, z) {
  return cart(K, x, z, 2.6, 0.7, 0.5, (p) => {
    for (const dz of [-0.16, 0.16]) {
      K.decor(rect(x - 1.25, x + 1.25, z + dz - 0.06, z + dz + 0.06, 0.5, 0.62), 'alu', { dep: p });
      K.decor(rect(x - 0.6, x + 0.6, z + dz - 0.09, z + dz + 0.09, 0.5, 0.68), COL.black, { dep: p });
    }
    K.decor(rect(x - 1.1, x + 1.1, z - 0.3, z + 0.3, 0.68, 0.78), COL.white, { dep: p });
  });
}

/** Team-bench water cooler and cups on a small black table. */
function cooler(K, x, z) {
  const p = table(K, x - 0.5, x + 0.5, z - 0.35, z + 0.35, COL.black);
  K.decor({ cx: x - 0.2, cz: z, hx: 0.2, hz: 0.2, yaw: 0, y0: 0.74, y1: 1.2 }, COL.orange, { shape: 'cyl', dep: p });
  K.decor({ cx: x - 0.2, cz: z, hx: 0.21, hz: 0.21, yaw: 0, y0: 1.2, y1: 1.26 }, COL.white, { shape: 'cyl', dep: p });
  for (let i = 0; i < 4; i++) K.decor(rect(x + 0.05 + (i % 2) * 0.16, x + 0.15 + (i % 2) * 0.16, z - 0.2 + (i >> 1) * 0.2, z - 0.1 + (i >> 1) * 0.2, 0.74, 0.95), '#3a9a58', { dep: p });
  return p;
}

/** Arena fill: pep-band riser, end-zone equipment, under-concourse storage, concourse benches. Returns chest spots. */
function fillArena(K, ar) {
  const { I, CX, CZ } = ar;
  const [W, E] = ar.sides;
  const spots = [];
  K.setGroup('int:south:0');
  // pep-band riser in the south end zone: two 0.4 m tiers (walkable), chairs and music stands
  const rz = I.z1 - 9.2;
  const tierFaces = { top: '#3a3a3c', pu: COL.black, nu: COL.black, pv: COL.gold, nv: COL.gold, bottom: 'none' };
  const r1 = K.box(rect(CX - 5, CX + 5, rz, rz + 1.6, 0, 0.4), { mat: 'wood', look: COL.black, faces: tierFaces, role: 'riser' });
  const r2 = K.box(rect(CX - 5, CX + 5, rz + 1.6, rz + 3.2, 0, 0.8), { mat: 'wood', look: COL.black, faces: tierFaces, role: 'riser' });
  for (const [p, y, zz] of [[r1, 0.4, rz + 0.9], [r2, 0.8, rz + 2.5]]) {
    for (let x = CX - 4.4; x <= CX + 4.41; x += 1.1) {
      if (y > 0.5 && Math.abs(x - CX) < 1.2) continue; // the chest spot
      chair(K, x, zz, -Math.PI / 2, y, p);
      K.decor(rect(x - 0.012, x + 0.012, zz - 0.62, zz - 0.6, y, y + 1.05), COL.black, { dep: p });
      K.decor(rect(x - 0.22, x + 0.22, zz - 0.66, zz - 0.62, y + 0.98, y + 1.28), COL.black, { dep: p });
    }
  }
  K.decor({ cx: CX + 3.2, cz: rz + 2.3, hx: 0.35, hz: 0.35, yaw: 0, y0: 0.8, y1: 1.5 }, COL.white, { shape: 'cyl', dep: r2 });
  K.decor({ cx: CX + 3.2, cz: rz + 2.3, hx: 0.36, hz: 0.36, yaw: 0, y0: 1.06, y1: 1.24 }, COL.gold, { shape: 'cyl', dep: r2 });
  spots.push({ kind: 'chest', x: CX, z: rz + 2.4, y: 0.8, yaw: 0, at: 'gymBandRiser' });

  // north end zone: equipment along the end wall
  standardCart(K, CX + 9.5, I.z0 + 3.2);
  standardCart(K, CX - 9.5, I.z0 + 3.2);
  cart(K, CX - 4.8, I.z0 + 4.5, 1.2, 0.6, 0.9, (p) => balls(K, p, CX - 4.8, I.z0 + 4.5, 1.1, 0.5, 0.33, '#f2f0ea', 0.11));
  chairStack(K, CX - 1.6, I.z0 + 2.2);
  chairStack(K, CX - 0.8, I.z0 + 2.2, 8);
  for (const z of [I.z0 + 0.6, I.z1 - 0.6]) {
    trashCan(K, I.x0 + FRONT + 0.6, z);
    trashCan(K, I.x1 - FRONT - 0.6, z);
  }
  // south end zone: a ball cart, a gold spirit table, the team's cooler by the east bench
  cart(K, CX + 9.5, I.z1 - 3.2, 1.2, 0.6, 0.9, (p) => balls(K, p, CX + 9.5, I.z1 - 3.2, 1.1, 0.5, 0.2, COL.orange));
  table(K, CX - 11, CX - 9, I.z1 - 3.8, I.z1 - 3.0, COL.gold);
  cooler(K, CX + 9.2, CZ + 11.2);

  // under the concourses: storage behind the bleachers (cover) + one chest on the east side
  for (const S of [W, E]) {
    const x = (d) => S.xw + S.s * d;
    for (const z of [327.4, 330.4]) cart(K, x(0.55), z, 0.8, 2.6, 1.0, (p) => {
      for (let i = 0; i < 6; i++) K.decor(rect(x(0.55) - 0.36, x(0.55) + 0.36, z - 1.25, z + 1.25, 0.18 + i * 0.13, 0.28 + i * 0.13), i % 2 ? '#2b4c7e' : COL.black, { dep: p });
    });
    chairStack(K, x(0.45), 346.6);
    chairStack(K, x(0.45), 347.5);
    if (S.s > 0) spots.push({ kind: 'chest', x: x(2.2), z: 352, y: 0, yaw: Math.PI / 2, at: `gymUnder_${S.name}` });
  }
  // concourse: wall benches, trash cans, a chest on the east side
  K.setGroup('int:south:1');
  for (const S of [W, E]) {
    const x0 = Math.min(S.xw, S.xw + S.s * 0.5);
    const x1 = Math.max(S.xw, S.xw + S.s * 0.5);
    for (const z of [320, 335, 348, 362]) bench(K, x0, x1, z - 1.2, z + 1.2, CONC_Y);
    for (const z of [326.5, 355.5]) trashCan(K, S.xw + S.s * 0.32, z, CONC_Y);
  }
  spots.push({ kind: 'chest', x: E.xw - 1.6, z: 330, y: CONC_Y, yaw: -Math.PI / 2, at: 'gymConcourseEast' });
  K.setGroup('int:south:0');
  return spots;
}

/** Aux gym fill: PE carts, cones, an agility ladder, hurdles. Returns chest spots. */
function fillAux(K, ax) {
  const { I, CX, CZ } = ax;
  const spots = [];
  K.setGroup('int:south:0');
  cart(K, CX + 4.2, I.z1 - 0.7, 1.2, 0.6, 0.9, (p) => balls(K, p, CX + 4.2, I.z1 - 0.7, 1.1, 0.5, 0.2, '#c23b3b', 0.1));
  cart(K, CX + 5.8, I.z1 - 0.7, 1.2, 0.6, 0.9, (p) => balls(K, p, CX + 5.8, I.z1 - 0.7, 1.1, 0.5, 0.2, COL.orange));
  chairStack(K, CX + 7.6, I.z1 - 0.6);
  trashCan(K, CX + 2.6, I.z1 - 0.5);
  for (let i = 0; i < 6; i++) {
    cone(K, CX - 7 + i * 2.8, CZ - 3.2);
    cone(K, CX - 5.6 + i * 2.8, CZ + 3.2);
  }
  const lz = CZ + 6.2;
  for (const dz of [-0.25, 0.25]) flat(K, CX - 4, CX + 4, lz + dz - 0.02, lz + dz + 0.02, LAYER(3), '#e3c32f');
  for (let x = CX - 4; x <= CX + 4 + 1e-6; x += 0.5) flat(K, x - 0.02, x + 0.02, lz - 0.25, lz + 0.25, LAYER(3), '#e3c32f');
  for (let i = 0; i < 5; i++) {
    const x = CX - 4.5 + i * 2.2;
    const z = I.z0 + 3.4;
    for (const dx of [-0.4, 0.4]) {
      K.decor(rect(x + dx - 0.02, x + dx + 0.02, z - 0.02, z + 0.02, 0, 0.5), COL.white);
      K.decor(rect(x + dx - 0.02, x + dx + 0.02, z - 0.2, z + 0.2, 0, 0.03), COL.white);
    }
    K.decor(rect(x - 0.4, x + 0.4, z - 0.03, z + 0.03, 0.42, 0.5), COL.gold);
  }
  spots.push({ kind: 'chest', x: I.x0 + 4.0, z: I.z1 - 1.1, y: 0.3, yaw: Math.PI, at: 'auxClimbMat' });
  return spots;
}

// ---------------------------------------------------------------- entry

/** @param {ReturnType<import('../../kit/builder.js').createKit>} K @param {object} ctx */
export function buildGym(K, ctx) {
  const A = ctx.ARENA;
  const X = ctx.AUX_GYM;
  const p0 = K.parts.length;
  const d0 = K.decors.length;
  const l0 = K.lootSpots.length;
  const g0 = K.group;
  const ar = arena(K, A, ctx);
  const ax = auxGym(K, X);

  // loot: surfaces on both levels; one high-tier chest on the west concourse
  K.setGroup('int:south:1');
  const west = ar.sides[0];
  const east = ar.sides[1];
  K.loot({ kind: 'chest', tier: 'high', x: west.xw + 1.6, z: ar.CZ, y: CONC_Y, yaw: Math.PI / 2, at: 'gymConcourse' });
  K.setGroup('int:south:0');
  K.loot({ kind: 'item', x: ar.table.x, z: ar.table.z + 1.2, y: ar.table.top, at: 'gymScorerTable' });
  const r5 = east.rows[5];
  K.loot({ kind: 'item', x: (r5.x0 + r5.x1) / 2 - 0.1, z: 332.5, y: r5.top, at: 'gymBleacher' });
  K.loot({ kind: 'ammoBox', x: east.xw - 2.0, z: 326, y: 0, at: 'gymUnderConcourse' });
  const m = ax.mats[0];
  K.loot({ kind: 'ammoBox', x: (m.x0 + m.x1) / 2, z: (m.z0 + m.z1) / 2, y: m.top, at: 'auxMats' });
  // the gyms are dressed: equipment, storage, a band riser, and a few chests (not every zone)
  for (const sp of [...fillArena(K, ar), ...fillAux(K, ax)]) {
    K.setGroup(sp.y > 3 ? 'int:south:1' : 'int:south:0');
    K.loot(sp);
  }
  K.setGroup(g0);

  Object.assign(GYM, {
    ARENA: A,
    AUX_GYM: X,
    arena: ar,
    aux: ax,
    parts: [p0, K.parts.length],
    decors: [d0, K.decors.length],
    loot: K.lootSpots.slice(l0),
    ROWS,
    RISE,
    TREAD,
    CONC,
    CONC_Y,
  });
  return GYM;
}
