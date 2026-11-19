// BENTONVILLE ROYALE — drivable cars: spawning, seats, damage, explosions, run-overs, fuel.
//
//   const v = new Vehicles({ scene, world, fx, sfx, combat, structures });
//   v.setup()                         // once the world is built: places CAR.count cars (same spots
//                                     // on every machine: they only depend on the map)
//   v.reset({ authoritative })        // match start: every car back home, full HP, glass and seats
//   v.nearest(actor) / v.enter(actor, car) / v.exit(actor) / v.switchSeat(actor)
//   v.ray(origin, dir, maxT, shooter) // Combat: the first car part a shot meets (glass / body)
//   v.damage(car, amount, info, part, idx) / v.blast(pos, radius, damage, info)
//   v.update(dt, actors)              // physics for driven / coasting cars, occupants pinned to
//                                     // their seats, run-overs, crash damage, effects
//   v.onEvent = (e) => {}             // host: replicate (see HostSession / ClientSession)
//   v.applyEvent(e, actorById)        // client: mirror the host's events
//   v.poses() / v.applyPoses(rows)    // host -> clients: where the moving cars are
//   v.stations = [...]                // gas stations (vehicles/gasStations.js): meshes culled here
//   v.pumpFuel(car, add) / v.pumpFuelDone(car)  // a pump nozzle fills a car (GasPumps.js;
//                                     // authoritative; clients get 'vf' events every few units)
//
// Authoritative (solo / host) decides seats, damage, explosions and run-overs. A multiplayer
// client drives its own car (local physics, sent to the host with 'drv' actions) and mirrors
// everything else. Seated actors carry `vehicle` (the car), `seat` (0 = driver) and `leaning`.
//
// Shots: car bodies are world boxes (solid to walk / stand / build) with `noRay`, so
// world.raycast never sees them; Combat asks ray() instead, which knows about the glass.

import { CAR, CAR_TYPES, CAR_TYPE_IDS, carGeom, makeCar, pickSeat, nextSeat, seatOf, ramDamage, worldToCar } from './vehicles/cars.js';
import { rayCars, seatWorldPos, exitSpot, distToCar } from './vehicles/carHit.js';
import { stepCar } from './vehicles/carPhysics.js';
import { STATION } from './vehicles/gasStations.js';
import { sameTeam } from './Teams.js';

const DRAW_DIST = 260; // m: cars further than this from the camera are hidden
const MIN_GAP = 20; // m between spawn spots
const LOT_AREA = 400; // m2 of parking lot per car
const LOT_MAX = 4; // cars in one lot at most
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const PUMP_SEND = 2; // fuel gained at a pump between 'vf' events (and one more when it stops)
const PUMP_GRACE = 1; // s after pump fuel a remote driver's (stale, lower) fuel report is ignored

/** Small deterministic RNG from a string (same car spots on every machine). */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 1) / 0x7fffffff;
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const shortAngle = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

