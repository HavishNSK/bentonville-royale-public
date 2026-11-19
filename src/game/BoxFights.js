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
  winRounds: 3,
  firstWarmup: 5,
  warmup: 5, // every round: the middle wall stays down this long, then lifts at FIGHT
  roundEndDelay: 3,
  matchEndDelay: 3,
  origin: { x: -240, z: 160 },
  floorY: 300,
  levels: 2,
  cells: { 1: 6, 2: 8, 3: 10, 4: 10 },
  health: 100,
  shield: 100,
  killDepth: 20,
});

const MAT_MAX = 500;
const kit = (weapons, shells, extraAmmo) => ({
  items: [
    ...weapons,
    { type: 'consumable', id: 'tonic', count: 2 },
    { type: 'consumable', id: 'medkit', count: 2 },
  ],
  ammo: { shells, ...extraAmmo },
  mats: { wood: MAT_MAX, brick: MAT_MAX, metal: MAT_MAX },
  selected: 0,
});
const w = (id, rarity) => ({ type: 'weapon', id, rarity });

// one kit for everyone (the id stays so stray / older values normalise to it)
export const BOX_LOADOUT_IDS = Object.freeze(['pump']);

/** Loadout presets in Inventory.reset() shape. Deep-frozen; use boxLoadout() for a mutable copy. */
export const BOX_LOADOUTS = deepFreeze({
  pump: kit([w('shotgun', 'epic'), w('rifle', 'epic'), w('smg', 'rare')], 30, { medium: 180, light: 240 }),
});

/** The id if it is a known preset, else null. Whitelist lookup only: never indexes by the input. */
export const boxLoadoutId = (v) => (typeof v === 'string' && BOX_LOADOUT_IDS.includes(v) ? v : null);
export const normalizeBoxLoadout = (v) => boxLoadoutId(v) || 'pump';

const clone = (o) => JSON.parse(JSON.stringify(o));

/** A fresh, mutable copy of a preset (unknown ids become 'pump'). */
export function boxLoadout(id = 'pump') {
  return clone(BOX_LOADOUTS[normalizeBoxLoadout(id)]);
}

/** One preset id, uniformly; tolerant of an rng that returns NaN or values outside [0, 1). */
export function pickBoxLoadout(rng = Math.random) {
  const r = Number(typeof rng === 'function' ? rng() : NaN);
  const f = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0;
  return BOX_LOADOUT_IDS[Math.floor(f * BOX_LOADOUT_IDS.length)];
}

/** Team size 1|2|3|4; anything else (incl. NaN, objects, 0, 5) becomes 1. Numeric strings are accepted. */
export function normalizeBoxSize(n) {
  const v = typeof n === 'string' && /^[1-4]$/.test(n.trim()) ? Number(n) : n;
  return v === 1 || v === 2 || v === 3 || v === 4 ? v : 1;
}

const MODES = ['solo', 'duo', 'trio', 'squad'];
export const boxMode = (size) => MODES[normalizeBoxSize(size) - 1];
export function boxSizeForMode(mode) {
  const i = MODES.indexOf(mode);
  return i < 0 ? null : i + 1;
}

const layouts = new Map();

/** Arena geometry for a team size. Memoised: the same deep-frozen object is returned per size. */
export function arenaLayout(size) {
  size = normalizeBoxSize(size);
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
  // the middle wall: full width, floor to ceiling, between the two teams until FIGHT (it lifts)
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

export function createBoxFightState({ winRounds = BOX_FIGHT.winRounds } = {}) {
  return { phase: 'warmup', t: BOX_FIGHT.firstWarmup, round: 1, score: [0, 0], winner: null, winRounds };
}

/** Advance the round machine. Pure: returns { state, events }. Draws still advance the round counter. */
export function stepBoxFight(state, dt, aliveBySide) {
  const s = { ...state, score: [...state.score] };
  const events = [];
  const alive = aliveBySide || [1, 1];
  if (s.phase === 'warmup') {
    s.t -= dt;
    if (s.t <= 0) { s.t = 0; s.phase = 'fight'; events.push({ type: 'fight', round: s.round }); }
  } else if (s.phase === 'fight') {
    const a0 = alive[0] > 0;
    const a1 = alive[1] > 0;
    if (!a0 || !a1) {
      const winnerSide = !a0 && !a1 ? null : a0 ? 0 : 1;
      if (winnerSide !== null) s.score[winnerSide] += 1;
      events.push({ type: 'roundEnd', round: s.round, winnerSide, score: [...s.score] });
      if (winnerSide !== null && s.score[winnerSide] >= s.winRounds) {
        s.phase = 'matchEnd';
        s.winner = winnerSide;
        s.t = BOX_FIGHT.matchEndDelay;
        events.push({ type: 'matchEnd', winnerSide, score: [...s.score] });
      } else {
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

const sideOr0 = (side) => (side === 1 ? 1 : 0);

export function roundBanner(state, mySide) {
  const me = sideOr0(mySide);
  return `ROUND ${state.round} · ${state.score[me]}–${state.score[1 - me]}`;
}

export function boxResultCopy({ victory, size, score }) {
  const n = normalizeBoxSize(size);
  const tile = `${score[0]}–${score[1]}`;
  return {
    title: victory ? 'BOX FIGHT WON' : 'BOX FIGHT LOST',
    sub: `You ${victory ? 'won' : 'lost'} ${tile} in ${n}V${n} Box Fights.`,
    tile,
  };
}

/** Which side (0|1) a team id is on, or -1. */
export function sideOfTeam(sides, team) {
  if (!Array.isArray(sides)) return -1;
  return sides[0] === team ? 0 : sides[1] === team ? 1 : -1;
}
