// BENTONVILLE ROYALE — game kinds. `game` is 'br' (battle royale) or 'boxfights'.
// Battle royale `mode` is TEAM SIZE (solo|duo|trio|squad). Box Fights modes are solo|duo|trio
// (1v1..3v3, two teams, first to BOXFIGHT_WINS rounds by default) and 'ffa' (free-for-all, 2..6
// players, each on their own). No 4v4 in Box Fights: at most BOX_MAX_PLAYERS (6) per match.
// 'squad' stays a battle royale mode.
// No imports: party/ imports this file, never the other way round. Lookups use
// includes/equality only, so '__proto__' and friends are never accepted.

export const GAMES = Object.freeze(['br', 'boxfights']);
export const BOX_MODES = Object.freeze(['solo', 'duo', 'trio', 'ffa']);
export const BR_MODES = Object.freeze(['solo', 'duo', 'trio', 'squad']);
export const BOXFIGHT_WINS = 5; // default; the host may pick 1..9 (BoxFights.normalizeWinRounds)
export const BOX_MAX_PLAYERS = 6; // FFA players at most (and 3v3 = 6)
// Same value as MAX_HUMANS in src/net/protocol.js (16 at time of writing).
const BR_MAX_HUMANS = 16;

export function normalizeGame(g) {
  return g === 'boxfights' ? 'boxfights' : 'br';
}

export function validGame(g) {
  return GAMES.includes(g);
}

/** Team size: solo..squad = 1..4, 'ffa' = 1 (everyone on their own); unknown = 0. */
export function modeSize(mode) {
  if (mode === 'ffa') return 1;
  const i = BR_MODES.indexOf(mode);
  return i < 0 ? 0 : i + 1;
}

/** Most players of one party a mode holds: the team size, or every FFA slot (6). */
export function modeCapacity(game, mode) {
  if (!validGameMode(game, mode)) return 0;
  return game === 'boxfights' && mode === 'ffa' ? BOX_MAX_PLAYERS : modeSize(mode);
}

export function validGameMode(game, mode) {
  if (game === 'br') return BR_MODES.includes(mode);
  if (game === 'boxfights') return BOX_MODES.includes(mode);
  return false;
}

export function partyCap(_game) {
  return 4; // both games: a party is at most 4 (a BR squad; in Box Fights a party of 4 only fits FFA)
}

/** Humans a Box Fights mode holds: two teams of the team size, or BOX_MAX_PLAYERS in FFA. */
export function boxFightSlots(mode) {
  if (mode === 'ffa') return BOX_MAX_PLAYERS;
  return BOX_MODES.includes(mode) ? 2 * modeSize(mode) : 0;
}

/** Requested mode if valid and big enough, else the smallest valid mode that fits; null if none. */
export function fitMode(game, mode, members) {
  if (validGameMode(game, mode) && modeCapacity(game, mode) >= members) return mode;
  const list = game === 'boxfights' ? BOX_MODES : game === 'br' ? BR_MODES : [];
  return list.find((m) => modeCapacity(game, m) >= members) || null;
}

export function queueName(game, mode) {
  if (!validGameMode(game, mode)) return null;
  return game === 'boxfights' ? `bf-${mode}` : mode;
}

export function parseQueue(name) {
  if (typeof name !== 'string') return null;
  if (name.startsWith('bf-')) {
    const mode = name.slice(3);
    return validGameMode('boxfights', mode) ? { game: 'boxfights', mode } : null;
  }
  return validGameMode('br', name) ? { game: 'br', mode: name } : null;
}

export function lobbyStartCheck({ game, mode, fill, humans }) {
  if (game === 'boxfights') {
    const cap = boxFightSlots(mode);
    const n = modeSize(mode);
    const label = mode === 'ffa' ? 'FFA' : `${n}V${n}`;
    if (humans > cap) return { ok: false, cap, status: `Box Fights ${label} fits ${cap} players (${humans} here)` };
    if (!fill && humans < 2) return { ok: false, cap, status: 'Needs another player or turn on Fill' };
    return { ok: true, cap, status: '' };
  }
  const cap = BR_MAX_HUMANS;
  if (humans > cap) return { ok: false, cap, status: `Battle royale fits ${cap} players (${humans} here)` };
  return { ok: true, cap, status: '' };
}

/**
 * Pack groups (arrays of ids, kept whole) into exactly two teams of modeSize(mode)
 * ('ffa': one single-member team per human, at most BOX_MAX_PLAYERS).
 * A group goes into the first team with room for all of it. A group that fits in
 * no team (including one larger than the team size) puts what fits into the first
 * team with space and the rest into overflow.
 */
export function boxTeams(mode, groups, fill) {
  if (mode === 'ffa') {
    // free-for-all: every human is their own side (party groups split), up to BOX_MAX_PLAYERS
    const ids = [];
    for (const g of Array.isArray(groups) ? groups : []) ids.push(...(Array.isArray(g) ? g : [g]));
    const teams = ids.slice(0, BOX_MAX_PLAYERS).map((id) => [id]);
    return { teams, allowBots: teams.map(() => !!fill), overflow: ids.slice(BOX_MAX_PLAYERS) };
  }
  const size = modeSize(mode);
  const teams = [[], []];
  const overflow = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const ids = Array.isArray(g) ? g : [g];
    const whole = teams.find((t) => t.length + ids.length <= size);
    if (whole) {
      whole.push(...ids);
      continue;
    }
    const room = teams.find((t) => t.length < size);
    const take = room ? size - room.length : 0;
    if (room) room.push(...ids.slice(0, take));
    overflow.push(...ids.slice(room ? take : 0));
  }
  return { teams, allowBots: [!!fill, !!fill], overflow };
}
