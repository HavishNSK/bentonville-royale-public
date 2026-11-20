// BENTONVILLE ROYALE — Bentonville High School, main / South building (pure plan data + exterior hero).
//
//   buildSouth(K, heroes) -> plan     heroes = { gym?, library?, arend?, classrooms? } builders (subagents)
//
// From the reference photos (docs/bhs/STYLE_BIBLE.md §3; short names there):
//   - 2 storeys of red brick with a buff brick top band and buff floor-line band, punched windows in
//     pairs [WLK, 3DF, SOU]; white membrane roofs; taller volumes: gyms (west), the Arend Arts Center
//     (north-east, with a fly tower), the cafeteria (centre) and the library [L3D, 3DF, AE1]
//   - entry court in the north notch: a long water channel and a curved arch beam on posts at the
//     court mouth [SOU]; the covered walkway on buff brick piers across to the North Building [WLK]
// Room arrangement beyond the hero spaces is an invented, typical plan (approximate).
// The outline is the map's OSM footprint of building 952075842 (x east, z south, metres).

import { SIZE } from './kit/palette.js';
import { buildPlan } from './kit/plan.js';

export const SOUTH_ID = 952075842;
const H = SIZE.storey;
const ROOF = 2 * H; // 8.8

export const SOUTH_OUTLINE = [
  [-108.9, 396.5], [-96.7, 396.6], [-96.7, 401.6], [-23.7, 402.9], [-23.4, 388.4], [-6.3, 388.7], [-6.5, 403.1], [2.3, 403.4], [2.2, 406.5],
  [14.1, 406.9], [14.4, 394.1], [34.5, 394.8], [34.5, 400.5], [40.3, 400.5], [40.1, 428], [111.4, 429.1], [112.1, 398.4], [113.8, 398.5],
  [114, 391.7], [112.3, 391.6], [112.4, 382.6], [97.9, 382.3], [98.7, 330.3], [94.9, 330.3], [94.9, 327.9], [107.6, 328.1], [108.4, 292.1],
  [91, 291.9], [90.9, 294.6], [76.9, 294.1], [76.8, 294.9], [54.3, 294.4], [54.3, 291], [35.9, 291], [33.3, 291.4], [31.1, 292.3], [30, 292.9],
  [28.8, 291], [26, 293.2], [24.3, 291.6], [22.7, 293.5], [21.3, 296.2], [18.9, 295.3], [18, 298.6], [17.7, 302.2], [1.9, 301.8], [1.6, 333.7],
  [-4.5, 333.7], [-4.5, 332.6], [-7.6, 331.9], [-10.7, 331.6], [-14, 331.9], [-16.4, 332.5], [-16.4, 333.6], [-22.3, 333.3], [-22, 311.4],
  [-94.7, 310], [-94.7, 308.5], [-107.1, 307.2], [-113.9, 370], [-108.5, 370],
];

// hero spaces (rects in world metres) — the subagents build inside these
export const ARENA = { x0: -94, x1: -44, z0: 312, z1: 371, top: 13.6 }; // Tiger Arena (competition gym)
export const AUX_GYM = { x0: -94, x1: -64, z0: 371, z1: 396, top: 11.6 };
export const CAFE = { x0: -22, x1: 18, z0: 334, z1: 372, top: 11.8 };
export const AREND_LOBBY = { x0: 18, x1: 40, z0: 291, z1: 336 };
export const AREND_HOUSE = { x0: 40, x1: 84, z0: 294.5, z1: 336, top: 14.5 };
export const AREND_STAGE = { x0: 84, x1: 108, z0: 292.2, z1: 330, top: 19.5 };
export const LIBRARY = { x0: 41, x1: 94, z0: 383, z1: 428.5, top: 11.2 };
export const COURT = { x0: -22, x1: 1.7, z0: 301, z1: 333 }; // the entry court (outside)
// where the BHS reboot van parks (src/game/Reboot.js picks it deterministically: the cafeteria). The
// cafeteria furniture keeps VAN_CLEAR m away so the van's spot stays free (tests/bhs-buildings.test.mjs)
export const VAN_SPOT = Object.freeze({ x: -0.9, z: 352.1 });
export const VAN_CLEAR = 6.5;

const R = (o) => ({ walls: true, floor: 'vct', wall: 'paint', ceiling: 'ceilingTile', ...o });
const floorFor = (label) => (/Seminar|Study|Tutoring|Gallery/.test(label) ? 'carpet' : /Band|Choir|Orchestra|Piano|Music/.test(label) ? 'woodFloor' : 'vct');
const classroom = (id, level, x0, x1, z0, z1, door, label = 'Classroom', kind = 'classroom') => R({ id, level, x0, x1, z0, z1, kind, label, floor: floorFor(label), doors: [{ side: door, at: 1.2, w: 1.0 }] });
const corridor = (id, level, x0, x1, z0, z1, extra = {}) => R({ id, level, x0, x1, z0, z1, kind: 'corridor', label: 'Hallway', walls: false, ...extra });
const SUBJ = ['English Classroom', 'Math Classroom', 'History Classroom', 'Language Classroom', 'Computer Lab', 'Art Studio', 'Science Lab', 'Culinary Lab', 'Engineering Lab'];

