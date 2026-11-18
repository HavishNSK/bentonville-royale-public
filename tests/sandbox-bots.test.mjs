// Sandbox BOTS: spawn Easy / Normal / Hard bots near the player (each keeps its own
// difficulty), capped, clearable, sandbox-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { DIFFICULTY, makeRng } from '../src/core/config.js';
import {
  SANDBOX_BOT_CAP, SANDBOX_BOT_DIST, SANDBOX_BOT_TEAM, canSandboxBots, sandboxBotStatus, spawnSandboxBot, clearSandboxBots, purgeSandboxBodies, sandboxBotLoadout,
} from '../src/game/sandboxLoadout.js';

function sandbox(over = {}) {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const structures = new Structures({ scene: new THREE.Scene(), world });
  const bots = new Bots({ world, structures });
  bots.spawn(0, makeRng(1), { difficulty: 'normal' }); // what a free-build startMatch does
  const player = {
    id: 0, team: 0, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0, heading: 0,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(),
  };
  const game = { freeBuild: true, museumMode: false, state: 'play', net: null, bots, world, player, rng: makeRng(2), ...over };
  return { game, bots, world, structures, player };
}

test('spawning is sandbox-only: not in a match, not in Museum Mode, not with a net session', () => {
  assert.equal(canSandboxBots(sandbox().game), true);
  for (const over of [{ freeBuild: false }, { museumMode: true }, { net: { isHost: false } }, { state: 'drop' }]) {
    const { game, bots } = sandbox(over);
    const r = spawnSandboxBot(game, 'hard');
    assert.equal(r.bot, null, JSON.stringify(Object.keys(over)));
    assert.ok(r.reason);
    assert.equal(bots.list.length, 0);
  }
  assert.equal(spawnSandboxBot(sandbox().game, 'insane').bot, null, 'unknown difficulty');
});

test('a spawned bot stands on open ground 25 m (+-1) in front of the player, armed, on the sandbox team', () => {
  const { game, player } = sandbox();
  const { bot } = spawnSandboxBot(game, 'normal');
  assert.ok(bot && bot.alive && bot.sandbox && bot.isBot);
  const d = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
  assert.ok(d >= SANDBOX_BOT_DIST - 1 - 1e-6 && d <= SANDBOX_BOT_DIST + 1 + 1e-6, `distance ${d}`);
  assert.ok(bot.pos.z < 0, 'in front (heading 0 = north = -z)');
  assert.equal(bot.team, SANDBOX_BOT_TEAM);
  assert.equal(bot._bot.state, 'wander');
  assert.equal(bot.gliding, false);
  const cur = bot.inventory.current();
  assert.ok(cur && cur.type === 'weapon', 'gun in hand');
  assert.ok(bot.inventory.mats.wood > 0);
  assert.equal(bot.damageScale, DIFFICULTY.normal.damageScale);
  assert.equal(sandboxBotLoadout('easy').items.length, 2, 'easy: rifle + medkit');
});

test(`the cap: at most ${SANDBOX_BOT_CAP} live sandbox bots; dead ones free their slot`, () => {
  const { game, bots } = sandbox();
  for (let i = 0; i < SANDBOX_BOT_CAP; i++) assert.ok(spawnSandboxBot(game, ['easy', 'normal', 'hard'][i % 3]).bot, `bot ${i}`);
  let st = sandboxBotStatus(game);
  assert.equal(st.count, SANDBOX_BOT_CAP);
  assert.equal(st.canSpawn, false);
  assert.match(st.reason, /limit/i);
  const r = spawnSandboxBot(game, 'hard');
  assert.equal(r.bot, null);
  assert.equal(bots.list.length, SANDBOX_BOT_CAP);
  // one dies: its slot is free again, and its body goes when the next one comes in
  bots.list[0].alive = false;
  st = sandboxBotStatus(game);
  assert.equal(st.canSpawn, true);
  assert.equal(st.bodies, 1);
  assert.ok(spawnSandboxBot(game, 'easy').bot);
  assert.equal(bots.list.length, SANDBOX_BOT_CAP, 'body removed, new bot in');
});

test('clear removes every sandbox bot (alive and dead) and leaves match bots alone', () => {
  const { game, bots, world } = sandbox();
  bots.addBot('normal', 30, 30, { sandbox: false }); // not a sandbox bot
  for (let i = 0; i < 4; i++) spawnSandboxBot(game, 'hard');
  bots.list.find((a) => a.sandbox).alive = false;
  assert.equal(clearSandboxBots(game), 4);
  assert.equal(bots.list.length, 1);
  assert.equal(bots.brains.length, 1);
  assert.equal(bots.list[0].sandbox, false);
  assert.ok(world);
});

test('bodies are purged after a few seconds', () => {
  const { game, bots } = sandbox();
  const { bot } = spawnSandboxBot(game, 'easy');
  bot.alive = false;
  bots.update(1 / 60, { player: game.player });
  assert.equal(purgeSandboxBodies(game), 0, 'fresh body stays');
  bot._bot.deadTime = 10;
  assert.equal(purgeSandboxBodies(game), 1);
  assert.equal(bots.list.length, 0);
});

test('per-bot difficulty: easy, normal and hard bots coexist and each acts on its own', () => {
  const { game, bots, player, structures } = sandbox();
  player.pos.set(0, 0, -40);
  const mk = (d, x) => bots.addBot(d, x, 0, { loadout: sandboxBotLoadout(d), team: SANDBOX_BOT_TEAM });
  const easy = mk('easy', -20);
  const normal = mk('normal', 0);
  const hard = mk('hard', 20);
  for (let i = 0; i < 6; i++) bots.update(1 / 60, { player });
  assert.equal(bots.diffName, 'normal', 'the match difficulty is restored after the update');
  for (const a of [easy, normal, hard]) bots.notifyDamage(a, 10, { source: player });
  assert.equal(bots.diffName, 'normal', 'and after a hit');
  assert.equal(hard._bot.reactLeft, 0, 'hard: no delay');
  assert.ok(normal._bot.reactLeft > 0 && normal._bot.reactLeft < DIFFICULTY.normal.reaction * 0.2);
  assert.ok(easy._bot.reactLeft > normal._bot.reactLeft, 'easy slower than normal');
  for (let i = 0; i < 60; i++) bots.update(1 / 60, { player }); // (a strafe hop: it towers on landing)
  assert.ok(hard._bot.tower, 'only the hard bot towers');
  assert.ok(!easy._bot.tower && !normal._bot.tower);
  for (let i = 0; i < 4 * 60; i++) bots.update(1 / 60, { player });
  assert.ok(hard._bot.tower && hard._bot.tower.reached, 'hard bot on its tower');
  assert.ok(structures.pieces.some((p) => p.owner === hard && p.kind === 'ramp'));
  assert.ok(!structures.pieces.some((p) => p.owner === easy && p.kind === 'ramp'), 'easy built no ramps');
  assert.equal(easy.damageScale, DIFFICULTY.easy.damageScale);
  assert.equal(hard.damageScale, DIFFICULTY.hard.damageScale);
  // sandbox bots share a team: they hunt the player, not each other
  for (const a of [easy, normal, hard]) assert.ok(!a._bot.target || a._bot.target === player);
  assert.ok(game);
});

test('a respawned bot keeps its own difficulty', () => {
  const { bots } = sandbox();
  const hard = bots.addBot('hard', 10, 10, {});
  hard.alive = false;
  bots.respawn(hard, 12, 0, 12);
  assert.equal(hard._bot.diffName, 'hard');
});
