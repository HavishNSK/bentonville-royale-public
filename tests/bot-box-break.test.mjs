// A bot's own box whose same wall keeps getting broken: rebuilt a few times (a per-box limit,
// 2..5), then given up: run out the far side when hurt (health < 50), else build at the breaker.
// And a trap whose window the trapped target shoots back through: reset, run to another face.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { Combat } from '../src/game/Combat.js';
import { DIFFICULTY, BUILD, WEAPONS, makeRng } from '../src/core/config.js';

function setup(name = 'hard', health = 100) {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = Object.create(Bots.prototype);
  bots.world = world;
  bots.structures = st;
  bots.diff = DIFFICULTY[name];
  bots.diffName = name;
  bots.time = 0;
  bots.rng = () => 0.1;
  const mats = { wood: 999, brick: 0, metal: 0 };
  const actor = {
    id: 1, team: 1, isBot: true, heading: 0, pitch: 0,
    pos: new THREE.Vector3(2, 0, 14), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health, shield: 100,
    inventory: { mats, spendMats(m, n) { if ((mats[m] || 0) < n) return false; mats[m] -= n; return true; } },
  };
  // the breaker, due north of the bot (heading 0 = -z)
  const enemy = { id: 2, team: 2, alive: true, grounded: true, heading: Math.PI, health: 100, shield: 100, pos: new THREE.Vector3(2, 0, 2) };
  const b = {
    actor, state: 'engage', target: enemy, targetVisible: true, lastSeen: 0, lastSeenX: enemy.pos.x, lastSeenZ: enemy.pos.z,
    thinkIn: 1, reactLeft: 0, trackTime: 0, burstLeft: 0, fireCd: 0, errYaw: 0, errPitch: 0,
    bq: Array.from({ length: 24 }, () => ({ kind: 'wall', x: 0, y: 0, z: 0, h: 0, p: 0 })),
    bqN: 0, bqI: 0, bqNext: 0, builds: 0, reloading: 0, healing: 0, buildCooldown: 0, holdUntil: 0, hurtAt: -99, alertUntil: 0, retreatUntil: -99,
  };
  actor._bot = b;
  return { world, st, bots, b, actor, enemy };
}

function finishQueue(bots, b) {
  for (let i = 0; i < 600 && b.bqI < b.bqN; i++) {
    bots.time += 1 / 60;
    bots._buildStep(b);
  }
}

/** A finished box fight against the enemy to the north, peeks held shut (the walls are the test). */
function boxed(s) {
  const { bots, b, enemy } = s;
  assert.equal(bots._boxFight(b, enemy, 12, true), true, 'boxes up');
  finishQueue(bots, b);
  assert.ok(b.box, 'in a box');
  b.box.peekT = 1e9;
  tick(bots, b); // first look: every wall is up
  return b.box;
}

function tick(bots, b) {
  bots.time += 0.3;
  bots._boxTick(b);
}

function northWall(s) {
  const { st, b } = s;
  const bx = b.box || s.lastBox;
  return st.pieces.find((p) => p.alive && p.kind === 'wall' && Math.abs(p.x - bx.x) < 0.3 && p.z < bx.z - 1);
}

test('the break limit is rolled per box in 2..5 (inclusive), and every value comes up', () => {
  const { bots } = setup();
  for (const r of [0, 0.249, 0.25, 0.5, 0.75, 0.999999]) {
    bots.rng = () => r;
    const n = bots._rollBreakLimit();
    assert.ok(n >= 2 && n <= 5, `rng ${r} -> ${n}`);
  }
  bots.rng = makeRng(11);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const n = bots._rollBreakLimit();
    assert.ok(Number.isInteger(n) && n >= 2 && n <= 5, `${n}`);
    seen.add(n);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
  // a real box rolls one too
  const s = setup();
  const bx = boxed(s);
  assert.ok(bx.breakLimit >= 2 && bx.breakLimit <= 5, `box limit ${bx.breakLimit}`);
});

