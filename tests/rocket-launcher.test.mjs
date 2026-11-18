// Rocket launchers must spawn a flying rocket on fire, not a silent no-op.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';

function setup() {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const combat = new Combat({ world, fx: null, sfx: null });
  const grenades = new Grenades({ world, combat, fx: null, sfx: null });
  combat.grenades = grenades;
  combat.launchProjectile = (shooter, w, muzzle, origin, dir) => grenades.fireRocket(shooter, muzzle, origin, dir, w.damage);
  const shooter = {
    alive: true, pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
    health: 100, shield: 0, height: 1.8, radius: 0.4,
  };
  combat.actors = [shooter];
  return { world, combat, grenades, shooter };
}

test('firing a rocket launcher launches a rocket', () => {
  const { combat, grenades, shooter } = setup();
  assert.doesNotThrow(() => {
    combat.fireWeapon(
      shooter,
      { type: 'weapon', id: 'rocket_launcher', rarity: 'rare' },
      new THREE.Vector3(0, 1.5, 0),
      new THREE.Vector3(0, 0, -1),
    );
  });
  const rocket = grenades.list.find((g) => g.rocket);
  assert.ok(rocket, 'a rocket should be in flight');
  assert.ok(rocket.vel.length() > 0, 'the rocket should be moving');
});
