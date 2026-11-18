// Moderation: suspicious-result flags, the escalating ban ladder, warnings, and dev chat commands.
// Flags are for a dev to review; nothing here bans anyone automatically.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAN_LADDER,
  BAN_MS,
  FLAG_KEEP,
  HISTORY_KEEP,
  MIN_MATCH_MS,
  rewardFlags,
  addFlag,
  trackRanked,
  nextPenalty,
  applyBan,
  liftBan,
  applyWarn,
  isBanned,
  banInfo,
} from '../party/moderation.js';
import { parseModCommand } from '../src/net/devs.js';

const NOW = 1_800_000_000_000;
const acc = (extra = {}) => ({ name: 'Foo', stats: { matches: 0, wins: 0, kills: 0 }, ...extra });
const kinds = (list) => list.map((f) => f.kind).sort();

// ------------------------------------------------------------------ flags

test('a normal result is not flagged', () => {
  assert.deepEqual(rewardFlags({ kills: 4, players: 20, placement: 3, won: false, ranked: true }, acc(), NOW), []);
});

test('more kills than opponents is flagged', () => {
  assert.deepEqual(kinds(rewardFlags({ kills: 5, players: 5, placement: 1, won: true, ranked: false }, acc(), NOW)), ['kills']);
});

test('more than 20 kills in one match is flagged', () => {
  assert.deepEqual(kinds(rewardFlags({ kills: 21, players: 100, placement: 1, won: true, ranked: false }, acc(), NOW)), ['manyKills']);
});

test('a win in a match with under 2 players is flagged', () => {
  assert.deepEqual(kinds(rewardFlags({ kills: 0, players: 1, placement: 1, won: true, ranked: false }, acc(), NOW)), ['soloWin']);
});

test('ranked results that arrive faster than a real match are flagged', () => {
  const a = acc({ modTrack: { lastRanked: NOW - 30_000, rankedPlayed: 1, rankedWins: 0 } });
  assert.deepEqual(kinds(rewardFlags({ kills: 1, players: 20, placement: 9, won: false, ranked: true }, a, NOW)), ['fast']);
  const b = acc({ modTrack: { lastRanked: NOW - MIN_MATCH_MS, rankedPlayed: 1, rankedWins: 0 } });
  assert.deepEqual(rewardFlags({ kills: 1, players: 20, placement: 9, won: false, ranked: true }, b, NOW), []);
  // unranked results are not timed
  assert.deepEqual(rewardFlags({ kills: 1, players: 20, placement: 9, won: false, ranked: false }, a, NOW), []);
});

test('a very high ranked win rate is flagged only after 10 tracked matches', () => {
  const hot = acc({ modTrack: { lastRanked: 0, rankedPlayed: 9, rankedWins: 8 } });
  // this win makes 9/10
  assert.deepEqual(kinds(rewardFlags({ kills: 3, players: 20, placement: 1, won: true, ranked: true }, hot, NOW)), ['winRate']);
  const early = acc({ modTrack: { lastRanked: 0, rankedPlayed: 3, rankedWins: 3 } });
  assert.deepEqual(rewardFlags({ kills: 3, players: 20, placement: 1, won: true, ranked: true }, early, NOW), []);
  const fair = acc({ modTrack: { lastRanked: 0, rankedPlayed: 19, rankedWins: 5 } });
  assert.deepEqual(rewardFlags({ kills: 3, players: 20, placement: 1, won: true, ranked: true }, fair, NOW), []);
});

test('trackRanked counts only ranked matches and does not mutate', () => {
  const a = acc();
  const b = trackRanked(a, { ranked: true, won: true, now: NOW });
  assert.deepEqual(b.modTrack, { lastRanked: NOW, rankedPlayed: 1, rankedWins: 1 });
  assert.equal(a.modTrack, undefined);
  assert.equal(trackRanked(b, { ranked: false, won: true, now: NOW + 1 }), b);
});

