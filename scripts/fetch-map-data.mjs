#!/usr/bin/env node
// Downloads OpenStreetMap data for Bentonville, AR from the main OSM API
// (/api/0.6/map, tiled), caches every raw response in data-raw/, and writes the
// full real-geography map JSON to data-raw/bentonville-osm-full.json.
// scripts/compose-map.mjs then cuts the compact game map out of it
// (public/data/bentonville-osm.json): `npm run fetch-map` runs both.
//
//   node scripts/fetch-map-data.mjs            # cache-first: no network if all tiles are cached
//   node scripts/fetch-map-data.mjs --refresh  # discard the cache and download again
//   node scripts/fetch-map-data.mjs --bbox S,W,N,E --raw data-raw/patch --out data-raw/patch.json
//       # just one small area (same ORIGIN / processing; no credits rewrite), e.g. a tile
//       # swapped into the composed map by scripts/swap-tile.mjs
//
// Map data usage notes:
//   - `npm run fetch-map` runs this and then compose-map. A full download is ~75 requests
//     (72 tiles + a few relations); MAX_REQUESTS caps one run, so a cold
//     cache needs two runs (the second resumes). Do not lower PAUSE_MS or
//     raise MAX_REQUESTS, and do not run it in parallel (OSM API usage policy).
//   - With a warm cache the run is offline and deterministic: the output is
//     byte-identical, so it is safe to re-run after changing the processing code.
//   - data-raw/ is gitignored. Only public/data/bentonville-osm.json (written by
//     compose-map) and credits/map-data.md are committed; both are rewritten each run
//     (the "Downloaded" date comes from data-raw/fetch-meta.json, not the clock).
//   - A failed download writes no output and keeps the tiles it got; re-run to resume.
//
// Coordinates: local meters around ORIGIN, x = east, z = SOUTH (north is -z),
// equirectangular, rounded to 0.1 m.
// Polygon winding (buildings + areas): counter-clockwise as seen on a north-up
// map (x right, z down), i.e. the shoelace sum  sum(x_i*z_{i+1} - x_{i+1}*z_i)
// is NEGATIVE. No repeated closing point.
//
// Map data (c) OpenStreetMap contributors, ODbL 1.0.

import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
// --bbox / --raw / --out: fetch one small area instead of the whole map (see the header)
const PATCH = !!argOf('--bbox');
const RAW_DIR = argOf('--raw') ? path.resolve(ROOT, argOf('--raw')) : path.join(ROOT, 'data-raw');
const TILE_DIR = path.join(RAW_DIR, 'tiles');
const REL_DIR = path.join(RAW_DIR, 'relations');
const RAW_META = path.join(RAW_DIR, 'fetch-meta.json');
// Full real-geography map (gitignored). scripts/compose-map.mjs turns it into the
// compact game map public/data/bentonville-osm.json (downtown + moved school islands).
const OUT_FILE = argOf('--out') ? path.resolve(ROOT, argOf('--out')) : path.join(ROOT, 'data-raw', 'bentonville-osm-full.json');
const CREDITS_FILE = path.join(ROOT, 'credits', 'map-data.md');

// south, west, north, east. Phase 2 expansion: the original downtown box
// [36.355, -94.23, 36.4, -94.19] grown one tile row south (Bentonville High
// School, ~36.351 -94.196) and eight tile columns west (Bentonville West High /
// Centerton, ~36.378 -94.297). The edges sit on the original 0.01 x 0.009 tile
// grid so the old cached tiles in data-raw/tiles are reused as-is.
// ORIGIN stays at the Square: every existing coordinate is unchanged, and the
// far west edge (~ -10.8 km) is well inside float32 millimetre precision.
// Grown two more tile rows south (to 36.328) for the Bentonville Community Center
// (1101 SW Citizens Circle, ~36.3313 -94.2254), which replaced the Walmart Home Office tile.
const BBOX = PATCH ? argOf('--bbox').split(',').map(Number) : [36.328, -94.31, 36.4, -94.19];
const ORIGIN = { lat: 36.3729, lon: -94.2088 };
const USER_AGENT = 'osm-game-map-fetch/1.0';
const API = 'https://api.openstreetmap.org/api/0.6';
// Tile grid anchored at the SW corner of the bbox. The map call refuses more
// than 50,000 nodes; a tile that is refused is split into quarters.
const TILE_LON = 0.01;
const TILE_LAT = 0.009;
const MAX_SPLIT_DEPTH = 3;
const MAX_REQUESTS = 60; // hard ceiling per run, retries included
const PAUSE_MS = 1100; // pause between requests
const BACKOFF_MS = [15000, 45000]; // on 429 / 509 / 5xx
const MAX_RELATION_FETCHES = 12;

const LANDMARK_NAME_RE = /Walmart|Walton|Home Office|Slaughter Pen|Crystal Bridges|Momentary|Compton|Memorial Park|8th Street Market|Razorback|Courthouse|Square|High School|Community Cent/i;
const POI_KEYS = ['tourism', 'historic', 'amenity', 'shop', 'leisure', 'office'];

// ---------------------------------------------------------------- fetch/cache

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const f4 = (v) => (Math.round(v * 1e4) / 1e4).toFixed(4);

const net = { requests: 0, log: [] };

