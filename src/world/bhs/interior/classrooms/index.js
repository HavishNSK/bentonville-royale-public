// BENTONVILLE ROYALE — Bentonville High School: classroom generator (owned by the classrooms
// subagent, docs/bhs/BHS_CONTRACT.md). Called by src/world/bhs/index.js for every classroom / lab /
// studio / music room / gallery of both buildings, after the buildings are planned.
//
// APPROXIMATE: there are no classroom photos; rooms use typical US high school detailing in the
// style-bible palette (docs/bhs/STYLE_BIBLE.md §4-5). Every room is seeded from its id (+ building,
// level and rect: ids repeat between the buildings), never Math.random, and neighbours (same level,
// adjacent or across the corridor) are steered to a different accent colour and seating layout:
//   - type by subject label (subjects.js roomType): science, art, computer, music, piano, culinary,
//     engineering, robotics, seminar, workroom, gallery, regular
//   - regular rooms: 8 seating layouts (layouts.js) x desk styles x teacher-desk positions
//   - an accent colour per room (PAL.accents): accent wall, board borders, chairs, rugs
//   - a light mood per room (normal / bright / warm desk lamp / cool / dim with fixtures off)
//   - lived-in clutter in a per-room amount; about one loot spot per room (a chest in ~1 in 4)
// Gameplay: desks / tables are light cover (wood ~120 hp), lab benches and kitchen islands strong
// cover (block 300-400 hp); doors keep a 2.2 m clear zone; small props are drawn only.

import { analyseRoom, chooseFront, makeRoom } from './room.js';
import { LAYOUTS } from './layouts.js';
import { roomType, dressRegular, dressScience, dressArt, dressComputer, dressMusic, dressPiano, dressCulinary, dressEngineering, dressSeminar, dressWorkroom, dressGallery } from './subjects.js';
import { accentWall } from './walls.js';
import { placeLoot, lightRoom, MOOD_NAMES } from './common.js';
import { ACCENTS, C, hashStr, seeded, buildingOf, roomKey, pick, range, insideOutline } from './util.js';

export { insideOutline, roomType, LAYOUTS, buildingOf, roomKey };

/** Budgets for all classrooms together (docs: ~60k decor boxes, 2,500 colliders). */
export const CLASSROOM_BUDGET = Object.freeze({ decor: 60000, colliders: 2500 });

const reports = new WeakMap();
/** The last dressing report for a kit: { rooms: [...], decor, colliders, loot }. */
export const classroomReport = (K) => reports.get(K) || null;

const DRESS = {
  regular: dressRegular,
  science: dressScience,
  art: dressArt,
  computer: dressComputer,
  music: dressMusic,
  piano: dressPiano,
  culinary: dressCulinary,
  engineering: (rc) => dressEngineering(rc, false),
  robotics: (rc) => dressEngineering(rc, true),
  seminar: dressSeminar,
  workroom: dressWorkroom,
  gallery: dressGallery,
};

const TEACHER_POS = ['frontLeft', 'frontRight', 'backLeft', 'backRight', 'sideLeft', 'sideRight'];
const CHAIR_STYLES = ['accent', 'accent', 'mixed', 'neutral'];

/** Same building + level, and the rects share an edge or face each other across a corridor (<= 4.5 m). */
export function neighbours(a, b) {
  if (a === b || a.level !== b.level || buildingOf(a) !== buildingOf(b)) return false;
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  const gx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
  const gz = Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1);
  return (ox > 1 && gz >= -0.05 && gz <= 4.5) || (oz > 1 && gx >= -0.05 && gx <= 4.5);
}

/**
 * Pick per-room accent and layout indices from the room hash, bumped away from neighbours already
 * assigned (deterministic: rooms are visited in plan order).
 */
export function assignLooks(rooms) {
  const out = new Map();
  for (const r of rooms) {
    const h = hashStr(roomKey(r));
    const near = rooms.filter((q) => out.has(q) && neighbours(r, q)).map((q) => out.get(q));
    let accent = h % ACCENTS.length;
    for (let k = 0; k < ACCENTS.length && near.some((n) => n.accent === accent); k++) accent = (accent + 1) % ACCENTS.length;
    let layout = (h >>> 8) % LAYOUTS.length;
    for (let k = 0; k < LAYOUTS.length && near.some((n) => n.layout === layout); k++) layout = (layout + 1) % LAYOUTS.length;
    let mood = (h >>> 16) % MOOD_NAMES.length;
    for (let k = 0; k < MOOD_NAMES.length && near.some((n) => n.mood === mood); k++) mood = (mood + 1) % MOOD_NAMES.length;
    out.set(r, { accent, layout, mood, hash: h });
  }
  return out;
}

