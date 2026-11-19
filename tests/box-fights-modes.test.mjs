// Box Fights modes overhaul: 1v1 / 2v2 / 3v3 / FFA, N-side round machine, FFA win conditions,
// match config validation, FFA spawn ring, leaver replacement (src/game/BoxFights.js, GameModes.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOX_FIGHT, BOX_FIGHT_MODES, boxModeId, boxMatchConfig, normalizeWinRounds, normalizeFfaPlayers, arenaKey,
  arenaLayout, ffaSpawnLayout, spawnBoxPieces, createBoxFightState, stepBoxFight, boxElim, boxStandings, ffaWinner,
  roundBanner, boxResultCopy, sideOfTeam, boxReplacement,
} from '../src/game/BoxFights.js';
import * as G from '../src/game/GameModes.js';
import { TEAM_MODES } from '../src/game/Teams.js';

const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };

test('modes: 1v1 / 2v2 / 3v3 / FFA; no 4v4 in Box Fights, squad still a battle royale mode', () => {
  assert.deepEqual([...BOX_FIGHT_MODES], ['solo', 'duo', 'trio', 'ffa']);
  assert.deepEqual([...G.BOX_MODES], ['solo', 'duo', 'trio', 'ffa']);
  assert.equal(G.validGameMode('boxfights', 'squad'), false);
  assert.equal(G.validGameMode('br', 'squad'), true);
  assert.equal(G.validGameMode('br', 'ffa'), false);
  assert.equal(TEAM_MODES.squad, 4, 'BR squads untouched');
  assert.equal(boxModeId('ffa'), 'ffa');
  assert.deepEqual(['1v1', '2v2', '3v3'].map(boxModeId), ['solo', 'duo', 'trio'], 'lobby ids');
  assert.equal(boxMatchConfig({ mode: '3v3' }).mode, 'trio');
  for (const bad of ['squad', '__proto__', 'FFA', null, 4]) assert.equal(boxModeId(bad), null);
  assert.equal(G.queueName('boxfights', 'squad'), null);
  assert.equal(G.queueName('boxfights', 'ffa'), 'bf-ffa');
  assert.deepEqual(G.parseQueue('bf-ffa'), { game: 'boxfights', mode: 'ffa' });
  assert.equal(G.parseQueue('bf-squad'), null);
  assert.equal(G.parseQueue('ffa'), null);
});

test('winRounds validation: integers 1..9, default 5', () => {
  assert.equal(normalizeWinRounds(undefined), 5);
  for (const n of [1, 3, 5, 9]) assert.equal(normalizeWinRounds(n), n);
  assert.equal(normalizeWinRounds('7'), 7);
  for (const bad of [0, 10, -1, 2.5, NaN, Infinity, '', 'x', null, {}, [], '1e1']) assert.equal(normalizeWinRounds(bad), 5, String(bad));
});

test('ffaPlayers validation: integers 2..6, default 6', () => {
  assert.equal(normalizeFfaPlayers(undefined), 6);
  for (const n of [2, 3, 4, 5, 6]) assert.equal(normalizeFfaPlayers(n), n);
  for (const bad of [0, 1, 7, 8, 3.5, NaN, 'x', null]) assert.equal(normalizeFfaPlayers(bad), 6, String(bad));
});

test('boxMatchConfig: validated match options', () => {
  assert.deepEqual(boxMatchConfig(), { mode: 'solo', ffa: false, teamSize: 1, sides: 2, slots: 2, winRounds: 5, botDifficulty: null, fill: true });
  assert.deepEqual(boxMatchConfig({ mode: 'trio', winRounds: 7, botDifficulty: 'hard' }), { mode: 'trio', ffa: false, teamSize: 3, sides: 2, slots: 6, winRounds: 7, botDifficulty: 'hard', fill: true });
  assert.deepEqual(boxMatchConfig({ mode: 'ffa', ffaPlayers: 4 }), { mode: 'ffa', ffa: true, teamSize: 1, sides: 4, slots: 4, winRounds: 5, botDifficulty: null, fill: true });
  assert.equal(boxMatchConfig({ mode: 'ffa' }).slots, 6);
  assert.equal(boxMatchConfig({ size: 2 }).mode, 'duo', 'legacy { size }');
  assert.equal(boxMatchConfig({ size: 4 }).mode, 'solo', 'no 4v4');
  assert.equal(boxMatchConfig({ mode: 'squad' }).mode, 'solo');
  assert.equal(boxMatchConfig({ mode: 'duo', botDifficulty: '__proto__' }).botDifficulty, null);
  assert.equal(boxMatchConfig({ mode: 'duo', fill: false }).fill, false);
  assert.equal(boxMatchConfig(null).mode, 'solo');
  for (const m of BOX_FIGHT_MODES) assert.ok(boxMatchConfig({ mode: m }).slots <= 6, 'max 6 per match');
  assert.deepEqual(['solo', 'duo', 'trio', 'ffa', 'x'].map(arenaKey), [1, 2, 3, 'ffa', 1]);
});

