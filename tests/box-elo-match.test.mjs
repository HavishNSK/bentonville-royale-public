// Box Fights Elo in a match (client side): start-message clamp and the opponent average
// (src/game/boxEloMatch.js). The server recomputes the rating change; these values are untrusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { botEloFor, reportedElo, sanitizeBoxStart, boxOpponentElo } from '../src/game/boxEloMatch.js';
import { BOT_ELO, ELO_START, ELO_MIN, ELO_MAX } from '../src/game/BoxElo.js';

test('botEloFor: fixed ratings per difficulty, normal otherwise', () => {
  assert.equal(botEloFor('easy'), BOT_ELO.easy);
  assert.equal(botEloFor('normal'), BOT_ELO.normal);
  assert.equal(botEloFor('hard'), BOT_ELO.hard);
  assert.equal(botEloFor('insane'), BOT_ELO.normal);
  assert.equal(botEloFor(undefined), BOT_ELO.normal);
  assert.equal(botEloFor('__proto__'), BOT_ELO.normal);
});

test('reportedElo: clamped integers, null for non-numbers', () => {
  assert.equal(reportedElo(1234.6), 1235);
  assert.equal(reportedElo(99999), ELO_MAX);
  assert.equal(reportedElo(-5), ELO_MIN);
  assert.equal(reportedElo(NaN), null);
  assert.equal(reportedElo(Infinity), null);
  assert.equal(reportedElo('1500'), null);
  assert.equal(reportedElo(null), null);
});

test('sanitizeBoxStart: botElo is clamped, defaults to normal', () => {
  assert.equal(sanitizeBoxStart({ bf: { size: 1, botElo: 1600 } }).botElo, 1600);
  assert.equal(sanitizeBoxStart({ bf: { size: 1, botElo: 99999 } }).botElo, ELO_MAX);
  assert.equal(sanitizeBoxStart({ bf: { size: 1, botElo: -40 } }).botElo, ELO_MIN);
  assert.equal(sanitizeBoxStart({ bf: { size: 1, botElo: '1600' } }).botElo, BOT_ELO.normal);
  assert.equal(sanitizeBoxStart({ bf: { size: 1 } }).botElo, BOT_ELO.normal);
  assert.equal(sanitizeBoxStart({}).botElo, BOT_ELO.normal);
  assert.equal(sanitizeBoxStart(null).botElo, BOT_ELO.normal);
});

test('sanitizeBoxStart: existing fields keep their clamps', () => {
  const s = sanitizeBoxStart({ bf: { size: 2, wins: 12, teams: [3, 'x'] } });
  assert.equal(s.size, 2);
  assert.equal(s.mode, 'duo');
  assert.equal(s.ffa, false);
  assert.equal(s.wins, 5, 'out of range -> default');
  assert.deepEqual(s.teams, [3, -2]);
  assert.equal(sanitizeBoxStart({ bf: { size: 1, wins: 9 } }).wins, 9);
  assert.equal(sanitizeBoxStart({ bf: { size: 4 } }).size, 1, 'no 4v4');
});

test('sanitizeBoxStart: FFA has one team id per side (2..6)', () => {
  const s = sanitizeBoxStart({ bf: { mode: 'ffa', size: 3, teams: [0, 5, 'x', 9] } });
  assert.deepEqual([s.mode, s.ffa, s.size, s.players], ['ffa', true, 1, 4]);
  assert.deepEqual(s.teams, [0, 5, -3, 9]);
  assert.equal(sanitizeBoxStart({ bf: { mode: 'ffa', teams: Array(40).fill(1) } }).players, 6);
  assert.equal(sanitizeBoxStart({ bf: { mode: 'ffa', teams: [1] } }).players, 6, 'too few -> default count');
  assert.equal(sanitizeBoxStart({ bf: { mode: '__proto__' } }).ffa, false);
});

test('boxOpponentElo: bots rate the bot Elo, humans their reported value', () => {
  // 1v1 vs a hard bot
  assert.equal(boxOpponentElo([{ team: 1, bot: true }], 0, BOT_ELO.hard), 1600);
  // 2v2: our teammate is ignored; the other team is a 1400 human and a normal bot
  const actors = [
    { team: 0, bot: false, elo: 2500 },
    { team: 1, bot: false, elo: 1400 },
    { team: 1, bot: true },
  ];
  assert.equal(boxOpponentElo(actors, 0, BOT_ELO.normal), 1300);
});

test('boxOpponentElo: missing / forged human ratings', () => {
  // never reported: ELO_START
  assert.equal(boxOpponentElo([{ team: 1, bot: false }], 0, 1200), ELO_START);
  // forged: clamped
  assert.equal(boxOpponentElo([{ team: 1, bot: false, elo: 1e9 }], 0, 1200), ELO_MAX);
  assert.equal(boxOpponentElo([{ team: 1, bot: false, elo: 'x' }], 0, 1200), ELO_START);
  // forged bot rating falls back to normal
  assert.equal(boxOpponentElo([{ team: 1, bot: true }], 0, NaN), BOT_ELO.normal);
  assert.equal(boxOpponentElo([{ team: 1, bot: true }], 0, 9999), ELO_MAX);
});

test('boxOpponentElo: no opponents / bad input', () => {
  assert.equal(boxOpponentElo([], 0, 1200), ELO_START);
  assert.equal(boxOpponentElo(null, 0, 1200), ELO_START);
  assert.equal(boxOpponentElo([null, { team: 0, bot: true }], 0, 1200), ELO_START);
  // rounded integer
  assert.equal(boxOpponentElo([{ team: 1, elo: 1001 }, { team: 1, elo: 1000 }], 0, 1200), 1001);
});
