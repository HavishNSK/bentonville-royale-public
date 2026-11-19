// Gas stations: generic "Gas Station" lots beside the streets (same spots on every machine, on open
// ground, spread over every quadrant), solid canopy posts / pumps / kiosk with open lanes between
// them, a gas can on each forecourt, and pump refuelling (a car stopped at a pump fills up at
// STATION.refuelRate; host-authoritative, replicated with 'vf' events).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { Vehicles } from '../src/game/Vehicles.js';
import { Reboot } from '../src/game/Reboot.js';
import { CAR, makeCar } from '../src/game/vehicles/cars.js';
import {
  STATION,
  planGasStations,
  buildGasStations,
  stationToWorld,
  stationPumps,
  stationAt,
  pumpNear,
  refuelAtPump,
  pumpStatus,
} from '../src/game/vehicles/gasStations.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const MIN_STATIONS = 4;

/** A World with the map's land cover, roads and buildings registered (as WorldMeshes does). */
function mapWorld() {
  const w = new World(mapData);
  const stations = planGasStations(w);
  for (const a of mapData.areas) w.addArea(a.p, a.k);
  for (const r of mapData.roads) for (let i = 0; i + 1 < r.p.length; i++) w.addRoadSegment(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w, r.k);
  for (const bd of mapData.buildings) if (bd.p && bd.p.length >= 3) w.addBuilding(bd);
  return { w, stations };
}

/** Every SAMPLE-spaced point of a station's lot. */
function lotPoints(st, step = 1) {
  const L = STATION.lot;
  const out = [];
  for (let u = L.u0; u <= L.u1 + 1e-6; u += step) for (let v = L.v0; v <= L.v1 + 1e-6; v += step) out.push(stationToWorld(st, u, v));
  return out;
}

test('stations: deterministic, inside the map, one per quadrant and spread apart', () => {
  const a = planGasStations(new World(mapData));
  const b = planGasStations(new World(mapData));
  assert.ok(a.length >= MIN_STATIONS, `${a.length} stations`);
  assert.ok(a.length <= STATION.count);
  assert.deepEqual(
    a.map((s) => [s.ox, s.oz, s.yaw]),
    b.map((s) => [s.ox, s.oz, s.yaw]),
    'same spots on every machine',
  );
  const B = mapData.meta.bounds;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;
  const quads = new Set(a.map((s) => (s.x < cx ? 'W' : 'E') + (s.z < cz ? 'N' : 'S')));
  assert.deepEqual([...quads].sort(), ['EN', 'ES', 'WN', 'WS'], 'every quadrant has a station');
  for (const s of a) {
    assert.equal(s.label, 'Gas Station');
    for (const p of lotPoints(s, 4)) assert.ok(p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ, 'lot inside the map');
  }
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= STATION.minGap, `stations ${i} and ${j} too close`);
});