/** @param {ReturnType<import('../../kit/builder.js').createKit>} K @param {object[]} rooms plan rooms */
export function dressClassrooms(K, rooms) {
  const prevGroup = K.group;
  const p0 = K.parts.length;
  const d0 = K.decors.length;
  const l0 = K.lootSpots.length;
  const glassParts = K.parts.filter((p) => p.role === 'glass');
  const wallPartsAll = K.parts.filter((p) => p.role === 'wall');
  const slabPartsAll = K.parts.filter((p) => p.role === 'slab');
  const roomZones = K.zones.filter((z) => z.x0 !== undefined && z.building);
  const looks = assignLooks(rooms);
  const report = { rooms: [], decor: 0, colliders: 0, loot: 0 };
  for (const room of rooms) {
    const L = looks.get(room);
    const rnd = seeded(L.hash);
    const geo = analyseRoom(K, room, { glassParts, others: roomZones });
    if (!geo) {
      report.rooms.push({ id: room.id, building: buildingOf(room), level: room.level, skipped: true });
      continue;
    }
    const building = geo.building;
    K.setGroup(`int:${building}:${room.level}`);
    const pd = K.parts.length;
    const dd = K.decors.length;
    const ld = K.lootSpots.length;
    const front = chooseFront(geo, rnd);
    const wallParts = wallPartsAll.filter((p) => p.cx > room.x0 - 2 && p.cx < room.x1 + 2 && p.cz > room.z0 - 2 && p.cz < room.z1 + 2 && p.y1 > geo.y + 0.5 && p.y0 < geo.ceil);
    const accent = ACCENTS[L.accent];
    const chairStyle = roomType(room.label, room.kind) === 'computer' ? 'accent' : pick(rnd, CHAIR_STYLES);
    const chairPool = chairStyle === 'accent' ? [accent.base, accent.base, accent.dark] : chairStyle === 'mixed' ? [accent.base, accent.light, C.charcoal, C.plasticBlue, accent.dark] : [C.charcoal, C.charcoal, accent.base];
    const type = roomType(room.label, room.kind);
    const rc = makeRoom(K, geo, front, {
      rnd,
      hash: L.hash,
      type,
      wallParts,
      slabParts: room.level > 0 ? slabPartsAll.filter((p) => p.cx + p.hx > room.x0 && p.cx - p.hx < room.x1 && p.cz + p.hz > room.z0 && p.cz - p.hz < room.z1) : [],
      accent,
      accentIdx: L.accent,
      layout: LAYOUTS[L.layout],
      layoutIdx: L.layout,
      style: rnd() < 0.5 ? 'combo' : 'desk',
      teacherPos: pick(rnd, TEACHER_POS),
      mood: MOOD_NAMES[L.mood],
      clutterAmt: range(rnd, 0.25, 1.0),
      chairCol: () => pick(rnd, chairPool),
      couchCol: pick(rnd, [accent.dark, C.navy, C.charcoal, accent.base]),
      closetCol: pick(rnd, [C.woodLight, C.cream, C.greyLight, accent.light]),
      stoolCol: pick(rnd, [C.charcoal, accent.base, C.black]),
      benchBody: pick(rnd, [C.woodLight, C.cream, C.greyLight, accent.light]),
      lockerCol: pick(rnd, [accent.base, accent.dark, C.charcoal]),
      riserLook: pick(rnd, ['carpet', accent.dark, accent.base]),
      wallUse: { front: [], back: [], left: [], right: [] },
      counters: [],
    });
    const res = DRESS[type](rc) || {};
    // the accent wall: paint film over the chosen wall (skipped for exterior walls)
    const aw = rc.accentWallName || 'back';
    if (rc.walls[aw] && !rc.walls[aw].ext) accentWall(rc, aw, type === 'gallery' ? accent.paper : accent.base);
    lightRoom(rc, res.teacher);
    const loot = placeLoot(rc, res.teacher, res.closet);
    report.rooms.push({
      id: room.id,
      key: roomKey(room),
      building,
      level: room.level,
      label: room.label,
      type,
      layout: res.layout || rc.layout,
      accent: accent.base,
      accentIdx: L.accent,
      mood: rc.mood,
      front,
      teacher: res.teacher ? res.teacher.where : null,
      decor: K.decors.length - dd,
      colliders: K.parts.length - pd,
      loot,
      lootSpots: K.lootSpots.slice(ld),
      parts: K.parts.slice(pd),
      doors: rc.doors.map((d) => ({ x: d.x, z: d.z, side: d.world.side, w: d.w })),
      y: rc.y,
      base: rc.base,
      ir: geo.ir,
    });
  }
  report.decor = K.decors.length - d0;
  report.colliders = K.parts.length - p0;
  report.loot = K.lootSpots.length - l0;
  reports.set(K, report);
  K.setGroup(prevGroup);
  return report;
}

