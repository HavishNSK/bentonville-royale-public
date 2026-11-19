import test from 'node:test';
import assert from 'node:assert/strict';
import { packTeams, packBoxFight, packBoxFfa } from '../party/matchPack.js';

const party = (id, n, { fill = true, at = 0 } = {}) => ({
  partyId: 'p' + id,
  ticketId: 't' + id,
  fill,
  at,
  members: Array.from({ length: n }, (_, i) => ({ token: `${id}.${i}`, name: 'n', leader: i === 0 })),
});
const ids = (m) => m.teams.map((t) => t.tickets);

test('packTeams: no-fill parties get own teams, fillers share', () => {
  const r = packTeams([party('a', 2, { fill: false }), party('b', 1), party('c', 1), party('d', 2)], 2);
  assert.deepEqual(r.teams, [
    { tokens: ['a.0', 'a.1'], allowBots: false },
    { tokens: ['d.0', 'd.1'], allowBots: true },
    { tokens: ['b.0', 'c.0'], allowBots: true },
  ]);
  assert.equal(r.hostToken, 'a.0');
});

test('packTeams: empty and host tie goes to first party', () => {
  assert.deepEqual(packTeams([], 2), { teams: [], hostToken: null });
  assert.equal(packTeams([party('x', 1), party('y', 1)], 1).hostToken, 'x.0');
});

test('boxfight: 2 solos form 1v1 immediately', () => {
  const { match } = packBoxFight([party('a', 1), party('b', 1)], 1, 0);
  assert.deepEqual(ids(match), [['ta'], ['tb']]);
  assert.deepEqual(match.teams[0].tokens, ['a.0']);
  assert.equal(match.hostToken, 'a.0');
  assert.deepEqual(match.used, ['ta', 'tb']);
});

test('boxfight: 3 solos in 1v1 leave one ticket', () => {
  const { match } = packBoxFight([party('a', 1), party('b', 1), party('c', 1)], 1, 0);
  assert.deepEqual(match.used, ['ta', 'tb']);
});

test('boxfight: duo + two fill solos in 2v2', () => {
  const { match } = packBoxFight([party('a', 2), party('b', 1), party('c', 1)], 2, 0);
  assert.deepEqual(ids(match), [['ta'], ['tb', 'tc']]);
  assert.equal(match.hostToken, 'a.0');
});

test('boxfight: no-fill solo in duos seals its bin', () => {
  const t = [party('a', 1, { fill: false }), party('b', 1), party('c', 1)];
  const { match } = packBoxFight(t, 2, 0);
  assert.equal(match.teams[0].allowBots, false);
  assert.deepEqual(match.teams[0].tickets, ['ta']);
  assert.deepEqual(match.teams[1].tickets, ['tb', 'tc']);
  assert.equal(match.teams[1].allowBots, true);
});

test('boxfight: oversized party skipped', () => {
  const r = packBoxFight([party('a', 3), party('b', 1), party('c', 1)], 1, 0);
  assert.deepEqual(r.match.used, ['tb', 'tc']);
});

test('boxfight: window timing with both bins holding humans', () => {
  const t = [party('a', 2, { at: 1000 }), party('b', 1, { at: 2000 })];
  let r = packBoxFight(t, 2, 5000);
  assert.equal(r.match, null);
  assert.equal(r.nextAt, 11000);
  r = packBoxFight(t, 2, 10999);
  assert.equal(r.match, null);
  r = packBoxFight(t, 2, 11000);
  assert.deepEqual(r.match.used, ['ta', 'tb']);
  assert.ok(r.match.teams.every((x) => x.allowBots));
  r = packBoxFight(t, 2, 5000, { windowMs: 100 });
  assert.ok(r.match);
});

test('boxfight: solo wait with a single party', () => {
  const t = [party('a', 1, { at: 1000 })];
  let r = packBoxFight(t, 2, 30999);
  assert.equal(r.match, null);
  assert.equal(r.nextAt, 31000);
  r = packBoxFight(t, 2, 31000);
  assert.deepEqual(ids(r.match), [['ta'], []]);
  assert.deepEqual(r.match.teams[1].tokens, []);
  assert.equal(r.match.teams[1].allowBots, true);
  assert.equal(packBoxFight([], 2, 0).nextAt, null);
});

