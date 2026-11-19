// BENTONVILLE ROYALE — BHS classrooms: furniture and small props (approximate, typical US high
// school; no photos). Props are drawn with K.decor in a small fixed colour set (util.js C / PAPER /
// BOOKS / BAGS, one merged mesh per look). Only real cover gets a collider (desks, tables, benches,
// shelves, cabinets); chairs, papers, plants and the like are drawn only.
//
// A placer P = place(rc, u, v, a) authors a prop in its own frame: du to the prop's right, dv to its
// back (a seated user faces -dv). y is relative to the room floor.

import { C, BOOKS, PAPER, pick, range } from './util.js';

export function place(rc, u, v, a = 0, y = 0) {
  const P = {
    rc,
    u,
    v,
    a,
    y,
    pt: (du, dv) => rc.at(u, v, a, du, dv),
    dec: (du, dv, hu, hv, y0, y1, look, o = {}) => {
      const [uu, vv] = P.pt(du, dv);
      return rc.dec(uu, vv, a + (o.a || 0), hu, hv, y0 + y, y1 + y, look, o);
    },
    cyl: (du, dv, r, y0, y1, look, o = {}) => {
      const [uu, vv] = P.pt(du, dv);
      return rc.cyl(uu, vv, r, y0 + y, y1 + y, look, o);
    },
    part: (du, dv, hu, hv, y0, y1, o = {}) => {
      const [uu, vv] = P.pt(du, dv);
      return rc.part(uu, vv, a + (o.a || 0), hu, hv, y0 + y, y1 + y, o);
    },
    sub: (du, dv, da = 0, dy = 0) => {
      const [uu, vv] = P.pt(du, dv);
      return place(rc, uu, vv, a + da, y + dy);
    },
  };
  return P;
}

// ------------------------------------------------------------------ seating

/** Stacking chair: plastic shell seat + back on a steel frame (sitter faces -dv). */
export function chair(P, col, dep = null) {
  P.dec(0, 0, 0.21, 0.2, 0.42, 0.46, col, { dep });
  P.dec(0, 0.2, 0.21, 0.022, 0.55, 0.86, col, { dep });
  P.dec(-0.19, 0, 0.012, 0.2, 0, 0.42, C.steel, { dep });
  P.dec(0.19, 0, 0.012, 0.2, 0, 0.42, C.steel, { dep });
  P.dec(0, 0.2, 0.17, 0.01, 0.44, 0.56, C.steel, { dep });
  P.rc.seats.push({ u: P.u, v: P.v, a: P.a, y: P.y, dep });
}

/** Combo desk-chair (sled base, desk top on the right arm, book rack under the seat). */
export function comboDesk(P, col, dep = null) {
  chair(P, col, dep);
  P.dec(0.06, -0.34, 0.3, 0.22, 0.71, 0.74, C.laminate, { dep });
  P.dec(0.24, -0.12, 0.012, 0.14, 0.46, 0.71, C.steel, { dep });
  P.dec(0, -0.02, 0.17, 0.16, 0.12, 0.15, C.steel, { dep });
  P.rc.tops.push({ ...pt3(P, 0.06, -0.34), hu: 0.26, hv: 0.18, h: 0.74 + P.y, dep });
}

/** Student desk (top, side frames, book box). Its user sits at dv = +0.55. */
export function studentDesk(P, dep = null, top = C.laminate) {
  P.dec(0, 0, 0.34, 0.26, 0.71, 0.745, top, { dep });
  P.dec(-0.3, 0, 0.014, 0.22, 0, 0.71, C.steel, { dep });
  P.dec(0.3, 0, 0.014, 0.22, 0, 0.71, C.steel, { dep });
  P.dec(0, 0.02, 0.28, 0.2, 0.57, 0.61, C.charcoal, { dep });
  P.rc.tops.push({ ...pt3(P, 0, 0), hu: 0.3, hv: 0.22, h: 0.745 + P.y, dep });
}

