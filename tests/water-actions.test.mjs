// Shooting and building while wading / swimming in a pond (World.addArea(points, 'water')).
// Swimming only slows you and turns off sprint / jump / crouch; the hands stay free.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/game/Player.js';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Inventory } from '../src/game/Inventory.js';
import { BUILD } from '../src/core/config.js';

const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
const POND = [[-20, -20], [20, -20], [20, 20], [-20, 20]];

function fixture({ items = [], mats } = {}) {
  const world = new World({ meta: { bounds }, buildings: [], roads: [], areas: [], pois: [] });
  world.addArea(POND, 'water');
  const structures = new Structures({ scene: new THREE.Scene(), world });
  const inventory = new Inventory({ items, mats: mats || { wood: 500, brick: 0, metal: 0 }, ammo: { medium: 200, light: 200, shells: 50, heavy: 50, rockets: 10 } });
  const player = new Player({ inventory });
  player.alive = true;
  player.mode = 'ground';
  // no team / interaction UI in these tests
  player._reviveInput = () => 0;
  player._rebootInput = () => 0;
  player._interact = () => {};
  const shots = [];
  const game = {
    world,
    structures,
    settings: {},
    hud: { prompt() {}, toast() {} },
    sfx: { play() {} },
    fx: { dustPuff() {}, splash() {}, ripple() {} },
    combat: {
      applyDamage() {},
      cancelBurst() {},
      lastDirs: [],
      fireWeapon(actor, item) {
        shots.push(item.id);
        return { hits: [] };
      },
      swingPickaxe() {
        return null;
      },
    },
  };
  return { world, structures, player, game, shots };
}

function inputFor(held = new Set(), hit = new Set()) {
  return {
    dx: 0,
    dy: 0,
    wheel: 0,
    bindings: {},
    action: (k) => held.has(k),
    actionHit: (k) => hit.has(k),
    label: () => '',
  };
}

/** Runs frames standing still in the middle of the pond until the swim state settles. */
function wade(player, game) {
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  for (let i = 0; i < 10; i++) player.update(1 / 60, inputFor(), game);
}

test('the pond is water and standing in it swims', () => {
  const { world, player, game } = fixture();
  assert.equal(world.areaAt(0, 0), 'water');
  assert.equal(world.inWater(0, 0, 0), true);
  wade(player, game);
  assert.equal(player.swimming, true);
});

test('a player in the water can fire the held gun', () => {
  const { player, game, shots } = fixture({ items: [{ type: 'weapon', id: 'rifle', rarity: 'rare' }] });
  player.inventory.select(0);
  wade(player, game);
  assert.equal(player.swimming, true);
  player.cooldown = 0;
  player.update(1 / 60, inputFor(new Set(['fire']), new Set(['fire'])), game);
  assert.deepEqual(shots, ['rifle'], 'the shot reached Combat.fireWeapon');
});

test('a player in the water keeps a selected build piece and places it', () => {
  const { player, game, structures } = fixture();
  wade(player, game);
  assert.equal(player.swimming, true);
  player.setBuildPiece('wall');
  player.heading = 0; // facing north (-z)
  player.pitch = 0;
  const wood = player.inventory.mats.wood;
  player.update(1 / 60, inputFor(new Set(['fire']), new Set(['fire'])), game);
  assert.equal(player.buildPiece, 'wall', 'swimming no longer drops the build piece');
  assert.ok(player.placement && player.placement.valid, 'the wall ghost in the pond is valid');
  assert.equal(structures.pieces.length, 1, 'the wall stands in the pond');
  assert.equal(player.inventory.mats.wood, wood - BUILD.cost);
});

test('build pieces over a pond are valid placements (wall, floor, ramp)', () => {
  const { structures } = fixture();
  const feet = new THREE.Vector3(2, 0, 2);
  for (const kind of ['wall', 'floor', 'ramp']) {
    const pl = structures.plan(kind, feet, 0, 0);
    assert.equal(pl.valid, true, `${kind} over water should be placeable`);
  }
});