test('addFlag keeps the newest FLAG_KEEP, counts all, skips repeats within a day, and does not mutate', () => {
  let a = acc();
  const before = a;
  a = addFlag(a, { kind: 'kills', why: 'x' }, NOW);
  assert.equal(before.flags, undefined);
  assert.equal(a.flagCount, 1);
  // same kind within 24 h is not repeated
  assert.equal(addFlag(a, { kind: 'kills', why: 'x' }, NOW + 1000), a);
  for (let i = 0; i < FLAG_KEEP + 5; i++) a = addFlag(a, { kind: 'k' + i, why: 'y' }, NOW + i);
  assert.equal(a.flags.length, FLAG_KEEP);
  assert.equal(a.flagCount, FLAG_KEEP + 6);
  assert.equal(a.flags.at(-1).kind, 'k' + (FLAG_KEEP + 4));
});

// ------------------------------------------------------------------ bans

test('the ladder escalates 1h -> 1d -> 1w -> 1mo -> perm and stays at perm', () => {
  assert.deepEqual(BAN_LADDER, ['1h', '1d', '1w', '1mo', 'perm']);
  let a = acc();
  const seen = [];
  for (let i = 0; i < 7; i++) {
    const d = nextPenalty(a);
    seen.push(d);
    a = applyBan(a, { by: 'Sumukh', reason: 'cheating', now: NOW });
    assert.equal(a.ban.duration, d);
  }
  assert.deepEqual(seen, ['1h', '1d', '1w', '1mo', 'perm', 'perm', 'perm']);
  assert.equal(a.offences, 7);
});

test('a ban sets until from the duration, and an explicit duration overrides the ladder', () => {
  const a = applyBan(acc(), { by: 'Sumukh', reason: 'stats', now: NOW });
  assert.equal(a.ban.until, NOW + BAN_MS['1h']);
  const p = applyBan(acc(), { by: 'Sumukh', reason: 'obvious hack', duration: 'perm', now: NOW });
  assert.equal(p.ban.until, null);
  assert.equal(p.offences, 1);
  assert.throws(() => applyBan(acc(), { by: 'x', reason: 'y', duration: '5y', now: NOW }));
});

test('isBanned: timed bans lift on their own, permanent bans never do', () => {
  const a = applyBan(acc(), { by: 'Sumukh', reason: 'r', duration: '1d', now: NOW });
  assert.equal(isBanned(a, NOW + 1000), true);
  assert.equal(isBanned(a, NOW + BAN_MS['1d']), false);
  const p = applyBan(acc(), { by: 'Sumukh', reason: 'r', duration: 'perm', now: NOW });
  assert.equal(isBanned(p, NOW + 100 * 365 * 864e5), true);
  assert.equal(isBanned(acc(), NOW), false);
});

test('banInfo is the public view for the player', () => {
  const a = applyBan(acc(), { by: 'Sumukh', reason: 'fake stats', duration: '1w', now: NOW });
  assert.deepEqual(banInfo(a, NOW), { reason: 'fake stats', until: NOW + BAN_MS['1w'], permanent: false, label: '1 week' });
  assert.equal(banInfo(a, NOW + BAN_MS['1w'] + 1), null);
});

test('unban lifts the ban but keeps the history, so the next ban still escalates', () => {
  let a = applyBan(acc(), { by: 'Sumukh', reason: 'r', now: NOW });
  a = liftBan(a, { by: 'Sumukh', now: NOW + 5 });
  assert.equal(isBanned(a, NOW + 10), false);
  assert.equal(a.offences, 1);
  assert.equal(nextPenalty(a), '1d');
  assert.deepEqual(a.banHistory.map((h) => h.type), ['ban', 'unban']);
});

test('a warning is recorded but is not an offence', () => {
  const a = applyWarn(acc(), { by: 'Sumukh', reason: 'be nice', now: NOW });
  assert.deepEqual(a.warning, { reason: 'be nice', at: NOW });
  assert.equal(a.offences | 0, 0);
  assert.equal(nextPenalty(a), '1h');
  assert.deepEqual(a.banHistory.map((h) => h.type), ['warn']);
});

test('history is capped', () => {
  let a = acc();
  for (let i = 0; i < HISTORY_KEEP + 3; i++) a = applyWarn(a, { by: 'Sumukh', reason: 'w' + i, now: NOW + i });
  assert.equal(a.banHistory.length, HISTORY_KEEP);
  assert.equal(a.banHistory.at(-1).reason, 'w' + (HISTORY_KEEP + 2));
});

// ------------------------------------------------------------------ dev commands

