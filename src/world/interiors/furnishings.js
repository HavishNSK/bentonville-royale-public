// BENTONVILLE ROYALE — deterministic room furnishing (pure JS: no three.js, DOM, random, Date or trig).
//
// furnishInterior(plan, shell) runs once per plan after floors, stairs, walls and loot spots exist.
// Every room kind has a kit built from a few placement primitives (along walls, grids with
// >= 1.2 m aisles, centre pieces, fractional spots, wall mounts, ceiling light panels). Landmark
// buildings first get their authored set pieces (landmarkDressing.js), then the room kit fills
// what is left ('reserve' directives can keep a clear spine and skip the kit; 'hang' hangs framed
// works with label cards, see the contract addendum v2). Every placement keeps the safety reservations: inside the footprint (including
// clipped/concave rooms), door -> room-centre lanes, loot spots, stair flights and their lanes,
// and a walking spine through circulation rooms. Output records follow the shared prop contract
// (see the PLAN SHAPE comment in src/world/Interiors.js); solid props also become stride-7
// capsules in levels[i].props with a bullet-blocking flag in levels[i].propBlock.
import { q, inPoly, toLocal, toWorld } from './layout.js';
import { LANDMARK_DRESSING } from './landmarkDressing.js';

export const FURNISHING_LIMITS = Object.freeze({
  quads: 12000, // props + lights, ordinary building
  landmarkQuads: 60000, // props + lights, landmark building
  signs: 32,
  label: 18,
  directiveMax: 500, // items one landmark directive may place
  roomMin: 600, // smallest per-room quad allowance
});

// ------------------------------------------------------------------ catalog
// kind: [w (along the front/wall), d (depth), h, flags, lift]. Flags: S solid, B blocks bullets,
// M wall mounted, Z sized (w/d come from the directive or the room).
const RAW = {
  bed: [1.6, 2.1, 0.55, 'S'], nightstand: [0.5, 0.45, 0.55], dresser: [1.2, 0.5, 0.95, 'SB'], wardrobe: [1.2, 0.6, 2.0, 'SB'],
  sofa: [2.0, 0.85, 0.8, 'S'], armchair: [0.85, 0.85, 0.8, 'S'], coffee_table: [1.1, 0.6, 0.42], tv_stand: [1.6, 0.45, 0.55, 'S'],
  rug: [2.4, 1.7, 0.02, 'Z'], dining_table: [1.8, 0.95, 0.75, 'S'], chair: [0.45, 0.45, 0.9], stool: [0.4, 0.4, 0.75],
  counter: [1.8, 0.65, 0.92, 'SB'], fridge: [0.8, 0.75, 1.85, 'SB'], stove: [0.75, 0.65, 0.92, 'SB'], kitchen_island: [2.0, 1.0, 0.92, 'SB'],
  toilet: [0.45, 0.7, 0.75], sink: [0.7, 0.5, 0.85], bathtub: [1.7, 0.75, 0.55, 'S'], toilet_stall: [1.0, 1.5, 1.9, 'SB'],
  shelf: [1.6, 0.6, 1.6, 'SB'], checkout: [2.0, 0.8, 1.0, 'SB'], crate: [0.9, 0.9, 0.9, 'SB'], pallet_rack: [2.4, 1.0, 2.4, 'SB'],
  desk: [1.4, 0.7, 0.75, 'S'], office_chair: [0.55, 0.55, 0.95], filing_cabinet: [0.5, 0.6, 1.3, 'SB'], bookcase: [1.2, 0.4, 2.1, 'SB'],
  plant: [0.5, 0.5, 1.2], bench: [1.6, 0.5, 0.45], reception_desk: [2.6, 0.9, 1.1, 'SB'], safe: [0.9, 0.8, 1.4, 'SB'],
  workbench: [1.8, 0.7, 0.9, 'SB'], car: [4.2, 1.8, 1.4, 'SB'], planter: [1.4, 0.7, 0.75, 'S'], plinth: [0.8, 0.8, 1.0, 'SB'],
  display_case: [1.4, 0.7, 1.1, 'SB'], school_desk: [0.7, 0.55, 0.75], teacher_desk: [1.5, 0.75, 0.75, 'S'], locker_bank: [2.4, 0.5, 1.9, 'SB'],
  seat_row: [4.0, 0.8, 0.9], stage: [8, 4, 0.9, 'SBZ'], bleachers: [6.0, 2.4, 1.6, 'SB'], hoop: [1.8, 1.2, 3.0],
  court_lines: [20, 12, 0.01, 'Z'], long_table: [3.0, 0.9, 0.75, 'S'], serving_line: [3.0, 0.8, 1.0, 'SB'], pew: [3.0, 0.6, 0.9],
  judge_bench: [3.0, 1.0, 1.3, 'SB'], witness_stand: [1.2, 1.0, 1.1, 'SB'], jury_box: [3.6, 1.6, 1.0, 'SB'], railing: [3.0, 0.1, 0.9],
  bar_counter: [3.0, 0.7, 1.05, 'SB'], high_top: [0.7, 0.7, 1.05], cafe_table: [0.75, 0.75, 0.75], tank: [1.6, 1.6, 2.8, 'SB'],
  food_stall: [3.0, 2.0, 2.4, 'SB'], record_bin: [1.4, 0.7, 0.9, 'S'], easel: [0.7, 0.6, 1.6], banquet_table: [1.6, 1.6, 0.75, 'S'],
  podium: [0.6, 0.5, 1.15], installation: [2.5, 2.5, 2.5, 'SBZ'], gallery_bench: [1.8, 0.6, 0.45],
  painting: [1.2, 0.05, 0.9, 'M', 1.3], painting_large: [3.0, 0.06, 2.0, 'M', 1.1], whiteboard: [2.4, 0.05, 1.1, 'M', 0.9],
  tv: [1.4, 0.06, 0.8, 'M', 1.2], menu_board: [2.0, 0.06, 0.9, 'M', 1.9], mirror: [0.6, 0.04, 0.8, 'M', 1.1],
  cabinet_upper: [1.6, 0.35, 0.7, 'M', 1.45], tap_board: [2.0, 0.08, 0.6, 'M', 1.3], wall_label: [0.24, 0.02, 0.16, 'M', 1.15],
};
const SMALL = new Set(['chair', 'stool', 'plant', 'painting', 'mirror', 'cafe_table', 'rug', 'court_lines', 'tv', 'office_chair',
  'school_desk', 'high_top', 'easel', 'podium']);
const TINY = new Set(['wall_label']); // <= 4 quads
export const CATALOG = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([kind, [w, d, h, f = '', lift = 0]]) => [kind,
  Object.freeze({ w, d, h, lift, solid: f.includes('S'), block: f.includes('B'), mount: f.includes('M'), sized: f.includes('Z'),
    cost: TINY.has(kind) ? 4 : SMALL.has(kind) ? 14 : 60 })])));
const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
/** Render-cost ceiling (quads) of one prop kind, or of a ceiling light ('light'). */
export const quadCost = (kind) => (kind === 'light' ? 3 : has(CATALOG, kind) ? CATALOG[kind].cost : 60);

// ------------------------------------------------------------------ palette (warm cartoon)
const P = {
  oak: 0xc89a62, walnut: 0x8a5a36, maple: 0xd9b07a, cherry: 0xa4583c, cream: 0xf1e3c6, linen: 0xe6d8bd, ink: 0x3b2f4a,
  violet: 0x6c4f9a, lilac: 0x9b87c4, gold: 0xe8b84a, terracotta: 0xc8643f, sage: 0x8fae7e, leaf: 0x5f9a4f, dusty: 0x7d9bb8,
  rose: 0xd98e8e, steel: 0x8e8a86, stone: 0xb8b0a4, porcelain: 0xe9e4d8, brass: 0xc9a24a, teal: 0x5f9d96, plum: 0x7d4a6a,
};
const COLORS = {
  wood: [[P.oak, P.walnut], [P.walnut, P.cream], [P.maple, P.cherry], [P.cherry, P.gold]],
  soft: [[P.terracotta, P.cream], [P.dusty, P.linen], [P.sage, P.cream], [P.violet, P.gold], [P.rose, P.linen], [P.teal, P.cream]],
  white: [[P.porcelain, P.steel], [P.linen, P.dusty]],
  metal: [[P.steel, P.ink], [P.stone, P.violet], [P.dusty, P.ink]],
  green: [[P.leaf, P.terracotta], [P.sage, P.oak], [P.leaf, P.stone]],
  art: [[P.gold, P.violet], [P.terracotta, P.dusty], [P.lilac, P.gold], [P.teal, P.rose], [P.rose, P.sage]],
  bright: [[P.violet, P.gold], [P.terracotta, P.cream], [P.teal, P.gold], [P.dusty, P.gold]],
};
const PALETTE_OF = {
  bed: 'soft', nightstand: 'wood', dresser: 'wood', wardrobe: 'wood', sofa: 'soft', armchair: 'soft', coffee_table: 'wood',
  tv_stand: 'wood', rug: 'soft', dining_table: 'wood', chair: 'wood', stool: 'wood', counter: 'white', fridge: 'white', stove: 'metal',
  kitchen_island: 'wood', toilet: 'white', sink: 'white', bathtub: 'white', toilet_stall: 'bright', shelf: 'wood', checkout: 'bright',
  crate: 'wood', pallet_rack: 'metal', desk: 'wood', office_chair: 'metal', filing_cabinet: 'metal', bookcase: 'wood', plant: 'green',
  bench: 'wood', reception_desk: 'bright', safe: 'metal', workbench: 'wood', car: 'bright', planter: 'green', plinth: 'white',
  display_case: 'wood', school_desk: 'wood', teacher_desk: 'wood', locker_bank: 'bright', seat_row: 'soft', stage: 'wood',
  bleachers: 'wood', hoop: 'metal', court_lines: 'bright', long_table: 'wood', serving_line: 'metal', pew: 'wood', judge_bench: 'wood',
  witness_stand: 'wood', jury_box: 'wood', railing: 'wood', bar_counter: 'wood', high_top: 'wood', cafe_table: 'wood', tank: 'metal',
  food_stall: 'bright', record_bin: 'wood', easel: 'wood', banquet_table: 'white', podium: 'wood', installation: 'art',
  gallery_bench: 'wood', painting: 'art', painting_large: 'art', whiteboard: 'white', tv: 'metal', menu_board: 'bright',
  mirror: 'white', cabinet_upper: 'wood', tap_board: 'wood', wall_label: 'white',
};

