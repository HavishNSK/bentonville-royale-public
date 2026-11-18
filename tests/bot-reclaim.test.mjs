// Bots._reclaimPieces: past 60% of BUILD.maxPieces the oldest bot-built pieces away from humans
// and from busy bots are taken down (max 40 a call, down to 50%), so bots never hit the build cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Bots } from '../src/game/Bots.js';
import { BUILD } from '../src/core/config.js';

function setup(n, place) {
  const pieces = [];
  const botOwner = { isBot: true };
  for (let i = 0; i < n; i++) pieces.push({ id: i + 1, alive: true, owner: botOwner, ...place(i) });
  const st = {
    pieces,
    removed: [],
    remove(p) {
      p.alive = false;
      this.removed.push(p);
      pieces.splice(pieces.indexOf(p), 1);
    },
  };
  const bots = Object.create(Bots.prototype);
  bots.structures = st;
  bots.brains = [];
  return { bots, st, pieces };
}

const far = (i) => ({ x: 500 + (i % 30) * 4, z: 500 + Math.floor(i / 30) * 4 });

test('below 60% of the cap nothing is reclaimed', () => {
  const { bots, st } = setup(Math.floor(BUILD.maxPieces * 0.6) - 1, far);
  assert.equal(bots._reclaimPieces([]), 0);
  assert.equal(st.removed.length, 0);
});

test('past 60%: the oldest bot pieces go first, at most 40 per call, down to 50%', () => {
  const n = Math.ceil(BUILD.maxPieces * 0.6) + 5;
  const { bots, st, pieces } = setup(n, far);
  assert.equal(bots._reclaimPieces([]), 40);
  assert.deepEqual(st.removed.map((p) => p.id), Array.from({ length: 40 }, (_, i) => i + 1), 'oldest ids first');
  let calls = 1;
  while (bots._reclaimPieces([]) > 0) calls++;
  assert.ok(pieces.length >= Math.floor(BUILD.maxPieces * 0.5) && pieces.length < BUILD.maxPieces * 0.6, `left ${pieces.length}`);
  assert.ok(calls > 1);
  assert.equal(bots.reclaimed, n - pieces.length);
});

test('never near a human, near a bot still building / towering, or a human-built piece', () => {
  const n = Math.ceil(BUILD.maxPieces * 0.6) + 50;
  const { bots, st, pieces } = setup(n, far);
  const human = { alive: true, isBot: false, pos: { x: 0, z: 0 } };
  // the 30 oldest: 10 by the human, 10 by a towering bot, 10 built by a human (owner not a bot)
  for (let i = 0; i < 10; i++) Object.assign(pieces[i], { x: 5 + i, z: 5 });
  for (let i = 10; i < 20; i++) Object.assign(pieces[i], { x: -300 + (i - 10) * 0.5, z: -300 });
  for (let i = 20; i < 30; i++) pieces[i].owner = human;
  bots.brains = [{ actor: { alive: true, pos: { x: -295, z: -300 } }, tower: {}, bqI: 0, bqN: 0 }];
  bots._reclaimPieces([human]);
  assert.equal(st.removed.length, 40);
  assert.ok(st.removed.every((p) => p.id > 30), 'skipped the protected pieces');
});
