#!/usr/bin/env node
// Downloads the USGS 3DEP elevation model for the Bentonville map bbox and
// writes a 4 m heightfield in game coordinates.
//
//   node scripts/fetch-terrain.mjs            # cache-first (data-raw/terrain/)
//   node scripts/fetch-terrain.mjs --refresh  # download again
//
// Source: USGS 3DEP dynamic elevation service (best available: the 2015 Benton
// County 1 m lidar DEM covers the whole bbox), exportImage in EPSG:4326 with
// bilinear resampling at ~3 m (pixel-aligned tiles, extents checked). Public domain (USGS).
//
// Outputs
//   public/data/bentonville-terrain.bin   Int16 little-endian, row-major,
//                                         rows = z (north -> south), cols = x (west -> east),
//                                         value = round((elevation_m - baseElevation) * 100)
//   public/data/bentonville-terrain.json  header, see writeHeader() below.
// Sample (row r, col c) sits at x = minX + c*cell, z = minZ + r*cell (grid
// POINTS, not cell centres); game height = value / 100 (metres; baseElevation
// is already subtracted).
//
// Projection is identical to scripts/fetch-map-data.mjs (equirectangular around
// ORIGIN, x east, z south) - keep the constants in sync.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromArrayBuffer } from 'geotiff';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data-raw', 'terrain');
const RAW_META = path.join(RAW_DIR, 'fetch-meta.json');
const MAP_JSON = path.join(ROOT, 'data-raw', 'bentonville-osm-full.json'); // real geography (pre-compose)
const OUT_BIN = path.join(ROOT, 'public', 'data', 'bentonville-terrain.bin');
const OUT_JSON = path.join(ROOT, 'public', 'data', 'bentonville-terrain.json');

const BBOX = [36.346, -94.31, 36.4, -94.19]; // south, west, north, east (keep in sync with fetch-map-data.mjs)
const ORIGIN = { lat: 36.3729, lon: -94.2088 };
const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);
const MX = 111320 * COS0;
const MZ = 110574;
const CELL = 4;
const PAD_DEG = 0.002; // fetch a little beyond the bbox so edge samples interpolate
const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const USER_AGENT = 'bentonville-royale-map-build/1.0 (one-off terrain fetch)';

// game (x,z) -> lon/lat (inverse of fetch-map-data.mjs project())
const toLon = (x) => ORIGIN.lon + x / MX;
const toLat = (z) => ORIGIN.lat - z / MZ;

const TILE_PX = 600; // the service 502s on one large request; fetch pixel-aligned tiles

/**
 * Overall request grid: extent (pixel edges) and pixel counts. ArcGIS forces
 * square pixels in the output SR (degrees here) and silently stretches the
 * extent otherwise, so dx == dy in degrees: ~2.4 m east-west, 3 m north-south.
 */
function grid() {
  const d = 3 / MZ; // degrees per pixel
  const w = BBOX[1] - PAD_DEG;
  const s = BBOX[0] - PAD_DEG;
  const W = Math.ceil((BBOX[3] + PAD_DEG - w) / d);
  const H = Math.ceil((BBOX[2] + PAD_DEG - s) / d);
  return { w, s, e: w + W * d, n: s + H * d, W, H, dx: d, dy: d };
}

