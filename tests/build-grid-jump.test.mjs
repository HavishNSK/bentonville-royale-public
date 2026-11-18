import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Structures } from '../src/game/Structures.js';
import { World } from '../src/world/World.js';
import { BUILD } from '../src/core/config.js';

// A flat little world with no buildings: builds sit on the ground grid (levels of BUILD.level).
function setup() {
  const world = new World({ meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], landmarks: {} });
  const st = new Structures({ scene: new THREE.Scene(), world });
  return { world, st };
}

test('jumping over a ramp keeps every planned piece on the build grid', () => {
  const { world, st } = setup();
  const cx = 2, cz = 2;
  assert.ok(st.place({ kind: 'ramp', x: cx, y: 0, z: cz, rot: 0, valid: true }, 'wood', null));
  // feet over the ramp's slope at every height of a jump: the slope's own surface is at an odd height
  for (let y = 0.4; y <= 3.6; y += 0.2) {
    const surf = world.groundHeight(cx, cz, y + 0.3);
    for (const kind of ['wall', 'floor', 'ramp']) {
      const pl = st.plan(kind, { x: cx, y, z: cz }, 0, 0, {});
      const k = pl.y / BUILD.level;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${kind} at feet ${y.toFixed(1)} (surface ${surf.toFixed(2)}) planned at y=${pl.y}`);
    }
  }
});
