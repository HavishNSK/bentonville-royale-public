// BENTONVILLE ROYALE — menu screens: title, settings, loading, pause, result,
// plus the drop-phase banner. DOM only; styles in menus.css (tokens from hud.css).
//
//   const menus = createMenus(root, {
//     settings,                       // current settings object (src/ui/settings.js shape)
//     onPlay(), onSettings(settings), onResume(), onLeave(), onPlayAgain(),
//     onFreeBuild(name),                           // solo sandbox: no bots, no storm, full mats
//     onHost(name), onJoin(code, name),           // private match (main.js lazy-loads src/net)
//     onLobbyStart(), onLobbyLeave(), onLobbyFill(on), onLobbyMode(mode), onLobbyReady(on),
//     onPartyReady(on), onPartyCancel(), onPartyMode(mode), onPartyFill(on),   // party lobby (title)
//     onPartyKick(id), onPartyPromote(id), onPartyJoin(code), onPartyLeave(), onPartyRetry(),
//     onNameChange(name),
//     googleTilesAvailable,          // false -> "Real-world 3D view" toggle shown disabled with a hint
//   });
//   menus.showLobby(info)   info = { isHost, code, link, players:[{id,name,host,ready,you}], max, fill,
//                                   mode, ready (guest's own), status, canStart, error }
//   menus.setParty(view)    title party panel: { online, connecting, code, link, isLeader, mode, fill,
//                                   state: idle|queued|matched, queuedSince (performance.now ms),
//                                   members:[{id,name,ready,leader,you}], match (hand-off status text) }
//   menus.partyNotice(text, isError)
//   menus.showNotice(text)  title screen with a message (host left, room full, ...)
//   menus.playerName()      saved name (localStorage)
//   menus.setSettings(settings)       // update the shown settings without firing onSettings
//   menus.showTitle() / showSettings(from) / showLoading(pct, label) / showPause()
//   menus.showResult({ victory, placement, kills, total, time, killer })
//   menus.showDropBanner(on, secondsLeft, zoneLabel, { title, sub }?)  // Drop Bus banner
//   menus.hideAll()

import './hud.css';
import './menus.css';
import { icon } from './icons.js';
import { QUALITY_OPTIONS, DIFFICULTY_OPTIONS, sanitizeSettings, ACTIONS, DEFAULT_BINDINGS, RESERVED_CODES, keyLabel, rebind } from './settings.js';
import { createFpsMeter } from './fpsMeter.js';
import { MATCH } from '../core/config.js';
import { TEAM_MODES, MODE_LABELS, teamSize } from '../game/Teams.js';

const MODE_IDS = Object.keys(TEAM_MODES);
const PARTY_SLOTS = 4;

// Functions get the current key bindings (tips follow rebinds).
const TIPS = [
  'Swing your pickaxe at trees, rocks and parked cars to gather building materials.',
  (k) => `${k('buildWall')} wall, ${k('buildFloor')} floor, ${k('buildRamp')} ramp, ${k('buildCone')} cone. ${k('cycleMaterial')} switches between wood, brick and metal.`,
  'Shield Tonics stack on top of your health. Drink them before a fight.',
  'The storm hurts more every phase. Watch the timer in the top left.',
  'Chests glow and hum. Listen for them inside buildings.',
  (k) => `Hold ${k('aim')} to aim down sights for tighter shots.`,
  (k) => `Press ${k('inventory')} to open your inventory, then drag guns and heals to reorder your hotbar.`,
  'Headshots deal bonus damage with every weapon.',
];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function hillsSVG() {
  return `<svg class="mn-hills" viewBox="0 0 1600 420" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 250 C 180 170 320 210 470 160 C 640 105 760 200 930 150 C 1100 100 1260 170 1400 130 C 1490 105 1560 120 1600 112 L1600 420 L0 420Z" fill="#5d4fb8" opacity=".55"/>
  <path d="M0 300 C 160 250 300 290 450 250 C 620 205 760 280 940 240 C 1120 200 1250 260 1420 225 C 1500 210 1560 220 1600 214 L1600 420 L0 420Z" fill="#3c2f8f" opacity=".8"/>
  <path d="M0 350 C 200 320 360 352 560 330 C 760 308 900 350 1100 328 C 1300 306 1450 340 1600 322 L1600 420 L0 420Z" fill="#221a5c"/>
</svg>`;
}

