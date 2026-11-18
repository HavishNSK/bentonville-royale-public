#!/usr/bin/env node
// Multiplayer smoke: one host + N clients in separate browser contexts over the real local
// relay (`npm run party:dev`, ws://localhost:1999). See README.md.
//
//   node tools/qa/mp.mjs --url http://localhost:5173 [--clients 2] [--out tools/qa/out/mp] [--headed]
//
// Checks: private lobby join + start, every page reaches the match, a client-placed wall and
// edit show up identically on the host and the other clients, a host-placed wall reaches the
// clients, a chest opened by a client is opened everywhere, a client moving itself 400 m in
// one tick (no debug hook) is NOT accepted by the host, client disconnect, host leaving.
// Writes report.json (+ screenshots, page diagnostics); exits 1 on any failed check.
//
// Approach adapted (ideas, not code) from je55pr/zombonz PR #214 (two-context smoke over the
// real room server, bounded run, diagnostics kept on failure) and jbcom/game-harness (MIT).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWithWebGL, attachDiagnostics, newSink, seedStorage, sleep } from './lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONITOR = readFileSync(path.join(HERE, 'lib/monitor.js'), 'utf8');
const NAME_KEY = 'bentonville-royale.playerName';

const args = { url: null, clients: 2, out: path.join(HERE, 'out', 'mp'), headed: false };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--url') args.url = a[++i];
    else if (a[i] === '--clients') args.clients = Number(a[++i]);
    else if (a[i] === '--out') args.out = path.resolve(a[++i]);
    else if (a[i] === '--headed') args.headed = true;
    else throw new Error(`unknown argument: ${a[i]}`);
  }
  if (!args.url) throw new Error('--url is required');
}
mkdirSync(args.out, { recursive: true });