/** Lab / art stool. */
export function stool(P, col, dep = null, h = 0.66) {
  P.cyl(0, 0, 0.17, h - 0.05, h, col, { dep });
  P.cyl(0, 0, 0.025, 0, h - 0.05, C.steel, { dep });
  P.cyl(0, 0, 0.16, 0.18, 0.21, C.steel, { dep });
}

/** Rectangular table, top hu x hv at height h, four legs. */
export function table(P, hu, hv, h, top = C.laminate, legs = C.steel, dep = null) {
  P.dec(0, 0, hu, hv, h - 0.035, h, top, { dep });
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.dec(su * (hu - 0.06), sv * (hv - 0.06), 0.025, 0.025, 0, h - 0.035, legs, { dep });
  P.rc.tops.push({ ...pt3(P, 0, 0), hu: hu - 0.05, hv: hv - 0.05, h: h + P.y, dep });
}

/** Round table on a pedestal. */
export function roundTable(P, r, h, top = C.laminate, dep = null) {
  P.cyl(0, 0, r, h - 0.035, h, top, { dep });
  P.cyl(0, 0, 0.05, 0, h - 0.035, C.charcoal, { dep });
  P.cyl(0, 0, r * 0.45, 0, 0.04, C.charcoal, { dep });
  P.rc.tops.push({ ...pt3(P, 0, 0), hu: r * 0.6, hv: r * 0.6, h: h + P.y, dep });
}

/** Office task chair (five-star base drawn as a disc). */
export function taskChair(P, col, dep = null) {
  P.dec(0, 0, 0.25, 0.24, 0.46, 0.53, col, { dep });
  P.dec(0, 0.23, 0.23, 0.03, 0.6, 1.05, col, { dep });
  P.cyl(0, 0, 0.03, 0.1, 0.46, C.charcoal, { dep });
  P.cyl(0, 0, 0.3, 0.04, 0.09, C.charcoal, { dep });
  P.rc.seats.push({ u: P.u, v: P.v, a: P.a, y: P.y, dep, task: true });
}

/** Two- or three-seat couch (seat faces -dv). */
export function couch(P, hu, col, dep = null) {
  P.dec(0, 0, hu, 0.45, 0.1, 0.42, col, { dep });
  P.dec(0, 0.36, hu, 0.12, 0.42, 0.85, col, { dep });
  P.dec(-hu + 0.1, 0, 0.1, 0.45, 0.42, 0.62, col, { dep });
  P.dec(hu - 0.1, 0, 0.1, 0.45, 0.42, 0.62, col, { dep });
  const n = hu > 0.9 ? 3 : 2;
  for (let i = 0; i < n; i++) P.dec(-hu + 0.2 + ((2 * hu - 0.4) * (i + 0.5)) / n, -0.05, (hu - 0.2) / n - 0.02, 0.33, 0.42, 0.5, col, { dep });
  for (const s of [-1, 1]) P.dec(s * (hu - 0.15), 0, 0.03, 0.03, 0, 0.1, C.charcoal, { dep });
}

/** Bean bag. */
export function beanBag(P, col) {
  P.cyl(0, 0, 0.42, 0, 0.28, col);
  P.cyl(0, 0.08, 0.32, 0.28, 0.48, col);
}

// ------------------------------------------------------------------ storage

/**
 * Bookshelf against a wall (open face toward -dv, back at +dv). hu: half width, h: height. Books are
 * runs of coloured blocks with gaps (spines only, no titles).
 */
export function bookshelf(P, hu, h, carcass = C.woodLight, dep = null, fill = 0.8) {
  const rnd = P.rc.rnd;
  const d = 0.17;
  P.dec(0, d - 0.01, hu, 0.01, 0, h, carcass, { dep });
  P.dec(-hu + 0.015, 0, 0.015, d, 0, h, carcass, { dep });
  P.dec(hu - 0.015, 0, 0.015, d, 0, h, carcass, { dep });
  const n = Math.max(2, Math.round(h / 0.36));
  for (let k = 0; k <= n; k++) {
    const y = 0.06 + ((h - 0.08) * k) / n;
    P.dec(0, 0, hu - 0.03, d, y - 0.02, y, carcass, { dep });
    if (k === n) break;
    // a run of books on this shelf
    let s = -hu + 0.05;
    while (s < hu - 0.1) {
      const run = range(rnd, 0.12, 0.45);
      const e = Math.min(hu - 0.05, s + run);
      if (rnd() < fill) {
        const bh = range(rnd, 0.18, 0.28);
        P.dec((s + e) / 2, 0.02, (e - s) / 2, d - 0.04, y, y + bh, pick(rnd, BOOKS), { dep });
      }
      s = e + range(rnd, 0.02, 0.2);
    }
  }
}

