// BENTONVILLE ROYALE — oriented box colliders (static architecture: slabs, walls, glass, roofs).
//
// A box is a rectangle in plan (centre cx/cz, half extents hx along its yaw axis u = (cos, sin)
// and hz along v = (-sin, cos)) extruded from y0 to y1. Unlike prisms (World.addPoly), a box can
// float: you can walk under a bridge slab, stand on its top, bump your head on its underside and
// shoot along / under it. World.js keeps them in cell.boxes and calls these pure helpers from
// resolveCircle / groundHeight / ceilingAbove / builtAbove / raycast / blockedAt.
//
// Used by the bespoke Crystal Bridges landmark (src/world/crystal-bridges/), whose pavilions,
// bridges and glass walls are made of boxes. Fields:
//   { type: 'box', id, kind, mat, cx, cz, hx, hz, cos, sin, y0, y1, h (= y1), minX, maxX, minZ,
//     maxZ, hp, maxHp, ref, alive, stamp }

/** Make a box collider (not registered). yaw: radians, the box's local x axis is (cos yaw, sin yaw). */
export function makeBox({ id, cx, cz, hx, hz, yaw = 0, y0, y1, kind = 'museum', mat = 'brick', hp = Infinity, ref = [] }) {
  if (!(hx > 0) || !(hz > 0) || !(y1 > y0)) throw new Error('makeBox: degenerate box');
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const ex = Math.abs(cos) * hx + Math.abs(sin) * hz;
  const ez = Math.abs(sin) * hx + Math.abs(cos) * hz;
  return {
    type: 'box', id, kind, mat, cx, cz, hx, hz, cos, sin, y0, y1, h: y1, hgt: y1 - y0,
    minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
    hp, maxHp: hp, ref, alive: true, stamp: 0,
  };
}

/** Is (x, z) inside the box's plan rectangle grown by margin m? */
export function boxContains(c, x, z, m = 0) {
  const dx = x - c.cx;
  const dz = z - c.cz;
  const lx = dx * c.cos + dz * c.sin;
  const lz = -dx * c.sin + dz * c.cos;
  return lx >= -c.hx - m && lx <= c.hx + m && lz >= -c.hz - m && lz <= c.hz + m;
}

const _push = { x: 0, z: 0 };

/**
 * Plan-view push that moves a circle (x, z, r) out of the box, or null when they do not overlap.
 * Returns a shared { x, z } offset (world space).
 */
export function boxPushCircle(c, x, z, r) {
  const dx = x - c.cx;
  const dz = z - c.cz;
  const lx = dx * c.cos + dz * c.sin;
  const lz = -dx * c.sin + dz * c.cos;
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  if (ax >= c.hx + r || az >= c.hz + r) return null;
  let px = 0;
  let pz = 0;
  if (ax <= c.hx && az <= c.hz) {
    // centre inside: leave by the nearest face
    const ox = c.hx - ax + r;
    const oz = c.hz - az + r;
    if (ox < oz) px = lx >= 0 ? ox : -ox;
    else pz = lz >= 0 ? oz : -oz;
  } else {
    const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
    const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
    const ex = lx - qx;
    const ez = lz - qz;
    const d2 = ex * ex + ez * ez;
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2) || 1e-6;
    px = (ex / d) * (r - d);
    pz = (ez / d) * (r - d);
  }
  _push.x = px * c.cos - pz * c.sin;
  _push.z = px * c.sin + pz * c.cos;
  return _push;
}

const _ray = { t: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Ray (origin o, direction d, not necessarily unit) against the box. Returns a shared
 * { t, nx, ny, nz } for the entry hit with tMin < t < tMax, or null. A ray that starts inside
 * the box does not hit it (shots from inside a wall pass out of it).
 */
export function boxRay(c, ox, oy, oz, dx, dy, dz, tMin, tMax) {
  const rx = ox - c.cx;
  const rz = oz - c.cz;
  const lox = rx * c.cos + rz * c.sin;
  const loz = -rx * c.sin + rz * c.cos;
  const ldx = dx * c.cos + dz * c.sin;
  const ldz = -dx * c.sin + dz * c.cos;
  let tE = -Infinity;
  let tX = Infinity;
  let axis = -1;
  let sign = 0;
  // x slab
  if (Math.abs(ldx) < 1e-12) {
    if (lox < -c.hx || lox > c.hx) return null;
  } else {
    let t1 = (-c.hx - lox) / ldx;
    let t2 = (c.hx - lox) / ldx;
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tE) {
      tE = t1;
      axis = 0;
      sign = s;
    }
    if (t2 < tX) tX = t2;
  }
  // y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < c.y0 || oy > c.y1) return null;
  } else {
    let t1 = (c.y0 - oy) / dy;
    let t2 = (c.y1 - oy) / dy;
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tE) {
      tE = t1;
      axis = 1;
      sign = s;
    }
    if (t2 < tX) tX = t2;
  }
  // z slab
  if (Math.abs(ldz) < 1e-12) {
    if (loz < -c.hz || loz > c.hz) return null;
  } else {
    let t1 = (-c.hz - loz) / ldz;
    let t2 = (c.hz - loz) / ldz;
    let s = -1;
    if (t1 > t2) {
      const tt = t1;
      t1 = t2;
      t2 = tt;
      s = 1;
    }
    if (t1 > tE) {
      tE = t1;
      axis = 2;
      sign = s;
    }
    if (t2 < tX) tX = t2;
  }
  if (tE > tX || tE <= tMin || tE >= tMax || axis < 0) return null;
  _ray.t = tE;
  if (axis === 1) {
    _ray.nx = 0;
    _ray.ny = sign;
    _ray.nz = 0;
  } else {
    const lnx = axis === 0 ? sign : 0;
    const lnz = axis === 2 ? sign : 0;
    _ray.nx = lnx * c.cos - lnz * c.sin;
    _ray.ny = 0;
    _ray.nz = lnx * c.sin + lnz * c.cos;
  }
  return _ray;
}
