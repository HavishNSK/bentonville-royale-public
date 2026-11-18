// BENTONVILLE ROYALE — Crystal Bridges site plan (pure data + pure functions; no three.js).
//
// Game coordinates: metres, x east, z south (north = -z), y up. Street / crest level is y = 0.
// Layout from docs/crystal-bridges-layout.md (which cites docs/crystal-bridges-research.md): the
// OSM outline of building 8240824 (and its two inner holes), the OSM pond relation, the museum's
// Inside Guide floor plan, venue map and architecture audio-tour script. Real levels are scaled
// to ~0.65 so the ravine (16–20 m deep in the 2015 lidar) plays as ~11–13 m.
//
// A pavilion is an axis-aligned rectangle { x0, x1, z0, z1 } with a floor level, a wall height
// and a roof. Each side (n = -z edge, s = +z, w = -x, e = +x) is a list of spans { t, a, b }
// along the side (x for n/s, z for w/e) where t is:
//   'wall'  concrete with cedar bands       'glass' breakable floor-to-ceiling panes
//   'door'  opening (lintel above `head`)  'open'  nothing (a neighbour's wall / door is there)
// Unlisted stretches of a side are 'wall'. A door may carry `sill` (absolute y of its threshold,
// for an upper-level door in a tall wall). `bow` on a side bows that wall outward (sagitta, m).

export const LEVEL = Object.freeze({
  CREST: 0, // Museum Way, the parking deck, the ridges
  MAIN: -7, // Garrison Lobby, Eleven, Early American galleries, Great Hall + corridor
  LOWER: -11, // Modern Art bridge, Contemporary, Lower North Gallery, 2026 expansion
  SOUTH_POND: -10.4, // "upper pond" (audio tour): Great Hall stands in it
  NORTH_POND: -13, // "lower pond", ~2.6 m below over the weir under Eleven (real: 10–12 ft)
  EXP_POND: -13.4, // 2026 expansion pond, below the labyrinth weir under the Modern Art bridge
});

const POND_DEPTH = 0.7; // wading depth (m) under each pond surface
const RUN = 34; // m from the water's edge to the crest
const EDGE = 16; // m: the ravine fades to street level at the tile edge

/** The crystal_bridges tile of the composed map (scripts/compose-map.mjs). */
export const TILE = Object.freeze({ x0: -125, x1: 125, z0: -480, z1: -135 });

/** Weir lines (z) that split the OSM pond ring into the three ponds, north to south. */
const WEIR_ELEVEN = -257; // under Eleven: south pond -> north pond
const WEIR_MODERN = -354; // labyrinth weir under the Modern Art bridge
/** Rectangle the OSM pond ring is clipped to (drops the SW inlet channel beyond the tile). */
const WATER_CLIP = Object.freeze({ x0: -60, x1: 45, z0: -440, z1: -158 });

/** Pond surface (y) for a point's z. */
export function pondSurface(z) {
  if (z > WEIR_ELEVEN) return LEVEL.SOUTH_POND;
  if (z > WEIR_MODERN) return LEVEL.NORTH_POND;
  return LEVEL.EXP_POND;
}

// --------------------------------------------------------------------- pavilions

const W = (a, b) => ({ t: 'wall', a, b });
const G = (a, b) => ({ t: 'glass', a, b });
const D = (a, b, extra) => ({ t: 'door', a, b, ...(extra || {}) });
const O = (a, b) => ({ t: 'open', a, b });

/**
 * Every pavilion, south to north. `wing` names the gallery entry in
 * public/data/crystal-bridges.config.json whose works hang here (null = no art).
 * roof: { type: 'convex' (cable-hung copper bridge roof, bulging up along the long axis) |
 *   'concave' (hillside: high on the ravine side `high`, curving down to the pond) |
 *   'dome' | 'vault' (barrel, across the long axis) | 'flat' | 'green' | 'sawtooth',
 *   rise, mat: 'copper' | 'steel' | 'concrete' | 'green' | 'glass' }
 */
