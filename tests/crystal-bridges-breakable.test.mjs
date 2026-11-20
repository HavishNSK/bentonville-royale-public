// Crystal Bridges walls are breakable panels (build.js `archPanel`): the pickaxe (still yielding
// mats), bullets and explosives break them, the hole opens for walking and shots, floors / stairs
// / plinths stay solid, the host's box destroy event replicates to clients, and a match reset
// rebuilds them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { buildSite, WALL_HP, WALL_PANEL, WALL_T } from '../src/world/crystal-bridges/build.js';
import { PAVILIONS } from '../src/world/crystal-bridges/site.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';
import { ClientSession } from '../src/net/ClientSession.js';
import { PICKAXE, BUILDING_WALL, GRENADE, weaponStats } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const site = () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  return { world, out: buildSite(world, mapData) };
};
const SOLID = (p) => p.floorOf || p.stair || p.berm || p.pier || p.threshold || p.slab || p.tier !== undefined;

test('every museum wall is a breakable, harvestable panel; floors and stairs stay solid', () => {
  const { out } = site();
  const walls = out.parts.filter((p) => p.wall || p.abutment || p.room);
  assert.ok(walls.length > 600, `walls ${walls.length}`);
  for (const p of walls) {
    const c = p.collider;
    assert.ok(p.archPanel && c.archPanel, 'marked as a wall panel');
    assert.ok(Number.isFinite(c.maxHp) && c.maxHp <= WALL_HP * 2 && c.hp === c.maxHp, `hp ${c.maxHp}`);
    assert.ok(Array.isArray(c.ref), 'harvestable (the pickaxe yields mats)');
    assert.notEqual(c.breakable, true, 'not glass-style breakable (that path gives no mats)');
    if (p.wall) assert.ok(p.hx * 2 <= WALL_PANEL + WALL_T + 1e-6, `panel width ${(p.hx * 2).toFixed(2)}`);
  }
  assert.equal(walls.filter((p) => p.collider.maxHp === WALL_HP).length, walls.length - walls.filter((p) => p.abutment).length);
  const solid = out.parts.filter(SOLID);
  assert.ok(solid.length > 300, `solid parts ${solid.length}`);
  for (const p of solid) {
    assert.ok(!p.archPanel && p.collider.maxHp > 1e6, `${p.floorOf || p.slab || 'solid part'} stays solid`);
  }
  // box budget: the split adds a few hundred boxes, not thousands
  assert.ok(out.stats.boxes < 5000, `boxes ${out.stats.boxes}`);
});

/** A free-standing partition panel with clear floor and line of sight on both sides. */
function partitionPanel(world, out) {
  for (const p of out.parts.filter((q) => q.partition)) {
    const pv = PAVILIONS.find((q) => q.id === p.pv);
    const nx = -Math.sin(p.yaw || 0);
    const nz = Math.cos(p.yaw || 0);
    const y = pv.floor + 1.2;
    const fwd = world.raycast(p.cx - nx * 1.5, y, p.cz - nz * 1.5, nx, 0, nz, 3);
    const back = world.raycast(p.cx + nx * 1.5, y, p.cz + nz * 1.5, -nx, 0, -nz, 3);
    if (fwd && fwd.collider === p.collider && back && back.collider === p.collider) return { p, pv, nx, nz, y };
  }
  return null;
}

function walk(world, x, y, z, nx, nz, dist) {
  const pos = { x, y, z };
  for (let s = 0; s < dist / 0.1; s++) {
    pos.x += nx * 0.1;
    pos.z += nz * 0.1;
    world.resolveCircle(pos, 0.42, 1.8);
    pos.y = world.groundHeight(pos.x, pos.z, pos.y);
  }
  return pos;
}

