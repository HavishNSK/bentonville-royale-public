// Hard bots' tower and ramp rush on the REAL map (OSM world + the USGS terrain the game loads):
// on sloped ground the pieces used to be planned from absolute heights and missed their levels,
// so the tower fell apart after its first ramp. Now each piece is placed off the ramp below it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World, decodeTerrain } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { WEAPONS, BUILD, makeRng } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const meta = JSON.parse(readFileSync(new URL('../public/data/bentonville-terrain.json', import.meta.url)));
const bin = readFileSync(new URL('../public/data/bentonville-terrain.bin', import.meta.url));
const world = new World(mapData);
world.setTerrain(meta, decodeTerrain(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)));

// ordinary sloped, open map spots (found by sampling the terrain), shooter 35 m north
const SPOTS = [
  [21, -440],
  [367, -168],
  [39, -441],
  [356, 119],
  [127, -390],
];

// the world is shared: every sim's pieces are cleared again (Structures adds them to the world)
const live = [];
test.afterEach(() => {
  for (const st of live.splice(0)) st.clear();
});

function setup(x, z, { mats = 300 } = {}) {
  for (const st of live.splice(0)) st.clear(); // the loops below run several sims per test
  const structures = new Structures({ scene: new THREE.Scene(), world });
  live.push(structures);
  const bots = new Bots({ world, structures });
  const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: { wood: mats }, selected: 0 };
  bots.spawn(1, makeRng(5), { difficulty: 'hard', dropPoints: [{ x, z }], loadout });
  const bot = bots.actors[0];
  const b = bot._bot;
  bot.pos.set(x, world.groundHeight(x, z, 500), z);
  bot.gliding = false;
  bot.grounded = true;
  bot.inBus = false;
  b.state = 'wander';
  const player = { id: 500, team: 500, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0, pos: new THREE.Vector3(x, 0, z - 35), vel: new THREE.Vector3() };
  player.pos.y = world.groundHeight(player.pos.x, player.pos.z, 500);
  const step = (secs) => {
    for (let i = 0; i < secs * 60; i++) bots.update(1 / 60, { player });
  };
  step(0.2);
  return { structures, bots, bot, b, player, step };
}

test('the spots are sloped, open ground', () => {
  for (const [x, z] of SPOTS) {
    const n = world.terrainNormal(x, z);
    assert.ok(n.y < 0.99, `(${x}, ${z}) slope normal.y ${n.y.toFixed(3)}`);
    assert.ok(!world.blockedAt(x, z, 2));
  }
});

test('hard, sloped real terrain: shot from 35 m, the bot builds >= 3 tower levels, holds the top ramp and keeps shooting', () => {
  for (const [x, z] of SPOTS) {
    const { structures, bots, bot, b, player, step } = setup(x, z);
    const y0 = bot.pos.y;
    bots.notifyDamage(bot, 10, { source: player });
    assert.ok(b.tower, `(${x}, ${z}) tower started`);
    let lost = 0;
    for (let i = 0; i < 10 * 60; i++) {
      const had = !!b.tower;
      bots.update(1 / 60, { player });
      if (had && !b.tower) lost++;
    }
    const ramps = structures.pieces.filter((p) => p.alive && p.kind === 'ramp');
    const levels = new Set(ramps.map((p) => Math.round(p.y / BUILD.level)));
    assert.ok(levels.size >= 3, `(${x}, ${z}) ramp levels ${levels.size}`);
    // every ramp sits on its own cell, one level above the last (no stacking in place)
    const cells = new Set(ramps.map((p) => `${p.x},${p.z}`));
    assert.equal(cells.size, ramps.length, `(${x}, ${z}) one ramp per cell`);
    const walls = structures.pieces.filter((p) => p.alive && p.kind === 'wall');
    assert.ok(walls.length >= 3, `(${x}, ${z}) walls ${walls.length}`);
    assert.equal(lost, 0, `(${x}, ${z}) the tower was never dropped`);
    assert.ok(b.tower && b.tower.reached, `(${x}, ${z}) holding the top`);
    assert.ok(bot.pos.y > y0 + 7 && bot.pos.y > player.pos.y + 5, `(${x}, ${z}) height ${(bot.pos.y - y0).toFixed(1)}`);
    assert.equal(b.target, player);
    assert.ok(b.targetVisible, `(${x}, ${z}) sees the shooter from the top`);
    assert.ok(b.shots >= 10, `(${x}, ${z}) shots from the top: ${b.shots}`);
  }
});

test('hard, real terrain: a tower shot out from under the bot is rebuilt', () => {
  const [x, z] = SPOTS[0];
  const { structures, bots, bot, b, player, step } = setup(x, z, { mats: 800 });
  bots.notifyDamage(bot, 10, { source: player });
  step(6);
  assert.ok(b.tower && b.tower.reached, 'up');
  for (const p of [...structures.pieces]) if (p.alive) structures.remove(p);
  step(8);
  assert.ok(b.towers >= 2, `towers built: ${b.towers}`);
  assert.ok(b.tower, 'a tower is up again');
});

test('ramp rush on sloped real terrain: every ramp and its wall land a level apart', () => {
  for (const [x, z] of SPOTS) {
    const { structures, bots, bot, b, player } = setup(x, z);
    player.pos.y = bot.pos.y + 7; // on high ground: a rush
    b.state = 'engage';
    b.target = player;
    b.targetVisible = true;
    b.buildCooldown = 0;
    bots.rng = () => 0.1;
    bots._maybeBuild(b, 0, -1, 35);
    assert.equal(b.bqMode, 'rush', 'rushing');
    for (let i = 0; i < 6 * 60 && b.bqN > 0; i++) { // a piece per buildRate (0.2 s on hard)
      bots.time += 1 / 60;
      bots._buildStep(b);
    }
    const ramps = structures.pieces.filter((p) => p.kind === 'ramp').sort((p, q) => p.y - q.y);
    const walls = structures.pieces.filter((p) => p.kind === 'wall');
    assert.ok(ramps.length >= 3, `(${x}, ${z}) ramps ${ramps.length}`);
    for (let i = 1; i < ramps.length; i++) {
      assert.ok(Math.abs(ramps[i].y - ramps[i - 1].y - BUILD.level) < 0.05, `(${x}, ${z}) ramp ${i} one level up`);
      assert.ok(Math.abs(ramps[i].z - ramps[i - 1].z + BUILD.cell) < 0.05, `(${x}, ${z}) ramp ${i} one cell on`);
    }
    // a wall on each ramp's far edge, at that ramp's level (the old order lost every one above ground)
    for (const r of ramps) assert.ok(walls.some((w) => Math.abs(w.y - r.y) < 0.05 && Math.abs(w.z - (r.z - BUILD.cell / 2)) < 0.05), `(${x}, ${z}) wall for ramp at y ${r.y}`);
  }
});
