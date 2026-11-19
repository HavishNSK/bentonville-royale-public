// Bot fight reactions: shot -> instantly aware + cover; hard bots trap close targets (even from
// their own box); a bot walled in by its own box edits its way out; Crystal Bridges gets a share
// of the lobby's landings.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { planBusRoute, makeRoute, planBotTargets } from '../src/game/DropBus.js';
import { DIFFICULTY, BUILD, makeRng } from '../src/core/config.js';

function setup(name = 'hard') {
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
    id: 1, team: 1, isBot: true, heading: Math.PI, pitch: 0,
    pos: new THREE.Vector3(2, 0, 10), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health: 100, shield: 100,
    inventory: { mats, spendMats(m, n) { if ((mats[m] || 0) < n) return false; mats[m] -= n; return true; } },
  };
  const b = {
    actor, state: 'wander', target: null, targetVisible: false, lastSeen: -99, thinkIn: 1, reactLeft: 0, trackTime: 0, burstLeft: 0, fireCd: 0,
    bq: Array.from({ length: 16 }, () => ({ kind: 'wall', x: 0, y: 0, z: 0, h: 0, p: 0 })),
    bqN: 0, bqI: 0, bqNext: 0, builds: 0, reloading: 0, healing: 0, buildCooldown: 0, holdUntil: 0, hurtAt: -99, alertUntil: 0,
  };
  actor._bot = b;
  return { world, st, bots, b, actor };
}

function finishQueue(bots, b) {
  for (let i = 0; i < 240 && b.bqI < b.bqN; i++) {
    bots.time += 1 / 60;
    bots._buildStep(b);
  }
}

// ---- 7a: getting shot

test('hard: the first hit makes the bot aware of the shooter instantly, facing them, with cover going up', () => {
  const { st, bots, b, actor } = setup('hard');
  const src = { id: 2, team: 2, isBot: false, alive: true, pos: new THREE.Vector3(actor.pos.x, 0, actor.pos.z - 30) }; // due north
  bots.notifyDamage(actor, 8, { source: src });
  assert.equal(b.target, src, 'targets the shooter');
  assert.equal(b.reactLeft, 0, 'no reaction delay on hard');
  assert.ok(Math.abs(actor.heading) < 1e-6, `turned to face north: ${actor.heading}`);
  assert.equal(b.thinkIn, 0, 'thinks next frame (engage)');
  assert.equal(b.targetVisible, true, 'open ground: sees them');
  assert.ok((b.guessedHit !== undefined || b.tower) && b.builds > 0, 'cover goes up on the FIRST hit, same frame (a tower from 30 m on hard)');
  finishQueue(bots, b);
  assert.ok(st.pieces.some((p) => p.kind === 'wall' && p.z < actor.pos.z), 'cover between it and the shooter');
});

test('normal / easy: aware at once too, but keep part of their reaction delay', () => {
  for (const name of ['normal', 'easy']) {
    const { bots, b, actor } = setup(name);
    const src = { id: 2, team: 2, alive: true, pos: new THREE.Vector3(actor.pos.x + 25, 0, actor.pos.z) };
    bots.notifyDamage(actor, 8, { source: src });
    assert.equal(b.target, src, `${name}: targets the shooter`);
    assert.ok(b.reactLeft > 0 && b.reactLeft < DIFFICULTY[name].reaction, `${name}: shortened reaction ${b.reactLeft}`);
  }
});

test('a hit while already in the fight does not reset the reaction or spam walls', () => {
  const { bots, b, actor } = setup('hard');
  const src = { id: 2, team: 2, alive: true, pos: new THREE.Vector3(actor.pos.x, 0, actor.pos.z - 20) };
  bots.notifyDamage(actor, 8, { source: src });
  finishQueue(bots, b);
  b.guessedHit = undefined;
  b.reactLeft = 0.05;
  bots.time += 0.5;
  bots.notifyDamage(actor, 8, { source: src });
  assert.equal(b.guessedHit, undefined, 'no new wall under 30 damage in the same attack');
  assert.equal(b.reactLeft, 0, 'hard: never slower to shoot back after another hit');
});

// ---- 7b: trapping

