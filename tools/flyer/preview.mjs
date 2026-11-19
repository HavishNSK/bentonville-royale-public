#!/usr/bin/env node
// BENTONVILLE ROYALE — screenshot the update flyer as players see it (see README.md).
//
//   node tools/flyer/preview.mjs [--version x.y.z | --flyer path/to/draft.mjs] [--images dir]
//        [--out tools/flyer/out/preview] [--url http://localhost:5173/ | --port 5199] [--headed]
//
// Opens the title screen with fresh storage (so the flyer opens by itself, as on a player's first
// launch after an update) at desktop 1440x900 and phone 390x844, and saves one PNG per screenful
// of the card (it scrolls) to <out>/<viewport>-<n>.png. Also reports layout problems: broken
// images, elements wider than the card, text overflowing its box. Exit 1 if any were found.
//
// --flyer / --version serve a draft FLYER module (tools/flyer/drafts/<version>.mjs, same shape
// as src/data/updateFlyer.js) in place of the real one; --images serves /ui/news/<file> from a
// capture --out dir first (falling back to public/ui/news), to preview images before copying them.
import { mkdirSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { FLYER } from '../../src/data/updateFlyer.js';
import { parseArgs, devServer, launchWithWebGL, newPage, sleep, HERE, SETTINGS_KEY } from './lib.mjs';

const USAGE = `usage: node tools/flyer/preview.mjs [--version x.y.z | --flyer draft.mjs] [--images dir]
       [--out dir] [--url http://localhost:5173/ | --port 5199] [--headed]`;
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, scale: 1 },
  { name: 'phone', width: 390, height: 844, scale: 2 },
];
const log = (...m) => console.log(...m);

