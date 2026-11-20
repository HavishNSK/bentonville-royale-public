// BENTONVILLE ROYALE — Bentonville High School: hallways and fill rooms (lead-owned; pure, no three.js).
//
//   dressFill(K, plans)
//
// Hallways: two-tier steel locker banks along every classroom / lab wall that faces a corridor,
// broken at doors, with a dark base and a top cap; a vinyl base on the walls, a wall clock every
// ~30 m, display cases near the main hall. Fill rooms (approximate, no photos: style bible §4):
// offices (desks, chairs, file cabinets), restrooms (stall partitions, sinks, mirror), storage
// (metal shelving with boxes), stairwells (a light). Small pieces are decor; desks / shelving are light
// cover. Seeded by room id. Groups follow the plan levels (interior streaming).

import { PAL } from './kit/palette.js';
import { scan } from './kit/plan.js';

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const rng = (seed) => {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const LOCKER_COLOURS = [PAL.locker, 0x7a2e2a, 0x2b3036, 0x5d6a72];

/** The rooms adjacent to corridor c along one of its long edges, with the door gaps on that edge. */
function edgeRuns(c, rooms, plan) {
  const runs = [];
  const along = c.x1 - c.x0 >= c.z1 - c.z0;
  for (const r of rooms) {
    if (r === c || r.level !== c.level || !r.walls) continue;
    if (!['classroom', 'lab', 'music', 'gallery', 'office', 'storage'].includes(r.kind)) continue;
    let line = null;
    let side = null;
    if (along) {
      if (Math.abs(r.z1 - c.z0) < 0.05) [line, side] = [c.z0, 'z1'];
      else if (Math.abs(r.z0 - c.z1) < 0.05) [line, side] = [c.z1, 'z0'];
    } else if (Math.abs(r.x1 - c.x0) < 0.05) [line, side] = [c.x0, 'x1'];
    else if (Math.abs(r.x0 - c.x1) < 0.05) [line, side] = [c.x1, 'x0'];
    if (line === null) continue;
    const a0 = Math.max(along ? r.x0 : r.z0, along ? c.x0 : c.z0) + 0.6;
    const a1 = Math.min(along ? r.x1 : r.z1, along ? c.x1 : c.z1) - 0.6;
    if (a1 - a0 < 1.2) continue;
    const gaps = (r.doors || [])
      .filter((d) => d.side === side)
      .map((d) => {
        const lo = along ? r.x0 : r.z0;
        const hi = along ? r.x1 : r.z1;
        const ctr = d.at === 'mid' || d.at === undefined ? (lo + hi) / 2 : lo + d.at;
        return [ctr - (d.w || 1) / 2 - 0.5, ctr + (d.w || 1) / 2 + 0.5];
      });
    // the corridor's inward direction from that line
    const inward = along ? (line === c.z0 ? 1 : -1) : line === c.x0 ? 1 : -1;
    runs.push({ along, line, a0, a1, gaps, inward, room: r, plan });
  }
  return runs;
}

/** Locker bank along a run, split around the gaps. */
function lockers(K, run, y, colour) {
  let segs = [[run.a0, run.a1]];
  for (const [g0, g1] of run.gaps) {
    const next = [];
    for (const [s0, s1] of segs) {
      if (g1 <= s0 || g0 >= s1) next.push([s0, s1]);
      else {
        if (g0 > s0) next.push([s0, g0]);
        if (g1 < s1) next.push([g1, s1]);
      }
    }
    segs = next;
  }
  const D = 0.38;
  const off = 0.1 + D / 2; // from the wall line (half wall 0.1)
  for (const [s0, s1] of segs) {
    if (s1 - s0 < 0.9) continue;
    const len = Math.floor((s1 - s0) / 0.3) * 0.3;
    const mid = (s0 + s1) / 2;
    const c = run.along ? { cx: mid, cz: run.line + run.inward * off, hx: len / 2, hz: D / 2 } : { cx: run.line + run.inward * off, cz: mid, hx: D / 2, hz: len / 2 };
    const front = run.along ? (run.inward > 0 ? 'pv' : 'nv') : run.inward > 0 ? 'pu' : 'nu';
    const faces = { pu: hex(colour), nu: hex(colour), pv: hex(colour), nv: hex(colour), top: hex(colour), bottom: 'none' };
    faces[front] = 'locker';
    // the bank is a collider (cover, harvestable metal); base + cap are decor
    const p = K.box({ ...c, yaw: 0, y0: y + 0.1, y1: y + 1.9 }, { mat: 'metal', hp: 260, look: 'locker', faces, role: 'locker' });
    K.decor({ ...c, hx: c.hx + 0.01, hz: c.hz + 0.01, yaw: 0, y0: y, y1: y + 0.1 }, 'base', { dep: p });
    K.decor({ ...c, hx: c.hx + 0.02, hz: c.hz + 0.03, yaw: 0, y0: y + 1.9, y1: y + 1.96 }, hex(colour), { dep: p });
  }
}

function office(K, r, y, rnd) {
  const n = Math.max(1, Math.min(12, Math.floor(((r.x1 - r.x0) * (r.z1 - r.z0)) / 22)));
  for (let i = 0; i < n; i++) {
    const x = r.x0 + 2 + rnd() * Math.max(0.1, r.x1 - r.x0 - 4);
    const z = r.z0 + 2 + rnd() * Math.max(0.1, r.z1 - r.z0 - 4);
    const yaw = Math.floor(rnd() * 4) * (Math.PI / 2);
    const d = K.box({ cx: x, cz: z, hx: 0.8, hz: 0.4, yaw, y0: y, y1: y + 0.76 }, { mat: 'wood', hp: 120, look: hex(PAL.doorWood), role: 'prop' });
    K.decor({ cx: x, cz: z, hx: 0.25, hz: 0.04, yaw, y0: y + 0.76, y1: y + 1.15 }, '#1d1f22', { dep: d }); // monitor
    K.decor({ cx: x + Math.sin(yaw) * 0.7, cz: z - Math.cos(yaw) * 0.7, hx: 0.25, hz: 0.25, yaw, y0: y, y1: y + 0.95 }, '#2a2c30'); // task chair
  }
  K.box({ cx: r.x1 - 0.5, cz: r.z0 + 1, hx: 0.25, hz: 0.6, yaw: 0, y0: y, y1: y + 1.35 }, { mat: 'metal', hp: 200, look: '#8d9196', role: 'prop' }); // file cabinet
  K.loot({ kind: rnd() < 0.3 ? 'chest' : 'item', x: (r.x0 + r.x1) / 2, z: r.z1 - 0.9, y });
}

function restroom(K, r, y) {
  const along = r.x1 - r.x0 >= r.z1 - r.z0;
  const n = Math.max(2, Math.floor(((along ? r.x1 - r.x0 : r.z1 - r.z0) - 1.5) / 1.0));
  for (let i = 0; i < n; i++) {
    const t = (along ? r.x0 : r.z0) + 0.8 + i * 1.0;
    const c = along ? { cx: t, cz: r.z1 - 0.8, hx: 0.02, hz: 0.75 } : { cx: r.x1 - 0.8, cz: t, hx: 0.75, hz: 0.02 };
    K.decor({ ...c, yaw: 0, y0: y + 0.3, y1: y + 2.0 }, '#5e6a74'); // stall partition
  }
  const s = along ? { cx: (r.x0 + r.x1) / 2, cz: r.z0 + 0.35, hx: (r.x1 - r.x0) / 2 - 0.8, hz: 0.3 } : { cx: r.x0 + 0.35, cz: (r.z0 + r.z1) / 2, hx: 0.3, hz: (r.z1 - r.z0) / 2 - 0.8 };
  K.box({ ...s, yaw: 0, y0: y, y1: y + 0.86 }, { mat: 'block', hp: 300, look: '#d9d7d2', role: 'prop' }); // vanity
  K.decor({ ...s, hz: along ? 0.02 : s.hz, hx: along ? s.hx : 0.02, cz: along ? r.z0 + 0.12 : s.cz, cx: along ? s.cx : r.x0 + 0.12, yaw: 0, y0: y + 1.1, y1: y + 1.9 }, '#cfdde0'); // mirror
}

function storage(K, r, y, rnd) {
  const along = r.x1 - r.x0 >= r.z1 - r.z0;
  const n = Math.max(1, Math.floor(((along ? r.x1 - r.x0 : r.z1 - r.z0) - 1) / 2.2));
  for (let i = 0; i < n; i++) {
    const t = (along ? r.x0 : r.z0) + 1.2 + i * 2.2;
    const c = along ? { cx: t, cz: r.z0 + 0.5, hx: 0.9, hz: 0.3 } : { cx: r.x0 + 0.5, cz: t, hx: 0.3, hz: 0.9 };
    const p = K.box({ ...c, yaw: 0, y0: y, y1: y + 2.0 }, { mat: 'metal', hp: 200, look: '#8b8f93', role: 'prop' });
    for (let k = 0; k < 4; k++) if (rnd() < 0.7) K.decor({ ...c, hx: c.hx * 0.4, hz: c.hz * 0.8, cx: c.cx + (rnd() - 0.5) * c.hx, yaw: 0, y0: y + 0.05 + k * 0.5, y1: y + 0.4 + k * 0.5 }, '#b48a5c', { dep: p });
  }
  K.loot({ kind: rnd() < 0.35 ? 'chest' : 'ammoBox', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y });
}

// ------------------------------------------------------------------ helpers for the room dressers

/** Door centres of a room (world x, z). */
function doorPoints(r) {
  return (r.doors || [])
    .filter((d) => d.type !== 'void')
    .map((d) => {
      const along = d.side === 'z0' || d.side === 'z1';
      const lo = along ? r.x0 : r.z0;
      const hi = along ? r.x1 : r.z1;
      const t = d.at === 'mid' || d.at === undefined ? (lo + hi) / 2 : lo + d.at;
      if (d.side === 'x0') return [r.x0, t];
      if (d.side === 'x1') return [r.x1, t];
      if (d.side === 'z0') return [t, r.z0];
      return [t, r.z1];
    });
}

/**
 * A placement test for one room: the footprint (centre x, z, half sizes hx, hz) lies inside the building
 * outline (rooms are clipped to it), inside the room with margin m, and clear of the room's doors.
 */
function placer(plan, r, m = 0.4, doorClear = 2.0) {
  const doors = doorPoints(r);
  return (x, z, hx, hz) => {
    if (x - hx < r.x0 + m || x + hx > r.x1 - m || z - hz < r.z0 + m || z + hz > r.z1 - m) return false;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) if (!plan.inside(x + a * (hx + 0.3), z + b * (hz + 0.3))) return false;
    return doors.every(([dx, dz]) => Math.max(Math.abs(dx - x) - hx, Math.abs(dz - z) - hz) > doorClear);
  };
}

