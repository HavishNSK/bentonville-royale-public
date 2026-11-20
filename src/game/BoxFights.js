// BENTONVILLE ROYALE — Box Fights: pure rules, arena layout and round state machine.
// No THREE, no DOM. World coordinates: metres, x east, z south, y up. Heading 0 faces north (-z);
// the forward vector is (sin h, -cos h), so heading PI faces south (+z).
import { BUILD } from '../core/config.js';

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

export const BOX_FIGHT = deepFreeze({
  winRounds: 5, // team modes: first to this many round wins (host-configurable, minWinRounds..maxWinRounds)
  minWinRounds: 1,
  maxWinRounds: 9,
  // free-for-all: everyone on their own; a round ends when one player is left; the match ends after
  // `rounds` rounds (most eliminations wins) or as soon as someone reaches `elimTarget` eliminations
  ffa: { rounds: 10, elimTarget: 15, minPlayers: 2, maxPlayers: 6, players: 6 },
  firstWarmup: 5,
  warmup: 5, // every round: the middle wall stays down this long, then lifts at FIGHT
  roundEndDelay: 3,
  matchEndDelay: 3,
  origin: { x: -240, z: 160 },
  floorY: 300,
  levels: 2,
  cells: { 1: 6, 2: 8, 3: 10, ffa: 10 },
  health: 100,
  shield: 100,
  killDepth: 20,
});

const MAT_MAX = 500;
const kit = (weapons, shells, extraAmmo) => ({
  items: [...weapons, { type: 'consumable', id: 'tonic', count: 2 }],
  ammo: { shells, ...extraAmmo },
  mats: { wood: MAT_MAX, brick: MAT_MAX, metal: MAT_MAX },
  selected: 0,
});
const w = (id, rarity) => ({ type: 'weapon', id, rarity });

// one kit for everyone, players and bots alike (src/core/botProfile.js loadout: 'standard'):
// pump shotgun, assault rifle, SMG, 2 shield potions, 500 of each material
export const BOX_LOADOUT_IDS = Object.freeze(['standard']);

/** Loadout presets in Inventory.reset() shape. Deep-frozen; use boxLoadout() for a mutable copy. */
export const BOX_LOADOUTS = deepFreeze({
  standard: kit([w('shotgun', 'epic'), w('rifle', 'epic'), w('smg', 'rare')], 30, { medium: 180, light: 240 }),
});

/** The id if it is a known preset, else null. Whitelist lookup only: never indexes by the input. */
export const boxLoadoutId = (v) => (typeof v === 'string' && BOX_LOADOUT_IDS.includes(v) ? v : null);
export const normalizeBoxLoadout = (v) => boxLoadoutId(v) || 'standard'; // incl. the old 'pump' id

const clone = (o) => JSON.parse(JSON.stringify(o));

/** A fresh, mutable copy of a preset (unknown ids become 'standard'). */
export function boxLoadout(id = 'standard') {
  return clone(BOX_LOADOUTS[normalizeBoxLoadout(id)]);
}

/** One preset id, uniformly; tolerant of an rng that returns NaN or values outside [0, 1). */
export function pickBoxLoadout(rng = Math.random) {
  const r = Number(typeof rng === 'function' ? rng() : NaN);
  const f = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
  return BOX_LOADOUT_IDS[Math.floor(f * BOX_LOADOUT_IDS.length)];
}

/** Team size 1|2|3 (1v1..3v3); anything else (incl. NaN, objects, 0, 4) becomes 1. Numeric strings are accepted. */
export function normalizeBoxSize(n) {
  const v = typeof n === 'string' && /^[1-3]$/.test(n.trim()) ? Number(n) : n;
  return v === 1 || v === 2 || v === 3 ? v : 1;
}

/** Box Fights modes: three team modes (team size 1..3) and free-for-all. No 4v4 (max 6 per match). */
export const BOX_FIGHT_MODES = Object.freeze(['solo', 'duo', 'trio', 'ffa']);
const TEAM_MODES = ['solo', 'duo', 'trio'];
export const boxMode = (size) => TEAM_MODES[normalizeBoxSize(size) - 1];
/** Team size for a team mode id, else null (incl. 'ffa', which has no teams). */
export function boxSizeForMode(mode) {
  const i = TEAM_MODES.indexOf(mode);
  return i < 0 ? null : i + 1;
}
const LOBBY_IDS = ['1v1', '2v2', '3v3', 'ffa']; // party/lobbyRules.js LOBBY_MODES, same order
/** A Box Fights mode id ('solo'|'duo'|'trio'|'ffa'; the lobby's '1v1'|'2v2'|'3v3' map onto them), or null. Whitelist only. */
export function boxModeId(m) {
  if (typeof m !== 'string') return null;
  if (BOX_FIGHT_MODES.includes(m)) return m;
  const i = LOBBY_IDS.indexOf(m);
  return i < 0 ? null : BOX_FIGHT_MODES[i];
}

