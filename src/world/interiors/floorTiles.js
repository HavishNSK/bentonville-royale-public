// BENTONVILLE ROYALE — breakable floor tiles between storeys (pure, deterministic; see Interiors.js).
//
// The slab between two storeys (the floor of level i > 0, which is also the ceiling of level
// i - 1) is split into breakable tiles. Each tile is a panel (kind 'floor') appended to
// plan.panels, so damage, breaking, match reset and multiplayer events reuse the wall-panel
// path (World.breakPanel, Combat.damagePanel, HostSession 'wd' / 'wx'). A broken tile is an
// opening exactly like a stairwell hole (World._slabOpen): you fall through it, see and shoot
// through it, and can climb up through it (jump / mantle off a built piece below).
//
// Per upper-level room, the room rect inset by RIM is cut into an even grid of tiles at most
// TILE m (SMALL_TILE in small rooms) on a side. A tile is only breakable when it is wholly inside the building and clear of
// everything that would be left floating or would lose its support: stair holes, furniture on
// that floor, ceiling lights hung under it (and their floor pools), and loot spots. The RIM
// keeps partitions, doorways, thresholds and the edge shading on solid floor.
//
// level.tiles = [{ room, a0, b0, a1, b1, na, nb, ids }]  one grid per room (local frame);
//   ids[i * nb + j] = panel id of tile (i, j) or -1 when that cell stays solid.
// panel (kind 'floor') = { id, kind, level, room, a0, b0, a1, b1, y0, y1, mat, hp, maxHp, alive, x, z }
//   a0..b1 local tile rect; y0 / y1 = slab underside / top (absolute); x, z = centre (world).

import { BUILDING_WALL } from '../../core/config.js';
import { q, inPoly, toLocal, toWorld } from './layout.js';
import { FLOOR_THICKNESS } from './storeys.js';

export const TILE = 4; // max tile side (m)
export const SMALL_TILE = 2; // max tile side in rooms under SMALL_ROOM m^2 (homes, offices)
const SMALL_ROOM = 80;
export const RIM = 0.5; // solid band kept along every room edge (m)
const HOLE_MARGIN = 0.3;
const LOOT_MARGIN = 0.8;

const overlaps = (A, a0, b0, a1, b1, m = 0) => A.a0 - m < a1 && A.a1 + m > a0 && A.b0 - m < b1 && A.b1 + m > b0;

/** Returns the plan with floor-tile panels appended and level.tiles set on every upper level. */
export function addFloorTiles(plan, shell) {
  if (!plan || !plan.levels || plan.levels.length < 2) return plan;
  const F = plan.frame;
  const poly = [];
  for (let i = 0; i < shell.inner.length; i += 2) poly.push(...toLocal(F, shell.inner[i], shell.inner[i + 1]));
  const hp = BUILDING_WALL.floorHp;
  const panels = [...plan.panels];
  const loot = (plan.lootSpots || []).map((s) => {
    const [a, b] = toLocal(F, s.x, s.z);
    return { level: s.level, a0: a, b0: b, a1: a, b1: b };
  });
  let hash = plan.hash;
  const mix = (v) => { hash = Math.imul(hash ^ (Math.round(v * 64) | 0), 0x01000193) >>> 0; };
  const levels = plan.levels.map((L) => {
    if (L.i === 0) return L;
    // things that must keep solid floor under / over them on this slab
    const keep = [];
    for (const p of plan.furniture || []) if (p.level === L.i) keep.push([p, 0]);
    // a light hangs under this slab (level below) and pools on this floor (same level)
    for (const l of plan.lights || []) if (l.level === L.i - 1 || l.level === L.i) keep.push([l, 0]);
    for (const s of loot) if (s.level === L.i) keep.push([s, LOOT_MARGIN]);
    for (const h of L.holes || []) keep.push([h, HOLE_MARGIN]);
    const tiles = [];
    for (const r of L.rooms) {
      const a0 = q(r.a0 + RIM), b0 = q(r.b0 + RIM), a1 = q(r.a1 - RIM), b1 = q(r.b1 - RIM);
      if (a1 - a0 < 1 || b1 - b0 < 1) continue;
      const side = (r.a1 - r.a0) * (r.b1 - r.b0) < SMALL_ROOM ? SMALL_TILE : TILE;
      const na = Math.ceil((a1 - a0) / side), nb = Math.ceil((b1 - b0) / side);
      const ids = new Int32Array(na * nb).fill(-1);
      let any = false;
      for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
        const ta0 = q(a0 + ((a1 - a0) * i) / na), ta1 = q(a0 + ((a1 - a0) * (i + 1)) / na);
        const tb0 = q(b0 + ((b1 - b0) * j) / nb), tb1 = q(b0 + ((b1 - b0) * (j + 1)) / nb);
        // wholly inside the building (corners, edge midpoints and centre: catches concave notches)
        const ma = (ta0 + ta1) / 2, mb = (tb0 + tb1) / 2;
        const pts = [[ta0, tb0], [ta1, tb0], [ta0, tb1], [ta1, tb1], [ma, tb0], [ma, tb1], [ta0, mb], [ta1, mb], [ma, mb]];
        if (!pts.every(([a, b]) => inPoly(poly, a, b))) continue;
        if (keep.some(([k, m]) => overlaps(k, ta0, tb0, ta1, tb1, m))) continue;
        const [x, z] = toWorld(F, ma, mb);
        const id = panels.length;
        panels.push({ id, kind: 'floor', level: L.i, room: r.id, a0: ta0, b0: tb0, a1: ta1, b1: tb1,
          y0: q(L.y - FLOOR_THICKNESS), y1: L.y, mat: 'wood', hp, maxHp: hp, alive: true, x, z });
        ids[i * nb + j] = id;
        any = true;
        for (const v of [L.i, ta0, tb0, ta1, tb1]) mix(v);
      }
      if (any) tiles.push({ room: r.id, a0, b0, a1, b1, na, nb, ids });
    }
    return { ...L, tiles };
  });
  return { ...plan, levels, panels, hash };
}

/** The floor-tile panel id of level L under plan-local point (a, b), or -1. */
export function tileIdAt(L, a, b) {
  const T = L.tiles;
  if (!T) return -1;
  for (let k = 0; k < T.length; k++) {
    const g = T[k];
    if (a < g.a0 || a >= g.a1 || b < g.b0 || b >= g.b1) continue;
    let i = Math.min(g.na - 1, Math.floor(((a - g.a0) / (g.a1 - g.a0)) * g.na));
    let j = Math.min(g.nb - 1, Math.floor(((b - g.b0) / (g.b1 - g.b0)) * g.nb));
    // tile edges are rounded (q) when the tiles are laid out: use the same edges here, so a
    // point just beside a seam picks the tile it is really over
    const ea = (n) => q(g.a0 + ((g.a1 - g.a0) * n) / g.na);
    const eb = (n) => q(g.b0 + ((g.b1 - g.b0) * n) / g.nb);
    if (i > 0 && a < ea(i)) i--;
    else if (i < g.na - 1 && a >= ea(i + 1)) i++;
    if (j > 0 && b < eb(j)) j--;
    else if (j < g.nb - 1 && b >= eb(j + 1)) j++;
    return g.ids[i * g.nb + j];
  }
  return -1;
}
