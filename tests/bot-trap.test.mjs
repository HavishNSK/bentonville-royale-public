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

test('easy bots do not trap (normal: now and then); hard bots scatter shots up close', () => {
  const { bots, b, target } = setup(DIFFICULTY.easy);
  bots.diffName = 'easy';
  assert.equal(bots._maybeTrap(b, target, 8), false);
  assert.ok(DIFFICULTY.hard.closeMiss > 0.2, 'hard bots have a close-range miss');
  assert.ok(DIFFICULTY.hard.peekClosed < 0.4 && DIFFICULTY.hard.peekOpen < 0.7, 'quick edits');
  assert.ok(DIFFICULTY.hard.rushFloors && DIFFICULTY.hard.buildPieces >= 12, 'stronger build patterns');
});

// ---- getting out of a box, and guessing where the shots came from

function boxedBot(owner) {
  const s = setup();
  const { st, bots, b } = s;
  const who = owner === 'self' ? b.actor : { id: 99 };
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const pl = st.plan('wall', b.actor.pos, h, 0);
    assert.ok(pl.valid, 'box wall fits');
    st.place(pl, 'wood', who);
  }
  b.navX = b.actor.pos.x + 30; // wants to go east
  b.navZ = b.actor.pos.z;
  return s;
}

test('a bot stuck in its own box edits a door out toward where it is going', () => {
  const { st, bots, b } = boxedBot('self');
  assert.equal(bots._breakOut(b), true);
  const east = st.pieces.find((p) => p.kind === 'wall' && p.x > b.actor.pos.x + 0.5);
  assert.ok(east && east.edit, 'the east wall got a door');
  assert.ok(st.pieces.filter((p) => p !== east).every((p) => !p.edit), 'only that wall');
  assert.ok(!(b.smashUntil > bots.time), 'no pickaxe needed');
});

test('a bot in someone else\'s box pickaxes out (it cannot edit their walls)', () => {
  const { st, bots, b } = boxedBot('enemy');
  assert.equal(bots._breakOut(b), true);
  assert.ok(b.smashUntil > bots.time, 'swinging');
  assert.ok(b.smashX > b.actor.pos.x, 'at the wall toward its goal');
  assert.ok(st.pieces.every((p) => !p.edit), 'no edit of an enemy wall');
});

test('a bot that is not walled in does nothing', () => {
  const { bots, b } = setup();
  b.navX = 40;
  b.navZ = 10;
  assert.equal(bots._breakOut(b), false);
});

test('walls on hit go roughly toward the shooter, sometimes the wrong way', () => {
  const { st, bots, b } = setup();
  let seed = 7;
  bots.rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const src = { pos: new THREE.Vector3(b.actor.pos.x, 0, b.actor.pos.z - 30) }; // shooter due north (heading 0)
  let right = 0;
  let wrong = 0;
  for (let i = 0; i < 400; i++) {
    bots.time += 10;
    b.bqN = 0;
    b.bqI = 0;
    b.hitWallAt = 0;
    bots._wallOnHit(b, src);
    if (b.guessedHit === undefined) continue;
    const off = Math.abs(Math.atan2(Math.sin(b.guessedHit), Math.cos(b.guessedHit)));
    if (off < Math.PI / 4) right++;
    else wrong++;
    b.guessedHit = undefined;
  }
  assert.ok(right > wrong * 3, `mostly right: ${right} right, ${wrong} wrong`);
  assert.ok(wrong > 0, 'but not always');
});

test('every 30 damage taken: a new guess and a wall that way (damage mid-build still counts)', () => {
  const { st, bots, b } = setup();
  b.actor._bot = b;
  b.actor.team = 1;
  b.actor.isBot = true;
  const src = { pos: new THREE.Vector3(b.actor.pos.x + 30, 0, b.actor.pos.z), alive: true, team: 2, isBot: true };
  let guesses = 0;
  const hit = (n) => {
    b.guessedHit = undefined;
    bots.notifyDamage(b.actor, n, { source: src });
    if (b.guessedHit !== undefined) guesses++;
    // finish whatever went up before the next hit
    for (let i = 0; i < 120 && b.bqI < b.bqN; i++) {
      bots.time += 1 / 60;
      bots._buildStep(b);
    }
  };
  for (let i = 0; i < 6; i++) hit(10); // 60 damage in 10s
  assert.equal(guesses, 2, `walls after 60 damage in tens: ${guesses}`);
  hit(30);
  assert.equal(guesses, 3, 'one more at 30');
  // (standing still, a guess for a side that already has a wall builds nothing new)
  assert.ok(st.pieces.filter((p) => p.kind === 'wall').length >= 1, 'walls went up');
  assert.ok(DIFFICULTY.hard.misguess <= 0.05 && DIFFICULTY.hard.guessError <= 0.15, 'hard guesses are sharp');
});
