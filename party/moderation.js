// BENTONVILLE ROYALE — moderation helpers used by accounts.js (pure; tested in tests/moderation.test.mjs).
//
// This is moderation, not anti-cheat. Match results are reported by the player's browser, so the
// server cannot prove anything. `rewardFlags` only marks results that look impossible or unlikely so
// a dev can review them; nothing here bans anyone on its own. Bans are issued by a verified dev
// (accounts.js checks isDevName on the session account) and escalate along BAN_LADDER.
//
// Account fields written here (all optional on older accounts):
//   flags:[{kind, why, at}] (newest last, FLAG_KEEP)   flagCount
//   modTrack:{lastRanked, rankedPlayed, rankedWins}    ranked results counted since tracking began
//   ban:{reason, by, at, duration, until|null} | null  offences (bans issued, never decreases)
//   warning:{reason, at} | null                        banHistory:[{type, by, at, reason?, duration?}]
// Every function returns a new account object and never mutates its input.

// Permanent bans written into the code (lowercase account name -> reason shown to the player).
// They cannot be lifted with /unban; remove the line here (and redeploy) to undo one.
export const PERMA_BANNED = Object.freeze({
  rank_1_kills: 'Exploiting the game (teleporting and host cheats)',
});

const codeBan = (acc) => (acc && typeof acc.name === 'string' ? PERMA_BANNED[acc.name.toLowerCase()] : undefined);

export const BAN_LADDER = ['1h', '1d', '1w', '1mo', 'perm'];
export const BAN_MS = { '1h': 3600e3, '1d': 864e5, '1w': 7 * 864e5, '1mo': 30 * 864e5, perm: null };
export const BAN_LABEL = { '1h': '1 hour', '1d': '1 day', '1w': '1 week', '1mo': '1 month', perm: 'Permanent' };

export const MIN_MATCH_MS = 3 * 60e3; // ranked results closer together than this can't be real matches
export const MAX_KILLS = 20; // more eliminations than this in one match
export const WIN_RATE_MIN_MATCHES = 10; // win-rate check needs at least this many tracked ranked matches
export const WIN_RATE_MAX = 0.6;
export const FLAG_KEEP = 20;
export const FLAG_REPEAT_MS = 864e5; // the same kind of flag is recorded at most once a day
export const HISTORY_KEEP = 20;

const keepLast = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);

/**
 * Reasons a reported match result looks suspicious. `m` must already be clamped by the caller
 * (kills, players, placement numbers; won only when placement === 1).
 * @returns {{kind: string, why: string}[]}
 */
export function rewardFlags(m, acc, now) {
  const { kills = 0, players = 1, placement = 1, won = false, ranked = false } = m;
  const out = [];
  if (kills > 0 && kills >= players) out.push({ kind: 'kills', why: `${kills} kills in a ${players}-player match` });
  if (kills > MAX_KILLS) out.push({ kind: 'manyKills', why: `${kills} kills in one match` });
  if (won && players < 2) out.push({ kind: 'soloWin', why: `win reported in a ${players}-player match (place ${placement})` });
  if (ranked === true) {
    const t = acc.modTrack || {};
    const gap = now - (t.lastRanked || 0);
    if (t.lastRanked && gap < MIN_MATCH_MS) out.push({ kind: 'fast', why: `ranked results ${Math.round(gap / 1000)} s apart` });
    const played = (t.rankedPlayed | 0) + 1;
    const wins = (t.rankedWins | 0) + (won ? 1 : 0);
    if (won && played >= WIN_RATE_MIN_MATCHES && wins / played > WIN_RATE_MAX) {
      out.push({ kind: 'winRate', why: `ranked win rate ${Math.round((wins / played) * 100)}% over ${played} matches` });
    }
  }
  return out;
}

/** Count a ranked result for the win-rate and timing checks. Unranked results change nothing. */
export function trackRanked(acc, { ranked, won, now }) {
  if (ranked !== true) return acc;
  const t = acc.modTrack || {};
  return {
    ...acc,
    modTrack: { lastRanked: now, rankedPlayed: (t.rankedPlayed | 0) + 1, rankedWins: (t.rankedWins | 0) + (won ? 1 : 0) },
  };
}

/** Record one flag (skipping a repeat of the same kind within FLAG_REPEAT_MS). */
export function addFlag(acc, { kind, why }, now) {
  const flags = Array.isArray(acc.flags) ? acc.flags : [];
  const recent = flags.findLast((f) => f.kind === kind);
  if (recent && now - recent.at < FLAG_REPEAT_MS) return acc;
  return {
    ...acc,
    flags: keepLast([...flags, { kind, why: String(why).slice(0, 120), at: now }], FLAG_KEEP),
    flagCount: (acc.flagCount | 0) + 1,
  };
}