const intIn = (v, lo, hi) => {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** Rounds to win a team match: an integer in minWinRounds..maxWinRounds, else the default (5). */
export function normalizeWinRounds(n) {
  const v = intIn(n, BOX_FIGHT.minWinRounds, BOX_FIGHT.maxWinRounds);
  return v == null ? BOX_FIGHT.winRounds : v;
}

/** FFA player count: an integer 2..6, else the default (6). */
export function normalizeFfaPlayers(n) {
  const v = intIn(n, BOX_FIGHT.ffa.minPlayers, BOX_FIGHT.ffa.maxPlayers);
  return v == null ? BOX_FIGHT.ffa.players : v;
}

const BOT_DIFFS = ['easy', 'normal', 'hard'];

/**
 * One validated Box Fights match config from untrusted options (menu, lobby, a peer).
 * In: { mode: 'solo'|'duo'|'trio'|'ffa', size? (legacy 1..3), ffaPlayers?, winRounds?, botDifficulty?, fill? }
 * Out: { mode, ffa, teamSize, sides, slots, winRounds, botDifficulty (null = use the local setting), fill }
 *   team modes: 2 sides of teamSize (slots = 2 * teamSize); ffa: one side per player (slots = sides = ffaPlayers).
 *   FFA ignores winRounds (rounds / elimTarget come from BOX_FIGHT.ffa).
 */
export function boxMatchConfig(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const mode = boxModeId(o.mode) || boxMode(o.size);
  const ffa = mode === 'ffa';
  const teamSize = ffa ? 1 : boxSizeForMode(mode);
  const sides = ffa ? normalizeFfaPlayers(o.ffaPlayers) : 2;
  return {
    mode,
    ffa,
    teamSize,
    sides,
    slots: ffa ? sides : 2 * teamSize,
    winRounds: normalizeWinRounds(o.winRounds),
    botDifficulty: BOT_DIFFS.includes(o.botDifficulty) ? o.botDifficulty : null,
    fill: o.fill !== false,
  };
}

/** Arena key for a mode: 1 | 2 | 3 (team size) or 'ffa'. */
export const arenaKey = (mode) => (mode === 'ffa' ? 'ffa' : boxSizeForMode(mode) || 1);

const layouts = new Map();

/** Arena geometry for a team size (1..3) or 'ffa'. Memoised: the same deep-frozen object is returned per key. */
export function arenaLayout(size) {
  size = size === 'ffa' ? 'ffa' : normalizeBoxSize(size);
  if (layouts.has(size)) return layouts.get(size);
  const N = BOX_FIGHT.cells[size];
  const { floorY, levels, origin } = BOX_FIGHT;
  const ceilY = floorY + levels * BUILD.level;
  const w = N * BUILD.cell;
  const rect = { minX: origin.x, maxX: origin.x + w, minZ: origin.z, maxZ: origin.z + w };
  const center = { x: origin.x + w / 2, z: origin.z + w / 2 };
  const T = 1; // wall thickness
  const mk = (cx, cz, hx, hz, y0, y1) => ({ cx, cz, hx, hz, yaw: 0, y0, y1, kind: 'arena', mat: 'metal' });
  const wy0 = floorY - 1;
  const wy1 = ceilY + 1;
  const half = w / 2;
  const colliders = [
    mk(center.x, center.z, half, half, floorY - 1, floorY),
    mk(center.x, center.z, half, half, ceilY, ceilY + 1),
    mk(center.x, rect.minZ - T / 2, half + T, T / 2, wy0, wy1), // north
    mk(center.x, rect.maxZ + T / 2, half + T, T / 2, wy0, wy1), // south
    mk(rect.minX - T / 2, center.z, T / 2, half + T, wy0, wy1), // west
    mk(rect.maxX + T / 2, center.z, T / 2, half + T, wy0, wy1), // east
  ];
  // the middle wall: full width, floor to ceiling, between the two teams until FIGHT (it lifts).
  // FFA layouts have the same shape but Game never raises it there (no teams to keep apart).
  const midZ = rect.minZ + w / 2;
  const divider = mk(center.x, midZ, half + T, 0.25, wy0, wy1);
  const dividerBlock = { minX: rect.minX - T, maxX: rect.maxX + T, minZ: midZ - 0.6, maxZ: midZ + 0.6 };
  const layout = deepFreeze({
    size, cells: N, rect, floorY, ceilY, center, colliders, divider, dividerBlock,
    buildArea: { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, minY: floorY, maxY: ceilY },
    bounds: { minX: rect.minX - 1, maxX: rect.maxX + 1, minZ: rect.minZ - 1, maxZ: rect.maxZ + 1 },
    killY: floorY - BOX_FIGHT.killDepth,
  });
  layouts.set(size, layout);
  return layout;
}

/** 2*size spawns: side 0 first (north end, facing south), then the point-mirrored side 1. */
export function spawnLayout(layout, size) {
  size = normalizeBoxSize(size);
  const N = layout.cells;
  const start = Math.floor(N / 2) - size;
  const out = [];
  const at = (side, slot, i, j, heading) => ({
    side, slot, cell: { i, j },
    x: layout.rect.minX + (i + 0.5) * BUILD.cell,
    y: layout.floorY,
    z: layout.rect.minZ + (j + 0.5) * BUILD.cell,
    heading,
  });
  for (let k = 0; k < size; k++) out.push(at(0, k, start + 2 * k, 1, Math.PI));
  for (let k = 0; k < size; k++) out.push(at(1, k, N - 1 - (start + 2 * k), N - 2, 0));
  return out;
}

/**
 * FFA: `n` (2..6) spawns, one per side, spread evenly round the ring of cells one in from the arena
 * wall (cells 1..N-2 on the edge rows / columns), each facing the centre. Consecutive spawns are at
 * least 4 cells apart along the ring, so every pair of boxes has at least one empty cell between
 * them (Chebyshev distance >= 2).
 */
export function ffaSpawnLayout(layout, n) {
  n = normalizeFfaPlayers(n);
  const N = layout.cells;
  const lo = 1;
  const hi = N - 2;
  const ring = [];
  for (let i = lo; i < hi; i++) ring.push([i, lo]); // north row, west -> east
  for (let j = lo; j < hi; j++) ring.push([hi, j]); // east column, north -> south
  for (let i = hi; i > lo; i--) ring.push([i, hi]); // south row, east -> west
  for (let j = hi; j > lo; j--) ring.push([lo, j]); // west column, south -> north
  const out = [];
  for (let k = 0; k < n; k++) {
    const [i, j] = ring[Math.round((k * ring.length) / n) % ring.length];
    const x = layout.rect.minX + (i + 0.5) * BUILD.cell;
    const z = layout.rect.minZ + (j + 0.5) * BUILD.cell;
    // forward = (sin h, -cos h) points at the centre
    const heading = Math.atan2(layout.center.x - x, -(layout.center.z - z));
    out.push({ side: k, slot: 0, cell: { i, j }, x, y: layout.floorY, z, heading });
  }
  return out;
}

/** The 1x1 starting box around a spawn cell, as Structures.place() placements. */
export function spawnBoxPieces(spawn, floorY) {
  const C = BUILD.cell;
  const cx = spawn.x;
  const cz = spawn.z;
  const x0 = cx - C / 2;
  const z0 = cz - C / 2;
  const q = Math.PI / 2;
  return [
    { kind: 'wall', x: cx, y: floorY, z: z0, rot: 0 },
    { kind: 'wall', x: cx, y: floorY, z: z0 + C, rot: 0 },
    { kind: 'wall', x: x0, y: floorY, z: cz, rot: q },
    { kind: 'wall', x: x0 + C, y: floorY, z: cz, rot: q },
    { kind: 'cone', x: cx, y: floorY + BUILD.level, z: cz, rot: 0 },
  ];
}

/**
 * Round machine state. Team modes: 2 sides, first to `winRounds`. FFA (`ffa: true`): one side per
 * player (`sides`), `maxRounds` rounds or first to `elimTarget` eliminations. `score` counts rounds
 * won per side; `elims` eliminations per side (credited with boxElim).
 */
export function createBoxFightState({ winRounds = BOX_FIGHT.winRounds, ffa = false, sides = 2 } = {}) {
  const n = ffa ? normalizeFfaPlayers(sides) : 2;
  const s = { phase: 'warmup', t: BOX_FIGHT.firstWarmup, round: 1, score: Array(n).fill(0), elims: Array(n).fill(0), winner: null, winRounds: normalizeWinRounds(winRounds), ffa: !!ffa };
  if (ffa) {
    s.maxRounds = BOX_FIGHT.ffa.rounds;
    s.elimTarget = BOX_FIGHT.ffa.elimTarget;
  }
  return s;
}

/**
 * Sides ranked best first: most eliminations, then most rounds won, then side index.
 * Returns [{ side, elims, rounds, place }]; equal elims and rounds share a place.
 */
export function boxStandings(elims, score) {
  const e = Array.isArray(elims) ? elims : [];
  const r = Array.isArray(score) ? score : [];
  const n = Math.max(e.length, r.length);
  const rows = Array.from({ length: n }, (_, side) => ({ side, elims: e[side] | 0, rounds: r[side] | 0, place: 0 }));
  rows.sort((a, b) => b.elims - a.elims || b.rounds - a.rounds || a.side - b.side);
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.place = prev && prev.elims === row.elims && prev.rounds === row.rounds ? prev.place : i + 1;
  });
  return rows;
}

