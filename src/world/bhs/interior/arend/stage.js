// BENTONVILLE ROYALE — Arend Arts Center: the stage [AAC; docs/bhs/STYLE_BIBLE.md §1, §4].
//
// A 16 m x 7 m (23 ft) proscenium in a plaster frame; a curved apron 1.08 m above the house floor
// with an orchestra pit rail and stairs up at both sides; a red main traveler (partly open) under a
// gold valance; behind it the wood concert shell of the photo (side towers, back wall, ceiling
// clouds with downlights) set with chairs and stands; black legs and borders, 36 line sets with
// four lit electrics, the fly rail with its rope locks, the gridiron, a cyclorama, a wood floor.

import { ZC, STAGE_Y, PROS } from './layout.js';
import { subtractRects } from '../../kit/builder.js';

const NONE = Object.freeze({ pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' });
const BLACK = '#141416';
const DECK_SIDE = '#1d1c1c';
const RED = '#8e1b1f';
const RED_DARK = '#6e1418';
const GOLD_DARK = '#6e4016';
const PIPE = '#2a2a2c';
const STEEL = '#3a3a3c';

// the building outline steps in to z ~294.6 west of x = 91 (the stage's north-west corner is outside)
export const STAGE_IN = Object.freeze({ x0: 84.0, x1: 107.3, z0: 292.6, z1: 327.5, zDoorSide: 329.75, xDoorSide: 94.5, xStep: 91.3, zStep: 294.85 });
const NOTCH = { x0: 86.7, x1: 89.3, z0: 327.6, z1: 330 };
const APRON = { x0: 76.95, cx: 110, r: 33, z0: 302.4, z1: 324.6, landN: 304.05, landS: 322.95 };

const deckFaces = { top: 'stageWood', pu: DECK_SIDE, nu: DECK_SIDE, pv: DECK_SIDE, nv: DECK_SIDE, bottom: 'none' };
const deckBox = (K, q, y1 = STAGE_Y) =>
  K.box({ cx: (q.x0 + q.x1) / 2, cz: (q.z0 + q.z1) / 2, hx: (q.x1 - q.x0) / 2, hz: (q.z1 - q.z0) / 2, yaw: 0, y0: 0, y1 }, { mat: 'solid', walkable: true, look: 'stageWood', faces: deckFaces, role: 'slab' });

/** Apron front x at z (curved lip). */
export const apronX = (z) => APRON.cx - Math.sqrt(APRON.r * APRON.r - (z - ZC) * (z - ZC));

function deck(K) {
  const S = STAGE_IN;
  const rects = [{ x0: S.x0, x1: S.xStep, z0: S.zStep, z1: S.z1 }, { x0: S.xStep, x1: S.x1, z0: S.z0, z1: S.z1 }, { x0: S.x0, x1: S.xDoorSide, z0: S.z1, z1: S.zDoorSide }];
  for (const r of rects) for (const q of subtractRects(r, [NOTCH])) deckBox(K, q);
  // loading stair from the scene-shop door (south wall) up to the deck
  K.stairs([88, 329.75], [88, 327.65], 0, STAGE_Y, 2.2, { look: 'stageWood', riserLook: DECK_SIDE });
  // apron: side landings + curved centre (strips), black face, wood lip
  deckBox(K, { x0: APRON.x0, x1: S.x0 + 0.05, z0: APRON.z0, z1: APRON.landN });
  deckBox(K, { x0: APRON.x0, x1: S.x0 + 0.05, z0: APRON.landS, z1: APRON.z1 });
  const n = Math.round((APRON.landS - APRON.landN) / 0.6);
  for (let k = 0; k < n; k++) {
    const z0 = APRON.landN + ((APRON.landS - APRON.landN) * k) / n;
    const z1 = APRON.landN + ((APRON.landS - APRON.landN) * (k + 1)) / n;
    const x0 = apronX((z0 + z1) / 2);
    deckBox(K, { x0, x1: S.x0 + 0.05, z0, z1 });
    K.decor({ cx: x0 - 0.02, cz: (z0 + z1) / 2, hx: 0.04, hz: (z1 - z0) / 2 + 0.03, yaw: 0, y0: STAGE_Y - 0.06, y1: STAGE_Y + 0.005 }, '#5a4030');
  }
  // side stairs from the house floor up onto the apron
  for (const z of [(APRON.z0 + APRON.landN) / 2, (APRON.landS + APRON.z1) / 2]) K.stairs([74.75, z], [APRON.x0 + 0.02, z], 0, STAGE_Y, 1.5, { rail: 'picket', look: 'stageWood', riserLook: DECK_SIDE });
  // orchestra pit: dark floor and the pit rail (dark wood, low wall)
  K.decor({ cx: 76.2, cz: ZC, hx: 2.6, hz: (APRON.landS - APRON.landN) / 2, yaw: 0, y0: 0.045, y1: 0.05 }, '#2b2a2c', { faces: { ...NONE, top: '#2b2a2c' } });
  K.box({ cx: 73.6, cz: ZC, hx: 0.15, hz: (APRON.landS - APRON.landN) / 2, yaw: 0, y0: 0, y1: 0.95 }, { mat: 'wood', look: '#2c2420', faces: { top: '#5a4030' }, role: 'rail' });
  // a few pit chairs and stands
  for (let k = 0; k < 8; k++) {
    const z = ZC - 6 + k * 1.7;
    const x = 75.0 + (k % 2) * 0.9;
    K.decor({ cx: x, cz: z, hx: 0.22, hz: 0.22, yaw: 0, y0: 0.43, y1: 0.48 }, BLACK);
    K.decor({ cx: x - 0.2, cz: z, hx: 0.03, hz: 0.2, yaw: 0, y0: 0.48, y1: 0.85 }, BLACK);
    K.decor({ cx: x + 0.45, cz: z, hx: 0.02, hz: 0.24, yaw: 0, y0: 0.95, y1: 1.3 }, PIPE);
  }
}

/** Proscenium frame on the house face of the x = 84 wall. */
function proscenium(K) {
  const x = 83.7;
  const { z0, z1, top } = PROS;
  for (const [a, b] of [[z0 - 1.2, z0], [z1, z1 + 1.2]]) K.decor({ cx: x, cz: (a + b) / 2, hx: 0.17, hz: (b - a) / 2, yaw: 0, y0: STAGE_Y, y1: top + 1.3 }, 'aacCeiling');
  K.decor({ cx: x, cz: ZC, hx: 0.17, hz: (z1 - z0) / 2 + 1.2, yaw: 0, y0: top, y1: top + 1.3 }, 'aacCeiling', { faces: { bottom: '#242322' } });
  // dark reveal returns into the opening
  for (const z of [z0 + 0.05, z1 - 0.05]) K.decor({ cx: 84.1, cz: z, hx: 0.55, hz: 0.05, yaw: 0, y0: STAGE_Y, y1: top }, '#242322');
  K.decor({ cx: 84.1, cz: ZC, hx: 0.55, hz: (z1 - z0) / 2, yaw: 0, y0: top - 0.08, y1: top }, '#242322');
}

/** Pleated drape: alternating narrow vertical boxes between z0..z1 at x, y0..y1. */
function drape(K, x, z0, z1, y0, y1, looks, pleat = 0.2, depth = 0.07) {
  const n = Math.max(1, Math.round((z1 - z0) / pleat));
  for (let k = 0; k < n; k++) {
    const za = z0 + ((z1 - z0) * k) / n;
    const zb = z0 + ((z1 - z0) * (k + 1)) / n;
    const off = k % 2 ? depth : -depth;
    K.decor({ cx: x + off, cz: (za + zb) / 2, hx: 0.06, hz: (zb - za) / 2 + 0.015, yaw: 0, y0, y1 }, looks[k % looks.length]);
  }
}

/** Red main traveler (partly open) + gold valance + red legs. */
function curtain(K) {
  const { z0, z1, top } = PROS;
  const open = 3.9; // half-gap at the centre line
  // two traveler halves, bunched on the leading edges
  drape(K, 84.55, z0 - 1.5, ZC - open, STAGE_Y + 0.02, top + 0.4, [RED, RED_DARK], 0.21, 0.08);
  drape(K, 84.55, ZC + open, z1 + 1.5, STAGE_Y + 0.02, top + 0.4, [RED, RED_DARK], 0.21, 0.08);
  for (const zc of [ZC - open - 0.12, ZC + open + 0.12]) K.decor({ cx: 84.55, cz: zc, hx: 0.16, hz: 0.14, yaw: 0, y0: STAGE_Y + 0.02, y1: top + 0.4 }, RED_DARK);
  // the gold main valance downstage of it (with a darker hem) [AAC]
  drape(K, 84.33, z0 - 0.4, z1 + 0.4, top - 1.45, top + 0.3, ['valance', GOLD_DARK], 0.18, 0.05);
  K.decor({ cx: 84.33, cz: ZC, hx: 0.1, hz: (z1 - z0) / 2 + 0.4, yaw: 0, y0: top - 1.5, y1: top - 1.42 }, GOLD_DARK);
  // track
  K.decor({ cx: 84.55, cz: ZC, hx: 0.05, hz: (z1 - z0) / 2 + 2.5, yaw: 0, y0: top + 0.4, y1: top + 0.5 }, PIPE);
}

/** The wood concert shell from the photo: towers, back wall, ceiling clouds with downlights. */
function shell(K) {
  const y0 = STAGE_Y;
  const yT = 8.6;
  const towers = [[[85.3, 305.9], [96.4, 308.4]], [[85.3, 321.1], [96.4, 318.6]]];
  for (const [a, b] of towers) {
    for (let k = 0; k < 3; k++) {
      const p = [a[0] + ((b[0] - a[0]) * k) / 3, a[1] + ((b[1] - a[1]) * k) / 3];
      const q = [a[0] + ((b[0] - a[0]) * (k + 1)) / 3, a[1] + ((b[1] - a[1]) * (k + 1)) / 3];
      const part = K.box({ ...K.along(p, q, 0.22, y0, yT) }, { mat: 'wood', look: 'stageWood', faces: { top: '#7d5d44' }, role: 'wall' });
      // vertical panel reveals on the audience face
      for (let j = 1; j < 4; j++) {
        const t = j / 4;
        const c = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        K.decor({ cx: c[0], cz: c[1] + (a[1] < ZC ? 0.12 : -0.12), hx: 0.02, hz: 0.01, yaw: 0, y0, y1: yT }, '#6b4e38', { dep: part });
      }
    }
  }
  const back = K.box({ cx: 96.55, cz: ZC, hx: 0.12, hz: 5.1, yaw: 0, y0, y1: yT }, { mat: 'wood', look: 'stageWood', faces: { top: '#7d5d44' }, role: 'wall' });
  for (let j = -4; j <= 4; j++) K.decor({ cx: 96.42, cz: ZC + j * 1.13, hx: 0.01, hz: 0.02, yaw: 0, y0, y1: yT }, '#6b4e38', { dep: back });
  // ceiling clouds stepping up toward the audience, downlights under each
  const clouds = [[85.4, 89.2, 9.0], [89.4, 93.0, 8.75], [93.2, 96.6, 8.5]];
  for (const [xa, xb, y] of clouds) {
    const zh = 6.6 - (xa - 85.4) * 0.2;
    K.decor({ cx: (xa + xb) / 2, cz: ZC, hx: (xb - xa) / 2, hz: zh, yaw: 0, y0: y, y1: y + 0.18 }, 'stageWood', { faces: { bottom: 'stageWood', top: '#7d5d44', pu: '#6b4e38', nu: '#6b4e38', pv: '#6b4e38', nv: '#6b4e38' } });
    for (let x = xa + 0.6; x < xb - 0.3; x += 1.25)
      for (let z = ZC - zh + 0.8; z < ZC + zh - 0.5; z += 1.5) K.decor({ cx: x, cz: z, hx: 0.11, hz: 0.11, yaw: 0, y0: y - 0.03, y1: y }, 'fixture', { shape: 'cyl' });
  }
  // concert set: chairs + music stands on arcs facing the house, a podium
  const cx = 85.6;
  for (const [r, n] of [[3.0, 8], [4.6, 12], [6.2, 15], [7.8, 17]]) {
    for (let k = 0; k < n; k++) {
      const a = -0.95 + (1.9 * (k + 0.5)) / n;
      const x = cx + Math.cos(a) * r;
      const z = ZC + Math.sin(a) * r;
      if (x > 95.8) continue;
      const yaw = a; // u points away from the conductor: chair back on +u
      K.decor({ cx: x, cz: z, hx: 0.22, hz: 0.22, yaw, y0: y0 + 0.43, y1: y0 + 0.48 }, BLACK);
      K.decor({ cx: x + Math.cos(a) * 0.21, cz: z + Math.sin(a) * 0.21, hx: 0.025, hz: 0.21, yaw, y0: y0 + 0.48, y1: y0 + 0.88 }, BLACK);
      K.decor({ cx: x, cz: z, hx: 0.18, hz: 0.18, yaw, y0, y1: y0 + 0.43 }, '#5d5f62', { faces: { ...NONE, pu: '#5d5f62', nu: '#5d5f62' } });
      const sx = x - Math.cos(a) * 0.55;
      const sz = z - Math.sin(a) * 0.55;
      K.decor({ cx: sx, cz: sz, hx: 0.012, hz: 0.012, yaw: 0, y0, y1: y0 + 1.0 }, PIPE);
      K.decor({ cx: sx, cz: sz, hx: 0.02, hz: 0.25, yaw, y0: y0 + 1.0, y1: y0 + 1.36 }, PIPE);
    }
  }
  K.box({ cx: cx + 0.3, cz: ZC, hx: 0.5, hz: 0.5, yaw: 0, y0, y1: y0 + 0.2 }, { mat: 'wood', look: '#2a2626', role: 'prop' });
}

/** Wings (black legs + borders), line sets, electrics, fly rail, grid, cyclorama, wall paint. */
function flyLoft(K) {
  const S = STAGE_IN;
  const y0 = STAGE_Y;
  // black legs each side, borders across
  for (const x of [88.2, 92.4, 97.6, 101.8]) {
    for (const [a, b] of [[300.6, 305.4], [321.6, 326.4]]) K.decor({ cx: x, cz: (a + b) / 2, hx: 0.06, hz: (b - a) / 2, yaw: 0, y0, y1: 11.2 }, BLACK);
    K.decor({ cx: x, cz: ZC, hx: 0.06, hz: 13.2, yaw: 0, y0: 9.6, y1: 11.2 }, BLACK);
  }
  // 36 line sets: battens across the stage; four electrics low with instruments, the rest flown out
  const electrics = new Set([2, 9, 17, 26]);
  for (let k = 0; k < 36; k++) {
    const x = 85.2 + k * 0.57;
    const elec = electrics.has(k);
    const y = elec ? 9.3 : 16.6 + ((k * 7) % 5) * 0.35;
    K.decor({ cx: x, cz: ZC, hx: 0.03, hz: 13.6, yaw: 0, y0: y, y1: y + 0.06 }, PIPE);
    for (const z of [ZC - 10, ZC, ZC + 10]) K.decor({ cx: x, cz: z, hx: 0.005, hz: 0.005, yaw: 0, y0: y + 0.06, y1: 18.6 }, '#6c6c6e');
    if (elec) {
      for (let j = 0; j < 16; j++) {
        const z = ZC - 11.25 + j * 1.5;
        K.decor({ cx: x, cz: z, hx: 0.17, hz: 0.14, yaw: 0, y0: y - 0.42, y1: y - 0.02 }, BLACK);
        K.decor({ cx: x - 0.18, cz: z, hx: 0.01, hz: 0.1, yaw: 0, y0: y - 0.34, y1: y - 0.12 }, 'fixture');
      }
      K.decor({ cx: x, cz: ZC, hx: 0.06, hz: 13.4, yaw: 0, y0: y + 0.08, y1: y + 0.16 }, BLACK);
    }
  }
  // fly rail on the north wall: locking rail + rope locks + purchase lines + arbor track, a gallery
  K.box({ cx: 95.5, cz: 295.6, hx: 10.8, hz: 0.18, yaw: 0, y0, y1: y0 + 1.05 }, { mat: 'metal', look: STEEL, faces: { top: '#5a5a5c' }, role: 'prop' });
  for (let k = 0; k < 36; k++) {
    const x = 85.2 + k * 0.57;
    K.decor({ cx: x, cz: 295.45, hx: 0.012, hz: 0.012, yaw: 0, y0: y0 + 1.05, y1: 18.2 }, '#c9b48a');
    K.decor({ cx: x, cz: 295.83, hx: 0.04, hz: 0.06, yaw: 0, y0: y0 + 0.8, y1: y0 + 1.0 }, '#b03028');
  }
  K.decor({ cx: 95.5, cz: 295.2, hx: 10.8, hz: 0.08, yaw: 0, y0, y1: 18.4 }, '#2a2a2c');
  K.decor({ cx: 95.5, cz: 296.0, hx: 10.8, hz: 0.9, yaw: 0, y0: 9.0, y1: 9.15 }, STEEL, { faces: { top: '#4a4a4c', bottom: STEEL, pu: STEEL, nu: STEEL, pv: STEEL, nv: STEEL } });
  K.decor({ cx: 95.5, cz: 296.9, hx: 10.8, hz: 0.03, yaw: 0, y0: 9.15, y1: 10.2 }, 'railCap');
  K.decor({ cx: 95.5, cz: 296.9, hx: 10.8, hz: 0.06, yaw: 0, y0: 10.15, y1: 10.22 }, 'railCap');
  // gridiron
  for (let x = 85; x < 107; x += 1.4) K.decor({ cx: x, cz: ZC - 1, hx: 0.08, hz: 15.5, yaw: 0, y0: 18.6, y1: 18.8 }, STEEL);
  // cyclorama + ground-row lights
  K.decor({ cx: 106.2, cz: ZC - 0.5, hx: 0.05, hz: 14, yaw: 0, y0: y0 + 0.4, y1: 15.5 }, '#c4d3e2');
  for (let z = ZC - 13; z <= ZC + 12; z += 1.4) {
    K.decor({ cx: 105.4, cz: z, hx: 0.25, hz: 0.6, yaw: 0, y0, y1: y0 + 0.3 }, BLACK);
    K.decor({ cx: 105.66, cz: z, hx: 0.01, hz: 0.5, yaw: 0, y0: y0 + 0.08, y1: y0 + 0.26 }, 'fixture');
  }
  // dark stage-house walls (north, south) above the deck
  K.decor({ cx: (S.xStep + S.x1) / 2, cz: 292.45, hx: (S.x1 - S.xStep) / 2, hz: 0.04, yaw: 0, y0, y1: 19.0 }, '#232325');
  K.decor({ cx: (S.x0 + S.xStep) / 2, cz: 292.45, hx: (S.xStep - S.x0) / 2, hz: 0.04, yaw: 0, y0: 9.0, y1: 19.0 }, '#232325');
  K.decor({ cx: (S.x0 + S.xStep) / 2 - 0.1, cz: 294.8, hx: (S.xStep - S.x0) / 2 - 0.1, hz: 0.03, yaw: 0, y0, y1: 8.8 }, '#232325');
  K.decor({ cx: 101.1, cz: 327.65, hx: 6.2, hz: 0.04, yaw: 0, y0: y0, y1: 19.0 }, '#232325');
  K.decor({ cx: (S.x0 + S.x1) / 2, cz: 310, hx: (S.x1 - S.x0) / 2, hz: 17.6, yaw: 0, y0: 18.95, y1: 19.0 }, '#232325', { faces: { ...NONE, bottom: '#232325' } });
  // work lights
  K.light({ x: 90, y: 8, z: ZC, range: 18, intensity: 1.1, color: 0xffe7c4 });
  K.light({ x: 101, y: 9, z: ZC, range: 16, intensity: 0.7, color: 0xdfe8ff });
}

export function buildStage(K) {
  K.setGroup('int:south:0');
  deck(K);
  proscenium(K);
  curtain(K);
  shell(K);
  flyLoft(K);
  K.loot({ kind: 'chest', x: 100.5, y: STAGE_Y, z: 300.2, yaw: Math.PI / 2 });
}