export const PAVILIONS = Object.freeze([
  {
    id: 'south-lobby', name: 'South Lobby', x0: -30, x1: 34, z0: -176, z1: -158, floor: LEVEL.MAIN, height: 4.4,
    roof: { type: 'flat', mat: 'green' }, floorMat: 'oak', wing: null,
    sides: {
      s: [W(-30, -4), D(-4, 6), W(6, 34)],
      n: [W(-30, -28), O(-28, -20), G(-20, 12), W(12, 14), O(14, 32), W(32, 34)],
      e: [W(-176, -158)],
      w: [G(-176, -158)],
    },
  },
  {
    id: 'great-hall', name: 'Great Hall', x0: -34, x1: -18, z0: -200, z1: -176, floor: LEVEL.MAIN, height: 8.8,
    roof: { type: 'convex', rise: 2.2, mat: 'copper', along: 'z' }, floorMat: 'oak', ribs: true, wing: 'great-hall',
    sides: { s: [W(-34, -28), O(-28, -20), W(-20, -18)], n: [W(-34, -32), G(-32, -20), W(-20, -18)], w: [W(-200, -198), G(-198, -178), W(-178, -176)], e: [W(-200, -198), G(-198, -178), W(-178, -176)] },
  },
  {
    id: 'corridor', name: 'Great Hall Corridor', x0: 12, x1: 34, z0: -246, z1: -176, floor: LEVEL.MAIN, height: 5.5,
    roof: { type: 'flat', mat: 'copper', holes: [{ x0: 29.4, x1: 33.6, z0: -210, z1: -187 }] }, floorMat: 'oak', wing: 'corridor',
    sides: {
      w: [G(-246, -176)],
      e: [W(-246, -176)],
      n: [W(12, 14), O(14, 34)],
      s: [W(12, 14), O(14, 32), W(32, 34)],
    },
    bow: { w: 3.5 },
    ramps: [{ x: 31.5, hw: 1.9, z0: -188, z1: -210, y0: LEVEL.MAIN, y1: LEVEL.MAIN + 6.0 }],
  },
  {
    id: 'library', name: 'Library', x0: 22, x1: 34, z0: -236, z1: -180, floor: LEVEL.MAIN + 6.0, height: 4.2, noSlab: true,
    floorHoles: [{ x0: 29.4, x1: 33.6, z0: -210, z1: -187 }],
    roof: { type: 'flat', mat: 'copper' }, floorMat: 'oak', wing: 'library',
    sides: {
      w: [G(-236, -180)],
      e: [W(-236, -214), D(-214, -206), W(-206, -180)],
      n: [W(22, 34)],
      s: [W(22, 34)],
    },
  },
  {
    id: 'entry-tower', name: 'Entrance Hall', x0: 34, x1: 56, z0: -246, z1: -232, floor: LEVEL.MAIN, height: 11, wing: 'lobby',
    roof: { type: 'flat', mat: 'concrete' }, floorMat: 'oak',
    sides: {
      n: [O(34, 38), W(38, 56)],
      e: [W(-246, -242), D(-242, -236, { sill: LEVEL.CREST }), W(-236, -232)],
      w: [W(-246, -232)],
      s: [W(34, 40), G(40, 50), W(50, 56)],
    },
    ramps: [{ z: -239, hw: 2.6, x0: 56, x1: 39, y0: LEVEL.CREST, y1: LEVEL.MAIN }],
  },
  {
    id: 'lobby', name: 'Garrison Lobby', x0: 14, x1: 38, z0: -272, z1: -246, floor: LEVEL.MAIN, height: 7.5,
    roof: { type: 'dome', rise: 2.6, mat: 'glass' }, floorMat: 'oak', ribs: true, wing: 'lobby',
    sides: {
      s: [W(14, 16), O(16, 32), W(32, 34), O(34, 38)],
      w: [W(-272, -264), O(-264, -250), W(-250, -246)],
      n: [W(14, 16), D(16, 22), W(22, 32), O(32, 38)],
      e: [W(-272, -264), D(-264, -258), W(-258, -246)],
    },
  },
  {
    id: 'store', name: 'Museum Store', x0: 44, x1: 58, z0: -272, z1: -250, floor: LEVEL.MAIN, height: 4.6, wing: null,
    roof: { type: 'green', mat: 'green' }, floorMat: 'oak', store: true,
    sides: { w: [W(-272, -264), D(-264, -258), W(-258, -250)], n: [W(44, 58)], s: [W(44, 48), G(48, 56), W(56, 58)], e: [W(-272, -250)] },
  },
  {
    id: 'eleven', name: 'Eleven', x0: -40, x1: 14, z0: -264, z1: -250, floor: LEVEL.MAIN, height: 6.2, bridge: true,
    roof: { type: 'convex', rise: 2.6, mat: 'copper', along: 'x' }, floorMat: 'quartzite', ribs: true, wing: 'eleven',
    sides: { n: [W(-40, -38), G(-38, 12), W(12, 14)], s: [W(-40, -38), G(-38, 12), W(12, 14)], w: [O(-264, -250)], e: [O(-264, -250)] },
  },
  {
    id: 'west-tower', name: 'West Stair', x0: -60, x1: -40, z0: -272, z1: -248, floor: LEVEL.LOWER, height: 11, wing: null,
    roof: { type: 'flat', mat: 'concrete' }, floorMat: 'oak',
    sides: {
      e: [W(-272, -264), O(-264, -250), W(-250, -248)],
      n: [W(-60, -56), O(-56, -48), W(-48, -40)],
      s: [W(-60, -40)],
      w: [W(-272, -248)],
    },
    landings: [{ x0: -50, x1: -40, z0: -264, z1: -250, y: LEVEL.MAIN }],
    ramps: [{ x: -52.5, hw: 2.4, z0: -252, z1: -270, y0: LEVEL.MAIN, y1: LEVEL.LOWER }],
  },
  {
    id: 'early-american-1', name: 'Early American Art', x0: 32, x1: 54, z0: -296, z1: -272, floor: LEVEL.MAIN, height: 6.4,
    roof: { type: 'concave', rise: 2.4, mat: 'copper', high: 'e' }, floorMat: 'oak', ribs: true, wing: 'early-american',
    sides: { s: [O(32, 38), W(38, 54)], n: [W(32, 34), O(34, 50), W(50, 54)], w: [W(-296, -272)], e: [W(-296, -272)] },
    bow: { w: 2 },
    partitions: [{ x: 48.5, z0: -292, z1: -277, h: 4 }],
  },
  {
    id: 'east-terrace', name: 'East Terrace', x0: 34, x1: 50, z0: -304, z1: -296, floor: LEVEL.MAIN, height: 4.4, wing: null,
    roof: { type: 'flat', mat: 'copper' }, floorMat: 'oak',
    sides: { s: [O(34, 50)], n: [O(34, 50)], w: [G(-304, -296)], e: [G(-304, -296)] },
  },
  {
    id: 'early-american-2', name: 'People on the Move', x0: 32, x1: 54, z0: -336, z1: -304, floor: LEVEL.MAIN, height: 6.4,
    roof: { type: 'concave', rise: 2.4, mat: 'copper', high: 'e' }, floorMat: 'oak', ribs: true, wing: 'nineteenth',
    sides: { s: [W(32, 34), O(34, 50), W(50, 54)], n: [W(32, 46), O(46, 52), W(52, 54)], w: [W(-336, -304)], e: [W(-336, -304)] },
    bow: { w: 2.5 },
    partitions: [{ x: 38, z0: -330, z1: -312, h: 4 }],
  },
  {
    id: 'reflection', name: 'Reflection Room', x0: 32, x1: 54, z0: -350, z1: -336, floor: LEVEL.LOWER, height: 8, wing: null,
    roof: { type: 'flat', mat: 'copper' }, floorMat: 'oak',
    sides: { s: [W(32, 46), O(46, 52), W(52, 54)], n: [W(32, 34), O(34, 42), W(42, 54)], w: [G(-350, -336)], e: [W(-350, -336)] },
    ramps: [{ x: 49, hw: 2.8, z0: -336, z1: -348, y0: LEVEL.MAIN, y1: LEVEL.LOWER }],
  },
  {
    id: 'north-gallery', name: 'Lower North Gallery', x0: 18, x1: 44, z0: -372, z1: -350, floor: LEVEL.LOWER, height: 4.6,
    roof: { type: 'flat', mat: 'copper' }, floorMat: 'oak', wing: 'early-twentieth',
    sides: { s: [W(18, 34), O(34, 42), W(42, 44)], w: [W(-372, -362), O(-362, -352), W(-352, -350)], n: [W(18, 35), O(35, 41), W(41, 44)], e: [W(-372, -350)] },
  },
  {
    id: 'north-tower', name: 'North Elevator Tower', x0: 34, x1: 44, z0: -386, z1: -372, floor: LEVEL.LOWER, height: 9, wing: null,
    roof: { type: 'flat', mat: 'concrete' }, floorMat: 'oak',
    sides: { s: [W(34, 35), O(35, 41), W(41, 44)], e: [W(-386, -375.5), D(-375.5, -372.5, { sill: -4.5 }), W(-372.5, -372)], n: [W(34, 44)], w: [W(-386, -372)] },
    landings: [{ x0: 34, x1: 44, z0: -386, z1: -383, y: -7.5 }, { x0: 39, x1: 44, z0: -376, z1: -372, y: -4.5 }],
    ramps: [
      { x: 36.6, hw: 2.0, z0: -373, z1: -383, y0: LEVEL.LOWER, y1: -7.5 },
      { x: 41.6, hw: 2.0, z0: -383, z1: -376, y0: -7.5, y1: -4.5 },
    ],
  },
  {
    id: 'modern-bridge', name: 'Modern Art Bridge', x0: -36, x1: 18, z0: -364, z1: -344, floor: LEVEL.LOWER, height: 6.6, bridge: true,
    roof: { type: 'convex', rise: 2.8, mat: 'copper', along: 'x' }, floorMat: 'oak', ribs: true, wing: 'bridge-gallery', leanGlass: true,
    partitions: [{ x0: -27, x1: -13, z: -354, h: 3.8 }, { x0: -3, x1: 11, z: -354, h: 3.8 }],
    sides: { n: [W(-36, -32), G(-32, 14), W(14, 18)], s: [W(-36, -32), G(-32, 14), W(14, 18)], w: [O(-364, -344)], e: [W(-364, -362), O(-362, -350), W(-350, -344)] },
  },
  {
    id: 'contemporary', name: 'Contemporary Art', x0: -56, x1: -36, z0: -344, z1: -272, floor: LEVEL.LOWER, height: 7.2,
    roof: { type: 'concave', rise: 2.8, mat: 'copper', high: 'w' }, floorMat: 'oak', ribs: true, wing: 'contemporary',
    sides: {
      s: [W(-56, -56), O(-56, -48), W(-48, -36)],
      e: [W(-344, -312), D(-312, -306), W(-306, -272)],
      w: [W(-344, -272)],
      n: [W(-56, -54), O(-54, -38), W(-38, -36)],
    },
    bow: { e: 3 },
    rooms: [{ id: 'infinity-room', x0: -54, x1: -47, z0: -292, z1: -283, door: 'e' }],
  },
  {
    id: 'lower-west', name: 'Contemporary Reflection', x0: -56, x1: -36, z0: -364, z1: -344, floor: LEVEL.LOWER, height: 7.2,
    roof: { type: 'flat', mat: 'copper' }, floorMat: 'oak', wing: null,
    sides: { s: [W(-56, -54), O(-54, -38), W(-38, -36)], e: [W(-364, -362), O(-362, -346), W(-346, -344)], w: [W(-364, -344)], n: [W(-56, -54), O(-54, -38), W(-38, -36)] },
  },
  {
    id: 'west-wing-2026', name: 'West Galleries (2026)', x0: -56, x1: -36, z0: -452, z1: -364, floor: LEVEL.LOWER, height: 7, wing: 'expansion',
    roof: { type: 'flat', mat: 'steel' }, floorMat: 'oak', ribs: true,
    sides: { s: [W(-56, -54), O(-54, -38), W(-38, -36)], e: [W(-452, -450), O(-450, -442), W(-442, -420), G(-420, -380), W(-380, -364)], w: [W(-452, -364)], n: [W(-56, -50), D(-50, -42), W(-42, -36)] },
  },
  {
    id: 'bridge-gallery-2026', name: 'Bridge Gallery (2026)', x0: -36, x1: 34, z0: -452, z1: -440, floor: LEVEL.LOWER, height: 6, bridge: true,
    roof: { type: 'vault', rise: 2.4, mat: 'steel' }, floorMat: 'oak', ribs: true, wing: 'expansion-bridge', cafe: true,
    sides: { n: [W(-36, -34), G(-34, 32), W(32, 34)], s: [W(-36, -34), G(-34, 32), W(32, 34)], w: [O(-450, -442)], e: [O(-450, -442)] },
  },
  {
    id: 'east-wing-2026', name: 'North Temporary Gallery and Hub (2026)', x0: 34, x1: 58, z0: -452, z1: -386, floor: LEVEL.LOWER, height: 7, wing: null,
    roof: { type: 'sawtooth', rise: 1.8, mat: 'steel' }, floorMat: 'oak', hub: true,
    sides: { w: [W(-452, -450), O(-450, -442), W(-442, -430), G(-430, -396), W(-396, -386)], e: [W(-452, -420), D(-420, -414, { sill: -6 }), W(-414, -386)], n: [W(34, 58)], s: [W(34, 58)] },
  },
]);

