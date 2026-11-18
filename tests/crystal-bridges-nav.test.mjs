// Crystal Bridges: entrances bots can use, the waypoint graph, café furniture, gallery benches, chests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { PAVILIONS, LEVEL, pavilionAt } from '../src/world/crystal-bridges/site.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { NAV, ENTRANCES, createSiteNav, navClearance } from '../src/world/crystal-bridges/nav.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62;

let cached = null;
function site() {
  if (cached) return cached;
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const out = buildSite(world, mapData);
  cached = { world, out };
  return cached;
}

/** The player-controller walk used by tests/crystal-bridges-site.test.mjs (ground snap + push-out). */
function walk(world, pts, y) {
  const pos = { x: pts[0][0], y, z: pts[0][1] };
  for (let i = 1; i < pts.length; i++) {
    const [tx, tz] = pts[i];
    for (let k = 0; k < 600; k++) {
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) break;
      const s = Math.min(0.25, d);
      pos.x += (dx / d) * s;
      pos.z += (dz / d) * s;
      world.resolveCircle(pos, 0.42, 1.8, STEP);
      const cap = world.builtAbove(pos.x, pos.z, pos.y);
      const g = world.groundHeight(pos.x, pos.z, pos.y, STEP, cap);
      pos.y = g < pos.y - 0.05 ? Math.max(g, pos.y - 0.6) : g;
    }
  }
  return pos;
}

test('every bot-graph edge is a straight walkable leg, both ways', () => {
  const { world } = site();
  if (world.siteDoors) {
    world.siteDoors.setOpen('south', true);
    world.siteDoors.setOpen('library', true);
  }
  const byId = new Map(NAV.nodes.map((n) => [n.id, n]));
  for (const [a, b] of NAV.edges) {
    for (const [p, q] of [[byId.get(a), byId.get(b)], [byId.get(b), byId.get(a)]]) {
      const start = world.groundHeight(p.x, p.z, p.y + 0.3, STEP);
      const end = walk(world, [[p.x, p.z], [q.x, q.z]], start);
      assert.ok(Math.hypot(end.x - q.x, end.z - q.z) < 1.0, `${p.id} -> ${q.id} stuck at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}`);
      assert.ok(Math.abs(end.y - q.y) < 1.2, `${p.id} -> ${q.id} ended at y ${end.y.toFixed(2)}, node y ${q.y}`);
    }
  }
});

test('three public entrances have a frame, canopy and sign; the main doorway stays open', () => {
  const { out } = site();
  assert.equal(ENTRANCES.length, 3);
  assert.deepEqual(ENTRANCES.map((e) => e.id).sort(), ['library', 'main', 'south']);
  for (const e of ENTRANCES) {
    const pv = PAVILIONS.find((p) => p.id === e.pv);
    assert.ok(pv.sides[e.side].some((sp) => sp.t === 'door' && sp.a === e.a && sp.b === e.b), `${e.id} names a door span`);
    const bits = out.parts.filter((p) => (p.entrance === e.id || p.canopy === e.id) && !p.doorLeaf);
    assert.ok(bits.length >= 4, `${e.id} dressing ${bits.length}`);
    assert.ok(bits.every((p) => p.collider.passable), `${e.id} frame/canopy must not block the doorway`);
    assert.ok(out.signs.some((s) => s.text === e.sign), `${e.id} sign`);
    const sheet = out.glass.filter((g) => g.pv === e.pv && g.side === e.side && g.visOnly);
    assert.equal(sheet.length, 0, `${e.id} doorway is a glass sheet`);
  }
});

test('bots route in from outside through an entrance, and between levels', () => {
  site();
  const nav = createSiteNav();
  const P = new Float64Array(128);
  const K = new Uint8Array(64);
  // from the colonnade crest to the Contemporary gallery (lower level, across Eleven)
  let n = nav.route(80, -239, 0, -44, -320, LEVEL.LOWER, P, K, 64);
  assert.ok(n >= 8, `route length ${n}`);
  assert.ok(Math.hypot(P[0] - 64, P[1] + 239) < 0.1, 'starts at the main entrance approach');
  // from the Art Trail south of the museum to the café: the south entrance
  n = nav.route(1, -136, 0, 20, -170, LEVEL.MAIN, P, K, 64);
  assert.ok(Math.hypot(P[0] - 1, P[1] + 150) < 0.1, `south approach first, got ${P[0]}, ${P[1]}`);
  // from the crest east of the library to the library: the library entrance
  n = nav.route(60, -212, 0, 26, -226, LEVEL.MAIN + 6, P, K, 64);
  assert.ok(Math.hypot(P[0] - 44, P[1] + 211.5) < 0.1, `library approach first, got ${P[0]}, ${P[1]}`);
  // the way out: from Eleven to a point on the crest
  n = nav.route(-10, -257, LEVEL.MAIN, 70, -239, 0, P, K, 64);
  assert.ok(n >= 4);
  assert.ok(nav.inside(P[(n - 1) * 2], P[(n - 1) * 2 + 1], 0) === null, 'route ends outside');
  // no route needed: both points outside, or the same room
  assert.equal(nav.route(80, -100, 0, 90, -100, 0, P, K, 64), 0);
  assert.equal(nav.route(20, -260, LEVEL.MAIN, 30, -262, LEVEL.MAIN, P, K, 64), 0);
});

