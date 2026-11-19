// BENTONVILLE ROYALE — rays against a car (pure: no three.js, testable in node).
//
// A car is two boxes in its local frame (cars.js carGeom): the lower body and the cabin. The
// cabin's faces carry six glass panes. rayCar() returns the first solid thing a ray meets:
//   body / roof / pillars -> { part: 'body' }       (the car soaks the hit)
//   an intact pane        -> { part: 'window', idx } (the pane takes the hit)
//   a broken pane         -> nothing: the ray goes on into the cabin (and can hit whoever sits
//                            there; Combat tests the occupants like any other actor)
// Pitch / roll are ignored (they are small and only visual).

import { carGeom, CAR, SEAT_WINDOW } from './cars.js';

const _hit = { t: 0, part: 'body', idx: -1, nx: 0, ny: 0, nz: 0, car: null };

/**
 * Entry of a ray (local origin o, local direction d) into the AABB b. Returns { t, axis, sign }
 * in a shared object or null. A ray that starts inside the box does not hit it.
 */
const _box = { t: 0, axis: 0, sign: 0 };
function rayBox(b, ox, oy, oz, dx, dy, dz, maxT) {
  let tE = -Infinity;
  let tX = Infinity;
  let axis = -1;
  let sign = 0;
  const lo = [b.x0, b.y0, b.z0];
  const hi = [b.x1, b.y1, b.z1];
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < lo[k] || o[k] > hi[k]) return null;
      continue;
    }
    let t1 = (lo[k] - o[k]) / d[k];
    let t2 = (hi[k] - o[k]) / d[k];
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tE) {
      tE = t1;
      axis = k;
      sign = s;
    }
    if (t2 < tX) tX = t2;
  }
  if (tE > tX || tX < 0 || tE < 0 || tE > maxT) return null;
  _box.t = tE;
  _box.axis = axis;
  _box.sign = sign;
  return _box;
}

/** Which window (index) a cabin entry at local point (x, y, z) through face axis/sign is, or -1. */
function windowAt(g, axis, sign, x, y, z) {
  const ws = g.windows;
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    if ((w.axis === 'x' ? 0 : 2) !== axis || w.side !== sign) continue;
    const u = axis === 0 ? z : x;
    if (u >= w.u0 && u <= w.u1 && y >= w.y0 && y <= w.y1) return i;
  }
  return -1;
}

/**
 * Ray (world origin o, unit direction d) vs. one car. Returns a shared
 * { t, part, idx, nx, ny, nz, car } or null.
 */
export function rayCar(car, ox, oy, oz, dx, dy, dz, maxT) {
  if (!car || !car.alive) return null;
  const g = carGeom(car.spec);
  // quick reject: bounding sphere
  const cx = car.x - ox;
  const cy = car.y + g.height / 2 - oy;
  const cz = car.z - oz;
  const along = cx * dx + cy * dy + cz * dz;
  const r = Math.hypot(g.hl, g.hw, g.height / 2) + 0.1;
  if (along < -r || along > maxT + r) return null;
  const px = cx - dx * along;
  const py = cy - dy * along;
  const pz = cz - dz * along;
  if (px * px + py * py + pz * pz > r * r) return null;
  // to local
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  const rx = ox - car.x;
  const rz = oz - car.z;
  const lox = rx * c + rz * s;
  const loz = -rx * s + rz * c;
  const loy = oy - car.y;
  const ldx = dx * c + dz * s;
  const ldz = -dx * s + dz * c;
  let best = null;
  let bt = maxT;
  let bAxis = 0;
  let bSign = 0;
  const b = rayBox(g.body, lox, loy, loz, ldx, dy, ldz, bt);
  if (b && b.t < bt) {
    bt = b.t;
    best = 'body';
    bAxis = b.axis;
    bSign = b.sign;
  }
  const k = rayBox(g.cabin, lox, loy, loz, ldx, dy, ldz, bt);
  let idx = -1;
  if (k && k.t < bt) {
    const hx = lox + ldx * k.t;
    const hy = loy + dy * k.t;
    const hz = loz + ldz * k.t;
    const w = windowAt(g, k.axis, k.sign, hx, hy, hz);
    if (w >= 0 && !(car.windows[w] > 0)) {
      // broken pane: an opening, the ray carries on into the cabin
    } else {
      bt = k.t;
      best = w >= 0 ? 'window' : 'body';
      idx = w;
      bAxis = k.axis;
      bSign = k.sign;
    }
  }
  if (!best) return null;
  // local face normal -> world
  let lnx = 0;
  let lny = 0;
  let lnz = 0;
  if (bAxis === 0) lnx = bSign;
  else if (bAxis === 1) lny = bSign;
  else lnz = bSign;
  _hit.t = bt;
  _hit.part = best;
  _hit.idx = idx;
  _hit.nx = lnx * c - lnz * s;
  _hit.ny = lny;
  _hit.nz = lnx * s + lnz * c;
  _hit.car = car;
  return _hit;
}

