import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RECIPES } from '../src/world/interiors/archetypes.js';
import { LANDMARK_RECIPES } from '../src/world/interiors/landmarks.js';
import { partition, placeDoors } from '../src/world/interiors/layout.js';
import { World } from '../src/world/World.js';

function layout(recipe, front = 'b', L = 30, W = 20, area = L * W) {
  const frame = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L, W };
  const f = { L, W, area, front, side: front === 'a' ? 'b' : 'a', door: { a: L / 2, b: W / 2 }, levels: 1 };
  const out = RECIPES[recipe](f);
  const plan = partition(out.levels?.[0] || out, [0, 0, L, 0, L, W, 0, W], frame, []);
  placeDoors(plan.rooms, plan.pieces, () => 1.8, r => ['corridor', 'living', 'sales'].includes(r.kind));
  return { ...plan, f };
}

for (const [recipe, publicKind] of [['restaurant', 'dining'], ['bike_shop', 'sales'], ['brewpub', 'bar']]) {
  test(`${recipe} reserves realistic front-of-house proportions on either frontage`, () => {
    for (const front of ['a', 'b']) {
      const { rooms } = layout(recipe, front);
      const publicRoom = rooms.find(r => r.kind === publicKind);
      assert.ok(publicRoom.area >= 600 * 0.5, `${recipe} public floor must not collapse to a two-metre strip`);
      assert.ok(publicRoom.area <= 600 * 0.75, 'keep a usable service/back-of-house zone');
      assert.equal(front === 'a' ? publicRoom.a0 : publicRoom.b0, 0, 'public room faces main entrance');
      assert.ok(rooms.every(r => r.area >= 12), 'service rooms are full usable rooms');
    }
  });
}

test('single-loaded apartment and office corridors keep human-scale widths', () => {
  for (const recipe of ['apartment', 'office_block']) {
    const { rooms } = layout(recipe, 'a', 28, 7.5);
    const corridor = rooms.find(r => r.kind === 'corridor');
    assert.ok(corridor);
    assert.ok(corridor.b1 - corridor.b0 >= 2.2);
    assert.ok(corridor.b1 - corridor.b0 <= 2.5, 'do not dedicate half a narrow building to a corridor');
    assert.ok(rooms.filter(r => r.kind !== 'corridor').every(r => r.b1 - r.b0 >= 4.9));
  }
});

test('larger houses have a circulation hall between bedrooms and shared spaces', () => {
  const { rooms, pieces } = layout('house', 'b', 22, 16, 352);
  const hall = rooms.find(r => r.kind === 'corridor');
  assert.ok(hall, 'bedrooms need a hall instead of using another bedroom as a route');
  const hi = rooms.indexOf(hall);
  for (let i = 0; i < rooms.length; i++) {
    if (rooms[i].kind !== 'bedroom' && rooms[i].kind !== 'bath') continue;
    assert.ok(pieces.some(p => (p.door || p.open) && (p.ra === i && p.rb === hi || p.rb === i && p.ra === hi)), `${rooms[i].label} connects to the hall`);
  }
});

test('current community-center footprint uses its authored recreation spaces', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
  const w = new World(data);
  for (const road of data.roads) for (let i = 0; i + 1 < road.p.length; i++) w.addRoadSegment(...road.p[i], ...road.p[i + 1], road.w, road.k);
  w.addBuilding(data.buildings.find(b => b.id === 751973534));
  w.finishBuildings();
  const c = w.buildingInteriors()[0].collider;
  const rooms = c.shell.plan.levels[0].rooms;
  for (const label of ['Aquatic Center', 'Fitness Center', 'Main Gymnasium']) {
    const r = rooms.find(r => r.label === label);
    assert.ok(r && r.area > 500, `${label} is a full-sized recreation space, not the generic hall fallback`);
  }
  assert.ok(c.shell.plan.stairs.length > 0, 'upper meeting rooms remain accessible');
});

test('landmark recipes never contain accidental fractional-metre room cuts', () => {
  const frames = { 751973534: [104.7, 86.4, 'b'] };
  for (const [id, [L, W, front]] of Object.entries(frames)) {
    const out = LANDMARK_RECIPES[id]({ L, W, front, levels: 4, area: L * W });
    const visit = n => {
      if (!n || n.leaf) return;
      assert.ok(!(typeof n.at === 'number' && n.at > 0 && n.at < 1), `ambiguous room cut ${n.at}`);
      visit(n.A); visit(n.B);
    };
    for (const tree of out.levels || [out]) visit(tree);
  }
});

test('narrow corridors keep a 1.8-metre central route free of furniture', async () => {
  const { furnishWith } = await import('../src/world/interiors/furnishings.js');
  const frame = { ox: 0, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, L: 30, W: 4 };
  const room = { id: 0, kind: 'corridor', label: 'Main corridor', a0: 0, b0: 0, a1: 30, b1: 4, cx: 15, cz: 2, area: 120 };
  const plan = { id: 952075842, recipe: 'hall', hash: 1, frame, doorH: 2.4, stairs: [], lootSpots: [],
    levels: [{ i: 0, y: 0, ceil: 3.5, rooms: [room], holes: [], doors: [] }] };
  const shell = { inner: [0, 0, 30, 0, 30, 4, 0, 4], doors: [] };
  const out = furnishWith(plan, shell, { [plan.id]: [
    { room: 'Main corridor', place: 'reserve', spine: 0, kit: false },
    { room: 'Main corridor', place: 'at', kind: 'bench', fa: 0.2, fb: 0.23, face: 'b+' },
  ] });
  for (const p of out.furniture) {
    if (p.lift > 0.6 || p.height <= 0.05) continue;
    assert.ok(p.b1 <= 1.1 || p.b0 >= 2.9, `${p.kind} narrows the clear circulation route`);
  }
});
