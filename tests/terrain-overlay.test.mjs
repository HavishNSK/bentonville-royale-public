// The Crystal Bridges ravine laid over the map's USGS terrain (World.setTerrainOverlay): the
// ravine inside its tile, the hills easing down to street level around it, the map untouched
// further out, and the museum still standing on its floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { PAVILIONS, TILE, siteHeight, pondsFrom } from '../src/world/crystal-bridges/site.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../public/data/bentonville-terrain.json', import.meta.url)));
const raw = readFileSync(new URL('../public/data/bentonville-terrain.bin', import.meta.url));

function usgsWorld() {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const h = new Float32Array(meta.cols * meta.rows);
  for (let i = 0; i < h.length; i++) h[i] = dv.getInt16(i * 2, true) / 100;
  world.setTerrain({ minX: meta.minX, minZ: meta.minZ, cell: meta.cell, cols: meta.cols, rows: meta.rows }, h);
  return world;
}

test('over USGS terrain the museum tile is its own ravine and the hills ease down to it', () => {
  const world = usgsWorld();
  const before = (x, z) => world.terrainHeight(x, z);
  const far = [[0, -800], [400, -300], [-400, -300]].map(([x, z]) => before(x, z));
  const out = buildSite(world, mapData);
  assert.ok(world.terrainOverlay, 'the ravine is an overlay, not a replacement');
  const ponds = pondsFrom(mapData);
  for (const [x, z] of [[0, -300], [-30, -250], [40, -400], [10, -200]]) {
    assert.ok(Math.abs(world.terrainHeight(x, z) - siteHeight(ponds, x, z)) < 0.6, `ravine at ${x},${z}`);
  }
  // the rest of the map keeps its hills
  [[0, -800], [400, -300], [-400, -300]].forEach(([x, z], i) => assert.equal(world.terrainHeight(x, z), far[i]));
  // the blend band: no cliff between the tile edge and the hills (slope under ~0.35 sampled every 2 m)
  for (const [x0, z0, dx, dz] of [[0, TILE.z0, 0, -1], [0, TILE.z1, 0, 1], [TILE.x0, -300, -1, 0], [TILE.x1, -300, 1, 0]]) {
    let prev = world.terrainHeight(x0, z0);
    for (let d = 2; d <= 70; d += 2) {
      const y = world.terrainHeight(x0 + dx * d, z0 + dz * d);
      assert.ok(Math.abs(y - prev) / 2 < 0.35, `step ${(y - prev).toFixed(2)} at ${d} m out of ${x0},${z0}`);
      prev = y;
    }
  }
  // the museum still stands on its floors (no USGS hill poking through them)
  for (const pv of PAVILIONS) {
    if (pv.noSlab) continue;
    for (let x = pv.x0 + 0.5; x < pv.x1; x += 4) for (let z = pv.z0 + 0.5; z < pv.z1; z += 4) {
      assert.ok(world.terrainHeight(x, z) <= pv.floor - 0.2, `${pv.id} terrain through the floor at ${x},${z}`);
    }
  }
  for (const l of out.loot) {
    const g = world.groundHeight(l.x, l.z, l.y + 0.3, 0.62);
    assert.ok(Math.abs(g - l.y) < 0.35, `loot ${l.pv} floats or sinks`);
  }
});

test('setTerrainOverlay without map terrain is a plain heightfield', () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  buildSite(world, mapData);
  assert.ok(world.terrain && !world.terrainOverlay);
});