test('the same wall broken fewer times than the limit: rebuilt every time, box kept', () => {
  const s = setup();
  const { st, bots, b } = s;
  const bx = boxed(s);
  bx.breakLimit = 4;
  for (let i = 1; i <= 3; i++) {
    const w = northWall(s);
    assert.ok(w, `north wall up before break ${i}`);
    st.damage(w, 1e6);
    tick(bots, b);
    assert.equal(b.box, bx, `still boxed after break ${i}`);
    assert.equal(bx.breaks[w.key], i, `counted ${i}`);
    assert.ok(northWall(s) && northWall(s) !== w, `rebuilt after break ${i}`);
    tick(bots, b);
  }
});

test('at the limit with health < 50: no rebuild, out the side AWAY from the breaker and retreat', () => {
  const s = setup('hard', 49);
  const { st, bots, b, actor, enemy } = s;
  const bx = boxed(s);
  bx.breakLimit = 3;
  let key;
  for (let i = 0; i < 3; i++) {
    const w = northWall(s);
    key = w.key;
    st.damage(w, 1e6);
    tick(bots, b);
    if (i < 2) tick(bots, b);
  }
  assert.equal(b.box, null, 'box given up');
  s.lastBox = bx;
  assert.equal(bx.breaks[key], 3);
  assert.ok(!northWall(s), 'the broken wall was not rebuilt');
  assert.equal(b.boxLeft.mode, 'flee');
  assert.equal(b.boxLeft.src, enemy, 'the breaker (the one on that side)');
  assert.ok(b.retreatUntil > bots.time + 2.5 && b.retreatUntil <= bots.time + 4.6, `retreats a few seconds (${(b.retreatUntil - bots.time).toFixed(2)} s)`);
  assert.equal(b.fleeUntil, b.retreatUntil);
  assert.equal(b.boxPush, null, 'no build push');
  assert.equal(b.lastSeenX, enemy.pos.x, 'runs from where the breaker is');
  assert.equal(b.lastSeenZ, enemy.pos.z);
  // the way out is the south wall (away from them, north): a door in it, the exit point beyond
  assert.ok(b.boxExit && b.boxExit.z > bx.z + BUILD.cell / 2, `exit south of the box: ${b.boxExit && b.boxExit.z} vs ${bx.z}`);
  const south = st.pieces.find((p) => p.alive && p.kind === 'wall' && Math.abs(p.x - bx.x) < 0.3 && p.z > bx.z + 1);
  assert.ok(south && south.edit, 'a door edited in the south wall');
  // further hits while running: no new box / wall / tower on them
  const before = st.pieces.length;
  actor.pos.set(bx.x, 0, bx.z + 7);
  bots.notifyDamage(actor, 5, { source: enemy });
  finishQueue(bots, b);
  assert.equal(st.pieces.length, before, 'no hit-build while fleeing');
  assert.equal(b.box, null);
});

test('at the limit with health >= 50: door toward the breaker, then a ramp push at them', () => {
  const s = setup('hard', 50);
  const { st, bots, b, actor, enemy } = s;
  const bx = boxed(s);
  bx.breakLimit = 2;
  for (let i = 0; i < 2; i++) {
    st.damage(northWall(s), 1e6);
    tick(bots, b);
    if (i < 1) tick(bots, b);
  }
  assert.equal(b.box, null, 'box given up');
  assert.equal(b.boxLeft.mode, 'push');
  assert.equal(b.boxPush && b.boxPush.src, enemy, 'push queued at the breaker');
  assert.ok(!(b.retreatUntil > bots.time), 'not retreating');
  assert.ok(b.boxExit && b.boxExit.z < bx.z - BUILD.cell / 2, 'out the north side (toward them, through the gap)');
  // walking out: nothing yet
  assert.equal(bots._boxPushTick(b), false, 'waits until through the door');
  // through it
  actor.pos.set(b.boxExit.x, 0, b.boxExit.z);
  b.boxExit = null;
  const ramps0 = st.pieces.filter((p) => p.kind === 'ramp').length;
  assert.equal(bots._boxPushTick(b), true, 'push starts');
  assert.equal(b.boxPush, null);
  assert.equal(b.bqMode, 'rush');
  assert.ok(b.bqDirZ < -0.9, `built toward them (north): dir ${b.bqDirX}, ${b.bqDirZ}`);
  assert.ok(b.rushUntil > bots.time && b.pushRushUntil === b.rushUntil, 'running up it');
  finishQueue(bots, b);
  const ramps = st.pieces.filter((p) => p.kind === 'ramp');
  assert.ok(ramps.length > ramps0, `ramps went up: ${ramps.length}`);
  assert.ok(ramps.every((p) => p.z < bx.z), 'all of them between the box and the breaker');
});