/** Cell centres over a room (spacing sx, sz) that the placer accepts for a footprint hx, hz. */
function cells(r, sx, sz, ok, hx, hz) {
  const out = [];
  const nx = Math.max(1, Math.floor((r.x1 - r.x0) / sx));
  const nz = Math.max(1, Math.floor((r.z1 - r.z0) / sz));
  const ox = r.x0 + (r.x1 - r.x0 - nx * sx) / 2 + sx / 2;
  const oz = r.z0 + (r.z1 - r.z0 - nz * sz) / 2 + sz / 2;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) if (ok(ox + i * sx, oz + k * sz, hx, hz)) out.push([ox + i * sx, oz + k * sz]);
  return out;
}

const BOOKS = ['#7a2e2a', '#2f4b6e', '#b8964a', '#3d5b3f', '#d8d3c8', '#5a3d6e', '#c4602d'];
const SOFT = ['#7a2e2a', '#2f4b6e', '#3d5b3f', '#b8964a', '#4a4c50'];

/** A double-sided bookcase (cover, wood) along x (along) or z, with book spines on both faces. */
function bookcase(K, x, z, len, along, y, rnd, h = 1.7) {
  const hx = along ? len / 2 : 0.3;
  const hz = along ? 0.3 : len / 2;
  const p = K.box({ cx: x, cz: z, hx, hz, yaw: 0, y0: y, y1: y + h }, { mat: 'wood', hp: 150, look: '#6b4a32', role: 'prop' });
  const shelves = Math.floor((h - 0.1) / 0.4);
  for (let k = 0; k < shelves; k++) {
    const y0 = y + 0.12 + k * 0.4;
    for (let i = 0; i < Math.floor(len / 0.45); i++) {
      const u = -len / 2 + 0.25 + i * 0.45;
      const c = BOOKS[Math.floor(rnd() * BOOKS.length)];
      const y1 = y0 + 0.22 + rnd() * 0.08;
      for (const sv of [-1, 1]) K.decor(along ? { cx: x + u, cz: z + sv * 0.31, hx: 0.2, hz: 0.01, yaw: 0, y0, y1 } : { cx: x + sv * 0.31, cz: z + u, hx: 0.01, hz: 0.2, yaw: 0, y0, y1 }, c, { dep: p });
    }
  }
  return p;
}