for (const n of [2, 3, 4, 5, 6]) {
  test(`ffaSpawnLayout(${n}): one box per player round the edge, inside, no overlaps, one empty cell between`, () => {
    const L = arenaLayout('ffa');
    const N = L.cells;
    const sp = ffaSpawnLayout(L, n);
    assert.equal(sp.length, n);
    assert.deepEqual(sp.map((s) => s.side), [...Array(n).keys()]);
    for (const s of sp) {
      assert.ok(s.cell.i >= 1 && s.cell.i <= N - 2 && s.cell.j >= 1 && s.cell.j <= N - 2, 'inside, one cell in from the wall');
      assert.ok(s.cell.i === 1 || s.cell.i === N - 2 || s.cell.j === 1 || s.cell.j === N - 2, 'on the edge ring');
      assert.equal(s.y, L.floorY);
      // the whole box (cell footprint) is inside the arena
      assert.ok(s.x - 2 >= L.rect.minX && s.x + 2 <= L.rect.maxX && s.z - 2 >= L.rect.minZ && s.z + 2 <= L.rect.maxZ);
      // faces the centre: forward = (sin h, -cos h)
      const fx = Math.sin(s.heading);
      const fz = -Math.cos(s.heading);
      assert.ok(fx * (L.center.x - s.x) + fz * (L.center.z - s.z) > 0);
      for (const p of spawnBoxPieces(s, L.floorY)) {
        assert.ok(p.x >= L.rect.minX && p.x <= L.rect.maxX && p.z >= L.rect.minZ && p.z <= L.rect.maxZ);
        assert.ok(p.y + 3 <= L.ceilY, 'roof under the ceiling');
      }
    }
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      assert.ok(Math.max(Math.abs(sp[a].cell.i - sp[b].cell.i), Math.abs(sp[a].cell.j - sp[b].cell.j)) >= 2, `boxes ${a} and ${b} too close`);
    }
  });
}

test('ffaSpawnLayout clamps the player count', () => {
  assert.equal(ffaSpawnLayout(arenaLayout('ffa'), 99).length, 6);
  assert.equal(ffaSpawnLayout(arenaLayout('ffa'), 1).length, 6);
});

const fight = (over = {}) => ({ ...createBoxFightState(over), phase: 'fight', t: 0, ...over });

test('createBoxFightState: FFA has one side per player, 10 rounds, 15 elims', () => {
  const s = createBoxFightState({ ffa: true, sides: 4 });
  assert.deepEqual(s.score, [0, 0, 0, 0]);
  assert.deepEqual(s.elims, [0, 0, 0, 0]);
  assert.equal(s.ffa, true);
  assert.equal(s.maxRounds, 10);
  assert.equal(s.elimTarget, 15);
  assert.equal(createBoxFightState({ winRounds: 42 }).winRounds, 5, 'invalid winRounds -> default');
  assert.equal(createBoxFightState({ winRounds: 9 }).winRounds, 9);
});

test('N sides: the round ends when one side is left; it scores', () => {
  let r = stepBoxFight(deepFreeze(fight({ ffa: true, sides: 4 })), 0.1, [1, 1, 0, 0]);
  assert.equal(r.state.phase, 'fight');
  assert.deepEqual(r.events, []);
  r = stepBoxFight(r.state, 0.1, [0, 1, 0, 0]);
  assert.equal(r.state.phase, 'roundEnd');
  assert.deepEqual(r.state.score, [0, 1, 0, 0]);
  assert.deepEqual(r.events, [{ type: 'roundEnd', round: 1, winnerSide: 1, score: [0, 1, 0, 0] }]);
});

