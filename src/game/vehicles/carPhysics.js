// BENTONVILLE ROYALE — arcade car handling (pure: the world is duck-typed, testable in node).
//
//   stepCar(car, dt, world) advances one car using car.input { throttle -1..1, steer -1..1,
//   handbrake, boost }. Bicycle-model steering (turns less at speed), lateral grip (the
//   handbrake lets the back slide), throttle / brake / reverse, drag, fuel, boost. The body is
//   three circles along its length pushed out of walls with world.resolveCircle; the speed lost
//   into a wall is left in car.impact (m/s) for crash damage. Wheels follow world.groundHeight
//   (cars drive up built ramps), with eased pitch and roll and gravity when the ground drops.
//
// world: { resolveCircle(pos, r, h, step), groundHeight(x, z, feetY, step), bounds?, inWater? }

import { CAR, carGeom } from './cars.js';

const GRAVITY = 24;
const STEP_UP = 0.45; // m a wheel climbs without a ramp (curbs)
const MAX_SUB = 0.4; // m per substep
const _p = { x: 0, y: 0, z: 0 };

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Top speed right now (boost, empty tank, water). */
export function carTopSpeed(car, world = null) {
  const spec = car.spec;
  if (!(car.fuel > 0)) return CAR.emptySpeed;
  let top = spec.top * (car.boostT > 0 ? CAR.boostMul : 1);
  if (world && world.inWater && world.inWater(car.x, car.z, car.y)) top = Math.min(top, CAR.waterSpeed);
  return top;
}

export function stepCar(car, dt, world) {
  if (!car.alive || !(dt > 0)) return;
  const spec = car.spec;
  const g = carGeom(spec);
  const inp = car.input;
  const thr = clamp(+inp.throttle || 0, -1, 1);
  const st = clamp(+inp.steer || 0, -1, 1);
  car.impact = 0;

  // ---- boost / fuel
  if (car.boostCd > 0) car.boostCd = Math.max(0, car.boostCd - dt);
  if (inp.boost && car.boostT <= 0 && car.boostCd <= 0 && car.fuel > 0 && thr > 0) {
    car.boostT = CAR.boostTime;
    car.boostCd = CAR.boostTime + CAR.boostCooldown;
  }
  if (car.boostT > 0) car.boostT = Math.max(0, car.boostT - dt);
  if (car.fuel > 0) car.fuel = Math.max(0, car.fuel - (Math.abs(thr) * CAR.fuelBurn + (car.boostT > 0 ? CAR.boostBurn : 0)) * dt);

  // ---- forward / side velocity
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  let vf = car.vx * sh - car.vz * ch; // along the nose
  let vs = car.vx * ch + car.vz * sh; // to the right
  const top = carTopSpeed(car, world);
  const grounded = car.grounded !== false;
  if (grounded) {
    if (thr > 0) {
      if (vf < -0.5) vf = Math.min(0, vf + spec.brake * dt);
      else if (vf < top) vf = Math.min(top, vf + spec.accel * (car.boostT > 0 ? CAR.boostAccel : 1) * thr * dt);
    } else if (thr < 0) {
      if (vf > 0.5) vf = Math.max(0, vf - spec.brake * dt);
      else if (vf > -spec.reverse) vf = Math.max(-spec.reverse, vf + spec.accel * 0.7 * thr * dt);
    } else {
      const drag = (1.5 + 0.004 * vf * vf) * dt;
      vf = Math.abs(vf) <= drag ? 0 : vf - Math.sign(vf) * drag;
    }
    if (inp.handbrake) {
      const hb = 9 * dt;
      vf = Math.abs(vf) <= hb ? 0 : vf - Math.sign(vf) * hb;
    }
    if (vf > top) vf = Math.max(top, vf - 8 * dt); // boost ended / tank ran dry: ease down
    if (vf < -spec.reverse) vf = -spec.reverse;
    vs *= Math.exp(-(inp.handbrake ? 1.8 : spec.grip) * dt);
  }

  // ---- steering (bicycle model; less wheel at speed)
  car.steer = damp(car.steer, st, 8, dt);
  const angle = car.steer * spec.steer / (1 + Math.abs(vf) / 16);
  if (grounded) {
    const yawRate = (vf / g.wheelbase) * Math.tan(angle) * (inp.handbrake ? 1.35 : 1);
    car.heading += yawRate * dt;
    car.heading = ((car.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }
  const nsh = Math.sin(car.heading);
  const nch = Math.cos(car.heading);
  car.vx = nsh * vf + nch * vs;
  car.vz = -nch * vf + nsh * vs;

  // ---- move in substeps, pushing out of walls
  const dist = Math.hypot(car.vx, car.vz) * dt;
  const n = Math.max(1, Math.min(8, Math.ceil(dist / MAX_SUB)));
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    car.x += car.vx * sdt;
    car.z += car.vz * sdt;
    collide(car, g, world);
  }
  // bounds
  const b = world && world.bounds;
  if (b) {
    const m = g.hl;
    if (car.x < b.minX + m) {
      car.x = b.minX + m;
      car.vx = Math.max(0, car.vx);
    }
    if (car.x > b.maxX - m) {
      car.x = b.maxX - m;
      car.vx = Math.min(0, car.vx);
    }
    if (car.z < b.minZ + m) {
      car.z = b.minZ + m;
      car.vz = Math.max(0, car.vz);
    }
    if (car.z > b.maxZ - m) {
      car.z = b.maxZ - m;
      car.vz = Math.min(0, car.vz);
    }
  }
  car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);

  // ---- ground: front / back axles and left / right sides
  ground(car, g, world, dt);
}

