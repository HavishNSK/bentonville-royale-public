// BENTONVILLE ROYALE — BHS classrooms: small pure helpers (seeded RNG, colours, outline tests).
// Classroom detailing is APPROXIMATE (no classroom photos): typical US high school, in the
// style-bible palette (docs/bhs/STYLE_BIBLE.md §4-5).

import { PAL } from '../../kit/palette.js';
import { inPoly } from '../../kit/plan.js';
import { NORTH_OUTLINE, NORTH_COURT } from '../../north.js';
import { SOUTH_OUTLINE } from '../../south.js';

/** FNV-1a 32-bit hash of a string. */
export function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small seeded RNG in [0, 1). */
export function seeded(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Building of a plan room: rooms carry no building name; the North Building is z < 280. */
export const buildingOf = (room) => ((room.z0 + room.z1) / 2 < 280 ? 'north' : 'south');

/** Room seed: building + id + rect (ids repeat between the two buildings). */
export const roomKey = (room) => `${buildingOf(room)}:${room.id}:${room.level}:${room.x0}:${room.z0}`;

const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
const mix = (a, b, t) => {
  const ch = (c, s) => (c >> s) & 255;
  const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
};

/**
 * A fixed colour set (one merged mesh per look per group, so props share a small palette instead of
 * jittered colours). Accents come from PAL.accents (bible §5); each gets a light and a dark shade.
 */
export const ACCENTS = PAL.accents.map((a) => ({ base: hex(a), light: hex(mix(a, 0xffffff, 0.45)), dark: hex(mix(a, 0x000000, 0.35)), paper: hex(mix(a, 0xffffff, 0.7)) }));

export const C = Object.freeze({
  white: '#f2f1ec',
  board: '#f6f7f4',
  boardFrame: '#b9bcbe',
  black: '#1c1c1e',
  charcoal: '#2e3033',
  grey: '#6d6f72',
  greyLight: '#a9abad',
  steel: '#c4c7c9',
  screen: '#22323f',
  screenLit: '#9fc3dd',
  cork: '#b98b5a',
  woodLight: '#c49d72',
  woodMid: '#a5764f',
  woodDark: '#6e4e35',
  laminate: '#d9cdb5',
  labTop: '#151617',
  plasticBlue: '#3c5f8f',
  recycle: '#2f6fb0',
  green: '#4f7d3f',
  greenDark: '#355a2c',
  pot: '#a0522d',
  soil: '#4a3426',
  safety: '#d8c22a',
  red: '#b23a32',
  navy: '#2b3036',
  cream: '#efe6d2',
  blind: '#e7e3d8',
  blindGrey: '#c9c9c4',
  blindTan: '#d8ccb2',
  rug: '#5b5a5e',
  clay: '#9b6b4b',
  kiln: '#8d9092',
  chrome: '#d6d8da',
  skin: '#c9a27f',
});

/** Bulletin-board paper and poster colours: colour blocks only, no readable text. */
export const PAPER = Object.freeze(['#e9c44a', '#4f86c6', '#d4553f', '#5aa469', '#e58f3c', '#8e6bb8', '#f2ede0', '#4bb0b0']);
/** Book spines. */
export const BOOKS = Object.freeze(['#7a3a3a', '#2b3036', '#4f6d3a', '#a5764f', '#3c5f8f', '#c2a14a', '#6f8e92']);
/** Backpacks and hoodies. */
export const BAGS = Object.freeze(['#2b3036', '#7a3a3a', '#3c5f8f', '#4f6d3a', '#1c1c1e', '#8a5524', '#6d6f72']);

// ------------------------------------------------------------------ outline tests

const OUTLINES = {
  north: { outline: NORTH_OUTLINE, courts: [NORTH_COURT] },
  south: { outline: SOUTH_OUTLINE, courts: [] },
};

function segDist(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}

/** Distance from (x, z) to the nearest exterior or court wall centre line of a building. */
export function wallDistance(building, x, z) {
  const B = OUTLINES[building];
  let d = Infinity;
  for (const p of [B.outline, ...B.courts]) for (let i = 0; i < p.length; i++) d = Math.min(d, segDist(x, z, p[i], p[(i + 1) % p.length]));
  return d;
}

/**
 * Is (x, z) inside the building (outline minus courtyards) and at least `margin` metres from its
 * exterior wall centre lines? Classroom props use this to skip spots that rooms clipped by the
 * outline leave outside (margin 0.6 for a prop centre; ~0.2 for footprint corners: half the 0.35 m
 * exterior wall plus a little).
 */
export function insideOutline(building, x, z, margin = 0.6) {
  const B = OUTLINES[building];
  if (!B || !inPoly(B.outline, x, z)) return false;
  if (B.courts.some((c) => inPoly(c, x, z))) return false;
  return margin <= 0 || wallDistance(building, x, z) >= margin;
}

export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
export const range = (rnd, a, b) => a + (b - a) * rnd();
