#!/usr/bin/env node
// Scripted playtest bot with per-tick invariants for Bentonville Royale. See README.md.
//
//   node tools/qa/playtest.mjs --url http://localhost:5173 [--scenario solo|death|rematch|chromebook|all]
//        [--out tools/qa/out/playtest] [--headed] [--matches 3] [--cpu 4]
//
// Drives the real menus (PLAY / PLAY AGAIN / MAIN MENU buttons) and the game through
// window.__game.debug (headless Chromium has no pointer lock). lib/monitor.js checks game
// invariants every 250 ms; every new violation gets a screenshot. Writes report.json and
// exits 1 if any scenario had a violation, a page error or a game error.
//
// Approach adapted (ideas, not code) from:
//   - Math-Quest-Web/Math-Quest PR #19 (headless playtest bot, per-frame invariants, JSON + screenshots, non-zero exit)
//   - techilounge/resolveops-ai PR #19 (seeded invariant fuzzing over many games)
//   - jbcom/game-harness (MIT) (silent sessions; fail on runtime errors)
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithWebGL, attachDiagnostics, newSink, throttleCpu, seedStorage, sleep, dismissFlyer } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONITOR = readFileSync(path.join(HERE, 'lib/monitor.js'), 'utf8');
const SETTINGS_KEY = 'bentonville-royale.settings.v1';
const NAME_KEY = 'bentonville-royale.playerName';

function parseArgs(argv) {
  const a = { url: null, scenario: 'all', out: path.join(HERE, 'out', 'playtest'), headed: false, matches: 3, cpu: 4 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--url') a.url = v();
    else if (k === '--scenario') a.scenario = v();
    else if (k === '--out') a.out = path.resolve(v());
    else if (k === '--headed') a.headed = true;
    else if (k === '--matches') a.matches = Number(v());
    else if (k === '--cpu') a.cpu = Number(v());
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!a.url) throw new Error('--url is required');
  return a;
}

const log = (...m) => console.log(...m);

/** One scenario = fresh context + page + monitor; returns its report section. */
async function withPage(browser, args, name, opts, fn) {
  const dir = path.join(args.out, name);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 } });
  await seedStorage(context, { [NAME_KEY]: 'QA Bot', [SETTINGS_KEY]: JSON.stringify(opts.settings || {}) });
  await context.addInitScript({ content: MONITOR });
  const page = await context.newPage();
  const sink = newSink();
  attachDiagnostics(page, sink);
  const shots = [];
  let shotN = 0;
  const shot = async (label) => {
    const file = path.join(dir, `${String(++shotN).padStart(2, '0')}-${label.replace(/[^a-z0-9-]+/gi, '_').slice(0, 60)}.png`);
    await page.screenshot({ path: file }).catch(() => {});
    shots.push(file);
    return file;
  };
  // screenshot each new violation as it appears
  let seenV = 0;
  let busy = false;
  const watcher = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const list = await page.evaluate((n) => (window.__qa ? window.__qa.violations.slice(n) : []), seenV).catch(() => []);
      seenV += list.length;
      for (const x of list) {
        const file = await shot('violation-' + x.kind);
        await page.evaluate((a) => {
          const v = window.__qa.violations.find((y) => y.kind === a.kind && y.subject === a.subject);
          if (v) v.screenshot = a.file;
        }, { kind: x.kind, subject: x.subject, file }).catch(() => {});
      }
    } finally {
      busy = false;
    }
  }, 1000);
  const t0 = Date.now();
  const steps = [];
  const step = (s, data) => {
    steps.push({ s, ms: Date.now() - t0, ...(data !== undefined ? { data } : {}) });
    log(`[${name}] ${s}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`);
  };
  if (opts.cpu) await throttleCpu(page, opts.cpu);
  let failure = null;
  try {
    await page.goto(args.url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__game && window.__game.game, null, { timeout: 90000 });
    step('booted', await page.evaluate(() => ({ state: window.__game.state })));
    await fn({ page, step, shot, sink });
  } catch (e) {
    failure = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    step('FAILED', { failure });
    await shot('failure');
  }
  clearInterval(watcher);
  await sleep(1200);
  const qa = await page.evaluate(() => (window.__qa ? window.__qa.report() : null)).catch(() => null);
  const gameErrors = await page.evaluate(() => (window.__game ? window.__game.errors : [])).catch(() => []);
  await context.close();
  return { name, ms: Date.now() - t0, failure, steps, qa, gameErrors, ...sink, screenshots: shots };
}

// ---------------------------------------------------------------- helpers

