// BENTONVILLE ROYALE — Bentonville High School, North Building (pure plan data + hero detail).
//
//   buildNorth(K) -> plan        (K = createKit(...)); draws nothing itself: kit/meshes.js does
//
// From the reference photos (docs/bhs/STYLE_BIBLE.md §3-4; photo short names there):
//   - U-plan around a grass courtyard, 3 storeys of red brick with punched windows [AE1, AE2, 3DF, NOR]
//   - main entrance on the WEST face at the south-west corner, between the commons' brick frontage
//     (north) and the light split-face block stair tower (south): glass doors under a cantilevered
//     white canopy, a two-storey curtain wall above, an angled grey metal-panel volume on top [ENT,
//     DRW, 3DF, L3D]
//   - commons: 3-storey atrium, grey block below / wood banding above, round columns, a glass-railed
//     2nd-floor walkway, polished terrazzo with dark bands, round cafe tables, tall dark banners [CB, C1]
//   - glass stair tower at the south-east prow [3DF]
// Room layout beyond those spaces is an invented, typical school plan (approximate): no official
// floor plans, real room numbers, names or security details.
// World metres: x east, z south. The outline is the map's OSM footprint of building 952075843.

import { SIZE } from './kit/palette.js';
import { buildPlan } from './kit/plan.js';

export const NORTH_ID = 952075843;
const H = SIZE.storey; // 4.4
const ROOF = 3 * H; // 13.2

export const NORTH_OUTLINE = [
  [-39.3, 261], [-12.7, 261.3], [-10.4, 259.7], [-5.2, 259.8], [-3.1, 262.9], [47.2, 263.5], [47.2, 267.9], [47.8, 268.6],
  [60.2, 268.7], [64.5, 265.8], [64.8, 249.7], [57.4, 249.6], [58, 202.8], [50.5, 202.7], [47, 205], [44.4, 205], [43.1, 203.2],
  [43.1, 200.2], [18.6, 165.2], [17.7, 165.2], [5.2, 173.9], [-1.1, 165], [-45.8, 164.4], [-46.2, 187.2], [-38.2, 187.4],
  // corrected against the photos [ENT, DRW]: the main entry sits in a niche between the brick
  // frontage and the stair tower, which stands forward of it (OSM draws one straight wall here)
  [-38.4, 241], [-34.6, 241], [-34.6, 250.6], [-39.0, 250.6],
];
// the outdoor commons (grass courtyard) every classroom row around the loop hallway looks onto [AE1, AE2, 3DF]
export const NORTH_COURT = [[-6, 203], [34, 203], [34, 237], [-6, 237]];
// the crosswalk entrance on the south face (the glazed double-height entry beside the silver corner
// block [NOR]): a vestibule off the lobby, doors onto the path to the main building
export const SOUTH_ENTRY = { x0: -24, x1: -16, z0: 247.6, z1: 261.4 };

// key spaces (also used by the hero dressing and the match-loop cameras)
export const COMMONS = { x0: -38.4, x1: -6, z0: 205, z1: 241 };
export const ATRIUM = { x0: -38.4, x1: -11, z0: 205, z1: 241 }; // open through all 3 storeys
export const LOBBY = { x0: -34.6, x1: -24, z0: 241, z1: 250.6 }; // 2 storeys, under the curtain wall
export const ENTRY = { z0: 242.2, z1: 249.4 }; // door run on the west wall
// the feature stair's top landing in the atrium: it meets the 2nd-floor walkway at x ATRIUM.x1
export const LANDING = { x0: -14.15, cx: -13, z0: 210.4, z1: 212.6 };
export const TOWER = { x0: -39.0, x1: -32.5, z0: 250.6, z1: 261 };

const R = (o) => ({ walls: true, floor: 'vct', wall: 'paint', ceiling: 'ceilingTile', ...o });
const floorFor = (label) => (/Seminar|Study|Tutoring/.test(label) ? 'carpet' : /Band|Choir|Orchestra|Piano|Music/.test(label) ? 'woodFloor' : 'vct');
const classroom = (id, level, x0, x1, z0, z1, door, label = 'Classroom') => R({ id, level, x0, x1, z0, z1, kind: 'classroom', label, floor: floorFor(label), doors: [{ side: door, at: 1.2, w: 1.0 }] });
const corridor = (id, level, x0, x1, z0, z1, extra = {}) => R({ id, level, x0, x1, z0, z1, kind: 'corridor', label: 'Hallway', walls: false, ...extra });

