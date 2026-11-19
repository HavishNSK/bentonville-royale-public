#!/usr/bin/env node
// Renders the skin lab (/skinlab.html) to PNGs with the headless Chromium from tools/qa.
//
//   node tools/skins/render.mjs --skin skin_rogue_ember
//   node tools/skins/render.mjs --recipe tools/skins/examples/catfish-ken.json
//   node tools/skins/render.mjs --swatches player
//   node tools/skins/render.mjs --probe bot_a
//   node tools/skins/render.mjs --all
//   options: --url http://localhost:5173  reuse a running dev server (else one is started on
//            127.0.0.1 and stopped afterwards) --out tools/skins/out  --timeout 60000
//
// Several modes may be combined in one run (--skin a --skin b --all). Prints each PNG path.
// Needs tools/qa set up once: cd tools/qa && npm i && npx playwright install chromium

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QA_LIB = path.join(ROOT, 'tools/qa/lib/browser.mjs');

function usage(msg) {
  if (msg) console.error('render: ' + msg);
  console.error('usage: node tools/skins/render.mjs (--skin <id> | --recipe <file.json> | --swatches <kit> | --probe <kit> | --all)... [--url <dev server>] [--out <dir>] [--timeout <ms>]');
  process.exit(2);
}

function parseArgs(argv) {
  const jobs = [];
  const o = { url: null, out: path.join(ROOT, 'tools/skins/out'), timeout: 60000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v == null || v.startsWith('--')) usage(`${a} needs a value`);
      return v;
    };
    if (a === '--skin') jobs.push({ kind: 'skin', arg: val() });
    else if (a === '--recipe') jobs.push({ kind: 'recipe', arg: val() });
    else if (a === '--swatches') jobs.push({ kind: 'swatches', arg: val() });
    else if (a === '--probe') jobs.push({ kind: 'probe', arg: val() });
    else if (a === '--all') jobs.push({ kind: 'all' });
    else if (a === '--url') o.url = val().replace(/\/$/, '');
    else if (a === '--out') o.out = path.resolve(val());
    else if (a === '--timeout') o.timeout = Math.max(5000, Number(val()) || 60000);
    else if (a === '-h' || a === '--help') usage();
    else usage(`unknown argument ${a}`);
  }
  if (!jobs.length) usage('nothing to render');
  return { jobs, o };
}

const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

/** { query, file } for a job; recipe files are read and validated as JSON here. */
async function plan(job) {
  if (job.kind === 'all') return { query: 'all=1', file: 'all.png' };
  if (job.kind === 'recipe') {
    let text;
    try {
      text = fs.readFileSync(path.resolve(job.arg), 'utf8');
    } catch (e) {
      throw new Error(`cannot read recipe ${job.arg}: ${e.code || e.message}`);
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error(`${job.arg} is not valid JSON: ${e.message}`);
    }
    const { encodeRecipe } = await import(pathToFileURL(path.join(ROOT, 'src/game/skinRecipe.js')).href);
    const base = path.basename(job.arg).replace(/\.json$/i, '').replace(/[^A-Za-z0-9_.-]/g, '_');
    return { query: 'recipe=' + encodeRecipe(obj), file: `recipe-${base}.png` };
  }
  if (!SAFE.test(job.arg)) throw new Error(`bad ${job.kind} name ${JSON.stringify(job.arg)}`);
  if (job.kind === 'skin') return { query: 'skin=' + encodeURIComponent(job.arg), file: `${job.arg}.png` };
  return { query: `${job.kind}=${encodeURIComponent(job.arg)}`, file: `${job.kind}-${job.arg}.png` };
}

async function reachable(url) {
  try {
    const r = await fetch(url + '/skinlab.html', { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Starts `vite` on 127.0.0.1 (never the network) and resolves once it answers. */
async function startVite(timeout) {
  const port = await freePort();
  const bin = path.join(ROOT, 'node_modules/.bin/vite');
  if (!fs.existsSync(bin)) throw new Error('vite is not installed (run npm ci in the repo root)');
  const child = spawn(bin, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}`;
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (child.exitCode != null) throw new Error('vite exited early:\n' + log.slice(-2000));
    if (await reachable(url)) return { url, stop: () => child.kill('SIGTERM') };
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill('SIGTERM');
  throw new Error('vite did not start in time:\n' + log.slice(-2000));
}

async function main() {
  const { jobs, o } = parseArgs(process.argv.slice(2));
  const plans = [];
  for (const j of jobs) plans.push(await plan(j));
  if (!fs.existsSync(QA_LIB) || !fs.existsSync(path.join(ROOT, 'tools/qa/node_modules/playwright'))) {
    throw new Error('tools/qa is not set up: cd tools/qa && npm i && npx playwright install chromium');
  }
  const { launchWithWebGL, attachDiagnostics, newSink } = await import(pathToFileURL(QA_LIB).href);
  fs.mkdirSync(o.out, { recursive: true });

  let server = null;
  let base = o.url;
  if (base) {
    if (!(await reachable(base))) throw new Error(`${base}/skinlab.html is not reachable (start it with: npm run dev)`);
  } else if (await reachable('http://localhost:5173')) {
    base = 'http://localhost:5173';
    console.log('[server] reusing ' + base);
  } else {
    server = await startVite(o.timeout);
    base = server.url;
    console.log('[server] started ' + base);
  }

  const gl = await launchWithWebGL({ headless: true });
  if (!gl) {
    if (server) server.stop();
    throw new Error('no WebGL2 in headless Chromium (see tools/qa/README.md)');
  }
  let failed = 0;
  try {
    for (const p of plans) {
      const page = await gl.browser.newPage({ viewport: { width: 1700, height: 900 } });
      const sink = newSink();
      attachDiagnostics(page, sink);
      try {
        await page.goto(`${base}/skinlab.html?${p.query}`, { waitUntil: 'load', timeout: o.timeout });
        await page.waitForFunction(() => window.__skinlab && window.__skinlab.ready, null, { timeout: o.timeout });
        const state = await page.evaluate(() => window.__skinlab);
        const file = path.join(o.out, p.file);
        await page.locator('#sheet').screenshot({ path: file });
        if (state.error) {
          failed++;
          console.error(`[error] ${p.file}: ${state.error}`);
        }
        if (state.info && (state.info.errors || []).length) console.error(`[recipe] ${state.info.errors.join(' | ')}`);
        if (state.info && (state.info.warnings || []).length) console.error(`[recipe] warnings: ${state.info.warnings.join(' | ')}`);
        for (const e of sink.pageErrors) console.error('[pageerror] ' + e);
        for (const e of sink.consoleErrors) console.error('[console.error] ' + e);
        if (sink.pageErrors.length) failed++;
        console.log(file);
      } catch (e) {
        failed++;
        console.error(`[error] ${p.file}: ${e.message.split('\n')[0]}`);
        for (const x of sink.pageErrors) console.error('[pageerror] ' + x);
      } finally {
        await page.close();
      }
    }
  } finally {
    await gl.browser.close();
    if (server) server.stop();
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('render: ' + e.message);
  process.exit(1);
});
