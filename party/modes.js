// BENTONVILLE ROYALE — team modes shared by the party servers and the party client.
// (Gameplay has its own table in src/game/Teams.js; the ids and sizes match.)

export const MODE_SIZE = { solo: 1, duo: 2, trio: 3, squad: 4 };
export const MODE_IDS = Object.keys(MODE_SIZE);
export const MODE_NAMES = { solo: 'SOLO', duo: 'DUOS', trio: 'TRIOS', squad: 'SQUADS' };
export const PARTY_MAX = 4;

export function modeSize(mode) {
  return MODE_SIZE[mode] || 1;
}

export function validMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODE_SIZE, mode);
}

/** Smallest mode that fits n players (never smaller than `mode`). */
export function modeFor(n, mode = 'solo') {
  if (modeSize(mode) >= n) return mode;
  return MODE_IDS.find((m) => MODE_SIZE[m] >= n) || 'squad';
}
