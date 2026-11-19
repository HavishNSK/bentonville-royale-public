// Loot on a destroyed collider drops to the surface below (Loot.dropFrom, called by Combat._destroyCollider).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { Loot } from '../src/game/Loot.js';
import { createBhs } from '../src/world/bhs/index.js';

test('a chest on a broken upper-floor tile drops to the floor below; others stay', () => {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
  const world = new World(data);
  const bhs = createBhs(world, data);
  // a loot spot on the North Building's 2nd floor (y 4.4) and the floor tile under it
  const spot = bhs.kit.lootSpots.find((l) => Math.abs(l.y - 4.4) < 0.01 && l.z < 270);
  assert.ok(spot, 'a 2nd-floor loot spot');
  const tile = world._boxes.find((c) => c.part && c.part.role === 'slab' && Math.abs(c.y1 - 4.4) < 0.01 && spot.x >= c.minX && spot.x <= c.maxX && spot.z >= c.minZ && spot.z <= c.maxZ);
  assert.ok(tile, 'the tile under it');
  const rec = { x: spot.x, y: spot.y, z: spot.z, opened: false, info: { position: { y: spot.y } } };
  const far = { x: spot.x + 40, y: spot.y, z: spot.z, opened: false, info: { position: { y: spot.y } } };
  const fake = { records: [rec, far], world };
  world.remove(tile);
  const moved = Loot.prototype.dropFrom.call(fake, tile);
  assert.equal(moved, 1);
  assert.ok(rec.y < 4.4 - 1, `dropped to ${rec.y}`);
  assert.equal(rec.info.position.y, rec.y);
  assert.equal(far.y, 4.4, 'loot elsewhere stays');
});