function rooms() {
  const out = [];
  let k = 0;
  const subj = () => SUBJ[k++ % SUBJ.length];
  for (let L = 0; L < 2; L++) {
    const t = `L${L}`;
    // ---- west wing: classrooms along the (slanted) west face + corridor
    const wz = [310, 324, 338, 352, 366, 380, 396.5];
    for (let i = 0; i + 1 < wz.length; i++) out.push(classroom(`w${i}${t}`, L, -114, -98.5, wz[i], wz[i + 1], 'x1', subj()));
    out.push(corridor(`corW${t}`, L, -98.5, -94, 309, 401));
    // ---- south corridor along the south wall (behind the gyms)
    out.push(corridor(`corSW${t}`, L, -94, -44, 396, 402.6));
    // ---- gyms block
    // (QA: the gap between the arena's north wall and the outer wall was an open back alley joining
    // corridors W and C) a walled mechanical chase, closed at both ends
    out.push(R({ id: `chase${t}`, level: L, x0: -94, x1: -44, z0: 306, z1: 312, kind: 'chase', label: 'Mechanical', fixtures: false }));
    if (L === 0) {
      out.push(R({ id: 'arena', level: 0, ...ARENA, tall: 2, kind: 'gym', label: 'Tiger Arena', floor: 'none', wall: 'blockGrey', ceiling: 'none', ceilingTop: ARENA.top, fixtures: false, hero: 'gym', doors: [{ side: 'x0', at: 8, w: 2.4 }, { side: 'x0', at: 50, w: 2.4 }, { side: 'x1', at: 30, w: 2.4 }] }));
      out.push(R({ id: 'auxgym', level: 0, ...AUX_GYM, tall: 2, kind: 'gym', label: 'Auxiliary Gym', floor: 'none', wall: 'blockGrey', ceiling: 'none', ceilingTop: AUX_GYM.top, fixtures: false, hero: 'gym', doors: [{ side: 'x0', at: 12, w: 2.0 }, { side: 'z1', at: 15, w: 2.0 }] }));
      out.push(R({ id: 'lockB', level: 0, x0: -64, x1: -54, z0: 371, z1: 396, kind: 'locker', label: 'Locker Room', wall: 'blockGrey', doors: [{ side: 'z1', at: 5, w: 1.2 }] }));
      out.push(R({ id: 'lockG', level: 0, x0: -54, x1: -44, z0: 371, z1: 396, kind: 'locker', label: 'Locker Room', wall: 'blockGrey', doors: [{ side: 'z1', at: 5, w: 1.2 }] }));
    } else {
      out.push(R({ id: 'weight', level: 1, x0: -64, x1: -54, z0: 371, z1: 396, kind: 'gym', label: 'Weight Room', floor: 'carpet', doors: [{ side: 'z1', at: 5, w: 1.2 }] }));
      out.push(R({ id: 'wrestle', level: 1, x0: -54, x1: -44, z0: 371, z1: 396, kind: 'gym', label: 'Wrestling Room', floor: 'carpet', doors: [{ side: 'z1', at: 5, w: 1.2 }] }));
    }
    // ---- spine east of the arena, main hall east-west, offices + kitchen west of the cafeteria
    out.push(corridor(`corC${t}`, L, -44, -40, 309, 402.6));
    out.push(corridor(`hall${t}`, L, -40, 98, 372, 376.5, { floor: L === 0 ? 'terrazzo' : 'vct', label: 'Main Hall' }));
    if (L === 0) {
      out.push(R({ id: 'office', level: 0, x0: -40, x1: -22, z0: 311, z1: 333.5, kind: 'office', label: 'Main Office', floor: 'carpet', doors: [{ side: 'x0', at: 6, w: 1.6 }, { side: 'x1', at: 14, w: 1.6, type: 'door' }] }));
      out.push(R({ id: 'kitchen', level: 0, x0: -40, x1: -22, z0: 333.5, z1: 360, kind: 'kitchen', label: 'Kitchen', floor: 'vct', wall: 'blockGrey', doors: [{ side: 'x1', at: 10, w: 2.4 }, { side: 'x0', at: 20, w: 1.2 }] }));
      out.push(R({ id: 'cafe', level: 0, ...CAFE, tall: 2, kind: 'cafeteria', label: 'Cafeteria', walls: false, floor: 'terrazzo', wall: 'blockGrey', wallLevels: ['blockGrey', 'wood'], ceiling: 'ceilingTile', ceilingTop: CAFE.top - 0.5, ceilingDrop: 0, fixtures: false }));
    } else {
      out.push(classroom('o1', 1, -40, -31, 311, 333.5, 'x0', subj()));
      out.push(classroom('o2', 1, -31, -22, 311, 333.5, 'z1', subj()));
      out.push(classroom('k1', 1, -40, -22, 333.5, 360, 'x0', 'Teacher Workroom', 'office'));
    }
    out.push(R({ id: `stA${t}`, level: L, x0: -40, x1: -34, z0: 360, z1: 372, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'blockGrey', doors: [{ side: 'z1', at: 1, w: 2.0 }] }));
    out.push(R({ id: `sto${t}`, level: L, x0: -34, x1: -22, z0: 360, z1: 372, kind: 'storage', label: L ? 'Storage' : 'Servery Storage', doors: [{ side: 'z1', at: 6, w: 1.2 }] }));
    // ---- Arend Arts Center (north-east)
    if (L === 0) {
      out.push(R({ id: 'arendLobby', level: 0, ...AREND_LOBBY, tall: 2, kind: 'lobby', label: 'Arts Center Lobby', walls: true, floor: 'terrazzo', wall: 'libWall', ceiling: 'aacCeiling', ceilingDrop: 0, hero: 'arend', doors: [{ side: 'x1', at: 20, w: 2.4 }, { side: 'z1', at: 10, w: 2.4 }] }));
      out.push(R({ id: 'arendHouse', level: 0, ...AREND_HOUSE, tall: 2, kind: 'auditorium', label: 'Arend Arts Center', floor: 'none', wall: 'acoustic', ceiling: 'none', ceilingTop: AREND_HOUSE.top, fixtures: false, hero: 'arend', doors: [{ side: 'x0', at: 8, w: 2.0 }, { side: 'x0', at: 32, w: 2.0 }, { side: 'z1', at: 6, w: 2.0 },
        // the proscenium (16 x 8 m, through both wall levels) and the upper-lobby door to the balcony stair (Arend agent)
        { side: 'x1', at: 19, w: 16, h: 8.1, type: 'void', leaf: false },
        { side: 'x1', at: 19, w: 16, h: 3.68, level: 1, type: 'void', leaf: false },
        { side: 'x0', at: 24, w: 2.0, h: 2.4, level: 1, leaf: false }] }));
      out.push(R({ id: 'arendStage', level: 0, ...AREND_STAGE, tall: 2, kind: 'stage', label: 'Stage', floor: 'none', wall: 'blockGrey', ceiling: 'none', ceilingTop: AREND_STAGE.top, fixtures: false, hero: 'arend', walls: true, doors: [{ side: 'z1', at: 4, w: 2.4 }] }));
    }
    // backstage / music + art between the theatre and the main hall
    out.push(R({ id: `shop${t}`, level: L, x0: 84, x1: 94, z0: 330, z1: 350, kind: 'storage', label: L ? 'Dressing Rooms' : 'Scene Shop', doors: [{ side: 'x1', at: 10, w: L ? 1.0 : 3.0 }] }));
    out.push(R({ id: `green${t}`, level: L, x0: 84, x1: 94, z0: 350, z1: 362, kind: 'office', label: L ? 'Costume Storage' : 'Green Room', doors: [{ side: 'x1', at: 6, w: 1.0 }] }));
    out.push(R({ id: `stB${t}`, level: L, x0: 88, x1: 94, z0: 362, z1: 372, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'blockGrey', doors: [{ side: 'z1', at: 1, w: 2.0 }] }));
    // (QA: an unroomed, grass-floored pocket) custodial closet between the choir room and stair B
    out.push(R({ id: `jan${t}`, level: L, x0: 84, x1: 88, z0: 362, z1: 372, kind: 'storage', label: 'Custodial', doors: [{ side: 'z1', at: 2, w: 1.0 }] }));
    out.push(R({ id: `mus0${t}`, level: L, x0: 40, x1: 62, z0: 336, z1: 372, kind: 'music', label: L ? 'Orchestra Room' : 'Band Room', floor: 'woodFloor', doors: [{ side: 'z1', at: 4, w: 2.0 }] }));
    out.push(R({ id: `mus1${t}`, level: L, x0: 62, x1: 84, z0: 336, z1: 372, kind: 'music', label: L ? 'Piano Lab' : 'Choir Room', floor: 'woodFloor', doors: [{ side: 'z1', at: 4, w: 2.0 }] }));
    out.push(classroom(`art0${t}`, L, 18, 29, 336, 372, 'z1', L ? 'Art Studio' : 'Gallery', L ? 'classroom' : 'gallery'));
    // the block between the entry court and the Arend lobby, behind the curved brick drums
    out.push(R({ id: `corner${t}`, level: L, x0: 1.7, x1: 18, z0: 301.8, z1: 334, kind: L ? 'classroom' : 'gallery', label: L ? 'Art Studio' : 'Student Gallery', floor: L ? 'vct' : 'terrazzo', doors: [{ side: 'z1', at: 8, w: 2.0 }, { side: 'x1', at: 16, w: 1.6 }] }));
    out.push(classroom(`art1${t}`, L, 29, 40, 336, 372, 'z1', 'Art Studio'));
    if (L === 1) {
      out.push(R({ id: 'cafeUp', level: 1, ...CAFE, kind: 'atrium', label: 'Cafeteria', walls: false, floor: 'none', ceiling: 'none', wall: 'wood', fixtures: false }));
      out.push(R({ id: 'arendLobbyUp', level: 1, ...AREND_LOBBY, kind: 'atrium', label: 'Arts Center Lobby', walls: false, floor: 'none', ceiling: 'none', wall: 'libWall', fixtures: false }));
    }
    // ---- east wing (classrooms) + corridor
    out.push(corridor(`corE${t}`, L, 94, 98, 330, 382.5));
    // (no classrooms east of x 98 here: the outline's east edge is at x ~98 between z 330 and 382)
    // ---- south-centre: classrooms both sides of a short corridor, the library (SE)
    out.push(corridor(`corSC${t}`, L, -22, 41, 376.5, 380));
    const scx = [-22, -11, 0, 11, 22, 34.5];
    for (let i = 0; i + 1 < scx.length; i++) out.push(classroom(`sc${i}${t}`, L, scx[i], scx[i + 1], 380, 407, 'z0', subj()));
    out.push(classroom(`sc5${t}`, L, 34.5, 41, 380, 400.5, 'z0', 'Seminar Room'));
    if (L === 0) out.push(R({ id: 'library', level: 0, ...LIBRARY, tall: 2, kind: 'library', label: 'Library', floor: 'none', wall: 'libWall', ceiling: 'none', ceilingTop: LIBRARY.top, fixtures: false, hero: 'library', doors: [{ side: 'z0', at: 10, w: 2.4 }, { side: 'x0', at: 6, w: 1.8 }] }));
    out.push(classroom(`ee${t}`, L, 94, 113.8, 382.5, 398.5, 'z0', subj()));
    // (QA: these were empty, grass-floored) the block south of it, beside the library ...
    out.push(classroom(`lw${t}`, L, 94, 112.5, 398.5, 413.5, 'z0', L ? 'Seminar Room' : 'Library Workroom', 'office'));
    out.push(classroom(`lc${t}`, L, 94, 112.5, 413.5, 429.2, 'z0', 'Computer Lab'));
    // ... the foyer strip in front of the library ...
    out.push(corridor(`libHall${t}`, L, 41, 94, 376.5, 383, { label: 'Library Foyer', floor: L === 0 ? 'terrazzo' : 'vct' }));
    // ... and the block west of the south classrooms, off the main hall and corridor C
    out.push(classroom(`sw0${t}`, L, -40, -22, 376.5, 389.5, 'z0', subj()));
    out.push(classroom(`sw1${t}`, L, -40, -22, 389.5, 403, 'x0', subj()));
    // (QA: the rest of the old classroom w5 was an empty, grass-floored hole) a short hall from stair C
    // to corridor W and a storage room south of the stair
    out.push(corridor(`stCv${t}`, L, -102, -98.5, 380, 392));
    out.push(R({ id: `cust${t}`, level: L, x0: -114, x1: -98.5, z0: 392, z1: 396.5, kind: 'storage', label: 'Storage', doors: [{ side: 'x1', at: 2.2, w: 1.0 }] }));
    out.push(R({ id: `stC${t}`, level: L, x0: -108, x1: -102, z0: 380, z1: 392, kind: 'stair', label: 'Stairwell', floor: 'stairTread', wall: 'blockGrey', doors: [{ side: 'x1', at: 1, w: 2.0 }] }));
  }
  // the west classroom at L*380..396 overlaps stair C: drop it from the rect list (stair takes its place)
  return out.filter((r) => !(/^w5L/.test(r.id)));
}

