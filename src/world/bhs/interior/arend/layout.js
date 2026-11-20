// BENTONVILLE ROYALE — Arend Arts Center (BHS south building): layout numbers + fan geometry (pure).
//
// The house is a fan facing east: every row is an arc around the focal point F, just upstage of
// the proscenium. Rows rise 0.12 m each from the front cross-aisle (house floor, y = 0) to the rear
// cross-aisle; the balcony repeats the fan above the rear rows. Numbers are world metres (x east,
// z south, y up), inside the hero rects south.js hands to buildArend.

export const FX = 90; // fan focal point (x), on the stage
export const ZC = 313.5; // house / proscenium centre line (z)

export const STAGE_Y = 1.08; // stage deck above the house floor (bible: ~1.05 m, apron edge)
export const PROS = Object.freeze({ z0: ZC - 8, z1: ZC + 8, top: STAGE_Y + 7 }); // 16 m x 7 m (23 ft) opening

// main floor: rows 0..ROWS-1, row i spans radius [R0 + i D, R0 + (i + 1) D], top y = RISE (i + 1)
export const ROWS = Object.freeze({ R0: 21.6, D: 0.975, N: 22, RISE: 0.12, FRONT_X: 72.2, ZN: 295.45, ZS: 335.4 });
export const Y_REAR = ROWS.RISE * ROWS.N; // rear cross-aisle (same as the last row)
export const R_REAR = ROWS.R0 + ROWS.N * ROWS.D;

// balcony: fascia at FASCIA, front cross-aisle to B0, rows j = 0..N-1 (D deep, rising RISE), rear aisle
export const BAL = Object.freeze({ FASCIA: 38.5, B0: 39.6, D: 0.95, N: 6, Y: 5.3, RISE: 0.25, UNDER: 4.95, ZN: 297.4, ZS: 335.4 });
export const Y_BAL_REAR = BAL.Y + BAL.RISE * BAL.N;
export const R_BAL_REAR = BAL.B0 + BAL.N * BAL.D;

// side aisles: lines converging on (AISLE_FX, ZC), through (FRONT_X, ZC -/+ AISLE_DZ)
export const AISLE = Object.freeze({ FX: 130, DZ: 8.9, HALF: 0.65 });
export const aisleZ = (x, side) => ZC + side * AISLE.DZ * ((AISLE.FX - x) / (AISLE.FX - ROWS.FRONT_X));

// walls (inner faces, with a margin) and house rear wall
export const HOUSE_IN = Object.freeze({ x0: 40.3, x1: 83.85, z0: 295.15, z1: 335.75 });

// door wells (ground-floor doors in the rear / south walls lead up to the rear cross-aisle)
export const WELLS = Object.freeze([
  { door: [40, 302.5], dir: 'x' },
  { door: [40, 311], dir: 'x' },
  { door: [40, 326.5], dir: 'x' },
  { door: [46, 336], dir: 'z' },
]);
export const WELL_RUN = 4.45;
export const WELL_HALF = 1.15;

// the upper-lobby door into the balcony well (level 1, x = 40) and the north balcony stair
export const BAL_DOOR_Z = 318.5;
export const BAL_STAIR = Object.freeze({ x0: 41.0, x1: 48.6, z: 296.3, w: 1.8 });

/** Point on the fan at radius r, angle th (0 = straight back from the stage, + = south). */
export const fanP = (r, th) => [FX - r * Math.cos(th), ZC + r * Math.sin(th)];
/** Radius / angle of a world point. */
export const fanR = (x, z) => Math.hypot(FX - x, z - ZC);
export const fanTh = (x, z) => Math.atan2(z - ZC, FX - x);
/** Yaw of the tangent at angle th (u axis along the arc, v axis radial outward). */
export const tanYaw = (th) => Math.atan2(Math.cos(th), Math.sin(th));

/** Angle range of an arc at radius r between the walls zn..zs and in front of x <= xFront. */
export function arcRange(r, zn, zs, xFront = ROWS.FRONT_X) {
  let a0 = Math.asin(Math.max(-1, Math.min(1, (zn - ZC) / r)));
  let a1 = Math.asin(Math.max(-1, Math.min(1, (zs - ZC) / r)));
  const c = (FX - xFront) / r;
  if (c < 1) {
    const lim = Math.acos(Math.max(-1, c));
    a0 = Math.max(a0, -lim);
    a1 = Math.min(a1, lim);
  }
  return [a0, a1];
}

/**
 * Chord boxes along an annulus band [r0, r1] over angles [a0, a1]: each { cx, cz, hx, hz, yaw }
 * (hx along the arc). Adjacent bands overlap by the chord sagitta, so the stepped floor has no gaps.
 */
export function arcBoxes(r0, r1, a0, a1, maxChord = 2.2) {
  const rc = (r0 + r1) / 2;
  const n = Math.max(1, Math.ceil((rc * (a1 - a0)) / maxChord));
  const out = [];
  for (let k = 0; k < n; k++) {
    const ta = a0 + ((a1 - a0) * k) / n;
    const tb = a0 + ((a1 - a0) * (k + 1)) / n;
    const tm = (ta + tb) / 2;
    const [cx, cz] = fanP(rc, tm);
    // hz grows by the chord sagitta (+2 cm) so a chord end never leaves a sliver against the next band
    const sag = rc * (1 - Math.cos((tb - ta) / 2)) + 0.02;
    out.push({ cx, cz, hx: rc * Math.sin((tb - ta) / 2) + 0.03, hz: (r1 - r0) / 2 + sag, yaw: tanYaw(tm), tm });
  }
  return out;
}
