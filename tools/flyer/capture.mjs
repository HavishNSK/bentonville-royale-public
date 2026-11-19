#!/usr/bin/env node
// BENTONVILLE ROYALE — capture the update flyer's images from the running game (see README.md).
//
//   node tools/flyer/capture.mjs [--version 0.17.0] [--out tools/flyer/out/capture]
//        [--only bb-van.jpg,bb-item-grenade.png] [--url http://localhost:5173/ | --port 5199]
//        [--quality high] [--scale 1] [--headed] [--shots path/to/list.mjs]
//
// Reads tools/flyer/shots/<version>.mjs (format: tools/flyer/shots.mjs), boots the game in a
// headless WebGL Chromium on a Vite dev server, and writes each shot to <out>/<file> (default
// public/ui/news, i.e. the files the FLYER references). Exit 1 if any shot failed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { FLYER } from '../../src/data/updateFlyer.js';
import { validateShotList, loadShotList, coverage, SCENE_SIZE, ITEM_SIZE, BUDGET } from './shots.mjs';
import { parseArgs, devServer, launchWithWebGL, newPage, bootGame, newSink, sleep, NEWS_DIR, SETTINGS_KEY, FLYER_SEEN_KEY } from './lib.mjs';

const USAGE = `usage: node tools/flyer/capture.mjs [--version x.y.z] [--out dir] [--only a.jpg,b.png]
       [--url http://localhost:5173/ | --port 5199] [--quality low|medium|high] [--scale 1] [--headed]
       [--shots path/to/list.mjs]   (an experimental list instead of tools/flyer/shots/<version>.mjs)`;

