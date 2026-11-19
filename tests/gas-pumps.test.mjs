// Gas pumps (src/game/GasPumps.js): the hand-held nozzle (grab range, hose snap, fuel only next to
// a car, the host checking a client's 'pmp' actions) and pump damage (fire, explosion, the chain
// through one station, match reset, client mirroring).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Vite imports CSS from JS modules; Node cannot, so stub .css imports as empty modules.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }; return next(url, ctx); }",
    ),
);

const { GasPumps, PUMP_NET_SLACK } = await import('../src/game/GasPumps.js');
const { Vehicles } = await import('../src/game/Vehicles.js');
const { CAR, makeCar } = await import('../src/game/vehicles/cars.js');
const { STATION, stationPumps } = await import('../src/game/vehicles/gasStations.js');
const { HostSession } = await import('../src/net/HostSession.js');

/** A station-shaped record (u = x, v = z) at (ox, 0). */
function station(i, ox = 0) {
  return { i, key: 'gas' + i, label: 'Test', ox, oz: 0, yaw: 0, cos: 1, sin: 0, x: ox, z: 7, y: 0, colliders: [] };
}

function actor(id, x, z, extra = {}) {
  return { id, alive: true, downed: false, vehicle: null, pos: { x, y: 0, z }, ...extra };
}

/** Pumps over one or two stations, with cars and a tiny combat stand-in. */
function rig({ stations = [station(0)], cars = [], actors = [] } = {}) {
  const vehicles = new Vehicles({});
  for (const c of cars) vehicles._add(c);
  const hurt = [];
  const combat = { actors, applyDamage: (a, dmg, info) => hurt.push({ a, dmg, info }) };
  let r = 0.5;
  const gp = new GasPumps({ vehicles, combat, rng: () => r });
  gp.setup(stations);
  const events = [];
  gp.onEvent = (e) => events.push(e);
  vehicles.onEvent = (e) => events.push(e);
  return { gp, vehicles, combat, hurt, events, setRng: (v) => (r = v) };
}

const run = (gp, secs, step = 1 / 60) => {
  for (let t = 0; t < secs - 1e-9; t += step) gp.update(step);
};

test('nozzle: grabbed on foot within the grab range of a live, free pump only', () => {
  const { gp, events } = rig();
  const p = gp.pumps[0];
  assert.equal(gp.pumps.length, 4);
  assert.deepEqual(gp.pumps.map((q) => [q.x, q.z]), stationPumps(station(0)).map((q) => [q.x, q.z]));
  const near = actor(1, p.x - 1.5, p.z);
  const far = actor(2, p.x - (STATION.grabRange + 0.4), p.z);
  assert.equal(gp.pumpFor(near), p);
  assert.equal(gp.pumpFor(far), null, 'out of reach');
  assert.equal(gp.grab(far, p), false);
  assert.equal(gp.grab(actor(3, p.x - 1, p.z, { vehicle: {} }), p), false, 'not from a car seat');
  assert.equal(gp.grab(actor(4, p.x - 1, p.z, { downed: true }), p), false, 'not knocked');
  assert.equal(gp.grab(near, p), true);
  assert.equal(gp.heldPump(near), p);
  assert.deepEqual(events.at(-1), { e: 'pmn', a: 1, p: p.id });
  assert.equal(gp.grab(actor(5, p.x + 1, p.z), p), false, 'one nozzle per pump');
  assert.equal(gp.pumpFor(actor(6, p.x + 1, p.z)), null, 'a taken pump is not offered');
  // a dead pump has no nozzle
  const q = gp.pumps[1];
  q.dead = true;
  assert.equal(gp.grab(actor(7, q.x, q.z + 1), q), false);
  // hang up
  assert.equal(gp.hangUp(near), true);
  assert.equal(gp.heldPump(near), null);
  assert.deepEqual(events.at(-1), { e: 'pmn', a: 1, p: -1, r: 0 });
});

