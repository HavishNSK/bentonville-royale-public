#!/usr/bin/env node
// Composes the compact game map from the full real-geography map.
//
//   node scripts/compose-map.mjs        (npm run compose-map; `npm run fetch-map` runs it after the fetch)
//
// Input:  data-raw/bentonville-osm-full.json   (scripts/fetch-map-data.mjs, 10.8 x 6 km, gitignored)
// Output: public/data/bentonville-osm.json      (what the game loads)
//         credits/map-data.md                   (the "Map composition" section is replaced)
//
// The real map has ~8 km of suburbs between downtown and Bentonville West High, so the
// game map is a designed layout instead of real distances:
//   - CORE: downtown stays exactly where it is (origin = the Square, so Google 3D tiles and
//     every downtown coordinate still line up with reality).
//   - ISLANDS: a rectangle around each high school campus is cut out and translated next to
//     the core, leaving GAP metres of designed countryside in between.
//   - Everything outside the core and the islands is dropped.
//   - Each gap gets a connector road (island road -> core road, both ending on the facing
//     rectangle edges; class and width of the core road). Everything inside the bounds that
//     is not a real-map piece becomes designed countryside (grass base + wood / park blobs,
//     denser in the gaps) so nothing reads as a void.
// Clipping: roads, paths, waterways and land-cover areas are clipped to their rectangle
// (Liang-Barsky / Sutherland-Hodgman); buildings and building parts that cross a rectangle
// edge are dropped rather than cut; trees, POIs and landmarks move with their rectangle.
// Building heights (Overture) are already baked into each building, so they move too.
//
// Deterministic: same input -> byte-identical output. Tweak the layout in the table below.
// Rectangles are [minX, minZ, maxX, maxZ] in game metres (x east, z SOUTH) of the FULL map.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_FILE = path.join(ROOT, 'data-raw', 'bentonville-osm-full.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'bentonville-osm.json');
const CREDITS_FILE = path.join(ROOT, 'credits', 'map-data.md');

// ------------------------------------------------------------------ layout (edit me)

// Downtown core, kept in place. Covers the Square/Courthouse, Crystal Bridges, Memorial
// Park, the Walmart Home Office, the Momentary, 8th Street Market and Compton Gardens with
// ~150-250 m of margin (east edge = edge of the fetched data).
const CORE = { key: 'downtown', rect: [-250, -1400, 1723, 1450] };

// Islands: `rect` in full-map metres, moved by (dx, dz). `connect` names the island road and
// the core road joined across the gap (OSM way ids; each must cross its facing edge).
//   bentonville_west: campus + the street grid around it; its main east drive (way 651787759, z = -587)
//     is lined up with West Central Avenue (z = 59), the road straight into the Square, and
//     the island's east edge sits GAP m west of the core's west edge.
//   bentonville_high: campus + stadium; SE J Street (x = 1049) lines up with downtown's SE J
//     Street at the core's south edge (x = 1072), island north edge GAP m south of the core.
const GAP = 400;
const ISLANDS = [
  {
    key: 'bentonville_west',
    side: 'west', // which side of the core the island sits on
    rect: [-8410, -1080, -7700, -240], // campus, stadium + fields, and the Maple Street houses to the north
    dx: -250 - GAP - -7700, // east edge -> core west edge - GAP
    dz: 59 - -587, // campus drive -> West Central Avenue
    connect: [{ island: 651787759, core: 779012351 }],
  },
  {
    key: 'bentonville_high',
    side: 'south',
    rect: [880, 2060, 1560, 2730],
    dx: 1072 - 1049, // SE J Street -> SE J Street
    dz: 1450 + GAP - 2060, // north edge -> core south edge + GAP
    connect: [{ island: 1421461553, core: 1421461530 }],
  },
];
const BOUNDS_MARGIN = 120; // metres of plain ground around the composed extent
const PATCH = 100; // countryside grid cell (m): grass base + at most one wood/park blob per cell
const PATH_KINDS = new Set(['footway', 'path', 'steps', 'cycleway', 'track', 'pedestrian']);

// ------------------------------------------------------------------ geometry

const r1 = (v) => Math.round(v * 10) / 10;
const EPS = 0.05;