test('N sides: everyone down at once is a draw; the round still advances', () => {
  let r = stepBoxFight(deepFreeze(fight({ ffa: true, sides: 3 })), 0.1, [0, 0, 0]);
  assert.equal(r.events[0].winnerSide, null);
  assert.deepEqual(r.state.score, [0, 0, 0]);
  r = stepBoxFight(r.state, 5, [0, 0, 0]);
  assert.equal(r.state.round, 2);
  assert.equal(r.state.phase, 'warmup');
});

test('team mode: first to winRounds (default 5)', () => {
  let r = stepBoxFight(deepFreeze(fight({ score: [3, 1] })), 0.1, [1, 0]);
  assert.equal(r.state.phase, 'roundEnd', '4 wins is not 5');
  r = stepBoxFight(deepFreeze(fight({ score: [4, 1] })), 0.1, [1, 0]);
  assert.equal(r.state.phase, 'matchEnd');
  assert.equal(r.state.winner, 0);
  r = stepBoxFight(deepFreeze(fight({ score: [0, 8], winRounds: 9 })), 0.1, [0, 2]);
  assert.equal(r.state.winner, 1);
});

test('FFA: after round 10 the most eliminations wins', () => {
  const s = deepFreeze(fight({ ffa: true, sides: 3, round: 10, elims: [4, 9, 2], score: [5, 1, 3] }));
  const r = stepBoxFight(s, 0.1, [1, 0, 0]);
  assert.equal(r.state.phase, 'matchEnd');
  assert.equal(r.state.winner, 1, 'elims beat rounds won');
  assert.deepEqual(r.events.map((e) => e.type), ['roundEnd', 'matchEnd']);
  assert.deepEqual(r.events[1], { type: 'matchEnd', winnerSide: 1, score: [6, 1, 3], elims: [4, 9, 2] });
  // round 9 does not end the match
  assert.equal(stepBoxFight(fight({ ffa: true, sides: 3, round: 9 }), 0.1, [1, 0, 0]).state.phase, 'roundEnd');
  // FFA never ends on round wins
  assert.equal(stepBoxFight(fight({ ffa: true, sides: 2, round: 3, score: [8, 0] }), 0.1, [1, 0]).state.phase, 'roundEnd');
});

test('FFA ties: elims tie -> most rounds won; full tie -> no winner (draw)', () => {
  assert.equal(ffaWinner([5, 5, 1], [2, 4, 0]), 1);
  assert.equal(ffaWinner([5, 5, 1], [3, 3, 0]), null);
  assert.equal(ffaWinner([7, 2], [0, 0]), 0);
  assert.equal(ffaWinner([], []), null);
  const r = stepBoxFight(fight({ ffa: true, sides: 2, round: 10, elims: [3, 3], score: [4, 4] }), 0.1, [0, 0]);
  assert.equal(r.state.phase, 'matchEnd');
  assert.equal(r.state.winner, null);
  assert.deepEqual(boxStandings([3, 9, 3, 1], [1, 0, 1, 2]).map((x) => [x.side, x.place]), [[1, 1], [0, 2], [2, 2], [3, 4]]);
});

test('boxElim: credits the killer side during a fight; FFA first to 15 ends the match at once', () => {
  const s0 = deepFreeze(fight({ ffa: true, sides: 3, elims: [14, 3, 0] }));
  let r = boxElim(s0, 1, 2);
  assert.deepEqual(r.state.elims, [14, 4, 0]);
  assert.deepEqual(r.events, []);
  r = boxElim(s0, 0, 1);
  assert.equal(r.state.phase, 'matchEnd');
  assert.equal(r.state.winner, 0);
  assert.deepEqual(r.events, [{ type: 'matchEnd', winnerSide: 0, score: [0, 0, 0], elims: [15, 3, 0] }]);
  // no credit: self / same side, unknown killer, outside a fight
  assert.equal(boxElim(s0, 1, 1).state, s0);
  assert.equal(boxElim(s0, -1, 1).state, s0);
  assert.equal(boxElim(s0, 9, 1).state, s0);
  assert.equal(boxElim(s0, null, 1).state, s0);
  const warm = deepFreeze({ ...s0, phase: 'warmup' });
  assert.equal(boxElim(warm, 1, 2).state, warm);
  // team mode: tracked, never ends the match
  r = boxElim(deepFreeze(fight({ elims: [30, 0] })), 0, 1);
  assert.equal(r.state.phase, 'fight');
  assert.deepEqual(r.state.elims, [31, 0]);
});

