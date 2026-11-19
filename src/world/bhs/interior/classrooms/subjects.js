// BENTONVILLE ROYALE — BHS classrooms: room types by subject (APPROXIMATE: typical US high school
// detailing, no classroom photos). Each dresser takes a room context rc (room.js) and returns
// { layout } (a name the tests compare between neighbours).
//
//   regular   seating layout (layouts.js) + teaching wall + perimeter + clutter
//   science   black-top lab benches with sinks (strong cover), fume hood, safety shower/eyewash,
//             periodic-table-style chart, glassware shelves, stools
//   art       big shared tables, paint-splatter floor, drying rack, easels, supply cubbies, clay corner + kiln
//   computer  rows of computer desks, cable trays, server cabinet, ceiling projector + screen
//   music     tiered risers (0.2 m steps), chairs in arcs, music stands, instrument lockers, piano
//   culinary  kitchen stations (stove, oven, sink), fridges, pantry
//   engineering / robotics  workbenches, tool wall, 3D printers, robot project tables, a practice field
//   seminar   one big table;  workroom  copier, counters;  gallery  blank framed panels and plinths

import { place, chair, stool, table, counter, closet, cubbies, couch, plant, floorPlant, musicStand, cart } from './props.js';
import { seatStudents, seatRun, tableGroup, sideSeats, ringSeats } from './layouts.js';
import { whiteboard, periodicChart, toolWall, wallTv, clock, coatHooks } from './walls.js';
import { claimWall, wallSpot, againstWall, plainWalls, teachingWall, dressWalls, windowWall, placeTeacher, placeCloset, perimeter, clutter } from './common.js';
import { C, PAPER, BAGS, pick, range } from './util.js';

/** Room type from the plan label / kind (unknown labels are regular classrooms). */
export function roomType(label = '', kind = '') {
  const l = String(label).toLowerCase();
  if (kind === 'gallery' || /gallery/.test(l)) return 'gallery';
  if (/piano/.test(l)) return 'piano';
  if (/band|choir|orchestra|music|chorus/.test(l)) return 'music';
  if (/computer|technology/.test(l)) return 'computer';
  if (/culinary|kitchen|foods|cooking/.test(l)) return 'culinary';
  if (/robot/.test(l)) return 'robotics';
  if (/engineering|shop|maker/.test(l)) return 'engineering';
  if (/art|studio|ceramic|drawing|painting/.test(l)) return 'art';
  if (/chem|bio|physics|science/.test(l) || kind === 'lab') return 'science';
  if (/seminar|conference/.test(l)) return 'seminar';
  if (/workroom|teacher work/.test(l)) return 'workroom';
  return 'regular';
}

/** The main student zone: front 2.3 m for the teacher and boards, capped at ~10.5 x 9.5 m. */
export function studentZone(rc, o = {}) {
  const side = o.side ?? 1.25;
  const front = o.front ?? 2.3;
  const back = o.back ?? 1.15;
  const maxW = o.maxW ?? 10.5;
  const maxD = o.maxD ?? 9.5;
  const w = Math.min(rc.W - 2 * side, maxW);
  const shift = o.shift || 0;
  const u0 = Math.max(rc.u0 + side, -w / 2 + shift);
  const u1 = Math.min(rc.u1 - side, u0 + w);
  const v0 = rc.v0 + front;
  const v1 = Math.min(rc.v1 - back, v0 + maxD);
  return { u0, u1, v0, v1 };
}

/** The leftover floor around a zone (back strip, side wings) as rects at least `min` wide. */
function leftovers(rc, Z, min = 2.6) {
  const out = [];
  if (rc.v1 - 0.5 - (Z.v1 + 0.7) >= min) out.push({ u0: rc.u0 + 0.7, u1: rc.u1 - 0.7, v0: Z.v1 + 0.7, v1: rc.v1 - 0.5, name: 'back' });
  if (Z.u0 - 0.6 - (rc.u0 + 0.5) >= min) out.push({ u0: rc.u0 + 0.5, u1: Z.u0 - 0.6, v0: Z.v0, v1: Z.v1, name: 'left' });
  if (rc.u1 - 0.5 - (Z.u1 + 0.6) >= min) out.push({ u0: Z.u1 + 0.6, u1: rc.u1 - 0.5, v0: Z.v0, v1: Z.v1, name: 'right' });
  return out;
}

/** Fill a leftover rect with a secondary area: lounge, round tables, computers, reading, project tables. */
function secondary(rc, R, kind) {
  const rnd = rc.rnd;
  const cu = (R.u0 + R.u1) / 2;
  const cv = (R.v0 + R.v1) / 2;
  const w = R.u1 - R.u0;
  const d = R.v1 - R.v0;
  if (kind === 'lounge') {
    if (!rc.fits(cu, cv, 0, Math.min(1.6, w / 2 - 0.1), Math.min(1.4, d / 2 - 0.1), { pad: 0.05 })) return;
    rc.reserve(cu, cv, 0, Math.min(1.6, w / 2 - 0.1), Math.min(1.4, d / 2 - 0.1), 0.05);
    rc.dec(cu, cv, 0, Math.min(1.5, w / 2 - 0.15), Math.min(1.3, d / 2 - 0.15), 0, 0.012, rc.accent.base);
    const sofa = rc.part(cu, cv + 0.65, 0, 0.95, 0.42, 0, 0.6, { mat: 'wood', hp: 140 });
    couch(place(rc, cu, cv + 0.65, Math.PI), 0.95, rc.couchCol, sofa);
    table(place(rc, cu, cv - 0.25), 0.45, 0.25, 0.42, C.woodMid, C.woodDark);
    chair(place(rc, cu - 1.05, cv - 0.55, -0.6), rc.chairCol());
    chair(place(rc, cu + 1.05, cv - 0.55, 0.6), rc.chairCol());
    rc.seats.push({ u: cu, v: cv + 0.65, a: Math.PI, dep: sofa });
  } else if (kind === 'round') {
    const n = Math.max(1, Math.min(3, Math.floor(w / 2.6)));
    for (let i = 0; i < n; i++) tableGroup(rc, R.u0 + (w * (i + 0.5)) / n, cv + (i % 2 ? 0.4 : -0.4), 0, 0.55, 0.55, ringSeats(0.55, 3 + Math.floor(rnd() * 2), rnd()), { round: true, stools: rnd() < 0.3 });
  } else if (kind === 'computers') {
    const n = Math.max(2, Math.floor((w - 0.4) / 0.8));
    seatRun(rc, cu, cv - 0.3, 0, n, 0.8, 'computer');
  } else if (kind === 'project') {
    const n = Math.max(1, Math.min(3, Math.floor(w / 2.8)));
    for (let i = 0; i < n; i++) tableGroup(rc, R.u0 + (w * (i + 0.5)) / n, cv, 0, 0.9, 0.45, sideSeats(0.9, 0.45, 2), { top: C.woodLight });
  } else if (kind === 'reading') {
    for (let i = 0; i < 2; i++) {
      const u = cu + (i ? 0.9 : -0.9);
      if (!rc.fits(u, cv, 0, 0.5, 0.5)) continue;
      rc.reserve(u, cv, 0, 0.5, 0.5, 0.1);
      const dep = rc.part(u, cv, 0, 0.42, 0.42, 0, 0.45, { mat: 'wood', hp: 120 });
      couch(place(rc, u, cv, i ? 0.4 : -0.4), 0.42, rc.couchCol, dep);
    }
    rc.dec(cu, cv + 0.2, 0, Math.min(1.6, w / 2 - 0.2), 1.0, 0, 0.012, rc.accent.light);
    floorPlant(place(rc, cu, cv + 0.9));
  }
}

// ------------------------------------------------------------------ floor finishes

/**
 * Floor finishes so no room is bare VCT: a big carpet or an accent rug under the seating, a wood
 * teaching strip at the front, or a wood floor with a rug (per-room roll).
 */
export function floorFinish(rc, Z) {
  const rnd = rc.rnd;
  const r = rnd();
  const zu = (Z.u0 + Z.u1) / 2;
  const zv = (Z.v0 + Z.v1) / 2;
  const zhu = (Z.u1 - Z.u0) / 2 + 0.4;
  const zhv = (Z.v1 - Z.v0) / 2 + 0.4;
  if (r < 0.3) {
    rc.floorPatch(zu, zv, 0, zhu, zhv, 'carpet');
    rc.floorPatch(zu, zv, 0, zhu + 0.08, zhv + 0.08, rc.accent.dark, -0.001);
  } else if (r < 0.55) {
    rc.floorPatch(0, rc.v0 + 1.2, 0, rc.W / 2 - 0.05, 1.15, 'woodFloor');
    rc.floorPatch(zu, zv, 0, Math.min(zhu, 2.6), Math.min(zhv, 2.0), rc.accent.base, 0.001);
    rc.floorPatch(zu, zv, 0, Math.min(zhu, 2.6) - 0.15, Math.min(zhv, 2.0) - 0.15, rc.accent.light, 0.002);
  } else if (r < 0.75) {
    rc.floorPatch(0, 0, 0, rc.W / 2 - 0.05, rc.D / 2 - 0.05, 'woodFloor');
    rc.floorPatch(zu, zv, 0, Math.min(zhu, 2.2), Math.min(zhv, 1.6), rc.accent.base, 0.001);
  } else {
    rc.floorPatch(zu, zv, 0, Math.min(zhu, 2.8), Math.min(zhv, 2.2), 'carpetBand');
    rc.floorPatch(zu, zv, 0, Math.min(zhu, 2.8) - 0.2, Math.min(zhv, 2.2) - 0.2, 'carpet', 0.001);
  }
}