// ---------------------------------------------------------------- facades

function punched(L, level, { bay = 3.6, w = 1.5 } = {}) {
  const sill = level === 0 ? 0.85 : 1.0;
  const head = level === 0 ? 2.8 : 2.7;
  const n = Math.floor((L - 1.2) / bay);
  const start = (L - n * bay) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = start + bay * (i + 0.5);
    out.push({ u0: c - w / 2, u1: c + w / 2, y0: sill, y1: head, type: 'window' });
  }
  return out;
}

const insideRect = (r, x, z, m = 1.5) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

function facade(e) {
  const [mx, mz] = e.mid;
  const out = [];
  // blank brick on the big volumes (arena, aux gym, theatre, stage); punched windows elsewhere
  const blank = [ARENA, AUX_GYM, AREND_HOUSE, AREND_STAGE].some((r) => insideRect(r, mx, mz, 2.5));
  // the Arend lobby's curved front is glass [SOU]; the court faces are storefront on the ground floor
  const arendGlass = insideRect(AREND_LOBBY, mx, mz, 1.2) && mz < 303;
  const court = mx > COURT.x0 - 0.8 && mx < COURT.x1 + 0.8 && mz > COURT.z0 - 0.8 && mz < COURT.z1 + 0.8;
  for (let L = 0; L < 2; L++) {
    if (arendGlass && e.L > 1.2) {
      out.push({ level: L, lookOut: 'brick', openings: [{ u0: 0.1, u1: e.L - 0.1, y0: L === 0 ? 0.05 : -0.2, y1: H + 0.2, type: 'glass', bay: 1.4, rows: 3 }] });
      continue;
    }
    if (court && e.L > 3) {
      const ops = L === 0 ? [{ u0: 0.6, u1: e.L - 0.6, y0: 0.05, y1: 3.4, type: 'glass', bay: 1.5, rows: 2 }] : punched(e.L, L);
      if (L === 0 && Math.abs(mz - 333.5) < 1 && e.L > 4) ops.push({ u0: e.L / 2 - 1.4, u1: e.L / 2 + 1.4, y0: 0, y1: 2.5, type: 'door', leaf: false, frameLook: 'alu' });
      out.push({ level: L, lookOut: 'brick', openings: L === 0 && Math.abs(mz - 333.5) < 1 && e.L > 4 ? ops.filter((o) => o.type === 'door' || o.u1 < e.L / 2 - 1.6 || o.u0 > e.L / 2 + 1.6).concat([{ u0: 0.6, u1: e.L / 2 - 1.6, y0: 0.05, y1: 3.4, type: 'glass', bay: 1.5, rows: 2 }, { u0: e.L / 2 + 1.6, u1: e.L - 0.6, y0: 0.05, y1: 3.4, type: 'glass', bay: 1.5, rows: 2 }]).filter((o) => o.type !== 'glass' || o.u1 - o.u0 > 0.8) : ops });
      continue;
    }
    let ops = blank || e.L < 3 ? [] : punched(e.L, L);
    // exterior doors (ground floor): west wing, south side, east wing, Arend lobby north, library
    if (L === 0 && e.L > 12) {
      const doorAt = (u) => {
        ops = ops.filter((o) => o.u1 < u - 1.8 || o.u0 > u + 1.8);
        ops.push({ u0: u - 1.2, u1: u + 1.2, y0: 0, y1: 2.5, type: 'door', leaf: false, frameLook: 'alu' });
      };
      if (Math.abs(mz - 402.3) < 1.5 && mx < -24) doorAt(e.L * 0.25); // south wall behind the gyms
      if (mx > 111 && mz > 300 && mz < 330) doorAt(e.L / 2); // stage loading door
      if (mx > 97 && mx < 99.5 && mz > 340 && mz < 380) doorAt(e.L / 2); // east wing
      if (mz > 427 && mx > 40) doorAt(e.L * 0.2); // library side
      if (mx < -100 && mz > 330 && mz < 360) doorAt(e.L * 0.45); // west wing
    }
    out.push({ level: L, lookOut: 'brick', openings: ops });
  }
  return out;
}

