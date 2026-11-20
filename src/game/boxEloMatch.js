// BENTONVILLE ROYALE — Box Fights Elo inside a match (pure, no THREE / DOM; tests/box-elo-match.test.mjs).
// Ratings travel between browsers (the host relays each player's reported Box Elo), so every value
// here is untrusted and clamped. The account server recomputes the change itself; this only picks
// the opponent rating a player reports with their result.

import { BOX_FIGHT, normalizeBoxSize, boxModeId, normalizeWinRounds, normalizeFfaPlayers } from './BoxFights.js';
import { BOT_ELO, ELO_START, clampElo, teamAverage } from './BoxElo.js';

/** Fixed bot rating for a difficulty ('easy' | 'normal' | 'hard'); anything else counts as normal. */
export function botEloFor(difficulty) {
  return Object.prototype.hasOwnProperty.call(BOT_ELO, difficulty) ? BOT_ELO[difficulty] : BOT_ELO.normal;
}

/** A reported Box Elo from another browser: clamped integer, or null when it is not a number. */
export function reportedElo(v) {
  return typeof v === 'number' && Number.isFinite(v) ? clampElo(v) : null;
}

/**
 * Box Fights fields of a host's start message, clamped (the host is another player's browser).
 * Returns { size, mode, ffa, players, wins, teams, botElo }. Team modes: teams = [a, b] (team ids per
 * side); FFA: teams = one team id per side (2..6), players = that count.
 */
export function sanitizeBoxStart(start) {
  const bf = start && typeof start.bf === 'object' && start.bf ? start.bf : {};
  const ffa = boxModeId(bf.mode) === 'ffa';
  const size = ffa ? 1 : normalizeBoxSize(bf.size);
  const mode = ffa ? 'ffa' : ['solo', 'duo', 'trio'][size - 1];
  const wins = Number.isInteger(bf.wins) ? normalizeWinRounds(bf.wins) : BOX_FIGHT.winRounds;
  const t = Array.isArray(bf.teams) ? bf.teams : [];
  const players = ffa ? normalizeFfaPlayers(t.length) : 2;
  const teams = Array.from({ length: players }, (_, i) => (Number.isInteger(t[i]) ? t[i] : -1 - i));
  const reported = reportedElo(bf.botElo);
  const botElo = reported == null ? BOT_ELO.normal : reported;
  return { size, mode, ffa, players, wins, teams, botElo };
}

/**
 * Average rating of the opposing team, rounded.
 * `actors`: [{ team, bot, elo }] (everyone else in the match); bots rate `botElo`, humans their
 * reported value (ELO_START when they never reported one). No opponents: ELO_START.
 */
export function boxOpponentElo(actors, myTeam, botElo) {
  const bot = reportedElo(botElo) == null ? BOT_ELO.normal : reportedElo(botElo);
  const values = [];
  for (const a of Array.isArray(actors) ? actors : []) {
    if (!a || a.team === myTeam) continue;
    if (a.bot) values.push(bot);
    else {
      const r = reportedElo(a.elo);
      values.push(r == null ? ELO_START : r);
    }
  }
  return Math.round(teamAverage(values));
}