const checks = [];
const check = (name, ok, data) => {
  checks.push({ name, ok: !!ok, data });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`);
};
const ev = (p, fn, arg) => p.page.evaluate(fn, arg);
const waitFor = (p, fn, arg, timeout = 30000) => p.page.waitForFunction(fn, arg, { timeout, polling: 250 });

async function openPlayer(browser, label, query = '') {
  // 1536x864: below ~1440 wide the global chat panel covers the private-match JOIN controls
  // (see agents/reports/deep-test-2026-11-18.md); this run is about netcode, not that layout bug.
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } });
  await seedStorage(context, { [NAME_KEY]: label });
  await context.addInitScript({ content: MONITOR });
  const page = await context.newPage();
  const sink = newSink();
  attachDiagnostics(page, sink, label);
  await page.goto(args.url + query, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__game && window.__game.game, null, { timeout: 90000 });
  return { label, context, page, sink, shot: (n) => page.screenshot({ path: path.join(args.out, `${label}-${n}.png`) }).catch(() => {}) };
}

async function main() {
  const L = await launchWithWebGL({ headless: !args.headed });
  if (!L) throw new Error('no WebGL2');
  const players = [];
  let fatal = null;
  try {
    // ---- lobby
    const host = await openPlayer(L.browser, 'Host');
    players.push(host);
    await host.page.click('[data-act=private]');
    await host.page.click('[data-act=host]');
    await host.page.waitForFunction(() => /^[A-Z]{4}$/.test((document.querySelector('.mn-room [data-ref=code]') || {}).textContent || ''), null, { timeout: 30000 });
    const code = await host.page.$eval('.mn-room [data-ref=code]', (e) => e.textContent.trim());
    check('host opened a room', /^[A-Z]{4}$/.test(code), { code });
    for (let i = 0; i < args.clients; i++) {
      const c = await openPlayer(L.browser, `Client${i + 1}`, `?room=${code}`);
      players.push(c);
      // ?room=CODE pre-opens the private panel; only toggle it when it is still closed
      if (await c.page.$eval('[data-ref=private]', (e) => e.hidden).catch(() => true)) await c.page.click('[data-act=private]');
      await c.page.fill('.mn-private [data-ref=code]', code);
      await c.page.click('[data-act=join]');
      await c.page.waitForSelector('[data-act=lobby-ready]', { state: 'visible', timeout: 30000 });
      // a READY click while the lobby still says "Joining…" is dropped (deep-test report, S3);
      // wait for our own name in the player list so the netcode checks below still run
      await c.page.waitForFunction((n) => [...document.querySelectorAll('[data-act=lobby-ready]')].some((b) => b.offsetParent) && document.body.innerText.includes(n) && !/Joining/.test(document.body.innerText), `Client${i + 1}`, { timeout: 30000 });
      await c.page.click('[data-act=lobby-ready]');
    }
    await host.page.waitForFunction((n) => document.querySelectorAll('.mn-lobby li, [data-ref=players] > *').length >= n, args.clients + 1, { timeout: 30000 }).catch(() => {});
    await sleep(1000);
    await host.page.click('[data-act=lobby-start]');
    for (const p of players) await waitFor(p, () => ['drop', 'play'].includes(window.__game.state), null, 120000);
    check('every page reached the match', true, { roles: await Promise.all(players.map((p) => ev(p, () => window.__game.role))) });
    const clients = players.slice(1);

    // ---- everyone lands next to each other (host teleports itself; clients via the dev hook)
    await sleep(2500);
    // everyone jumps for real and glides down (no teleport while the bus is a collider overhead)
    for (const p of players) await ev(p, () => window.__game.debug.drop());
    for (const p of players) {
      await waitFor(p, () => window.__game.state === 'play' && window.__game.player.mode === 'ground', null, 120000);
    }
    await sleep(1500);
    // then gather on the host's open spot (dev-only client teleport hook)
    const spot = await ev(host, () => window.__game.debug.openSpot(200));
    for (const [i, p] of players.entries()) {
      if (i) await ev(p, (s) => window.__game.debug.teleport(s.x + s.i * 6, s.z), { ...spot, i });
    }
    await sleep(2500);
    await host.shot('landed');
    // host view of every client vs the client's own position
    for (const c of players.slice(1)) {
      const own = await ev(c, () => ({ id: window.__game.game.net.id, ...window.__game.player.position }));
      const seen = await ev(host, (id) => window.__game.debug.net.actors().find((a) => a.id === id), own.id);
      const d = seen ? Math.hypot(seen.x - own.x, seen.y - own.y, seen.z - own.z) : null;
      check(`host and ${c.label} agree on its position`, d != null && d < 3, { own, seen, d });
    }

    // ---- build sync: client 1 places a wall north of itself; host + client 2 must see the same piece
    const c1 = clients[0];
    await ev(c1, () => window.__game.debug.give('wood'));
    await sleep(800);
    await ev(c1, () => window.__game.debug.look(0, 0));
    const why = await ev(c1, () => ({ plan: window.__game.debug.plan('wall'), mats: window.__game.player.mats, pos: window.__game.player.position, state: window.__game.state, mode: window.__game.player.mode }));
    const placed = { ...(await ev(c1, () => window.__game.debug.build('wall'))), why };
    await sleep(1500);
    const keys = async (p) => (await ev(p, () => window.__game.debug.net.structures())).map((s) => s.key + ':' + s.mat + ':' + s.edit).sort();
    let ks = await Promise.all(players.map(keys));
    check('client wall placed', placed.placed, placed);
    check('client wall reached host and all clients', ks.every((k) => k.length >= 1 && JSON.stringify(k) === JSON.stringify(ks[0])), ks);

    // ---- edit sync (window cut in the client's wall)
    // the real client path (Player._confirmEdit): ask the host; debug.edit() would only edit locally
    const edited = await ev(c1, () => {
      const g = window.__game.game;
      const piece = g.structures.pieces.filter((q) => q.kind === 'wall').pop();
      if (!piece) return null;
      g.net.action({ k: 'e', key: piece.key, ed: 0b000010000 });
      return { key: piece.key };
    });
    await sleep(1500);
    ks = await Promise.all(players.map(keys));
    check('client edit identical everywhere', edited && JSON.stringify(ks.map((k) => k.join())) === JSON.stringify(ks.map(() => ks[0].join())), { edited, ks });

    // ---- host build reaches clients
    await ev(host, () => {
      window.__game.debug.give('brick');
      window.__game.debug.look(Math.PI, 0);
    });
    const hp = await ev(host, () => window.__game.debug.build('wall'));
    await sleep(1500);
    ks = await Promise.all(players.map(keys));
    check('host wall reached clients', hp.placed && ks.every((k) => JSON.stringify(k) === JSON.stringify(ks[0]) && k.length >= (placed.placed ? 2 : 1)), { hp, ks });

    // ---- loot sync: client 1 goes to the nearest chest and opens it
    const chest = await ev(host, () => {
      const g = window.__game.game;
      const p = g.player.pos;
      let best = null;
      const d = (r) => Math.hypot(r.x - p.x, r.z - p.z);
      for (const r of g.loot.records) if (r.kind === 'chest' && !r.opened && (!best || d(r) < d(best))) best = r;
      return best ? { id: best.id, x: best.x, y: best.y, z: best.z } : null;
    });
    if (chest) {
      await ev(c1, (c) => window.__game.debug.teleport(c.x + 1, c.z, c.y), chest);
      await sleep(1500);
      const it = await ev(c1, () => window.__game.debug.interact());
      await sleep(2500);
      const opened = await Promise.all(players.map((p) => ev(p, (id) => {
        const r = window.__game.game.loot.records.find((x) => x.id === id);
        return r ? !!r.opened : 'missing';
      }, chest.id)));
      check('chest opened by client is opened everywhere', opened.every((o) => o === true), { it, opened });
    } else check('found a chest for the loot test', false);

    // ---- cheat probe: client moves itself 400 m in one tick WITHOUT the debug hook
    // (host makes the client invulnerable first so a bot can't kill it mid-probe)
    await ev(host, (id) => {
      const a = window.__game.game.combat.actors.find((x) => x.id === id);
      if (a) a.invulnerable = a.god = true;
    }, await ev(c1, () => window.__game.game.net.id));
    const before = await ev(host, (id) => window.__game.debug.net.actors().find((a) => a.id === id), await ev(c1, () => window.__game.game.net.id));
    await ev(c1, () => {
      const p = window.__game.game.player;
      p.pos.x += 400;
    });
    await sleep(1500);
    const after = await ev(host, (id) => window.__game.debug.net.actors().find((a) => a.id === id), await ev(c1, () => window.__game.game.net.id));
    const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : null;
    check('host rejects a 400 m one-tick client move', moved != null && moved < 50 && after.alive, { before, after, moved });
    await c1.shot('after-cheat');

    // ---- client 2 disconnects: host keeps running, no page errors
    if (clients[1]) {
      const id2 = await ev(clients[1], () => window.__game.game.net.id);
      await clients[1].context.close();
      await sleep(4000);
      const gone = await ev(host, (id) => {
        const a = window.__game.debug.net.actors().find((x) => x.id === id);
        return a ? { alive: a.alive } : null;
      }, id2);
      check('host survives client disconnect', (await ev(host, () => window.__game.state)) === 'play', { departed: gone });
    }

    // ---- host leaves: client 1 must end up out of the match without errors
    await ev(host, () => window.__game.game.leave());
    await sleep(5000);
    const c1State = await ev(c1, () => ({ state: window.__game.state, result: window.__game.result, errors: window.__game.errors }));
    check('client handles host leaving', c1State.state === 'over' || c1State.state === 'menu', c1State);
    await c1.shot('host-left');
  } catch (e) {
    fatal = String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e);
    check('run completed', false, { fatal });
    for (const p of players) await p.shot('fatal');
  }
  const pages = [];
  for (const p of players) {
    const qa = await p.page.evaluate(() => (window.__qa ? window.__qa.report() : null)).catch(() => null);
    const gameErrors = await p.page.evaluate(() => window.__game.errors).catch(() => null);
    pages.push({ label: p.label, qa, gameErrors, ...p.sink });
    for (const v of (qa && qa.violations) || []) check(`${p.label} invariant ${v.kind} ${v.subject}`, false, v.detail);
    if (p.sink.pageErrors.length) check(`${p.label} no page errors`, false, p.sink.pageErrors);
    if (gameErrors && gameErrors.length) check(`${p.label} no game errors`, false, gameErrors);
  }
  await L.browser.close();
  const file = path.join(args.out, 'report.json');
  writeFileSync(file, JSON.stringify({ url: args.url, at: new Date().toISOString(), checks, pages }, null, 2));
  console.log(`[report] ${file}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
