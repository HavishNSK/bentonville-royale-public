import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR, CAR_TYPES, makeCar, carGeom, ramDamage, WINDOW, nextSeat } from '../src/game/vehicles/cars.js';
import { rayCar, seatWorldPos, exitSpot } from '../src/game/vehicles/carHit.js';
import { stepCar } from '../src/game/vehicles/carPhysics.js';
import { Vehicles } from '../src/game/Vehicles.js';

// flat world with optional wall polygons (axis-aligned rectangles) for the car to hit
function fakeWorld(walls = []) {
  return {
    bounds: { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 },
    data: { areas: [], roads: [] },
    inBounds: () => true,
    blockedAt: (x, z, r = 0) => walls.some((w) => x + r > w.x0 && x - r < w.x1 && z + r > w.z0 && z - r < w.z1),
    surfaceHeight: () => 0,
    groundHeight: () => 0,
    inWater: () => false,
    resolveCircle(p, r) {
      let hit = false;
      for (const w of walls) {
        const cx = Math.max(w.x0, Math.min(w.x1, p.x));
        const cz = Math.max(w.z0, Math.min(w.z1, p.z));
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-6) {
          p.x += (dx / d) * (r - d);
          p.z += (dz / d) * (r - d);
          hit = true;
        }
      }
      return hit;
    },
  };
}

function actor(id, team, x = 0, z = 0) {
  return { id, team, name: 'A' + id, alive: true, downed: false, health: 100, shield: 0, radius: 0.4, height: 1.8, pos: { x, y: 0, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } }, vel: { x: 0, y: 0, z: 0, set(a, b, c) { this.x = a; this.y = b; this.z = c; } } };
}

// minimal Combat stand-in: shield first, then health; credits the source
function fakeCombat(actors, teamMode = false) {
  const log = [];
  return {
    actors,
    teamMode,
    log,
    applyDamage(t, amount, info) {
      if (!t.alive) return 0;
      const s = Math.min(t.shield, amount);
      t.shield -= s;
      t.health -= amount - s;
      log.push({ t: t.id, amount, src: info.source ? info.source.id : null, weapon: info.weapon });
      if (t.health <= 0) t.alive = false;
      return amount;
    },
  };
}

const drive = (car, world, input, seconds, dt = 1 / 60) => {
  Object.assign(car.input, input);
  for (let t = 0; t < seconds; t += dt) stepCar(car, dt, world);
};

test('physics: accelerates to top speed and no higher; reverse is capped', () => {
  const w = fakeWorld();
  const car = makeCar(0, 'sedan', 0, 0, 0, 0);
  drive(car, w, { throttle: 1 }, 12);
  assert.ok(Math.abs(car.speed - CAR_TYPES.sedan.top) < 0.05, 'top speed ' + car.speed);
  assert.ok(car.z < -150, 'moved forward (heading 0 faces -z)');
  const r = makeCar(1, 'sedan', 0, 0, 0, 0);
  drive(r, w, { throttle: -1 }, 6);
  assert.ok(Math.abs(r.speed + CAR_TYPES.sedan.reverse) < 0.05, 'reverse ' + r.speed);
});

test('physics: steering turns less at speed', () => {
  const w = fakeWorld();
  const slow = makeCar(0, 'sedan', 0, 0, 0, 0);
  slow.vx = 0;
  slow.vz = -5;
  const fast = makeCar(1, 'sedan', 0, 0, 0, 0);
  fast.vx = 0;
  fast.vz = -25;
  for (const c of [slow, fast]) {
    c.steer = 1;
    c.input.steer = 1;
    c.input.throttle = 0.01;
  }
  // turning radius: heading change per metre travelled
  const h0s = slow.heading;
  const h0f = fast.heading;
  stepCar(slow, 0.1, w);
  stepCar(fast, 0.1, w);
  const perMetreSlow = Math.abs(slow.heading - h0s) / 0.5;
  const perMetreFast = Math.abs(fast.heading - h0f) / 2.5;
  assert.ok(perMetreFast < perMetreSlow * 0.6, `${perMetreFast} vs ${perMetreSlow}`);
});

test('physics: a wall stops the car and records the impact speed', () => {
  const w = fakeWorld([{ x0: -10, x1: 10, z0: -40, z1: -38 }]);
  const car = makeCar(0, 'sedan', 0, 0, 0, 0);
  car.vz = -20;
  car.input.throttle = 1;
  let impact = 0;
  for (let i = 0; i < 120; i++) {
    stepCar(car, 1 / 60, w);
    impact = Math.max(impact, car.impact);
  }
  assert.ok(car.z > -38 + 0.9, 'kept out of the wall: ' + car.z);
  assert.ok(impact > 15, 'impact ' + impact);
});

