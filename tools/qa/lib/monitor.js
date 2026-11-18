// In-page invariant monitor for Bentonville Royale. Injected by playtest.mjs / mp.mjs with
// page.addInitScript(); waits for window.__game and then samples game state every 250 ms,
// recording each violation once per (kind, subject) with the state that tripped it.
//
// Idea adapted from per-tick invariant harnesses (Math-Quest-Web/Math-Quest PR #19,
// techilounge/resolveops-ai PR #19): check rules every tick instead of eyeballing a run.
// Read with window.__qa.report(); window.__qa.reset() starts a fresh window (keeps baselines).
/* eslint-disable no-undef */
(function installQaMonitor() {
  if (window.__qa) return;
  const qa = {
    violations: [],
    warnings: [],
    seen: new Set(),
    samples: 0,
    frames: [],
    maxGapMs: 0,
    lastRaf: 0,
    stormR: null,
    lastState: null,
    errorsSeen: 0,
    botStill: new Map(),
    matchIndex: 0,
  };
  window.__qa = qa;
  const BAD = (kind, subject, detail) => {
    const key = kind + '|' + subject;
    if (qa.seen.has(key)) return;
    qa.seen.add(key);
    qa.violations.push({ kind, subject, detail, t: Math.round(performance.now()), match: qa.matchIndex, state: qa.lastState });
  };
  const WARN = (kind, subject, detail) => {
    const key = 'w:' + kind + '|' + subject;
    if (qa.seen.has(key)) return;
    qa.seen.add(key);
    qa.warnings.push({ kind, subject, detail, t: Math.round(performance.now()), match: qa.matchIndex, state: qa.lastState });
  };
  const fin = (...v) => v.every((n) => Number.isFinite(n));
  const r2 = (n) => Math.round(n * 100) / 100;

  // frame-time watchdog (only while the tab is visible: background tabs throttle rAF)
  function raf(ts) {
    if (qa.lastRaf && document.visibilityState === 'visible') {
      const gap = ts - qa.lastRaf;
      qa.frames.push(gap);
      if (qa.frames.length > 600) qa.frames.shift();
      if (gap > qa.maxGapMs) qa.maxGapMs = gap;
      if (gap > 3000) BAD('frame-stall', 'raf', { gapMs: Math.round(gap) });
    }
    qa.lastRaf = ts;
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  const STATES = new Set(['menu', 'loading', 'drop', 'play', 'over']);

  function sample() {
    const G = window.__game;
    if (!G || !G.game) return;
    const g = G.game;
    qa.samples++;
    const st = g.state;
    if (!STATES.has(st)) BAD('bad-state', String(st), {});
    if (st === 'drop' && qa.lastState !== 'drop') {
      qa.matchIndex++;
      qa.stormR = null;
      qa.botStill.clear();
    }
    qa.lastState = st;

    // game.errors is the game's own caught-error log
    const errs = g.errors || [];
    if (errs.length > qa.errorsSeen) {
      for (const e of errs.slice(qa.errorsSeen)) BAD('game-error', String(e).slice(0, 120), { message: String(e) });
    }
    qa.errorsSeen = errs.length;

    if (st !== 'play' && st !== 'drop' && st !== 'over') return;
    const w = g.world;
    const b = w && w.bounds;
    const p = g.player;
    if (p) {
      const { x, y, z } = p.pos;
      if (!fin(x, y, z)) BAD('nan-position', 'player', { x, y, z, mode: p.mode });
      if (!fin(p.health, p.shield)) BAD('nan-health', 'player', { health: p.health, shield: p.shield });
      if (p.health < 0 || p.health > 100.001 || p.shield < 0 || p.shield > 100.001) BAD('health-range', 'player', { health: p.health, shield: p.shield });
      if (p.alive && p.health <= 0 && !p.downed) BAD('alive-at-zero', 'player', { health: p.health });
      if (b && fin(x, z) && !p.inBus && (x < b.minX - 80 || x > b.maxX + 80 || z < b.minZ - 80 || z > b.maxZ + 80)) BAD('out-of-bounds', 'player', { x: r2(x), z: r2(z), bounds: b, mode: p.mode });
      if (w && p.alive && !p.inBus && p.mode === 'ground' && p.grounded && fin(x, y, z)) {
        const th = w.terrainHeight(x, z);
        if (y < th - 1.2) BAD('below-terrain', 'player', { x: r2(x), y: r2(y), z: r2(z), terrain: r2(th), surface: p.surface, swimming: !!p.swimming });
      }
      const inv = p.inventory;
      if (inv) {
        for (const [k, v] of Object.entries(inv.ammo || {})) if (!Number.isInteger(v) || v < 0 || v > 999) BAD('ammo-range', k, { v });
        for (const [k, v] of Object.entries(inv.mats || {})) if (!Number.isInteger(v) || v < 0 || v > 999) BAD('mats-range', k, { v });
        if (!Array.isArray(inv.slots) || inv.slots.length !== 5) BAD('slots-shape', 'player', { len: inv.slots && inv.slots.length });
        for (const s of inv.slots || []) {
          if (s && s.type === 'weapon' && (!Number.isInteger(s.mag) || s.mag < 0)) BAD('mag-range', s.id, { mag: s.mag });
          if (s && s.type === 'consumable' && (!Number.isInteger(s.count) || s.count <= 0)) BAD('consumable-count', s.id, { count: s.count });
        }
        if (inv.selected < -1 || inv.selected > 4) BAD('selected-range', 'player', { selected: inv.selected });
      }
    }

    const actors = (g.combat && g.combat.actors) || [];
    let alive = 0;
    const now = performance.now();
    for (const a of actors) {
      if (a.alive) alive++;
      if (a === p) continue;
      const { x, y, z } = a.pos;
      const who = (a.isPlayer ? 'player' : 'bot') + ':' + a.id;
      if (!fin(x, y, z)) BAD('nan-position', who, { x, y, z, state: a.botState });
      if (!fin(a.health, a.shield)) BAD('nan-health', who, { health: a.health, shield: a.shield });
      if (a.alive && !a.downed && a.health <= 0) BAD('alive-at-zero', who, { health: a.health });
      if (a.health > 100.001 || a.shield > 100.001 || a.health < 0 || a.shield < 0) BAD('health-range', who, { health: a.health, shield: a.shield });
      if (b && a.alive && !a.inBus && fin(x, z) && (x < b.minX - 80 || x > b.maxX + 80 || z < b.minZ - 80 || z > b.maxZ + 80)) BAD('out-of-bounds', who, { x: r2(x), z: r2(z), state: a.botState });
      if (w && a.alive && !a.inBus && a.grounded && fin(x, y, z)) {
        const th = w.terrainHeight(x, z);
        if (y < th - 1.2) WARN('below-terrain', who, { x: r2(x), y: r2(y), z: r2(z), terrain: r2(th), state: a.botState });
      }
      // stuck bots: alive, landed, in play, not moved > 1 m for 45 s
      if (st === 'play' && a.alive && !a.inBus && !a.isRemote && a.botState !== undefined) {
        const s = qa.botStill.get(a.id);
        if (!s || Math.hypot(s.x - x, s.z - z) > 1) qa.botStill.set(a.id, { x, z, t: now });
        else if (now - s.t > 45000 && !a.downed) WARN('bot-stuck', who, { x: r2(x), y: r2(y), z: r2(z), state: a.botState, secs: Math.round((now - s.t) / 1000) });
      }
    }
    if (g.combat && g.combat.aliveCount !== alive) BAD('alive-count', 'combat', { counted: alive, reported: g.combat.aliveCount });

    const s = g.storm;
    if (s && st !== 'over') {
      if (!fin(s.cx, s.cz, s.r) || s.r < 0) BAD('storm-shape', 'storm', { cx: s.cx, cz: s.cz, r: s.r });
      if (qa.stormR != null && s.r > qa.stormR + 0.01) BAD('storm-grew', 'storm', { from: qa.stormR, to: s.r, phase: s.phase, mode: s.mode });
      if (fin(s.r)) qa.stormR = s.r;
    }
    if (st === 'over') {
      const r = g.result;
      if (!r) BAD('no-result', 'match', {});
      else if (!(r.placement >= 1 && r.placement <= (r.teams || r.total || 999))) BAD('placement-range', 'match', { placement: r.placement, total: r.total, teams: r.teams });
    }
  }
  setInterval(() => {
    try {
      sample();
    } catch (e) {
      BAD('monitor-threw', String(e && e.message).slice(0, 80), { stack: String(e && e.stack).slice(0, 300) });
    }
  }, 250);

  qa.fps = () => {
    const f = qa.frames.slice(-300);
    if (!f.length) return null;
    const avg = f.reduce((s, v) => s + v, 0) / f.length;
    const sorted = f.slice().sort((x, y) => x - y);
    return { avgFps: Math.round(1000 / avg), p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]), maxGapMs: Math.round(qa.maxGapMs) };
  };
  qa.report = () => ({ violations: qa.violations, warnings: qa.warnings, samples: qa.samples, fps: qa.fps() });
})();
