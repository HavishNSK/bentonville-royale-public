// Regression: inside a multi-storey building the third-person camera must stay under the
// storey slab over the player. It used to probe floors from the pivot (feet + 1.55) with no
// cap, so at a jump apex it took the next storey's floor as its own and rose upstairs
// ("when you jump you can see the second floor"), and it could rise through a stairwell hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { placeOrbitCamera } from '../src/game/Player.js';
import { CAMERA } from '../src/core/config.js';
import { inHole, FLOOR_THICKNESS } from '../src/world/interiors/storeys.js';

const data = { meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], pois: [] };

function fixture() {
  const w = new World(data);
  // 3 storeys in 10 m: a ~3.3 m storey step, like the shells that showed the bug in-game
  w.addBuilding({ id: 4242, t: 'apartments', mat: 'brick', lv: 3, h: 10, p: [[0, 0], [25, 0], [25, 20], [0, 20]] });
  w.finishBuildings();
  return { w, c: w.buildingInteriors()[0].collider };
}

/** Ground-storey points away from the walls (stairwell holes included on purpose). */
function points(c) {
  const s = c.shell;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < s.inner.length; i += 2) {
    x0 = Math.min(x0, s.inner[i]); x1 = Math.max(x1, s.inner[i]);
    z0 = Math.min(z0, s.inner[i + 1]); z1 = Math.max(z1, s.inner[i + 1]);
  }
  const out = [];
  for (let x = x0 + 1; x < x1 - 1; x += 2) for (let z = z0 + 1; z < z1 - 1; z += 2) out.push([x, z]);
  return out;
}

test('camera stays below the upper storey while standing and at a jump apex', () => {
  const { w, c } = fixture();
  const plan = c.shell.plan;
  const L0 = plan.levels.find((l) => l.i === 0);
  const L1 = plan.levels.find((l) => l.i === 1);
  assert.ok(L0 && L1, 'fixture has two storeys');
  const underside = L1.y - FLOOR_THICKNESS;
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
  const pivot = new THREE.Vector3();
  let checked = 0;
  const bad = [];
  for (const [x, z] of points(c)) {
    if (inHole(plan, L1, x, z, 0.5)) continue; // the player stands under the slab, not in the hole
    for (const lift of [0, 1.1, 1.45]) {
      for (let h = 0; h < 8; h++) {
        for (const pitch of [0.3, 0, -0.3, -0.6]) {
          pivot.set(x, L0.y + lift + CAMERA.pivotHeight, z);
          placeOrbitCamera(cam, w, pivot, (h * Math.PI) / 4, pitch, CAMERA.distance, CAMERA.shoulder);
          checked++;
          if (cam.position.y > underside - 0.05) bad.push({ x, z, lift, h, pitch, camY: +cam.position.y.toFixed(2) });
        }
      }
    }
  }
  assert.ok(checked > 100, 'enough samples');
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length}/${checked} camera placements above the slab underside ${underside.toFixed(2)}`);
});

test('crouched (lower pivot) on an upper storey: the camera stays above that floor', () => {
  const { w, c } = fixture();
  const plan = c.shell.plan;
  const L1 = plan.levels.find((l) => l.i === 1);
  const cam = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, CAMERA.near, CAMERA.far);
  const pivot = new THREE.Vector3();
  const bad = [];
  let checked = 0;
  for (const [x, z] of points(c)) {
    if (!w.interiorAt(x, z, L1.y) || plan.levels.some((L) => L.i > 0 && inHole(plan, L, x, z, 0.8))) continue;
    for (let h = 0; h < 8; h++) {
      // crouching drops the pivot 0.45 m; the death cam uses feet + 1.2
      for (const drop of [0.45, CAMERA.pivotHeight - 1.2]) {
        pivot.set(x, L1.y + CAMERA.pivotHeight - drop, z);
        placeOrbitCamera(cam, w, pivot, (h * Math.PI) / 4, 0, CAMERA.distance, CAMERA.shoulder, CAMERA.rise, L1.y);
        checked++;
        if (cam.position.y < L1.y + 0.3) bad.push({ x, z, h, drop, camY: +cam.position.y.toFixed(2) });
      }
    }
  }
  assert.ok(checked > 50, 'enough upstairs samples');
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length}/${checked} placements below the floor at ${L1.y.toFixed(2)}`);
});
