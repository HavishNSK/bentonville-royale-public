// Box Fights host migration: the client-view -> host-state conversions (src/net/hostTakeover.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actorRow, takeoverPlan, takeoverRoundState, sanitizeReportedInventory, difficultyFromBotElo, cleanMigrationEvent, MIGRATION_INV_WINDOW,
} from '../src/net/hostTakeover.js';
import { BOX_FIGHT, boxLoadout } from '../src/game/BoxFights.js';

const pup = (o) => ({ pos: { x: 1, y: 300, z: 2 }, heading: 0.5, alive: true, health: 80, shield: 40, kills: 0, team: 0, ...o });

// 2v2: old host 0 (team 0) + guest 2 (us, team 0) vs guest 3 (team 1) + bot 4 (team 1); 5 replaced a leaver earlier
const actors = [
  actorRow(pup({ id: 0, name: 'Hosty', human: true, team: 0, kills: 3, damageDealt: 412.4, buildsPlaced: 17, boxElo: 1300, skin: 'scruff' })),
  actorRow(pup({ id: 3, name: 'Guesty', human: true, team: 1, kills: 1, damageDealt: 90, buildsPlaced: 4, boxElo: 1100 })),
  actorRow(pup({ id: 4, name: 'Bot Alpha', human: false, team: 1, alive: false, health: 0, shield: 0, kills: 2 })),
  actorRow(pup({ id: 5, name: 'Bot Bravo', human: false, team: 1 })),
];
const guests = [{ id: 3, name: 'Guesty', token: 'ggg' }];

test('actorRow: plain numbers, clamped, stats and Elo carried', () => {
  const r = actorRow(pup({ id: 7, name: 'A<b>\u0001', human: true, health: 1e9, kills: -2, damageDealt: 12.6, buildsPlaced: 3 }));
  assert.equal(r.name, 'Ab');
  assert.equal(r.health, 1000);
  assert.equal(r.kills, 0);
  assert.equal(r.damage, 13);
  assert.equal(r.builds, 3);
  assert.equal(r.human, true);
  assert.deepEqual([r.x, r.y, r.z, r.heading], [1, 300, 2, 0.5]);
  assert.equal(actorRow({ id: 1, name: 'x', pos: { x: NaN } }).x, 0);
});

test('takeoverPlan: connected humans stay remote, bots stay bots, the old host becomes a bot', () => {
  const plan = takeoverPlan({ myId: 2, myName: 'Me', actors, guests, replaced: new Map([[5, 'Quitter']]) });
  assert.deepEqual(plan.remotes.map((r) => r.id), [3]);
  assert.deepEqual(plan.bots.map((b) => b.id), [0, 4, 5]);
  const old = plan.bots.find((b) => b.id === 0);
  assert.equal(old.human, false);
  assert.equal(old.replaced, 'Hosty');
  assert.match(old.name, /^Bot /);
  assert.notEqual(old.name, 'Bot Alpha'); // never a name already in the match
  assert.notEqual(old.name, 'Bot Bravo');
  // stats row continuity: same id, team, kills, damage, builds
  assert.deepEqual([old.team, old.kills, old.damage, old.builds], [0, 3, 412, 17]);
  assert.equal(old.boxElo, undefined); // a bot has no reported Elo
  assert.deepEqual(plan.left, [{ id: 0, name: old.name, was: 'Hosty' }]);
  // earlier replacement keeps its note; dead bot stays dead
  assert.equal(plan.bots.find((b) => b.id === 5).replaced, 'Quitter');
  const dead = plan.bots.find((b) => b.id === 4);
  assert.equal(dead.alive, false);
  assert.equal(dead.replaced, null);
});

test('takeoverPlan: a human missing from the relay roster is replaced too; our own row is skipped', () => {
  const plan = takeoverPlan({ myId: 3, actors: [...actors, actorRow(pup({ id: 3, name: 'Me' }))], guests: [] });
  assert.deepEqual(plan.remotes, []);
  assert.deepEqual(plan.bots.map((b) => b.id), [0, 4, 5]);
  assert.ok(!plan.bots.some((b) => b.id === 3));
});

