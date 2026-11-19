// BENTONVILLE ROYALE — Bentonville High School: library hero interior (library subagent,
// docs/bhs/BHS_CONTRACT.md). Called by src/world/bhs/south.js with the kit K and ctx (hero rects,
// plan, storey height). Builds ONLY inside ctx.LIBRARY, with kit pieces and kit looks.
//
// From the reference photos (docs/bhs/STYLE_BIBLE.md §1 library palette, §4 library) [LIB, LI2]:
//   - a two-storey atrium: tall window bays between brick piers down one side (west), white walls
//   - an L-shaped second-floor gallery (north + east) with a white balustrade on white columns,
//     reached by an open stair; low lay-in tile ceilings with fluorescent fixtures under it
//   - long parallel rows of low shelving (1.5 m, maple tops, white end panels), taller perimeter
//     shelving (2.1 m), grey carpet with red-maroon aisle bands
//   - black lounge chairs, a computer zone with maple tables and navy chairs [LI2], displays, plants
//   - pendant lights high in the atrium. Signs and banners are blank.
// The plan engine already built the room's walls, doors, the raised clerestory volume and its roof.
//
// Layout (world metres, x east, z south): the room is x 41..94, z 383..428.5, open to 11.2 m.
//   gallery (y = 4.4): east strip x 76..94 (full depth), north strip z 383..391.5 (x 41..76)
//   stair: from the atrium floor (x 67.6) east up to the gallery edge (x 76) at z 418
//   atrium floor: lounge (north), 6 low rows north-south, cross rows south, reading tables (east)
//   under the east gallery: rows east-west, the computer zone (south) [LI2]; circulation desk (north)

import { shelfRun, table, chair, loungeChair, computer, plant, floorPatch, ceilingPatch } from './furniture.js';

