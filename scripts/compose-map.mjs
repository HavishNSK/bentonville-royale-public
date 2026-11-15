#!/usr/bin/env node
// Composes the compact game map from the full real-geography map.
//
//   node scripts/compose-map.mjs        (npm run compose-map; `npm run fetch-map` runs it after the fetch)
//
// Input:  data-raw/bentonville-osm-full.json   (scripts/fetch-map-data.mjs, 10.8 x 6 km, gitignored)
// Output: public/data/bentonville-osm.json      (what the game loads)
//         credits/map-data.md                   (the "Map composition" section is replaced)
//
// The real POIs are kilometres apart (Bentonville West High is ~8 km from the Square), so
// the game map is a designed TILE PACK, not real distances:
//   - TILES: a rectangle around each POI is cut out of the real map (sized to the POI's key
//     buildings) and translated into a 3 x 3 grid. Real neighbours stay neighbours where
//     possible (Crystal Bridges north, the Home Office south-east, ...), the Square is in
//     the middle, and neighbouring tile centres are ~270-310 m apart (~30-45 s of running).
//   - STREETS: every gap between tiles is exactly one street wide (GAP m). A synthetic road
//     runs down every gap and around the outside, and the cut ends of real roads are
//     extended onto it, so every tile is bordered by streets and the network is continuous.
//   - Everything outside the tiles is dropped. No synthetic countryside.
// Clipping: roads, paths, waterways and land-cover areas are clipped to their tile
// (Liang-Barsky / Sutherland-Hodgman); buildings and building parts that cross a tile edge
// are dropped rather than cut; trees, POIs and landmarks move with their tile. Building
// heights (Overture) are baked into each building, so they move too. Nothing is rotated.
// No position on this map matches the real world, so meta.composition has no `core` (the
// optional Google 3D tiles view turns itself off for it).
//
// Deterministic: same input -> byte-identical output. Tweak the layout in the table below.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IN_FILE = path.join(ROOT, 'data-raw', 'bentonville-osm-full.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'bentonville-osm.json');
const CREDITS_FILE = path.join(ROOT, 'credits', 'map-data.md');

// ------------------------------------------------------------------ layout (edit me)

const GAP = 20; // m between tiles = one street (its road ribbon + sidewalks fill it)
const STREET = { k: 'tertiary', w: 9, n: '' }; // synthetic gap / ring street
const BOUNDS_MARGIN = 14; // m of plain ground beyond the outer ring street's centre line

// Grid: column widths (west -> east) and row heights (north -> south), in metres. Every
// tile is exactly its cell, so the cell sizes come from the biggest thing each column / row
// must hold: West High's main building (310 m) plus its iconic north parking lots (the tile
// runs from the lots at z -662 to the school's south wall), the Crystal Bridges museum
// (332 m long), Bentonville High's two buildings (228 x 265 m).
const COLS = [330, 250, 250];
const ROWS = [345, 230, 325];
// Square tile centred on the game origin.
const ORIGIN = { x: -(COLS[0] + GAP + COLS[1] / 2), z: -(ROWS[0] + GAP + ROWS[1] / 2) };

// One tile per cell: `key` (a landmark / DROP_ZONES key), `col`, `row`, and `src` = the
// real-map point (full-map metres, x east, z south) that lands on the cell centre.
// West High and Bentonville High share the south row so only that row is tall.
const TILES = [
  { key: 'compton_gardens', col: 0, row: 0, src: [96, -376] },
  { key: 'crystal_bridges', col: 1, row: 0, src: [469, -1073] },
  { key: 'memorial_park', col: 2, row: 0, src: [1454, -385] },
  { key: 'market_8th', col: 0, row: 1, src: [860, 845] },
  { key: 'square', col: 1, row: 1, src: [50, 10] },
  { key: 'momentary', col: 2, row: 1, src: [570, 690] },
  { key: 'bentonville_west', col: 0, row: 2, src: [-7979, -509.5] },
  { key: 'bentonville_high', col: 1, row: 2, src: [1223, 2398] },
  { key: 'home_office', col: 2, row: 2, src: [1466, 1070] },
];
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
// ------------------------------------------------------------------ compose