function rooms() {
  const out = [];
  for (let L = 0; L < 3; L++) {
    const t = `L${L}`;
    // ---- north wing: classrooms north of the corridor, NW stair + restrooms
    const nx = [-38.4, -28.7, -19.3, -10, 0]; // starts at the NW stairwell (x -46.3..-38.4)
    for (let i = 0; i + 1 < nx.length; i++) out.push(classroom(`n${i}${t}`, L, nx[i], nx[i + 1], 164, 176, 'z1', ['English Classroom', 'Math Classroom', 'History Classroom', 'Language Classroom'][(i + L) % 4]));
    out.push(corridor(`corN${t}`, L, -46.3, 27.2, 176, 179.2));
    // (QA: the zig-zag bay north of the corridor was an empty, grass-floored hole) a study nook; the
    // rect is clipped to the outline by the plan
    out.push(R({ id: `nook${t}`, level: L, x0: 0, x1: 27.2, z0: 164, z1: 176, kind: 'lounge', label: 'Study Nook', floor: 'carpet', doors: [{ side: 'z1', at: 6, w: 1.8 }, { side: 'z1', at: 20, w: 1.8 }] }));
    out.push(R({ id: `stNW${t}`, level: L, x0: -46.3, x1: -38.4, z0: 164, z1: 176, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'blockGrey', doors: [{ side: 'z1', at: 3.6, w: 2.0 }] }));
    out.push(R({ id: `rwA${t}`, level: L, x0: -46.3, x1: -42.2, z0: 179.2, z1: 187.3, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'z0', at: 1.0, w: 0.95 }] }));
    out.push(R({ id: `rwB${t}`, level: L, x0: -42.2, x1: -38.4, z0: 179.2, z1: 187.3, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'z0', at: 1.0, w: 0.95 }] }));
    // hall link along the courtyard's west side (ground: into the commons; upper: the bridge)
    out.push(corridor(`hall${t}`, L, -11, -6, 179.2, L === 0 ? 205 : 241, L === 0 ? {} : { floor: 'terrazzo', label: 'Commons Walkway' }));
    if (L === 0) {
      out.push(R({ id: 'office', level: 0, x0: -38.4, x1: -24, z0: 179.2, z1: 192, kind: 'office', label: 'Main Office', floor: 'carpet', doors: [{ side: 'z0', at: 3, w: 1.8 }, { side: 'z1', at: 9, w: 1.0 }] }));
      out.push(R({ id: 'counsel', level: 0, x0: -24, x1: -11, z0: 179.2, z1: 192, kind: 'office', label: 'Counseling', floor: 'carpet', doors: [{ side: 'z0', at: 2, w: 1.0 }, { side: 'x1', at: 6, w: 1.0 }] }));
      out.push(R({ id: 'attend', level: 0, x0: -38.4, x1: -27, z0: 192, z1: 205, kind: 'office', label: 'Attendance', floor: 'carpet', doors: [{ side: 'z1', at: 5, w: 1.2 }] }));
      out.push(R({ id: 'work', level: 0, x0: -27, x1: -17, z0: 192, z1: 205, kind: 'office', label: 'Teacher Workroom', doors: [{ side: 'z1', at: 5, w: 1.0 }] }));
      out.push(R({ id: 'nurse', level: 0, x0: -17, x1: -11, z0: 192, z1: 205, kind: 'office', label: 'Nurse', doors: [{ side: 'x1', at: 3, w: 1.0 }] }));
      out.push(R({ id: 'commons', level: 0, ...COMMONS, kind: 'commons', label: 'Commons', walls: false, floor: 'terrazzo', wall: 'blockGrey', ceiling: 'none' }));
      out.push(R({ id: 'lobby', level: 0, ...LOBBY, tall: 2, kind: 'lobby', label: 'Main Entrance', walls: false, floor: 'terrazzo', wall: 'cmuLight', wallLevels: ['cmuLight', 'wood'], ceiling: 'ceilingTile', ceilingDrop: 0 }));
      out.push(R({ id: 'media', level: 0, x0: -6, x1: 24, z0: 179.2, z1: 203, tall: 2, kind: 'library', label: 'Media Center', floor: 'carpet', wall: 'libWall', ceiling: 'ceilingTile', doors: [{ side: 'x0', at: 12, w: 2.4 }, { side: 'z0', at: 8, w: 1.8 }] }));
      out.push(R({ id: 'lecture', level: 0, x0: 27.2, x1: 45, z0: 168, z1: 199.8, tall: 2, kind: 'auditorium', label: 'Lecture Hall', floor: 'carpet', wall: 'acoustic', ceiling: 'aacCeiling', doors: [{ side: 'x0', at: 22, w: 1.8 }] }));
      out.push(R({ id: 'front', level: 0, x0: -32.5, x1: -24, z0: 250.6, z1: 261.5, kind: 'office', label: 'Front Office', floor: 'carpet', doors: [{ side: 'x1', at: 4, w: 1.2 }] }));
    } else {
      // upper floors over the admin suite: 3 classrooms + a study lounge overlooking the atrium
      out.push(classroom(`aw0${t}`, L, -38.4, -29.3, 179.2, 192, 'z0', 'Social Studies Classroom'));
      out.push(classroom(`aw1${t}`, L, -29.3, -20.2, 179.2, 192, 'z0', 'English Classroom'));
      out.push(classroom(`aw2${t}`, L, -20.2, -11, 179.2, 192, 'z0', 'Math Classroom'));
      out.push(R({ id: `lounge${t}`, level: L, x0: -38.4, x1: -11, z0: 192, z1: 205, kind: 'lounge', label: 'Study Lounge', walls: false, floor: 'carpet', wall: 'wood' }));
      out.push(R({ id: `atrium${t}`, level: L, ...ATRIUM, kind: 'atrium', label: 'Commons', walls: false, floor: 'none', wall: 'wood', ceiling: L === 2 ? 'ceilingTile' : 'none', ceilingDrop: 0, fixtures: false }));
      out.push(classroom(`fr${t}`, L, -32.5, -24, 250.6, 261.5, 'x1', 'Seminar Room'));
      if (L === 2) {
        out.push(R({ id: 'study', level: 2, x0: -6, x1: 9, z0: 179.2, z1: 203, kind: 'library', label: 'Study Commons', floor: 'carpet', wall: 'libWall', doors: [{ side: 'z0', at: 3, w: 1.8 }, { side: 'x0', at: 10, w: 1.8 }] }));
        out.push(classroom('sem2', 2, 9, 24, 179.2, 203, 'z0', 'Seminar Room'));
        out.push(classroom('lab2', 2, 27.2, 45, 168, 199.8, 'x0', 'Robotics Lab'));
        out.push(R({ id: 'office2', level: 2, ...LOBBY, kind: 'office', label: 'Department Offices', floor: 'carpet', doors: [{ side: 'x1', at: 5, w: 1.0 }] }));
      }
    }
    // ---- NE: corridor down the angled wing to the east corridor
    out.push(corridor(`corNEa${t}`, L, 24, 27.2, 176, 203));
    out.push(corridor(`corNEb${t}`, L, 24, 44.2, 199.8, 203));
    // ---- east wing
    out.push(corridor(`corE${t}`, L, 41, 44.2, 199.8, 243));
    out.push(R({ id: `stNE${t}`, level: L, x0: 44.2, x1: 52, z0: 205.2, z1: 217, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'blockGrey', doors: [{ side: 'x0', at: 10.6, w: 2.4 }] }));
    out.push(R({ id: `prep${t}`, level: L, x0: 52, x1: 58.3, z0: 203, z1: 217, kind: 'storage', label: 'Lab Prep', doors: [{ side: 'z1', at: 2, w: 1.0 }] }));
    const labs = ['Chemistry Lab', 'Biology Lab', 'Physics Lab'];
    // (QA: the third lab ran 4.6 m into the south corridor) the labs stop at the corridor (z 243)
    [[217, 226], [226, 234.5], [234.5, 243]].forEach(([z0, z1], i) => out.push(R({ id: `lab${i}${t}`, level: L, x0: 44.2, x1: 58.3, z0, z1, kind: 'lab', label: labs[(i + L) % 3], doors: [{ side: 'x0', at: 2, w: 1.0 }] })));
    out.push(R({ id: `rwC${t}`, level: L, x0: 34, x1: 41, z0: 203, z1: 209, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'x1', at: 1, w: 0.95 }] }));
    out.push(R({ id: `rwD${t}`, level: L, x0: 34, x1: 41, z0: 209, z1: 215, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'x1', at: 1, w: 0.95 }] }));
    out.push(R({ id: `sto${t}`, level: L, x0: 34, x1: 41, z0: 215, z1: 226, kind: 'storage', label: 'Storage', doors: [{ side: 'x1', at: 2, w: 1.0 }] }));
    out.push(classroom(`ew${t}`, L, 34, 41, 226, 243, 'x1', 'Seminar Room'));
    // ---- south wing: the loop hallway runs straight east from the entry doors [user, ENT]: court-side
    // rooms look onto the outdoor commons through big windows; classrooms south of the hallway; the
    // crosswalk vestibule to the right of the lobby; SW tower stair, SE glass stair at the corners
    const subj = ['Art Studio', 'Computer Lab', 'English Classroom', 'Math Classroom', 'History Classroom', 'Language Classroom'];
    out.push(corridor(`corSW${t}`, L, -24, -6, 241, 247.6, { floor: L === 0 ? 'terrazzo' : 'vct' }));
    out.push(corridor(`corS${t}`, L, -6, 49, 243, 247.6));
    out.push(corridor(`corSE${t}`, L, 49, 57.6, 243, 251.8));
    const cs = [-6, 4, 14, 24, 34];
    for (let i = 0; i + 1 < cs.length; i++) out.push(classroom(`sc${i}${t}`, L, cs[i], cs[i + 1], 237, 243, 'z1', ['Study Room', 'Seminar Room', 'Tutoring Room', 'Study Room'][(i + L) % 4]));
    if (L === 0) out.push(R({ id: 'southEntry', level: 0, ...SOUTH_ENTRY, tall: 2, kind: 'lobby', label: 'South Entrance', walls: false, floor: 'terrazzo', wall: 'cmuLight', wallLevels: ['cmuLight', 'wood'], ceiling: 'ceilingTile', ceilingDrop: 0 }));
    if (L === 2) out.push(classroom('se2', 2, SOUTH_ENTRY.x0, SOUTH_ENTRY.x1, SOUTH_ENTRY.z0, SOUTH_ENTRY.z1, 'z0', 'Seminar Room'));
    out.push(R({ id: `rwE${t}`, level: L, x0: -16, x1: -11, z0: 247.6, z1: 261.4, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'z0', at: 1, w: 0.95 }] }));
    out.push(R({ id: `rwF${t}`, level: L, x0: -11, x1: -6, z0: 247.6, z1: 262, kind: 'restroom', label: 'Restroom', wall: 'blockGrey', doors: [{ side: 'z0', at: 1, w: 0.95 }] }));
    const ss = [-6, 5, 16, 27, 38, 49];
    for (let i = 0; i + 1 < ss.length; i++) out.push(classroom(`ss${i}${t}`, L, ss[i], ss[i + 1], 247.6, 263.6, 'z0', subj[(i + L + 3) % subj.length]));
    out.push(classroom(`ss5${t}`, L, 49, 57.4, 251.8, 263.6, 'z0', subj[(L + 1) % subj.length]));
    // the SE prow behind it (QA: empty): storage off the end classroom
    out.push(R({ id: `prowA${t}`, level: L, x0: 47.2, x1: 57.6, z0: 263.6, z1: 268.8, kind: 'storage', label: 'Storage', doors: [{ side: 'z0', at: 5, w: 1.0 }] }));
    out.push(R({ id: `prowB${t}`, level: L, x0: 57.6, x1: 64.8, z0: 261, z1: 268.8, kind: 'storage', label: 'Storage', doors: [{ side: 'x0', at: 4, w: 1.0 }] }));
    out.push(R({ id: `stSW${t}`, level: L, ...TOWER, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'cmuLight', doors: [{ side: 'x1', at: 1.0, w: 1.8 }] }));
    out.push(R({ id: `stSE${t}`, level: L, x0: 57.6, x1: 64.6, z0: 249.8, z1: 261, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'paint', doors: [{ side: 'x0', at: 0.9, w: 1.8 }] }));
  }
  return out;
}

