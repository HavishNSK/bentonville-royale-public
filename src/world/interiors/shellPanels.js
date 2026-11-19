// BENTONVILLE ROYALE — breakable exterior walls above the ground storey, the walls over the
// outer doors and the roof (pure, deterministic; see Interiors.js). Runs last in planInterior,
// after floorTiles.js.
//
// Upper outer panels (kind 'outer', level i >= 1): the outer wall of storey i, from the ceiling
// of storey i - 1 up to the ceiling of storey i, split per footprint edge into pieces at most
// BUILDING_WALL.panelW wide (no doors above the ground storey). Ground-storey outer panels are
// made by planInterior (split around the doors). Together they cover the whole outer wall from
// the floor to the interior ceiling of the top storey.
//
// Outer door lintels (kind 'lintel', level 0, e / f0 / f1 like an outer panel): the wall over
// each exterior door, from the door top to the ground-storey ceiling, on the wall centre line
// (ax, az, bx, bz). The building's material and wall hp. World keeps shell.lintels (the
// collision capsules over the doors) to the alive ones.
//
// Roof tiles (kind 'roof'): the whole roof (top storey's ceiling -> building top, including the
// rim: the outer wall band above the ceiling) over the footprint, cut into an even grid of cells
// at most ROOF_TILE m on a side over the footprint's bounding box. A cell wholly inside the
// inner face polygon is a plain rectangular tile; a cell the footprint only partly covers is a
// clipped tile (clip: true; its shape is the cell clipped to the footprint, and it carries the
// rim's outer face along the footprint edges inside it). A sliver cell (< ROOF_SLIVER m^2 under
// the footprint) joins a neighbouring tile (its grid entry points at that tile's id), so every
// part of the roof is breakable. A ceiling light hanging under a tile is drawn in the tile's
// panel range (plan.roofLights) so it goes when the tile breaks.
//
// plan.roof = { a0, b0, a1, b1, na, nb, ids } | null   (same grid shape as level.tiles entries;
//   floorTiles.tileIdAt({ tiles: [plan.roof] }, a, b) looks a tile up)
// plan.roofLights = Int32Array(plan.lights.length): roof tile panel id a light hangs under, or -1
// panel (kind 'roof') = { id, kind, level, a0, b0, a1, b1, clip, y0, y1, mat, hp, maxHp, alive, x, z }
//   (a0..b1 = the grid cell; x, z = centre of the part under the footprint)

import { BUILDING_WALL } from '../../core/config.js';
import { q, inPoly, toLocal, toWorld, clipRect, polyArea } from './layout.js';