test('a box that is never broken past the limit is not given up (different walls each once)', () => {
  const s = setup('hard', 60);
  const { st, bots, b } = s;
  const bx = boxed(s);
  bx.breakLimit = 2;
  for (const p of st.pieces.filter((q) => q.alive && q.kind === 'wall' && Math.hypot(q.x - bx.x, q.z - bx.z) < BUILD.cell / 2 + 0.1)) {
    st.damage(p, 1e6);
    tick(bots, b);
    tick(bots, b);
  }
  assert.equal(b.box, bx, 'four different walls broken once each: still boxed');
});

// ---- trap window counter-peek

function trapSetup(name = 'hard') {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = Object.create(Bots.prototype);
  bots.world = world;
  bots.structures = st;
  bots.diff = DIFFICULTY[name];
  bots.diffName = name;
  bots.time = 0;
  bots.rng = () => 0.1;
  const mats = { wood: 500, brick: 0, metal: 0 };
  const actor = {
    team: 1, pos: new THREE.Vector3(2, 0, 10), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health: 100, shield: 100,
    inventory: { mats, spendMats(m, n) { if ((mats[m] || 0) < n) return false; mats[m] -= n; return true; } },
  };
  // trapped, facing the bot (south: heading PI) through the window
  const target = { team: 2, pos: new THREE.Vector3(2, 0, 2), alive: true, grounded: true, heading: Math.PI };
  const b = {
    actor, target, targetVisible: true, bq: Array.from({ length: 16 }, () => ({ kind: 'wall', x: 0, y: 0, z: 0, h: 0, p: 0 })),
    bqN: 0, bqI: 0, bqNext: 0, builds: 0, reloading: 0, reactLeft: 1, trackTime: 0, burstLeft: 0, fireCd: 1, buildCooldown: 0,
  };
  actor._bot = b;
  return { st, bots, b, target, actor };
}

function openTrapWindow(s) {
  const { bots, b, target } = s;
  assert.equal(bots._maybeTrap(b, target, 8), true, 'starts a trap');
  for (let i = 0; i < 4 * 60 && !(b.trap && b.trap.peek === 'open' && b.bqI >= b.bqN); i++) {
    bots.time += 1 / 60;
    if (b.bqI < b.bqN) bots._buildStep(b);
    bots._maybeTrap(b, target, 8);
  }
  assert.equal(b.trap.peek, 'open', 'peeking through the window');
  return b.trap;
}

test('trap: shot through the window by the trapped target -> reset, run round to a different face, window there', () => {
  const s = trapSetup('hard');
  const { st, bots, b, target, actor } = s;
  const tr = openTrapWindow(s);
  const face0 = tr.face;
  const win = st.slots.get(tr.editKey);
  assert.ok(win && win.edit, 'window open');
  bots.notifyDamage(actor, 20, { source: target });
  assert.equal(tr.peek, 'closed', 'edit reset');
  assert.equal(win.edit | 0, 0, 'the window wall is solid again');
  const d = Math.abs(Math.atan2(Math.sin(tr.face - face0), Math.cos(tr.face - face0)));
  assert.ok(d > 1, `a different face (${face0.toFixed(2)} -> ${tr.face.toFixed(2)})`);
  assert.ok(Math.abs(d - Math.PI / 2) < 1e-6, 'an adjacent one: one corner to run round');
  assert.ok(tr.moving && tr.route && tr.route.length === 1, 'running via the corner');
  // the corner waypoint is clear of the trap's walls
  const c = tr.route[0];
  assert.ok(Math.hypot(c.x - tr.x, c.z - tr.z) > (BUILD.cell / 2) * Math.SQRT2 + 0.5, 'corner waypoint outside the corner');
  // no peek on the way; the new face's wall is there to window
  bots.time += 0.5;
  assert.equal(bots._maybeTrap(b, target, 8), true, 'trap still on');
  assert.equal(tr.peek, 'closed', 'no window while moving');
  const nw = bots._trapWall(b, tr.face);
  assert.ok(nw, 'new face wall exists');
  // arrived (the engage case clears tr.moving at the stand point): it windows the new face
  actor.pos.set(tr.x + Math.sin(tr.face) * (BUILD.cell / 2 + 1.3), 0, tr.z - Math.cos(tr.face) * (BUILD.cell / 2 + 1.3));
  tr.moving = false;
  tr.route = null;
  for (let i = 0; i < 2 * 60 && tr.peek !== 'open'; i++) {
    bots.time += 1 / 60;
    bots._maybeTrap(b, target, 8);
  }
  assert.equal(tr.peek, 'open', 'peeks again');
  assert.equal(tr.editKey, nw.key, 'through the new face');
});