// ---------------------------------------------------------------- facades

/** Punched windows on a bay rhythm along an edge of length L: openings in edge-u metres. */
function punched(L, level, { bay = 3.6, w = 1.6, skip = [], sill: s0, head: h0 } = {}) {
  const sill = s0 ?? (level === 0 ? 0.8 : 1.0);
  const head = h0 ?? (level === 0 ? 2.9 : 2.75);
  const n = Math.floor((L - 1.2) / bay);
  const start = (L - n * bay) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = start + bay * (i + 0.5);
    const u0 = c - w / 2;
    const u1 = c + w / 2;
    if (skip.some(([a, b]) => u1 > a && u0 < b)) continue;
    out.push({ u0, u1, y0: sill, y1: head, type: 'window' });
  }
  return out;
}

/** edge-u of a world z on a (near) north-south edge. */
const uOfZ = (e, z) => ((z - e.a[1]) / (e.b[1] - e.a[1])) * e.L;
const uOfX = (e, x) => ((x - e.a[0]) / (e.b[0] - e.a[0])) * e.L;

/** The west face around the main entrance, edge by edge (null for any other edge) [ENT, DRW, 3DF]. */
function westFacade(e) {
  const near = (p, x, z) => Math.abs(p[0] - x) < 0.25 && Math.abs(p[1] - z) < 0.25;
  const out = [];
  if (near(e.a, -38.2, 187.4)) {
    // admin wing + commons frontage: brick, punched windows | L0 silver storefront under the red soldier
    // band, L1 brick with big punched windows under buff lintels, L2 the grey metal-panel volume
    const u = (z) => uOfZ(e, z);
    const cm0 = u(COMMONS.z0);
    for (let L = 0; L < 3; L++) {
      const spans = [{ u0: 0, u1: cm0, lookOut: 'brick', openings: punched(cm0, L) }];
      const w2 = e.L - cm0;
      if (L === 0) spans.push({ u0: cm0, u1: e.L, lookOut: 'brick', openings: [{ u0: cm0 + 0.6, u1: e.L - 0.4, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.5, rows: 2 }] });
      else if (L === 1) spans.push({ u0: cm0, u1: e.L, lookOut: 'brick', openings: [0.2, 0.5, 0.8].map((f) => ({ u0: cm0 + w2 * f - 1.6, u1: cm0 + w2 * f + 1.6, y0: 0.9, y1: 2.4, type: 'window', lintelH: 0.35 })) });
      else spans.push({ u0: cm0, u1: e.L, lookOut: 'metalGrey', mat: 'metal', openings: [{ u0: cm0 + 0.4, u1: e.L - 0.4, y0: 2.5, y1: 3.6, type: 'glass', bay: 1.5, rows: 1 }] });
      out.push({ level: L, spans });
    }
    return out;
  }
  if (near(e.a, -38.4, 241)) {
    // niche return, north side: storefront wrapping the corner, brick above, metal on top
    for (let L = 0; L < 3; L++) out.push({ level: L, lookOut: L === 2 ? 'metalGrey' : 'brick', openings: L === 0 ? [{ u0: 0.3, u1: e.L - 0.2, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.3, rows: 2 }] : [] });
    return out;
  }
  if (near(e.a, -34.6, 241)) {
    // the entry wall: 4 pairs of glass doors with a transom + storefront, a 2-storey curtain wall above
    const u = (z) => uOfZ(e, z);
    const en0 = u(ENTRY.z0);
    const en1 = u(ENTRY.z1);
    const doors = [];
    const pairs = 4;
    const dw = (en1 - en0) / pairs;
    for (let k = 0; k < pairs; k++) doors.push({ u0: en0 + dw * k + 0.15, u1: en0 + dw * (k + 1) - 0.15, y0: 0, y1: 2.6, type: 'door', leaf: false, frameLook: 'alu' });
    out.push({ level: 0, lookOut: 'metalWhite', openings: [...doors, { u0: 0.15, u1: en0 - 0.1, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.0, rows: 2 }, { u0: en1 + 0.1, u1: e.L - 0.15, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.0, rows: 2 }] });
    for (const L of [1, 2]) out.push({ level: L, lookOut: 'metalWhite', openings: [{ u0: 0.12, u1: e.L - 0.12, y0: L === 1 ? -0.35 : 0, y1: L === 2 ? 3.9 : H, type: 'glass', bay: 1.6, rows: 3 }] });
    return out;
  }
  if (near(e.a, -39.3, 261)) {
    // south face, west part [NOR]: the silver ribbed-metal corner block (tower + front office) with a
    // glass band per floor | the glazed double-height crosswalk entrance | brick classrooms
    const u = (x) => uOfX(e, x);
    const m0 = u(-24);
    const m1 = u(SOUTH_ENTRY.x1);
    const dc = u(-20);
    for (let L = 0; L < 3; L++) {
      const spans = [{ u0: 0, u1: m0, lookOut: 'metalSilver', mat: 'metal', openings: [{ u0: 0.6, u1: m0 - 0.6, y0: 1.0, y1: 2.6, type: 'glass', bay: 1.5, rows: 1 }] }];
      if (L === 0) spans.push({ u0: m0, u1: m1, lookOut: 'metalWhite', mat: 'metal', openings: [{ u0: dc - 1.3, u1: dc + 1.3, y0: 0, y1: 2.6, type: 'door', leaf: false, frameLook: 'alu' }, { u0: m0 + 0.2, u1: dc - 1.5, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.0, rows: 2 }, { u0: dc + 1.5, u1: m1 - 0.2, y0: 0.05, y1: 3.6, type: 'glass', bay: 1.0, rows: 2 }, { u0: dc - 1.3, u1: dc + 1.3, y0: 2.75, y1: 3.6, type: 'glass', bay: 1.3, rows: 1 }] });
      else if (L === 1) spans.push({ u0: m0, u1: m1, lookOut: 'metalWhite', mat: 'metal', openings: [{ u0: m0 + 0.15, u1: m1 - 0.15, y0: -0.35, y1: H, type: 'glass', bay: 1.6, rows: 3 }] });
      else spans.push({ u0: m0, u1: m1, lookOut: 'metalWhite', mat: 'metal', openings: [{ u0: m0 + 0.6, u1: m1 - 0.6, y0: 1.0, y1: 2.6, type: 'glass', bay: 1.5, rows: 1 }] });
      spans.push({ u0: m1, u1: e.L, lookOut: 'brick', openings: punched(e.L - m1, L).map((o) => ({ ...o, u0: o.u0 + m1, u1: o.u1 + m1 })) });
      out.push({ level: L, spans });
    }
    return out;
  }
  if (near(e.a, -34.6, 250.6) || near(e.a, -39.0, 250.6)) {
    // the stair tower: light split-face block with a tall vertical window strip [ENT]
    const west = near(e.a, -39.0, 250.6);
    for (let L = 0; L < 3; L++) {
      if (!west) {
        out.push({ level: L, lookOut: 'cmuLight', openings: [] });
        continue;
      }
      // west face: a 4.4 m light-block pier with the tall window strip, then white ribbed metal (QA: too wide)
      out.push({ level: L, spans: [
        { u0: 0, u1: 4.4, lookOut: 'cmuLight', mat: 'block', openings: [{ u0: 1.55, u1: 2.85, y0: L === 0 ? 0.6 : -0.15, y1: H + 0.15, type: 'glass', bay: 1.3, rows: 3 }] },
        { u0: 4.4, u1: e.L, lookOut: 'metalWhite', mat: 'metal', openings: [{ u0: 5.0, u1: e.L - 0.6, y0: 1.0, y1: 2.6, type: 'glass', bay: 1.5, rows: 1 }] },
      ] });
    }
    return out;
  }
  return null;
}