const state = (page) => page.evaluate(() => window.__game.state);
async function waitState(page, s, timeout = 90000) {
  await page.waitForFunction((want) => window.__game && [].concat(want).includes(window.__game.state), s, { timeout, polling: 250 });
}

/** Menu PLAY (offline: a local match), wait for the bus. */
async function clickPlay(page, step) {
  await page.waitForSelector('[data-act=party-go]', { state: 'visible', timeout: 60000 });
  await sleep(1500); // the update flyer opens shortly after the title screen
  if (await dismissFlyer(page)) step('dismissed update flyer');
  await page.click('[data-act=party-go]');
  await waitState(page, ['drop', 'play'], 120000);
  step('match started', await page.evaluate(() => ({ seed: window.__game.game.seed, bots: window.__game.bots.length, mode: window.__game.game.mode })));
}

/** Jump, glide to the ground for real (no teleport), with a timeout. */
async function dropAndLand(page, step) {
  await sleep(2500);
  await page.evaluate(() => window.__game.debug.drop());
  await page.waitForFunction(() => window.__game.player && window.__game.player.mode === 'ground' && window.__game.state === 'play', null, { timeout: 120000, polling: 250 });
  step('landed', await page.evaluate(() => window.__game.player.position));
}

async function skipStormToEnd(page, step, everyMs = 1500) {
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => {
      window.__game.debug.skipPhase();
      return window.__game.storm;
    });
    if (!s || s.mode === 'done' || (await state(page)) === 'over') break;
    await sleep(everyMs);
  }
  step('storm done', await page.evaluate(() => window.__game.storm));
}

async function memSnapshot(page) {
  return page.evaluate(() => {
    const g = window.__game.game;
    const info = g.renderer && g.renderer.info;
    let objects = 0;
    if (g.scene) g.scene.traverse(() => objects++);
    const sfx = g.sfx || {};
    const size = (x) => (x == null ? null : x.size != null ? x.size : x.length != null ? x.length : Object.keys(x).length);
    return {
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      sceneObjects: objects,
      geometries: info ? info.memory.geometries : null,
      textures: info ? info.memory.textures : null,
      programs: info && info.programs ? info.programs.length : null,
      actors: g.combat ? g.combat.actors.length : null,
      structures: g.structures ? g.structures.count : null,
      lootRecords: g.loot && g.loot.records ? g.loot.records.length : null,
      sfxVoices: size(sfx.voices),
      sfxLoops: size(sfx.loops),
      domNodes: document.getElementsByTagName('*').length,
    };
  });
}

// ---------------------------------------------------------------- scenarios