test('a pickaxe harvests a wall panel to destruction; then you walk and shoot through the hole; reset rebuilds it', () => {
  const { world, out } = site();
  const hit = partitionPanel(world, out);
  assert.ok(hit, 'need a clear partition panel');
  const { p, pv, nx, nz, y } = hit;
  const side = (q) => (q.x - p.cx) * nx + (q.z - p.cz) * nz;
  const start = { x: p.cx - nx * 1.2, z: p.cz - nz * 1.2 };
  assert.ok(side(walk(world, start.x, pv.floor, start.z, nx, nz, 2.4)) < 0, 'the intact wall blocks');

  const combat = new Combat({ world });
  const hidden = [];
  combat.view = { hideCollider: (c) => hidden.push(c), showCollider: (c) => hidden.splice(hidden.indexOf(c), 1) };
  const gone = [];
  combat.onColliderDestroyed = (c) => gone.push(c);
  const shooter = { pos: new THREE.Vector3(p.cx - nx * 1.5, pv.floor, p.cz - nz * 1.5) };
  const origin = new THREE.Vector3(p.cx - nx * 1.5, y, p.cz - nz * 1.5);
  const dir = new THREE.Vector3(nx, 0, nz);
  let swings = 0;
  let mats = 0;
  while (p.collider.alive && swings < 50) {
    const r = combat.swingPickaxe(shooter, origin, dir);
    swings++;
    if (r.harvested) mats += r.harvested.count;
  }
  assert.equal(p.collider.alive, false, 'the panel breaks');
  assert.equal(swings, Math.ceil(WALL_HP / PICKAXE.harvest), `swings ${swings}`);
  assert.ok(mats >= swings * PICKAXE.yield.brick, `mats ${mats}`);
  assert.deepEqual(hidden, [p.collider], 'its mesh is hidden');
  assert.deepEqual(gone, [p.collider], 'destroy hook fired once (the host sends cx for it)');

  const thru = world.raycast(origin.x, y, origin.z, nx, 0, nz, 3);
  assert.ok(!thru || thru.collider !== p.collider, 'shots pass the hole');
  assert.ok(side(walk(world, start.x, pv.floor, start.z, nx, nz, 2.4)) > 0.8, 'walk through the hole');
  assert.equal(world.crossesSolid(start.x, start.z, p.cx + nx * 1.2, p.cz + nz * 1.2, pv.floor), false);

  combat.restoreWorld();
  assert.equal(p.collider.alive, true, 'match reset rebuilds the wall');
  assert.equal(p.collider.hp, p.collider.maxHp);
  assert.equal(hidden.length, 0, 'and shows it again');
  assert.ok(side(walk(world, start.x, pv.floor, start.z, nx, nz, 2.4)) < 0, 'it blocks again');
});

test('bullets take BUILDING_WALL.bulletMult off a wall panel, like a map wall panel', () => {
  const { world, out } = site();
  const { p, nx, nz, y } = partitionPanel(world, out);
  const combat = new Combat({ world });
  const origin = new THREE.Vector3(p.cx - nx * 3, y, p.cz - nz * 3);
  const shooter = { id: 1, pos: origin.clone(), alive: true };
  const before = p.collider.hp;
  combat.fireWeapon(shooter, { id: 'rifle' }, origin, new THREE.Vector3(nx, 0, nz), 0, { dirs: [new THREE.Vector3(nx, 0, nz)] });
  const taken = before - p.collider.hp;
  const w = weaponStats('rifle');
  assert.ok(Math.abs(taken - w.damage * BUILDING_WALL.bulletMult) < 1e-6, `taken ${taken} (rifle ${w.damage})`);
  combat.authoritative = false;
  const hp = p.collider.hp;
  combat.fireWeapon(shooter, { id: 'rifle' }, origin, new THREE.Vector3(nx, 0, nz), 0, { dirs: [new THREE.Vector3(nx, 0, nz)] });
  assert.equal(p.collider.hp, hp, 'a client never damages it');
});

test('a grenade breaks the wall panels in reach, but not the floor, stairs or walls out of reach', () => {
  const { world, out } = site();
  const { p, pv } = partitionPanel(world, out);
  const combat = new Combat({ world });
  const grenades = new Grenades({ world, combat, loot: null, fx: null, sfx: null });
  const at = new THREE.Vector3(p.cx, pv.floor + 1, p.cz);
  grenades._explode({ pos: at, rocket: false, owner: null });
  assert.equal(p.collider.alive, false, 'the wall in the blast breaks');
  const floor = out.parts.find((q) => q.floorOf === pv.id);
  assert.equal(floor.collider.alive, true, 'the floor stays');
  for (const q of out.parts.filter((q) => q.stair || q.floorOf)) assert.equal(q.collider.alive, true, 'stairs / floors never break');
  const far = out.parts.filter((q) => q.archPanel && Math.hypot(q.cx - at.x, q.cz - at.z) > GRENADE.radius + 12);
  assert.ok(far.length > 100 && far.every((q) => q.collider.alive), 'walls far away stay');
  // you can still stand on the floor where the wall was
  assert.ok(Math.abs(world.groundHeight(p.cx, p.cz, pv.floor + 0.3) - pv.floor) < 0.05, 'floor under the broken wall');
});