/** The facade of one outline / court edge (plan.js facade callback). */
function facade(e) {
  const wf = westFacade(e);
  if (wf) return wf;
  const out = [];
  const mx = e.mid[0];
  const mz = e.mid[1];
  // SE prow: the glass stair tower [3DF]
  const prow = mx > 56 && mz > 249 && !e.court;
  // NW block end: white ribbed metal end with a vertical glass strip [3DF zoom]
  const nwEnd = !e.court && Math.abs(mx + 46) < 0.6;
  for (let L = 0; L < 3; L++) {
    if (prow) {
      out.push({ level: L, lookOut: 'metalWhite', openings: [{ u0: 0.3, u1: e.L - 0.3, y0: L === 0 ? 0.05 : -0.15, y1: H + 0.15, type: 'glass', bay: 1.5, rows: 3 }].concat(L === 0 && e.L > 5 && mz > 266 ? [] : []) });
      continue;
    }
    if (nwEnd) {
      out.push({ level: L, lookOut: 'metalWhite', openings: [{ u0: e.L / 2 - 0.7, u1: e.L / 2 + 0.7, y0: L === 0 ? 0.6 : -0.15, y1: H + 0.15, type: 'glass', bay: 1.4, rows: 3 }] });
      continue;
    }
    const ops = e.L > 3 ? (e.court ? punched(e.L, L, { w: 3.0, sill: 0.6, head: 3.4 }) : punched(e.L, L, { w: 1.6 })) : [];
    // ground-floor exterior doors: north side (NW stair), east wing, south road side, courtyard
    if (L === 0) {
      const door = (u) => {
        const kept = ops.filter((o) => o.u1 < u - 1.6 || o.u0 > u + 1.6);
        kept.push({ u0: u - 1.0, u1: u + 1.0, y0: 0, y1: 2.5, type: 'door', leafLook: 'glass', frameLook: 'alu' });
        return kept;
      };
      if (!e.court && Math.abs(mz - 164.7) < 1 && e.L > 30) out.push({ level: 0, lookOut: 'brick', openings: door(uOfX(e, -43.2)) });
      else if (!e.court && Math.abs(mx - 57.7) < 1 && e.L > 30) out.push({ level: 0, lookOut: 'brick', openings: door(uOfZ(e, 232)) });
      else if (!e.court && Math.abs(mz - 263.2) < 0.6 && e.L > 30) out.push({ level: 0, lookOut: 'brick', openings: door(uOfX(e, 20)) });
      else if (e.court && Math.abs(mx + 6) < 0.3) out.push({ level: 0, lookOut: 'brick', openings: door(uOfZ(e, 223)) });
      else out.push({ level: 0, lookOut: 'brick', openings: ops });
      continue;
    }
    out.push({ level: L, lookOut: 'brick', openings: ops });
  }
  return out;
}

