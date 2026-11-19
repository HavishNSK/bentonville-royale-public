// BENTONVILLE ROYALE — Box Fights Elo inside a match (pure, no THREE / DOM; tests/box-elo-match.test.mjs).
// Ratings travel between browsers (the host relays each player's reported Box Elo), so every value
// here is untrusted and clamped. The account server recomputes the change itself; this only picks
// the opponent rating a player reports with their result.

import { BOX_FIGHT, normalizeBoxSize } from './BoxFights.js';
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
 * Returns { size, wins, teams: [a, b], botElo }.
 */
export function sanitizeBoxStart(start) {
  const bf = start && typeof start.bf === 'object' && start.bf ? start.bf : {};
  const size = normalizeBoxSize(bf.size);
  const wins = Number.isInteger(bf.wins) && bf.wins >= 1 && bf.wins <= 5 ? bf.wins : BOX_FIGHT.winRounds;
  const t = Array.isArray(bf.teams) ? bf.teams : [];
  const teams = [Number.isInteger(t[0]) ? t[0] : -1, Number.isInteger(t[1]) ? t[1] : -2];
  const reported = reportedElo(bf.botElo);
  const botElo = reported == null ? BOT_ELO.normal : reported;
  return { size, wins, teams, botElo };
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