/** FFA winner: the side with the most eliminations (ties: most rounds won); null on a full tie. */
export function ffaWinner(elims, score) {
  const [a, b] = boxStandings(elims, score);
  if (!a) return null;
  return b && b.place === a.place ? null : a.side;
}

const matchEndEvent = (s, winnerSide) => ({ type: 'matchEnd', winnerSide, score: [...s.score], elims: [...s.elims] });

function endMatch(s, winnerSide, events) {
  s.phase = 'matchEnd';
  s.winner = winnerSide;
  s.t = BOX_FIGHT.matchEndDelay;
  events.push(matchEndEvent(s, winnerSide));
}

/**
 * Advance the round machine. Pure: returns { state, events }. `aliveBySide[i]` = side i's actors
 * alive (missing = 0; no array = everyone alive). A fight round ends when at most one side has
 * anyone alive; that side scores the round (none alive = a draw, still advances the round).
 */
export function stepBoxFight(state, dt, aliveBySide) {
  const s = { ...state, score: [...state.score], elims: [...(state.elims || state.score.map(() => 0))] };
  const events = [];
  const n = s.score.length;
  const alive = Array.isArray(aliveBySide) ? aliveBySide : Array(n).fill(1);
  if (s.phase === 'warmup') {
    s.t -= dt;
    if (s.t <= 0) { s.t = 0; s.phase = 'fight'; events.push({ type: 'fight', round: s.round }); }
  } else if (s.phase === 'fight') {
    const standing = [];
    for (let i = 0; i < n; i++) if (alive[i] > 0) standing.push(i);
    if (standing.length <= 1) {
      const winnerSide = standing.length === 1 ? standing[0] : null;
      if (winnerSide !== null) s.score[winnerSide] += 1;
      events.push({ type: 'roundEnd', round: s.round, winnerSide, score: [...s.score] });
      if (s.ffa && s.round >= s.maxRounds) endMatch(s, ffaWinner(s.elims, s.score), events);
      else if (!s.ffa && winnerSide !== null && s.score[winnerSide] >= s.winRounds) endMatch(s, winnerSide, events);
      else {
        s.phase = 'roundEnd';
        s.t = BOX_FIGHT.roundEndDelay;
      }
    }
  } else if (s.phase === 'roundEnd') {
    s.t -= dt;
    if (s.t <= 0) {
      s.round += 1;
      s.phase = 'warmup';
      s.t = BOX_FIGHT.warmup;
      events.push({ type: 'roundStart', round: s.round });
    }
  } else if (s.phase === 'matchEnd' && s.t > 0) {
    s.t = Math.max(0, s.t - dt);
    if (s.t === 0) events.push({ type: 'matchOver' });
  }
  return { state: s, events };
}