test('nozzle: walking past the hose length snaps it back; going down or into a car hangs it up', () => {
  const { gp, events } = rig();
  const p = gp.pumps[0];
  const a = actor(1, p.x, p.z - 1.5);
  gp.grab(a, p);
  a.pos.z = p.z - (STATION.hoseLen - 0.3);
  run(gp, 0.2);
  assert.equal(gp.heldPump(a), p, 'still on the hose');
  a.pos.z = p.z - (STATION.hoseLen + 0.3);
  run(gp, 0.1);
  assert.equal(gp.heldPump(a), null, 'snapped back');
  assert.deepEqual(events.at(-1), { e: 'pmn', a: 1, p: -1, r: 1 });
  // remote players get a little lag slack on the hose
  const b = actor(2, p.x, p.z - 1, { isRemote: true });
  gp.grab(b, p);
  b.pos.z = p.z - (STATION.hoseLen + PUMP_NET_SLACK * 0.5);
  run(gp, 0.1);
  assert.equal(gp.heldPump(b), p);
  b.downed = true;
  run(gp, 0.1);
  assert.equal(gp.heldPump(b), null, 'knocked: dropped');
  const c = actor(3, p.x, p.z - 1);
  gp.grab(c, p);
  c.vehicle = {};
  run(gp, 0.1);
  assert.equal(gp.heldPump(c), null, 'in a car: hung up');
});

test('nozzle: fuels a live car within the fuel range at the pump rate, up to a full tank, and only there', () => {
  // a sedan parked along the lane next to pump 0 (pumps at v = 4.7: the lane is at v ~ 7)
  const car = makeCar(0, 'sedan', 0, 0, 7.2, Math.PI / 2, { fuel: 20 });
  const { gp, vehicles, events } = rig({ cars: [car] });
  const p = gp.pumps[0];
  const a = actor(1, p.x, p.z + 1.2);
  gp.grab(a, p);
  assert.equal(gp.fuelTarget(a), car, 'the car is in reach of the nozzle');
  assert.equal(gp.setFueling(a, car), true);
  run(gp, 1);
  assert.ok(Math.abs(car.fuel - (20 + STATION.refuelRate)) < 0.2, `1 s adds ${car.fuel - 20}`);
  assert.ok(events.some((e) => e.e === 'vf' && e.c === car.id), "replicated with the car's 'vf' events");
  run(gp, 12);
  assert.equal(car.fuel, CAR.fuelMax, 'full tank');
  // too far from the car: no fuel (the request is dropped)
  car.fuel = 50;
  a.pos.z = p.z - 3; // the other side of the pump, 5+ m from the car
  assert.equal(gp.fuelTarget(a), null);
  gp.setFueling(a, car);
  run(gp, 1);
  assert.equal(car.fuel, 50, 'not near the car');
  assert.equal(gp.heldPump(a), p, 'still holding the nozzle');
  // not without the nozzle
  const b = actor(2, car.x, car.z - 1.5);
  assert.equal(gp.setFueling(b, car), false);
  // a wreck takes no fuel
  a.pos.z = p.z + 1.2;
  gp.setFueling(a, car);
  car.alive = false;
  run(gp, 1);
  assert.equal(car.fuel, 50);
  void vehicles;
});

