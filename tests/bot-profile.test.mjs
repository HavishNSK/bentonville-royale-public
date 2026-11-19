// Box Fights fairness: one shared bot profile (src/core/botProfile.js) drives every arena bot.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Combat } from '../src/game/Combat.js';
import { Bots } from '../src/game/Bots.js';
import { DIFFICULTY } from '../src/core/config.js';
import { BOT_PROFILE, BOT_PROFILES, BOT_DIFFICULTIES, botProfile, profileToDifficulty, boxBotNames, isBoxBotName } from '../src/core/botProfile.js';
import { arenaLayout, spawnLayout, boxLoadout, BOX_LOADOUT_IDS, normalizeBoxLoadout } from '../src/game/BoxFights.js';

const FIELDS = ['difficulty', 'reactionTimeMs', 'aimAccuracy', 'aimJitterDeg', 'buildSpeed', 'editsAllowed', 'loadout', 'pushesWhenEnemyHp', 'caution', 'aggression'];

test('three presets with every profile field; normal is the default; unknown names fall back to it', () => {
  assert.deepEqual([...BOT_DIFFICULTIES], ['easy', 'normal', 'hard']);
  for (const d of BOT_DIFFICULTIES) {
    const p = BOT_PROFILES[d];
    assert.deepEqual(Object.keys(p).sort(), [...FIELDS].sort(), d);
    assert.equal(p.difficulty, d);
    assert.ok(p.aimAccuracy > 0 && p.aimAccuracy < 1);
    assert.ok(p.buildSpeed > 0 && p.reactionTimeMs > 0);
    assert.ok(Object.isFrozen(p));
  }
  assert.equal(BOT_PROFILE, BOT_PROFILES.normal);
  assert.equal(botProfile('hard'), BOT_PROFILES.hard);
  assert.equal(botProfile('__proto__'), BOT_PROFILE);
  assert.equal(botProfile(undefined), BOT_PROFILE);
  // harder presets are strictly better at the things that matter
  assert.ok(BOT_PROFILES.hard.reactionTimeMs < BOT_PROFILES.normal.reactionTimeMs && BOT_PROFILES.normal.reactionTimeMs < BOT_PROFILES.easy.reactionTimeMs);
  assert.ok(BOT_PROFILES.hard.buildSpeed > BOT_PROFILES.normal.buildSpeed && BOT_PROFILES.normal.buildSpeed > BOT_PROFILES.easy.buildSpeed);
});

test('profileToDifficulty maps the profile onto Bots tuning fields', () => {
  const d = profileToDifficulty(BOT_PROFILES.normal);
  assert.equal(d.reaction, 0.55);
  assert.ok(Math.abs(d.buildRate - 1 / 5.5) < 1e-9);
  assert.ok(Math.abs(d.aimError - (2.9 * Math.PI) / 180) < 1e-9);
  assert.equal(d.pushHp, 75);
  assert.equal(d.boxFight, undefined, 'edits allowed: the arena box-fight chance stays');
  const e = profileToDifficulty(BOT_PROFILES.easy);
  assert.equal(e.boxFight, 0);
  assert.equal(e.trap, 0);
});

test('bot names: Bot Alpha, Bot Bravo... and tagged as bots', () => {
  assert.deepEqual(boxBotNames(3), ['Bot Alpha', 'Bot Bravo', 'Bot Charlie']);
  assert.equal(new Set(boxBotNames(12)).size, 12);
  for (const n of boxBotNames(12)) assert.ok(isBoxBotName(n), n);
  assert.ok(!isBoxBotName('BotAlpha') && !isBoxBotName('Shehryar') && !isBoxBotName(null));
});

test('STANDARD loadout: pump shotgun, assault rifle, SMG, 2 shield potions, 500 of each material', () => {
  assert.deepEqual([...BOX_LOADOUT_IDS], ['standard']);
  assert.equal(normalizeBoxLoadout('pump'), 'standard', 'the old kit id still resolves');
  const k = boxLoadout();
  assert.deepEqual(k.items.filter((i) => i.type === 'weapon').map((i) => i.id), ['shotgun', 'rifle', 'smg']);
  const cons = k.items.filter((i) => i.type === 'consumable');
  assert.deepEqual(cons.map((i) => [i.id, i.count]), [['tonic', 2]]);
  assert.deepEqual(k.mats, { wood: 500, brick: 500, metal: 500 });
  for (const d of BOT_DIFFICULTIES) assert.equal(BOT_PROFILES[d].loadout, 'standard');
});

function arena(difficulty, n = 6) {
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] });
  const structures = new Structures({ scene: new THREE.Scene(), world });
  const combat = new Combat({ world, structures });
  const bots = new Bots({ scene: null, world, kits: [], structures, combat });
  const layout = arenaLayout(3);
  bots.setArena(layout);
  const positions = spawnLayout(layout, 3).slice(0, n);
  let s = 7;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const actors = bots.spawn(n, rng, { positions, teams: positions.map((p) => p.side + 1), loadout: boxLoadout(), difficulty, names: boxBotNames(n), idBase: 1 });
  return { bots, actors };
}

test('arena bots on both teams share one profile: same tuning, same personality, same kit', () => {
  for (const difficulty of BOT_DIFFICULTIES) {
    const { bots, actors } = arena(difficulty);
    const want = { ...DIFFICULTY[difficulty], ...profileToDifficulty(BOT_PROFILES[difficulty]) };
    for (const k of ['reaction', 'aimError', 'closeMiss', 'buildRate', 'pushHp']) assert.equal(bots.diff[k], want[k], `${difficulty} ${k}`);
    const p = BOT_PROFILES[difficulty];
    for (const a of actors) {
      assert.equal(a._bot.diffName, difficulty);
      assert.equal(a._bot.caution, p.caution);
      assert.equal(a._bot.aggression, p.aggression);
      assert.deepEqual(a.inventory.slots.filter(Boolean).map((i) => i.id), ['shotgun', 'rifle', 'smg', 'tonic']);
    }
    assert.ok(new Set(actors.map((a) => a.team)).size === 2, 'both teams');
  }
});

test('off the arena, bots keep their rolled personalities and the plain tables', () => {
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] });
  const bots = new Bots({ scene: null, world, kits: [], structures: null, combat: null });
  const actors = bots.spawn(6, Math.random, { positions: Array.from({ length: 6 }, (_, i) => ({ x: i * 5, y: 0, z: 0, heading: 0 })), difficulty: 'hard' });
  assert.equal(bots.diff, DIFFICULTY.hard);
  assert.ok(new Set(actors.map((a) => a._bot.aggression)).size > 1, 'rolled per bot');
});
