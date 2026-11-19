import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { landmarkAt } from '../src/game/landmarkAt.js';

const map = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const school = map.landmarks.bentonville_high;
const tile = map.meta.composition.tiles.find(t => t.key === 'bentonville_high');

test('the school tag covers the entire composed school tile and stops at its edge', () => {
  const [west, north, east, south] = tile.rect;
  for (const x of [west, (west + east) / 2, east]) {
    for (const z of [north, (north + south) / 2, south]) {
      assert.equal(landmarkAt(map, x, z), school);
    }
  }
  assert.notEqual(landmarkAt(map, west - 1, school.z), school);
});

test('other places and maps without tile metadata retain their radius-based tags', () => {
  const museum = map.landmarks.crystal_bridges;
  assert.equal(landmarkAt(map, museum.x, museum.z), museum);
  const legacy = { landmarks: { bentonville_high: school } };
  assert.equal(landmarkAt(legacy, school.x, school.z), school);
  assert.equal(landmarkAt(legacy, school.x + 500, school.z), null);
});
