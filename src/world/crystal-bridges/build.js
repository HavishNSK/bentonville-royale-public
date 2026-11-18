// BENTONVILLE ROYALE — Crystal Bridges: turn the site plan (site.js) into colliders and a list of
// renderable parts. No three.js here (meshes.js draws the parts), so it runs in Node tests.
//
//   const out = buildSite(world, mapData)
//     -> { ponds, parts, glass, props, hangLines, loot, decks, signs, entrances, stats }
//
// Every architecture box is registered with world.addBox in a fixed order (same ids on every
// client). Kinds / materials:
//   kind 'museum'  walls, slabs, roofs, stairs: unbreakable, harvestable for stone or wood
//                  (hp 1e9: Combat treats it as harvestable but it never falls)
//   kind 'glass'   floor-to-ceiling panes: breakable (shoot or swing them out), no mats
//   kind 'prop'    benches, tables, shelves, display cases: breakable + harvestable (wood)

import { LEVEL, PAVILIONS, PADS, SLABS, DECKS, WALKER_LANDING, RESERVE, pondsFrom, bakeTerrain, bowMargin } from './site.js';
import { ENTRANCES, createSiteNav, navClearance } from './nav.js';
import { attachSiteDoors } from './doors.js';
import { STATUES, STATUE_MODELS, plinthHalf } from './statues.js';

export const WALL_T = 0.4; // concrete wall thickness
const GLASS_T = 0.14;
const ROOF_T = 0.45;
const SLAB_T = 0.6;
const DOOR_H = 3.0;
const PANE_W = 2.6; // glass module (the "two paces" bay rhythm of the audio tour)
const STEP_RISE = 0.4; // stair step (World step height is 0.62)
const MUSEUM_HP = 1e9; // indestructible landmark, still harvestable
export const GLASS_HP = 70;
const PROP_HP = 120;
export const ROOF_HP = 300; // a roof tile: ~10 rifle rounds, 6 pickaxe swings, one grenade
const ROOF_GLASS_HP = 140; // the Garrison Lobby's glass dome
const ROOF_TILE = 4; // m: roof tile size on a flat axis
const ROOF_TILE_CURVED = 2; // m: along an axis where the roof curves (keeps tiles thin)

/**
 * Roof tile grid lines of pavilion pv: { xs, zs } from its (bowed) footprint edge to edge. The
 * collider tiles (build.js) and the drawn roof (meshes.js) share it, so a broken tile's hole in
 * the mesh matches the hole in the collision.
 */
export function roofTileLines(pv) {
  const varies = roofVaries(pv);
  const lines = (a, b, curved) => {
    const n = Math.max(1, Math.ceil((b - a) / (curved ? ROOF_TILE_CURVED : ROOF_TILE)));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  return {
    xs: lines(pv.x0 - bowMargin(pv, 'w'), pv.x1 + bowMargin(pv, 'e'), varies.x),
    zs: lines(pv.z0 - bowMargin(pv, 'n'), pv.z1 + bowMargin(pv, 's'), varies.z),
  };
}

/**
 * Sides of pv that butt against another pavilion: { n, s, w, e } booleans. meshes.js draws no
 * eave or fascia there, or the lower roof's overhang pokes through the taller room's joint wall
 * (the green strip seen from inside the Great Hall over the South Lobby).
 */
export function roofNeighborSides(pv) {
  const eps = 0.8;
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.8;
  const out = { n: false, s: false, w: false, e: false };
  for (const o of PAVILIONS) {
    if (o.id === pv.id) continue;
    if (Math.abs(o.z1 - pv.z0) < eps && ov(pv.x0, pv.x1, o.x0, o.x1)) out.n = true;
    if (Math.abs(o.z0 - pv.z1) < eps && ov(pv.x0, pv.x1, o.x0, o.x1)) out.s = true;
    if (Math.abs(o.x1 - pv.x0) < eps && ov(pv.z0, pv.z1, o.z0, o.z1)) out.w = true;
    if (Math.abs(o.x0 - pv.x1) < eps && ov(pv.z0, pv.z1, o.z0, o.z1)) out.e = true;
  }
  return out;
}

/** Roof underside (interior ceiling) of pavilion pv at (x, z). */
export function roofUnder(pv, x, z, unclamped = false) {
  const ceil = pv.floor + pv.height;
  const r = pv.roof || {};
  const rise = r.rise || 0;
  const u = (x - pv.x0) / (pv.x1 - pv.x0);
  const v = (z - pv.z0) / (pv.z1 - pv.z0);
  const cu = unclamped ? u : Math.min(1, Math.max(0, u));
  const cv = unclamped ? v : Math.min(1, Math.max(0, v));
  switch (r.type) {
    case 'convex': {
      // the bridges' cable-hung copper roofs: a hull that arches ACROSS the span (short axis),
      // easing down a little toward both ends (aerial photos, crystalbridges.org/architecture)
      const across = r.along === 'z' ? cu : cv;
      const along = r.along === 'z' ? cv : cu;
      const a = 1 - (2 * across - 1) ** 2;
      const b = 1 - (2 * Math.min(1, Math.max(0, along)) - 1) ** 2;
      return ceil + rise * a * (0.72 + 0.28 * b);
    }
    case 'vault':
      return ceil + rise * (1 - (2 * cv - 1) ** 2);
    case 'dome': {
      const d = (2 * cu - 1) ** 2 + (2 * cv - 1) ** 2;
      return ceil + rise * Math.max(0, 1 - d);
    }
    case 'concave': {
      // v from the high (ravine) side to the low (pond) side; curves down like the hillside
      const t = r.high === 'w' ? cu : r.high === 'e' ? 1 - cu : r.high === 'n' ? cv : 1 - cv;
      return ceil + rise * (1 - t) ** 2;
    }
    case 'sawtooth': {
      const tooth = 6;
      const f = (((z - pv.z0) % tooth) + tooth) % tooth / tooth;
      return ceil + rise * f;
    }
    default:
      return ceil;
  }
}

/** Highest roof underside on the segment (so walls meet a bowed / sloped soffit). */
function roofCapAlong(pv, ax, az, bx, bz, steps = 4) {
  let y = -Infinity;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    y = Math.max(y, roofUnder(pv, ax + (bx - ax) * t, az + (bz - az) * t));
  }
  return y;
}

/** Does the roof profile vary along x / z? (decides how finely walls and roof slabs are cut). */
function roofVaries(pv) {
  const r = pv.roof || {};
  const t = r.type;
  return {
    x: t === 'convex' || t === 'dome' || (t === 'concave' && (r.high === 'e' || r.high === 'w')),
    z: t === 'convex' || t === 'vault' || t === 'dome' || t === 'sawtooth' || (t === 'concave' && (r.high === 'n' || r.high === 's')),
  };
}

/** Full span list of one side (unlisted stretches become 'wall'), sorted along the side. */
export function sideSpans(pv, side) {
  const lo = side === 'n' || side === 's' ? pv.x0 : pv.z0;
  const hi = side === 'n' || side === 's' ? pv.x1 : pv.z1;
  const listed = ((pv.sides && pv.sides[side]) || []).filter((s) => s.b > s.a).slice().sort((p, q) => p.a - q.a);
  const out = [];
  let at = lo;
  for (const s of listed) {
    const a = Math.max(lo, s.a);
    const b = Math.min(hi, s.b);
    if (b <= a) continue;
    if (a > at + 1e-6) out.push({ t: 'wall', a: at, b: a });
    out.push({ ...s, a, b });
    at = b;
  }
  if (hi > at + 1e-6) out.push({ t: 'wall', a: at, b: hi });
  return out;
}