/** A table (light cover) with chairs along both long sides. */
function table(K, x, z, hx, hz, y, top, chairs = true) {
  const t = K.box({ cx: x, cz: z, hx, hz, yaw: 0, y0: y + 0.72, y1: y + 0.76 }, { mat: 'wood', hp: 120, look: top, role: 'prop' });
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.decor({ cx: x + a * (hx - 0.08), cz: z + b * (hz - 0.08), hx: 0.03, hz: 0.03, yaw: 0, y0: y, y1: y + 0.72 }, '#4a4c50', { dep: t });
  if (!chairs) return t;
  const along = hx >= hz;
  const half = along ? hx : hz;
  const n = Math.max(1, Math.floor((half * 2) / 0.8));
  for (let i = 0; i < n; i++) {
    const u = -half + 0.4 + i * 0.8;
    for (const sv of [-1, 1]) {
      const cx = along ? x + u : x + sv * (hx + 0.35);
      const cz = along ? z + sv * (hz + 0.35) : z + u;
      K.decor({ cx, cz, hx: 0.21, hz: 0.21, yaw: 0, y0: y + 0.43, y1: y + 0.47 }, '#2b3036');
      K.decor({ cx: along ? cx : cx + sv * 0.2, cz: along ? cz + sv * 0.2 : cz, hx: along ? 0.2 : 0.02, hz: along ? 0.02 : 0.2, yaw: 0, y0: y + 0.47, y1: y + 0.86 }, '#2b3036');
      K.decor({ cx, cz, hx: 0.02, hz: 0.02, yaw: 0, y0: y, y1: y + 0.43 }, '#9a9ca0');
    }
  }
  return t;
}

function plant(K, x, z, y, rnd) {
  const p = K.box({ cx: x, cz: z, hx: 0.3, hz: 0.3, yaw: 0, y0: y, y1: y + 0.5 }, { mat: 'block', hp: 80, look: '#d8d3c8', role: 'prop' });
  K.decor({ cx: x, cz: z, hx: 0.42, hz: 0.42, yaw: rnd() * 3, y0: y + 0.5, y1: y + 1.2 + rnd() * 0.5 }, '#3f6b3a', { dep: p });
}

