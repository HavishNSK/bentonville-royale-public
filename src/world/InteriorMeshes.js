// BENTONVILLE ROYALE — interior geometry for a hollow building's plan (Interiors.js): partition
// walls (both faces, end caps, lintel undersides) coloured per room kind, and per-room floor
// colour overlays. Everything goes into the building chunk's merged geometry (WorldMeshes.js,
// same material; aWall.z = -1 so the window shader leaves it alone). Each breakable inner
// panel's quads are consecutive and their index range is recorded in chunk.panelRanges so
// view.hidePanel / showPanel can blank / restore them.
// Baked shading (no lights, no textures): a darker skirting strip and a lighter top band on
// each solid partition face (inside that panel's recorded range), darker floor strips along
// every room edge as fake ambient occlusion, plus ceiling light panels (InteriorFurnishings.js).

import * as THREE from 'three';
import { FLOOR_THICKNESS } from './interiors/storeys.js';
import { addStairGeometry } from './InteriorStairs.js';
import { addFurnishingGeometry, addLightGeometry } from './InteriorFurnishings.js';
import { clipRect, q, toLocal, toWorld } from './interiors/layout.js';
import { LANDMARK_STYLE, styleFor } from './interiors/landmarkStyle.js';

// [wall, floor] per room kind
const ROOM_COLORS = {
  living: [0xeee4d0, 0xa47b52],
  bedroom: [0xdfe6ee, 0xb08d68],
  kitchen: [0xf3eedf, 0xc9c2b3],
  dining: [0xeadccb, 0x9c7650],
  bath: [0xdcefef, 0xd8dcdc],
  corridor: [0xe8e4dc, 0x8f8a82],
  hall: [0xf1efe9, 0x9a958c],
  lobby: [0xece6da, 0xb9aa92],
  sales: [0xf5f3ee, 0xbdb8ae],
  storage: [0xd6d1c4, 0x80796f],
  office: [0xe4e8ea, 0x7d8a96],
  vault: [0xc9cdd1, 0x6f747a],
  break: [0xf0e6cf, 0xb5a17e],
  restroom: [0xe2eef0, 0xcfd6d8],
  apartment: [0xeee6d6, 0xa8845e],
  greenhouse: [0xe6efe0, 0x8a7a5e],
  garage: [0xcfcfcb, 0x77777a],
  open: [0xe9e4d8, 0x9b917f],
  stall: [0xf1e3c8, 0xb39c7c],
  gallery: [0xf4f0e8, 0xcfae84], // warm white box, pale oak
  auditorium: [0x3f3358, 0x553a4c], // deep violet-ink walls, dark plum carpet
  library: [0xe6dcc6, 0x8c6a4a],
  classroom: [0xece6d4, 0xc2b9a2],
  cafe: [0xf0dcc2, 0x9c6e48],
  bar: [0x5f4a63, 0x6b4a33],
  courtroom: [0xb38c63, 0x6e4a36], // wood panelling
  cafeteria: [0xf2ead2, 0xc9c0a8],
  studio: [0xf1ece2, 0x8f8a84],
  gym: [0xe9e3d4, 0xd6a96a], // maple floor
  brewhouse: [0xd8d2c6, 0x9a968e], // concrete
};
const DEFAULT_COLORS = [0xe9e1cf, 0x9b917f];
const _col = new THREE.Color();
const rgb = (hex) => {
  _col.setHex(hex);
  return [_col.r, _col.g, _col.b];
};
const byte = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
/** Blend a hex colour toward `to` by t, then scale by k. */
const tone = (hex, k, to = hex, t = 0) => {
  const ch = (sh) => byte((((hex >> sh) & 255) * (1 - t) + ((to >> sh) & 255) * t) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
const SKIRT_H = 0.12; // skirting board height above the room floor overlay
const TOP_BAND = 0.22; // lighter band under the ceiling
const EDGE_AO = 0.35; // darker floor strip width along room edges
const CEILING_HEX = 0xd7d0c3; // underside of an upper storey's floor
// Floor layer offsets above the level floor (each a distinct depth so nothing z-fights):
//   +0.05 room floor overlay, +0.053 edge AO strips, +0.0545 doorway threshold band (styled
//   landmarks only), +0.056 light pools, +0.059 contact shadows, +0.06 prop bases.
const THRESHOLD_Y = 0.0545;
const THRESHOLD_D = 0.5; // threshold band depth across the doorway (m)
const BEAM_TOP_GAP = 0.005; // beams hang just under the ceiling plane
// styled ceiling plane sits this far under the level ceiling: on the top storey it covers the
// shell's up-lit ceiling, and 1 cm stays depth-separable (near 0.3 m, 24-bit) out to ~200 m;
// beam tops (BEAM_TOP_GAP) end 5 mm above it, hidden. Light panels hang 2-3 cm down, below it.
const STYLED_CEIL_GAP = 0.01;
// Light normal for styled ceilings and beam undersides. An up normal takes the full hemisphere
// SKY colour (#c6e0ff), which turns a cream ceiling blue-grey. This one tilts slightly down
// (n.y = -0.25: ~38% sky / 62% warm ground fill, so cream stays cream), and its horizontal part
// is perpendicular to the sun in render/Atmosphere.js (SUN_DIRECTION -0.42, 0.74, 0.52), so
// n . sun < 0 and the sun adds nothing. Keep it in sync if the sun direction changes.
const LIT_DOWN = 0.25;
const LIT_H = Math.sqrt(1 - LIT_DOWN * LIT_DOWN) / Math.hypot(0.52, 0.42);
export const NEUTRAL_LIT = Object.freeze([0.52 * LIT_H, -LIT_DOWN, 0.42 * LIT_H]);

/** Split rects around stair holes (the room floor overlay must not cover an opening). */
function cutHoles(rects, holes) {
  for (const hole of holes) {
    const next = [];
    for (const R of rects) {
      const a0 = Math.max(R.a0, hole.a0), a1 = Math.min(R.a1, hole.a1), b0 = Math.max(R.b0, hole.b0), b1 = Math.min(R.b1, hole.b1);
      if (a0 >= a1 || b0 >= b1) { next.push(R); continue; }
      next.push({a0:R.a0,b0:R.b0,a1:a0,b1:R.b1},{a0:a1,b0:R.b0,a1:R.a1,b1:R.b1},{a0,b0:R.b0,a1,b1:b0},{a0,b0:b1,a1,b1:R.b1});
    }
    rects = next.filter((R) => R.a1 - R.a0 > 0.01 && R.b1 - R.b0 > 0.01);
  }
  return rects;
}

/** Room [wall, floor] hex: a landmark style (labels beat kinds) overrides the per-kind colours. */
const roomWall = (room, st) => (st && st.wall !== undefined ? st.wall : (ROOM_COLORS[room && room.kind] || DEFAULT_COLORS)[0]);
const roomFloor = (room, st) => (st && st.floor !== undefined ? st.floor : (ROOM_COLORS[room && room.kind] || DEFAULT_COLORS)[1]);
const roomAt = (L, a, b) => (L ? L.rooms.find((q) => a >= q.a0 && a <= q.a1 && b >= q.b0 && b <= q.b1) : undefined);

/** floorAt(level, a, b): the floor colour of the room under plan point (a, b), or null. */
function floorLookup(plan, styles) {
  return (level, a, b) => {
    const L = plan.levels.find((l) => l.i === level);
    if (!L) return null;
    const r = roomAt(L, a, b);
    return r ? roomFloor(r, styleFor(plan.id, r, styles)) : null;
  };
}

/** Subtract intervals cuts ([[lo, hi], ...]) from [lo, hi]; returns the remaining pieces. */
function subtractIntervals(lo, hi, cuts) {
  let parts = [[lo, hi]];
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [p0, p1] of parts) {
      if (c1 <= p0 || c0 >= p1) { next.push([p0, p1]); continue; }
      if (c0 > p0) next.push([p0, c0]);
      if (c1 < p1) next.push([c1, p1]);
    }
    parts = next;
  }
  return parts.filter(([p0, p1]) => p1 - p0 > 0.05);
}

