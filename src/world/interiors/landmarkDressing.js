// BENTONVILLE ROYALE — landmark set dressing (pure data, deterministic, no three.js).
//
// LANDMARK_DRESSING: building id -> [directive, ...], interpreted by furnishings.js before the room
// kind's kit fills the remaining space. Directive shape (see the interior contract):
//   { room: 'Exact room label', level?: n, place: 'grid'|'walls'|'centre'|'at'|'wall_mount'|'hang'|'reserve', kind, ...opts }
//   grid { aisle, margin, face, max, w, d } · walls { sides, gap, max } · centre { w, d, face }
//   at { fa, fb (0..1 item-centre fractions of the room rect), face, w, d } · wall_mount { sides, gap, max }
//   hang { kind: painting|painting_large|mixed, sides, spacing, centre, clear, label, styles, max } (no catalog kind)
//   reserve { spine (m, default 3), kit: false } — room rules applied before every other directive
// Conventions used below: `face` is the direction the item's FRONT looks (seats and desks face the
// stage/board they look at; a stage/bench faces its audience). `w` runs along the item's front
// (perpendicular to `face`), `d` along `face`. Sides: a0/a1 = walls at the low/high a edge,
// b0/b1 = low/high b edge. Fractions were picked from the nominal cut positions in landmarks.js.
//
// Every layout below is a game APPROXIMATION inspired by the public descriptions already cited per
// recipe in landmarks.js (no new facts are claimed and none of it is a real floor plan). Labels must
// match landmarks.js exactly; a label that does not exist (or a footprint that fell back to its
// generic archetype) is ignored by the interpreter. Directives never override the safety
// reservations (door lanes, loot spots, stairs, footprint containment), so any piece that would
// collide with them is simply skipped.

import { bhsDressing } from './bhs.js';

const r3 = (x) => Math.round(x * 1000) / 1000;
const OPP = { a0: 'a+', a1: 'a-', b0: 'b+', b1: 'b-' };
const TOWARD = { a0: 'a-', a1: 'a+', b0: 'b-', b1: 'b+' };

/** One directive; `level` is only attached when given. */
function d(room, place, kind, opts, level) {
  const o = { room, place, kind, ...(opts || {}) };
  if (level !== undefined) o.level = level;
  return o;
}

/** Fractional position `metres` in from `side` along a room `depth` deep (centre fraction). */
function inFrom(side, metres, depth) {
  const f = r3(Math.min(0.45, metres / depth));
  return side === 'a0' || side === 'b0' ? f : r3(1 - f);
}

/**
 * Classroom: whiteboard on the `board` wall, teacher desk 2 m off it, student desks (or lab benches)
 * in a grid all facing the board. `depth` = room size across the board wall (metres).
 */
function classroom(room, board, depth, { desks = 24, lab = false, level } = {}) {
  const along = board[0] === 'a';
  const f = inFrom(board, 2.2, depth);
  const out = [
    d(room, 'wall_mount', 'whiteboard', { sides: [board], max: 1 }, level),
    d(room, 'at', 'teacher_desk', along ? { fa: f, fb: 0.5, face: OPP[board] } : { fa: 0.5, fb: f, face: OPP[board] }, level),
  ];
  if (lab) out.push(d(room, 'grid', 'workbench', { face: TOWARD[board], aisle: 1.4, margin: 1.4, max: Math.min(8, desks) }, level));
  else out.push(d(room, 'grid', 'school_desk', { face: TOWARD[board], aisle: 1.2, margin: 1.4, max: desks }, level));
  out.push(d(room, 'wall_mount', 'painting', { sides: [along ? (board === 'a0' ? 'a1' : 'a0') : board === 'b0' ? 'b1' : 'b0'], max: 2, gap: 3 }, level));
  return out;
}

/** White-box gallery: large canvases on every wall, smaller works between, plinth grid, centre benches. */
function gallery(room, { plinths = 8, installation = null, benches = true, level } = {}) {
  const out = [];
  if (installation) out.push(d(room, 'centre', 'installation', installation, level));
  out.push(d(room, 'wall_mount', 'painting_large', { sides: ['a0', 'a1', 'b0', 'b1'], gap: 4, max: 14 }, level));
  out.push(d(room, 'wall_mount', 'painting', { sides: ['a0', 'a1', 'b0', 'b1'], gap: 2, max: 16 }, level));
  if (benches) {
    out.push(d(room, 'at', 'gallery_bench', { fa: 0.5, fb: 0.4, face: 'b-' }, level));
    out.push(d(room, 'at', 'gallery_bench', { fa: 0.5, fb: 0.6, face: 'b+' }, level));
  }
  if (plinths) out.push(d(room, 'grid', 'plinth', { aisle: 6, margin: 5, max: plinths }, level));
  return out;
}

/** Courtroom: judge's bench at the far (b1) end, witness stand, jury box on the a1 side, the bar
 * railing with a central gate, counsel tables, and two banks of pews split by a centre aisle. */
function courtroom(room, { rows = 6, level } = {}) {
  const out = [
    d(room, 'at', 'judge_bench', { fa: 0.5, fb: 0.92, face: 'b-' }, level),
    d(room, 'at', 'witness_stand', { fa: 0.22, fb: 0.86, face: 'b-' }, level),
    d(room, 'at', 'jury_box', { fa: 0.84, fb: 0.7, face: 'a-' }, level),
    d(room, 'at', 'desk', { fa: 0.3, fb: 0.6, face: 'b+' }, level),
    d(room, 'at', 'desk', { fa: 0.7, fb: 0.6, face: 'b+' }, level),
    d(room, 'wall_mount', 'painting', { sides: ['b1'], max: 2, gap: 4 }, level),
  ];
  for (const fa of rows > 2 ? [0.1, 0.3, 0.7, 0.9] : [0.25, 0.75]) out.push(d(room, 'at', 'railing', { fa, fb: 0.5, face: 'b+' }, level));
  for (let i = 0; i < rows; i++) {
    const fb = r3(0.08 + i * (0.36 / Math.max(1, rows - 1)));
    out.push(d(room, 'at', 'pew', { fa: rows > 2 ? 0.3 : 0.27, fb, face: 'b+' }, level));
    out.push(d(room, 'at', 'pew', { fa: rows > 2 ? 0.7 : 0.73, fb, face: 'b+' }, level));
  }
  return out;
}

/** Gym: court lines centred (long axis along a), hoops at the court ends, bleachers on the long walls. */
function gym(room, roomLen, { court = [16, 28], bleachers = 8, level } = {}) {
  const half = court[1] / 2 / roomLen;
  return [
    d(room, 'centre', 'court_lines', { w: court[0], d: court[1], face: 'a+' }, level),
    d(room, 'at', 'hoop', { fa: r3(0.5 - half), fb: 0.5, face: 'a+' }, level),
    d(room, 'at', 'hoop', { fa: r3(0.5 + half), fb: 0.5, face: 'a-' }, level),
    d(room, 'walls', 'bleachers', { sides: ['b0', 'b1'], gap: 0.6, max: bleachers }, level),
    d(room, 'wall_mount', 'tv', { sides: ['a0', 'a1'], max: 2, gap: 6 }, level),
  ];
}