/** Buff floor-line band and buff top band on every brick outline edge [WLK, SOU]. */
function bands(K) {
  K.setGroup('ext');
  const p = SOUTH_OUTLINE;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1) continue;
    K.decor({ ...K.along(a, b, 0.5, H - 0.25, H + 0.05) }, 'buffBrick');
    K.decor({ ...K.along(a, b, 0.48, ROOF - 0.9, ROOF + 0.85) }, 'buffBrick');
  }
}

/** Entry court: paving, the long water channel (cascade), the curved arch beam on posts [SOU]. */
function entryCourt(K) {
  K.setGroup('ext');
  const C = COURT;
  K.decor({ cx: (C.x0 + C.x1) / 2, cz: (C.z0 + C.z1) / 2, hx: (C.x1 - C.x0) / 2, hz: (C.z1 - C.z0) / 2, yaw: 0, y0: 0, y1: 0.05 }, 'paving', { faces: { top: 'paving', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  // the water channel: a raised stone trough running north-south down the middle, stepping down
  const cx = (C.x0 + C.x1) / 2;
  for (let i = 0; i < 4; i++) {
    const z0 = C.z0 + 2 + i * 7;
    const top = 1.1 - i * 0.25;
    K.box({ cx, cz: z0 + 3.4, hx: 1.6, hz: 3.4, yaw: 0, y0: 0, y1: top }, { mat: 'block', look: 'cmuLight', faces: { top: 'cmuLight' } });
    K.decor({ cx, cz: z0 + 3.4, hx: 1.25, hz: 3.3, yaw: 0, y0: top - 0.02, y1: top + 0.02 }, 'water');
  }
  // the curved arch beam at the court mouth on round posts [SOU]
  const r = 16;
  const zc = C.z0 + 12;
  for (let k = 0; k < 12; k++) {
    const a0 = Math.PI * (0.5 - 0.32) + (k / 12) * Math.PI * 0.64;
    const a1 = Math.PI * (0.5 - 0.32) + ((k + 1) / 12) * Math.PI * 0.64;
    const p0 = [cx + Math.cos(a0) * r, zc - Math.sin(a0) * r * 0.55];
    const p1 = [cx + Math.cos(a1) * r, zc - Math.sin(a1) * r * 0.55];
    K.decor({ ...K.along(p0, p1, 0.5, 4.2, 4.8) }, 'cmuLight');
  }
  for (const s of [-1, -0.5, 0.5, 1]) {
    const a = Math.PI * 0.5 + s * Math.PI * 0.3;
    K.column(cx + Math.cos(a) * r, zc - Math.sin(a) * r * 0.55, 0, 4.2, { r: 0.28, look: 'cmuLight' });
  }
  K.light({ x: cx, y: 4, z: zc, range: 14, intensity: 0.4 });
}

/**
 * The crosswalk between the buildings [user, WLK, NOR, SOU]: a painted zebra crossing over the service
 * road in line with the North Building's south entrance (x ~ -20), a path, and the covered walkway
 * on buff brick piers, attached to THIS building only: it reaches from the entry court part of the
 * way toward the road (it does not span the crossing). The deep buff fascia's lettering is left blank.
 */
function walkway(K) {
  K.setGroup('ext');
  const x0 = -23.2;
  const x1 = -16.8;
  const z0 = 281.8; // north end: over the south half of the crossing [user: it spans part of it]
  const z1 = 312; // into the entry court / onto the building front
  // piers stay off the road (z 280..284)
  for (let z = 285.2; z <= z1 - 0.5; z += 6.2) for (const x of [x0, x1]) K.box({ cx: x, cz: z, hx: 0.45, hz: 0.45, yaw: 0, y0: 0, y1: 3.4 }, { mat: 'brick', look: 'buffBrick' });
  K.box({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2 + 0.6, hz: (z1 - z0) / 2 + 0.3, yaw: 0, y0: 3.4, y1: 3.7 }, { mat: 'metal', look: 'canopy', faces: { top: 'roof', bottom: 'canopy' }, role: 'canopy' });
  for (const x of [x0 - 0.65, x1 + 0.65]) K.decor({ cx: x, cz: (z0 + z1) / 2, hx: 0.08, hz: (z1 - z0) / 2 + 0.3, yaw: 0, y0: 3.3, y1: 4.3 }, 'buffFascia');
  K.decor({ cx: (x0 + x1) / 2, cz: z0 - 0.3, hx: (x1 - x0) / 2 + 0.7, hz: 0.08, yaw: 0, y0: 3.3, y1: 4.3 }, 'buffFascia');
  // paving under it and the path north to the crossing
  K.decor({ cx: (x0 + x1) / 2, cz: (284.5 + z1) / 2, hx: (x1 - x0) / 2 - 0.2, hz: (z1 - 284.5) / 2, yaw: 0, y0: 0.03, y1: 0.06 }, 'paving', { faces: { top: 'paving', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  // zebra crossing over the service road
  for (let x = x0 + 0.3; x < x1 - 0.2; x += 1.0) K.decor({ cx: x + 0.25, cz: 282, hx: 0.25, hz: 2.6, yaw: 0, y0: 0.05, y1: 0.07 }, '#ecebe6', { faces: { top: '#ecebe6', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  // picnic tables at the walkway's west side [WLK]
  for (const z of [292, 298]) {
    const t = K.box({ cx: x0 - 3, cz: z, hx: 0.9, hz: 0.4, yaw: 0, y0: 0.72, y1: 0.78 }, { mat: 'metal', hp: 150, look: '#2f3134', role: 'prop' });
    for (const s of [-1, 1]) K.decor({ cx: x0 - 3, cz: z + s * 0.75, hx: 0.9, hz: 0.15, yaw: 0, y0: 0.42, y1: 0.46 }, '#2f3134', { dep: t });
    K.decor({ cx: x0 - 3, cz: z, hx: 0.05, hz: 0.05, yaw: 0, y0: 0, y1: 0.72 }, '#2f3134', { dep: t });
  }
}

/**
 * The Arend Arts Center's curved, stepped brick front on the entry-court side [SOU]: three concentric
 * brick drums stepping down toward the court, each with a tall glazed slot, around the corner block.
 */
function arendDrums(K) {
  K.setGroup('ext');
  // centred inside the corner block (x 2..18, z 302..334) so the drums bulge out into the court [SOU]
  const cx = 14;
  const cz = 307;
  const drums = [
    { r: 6.5, top: 12.2 },
    { r: 8.8, top: 10.4 },
    { r: 11.1, top: 8.8 },
  ];
  const a0 = Math.PI * 1.0; // west ...
  const a1 = Math.PI * 1.5; // ... round to north (z decreasing is north)
  for (const [k, d] of drums.entries()) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      const p0 = [cx + Math.cos(t0) * d.r, cz + Math.sin(t0) * d.r];
      const p1 = [cx + Math.cos(t1) * d.r, cz + Math.sin(t1) * d.r];
      const slot = i === 3 + k * 2;
      const seg = K.along(p0, p1, 0.4, 0, d.top);
      if (slot) {
        K.decor({ ...seg, y1: 0.9 }, 'brick');
        K.decor({ ...seg, hz: 0.06, y0: 0.9, y1: d.top - 0.8 }, 'glass');
        K.decor({ ...seg, y0: d.top - 0.8 }, 'brick');
      } else K.box(seg, { mat: 'brick', look: 'brick', faces: { top: 'coping' } });
      K.decor({ ...K.along(p0, p1, 0.55, d.top, d.top + 0.15) }, 'coping');
      K.decor({ ...K.along(p0, p1, 0.5, H - 0.25, H + 0.05) }, 'buffBrick');
    }
  }
}

/**
 * The cafeteria (lead): a 2-storey hall with a clerestory, terrazzo with dark bands, round cafe tables
 * with four chairs and long lunch tables with stools around the reboot van [user], a serving line on
 * the kitchen wall, blank navy banners with the emblem on the wood upper walls, pendant lights, loot.
 * Approximate: no photo of this room (the North Building commons photos set the style).
 */
function cafeteria(K) {
  const C = CAFE;
  K.setGroup('int:south:0');
  for (const x of [-15, -1, 13]) K.decor({ cx: x, cz: (C.z0 + C.z1) / 2, hx: 0.6, hz: (C.z1 - C.z0) / 2, yaw: 0, y0: 0.04, y1: 0.044 }, 'terrazzoDark', { faces: { top: 'terrazzoDark', pu: 'none', nu: 'none', pv: 'none', nv: 'none', bottom: 'none' } });
  const clear = (x, z, m) => Math.hypot(x - VAN_SPOT.x, z - VAN_SPOT.z) > VAN_CLEAR + m;
  const rnd = K.rnd;
  let n = 0;
  for (let x = C.x0 + 4.5; x < C.x1 - 2; x += 3.6)
    for (let z = C.z0 + 3; z < C.z1 - 2.5; z += 3.4) {
      if (!clear(x, z, 1.3)) continue;
      const long = (n++ % 3) === 2;
      const jx = x + (rnd() - 0.5) * 0.4;
      const jz = z + (rnd() - 0.5) * 0.4;
      if (long) {
        // a long lunch table with attached stools
        const t = K.box({ cx: jx, cz: jz, hx: 1.2, hz: 0.38, yaw: 0, y0: 0.72, y1: 0.76 }, { mat: 'wood', hp: 120, look: '#d8d3c8', role: 'prop' });
        K.decor({ cx: jx, cz: jz, hx: 1.1, hz: 0.04, yaw: 0, y0: 0, y1: 0.72 }, '#4a4c50', { dep: t });
        for (const sz of [-0.7, 0.7]) for (const sx of [-0.8, 0, 0.8]) K.decor({ cx: jx + sx, cz: jz + sz, hx: 0.17, hz: 0.17, yaw: 0, y0: 0.42, y1: 0.46 }, ['#2b3036', '#7a2e2a', '#b8964a'][(n + (sx > 0 ? 1 : 0)) % 3], { shape: 'cyl', dep: t });
        continue;
      }
      const top = K.box({ cx: jx, cz: jz, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.72, y1: 0.76 }, { mat: 'wood', hp: 120, look: 'none', role: 'prop' });
      K.decor({ cx: jx, cz: jz, hx: 0.6, hz: 0.6, yaw: 0, y0: 0.72, y1: 0.765 }, '#dcd8d0', { shape: 'cyl', dep: top });
      K.decor({ cx: jx, cz: jz, hx: 0.05, hz: 0.05, yaw: 0, y0: 0, y1: 0.72 }, '#2a2a2c', { shape: 'cyl', dep: top });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + rnd() * 0.5;
        const cx = jx + Math.cos(a) * 0.95;
        const cz = jz + Math.sin(a) * 0.95;
        K.decor({ cx, cz, hx: 0.21, hz: 0.21, yaw: a, y0: 0.43, y1: 0.47 }, '#1b1b1d');
        K.decor({ cx: cx + Math.cos(a) * 0.2, cz: cz + Math.sin(a) * 0.2, hx: 0.02, hz: 0.2, yaw: a, y0: 0.6, y1: 0.86 }, '#1b1b1d');
        for (const [lu, lv] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) K.decor({ cx: cx + Math.cos(a) * lu - Math.sin(a) * lv, cz: cz + Math.sin(a) * lu + Math.cos(a) * lv, hx: 0.012, hz: 0.012, yaw: a, y0: 0, y1: 0.43 }, '#9a9ca0');
      }
    }
  // serving line along the kitchen wall (x0): counter, sneeze guard, tray rail
  const sl = K.box({ cx: C.x0 + 1.1, cz: (C.z0 + C.z1) / 2, hx: 0.45, hz: 9, yaw: 0, y0: 0, y1: 0.92 }, { mat: 'metal', hp: 300, look: '#b9bcbe', role: 'prop' });
  K.decor({ cx: C.x0 + 1.0, cz: (C.z0 + C.z1) / 2, hx: 0.25, hz: 9, yaw: 0, y0: 1.25, y1: 1.28 }, 'glass', { dep: sl });
  K.decor({ cx: C.x0 + 1.65, cz: (C.z0 + C.z1) / 2, hx: 0.12, hz: 9, yaw: 0, y0: 0.82, y1: 0.86 }, '#8d9196', { dep: sl });
  // banners on the wood upper walls (blank navy, gold emblem disc)
  K.setGroup('int:south:1');
  for (let i = 0; i < 5; i++) {
    const x = C.x0 + 5 + i * 7.5;
    K.decor({ cx: x, cz: C.z1 - 0.16, hx: 0.85, hz: 0.04, yaw: 0, y0: H + 1.2, y1: H + 4.4 }, 'banner');
    K.decor({ cx: x, cz: C.z1 - 0.21, hx: 0.5, hz: 0.01, yaw: 0, y0: H + 3.0, y1: H + 4.0 }, 'emblem', { faces: { nv: 'emblem', pv: 'none', pu: 'none', nu: 'none', top: 'none', bottom: 'none' } });
  }
  for (const x of [C.x0 + 8, (C.x0 + C.x1) / 2, C.x1 - 8])
    for (const z of [C.z0 + 9, C.z1 - 9]) {
      K.decor({ cx: x, cz: z, hx: 0.5, hz: 0.5, yaw: 0, y0: C.top - 3.2, y1: C.top - 3.05 }, 'fixture', { shape: 'cyl' });
      K.decor({ cx: x, cz: z, hx: 0.01, hz: 0.01, yaw: 0, y0: C.top - 3.05, y1: C.top - 0.5 }, 'picket');
    }
  K.light({ x: (C.x0 + C.x1) / 2, y: 6, z: (C.z0 + C.z1) / 2, range: 26, intensity: 1.0 });
  // loot: one chest by the serving line, ammo near the van
  K.loot({ kind: 'chest', x: C.x0 + 2.2, z: C.z0 + 1.2, y: 0 });
  K.loot({ kind: 'ammoBox', x: VAN_SPOT.x + VAN_CLEAR + 1.5, z: VAN_SPOT.z, y: 0 });
}

function roofUnits(K) {
  K.setGroup('ext');
  for (const [x, z, y] of [[-100, 330, ROOF], [-106, 360, ROOF], [-30, 320, ROOF], [-30, 350, ROOF], [0, 390, ROOF], [25, 390, ROOF], [70, 350, ROOF], [104, 360, ROOF], [-75, 340, ARENA.top], [-60, 330, ARENA.top], [-80, 385, AUX_GYM.top], [60, 405, LIBRARY.top], [80, 415, LIBRARY.top]]) {
    K.box({ cx: x, cz: z, hx: 1.6, hz: 1.1, yaw: 0, y0: y, y1: y + 1.4 }, { mat: 'metal', look: 'metalGrey', faces: { top: 'alu' } });
    K.decor({ cx: x + 0.4, cz: z, hx: 0.45, hz: 0.45, yaw: 0, y0: y + 1.4, y1: y + 1.6 }, '#3a3d40', { shape: 'cyl' });
  }
  // the gym roof's barrel skylight hump [3DF, L3D]
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    K.decor({ cx: -69 + Math.cos(a) * 4, cz: 341, hx: 0.55, hz: 7, yaw: 0, y0: ARENA.top, y1: ARENA.top + 0.2 + Math.sin(a) * 1.6 }, i % 2 ? 'roof' : 'metalWhite');
  }
}

export function buildSouth(K, heroes = {}) {
  const plan = buildPlan(K, {
    name: 'south',
    outline: SOUTH_OUTLINE,
    storeys: 2,
    h: H,
    parapet: 0.9,
    wallLook: 'brick',
    parapetLook: 'buffBrick',
    facade,
    rooms: rooms(),
    raised: [
      { ...ARENA, look: 'brick', lookIn: 'blockGrey', parapetLook: 'buffBrick', windows: (e, y) => (Math.abs(e.a[0] - e.b[0]) > 20 && Math.max(e.a[1], e.b[1]) < 340 ? [{ u0: 4, u1: e.L - 4, y0: ARENA.top - 2.4, y1: ARENA.top - 0.6, type: 'glass', bay: 2.5, rows: 1 }].map((o) => ({ ...o, y0: o.y0, y1: o.y1 })) : []) },
      { ...AUX_GYM, look: 'brick', lookIn: 'blockGrey', parapetLook: 'buffBrick' },
      { ...CAFE, look: 'buffBrick', lookIn: 'wood', windows: (e) => [{ u0: 1, u1: e.L - 1, y0: ROOF + 0.5, y1: CAFE.top - 0.5, type: 'glass', bay: 1.8, rows: 1 }] },
      { ...AREND_HOUSE, look: 'brick', lookIn: 'acoustic', parapetLook: 'buffBrick' },
      // the fly tower starts at z 294.6: west of x 91 the outline's north edge is there, so a tower wall at
      // z 292.2 would stand over open air
      { ...AREND_STAGE, z0: 294.6, look: 'buffBrick', lookIn: 'blockGrey' },
      { ...LIBRARY, look: 'brick', lookIn: 'libWall', parapetLook: 'buffBrick', windows: (e) => (Math.abs(e.a[1] - e.b[1]) < 1 ? [] : [{ u0: 3, u1: e.L - 3, y0: ROOF + 0.4, y1: LIBRARY.top - 0.4, type: 'glass', bay: 2.2, rows: 1 }]) },
    ],
    voids: [{ level: 1, ...CAFE }, { level: 1, ...AREND_LOBBY }],
    stairHalls: [
      { x0: -40, x1: -34, z0: 360, z1: 372, from: 'z1', levels: [0] },
      { x0: 88, x1: 94, z0: 362, z1: 372, from: 'z1', levels: [0] },
      { x0: -108, x1: -102, z0: 380, z1: 392, from: 'z0', levels: [0] },
    ],
  });
  bands(K);
  entryCourt(K);
  arendDrums(K);
  cafeteria(K);
  walkway(K);
  roofUnits(K);
  // hero interiors (subagents): each gets the kit, its rects and the plan
  const ctx = { plan, H, ROOF, ARENA, AUX_GYM, CAFE, AREND_LOBBY, AREND_HOUSE, AREND_STAGE, LIBRARY };
  if (heroes.gym) heroes.gym(K, ctx);
  if (heroes.library) heroes.library(K, ctx);
  if (heroes.arend) heroes.arend(K, ctx);
  return plan;
}
