// BENTONVILLE ROYALE — Arend Arts Center: the lobby (approximate: no lobby photo).
//
// A two-storey lobby behind the curved glass front [SOU]: terrazzo with dark bands, the ticket /
// concession counter, the gallery wall (blank framed panels only, no artwork), benches, pendant
// lights, and a stair to an upper-lobby deck at level 1 along the house wall; its door well leads
// into the house balcony.

import { BAL_DOOR_Z } from './layout.js';

const NONE = Object.freeze({ pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' });
const H1 = 4.4;
export const LOBBY_IN = Object.freeze({ x0: 18.1, x1: 39.9, z0: 297.2, z1: 335.85 });
export const UPPER = Object.freeze({ A: { x0: 33.6, x1: 39.9, z0: 297.2, z1: 328.0 }, B: { x0: 36.0, x1: 39.9, z0: 328.0, z1: 335.85 } });
const WOOD = '#6b4a33';
const STONE = '#d9d4ca';
const FRAME = '#2b2b2b';

function floorBands(K) {
  const { x0, x1, z1 } = LOBBY_IN;
  const top = (look) => ({ ...NONE, top: look });
  for (const z of [306, 316, 326]) K.decor({ cx: (x0 + x1) / 2, cz: z, hx: (x1 - x0) / 2, hz: 0.6, yaw: 0, y0: 0.041, y1: 0.045 }, 'terrazzoDark', { faces: top('terrazzoDark') });
  for (const x of [24.5, 31]) K.decor({ cx: x, cz: (299 + z1) / 2, hx: 0.6, hz: (z1 - 299) / 2, yaw: 0, y0: 0.042, y1: 0.046 }, 'terrazzoDark', { faces: top('terrazzoDark') });
}

function counter(K) {
  // ticket / concession counter in the south-west corner, back counter and blank menu boards
  const front = K.box({ cx: 22.3, cz: 331.0, hx: 3.3, hz: 0.4, yaw: 0, y0: 0, y1: 1.05 }, { mat: 'wood', look: WOOD, faces: { top: STONE }, role: 'prop' });
  K.decor({ cx: 22.3, cz: 330.95, hx: 3.4, hz: 0.5, yaw: 0, y0: 1.05, y1: 1.1 }, STONE, { dep: front });
  K.decor({ cx: 22.3, cz: 330.57, hx: 3.25, hz: 0.02, yaw: 0, y0: 0.12, y1: 0.18 }, 'fixture', { dep: front });
  K.box({ cx: 18.65, cz: 333.2, hx: 0.35, hz: 1.8, yaw: 0, y0: 0, y1: 1.05 }, { mat: 'wood', look: WOOD, faces: { top: STONE }, role: 'prop' });
  const back = K.box({ cx: 22.2, cz: 335.45, hx: 3.9, hz: 0.38, yaw: 0, y0: 0, y1: 0.92 }, { mat: 'wood', look: '#4a3a2e', faces: { top: STONE }, role: 'prop' });
  K.decor({ cx: 20.2, cz: 335.4, hx: 0.35, hz: 0.25, yaw: 0, y0: 0.92, y1: 1.6 }, '#b02a2a', { dep: back });
  K.decor({ cx: 20.2, cz: 335.13, hx: 0.3, hz: 0.01, yaw: 0, y0: 1.1, y1: 1.5 }, 'glass', { dep: back });
  for (const x of [20, 22.3, 24.6]) K.decor({ cx: x, cz: 335.8, hx: 1.0, hz: 0.03, yaw: 0, y0: 2.2, y1: 3.0 }, '#1f1f21');
  // soffit over the counter with downlights
  K.decor({ cx: 22.2, cz: 333.1, hx: 4.1, hz: 2.75, yaw: 0, y0: 3.3, y1: 3.6 }, 'aacCeiling');
  for (const x of [19.6, 22.2, 24.8]) K.decor({ cx: x, cz: 332.2, hx: 0.15, hz: 0.15, yaw: 0, y0: 3.27, y1: 3.3 }, 'fixture', { shape: 'cyl' });
  K.loot({ kind: 'ammoBox', x: 22.3, y: 1.05, z: 331.0 });
}

function gallery(K) {
  // the gallery wall (west): blank framed panels with picture lights, no artwork
  const tints = ['#e6e1d6', '#d3d8da', '#ddd2c2', '#e2dcd0'];
  let k = 0;
  for (let z = 304; z <= 327; z += 3.2) {
    const w = k % 3 === 1 ? 1.1 : 0.8;
    K.decor({ cx: 18.13, cz: z, hx: 0.03, hz: w, yaw: 0, y0: 1.3, y1: 2.7 }, FRAME);
    K.decor({ cx: 18.17, cz: z, hx: 0.02, hz: w - 0.09, yaw: 0, y0: 1.39, y1: 2.61 }, tints[k % tints.length]);
    K.decor({ cx: 18.25, cz: z, hx: 0.08, hz: 0.25, yaw: 0, y0: 2.92, y1: 2.98 }, FRAME);
    K.decor({ cx: 18.32, cz: z, hx: 0.02, hz: 0.22, yaw: 0, y0: 2.9, y1: 2.93 }, 'fixture');
    k++;
  }
  // a gallery rail line and a plain plaster band above
  K.decor({ cx: 18.14, cz: 315.5, hx: 0.03, hz: 13, yaw: 0, y0: 3.4, y1: 3.45 }, 'railCap');
}

function furniture(K) {
  for (const [x, z] of [[27.6, 304.5], [27.6, 311.5], [27.6, 318.5]]) {
    const b = K.box({ cx: x, cz: z, hx: 0.25, hz: 1.0, yaw: 0, y0: 0.38, y1: 0.46 }, { mat: 'wood', hp: 120, look: '#7a5a3c', role: 'prop' });
    for (const dz of [-0.85, 0.85]) K.decor({ cx: x, cz: z + dz, hx: 0.22, hz: 0.04, yaw: 0, y0: 0, y1: 0.38 }, '#3a3a3c', { dep: b });
  }
  for (const [x, z] of [[20.5, 300.5], [32.8, 299.2]]) {
    K.box({ cx: x, cz: z, hx: 0.45, hz: 0.45, yaw: 0, y0: 0, y1: 0.7 }, { mat: 'block', hp: 160, look: 'none', faces: NONE, role: 'prop' });
    K.decor({ cx: x, cz: z, hx: 0.5, hz: 0.5, yaw: 0, y0: 0, y1: 0.7 }, '#3d3d3f', { shape: 'cyl' });
    K.decor({ cx: x, cz: z, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.7, y1: 1.8 }, '#3d5a35', { shape: 'cyl' });
  }
  // pendant drums in the double-height space
  for (const x of [21.5, 27.5])
    for (const z of [303, 311, 319, 327]) {
      K.decor({ cx: x, cz: z, hx: 0.5, hz: 0.5, yaw: 0, y0: 6.0, y1: 6.35 }, 'fixture', { shape: 'cyl' });
      K.decor({ cx: x, cz: z, hx: 0.01, hz: 0.01, yaw: 0, y0: 6.35, y1: 8.4 }, 'picket');
    }
  K.light({ x: 25, y: 6, z: 308, range: 16, intensity: 0.9, color: 0xfff1dc });
  K.light({ x: 25, y: 6, z: 325, range: 16, intensity: 0.9, color: 0xfff1dc });
  K.light({ x: 37.5, y: 3.6, z: 313, range: 10, intensity: 0.6, color: 0xfff1dc });
}

function upperLobby(K) {
  K.setGroup('int:south:1');
  for (const r of [UPPER.A, UPPER.B]) K.slab(r, H1, { t: 0.35, lookTop: 'terrazzo', lookBottom: 'aacCeiling', lookEdge: 'aacCeiling' });
  K.railing([UPPER.A.x0, UPPER.A.z0], [UPPER.A.x0, UPPER.A.z1], H1, { style: 'glass' });
  K.railing([UPPER.A.x0, UPPER.A.z0], [UPPER.A.x1, UPPER.A.z0], H1, { style: 'glass' });
  K.railing([UPPER.B.x0, UPPER.B.z0], [UPPER.B.x0, UPPER.B.z1], H1, { style: 'glass' });
  // benches + a blank sign panel by the balcony door
  for (const z of [304, 311]) K.box({ cx: 38.9, cz: z, hx: 0.25, hz: 1.0, yaw: 0, y0: H1 + 0.38, y1: H1 + 0.46 }, { mat: 'wood', hp: 120, look: '#7a5a3c', role: 'prop' });
  K.decor({ cx: 39.85, cz: BAL_DOOR_Z - 2.2, hx: 0.03, hz: 0.5, yaw: 0, y0: H1 + 1.4, y1: H1 + 2.2 }, '#2b3036');
  // downlights under the deck
  for (let z = 299; z < 335; z += 3) K.decor({ cx: 37.5, cz: z, hx: 0.15, hz: 0.15, yaw: 0, y0: H1 - 0.385, y1: H1 - 0.35 }, 'fixture', { shape: 'cyl' });
  K.loot({ kind: 'item', x: 37.6, y: H1, z: 306.5 });
  K.setGroup('int:south:0');
  K.stairs([34.8, 335.6], [34.8, UPPER.A.z1 - 0.03], 0, H1, 2.1, { rail: 'glass' });
}

export function buildLobby(K) {
  K.setGroup('int:south:0');
  floorBands(K);
  counter(K);
  gallery(K);
  furniture(K);
  upperLobby(K);
}