/** Auditorium: stage against `stageSide`, podium in front of it, seat rows filling the house facing it. */
function auditorium(room, stageSide, { w, dd = 6, seats = 40, level } = {}) {
  const along = stageSide[0] === 'a';
  const fs = stageSide === 'a0' || stageSide === 'b0' ? 0.08 : 0.92;
  const fp = stageSide === 'a0' || stageSide === 'b0' ? 0.2 : 0.8;
  const face = OPP[stageSide];
  return [
    d(room, 'at', 'stage', along ? { fa: fs, fb: 0.5, face, w, d: dd } : { fa: 0.5, fb: fs, face, w, d: dd }, level),
    d(room, 'at', 'podium', along ? { fa: fp, fb: 0.5, face } : { fa: 0.5, fb: fp, face }, level),
    d(room, 'grid', 'seat_row', { face: TOWARD[stageSide], aisle: 1.2, margin: 1.6, max: seats }, level),
  ];
}

/** Office floor: desks + chairs in a grid, filing cabinets and bookcases on the walls. */
function offices(room, { desks = 12, level } = {}) {
  return [
    d(room, 'grid', 'desk', { face: 'b-', aisle: 1.6, margin: 1.2, max: desks }, level),
    d(room, 'walls', 'filing_cabinet', { gap: 0.4, max: 6 }, level),
    d(room, 'walls', 'bookcase', { gap: 0.6, max: 3 }, level),
    d(room, 'walls', 'plant', { max: 2 }, level),
  ];
}

/** Meeting room: conference tables end to end down the room's long axis (`len` x `wid` metres along
 * a x b), screen and whiteboard on the two end walls that axis points at. */
function meeting(room, { tables = 2, len = 20, wid = 14, level } = {}) {
  const alongA = len >= wid;
  const long = alongA ? len : wid;
  const out = [];
  for (let i = 0; i < tables; i++) {
    const f = r3(0.5 + (i - (tables - 1) / 2) * (3.1 / long));
    // A long_table's 3 m `w` runs perpendicular to `face`, so face across the long axis.
    out.push(d(room, 'at', 'long_table', alongA ? { fa: f, fb: 0.5, face: 'b+' } : { fa: 0.5, fb: f, face: 'a+' }, level));
  }
  out.push(d(room, 'wall_mount', 'tv', { sides: [alongA ? 'a0' : 'b0'], max: 1 }, level));
  out.push(d(room, 'wall_mount', 'whiteboard', { sides: [alongA ? 'a1' : 'b1'], max: 1 }, level));
  out.push(d(room, 'walls', 'plant', { max: 2 }, level));
  return out;
}

/** Commercial kitchen: ranges and counters on the walls, fridges, a prep island if it fits. */
function kitchen(room, { islands = 2, level } = {}) {
  const out = [
    d(room, 'walls', 'stove', { gap: 0.1, max: 4 }, level),
    d(room, 'walls', 'counter', { gap: 0.1, max: 6 }, level),
    d(room, 'walls', 'fridge', { gap: 0.2, max: 3 }, level),
    d(room, 'walls', 'sink', { max: 2 }, level),
    d(room, 'wall_mount', 'cabinet_upper', { gap: 0.4, max: 4 }, level),
  ];
  if (islands > 0) out.push(d(room, 'grid', 'kitchen_island', { aisle: 1.6, margin: 2, max: islands }, level));
  return out;
}

/** Food-hall stall: kitchen line along the back, service counter, menu board over it. */
function foodStall(room, level) {
  return [
    d(room, 'walls', 'food_stall', { gap: 0.4, max: 2 }, level),
    d(room, 'walls', 'counter', { gap: 0.2, max: 2 }, level),
    d(room, 'wall_mount', 'menu_board', { gap: 1, max: 2 }, level),
  ];
}

/** Café: service counter + pastry case 1.4 m off the `back` wall (barista lane behind), menu
 * boards over it, table grid. `depth` = room size across the back wall (metres). */
function cafe(room, back, depth, { tables = 12, level } = {}) {
  const along = back[0] === 'a';
  const f = inFrom(back, 1.4, depth);
  const face = OPP[back];
  const at = (fx) => (along ? { fa: f, fb: fx, face } : { fa: fx, fb: f, face });
  return [
    d(room, 'at', 'counter', at(0.5), level),
    d(room, 'at', 'display_case', at(0.25), level),
    d(room, 'wall_mount', 'menu_board', { sides: [back], max: 2, gap: 1 }, level),
    d(room, 'grid', 'cafe_table', { aisle: 1.4, margin: 1.2, max: tables }, level),
    d(room, 'walls', 'plant', { max: 3 }, level),
    d(room, 'wall_mount', 'painting', { gap: 2.5, max: 4 }, level),
  ];
}

/** Locker-lined school corridor. */
function lockers(room, sides, max, level) {
  return [d(room, 'walls', 'locker_bank', { sides, gap: 0.2, max }, level)];
}

/** Library stacks: circulation desk, reading tables down the middle, bookcase grid, wall shelving. */
function library(room, { stacks = 24, tables = 3, level } = {}) {
  const out = [d(room, 'at', 'reception_desk', { fa: 0.5, fb: 0.12, face: 'b-' }, level)];
  for (let i = 0; i < tables; i++) out.push(d(room, 'at', 'long_table', { fa: r3(0.3 + (0.4 * i) / Math.max(1, tables - 1)), fb: 0.32, face: 'b+' }, level));
  out.push(d(room, 'walls', 'bookcase', { gap: 0.2, max: 16 }, level));
  out.push(d(room, 'grid', 'bookcase', { face: 'b-', aisle: 2, margin: 2.5, max: stacks }, level));
  out.push(d(room, 'walls', 'armchair', { max: 4 }, level));
  return out;
}

/** School cafeteria: serving line on the kitchen wall, long tables in a grid. */
function cafeteria(room, servingSide, { tables = 24, level } = {}) {
  return [
    d(room, 'walls', 'serving_line', { sides: [servingSide], gap: 0.6, max: 4 }, level),
    d(room, 'wall_mount', 'menu_board', { sides: [servingSide], max: 2, gap: 2 }, level),
    d(room, 'grid', 'long_table', { face: 'b+', aisle: 1.6, margin: 2, max: tables }, level),
    d(room, 'walls', 'plant', { max: 2 }, level),
  ];
}

/** Lobby: front desk set back from the `entrance` wall and facing it, benches, planters, art. */
function lobby(room, { desk = true, entrance = 'b0', level } = {}) {
  const out = [];
  const f = entrance === 'a0' || entrance === 'b0' ? 0.6 : 0.4;
  if (desk) out.push(d(room, 'at', 'reception_desk', entrance[0] === 'a' ? { fa: f, fb: 0.5, face: TOWARD[entrance] } : { fa: 0.5, fb: f, face: TOWARD[entrance] }, level));
  out.push(d(room, 'walls', 'bench', { gap: 1.5, max: 4 }, level));
  out.push(d(room, 'walls', 'planter', { gap: 2, max: 4 }, level));
  out.push(d(room, 'wall_mount', 'painting', { gap: 3, max: 4 }, level));
  return out;
}

/** Storage: pallet racks in rows, crates along the walls. */
function storage(room, { racks = 8, crates = 6, level } = {}) {
  return [
    d(room, 'grid', 'pallet_rack', { face: 'b+', aisle: 2.4, margin: 1.4, max: racks }, level),
    d(room, 'walls', 'crate', { gap: 0.3, max: crates }, level),
  ];
}

/** Break room / staff kitchen: counter run and fridge, tables, a TV. */
function breakRoom(room, { tables = 4, level } = {}) {
  return [
    d(room, 'walls', 'counter', { gap: 0.1, max: 3 }, level),
    d(room, 'walls', 'fridge', { max: 1 }, level),
    d(room, 'wall_mount', 'cabinet_upper', { gap: 0.3, max: 3 }, level),
    d(room, 'grid', 'dining_table', { aisle: 1.6, margin: 1.6, max: tables }, level),
    d(room, 'wall_mount', 'tv', { max: 1 }, level),
  ];
}

