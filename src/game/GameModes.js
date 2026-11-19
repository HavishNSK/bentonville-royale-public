// BENTONVILLE ROYALE — game kinds. `mode` is always TEAM SIZE (solo|duo|trio|squad);
// `game` is 'br' (battle royale) or 'boxfights' (two teams of up to 4, first to BOXFIGHT_WINS rounds;
// every mode incl. squad = 4v4 is valid).
// No imports: party/ imports this file, never the other way round. Lookups use
// includes/equality only, so '__proto__' and friends are never accepted.

export const GAMES = Object.freeze(['br', 'boxfights']);
export const BOX_MODES = Object.freeze(['solo', 'duo', 'trio', 'squad']);
export const BR_MODES = Object.freeze(['solo', 'duo', 'trio', 'squad']);
export const BOXFIGHT_WINS = 3;
// Same value as MAX_HUMANS in src/net/protocol.js (16 at time of writing).
const BR_MAX_HUMANS = 16;

export function normalizeGame(g) {
  return g === 'boxfights' ? 'boxfights' : 'br';
}

export function validGame(g) {
  return GAMES.includes(g);
}

export function modeSize(mode) {
  const i = BR_MODES.indexOf(mode);
  return i < 0 ? 0 : i + 1;
}

export function validGameMode(game, mode) {
  if (game === 'br') return BR_MODES.includes(mode);
  if (game === 'boxfights') return BOX_MODES.includes(mode);
  return false;
}

export function partyCap(_game) {
  return 4; // both games: a party is at most one full team (squad)
}

export function boxFightSlots(mode) {
  return BOX_MODES.includes(mode) ? 2 * modeSize(mode) : 0;
}

/** Requested mode if valid and big enough, else the smallest valid mode that fits; null if none. */
export function fitMode(game, mode, members) {
  if (validGameMode(game, mode) && modeSize(mode) >= members) return mode;
  const list = game === 'boxfights' ? BOX_MODES : game === 'br' ? BR_MODES : [];
  return list.find((m) => modeSize(m) >= members) || null;
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
    if (humans > cap) return { ok: false, cap, status: `Box Fights ${n}V${n} fits ${cap} players (${humans} here)` };
    if (!fill && humans < 2) return { ok: false, cap, status: 'Needs another player or turn on Fill' };
    return { ok: true, cap, status: '' };
  }
  const cap = BR_MAX_HUMANS;
  if (humans > cap) return { ok: false, cap, status: `Battle royale fits ${cap} players (${humans} here)` };
  return { ok: true, cap, status: '' };
}

/**
 * Pack groups (arrays of ids, kept whole) into exactly two teams of modeSize(mode).
 * A group goes into the first team with room for all of it. A group that fits in
 * no team (including one larger than the team size) puts what fits into the first
 * team with space and the rest into overflow.
 */
export function boxTeams(mode, groups, fill) {
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
