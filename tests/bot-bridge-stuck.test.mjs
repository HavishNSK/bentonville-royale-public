// Crystal Bridges: bots under Eleven and the Modern Art bridge do not get stuck there. The bank
// rising under each deck's end leaves less than a body's height of headroom: bots used to walk
// in head-first, get pushed against the next pavilion's plinth and stay wedged, while A* (height
// blind) kept planning them through the plinth face and every re-plan reset the stuck count.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { makeRng, PLAYER } from '../src/core/config.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { PAVILIONS, LEVEL } from '../src/world/crystal-bridges/site.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
let cached = null;
function site() {
  if (cached) return cached;
  const world = new World({ ...mapData, buildings: [], roads: [] });
  buildSite(world, mapData);
  cached = world;
  return world;
}

const BRIDGES = PAVILIONS.filter((p) => p.id === 'eleven' || p.id === 'modern-bridge');
const underBridge = (p) => BRIDGES.find((b) => p.x > b.x0 - 3 && p.x < b.x1 + 3 && p.z > b.z0 - 3 && p.z < b.z1 + 3 && p.y < b.floor - 0.5);
const room = (world, p) => world.ceilingAbove(p.x, p.z, p.y, 0) - p.y;

/** Five bots on open ground under each bridge, `secs` of wandering; samples once a second. */
function simulate(seed, secs) {
  const world = site();
  const bots = new Bots({ world, structures: new Structures({ scene: new THREE.Scene(), world }) });
  bots.spawn(0, makeRng(seed), { difficulty: 'normal' });
  const rng = makeRng(seed * 77);
  for (const b of BRIDGES) {
    for (let k = 0; k < 5; k++) {
      let x;
      let z;
      let y;
      for (;;) {
        x = b.x0 + 2 + rng() * (b.x1 - b.x0 - 4);
        z = b.z0 + 2 + rng() * (b.z1 - b.z0 - 4);
        y = world.groundHeight(x, z, b.floor - 1.5);
        if (world.ceilingAbove(x, z, y, 0) - y >= 1.9 && !world.blockedAt(x, z, 0.6)) break;
      }
      const a = bots.addBot('normal', x, z, { team: 7 });
      a.pos.y = y;
    }
  }
  const viewer = new THREE.Vector3(24, -12, -334); // the sandbox spawn: everyone at full LOD
  const hist = bots.actors.map(() => []);
  const dt = 1 / 30;
  for (let i = 0; i <= secs / dt; i++) {
    bots.update(dt, { viewer });
    if (i % 30 === 0) bots.actors.forEach((a, j) => hist[j].push({ x: a.pos.x, y: a.pos.y, z: a.pos.z }));
  }
  return { world, hist };
}

test('bots under Eleven and the Modern Art bridge keep moving and never wedge their head into a deck', () => {
  const stuck = [];
  const cramped = [];
  for (const seed of [1, 2, 3]) {
    const { world, hist } = simulate(seed, 40);
    for (const h of hist) {
      for (const p of h) if (room(world, p) < PLAYER.height - 0.05) cramped.push(`seed ${seed} ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)}`);
      const end = h[h.length - 1];
      const before = h[h.length - 21];
      if (underBridge(end) && Math.hypot(end.x - before.x, end.z - before.z) < 3) stuck.push(`seed ${seed} ${end.x.toFixed(1)},${end.y.toFixed(2)},${end.z.toFixed(1)}`);
    }
  }
  assert.deepEqual(stuck, [], `bots still stuck under a bridge after 40 s: ${stuck.join(' | ')}`);
  assert.equal(cramped.length, 0, `bot-seconds with the head inside a deck: ${cramped.slice(0, 5).join(' | ')}`);
});

test('World.ledgeAt: the lobby plinth beside Eleven is a wall from the ravine floor, ground from the lobby', () => {
  const world = site();
  // east end of Eleven: the bank under the deck, then the Garrison Lobby floor (x 14..38)
  assert.equal(world.ledgeAt(14, -256, 0.75, LEVEL.NORTH_POND - 0.7), true, 'plinth face from the pond');
  assert.equal(world.ledgeAt(13, -256, 0.75, -9.4), true, "deck's low end over the bank");
  assert.equal(world.ledgeAt(20, -256, 0.75, LEVEL.MAIN), false, 'the lobby floor from the lobby');
  assert.equal(world.ledgeAt(-13, -257, 0.75, LEVEL.MAIN), false, 'the Eleven floor from Eleven');
  assert.equal(world.ledgeAt(-13, -290, 0.75, LEVEL.NORTH_POND - 0.7), false, 'open pond');
});