/** Media center / study commons: bookcase stacks in one half, study tables in the other, a desk. */
function library(K, r, y, rnd, plan) {
  const ok = placer(plan, r, 0.8, 2.2);
  const wide = r.x1 - r.x0 >= r.z1 - r.z0;
  const mid = wide ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2;
  let stacks = 0;
  for (const [x, z] of cells(r, wide ? 2.6 : 4.4, wide ? 4.4 : 2.6, ok, wide ? 0.3 : 1.7, wide ? 1.7 : 0.3)) {
    if ((wide ? x : z) > mid) continue;
    bookcase(K, x, z, 3.4, !wide, y, rnd);
    stacks++;
  }
  let n = 0;
  for (const [x, z] of cells(r, 4.2, 3.6, ok, 1.6, 1.1)) {
    if ((wide ? x : z) <= mid + 1) continue;
    const t = table(K, x, z, 1.2, 0.5, y, '#c9a676');
    if (n++ % 2 === 1) K.decor({ cx: x - 0.6, cz: z, hx: 0.2, hz: 0.03, yaw: 0, y0: y + 0.76, y1: y + 1.05 }, '#1d1f22', { dep: t }); // laptop
  }
  // a circulation desk inside the first door
  const [dx, dz] = doorPoints(r)[0] || [(r.x0 + r.x1) / 2, r.z0];
  const off = (v, lo, hi) => (v <= lo + 0.01 ? 3.5 : v >= hi - 0.01 ? -3.5 : 0);
  const cx = Math.min(r.x1 - 2, Math.max(r.x0 + 2, dx + off(dx, r.x0, r.x1) + (off(dz, r.z0, r.z1) ? 3 : 0)));
  const cz = Math.min(r.z1 - 2, Math.max(r.z0 + 2, dz + off(dz, r.z0, r.z1) + (off(dx, r.x0, r.x1) ? 3 : 0)));
  if (plan.inside(cx, cz)) {
    const d = K.box({ cx, cz, hx: 1.6, hz: 0.45, yaw: 0, y0: y, y1: y + 1.05 }, { mat: 'wood', hp: 160, look: '#6b4a32', role: 'prop' });
    for (const u of [-0.8, 0.6]) K.decor({ cx: cx + u, cz, hx: 0.25, hz: 0.04, yaw: 0, y0: y + 1.05, y1: y + 1.4 }, '#1d1f22', { dep: d });
  }
  const spots = cells(r, 6, 6, ok, 0.5, 0.5);
  for (const [x, z] of [spots[0], spots[spots.length - 1]].filter(Boolean)) K.loot({ kind: rnd() < 0.3 ? 'chest' : 'item', x: x + 1.3, z, y });
}

/** Study lounge / nook: sofa groups around low tables, cafe tables, plants, a chest. */
function lounge(K, r, y, rnd, plan) {
  const ok = placer(plan, r, 0.6, 1.8);
  let i = 0;
  const spots = cells(r, 5.2, 4.8, ok, 1.6, 1.4);
  for (const [x, z] of spots) {
    if (i % 3 === 2) table(K, x, z, 0.9, 0.9, y, '#d8d3c8');
    else {
      const c = SOFT[(i + Math.floor(rnd() * 3)) % SOFT.length];
      const c2 = SOFT[(i + 2) % SOFT.length];
      const so = K.box({ cx: x, cz: z - 1.0, hx: 1.0, hz: 0.42, yaw: 0, y0: y, y1: y + 0.45 }, { mat: 'wood', hp: 100, look: c, role: 'prop' });
      K.decor({ cx: x, cz: z - 1.32, hx: 1.0, hz: 0.1, yaw: 0, y0: y + 0.45, y1: y + 0.85 }, c, { dep: so });
      for (const sx of [-1, 1]) K.decor({ cx: x + sx * 0.92, cz: z - 1.0, hx: 0.1, hz: 0.42, yaw: 0, y0: y + 0.45, y1: y + 0.65 }, c, { dep: so });
      for (const sx of [-1, 1]) {
        K.decor({ cx: x + sx * 1.15, cz: z + 0.7, hx: 0.38, hz: 0.38, yaw: 0, y0: y, y1: y + 0.42 }, c2);
        K.decor({ cx: x + sx * 1.15, cz: z + 1.02, hx: 0.38, hz: 0.08, yaw: 0, y0: y + 0.42, y1: y + 0.8 }, c2);
      }
      const t = K.box({ cx: x, cz: z, hx: 0.6, hz: 0.35, yaw: 0, y0: y, y1: y + 0.4 }, { mat: 'wood', hp: 80, look: '#c9a676', role: 'prop' });
      if (rnd() < 0.5) K.decor({ cx: x + 0.2, cz: z, hx: 0.15, hz: 0.11, yaw: 0.3, y0: y + 0.4, y1: y + 0.44 }, BOOKS[i % BOOKS.length], { dep: t });
    }
    if (rnd() < 0.5 && ok(x + 2.1, z + 1.8, 0.3, 0.3)) plant(K, x + 2.1, z + 1.8, y, rnd);
    i++;
  }
  if (spots.length) K.loot({ kind: rnd() < 0.3 ? 'chest' : rnd() < 0.5 ? 'ammoBox' : 'item', x: spots[0][0], z: spots[0][1] + 1.9, y });
}