/** Tall two-door storage closet (the classroom closet; loot sits in front of it). */
export function closet(P, hu, h, col, dep = null) {
  P.dec(0, 0, hu, 0.29, 0, h, col, { dep });
  P.dec(0, -0.295, 0.006, 0.006, 0.1, h - 0.05, C.charcoal, { dep });
  for (const s of [-1, 1]) P.dec(s * 0.08, -0.3, 0.012, 0.012, h * 0.45, h * 0.58, C.steel, { dep });
  P.dec(0, -0.3, hu, 0.006, 0, 0.1, C.charcoal, { dep });
}

/** Cubbies (a grid of open cells, some with coloured bins). */
export function cubbies(P, hu, rows, col, binCols, dep = null) {
  const rnd = P.rc.rnd;
  const h = rows * 0.32 + 0.06;
  const cols = Math.max(2, Math.round((hu * 2) / 0.34));
  const cw = (hu * 2) / cols;
  P.dec(0, 0.15, hu, 0.01, 0, h, col, { dep });
  for (let r = 0; r <= rows; r++) P.dec(0, 0, hu, 0.16, 0.03 + r * 0.32, 0.06 + r * 0.32, col, { dep });
  for (let c = 0; c <= cols; c++) P.dec(-hu + c * cw, 0, 0.012, 0.16, 0.03, h, col, { dep });
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.45) continue;
      P.dec(-hu + (c + 0.5) * cw, -0.01, cw / 2 - 0.03, 0.13, 0.06 + r * 0.32, 0.06 + r * 0.32 + 0.2, pick(rnd, binCols), { dep });
    }
}

/** Low cabinet / counter run (doors, top). top look: laminate / black lab top. */
export function counter(P, hu, h = 0.9, body = C.woodLight, top = C.laminate, dep = null, depth = 0.3) {
  P.dec(0, 0, hu, depth, 0.1, h - 0.04, body, { dep });
  P.dec(0, 0.02, hu, depth - 0.02, 0, 0.1, C.charcoal, { dep });
  P.dec(0, 0, hu + 0.02, depth + 0.02, h - 0.04, h, top, { dep });
  const n = Math.max(1, Math.round((hu * 2) / 0.6));
  for (let i = 1; i < n; i++) P.dec(-hu + (2 * hu * i) / n, -depth - 0.004, 0.005, 0.004, 0.14, h - 0.08, C.charcoal, { dep });
  P.rc.tops.push({ ...pt3(P, 0, 0), hu: hu - 0.05, hv: depth - 0.06, h: h + P.y, dep });
}

/** Four-drawer filing cabinet. */
export function filing(P, col = C.greyLight, dep = null) {
  P.dec(0, 0, 0.23, 0.32, 0, 1.32, col, { dep });
  for (let k = 0; k < 4; k++) P.dec(0, -0.325, 0.08, 0.008, 0.25 + k * 0.32, 0.29 + k * 0.32, C.steel, { dep });
}

/** Rolling cart (two shelves, castors) with a few boxes / bins. */
export function cart(P, col = C.charcoal) {
  const rnd = P.rc.rnd;
  for (const y of [0.16, 0.55, 0.92]) P.dec(0, 0, 0.42, 0.26, y, y + 0.03, col);
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    P.dec(su * 0.39, sv * 0.23, 0.015, 0.015, 0.06, 0.95, C.steel);
    P.cyl(su * 0.38, sv * 0.22, 0.04, 0, 0.08, C.black);
  }
  P.dec(-0.15, 0, 0.18, 0.18, 0.95, 1.12, pick(rnd, PAPER));
  P.dec(0.2, 0, 0.15, 0.16, 0.58, 0.8, pick(rnd, BOOKS));
}

