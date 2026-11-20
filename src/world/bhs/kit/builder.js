// BENTONVILLE ROYALE — Bentonville High School kit: the builder (pure, no three.js; runs in Node).
//
//   const K = createKit(world, { owner: 'bhs' })
//   K.box(o, opts) / K.decor(o, look)            one oriented box (collider + drawn) / drawn only
//   K.wall(a, b, opts)                           a wall from point a to b, cut by openings
//   K.slab(rect, y, opts) / K.slabFrame(f, ...)  floors / roofs with holes (walkable)
//   K.stairs(o) / K.railing(a, b, o) / K.column(x, z, o)
//   K.light(o) / K.loot(o) / K.zone(o) / K.nav    lighting, loot, interior zones, bot graph
//   K.parts / K.decors                           everything stadium-style meshes draw
//
// Coordinates: composed-world metres, x east, z SOUTH, y up (ground y = 0). An oriented box is
// { cx, cz, hx, hz, yaw, y0, y1 }: half extents hx along u = (cos yaw, sin yaw), hz along
// v = (-sin yaw, cos yaw) (boxColliders.js). Looks name a material in kit/materials.js; a box may
// draw its faces with different looks: faces = { pu, nu, pv, nv, top, bottom } (p = +axis side).
// Every collider gets owner = opts.owner so WorldMeshes routes hide/show to the kit's meshes.
// Build order is deterministic (multiplayer names boxes by sequential id).

import { SIZE } from './palette.js';

// Hit points. EVERYTHING breaks (user 2026-11-18 / 2026-11-19: "make all the floors and walls and builds
// of BHS breakable ... break the roof to get into the building"): floors, roofs and stairs are concrete
// (harvested as brick) with more hp than walls; 'solid' is kept only for callers that ask for it.
export const KIT_HP = Object.freeze({ brick: 500, block: 400, metal: 260, wood: 160, glass: 70, frame: 70, prop: 120, floor: 500, roof: 400, stair: 400, solid: 1e9 });

const STEP_MAX = 0.6; // World STEP is 0.62: risers must stay under it

/** Unit vectors and length of segment a -> b ([x, z]). */
export function seg(a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz);
  return { L, ux: dx / L, uz: dz / L, yaw: Math.atan2(dz, dx) };
}

/** Rectangle r ({ x0, x1, z0, z1 }) minus axis-aligned holes (each cut into up to 4 pieces). */
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

/**
 * A local frame: origin (ox, oz), rotation yaw. toW(u, v) -> [x, z]; rect(u0, u1, v0, v1) -> an
 * oriented box base { cx, cz, hx, hz, yaw }. Wings are authored in their own (u, v) metres.
 */
export function frame(ox, oz, yaw = 0) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const toW = (u, v) => [ox + u * c - v * s, oz + u * s + v * c];
  const toL = (x, z) => {
    const dx = x - ox;
    const dz = z - oz;
    return [dx * c + dz * s, -dx * s + dz * c];
  };
  const rect = (u0, u1, v0, v1) => {
    const [cx, cz] = toW((u0 + u1) / 2, (v0 + v1) / 2);
    return { cx, cz, hx: Math.abs(u1 - u0) / 2, hz: Math.abs(v1 - v0) / 2, yaw };
  };
  return { ox, oz, yaw, toW, toL, rect };
}

