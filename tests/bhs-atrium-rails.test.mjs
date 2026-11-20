// BHS North Building commons atrium: every upper-floor walkway edge over the 3-storey void is railed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { ATRIUM, LOBBY } from '../src/world/bhs/north.js';
import { SIZE } from '../src/world/bhs/kit/palette.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
const world = new World(data);
createBhs(world, data);
const rails = world._boxes.filter((c) => c.part && c.part.role === 'rail');

/** Rail colliders whose footprint covers (x, z) at floor height y (within the rail's height). */
const railAt = (x, z, y) => rails.filter((c) => {
  const dx = x - c.cx;
  const dz = z - c.cz;
  const cs = Math.cos(c.yaw || 0);
  const sn = Math.sin(c.yaw || 0);
  const u = dx * cs + dz * sn;
  const v = -dx * sn + dz * cs;
  return Math.abs(u) <= c.hx + 0.15 && Math.abs(v) <= c.hz + 0.15 && y >= c.y0 - 0.2 && y <= c.y1;
});

test('the walkway along the atrium south edge (2nd and 3rd floor) has a railing the whole way', () => {
  const H = SIZE.storey;
  for (const L of [1, 2]) {
    for (let x = LOBBY.x1 + 0.3; x <= ATRIUM.x1 - 0.3; x += 0.5) {
      assert.ok(railAt(x, ATRIUM.z1, L * H + 0.5).length > 0, `floor ${L + 1}: no railing at x ${x.toFixed(1)}, z ${ATRIUM.z1}`);
    }
  }
});