test('takeoverRoundState: phases map onto the round machine', () => {
  const common = { round: 3, score: [2, 1], elims: [4, 3], winRounds: 5, ffa: false, sides: 2 };
  const warm = takeoverRoundState({ ...common, phase: 'warmup', t: 2.5 });
  assert.deepEqual([warm.phase, warm.t, warm.round, warm.winRounds], ['warmup', 2.5, 3, 5]);
  assert.deepEqual(warm.score, [2, 1]);
  assert.equal(takeoverRoundState({ ...common, phase: 'warmup', t: -1 }).t, 0); // fights at once
  const fight = takeoverRoundState({ ...common, phase: 'fight', killsBySide: [6, 1] });
  assert.deepEqual([fight.phase, fight.t], ['fight', 0]);
  assert.deepEqual(fight.elims, [6, 3]); // a kill since the last round event still counts, never twice
  const re = takeoverRoundState({ ...common, phase: 'roundEnd', sinceRoundEnd: 1 });
  assert.equal(re.phase, 'roundEnd');
  assert.equal(re.t, BOX_FIGHT.roundEndDelay - 1);
  assert.equal(takeoverRoundState({ ...common, phase: 'roundEnd', sinceRoundEnd: 99 }).t, 0.5);
  const over = takeoverRoundState({ ...common, phase: 'over', t: 1 });
  assert.deepEqual([over.phase, over.t], ['matchEnd', 1]);
});

test('takeoverRoundState: FFA keeps its sides, round cap and elim target', () => {
  const s = takeoverRoundState({ phase: 'fight', round: 4, score: [1, 0, 2, 0], elims: [3, 1, 5, 0], ffa: true, sides: 4 });
  assert.equal(s.ffa, true);
  assert.equal(s.score.length, 4);
  assert.equal(s.maxRounds, BOX_FIGHT.ffa.rounds);
  assert.equal(s.elimTarget, BOX_FIGHT.ffa.elimTarget);
  assert.deepEqual(s.elims, [3, 1, 5, 0]);
});

test('sanitizeReportedInventory: only the kit, once each, clamped', () => {
  const kit = boxLoadout();
  const out = sanitizeReportedInventory(
    {
      s: [
        { type: 'weapon', id: 'shotgun', rarity: 'legendary', mag: 999 },
        { type: 'weapon', id: 'shotgun', rarity: 'epic', mag: 2 }, // duplicate
        { type: 'weapon', id: 'rocket', rarity: 'legendary', mag: 1 }, // not in the kit
        { type: 'consumable', id: 'tonic', count: 50 },
        null,
        { type: 'weapon', id: 'rifle', mag: 3 }, // 6th slot: ignored
      ],
      ammo: { shells: 9999, medium: 12, rockets: 50 },
      mats: { wood: 9999, brick: -5, metal: 120 },
    },
    kit
  );
  assert.equal(out.slots.length, 5);
  assert.equal(out.slots[0].id, 'shotgun');
  assert.equal(out.slots[0].rarity, 'epic'); // the kit's rarity, not the claim
  assert.ok(out.slots[0].mag > 0 && out.slots[0].mag < 999);
  assert.equal(out.slots[1], null);
  assert.equal(out.slots[2], null);
  assert.deepEqual(out.slots[3], { type: 'consumable', id: 'tonic', count: 2 });
  assert.equal(out.ammo.shells, kit.ammo.shells);
  assert.equal(out.ammo.medium, 12);
  assert.equal(out.ammo.rockets, undefined);
  assert.deepEqual(out.mats, { wood: 500, brick: 0, metal: 120 });
  assert.equal(sanitizeReportedInventory(null, kit), null);
  assert.equal(sanitizeReportedInventory('x', kit), null);
  assert.ok(MIGRATION_INV_WINDOW > 0);
});

test('difficultyFromBotElo: nearest preset, normal by default', () => {
  assert.equal(difficultyFromBotElo(800), 'easy');
  assert.equal(difficultyFromBotElo(1600), 'hard');
  assert.equal(difficultyFromBotElo(1190), 'normal');
  assert.equal(difficultyFromBotElo(undefined), 'normal');
});

test('cleanMigrationEvent: clamps the new host resync', () => {
  const e = cleanMigrationEvent({ e: 'hm', rn: 500, sc: [1, 'x', 3], el: [2, 2000], ph: 'nope', t: 50, bx: [[1], [2]] }, 2);
  assert.deepEqual(e, { round: 99, score: [1, 0], elims: [2, 999], phase: 'fight', t: 10, rows: [[1], [2]] });
  assert.equal(cleanMigrationEvent(null), null);
  assert.equal(cleanMigrationEvent({ ph: 'warmup' }, 4).score.length, 4);
});