/** Terrain pads: rectangles whose ground is SET to y0, or a linear ramp y0 (x0 / z0 end) -> y1 (x1 / z1 end). */
export const PADS = Object.freeze([
  { id: 'south-lawn-path', x0: -5, x1: 7, z0: -158, z1: -134, y0: LEVEL.MAIN, y1: LEVEL.CREST, axis: 'z' }, // up to the Art Trail
  { id: 'courtyard', x0: 38, x1: 44, z0: -272, z1: -250, y0: LEVEL.MAIN },
  { id: 'walker-terrace', x0: 6, x1: 30, z0: -276, z1: -272, y0: LEVEL.MAIN },
  { id: 'colonnade', x0: 56, x1: 72, z0: -246, z1: -232, y0: LEVEL.CREST },
  { id: 'library-door', x0: 34, x1: 46, z0: -216, z1: -204, y0: LEVEL.MAIN + 6.0, y1: LEVEL.CREST, axis: 'x' },
  { id: 'store-garden', x0: 44, x1: 58, z0: -250, z1: -246, y0: LEVEL.MAIN },
  { id: 'hub-door', x0: 58, x1: 82, z0: -422, z1: -412, y0: -6, y1: LEVEL.CREST, axis: 'x' }, // 6 m over 24 m (was 12 m: a 27° climb)
  { id: 'west-wing-door', x0: -52, x1: -40, z0: -478, z1: -452, y0: LEVEL.CREST, y1: LEVEL.LOWER, axis: 'z' }, // from street level at the tile edge (was -2 over 18 m)
]);

