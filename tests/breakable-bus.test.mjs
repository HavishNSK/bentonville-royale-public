// Parked school buses break like parked cars: finite hp, damaged through the shared collider
// path (bullets / pickaxe / explosives), their slice of the merged bus meshes is blanked, they
// stop colliding and blocking rays, and a match restart (Combat.restoreWorld) brings them back.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { parkSchoolBuses, setMeshCutHidden, BUS_HP } from '../src/world/WorldMeshes.js';

// a 60 x 30 m bus loop centred on the origin (long axis east-west)
const LOOP = [[-30, -15], [30, -15], [30, 15], [-30, 15]];

function busWorld() {
  const data = { meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [{ k: 'busloop', p: LOOP }], pois: [] };
  const world = new World(data);
  const root = new THREE.Group();
  const n = parkSchoolBuses(world, data, root);
  const buses = [];
  world._each(-100, -100, 100, 100, false, (cell) => {
    for (const c of cell.polys) if (c.kind === 'vehicle' && !buses.includes(c)) buses.push(c);
  });
  return { world, root, n, buses };
}

/** The same hide / show hooks the world view (buildWorldMeshes) runs for parked buses. */
const view = {
  hideCollider: (c) => c.meshCut && setMeshCutHidden(c.meshCut, true),
  showCollider: (c) => c.meshCut && setMeshCutHidden(c.meshCut, false),
};

const slices = (cut) => cut.parts.map(([g, s, n]) => Array.from(g.index.array.slice(s, s + n)));
const degenerate = (cut) => slices(cut).every((a) => a.every((v) => v === a[0]));

/** Ray from 1 m south of the bus's south face, pointing north (z is south), at mid-body height. */
function rayAt(world, bus) {
  let south = -Infinity;
  for (let i = 0; i < bus.n; i++) south = Math.max(south, bus.p[i * 2 + 1]);
  const y = world.surfaceHeight(bus.x, bus.z) + 2;
  const hit = world.raycast(bus.x, y, south + 1, 0, 0, -1, 3);
  return hit ? hit.collider : null;
}

test('every parked bus gets a finite, car-like breakable collider', () => {
  const { world, n, buses, root } = busWorld();
  assert.ok(n >= 2, `expected several buses, got ${n}`);
  assert.equal(buses.length, n);
  assert.ok(Number.isFinite(BUS_HP) && BUS_HP >= 300);
  const combat = new Combat({ world, fx: null, sfx: null });
  for (const c of buses) {
    assert.equal(c.hp, BUS_HP);
    assert.equal(c.maxHp, BUS_HP);
    assert.equal(c.mat, 'metal');
    assert.ok(combat._isHarvestable(c), 'damageable by bullets, pickaxe and explosives like cars');
    assert.equal(c.meshCut.parts.length, 4, 'one index slice per bus material');
  }
  // still one merged mesh per material (no extra draw calls)
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].children.length, 4);
  // slices of different buses never overlap
  const [a, b] = buses;
  for (let i = 0; i < 4; i++) {
    const [ga, sa, na] = a.meshCut.parts[i];
    const [gb, sb, nb] = b.meshCut.parts[i];
    assert.equal(ga, gb);
    assert.ok(sa + na <= sb || sb + nb <= sa);
  }
});

test('a bus shot to 0 hp stops colliding, blanks only its own mesh slice, and restore brings it back', () => {
  const { world, buses } = busWorld();
  const [bus, other] = buses;
  const combat = new Combat({ world, fx: null, sfx: null });
  combat.view = view;
  assert.equal(rayAt(world, bus), bus, 'bus blocks rays while alive');
  assert.ok(world.blockedAt(bus.x, bus.z, 0.3));
  const otherBefore = slices(other.meshCut);
  const busBefore = slices(bus.meshCut);

  // the bullet path (Combat._resolveHit): hp -= dmg; at <= 0 the collider is destroyed
  bus.hp -= 100;
  assert.ok(bus.alive);
  bus.hp = 0;
  combat._destroyCollider(bus, new THREE.Vector3(bus.x, 2, bus.z));
  assert.equal(bus.alive, false);
  assert.ok(combat.destroyed.includes(bus));
  assert.ok(bus.meshCut.hidden && degenerate(bus.meshCut), 'its triangles are blanked');
  assert.deepEqual(slices(other.meshCut), otherBefore, 'other buses untouched');
  assert.equal(world.blockedAt(bus.x, bus.z, 0.3), false, 'no longer collides');
  assert.notEqual(rayAt(world, bus), bus, 'no longer blocks rays');

  combat.restoreWorld(); // match restart
  assert.equal(bus.alive, true);
  assert.equal(bus.hp, BUS_HP);
  assert.equal(bus.meshCut.hidden, false);
  assert.deepEqual(slices(bus.meshCut), busBefore, 'triangles restored');
  assert.ok(world.blockedAt(bus.x, bus.z, 0.3));
  assert.equal(rayAt(world, bus), bus);
});

test('pickaxe swings break a bus after BUS_HP / 50 hits and grant metal', () => {
  const { world, buses } = busWorld();
  const bus = buses[0];
  const combat = new Combat({ world, fx: null, sfx: null });
  combat.view = view;
  const gy = world.surfaceHeight(bus.x, bus.z);
  // stand 1 m south of the bus's south face, swing north
  let south = -Infinity;
  for (let i = 0; i < bus.n; i++) south = Math.max(south, bus.p[i * 2 + 1]);
  const shooter = { alive: true, pos: { x: bus.x, y: gy, z: south + 1 }, vel: { x: 0, y: 0, z: 0 }, health: 100, shield: 0, height: 1.8, radius: 0.4 };
  combat.actors = [shooter];
  let swings = 0;
  let r;
  do {
    r = combat.swingPickaxe(shooter, new THREE.Vector3(bus.x, gy + 1.2, south + 1), new THREE.Vector3(0, 0, -1));
    swings++;
    assert.equal(r.harvested && r.harvested.mat, 'metal');
  } while (!r.destroyed && swings < 100);
  assert.equal(swings, BUS_HP / 50);
  assert.equal(bus.alive, false);
  assert.ok(bus.meshCut.hidden);
});