test('trap: switches have a cooldown, and a shot from someone outside the trap does not switch', () => {
  const s = trapSetup('hard');
  const { bots, b, target, actor } = s;
  const tr = openTrapWindow(s);
  bots.notifyDamage(actor, 10, { source: target });
  const face1 = tr.face;
  assert.equal(tr.switches, 1);
  // hit again right away (peek forced open again): reset, but no second switch inside the cooldown
  tr.peek = 'open';
  tr.editKey = bots._trapWall(b, tr.face).key;
  bots.time += 0.3;
  bots.notifyDamage(actor, 10, { source: target });
  assert.equal(tr.face, face1, 'same face inside the cooldown');
  assert.equal(tr.switches, 1);
  // a third party outside the trap shooting us mid-peek: plain reset only
  const s2 = trapSetup('hard');
  const tr2 = openTrapWindow(s2);
  const f0 = tr2.face;
  const other = { team: 3, alive: true, pos: new THREE.Vector3(30, 0, 30) };
  s2.bots.notifyDamage(s2.actor, 10, { source: other });
  assert.equal(tr2.peek, 'closed');
  assert.equal(tr2.face, f0, 'no switch for a shot from outside');
  assert.ok(!tr2.moving);
});

test('trap: a stuck move gives up after a couple of seconds and peeks from where it is', () => {
  const s = trapSetup('normal');
  const { bots, b, target, actor } = s;
  const tr = openTrapWindow(s);
  bots.notifyDamage(actor, 10, { source: target });
  assert.ok(tr.moving);
  bots.time += 3;
  bots._maybeTrap(b, target, 8);
  assert.equal(tr.moving, false, 'move given up');
});

// ---- hard: a trap the target breaks out of grows round the cell it went into

/** Builds the trap (bot south at z=10, target in cell (2, 2)) and lets it settle. */
function builtTrap(name) {
  const s = trapSetup(name);
  const { bots, b, target } = s;
  assert.equal(bots._maybeTrap(b, target, 8), true);
  for (let i = 0; i < 90; i++) {
    bots.time += 1 / 60;
    if (b.bqI < b.bqN) bots._buildStep(b);
    bots._maybeTrap(b, target, 8);
  }
  return s;
}

function settle(s, secs = 1.5) {
  const { bots, b, target } = s;
  for (let i = 0; i < secs * 60 && b.trap; i++) {
    bots.time += 1 / 60;
    if (b.bqI < b.bqN) bots._buildStep(b);
    bots._maybeTrap(b, target, 8);
  }
}

/** The target breaks the north wall of the cell centred (cx, cz) and steps through it. */
function breakNorth(s, cx, cz, into = 1.6) {
  const { st, bots, target } = s;
  const w = bots._slotWall(cx, 0, cz, 0);
  assert.ok(w, `north wall of (${cx}, ${cz}) up`);
  st.damage(w, 1e6);
  target.pos.set(cx, 0, cz - BUILD.cell / 2 - into);
}