/**
 * Inside intervals of the line {axis coordinate = s} through polygon P (flat local [a, b, ...]),
 * as sorted [t0, t1] pairs along the other axis, clamped to [lo, hi]. alongA: the line is a = s.
 */
export function lineIntervals(P, alongA, s, lo, hi) {
  const xs = [];
  const n = P.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = alongA ? P[i * 2] : P[i * 2 + 1], q0 = alongA ? P[i * 2 + 1] : P[i * 2];
    const p1 = alongA ? P[j * 2] : P[j * 2 + 1], q1 = alongA ? P[j * 2 + 1] : P[j * 2];
    if ((p0 <= s) === (p1 <= s)) continue; // half-open: a vertex on the line counts once
    xs.push(q0 + ((s - p0) / (p1 - p0)) * (q1 - q0));
  }
  xs.sort((x, y) => x - y);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const t0 = Math.max(xs[k], lo), t1 = Math.min(xs[k + 1], hi);
    if (t1 > t0) out.push([t0, t1]);
  }
  return out;
}

/** Intersection of two sorted interval lists. */
function intersectIntervals(A, B) {
  const out = [];
  for (const [a0, a1] of A) for (const [b0, b1] of B) {
    const t0 = Math.max(a0, b0), t1 = Math.min(a1, b1);
    if (t1 > t0) out.push([t0, t1]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/**
 * Timber beams under the ceiling of room r (styled landmarks only): each spans the room's short
 * axis, repeated every ~spacing m along the long axis, kept to where both long edges and the
 * centre line of the strip are inside the inner polygon (a beam crossing a notch of a concave
 * shell, e.g. the Bridge Gallery, splits instead of spanning the open air) and cut around the
 * ceiling light panels and the stair openings in the floor above. Per piece: an underside
 * (wound down, lit with NEUTRAL_LIT), two sides and two end caps (a cap against a wall faces
 * the wall, so it is back-face culled from inside). Emitted outside every partition panel range.
 */
function addBeams(chunk, quad, F, P, r, beams, yTop, cuts, h) {
  const alongA = r.a1 - r.a0 >= r.b1 - r.b0; // long axis is a: beams cross b, repeat along a
  const len = alongA ? r.a1 - r.a0 : r.b1 - r.b0;
  const spacing = Math.max(0.8, beams.spacing || 2.4);
  const n = Math.round(len / spacing);
  if (n < 1) return;
  const bw = Math.min(beams.width || 0.18, spacing / 3);
  const depth = Math.min(Math.max(0.02, beams.depth || 0.25), 0.6);
  const y1 = yTop - BEAM_TOP_GAP, y0 = y1 - depth;
  const side = rgb(beams.color);
  const under = rgb(tone(beams.color, 0.82));
  // local (s along the long axis, t across) -> world point at height y
  const W = (s, t, y) => { const [x, z] = alongA ? toWorld(F, s, t) : toWorld(F, t, s); return [x, y, z]; };
  const nS = alongA ? [F.ux, F.uz] : [F.vx, F.vz];
  const nT = alongA ? [F.vx, F.vz] : [F.ux, F.uz];
  const lo0 = alongA ? r.b0 : r.a0, hi0 = alongA ? r.b1 : r.a1;
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const c = (alongA ? r.a0 : r.b0) + (i + 0.5) * step;
    const s0 = c - bw / 2, s1 = c + bw / 2;
    // inside the inner polygon along both long edges and the centre line of the strip
    let spans = lineIntervals(P, alongA, s0, lo0, hi0);
    spans = intersectIntervals(spans, lineIntervals(P, alongA, c, lo0, hi0));
    spans = intersectIntervals(spans, lineIntervals(P, alongA, s1, lo0, hi0));
    if (!spans.length) continue;
    const blocks = [];
    for (const q of cuts) {
      const q0 = alongA ? q.a0 : q.b0, q1 = alongA ? q.a1 : q.b1;
      if (q1 <= s0 || q0 >= s1) continue;
      blocks.push(alongA ? [q.b0 - 0.05, q.b1 + 0.05] : [q.a0 - 0.05, q.a1 + 0.05]);
    }
    for (const [lo, hi] of spans) for (const [t0, t1] of subtractIntervals(lo, hi, blocks)) {
      quad(chunk, W(s0, t0, y0), W(s1, t0, y0), W(s1, t1, y0), W(s0, t1, y0), 0, -1, 0, ...under, null, h, NEUTRAL_LIT);
      quad(chunk, W(s0, t0, y0), W(s0, t1, y0), W(s0, t1, y1), W(s0, t0, y1), -nS[0], 0, -nS[1], ...side, null, h);
      quad(chunk, W(s1, t0, y0), W(s1, t1, y0), W(s1, t1, y1), W(s1, t0, y1), nS[0], 0, nS[1], ...side, null, h);
      quad(chunk, W(s0, t0, y0), W(s1, t0, y0), W(s1, t0, y1), W(s0, t0, y1), -nT[0], 0, -nT[1], ...side, null, h);
      quad(chunk, W(s0, t1, y0), W(s1, t1, y0), W(s1, t1, y1), W(s0, t1, y1), nT[0], 0, nT[1], ...side, null, h);
    }
  }
}

/**
 * Ceiling of a styled room r at height y: the room rect cut around the stair openings in the
 * floor above, clipped to the inner polygon, wound down and lit with NEUTRAL_LIT so the style's
 * cream reads cream (not tinted by the hemisphere sky colour). One quad per triangle (d = c).
 */
function addStyledCeiling(chunk, quad, F, P, r, hex, y, holes, h) {
  const [cr, cg, cb] = rgb(hex);
  for (const R of cutHoles([{ a0: r.a0, b0: r.b0, a1: r.a1, b1: r.b1 }], holes)) {
    const poly = clipRect(P, R.a0, R.b0, R.a1, R.b1);
    if (poly.length < 6) continue;
    const pts = [];
    for (let i = 0; i < poly.length; i += 2) pts.push(toWorld(F, poly[i], poly[i + 1]));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    } catch (err) {
      continue; // degenerate clip: leave the shell / floor-underside ceiling showing
    }
    for (const [i, j, k] of tris) {
      const a = [pts[i][0], y, pts[i][1]], b = [pts[j][0], y, pts[j][1]], c = [pts[k][0], y, pts[k][1]];
      quad(chunk, a, b, c, c, 0, -1, 0, cr, cg, cb, null, h, NEUTRAL_LIT);
    }
  }
}

const UP_LIT = [0, 1, 0];
const SLAB_EDGE_HEX = tone(CEILING_HEX, 0.72); // the cut face of a slab around a broken tile

/**
 * Room r of level L split into its solid floor pieces (rim, cells that must stay solid) and its
 * breakable floor tiles (interiors/floorTiles.js), plus the tile grid itself (or null).
 */
function slabSplit(plan, L, r) {
  const room = { a0: r.a0, b0: r.b0, a1: r.a1, b1: r.b1 };
  const g = (L.tiles || []).find((t) => t.room === r.id);
  if (!g) return { solid: [room], tiles: [], g: null };
  const solid = cutHoles([room], [g]);
  const tiles = [];
  for (let i = 0; i < g.na; i++) for (let j = 0; j < g.nb; j++) {
    const id = g.ids[i * g.nb + j];
    if (id >= 0) { tiles.push({ pn: plan.panels[id], i, j }); continue; }
    solid.push({ a0: q(g.a0 + ((g.a1 - g.a0) * i) / g.na), a1: q(g.a0 + ((g.a1 - g.a0) * (i + 1)) / g.na),
      b0: q(g.b0 + ((g.b1 - g.b0) * j) / g.nb), b1: q(g.b0 + ((g.b1 - g.b0) * (j + 1)) / g.nb) });
  }
  return { solid, tiles, g };
}

const TILE_LAP = 0.004; // metres a breakable floor tile's faces overlap their surroundings

/**
 * One breakable floor tile of level L (> 0): its floor top, the ceiling of the storey below
 * under it (that room's style, lit like the rest of its ceiling) and side faces toward
 * neighbouring tiles, all in the tile's panel range (hidden when it breaks). Where it borders
 * solid floor, an always-drawn face looks into the tile instead (enclosed in the slab while the
 * tile stands, the clean cut edge once it breaks).
 */
function addFloorTile(chunk, quad, F, plan, shell, styles, L, below, t, g, floorHex, h) {
  const { pn, i, j } = t;
  const { a0, b0, a1, b1 } = pn;
  const base = L.y - shell.floor;
  const yT = base + 0.05, yU = base - FLOOR_THICKNESS;
  const W = (a, b, y) => { const [x, z] = toWorld(F, a, b); return [x, y, z]; };
  const i0 = chunk.buf.idx.length;
  // The top (and the ceiling under it) reaches TILE_LAP past the tile on every side. Tiles meet
  // the solid floor around them at T-junctions (no shared vertices), where single-pixel cracks
  // showed the dark slab edge as a dotted grid; a few millimetres of same-coloured overlap
  // covers them.
  const e = TILE_LAP;
  quad(chunk, W(a0 - e, b0 - e, yT), W(a1 + e, b0 - e, yT), W(a1 + e, b1 + e, yT), W(a0 - e, b1 + e, yT), 0, 1, 0, ...rgb(floorHex), null, h);
  for (const lr of below ? below.rooms : []) {
    const c0 = Math.max(a0, lr.a0), c1 = Math.min(a1, lr.a1), d0 = Math.max(b0, lr.b0), d1 = Math.min(b1, lr.b1);
    if (c1 - c0 < 0.01 || d1 - d0 < 0.01) continue;
    const lst = styleFor(plan.id, lr, styles);
    const styled = lst && lst.ceiling !== undefined;
    const y = styled ? below.ceil - shell.floor - STYLED_CEIL_GAP : yU;
    quad(chunk, W(c0 - e, d0 - e, y), W(c1 + e, d0 - e, y), W(c1 + e, d1 + e, y), W(c0 - e, d1 + e, y), 0, -1, 0,
      ...rgb(styled ? lst.ceiling : CEILING_HEX), null, h, styled ? NEUTRAL_LIT : UP_LIT);
  }
  const edge = rgb(SLAB_EDGE_HEX);
  const isTile = (ii, jj) => ii >= 0 && jj >= 0 && ii < g.na && jj < g.nb && g.ids[ii * g.nb + jj] >= 0;
  // [neighbour cell, edge corners, outward normal (local axis, sign)]
  const sides = [
    [i - 1, j, [a0, b0], [a0, b1], [F.ux, F.uz], -1],
    [i + 1, j, [a1, b0], [a1, b1], [F.ux, F.uz], 1],
    [i, j - 1, [a0, b0], [a1, b0], [F.vx, F.vz], -1],
    [i, j + 1, [a0, b1], [a1, b1], [F.vx, F.vz], 1],
  ];
  const solidSides = [];
  for (const [ni, nj, A, B, n, sg] of sides) {
    if (!isTile(ni, nj)) { solidSides.push([A, B, n, -sg]); continue; }
    quad(chunk, W(A[0], A[1], yU), W(B[0], B[1], yU), W(B[0], B[1], yT), W(A[0], A[1], yT), n[0] * sg, 0, n[1] * sg, ...edge, null, h);
  }
  chunk.panelRanges.push(pn, i0, chunk.buf.idx.length - i0);
  for (const [A, B, n, sg] of solidSides) {
    quad(chunk, W(A[0], A[1], yU), W(B[0], B[1], yU), W(B[0], B[1], yT), W(A[0], A[1], yT), n[0] * sg, 0, n[1] * sg, ...edge, null, h);
  }
}

/**
 * The roof slab of a building with a roof tile grid (plan.roof, interiors/shellPanels.js): its
 * top (at h) and the top storey's ceiling (underside) over the solid rim and the non-tile cells,
 * then each breakable roof tile in its own panel range: top, underside (that room's styled
 * ceiling when it has one) and side faces toward neighbouring tiles. Where a tile borders solid
 * roof, an always-drawn face looks into the tile (the clean cut edge once it breaks).
 * api.roof = { outer: footprint [[x, z], ...], hex: roof colour, ceiling: plain ceiling colour }.
 * WorldMeshes calls it on the building's shell chunk (always drawn), not the near-only room chunk.
 */
export function addRoofGeometry(chunk, shell, h, api, styles = LANDMARK_STYLE) {
  if (!shell.plan || !shell.plan.roof || !api.roof) return;
  const plan = shell.plan;
  const { quad, hcapFlat } = api;
  const { outer, hex, ceiling } = api.roof;
  const F = plan.frame;
  const g = plan.roof;
  const yT = h;
  const yU = shell.ceil - shell.floor;
  const top = plan.levels[plan.levels.length - 1];
  const local = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i += 2) out.push(...toLocal(F, pts[i], pts[i + 1]));
    return out;
  };
  const O = local(outer.flat());
  const I = local(shell.inner);
  const cell = (i, j) => ({
    a0: q(g.a0 + ((g.a1 - g.a0) * i) / g.na), a1: q(g.a0 + ((g.a1 - g.a0) * (i + 1)) / g.na),
    b0: q(g.b0 + ((g.b1 - g.b0) * j) / g.nb), b1: q(g.b0 + ((g.b1 - g.b0) * (j + 1)) / g.nb),
  });
  const cap = (P, R, y, color, facing, litDir) => {
    const poly = clipRect(P, R.a0, R.b0, R.a1, R.b1);
    if (poly.length < 6) return;
    const pts = [];
    for (let i = 0; i < poly.length; i += 2) pts.push(...toWorld(F, poly[i], poly[i + 1]));
    hcapFlat(chunk, pts, y, color, h, facing, litDir);
  };
  // solid roof: the frame outside the grid (generous: clipped to the polygons) and non-tile cells
  const M = 1;
  const solid = [
    { a0: -M, b0: -M, a1: g.a0, b1: F.W + M }, { a0: g.a1, b0: -M, a1: F.L + M, b1: F.W + M },
    { a0: g.a0, b0: -M, a1: g.a1, b1: g.b0 }, { a0: g.a0, b0: g.b1, a1: g.a1, b1: F.W + M },
  ];
  for (let i = 0; i < g.na; i++) for (let j = 0; j < g.nb; j++) if (g.ids[i * g.nb + j] < 0) solid.push(cell(i, j));
  for (const R of solid) {
    if (R.a1 - R.a0 < 1e-3 || R.b1 - R.b0 < 1e-3) continue;
    cap(O, R, yT, hex, 1, 1);
    cap(I, R, yU, ceiling, -1, 1); // wound down, lit as up: a bright painted ceiling
  }
  const W = (a, b, y) => { const [x, z] = toWorld(F, a, b); return [x, y, z]; };
  const isTile = (i, j) => i >= 0 && j >= 0 && i < g.na && j < g.nb && g.ids[i * g.nb + j] >= 0;
  const edge = rgb(SLAB_EDGE_HEX);
  const [rr, rg, rb] = rgb(hex);
  for (let i = 0; i < g.na; i++) for (let j = 0; j < g.nb; j++) {
    const id = g.ids[i * g.nb + j];
    if (id < 0) continue;
    const pn = plan.panels[id];
    const { a0, b0, a1, b1 } = pn;
    const i0 = chunk.buf.idx.length;
    quad(chunk, W(a0, b0, yT), W(a1, b0, yT), W(a1, b1, yT), W(a0, b1, yT), 0, 1, 0, rr, rg, rb, null, h);
    // underside: per top-storey room, its styled ceiling plane or the plain ceiling
    let covered = 0;
    for (const lr of top.rooms) {
      const c0 = Math.max(a0, lr.a0), c1 = Math.min(a1, lr.a1), d0 = Math.max(b0, lr.b0), d1 = Math.min(b1, lr.b1);
      if (c1 - c0 < 0.01 || d1 - d0 < 0.01) continue;
      covered += (c1 - c0) * (d1 - d0);
      const lst = styleFor(plan.id, lr, styles);
      const styled = lst && lst.ceiling !== undefined;
      const y = styled ? yU - STYLED_CEIL_GAP : yU;
      quad(chunk, W(c0, d0, y), W(c1, d0, y), W(c1, d1, y), W(c0, d1, y), 0, -1, 0,
        ...rgb(styled ? lst.ceiling : ceiling), null, h, styled ? NEUTRAL_LIT : UP_LIT);
    }
    if (covered < (a1 - a0) * (b1 - b0) - 0.05) {
      // rooms don't cover the whole tile: the plain ceiling just above any room planes
      quad(chunk, W(a0, b0, yU + 0.002), W(a1, b0, yU + 0.002), W(a1, b1, yU + 0.002), W(a0, b1, yU + 0.002), 0, -1, 0, ...rgb(ceiling), null, h, UP_LIT);
    }
    const sides = [
      [i - 1, j, [a0, b0], [a0, b1], [F.ux, F.uz], -1],
      [i + 1, j, [a1, b0], [a1, b1], [F.ux, F.uz], 1],
      [i, j - 1, [a0, b0], [a1, b0], [F.vx, F.vz], -1],
      [i, j + 1, [a0, b1], [a1, b1], [F.vx, F.vz], 1],
    ];
    const solidSides = [];
    for (const [ni, nj, A, B, n, sg] of sides) {
      if (!isTile(ni, nj)) { solidSides.push([A, B, n, -sg]); continue; }
      quad(chunk, W(A[0], A[1], yU), W(B[0], B[1], yU), W(B[0], B[1], yT), W(A[0], A[1], yT), n[0] * sg, 0, n[1] * sg, ...edge, null, h);
    }
    chunk.panelRanges.push(pn, i0, chunk.buf.idx.length - i0);
    for (const [A, B, n, sg] of solidSides) {
      quad(chunk, W(A[0], A[1], yU), W(B[0], B[1], yU), W(B[0], B[1], yT), W(A[0], A[1], yT), n[0] * sg, 0, n[1] * sg, ...edge, null, h);
    }
  }
}