const SCENARIOS = {
  /** Menu -> bus -> real glide -> 20 s of play -> storm to the end -> win -> result screen -> main menu. */
  async solo(browser, args) {
    return withPage(browser, args, 'solo', {}, async ({ page, step, shot }) => {
      await shot('menu');
      await clickPlay(page, step);
      await shot('bus');
      await dropAndLand(page, step);
      await page.evaluate(() => window.__game.debug.god(true));
      await shot('landed');
      await sleep(20000);
      step('after 20s', await page.evaluate(() => ({ alive: window.__game.alive, fps: window.__qa.fps(), player: window.__game.player.position })));
      await shot('play-20s');
      await skipStormToEnd(page, step);
      await shot('storm-final');
      await page.evaluate(() => window.__game.debug.killAll());
      await waitState(page, 'over', 30000);
      const result = await page.evaluate(() => window.__game.result);
      step('result', result);
      if (!result || !result.victory) throw new Error('expected a victory after killAll, got ' + JSON.stringify(result));
      await sleep(1500);
      await shot('result');
      await page.click('[data-act=menu]');
      await waitState(page, 'menu', 15000);
      step('back at menu');
    });
  },

  /** Die to damage -> defeat screen -> placement sane -> main menu. */
  async death(browser, args) {
    return withPage(browser, args, 'death', {}, async ({ page, step, shot }) => {
      await clickPlay(page, step);
      await dropAndLand(page, step);
      await sleep(3000);
      await page.evaluate(() => window.__game.debug.damagePlayer(500));
      await waitState(page, 'over', 30000);
      const result = await page.evaluate(() => window.__game.result);
      step('result', result);
      if (!result || result.victory) throw new Error('expected a defeat, got ' + JSON.stringify(result));
      await sleep(1500);
      await shot('defeat');
      await page.click('[data-act=menu]');
      await waitState(page, 'menu', 15000);
      step('back at menu');
    });
  },

  /** N matches back to back via PLAY AGAIN; resource counters must not climb per match. */
  async rematch(browser, args) {
    return withPage(browser, args, 'rematch', {}, async ({ page, step, shot }) => {
      const mem = [];
      await clickPlay(page, step);
      for (let m = 0; m < args.matches; m++) {
        if (m > 0) {
          await page.click('[data-act=again]');
          await waitState(page, ['drop', 'play'], 120000);
          step(`match ${m + 1} started`, await page.evaluate(() => ({ seed: window.__game.game.seed, bots: window.__game.bots.length })));
        }
        await dropAndLand(page, step);
        await page.evaluate(() => window.__game.debug.god(true));
        await sleep(8000);
        // build a little so structures have to be cleared between matches
        step(`match ${m + 1} build`, await page.evaluate(() => {
          const d = window.__game.debug;
          d.give('wood');
          const out = [];
          for (let i = 0; i < 4; i++) {
            d.look((i * Math.PI) / 2, 0);
            out.push(d.build('wall').placed);
          }
          return out;
        }));
        const snap = await memSnapshot(page);
        mem.push(snap);
        step(`match ${m + 1} mid`, snap);
        await page.evaluate(() => window.__game.debug.killAll());
        await waitState(page, 'over', 30000);
        await sleep(1500);
        await shot(`result-${m + 1}`);
      }
      const first = mem[0];
      const last = mem[mem.length - 1];
      for (const k of ['sceneObjects', 'geometries', 'textures', 'programs', 'actors', 'lootRecords', 'domNodes', 'sfxLoops']) {
        if (first[k] != null && last[k] != null && last[k] > first[k] * 1.25 + 50) {
          await page.evaluate((x) => window.__qa.violations.push({ kind: 'leak', subject: x.k, detail: x }), { k, first: first[k], last: last[k] });
        }
      }
    });
  },

  /** 1366x768, performance mode, low quality, CPU throttled: boot + play; record FPS; resize mid-match. */
  async chromebook(browser, args) {
    return withPage(browser, args, 'chromebook', { viewport: { width: 1366, height: 768 }, settings: { performanceMode: true, quality: 'low' }, cpu: args.cpu }, async ({ page, step, shot }) => {
      const t = Date.now();
      await shot('menu');
      await clickPlay(page, step);
      step('time to bus ms', { ms: Date.now() - t });
      await dropAndLand(page, step);
      await page.evaluate(() => window.__game.debug.god(true));
      await sleep(30000);
      step('perf after 30s', await page.evaluate(() => ({ fps: window.__qa.fps(), performanceMode: window.__game.game.settings.performanceMode })));
      await shot('play');
      // resize mid-match (window snapping on a Chromebook); the game went fullscreen on the PLAY click
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {});
      await sleep(500);
      await page.setViewportSize({ width: 1000, height: 640 });
      await sleep(1500);
      await shot('resized');
      await page.setViewportSize({ width: 1366, height: 768 });
      await sleep(15000);
      step('perf after resize', await page.evaluate(() => window.__qa.fps()));
    });
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const launched = await launchWithWebGL({ headless: !args.headed });
  if (!launched) {
    log('[gpu] no WebGL2 context with any flag set');
    process.exit(1);
  }
  log(`[gpu] ${launched.flags.join(' ')} -> ${launched.renderer}`);
  const names = args.scenario === 'all' ? Object.keys(SCENARIOS) : args.scenario.split(',');
  const results = [];
  for (const n of names) {
    if (!SCENARIOS[n]) throw new Error(`unknown scenario ${n}`);
    results.push(await SCENARIOS[n](launched.browser, args));
  }
  await launched.browser.close();
  const summary = results.map((r) => ({
    name: r.name,
    ok: !r.failure && !r.pageErrors.length && !r.gameErrors.length && !(r.qa && r.qa.violations.length),
    failure: r.failure,
    violations: r.qa ? r.qa.violations.length : null,
    warnings: r.qa ? r.qa.warnings.length : null,
    pageErrors: r.pageErrors.length,
    consoleErrors: r.consoleErrors.length,
    failedRequests: r.failedRequests.length,
    gameErrors: r.gameErrors.length,
    fps: r.qa && r.qa.fps,
  }));
  const report = { url: args.url, renderer: launched.renderer, at: new Date().toISOString(), summary, results };
  const file = path.join(args.out, 'report.json');
  writeFileSync(file, JSON.stringify(report, null, 2));
  log(`[report] ${file}`);
  log(JSON.stringify(summary));
  process.exit(summary.every((s) => s.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
