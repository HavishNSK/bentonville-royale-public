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
  const n = Math.max(1, Math.min(6, Math.floor(((r.x1 - r.x0) * (r.z1 - r.z0)) / 22)));
  for (let i = 0; i < n; i++) {
    const x = r.x0 + 2 + rnd() * Math.max(0.1, r.x1 - r.x0 - 4);
    const z = r.z0 + 2 + rnd() * Math.max(0.1, r.z1 - r.z0 - 4);
    const yaw = Math.floor(rnd() * 4) * (Math.PI / 2);
    const d = K.box({ cx: x, cz: z, hx: 0.8, hz: 0.4, yaw, y0: y, y1: y + 0.76 }, { mat: 'wood', hp: 120, look: hex(PAL.doorWood), role: 'prop' });
    K.decor({ cx: x, cz: z, hx: 0.25, hz: 0.04, yaw, y0: y + 0.76, y1: y + 1.15 }, '#1d1f22', { dep: d }); // monitor
    K.decor({ cx: x + Math.sin(yaw) * 0.7, cz: z - Math.cos(yaw) * 0.7, hx: 0.25, hz: 0.25, yaw, y0: y, y1: y + 0.95 }, '#2a2c30'); // task chair
  }
  K.box({ cx: r.x1 - 0.5, cz: r.z0 + 1, hx: 0.25, hz: 0.6, yaw: 0, y0: y, y1: y + 1.35 }, { mat: 'metal', hp: 200, look: '#8d9196', role: 'prop' }); // file cabinet
  K.loot({ kind: rnd() < 0.55 ? 'chest' : 'item', x: (r.x0 + r.x1) / 2, z: r.z1 - 0.9, y });
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
  K.loot({ kind: rnd() < 0.6 ? 'chest' : 'ammoBox', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y });
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
        // loot along the hallway [user: "lots of chests"]: every ~18 m against a wall, mostly chests
        const along = r.x1 - r.x0 >= r.z1 - r.z0;
        for (let s = 8; s < len - 4; s += 18) {
          const k = rnd();
          const kind = k < 0.6 ? 'chest' : k < 0.85 ? 'ammoBox' : 'item';
          const x = along ? r.x0 + s : r.x0 + 0.45;
          const z = along ? r.z0 + 0.45 : r.z0 + s;
          K.loot({ kind, x, z, y, yaw: along ? 0 : Math.PI / 2 });
        }
      } else if (r.kind === 'office') office(K, r, y, rnd);
      else if (r.kind === 'restroom') {
        restroom(K, r, y);
        if (rnd() < 0.5) K.loot({ kind: 'item', x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y });
      } else if (r.kind === 'stair' && rnd() < 0.7) {
        // a chest on the stairwell's landing: the first inset corner that is floor at this level
        for (const [x, z] of [[r.x0 + 0.8, r.z0 + 0.8], [r.x1 - 0.8, r.z0 + 0.8], [r.x0 + 0.8, r.z1 - 0.8], [r.x1 - 0.8, r.z1 - 0.8]]) {
          if (Math.abs(K.world.groundHeight(x, z, y + 0.3) - y) < 0.06) {
            K.loot({ kind: 'chest', x, z, y });
            break;
          }
        }
      }
      else if (r.kind === 'storage' || r.kind === 'locker') storage(K, r, y, rnd);
    }
  }
}
