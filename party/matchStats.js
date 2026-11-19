// BENTONVILLE ROYALE — leaderboard stat update for one finished match (used by accounts.js 'reward').
// Only HARD bot-difficulty matches (ranked === true) add wins / eliminations to the RANKS boards;
// every match still counts toward `matches`. The ranked flag is client-reported, like kills.
//
// Match tickets: results come from the player's browser (or the host's, in multiplayer), so the
// server cannot prove them. To stop a script from posting results in a loop, every result must
// close a ticket the server opened at match start (`openMatch`), each ticket pays out once, and
// `settleMatch` caps kills and wins by the real time that passed since the ticket opened. This
// bounds cheating; it is not anti-cheat (see README "Ranked results").

export const MATCH_TICKET_MAX_MS = 2 * 3600e3; // a ticket older than this is stale
export const MATCH_TICKET_REUSE_MS = 20e3; // matchStart this soon after another returns the same ticket
export const MIN_WIN_MS = 3 * 60e3; // no win is possible sooner than this after the match starts
export const MS_PER_KILL = 5e3; // at most one ranked elimination per this much real match time
export const RANKED_PER_DAY = 30; // ranked results per account per UTC day

const dayOf = (now) => new Date(now).toISOString().slice(0, 10);

/** Returns a new stats object; `kills` must already be clamped and `won` validated by the caller. */
export function applyMatchStats(stats, { kills = 0, won = false, ranked = false } = {}) {
  const s = { matches: stats.matches | 0, wins: stats.wins | 0, kills: stats.kills | 0 };
  s.matches += 1;
  if (ranked === true) {
    s.kills += Math.max(0, kills | 0);
    if (won === true) s.wins += 1;
  }
  return s;
}

/**
 * Open a match ticket (matchStart). A call within MATCH_TICKET_REUSE_MS of the last one keeps the
 * existing ticket, so rapid calls cannot reset its start time. Returns a new account object.
 */
export function openMatch(acc, id, now) {
  const t = acc.liveMatch;
  if (t && typeof t.id === 'string' && now - t.at >= 0 && now - t.at < MATCH_TICKET_REUSE_MS) return acc;
  return { ...acc, liveMatch: { id: String(id), at: now } };
}

/**
 * Close the ticket `matchId` and work out what the reported result is allowed to count.
 * `m` is already clamped by the caller: {kills, players, won (only at placement 1), ranked}.
 * @returns {{error: string}} for a missing / wrong / stale ticket, otherwise
 *   {acc, kills, won, ranked, reason?}: `acc` has the ticket removed (and the daily counter bumped
 *   when the result is ranked); kills/won are what may count; reason says why ranked was refused.
 */
export function settleMatch(acc, matchId, m, now) {
  const t = acc.liveMatch;
  if (!t || typeof matchId !== 'string' || t.id !== matchId) return { error: 'noMatch' };
  const elapsed = now - t.at;
  const closed = { ...acc, liveMatch: null };
  if (!(elapsed >= 0) || elapsed > MATCH_TICKET_MAX_MS) return { error: 'stale', acc: closed };

  const players = Math.max(1, m.players | 0);
  const byTime = Math.floor(elapsed / MS_PER_KILL);
  const kills = Math.max(0, Math.min(m.kills | 0, players - 1, byTime));
  const won = m.won === true && elapsed >= MIN_WIN_MS;
  if (m.ranked !== true) return { acc: closed, kills, won, ranked: false };

  const day = dayOf(now);
  const count = acc.rankedDay === day ? acc.rankedCount | 0 : 0;
  if (count >= RANKED_PER_DAY) return { acc: closed, kills, won, ranked: false, reason: 'daily' };
  return { acc: { ...closed, rankedDay: day, rankedCount: count + 1 }, kills, won, ranked: true };
}