/**
 * Credit one elimination to `killerSide` (pure: { state, events }). Only during a fight, and never
 * for a self / same-side elimination or an unknown side. FFA: reaching elimTarget ends the match.
 */
export function boxElim(state, killerSide, victimSide) {
  const n = state.score.length;
  if (state.phase !== 'fight' || !Number.isInteger(killerSide) || killerSide < 0 || killerSide >= n || killerSide === victimSide) return { state, events: [] };
  const s = { ...state, score: [...state.score], elims: [...(state.elims || Array(n).fill(0))] };
  const events = [];
  s.elims[killerSide] += 1;
  if (s.ffa && s.elims[killerSide] >= s.elimTarget) endMatch(s, killerSide, events);
  return { state: s, events };
}

const sideOr0 = (side) => (side === 1 ? 1 : 0);

/** Banner title: team 'ROUND 2 · 1–0' (your side first); FFA 'ROUND 2/10 · 3 ELIMS'. */
export function roundBanner(state, mySide) {
  if (state.ffa) {
    const e = state.elims && Number.isInteger(mySide) ? state.elims[mySide] | 0 : 0;
    return `ROUND ${state.round}/${state.maxRounds || BOX_FIGHT.ffa.rounds} · ${e} ELIM${e === 1 ? '' : 'S'}`;
  }
  const me = sideOr0(mySide);
  return `ROUND ${state.round} · ${state.score[me]}–${state.score[1 - me]}`;
}