/**
 * Labyrinth weir: a walkable spine plus alternating north/south teeth (the real sills under
 * Eleven and the Modern Art bridge are zig-zag overflow weirs, not a straight bar).
 * `z` is the spine centreline; north is −z.
 */
export function labyrinthWeir({ id, x0, x1, z, y, from, mat, tooth = 4.5, jut = 2.6, thick = 2 }) {
  const z0 = z - thick / 2;
  const z1 = z + thick / 2;
  const slabs = [{ id, x0, x1, z0, z1, y, from, mat }];
  const n = Math.max(2, Math.round((x1 - x0) / tooth));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * w + 0.12;
    const xb = x0 + (i + 1) * w - 0.12;
    if (i % 2 === 0) {
      slabs.push({ id: `${id}-n${i}`, x0: xa, x1: xb, z0: z0 - jut, z1: z0, y, from, mat });
    } else {
      slabs.push({ id: `${id}-s${i}`, x0: xa, x1: xb, z0: z1, z1: z1 + jut, y, from, mat });
    }
  }
  return slabs;
}

/** Free-standing walkable boxes: weirs, the contemporary balcony, bridge piers. y = top. */
export const SLABS = Object.freeze([
  ...labyrinthWeir({
    id: 'weir-eleven', x0: -40, x1: 14, z: -257,
    y: LEVEL.SOUTH_POND + 0.05, from: LEVEL.NORTH_POND - POND_DEPTH, mat: 'concrete',
  }),
  ...labyrinthWeir({
    id: 'weir-modern', x0: -36, x1: 18, z: -354,
    y: LEVEL.NORTH_POND + 0.05, from: LEVEL.EXP_POND - POND_DEPTH, mat: 'concrete',
  }),
  { id: 'balcony', x0: -34.4, x1: -28.5, z0: -312, z1: -306, y: LEVEL.LOWER, from: LEVEL.LOWER - 0.5, mat: 'concrete', rail: true },
]);