// ------------------------------------------------------------------ geometry helpers
const mix = (h, n) => Math.imul(h ^ (n | 0), 0x01000193) >>> 0;
const strHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i)); return h; };
const contains = (r, a, b) => a >= r.a0 && a <= r.a1 && b >= r.b0 && b <= r.b1;
const overlaps = (a, b, pad = 0) => a.a0 - pad < b.a1 && a.a1 + pad > b.a0 && a.b0 - pad < b.b1 && a.b1 + pad > b.b0;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : dflt);
const SIDES = ['a0', 'b1', 'a1', 'b0'];
const OPP = { a0: 'a1', a1: 'a0', b0: 'b1', b1: 'b0' };
const NORMAL = { a0: 'a+', a1: 'a-', b0: 'b+', b1: 'b-' }; // face of an item standing with its back to that wall
const TOWARD = { a0: 'a-', a1: 'a+', b0: 'b-', b1: 'b+' }; // face looking at that wall
const FLIP = { 'a+': 'a-', 'a-': 'a+', 'b+': 'b-', 'b-': 'b+' };
const FV = { 'a+': [1, 0], 'a-': [-1, 0], 'b+': [0, 1], 'b-': [0, -1] };
const FACE_ID = { 'a+': 1, 'a-': 2, 'b+': 3, 'b-': 4 };
const CIRCULATION = new Set(['corridor', 'hall', 'lobby', 'open']);
const SCHOOL_IDS = new Set([952075842, 952075843, 651787776]); // Bentonville High x2, West High (landmarks.js)
const EDGE = 0.15; // keep items this far from the room corners along a wall
const LANE_R = 1.0; // half width of a reserved walking lane
// Gallery hang (contract addendum v2): candidate sizes [kind, w, h], label card offset, frames.
const HANG_SMALL = [['painting', 0.9, 0.7], ['painting', 1.2, 0.9], ['painting', 0.8, 1.1], ['painting', 1.5, 1.1]];
const HANG_LARGE = [['painting_large', 2.4, 1.6], ['painting_large', 3.0, 2.0]];
const HANG_MIN_W = 0.8;
const LABEL_GAP = 0.18; // label card's near edge, measured from the frame's right edge
const FRAME = Object.freeze({ wood: 0x74553b, gilt: 0xb08a3e, ink: 0x2e2838 });
export const ART_STYLES = Object.freeze(['landscape', 'portrait', 'abstract', 'still_life']);
// Reservation categories: which kinds of prop a reservation applies to.
const FLOOR = 1, FLAT = 2, MOUNT = 4;

/** True when the rect (expanded by r) touches the segment s -> e (slab test, inclusive). */
function segHits(p, r, sa, sb, ea, eb) {
  const lo = [p.a0 - r, p.b0 - r], hi = [p.a1 + r, p.b1 + r], s = [sa, sb], d = [ea - sa, eb - sb];
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (s[i] < lo[i] || s[i] > hi[i]) return false; continue; }
    let u = (lo[i] - s[i]) / d[i], v = (hi[i] - s[i]) / d[i];
    if (u > v) { const t = u; u = v; v = t; }
    if (u > t0) t0 = u;
    if (v < t1) t1 = v;
    if (t0 > t1) return false;
  }
  return true;
}

/** Small stair rooms keep the old rule: the room the stair starts or lands in stays empty. */
function stairRoom(plan, L, r) {
  for (const s of plan.stairs || []) {
    if (s.level !== L.i && s.level + 1 !== L.i) continue;
    const ri = s.level === L.i ? s.room0 ?? s.room : s.room1 ?? s.upperRoom;
    if (ri === r.id) return true;
    for (const k of ['0', '1']) {
      const [a, b] = toLocal(plan.frame, s['x' + k], s['z' + k]);
      if (contains(r, a, b)) return true;
    }
  }
  return false;
}

/** Local footprint rect of a stair flight (from its a0..b1, or its endpoints and width). */
function stairRect(F, s) {
  if ([s.a0, s.b0, s.a1, s.b1].every(Number.isFinite)) return { a0: s.a0, b0: s.b0, a1: s.a1, b1: s.b1 };
  if (![s.x0, s.z0, s.x1, s.z1].every(Number.isFinite)) return null;
  const [a0, b0] = toLocal(F, s.x0, s.z0), [a1, b1] = toLocal(F, s.x1, s.z1), w = num(s.w, 0.5, 4, 1.4) / 2;
  return { a0: Math.min(a0, a1) - w, b0: Math.min(b0, b1) - w, a1: Math.max(a0, a1) + w, b1: Math.max(b0, b1) + w };
}

// ------------------------------------------------------------------ one room
class Room {
  constructor(B, L, r) {
    this.B = B; this.L = L; this.r = r;
    this.A = r.a1 - r.a0; this.Bw = r.b1 - r.b0;
    this.area = Number.isFinite(r.area) ? r.area : this.A * this.Bw;
    this.long = this.A >= this.Bw ? 'a' : 'b';
    this.ceilH = (L.ceil - L.y) || 3;
    this.seed = mix(mix(mix(0x9e3779b9, B.plan.id), L.i), r.id);
    this.props = []; this.gid = []; this.nextG = 1;
    this.cost = 0; this.allow = Infinity; this.free = false;
    this.hung = false; this.skipKit = false; // set by 'hang' / 'reserve' landmark directives
    const F = B.plan.frame;
    const [ca, cb] = Number.isFinite(r.cx) ? toLocal(F, r.cx, r.cz) : [(r.a0 + r.a1) / 2, (r.b0 + r.b1) / 2];
    this.ca = ca; this.cb = cb;
    this.res = [];
    this.doorPts = [];
    this._reserve();
  }