/** Lecture hall: rows of seats facing a screen and lectern on the south wall. */
function lecture(K, r, y, rnd, plan) {
  const ok = placer(plan, r, 0.5, 1.5);
  const front = r.z1 - 0.2;
  const sx0 = r.x0 + 1.4;
  K.decor({ cx: r.x0 + 6, cz: front - 0.05, hx: 4, hz: 0.04, yaw: 0, y0: y + 1.2, y1: y + 4.0 }, '#f1f0ea');
  K.box({ cx: r.x0 + 12, cz: front - 1.6, hx: 0.4, hz: 0.35, yaw: 0, y0: y, y1: y + 1.1 }, { mat: 'wood', hp: 120, look: '#6b4a32', role: 'prop' });
  let k = 0;
  for (let z = front - 4.2; z > r.z0 + 1; z -= 1.2) {
    let x1 = sx0;
    while (x1 < r.x1 - 1 && ok(x1 + 0.3, z, 0.3, 0.3)) x1 += 0.6;
    if (x1 - sx0 < 1.8) continue;
    const len = x1 - sx0;
    const row = K.box({ cx: sx0 + len / 2, cz: z, hx: len / 2, hz: 0.25, yaw: 0, y0: y, y1: y + 0.45 }, { mat: 'wood', hp: 140, look: '#2b3036', role: 'prop' });
    for (let x = sx0 + 0.3; x < x1 - 0.1; x += 0.6) {
      K.decor({ cx: x, cz: z - 0.25, hx: 0.26, hz: 0.05, yaw: 0, y0: y + 0.45, y1: y + 0.95 }, '#7a2e2a', { dep: row });
      K.decor({ cx: x, cz: z + 0.02, hx: 0.24, hz: 0.22, yaw: 0, y0: y + 0.45, y1: y + 0.5 }, '#7a2e2a', { dep: row });
    }
    if (k++ % 5 === 2) K.loot({ kind: rnd() < 0.3 ? 'chest' : 'item', x: sx0 + len / 2, z: z + 0.65, y });
  }
}

/** Weight room (racks, benches, dumbbells, mirror) or wrestling room (mats, wall pads). */
function gymRoom(K, r, y, rnd, plan) {
  const cx = (r.x0 + r.x1) / 2;
  const cz = (r.z0 + r.z1) / 2;
  if (/Wrestl/.test(r.label)) {
    const hx = (r.x1 - r.x0) / 2 - 0.8;
    const hz = (r.z1 - r.z0) / 2 - 2.4;
    K.decor({ cx, cz, hx, hz, yaw: 0, y0: y + 0.04, y1: y + 0.1 }, '#7a2e2a');
    const rr = Math.min(hx, hz / 2) - 0.6;
    for (const dz of [-hz / 2, hz / 2]) {
      K.decor({ cx, cz: cz + dz, hx: rr, hz: rr, yaw: 0, y0: y + 0.1, y1: y + 0.11 }, '#d8d3c8', { shape: 'cyl' });
      K.decor({ cx, cz: cz + dz, hx: rr - 0.15, hz: rr - 0.15, yaw: 0, y0: y + 0.11, y1: y + 0.115 }, '#7a2e2a', { shape: 'cyl' });
    }
    for (const x of [r.x0 + 0.25, r.x1 - 0.25]) K.box({ cx: x, cz, hx: 0.1, hz: (r.z1 - r.z0) / 2 - 3, yaw: 0, y0: y + 0.3, y1: y + 2.1 }, { mat: 'wood', hp: 120, look: '#2b3036', role: 'prop' });
    K.loot({ kind: rnd() < 0.3 ? 'chest' : rnd() < 0.5 ? 'ammoBox' : 'item', x: cx, z: r.z0 + 1.2, y });
    return;
  }
  const ok = placer(plan, r, 1.0, 1.8);
  let i = 0;
  for (const [x, z] of cells(r, 3.6, 4.0, ok, 1.3, 1.4)) {
    if (x > r.x1 - 2.2) continue; // the dumbbell wall
    const rack = K.box({ cx: x, cz: z - 0.9, hx: 1.1, hz: 0.25, yaw: 0, y0: y, y1: y + 1.9 }, { mat: 'metal', hp: 220, look: '#2b3036', role: 'prop' });
    K.decor({ cx: x, cz: z - 0.7, hx: 1.25, hz: 0.025, yaw: 0, y0: y + 1.38, y1: y + 1.43 }, '#b9bcbe', { dep: rack });
    for (const s of [-1, 1]) K.decor({ cx: x + s * 1.05, cz: z - 0.7, hx: 0.22, hz: 0.06, yaw: 0, y0: y + 1.18, y1: y + 1.63 }, '#1b1b1d', { dep: rack });
    if (i++ % 2 === 0) K.decor({ cx: x, cz: z + 0.25, hx: 0.25, hz: 0.75, yaw: 0, y0: y, y1: y + 0.45 }, '#7a2e2a');
  }
  const hz = Math.max(1, Math.min(6, (r.z1 - r.z0) / 2 - 3));
  const dr = K.box({ cx: r.x1 - 0.6, cz, hx: 0.35, hz, yaw: 0, y0: y, y1: y + 0.9 }, { mat: 'metal', hp: 220, look: '#4a4c50', role: 'prop' });
  for (let k = 0; k < Math.floor(hz * 2.5); k++) K.decor({ cx: r.x1 - 0.6, cz: cz - hz + 0.3 + k * 0.4, hx: 0.18, hz: 0.08, yaw: 0, y0: y + 0.9, y1: y + 1.02 }, '#1b1b1d', { dep: dr });
  K.decor({ cx: r.x0 + 0.13, cz, hx: 0.02, hz: Math.max(1, (r.z1 - r.z0) / 2 - 3), yaw: 0, y0: y + 0.4, y1: y + 2.3 }, '#cfdde0');
  K.loot({ kind: rnd() < 0.3 ? 'chest' : rnd() < 0.5 ? 'ammoBox' : 'item', x: cx, z: r.z1 - 1.4, y });
}

