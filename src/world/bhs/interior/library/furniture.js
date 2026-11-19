// BENTONVILLE ROYALE — Bentonville High School library: furniture builders (pure, kit pieces only).
//
// Shelving, tables, chairs, computers, displays and plants for the library hero
// (docs/bhs/STYLE_BIBLE.md §1 library palette, §4 library) [LIB, LI2]. Every helper takes the kit K,
// builds in the current K group and uses K.rnd() for its variation (deterministic).
// Shelves and tables are colliders (wood cover); chairs, books, monitors and plants are decor that
// rests on (dep) the part under them, so they vanish when it breaks.

import { frame } from '../../kit/builder.js';

// book spines: muted library colours (no text, no logos)
const BOOKS = ['#8a2f2f', '#2f4f7a', '#c9b48a', '#3d6b4a', '#d6d1c4', '#6b3b5a', '#c58a3a', '#24324a', '#b04a3a', '#e2dccf', '#5a7a8a', '#7a6a3a', '#1f2a2a', '#9a8f7a'];
const BACK = '#3b342e'; // shelf back panel, in shadow
const top = (look) => ({ top: look, pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' });

/** A flat floor patch (top face only) at height y. */
export function floorPatch(K, x0, x1, z0, z1, y, look, t = 0.004) {
  return K.decor({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, yaw: 0, y0: y - t, y1: y }, look, { faces: top(look) });
}

/** A ceiling patch (bottom face only) whose underside is at y. */
export function ceilingPatch(K, x0, x1, z0, z1, y, look = 'ceilingTile') {
  return K.decor({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, yaw: 0, y0: y, y1: y + 0.02 }, look, { faces: { bottom: look, top: 'none', pu: 'none', nu: 'none', pv: 'none', nv: 'none' } });
}

/** Book blocks along one shelf level of one bay: u0..u1 (local u), side s (+1 / -1), level y0..y1. */
function books(K, f, u0, u1, vBack, s, depth, y0, y1, dep) {
  const rnd = K.rnd;
  const gap = y1 - y0;
  let u = u0 + 0.03;
  while (u < u1 - 0.08) {
    const w = Math.min(u1 - 0.03 - u, 0.12 + rnd() * 0.3);
    if (rnd() < 0.1) {
      u += w;
      continue;
    }
    const h = gap * (0.62 + rnd() * 0.28);
    const d = depth * (0.8 + rnd() * 0.18);
    const v0 = vBack + s * 0.015;
    const v1 = v0 + s * d;
    K.decor({ ...f.rect(u, u + w - 0.008, Math.min(v0, v1), Math.max(v0, v1)), y0: y0 + 0.02, y1: y0 + 0.02 + h }, BOOKS[Math.floor(rnd() * BOOKS.length)], { dep });
    u += w;
  }
}

/**
 * A run of shelving from a to b ([x, z]). opts:
 *   h       height (low rows 1.5, perimeter 2.1)
 *   depth   overall depth (double-sided ~0.9, wall shelving ~0.4)
 *   sides   [1, -1] double-sided, [1] or [-1] single (the +v side is the left of a -> b)
 *   levels  shelf board heights (books stand on each but the top)
 *   seg     max collider segment length (each segment breaks on its own)
 *   y       base height (default 0)
 * Returns the parts.
 */
export function shelfRun(K, a, b, opts = {}) {
  const Y = opts.y ?? 0; // base height (the floor it stands on)
  const h = opts.h ?? 1.5;
  const depth = opts.depth ?? 0.9;
  const sides = opts.sides ?? [1, -1];
  const levels = opts.levels ?? [0.1, 0.55, 1.0];
  const segMax = opts.seg ?? 3.6;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const f = frame(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
  const n = Math.max(1, Math.ceil(L / segMax - 1e-6));
  const hd = depth / 2;
  const single = sides.length === 1;
  // single-sided: the back panel sits on the far side; double: in the middle
  const vBack = single ? -sides[0] * (hd - 0.03) : 0;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const s0 = (L * i) / n;
    const s1 = (L * (i + 1)) / n;
    const endA = i === 0 ? 'shelfEnd' : 'none';
    const endB = i === n - 1 ? 'shelfEnd' : 'none';
    const open = (sd) => (sides.includes(sd) ? 'none' : 'shelfEnd');
    // u is +x of the frame: pu = the b end, nu = the a end; pv = +v side
    const p = K.box({ ...f.rect(s0, s1, -hd, hd), y0: Y, y1: Y + h }, { mat: 'wood', look: 'shelfWood', faces: { top: 'shelfWood', bottom: 'none', pu: endB, nu: endA, pv: open(1), nv: open(-1) }, role: 'shelf' });
    if (!p) continue;
    parts.push(p);
    // back panel, kick base, maple top cap
    K.decor({ ...f.rect(s0, s1, vBack - 0.015, vBack + 0.015), y0: Y + 0.02, y1: Y + h - 0.01 }, BACK, { dep: p });
    K.decor({ ...f.rect(s0, s1, -hd + 0.02, hd - 0.02), y0: Y, y1: Y + levels[0] }, opts.baseLook || 'shelfEnd', { dep: p });
    K.decor({ ...f.rect(s0 - (i === 0 ? 0.02 : 0), s1 + (i === n - 1 ? 0.02 : 0), -hd - 0.02, hd + 0.02), y0: Y + h, y1: Y + h + 0.035 }, 'shelfWood', { dep: p });
    // bays: maple uprights and boards, books
    const bays = Math.max(1, Math.round((s1 - s0) / 0.9));
    for (let k = 0; k < bays; k++) {
      const u0 = s0 + ((s1 - s0) * k) / bays;
      const u1 = s0 + ((s1 - s0) * (k + 1)) / bays;
      if (k > 0 || i > 0) K.decor({ ...f.rect(u0 - 0.012, u0 + 0.012, -hd + 0.01, hd - 0.01), y0: Y + levels[0], y1: Y + h }, 'shelfWood', { dep: p });
      for (const sd of sides) {
        const vb = single ? vBack : 0;
        const dd = single ? depth - 0.08 : hd - 0.05;
        for (let j = 0; j < levels.length; j++) {
          const y0 = levels[j];
          const y1 = j + 1 < levels.length ? levels[j + 1] : h;
          const vFront = vb + sd * (dd + 0.02);
          K.decor({ ...f.rect(u0, u1, Math.min(vb, vFront), Math.max(vb, vFront)), y0: Y + y0 - 0.02, y1: Y + y0 }, 'shelfWood', { dep: p });
          if (j + 1 < levels.length || h - y0 > 0.3) books(K, f, u0, u1, vb, sd, dd * 0.92, Y + y0, Y + Math.min(y1, h) - 0.04, p);
        }
      }
    }
  }
  // white end panels with maple edges on the outer ends [LIB]
  for (const [u, sg] of [[0, -1], [L, 1]]) {
    K.decor({ ...f.rect(u + sg * 0.005, u + sg * 0.035, -hd - 0.01, hd + 0.01), y0: Y, y1: Y + h }, 'shelfEnd', { dep: parts[sg < 0 ? 0 : parts.length - 1] });
    for (const v of [-hd, hd]) K.decor({ ...f.rect(u + sg * 0.005, u + sg * 0.04, v - 0.025, v + 0.025), y0: Y, y1: Y + h + 0.01 }, 'shelfWood', { dep: parts[sg < 0 ? 0 : parts.length - 1] });
  }
  return parts;
}

/**
 * A table: centre (cx, cz), length len (along yaw), depth dep, top at y + h. A wood collider (the top
 * slab) plus legs. Returns the top part (its y1 is the surface height).
 */
export function table(K, cx, cz, len, depth, yaw = 0, opts = {}) {
  const y = opts.y ?? 0;
  const h = opts.h ?? 0.76;
  const f = frame(cx, cz, yaw);
  const look = opts.look || 'shelfWood';
  const p = K.box({ ...f.rect(-len / 2, len / 2, -depth / 2, depth / 2), y0: y + h - 0.05, y1: y + h }, { mat: 'wood', hp: 120, look, role: 'table' });
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const lu = u * (len / 2 - 0.08);
    const lv = v * (depth / 2 - 0.08);
    K.decor({ ...f.rect(lu - 0.03, lu + 0.03, lv - 0.03, lv + 0.03), y0: y, y1: y + h - 0.05 }, opts.legLook || look, { dep: p });
  }
  // apron
  K.decor({ ...f.rect(-len / 2 + 0.06, len / 2 - 0.06, -depth / 2 + 0.06, depth / 2 - 0.06), y0: y + h - 0.13, y1: y + h - 0.05 }, opts.legLook || look, { dep: p });
  return p;
}

/** Wood-frame task chair (navy seat, maple frame) facing direction yaw (front = +u) [LI2]. */
export function chair(K, cx, cz, yaw, y = 0, seat = '#2b3a5a') {
  const f = frame(cx, cz, yaw);
  K.decor({ ...f.rect(-0.22, 0.22, -0.22, 0.22), y0: y + 0.42, y1: y + 0.48 }, seat);
  K.decor({ ...f.rect(-0.26, -0.22, -0.2, 0.2), y0: y + 0.55, y1: y + 0.88 }, seat);
  for (const [u, v] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) K.decor({ ...f.rect(u - 0.02, u + 0.02, v - 0.02, v + 0.02), y0: y, y1: y + 0.42 }, 'shelfWood');
  for (const v of [-0.21, 0.21]) K.decor({ ...f.rect(-0.25, -0.21, v - 0.02, v + 0.02), y0: y + 0.42, y1: y + 0.9 }, 'shelfWood');
}

/** Black upholstered lounge chair facing yaw (front = +u) [LIB]. */
export function loungeChair(K, cx, cz, yaw, y = 0) {
  const f = frame(cx, cz, yaw);
  K.decor({ ...f.rect(-0.42, 0.42, -0.45, 0.45), y0: y, y1: y + 0.4 }, '#1c1c1e');
  K.decor({ ...f.rect(-0.3, 0.4, -0.3, 0.3), y0: y + 0.4, y1: y + 0.47 }, '#2a2a2d');
  K.decor({ ...f.rect(-0.42, -0.24, -0.45, 0.45), y0: y + 0.4, y1: y + 0.95 }, '#1c1c1e');
  for (const v of [-0.38, 0.38]) K.decor({ ...f.rect(-0.42, 0.42, v - 0.07, v + 0.07), y0: y + 0.4, y1: y + 0.64 }, '#1c1c1e');
}

/** An all-in-one computer (beige body, lit screen) on a table top at y, screen facing yaw. */
export function computer(K, cx, cz, yaw, y, dep) {
  const f = frame(cx, cz, yaw);
  K.decor({ ...f.rect(-0.16, 0.08, -0.22, 0.22), y0: y, y1: y + 0.42 }, '#d8d3c6', { dep });
  K.decor({ ...f.rect(0.08, 0.1, -0.18, 0.18), y0: y + 0.12, y1: y + 0.38 }, 'screen', { dep });
  K.decor({ ...f.rect(0.22, 0.38, -0.22, 0.22), y0: y, y1: y + 0.02 }, '#e4e2dc', { dep });
}

/** Potted plant on the floor (y) [LIB]. */
export function plant(K, cx, cz, y = 0, s = 1) {
  K.decor({ cx, cz, hx: 0.3 * s, hz: 0.3 * s, yaw: 0, y0: y, y1: y + 0.55 * s }, '#d9d6cf', { shape: 'cyl' });
  const rnd = K.rnd;
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + rnd();
    const r = 0.18 * s * (i ? 1 : 0);
    K.decor({ cx: cx + Math.cos(a) * r, cz: cz + Math.sin(a) * r, hx: (0.35 - i * 0.04) * s, hz: (0.35 - i * 0.04) * s, yaw: a, y0: y + (0.5 + i * 0.28) * s, y1: y + (0.85 + i * 0.3) * s }, i % 2 ? '#3f6b3a' : '#355d33', { shape: 'cyl' });
  }
}