test('roundBanner / boxResultCopy for FFA', () => {
  assert.equal(roundBanner({ ...createBoxFightState({ ffa: true, sides: 3 }), round: 4, elims: [0, 1, 0] }, 1), 'ROUND 4/10 · 1 ELIM');
  assert.deepEqual(boxResultCopy({ victory: true, ffa: true, place: 1, players: 6, elims: 15 }), { title: 'BOX FIGHT WON', sub: 'You placed #1 of 6 with 15 eliminations in Box Fights FFA.', tile: '#1' });
  assert.equal(boxResultCopy({ victory: false, ffa: true, place: 1, players: 2, elims: 3, draw: true }).title, 'BOX FIGHT DRAW');
  assert.equal(boxResultCopy({ victory: false, ffa: true, place: 3, players: 4, elims: 1 }).title, 'BOX FIGHT LOST');
});

test('sideOfTeam works for N sides', () => {
  assert.equal(sideOfTeam([4, 7, 9], 9), 2);
  assert.equal(sideOfTeam([4, 7, 9], 1), -1);
  assert.equal(sideOfTeam([4, 7], null), -1);
});

test('boxReplacement: a bot takes the leaver\'s id, team, side and spot', () => {
  const vitals = { health: 100, shield: 100 };
  const spawn = { x: 1, y: 300, z: 2, heading: 3 };
  const leaver = { id: 4, team: 1, alive: true, health: 37, shield: 12, pos: { x: 10, y: 301, z: 20 }, heading: 0.5 };
  // mid-fight: where they stood, with their health
  assert.deepEqual(boxReplacement({ leaver, side: 1, phase: 'fight', spawn, vitals }), { id: 4, team: 1, side: 1, alive: true, pos: { x: 10, y: 301, z: 20, heading: 0.5 }, health: 37, shield: 12 });
  // warmup: in their spawn box at full health
  assert.deepEqual(boxReplacement({ leaver, side: 1, phase: 'warmup', spawn, vitals }), { id: 4, team: 1, side: 1, alive: true, pos: spawn, health: 100, shield: 100 });
  // dead / between rounds: out until the next round start puts it in the box
  const dead = boxReplacement({ leaver: { ...leaver, alive: false }, side: 1, phase: 'fight', spawn, vitals });
  assert.equal(dead.alive, false);
  assert.equal(boxReplacement({ leaver, side: 1, phase: 'roundEnd', spawn, vitals }).alive, false);
  // junk
  assert.equal(boxReplacement({ leaver: null, side: 0, phase: 'fight' }), null);
  assert.equal(boxReplacement({ leaver: { id: 'x' }, side: 0, phase: 'fight' }), null);
  assert.equal(boxReplacement({ leaver, side: -1, phase: 'fight' }), null);
});

test('GameModes: FFA capacity, party fit and lobby checks', () => {
  assert.equal(G.boxFightSlots('ffa'), 6);
  assert.equal(G.boxFightSlots('squad'), 0);
  assert.equal(G.modeCapacity('boxfights', 'ffa'), 6);
  assert.equal(G.modeCapacity('boxfights', 'trio'), 3);
  assert.equal(G.modeCapacity('br', 'squad'), 4);
  assert.equal(G.fitMode('boxfights', 'trio', 4), 'ffa', 'a party of 4 only fits FFA');
  assert.equal(G.fitMode('boxfights', 'ffa', 1), 'ffa');
  assert.equal(G.fitMode('br', 'trio', 4), 'squad');
  let r = G.lobbyStartCheck({ game: 'boxfights', mode: 'ffa', fill: true, humans: 7 });
  assert.deepEqual([r.ok, r.cap, r.status], [false, 6, 'Box Fights FFA fits 6 players (7 here)']);
  r = G.lobbyStartCheck({ game: 'boxfights', mode: 'ffa', fill: false, humans: 1 });
  assert.equal(r.ok, false);
  assert.equal(G.lobbyStartCheck({ game: 'boxfights', mode: 'ffa', fill: true, humans: 1 }).ok, true);
  // FFA: one team per human, capped at 6
  r = G.boxTeams('ffa', [[1, 2], [3], [4, 5, 6, 7]], true);
  assert.deepEqual(r.teams, [[1], [2], [3], [4], [5], [6]]);
  assert.deepEqual(r.overflow, [7]);
});

import { boxSlotPlan } from '../src/game/BoxFights.js';

const plan = (cfg, slots, humans) => {
  const r = boxSlotPlan(boxMatchConfig(cfg), slots, humans);
  return { humans: Object.fromEntries(r.humans), bots: r.bots, kick: r.kick, sides: r.sides };
};

