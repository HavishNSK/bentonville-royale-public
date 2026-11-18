import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/game/Player.js';
import { World } from '../src/world/World.js';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
function fixture() {
  const world = new World({ meta: { bounds }, buildings: [], roads: [], areas: [], pois: [] });
  const player = new Player({ inventory: { current: () => null } });
  // These tests run the real controller and collision world without inventory/UI effects.
  player._handleLoadoutKeys = () => {};
  player._actions = () => {};
  const game = { world, settings: {}, hud: { prompt() {} }, sfx: { play() {} }, fx: { dustPuff() {} }, combat: { applyDamage() {} } };
  const input = { dx: 0, dy: 0, action: (key) => key === 'moveRight', actionHit: () => false };
  return { world, player, game, input };
}

for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.25]) {
  test(`player cannot cross a thin wall at dt=${dt}`, () => {
    const { world, player, game, input } = fixture();
    world.addPoly([[0, -4], [0.2, -4], [0.2, 4], [0, 4]], 5, 'wall', 'brick', {});
    player.pos.set(-0.6, 0, 0);
    player.vel.set(8, 0, 0);
    for (let t = 0; t < 0.6; t += dt) player.update(dt, input, game);
    assert.ok(player.pos.x <= -player.radius + 0.001, `crossed wall at ${player.pos.x}`);
  });
}

test('a mantle is cancelled when a new ceiling obstructs the climb', () => {
  const { world, player, game, input } = fixture();
  player.pos.set(-2, 0, 0);
  player.mantle = { t: 0, dur: 0.3, x0: -2, y0: 0, z0: 0, x1: 1, y1: 2, z1: 0 };
  world.ceilingAbove = () => 2.4;
  player.update(0.25, input, game);
  assert.equal(player.mantle, null);
  assert.ok(player.pos.y + player.height <= 2.4 + 0.001);
});

test('a mantle cannot cross a newly placed wall', () => {
  const { world, player, game, input } = fixture();
  world.addPoly([[0, -4], [0.2, -4], [0.2, 4], [0, 4]], 5, 'wall', 'brick', {});
  player.pos.set(-1, 0, 0);
  player.mantle = { t: 0, dur: 0.3, x0: -1, y0: 0, z0: 0, x1: 1, y1: 2, z1: 0 };
  player.update(0.3, input, game);
  assert.equal(player.mantle, null);
  assert.ok(player.pos.x <= -player.radius + 0.001);
});

test('an unobstructed mantle finishes on the supported ledge', () => {
  const { world, player, game, input } = fixture();
  world.addPoly([[0, -4], [5, -4], [5, 4], [0, 4]], 2, 'wall', 'brick', {});
  player.pos.set(-0.8, 0, 0);
  player.mantle = { t: 0, dur: 0.5, x0: -0.8, y0: 0, z0: 0, x1: 1, y1: 2.05, z1: 0 };
  for (let i = 0; i < 31; i++) player.update(1 / 60, input, game);
  assert.equal(player.mantle, null);
  assert.equal(player.grounded, true);
  assert.ok(Math.abs(player.pos.y - 2) < 0.01);
});

test('landing during a frame spike stops on the roof rather than entering the prism', () => {
  const { world, player, game, input } = fixture();
  world.addPoly([[-5, -5], [5, -5], [5, 5], [-5, 5]], 2, 'wall', 'brick', {});
  player.pos.set(0, 4, 0);
  player.vel.set(0, -40, 0);
  player.grounded = false;
  player.update(0.25, { ...input, action: () => false }, game);
  assert.equal(player.grounded, true);
  assert.ok(Math.abs(player.pos.y - 2) < 0.01);
});

test('player traverses a real generated exterior doorway in both directions', () => {
  const { world, player, game, input } = fixture();
  world.addBuilding({ id: 7, t: 'retail', mat: 'brick', lv: 1, h: 5, p: [[0, 0], [20, 0], [20, 20], [0, 20]] });
  world.finishBuildings();
  const building = world.buildingInteriors()[0].collider;
  const door = building.shell.doors[0];
  const forward = { ...input, action: key => key === 'moveForward' };
  for (const direction of [-1, 1]) {
    player.pos.set(door.x - direction * door.nx * 1.3, building.y0, door.z - direction * door.nz * 1.3);
    player.vel.set(0, 0, 0);
    player.heading = Math.atan2(direction * door.nx, -direction * door.nz);
    for (let i = 0; i < 30; i++) player.update(1 / 60, forward, game);
    const distance = (player.pos.x - door.x) * door.nx + (player.pos.z - door.z) * door.nz;
    assert.ok(distance * direction > 0.5, `door blocked direction ${direction}: ${distance}`);
  }
});

test('destroying the landing support cancels grounded completion without teleporting downward', () => {
  const { world, player, game, input } = fixture();
  player.pos.set(-1, 0, 0);
  player.mantle = { t: 0, dur: 0.3, x0: -1, y0: 0, z0: 0, x1: 1, y1: 2.05, z1: 0 };
  player.update(0.3, input, game);
  assert.equal(player.mantle, null);
  assert.equal(player.grounded, false);
  assert.ok(player.pos.y > 2);
});

test('extreme displacement bounds collision work without enlarging collision steps', () => {
  const { world, player, game, input } = fixture();
  const resolve = world.resolveCircle.bind(world);
  let calls = 0;
  world.resolveCircle = (...args) => { calls++; return resolve(...args); };
  player.vel.set(100000, 0, 0);
  player.update(0.25, input, game);
  assert.ok(calls <= 128);
  assert.ok(player.pos.x <= 25.6 + 0.001);
});
