#!/usr/bin/env node
// Downloads public-domain USGS NAIP aerial imagery (natural colour + near
// infrared) for the Bentonville map and derives:
//   public/data/bentonville-trees.json   tree canopy points from the imagery
//   public/data/bentonville-ground.webp  posterized low-res ground tint texture
//
//   node scripts/fetch-imagery.mjs            # cache-first (data-raw/naip/)
//   node scripts/fetch-imagery.mjs --refresh  # download again
//
// Needs public/data/bentonville-osm.json (masks: buildings, roads, water,
// parking, pitches) and public/data/bentonville-terrain.json (the texture and
// imagery cover exactly the terrain grid extent) - run fetch-map-data.mjs and
// fetch-terrain.mjs first.
//
// Source: USGS NAIP Imagery ImageServer (The National Map), exportImage in
// EPSG:4326 with square ~1.25 m (N-S) pixels, pixel-aligned tiles, JPEG.
// NAIP imagery is a USDA FSA product distributed by USGS; public domain.
//
// ---- bentonville-trees.json
// { meta: { count, source, generated, method, format }, t: [x, z, r, x, z, r, ...] }
//   x, z  game metres (x east, z south), 0.1 m
//   r     crown radius hint in metres (3..9, from canopy fill of a 22 m cell), 0.1 m
// The OSM `trees` array in bentonville-osm.json is unchanged (236 mapped trees);
// these are additional canopy trees detected from imagery and already exclude
// buildings, roads, water, parking and pitches.
//
// ---- bentonville-ground.webp
// Covers exactly the terrain grid extent: image column 0 = x minX, last column
// edge = maxX; image row 0 = NORTH edge (z = minZ), last row edge = maxZ.
//   u = (x - minX) / (maxX - minX),  v = (z - minZ) / (maxZ - minZ)   (v = 0 at top row)
// With three.js' default texture.flipY = true use uv = (u, 1 - v).
// (minX/minZ/maxX/maxZ are the values in bentonville-terrain.json.)

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data-raw', 'naip');
const RAW_META = path.join(RAW_DIR, 'fetch-meta.json');
const MAP_JSON = path.join(ROOT, 'public', 'data', 'bentonville-osm.json');
const TERRAIN_JSON = path.join(ROOT, 'public', 'data', 'bentonville-terrain.json');
const OUT_TREES = path.join(ROOT, 'public', 'data', 'bentonville-trees.json');
const OUT_GROUND = path.join(ROOT, 'public', 'data', 'bentonville-ground.webp');

const ORIGIN = { lat: 36.3729, lon: -94.2088 };
const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);
const MX = 111320 * COS0;
const MZ = 110574;
const SERVICE = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer';
const USER_AGENT = 'bentonville-royale-map-build/1.0 (one-off imagery fetch)';
const PIX_M = 1.25; // metres per pixel north-south (east-west is PIX_M * MX/MZ ~ 1.01 m)
const TILE_PX = 1800;
const GROUND_LONG = 2048;

// tree extraction parameters
const NDVI_MIN = 0.12; // tuned on this imagery, see report
const BRIGHT_MAX = 105; // trees are darker than lawns at the same NDVI
const CELL_M = 22; // one tree per canopy cell at most (13 m gave ~36k trees: too many to instance)
const FILL_MIN = 0.4; // fraction of a cell that must be canopy

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toLon = (x) => ORIGIN.lon + x / MX;
const toLat = (z) => ORIGIN.lat - z / MZ;