const wallsOf = (bots, cx, cz) => [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((h) => !!bots._slotWall(cx, 0, cz, h));

test('hard trap: the target breaks out north -> the bot walls the new cell in, joined to the old one', () => {
  const s = builtTrap('hard');
  const { st, bots, b, target } = s;
  const tr = b.trap;
  breakNorth(s, 2, 2);
  assert.equal(bots._maybeTrap(b, target, 8), true, 'still trapping');
  assert.equal(b.trap, tr, 'same trap');
  assert.equal(tr.expands, 1);
  assert.equal(b.bqMode, 'trap', 'walls queued');
  settle(s);
  assert.ok(b.trap, 'trap kept');
  // new cell (2, -2): north, east, west walls; its south side (the broken old north wall) stays open
  const [n, e, so, w] = wallsOf(bots, 2, -2);
  assert.ok(n && e && w, `new cell walled: N ${n} E ${e} W ${w}`);
  assert.equal(so, false, 'joined to the old cell (shared side left open)');
  assert.ok(st.pieces.some((p) => p.alive && p.kind === 'cone' && Math.hypot(p.x - 2, p.z + 2) < 0.1), 'roofed like the first one');
  assert.equal(tr.x, 2);
  assert.equal(tr.z, -2, 'working the cell they are in');
  assert.ok(bots._trapWall(b, tr.face), 'peeking from a walled side of it');
  assert.ok(target.pos.z > -4 && target.pos.z < 0, 'they are boxed again');
});

test('hard trap: a wall broken with the target at it (not out yet) already grows the trap', () => {
  const s = builtTrap('hard');
  const { st, bots, b, target } = s;
  st.damage(bots._slotWall(2, 0, 2, 0), 1e6);
  target.pos.set(2, 0, 0.5); // 0.5 m from the gap, still inside
  bots._maybeTrap(b, target, 8);
  assert.equal(b.trap.expands, 1, 'expanding ahead of them');
  assert.equal(b.trap.x, 2);
  assert.equal(b.trap.z, 2, 'still working their cell');
});

test('normal trap: no expansion, the trap ends when they break out (as before)', () => {
  const s = builtTrap('normal');
  const { bots, b, target } = s;
  breakNorth(s, 2, 2);
  const before = s.st.pieces.filter((p) => p.alive).length;
  assert.equal(bots._maybeTrap(b, target, 8), false);
  assert.equal(b.trap, null);
  assert.equal(b.bqN, 0, 'nothing queued');
  assert.equal(s.st.pieces.filter((p) => p.alive).length, before);
});

test('hard trap: at most 3 expansions, then the trap ends and the fight goes on', () => {
  const s = builtTrap('hard');
  const { bots, b, target } = s;
  const tr = b.trap;
  let cz = 2;
  for (let k = 1; k <= 3; k++) {
    breakNorth(s, 2, cz);
    cz -= BUILD.cell;
    bots._maybeTrap(b, target, 8);
    assert.equal(tr.expands, k, `expansion ${k}`);
    settle(s);
    assert.equal(b.trap, tr, `still trapped after ${k}`);
  }
  breakNorth(s, 2, cz);
  assert.equal(bots._maybeTrap(b, target, 8), false, 'the 4th break-out ends it');
  assert.equal(b.trap, null);
  assert.equal(tr.expands, 3);
});

// ---- no wall spam in our own box while being shot

test('boxed and under fire: no rebuilding, one emergency plug toward the shooter, then a cooldown', () => {
  const s = setup('hard');
  const { st, bots, b, actor, enemy } = s;
  const bx = boxed(s);
  bx.breakLimit = 5;
  const shot = () => bots.notifyDamage(actor, 3, { source: enemy });
  // a side wall (east) broken while they shoot: not rebuilt under fire
  const east = st.pieces.find((p) => p.alive && p.kind === 'wall' && p.x > bx.x + 1);
  st.damage(east, 1e6);
  const before = b.builds;
  for (let i = 0; i < 8; i++) {
    shot();
    tick(bots, b);
  }
  assert.equal(b.builds, before, 'no rebuild while hit');
  assert.ok(!st.pieces.some((p) => p.alive && p.kind === 'wall' && p.x > bx.x + 1), 'east side left open');
  // the side they shoot from opens up: plugged once
  st.damage(northWall(s), 1e6);
  shot();
  tick(bots, b);
  assert.equal(b.builds, before + 1, 'one emergency wall');
  assert.ok(northWall(s), 'toward the shooter');
  assert.ok(bx.buildHold > bots.time + 1.2, 'then a cooldown');
  // broken again straight away while still under fire: not re-plugged inside the cooldown
  st.damage(northWall(s), 1e6);
  for (let i = 0; i < 4; i++) {
    shot();
    tick(bots, b);
  }
  assert.equal(b.builds, before + 1, 'cooldown respected');
  assert.ok(Object.values(bx.breaks).reduce((x, y) => x + y, 0) >= 3, 'breaks still counted');
  // fire stops: after the hold the box is put back together
  for (let i = 0; i < 12; i++) tick(bots, b);
  assert.ok(northWall(s) && st.pieces.some((p) => p.alive && p.kind === 'wall' && p.x > bx.x + 1), 'rebuilt once the shooting stops');
  // and the hits added no walls of their own while boxed
  assert.ok(!b.cover, 'no hit-wall cover');
});

test('full loop: a boxed hard bot shot every 0.25 s with its front wall broken every second places walls on a cooldown and keeps shooting', () => {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = new Bots({ world, structures: st });
  bots.combat = new Combat({ world, structures: st });
  const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: { wood: 500 }, selected: 0 };
  bots.spawn(1, makeRng(5), { difficulty: 'hard', dropPoints: [{ x: 0, z: 0 }], loadout });
  const bot = bots.actors[0];
  const b = bot._bot;
  bot.pos.set(2, world.groundHeight(2, 14, 50), 14);
  Object.assign(bot, { gliding: false, grounded: true, inBus: false });
  b.launchAt = 0;
  b.landedAt = 0;
  const player = { id: 500, team: 500, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 1e9, shield: 0, heading: Math.PI, pos: new THREE.Vector3(2, 0, -2), vel: new THREE.Vector3() };
  for (let i = 0; i < 12; i++) bots.update(1 / 60, { player });
  b.state = 'engage';
  b.target = player;
  b.targetVisible = true;
  b.lastSeen = bots.time;
  assert.equal(bots._boxFight(b, player, 16, true), true);
  for (let i = 0; i < 90; i++) bots.update(1 / 60, { player });
  assert.ok(b.box && b.box.had, 'boxed');
  b.box.breakLimit = 99; // this test is about the rebuilding, not giving the box up
  const builds0 = b.builds;
  const shots0 = b.shots;
  let lastBreak = -9;
  let breaks = 0;
  const at = [];
  let pb = b.builds;
  for (let i = 0; i < 6 * 60; i++) {
    if (i % 15 === 0) bots.notifyDamage(bot, 2, { source: player });
    if (b.box && bots.time - lastBreak > 1) {
      const w = bots._boxWall(b, 0);
      if (w) {
        st.damage(w, 1e6);
        breaks++;
        lastBreak = bots.time;
      }
    }
    bots.update(1 / 60, { player });
    if (b.builds !== pb) {
      at.push(bots.time);
      pb = b.builds;
    }
  }
  assert.ok(b.box, 'still in its box');
  assert.ok(breaks >= 4, `front wall broken ${breaks} times`);
  assert.ok(b.builds - builds0 <= 4, `walls placed in 6 s under fire: ${b.builds - builds0} (one per cooldown at most)`);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 1.7, `placements ${at.map((x) => x.toFixed(2)).join(' ')} at least 1.75 s apart`);
  assert.ok(b.shots - shots0 >= 5, `kept shooting back: ${b.shots - shots0} shots`);
});