function pointInPoly(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0];
    const zi = p[i][1];
    const xj = p[j][0];
    const zj = p[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class Vehicles {
  constructor({ scene = null, world = null, fx = null, sfx = null, combat = null, structures = null, meshFactory = null } = {}) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sfx = sfx;
    this.combat = combat;
    this.structures = structures;
    this.meshFactory = meshFactory; // (spec, color) => THREE.Object3D (Game passes buildCarMesh)
    this.cars = [];
    this.byId = new Map();
    this.authoritative = true;
    this.onEvent = null;
    this.viewer = null; // camera position: distance culling
    this.local = null; // the local player (a client simulates the car it drives)
    this.time = 0;
    this._smokeT = 0;
    this.stations = null; // gas stations (vehicles/gasStations.js), set by Game
    // the orbit camera keeps its lens out of cars too (Player.placeOrbitCamera)
    if (world) world.carRay = (ox, oy, oz, dx, dy, dz, maxT, ignoreCar) => (this.cars.length ? rayCars(this.cars, ox, oy, oz, dx, dy, dz, maxT, ignoreCar) : null);
  }

  get teamMode() {
    return !!(this.combat && this.combat.teamMode);
  }

  _emit(e) {
    if (this.authoritative && this.onEvent) this.onEvent(e);
  }

  // ---------------------------------------------------------------- setup

  /** Spawn spots: parking lots and the curbs of main roads. Safe to call once. */
  setup() {
    if (this.cars.length || !this.world) return this.cars;
    const spots = this._spots();
    const rng = seeded('cars:types');
    spots.forEach((sp, i) => {
      const type = CAR_TYPE_IDS[Math.floor(rng() * CAR_TYPE_IDS.length) % CAR_TYPE_IDS.length];
      const spec = CAR_TYPES[type];
      const color = spec.colors[Math.floor(rng() * spec.colors.length) % spec.colors.length];
      const fuel = Math.round(40 + rng() * 60);
      const y = this.world.surfaceHeight ? this.world.surfaceHeight(sp.x, sp.z) : 0;
      this._add(makeCar(i, type, sp.x, y, sp.z, sp.heading, { fuel, color }));
    });
    return this.cars;
  }

  /** Adds a car (tests and setup): world boxes and, with a scene, its mesh. */
  _add(car) {
    car.seats = [null, null, null, null];
    this.cars.push(car);
    this.byId.set(car.id, car);
    const g = carGeom(car.spec);
    const w = this.world;
    if (w && w.addDynBox) {
      car.boxBody = w.addDynBox({ cx: car.x, cz: car.z, hx: g.hw, hz: g.hl, yaw: car.heading, y0: car.y + g.body.y0 - 0.25, y1: car.y + g.body.y1, kind: 'vehicle', mat: 'metal' });
      car.boxCabin = w.addDynBox({ cx: car.x + Math.sin(car.heading) * 0, cz: car.z, hx: g.cw, hz: (g.cabin.z1 - g.cabin.z0) / 2, yaw: car.heading, y0: car.y + g.cabin.y0, y1: car.y + g.cabin.y1, kind: 'vehicle', mat: 'metal' });
      car.boxBody.car = car;
      car.boxCabin.car = car;
      this._placeBoxes(car);
    }
    if (this.scene && this.meshFactory) {
      car.mesh = this.meshFactory(car.spec, car.color);
      if (car.mesh) {
        this.scene.add(car.mesh);
        car.mesh.userData.pose(car, 0);
      }
    }
    return car;
  }

  _spots() {
    const w = this.world;
    const data = w.data || {};
    const rng = seeded('cars:spots');
    const cands = [];
    const clear = (x, z) =>
      (!w.inBounds || w.inBounds(x, z, 30)) &&
      (!w.blockedAt || !w.blockedAt(x, z, 3.2)) &&
      (!w.areaAt || w.areaAt(x, z) !== 'water') &&
      (!w.reservedAt || !w.reservedAt(x, z)) &&
      (!w.interiorAt || !w.interiorAt(x, z));
    // parking lots: along the lot's longest edge
    for (const a of data.areas || []) {
      if (a.k !== 'parking' || !a.p || a.p.length < 3) continue;
      let best = 0;
      let ang = 0;
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < a.p.length; i++) {
        const p = a.p[i];
        const q = a.p[(i + 1) % a.p.length];
        cx += p[0] / a.p.length;
        cz += p[1] / a.p.length;
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (l > best) {
          best = l;
          ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        }
      }
      // big lots hold a few cars (about one per LOT_AREA m2, up to LOT_MAX), spread over the lot
      let area = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < a.p.length; i++) {
        const p = a.p[i];
        const q = a.p[(i + 1) % a.p.length];
        area += p[0] * q[1] - q[0] * p[1];
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[1]);
        maxZ = Math.max(maxZ, p[1]);
      }
      const want = Math.max(1, Math.min(LOT_MAX, Math.floor(Math.abs(area) / 2 / LOT_AREA)));
      let got = 0;
      for (let k = 0; k < 12 * want && got < want; k++) {
        const x = got === 0 ? cx + (rng() - 0.5) * 24 : minX + rng() * (maxX - minX);
        const z = got === 0 ? cz + (rng() - 0.5) * 24 : minZ + rng() * (maxZ - minZ);
        if (!pointInPoly(a.p, x, z) || !clear(x, z)) continue;
        // facing along the lot (heading: forward = (sin h, -cos h))
        const heading = Math.atan2(Math.cos(ang), -Math.sin(ang)) + (rng() < 0.5 ? Math.PI : 0);
        cands.push({ x, z, heading, w: 2 });
        got++;
      }
    }
    // main roads: parked at the curb, pointing along the road
    for (const r of data.roads || []) {
      if (!MAJOR.has(r.k) || !r.p || r.p.length < 2) continue;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const [ax, az] = r.p[i];
        const [bx, bz] = r.p[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 16 || rng() > 0.85) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        const side = rng() < 0.5 ? 1 : -1;
        const off = (r.w || 8) / 2 - 1.3;
        const t = 0.3 + rng() * 0.4;
        const x = ax + ux * len * t - uz * off * side;
        const z = az + uz * len * t + ux * off * side;
        if (!clear(x, z)) continue;
        // drive on the right: the car on the +side faces along +u
        const heading = Math.atan2(ux, -uz) + (side > 0 ? 0 : Math.PI);
        cands.push({ x, z, heading, w: 1 });
      }
    }
    // shuffle (deterministic), then keep spots MIN_GAP apart: about 2/3 lots, 1/3 roads
    for (let i = cands.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = cands[i];
      cands[i] = cands[j];
      cands[j] = t;
    }
    const out = [];
    const wantRoad = Math.round(CAR.count / 3);
    let roads = 0;
    for (const pass of [2, 1, 2, 1]) {
      for (const c of cands) {
        if (out.length >= CAR.count) break;
        if (c.w !== pass || c.used) continue;
        if (pass === 1 && roads >= wantRoad && out.length < CAR.count - 2) continue;
        if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < MIN_GAP)) continue;
        c.used = true;
        if (pass === 1) roads++;
        out.push(c);
        if (pass === 2 && out.filter((o) => o.w === 2).length >= CAR.count - wantRoad) break;
      }
    }
    return out;
  }

  /** Match start: everything back to how it was parked. */
  reset({ authoritative = true } = {}) {
    this.authoritative = authoritative;
    this.time = 0;
    for (const car of this.cars) {
      const h = car.home;
      for (let i = 0; i < car.seats.length; i++) {
        const a = car.seats[i];
        if (a && a.vehicle === car) this._clearActor(a);
        car.seats[i] = null;
      }
      Object.assign(car, { x: h.x, y: h.y, z: h.z, heading: h.heading, fuel: h.fuel, vx: 0, vy: 0, vz: 0, speed: 0, steer: 0, pitch: 0, roll: 0, hp: car.maxHp, alive: true, wreckT: 0, lastAttacker: null, boostT: 0, boostCd: 0, impact: 0, net: null, gone: false });
      car.windows.fill(CAR.windowHp);
      car._broken = null;
      car._pumpT = -Infinity;
      car._pumpSent = null;
      car.input.throttle = car.input.steer = 0;
      car.input.handbrake = car.input.boost = false;
      this._placeBoxes(car);
      if (car.mesh) {
        car.mesh.visible = true;
        car.mesh.userData.setWreck(false);
        car.mesh.userData.resetPanes();
        car.mesh.userData.pose(car, 0);
      }
    }
  }

  _placeBoxes(car) {
    const w = this.world;
    if (!w || !w.moveDynBox || !car.boxBody) return;
    const g = carGeom(car.spec);
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    const midZ = (g.cabin.z0 + g.cabin.z1) / 2;
    w.moveDynBox(car.boxBody, car.x, car.z, car.heading, car.y + g.body.y0 - 0.25, car.y + g.body.y1);
    w.moveDynBox(car.boxCabin, car.x - midZ * s, car.z + midZ * c, car.heading, car.y + g.cabin.y0, car.y + g.cabin.y1);
    car._boxAt = { x: car.x, y: car.y, z: car.z, h: car.heading };
  }

  _liftBoxes(car) {
    const w = this.world;
    if (!w || !car.boxBody) return;
    w.remove(car.boxBody);
    w.remove(car.boxCabin);
  }

  // ---------------------------------------------------------------- queries

  /** The car `actor` could get into (within CAR.enterRange of its side, a free seat), or null. */
  nearest(actor, range = CAR.enterRange) {
    if (!actor || actor.vehicle) return null;
    let best = null;
    let bd = range;
    for (const car of this.cars) {
      if (!car.alive || car.seats.every(Boolean)) continue;
      if (Math.abs(actor.pos.y - car.y) > 2.5) continue;
      const d = distToCar(car, actor.pos.x, actor.pos.z);
      if (d < bd) {
        bd = d;
        best = car;
      }
    }
    return best;
  }

  /** A car within `range` of a point (gas cans from outside), or null. */
  near(pos, range = CAR.gasCanRange) {
    let best = null;
    let bd = range;
    for (const car of this.cars) {
      if (!car.alive) continue;
      const d = distToCar(car, pos.x, pos.z);
      if (d < bd && Math.abs(pos.y - car.y) < 3) {
        bd = d;
        best = car;
      }
    }
    return best;
  }

  /** Shots: first car part along the ray (the shooter's own car is ignored). */
  ray(origin, dir, maxT, shooter = null) {
    if (!this.cars.length) return null;
    return rayCars(this.cars, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT, shooter && shooter.vehicle ? shooter.vehicle : null);
  }

  // ---------------------------------------------------------------- seats

  /** Get in (authoritative, or a client applying the host's word). Returns the seat or -1. */
  enter(actor, car, seat = -1) {
    if (!actor || !car || !car.alive || actor.vehicle) return -1;
    if (!(seat >= 0 && seat < 4 && !car.seats[seat])) {
      const l = worldToCar(car, actor.pos.x, actor.pos.z);
      seat = pickSeat(car, l.x, l.z, 0);
    }
    if (seat < 0) return -1;
    car.seats[seat] = actor;
    actor.vehicle = car;
    actor.seat = seat;
    actor.leaning = false;
    if (actor.vel) actor.vel.set(0, 0, 0);
    actor.crouching = false;
    if (actor.character && actor.character.setSeated) actor.character.setSeated(true);
    this._pin(car, seat, actor);
    if (this.sfx) this.sfx.play('car_door', { x: car.x, y: car.y + 1, z: car.z });
    this._emit({ e: 've', c: car.id, a: actor.id, s: seat });
    return seat;
  }

  /** Get out beside the seat (or wherever is clear). Returns true when they left. */
  exit(actor, { force = false } = {}) {
    const car = actor && actor.vehicle;
    if (!car) return false;
    const seat = seatOf(car, actor);
    const w = this.world;
    const spot = exitSpot(car, seat < 0 ? 0 : seat, w && w.blockedAt ? (x, z, r) => w.blockedAt(x, z, r) : null);
    void force;
    // boxed in on every side: climb out onto the roof (always possible)
    const x = spot ? spot.x : car.x;
    const z = spot ? spot.z : car.z;
    this._unseat(actor, car, x, z, spot ? null : car.y + carGeom(car.spec).height + 0.05);
    if (this.sfx) this.sfx.play('car_door', { x: car.x, y: car.y + 1, z: car.z });
    this._emit({ e: 've', c: car.id, a: actor.id, s: -1, x: r2(x), z: r2(z) });
    return true;
  }

  _unseat(actor, car, x, z, onY = null) {
    const seat = seatOf(car, actor);
    if (seat >= 0) car.seats[seat] = null;
    if (seat === 0) {
      car.input.throttle = car.input.steer = 0;
      car.input.boost = false;
      car.input.handbrake = false;
      // host: a car a remote player drove now coasts on our own physics from where it is
      if (this.authoritative && car.net) {
        car.x = car.net.x;
        car.y = car.net.y;
        car.z = car.net.z;
        car.heading = car.net.h;
        car.net = null;
      }
    }
    this._clearActor(actor);
    const y = onY != null ? onY : this.world && this.world.groundHeight ? this.world.groundHeight(x, z, car.y + 1.5) : car.y;
    actor.pos.set(x, y, z);
    if (actor.vel) actor.vel.set(car.vx * 0.5, 0, car.vz * 0.5);
    if (actor.drawPos) actor.drawPos.copy(actor.pos);
    if (actor.isRemote) actor.allowJump = true; // its next state comes from beside the car
  }

  _clearActor(a) {
    a.vehicle = null;
    a.seat = -1;
    a.leaning = false;
    if (a.character && a.character.setSeated) a.character.setSeated(false);
  }

  /** Move to the next free seat. Returns the new seat or -1. */
  switchSeat(actor) {
    const car = actor && actor.vehicle;
    if (!car) return -1;
    const from = seatOf(car, actor);
    const to = nextSeat(car, from);
    if (to < 0) return -1;
    car.seats[from] = null;
    car.seats[to] = actor;
    actor.seat = to;
    actor.leaning = false;
    if (from === 0) {
      car.input.throttle = car.input.steer = 0;
      car.input.boost = false;
    }
    this._pin(car, to, actor);
    this._emit({ e: 've', c: car.id, a: actor.id, s: to });
    return to;
  }

  setLean(actor, on) {
    if (!actor || !actor.vehicle || actor.seat <= 0) on = false;
    actor.leaning = !!on;
  }

  horn(car) {
    if (!car || !car.alive) return;
    if (this.sfx) this.sfx.play('horn', { x: car.x, y: car.y + 1, z: car.z });
    this._emit({ e: 'vh', c: car.id });
  }

  refuel(car, amount = CAR.gasCanFuel) {
    if (!car || !car.alive) return false;
    car.fuel = Math.min(CAR.fuelMax, car.fuel + amount);
    this._emit({ e: 'vf', c: car.id, f: Math.round(car.fuel) });
    return true;
  }

  /**
   * Authoritative: a pump nozzle (GasPumps.js) pours `add` fuel into `car`, up to a full tank.
   * Clients hear about it every PUMP_SEND units and when it is full. Returns the fuel added.
   */
  pumpFuel(car, add) {
    if (!car || !car.alive || !(add > 0)) return 0;
    const before = Math.max(0, car.fuel);
    car.fuel = Math.min(CAR.fuelMax, before + add);
    car._pumpT = this.time;
    if (car._pumpSent == null) car._pumpSent = before;
    if (car.fuel >= CAR.fuelMax || car.fuel - car._pumpSent >= PUMP_SEND) {
      car._pumpSent = car.fuel;
      this._emit({ e: 'vf', c: car.id, f: Math.round(car.fuel) });
    }
    return car.fuel - before;
  }

  /** The nozzle stopped pumping into `car`: one last 'vf' when clients are behind. */
  pumpFuelDone(car) {
    if (!car || car._pumpSent == null) return;
    if (Math.round(car._pumpSent) !== Math.round(car.fuel)) this._emit({ e: 'vf', c: car.id, f: Math.round(car.fuel) });
    car._pumpSent = null;
  }

  // ---------------------------------------------------------------- damage

  /** Damage a car (authoritative). Glass soaks hits until it breaks; the body loses HP. */
  damage(car, amount, info = {}, part = 'body', idx = -1) {
    if (!car || !car.alive || !(amount > 0)) return 0;
    if (info.source) car.lastAttacker = info.source;
    if (part === 'window' && idx >= 0 && car.windows[idx] > 0) {
      car.windows[idx] -= amount;
      if (car.windows[idx] <= 0) this.breakWindow(car, idx);
      return amount;
    }
    car.hp = Math.max(0, car.hp - amount);
    if (car.hp <= 0) this.explode(car, info);
    else this._emit({ e: 'vd', c: car.id, hp: Math.round(car.hp) });
    return amount;
  }

  breakWindow(car, idx) {
    if (!car || idx < 0 || idx >= car.windows.length || (car.windows[idx] <= 0 && car._broken && car._broken[idx])) return;
    car.windows[idx] = 0;
    (car._broken || (car._broken = []))[idx] = true;
    const m = car.mesh && car.mesh.userData;
    if (m) {
      m.breakPane(idx);
      if (this.fx && this.fx.debris && this._near(car, 120)) this.fx.debris(m.panePos(idx), 'glass', { count: 10, size: 0.08, spread: 1.2 });
    }
    if (this.sfx) this.sfx.play('glass_break', { x: car.x, y: car.y + 1.2, z: car.z });
    this._emit({ e: 'vw', c: car.id, i: idx });
  }

  /** Blow up: occupants take CAR.explodeDamage, bystanders a splash, the car becomes a wreck. */
  explode(car, info = {}) {
    if (!car || !car.alive) return;
    car.alive = false;
    car.hp = 0;
    car.wreckT = CAR.wreckTime;
    car.vx = car.vz = car.speed = 0;
    const source = car.lastAttacker || info.source || null;
    const occupants = car.seats.filter(Boolean);
    for (const a of occupants) {
      const seat = seatOf(car, a);
      const w = this.world;
      const spot = exitSpot(car, seat, w && w.blockedAt ? (x, z, r) => w.blockedAt(x, z, r) : null);
      this._unseat(a, car, spot ? spot.x : car.x, spot ? spot.z : car.z);
      this._emit({ e: 've', c: car.id, a: a.id, s: -1, x: r2(a.pos.x), z: r2(a.pos.z) });
    }
    this._blowFx(car);
    this._emit({ e: 'vx', c: car.id });
    if (!this.authoritative || !this.combat) return;
    const point = { x: car.x, y: car.y + 1, z: car.z };
    for (const a of occupants) this.combat.applyDamage(a, CAR.explodeDamage, { source, weapon: 'car_explosion', explosive: true, point });
    for (const a of this.combat.actors || []) {
      if (!a.alive || a.inBus || occupants.includes(a) || a.vehicle) continue;
      const d = Math.hypot(a.pos.x - car.x, a.pos.z - car.z);
      if (d > CAR.splashRadius + carGeom(car.spec).hl * 0.5 || Math.abs(a.pos.y - car.y) > 3) continue;
      this.combat.applyDamage(a, CAR.splashDamage, { source, weapon: 'car_explosion', explosive: true, point });
    }
  }

  _blowFx(car) {
    if (car.mesh) {
      car.mesh.userData.setWreck(true);
      car.mesh.userData.pose(car, 0);
    }
    const p = { x: car.x, y: car.y + 1, z: car.z };
    if (this.fx && this.fx.explosion) this.fx.explosion(p, { radius: 5 });
    if (this.sfx) this.sfx.play('explosion', { x: p.x, y: p.y, z: p.z, volume: 1 });
  }

  /** Area damage (grenades, rockets): every car in the radius takes `damage` with falloff. */
  blast(pos, radius, damage, info = {}) {
    if (!this.authoritative) return;
    for (const car of this.cars) {
      if (!car.alive) continue;
      const d = distToCar(car, pos.x, pos.z);
      if (d > radius || Math.abs(pos.y - (car.y + 1)) > radius) continue;
      const k = 1 - 0.6 * (d / radius);
      // the blast also blows out the nearest glass
      if (d < radius * 0.6) {
        for (let i = 0; i < car.windows.length; i++) if (car.windows[i] > 0) this.breakWindow(car, i);
      }
      this.damage(car, damage * k, info);
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt, actors = []) {
    if (!(dt > 0)) return;
    this.time += dt;
    for (const car of this.cars) {
      if (!car.alive) {
        this._wreck(car, dt);
        continue;
      }
      // occupants who went down / died / left fall out
      for (let i = 0; i < car.seats.length; i++) {
        const a = car.seats[i];
        if (!a) continue;
        if (a.vehicle !== car) {
          car.seats[i] = null;
          continue;
        }
        if (this.authoritative && (!a.alive || a.downed)) this.exit(a, { force: true });
      }
      const driver = car.seats[0];
      const moving = Math.abs(car.vx) + Math.abs(car.vz) > 0.05 || car.vy !== 0;
      let sim;
      if (this.authoritative) sim = driver ? !driver.isRemote : moving && !car.net;
      else sim = !!driver && driver === this.local;
      if (sim) {
        if (!driver) {
          car.input.throttle = car.input.steer = 0;
          car.input.boost = false;
          car.input.handbrake = false;
        }
        this._liftBoxes(car);
        stepCar(car, dt, this.world);
        this._placeBoxes(car);
        if (car.impact > CAR.wallHitSpeed) {
          if (this.sfx) this.sfx.play('car_crash', { x: car.x, y: car.y + 0.8, z: car.z });
          if (this.authoritative) this.damage(car, (car.impact - CAR.wallHitSpeed) * CAR.wallHitMul, { source: null });
        }
      } else if (car.net) {
        this._follow(car, dt);
      }
      if (!car.alive) continue;
      if (this.authoritative) {
        this._runOver(car, actors);
        this._ramPieces(car, dt);
      }
      for (let i = 0; i < car.seats.length; i++) if (car.seats[i]) this._pin(car, i, car.seats[i]);
    }
    this._present(dt);
  }

  /** Puts a seated actor in (or out of the window of) their seat. */
  _pin(car, seat, a) {
    const p = seatWorldPos(car, seat, !!a.leaning && seat > 0);
    a.pos.set(p.x, p.y, p.z);
    if (a.vel) a.vel.set(car.vx || 0, 0, car.vz || 0);
    // (network puppets derive mode / grounded from their snapshot flags: leave those alone)
    if (!a.setRow) {
      a.grounded = true;
      if (a.alive) a.mode = 'ground';
      a.swimming = false;
    }
    if (a.drawPos) a.drawPos.copy(a.pos);
    const ch = a.character;
    if (ch && ch.root) {
      ch.root.position.copy(a.pos);
      if (ch.setSeated) ch.setSeated(true);
      // sitting faces the road; leaning out faces where they aim
      if (!a.leaning) {
        ch._yaw = car.heading;
        ch.root.rotation.y = Math.PI - car.heading;
      }
      ch.root.visible = !a.scopeView;
    }
  }

  /** Network-driven car: ease toward the latest pose. */
  _follow(car, dt) {
    const n = car.net;
    const k = 1 - Math.exp(-14 * dt);
    const far = Math.hypot(n.x - car.x, n.z - car.z) > 12;
    car.x = far ? n.x : car.x + (n.x - car.x) * k;
    car.y = far ? n.y : car.y + (n.y - car.y) * k;
    car.z = far ? n.z : car.z + (n.z - car.z) * k;
    car.heading += shortAngle(n.h - car.heading) * (far ? 1 : k);
    car.pitch += (n.p - car.pitch) * k;
    car.roll += (n.r - car.roll) * k;
    car.speed = n.sp;
    car.steer = n.st;
    car.vx = Math.sin(car.heading) * n.sp;
    car.vz = -Math.cos(car.heading) * n.sp;
    const b = car._boxAt;
    if (!b || Math.abs(b.x - car.x) + Math.abs(b.z - car.z) + Math.abs(b.y - car.y) > 0.02 || Math.abs(shortAngle(b.h - car.heading)) > 0.005) this._placeBoxes(car);
    if (Math.abs(n.sp) < 0.05 && !car.seats[0] && Math.hypot(n.x - car.x, n.z - car.z) < 0.02) {
      car.vx = car.vz = 0;
      car.net = null; // parked again
    }
  }

  /** Hitting people at speed (authoritative). */
  _runOver(car, actors) {
    const sp = Math.hypot(car.vx, car.vz);
    if (sp <= CAR.ramMinSpeed || !this.combat) return;
    const g = carGeom(car.spec);
    const driver = car.seats[0] || null;
    for (const a of actors) {
      if (!a.alive || a.inBus || a.vehicle || a.carriedBy) continue;
      if (Math.abs(a.pos.y - car.y) > 2) continue;
      if (Math.abs(a.pos.x - car.x) > g.hl + 2 || Math.abs(a.pos.z - car.z) > g.hl + 2) continue;
      // people are pushed out of the car's box as it moves, so look a little ahead of it
      const d = distToCar(car, a.pos.x, a.pos.z);
      if (d > (a.radius || 0.4) + 0.35 + sp * 0.04) continue;
      if ((a.pos.x - car.x) * car.vx + (a.pos.z - car.z) * car.vz <= 0) continue; // only what it drives into
      if (this.teamMode && driver && sameTeam(a, driver)) continue;
      if (a._ramUntil && a._ramUntil > this.time) continue;
      a._ramUntil = this.time + CAR.ramCooldown;
      // relative speed along the push direction
      let nx = a.pos.x - car.x;
      let nz = a.pos.z - car.z;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      const rel = Math.max(0, (car.vx - (a.vel ? a.vel.x : 0)) * nx + (car.vz - (a.vel ? a.vel.z : 0)) * nz);
      const dmg = ramDamage(Math.max(rel, sp * 0.7));
      if (!dmg) continue;
      this.combat.applyDamage(a, dmg, { source: driver, weapon: 'car_ram', point: { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z } });
      // shove them clear (remote players move themselves; the hit still lands)
      if (!a.isRemote) {
        const out = (a.radius || 0.4) + 0.3 - d;
        if (out > 0) {
          a.pos.x += nx * out;
          a.pos.z += nz * out;
        }
        if (a.vel) {
          a.vel.x += nx * CAR.ramKnock;
          a.vel.z += nz * CAR.ramKnock;
          a.vel.y = Math.max(a.vel.y || 0, 4);
          a.grounded = false;
        }
      }
      car.vx *= 0.85;
      car.vz *= 0.85;
      if (this.sfx) this.sfx.play('car_crash', { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z, volume: 0.6 });
    }
  }

  /** Driving into a build piece at speed breaks it (and dents the car). */
  _ramPieces(car, dt) {
    const sp = Math.abs(car.speed);
    const w = this.world;
    if (sp < 4 || !this.structures || !w || !w.raycast) return;
    const g = carGeom(car.spec);
    const dir = car.speed >= 0 ? 1 : -1;
    const fx = Math.sin(car.heading) * dir;
    const fz = -Math.cos(car.heading) * dir;
    const reach = g.hl + sp * dt + 0.5;
    for (const y of [0.6, 1.2]) {
      const hit = w.raycast(car.x, car.y + y, car.z, fx, 0, fz, reach, null);
      if (!hit || hit.kind !== 'piece' || !hit.collider) continue;
      const piece = hit.collider;
      if (piece._ramT && piece._ramT > this.time) return;
      piece._ramT = this.time + 0.3;
      const dmg = sp * CAR.pieceRamMul;
      this.structures.damage(piece, dmg, { x: hit.x, y: hit.y, z: hit.z });
      this.damage(car, dmg * CAR.pieceRamSelf, { source: null });
      if (this.sfx) this.sfx.play('car_crash', { x: hit.x, y: hit.y, z: hit.z, volume: 0.7 });
      if (piece.alive !== false && piece.hp > 0) {
        car.vx *= 0.3;
        car.vz *= 0.3;
      }
      return;
    }
  }

  _wreck(car, dt) {
    if (car.gone) return;
    car.wreckT -= dt;
    if (this.fx && this.fx.carSmoke && car.wreckT > 0) {
      car._fireT = (car._fireT || 0) - dt;
      if (car._fireT <= 0 && this._near(car, 160)) {
        car._fireT = 0.25;
        this.fx.carSmoke({ x: car.x + (Math.random() - 0.5), y: car.y + 1.4, z: car.z + (Math.random() - 0.5) }, car.wreckT > CAR.wreckTime - 8);
      }
    }
    if (car.wreckT <= 0) {
      car.gone = true;
      this._liftBoxes(car);
      if (car.mesh) car.mesh.visible = false;
    }
  }

  _near(car, d) {
    const v = this.viewer;
    return !v || Math.abs(v.x - car.x) + Math.abs(v.z - car.z) < d * 1.4;
  }

  /** Meshes: pose, distance culling, engine smoke / fire. */
  _present(dt) {
    this._presentStations();
    this._smokeT -= dt;
    const puff = this._smokeT <= 0;
    if (puff) this._smokeT = 0.2;
    for (const car of this.cars) {
      const m = car.mesh;
      if (!m || car.gone) continue;
      const v = this.viewer;
      const d2 = v ? (v.x - car.x) ** 2 + (v.z - car.z) ** 2 : 0;
      const vis = d2 < DRAW_DIST * DRAW_DIST;
      m.visible = vis;
      if (!vis) continue;
      m.userData.pose(car, dt, d2);
      if (!car.alive || !puff || !this.fx || !this.fx.carSmoke) continue;
      const f = car.hp / car.maxHp;
      if (f > CAR.smokeAt) continue;
      const g = carGeom(car.spec);
      const fx = Math.sin(car.heading);
      const fz = -Math.cos(car.heading);
      const p = { x: car.x + fx * (g.hl - 0.6), y: car.y + g.body.y1 + 0.2, z: car.z + fz * (g.hl - 0.6) };
      this.fx.carSmoke(p, f <= CAR.fireAt);
    }
  }

  /** Gas station meshes: hidden beyond STATION.drawDist from the camera. */
  _presentStations() {
    const v = this.viewer;
    if (!this.stations) return;
    const lim = STATION.drawDist * STATION.drawDist;
    for (const st of this.stations) if (st.mesh) st.mesh.visible = !v || (v.x - st.x) ** 2 + (v.z - st.z) ** 2 < lim;
  }

  // ---------------------------------------------------------------- network

  /** Host: poses of cars that are moving or occupied ([id, x, y, z, h, p, r, speed, steer]). */
  poses() {
    const rows = [];
    for (const car of this.cars) {
      if (!car.alive) continue;
      const moving = Math.abs(car.vx) + Math.abs(car.vz) > 0.05 || car.vy !== 0;
      if (!moving && !car.seats[0] && !car._sendRest) continue;
      car._sendRest = moving || !!car.seats[0]; // one more row once it stops (the resting pose)
      rows.push([car.id, r2(car.x), r2(car.y), r2(car.z), r3(car.heading), r3(car.pitch), r3(car.roll), r2(car.speed), r2(car.steer)]);
    }
    return rows;
  }

  /** Client: poses from the host (skipping the car we drive ourselves). */
  applyPoses(rows) {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      const car = this.byId.get(r[0]);
      if (!car || !car.alive) continue;
      if (car.seats[0] && car.seats[0] === this.local) continue;
      this.setNetPose(car, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]);
    }
  }

  setNetPose(car, x, y, z, h, p = 0, r = 0, sp = 0, st = 0) {
    if (![x, y, z, h].every(Number.isFinite)) return;
    car.net = { x, y, z, h, p: +p || 0, r: +r || 0, sp: +sp || 0, st: +st || 0 };
  }

  /** Host: a remote driver's own car pose ('drv'). Returns false when it moved impossibly far. */
  acceptDriverPose(actor, m, dtSince) {
    const car = actor && actor.vehicle;
    if (!car || car.seats[0] !== actor || car.id !== m.c || !car.alive) return false;
    const x = +m.x;
    const y = +m.y;
    const z = +m.z;
    const h = +m.h;
    if (![x, y, z, h].every(Number.isFinite)) return false;
    const ref = car.net || car;
    const cap = car.spec.top * CAR.boostMul * 1.3 * Math.max(0.05, dtSince) + 4;
    if (Math.hypot(x - ref.x, z - ref.z) > cap) return false;
    const b = this.world && this.world.bounds;
    if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return false;
    this.setNetPose(car, x, y, z, h, m.p, m.r, Math.max(-car.spec.reverse, Math.min(car.spec.top * CAR.boostMul, +m.sp || 0)), m.st);
    // fuel only goes down from the driver's side (not while / just after a pump filled it here:
    // until the driver hears our 'vf' its report is the old, lower level)
    if (Number.isFinite(+m.f) && !(this.time - (car._pumpT ?? -Infinity) < PUMP_GRACE)) car.fuel = Math.max(0, Math.min(car.fuel, +m.f));
    return true;
  }

  /** Client: the host's events. actorById(id) -> actor (or a Map). */
  applyEvent(e, actorById) {
    const car = this.byId.get(e.c);
    if (!car) return;
    const find = (id) => (typeof actorById === 'function' ? actorById(id) : actorById && actorById.get ? actorById.get(id) : null);
    switch (e.e) {
      case 've': {
        const a = find(e.a);
        if (!a) return;
        if (e.s < 0) {
          if (a.vehicle) this._unseat(a, a.vehicle, Number.isFinite(e.x) ? e.x : car.x, Number.isFinite(e.z) ? e.z : car.z);
          else if (Number.isFinite(e.x) && a === this.local) a.pos.set(e.x, a.pos.y, e.z);
          for (let i = 0; i < car.seats.length; i++) if (car.seats[i] === a) car.seats[i] = null;
          return;
        }
        if (a.vehicle && a.vehicle !== car) this._unseat(a, a.vehicle, a.pos.x, a.pos.z);
        for (let i = 0; i < car.seats.length; i++) if (car.seats[i] === a) car.seats[i] = null;
        const prev = car.seats[e.s];
        if (prev && prev !== a) this._clearActor(prev);
        car.seats[e.s] = a;
        a.vehicle = car;
        a.seat = e.s;
        a.leaning = false;
        if (a.character && a.character.setSeated) a.character.setSeated(true);
        if (a === this.local && e.s === 0) car.net = null; // we drive it now
        this._pin(car, e.s, a);
        if (this.sfx) this.sfx.play('car_door', { x: car.x, y: car.y + 1, z: car.z });
        return;
      }
      case 'vw':
        this.breakWindow(car, e.i);
        return;
      case 'vd':
        car.hp = Math.max(1, +e.hp || 1);
        return;
      case 'vx':
        if (car.alive) {
          for (const a of car.seats) if (a && a.vehicle === car) this._unseat(a, car, a.pos.x, a.pos.z);
          car.seats.fill(null);
          car.alive = false;
          car.hp = 0;
          car.wreckT = CAR.wreckTime;
          car.vx = car.vz = car.speed = 0;
          car.net = null;
          this._blowFx(car);
        }
        return;
      case 'vh':
        if (this.sfx) this.sfx.play('horn', { x: car.x, y: car.y + 1, z: car.z });
        return;
      case 'vf':
        car.fuel = Math.max(0, Math.min(CAR.fuelMax, +e.f || 0));
        return;
    }
  }

  /** Host: everything a client that joins mid-match would need (not used yet: matches start together). */
  dispose() {
    for (const car of this.cars) {
      this._liftBoxes(car);
      if (car.mesh && car.mesh.parent) car.mesh.parent.remove(car.mesh);
    }
    this.cars.length = 0;
    this.byId.clear();
  }
}