async function getJson(url) {
  for (let a = 0; a < 5; a++) {
    if (a) await sleep(8000 * a);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180000) });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) {
        const j = JSON.parse(text);
        if (j.href) return j;
      }
      console.log(`  HTTP ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.log(`  ${e.name}: ${e.message}`);
    }
  }
  throw new Error('NAIP exportImage failed: ' + url);
}

async function getBin(url) {
  for (let a = 0; a < 5; a++) {
    if (a) await sleep(5000 * a);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180000) });
      const b = Buffer.from(await res.arrayBuffer());
      if (res.ok && b[0] === 0xff && b[1] === 0xd8) return b;
      console.log(`  HTTP ${res.status} ${b.subarray(0, 80).toString()}`);
    } catch (e) {
      console.log(`  ${e.name}: ${e.message}`);
    }
  }
  throw new Error('NAIP image download failed: ' + url);
}

/** Download (or load cached) RGB + NIR mosaics covering the terrain extent. */
async function loadMosaic(T, refresh) {
  await mkdir(RAW_DIR, { recursive: true });
  const d = PIX_M / MZ; // degrees per pixel (square in degrees, see fetch-terrain.mjs)
  const w = toLon(T.minX);
  const n = toLat(T.minZ);
  const W = Math.round((toLon(T.maxX) - w) / d);
  const H = Math.round((n - toLat(T.maxZ)) / d);
  const g = { w, n, e: w + W * d, s: n - H * d, W, H, d };
  const rgb = new Uint8Array(W * H * 3);
  const nir = new Uint8Array(W * H);
  let fetched = 0;
  const tiles = [];
  for (let ty = 0; ty < H; ty += TILE_PX) {
    for (let tx = 0; tx < W; tx += TILE_PX) {
      const tw = Math.min(TILE_PX, W - tx);
      const th = Math.min(TILE_PX, H - ty);
      const bbox = [g.w + tx * d, g.n - (ty + th) * d, g.w + (tx + tw) * d, g.n - ty * d];
      for (const band of ['rgb', 'nir']) {
        const file = path.join(RAW_DIR, `${band}-${tx}-${ty}.jpg`);
        if (refresh || !existsSync(file)) {
          const q = new URLSearchParams({
            bbox: bbox.join(','), bboxSR: '4326', imageSR: '4326', size: `${tw},${th}`, format: 'jpg',
            compressionQuality: '90', bandIds: band === 'rgb' ? '0,1,2' : '3', interpolation: 'RSP_BilinearInterpolation', f: 'json',
          });
          console.log(`GET ${band} tile ${tx},${ty} (${tw}x${th})`);
          const j = await getJson(`${SERVICE}/exportImage?${q}`);
          const ex = j.extent;
          const got = [ex.xmin, ex.ymin, ex.xmax, ex.ymax];
          if (j.width !== tw || j.height !== th || got.some((v, k) => Math.abs(v - bbox[k]) > d * 0.05)) throw new Error(`tile ${band} ${tx},${ty}: server changed extent/size ${JSON.stringify(j)}`);
          await writeFile(file, await getBin(j.href));
          fetched++;
          await sleep(500);
        }
        const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
        if (info.width !== tw || info.height !== th) throw new Error(`${file}: ${info.width}x${info.height}`);
        const ch = info.channels;
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const si = (y * tw + x) * ch;
            const di = (ty + y) * W + tx + x;
            if (band === 'rgb') { rgb[di * 3] = data[si]; rgb[di * 3 + 1] = data[si + 1]; rgb[di * 3 + 2] = data[si + 2]; }
            else nir[di] = data[si];
          }
        }
      }
      tiles.push(`${tx}-${ty}`);
    }
  }
  let meta = existsSync(RAW_META) ? JSON.parse(await readFile(RAW_META, 'utf8')) : null;
  if (fetched || !meta) {
    meta = { source: SERVICE + '/exportImage', fetchedAt: new Date().toISOString(), extent: [g.w, g.s, g.e, g.n], size: [W, H], pixelDeg: d, tiles };
    await writeFile(RAW_META, JSON.stringify(meta, null, 2) + '\n');
  }
  console.log(fetched ? `Downloaded ${fetched} NAIP image(s) into ${path.relative(ROOT, RAW_DIR)}` : 'Using cached NAIP tiles (no network)');
  return { g, rgb, nir, meta };
}

// ------------------------------------------------------------- rasterisation

function makeMask(g, T) {
  const W = g.W;
  const H = g.H;
  const mask = new Uint8Array(W * H);
  // game -> pixel (continuous, pixel centres at +0.5)
  const sx = W / (T.maxX - T.minX);
  const sz = H / (T.maxZ - T.minZ);
  const px = (x) => (x - T.minX) * sx;
  const pz = (z) => (z - T.minZ) * sz;
  const fillPoly = (p, val) => {
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const q of p) { y0 = Math.min(y0, pz(q[1])); y1 = Math.max(y1, pz(q[1])); }
    y0 = Math.max(0, Math.floor(y0));
    y1 = Math.min(H - 1, Math.ceil(y1));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      xs.length = 0;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const ay = pz(p[i][1]);
        const by = pz(p[j][1]);
        if ((ay > cy) !== (by > cy)) xs.push(px(p[i][0]) + ((cy - ay) / (by - ay)) * (px(p[j][0]) - px(p[i][0])));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - 0.5));
        const b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = a; x <= b; x++) mask[y * W + x] = val;
      }
    }
  };
  const stampLine = (p, rad, val) => {
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      const x0 = Math.max(0, Math.floor(px(Math.min(ax, bx) - rad)));
      const x1 = Math.min(W - 1, Math.ceil(px(Math.max(ax, bx) + rad)));
      const y0 = Math.max(0, Math.floor(pz(Math.min(az, bz) - rad)));
      const y1 = Math.min(H - 1, Math.ceil(pz(Math.max(az, bz) + rad)));
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      for (let y = y0; y <= y1; y++) {
        const z = T.minZ + (y + 0.5) / sz;
        for (let x = x0; x <= x1; x++) {
          const xx = T.minX + (x + 0.5) / sx;
          const t = Math.max(0, Math.min(1, ((xx - ax) * dx + (z - az) * dz) / l2));
          const ex = xx - (ax + t * dx);
          const ez = z - (az + t * dz);
          if (ex * ex + ez * ez <= rad * rad) mask[y * W + x] = val;
        }
      }
    }
  };
  return { mask, fillPoly, stampLine, sx, sz };
}

// ------------------------------------------------------------------ k-means

function kmeans(pixels, k, iters = 12) {
  // pixels: Float32Array of n*3. Deterministic init: spread over brightness order.
  const n = pixels.length / 3;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pixels[a * 3] + pixels[a * 3 + 1] + pixels[a * 3 + 2] - (pixels[b * 3] + pixels[b * 3 + 1] + pixels[b * 3 + 2]));
  const c = new Float64Array(k * 3);
  for (let j = 0; j < k; j++) { const i = order[Math.floor(((j + 0.5) / k) * n)]; c.set([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]], j * 3); }
  const lab = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = new Float64Array(k * 3);
    const cnt = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const a = pixels[i * 3] - c[j * 3];
        const b = pixels[i * 3 + 1] - c[j * 3 + 1];
        const e = pixels[i * 3 + 2] - c[j * 3 + 2];
        const dd = a * a + b * b + e * e;
        if (dd < bd) { bd = dd; best = j; }
      }
      lab[i] = best;
      sum[best * 3] += pixels[i * 3]; sum[best * 3 + 1] += pixels[i * 3 + 1]; sum[best * 3 + 2] += pixels[i * 3 + 2];
      cnt[best]++;
    }
    for (let j = 0; j < k; j++) if (cnt[j]) for (let q = 0; q < 3; q++) c[j * 3 + q] = sum[j * 3 + q] / cnt[j];
  }
  return { centers: c, labels: lab };
}

// ---------------------------------------------------------------------- main

async function main() {
  const T = JSON.parse(await readFile(TERRAIN_JSON, 'utf8'));
  const map = JSON.parse(await readFile(MAP_JSON, 'utf8'));
  const { g, rgb, nir, meta } = await loadMosaic(T, process.argv.includes('--refresh'));
  const { W, H } = g;
  console.log(`NAIP mosaic ${W}x${H}`);

  // ---- exclusion mask: 1 = not allowed for trees
  const { mask, fillPoly, stampLine, sx, sz } = makeMask(g, T);
  for (const b of map.buildings) fillPoly(b.p, 1);
  for (const a of map.areas) if (['water', 'parking', 'pitch'].includes(a.k)) fillPoly(a.p, 1);
  for (const r of map.roads) {
    const minor = ['footway', 'path', 'cycleway', 'steps', 'track'].includes(r.k);
    stampLine(r.p, minor ? r.w / 2 + 0.5 : r.w / 2 + 2, 1);
  }
  for (const wv of map.waterways) stampLine(wv.p, wv.k === 'river' ? 6 : 2, 1);
  // buildings get a 2 m clearance so canopy points never sit inside a wall
  for (const b of map.buildings) stampLine([...b.p, b.p[0]], 2, 1);

  // ---- canopy classification
  const canopy = new Uint8Array(W * H);
  let nCanopy = 0;
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) continue;
    const r = rgb[i * 3];
    const gg = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    const ndvi = (nir[i] - r) / (nir[i] + r + 1e-6);
    const bright = (r + gg + b) / 3;
    if (ndvi > NDVI_MIN && bright < BRIGHT_MAX && gg >= b) { canopy[i] = 1; nCanopy++; }
  }
  // 3x3 majority filter (removes speckle: shadows on lawns, single dark pixels)
  const clean = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += canopy[(y + dy) * W + x + dx];
      clean[y * W + x] = s >= 5 ? 1 : 0;
    }
  }
  const pxArea = (1 / sx) * (1 / sz);
  let cleanCount = 0;
  for (let i = 0; i < clean.length; i++) cleanCount += clean[i];
  console.log(`canopy pixels ${nCanopy} raw, ${cleanCount} cleaned = ${((cleanCount * pxArea) / 1e6).toFixed(2)} km2 (${((100 * cleanCount) / (W * H)).toFixed(1)}% of map)`);

  // ---- tree points: one per CELL_M cell whose canopy fill >= FILL_MIN, at the
  // canopy centroid of the cell; radius from the fill.
  const trees = [];
  const cw = Math.ceil((T.maxX - T.minX) / CELL_M);
  const ch = Math.ceil((T.maxZ - T.minZ) / CELL_M);
  for (let cz = 0; cz < ch; cz++) {
    const y0 = Math.floor(cz * CELL_M * sz);
    const y1 = Math.min(H, Math.floor((cz + 1) * CELL_M * sz));
    for (let cx = 0; cx < cw; cx++) {
      const x0 = Math.floor(cx * CELL_M * sx);
      const x1 = Math.min(W, Math.floor((cx + 1) * CELL_M * sx));
      let s = 0;
      let mx = 0;
      let mz = 0;
      let tot = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        tot++;
        if (clean[y * W + x]) { s++; mx += x; mz += y; }
      }
      if (!tot || s / tot < FILL_MIN) continue;
      mx /= s;
      mz /= s;
      // snap the centroid to a canopy pixel near it (a crescent's centroid can be off-canopy)
      let bx = Math.round(mx);
      let by = Math.round(mz);
      if (!clean[by * W + bx]) {
        let bd = Infinity;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (clean[y * W + x]) {
          const dd = (x - mx) ** 2 + (y - mz) ** 2;
          if (dd < bd) { bd = dd; bx = x; by = y; }
        }
      }
      const x = T.minX + (bx + 0.5) / sx;
      const z = T.minZ + (by + 0.5) / sz;
      const fill = s / tot;
      // crown radius hint 3..9 m, linear in how full the cell's canopy is
      const r = 3 + (6 * (fill - FILL_MIN)) / (1 - FILL_MIN);
      trees.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round(r * 10) / 10]);
    }
  }
  trees.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const flat = trees.flat();
  const rs = trees.map((t) => t[2]).sort((a, b) => a - b);
  const treeOut = {
    meta: {
      count: trees.length,
      format: 'flat array t = [x, z, r, x, z, r, ...]; x east / z south in game metres; r = crown radius hint (m)',
      source: 'USDA NAIP aerial imagery via USGS The National Map (public domain); canopy = NDVI and brightness threshold, minus OSM buildings/roads/water/parking/pitches',
      imagery: meta.source,
      fetched: meta.fetchedAt,
      method: { ndviMin: NDVI_MIN, brightMax: BRIGHT_MAX, cellM: CELL_M, fillMin: FILL_MIN, canopyKm2: Math.round((cleanCount * pxArea) / 1e4) / 100 },
      radius: { min: rs[0], median: rs[rs.length >> 1], max: rs[rs.length - 1] },
    },
    t: flat,
  };
  const tj = JSON.stringify(treeOut);
  await writeFile(OUT_TREES + '.tmp', tj + '\n');
  await rename(OUT_TREES + '.tmp', OUT_TREES);
  console.log(`Wrote ${path.relative(ROOT, OUT_TREES)}: ${trees.length} trees, r ${rs[0]}..${rs[rs.length - 1]} (median ${rs[rs.length >> 1]}), ${(tj.length / 1e3).toFixed(0)} KB`);

  // ---- ground tint texture
  const GH = GROUND_LONG;
  const GW = Math.round((GH * (T.maxX - T.minX)) / (T.maxZ - T.minZ));
  const small = await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width: W, height: H, channels: 3 } })
    .resize(GW, GH, { fit: 'fill', kernel: 'lanczos3' })
    .median(5)
    .blur(1.2)
    .raw()
    .toBuffer();
  const n = GW * GH;
  const fpx = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) fpx[i] = small[i];
  // subsample for k-means centres, then label every pixel
  const sub = new Float32Array(Math.floor(n / 16) * 3);
  for (let i = 0, j = 0; j < sub.length / 3; i += 16, j++) sub.set(fpx.subarray(i * 3, i * 3 + 3), j * 3);
  const K = 10;
  const { centers } = kmeans(sub, K, 15);
  // stylise the palette: a little more saturation and lift, cartoon-friendly
  const pal = [];
  for (let j = 0; j < K; j++) {
    let [r, gg, b] = [centers[j * 3], centers[j * 3 + 1], centers[j * 3 + 2]];
    const l = (r + gg + b) / 3;
    const sat = 1.35;
    r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
    const lift = 1.12;
    pal.push([r * lift, gg * lift, b * lift].map((v) => Math.max(0, Math.min(255, Math.round(v)))));
  }
  const outPx = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < K; j++) {
      const a = fpx[i * 3] - centers[j * 3];
      const b = fpx[i * 3 + 1] - centers[j * 3 + 1];
      const e = fpx[i * 3 + 2] - centers[j * 3 + 2];
      const dd = a * a + b * b + e * e;
      if (dd < bd) { bd = dd; best = j; }
    }
    outPx[i * 3] = pal[best][0]; outPx[i * 3 + 1] = pal[best][1]; outPx[i * 3 + 2] = pal[best][2];
  }
  await sharp(outPx, { raw: { width: GW, height: GH, channels: 3 } }).median(3).webp({ quality: 82, effort: 6 }).toFile(OUT_GROUND + '.tmp.webp');
  await rename(OUT_GROUND + '.tmp.webp', OUT_GROUND);
  const st = (await readFile(OUT_GROUND)).length;
  console.log(`Wrote ${path.relative(ROOT, OUT_GROUND)}: ${GW}x${GH}, ${K} colours, ${(st / 1e3).toFixed(0)} KB; palette ${JSON.stringify(pal)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