/** Lounge: sofas on the walls, armchairs and coffee tables, a rug and a screen. */
function lounge(room, level) {
  return [
    d(room, 'centre', 'rug', { w: 5, d: 4, face: 'b+' }, level),
    d(room, 'at', 'coffee_table', { fa: 0.5, fb: 0.5, face: 'b+' }, level),
    d(room, 'walls', 'sofa', { gap: 1, max: 4 }, level),
    d(room, 'walls', 'armchair', { gap: 0.6, max: 4 }, level),
    d(room, 'wall_mount', 'tv', { max: 1 }, level),
    d(room, 'walls', 'plant', { max: 3 }, level),
  ];
}

/** Room rules: keep a clear walking spine `spine` m wide on the long axis; kit: false skips the room kit. */
function reserve(room, { spine = 3, kit, level } = {}) {
  const o = { room, place: 'reserve', spine };
  if (kit === false) o.kit = false;
  if (level !== undefined) o.level = level;
  return o;
}

/** Evenly hung framed works with label cards (see 'hang' in the interior contract addendum v2). */
function hang(room, opts, level) {
  const o = { room, place: 'hang', ...(opts || {}) };
  if (level !== undefined) o.level = level;
  return o;
}

/**
 * Gallery in the owner's AskRosie tour language: mixed works hung on every wall ~3.6 m apart with
 * labels, a 3 m clear spine on the long axis, two pairs of benches either side of the spine facing
 * the long walls (the walls with the most art), and at most a few plinths / one installation out in
 * the side thirds. The room kit is skipped so nothing else lands in the spine or on the walls.
 * Bench and plinth fractions assume the long axis runs along b (true for every Crystal Bridges gallery).
 */
function askRosieGallery(room, { plinths = [], installation = null, benches = [0.47, 0.53], level } = {}) {
  const out = [reserve(room, { kit: false, level }), hang(room, { kind: 'mixed', spacing: 3.6 }, level)];
  for (const [fa, face] of [[0.3, 'a-'], [0.7, 'a+']]) {
    for (const fb of benches) out.push(d(room, 'at', 'gallery_bench', { fa, fb, face }, level));
  }
  if (installation) out.push(d(room, 'at', 'installation', installation, level));
  for (const [fa, fb] of plinths.slice(0, 4)) out.push(d(room, 'at', 'plinth', { fa, fb, face: 'b+' }, level));
  return out;
}

/**
 * Art-free pause (AskRosie Bridge Gallery): no hung works, only benches and planters along the
 * walls, plus free-standing bench pairs / planters at `spots` ([fa, fb, kind, face]) off the spine
 * where the real footprint has floor that the rectangular room's walls do not reach.
 */
function artFreePause(room, { spots = [], level } = {}) {
  return [
    reserve(room, { kit: false, level }),
    d(room, 'walls', 'gallery_bench', { sides: ['a0', 'a1'], gap: 9, max: 10 }, level),
    d(room, 'walls', 'planter', { gap: 7, max: 14 }, level),
    ...spots.map(([fa, fb, kind, face]) => d(room, 'at', kind, { fa, fb, face }, level)),
  ];
}

// Bridge pavilion floor (fractions of the Bridge Gallery rect checked against the real map footprint).
const BRIDGE_SPOTS = [
  [0.3, 0.3, 'gallery_bench', 'a-'], [0.3, 0.33, 'gallery_bench', 'a-'],
  [0.7, 0.7, 'gallery_bench', 'a+'], [0.7, 0.73, 'gallery_bench', 'a+'],
  [0.2, 0.7, 'planter', 'a+'], [0.8, 0.75, 'planter', 'a-'], [0.15, 0.3, 'planter', 'a+'],
];

const range = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);
const pad2 = (i) => String(i).padStart(2, '0');

// ------------------------------------------------------------------ the 16 landmarks