/** Footbridge decks (walkable ramps): { a: [x, y, z], b: [x, y, z], hw }. */
export const DECKS = Object.freeze([
  { id: 'north-forest-bridge', a: [44, -4.5, -374], b: [76, -0.6, -374], hw: 1.6 }, // the 100-ft bridge to the North Forest Trail
]);

/**
 * Walker Landing: concentric stepwell tiers stepping down into the north pond from the terrace
 * north of the lobby (the real one is a circular amphitheatre, 144 x 58 ft, modelled on Indian
 * stepwells). Arcs centred at (cx, cz), angles a0..a1 (radians, z = cz + r sin a). The east
 * galleries stop the arc from closing; it wraps west and north into the pond.
 */
export const WALKER_LANDING = Object.freeze({ cx: 12, cz: -300, r0: 4, step: 2, tiers: 11, rise: (LEVEL.MAIN - LEVEL.NORTH_POND) / 11, a0: 0.9, a1: 4.15, segs: 14 });

/** The OSM pond ring of the tile (game coordinates) from map data, clipped and split into three ponds. */
export function pondsFrom(mapData) {
  const water = (mapData.areas || []).filter((a) => a.k === 'water' && a.p.some(([x, z]) => x > TILE.x0 && x < TILE.x1 && z > TILE.z0 && z < TILE.z1));
  const ring = water.length ? water.reduce((m, a) => (a.p.length > m.p.length ? a : m)).p : FALLBACK_POND;
  const clip = clipRect(ring, WATER_CLIP.x0, WATER_CLIP.x1, WATER_CLIP.z0, WATER_CLIP.z1);
  return [
    { id: 'south-pond', y: LEVEL.SOUTH_POND, p: clipRect(clip, -1e3, 1e3, WEIR_ELEVEN, 1e3) },
    { id: 'north-pond', y: LEVEL.NORTH_POND, p: clipRect(clip, -1e3, 1e3, WEIR_MODERN, WEIR_ELEVEN) },
    { id: 'expansion-pond', y: LEVEL.EXP_POND, p: clipRect(clip, -1e3, 1e3, -1e3, WEIR_MODERN) },
  ].filter((p) => p.p.length >= 3);
}

