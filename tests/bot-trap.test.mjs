// Hard bots: full-box a close opponent and work the wall facing them with quick window edits;
// up close their aim scatters (an angular error alone used to mean they never missed).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { DIFFICULTY, BUILD } from '../src/core/config.js';

function setup(diff = DIFFICULTY.hard) {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = Object.create(Bots.prototype);
  bots.world = world;
  bots.structures = st;
  bots.diff = diff;
  bots.time = 0;
  bots.rng = () => 0.1; // the dice always say yes
  const mats = { wood: 500, brick: 0, metal: 0 };
  const actor = {
    pos: new THREE.Vector3(2, 0, 10), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health: 100, shield: 100,
    inventory: { mats, spendMats(m, n) { if ((mats[m] || 0) < n) return false; mats[m] -= n; return true; } },
  };
  const target = { pos: new THREE.Vector3(2, 0, 2), alive: true, grounded: true };
  const b = {
    actor, target, targetVisible: true, bq: Array.from({ length: 16 }, () => ({ kind: 'wall', x: 0, y: 0, z: 0, h: 0, p: 0 })),
    bqN: 0, bqI: 0, bqNext: 0, builds: 0, reloading: 0, reactLeft: 1, trackTime: 0, burstLeft: 0, fireCd: 1, buildCooldown: 0,
  };
  return { world, st, bots, b, target };
}

function run(bots, b, secs, dist) {
  for (let i = 0; i < secs * 60; i++) {
    bots.time += 1 / 60;
    if (b.bqI < b.bqN) bots._buildStep(b);
    if (b.trap) bots._maybeTrap(b, b.target, dist);
  }
}

test('a hard bot full-boxes a close opponent: 4 walls and a roof on their cell', () => {
  const { st, bots, b, target } = setup();
  assert.equal(bots._maybeTrap(b, target, 8), true, 'starts a trap');
  run(bots, b, 0.6, 8);
  const cx = (Math.floor(target.pos.x / BUILD.cell) + 0.5) * BUILD.cell;
  const cz = (Math.floor(target.pos.z / BUILD.cell) + 0.5) * BUILD.cell;
  const walls = st.pieces.filter((p) => p.kind === 'wall' && Math.hypot(p.x - cx, p.z - cz) < BUILD.cell / 2 + 0.1);
  const roof = st.pieces.filter((p) => p.kind === 'cone' && Math.hypot(p.x - cx, p.z - cz) < 0.1);
  assert.equal(walls.length, 4, `walls around them: ${walls.length}`);
  assert.equal(roof.length, 1, 'a roof over them');
});

test('then it edits a window in the wall facing it, shoots, and closes it again, quickly', () => {
  const { st, bots, b, target } = setup();
  bots._maybeTrap(b, target, 8);
  run(bots, b, 0.6, 8);
  const facing = st.pieces.find((p) => p.kind === 'wall' && p.z > target.pos.z + 1); // the bot stands to the south (+z)
  assert.ok(facing, 'wall on the side facing the bot');
  let opened = 0;
  let closed = 0;
  let last = facing.edit | 0;
  for (let i = 0; i < 4 * 60; i++) {
    bots.time += 1 / 60;
    bots._maybeTrap(b, target, 8);
    const e = facing.edit | 0;
    if (e !== last) e ? opened++ : closed++;
    last = e;
  }
  assert.ok(opened >= 3 && closed >= 2, `edit cycles in 4 s: opened ${opened}, closed ${closed}`);
  // only the wall facing the bot is ever edited
  assert.ok(st.pieces.filter((p) => p.kind === 'wall' && p !== facing).every((p) => !p.edit));
});

test('the trap ends when the opponent breaks out of the cell', () => {
  const { bots, b, target } = setup();
  bots._maybeTrap(b, target, 8);
  run(bots, b, 0.6, 8);
  target.pos.set(9, 0, 2);
  assert.equal(bots._maybeTrap(b, target, 8), false);
  assert.equal(b.trap, null);
});

test('normal bots do not trap; hard bots scatter shots up close', () => {
  const { bots, b, target } = setup(DIFFICULTY.normal);
  assert.equal(bots._maybeTrap(b, target, 8), false);
  assert.ok(DIFFICULTY.hard.closeMiss > 0.2, 'hard bots have a close-range miss');
  assert.ok(DIFFICULTY.hard.peekClosed < 0.4 && DIFFICULTY.hard.peekOpen < 0.7, 'quick edits');
  assert.ok(DIFFICULTY.hard.rushFloors && DIFFICULTY.hard.buildPieces >= 12, 'stronger build patterns');
});
