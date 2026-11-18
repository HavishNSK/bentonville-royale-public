// BENTONVILLE ROYALE — breakable exterior walls above the ground storey and breakable roof tiles
// (pure, deterministic; see Interiors.js). Runs last in planInterior, after floorTiles.js.
//
// Upper outer panels (kind 'outer', level i >= 1): the outer wall of storey i, from the ceiling
// of storey i - 1 up to the ceiling of storey i, split per footprint edge into pieces at most
// BUILDING_WALL.panelW wide (no doors above the ground storey). Ground-storey outer panels are
// made by planInterior (split around the doors). Together they cover the whole outer wall from
// the floor to the interior ceiling of the top storey. The roof slab's edge above that (~0.35 m)
// stays: it is the roof rim.
//
// Roof tiles (kind 'roof'): the roof slab (top storey's ceiling -> building top) over the inner
// face polygon, cut into an even grid of tiles at most TILE m on a side. A cell is a tile only
// when it lies wholly inside the inner polygon; everything else (the wall band, notches of an
// irregular footprint) is the solid rim. A ceiling light hanging under a tile is drawn in the
// tile's panel range (plan.roofLights) so it goes when the tile breaks.
//
// plan.roof = { a0, b0, a1, b1, na, nb, ids } | null   (same grid shape as level.tiles entries;
//   floorTiles.tileIdAt({ tiles: [plan.roof] }, a, b) looks a tile up)
// plan.roofLights = Int32Array(plan.lights.length): roof tile panel id a light hangs under, or -1
// panel (kind 'roof') = { id, kind, level, a0, b0, a1, b1, y0, y1, mat, hp, maxHp, alive, x, z }

import { BUILDING_WALL } from '../../core/config.js';
import { q, inPoly, toLocal, toWorld } from './layout.js';

export const ROOF_TILE = 4; // max roof tile side (m)

/** Returns the plan with upper outer panels and roof tiles appended. top = absolute building top. */
export function addShellPanels(plan, bd, shell, top) {
  if (!plan || !plan.levels || !plan.levels.length) return plan;
  const F = plan.frame;
  const W = BUILDING_WALL;
  const mat = bd.mat === 'wood' || bd.mat === 'metal' || bd.mat === 'brick' ? bd.mat : 'brick';
  const panels = [...plan.panels];
  let hash = plan.hash;
  const mix = (v) => { hash = Math.imul(hash ^ (Math.round(v * 64) | 0), 0x01000193) >>> 0; };

  // ---- upper outer panels
  const P = [];
  for (const p of bd.p || []) P.push(p[0], p[1]);
  const n = P.length >> 1;
  for (let li = 1; li < plan.levels.length; li++) {
    const y0 = plan.levels[li - 1].ceil;
    const y1 = plan.levels[li].ceil;
    if (!(y1 > y0 + 0.1)) continue;
    for (let e = 0; e < n; e++) {
      const k = (e + 1) % n;
      const ax = P[e * 2], az = P[e * 2 + 1];
      const ex = P[k * 2] - ax, ez = P[k * 2 + 1] - az;
      const l = Math.sqrt(ex * ex + ez * ez);
      if (l < 1e-4) continue;
      const cnt = Math.max(1, Math.ceil(l / W.panelW - 1e-6));
      for (let j = 0; j < cnt; j++) {
        const f0 = j / cnt;
        const f1 = j === cnt - 1 ? 1 : (j + 1) / cnt;
        const fm = (f0 + f1) / 2;
        const hp = W.hp[mat];
        panels.push({ id: panels.length, kind: 'outer', level: li, e, f0, f1, y0, y1, mat, hp, maxHp: hp, alive: true, x: ax + ex * fm, z: az + ez * fm });
        mix(li); mix(e); mix(f0); mix(f1);
      }
    }
  }

  // ---- roof tiles over the inner polygon
  const topL = plan.levels[plan.levels.length - 1];
  const y0 = topL.ceil;
  const y1 = Number.isFinite(top) ? top : y0 + 0.35;
  let roof = null;
  const roofLights = new Int32Array((plan.lights || []).length).fill(-1);
  const poly = [];
  for (let i = 0; i < shell.inner.length; i += 2) poly.push(...toLocal(F, shell.inner[i], shell.inner[i + 1]));
  if (y1 > y0 + 0.02 && poly.length >= 6) {
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      a0 = Math.min(a0, poly[i]); a1 = Math.max(a1, poly[i]);
      b0 = Math.min(b0, poly[i + 1]); b1 = Math.max(b1, poly[i + 1]);
    }
    a0 = q(a0); b0 = q(b0); a1 = q(a1); b1 = q(b1);
    const na = Math.max(1, Math.ceil((a1 - a0) / ROOF_TILE - 1e-6));
    const nb = Math.max(1, Math.ceil((b1 - b0) / ROOF_TILE - 1e-6));
    const ids = new Int32Array(na * nb).fill(-1);
    const hp = W.roofHp;
    const rmat = mat === 'metal' ? 'metal' : mat === 'wood' ? 'wood' : 'brick';
    // a 1 cm inset for the inside test: cells are cut exactly at the inner face on rectangles
    const e = 0.01;
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
      const ta0 = q(a0 + ((a1 - a0) * i) / na), ta1 = q(a0 + ((a1 - a0) * (i + 1)) / na);
      const tb0 = q(b0 + ((b1 - b0) * j) / nb), tb1 = q(b0 + ((b1 - b0) * (j + 1)) / nb);
      if (ta1 - ta0 < 0.5 || tb1 - tb0 < 0.5) continue;
      const ma = (ta0 + ta1) / 2, mb = (tb0 + tb1) / 2;
      const pts = [[ta0 + e, tb0 + e], [ta1 - e, tb0 + e], [ta0 + e, tb1 - e], [ta1 - e, tb1 - e], [ma, tb0 + e], [ma, tb1 - e], [ta0 + e, mb], [ta1 - e, mb], [ma, mb]];
      if (!pts.every(([a, b]) => inPoly(poly, a, b))) continue;
      const [x, z] = toWorld(F, ma, mb);
      const id = panels.length;
      panels.push({ id, kind: 'roof', level: topL.i, a0: ta0, b0: tb0, a1: ta1, b1: tb1, y0, y1, mat: rmat, hp, maxHp: hp, alive: true, x, z });
      ids[i * nb + j] = id;
      mix(ta0); mix(tb0); mix(ta1); mix(tb1);
    }
    roof = { a0, b0, a1, b1, na, nb, ids };
    // ceiling lights of the top storey hang under the roof: each goes with the tile under its centre
    (plan.lights || []).forEach((lt, k) => {
      if (!lt || lt.level !== topL.i) return;
      const ca = (lt.a0 + lt.a1) / 2, cb = (lt.b0 + lt.b1) / 2;
      if (ca < a0 || ca >= a1 || cb < b0 || cb >= b1) return;
      const i = Math.min(na - 1, Math.floor(((ca - a0) / (a1 - a0)) * na));
      const j = Math.min(nb - 1, Math.floor(((cb - b0) / (b1 - b0)) * nb));
      roofLights[k] = ids[i * nb + j];
    });
  }
  return { ...plan, panels, roof, roofLights, hash };
}
