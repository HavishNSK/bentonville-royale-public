// BENTONVILLE ROYALE — Bentonville High School kit: palette (pure data).
// Game albedos from docs/bhs/STYLE_BIBLE.md §1 (sampled from the reference photos, lifted where the
// sample was shaded; see the bible). Change a colour HERE and in the bible together.

export const PAL = Object.freeze({
  // exterior
  brick: 0x7a3f31,
  brickBand: 0x8a4532,
  mortar: 0x8d8780,
  buffStone: 0xb89c78, // cast-stone lintels / sills
  cmuLight: 0xd8cfc4, // North Building entry tower
  buffBrick: 0xb59d80, // south building piers / bands
  buffFascia: 0xcdbfa6,
  metalWhite: 0xe9e9e6,
  metalGrey: 0x9a9893,
  glass: 0x6f8e92,
  alu: 0xb9bcbe,
  canopy: 0xd7d5d1,
  paving: 0xc2b8a8,
  roof: 0xe6e6e2,
  roofPad: 0xb7b6b1,
  coping: 0xdcdbd6,
  // commons (North Building)
  wood: 0xa5764f,
  woodLit: 0xb38655,
  woodReveal: 0x3b2a1e,
  blockGrey: 0xa3a6aa,
  column: 0xb4b3b2,
  floorDark: 0x4e4540,
  floorLight: 0x958c82, // nearer the sampled #91887f: the lifted value read flat cream (QA)
  banner: 0x2b3036,
  // library
  libWall: 0xe4e4e1,
  libPier: 0x9a6f55,
  carpet: 0x5b5a5e,
  carpetBand: 0x7a3a3a,
  shelfWood: 0xc49d72,
  shelfEnd: 0xecebe8,
  // Arend Arts Center theatre
  seat: 0x1c1c1e,
  stageWood: 0xb48a68,
  acoustic: 0x8d8070,
  aacCeiling: 0xb8b2a8,
  valance: 0x8a5524,
  // fill (approximate: no photos; bible §2 / §4)
  vct: 0xd9d2c3,
  vctAccent: 0xa8a49c,
  ceilingTile: 0xe8e6e1,
  paintWall: 0xe2ddd2,
  doorWood: 0xa77a52,
  doorFrame: 0x5d6064,
  locker: 0x2f4f7a,
  base: 0x4a4644,
  // classroom accents (bible §5)
  accents: Object.freeze([0x7a3f31, 0xa5764f, 0x2b3036, 0x7a3a3a, 0x6f8e92, 0xb59d80]),
});

/** Standard sizes (m). Bible: doors 2.1 m, risers ~0.17 m, floor-to-floor 4.4 m. */
export const SIZE = Object.freeze({
  storey: 4.4,
  slab: 0.3,
  door: 2.1,
  doorW: 0.95,
  riser: 0.17,
  tread: 0.29,
  rail: 1.07,
  wallExt: 0.35,
  wallInt: 0.2,
  parapet: 1.0,
});