test("host: a client's 'pmp' actions are checked (pump id, reach, hose, car) before they count", () => {
  const car = makeCar(4, 'sedan', 0, 0, 7.2, Math.PI / 2, { fuel: 10 });
  const { gp, vehicles } = rig({ cars: [car] });
  const host = { game: { pumps: gp, vehicles } };
  const act = (a, m) => HostSession.prototype._action.call(host, a, { k: 'pmp', ...m });
  const p = gp.pumps[0];
  const a = actor(7, p.x, p.z + STATION.grabRange + PUMP_NET_SLACK + 1, { isRemote: true });
  act(a, { op: 'grab', p: p.id });
  assert.equal(gp.heldPump(a), null, 'too far even with the lag slack');
  act(a, { op: 'grab', p: 999 });
  act(a, { op: 'grab', p: 'x' });
  assert.equal(gp.heldPump(a), null, 'unknown pump ids are ignored');
  a.pos.z = p.z + STATION.grabRange + PUMP_NET_SLACK * 0.5;
  act(a, { op: 'grab', p: p.id });
  assert.equal(gp.heldPump(a), p, 'within reach (with lag slack)');
  // fuel a car that is not there / does not exist: nothing
  act(a, { op: 'fuel', c: 12345 });
  run(gp, 0.5);
  assert.equal(car.fuel, 10);
  // claims to fuel the car from out of range: nothing
  a.pos.z = p.z - 4;
  act(a, { op: 'fuel', c: car.id });
  run(gp, 0.5);
  assert.equal(car.fuel, 10, 'the host measures the distance itself');
  a.pos.z = p.z + 1.2;
  act(a, { op: 'fuel', c: car.id });
  run(gp, 1);
  assert.ok(car.fuel > 19, `fuel ${car.fuel}`);
  act(a, { op: 'fuel', c: -1 });
  const f = car.fuel;
  run(gp, 0.5);
  assert.equal(car.fuel, f, 'stopped');
  act(a, { op: 'hang' });
  assert.equal(gp.heldPump(a), null);
  // from the bus / mid-drop: ignored
  act({ ...a, inBus: true }, { op: 'grab', p: p.id });
  assert.equal(gp.heldPump(a), null);
});

test('pumps: damage -> fire under 35% -> burns down -> explodes; the whole station chains, not the next one', () => {
  const stations = [station(0, 0), station(1, 300)];
  const victim = actor(1, 0, 2); // close to station 0's pumps
  const bystander = actor(2, 0, 40);
  const { gp, hurt, events } = rig({ stations, actors: [victim, bystander] });
  const [p0, p1, p2, p3] = gp.pumps;
  const holder = actor(3, p1.x + 1, p1.z);
  gp.grab(holder, p1);
  gp.damage(p0, 60, { source: 'shooter' });
  assert.equal(p0.hp, STATION.pumpHp - 60);
  assert.equal(p0.burning, false);
  assert.deepEqual(events.at(-1), { e: 'pmd', p: p0.id, hp: 90 });
  gp.damage(p0, 45, {});
  assert.equal(p0.burning, true, `caught fire at ${p0.hp} hp`);
  assert.ok(events.some((e) => e.e === 'pmf' && e.p === p0.id));
  // burns down by itself
  const burnFor = (STATION.pumpHp - 105) / STATION.burnRate;
  run(gp, burnFor + 0.1);
  assert.equal(p0.dead, true, 'exploded');
  assert.ok(events.some((e) => e.e === 'pmx' && e.p === p0.id));
  assert.equal(p0.col, null); // test stations have no colliders
  // the blast: the actor nearby takes falloff damage credited to whoever lit it, the far one none
  const h = hurt.filter((x) => x.a === victim);
  assert.equal(h.length, 1);
  assert.ok(h[0].dmg <= STATION.blastDamage && h[0].dmg >= STATION.blastMinDamage);
  assert.equal(h[0].info.weapon, 'pump_explosion');
  assert.equal(h[0].info.source, 'shooter');
  assert.equal(hurt.filter((x) => x.a === bystander).length, 0);
  // the other pumps of the station are on a short fuse, the other station's are not
  for (const q of [p1, p2, p3]) assert.ok(q.chainT >= STATION.chainDelay[0] && q.chainT <= STATION.chainDelay[1], `chain fuse ${q.chainT}`);
  for (const q of gp.pumps.slice(4)) assert.equal(q.chainT, -1);
  run(gp, STATION.chainDelay[1] + 0.05);
  for (const q of [p1, p2, p3]) assert.ok(q.burning || q.dead, 'caught fire from the chain');
  assert.equal(gp.heldPump(holder), p1, 'still holding a burning pump');
  run(gp, (STATION.pumpHp * STATION.fireAt) / STATION.burnRate + 0.2);
  for (const q of [p0, p1, p2, p3]) assert.equal(q.dead, true, 'the whole station went up');
  assert.equal(gp.heldPump(holder), null, 'its nozzle dropped when it blew');
  for (const q of gp.pumps.slice(4)) assert.equal(q.dead || q.burning || q.hp < q.maxHp, false, 'the other station is untouched');
  // nothing more to grab here
  assert.equal(gp.pumpFor(actor(9, p2.x + 1, p2.z)), null);
});