/** Locker room: locker banks on both long walls, benches down the middle, a shower-partition end. */
function lockerRoom(K, r, y, rnd) {
  const along = r.x1 - r.x0 >= r.z1 - r.z0;
  const lo = along ? r.x0 : r.z0;
  const L = along ? r.x1 - r.x0 : r.z1 - r.z0;
  const W = along ? r.z1 - r.z0 : r.x1 - r.x0;
  const c = LOCKER_COLOURS[hash(r.id) % LOCKER_COLOURS.length];
  const gaps = doorPoints(r).map(([x, z]) => {
    const t = along ? x : z;
    return [t - 1.4, t + 1.4];
  });
  for (const side of [0, 1]) {
    const line = along ? (side ? r.z1 : r.z0) : side ? r.x1 : r.x0;
    lockers(K, { along, line, a0: lo + 0.8, a1: lo + L - 4, gaps, inward: side ? -1 : 1 }, y, c);
  }
  const mid = along ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
  for (let t = lo + 2.4; t < lo + L - 6; t += 3) {
    const b = along ? { cx: t + 1, cz: mid, hx: 1.1, hz: 0.18 } : { cx: mid, cz: t + 1, hx: 0.18, hz: 1.1 };
    K.box({ ...b, yaw: 0, y0: y + 0.38, y1: y + 0.45 }, { mat: 'wood', hp: 80, look: '#c9a676', role: 'prop' });
  }
  const e = lo + L - 2.2;
  for (let k = 0; k < 4; k++) {
    const u = (along ? r.z0 : r.x0) + 1.2 + k * ((W - 2.4) / 3);
    K.decor(along ? { cx: e, cz: u, hx: 1.0, hz: 0.04, yaw: 0, y0: y, y1: y + 2.0 } : { cx: u, cz: e, hx: 0.04, hz: 1.0, yaw: 0, y0: y, y1: y + 2.0 }, '#cfdde0');
  }
  K.loot({ kind: rnd() < 0.3 ? 'chest' : rnd() < 0.5 ? 'ammoBox' : 'item', x: along ? lo + L / 2 : mid + 1.2, z: along ? mid + 1.2 : lo + L / 2, y });
}

/** Kitchen: stainless prep tables, a cook line under a hood, a walk-in cooler. */
function kitchen(K, r, y, rnd, plan) {
  const ok = placer(plan, r, 2.0, 2.4);
  for (const [x, z] of cells(r, 5, 4.6, ok, 1.8, 0.6)) {
    const t = K.box({ cx: x, cz: z, hx: 1.6, hz: 0.5, yaw: 0, y0: y, y1: y + 0.92 }, { mat: 'metal', hp: 260, look: '#b9bcbe', role: 'prop' });
    K.decor({ cx: x, cz: z, hx: 1.5, hz: 0.42, yaw: 0, y0: y + 0.25, y1: y + 0.27 }, '#8d9196', { dep: t });
    if (rnd() < 0.6) K.decor({ cx: x - 0.6 + rnd(), cz: z, hx: 0.22, hz: 0.18, yaw: 0, y0: y + 0.92, y1: y + 1.1 }, '#d8d3c8', { dep: t, shape: 'cyl' });
  }
  const lz = (r.z0 + r.z1) / 2 - 4;
  const hz = Math.min(5, (r.z1 - r.z0) / 2 - 5);
  const line = K.box({ cx: r.x0 + 0.55, cz: lz, hx: 0.45, hz, yaw: 0, y0: y, y1: y + 0.95 }, { mat: 'metal', hp: 300, look: '#4a4c50', role: 'prop' });
  K.decor({ cx: r.x0 + 0.6, cz: lz, hx: 0.6, hz, yaw: 0, y0: y + 2.1, y1: y + 2.7 }, '#b9bcbe', { dep: line });
  for (let k = 0; k < 4; k++) K.decor({ cx: r.x0 + 0.55, cz: lz - hz + 1.2 + k * ((2 * hz - 2.4) / 3), hx: 0.22, hz: 0.22, yaw: 0, y0: y + 0.95, y1: y + 0.98 }, '#1b1b1d', { dep: line, shape: 'cyl' });
  K.box({ cx: r.x1 - 3.0, cz: r.z0 + 2.0, hx: 1.8, hz: 1.6, yaw: 0, y0: y, y1: y + 2.6 }, { mat: 'metal', hp: 300, look: '#d9d7d2', role: 'prop' });
  K.loot({ kind: rnd() < 0.3 ? 'chest' : rnd() < 0.5 ? 'ammoBox' : 'item', x: r.x1 - 3.0, z: r.z0 + 4.4, y });
  K.loot({ kind: 'ammoBox', x: (r.x0 + r.x1) / 2, z: r.z1 - 1.2, y });
}

/** Bigger offices also get a meeting table, a bookcase and a plant. */
function officeExtras(K, r, y, rnd, plan) {
  const ok = placer(plan, r, 1.0, 2.0);
  const spots = cells(r, 5.5, 4.5, ok, 1.4, 0.9);
  if (spots.length > 2) {
    const [x, z] = spots[Math.floor(spots.length / 2)];
    table(K, x, z, 1.3, 0.6, y, '#c9a676');
  }
  if (spots.length > 4) bookcase(K, spots[0][0], spots[0][1], 2.6, true, y, rnd, 1.9);
  if (spots.length > 1 && rnd() < 0.7) plant(K, spots[spots.length - 1][0] + 1.2, spots[spots.length - 1][1], y, rnd);
}

