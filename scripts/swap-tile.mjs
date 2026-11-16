#!/usr/bin/env node
// Replaces ONE tile of the composed game map without re-fetching the whole source map.
//
//   node scripts/fetch-map-data.mjs --bbox S,W,N,E --raw data-raw/patch-<key> --out data-raw/patch-<key>.json
//   node scripts/swap-tile.mjs --tile <key> --replaces <oldKey> --patch data-raw/patch-<key>.json
//
// The tile's cell and source point come from TILES in scripts/compose-map.mjs (edit that
// first). Everything inside the old tile's cell is removed from public/data/bentonville-osm.json
// (buildings, building parts, real roads and their extended ends, areas, waterways, trees, POIs,
// the old landmark); the new tile is cut from the patch with compose-map's own composeTile()
// and moved into the cell; meta.composition / counts and credits/map-data.md are updated.
// The gap / ring streets (negative ids) are kept. A later full `npm run fetch-map` (whose
// BBOX includes the new tile) produces the same layout from scratch.

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tilePieces, composeTile, GAP } from './compose-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_FILE = path.join(ROOT, 'public', 'data', 'bentonville-osm.json');
const CREDITS_FILE = path.join(ROOT, 'credits', 'map-data.md');

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : null;
};
const key = arg('--tile');
const oldKey = arg('--replaces');
const patchFile = arg('--patch');
if (!key || !oldKey || !patchFile) {
  console.error('usage: node scripts/swap-tile.mjs --tile <key> --replaces <oldKey> --patch <file>');
  process.exit(1);
}

const map = JSON.parse(await readFile(MAP_FILE, 'utf8'));
const patch = JSON.parse(await readFile(path.resolve(ROOT, patchFile), 'utf8'));
const P = tilePieces().find((p) => p.key === key);
if (!P) throw new Error(`no tile ${key} in compose-map TILES`);
const tiles = map.meta.composition.tiles;
const old = tiles.find((t) => t.key === oldKey);
if (!old) throw new Error(`the map has no tile ${oldKey}`);
if (old.col !== P.col || old.row !== P.row) throw new Error(`${key} must take ${oldKey}'s cell (${old.col}, ${old.row})`);

// ---- clear the old cell (its rect, plus the half street where real road ends were extended)
const G = old.rect;
const pad = GAP / 2 + 0.7;
const inG = (q, m = 0.05) => q[0] >= G[0] - m && q[0] <= G[2] + m && q[1] >= G[1] - m && q[1] <= G[3] + m;
const before = {};
for (const k of ['buildings', 'buildingParts', 'roads', 'areas', 'waterways', 'trees', 'pois']) before[k] = (map[k] || []).length;
map.buildings = map.buildings.filter((b) => !b.p.every((q) => inG(q)));
map.buildingParts = (map.buildingParts || []).filter((b) => !b.p.every((q) => inG(q)));
map.roads = map.roads.filter((r) => r.id < 0 || !r.p.every((q) => inG(q, pad)));
map.areas = map.areas.filter((a) => !a.p.every((q) => inG(q)));
map.waterways = (map.waterways || []).filter((w) => !w.p.every((q) => inG(q)));
map.trees = map.trees.filter((t) => !inG(t));
map.pois = map.pois.filter((p) => !inG([p.x, p.z]));
delete map.landmarks[oldKey];

// ---- cut the new tile out of the patch, into the same cell
const out = { buildings: [], roads: [], areas: [], waterways: [], trees: [], pois: [], buildingParts: [] };
const stats = { droppedEdgeBuildings: {}, kept: {}, extended: 0 };
composeTile(patch, P, out, stats);
for (const k of Object.keys(out)) map[k] = (map[k] || []).concat(out[k]);
const kept = new Set(out.buildings.map((b) => b.id));
let lm = null;
for (const [k, l] of Object.entries(patch.landmarks)) {
  const R = P.rect;
  if (!(l.x >= R[0] && l.x <= R[2] && l.z >= R[1] && l.z <= R[3])) continue;
  const r = Math.min(l.r, Math.round(Math.min(R[2] - R[0], R[3] - R[1]) / 2));
  map.landmarks[k] = { ...l, x: Math.round((l.x + P.dx) * 10) / 10, z: Math.round((l.z + P.dz) * 10) / 10, r, ids: l.ids.filter((id) => kept.has(id)) };
  if (k === key) lm = map.landmarks[k];
}
if (!lm) throw new Error(`the patch has no ${key} landmark inside the tile`);

// ---- metadata
const i = tiles.indexOf(old);
tiles[i] = { key: P.key, col: P.col, row: P.row, srcRect: P.rect, dx: P.dx, dz: P.dz, rect: P.game };
const n = map.meta.counts;
for (const k of ['buildings', 'roads', 'areas', 'waterways', 'trees', 'pois', 'buildingParts']) n[k] = map[k].length;
n.landmarksFound = Object.values(map.landmarks).filter((l) => l.found).length;
map.meta.composition.swapped = { ...(map.meta.composition.swapped || {}), [key]: { replaced: oldKey, patch: path.relative(ROOT, path.resolve(ROOT, patchFile)), fetched: patch.meta.generated } };

const json = JSON.stringify(map);
await writeFile(MAP_FILE + '.tmp', json + '\n');
await rename(MAP_FILE + '.tmp', MAP_FILE);

// credits: the composition section lists every tile's source rectangle
let credits = await readFile(CREDITS_FILE, 'utf8');
const line = (T) => `- ${T.key}: source rectangle ${T.srcRect.join(', ')} moved by (${T.dx}, ${T.dz}) m`;
const re = new RegExp(`^- ${oldKey}: source rectangle .*$`, 'm');
credits = re.test(credits) ? credits.replace(re, line(tiles[i])) : credits;
await writeFile(CREDITS_FILE, credits);

console.log(`Swapped ${oldKey} -> ${key} in ${path.relative(ROOT, MAP_FILE)}`);
for (const k of Object.keys(before)) console.log(`  ${k.padEnd(14)} ${before[k]} -> ${map[k].length}`);
console.log(`  kept ${stats.kept[key]} buildings (dropped ${stats.droppedEdgeBuildings[key]} on the tile edge), extended ${stats.extended} road ends`);
console.log(`  landmark ${key} x=${lm.x} z=${lm.z} r=${lm.r} ids=${lm.ids.length}`);
