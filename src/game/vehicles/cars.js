// BENTONVILLE ROYALE — drivable cars: the three car types and the shared tuning.
//
// Car-local frame (same as the Drop Bus / reboot van meshes): x to the right, y up, front at -z.
// A car with heading h faces (sin h, -cos h); its right is (cos h, sin h). Local (lx, lz) maps to
// world (x + lx cos h - lz sin h, z + lx sin h + lz cos h), i.e. mesh.rotation.y = -h.
//
// Each car is a lower body box plus a cabin box on top. The cabin's front / back faces and its
// four side faces hold the six glass panes (WINDOW indices below). Glass stops bullets until it
// breaks; a broken pane is an opening you can shoot (and be shot) through.

export const CAR = {
  count: 40, // drivable cars per match (parking lots + curbs, spread across the map)
  enterRange: 3.5, // m from the car's side to get in
  windowHp: 60,
  explodeDamage: 75, // to everyone inside when the car blows up
  splashDamage: 30, // to anyone outside within splashRadius
  splashRadius: 4,
  wreckTime: 20, // s a burnt wreck stays (as an obstacle)
  smokeAt: 0.3, // hp fraction: engine smoke
  fireAt: 0.15, // hp fraction: engine fire
  // run-over / ramming
  ramMinSpeed: 8, // m/s relative speed before hitting someone hurts
  ramMul: 6, // damage per m/s above ramMinSpeed
  ramMin: 10,
  ramMax: 90,
  ramKnock: 9, // m/s shove
  ramCooldown: 0.7, // s between hits on the same person
  pieceRamMul: 15, // damage to a build piece per m/s
  pieceRamSelf: 0.2, // share of that the car takes
  wallHitSpeed: 12, // m/s impact before a crash hurts the car
  wallHitMul: 8,
  // boost (Shift while driving)
  boostTime: 3,
  boostCooldown: 8,
  boostMul: 1.3, // top speed while boosting
  boostAccel: 1.8,
  // fuel
  fuelMax: 100,
  fuelBurn: 1, // per second of full throttle
  boostBurn: 3, // extra per second of boost
  emptySpeed: 3, // m/s crawl on an empty tank
  gasCanFuel: 50,
  gasCanRange: 3, // m from a car to refuel it from outside
  // passengers
  leanHold: 0.4, // s a passenger stays leaned out after letting go of aim / fire
  leanOut: 0.55, // m a leaning passenger sits outside their window
  pickaxeDamage: 25,
  grenadeDamage: 200, // a blast in range (falls off to 40% at the edge); also blows out near glass
  rocketDamage: 260,
  seatedHeight: 1.15, // hit cylinder of someone sitting inside
  floorY: 0.3, // seat base above the car's ground point (where a seated actor's feet are)
  waterSpeed: 4,
};

// windows: 0 windshield, 1 rear, 2 front-left, 3 front-right, 4 rear-left, 5 rear-right
export const WINDOW = { front: 0, back: 1, fl: 2, fr: 3, rl: 4, rr: 5 };
export const WINDOW_COUNT = 6;
// seats: 0 driver (front left), 1 front passenger, 2 rear left, 3 rear right; each has its window
export const SEAT_WINDOW = [WINDOW.fl, WINDOW.fr, WINDOW.rl, WINDOW.rr];
export const SEAT_NAMES = ['Driver', 'Passenger', 'Back left', 'Back right'];

export const CAR_TYPES = {
  sedan: {
    id: 'sedan',
    name: 'Sedan',
    hp: 500,
    top: 26,
    accel: 9,
    reverse: 8,
    brake: 20,
    steer: 0.55, // max wheel angle (rad) at low speed
    grip: 9,
    mass: 1,
    len: 4.6,
    wid: 1.9,
    body: { y0: 0.3, y1: 1.02 },
    cabin: { y1: 1.5, z0: -0.85, z1: 1.2 },
    colors: [0xd23b3b, 0x2f6fd0, 0xf2f2ee, 0x2a2d33, 0x3c9a5b, 0xe0a63a],
  },
  suv: {
    id: 'suv',
    name: 'SUV',
    hp: 650,
    top: 22,
    accel: 7.5,
    reverse: 7,
    brake: 18,
    steer: 0.5,
    grip: 8,
    mass: 1.35,
    len: 4.8,
    wid: 2.0,
    body: { y0: 0.38, y1: 1.15 },
    cabin: { y1: 1.85, z0: -0.85, z1: 1.95 },
    colors: [0x1f2a3a, 0x8a8f96, 0x6b3a2a, 0xf0efe8, 0x355e3b],
  },
  pickup: {
    id: 'pickup',
    name: 'Pickup',
    hp: 450,
    top: 29,
    accel: 10,
    reverse: 8,
    brake: 20,
    steer: 0.55,
    grip: 8.5,
    mass: 1.1,
    len: 5.2,
    wid: 1.95,
    body: { y0: 0.4, y1: 1.1 },
    cabin: { y1: 1.75, z0: -0.85, z1: 0.75 },
    bed: true, // open cargo bed behind the cabin
    colors: [0xc9472b, 0x2c4c7a, 0xd9d4c4, 0x3a3a3a, 0x7a8a3a],
  },
};
export const CAR_TYPE_IDS = Object.keys(CAR_TYPES);