export function dressFill(K, plans) {
  for (const plan of plans) {
    const rooms = plan.rooms;
    for (const r of rooms) {
      const y = plan.levelY(r.level);
      K.setGroup(`int:${plan.name}:${r.level}`);
      const rnd = rng(hash(r.id));
      if (r.kind === 'corridor') {
        const colour = LOCKER_COLOURS[hash(plan.name + r.level) % LOCKER_COLOURS.length];
        for (const run of edgeRuns(r, rooms, plan)) if (['classroom', 'lab'].includes(run.room.kind)) lockers(K, run, y, colour);
        // a clock and an exit-style door frame light at the ends of long corridors (blank signs)
        const len = Math.max(r.x1 - r.x0, r.z1 - r.z0);
        if (len > 30) K.light({ x: (r.x0 + r.x1) / 2, y: y + 3, z: (r.z0 + r.z1) / 2, range: len / 2, intensity: 0.7 });
        // loot along the hallway: every ~36 m against a wall, mostly ammo / floor loot
        const along = r.x1 - r.x0 >= r.z1 - r.z0;
        for (let s = 8; s < len - 4; s += 36) {
          const k = rnd();
          const kind = k < 0.3 ? 'chest' : k < 0.7 ? 'ammoBox' : 'item';
          const x = along ? r.x0 + s : r.x0 + 0.45;
          const z = along ? r.z0 + 0.45 : r.z0 + s;
          K.loot({ kind, x, z, y, yaw: along ? 0 : Math.PI / 2 });
        }
      } else if (r.kind === 'office') {
        office(K, r, y, rnd);
        if ((r.x1 - r.x0) * (r.z1 - r.z0) > 120) officeExtras(K, r, y, rnd, plan);
      } else if (r.hero) continue;
      else if (r.kind === 'library') library(K, r, y, rnd, plan);
      else if (r.kind === 'lounge') lounge(K, r, y, rnd, plan);
      else if (r.kind === 'auditorium') lecture(K, r, y, rnd, plan);
      else if (r.kind === 'gym') gymRoom(K, r, y, rnd, plan);
      else if (r.kind === 'locker') lockerRoom(K, r, y, rnd, plan);
      else if (r.kind === 'kitchen') kitchen(K, r, y, rnd, plan);
      else if (r.kind === 'lobby') {
        // entrance lobbies: benches and planters, clear of the doors and the walking line
        const ok = placer(plan, r, 0.5, 2.6);
        for (const [x, z] of cells(r, 4.5, 4.5, ok, 1.0, 0.6).filter((_, i) => i % 2 === 0)) {
          K.box({ cx: x, cz: z, hx: 0.9, hz: 0.22, yaw: 0, y0: y + 0.4, y1: y + 0.46 }, { mat: 'wood', hp: 80, look: '#c9a676', role: 'prop' });
          for (const s of [-1, 1]) K.decor({ cx: x + s * 0.7, cz: z, hx: 0.04, hz: 0.2, yaw: 0, y0: y, y1: y + 0.4 }, '#2b3036');
          if (ok(x + 1.6, z, 0.3, 0.3)) plant(K, x + 1.6, z, y, rnd);
        }
      }
      else if (r.kind === 'restroom') {
        restroom(K, r, y);
        if (rnd() < 0.5) K.loot({ kind: 'item', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y });
      } else if (r.kind === 'stair' && rnd() < 0.35) {
        // a chest on the stairwell's landing: the first inset corner that is floor at this level
        for (const [x, z] of [[r.x0 + 0.8, r.z0 + 0.8], [r.x1 - 0.8, r.z0 + 0.8], [r.x0 + 0.8, r.z1 - 0.8], [r.x1 - 0.8, r.z1 - 0.8]]) {
          if (Math.abs(K.world.groundHeight(x, z, y + 0.3) - y) < 0.06) {
            K.loot({ kind: 'chest', x, z, y });
            break;
          }
        }
      }
      else if (r.kind === 'storage') storage(K, r, y, rnd);
    }
  }
}

// ------------------------------------------------------------------ ground-floor gaps

const GAP_FLOOR = { auditorium: 'carpet', stage: 'woodFloor', gym: 'woodFloor', library: 'carpet' };
const topShows = (p) => !p.faces || !('top' in p.faces) || (p.faces.top && p.faces.top !== 'none');

/**
 * QA (user: "a bit of floor that turns into grass inside the south building"): the ground floor is
 * per-room finish strips, so any patch of the outline that no room (or hero builder) floors shows the
 * map's grass. Run after every builder: scan the outline on a 0.5 m grid and lay a finish strip, the
 * room's floor (or vinyl), wherever nothing floors or stands on the ground. Drawn just under the room
 * strips so the overlap at their edges cannot z-fight. Pure decor (no colliders, box ids unchanged).
 */
