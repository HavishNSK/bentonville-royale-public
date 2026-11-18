// BENTONVILLE ROYALE — Crystal Bridges operable entrance doors (pure; no three.js).
//
// The main colonnade stays an open doorway. South and library get two sliding glass
// leaves that start closed. Colliders toggle `passable` when the door opens; meshes.js
// slides the leaves to the parked-open positions.

import { ENTRANCES } from './nav.js';

const REACH = 3.2;

export function attachSiteDoors(world, site) {
  const doors = [];
  for (const e of ENTRANCES) {
    if (e.id === 'main') continue;
    const leaves = (site.parts || []).filter((p) => p.doorLeaf && p.entrance === e.id);
    if (!leaves.length) continue;
    const cx = leaves.reduce((s, p) => s + p.cx, 0) / leaves.length;
    const cz = leaves.reduce((s, p) => s + p.cz, 0) / leaves.length;
    doors.push({
      id: e.id,
      name: e.name,
      cx,
      cz,
      y0: Math.min(...leaves.map((p) => p.y0)),
      y1: Math.max(...leaves.map((p) => p.y1)),
      open: false,
      leaves,
    });
  }

  const find = (id) => doors.find((d) => d.id === id) || null;

  const setOpen = (id, open) => {
    const d = find(id);
    if (!d) return false;
    const next = !!open;
    if (d.open === next) return false;
    d.open = next;
    for (const p of d.leaves) {
      if (p.collider) p.collider.passable = next;
    }
    return true;
  };

  const heightOk = (d, pos) => pos.y >= d.y0 - 1.2 && pos.y <= d.y1 + 0.6;

  const api = {
    doors,
    near(pos, maxD = REACH) {
      if (!pos) return null;
      let best = null;
      let bestD = maxD;
      for (const d of doors) {
        if (!heightOk(d, pos)) continue;
        const dist = Math.hypot(d.cx - pos.x, d.cz - pos.z);
        if (dist >= bestD) continue;
        bestD = dist;
        best = d;
      }
      return best;
    },
    setOpen,
    toggle(id) {
      const d = find(id);
      return d ? api.setOpen(id, !d.open) : false;
    },
    openNear(pos, r = 4.5) {
      if (!pos) return 0;
      let n = 0;
      for (const d of doors) {
        if (d.open || !heightOk(d, pos)) continue;
        if (Math.hypot(d.cx - pos.x, d.cz - pos.z) > r) continue;
        if (setOpen(d.id, true)) n++;
      }
      return n;
    },
  };
  world.siteDoors = api;
  return api;
}