test('pumps: blasts hurt them with falloff; dead pumps shrink their box to a stump; reset restores everything', () => {
  const st = station(0);
  // a collider like buildGasStations makes
  const cols = [0, 1, 2, 3].map((k) => ({ pumpIdx: k, y0: 0, y1: 1.8, h: 1.8, hgt: 1.8 }));
  st.colliders = cols;
  const { gp } = rig({ stations: [st] });
  const p = gp.pumps[0];
  assert.equal(cols[0].pump, p, 'box -> pump link (Combat damages pumps through it)');
  gp.blast({ x: p.x, y: 1, z: p.z }, 4, 100, {});
  assert.ok(p.hp <= STATION.pumpHp - 99 && p.hp > 0, `hp ${p.hp}`);
  const far = gp.pumps[3];
  assert.ok(far.hp === far.maxHp || far.hp > p.hp, 'falloff');
  gp.damage(p, 500, {});
  assert.equal(p.dead, true);
  assert.ok(cols[0].y1 < 0.5, 'a stump');
  run(gp, 10);
  gp.reset({ authoritative: true });
  for (const q of gp.pumps) {
    assert.equal(q.dead, false);
    assert.equal(q.burning, false);
    assert.equal(q.hp, q.maxHp);
    assert.equal(q.chainT, -1);
  }
  assert.equal(cols[0].y1, 1.8, 'box restored');
});

test('pumps: cars driven into a pump dent it', () => {
  const car = makeCar(0, 'sedan', 0, 0, 7, Math.PI / 2, { fuel: 50 });
  const { gp } = rig({ cars: [car] });
  const p = gp.pumps[0];
  // the car's body over the pump's spot, at speed
  car.x = p.x + 1.5;
  car.z = p.z;
  car.speed = 8; // 66 damage: hurt, not on fire
  gp.update(1 / 60);
  assert.ok(p.hp < p.maxHp, `rammed: ${p.hp}`);
  const hp = p.hp;
  gp.update(1 / 60);
  assert.equal(p.hp, hp, 'one hit per bump, not one per frame');
  car.speed = 2;
  car._gpPrev = 0;
  run(gp, 1);
  assert.equal(p.hp, hp, 'a slow bump does nothing');
});

test('client: mirrors pump hp / fire / explosion and who holds which nozzle; snapshot round-trips', () => {
  const host = rig({ stations: [station(0)] });
  const client = rig({ stations: [station(0)] });
  client.gp.reset({ authoritative: false });
  const me = actor(5, 0, 0);
  const lookup = (id) => (id === 5 ? me : null);
  const p = host.gp.pumps[2];
  me.pos.x = p.x;
  me.pos.z = p.z + 1;
  host.gp.grab(me, p);
  host.gp.damage(host.gp.pumps[0], 120, {});
  for (const e of host.events) client.gp.applyEvent(e, lookup);
  assert.equal(client.gp.heldPump(me).id, p.id);
  assert.equal(client.gp.pumps[0].burning, true);
  assert.equal(client.gp.pumps[0].hp, 30);
  // a client never burns a pump down by itself
  run(client.gp, 10);
  assert.equal(client.gp.pumps[0].dead, false);
  client.gp.applyEvent({ e: 'pmx', p: 0 }, lookup);
  assert.equal(client.gp.pumps[0].dead, true);
  // late state for a joiner
  run(host.gp, 10);
  const snap = host.gp.snapshot();
  const fresh = rig({ stations: [station(0)] });
  fresh.gp.reset({ authoritative: false });
  fresh.gp.applySnapshot(snap);
  assert.deepEqual(fresh.gp.pumps.map((q) => q.dead), host.gp.pumps.map((q) => q.dead));
  fresh.gp.applySnapshot([['bad'], null, [99, 1, 1]]);
});
