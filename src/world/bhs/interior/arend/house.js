// BENTONVILLE ROYALE — Arend Arts Center: the house (auditorium) [AAC; docs/bhs/STYLE_BIBLE.md §1, §4].
//
// A fan-shaped house of black continental seats on a raked floor (walkable K.box row risers),
// two side aisles with step lights, a rear cross-aisle reached by stairs from the ground-floor
// doors, a curved rear balcony on its own rake (stairs from the rear cross-aisle, and a door
// well from the upper lobby), the sound / lighting booth at the balcony rear, taupe angled
// acoustic panels, a light ceiling with curved bulkheads and downlights, and exit doors.

import {
  FX, ZC, ROWS, Y_REAR, R_REAR, BAL, Y_BAL_REAR, R_BAL_REAR, AISLE, aisleZ, HOUSE_IN, WELLS, WELL_RUN, WELL_HALF,
  BAL_DOOR_Z, BAL_STAIR, fanP, tanYaw, arcRange, arcBoxes,
} from './layout.js';
import { subtractRects } from '../../kit/builder.js';

const NONE = Object.freeze({ pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' });
const TOP_ONLY = (look) => ({ ...NONE, top: look });
const BOTTOM_ONLY = (look) => ({ ...NONE, bottom: look });
const RISER = '#34302e';
const ARM = '#121214';
const SEAT_TOP = '#3a3a3f'; // worn upholstery catching the house light (seat tops, back caps)
const GREY_PANEL = '#86817a';
const DARK = '#1b1b1d';
const FAR = 400; // "no front clip" for arcRange

/** Rects of the door wells cut out of the rear cross-aisle (and of the balcony rear). */
export function wellRects() {
  return WELLS.map(({ door: [x, z], dir }) =>
    dir === 'x'
      ? { x0: 39.9, x1: HOUSE_IN.x0 + 0.05 + WELL_RUN - 0.03, z0: z - WELL_HALF, z1: z + WELL_HALF }
      : { x0: x - WELL_HALF, x1: x + WELL_HALF, z0: HOUSE_IN.z1 - 0.05 - WELL_RUN + 0.03, z1: 336.1 },
  );
}
export const balWellRect = () => ({ x0: 39.9, x1: HOUSE_IN.x0 + 0.05 + WELL_RUN - 0.03, z0: BAL_DOOR_Z - WELL_HALF, z1: BAL_DOOR_Z + WELL_HALF });

/** Axis-aligned strips (1 m in z) filling the fan beyond radius R, from x0 to the arc. */
function rearStrips(R, x0, zn, zs) {
  const out = [];
  for (let z = zn; z < zs - 1e-6; z += 1) {
    const z1 = Math.min(zs, z + 1);
    const dz = Math.max(Math.abs(z - ZC), Math.abs(z1 - ZC));
    const x1 = FX - Math.sqrt(Math.max(0, R * R - dz * dz));
    if (x1 > x0 + 0.05) out.push({ x0, x1, z0: z, z1 });
  }
  return out;
}

/** Angle where the aisle line (side -1 north / +1 south) crosses radius r. */
function aisleAngle(r, side) {
  let x = FX - r;
  for (let k = 0; k < 8; k++) {
    const z = aisleZ(x, side);
    x = FX - Math.sqrt(Math.max(0, r * r - (z - ZC) * (z - ZC)));
  }
  return Math.asin(Math.max(-1, Math.min(1, (aisleZ(x, side) - ZC) / r)));
}

const inAisle = (x, z, pad = 0.27) => [-1, 1].some((s) => Math.abs(z - aisleZ(x, s)) < AISLE.HALF + pad);

/**
 * One continental seat row: seats spaced 0.53 m along the arc at radius rS (cushion centre),
 * floor y, between angles a0..a1, skipping aisles. Each seat: cushion, back, arm standard.
 * cover: [{ t0, t1, dep }] angle spans whose seats hang on a seat-back collider.
 */
function seatRow(K, rS, a0, a1, y, cover, skip) {
  const step = 0.55 / rS;
  const n = Math.floor((a1 - a0) / step);
  const start = a0 + ((a1 - a0) - n * step) / 2 + step / 2;
  let count = 0;
  let prevSeat = false;
  for (let k = 0; k < n; k++) {
    const th = start + k * step;
    const [x, z] = fanP(rS, th);
    if (skip(x, z)) {
      prevSeat = false;
      continue;
    }
    const dep = (cover.find((c) => th >= c.t0 && th <= c.t1) || {}).dep || null;
    const yaw = tanYaw(th);
    K.decor({ cx: x, cz: z, hx: 0.24, hz: 0.23, yaw, y0: y + 0.4, y1: y + 0.5 }, SEAT_TOP, { dep });
    const [bx, bz] = fanP(rS + 0.27, th);
    K.decor({ cx: bx, cz: bz, hx: 0.25, hz: 0.05, yaw, y0: y + 0.42, y1: y + 0.96 }, 'seat', { dep });
    K.decor({ cx: bx, cz: bz, hx: 0.245, hz: 0.06, yaw, y0: y + 0.96, y1: y + 1.0 }, SEAT_TOP, { dep });
    const ta = th + 0.265 / rS;
    const [ax, az] = fanP(rS + 0.05, ta);
    K.decor({ cx: ax, cz: az, hx: 0.025, hz: 0.27, yaw: tanYaw(ta), y0: y, y1: y + 0.66 }, ARM, { dep });
    if (!prevSeat) {
      const tb = th - 0.265 / rS;
      const [cx, cz] = fanP(rS + 0.05, tb);
      K.decor({ cx, cz, hx: 0.025, hz: 0.27, yaw: tanYaw(tb), y0: y, y1: y + 0.66 }, ARM, { dep });
    }
    prevSeat = true;
    count++;
  }
  return count;
}

/** Low cover: a few seat-back colliders per row (invisible; the seats drawn on them hide when shot out). */
function seatBackCover(K, rBack, y, angles) {
  return angles.map((tm) => {
    const [cx, cz] = fanP(rBack, tm);
    const half = 1.3;
    const dep = K.box({ cx, cz, hx: half, hz: 0.07, yaw: tanYaw(tm), y0: y, y1: y + 1.0 }, { mat: 'wood', hp: 120, look: 'none', faces: NONE, role: 'prop' });
    return { t0: tm - half / rBack, t1: tm + half / rBack, dep };
  });
}

/** Stepped fan of row platforms (walkable boxes) + its seats. Returns the seat count. */
function rake(K, { r0, d, n, yOf, y0, zn, zs, walls = [], xFront, faces, coverRows, coverAngles, seatSkip, stepLights }) {
  let seats = 0;
  for (let i = 0; i < n; i++) {
    const ra = r0 + i * d;
    const rb = ra + d;
    const y = yOf(i);
    const [a0, a1] = arcRange((ra + rb) / 2, zn, zs, xFront);
    for (const b of arcBoxes(ra, rb, a0, a1)) K.box({ ...b, y0, y1: y }, { mat: 'solid', walkable: true, look: 'carpet', faces, role: 'stair' });
    // wall fillers: where the row meets a side wall, an axis-aligned piece closes the chord ends
    for (const [zw, s] of walls) {
      const dz = zw - ZC;
      if (Math.abs(dz) >= ra) continue;
      const xa = FX - Math.sqrt(rb * rb - dz * dz);
      const xb = Math.min(xFront, FX - Math.sqrt(ra * ra - dz * dz));
      if (xb < xa + 0.05) continue;
      const zf = zw + s * 0.9;
      K.box({ cx: (xa + xb) / 2, cz: (zw + zf) / 2, hx: (xb - xa) / 2, hz: 0.45, yaw: 0, y0, y1: y }, { mat: 'solid', walkable: true, look: 'carpet', faces: { ...faces, pu: RISER, nu: RISER }, role: 'stair' });
    }
    const cover = coverRows(i) ? seatBackCover(K, ra + 0.82, y, coverAngles) : [];
    const rS = ra + 0.55;
    const [s0, s1] = arcRange(rS, zn + 0.35, zs - 0.35, xFront - 0.45);
    seats += seatRow(K, rS, s0, s1, y, cover, seatSkip);
    // aisle step lights on the riser of each row, both edges of both aisles
    if (stepLights && i > 0) {
      for (const side of [-1, 1]) {
        const ta = aisleAngle(ra, side);
        for (const e of [-1, 1]) {
          const t = ta + (e * (AISLE.HALF - 0.12)) / ra;
          const [lx, lz] = fanP(ra - 0.012, t);
          K.decor({ cx: lx, cz: lz, hx: 0.07, hz: 0.012, yaw: tanYaw(t), y0: yOf(i - 1) + 0.03, y1: yOf(i - 1) + 0.07 }, 'fixture');
        }
      }
    }
  }
  return seats;
}

function mainFloor(K) {
  K.setGroup('int:south:0');
  const yOf = (i) => ROWS.RISE * (i + 1);
  const seats = rake(K, {
    r0: ROWS.R0, d: ROWS.D, n: ROWS.N, yOf, y0: 0, zn: ROWS.ZN, zs: ROWS.ZS, xFront: ROWS.FRONT_X, walls: [[HOUSE_IN.z0, 1], [HOUSE_IN.z1, -1]],
    faces: { top: 'carpet', nv: RISER, pv: RISER, pu: 'carpet', nu: 'carpet', bottom: 'none' },
    coverRows: (i) => i % 2 === 1, coverAngles: [-0.19, 0.0, 0.19],
    // side sections (between an aisle and the wall) start a few rows back from the stage
    seatSkip: (x, z) => inAisle(x, z) || (Math.abs(z - ZC) > Math.abs(aisleZ(x, -1) - ZC) && Math.hypot(FX - x, z - ZC) < ROWS.R0 + 3 * ROWS.D),
    stepLights: true,
  });
  // rear cross-aisle (level with the last row), cut by the four door wells
  const wells = wellRects();
  for (const s of rearStrips(R_REAR, HOUSE_IN.x0 - 0.05, HOUSE_IN.z0, HOUSE_IN.z1))
    for (const q of subtractRects(s, wells))
      K.box({ cx: (q.x0 + q.x1) / 2, cz: (q.z0 + q.z1) / 2, hx: (q.x1 - q.x0) / 2, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: 0, y1: Y_REAR }, { mat: 'solid', walkable: true, look: 'carpet', faces: { top: 'carpet', pu: '#4a3b30', nu: '#4a3b30', pv: '#4a3b30', nv: '#4a3b30', bottom: 'none' }, role: 'stair' });
  // door-well stairs (ground-floor doors up to the rear cross-aisle) with rails around the wells
  for (const { door: [x, z], dir } of WELLS) {
    if (dir === 'x') {
      K.stairs([HOUSE_IN.x0 + 0.05, z], [HOUSE_IN.x0 + 0.05 + WELL_RUN, z], 0, Y_REAR, 2.0, { look: 'carpet', riserLook: RISER });
      for (const e of [-1, 1]) K.railing([HOUSE_IN.x0, z + e * WELL_HALF], [HOUSE_IN.x0 + WELL_RUN + 0.1, z + e * WELL_HALF], Y_REAR, { style: 'picket' });
    } else {
      K.stairs([x, HOUSE_IN.z1 - 0.05], [x, HOUSE_IN.z1 - 0.05 - WELL_RUN], 0, Y_REAR, 2.0, { look: 'carpet', riserLook: RISER });
      for (const e of [-1, 1]) K.railing([x + e * WELL_HALF, HOUSE_IN.z1 - WELL_RUN - 0.1], [x + e * WELL_HALF, HOUSE_IN.z1], Y_REAR, { style: 'picket' });
    }
  }
  // front cross-aisle + side floor (house floor, y = 0)
  K.decor({ cx: 72.9, cz: (HOUSE_IN.z0 + HOUSE_IN.z1) / 2, hx: 10.95, hz: (HOUSE_IN.z1 - HOUSE_IN.z0) / 2, yaw: 0, y0: 0.04, y1: 0.045 }, 'carpet', { faces: TOP_ONLY('carpet') });
  return seats;
}

function balcony(K) {
  K.setGroup('int:south:1');
  const faces = { top: 'carpet', nv: RISER, pv: RISER, pu: 'carpet', nu: 'carpet', bottom: 'aacCeiling' };
  // front cross-aisle behind the fascia
  const [f0, f1] = arcRange((BAL.FASCIA + BAL.B0) / 2, BAL.ZN, BAL.ZS, FAR);
  for (const b of arcBoxes(BAL.FASCIA, BAL.B0, f0, f1)) K.box({ ...b, y0: BAL.UNDER, y1: BAL.Y }, { mat: 'solid', walkable: true, look: 'carpet', faces, role: 'slab' });
  const seats = rake(K, {
    r0: BAL.B0, d: BAL.D, n: BAL.N, yOf: (j) => BAL.Y + BAL.RISE * (j + 1), y0: BAL.UNDER, zn: BAL.ZN, zs: BAL.ZS, xFront: FAR, walls: [[HOUSE_IN.z1, -1]],
    faces, coverRows: (j) => j % 2 === 0, coverAngles: [-0.2, 0.2],
    seatSkip: (x, z) => z < BAL.ZN + 0.4 || z > BAL.ZS - 0.4 || Math.abs(z - ZC) < 0.6,
    stepLights: false,
  });
  // rear aisle (level with the last balcony row), cut by the upper-lobby door well
  for (const s of rearStrips(R_BAL_REAR, HOUSE_IN.x0 - 0.05, BAL.ZN, HOUSE_IN.z1))
    for (const q of subtractRects(s, [balWellRect()]))
      K.box({ cx: (q.x0 + q.x1) / 2, cz: (q.z0 + q.z1) / 2, hx: (q.x1 - q.x0) / 2, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: BAL.UNDER, y1: Y_BAL_REAR }, { mat: 'solid', walkable: true, look: 'carpet', faces: { ...faces, pu: '#4a3b30', nu: '#4a3b30', pv: '#4a3b30', nv: '#4a3b30' }, role: 'slab' });
  // the upper-lobby door well: stairs from the level-1 lobby deck (4.4) up to the rear aisle
  const H1 = 4.4;
  // sill across the level-1 door: the upper-lobby deck to the foot of the stair
  K.box({ cx: 40.1, cz: BAL_DOOR_Z, hx: 0.32, hz: 1.0, yaw: 0, y0: H1 - 0.3, y1: H1 }, { mat: 'solid', walkable: true, look: 'carpet', faces: { top: 'carpet', bottom: 'aacCeiling' }, role: 'slab' });
  K.stairs([HOUSE_IN.x0 + 0.05, BAL_DOOR_Z], [HOUSE_IN.x0 + 0.05 + WELL_RUN, BAL_DOOR_Z], H1, Y_BAL_REAR, 2.0, { look: 'carpet', riserLook: RISER });
  for (const e of [-1, 1]) K.railing([HOUSE_IN.x0, BAL_DOOR_Z + e * WELL_HALF], [HOUSE_IN.x0 + WELL_RUN + 0.1, BAL_DOOR_Z + e * WELL_HALF], Y_BAL_REAR, { style: 'picket' });
  // curved fascia (plaster with a dark wood cap and a light cove under it) [AAC]
  const [a0, a1] = arcRange(BAL.FASCIA - 0.1, BAL.ZN, BAL.ZS, FAR);
  for (const b of arcBoxes(BAL.FASCIA - 0.22, BAL.FASCIA, a0, a1, 1.6)) {
    K.box({ ...b, y0: 4.45, y1: BAL.Y + 1.0 }, { mat: 'wood', look: 'aacCeiling', faces: { pu: 'aacCeiling', nu: 'aacCeiling', pv: 'aacCeiling', nv: 'aacCeiling', top: '#4a3626', bottom: 'aacCeiling' }, role: 'rail' });
    const [lx, lz] = fanP(BAL.FASCIA - 0.26, b.tm);
    K.decor({ cx: lx, cz: lz, hx: b.hx, hz: 0.03, yaw: b.yaw, y0: 4.5, y1: 4.58 }, 'fixture');
    const [cx, cz] = fanP(BAL.FASCIA - 0.11, b.tm);
    K.decor({ cx, cz, hx: b.hx, hz: 0.16, yaw: b.yaw, y0: BAL.Y + 1.0, y1: BAL.Y + 1.06 }, '#4a3626');
  }
  // downlights in the balcony soffit
  for (let r = BAL.FASCIA + 1.2; r < R_BAL_REAR + 4; r += 2.6) {
    const [t0, t1] = arcRange(r, BAL.ZN + 0.8, BAL.ZS - 0.8, FAR);
    for (let t = t0; t <= t1; t += 3 / r) {
      const [x, z] = fanP(r, t);
      if (x < HOUSE_IN.x0 + 0.5) continue;
      K.decor({ cx: x, cz: z, hx: 0.13, hz: 0.13, yaw: 0, y0: BAL.UNDER - 0.03, y1: BAL.UNDER - 0.005 }, 'fixture', { shape: 'cyl' });
    }
  }
  // north edge: rail over the side stair, the landing, a solid side parapet down to the fascia
  const ye = Y_BAL_REAR;
  K.railing([HOUSE_IN.x0, BAL.ZN + 0.05], [BAL_STAIR.x1 - 0.2, BAL.ZN + 0.05], ye, { style: 'glass' });
  const lx0 = BAL_STAIR.x1 - 0.05;
  const lx1 = BAL_STAIR.x1 + 1.6;
  K.box({ cx: (lx0 + lx1) / 2, cz: (HOUSE_IN.z0 + BAL.ZN + 0.1) / 2, hx: (lx1 - lx0) / 2, hz: (BAL.ZN + 0.1 - HOUSE_IN.z0) / 2, yaw: 0, y0: ye - 0.3, y1: ye }, { mat: 'solid', walkable: true, look: 'carpet', faces: { top: 'carpet', pu: 'aacCeiling', nu: 'aacCeiling', pv: 'aacCeiling', nv: 'aacCeiling', bottom: 'aacCeiling' }, role: 'slab' });
  K.railing([lx1 + 0.05, HOUSE_IN.z0], [lx1 + 0.05, BAL.ZN + 0.05], ye, { style: 'glass' });
  const px0 = lx1 + 0.15;
  const px1 = fanP(BAL.FASCIA, Math.asin((BAL.ZN - ZC) / BAL.FASCIA))[0];
  K.box({ cx: (px0 + px1) / 2, cz: BAL.ZN + 0.02, hx: (px1 - px0) / 2, hz: 0.09, yaw: 0, y0: BAL.UNDER - 0.3, y1: ye + 0.9 }, { mat: 'wood', look: 'aacCeiling', faces: { top: '#4a3626' }, role: 'rail' });
  // side stair from the rear cross-aisle up to the balcony (north strip, open above)
  K.setGroup('int:south:0');
  K.stairs([BAL_STAIR.x0, BAL_STAIR.z], [BAL_STAIR.x1, BAL_STAIR.z], Y_REAR, Y_BAL_REAR, BAL_STAIR.w, { rail: 'glass', look: 'carpet', riserLook: RISER });
  return seats;
}

/** Sound / lighting booth at the balcony rear (south half). */
function booth(K) {
  K.setGroup('int:south:1');
  const y = Y_BAL_REAR;
  const x0 = HOUSE_IN.x0;
  const x1 = 43.3;
  const z0 = 324.6;
  const z1 = 333.4;
  const top = y + 2.5;
  const wallF = { mat: 'wood', look: '#3d3532', faces: { top: '#3d3532' }, role: 'wall' };
  // front: solid knee wall, glass above (open slot at the console), roof
  K.box({ cx: x1, cz: (z0 + z1) / 2, hx: 0.08, hz: (z1 - z0) / 2, yaw: 0, y0: y, y1: y + 1.05 }, wallF);
  K.box({ cx: x1, cz: (z0 + z1) / 2, hx: 0.02, hz: (z1 - z0) / 2 - 0.05, yaw: 0, y0: y + 1.6, y1: top - 0.05 }, { mat: 'glass', look: 'glass', role: 'glass' });
  K.box({ cx: (x0 + x1) / 2, cz: z1, hx: (x1 - x0) / 2, hz: 0.08, yaw: 0, y0: y, y1: top }, wallF);
  K.box({ cx: (x0 + 41.5) / 2, cz: z0, hx: (41.5 - x0) / 2, hz: 0.08, yaw: 0, y0: y, y1: top }, wallF);
  K.box({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2 + 0.08, hz: (z1 - z0) / 2 + 0.08, yaw: 0, y0: top, y1: top + 0.2 }, { mat: 'wood', look: '#3d3532', faces: { bottom: 'aacCeiling' }, role: 'wall' });
  K.decor({ cx: x1, cz: (z0 + z1) / 2, hx: 0.05, hz: (z1 - z0) / 2, yaw: 0, y0: y + 1.55, y1: y + 1.62 }, 'alu');
  // consoles: lighting + sound desks with lit screens, rack, chair
  const desk = K.box({ cx: x1 - 0.5, cz: (z0 + z1) / 2, hx: 0.4, hz: 3.6, yaw: 0, y0: y, y1: y + 0.82 }, { mat: 'wood', hp: 120, look: '#2a2626', faces: { top: '#1a1a1c' }, role: 'prop' });
  for (const [zc, w] of [[327, 1.1], [330.6, 1.4]]) {
    K.decor({ cx: x1 - 0.5, cz: zc, hx: 0.32, hz: w, yaw: 0, y0: y + 0.82, y1: y + 0.92 }, DARK, { dep: desk });
    for (let k = -2; k <= 2; k++) K.decor({ cx: x1 - 0.42, cz: zc + k * (w / 2.6), hx: 0.12, hz: 0.18, yaw: 0, y0: y + 0.925, y1: y + 0.935 }, 'fixture', { dep: desk });
    K.decor({ cx: x1 - 0.78, cz: zc, hx: 0.04, hz: 0.34, yaw: 0, y0: y + 0.95, y1: y + 1.35 }, DARK, { dep: desk });
    K.decor({ cx: x1 - 0.75, cz: zc, hx: 0.01, hz: 0.3, yaw: 0, y0: y + 1.0, y1: y + 1.3 }, 'fixture', { dep: desk });
  }
  K.box({ cx: x0 + 0.4, cz: z1 - 0.6, hx: 0.3, hz: 0.4, yaw: 0, y0: y, y1: y + 1.9 }, { mat: 'metal', hp: 120, look: DARK, role: 'prop' });
  for (const zc of [327, 330.6]) K.decor({ cx: x1 - 1.3, cz: zc, hx: 0.24, hz: 0.24, yaw: 0, y0: y + 0.45, y1: y + 0.55 }, ARM);
  K.decor({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: 0.4, hz: 0.4, yaw: 0, y0: top - 0.03, y1: top - 0.005 }, 'fixture', { shape: 'cyl' });
}

/** Wall finishes: plaster lower walls, angled taupe acoustic panels, exit doors [AAC]. */
function walls(K) {
  K.setGroup('int:south:0');
  const { x0, x1, z0, z1 } = HOUSE_IN;
  const CEIL = 13.9;
  for (const [z, s] of [[z0, 1], [z1, -1]]) {
    // lower plaster band and the plaster frieze above the panels
    K.decor({ cx: (x0 + x1) / 2, cz: z + s * 0.03, hx: (x1 - x0) / 2, hz: 0.03, yaw: 0, y0: 0, y1: 4.7 }, 'aacCeiling');
    K.decor({ cx: (x0 + x1) / 2, cz: z + s * 0.03, hx: (x1 - x0) / 2, hz: 0.03, yaw: 0, y0: 12.4, y1: CEIL }, 'aacCeiling');
    K.decor({ cx: (x0 + x1) / 2, cz: z + s * 0.08, hx: (x1 - x0) / 2, hz: 0.05, yaw: 0, y0: 4.7, y1: 4.82 }, '#8b7f70');
    // angled acoustic panels (sawtooth), alternating taupe / grey
    const bays = [[50.6, 56.4], [56.8, 62.6], [63.0, 68.8], [69.2, 75.0], [75.4, 83.4]];
    bays.forEach(([a, b], k) => {
      const look = k % 2 ? GREY_PANEL : 'acoustic';
      K.decor({ ...K.along([a, z + s * 0.08], [b, z + s * 0.5], 0.12, 4.95, 12.25) }, look);
    });
    for (const [a, b] of [[40.6, 45.0], [45.4, 49.9]]) K.decor({ ...K.along([a, z + s * 0.08], [b, z + s * 0.45], 0.12, 8.4, 12.25) }, 'acoustic');
    // exit door near the front of the house (frame, leaf, push bar, sign)
    const dx = 72.3;
    K.decor({ cx: dx, cz: z + s * 0.04, hx: 1.0, hz: 0.04, yaw: 0, y0: 0, y1: 2.35 }, 'doorFrame');
    K.decor({ cx: dx, cz: z + s * 0.07, hx: 0.9, hz: 0.04, yaw: 0, y0: 0.02, y1: 2.2 }, '#4b4744');
    K.decor({ cx: dx, cz: z + s * 0.1, hx: 0.85, hz: 0.03, yaw: 0, y0: 1.0, y1: 1.06 }, 'railCap');
    K.decor({ cx: dx, cz: z + s * 0.08, hx: 0.01, hz: 0.04, yaw: 0, y0: 0.02, y1: 2.2 }, '#2a2826');
    K.decor({ cx: dx, cz: z + s * 0.1, hx: 0.3, hz: 0.05, yaw: 0, y0: 2.5, y1: 2.78 }, '#c62a2a');
    K.decor({ cx: dx, cz: z + s * 0.16, hx: 0.22, hz: 0.01, yaw: 0, y0: 2.56, y1: 2.72 }, 'fixture');
  }
  // the front (proscenium) wall, house face: plaster with big angled panels each side [AAC]
  const fx = x1 - 0.02;
  for (const [za, zb, s] of [[z0, 304.25, 1], [322.75, z1, -1]]) {
    K.decor({ cx: fx, cz: (za + zb) / 2, hx: 0.03, hz: (zb - za) / 2, yaw: 0, y0: 0, y1: CEIL }, 'aacCeiling');
    const segs = s > 0 ? [[295.5, 298.3, GREY_PANEL], [298.6, 301.7, 'acoustic'], [302.0, 304.1, GREY_PANEL]] : [[322.9, 325.0, GREY_PANEL], [325.3, 328.4, 'acoustic'], [328.7, 335.5, GREY_PANEL]];
    for (const [a, b, look] of segs) K.decor({ ...K.along([fx - 0.08, a], [fx - 0.4, b], 0.12, 3.4, 11.6) }, look);
    // exit door low on the front wall (as in the photo, house left)
    const dz = s > 0 ? 296.9 : 330.1;
    K.decor({ cx: fx - 0.04, cz: dz, hx: 0.04, hz: 1.0, yaw: 0, y0: 0, y1: 2.35 }, 'doorFrame');
    K.decor({ cx: fx - 0.07, cz: dz, hx: 0.04, hz: 0.9, yaw: 0, y0: 0.02, y1: 2.2 }, '#4b4744');
    K.decor({ cx: fx - 0.1, cz: dz, hx: 0.03, hz: 0.85, yaw: 0, y0: 1.0, y1: 1.06 }, 'railCap');
    K.decor({ cx: fx - 0.1, cz: dz, hx: 0.05, hz: 0.3, yaw: 0, y0: 2.5, y1: 2.78 }, '#c62a2a');
    K.decor({ cx: fx - 0.16, cz: dz, hx: 0.01, hz: 0.22, yaw: 0, y0: 2.56, y1: 2.72 }, 'fixture');
  }
  K.decor({ cx: fx, cz: ZC, hx: 0.03, hz: 9.25, yaw: 0, y0: 9.4, y1: CEIL }, 'aacCeiling');
}

/** Light plaster ceiling, curved bulkheads with downlights, the front-of-house lighting slot [AAC]. */
function ceiling(K) {
  K.setGroup('int:south:0');
  const { x0, x1, z0, z1 } = HOUSE_IN;
  const CEIL = 13.9;
  K.decor({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2 + 0.2, hz: (z1 - z0) / 2 + 0.2, yaw: 0, y0: CEIL, y1: CEIL + 0.05 }, 'aacCeiling', { faces: BOTTOM_ONLY('aacCeiling') });
  const bulk = [[19.0, 2.2, 12.3], [28.0, 2.0, 12.6], [37.0, 1.8, 12.9], [45.5, 1.6, 13.1]];
  const inBulk = (x, z) => {
    const r = Math.hypot(FX - x, z - ZC);
    return bulk.some(([r0, w]) => r > r0 - 0.4 && r < r0 + w + 0.4);
  };
  for (const [r0, w, y] of bulk) {
    const [a0, a1] = arcRange(r0 + w / 2, z0 + w * 0.6, z1 - w * 0.6, x1 - w * 0.7);
    for (const b of arcBoxes(r0, r0 + w, a0, a1, 1.8)) {
      K.decor({ ...b, y0: y, y1: CEIL }, 'aacCeiling', { faces: { bottom: 'aacCeiling', nv: '#a39c90', pv: '#c6c0b6', pu: 'none', nu: 'none', top: 'none' } });
      const [rx, rz] = fanP(r0 - 0.04, b.tm);
      K.decor({ cx: rx, cz: rz, hx: b.hx, hz: 0.05, yaw: b.yaw, y0: CEIL - 0.14, y1: CEIL }, DARK, { faces: { ...NONE, nv: DARK } });
      const [lx, lz] = fanP(r0 + w / 2, b.tm);
      K.decor({ cx: lx, cz: lz, hx: 0.14, hz: 0.14, yaw: 0, y0: y - 0.04, y1: y - 0.005 }, 'fixture', { shape: 'cyl' });
    }
  }
  // front-of-house lighting slot with hanging instruments
  const [s0, s1] = arcRange(15.8, z0 + 0.8, z1 - 0.8, x1 - 0.8);
  for (const b of arcBoxes(15.2, 16.4, s0, s1, 1.8)) {
    K.decor({ ...b, y0: CEIL - 0.02, y1: CEIL + 0.01 }, DARK, { faces: BOTTOM_ONLY(DARK) });
    const [ix, iz] = fanP(15.8, b.tm);
    K.decor({ cx: ix, cz: iz, hx: 0.16, hz: 0.24, yaw: b.yaw, y0: CEIL - 0.75, y1: CEIL - 0.4 }, '#151517');
    K.decor({ cx: ix, cz: iz, hx: 0.01, hz: 0.01, yaw: 0, y0: CEIL - 0.4, y1: CEIL }, '#151517');
  }
  // downlight grid in the flat ceiling fields
  for (let x = x0 + 1.6; x < x1 - 1; x += 3.2)
    for (let z = z0 + 1.6; z < z1 - 1; z += 3.2) {
      if (inBulk(x, z) || Math.hypot(FX - x, z - ZC) < 17) continue;
      K.decor({ cx: x, cz: z, hx: 0.18, hz: 0.18, yaw: 0, y0: CEIL - 0.04, y1: CEIL - 0.005 }, 'fixture', { shape: 'cyl' });
    }
  for (const [x, y, z, range] of [[50, 11, ZC, 24], [62, 11, ZC - 8, 24], [62, 11, ZC + 8, 24], [74, 10, ZC, 22]]) K.light({ x, y, z, range, intensity: 1.0, color: 0xfff1dc });
  K.light({ x: 45, y: 4.2, z: ZC, range: 14, intensity: 0.6, color: 0xffeccc });
  K.light({ x: 44, y: 9.5, z: ZC + 6, range: 14, intensity: 0.6, color: 0xffeccc });
}

/** The house: rows, balcony, booth, finishes. Returns { seats, balconySeats }. */
export function buildHouse(K) {
  const seats = mainFloor(K);
  const balconySeats = balcony(K);
  booth(K);
  walls(K);
  ceiling(K);
  // loot: front cross-aisle (house floor), balcony rear aisle, booth floor
  K.loot({ kind: 'item', x: 72, y: 0, z: ZC + 2 });
  K.loot({ kind: 'item', x: 44, y: Y_BAL_REAR, z: 308 });
  K.loot({ kind: 'ammoBox', x: 41.6, y: Y_BAL_REAR, z: 329 });
  return { seats, balconySeats };
}