test('stations: every lot is open ground (no building, road, path, water, parking, pitch), near a street', () => {
  const { w, stations } = mapWorld();
  for (const st of stations) {
    for (const p of lotPoints(st)) {
      assert.equal(w.roadAt(p.x, p.z, 1), null, `road through ${st.key} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      assert.equal(w.blockedAt(p.x, p.z, 0.5), false, `${st.key} blocked at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      assert.ok(!['water', 'parking', 'busloop', 'pitch'].includes(w.areaAt(p.x, p.z)), `${st.key} on ${w.areaAt(p.x, p.z)}`);
      assert.equal(w.reservedAt(p.x, p.z), true, 'the lot is reserved (scatter keeps out)');
    }
    // the street is right in front: a road within a few metres of the lot's street edge
    const front = stationToWorld(st, 0, -STATION.roadGap - 1);
    assert.ok(w.roadAt(front.x, front.z, 0.5), `${st.key} faces a street`);
  }
});

test('stations: posts, pumps and kiosk are solid, the lanes between the pumps are open; a gas can on each lot', () => {
  const { w, stations } = mapWorld();
  buildGasStations(w, stations);
  for (const st of stations) {
    assert.ok(st.colliders.length >= 10, 'canopy, posts, pumps, kiosk, sign');
    for (const c of st.colliders) assert.equal(c.hp, Infinity, 'indestructible');
    for (const pm of stationPumps(st)) assert.equal(w.blockedAt(pm.x, pm.z, 0.2), true, 'pump is solid');
    const k = STATION.kiosk;
    const kc = stationToWorld(st, (k.u0 + k.u1) / 2, (k.v0 + k.v1) / 2);
    assert.equal(w.blockedAt(kc.x, kc.z, 0.2), true, 'kiosk is solid');
    const [i0, i1] = STATION.islands;
    for (const v of [(STATION.canopy.v0 + i0 - STATION.island.hv) / 2, (i0 + i1) / 2, (i1 + STATION.island.hv + STATION.canopy.v1) / 2]) {
      for (const u of [-10, -4, 0, 4, 10]) {
        const p = stationToWorld(st, u, v);
        assert.equal(w.blockedAt(p.x, p.z, 0.9), false, `${st.key} lane blocked at u ${u} v ${v.toFixed(2)}`);
      }
    }
    // the canopy roof is overhead, not in the way of a car (car bodies are < 2 m tall)
    const mid = stationToWorld(st, 0, (i0 + i1) / 2);
    assert.ok(w.groundHeight(mid.x, mid.z, st.y + 0.2) < st.y + 0.5, 'ground under the canopy');
  }
  const cans = (w.fixedLoot || []).filter((f) => f.item && f.item.id === 'gascan');
  assert.equal(cans.length, stations.length);
  for (const c of cans) {
    assert.ok(stationAt(stations, c.x, c.z), 'on a forecourt');
    assert.equal(w.blockedAt(c.x, c.z, 0.3), false, 'reachable');
  }
});

test('stations: parked cars and reboot-van spots keep off the lots', () => {
  const { w, stations } = mapWorld();
  buildGasStations(w, stations);
  const v = new Vehicles({ world: w });
  v.setup();
  assert.ok(v.cars.length > 20);
  for (const car of v.cars) assert.equal(stationAt(stations, car.x, car.z), null, `car ${car.id} parked on a forecourt`);
  const rb = new Reboot({ world: w });
  rb.setup();
  assert.ok(rb.vans.length > 0);
  for (const van of rb.vans) assert.equal(stationAt(stations, van.x, van.z, 3), null, `reboot van ${van.key} on a forecourt`);
});

/** A station-shaped test record at the origin (u = x, v = z). */
function testStation() {
  return { i: 0, key: 'gas0', label: STATION.label, ox: 0, oz: 0, yaw: 0, cos: 1, sin: 0, x: 0, z: 7, y: 0 };
}

test('refuel: a stopped car at a pump fills at the pump rate up to a full tank', () => {
  const st = [testStation()];
  const lane = (STATION.islands[0] + STATION.islands[1]) / 2;
  const car = makeCar(0, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 20 });
  assert.ok(pumpNear(st, car.x, car.z), 'in reach of a pump');
  assert.equal(pumpStatus(car, st), 'fill');
  let added = 0;
  for (let i = 0; i < 60; i++) added += refuelAtPump(car, st, 1 / 60);
  assert.ok(Math.abs(added - STATION.refuelRate) < 1e-6, `1 s at the pump adds ${added}`);
  assert.ok(Math.abs(car.fuel - (20 + STATION.refuelRate)) < 1e-6);
  for (let i = 0; i < 60 * 20; i++) refuelAtPump(car, st, 1 / 60);
  assert.equal(car.fuel, CAR.fuelMax, 'capped at a full tank');
  assert.equal(refuelAtPump(car, st, 1), 0);
  assert.equal(pumpStatus(car, st), 'full');
});

test('refuel: only when stopped, near a pump, alive and on the forecourt level', () => {
  const st = [testStation()];
  const lane = (STATION.islands[0] + STATION.islands[1]) / 2;
  const moving = makeCar(0, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 20 });
  moving.speed = 8;
  assert.equal(refuelAtPump(moving, st, 1), 0, 'driving through');
  assert.equal(pumpStatus(moving, st), 'stop');
  const crawl = makeCar(1, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 20 });
  crawl.speed = STATION.stopSpeed * 0.5;
  assert.ok(refuelAtPump(crawl, st, 1) > 0, 'rolling to a stop counts');
  const far = makeCar(2, 'sedan', 0, 0, 40, 0, { fuel: 20 });
  assert.equal(refuelAtPump(far, st, 1), 0, 'away from the pumps');
  assert.equal(pumpStatus(far, st), null);
  const kiosk = makeCar(3, 'sedan', 0, 0, STATION.kiosk.v0 - 1, Math.PI / 2, { fuel: 20 });
  assert.equal(refuelAtPump(kiosk, st, 1), 0, 'parked by the kiosk, not at a pump');
  const dead = makeCar(4, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 20 });
  dead.alive = false;
  assert.equal(refuelAtPump(dead, st, 1), 0, 'wrecks do not refuel');
  const above = makeCar(5, 'sedan', 0, 6, lane, Math.PI / 2, { fuel: 20 });
  assert.equal(refuelAtPump(above, st, 1), 0, 'on the canopy roof, not at the pump');
});