/** One polite GET with limited retries. Returns { status, text }. */
async function apiGet(url) {
  let last = '';
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (net.requests >= MAX_REQUESTS) throw new Error(`Request budget of ${MAX_REQUESTS} exhausted (last: ${last || 'n/a'})`);
    if (net.requests > 0) await sleep(PAUSE_MS);
    net.requests++;
    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(120000) });
    } catch (e) {
      last = `${e.name}: ${e.message}${e.cause ? ' / ' + (e.cause.code || e.cause.message) : ''}`;
      net.log.push(`${url} -> ${last}`);
      if (attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    const text = await res.text();
    net.log.push(`${url} -> HTTP ${res.status} (${text.length} bytes)`);
    const retriable = res.status === 429 || res.status === 509 || res.status >= 500;
    if (retriable && attempt < BACKOFF_MS.length) {
      last = `HTTP ${res.status} ${text.replace(/\s+/g, ' ').slice(0, 160)}`;
      console.log(`  ${last}; backing off ${BACKOFF_MS[attempt] / 1000}s`);
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    return { status: res.status, text };
  }
  throw new Error(`GET ${url} failed after retries: ${last}`);
}

function tileGrid() {
  const [s, w, n, e] = BBOX;
  const tiles = [];
  for (let lat = s; lat < n - 1e-9; lat += TILE_LAT) {
    for (let lon = w; lon < e - 1e-9; lon += TILE_LON) {
      tiles.push([lat, lon, Math.min(n, lat + TILE_LAT), Math.min(e, lon + TILE_LON)]);
    }
  }
  return tiles;
}
const tileKey = ([s, w, n, e]) => `${f4(w)}_${f4(s)}_${f4(e)}_${f4(n)}`;

/** Loads one tile (cache first). Returns a list of { key, json } - several if the tile had to be split. */
async function loadTile(tile, depth, state) {
  const key = tileKey(tile);
  const file = path.join(TILE_DIR, key + '.json');
  const splitMarker = path.join(TILE_DIR, key + '.split');
  if (existsSync(file)) return [{ key, json: JSON.parse(await readFile(file, 'utf8')) }];
  let split = existsSync(splitMarker);
  if (!split) {
    const [s, w, n, e] = tile;
    const url = `${API}/map.json?bbox=${f4(w)},${f4(s)},${f4(e)},${f4(n)}`;
    console.log(`GET ${url}`);
    const { status, text } = await apiGet(url);
    if (status === 200) {
      const json = JSON.parse(text);
      if (!Array.isArray(json.elements)) throw new Error(`Tile ${key}: response has no elements array`);
      await writeFile(file, text);
      state.fetched++;
      return [{ key, json }];
    }
    if (status === 400 && /too many nodes/i.test(text)) {
      if (depth >= MAX_SPLIT_DEPTH) throw new Error(`Tile ${key}: still too many nodes at split depth ${depth}`);
      await writeFile(splitMarker, text);
      split = true;
    } else {
      throw new Error(`Tile ${key}: HTTP ${status} ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
  }
  const [s, w, n, e] = tile;
  const ml = (s + n) / 2;
  const mo = (w + e) / 2;
  const out = [];
  for (const q of [[s, w, ml, mo], [s, mo, ml, e], [ml, w, n, mo], [ml, mo, n, e]]) out.push(...(await loadTile(q, depth + 1, state)));
  return out;
}

/** Tags that make a multipolygon relation worth completing when some member ways lie outside every tile. */
function relationWanted(tags) {
  if (!tags || tags.type !== 'multipolygon') return false;
  if (tags.building) return true;
  if (/^(wood|water)$/.test(tags.natural || '')) return true;
  if (/^(forest|grass|meadow|recreation_ground)$/.test(tags.landuse || '')) return true;
  if (/^(park|garden|pitch|playground)$/.test(tags.leisure || '')) return true;
  if (tags.amenity === 'parking') return true;
  if (tags.name && (POI_KEYS.some((k) => tags[k]) || LANDMARK_NAME_RE.test(tags.name))) return true;
  return false;
}

async function loadRaw(refresh) {
  if (refresh) {
    await rm(TILE_DIR, { recursive: true, force: true });
    await rm(REL_DIR, { recursive: true, force: true });
    await rm(RAW_META, { force: true });
  }
  await mkdir(TILE_DIR, { recursive: true });
  await mkdir(REL_DIR, { recursive: true });
  const state = { fetched: 0 };

  const parts = [];
  for (const t of tileGrid()) parts.push(...(await loadTile(t, 0, state)));
  parts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // merge + de-duplicate by type/id (keep the newest version if tiles disagree)
  const byKey = new Map();
  const add = (el) => {
    const k = el.type[0] + el.id;
    const prev = byKey.get(k);
    if (!prev || (el.version || 0) > (prev.version || 0)) byKey.set(k, el);
  };
  for (const p of parts) for (const el of p.json.elements) add(el);

  // The map call returns relations with any member in the box, but not member
  // ways that lie wholly outside it. Complete the multipolygons we care about.
  const missing = [];
  for (const el of byKey.values()) {
    if (el.type !== 'relation' || !relationWanted(el.tags)) continue;
    if ((el.members || []).some((m) => m.type === 'way' && !byKey.has('w' + m.ref))) missing.push(el.id);
  }
  missing.sort((a, b) => a - b);
  const relInfo = { incomplete: missing.length, completed: [], skipped: [] };
  let relFetches = 0;
  for (const id of missing) {
    const file = path.join(REL_DIR, id + '.json');
    const skip = path.join(REL_DIR, id + '.skip');
    if (!existsSync(file) && !existsSync(skip)) {
      if (relFetches >= MAX_RELATION_FETCHES) {
        await writeFile(skip, 'over relation fetch cap\n');
      } else {
        relFetches++;
        const url = `${API}/relation/${id}/full.json`;
        console.log(`GET ${url}`);
        const { status, text } = await apiGet(url);
        if (status === 200) {
          await writeFile(file, text);
          state.fetched++;
        } else await writeFile(skip, `HTTP ${status}\n`);
      }
    }
    if (existsSync(file)) {
      for (const el of JSON.parse(await readFile(file, 'utf8')).elements) add(el);
      relInfo.completed.push(id);
    } else relInfo.skipped.push(id);
  }

  let meta = existsSync(RAW_META) ? JSON.parse(await readFile(RAW_META, 'utf8')) : null;
  if (state.fetched > 0 || !meta) {
    meta = {
      source: API,
      fetchedAt: new Date().toISOString(),
      bbox: BBOX,
      userAgent: USER_AGENT,
      tiles: parts.map((p) => p.key),
      relationsCompleted: relInfo.completed,
      relationsSkipped: relInfo.skipped,
      requestsThisRun: net.requests,
    };
    await writeFile(RAW_META, JSON.stringify(meta, null, 2) + '\n');
  }
  console.log(
    state.fetched > 0
      ? `Downloaded ${state.fetched} file(s) in ${net.requests} request(s) from ${API}; ${parts.length} tiles cached in ${path.relative(ROOT, TILE_DIR)}`
      : `Using cached raw data only (${parts.length} tiles, no network requests)`,
  );
  if (relInfo.incomplete) console.log(`  multipolygons reaching outside the tiles: ${relInfo.incomplete} (completed ${relInfo.completed.length}, skipped ${relInfo.skipped.length})`);
  return { raw: { elements: [...byKey.values()] }, meta, relInfo };
}

// ------------------------------------------------------------------- geometry

const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);
const MX = 111320 * COS0; // meters per degree of longitude at the origin
const MZ = 110574; // meters per degree of latitude
const project = (lat, lon) => [(lon - ORIGIN.lon) * MX, -(lat - ORIGIN.lat) * MZ];
const r1 = (v) => Math.round(v * 10) / 10 || 0; // 0.1 m, never -0

// bbox in local meters (note z flips: north edge is minZ)
const CLIP = {
  minX: (BBOX[1] - ORIGIN.lon) * MX,
  maxX: (BBOX[3] - ORIGIN.lon) * MX,
  minZ: -(BBOX[2] - ORIGIN.lat) * MZ,
  maxZ: -(BBOX[0] - ORIGIN.lat) * MZ,
};
const inClip = (p) => p[0] >= CLIP.minX && p[0] <= CLIP.maxX && p[1] >= CLIP.minZ && p[1] <= CLIP.maxZ;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function shoelace(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function centroid(p) {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const u = p[i];
    const v = p[(i + 1) % n];
    const c = u[0] * v[1] - v[0] * u[1];
    a += c;
    cx += (u[0] + v[0]) * c;
    cz += (u[1] + v[1]) * c;
  }
  if (Math.abs(a) < 1e-6) return meanPoint(p);
  return [cx / (3 * a), cz / (3 * a)];
}

function meanPoint(p) {
  let x = 0;
  let z = 0;
  for (const q of p) {
    x += q[0];
    z += q[1];
  }
  return [x / p.length, z / p.length];
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > pt[1] !== b[1] > pt[1] && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// perpendicular distance from p to segment a-b
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  if (l2 === 0) return dist(p, a);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/** Ring simplification: no closing point, drop points < minD apart, drop collinear points. */
function simplifyRing(pts, minD = 0.3, eps = 0.05) {
  let p = pts.slice();
  if (p.length > 1 && dist(p[0], p[p.length - 1]) < 1e-9) p.pop();
  const out = [];
  for (const q of p) if (!out.length || dist(out[out.length - 1], q) >= minD) out.push(q);
  while (out.length > 1 && dist(out[0], out[out.length - 1]) < minD) out.pop();
  p = out;
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length && p.length > 3; i++) {
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[(i + 1) % p.length];
      if (segDist(p[i], a, b) < eps) {
        p.splice(i, 1);
        i--;
        changed = true;
      }
    }
  }
  return p;
}

/** Round a ring, remove duplicates created by rounding, force CCW-on-map winding. */
function finishRing(pts) {
  const out = [];
  for (const q of pts) {
    const r = [r1(q[0]), r1(q[1])];
    if (!out.length || out[out.length - 1][0] !== r[0] || out[out.length - 1][1] !== r[1]) out.push(r);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  if (out.length < 3) return null;
  if (shoelace(out) > 0) out.reverse(); // negative shoelace == CCW with x right / z down
  return out;
}

/** Polyline simplification: drop points < minD apart, then Douglas-Peucker. */
function simplifyLine(pts, minD = 0.3, eps = 0.1) {
  const p = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (!p.length || dist(p[p.length - 1], q) >= minD) p.push(q);
    else if (i === pts.length - 1 && p.length > 1) p[p.length - 1] = q; // keep the true end point
  }
  if (p.length <= 2) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let best = -1;
    let bestD = eps;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(p[i], p[s], p[e]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return p.filter((_, i) => keep[i]);
}

function finishLine(pts) {
  const out = [];
  for (const q of pts) {
    const r = [r1(q[0]), r1(q[1])];
    if (!out.length || out[out.length - 1][0] !== r[0] || out[out.length - 1][1] !== r[1]) out.push(r);
  }
  return out.length >= 2 ? out : null;
}

/** Clip a polyline to the bbox (Liang-Barsky per segment). Returns 0..n polylines. */
function clipLine(pts) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    const tests = [
      [-dx, a[0] - CLIP.minX],
      [dx, CLIP.maxX - a[0]],
      [-dz, a[1] - CLIP.minZ],
      [dz, CLIP.maxZ - a[1]],
    ];
    for (const [p, q] of tests) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else {
        const t = q / p;
        if (p < 0) {
          if (t > t1) ok = false;
          else if (t > t0) t0 = t;
        } else {
          if (t < t0) ok = false;
          else if (t < t1) t1 = t;
        }
      }
      if (!ok) break;
    }
    if (!ok) {
      cur = null;
      continue;
    }
    const s = t0 === 0 ? a : [a[0] + t0 * dx, a[1] + t0 * dz];
    const e = t1 === 1 ? b : [a[0] + t1 * dx, a[1] + t1 * dz];
    if (cur && t0 === 0) cur.push(e);
    else {
      cur = [s, e];
      pieces.push(cur);
    }
    if (t1 < 1) cur = null;
  }
  return pieces;
}

/** Clip a ring to the bbox (Sutherland-Hodgman). */
function clipRing(pts) {
  const edges = [
    [(p) => p[0] >= CLIP.minX, (a, b) => [CLIP.minX, a[1] + ((b[1] - a[1]) * (CLIP.minX - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= CLIP.maxX, (a, b) => [CLIP.maxX, a[1] + ((b[1] - a[1]) * (CLIP.maxX - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= CLIP.minZ, (a, b) => [a[0] + ((b[0] - a[0]) * (CLIP.minZ - a[1])) / (b[1] - a[1]), CLIP.minZ]],
    [(p) => p[1] <= CLIP.maxZ, (a, b) => [a[0] + ((b[0] - a[0]) * (CLIP.maxZ - a[1])) / (b[1] - a[1]), CLIP.maxZ]],
  ];
  let out = pts;
  if (out.every(inClip)) return out;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      const b = src[(i + 1) % src.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia && ib) out.push(b);
      else if (ia && !ib) out.push(cut(a, b));
      else if (!ia && ib) out.push(cut(a, b), b);
    }
    if (out.length < 3) return [];
  }
  return out;
}

// ------------------------------------------------------------------ utilities

/** Deterministic 0..1 pseudo-random value from an OSM id (never Math.random). */
function hash01(id, salt = 0) {
  const n = Number(id);
  let h = ((n % 4294967296) ^ Math.imul(Math.floor(n / 4294967296) + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Parse an OSM length ("12", "12 m", "40 ft", "40'", "12'6\""). Returns meters or null. */
function parseLen(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase().replace(',', '.');
  let m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|'')?)?$/);
  if (m) return +m[1] * 0.3048 + (m[2] ? +m[2] * 0.0254 : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot)?\.?$/);
  if (m) {
    const n = +m[1];
    const out = m[2] && m[2].startsWith('f') ? n * 0.3048 : n;
    return out > 0 && Number.isFinite(out) ? out : null;
  }
  return null;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------- classification

const WOOD_TYPES = new Set(['house', 'detached', 'residential', 'garage', 'garages', 'shed', 'cabin', 'semidetached_house', 'bungalow', 'static_caravan', 'carport']);
const BRICK_TYPES = new Set(['church', 'chapel', 'civic', 'public', 'school', 'university', 'college', 'apartments', 'courthouse', 'government', 'hospital', 'museum', 'library', 'hotel', 'dormitory']);
const METAL_TYPES = new Set(['commercial', 'retail', 'industrial', 'warehouse', 'supermarket', 'office', 'service', 'hangar', 'parking', 'kiosk']);
const ONE_LEVEL_TYPES = new Set(['garage', 'garages', 'shed', 'carport', 'static_caravan', 'bungalow', 'roof', 'hut', 'kiosk']);
const HOUSE_TYPES = new Set(['house', 'detached', 'residential', 'cabin', 'semidetached_house', 'terrace']);
// big single-storey boxes: do not let a huge footprint turn them into 4-storey towers
const LOW_BOX_TYPES = new Set(['retail', 'supermarket', 'warehouse', 'industrial', 'hangar', 'service']);

const INSTITUTIONAL_AMENITY = new Set(['courthouse', 'place_of_worship', 'school', 'university', 'college', 'hospital', 'library', 'townhall']);

function buildingMaterial(t, tags, area) {
  const m = String(tags['building:material'] || '').toLowerCase();
  if (m === 'wood' || m === 'timber') return 'wood';
  if (m === 'brick' || m === 'stone' || m === 'concrete') return 'brick';
  if (m === 'metal' || m === 'steel') return 'metal';
  if (WOOD_TYPES.has(t)) return 'wood';
  if (BRICK_TYPES.has(t)) return 'brick';
  if (METAL_TYPES.has(t)) return 'metal';
  // building=yes etc.: an institutional use tag is a better hint than footprint size
  if (INSTITUTIONAL_AMENITY.has(tags.amenity) || tags.tourism === 'museum' || tags.tourism === 'hotel') return 'brick';
  if (area < 250) return 'wood';
  if (area <= 1200) return 'brick';
  return 'metal';
}

function buildingHeight(id, t, tags, area) {
  const tagH = parseLen(tags.height) ?? parseLen(tags['building:height']);
  const tagLv = parseFloat(tags['building:levels']);
  const hasLv = Number.isFinite(tagLv) && tagLv > 0;
  if (tagH != null) {
    const h = clamp(tagH, 3, 40);
    return { h: r1(h), lv: hasLv ? Math.max(1, Math.round(tagLv)) : Math.max(1, Math.round((h - 1) / 3.5)) };
  }
  if (hasLv) return { h: r1(clamp(tagLv * 3.5 + 1, 3, 40)), lv: Math.max(1, Math.round(tagLv)) };
  const u = hash01(id, 1);
  let lv;
  if (ONE_LEVEL_TYPES.has(t)) lv = 1;
  else if (HOUSE_TYPES.has(t)) lv = u < 0.4 ? 2 : 1;
  else if (area < 400) lv = 1;
  else if (area < 1500) lv = u < 0.5 ? 2 : 1;
  else if (area < 5000) lv = u < 0.4 ? 3 : 2;
  else lv = u < 0.5 ? 4 : 3;
  if (LOW_BOX_TYPES.has(t)) lv = Math.min(lv, 2);
  const jitter = (hash01(id, 2) - 0.5) * 1.2; // +-0.6 m, deterministic per OSM id
  return { h: r1(clamp(lv * 3.5 + 1 + jitter, 3, 40)), lv };
}

const ROAD_WIDTH = {
  motorway: 16, motorway_link: 7, trunk: 15, trunk_link: 7, primary: 14, primary_link: 7,
  secondary: 12, secondary_link: 7, tertiary: 10, tertiary_link: 6, unclassified: 8, residential: 8,
  living_street: 6, service: 5, pedestrian: 5, footway: 2.5, path: 2.5, cycleway: 2.5, track: 3, steps: 2.5,
};

function roadWidth(k, tags) {
  const w = parseLen(tags.width);
  if (w != null) return r1(clamp(w, 1, 40));
  const lanes = parseFloat(tags.lanes);
  if (Number.isFinite(lanes) && lanes > 0) return r1(clamp(lanes * 3.5 + 1, 3, 40));
  return ROAD_WIDTH[k];
}

function areaKind(tags) {
  if (tags.natural === 'water') return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'wood';
  if (tags.leisure === 'pitch') return 'pitch';
  if (tags.leisure === 'garden') return 'garden';
  if (tags.leisure === 'park' || tags.leisure === 'playground' || tags.landuse === 'recreation_ground') return 'park';
  if (tags.amenity === 'parking') return tags.parking === 'underground' ? null : 'parking';
  // landuse=meadow stays 'grass' (as before, for backward compatibility)
  if (tags.landuse === 'grass' || tags.landuse === 'meadow') return 'grass';
  if (tags.natural === 'grassland' || tags.natural === 'heath') return 'meadow';
  if (tags.natural === 'scrub' || tags.natural === 'shrubbery') return 'scrub';
  if (LANDUSE_KINDS.has(tags.landuse)) return tags.landuse;
  return null;
}
const LANDUSE_KINDS = new Set(['residential', 'commercial', 'retail', 'industrial', 'farmland']);
// broad land-use zones first, so the specific covers drawn/looked-up later win
const AREA_ORDER = ['residential', 'commercial', 'retail', 'industrial', 'farmland', 'meadow', 'scrub', 'wood', 'park', 'water', 'parking', 'grass', 'pitch', 'garden'];

// ------------------------------------------------------------ extra building tags

const ROOF_SHAPES = {
  flat: 'flat', gabled: 'gable', gable: 'gable', hipped: 'hip', hip: 'hip', 'half-hipped': 'hip', side_hipped: 'hip',
  pyramidal: 'pyramid', skillion: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'dome', gambrel: 'gambrel',
  mansard: 'mansard', round: 'round', saltbox: 'gable', sawtooth: 'skillion', cone: 'pyramid',
};
// residential-looking footprints get a pitched roof when untagged
const PITCHED_TYPES = new Set(['house', 'detached', 'residential', 'semidetached_house', 'bungalow', 'cabin', 'terrace', 'garage', 'garages', 'shed', 'farm', 'barn', 'church', 'chapel', 'hut', 'static_caravan']);
function roofShape(id, t, tags, area, overture) {
  const tagged = ROOF_SHAPES[String(tags['roof:shape'] || '').toLowerCase()];
  if (tagged) return { roof: tagged, src: 'osm' };
  const ov = overture && ROOF_SHAPES[String(overture.roof || '').toLowerCase()];
  if (ov) return { roof: ov, src: 'overture' };
  const small = area <= (t === 'yes' ? 260 : 450);
  if (small && (PITCHED_TYPES.has(t) || t === 'yes')) return { roof: hash01(id, 3) < 0.6 ? 'gable' : 'hip', src: 'est' };
  return { roof: 'flat', src: 'est' };
}

const NAMED_COLOURS = {
  white: '#f2f2ee', black: '#2b2b2b', grey: '#8f8f8f', gray: '#8f8f8f', lightgrey: '#c8c8c8', lightgray: '#c8c8c8', darkgrey: '#5a5a5a', darkgray: '#5a5a5a',
  silver: '#c0c0c0', red: '#a8443a', darkred: '#7a2a24', maroon: '#6e2a2a', brown: '#7b5a3e', tan: '#c9ae86', beige: '#d9cdb0', cream: '#efe6cc',
  yellow: '#e2c45a', orange: '#d27a3c', green: '#5f8a4e', darkgreen: '#3e5e34', blue: '#4f6f9a', lightblue: '#9fb9d4', navy: '#2e3f5e',
};
function normColour(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, '');
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('');
  return NAMED_COLOURS[s] || null;
}

// ------------------------------------------------------------ Overture heights
// data-raw/overture/buildings.json is written by scripts/fetch-overture.py. When
// present, an OSM building takes its height from the Overture building that
// carries the same OSM id or that overlaps it (IoU >= 0.5 on a 1 m sample grid).

function loadOverture() {
  const file = path.join(RAW_DIR, 'overture', 'buildings.json');
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const list = [];
  for (const b of j.buildings) {
    for (const ring of b.rings) {
      const p = ring.map(([lon, lat]) => project(lat, lon));
      if (p.length > 1 && dist(p[0], p[p.length - 1]) < 1e-6) p.pop();
      if (p.length < 3) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const q of p) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
      list.push({ b, p, minX, maxX, minZ, maxZ, area: Math.abs(shoelace(p)) });
    }
  }
  const byOsm = new Map();
  for (const o of list) if (o.b.osm) byOsm.set(o.b.osm.split('@')[0], o);
  const CELL = 50;
  const grid = new Map();
  for (const o of list) {
    for (let gx = Math.floor(o.minX / CELL); gx <= Math.floor(o.maxX / CELL); gx++) {
      for (let gz = Math.floor(o.minZ / CELL); gz <= Math.floor(o.maxZ / CELL); gz++) {
        const k = gx + ',' + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(o);
      }
    }
  }
  const near = (minX, maxX, minZ, maxZ) => {
    const out = new Set();
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) for (let gz = Math.floor(minZ / CELL); gz <= Math.floor(maxZ / CELL); gz++) for (const o of grid.get(gx + ',' + gz) || []) out.add(o);
    return [...out];
  };
  return { release: j.release, fetchedAt: j.fetchedAt, count: j.count, byOsm, near };
}

/** Intersection-over-union of two rings, estimated on a sample grid (~1 m). */
function iou(a, b) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const q of a.concat(b)) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
  const step = Math.max(1, Math.sqrt(((maxX - minX) * (maxZ - minZ)) / 4000));
  let inter = 0;
  let uni = 0;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      const ia = pointInPoly([x, z], a);
      const ib = pointInPoly([x, z], b);
      if (ia || ib) uni++;
      if (ia && ib) inter++;
    }
  }
  return uni ? inter / uni : 0;
}

/** Overture height for an OSM building: { h, src, floors, ov } or null. */
function overtureMatch(OV, osmKey, ring) {
  if (!OV) return null;
  let o = OV.byOsm.get(osmKey);
  if (!o) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const q of ring) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
    let best = 0.5;
    for (const c of OV.near(minX, maxX, minZ, maxZ)) {
      if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
      const v = iou(ring, c.p);
      if (v >= best) { best = v; o = c; }
    }
  }
  return o || null;
}

// ------------------------------------------------------------------ landmarks
// `pats` are tried in order; the first pattern with a usable match gives the
// position. `est` is a general-knowledge fallback used only when nothing in the
// data matches (found:false). `campus` (m): also claim building=school
// footprints whose centroid is that close to the match (OSM maps Bentonville
// High as a single node, not a campus polygon).

const LANDMARKS = [
  { key: 'square', n: 'Bentonville Square', pats: [/bentonville (town |city |downtown )?square/i, /^(the |downtown |town )?square$/i, /confederate (monument|park)|square park/i], est: { lat: 36.3729, lon: -94.2088, r: 45 } },
  { key: 'courthouse', n: 'Benton County Courthouse', pats: [/^benton county court ?house$/i, /benton county court ?house/i], est: { lat: 36.37285, lon: -94.20805, r: 30 } },
  { key: 'walmart_museum', n: 'The Walmart Museum', pats: [/walmart museum/i, /walton'?s 5\s?(&|and)\s?10/i, /walton'?s 5/i], est: { lat: 36.3729, lon: -94.2094, r: 25 } },
  { key: 'crystal_bridges', n: 'Crystal Bridges Museum of American Art', pats: [/^crystal bridges museum of american art$/i, /crystal bridges museum/i, /^crystal bridges$/i], est: { lat: 36.3822, lon: -94.2028, r: 180 } },
  { key: 'momentary', n: 'The Momentary', pats: [/^the momentary$/i, /momentary/i], est: { lat: 36.3639, lon: -94.2062, r: 80 } },
  { key: 'home_office', n: 'Walmart Home Office', pats: [/walmart (new )?home office/i, /walmart.*(campus|headquarters)/i, /home office/i], est: { lat: 36.3605, lon: -94.1945, r: 450 } },
  // 1101 SW Citizens Circle (OSM way 751973534): 80,000 sq ft recreation centre in Citizens Park
  { key: 'community_center', n: 'Bentonville Community Center', pats: [/^bentonville community cent(er|re)$/i, /bentonville community cent(er|re)/i], est: { lat: 36.3309, lon: -94.2256, r: 120 } },
  { key: 'market_8th', n: '8th Street Market', pats: [/(8th|eighth) st(reet|\.)? market/i], est: { lat: 36.3637, lon: -94.2019, r: 60 } },
  { key: 'slaughter_pen', n: 'Slaughter Pen Trails', line: true, pats: [/slaughter ?pen/i], est: { lat: 36.3905, lon: -94.2125, r: 500 } },
  { key: 'compton_gardens', n: 'Compton Gardens', pats: [/^compton gardens( (and|&) (arboretum|conference center))?$/i, /compton gardens/i], est: { lat: 36.3777, lon: -94.2117, r: 110 } },
  { key: 'memorial_park', n: 'Memorial Park', pats: [/^memorial park$/i, /memorial park/i], est: { lat: 36.3765, lon: -94.1935, r: 250 } },
  { key: 'bentonville_high', n: 'Bentonville High School', pats: [/^bentonville high school$/i, /^bentonville high$/i, /^bentonville high school\b/i], est: { lat: 36.3515, lon: -94.1965, r: 250 }, campus: 260 },
  { key: 'bentonville_west', n: 'Bentonville West High School', pats: [/^bentonville west high school$/i, /^bentonville west high\b/i, /^bentonville west\b/i], est: { lat: 36.378, lon: -94.297, r: 250 }, campus: 260 },
  { key: 'greenway', n: 'Razorback Regional Greenway', line: true, pats: [/razorback (regional )?greenway/i], est: { lat: 36.38, lon: -94.211, r: 400 } },
];

// ------------------------------------------------------------------- pipeline

function build(raw, rawMeta, OV) {
  // ---- index elements (the response can list an element twice: body + skel)
  const nodes = new Map();
  const ways = new Map();
  const rels = new Map();
  for (const el of raw.elements) {
    const map = el.type === 'node' ? nodes : el.type === 'way' ? ways : rels;
    const prev = map.get(el.id);
    if (!prev) map.set(el.id, el);
    else if (el.tags && !prev.tags) map.set(el.id, { ...prev, ...el });
  }
  const sortedIds = (m) => [...m.keys()].sort((a, b) => a - b);

  const nodeXZ = (id) => {
    const n = nodes.get(id);
    return n ? project(n.lat, n.lon) : null;
  };
  const wayPts = (w) => {
    const out = [];
    for (const id of w.nodes || []) {
      const p = nodeXZ(id);
      if (p) out.push(p);
    }
    return out;
  };
  const wayClosed = (w) => w.nodes && w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1];

  /** Join member ways end-to-end into closed rings of node ids. */
  function assembleRings(wayIds) {
    const segs = [];
    for (const id of wayIds) {
      const w = ways.get(id);
      if (w && w.nodes && w.nodes.length >= 2) segs.push(w.nodes.slice());
    }
    const rings = [];
    while (segs.length) {
      let cur = segs.shift();
      let progressed = true;
      while (cur[0] !== cur[cur.length - 1] && progressed) {
        progressed = false;
        const tail = cur[cur.length - 1];
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          if (s[0] === tail) cur = cur.concat(s.slice(1));
          else if (s[s.length - 1] === tail) cur = cur.concat(s.slice(0, -1).reverse());
          else continue;
          segs.splice(i, 1);
          progressed = true;
          break;
        }
      }
      if (cur.length >= 4 && cur[0] === cur[cur.length - 1]) rings.push(cur);
    }
    return rings;
  }
  const relOuterRings = (rel) => {
    const outer = (rel.members || []).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => m.ref);
    return assembleRings(outer).map((ring) => ring.map(nodeXZ).filter(Boolean));
  };

  // ---- buildings
  const buildings = [];
  const buildingWayIds = new Set();
  const dropped = { unclosed: 0, underground: 0, degenerate: 0, tiny: 0, outside: 0 }; // console only
  const hsCount = { osm: 0, overture: 0, part: 0, est: 0 };
  const roofCount = {};
  const ovStats = { matchedById: 0, matchedByOverlap: 0, unmatched: 0, heightSources: {} };
  const pushBuilding = (id, tags, rawRing, osmKey) => {
    if (tags.location === 'underground') return void dropped.underground++;
    const ring = finishRing(simplifyRing(rawRing));
    if (!ring) return void dropped.degenerate++;
    const a = Math.abs(shoelace(ring));
    if (a < 8) return void dropped.tiny++;
    const c = centroid(ring);
    if (!inClip(c)) return void dropped.outside++; // footprint centred outside the bbox
    const t = String(tags.building).toLowerCase();
    let { h, lv } = buildingHeight(id, t, tags, a);
    const lvTag = parseFloat(tags['building:levels']);
    const tagged = parseLen(tags.height) != null || parseLen(tags['building:height']) != null || (Number.isFinite(lvTag) && lvTag > 0);
    let hs = tagged ? 'osm' : 'est';
    // Overture: same OSM id first, else best footprint overlap
    const ovm = overtureMatch(OV, osmKey, ring);
    const ov = ovm ? ovm.b : null;
    if (OV) {
      if (!ovm) ovStats.unmatched++;
      else if (ov.osm && ov.osm.split('@')[0] === osmKey) ovStats.matchedById++;
      else ovStats.matchedByOverlap++;
    }
    if (!tagged && ov && (ov.h >= 2 || ov.floors > 0)) {
      if (ov.h >= 2) { // sub-2 m Microsoft ML heights are noise
        h = r1(clamp(ov.h, 3, 40));
        lv = ov.floors > 0 ? Math.max(1, Math.round(ov.floors)) : Math.max(1, Math.round((h - 1) / 3.5));
      } else {
        h = r1(clamp(ov.floors * 3.3, 3, 40));
        lv = Math.max(1, Math.round(ov.floors));
      }
      hs = 'overture';
      const k = ov.hsrc || (ov.src || []).join('+') || 'unknown';
      ovStats.heightSources[k] = (ovStats.heightSources[k] || 0) + 1;
    }
    const b = { id, t };
    if (tags.name) b.n = tags.name;
    b.h = h;
    b.lv = lv;
    b.mat = buildingMaterial(t, tags, a);
    b.a = Math.round(a);
    b.p = ring;
    // ---- added fields (wave 1): all optional except roof + hs
    b.hs = hs;
    const rs = roofShape(id, t, tags, a, ov);
    b.roof = rs.roof;
    roofCount[rs.roof] = (roofCount[rs.roof] || 0) + 1;
    const minH = parseLen(tags.min_height) ?? (ov && ov.minH > 0 ? ov.minH : null);
    if (minH != null && minH > 0 && minH < h - 1) b.minH = r1(minH);
    const rh = parseLen(tags['roof:height']) ?? (ov && ov.roofH > 0 ? ov.roofH : null);
    if (rh != null && rh > 0 && rh < h) b.roofH = r1(rh);
    const col = normColour(tags['building:colour']) || normColour(ov && ov.facade);
    if (col) b.colour = col;
    const rcol = normColour(tags['roof:colour']) || normColour(ov && ov.roofColor);
    if (rcol) b.roofColour = rcol;
    buildings.push(b);
  };
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    if (!w.tags || !w.tags.building || w.tags.building === 'no') continue;
    if (!wayClosed(w)) {
      dropped.unclosed++;
      continue;
    }
    buildingWayIds.add(id);
    pushBuilding(id, w.tags, wayPts(w), 'w' + id);
  }
  let multiOuterBuildingRels = 0;
  for (const id of sortedIds(rels)) {
    const r = rels.get(id);
    if (!r.tags || !r.tags.building || r.tags.building === 'no' || r.tags.type !== 'multipolygon') continue;
    const outerIds = (r.members || []).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '')).map((m) => m.ref);
    // if the single outer way is itself tagged as a building it is already in the list
    if (outerIds.length === 1 && buildingWayIds.has(outerIds[0])) continue;
    const rings = relOuterRings(r);
    if (rings.length > 1) multiOuterBuildingRels++;
    for (const ring of rings) pushBuilding(id, r.tags, ring, 'r' + id);
  }
  buildings.sort((a, b) => a.id - b.id || a.p[0][0] - b.p[0][0] || a.p[0][1] - b.p[0][1]);

  // ---- building:part ways (3D sub-volumes of an outline). Written to their own
  // array so the outlines in `buildings` stay non-overlapping. An outline with no
  // height of its own takes the tallest part inside it.
  const buildingParts = [];
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    if (!w.tags || !w.tags['building:part'] || w.tags['building:part'] === 'no' || !wayClosed(w)) continue;
    const ring = finishRing(simplifyRing(wayPts(w)));
    if (!ring || Math.abs(shoelace(ring)) < 4 || !inClip(centroid(ring))) continue;
    const tags = w.tags;
    const tagH = parseLen(tags.height) ?? parseLen(tags['building:height']);
    const lvT = parseFloat(tags['building:levels']);
    const h = r1(clamp(tagH ?? (Number.isFinite(lvT) && lvT > 0 ? lvT * 3.5 + 1 : 4), 1, 60));
    const part = { id, h };
    const minH = parseLen(tags.min_height);
    if (minH != null && minH > 0 && minH < h) part.minH = r1(minH);
    if (Number.isFinite(lvT) && lvT > 0) part.lv = lvT;
    part.roof = ROOF_SHAPES[String(tags['roof:shape'] || '').toLowerCase()] || 'flat';
    const col = normColour(tags['building:colour']);
    if (col) part.colour = col;
    const rcol = normColour(tags['roof:colour']);
    if (rcol) part.roofColour = rcol;
    part.p = ring;
    buildingParts.push(part);
  }
  for (const b of buildings) {
    if (b.hs === 'osm') continue;
    let top = 0;
    for (const part of buildingParts) if (pointInPoly(centroid(part.p), b.p)) top = Math.max(top, part.h);
    if (top > 0) {
      b.h = r1(clamp(top, 3, 40));
      b.lv = Math.max(1, Math.round((b.h - 1) / 3.5));
      b.hs = 'part';
    }
  }
  for (const b of buildings) hsCount[b.hs]++;

  // ---- roads
  const roads = [];
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    const k = w.tags && w.tags.highway;
    if (!k || !(k in ROAD_WIDTH)) continue;
    for (const piece of clipLine(wayPts(w))) {
      const p = finishLine(simplifyLine(piece));
      if (!p) continue;
      const r = { id, k };
      if (w.tags.name) r.n = w.tags.name;
      r.w = roadWidth(k, w.tags);
      r.p = p;
      // added fields (wave 1): present only when tagged
      if (w.tags.bridge && w.tags.bridge !== 'no') r.bridge = 1;
      if (w.tags.tunnel && w.tags.tunnel !== 'no') r.tunnel = w.tags.tunnel === 'building_passage' ? 'building_passage' : 1;
      const layer = parseInt(w.tags.layer, 10);
      if (Number.isFinite(layer) && layer !== 0) r.layer = layer;
      roads.push(r);
    }
  }

  // ---- areas
  const areasTmp = [];
  const pushArea = (id, tags, rawRing) => {
    const k = areaKind(tags);
    if (!k) return;
    if (k === 'parking' && tags.building) return; // parking structures are buildings
    const clipped = clipRing(simplifyRing(rawRing, 0.3, 0.1));
    if (clipped.length < 3) return;
    const ring = finishRing(simplifyRing(clipped, 0.3, 0.1));
    if (!ring || Math.abs(shoelace(ring)) < 4) return;
    const a = { k };
    if (tags.name) a.n = tags.name;
    a.p = ring;
    areasTmp.push({ id, a });
  };
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    if (w.tags && wayClosed(w)) pushArea(id, w.tags, wayPts(w));
  }
  for (const id of sortedIds(rels)) {
    const r = rels.get(id);
    if (!r.tags || r.tags.type !== 'multipolygon') continue;
    for (const ring of relOuterRings(r)) pushArea(id, r.tags, ring);
  }
  areasTmp.sort((u, v) => AREA_ORDER.indexOf(u.a.k) - AREA_ORDER.indexOf(v.a.k) || u.id - v.id || u.a.p[0][0] - v.a.p[0][0] || u.a.p[0][1] - v.a.p[0][1]);
  const areas = areasTmp.map((t) => t.a);

  // ---- waterways (lines)
  const waterways = [];
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    const k = w.tags && w.tags.waterway;
    if (!k || k === 'riverbank' || k === 'dock' || k === 'boatyard') continue;
    for (const piece of clipLine(wayPts(w))) {
      const p = finishLine(simplifyLine(piece));
      if (!p) continue;
      const o = { k };
      if (w.tags.name) o.n = w.tags.name;
      o.p = p;
      waterways.push(o);
    }
  }

  // ---- trees
  const trees = [];
  let treeNodes = 0;
  let treeRows = 0;
  let treeRowPts = 0;
  for (const id of sortedIds(nodes)) {
    const n = nodes.get(id);
    if (!n.tags || n.tags.natural !== 'tree') continue;
    const p = project(n.lat, n.lon);
    if (!inClip(p)) continue;
    treeNodes++;
    trees.push([r1(p[0]), r1(p[1])]);
  }
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    if (!w.tags || w.tags.natural !== 'tree_row') continue;
    treeRows++;
    const pts = wayPts(w);
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) len += dist(pts[i], pts[i + 1]);
    if (len <= 0) continue;
    const n = Math.max(1, Math.round(len / 8));
    const step = len / n;
    let seg = 0;
    let segStart = 0;
    for (let i = 0; i <= n; i++) {
      const d = Math.min(len, i * step);
      while (seg + 2 < pts.length && segStart + dist(pts[seg], pts[seg + 1]) < d) {
        segStart += dist(pts[seg], pts[seg + 1]);
        seg++;
      }
      const sl = dist(pts[seg], pts[seg + 1]) || 1;
      const t = clamp((d - segStart) / sl, 0, 1);
      const p = [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * t, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * t];
      if (!inClip(p)) continue;
      treeRowPts++;
      trees.push([r1(p[0]), r1(p[1])]);
    }
  }
  trees.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // ---- named features (used for POIs and landmark lookup)
  const feats = [];
  const addFeat = (type, id, tags, geom) => {
    const names = [tags.name, tags.official_name, tags.alt_name, tags.short_name, tags.old_name].filter(Boolean);
    if (!names.length) return;
    feats.push({ type, id, tags, names, ...geom });
  };
  for (const id of sortedIds(nodes)) {
    const n = nodes.get(id);
    if (n.tags) addFeat('node', id, n.tags, { c: project(n.lat, n.lon), pts: [project(n.lat, n.lon)], poly: false });
  }
  for (const id of sortedIds(ways)) {
    const w = ways.get(id);
    if (!w.tags) continue;
    const pts = wayPts(w);
    if (!pts.length) continue;
    const poly = wayClosed(w) && !(w.tags.highway && w.tags.area !== 'yes');
    const ring = poly ? pts.slice(0, -1) : null;
    addFeat('way', id, w.tags, { c: poly ? centroid(ring) : pts[Math.floor(pts.length / 2)], pts: poly ? ring : pts, poly, area: poly ? Math.abs(shoelace(ring)) : 0 });
  }
  for (const id of sortedIds(rels)) {
    const r = rels.get(id);
    if (!r.tags || r.tags.type !== 'multipolygon') continue;
    const rings = relOuterRings(r).map((g) => g.slice(0, -1)).filter((g) => g.length >= 3);
    if (!rings.length) continue;
    rings.sort((a, b) => Math.abs(shoelace(b)) - Math.abs(shoelace(a)));
    addFeat('relation', id, r.tags, { c: centroid(rings[0]), pts: rings[0], poly: true, area: Math.abs(shoelace(rings[0])), rings });
  }

  /**
   * The part of a feature that lies inside the map: { c, pts, area }, or null if
   * none of it does. A polygon that straddles the bbox edge (Memorial Park, the
   * Walmart Home Office campus) is clipped, so its position is the centre of the
   * part that is actually playable rather than a point near or beyond the edge.
   */
  const inMap = (f) => {
    if (f.map !== undefined) return f.map;
    if (!f.poly) return (f.map = inClip(f.c) ? { c: f.c, pts: f.pts, area: 0 } : null);
    let best = null;
    for (const ring of f.rings || [f.pts]) {
      const part = clipRing(ring);
      if (part.length < 3) continue;
      const area = Math.abs(shoelace(part));
      if (area >= 1 && (!best || area > best.area)) best = { c: centroid(part), pts: part, area };
    }
    return (f.map = best);
  };

  // ---- POIs
  const pois = [];
  for (const f of feats) {
    if (!f.tags.name) continue;
    const key = POI_KEYS.find((k) => f.tags[k] && f.tags[k] !== 'no');
    if (!key) continue;
    if (f.type === 'way' && f.tags.highway && !f.poly) continue; // named roads are not POIs
    const g = inMap(f);
    if (!g) continue;
    pois.push({ n: f.tags.name, k: `${key}=${f.tags[key]}`, x: r1(g.c[0]), z: r1(g.c[1]) });
  }
  pois.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) || a.x - b.x || a.z - b.z);

  // ---- landmarks
  // Member ways of a route, following route_master -> route nesting (the Slaughter
  // Pen trail network is one route_master whose members are ~60 named mtb routes).
  const routeWays = (rel, depth = 0) => {
    const out = [];
    for (const m of rel.members || []) {
      if (m.type === 'way') out.push(m.ref);
      else if (m.type === 'relation' && depth < 3 && rels.has(m.ref)) out.push(...routeWays(rels.get(m.ref), depth + 1));
    }
    return out;
  };
  const isRoadWay = (id) => ways.has(id) && (ways.get(id).tags?.highway ?? '') in ROAD_WIDTH; // i.e. it is in `roads`
  const routeWayIdsByRel = [];
  for (const id of sortedIds(rels)) {
    const r = rels.get(id);
    if (r.tags && (r.tags.type === 'route' || r.tags.type === 'route_master') && r.tags.name) {
      routeWayIdsByRel.push({ name: [r.tags.name, r.tags.alt_name, r.tags.official_name].filter(Boolean).join(' | '), ways: routeWays(r) });
    }
  }
  const bCentroid = new Map(buildings.map((b) => [b, centroid(b.p)]));
  const landmarks = {};
  for (const spec of LANDMARKS) {
    const est = () => {
      const p = project(spec.est.lat, spec.est.lon);
      return { n: spec.n, x: r1(p[0]), z: r1(p[1]), r: spec.est.r, found: false, ids: [] };
    };
    const matchAny = (names) => spec.pats.some((re) => names.some((s) => re.test(s)));

    if (spec.line) {
      // trail-type landmark: all matching highway ways + members of matching route relations
      const wayIds = new Set();
      for (const f of feats) if (f.type === 'way' && isRoadWay(f.id) && matchAny(f.names)) wayIds.add(f.id);
      for (const rr of routeWayIdsByRel) if (matchAny([rr.name])) for (const id of rr.ways) if (isRoadWay(id)) wayIds.add(id);
      let pts = [];
      for (const id of [...wayIds].sort((a, b) => a - b)) for (const piece of clipLine(wayPts(ways.get(id)))) pts.push(...piece);
      if (pts.length) console.log(`  landmark ${spec.key}: ${wayIds.size} trail way(s)`);
      // also accept named non-highway features (trailhead nodes, parks) if no ways matched
      if (!pts.length) for (const f of feats) if (matchAny(f.names) && inMap(f)) pts.push(inMap(f).c);
      if (!pts.length) {
        landmarks[spec.key] = est();
        continue;
      }
      const m = meanPoint(pts);
      let best = pts[0];
      for (const p of pts) if (dist(p, m) < dist(best, m)) best = p; // representative point ON the trail
      const rms = Math.sqrt(pts.reduce((s, p) => s + dist(p, best) ** 2, 0) / pts.length);
      landmarks[spec.key] = { n: spec.n, x: r1(best[0]), z: r1(best[1]), r: Math.max(15, Math.round(rms)), found: true, ids: [] };
      continue;
    }

    // place-type landmark: ignore plain roads/paths that merely share the name
    const cands = feats.filter((f) => !(f.type === 'way' && f.tags.highway && !f.poly) && matchAny(f.names));
    let primary = null;
    for (const re of spec.pats) {
      const hit = cands.filter((f) => f.names.some((s) => re.test(s)) && inMap(f));
      if (!hit.length) continue;
      // prefer the largest polygon (by the area that is inside the map), else the lowest-id node
      hit.sort((a, b) => (b.poly ? inMap(b).area : -1) - (a.poly ? inMap(a).area : -1) || a.id - b.id);
      primary = hit[0];
      break;
    }
    if (!primary) {
      landmarks[spec.key] = est();
      continue;
    }
    const g = inMap(primary);
    const polys = cands.filter((f) => f.poly).flatMap((f) => f.rings || [f.pts]);
    const ids = new Set();
    for (const b of buildings) {
      if (b.n && matchAny([b.n])) ids.add(b.id);
      else if (polys.some((ring) => pointInPoly(bCentroid.get(b), ring))) ids.add(b.id);
      else if (!primary.poly && pointInPoly(g.c, b.p)) ids.add(b.id); // the building a point-type landmark stands in
      else if (spec.campus && b.t === 'school' && dist(bCentroid.get(b), g.c) <= spec.campus) ids.add(b.id);
    }
    let r = 20;
    if (primary.poly) r = Math.max(...g.pts.map((p) => dist(p, g.c)));
    for (const b of buildings) if (ids.has(b.id)) for (const p of b.p) r = Math.max(r, Math.min(dist(p, g.c), 600));
    landmarks[spec.key] = { n: spec.n, x: r1(g.c[0]), z: r1(g.c[1]), r: Math.round(r), found: true, ids: [...ids].sort((a, b) => a - b) };
    console.log(`  landmark ${spec.key}: matched ${primary.type}/${primary.id} "${primary.names[0]}"`);
  }

  // ---- bounds over everything that is written out
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = (p) => {
    if (p[0] < bounds.minX) bounds.minX = p[0];
    if (p[0] > bounds.maxX) bounds.maxX = p[0];
    if (p[1] < bounds.minZ) bounds.minZ = p[1];
    if (p[1] > bounds.maxZ) bounds.maxZ = p[1];
  };
  for (const list of [buildings, roads, areas, waterways]) for (const o of list) o.p.forEach(grow);
  trees.forEach(grow);
  for (const p of pois) grow([p.x, p.z]);

  const generated = rawMeta?.fetchedAt || raw.osm3s?.timestamp_osm_base || 'unknown';
  const out = {
    meta: {
      origin: ORIGIN,
      bbox: BBOX,
      bounds,
      attribution: '© OpenStreetMap contributors (ODbL)',
      heights: OV ? { overture: OV.release, ...ovStats } : null,
      generated,
      counts: {
        buildings: buildings.length,
        roads: roads.length,
        areas: areas.length,
        waterways: waterways.length,
        trees: trees.length,
        treeNodes,
        treeRows,
        treeRowPts,
        pois: pois.length,
        buildingParts: buildingParts.length,
        heightSource: hsCount,
        roofs: roofCount,
        bridges: roads.filter((r) => r.bridge).length,
        landmarksFound: Object.values(landmarks).filter((l) => l.found).length,
      },
    },
    buildings,
    roads,
    areas,
    waterways,
    trees,
    pois,
    landmarks,
    buildingParts,
  };
  return { out, info: { multiOuterBuildingRels, dropped, nodes: nodes.size, ways: ways.size, rels: rels.size } };
}

// ----------------------------------------------------------------------- main

async function main() {
  const refresh = process.argv.includes('--refresh');
  let loaded;
  try {
    loaded = await loadRaw(refresh);
  } catch (e) {
    console.error(String(e.message || e));
    for (const line of net.log) console.error('  ' + line);
    console.error('No output written (tiles already downloaded stay cached; re-run to resume).');
    process.exit(1);
  }
  const OV = loadOverture();
  if (OV) console.log(`Overture buildings: ${OV.count} (release ${OV.release})`);
  else console.log('No data-raw/overture/buildings.json: heights are OSM tags + estimates (run scripts/fetch-overture.py)');
  const { out, info } = build(loaded.raw, loaded.meta, OV);
  const json = JSON.stringify(out);
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  // write-then-rename so a dev server or another process never reads a half-written file
  await writeFile(OUT_FILE + '.tmp', json + '\n');
  await rename(OUT_FILE + '.tmp', OUT_FILE);
  if (PATCH) {
    console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (patch area ${BBOX.join(',')}; credits untouched)`);
    return;
  }
  // credits are regenerated from the same metadata so the date/bbox never drift
  await mkdir(path.dirname(CREDITS_FILE), { recursive: true });
  const rawDate = (f, k = 'fetchedAt') => {
    try {
      return JSON.parse(readFileSync(path.join(RAW_DIR, f), 'utf8'))[k] || 'not yet fetched';
    } catch {
      return 'not yet fetched';
    }
  };
  await writeFile(
    CREDITS_FILE,
    `# Map data

## OpenStreetMap (streets, buildings, land cover, points of interest)

The street, building, land-cover and point-of-interest data in
\`public/data/bentonville-osm.json\` is © OpenStreetMap contributors and is
made available under the Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright

- Source: OpenStreetMap API v0.6 map call (${API}/map), downloaded as tiles
- Downloaded: ${out.meta.generated}
- Bounding box (south, west, north, east): ${BBOX.join(', ')}
- Processed by \`scripts/fetch-map-data.mjs\` (projection to local meters, simplification, inferred heights/materials/roof shapes)

## Overture Maps Foundation (building heights)

Building heights (\`h\` where \`hs\` is \"overture\") come from the Overture Maps
buildings theme, release ${OV ? OV.release : 'n/a'}, which is licensed under the
ODbL 1.0 (https://docs.overturemaps.org/attribution/). Most of these heights are
Overture's conflation of Microsoft Global ML Building Footprints (ODbL) onto the
OpenStreetMap footprints.
© OpenStreetMap contributors, Overture Maps Foundation, Microsoft.

- Source: s3://overturemaps-us-west-2/release/${OV ? OV.release : '<release>'}/theme=buildings (public GeoParquet), queried by \`scripts/fetch-overture.py\`
- Queried: ${OV ? OV.fetchedAt : 'not yet fetched'}

## USGS 3D Elevation Program (terrain)

\`public/data/bentonville-terrain.bin\` / \`.json\` are resampled from the USGS 3DEP
best-available DEM (1 m lidar, AR Benton County 2015 project). USGS data is in
the public domain. Courtesy of the U.S. Geological Survey.

- Source: https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer (exportImage), via \`scripts/fetch-terrain.mjs\`
- Fetched: ${rawDate('terrain/fetch-meta.json')}

## USDA NAIP imagery via USGS The National Map (tree canopy, ground tint)

\`public/data/bentonville-trees.json\` (tree positions) and
\`public/data/bentonville-ground.webp\` (posterized ground colours) are derived
from National Agriculture Imagery Program (NAIP) aerial imagery, a USDA Farm
Service Agency product served by USGS The National Map. Public domain.
Imagery courtesy of USDA FSA and the U.S. Geological Survey.

- Source: https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer (exportImage), via \`scripts/fetch-imagery.mjs\`
- Fetched: ${rawDate('naip/fetch-meta.json')}
`,
  );
  const c = out.meta.counts;
  console.log(`Raw: ${info.nodes} nodes, ${info.ways} ways, ${info.rels} relations`);
  console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}: ${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB`);
  console.log(`  buildings ${c.buildings}, roads ${c.roads}, areas ${c.areas}, waterways ${c.waterways}, trees ${c.trees} (${c.treeNodes} nodes + ${c.treeRowPts} from ${c.treeRows} rows), pois ${c.pois}`);
  const d = info.dropped;
  console.log(`  buildings left out: ${d.outside} centred outside the bbox, ${d.tiny} under 8 m2, ${d.degenerate} degenerate, ${d.unclosed} unclosed, ${d.underground} underground`);
  if (info.multiOuterBuildingRels) console.log(`  note: ${info.multiOuterBuildingRels} building relation(s) have several outer rings (one entry per ring, same id)`);
  for (const [k, l] of Object.entries(out.landmarks)) console.log(`  landmark ${k.padEnd(16)} ${l.found ? 'found  ' : 'MISSING'} x=${l.x} z=${l.z} r=${l.r} ids=${l.ids.length}`);
}

main();
