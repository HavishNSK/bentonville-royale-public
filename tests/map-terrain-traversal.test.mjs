import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World, decodeTerrain } from '../src/world/World.js';
import { Player } from '../src/game/Player.js';

const read = name => fs.readFileSync(new URL('../public/data/' + name, import.meta.url));
const data = JSON.parse(read('bentonville-osm.json'));
const meta = JSON.parse(read('bentonville-terrain.json'));
const bin = read('bentonville-terrain.bin');
const heights = decodeTerrain(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const world = new World(data, { terrain: { meta, heights } });
for (const a of data.areas) world.addArea(a.p, a.k);
for (const r of data.roads) for (let i = 0; i + 1 < r.p.length; i++) world.addRoadSegment(...r.p[i], ...r.p[i + 1], r.w, r.k);
for (const bd of data.buildings) world.addBuilding(bd);
world.finishBuildings();

test('every mapped interior has a level foundation and supported ground-floor loot on real elevation', () => {
  let checked = 0;
  for (const { collider: c } of world.buildingInteriors()) {
    for (const spot of c.shell.plan.lootSpots.filter(s => !s.level)) {
      assert.ok(Math.abs(world.surfaceHeight(spot.x, spot.z) - c.y0) < 0.001, `${c.ref.id}: foundation mismatch`);
      checked++;
    }
  }
  assert.ok(checked > 50);
});

for (const fps of [30, 60, 120]) test(`real player enters and exits mapped buildings on terrain at ${fps} FPS`, () => {
  const player = new Player({ inventory: { current: () => null } });
  player._handleLoadoutKeys = () => {};
  player._actions = () => {};
  const game = { world, settings: {}, hud: { prompt() {} }, sfx: { play() {} }, fx: { dustPuff() {} }, combat: { applyDamage() {} } };
  const input = { dx: 0, dy: 0, action: key => key === 'moveForward', actionHit: () => false };
  const failures = [];
  for (const { collider: c } of world.buildingInteriors()) {
    const d = c.shell.doors[0];
    for (const direction of [-1, 1]) {
      const x = d.x - direction * d.nx * 1.2;
      const z = d.z - direction * d.nz * 1.2;
      player.pos.set(x, world.surfaceHeight(x, z), z);
      player.vel.set(0, 0, 0);
      player.heading = Math.atan2(direction * d.nx, -direction * d.nz);
      player.grounded = true;
      player.mantle = null;
      let crossed = false;
      for (let i = 0; i < fps; i++) {
        player.update(1 / fps, input, game);
        const distance = (player.pos.x - d.x) * d.nx + (player.pos.z - d.z) * d.nz;
        if (distance * direction > 0.6) { crossed = true; break; }
      }
      if (!crossed) failures.push(`${c.ref.id} direction ${direction}`);
    }
  }
  assert.deepEqual(failures, []);
});