function seatedDriver(car) {
  const pos = { x: car.x, y: 0, z: car.z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  const a = { id: 9, team: 0, alive: true, downed: false, isRemote: true, pos, vel: null, vehicle: car, seat: 0 };
  car.seats[0] = a;
  return a;
}

test('vehicles: the host fills a car at a pump and replicates it; a remote driver cannot undo it', () => {
  const st = [testStation()];
  const lane = (STATION.islands[0] + STATION.islands[1]) / 2;
  const v = new Vehicles({});
  v.stations = st;
  const car = v._add(makeCar(0, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 10 }));
  const driver = seatedDriver(car);
  const events = [];
  v.onEvent = (e) => events.push(e);
  for (let i = 0; i < 60; i++) v.update(1 / 60, []);
  assert.ok(Math.abs(car.fuel - 20) < 1e-6, `fuel ${car.fuel}`);
  const vf = events.filter((e) => e.e === 'vf');
  assert.ok(vf.length >= 4 && vf.length <= 6, `${vf.length} fuel events in 1 s (every ${2} units)`);
  assert.ok(vf.every((e, i) => i === 0 || e.f >= vf[i - 1].f), 'rising');
  // the driver's client still reports the old level until it hears the event: ignored for now
  assert.equal(v.acceptDriverPose(driver, { c: car.id, x: car.x, y: car.y, z: car.z, h: car.heading, f: 10 }, 1 / 30), true);
  assert.ok(car.fuel >= 20, 'a stale report does not drain the pump fuel');
  // fill up: the last event says full
  for (let i = 0; i < 60 * 10; i++) v.update(1 / 60, []);
  assert.equal(car.fuel, CAR.fuelMax);
  assert.equal(events.filter((e) => e.e === 'vf').at(-1).f, CAR.fuelMax);
  // long after the pump, the driver's (lower) reports count again (fuel burnt driving away)
  car.x = 60;
  for (let i = 0; i < 90; i++) v.update(1 / 60, []);
  v.acceptDriverPose(driver, { c: car.id, x: car.x, y: car.y, z: car.z, h: car.heading, f: 95 }, 1 / 30);
  assert.equal(car.fuel, 95);
});

test('vehicles: a client mirrors pump fuel from the host instead of adding its own', () => {
  const st = [testStation()];
  const lane = (STATION.islands[0] + STATION.islands[1]) / 2;
  const v = new Vehicles({});
  v.stations = st;
  v.reset({ authoritative: false });
  const car = v._add(makeCar(0, 'sedan', 0, 0, lane, Math.PI / 2, { fuel: 10 }));
  for (let i = 0; i < 60; i++) v.update(1 / 60, []);
  assert.equal(car.fuel, 10, 'no local refuel on a client');
  v.applyEvent({ e: 'vf', c: car.id, f: 30 }, () => null);
  assert.equal(car.fuel, 30);
  assert.equal(v.pumpStatus(car), 'fill', 'the HUD still knows it is at a pump');
});

test('art: no brand names, logos or brand colour schemes in the station code', () => {
  const files = ['../src/render/GasStationMesh.js', '../src/ui/fuelIcon.js', '../src/game/vehicles/gasStations.js'];
  const brands = /\b(shell|circle\s*k|walmart|murphy|casey'?s?|maverik|kum\s*&\s*go|exxon|mobil|chevron|texaco|sinclair|phillips\s*66|valero|citgo|marathon|sunoco|speedway|7-eleven|quiktrip|qt|bp|76|arco|gulf|conoco)\b/i;
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const m = src.match(brands);
    assert.equal(m, null, `${f} mentions "${m && m[0]}"`);
    // no saturated reds / oranges (the usual fuel-brand trade dress); the palette is violet, gold, cream
    for (const hex of src.match(/(?:0x|#)[0-9a-f]{6}\b/gi) || []) {
      const n = parseInt(hex.replace('#', '').replace(/^0x/i, ''), 16);
      const r = n >> 16;
      const g = (n >> 8) & 255;
      const b = n & 255;
      assert.ok(!(r > 180 && g < 150 && b < 110), `${f}: red / orange colour ${hex}`);
    }
  }
  assert.equal(STATION.label, 'Gas Station');
});

test('chests never give gas cans; floor loot still can', async () => {
  const { rollConsumable } = await import('../src/game/Loot.js');
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let chestGas = 0;
  let floorGas = 0;
  for (let i = 0; i < 4000; i++) {
    if (rollConsumable(rng, { noGas: true }).id === 'gascan') chestGas++;
    if (rollConsumable(rng).id === 'gascan') floorGas++;
  }
  assert.equal(chestGas, 0);
  assert.ok(floorGas > 0, 'gas cans still turn up as floor loot');
  const src = (await import('node:fs')).readFileSync(new URL('../src/game/Loot.js', import.meta.url), 'utf8');
  assert.match(src, /if \(rec\.kind === 'chest'\)[\s\S]{0,400}rollConsumable\(rng, \{ noGas: true \}\)/, 'the chest roll asks for no gas');
});
