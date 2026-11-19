// BENTONVILLE ROYALE — BHS classrooms: student seating layouts (approximate, typical US high school).
//
//   seatStudents(rc, Z, layout, style)   Z = { u0, u1, v0, v1 } (local metres, the student zone)
//
// Layouts: rows, pairs, pods, ushape, horseshoe, flex, tables, chevron. Desks are drawn per seat and
// collide per RUN (a row block, a pod, a table): light cover (wood, ~120 hp). Chairs are drawn only.

import { place, comboDesk, studentDesk, chair, stool, table, roundTable, couch, beanBag, monitor } from './props.js';
import { C, BAGS, pick } from './util.js';

export const LAYOUTS = Object.freeze(['rows', 'pairs', 'pods', 'ushape', 'horseshoe', 'flex', 'tables', 'chevron']);

/**
 * Seat units. fp = footprint [du0, du1, dv0, dv1] around the seat origin; col = collider [dv centre,
 * half depth, height]; draw(P, rc) draws one seat. The sitter faces -dv.
 */
export const UNITS = {
  combo: { half: 0.32, fp: [-0.34, 0.34, -0.6, 0.3], col: [-0.34, 0.24, 0.74], draw: (P, rc, dep) => comboDesk(P, rc.chairCol(), dep) },
  desk: {
    half: 0.34,
    fp: [-0.36, 0.36, -0.28, 0.82],
    col: [0, 0.27, 0.745],
    draw: (P, rc, dep) => {
      studentDesk(P, dep);
      chair(P.sub(0, 0.55), rc.chairCol(), null);
    },
  },
  standing: {
    half: 0.38,
    fp: [-0.4, 0.4, -0.3, 0.75],
    col: [0, 0.28, 1.05],
    draw: (P, rc, dep) => {
      P.dec(0, 0, 0.38, 0.28, 1.01, 1.05, C.woodLight, { dep });
      P.dec(-0.33, 0, 0.02, 0.24, 0, 1.01, C.charcoal, { dep });
      P.dec(0.33, 0, 0.02, 0.24, 0, 1.01, C.charcoal, { dep });
      P.dec(0, 0.2, 0.33, 0.015, 0.15, 0.2, C.charcoal, { dep });
      rc.tops.push({ u: P.u, v: P.v, a: P.a, hu: 0.32, hv: 0.22, h: 1.05 + P.y, dep });
      if (rc.rnd() < 0.6) stool(P.sub(0, 0.5), rc.chairCol(), null, 0.72);
    },
  },
  computer: {
    half: 0.4,
    fp: [-0.42, 0.42, -0.34, 0.85],
    col: [0, 0.32, 0.74],
    draw: (P, rc, dep) => {
      P.dec(0, 0, 0.4, 0.32, 0.705, 0.74, C.laminate, { dep });
      P.dec(0, -0.3, 0.4, 0.015, 0.3, 0.705, C.greyLight, { dep });
      monitor(P, 0.74, rc.rnd() < 0.35 ? C.screenLit : C.screen, dep);
      P.dec(0.3, -0.05, 0.08, 0.22, 0, 0.42, C.charcoal, { dep });
      rc.tops.push({ u: P.u, v: P.v, a: P.a, hu: 0.1, hv: 0.1, h: 0.74 + P.y, dep });
      chair(P.sub(0, 0.58), rc.chairCol(), null);
    },
  },
};

/**
 * A run of n seats along the unit's u axis, centred at (u, v), facing yaw a. Seats that do not fit
 * (door zone, outline, reserved) are dropped; each contiguous group gets one collider.
 */