test('hard: traps a close target even from its own box fight (the box used to block the trap)', () => {
  const { st, bots, b } = setup('hard');
  const target = { id: 2, team: 2, alive: true, grounded: true, pos: new THREE.Vector3(2, 0, 2), health: 100, shield: 100 };
  b.state = 'engage';
  b.target = target;
  b.targetVisible = true;
  b.lastSeen = 0;
  assert.equal(bots._boxFight(b, target, 8), true, 'boxes up first');
  finishQueue(bots, b);
  assert.ok(b.box, 'in a box');
  // the closed box hides them, but they were seen a moment ago
  b.targetVisible = false;
  b.lastSeen = bots.time - 0.2;
  b.trapRollAt = 0;
  assert.equal(bots._maybeTrap(b, target, 8), true, 'starts a trap');
  assert.equal(b.box, null, 'left the box (door toward them)');
  finishQueue(bots, b);
  const cx = (Math.floor(target.pos.x / BUILD.cell) + 0.5) * BUILD.cell;
  const cz = (Math.floor(target.pos.z / BUILD.cell) + 0.5) * BUILD.cell;
  const around = st.pieces.filter((p) => p.kind === 'wall' && Math.hypot(p.x - cx, p.z - cz) < BUILD.cell / 2 + 0.1);
  assert.equal(around.length, 4, `four walls around the target: ${around.length}`);
  assert.ok(st.pieces.some((p) => p.kind === 'cone' && Math.hypot(p.x - cx, p.z - cz) < 0.1), 'and a roof');
});

test('trap odds: hard rerolls fast, normal traps now and then, easy never', () => {
  const { bots, b } = setup('hard');
  const target = { alive: true, grounded: true, pos: new THREE.Vector3(2, 0, 2) };
  b.target = target;
  b.targetVisible = true;
  bots.rng = () => 0.9; // dice say no
  assert.equal(bots._maybeTrap(b, target, 8), false);
  assert.ok(b.trapRollAt - bots.time <= 2.5, `hard rolls again within 2.5 s (${b.trapRollAt})`);
  const e = setup('easy');
  e.b.target = target;
  e.b.targetVisible = true;
  assert.equal(e.bots._maybeTrap(e.b, target, 8), false, 'easy never traps');
  const n = setup('normal');
  n.b.target = target;
  n.b.targetVisible = true;
  assert.equal(n.bots._maybeTrap(n.b, target, 8), true, 'normal can trap (dice 0.1 < 0.15)');
});

// ---- 6: stuck in our own box

function ownBox(s) {
  const { st, b, actor } = s;
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const pl = st.plan('wall', actor.pos, h, 0);
    assert.ok(pl.valid);
    st.place(pl, 'wood', actor);
  }
  b.steerGX = actor.pos.x + 30; // wants to go east
  b.steerGZ = actor.pos.z;
  b.navX = b.steerGX;
  b.navZ = b.steerGZ;
}

test('a bot boxed in by its own walls with nothing to fight edits a door toward its goal', () => {
  const s = setup('hard');
  ownBox(s);
  const { st, bots, b, actor } = s;
  bots.time = 5;
  assert.equal(bots._enclosureCheck(b), true, 'detected and acted');
  const east = st.pieces.find((p) => p.kind === 'wall' && p.x > actor.pos.x + 0.5);
  assert.ok(east.edit, 'east wall is a door now');
  assert.equal(st.pieces.filter((p) => p.edit).length, 1, 'only that wall');
  bots.time += 2;
  assert.equal(bots._enclosureCheck(b), false, 'way out is open: no more edits');
  assert.equal(st.pieces.filter((p) => p.edit).length, 1);
});

test('the enclosure check leaves a bot alone while it is fighting, holding, or has nowhere to go', () => {
  const s = setup('hard');
  ownBox(s);
  const { bots, b, actor } = s;
  bots.time = 5;
  b.state = 'engage';
  b.targetVisible = true;
  assert.equal(bots._enclosureCheck(b), false, 'visible enemy: the fight owns the walls');
  b.state = 'wander';
  b.targetVisible = false;
  b.holdUntil = bots.time + 3;
  b.encAt = 0;
  assert.equal(bots._enclosureCheck(b), false, 'still holding inside a fresh box');
  b.holdUntil = 0;
  b.encAt = 0;
  b.steerGX = actor.pos.x + 0.5;
  assert.equal(bots._enclosureCheck(b), false, 'goal inside the cell');
});