function shoelace(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

const inRect = (q, R) => q[0] >= R[0] - EPS && q[0] <= R[2] + EPS && q[1] >= R[1] - EPS && q[1] <= R[3] + EPS;

/** Liang-Barsky per segment; consecutive inside pieces are joined. Returns 0..n polylines. */
function clipLine(pts, R) {
  const out = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0 - R[0]], [dx, R[2] - x0], [-dz, z0 - R[1]], [dz, R[3] - z0]]) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!ok || t0 > t1) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const a = [x0 + dx * t0, z0 + dz * t0];
    const b = [x0 + dx * t1, z0 + dz * t1];
    if (cur && t0 === 0) cur.push(b);
    else {
      if (cur) out.push(cur);
      cur = [a, b];
    }
    if (t1 < 1) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.length >= 2 && l.some((q, i) => i && Math.hypot(q[0] - l[0][0], q[1] - l[0][1]) > 0.5));
}

/** Sutherland-Hodgman against an axis-aligned rectangle (keeps the winding). */
function clipRing(ring, R) {
  let poly = ring;
  const edges = [
    [(q) => q[0] >= R[0], (a, b) => [R[0], a[1] + ((b[1] - a[1]) * (R[0] - a[0])) / (b[0] - a[0])]],
    [(q) => q[0] <= R[2], (a, b) => [R[2], a[1] + ((b[1] - a[1]) * (R[2] - a[0])) / (b[0] - a[0])]],
    [(q) => q[1] >= R[1], (a, b) => [a[0] + ((b[0] - a[0]) * (R[1] - a[1])) / (b[1] - a[1]), R[1]]],
    [(q) => q[1] <= R[3], (a, b) => [a[0] + ((b[0] - a[0]) * (R[3] - a[1])) / (b[1] - a[1]), R[3]]],
  ];
  for (const [inside, cut] of edges) {
    if (!poly.length) break;
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) next.push(cut(a, b));
    }
    poly = next;
  }
  // drop repeated points
  const out = [];
  for (const q of poly) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l[0] - q[0]) > 0.05 || Math.abs(l[1] - q[1]) > 0.05) out.push(q);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 0.05 && Math.abs(out[0][1] - out[out.length - 1][1]) < 0.05) out.pop();
  return out;
}

const mv = (q, P) => [r1(q[0] + P.dx), r1(q[1] + P.dz)];
const rectMoved = (P) => [P.rect[0] + P.dx, P.rect[1] + P.dz, P.rect[2] + P.dx, P.rect[3] + P.dz];

/** Small deterministic hash -> [0, 1). */
function hash01(a, b) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ compose