/** @param {ReturnType<import('../../kit/builder.js').createKit>} K @param {object} ctx */
export function buildLibrary(K, ctx) {
  const R = ctx.LIBRARY;
  const MY = ctx.H; // gallery floor = the 2nd floor level (4.4)
  const TOP = R.top; // 11.2: the raised volume's roof slab (underside 10.7)
  // inner faces of the surrounding walls (partitions 0.2 thick on x0 / z0 / x1; the south wall is the
  // slanted exterior outline edge, 0.35 thick): everything stays inside these
  const X0 = R.x0 + 0.12;
  const X1 = R.x1 - 0.12;
  const Z0 = R.z0 + 0.12;
  const zS = (x) => 428 + ((x - 40.1) * 1.1) / 71.3 - 0.2; // inner face of the south wall at x
  const Z1 = Math.min(R.z1, zS(R.x0)); // conservative south limit (≈ 427.8)
  const GX = 76; // gallery edge (east strip starts here)
  const GZ = 391.5; // gallery edge (north strip ends here)
  const CEIL_LO = 3.5; // lay-in ceiling under the gallery
  const FL = 0.06; // carpet floor top
  const STAIR = { z: 418, x0: 67.6, w: 2.2 };
  const DOOR_S = [53.0, 55.8]; // the plan's exterior door in the south wall (x range, keep clear)
  const DOOR_N = [49.4, 52.6]; // door on the north partition (x0 + 10, 2.4 wide)
  const DOOR_W = [387.7, 390.3]; // door on the west partition (z0 + 6, 1.8 wide)
  const rnd = K.rnd;
  const loot = [];

  // ================================================================ ground level (int:south:0)
  K.setGroup('int:south:0');

  // ---- floor: grey carpet on a thin walkable floor slab, red-maroon bands in the aisles [LIB, LI2]
  // (a real collider 6 cm up rather than a floor decal: the map's ground layers fight a decal there)
  const faces = { top: 'carpet', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' };
  K.box({ cx: (R.x0 + R.x1) / 2, cz: (Z0 + Z1) / 2, hx: (R.x1 - R.x0) / 2, hz: (Z1 - Z0) / 2, yaw: 0, y0: -0.1, y1: FL }, { mat: 'solid', walkable: true, look: 'carpet', faces, role: 'floor' });
  {
    // the south wall slants south going east: carpet strips up to it (kept inside the rect)
    const zLim = R.z1 - 0.02;
    const xm = 40.1 + ((zLim + 0.2 - 428) * 71.3) / 1.1; // the wall face reaches zLim here
    K.decor({ ...K.along([R.x0 + 0.01, zS(R.x0 + 0.01) - 0.41], [xm - 0.02, zS(xm - 0.02) - 0.41], 0.8, FL - 0.012, FL) }, 'carpet', { faces });
    K.decor({ cx: (xm + R.x1) / 2, cz: (Z1 + zLim) / 2, hx: (R.x1 - xm) / 2, hz: (zLim - Z1) / 2, yaw: 0, y0: FL - 0.012, y1: FL }, 'carpet', { faces });
  }
  const band = (x0, x1, z0, z1) => floorPatch(K, x0, x1, z0, z1, FL + 0.004, 'carpetBand');

  // ---- gallery structure: white columns along the gallery edges (they carry the slab)
  const colZ = [391.5, 399.5, 407.5, 414.0, 423.0];
  const colX = [48, 56, 64, 72];
  const column = (x, z) => {
    const p = K.box({ cx: x, cz: z, hx: 0.28, hz: 0.28, yaw: 0, y0: 0, y1: MY - 0.4 }, { mat: 'block', look: 'libWall', role: 'column' });
    K.decor({ cx: x, cz: z, hx: 0.3, hz: 0.3, yaw: 0, y0: 0, y1: 0.12 }, 'base', { dep: p });
  };
  for (const z of colZ) column(GX, z);
  for (const x of colX) column(x, GZ);

  // ---- lay-in tile ceiling + fluorescent fixtures under the gallery (the low parts) [LI2]
  const lowCeil = [
    { x0: GX, x1: X1, z0: Z0, z1: Z1 },
    { x0: X0, x1: GX, z0: Z0, z1: GZ },
  ];
  for (const c of lowCeil) {
    ceilingPatch(K, c.x0, c.x1, c.z0, c.z1, CEIL_LO);
    for (let x = c.x0 + 1.4; x < c.x1 - 0.8; x += 2.4)
      for (let z = c.z0 + 1.6; z < c.z1 - 0.8; z += 3.0) K.decor({ cx: x, cz: z, hx: 0.3, hz: 0.6, yaw: 0, y0: CEIL_LO - 0.02, y1: CEIL_LO + 0.005 }, 'fixture');
  }
  // the gallery fascia: a white band from the low ceiling up to the slab edge
  K.decor({ cx: GX + 0.08, cz: (GZ + Z1) / 2, hx: 0.08, hz: (Z1 - GZ) / 2, yaw: 0, y0: CEIL_LO, y1: MY - 0.4 }, 'libWall');
  K.decor({ cx: (X0 + GX) / 2, cz: GZ - 0.08, hx: (GX - X0) / 2, hz: 0.08, yaw: 0, y0: CEIL_LO, y1: MY - 0.4 }, 'libWall');
  for (const [x, z] of [[85, 388], [85, 398], [85, 408], [85, 418], [85, 425], [50, 387.5], [66, 387.5]]) K.light({ x, y: CEIL_LO - 0.3, z, range: 11, intensity: 0.7, color: 0xf4f6ff });

  // ---- west wall: brick piers with tall window bays between them (the atrium's window side) [LIB]
  const pierZ = [];
  for (let k = 0; k < 7; k++) pierZ.push(393.4 + k * 5.6);
  const PX = X0 + 0.35; // pier centre x
  const PH = 0.8; // pier half width (1.6 m brick piers)
  for (const z of pierZ) {
    const p = K.box({ cx: PX, cz: z, hx: 0.35, hz: PH, yaw: 0, y0: 0, y1: TOP - 0.55 }, { mat: 'brick', look: 'libPier', role: 'pier' });
    K.decor({ cx: PX, cz: z, hx: 0.38, hz: PH + 0.03, yaw: 0, y0: 0, y1: 0.16 }, 'base', { dep: p });
  }
  for (let k = 0; k + 1 < pierZ.length; k++) {
    const z0 = pierZ[k] + PH;
    const z1 = pierZ[k + 1] - PH;
    const zc = (z0 + z1) / 2;
    const hz = (z1 - z0) / 2;
    // white backing (hides the punched windows of the plan wall behind) and the tall glass bay
    K.decor({ cx: X0 + 0.04, cz: zc, hx: 0.04, hz, yaw: 0, y0: 2.1, y1: TOP - 0.55 }, 'libWall');
    K.decor({ cx: X0 + 0.1, cz: zc, hx: 0.02, hz: hz - 0.05, yaw: 0, y0: 4.9, y1: TOP - 0.8 }, 'glass');
    for (const y of [4.9, 6.9, 8.4, TOP - 0.8]) K.decor({ cx: X0 + 0.14, cz: zc, hx: 0.04, hz, yaw: 0, y0: y - 0.06, y1: y + 0.06 }, 'shelfEnd');
    for (const z of [z0 + 0.06, zc - hz / 3, zc + hz / 3, z1 - 0.06]) K.decor({ cx: X0 + 0.14, cz: z, hx: 0.04, hz: 0.06, yaw: 0, y0: 4.9, y1: TOP - 0.8 }, 'shelfEnd');
    K.decor({ cx: X0 + 0.25, cz: zc, hx: 0.18, hz, yaw: 0, y0: 4.75, y1: 4.85 }, 'sillIn');
    // tall perimeter shelving below each bay (2.1 m) [LIB]
    shelfRun(K, [X0 + 0.23, z0 + 0.05], [X0 + 0.23, z1 - 0.05], { h: 2.1, depth: 0.42, sides: [-1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.8 });
  }
  // blank dark banners on two piers (the real ones carry text: left blank) [LIB]
  for (const z of [pierZ[2], pierZ[4]]) K.decor({ cx: PX + 0.38, cz: z, hx: 0.02, hz: 0.5, yaw: 0, y0: 5.2, y1: 8.4 }, 'banner');

  // ---- atrium floor: 6 long low rows north-south beside the gallery, maroon cross and aisle bands [LIB]
  const rowX = [54.8, 58.4, 62.0, 65.6, 69.2, 72.8];
  const ROW_Z = [398.5, 412.5];
  band(52.4, 75.2, ROW_Z[0] - 2.2, ROW_Z[0] - 1.2);
  band(52.4, 75.2, ROW_Z[1] + 1.0, ROW_Z[1] + 2.0);
  for (let i = 0; i + 1 < rowX.length; i++) band((rowX[i] + rowX[i + 1]) / 2 - 0.45, (rowX[i] + rowX[i + 1]) / 2 + 0.45, ROW_Z[0] - 1.2, ROW_Z[1] + 1.0);
  for (const x of rowX) shelfRun(K, [x, ROW_Z[0]], [x, ROW_Z[1]], { h: 1.5, depth: 0.9 });
  // display items on the row tops (book stands, small blank sign holders) [LIB]
  for (let i = 0; i < rowX.length; i++) {
    for (let k = 0; k < 6; k++) {
      const z = ROW_Z[0] + 0.8 + k * 2.2 + rnd() * 1.0;
      K.decor({ cx: rowX[i] + (rnd() - 0.5) * 0.4, cz: z, hx: 0.1, hz: 0.07, yaw: rnd() * 0.6, y0: 1.535, y1: 1.535 + 0.2 + rnd() * 0.12 }, ['#c9b48a', '#8a2f2f', '#2f4f7a', '#e2dccf', '#3d6b4a'][(k + i) % 5]);
    }
    K.decor({ cx: rowX[i], cz: ROW_Z[0] - 0.05, hx: 0.2, hz: 0.01, yaw: 0, y0: 1.2, y1: 1.4 }, '#f4f2ee');
  }
  // short east-west islands near the window wall, and a reading table [LIB]
  for (const z of [399.0, 402.4, 405.8, 409.2]) shelfRun(K, [43.9, z], [50.6, z], { h: 1.5, depth: 0.9 });
  const readT = table(K, 47.2, 413.2, 3.0, 1.2, 0);
  for (const dx of [-0.8, 0.8]) {
    chair(K, 47.2 + dx, 412.25, Math.PI / 2);
    chair(K, 47.2 + dx, 414.15, -Math.PI / 2);
  }
  loot.push({ kind: 'item', x: readT.cx + 0.5, z: readT.cz, y: readT.y1, yaw: 0 });

  // cross rows east-west at the south end (the aisle to the south door stays clear)
  const crossZ = [416.6, 419.8, 423.0];
  for (const z of crossZ) {
    shelfRun(K, [44.6, z], [DOOR_S[0] - 0.6, z], { h: 1.5, depth: 0.9 });
    shelfRun(K, [DOOR_S[1] + 1.4, z], [65.6, z], { h: 1.5, depth: 0.9 });
  }
  // low under-window shelving along the south wall (the plan wall has punched windows, sill 0.85)
  for (const [x0, x1] of [[X0 + 0.9, DOOR_S[0] - 0.4], [DOOR_S[1] + 0.4, 66], [GX + 1, X1 - 0.4]]) {
    const zz0 = Math.min(zS(x0) - 0.22, R.z1 - 0.23);
    const zz1 = Math.min(zS(x1) - 0.22, R.z1 - 0.23);
    shelfRun(K, [x1, zz1], [x0, zz0], { h: 0.8, depth: 0.4, sides: [1], levels: [0.08, 0.42], seg: 4.8 });
  }

  // ---- lounge in front of the rows: black lounge chairs facing them; plants, a display [LIB]
  for (const x of [56.6, 60.2, 63.8, 67.4, 71.0]) loungeChair(K, x, 395.4, Math.PI / 2, FL);
  plant(K, 74.3, 393.6, FL, 1.4);
  plant(K, 52.6, 393.8, FL, 1.2);
  {
    const p = K.box({ cx: 52.8, cz: 396.6, hx: 0.45, hz: 0.45, yaw: 0, y0: 0, y1: 0.95 }, { mat: 'wood', look: 'shelfEnd', role: 'prop' });
    K.decor({ cx: 52.8, cz: 396.6, hx: 0.42, hz: 0.42, yaw: 0, y0: 0.95, y1: 1.55 }, 'railGlass', { dep: p });
    K.decor({ cx: 52.8, cz: 396.6, hx: 0.12, hz: 0.12, yaw: 0.5, y0: 0.95, y1: 1.25 }, '#7a3a3a', { dep: p });
  }

  // ---- the open stair up to the gallery (east, landing at the gallery edge) [LIB]
  K.stairs([STAIR.x0, STAIR.z], [GX, STAIR.z], 0, MY, STAIR.w, { rail: 'glass' });

  // ---- under the east gallery: circulation desk, rows east-west, the computer zone [LI2]
  {
    // circulation desk (maple top, white front), north end
    const d1 = K.box({ cx: 84, cz: 388.2, hx: 3.2, hz: 0.4, yaw: 0, y0: 0, y1: 1.08 }, { mat: 'wood', look: 'shelfEnd', faces: { top: 'shelfWood' }, role: 'desk' });
    const d2 = K.box({ cx: 80.4, cz: 386.4, hx: 0.4, hz: 1.4, yaw: 0, y0: 0, y1: 1.08 }, { mat: 'wood', look: 'shelfEnd', faces: { top: 'shelfWood' }, role: 'desk' });
    K.decor({ cx: 84, cz: 388.2, hx: 3.22, hz: 0.42, yaw: 0, y0: 0, y1: 0.1 }, 'base', { dep: d1 });
    K.decor({ cx: 80.4, cz: 386.4, hx: 0.42, hz: 1.42, yaw: 0, y0: 0, y1: 0.1 }, 'base', { dep: d2 });
    computer(K, 85.5, 388.2, -Math.PI / 2, d1.y1, d1);
    loot.push({ kind: 'item', x: 82.6, z: 388.2, y: d1.y1, yaw: 0 });
  }
  // tall perimeter shelving along the east and north walls (under the gallery)
  shelfRun(K, [X1 - 0.22, 391.0], [X1 - 0.22, 412.0], { h: 2.1, depth: 0.42, sides: [1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.2 });
  shelfRun(K, [DOOR_N[1] + 1.0, Z0 + 0.22], [GX - 1.0, Z0 + 0.22], { h: 2.1, depth: 0.42, sides: [1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.2 });
  shelfRun(K, [X0 + 2.0, Z0 + 0.22], [DOOR_N[0] - 0.8, Z0 + 0.22], { h: 2.1, depth: 0.42, sides: [1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.2 });
  for (const x of [79.4, 83.0]) shelfRun(K, [x, 392.6], [x, 408.0], { h: 1.5, depth: 0.9 });
  shelfRun(K, [89.8, 396.0], [89.8, 410.5], { h: 1.5, depth: 0.9 });
  // computer zone: long maple tables running north-south, all-in-ones down the middle, navy chairs [LI2]
  const pcT = [];
  for (const [xc, zc] of [[86.0, 414.4], [86.0, 420.4], [80.6, 415.2], [80.6, 421.2]]) {
    const t = table(K, xc, zc, 5.4, 1.2, Math.PI / 2);
    pcT.push(t);
    for (const dz of [-1.8, 0, 1.8]) {
      computer(K, xc - 0.2, zc + dz, Math.PI, t.y1, t);
      chair(K, xc - 0.95, zc + dz + (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4, FL);
      if (dz !== 0) chair(K, xc + 0.95, zc + dz + 0.5 + (rnd() - 0.5) * 0.3, Math.PI + (rnd() - 0.5) * 0.4, FL);
    }
  }
  loot.push({ kind: 'ammoBox', x: pcT[1].cx + 0.3, z: pcT[1].cz + 0.9, y: pcT[1].y1, yaw: 0 });
  // a white pier under the gallery hung with art (plain colour panels: no copied artwork) [LI2]
  {
    const p = K.box({ cx: 89.4, cz: 425.0, hx: 0.35, hz: 0.35, yaw: 0, y0: 0, y1: CEIL_LO }, { mat: 'block', look: 'libWall', role: 'column' });
    for (const [z, c] of [[424.78, '#b04a3a'], [425.24, '#c58a3a']]) {
      K.decor({ cx: 89.78, cz: z, hx: 0.025, hz: 0.19, yaw: 0, y0: 1.95, y1: 2.6 }, '#2a2a2d', { dep: p });
      K.decor({ cx: 89.81, cz: z, hx: 0.01, hz: 0.15, yaw: 0, y0: 2.0, y1: 2.55 }, c, { dep: p });
    }
  }
  // blank framed pictures (student art in the photo: drawn as plain colour panels) [LI2]
  for (const [z, c] of [[397, '#b04a3a'], [400.5, '#2f4f7a'], [404, '#c58a3a']]) K.decor({ cx: X1 - 0.03, cz: z, hx: 0.02, hz: 0.55, yaw: 0, y0: 2.3, y1: 3.1 }, c);
  plant(K, X1 - 0.6, 413.6, 0, 1.0);

  // ================================================================ gallery level (int:south:1)
  K.setGroup('int:south:1');
  const east = { x0: GX, x1: X1, z0: Z0, z1: Z1 };
  const north = { x0: X0, x1: GX, z0: Z0, z1: GZ };
  K.slab(east, MY, { t: 0.4, lookTop: 'carpet', lookBottom: 'ceilingTile', lookEdge: 'libWall' });
  K.slab(north, MY, { t: 0.4, lookTop: 'carpet', lookBottom: 'ceilingTile', lookEdge: 'libWall' });
  floorPatch(K, GX + 1.0, GX + 2.0, Z0 + 1, Z1 - 1, MY + 0.006, 'carpetBand');
  // white balustrade (glass rail on a white solid parapet) along both gallery edges, open at the stair
  const sz0 = STAIR.z - STAIR.w / 2 - 0.05;
  const sz1 = STAIR.z + STAIR.w / 2 + 0.05;
  const balustrade = (a, b, off) => {
    K.railing(a, b, MY, { style: 'glass' });
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const nx = (-dz / L) * off;
    const nz = (dx / L) * off;
    K.decor({ ...K.along([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], 0.1, MY, MY + 0.95) }, 'libWall');
    K.decor({ ...K.along([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], 0.16, MY + 0.95, MY + 1.0) }, 'shelfWood');
  };
  // (the left normal of a south-running line is -x, of an east-running line +z: off < 0 -> on the gallery)
  balustrade([GX, GZ], [GX, sz0], -0.12);
  balustrade([GX, sz1], [GX, Z1], -0.12);
  balustrade([X0, GZ], [GX, GZ], -0.12);
  // gallery furniture: tall shelving on the walls, low rows, reading tables, lounge chairs [LIB]
  shelfRun(K, [X1 - 0.22, Z0 + 1.0], [X1 - 0.22, Z1 - 1.0], { h: 2.1, depth: 0.42, sides: [1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.8, y: MY });
  shelfRun(K, [X0 + 1.0, Z0 + 0.22], [GX - 1.0, Z0 + 0.22], { h: 2.1, depth: 0.42, sides: [1], levels: [0.1, 0.5, 0.9, 1.3, 1.7], seg: 4.8, y: MY });
  for (const z of [386.5, 389.9, 393.3, 396.7]) shelfRun(K, [82.0, z], [91.0, z], { h: 1.5, depth: 0.9, y: MY });
  const galT = [];
  for (const z of [406, 412, 418, 424]) {
    const t = table(K, 86.5, z, 3.0, 1.2, 0, { y: MY });
    galT.push(t);
    for (const dx of [-0.8, 0.8]) {
      chair(K, 86.5 + dx, z - 0.95, Math.PI / 2, MY);
      chair(K, 86.5 + dx, z + 0.95, -Math.PI / 2, MY);
    }
  }
  for (const z of [404.5, 409.5, 421.5]) {
    loungeChair(K, GX + 2.2, z - 0.6, Math.PI, MY);
    loungeChair(K, GX + 2.2, z + 0.6, Math.PI, MY);
  }
  for (const x of [46, 56, 66]) {
    const t = table(K, x, 388.4, 3.0, 1.1, 0, { y: MY });
    for (const dx of [-0.8, 0.8]) chair(K, x + dx, 389.4, -Math.PI / 2, MY);
    void t;
  }
  plant(K, GX + 1.0, GZ + 1.0, MY, 1.1);
  plant(K, X0 + 1.2, GZ - 1.0, MY, 1.0);
  loot.push({ kind: 'chest', x: GX + 2.6, z: 400.8, y: MY, yaw: Math.PI / 2 });
  loot.push({ kind: 'chest', x: 51.0, z: 390.3, y: MY, yaw: 0 });
  // floor chests: by the window islands, beside the circulation desk, at the south door aisle
  loot.push({ kind: 'chest', x: 47.2, z: 396.6, y: FL, yaw: Math.PI / 2 });
  loot.push({ kind: 'chest', x: 88.6, z: 390.6, y: FL, yaw: Math.PI });
  loot.push({ kind: 'chest', x: 54.4, z: 414.2, y: FL, yaw: 0 });
  loot.push({ kind: 'item', x: galT[2].cx - 0.9, z: galT[2].cz, y: galT[2].y1, yaw: 0 });
  K.light({ x: 85, y: MY + 3.2, z: 395, range: 13, intensity: 0.7 });
  K.light({ x: 85, y: MY + 3.2, z: 415, range: 13, intensity: 0.7 });
  K.light({ x: 58, y: MY + 3.2, z: 387.5, range: 13, intensity: 0.6 });

  // ---- atrium ceiling (acoustic tile) and the high pendant lights [LIB]
  ceilingPatch(K, R.x0 + 0.2, R.x1 - 0.2, R.z0 + 0.2, R.z1 - 0.2, TOP - 0.52);
  for (let x = 46; x <= 90; x += 6)
    for (let z = 389; z <= 425; z += 6) {
      const y = TOP - 2.4;
      K.decor({ cx: x, cz: z, hx: 0.18, hz: 1.2, yaw: 0, y0: y, y1: y + 0.1 }, 'metalWhite');
      K.decor({ cx: x, cz: z, hx: 0.15, hz: 1.15, yaw: 0, y0: y - 0.01, y1: y + 0.01 }, 'fixture');
      for (const dz of [-0.9, 0.9]) K.decor({ cx: x, cz: z + dz, hx: 0.008, hz: 0.008, yaw: 0, y0: y + 0.1, y1: TOP - 0.52 }, 'picket');
    }
  // daylight-bright ceiling coffers between the pendants (the atrium top reads near white) [LIB]
  for (const x of [49, 61, 73, 85]) K.decor({ cx: x, cz: (R.z0 + R.z1) / 2, hx: 0.9, hz: (R.z1 - R.z0) / 2 - 1.5, yaw: 0, y0: TOP - 0.56, y1: TOP - 0.53 }, 'fixture');
  for (const x of [48, 60, 72]) for (const z of [398, 410, 422]) K.light({ x, y: TOP - 3, z, range: 18, intensity: 0.85, color: 0xfff6ea });

  // ---- loot (3-5 spots on surfaces; one chest on the gallery)
  for (const l of loot) K.loot(l);
}
