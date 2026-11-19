import test from 'node:test';
import assert from 'node:assert/strict';
import { boxStats, validateBoxResult, applyBoxResult, boxRateLimited, boxFlags } from '../party/boxRating.js';

const good = { size: 2, won: true, score: [3, 1], oppElo: 1100 };

test('boxStats defaults without mutating', () => {
  const acc = { name: 'a' };
  assert.deepEqual(boxStats(acc), { elo: 1000, games: 0, wins: 0, peak: 1000, last: 0, streak: 0 });
  assert.equal(acc.box, undefined);
  assert.deepEqual(boxStats(null), boxStats({}));
  const s = boxStats({ box: { elo: 'x', games: -3, wins: 2.5, peak: NaN, last: 'q', streak: 1e9 } });
  assert.equal(s.elo, 1000);
  assert.equal(s.games, 0);
  assert.equal(s.last, 0);
  assert.equal(boxStats({ box: { elo: 1234, games: 5, wins: 3, peak: 1300, last: 9, streak: 2 } }).elo, 1234);
});

test('validate: accepts good results', () => {
  const r = validateBoxResult(good);
  assert.deepEqual(r, { ok: true, won: true, size: 2, oppElo: 1100, score: [3, 1], forfeit: false });
  assert.equal(validateBoxResult({ size: 4, won: false, score: [1, 3], oppElo: 900 }).ok, true);
  assert.equal(validateBoxResult({ ...good, oppElo: 99999 }).oppElo, 3000);
});

test('validate: rejects bad input', () => {
  const bad = [
    null, undefined, 5, 'x', [], {},
    { ...good, size: 0 }, { ...good, size: 5 }, { ...good, size: 1.5 }, { ...good, size: '2' }, { ...good, size: NaN },
    { ...good, won: 'true' }, { ...good, won: 1 }, { ...good, won: undefined },
    { ...good, score: [9, 0] }, { ...good, score: [3, 3] }, { ...good, score: [2, 1] }, { ...good, score: [3] }, { ...good, score: [3, 1, 0] },
    { ...good, score: ['3', '1'] }, { ...good, score: [NaN, 0] }, { ...good, score: [3.5, 0] }, { ...good, score: [-1, 3] }, { ...good, score: '3-1' },
    { ...good, score: [1, 3] }, // won but score says lost
    { ...good, won: false }, // lost but score says won
    { ...good, oppElo: NaN }, { ...good, oppElo: '1100' }, { ...good, oppElo: undefined },
    { ...good, forfeit: 'yes' },
    JSON.parse('{"size":2,"won":true,"score":[3,1],"oppElo":1000,"__proto__":{"x":1}}'),
  ];
  for (const b of bad) {
    const r = validateBoxResult(b);
    // the __proto__ own key case is allowed only if it is ignored; assert all others reject
    if (b && Object.prototype.hasOwnProperty.call(b, '__proto__')) {
      assert.equal(r.ok, false, 'own __proto__ key rejected');
    } else {
      assert.equal(r.ok, false, JSON.stringify(b));
      assert.equal(typeof r.error, 'string');
    }
  }
  assert.equal(validateBoxResult({ ...good, size: '__proto__' }).ok, false);
});

test('validate: forfeits', () => {
  const win = validateBoxResult({ size: 3, won: true, score: [1, 2], forfeit: true, oppElo: 1000 });
  assert.equal(win.ok, true);
  assert.equal(win.forfeit, true);
  const loss = validateBoxResult({ size: 3, won: false, score: [0, 1], forfeit: true, oppElo: 1000 });
  assert.equal(loss.ok, true);
  assert.equal(validateBoxResult({ size: 3, won: true, score: [1, 2], oppElo: 1000 }).ok, false);
  assert.equal(validateBoxResult({ size: 3, won: true, score: [9, 9], forfeit: true, oppElo: 1000 }).ok, true);
  assert.equal(validateBoxResult({ size: 3, won: true, score: [10, 0], forfeit: true, oppElo: 1000 }).ok, false);
});

test('boxRateLimited', () => {
  assert.equal(boxRateLimited({ last: 100000 }, 100000 + 29999), true);
  assert.equal(boxRateLimited({ last: 100000 }, 100000 + 30000), false);
  assert.equal(boxRateLimited({ last: 0 }, 1e12), false);
});