// ---- counter-peek: one of the two faces next to the shot one, at random

function switchPicks(s, trials, prep = () => {}) {
  const { bots, b, target, actor } = s;
  const tr = b.trap;
  const face0 = tr.face;
  const fx0 = tr.fx;
  const fz0 = tr.fz;
  const pos0 = actor.pos.clone();
  const picks = {};
  for (let i = 0; i < trials; i++) {
    tr.face = face0;
    tr.fx = fx0;
    tr.fz = fz0;
    tr.switchAt = 0;
    tr.moving = false;
    actor.pos.copy(pos0);
    prep();
    if (!bots._trapSwitch(b, target)) {
      picks.none = (picks.none || 0) + 1;
      continue;
    }
    const fc = bots._faceCell(tr);
    const key = `${fc.x},${fc.z}@${(Math.round(tr.face / (Math.PI / 2)) * 90 + 360) % 360}`;
    picks[key] = (picks[key] || 0) + 1;
  }
  tr.face = face0;
  return picks;
}

test('counter-peek: shot through the south window -> east or west at random (about 50/50), never south or north', () => {
  const s = trapSetup('hard');
  s.bots.rng = makeRng(42);
  openTrapWindow(s);
  assert.ok(Math.abs(Math.abs(s.b.trap.face) - Math.PI) < 1e-6, 'peeking from the south');
  const picks = switchPicks(s, 200);
  const east = picks['2,2@90'] || 0;
  const west = picks['2,2@270'] || 0;
  assert.equal(east + west, 200, `only the two adjacent faces: ${JSON.stringify(picks)}`);
  assert.ok(east > 60 && west > 60, `both come up: east ${east}, west ${west}`);
});