test('physics: an empty tank crawls; boost raises top speed and burns fuel', () => {
  const w = fakeWorld();
  const empty = makeCar(0, 'pickup', 0, 0, 0, 0, { fuel: 0 });
  drive(empty, w, { throttle: 1 }, 5);
  assert.ok(Math.abs(empty.speed - CAR.emptySpeed) < 0.05, 'empty ' + empty.speed);
  const b = makeCar(1, 'pickup', 0, 0, 0, 0, { fuel: 100 });
  drive(b, w, { throttle: 1 }, 10);
  b.input.boost = true;
  stepCar(b, 1 / 60, w);
  b.input.boost = false;
  for (let t = 0; t < 2.5; t += 1 / 60) stepCar(b, 1 / 60, w);
  assert.ok(b.speed > CAR_TYPES.pickup.top + 1, 'boosted ' + b.speed);
  assert.ok(b.fuel < 100 - 10 - 2, 'fuel ' + b.fuel);
  assert.ok(b.boostCd > 0, 'boost cooling down');
});

test('hits: glass stops a shot until it breaks, then the occupant can be hit', () => {
  const car = makeCar(0, 'sedan', 0, 0, 0, 0);
  const g = carGeom(car.spec);
  // from the left, level with the front-left window
  const y = (g.windows[WINDOW.fl].y0 + g.windows[WINDOW.fl].y1) / 2;
  const z = (g.windows[WINDOW.fl].u0 + g.windows[WINDOW.fl].u1) / 2;
  let h = rayCar(car, -20, y, z, 1, 0, 0, 100);
  assert.equal(h.part, 'window');
  assert.equal(h.idx, WINDOW.fl);
  assert.ok(Math.abs(h.t - (20 - g.cw)) < 1e-6);
  car.windows[WINDOW.fl] = 0;
  h = rayCar(car, -20, y, z, 1, 0, 0, 100);
  // the ray now passes the opening; it may only stop at the car's far side (the opposite
  // pane is intact) — never at the near window
  assert.ok(!h || h.t > 20, 'passes the broken pane, got ' + (h && h.t));
  // the body below the glass always stops a shot
  h = rayCar(car, -20, 0.6, 0, 1, 0, 0, 100);
  assert.equal(h.part, 'body');
});

test('hits: a car parked at an angle still lines up its windows', () => {
  const car = makeCar(0, 'suv', 50, 0, 30, Math.PI / 2); // facing +x
  const g = carGeom(car.spec);
  const y = (g.windows[WINDOW.front].y0 + g.windows[WINDOW.front].y1) / 2;
  // straight at the windshield from in front (front is +x now)
  const h = rayCar(car, 80, y, 30, -1, 0, 0, 100);
  assert.equal(h.part, 'window');
  assert.equal(h.idx, WINDOW.front);
  assert.ok(h.nx > 0.99, 'normal faces the shooter');
});

test('seats and exits', () => {
  const car = makeCar(0, 'sedan', 0, 0, 0, 0);
  const p = seatWorldPos(car, 0);
  assert.ok(p.x < 0, 'driver sits on the left');
  const lean = seatWorldPos(car, 1, true);
  assert.ok(lean.x > carGeom(car.spec).cw, 'a leaning passenger sits out of the window');
  car.seats = ['a', null, 'c', null];
  assert.equal(nextSeat(car, 0), 1);
  assert.equal(nextSeat(car, 1), 3);
  const blocked = (x) => x < 0; // everything left of the car is a wall
  const out = exitSpot(car, 0, (x, z, r) => blocked(x - r));
  assert.ok(out && out.x > 0, 'gets out on the free side');
});

test('run-over damage', () => {
  assert.equal(ramDamage(20), 72);
  assert.equal(ramDamage(5), 0);
  assert.equal(ramDamage(60), CAR.ramMax);
});

function setupVehicles(actors, opts = {}) {
  const v = new Vehicles({ world: fakeWorld(), combat: fakeCombat(actors, opts.teamMode) });
  v.authoritative = true;
  const car = v._add(makeCar(0, 'sedan', 0, 0, 0, 0));
  return { v, car };
}

test('enter: driver seat first, then the nearest free seat; a full car refuses', () => {
  const a = [1, 2, 3, 4, 5].map((i) => actor(i, i, -2, 0));
  const { v, car } = setupVehicles(a);
  assert.equal(v.enter(a[0], car), 0);
  assert.equal(a[0].vehicle, car);
  assert.ok(a[0].pos.x < 0);
  for (const x of a.slice(1, 4)) assert.ok(v.enter(x, car) > 0);
  assert.equal(v.enter(a[4], car), -1);
  assert.equal(v.nearest(a[4]), null, 'no free seat: not offered');
  assert.ok(v.exit(a[1]));
  assert.equal(a[1].vehicle, null);
  assert.ok(Math.abs(a[1].pos.x) > carGeom(car.spec).hw, 'stood beside the car');
});