test('applyBoxResult updates and does not mutate', () => {
  const stats = Object.freeze({ elo: 1000, games: 0, wins: 0, peak: 1000, last: 0, streak: 0 });
  const r = validateBoxResult({ size: 1, won: true, score: [3, 0], oppElo: 1200 });
  const out = applyBoxResult(stats, r, 5e6);
  assert.equal(out.delta, 30);
  assert.equal(out.stats.elo, 1030);
  assert.equal(out.stats.games, 1);
  assert.equal(out.stats.wins, 1);
  assert.equal(out.stats.peak, 1030);
  assert.equal(out.stats.last, 5e6);
  assert.equal(out.stats.streak, 1);
  assert.equal(out.tier.id, 'silver');
  assert.equal(stats.elo, 1000);
  const loss = applyBoxResult(out.stats, { ...r, won: false, score: [0, 3] }, 6e6);
  assert.equal(loss.stats.streak, 0);
  assert.equal(loss.stats.peak, 1030);
  assert.equal(loss.stats.wins, 1);
  assert.ok(loss.delta < 0);
});

test('applyBoxResult clamps at the floor', () => {
  const s = { elo: 100, games: 0, wins: 0, peak: 100, last: 0, streak: 0 };
  const out = applyBoxResult(s, { won: false, oppElo: 3000, size: 1, score: [0, 3], forfeit: false }, 1);
  assert.equal(out.stats.elo, 100);
});

test('boxFlags', () => {
  const base = { elo: 1000, games: 5, wins: 2, peak: 1000, last: 0, streak: 0 };
  const res = (o = {}) => ({ won: true, oppElo: 1000, size: 1, score: [3, 0], forfeit: false, ...o });
  const kinds = (s, r, now) => boxFlags(s, r, now);
  assert.deepEqual(kinds({ ...base, games: 5, wins: 2 }, res(), 1e7), []);
  assert.ok(kinds(base, res({ oppElo: 1601 }), 1e7).includes('box-upset'));
  assert.ok(!kinds(base, res({ oppElo: 1600 }), 1e7).includes('box-upset'));
  assert.ok(!kinds(base, res({ won: false, oppElo: 2500 }), 1e7).includes('box-upset'));
  // boxFlags takes the stats from BEFORE the result and looks at what they become with it
  assert.ok(kinds({ ...base, streak: 15 }, res(), 1e7).includes('box-streak'));
  assert.ok(!kinds({ ...base, streak: 14 }, res(), 1e7).includes('box-streak'));
  assert.ok(!kinds({ ...base, streak: 20 }, res({ won: false }), 1e7).includes('box-streak'));
  assert.ok(kinds({ ...base, games: 19, wins: 17 }, res(), 1e7).includes('box-winrate'));
  assert.ok(!kinds({ ...base, games: 18, wins: 18 }, res(), 1e7).includes('box-winrate'));
  assert.ok(!kinds({ ...base, games: 19, wins: 15 }, res(), 1e7).includes('box-winrate'));
  assert.ok(kinds({ ...base, last: 1e7 - 44999 }, res(), 1e7).includes('box-fast'));
  assert.ok(!kinds({ ...base, last: 1e7 - 45000 }, res(), 1e7).includes('box-fast'));
  assert.ok(!kinds({ ...base, last: 0 }, res(), 10).includes('box-fast'));
});

test('rate limit and fast flag work with real Date.now() timestamps', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0); // ~1.79e12 ms
  const res = validateBoxResult({ size: 1, won: true, score: [3, 1], oppElo: 1200 });
  const first = applyBoxResult(boxStats({}), res, now);
  assert.equal(first.stats.last, now, 'the stored time is the real time');
  const saved = boxStats({ box: first.stats }); // as read back from storage
  assert.equal(saved.last, now);
  assert.equal(boxRateLimited(saved, now + 1000), true, '1 s later is too soon');
  assert.equal(boxRateLimited(saved, now + 31000), false, '31 s later is fine');
  assert.ok(boxFlags(saved, res, now + 20000).includes('box-fast'), 'results 20 s apart are flagged');
});