  _reserve() {
    const { B, L, r } = this, F = B.plan.frame;
    const near = { a0: r.a0 - 1.5, b0: r.b0 - 1.5, a1: r.a1 + 1.5, b1: r.b1 + 1.5 };
    const doors = [...(L.doors || []), ...(L.i === 0 ? B.shell.doors || [] : [])];
    if (L.i === 0) {
      // Exterior doors: a deep clear mouth inside every opening (the shell wall, plus 1.9 m),
      // whichever ground-floor room it reaches. Doors sit on the wall centre line, normal outward.
      const t = num(B.shell.t, 0, 2, 0.4);
      for (const d of B.shell.doors || []) {
        if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
        const nx = Number.isFinite(d.nx) ? d.nx : 0, nz = Number.isFinite(d.nz) ? d.nz : 0;
        const w = num(d.w, 0.6, 30, Number.isFinite(d.u1 - d.u0) ? d.u1 - d.u0 : 1.8);
        const depth = t + 1.3 + 0.6, half = w / 2 + 0.8;
        const pts = [];
        for (const k of [-0.2, depth]) for (const s of [-half, half]) {
          pts.push(toLocal(F, d.x - nx * k - nz * s, d.z - nz * k + nx * s));
        }
        const box = { a0: Math.min(...pts.map(p => p[0])), b0: Math.min(...pts.map(p => p[1])),
          a1: Math.max(...pts.map(p => p[0])), b1: Math.max(...pts.map(p => p[1])) };
        this.res.push({ m: FLOOR, box });
      }
    }
    for (const d of doors) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      const [a, b] = toLocal(F, d.x, d.z);
      if (d.roomA != null ? d.roomA !== r.id && d.roomB !== r.id : !contains(near, a, b)) continue;
      // The swept door -> room-centre walking leg, and the door mouth on both sides of the wall.
      this.res.push({ m: FLOOR, seg: [a, b, this.ca, this.cb] });
      const na = (d.nx || 0) * F.ux + (d.nz || 0) * F.uz, nb = (d.nx || 0) * F.vx + (d.nz || 0) * F.vz;
      const half = num(d.w, 0.6, 30, Number.isFinite(d.u1 - d.u0) ? d.u1 - d.u0 : 1.8) / 2 + 0.35;
      const [ha, hb] = Math.abs(na) >= Math.abs(nb) ? [1.0, half] : [half, 1.0];
      this.res.push({ m: FLOOR | MOUNT, box: { a0: a - ha, b0: b - hb, a1: a + ha, b1: b + hb } });
      this.doorPts.push([a, b]);
    }
    for (const spot of B.plan.lootSpots || []) {
      if (spot.level !== L.i) continue;
      const [a, b] = toLocal(F, spot.x, spot.z);
      this.res.push({ m: FLOOR, box: { a0: a - 0.9, b0: b - 0.9, a1: a + 0.9, b1: b + 0.9 } });
    }
    for (const s of B.plan.stairs || []) {
      if (s.level !== L.i && s.level + 1 !== L.i) continue;
      const R = stairRect(F, s);
      if (!R) continue;
      this.res.push({ m: FLOOR | FLAT, box: { a0: R.a0 - 1.5, b0: R.b0 - 1.5, a1: R.a1 + 1.5, b1: R.b1 + 1.5 } });
      const k = s.level === L.i ? '0' : '1';
      if (!Number.isFinite(s['x' + k])) continue;
      const [a, b] = toLocal(F, s['x' + k], s['z' + k]);
      if (contains({ a0: r.a0 - 2.5, b0: r.b0 - 2.5, a1: r.a1 + 2.5, b1: r.b1 + 2.5 }, a, b)) this.res.push({ m: FLOOR, seg: [a, b, this.ca, this.cb] });
    }
    for (const h of L.holes || []) this.res.push({ m: FLOOR | FLAT, box: { a0: h.a0 - 0.3, b0: h.b0 - 0.3, a1: h.a1 + 0.3, b1: h.b1 + 0.3 } });
    if (CIRCULATION.has(r.kind)) {
      // A clear walking spine along the room's long axis.
      const half = r.kind === 'corridor' ? 0.65 : 1.0;
      const box = this.long === 'a'
        ? { a0: r.a0, a1: r.a1, b0: (r.b0 + r.b1) / 2 - half, b1: (r.b0 + r.b1) / 2 + half }
        : { b0: r.b0, b1: r.b1, a0: (r.a0 + r.a1) / 2 - half, a1: (r.a0 + r.a1) / 2 + half };
      this.res.push({ m: FLOOR, box });
    }
  }

  // ---- variation
  h(salt) { return mix(this.seed, salt); }
  pick(list, salt) { return list[this.h(salt) % list.length]; }
  order(list, salt = 7) { const k = this.h(salt) % list.length; return [...list.slice(k), ...list.slice(0, k)]; }
  wallLen(side) { return side[0] === 'a' ? this.Bw : this.A; }
  longSides() { return this.order(this.long === 'a' ? ['b0', 'b1'] : ['a0', 'a1'], 11); }
  shortSides() { return this.order(this.long === 'a' ? ['a0', 'a1'] : ['b0', 'b1'], 13); }
  allSides() { return this.order(SIDES, 17); }
  /** The wall closest to this room's doors (or b0). */
  nearSide() {
    const r = this.r;
    let best = 'b0', bd = Infinity;
    for (const [a, b] of this.doorPts) {
      for (const [s, d] of [['a0', Math.abs(a - r.a0)], ['a1', Math.abs(a - r.a1)], ['b0', Math.abs(b - r.b0)], ['b1', Math.abs(b - r.b1)]]) {
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  }
  farSide() { return OPP[this.nearSide()]; }
  n(per, lo, hi) { return clamp(Math.round(this.area / per), lo, hi); }
  /** Sub-rect of the room: depth fractions [f0, f1] measured from the `from` wall. */
  band(from, f0, f1) {
    const r = this.r, R = { a0: r.a0, b0: r.b0, a1: r.a1, b1: r.b1 };
    const isA = from[0] === 'a', lo = isA ? r.a0 : r.b0, len = isA ? this.A : this.Bw, up = from[1] === '0';
    const x0 = up ? lo + len * f0 : lo + len * (1 - f1), x1 = up ? lo + len * f1 : lo + len * (1 - f0);
    if (isA) { R.a0 = x0; R.a1 = x1; } else { R.b0 = x0; R.b1 = x1; }
    return R;
  }

  colour(kind, o) {
    const list = COLORS[PALETTE_OF[kind] || 'wood'];
    const [c, a] = list[this.h(strHash(kind) + (o.salt | 0)) % list.length];
    return [Number.isFinite(o.color) ? o.color : c, Number.isFinite(o.accent) ? o.accent : a];
  }

  /** Build a prop centred at (ca, cb) facing `face`; returns it if every check passes. */
  place(kind, ca, cb, face, o = {}) {
    const c = CATALOG[kind];
    if (!c || !FV[face] || !Number.isFinite(ca) || !Number.isFinite(cb)) return null;
    const w = num(o.w, 0.3, 60, c.w), d = num(o.d, 0.02, 60, c.d);
    const alongA = face[0] === 'b';
    const da = alongA ? w : d, db = alongA ? d : w;
    let lift = num(o.lift, 0, 5, c.lift), height = c.mount ? num(o.h, 0.1, 6, c.h) : c.h;
    if (c.mount) {
      lift = Math.min(lift, this.ceilH - height - 0.1);
      if (lift < 0.6) return null;
    } else {
      height = Math.min(height, this.ceilH - lift - 0.08);
      if (height < c.h * 0.6) return null;
    }
    const tier = o.tier ?? (c.mount ? 2 : 1);
    if (!this.free && !o.free && this.cost + c.cost > this.allow) return null;
    const [color, accent] = this.colour(kind, o);
    const p = { kind, level: this.L.i, room: this.r.id, a0: q(ca - da / 2), b0: q(cb - db / 2), a1: q(ca + da / 2), b1: q(cb + db / 2),
      y: this.L.y, lift: q(lift), height: q(height), face, color, accent, solid: c.solid, block: c.block, tier };
    const g = o.group || 0;
    if (!this.ok(p, g)) return null;
    this.props.push(p);
    if (o.dir) this.B.dirProps.add(p);
    this.gid.push(g || this.nextG++);
    this.cost += c.cost;
    return p;
  }

  ok(p, g) {
    const r = this.r;
    if (!(p.a0 < p.a1 && p.b0 < p.b1)) return false;
    if (p.a0 < r.a0 + 0.1 || p.b0 < r.b0 + 0.1 || p.a1 > r.a1 - 0.1 || p.b1 > r.b1 - 0.1) return false;
    const c = CATALOG[p.kind], cat = c.mount ? MOUNT : p.height <= 0.05 ? FLAT : FLOOR;
    for (const R of this.res) {
      if (!(R.m & cat)) continue;
      if (R.box ? overlaps(p, R.box) : segHits(p, LANE_R, R.seg[0], R.seg[1], R.seg[2], R.seg[3])) return false;
    }
    for (let i = 0; i < this.props.length; i++) {
      const o = this.props[i];
      if (g && this.gid[i] === g) continue;
      if (conflict(p, o)) return false;
    }
    return this.inside(p);
  }

  inside(p) {
    const poly = this.B.poly;
    const na = clamp(Math.ceil((p.a1 - p.a0) / 2), 1, 12) + 1, nb = clamp(Math.ceil((p.b1 - p.b0) / 2), 1, 12) + 1;
    for (let i = 0; i <= na; i++) {
      const a = p.a0 + ((p.a1 - p.a0) * i) / na;
      for (let j = 0; j <= nb; j++) {
        // Interior samples only matter for big items; the rim is always checked.
        if (i > 0 && i < na && j > 0 && j < nb && (na > 2 || nb > 2) && (i + j) % 2) continue;
        if (!inPoly(poly, a, p.b0 + ((p.b1 - p.b0) * j) / nb)) return false;
      }
    }
    return true;
  }

  dims(kind, face, o) {
    const c = CATALOG[kind];
    return [num(o.w, 0.3, 60, c.w), num(o.d, 0.02, 60, c.d)];
  }

  /** Item centre for a wall-backed item on `side` at along-wall position s (its centre) and inset. */
  wallSpot(side, s, inset, d) {
    const r = this.r;
    if (side === 'a0') return [r.a0 + inset + d / 2, s];
    if (side === 'a1') return [r.a1 - inset - d / 2, s];
    if (side === 'b0') return [s, r.b0 + inset + d / 2];
    return [s, r.b1 - inset - d / 2];
  }

  span(side) {
    const r = this.r;
    return side[0] === 'a' ? [r.b0 + EDGE, r.b1 - EDGE] : [r.a0 + EDGE, r.a1 - EDGE];
  }

  /** Items backed against walls. o: sides, max, perSide, gap, inset, centred, spread, corner, reverse, minWall. */
  walls(kind, o = {}) {
    const out = [], c = CATALOG[kind];
    if (!c) return out;
    const max = o.max ?? Infinity, gap = o.gap ?? 0.3, insets = c.mount ? [0.12, 0.2, 0.35, 0.6] : [o.inset ?? 0.15, (o.inset ?? 0.15) + 0.2, (o.inset ?? 0.15) + 0.45];
    for (const side of o.sides || this.allSides()) {
      if (out.length >= max || !NORMAL[side]) continue;
      if (o.minWall && this.wallLen(side) < o.minWall) continue;
      const face = o.reverse ? FLIP[NORMAL[side]] : NORMAL[side];
      const [w, d] = this.dims(kind, face, o);
      const [lo, hi] = this.span(side);
      if (hi - lo < w) continue;
      const perSide = Math.min(o.perSide ?? Infinity, max - out.length);
      const tryAt = (s) => {
        for (const inset of insets) {
          const [ca, cb] = this.wallSpot(side, s, inset, d);
          const p = this.place(kind, ca, cb, face, o);
          if (p) return p;
        }
        return null;
      };
      let placed = 0;
      if (o.centred || o.corner || o.spread || c.mount) {
        let slots;
        if (o.centred) slots = [(lo + hi) / 2];
        else if (o.corner) slots = [lo + w / 2, hi - w / 2];
        else {
          const g = o.spread ? gap : c.mount ? gap : gap;
          const nn = Math.min(perSide, Math.floor((hi - lo + g) / (w + g)));
          const start = lo + (hi - lo - (nn * w + (nn - 1) * g)) / 2 + w / 2;
          slots = Array.from({ length: Math.max(0, nn) }, (_, i) => start + i * (w + g));
        }
        for (const s0 of slots) {
          if (placed >= perSide) break;
          for (const ds of [0, 0.4, -0.4, 0.8, -0.8, 1.4, -1.4]) {
            const s = s0 + ds;
            if (s - w / 2 < lo - 1e-6 || s + w / 2 > hi + 1e-6) continue;
            const p = tryAt(s);
            if (p) { out.push(p); placed++; break; }
          }
        }
      } else {
        for (let s = lo + (this.h(strHash(kind) + 3) % 3) * 0.2; s + w <= hi + 1e-6 && placed < perSide;) {
          const p = tryAt(s + w / 2);
          if (p) { out.push(p); placed++; s += w + gap; } else s += 0.4;
        }
      }
    }
    return out;
  }

  /** Wall-mounted items (paintings, boards, TVs) spread evenly along walls. */
  mount(kind, o = {}) {
    // Rooms hung by a 'hang' directive keep its spacing, clearances and labels: no extra kit art.
    if (this.hung && (kind === 'painting' || kind === 'painting_large')) return [];
    return this.walls(kind, { gap: 1.5, ...o, spread: true });
  }

  /** Remove the most recently placed prop (used when a hung work's label cannot be placed). */
  unplace(p) {
    const i = this.props.lastIndexOf(p);
    if (i < 0) return;
    this.props.splice(i, 1); this.gid.splice(i, 1);
    this.cost -= CATALOG[p.kind].cost;
    this.B.dirProps.delete(p);
  }

  /** Reserve a clear walking band `width` m wide along the room's long axis (floor items only). */
  reserveSpine(width) {
    const r = this.r, half = width / 2;
    const box = this.long === 'a'
      ? { a0: r.a0, a1: r.a1, b0: (r.b0 + r.b1) / 2 - half, b1: (r.b0 + r.b1) / 2 + half }
      : { b0: r.b0, b1: r.b1, a0: (r.a0 + r.a1) / 2 - half, a1: (r.a0 + r.a1) / 2 + half };
    this.res.push({ m: FLOOR, box });
  }

  /**
   * Along-wall [lo, hi] intervals on `side` that must stay free of wall items: every doorway on
   * that wall (interior doors, plus exterior doors on the ground floor) and every wall-mount
   * reservation box that reaches the wall band.
   */
  openings(side) {
    const { B, L, r } = this, F = B.plan.frame, out = [];
    const isA = side[0] === 'a', line = r[side];
    const tol = 0.75 + (L.i === 0 ? num(B.shell.t, 0, 2, 0.4) : 0);
    for (const d of [...(L.doors || []), ...(L.i === 0 ? B.shell.doors || [] : [])]) {
      if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) continue;
      if (d.roomA != null && d.roomA !== r.id && d.roomB !== r.id) continue;
      const na = Math.abs((d.nx || 0) * F.ux + (d.nz || 0) * F.uz), nb = Math.abs((d.nx || 0) * F.vx + (d.nz || 0) * F.vz);
      if ((na || nb) && (isA ? na < nb : nb < na)) continue; // a doorway in a perpendicular wall
      const [a, b] = toLocal(F, d.x, d.z);
      if (Math.abs((isA ? a : b) - line) > tol) continue;
      const w = num(d.w, 0.6, 30, Number.isFinite(d.u1 - d.u0) ? d.u1 - d.u0 : 1.8), s = isA ? b : a;
      out.push([s - w / 2, s + w / 2]);
    }
    const band = { a0: r.a0, b0: r.b0, a1: r.a1, b1: r.b1 };
    if (side === 'a0') band.a1 = r.a0 + 0.5; else if (side === 'a1') band.a0 = r.a1 - 0.5;
    else if (side === 'b0') band.b1 = r.b0 + 0.5; else band.b0 = r.b1 - 0.5;
    for (const R of this.res) {
      if (!(R.m & MOUNT) || !R.box || !overlaps(R.box, band)) continue;
      out.push(isA ? [R.box.b0, R.box.b1] : [R.box.a0, R.box.a1]);
    }
    return out;
  }

  /**
   * Gallery hang (contract addendum v2): framed works evenly distributed along every solid wall
   * run, centred `centre` m above the floor, `clear` m from corners and doorway edges, each with a
   * small label card `LABEL_GAP` m to the viewer's right of the frame. Returns the hung works.
   */
  hang(o) {
    const out = [], { B, L, r } = this;
    this.hung = true;
    const lab = o.label ? LABEL_GAP + CATALOG.wall_label.w : 0;
    for (const side of o.sides || SIDES) {
      const face = NORMAL[side], isA = side[0] === 'a';
      // Viewer's right along the wall (a = east, b = south, seen from above): +b for 'a-', etc.
      const rs = { 'a+': -1, 'a-': 1, 'b+': 1, 'b-': -1 }[face];
      let runs = [[(isA ? r.b0 : r.a0) + o.clear, (isA ? r.b1 : r.a1) - o.clear]];
      for (const [s0, s1] of this.openings(side)) {
        const c0 = s0 - o.clear, c1 = s1 + o.clear;
        runs = runs.flatMap(([x0, x1]) => (c1 <= x0 || c0 >= x1 ? [[x0, x1]] : [[x0, c0], [c1, x1]].filter(([u, v]) => v - u > 1e-6)));
      }
      let idx = 0;
      for (const [x0, x1] of runs.sort((p, q2) => p[0] - q2[0])) {
        const len = x1 - x0;
        if (len < HANG_MIN_W + lab) continue;
        const n = Math.max(1, Math.floor(len / o.spacing)), I = len / n;
        for (let i = 0; i < n && out.length < o.max; i++, idx++) {
          const h = mix(mix(mix(mix(mix(0x5bd1e995, B.plan.id), L.i), r.id), SIDES.indexOf(side)), idx);
          const big = o.kind === 'painting_large' || (o.kind === 'mixed' && i % 3 === 2);
          const rot = (list, k) => [...list.slice(k % list.length), ...list.slice(0, k % list.length)];
          const small = rot(HANG_SMALL, h >>> 4), large = rot(HANG_LARGE, h >>> 4);
          const cands = o.kind === 'painting' ? small : big ? [...large, ...(o.kind === 'mixed' ? small : [])] : small;
          const p = this.hangOne(side, face, rs, x0, x1, x0 + I * (i + 0.5), I, n, cands, lab, h, o);
          if (p) out.push(p);
        }
      }
    }
    return out;
  }

  /** Try the candidate sizes for one hung work (and its label); returns the work or null. */
  hangOne(side, face, rs, x0, x1, mid, I, n, cands, lab, h, o) {
    for (const [kind, w, ht] of cands) {
      if (w + lab + (n > 1 ? 0.6 : 0) > I + 1e-6) continue;
      const lo = this.ceilH - 0.3 - ht;
      if (lo < 0.6) continue;
      const lift = clamp(o.centre - ht / 2, 0.6, lo);
      // keep the work and its label inside the run
      const s = rs > 0 ? clamp(mid, x0 + w / 2, x1 - w / 2 - lab) : clamp(mid, x0 + w / 2 + lab, x1 - w / 2);
      for (const inset of [0.12, 0.2]) {
        const [ca, cb] = this.wallSpot(side, s, inset, CATALOG[kind].d);
        const p = this.place(kind, ca, cb, face, { free: true, dir: true, tier: 1, w, h: ht, lift, salt: h & 0xff });
        if (!p) continue;
        if (o.label) {
          const ls = s + rs * (w / 2 + LABEL_GAP + CATALOG.wall_label.w / 2);
          const [la, lb] = this.wallSpot(side, ls, inset, CATALOG.wall_label.d);
          const g = this.gid[this.props.indexOf(p)];
          if (!this.place('wall_label', la, lb, face, { free: true, dir: true, tier: 2, group: g })) { this.unplace(p); continue; }
        }
        const styles = ht > w && o.styles.includes('portrait') ? ['portrait'] : o.styles;
        p.art = mix(h, 0x2545f491) >>> 0;
        p.artStyle = styles[(h >>> 8) % styles.length];
        const f = (h >>> 16) % 10;
        p.frame = f < 2 ? FRAME.gilt : f === 2 ? FRAME.ink : FRAME.wood;
        return p;
      }
    }
    return null;
  }

  /** Rows of items; o: face, aisle (>= 1.2), gap (across, >= 1.2), margin, region, extra, max. */
  grid(kind, o = {}) {
    const out = [];
    const face = FV[o.face] ? o.face : this.long === 'a' ? 'b+' : 'a+';
    const [w, d] = this.dims(kind, face, o);
    const aisle = num(o.aisle, 1.2, 40, 1.2), gap = num(o.gap, 1.2, 40, aisle), extra = num(o.extra, 0, 5, 0);
    const margin = num(o.margin, 0.15, 40, 1.0), R0 = o.region || this.r;
    const R = { a0: Math.max(R0.a0, this.r.a0) + margin, b0: Math.max(R0.b0, this.r.b0) + margin,
      a1: Math.min(R0.a1, this.r.a1) - margin, b1: Math.min(R0.b1, this.r.b1) - margin };
    const faceA = face[0] === 'a';
    // along the face axis: item depth + extra + aisle; across: item width + gap
    const pf = d + extra + aisle, pc = w + gap;
    const spanF = (faceA ? R.a1 - R.a0 : R.b1 - R.b0) - extra, spanC = faceA ? R.b1 - R.b0 : R.a1 - R.a0;
    const nf = Math.floor((spanF + aisle) / pf), nc = Math.floor((spanC + gap) / pc);
    if (nf < 1 || nc < 1) return out;
    const f0 = (faceA ? R.a0 : R.b0) + extra / 2 + (spanF - (nf * pf - aisle)) / 2 + d / 2;
    const c0 = (faceA ? R.b0 : R.a0) + (spanC - (nc * pc - gap)) / 2 + w / 2;
    const max = o.max ?? Infinity, sign = FV[face][faceA ? 0 : 1];
    for (let i = 0; i < nf && out.length < max; i++) {
      // rows nearest the wall the items face come first
      const fi = sign > 0 ? nf - 1 - i : i;
      for (let j = 0; j < nc && out.length < max; j++) {
        const fpos = f0 + fi * pf, cpos = c0 + j * pc;
        const p = faceA ? this.place(kind, fpos, cpos, face, o) : this.place(kind, cpos, fpos, face, o);
        if (p) out.push(p);
      }
    }
    return out;
  }

  /** One item near the room's rect centre (or o.fa/o.fb), nudged off the loot spot and lanes. */
  centre(kind, o = {}) {
    const face = FV[o.face] ? o.face : this.long === 'a' ? 'b+' : 'a+';
    const r = this.r, ca = r.a0 + this.A * num(o.fa, 0, 1, 0.5), cb = r.b0 + this.Bw * num(o.fb, 0, 1, 0.5);
    const steps = [0, 1.2, 1.8, 2.6, 3.6, 5];
    for (const t of steps) {
      for (const [da, db] of t ? [[t, 0], [-t, 0], [0, t], [0, -t], [t, t], [-t, -t], [t, -t], [-t, t]] : [[0, 0]]) {
        const p = this.place(kind, ca + da, cb + db, face, o);
        if (p) return p;
      }
    }
    return null;
  }

  /** One item with its centre at fractions (fa, fb) of the room rect, clamped inside; small nudges. */
  at(kind, fa, fb, o = {}) {
    const face = FV[o.face] ? o.face : this.long === 'a' ? 'b+' : 'a+';
    const [w, d] = this.dims(kind, face, o);
    const da = face[0] === 'b' ? w : d, db = face[0] === 'b' ? d : w, r = this.r;
    if (da > this.A - 0.3 || db > this.Bw - 0.3) return null;
    const ca = clamp(r.a0 + this.A * fa, r.a0 + 0.15 + da / 2, r.a1 - 0.15 - da / 2);
    const cb = clamp(r.b0 + this.Bw * fb, r.b0 + 0.15 + db / 2, r.b1 - 0.15 - db / 2);
    for (const [x, y] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const p = this.place(kind, ca + x, cb + y, face, o);
      if (p) return p;
    }
    return null;
  }

  /** Item(s) in front of (or behind, o.back) an anchor, facing it unless o.same. o.n spreads across its width. */
  front(anchor, kind, o = {}) {
    const out = [];
    if (!anchor) return out;
    const i = this.props.indexOf(anchor), g = this.gid[i];
    const fv = FV[anchor.face], dir = o.back ? -1 : 1, faceA = fv[0] !== 0;
    const face = o.same ? anchor.face : FLIP[anchor.face];
    const [w, d] = this.dims(kind, face, o);
    const ac = (anchor.a0 + anchor.a1) / 2, bc = (anchor.b0 + anchor.b1) / 2;
    const depth = faceA ? anchor.a1 - anchor.a0 : anchor.b1 - anchor.b0, width = faceA ? anchor.b1 - anchor.b0 : anchor.a1 - anchor.a0;
    const off = dir * (depth / 2 + (o.gap ?? 0.1) + d / 2);
    const n = Math.max(1, Math.min(o.n ?? 1, Math.floor(width / (w + 0.1)) || 1));
    for (let k = 0; k < n; k++) {
      const s = n === 1 ? 0 : -width / 2 + (width * (k + 0.5)) / n;
      const ca = ac + (faceA ? fv[0] * off : s), cb = bc + (faceA ? s : fv[1] * off);
      const p = this.place(kind, ca, cb, face, { ...o, group: g });
      if (p) out.push(p);
    }
    return out;
  }

  /** Items at both ends of an anchor along its width (nightstands, flanking plants). */
  beside(anchor, kind, o = {}) {
    const out = [];
    if (!anchor) return out;
    const g = this.gid[this.props.indexOf(anchor)];
    const fv = FV[anchor.face], faceA = fv[0] !== 0, [w, d] = this.dims(kind, anchor.face, o);
    const gap = o.gap ?? 0.08;
    // align the item's back with the anchor's back edge
    const back = faceA ? (fv[0] > 0 ? anchor.a0 + d / 2 : anchor.a1 - d / 2) : (fv[1] > 0 ? anchor.b0 + d / 2 : anchor.b1 - d / 2);
    const lo = faceA ? anchor.b0 : anchor.a0, hi = faceA ? anchor.b1 : anchor.a1;
    for (const s of [lo - gap - w / 2, hi + gap + w / 2]) {
      if (out.length >= (o.max ?? 2)) break;
      const p = faceA ? this.place(kind, back, s, anchor.face, { ...o, group: g }) : this.place(kind, s, back, anchor.face, { ...o, group: g });
      if (p) out.push(p);
    }
    return out;
  }

  /** Seats along both long sides (and optionally ends) of a table, facing it. */
  around(anchor, kind, o = {}) {
    const out = [];
    if (!anchor) return out;
    const g = this.gid[this.props.indexOf(anchor)], c = CATALOG[kind];
    const la = anchor.a1 - anchor.a0, lb = anchor.b1 - anchor.b0, longA = la >= lb;
    const len = longA ? la : lb, per = Math.max(1, Math.min(o.per ?? 4, Math.floor(len / (c.w + 0.25))));
    const ac = (anchor.a0 + anchor.a1) / 2, bc = (anchor.b0 + anchor.b1) / 2, gap = o.gap ?? 0.08;
    for (const sgn of [-1, 1]) {
      for (let k = 0; k < per; k++) {
        const s = -len / 2 + (len * (k + 0.5)) / per;
        const off = sgn * ((longA ? lb : la) / 2 + gap + c.d / 2);
        const face = longA ? (sgn < 0 ? 'b+' : 'b-') : (sgn < 0 ? 'a+' : 'a-');
        const p = longA ? this.place(kind, ac + s, bc + off, face, { ...o, group: g }) : this.place(kind, ac + off, bc + s, face, { ...o, group: g });
        if (p) out.push(p);
      }
    }
    if (o.ends) {
      for (const sgn of [-1, 1]) {
        const off = sgn * ((longA ? la : lb) / 2 + gap + c.d / 2);
        const face = longA ? (sgn < 0 ? 'a+' : 'a-') : (sgn < 0 ? 'b+' : 'b-');
        const p = longA ? this.place(kind, ac + off, bc, face, { ...o, group: g }) : this.place(kind, ac, bc + off, face, { ...o, group: g });
        if (p) out.push(p);
      }
    }
    return out;
  }

  /** Default size of a sized kind in this room. */
  sized(kind, o = {}) {
    const lng = Math.max(this.A, this.Bw), sht = Math.min(this.A, this.Bw);
    if (kind === 'court_lines') return { w: num(o.w, 0.3, 60, clamp(lng - 2, 0.5, 40)), d: num(o.d, 0.3, 60, clamp(sht - 2, 0.5, 24)) };
    if (kind === 'stage') return { w: num(o.w, 0.3, 60, clamp(sht - 2, 2, 16)), d: num(o.d, 0.3, 60, clamp(lng * 0.22, 2, 6)) };
    if (kind === 'rug') return { w: num(o.w, 0.3, 60, clamp(lng * 0.4, 1.2, 4)), d: num(o.d, 0.3, 60, clamp(sht * 0.4, 1, 3)) };
    if (kind === 'installation') return { w: num(o.w, 0.3, 60, 2.5), d: num(o.d, 0.3, 60, 2.5) };
    return {};
  }
}