/**
 * shell: World collider.shell with .plan; h: building height (aH attribute);
 * api: { quad, hcapFlat } from WorldMeshes.
 */
export function addInteriorGeometry(chunk, shell, h, api, styles = LANDMARK_STYLE) {
  const plan = shell.plan;
  const { quad, hcapFlat } = api;
  const F = plan.frame;
  const inner = shell.inner;
  // inner polygon in the plan frame (room floors are clipped to it)
  const P = new Array(inner.length);
  for (let i = 0; i < inner.length; i += 2) {
    const [a, b] = toLocal(F, inner[i], inner[i + 1]);
    P[i] = a;
    P[i + 1] = b;
  }
  for (const L of plan.levels) {
    const base = L.y - shell.floor;
    const roomOf = (r) => (r >= 0 && L.rooms[r] ? L.rooms[r] : null);
    const styleOf = (r) => styleFor(plan.id, roomOf(r), styles);
    const wallHex = (r) => roomWall(roomOf(r), styleOf(r));
    const below = plan.levels.find((l) => l.i === L.i - 1);
    const above = plan.levels.find((l) => l.i === L.i + 1);
    const styledBelow = below ? below.rooms.filter((q) => styleFor(plan.id, q, styles)?.ceiling !== undefined) : [];

    // breakable floor tiles of the storey above (its slab is this storey's ceiling), or on the top
    // storey the breakable roof tiles (interiors/shellPanels.js)
    const aboveTiles = above
      ? plan.panels.filter((p) => p.kind === 'floor' && p.level === above.i)
      : plan.panels.filter((p) => p.kind === 'roof');

    // ---- room floors (+0.02 over the interior floor); breakable tiles drawn on their own
    for (const r of L.rooms) {
      const st = styleFor(plan.id, r, styles);
      const floorHex = roomFloor(r, st);
      const split = slabSplit(plan, L, r);
      for (const t of split.tiles) addFloorTile(chunk, quad, F, plan, shell, styles, L, below, t, split.g, floorHex, h);
      const rects = cutHoles(split.solid, L.holes);
      for(const R of rects) {
        const poly=clipRect(P,R.a0,R.b0,R.a1,R.b1);
        if(poly.length<6)continue;
        const pts=[];
        for(let i=0;i<poly.length;i+=2)pts.push(...toWorld(F,poly[i],poly[i+1]));
        hcapFlat(chunk,pts,base+0.05,floorHex,h);
        if(L.i>0){
          // ceiling of the storey below, minus its styled rooms (those draw their own neutral-lit
          // ceiling plane: addStyledCeiling), so the two never overlap / z-fight
          for(const C of cutHoles([R],styledBelow)){
            const cp=C===R?poly:clipRect(P,C.a0,C.b0,C.a1,C.b1);
            if(cp.length<6)continue;
            const cpts=[];
            for(let i=0;i<cp.length;i+=2)cpts.push(...toWorld(F,cp[i],cp[i+1]));
            hcapFlat(chunk,cpts,base-FLOOR_THICKNESS,CEILING_HEX,h,-1,1); // lit as up: bright ceiling
          }
        }
      }
      // fake AO: darker strips along the room's edges (cut around stair holes, clipped to the shell)
      const sw = Math.min(EDGE_AO, (r.a1 - r.a0) / 4, (r.b1 - r.b0) / 4);
      if (sw > 0.05) {
        const edgeHex = tone(floorHex, 0.8);
        const strips = [
          {a0:r.a0,b0:r.b0,a1:r.a1,b1:r.b0+sw}, {a0:r.a0,b0:r.b1-sw,a1:r.a1,b1:r.b1},
          {a0:r.a0,b0:r.b0+sw,a1:r.a0+sw,b1:r.b1-sw}, {a0:r.a1-sw,b0:r.b0+sw,a1:r.a1,b1:r.b1-sw},
        ];
        for (const R of cutHoles(strips, L.holes)) {
          const poly = clipRect(P, R.a0, R.b0, R.a1, R.b1);
          if (poly.length < 6) continue;
          const pts = [];
          for (let i = 0; i < poly.length; i += 2) pts.push(...toWorld(F, poly[i], poly[i + 1]));
          hcapFlat(chunk, pts, base + 0.053, edgeHex, h);
        }
      }
      // styled ceiling plane (covers the shell ceiling on the top storey, replaces the upper floor's underside below)
      if (st && st.ceiling !== undefined && Number.isFinite(L.ceil)) {
        const over = aboveTiles.filter((p) => p.a0 < r.a1 && p.a1 > r.a0 && p.b0 < r.b1 && p.b1 > r.b0);
        addStyledCeiling(chunk, quad, F, P, r, st.ceiling, L.ceil - shell.floor - STYLED_CEIL_GAP, [...(above ? above.holes : []), ...over], h);
      }
      // timber ceiling beams (styled landmarks only)
      if (st && st.beams && Number.isFinite(L.ceil)) {
        const cuts = [...(above ? above.holes : []), ...(plan.lights || []).filter((q) => q && q.level === L.i)];
        addBeams(chunk, quad, F, P, r, st.beams, L.ceil - shell.floor, cuts, h);
      }
    }

    // ---- doorway threshold bands (styled landmarks only): door width x THRESHOLD_D, centred on the wall line
    for (const d of L.doors || []) {
      const sa = styleOf(d.roomA), sb = styleOf(d.roomB);
      const hex = sb && sb.threshold !== undefined ? sb.threshold : sa && sa.threshold !== undefined ? sa.threshold : undefined;
      if (hex === undefined || !(d.w > 0)) continue;
      const tx = d.nz, tz = -d.nx, hw = d.w / 2, hd = THRESHOLD_D / 2, y = base + THRESHOLD_Y;
      const C = (u, v) => [d.x + tx * u + d.nx * v, y, d.z + tz * u + d.nz * v];
      quad(chunk, C(-hw, -hd), C(hw, -hd), C(hw, hd), C(-hw, hd), 0, 1, 0, ...rgb(hex), null, h);
    }

    // ---- partitions
    const W = L.walls;
    for (let k = 0, w = 0; k < W.length; k += 7, w++) {
      const meta = L.wallMeta[w];
      let ax = W[k];
      let az = W[k + 1];
      let bx = W[k + 2];
      let bz = W[k + 3];
      const r = W[k + 4];
      const y0 = W[k + 5] - shell.floor;
      const y1 = W[k + 6] - shell.floor;
      const ex = bx - ax;
      const ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 1e-4) continue;
      const tx = ex / len;
      const tz = ez / len;
      const solid = meta.kind === 'wall';
      if (solid) {
        // a solid run is drawn out to its capsule's reach (r past each end)
        ax -= tx * r;
        az -= tz * r;
        bx += tx * r;
        bz += tz * r;
      }
      // side normal of the wall direction; meta (nx, nz) points toward room rb
      const sx = -tz;
      const sz = tx;
      const flip = sx * meta.nx + sz * meta.nz < 0; // +s side is ra's side when flipped
      const pHex = wallHex(flip ? meta.ra : meta.rb);
      const mHex = wallHex(flip ? meta.rb : meta.ra);
      const [pr, pg, pb] = rgb(pHex);
      const [mr, mg, mb] = rgb(mHex);
      const A = (s, y) => [ax + sx * r * s, y, az + sz * r * s];
      const B = (s, y) => [bx + sx * r * s, y, bz + sz * r * s];
      const i0 = chunk.buf.idx.length;
      quad(chunk, A(1, y0), B(1, y0), B(1, y1), A(1, y1), sx, 0, sz, pr, pg, pb, null, h);
      quad(chunk, A(-1, y0), B(-1, y0), B(-1, y1), A(-1, y1), -sx, 0, -sz, mr, mg, mb, null, h);
      if (solid) {
        // end caps (door jambs, or the cut end beside a broken neighbour)
        // (inset from both faces so their edges never show through the seam beside a neighbour)
        quad(chunk, A(-0.75, y0), A(0.75, y0), A(0.75, y1), A(-0.75, y1), -tx, 0, -tz, mr, mg, mb, null, h);
        quad(chunk, B(-0.75, y0), B(0.75, y0), B(0.75, y1), B(-0.75, y1), tx, 0, tz, pr, pg, pb, null, h);
        // baked shading: skirting (just proud of each face) and a lighter band under the ceiling;
        // emitted before the panel range is recorded so hidePanel blanks them with the wall
        const sk = (r + 0.012) / r;
        const tb = (r + 0.004) / r;
        const ys = y0 + 0.05;
        const pTrim = styleOf(flip ? meta.ra : meta.rb), mTrim = styleOf(flip ? meta.rb : meta.ra);
        for (const [s, hex, nx, nz, ts] of [[1, pHex, sx, sz, pTrim], [-1, mHex, -sx, -sz, mTrim]]) {
          const [kr, kg, kb] = rgb(ts && ts.trim !== undefined ? ts.trim : tone(hex, 0.68));
          quad(chunk, A(s * sk, ys), B(s * sk, ys), B(s * sk, ys + SKIRT_H), A(s * sk, ys + SKIRT_H), nx, 0, nz, kr, kg, kb, null, h);
          if (y1 - y0 > TOP_BAND + SKIRT_H + 0.5) {
            const [lr, lg, lb] = rgb(tone(hex, 1, 0xfff8ec, 0.35));
            quad(chunk, A(s * tb, y1 - TOP_BAND), B(s * tb, y1 - TOP_BAND), B(s * tb, y1), A(s * tb, y1), nx, 0, nz, lr, lg, lb, null, h);
          }
        }
        const pn = meta.panel >= 0 ? plan.panels[meta.panel] : null;
        if (pn) chunk.panelRanges.push(pn, i0, chunk.buf.idx.length - i0);
      } else {
        // lintel underside
        quad(chunk, A(-1, y0), B(-1, y0), B(1, y0), A(1, y0), 0, -1, 0, mr, mg, mb, null, h);
      }
    }
  }
  addStairGeometry(chunk,shell,h,api);
  const lit = { ...api, floorAt: floorLookup(plan, styles) };
  addLightGeometry(chunk,shell,h,lit);
  addFurnishingGeometry(chunk,shell,h,lit);
}
