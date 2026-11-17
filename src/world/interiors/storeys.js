// Deterministic stair planning and shared floor/surface queries. Coordinates are metres.
import { q, toLocal, toWorld, inPoly, roomPoint, segDist2 } from './layout.js';

export const FLOOR_THICKNESS = 0.18;
export const MAX_STOREYS = 4;
const SHAFT_AISLE = 1.2;

export function storeyCount(bd) {
  const height = Number(bd.h);
  const requested = Number(bd.lv) || Math.floor(height / 3.4);
  if (!Number.isFinite(height) || height < 6.4) return 1;
  return Math.max(1, Math.min(MAX_STOREYS, Math.floor(requested), Math.floor((height - 0.2) / 2.9)));
}

export function inHole(plan, level, x, z, margin = 0) {
  const [a, b] = toLocal(plan.frame, x, z);
  return level.holes.some(h => a > h.a0 - margin && a < h.a1 + margin && b > h.b0 - margin && b < h.b1 + margin);
}

export function stairHeight(s, x, z) {
  const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
  const len2 = dx * dx + dz * dz;
  const t = ((x - s.x0) * dx + (z - s.z0) * dz) / len2;
  const side = ((x - s.x0) * dz - (z - s.z0) * dx) / Math.sqrt(len2);
  if (t < -0.001 || t > 1.001 || Math.abs(side) > s.w / 2) return -Infinity;
  return s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, t));
}

function roomAt(level, a, b) {
  return level.rooms.find(r => a >= r.a0 && a <= r.a1 && b >= r.b0 && b <= r.b1)?.id ?? -1;
}

function localPolygon(plan, shell) {
  const poly = [];
  for (let i = 0; i < shell.inner.length; i += 2) poly.push(...toLocal(plan.frame, shell.inner[i], shell.inner[i + 1]));
  return poly;
}

// Extra stair shafts on big footprints: one more per SHAFT_AREA m^2 of footprint (MAX_SHAFTS in
// all), each at least SHAFT_SPACING m (centre to centre) from every other, so a long building
// has a way up near every part of it instead of one flight at the lobby.
const MAX_SHAFTS = 4;
const SHAFT_AREA = 1800;
const SHAFT_SPACING = 30;
const ALONG_STEP = 4; // m between candidate flight positions slid along a long room

/**
 * Every place a flight (plus approach pads and a side aisle) fits inside one ground-floor room,
 * sorted by score (circulation rooms first, then nearest the authored hint). `centred` marks
 * the room-centred positions (the only ones the first shaft is chosen from).
 */