test('host destroy event (cx by box id) breaks the same wall panel on a client; unbreakable boxes are refused', () => {
  const host = site();
  const client = site();
  const hc = new Combat({ world: host.world });
  const events = [];
  hc.onColliderDestroyed = (c) => events.push({ e: 'cx', ty: 'b', id: c.id, x: c.cx, z: c.cz });
  const hp = host.out.parts.find((q) => q.wall && q.side && !q.transfer);
  hc._destroyCollider(hp.collider, new THREE.Vector3(hp.cx, hp.y0 + 1, hp.cz));
  assert.equal(events.length, 1);
  const cc = new Combat({ world: client.world });
  cc.authoritative = false;
  const cs = Object.create(ClientSession.prototype);
  cs.game = { world: client.world, combat: cc };
  const msg = JSON.parse(JSON.stringify(events[0]));
  cs._colliderGone(msg);
  const cp = client.out.parts.find((q) => q.collider.id === msg.id);
  assert.equal(cp.cx, hp.cx, 'same box id on both builds');
  assert.equal(cp.collider.alive, false, 'the client breaks it');
  // a floor id is refused (still unbreakable)
  const floor = client.out.parts.find((q) => q.floorOf);
  cs._colliderGone({ e: 'cx', ty: 'b', id: floor.collider.id });
  assert.equal(floor.collider.alive, true, 'clients ignore destroy events for floors');
  cc.restoreWorld();
  assert.equal(cp.collider.alive, true, 'client reset rebuilds it');
});

test('statue plinths, statue figures and railings break (and give mats); a figure falls with its plinth', () => {
  const { world, out } = site();
  const plinths = out.parts.filter((p) => p.plinth);
  const figures = out.parts.filter((p) => p.statue && p.hidden);
  const rails = out.parts.filter((p) => p.rail);
  assert.ok(plinths.length > 10 && figures.length >= plinths.length && rails.length > 0);
  for (const p of [...plinths, ...figures, ...rails]) {
    const c = p.collider;
    assert.ok(c.archPanel && Number.isFinite(c.maxHp) && c.maxHp < 1e6, `${p.plinth || p.statue || 'rail'} is breakable`);
    assert.ok(Array.isArray(c.ref), 'harvestable: the pickaxe yields mats');
  }
  const combat = new Combat({ world });
  const hidden = [];
  combat.view = { hideCollider: (c) => hidden.push(c) };
  const pl = plinths[0];
  const fig = figures.find((f) => f.statue === pl.plinth);
  assert.deepEqual(pl.collider.dependents, [fig.collider]);
  combat._destroyCollider(pl.collider, new THREE.Vector3(pl.cx, pl.y1, pl.cz));
  assert.ok(!fig.collider.alive && hidden.includes(fig.collider), 'the figure goes with its plinth');
});

test('the pickaxe gets mats from glass panes and roof tiles it smashes', () => {
  const { world, out } = site();
  const combat = new Combat({ world });
  combat.view = { hideCollider() {} };
  const harvested = [];
  combat.onHarvest = (s, c, res) => harvested.push(res.harvested);
  for (const part of [out.glass[0], out.parts.find((p) => p.roofTile && p.collider.breakable)]) {
    const c = part.collider;
    // swing at the part's middle from 1.5 m away along x
    const y = (c.y0 + c.y1) / 2;
    const ox = c.minX - 1.5;
    const res = combat.swingPickaxe({ pos: new THREE.Vector3(ox, y - 1.5, c.cz) }, new THREE.Vector3(ox, y, c.cz), new THREE.Vector3(1, 0, 0));
    assert.ok(res.harvested && res.harvested.count > 0 && ['wood', 'brick', 'metal'].includes(res.harvested.mat), `${c.kind} ${c.mat}: ${JSON.stringify(res.harvested)}`);
  }
  assert.equal(harvested.length, 2);
});
