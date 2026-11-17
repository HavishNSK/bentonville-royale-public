// A grenade or rocket blast breaks player builds, building panels, and trees in range.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';
import { BUILD, BUILDING_WALL, GRENADE, ROCKET } from '../src/core/config.js';

const data = { meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] };

function scene() {
  const w = new World(data);
  w.addBuilding({ id: 7, t: 'retail', mat: 'metal', lv: 1, h: 6, p: [[0, 0], [20, 0], [20, 14], [0, 14]] });
  w.finishBuildings();
  const building = w.buildingInteriors()[0].collider;
  const near = building.shell.panels.find((p) => p.kind === 'outer' && p.alive && p.z < 1);
  const far = building.shell.panels.find((p) => p.kind === 'outer' && p.alive && p.z > 13);
  assert.ok(near && far, 'building has a near wall and a far wall');
  const tree = w.addCircle(near.x, near.z + 3, 0.4, 6, 'tree', 'wood', 200, [{ id: 1 }]);
  const farTree = w.addCircle(near.x, near.z + 30, 0.4, 6, 'tree', 'wood', 200, [{ id: 2 }]);
  const piece = {
    alive: true,
    isStructure: true,
    kind: 'wall',
    mat: 'metal',
    x: near.x,
    y: 0,
    z: near.z,
    hp: BUILD.hp.metal,
    maxHp: BUILD.hp.metal,
    taken: 0,
  };
  const structures = {
    pieces: [piece],
    _center(p, out) {
      return out.set(p.x, p.y + 1.5, p.z);
    },
    damage(p, amount) {
      p.hp -= amount;
      p.taken += amount;
      if (p.hp <= 0) p.alive = false;
      return !p.alive;
    },
  };
  const combat = new Combat({ world: w, structures });
  const grenades = new Grenades({ scene: null, world: w, combat, structures });
  return { grenades, near, far, tree, farTree, piece };
}

function boom(grenades, at, rocket) {
  grenades._explode({ rocket, pos: new THREE.Vector3(at.x, (at.y0 || 0) + 0.4, at.z), owner: null });
}

test('a grenade breaks the build, the wall and the tree it lands on', () => {
  const { grenades, near, far, tree, farTree, piece } = scene();
  boom(grenades, near, false);
  assert.equal(piece.alive, false, 'metal build');
  assert.equal(near.alive, false, 'building wall');
  assert.equal(tree.alive, false, 'tree');
  assert.equal(far.alive, true, 'the far wall stays up');
  assert.equal(farTree.alive, true, 'a tree outside the blast stays up');
  assert.ok(GRENADE.structureDamage >= BUILD.hp.metal);
  assert.ok(GRENADE.structureDamage >= BUILDING_WALL.hp.metal);
});

test('a rocket blast breaks the same things inside its radius', () => {
  const { grenades, near, far, tree, farTree, piece } = scene();
  boom(grenades, near, true);
  assert.equal(piece.alive, false, 'metal build');
  assert.equal(near.alive, false, 'building wall');
  assert.equal(tree.alive, false, 'tree');
  assert.equal(far.alive, true, 'the far wall stays up');
  assert.equal(farTree.alive, true, 'a tree outside the blast stays up');
  assert.ok(ROCKET.structureDamage >= BUILDING_WALL.hp.metal);
});
