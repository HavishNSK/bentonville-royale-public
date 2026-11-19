// Ranked results must close a server-issued match ticket (party/matchStats.js). Before this,
// `reward` could be posted in a loop from a script and every call added wins and kills.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatchStats,
  openMatch,
  settleMatch,
  MATCH_TICKET_MAX_MS,
  MATCH_TICKET_REUSE_MS,
  MIN_WIN_MS,
  MS_PER_KILL,
  RANKED_PER_DAY,
} from '../party/matchStats.js';

const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const MIN = 60e3;
const res = (o = {}) => ({ kills: 5, players: 100, won: false, ranked: true, ...o });

test('a result without the open ticket is refused', () => {
  assert.deepEqual(settleMatch({}, 'abc', res(), T0), { error: 'noMatch' });
  const acc = openMatch({}, 'abc', T0);
  assert.equal(settleMatch(acc, 'nope', res(), T0 + 5 * MIN).error, 'noMatch');
  assert.equal(settleMatch(acc, undefined, res(), T0 + 5 * MIN).error, 'noMatch');
});

test('a ticket pays out once', () => {
  const acc = openMatch({}, 'abc', T0);
  const first = settleMatch(acc, 'abc', res(), T0 + 5 * MIN);
  assert.equal(first.ranked, true);
  assert.equal(first.kills, 5);
  assert.equal(first.acc.liveMatch, null);
  assert.equal(settleMatch(first.acc, 'abc', res(), T0 + 5 * MIN + 1).error, 'noMatch');
});

test('kills are capped by real match time and by the other players', () => {
  const acc = openMatch({}, 'abc', T0);
  assert.equal(settleMatch(acc, 'abc', res({ kills: 40 }), T0 + 30e3).kills, Math.floor(30e3 / MS_PER_KILL));
  assert.equal(settleMatch(acc, 'abc', res({ kills: 40, players: 10 }), T0 + 10 * MIN).kills, 9);
  assert.equal(settleMatch(acc, 'abc', res({ kills: -3 }), T0 + 10 * MIN).kills, 0);
});

test('a win only counts after MIN_WIN_MS', () => {
  const acc = openMatch({}, 'abc', T0);
  assert.equal(settleMatch(acc, 'abc', res({ won: true }), T0 + MIN_WIN_MS - 1).won, false);
  assert.equal(settleMatch(acc, 'abc', res({ won: true }), T0 + MIN_WIN_MS).won, true);
  assert.equal(settleMatch(acc, 'abc', res({ won: 'true' }), T0 + MIN_WIN_MS).won, false);
});

test('a stale ticket is closed and refused', () => {
  const acc = openMatch({}, 'abc', T0);
  const r = settleMatch(acc, 'abc', res(), T0 + MATCH_TICKET_MAX_MS + 1);
  assert.equal(r.error, 'stale');
  assert.equal(r.acc.liveMatch, null);
  assert.equal(settleMatch(openMatch({}, 'abc', T0), 'abc', res(), T0 - 1).error, 'stale', 'clock going backwards');
});

test('matchStart spam cannot reset the ticket start time', () => {
  const a = openMatch({}, 'one', T0);
  assert.equal(openMatch(a, 'two', T0 + MATCH_TICKET_REUSE_MS - 1), a);
  assert.deepEqual(openMatch(a, 'two', T0 + MATCH_TICKET_REUSE_MS).liveMatch, { id: 'two', at: T0 + MATCH_TICKET_REUSE_MS });
});

test('ranked results stop after the daily cap and reset the next UTC day', () => {
  const day = new Date(T0).toISOString().slice(0, 10);
  const full = openMatch({ rankedDay: day, rankedCount: RANKED_PER_DAY }, 'abc', T0);
  const r = settleMatch(full, 'abc', res(), T0 + 5 * MIN);
  assert.equal(r.ranked, false);
  assert.equal(r.reason, 'daily');
  assert.equal(r.acc.rankedCount, RANKED_PER_DAY);
  const tomorrow = openMatch({ rankedDay: day, rankedCount: RANKED_PER_DAY }, 'abc', T0 + 864e5);
  const ok = settleMatch(tomorrow, 'abc', res(), T0 + 864e5 + 5 * MIN);
  assert.equal(ok.ranked, true);
  assert.equal(ok.acc.rankedCount, 1);
});

test('unranked results do not use the daily cap', () => {
  const r = settleMatch(openMatch({}, 'abc', T0), 'abc', res({ ranked: false }), T0 + 5 * MIN);
  assert.equal(r.ranked, false);
  assert.equal(r.acc.rankedCount, undefined);
});

test('inputs are not mutated', () => {
  const acc = { stats: { matches: 0, wins: 0, kills: 0 }, liveMatch: { id: 'abc', at: T0 } };
  const copy = JSON.parse(JSON.stringify(acc));
  settleMatch(acc, 'abc', res(), T0 + 5 * MIN);
  openMatch(acc, 'x', T0 + MATCH_TICKET_MAX_MS);
  assert.deepEqual(acc, copy);
});

test('the reported exploit: spamming reward in a loop adds at most one result', () => {
  let acc = openMatch({ stats: { matches: 0, wins: 0, kills: 0 } }, 'abc', T0);
  for (let i = 0; i < 150; i++) {
    const r = settleMatch(acc, 'abc', res({ kills: 40, won: true }), T0 + 4 * MIN + i * 100);
    if (r.error) continue;
    acc = { ...r.acc, stats: applyMatchStats(r.acc.stats, r) };
  }
  assert.deepEqual(acc.stats, { matches: 1, wins: 1, kills: 40 });
});
