// Bots that get shot hold a grudge (no going back to loot while the shooter lives), react on the
// hit frame, and hard bots build a ramp-wall tower and hold its top ramp. Full Bots.update sim.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { DIFFICULTY, WEAPONS, makeRng } from '../src/core/config.js';

function sim(difficulty, { mats = 300 } = {}) {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const structures = new Structures({ scene: new THREE.Scene(), world });
  const bots = new Bots({ world, structures });
  const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: { wood: mats }, selected: 0 };
  bots.spawn(1, makeRng(5), { difficulty, dropPoints: [{ x: 0, z: 0 }], loadout });
  const bot = bots.actors[0];
  const b = bot._bot;
  // already landed, standing at the origin
  bot.pos.set(0, world.groundHeight(0, 0, 50), 0);
  bot.vel.set(0, 0, 0);
  bot.gliding = false;
  bot.grounded = true;
  bot.inBus = false;
  b.launchAt = 0;
  b.state = 'wander';
  bot.botState = 'wander';
  b.landedAt = 0;
  bot.heading = Math.PI; // facing south, away from the shooter
  const player = {
    id: 500, team: 500, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0,
    pos: new THREE.Vector3(0, 0, -34), vel: new THREE.Vector3(),
  };
  player.pos.y = world.groundHeight(player.pos.x, player.pos.z, 50);
  const step = (secs) => {
    for (let i = 0; i < secs * 60; i++) bots.update(1 / 60, { player });
  };
  return { world, structures, bots, bot, b, player, step };
}

test('reaction to a hit, per difficulty: faster than the usual reaction; hard has none', () => {
  const got = {};
  for (const d of ['easy', 'normal', 'hard']) {
    const { bots, bot, b, player, step } = sim(d);
    step(0.1);
    bots.notifyDamage(bot, 10, { source: player });
    got[d] = b.reactLeft;
    assert.equal(b.target, player, `${d}: targets the shooter on the hit frame`);
    assert.ok(b.builds >= 1, `${d}: first piece placed on the hit frame (${b.builds})`);
  }
  assert.equal(got.hard, 0);
  assert.ok(got.normal > 0 && got.normal <= DIFFICULTY.normal.reaction * 0.15, `normal ${got.normal}`);
  assert.ok(got.easy > got.normal && got.easy <= DIFFICULTY.easy.reaction * 0.4, `easy ${got.easy}`);
});

test('a grudge: the bot keeps hunting the shooter after losing sight of it (no going back to loot)', () => {
  const { bots, bot, b, player, step, world } = sim('normal');
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  step(1);
  assert.equal(b.state, 'engage');
  // the shooter vanishes behind a hill far off: out of sight, well past perception memory
  player.pos.set(60, 0, -70);
  player.pos.y = world.groundHeight(60, -70, 50);
  bots._los = () => false;
  const states = new Set();
  for (let i = 0; i < 12 * 60; i++) {
    bots.update(1 / 60, { player });
    states.add(b.state);
  }
  assert.ok(!states.has('loot') && !states.has('wander') && !states.has('rotate'), `states while hunting: ${[...states]}`);
  assert.equal(b.target, player, 'still after the shooter');
  assert.ok(Math.hypot(bot.pos.x - 60, bot.pos.z + 70) < Math.hypot(60, 70) - 15, 'closed in on where it went');
  // the grudge ends when the shooter dies
  player.alive = false;
  step(0.5);
  assert.equal(b.grudge, null);
});

test('hard: shot from range, it builds a ramp-wall tower toward the shooter, climbs it and keeps targeting', () => {
  const { structures, bots, bot, b, player, step } = sim('hard');
  step(0.2);
  const y0 = bot.pos.y;
  bots.notifyDamage(bot, 10, { source: player });
  assert.ok(b.tower, 'a tower is started on the hit');
  assert.ok(b.builds >= 1, 'first piece on the hit frame');
  for (let i = 0; i < 8 * 60; i++) {
    bots.update(1 / 60, { player });
    if (i % 60 === 0) bots.notifyDamage(bot, 3, { source: player }); // still being shot at
  }
  const ramps = structures.pieces.filter((p) => p.alive && p.kind === 'ramp' && p.owner === bot);
  const levels = new Set(ramps.map((p) => Math.round(p.y)));
  assert.ok(ramps.length >= 3 && levels.size >= 3, `ramps ${ramps.length} on ${levels.size} levels`);
  const walls = structures.pieces.filter((p) => p.alive && p.kind === 'wall' && p.owner === bot);
  assert.ok(walls.length >= 3, `walls in front of the ramps: ${walls.length}`);
  assert.ok(walls.every((w) => w.z < 0.5), 'cover faces the shooter (north)');
  assert.ok(bot.pos.y > player.pos.y + 6 && bot.pos.y > y0 + 6, `on top: bot y ${bot.pos.y.toFixed(1)} vs shooter ${player.pos.y.toFixed(1)}`);
  assert.ok(b.tower && b.tower.reached, 'holding the top ramp');
  assert.equal(b.target, player, 'still on the shooter');
  assert.equal(b.state, 'engage');
});