/** Mini fridge (with a microwave on top in some rooms). */
export function miniFridge(P, microwave) {
  P.dec(0, 0, 0.25, 0.25, 0, 0.86, C.white);
  P.dec(0.18, -0.255, 0.012, 0.01, 0.4, 0.75, C.greyLight);
  if (microwave) {
    P.dec(0, 0, 0.25, 0.2, 0.86, 1.15, C.charcoal);
    P.dec(-0.05, -0.205, 0.16, 0.004, 0.9, 1.11, C.screen);
  }
}

/** Trash can (grey) and recycling bin (blue). */
export function bins(P) {
  P.cyl(-0.22, 0, 0.18, 0, 0.55, C.grey);
  P.dec(0.22, 0, 0.2, 0.17, 0, 0.6, C.recycle);
  P.dec(0.22, 0, 0.21, 0.18, 0.6, 0.63, C.recycle);
}

/** Potted plant (pot + foliage), scale s. */
export function plant(P, s = 1, y = 0) {
  P.cyl(0, 0, 0.09 * s, y, y + 0.14 * s, C.pot);
  P.cyl(0, 0, 0.14 * s, y + 0.14 * s, y + 0.3 * s, C.green);
  P.cyl(0.03 * s, 0.02, 0.09 * s, y + 0.3 * s, y + 0.42 * s, C.greenDark);
}

/** Floor plant (tall). */
export function floorPlant(P) {
  P.cyl(0, 0, 0.2, 0, 0.38, C.charcoal);
  P.cyl(0, 0, 0.32, 0.38, 0.95, C.green);
  P.cyl(0.05, 0.05, 0.24, 0.95, 1.45, C.greenDark);
}

/** Backpack (body, front pocket, straps) on the floor or a chair seat (y). */
export function backpack(P, col, y = 0, dep = null) {
  P.dec(0, 0, 0.16, 0.1, y, y + 0.42, col, { dep });
  P.dec(0, -0.11, 0.12, 0.03, y + 0.05, y + 0.25, col, { dep });
  P.dec(0, 0.11, 0.11, 0.015, y + 0.12, y + 0.4, C.black, { dep });
}

/** A hoodie draped over a chair back (lost and found). */
export function hoodie(P, col, dep = null) {
  P.dec(0, 0.2, 0.23, 0.05, 0.6, 0.9, col, { dep });
  P.dec(0, 0.3, 0.2, 0.05, 0.42, 0.88, col, { dep });
  P.dec(-0.25, 0.2, 0.04, 0.05, 0.4, 0.88, col, { dep });
}

/** Desk clutter on a work surface: papers, a book stack, a pencil cup, a laptop. */
export function deskClutter(rc, top, amount) {
  const rnd = rc.rnd;
  const P = place(rc, top.u, top.v, top.a);
  const h = top.h;
  if (rnd() < amount) P.dec(range(rnd, -top.hu, top.hu) * 0.5, range(rnd, -top.hv, top.hv) * 0.4, 0.105, 0.14, h, h + 0.006, C.white, { a: range(rnd, -0.5, 0.5), dep: top.dep });
  if (rnd() < amount * 0.6) {
    const bu = range(rnd, -top.hu, top.hu) * 0.5;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) P.dec(bu, 0, 0.1, 0.13, h + k * 0.035, h + (k + 1) * 0.035 - 0.003, pick(rnd, BOOKS), { a: range(rnd, -0.3, 0.3), dep: top.dep });
  }
  if (rnd() < amount * 0.25) {
    // an open laptop (base + lid)
    const lu = range(rnd, -top.hu, top.hu) * 0.4;
    P.dec(lu, 0, 0.16, 0.11, h, h + 0.02, C.greyLight, { dep: top.dep });
    P.dec(lu, 0.11, 0.16, 0.008, h + 0.02, h + 0.23, C.charcoal, { dep: top.dep });
  }
  if (rnd() < amount * 0.2) P.cyl(top.hu * 0.6, -top.hv * 0.3, 0.035, h, h + 0.11, pick(rnd, PAPER), { dep: top.dep });
}