/** Do two props collide? Rugs and court lines may sit under anything; wall items only meet wall
 * items, or floor items tall enough to reach them. */
function conflict(p, o) {
  const pm = CATALOG[p.kind].mount, om = CATALOG[o.kind].mount;
  const pf = !pm && p.height <= 0.05, of = !om && o.height <= 0.05;
  if (pf || of) return pf && of && overlaps(p, o);
  if (pm && om) return overlaps(p, o, 0.3);
  if (pm || om) {
    const [m, f] = pm ? [p, o] : [o, p];
    return f.lift + f.height > m.lift - 0.05 && overlaps(m, f, 0.25);
  }
  return overlaps(p, o, 0.3);
}

// ------------------------------------------------------------------ room kits
const seat = (k, t, kind = 'chair', o = {}) => k.around(t, kind, { tier: 3, ...o });
const deskWithChair = (k, desks) => { for (const d of desks) k.front(d, 'office_chair', { tier: 3, gap: 0.05 }); };

const KITS = {
  living(k) {
    const sides = [...k.longSides(), ...k.shortSides()];
    const [sofa] = k.walls('sofa', { sides, max: 1, centred: true, tier: 0 });
    if (sofa) {
      k.front(sofa, 'rug', { gap: 0.05, same: true, tier: 3, ...k.sized('rug') });
      k.front(sofa, 'coffee_table', { gap: 0.45, same: true, tier: 1 });
      const side = sides.find(s => NORMAL[s] === sofa.face);
      k.walls('tv_stand', { sides: [OPP[side]], max: 1, centred: true, tier: 1 });
    }
    k.walls('armchair', { max: k.area > 30 ? 2 : 1, tier: 1 });
    if (k.area > 18) k.walls('bookcase', { max: 1, tier: 1 });
    if (k.area > 45) { const [s2] = k.walls('sofa', { max: 1, tier: 1 }); k.front(s2, 'coffee_table', { gap: 0.45, same: true, tier: 3 }); }
    k.walls('plant', { corner: true, max: 2, tier: 3 });
    k.mount('painting', { max: 2, tier: 2 });
  },
  bedroom(k) {
    const [bed] = k.walls('bed', { sides: [k.farSide(), ...k.longSides(), ...k.shortSides()], max: 1, centred: true, tier: 0 });
    k.beside(bed, 'nightstand', { tier: 1 });
    if (bed) k.front(bed, 'rug', { gap: -0.9, same: true, tier: 3, w: 2.2, d: 1.4 });
    k.walls('wardrobe', { max: 1, tier: 0 });
    k.walls('dresser', { max: 1, tier: 1 });
    if (k.area > 22) deskWithChair(k, k.walls('desk', { max: 1, tier: 1 }));
    if (k.area > 30) k.walls('armchair', { max: 1, tier: 1 });
    if (k.area > 45) { const [b2] = k.walls('bed', { max: 1, tier: 1 }); k.beside(b2, 'nightstand', { tier: 3, max: 1 }); }
    k.mount('mirror', { max: 1, tier: 2 });
    k.mount('painting', { max: 2, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  kitchen(k) {
    k.walls('fridge', { max: 1, tier: 0 });
    k.walls('stove', { max: 1, tier: 0 });
    k.walls('counter', { max: k.n(6, 2, 10), gap: 0.05, tier: 0 });
    k.mount('cabinet_upper', { max: k.n(8, 1, 6), gap: 0.3, tier: 2 });
    if (k.area > 16) { const isl = k.centre('kitchen_island', { tier: 1 }); k.front(isl, 'stool', { n: 3, gap: 0.12, tier: 3 }); }
    if (k.area > 28) { const [t] = k.grid('dining_table', { aisle: 2.2, margin: 1.5, max: 1, tier: 1 }); seat(k, t); }
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  dining(k) {
    const tables = k.area > 40 ? k.grid('dining_table', { aisle: 2.2, margin: 1.2, tier: 0, max: k.n(12, 2, 16) }) : [k.centre('dining_table', { tier: 0 })];
    for (const t of tables) if (t) { k.front(t, 'rug', { gap: -1.5, same: true, w: 3, d: 2.4, tier: 3 }); seat(k, t, 'chair', { per: 3, ends: true }); }
    k.walls('dresser', { max: 1, tier: 1 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
    k.mount('painting', { max: 2, tier: 2 });
  },
  bath(k) {
    k.walls('toilet', { max: 1, tier: 0 });
    const sinks = k.walls('sink', { max: 1, tier: 0 });
    if (k.area > 4.5) k.walls('bathtub', { max: 1, tier: 1 });
    // mirror above the sink, on the wall the sink backs onto
    k.mount('mirror', { sides: sinks.length ? [Object.keys(NORMAL).find(s => NORMAL[s] === sinks[0].face)] : undefined, max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  restroom(k) {
    const far = k.farSide();
    k.walls('toilet_stall', { sides: [far, ...k.longSides()], gap: 0.02, max: k.n(5, 1, 10), tier: 0 });
    const sinks = k.walls('sink', { gap: 0.3, max: k.n(8, 1, 6), tier: 0 });
    if (!k.props.some(p => p.kind === 'toilet_stall')) k.walls('toilet', { max: 2, tier: 0 });
    k.mount('mirror', { max: Math.max(1, sinks.length), gap: 0.4, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  apartment(k) {
    const [bed] = k.walls('bed', { sides: [k.farSide(), ...k.longSides()], max: 1, corner: true, tier: 0 });
    k.beside(bed, 'nightstand', { tier: 3, max: 1 });
    k.walls('fridge', { max: 1, tier: 0 });
    k.walls('stove', { max: 1, tier: 1 });
    k.walls('counter', { max: 2, gap: 0.05, tier: 1 });
    const [sofa] = k.walls('sofa', { max: 1, centred: true, tier: 0 });
    k.front(sofa, 'coffee_table', { gap: 0.45, same: true, tier: 3 });
    k.walls('tv_stand', { max: 1, tier: 2 });
    const t = k.centre('cafe_table', { tier: 1 });
    seat(k, t, 'chair', { per: 1 });
    k.walls('wardrobe', { max: 1, tier: 1 });
    k.centre('rug', { tier: 3, ...k.sized('rug') });
    k.mount('painting', { max: 2, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  sales(k) {
    const near = k.nearSide(), far = OPP[near];
    k.walls('checkout', { sides: [near, ...k.longSides()], max: k.area > 200 ? 3 : 1, gap: 1.4, tier: 0 });
    k.walls('shelf', { sides: [far, ...k.longSides()], gap: 0.1, max: k.n(10, 2, 24), tier: 1 });
    k.grid('shelf', { aisle: 1.5, gap: 1.4, margin: 1.4, region: k.band(near, 0.25, 1), tier: 0, w: k.area > 120 ? 3.2 : 1.6 });
    k.walls('display_case', { max: k.n(60, 1, 4), tier: 1 });
    k.mount('tv', { sides: [far], max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  stall(k) {
    const far = k.farSide();
    if (k.area >= 18) k.walls('food_stall', { sides: [far, ...k.longSides()], max: 1, centred: true, tier: 0 });
    k.walls('counter', { sides: [far, ...k.longSides()], max: k.area >= 18 ? 1 : 2, gap: 0.05, tier: 0 });
    k.mount('menu_board', { sides: [far], max: 1, tier: 2 });
    k.walls('fridge', { max: 1, tier: 1 });
    k.walls('display_case', { max: 1, tier: 1 });
    k.walls('shelf', { max: 1, tier: 3 });
    if (k.area > 24) for (const t of k.grid('cafe_table', { aisle: 1.4, margin: 1.2, extra: 1.0, max: k.n(10, 1, 8), tier: 1 })) seat(k, t, 'chair', { per: 1 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  storage(k) {
    if (k.area > 60) {
      k.walls('pallet_rack', { sides: k.longSides(), gap: 0.1, tier: 1, max: 8 });
      k.grid('pallet_rack', { aisle: 1.8, gap: 1.4, margin: 1.6, tier: 0, max: k.n(30, 2, 16) });
    } else k.walls('shelf', { gap: 0.1, max: k.n(5, 1, 8), tier: 0 });
    k.walls('crate', { corner: true, max: k.n(10, 2, 6), tier: 1 });
    if (k.area > 20) k.walls('workbench', { max: 1, tier: 1 });
    k.walls('crate', { gap: 0.05, max: k.n(15, 1, 4), tier: 3 });
  },
  office(k) {
    if (k.area > 40) deskWithChair(k, k.grid('desk', { aisle: 1.3, gap: 1.2, margin: 1.2, extra: 0.7, tier: 0, max: k.n(10, 4, 24) }));
    deskWithChair(k, k.walls('desk', { max: k.area > 40 ? 2 : k.area > 14 ? 2 : 1, gap: 0.6, tier: 0 }));
    k.walls('filing_cabinet', { max: k.n(12, 1, 6), gap: 0.05, tier: 1 });
    k.walls('bookcase', { max: 1, tier: 1 });
    if (k.area > 18) k.mount('whiteboard', { max: 1, tier: 2 });
    k.mount('painting', { max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  vault(k) {
    k.walls('safe', { gap: 0.15, max: k.n(3, 2, 12), tier: 0 });
    k.walls('filing_cabinet', { gap: 0.02, max: k.n(4, 2, 12), tier: 1 });
    const d = k.centre('desk', { tier: 1 });
    k.front(d, 'office_chair', { tier: 3 });
  },
  break(k) {
    const t = k.centre(k.area > 25 ? 'long_table' : 'dining_table', { tier: 0 });
    seat(k, t, 'chair', { per: 3 });
    k.walls('counter', { max: 1, tier: 1 });
    k.walls('fridge', { max: 1, tier: 1 });
    if (k.area > 20) k.walls('sofa', { max: 1, tier: 1 });
    k.mount('tv', { max: 1, tier: 2 });
    k.mount('painting', { max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  garage(k) {
    k.centre('car', { tier: 0 });
    k.walls('workbench', { max: 2, tier: 0 });
    k.walls('shelf', { max: 2, tier: 1 });
    k.walls('crate', { corner: true, max: 3, tier: 3 });
  },
  greenhouse(k) {
    k.grid('planter', { aisle: 1.2, gap: 1.2, margin: 1.0, tier: 0 });
    k.walls('workbench', { max: 1, tier: 1 });
    k.walls('plant', { gap: 1.2, max: k.n(10, 2, 16), tier: 3 });
  },
  gallery(k) {
    k.mount('painting_large', { minWall: 9, perSide: 1, max: 4, tier: 1 });
    k.mount('painting', { gap: 1.6, tier: 1 });
    if (k.area > 200) k.centre('installation', { tier: 0, ...k.sized('installation'), fa: 0.3, fb: 0.35 });
    k.grid('plinth', { aisle: 3.4, gap: 3.4, margin: 2.4, tier: 0, max: k.n(40, 1, 16) });
    k.centre('gallery_bench', { tier: 1 });
    if (k.area > 60) k.walls('display_case', { max: 2, tier: 1 });
  },
  auditorium(k) {
    const far = k.farSide(), st = k.sized('stage');
    const [stage] = k.walls('stage', { sides: [far], centred: true, inset: 0.3, tier: 0, ...st });
    if (stage) k.place('podium', (stage.a0 + stage.a1) / 2 + FV[stage.face][0] * 0.25 * (stage.a1 - stage.a0),
      (stage.b0 + stage.b1) / 2 + FV[stage.face][1] * 0.25 * (stage.b1 - stage.b0), stage.face, { group: k.gid[k.props.indexOf(stage)], lift: 0.9, tier: 2 });
    const depth = far[0] === 'a' ? k.A : k.Bw, used = (stage ? st.d + 0.3 : 0) + 2.0;
    k.grid('seat_row', { face: TOWARD[far], region: k.band(OPP[far], 0, Math.max(0.2, 1 - used / depth)), margin: 0.9, tier: 0, w: Math.min(4, Math.max(1.5, (far[0] === 'a' ? k.Bw : k.A) - 3)) });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  library(k) {
    const near = k.nearSide();
    k.walls('reception_desk', { sides: [near, ...k.longSides()], max: 1, tier: 0 });
    k.walls('bookcase', { gap: 0.15, max: k.n(8, 2, 20), tier: 1 });
    if (k.area > 60) {
      k.grid('bookcase', { aisle: 1.4, gap: 1.3, margin: 1.4, region: k.band(near, 0.45, 1), tier: 0, w: 2.4, max: k.n(15, 2, 24) });
      for (const t of k.grid('long_table', { aisle: 1.4, margin: 1.2, extra: 1.1, region: k.band(near, 0, 0.45), tier: 1, max: 8 })) seat(k, t, 'chair', { per: 3 });
    } else { const t = k.centre('long_table', { tier: 1 }); seat(k, t, 'chair', { per: 3 }); }
    k.walls('armchair', { max: 2, tier: 3 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  classroom(k) {
    const far = k.farSide(), toward = TOWARD[far];
    k.mount('whiteboard', { sides: [far], max: 1, tier: 1 });
    const [td] = k.walls('teacher_desk', { sides: [far], centred: true, inset: 1.0, reverse: true, max: 1, tier: 0 });
    k.front(td, 'office_chair', { gap: 0.08, tier: 3 });
    k.grid('school_desk', { face: toward, region: k.band(OPP[far], 0, Math.max(0.3, 1 - 3.2 / (far[0] === 'a' ? k.A : k.Bw))), margin: 0.8, tier: 0, max: k.n(2.2, 6, 32) });
    k.walls('bookcase', { sides: [OPP[far], ...k.longSides()], max: 1, tier: 1 });
    k.mount('painting', { sides: k.longSides(), max: 2, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
    k.walls('filing_cabinet', { max: 1, tier: 3 });
  },
  cafe(k) {
    const far = k.farSide();
    k.walls('counter', { sides: [far, ...k.longSides()], max: 2, gap: 0.05, tier: 0 });
    k.mount('menu_board', { sides: [far], max: 1, tier: 2 });
    k.walls('display_case', { max: 1, tier: 1 });
    for (const t of k.grid('cafe_table', { aisle: 1.3, margin: 1.4, extra: 1.0, max: k.n(6, 2, 40), tier: 1 })) seat(k, t, 'chair', { per: 1 });
    k.walls('armchair', { max: 2, tier: 3 });
    k.mount('painting', { max: 2, tier: 2 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  bar(k) {
    const far = k.farSide();
    const bars = k.walls('bar_counter', { sides: [far, ...k.longSides()], max: k.area > 60 ? 2 : 1, inset: 1.0, gap: 0.05, tier: 0 });
    for (const b of bars) k.front(b, 'stool', { n: 4, gap: 0.12, tier: 3 });
    k.mount('tap_board', { sides: [far], max: 1, tier: 2 });
    for (const t of k.grid('high_top', { aisle: 1.4, margin: 1.4, extra: 0.9, max: k.n(8, 1, 30), tier: 1 })) seat(k, t, 'stool', { per: 1 });
    k.walls('sofa', { max: 2, tier: 1 });
    k.mount('tv', { max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  courtroom(k) {
    const far = k.farSide(), near = OPP[far], toward = TOWARD[far], depth = far[0] === 'a' ? k.A : k.Bw;
    const [bench] = k.walls('judge_bench', { sides: [far], centred: true, inset: 0.5, tier: 0 });
    k.beside(bench, 'witness_stand', { gap: 0.5, max: 1, tier: 0 });
    // jury box along a side wall in the front half, facing across the room
    const front = k.band(near, 0.5, 0.95);
    for (const side of k.longSides()) {
      if (side === far || side === near) continue;
      const sub = new Room(k.B, k.L, { ...k.r, ...front });
      sub.props = k.props; sub.gid = k.gid; sub.cost = k.cost; sub.allow = k.allow; sub.res = k.res; sub.nextG = k.nextG;
      const got = sub.walls('jury_box', { sides: [side], max: 1, centred: true, tier: 0 });
      k.cost = sub.cost; k.nextG = sub.nextG;
      if (got.length) break;
    }
    const rail = k.band(near, 0.4, 0.46);
    for (const fc of [0.2, 0.8]) {
      const [fa, fb] = far[0] === 'a' ? [((rail.a0 + rail.a1) / 2 - k.r.a0) / k.A, fc] : [fc, ((rail.b0 + rail.b1) / 2 - k.r.b0) / k.Bw];
      k.at('railing', fa, fb, { face: toward, tier: 1, w: Math.min(3, (far[0] === 'a' ? k.Bw : k.A) * 0.35) });
    }
    const counsel = k.grid('desk', { face: FLIP[toward], region: k.band(near, 0.47, 0.62), margin: 0.5, gap: 1.6, max: 2, tier: 1 });
    for (const d of counsel) k.front(d, 'office_chair', { tier: 3, gap: 0.05 });
    k.grid('pew', { face: toward, region: k.band(near, 0, Math.max(0.15, 0.4 - 0.9 / depth)), margin: 0.8, tier: 0 });
    k.mount('painting', { sides: [far], max: 1, tier: 2 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  cafeteria(k) {
    const far = k.farSide();
    k.walls('serving_line', { sides: [far, ...k.longSides()], max: k.area > 120 ? 2 : 1, gap: 0.05, tier: 0 });
    k.mount('menu_board', { sides: [far], max: 1, tier: 2 });
    for (const t of k.grid('long_table', { aisle: 1.3, margin: 1.4, extra: 1.1, region: k.band(far, 0.12, 1), tier: 0, max: k.n(15, 1, 40) })) seat(k, t, 'chair', { per: 3 });
    k.walls('fridge', { max: 1, tier: 1 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  studio(k) {
    if (/radio|record|podcast|broadcast|music|sound/i.test(k.r.label || '')) {
      deskWithChair(k, k.walls('desk', { max: 2, tier: 0 }));
      k.walls('bookcase', { max: 1, tier: 1 });
      k.walls('sofa', { max: 1, tier: 1 });
      k.mount('tv', { max: 1, tier: 2 });
    } else {
      for (const e of k.grid('easel', { aisle: 1.3, margin: 1.2, extra: 0.6, max: k.n(5, 2, 16), tier: 0 })) k.front(e, 'stool', { tier: 3, gap: 0.15 });
      k.walls('workbench', { max: 1, tier: 1 });
      k.walls('shelf', { max: 1, tier: 1 });
      k.mount('painting', { max: 3, tier: 2 });
    }
    k.centre('rug', { tier: 3, ...k.sized('rug') });
    k.walls('plant', { corner: true, max: 1, tier: 3 });
  },
  gym(k) {
    k.centre('court_lines', { tier: 0, ...k.sized('court_lines'), face: k.long === 'a' ? 'b+' : 'a+' });
    k.walls('hoop', { sides: k.shortSides(), centred: true, perSide: 1, inset: 0.3, tier: 0 });
    const [l1, l2] = k.longSides();
    k.walls('bleachers', { sides: [l1], spread: true, gap: 1.2, tier: 0 });
    k.walls('bench', { sides: [l2], spread: true, gap: 2.0, max: 4, tier: 1 });
    if (k.B.school) k.walls('locker_bank', { sides: [l2], max: 2, tier: 2 });
  },
  brewhouse(k) {
    k.grid('tank', { aisle: 1.4, gap: 1.4, margin: 1.2, tier: 0, max: k.n(8, 1, 24) });
    k.walls('workbench', { max: 1, tier: 1 });
    k.walls('shelf', { max: 1, tier: 1 });
    k.walls('crate', { corner: true, max: 3, tier: 3 });
  },
  hall(k) {
    k.walls('bench', { sides: k.longSides(), spread: true, gap: 3.0, max: k.n(15, 1, 24), tier: 1 });
    k.walls('planter', { sides: k.shortSides(), spread: true, gap: 3.0, max: k.n(40, 1, 8), tier: 1 });
    k.walls('plant', { corner: true, max: 4, tier: 3 });
    k.mount('painting', { gap: 3.0, max: k.n(10, 1, 24), tier: 2 });
    if (k.area > 150) k.grid('planter', { aisle: 5, gap: 5, margin: 3, tier: 2, max: 12 });
  },
  lobby(k) {
    const near = k.nearSide();
    const [desk] = k.walls('reception_desk', { sides: [OPP[near], ...k.longSides(), near], max: 1, centred: true, inset: 1.0, tier: 0 });
    k.front(desk, 'office_chair', { back: true, same: true, tier: 3, gap: 0.08 });
    k.walls('bench', { spread: true, gap: 2.0, max: k.n(12, 1, 8), tier: 1 });
    if (k.area > 30) { const [s] = k.walls('sofa', { max: 1, tier: 1 }); k.front(s, 'coffee_table', { gap: 0.45, same: true, tier: 3 }); }
    k.walls('plant', { corner: true, max: 4, tier: 3 });
    k.centre('rug', { tier: 3, ...k.sized('rug') });
    k.mount('painting', { gap: 3.0, max: k.n(15, 1, 8), tier: 2 });
  },
  open(k) {
    k.walls('bench', { spread: true, gap: 2.5, max: k.n(12, 1, 10), tier: 0 });
    k.walls('planter', { corner: true, max: 2, tier: 1 });
    if (k.area > 60) { const t = k.centre('long_table', { tier: 1 }); k.around(t, 'bench', { per: 1, tier: 3 }); }
    k.walls('plant', { corner: true, max: 2, tier: 3 });
  },
  corridor(k) {
    // wall-hugging only: the spine reservation keeps the middle clear
    if (k.B.school) k.walls('locker_bank', { sides: k.longSides(), gap: 0.3, tier: 1, max: k.n(4, 1, 24) });
    k.walls('bench', { sides: k.longSides(), spread: true, gap: 5.0, max: k.n(12, 1, 12), tier: 1 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
    k.mount('painting', { sides: k.longSides(), gap: 3.5, max: k.n(6, 1, 30), tier: 2 });
  },
  default(k) {
    k.walls('bench', { max: 2, tier: 0 });
    k.walls('shelf', { max: 1, tier: 1 });
    k.walls('plant', { corner: true, max: 2, tier: 3 });
    k.mount('painting', { max: 1, tier: 2 });
  },
};

// ------------------------------------------------------------------ landmark directives
const PLACES = new Set(['grid', 'walls', 'centre', 'at', 'wall_mount']);
const HANG_KINDS = new Set(['painting', 'painting_large', 'mixed']);
const mine = (k, d) => !!d && typeof d === 'object' && typeof d.room === 'string' && d.room === k.r.label && (d.level == null || d.level === k.L.i);

/** Room rules ('reserve'): a clear spine (width m, default 3) and kit: false (skip the room kit). */
function applyReserve(k, d) {
  const w = num(d.spine, 0, 20, 3);
  if (w > 0) k.reserveSpine(w);
  if (d.kit === false) k.skipKit = true;
}

function applyHang(k, d) {
  const styles = Array.isArray(d.styles) ? ART_STYLES.filter(s => d.styles.includes(s)) : [];
  const sides = Array.isArray(d.sides) ? d.sides.filter(s => has(NORMAL, s)) : [];
  k.hang({
    kind: HANG_KINDS.has(d.kind) ? d.kind : 'mixed', sides: sides.length ? sides : null,
    spacing: num(d.spacing, 1, 30, 3.6), centre: num(d.centre, 0.8, 3, 1.48), clear: num(d.clear, 0, 3, 0.4),
    label: d.label !== false, styles: styles.length ? styles : ART_STYLES,
    max: Math.floor(num(d.max, 0, FURNISHING_LIMITS.directiveMax, FURNISHING_LIMITS.directiveMax)),
  });
}

function applyDirectives(k, list) {
  // Room rules first, so every piece below (and the room kit) respects the reserved spine.
  for (const d of list) if (mine(k, d) && d.place === 'reserve') applyReserve(k, d);
  for (const d of list) {
    if (!mine(k, d)) continue;
    if (d.place === 'hang') { applyHang(k, d); continue; }
    if (!PLACES.has(d.place) || typeof d.kind !== 'string' || !has(CATALOG, d.kind)) continue;
    const c = CATALOG[d.kind];
    const o = { tier: c.mount ? 1 : 0, free: true, dir: true, max: Math.floor(num(d.max, 0, FURNISHING_LIMITS.directiveMax, FURNISHING_LIMITS.directiveMax)) };
    if (FV[d.face]) o.face = d.face;
    const sz = c.sized ? k.sized(d.kind, d) : {};
    if (Number.isFinite(sz.w ?? d.w)) o.w = num(sz.w ?? d.w, 0.3, 60, c.w);
    if (Number.isFinite(sz.d ?? d.d)) o.d = num(sz.d ?? d.d, 0.02, 60, c.d);
    const sides = Array.isArray(d.sides) ? d.sides.filter(s => has(NORMAL, s)) : null;
    if (sides && sides.length) o.sides = sides;
    if (o.max < 1) continue;
    if (d.place === 'grid') k.grid(d.kind, { ...o, aisle: num(d.aisle, 1.2, 30, 1.2), margin: num(d.margin, 0.15, 30, 1.0) });
    else if (d.place === 'walls') k.walls(d.kind, { ...o, gap: num(d.gap, 0, 30, 0.3) });
    else if (d.place === 'wall_mount') k.mount(d.kind, { ...o, gap: num(d.gap, 0, 30, 1.5) });
    else if (d.place === 'centre') k.centre(d.kind, o);
    else k.at(d.kind, num(d.fa, 0, 1, 0.5), num(d.fb, 0, 1, 0.5), o);
  }
}

// ------------------------------------------------------------------ lights, signs, colliders
function roomLights(B, L, r, next, out) {
  const A = r.a1 - r.a0, W = r.b1 - r.b0;
  if (A < 1.2 || W < 1.2 || L.ceil - L.y < 2) return;
  const na = clamp(Math.round(A / 4.5), 1, 6), nb = clamp(Math.round(W / 4.5), 1, 4);
  const la = A >= W ? 1.2 : 0.6, lb = A >= W ? 0.6 : 1.2;
  const holes = [...(L.holes || []), ...((next && next.holes) || [])];
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
    const ca = r.a0 + (A * (i + 0.5)) / na, cb = r.b0 + (W * (j + 0.5)) / nb;
    const l = { level: L.i, a0: q(ca - la / 2), b0: q(cb - lb / 2), a1: q(ca + la / 2), b1: q(cb + lb / 2), y: L.ceil };
    if (holes.some(h => overlaps(l, h, 0.3))) continue;
    if (![[l.a0, l.b0], [l.a1, l.b0], [l.a0, l.b1], [l.a1, l.b1]].every(([a, b]) => inPoly(B.poly, a, b))) continue;
    out.push(l);
  }
}

function roomSign(plan, L, r) {
  const d = L.doors.find(d => !d.open && (d.roomA === r.id || d.roomB === r.id));
  if (!d || L.ceil - L.y < plan.doorH + 0.3) return null;
  const text = String(r.label || r.kind || 'ROOM').normalize('NFKD').replace(/[^a-zA-Z0-9 &-]/g, '').toUpperCase().slice(0, FURNISHING_LIMITS.label);
  if (!text) return null;
  const side = (r.cx - d.x) * d.nx + (r.cz - d.z) * d.nz >= 0 ? 1 : -1;
  return { level: L.i, room: r.id, text, x: q(d.x + d.nx * side * 0.13), z: q(d.z + d.nz * side * 0.13), y: q(L.y + plan.doorH + 0.16), nx: d.nx * side, nz: d.nz * side, width: q(Math.min(1.8, Math.max(0.6, text.length * 0.085))), height: 0.28 };
}

/** Stride-7 capsule for a solid prop: spine along its longer side, radius half the shorter. */
function capsule(F, p) {
  const la = p.a1 - p.a0, lb = p.b1 - p.b0, r = Math.min(la, lb) / 2;
  const ca = (p.a0 + p.a1) / 2, cb = (p.b0 + p.b1) / 2;
  const [a0, b0, a1, b1] = la >= lb ? [p.a0 + r, cb, p.a1 - r, cb] : [ca, p.b0 + r, ca, p.b1 - r];
  const [ax, az] = toWorld(F, a0, b0), [bx, bz] = toWorld(F, a1, b1);
  return [ax, az, bx, bz, r, p.y + p.lift, p.y + p.lift + p.height];
}

// ------------------------------------------------------------------ entry points
/** Pure plan postprocessor; call once after floors, stairs, walls and loot spots exist. */
export function furnishInterior(plan, shell) {
  return furnishWith(plan, shell, LANDMARK_DRESSING);
}

/** furnishInterior with an explicit landmark dressing table (tests inject their own). */
export function furnishWith(plan, shell, dressing) {
  const F = plan.frame;
  const poly = [];
  const inner = (shell && shell.inner) || [];
  for (let i = 0; i + 1 < inner.length; i += 2) poly.push(...toLocal(F, inner[i], inner[i + 1]));
  const directives = has(dressing, plan.id) && Array.isArray(dressing[plan.id]) ? dressing[plan.id] : null;
  const landmark = plan.recipe === 'landmark' || !!directives;
  const budget = landmark ? FURNISHING_LIMITS.landmarkQuads : FURNISHING_LIMITS.quads;
  const school = SCHOOL_IDS.has(plan.id) || /school/i.test(plan.recipe || '') ||
    plan.levels.some(L => L.rooms.some(r => r.kind === 'classroom' || /school|classroom|locker/i.test(r.label || '')));
  const B = { plan, shell, poly, school, landmark, dirProps: new Set() };
  let totalArea = 0;
  const roomArea = new Map();
  for (const L of plan.levels) for (const r of L.rooms) {
    const a = Math.max(1, Number.isFinite(r.area) ? r.area : (r.a1 - r.a0) * (r.b1 - r.b0));
    totalArea += a;
    roomArea.set(L.i * 65536 + r.id, a);
  }

  const furniture = [], lights = [], signs = [], lightRoom = new Map();
  plan.levels.forEach((L, li) => {
    for (const r of L.rooms) {
      if (signs.length < FURNISHING_LIMITS.signs) { const s = roomSign(plan, L, r); if (s) signs.push(s); }
      const nl = lights.length;
      roomLights(B, L, r, plan.levels[li + 1], lights);
      for (let i = nl; i < lights.length; i++) lightRoom.set(lights[i], r.id);
      const k = new Room(B, L, r);
      const circ = CIRCULATION.has(r.kind);
      if (k.area < (circ ? 6 : 2.5) || Math.min(k.A, k.Bw) < (circ ? 2 : 1.2)) continue;
      if (k.area < 150 && stairRoom(plan, L, r)) continue;
      k.allow = Math.max(FURNISHING_LIMITS.roomMin, ((directives ? 0.8 : 1.6) * budget * k.area) / Math.max(1, totalArea));
      if (directives) applyDirectives(k, directives);
      if (!k.skipKit) (KITS[r.kind] || KITS.default)(k);
      furniture.push(...k.props);
    }
  });

  // Budget: trim tier 3 (clutter), 2 (wall decor), 1, then 0. Each tier is "water-filled": every
  // room keeps up to a common quad density (quads per m^2), so the densest rooms shrink first and no room or storey is
  // emptied wholesale. Within a room, kit filler goes before landmark directive pieces, and
  // ceiling lights (tier 0) go last; later-placed items go first.
  // Lights may use at most 15% of the budget; beyond that keep an evenly spaced subset.
  const lightCap = Math.floor((0.15 * budget) / quadCost('light'));
  const lightSet = lights.length <= lightCap ? lights : Array.from({ length: lightCap }, (_, i) => lights[Math.floor((i * lights.length) / lightCap)]);
  const entries = [...furniture.map(p => ({ p, t: p.tier, c: quadCost(p.kind), rank: B.dirProps.has(p) ? 1 : 0, key: p.level * 65536 + p.room })),
    ...lightSet.map(p => ({ p, t: 0, c: 3, rank: 2, light: true, key: p.level * 65536 + lightRoom.get(p) }))];
  let total = 0;
  for (const e of entries) total += e.c;
  for (const t of [3, 2, 1, 0]) {
    if (total <= budget) break;
    const rooms = new Map();
    let tierCost = 0;
    entries.forEach((e, i) => {
      if (e.t !== t) return;
      if (!rooms.has(e.key)) rooms.set(e.key, { cost: 0, list: [], w: Math.max(30, roomArea.get(e.key) || 1) });
      const R = rooms.get(e.key);
      R.cost += e.c; R.list.push(i); tierCost += e.c;
    });
    const target = Math.max(0, budget - (total - tierCost));
    const keep = (C) => { let s = 0; for (const R of rooms.values()) s += Math.min(R.cost, C * R.w); return s; };
    let lo = 0, hi = 0;
    for (const R of rooms.values()) if (R.cost / R.w > hi) hi = R.cost / R.w;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (keep(mid) <= target) lo = mid; else hi = mid; }
    for (const R of rooms.values()) {
      const order = R.list.sort((x, y) => entries[x].rank - entries[y].rank || y - x);
      for (const i of order) {
        if (R.cost <= lo * R.w) break;
        entries[i].gone = true; R.cost -= entries[i].c; total -= entries[i].c;
      }
    }
    // The common level can fall below one item's cost: refill leftover budget in placement order.
    for (const e of entries) if (e.t === t && e.gone && total + e.c <= budget) { e.gone = false; total += e.c; }
  }
  const keptF = entries.filter(e => !e.light && !e.gone).map(e => e.p);
  const keptL = entries.filter(e => e.light && !e.gone).map(e => e.p);

  const levels = plan.levels.map(L => {
    const caps = [], block = [];
    for (const p of keptF) if (p.solid && p.level === L.i) { caps.push(...capsule(F, p)); block.push(p.block ? 1 : 0); }
    return { ...L, props: new Float32Array(caps), propBlock: new Uint8Array(block) };
  });

  let hash = mix(plan.hash, 3); // furnishing schema revision
  for (const p of keptF) {
    for (const n of [p.level, p.room, p.a0 * 64, p.b0 * 64, p.a1 * 64, p.b1 * 64, p.y * 64, p.lift * 64, p.height * 64, p.color, p.accent,
      FACE_ID[p.face], (p.solid ? 1 : 0) | (p.block ? 2 : 0) | (p.tier << 2)]) hash = mix(hash, n);
    for (const c of p.kind) hash = mix(hash, c.charCodeAt(0));
    if (p.art !== undefined) {
      hash = mix(mix(hash, p.art), p.frame);
      for (const c of p.artStyle) hash = mix(hash, c.charCodeAt(0));
    }
  }
  for (const l of keptL) for (const n of [l.level, l.a0 * 64, l.b0 * 64, l.a1 * 64, l.b1 * 64, l.y * 64]) hash = mix(hash, n);
  for (const s of signs) {
    for (const n of [s.level, s.room, s.x * 64, s.z * 64, s.y * 64, s.width * 64, Math.round(s.nx * 65536), Math.round(s.nz * 65536)]) hash = mix(hash, n);
    for (const c of s.text) hash = mix(hash, c.charCodeAt(0));
  }
  const { colliders, ...rest } = plan; // eslint-disable-line no-unused-vars -- v3 replaces plan.colliders
  return { ...rest, levels, furniture: keptF, lights: keptL, signs, hash };
}