export function seatRun(rc, u, v, a, n, pitch, unit, o = {}) {
  const U = UNITS[unit];
  const ok = [];
  for (let i = 0; i < n; i++) {
    const du = (i - (n - 1) / 2) * pitch;
    const [su, sv] = rc.at(u, v, a, du, 0);
    const fpu = (U.fp[0] + U.fp[1]) / 2;
    const fpv = (U.fp[2] + U.fp[3]) / 2;
    const [fu, fv] = rc.at(su, sv, a, fpu, fpv);
    ok.push(rc.fits(fu, fv, a, (U.fp[1] - U.fp[0]) / 2, (U.fp[3] - U.fp[2]) / 2, { pad: 0.05 }) ? [du, su, sv] : null);
  }
  let placed = 0;
  let i = 0;
  while (i < n) {
    if (!ok[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && ok[j + 1]) j++;
    const d0 = ok[i][0];
    const d1 = ok[j][0];
    const [cu, cv] = rc.at(u, v, a, (d0 + d1) / 2, U.col[0]);
    const hu = (d1 - d0) / 2 + U.half;
    const dep = rc.part(cu, cv, a, hu, U.col[1], 0, U.col[2], { mat: 'wood', hp: o.hp || 120 });
    for (let k = i; k <= j; k++) {
      const [, su, sv] = ok[k];
      U.draw(place(rc, su, sv, a), rc, dep);
      const fpu = (U.fp[0] + U.fp[1]) / 2;
      const fpv = (U.fp[2] + U.fp[3]) / 2;
      const [fu, fv] = rc.at(su, sv, a, fpu, fpv);
      rc.reserve(fu, fv, a, (U.fp[1] - U.fp[0]) / 2, (U.fp[3] - U.fp[2]) / 2, 0.05);
      placed++;
    }
    i = j + 1;
  }
  return placed;
}

/** A table with chairs around it as one collider. kind: 'rect' (hu x hv) | 'round' (r = hu). */
export function tableGroup(rc, u, v, a, hu, hv, seats, o = {}) {
  const round = o.round;
  const pad = 0.62;
  if (!rc.fits(u, v, a, (round ? hu : hu) + pad, (round ? hu : hv) + pad, { pad: 0.05 })) return 0;
  rc.reserve(u, v, a, hu + pad, (round ? hu : hv) + pad, 0.05);
  const h = o.h || 0.74;
  const dep = rc.part(u, v, a, round ? hu * 0.8 : hu, round ? hu * 0.8 : hv, 0, h, { mat: 'wood', hp: o.hp || 120 });
  const P = place(rc, u, v, a);
  if (round) roundTable(P, hu, h, o.top || C.laminate, dep);
  else table(P, hu, hv, h, o.top || C.laminate, o.legs || C.steel, dep);
  for (const s of seats) {
    const S = P.sub(s[0], s[1], s[2]);
    if (o.stools) stool(S, rc.chairCol(), null, h > 0.9 ? 0.72 : 0.62);
    else chair(S, rc.chairCol(), null);
  }
  return seats.length;
}

/** Chairs around a rect table hu x hv: n per long side (sides along u), facing the table. */
export function sideSeats(hu, hv, n, ends = false) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const du = -hu + ((2 * hu) * (k + 0.5)) / n;
    out.push([du, -hv - 0.42, Math.PI]);
    out.push([du, hv + 0.42, 0]);
  }
  if (ends) {
    out.push([-hu - 0.42, 0, Math.PI / 2]);
    out.push([hu + 0.42, 0, -Math.PI / 2]);
  }
  return out;
}

/** Chairs around a round table (radius r), k seats. */
export function ringSeats(r, k, phase = 0) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const t = phase + (i / k) * Math.PI * 2;
    // seat centre r + 0.4 out, facing the table centre (sitter faces -dv => dv axis points outward)
    out.push([Math.cos(t) * (r + 0.4), Math.sin(t) * (r + 0.4), t - Math.PI / 2]);
  }
  return out;
}

// ------------------------------------------------------------------ the layouts

function rows(rc, Z, style) {
  const unit = style === 'combo' ? 'combo' : 'desk';
  const pitch = unit === 'combo' ? 0.95 : 0.82;
  const pv = unit === 'combo' ? 1.3 : 1.45;
  const zw = Z.u1 - Z.u0;
  const blocks = zw > 7.4 ? 3 : 2;
  const aisle = 1.05;
  const per = Math.max(1, Math.floor((zw - aisle * (blocks - 1)) / blocks / pitch));
  const bw = per * pitch;
  const total = blocks * bw + (blocks - 1) * aisle;
  const nRows = Math.max(2, Math.min(6, Math.floor((Z.v1 - Z.v0 - 0.3) / pv) + 1));
  const off = unit === 'combo' ? 0.62 : 0.3;
  let n = 0;
  for (let r = 0; r < nRows; r++) {
    const v = Z.v0 + off + r * pv;
    for (let b = 0; b < blocks; b++) {
      const uc = -total / 2 + bw / 2 + b * (bw + aisle) + (Z.u0 + Z.u1) / 2;
      n += seatRun(rc, uc, v, 0, per, pitch, unit);
    }
  }
  return n;
}

