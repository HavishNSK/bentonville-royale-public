// Regression: an intact floor slab or roof shields the storey below a blast. A grenade on a roof
// used to break inner walls one and two storeys down (the panel loop only measured distance).
// The slab tile under the blast is still damaged, so explosives can still blow a hole.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';

const data = { meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] };

function setup() {
  const w = new World(data);
  w.addBuilding({ id: 31, t: 'office', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [120, 0], [120, 40], [0, 40]] });
  w.finishBuildings();
  const b = w.buildingInteriors()[0].collider;
  const structures = { pieces: [], _center: (p, o) => o, damage: () => false };
  const combat = new Combat({ world: w, structures });
  const grenades = new Grenades({ scene: null, world: w, combat, structures });
  return { w, b, grenades };
}

const boom = (g, x, y, z, rocket = true) => g._explode({ rocket, pos: new THREE.Vector3(x, y, z), owner: null });

/** A spot on level L's floor, away from stair holes, near a wall so walls are in blast range. */
function spot(w, b, level) {
  const plan = b.shell.plan;
  const L = plan.levels.find((l) => l.i === level);
  for (let x = 2; x < 118; x += 0.5) {
    for (let z = 2; z < 38; z += 0.5) {
      if (!w.interiorAt(x, z, L.y)) continue;
      if (Math.abs(w.groundHeight(x, z, L.y + 0.3) - L.y) > 0.02) continue; // solid floor here
      const below = b.shell.panels.filter((p) => p.alive && p.kind !== 'floor' && p.y1 <= L.y - 0.1 && Math.hypot(p.x - x, p.z - z) < 3);
      if (below.length) return { x, z, y: L.y, below };
    }
  }
  return null;
}

test('a blast on an upper floor leaves the walls of the storey below standing', () => {
  const { w, b, grenades } = setup();
  const s = spot(w, b, 1);
  assert.ok(s, 'found an upstairs spot above downstairs walls');
  boom(grenades, s.x, s.y + 0.3, s.z);
  const broken = s.below.filter((p) => !p.alive);
  assert.equal(broken.length, 0, `${broken.length}/${s.below.length} walls below the slab broke`);
});

test('a blast on the roof leaves the top storey walls standing', () => {
  const { w, b, grenades } = setup();
  const topLevel = Math.max(...b.shell.plan.levels.map((l) => l.i));
  // an inner wall of the top storey, and the roof right above it
  const wall = b.shell.panels.find((p) => p.alive && p.kind === 'inner' && p.level === topLevel);
  assert.ok(wall, 'a top-storey inner wall');
  const roof = w.groundHeight(wall.x, wall.z, 50);
  assert.ok(roof > wall.y1, `roof ${roof} above the wall top ${wall.y1}`);
  const top = b.shell.panels.filter((p) => p.alive && p.kind !== 'floor' && p.y1 < roof - 0.1 && Math.hypot(p.x - wall.x, p.z - wall.z) < 4);
  boom(grenades, wall.x, roof + 0.3, wall.z);
  assert.equal(top.filter((p) => !p.alive).length, 0, `${top.filter((p) => !p.alive).length}/${top.length} walls under the roof broke`);
});

test('the floor tile under the blast still breaks (explosives can blow a hole)', () => {
  const { b, grenades } = setup();
  const tile = b.shell.panels.find((p) => p.kind === 'floor' && p.alive);
  assert.ok(tile, 'the fixture has floor tiles');
  boom(grenades, tile.x, tile.y1 + 0.3, tile.z);
  assert.equal(tile.alive, false, 'the floor tile under the blast broke');
});