test('buildSite installs the graph on the world for Bots', () => {
  const { world } = site();
  assert.ok(world.siteNav && typeof world.siteNav.route === 'function');
  assert.ok(world.siteNav.inside(26, -259, LEVEL.MAIN));
});

test('the South Lobby is a café: coffee bar, cafeteria line, tables with chairs, menu boards', () => {
  const { out } = site();
  const sl = out.props.filter((p) => p.pv === 'south-lobby');
  assert.ok(sl.filter((p) => p.cafe === 'coffee').length >= 3, 'coffee bar counters');
  assert.ok(sl.some((p) => p.cafe === 'line'), 'cafeteria serving line');
  const tables = sl.filter((p) => p.type === 'table');
  const chairs = sl.filter((p) => p.type === 'chair');
  assert.ok(tables.length >= 6, `tables ${tables.length}`);
  assert.equal(chairs.length, tables.length * 4);
  assert.ok(out.signs.some((s) => s.text === 'COFFEE BAR') && out.signs.some((s) => s.text === 'CAFETERIA'));
  for (const p of sl) assert.ok(navClearance(p.cx, p.cz) > 1.2 || p.cafe === 'coffee' || p.cafe === 'line', `${p.type} at ${p.cx},${p.cz} blocks the aisle`);
});

test('every gallery has benches, clear of the bot lanes and the loot', () => {
  const { out } = site();
  const benches = out.props.filter((p) => p.type === 'bench');
  for (const id of ['early-american-1', 'early-american-2', 'north-gallery', 'modern-bridge', 'contemporary', 'west-wing-2026', 'corridor']) {
    assert.ok(benches.some((b) => b.pv === id), `no bench in ${id}`);
  }
  for (const b of benches) {
    assert.ok(navClearance(b.cx, b.cz) >= 1.7, `bench at ${b.cx.toFixed(1)},${b.cz.toFixed(1)} on a bot lane`);
    for (const l of out.loot) {
      const d = Math.hypot(l.x - b.cx, l.z - b.cz);
      if (l.on === 'bench' && d < 0.01) continue; // a chest placed ON this bench, on purpose
      assert.ok(d > 1.9, `bench on loot ${l.pv}`);
    }
  }
  // chests on benches stand on the seat, and there are several of them
  const onBench = out.loot.filter((l) => l.on === 'bench');
  assert.ok(onBench.length >= 5, `chests on benches ${onBench.length}`);
  for (const l of onBench) assert.ok(benches.some((b) => Math.hypot(l.x - b.cx, l.z - b.cz) < 0.01 && Math.abs(l.y - b.y1) < 1e-6), `chest on bench at ${l.x},${l.z}`);
});

test('chests inside the museum: at the entrances, the café and along the galleries', () => {
  const { out } = site();
  const inside = out.loot.filter((l) => l.kind === 'chest' && pavilionAt(l.x, l.z, l.y));
  assert.ok(inside.length >= 14, `chests inside ${inside.length}`);
  for (const pv of ['entry-tower', 'south-lobby', 'lobby', 'great-hall']) assert.ok(inside.some((l) => l.pv === pv), `no chest in ${pv}`);
});

test('the A* planner sees a pavilion floor as open (walkable slab), its walls as blocked', () => {
  const { world } = site();
  for (const [x, z] of [[26, -259], [1, -167], [-20, -251.6], [43, -320]]) {
    assert.equal(world.blockedAt(x, z, 0.75, true), false, `floor at ${x},${z} blocks A*`);
  }
  assert.equal(world.blockedAt(33.8, -220, 0.3, true), true, 'corridor east wall');
  assert.equal(world.blockedAt(53.8, -320, 0.3, true), true, 'Early American east wall');
});

