// Smoke grenades: a throwable item that pops a cloud instead of a blast.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONSUMABLES, SMOKE } from '../src/core/config.js';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';
import { Inventory } from '../src/game/Inventory.js';
import { sandboxWeapons, giveSandboxWeapon } from '../src/game/sandboxLoadout.js';
import { hasIcon } from '../src/ui/icons.js';
import { rollConsumable } from '../src/game/Loot.js';

function popSmoke(at = { x: 0, y: 1, z: 0 }) {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const combat = new Combat({ world });
  combat.grenades = null;
  const grenades = new Grenades({ world, combat, fx: null, sfx: null });
  combat.grenades = grenades;
  const actor = {
    alive: true, pos: { x: at.x + 1, y: at.y, z: at.z }, vel: { x: 0, y: 0, z: 0 },
    health: 100, shield: 0, height: 1.8, radius: 0.4, inBus: false,
  };
  combat.actors = [actor];
  const thrown = grenades.throw(null, new THREE.Vector3(at.x, at.y, at.z), new THREE.Vector3(0, 1, 0), 'smoke');
  thrown.fuse = 0;
  thrown.vel.set(0, 0, 0);
  thrown.resting = true;
  grenades.update(0.02);
  return { world, combat, grenades, actor };
}

test('smoke is a throwable consumable with a picture', () => {
  const s = CONSUMABLES.smoke;
  assert.ok(s, 'CONSUMABLES.smoke is missing');
  assert.equal(s.throwable, true);
  assert.ok(s.stack >= 3);
  assert.ok(s.pickup >= 1);
  assert.equal(s.icon, 'smoke');
  assert.ok(hasIcon('smoke'), 'smoke icon missing');
  assert.ok(SMOKE.radius >= 12, 'cloud should cover about 3x the original area');
  assert.ok(SMOKE.opacity >= 1, 'smoke must be fully opaque so you cannot see through it');
  assert.equal(SMOKE.fogBoost, 0, 'standing in it must not wash the scene to white fog');
  assert.ok(SMOKE.duration >= 8, 'cloud should last several seconds');
});

test('sandbox weapons menu lists smoke grenades and can give a stack', () => {
  const row = sandboxWeapons().find((w) => w.id === 'smoke');
  assert.ok(row, 'smoke missing from the weapons menu');
  assert.equal(row.name, CONSUMABLES.smoke.name);
  assert.ok(hasIcon(row.icon));
  const inv = new Inventory();
  const got = giveSandboxWeapon(inv, 'smoke');
  assert.equal(got.id, 'smoke');
  assert.equal(got.type, 'consumable');
  assert.equal(got.count, CONSUMABLES.smoke.stack);
});

test('a smoke grenade pops a cloud and does not deal blast damage', () => {
  const { grenades, actor, combat } = popSmoke();
  assert.equal(grenades.list.length, 0, 'the canister is gone after the fuse');
  assert.ok(grenades.clouds.length >= 1, 'a smoke cloud should spawn');
  assert.equal(actor.health, 100, 'smoke does not hurt');
  assert.equal(combat.destroyed.length, 0, 'smoke does not break the world');
});

test('smoke meshes write depth and stay opaque so outlines behind them are hidden', () => {
  const { grenades } = popSmoke();
  grenades.update(0.6);
  const group = grenades.clouds[0].group;
  assert.ok(group && group.children.length, 'cloud should have meshes');
  for (const child of group.children) {
    const mat = child.material;
    assert.equal(mat.transparent, false, 'transparent smoke lets you see outlines through it');
    assert.equal(mat.depthWrite, true, 'smoke must write depth so ink outlines stop at the puff');
    assert.equal(mat.opacity, 1);
  }
});

test('smoke hides the floor inside the cloud', () => {
  const { grenades } = popSmoke();
  grenades.update(0.6);
  const group = grenades.clouds[0].group;
  const floor = group.children.find((m) => m.userData && m.userData.smokeFloor);
  assert.ok(floor, 'cloud needs a floor cap so the grass is not visible inside');
  const r = floor.geometry.parameters && (floor.geometry.parameters.radius ?? floor.geometry.parameters.radiusTop);
  assert.ok(r >= SMOKE.radius * 0.9, 'floor cap should span the cloud');
  assert.ok(floor.position.y <= 0.5, 'floor cap should sit near the ground');
});

test('the smoke cloud covers its centre and not a far point, then fades', () => {
  const { grenades } = popSmoke();
  grenades.update(0.6);
  assert.equal(grenades.covers(0, 1.2, 0), true);
  assert.equal(grenades.covers(10, 1.2, 0), true, 'the cloud should still cover ~10 m out');
  assert.equal(grenades.covers(40, 1.2, 0), false);
  assert.equal(grenades.blocksSight(0, 1.2, -8, 0, 1.2, 8), true);
  assert.equal(grenades.blocksSight(40, 1.2, 0, 45, 1.2, 0), false);
  grenades.update(SMOKE.duration + 0.5);
  assert.equal(grenades.clouds.length, 0, 'cloud expires');
  assert.equal(grenades.covers(0, 1.2, 0), false);
});

test('consumable loot can roll a smoke grenade', () => {
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    let s = (i * 997 + 13) >>> 0;
    const rng = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const item = rollConsumable(rng);
    if (item && item.id) seen.add(item.id);
  }
  assert.ok(seen.has('grenade'), 'frag grenades still drop');
  assert.ok(seen.has('smoke'), 'smoke grenades should drop too');
});
