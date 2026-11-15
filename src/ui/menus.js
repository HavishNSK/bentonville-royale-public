// BENTONVILLE ROYALE — menu screens: title, settings, loading, pause, result,
// plus the drop-phase banner. DOM only; styles in menus.css (tokens from hud.css).
//
//   const menus = createMenus(root, {
//     settings,                       // current settings object (src/ui/settings.js shape)
//     onPlay(), onSettings(settings), onResume(), onLeave(), onPlayAgain(),
//     onHost(name), onJoin(code, name),           // multiplayer (main.js lazy-loads src/net)
//     onLobbyStart(), onLobbyLeave(), onLobbyFill(on),
//     googleTilesAvailable,          // false -> "Real-world 3D view" toggle shown disabled with a hint
//   });
//   menus.showLobby(info)   info = { isHost, code, link, players:[{id,name,host}], max, fill,
//                                   status, canStart, error }
//   menus.showNotice(text)  title screen with a message (host left, room full, ...)
//   menus.playerName()      saved name (localStorage)
//   menus.setSettings(settings)       // update the shown settings without firing onSettings
//   menus.showTitle() / showSettings(from) / showLoading(pct, label) / showPause()
//   menus.showResult({ victory, placement, kills, total, time, killer })
//   menus.showDropBanner(on, secondsLeft, zoneLabel)
//   menus.hideAll()

import './hud.css';
import './menus.css';
import { icon } from './icons.js';
import { QUALITY_OPTIONS, DIFFICULTY_OPTIONS, sanitizeSettings } from './settings.js';

