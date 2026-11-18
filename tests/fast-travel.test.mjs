// Free-build POI fast travel: sandbox-only, DROP_ZONES that exist on the map, click-nearest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DROP_ZONES } from '../src/core/config.js';
import { canFastTravel, poiTargets, nearestPoi, landAt, TRAVEL_CLICK_M } from '../src/game/fastTravel.js';

const zones = [
  { key: 'square', label: 'Downtown Square' },
  { key: 'crystal_bridges', label: 'Crystal Bridges' },
  { key: 'ghost', label: 'Missing' },
];
const landmarks = {
  square: { n: 'Square', x: 10, z: 20 },
  crystal_bridges: { n: 'Crystal Bridges', x: 100, z: -200 },
};

test('fast travel is only allowed in a live free-build session', () => {
  assert.equal(canFastTravel({ freeBuild: true, state: 'play', paused: false }), true);
  assert.equal(canFastTravel({ freeBuild: true, state: 'play', paused: true }), false);
  assert.equal(canFastTravel({ freeBuild: true, state: 'drop', paused: false }), false);
  assert.equal(canFastTravel({ freeBuild: false, state: 'play', paused: false }), false);
  assert.equal(canFastTravel({ freeBuild: true, museumMode: true, state: 'play', paused: false }), true);
  assert.equal(canFastTravel({}), false);
});

test('poiTargets lists drop zones that exist on the map, in zone order', () => {
  const t = poiTargets(landmarks, zones);
  assert.deepEqual(t.map((p) => p.key), ['square', 'crystal_bridges']);
  assert.equal(t[0].label, 'Downtown Square');
  assert.equal(t[1].x, 100);
  assert.equal(poiTargets(null, zones).length, 0);
});

test('poiTargets default to the game DROP_ZONES', () => {
  const lm = {};
  for (const z of DROP_ZONES) lm[z.key] = { x: 1, z: 2, n: z.label };
  const t = poiTargets(lm);
  assert.equal(t.length, DROP_ZONES.length);
  assert.equal(t[0].key, DROP_ZONES[0].key);
});

test('nearestPoi picks a named POI inside the click radius, else nothing', () => {
  const t = poiTargets(landmarks, zones);
  assert.equal(nearestPoi(t, 12, 22).key, 'square');
  assert.equal(nearestPoi(t, 1000, 1000), null);
  assert.ok(TRAVEL_CLICK_M >= 60);
});

test('landAt stands on the ground, preferring an open spot next to the POI', () => {
  const world = {
    groundHeight: (x, z) => x + z,
    randomOpenPoint: (_rng, x, z) => ({ x: x + 3, z: z - 1 }),
    polyAt: (x) => x === 10,
    blockedAt: () => false,
  };
  const p = landAt(world, 10, 20);
  assert.equal(p.x, 13);
  assert.equal(p.z, 19);
  assert.equal(p.y, 13 + 19);
});