/**
 * Result copy. Team: { victory, size, score:[us, them] }. FFA: { victory, ffa: true, place, players,
 * elims, draw? } (place 1-based; draw = tied for first, nobody won).
 */
export function boxResultCopy({ victory, size, score, ffa = false, place = 0, players = 0, elims = 0, draw = false }) {
  if (ffa) {
    const p = Math.max(1, place | 0);
    const e = Math.max(0, elims | 0);
    return {
      title: victory ? 'BOX FIGHT WON' : draw ? 'BOX FIGHT DRAW' : 'BOX FIGHT LOST',
      sub: `You placed #${p} of ${Math.max(p, players | 0)} with ${e} elimination${e === 1 ? '' : 's'} in Box Fights FFA.`,
      tile: `#${p}`,
    };
  }
  const n = normalizeBoxSize(size);
  const tile = `${score[0]}–${score[1]}`;
  return {
    title: victory ? 'BOX FIGHT WON' : 'BOX FIGHT LOST',
    sub: `You ${victory ? 'won' : 'lost'} ${tile} in ${n}V${n} Box Fights.`,
    tile,
  };
}

/** Which side a team id is on (index into `sides`), or -1. */
export function sideOfTeam(sides, team) {
  if (!Array.isArray(sides) || team == null) return -1;
  return sides.indexOf(team);
}

/**
 * Who takes a leaving human's place (pure). Box Fights: a bot on the same team / side, with the
 * same actor id (clients already have a puppet for it) and the same stats row. `at`: the leaver
 * alive and fighting -> where they stood with their health; alive in warmup -> their spawn box;
 * dead (or between rounds) -> spawns out of play until the next round start.
 * Returns { id, team, side, alive, pos: {x,y,z,heading} | null, health, shield } or null.
 */
export function boxReplacement({ leaver, side, phase, spawn = null, vitals = { health: BOX_FIGHT.health, shield: BOX_FIGHT.shield } }) {
  if (!leaver || !Number.isInteger(leaver.id) || !Number.isInteger(side) || side < 0) return null;
  const p = leaver.pos || {};
  const here = [p.x, p.y, p.z].every(Number.isFinite) ? { x: p.x, y: p.y, z: p.z, heading: Number.isFinite(leaver.heading) ? leaver.heading : 0 } : null;
  const live = !!leaver.alive && (phase === 'fight' || phase === 'warmup');
  const pos = phase === 'warmup' && spawn ? { x: spawn.x, y: spawn.y, z: spawn.z, heading: spawn.heading || 0 } : here || spawn;
  return {
    id: leaver.id,
    team: leaver.team,
    side,
    alive: live && !!pos,
    pos: pos || null,
    health: phase === 'fight' && live ? Math.max(1, leaver.health | 0) : vitals.health,
    shield: phase === 'fight' && live ? Math.max(0, leaver.shield | 0) : vitals.shield,
  };
}

const cleanBotName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '');