export const ROOF_TILE = 4; // max roof tile side (m)
export const ROOF_SLIVER = 0.5; // m^2: a roof cell with less footprint under it joins a neighbour

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

  // ---- the walls over the outer doors (door top -> ground ceiling), on the wall centre line
  const mid = shell.mid;
  const doorTop = shell.floor + shell.doorH;
  const groundCeil = plan.levels[0].ceil;
  if (mid && groundCeil > doorTop + 0.05) {
    for (const d of shell.doors || []) {
      const k = (d.e + 1) % n;
      const ax = mid[d.e * 2], az = mid[d.e * 2 + 1];
      const ex = mid[k * 2] - ax, ez = mid[k * 2 + 1] - az;
      const hp = W.hp[mat];
      panels.push({
        id: panels.length, kind: 'lintel', level: 0, e: d.e, f0: d.f0, f1: d.f1,
        ax: ax + ex * d.f0, az: az + ez * d.f0, bx: ax + ex * d.f1, bz: az + ez * d.f1,
        y0: doorTop, y1: groundCeil, mat, hp, maxHp: hp, alive: true, x: d.x, z: d.z,
      });
      mix(3); mix(d.e); mix(d.f0); mix(d.f1); mix(doorTop); mix(groundCeil);
    }
  }

  // ---- roof tiles over the whole footprint (rim included)
  const topL = plan.levels[plan.levels.length - 1];
  const y0 = topL.ceil;
  const y1 = Number.isFinite(top) ? top : y0 + 0.35;
  let roof = null;
  const roofLights = new Int32Array((plan.lights || []).length).fill(-1);
  const poly = [];
  for (let i = 0; i < shell.inner.length; i += 2) poly.push(...toLocal(F, shell.inner[i], shell.inner[i + 1]));
  const outer = [];
  for (let i = 0; i < P.length; i += 2) outer.push(...toLocal(F, P[i], P[i + 1]));
  if (y1 > y0 + 0.02 && poly.length >= 6 && outer.length >= 6) {
    // the grid of the inner face's bounding box (<= ROOF_TILE cells), extended by whole cells
    // of the same size until it covers the footprint (the wall band under the rim)
    let ia0 = Infinity, ib0 = Infinity, ia1 = -Infinity, ib1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      ia0 = Math.min(ia0, poly[i]); ia1 = Math.max(ia1, poly[i]);
      ib0 = Math.min(ib0, poly[i + 1]); ib1 = Math.max(ib1, poly[i + 1]);
    }
    ia0 = q(ia0); ib0 = q(ib0); ia1 = q(ia1); ib1 = q(ib1);
    let oa0 = Infinity, ob0 = Infinity, oa1 = -Infinity, ob1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      oa0 = Math.min(oa0, outer[i]); oa1 = Math.max(oa1, outer[i]);
      ob0 = Math.min(ob0, outer[i + 1]); ob1 = Math.max(ob1, outer[i + 1]);
    }
    const nai = Math.max(1, Math.ceil((ia1 - ia0) / ROOF_TILE - 1e-6));
    const nbi = Math.max(1, Math.ceil((ib1 - ib0) / ROOF_TILE - 1e-6));
    const sa = (ia1 - ia0) / nai, sb = (ib1 - ib0) / nbi;
    const ext = (lo, hi, s) => (s > 1e-6 && hi > lo + 1e-3 ? Math.ceil((hi - lo) / s - 1e-6) : 0);
    const ka0 = ext(oa0, ia0, sa), ka1 = ext(ia1, oa1, sa), kb0 = ext(ob0, ib0, sb), kb1 = ext(ib1, ob1, sb);
    const na = nai + ka0 + ka1, nb = nbi + kb0 + kb1;
    const a0 = q(ia0 - sa * ka0), a1 = q(ia1 + sa * ka1), b0 = q(ib0 - sb * kb0), b1 = q(ib1 + sb * kb1);
    const ids = new Int32Array(na * nb).fill(-1);
    const hp = W.roofHp;
    const rmat = mat === 'metal' ? 'metal' : mat === 'wood' ? 'wood' : 'brick';
    // a 1 cm inset for the inside test: cells are cut exactly at the inner face on rectangles
    const e = 0.01;
    const cells = []; // per cell: grid index, rect, footprint area under it, its centroid, full
    for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) {
      const ta0 = q(a0 + ((a1 - a0) * i) / na), ta1 = q(a0 + ((a1 - a0) * (i + 1)) / na);
      const tb0 = q(b0 + ((b1 - b0) * j) / nb), tb1 = q(b0 + ((b1 - b0) * (j + 1)) / nb);
      const ma = (ta0 + ta1) / 2, mb = (tb0 + tb1) / 2;
      const pts = [[ta0 + e, tb0 + e], [ta1 - e, tb0 + e], [ta0 + e, tb1 - e], [ta1 - e, tb1 - e], [ma, tb0 + e], [ma, tb1 - e], [ta0 + e, mb], [ta1 - e, mb], [ma, mb]];
      const full = ta1 - ta0 >= 0.5 && tb1 - tb0 >= 0.5 && pts.every(([a, b]) => inPoly(poly, a, b));
      // a border cell lies outside the inner face's grid (over the wall band only)
      const border = i < ka0 || i >= na - ka1 || j < kb0 || j >= nb - kb1;
      let area = (ta1 - ta0) * (tb1 - tb0);
      let ca = ma, cb = mb;
      if (!full) {
        const cp = clipRect(outer, ta0, tb0, ta1, tb1);
        area = cp.length >= 6 ? Math.abs(polyArea(cp)) : 0;
        if (area > 1e-6) {
          // area centroid of the clipped part (effects / blast distance aim at the real roof piece)
          let sA = 0, sx = 0, sz = 0;
          for (let k = 0, m = cp.length >> 1; k < m; k++) {
            const l = (k + 1) % m;
            const cr = cp[k * 2] * cp[l * 2 + 1] - cp[l * 2] * cp[k * 2 + 1];
            sA += cr; sx += (cp[k * 2] + cp[l * 2]) * cr; sz += (cp[k * 2 + 1] + cp[l * 2 + 1]) * cr;
          }
          if (Math.abs(sA) > 1e-9) { ca = sx / (3 * sA); cb = sz / (3 * sA); }
        }
      }
      cells.push({ i, j, ta0, tb0, ta1, tb1, area, ca, cb, full, border });
    }
    const cellAt = (i, j) => (i >= 0 && j >= 0 && i < na && j < nb ? cells[i * nb + j] : null);
    const own = (c) => {
      const [x, z] = toWorld(F, c.ca, c.cb);
      const id = panels.length;
      panels.push({ id, kind: 'roof', level: topL.i, a0: c.ta0, b0: c.tb0, a1: c.ta1, b1: c.tb1, clip: !c.full, y0, y1, mat: rmat, hp, maxHp: hp, alive: true, x, z });
      ids[c.i * nb + c.j] = id;
      mix(c.ta0); mix(c.tb0); mix(c.ta1); mix(c.tb1); mix(c.full ? 1 : 2);
    };
    // tiles: every cell of the inner grid with enough footprint under it
    for (const c of cells) if (!c.border && (c.full || c.area >= ROOF_SLIVER)) own(c);
    // the rest (border cells over the wall band, slivers) joins the neighbouring tile with the most
    // roof (border cells first, so the corners can then join them), else becomes a tile of its own
    const join = (c) => {
      let best = null;
      for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const o = cellAt(c.i + di, c.j + dj);
        if (!o || ids[o.i * nb + o.j] < 0) continue;
        if (!best || o.area > best.area) best = o;
      }
      if (best) ids[c.i * nb + c.j] = ids[best.i * nb + best.j];
      else own(c);
      mix(c.i); mix(c.j); mix(ids[c.i * nb + c.j]);
    };
    const rest = cells.filter((c) => ids[c.i * nb + c.j] < 0 && c.area >= 1e-4);
    for (let pass = 0; pass < 3; pass++) {
      for (const c of rest) {
        if (ids[c.i * nb + c.j] >= 0) continue;
        // pass 0: cells beside a tile of the inner grid; pass 1: corners beside those; pass 2: any left
        const hasNb = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => { const o = cellAt(c.i + di, c.j + dj); return o && ids[o.i * nb + o.j] >= 0; });
        if (pass < 2 && !hasNb) continue;
        join(c);
      }
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