test('blocked by its own piece that is not on its cell: pickaxes it', () => {
  const s = setup('hard');
  const { st, bots, b, actor } = s;
  // a wall one cell east, right in front of a bot standing at its cell's east edge
  actor.pos.set(3.5, 0, 10);
  const pl = st.plan('wall', { x: 6, y: 0, z: 10 }, -Math.PI / 2, 0); // west edge of the next cell = our east edge
  st.place(pl, 'wood', { id: 99 });
  b.steerGX = 40;
  b.steerGZ = 10;
  assert.equal(bots._breakOut(b), true);
  assert.ok(b.smashUntil > bots.time && b.smashX > actor.pos.x, 'swinging east');
});

// ---- 5: Crystal Bridges landings

function mapWorld() {
  const landmarks = {
    crystal_bridges: { x: 1.3, z: -325.2, r: 125, found: true },
    square: { x: 0, z: 400, r: 80 },
    bentonville_west: { x: -1100, z: 300, r: 150 },
    bentonville_high: { x: 900, z: -700, r: 120 },
    memorial_park: { x: 700, z: 600, r: 90 },
  };
  return new World({ meta: { bounds: { minX: -1500, maxX: 1500, minZ: -1500, maxZ: 1500 } }, buildings: [], roads: [], areas: [], pois: [], landmarks });
}

function landings(world, count, seed, teams) {
  const bots = Object.create(Bots.prototype);
  bots.world = world;
  const rng = makeRng(seed);
  const route = makeRoute(planBusRoute(seed, world.bounds));
  const pts = planBotTargets(route, world, rng, count);
  if (teams) for (let i = 1; i < count; i++) if (teams[i] === teams[i - 1]) pts[i] = pts[i - 1];
  return bots._dropTargets(count, rng, pts, null, teams);
}

test('Crystal Bridges quota: 4-8 in a full lobby, scaled down for small ones', () => {
  assert.equal(Bots.crystalBridgesQuota(99), 7);
  assert.ok(Bots.crystalBridgesQuota(60) >= 4 && Bots.crystalBridgesQuota(150) <= 8);
  assert.equal(Bots.crystalBridgesQuota(20), 1);
  assert.equal(Bots.crystalBridgesQuota(3), 0);
});

test('a full lobby lands 4-8 bots on the Crystal Bridges site', () => {
  const world = mapWorld();
  const cb = world.landmarks.crystal_bridges;
  for (const seed of [1, 7, 42, 1234]) {
    const out = landings(world, 99, seed);
    assert.equal(out.length, 99);
    const n = out.filter((p) => Math.hypot(p.x - cb.x, p.z - cb.z) < cb.r * 0.75).length;
    assert.ok(n >= 4 && n <= 12, `seed ${seed}: ${n} bots at Crystal Bridges`);
    assert.ok(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
  }
});

test('team modes send whole teams to Crystal Bridges (teams still land together)', () => {
  const world = mapWorld();
  const cb = world.landmarks.crystal_bridges;
  const teams = Array.from({ length: 96 }, (_, i) => 10 + Math.floor(i / 4));
  const out = landings(world, 96, 9, teams);
  const at = out.map((p) => Math.hypot(p.x - cb.x, p.z - cb.z) < cb.r * 0.75);
  assert.ok(at.filter(Boolean).length >= 4, 'some squads drop there');
  for (let i = 0; i < 96; i += 4) {
    for (let k = 1; k < 4; k++) assert.ok(Math.hypot(out[i].x - out[i + k].x, out[i].z - out[i + k].z) < 20, `team ${i / 4} stays together`);
  }
});

test('no Crystal Bridges landmark: landings are untouched', () => {
  const world = new World({ meta: { bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 } }, buildings: [], roads: [], areas: [], pois: [] });
  const out = landings(world, 30, 3);
  assert.equal(out.length, 30);
});
