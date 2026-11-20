import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/game/GameModes.js';

test('constants are frozen', () => {
  assert.deepEqual(G.GAMES, ['br', 'boxfights']);
  assert.deepEqual(G.BOX_MODES, ['solo', 'duo', 'trio', 'ffa']);
  assert.deepEqual(G.BR_MODES, ['solo', 'duo', 'trio', 'squad']);
  assert.equal(G.BOXFIGHT_WINS, 5);
  assert.equal(G.BOX_MAX_PLAYERS, 6);
  assert.ok(Object.isFrozen(G.GAMES) && Object.isFrozen(G.BOX_MODES) && Object.isFrozen(G.BR_MODES));
});

test('normalizeGame / validGame', () => {
  assert.equal(G.normalizeGame('boxfights'), 'boxfights');
  for (const bad of ['br', '__proto__', 'constructor', 'toString', undefined, null, {}, ['boxfights'], 5, 'BOXFIGHTS']) {
    assert.equal(G.normalizeGame(bad), 'br');
  }
  assert.equal(G.validGame('br'), true);
  assert.equal(G.validGame('boxfights'), true);
  for (const bad of ['__proto__', 'constructor', 'toString', undefined, {}, '', 1]) assert.equal(G.validGame(bad), false);
});

test('modeSize', () => {
  assert.deepEqual(['solo', 'duo', 'trio', 'squad', 'ffa'].map(G.modeSize), [1, 2, 3, 4, 1]);
  for (const bad of ['__proto__', 'constructor', 'toString', '', undefined, 3, {}]) assert.equal(G.modeSize(bad), 0);
});

test('validGameMode matrix', () => {
  for (const m of ['solo', 'duo', 'trio', 'squad']) assert.equal(G.validGameMode('br', m), true);
  for (const m of ['solo', 'duo', 'trio', 'ffa']) assert.equal(G.validGameMode('boxfights', m), true);
  assert.equal(G.validGameMode('boxfights', 'squad'), false, 'no 4v4');
  assert.equal(G.validGameMode('boxfights', 'platoon'), false);
  assert.equal(G.validGameMode('br', '__proto__'), false);
  assert.equal(G.validGameMode('nope', 'solo'), false);
});

test('partyCap / boxFightSlots', () => {
  assert.equal(G.partyCap('br'), 4);
  assert.equal(G.partyCap('boxfights'), 4);
  assert.equal(G.partyCap('x'), 4);
  assert.equal(G.boxFightSlots('solo'), 2);
  assert.equal(G.boxFightSlots('duo'), 4);
  assert.equal(G.boxFightSlots('trio'), 6);
  assert.equal(G.boxFightSlots('squad'), 0);
  assert.equal(G.boxFightSlots('ffa'), 6);
  assert.equal(G.boxFightSlots('bogus'), 0);
});

test('fitMode', () => {
  assert.equal(G.fitMode('br', 'duo', 2), 'duo');
  assert.equal(G.fitMode('br', 'solo', 3), 'trio');
  assert.equal(G.fitMode('br', 'squad', 1), 'squad');
  assert.equal(G.fitMode('boxfights', 'duo', 1), 'duo');
  assert.equal(G.fitMode('boxfights', 'squad', 3), 'trio');
  assert.equal(G.fitMode('boxfights', 'squad', 2), 'duo');
  assert.equal(G.fitMode('boxfights', 'solo', 3), 'trio');
  assert.equal(G.fitMode('boxfights', 'trio', 4), 'ffa');
  assert.equal(G.fitMode('boxfights', 'trio', 7), null);
  assert.equal(G.fitMode('br', 'solo', 5), null);
});

test('queueName / parseQueue', () => {
  assert.equal(G.queueName('br', 'duo'), 'duo');
  assert.equal(G.queueName('br', 'squad'), 'squad');
  assert.equal(G.queueName('boxfights', 'trio'), 'bf-trio');
  assert.equal(G.queueName('boxfights', 'squad'), null);
  assert.equal(G.queueName('boxfights', 'ffa'), 'bf-ffa');
  assert.equal(G.queueName('br', '__proto__'), null);
  for (const game of G.GAMES) {
    for (const mode of [...G.BR_MODES, 'ffa']) {
      const q = G.queueName(game, mode);
      if (q === null) continue;
      assert.deepEqual(G.parseQueue(q), { game, mode });
    }
  }
  assert.deepEqual(G.parseQueue('solo'), { game: 'br', mode: 'solo' });
  assert.equal(G.parseQueue('bf-squad'), null);
  assert.deepEqual(G.parseQueue('bf-ffa'), { game: 'boxfights', mode: 'ffa' });
  assert.deepEqual(G.parseQueue('bf-solo'), { game: 'boxfights', mode: 'solo' });
  for (const bad of ['bf-platoon', '__proto__', 'bf-', '', 'squad-bf', 'bf-__proto__', 'BF-solo', 'bf-solo ', null, undefined, 5, {}, ['solo']]) {
    assert.equal(G.parseQueue(bad), null, String(bad));
  }
});

test('lobbyStartCheck', () => {
  let r = G.lobbyStartCheck({ game: 'boxfights', mode: 'solo', fill: true, humans: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.cap, 2);
  assert.equal(r.status, 'Box Fights 1V1 fits 2 players (5 here)');
  r = G.lobbyStartCheck({ game: 'boxfights', mode: 'trio', fill: false, humans: 1 });
  assert.deepEqual([r.ok, r.cap, r.status], [false, 6, 'Needs another player or turn on Fill']);
  r = G.lobbyStartCheck({ game: 'boxfights', mode: 'duo', fill: true, humans: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.cap, 4);
  r = G.lobbyStartCheck({ game: 'boxfights', mode: 'duo', fill: false, humans: 2 });
  assert.equal(r.ok, true);
  r = G.lobbyStartCheck({ game: 'br', mode: 'squad', fill: true, humans: 16 });
  assert.equal(r.ok, true);
  assert.equal(r.cap, 16);
  r = G.lobbyStartCheck({ game: 'br', mode: 'squad', fill: true, humans: 17 });
  assert.equal(r.ok, false);
  assert.equal(typeof r.status, 'string');
});

test('boxTeams', () => {
  let r = G.boxTeams('duo', [[1, 2], [3], [4]], true);
  assert.deepEqual(r.teams, [[1, 2], [3, 4]]);
  assert.deepEqual(r.allowBots, [true, true]);
  assert.deepEqual(r.overflow, []);
  r = G.boxTeams('solo', [[0], [1], [2]], false);
  assert.deepEqual(r.teams, [[0], [1]]);
  assert.deepEqual(r.allowBots, [false, false]);
  assert.deepEqual(r.overflow, [2]);
  // group stays together: skips to a team where it fits
  r = G.boxTeams('trio', [[1, 2], [3, 4], [5]], true);
  assert.deepEqual(r.teams, [[1, 2, 5], [3, 4]]);
  // oversized group: what fits goes in, rest overflows
  r = G.boxTeams('duo', [[1, 2, 3]], true);
  assert.deepEqual(r.teams, [[1, 2], []]);
  assert.deepEqual(r.overflow, [3]);
  r = G.boxTeams('duo', [], true);
  assert.equal(r.teams.length, 2);
  assert.deepEqual(r.teams, [[], []]);
});