const log = (...m) => console.log(...m);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), { version: 'string', out: 'string', only: 'string', url: 'string', port: 'number', quality: 'string', scale: 'number', headed: 'bool', shots: 'string', help: 'bool' });
  } catch (err) {
    console.error(err.message + '\n' + USAGE);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  const list = args.shots ? (await import(pathToFileURL(path.resolve(args.shots)).href)).default : await loadShotList(args.version || FLYER.version);
  const version = args.version || (list && list.version) || FLYER.version;
  const out = path.resolve(args.out || NEWS_DIR);
  if (!list) {
    console.error(`no shot list: tools/flyer/shots/${version}.mjs`);
    return 2;
  }
  const errs = validateShotList(list);
  if (list.version !== version) errs.push(`shot list version ${list.version} != ${version}`);
  if (errs.length) {
    console.error('[shots] invalid shot list:\n  ' + errs.join('\n  '));
    return 2;
  }
  if (args.shots) log(`[shots] experimental list ${args.shots} (coverage not checked)`);
  else if (version === FLYER.version) {
    const cov = coverage(FLYER, list);
    if (cov.missing.length) log(`[shots] WARNING: FLYER images with no shot and not in reuse: ${cov.missing.join(', ')}`);
    if (cov.orphans.length) log(`[shots] WARNING: shots the FLYER does not show: ${cov.orphans.join(', ')}`);
  } else log(`[shots] note: FLYER.version is ${FLYER.version}; capturing the ${version} list anyway (draft)`);
  const only = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null;
  const shots = list.shots.filter((s) => !only || only.has(s.file));
  if (only) for (const f of only) if (!shots.find((s) => s.file === f)) log(`[shots] WARNING: --only ${f} is not in the list`);
  if (!shots.length) {
    console.error('nothing to capture');
    return 2;
  }
  mkdirSync(out, { recursive: true });
  log(`[shots] ${shots.length} shot(s) for ${version} -> ${path.relative(process.cwd(), out) || out}`);

  const server = await devServer({ url: args.url, port: args.port || 5199, log });
  const gpu = await launchWithWebGL({ headless: !args.headed });
  if (!gpu) {
    await server.stop();
    console.error('[gpu] no WebGL2 in Chromium (see tools/qa/README.md)');
    return 1;
  }
  log(`[gpu] ${gpu.renderer} (${gpu.flags.join(' ')})`);
  const results = [];
  const sink = newSink();
  let cur = null; // { mode, context, page }
  const settings = JSON.stringify({ quality: args.quality || 'high', performanceMode: false, showFps: false, volume: 0 });
  const storage = { [SETTINGS_KEY]: settings, [FLYER_SEEN_KEY]: FLYER.version };

  async function pageFor(mode, size, fresh) {
    if (cur && (cur.mode !== mode || fresh || !(await alive(cur.page)))) {
      await cur.context.close().catch(() => {});
      cur = null;
    }
    if (!cur) {
      const p = await newPage(gpu.browser, { width: size[0], height: size[1], scale: args.scale || 1, storage, sink, tag: mode, serverUrl: server.url });
      const ms = await bootGame(p.page, server.url, mode);
      log(`[boot] ${mode} ready in ${(ms / 1000).toFixed(1)} s`);
      cur = { mode, ...p, loads: 0 };
      const me = cur;
      p.page.on('load', () => me.loads++);
    } else {
      await cur.page.setViewportSize({ width: size[0], height: size[1] });
      await cur.page.evaluate(() => window.__flyerStudio.reset());
    }
    await cur.page.evaluate(() => window.__flyerStudio.hideUi(true));
    return cur.page;
  }

  /** One shot -> encoded image buffer. Throws on any problem (the caller retries once). */
  async function captureOne(s) {
    if (s.kind === 'scene') {
      const size = s.size || SCENE_SIZE;
      const page = await pageFor(s.mode || 'sandbox', size, !!s.fresh);
      const loads = cur.loads;
      const placed = await page.evaluate((shot) => window.__flyerStudio.placeScene(shot), s);
      await sleep(s.settle ?? 2500);
      const acts = await page.evaluate((a) => window.__flyerStudio.runActions(a), s.setup || []);
      for (const a of acts) if (a.result != null) log(`  [${a.do}] ${JSON.stringify(a.result)}`);
      if (s.ui) {
        await page.evaluate(() => window.__flyerStudio.hideUi(false));
        await sleep(200);
      }
      const png = await page.screenshot({ type: 'png' });
      // a dev-server reload (someone saved a source file) would have put us back on the title screen
      if (cur.loads !== loads || !(await alive(page))) throw new Error('the page reloaded during the shot (a source file changed?)');
      const buf = await sharp(png).resize(size[0], size[1], { fit: 'cover' }).jpeg({ quality: s.quality || 82, mozjpeg: true }).toBuffer();
      const st = await sharp(buf).stats();
      const spread = Math.max(...st.channels.slice(0, 3).map((c) => c.stdev));
      if (spread < 6) throw new Error(`blank frame (colour stdev ${spread.toFixed(1)}); camera inside a wall or the scene did not render`);
      if (buf.length > BUDGET.jpg) throw final(`${kb(buf.length)} is over the ${kb(BUDGET.jpg)} JPEG budget; lower "quality"`);
      log(`  camera ${fmt(placed.camera)} -> ${fmt(placed.lookAt)}`);
      return buf;
    }
    // any booted game has the models; items render offscreen, so the viewport does not matter
    const page = cur && (await alive(cur.page)) ? cur.page : await pageFor('sandbox', SCENE_SIZE, false);
    const url = await page.evaluate((spec) => window.__flyerStudio.renderItem(spec), { ...s, size: s.size || ITEM_SIZE });
    const raw = Buffer.from(url.split(',')[1], 'base64');
    let buf = await sharp(raw).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    // soft glows are big in true colour: fall back to a 256-colour palette (keeps transparency)
    if (buf.length > BUDGET.png) buf = await sharp(raw).png({ palette: true, quality: 92, effort: 10, dither: 0.6 }).toBuffer();
    const alpha = (await sharp(buf).stats()).channels[3];
    if (!alpha || alpha.max === 0) throw new Error('empty render (nothing visible); check yaw / elev / rotate');
    if (alpha.min > 0) throw new Error('no transparent pixels; expected a transparent background');
    if (buf.length > BUDGET.png) throw final(`${kb(buf.length)} is over the ${kb(BUDGET.png)} PNG budget; lower "size"`);
    return buf;
  }

  for (const s of shots) {
    const t0 = Date.now();
    let buf = null;
    let error = null;
    for (let attempt = 1; attempt <= 2 && !buf; attempt++) {
      try {
        buf = await captureOne(s);
      } catch (err) {
        error = String(err && err.message ? err.message : err).split('\n')[0];
        if (err && err.final) attempt = 2; // deterministic: a retry would fail the same way
        if (cur) {
          await cur.context.close().catch(() => {});
          cur = null; // retry / next shot from a clean boot
        }
        if (attempt === 1) log(`  [retry] ${s.file}: ${error}`);
      }
    }
    if (buf) {
      writeFileSync(path.join(out, s.file), buf);
      const meta = await sharp(buf).metadata();
      results.push({ file: s.file, ok: true, bytes: buf.length });
      log(`[ok] ${s.file}  ${meta.width}x${meta.height}  ${kb(buf.length)}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } else {
      results.push({ file: s.file, ok: false, error });
      log(`[fail] ${s.file}: ${error}`);
    }
  }
  if (cur) await cur.context.close().catch(() => {});
  await gpu.browser.close().catch(() => {});
  await server.stop();
  for (const e of sink.pageErrors) log('[pageerror] ' + e);
  const failed = results.filter((r) => !r.ok);
  log(JSON.stringify({ ok: !failed.length, version, out, written: results.filter((r) => r.ok).map((r) => r.file), failed, pageErrors: sink.pageErrors.length }));
  return failed.length ? 1 : 0;
}

/** An error a retry cannot fix (over budget). */
const final = (msg) => Object.assign(new Error(msg), { final: true });

/** The booted game and the studio are still there (no reload back to the title screen). */
const alive = (page) => page.evaluate(() => !!(window.__flyerStudio && window.__game && window.__game.state === 'play')).catch(() => false);

const fmt = (p) => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[fatal] ' + (err && err.stack ? err.stack : err));
    process.exit(1);
  },
);