// Used only when the map data has no pond (tests with synthetic maps).
const FALLBACK_POND = [[-38, -170], [10, -170], [12, -250], [36, -262], [40, -345], [30, -436], [-30, -436], [-36, -345], [-40, -260]];

/** Sutherland–Hodgman clip of polygon pts ([[x, z]...]) against an axis-aligned rectangle. */
export function clipRect(pts, x0, x1, z0, z1) {
  const edges = [
    (p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= z0, (p) => p[1] <= z1,
  ];
  const cut = [
    (a, b) => lerpAt(a, b, (x0 - a[0]) / (b[0] - a[0])),
    (a, b) => lerpAt(a, b, (x1 - a[0]) / (b[0] - a[0])),
    (a, b) => lerpAt(a, b, (z0 - a[1]) / (b[1] - a[1])),
    (a, b) => lerpAt(a, b, (z1 - a[1]) / (b[1] - a[1])),
  ];
  let out = pts.map((p) => [p[0], p[1]]);
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length];
      const b = inp[i];
      const ia = edges[e](a);
      const ib = edges[e](b);
      if (ib) {
        if (!ia) out.push(cut[e](a, b));
        out.push(b);
      } else if (ia) out.push(cut[e](a, b));
    }
  }
  return out;
}

const lerpAt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function pointInPolygon(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0], zi = p[i][1], xj = p[j][0], zj = p[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distToPolygon(p, x, z) {
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const ax = p[j][0], az = p[j][1];
    const ex = p[i][0] - ax, ez = p[i][1] - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + ex * t - x, dz = az + ez * t - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Bowed footprint margin: how far a pavilion's bowed side reaches past its rectangle. */
export function bowMargin(pv, side) {
  return (pv.bow && pv.bow[side]) || 0;
}

const RAVINE_Y = -0.25;

/**
 * True when a map polyline or filled polygon crosses the museum ravine. Vertex-only tests miss
 * OSM landcover whose corners sit on the crest while the interior floats over the ponds.
 */
export function flatOverlapsRavine(points, heightAt, { filled = false, ravineY = RAVINE_Y } = {}) {
  if (!points || !points.length || typeof heightAt !== 'function') return false;
  const hit = (x, z) => x > TILE.x0 && x < TILE.x1 && z > TILE.z0 && z < TILE.z1 && heightAt(x, z) < ravineY;
  for (const pt of points) if (pt && hit(pt[0], pt[1])) return true;
  const n = points.length;
  const last = filled ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (!a || !b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / 8));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      if (hit(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return true;
    }
  }
  if (!filled || n < 3) return false;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pt of points) {
    if (!pt) continue;
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minZ) minZ = pt[1];
    if (pt[1] > maxZ) maxZ = pt[1];
  }
  const x0 = Math.max(minX, TILE.x0);
  const x1 = Math.min(maxX, TILE.x1);
  const z0 = Math.max(minZ, TILE.z0);
  const z1 = Math.min(maxZ, TILE.z1);
  if (!(x1 > x0 && z1 > z0)) return false;
  for (let x = x0; x <= x1; x += 10) {
    for (let z = z0; z <= z1; z += 10) {
      if (pointInPolygon(points, x, z) && hit(x, z)) return true;
    }
  }
  return pointInPolygon(points, (x0 + x1) / 2, (z0 + z1) / 2) && hit((x0 + x1) / 2, (z0 + z1) / 2);
}