function chevron(rc, Z, style) {
  const unit = style === 'combo' ? 'combo' : 'desk';
  const pitch = unit === 'combo' ? 0.95 : 0.82;
  const pv = unit === 'combo' ? 1.35 : 1.5;
  const zw = Z.u1 - Z.u0;
  const per = Math.max(2, Math.floor((zw / 2 - 0.9) / pitch));
  const nRows = Math.max(2, Math.min(5, Math.floor((Z.v1 - Z.v0 - 0.6) / pv) + 1));
  const mid = (Z.u0 + Z.u1) / 2;
  let n = 0;
  for (let r = 0; r < nRows; r++) {
    const v = Z.v0 + 0.75 + r * pv;
    const half = (per * pitch) / 2;
    n += seatRun(rc, mid - 0.55 - half, v + 0.12, 0.3, per, pitch, unit);
    n += seatRun(rc, mid + 0.55 + half, v + 0.12, -0.3, per, pitch, unit);
  }
  return n;
}

function pairs(rc, Z) {
  const pu = 2.4;
  const pv = 1.55;
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.9) / pu));
  const rowsN = Math.max(2, Math.min(6, Math.floor((Z.v1 - Z.v0 - 0.4) / pv) + 1));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * pu) / 2;
  let n = 0;
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      const u = u0 + c * pu;
      const v = Z.v0 + 0.35 + r * pv;
      if (!rc.fits(u, v + 0.22, 0, 0.72, 0.62, { pad: 0.05 })) continue;
      rc.reserve(u, v + 0.22, 0, 0.72, 0.62, 0.05);
      const dep = rc.part(u, v, 0, 0.68, 0.3, 0, 0.74);
      const P = place(rc, u, v, 0);
      table(P, 0.68, 0.3, 0.74, rc.rnd() < 0.5 ? C.laminate : C.woodLight, C.steel, dep);
      chair(P.sub(-0.34, 0.6), rc.chairCol());
      chair(P.sub(0.34, 0.6), rc.chairCol());
      n += 2;
    }
  return n;
}

function pods(rc, Z) {
  const six = rc.rnd() < 0.4;
  const pu = six ? 3.3 : 2.7;
  const pv = 3.0;
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.4) / pu));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.4) / pv));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * pu) / 2;
  const v0 = (Z.v0 + Z.v1) / 2 - ((rowsN - 1) * pv) / 2;
  let n = 0;
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      const u = u0 + c * pu + (rc.rnd() - 0.5) * 0.2;
      const v = v0 + r * pv + (rc.rnd() - 0.5) * 0.2;
      const per = six ? 3 : 2;
      const hu = per * 0.36;
      if (!rc.fits(u, v, 0, hu + 0.05, 1.12, { pad: 0.05 })) continue;
      rc.reserve(u, v, 0, hu + 0.05, 1.12, 0.05);
      const dep = rc.part(u, v, 0, hu, 0.54, 0, 0.745);
      for (let k = 0; k < per; k++) {
        const du = -hu + 0.36 + k * 0.72;
        studentDesk(place(rc, ...rc.at(u, v, 0, du, -0.27), Math.PI), dep);
        studentDesk(place(rc, ...rc.at(u, v, 0, du, 0.27), 0), dep);
        chair(place(rc, ...rc.at(u, v, 0, du, -0.82), Math.PI), rc.chairCol());
        chair(place(rc, ...rc.at(u, v, 0, du, 0.82), 0), rc.chairCol());
        n += 2;
      }
    }
  return n;
}

function ushape(rc, Z) {
  const pitch = 0.78;
  let n = 0;
  const nv = Math.max(2, Math.floor((Z.v1 - Z.v0 - 1.2) / pitch));
  const vm = Z.v0 + 0.3 + (nv * pitch) / 2;
  // the two arms (desks face the middle) and the back row (faces the front)
  n += seatRun(rc, Z.u0 + 0.95, vm - 0.3, Math.PI / 2, nv, pitch, 'desk');
  n += seatRun(rc, Z.u1 - 0.95, vm - 0.3, -Math.PI / 2, nv, pitch, 'desk');
  const nb = Math.max(2, Math.floor((Z.u1 - Z.u0 - 3.4) / pitch));
  n += seatRun(rc, (Z.u0 + Z.u1) / 2, Z.v1 - 0.95, 0, nb, pitch, 'desk');
  // a second, inner U when the zone is big
  if (Z.u1 - Z.u0 > 7.5 && Z.v1 - Z.v0 > 6) {
    const ni = Math.max(2, nv - 3);
    n += seatRun(rc, Z.u0 + 2.6, vm - 0.7, Math.PI / 2, ni, pitch, 'desk');
    n += seatRun(rc, Z.u1 - 2.6, vm - 0.7, -Math.PI / 2, ni, pitch, 'desk');
  }
  return n;
}

