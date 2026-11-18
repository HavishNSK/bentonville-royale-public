// Smoother building and editing: build shaders are warmed at match start (the first wall used to
// stall ~400 ms), an edit drag fills every tile it crosses, a multiplayer client shows its edit
// at once (rolled back if the host refuses), and bots open the edit tile that lines up with the
// enemy and reset it when they are hit mid-peek.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { editPath } from '../src/game/Player.js';
import { Bots } from '../src/game/Bots.js';
import { ClientSession } from '../src/net/ClientSession.js';
import { DIFFICULTY, BUILD } from '../src/core/config.js';

const flat = () => new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });

test('warm() shows every empty build batch and ghost briefly, then hides them again', () => {
  const st = new Structures({ scene: new THREE.Scene(), world: flat() });
  st.warm();
  const batches = Object.values(st.batches);
  assert.ok(batches.every((b) => b.mesh.visible && b.mesh.count === 1), 'every batch drawn once');
  assert.ok(Object.values(st.ghosts).every((g) => g.visible));
  for (let i = 0; i < 3; i++) st.update(1 / 60);
  assert.ok(batches.every((b) => !b.mesh.visible && b.mesh.count === 0), 'hidden again');
  assert.ok(Object.values(st.ghosts).every((g) => !g.visible));
});

test('a piece placed during the warm frames keeps its instance', () => {
  const st = new Structures({ scene: new THREE.Scene(), world: flat() });
  st.warm();
  const pl = st.plan('wall', new THREE.Vector3(0, 0, 0), 0, 0);
  const piece = st.place(pl, 'wood', null);
  assert.ok(piece);
  for (let i = 0; i < 4; i++) st.update(1 / 60);
  const b = st.batches['wall:wood'];
  assert.equal(b.mesh.count, 1);
  assert.ok(b.mesh.visible);
});

test('an edit drag fills the tiles between frames', () => {
  assert.deepEqual(editPath('wall', 0, 8), [0, 4, 8]);
  assert.deepEqual(editPath('wall', 3, 5), [3, 4, 5]);
  assert.deepEqual(editPath('wall', 6, 0), [6, 3, 0]);
  assert.deepEqual(editPath('floor', 0, 3), [0, 3]);
  assert.deepEqual(editPath('wall', -1, 4), [4]);
});

test('a client edit shows at once and rolls back when the host never echoes it', () => {
  const st = new Structures({ scene: new THREE.Scene(), world: flat() });
  const piece = st.place(st.plan('wall', new THREE.Vector3(0, 0, 0), 0, 0), 'wood', null);
  const cs = Object.create(ClientSession.prototype);
  cs._predictedEdits = new Map();
  cs._predicted = new Map();
  cs.game = { structures: st };
  cs.predictEdit(piece, 0);
  st.edit(piece, 1 << 4);
  cs._expirePredicted();
  assert.equal(piece.edit, 1 << 4, 'still shown while waiting');
  cs._predictedEdits.get(piece.key).at -= 10000;
  cs._expirePredicted();
  assert.equal(piece.edit, 0, 'refused edit rolled back');
});

function botAt(diffName, x, z) {
  const world = flat();
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = Object.create(Bots.prototype);
  Object.assign(bots, { world, structures: st, diff: DIFFICULTY[diffName], diffName, time: 0, rng: () => 0.5 });
  const a = { pos: new THREE.Vector3(x, 0, z), alive: true };
  return { bots, st, b: { actor: a } };
}

test('a bot peeks through the wall tile that lines up with the enemy', () => {
  const { bots, st, b } = botAt('hard', 0, 2);
  // a wall along x at z = 0 (between the bot at z = 2 and enemies at z < 0)
  const w = st.place(st.plan('wall', new THREE.Vector3(0, 0, 2), 0, 0), 'wood', null);
  assert.ok(w && Math.abs(Math.sin(w.rot)) < 0.5, 'wall along x');
  // stand 2 m behind the wall's centre; enemies are placed relative to it too
  b.actor.pos.set(w.x, 0, w.z + 2);
  const X = w.x;
  const Z = w.z;
  const colOf = (m) => [0, 1, 2].find((c) => m & (1 << c) || m & (1 << (3 + c)) || m & (1 << (6 + c)));
  const straight = bots._peekMask(b, w, X, 0, Z - 20, false);
  assert.equal(straight, 1 << 4, 'straight ahead: the centre window');
  const left = bots._peekMask(b, w, X - 16, 0, Z - 16, false);
  const right = bots._peekMask(b, w, X + 16, 0, Z - 16, false);
  assert.notEqual(colOf(left), colOf(right), 'enemies on either side get opposite columns');
  assert.notEqual(colOf(left), 1);
  const high = bots._peekMask(b, w, X, 9, Z - 6, false);
  assert.ok(high & (1 << 7), 'an enemy above: the top row');
  const door = bots._peekMask(b, w, X, 0, Z - 20, true);
  assert.equal(door, (1 << 1) | (1 << 4), 'door: bottom two tiles of the centre column');
});

