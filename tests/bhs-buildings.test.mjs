// Bentonville High School bespoke buildings (src/world/bhs/): the kit, the plans, nav and fill.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { LOBBY, ENTRY, TOWER, COMMONS } from '../src/world/bhs/north.js';
import { BHS_STADIUM_SITE } from '../src/world/bhs/data.js';

const mapData = () => JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));

function build() {
  const data = mapData();
  const world = new World(data);
  const bhs = createBhs(world, data);
  return { world, bhs };
}

/** Walk from a to b in small steps, letting groundHeight lift / drop the feet (like the player). */
function walk(world, [x, y, z], [tx, tz], step = 0.25) {
  const n = Math.ceil(Math.hypot(tx - x, tz - z) / step);
  for (let i = 1; i <= n; i++) {
    const nx = x + ((tx - x) * i) / n;
    const nz = z + ((tz - z) * i) / n;
    const g = world.groundHeight(nx, nz, y);
    if (!Number.isFinite(g) || g === -Infinity) return { x: nx, y, z: nz, stuck: true };
    y = g;
  }
  return { x: tx, y, z: tz };
}

test('the build is deterministic (same box ids, parts and loot)', () => {
  const a = build();
  const b = build();
  assert.equal(a.world._boxes.length, b.world._boxes.length);
  assert.equal(a.bhs.kit.parts.length, b.bhs.kit.parts.length);
  assert.deepEqual(a.bhs.kit.lootSpots.map((l) => [l.x, l.y, l.z]), b.bhs.kit.lootSpots.map((l) => [l.x, l.y, l.z]));
  for (let i = 0; i < a.world._boxes.length; i += 97) {
    const p = a.world._boxes[i];
    const q = b.world._boxes[i];
    assert.deepEqual([p.cx, p.cz, p.y0, p.y1, p.hp], [q.cx, q.cz, q.y0, q.y1, q.hp]);
  }
});

test('floors: commons ground, the 2nd-floor walkway, upper corridors and the roof', () => {
  const { world } = build();
  assert.ok(Math.abs(world.groundHeight(-8.5, 230, 5) - 4.4) < 0.05, 'commons walkway at 4.4 m');
  assert.ok(Math.abs(world.groundHeight(10, 252.2, 5) - 4.4) < 0.05, 'south corridor L1');
  assert.ok(Math.abs(world.groundHeight(-20, 177.6, 9.5) - 8.8) < 0.05, 'north corridor L2');
  assert.ok(Math.abs(world.groundHeight(0, 190, 14) - 13.2) < 0.05, 'north roof');
  // the commons atrium is open through all three storeys: no floor above the commons floor
  assert.ok(world.groundHeight(-25, 225, 9.5) < 1, 'nothing to stand on mid-atrium');
});

test('the main entrance is open: walk in from the plaza, through the doors, into the lobby', () => {
  const { world } = build();
  const z = (ENTRY.z0 + ENTRY.z1) / 2 - 0.9;
  const end = walk(world, [-45, 0, z], [LOBBY.x0 + 4, z]);
  assert.ok(!end.stuck);
  // no solid box across the door line at body height
  const blocked = world._boxes.filter((c) => c.alive && !c.passable && c.y0 < 1.5 && c.y1 > 0.3 && c.minX < LOBBY.x0 + 0.3 && c.maxX > LOBBY.x0 - 0.3 && c.minZ < z + 0.4 && c.maxZ > z - 0.4 && c.kind !== 'glass');
  assert.deepEqual(blocked.map((c) => c.part && c.part.role), [], 'nothing blocks the door');
});

test('the tower stair climbs from the ground to the 2nd floor with risers under the step limit', () => {
  const { world } = build();
  // flight 1 runs along the tower's west half from the entry band toward the far end
  const xm = (TOWER.x0 + 0.1 + TOWER.x1) / 2;
  const x1 = (TOWER.x0 + 0.1 + xm) / 2 - 0.06;
  const x2 = (xm + TOWER.x1) / 2 + 0.06;
  let p = walk(world, [x1, 0, TOWER.z0 + 1.2], [x1, TOWER.z1 - 1.0]);
  assert.ok(Math.abs(p.y - 2.2) < 0.05, `mid landing at ${p.y}`);
  p = walk(world, [x1, p.y, TOWER.z1 - 1.0], [x2, TOWER.z1 - 1.0]);
  p = walk(world, [x2, p.y, TOWER.z1 - 1.0], [x2, TOWER.z0 + 1.0]);
  assert.ok(Math.abs(p.y - 4.4) < 0.05, `top landing at ${p.y}`);
  const risers = world._boxes.filter((c) => c.part && c.part.role === 'stair').map((c) => c.y1 - c.y0);
  assert.ok(risers.length > 50);
});

