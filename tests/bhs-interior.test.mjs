// Bentonville High School interiors (src/world/interiors/bhs.js): storey counts, key rooms,
// stairs to every level, double-height rooms, safe labels and determinism, on the real map data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { BHS_MAIN, BHS_NORTH, BHS_STYLE } from '../src/world/interiors/bhs.js';
import { LANDMARK_DRESSING } from '../src/world/interiors/landmarkDressing.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));

/** The World the way scripts/check-interiors.mjs builds it. */
function build() {
  const w = new World(data);
  for (const a of data.areas) w.addArea(a.p, a.k);
  for (const r of data.roads) for (let i = 0; i + 1 < r.p.length; i++) w.addRoadSegment(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w, r.k);
  for (const bd of data.buildings) if (bd.p && bd.p.length >= 3) w.addBuilding(bd);
  w.finishBuildings();
  return w;
}

const world = build();
const planOf = (w, id) => {
  const c = w.buildingById(id);
  assert.ok(c && c.shell && c.shell.plan, `building ${id} has an interior plan`);
  return c.shell.plan;
};
const main = planOf(world, BHS_MAIN);
const north = planOf(world, BHS_NORTH);
const labels = (plan, i) => plan.levels[i].rooms.map((r) => r.label);
const has = (plan, i, re) => plan.levels[i].rooms.some((r) => re.test(r.label || ''));

test('both buildings use the landmark recipe with the real storey counts', () => {
  assert.equal(main.recipe, 'landmark');
  assert.equal(north.recipe, 'landmark');
  assert.equal(main.levels.length, 2, 'main building: 2 storeys');
  assert.equal(north.levels.length, 3, 'North Building: 3 storeys');
  for (const plan of [main, north]) {
    for (let i = 1; i < plan.levels.length; i++) assert.ok(plan.levels[i].y > plan.levels[i - 1].y + 4, 'storeys stack ~4.4 m apart');
  }
});

test('main building has the key school rooms', () => {
  for (const name of ['Tiger Arena', 'Auxiliary Gym', 'Arend Arts Center', 'Stage', 'Arts Center Lobby', 'Cafeteria', 'Kitchen', 'Library', 'Main Office', 'Main Lobby', 'South Lobby', "Nurse's Office", 'Counseling Center', 'Band Room', 'Choir Room', 'Boys Locker Room', 'Girls Locker Room', 'Scene Shop', 'Equipment Room']) {
    assert.ok(labels(main, 0).includes(name), `ground floor: ${name}`);
  }
  const kinds = new Set(main.levels[0].rooms.map((r) => r.kind));
  for (const k of ['gym', 'auditorium', 'cafeteria', 'library', 'kitchen', 'office', 'storage', 'corridor', 'restroom', 'classroom']) assert.ok(kinds.has(k), `ground kind ${k}`);
});

test('North Building has its lecture hall, commons, media center and stair tower', () => {
  for (const name of ['Lecture Hall', 'Commons', 'Commons Dining', 'Media Center', 'Main Stair Tower', 'Chemistry Lab']) assert.ok(labels(north, 0).includes(name), name);
  assert.ok(labels(north, 1).includes('Media Center Mezzanine'), 'multi-storey media center');
});

test('main building rooms sit where the real school has them (world coordinates)', () => {
  const F = main.frame;
  const at = (label) => {
    const r = main.levels[0].rooms.find((x) => x.label === label);
    assert.ok(r, label);
    const a = (r.a0 + r.a1) / 2;
    const b = (r.b0 + r.b1) / 2;
    return [F.ox + F.ux * a + F.vx * b, F.oz + F.uz * a + F.vz * b];
  };
  // Arend Arts Center: north-east wing (buildingPart 1002835402, x ~18..108, z ~291..336)
  const [hx, hz] = at('Arend Arts Center');
  assert.ok(hx > 50 && hx < 90 && hz > 291 && hz < 336, `house at ${hx}, ${hz}`);
  const [sx, sz] = at('Stage');
  assert.ok(sx > hx && sx < 108 && sz > 291 && sz < 336, `stage east of the house at ${sx}, ${sz}`);
  const [lx, lz] = at('Arts Center Lobby');
  assert.ok(lx < hx && lz < 336, `arts lobby west of the house at ${lx}, ${lz}`);
  // main lobby behind the north entry court (x ~ -17..-4, z ~ 330..336)
  const [mx, mz] = at('Main Lobby');
  assert.ok(Math.abs(mx + 10) < 15 && mz > 330 && mz < 360, `main lobby at ${mx}, ${mz}`);
});

test('every storey of both buildings has classrooms and corridors', () => {
  for (const plan of [main, north]) {
    plan.levels.forEach((L, i) => {
      const n = L.rooms.filter((r) => r.kind === 'classroom').length;
      assert.ok(n >= 8, `${plan.id} level ${i}: ${n} classrooms`);
      assert.ok(L.rooms.some((r) => r.kind === 'corridor'), `${plan.id} level ${i}: corridor`);
    });
  }
});