const cellX = (c) => ORIGIN.x + COLS.slice(0, c).reduce((s, w) => s + w + GAP, 0);
const cellZ = (r) => ORIGIN.z + ROWS.slice(0, r).reduce((s, h) => s + h + GAP, 0);

/** Tile -> { key, rect (source), dx, dz, game } with game = the cell in game metres. */
function tilePieces() {
  const pieces = TILES.map((t) => {
    const w = COLS[t.col];
    const h = ROWS[t.row];
    const gx = cellX(t.col);
    const gz = cellZ(t.row);
    const sx = t.src[0] - w / 2;
    const sz = t.src[1] - h / 2;
    return { key: t.key, col: t.col, row: t.row, rect: [sx, sz, sx + w, sz + h], dx: r1(gx - sx), dz: r1(gz - sz), game: [gx, gz, gx + w, gz + h] };
  });
  // source rectangles must not overlap (a building would appear twice)
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i].rect;
      const b = pieces[j].rect;
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) throw new Error(`source tiles overlap: ${pieces[i].key} / ${pieces[j].key}`);
    }
  return pieces;
}

function compose(full) {
  const pieces = tilePieces();
  const out = { buildings: [], roads: [], areas: [], waterways: [], trees: [], pois: [], buildingParts: [], landmarks: {} };
  const stats = { droppedEdgeBuildings: {}, kept: {}, extended: 0 };

  const W = COLS.reduce((s, w) => s + w, 0) + GAP * (COLS.length - 1);
  const H = ROWS.reduce((s, h) => s + h, 0) + GAP * (ROWS.length - 1);
  const ext = [ORIGIN.x, ORIGIN.z, ORIGIN.x + W, ORIGIN.z + H]; // tiles' outer edge
  const half = GAP / 2;
  // street centre lines: between columns / rows and the outer ring
  const xs = [ext[0] - half, ...COLS.slice(0, -1).map((_, c) => cellX(c) + COLS[c] + half), ext[2] + half];
  const zs = [ext[1] - half, ...ROWS.slice(0, -1).map((_, r) => cellZ(r) + ROWS[r] + half), ext[3] + half];

  for (const P of pieces) {
    const R = P.rect;
    const G = P.game;
    let nb = 0;
    let edge = 0;
    for (const b of full.buildings) {
      if (b.p.every((q) => inRect(q, R))) {
        out.buildings.push({ ...b, p: b.p.map((q) => mv(q, P)) });
        nb++;
      } else if (b.p.some((q) => inRect(q, R))) edge++;
    }
    for (const b of full.buildingParts || []) if (b.p.every((q) => inRect(q, R))) out.buildingParts.push({ ...b, p: b.p.map((q) => mv(q, P)) });
    for (const r of full.roads)
      for (const l of clipLine(r.p, R)) {
        const p = l.map((q) => mv(q, P));
        // a road cut by the tile edge runs on to the street in the gap
        if (!PATH_KINDS.has(r.k)) {
          const reach = (q) => {
            if (Math.abs(q[0] - G[0]) < 0.6) return [r1(q[0] - half), q[1]];
            if (Math.abs(q[0] - G[2]) < 0.6) return [r1(q[0] + half), q[1]];
            if (Math.abs(q[1] - G[1]) < 0.6) return [q[0], r1(q[1] - half)];
            if (Math.abs(q[1] - G[3]) < 0.6) return [q[0], r1(q[1] + half)];
            return null;
          };
          const a = reach(p[0]);
          const b = reach(p[p.length - 1]);
          if (a) p.unshift(a), stats.extended++;
          if (b) p.push(b), stats.extended++;
        }
        out.roads.push({ ...r, p });
      }
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

  // landmarks: move with the tile that holds their point (radius kept inside the tile)
  const kept = new Set(out.buildings.map((b) => b.id));
  for (const [k, l] of Object.entries(full.landmarks)) {
    const P = pieces.find((pc) => inRect([l.x, l.z], pc.rect));
    if (!P) continue;
    const r = Math.min(l.r, Math.round(Math.min(P.rect[2] - P.rect[0], P.rect[3] - P.rect[1]) / 2));
    out.landmarks[k] = { ...l, x: r1(l.x + P.dx), z: r1(l.z + P.dz), r, ids: l.ids.filter((id) => kept.has(id)) };
  }
  stats.droppedLandmarks = Object.keys(full.landmarks).filter((k) => !out.landmarks[k]);
  for (const t of TILES) if (!out.landmarks[t.key]) throw new Error(`tile ${t.key}: its landmark is not inside the tile`);

  // synthetic streets: one down every gap and around the outside (full length, so they cross)
  let synthId = -1;
  const streets = [];
  for (const x of xs) streets.push([[r1(x), r1(zs[0])], [r1(x), r1(zs[zs.length - 1])]]);
  for (const z of zs) streets.push([[r1(xs[0]), r1(z)], [r1(xs[xs.length - 1]), r1(z)]]);
  for (const p of streets) out.roads.push({ id: synthId--, ...STREET, p });

  const m = half + BOUNDS_MARGIN;
  const bounds = { minX: r1(ext[0] - m), minZ: r1(ext[1] - m), maxX: r1(ext[2] + m), maxZ: r1(ext[3] + m) };

  const meta = {
    ...full.meta,
    bounds,
    composition: {
      layout: 'tiles',
      note: 'Designed tile pack: every POI is a real-map cut-out moved into a grid; no position matches the real world (scripts/compose-map.mjs).',
      source: 'data-raw/bentonville-osm-full.json',
      sourceBounds: full.meta.bounds,
      core: null, // nothing is at its real position
      tiles: pieces.map((P) => ({ key: P.key, col: P.col, row: P.row, srcRect: P.rect, dx: P.dx, dz: P.dz, rect: P.game })),
      gap: GAP,
      // the gap / ring streets, as segments (Loot treats them like the old island connectors)
      connectors: streets.map((p) => ({ island: 'street', from: p[0], to: p[1], k: STREET.k, w: STREET.w })),
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
    '## Map composition (positions are not geographic)',
    '',
    '`public/data/bentonville-osm.json` is a compact, designed layout cut from the full',
    'OpenStreetMap extract (`data-raw/bentonville-osm-full.json`) by `scripts/compose-map.mjs`.',
    'Each POI below is a real-map cut-out moved into a 3 x 3 grid of tiles; no position on the',
    `game map matches the real world. The ${c.gap} m streets between the tiles and around the`,
    'outside are invented, and everything else is left out.',
    '',
    ...c.tiles.map((T) => `- ${T.key}: source rectangle ${T.srcRect.join(', ')} moved by (${T.dx}, ${T.dz}) m`),
    `- Map bounds ${b.minX}..${b.maxX} x ${b.minZ}..${b.maxZ}`,
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
  console.log(`  buildings kept per tile ${JSON.stringify(stats.kept)}`);
  console.log(`  dropped on tile edges ${JSON.stringify(stats.droppedEdgeBuildings)}`);
  console.log(`  road ends extended onto the gap streets: ${stats.extended}`);
  console.log(`  landmarks dropped (outside every tile): ${stats.droppedLandmarks.join(', ') || 'none'}`);
  for (const T of c.tiles) console.log(`  tile ${T.key.padEnd(16)} game ${JSON.stringify(T.rect)} moved (${T.dx}, ${T.dz})`);
  for (const [k, l] of Object.entries(data.landmarks)) console.log(`  landmark ${k.padEnd(16)} x=${l.x} z=${l.z} r=${l.r} ids=${l.ids.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