test('normal chat is not a mod command', () => {
  assert.equal(parseModCommand('hello'), null);
  assert.equal(parseModCommand('/announce hi'), null);
  assert.equal(parseModCommand('/banana'), null);
});

test('ban with and without a duration', () => {
  assert.deepEqual(parseModCommand('/ban Foo fake stats'), { cmd: 'ban', name: 'Foo', duration: null, reason: 'fake stats' });
  assert.deepEqual(parseModCommand('/BAN foo 1d aimbot in squads'), { cmd: 'ban', name: 'foo', duration: '1d', reason: 'aimbot in squads' });
  assert.deepEqual(parseModCommand('/ban foo perm obvious'), { cmd: 'ban', name: 'foo', duration: 'perm', reason: 'obvious' });
  assert.equal(parseModCommand('/ban foo permanent obvious').duration, 'perm');
});

test('other commands', () => {
  assert.deepEqual(parseModCommand('/warn foo be nice'), { cmd: 'warn', name: 'foo', duration: null, reason: 'be nice' });
  assert.deepEqual(parseModCommand('/unban foo'), { cmd: 'unban', name: 'foo', duration: null, reason: '' });
  assert.deepEqual(parseModCommand('/history foo'), { cmd: 'history', name: 'foo', duration: null, reason: '' });
  assert.deepEqual(parseModCommand('/resetstats foo'), { cmd: 'resetstats', name: 'foo', duration: null, reason: '' });
  assert.deepEqual(parseModCommand('/flags'), { cmd: 'flags', name: '', duration: null, reason: '' });
});

test('bad mod commands explain the usage', () => {
  assert.match(parseModCommand('/ban').error, /Usage/);
  assert.match(parseModCommand('/ban foo').error, /reason/);
  assert.match(parseModCommand('/ban foo 1d').error, /reason/);
  assert.match(parseModCommand('/warn foo').error, /reason/);
  assert.match(parseModCommand('/ban x! cheating').error, /username/);
  assert.match(parseModCommand('/unban').error, /Usage/);
});

test('reasons are capped at 100 characters', () => {
  assert.equal(parseModCommand('/ban foo ' + 'a'.repeat(300)).reason.length, 100);
});

// ------------------------------------------------------------------ hard-coded permanent bans

test('accounts in PERMA_BANNED are permanently banned no matter what is stored', async () => {
  const { PERMA_BANNED } = await import('../party/moderation.js');
  assert.ok(PERMA_BANNED.rank_1_kills, 'Rank_1_Kills is on the list');
  const hacker = { name: 'Rank_1_Kills', stats: { matches: 0, wins: 0, kills: 0 } };
  assert.equal(isBanned(hacker, NOW), true);
  assert.equal(isBanned({ ...hacker, name: 'RANK_1_KILLS' }, NOW + 1e12), true, 'case-insensitive, never expires');
  const info = banInfo(hacker, NOW);
  assert.equal(info.permanent, true);
  assert.equal(info.until, null);
  assert.equal(info.label, 'Permanent');
  // an unban cannot lift a ban that lives in the code
  assert.equal(isBanned(liftBan(hacker, { by: 'Sumukh', now: NOW }), NOW), true);
});

// ------------------------------------------------------------------ player reports

test('cleanReport validates the reason and trims the note', async () => {
  const { cleanReport, REPORT_REASONS } = await import('../party/moderation.js');
  assert.deepEqual(Object.keys(REPORT_REASONS), ['cheating', 'teaming', 'name', 'chat', 'other']);
  assert.deepEqual(cleanReport({ name: ' Foo ', reason: 'cheating', note: '  flew\u0000 across the map  ' }), { name: 'Foo', reason: 'cheating', note: 'flew across the map' });
  assert.equal(cleanReport({ name: 'Foo', reason: 'cheating', note: 'x'.repeat(900) }).note.length, 300);
  assert.match(cleanReport({ name: 'Foo', reason: 'hax' }).error, /reason/);
  assert.match(cleanReport({ name: 'a', reason: 'cheating' }).error, /username/);
  assert.match(cleanReport({ name: 'Foo', reason: 'other', note: '' }).error, /what happened/);
});