/**
 * Terrain height of the site at (x, z) before rounding to the heightfield: the ravine around
 * the ponds (pond bed inside the water, a bank rising to the crest RUN m away), faded to street
 * level at the tile edge, then carved under every pavilion (never above its floor) and set on pads.
 */
export function siteHeight(ponds, x, z) {
  let y = 0;
  let inWater = null;
  let d = Infinity;
  for (const pd of ponds) {
    if (pointInPolygon(pd.p, x, z)) {
      inWater = pd;
      break;
    }
    const dd = distToPolygon(pd.p, x, z);
    if (dd < d) d = dd;
  }
  if (inWater) y = inWater.y - POND_DEPTH;
  else {
    const bank = pondSurface(z) + 0.35;
    y = bank * (1 - smooth(0, RUN, d));
  }
  const edge = Math.min(x - TILE.x0, TILE.x1 - x, z - TILE.z0, TILE.z1 - z);
  y *= smooth(0, EDGE, edge);
  // path shoulders: within SHOULDER m of a pad (entrance path, terrace, courtyard) the ground
  // eases into the pad's height instead of dropping off its edge as a cliff
  if (!inWater) {
    let best = null;
    let bd = SHOULDER;
    for (const pd of PADS) {
      const cx = Math.min(pd.x1, Math.max(pd.x0, x));
      const cz = Math.min(pd.z1, Math.max(pd.z0, z));
      const dd = Math.hypot(x - cx, z - cz);
      if (dd > 0 && dd < bd) {
        bd = dd;
        best = padHeight(pd, cx, cz);
      }
    }
    if (best !== null) y = best + (y - best) * smooth(0, SHOULDER, bd);
  }
  for (const pv of PAVILIONS) {
    if (pv.noSlab) continue;
    const m = 2.2;
    const x0 = pv.x0 - m - bowMargin(pv, 'w'), x1 = pv.x1 + m + bowMargin(pv, 'e');
    const z0 = pv.z0 - m - bowMargin(pv, 'n'), z1 = pv.z1 + m + bowMargin(pv, 's');
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y > pv.floor - 0.45) y = pv.floor - 0.45;
  }
  for (const pd of PADS) {
    if (x < pd.x0 || x > pd.x1 || z < pd.z0 || z > pd.z1) continue;
    y = padHeight(pd, x, z);
  }
  // a pad must not lift the ground into a pavilion's own footprint (its edge row of the 2 m
  // grid would interpolate up through the floor slab)
  for (const pv of PAVILIONS) {
    if (pv.noSlab) continue;
    if (x >= pv.x0 - bowMargin(pv, 'w') && x <= pv.x1 + bowMargin(pv, 'e') && z >= pv.z0 && z <= pv.z1 && y > pv.floor - 0.45) y = pv.floor - 0.45;
  }
  return y;
}

