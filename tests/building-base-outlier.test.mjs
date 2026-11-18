// Regression: a single ditch / creek sample under one corner of a large footprint must not sink
// the whole building. The Momentary's footprint clipped one creek spike (y0 -7.58 m where the
// median ground is +1.3 m); its foundation then dug a 7 m pit that left its neighbours floating
// with their floors and furniture visible from below.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';

function world(height) {
  const w = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  w.terrain = { cell: 4, synthetic: true };
  w.terrainHeight = height;
  return w;
}

test('one deep sample under a large footprint does not set the base', () => {
  // 60 x 48 m, flat 1.0 m ground with one -8 m spike at the north-west corner
  const w = world((x, z) => (x < 2 && z < 2 ? -8 : 1));
  const p = [0, 0, 60, 0, 60, 48, 0, 48];
  const y0 = w.terrainMinUnder(p, 4, 0, 0, 60, 48);
  assert.ok(y0 >= 0 - 1e-9 && y0 <= 1, `base ${y0} should be within 1 m of the typical ground (1.0)`);
});

test('a genuinely sloped lot still takes its lowest ground', () => {
  // ground falls 6 m across the footprint: the base is the low side (no change from before)
  const w = world((x) => 6 - x * 0.1);
  const p = [0, 0, 60, 0, 60, 48, 0, 48];
  const y0 = w.terrainMinUnder(p, 4, 0, 0, 60, 48);
  assert.ok(y0 < 0.6, `base ${y0} should be near the low side (0.0)`);
});

test('small footprints keep the exact minimum', () => {
  const w = world((x, z) => (x < 1 && z < 1 ? -3 : 1));
  const p = [0, 0, 6, 0, 6, 5, 0, 5];
  assert.equal(w.terrainMinUnder(p, 4, 0, 0, 6, 5), -3);
});