// ---------------------------------------------------------------- hero detail (decor + a few props)

function entranceHero(K) {
  K.setGroup('ext');
  const xw = -34.95; // outer face of the entry wall (in the niche)
  // cantilevered white canopy over the doors (walkable top) [ENT]
  K.box({ cx: xw - 2.6, cz: (LOBBY.z0 + TOWER.z0) / 2 - 0.3, hx: 2.6, hz: (TOWER.z0 - LOBBY.z0) / 2 - 0.1, yaw: 0, y0: 3.75, y1: 4.1 }, { mat: 'metal', look: 'canopy', faces: { bottom: 'canopy', top: 'roof' }, role: 'canopy' });
  // fascia sign band under the curtain wall: gold band, school name + MAIN ENTRANCE, tiger emblem
  K.decor({ cx: xw - 0.12, cz: (ENTRY.z0 + ENTRY.z1) / 2, hx: 0.05, hz: (ENTRY.z1 - ENTRY.z0) / 2, yaw: 0, y0: 2.75, y1: 3.6 }, 'signMain', { faces: { nu: 'signMain', pu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' } });
  K.decor({ cx: xw - 0.14, cz: ENTRY.z0 - 0.5, hx: 0.04, hz: 0.42, yaw: 0, y0: 2.8, y1: 3.55 }, 'emblem', { faces: { nu: 'emblem', pu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' } });
  // the entry door pairs, drawn closed: aluminium stiles + glass (players pass: automatic doors)
  {
    const pairs = 4;
    const dz = (ENTRY.z1 - ENTRY.z0) / pairs;
    for (let k = 0; k < pairs; k++) {
      const z0 = ENTRY.z0 + dz * k + 0.15;
      const z1 = ENTRY.z0 + dz * (k + 1) - 0.15;
      for (const [a, b] of [[z0, (z0 + z1) / 2], [(z0 + z1) / 2, z1]]) {
        const cz = (a + b) / 2;
        K.decor({ cx: -34.62, cz, hx: 0.02, hz: (b - a) / 2 - 0.02, yaw: 0, y0: 0.02, y1: 2.58 }, 'glass');
        for (const zz of [a + 0.05, b - 0.05]) K.decor({ cx: -34.62, cz: zz, hx: 0.04, hz: 0.05, yaw: 0, y0: 0, y1: 2.6 }, 'alu');
        K.decor({ cx: -34.62, cz, hx: 0.04, hz: (b - a) / 2, yaw: 0, y0: 0, y1: 0.22 }, 'alu');
        K.decor({ cx: -34.62, cz, hx: 0.04, hz: (b - a) / 2, yaw: 0, y0: 2.5, y1: 2.6 }, 'alu');
        K.decor({ cx: -34.7, cz: cz + ((b - a) / 2 - 0.15) * (cz < (z0 + z1) / 2 ? 1 : -1), hx: 0.03, hz: 0.015, yaw: 0, y0: 0.9, y1: 1.9 }, 'railCap');
      }
    }
  }
  // angled grey metal-panel volume crowning the curtain wall [ENT, DRW]
  // (a raised clerestory box set back over the lobby, its thin roof cantilevering out over the curtain wall)
  K.box({ cx: -29.3, cz: (LOBBY.z0 + LOBBY.z1) / 2, hx: 5.2, hz: 5.6, yaw: 0, y0: ROOF, y1: ROOF + 2.4 }, { mat: 'metal', look: 'metalGrey', faces: { top: 'roof' } });
  K.decor({ cx: -31.4, cz: (LOBBY.z0 + LOBBY.z1) / 2, hx: 7.6, hz: 6.4, yaw: 0, y0: ROOF + 2.4, y1: ROOF + 2.7 }, 'metalWhite', { faces: { top: 'roof' } });
  // the tower rises above the roof (light block, white metal cap)
  // the tower crown: white ribbed metal rising ~5 m above the roof, its top sloping up to the west
  // (stepped in 6 slices) with the window strip carried up [DRW, ENT, N2S]
  {
    const tx0 = TOWER.x0 - 0.2;
    const tx1 = TOWER.x1 + 0.2;
    const cz = (TOWER.z0 + TOWER.z1) / 2;
    const hz = (TOWER.z1 - TOWER.z0) / 2 + 0.2;
    K.box({ cx: (tx0 + tx1) / 2, cz, hx: (tx1 - tx0) / 2, hz, yaw: 0, y0: ROOF, y1: ROOF + 3 }, { mat: 'metal', look: 'metalWhite', faces: { top: 'roof' } });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x0 = tx0 + ((tx1 - tx0) * i) / n;
      const x1 = tx0 + ((tx1 - tx0) * (i + 1)) / n;
      K.decor({ cx: (x0 + x1) / 2, cz, hx: (x1 - x0) / 2 + 0.01, hz, yaw: 0, y0: ROOF + 3, y1: ROOF + 3 + 2.2 * (1 - i / n) }, 'metalWhite', { faces: { top: 'coping' } });
    }
    K.decor({ cx: tx0 - 0.02, cz, hx: 0.03, hz: 0.65, yaw: 0, y0: ROOF + 0.2, y1: ROOF + 4.6 }, 'glass');
  }
  // red soldier band over the commons storefront [ENT]
  K.decor({ cx: xw + 0.08, cz: (COMMONS.z0 + COMMONS.z1) / 2, hx: 0.06, hz: (COMMONS.z1 - COMMONS.z0) / 2, yaw: 0, y0: 3.62, y1: 3.95 }, 'brickBand');
  // the crosswalk entrance on the south face [NOR]: a flat canopy, the tiger emblem, a path to the road
  K.box({ cx: -20, cz: 263.4, hx: 3.4, hz: 2.0, yaw: 0, y0: 3.75, y1: 4.05 }, { mat: 'metal', look: 'canopy', faces: { bottom: 'canopy', top: 'roof' }, role: 'canopy' });
  K.decor({ cx: -20, cz: 261.78, hx: 0.42, hz: 0.04, yaw: 0, y0: 2.8, y1: 3.55 }, 'emblem', { faces: { pv: 'emblem', nv: 'none', pu: 'none', nu: 'none', top: 'none', bottom: 'none' } });
  K.decor({ cx: -20, cz: 270.6, hx: 3, hz: 9.2, yaw: 0, y0: 0, y1: 0.05 }, 'paving', { faces: { top: 'paving', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  // shrub beds along the south face, either side of the crosswalk entrance [NOR]
  for (const [x0, x1] of [[-38.5, -24.2], [-15.6, 45]]) {
    K.decor({ cx: (x0 + x1) / 2, cz: 264.2, hx: (x1 - x0) / 2, hz: 1.6, yaw: 0, y0: 0, y1: 0.06 }, 'mulch', { faces: { top: 'mulch', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
    for (let x = x0 + 0.7; x < x1 - 0.5; x += 1.35) {
      const r = 0.48 + ((x * 7.3) % 1) * 0.12;
      K.decor({ cx: x, cz: 264.2 + (((x * 3.1) % 1) - 0.5) * 0.6, hx: r, hz: r, yaw: 0, y0: 0.05, y1: 0.05 + r * 1.5 }, '#3f5a2f', { shape: 'cyl' });
    }
  }
  // a large flag on the entrance plaza [user]: a 14 m pole on a concrete base, a 5.5 x 2.9 m US flag.
  // Seen from the plaza (west) the pole is on the left and the canton top-left; it breaks like the rest.
  {
    const px = -48.4;
    const pz = 229.5;
    K.box({ cx: px, cz: pz, hx: 0.9, hz: 0.9, yaw: 0, y0: 0, y1: 0.45 }, { mat: 'block', look: 'cmuLight', faces: { top: 'paving' } });
    const pole = K.box({ cx: px, cz: pz, hx: 0.09, hz: 0.09, yaw: 0, y0: 0.45, y1: 14 }, { mat: 'metal', look: 'none', faces: { pu: 'none', nu: 'none', pv: 'none', nv: 'none', top: 'none', bottom: 'none' }, role: 'pole' });
    K.decor({ cx: px, cz: pz, hx: 0.1, hz: 0.1, yaw: 0, y0: 0.45, y1: 14 }, 'alu', { shape: 'cyl', dep: pole });
    K.decor({ cx: px, cz: pz, hx: 0.17, hz: 0.17, yaw: 0, y0: 14, y1: 14.3 }, '#d4af37', { shape: 'cyl', dep: pole });
    const fw = 5.5;
    const fh = 2.9;
    K.decor({ cx: px, cz: pz + 0.12 + fw / 2, hx: 0.015, hz: fw / 2, yaw: 0, y0: 13.7 - fh, y1: 13.7 }, 'usFlag', { faces: { pu: 'usFlag', nu: 'usFlag', pv: 'none', nv: 'none', top: 'none', bottom: 'none' }, dep: pole });
  }
  // entry plaza paving, planters, bollards, trash receptacle
  K.decor({ cx: -44.5, cz: 247, hx: 5.8, hz: 13, yaw: 0, y0: 0, y1: 0.02 }, 'paving', { faces: { top: 'paving', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  for (const z of [236, 258]) K.box({ cx: -44, cz: z, hx: 1.2, hz: 3.2, yaw: 0, y0: 0, y1: 0.55 }, { mat: 'block', look: 'cmuLight', faces: { top: 'mulch' } });
  for (let i = 0; i < 5; i++) K.decor({ cx: -47.2, cz: 241.5 + i * 2.2, hx: 0.12, hz: 0.12, yaw: 0, y0: 0, y1: 0.9 }, 'alu', { shape: 'cyl' });
  K.light({ x: xw - 2, y: 3.6, z: (ENTRY.z0 + ENTRY.z1) / 2, range: 10, intensity: 0.6, color: 0xfff1d6 });
}

function commonsHero(K) {
  const C = COMMONS;
  K.setGroup('int:north:0');
  // round columns through the atrium (light grey, ~9 m grid) [CB, C1]
  for (const z of [214.5, 223, 231.5]) K.column(ATRIUM.x1 + 0.35, z, 0, H, { r: 0.34, look: 'column' });
  for (const x of [-33.7, -24.6, -15.5]) K.box({ cx: x, cz: C.z0 + 0.45, hx: 0.55, hz: 0.35, yaw: 0, y0: 0, y1: ROOF - 0.4 }, { mat: 'block', look: 'blockGrey', role: 'column' });
  for (const z of [214.5, 223, 231.5]) K.box({ cx: C.x0 + 0.45, cz: z, hx: 0.35, hz: 0.55, yaw: 0, y0: H, y1: ROOF - 0.4 }, { mat: 'block', look: 'blockGrey', role: 'column' });
  // dark terrazzo bands across the light field (1.2 m wide, 9 m grid) [CB, C1]
  for (const x of [-34, -24.75, -15.5]) K.decor({ cx: x, cz: (C.z0 + C.z1) / 2, hx: 1.0, hz: (C.z1 - C.z0) / 2, yaw: 0, y0: 0.04, y1: 0.044 }, 'terrazzoDark', { faces: { top: 'terrazzoDark', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  for (const z of [209.5, 218.5, 227.5, 236.5]) K.decor({ cx: (C.x0 + C.x1) / 2, cz: z, hx: (C.x1 - C.x0) / 2, hz: 1.0, yaw: 0, y0: 0.041, y1: 0.045 }, 'terrazzoDark', { faces: { top: 'terrazzoDark', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  // round cafe tables (1.2 m) with 4 black chairs; a few square tables; tables are light cover
  const rnd = K.rnd;
  for (let x = C.x0 + 3.6; x < C.x1 - 6; x += 4.4)
    for (let z = C.z0 + 3.4; z < C.z1 - 2.5; z += 4.2) {
      const jx = x + (rnd() - 0.5) * 0.6;
      const jz = z + (rnd() - 0.5) * 0.6;
      // (QA) keep the tables and their chairs off the feature stair, its foot and its landing
      if (jx > LANDING.x0 - 1.8 && jz > LANDING.z0 - 1.5 && jz < 230.5) continue;
      const top = K.box({ cx: jx, cz: jz, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.72, y1: 0.76 }, { mat: 'wood', hp: 120, look: 'none', role: 'prop' });
      K.decor({ cx: jx, cz: jz, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.72, y1: 0.76 }, '#3a3a3c', { shape: 'cyl', dep: top });
      K.decor({ cx: jx, cz: jz, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.755, y1: 0.765 }, '#dcd8d0', { shape: 'cyl', dep: top });
      K.decor({ cx: jx, cz: jz, hx: 0.05, hz: 0.05, yaw: 0, y0: 0, y1: 0.72 }, '#2a2a2c', { shape: 'cyl', dep: top });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + rnd() * 0.5;
        const cx = jx + Math.cos(a) * 0.95;
        const cz = jz + Math.sin(a) * 0.95;
        K.decor({ cx, cz, hx: 0.21, hz: 0.21, yaw: a, y0: 0.43, y1: 0.47 }, '#1b1b1d');
        K.decor({ cx: cx + Math.cos(a) * 0.2, cz: cz + Math.sin(a) * 0.2, hx: 0.02, hz: 0.2, yaw: a, y0: 0.6, y1: 0.86 }, '#1b1b1d');
        for (const [lu, lv] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
          const lx = cx + Math.cos(a) * lu - Math.sin(a) * lv;
          const lz = cz + Math.sin(a) * lu + Math.cos(a) * lv;
          K.decor({ cx: lx, cz: lz, hx: 0.012, hz: 0.012, yaw: a, y0: 0, y1: 0.43 }, '#9a9ca0');
        }
        K.decor({ cx: cx + Math.cos(a) * 0.19, cz: cz + Math.sin(a) * 0.19, hx: 0.012, hz: 0.19, yaw: a, y0: 0.47, y1: 0.6 }, '#9a9ca0');
      }
    }
  // servery storefront on the north wall (glass, lit inside) and a wall clock [CB]
  K.decor({ cx: -16, cz: C.z0 + 0.14, hx: 4.5, hz: 0.05, yaw: 0, y0: 0.9, y1: 3.0 }, 'glass');
  K.decor({ cx: -16, cz: C.z0 + 0.12, hx: 4.7, hz: 0.06, yaw: 0, y0: 3.0, y1: 3.15 }, 'alu');
  K.decor({ cx: -10.4, cz: C.z0 + 0.16, hx: 0.35, hz: 0.03, yaw: 0, y0: 3.4, y1: 4.1 }, '#f4f4f0', { shape: 'cyl' });
  // tall dark banner panels on the wood walls, blank but for the gold emblem disc [CB, C1]
  K.setGroup('int:north:1');
  for (let i = 0; i < 6; i++) {
    const x = C.x0 + 3 + i * 4.2;
    K.decor({ cx: x, cz: C.z0 + 0.14, hx: 0.85, hz: 0.04, yaw: 0, y0: H + 1.2, y1: H + 4.6 }, 'banner');
    K.decor({ cx: x, cz: C.z0 + 0.19, hx: 0.5, hz: 0.01, yaw: 0, y0: H + 3.2, y1: H + 4.2 }, 'emblem', { faces: { pv: 'emblem', nv: 'none', pu: 'none', nu: 'none', top: 'none', bottom: 'none' } });
  }
  // 2nd / 3rd floor walkway + lounge: glass railings over the atrium [C1, CB]
  for (const L of [1, 2]) {
    K.setGroup(`int:north:${L}`);
    K.railing([ATRIUM.x1, ATRIUM.z0], [ATRIUM.x1, L === 1 ? LANDING.z0 : 211], L * H, { style: 'glass' });
    K.railing([ATRIUM.x1, L === 1 ? LANDING.z1 : 211], [ATRIUM.x1, ATRIUM.z1], L * H, { style: 'glass' });
    K.railing([ATRIUM.x0 + 0.3, ATRIUM.z0], [ATRIUM.x1, ATRIUM.z0], L * H, { style: 'glass' });
    // the south walkway (corSW, lockers along it) over the atrium; west of LOBBY.x1 the lobby is
    // double-height on floor 2 (railed below) and a walled office on floor 3
    K.railing([LOBBY.x1, ATRIUM.z1], [ATRIUM.x1, ATRIUM.z1], L * H, { style: 'glass' });
    if (L === 1) {
      K.railing([LOBBY.x1, LOBBY.z0], [LOBBY.x1, SOUTH_ENTRY.z0], H, { style: 'glass' });
      K.railing([SOUTH_ENTRY.x0, SOUTH_ENTRY.z0], [SOUTH_ENTRY.x1, SOUTH_ENTRY.z0], H, { style: 'glass' });
    }
  }
  // feature stair: commons floor up to the 2nd-floor walkway (glass rails)
  K.setGroup('int:north:0');
  K.stairs([-13, 228], [LANDING.cx, LANDING.z1], 0, H, 2.1, { rail: 'glass' });
  // (QA: the flight topped out over the open atrium, 1 m short of the bridge) a top landing that runs
  // east onto the 2nd-floor walkway, glass-railed on its open sides
  K.setGroup('int:north:1');
  K.slab({ x0: LANDING.x0, x1: ATRIUM.x1, z0: LANDING.z0, z1: LANDING.z1 }, H, { t: 0.3, lookTop: 'terrazzo', lookBottom: 'wood', lookEdge: 'wood' });
  K.railing([LANDING.x0, LANDING.z0], [ATRIUM.x1, LANDING.z0], H, { style: 'glass' });
  K.railing([LANDING.x0, LANDING.z0], [LANDING.x0, LANDING.z1], H, { style: 'glass' });
  K.setGroup('int:north:0');
  // exposed round blue ductwork across the atrium ceiling [CB]
  K.setGroup('int:north:2');
  K.decor({ cx: (ATRIUM.x0 + ATRIUM.x1) / 2, cz: 214, hx: (ATRIUM.x1 - ATRIUM.x0) / 2, hz: 0.28, yaw: 0, y0: ROOF - 1.2, y1: ROOF - 0.75 }, 'duct');
  // high-bay pendant lights over the atrium
  K.setGroup('int:north:2');
  for (const x of [-33, -24.75, -16])
    for (const z of [210, 223, 236]) {
      K.decor({ cx: x, cz: z, hx: 0.5, hz: 0.5, yaw: 0, y0: ROOF - 2.6, y1: ROOF - 2.45 }, 'fixture', { shape: 'cyl' });
      K.decor({ cx: x, cz: z, hx: 0.01, hz: 0.01, yaw: 0, y0: ROOF - 2.45, y1: ROOF - 0.4 }, 'picket');
    }
  for (const [x, z] of [[-30, 214], [-20, 228], [-30, 236]]) K.light({ x, y: 7, z, range: 22, intensity: 1.0, color: 0xfff3e2 });
  // loot: commons tables, servery, front office
  K.loot({ kind: 'chest', x: -16, z: C.z0 + 1.2, y: 0, yaw: Math.PI });
  K.loot({ kind: 'ammoBox', x: -34, z: 238, y: 0 });
  K.loot({ kind: 'item', x: -24, z: 220, y: 0 });
}

/** Rooftop HVAC units and walk pads (membrane roof with grey pads) [NOR, AE2, 3DF]. */
function roofHero(K) {
  K.setGroup('ext');
  const units = [[-20, 185], [5, 190], [30, 188], [-25, 255], [10, 256], [40, 257], [50, 225], [-30, 222]];
  for (const [x, z] of units) {
    K.box({ cx: x, cz: z, hx: 1.6, hz: 1.1, yaw: 0, y0: ROOF, y1: ROOF + 1.4 }, { mat: 'metal', look: 'metalGrey', faces: { top: 'alu' } });
    K.decor({ cx: x + 0.4, cz: z, hx: 0.45, hz: 0.45, yaw: 0, y0: ROOF + 1.4, y1: ROOF + 1.6 }, '#3a3d40', { shape: 'cyl' });
  }
  for (const [x, z, hx, hz] of [[0, 177.6, 20, 0.6], [42.6, 228, 0.6, 18], [10, 252, 22, 0.6]]) K.decor({ cx: x, cz: z, hx, hz, yaw: 0, y0: ROOF, y1: ROOF + 0.03 }, 'roofPad');
}

/** Courtyard: grass, a curved path and benches [AE2, NOR]. */
function courtHero(K) {
  K.setGroup('ext');
  const c = { x0: -5.8, x1: 33.8, z0: 203.2, z1: 236.8 };
  K.decor({ cx: (c.x0 + c.x1) / 2, cz: (c.z0 + c.z1) / 2, hx: (c.x1 - c.x0) / 2, hz: (c.z1 - c.z0) / 2, yaw: 0, y0: 0, y1: 0.03 }, 'grass', { faces: { top: 'grass', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * 0.15 + (i / 16) * Math.PI * 0.75;
    K.decor({ cx: 12 + Math.cos(a) * 13, cz: 228 - Math.sin(a) * 12, hx: 1.0, hz: 0.8, yaw: -a, y0: 0, y1: 0.04 }, 'paving');
  }
  for (const [x, z] of [[4, 213], [20, 213], [12, 229]]) K.box({ cx: x, cz: z, hx: 0.9, hz: 0.25, yaw: 0, y0: 0, y1: 0.45 }, { mat: 'wood', look: '#7a5a3c', role: 'prop' });
}

export function buildNorth(K) {
  const plan = buildPlan(K, {
    name: 'north',
    outline: NORTH_OUTLINE,
    courts: [NORTH_COURT],
    storeys: 3,
    h: H,
    parapet: 0.9,
    wallLook: 'brick',
    facade,
    rooms: rooms(),
    voids: [
      { level: 1, ...ATRIUM },
      { level: 2, ...ATRIUM },
      { level: 1, x0: LOBBY.x0, x1: LOBBY.x1, z0: LOBBY.z0, z1: LOBBY.z1 },
      { level: 1, ...SOUTH_ENTRY },
    ],
    stairHalls: [
      { x0: -46.3, x1: -38.4, z0: 164.6, z1: 176, from: 'z1', levels: [0, 1] },
      { x0: TOWER.x0 + 0.1, x1: TOWER.x1, z0: TOWER.z0, z1: TOWER.z1, from: 'z0', levels: [0, 1] },
      { x0: 44.2, x1: 52, z0: 205.2, z1: 217, from: 'z1', levels: [0, 1] },
      { x0: 57.6, x1: 64.6, z0: 249.8, z1: 261, from: 'z0', levels: [0, 1], rail: 'glass' },
    ],
  });
  entranceHero(K);
  commonsHero(K);
  roofHero(K);
  courtHero(K);
  return plan;
}