const SHOULDER = 6; // m of eased ground beside every pad

/** Surface height of pad pd at (x, z): flat at y0, or a linear ramp y0 (low end) -> y1. */
function padHeight(pd, x, z) {
  if (pd.y1 === undefined) return pd.y0 - 0.02;
  const t = pd.axis === 'x' ? (x - pd.x0) / (pd.x1 - pd.x0) : (z - pd.z0) / (pd.z1 - pd.z0);
  return pd.y0 + (pd.y1 - pd.y0) * Math.min(1, Math.max(0, t)) - 0.02;
}

/**
 * Bake the site heightfield (World.setTerrain format): cell metres, covering the tile plus a
 * margin of zeros so World's edge clamping returns street level everywhere off the site.
 */
export function bakeTerrain(ponds, cell = 2) {
  const minX = TILE.x0 - cell * 2;
  const minZ = TILE.z0 - cell * 2;
  const cols = Math.ceil((TILE.x1 - TILE.x0) / cell) + 5;
  const rows = Math.ceil((TILE.z1 - TILE.z0) / cell) + 5;
  const heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + c * cell;
      const z = minZ + r * cell;
      heights[r * cols + c] = x <= TILE.x0 || x >= TILE.x1 || z <= TILE.z0 || z >= TILE.z1 ? 0 : siteHeight(ponds, x, z);
    }
  }
  return { meta: { minX, minZ, cell, cols, rows }, heights };
}

/** Outline reserved for the landmark (generic trees, rocks, cars and loot stay out). */
export const RESERVE = Object.freeze([[-100, -470], [100, -470], [100, -140], [-100, -140]]);

/** Is (x, z) on the site's interior footprint (any pavilion rectangle)? Returns the pavilion or null. */
export function pavilionAt(x, z, y = null) {
  for (const pv of PAVILIONS) {
    if (x < pv.x0 - bowMargin(pv, 'w') || x > pv.x1 + bowMargin(pv, 'e') || z < pv.z0 || z > pv.z1) continue;
    if (y !== null && (y < pv.floor - 1 || y > pv.floor + pv.height + 0.5)) continue;
    return pv;
  }
  return null;
}
