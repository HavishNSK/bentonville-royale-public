// Only HARD bot-difficulty matches count toward the RANKS boards (party/matchStats.js +
// the ranked flag Game puts on its match result).
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMatchStats } from '../party/matchStats.js';
import { isRankedDifficulty, isRankedMatch, RANKED_DIFFICULTY, RANKED_NOTE } from '../src/core/config.js';

const base = { matches: 4, wins: 1, kills: 9 };

test('a ranked (hard) match adds wins and kills', () => {
  assert.deepEqual(applyMatchStats(base, { kills: 3, won: true, ranked: true }), { matches: 5, wins: 2, kills: 12 });
  assert.deepEqual(base, { matches: 4, wins: 1, kills: 9 }, 'input not mutated');
});

test('unranked matches only count as played', () => {
  assert.deepEqual(applyMatchStats(base, { kills: 7, won: true, ranked: false }), { matches: 5, wins: 1, kills: 9 });
  assert.deepEqual(applyMatchStats(base, { kills: 7, won: true }), { matches: 5, wins: 1, kills: 9 }, 'missing flag (old client) = unranked');
  assert.deepEqual(applyMatchStats(base, { kills: 7, won: true, ranked: 'true' }), { matches: 5, wins: 1, kills: 9 }, 'only boolean true counts');
});

test('stats tolerate missing / bad fields', () => {
  assert.deepEqual(applyMatchStats({}, { kills: -5, won: true, ranked: true }), { matches: 1, wins: 1, kills: 0 });
});

test('only hard difficulty is ranked, and the notice says so', () => {
  assert.equal(RANKED_DIFFICULTY, 'hard');
  assert.equal(isRankedDifficulty('hard'), true);
  for (const d of ['easy', 'normal', null, undefined, 'HARD']) assert.equal(isRankedDifficulty(d), false, String(d));
  assert.match(RANKED_NOTE, /HARD/);
  assert.match(RANKED_NOTE, /eliminations/);
  assert.match(RANKED_NOTE, /bots off/i);
});

test('a humans-only private match is unranked even on hard', () => {
  assert.equal(isRankedMatch('hard', 0), false);
  assert.equal(isRankedMatch('hard', 74), true);
  assert.equal(isRankedMatch('easy', 74), false);
  assert.equal(isRankedMatch('normal', 10), false);
  assert.equal(isRankedMatch('hard', null), false);
});