function compose(full) {
  const pieces = [{ key: CORE.key, rect: CORE.rect, dx: 0, dz: 0 }, ...ISLANDS];
  const out = { buildings: [], roads: [], areas: [], waterways: [], trees: [], pois: [], buildingParts: [], landmarks: {} };
  const stats = { droppedEdgeBuildings: {}, kept: {} };

  for (const P of pieces) {
    const R = P.rect;
    let nb = 0;
    let edge = 0;
    for (const b of full.buildings) {
      const inAll = b.p.every((q) => inRect(q, R));
      if (inAll) {
        out.buildings.push({ ...b, p: b.p.map((q) => mv(q, P)) });
        nb++;
      } else if (b.p.some((q) => inRect(q, R))) edge++;
    }
    for (const b of full.buildingParts || []) if (b.p.every((q) => inRect(q, R))) out.buildingParts.push({ ...b, p: b.p.map((q) => mv(q, P)) });
    for (const r of full.roads) for (const l of clipLine(r.p, R)) out.roads.push({ ...r, p: l.map((q) => mv(q, P)) });
    for (const w of full.waterways || []) for (const l of clipLine(w.p, R)) out.waterways.push({ ...w, p: l.map((q) => mv(q, P)) });
    for (const a of full.areas) {
      const ring = clipRing(a.p, R);
      if (ring.length >= 3 && Math.abs(shoelace(ring)) >= 1) out.areas.push({ ...a, p: ring.map((q) => mv(q, P)) });
    }
    for (const t of full.trees) if (inRect(t, R)) out.trees.push(mv(t, P));
    for (const poi of full.pois) if (inRect([poi.x, poi.z], R)) out.pois.push({ ...poi, x: r1(poi.x + P.dx), z: r1(poi.z + P.dz) });
    stats.kept[P.key] = nb;
    stats.droppedEdgeBuildings[P.key] = edge;
  }

  // landmarks: move with the rectangle that holds their point; drop the rest
  const kept = new Set(out.buildings.map((b) => b.id));
  for (const [k, l] of Object.entries(full.landmarks)) {
    const P = pieces.find((pc) => inRect([l.x, l.z], pc.rect));
    if (!P) continue;
    const isl = P !== pieces[0];
    const half = Math.min(P.rect[2] - P.rect[0], P.rect[3] - P.rect[1]) / 2;
    let r = isl ? Math.min(l.r, Math.round(half)) : l.r;
    if (!isl) {
      // the HUD names the place you are in when within 1.2 r: keep big downtown landmarks
      // (the Home Office campus, the greenway) from reaching past mid-gap into an island
      const R = P.rect;
      for (const I of ISLANDS) {
        const d = I.side === 'west' ? l.x - R[0] : I.side === 'east' ? R[2] - l.x : I.side === 'south' ? R[3] - l.z : l.z - R[1];
        r = Math.min(r, Math.floor((d + GAP / 2) / 1.2));
      }
    }
    out.landmarks[k] = { ...l, x: r1(l.x + P.dx), z: r1(l.z + P.dz), r, ids: l.ids.filter((id) => kept.has(id)) };
  }
  stats.droppedLandmarks = Object.keys(full.landmarks).filter((k) => !out.landmarks[k]);

  // connectors + countryside in each gap
  const core = CORE.rect;
  let synthId = -1;
  const connectors = [];
  const gaps = [];
  for (const I of ISLANDS) {
    const IR = rectMoved(I);
    // gap rectangle: between the facing edges, across the overlap of the two spans
    const G =
      I.side === 'west' ? [IR[2], Math.max(IR[1], core[1]), core[0], Math.min(IR[3], core[3])]
      : I.side === 'east' ? [core[2], Math.max(IR[1], core[1]), IR[0], Math.min(IR[3], core[3])]
      : I.side === 'south' ? [Math.max(IR[0], core[0]), core[3], Math.min(IR[2], core[2]), IR[1]]
      : [Math.max(IR[0], core[0]), IR[3], Math.min(IR[2], core[2]), core[1]];
    if (!(G[2] - G[0] > 1 && G[3] - G[1] > 1)) throw new Error(`${I.key}: island does not face the core (gap ${G})`);
    const horiz = I.side === 'west' || I.side === 'east'; // connector runs along x
    // the island edge and the core edge the connector must touch
    const iEdge = I.side === 'west' ? IR[2] : I.side === 'east' ? IR[0] : I.side === 'south' ? IR[1] : IR[3];
    const cEdge = I.side === 'west' ? core[0] : I.side === 'east' ? core[2] : I.side === 'south' ? core[3] : core[1];
    const A = horiz ? 0 : 1; // axis across the gap
    const endOn = (roads, id, edge) => {
      for (const r of roads) {
        if (r.id !== id) continue;
        for (const q of [r.p[0], r.p[r.p.length - 1]]) if (Math.abs(q[A] - edge) < 0.6) return { r, q };
      }
      return null;
    };
    for (const c of I.connect) {
      const a = endOn(out.roads, c.island, iEdge);
      const b = endOn(out.roads, c.core, cEdge);
      if (!a || !b) throw new Error(`${I.key}: connector roads ${c.island} / ${c.core} do not end on the facing edges`);
      const p0 = a.q;
      const p3 = b.q;
      const s = Math.sign(p3[A] - p0[A]);
      const span = Math.abs(p3[A] - p0[A]);
      const lead = (q, d) => (horiz ? [r1(q[0] + d), q[1]] : [q[0], r1(q[1] + d)]);
      // straight when lined up, else a gentle S-bend over the middle half of the gap
      const pts = Math.abs(p0[1 - A] - p3[1 - A]) < 0.5 ? [p0, p3] : [p0, lead(p0, s * span * 0.25), lead(p3, -s * span * 0.25), p3];
      const road = { id: synthId--, k: b.r.k, n: b.r.n || a.r.n, w: Math.max(b.r.w, Math.min(a.r.w, b.r.w + 4)), p: pts };
      out.roads.push(road);
      connectors.push({ island: I.key, from: p0, to: p3, k: road.k, w: road.w });
    }
    gaps.push(G);
  }

  // bounds = composed extent + margin
  const all = [core, ...ISLANDS.map(rectMoved)];
  const bounds = {
    minX: r1(Math.min(...all.map((R) => R[0])) - BOUNDS_MARGIN),
    minZ: r1(Math.min(...all.map((R) => R[1])) - BOUNDS_MARGIN),
    maxX: r1(Math.max(...all.map((R) => R[2])) + BOUNDS_MARGIN),
    maxZ: r1(Math.max(...all.map((R) => R[3])) + BOUNDS_MARGIN),
  };

  // countryside: everything inside the bounds that is not a real-map piece. A grass base
  // (merged runs of free PATCH cells) with irregular wood blobs and a few park meadows on top;
  // denser in the gaps between the islands and downtown so they read as woodland, lighter
  // around the outside. Roads are drawn over areas and trees keep clear of roads.
  const pad = 4;
  const busy = (x0, z0, x1, z1) => all.some((R) => x0 < R[2] + pad && x1 > R[0] - pad && z0 < R[3] + pad && z1 > R[1] - pad);
  const inGap = (x, z) => gaps.some((G) => x >= G[0] && x <= G[2] && z >= G[1] && z <= G[3]);
  const nx = Math.ceil((bounds.maxX - bounds.minX) / PATCH);
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / PATCH);
  const ccw = (ring) => (shoelace(ring) > 0 ? ring.reverse() : ring); // data winding: shoelace < 0
  let blobs = 0;
  for (let j = 0; j < nz; j++) {
    const z0 = bounds.minZ + j * PATCH;
    const z1 = Math.min(bounds.maxZ, z0 + PATCH);
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      const x0 = bounds.minX + i * PATCH;
      const x1 = Math.min(bounds.maxX, x0 + PATCH);
      const free = i < nx && !busy(x0, z0, x1, z1);
      if (free && run < 0) run = i;
      if (!free && run >= 0) {
        const rx0 = bounds.minX + run * PATCH;
        out.areas.push({ k: 'grass', p: ccw([[r1(rx0), r1(z0)], [r1(x0), r1(z0)], [r1(x0), r1(z1)], [r1(rx0), r1(z1)]]) });
        run = -1;
      }
      if (!free) continue;
      const h = (n) => hash01(i * 7919 + j * 104729 + 17, n);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const gap = inGap(cx, cz);
      if (h(1) > (gap ? 0.75 : 0.35)) continue;
      const k = h(2) < (gap ? 0.1 : 0.2) ? 'park' : 'wood';
      const rad = PATCH * (0.3 + h(3) * 0.17);
      const room = PATCH / 2 - rad - 2;
      const bx = cx + (h(4) - 0.5) * 2 * room;
      const bz = cz + (h(5) - 0.5) * 2 * room;
      const n = 9;
      const ring = [];
      for (let v = 0; v < n; v++) {
        const a = (v / n) * Math.PI * 2;
        const rr = rad * (0.78 + 0.22 * h(10 + v));
        ring.push([r1(bx + Math.cos(a) * rr), r1(bz + Math.sin(a) * rr)]);
      }
      out.areas.push({ k, p: ccw(ring) });
      blobs++;
    }
  }
  stats.countryside = blobs;

  const meta = {
    ...full.meta,
    bounds,
    composition: {
      note: 'Compact designed layout: only the downtown core is at its real position; the islands are moved real-map cut-outs (scripts/compose-map.mjs).',
      source: 'data-raw/bentonville-osm-full.json',
      sourceBounds: full.meta.bounds,
      core: { key: CORE.key, rect: CORE.rect },
      islands: ISLANDS.map((I) => ({ key: I.key, srcRect: I.rect, dx: I.dx, dz: I.dz, rect: rectMoved(I) })),
      gap: GAP,
      connectors,
    },
  };
  meta.counts = {
    ...full.meta.counts,
    buildings: out.buildings.length,
    roads: out.roads.length,
    areas: out.areas.length,
    waterways: out.waterways.length,
    trees: out.trees.length,
    pois: out.pois.length,
    buildingParts: out.buildingParts.length,
    landmarksFound: Object.values(out.landmarks).filter((l) => l.found).length,
  };
  for (const k of ['heightSource', 'roofs', 'bridges', 'treeNodes', 'treeRows', 'treeRowPts']) delete meta.counts[k];
  return {
    data: {
      meta,
      buildings: out.buildings,
      roads: out.roads,
      areas: out.areas,
      waterways: out.waterways,
      trees: out.trees,
      pois: out.pois,
      landmarks: out.landmarks,
      buildingParts: out.buildingParts,
    },
    stats,
  };
}