/** A lectern or a document-camera cart near the board. */
function lectern(rc) {
  const rnd = rc.rnd;
  const u = (rnd() < 0.5 ? -1 : 1) * range(rnd, 1.2, Math.max(1.3, rc.W / 2 - 2.6));
  const v = rc.v0 + 1.25;
  if (!rc.take(u, v, 0, 0.35, 0.3, 0.2)) return;
  const P = place(rc, u, v, Math.PI + range(rnd, -0.3, 0.3));
  if (rnd() < 0.5) {
    P.dec(0, 0, 0.28, 0.22, 0, 1.05, C.woodMid);
    P.dec(0, -0.04, 0.32, 0.26, 1.05, 1.12, C.woodDark);
    P.dec(0, -0.1, 0.12, 0.16, 1.12, 1.13, C.white);
  } else {
    cart(P, C.charcoal);
    P.dec(0, 0, 0.12, 0.1, 1.12, 1.16, C.charcoal);
    P.dec(0, 0.05, 0.015, 0.015, 1.16, 1.5, C.charcoal);
    P.dec(0, -0.06, 0.05, 0.08, 1.45, 1.52, C.charcoal);
  }
}

// ------------------------------------------------------------------ regular classroom

export function dressRegular(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front']).concat(['back'])) || 'back';
  teachingWall(rc);
  windowWall(rc);
  const teacher = placeTeacher(rc, rc.teacherPos);
  const cl = placeCloset(rc);
  let shift = 0;
  if (teacher && teacher.where === 'sideLeft') shift = 0.9;
  if (teacher && teacher.where === 'sideRight') shift = -0.9;
  const Z = studentZone(rc, { shift });
  floorFinish(rc, Z);
  lectern(rc);
  seatStudents(rc, Z, rc.layout, rc.style);
  for (const R of leftovers(rc, Z)) secondary(rc, R, pick(rnd, ['lounge', 'round', 'computers', 'project', 'reading']));
  dressWalls(rc);
  perimeter(rc, rc.clutterAmt);
  clutter(rc, rc.clutterAmt);
  return { layout: rc.layout, teacher, closet: cl };
}

// ------------------------------------------------------------------ science lab

/** A black-top lab bench (strong cover) with a sink and faucet at one end, gas taps. */
function labBench(rc, u, v, a, hu, hv, stools) {
  if (!rc.fits(u, v, a, hu + (stools ? 0.55 : 0.05), hv + (stools ? 0.7 : 0.05), { pad: 0.05 })) return false;
  rc.reserve(u, v, a, hu + (stools ? 0.55 : 0.05), hv + (stools ? 0.7 : 0.05), 0.05);
  const P = place(rc, u, v, a);
  const dep = P.part(0, 0, hu, hv, 0, 0.92, { mat: 'block', hp: 400 });
  P.dec(0, 0, hu - 0.04, hv - 0.06, 0.1, 0.88, rc.benchBody, { dep });
  P.dec(0, 0, hu - 0.02, hv - 0.04, 0, 0.1, C.charcoal, { dep });
  P.dec(0, 0, hu, hv, 0.88, 0.92, C.labTop, { dep });
  for (let k = 1; k < Math.round(hu * 2 / 0.6); k++) for (const s of [-1, 1]) P.dec(-hu + k * 0.6, s * (hv - 0.055), 0.004, 0.004, 0.14, 0.84, C.charcoal, { dep });
  // sink + faucet at the +u end; gas taps along the spine
  P.dec(hu - 0.35, 0, 0.2, 0.17, 0.915, 0.925, '#0c0c0d', { dep });
  P.cyl(hu - 0.35, 0.22, 0.02, 0.92, 1.25, C.chrome, { dep });
  P.dec(hu - 0.35, 0.12, 0.015, 0.1, 1.22, 1.25, C.chrome, { dep });
  for (let k = 0; k < Math.max(1, Math.floor(hu / 0.6)); k++) P.cyl(-hu + 0.4 + k * 0.6, 0, 0.025, 0.92, 1.0, C.chrome, { dep });
  rc.tops.push({ u, v, a, hu: hu - 0.5, hv: hv - 0.1, h: 0.92, dep });
  if (stools)
    for (let k = 0; k < stools; k++)
      for (const s of [-1, 1]) {
        const du = -hu + ((2 * hu) * (k + 0.5)) / stools;
        stool(P.sub(du, s * (hv + 0.42)), rc.stoolCol, null, 0.66);
        if (rc.rnd() < rc.clutterAmt * 0.12) P.sub(du, s * (hv + 0.42)).dec(0, 0.18, 0.15, 0.09, 0, 0.4, pick(rc.rnd, BAGS));
      }
  // glassware / a goggles box on top
  if (rc.rnd() < 0.6) {
    P.cyl(-hu + 0.35, 0.1, 0.05, 0.92, 1.08, 'glass', { dep });
    P.cyl(-hu + 0.55, -0.1, 0.035, 0.92, 1.02, 'glass', { dep });
  }
  return true;
}

function fumeHood(rc, wall) {
  const P = againstWall(rc, wall, 0.8, 0.42, 2.5, rc.rnd() < 0.5 ? -9 : 9);
  if (!P) return false;
  const dep = P.part(0, 0, 0.8, 0.42, 0, 2.5, { mat: 'block', hp: 400 });
  P.dec(0, 0, 0.8, 0.42, 0, 0.9, C.greyLight, { dep });
  P.dec(0, 0.05, 0.8, 0.37, 0.9, 2.5, C.white, { dep });
  P.dec(0, -0.33, 0.66, 0.03, 0.92, 1.75, '#3a3d40', { dep });
  P.dec(0, -0.4, 0.66, 0.01, 1.2, 1.9, 'glass', { dep });
  P.dec(0, -0.41, 0.68, 0.02, 1.9, 2.0, C.greyLight, { dep });
  P.dec(0, -0.4, 0.8, 0.02, 0.88, 0.92, C.labTop, { dep });
  P.cyl(0, 0.1, 0.16, 2.5, rc.H, C.steel, { dep });
  P.dec(-0.6, -0.42, 0.06, 0.004, 2.1, 2.2, 'fixture', { dep });
  return true;
}

function safetyStation(rc) {
  for (const d of rc.doors) {
    const w = rc.walls[d.wall];
    const side = d.s > (w.s0 + w.s1) / 2 ? -1 : 1;
    const P = againstWall(rc, d.wall, 0.45, 0.35, 2.3, d.s + side * (d.w / 2 + 1.6), { windows: false });
    if (!P) continue;
    P.cyl(0, 0.2, 0.03, 0, 2.3, C.safety);
    P.cyl(0, -0.1, 0.17, 2.1, 2.22, C.safety);
    P.dec(0, 0.05, 0.015, 0.15, 2.2, 2.24, C.safety);
    P.dec(0.12, -0.15, 0.01, 0.01, 1.6, 2.1, C.safety);
    P.cyl(0, -0.05, 0.16, 0.95, 1.05, C.safety);
    P.cyl(0, 0.08, 0.04, 0, 0.95, C.safety);
    // the green safety sign (pictogram square, no text)
    const s = P.s;
    rc.wdec(d.wall, s, 0.16, 2.35, 2.62, '#2f8a4c', 0, 0.01);
    rc.wdec(d.wall, s, 0.07, 2.42, 2.55, C.white, 0.01, 0.012);
    return true;
  }
  return false;
}

function glasswareShelf(rc, wall) {
  const P = againstWall(rc, wall, 0.75, 0.2, 1.9, range(rc.rnd, -4, 4));
  if (!P) return;
  const dep = P.part(0, 0, 0.75, 0.2, 0, 1.9, { mat: 'wood', hp: 120 });
  P.dec(0, 0.19, 0.75, 0.01, 0, 1.9, C.woodLight, { dep });
  for (const s of [-1, 1]) P.dec(s * 0.735, 0, 0.015, 0.2, 0, 1.9, C.woodLight, { dep });
  for (let k = 0; k < 5; k++) {
    const y = 0.08 + k * 0.42;
    P.dec(0, 0, 0.72, 0.2, y - 0.02, y, C.woodLight, { dep });
    if (k === 4) break;
    for (let i = 0; i < 6; i++) {
      if (rc.rnd() < 0.3) continue;
      const du = -0.6 + i * 0.24;
      const tall = rc.rnd() < 0.5;
      P.cyl(du, 0, tall ? 0.04 : 0.06, y, y + (tall ? 0.24 : 0.14), 'glass', { dep });
      if (rc.rnd() < 0.3) P.cyl(du, 0, tall ? 0.035 : 0.055, y, y + 0.05, pick(rc.rnd, ['#4f86c6', '#5aa469', '#e58f3c']), { dep });
    }
  }
}