const withHistory = (acc, entry) => keepLast([...(Array.isArray(acc.banHistory) ? acc.banHistory : []), entry], HISTORY_KEEP);

/** The ban the next offence gets: one rung past the account's previous bans, capped at perm. */
export function nextPenalty(acc) {
  return BAN_LADDER[Math.min(acc.offences | 0, BAN_LADDER.length - 1)];
}

/** Ban `acc`. `duration` defaults to the next rung on the ladder; an unknown duration throws. */
export function applyBan(acc, { by, reason, duration, now }) {
  const d = duration || nextPenalty(acc);
  if (!BAN_LADDER.includes(d)) throw new Error('Unknown ban duration: ' + d);
  const until = BAN_MS[d] == null ? null : now + BAN_MS[d];
  const ban = { reason: String(reason).slice(0, 100), by: String(by), at: now, duration: d, until };
  return {
    ...acc,
    ban,
    offences: (acc.offences | 0) + 1,
    banHistory: withHistory(acc, { type: 'ban', by: ban.by, at: now, reason: ban.reason, duration: d }),
  };
}

/** Lift the current ban. Offences and history stay, so the next ban still escalates. */
export function liftBan(acc, { by, now }) {
  return { ...acc, ban: null, banHistory: withHistory(acc, { type: 'unban', by: String(by), at: now }) };
}

/** A warning: shown to the player, not an offence. */
export function applyWarn(acc, { by, reason, now }) {
  const r = String(reason).slice(0, 100);
  return { ...acc, warning: { reason: r, at: now }, banHistory: withHistory(acc, { type: 'warn', by: String(by), at: now, reason: r }) };
}

export function isBanned(acc, now) {
  if (codeBan(acc)) return true;
  const b = acc && acc.ban;
  return !!b && (b.until == null || b.until > now);
}

/** What the banned player is shown (no dev name), or null when not banned. */
export function banInfo(acc, now) {
  if (!isBanned(acc, now)) return null;
  const fixed = codeBan(acc);
  if (fixed) return { reason: fixed, until: null, permanent: true, label: BAN_LABEL.perm };
  const b = acc.ban;
  return { reason: b.reason, until: b.until, permanent: b.until == null, label: BAN_LABEL[b.duration] || 'Ban' };
}

// ---------------------------------------------------------------- player reports
// A signed-in player reports another player with a reason (+ a note). Reports are private: only
// devs read them (/reports, /history), then decide whether to /ban. Nothing is automatic.
// Stored as reports:<lower name> -> {name, known, total, list:[{by, reason, note, at}]}.

export const REPORT_REASONS = Object.freeze({
  cheating: 'Cheating / hacking',
  teaming: 'Teaming with enemies',
  name: 'Offensive name',
  chat: 'Harassment in chat',
  other: 'Other',
});
export const REPORT_KEEP = 10; // newest reports kept per player (small on purpose: storage)
export const REPORTS_PER_DAY = 10; // per reporter
export const REPORT_NOTE_MAX = 300;

/** {name, reason, note} from the client -> clean copy, or {error}. */
export function cleanReport(m) {
  const name = String((m && m.name) || '').trim();
  if (!/^[A-Za-z0-9_-]{3,16}$/.test(name)) return { error: 'Type the player’s username (3-16 letters, numbers, _ or -).' };
  const reason = String((m && m.reason) || '');
  if (!Object.prototype.hasOwnProperty.call(REPORT_REASONS, reason)) return { error: 'Pick a reason for the report.' };
  const note = String((m && m.note) || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, REPORT_NOTE_MAX);
  if (reason === 'other' && !note) return { error: 'Say what happened.' };
  return { name, reason, note };
}

/** Add one report to `rec` (null for the first). Returns the new record, or {error}. */
export function addReport(rec, { target, known, by, reason, note, now }) {
  const prev = rec || { name: target, known: !!known, total: 0, list: [] };
  const who = String(by).toLowerCase();
  if (prev.list.some((r) => r.by === who && now - r.at < 864e5)) return { error: 'You already reported this player today.' };
  return {
    name: target,
    known: !!known,
    total: (prev.total | 0) + 1,
    list: keepLast([...prev.list, { by: who, reason, note, at: now }], REPORT_KEEP),
  };
}

/** Per-reporter daily cap. Returns {ok, acc} (acc carries the updated counter) or {ok:false}. */
export function reporterAllowance(acc, now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const count = acc.reportDay === day ? acc.reportCount | 0 : 0;
  if (count >= REPORTS_PER_DAY) return { ok: false };
  return { ok: true, acc: { ...acc, reportDay: day, reportCount: count + 1 } };
}