/** The teacher's desk: pedestal desk, task chair, monitor, papers, tissue box, mug. Returns its top part. */
export function teacherDesk(rc, u, v, a, accent) {
  const P = place(rc, u, v, a);
  const top = P.part(0, 0, 0.78, 0.38, 0, 0.76, { mat: 'wood', hp: 160 });
  if (!top) return null;
  P.dec(0, 0, 0.8, 0.39, 0.725, 0.76, C.woodMid, { dep: top });
  P.dec(-0.52, 0, 0.25, 0.36, 0, 0.725, C.woodDark, { dep: top });
  P.dec(0.76, 0, 0.02, 0.36, 0, 0.725, C.woodDark, { dep: top });
  P.dec(0.1, -0.35, 0.65, 0.012, 0.25, 0.725, C.woodDark, { dep: top });
  for (let k = 0; k < 3; k++) P.dec(-0.52, -0.37, 0.08, 0.008, 0.18 + k * 0.2, 0.2 + k * 0.2, C.steel, { dep: top });
  // the user sits on the +dv side facing the room (-dv side is the front panel)
  taskChair(place(rc, ...P.pt(0.15, 0.75), a), accent.dark);
  // monitor, keyboard, papers, tissue box, mug
  P.dec(-0.35, -0.12, 0.26, 0.02, 0.98, 1.3, C.charcoal, { dep: top });
  P.dec(-0.35, -0.11, 0.24, 0.004, 1.0, 1.28, C.screen, { dep: top });
  P.dec(-0.35, -0.12, 0.03, 0.05, 0.76, 0.98, C.charcoal, { dep: top });
  P.dec(-0.3, 0.12, 0.2, 0.07, 0.76, 0.78, C.charcoal, { dep: top });
  P.dec(0.3, 0.05, 0.11, 0.14, 0.76, 0.78, C.white, { dep: top, a: 0.2 });
  P.dec(0.32, 0.02, 0.11, 0.14, 0.78, 0.79, PAPER[0], { dep: top, a: -0.15 });
  P.dec(0.62, -0.2, 0.06, 0.11, 0.76, 0.87, C.cream, { dep: top });
  P.cyl(0.55, 0.15, 0.04, 0.76, 0.86, accent.base, { dep: top });
  return { top, P, y: 0.76 };
}

/** Desk lamp (warm bulb, emissive). */
export function deskLamp(P, y, dep = null) {
  P.cyl(0, 0, 0.07, y, y + 0.02, C.charcoal, { dep });
  P.dec(0, 0, 0.012, 0.012, y + 0.02, y + 0.38, C.charcoal, { dep });
  P.cyl(0, -0.08, 0.09, y + 0.3, y + 0.42, C.charcoal, { dep });
  P.cyl(0, -0.08, 0.05, y + 0.28, y + 0.3, 'fixture', { dep });
}

/** Computer monitor + keyboard on a desk top (user at +dv), screen colour. */
export function monitor(P, y, screen = C.screen, dep = null) {
  P.dec(0, -0.12, 0.25, 0.02, y + 0.17, y + 0.48, C.black, { dep });
  P.dec(0, -0.1, 0.23, 0.004, y + 0.19, y + 0.46, screen, { dep });
  P.dec(0, -0.14, 0.03, 0.04, y, y + 0.17, C.charcoal, { dep });
  P.dec(0, 0.1, 0.21, 0.07, y, y + 0.02, C.charcoal, { dep });
}

/** Music stand (pole, tray). */
export function musicStand(P) {
  P.cyl(0, 0, 0.012, 0, 1.05, C.black);
  P.dec(0, 0, 0.24, 0.015, 0.95, 1.25, C.black, { a: 0 });
  P.cyl(0, 0, 0.18, 0, 0.02, C.black);
}

const pt3 = (P, du, dv) => {
  const [u, v] = P.pt(du, dv);
  return { u, v, a: P.a };
};