/** Runs in the page: what is wrong with the open flyer's layout. */
function auditFlyer() {
  const root = document.querySelector('.ufl.is-open');
  if (!root) return { open: false, problems: ['flyer is not open'] };
  const card = root.querySelector('.ufl-card');
  const problems = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${vw})`);
  if (card.scrollWidth > card.clientWidth + 1) problems.push(`card scrolls sideways (${card.scrollWidth} > ${card.clientWidth})`);
  const cr = card.getBoundingClientRect();
  for (const img of root.querySelectorAll('img')) {
    if (!img.complete || img.naturalWidth === 0) problems.push(`image did not load: ${img.getAttribute('src')}`);
  }
  for (const el of root.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > cr.right + 1 || r.left < cr.left - 1) problems.push(`wider than the card: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(cr.left)}..${Math.round(cr.right)}`);
    else if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') problems.push(`text clipped: <${el.tagName.toLowerCase()} class="${el.className}"> "${(el.textContent || '').slice(0, 40)}"`);
  }
  // the footer (LET'S GO) sticks to the bottom of the card and covers what scrolls under it
  const foot = root.querySelector('.ufl-foot');
  const footH = foot ? foot.getBoundingClientRect().height : 0;
  const step = Math.max(100, Math.floor(card.clientHeight - footH - 40));
  return { open: true, problems: [...new Set(problems)].slice(0, 30), scrollHeight: card.scrollHeight, clientHeight: card.clientHeight, step, version: (root.querySelector('.ufl-kicker-ver') || {}).textContent };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2), { version: 'string', flyer: 'string', images: 'string', out: 'string', url: 'string', port: 'number', headed: 'bool', help: 'bool' });
  } catch (err) {
    console.error(err.message + '\n' + USAGE);
    return 2;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  let draft = null;
  if (args.flyer) draft = path.resolve(args.flyer);
  else if (args.version && args.version !== FLYER.version) draft = path.join(HERE, 'drafts', args.version + '.mjs');
  if (draft && !existsSync(draft)) {
    console.error(`no draft flyer at ${draft} (current FLYER.version is ${FLYER.version})`);
    return 2;
  }
  const draftSrc = draft ? readFileSync(draft, 'utf8') : null;
  if (draftSrc && /^\s*import\s/m.test(draftSrc)) {
    console.error('a draft flyer must be a plain module with no imports (export const FLYER = {...})');
    return 2;
  }
  const images = args.images ? path.resolve(args.images) : null;
  const out = path.resolve(args.out || path.join(HERE, 'out/preview'));
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out)) if (/^(desktop|phone)-\d+\.png$/.test(f)) rmSync(path.join(out, f));

  const server = await devServer({ url: args.url, port: args.port || 5199, log });
  const gpu = await launchWithWebGL({ headless: !args.headed });
  if (!gpu) {
    await server.stop();
    console.error('[gpu] no WebGL2 in Chromium (see tools/qa/README.md)');
    return 1;
  }
  let bad = 0;
  const files = [];
  try {
    for (const vp of VIEWPORTS) {
      // fresh storage: the flyer has never been seen, so it opens by itself on the title screen
      const { context, page, sink } = await newPage(gpu.browser, { ...vp, storage: { [SETTINGS_KEY]: JSON.stringify({ quality: 'low', volume: 0 }) }, tag: vp.name, serverUrl: server.url });
      if (draftSrc) await page.route(/\/src\/data\/updateFlyer\.js(\?.*)?$/, (r) => r.fulfill({ contentType: 'text/javascript', body: draftSrc }));
      if (images)
        await page.route(/\/ui\/news\/[^/?]+(\?.*)?$/, (r) => {
          const name = path.basename(new URL(r.request().url()).pathname);
          const f = path.join(images, name);
          if (existsSync(f)) return r.fulfill({ contentType: name.endsWith('.png') ? 'image/png' : 'image/jpeg', body: readFileSync(f) });
          return r.continue();
        });
      await page.goto(server.url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector('.ufl.is-open', { timeout: 30000 }).catch(() => {});
      await sleep(700); // open animation (0.38 s)
      // images are lazy: scroll the card through once so every one loads
      await page.evaluate(async () => {
        const c = document.querySelector('.ufl.is-open .ufl-card');
        if (!c) return;
        for (let y = 0; y <= c.scrollHeight; y += c.clientHeight / 2) {
          c.scrollTop = y;
          await new Promise((r) => setTimeout(r, 120));
        }
        await Promise.all([...c.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => (i.onload = i.onerror = r)))));
        c.scrollTop = 0;
      });
      await sleep(200);
      const audit = await page.evaluate(auditFlyer);
      if (!audit.open) {
        log(`[${vp.name}] FAIL: the flyer did not open`);
        bad++;
      } else {
        const pages = 1 + Math.max(0, Math.ceil((audit.scrollHeight - audit.clientHeight) / audit.step));
        for (let i = 0; i < pages; i++) {
          await page.evaluate((y) => (document.querySelector('.ufl.is-open .ufl-card').scrollTop = y), i * audit.step);
          await sleep(150);
          const file = path.join(out, `${vp.name}-${i + 1}.png`);
          await page.screenshot({ path: file });
          files.push(file);
        }
        log(`[${vp.name}] ${vp.width}x${vp.height}  flyer ${audit.version}  ${pages} screenful(s)  ${audit.problems.length ? audit.problems.length + ' problem(s)' : 'no layout problems'}`);
        for (const p of audit.problems) log(`  - ${p}`);
        bad += audit.problems.length;
      }
      for (const e of sink.pageErrors) log(`  [pageerror] ${e}`);
      for (const e of sink.failedRequests.filter((u) => /\/ui\/news\//.test(u))) {
        log(`  [image request failed] ${e}`);
        bad++;
      }
      await context.close();
    }
  } finally {
    await gpu.browser.close().catch(() => {});
    await server.stop();
  }
  for (const f of files) log('[shot] ' + path.relative(process.cwd(), f));
  log(JSON.stringify({ ok: !bad, problems: bad, files }));
  return bad ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[fatal] ' + (err && err.stack ? err.stack : err));
    process.exit(1);
  },
);
