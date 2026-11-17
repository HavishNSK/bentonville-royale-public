// BENTONVILLE ROYALE — Crystal Bridges: turn the site plan (site.js) into colliders and a list of
// renderable parts. No three.js here (meshes.js draws the parts), so it runs in Node tests.
//
//   const out = buildSite(world, mapData)
//     -> { ponds, parts, glass, props, hangLines, loot, rooms, interiorBoxes, stats }
//
// Every architecture box is registered with world.addBox in a fixed order (same ids on every
// client). Kinds / materials:
//   kind 'museum'  walls, slabs, roofs, stairs: unbreakable, harvestable for stone or wood
//                  (hp 1e9: Combat treats it as harvestable but it never falls)
//   kind 'glass'   floor-to-ceiling panes: breakable (shoot or swing them out), no mats
//   kind 'prop'    benches, tables, shelves, display cases: breakable + harvestable (wood)

import { LEVEL, PAVILIONS, PADS, SLABS, DECKS, WALKER_LANDING, RESERVE, pondsFrom, bakeTerrain, bowMargin } from './site.js';

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

/** Roof underside (interior ceiling) of pavilion pv at (x, z). */
export function roofUnder(pv, x, z) {
  const ceil = pv.floor + pv.height;
  const r = pv.roof || {};
  const rise = r.rise || 0;
  const u = (x - pv.x0) / (pv.x1 - pv.x0);
  const v = (z - pv.z0) / (pv.z1 - pv.z0);
  const cu = Math.min(1, Math.max(0, u));
  const cv = Math.min(1, Math.max(0, v));
  switch (r.type) {
    case 'convex': {
      const s = r.along === 'z' ? cv : cu;
      return ceil + rise * (1 - (2 * s - 1) ** 2);
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

/** Does the roof profile vary along x / z? (decides how finely walls and roof slabs are cut). */
function roofVaries(pv) {
  const r = pv.roof || {};
  const t = r.type;
  return {
    x: (t === 'convex' && r.along !== 'z') || t === 'dome' || (t === 'concave' && (r.high === 'e' || r.high === 'w')),
    z: (t === 'convex' && r.along === 'z') || t === 'vault' || t === 'dome' || t === 'sawtooth' || (t === 'concave' && (r.high === 'n' || r.high === 's')),
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
  if (world.setTerrain) world.setTerrain(terrain.meta, terrain.heights);
  if (world.reserve) world.reserve(RESERVE);
  for (const pd of ponds) if (world.addArea) world.addArea(pd.p, 'water');

  const parts = []; // { mat, cx, cz, hx, hz, yaw, y0, y1, collider, role }
  const glass = []; // glass pane parts (breakable, instanced)
  const props = []; // furniture parts (breakable, instanced per type)
  const hangLines = []; // wall stretches paintings can hang on
  const loot = [];
  const stats = { boxes: 0, glass: 0, props: 0 };

  const box = (o, role = 'arch') => {
    const hx = Math.max(0.02, o.hx);
    const hz = Math.max(0.02, o.hz);
    if (!(o.y1 > o.y0 + 0.01)) return null;
    const isGlass = role === 'glass';
    const isProp = role === 'prop';
    const c = world.addBox({
      cx: o.cx, cz: o.cz, hx, hz, yaw: o.yaw || 0, y0: o.y0, y1: o.y1,
      kind: isGlass ? 'glass' : isProp ? 'prop' : 'museum',
      mat: isGlass ? 'glass' : o.mat === 'wood' || o.mat === 'oak' || isProp ? 'wood' : o.mat === 'steel' || o.mat === 'copper' || o.mat === 'metal' ? 'metal' : 'brick',
      hp: isGlass ? GLASS_HP : isProp ? PROP_HP : MUSEUM_HP,
      ref: isGlass ? null : [],
    });
    if (isGlass) c.breakable = true;
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

  for (const pv of PAVILIONS) {
    const varies = roofVaries(pv);
    const bx0 = pv.x0 - bowMargin(pv, 'w');
    const bx1 = pv.x1 + bowMargin(pv, 'e');
    const bz0 = pv.z0 - bowMargin(pv, 'n');
    const bz1 = pv.z1 + bowMargin(pv, 's');

    // ---- floor slab (a solid plinth down to the ground; bridges: a thin slab on piers)
    if (!pv.noSlab) {
      if (pv.bridge) {
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
    }

    // ---- walls, glass, doors
    for (const side of ['n', 's', 'w', 'e']) {
      const ns = side === 'n' || side === 's';
      const bowed = bowMargin(pv, side) > 0;
      const along = ns ? varies.x : varies.z;
      for (const sp of sideSpans(pv, side)) {
        if (sp.t === 'open') continue;
        const len = sp.b - sp.a;
        if (sp.t === 'glass') {
          const n = Math.max(1, Math.round(len / PANE_W));
          for (let i = 0; i < n; i++) {
            const ua = sp.a + (len * i) / n;
            const ub = sp.a + (len * (i + 1)) / n;
            const [ax, az] = sidePoint(pv, side, ua);
            const [bx, bz] = sidePoint(pv, side, ub);
            const top = Math.min(roofUnder(pv, ax, az), roofUnder(pv, bx, bz));
            const pane = seg(ax, az, bx, bz, GLASS_T, pv.floor, top, 'glass', 'glass', { pv: pv.id, side, lean: !!pv.leanGlass });
            if (pane) pane.collider.pane = pane;
            // mullion at the start of every pane after the first, and at both ends
            for (const [mx, mz] of i === 0 ? [[ax, az], [bx, bz]] : [[bx, bz]]) {
              rect(mx - 0.08, mx + 0.08, mz - 0.08, mz + 0.08, pv.floor, roofUnder(pv, mx, mz), 'mullion', 'arch', { mullion: true });
            }
          }
          continue;
        }
        // wall / door: cut into ~2.4 m pieces when the wall bows or the roof varies along it
        const pieces = bowed || along ? Math.max(1, Math.ceil(len / 2.4)) : 1;
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
          const top = Math.min(roofUnder(pv, ax, az), roofUnder(pv, bx, bz));
          const mat = 'concrete';
          if (sp.t === 'wall') {
            const p = seg(ex0, ez0, ex1, ez1, WALL_T, pv.floor - 0.02, top, mat, 'arch', { wall: true, pv: pv.id, side });
            if (p && pv.wing) hangLines.push({ pv: pv.id, wing: pv.wing, side, ax, az, bx, bz, floor: pv.floor, top, n: sideNormal(side) });
          } else if (sp.t === 'door') {
            const sill = sp.sill !== undefined ? sp.sill : pv.floor;
            if (i === 0) threshold(pv, side, sp, sill);
            const head = Math.min(top, sill + (sp.head || DOOR_H));
            if (sill > pv.floor + 0.05) seg(ex0, ez0, ex1, ez1, WALL_T, pv.floor - 0.02, sill, mat, 'arch', { wall: true, pv: pv.id, side });
            if (top > head + 0.05) seg(ex0, ez0, ex1, ez1, WALL_T, head, top, mat, 'arch', { wall: true, lintel: true, pv: pv.id, side });
          }
        }
      }
    }

    // ---- roof (strips follow the profile; holes cut out of flat roofs)
    const nx = varies.x ? Math.max(2, Math.ceil((bx1 - bx0) / 3)) : 1;
    const nz = varies.z ? Math.max(2, Math.ceil((bz1 - bz0) / 3)) : 1;
    const holes = (pv.roof && pv.roof.holes) || [];
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x0 = bx0 + ((bx1 - bx0) * i) / nx;
        const x1 = bx0 + ((bx1 - bx0) * (i + 1)) / nx;
        const z0 = bz0 + ((bz1 - bz0) * k) / nz;
        const z1 = bz0 + ((bz1 - bz0) * (k + 1)) / nz;
        const y = roofUnder(pv, (x0 + x1) / 2, (z0 + z1) / 2);
        for (const r of subtractRects({ x0, x1, z0, z1 }, holes)) rect(r.x0, r.x1, r.z0, r.z1, y, y + ROOF_T, pv.roof.mat, 'arch', { roofOf: pv.id });
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

  // ---- furniture (breakable, harvestable wood): benches in every gallery spine, Eleven, library, store, café
  for (const pv of PAVILIONS) {
    const cx = (pv.x0 + pv.x1) / 2;
    const cz = (pv.z0 + pv.z1) / 2;
    const long = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
    const L = long ? pv.x1 - pv.x0 : pv.z1 - pv.z0;
    const y = pv.floor;
    const bench = (x, z, yaw) => box({ cx: x, cz: z, hx: 1.1, hz: 0.28, yaw, y0: y, y1: y + 0.46, mat: 'oak', type: 'bench', pv: pv.id }, 'prop');
    if (pv.wing && pv.wing !== 'eleven' && pv.wing !== 'library' && pv.wing !== 'lobby' && pv.wing !== 'corridor') {
      const n = Math.max(1, Math.floor(L / 16));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        if (long) bench(pv.x0 + L * f, cz, 0);
        else bench(cx, pv.z0 + L * f, Math.PI / 2);
      }
    }
    if (pv.id === 'eleven') {
      for (let i = 0; i < 8; i++) {
        const x = pv.x0 + 5 + i * 5.6;
        for (const z of [cz - 3, cz + 3]) {
          box({ cx: x, cz: z, hx: 0.6, hz: 0.6, y0: y, y1: y + 0.76, mat: 'oak', type: 'table', pv: pv.id }, 'prop');
        }
      }
      box({ cx: pv.x1 - 7, cz: pv.z0 + 3, hx: 3.2, hz: 0.45, y0: y, y1: y + 1.1, mat: 'oak', type: 'counter', pv: pv.id }, 'prop'); // bar along the north glass
    }
    if (pv.cafe) {
      for (let i = 0; i < 6; i++) box({ cx: cx - 8 + i * 3.2, cz: cz, hx: 0.55, hz: 0.55, y0: y, y1: y + 0.76, mat: 'oak', type: 'table', pv: pv.id }, 'prop');
    }
    if (pv.id === 'library') {
      for (let i = 0; i < 7; i++) box({ cx: pv.x1 - 1.0, cz: pv.z0 + 4 + i * 7, hx: 0.4, hz: 2.6, y0: y, y1: y + 2.2, mat: 'oak', type: 'shelf', pv: pv.id }, 'prop');
      for (let i = 0; i < 3; i++) box({ cx: pv.x0 + 4, cz: pv.z0 + 10 + i * 14, hx: 1.0, hz: 2.0, y0: y, y1: y + 0.76, mat: 'oak', type: 'table', pv: pv.id }, 'prop');
    }
    if (pv.store) {
      for (let i = 0; i < 3; i++) box({ cx: pv.x0 + 3.5 + i * 3.8, cz: cz, hx: 0.7, hz: 3.0, y0: y, y1: y + 1.4, mat: 'oak', type: 'shelf', pv: pv.id }, 'prop');
      box({ cx: pv.x1 - 2.2, cz: pv.z0 + 3, hx: 1.6, hz: 0.6, y0: y, y1: y + 1.0, mat: 'oak', type: 'case', pv: pv.id }, 'prop');
    }
    if (pv.id === 'lobby') box({ cx: pv.x0 + 4, cz: pv.z1 - 4, hx: 2.6, hz: 0.6, y0: y, y1: y + 1.05, mat: 'oak', type: 'counter', pv: pv.id }, 'prop');
    if (pv.id === 'great-hall') for (let i = 0; i < 6; i++) box({ cx: cx + (i % 2 ? 3.2 : -3.2), cz: pv.z0 + 5 + Math.floor(i / 2) * 6, hx: 0.9, hz: 0.9, y0: y, y1: y + 0.76, mat: 'oak', type: 'table', pv: pv.id }, 'prop');
  }

  // ---- loot: chests in the galleries, library and Eleven's kitchen; ammo boxes; the high-tier chest on the North Tower roof
  const tower = PAVILIONS.find((p) => p.id === 'north-tower');
  const at = (id, fx, fz, kind = 'chest', yOff = 0) => {
    const pv = PAVILIONS.find((p) => p.id === id);
    if (!pv) return;
    loot.push({ kind, x: pv.x0 + (pv.x1 - pv.x0) * fx, z: pv.z0 + (pv.z1 - pv.z0) * fz, y: pv.floor + yOff, yaw: 0, pv: id });
  };
  at('early-american-1', 0.8, 0.5);
  at('early-american-2', 0.2, 0.8);
  at('contemporary', 0.3, 0.15);
  at('contemporary', 0.7, 0.85, 'ammoBox');
  at('north-gallery', 0.15, 0.25);
  at('library', 0.5, 0.45);
  at('eleven', 0.87, 0.08); // the kitchen end, behind the bar
  at('great-hall', 0.5, 0.15, 'ammoBox');
  at('west-wing-2026', 0.25, 0.3);
  at('east-wing-2026', 0.4, 0.6);
  at('bridge-gallery-2026', 0.5, 0.5, 'ammoBox');
  at('store', 0.8, 0.8, 'ammoBox');
  at('south-lobby', 0.2, 0.5, 'ammoBox');
  at('modern-bridge', 0.6, 0.3, 'item');
  at('eleven', 0.3, 0.5, 'item');
  at('corridor', 0.3, 0.3, 'item');
  at('corridor', 0.3, 0.75, 'item');
  at('lobby', 0.5, 0.4, 'item');
  if (tower) loot.push({ kind: 'chest', tier: 'high', x: (tower.x0 + tower.x1) / 2, z: (tower.z0 + tower.z1) / 2, y: roofUnder(tower, 0, 0) + ROOF_T, yaw: 0, pv: tower.id });
  // under the Eleven bridge, on the weir (the other hard-to-reach high-tier spot)
  loot.push({ kind: 'chest', tier: 'high', x: -14, z: -257, y: LEVEL.SOUTH_POND + 0.05, yaw: 0, pv: 'weir-eleven' });
  world.fixedLoot = (world.fixedLoot || []).concat(loot);

  return { ponds, terrain, parts, glass, props, hangLines, loot, decks, stats };
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
