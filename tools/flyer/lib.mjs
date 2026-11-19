// BENTONVILLE ROYALE — shared plumbing for tools/flyer/capture.mjs and preview.mjs: find or start
// a Vite dev server, launch WebGL Chromium (tools/qa/lib/browser.mjs), boot the game.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithWebGL, attachDiagnostics, newSink, seedStorage, sleep, dismissFlyer } from '../qa/lib/browser.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const NEWS_DIR = path.join(ROOT, 'public/ui/news');
export const SETTINGS_KEY = 'bentonville-royale.settings.v1';
export const NAME_KEY = 'bentonville-royale.playerName';
export const FLYER_SEEN_KEY = 'bentonville-royale.seenFlyer';
export { launchWithWebGL, attachDiagnostics, newSink, seedStorage, sleep, dismissFlyer };

/** Tiny argv parser: --key value / --flag. `spec` maps key -> 'string' | 'number' | 'bool'. */
export function parseArgs(argv, spec) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument: ${k}`);
    const key = k.slice(2);
    const t = spec[key];
    if (!t) throw new Error(`unknown argument: ${k}`);
    if (t === 'bool') a[key] = true;
    else {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${k}`);
      const v = argv[++i];
      a[key] = t === 'number' ? Number(v) : v;
      if (t === 'number' && !Number.isFinite(a[key])) throw new Error(`${k} needs a number`);
    }
  }
  return a;
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * A dev server to use: `url` when given (must answer), else a new `vite` on 127.0.0.1:`port`
 * (loopback only, unlike `npm run dev`). Returns { url, stop() }.
 */
export async function devServer({ url = null, port = 5199, log = console.log } = {}) {
  if (url) {
    if (!(await reachable(url))) throw new Error(`no server answering at ${url} (start one with: npm run dev)`);
    return { url, stop: async () => {} };
  }
  const own = `http://127.0.0.1:${port}/`;
  if (await reachable(own)) throw new Error(`port ${port} is already in use; pass --url ${own} to reuse that server, or --port N`);
  const vite = path.join(ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let errText = '';
  child.stderr.on('data', (d) => (errText += d));
  child.stdout.on('data', () => {});
  const stop = async () => {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  for (let i = 0; i < 120; i++) {
    if (child.exitCode != null) throw new Error('vite exited: ' + errText.slice(0, 500));
    if (await reachable(own)) {
      log(`[server] started vite on ${own}`);
      return { url: own, stop };
    }
    await sleep(500);
  }
  await stop();
  throw new Error('vite did not answer within 60 s');
}

/** A fresh browser context + page with seeded storage and diagnostics. */
export async function newPage(browser, { width, height, scale = 1, storage = {}, sink = newSink(), tag = '', serverUrl = null }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await seedStorage(context, { [NAME_KEY]: 'Flyer Bot', ...storage });
  const page = await context.newPage();
  if (serverUrl) {
    // Answer Vite's HMR websocket ourselves and say nothing: a source file saved while we capture
    // (another agent, an editor) must not reload the page back to the title screen mid-shot.
    const origin = new URL(serverUrl).host;
    await page.routeWebSocket((u) => u.host === origin, () => {});
  }
  attachDiagnostics(page, sink, tag);
  return { context, page, sink };
}

/** Load the title screen, then start `mode` (sandbox | museum) and wait for play. */
export async function bootGame(page, url, mode = 'sandbox', { timeout = 180000 } = {}) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  const act = mode === 'museum' ? 'museum' : 'freebuild';
  await page.waitForSelector(`[data-act="${act}"]`, { state: 'attached', timeout: 60000 });
  await sleep(1200);
  await dismissFlyer(page);
  await page.evaluate((a) => document.querySelector(`[data-act="${a}"]`).click(), act);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const st = await page.evaluate(() => (window.__game ? window.__game.state : null)).catch(() => null);
    if (st === 'play') break;
    await sleep(500);
  }
  const st = await page.evaluate(() => (window.__game ? window.__game.state : null));
  if (st !== 'play') throw new Error(`${mode} did not start (state ${st})`);
  const dev = await page.evaluate(() => !!(window.__game && window.__game.raw));
  if (!dev) throw new Error('window.__game.raw is null: capture needs a Vite dev server, not a production build');
  await page.evaluate(() => import('/tools/flyer/page/studio.js').then((S) => (window.__flyerStudio = S)));
  return Date.now() - t0;
}
