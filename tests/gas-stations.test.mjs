// Gas stations: branded lots beside the streets (same spots on every machine, on open ground, spread
// over every quadrant), solid canopy posts / pumps / kiosk with open lanes between them, a gas can on
// each forecourt, the invented brands (gasBrands.js) and the cars' pump-fuel path ('vf' events).
// The nozzle and pump damage are in gas-pumps.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { Vehicles } from '../src/game/Vehicles.js';
import { Reboot } from '../src/game/Reboot.js';
import { CAR, makeCar } from '../src/game/vehicles/cars.js';
import { STATION, planGasStations, buildGasStations, stationToWorld, stationPumps, stationAt, pumpSpots } from '../src/game/vehicles/gasStations.js';
import { GAS_BRANDS, brandFor, brandById } from '../src/game/vehicles/gasBrands.js';

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
    assert.equal(s.label, brandFor(s.i).name, 'labelled with its brand');
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
    for (const c of st.colliders) assert.equal(c.hp, Infinity, 'no Combat hp (pump hp lives in GasPumps)');
    assert.deepEqual(st.colliders.filter((c) => c.pumpIdx != null).map((c) => c.pumpIdx), [0, 1, 2, 3], 'pump boxes are numbered');
    stationPumps(st).forEach((pm, k) => {
      const c = st.colliders.find((cc) => cc.pumpIdx === k);
      assert.ok(Math.hypot(c.cx - pm.x, c.cz - pm.z) < 1e-6, 'pump box k sits on stationPumps()[k]');
      const sp = pumpSpots()[k];
      const w = stationToWorld(st, sp.u, sp.v);
      assert.ok(Math.hypot(w.x - pm.x, w.z - pm.z) < 1e-6, 'pumpSpots in the same order');
    });
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
  return { i: 0, key: 'gas0', label: 'Clam Oil', ox: 0, oz: 0, yaw: 0, cos: 1, sin: 0, x: 0, z: 7, y: 0 };
}