export function dressScience(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = 'back';
  teachingWall(rc, { variant: pick(rnd, ['wb', 'wb+smart']) });
  windowWall(rc, { vents: rnd() < 0.5 });
  // the demo bench at the front (the teacher's station)
  labBench(rc, 0, rc.v0 + 1.5, 0, Math.min(1.5, rc.W / 2 - 1.6), 0.45, 0);
  const teacher = placeTeacher(rc, pick(rnd, ['backLeft', 'backRight', 'sideLeft', 'sideRight']));
  const walls = plainWalls(rc, ['front']);
  if (walls[0]) fumeHood(rc, walls[0]);
  safetyStation(rc);
  const pw = walls.find((w) => rc.walls[w].s1 - rc.walls[w].s0 > 3) || 'back';
  const ps = wallSpot(rc, pw, 0.8, 1.3, 2.2, 0);
  if (ps !== null) periodicChart(rc, pw, ps, 1.4);
  if (walls[1] || walls[0]) glasswareShelf(rc, walls[1] || walls[0]);
  // perimeter counter with a black top along a side wall (strong cover)
  for (const wall of walls.slice(0, 2)) {
    const w = rc.walls[wall];
    const hs = Math.min(2.4, (w.s1 - w.s0) / 2 - 1.2);
    if (hs < 0.8) continue;
    const P = againstWall(rc, wall, hs, 0.32, 0.92, range(rnd, w.s0, w.s1), { windows: false });
    if (!P) continue;
    const dep = P.part(0, 0, hs, 0.32, 0, 0.92, { mat: 'block', hp: 400 });
    counter(P, hs, 0.92, rc.benchBody, C.labTop, dep, 0.32);
    P.dec(hs * 0.5, 0, 0.22, 0.17, 0.915, 0.93, '#0c0c0d', { dep });
    P.cyl(hs * 0.5, 0.24, 0.02, 0.92, 1.2, C.chrome, { dep });
    // wall cabinets above
    rc.wdec(wall, P.s, hs, 1.55, 2.25, rc.benchBody, 0, 0.32, { dep: undefined });
    rc.counters.push({ P, hs, dep, h: 0.92 });
    break;
  }
  // student benches: a grid, long axis across or along the room
  const Z = studentZone(rc, { front: 2.9, side: 1.1 });
  const along = rc.layoutIdx % 2 === 1;
  const pu = along ? 2.4 : 3.6;
  const pv = along ? 3.6 : 2.4;
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.6) / pu));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.6) / pv));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * pu) / 2;
  const v0 = (Z.v0 + Z.v1) / 2 - ((rowsN - 1) * pv) / 2;
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) labBench(rc, u0 + c * pu, v0 + r * pv, along ? Math.PI / 2 : 0, 1.2, 0.45, 2);
  const cl = placeCloset(rc);
  // lab coats on hooks, a goggles cabinet
  for (const wall of plainWalls(rc, ['front'])) {
    const s = wallSpot(rc, wall, 0.9, 0.8, 1.7, 0);
    if (s !== null) {
      coatHooks(rc, wall, s, 0.9, [C.white, C.white, C.cream]);
      break;
    }
  }
  dressWalls(rc, { bulletins: 1, posters: 2 + Math.floor(rnd() * 3) });
  perimeter(rc, rc.clutterAmt * 0.5, { items: ['filing', 'cart', 'bookshelf', 'plant'] });
  clutter(rc, rc.clutterAmt * 0.7);
  return { layout: along ? 'lab-along' : 'lab-across', teacher, closet: cl };
}

// ------------------------------------------------------------------ art studio

function easel(P, canvas) {
  P.dec(-0.25, 0, 0.02, 0.02, 0, 1.75, C.woodLight);
  P.dec(0.25, 0, 0.02, 0.02, 0, 1.75, C.woodLight);
  P.dec(0, 0.35, 0.02, 0.02, 0, 1.6, C.woodLight);
  P.dec(0, 0, 0.3, 0.025, 0.82, 0.86, C.woodLight);
  P.dec(0, -0.02, 0.3, 0.012, 0.86, 1.6, C.white);
  P.dec(0, -0.035, 0.2, 0.004, 1.0, 1.35, canvas);
}

function dryingRack(P) {
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.dec(su * 0.44, sv * 0.3, 0.015, 0.015, 0, 1.3, C.charcoal);
  for (let k = 0; k < 14; k++) {
    const y = 0.15 + k * 0.08;
    P.dec(0, 0, 0.44, 0.3, y, y + 0.006, C.steel);
    if (P.rc.rnd() < 0.45) P.dec(0, 0, 0.35, 0.24, y + 0.006, y + 0.008, pick(P.rc.rnd, PAPER));
  }
}

function kilnCorner(rc, R) {
  const rnd = rc.rnd;
  const P = againstWall(rc, R.wall, 1.6, 0.6, 1.2, R.s, { windows: false, pad: 0.3 });
  if (!P) return false;
  // kiln (round, lid, controller), pottery wheel + stool, a wedging table, clay pots
  const k = P.sub(-0.9, 0);
  const kd = k.part(0, 0, 0.42, 0.42, 0, 0.95, { mat: 'metal', hp: 260 });
  k.cyl(0, 0, 0.46, 0.1, 0.92, C.kiln, { dep: kd });
  k.cyl(0, 0, 0.48, 0.92, 0.98, C.charcoal, { dep: kd });
  for (const s of [-1, 1]) for (const t of [-1, 1]) k.dec(s * 0.3, t * 0.3, 0.02, 0.02, 0, 0.12, C.charcoal, { dep: kd });
  k.dec(0.5, 0, 0.04, 0.12, 0.6, 0.85, C.charcoal, { dep: kd });
  const w = P.sub(0.5, -0.1);
  w.cyl(0, 0, 0.3, 0.38, 0.5, C.greyLight);
  w.cyl(0, 0, 0.18, 0.5, 0.55, C.clay);
  w.cyl(0, 0, 0.12, 0.55, 0.62, C.clay);
  stool(w.sub(0, 0.55), C.charcoal, null, 0.5);
  const t = P.sub(1.25, 0.05);
  const td = t.part(0, 0, 0.35, 0.45, 0, 0.85, { mat: 'wood', hp: 120 });
  table(t, 0.35, 0.45, 0.85, '#c8b9a1', C.woodDark, td);
  for (let i = 0; i < 4; i++) t.cyl(range(rnd, -0.2, 0.2), range(rnd, -0.3, 0.3), range(rnd, 0.05, 0.09), 0.85, 0.85 + range(rnd, 0.08, 0.2), C.clay, { dep: td });
  rc.dec(...P.pt(0, -0.4), P.a, 1.7, 1.0, 0.002, 0.006, '#9b8f84');
  return true;
}

export function dressArt(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front'])) || 'back';
  teachingWall(rc, { variant: pick(rnd, ['wb', 'wb+screen']) });
  windowWall(rc, { blinds: pick(rnd, [0.1, 0.2, 0.3]), plants: 0.7 });
  const teacher = placeTeacher(rc, pick(rnd, ['frontLeft', 'frontRight', 'backLeft', 'backRight']));
  const cl = placeCloset(rc);
  // the clay corner + kiln on a plain wall, at its far end
  const walls = plainWalls(rc, ['front']);
  for (const wall of walls) {
    const w = rc.walls[wall];
    if (kilnCorner(rc, { wall, s: rnd() < 0.5 ? w.s0 : w.s1 })) break;
  }
  // big shared tables with stools
  const Z = studentZone(rc, { front: 2.4, side: 1.2, maxD: 10 });
  const pu = 3.4;
  const pv = 2.8;
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.8) / pu));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.6) / pv));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * pu) / 2;
  const v0 = (Z.v0 + Z.v1) / 2 - ((rowsN - 1) * pv) / 2;
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      const u = u0 + c * pu;
      const v = v0 + r * pv;
      if (tableGroup(rc, u, v, 0, 1.2, 0.6, sideSeats(1.2, 0.6, 3), { stools: true, h: 0.82, top: '#d8cbb3', legs: C.woodDark })) {
        // paint drips on the table top
        for (let k = 0; k < 4; k++) rc.dec(...rc.at(u, v, 0, range(rnd, -1, 1), range(rnd, -0.45, 0.45)), range(rnd, 0, 3), range(rnd, 0.03, 0.1), range(rnd, 0.03, 0.08), 0.82, 0.824, pick(rnd, PAPER));
      }
    }
  // paint-splatter floor patches
  const n = 10 + Math.floor(rnd() * 16);
  for (let k = 0; k < n; k++) {
    const u = range(rnd, rc.u0 + 0.5, rc.u1 - 0.5);
    const v = range(rnd, rc.v0 + 1, rc.v1 - 0.5);
    rc.dec(u, v, range(rnd, 0, 3), range(rnd, 0.04, 0.22), range(rnd, 0.03, 0.15), 0.001, 0.003, pick(rnd, PAPER));
  }
  // easels and a drying rack in the leftovers / along the back
  const left = leftovers(rc, Z, 1.8);
  const spotsE = [];
  for (const R of left) for (let k = 0; k < 4; k++) spotsE.push([range(rnd, R.u0 + 0.5, R.u1 - 0.5), range(rnd, R.v0 + 0.5, R.v1 - 0.5)]);
  for (let k = 0; k < 4; k++) spotsE.push([range(rnd, rc.u0 + 1, rc.u1 - 1), rc.v1 - 1.2]);
  let ne = 0;
  for (const [u, v] of spotsE) {
    if (ne >= 3 + Math.floor(rnd() * 4)) break;
    const a = range(rnd, -0.6, 0.6) + (v > 0 ? 0 : Math.PI);
    if (!rc.take(u, v, a, 0.35, 0.4, 0.2)) continue;
    easel(place(rc, u, v, a), pick(rnd, PAPER));
    ne++;
  }
  for (const wall of walls) {
    const P = againstWall(rc, wall, 0.46, 0.32, 1.3, range(rnd, -3, 3), { windows: false });
    if (P) {
      dryingRack(P);
      break;
    }
  }
  // supply shelves with colourful bins, a deep sink counter
  for (let k = 0; k < 2; k++) {
    const wall = pick(rnd, walls.length ? walls : ['back']);
    const P = againstWall(rc, wall, 0.9, 0.16, 1.4, range(rnd, -4, 4), { windows: false });
    if (P) cubbies(P, 0.9, 4, C.woodLight, PAPER, P.part(0, 0, 0.9, 0.16, 0, 1.36, { mat: 'wood', hp: 120 }));
  }
  {
    const wall = pick(rnd, walls.length ? walls : ['back']);
    const P = againstWall(rc, wall, 1.2, 0.32, 0.9, range(rnd, -3, 3), { windows: false });
    if (P) {
      const dep = P.part(0, 0, 1.2, 0.32, 0, 0.9, { mat: 'wood', hp: 140 });
      counter(P, 1.2, 0.9, C.woodLight, C.laminate, dep, 0.32);
      P.dec(0.3, 0, 0.35, 0.22, 0.88, 0.905, C.steel, { dep });
      P.cyl(0.3, 0.25, 0.02, 0.9, 1.2, C.chrome, { dep });
      for (let k = 0; k < 5; k++) P.dec(-0.9 + k * 0.12, 0, 0.04, 0.04, 0.9, 1.0, pick(rnd, PAPER), { dep });
      rc.counters.push({ P, hs: 1.2, dep, h: 0.9 });
    }
  }
  for (const R of leftovers(rc, Z, 3.5)) secondary(rc, R, pick(rnd, ['project', 'round']));
  dressWalls(rc, { bulletins: 2, posters: 5 + Math.floor(rnd() * 5) });
  perimeter(rc, rc.clutterAmt * 0.6, { items: ['cubbies', 'cart', 'plant', 'lowshelf', 'counter'] });
  clutter(rc, rc.clutterAmt);
  return { layout: 'art', teacher, closet: cl };
}

