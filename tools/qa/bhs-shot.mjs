#!/usr/bin/env node
// BENTONVILLE ROYALE — Bentonville High School match-loop camera (docs/bhs/STYLE_BIBLE.md).
//
//   node tools/qa/bhs-shot.mjs --url http://localhost:5174 --views tools/bhs/views.json
//        [--only name1,name2] [--round 1] [--out <dir>] [--wait 2500]
//
// Starts a freebuild match headless, then for every view places the camera exactly
// ({ cam: { x, y, z, tx, ty, tz, fov } }, world metres, x east / z south) and saves the render.
// A view with a `ref` (a filename in the private reference folder) also gets a side-by-side
// comparison, photo | render, written to <refs>/_work/compare/<name>_r<round>.png. Renders go to
// <refs>/_work/renders/ by default, OUTSIDE the repo. Copy game-only renders into docs/bhs/slice/
// by hand when they are good; never copy a comparison (it contains a real photo).
//
// views.json: [{ "name": "commons-bridge", "ref": "viewof...bridge.jpg", "cam": {...},
//               "tp": [x, z]?, "hideHud": true? }]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { launchWithWebGL } from './lib/browser.mjs';

const REFS = process.env.BHS_REFS || path.join(os.homedir(), 'Pictures', 'bhs-refs');
const WORK = path.join(REFS, '_work');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg('--url', 'http://localhost:5173');
const views = JSON.parse(fs.readFileSync(arg('--views', 'tools/bhs/views.json'), 'utf8'));
const only = arg('--only', null);
const round = arg('--round', '1');
const outDir = arg('--out', path.join(WORK, 'renders'));
const wait = Number(arg('--wait', 2500));
const H = 540;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decoded = (ref) => path.join(WORK, 'decoded', ref.replace(/\.[^.]+$/, '') + '.png');

async function startGame(page) {
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await sleep(1500);
  await page.evaluate(() => document.querySelectorAll('.ufl').forEach((e) => e.remove()));
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const b = document.querySelector('[data-act="freebuild"]');
    if (b) b.click();
  });
  for (let i = 0; i < 400; i++) {
    if ((await page.evaluate(() => window.__game && window.__game.state)) === 'play') break;
    await sleep(500);
  }
  await sleep(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.ufl').forEach((e) => e.remove());
    const g = window.__game.raw;
    const p = g.player;
    const orig = p.updateCamera.bind(p);
    p.updateCamera = (cam, ...a) => {
      const o = window.__cam;
      if (!o) return orig(cam, ...a);
      cam.position.set(o.x, o.y, o.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(o.tx, o.ty, o.tz);
      if (o.fov && cam.fov !== o.fov) {
        cam.fov = o.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    };
    window.__game.debug.god(true);
    g.applySettings({ quality: 'high' });
    // renders only: hide every DOM layer above the game canvas (HUD, minimap, banners)
    const st = document.createElement('style');
    st.textContent = 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }';
    document.head.appendChild(st);
  });
}

/** Vertical fov (three.js) from a horizontal fov and aspect. */
const vfov = (hfov, aspect) => (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / aspect) * 180) / Math.PI;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(WORK, 'compare'), { recursive: true });
  const L = await launchWithWebGL();
  if (!L) throw new Error('no WebGL2 context');
  const page = await L.browser.newPage({ viewport: { width: 960, height: H } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.split('\n')[0]));
  await startGame(page);
  for (const v of views) {
    if (only && !only.split(',').includes(v.name)) continue;
    let aspect = 16 / 9;
    if (v.ref) {
      const m = await sharp(decoded(v.ref)).metadata();
      aspect = m.width / m.height;
    }
    const W = Math.round(H * aspect);
    await page.setViewportSize({ width: W, height: H });
    const c = v.cam;
    // a player body near the camera keeps the chunk / interior streaming around the view
    await page.evaluate(([x, z]) => window.__game.debug.teleport(x, z), v.tp || [c.x, c.z]);
    await page.evaluate((o) => {
      window.__cam = o;
    }, { ...c, fov: vfov(c.hfov || 70, aspect) });
    await sleep(v.wait || wait);
    const file = path.join(outDir, `${v.name}_r${round}.png`);
    await page.screenshot({ path: file });
    console.log('[render]', file);
    if (v.ref) {
      const photo = await sharp(decoded(v.ref)).resize({ height: H }).png().toBuffer();
      const pw = (await sharp(photo).metadata()).width;
      const label = (t, x) => `<text x="${x + 10}" y="28" font-size="22" font-family="sans-serif" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${t}</text>`;
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw + W}" height="${H}">${label('PHOTO ' + v.ref, 0)}${label('GAME ' + v.name + ' r' + round, pw)}</svg>`);
      const cmp = path.join(WORK, 'compare', `${v.name}_r${round}.png`);
      await sharp({ create: { width: pw + W, height: H, channels: 3, background: '#000' } })
        .composite([{ input: photo, left: 0, top: 0 }, { input: file, left: pw, top: 0 }, { input: svg, left: 0, top: 0 }])
        .png()
        .toFile(cmp);
      console.log('[compare]', cmp);
    }
  }
  await L.browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