const TIPS = [
  'Swing your pickaxe at trees, rocks and parked cars to gather building materials.',
  'Q wall, C floor, V ramp, X cone. G switches between wood, brick and metal.',
  'Shield Tonics stack on top of your health. Drink them before a fight.',
  'The storm hurts more every phase. Watch the timer in the top left.',
  'Chests glow and hum. Listen for them inside buildings.',
  'Hold right mouse to aim down sights for tighter shots.',
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
       <div class="mn-logo-tag">32 players &middot; one town square &middot; build to survive</div>
     </div>
     <div class="mn-stack">
       <button class="mn-btn mn-btn-hero" data-act="play">${icon('play')}<span>PLAY VS BOTS</span></button>
       <button class="mn-btn" data-act="host">${icon('people')}<span>HOST MULTIPLAYER</span></button>
       <div class="mn-join">
         <input class="mn-field mn-code" data-ref="code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code">
         <button class="mn-btn" data-act="join"><span>JOIN</span></button>
       </div>
       <label class="mn-name"><span>Name</span><input class="mn-field" data-ref="name" maxlength="16" autocomplete="nickname" spellcheck="false"></label>
       <div class="mn-notice" data-ref="notice" role="status"></div>
       <button class="mn-btn mn-btn-small" data-act="settings">${icon('gear')}<span>SETTINGS</span></button>
     </div>
     <div class="mn-controls">
       <span><kbd class="br-key">WASD</kbd>move</span><span><kbd class="br-key">SPACE</kbd>jump</span>
       <span><kbd class="br-key">LMB</kbd>fire</span><span><kbd class="br-key">RMB</kbd>aim</span>
       <span><kbd class="br-key">E</kbd>loot</span><span><kbd class="br-key">Q C V X</kbd>build</span>
       <span><kbd class="br-key">F</kbd>pickaxe</span><span><kbd class="br-key">M</kbd>map</span>
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
  T.name.addEventListener('change', () => {
    try {
      localStorage.setItem(NAME_KEY, T.name.value.trim().slice(0, 16));
    } catch {
      /* private mode */
    }
  });
  T.code.addEventListener('input', () => {
    T.code.value = T.code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });
  T.code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') title.querySelector('[data-act=join]').click();
  });

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
       <label class="mn-row"><span>Fill empty spots with bots<small class="mn-hint" data-ref="fillHint"></small></span><input type="checkbox" class="mn-toggle" data-ref="fill"></label>
       <p class="mn-status" data-ref="status" role="status"></p>
       <p class="mn-status mn-error" data-ref="error" role="alert"></p>
       <button class="mn-btn mn-btn-hero" data-act="lobby-start">${icon('play')}<span>START MATCH</span></button>
       <button class="mn-btn mn-btn-small" data-act="lobby-leave">${icon('back')}<span>LEAVE</span></button>
     </div>`
  );
  wrap.appendChild(lobby);
  const LB = {};
  lobby.querySelectorAll('[data-ref]').forEach((e) => (LB[e.dataset.ref] = e));
  LB.fill.addEventListener('change', () => opts.onLobbyFill && opts.onLobbyFill(LB.fill.checked));
  let lobbyInfo = null;

  // ---------------------------------------------------------------- settings
  const seg = (name, options) =>
    `<div class="mn-seg" data-name="${name}">${options.map((o) => `<button data-val="${o}">${o.toUpperCase()}</button>`).join('')}</div>`;
  const settingsEl = el(
    'section',
    'mn-screen mn-settings',
    `<div class="mn-card">
       <h2 class="mn-h br-ol">SETTINGS</h2>
       <label class="mn-row"><span>Mouse sensitivity</span><input type="range" min="0.2" max="3" step="0.05" data-name="sensitivity"><output data-out="sensitivity"></output></label>
       <label class="mn-row"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-name="volume"><output data-out="volume"></output></label>
       <div class="mn-row"><span>Graphics quality</span>${seg('quality', QUALITY_OPTIONS)}</div>
       <div class="mn-row"><span>Bot difficulty</span>${seg('difficulty', DIFFICULTY_OPTIONS)}</div>
       <label class="mn-row"><span>Invert mouse Y</span><input type="checkbox" class="mn-toggle" data-name="invertY"></label>
       <label class="mn-row mn-row-gtiles"><span>Real-world 3D view (Google)<small class="mn-hint" data-ref="gtilesHint"></small></span><input type="checkbox" class="mn-toggle" data-name="googleTiles"></label>
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
     <div class="mn-drop-text"><b class="br-ol">CHOOSE YOUR DROP</b><span data-ref="zone"></span>
     <span>Click the map to move your marker &middot; <kbd class="br-key">SPACE</kbd> to jump</span></div>`
  );
  wrap.appendChild(banner);
  const D = {};
  banner.querySelectorAll('[data-ref]').forEach((e) => (D[e.dataset.ref] = e));

  const screens = [title, settingsEl, lobby, loading, pause, result];
  let settingsFrom = 'title';
  let current = null;

  function show(screen, withBg) {
    for (const s of screens) s.classList.toggle('is-on', s === screen);
    bg.classList.toggle('is-on', !!withBg);
    wrap.classList.toggle('is-active', !!screen);
    current = screen;
  }

  // ---------------------------------------------------------------- settings wiring
  const gtilesAvailable = !!opts.googleTilesAvailable;
  settingsEl.querySelector('.mn-row-gtiles').classList.toggle('is-disabled', !gtilesAvailable);
  settingsEl.querySelector('[data-ref=gtilesHint]').textContent = gtilesAvailable
    ? 'Visual only. Streams photorealistic tiles from Google; collision is unchanged.'
    : 'Needs VITE_GOOGLE_MAPS_API_KEY in .env.local (see .env.example).';
  function renderSettings() {
    settingsEl.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.value = settings[inp.dataset.name];
      const out = settingsEl.querySelector(`[data-out="${inp.dataset.name}"]`);
      out.textContent = inp.dataset.name === 'volume' ? Math.round(settings.volume * 100) + '%' : settings.sensitivity.toFixed(2) + 'x';
    });
    settingsEl.querySelectorAll('.mn-seg').forEach((s) => {
      s.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.val === settings[s.dataset.name]));
    });
    settingsEl.querySelector('[data-name=invertY]').checked = settings.invertY;
    const gt = settingsEl.querySelector('[data-name=googleTiles]');
    gt.disabled = !gtilesAvailable;
    gt.checked = gtilesAvailable && settings.googleTiles;
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
  settingsEl.querySelector('[data-name=invertY]').addEventListener('change', (e) => commit({ invertY: e.target.checked }));
  settingsEl.querySelector('[data-name=googleTiles]').addEventListener('change', (e) => commit({ googleTiles: e.target.checked }));

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

  const api = {
    el: wrap,
    get current() {
      return current === lobby ? 'lobby' : current === title ? 'title' : current === settingsEl ? 'settings' : current === loading ? 'loading' : current === pause ? 'pause' : current === result ? 'result' : null;
    },
    showTitle() {
      api.showDropBanner(false);
      T.notice.textContent = '';
      T.notice.classList.remove('is-on');
      show(title, true);
    },
    /** Title screen with a message (errors from joining, "Host left the match"). */
    showNotice(text) {
      api.showDropBanner(false);
      T.notice.textContent = text || '';
      T.notice.classList.toggle('is-on', !!text);
      show(title, true);
    },
    playerName: () => T.name.value.trim().slice(0, 16) || 'Player',
    setJoinCode(code) {
      T.code.value = String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
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
        const nm = document.createElement('span');
        nm.textContent = p.name;
        li.appendChild(nm);
        if (p.host || p.you) {
          const tag = document.createElement('em');
          tag.textContent = [p.host ? 'HOST' : '', p.you ? 'YOU' : ''].filter(Boolean).join(' · ');
          li.appendChild(tag);
        }
        LB.roster.appendChild(li);
      }
      LB.fill.checked = !!info.fill;
      LB.fill.disabled = !info.isHost;
      const humans = (info.players || []).length;
      LB.fillHint.textContent = info.fill ? `${Math.max(0, 32 - humans)} bots join ${humans} player${humans === 1 ? '' : 's'}` : 'Humans only';
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
        L.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
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
      R.title.textContent = r.victory ? 'LAST ONE STANDING' : 'ELIMINATED';
      R.sub.textContent = r.victory
        ? `You outlasted ${r.total - 1} rivals in Bentonville.`
        : r.killer
          ? `Taken out by ${r.killer}. ${r.placement - 1} left standing.`
          : `${r.placement - 1} left standing.`;
      R.placement.textContent = `${r.placement}/${r.total}`;
      R.kills.textContent = String(r.kills);
      R.time.textContent = fmt(r.time);
      // multiplayer: no instant rematch; the host makes a new room
      result.querySelector('[data-act=again]').hidden = !!r.mp;
      if (r.hostNote) R.sub.textContent += ' ' + r.hostNote;
      show(result, false);
    },
    showDropBanner(on, secondsLeft, zone) {
      banner.classList.toggle('is-on', !!on);
      // lets the full map and the hotbar make room for the banner (menus.css)
      document.documentElement.classList.toggle('br-dropping', !!on);
      if (on) {
        D.t.textContent = String(Math.max(0, Math.ceil(secondsLeft)));
        D.zone.textContent = zone ? `Storm forming near ${zone}` : '';
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