test('hard: a broken tower is rebuilt (takes height again)', () => {
  const { structures, bots, bot, b, player, step } = sim('hard', { mats: 600 });
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  step(6);
  assert.ok(b.tower && b.tower.reached, 'up');
  const first = b.towers;
  // the shooter blows the tower away
  for (const p of [...structures.pieces]) if (p.alive) structures.remove(p);
  step(5);
  assert.ok(b.towers > first, `rebuilt: ${b.towers} towers`);
});

// ---- a busy lobby: other enemies around a tower

function withThird(s, x, z) {
  const third = { id: 600, team: 600, isBot: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0, pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3() };
  third.pos.y = s.world.groundHeight(x, z, 50);
  const actors = [s.bot, s.player, third];
  s.bots.combat = { actors, register() {}, unregister() {}, fireWeapon() {}, swingPickaxe() { return null; } };
  return third;
}

test('hard: a third enemy in plain sight mid-tower does not make it abandon the tower or its shooter', () => {
  const s = sim('hard');
  const { bots, bot, b, player, step } = s;
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  assert.ok(b.tower);
  step(0.15); // mid-build
  const third = withThird(s, 24, -4); // ~24 m east, visible, also a valid target
  // the shooter ducks out of sight for 2 s: perception picks the bystander (the browser case)
  const los = bots._los.bind(bots);
  const hidden = (bx, bz) => Math.abs(bx - player.pos.x) < 0.5 && Math.abs(bz - player.pos.z) < 0.5;
  bots._los = (ax, ay, az, bx, by, bz) => !hidden(bx, bz) && los(ax, ay, az, bx, by, bz);
  let dropped = 0;
  let swapped = 0;
  for (let i = 0; i < 8 * 60; i++) {
    if (i === 120) bots._los = los;
    const had = b.tower;
    bots.update(1 / 60, { player });
    if (had && !b.tower) dropped++;
    if (b.target === third) swapped++;
  }
  assert.equal(dropped, 0, 'tower kept');
  assert.equal(b.towers, 1);
  assert.ok(b.tower && b.tower.reached, 'on top');
  assert.equal(b.target, player, 'still on the shooter, not the bystander');
  assert.ok(third.alive);
  assert.ok(swapped < 20, `frames spent on the bystander: ${swapped}`);
});

test('hard: an enemy that walks up within 10 m ends the tower (fight what is in your face)', () => {
  const s = sim('hard');
  const { bots, bot, b, player, step } = s;
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  step(4);
  assert.ok(b.tower);
  withThird(s, bot.pos.x + 5, bot.pos.z);
  const hidden = (bx, bz) => Math.abs(bx - player.pos.x) < 0.5 && Math.abs(bz - player.pos.z) < 0.5;
  bots._los = (ax, ay, az, bx, by, bz) => !hidden(bx, bz);
  step(1);
  assert.notEqual(b.target, player);
  assert.ok(!b.tower || b.tower.target === player);
});

test('hard: a hit mid-other-build drops that queue and starts the tower; a hit in the air towers on landing', () => {
  const s = sim('hard');
  const { bots, bot, b, player, step } = s;
  step(0.2);
  // a ramp rush toward someone else is going up
  b.bqN = 6;
  b.bqI = 1;
  b.bqMode = 'rush';
  b.bqNext = bots.time + 10;
  bots.notifyDamage(bot, 10, { source: player });
  assert.ok(b.tower, 'tower started over the rush');
  assert.equal(b.bqMode, 'tower');

  const s2 = sim('hard');
  s2.step(0.2);
  s2.bot.grounded = false;
  s2.bots.notifyDamage(s2.bot, 10, { source: s2.player });
  assert.ok(!s2.b.tower && s2.b.towerWant, 'remembered while airborne');
  s2.bot.grounded = true;
  s2.step(0.5);
  assert.ok(s2.b.tower, 'tower after landing');
});