/** Derived geometry for a car type (cached on the spec). */
export function carGeom(spec) {
  if (spec._g) return spec._g;
  const hl = spec.len / 2;
  const hw = spec.wid / 2;
  const c = spec.cabin;
  const cw = hw - 0.08; // cabin half width
  const mid = (c.z0 + c.z1) / 2;
  const L = c.z1 - c.z0;
  const wy0 = spec.body.y1 + 0.06; // glass bottom
  const wy1 = c.y1 - 0.09; // glass top
  const pillar = 0.1;
  // window rects: face axis/sign + the rectangle on that face (u = along the face, v = height)
  const windows = [
    { axis: 'z', side: -1, u0: -cw + pillar, u1: cw - pillar, y0: wy0, y1: wy1 }, // windshield (front face z = c.z0)
    { axis: 'z', side: 1, u0: -cw + pillar, u1: cw - pillar, y0: wy0, y1: wy1 }, // rear (z = c.z1)
    { axis: 'x', side: -1, u0: c.z0 + pillar, u1: mid - pillar / 2, y0: wy0, y1: wy1 }, // front left
    { axis: 'x', side: 1, u0: c.z0 + pillar, u1: mid - pillar / 2, y0: wy0, y1: wy1 }, // front right
    { axis: 'x', side: -1, u0: mid + pillar / 2, u1: c.z1 - pillar, y0: wy0, y1: wy1 }, // rear left
    { axis: 'x', side: 1, u0: mid + pillar / 2, u1: c.z1 - pillar, y0: wy0, y1: wy1 }, // rear right
  ];
  const seatX = Math.min(0.45, cw - 0.4);
  const seats = [
    { x: -seatX, z: c.z0 + L * 0.32 },
    { x: seatX, z: c.z0 + L * 0.32 },
    { x: -seatX, z: c.z0 + L * 0.74 },
    { x: seatX, z: c.z0 + L * 0.74 },
  ];
  spec._g = {
    hl,
    hw,
    cw,
    wheelbase: spec.len * 0.62,
    body: { x0: -hw, x1: hw, y0: spec.body.y0, y1: spec.body.y1, z0: -hl, z1: hl },
    cabin: { x0: -cw, x1: cw, y0: spec.body.y1, y1: c.y1, z0: c.z0, z1: c.z1 },
    windows,
    seats,
    height: c.y1,
  };
  return spec._g;
}

/** Local (lx, lz) of a car to world, into out { x, z }. */
export function carToWorld(car, lx, lz, out = { x: 0, z: 0 }) {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  out.x = car.x + lx * c - lz * s;
  out.z = car.z + lx * s + lz * c;
  return out;
}

/** World (x, z) to car-local, into out { x, z }. */
export function worldToCar(car, x, z, out = { x: 0, z: 0 }) {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  const dx = x - car.x;
  const dz = z - car.z;
  out.x = dx * c + dz * s;
  out.z = -dx * s + dz * c;
  return out;
}

/** A fresh car record (pure data; Vehicles adds the mesh). */
export function makeCar(id, type, x, y, z, heading, { fuel = CAR.fuelMax, color = 0 } = {}) {
  const spec = CAR_TYPES[type] || CAR_TYPES.sedan;
  return {
    id,
    type: spec.id,
    spec,
    x,
    y,
    z,
    heading,
    home: { x, y, z, heading, fuel },
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0, // signed forward speed (m/s)
    steer: 0, // -1..1 (eased)
    pitch: 0,
    roll: 0,
    hp: spec.hp,
    maxHp: spec.hp,
    windows: new Array(WINDOW_COUNT).fill(CAR.windowHp),
    seats: [null, null, null, null], // actors
    fuel,
    color,
    boostT: 0, // s of boost left
    boostCd: 0, // s until boost is ready
    impact: 0, // last step's wall impact speed (m/s)
    alive: true,
    wreckT: 0,
    lastAttacker: null,
    input: { throttle: 0, steer: 0, handbrake: false, boost: false },
    mesh: null,
  };
}

/** Seat index of `actor` in `car`, or -1. */
export function seatOf(car, actor) {
  return car ? car.seats.indexOf(actor) : -1;
}

/** First free seat: the driver's if free (or `prefer`), else the nearest free one to local (lx, lz). */
export function pickSeat(car, lx = 0, lz = 0, prefer = 0) {
  const s = car.seats;
  if (prefer >= 0 && prefer < s.length && !s[prefer]) return prefer;
  const g = carGeom(car.spec);
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < s.length; i++) {
    if (s[i]) continue;
    const d = Math.hypot(g.seats[i].x - lx, g.seats[i].z - lz);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Next free seat after `from` (cycling), or -1 when every other seat is taken. */
export function nextSeat(car, from) {
  const n = car.seats.length;
  for (let k = 1; k < n; k++) {
    const i = (from + k) % n;
    if (!car.seats[i]) return i;
  }
  return -1;
}

/** Run-over damage at a relative speed (0 below the threshold). */
export function ramDamage(speed) {
  if (!(speed > CAR.ramMinSpeed)) return 0;
  return Math.max(CAR.ramMin, Math.min(CAR.ramMax, (speed - CAR.ramMinSpeed) * CAR.ramMul));
}
