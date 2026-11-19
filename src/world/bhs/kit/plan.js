// BENTONVILLE ROYALE — Bentonville High School kit: building plan -> geometry (pure, no three.js).
//
//   buildPlan(K, P) -> { rooms, levels, roomAt(x, z, y) }
//
// P = {
//   name, outline: [[x, z], ...] (any polygon, exterior wall centre line), courts: [poly, ...]
//   (open-to-sky courtyards: exterior walls + grass), storeys, h (floor-to-floor), roofY? (default
//   storeys * h), parapet (m),
//   facade(edge) -> [{ level, lookOut, openings }]  edge = { a, b, L, i, court, mid }   (per edge,
//      the treatment of each storey; missing levels = plain wall with P.wallLook),
//   rooms: [{ id, level, x0, x1, z0, z1, kind, label, floor, wall, ceiling, walls: true|false,
//             doors: [{ side: 'x0'|'x1'|'z0'|'z1', at (m from the low end) | 'mid', w }],
//             tall: n (the room is open through n storeys: no floor / ceiling above it) }],
//   voids: [{ level, x0, x1, z0, z1 }]   holes in the floor of `level` (stairs wells, atria),
//   stairs: [{ a: [x, z], b: [x, z], y0, y1, w, rail }],
// }
// Rooms are axis-aligned rects in world metres. Partition walls come from room edges: on every
// wall line the edges are cut into elementary intervals; a piece is built where the rooms on the
// two sides differ (or one side has none) and at least one side wants walls. Each face takes the
// wall look of the room on its side. Edges on the outline / a court are left to the exterior wall.
// Doors listed on a room edge become openings in the matching piece.

import { SIZE } from './palette.js';
import { seg } from './builder.js';

const EPS = 0.06;
const q = (v) => Math.round(v * 20) / 20; // 5 cm grid for wall lines

/** Signed area (x right, z down). */
function area2(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

export function inPoly(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** x-intervals of polygon p on the horizontal line z (sorted). */
function scan(p, z) {
  const xs = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i];
    const b = p[j];
    if (a[1] > z !== b[1] > z) xs.push(a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]));
  }
  xs.sort((m, n) => m - n);
  const out = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

/** Inner x-interval of polygon p over the band [z0, z1] (conservative: the intersection over the band). */
function bandIntervals(p, z0, z1) {
  const A = scan(p, z0 + 1e-3);
  const B = scan(p, z1 - 1e-3);
  const out = [];
  for (const a of A)
    for (const b of B) {
      const x0 = Math.max(a[0], b[0]);
      const x1 = Math.min(a[1], b[1]);
      if (x1 - x0 > 0.1) out.push([x0, x1]);
    }
  return out;
}

/** Distance from point to segment. */
function segDist(x, z, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
}

