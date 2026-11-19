import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Structures } from '../src/game/Structures.js';
import { World } from '../src/world/World.js';
import { BUILD } from '../src/core/config.js';

// A world whose terrain is `height(x, z)` everywhere (a 1 m terrain grid over the bounds).
function setup(height) {
  const world = new World({ meta: { bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 } }, buildings: [], roads: [], areas: [], landmarks: {} });
  const cols = 121;
  const hs = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) hs[j * cols + i] = height(-60 + i, -60 + j);
  world.setTerrain({ minX: -60, minZ: -60, cell: 1, cols, rows: cols }, hs);
  const st = new Structures({ scene: new THREE.Scene(), world });
  return { world, st };
}

test('on flat ground off the 3 m grid (the Crystal Bridges ravine floor) pieces sit flush, not underground', () => {
  for (const g of [-14.1, -13.55, -13.7, -1.2, 4.6]) {
    const { world, st } = setup(() => g);
    const feet = { x: 3, y: world.terrainHeight(3, 3), z: 3 };
    for (const kind of ['wall', 'floor', 'ramp']) {
      const pl = st.plan(kind, feet, 0, 0, {});
      assert.ok(Math.abs(pl.y - g) < 0.011, `${kind} on ground ${g} planned at ${pl.y}`);
      assert.ok(pl.valid, `${kind} on ground ${g} is placeable`);
    }
    // the next piece built off the first one stays on that piece's grid
    const first = st.plan('floor', feet, 0, 0, {});
    assert.ok(st.place(first, 'wood', null));
    const up = st.plan('wall', { x: first.x, y: first.y, z: first.z }, 0, 0.8, {});
    assert.ok(Math.abs(up.y - (g + BUILD.level)) < 0.011, `a wall looking up from the floor at ${g} sits one level up (${up.y})`);
  }
});

test('ground near the grid keeps the shared world grid (gentle slopes bury a little)', () => {
  const { st } = setup(() => 0);
  assert.equal(st.plan('floor', { x: 3, y: 0, z: 3 }, 0, 0, {}).y, 0);
  const s = setup((x) => -9 + x * 0.15);
  const pl = s.st.plan('floor', { x: 3, y: s.world.terrainHeight(3, 3), z: 3 }, 0, 0, {});
  const k = pl.y / BUILD.level;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `sloped ground planned at ${pl.y}`);
});

test('on a ravine bank a piece sits at the lowest ground of its cell: never buried whole, never floating', () => {
  // a 25 % bank from -14.1 up: the world grid would put the floor at -15, under all of it
  const { world, st } = setup((x) => -14.1 + Math.max(0, x) * 0.25);
  for (let x = 1; x <= 9; x += 2) {
    const g = world.terrainHeight(x, 2);
    const pl = st.plan('floor', { x, y: g, z: 2 }, 0, 0, {});
    const e = BUILD.cell / 2 - 0.1;
    let lo = Infinity;
    for (const a of [-e, 0, e]) for (const b of [-e, 0, e]) lo = Math.min(lo, world.terrainHeight(pl.x + a, pl.z + b));
    // within the ground snap of the grid rule: at most 0.3 m over the low corner, 0.35 m under it
    assert.ok(pl.y <= lo + 0.31 && pl.y >= lo - 0.36, `floor at ${pl.y}, lowest ground ${lo.toFixed(2)}`);
  }
});

test('building from the ground toward a landmark block (a gallery floor 2.7 m up) puts the piece on top of it, not inside', () => {
  const { world, st } = setup(() => -13.7);
  // a floor block filling the cells north of z = 0 (y -14.3 .. -11), resting on the terrain
  world.addBox({ cx: 0, cz: -20, hx: 30, hz: 20, y0: -14.3, y1: -11, kind: 'museum', mat: 'brick' });
  const pl = st.plan('floor', { x: 2, y: -13.7, z: 2 }, 0, 0, {}); // facing north, the cell ahead is the block
  assert.ok(pl.z < 0, 'the cell ahead');
  assert.ok(Math.abs(pl.y + 11) < 0.011, `on the block at -11, not inside it (${pl.y})`);
  // a deck with room under it (bottom well above the ground) is not ground: pieces go under it
  const { world: w2, st: s2 } = setup(() => -13.7);
  w2.addBox({ cx: 0, cz: -20, hx: 30, hz: 20, y0: -12.2, y1: -11.6, kind: 'museum', mat: 'brick' });
  const under = s2.plan('floor', { x: 2, y: -13.7, z: 2 }, 0, 0, {});
  assert.ok(Math.abs(under.y + 13.7) < 0.011, `under the deck on the ground (${under.y})`);
});