/** Nearest car hit along a ray over a list of cars (skipping `ignoreCar`). Shared result or null. */
export function rayCars(cars, ox, oy, oz, dx, dy, dz, maxT, ignoreCar = null) {
  let best = null;
  let bt = maxT;
  let keep = null;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (car === ignoreCar) continue;
    const h = rayCar(car, ox, oy, oz, dx, dy, dz, bt);
    if (h && h.t < bt) {
      bt = h.t;
      keep = { t: h.t, part: h.part, idx: h.idx, nx: h.nx, ny: h.ny, nz: h.nz, car: h.car };
    }
  }
  best = keep;
  return best;
}

/**
 * Where an actor in seat `seat` sits (feet), into out { x, y, z }. Leaning passengers sit out
 * of their window.
 */
export function seatWorldPos(car, seat, leaning = false, out = { x: 0, y: 0, z: 0 }) {
  const g = carGeom(car.spec);
  const st = g.seats[seat] || g.seats[0];
  let lx = st.x;
  let ly = CAR.floorY;
  if (leaning && seat > 0) {
    lx = (st.x < 0 ? -1 : 1) * (g.cw + CAR.leanOut * 0.6);
    ly += 0.25;
  }
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  out.x = car.x + lx * c - st.z * s;
  out.y = car.y + ly;
  out.z = car.z + lx * s + st.z * c;
  return out;
}

/**
 * A clear spot to get out of seat `seat`: beside its door, else the other side, else behind,
 * else in front. `blocked(x, z, r)` says whether a spot is inside something solid. Returns
 * { x, z } or null.
 */
export function exitSpot(car, seat, blocked, out = { x: 0, z: 0 }) {
  const g = carGeom(car.spec);
  const st = g.seats[seat] || g.seats[0];
  const side = st.x < 0 ? -1 : 1;
  const tries = [
    [side * (g.hw + 0.9), st.z],
    [-side * (g.hw + 0.9), st.z],
    [side * (g.hw + 0.9), st.z + 1.2],
    [side * (g.hw + 0.9), st.z - 1.2],
    [-side * (g.hw + 0.9), st.z + 1.2],
    [0, g.hl + 1.1],
    [0, -g.hl - 1.1],
    [side * (g.hw + 1.8), st.z],
    [-side * (g.hw + 1.8), st.z],
    [side * (g.hw + 0.9), g.hl + 0.9],
    [-side * (g.hw + 0.9), g.hl + 0.9],
    [side * (g.hw + 0.9), -g.hl - 0.9],
    [-side * (g.hw + 0.9), -g.hl - 0.9],
  ];
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  for (const [lx, lz] of tries) {
    const x = car.x + lx * c - lz * s;
    const z = car.z + lx * s + lz * c;
    if (!blocked || !blocked(x, z, 0.45)) {
      out.x = x;
      out.z = z;
      return out;
    }
  }
  return null;
}

/** Window index of the seat (each seat has its own side window). */
export function seatWindow(seat) {
  return SEAT_WINDOW[seat] != null ? SEAT_WINDOW[seat] : -1;
}

/** Distance from (x, z) to the car's plan rectangle (0 inside). */
export function distToCar(car, x, z) {
  const g = carGeom(car.spec);
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  const dx = x - car.x;
  const dz = z - car.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  const ex = Math.max(0, Math.abs(lx) - g.hw);
  const ez = Math.max(0, Math.abs(lz) - g.hl);
  return Math.hypot(ex, ez);
}