test('bots: routes from outside into both buildings and between floors', () => {
  const { world, bhs } = build();
  const P = new Float32Array(512);
  const K = new Uint8Array(256);
  assert.ok(bhs.nav.outside.length >= 8, 'several entrances');
  assert.ok(world.siteNav.route(-60, 245, 0, -8.5, 220, 4.4, P, K, 256) > 2, 'plaza -> commons walkway');
  assert.ok(world.siteNav.route(-10, 285, 0, 60, 400, 0, P, K, 256) > 2, 'road -> library');
  assert.ok(world.siteNav.route(-60, 245, 0, -30, 170, 8.8, P, K, 256) > 2, 'plaza -> 3rd floor');
  assert.ok(world.siteNav.inside(COMMONS.x0 + 5, COMMONS.z0 + 5, 0));
  assert.equal(world.siteNav.inside(-200, 100, 0), null);
});

test('interiors stream: every interior piece is in an int:<building>:<level> group', () => {
  const { bhs } = build();
  const groups = new Set([...bhs.kit.parts, ...bhs.kit.decors].map((p) => p.group));
  for (const g of groups) assert.ok(g === 'ext' || /^int:(north|south):\d$/.test(g), g);
  assert.ok(groups.has('int:north:0') && groups.has('int:south:1'));
});

test('the buildings keep clear of the stadium and every collider is owned and breakable or solid', () => {
  const { bhs } = build();
  const S = BHS_STADIUM_SITE;
  for (const p of bhs.kit.parts) {
    const c = p.collider;
    assert.equal(c.owner, 'bhs');
    assert.ok(Number.isFinite(c.hp) && c.hp > 0);
    assert.ok(!(c.maxX < S.x1 - 4 && c.minX > S.x0 && c.minZ > S.z0 && c.maxZ < S.z1), 'no building piece inside the stadium');
  }
});

test('everything breaks: floors, the roof and the stairs have finite hp (user: break the roof to get in)', () => {
  const { bhs } = build();
  const roles = new Map();
  for (const p of bhs.kit.parts) {
    const c = p.collider;
    if (!['slab', 'stair', 'wall'].includes(p.role)) continue;
    assert.ok(c.hp < 1e6, `${p.role} hp ${c.hp}`);
    roles.set(p.role, (roles.get(p.role) || 0) + 1);
  }
  assert.ok(roles.get('slab') > 500 && roles.get('stair') > 100);
  // the roof is tiles (one blast opens a hole, not the whole roof): none bigger than 6 x 6 m
  const roof = bhs.kit.parts.filter((p) => p.role === 'slab' && Math.abs(p.y1 - 13.2) < 0.01);
  assert.ok(roof.length > 50);
  for (const p of roof) assert.ok(p.hx <= 3.01 && p.hz <= 3.01, 'roof tile size');
});

test('stairwells are open from the 2nd to the 3rd floor (no floor across the flights)', () => {
  const { world } = build();
  // the north-west hall's flights between level 1 (4.4) and level 2 (8.8): standing on the mid landing
  // at 6.6, the floor of level 2 must not cover the flights' area
  const top = world.groundHeight(-44.4, 172, 9.5);
  assert.ok(top < 8.5, `nothing at 8.8 over the NW flights (got ${top})`);
});

test('the BHS reboot van parks in the cafeteria with the lunch tables around it', async () => {
  const { world, bhs } = build();
  const { Reboot } = await import('../src/game/Reboot.js');
  const { CAFE, VAN_SPOT, VAN_CLEAR } = await import('../src/world/bhs/south.js');
  const van = new Reboot({ world }).setup().find((v) => v.key === 'bentonville_high');
  assert.ok(van.x > CAFE.x0 && van.x < CAFE.x1 && van.z > CAFE.z0 && van.z < CAFE.z1, 'in the cafeteria');
  assert.ok(Math.hypot(van.x - VAN_SPOT.x, van.z - VAN_SPOT.z) < 0.5, 'at the spot the furniture leaves free');
  const tables = bhs.kit.parts.filter((p) => p.role === 'prop' && p.cx > CAFE.x0 && p.cx < CAFE.x1 && p.cz > CAFE.z0 && p.cz < CAFE.z1);
  assert.ok(tables.filter((p) => Math.hypot(p.cx - van.x, p.cz - van.z) < VAN_CLEAR + 5).length >= 6, 'tables around the van');
});