test('double-height rooms have an overlook, not a floor of rooms, above them', () => {
  const above = (plan, label) => {
    const r = plan.levels[0].rooms.find((x) => x.label === label);
    assert.ok(r, label);
    const ca = (r.a0 + r.a1) / 2;
    const cb = (r.b0 + r.b1) / 2;
    return plan.levels[1].rooms.find((x) => ca >= x.a0 && ca <= x.a1 && cb >= x.b0 && cb <= x.b1);
  };
  for (const [plan, label] of [[main, 'Tiger Arena'], [main, 'Auxiliary Gym'], [main, 'Arend Arts Center'], [main, 'Main Lobby'], [north, 'Lecture Hall'], [north, 'Commons']]) {
    const up = above(plan, label);
    assert.ok(up && up.kind === 'open', `${label}: level 1 above is ${up && up.kind} "${up && up.label}"`);
  }
});

test('stairs reach every level and land in circulation rooms', () => {
  for (const plan of [main, north]) {
    assert.ok(plan.stairs.length >= 2 * (plan.levels.length - 1), `${plan.id}: flights`);
    for (let i = 0; i < plan.levels.length - 1; i++) {
      const flights = plan.stairs.filter((s) => s.level === i);
      assert.ok(flights.length >= 2, `${plan.id}: at least two stairs from level ${i}`);
      for (const s of flights) {
        const r0 = plan.levels[i].rooms[s.room0];
        const r1 = plan.levels[i + 1].rooms[s.room1];
        assert.ok(r0 && r1, `${plan.id}: flight ${i} has rooms at both ends`);
        assert.ok(/corridor|lobby|hall|open/.test(r0.kind), `${plan.id}: flight starts in ${r0.kind} "${r0.label}"`);
      }
      assert.ok(plan.levels[i + 1].holes.length === flights.length, `${plan.id}: a stair hole per flight on level ${i + 1}`);
    }
    for (const L of plan.levels.slice(1)) assert.ok(plan.lootSpots.some((s) => s.level === L.i), `${plan.id}: loot on level ${L.i}`);
  }
});

test('storage-type rooms exist so loot is varied', () => {
  for (const name of ['Equipment Room', 'Scene Shop', 'Loading Dock', 'Science Prep Room']) assert.ok(labels(main, 0).includes(name), name);
  assert.ok(main.levels[0].rooms.filter((r) => r.kind === 'storage').length >= 4);
});

test('labels are generic: no real-looking room numbers', () => {
  for (const plan of [main, north]) {
    for (const L of plan.levels) {
      for (const r of L.rooms) {
        assert.ok(r.label, `${plan.id}: room ${r.id} labelled`);
        assert.ok(!/\d/.test(r.label), `${plan.id}: "${r.label}" contains a number`);
      }
    }
  }
});

test('dressing and style cover the BHS rooms', () => {
  for (const id of [BHS_MAIN, BHS_NORTH]) {
    assert.ok(Array.isArray(LANDMARK_DRESSING[id]) && LANDMARK_DRESSING[id].length > 50, `${id}: dressing`);
    assert.ok(BHS_STYLE[id] && BHS_STYLE[id].kinds.gym && BHS_STYLE[id].kinds.corridor, `${id}: style`);
  }
  // every dressed room exists on its level (the interpreter ignores unknown labels silently)
  for (const [plan, id] of [[main, BHS_MAIN], [north, BHS_NORTH]]) {
    for (const x of LANDMARK_DRESSING[id]) {
      const lv = x.level === undefined ? plan.levels : [plan.levels[x.level]];
      assert.ok(lv.some((L) => L && L.rooms.some((r) => r.label === x.room)), `${id}: dressed room "${x.room}" (level ${x.level}) missing`);
    }
  }
  assert.ok(main.furniture.some((p) => p.kind === 'seat_row'), 'auditorium seats');
  assert.ok(main.furniture.some((p) => p.kind === 'bleachers'), 'gym bleachers');
  assert.ok(main.furniture.some((p) => p.kind === 'locker_bank'), 'corridor lockers');
  assert.ok(main.furniture.some((p) => p.kind === 'serving_line'), 'serving line');
});

test('library carpet and the arts center have distinct reference-inspired finishes', () => {
  assert.equal(BHS_STYLE[BHS_NORTH].kinds.library.inlay, 0x7a3a3a);
  assert.equal(BHS_STYLE[BHS_MAIN].labels['Arend Arts Center'].wall, 0x8d8070);
  assert.equal(BHS_STYLE[BHS_MAIN].labels.Stage.panelWood, 0xb48a68);
});

test('plans are deterministic across builds', () => {
  const w2 = build();
  assert.equal(planOf(w2, BHS_MAIN).hash, main.hash);
  assert.equal(planOf(w2, BHS_NORTH).hash, north.hash);
  assert.equal(w2.interiorHash, world.interiorHash);
});

test('North commons gets cafe seating, an original landscape series and layered finishes', () => {
  const room = north.levels[0].rooms.find(r => r.label === 'Commons');
  const pieces = north.furniture.filter(p => p.level === 0 && p.room === room.id);
  assert.ok(pieces.some(p => p.kind === 'commons_table'), 'round tops and charcoal chairs');
  assert.ok(pieces.some(p => p.artStyle === 'landscape'), 'student-art display');
  const finish = BHS_STYLE[BHS_NORTH].labels.Commons;
  assert.notEqual(finish.wall, finish.panelWood);
  assert.notEqual(finish.floor, finish.inlay);
  assert.equal(finish.mural.length, 3, 'three contrasting ridges in the commons wall artwork');
  assert.ok(finish.beams.depth >= 0.2, 'suspended ceiling baffles cast visible relief');
});