function horseshoe(rc, Z) {
  const uc = (Z.u0 + Z.u1) / 2;
  const vc = (Z.v0 + Z.v1) / 2 + 0.2;
  const R = Math.max(2.2, Math.min((Z.u1 - Z.u0) / 2 - 0.5, (Z.v1 - Z.v0) / 2 + 0.6));
  let n = 0;
  const pairsN = Math.max(4, Math.floor((Math.PI * R * 1.15) / 1.7));
  for (let i = 0; i < pairsN; i++) {
    const phi = -0.32 + ((Math.PI + 0.64) * (i + 0.5)) / pairsN;
    const pu = uc + Math.cos(phi) * R;
    const pv = vc + Math.sin(phi) * R * 0.85;
    n += seatRun(rc, pu, pv, phi - Math.PI / 2, 2, 0.72, 'desk');
  }
  // the centre table
  if (rc.rnd() < 0.5) tableGroup(rc, uc, vc, 0, 0.55, 0.55, [], { round: true });
  else tableGroup(rc, uc, vc, 0, 1.0, 0.45, [], {});
  return n;
}

function tables(rc, Z) {
  const pu = 2.9;
  const pv = 2.7;
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.6) / pu));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.6) / pv));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * pu) / 2;
  const v0 = (Z.v0 + Z.v1) / 2 - ((rowsN - 1) * pv) / 2;
  const top = rc.rnd() < 0.5 ? C.woodLight : C.laminate;
  let n = 0;
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      // long axis along v (students sit side-on to the board), 2 per side
      const seats = sideSeats(0.85, 0.42, 2).map(([du, dv, a]) => [du, dv, a]);
      n += tableGroup(rc, u0 + c * pu, v0 + r * pv, Math.PI / 2, 0.85, 0.42, seats, { top });
    }
  return n;
}

function flex(rc, Z) {
  let n = 0;
  const um = (Z.u0 + Z.u1) / 2;
  const vm = (Z.v0 + Z.v1) / 2;
  const flip = rc.rnd() < 0.5 ? 1 : -1;
  // round tables with mixed chairs / stools
  const rt = [[um - flip * (Z.u1 - Z.u0) * 0.25, Z.v0 + 1.4], [um + flip * (Z.u1 - Z.u0) * 0.05, Z.v0 + 1.6]];
  for (const [u, v] of rt) n += tableGroup(rc, u, v, 0, 0.6, 0.6, ringSeats(0.6, 4, rc.rnd()), { round: true, stools: rc.rnd() < 0.4 });
  // a high-top with stools
  n += tableGroup(rc, um + flip * (Z.u1 - Z.u0) * 0.3, vm + 0.4, 0, 0.9, 0.35, sideSeats(0.9, 0.35, 2), { h: 1.0, stools: true, top: C.woodLight, legs: C.charcoal });
  // standing desks along the back of the zone
  n += seatRun(rc, um - flip * 0.6, Z.v1 - 0.5, 0, Math.max(2, Math.floor((Z.u1 - Z.u0) / 2 / 0.8)), 0.8, 'standing');
  // the couch corner: rug, couch, bean bags, low table
  const cu = um - flip * ((Z.u1 - Z.u0) / 2 - 1.4);
  const cv = vm + 0.6;
  if (rc.fits(cu, cv, 0, 1.4, 1.3, { pad: 0.05 })) {
    rc.reserve(cu, cv, 0, 1.4, 1.3, 0.05);
    rc.dec(cu, cv, 0, 1.35, 1.2, 0, 0.012, rc.accent.base);
    rc.dec(cu, cv, 0, 1.15, 1.0, 0.012, 0.016, rc.accent.light);
    const sofa = rc.part(cu, cv + 0.7, 0, 1.0, 0.4, 0, 0.6, { mat: 'wood', hp: 140 });
    couch(place(rc, cu, cv + 0.7, Math.PI), 1.0, rc.couchCol, sofa);
    beanBag(place(rc, cu - 0.8, cv - 0.6), pick(rc.rnd, BAGS));
    beanBag(place(rc, cu + 0.7, cv - 0.75), rc.accent.dark);
    table(place(rc, cu, cv, 0), 0.45, 0.28, 0.4, C.woodMid, C.woodDark);
    n += 5;
  }
  return n;
}

const FN = { rows, pairs, pods, ushape, horseshoe, flex, tables, chevron };

/** Seat the students in zone Z with the given layout; returns the number of seats. */
export function seatStudents(rc, Z, layout, style) {
  return (FN[layout] || rows)(rc, Z, style);
}