// ------------------------------------------------------------------ computer lab

export function dressComputer(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front'])) || 'back';
  teachingWall(rc, { variant: 'wb+screen' });
  windowWall(rc, { blinds: pick(rnd, [0.6, 0.8, 0.95]) });
  const teacher = placeTeacher(rc, pick(rnd, ['frontLeft', 'frontRight']));
  const cl = placeCloset(rc);
  // rows of computer desks facing the front, or a perimeter ring facing the walls + centre rows
  const Z = studentZone(rc, { front: 2.4, side: 1.0 });
  rc.floorPatch((Z.u0 + Z.u1) / 2, (Z.v0 + Z.v1) / 2, 0, (Z.u1 - Z.u0) / 2 + 0.5, (Z.v1 - Z.v0) / 2 + 0.4, rnd() < 0.5 ? 'carpet' : 'carpetBand');
  const perimeterStyle = rc.layoutIdx % 2 === 0 && rc.W > 8;
  const pv = 1.85;
  if (perimeterStyle) {
    for (const wall of plainWalls(rc, ['front'])) {
      const w = rc.walls[wall];
      const n = Math.floor((w.s1 - w.s0 - 2.6) / 0.8);
      if (n < 2) continue;
      const [u, v] = w.pt((w.s0 + w.s1) / 2, 0.45);
      seatRun(rc, u, v, w.a + Math.PI, n, 0.8, 'computer');
    }
  }
  const pods = !perimeterStyle && rc.layoutIdx % 3 === 1;
  const rowsN = pods ? 0 : Math.max(2, Math.floor((Z.v1 - Z.v0 - (perimeterStyle ? 1.4 : 0.2)) / pv));
  if (pods) {
    // computer pods: 4 stations back to back (2 x 2), a hub in the middle
    const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.6) / 3.2));
    const rws = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.6) / 3.4));
    const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * 3.2) / 2;
    const v0 = (Z.v0 + Z.v1) / 2 - ((rws - 1) * 3.4) / 2;
    for (let r = 0; r < rws; r++)
      for (let c = 0; c < cols; c++) {
        const u = u0 + c * 3.2;
        const v = v0 + r * 3.4;
        seatRun(rc, u, v - 0.34, Math.PI, 2, 0.8, 'computer');
        seatRun(rc, u, v + 0.34, 0, 2, 0.8, 'computer');
        rc.cyl(u, v, 0.08, 0.74, 1.0, C.charcoal);
      }
  }
  const blocks = Z.u1 - Z.u0 > 7 ? 2 : 1;
  const per = Math.max(2, Math.floor(((Z.u1 - Z.u0) - (blocks - 1) * 1.1) / blocks / 0.8));
  for (let r = 0; r < rowsN; r++)
    for (let b = 0; b < blocks; b++) {
      const bw = per * 0.8;
      const uc = (Z.u0 + Z.u1) / 2 + (blocks === 1 ? 0 : (b ? 1 : -1) * (bw / 2 + 0.55));
      const v = Z.v0 + 0.4 + r * pv;
      seatRun(rc, uc, v, 0, per, 0.8, 'computer');
      // cable tray behind the row
      const [tu, tv] = rc.at(uc, v, 0, 0, -0.27);
      rc.dec(tu, tv, 0, bw / 2, 0.05, 0.55, 0.6, C.greyLight);
    }
  // server cabinet with LEDs, a printer on a cart, wall cable trays
  const walls = plainWalls(rc, ['front']);
  for (const wall of walls) {
    const P = againstWall(rc, wall, 0.32, 0.5, 2.0, rnd() < 0.5 ? -9 : 9);
    if (!P) continue;
    const dep = P.part(0, 0, 0.32, 0.5, 0, 2.0, { mat: 'metal', hp: 260 });
    P.dec(0, 0, 0.32, 0.5, 0, 2.0, C.black, { dep });
    P.dec(0, -0.505, 0.28, 0.005, 0.1, 1.9, '#2a2d31', { dep });
    for (let k = 0; k < 8; k++) P.dec(-0.2 + (k % 2) * 0.05, -0.512, 0.012, 0.004, 0.4 + k * 0.17, 0.415 + k * 0.17, k % 3 ? 'fixture' : '#3fa34d', { dep });
    break;
  }
  {
    const wall = pick(rnd, walls.length ? walls : ['back']);
    const P = againstWall(rc, wall, 0.44, 0.28, 1.4, range(rnd, -3, 3), { windows: false });
    if (P) {
      cart(P, C.charcoal);
      P.dec(0, 0, 0.3, 0.24, 1.12, 1.4, C.white);
      P.dec(0, -0.1, 0.22, 0.1, 1.4, 1.44, C.greyLight);
    }
  }
  for (const wall of walls) {
    const w = rc.walls[wall];
    if (rc.wallFree(wall, w.s0 + 0.3, w.s1 - 0.3, { windows: false })) rc.wdec(wall, (w.s0 + w.s1) / 2, (w.s1 - w.s0) / 2 - 0.3, 0.3, 0.42, C.greyLight, 0, 0.06);
  }
  for (const R of leftovers(rc, Z)) secondary(rc, R, pick(rnd, ['computers', 'round', 'project']));
  dressWalls(rc, { bulletins: 1, posters: 3 + Math.floor(rnd() * 4) });
  perimeter(rc, rc.clutterAmt * 0.4, { items: ['filing', 'bookshelf', 'plant'] });
  clutter(rc, rc.clutterAmt * 0.8);
  return { layout: perimeterStyle ? 'computer-ring' : pods ? 'computer-pods' : 'computer-rows', teacher, closet: cl };
}

// ------------------------------------------------------------------ music

/** Grand piano (body, tail, open lid, legs, keyboard, bench). */
function grandPiano(rc, u, v, a) {
  if (!rc.take(u, v, a, 0.85, 1.25, 0.3)) return null;
  const P = place(rc, u, v, a);
  const dep = P.part(0, 0.1, 0.75, 0.95, 0, 1.0, { mat: 'wood', hp: 200 });
  P.dec(0, -0.3, 0.75, 0.55, 0.62, 0.98, C.black, { dep });
  P.dec(-0.2, 0.5, 0.55, 0.35, 0.62, 0.98, C.black, { dep });
  P.dec(-0.45, 0.88, 0.3, 0.12, 0.62, 0.98, C.black, { dep });
  P.dec(0.1, 0.05, 0.62, 0.7, 1.3, 1.33, C.black, { dep, a: 0.04 });
  P.dec(0.55, 0.1, 0.012, 0.012, 0.98, 1.3, C.black, { dep });
  P.dec(0, -0.88, 0.72, 0.09, 0.66, 0.72, C.white, { dep });
  for (let k = 0; k < 14; k++) if (k % 7 !== 2 && k % 7 !== 6) P.dec(-0.66 + k * 0.1, -0.86, 0.018, 0.05, 0.72, 0.735, C.black, { dep });
  for (const [du, dv] of [[-0.6, -0.6], [0.6, -0.6], [-0.3, 0.8]]) P.cyl(du, dv, 0.05, 0, 0.62, C.black, { dep });
  P.dec(0, -1.35, 0.4, 0.17, 0.44, 0.5, C.black);
  for (const s of [-1, 1]) P.dec(s * 0.36, -1.35, 0.02, 0.15, 0, 0.44, C.black);
  return dep;
}