/**
 * Point on side `side` at coordinate u (x for n/s, z for w/e): the wall centre line, inset by
 * half a wall and bowed outward by the side's sagitta. Returns [x, z].
 */
export function sidePoint(pv, side, u) {
  const sag = bowMargin(pv, side);
  const ns = side === 'n' || side === 's';
  const lo = ns ? pv.x0 : pv.z0;
  const hi = ns ? pv.x1 : pv.z1;
  const s = (2 * (u - lo)) / (hi - lo) - 1;
  const bow = sag * (1 - s * s);
  const inset = WALL_T / 2;
  if (side === 'n') return [u, pv.z0 + inset - bow];
  if (side === 's') return [u, pv.z1 - inset + bow];
  if (side === 'w') return [pv.x0 + inset - bow, u];
  return [pv.x1 - inset + bow, u];
}

/** Inward unit normal of a side. */
export function sideNormal(side) {
  return side === 'n' ? [0, 1] : side === 's' ? [0, -1] : side === 'w' ? [1, 0] : [-1, 0];
}

/**
 * Register everything. world: a World (addBox / addDeck / setTerrain / reserve / fixedLoot).
 * Returns the parts list for meshes.js and metadata for the gallery and gameplay layers.
 */
export function buildSite(world, mapData) {
  const ponds = pondsFrom(mapData);
  const terrain = bakeTerrain(ponds);
  // over the map's USGS terrain the ravine is an overlay (the hills ease down to street level
  // around the tile); without map terrain it is the whole heightfield
  if (world.terrain && world.setTerrainOverlay) world.setTerrainOverlay(terrain.meta, terrain.heights, { blend: 60, edge: 0 });
  else if (world.setTerrain) world.setTerrain(terrain.meta, terrain.heights);
  if (world.reserve) world.reserve(RESERVE);
  for (const pd of ponds) if (world.addArea) world.addArea(pd.p, 'water');

  const parts = []; // { mat, cx, cz, hx, hz, yaw, y0, y1, collider, role }
  const glass = []; // glass pane parts (breakable, instanced)
  const props = []; // furniture parts (breakable, instanced per type)
  const hangLines = []; // wall stretches paintings can hang on
  const loot = [];
  const signs = []; // painted boards (entrance signs, the café menu): { cx, cz, y0, y1, hx, yaw, text, sub, style }
  const isEntrance = (pv, side, sp) => ENTRANCES.some((e) => e.pv === pv.id && e.side === side && Math.abs(e.a - sp.a) < 0.01 && Math.abs(e.b - sp.b) < 0.01);
  const stats = { boxes: 0, glass: 0, props: 0 };

  const box = (o, role = 'arch') => {
    const hx = Math.max(0.02, o.hx);
    const hz = Math.max(0.02, o.hz);
    if (!(o.y1 > o.y0 + 0.01)) return null;
    const isGlass = role === 'glass';
    const isProp = role === 'prop';
    const isFrame = !!(o.frame || o.mullion);
    const c = world.addBox({
      cx: o.cx, cz: o.cz, hx, hz, yaw: o.yaw || 0, y0: o.y0, y1: o.y1,
      kind: isGlass ? 'glass' : isProp ? 'prop' : 'museum',
      mat: isGlass ? 'glass' : o.mat === 'wood' || o.mat === 'oak' || isProp ? 'wood' : o.mat === 'steel' || o.mat === 'copper' || o.mat === 'metal' ? 'metal' : 'brick',
      hp: isGlass || isFrame ? GLASS_HP : isProp ? PROP_HP : MUSEUM_HP,
      ref: isGlass || isFrame ? null : [],
      passable: !!o.visOnly,
    });
    if (isGlass || isFrame) c.breakable = true;
    if (isFrame) c.frame = true;
    if (o.floorOf) c.walkable = true; // a floor: World.blockedAt (A*, spawn checks) treats it as open ground
    const part = { ...o, hx, hz, collider: c, role };
    c.part = part;
    stats.boxes++;
    if (isGlass) {
      glass.push(part);
      stats.glass++;
    } else if (isProp) {
      props.push(part);
      stats.props++;
    } else parts.push(part);
    return part;
  };
  const rect = (x0, x1, z0, z1, y0, y1, mat, role, extra) =>
    box({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, y0, y1, mat, ...(extra || {}) }, role);
  /** Box along a segment from (ax, az) to (bx, bz), thickness t (centre line), y0..y1. */
  const seg = (ax, az, bx, bz, t, y0, y1, mat, role, extra) => {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return null;
    return box({ cx: (ax + bx) / 2, cz: (az + bz) / 2, hx: len / 2, hz: t / 2, yaw: Math.atan2(dz, dx), y0, y1, mat, ...(extra || {}) }, role);
  };
  const minTerrain = (x0, x1, z0, z1) => {
    let m = Infinity;
    for (let x = x0; x <= x1 + 1e-6; x += Math.max(1, (x1 - x0) / 8)) {
      for (let z = z0; z <= z1 + 1e-6; z += Math.max(1, (z1 - z0) / 8)) m = Math.min(m, world.terrainHeight ? world.terrainHeight(x, z) : 0);
    }
    return m;
  };
  const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > 0.8;
  /** True when another pavilion sits on this edge, so the span is circulation rather than a window. */
  const edgeHasNeighbor = (pv, side, a, b) => {
    const eps = 0.8;
    for (const other of PAVILIONS) {
      if (other.id === pv.id) continue;
      if (side === 'n' && Math.abs(other.z1 - pv.z0) < eps && overlap(a, b, other.x0, other.x1)) return true;
      if (side === 's' && Math.abs(other.z0 - pv.z1) < eps && overlap(a, b, other.x0, other.x1)) return true;
      if (side === 'w' && Math.abs(other.x1 - pv.x0) < eps && overlap(a, b, other.z0, other.z1)) return true;
      if (side === 'e' && Math.abs(other.x0 - pv.x1) < eps && overlap(a, b, other.z0, other.z1)) return true;
    }
    return false;
  };
  /** The pavilion across side `side` of pv at position u along that side, or null. */
  const neighborAt = (pv, side, u) => {
    const eps = 0.8;
    for (const o of PAVILIONS) {
      if (o.id === pv.id) continue;
      if (side === 'n' && Math.abs(o.z1 - pv.z0) < eps && u > o.x0 && u < o.x1) return o;
      if (side === 's' && Math.abs(o.z0 - pv.z1) < eps && u > o.x0 && u < o.x1) return o;
      if (side === 'w' && Math.abs(o.x1 - pv.x0) < eps && u > o.z0 && u < o.z1) return o;
      if (side === 'e' && Math.abs(o.x0 - pv.x1) < eps && u > o.z0 && u < o.z1) return o;
    }
    return null;
  };
  /**
   * An open span onto a neighbouring pavilion: the opening is only as tall as BOTH rooms. Above a
   * lower neighbour's ceiling, close the gap up to this roof, or the sky shows over the
   * neighbour's roof. Only the taller room builds it, so each joint is closed exactly once.
   */
  const transferWalls = (pv, side, sp) => {
    const len = sp.b - sp.a;
    const pieces = Math.max(1, Math.ceil(len / 1.2));
    for (let i = 0; i < pieces; i++) {
      const ua = sp.a + (len * i) / pieces;
      const ub = sp.a + (len * (i + 1)) / pieces;
      const nb = neighborAt(pv, side, (ua + ub) / 2);
      if (!nb) continue;
      const [ax, az] = sidePoint(pv, side, ua);
      const [bx, bz] = sidePoint(pv, side, ub);
      const top = roofCapAlong(pv, ax, az, bx, bz);
      let nbCeil = Infinity;
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        nbCeil = Math.min(nbCeil, roofUnder(nb, ax + (bx - ax) * t, az + (bz - az) * t));
      }
      const tag = { wall: true, transfer: true, pv: pv.id, side, nb: nb.id };
      if (top > nbCeil + 0.05) seg(ax, az, bx, bz, WALL_T, nbCeil - 0.05, top, 'concrete', 'arch', tag);
      // (no step face below a higher neighbour's floor: its solid floor plinth already closes it,
      // and a wall there would cut a stair that crosses the joint)
    }
  };
  const glaze = (pv, side, sp, y0, y1, visOnly) => {
    const len = sp.b - sp.a;
    const n = Math.max(1, Math.round(len / PANE_W));
    for (let i = 0; i < n; i++) {
      const ua = sp.a + (len * i) / n;
      const ub = sp.a + (len * (i + 1)) / n;
      const [ax, az] = sidePoint(pv, side, ua);
      const [bx, bz] = sidePoint(pv, side, ub);
      const top = Math.min(y1, roofCapAlong(pv, ax, az, bx, bz));
      const pane = seg(ax, az, bx, bz, GLASS_T, y0, top, 'glass', 'glass', { pv: pv.id, side, lean: !!pv.leanGlass, visOnly: !!visOnly });
      if (pane && pane.collider) pane.collider.pane = pane;
      if (!visOnly) {
        for (const [mx, mz] of i === 0 ? [[ax, az], [bx, bz]] : [[bx, bz]]) {
          rect(mx - 0.08, mx + 0.08, mz - 0.08, mz + 0.08, y0, roofUnder(pv, mx, mz), 'mullion', 'arch', { mullion: true });
        }
        // window frame: a sill rail, a head rail and (in tall bays) a transom, so a pane reads as a
        // framed window rather than a floating sheet. Visual only (the pane collider is the barrier).
        const rail = (ya, yb) => seg(ax, az, bx, bz, GLASS_T + 0.1, ya, yb, 'mullion', 'arch', { visOnly: true, frame: true });
        rail(y0, y0 + 0.12);
        if (!pv.leanGlass) {
          rail(top - 0.1, top);
          if (top - y0 > 4.2) rail(y0 + 2.9, y0 + 2.98);
        }
      }
    }
  };

  for (const pv of PAVILIONS) {
    const varies = roofVaries(pv);
    const bx0 = pv.x0 - bowMargin(pv, 'w');
    const bx1 = pv.x1 + bowMargin(pv, 'e');
    const bz0 = pv.z0 - bowMargin(pv, 'n');
    const bz1 = pv.z1 + bowMargin(pv, 's');

    // ---- floor slab (a solid plinth down to the ground; bridges / upper rooms: a thin slab)
    if (pv.noSlab) {
      // Library sits over the Great Hall Corridor: a thin oak deck, not a plinth through the hall.
      const deck = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
      for (const r of subtractRects(deck, pv.floorHoles || [])) {
        rect(r.x0, r.x1, r.z0, r.z1, pv.floor - 0.12, pv.floor, pv.floorMat, 'arch', { floorOf: pv.id });
      }
    } else if (pv.bridge) {
        rect(bx0, bx1, bz0, bz1, pv.floor - SLAB_T, pv.floor, pv.floorMat, 'arch', { floorOf: pv.id });
        const bed = minTerrain(pv.x0, pv.x1, pv.z0, pv.z1) - 0.2;
        const long = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
        for (const f of [0.3, 0.7]) {
          if (long) {
            const x = pv.x0 + (pv.x1 - pv.x0) * f;
            rect(x - 0.9, x + 0.9, pv.z0 + 1.5, pv.z1 - 1.5, bed, pv.floor - SLAB_T, 'concrete', 'arch', { pier: true });
          } else {
            const z = pv.z0 + (pv.z1 - pv.z0) * f;
            rect(pv.x0 + 1.5, pv.x1 - 1.5, z - 0.9, z + 0.9, bed, pv.floor - SLAB_T, 'concrete', 'arch', { pier: true });
          }
        }
    } else {
      const base = Math.min(pv.floor - SLAB_T, minTerrain(bx0, bx1, bz0, bz1) - 0.3);
      rect(bx0, bx1, bz0, bz1, base, pv.floor, pv.floorMat, 'arch', { floorOf: pv.id });
    }

    // ---- walls, glass, doors
    for (const side of ['n', 's', 'w', 'e']) {
      const ns = side === 'n' || side === 's';
      const bowed = bowMargin(pv, side) > 0;
      const along = ns ? varies.x : varies.z;
      for (const sp of sideSpans(pv, side)) {
        if (sp.t === 'open') {
          if (!edgeHasNeighbor(pv, side, sp.a, sp.b)) glaze(pv, side, sp, pv.floor, Infinity, true);
          else transferWalls(pv, side, sp);
          continue;
        }
        const len = sp.b - sp.a;
        if (sp.t === 'glass') {
          glaze(pv, side, sp, pv.floor, Infinity, false);
          continue;
        }
        // a whole wall span is one hang line (paintings follow the bow via sidePoint)
        if (sp.t === 'wall' && pv.wing && len > 3) {
          let top = Infinity;
          for (let k = 0; k <= 8; k++) {
            const [qx, qz] = sidePoint(pv, side, sp.a + (len * k) / 8);
            top = Math.min(top, roofUnder(pv, qx, qz));
          }
          hangLines.push({ type: 'side', pv: pv.id, wing: pv.wing, side, a: sp.a, b: sp.b, floor: pv.floor, top });
        }
        // wall / door: cut into ~1.2 m pieces when the wall bows or the roof varies along it
        const pieces = bowed || along ? Math.max(1, Math.ceil(len / 1.2)) : 1;
        for (let i = 0; i < pieces; i++) {
          const ua = sp.a + (len * i) / pieces;
          const ub = sp.a + (len * (i + 1)) / pieces;
          const [ax, az] = sidePoint(pv, side, ua);
          const [bx, bz] = sidePoint(pv, side, ub);
          // extend wall pieces by half a wall at the side's ends so corners close
          let [ex0, ez0, ex1, ez1] = [ax, az, bx, bz];
          if (sp.t === 'wall') {
            const l = Math.hypot(bx - ax, bz - az) || 1;
            const ux = (bx - ax) / l;
            const uz = (bz - az) / l;
            const lo = ns ? pv.x0 : pv.z0;
            const hi = ns ? pv.x1 : pv.z1;
            if (Math.abs(ua - lo) < 1e-6) {
              ex0 -= ux * (WALL_T / 2);
              ez0 -= uz * (WALL_T / 2);
            }
            if (Math.abs(ub - hi) < 1e-6) {
              ex1 += ux * (WALL_T / 2);
              ez1 += uz * (WALL_T / 2);
            }
          }
          const top = roofCapAlong(pv, ax, az, bx, bz);
          const mat = 'concrete';
          if (sp.t === 'wall') {
            seg(ex0, ez0, ex1, ez1, WALL_T, pv.floor - 0.02, top, mat, 'arch', { wall: true, pv: pv.id, side });
          } else if (sp.t === 'door') {
            const sill = sp.sill !== undefined ? sp.sill : pv.floor;
            if (i === 0) threshold(pv, side, sp, sill);
            const head = Math.min(top, sill + (sp.head || DOOR_H));
            if (sill > pv.floor + 0.05) seg(ex0, ez0, ex1, ez1, WALL_T, pv.floor - 0.02, sill, mat, 'arch', { wall: true, pv: pv.id, side });
            if (top > head + 0.05) seg(ex0, ez0, ex1, ez1, WALL_T, head, top, mat, 'arch', { wall: true, lintel: true, pv: pv.id, side });
            if (i === 0 && isEntrance(pv, side, sp)) entrance(pv, side, sp, sill, head);
            else if (i === 0 && !edgeHasNeighbor(pv, side, sp.a, sp.b)) glaze(pv, side, sp, sill, head, true);
          }
        }
      }
    }

    // ---- roof: breakable tiles on the shared grid (roofTileLines; holes cut out of flat roofs).
    // A tile spans its lowest to its highest underside (+ the slab), so tiles on a curved or
    // stepped roof overlap their neighbours: no slit between two heights for a shot or a glance
    // to pass through.
    const { xs, zs } = roofTileLines(pv);
    const holes = (pv.roof && pv.roof.holes) || [];
    const tileHp = pv.roof.mat === 'glass' ? ROOF_GLASS_HP : ROOF_HP;
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let k = 0; k + 1 < zs.length; k++) {
        const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[k], zs[k + 1]];
        let lo = Infinity;
        let hi = -Infinity;
        // 5 x 5 samples, edges included: neighbours share their edge samples, so their height
        // ranges always meet (curved hulls, the dome and the sawtooth's drops included)
        for (let a = 0; a <= 4; a++) {
          for (let b = 0; b <= 4; b++) {
            const y = roofUnder(pv, x0 + ((x1 - x0) * a) / 4, z0 + ((z1 - z0) * b) / 4);
            lo = Math.min(lo, y);
            hi = Math.max(hi, y);
          }
        }
        for (const r of subtractRects({ x0, x1, z0, z1 }, holes)) {
          // 2 cm overlap with the neighbours: a seam is never a hole (for shots or ceilingAbove)
          const part = rect(r.x0 - 0.02, r.x1 + 0.02, r.z0 - 0.02, r.z1 + 0.02, lo, hi + ROOF_T, pv.roof.mat, 'arch', { roofOf: pv.id, roofTile: true });
          if (!part) continue;
          const c = part.collider;
          c.breakable = true; // bullets, the pickaxe and explosives break it (no materials)
          c.hp = c.maxHp = tileHp;
          c.ref = null;
          if (pv.roof.mat === 'glass') c.mat = 'glass';
        }
      }
    }

    // ---- berms: the heightfield is clamped below the floor for one grid cell around every
    // pavilion (so terrain never pokes through a floor), which leaves a trench along walls that
    // face higher ground. Fill it with a grass berm against each solid exterior wall, level with
    // the ground beyond, so there is no moat to fall into beside the entrance paths.
    if (!pv.noSlab && !pv.bridge) {
      for (const side of ['n', 's', 'w', 'e']) {
        if (bowMargin(pv, side) > 0) continue;
        const [inx, inz] = sideNormal(side);
        for (const sp of sideSpans(pv, side)) {
          if (sp.t !== 'wall') continue;
          const len = sp.b - sp.a;
          const pieces = Math.max(1, Math.ceil(len / 2));
          for (let i = 0; i < pieces; i++) {
            const ua = sp.a + (len * i) / pieces;
            const ub = sp.a + (len * (i + 1)) / pieces;
            if (neighborAt(pv, side, (ua + ub) / 2)) continue; // a neighbouring pavilion, not ground
            const [ax, az] = sidePoint(pv, side, ua);
            const [bx, bz] = sidePoint(pv, side, ub);
            const mx = (ax + bx) / 2;
            const mz = (az + bz) / 2;
            // the ground past the clamped cell, and none of a pad (the paths are already level)
            const out = (d) => [mx - inx * d, mz - inz * d];
            const [fx, fz] = out(4.6);
            const beyond = Math.min(world.terrainHeight(fx, fz), world.terrainHeight(...out(3.6)));
            const [cx, cz] = out(WALL_T / 2 + 1.25);
            if (PADS.some((pd) => cx > pd.x0 - 1.3 && cx < pd.x1 + 1.3 && cz > pd.z0 - 1.3 && cz < pd.z1 + 1.3)) continue;
            if (PAVILIONS.some((o) => o !== pv && cx > o.x0 - 0.5 && cx < o.x1 + 0.5 && cz > o.z0 - 0.5 && cz < o.z1 + 0.5)) continue;
            // up to the ground beyond, but under the tallest wall on this edge (the library stands on the corridor)
            const stack = PAVILIONS.filter((o) => mx >= o.x0 - 0.05 && mx <= o.x1 + 0.05 && mz >= o.z0 - 0.05 && mz <= o.z1 + 0.05);
            const top = Math.min(beyond - 0.05, Math.max(...stack.map((o) => roofCapAlong(o, ax, az, bx, bz))) - 0.3);
            if (!(top > pv.floor + 0.6)) continue;
            const ns = side === 'n' || side === 's';
            const half = Math.abs(ub - ua) / 2 + 0.02;
            box({ cx, cz, hx: ns ? half : 1.25, hz: ns ? 1.25 : half, y0: pv.floor - 0.5, y1: top, mat: 'green', berm: true, pv: pv.id, side }, 'arch');
          }
        }
      }
    }

    // ---- free-standing partitions (the bridge's "box galleries"): hang on both faces
    for (const pt of pv.partitions || []) {
      // along x ({ x0, x1, z }) or along z ({ z0, z1, x })
      const h = pt.h || 3.8;
      const alongX = pt.z !== undefined;
      const [ax, az, bx, bz] = alongX ? [pt.x0, pt.z, pt.x1, pt.z] : [pt.x, pt.z0, pt.x, pt.z1];
      seg(ax, az, bx, bz, 0.3, pv.floor - 0.02, pv.floor + h, 'concrete', 'arch', { wall: true, pv: pv.id, partition: true });
      for (const sgn of [-1, 1]) {
        const nx = alongX ? 0 : sgn;
        const nz = alongX ? sgn : 0;
        const ux = alongX ? 0.6 : 0;
        const uz = alongX ? 0 : 0.6;
        hangLines.push({ type: 'line', pv: pv.id, wing: pv.wing, ax: ax + ux + nx * 0.15, az: az + uz + nz * 0.15, bx: bx - ux + nx * 0.15, bz: bz - uz + nz * 0.15, nx, nz, floor: pv.floor, top: pv.floor + h });
      }
    }

    // ---- concrete abutments at the bridges' ends (the cable anchors, standing above the roof)
    if (pv.bridge && pv.roof && pv.roof.type === 'convex') {
      const top = pv.floor + pv.height + (pv.roof.rise || 0) + 1.2;
      const long = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
      const ends = long ? [pv.x0, pv.x1] : [pv.z0, pv.z1];
      for (const e of ends) {
        for (const side of long ? [pv.z0, pv.z1] : [pv.x0, pv.x1]) {
          const out = side === (long ? pv.z0 : pv.x0) ? -1 : 1;
          if (long) rect(e - 1.3, e + 1.3, side + (out < 0 ? -1.6 : 0), side + (out > 0 ? 1.6 : 0), pv.floor - 0.02, top, 'concrete', 'arch', { abutment: true });
          else rect(side + (out < 0 ? -1.6 : 0), side + (out > 0 ? 1.6 : 0), e - 1.3, e + 1.3, pv.floor - 0.02, top, 'concrete', 'arch', { abutment: true });
        }
      }
    }

    // ---- landings and stairs (stairs are solid stepped boxes: walkable up, blocking from the sides)
    for (const L of pv.landings || []) rect(L.x0, L.x1, L.z0, L.z1, pv.floor - 0.02, L.y, 'stone', 'arch', { stair: true });
    for (const R of pv.ramps || []) stairs(R, pv.floor);

    // ---- small enclosed rooms (Infinity Room placeholder)
    for (const rm of pv.rooms || []) {
      const h = 3.4;
      const y0 = pv.floor - 0.02;
      const y1 = pv.floor + h;
      const t = 0.25;
      const doorSide = rm.door;
      const mid = (rm.z0 + rm.z1) / 2;
      for (const [side, ax, az, bx, bz] of [['n', rm.x0, rm.z0, rm.x1, rm.z0], ['s', rm.x0, rm.z1, rm.x1, rm.z1], ['w', rm.x0, rm.z0, rm.x0, rm.z1], ['e', rm.x1, rm.z0, rm.x1, rm.z1]]) {
        if (side === doorSide) {
          seg(ax, az, ax, mid - 0.9, t, y0, y1, 'darkwall', 'arch', { room: rm.id });
          seg(bx, mid + 0.9, bx, bz, t, y0, y1, 'darkwall', 'arch', { room: rm.id });
          seg(ax, mid - 0.9, bx, mid + 0.9, t, pv.floor + 2.4, y1, 'darkwall', 'arch', { room: rm.id, lintel: true });
        } else seg(ax, az, bx, bz, t, y0, y1, 'darkwall', 'arch', { room: rm.id });
      }
      rect(rm.x0, rm.x1, rm.z0, rm.z1, y1, y1 + 0.2, 'darkwall', 'arch', { room: rm.id });
    }
  }

  /**
   * A public entrance (nav.js ENTRANCES): bronze jambs, a copper canopy and a sign. The main
   * colonnade keeps glass leaves parked open (passable). South and library get sliding leaves
   * in the opening that start closed; world.siteDoors toggles them.
   */
  function entrance(pv, side, sp, sill, head) {
    const e = ENTRANCES.find((q) => q.pv === pv.id && q.side === side);
    const [nx, nz] = sideNormal(side); // inward
    const ox = -nx;
    const oz = -nz; // outward
    const face = WALL_T / 2 + 0.06; // just proud of the outer face
    const at = (u, out) => {
      const [x, z] = sidePoint(pv, side, u);
      return [x + ox * out, z + oz * out];
    };
    const half = (sp.b - sp.a) / 2;
    const um = (sp.a + sp.b) / 2;
    const ns = side === 'n' || side === 's';
    const yaw = ns ? 0 : Math.PI / 2;
    // jambs (door frame) on both sides of the opening
    for (const u of [sp.a, sp.b]) {
      const [x, z] = at(u, face);
      box({ cx: x, cz: z, hx: 0.16, hz: 0.16, y0: sill, y1: head + 0.16, mat: 'mullion', visOnly: true, entrance: e.id }, 'arch');
    }
    const [hxm, hzm] = at(um, face);
    box({ cx: hxm, cz: hzm, hx: half + 0.16, hz: 0.12, yaw, y0: head, y1: head + 0.16, mat: 'mullion', visOnly: true, entrance: e.id }, 'arch');
    // glass door leaves: main stays parked open; south / library start closed in the opening
    const operable = e.id !== 'main';
    const leafHx = half / 2 - 0.06;
    const leafHz = 0.08;
    for (const sgn of [-1, 1]) {
      const [cx, cz] = at(um + sgn * (half / 2), face);
      const [ox, oz] = at(um + sgn * (half + half / 2 - 0.05), face + 0.12);
      if (operable) {
        box({
          cx, cz, hx: leafHx, hz: leafHz, yaw, y0: sill + 0.02, y1: head - 0.02, mat: 'doorglass',
          entrance: e.id, doorLeaf: true, leaf: sgn, openCx: ox, openCz: oz,
        }, 'arch');
      } else {
        box({ cx: ox, cz: oz, hx: leafHx, hz: leafHz, yaw, y0: sill + 0.02, y1: head - 0.02, mat: 'doorglass', visOnly: true, entrance: e.id }, 'arch');
      }
    }
    // canopy over the doorway
    const depth = 3.2;
    const [cx, cz] = at(um, face + depth / 2);
    const top = head + 0.42;
    box({ cx, cz, hx: ns ? half + 1.4 : depth / 2, hz: ns ? depth / 2 : half + 1.4, y0: top - 0.24, y1: top, mat: 'copper', visOnly: true, canopy: e.id }, 'arch');
    // sign board on the wall above the canopy (or on the canopy's face when the wall is short)
    const roof = Math.min(roofUnder(pv, ...sidePoint(pv, side, sp.a)), roofUnder(pv, ...sidePoint(pv, side, sp.b)));
    const sy0 = top + 0.12;
    const sy1 = Math.min(top + 1.2, roof - 0.1);
    const [sx, sz] = at(um, face + 0.04);
    if (sy1 - sy0 > 0.5) signs.push({ cx: sx, cz: sz, y0: sy0, y1: sy1, hx: Math.min(half + 1, 4.2), yaw: ns ? 0 : Math.PI / 2, nx: ox, nz: oz, text: e.sign, sub: e.sub, style: 'entrance' });
    else {
      // no wall above the door (the Entrance Hall's crest wall is short): the sign stands on the canopy's front edge
      const [fx, fz] = at(um, face + depth - 0.25);
      signs.push({ cx: fx, cz: fz, y0: top, y1: top + 1.0, hx: Math.min(half + 1, 4.2), yaw: ns ? 0 : Math.PI / 2, nx: ox, nz: oz, text: e.sign, sub: e.sub, style: 'entrance' });
    }
  }

  /**
   * Outdoor threshold landing at an exterior door (sill height, 1.8 m deep): the heightfield's
   * 2 m grid can't hold a crisp step at a carved wall, so the landing makes the doorway flush.
   */
  function threshold(pv, side, sp, sill) {
    const [nx, nz] = sideNormal(side);
    const um = (sp.a + sp.b) / 2;
    const [px, pz] = sidePoint(pv, side, um);
    const ox = px - nx * 1.2;
    const oz = pz - nz * 1.2;
    if (PAVILIONS.some((q) => q !== pv && ox > q.x0 && ox < q.x1 && oz > q.z0 && oz < q.z1)) return; // opens into a neighbour
    const half = (sp.b - sp.a) / 2 + 0.3;
    const depth = 1.8;
    const cx = px - nx * (WALL_T / 2 + depth / 2);
    const cz = pz - nz * (WALL_T / 2 + depth / 2);
    const ns = side === 'n' || side === 's';
    box({ cx, cz, hx: ns ? half : depth / 2, hz: ns ? depth / 2 : half, y0: sill - 4, y1: sill, mat: 'stone', threshold: true }, 'arch');
  }

  function stairs(R, floor) {
    const zAxis = R.x !== undefined;
    const a = zAxis ? R.z0 : R.x0;
    const b = zAxis ? R.z1 : R.x1;
    const n = Math.max(2, Math.ceil(Math.abs(R.y1 - R.y0) / STEP_RISE));
    const base = Math.min(R.y0, R.y1, floor) - 0.02;
    for (let i = 0; i < n; i++) {
      // step i spans [a + (b-a) i/n, a + (b-a)(i+1)/n]; its top steps from y0 toward y1
      const s0 = a + ((b - a) * i) / n;
      const s1 = a + ((b - a) * (i + 1)) / n;
      const top = R.y0 + ((R.y1 - R.y0) * (i + (R.y1 > R.y0 ? 1 : 0))) / n;
      if (top <= base + 0.05) continue;
      if (zAxis) rect(R.x - R.hw, R.x + R.hw, Math.min(s0, s1), Math.max(s0, s1), base, top, 'stone', 'arch', { stair: true });
      else rect(Math.min(s0, s1), Math.max(s0, s1), R.z - R.hw, R.z + R.hw, base, top, 'stone', 'arch', { stair: true });
    }
  }

  // ---- outdoor slabs (weirs, balcony), footbridge decks, Walker Landing tiers
  for (const s of SLABS) {
    rect(s.x0, s.x1, s.z0, s.z1, s.from, s.y, s.mat, 'arch', { slab: s.id });
    if (s.rail) {
      rect(s.x1 - 0.1, s.x1, s.z0, s.z1, s.y, s.y + 1.05, 'mullion', 'arch', { rail: true });
      rect(s.x0, s.x1, s.z0, s.z0 + 0.1, s.y, s.y + 1.05, 'mullion', 'arch', { rail: true });
      rect(s.x0, s.x1, s.z1 - 0.1, s.z1, s.y, s.y + 1.05, 'mullion', 'arch', { rail: true });
    }
  }
  const decks = [];
  for (const d of DECKS) {
    if (world.addDeck) world.addDeck(d.a[0], d.a[1], d.a[2], d.b[0], d.b[1], d.b[2], d.hw);
    decks.push(d);
  }
  const WL = WALKER_LANDING;
  for (let i = 0; i < WL.tiers; i++) {
    const r0 = WL.r0 + i * WL.step;
    const r1 = r0 + WL.step;
    const rm = (r0 + r1) / 2;
    const top = LEVEL.NORTH_POND + (i + 1) * WL.rise;
    const segs = Math.max(4, Math.round(((WL.a1 - WL.a0) * rm) / 3));
    for (let k = 0; k < segs; k++) {
      const a0 = WL.a0 + ((WL.a1 - WL.a0) * k) / segs;
      const a1 = WL.a0 + ((WL.a1 - WL.a0) * (k + 1)) / segs;
      const am = (a0 + a1) / 2;
      const chord = 2 * rm * Math.sin((a1 - a0) / 2) + 0.15;
      box({ cx: WL.cx + Math.cos(am) * rm, cz: WL.cz + Math.sin(am) * rm, hx: chord / 2, hz: WL.step / 2 + 0.02, yaw: am + Math.PI / 2, y0: LEVEL.NORTH_POND - 1, y1: top, mat: 'concrete', tier: i }, 'arch');
    }
  }

  // ---- statues (statues.js): a stone plinth (drawn with the site) and a hidden collider for the
  // figure (meshes.js draws the GLB). Plinths sink 0.5 m so a sloped threshold leaves no gap.
  const statues = [];
  for (const st of STATUES) {
    const model = STATUE_MODELS[st.model];
    if (!model) continue;
    const pvN = PAVILIONS.find((p) => p.id === st.near);
    const hint = pvN ? pvN.floor : world.terrainHeight(st.x, st.z);
    const r = plinthHalf(st);
    let g = -Infinity;
    for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) g = Math.max(g, world.groundHeight(st.x + dx, st.z + dz, hint + 0.5, STEP_RISE + 0.2));
    if (!Number.isFinite(g)) g = hint;
    const top = g + st.plinth;
    if (st.plinth > 0) box({ cx: st.x, cz: st.z, hx: r, hz: r, y0: g - 0.5, y1: top, mat: 'stone', plinth: st.id }, 'arch');
    const fr = model.r * st.s * 0.85;
    box({ cx: st.x, cz: st.z, hx: fr, hz: fr, y0: top, y1: top + model.h * st.s, mat: 'stone', statue: st.id, hidden: true }, 'arch');
    statues.push({ id: st.id, model: st.model, x: st.x, y: top, z: st.z, s: st.s, yaw: Math.atan2(st.face[0], st.face[1]), r, pv: st.near });
  }
  const clearOfStatues = (x, z, r) => statues.every((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) > s.r + r);

  // ---- loot (spots first, so furniture keeps clear of them): ammo boxes and floor items here;
  // most chests sit ON things (benches, tables, counters, a display case) and in odd corners,
  // placed after the furniture below. High-tier chests: the North Tower roof and the weir.
  const tower = PAVILIONS.find((p) => p.id === 'north-tower');
  const at = (id, fx, fz, kind = 'chest', yOff = 0) => {
    const pv = PAVILIONS.find((p) => p.id === id);
    if (!pv) return;
    loot.push({ kind, x: pv.x0 + (pv.x1 - pv.x0) * fx, z: pv.z0 + (pv.z1 - pv.z0) * fz, y: pv.floor + yOff, yaw: 0, pv: id });
  };
  at('contemporary', 0.7, 0.85, 'ammoBox');
  at('eleven', 0.87, 0.08); // the kitchen end, behind the bar
  at('great-hall', 0.5, 0.15, 'ammoBox');
  at('east-wing-2026', 0.12, 0.93); // tucked in the hub's far corner, behind the guardian
  at('bridge-gallery-2026', 0.5, 0.5, 'ammoBox');
  at('store', 0.8, 0.8, 'ammoBox');
  at('south-lobby', 0.2, 0.5, 'ammoBox');
  at('modern-bridge', 0.6, 0.3, 'item');
  at('eleven', 0.3, 0.5, 'item');
  at('corridor', 0.3, 0.3, 'item');
  at('corridor', 0.3, 0.75, 'item');
  at('lobby', 0.5, 0.4, 'item');
  // inside the entrances, so a fight at the door pays off
  at('entry-tower', 0.14, 0.82); // foot of the main-entrance stair
  at('south-lobby', 0.95, 0.85); // behind the coffee bar
  // the hidden ones: tucked behind the Contemporary idol, out on the Contemporary balcony, and at
  // the foot of the Reflection Room dragon (it guards a hoard). Not inside the Infinity Room: a
  // bot's last straight leg from the lane can't turn through its side door.
  const idol = statues.find((s) => s.id === 'contemporary-idol');
  if (idol) loot.push({ kind: 'chest', x: idol.x + idol.r + 0.75, z: idol.z - 1.6, y: LEVEL.LOWER, yaw: Math.PI / 2, pv: 'contemporary' });
  const balcony = SLABS.find((s) => s.id === 'balcony');
  if (balcony) loot.push({ kind: 'chest', x: (balcony.x0 + balcony.x1) / 2, z: (balcony.z0 + balcony.z1) / 2, y: balcony.y, yaw: Math.PI / 2, pv: 'balcony' });
  const hoard = statues.find((s) => s.id === 'reflection-dragon');
  if (hoard) loot.push({ kind: 'chest', x: hoard.x, z: hoard.z + hoard.r + 0.9, y: LEVEL.LOWER, yaw: 0, pv: 'reflection' });
  if (tower) loot.push({ kind: 'chest', tier: 'high', x: (tower.x0 + tower.x1) / 2, z: (tower.z0 + tower.z1) / 2, y: roofUnder(tower, 0, 0) + ROOF_T, yaw: 0, pv: tower.id });
  // under the Eleven bridge, on the weir (the other hard-to-reach high-tier spot)
  loot.push({ kind: 'chest', tier: 'high', x: -14, z: -257, y: LEVEL.SOUTH_POND + 0.05, yaw: 0, pv: 'weir-eleven' });

  // ---- furniture (breakable, harvestable wood)
  const prop = (o) => box({ mat: 'oak', ...o }, 'prop');
  const clearOfLoot = (x, z, r) => loot.every((l) => Math.hypot(l.x - x, l.z - z) > r);
  const partitionNear = (pv, x, z, r) =>
    (pv.partitions || []).some((pt) => (pt.z !== undefined ? Math.abs(z - pt.z) < r && x > pt.x0 - r && x < pt.x1 + r : Math.abs(x - pt.x) < r && z > pt.z0 - r && z < pt.z1 + r)) ||
    (pv.rooms || []).some((rm) => x > rm.x0 - r && x < rm.x1 + r && z > rm.z0 - r && z < rm.z1 + r) ||
    (pv.ramps || []).some((R) =>
      R.x !== undefined
        ? Math.abs(x - R.x) < R.hw + r && z > Math.min(R.z0, R.z1) - r && z < Math.max(R.z0, R.z1) + r
        : Math.abs(z - R.z) < R.hw + r && x > Math.min(R.x0, R.x1) - r && x < Math.max(R.x0, R.x1) + r) ||
    (pv.landings || []).some((Ld) => x > Ld.x0 - r && x < Ld.x1 + r && z > Ld.z0 - r && z < Ld.z1 + r);
  /** Gallery bench (backless, oak): seat 0.46 m. Skipped where it would block a bot lane, a partition or loot. */
  const benchAt = (pv, x, z, yaw) => {
    if (navClearance(x, z) < 1.7 || partitionNear(pv, x, z, 1.6) || !clearOfLoot(x, z, 2) || !clearOfStatues(x, z, 1.4)) return null;
    return prop({ cx: x, cz: z, hx: 1.2, hz: 0.3, yaw, y0: pv.floor, y1: pv.floor + 0.46, type: 'bench', pv: pv.id });
  };
  const NO_BENCH = new Set(['eleven', 'library', 'lobby', 'corridor']);
  for (const pv of PAVILIONS) {
    const cx = (pv.x0 + pv.x1) / 2;
    const cz = (pv.z0 + pv.z1) / 2;
    const long = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
    const Lg = long ? pv.x1 - pv.x0 : pv.z1 - pv.z0;
    const W = long ? pv.z1 - pv.z0 : pv.x1 - pv.x0;
    const y = pv.floor;
    // benches down the middle of every gallery (two rows in wide rooms), facing the long walls
    if (pv.wing && !NO_BENCH.has(pv.wing) && !pv.cafe) {
      const n = Math.max(2, Math.floor(Lg / 8));
      const rows = W >= 18 ? [-W * 0.18, W * 0.18] : [0];
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        for (const off of rows) {
          if (long) benchAt(pv, pv.x0 + Lg * f, cz + off, 0);
          else benchAt(pv, cx + off, pv.z0 + Lg * f, Math.PI / 2);
        }
      }
    }
    // the Great Hall Corridor: benches facing the glass and the pond (the paintings hang opposite)
    if (pv.id === 'corridor') for (let z = pv.z1 - 12; z > pv.z0 + 6; z -= 11) benchAt(pv, pv.x0 + 4.5, z, Math.PI / 2);
    if (pv.id === 'eleven') {
      for (let i = 0; i < 8; i++) {
        const x = pv.x0 + 5 + i * 5.6;
        for (const z of [cz - 3, cz + 3]) prop({ cx: x, cz: z, hx: 0.6, hz: 0.6, y0: y, y1: y + 0.76, type: 'table', pv: pv.id });
      }
      prop({ cx: pv.x1 - 7, cz: pv.z0 + 3, hx: 3.2, hz: 0.45, y0: y, y1: y + 1.1, type: 'counter', pv: pv.id }); // bar along the north glass
    }
    if (pv.cafe) {
      for (let i = 0; i < 6; i++) prop({ cx: cx - 8 + i * 3.2, cz: cz, hx: 0.55, hz: 0.55, y0: y, y1: y + 0.76, type: 'table', pv: pv.id });
    }
    if (pv.id === 'library') {
      for (let i = 0; i < 7; i++) {
        const z = pv.z0 + 4 + i * 7;
        if (z + 2.6 > -216 && z - 2.6 < -204) continue; // keep the library entrance (east door z -214..-206) clear
        prop({ cx: pv.x1 - 1.0, cz: z, hx: 0.4, hz: 2.6, y0: y, y1: y + 2.2, type: 'shelf', pv: pv.id });
      }
      for (let i = 0; i < 3; i++) prop({ cx: pv.x0 + 4, cz: pv.z0 + 10 + i * 14, hx: 1.0, hz: 2.0, y0: y, y1: y + 0.76, type: 'table', pv: pv.id });
    }
    if (pv.store) {
      for (let i = 0; i < 3; i++) prop({ cx: pv.x0 + 3.5 + i * 3.8, cz: cz, hx: 0.7, hz: 3.0, y0: y, y1: y + 1.4, type: 'shelf', pv: pv.id });
      prop({ cx: pv.x1 - 2.2, cz: pv.z0 + 3, hx: 1.6, hz: 0.6, y0: y, y1: y + 1.0, type: 'case', pv: pv.id });
    }
    if (pv.id === 'lobby') prop({ cx: pv.x0 + 4, cz: pv.z1 - 4, hx: 2.6, hz: 0.6, y0: y, y1: y + 1.05, type: 'counter', pv: pv.id });
    if (pv.id === 'great-hall') for (let i = 0; i < 6; i++) prop({ cx: cx + (i % 2 ? 3.2 : -3.2), cz: pv.z0 + 5 + Math.floor(i / 2) * 6, hx: 0.9, hz: 0.9, y0: y, y1: y + 0.76, type: 'table', pv: pv.id });
    if (pv.id === 'south-lobby') cafe(pv);
  }

  /**
   * The South Lobby's empty floor becomes the museum café: a coffee bar at the east end (front
   * counter, back counter with espresso machines, pastry case, menu board), a cafeteria serving
   * line along the north glass and tables with chairs either side of the central aisle (z -167,
   * the nav.js lane between the south door, the Great Hall and the corridor).
   */
  function cafe(pv) {
    const y = pv.floor;
    // coffee bar: front counter facing west, back counter on the east wall
    prop({ cx: 26.5, cz: -168.5, hx: 0.45, hz: 4.6, y0: y, y1: y + 1.05, type: 'counter', pv: pv.id, cafe: 'coffee' });
    prop({ cx: 26.5, cz: -173.4, hx: 2.2, hz: 0.45, y0: y, y1: y + 1.05, type: 'counter', pv: pv.id, cafe: 'coffee' });
    prop({ cx: 33.2, cz: -167, hx: 0.38, hz: 6.5, y0: y, y1: y + 0.95, type: 'counter', pv: pv.id, cafe: 'coffee' });
    // espresso machines and a grinder on the back counter, pastry case on the front (visual)
    for (const z of [-170.5, -166.5]) box({ cx: 33.15, cz: z, hx: 0.3, hz: 0.42, y0: y + 0.95, y1: y + 1.48, mat: 'espresso', visOnly: true, decor: 'espresso' }, 'arch');
    box({ cx: 33.15, cz: -163.4, hx: 0.18, hz: 0.18, y0: y + 0.95, y1: y + 1.55, mat: 'espresso', visOnly: true, decor: 'grinder' }, 'arch');
    box({ cx: 26.5, cz: -166, hx: 0.36, hz: 1.4, y0: y + 1.05, y1: y + 1.5, mat: 'doorglass', visOnly: true, decor: 'pastry-case' }, 'arch');
    signs.push({ cx: 33.75, cz: -167, y0: y + 1.9, y1: y + 3.5, hx: 3.2, yaw: Math.PI / 2, nx: -1, nz: 0, text: 'COFFEE BAR', sub: 'ESPRESSO · LATTE · DRIP · TEA · PASTRIES', style: 'menu' });
    // cafeteria serving line along the north glass, with a sneeze guard
    prop({ cx: 3, cz: -174.6, hx: 6, hz: 0.5, y0: y, y1: y + 0.95, type: 'counter', pv: pv.id, cafe: 'line' });
    box({ cx: 3, cz: -174.15, hx: 5.8, hz: 0.04, y0: y + 1.25, y1: y + 1.75, mat: 'doorglass', visOnly: true, decor: 'sneeze-guard' }, 'arch');
    signs.push({ cx: 3, cz: -175.5, y0: y + 2.3, y1: y + 3.3, hx: 2.6, yaw: 0, nx: 0, nz: 1, text: 'CAFETERIA', sub: 'SOUPS · SANDWICHES · SALADS', style: 'menu' });
    // tables (0.9 m square) with four chairs, rows either side of the aisle
    const table = (x, z) => {
      prop({ cx: x, cz: z, hx: 0.48, hz: 0.48, y0: y, y1: y + 0.76, type: 'table', pv: pv.id, cafe: 'table' });
      for (const [dx, dz, yaw] of [[-0.85, 0, -Math.PI / 2], [0.85, 0, Math.PI / 2], [0, -0.85, 0], [0, 0.85, Math.PI]]) {
        prop({ cx: x + dx, cz: z + dz, hx: 0.24, hz: 0.24, yaw, y0: y, y1: y + 0.92, type: 'chair', pv: pv.id, cafe: 'chair' });
      }
    };
    for (const x of [-16, -10, 9.5, 15]) for (const z of [-171.6, -162.3]) if (clearOfLoot(x, z, 1.8) && navClearance(x, z) > 2.6) table(x, z);
    for (const x of [-28]) if (clearOfLoot(x, -162.3, 1.8)) table(x, -162.3);
    for (const z of [-171.5, -162.5]) if (clearOfLoot(21.5, z, 1.8) && navClearance(21.5, z) > 2.6) table(21.5, z);
  }

  // ---- chests on furniture: on a gallery bench, a reading table, a café table, the lobby desk,
  // the store's display case. The chest stands on the prop's top (Loot spawns at loot.y).
  const onProp = (pvId, type, pick = 0, filter = null) => {
    const list = props.filter((p) => p.pv === pvId && p.type === type && (!filter || filter(p)) && clearOfLoot(p.cx, p.cz, 3));
    const p = list[Math.min(list.length - 1, pick)];
    if (!p) return false;
    loot.push({ kind: 'chest', x: p.cx, z: p.cz, y: p.y1, yaw: p.yaw || 0, pv: pvId, on: type });
    return true;
  };
  onProp('early-american-1', 'bench', 1);
  onProp('early-american-2', 'bench', 2);
  onProp('contemporary', 'bench', 3);
  onProp('north-gallery', 'bench', 0);
  onProp('west-wing-2026', 'bench', 2);
  onProp('west-wing-2026', 'bench', 7);
  onProp('modern-bridge', 'bench', 1);
  onProp('lower-west', 'bench', 0);
  onProp('corridor', 'bench', 1);
  onProp('library', 'table', 1);
  onProp('great-hall', 'table', 4);
  onProp('south-lobby', 'table', 2, (p) => p.cafe === 'table');
  onProp('lobby', 'counter', 0);
  onProp('store', 'case', 0);
  // a roof tile holding loot (the North Tower's high-tier chest) stays solid: a broken tile
  // would leave the chest hanging in the air
  for (const p of parts) {
    if (!p.roofTile) continue;
    if (loot.some((l) => Math.abs(l.x - p.cx) <= p.hx + 0.6 && Math.abs(l.z - p.cz) <= p.hz + 0.6 && Math.abs(l.y - p.y1) < 0.6)) {
      p.collider.breakable = false;
      p.collider.hp = p.collider.maxHp = MUSEUM_HP;
      p.solid = true;
    }
  }
  world.fixedLoot = (world.fixedLoot || []).concat(loot);
  world.siteNav = createSiteNav(); // Bots route through the entrances (nav.js)
  const site = { ponds, terrain, parts, glass, props, hangLines, loot, decks, signs, statues, entrances: ENTRANCES, stats };
  attachSiteDoors(world, site);
  return site;
}

/** Rectangle r minus a list of axis-aligned hole rectangles (each hole cuts r into up to 4 pieces). */
export function subtractRects(r, holes) {
  let out = [r];
  for (const h of holes) {
    const next = [];
    for (const q of out) {
      if (h.x1 <= q.x0 || h.x0 >= q.x1 || h.z1 <= q.z0 || h.z0 >= q.z1) {
        next.push(q);
        continue;
      }
      if (h.z0 > q.z0) next.push({ x0: q.x0, x1: q.x1, z0: q.z0, z1: h.z0 });
      if (h.z1 < q.z1) next.push({ x0: q.x0, x1: q.x1, z0: h.z1, z1: q.z1 });
      const z0 = Math.max(q.z0, h.z0);
      const z1 = Math.min(q.z1, h.z1);
      if (h.x0 > q.x0) next.push({ x0: q.x0, x1: h.x0, z0, z1 });
      if (h.x1 < q.x1) next.push({ x0: h.x1, x1: q.x1, z0, z1 });
    }
    out = next;
  }
  return out.filter((q) => q.x1 - q.x0 > 0.05 && q.z1 - q.z0 > 0.05);
}
