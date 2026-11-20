// BENTONVILLE ROYALE — Box Fights ladder rules for accounts.js (pure; tested in tests/box-rating.test.mjs).
// Results are reported by the player's browser and cannot be verified. Flags here are moderation
// hints for a dev to review, never automatic punishment, and this is not anti-cheat.
// Account field written: box:{elo, games, wins, peak, last, streak} (optional on older accounts).

import { ELO_START, clampElo, eloChange, tierOf } from '../src/game/BoxElo.js';

export const BOX_GAP_MS = 30000; // at most one rated result per 30 s per account
export const BOX_FAST_MS = 45000; // results closer than this are flagged
const UPSET_GAP = 600;
const STREAK_MAX = 15;
const WINRATE_MIN_GAMES = 20;
const WINRATE_MAX = 0.85;
const ALLOWED_KEYS = new Set(['op', 'token', 'size', 'won', 'score', 'oppElo', 'forfeit', 'wins']);

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const count = (v) => (Number.isFinite(v) && v > 0 ? Math.min(1e9, Math.floor(v)) : 0);
// a millisecond timestamp (Date.now() is ~1.8e12, far past count's cap)
const stamp = (v) => (Number.isFinite(v) && v > 0 ? Math.min(8.64e15, Math.floor(v)) : 0);

/** The account's Box Fights stats with defaults filled in. Never mutates `acc`. */
export function boxStats(acc) {
  const b = acc && typeof acc === 'object' && acc.box && typeof acc.box === 'object' ? acc.box : {};
  const elo = Number.isFinite(b.elo) ? clampElo(b.elo) : ELO_START;
  const peak = Number.isFinite(b.peak) ? clampElo(b.peak) : ELO_START;
  return { elo, games: count(b.games), wins: count(b.wins), peak: Math.max(peak, elo), last: stamp(b.last), streak: count(b.streak) };
}

/**
 * Check a client-reported result. Returns {ok:true, won, size, oppElo, score, forfeit} or {ok:false, error}.
 * size: team size 1..3 (no 4v4; FFA is not rated). wins: rounds to win, 1..9 (optional, default 3 for
 * older clients); a non-forfeit result must read wins-to-(less).
 */
export function validateBoxResult(body) {
  const no = (error) => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return no('Bad result.');
  for (const k of Object.keys(body)) if (!ALLOWED_KEYS.has(k)) return no('Bad result.');
  const size = int(body.size, 1, 3);
  if (size === null) return no('Bad team size.');
  if (typeof body.won !== 'boolean') return no('Bad result.');
  const wins = body.wins === undefined ? 3 : int(body.wins, 1, 9);
  if (wins === null) return no('Bad result.');
  const forfeit = body.forfeit === undefined ? false : body.forfeit;
  if (typeof forfeit !== 'boolean') return no('Bad result.');
  if (typeof body.oppElo !== 'number' || !Number.isFinite(body.oppElo)) return no('Bad opponent rating.');
  const sc = body.score;
  if (!Array.isArray(sc) || sc.length !== 2) return no('Bad score.');
  const us = int(sc[0], 0, 9);
  const them = int(sc[1], 0, 9);
  if (us === null || them === null) return no('Bad score.');
  if (!forfeit) {
    const [w, l] = body.won ? [us, them] : [them, us];
    if (w !== wins || l >= wins) return no('Score does not match the result.');
  }
  return { ok: true, won: body.won, size, oppElo: clampElo(body.oppElo), score: [us, them], forfeit };
}

/** New stats after one validated result. Pure. */
export function applyBoxResult(stats, result, now) {
  const s = boxStats({ box: stats });
  const delta = eloChange({ rating: s.elo, games: s.games, oppRating: result.oppElo, won: result.won });
  const elo = clampElo(s.elo + delta);
  const next = {
    elo,
    games: s.games + 1,
    wins: s.wins + (result.won ? 1 : 0),
    peak: Math.max(s.peak, elo),
    last: now,
    streak: result.won ? s.streak + 1 : 0,
  };
  return { stats: next, delta: elo - s.elo, tier: tierOf(elo) };
}

export function boxRateLimited(stats, now) {
  return now - stamp(stats && stats.last) < BOX_GAP_MS;
}

/** Moderation flag kinds for a result, judged on `stats` from before it. */
export function boxFlags(stats, result, now) {
  const s = boxStats({ box: stats });
  const out = [];
  if (result.won && result.oppElo > s.elo + UPSET_GAP) out.push('box-upset');
  if (result.won && s.streak + 1 > STREAK_MAX) out.push('box-streak');
  const games = s.games + 1;
  const wins = s.wins + (result.won ? 1 : 0);
  if (games >= WINRATE_MIN_GAMES && wins / games > WINRATE_MAX) out.push('box-winrate');
  if (s.last && now - s.last < BOX_FAST_MS) out.push('box-fast');
  return out;
}