function uprightPiano(P) {
  const dep = P.part(0, 0, 0.75, 0.3, 0, 1.25, { mat: 'wood', hp: 180 });
  P.dec(0, 0.05, 0.75, 0.25, 0, 1.25, C.woodDark, { dep });
  P.dec(0, -0.3, 0.72, 0.1, 0.68, 0.74, C.white, { dep });
  for (let k = 0; k < 14; k++) if (k % 7 !== 2 && k % 7 !== 6) P.dec(-0.66 + k * 0.1, -0.33, 0.018, 0.06, 0.74, 0.755, C.black, { dep });
  P.dec(0, -0.22, 0.75, 0.05, 0.6, 0.68, C.woodDark, { dep });
  P.dec(0, -0.85, 0.42, 0.17, 0.44, 0.5, C.woodDark);
  for (const s of [-1, 1]) P.dec(s * 0.38, -0.85, 0.02, 0.15, 0, 0.44, C.woodDark);
  return dep;
}

/** Instrument lockers: a bank of cabinet doors (metal cover). */
function instrumentLockers(rc, wall, hs) {
  const P = againstWall(rc, wall, hs, 0.35, 2.1, range(rc.rnd, -6, 6), { windows: false });
  if (!P) return false;
  const dep = P.part(0, 0, hs, 0.35, 0, 2.1, { mat: 'metal', hp: 260 });
  P.dec(0, 0, hs, 0.35, 0, 2.1, rc.lockerCol, { dep });
  const cols = Math.round((hs * 2) / 0.6);
  for (let c = 1; c < cols; c++) P.dec(-hs + c * ((2 * hs) / cols), -0.352, 0.006, 0.003, 0.05, 2.08, C.charcoal, { dep });
  for (const y of [0.7, 1.4]) P.dec(0, -0.352, hs, 0.003, y - 0.006, y + 0.006, C.charcoal, { dep });
  for (let c = 0; c < cols; c++) for (const y of [0.35, 1.05, 1.75]) P.dec(-hs + (c + 0.8) * ((2 * hs) / cols), -0.36, 0.012, 0.01, y - 0.05, y + 0.05, C.chrome, { dep });
  // some cases lying on top
  for (let k = 0; k < Math.floor(hs * 2); k++) if (rc.rnd() < 0.5) P.dec(range(rc.rnd, -hs + 0.3, hs - 0.3), 0, 0.3, 0.18, 2.1, 2.3, C.black, { dep });
  return true;
}

/**
 * Tiered risers: `tiers` arcs of segment boxes (0.2 m per step, walkable, unbreakable like stairs)
 * facing a conductor point (uc, vc). Returns the seat rings { r, y } for chairs.
 */
function risers(rc, uc, vc, r0, tiers, span, depth = 1.35) {
  const rings = [];
  const look = rc.riserLook;
  for (let t = 0; t < tiers; t++) {
    const r = r0 + t * depth;
    const top = 0.2 * (t + 1);
    const n = Math.max(3, Math.round((span * (r + depth / 2)) / 2.4));
    rings.push({ r: r + depth * 0.45, y: top, n });
    for (let i = 0; i < n; i++) {
      const phi = Math.PI / 2 - span / 2 + (span * (i + 0.5)) / n;
      const rm = r + depth / 2;
      const u = uc + Math.cos(phi) * rm;
      const v = vc + Math.sin(phi) * rm;
      const half = Math.tan(span / n / 2) * (r + depth) + 0.05;
      if (!rc.fits(u, v, phi - Math.PI / 2, half, depth / 2, { reserve: false })) continue;
      // the riser rests on the floor (base y0 = 0) up to its step height
      rc.part(u, v, phi - Math.PI / 2, half, depth / 2, 0, top, { mat: 'solid', walkable: true, look: 'none', role: 'riser' });
      rc.dec(u, v, phi - Math.PI / 2, half, depth / 2, 0.001, top, look, { faces: { top: look, pu: C.woodDark, nu: C.woodDark, pv: C.woodDark, nv: C.woodDark, bottom: 'none' } });
      rc.dec(...rc.at(u, v, phi - Math.PI / 2, 0, -depth / 2 + 0.02), phi - Math.PI / 2, half, 0.02, top - 0.006, top + 0.004, C.charcoal);
    }
  }
  rc.reserve(uc, vc + r0 + (tiers * depth) / 2, 0, r0 + tiers * depth, (tiers * depth) / 2 + r0 * 0.3, 0.1);
  return rings;
}

export function dressMusic(rc) {
  const rnd = rc.rnd;
  const label = rc.room.label.toLowerCase();
  const kind = /choir|chorus/.test(label) ? 'choir' : /orchestra/.test(label) ? 'orchestra' : 'band';
  rc.accentWallName = 'back';
  // the teaching wall: whiteboard with staff lines, clock, flag
  const s = wallSpot(rc, 'front', 2.0, 0.85, 2.2, 0);
  if (s !== null) {
    whiteboard(rc, 'front', s, 2.0, { strokes: 2 });
    for (const base of [1.15, 1.65]) for (let k = 0; k < 5; k++) rc.wdec('front', s, 1.85, base + k * 0.06, base + k * 0.06 + 0.006, C.charcoal, 0.03, 0.033);
  }
  const ts = wallSpot(rc, 'front', 0.62, 2.1, 2.8, rnd() < 0.5 ? -5 : 5);
  if (ts !== null) wallTv(rc, 'front', ts, 2.15);
  windowWall(rc, { blinds: pick(rnd, [0.3, 0.6]) });
  // conductor podium + stand at the front centre
  const vc = rc.v0 + 2.2;
  rc.part(0, vc, 0, 0.55, 0.55, 0, 0.2, { mat: 'solid', walkable: true, look: rc.riserLook, role: 'riser' });
  musicStand(place(rc, 0, vc + 0.7, Math.PI, 0.2));
  rc.reserve(0, vc, 0, 0.7, 0.7, 0.2);
  // risers: three arcs (band / orchestra) or straight choir risers
  const r0 = kind === 'choir' ? 2.6 : 2.4;
  const tiers = 3;
  const span = kind === 'choir' ? 1.7 : 2.3;
  const rings = risers(rc, 0, vc, r0, tiers, span);
  // floor ring + riser rings: chairs in arcs with stands (choir: chairs only on the floor row)
  const allRings = [{ r: r0 - 0.9, y: 0, n: 0 }, ...rings];
  for (const [i, ring] of allRings.entries()) {
    if (kind === 'choir' && i > 0 && rnd() < 0.7) continue;
    const n = Math.max(5, Math.floor((span * ring.r) / 1.0));
    for (let k = 0; k < n; k++) {
      const phi = Math.PI / 2 - span / 2 + (span * (k + 0.5)) / n;
      const u = Math.cos(phi) * ring.r;
      const v = vc + Math.sin(phi) * ring.r;
      if (!rc.fits(u, v, 0, 0.25, 0.25, { reserve: false })) continue;
      const a = phi - Math.PI / 2;
      chair(place(rc, u, v, a, ring.y), kind === 'choir' ? rc.chairCol() : C.black);
      if (kind !== 'choir') musicStand(place(rc, ...rc.at(u, v, a, 0, -0.55), a + Math.PI, ring.y));
    }
  }
  // percussion / basses at the back of the arcs
  const backV = vc + r0 + tiers * 1.35 + 1.2;
  if (kind === 'band' && rc.fits(0, backV, 0, 1.6, 0.8)) {
    rc.reserve(0, backV, 0, 1.6, 0.8, 0.2);
    const P = place(rc, 0, backV, 0);
    P.dec(-0.9, 0, 0.3, 0.2, 0, 0.55, C.white);
    for (const [du, dv, r, h] of [[-0.4, -0.25, 0.18, 0.7], [-0.1, -0.3, 0.16, 0.72], [-1.3, -0.2, 0.2, 0.62], [0.9, 0, 0.38, 0.85], [1.5, 0.1, 0.34, 0.8]]) P.cyl(du, dv, r, h - 0.2, h, du > 0.5 ? '#b87333' : C.white);
    for (const du of [-1.6, 0.2]) {
      P.cyl(du, 0.2, 0.01, 0, 1.2, C.chrome);
      P.cyl(du, 0.2, 0.22, 1.2, 1.21, '#c9a54a');
    }
    stool(P.sub(-0.6, 0.45), C.black, null, 0.55);
  }
  if (kind === 'orchestra') {
    for (let k = 0; k < 6; k++) {
      const u = -3 + k * 1.2;
      if (!rc.fits(u, backV, 0, 0.3, 0.3)) continue;
      rc.dec(u, backV, range(rnd, -0.2, 0.2), 0.25, 0.14, 0, 1.6 + (k % 2) * 0.3, C.black);
    }
  }
  // piano: grand at the front side, or an upright on a wall
  const pside = rnd() < 0.5 ? -1 : 1;
  if (!grandPiano(rc, pside * Math.min(rc.W / 2 - 2, 5.5), rc.v0 + 2.1, pside * 0.5)) {
    const P = againstWall(rc, 'front', 0.75, 0.3, 1.25, pside * 6);
    if (P) uprightPiano(P);
  }
  // instrument lockers + cubbies along the walls; stacked chairs; a teacher desk
  for (const wall of plainWalls(rc, ['front']).slice(0, 2)) instrumentLockers(rc, wall, Math.min(2.4, (rc.walls[wall].s1 - rc.walls[wall].s0) / 2 - 1.5));
  const teacher = placeTeacher(rc, pick(rnd, ['frontLeft', 'frontRight', 'sideLeft', 'sideRight']));
  const cl = placeCloset(rc);
  for (let k = 0; k < 2; k++) {
    const wall = pick(rnd, plainWalls(rc));
    if (!wall) break;
    const P = againstWall(rc, wall, 0.25, 0.25, 1.4, range(rnd, -8, 8), { windows: false });
    if (P) for (let i = 0; i < 8; i++) chair(P.sub(0, 0, 0, i * 0.12), rc.chairCol(), null);
  }
  dressWalls(rc, { bulletins: 2, posters: 4 + Math.floor(rnd() * 4) });
  perimeter(rc, 0.4, { items: ['cubbies', 'bookshelf', 'cart', 'filing'] });
  clutter(rc, rc.clutterAmt * 0.6);
  return { layout: 'music-' + kind, teacher, closet: cl };
}