/**
 * Hosted match: lobby slots -> sides (pure; slots and names are untrusted lobby / peer data).
 *   cfg: boxMatchConfig(...)
 *   slots: [{ kind: 'human'|'bot'|'open', name?, team?: 0|1|null, token?, clientId?: room client id (host 0), host? }]
 *     or null — the lobby's slot list as is ('open' slots are ignored; other fields such as the lobby's
 *     own `id` are ignored too)
 *   humans: [{ id: room client id, token? }] connected now (host id 0 included)
 * Order: the host, then humans matched to a slot (clientId, else token; `host: true` = id 0) take their slot's side; connected
 * humans without a slot take free places (no room: kicked, never the host); bot slots and human slots
 * nobody connected for become bots where there is room. Then bots fill: team modes always to teamSize
 * on both sides (equal teams); FFA to cfg.sides when cfg.fill, and always to at least 2 sides.
 * FFA side = slot order (compacted). Team side = slot.team when it has room, else the side with room.
 * Returns { humans: Map(id -> side), bots: [{ side, name }] (name '' = default), kick: [id], sides: n }.
 */
export function boxSlotPlan(cfg, slots, humans) {
  const n = cfg.sides;
  const cap = cfg.ffa ? 1 : cfg.teamSize;
  const count = Array(n).fill(0);
  const hs = (Array.isArray(humans) ? humans : []).filter((h) => h && Number.isInteger(h.id));
  const list = (Array.isArray(slots) ? slots : []).slice(0, cfg.slots).map((s, k) => (s && typeof s === 'object' ? { s, k } : null)).filter(Boolean);
  const free = (want) => {
    if (Number.isInteger(want) && want >= 0 && want < n && count[want] < cap) return want;
    if (!cfg.ffa) {
      // the side with the fewest players and room (keeps teams level)
      let best = -1;
      for (let i = 0; i < n; i++) if (count[i] < cap && (best < 0 || count[i] < count[best])) best = i;
      return best;
    }
    return count.findIndex((c) => c < cap);
  };
  const want = ({ s, k }) => (cfg.ffa ? k : s.team === 0 || s.team === 1 ? s.team : null);
  const humanSide = new Map();
  const kick = [];
  const taken = new Set(); // slot indices used by a connected human
  const matches = (h, s) =>
    s.kind === 'human' &&
    (Number.isInteger(s.clientId) ? s.clientId === h.id : (s.host === true && h.id === 0) || (typeof s.token === 'string' && s.token !== '' && s.token === h.token));
  const host = hs.find((h) => h.id === 0);
  const order = host ? [host, ...hs.filter((h) => h !== host)] : hs;
  const pending = [];
  for (const h of order) {
    const slot = list.find((x) => !taken.has(x.k) && matches(h, x.s));
    if (slot) {
      taken.add(slot.k);
      const side = free(want(slot));
      if (side >= 0) {
        count[side]++;
        humanSide.set(h.id, side);
        continue;
      }
    }
    pending.push(h);
  }
  for (const h of pending) {
    const side = free(null);
    if (side >= 0) {
      count[side]++;
      humanSide.set(h.id, side);
    } else if (h.id === 0) {
      // the host always plays: it takes the place of the last guest placed (who is sent away)
      const last = [...humanSide.keys()].pop();
      if (last == null) continue; // cannot happen: no room means someone holds a place
      humanSide.set(h.id, humanSide.get(last));
      humanSide.delete(last);
      kick.push(last);
    } else kick.push(h.id);
  }
  const bots = [];
  for (const x of list) {
    if (taken.has(x.k) || (x.s.kind !== 'bot' && x.s.kind !== 'human')) continue;
    const side = free(want(x));
    if (side < 0) continue;
    count[side]++;
    bots.push({ side, name: x.s.kind === 'bot' ? cleanBotName(x.s.name) : '' });
  }
  const fillTo = (side) => {
    while (count[side] < cap) {
      count[side]++;
      bots.push({ side, name: '' });
    }
  };
  if (!cfg.ffa) for (let i = 0; i < n; i++) fillTo(i);
  else {
    let used = count.filter((c) => c > 0).length;
    for (let i = 0; i < n && (cfg.fill || used < 2); i++) {
      if (count[i]) continue;
      fillTo(i);
      used++;
    }
  }
  let sides = n;
  if (cfg.ffa) {
    // compact: occupied sides become 0..m-1 in slot order
    const map = [];
    count.forEach((c, i) => c && (map[i] = map.filter((v) => v != null).length));
    for (const [id, side] of humanSide) humanSide.set(id, map[side]);
    for (const b of bots) b.side = map[b.side];
    sides = count.filter(Boolean).length;
  }
  return { humans: humanSide, bots, kick, sides };
}