test('boxfight: host is leader of largest party, ties oldest', () => {
  const big = party('b', 2);
  big.members[0].leader = false;
  big.members[1].leader = true;
  const { match } = packBoxFight([party('a', 1), big], 2, 0, { windowMs: 0 });
  assert.equal(match.hostToken, 'b.1');
  assert.equal(packBoxFight([party('a', 1), party('b', 1)], 1, 0).match.hostToken, 'a.0');
});

test('boxfight: queue order respected and invariants hold', () => {
  const t = [party('a', 2, { fill: false }), party('b', 2, { fill: false }), party('c', 2, { fill: false }), party('d', 1)];
  const { match } = packBoxFight(t, 2, 0);
  assert.deepEqual(ids(match), [['ta'], ['tb']]);
  assert.equal(match.teams.length, 2);
  for (const team of match.teams) assert.ok(team.tokens.length <= 2);
  assert.equal(new Set(match.used).size, match.used.length);
});

test('boxfight: no-fill sealed short-handed vs sealed forms immediately', () => {
  const t = [party('a', 1, { fill: false }), party('b', 1, { fill: false })];
  const { match } = packBoxFight(t, 3, 0);
  assert.deepEqual(ids(match), [['ta'], ['tb']]);
  assert.ok(match.teams.every((x) => !x.allowBots));
});

test('boxfight 3v3: a trio party vs 3 fill solos forms a match', () => {
  const t = [party('a', 3), party('b', 1), party('c', 1), party('d', 1)];
  const { match } = packBoxFight(t, 3, 0);
  assert.ok(match);
  assert.deepEqual(match.teams.map((x) => x.tokens.length), [3, 3]);
  assert.deepEqual(match.teams[0].tokens, ['a.0', 'a.1', 'a.2']);
  assert.equal(new Set(match.used).size, 4);
});

test('boxfight 3v3: 2+1 vs 2+1 splits into 3 and 3', () => {
  const t = [party('a', 2), party('b', 2), party('c', 1), party('d', 1)];
  const { match } = packBoxFight(t, 3, 0);
  assert.ok(match);
  assert.deepEqual(match.teams.map((x) => x.tokens.length), [3, 3]);
  assert.equal(new Set(match.used).size, match.used.length);
});

test('boxfight 3v3: never more than 3 per team', () => {
  const t = [party('a', 3), party('b', 3), party('c', 3), party('d', 2), party('e', 1)];
  const { match } = packBoxFight(t, 3, 0);
  assert.ok(match);
  for (const team of match.teams) assert.ok(team.tokens.length <= 3);
  assert.equal(match.teams.length, 2);
});

test('boxfight FFA: six humans start at once, one side each; parties stay in one match', () => {
  const t = [party('a', 2), party('b', 1), party('c', 3), party('d', 1), party('e', 2)];
  const { match } = packBoxFfa(t, 6, 0);
  assert.ok(match);
  assert.deepEqual(match.used, ['ta', 'tb', 'tc']);
  assert.equal(match.teams.length, 6);
  assert.ok(match.teams.every((x) => x.tokens.length === 1 && x.allowBots));
  assert.equal(match.hostToken, 'c.0');
});

test('boxfight FFA: short lobby waits, then starts with bots; No Fill needs 2 humans', () => {
  let r = packBoxFfa([party('a', 1, { at: 0 }), party('b', 1, { at: 5 })], 6, 1000);
  assert.equal(r.match, null);
  assert.equal(r.nextAt, 30000);
  r = packBoxFfa([party('a', 1, { at: 0 }), party('b', 1, { at: 5 })], 6, 30000);
  assert.equal(r.match.teams.length, 2);
  assert.deepEqual(packBoxFfa([party('a', 1, { fill: false })], 6, 1e9), { match: null, nextAt: null });
  r = packBoxFfa([party('a', 1, { fill: false }), party('b', 1)], 6, 1e9);
  assert.ok(r.match.teams.every((x) => !x.allowBots));
  assert.deepEqual(packBoxFfa([], 6, 0), { match: null, nextAt: null });
});