async function loadMosaic(refresh) {
  await mkdir(RAW_DIR, { recursive: true });
  const g = grid();
  const ras = new Float32Array(g.W * g.H).fill(NaN);
  let fetched = 0;
  let nodataAny = null;
  for (let ty = 0; ty < g.H; ty += TILE_PX) {
    for (let tx = 0; tx < g.W; tx += TILE_PX) {
      const tw = Math.min(TILE_PX, g.W - tx);
      const th = Math.min(TILE_PX, g.H - ty);
      const file = path.join(RAW_DIR, `dem-${tx}-${ty}.tif`);
      if (refresh || !existsSync(file)) {
        const bw = g.w + tx * g.dx;
        const be = g.w + (tx + tw) * g.dx;
        const bn = g.n - ty * g.dy;
        const bs = g.n - (ty + th) * g.dy;
        const q = new URLSearchParams({
          bbox: `${bw},${bs},${be},${bn}`,
          bboxSR: '4326',
          imageSR: '4326',
          size: `${tw},${th}`,
          format: 'tiff',
          pixelType: 'F32',
          compression: 'LZ77',
          noDataInterpretation: 'esriNoDataMatchAny',
          interpolation: 'RSP_BilinearInterpolation',
          f: 'image',
        });
        const url = `${SERVICE}/exportImage?${q}`;
        let buf = null;
        for (let attempt = 0; attempt < 5 && !buf; attempt++) {
          if (fetched + attempt > 0) await sleep(attempt ? 10000 : 500);
          console.log(`GET tile ${tx},${ty} (${tw}x${th})${attempt ? ' retry ' + attempt : ''}`);
          const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180000) });
          const b = Buffer.from(await res.arrayBuffer());
          if (res.ok && b.length > 1000 && /^(II|MM)$/.test(b.subarray(0, 2).toString())) buf = b;
          else console.log(`  HTTP ${res.status} ${b.subarray(0, 120).toString().replace(/\s+/g, ' ')}`);
        }
        if (!buf) throw new Error(`3DEP tile ${tx},${ty} failed`);
        await writeFile(file, buf);
        fetched++;
      }
      const tif = await fromArrayBuffer((await readFile(file)).buffer.slice(0));
      const img = await tif.getImage();
      if (img.getWidth() !== tw || img.getHeight() !== th) throw new Error(`tile ${tx},${ty}: got ${img.getWidth()}x${img.getHeight()}`);
      const tb = img.getBoundingBox();
      const want = [g.w + tx * g.dx, g.n - (ty + th) * g.dy, g.w + (tx + tw) * g.dx, g.n - ty * g.dy];
      if (tb.some((v, k) => Math.abs(v - want[k]) > g.dx * 0.01)) throw new Error(`tile ${tx},${ty}: extent ${tb} != requested ${want} (delete the dem-*.tif tiles and re-run)`);
      nodataAny = img.getGDALNoData() ?? nodataAny;
      const [t] = await img.readRasters();
      for (let y = 0; y < th; y++) ras.set(t.subarray(y * tw, (y + 1) * tw), (ty + y) * g.W + tx);
    }
  }
  if (fetched || !existsSync(RAW_META)) {
    await writeFile(RAW_META, JSON.stringify({ source: SERVICE + '/exportImage', fetchedAt: new Date().toISOString(), extent: [g.w, g.s, g.e, g.n], size: [g.W, g.H], tilePx: TILE_PX }, null, 2) + '\n');
  }
  console.log(fetched ? `Downloaded ${fetched} DEM tile(s) into ${path.relative(ROOT, RAW_DIR)}` : 'Using cached DEM tiles (no network)');
  return { g, ras, nodata: nodataAny };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { g, ras, nodata } = await loadMosaic(process.argv.includes('--refresh'));
  const rawMeta = JSON.parse(await readFile(RAW_META, 'utf8'));
  const { w, s, e, n, W, H } = g;
  const valid = (v) => Number.isFinite(v) && v > -1000 && v < 10000 && (nodata == null || v !== nodata);
  let bad = 0;
  for (let i = 0; i < ras.length; i++) if (!valid(ras[i])) bad++;
  console.log(`DEM ${W}x${H}, extent lon ${w.toFixed(4)}..${e.toFixed(4)} lat ${s.toFixed(4)}..${n.toFixed(4)}, invalid pixels ${bad}`);

  // bilinear sample at lon/lat; pixel centres at w + (i+0.5)*dx
  const dx = (e - w) / W;
  const dy = (n - s) / H;
  const sample = (lon, lat) => {
    const fx = (lon - w) / dx - 0.5;
    const fy = (n - lat) / dy - 0.5;
    const x0 = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const at = (x, y) => ras[y * W + x];
    const v = [at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)];
    const wt = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
    let sum = 0;
    let ws = 0;
    for (let k = 0; k < 4; k++) if (valid(v[k])) { sum += v[k] * wt[k]; ws += wt[k]; }
    return ws > 0 ? sum / ws : NaN;
  };

  // grid over the map JSON bounds, snapped outward to the cell size
  const map = JSON.parse(await readFile(MAP_JSON, 'utf8'));
  const b = map.meta.bounds;
  const minX = Math.floor(b.minX / CELL) * CELL;
  const minZ = Math.floor(b.minZ / CELL) * CELL;
  const cols = Math.ceil(b.maxX / CELL) - minX / CELL + 1;
  const rows = Math.ceil(b.maxZ / CELL) - minZ / CELL + 1;
  const elev = new Float64Array(cols * rows);
  let holes = 0;
  for (let r = 0; r < rows; r++) {
    const lat = toLat(minZ + r * CELL);
    for (let c = 0; c < cols; c++) {
      const v = sample(toLon(minX + c * CELL), lat);
      if (!Number.isFinite(v)) holes++;
      elev[r * cols + c] = v;
    }
  }
  // fill any hole with the nearest valid value along the row (should be none)
  if (holes) {
    for (let i = 0; i < elev.length; i++) if (!Number.isFinite(elev[i])) {
      for (let d = 1; d < cols; d++) {
        if (i - d >= 0 && Number.isFinite(elev[i - d])) { elev[i] = elev[i - d]; break; }
        if (i + d < elev.length && Number.isFinite(elev[i + d])) { elev[i] = elev[i + d]; break; }
      }
    }
  }
  const sorted = Float64Array.from(elev).sort();
  const median = sorted[sorted.length >> 1];
  const baseElevation = Math.round(median * 10) / 10;
  const out = new Int16Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < elev.length; i++) {
    const cm = Math.round((elev[i] - baseElevation) * 100);
    out[i] = Math.max(-32768, Math.min(32767, cm));
    min = Math.min(min, out[i]);
    max = Math.max(max, out[i]);
  }
  const originElev = sample(ORIGIN.lon, ORIGIN.lat);
  const header = {
    format: 'int16-cm',
    endian: 'little',
    layout: 'row-major; row r -> z = minZ + r*cell (north to south), col c -> x = minX + c*cell (west to east); samples are grid points',
    cell: CELL,
    cols,
    rows,
    minX,
    minZ,
    maxX: minX + (cols - 1) * CELL,
    maxZ: minZ + (rows - 1) * CELL,
    baseElevation,
    min: min / 100,
    max: max / 100,
    elevationMin: Math.round((min / 100 + baseElevation) * 10) / 10,
    elevationMax: Math.round((max / 100 + baseElevation) * 10) / 10,
    originHeight: Math.round((originElev - baseElevation) * 100) / 100,
    units: 'metres; game height = int16 / 100; real elevation (NAVD88) = game height + baseElevation',
    source: 'USGS 3D Elevation Program (3DEP), best-available DEM (1 m lidar, AR Benton Co 2015), public domain',
    sourceUrl: SERVICE,
    fetched: rawMeta.fetchedAt,
    holesFilled: holes,
  };
  await mkdir(path.dirname(OUT_BIN), { recursive: true });
  await writeFile(OUT_BIN + '.tmp', Buffer.from(out.buffer));
  await rename(OUT_BIN + '.tmp', OUT_BIN);
  await writeFile(OUT_JSON, JSON.stringify(header, null, 2) + '\n');
  console.log(`Wrote ${path.relative(ROOT, OUT_BIN)} ${cols}x${rows} (${(out.byteLength / 1e6).toFixed(2)} MB)`);
  console.log(`  base ${baseElevation} m, game range ${header.min}..${header.max} m (relief ${((max - min) / 100).toFixed(1)} m), square/origin at ${header.originHeight} m, holes ${holes}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
