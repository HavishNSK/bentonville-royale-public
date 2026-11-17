// BENTONVILLE ROYALE — leaderboard stat update for one finished match (used by accounts.js 'reward').
// Only HARD bot-difficulty matches (ranked === true) add wins / eliminations to the RANKS boards;
// every match still counts toward `matches`. The ranked flag is client-reported, like kills.

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
