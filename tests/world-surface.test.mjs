import test from 'node:test';
import assert from 'node:assert/strict';
import { World, decodeTerrain } from '../src/world/World.js';

function slope() {
  const w = new World({ meta: { bounds: { minX: -32, minZ: -32, maxX: 32, maxZ: 32 } } });
  const heights = Float32Array.from({ length: 81 }, (_, i) => (i % 9) * 2);
  w.setTerrain({ minX: -32, minZ: -32, cell: 8, cols: 9, rows: 9 }, heights);
  w.addBuilding({ id: 1, p: [[-8, -8], [8, -8], [8, 8], [-8, 8]], h: 8, lv: 2, a: 256, mat: 'brick' });
  w.finishBuildings();
  return w;
}

test('building floor, ground collision and placement share a graded surface on hills', () => {
  const w = slope();
  const c = w.buildingById(1);
  assert.equal(w.terrainHeight(0, 0), 8, 'raw elevation remains available');
  assert.equal(w.surfaceHeight(0, 0), c.y0);
  assert.equal(w.groundHeight(0, 0, c.y0), c.shell.floor);
  assert.equal(w.surfaceHeight(31, 31), w.terrainHeight(31, 31));
  let previous = w.surfaceHeight(8, 0);
  for (let x = 8.1; x < 32; x += 0.1) {
    const y = w.surfaceHeight(x, 0);
    assert.ok(Math.abs(y - previous) < 0.15, `continuous foundation approach at ${x}`);
    previous = y;
  }
  const prop = w.addCircle(10, 0, 0.3, 2, 'tree', 'wood', 100, null);
  assert.equal(prop.y0, w.surfaceHeight(10, 0));
});

test('ground rays hit the same foundation surface rather than the buried raw terrain', () => {
  const w = slope();
  const y = w.surfaceHeight(10, 0);
  const hit = w.raycast(10, 20, 0, 0, -1, 0, 30);
  assert.ok(hit);
  assert.ok(Math.abs(hit.y - y) < 0.02);
});

test('flat ground fallback and repeated foundations are deterministic', () => {
  const w = new World({ meta: { bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 } } });
  assert.equal(w.surfaceHeight(2, 2), 0);
  assert.equal(slope().surfaceHeight(10, 0), slope().surfaceHeight(10, 0));
});

test('malformed terrain metadata, payloads and nonfinite samples fail before installation', () => {
  const w = slope();
  const before = w.terrain;
  for (const [meta, heights] of [
    [{ minX: 0, minZ: 0, cell: 0, cols: 2, rows: 2 }, new Float32Array(4)],
    [{ minX: 0, minZ: 0, cell: 1, cols: 2, rows: 2 }, new Float32Array(3)],
    [{ minX: 0, minZ: 0, cell: 1, cols: 2, rows: 2 }, new Float32Array([0, 0, NaN, 0])],
  ]) assert.throws(() => w.setTerrain(meta, heights), /terrain/i);
  assert.equal(w.terrain, before);
  assert.throws(() => decodeTerrain({ cols: 2, rows: 2 }, new ArrayBuffer(6)), /terrain/i);
});