/** Piano lab: rows of digital keyboards on stands with benches and headphones. */
export function dressPiano(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = 'back';
  teachingWall(rc, { variant: 'wb+smart' });
  windowWall(rc);
  const teacher = placeTeacher(rc, pick(rnd, ['frontLeft', 'frontRight']));
  const g = grandPiano(rc, (rnd() < 0.5 ? -1 : 1) * Math.min(rc.W / 2 - 2.2, 5), rc.v0 + 2.2, 0.4);
  void g;
  const Z = studentZone(rc, { front: 3.6, side: 1.4, maxW: 14, maxD: 14 });
  const pv = 1.9;
  const rowsN = Math.max(2, Math.floor((Z.v1 - Z.v0) / pv));
  const per = Math.max(2, Math.floor((Z.u1 - Z.u0 - 1.2) / 2 / 1.5));
  for (let r = 0; r < rowsN; r++)
    for (const side of [-1, 1]) {
      for (let k = 0; k < per; k++) {
        const u = side * (0.9 + 0.75 + k * 1.5);
        const v = Z.v0 + 0.5 + r * pv;
        if (!rc.take(u, v + 0.3, 0, 0.72, 0.65, 0.05)) continue;
        const P = place(rc, u, v, 0);
        const dep = P.part(0, 0, 0.68, 0.2, 0, 0.8, { mat: 'wood', hp: 120 });
        P.dec(0, 0, 0.68, 0.2, 0.72, 0.8, C.black, { dep });
        P.dec(0, 0.06, 0.62, 0.08, 0.8, 0.815, C.white, { dep });
        for (const s of [-1, 1]) P.dec(s * 0.55, 0, 0.02, 0.18, 0, 0.72, C.charcoal, { dep });
        P.dec(0.2, -0.1, 0.09, 0.06, 0.8, 0.86, C.charcoal, { dep });
        P.dec(0, 0.62, 0.38, 0.16, 0.44, 0.5, C.black);
        for (const s of [-1, 1]) P.dec(s * 0.33, 0.62, 0.02, 0.14, 0, 0.44, C.charcoal);
        rc.seats.push({ u, v: v + 0.62, a: 0, dep: null });
      }
    }
  const cl = placeCloset(rc);
  for (const wall of plainWalls(rc, ['front']).slice(0, 1)) instrumentLockers(rc, wall, 2.0);
  dressWalls(rc, { bulletins: 2, posters: 3 + Math.floor(rnd() * 4) });
  perimeter(rc, 0.5, { items: ['bookshelf', 'cubbies', 'plant', 'filing'] });
  clutter(rc, rc.clutterAmt * 0.6);
  return { layout: 'piano-lab', teacher, closet: cl };
}

// ------------------------------------------------------------------ culinary

function kitchenStation(rc, u, v, a) {
  if (!rc.take(u, v, a, 1.45, 1.0, 0.1)) return false;
  const P = place(rc, u, v, a);
  const dep = P.part(0, 0, 1.3, 0.4, 0, 0.92, { mat: 'block', hp: 300 });
  counter(P, 1.28, 0.92, rc.benchBody, C.laminate, dep, 0.4);
  // cooktop + oven front at -u, sink at +u
  P.dec(-0.7, 0, 0.36, 0.3, 0.92, 0.94, C.black, { dep });
  for (const [du, dv] of [[-0.85, -0.13], [-0.55, -0.13], [-0.85, 0.13], [-0.55, 0.13]]) P.cyl(du, dv, 0.08, 0.94, 0.946, C.charcoal, { dep });
  P.dec(-0.7, -0.405, 0.36, 0.01, 0.2, 0.78, C.steel, { dep });
  P.dec(-0.7, -0.42, 0.28, 0.012, 0.72, 0.74, C.chrome, { dep });
  P.dec(0.65, 0, 0.26, 0.2, 0.915, 0.93, C.steel, { dep });
  P.cyl(0.65, 0.25, 0.02, 0.92, 1.25, C.chrome, { dep });
  // a pot, a mixing bowl, a cutting board
  if (rc.rnd() < 0.7) P.cyl(-0.85, 0.13, 0.12, 0.946, 1.1, C.steel, { dep });
  if (rc.rnd() < 0.5) P.cyl(0.1, 0.05, 0.13, 0.92, 1.0, pick(rc.rnd, PAPER), { dep });
  P.dec(0.15, -0.15, 0.2, 0.13, 0.92, 0.94, C.woodLight, { dep });
  for (const s of [-0.6, 0.6]) stool(P.sub(s, 0.75), rc.stoolCol, null, 0.66);
  rc.tops.push({ u, v, a, hu: 0.3, hv: 0.2, h: 0.92, dep });
  return true;
}

export function dressCulinary(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front'])) || 'back';
  teachingWall(rc, { variant: pick(rnd, ['wb', 'wb+smart']) });
  windowWall(rc);
  // the demo kitchen at the front
  kitchenStation(rc, 0, rc.v0 + 1.6, Math.PI);
  const teacher = placeTeacher(rc, pick(rnd, ['backLeft', 'backRight', 'sideLeft', 'sideRight']));
  const Z = studentZone(rc, { front: 3.2, side: 1.0 });
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.4) / 3.4));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.4) / 2.6));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * 3.4) / 2;
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) kitchenStation(rc, u0 + c * 3.4, Z.v0 + 1.0 + r * 2.6, 0);
  // fridges and pantry along the walls
  for (const wall of plainWalls(rc, ['front'])) {
    for (let k = 0; k < 2; k++) {
      const P = againstWall(rc, wall, 0.42, 0.38, 1.85, range(rnd, -6, 6));
      if (!P) continue;
      const dep = P.part(0, 0, 0.42, 0.38, 0, 1.85, { mat: 'metal', hp: 260 });
      P.dec(0, 0, 0.42, 0.38, 0, 1.85, C.steel, { dep });
      P.dec(0, -0.385, 0.4, 0.004, 1.2, 1.21, C.greyLight, { dep });
      P.dec(0.32, -0.4, 0.015, 0.02, 0.6, 1.1, C.chrome, { dep });
    }
    const P = againstWall(rc, wall, 0.5, 0.3, 2.1, range(rnd, -6, 6));
    if (P) closet(P, 0.5, 2.1, rc.closetCol, P.part(0, 0, 0.5, 0.3, 0, 2.1, { mat: 'wood', hp: 160 }));
  }
  const cl = placeCloset(rc);
  // aprons on hooks, a tasting table
  for (const wall of plainWalls(rc, ['front'])) {
    const s = wallSpot(rc, wall, 0.8, 0.8, 1.7, 0);
    if (s !== null) {
      coatHooks(rc, wall, s, 0.8, [rc.accent.base, C.white, rc.accent.light]);
      break;
    }
  }
  for (const R of leftovers(rc, Z)) secondary(rc, R, 'round');
  dressWalls(rc, { bulletins: 1, posters: 3 + Math.floor(rnd() * 3) });
  perimeter(rc, 0.4, { items: ['cart', 'bookshelf', 'plant'] });
  clutter(rc, rc.clutterAmt * 0.6);
  return { layout: 'culinary', teacher, closet: cl };
}

// ------------------------------------------------------------------ engineering / robotics