test('a bot hit mid-peek resets its edit at once', () => {
  const { bots, st, b } = botAt('hard', 0, 2);
  const w = st.place(st.plan('wall', new THREE.Vector3(0, 0, 2), 0, 0), 'wood', null);
  st.edit(w, 1 << 4);
  b.box = { peek: 'open', editKey: w.key, peekT: 99 };
  assert.ok(bots._resetPeekOnHit(b));
  assert.equal(w.edit, 0);
  assert.equal(b.box.peek, 'closed');
  assert.ok(b.box.peekT < 1, 'reopens after a short beat');
  // easy bots don't
  const e = botAt('easy', 0, 2);
  const w2 = e.st.place(e.st.plan('wall', new THREE.Vector3(0, 0, 2), 0, 0), 'wood', null);
  e.st.edit(w2, 1 << 4);
  e.b.box = { peek: 'open', editKey: w2.key, peekT: 99 };
  assert.equal(e.bots._resetPeekOnHit(e.b), false);
});

test('a bot under its own roof cone opens the cone quarter toward an enemy above', () => {
  const { bots, st, b } = botAt('hard', 0, 0);
  const cone = st.place(st.plan('cone', new THREE.Vector3(0, 0, 0), 0, 0), 'wood', b.actor);
  assert.ok(cone, 'cone placed');
  b.actor.pos.set(cone.x, cone.y - 3, cone.z);
  const tx = cone.x + 3;
  const tz = cone.z + 3;
  assert.equal(bots._ownBlocker(b, tx, cone.y + 1, tz), cone, 'the cone is what blocks the shot');
  assert.equal(bots._quarterMask(cone, tx, tz), 1 << 3, '+x +z quarter');
  assert.equal(bots._quarterMask(cone, cone.x - 3, cone.z - 3), 1 << 0, '-x -z quarter');
  assert.equal(bots._ownBlocker(b, cone.x, cone.y - 3, cone.z + 2), null, 'nothing of ours in the way');
});

test('a door a bot cuts is opened (away from it): bodies and shots go through', () => {
  const { bots, st, b } = botAt('hard', 0, 2);
  const w = st.place(st.plan('wall', new THREE.Vector3(0, 0, 2), 0, 0), 'wood', null);
  b.actor.pos.set(w.x, 0, w.z + 2);
  const DOOR = (1 << 1) | (1 << 4);
  assert.ok(bots._botEdit(b, w, DOOR));
  assert.notEqual(w.doors[1], 0, 'the door column is open');
  const hit = st.world.raycast(w.x, 1.2, w.z + 1.5, 0, 0, -1, 3);
  assert.ok(!hit || hit.collider !== w, 'a chest-high line through the doorway is clear');
});

test('a box fight that ends with the bot inside cuts a door and walks it out', () => {
  const { bots, st, b } = botAt('hard', 2, -2);
  const a = b.actor;
  Object.assign(a, { heading: 0, height: 1.8 });
  // a full box around the bot's cell, then the fight ends (target gone)
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) st.place(st.plan('wall', a.pos, h, 0), 'wood', a);
  b.box = { x: 2, y: 0, z: -2, peek: 'closed', editKey: null };
  b.target = null;
  bots._endBox(b);
  const opened = st.pieces.filter((p) => p.edit && p.doors.some((v) => v));
  assert.equal(opened.length, 1, 'one wall got an open door');
  assert.ok(b.boxExit, 'and the bot has a way out to walk');
  const ex = b.boxExit;
  assert.ok(Math.hypot(ex.x - 2, ex.z + 2) > BUILD.cell / 2, 'the exit point is outside the box');
});