test('counter-peek: one adjacent face gone -> always the other; both gone -> the far side', () => {
  const s = trapSetup('hard');
  s.bots.rng = makeRng(7);
  openTrapWindow(s);
  const { st, bots } = s;
  st.damage(bots._slotWall(2, 0, 2, Math.PI / 2), 1e6); // east wall
  let picks = switchPicks(s, 40);
  assert.deepEqual(picks, { '2,2@270': 40 }, `west only: ${JSON.stringify(picks)}`);
  st.damage(bots._slotWall(2, 0, 2, -Math.PI / 2), 1e6); // west wall too
  picks = switchPicks(s, 10);
  assert.deepEqual(picks, { '2,2@0': 10 }, `north as the fallback: ${JSON.stringify(picks)}`);
});

test('counter-peek on an expanded trap: the faces next to it round the outline (along the wall, or round the corner)', () => {
  const s = builtTrap('hard');
  s.bots.rng = makeRng(3);
  const { bots, b, target, actor } = s;
  breakNorth(s, 2, 2);
  bots._maybeTrap(b, target, 8);
  settle(s);
  const tr = b.trap;
  assert.equal(tr.cells.length, 2);
  // back in the first cell; we peek from its east side
  target.pos.set(2, 0, 2);
  bots._maybeTrap(b, target, 8);
  tr.fx = null;
  tr.fz = null;
  tr.x = 2;
  tr.z = 2;
  tr.face = Math.PI / 2;
  actor.pos.set(2 + BUILD.cell / 2 + 1.3, 0, 2);
  const picks = switchPicks(s, 200);
  // neighbours of (2,2) east: north along the wall = (2,-2) east; south round the corner = (2,2) south
  const along = picks['2,-2@90'] || 0;
  const corner = picks['2,2@180'] || 0;
  assert.equal(along + corner, 200, JSON.stringify(picks));
  assert.ok(along > 60 && corner > 60, `both: along ${along}, corner ${corner}`);
});

// ---- expansion never leaves the bot inside, and it gets back to peeking

test('expansion: a bot standing on the new cell\'s wall line steps clear before it goes up', () => {
  const s = builtTrap('hard');
  const { bots, b, target, actor } = s;
  actor.pos.set(2 + BUILD.cell / 2 + 0.4, 0, -1); // brushing the east wall line of the cell north of the trap
  breakNorth(s, 2, 2);
  bots._maybeTrap(b, target, 8);
  assert.equal(b.trap.expands, 1, 'expands');
  assert.ok(b.boxExit, 'steps clear first');
  assert.ok(b.boxExit.x > 2 + BUILD.cell / 2 + 1, `out east: ${b.boxExit.x}`);
});