// ------------------------------------------------------------------ main

async function main() {
  if (!existsSync(IN_FILE)) {
    console.error(`Missing ${path.relative(ROOT, IN_FILE)}: run scripts/fetch-map-data.mjs first.`);
    process.exit(1);
  }
  const full = JSON.parse(await readFile(IN_FILE, 'utf8'));
  const { data, stats } = compose(full);
  const json = JSON.stringify(data);
  await writeFile(OUT_FILE + '.tmp', json + '\n');
  await rename(OUT_FILE + '.tmp', OUT_FILE);

  const c = data.meta.composition;
  const b = data.meta.bounds;
  const section = [
    '<!-- compose-map:start (written by scripts/compose-map.mjs) -->',
    '## Map composition (positions outside downtown are not geographic)',
    '',
    '`public/data/bentonville-osm.json` is a compact, designed layout cut from the full',
    'OpenStreetMap extract (`data-raw/bentonville-osm-full.json`) by `scripts/compose-map.mjs`.',
    `Only the downtown core (game metres x ${c.core.rect[0]}..${c.core.rect[2]}, z ${c.core.rect[1]}..${c.core.rect[3]}) is at its real position.`,
    'The school campuses below are real-map cut-outs moved next to it; the countryside and',
    'connector roads in the gaps between them are invented, and everything else is left out.',
    '',
    ...c.islands.map((I) => `- ${I.key}: source rectangle ${I.srcRect.join(', ')} moved by (${I.dx}, ${I.dz}) m`),
    `- Gap between each island and downtown: ${c.gap} m; map bounds ${b.minX}..${b.maxX} x ${b.minZ}..${b.maxZ}`,
    '<!-- compose-map:end -->',
  ].join('\n');
  let credits = existsSync(CREDITS_FILE) ? await readFile(CREDITS_FILE, 'utf8') : '# Map data\n';
  const re = /<!-- compose-map:start[\s\S]*?<!-- compose-map:end -->/;
  credits = re.test(credits) ? credits.replace(re, section) : credits.replace(/\s*$/, '\n\n' + section + '\n');
  await writeFile(CREDITS_FILE, credits);

  const n = data.meta.counts;
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}: ${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB`);
  console.log(`  bounds x ${b.minX}..${b.maxX} (${((b.maxX - b.minX) / 1000).toFixed(2)} km), z ${b.minZ}..${b.maxZ} (${((b.maxZ - b.minZ) / 1000).toFixed(2)} km)`);
  console.log(`  buildings ${n.buildings}, roads ${n.roads}, areas ${n.areas}, waterways ${n.waterways}, trees ${n.trees}, pois ${n.pois}`);
  console.log(`  buildings kept per piece ${JSON.stringify(stats.kept)}, dropped on edges ${JSON.stringify(stats.droppedEdgeBuildings)}`);
  console.log(`  countryside wood/park blobs: ${stats.countryside}`);
  console.log(`  landmarks dropped (outside every piece): ${stats.droppedLandmarks.join(', ') || 'none'}`);
  for (const k of c.connectors) console.log(`  connector ${k.island}: ${k.k} w${k.w} ${JSON.stringify(k.from)} -> ${JSON.stringify(k.to)}`);
  for (const [k, l] of Object.entries(data.landmarks)) console.log(`  landmark ${k.padEnd(16)} x=${l.x} z=${l.z} r=${l.r} ids=${l.ids.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