function shaftCandidates(plan, shell, rise, hints) {
  const run = q(Math.max(5, rise * 1.5)), w = 1.4;
  const poly = localPolygon(plan, shell), candidates = [];
  for (const r of plan.levels[0].rooms) for (const axis of ['a', 'b']) {
    const lo = axis === 'a' ? r.a0 : r.b0, hi = axis === 'a' ? r.a1 : r.b1;
    const slo = axis === 'a' ? r.b0 : r.a0, shi = axis === 'a' ? r.b1 : r.a1;
    if (hi - lo < run + 2.9 || shi - slo < w + 2.4) continue;
    const mid = q((slo + shi) / 2);
    const starts = [0, -0.25, 0.25, -0.5, 0.5].map((shift) => [q((lo + hi - run) / 2 + shift), true]);
    for (let s = lo + 1.5; s + run + 1.5 <= hi; s += ALONG_STEP) starts.push([q(s), false]);
    for (const [start, centred] of starts) {
      const a0 = q(axis === 'a' ? start : mid - w / 2), b0 = q(axis === 'a' ? mid - w / 2 : start);
      const a1 = q(axis === 'a' ? start + run : mid + w / 2), b1 = q(axis === 'a' ? mid + w / 2 : start + run);
      const points = axis === 'a'
        ? [[a0 - 1.45, b0 - 1.1], [a1 + 1.45, b0 - 1.1], [a0 - 1.45, b1 + 1.1], [a1 + 1.45, b1 + 1.1]]
        : [[a0 - 1.1, b0 - 1.45], [a1 + 1.1, b0 - 1.45], [a0 - 1.1, b1 + 1.45], [a1 + 1.1, b1 + 1.45]];
      if (!points.every(([a, b]) => a >= r.a0 && a <= r.a1 && b >= r.b0 && b <= r.b1 && inPoly(poly, a, b))) continue;
      // A concave notch may cross between corners. Check the entire reserved pad/aisle.
      const minA = Math.min(...points.map(p => p[0])), maxA = Math.max(...points.map(p => p[0]));
      const minB = Math.min(...points.map(p => p[1])), maxB = Math.max(...points.map(p => p[1]));
      let fits = true;
      for (let a = minA; a <= maxA && fits; a += 0.25) for (let b = minB; b <= maxB; b += 0.25) {
        if (!inPoly(poly, a, b)) { fits = false; break; }
      }
      if (!fits) continue;
      const hint = hints?.[0];
      const distance = hint ? (hint.a - (a0 + a1) / 2) ** 2 + (hint.b - (b0 + b1) / 2) ** 2 : 0;
      const pref = /corridor|hall|lobby/.test(r.kind);
      candidates.push({ a0, b0, a1, b1, axis, w, centred, pref, score: (pref ? 0 : 100000) + distance });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

/**
 * The stair shafts of a building: the best room-centred candidate (exactly the single shaft
 * earlier versions picked), then on big footprints extra ones by farthest-point: each next
 * shaft is the candidate farthest from every chosen one (circulation rooms first), at least
 * SHAFT_SPACING m away. Squared distances only (deterministic across clients).
 */
function pickShafts(candidates, area) {
  const first = candidates.find((c) => c.centred);
  if (!first) return [];
  const chosen = [first];
  const maxN = Math.min(MAX_SHAFTS, 1 + Math.floor(area / SHAFT_AREA));
  const ca = (c) => (c.a0 + c.a1) / 2, cb = (c) => (c.b0 + c.b1) / 2;
  while (chosen.length < maxN) {
    let best = null, bestD2 = -1;
    for (const c of candidates) {
      let d2 = Infinity;
      for (const h of chosen) d2 = Math.min(d2, (ca(c) - ca(h)) ** 2 + (cb(c) - cb(h)) ** 2);
      if (d2 < SHAFT_SPACING * SHAFT_SPACING) continue;
      if (!best || (c.pref && !best.pref) || (c.pref === best.pref && d2 > bestD2)) { best = c; bestD2 = d2; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen.map(({ a0, b0, a1, b1, axis, w, score }) => ({ a0, b0, a1, b1, axis, w, score }));
}

/** Remove upper partitions crossing any reserved stair circulation band, including panels. */
function upperLevel(plan, upper, Hs, i, panels) {
  const src = upper.levels[0], walls = [], wallMeta = [];
  for (let k = 0; k < src.wallMeta.length; k++) {
    const W = src.walls, m = src.wallMeta[k];
    const A = toLocal(plan.frame, W[k * 7], W[k * 7 + 1]);
    const B = toLocal(plan.frame, W[k * 7 + 2], W[k * 7 + 3]);
    if (Hs.some((H) => Math.max(A[0], B[0]) >= H.a0 - SHAFT_AISLE && Math.min(A[0], B[0]) <= H.a1 + SHAFT_AISLE &&
        Math.max(A[1], B[1]) >= H.b0 - SHAFT_AISLE && Math.min(A[1], B[1]) <= H.b1 + SHAFT_AISLE)) continue;
    const id = m.panel >= 0 ? panels.length : -1;
    if (id >= 0) panels.push({ ...upper.panels[m.panel], id, wall: walls.length / 7, level: i });
    wallMeta.push({ ...m, panel: id });
    walls.push(...W.slice(k * 7, k * 7 + 7));
  }
  let holeArea = 0;
  for (const H of Hs) holeArea += (H.a1 - H.a0) * (H.b1 - H.b0);
  return { ...src, i, holes: Hs.map((H) => ({ a0: H.a0, b0: H.b0, a1: H.a1, b1: H.b1 })), walls: new Float32Array(walls), wallMeta,
    floorArea: q(Math.max(0, src.floorArea - holeArea)) };
}

/** Keep room centres/loot on a flat supported floor, outside every flight footprint. */
function flatRooms(plan, shell, L, Hs) {
  const polygon = localPolygon(plan, shell);
  const shaftAt = (a, b) => Hs.find((H) => a > H.a0 - 0.65 && a < H.a1 + 0.65 && b > H.b0 - 0.65 && b < H.b1 + 0.65);
  return L.rooms.map(r => {
    const [a, b] = toLocal(plan.frame, r.cx, r.cz);
    const H = shaftAt(a, b);
    if (!H) return r;
    const rects = [
      { ...r, a1: Math.min(r.a1, H.a0 - 0.65) }, { ...r, a0: Math.max(r.a0, H.a1 + 0.65) },
      { ...r, b1: Math.min(r.b1, H.b0 - 0.65) }, { ...r, b0: Math.max(r.b0, H.b1 + 0.65) },
    ];
    let best = null;
    for (const R of rects) {
      if (R.a1 - R.a0 < 1.3 || R.b1 - R.b0 < 1.3) continue;
      const [ca, cb, clear] = roomPoint(R, polygon);
      if (clear < 0.6 || shaftAt(ca, cb)) continue;
      const [cx, cz] = toWorld(plan.frame, ca, cb);
      let blocked = false;
      for (let k = 0; k < L.walls.length; k += 7) {
        const W = L.walls;
        if (W[k + 5] > L.y + 0.3) continue;
        if (segDist2(W[k], W[k + 1], W[k + 2], W[k + 3], cx, cz) < 0.6 ** 2) { blocked = true; break; }
      }
      const distance = (ca - a) ** 2 + (cb - b) ** 2;
      if (!blocked && (!best || distance < best.distance)) best = { cx, cz, distance };
    }
    return best ? { ...r, cx: best.cx, cz: best.cz } : r;
  });
}

export function addStoreys(plan, bd, shell, count, trees, hints, makeLevel) {
  if (count < 2) return plan;
  const rise = q(shell.ceil - shell.floor + FLOOR_THICKNESS);
  const area = Number.isFinite(shell.area) ? shell.area : plan.frame.L * plan.frame.W;
  const Hs = pickShafts(shaftCandidates(plan, shell, rise, hints), area);
  if (!Hs.length) return plan; // Never expose unreachable upper floors on small/irregular footprints.
  const levels = [plan.levels[0]], panels = [...plan.panels];
  for (let i = 1; i < count; i++) {
    const y = q(shell.floor + rise * i), ceil = q(y + rise - FLOOR_THICKNESS);
    const upper = makeLevel({ ...shell, floor: y, ceil }, trees?.[i] || trees?.[0]);
    levels.push(upperLevel(plan, upper, Hs, i, panels));
  }
  const flatLevels = levels.map(L => ({ ...L, rooms: flatRooms(plan, shell, L, Hs) }));
  // stairs grouped by level (shaft 0 first on each), one flight per shaft per storey
  const stairs = [];
  for (let i = 0; i < levels.length - 1; i++) for (const H of Hs) {
    const a0 = H.axis === 'a' ? H.a0 : (H.a0 + H.a1) / 2, b0 = H.axis === 'a' ? (H.b0 + H.b1) / 2 : H.b0;
    const a1 = H.axis === 'a' ? H.a1 : a0, b1 = H.axis === 'a' ? b0 : H.b1;
    const [x0, z0] = toWorld(plan.frame, a0, b0), [x1, z1] = toWorld(plan.frame, a1, b1);
    const da = H.axis === 'a' ? 1 : 0, db = H.axis === 'b' ? 1 : 0;
    stairs.push({ level: i, x0, z0, x1, z1, y0: levels[i].y, y1: levels[i + 1].y, w: H.w,
      room0: roomAt(levels[i], a0 - da, b0 - db), room1: roomAt(levels[i + 1], a1 + da, b1 + db), ...H });
  }
  const lootSpots = [];
  for (const L of flatLevels) for (const r of L.rooms) {
    const [a, b] = toLocal(plan.frame, r.cx, r.cz);
    if (Hs.some((H) => a > H.a0 - 0.6 && a < H.a1 + 0.6 && b > H.b0 - 0.6 && b < H.b1 + 0.6)) continue;
    lootSpots.push({ x: r.cx, y: L.y, z: r.cz, level: L.i, room: r.id });
  }
  let hash = plan.hash;
  const mix = v => { hash = Math.imul(hash ^ (Math.round(v * 64) | 0), 0x01000193) >>> 0; };
  for (const L of flatLevels) {
    mix(L.y); mix(L.ceil);
    for (const v of L.walls) mix(v);
    for (const r of L.rooms) for (const v of [r.a0, r.b0, r.a1, r.b1, r.cx, r.cz]) mix(v);
  }
  for (const s of stairs) for (const v of [s.x0, s.z0, s.x1, s.z1, s.y0, s.y1, s.w]) mix(v);
  return { ...plan, levels: flatLevels, panels, stairs, lootSpots, hash };
}