export const LANDMARK_DRESSING = {
  // Crystal Bridges Museum of American Art — the flagship. Approximation from the descriptions
  // cited in landmarks.js (crystalbridges.org, Wikipedia, arkansas.com), not the real floor plan.
  // The gallery treatment follows the owner's own AskRosie 3D virtual tour design language
  // (evenly hung framed works at eye level with label cards, a clear central spine, paired benches,
  // an art-free Bridge Gallery pause) with ORIGINAL procedurally generated art only: no artwork
  // images, titles or artist names are copied from that project or from crystalbridges.org.
  // Circulation (Main Lobby, Great Hall, Gallery Walk, Upper Walkway) keeps a 3 m walking spine;
  // the upper storeys hold offices, storage, labs and the art-free Bridge Gallery Upper.
  8240824: [
    ...askRosieGallery('Early 20th Century Art', { plinths: [[0.15, 0.25], [0.85, 0.75]] }),
    ...askRosieGallery('19th Century Art', { plinths: [[0.15, 0.75], [0.85, 0.25]] }),
    ...askRosieGallery('Early American Art', { plinths: [[0.15, 0.25], [0.85, 0.75]] }),
    // Modern Art: the real footprint clips its low-a / low-b corner, so benches, installation and
    // plinths sit where the floor actually is (fractions checked against the real map).
    ...askRosieGallery('Modern Art', { installation: { fa: 0.78, fb: 0.3, w: 6, d: 6, face: 'a-' }, plinths: [[0.85, 0.75], [0.15, 0.66]], benches: [0.6, 0.66] }),
    ...askRosieGallery('Contemporary Art', { installation: { fa: 0.8, fb: 0.72, w: 8, d: 6, face: 'a-' }, plinths: [[0.15, 0.25]] }),
    ...askRosieGallery('Temporary Exhibitions', { plinths: [[0.15, 0.25], [0.85, 0.25], [0.15, 0.75], [0.85, 0.75]] }),
    ...artFreePause('Bridge Gallery', { spots: BRIDGE_SPOTS }),
    ...artFreePause('Bridge Gallery Upper', { spots: BRIDGE_SPOTS }),
    ...library('Library', { stacks: 28, tables: 3, level: 0 }),
    // Main Lobby / Great Hall: authored layout only (kit: false), 3 m walking spine kept clear.
    reserve('Main Lobby', { kit: false }),
    d('Main Lobby', 'at', 'reception_desk', { fa: 0.8, fb: 0.85, face: 'b-' }),
    d('Main Lobby', 'at', 'installation', { fa: 0.22, fb: 0.78, w: 5, d: 5, face: 'a+' }),
    d('Main Lobby', 'walls', 'bench', { gap: 1.5, max: 4 }),
    d('Main Lobby', 'walls', 'planter', { gap: 2, max: 4 }),
    d('Main Lobby', 'wall_mount', 'painting', { gap: 3, max: 4 }),
    d('Main Lobby', 'at', 'gallery_bench', { fa: 0.25, fb: 0.4, face: 'a-' }),
    d('Main Lobby', 'at', 'gallery_bench', { fa: 0.75, fb: 0.6, face: 'a+' }),
    d('Main Lobby', 'walls', 'plant', { max: 4 }),
    d('Museum Store', 'at', 'checkout', { fa: 0.5, fb: 0.1, face: 'b+' }),
    d('Museum Store', 'grid', 'shelf', { face: 'b-', aisle: 1.6, margin: 1.4, max: 12 }),
    d('Museum Store', 'walls', 'display_case', { gap: 0.6, max: 6 }),
    d('Museum Store', 'wall_mount', 'painting', { gap: 2, max: 4 }),
    reserve('Gallery Walk', { kit: false }),
    hang('Gallery Walk', { kind: 'painting', sides: ['b0', 'b1'], spacing: 6 }),
    d('Gallery Walk', 'walls', 'gallery_bench', { sides: ['b0', 'b1'], gap: 12, max: 8 }),
    d('Gallery Walk', 'walls', 'planter', { sides: ['b0', 'b1'], gap: 14, max: 10 }),
    ...classroom('Studio Classroom', 'b0', 25, { desks: 0 }).slice(0, 2),
    d('Studio Classroom', 'grid', 'easel', { face: 'b-', aisle: 1.4, margin: 2, max: 16 }),
    d('Studio Classroom', 'walls', 'workbench', { sides: ['a0', 'a1'], gap: 0.6, max: 4 }),
    ...lobby('Guest Services', { entrance: 'b0' }),
    ...meeting('Meeting Room', { tables: 3, len: 23, wid: 33.1 }),
    ...cafe('Coffee Bar', 'b1', 24, { tables: 14 }),
    d('Eleven', 'at', 'bar_counter', { fa: 0.5, fb: 0.9, face: 'b-' }),
    d('Eleven', 'grid', 'dining_table', { aisle: 1.4, margin: 1.6, max: 16 }),
    d('Eleven', 'wall_mount', 'painting', { gap: 3, max: 6 }),
    d('Eleven', 'walls', 'plant', { max: 4 }),
    // Great Hall: the stage stands beside the 3 m spine (not across it), where the real glass
    // pavilion's footprint is widest, facing the banquet floor.
    reserve('Great Hall', { kit: false }),
    d('Great Hall', 'at', 'stage', { fa: 0.75, fb: 0.25, w: 14, d: 6, face: 'a-' }),
    d('Great Hall', 'at', 'podium', { fa: 0.66, fb: 0.25, face: 'a-' }),
    d('Great Hall', 'at', 'bar_counter', { fa: 0.07, fb: 0.4, face: 'a+' }),
    d('Great Hall', 'at', 'bar_counter', { fa: 0.07, fb: 0.6, face: 'a+' }),
    d('Great Hall', 'grid', 'banquet_table', { aisle: 2.2, margin: 4, max: 32 }),
    d('Great Hall', 'walls', 'planter', { gap: 6, max: 8 }),
    // Upper storeys (levels 1 and 2 of 3).
    ...library('Library Reading Room', { stacks: 16, tables: 4, level: 1 }),
    d('Archives', 'grid', 'bookcase', { face: 'b-', aisle: 1.6, margin: 2, max: 20 }, 2),
    d('Archives', 'walls', 'filing_cabinet', { gap: 0.2, max: 8 }, 2),
    d('Archives', 'at', 'long_table', { fa: 0.5, fb: 0.15, face: 'b+' }, 2),
    ...offices('Curatorial Offices', { desks: 16, level: 1 }),
    ...offices('Administration', { desks: 16, level: 2 }),
    ...storage('Collection Storage', { racks: 8, crates: 4 }),
    d('Lobby Balcony', 'walls', 'gallery_bench', { gap: 4, max: 6 }),
    d('Lobby Balcony', 'walls', 'planter', { gap: 6, max: 4 }),
    reserve('Upper Walkway', { kit: false }),
    hang('Upper Walkway', { kind: 'painting', sides: ['b0', 'b1'], spacing: 8 }),
    d('Upper Walkway', 'walls', 'planter', { sides: ['b0', 'b1'], gap: 16, max: 8 }),
    d('Conservation Lab', 'grid', 'workbench', { face: 'b-', aisle: 2, margin: 2, max: 12 }, 1),
    d('Conservation Lab', 'walls', 'easel', { gap: 1.2, max: 8 }, 1),
    d('Conservation Lab', 'walls', 'bookcase', { gap: 0.6, max: 4 }, 1),
    d('Photo Studio', 'centre', 'rug', { w: 8, d: 6, face: 'b-' }, 2),
    d('Photo Studio', 'walls', 'easel', { gap: 2, max: 6 }, 2),
    d('Photo Studio', 'walls', 'workbench', { gap: 1, max: 4 }, 2),
    d('Art Handling', 'grid', 'crate', { aisle: 2, margin: 2, max: 10 }, 1),
    d('Art Handling', 'walls', 'workbench', { gap: 1, max: 4 }, 1),
    ...storage('Crate Storage', { racks: 8, crates: 4, level: 2 }),
    ...offices('Education Offices', { desks: 14, level: 1 }),
    ...offices('Event Offices', { desks: 14, level: 2 }),
    ...classroom('Seminar Room', 'a0', 46, { desks: 30, level: 1 }),
    ...meeting('Board Room', { tables: 4, len: 46, wid: 58.1, level: 2 }),
    ...lounge('Staff Lounge', 1),
    ...breakRoom('Staff Kitchen', { tables: 6, level: 2 }),
    d('Great Hall Balcony', 'walls', 'gallery_bench', { sides: ['a0', 'a1'], gap: 6, max: 8 }),
    d('Great Hall Balcony', 'walls', 'railing', { sides: ['b1'], gap: 0.2, max: 12 }),
  ],

  // The Momentary — white-box galleries with large installations, the Fermentation Hall black box
  // and RØDE House performance space (stage + seat rows), Tower Bar with taps, Onyx café, The
  // Breakroom canteen. Approximation from themomentary.org / talkbusiness / archpaper (landmarks.js).
  896842916: [
    ...lobby('Lobby', { entrance: 'a0' }),
    d('Lobby', 'centre', 'installation', { w: 6, d: 6, face: 'a-' }),
    d('Box Office', 'at', 'reception_desk', { fa: 0.6, fb: 0.5, face: 'a-' }),
    d('Box Office', 'walls', 'bench', { gap: 2, max: 4 }),
    d('Box Office', 'wall_mount', 'tv', { gap: 3, max: 2 }),
    ...gallery('Gallery 4', { plinths: 6, installation: { w: 10, d: 7, face: 'b+' } }),
    ...gallery('Gallery 3', { plinths: 6, installation: { w: 8, d: 6, face: 'b+' } }),
    ...gallery('Gallery 2', { plinths: 4, installation: { w: 6, d: 6, face: 'b+' } }),
    ...gallery('Gallery 1', { plinths: 4, installation: { w: 6, d: 5, face: 'b-' } }),
    ...storage('Loading Dock', { racks: 6, crates: 10 }),
    d('Gallery Corridor', 'wall_mount', 'painting_large', { sides: ['b0', 'b1'], gap: 8, max: 10 }),
    d('Gallery Corridor', 'walls', 'gallery_bench', { sides: ['b0', 'b1'], gap: 10, max: 6 }),
    ...auditorium('Fermentation Hall', 'b1', { w: 12, dd: 5, seats: 14 }),
    ...auditorium('RØDE House', 'b1', { w: 14, dd: 6, seats: 18 }),
    d('RØDE House', 'at', 'bar_counter', { fa: 0.5, fb: 0.05, face: 'b+' }),
    d('The Breakroom', 'at', 'bar_counter', { fa: 0.5, fb: 0.9, face: 'b-' }),
    d('The Breakroom', 'wall_mount', 'menu_board', { sides: ['b1'], max: 2, gap: 2 }),
    d('The Breakroom', 'grid', 'dining_table', { aisle: 1.4, margin: 1.6, max: 12 }),
    d('Tower Bar', 'at', 'bar_counter', { fa: 0.4, fb: 0.88, face: 'b-' }),
    d('Tower Bar', 'at', 'bar_counter', { fa: 0.6, fb: 0.88, face: 'b-' }),
    d('Tower Bar', 'wall_mount', 'tap_board', { sides: ['b1'], max: 2, gap: 1 }),
    d('Tower Bar', 'grid', 'high_top', { aisle: 1.4, margin: 1.4, max: 10 }),
    ...cafe('Onyx Coffee Lab', 'b1', 21.4, { tables: 10 }),
  ],

  // 8th Street Market — street-front shops (outfitter shelves, bookshop cases, chocolate counters),
  // two food stalls, the long-table Market Hall, Brightwater teaching kitchens and classroom, an
  // event hall and HomeGrown's dining room. Approximation from downtownbentonville.org et al.
  896842909: [
    d('Hillfolk', 'grid', 'shelf', { face: 'b-', aisle: 1.4, margin: 1.4, max: 6 }),
    d('Hillfolk', 'at', 'checkout', { fa: 0.8, fb: 0.2, face: 'b+' }),
    d('Hillfolk', 'walls', 'display_case', { max: 3 }),
    d('Two Friends Books', 'walls', 'bookcase', { gap: 0.1, max: 10 }),
    d('Two Friends Books', 'grid', 'bookcase', { face: 'a+', aisle: 1.4, margin: 1.4, max: 4 }),
    d('Two Friends Books', 'at', 'checkout', { fa: 0.5, fb: 0.2, face: 'b+' }),
    d('Markham & Fitz', 'at', 'counter', { fa: 0.5, fb: 0.8, face: 'b-' }),
    d('Markham & Fitz', 'grid', 'display_case', { aisle: 1.4, margin: 1.6, max: 4 }),
    d('Markham & Fitz', 'wall_mount', 'menu_board', { sides: ['b1'], max: 1 }),
    d('Markham & Fitz', 'grid', 'cafe_table', { aisle: 1.4, margin: 1.2, max: 3 }),
    ...foodStall("Yeyo's El Alma de Mexico"),
    d("Yeyo's El Alma de Mexico", 'grid', 'cafe_table', { aisle: 1.4, margin: 1.4, max: 6 }),
    ...foodStall('Co-Op Ramen'),
    d('Co-Op Ramen', 'at', 'bar_counter', { fa: 0.5, fb: 0.45, face: 'b-' }),
    d('Co-Op Ramen', 'grid', 'stool', { aisle: 0.8, margin: 1.4, max: 8, face: 'b+' }),
    d('Market Hall', 'grid', 'long_table', { face: 'b+', aisle: 2, margin: 2.4, max: 24 }),
    d('Market Hall', 'walls', 'planter', { gap: 8, max: 8 }),
    d('Market Hall', 'wall_mount', 'menu_board', { sides: ['b0'], gap: 10, max: 4 }),
    ...kitchen('Brightwater Kitchen 1', { islands: 4 }),
    ...kitchen('Brightwater Kitchen 2', { islands: 2 }),
    ...classroom('Brightwater Classroom', 'b1', 27.3, { desks: 0 }).slice(0, 2),
    d('Brightwater Classroom', 'grid', 'long_table', { face: 'b+', aisle: 1.6, margin: 1.6, max: 8 }),
    ...lobby('Brightwater Entrance', { desk: false }),
    d('Brightwater Pantry', 'grid', 'shelf', { face: 'a+', aisle: 1.4, margin: 1.2, max: 10 }),
    d('Brightwater Pantry', 'walls', 'fridge', { max: 3 }),
    d('Event Hall', 'at', 'stage', { fa: 0.92, fb: 0.5, w: 10, d: 4, face: 'a-' }),
    d('Event Hall', 'grid', 'banquet_table', { aisle: 2, margin: 2.4, max: 16 }),
    ...storage('Loading Dock', { racks: 10, crates: 10 }),
    d('HomeGrown', 'at', 'bar_counter', { fa: 0.85, fb: 0.5, face: 'a-' }),
    d('HomeGrown', 'wall_mount', 'menu_board', { sides: ['a1'], max: 2, gap: 2 }),
    d('HomeGrown', 'grid', 'dining_table', { aisle: 1.4, margin: 1.4, max: 16 }),
    d('HomeGrown', 'walls', 'plant', { max: 4 }),
  ],

  // 8th & Plate — Home Office food hall: a dozen stalls with menu boards around central seating of
  // communal long tables and café tables; mezzanine seating, private dining and an event room above.
  // Stall labels are the recipe's fallbacks ('Stall N'); when map POIs rename them these stall
  // directives no-op and the stall kit applies. Approximation from corporate.walmart.com / mbl-arch.
  949466253: [
    ...range(12).flatMap((i) => foodStall('Stall ' + i, 0)),
    d('West Seating', 'grid', 'long_table', { face: 'a+', aisle: 1.6, margin: 1.6, max: 10 }, 0),
    d('North Seating', 'grid', 'cafe_table', { aisle: 1.4, margin: 1.4, max: 20 }, 0),
    d('North Seating', 'walls', 'planter', { gap: 5, max: 4 }, 0),
    d('East Seating', 'grid', 'long_table', { face: 'b+', aisle: 1.8, margin: 1.8, max: 18 }, 0),
    d('Central Seating', 'centre', 'planter', { face: 'b+' }, 0),
    d('Central Seating', 'grid', 'long_table', { face: 'b+', aisle: 1.8, margin: 1.8, max: 24 }, 0),
    d('Central Seating', 'walls', 'high_top', { gap: 0.8, max: 12 }, 0),
    ...lobby('West Entrance', { desk: false, level: 0 }),
    ...lobby('South Entrance', { desk: false, level: 0 }),
    ...kitchen('Service Kitchen', { islands: 3, level: 0 }),
    d('Tray Return', 'walls', 'counter', { gap: 0.1, max: 6 }, 0),
    d('Tray Return', 'walls', 'sink', { max: 2 }, 0),
    d('Mezzanine Stair', 'walls', 'planter', { gap: 6, max: 6 }, 0),
    d('Mezzanine Seating', 'grid', 'dining_table', { aisle: 1.6, margin: 1.6, max: 20 }, 1),
    d('Mezzanine Seating', 'walls', 'sofa', { gap: 2, max: 4 }, 1),
    d('Private Dining', 'grid', 'banquet_table', { aisle: 2, margin: 2.4, max: 8 }, 1),
    d('Private Dining', 'wall_mount', 'painting', { gap: 3, max: 6 }, 1),
    d('Event Room', 'at', 'stage', { fa: 0.5, fb: 0.9, w: 10, d: 4, face: 'b-' }, 1),
    d('Event Room', 'grid', 'banquet_table', { aisle: 2, margin: 2.4, max: 16 }, 1),
    ...offices('Food Service Offices', { desks: 14, level: 1 }),
    d('Mezzanine Overlook', 'walls', 'high_top', { gap: 1.2, max: 12 }, 1),
    d('Mezzanine Overlook', 'walls', 'planter', { gap: 8, max: 6 }, 1),
  ],

  // Walmart Museum — Walton's 5&10 retro store (gondola shelves, counters, register), the exhibit
  // gallery of display cases and screens, the Spark Café soda fountain with stools, and a recreated
  // office (desk, bookcase, filing). Approximation from corporate.walmart.com / theclio et al.
  211198877: [
    d("Walton's 5&10", 'at', 'checkout', { fa: 0.88, fb: 0.3, face: 'b+' }),
    d("Walton's 5&10", 'walls', 'counter', { sides: ['b1'], gap: 0.4, max: 5 }),
    d("Walton's 5&10", 'grid', 'shelf', { face: 'b-', aisle: 1.4, margin: 1.4, max: 8 }),
    d("Walton's 5&10", 'walls', 'display_case', { sides: ['a0', 'a1'], max: 2 }),
    d("Walton's 5&10", 'wall_mount', 'menu_board', { sides: ['b1'], max: 2, gap: 4 }),
    d('Exhibit Gallery', 'grid', 'display_case', { face: 'b-', aisle: 2, margin: 2, max: 10 }),
    d('Exhibit Gallery', 'wall_mount', 'painting', { gap: 2, max: 10 }),
    d('Exhibit Gallery', 'wall_mount', 'tv', { sides: ['a0'], max: 2, gap: 3 }),
    d('Spark Café', 'at', 'counter', { fa: 0.35, fb: 0.86, face: 'b-' }),
    d('Spark Café', 'at', 'counter', { fa: 0.65, fb: 0.86, face: 'b-' }),
    ...[0.25, 0.42, 0.58, 0.75].map((fa) => d('Spark Café', 'at', 'stool', { fa, fb: 0.7, face: 'b+' })),
    d('Spark Café', 'wall_mount', 'menu_board', { sides: ['b1'], max: 2, gap: 1 }),
    d('Spark Café', 'grid', 'cafe_table', { aisle: 1.3, margin: 1.2, max: 4 }),
    d("Sam Walton's Office", 'at', 'desk', { fa: 0.5, fb: 0.62, face: 'b-' }),
    d("Sam Walton's Office", 'at', 'office_chair', { fa: 0.5, fb: 0.78, face: 'b-' }),
    d("Sam Walton's Office", 'walls', 'bookcase', { sides: ['b1'], gap: 0.3, max: 2 }),
    d("Sam Walton's Office", 'walls', 'filing_cabinet', { sides: ['a0', 'a1'], max: 2 }),
    d("Sam Walton's Office", 'at', 'chair', { fa: 0.38, fb: 0.4, face: 'b+' }),
    d("Sam Walton's Office", 'at', 'chair', { fa: 0.62, fb: 0.4, face: 'b+' }),
    d("Sam Walton's Office", 'wall_mount', 'painting', { max: 3, gap: 1.5 }),
  ],

  // Sam Walton Hall — reception desk at the entry, meeting rooms and boardroom with conference
  // tables and screens, a 1,500-seat-style auditorium (stage + seat-row house), green room,
  // radio studio, associate lounge; upper floors are team rooms, cubicle desk grids and break
  // rooms (the cubicles are a guess, as in landmarks.js). Approximation from corporate.walmart.com.
  949466246: [
    ...lobby('Reception', { entrance: 'b0', level: 0 }),
    d('Reception', 'wall_mount', 'tv', { sides: ['b1'], max: 2, gap: 4 }, 0),
    ...lobby('West Lobby', { desk: false, level: 0 }),
    d('Coat Room', 'walls', 'wardrobe', { gap: 0.2, max: 10 }, 0),
    d('Coat Room', 'walls', 'bench', { max: 2 }, 0),
    ...meeting('Boardroom', { tables: 4, level: 0 }),
    ...range(5).flatMap((i) => meeting('Meeting Room ' + i, { tables: 2, level: 0 })),
    d('Central Hall', 'walls', 'planter', { sides: ['b0', 'b1'], gap: 10, max: 10 }, 0),
    d('Central Hall', 'walls', 'bench', { sides: ['b0', 'b1'], gap: 12, max: 8 }, 0),
    ...lounge('Green Room', 0),
    d('Green Room', 'wall_mount', 'mirror', { gap: 0.6, max: 4 }, 0),
    d('Green Room', 'walls', 'dresser', { max: 2 }, 0),
    d('Walmart Radio', 'at', 'desk', { fa: 0.45, fb: 0.5, face: 'a+' }, 0),
    d('Walmart Radio', 'at', 'desk', { fa: 0.55, fb: 0.5, face: 'a-' }, 0),
    d('Walmart Radio', 'wall_mount', 'tv', { max: 2, gap: 2 }, 0),
    d('Walmart Radio', 'walls', 'filing_cabinet', { max: 3 }, 0),
    d('Walmart Radio', 'walls', 'sofa', { max: 1 }, 0),
    ...auditorium('Auditorium', 'b1', { w: 30, dd: 8, seats: 60, level: 0 }),
    ...storage('Backstage', { racks: 4, crates: 10, level: 0 }),
    d('Backstage', 'walls', 'workbench', { max: 2 }, 0),
    ...lounge('Associate Lounge', 0),
    d('Associate Lounge', 'grid', 'cafe_table', { aisle: 1.6, margin: 2, max: 14 }, 0),
    ...[1, 2, 3].flatMap((k) => [
      ...meeting('Team Room ' + k + 'A', { tables: 3, len: 36, wid: 29, level: k }),
      ...meeting('Team Room ' + k + 'B', { tables: 3, len: 30.1, wid: 29, level: k }),
      ...(k === 1 ? ['A', 'B', 'D'] : ['A', 'B', 'C', 'D']).flatMap((s) => offices('Cubicles ' + k + s, { desks: 20, level: k })),
      ...breakRoom('Break Room ' + k, { tables: 6, level: k }),
      d('Hall ' + k, 'walls', 'planter', { sides: ['b0', 'b1'], gap: 12, max: 6 }, k),
    ]),
    d('Auditorium Balcony', 'grid', 'seat_row', { face: 'b+', aisle: 1.2, margin: 1.6, max: 30 }, 1),
    d('Auditorium Balcony', 'walls', 'railing', { sides: ['b1'], gap: 0.2, max: 16 }, 1),
  ],

  // Bentonville High School (main + North Building): src/world/interiors/bhs.js
  ...bhsDressing({ d, classroom, gym, auditorium, offices, kitchen, lockers, library, cafeteria, lobby, storage, breakRoom, lounge, reserve, range }),

  // Bentonville West High School — 900-seat-style performing arts center (stage + house), a
  // competition arena (court, hoops, bleachers; upper bowl above), commons with café tables and a
  // coffee bar, cafeteria serving line, media center stacks, locker corridors through the pods,
  // band and choir rooms. Classroom kits are authored for levels 0-1 (the room kind's kit covers
  // levels 2-3) to stay within the landmark prop budget. Approximation from asumag.com /
  // bentonvillek12.org / Wikipedia (landmarks.js); pod and level arrangement is a guess there too.
  651787776: [
    ...auditorium('Performing Arts Center', 'b0', { w: 24, dd: 8, seats: 48, level: 0 }),
    d('Performing Arts Balcony', 'grid', 'seat_row', { face: 'b-', aisle: 1.2, margin: 1.6, max: 20 }, 1),
    d('Performing Arts Balcony', 'walls', 'railing', { sides: ['b0'], gap: 0.2, max: 12 }, 1),
    d('Band Room', 'grid', 'chair', { face: 'b-', aisle: 1, margin: 2, max: 40 }, 0),
    d('Band Room', 'wall_mount', 'whiteboard', { sides: ['b0'], max: 1 }, 0),
    d('Band Room', 'walls', 'bookcase', { sides: ['b1'], max: 4 }, 0),
    d('Choir Room', 'grid', 'seat_row', { face: 'b-', aisle: 1, margin: 2, max: 8 }, 0),
    d('Choir Room', 'wall_mount', 'whiteboard', { sides: ['b0'], max: 1 }, 0),
    d('Scene Shop', 'grid', 'workbench', { aisle: 2, margin: 2, max: 8 }, 0),
    d('Scene Shop', 'walls', 'crate', { gap: 0.4, max: 8 }, 0),
    ...lobby('Main Entrance', { entrance: 'a0', level: 0 }),
    d('Main Entrance', 'walls', 'display_case', { gap: 0.6, max: 6 }, 0),
    ...library('Media Center', { stacks: 16, tables: 3, level: 0 }),
    ...library('Media Center Upper', { stacks: 12, tables: 2 }),
    ...cafeteria('Cafeteria', 'a1', { tables: 24, level: 0 }),
    ...kitchen('Kitchen', { islands: 3, level: 0 }),
    d('Commons', 'grid', 'cafe_table', { aisle: 1.8, margin: 2, max: 36 }, 0),
    d('Commons', 'walls', 'bench', { gap: 4, max: 8 }, 0),
    d('Commons', 'walls', 'planter', { gap: 8, max: 6 }, 0),
    d('Coffee Bar', 'at', 'bar_counter', { fa: 0.3, fb: 0.5, face: 'a+' }, 0),
    d('Coffee Bar', 'wall_mount', 'menu_board', { sides: ['a0'], max: 1 }, 0),
    d('Coffee Bar', 'grid', 'high_top', { aisle: 1.2, margin: 1.2, max: 8 }, 0),
    ...gym('Arena', 82.7, { court: [17, 30], bleachers: 10, level: 0 }),
    d('Arena Lobby', 'walls', 'display_case', { gap: 0.8, max: 8 }, 0),
    d('Arena Lobby', 'at', 'reception_desk', { fa: 0.5, fb: 0.5, face: 'b-' }, 0),
    d('Arena Concourse', 'walls', 'bench', { gap: 4, max: 6 }, 1),
    d('Arena Upper Bowl', 'walls', 'bleachers', { sides: ['b0', 'b1'], gap: 0.6, max: 12 }, 1),
    d('Arena Upper Bowl', 'walls', 'railing', { sides: ['a0', 'a1'], gap: 0.2, max: 12 }, 1),
    ...lockers('Main Corridor', ['b0', 'b1'], 60, 0),
    ...[2, 3, 4].flatMap((fl) => lockers('Corridor ' + fl, ['b0', 'b1'], 60, fl - 1)),
    ...lockers('West Corridor', ['a0', 'a1'], 20, 0),
    ...[2, 3, 4].flatMap((fl) => lockers('West Corridor ' + fl, ['a0', 'a1'], 20, fl - 1)),
    ...[2, 3, 4].flatMap((fl) => [
      ...breakRoom('Teacher Workroom ' + fl, { tables: 2, level: fl - 1 }),
      ...offices('Pod Office ' + fl, { desks: 4, level: fl - 1 }),
      ...offices('Counseling ' + fl, { desks: 6, level: fl - 1 }),
    ]),
    ...offices('Pod Office 1', { desks: 4, level: 0 }),
    ...storage('Fly Loft', { racks: 4, crates: 6 }),
    // Classrooms, levels 0-1 (fl 1-2): north pods board on b0 (doors on the corridor side b1),
    // south pods board on b1, wing rooms board on the corridor side a0.
    ...[1, 2].flatMap((fl) => {
      const lv = fl - 1;
      const c = (p, i) => 'Room ' + p + fl + pad2(i);
      const out = [];
      if (fl > 1) {
        for (const i of range(8)) out.push(...classroom(c('A', i), 'b0', 18.7, { desks: 16, level: lv }));
        for (const i of range(8, 9)) out.push(...classroom(c('A', i), 'b1', 38, { desks: 20, level: lv }));
        for (const i of range(2)) out.push(...classroom(c('D', i), 'b0', 20, { desks: 20, level: lv }));
      }
      for (const p of ['B', 'C']) {
        for (const i of range(6)) out.push(...classroom(c(p, i), 'b0', 18.7, { desks: 16, level: lv }));
        for (const i of range(6, 7)) out.push(...classroom(c(p, i), 'b1', 38, { desks: 20, level: lv }));
      }
      for (const i of range(4)) out.push(d(c('W', i), 'wall_mount', 'whiteboard', { sides: ['a0'], max: 1 }, lv), d(c('W', i), 'grid', 'school_desk', { face: 'a-', aisle: 1.2, margin: 1.4, max: 20 }, lv));
      return out;
    }),
  ],

  // Benton County Courthouse — two courtrooms (judge's bench at the far end, witness stand, jury
  // box, the bar railing with a centre gate, counsel tables, pews split by a centre aisle), judge's
  // chambers, jury room, clerks' counters and records. Approximation from Wikipedia /
  // encyclopediaofarkansas.net (landmarks.js); not the real 1928 plan.
  577226262: [
    ...courtroom('Courtroom 1', { rows: 6 }),
    ...courtroom('Courtroom 2', { rows: 5 }),
    d("Judge's Chambers", 'at', 'desk', { fa: 0.5, fb: 0.6, face: 'b-' }),
    d("Judge's Chambers", 'walls', 'bookcase', { gap: 0.2, max: 5 }),
    d("Judge's Chambers", 'walls', 'armchair', { max: 2 }),
    d("Judge's Chambers", 'wall_mount', 'painting', { max: 2, gap: 2 }),
    d('Jury Room', 'at', 'long_table', { fa: 0.5, fb: 0.42, face: 'a+' }),
    d('Jury Room', 'at', 'long_table', { fa: 0.5, fb: 0.58, face: 'a+' }),
    d('Jury Room', 'wall_mount', 'whiteboard', { sides: ['b1'], max: 1 }),
    d('Jury Room', 'walls', 'chair', { gap: 0.4, max: 12 }),
    ...['Circuit Clerk', 'Probate Clerk'].flatMap((r) => [
      d(r, 'at', 'reception_desk', { fa: 0.5, fb: 0.25, face: 'b-' }),
      d(r, 'grid', 'desk', { face: 'b-', aisle: 1.6, margin: 1.4, max: 4 }),
      d(r, 'walls', 'filing_cabinet', { gap: 0.2, max: 8 }),
    ]),
    d('Records Room', 'grid', 'filing_cabinet', { face: 'b+', aisle: 1.2, margin: 1, max: 24 }),
    d('Records Room', 'walls', 'shelf', { gap: 0.2, max: 6 }),
    ...offices('Prosecuting Attorney', { desks: 4 }),
    ...lobby('Judicial Tower Lobby', { entrance: 'b0' }),
    d('West Hall', 'walls', 'bench', { gap: 3, max: 4 }),
    d('West Hall', 'wall_mount', 'painting', { gap: 3, max: 6 }),
  ],

  // Benton County Court House Annex — undocumented interior (see landmarks.js), so plain county
  // offices: counters in the lobby, clerk desks and files, a small hearing room, records shelving.
  577262580: [
    ...lobby('Annex Lobby', { entrance: 'a0', level: 0 }),
    ...lobby('Rear Entrance', { desk: false, level: 0 }),
    ...offices('County Clerk', { desks: 4, level: 0 }),
    ...offices('Assessor', { desks: 4, level: 0 }),
    ...offices('Office 201', { desks: 4, level: 1 }),
    ...offices('Office 202', { desks: 4, level: 1 }),
    ...courtroom('Hearing Room', { rows: 2, level: 1 }),
    d('Records', 'grid', 'filing_cabinet', { face: 'a+', aisle: 1.2, margin: 1, max: 16 }, 1),
    d('Records', 'walls', 'shelf', { gap: 0.2, max: 6 }, 1),
  ],

  // Bike Rack Brewing Co. — taproom bar with a tap wall, stools and high-tops; brewhouse with a grid
  // of fermentation tanks; cold room and barrel room storage. Approximation from
  // downtownbentonville.org / fayettevilleflyer.com (landmarks.js).
  896842915: [
    ...[0.38, 0.5, 0.62].map((fa) => d('Taproom', 'at', 'bar_counter', { fa, fb: 0.84, face: 'b-' })),
    d('Taproom', 'wall_mount', 'tap_board', { sides: ['b1'], max: 3, gap: 0.4 }),
    ...[0.34, 0.42, 0.5, 0.58, 0.66].map((fa) => d('Taproom', 'at', 'stool', { fa, fb: 0.72, face: 'b+' })),
    d('Taproom', 'grid', 'high_top', { aisle: 1.4, margin: 1.4, max: 14 }),
    d('Taproom', 'wall_mount', 'tv', { sides: ['a0'], max: 2, gap: 2 }),
    d('Taproom', 'walls', 'bench', { sides: ['a0'], max: 2 }),
    d('Brewhouse', 'grid', 'tank', { face: 'a-', aisle: 1.4, margin: 1.6, max: 12 }),
    d('Brewhouse', 'walls', 'workbench', { gap: 1, max: 2 }),
    d('Brewhouse', 'walls', 'pallet_rack', { sides: ['a1'], max: 2 }),
    d('Cold Room', 'walls', 'shelf', { gap: 0.2, max: 4 }),
    d('Cold Room', 'walls', 'crate', { max: 3 }),
    d('Barrel Room', 'grid', 'crate', { aisle: 1, margin: 1.2, max: 8 }),
    d('Barrel Room', 'walls', 'pallet_rack', { max: 2 }),
  ],

  // Field Notes — all-day café: coffee counter with pastry case and menu boards, café seating of
  // small tables and a banquette, a bar with taps and stools, and the kitchen line. Approximation
  // from the joe.coffee listing cited in landmarks.js.
  1578366349: [
    ...cafe('Coffee Counter', 'b1', 9, { tables: 2 }),
    d('Café Seating', 'grid', 'cafe_table', { aisle: 1.3, margin: 1.2, max: 12 }),
    d('Café Seating', 'walls', 'sofa', { sides: ['b1'], max: 2 }),
    d('Café Seating', 'wall_mount', 'painting', { gap: 2, max: 5 }),
    d('Café Seating', 'walls', 'plant', { max: 3 }),
    ...kitchen('Kitchen', { islands: 1 }),
    d('Bar', 'at', 'bar_counter', { fa: 0.4, fb: 0.62, face: 'b-' }),
    d('Bar', 'at', 'bar_counter', { fa: 0.64, fb: 0.62, face: 'b-' }),
    d('Bar', 'wall_mount', 'tap_board', { sides: ['b1'], max: 1 }),
    d('Bar', 'wall_mount', 'cabinet_upper', { sides: ['b1'], max: 2, gap: 0.6 }),
    ...[0.32, 0.44, 0.56, 0.68].map((fa) => d('Bar', 'at', 'stool', { fa, fb: 0.38, face: 'b+' })),
    ...lobby('Lobby', { desk: false }),
  ],

  // Wright's Barbecue — takeout counter with menu boards, a dining room of communal long tables,
  // the kitchen line and the smoker pit (workbenches, a range, stacked wood). Approximation from
  // talkbusiness.net / nwatravelguide.com (landmarks.js).
  912573722: [
    d('Takeout Counter', 'at', 'counter', { fa: 0.78, fb: 0.38, face: 'a-' }),
    d('Takeout Counter', 'at', 'counter', { fa: 0.78, fb: 0.62, face: 'a-' }),
    d('Takeout Counter', 'wall_mount', 'menu_board', { sides: ['a1'], max: 2, gap: 1 }),
    d('Takeout Counter', 'walls', 'bench', { sides: ['b0', 'b1'], max: 2 }),
    d('Dining Room', 'grid', 'long_table', { face: 'a+', aisle: 1.4, margin: 1.2, max: 6 }),
    d('Dining Room', 'wall_mount', 'painting', { gap: 2, max: 4 }),
    ...kitchen('Kitchen', { islands: 0 }),
    d('Smoker Pit', 'walls', 'workbench', { gap: 0.4, max: 2 }),
    d('Smoker Pit', 'at', 'stove', { fa: 0.5, fb: 0.5, face: 'a-' }),
    d('Smoker Pit', 'walls', 'crate', { gap: 0.2, max: 4 }),
  ],

  // Bentoville Food Theater — one big floor of communal tables facing three chef "stages", each a
  // cooking line (counter, range, upper cabinets, menu board) open toward the room. Approximation
  // from the axios.com reports cited in landmarks.js.
  799259120: [
    d('Theater Floor', 'grid', 'long_table', { face: 'b+', aisle: 1.6, margin: 1.6, max: 9 }),
    d('Theater Floor', 'walls', 'high_top', { sides: ['a0'], gap: 0.6, max: 4 }),
    d('Theater Floor', 'walls', 'plant', { max: 2 }),
    ...['Stage 1', 'Stage 2', 'Stage 3'].flatMap((r) => [
      // ~8.8 x 6.2 m: one service counter toward the floor, one range on the back line, one board.
      d(r, 'at', 'counter', { fa: 0.5, fb: 0.32, face: 'b-' }),
      d(r, 'at', 'stove', { fa: 0.5, fb: 0.82, face: 'b-' }),
      d(r, 'wall_mount', 'menu_board', { sides: ['b1'], max: 1 }),
    ]),
    ...kitchen('Kitchen', { islands: 0 }),
  ],

  // Onyx Coffee Lab + Block Street Records — record bins in rows with a register and wall racks,
  // the stock room, Onyx's café (counter, pastry case, menu boards, tables) and the coffee bar with
  // stools. Approximation from downtownbentonville.org / onyxcoffeelab.com (landmarks.js).
  799259121: [
    d('Block Street Records', 'at', 'checkout', { fa: 0.82, fb: 0.32, face: 'a-' }),
    d('Block Street Records', 'grid', 'record_bin', { face: 'b+', aisle: 1.2, margin: 1.2, max: 10 }),
    d('Block Street Records', 'walls', 'shelf', { sides: ['b0'], gap: 0.3, max: 4 }),
    d('Block Street Records', 'wall_mount', 'painting', { gap: 1, max: 6 }),
    d('Record Stock Room', 'walls', 'shelf', { gap: 0.2, max: 6 }),
    d('Record Stock Room', 'grid', 'crate', { aisle: 1, margin: 1, max: 6 }),
    ...cafe('Onyx Coffee Lab', 'b1', 13.9, { tables: 10 }),
    ...lobby('Side Entrance', { desk: false }),
    d('Coffee Bar', 'at', 'bar_counter', { fa: 0.5, fb: 0.7, face: 'b-' }),
    d('Coffee Bar', 'wall_mount', 'menu_board', { sides: ['b1'], max: 1 }),
    ...[0.32, 0.5, 0.68].map((fa) => d('Coffee Bar', 'at', 'stool', { fa, fb: 0.45, face: 'b+' })),
  ],
};