test('in the trap with them (pushed / walked in): doors out on the far side, shuts it, peeks again', () => {
  const s = builtTrap('hard');
  const { st, bots, b, target, actor } = s;
  breakNorth(s, 2, 2);
  bots._maybeTrap(b, target, 8);
  settle(s);
  const tr = b.trap;
  actor.pos.set(2, 0, 2.5); // inside the old cell, the target is in the new one to the north
  bots._maybeTrap(b, target, 8);
  assert.ok(b.boxExit, 'walking out');
  const door = st.slots.get(tr.exitKey);
  assert.ok(door && door.edit, 'a door edited');
  assert.ok(door.z > 2 + 1, 'in the south wall (away from them)');
  // out through it
  actor.pos.set(b.boxExit.x, 0, b.boxExit.z);
  b.boxExit = null;
  bots.time += 0.1;
  bots._maybeTrap(b, target, 8);
  assert.equal(door.edit | 0, 0, 'door shut behind it');
  assert.ok(b.trap, 'still trapping');
  // back to work from outside: a window opens on a walled outer face
  let opened = false;
  for (let i = 0; i < 4 * 60 && !opened; i++) {
    bots.time += 1 / 60;
    const tr2 = b.trap;
    if (tr2 && tr2.moving) {
      // (the engage case steers; here: put it at its stand point)
      const fc = bots._faceCell(tr2);
      actor.pos.set(fc.x + Math.sin(tr2.face) * (BUILD.cell / 2 + 1.3), 0, fc.z - Math.cos(tr2.face) * (BUILD.cell / 2 + 1.3));
      tr2.moving = false;
      tr2.route = null;
    }
    bots._maybeTrap(b, target, 8);
    opened = !!(b.trap && b.trap.peek === 'open');
  }
  assert.ok(opened, 'peeking again');
  assert.equal(bots._trapCellAt(b.trap, actor.pos.x, actor.pos.z), -1, 'from outside');
});

test('full loop: after an expansion with the bot pushed in, it gets out and keeps shooting from outside', () => {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const st = new Structures({ scene: new THREE.Scene(), world });
  const bots = new Bots({ world, structures: st });
  bots.combat = new Combat({ world, structures: st });
  const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: { wood: 500 }, selected: 0 };
  bots.spawn(1, makeRng(5), { difficulty: 'hard', dropPoints: [{ x: 0, z: 0 }], loadout });
  const bot = bots.actors[0];
  const b = bot._bot;
  Object.assign(bot, { gliding: false, grounded: true, inBus: false });
  b.launchAt = 0;
  b.landedAt = 0;
  const player = { id: 500, team: 500, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 1e9, shield: 0, heading: 0, pos: new THREE.Vector3(2, 0, 2), vel: new THREE.Vector3() };
  bot.pos.set(5.3, 0, 2);
  for (let i = 0; i < 12; i++) bots.update(1 / 60, { player });
  b.state = 'engage';
  b.target = player;
  b.targetVisible = true;
  b.lastSeen = bots.time;
  b.trapRollAt = 0;
  assert.equal(bots._maybeTrap(b, player, 4, true), true);
  for (let i = 0; i < 120; i++) bots.update(1 / 60, { player });
  st.damage(bots._slotWall(2, 0, 2, 0), 1e6);
  player.pos.set(2, 0, -1.5); // out north
  let pushed = false;
  let inside = 0;
  let shots0 = 0;
  for (let i = 0; i < 8 * 60; i++) {
    bots.update(1 / 60, { player });
    if (!pushed && b.trap && b.trap.expands && b.bqI >= b.bqN) {
      bot.pos.set(2, 0, 1.0); // in there with them
      pushed = true;
      shots0 = b.shots;
    }
    if (pushed && i > 0 && b.trap && b.trap.cells && bots._trapCellAt(b.trap, bot.pos.x, bot.pos.z) >= 0) inside++;
  }
  assert.ok(pushed, 'expanded');
  assert.ok(b.trap, 'still working the trap');
  assert.ok(inside < 90, `out within ~1.5 s (${inside} frames inside)`);
  assert.equal(bots._trapCellAt(b.trap, bot.pos.x, bot.pos.z), -1, 'outside at the end');
  assert.ok(b.shots - shots0 >= 5, `kept shooting: ${b.shots - shots0}`);
});