test('the explosion: 500 damage blows the car; each of 4 occupants takes exactly 75, credited to the shooter', () => {
  const riders = [1, 2, 3, 4].map((i) => actor(i, 7, 0, 0));
  const shooter = actor(9, 9, 30, 0);
  const all = [...riders, shooter];
  const { v, car } = setupVehicles(all);
  for (const r of riders) v.enter(r, car);
  const events = [];
  v.onEvent = (e) => events.push(e);
  // glass soaks a hit, the body takes the rest
  v.damage(car, 40, { source: shooter }, 'window', WINDOW.fl);
  assert.equal(car.hp, car.maxHp);
  v.damage(car, 499, { source: shooter });
  assert.ok(car.alive);
  v.damage(car, 1, { source: shooter });
  assert.equal(car.alive, false);
  const log = v.combat.log.filter((l) => l.weapon === 'car_explosion');
  assert.deepEqual(log.map((l) => [l.t, l.amount, l.src]), riders.map((r) => [r.id, CAR.explodeDamage, 9]));
  for (const r of riders) {
    assert.equal(r.health, 100 - CAR.explodeDamage);
    assert.equal(r.vehicle, null, 'ejected');
  }
  assert.equal(shooter.health, 100, 'far away: no splash');
  assert.ok(events.some((e) => e.e === 'vx'));
});

test('shield soaks the explosion first', () => {
  const r = actor(1, 1);
  r.shield = 50;
  const { v, car } = setupVehicles([r]);
  v.enter(r, car);
  v.damage(car, 1000, {});
  assert.equal(r.shield, 0);
  assert.equal(r.health, 75);
});

test('running people over: enemies get hit, teammates do not, slow taps do nothing', () => {
  const driver = actor(1, 5);
  const enemy = actor(2, 6, 0, -3.1);
  const mate = actor(3, 5, 0.6, -3.1);
  const { v, car } = setupVehicles([driver, enemy, mate], { teamMode: true });
  v.enter(driver, car);
  car.vz = -20;
  car.vx = 0;
  v._runOver(car, [enemy, mate]);
  assert.ok(enemy.health < 100, 'enemy hit');
  assert.equal(mate.health, 100, 'teammate spared');
  const slow = actor(4, 6, 0, -3.1);
  car.vz = -5;
  v._runOver(car, [slow]);
  assert.equal(slow.health, 100);
});

test('client mirror follows host events', () => {
  const hostActors = [actor(1, 1), actor(2, 2)];
  const clientActors = [actor(1, 1), actor(2, 2)];
  const host = setupVehicles(hostActors);
  const client = new Vehicles({ world: fakeWorld() });
  client._add(makeCar(0, 'sedan', 0, 0, 0, 0));
  client.authoritative = false;
  const byId = new Map(clientActors.map((a) => [a.id, a]));
  host.v.onEvent = (e) => client.applyEvent(e, byId);
  host.v.enter(hostActors[0], host.car);
  host.v.enter(hostActors[1], host.car);
  host.v.damage(host.car, 60, {}, 'window', WINDOW.rl);
  host.v.damage(host.car, 120, {});
  host.v.horn(host.car);
  host.v.switchSeat(hostActors[1]);
  const cc = client.cars[0];
  assert.deepEqual(cc.seats.map((a) => (a ? a.id : null)), host.car.seats.map((a) => (a ? a.id : null)));
  assert.equal(cc.windows[WINDOW.rl], 0);
  assert.equal(cc.hp, host.car.hp);
  host.v.exit(hostActors[0]);
  assert.equal(clientActors[0].vehicle, null);
  host.v.damage(host.car, 1000, {});
  assert.equal(cc.alive, false);
  assert.equal(clientActors[1].vehicle, null);
});

test('poses: only moving / driven cars are sent, and one resting row after they stop', () => {
  const { v, car } = setupVehicles([]);
  assert.equal(v.poses().length, 0);
  car.vx = 3;
  assert.equal(v.poses().length, 1);
  car.vx = 0;
  assert.equal(v.poses().length, 1, 'the resting pose');
  assert.equal(v.poses().length, 0);
});

test('refuel caps at a full tank', () => {
  const { v, car } = setupVehicles([]);
  car.fuel = 70;
  v.refuel(car);
  assert.equal(car.fuel, CAR.fuelMax);
});