export function buildPlan(K, P) {
  const h = P.h || SIZE.storey;
  const n = P.storeys;
  const roofY = P.roofY ?? n * h;
  const tExt = P.tExt || SIZE.wallExt;
  const courts = P.courts || [];
  const rings = [{ p: P.outline, court: false }, ...courts.map((p) => ({ p, court: true }))];
  const rooms = (P.rooms || []).map((r, i) => ({ walls: true, ...r, idx: i }));
  /** A room's wall look on level L (wallLevels: [look per storey from its own level]). */
  const wallLook = (r, L) => (r && ((r.wallLevels && r.wallLevels[L - r.level]) || r.wall)) || 'paint';
  const levelY = (L) => (P.base || 0) + L * h;

  // switchback stair halls: P.stairHalls = [{ x0, x1, z0, z1, from: 'z0'|'z1', levels: [L, ...], rail }]
  // (flights run along z; the hall's x0..x1 is split into two flights with a centre wall). Each listed
  // level L gets a pair of flights from L to L + 1 and a void in level L + 1's floor over them; the
  // top landing (the 2 m band at the entry end) stays floor.
  const LAND = 2;
  P.voids = [...(P.voids || [])];
  const hallJobs = [];
  for (const sh of P.stairHalls || []) {
    for (const L of sh.levels) {
      const entryLo = sh.from !== 'z1';
      const zA = entryLo ? sh.z0 + LAND : sh.z1 - LAND; // flights start (entry end)
      const zB = entryLo ? sh.z1 - LAND : sh.z0 + LAND; // flights end (mid landing end)
      P.voids.push({ level: L + 1, x0: sh.x0, x1: sh.x1, z0: Math.min(zA, sh.z0 + (entryLo ? LAND : 0)), z1: Math.max(zA, sh.z1 - (entryLo ? 0 : LAND)) });
      hallJobs.push({ sh, L, zA, zB, entryLo });
    }
  }
  const group = (L) => `int:${P.name}:${L}`;

  const inside = (x, z) => inPoly(P.outline, x, z) && !courts.some((c) => inPoly(c, x, z));
  const onRing = (x, z) => rings.some(({ p }) => p.some((a, i) => segDist(x, z, a, p[(i + 1) % p.length]) < tExt / 2 + 0.25));

  /** The room at (x, z) on level L (a tall room below counts on the levels it spans). */
  const roomAt = (x, z, L) => {
    let best = null;
    for (const r of rooms) {
      const spans = r.level <= L && L < r.level + (r.tall || 1);
      if (spans && x > r.x0 - 1e-6 && x < r.x1 + 1e-6 && z > r.z0 - 1e-6 && z < r.z1 + 1e-6) {
        if (!best || r.level > best.level) best = r;
      }
    }
    return best;
  };

  // ------------------------------------------------------------------ floors (slabs) per level
  // level 0 floor is the ground (y = base): drawn per room only. Levels >= 1: a walkable slab
  // over the outline minus courts, voids of that level and tall rooms reaching through it.
  const STRIP = 0.6;
  const TILE = 6; // floor / roof tile size (m): what one blast can open
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const [, z] of P.outline) {
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  const holesFor = (L) => {
    const hs = (P.voids || []).filter((v) => v.level === L).map((v) => ({ x0: v.x0, x1: v.x1, z0: v.z0, z1: v.z1 }));
    for (const r of rooms) if (r.tall > 1 && L > r.level && L < r.level + r.tall) hs.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
    if (L === n) for (const v of P.raised || []) hs.push({ x0: v.x0, x1: v.x1, z0: v.z0, z1: v.z1 });
    return hs;
  };
  /** x-intervals of the outline minus courts over the band [z0, z1] (conservative). */
  const insideBand = (z0, z1) => {
    let iv = bandIntervals(P.outline, z0, z1);
    for (const c of courts) {
      for (const [c0, c1] of [...scan(c, z0 + 1e-3), ...scan(c, z1 - 1e-3), ...scan(c, (z0 + z1) / 2)]) {
        const next = [];
        for (const [p0, p1] of iv) {
          if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
          else {
            if (c0 > p0) next.push([p0, c0]);
            if (c1 < p1) next.push([c1, p1]);
          }
        }
        iv = next;
      }
    }
    return iv;
  };
  /**
   * Breakable floor / roof TILES (user: "break the roof to get into the building"). A TILE grid, also cut
   * where the floor finish changes between rooms; each tile's top carries the finish of the room it
   * floors (the roof: the membrane) and its underside the ceiling of the room below, so a broken tile
   * takes its finishes with it. Cells that cross an angled wall or a court edge fall back to strips.
   */
  const slabOver = (L, y, opts) => {
    const holes = holesFor(L);
    const lvRooms = rooms.filter((r) => r.level === L);
    const below = rooms.filter((r) => r.level <= L - 1 && r.level + (r.tall || 1) > L - 1);
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const [x] of P.outline) {
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
    }
    const xs = new Set([xMin, xMax]);
    const zs = new Set([zMin, zMax]);
    for (let x = Math.ceil(xMin / TILE) * TILE; x < xMax; x += TILE) xs.add(x);
    for (let z = Math.ceil(zMin / TILE) * TILE; z < zMax; z += TILE) zs.add(z);
    if (!opts.roof) {
      // cut where the finish differs on the two sides of a room edge
      const lookAt = (x, z) => {
        const r = lvRooms.find((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1);
        return (r && r.floor && r.floor !== 'none' && r.floor) || opts.lookTop;
      };
      for (const r of lvRooms) {
        const fz = (r.z0 + r.z1) / 2;
        const fx = (r.x0 + r.x1) / 2;
        for (const x of [r.x0, r.x1]) if (lookAt(x - 0.2, fz) !== lookAt(x + 0.2, fz)) xs.add(x);
        for (const z of [r.z0, r.z1]) if (lookAt(fx, z - 0.2) !== lookAt(fx, z + 0.2)) zs.add(z);
      }
    }
    const X = [...xs].sort((p, q) => p - q);
    const Z = [...zs].sort((p, q) => p - q);
    const emit = (cell) => {
      const cx = (cell.x0 + cell.x1) / 2;
      const cz = (cell.z0 + cell.z1) / 2;
      const inCell = (r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1;
      const top = opts.roof ? null : lvRooms.find(inCell);
      const bot = below.filter(inCell).sort((p, q) => q.level - p.level)[0];
      const lookTop = opts.roof ? opts.lookTop : (top && top.floor && top.floor !== 'none' && top.floor) || opts.lookTop;
      const lookBottom = (bot && bot.ceiling && bot.ceiling !== 'none' && !bot.ceilingTop && bot.ceiling) || opts.lookBottom;
      K.slab(cell, y, { ...opts, holes, lookTop, lookBottom });
    };
    for (let k = 0; k + 1 < Z.length; k++) {
      const z0 = Z[k];
      const z1 = Z[k + 1];
      if (z1 - z0 < 0.05) continue;
      const band = insideBand(z0, z1);
      for (let i = 0; i + 1 < X.length; i++) {
        const x0 = X[i];
        const x1 = X[i + 1];
        if (x1 - x0 < 0.05) continue;
        const whole = band.some(([p0, p1]) => p0 <= x0 + 1e-6 && p1 >= x1 - 1e-6);
        if (whole) {
          emit({ x0, x1, z0, z1 });
          continue;
        }
        // the cell crosses an edge: thin strips clipped to the outline, merged while both ends stay
        // within 0.3 m (keeping the inner bounds, so nothing pokes through a wall)
        const parts = [];
        for (let s = z0; s < z1 - 1e-6; s += STRIP) {
          const s1 = Math.min(z1, s + STRIP);
          for (const [p0, p1] of insideBand(s, s1)) {
            const c0 = Math.max(x0, p0);
            const c1 = Math.min(x1, p1);
            if (c1 - c0 <= 0.1) continue;
            const m = parts.find((q) => Math.abs(q.z1 - s) < 1e-6 && Math.abs(q.x0 - c0) < 0.3 && Math.abs(q.x1 - c1) < 0.3);
            if (m) {
              m.z1 = s1;
              m.x0 = Math.max(m.x0, c0);
              m.x1 = Math.min(m.x1, c1);
            } else parts.push({ x0: c0, x1: c1, z0: s, z1: s1 });
          }
        }
        for (const c of parts) emit(c);
      }
    }
  };
  K.setGroup('ext');
  for (let L = 1; L < n; L++) {
    K.setGroup(group(L));
    slabOver(L, levelY(L), { lookTop: 'vct', lookBottom: 'ceilingTile', t: SIZE.slab });
  }
  // roof (walkable) + roof look
  K.setGroup('ext');
  slabOver(n, roofY, { lookTop: 'roof', lookBottom: 'ceilingTile', t: 0.4, hp: 400, roof: true });

  // ------------------------------------------------------------------ raised volumes (gyms, theatre, clerestories)
  // P.raised = [{ x0, x1, z0, z1, top, look, lookIn, parapet, windows: (edge) -> openings }]: walls from
  // the main roof up to `top`, a roof slab and a parapet; the room below reaches up into it (its ceiling
  // follows: rooms set ceilingTop).
  for (const v of P.raised || []) {
    const c = [[v.x0, v.z0], [v.x1, v.z0], [v.x1, v.z1], [v.x0, v.z1]];
    K.setGroup('ext');
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      // c is clockwise on screen (x right, z down) -> the +v (left normal) side of each edge is inside
      const edge = { a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]), i, raised: v };
      K.wall(a, b, { y0: roofY - 0.4, y1: v.top, t: tExt, out: -1, mat: 'brick', lookOut: v.look || P.wallLook || 'brick', lookIn: v.lookIn || 'paint', lookEdge: v.look || 'brick', openings: v.windows ? v.windows(edge, roofY) : [], panel: 4 });
      const pTop = v.top + (v.parapet ?? 0.8);
      K.wall(a, b, { y0: v.top, y1: pTop, t: tExt, out: -1, mat: 'brick', lookOut: v.parapetLook || v.look || 'brick', lookIn: v.parapetLook || v.look || 'brick' });
      K.decor({ ...K.along(a, b, tExt + 0.12, pTop, pTop + 0.12) }, 'coping');
    }
    // the raised roof as 4 m tiles so a blast opens a hole, not the whole roof
    for (let x = v.x0; x < v.x1 - 1e-6; x += 4)
      for (let z = v.z0; z < v.z1 - 1e-6; z += 4) K.slab({ x0: x, x1: Math.min(v.x1, x + 4), z0: z, z1: Math.min(v.z1, z + 4) }, v.top, { t: 0.5, hp: 400, lookTop: 'roof', lookBottom: v.ceiling || 'ceilingTile' });
  }

  // ------------------------------------------------------------------ exterior walls + parapet
  /** An exterior door at edge-u on level L: a nav entrance (outside point -> inside point). */
  const entrance = (a, S, u, out, L) => {
    const x = a[0] + S.ux * u;
    const z = a[1] + S.uz * u;
    const nx = -S.uz * out;
    const nz = S.ux * out;
    K.zone({ kind: 'extDoor', building: P.name, level: L, y: levelY(L), x, z, nx, nz });
  };
  for (const ring of rings) {
    const p = ring.p;
    const ccw = area2(p) > 0; // x right, z down
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const S = seg(a, b);
      if (S.L < 0.2) continue;
      // which v side is outside: test a point just to the +v side of the midpoint
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const px = mx - S.uz * 0.6;
      const pz = mz + S.ux * 0.6;
      const plusIsIn = ring.court ? !inPoly(p, px, pz) : inPoly(p, px, pz);
      const out = plusIsIn ? -1 : 1;
      void ccw;
      const edge = { a, b, L: S.L, i, court: ring.court, mid: [mx, mz], out, S };
      const spec = (P.facade && P.facade(edge)) || [];
      for (let L = 0; L < n; L++) {
        const f = spec.find((s) => s.level === L) || {};
        // interior face takes the look of the room just inside the wall
        const ix = mx + S.uz * out * 0.8;
        const iz = mz - S.ux * out * 0.8;
        const rIn = roomAt(ix, iz, L);
        K.setGroup('ext');
        if (f.spans) {
          for (const sp of f.spans) {
            const pa = [a[0] + S.ux * sp.u0, a[1] + S.uz * sp.u0];
            const pb = [a[0] + S.ux * sp.u1, a[1] + S.uz * sp.u1];
            const ops = (sp.openings || []).map((o) => ({ ...o, u0: o.u0 - sp.u0, u1: o.u1 - sp.u0, y0: levelY(L) + (o.y0 ?? 0), y1: levelY(L) + (o.y1 ?? h) }));
            K.wall(pa, pb, { y0: levelY(L) - (L === 0 ? 0.3 : 0), y1: levelY(L + 1), t: tExt, out, mat: sp.mat || 'brick', lookOut: sp.lookOut || P.wallLook || 'brick', lookIn: wallLook(rIn, L), lookEdge: sp.lookOut || 'brick', openings: ops, panel: 3.6 });
            for (const o of sp.openings || []) if (o.type === 'door') entrance(a, S, (o.u0 + o.u1) / 2, out, L);
          }
          for (const d of f.decor || []) d(K, edge, levelY(L));
          continue;
        }
        K.wall(a, b, {
          y0: levelY(L) - (L === 0 ? 0.3 : 0),
          y1: levelY(L + 1),
          t: tExt,
          out,
          mat: 'brick',
          lookOut: f.lookOut || P.wallLook || 'brick',
          lookIn: wallLook(rIn, L),
          lookEdge: f.lookOut || P.wallLook || 'brick',
          openings: (f.openings || []).map((o) => ({ ...o, y0: levelY(L) + (o.y0 ?? 0), y1: levelY(L) + (o.y1 ?? h) })),
          panel: 3.6,
        });
        for (const o of f.openings || []) if (o.type === 'door') entrance(a, S, (o.u0 + o.u1) / 2, out, L);
        for (const d of f.decor || []) d(K, edge, levelY(L));
      }
      // parapet + coping
      const pTop = roofY + (P.parapet ?? SIZE.parapet);
      K.wall(a, b, { y0: roofY, y1: pTop, t: tExt, out, mat: 'brick', lookOut: P.parapetLook || P.wallLook || 'brick', lookIn: P.parapetLook || P.wallLook || 'brick' });
      K.decor({ ...K.along(a, b, tExt + 0.12, pTop, pTop + 0.12) }, 'coping');
    }
  }

  // ------------------------------------------------------------------ partition walls
  // collect room edges on axis lines
  const lines = new Map(); // key -> { axis: 'x'|'z', c, L, edges: [{ s0, s1, room, side, doors }] }
  const addEdge = (axis, c, s0, s1, room, side, L) => {
    const key = `${axis}:${q(c)}:${L}`;
    let ln = lines.get(key);
    if (!ln) lines.set(key, (ln = { axis, c: q(c), L, edges: [] }));
    const doors = (room.doors || []).filter((d) => d.side === sideName(axis, side, room, c));
    ln.edges.push({ s0, s1, room, side, doors });
  };
  // side: +1 = the room lies on the + side of the line (x > c for an x-line)
  const sideName = (axis, side) => (axis === 'x' ? (side > 0 ? 'x0' : 'x1') : side > 0 ? 'z0' : 'z1');
  for (const r of rooms) {
    for (let L = r.level; L < r.level + (r.tall || 1); L++) {
      addEdge('x', r.x0, r.z0, r.z1, r, +1, L);
      addEdge('x', r.x1, r.z0, r.z1, r, -1, L);
      addEdge('z', r.z0, r.x0, r.x1, r, +1, L);
      addEdge('z', r.z1, r.x0, r.x1, r, -1, L);
    }
  }
  // intervals of an axis line inside the outline minus courts, kept clear of the exterior walls
  const swap = (p) => p.map(([x, z]) => [z, x]);
  const outlineT = swap(P.outline);
  const courtsT = courts.map(swap);
  const minusIv = (A, B) => {
    let out = A;
    for (const [c0, c1] of B) {
      const next = [];
      for (const [p0, p1] of out) {
        if (c1 <= p0 || c0 >= p1) next.push([p0, p1]);
        else {
          if (c0 > p0) next.push([p0, c0]);
          if (c1 < p1) next.push([c1, p1]);
        }
      }
      out = next;
    }
    return out;
  };
  const pad = tExt / 2;
  const insideIv = (axis, c) => {
    // z-line (z = c): x intervals; x-line (x = c): z intervals (transposed polygons)
    const base = axis === 'z' ? scan(P.outline, c) : scan(outlineT, c);
    const holes = (axis === 'z' ? courts : courtsT).flatMap((p) => scan(p, c));
    return minusIv(base, holes).map(([p0, p1]) => [p0 + pad, p1 - pad]).filter(([p0, p1]) => p1 - p0 > 0.1);
  };
  function clipLine(axis, c, s0, s1) {
    const out = [];
    for (const [p0, p1] of insideIv(axis, c)) {
      const c0 = Math.max(s0, p0);
      const c1 = Math.min(s1, p1);
      if (c1 - c0 > 0.1) out.push([c0, c1]);
    }
    return out;
  }

  const emitPiece = (ln, s0, s1, plus, minus, rp, rm, y0, y1) => {
    const [ax, az] = ln.axis === 'x' ? [ln.c, s0] : [s0, ln.c];
    const [bx, bz] = ln.axis === 'x' ? [ln.c, s1] : [s1, ln.c];
    // openings: doors of either room whose span lies in this piece
    const openings = [];
    for (const e of [plus, minus]) {
      if (!e) continue;
      for (const d of e.doors) {
        if (d.level !== undefined && d.level !== ln.L) continue;
        if (d.level === undefined && ln.L !== e.room.level) continue;
        const dw = d.w || 1.0;
        const centre = d.at === 'mid' || d.at === undefined ? (e.s0 + e.s1) / 2 : e.s0 + d.at;
        const u0 = centre - dw / 2 - s0;
        const u1 = centre + dw / 2 - s0;
        // the leaf swings into the room that owns the door (never out into the corridor): +v of a
        // z-line (a->b along +x) is +z, of an x-line (along +z) is -x
        const swing = d.swing ?? (ln.axis === 'z' ? e.side : -e.side);
        if (u1 > 0.05 && u0 < s1 - s0 - 0.05) openings.push({ u0, u1, y0, y1: y0 + (d.h || SIZE.door + 0.1), type: d.type || 'door', leaf: d.leaf, swing });
      }
    }
    // interior glazing [user]: a hallway / lobby / commons wall onto a classroom, lab, library or office
    // gets a glazed band (sill 1.0, head 2.35) between piers, clear of the doors
    const HALL = ['corridor', 'lobby', 'commons'];
    const VIEW = ['classroom', 'lab', 'library', 'office', 'music', 'gallery'];
    const glazed = rp && rm && ((HALL.includes(rp.kind) && VIEW.includes(rm.kind)) || (HALL.includes(rm.kind) && VIEW.includes(rp.kind))) && !(rp.noHallGlass || rm.noHallGlass);
    if (glazed && s1 - s0 > 2.2) {
      let free = [[0.6, s1 - s0 - 0.6]];
      for (const o of openings) {
        const next = [];
        for (const [f0, f1] of free) {
          const g0 = o.u0 - 0.45;
          const g1 = o.u1 + 0.45;
          if (g1 <= f0 || g0 >= f1) next.push([f0, f1]);
          else {
            if (g0 > f0) next.push([f0, g0]);
            if (g1 < f1) next.push([g1, f1]);
          }
        }
        free = next;
      }
      for (const [f0, f1] of free) {
        const n = Math.max(1, Math.ceil((f1 - f0 + 0.5) / 2.9));
        const pw = (f1 - f0 - 0.5 * (n - 1)) / n;
        if (pw < 0.8) continue;
        for (let k = 0; k < n; k++) {
          const u0 = f0 + k * (pw + 0.5);
          openings.push({ u0, u1: u0 + pw, y0: y0 + 1.0, y1: y0 + 2.35, type: 'glass', bay: pw, rows: 1, recess: 0.1 });
        }
      }
    }
    // for an x-line a->b goes +z: +v = (-1, 0) = the minus room; for a z-line a->b goes +x: +v = (0, +1) = the plus room
    const lookPlus = wallLook(rp, ln.L);
    const lookMinus = wallLook(rm, ln.L);
    const pvLook = ln.axis === 'x' ? lookMinus : lookPlus;
    const nvLook = ln.axis === 'x' ? lookPlus : lookMinus;
    K.setGroup(group(ln.L));
    K.wall([ax, az], [bx, bz], { y0, y1, t: SIZE.wallInt, out: 1, mat: 'block', lookOut: pvLook, lookIn: nvLook, lookEdge: 'paint', openings, panel: 3.6 });
  };

  for (const ln of lines.values()) {
    const cuts = new Set();
    for (const e of ln.edges) {
      cuts.add(e.s0);
      cuts.add(e.s1);
    }
    const cs = [...cuts].sort((m, k) => m - k);
    const y0 = levelY(ln.L);
    const y1 = levelY(ln.L + 1) - (ln.L + 1 < n ? SIZE.slab : 0.4);
    for (let i = 0; i + 1 < cs.length; i++) {
      const s0 = cs[i];
      const s1 = cs[i + 1];
      if (s1 - s0 < EPS) continue;
      const mid = (s0 + s1) / 2;
      const cover = ln.edges.filter((e) => e.s0 <= mid && e.s1 >= mid);
      const plus = cover.find((e) => e.side > 0);
      const minus = cover.find((e) => e.side < 0);
      const rp = plus && plus.room;
      const rm = minus && minus.room;
      if (rp === rm) continue;
      if (!((rp && rp.walls) || (rm && rm.walls))) continue;
      for (const [c0, c1] of clipLine(ln.axis, ln.c, s0, s1)) {
        // a room edge ON an exterior / courtyard wall is that wall: no second (partition) wall inside
        // it (it covered every window from inside: the QA's "opaque panels" over the courtyard glass)
        const m = (c0 + c1) / 2;
        const [mx, mz] = ln.axis === 'x' ? [ln.c, m] : [m, ln.c];
        if (onRing(mx, mz)) continue;
        emitPiece(ln, c0, c1, plus, minus, rp, rm, y0, y1);
      }
    }
  }

  /** Strips (axis-aligned rects) of a room rect that lie inside the outline minus courts. */
  const roomStrips = (r) => {
    const out = [];
    for (let z = r.z0; z < r.z1 - 1e-6; z += STRIP) {
      const z1 = Math.min(r.z1, z + STRIP);
      let iv = bandIntervals(P.outline, z, z1);
      for (const c of courts) iv = minusIv(iv, scan(c, (z + z1) / 2));
      for (const [p0, p1] of iv) {
        const x0 = Math.max(r.x0, p0);
        const x1 = Math.min(r.x1, p1);
        if (x1 - x0 > 0.05) out.push({ x0, x1, z0: z, z1 });
      }
    }
    // merge vertically stacked strips with the same x-range
    const merged = [];
    for (const s of out) {
      const m = merged.find((k) => Math.abs(k.x0 - s.x0) < 1e-6 && Math.abs(k.x1 - s.x1) < 1e-6 && Math.abs(k.z1 - s.z0) < 1e-6);
      if (m) m.z1 = s.z1;
      else merged.push({ ...s });
    }
    return merged;
  };

  // ------------------------------------------------------------------ room floors, ceilings, fixtures
  // Upper floors and ceilings are the tiles' own faces (above). Ground floors are decor 4 cm up (the
  // map's flat ground layers draw over y = 0). Raised rooms (ceilingTop) draw their own high ceiling.
  // Lay-in fixtures hang under the tile above and break with it.
  const slabIndex = new Map();
  const key = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
  for (const p of K.parts) {
    if (p.role !== 'slab') continue;
    for (let x = Math.floor((p.cx - p.hx) / 6); x <= Math.floor((p.cx + p.hx) / 6); x++)
      for (let z = Math.floor((p.cz - p.hz) / 6); z <= Math.floor((p.cz + p.hz) / 6); z++) {
        const k = x + ',' + z;
        if (!slabIndex.has(k)) slabIndex.set(k, []);
        slabIndex.get(k).push(p);
      }
  }
  const slabAt = (x, z, y) => (slabIndex.get(key(x, z)) || []).find((p) => Math.abs(p.y0 - y) < 0.05 && Math.abs(x - p.cx) <= p.hx && Math.abs(z - p.cz) <= p.hz) || null;
  for (const r of rooms) {
    const y = levelY(r.level);
    K.setGroup(group(r.level));
    const fl = r.floor || 'vct';
    if (r.level === 0 && fl !== 'none') {
      for (const s of roomStrips(r)) K.decor({ cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, hx: (s.x1 - s.x0) / 2, hz: (s.z1 - s.z0) / 2, yaw: 0, y0: y + 0.028, y1: y + 0.04 }, fl, { faces: { top: fl, pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
    }
    const cl = r.ceiling || 'ceilingTile';
    if (r.ceilingTop && cl !== 'none') {
      for (const s of roomStrips(r)) K.decor({ cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, hx: (s.x1 - s.x0) / 2, hz: (s.z1 - s.z0) / 2, yaw: 0, y0: r.ceilingTop - 0.02, y1: r.ceilingTop }, cl, { faces: { bottom: cl, top: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none' } });
    }
    const topL = r.level + (r.tall || 1);
    const ceilY = r.ceilingTop ?? levelY(topL) - (topL < n ? SIZE.slab : 0.4);
    const wantsFixtures = r.fixtures !== false && (r.kind === 'classroom' || r.kind === 'office' || r.kind === 'corridor' || r.kind === 'lab' || r.kind === 'music' || r.kind === 'gallery' || r.kind === 'restroom' || r.kind === 'storage');
    if (wantsFixtures && !r.ceilingTop) {
      const sx = 2.4;
      const sz = 3.0;
      for (let x = r.x0 + sx / 2; x < r.x1 - 0.6; x += sx)
        for (let z = r.z0 + sz / 2; z < r.z1 - 0.6; z += sz) {
          if (!inside(x, z)) continue;
          K.decor({ cx: x, cz: z, hx: 0.3, hz: 0.6, yaw: 0, y0: ceilY - 0.03, y1: ceilY - 0.005 }, 'fixture', { dep: slabAt(x, z, ceilY) });
        }
      K.light({ x: (r.x0 + r.x1) / 2, y: ceilY - 0.4, z: (r.z0 + r.z1) / 2, range: Math.max(8, Math.hypot(r.x1 - r.x0, r.z1 - r.z0) * 0.7), intensity: 0.8, room: r.id });
    }
  }

  // ------------------------------------------------------------------ stair halls
  for (const { sh, L, zA, zB, entryLo } of hallJobs) {
    const y0 = levelY(L);
    const rise = h;
    const xm = (sh.x0 + sh.x1) / 2;
    const fw = xm - sh.x0 - 0.12;
    K.setGroup(group(L));
    // flight 1 (x0 half): zA -> zB, y0 -> y0 + rise / 2 ; mid landing ; flight 2 (x1 half): zB -> zA
    K.stairs([(sh.x0 + xm) / 2 - 0.06, zA], [(sh.x0 + xm) / 2 - 0.06, zB], y0, y0 + rise / 2, fw, { rail: null });
    const lz0 = entryLo ? zB : sh.z0;
    const lz1 = entryLo ? sh.z1 : zB;
    K.slab({ x0: sh.x0, x1: sh.x1, z0: lz0, z1: lz1 }, y0 + rise / 2, { t: 0.25, lookTop: 'stairTread', lookBottom: 'ceilingTile' });
    K.stairs([(xm + sh.x1) / 2 + 0.06, zB], [(xm + sh.x1) / 2 + 0.06, zA], y0 + rise / 2, y0 + rise, fw, { rail: null });
    // centre wall between the flights (full storey) and the rail at the top landing over flight 1
    K.wall([xm, Math.min(zA, zB)], [xm, Math.max(zA, zB)], { y0, y1: y0 + rise, t: 0.2, out: 1, mat: 'block', lookOut: 'paint', lookIn: 'paint' });
    K.setGroup(group(L + 1));
    // guard the drop over flight 1 at the floor above, unless the next flight up starts there (QA: the
    // rail blocked every 2nd -> 3rd floor flight)
    if (!sh.levels.includes(L + 1)) K.railing([sh.x0, zA], [xm, zA], y0 + rise, { style: sh.rail || 'picket' });
    K.light({ x: xm, y: y0 + rise - 0.5, z: (sh.z0 + sh.z1) / 2, range: 9, intensity: 0.7 });
  }

  // ------------------------------------------------------------------ stairs
  for (const s of P.stairs || []) {
    K.setGroup(group(Math.max(0, Math.round((s.y0 - (P.base || 0)) / h))));
    K.stairs(s.a, s.b, s.y0, s.y1, s.w || 1.8, { rail: s.rail || 'picket', look: s.look });
  }

  // ------------------------------------------------------------------ zones (interior mood / nav / streaming)
  for (const r of rooms) K.zone({ id: r.id, building: P.name, level: r.level, tall: r.tall || 1, x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, y0: levelY(r.level), y1: levelY(r.level + (r.tall || 1)), kind: r.kind, label: r.label });

  return { name: P.name, rooms, levelY, roomAt, inside };
}