test('boxSlotPlan: team mode follows the lobby slots; bots fill both teams equally', () => {
  const slots = [
    { kind: 'human', clientId: 0, team: 0 },
    { kind: 'human', token: 'tokB', team: 1 },
    { kind: 'bot', name: 'Bot Alpha', team: 0 },
  ];
  const r = plan({ mode: 'duo' }, slots, [{ id: 0 }, { id: 3, token: 'tokB' }]);
  assert.deepEqual(r.humans, { 0: 0, 3: 1 });
  assert.deepEqual(r.bots, [{ side: 0, name: 'Bot Alpha' }, { side: 1, name: '' }]);
  assert.deepEqual(r.kick, []);
  assert.equal(r.sides, 2);
  // the lobby's own slot ids are not room ids: matched by token / host flag only
  const lobby = [{ id: 7, kind: 'human', host: true, token: 'H', team: 1 }, { id: 0, kind: 'human', token: 'G', team: 0 }, { id: 9, kind: 'open', team: 0 }];
  const r2 = plan({ mode: 'solo' }, lobby, [{ id: 0, token: null }, { id: 4, token: 'G' }]);
  assert.deepEqual(r2.humans, { 0: 1, 4: 0 });
  assert.deepEqual(r2.bots, []);
});

test('boxSlotPlan: humans first; a missing human becomes a bot; extras are kicked, never the host', () => {
  // 1v1, slots name a guest who never connected; an unknown guest is connected
  let r = plan({ mode: 'solo' }, [{ kind: 'human', clientId: 0, team: 1 }, { kind: 'human', token: 'gone', team: 0 }], [{ id: 0 }, { id: 5, token: 'x' }]);
  assert.deepEqual(r.humans, { 0: 1, 5: 0 }, 'a connected human beats a no-show slot');
  assert.deepEqual(r.bots, []);
  r = plan({ mode: 'solo' }, [{ kind: 'human', clientId: 1, team: 0 }, { kind: 'human', clientId: 2, team: 1 }], [{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.equal(r.humans[0] != null, true, 'host always plays');
  assert.equal(Object.keys(r.humans).length, 2);
  assert.equal(r.kick.length, 1);
  // a full side sends the next human to the side with room
  r = plan({ mode: 'duo' }, [{ kind: 'human', clientId: 0, team: 0 }, { kind: 'human', clientId: 1, team: 0 }, { kind: 'human', clientId: 2, team: 0 }], [{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.deepEqual(r.humans, { 0: 0, 1: 0, 2: 1 });
  assert.deepEqual(r.bots, [{ side: 1, name: '' }]);
});

test('boxSlotPlan: no slots (party / quick play) - team sides level, bots fill', () => {
  const r = plan({ mode: 'trio' }, null, [{ id: 0 }, { id: 1 }, { id: 2 }]);
  const per = [0, 0];
  for (const s of Object.values(r.humans)) per[s]++;
  for (const b of r.bots) per[b.side]++;
  assert.deepEqual(per, [3, 3]);
});

test('boxSlotPlan: FFA - one side per slot, compacted; fill to the chosen count; at least 2 sides', () => {
  let r = plan({ mode: 'ffa', ffaPlayers: 4 }, [{ kind: 'human', clientId: 0 }, null, { kind: 'bot', name: '<b>Evil</b>' }], [{ id: 0 }, { id: 2 }]);
  assert.equal(r.sides, 4);
  assert.deepEqual(new Set([...Object.values(r.humans), ...r.bots.map((b) => b.side)]).size, 4);
  assert.equal(r.bots.find((b) => b.name).name, 'bEvil/b', 'markup stripped');
  r = plan({ mode: 'ffa', ffaPlayers: 6, fill: false }, null, [{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.equal(r.sides, 3);
  assert.deepEqual(r.bots, []);
  r = plan({ mode: 'ffa', fill: false }, null, [{ id: 0 }]);
  assert.equal(r.sides, 2, 'never a one-player FFA');
  r = plan({ mode: 'ffa', ffaPlayers: 2 }, null, [{ id: 0 }, { id: 1 }, { id: 2 }]);
  assert.equal(r.sides, 2);
  assert.deepEqual(r.kick, [2]);
  const all = Object.values(plan({ mode: 'ffa' }, null, [{ id: 0 }]).humans);
  assert.deepEqual(all, [0]);
});