/** Push the body (three circles along it) out of anything solid; record the impact speed. */
function collide(car, g, world) {
  if (!world || !world.resolveCircle) return;
  const r = g.hw;
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  const reach = g.hl - r;
  let px = 0;
  let pz = 0;
  for (const k of [-1, 0, 1]) {
    // along the nose: local -z is forward
    const ox = sh * reach * k;
    const oz = -ch * reach * k;
    _p.x = car.x + ox;
    _p.y = car.y + 0.25;
    _p.z = car.z + oz;
    const bx = _p.x;
    const bz = _p.z;
    world.resolveCircle(_p, r, 1.2, STEP_UP);
    const dx = _p.x - bx;
    const dz = _p.z - bz;
    if (Math.abs(dx) > Math.abs(px)) px = dx;
    if (Math.abs(dz) > Math.abs(pz)) pz = dz;
  }
  const pl = Math.hypot(px, pz);
  if (pl < 1e-5) return;
  car.x += px;
  car.z += pz;
  const nx = px / pl;
  const nz = pz / pl;
  const vn = car.vx * nx + car.vz * nz;
  if (vn < 0) {
    car.impact = Math.max(car.impact, -vn);
    // lose the speed into the wall, keep a little slide along it
    car.vx -= nx * vn * 1.1;
    car.vz -= nz * vn * 1.1;
    car.vx *= 0.85;
    car.vz *= 0.85;
  }
}

function ground(car, g, world, dt) {
  if (!world || !world.groundHeight) {
    car.grounded = true;
    return;
  }
  const sh = Math.sin(car.heading);
  const ch = Math.cos(car.heading);
  const ax = g.wheelbase / 2;
  const sx = g.hw * 0.8;
  const top = car.y + STEP_UP;
  const gh = (lx, lz) => world.groundHeight(car.x + lx * ch - lz * sh, car.z + lx * sh + lz * ch, top, 0);
  const yf = gh(0, -ax);
  const yb = gh(0, ax);
  const yl = gh(-sx, 0);
  const yr = gh(sx, 0);
  const want = Math.max((yf + yb) / 2, (yl + yr) / 2, gh(0, 0));
  if (car.y > want + 0.05) {
    // airborne: fall
    car.vy -= GRAVITY * dt;
    car.y += car.vy * dt;
    if (car.y <= want) {
      car.y = want;
      car.vy = 0;
    }
    car.grounded = car.y <= want + 0.05;
  } else {
    car.y = car.y < want - 0.6 ? want : damp(car.y, want, 25, dt);
    if (car.y < want) car.y = Math.max(car.y, want - 0.02);
    car.vy = 0;
    car.grounded = true;
  }
  car.pitch = damp(car.pitch, clamp(Math.atan2(yf - yb, g.wheelbase), -0.6, 0.6), 10, dt);
  car.roll = damp(car.roll, clamp(Math.atan2(yr - yl, sx * 2), -0.4, 0.4), 10, dt);
}