function workbench(rc, u, v, a, extra) {
  if (!rc.take(u, v, a, 1.3, 1.0, 0.1)) return false;
  const P = place(rc, u, v, a);
  const dep = P.part(0, 0, 1.2, 0.45, 0, 0.9, { mat: 'wood', hp: 180 });
  P.dec(0, 0, 1.2, 0.45, 0.82, 0.9, C.woodLight, { dep });
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.dec(su * 1.12, sv * 0.38, 0.03, 0.03, 0, 0.82, C.charcoal, { dep });
  P.dec(0, 0, 1.12, 0.38, 0.2, 0.23, C.charcoal, { dep });
  P.dec(1.0, -0.45, 0.08, 0.06, 0.9, 0.98, C.plasticBlue, { dep });
  for (const s of [-0.6, 0.6]) stool(P.sub(s, 0.8), rc.stoolCol, null, 0.66);
  if (extra === 'robot') {
    // a robot project: chassis, wheels, an arm, a controller
    P.dec(-0.2, 0, 0.22, 0.18, 0.9, 1.02, C.steel, { dep });
    for (const [du, dv] of [[-0.38, -0.2], [-0.02, -0.2], [-0.38, 0.2], [-0.02, 0.2]]) P.cyl(-0.2 + du + 0.2, dv, 0.06, 0.9, 0.93, C.black, { dep });
    P.dec(-0.2, 0, 0.03, 0.03, 1.02, 1.3, C.red, { dep });
    P.dec(-0.08, 0, 0.12, 0.025, 1.27, 1.3, C.red, { dep });
    P.dec(0.5, 0.1, 0.12, 0.08, 0.9, 0.95, C.charcoal, { dep });
  } else {
    for (let k = 0; k < 4; k++) P.dec(range(rc.rnd, -0.9, 0.6), range(rc.rnd, -0.3, 0.3), range(rc.rnd, 0.05, 0.2), range(rc.rnd, 0.03, 0.12), 0.9, 0.9 + range(rc.rnd, 0.02, 0.1), pick(rc.rnd, [C.woodMid, C.steel, C.red, '#e9c44a']), { dep });
  }
  rc.tops.push({ u, v, a, hu: 0.4, hv: 0.2, h: 0.9, dep });
  return true;
}

function printers(rc, wall) {
  const P = againstWall(rc, wall, 1.3, 0.32, 1.5, range(rc.rnd, -4, 4), { windows: false });
  if (!P) return false;
  const dep = P.part(0, 0, 1.3, 0.32, 0, 0.9, { mat: 'wood', hp: 140 });
  counter(P, 1.3, 0.9, C.greyLight, C.laminate, dep, 0.32);
  for (let k = 0; k < 3; k++) {
    const du = -0.85 + k * 0.85;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.dec(du + su * 0.22, sv * 0.2, 0.015, 0.015, 0.9, 1.45, C.charcoal, { dep });
    P.dec(du, 0, 0.24, 0.22, 1.42, 1.47, C.charcoal, { dep });
    P.dec(du, 0, 0.18, 0.16, 1.02, 1.04, C.black, { dep });
    P.dec(du, -0.21, 0.21, 0.004, 0.95, 1.4, 'glass', { dep });
    P.dec(du, 0, 0.05, 0.05, 1.04, 1.04 + range(rc.rnd, 0.03, 0.12), pick(rc.rnd, [C.red, '#e58f3c', '#4f86c6', C.white]), { dep });
    P.dec(du - 0.15, -0.215, 0.04, 0.004, 1.38, 1.4, 'fixture', { dep });
  }
  return true;
}

export function dressEngineering(rc, robotics) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front'])) || 'back';
  teachingWall(rc, { variant: pick(rnd, ['wb', 'smart+wb2']) });
  windowWall(rc, { blinds: pick(rnd, [0.2, 0.5]) });
  const teacher = placeTeacher(rc, pick(rnd, ['frontLeft', 'frontRight', 'sideLeft', 'sideRight']));
  const walls = plainWalls(rc, ['front']);
  for (const wall of walls) {
    const s = wallSpot(rc, wall, 1.3, 0.95, 2.25, 0);
    if (s !== null) {
      toolWall(rc, wall, s, 1.3);
      const [u, v] = rc.walls[wall].pt(s, 0.35);
      if (rc.take(u, v, rc.walls[wall].a + Math.PI, 1.3, 0.33, 0.1)) {
        const P = place(rc, u, v, rc.walls[wall].a + Math.PI);
        const dep = P.part(0, 0, 1.3, 0.33, 0, 0.9, { mat: 'wood', hp: 160 });
        counter(P, 1.3, 0.9, C.charcoal, C.woodLight, dep, 0.33);
        rc.counters.push({ P, hs: 1.3, dep, h: 0.9 });
      }
      break;
    }
  }
  for (const wall of walls.slice(1).concat(walls.slice(0, 1))) if (printers(rc, wall)) break;
  // workbenches (and robot project tables) in a grid
  const Z = studentZone(rc, { front: 2.5, side: 1.1 });
  const cols = Math.max(1, Math.floor((Z.u1 - Z.u0 + 0.4) / 3.2));
  const rowsN = Math.max(1, Math.floor((Z.v1 - Z.v0 + 0.4) / 2.6));
  const u0 = (Z.u0 + Z.u1) / 2 - ((cols - 1) * 3.2) / 2;
  let k = 0;
  // robotics: a practice field (foam tiles inside a low border) where the zone allows it
  let field = false;
  if (robotics) {
    const fu = (Z.u0 + Z.u1) / 2;
    const fv = Z.v1 - 2.0;
    if (rc.take(fu, fv, 0, 1.9, 1.9, 0.2)) {
      field = true;
      rc.dec(fu, fv, 0, 1.8, 1.8, 0, 0.02, C.greyLight);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) rc.dec(fu - 1.5 + i * 0.6, fv - 1.5 + j * 0.6, 0, 0.3, 0.3, 0.02, 0.022, rc.accent.base);
      for (const [du, dv, hu, hv] of [[0, -1.82, 1.84, 0.04], [0, 1.82, 1.84, 0.04], [-1.82, 0, 0.04, 1.84], [1.82, 0, 0.04, 1.84]]) rc.dec(fu + du, fv + dv, 0, hu, hv, 0, 0.3, C.charcoal);
      const R = place(rc, fu + 0.4, fv - 0.3, 0.7);
      R.dec(0, 0, 0.22, 0.2, 0.05, 0.2, C.steel);
      for (const [du, dv] of [[-0.18, -0.2], [0.18, -0.2], [-0.18, 0.2], [0.18, 0.2]]) R.cyl(du, dv, 0.06, 0.02, 0.1, C.black);
      R.dec(0, 0, 0.04, 0.04, 0.2, 0.45, C.red);
    }
  }
  for (let r = 0; r < rowsN; r++)
    for (let c = 0; c < cols; c++) {
      if (workbench(rc, u0 + c * 3.2, Z.v0 + 1.0 + r * 2.6, 0, robotics && (k++ % 2 === 0) ? 'robot' : null)) continue;
    }
  const cl = placeCloset(rc);
  for (const R of leftovers(rc, Z)) secondary(rc, R, 'project');
  // lumber / parts rack
  {
    const wall = pick(rnd, walls.length ? walls : ['back']);
    const P = againstWall(rc, wall, 0.9, 0.16, 1.4, range(rnd, -5, 5), { windows: false });
    if (P) cubbies(P, 0.9, 4, C.steel, [C.red, C.plasticBlue, '#e9c44a', C.charcoal], P.part(0, 0, 0.9, 0.16, 0, 1.34, { mat: 'metal', hp: 200 }));
  }
  dressWalls(rc, { bulletins: 1, posters: 3 + Math.floor(rnd() * 4) });
  perimeter(rc, 0.5, { items: ['cart', 'filing', 'bookshelf', 'cubbies'] });
  clutter(rc, rc.clutterAmt * 0.7);
  return { layout: robotics ? (field ? 'robotics-field' : 'robotics') : 'engineering', teacher, closet: cl };
}

// ------------------------------------------------------------------ seminar, workroom, gallery

export function dressSeminar(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc, ['front'])) || 'back';
  teachingWall(rc, { variant: pick(rnd, ['wb', 'wb+smart', 'wb+screen']) });
  windowWall(rc);
  // one big table along the room's long axis
  const longU = rc.W >= rc.D;
  const len = Math.min(3.6, (longU ? rc.W : rc.D) / 2 - 1.8);
  const wid = Math.min(0.75, (longU ? rc.D : rc.W) / 2 - 1.6);
  const n = Math.max(2, Math.floor((len * 2) / 0.75));
  const vc = longU ? 0 : rc.v0 + 1.8 + len + Math.max(0, (rc.D - 3.6 - 2 * len) / 4);
  const top = pick(rnd, [C.woodMid, C.woodLight, C.laminate]);
  rc.floorPatch(0, vc, longU ? 0 : Math.PI / 2, len + 1.3, Math.max(0.45, wid) + 1.2, rnd() < 0.5 ? 'carpetBand' : rc.accent.dark);
  const ok = tableGroup(rc, 0, vc, longU ? 0 : Math.PI / 2, len, Math.max(0.45, wid), sideSeats(len, Math.max(0.45, wid), n, true), { top, legs: C.charcoal, hp: 160 });
  if (!ok) tableGroup(rc, 0, vc, 0, 1.2, 0.5, sideSeats(1.2, 0.5, 3, true), { top });
  // credenza + TV, bookshelves, plants
  for (const wall of plainWalls(rc, ['front'])) {
    const P = againstWall(rc, wall, 0.9, 0.25, 0.8, 0, { windows: false });
    if (P) {
      const dep = P.part(0, 0, 0.9, 0.25, 0, 0.8, { mat: 'wood', hp: 140 });
      counter(P, 0.9, 0.8, C.woodDark, C.woodMid, dep, 0.25);
      rc.counters.push({ P, hs: 0.9, dep, h: 0.8 });
      plant(P.sub(0.6, 0), 1, 0.8);
      break;
    }
  }
  const teacher = rc.W * rc.D > 120 ? placeTeacher(rc, pick(rnd, ['backLeft', 'backRight'])) : null;
  const cl = placeCloset(rc);
  if (rc.W * rc.D > 150) {
    const Z = { u0: rc.u0 + 1, u1: rc.u1 - 1, v0: vc + 2.6, v1: rc.v1 - 1 };
    if (Z.v1 - Z.v0 > 2.5) secondary(rc, Z, pick(rnd, ['lounge', 'round']));
  }
  dressWalls(rc, { bulletins: 1, posters: 2 + Math.floor(rnd() * 3) });
  perimeter(rc, 0.5, { items: ['bookshelf', 'bookshelf', 'plant', 'lowshelf'] });
  clutter(rc, rc.clutterAmt * 0.5);
  return { layout: 'seminar', teacher, closet: cl };
}