test('Bots._doorRoute sends an outside bot in through an entrance to a museum chest, and it can walk it', async () => {
  const { Bots } = await import('../src/game/Bots.js');
  const { world, out } = site();
  const bots = Object.create(Bots.prototype);
  bots.world = world;
  bots.time = 0;
  bots.navStats = { doorRoutes: 0 };
  const chest = out.loot.find((l) => l.pv === 'contemporary' && l.kind === 'chest');
  const b = { actor: { pos: { x: 90, y: 0, z: -239 } }, inB: null, path: new Float32Array(128), pathK: new Uint8Array(64), doorRoutes: 0 };
  assert.equal(bots._doorRoute(b, chest.x, chest.z, undefined, chest.y), true);
  assert.ok(b.pathN >= 8, `path ${b.pathN}`);
  const pts = [[90, -239]];
  for (let i = 0; i < b.pathN; i++) pts.push([b.path[i * 2], b.path[i * 2 + 1]]);
  pts.push([chest.x, chest.z]);
  const end = walk(world, pts, 0);
  assert.ok(Math.hypot(end.x - chest.x, end.z - chest.z) < 1.2, `bot stuck at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}, y ${end.y.toFixed(1)}`);
  assert.ok(Math.abs(end.y - chest.y) < 0.7, `bot ended at y ${end.y.toFixed(2)} (chest ${chest.y})`);
});

test('south and library have closed doors you can open; the main entrance stays open', () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const out = buildSite(world, mapData);
  const mainLeaves = out.parts.filter((p) => p.entrance === 'main' && p.mat === 'doorglass');
  assert.ok(mainLeaves.length >= 2, 'main still has parked door leaves');
  assert.ok(mainLeaves.every((p) => p.collider.passable), 'main leaves must not block the colonnade');
  assert.ok(!mainLeaves.some((p) => p.doorLeaf), 'main is not an operable door');

  for (const id of ['south', 'library']) {
    const leaves = out.parts.filter((p) => p.doorLeaf && p.entrance === id);
    assert.equal(leaves.length, 2, `${id} has two sliding leaves`);
    assert.ok(leaves.every((p) => !p.collider.passable), `${id} starts closed`);
  }

  assert.ok(world.siteDoors, 'siteDoors is on the world');
  const south = world.siteDoors.near({ x: 1, y: LEVEL.MAIN + 1.2, z: -157 });
  assert.ok(south && south.id === 'south' && south.open === false, 'south door is found closed');
  const lib = world.siteDoors.near({ x: 35, y: LEVEL.MAIN + 7, z: -210 });
  assert.ok(lib && lib.id === 'library' && lib.open === false, 'library door is found closed');
  assert.equal(world.siteDoors.near({ x: 57, y: LEVEL.CREST + 1.2, z: -239 }), null, 'main has no operable door');

  const blocked = walk(world, [[1, -150], [1, -167]], LEVEL.MAIN);
  assert.ok(blocked.z > -158.5, `closed south door should stop the walk, ended z=${blocked.z.toFixed(2)}`);

  const throughMain = walk(world, [[64, -239], [50, -239]], LEVEL.CREST);
  assert.ok(throughMain.x < 56, `main entrance must stay walkable, ended x=${throughMain.x.toFixed(2)}`);
});

test('opening a museum door lets you walk through, and closing blocks again', () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  buildSite(world, mapData);
  assert.equal(world.siteDoors.toggle('south'), true);
  const opened = world.siteDoors.near({ x: 1, y: LEVEL.MAIN + 1.2, z: -157 });
  assert.ok(opened.open, 'south is open after toggle');
  const through = walk(world, [[1, -150], [1, -167]], LEVEL.MAIN);
  assert.ok(through.z < -164, `opened south should let you in, ended z=${through.z.toFixed(2)}`);
  world.siteDoors.toggle('south');
  const closed = walk(world, [[1, -150], [1, -167]], LEVEL.MAIN);
  assert.ok(closed.z > -158.5, `closed south should block again, ended z=${closed.z.toFixed(2)}`);
});

test('bots open a closed museum door when they walk up to it', () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  buildSite(world, mapData);
  const south = world.siteDoors.near({ x: 1, y: LEVEL.MAIN + 1.2, z: -157 });
  assert.equal(south.open, false);
  const n = world.siteDoors.openNear({ x: 1, y: LEVEL.MAIN + 1.2, z: -157 }, 4.5);
  assert.ok(n >= 1, `openNear opened ${n}`);
  assert.equal(world.siteDoors.near({ x: 1, y: LEVEL.MAIN + 1.2, z: -157 }).open, true);
});

