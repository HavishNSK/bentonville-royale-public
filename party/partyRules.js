// BENTONVILLE ROYALE — pure party/matchmaker decisions (no partyserver import, so
// node tests can load it). party/partyRoom.js and party/matchmaker.js call these;
// every input here comes from an untrusted client or peer room.

import { normalizeGame, validGame, validGameMode, partyCap, fitMode, modeCapacity } from '../src/game/GameModes.js';

const MODE_LABELS = [['solo', 'Solos'], ['duo', 'Duos'], ['trio', 'Trios'], ['squad', 'Squads'], ['ffa', 'Free-for-all']];
// Oldest queue timestamp the matchmaker accepts from a ticket.
const MAX_TICKET_AGE_MS = 600000;

export function cleanToken(t) {
  return String(t || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
}

export function modeLabel(mode) {
  const hit = MODE_LABELS.find(([id]) => id === mode);
  return hit ? hit[1] : 'Solos';
}

/** A mode valid for `game` that holds `members` (squad is BR only; FFA is Box Fights only); null if none. */
export function coerceMode(game, mode, members) {
  return fitMode(game, mode, members);
}

/** Party settings from the create query (URLSearchParams-like `get`). */
export function createSettings(params) {
  const game = normalizeGame(params.get('game'));
  const mode = coerceMode(game, params.get('mode'), 1) || 'solo';
  return { game, mode, fill: params.get('fill') !== '0' };
}

/** Reason a new (non-reconnecting) connection is refused, or null. */
export function joinReject({ create, members, state, game }) {
  if (create && members) return 'taken';
  if (!create && !members) return 'notFound';
  if (members >= partyCap(game)) return game === 'boxfights' ? 'fullBox' : 'full';
  if (state !== 'idle') return 'busy';
  return null;
}

/** Mode after someone joins: moves up so everyone fits, never outside the game's modes. */
export function joinMode(game, mode, members) {
  return fitMode(game, mode, members) || mode;
}

/** Leader's {t:'setGame'}: null = ignore, {error}, or {game, mode, modeChanged}. */
export function setGameDecision({ game, mode, members, next }) {
  if (!validGame(next) || next === game) return null;
  if (members > partyCap(next)) return { error: 'Parties are up to 4 players' };
  const fit = coerceMode(next, mode, members);
  if (!fit) return { error: 'No mode fits your party' };
  return { game: next, mode: fit, modeChanged: fit !== mode };
}

/** Leader's {t:'setMode'}: null = ignore, {error}, or {mode}. */
export function setModeDecision({ game, members, next }) {
  if (!validGameMode(game, next)) return null;
  const cap = modeCapacity(game, next);
  if (cap < members) return { error: `Your party has ${members} players. That mode fits ${cap}.` };
  return { mode: next };
}

/** Matchmaker: sanitized ticket members (objects with a usable token), capped at `size`. */
export function ticketMembers(members, size) {
  if (!Array.isArray(members)) return [];
  const out = [];
  for (const m of members) {
    if (out.length >= size) break;
    if (!m || typeof m !== 'object') continue;
    const token = cleanToken(m.token);
    if (!token) continue;
    out.push({ token, name: typeof m.name === 'string' ? m.name.slice(0, 16) : '', leader: !!m.leader });
  }
  return out;
}

/** Matchmaker: queue time from a ticket, clamped to [now - 10 min, now]. */
export function ticketTime(at, now) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return now;
  return Math.min(now, Math.max(now - MAX_TICKET_AGE_MS, at));
}
