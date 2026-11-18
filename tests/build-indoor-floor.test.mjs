// Regression: a piece built inside an enterable building starts flush with the storey floor.
// The ground storey's floor (the lowest terrain under the footprint) is generally not on the
// global 3 m lattice, and plan() used to treat a player indoors as "on the terrain" and snap to
// that lattice: walls sank up to 2.7 m through the floor (or floated above it), so built walls
// showed at random heights ("walls go through the floor, walls are different sizes").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';

const GROUND = 1.2; // flat terrain off the 3 m lattice

function setup() {
  const world = new World({ meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], pois: [] });
  // a flat heightfield without loading the DEM
  world.terrain = { synthetic: true };
  world.terrainHeight = () => GROUND;
  world.addBuilding({ id: 9001, t: 'retail', mat: 'brick', lv: 1, h: 6, p: [[0, 0], [30, 0], [30, 24], [0, 24]] });
  world.finishBuildings();
  const c = world.buildingInteriors()[0].collider;
  const st = new Structures({ scene: new THREE.Scene(), world });
  return { world, st, c };
}

test('fixture: the ground-storey floor is off the 3 m lattice', () => {
  const { c } = setup();
  assert.ok(Math.abs(c.shell.floor - GROUND) < 0.01, `floor ${c.shell.floor}`);
});

test('walls and floors planned indoors start at the storey floor', () => {
  const { world, st, c } = setup();
  const floor = c.shell.floor;
  let checked = 0;
  const bad = [];
  for (let x = 6; x <= 24; x += 3) {
    for (let z = 6; z <= 18; z += 3) {
      if (!world.interiorAt(x, z)) continue;
      const pos = new THREE.Vector3(x, floor, z);
      for (const [kind, pitch] of [['wall', 0], ['floor', -1.2]]) {
        for (let h = 0; h < 4; h++) {
          const pl = st.plan(kind, pos, (h * Math.PI) / 2, pitch);
          checked++;
          if (Math.abs(pl.y - floor) > 0.02) bad.push({ kind, x, z, h, y: pl.y });
        }
      }
    }
  }
  assert.ok(checked > 20, 'enough indoor samples');
  assert.deepEqual(bad.slice(0, 4), [], `${bad.length}/${checked} pieces not flush with the floor at ${floor}`);
});
