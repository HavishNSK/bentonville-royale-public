// BENTONVILLE ROYALE — team modes (Solo / Duos / Trios / Squads).
//
//   teamSize('squad')                               // 4
//   assignTeams('duo', [{ ids: [0, 3], allowBots: true }], { slots: 75, bots: true })
//     -> { size, teams: [{ id, humans, bots }], humanTeam: Map(id -> team), botTeams: [team per bot] }
//
// Team ids are small integers (team index). In solo every actor's `team` is its own id
// (unchanged from before teams existed) and nothing here is used. Runtime helpers
// (sameTeam, standing, aliveTeamCount) are shared by Combat, Bots, Game and the net code.

export const TEAM_MODES = { solo: 1, duo: 2, trio: 3, squad: 4 };
export const MODE_LABELS = { solo: 'SOLO', duo: 'DUOS', trio: 'TRIOS', squad: 'SQUADS' };
/** Name of one team in result / HUD copy. */
export const TEAM_NOUN = { solo: 'player', duo: 'duo', trio: 'trio', squad: 'squad' };
/** Per-slot colours inside a team (slot = order by actor id): yellow, blue, green, pink. */
export const TEAM_COLORS = [0xffc21f, 0x5ec8ff, 0x7dff6b, 0xff5d8f];
export const TEAM_CSS = TEAM_COLORS.map((c) => '#' + c.toString(16).padStart(6, '0'));

/** Players per team for a mode id (unknown -> 1). */
export function teamSize(mode) {
  return TEAM_MODES[mode] || 1;
}

/** A known mode id, else 'solo'. */
export function normalizeMode(mode) {
  return TEAM_MODES[mode] ? mode : 'solo';
}

/**
 * Splits a match into teams.
 * @param {string} mode
 * @param {Array<{ids:number[], allowBots:boolean}>} groups human teams (oversized groups are split)
 * @param {{ slots:number, bots?:boolean }} opts slots: most actors in the match; bots: any bots at all
 * Human teams come first (in the given order); a team with allowBots gets bot teammates up to the
 * team size, then whole bot teams fill the remaining slots (floor(slots / size) teams in all).
 */
export function assignTeams(mode, groups, { slots, bots = true } = {}) {
  const size = teamSize(mode);
  const teams = [];
  const humanTeam = new Map();
  for (const g of groups || []) {
    const ids = (g && g.ids ? g.ids : []).filter((id) => Number.isInteger(id) && !humanTeam.has(id));
    for (let i = 0; i < ids.length; i += size) {
      const t = { id: teams.length, humans: ids.slice(i, i + size), bots: 0, allowBots: g.allowBots !== false };
      for (const id of t.humans) humanTeam.set(id, t.id);
      teams.push(t);
    }
  }
  const total = Math.max(teams.length, Math.floor((slots || size) / size));
  if (bots) {
    for (const t of teams) if (t.allowBots) t.bots = size - t.humans.length;
    while (teams.length < total) teams.push({ id: teams.length, humans: [], bots: size, allowBots: true });
  }
  const botTeams = [];
  for (const t of teams) for (let i = 0; i < t.bots; i++) botTeams.push(t.id);
  return { size, teams, humanTeam, botTeams };
}

/**
 * Human groups for a hosted match: the listed teams (ids present in `humans` only), then every
 * unlisted human packed in id order into listed teams that allow bots (fill) and have room,
 * then into new teams.
 */
export function packHumans(mode, humans, humanTeams) {
  const size = teamSize(mode);
  const present = new Set(humans);
  const used = new Set();
  const groups = [];
  for (const t of humanTeams || []) {
    const ids = (t && Array.isArray(t.ids) ? t.ids : []).filter((id) => present.has(id) && !used.has(id));
    if (!ids.length) continue;
    for (const id of ids) used.add(id);
    groups.push({ ids, allowBots: t.allowBots !== false });
  }
  const rest = humans.filter((id) => !used.has(id)).sort((a, b) => a - b);
  for (const id of rest) {
    let g = groups.find((x) => x.allowBots && x.ids.length < size);
    if (!g) groups.push((g = { ids: [], allowBots: true }));
    g.ids.push(id);
  }
  return groups;
}

// ------------------------------------------------------------------ runtime helpers

/** Two different actors on the same team. */
export function sameTeam(a, b) {
  return !!a && !!b && a !== b && a.team != null && a.team === b.team;
}

/** Alive and not knocked. */
export function standing(a) {
  return !!a && a.alive && !a.downed;
}

const _teams = new Set();
/** Number of teams with anyone alive (an actor without a team counts as its own). */
export function aliveTeamCount(actors) {
  _teams.clear();
  for (const a of actors) if (a.alive) _teams.add(a.team != null ? a.team : 'id' + a.id);
  return _teams.size;
}

/** Number of distinct teams among `actors`. */
export function teamCount(actors) {
  _teams.clear();
  for (const a of actors) _teams.add(a.team != null ? a.team : 'id' + a.id);
  return _teams.size;
}

/** Any member of `team` alive (other than `except`). */
export function teamAlive(actors, team, except = null) {
  for (const a of actors) if (a !== except && a.alive && a.team === team) return true;
  return false;
}

/** Any member of `team` alive and not knocked (other than `except`). */
export function teamStanding(actors, team, except = null) {
  for (const a of actors) if (a !== except && a.alive && !a.downed && a.team === team) return true;
  return false;
}
