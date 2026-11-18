// Trees, rocks and cars should grant 20 materials per pickaxe swing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PICKAXE } from '../src/core/config.js';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';

function harvestWorld() {
  return new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
}

function swingEast(world) {
  const combat = new Combat({ world, fx: null, sfx: null });
  const shooter = {
    alive: true, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    health: 100, shield: 0, height: 1.8, radius: 0.4,
  };
  combat.actors = [shooter];
  return combat.swingPickaxe(shooter, new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(1, 0, 0));
}

test('trees, rocks and cars give 20 materials per swing', () => {
  assert.equal(PICKAXE.yield.wood, 20, 'trees (wood) should give 20');
  assert.equal(PICKAXE.yield.brick, 20, 'rocks (brick) should give 20');
  assert.equal(PICKAXE.yield.metal, 20, 'cars (metal) should give 20');
});

test('a tree swing grants 20 wood', () => {
  const world = harvestWorld();
  world.addCircle(2, 0, 0.4, 4, 'tree', 'wood', 200, [{}]);
  const r = swingEast(world);
  assert.equal(r.harvested && r.harvested.mat, 'wood');
  assert.equal(r.harvested.count, 20);
});

test('a rock swing grants 20 brick', () => {
  const world = harvestWorld();
  world.addCircle(2, 0, 0.5, 1.2, 'rock', 'brick', 220, [{}]);
  const r = swingEast(world);
  assert.equal(r.harvested && r.harvested.mat, 'brick');
  assert.equal(r.harvested.count, 20);
});

test('a car swing grants 20 metal', () => {
  const world = harvestWorld();
  const car = world.addPoly([[1.2, -1], [3.2, -1], [3.2, 1], [1.2, 1]], 1.5, 'vehicle', 'metal', [{}]);
  car.hp = car.maxHp = 300;
  const r = swingEast(world);
  assert.equal(r.harvested && r.harvested.mat, 'metal');
  assert.equal(r.harvested.count, 20);
});