export function dressWorkroom(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = 'back';
  windowWall(rc);
  const walls = plainWalls(rc);
  // the copier
  for (const wall of walls) {
    const P = againstWall(rc, wall, 0.55, 0.38, 1.2, 0);
    if (!P) continue;
    const dep = P.part(0, 0, 0.55, 0.38, 0, 1.15, { mat: 'metal', hp: 200 });
    P.dec(0, 0, 0.55, 0.38, 0, 0.95, C.white, { dep });
    P.dec(0, 0.05, 0.5, 0.33, 0.95, 1.12, C.greyLight, { dep });
    P.dec(-0.35, -0.3, 0.12, 0.08, 1.05, 1.16, C.charcoal, { dep });
    P.dec(0.65, 0, 0.12, 0.2, 0.75, 0.78, C.greyLight, { dep });
    for (let k = 0; k < 3; k++) P.dec(0, -0.385, 0.48, 0.004, 0.15 + k * 0.25, 0.17 + k * 0.25, C.greyLight, { dep });
    break;
  }
  // counters with upper cabinets, a coffee maker and microwave
  for (const wall of walls.slice(0, 2)) {
    const P = againstWall(rc, wall, 1.4, 0.32, 0.92, range(rnd, -3, 3), { windows: false });
    if (!P) continue;
    const dep = P.part(0, 0, 1.4, 0.32, 0, 0.92, { mat: 'wood', hp: 140 });
    counter(P, 1.4, 0.92, C.woodLight, C.laminate, dep, 0.32);
    rc.wdec(wall, P.s, 1.4, 1.5, 2.2, C.woodLight, 0, 0.32);
    P.dec(-0.9, 0, 0.12, 0.13, 0.92, 1.25, C.black, { dep });
    P.dec(0.6, 0, 0.26, 0.2, 0.92, 1.2, C.charcoal, { dep });
    rc.counters.push({ P, hs: 1.4, dep, h: 0.92 });
  }
  // mailbox cubbies
  for (const wall of walls) {
    const P = againstWall(rc, wall, 0.8, 0.16, 1.9, 0, { windows: false });
    if (P) {
      cubbies(P, 0.8, 5, C.woodLight, [C.white, C.cream], P.part(0, 0, 0.8, 0.16, 0, 1.66, { mat: 'wood', hp: 120 }));
      break;
    }
  }
  tableGroup(rc, 0, 0, 0, 0.9, 0.45, sideSeats(0.9, 0.45, 2), { top: C.laminate });
  const cl = placeCloset(rc);
  dressWalls(rc, { bulletins: 2, posters: 1 });
  perimeter(rc, 0.4, { items: ['filing', 'fridge', 'cart'] });
  clutter(rc, rc.clutterAmt);
  return { layout: 'workroom', teacher: null, closet: cl };
}

/** Gallery: blank framed panels (no art), plinths with simple shapes, free-standing display walls, a bench. */
export function dressGallery(rc) {
  const rnd = rc.rnd;
  rc.accentWallName = pick(rnd, plainWalls(rc)) || 'back';
  windowWall(rc, { blinds: 0.95, plants: 0, vents: false });
  const frameCol = pick(rnd, [C.black, C.woodDark, C.chrome]);
  const panel = (wall, s, hs, y0, y1) => {
    rc.wdec(wall, s, hs + 0.04, y0 - 0.04, y1 + 0.04, frameCol, 0, 0.03);
    rc.wdec(wall, s, hs, y0, y1, pick(rnd, [C.white, C.cream, rc.accent.paper, '#e8e6e1']), 0.03, 0.035);
  };
  for (const wall of Object.keys(rc.walls)) {
    const w = rc.walls[wall];
    for (let s = w.s0 + 1.2; s < w.s1 - 1.0; s += range(rnd, 1.6, 2.4)) {
      const hs = range(rnd, 0.3, 0.7);
      const y0 = range(rnd, 1.1, 1.4);
      const y1 = y0 + range(rnd, 0.5, 1.1);
      if (claimWall(rc, wall, s - hs - 0.05, s + hs + 0.05, y0 - 0.05, y1 + 0.05)) panel(wall, s, hs, y0, y1);
    }
  }
  // free-standing display walls down the middle with panels on both faces
  const longV = rc.D >= rc.W;
  const n = Math.max(1, Math.floor((longV ? rc.D : rc.W) / 7));
  for (let i = 0; i < n; i++) {
    const t = -0.5 + (i + 0.5) / n;
    const u = longV ? range(rnd, -0.6, 0.6) : t * rc.W;
    const v = longV ? t * rc.D : range(rnd, -0.6, 0.6);
    const a = longV ? Math.PI / 2 : 0;
    if (!rc.take(u, v, a, 1.3, 0.1, 0.9)) continue;
    const P = place(rc, u, v, a);
    const dep = P.part(0, 0, 1.2, 0.08, 0, 2.4, { mat: 'wood', hp: 160 });
    P.dec(0, 0, 1.2, 0.08, 0, 2.4, C.white, { dep });
    for (const sgn of [-1, 1]) {
      P.dec(0, sgn * 0.1, 0.55, 0.02, 1.0, 1.9, frameCol, { dep });
      P.dec(0, sgn * 0.12, 0.5, 0.005, 1.05, 1.85, pick(rnd, [C.white, C.cream, rc.accent.paper]), { dep });
    }
  }
  // plinths with abstract shapes
  for (let k = 0; k < 8; k++) {
    const u = range(rnd, rc.u0 + 1.4, rc.u1 - 1.4);
    const v = range(rnd, rc.v0 + 1.4, rc.v1 - 1.4);
    if (!rc.take(u, v, 0, 0.3, 0.3, 0.8)) continue;
    const h = range(rnd, 0.8, 1.15);
    const dep = rc.part(u, v, 0, 0.28, 0.28, 0, h, { mat: 'wood', hp: 140 });
    rc.dec(u, v, 0, 0.28, 0.28, 0, h, C.white, { dep });
    const P = place(rc, u, v, range(rnd, 0, 1.5));
    if (rnd() < 0.5) {
      P.cyl(0, 0, 0.12, h, h + 0.3, rc.accent.base, { dep });
      P.dec(0, 0, 0.07, 0.07, h + 0.3, h + 0.45, rc.accent.dark, { dep });
    } else {
      P.dec(0, 0, 0.12, 0.12, h, h + 0.24, pick(rnd, [rc.accent.base, C.chrome, C.charcoal]), { dep });
      P.dec(0.05, 0.03, 0.06, 0.06, h + 0.24, h + 0.42, pick(rnd, [rc.accent.light, C.white]), { dep });
    }
  }
  // a bench, track lights
  const bv = rnd() < 0.5 ? -1 : 1;
  if (rc.take(0, bv, 0, 0.9, 0.25, 0.4)) {
    const P = place(rc, 0, bv, 0);
    P.dec(0, 0, 0.9, 0.22, 0.4, 0.46, C.woodMid);
    for (const s of [-1, 1]) P.dec(s * 0.8, 0, 0.04, 0.2, 0, 0.4, C.charcoal);
  }
  for (const s of [-1, 1]) {
    const [u0, v0] = longV ? [s * rc.W * 0.28, rc.v0 + 1] : [rc.u0 + 1, s * rc.D * 0.28];
    const len = (longV ? rc.D : rc.W) - 2;
    const [cu, cv] = longV ? [u0, 0] : [0, v0];
    rc.dec(cu, cv, longV ? Math.PI / 2 : 0, len / 2, 0.03, rc.H - 0.05, rc.H - 0.01, C.charcoal);
    for (let t = 0.5; t < len; t += 1.6) {
      const [hu, hv] = longV ? [u0, rc.v0 + 1 + t] : [rc.u0 + 1 + t, v0];
      rc.cyl(hu, hv, 0.06, rc.H - 0.25, rc.H - 0.05, C.charcoal);
      rc.cyl(hu, hv, 0.04, rc.H - 0.27, rc.H - 0.25, 'fixture');
    }
  }
  const cl = placeCloset(rc);
  clock(rc, 'back', 0, Math.min(2.6, rc.H - 0.4));
  return { layout: 'gallery', teacher: null, closet: cl };
}

