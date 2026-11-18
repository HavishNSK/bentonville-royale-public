import test from 'node:test';
import assert from 'node:assert/strict';
import { worldIdentity, sameWorld } from '../src/net/worldIdentity.js';
import { World } from '../src/world/World.js';
import { INTERIOR_VERSION } from '../src/world/Interiors.js';

const map = () => ({ meta: { generated: 'same-date' }, buildings: [{ id: 1, p: [[0, 0], [8, 0], [8, 8]] }], roads: [] });
const world = () => ({ interiorHash: '12345678', terrain: { minX: 0, minZ: 0, cell: 4, cols: 2, rows: 2, h: new Float32Array([0, 1, 2, 3]) } });

test('equivalent loaded worlds share a stable identity', () => {
  assert.equal(worldIdentity(map(), world(), 7), worldIdentity(map(), world(), 7));
  assert.equal(sameWorld(worldIdentity(map(), world(), 7), worldIdentity(map(), world(), 7)), true);
});

test('actual footprint changes are rejected even with identical map dates', () => {
  const changed = map();
  changed.buildings[0].p[0][0] = 0.25;
  assert.notEqual(worldIdentity(changed, world(), 7), worldIdentity(map(), world(), 7));
});

test('terrain heights, registration, fallback, and generated interiors are compatibility inputs', () => {
  const base = worldIdentity(map(), world(), 7);
  for (const change of [
    w => { w.terrain.h[3] = 3.001; },
    w => { w.terrain.minX = 1; },
    w => { w.terrain.cell = 8; },
    w => { w.terrain = null; },
    w => { w.interiorHash = '87654321'; },
  ]) {
    const w = world();
    change(w);
    assert.notEqual(worldIdentity(map(), w, 7), base);
  }
  assert.notEqual(worldIdentity(map(), world(), 8), base);
});

test('missing, old, malformed, and mismatched identities fail closed', () => {
  const id = worldIdentity(map(), world(), 7);
  for (const other of [null, undefined, '', 123, 'same-date+i7.12345678', {}, 'w1-' + '0'.repeat(16)]) {
    assert.equal(sameWorld(id, other), false);
    assert.equal(sameWorld(other, id), false);
  }
  assert.equal(sameWorld(null, null), false);
  assert.equal(worldIdentity(null, world(), 7), null);
  assert.equal(worldIdentity(map(), null, 7), null);
  assert.equal(worldIdentity(map(), { interiorHash: null }, 7), null);
});

test('identity is cached after loading and invalidates when the world inputs are replaced', () => {
  const data = map(), w = world();
  const id = worldIdentity(data, w, 7);
  assert.equal(worldIdentity(data, w, 7), id);
  w.terrain = { ...w.terrain, minZ: 1 };
  assert.notEqual(worldIdentity(data, w, 7), id);
});

test('independently generated collision worlds match, but a terrain-load fallback is rejected', () => {
  const data = {
    meta: { bounds: { minX: -50, minZ: -50, maxX: 50, maxZ: 50 } },
    buildings: [{ id: 123456, t: 'apartments', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [25, 0], [25, 20], [0, 20]] }],
    roads: [], areas: [], pois: [],
  };
  const build = terrain => {
    const w = new World(data);
    if (terrain) w.setTerrain({ minX: -50, minZ: -50, cols: 2, rows: 2, cell: 100 }, new Float32Array([1, 2, 3, 4]));
    for (const building of data.buildings) w.addBuilding(building);
    w.finishBuildings();
    return worldIdentity(data, w, INTERIOR_VERSION);
  };
  const host = build(true), client = build(true), fallback = build(false);
  assert.equal(sameWorld(host, client), true);
  assert.equal(sameWorld(host, fallback), false);
});