test('addReport keeps the newest entries, counts every report, and allows one per reporter per day', async () => {
  const { addReport, REPORT_KEEP } = await import('../party/moderation.js');
  let rec = null;
  rec = addReport(rec, { target: 'Foo', known: true, by: 'alice', reason: 'cheating', note: 'tp', now: NOW });
  assert.equal(rec.total, 1);
  assert.equal(rec.name, 'Foo');
  assert.equal(rec.known, true);
  assert.equal(addReport(rec, { target: 'Foo', known: true, by: 'Alice', reason: 'chat', note: '', now: NOW + 60e3 }).error, 'You already reported this player today.');
  const later = addReport(rec, { target: 'Foo', known: true, by: 'alice', reason: 'chat', note: '', now: NOW + 864e5 + 1 });
  assert.equal(later.total, 2);
  for (let i = 0; i < REPORT_KEEP + 4; i++) rec = addReport(rec, { target: 'Foo', known: true, by: 'u' + i, reason: 'cheating', note: '', now: NOW + i });
  assert.equal(rec.list.length, REPORT_KEEP);
  assert.equal(rec.total, REPORT_KEEP + 5);
});

test('reporterAllowance caps reports per reporter per UTC day', async () => {
  const { reporterAllowance, REPORTS_PER_DAY } = await import('../party/moderation.js');
  let acc = { name: 'alice' };
  for (let i = 0; i < REPORTS_PER_DAY; i++) {
    const r = reporterAllowance(acc, NOW);
    assert.equal(r.ok, true);
    acc = r.acc;
  }
  assert.equal(reporterAllowance(acc, NOW).ok, false);
  assert.equal(reporterAllowance(acc, NOW + 864e5).ok, true, 'resets the next day');
});

test('/reports and /dismiss parse', () => {
  assert.deepEqual(parseModCommand('/reports'), { cmd: 'reports', name: '', duration: null, reason: '' });
  assert.deepEqual(parseModCommand('/dismiss foo'), { cmd: 'dismiss', name: 'foo', duration: null, reason: '' });
});

// ------------------------------------------------------------------ dev-made custom titles

test('/title and /untitle parse; the title is upper-cased and the colour optional', () => {
  assert.deepEqual(parseModCommand('/title foo Bridge King #FFAA00'), { cmd: 'title', name: 'foo', duration: null, reason: 'BRIDGE KING', color: '#ffaa00' });
  assert.deepEqual(parseModCommand('/title foo champ'), { cmd: 'title', name: 'foo', duration: null, reason: 'CHAMP', color: null });
  assert.deepEqual(parseModCommand('/untitle foo'), { cmd: 'untitle', name: 'foo', duration: null, reason: '' });
  assert.match(parseModCommand('/title foo').error, /title/);
});

test('customTitleProblem: letters/digits/spaces, 1-14 chars; staff titles are allowed (owner decision)', async () => {
  const { customTitleProblem } = await import('../src/net/devs.js');
  assert.equal(customTitleProblem('BRIDGE KING'), null);
  assert.match(customTitleProblem('<B>HI</B>'), /letters/);
  assert.match(customTitleProblem('A'.repeat(15)), /14/);
  for (const t of ['DEV', 'ADMIN', 'MOD', 'DEVELOPER', 'STAFF', 'OWNER', 'MODERATOR', 'HEAD MOD']) assert.equal(customTitleProblem(t), null, t);
});

test('accountGrants: a stored custom title shows, a code title wins, and neither grants dev powers', async () => {
  const { accountGrants } = await import('../src/net/devs.js');
  assert.deepEqual(accountGrants('SomeoneElse', { title: 'BRIDGE KING', color: '#ffaa00' }), { dev: false, shown: 'SomeoneElse', title: 'BRIDGE KING', titleColor: '#ffaa00' });
  assert.equal(accountGrants('TheChosenOne', { title: 'OTHER', color: null }).title, 'CHULDE');
  assert.deepEqual(accountGrants('SomeoneElse', { title: 'MOD', color: '#ff5d4a' }), { dev: false, shown: 'SomeoneElse', title: 'MOD', titleColor: '#ff5d4a' }, 'a staff title is only a tag: dev stays false');
  assert.deepEqual(accountGrants('SomeoneElse', { title: '<script>', color: 'red' }), { dev: false, shown: '', title: '', titleColor: '' });
});