export function createKit(world, { owner = 'bhs', seed = 1 } = {}) {
  const parts = []; // { ...box, look, faces, collider, group }
  const decors = []; // { ...box, look, faces, group, dep? }
  const lights = [];
  const loot = [];
  const zones = [];
  const nav = { nodes: [], edges: [] };
  let group = 'ext';

  // deterministic RNG for anything procedural
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  const kindOf = (mat) => (mat === 'glass' ? 'glass' : 'prop');
  const matOf = (m) => (m === 'glass' ? 'glass' : m === 'metal' || m === 'steel' ? 'metal' : m === 'wood' ? 'wood' : 'brick');

  /** Collider + drawn box. opts: { look, faces, mat ('brick'|'block'|'metal'|'wood'|'glass'|'solid'), hp, walkable, passable } */
  function box(o, opts = {}) {
    const hx = Math.max(0.01, o.hx);
    const hz = Math.max(0.01, o.hz);
    if (!(o.y1 > o.y0 + 0.005)) return null;
    const mat = opts.mat || 'brick';
    const solid = mat === 'solid' || opts.solid;
    // 'solid' = sturdy concrete (floors, risers, bleachers): it breaks too [user: everything breaks];
    // only an explicit opts.unbreakable keeps a piece standing for good
    const hp = opts.unbreakable ? KIT_HP.solid : opts.hp || (solid ? KIT_HP.floor : KIT_HP[mat] || KIT_HP.brick);
    const glass = mat === 'glass';
    const c = world.addBox({
      cx: o.cx, cz: o.cz, hx, hz, yaw: o.yaw || 0, y0: o.y0, y1: o.y1,
      kind: kindOf(mat),
      mat: matOf(solid ? opts.harvest || 'brick' : mat === 'block' ? 'brick' : mat),
      hp,
      ref: glass ? null : [],
      passable: !!opts.passable,
    });
    c.owner = owner;
    if (glass) c.breakable = true;
    if (opts.walkable) c.walkable = true;
    if (solid) c.solidPiece = true;
    const part = { cx: o.cx, cz: o.cz, hx, hz, yaw: o.yaw || 0, y0: o.y0, y1: o.y1, look: opts.look || 'brick', faces: opts.faces || null, collider: c, group: opts.group || group, role: opts.role || mat };
    c.part = part;
    parts.push(part);
    return part;
  }

  /** Drawn-only box (trim, mullions, furniture details). dep: the part it rests on (hidden with it). */
  function decor(o, look, opts = {}) {
    if (!(o.y1 > o.y0 + 0.001)) return null;
    const d = { cx: o.cx, cz: o.cz, hx: Math.max(0.005, o.hx), hz: Math.max(0.005, o.hz), yaw: o.yaw || 0, y0: o.y0, y1: o.y1, look, faces: opts.faces || null, group: opts.group || group, dep: opts.dep || null, shape: opts.shape || null };
    decors.push(d);
    return d;
  }

  /** An oriented box between two points: centre line a -> b, thickness t (v), y0..y1. */
  function along(a, b, t, y0, y1) {
    const S = seg(a, b);
    return { cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2, hx: S.L / 2, hz: t / 2, yaw: S.yaw, y0, y1 };
  }

  /** Point at distance u along a -> b, offset w along the left normal (-uz, ux) ... (v axis). */
  const at = (a, S, u, w = 0) => [a[0] + S.ux * u - S.uz * w, a[1] + S.uz * u + S.ux * w];

  /**
   * Wall a -> b (centre line). opts:
   *   y0, y1, t, mat, out: +1 | -1 (which v side faces OUT: +1 = the +v / left-normal side),
   *   lookOut, lookIn, lookEdge, panel (max piece length, m), openings: [{ u0, u1, y0, y1, type, ... }]
   * Opening types: 'door' (open doorway + frame), 'window' (recessed breakable glass + frame + sill
   *   + optional lintel), 'glass' (floor-to-head glazing with mullions), 'void' (nothing).
   * The solid wall is split into vertical strips at opening edges and panel boundaries; each strip's
   * solid y-spans become boxes (so every panel breaks on its own).
   */
  function wall(a, b, opts = {}) {
    const S = seg(a, b);
    const t = opts.t || SIZE.wallInt;
    const y0 = opts.y0 ?? 0;
    const y1 = opts.y1 ?? SIZE.storey;
    const out = opts.out || 1;
    const lookOut = opts.lookOut || opts.look || 'paint';
    const lookIn = opts.lookIn || opts.look || 'paint';
    const faces = out > 0 ? { pv: lookOut, nv: lookIn } : { pv: lookIn, nv: lookOut };
    const edgeLook = opts.lookEdge || lookIn;
    const panel = opts.panel || 3.6;
    const ops = (opts.openings || []).map((o) => ({ ...o, u0: Math.max(0, o.u0), u1: Math.min(S.L, o.u1) })).filter((o) => o.u1 - o.u0 > 0.05);
    // strip boundaries
    const cuts = new Set([0, S.L]);
    for (const o of ops) {
      cuts.add(o.u0);
      cuts.add(o.u1);
    }
    const sorted = [...cuts].sort((p, q) => p - q);
    const strips = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const s0 = sorted[i];
      const s1 = sorted[i + 1];
      const n = Math.max(1, Math.ceil((s1 - s0) / panel - 1e-6));
      for (let k = 0; k < n; k++) strips.push([s0 + ((s1 - s0) * k) / n, s0 + ((s1 - s0) * (k + 1)) / n]);
    }
    const made = [];
    for (const [s0, s1] of strips) {
      const mid = (s0 + s1) / 2;
      // y-spans of the openings over this strip
      const holes = ops.filter((o) => o.u0 <= mid && o.u1 >= mid).map((o) => [o.y0 ?? y0, o.y1 ?? y1]).sort((p, q) => p[0] - q[0]);
      let y = y0;
      const spans = [];
      for (const [h0, h1] of holes) {
        if (h0 > y + 0.01) spans.push([y, Math.min(h0, y1)]);
        y = Math.max(y, h1);
      }
      if (y < y1 - 0.01) spans.push([y, y1]);
      const c = at(a, S, mid);
      for (const [p0, p1] of spans) {
        const p = box({ cx: c[0], cz: c[1], hx: (s1 - s0) / 2, hz: t / 2, yaw: S.yaw, y0: p0, y1: p1 }, { mat: opts.mat || 'block', look: lookIn, faces: { ...faces, pu: edgeLook, nu: edgeLook, top: edgeLook, bottom: edgeLook }, role: 'wall' });
        if (p) made.push(p);
      }
    }
    // openings: glass, frames, sills, lintels
    const nOut = out; // +v side is out when out = +1
    for (const o of ops) {
      const oy0 = o.y0 ?? y0;
      const oy1 = o.y1 ?? y1;
      const w = o.u1 - o.u0;
      const mid = (o.u0 + o.u1) / 2;
      if (o.type === 'window' || o.type === 'glass') {
        const recess = o.recess ?? (o.type === 'window' ? t * 0.35 : 0.05); // glass set back from the outer face
        const gOff = nOut * (t / 2 - recess);
        const bays = o.type === 'glass' ? Math.max(1, Math.round(w / (o.bay || 1.5))) : 1;
        const rows = o.rows || 1;
        for (let k = 0; k < bays; k++) {
          const b0 = o.u0 + (w * k) / bays;
          const b1 = o.u0 + (w * (k + 1)) / bays;
          const c = at(a, S, (b0 + b1) / 2, gOff);
          box({ cx: c[0], cz: c[1], hx: (b1 - b0) / 2 - 0.01, hz: 0.015, yaw: S.yaw, y0: oy0 + 0.02, y1: oy1 - 0.02 }, { mat: 'glass', look: o.glassLook || 'glass', role: 'glass' });
          // vertical mullion at each bay edge
          const mc = at(a, S, b0, gOff);
          decor({ cx: mc[0], cz: mc[1], hx: 0.035, hz: 0.07, yaw: S.yaw, y0: oy0, y1: oy1 }, o.frameLook || 'alu');
        }
        const ec = at(a, S, o.u1, gOff);
        decor({ cx: ec[0], cz: ec[1], hx: 0.035, hz: 0.07, yaw: S.yaw, y0: oy0, y1: oy1 }, o.frameLook || 'alu');
        // horizontal transoms (rows) + head + sill
        for (let r = 0; r <= rows; r++) {
          const yy = oy0 + ((oy1 - oy0) * r) / rows;
          const cc = at(a, S, mid, gOff);
          decor({ cx: cc[0], cz: cc[1], hx: w / 2, hz: 0.07, yaw: S.yaw, y0: yy - 0.035, y1: yy + 0.035 }, o.frameLook || 'alu');
        }
        for (const yy of o.transoms || []) {
          const cc = at(a, S, mid, gOff);
          decor({ cx: cc[0], cz: cc[1], hx: w / 2, hz: 0.07, yaw: S.yaw, y0: yy - 0.03, y1: yy + 0.03 }, o.frameLook || 'alu');
        }
        if (o.type === 'window') {
          // jamb returns (the recess reveals read as depth), sill and lintel on the outer face
          const sc = at(a, S, mid, nOut * (t / 2 + 0.04));
          decor({ cx: sc[0], cz: sc[1], hx: w / 2 + 0.08, hz: 0.07, yaw: S.yaw, y0: oy0 - 0.12, y1: oy0 }, o.sillLook || 'buffStone');
          if (o.lintel !== false) decor({ cx: sc[0], cz: sc[1], hx: w / 2 + 0.12, hz: 0.04, yaw: S.yaw, y0: oy1, y1: oy1 + (o.lintelH || 0.2) }, o.lintelLook || 'buffStone');
          // interior sill (deep)
          const ic = at(a, S, mid, -nOut * (t / 2 + 0.06));
          decor({ cx: ic[0], cz: ic[1], hx: w / 2 + 0.03, hz: 0.09, yaw: S.yaw, y0: oy0 - 0.03, y1: oy0 + 0.01 }, 'sillIn', { group: o.group });
        }
      } else if (o.type === 'door') {
        // door frame (both faces) + an open leaf against the wall
        for (const side of [1, -1]) {
          for (const u of [o.u0, o.u1]) {
            const fc = at(a, S, u, side * (t / 2 + 0.01));
            decor({ cx: fc[0], cz: fc[1], hx: 0.05, hz: 0.02, yaw: S.yaw, y0: oy0, y1: oy1 }, o.frameLook || 'doorFrame');
          }
          const hc = at(a, S, mid, side * (t / 2 + 0.01));
          decor({ cx: hc[0], cz: hc[1], hx: w / 2 + 0.05, hz: 0.02, yaw: S.yaw, y0: oy1 - 0.06, y1: oy1 }, o.frameLook || 'doorFrame');
        }
        if (o.leaf !== false) {
          const lw = Math.min(w, 1.0);
          const sgn = o.swing || -nOut; // leaf opens into the room side by default
          const hingeU = o.u0;
          const lc = at(a, S, hingeU + 0.04, sgn * (t / 2 + lw / 2));
          decor({ cx: lc[0], cz: lc[1], hx: 0.022, hz: lw / 2, yaw: S.yaw, y0: oy0 + 0.01, y1: Math.min(oy1, oy0 + SIZE.door) - 0.01 }, o.leafLook || 'doorWood');
        }
      }
    }
    return made;
  }

  /** Axis-aligned walkable slab rect { x0, x1, z0, z1 } with top at y, minus holes. */
  function slab(r, y, opts = {}) {
    const t = opts.t || SIZE.slab;
    const pieces = subtractRects(r, opts.holes || []);
    const out = [];
    for (const q of pieces) {
      const p = box({ cx: (q.x0 + q.x1) / 2, cz: (q.z0 + q.z1) / 2, hx: (q.x1 - q.x0) / 2, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: y - t, y1: y }, { mat: 'block', hp: opts.hp || KIT_HP.floor, walkable: true, look: opts.lookTop || 'vct', faces: { top: opts.lookTop || 'vct', bottom: opts.lookBottom || 'ceilingTile', pu: opts.lookEdge || 'slabEdge', nu: opts.lookEdge || 'slabEdge', pv: opts.lookEdge || 'slabEdge', nv: opts.lookEdge || 'slabEdge' }, role: 'slab', group: opts.group });
      if (p) out.push(p);
    }
    return out;
  }

  /** Slab in a local frame f: rect (u0, u1, v0, v1) and holes in the same local coords. */
  function slabFrame(f, u0, u1, v0, v1, y, opts = {}) {
    if (Math.abs(f.yaw) < 1e-9) {
      const [x0, z0] = f.toW(u0, v0);
      const [x1, z1] = f.toW(u1, v1);
      const holes = (opts.holes || []).map((h) => {
        const [a0, c0] = f.toW(h.u0, h.v0);
        const [a1, c1] = f.toW(h.u1, h.v1);
        return { x0: Math.min(a0, a1), x1: Math.max(a0, a1), z0: Math.min(c0, c1), z1: Math.max(c0, c1) };
      });
      return slab({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) }, y, { ...opts, holes });
    }
    // rotated: subtract in local space, emit oriented boxes
    const t = opts.t || SIZE.slab;
    const pieces = subtractRects({ x0: u0, x1: u1, z0: v0, z1: v1 }, (opts.holes || []).map((h) => ({ x0: h.u0, x1: h.u1, z0: h.v0, z1: h.v1 })));
    return pieces.map((q) => box({ ...f.rect(q.x0, q.x1, q.z0, q.z1), y0: y - t, y1: y }, { mat: 'block', hp: opts.hp || KIT_HP.floor, walkable: true, look: opts.lookTop || 'vct', faces: { top: opts.lookTop || 'vct', bottom: opts.lookBottom || 'ceilingTile', pu: 'slabEdge', nu: 'slabEdge', pv: 'slabEdge', nv: 'slabEdge' }, role: 'slab', group: opts.group }));
  }

  /**
   * Straight stair flight from a (bottom, [x, z]) to b (top), width w, rising y0 -> y1. Solid stepped
   * boxes (block from the sides) plus a smooth invisible deck ramp, stringers and (optional)
   * railings on both sides. opts: { look, rail: 'picket'|'glass'|null, nosing }
   */
  function stairs(a, b, y0, y1, w, opts = {}) {
    const S = seg(a, b);
    const n = Math.max(2, Math.ceil((y1 - y0) / Math.min(SIZE.riser, STEP_MAX)));
    const look = opts.look || 'stairTread';
    for (let i = 0; i < n; i++) {
      const u0 = (S.L * i) / n;
      const u1 = (S.L * (i + 1)) / n;
      const top = y0 + ((y1 - y0) * (i + 1)) / n;
      const c = at(a, S, (u0 + u1) / 2);
      box({ cx: c[0], cz: c[1], hx: (u1 - u0) / 2 + 0.005, hz: w / 2, yaw: S.yaw, y0: Math.max(y0 - 0.02, top - 0.45), y1: top }, { mat: 'block', hp: KIT_HP.stair, walkable: true, look, faces: { top: look, pu: opts.riserLook || 'stairRiser', nu: opts.riserLook || 'stairRiser', pv: opts.sideLook || 'stringer', nv: opts.sideLook || 'stringer', bottom: 'ceilingTile' }, role: 'stair' });
      // nosing strip
      const nc = at(a, S, u1 - 0.03);
      decor({ cx: nc[0], cz: nc[1], hx: 0.03, hz: w / 2, yaw: S.yaw, y0: top - 0.005, y1: top + 0.004 }, 'nosing');
    }
    // stringers (sloped boxes approximated by segments) + rails
    const segs = Math.max(2, Math.round(S.L / 1.2));
    for (const side of [1, -1]) {
      for (let k = 0; k < segs; k++) {
        const u0 = (S.L * k) / segs;
        const u1 = (S.L * (k + 1)) / segs;
        const ya = y0 + ((y1 - y0) * k) / segs;
        const yb = y0 + ((y1 - y0) * (k + 1)) / segs;
        const c = at(a, S, (u0 + u1) / 2, side * (w / 2 + 0.06));
        decor({ cx: c[0], cz: c[1], hx: (u1 - u0) / 2, hz: 0.06, yaw: S.yaw, y0: Math.min(ya, yb) - 0.35, y1: Math.max(ya, yb) + 0.05 }, opts.stringerLook || 'stringer');
        if (opts.rail) {
          decor({ cx: c[0], cz: c[1], hx: (u1 - u0) / 2, hz: 0.03, yaw: S.yaw, y0: Math.max(ya, yb) + 0.9, y1: Math.max(ya, yb) + 0.95 }, 'railCap');
          if (opts.rail === 'glass') decor({ cx: c[0], cz: c[1], hx: (u1 - u0) / 2 - 0.02, hz: 0.012, yaw: S.yaw, y0: Math.max(ya, yb) + 0.05, y1: Math.max(ya, yb) + 0.9 }, 'railGlass');
          else {
            const pc = at(a, S, u0 + 0.05, side * (w / 2 + 0.06));
            decor({ cx: pc[0], cz: pc[1], hx: 0.02, hz: 0.02, yaw: S.yaw, y0: ya, y1: ya + 0.92 }, 'railCap');
          }
        }
      }
    }
    zones.push({ kind: 'stair', a, b, y0, y1, w });
    return { a, b, y0, y1, w, n };
  }

  /** Railing a -> b at floor height y (solid to bullets? no: passable for shots, blocks walking). */
  function railing(a, b, y, opts = {}) {
    const S = seg(a, b);
    const style = opts.style || 'picket';
    const h = opts.h || SIZE.rail;
    // a thin collider so players cannot walk off a balcony edge
    box({ ...along(a, b, 0.06, y, y + h) }, { mat: style === 'glass' ? 'metal' : 'metal', hp: KIT_HP.metal, look: 'railCap', faces: { pv: style === 'glass' ? 'railGlass' : 'none', nv: style === 'glass' ? 'railGlass' : 'none', top: 'railCap', pu: 'railCap', nu: 'railCap', bottom: 'none' }, role: 'rail' });
    decor({ ...along(a, b, 0.08, y + h - 0.06, y + h) }, 'railCap');
    if (style === 'glass') {
      const n = Math.max(1, Math.round(S.L / 1.5));
      for (let k = 0; k <= n; k++) {
        const c = at(a, S, (S.L * k) / n);
        decor({ cx: c[0], cz: c[1], hx: 0.03, hz: 0.05, yaw: S.yaw, y0: y, y1: y + h }, 'railCap');
      }
    } else {
      const n = Math.max(2, Math.round(S.L / 0.12));
      for (let k = 0; k <= n; k++) {
        const c = at(a, S, (S.L * k) / n);
        decor({ cx: c[0], cz: c[1], hx: 0.012, hz: 0.012, yaw: S.yaw, y0: y + 0.05, y1: y + h - 0.06 }, 'picket');
      }
      decor({ ...along(a, b, 0.04, y + 0.05, y + 0.1) }, 'railCap');
    }
  }

  /** Round (12-sided, drawn) or square column at (x, z), radius r, y0..y1; a square collider. */
  function column(x, z, y0, y1, opts = {}) {
    const r = opts.r || 0.3;
    const p = box({ cx: x, cz: z, hx: r * 0.9, hz: r * 0.9, yaw: 0, y0, y1 }, { mat: opts.mat || 'block', look: 'none', faces: { pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' }, role: 'column' });
    decor({ cx: x, cz: z, hx: r, hz: r, yaw: 0, y0, y1 }, opts.look || 'column', { shape: opts.round === false ? null : 'cyl', dep: p });
    return p;
  }

  function light(o) {
    lights.push({ intensity: 1, range: 14, color: 0xfff3e0, kind: 'point', ...o });
  }

  function addLoot(o) {
    loot.push({ yaw: 0, ...o });
  }

  /** An interior zone (for interior mood, streaming and bot nav "inside" tests). */
  function zone(o) {
    zones.push({ kind: 'room', ...o });
  }

  return {
    world,
    owner,
    parts,
    decors,
    lights,
    zones,
    nav,
    rnd,
    setGroup: (g) => (group = g),
    get group() {
      return group;
    },
    box,
    decor,
    along,
    at,
    wall,
    slab,
    slabFrame,
    stairs,
    railing,
    column,
    light,
    loot: addLoot,
    lootSpots: loot,
    zone,
  };
}