export function fillGroundGaps(K, plans) {
  const STEP = 0.25; // fine enough for the saw-tooth slivers the 0.6 m strips leave along angled walls
  const B = 2;
  for (const plan of plans) {
    const y = plan.levelY(0);
    const idx = new Map();
    const add = (p) => {
      const r = Math.hypot(p.hx, p.hz);
      for (let i = Math.floor((p.cx - r) / B); i <= Math.floor((p.cx + r) / B); i++)
        for (let k = Math.floor((p.cz - r) / B); k <= Math.floor((p.cz + r) / B); k++) {
          const key = i + ',' + k;
          if (!idx.has(key)) idx.set(key, []);
          idx.get(key).push(p);
        }
    };
    for (const p of K.decors) if (p.y1 > y + 0.005 && p.y1 < y + 0.6 && p.hx * p.hz > 0.01 && topShows(p)) add(p);
    for (const p of K.parts) if ((p.y1 > y + 0.005 && p.y1 < y + 0.6 && topShows(p)) || (p.y0 < y + 0.3 && p.y1 > y + 0.5)) add(p);
    const covered = (x, z) =>
      (idx.get(Math.floor(x / B) + ',' + Math.floor(z / B)) || []).some((p) => {
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        const dx = x - p.cx;
        const dz = z - p.cz;
        return Math.abs(dx * c + dz * s) <= p.hx && Math.abs(-dx * s + dz * c) <= p.hz;
      });
    /** One piece covers the whole cell (the common case inside hero rooms with one big floor). */
    const coveredCell = (x, z) =>
      (idx.get(Math.floor(x / B) + ',' + Math.floor(z / B)) || []).some((p) => {
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        const dx = x - p.cx;
        const dz = z - p.cz;
        const m = STEP * 0.71;
        return Math.abs(dx * c + dz * s) <= p.hx - m && Math.abs(-dx * s + dz * c) <= p.hz - m;
      });
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const r of plan.rooms) {
      x0 = Math.min(x0, r.x0);
      x1 = Math.max(x1, r.x1);
      z0 = Math.min(z0, r.z0);
      z1 = Math.max(z1, r.z1);
    }
    x0 = Math.floor(x0 - 8);
    z0 = Math.floor(z0 - 8);
    // runs per row: [x0, x1, look]
    let prev = [];
    const out = [];
    for (let z = z0; z < z1 + 8; z += STEP) {
      const row = [];
      let run = null;
      // fast path: x-spans at least 1 m inside the outline over z +- 1, and the floored rooms on this row
      const pz0 = z + STEP / 2;
      let safe = scan(plan.outline, pz0 - 1);
      for (const dz of [-0.5, 0, 0.5, 1]) {
        const B2 = scan(plan.outline, pz0 + dz);
        safe = safe.flatMap(([a0, a1]) => B2.map(([b0, b1]) => [Math.max(a0, b0), Math.min(a1, b1)])).filter(([a0, a1]) => a1 > a0);
      }
      safe = safe.map(([a0, a1]) => [a0 + 1, a1 - 1]).filter(([a0, a1]) => a1 > a0);
      // the outline's spans on this row (with a margin for the cell's samples): cells off them are outside
      const span = [...scan(plan.outline, pz0 - 0.13), ...scan(plan.outline, pz0 + 0.13)].map(([a0, a1]) => [a0 - 0.2, a1 + 0.2]);
      const floored = plan.rooms.filter((r) => r.level === 0 && r.floor && r.floor !== 'none' && pz0 > r.z0 + 0.8 && pz0 < r.z1 - 0.8);
      if (!span.length) {
        prev = [];
        continue;
      }
      const xa = x0 + Math.max(0, Math.floor((Math.min(...span.map((q) => q[0])) - x0) / STEP) - 1) * STEP;
      const xb = Math.max(...span.map((q) => q[1])) + STEP;
      for (let x = xa; x < xb; x += STEP) {
        const px = x + STEP / 2;
        const pz = z + STEP / 2;
        let look = null;
        // a cell is bare when its centre or any corner (inset 1 cm) is: walls leave thin slivers
        const near = span.some(([a0, a1]) => px > a0 && px < a1);
        const easy = !near || safe.some(([a0, a1]) => px > a0 && px < a1) && floored.some((r) => px > r.x0 + 0.8 && px < r.x1 - 0.8);
        const bare = !easy && !coveredCell(px, pz) && [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([a, b]) => !covered(px + a * 0.115, pz + b * 0.115) && plan.inside(px + a * 0.115, pz + b * 0.115));
        if (bare) {
          const r = plan.roomAt(px, pz, 0);
          look = (r && r.floor && r.floor !== 'none' && r.floor) || (r && GAP_FLOOR[r.kind]) || 'vct';
        }
        if (run && (look !== run.look || !look)) {
          row.push(run);
          run = null;
        }
        if (look && !run) run = { x0: x, x1: x + STEP, z0: z, z1: z + STEP, look };
        else if (run) run.x1 = x + STEP;
      }
      if (run) row.push(run);
      // merge with the identical run of the row above
      for (const r of row) {
        const m = prev.find((q) => q.x0 === r.x0 && q.x1 === r.x1 && q.look === r.look && q.z1 === r.z0);
        if (m) {
          m.z1 = r.z1;
          r.merged = m;
        } else out.push(r);
      }
      prev = row.map((r) => r.merged || r);
    }
    K.setGroup(`int:${plan.name}:0`);
    for (const r of out) K.decor({ cx: (r.x0 + r.x1) / 2, cz: (r.z0 + r.z1) / 2, hx: (r.x1 - r.x0) / 2 + 0.02, hz: (r.z1 - r.z0) / 2 + 0.02, yaw: 0, y0: y + 0.016, y1: y + 0.026 }, r.look, { faces: { top: r.look, pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
    plan.gapFloor = out.length;
  }
}
