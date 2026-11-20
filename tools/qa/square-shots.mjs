#!/usr/bin/env node
// Repeatable reference-camera screenshots of the Bentonville Square POI (docs/square/).
//
//   npx vite --port 5199 &   (dev build: window.__game is only exposed there)
//   node tools/qa/square-shots.mjs --url http://localhost:5199 --out docs/square/shots [--only A01,W01]
//
// Cameras come from public/data/bentonville-square/cameras.json (game metres: x east,
// z SOUTH, y up). The camera is overridden right before each render, so the shot is exactly
// the listed position / target / fov no matter where the player stands.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithWebGL, sleep, dismissFlyer } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []),
);
const url = args.url || 'http://localhost:5199';
const out = path.resolve(args.out || path.join(ROOT, 'docs/square/shots'));
const only = args.only ? new Set(args.only.split(',')) : null;
const cams = JSON.parse(readFileSync(path.join(ROOT, 'public/data/bentonville-square/cameras.json'), 'utf8')).cameras;
mkdirSync(out, { recursive: true });

const L = await launchWithWebGL({});
if (!L) throw new Error('no WebGL in headless Chromium');
const page = await (await L.browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && window.__game.game, null, { timeout: 120000 });
await page.waitForSelector('[data-act=party-go]', { state: 'visible', timeout: 60000 });
await sleep(1500);
await dismissFlyer(page);
await page.evaluate(() => {
  const g = window.__game.game;
  g.applySettings({ ...g.settings, quality: 'high', showFps: false, dynamicResolution: false });
});
await page.click('[data-act=party-go]');
await page.waitForFunction(() => ['drop', 'play'].includes(window.__game.state), null, { timeout: 120000 });
await sleep(1500);
await page.evaluate(() => {
  const dbg = window.__game.debug;
  dbg.teleport(-20, 18);
  const g = window.__game.game;
  const render = g.post.render.bind(g.post);
  g.post.render = (scene, camera, dt) => {
    const o = window.__cam;
    if (o) {
      camera.position.set(o.pos[0], o.pos[1], o.pos[2]);
      camera.fov = o.fov || 60;
      camera.near = 0.3;
      camera.updateProjectionMatrix();
      camera.lookAt(o.look[0], o.look[1], o.look[2]);
      camera.updateMatrixWorld();
    }
    return render(scene, camera, dt);
  };
  document.querySelectorAll('.br-hud, #hud, .hud').forEach((el) => (el.style.visibility = 'hidden'));
});
for (const c of cams) {
  if (only && !only.has(c.id)) continue;
  // stand the (hidden-from-shot) player near the camera so streaming / culling load that area
  await page.evaluate((c) => {
    // stand the player 8 m behind the camera (out of frame) so streaming / culling centre there
    const dx = c.look[0] - c.pos[0], dz = c.look[2] - c.pos[2], dl = Math.hypot(dx, dz) || 1;
    window.__game.debug.teleport(c.pos[0] - (dx / dl) * 8, c.pos[2] - (dz / dl) * 8);
    const w = window.__game.game.world;
    const gy = (x, z) => (c.eye != null ? w.groundHeight(x, z, 1e4) : 0);
    // eye: metres above the ground at the camera (street-level shots); else absolute y
    const ch = window.__game.game.player.character;
    if (ch && ch.root) ch.root.visible = false; // the camera is overridden: keep the player out of the shot
    window.__cam = { ...c, pos: [c.pos[0], c.pos[1] + gy(c.pos[0], c.pos[2]), c.pos[2]], look: [c.look[0], c.look[1] + gy(c.pos[0], c.pos[2]), c.look[2]] };
  }, c);
  await sleep(2500);
  const file = path.join(out, `${c.id}.png`);
  await page.screenshot({ path: file });
  console.log(c.id, path.relative(ROOT, file), c.note || '');
}
console.log('errors', errors.length ? errors : 'none');
await L.browser.close();