function seatedDriver(car) {
  const pos = { x: car.x, y: 0, z: car.z, set(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  const a = { id: 9, team: 0, alive: true, downed: false, isRemote: true, pos, vel: null, vehicle: car, seat: 0 };
  car.seats[0] = a;
  return a;
}

test('vehicles: pump fuel fills to a full tank, replicates every few units, and a remote driver cannot undo it', () => {
  const v = new Vehicles({});
  v.stations = [testStation()];
  const car = v._add(makeCar(0, 'sedan', 0, 0, 7, Math.PI / 2, { fuel: 10 }));
  const driver = seatedDriver(car);
  const events = [];
  v.onEvent = (e) => events.push(e);
  // a stopped car next to a pump no longer fills by itself: the nozzle does it (GasPumps.js)
  for (let i = 0; i < 60; i++) v.update(1 / 60, []);
  assert.equal(car.fuel, 10, 'no auto refuel');
  for (let i = 0; i < 60; i++) {
    v.update(1 / 60, []);
    v.pumpFuel(car, STATION.refuelRate / 60);
  }
  assert.ok(Math.abs(car.fuel - 20) < 1e-6, `fuel ${car.fuel}`);
  const vf = events.filter((e) => e.e === 'vf');
  assert.ok(vf.length >= 4 && vf.length <= 6, `${vf.length} fuel events in 1 s (every 2 units)`);
  assert.ok(vf.every((e, i) => i === 0 || e.f >= vf[i - 1].f), 'rising');
  // the driver's client still reports the old level until it hears the event: ignored for now
  assert.equal(v.acceptDriverPose(driver, { c: car.id, x: car.x, y: car.y, z: car.z, h: car.heading, f: 10 }, 1 / 30), true);
  assert.ok(car.fuel >= 20, 'a stale report does not drain the pump fuel');
  const room = CAR.fuelMax - car.fuel;
  assert.ok(Math.abs(v.pumpFuel(car, 500) - room) < 1e-9, 'capped at a full tank');
  assert.equal(car.fuel, CAR.fuelMax);
  assert.equal(events.filter((e) => e.e === 'vf').at(-1).f, CAR.fuelMax, 'the last event says full');
  v.pumpFuelDone(car);
  // long after the pump, the driver's (lower) reports count again (fuel burnt driving away)
  for (let i = 0; i < 90; i++) v.update(1 / 60, []);
  v.acceptDriverPose(driver, { c: car.id, x: car.x, y: car.y, z: car.z, h: car.heading, f: 95 }, 1 / 30);
  assert.equal(car.fuel, 95);
  // a client never adds pump fuel itself; it mirrors the host's events
  const c = new Vehicles({});
  c.reset({ authoritative: false });
  const cc = c._add(makeCar(0, 'sedan', 0, 0, 7, 0, { fuel: 10 }));
  c.applyEvent({ e: 'vf', c: cc.id, f: 30 }, () => null);
  assert.equal(cc.fuel, 30);
});

test('brands: one table, two stations of each, same on every machine, labels and sign colours', () => {
  assert.deepEqual(GAS_BRANDS.map((b) => b.name), ['Clam Oil', 'Floor Mart', 'Circle O']);
  const ids = [0, 1, 2, 3, 4, 5].map((i) => brandFor(i).id);
  assert.deepEqual(ids, ['clam', 'floormart', 'circleo', 'clam', 'floormart', 'circleo']);
  for (const b of GAS_BRANDS) assert.equal(ids.filter((x) => x === b.id).length, 2, `two ${b.name} stations`);
  assert.equal(brandById('circleo').name, 'Circle O');
  assert.equal(brandFor(-1).id, 'circleo');
  assert.equal(brandFor(NaN).id, 'clam');
  // colour schemes (owner-approved): clam red + yellow, floor mart blue + yellow, circle o red + orange
  const rgb = (h) => [h >> 16, (h >> 8) & 255, h & 255];
  const [cr, cg, cb] = rgb(brandById('clam').colors.fascia);
  assert.ok(cr > 200 && cg > 180 && cb < 80, 'clam fascia is yellow');
  assert.ok(rgb(brandById('clam').colors.text)[0] > 180 && rgb(brandById('clam').colors.text)[1] < 80, 'clam lettering is red');
  assert.ok(rgb(brandById('floormart').colors.fascia)[2] > 150 && rgb(brandById('floormart').colors.fascia)[0] < 60, 'floor mart is blue');
  assert.ok(rgb(brandById('circleo').colors.stripe)[0] > 200 && rgb(brandById('circleo').colors.stripe)[1] > 100, 'circle o has an orange stripe');
  // planned stations carry their brand and its name
  const stations = planGasStations(new World(mapData));
  for (const st of stations) {
    assert.equal(st.brand, brandFor(st.i).id);
    assert.equal(st.label, brandFor(st.i).name);
  }
});

test('brands: no real fuel-chain names in the station / brand code, art or copy', () => {
  // built from fragments so this file never spells them out
  const j = (...p) => p.join('');
  const real = [j('sh', 'ell'), j('wal', 'mart'), j('wal', '-', 'mart'), j('circle', ' ', 'k'), j('circle', 'k'), j('circle', '-', 'k'), j('kum', ' & ', 'go'), j('exx', 'on'), j('mob', 'il'), j('chev', 'ron'), j('tex', 'aco'), j('mur', 'phy', ' usa'), j('quik', 'trip'), j('7', '-', 'eleven')];
  const squash = (t) => t.toLowerCase().replace(/[\s_-]+/g, '');
  const files = [
    '../src/render/GasStationMesh.js',
    '../src/render/NozzleHose.js',
    '../src/ui/fuelIcon.js',
    '../src/game/vehicles/gasStations.js',
    '../src/game/vehicles/gasBrands.js',
    '../src/game/GasPumps.js',
    '../src/game/fastTravel.js',
    './gas-stations.test.mjs',
    './gas-pumps.test.mjs',
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8').toLowerCase();
    const flat = squash(src);
    for (const n of real) {
      assert.equal(src.includes(n), false, `${f} mentions a real brand (${n.length} letters)`);
      // "circle o" squashed is "circleo": only the real one (circle + k) is checked squashed
      if (n.replace(/[\s&-]/g, '').length > 6) assert.equal(flat.includes(squash(n)), false, `${f} spells a real brand without spaces`);
    }
  }
  for (const b of GAS_BRANDS) for (const n of real) assert.equal(squash(b.name).includes(squash(n)), false, `${b.name}`);
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