export function createMenus(root, opts = {}) {
  let settings = sanitizeSettings(opts.settings);
  const wrap = el('div', 'br-menus');
  root.appendChild(wrap);

  const bg = el('div', 'mn-bg', `<div class="mn-sun"></div>${hillsSVG()}`);
  wrap.appendChild(bg);

  // ---------------------------------------------------------------- title
  const title = el(
    'section',
    'mn-screen mn-title',
    `<div class="mn-logo">
       <div class="mn-logo-top br-ol">BENTONVILLE</div>
       <div class="mn-logo-main br-ol-xl">ROYALE</div>
       <div class="mn-logo-tag">100 players &middot; one town square &middot; build to survive</div>
     </div>
     <div class="mn-party mn-card" aria-label="Party">
       <div class="mn-party-head">
         <span class="mn-party-label">PARTY</span>
         <b class="mn-party-code br-ol" data-ref="pcode">····</b>
         <button type="button" class="mn-chip" data-act="party-copy" data-ref="pcopy"><span>COPY INVITE</span></button>
         <button type="button" class="mn-chip" data-act="party-leave" data-ref="pleave"><span>LEAVE PARTY</span></button>
         <button type="button" class="mn-chip" data-act="party-retry" data-ref="pretry"><span>RECONNECT</span></button>
       </div>
       <ul class="mn-slots" data-ref="slots"></ul>
       <div class="mn-slot-acts" data-ref="slotActs" hidden>
         <span data-ref="slotName"></span>
         <button type="button" class="mn-chip" data-act="party-promote"><span>MAKE LEADER</span></button>
         <button type="button" class="mn-chip mn-chip-danger" data-act="party-kick"><span>KICK</span></button>
         <button type="button" class="mn-chip" data-act="party-unselect"><span>CLOSE</span></button>
       </div>
       <div class="mn-party-opts">
         <div class="mn-seg" data-ref="pmode" role="group" aria-label="Mode">${MODE_IDS.map((m) => `<button type="button" data-mode="${m}">${MODE_LABELS[m]}</button>`).join('')}</div>
         <div class="mn-seg" data-ref="pfill" role="group" aria-label="Fill"><button type="button" data-fill="1">FILL</button><button type="button" data-fill="0">NO FILL</button></div>
       </div>
       <p class="mn-party-status" data-ref="pstatus" role="status" aria-live="polite"></p>
       <button class="mn-btn mn-btn-hero mn-party-go" data-act="party-go">${icon('play')}<span data-ref="pgo">PLAY</span></button>
       <div class="mn-notice" data-ref="notice" role="status"></div>
       <div class="mn-party-foot">
         <label class="mn-name"><span>Name</span><input class="mn-field" data-ref="name" maxlength="16" autocomplete="nickname" spellcheck="false"></label>
         <div class="mn-join">
           <input class="mn-field mn-code" data-ref="pjoin" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Party code to join">
           <button type="button" class="mn-btn" data-act="party-join"><span>JOIN PARTY</span></button>
         </div>
       </div>
     </div>
     <div class="mn-title-side">
       <div class="mn-stack mn-stack-row">
         <button class="mn-btn mn-btn-small" data-act="freebuild">${icon('wall')}<span>FREE BUILD</span></button>
         <button class="mn-btn mn-btn-small" data-act="private" aria-expanded="false" data-ref="privBtn">${icon('people')}<span>PRIVATE MATCH</span></button>
         <button class="mn-btn mn-btn-small" data-act="settings">${icon('gear')}<span>SETTINGS</span></button>
       </div>
       <div class="mn-private" data-ref="private" hidden>
         <button class="mn-btn" data-act="host"><span>HOST PRIVATE MATCH</span></button>
         <div class="mn-join">
           <input class="mn-field mn-code" data-ref="code" maxlength="4" placeholder="ROOM" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code">
           <button class="mn-btn" data-act="join"><span>JOIN</span></button>
         </div>
       </div>
     <div class="mn-controls">
       <span><kbd class="br-key" data-bind="moveForward moveLeft moveBack moveRight">WASD</kbd>move</span><span><kbd class="br-key" data-bind="jump">SPACE</kbd>jump</span>
       <span><kbd class="br-key" data-bind="fire">LMB</kbd>fire</span><span><kbd class="br-key" data-bind="aim">RMB</kbd>aim</span>
       <span><kbd class="br-key" data-bind="interact">E</kbd>loot</span><span><kbd class="br-key" data-bind="buildWall buildFloor buildRamp buildCone">Q C V X</kbd>build</span>
       <span><kbd class="br-key" data-bind="pickaxe">F</kbd>pickaxe</span><span><kbd class="br-key" data-bind="map">M</kbd>map</span>
     </div>
     </div>
     <div class="mn-foot">Map data &copy; OpenStreetMap contributors &middot; An original fan-made game, not affiliated with any other battle royale</div>`
  );
  wrap.appendChild(title);
  const T = {};
  title.querySelectorAll('[data-ref]').forEach((e) => (T[e.dataset.ref] = e));
  const NAME_KEY = 'bentonville-royale.playerName';
  const savedName = () => {
    try {
      return localStorage.getItem(NAME_KEY) || '';
    } catch {
      return '';
    }
  };
  T.name.value = savedName() || 'Player' + Math.floor(100 + Math.random() * 900);
  // keep the generated name too: a refresh must not turn you into someone else in your party
  if (!savedName()) {
    try {
      localStorage.setItem(NAME_KEY, T.name.value);
    } catch {
      /* private mode */
    }
  }
  T.name.addEventListener('change', () => {
    try {
      localStorage.setItem(NAME_KEY, T.name.value.trim().slice(0, 16));
    } catch {
      /* private mode */
    }
    if (opts.onNameChange) opts.onNameChange(T.name.value.trim().slice(0, 16) || 'Player');
    if (partyView && !partyView.online) renderParty();
  });
  for (const [input, act] of [
    [T.code, 'join'],
    [T.pjoin, 'party-join'],
  ]) {
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') title.querySelector(`[data-act=${act}]`).click();
    });
  }

  // ---------------------------------------------------------------- lobby
  const lobby = el(
    'section',
    'mn-screen mn-lobby',
    `<div class="mn-card">
       <h2 class="mn-h br-ol">LOBBY</h2>
       <div class="mn-room"><span>ROOM</span><b class="br-ol" data-ref="code">····</b></div>
       <div class="mn-link"><input class="mn-field" data-ref="link" readonly aria-label="Share link"><button class="mn-btn mn-btn-small" data-act="copy"><span>COPY LINK</span></button></div>
       <div class="mn-roster-head"><span>Players</span><b data-ref="count">0/16</b></div>
       <ul class="mn-roster" data-ref="roster"></ul>
       <div class="mn-row"><span>Mode<small class="mn-hint">Players join teams in the order they joined.</small></span><div class="mn-seg" data-ref="mode" role="group" aria-label="Mode">${MODE_IDS.map((m) => `<button type="button" data-mode="${m}">${MODE_LABELS[m]}</button>`).join('')}</div></div>
       <label class="mn-row"><span>Fill empty spots with bots<small class="mn-hint" data-ref="fillHint"></small></span><input type="checkbox" class="mn-toggle" data-ref="fill"></label>
       <p class="mn-status" data-ref="status" role="status"></p>
       <p class="mn-status mn-error" data-ref="error" role="alert"></p>
       <button class="mn-btn mn-btn-hero" data-act="lobby-start">${icon('play')}<span>START MATCH</span></button>
       <button class="mn-btn mn-btn-hero" data-act="lobby-ready"><span data-ref="readyLabel">READY</span></button>
       <button class="mn-btn mn-btn-small" data-act="lobby-leave">${icon('back')}<span>LEAVE</span></button>
     </div>`
  );
  wrap.appendChild(lobby);
  const LB = {};
  lobby.querySelectorAll('[data-ref]').forEach((e) => (LB[e.dataset.ref] = e));
  LB.fill.addEventListener('change', () => opts.onLobbyFill && opts.onLobbyFill(LB.fill.checked));
  LB.mode.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || !lobbyInfo || !lobbyInfo.isHost) return;
    if (opts.onClick) opts.onClick();
    if (opts.onLobbyMode) opts.onLobbyMode(b.dataset.mode);
  });
  let lobbyInfo = null;

  // ---------------------------------------------------------------- settings
  const seg = (name, options) =>
    `<div class="mn-seg" data-name="${name}">${options.map((o) => `<button data-val="${o}">${o.toUpperCase()}</button>`).join('')}</div>`;
  const range = (name, label, min, max, step) =>
    `<label class="mn-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-name="${name}"><output data-out="${name}"></output></label>`;
  const toggle = (name, label, hint = '') =>
    `<label class="mn-row"><span>${label}${hint ? `<small class="mn-hint">${hint}</small>` : ''}</span><input type="checkbox" class="mn-toggle" data-name="${name}"></label>`;
  let bindRows = '';
  let lastGroup = '';
  for (const a of ACTIONS) {
    if (a.group !== lastGroup) {
      bindRows += `<div class="mn-bind-group">${a.group}</div>`;
      lastGroup = a.group;
    }
    bindRows += `<div class="mn-row mn-bind-row"><span>${a.label}</span><button type="button" class="mn-bind" data-bind-action="${a.id}"></button></div>`;
  }
  const settingsEl = el(
    'section',
    'mn-screen mn-settings',
    `<div class="mn-card mn-card-settings">
       <h2 class="mn-h br-ol">SETTINGS</h2>
       <div class="mn-tabs" role="tablist">
         <button type="button" role="tab" data-tab="game" class="is-on">GAME</button>
         <button type="button" role="tab" data-tab="audio">AUDIO</button>
         <button type="button" role="tab" data-tab="controls">CONTROLS</button>
       </div>
       <div class="mn-pane is-on" data-pane="game">
         ${range('sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05)}
         ${range('adsSensitivity', 'Aim (ADS) sensitivity', 0.1, 2, 0.05)}
         ${toggle('invertY', 'Invert mouse Y')}
         ${range('fov', 'Field of view', 55, 100, 1)}
         <div class="mn-row"><span>Graphics quality</span>${seg('quality', QUALITY_OPTIONS)}</div>
         <div class="mn-row"><span>Bot difficulty</span>${seg('difficulty', DIFFICULTY_OPTIONS)}</div>
         ${toggle('autoPickupAmmo', 'Auto-pickup ammo & mats', 'Walk over ammo and materials to take them without pressing interact.')}
         ${toggle('showFps', 'Show FPS')}
         <label class="mn-row mn-row-gtiles"><span>Real-world 3D view (Google)<small class="mn-hint" data-ref="gtilesHint"></small></span><input type="checkbox" class="mn-toggle" data-name="googleTiles"></label>
       </div>
       <div class="mn-pane" data-pane="audio">
         ${range('volume', 'Master volume', 0, 1, 0.05)}
         ${range('sfxVolume', 'Effects', 0, 1, 0.05)}
         ${range('musicVolume', 'Music', 0, 1, 0.05)}
         ${range('uiVolume', 'Menu sounds', 0, 1, 0.05)}
       </div>
       <div class="mn-pane" data-pane="controls">
         ${toggle('editOnRelease', 'Confirm edit on release', 'Releasing the mouse after selecting tiles confirms the edit.')}
         ${toggle('editWheelReset', 'Reset edit with mouse wheel', 'Scroll while editing to reset the piece (instead of switching slots).')}
         <p class="mn-bind-status" data-ref="bindStatus" role="status">Click a key to change it. Esc cancels. Right mouse resets an edit.</p>
         <div class="mn-binds">${bindRows}</div>
         <button type="button" class="mn-btn mn-btn-small" data-ref="bindReset"><span>RESET TO DEFAULTS</span></button>
       </div>
       <button class="mn-btn mn-btn-small" data-act="back">${icon('back')}<span>BACK</span></button>
     </div>`
  );
  wrap.appendChild(settingsEl);

  // ---------------------------------------------------------------- loading
  const loading = el(
    'section',
    'mn-screen mn-loading',
    `<div class="mn-logo mn-logo-small"><div class="mn-logo-top br-ol">BENTONVILLE</div><div class="mn-logo-main br-ol-xl">ROYALE</div></div>
     <div class="mn-load">
       <div class="mn-load-label" data-ref="label">Loading</div>
       <div class="mn-load-bar"><i data-ref="fill"></i></div>
       <div class="mn-load-pct br-ol" data-ref="pct">0%</div>
     </div>
     <div class="mn-tip"><b>TIP</b><span data-ref="tip"></span></div>`
  );
  wrap.appendChild(loading);
  const L = {};
  loading.querySelectorAll('[data-ref]').forEach((e) => (L[e.dataset.ref] = e));

  // ---------------------------------------------------------------- pause
  const pause = el(
    'section',
    'mn-screen mn-pause',
    `<div class="mn-card mn-card-narrow">
       <h2 class="mn-h br-ol">PAUSED</h2>
       <button class="mn-btn mn-btn-hero" data-act="resume">${icon('play')}<span>RESUME</span></button>
       <button class="mn-btn" data-act="settings">${icon('gear')}<span>SETTINGS</span></button>
       <button class="mn-btn mn-btn-danger" data-act="leave">${icon('home')}<span>LEAVE MATCH</span></button>
     </div>`
  );
  wrap.appendChild(pause);

  // ---------------------------------------------------------------- result
  const result = el(
    'section',
    'mn-screen mn-result',
    `<div class="mn-result-inner">
       <div class="mn-result-place br-ol-xl" data-ref="place">#1</div>
       <div class="mn-result-title br-ol-xl" data-ref="title"></div>
       <div class="mn-result-sub" data-ref="sub"></div>
       <div class="mn-stats">
         <div class="mn-stat">${icon('crown')}<b class="br-ol" data-ref="placement"></b><span>PLACED</span></div>
         <div class="mn-stat">${icon('skull')}<b class="br-ol" data-ref="kills"></b><span>ELIMS</span></div>
         <div class="mn-stat">${icon('clock')}<b class="br-ol" data-ref="time"></b><span>SURVIVED</span></div>
       </div>
       <div class="mn-stack mn-stack-row">
         <button class="mn-btn mn-btn-hero" data-act="again">${icon('replay')}<span>PLAY AGAIN</span></button>
         <button class="mn-btn" data-act="menu">${icon('home')}<span>MAIN MENU</span></button>
       </div>
     </div>`
  );
  wrap.appendChild(result);
  const R = {};
  result.querySelectorAll('[data-ref]').forEach((e) => (R[e.dataset.ref] = e));

  // ---------------------------------------------------------------- drop banner
  const banner = el(
    'div',
    'mn-drop',
    `<div class="mn-drop-time br-ol-xl" data-ref="t">15</div>
     <div class="mn-drop-text"><b class="br-ol" data-ref="title">[SPACE] Jump from the Drop Bus</b><span data-ref="zone"></span>
     <span data-ref="sub">Seconds until the bus leaves the map</span></div>`
  );
  wrap.appendChild(banner);
  const D = {};
  banner.querySelectorAll('[data-ref]').forEach((e) => (D[e.dataset.ref] = e));

  const screens = [title, settingsEl, lobby, loading, pause, result];
  let settingsFrom = 'title';
  let current = null;
  let screenHook = null;

  function show(screen, withBg) {
    if (screen !== settingsEl) cancelCapture();
    for (const s of screens) s.classList.toggle('is-on', s === screen);
    bg.classList.toggle('is-on', !!withBg);
    wrap.classList.toggle('is-active', !!screen);
    current = screen;
    if (screenHook) screenHook(screen === title ? 'title' : screen ? 'other' : null); // meta: 3D line-up on / off
  }

  // ---------------------------------------------------------------- settings wiring
  const gtilesAvailable = !!opts.googleTilesAvailable;
  settingsEl.querySelector('.mn-row-gtiles').classList.toggle('is-disabled', !gtilesAvailable);
  settingsEl.querySelector('[data-ref=gtilesHint]').textContent = gtilesAvailable
    ? 'Visual only. Streams photorealistic tiles from Google; collision is unchanged.'
    : 'Needs VITE_GOOGLE_MAPS_API_KEY in .env.local (see .env.example).';
  const fpsMeter = createFpsMeter(document.body);
  const pct = (v) => Math.round(v * 100) + '%';
  const FORMAT = {
    sensitivity: (v) => v.toFixed(2) + 'x',
    adsSensitivity: (v) => v.toFixed(2) + 'x',
    fov: (v) => Math.round(v) + '°',
    volume: pct,
    sfxVolume: pct,
    musicVolume: pct,
    uiVolume: pct,
  };
  const SR = {};
  settingsEl.querySelectorAll('[data-ref]').forEach((e) => (SR[e.dataset.ref] = e));
  const actionLabel = (id) => (ACTIONS.find((a) => a.id === id) || { label: id }).label;

  function renderBindings() {
    settingsEl.querySelectorAll('[data-bind-action]').forEach((b) => {
      const id = b.dataset.bindAction;
      const isCap = capturing && capturing.action === id;
      b.textContent = isCap ? 'PRESS A KEY…' : keyLabel(settings.bindings[id]);
      b.classList.toggle('is-capturing', isCap);
      b.classList.toggle('is-custom', settings.bindings[id] !== DEFAULT_BINDINGS[id]);
    });
    // title-screen controls strip follows the bindings
    title.querySelectorAll('[data-bind]').forEach((k) => {
      k.textContent = k.dataset.bind.split(' ').map((a) => keyLabel(settings.bindings[a])).join(' ');
    });
  }
  function renderSettings() {
    settingsEl.querySelectorAll('input[type=range]').forEach((inp) => {
      const name = inp.dataset.name;
      inp.value = settings[name];
      const out = settingsEl.querySelector(`[data-out="${name}"]`);
      if (out) out.textContent = (FORMAT[name] || String)(settings[name]);
    });
    settingsEl.querySelectorAll('.mn-seg').forEach((s) => {
      s.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.val === settings[s.dataset.name]));
    });
    settingsEl.querySelectorAll('input.mn-toggle[data-name]').forEach((inp) => {
      if (inp.dataset.name !== 'googleTiles') inp.checked = !!settings[inp.dataset.name];
    });
    const gt = settingsEl.querySelector('[data-name=googleTiles]');
    gt.disabled = !gtilesAvailable;
    gt.checked = gtilesAvailable && settings.googleTiles;
    renderBindings();
    fpsMeter.setVisible(settings.showFps);
  }
  function commit(patch) {
    settings = sanitizeSettings({ ...settings, ...patch });
    renderSettings();
    if (opts.onSettings) opts.onSettings(settings);
  }
  settingsEl.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => commit({ [inp.dataset.name]: parseFloat(inp.value) }));
  });
  settingsEl.querySelectorAll('.mn-seg button').forEach((b) => {
    b.addEventListener('click', () => commit({ [b.parentElement.dataset.name]: b.dataset.val }));
  });
  settingsEl.querySelectorAll('input.mn-toggle[data-name]').forEach((inp) => {
    inp.addEventListener('change', (e) => commit({ [inp.dataset.name]: e.target.checked }));
  });

  // tabs
  settingsEl.querySelectorAll('[data-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      if (opts.onClick) opts.onClick();
      cancelCapture();
      settingsEl.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('is-on', x === t));
      settingsEl.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('is-on', p.dataset.pane === t.dataset.tab));
    });
  });

  // ---- key rebinding: capture the next key / mouse button (Esc cancels).
  // Listeners sit on window in the capture phase and stop the event, so the
  // game's Input never sees the key (no Esc -> unpause, no stray actions).
  let capturing = null;
  const setBindStatus = (text, warn) => {
    SR.bindStatus.textContent = text;
    SR.bindStatus.classList.toggle('is-warn', !!warn);
  };
  function applyBinding(code) {
    const action = capturing.action;
    stopCapture();
    if (RESERVED_CODES.includes(code)) {
      setBindStatus(`${keyLabel(code)} is reserved. Pick another key.`, true);
      renderBindings();
      return;
    }
    const prev = settings.bindings[action];
    const { bindings, swapped } = rebind(settings.bindings, action, code);
    commit({ bindings });
    if (swapped) setBindStatus(`${keyLabel(code)} was used by ${actionLabel(swapped)}. Swapped: ${actionLabel(swapped)} is now ${keyLabel(prev)}.`, true);
    else setBindStatus(`${actionLabel(action)}: ${keyLabel(code)}`);
  }
  const onCapKey = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      cancelCapture();
      setBindStatus('Cancelled.');
      return;
    }
    if (e.code) applyBinding(e.code);
  };
  const swallowClick = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const onCapMouse = (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // the click / auxclick / context menu that follows this mousedown must not
    // press whatever is under the cursor
    const follow = e.button === 0 ? ['click'] : ['auxclick', 'contextmenu'];
    for (const type of follow) {
      window.addEventListener(type, swallowClick, { capture: true, once: true });
      setTimeout(() => window.removeEventListener(type, swallowClick, true), 400);
    }
    applyBinding('Mouse' + e.button);
  };
  function stopCapture() {
    capturing = null;
    window.removeEventListener('keydown', onCapKey, true);
    window.removeEventListener('keyup', swallowClick, true);
    window.removeEventListener('mousedown', onCapMouse, true);
    window.removeEventListener('contextmenu', swallowClick, true);
    window.removeEventListener('auxclick', swallowClick, true);
  }
  function cancelCapture() {
    if (!capturing) return;
    stopCapture();
    renderBindings();
  }
  settingsEl.querySelectorAll('[data-bind-action]').forEach((b) => {
    b.addEventListener('click', (e) => {
      if (capturing) return; // handled by onCapMouse
      e.preventDefault();
      if (opts.onClick) opts.onClick();
      capturing = { action: b.dataset.bindAction };
      setBindStatus(`Press a key or mouse button for ${actionLabel(capturing.action)}. Esc cancels.`);
      window.addEventListener('keydown', onCapKey, true);
      window.addEventListener('keyup', swallowClick, true);
      window.addEventListener('mousedown', onCapMouse, true);
      window.addEventListener('contextmenu', swallowClick, true);
      window.addEventListener('auxclick', swallowClick, true);
      renderBindings();
    });
  });
  SR.bindReset.addEventListener('click', () => {
    if (opts.onClick) opts.onClick();
    cancelCapture();
    commit({ bindings: { ...DEFAULT_BINDINGS } });
    setBindStatus('All keys reset to defaults.');
  });
  renderSettings();

  // ---------------------------------------------------------------- buttons
  const click = (fn) => () => {
    if (opts.onClick) opts.onClick();
    fn();
  };
  wrap.querySelectorAll('[data-act]').forEach((b) => {
    b.addEventListener('mouseenter', () => opts.onHover && opts.onHover());
    const act = b.dataset.act;
    b.addEventListener(
      'click',
      click(() => {
        const name = () => {
          const n = T.name.value.trim().slice(0, 16) || 'Player';
          try {
            localStorage.setItem(NAME_KEY, n);
          } catch {
            /* private mode */
          }
          return n;
        };
        if (act === 'play') opts.onPlay && opts.onPlay();
        else if (act === 'party-go') partyGo();
        else if (act === 'party-copy') {
          if (!partyView || !partyView.link) return;
          if (navigator.clipboard) navigator.clipboard.writeText(partyView.link).catch(() => {});
          b.querySelector('span').textContent = 'COPIED';
          setTimeout(() => (b.querySelector('span').textContent = 'COPY INVITE'), 1400);
        } else if (act === 'party-leave') opts.onPartyLeave && opts.onPartyLeave();
        else if (act === 'party-retry') opts.onPartyRetry && opts.onPartyRetry();
        else if (act === 'party-join') {
          if (T.pjoin.value.length !== 4) {
            api.partyNotice('Enter the 4-letter party code from your friend.', true);
            T.pjoin.focus();
          } else if (partyView && T.pjoin.value === partyView.code) api.partyNotice('You are already in that party.', false);
          else if (opts.onPartyJoin) {
            opts.onPartyJoin(T.pjoin.value);
            T.pjoin.value = '';
          }
        } else if (act === 'party-promote' || act === 'party-kick') {
          const id = selectedSlot;
          selectSlot(null);
          if (id == null) return;
          if (act === 'party-promote') opts.onPartyPromote && opts.onPartyPromote(id);
          else opts.onPartyKick && opts.onPartyKick(id);
        } else if (act === 'party-unselect') selectSlot(null);
        else if (act === 'private') {
          const open = T.private.hidden;
          T.private.hidden = !open;
          T.privBtn.setAttribute('aria-expanded', String(open));
          if (open) T.private.querySelector('[data-act=host]').focus();
        } else if (act === 'lobby-ready') {
          if (lobbyInfo && !lobbyInfo.isHost && opts.onLobbyReady) opts.onLobbyReady(!lobbyInfo.ready);
        } else if (act === 'freebuild') opts.onFreeBuild && opts.onFreeBuild(name());
        else if (act === 'host') opts.onHost && opts.onHost(name());
        else if (act === 'join') {
          if (T.code.value.length !== 4) {
            api.showNotice('Enter the 4-letter room code from your host.');
            T.code.focus();
          } else if (opts.onJoin) opts.onJoin(T.code.value, name());
        } else if (act === 'copy') {
          const link = LB.link.value;
          LB.link.select();
          if (navigator.clipboard && link) navigator.clipboard.writeText(link).catch(() => {});
          b.querySelector('span').textContent = 'COPIED';
          setTimeout(() => (b.querySelector('span').textContent = 'COPY LINK'), 1400);
        } else if (act === 'lobby-start') {
          if (lobbyInfo && lobbyInfo.canStart && opts.onLobbyStart) opts.onLobbyStart();
        } else if (act === 'lobby-leave') opts.onLobbyLeave && opts.onLobbyLeave();
        else if (act === 'settings') api.showSettings(current === pause ? 'pause' : 'title');
        else if (act === 'back') settingsFrom === 'pause' ? api.showPause() : api.showTitle();
        else if (act === 'resume') opts.onResume && opts.onResume();
        else if (act === 'leave') opts.onLeave && opts.onLeave();
        else if (act === 'again') opts.onPlayAgain && opts.onPlayAgain();
        else if (act === 'menu') opts.onLeave && opts.onLeave();
      })
    );
  });

  const fmt = (s) => {
    const t = Math.max(0, Math.floor(s || 0));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };

  // ---------------------------------------------------------------- party (title)
  let partyView = null;
  let selectedSlot = null;
  let queueTimer = 0;
  let noticeTimer = 0;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function selectSlot(id, focus = true) {
    selectedSlot = id;
    const m = id != null && partyView ? partyView.members.find((x) => x.id === id) : null;
    if (!m) selectedSlot = null;
    T.slotActs.hidden = !m;
    T.slotName.textContent = m ? m.name : '';
    for (const li of T.slots.children) li.classList.toggle('is-selected', !!m && li.dataset.id === String(id));
    if (m && focus) T.slotActs.querySelector('[data-act=party-promote]').focus();
  }

  function partyStatus(v) {
    if (v.match) return v.match;
    if (!v.online) return v.connecting ? 'Connecting to the party server…' : 'Party server offline. PLAY starts a match with bots.';
    if (v.state === 'matched') return 'Match found!';
    if (v.state === 'queued') return `Finding match… ${fmt((performance.now() - (v.queuedSince || performance.now())) / 1000)}`;
    const waiting = v.members.filter((m) => !m.leader && !m.ready).length;
    if (v.isLeader) {
      if (waiting) return `Waiting for ${waiting} to ready up`;
      return v.members.length > 1 ? 'Everyone is ready. Press PLAY.' : 'Invite friends, or press PLAY to find a match.';
    }
    const me = v.members.find((m) => m.you);
    return me && me.ready ? 'Ready. Waiting for the leader…' : 'Ready up when you are set.';
  }

  function renderParty() {
    const v = partyView;
    if (!v) return;
    const size = teamSize(v.mode);
    T.pcode.textContent = v.online ? v.code : v.connecting ? '····' : 'OFFLINE';
    T.pcode.classList.toggle('is-offline', !v.online && !v.connecting);
    T.pcopy.hidden = !v.online;
    T.pleave.hidden = !v.online || v.members.length < 2;
    T.pretry.hidden = v.online || v.connecting;

    // member slots
    T.slots.replaceChildren();
    for (let i = 0; i < PARTY_SLOTS; i++) {
      const m = v.members[i];
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mn-slot';
      if (m) {
        li.dataset.id = String(m.id);
        btn.classList.toggle('is-ready', !!m.ready);
        btn.classList.toggle('is-you', !!m.you);
        btn.classList.toggle('is-leader', !!m.leader);
        btn.innerHTML = `${m.leader ? `<span class="mn-slot-crown" title="Party leader">${icon('crown')}</span>` : ''}<b class="mn-slot-name">${esc(m.name)}</b><span class="mn-slot-state">${m.away ? 'RECONNECTING…' : m.ready ? '<i aria-hidden="true">&#10003;</i>READY' : 'NOT READY'}</span>${m.you ? '<em>YOU</em>' : ''}`;
        const canManage = v.online && v.isLeader && !m.you;
        btn.disabled = !canManage;
        btn.setAttribute('aria-label', `${m.name}${m.leader ? ', leader' : ''}, ${m.ready ? 'ready' : 'not ready'}${canManage ? '. Kick or make leader' : ''}`);
        if (canManage) btn.dataset.member = String(m.id);
      } else {
        btn.classList.add('is-empty');
        btn.innerHTML = `<b class="mn-slot-name">+</b><span class="mn-slot-state">${v.online ? 'INVITE' : 'EMPTY'}</span>`;
        btn.disabled = !v.online;
        btn.dataset.invite = '1';
        btn.setAttribute('aria-label', 'Copy party invite link');
      }
      li.appendChild(btn);
      T.slots.appendChild(li);
    }
    // keep the kick / promote row only while that member is still here and we still lead
    if (selectedSlot != null) selectSlot(v.isLeader && v.members.some((m) => m.id === selectedSlot && !m.you) ? selectedSlot : null, false);

    // mode + fill (leader, idle only)
    const idle = (v.state || 'idle') === 'idle' && !v.match;
    const canEdit = v.isLeader && idle;
    T.pmode.querySelectorAll('button').forEach((b) => {
      const mode = b.dataset.mode;
      b.classList.toggle('is-on', mode === v.mode);
      b.disabled = !canEdit || teamSize(mode) < v.members.length;
      b.setAttribute('aria-pressed', String(mode === v.mode));
    });
    T.pfill.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.fill === '1';
      const solo = size === 1;
      b.classList.toggle('is-on', solo ? on : on === !!v.fill);
      b.disabled = !canEdit || solo;
      b.setAttribute('aria-pressed', String(solo ? on : on === !!v.fill));
    });
    T.pfill.title = size === 1 ? 'Fill does not apply to Solo' : v.fill ? 'Bots or other players fill your empty team spots' : 'Your team plays short-handed';

    // big button
    const go = title.querySelector('[data-act=party-go]');
    const me = v.members.find((m) => m.you);
    let label = 'PLAY';
    let disabled = false;
    let kind = 'play';
    if (v.match || v.state === 'matched') {
      label = 'MATCH FOUND';
      disabled = true;
    } else if (v.isLeader) {
      if (v.state === 'queued') {
        label = 'CANCEL';
        kind = 'cancel';
      } else disabled = v.members.some((m) => !m.leader && !m.ready);
    } else {
      label = me && me.ready ? 'UNREADY' : 'READY';
      kind = me && me.ready ? 'unready' : 'ready';
    }
    T.pgo.textContent = label;
    go.dataset.kind = kind;
    go.disabled = disabled;
    go.classList.toggle('is-disabled', disabled);
    T.pstatus.textContent = partyStatus(v);
    T.pstatus.classList.toggle('is-queued', v.state === 'queued' || !!v.match || v.state === 'matched');

    clearInterval(queueTimer);
    queueTimer = 0;
    if (v.state === 'queued' && !v.match) queueTimer = setInterval(() => (T.pstatus.textContent = partyStatus(partyView)), 500);
  }

  function partyGo() {
    const v = partyView;
    if (!v || v.match || v.state === 'matched') return;
    if (v.isLeader) {
      if (v.state === 'queued') opts.onPartyCancel && opts.onPartyCancel();
      else opts.onPlay && opts.onPlay();
      return;
    }
    const me = v.members.find((m) => m.you);
    if (opts.onPartyReady) opts.onPartyReady(!(me && me.ready));
  }

  T.slots.addEventListener('click', (e) => {
    const b = e.target.closest('button.mn-slot');
    if (!b || b.disabled) return;
    if (opts.onClick) opts.onClick();
    if (b.dataset.invite) {
      title.querySelector('[data-act=party-copy]').click();
      return;
    }
    const id = partyView && partyView.members.find((m) => String(m.id) === b.dataset.member);
    if (id) selectSlot(selectedSlot === id.id ? null : id.id);
  });
  T.pmode.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b || b.disabled) return;
    if (opts.onClick) opts.onClick();
    if (opts.onPartyMode) opts.onPartyMode(b.dataset.mode);
  });
  T.pfill.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fill]');
    if (!b || b.disabled) return;
    if (opts.onClick) opts.onClick();
    if (opts.onPartyFill) opts.onPartyFill(b.dataset.fill === '1');
  });

  const api = {
    el: wrap,
    /** fn('title' | 'other' | null) whenever the shown screen changes. */
    set onScreen(fn) {
      screenHook = fn;
    },
    get current() {
      return current === lobby ? 'lobby' : current === title ? 'title' : current === settingsEl ? 'settings' : current === loading ? 'loading' : current === pause ? 'pause' : current === result ? 'result' : null;
    },
    showTitle() {
      api.showDropBanner(false);
      T.notice.textContent = '';
      T.notice.classList.remove('is-on');
      show(title, true);
      renderParty();
    },
    /** Title party panel (see the header comment for the view shape). */
    setParty(view) {
      partyView = view;
      renderParty();
    },
    /** Short message on the party panel (errors stay until the next one; info fades). */
    partyNotice(text, isError) {
      clearTimeout(noticeTimer);
      T.notice.textContent = text || '';
      T.notice.classList.toggle('is-on', !!text);
      T.notice.classList.toggle('is-info', !isError);
      if (text && !isError) noticeTimer = setTimeout(() => T.notice.classList.remove('is-on'), 5000);
    },
    /** Title screen with a message (errors from joining, "Host left the match"). */
    showNotice(text) {
      api.showDropBanner(false);
      clearTimeout(noticeTimer);
      T.notice.textContent = text || '';
      T.notice.classList.toggle('is-on', !!text);
      T.notice.classList.remove('is-info');
      show(title, true);
      renderParty();
    },
    playerName: () => T.name.value.trim().slice(0, 16) || 'Player',
    /** Signed in: play under the account name (field locked); null unlocks it again. */
    setAccountName(name) {
      if (name) {
        T.name.value = String(name).slice(0, 16);
        T.name.readOnly = true;
        T.name.title = 'Your account name';
      } else {
        T.name.readOnly = false;
        T.name.title = '';
        T.name.value = savedName() || T.name.value;
      }
      if (partyView && !partyView.online) renderParty();
    },
    setJoinCode(code) {
      T.code.value = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (T.code.value) {
        T.private.hidden = false;
        T.privBtn.setAttribute('aria-expanded', 'true');
      }
    },
    showLobby(info) {
      lobbyInfo = info;
      LB.code.textContent = info.code || '····';
      LB.link.value = info.link || '';
      lobby.querySelector('.mn-link').hidden = !info.link;
      LB.count.textContent = `${(info.players || []).length}/${info.max || 16}`;
      LB.roster.replaceChildren();
      for (const p of info.players || []) {
        const li = document.createElement('li');
        li.classList.toggle('is-ready', !!p.ready);
        const nm = document.createElement('span');
        nm.textContent = p.name;
        li.appendChild(nm);
        const tags = [p.host ? 'HOST' : p.ready ? '\u2713 READY' : 'NOT READY', p.you ? 'YOU' : ''].filter(Boolean);
        const tag = document.createElement('em');
        tag.textContent = tags.join(' · ');
        li.appendChild(tag);
        LB.roster.appendChild(li);
      }
      const mode = info.mode || 'solo';
      LB.mode.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('is-on', b.dataset.mode === mode);
        b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
        b.disabled = !info.isHost;
      });
      const readyBtn = lobby.querySelector('[data-act=lobby-ready]');
      readyBtn.hidden = !!info.isHost;
      LB.readyLabel.textContent = info.ready ? 'UNREADY' : 'READY';
      readyBtn.dataset.kind = info.ready ? 'unready' : 'ready';
      LB.fill.checked = !!info.fill;
      LB.fill.disabled = !info.isHost;
      const humans = (info.players || []).length;
      // HostSession.prepareMatch: MATCH.bots + 1 slots, every human (host included) takes one
      LB.fillHint.textContent = info.fill ? `${Math.max(0, MATCH.bots + 1 - humans)} bots join ${humans} player${humans === 1 ? '' : 's'}` : 'Humans only';
      LB.status.textContent = info.status || '';
      LB.error.textContent = info.error || '';
      const start = lobby.querySelector('[data-act=lobby-start]');
      start.hidden = !info.isHost;
      start.disabled = !info.canStart;
      start.classList.toggle('is-disabled', !info.canStart);
      if (current !== lobby) show(lobby, true);
    },
    showSettings(from = 'title') {
      settingsFrom = from;
      renderSettings();
      show(settingsEl, from !== 'pause');
    },
    showLoading(pct = 0, label) {
      if (current !== loading) {
        const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
        L.tip.textContent = typeof tip === 'function' ? tip((a) => keyLabel((settings.bindings || DEFAULT_BINDINGS)[a] || DEFAULT_BINDINGS[a])) : tip;
        show(loading, true);
      }
      api.setLoading(pct, label);
    },
    setLoading(pct, label) {
      const p = Math.max(0, Math.min(1, pct || 0));
      L.fill.style.transform = `scaleX(${p})`;
      L.pct.textContent = Math.round(p * 100) + '%';
      if (label) L.label.textContent = label;
    },
    showPause() {
      api.showDropBanner(false);
      show(pause, false);
    },
    showResult(r) {
      api.showDropBanner(false);
      result.dataset.kind = r.victory ? 'win' : 'loss';
      R.place.textContent = '#' + r.placement;
      // team modes (r.mode duo / trio / squad, r.teams = teams in the match): placement is the team's
      const team = r.mode && r.mode !== 'solo' && r.teams > 0;
      const noun = { duo: 'duo', trio: 'trio', squad: 'squad' }[r.mode] || 'team';
      const left = r.placement - 1;
      if (team) {
        R.title.textContent = r.victory ? 'LAST TEAM STANDING' : `YOUR ${noun.toUpperCase()} IS OUT`;
        R.sub.textContent = r.victory
          ? `Your ${noun} outlasted ${r.teams - 1} team${r.teams - 1 === 1 ? '' : 's'} in Bentonville.`
          : `${r.killer ? `Taken out by ${r.killer}. ` : ''}${left} team${left === 1 ? '' : 's'} left standing.`;
        R.placement.textContent = `${r.placement}/${r.teams}`;
      } else {
        R.title.textContent = r.victory ? 'LAST ONE STANDING' : 'ELIMINATED';
        R.sub.textContent = r.victory
          ? `You outlasted ${r.total - 1} rivals in Bentonville.`
          : r.killer
            ? `Taken out by ${r.killer}. ${r.placement - 1} left standing.`
            : `${r.placement - 1} left standing.`;
        R.placement.textContent = `${r.placement}/${r.total}`;
      }
      R.kills.textContent = String(r.kills);
      R.time.textContent = fmt(r.time);
      // multiplayer: no instant rematch; the host makes a new room
      result.querySelector('[data-act=again]').hidden = !!r.mp;
      if (r.hostNote) R.sub.textContent += ' ' + r.hostNote;
      show(result, false);
    },
    showDropBanner(on, secondsLeft, zone, text) {
      banner.classList.toggle('is-on', !!on);
      // lets the full map and the hotbar make room for the banner (menus.css)
      document.documentElement.classList.toggle('br-dropping', !!on);
      if (on) {
        // called every frame during the drop: only touch the DOM when something changed
        const set = (el, v) => {
          if (el.textContent !== v) el.textContent = v;
        };
        set(D.t, String(Math.max(0, Math.ceil(secondsLeft))));
        set(D.zone, zone ? `Storm forming near ${zone}` : '');
        D.zone.hidden = !zone;
        if (text && text.title) set(D.title, text.title);
        if (text && text.sub) set(D.sub, text.sub);
      }
    },
    hideAll() {
      show(null, false);
    },
    getSettings: () => ({ ...settings }),
    setSettings(s) {
      settings = sanitizeSettings(s);
      renderSettings();
    },
  };
  return api;
}
