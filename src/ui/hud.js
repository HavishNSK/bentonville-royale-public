// BENTONVILLE ROYALE — in-game HUD.
// All setters are safe to call every frame: each one compares against the
// last value it rendered and only touches the DOM when something changed.

import './hud.css';
import { icon, hasIcon } from './icons.js';

const BUILD_PIECES = [
  { id: 'wall', key: 'Q', label: 'Wall' },
  { id: 'floor', key: 'C', label: 'Floor' },
  { id: 'ramp', key: 'V', label: 'Ramp' },
  { id: 'cone', key: 'X', label: 'Cone' },
];
const MATERIALS = ['wood', 'brick', 'metal'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const STORM_LABELS = {
  waiting: 'STORM CLOSES IN',
  shrinking: 'STORM IS MOVING',
  final: 'FINAL CIRCLE',
};
const COMPASS_NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const FEED_MAX = 5;
const FEED_MS = 6500;
const TOAST_MAX = 3;
const TOAST_MS = 2400;
const FLOAT_POOL = 28;
const FLOAT_ICONS = { wood: 'wood', brick: 'brick', metal: 'metal', shield: 'shield' };
const DEFAULT_LOCATION = 'BENTONVILLE, AR';

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const int = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

function fmtTime(seconds) {
  const s = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

/** "[E] Open Chest" -> keycap + text. Uses text nodes only (no HTML injection). */
function fillKeyedText(el, text) {
  el.textContent = '';
  const re = /\[([^\]]{1,12})\]/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const k = document.createElement('kbd');
    k.className = 'br-key';
    k.textContent = m[1];
    el.appendChild(k);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    const span = document.createElement('span');
    span.textContent = text.slice(last).replace(/^\s+/, '');
    el.appendChild(span);
  }
}

function compassHTML() {
  // The strip spans -180deg .. 540deg (two full turns) so any heading in
  // 0..360 can be centred without a seam.
  let out = '';
  for (let d = -180; d <= 540; d += 15) {
    const norm = ((d % 360) + 360) % 360;
    const name = COMPASS_NAMES[norm];
    const pos = (((d + 180) / 720) * 100).toFixed(4);
    const cls = name ? (name.length === 1 ? 'br-cmp-card' : 'br-cmp-inter') : 'br-cmp-num';
    out += `<span class="br-cmp-mark ${cls}${name === 'N' ? ' br-cmp-north' : ''}" style="left:${pos}%"><i></i><b>${name || norm}</b></span>`;
  }
  return out;
}

function hudHTML() {
  const slots = [0, 1, 2, 3, 4]
    .map(
      (i) =>
        `<div class="br-slot is-empty" data-slot="${i}"><span class="br-slot-key">${i + 1}</span><span class="br-slot-ico"></span><span class="br-slot-num br-ol"></span></div>`
    )
    .join('');
  const pieces = BUILD_PIECES.map(
    (p) =>
      `<div class="br-piece" data-piece="${p.id}">${icon(p.id)}<span class="br-piece-name">${p.label}</span><kbd class="br-key">${p.key}</kbd></div>`
  ).join('');
  const mats = MATERIALS.map(
    (m) => `<div class="br-mat" data-mat="${m}">${icon(m)}<b class="br-mat-count br-ol">0</b></div>`
  ).join('');

  return `
<div class="br-vig br-vig-storm"></div>
<div class="br-vig br-vig-dmg"></div>

<div class="br-tl">
  <div class="br-counts">
    <div class="br-chip br-chip-alive">${icon('people')}<b class="br-ol" data-ref="alive">0</b><span>ALIVE</span></div>
    <div class="br-chip br-chip-elims">${icon('skull')}<b class="br-ol" data-ref="elims">0</b><span>ELIMS</span></div>
  </div>
  <div class="br-storm" data-ref="storm" data-state="waiting">
    <div class="br-storm-ico">${icon('storm')}</div>
    <div class="br-storm-body">
      <div class="br-storm-label" data-ref="stormLabel">${STORM_LABELS.waiting}</div>
      <div class="br-storm-time br-ol" data-ref="stormTime">0:00</div>
    </div>
    <div class="br-storm-phase"><span>PHASE</span><b class="br-ol" data-ref="stormPhase">1</b></div>
  </div>
  <div class="br-loc">${icon('pin')}<span data-ref="loc">${DEFAULT_LOCATION}</span></div>
</div>

<div class="br-compass">
  <div class="br-compass-window"><div class="br-compass-strip" data-ref="strip">${compassHTML()}</div></div>
  <div class="br-compass-needle"></div>
  <div class="br-compass-deg br-ol" data-ref="deg">0&deg;</div>
</div>

<div class="br-announce" data-ref="announce">
  <div class="br-announce-title br-ol-xl" data-ref="annTitle"></div>
  <div class="br-announce-sub" data-ref="annSub"></div>
</div>
<div class="br-stormwarn" data-ref="stormWarn">${icon('storm')}<span>YOU'RE IN THE STORM &mdash; RUN FOR THE SAFE ZONE!</span></div>

<div class="br-tr">
  <div class="br-minimap">
    <canvas class="br-minimap-canvas" data-ref="minimap" width="320" height="320"></canvas>
    <span class="br-minimap-key"><kbd class="br-key">M</kbd>MAP</span>
  </div>
  <div class="br-feed" data-ref="feed" aria-live="off"></div>
</div>

<div class="br-center">
  <div class="br-xhair" data-ref="xhair" data-kind="gun">
    <i class="br-xh-t"></i><i class="br-xh-r"></i><i class="br-xh-b"></i><i class="br-xh-l"></i>
    <i class="br-xh-dot"></i><i class="br-xh-ring"></i>
    <i class="br-xh-c br-xh-c1"></i><i class="br-xh-c br-xh-c2"></i><i class="br-xh-c br-xh-c3"></i><i class="br-xh-c br-xh-c4"></i>
  </div>
  <div class="br-hitmarker" data-ref="hitmarker"><i></i><i></i><i></i><i></i></div>
  <div class="br-reloadring" data-ref="xreload"><i data-ref="xreloadFill"></i></div>
  <div class="br-prompt" data-ref="prompt"></div>
</div>
<div class="br-toasts" data-ref="toasts"></div>

<div class="br-bl">
  <div class="br-emote" data-ref="emote"><kbd class="br-key">B</kbd>EMOTE</div>
  <div class="br-vitals">
    <div class="br-vital br-vital-shield" data-ref="shieldRow">
      <div class="br-vital-badge">${icon('shield')}</div>
      <div class="br-vital-track"><i class="br-vital-ghost" data-ref="shieldGhost"></i><i class="br-vital-fill" data-ref="shieldFill"></i></div>
      <b class="br-vital-num br-ol" data-ref="shieldNum">0</b>
    </div>
    <div class="br-vital br-vital-health" data-ref="healthRow">
      <div class="br-vital-badge">${icon('heart')}</div>
      <div class="br-vital-track"><i class="br-vital-ghost" data-ref="healthGhost"></i><i class="br-vital-fill" data-ref="healthFill"></i></div>
      <b class="br-vital-num br-ol" data-ref="healthNum">100</b>
    </div>
  </div>
</div>

<div class="br-bc">
  <div class="br-activename br-ol" data-ref="activeName"></div>
  <div class="br-hotbar" data-ref="hotbar">
    <div class="br-slot br-slot-pick" data-ref="pickSlot"><span class="br-slot-key">F</span><span class="br-slot-ico">${icon('pickaxe')}</span></div>
    <span class="br-hotbar-sep"></span>
    ${slots}
  </div>
</div>

<div class="br-br">
  <div class="br-weapon" data-ref="weapon">
    <div class="br-weapon-name" data-ref="weaponName"></div>
    <div class="br-weapon-row">
      ${icon('bullets')}
      <b class="br-weapon-mag br-ol-xl" data-ref="weaponMag">0</b>
      <span class="br-weapon-res br-ol" data-ref="weaponRes">/ 0</span>
    </div>
    <div class="br-weapon-reload" data-ref="weaponReload"><i data-ref="weaponReloadFill"></i><span>RELOADING</span></div>
  </div>
  <div class="br-build" data-ref="build"><span class="br-build-tag">BUILD</span>${pieces}</div>
  <div class="br-mats" data-ref="mats"><span class="br-mats-key"><kbd class="br-key">G</kbd></span>${mats}</div>
</div>

<div class="br-objbar" data-ref="objbar"><i data-ref="objbarFill"></i></div>
<div class="br-floats" data-ref="floats"></div>

<div class="br-fullmap" data-ref="fullmap">
  <div class="br-fullmap-frame">
    <div class="br-fullmap-title br-ol">${icon('map')}BENTONVILLE, ARKANSAS</div>
    <canvas class="br-fullmap-canvas" data-ref="fullmapCanvas" width="1024" height="1024"></canvas>
    <div class="br-fullmap-hint"><kbd class="br-key">M</kbd>CLOSE MAP<span>Map data &copy; OpenStreetMap contributors</span></div>
  </div>
</div>`;
}

/**
 * Builds the HUD inside `root` and returns the setter API.
 * @param {HTMLElement} root the #ui-root element
 */
export function buildHud(root) {
  const hud = document.createElement('div');
  hud.className = 'br-hud';
  hud.innerHTML = hudHTML();
  root.appendChild(hud);

  const r = {};
  hud.querySelectorAll('[data-ref]').forEach((el) => {
    r[el.dataset.ref] = el;
  });
  const slotEls = Array.from(hud.querySelectorAll('.br-slot[data-slot]')).map((el) => ({
    el,
    ico: el.querySelector('.br-slot-ico'),
    num: el.querySelector('.br-slot-num'),
    // cache
    empty: true,
    name: null,
    rarity: null,
    icon: null,
    label: '',
  }));
  const pieceEls = {};
  hud.querySelectorAll('.br-piece').forEach((el) => {
    pieceEls[el.dataset.piece] = el;
  });
  const matEls = {};
  hud.querySelectorAll('.br-mat').forEach((el) => {
    matEls[el.dataset.mat] = { el, count: el.querySelector('.br-mat-count'), value: null };
  });

  const canAnimate = typeof hud.animate === 'function';
  const motionQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };

  /** px per design unit — mirrors the CSS `--u` clamp. */
  let unit = 1;
  const measure = () => {
    unit = Math.min(2.25, Math.max(0.75, Math.min(window.innerWidth, window.innerHeight) / 720));
  };
  measure();
  window.addEventListener('resize', measure);

  const pop = (el, scale = 1.25, ms = 180) => {
    // decorative only, so it is skipped entirely for reduced-motion users
    if (!canAnimate || (motionQuery && motionQuery.matches)) return;
    el.animate([{ transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: ms, easing: 'ease-out' });
  };

  // ---- vitals --------------------------------------------------------------
  const vital = (row, fill, ghost, numEl, lowClass) => {
    let lastVal = -1;
    let lastPct = -1;
    return (value, max) => {
      const m = max > 0 ? max : 100;
      const v = Math.max(0, int(value));
      const pct = Math.round(clamp01(value / m) * 1000) / 1000;
      if (v !== lastVal) {
        numEl.textContent = v;
        if (lastVal !== -1 && v < lastVal) pop(numEl, 1.3, 220);
        lastVal = v;
      }
      if (pct !== lastPct) {
        const t = 'scaleX(' + pct + ')';
        fill.style.transform = t;
        ghost.style.transform = t;
        row.classList.toggle('is-zero', pct <= 0);
        if (lowClass) {
          const low = pct > 0 && pct <= 0.25;
          row.classList.toggle('is-low', low);
          hud.classList.toggle('is-lowhp', low); // drives the pulsing edge vignette
        }
        lastPct = pct;
      }
    };
  };
  const setHealth = vital(r.healthRow, r.healthFill, r.healthGhost, r.healthNum, true);
  const setShield = vital(r.shieldRow, r.shieldFill, r.shieldGhost, r.shieldNum, false);

  // ---- materials -------------------------------------------------------------
  let lastActiveMat;
  function setMaterials(counts, activeMaterial) {
    const c = counts || {};
    for (let i = 0; i < MATERIALS.length; i++) {
      const id = MATERIALS[i];
      const m = matEls[id];
      const v = Math.max(0, int(c[id]));
      if (v !== m.value) {
        m.count.textContent = v;
        m.el.classList.toggle('is-zero', v === 0);
        if (m.value !== null) pop(m.count, v > m.value ? 1.35 : 0.8, 200);
        m.value = v;
      }
    }
    const a = activeMaterial || null;
    if (a !== lastActiveMat) {
      for (let i = 0; i < MATERIALS.length; i++) matEls[MATERIALS[i]].el.classList.toggle('is-active', MATERIALS[i] === a);
      lastActiveMat = a;
    }
  }

  // ---- hotbar ----------------------------------------------------------------
  let lastActiveSlot;
  let lastBuild = null;
  let lastActiveName = null;
  function refreshActive() {
    const idx = lastActiveSlot;
    const hasSlot = idx >= 0 && idx < slotEls.length;
    for (let i = 0; i < slotEls.length; i++) slotEls[i].el.classList.toggle('is-active', hasSlot && i === idx && !lastBuild);
    r.pickSlot.classList.toggle('is-active', !hasSlot && !lastBuild);
    let name = '';
    if (lastBuild) name = '';
    else if (hasSlot) name = slotEls[idx].name || '';
    else name = 'Pickaxe';
    if (name !== lastActiveName) {
      r.activeName.textContent = name;
      lastActiveName = name;
    }
  }
  function setHotbar(slots, activeIndex) {
    const list = slots || [];
    let changed = false;
    for (let i = 0; i < slotEls.length; i++) {
      const s = slotEls[i];
      const item = list[i] || null;
      if (!item) {
        if (!s.empty) {
          s.el.classList.add('is-empty');
          s.el.removeAttribute('data-rarity');
          s.ico.innerHTML = '';
          s.num.textContent = '';
          s.empty = true;
          s.name = s.rarity = s.icon = null;
          s.label = '';
          changed = true;
        }
        continue;
      }
      if (s.empty) {
        s.el.classList.remove('is-empty');
        s.empty = false;
        changed = true;
      }
      const rarity = RARITIES.includes(item.rarity) ? item.rarity : 'common';
      if (rarity !== s.rarity) {
        s.el.dataset.rarity = rarity;
        s.rarity = rarity;
      }
      if (item.icon !== s.icon) {
        s.ico.innerHTML = hasIcon(item.icon) ? icon(item.icon) : '';
        s.icon = item.icon;
        pop(s.el, 1.12, 160);
      }
      if (item.name !== s.name) {
        s.name = item.name;
        s.el.title = item.name || '';
        changed = true;
      }
      // guns show ammo in the mag, stackables show "x3"
      let label = '';
      if (item.ammo != null) label = String(int(item.ammo));
      else if (item.count != null && item.count > 1) label = 'x' + int(item.count);
      if (label !== s.label) {
        s.num.textContent = label;
        s.num.classList.toggle('is-zero', item.ammo != null && int(item.ammo) === 0);
        s.label = label;
      }
    }
    const idx = Number.isInteger(activeIndex) ? activeIndex : -1;
    if (idx !== lastActiveSlot || changed) {
      lastActiveSlot = idx;
      refreshActive();
    }
  }

  // ---- weapon / ammo -----------------------------------------------------------
  const w = { shown: null, name: null, rarity: undefined, mag: null, res: null, low: null, reloading: null, pct: -1 };
  function setWeapon(weapon) {
    const shown = !!weapon;
    if (shown !== w.shown) {
      r.weapon.classList.toggle('is-on', shown);
      w.shown = shown;
      if (!shown && w.reloading) {
        r.weapon.classList.remove('is-reloading');
        r.xreload.classList.remove('is-on');
        w.reloading = false;
      }
    }
    if (!shown) return;
    if (weapon.name !== w.name) {
      r.weaponName.textContent = weapon.name || '';
      w.name = weapon.name;
    }
    const rar = RARITIES.includes(weapon.rarity) ? weapon.rarity : null;
    if (rar !== w.rarity) {
      if (rar) r.weapon.dataset.rarity = rar;
      else r.weapon.removeAttribute('data-rarity');
      w.rarity = rar;
    }
    const mag = int(weapon.mag);
    if (mag !== w.mag) {
      r.weaponMag.textContent = mag;
      if (w.mag !== null && mag < w.mag) pop(r.weaponMag, 1.12, 90);
      w.mag = mag;
    }
    const res = weapon.reserve == null || !Number.isFinite(weapon.reserve) ? '∞' : String(int(weapon.reserve));
    if (res !== w.res) {
      r.weaponRes.textContent = '/ ' + res;
      w.res = res;
    }
    const size = weapon.magSize > 0 ? weapon.magSize : 0;
    const low = mag === 0 ? 2 : size && mag / size <= 0.25 ? 1 : 0;
    if (low !== w.low) {
      r.weapon.classList.toggle('is-low', low === 1);
      r.weapon.classList.toggle('is-out', low === 2);
      w.low = low;
    }
    const rl = weapon.reloading01;
    const reloading = rl != null && rl > 0 && rl < 1;
    if (reloading !== w.reloading) {
      r.weapon.classList.toggle('is-reloading', reloading);
      r.xreload.classList.toggle('is-on', reloading);
      w.reloading = reloading;
      w.pct = -1;
    }
    if (reloading) {
      const pct = Math.round(rl * 200) / 200;
      if (pct !== w.pct) {
        const t = 'scaleX(' + pct + ')';
        r.weaponReloadFill.style.transform = t;
        r.xreloadFill.style.transform = t;
        w.pct = pct;
      }
    }
  }

  // ---- build mode ----------------------------------------------------------------
  function setBuildMode(mode) {
    const m = mode && pieceEls[mode] ? mode : null;
    if (m === lastBuild) return;
    for (const id in pieceEls) pieceEls[id].classList.toggle('is-active', id === m);
    r.build.classList.toggle('is-on', !!m);
    r.mats.classList.toggle('is-building', !!m);
    lastBuild = m;
    refreshActive();
  }

  // ---- storm -----------------------------------------------------------------------
  const st = { phase: null, secs: null, state: null, outside: null };
  function setStorm(storm) {
    const s = storm || {};
    const state = STORM_LABELS[s.state] ? s.state : 'waiting';
    if (state !== st.state) {
      r.storm.dataset.state = state;
      r.stormLabel.textContent = STORM_LABELS[state];
      st.state = state;
    }
    const secs = Math.max(0, Math.ceil(Number.isFinite(s.secondsLeft) ? s.secondsLeft : 0));
    if (secs !== st.secs) {
      r.stormTime.textContent = fmtTime(secs);
      r.storm.classList.toggle('is-urgent', secs <= 10 && secs > 0);
      st.secs = secs;
    }
    const phase = s.phase == null ? '' : String(s.phase);
    if (phase !== st.phase) {
      r.stormPhase.textContent = phase;
      st.phase = phase;
    }
    const outside = !!s.outside;
    if (outside !== st.outside) {
      hud.classList.toggle('is-outside', outside);
      st.outside = outside;
    }
  }

  /** Hide the storm panel entirely (free build has no storm). */
  function setStormVisible(on) {
    r.storm.style.display = on ? '' : 'none';
  }

  // ---- counts ----------------------------------------------------------------------
  let lastAlive = null;
  let lastElims = null;
  function setCounts(counts) {
    const c = counts || {};
    const alive = Math.max(0, int(c.alive));
    const elims = Math.max(0, int(c.eliminations));
    if (alive !== lastAlive) {
      r.alive.textContent = alive;
      if (lastAlive !== null) pop(r.alive, 1.3, 220);
      lastAlive = alive;
    }
    if (elims !== lastElims) {
      r.elims.textContent = elims;
      if (lastElims !== null) pop(r.elims, 1.5, 300);
      lastElims = elims;
    }
  }

  // ---- compass ---------------------------------------------------------------------
  let lastHeadingKey = null;
  let lastDeg = null;
  function setCompass(headingDegrees) {
    let h = Number.isFinite(headingDegrees) ? headingDegrees % 360 : 0;
    if (h < 0) h += 360;
    const key = Math.round(h * 10);
    if (key === lastHeadingKey) return;
    lastHeadingKey = key;
    r.strip.style.transform = 'translate3d(' + (-(h + 180) / 7.2).toFixed(3) + '%,0,0)';
    const deg = Math.round(h) % 360;
    if (deg !== lastDeg) {
      r.deg.textContent = deg + '°';
      lastDeg = deg;
    }
  }

  // ---- crosshair -------------------------------------------------------------------
  const xh = { spread: null, hit: null, kind: null };
  function setCrosshair(cross) {
    const c = cross || {};
    const kind = c.kind === 'pickaxe' || c.kind === 'build' ? c.kind : 'gun';
    if (kind !== xh.kind) {
      r.xhair.dataset.kind = kind;
      xh.kind = kind;
    }
    const spread = Math.round(clamp01(c.spread01 || 0) * 50) / 50;
    if (spread !== xh.spread) {
      r.xhair.style.setProperty('--spread', spread);
      xh.spread = spread;
    }
    const hit = !!c.hit;
    if (hit !== xh.hit) {
      r.xhair.classList.toggle('is-hit', hit);
      xh.hit = hit;
    }
  }

  function hitMarker(isHeadshot, isKill) {
    const el = r.hitmarker;
    const cls = 'br-hitmarker' + (isKill ? ' is-kill' : isHeadshot ? ' is-head' : '');
    if (el.className !== cls) el.className = cls;
    if (!canAnimate) return;
    const big = isKill ? 1.7 : isHeadshot ? 1.4 : 1.15;
    el.animate(
      [
        { opacity: 0, transform: 'translate(-50%,-50%) scale(0.5) rotate(0deg)' },
        { opacity: 1, transform: `translate(-50%,-50%) scale(${big}) rotate(${isKill ? 8 : 0}deg)`, offset: 0.25 },
        { opacity: 1, transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0.6 },
        { opacity: 0, transform: 'translate(-50%,-50%) scale(0.9) rotate(0deg)' },
      ],
      { duration: isKill ? 520 : isHeadshot ? 360 : 260, easing: 'ease-out' }
    );
  }

  function damageFlash(amount01) {
    const a = clamp01(amount01 == null ? 0.5 : amount01);
    if (a <= 0 || !canAnimate) return;
    r_dmg.animate([{ opacity: 0.35 + 0.65 * a }, { opacity: 0 }], { duration: 320 + 520 * a, easing: 'ease-out' });
  }
  const r_dmg = hud.querySelector('.br-vig-dmg');

  // ---- kill feed -------------------------------------------------------------------
  function removeFeedLine(line) {
    if (!line.parentNode || line.dataset.leaving) return;
    line.dataset.leaving = '1';
    line.classList.add('is-leaving');
    later(() => line.remove(), 260);
  }
  function killFeed(text, kind) {
    if (text == null || text === '') return;
    const line = document.createElement('div');
    line.className = 'br-feed-line';
    line.dataset.kind = kind || 'elim';
    line.innerHTML = icon(kind === 'storm' ? 'storm' : kind === 'info' ? 'star' : 'skull');
    const span = document.createElement('span');
    span.textContent = String(text);
    line.appendChild(span);
    r.feed.appendChild(line);
    const live = r.feed.querySelectorAll('.br-feed-line:not(.is-leaving)');
    for (let i = 0; i < live.length - FEED_MAX; i++) live[i].remove();
    later(() => removeFeedLine(line), FEED_MS);
  }

  // ---- prompt / announce / toast ------------------------------------------------------
  let lastPrompt = null;
  function prompt(text) {
    const t = text == null || text === '' ? null : String(text);
    if (t === lastPrompt) return;
    lastPrompt = t;
    if (t === null) {
      r.prompt.classList.remove('is-on');
      return;
    }
    fillKeyedText(r.prompt, t);
    r.prompt.classList.add('is-on');
  }

  let announceTimer = 0;
  function announce(title, subtitle, ms) {
    clearTimeout(announceTimer);
    timers.delete(announceTimer);
    r.annTitle.textContent = title == null ? '' : String(title);
    r.annSub.textContent = subtitle == null ? '' : String(subtitle);
    r.annSub.hidden = !subtitle;
    r.announce.classList.remove('is-on');
    void r.announce.offsetWidth; // restart the entrance animation (rare call, reflow is fine)
    r.announce.classList.add('is-on');
    announceTimer = later(() => r.announce.classList.remove('is-on'), ms > 0 ? ms : 3000);
  }

  function toast(text, kind) {
    if (text == null || text === '') return;
    const t = String(text);
    // de-dupe: an identical toast that is still showing just gets a nudge
    const same = Array.from(r.toasts.children).find((c) => c.textContent === t && !c.dataset.leaving);
    if (same) {
      pop(same, 1.1, 160);
      return;
    }
    const el = document.createElement('div');
    el.className = 'br-toast';
    el.dataset.kind = kind || 'info';
    el.textContent = t;
    r.toasts.appendChild(el);
    while (r.toasts.children.length > TOAST_MAX) r.toasts.firstChild.remove();
    later(() => {
      el.dataset.leaving = '1';
      el.classList.add('is-leaving');
      later(() => el.remove(), 220);
    }, TOAST_MS);
  }

  // ---- floating text (pooled) ----------------------------------------------------------
  const floats = [];
  for (let i = 0; i < FLOAT_POOL; i++) {
    const el = document.createElement('div');
    el.className = 'br-float';
    el.innerHTML = '<span class="br-float-ico"></span><span class="br-float-txt br-ol"></span>';
    r.floats.appendChild(el);
    floats.push({ el, ico: el.firstChild, txt: el.lastChild, kind: null, text: null });
  }
  let floatCursor = 0;
  function floatText(screenX, screenY, text, kind) {
    if (!canAnimate) return;
    const f = floats[floatCursor];
    floatCursor = (floatCursor + 1) % FLOAT_POOL;
    const k = kind || 'damage';
    if (k !== f.kind) {
      f.el.dataset.kind = k;
      f.ico.innerHTML = FLOAT_ICONS[k] ? icon(FLOAT_ICONS[k]) : '';
      f.kind = k;
    }
    const t = String(text);
    if (t !== f.text) {
      f.txt.textContent = t;
      f.text = t;
    }
    const x = Math.round(screenX);
    const y = Math.round(screenY);
    const rise = (k === 'crit' ? 78 : 62) * unit;
    const drift = (Math.random() * 2 - 1) * 22 * unit;
    const peak = k === 'crit' ? 1.5 : 1.15;
    f.el.animate(
      [
        { opacity: 0, transform: `translate3d(${x}px,${y}px,0) translate(-50%,-50%) scale(0.5)` },
        { opacity: 1, transform: `translate3d(${x + drift * 0.2}px,${y - rise * 0.25}px,0) translate(-50%,-50%) scale(${peak})`, offset: 0.16 },
        { opacity: 1, transform: `translate3d(${x + drift * 0.7}px,${y - rise * 0.75}px,0) translate(-50%,-50%) scale(1)`, offset: 0.7 },
        { opacity: 0, transform: `translate3d(${x + drift}px,${y - rise}px,0) translate(-50%,-50%) scale(0.9)` },
      ],
      { duration: k === 'crit' ? 1050 : 900, easing: 'ease-out' }
    );
  }

  // ---- harvested-object health bar ---------------------------------------------------------
  const ob = { on: false, x: null, y: null, pct: null, kind: null };
  function setObjectBar(bar) {
    if (!bar) {
      if (ob.on) {
        r.objbar.classList.remove('is-on');
        ob.on = false;
      }
      return;
    }
    if (!ob.on) {
      r.objbar.classList.add('is-on');
      ob.on = true;
    }
    const x = Math.round(bar.screenX);
    const y = Math.round(bar.screenY);
    if (x !== ob.x || y !== ob.y) {
      r.objbar.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      ob.x = x;
      ob.y = y;
    }
    // pct is 0..1; values above 1 are treated as 0..100
    let p = Number.isFinite(bar.pct) ? bar.pct : 0;
    if (p > 1) p /= 100;
    p = Math.round(clamp01(p) * 100) / 100;
    if (p !== ob.pct) {
      r.objbarFill.style.transform = 'scaleX(' + p + ')';
      ob.pct = p;
    }
    const kind = bar.kind || 'wood';
    if (kind !== ob.kind) {
      r.objbar.dataset.kind = kind;
      ob.kind = kind;
    }
  }

  // ---- map / misc ----------------------------------------------------------------------------
  let fullMapOn = false;
  function showFullMap(on) {
    const v = !!on;
    if (v === fullMapOn) return;
    fullMapOn = v;
    r.fullmap.classList.toggle('is-on', v);
    hud.classList.toggle('has-fullmap', v);
  }
  /**
   * Sizes the full-map canvas to the map's width/height ratio (meta.bounds). The short side
   * stays 1024 px so Minimap's 1024-based label/icon scale is unchanged.
   */
  function setFullMapAspect(aspect) {
    const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(4, Math.max(0.25, aspect)) : 1;
    const c = r.fullmapCanvas;
    const w = a >= 1 ? Math.round(1024 * a) : 1024;
    const h = a >= 1 ? 1024 : Math.round(1024 / a);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    c.style.setProperty('--br-map-aspect', String(w / h));
  }
  let emoteOn = false;
  function setEmoteHint(on) {
    const v = !!on;
    if (v === emoteOn) return;
    emoteOn = v;
    r.emote.classList.toggle('is-on', v);
  }

  let lastLocation = DEFAULT_LOCATION;
  /** Text of the small location tag under the storm panel (e.g. a landmark name). null/'' restores the default. */
  function setLocation(text) {
    const t = text == null || text === '' ? DEFAULT_LOCATION : String(text);
    if (t === lastLocation) return;
    lastLocation = t;
    r.loc.textContent = t;
  }
  let visible = true;
  /** Hides / shows the whole HUD (e.g. while a menu screen is up). */
  function setVisible(on) {
    const v = !!on;
    if (v === visible) return;
    visible = v;
    hud.classList.toggle('is-hidden', !v);
  }

  // sensible first paint
  setHealth(100, 100);
  setShield(0, 100);
  setMaterials({ wood: 0, brick: 0, metal: 0 }, 'wood');
  setHotbar([null, null, null, null, null], -1);
  setWeapon(null);
  setStorm({ phase: 1, secondsLeft: 0, state: 'waiting', outside: false });
  setCounts({ alive: 0, eliminations: 0 });
  setCompass(0);
  setCrosshair({ spread01: 0, hit: false, kind: 'gun' });

  /** Refreshes the static keycaps from the player's bindings. labelOf(actionId) -> 'Q'. */
  function setKeyLabels(labelOf) {
    const set = (sel, action) => hud.querySelectorAll(sel).forEach((k) => (k.textContent = labelOf(action)));
    for (const [piece, action] of [['wall', 'buildWall'], ['floor', 'buildFloor'], ['ramp', 'buildRamp'], ['cone', 'buildCone']]) set(`.br-piece[data-piece="${piece}"] .br-key`, action);
    for (let i = 0; i < 5; i++) set(`.br-slot[data-slot="${i}"] .br-slot-key`, 'slot' + (i + 1));
    set('.br-slot-pick .br-slot-key', 'pickaxe');
    set('.br-minimap-key .br-key, .br-fullmap-hint .br-key', 'map');
    set('.br-emote .br-key', 'emote');
    set('.br-mats-key .br-key', 'cycleMaterial');
  }

  return {
    el: hud,
    setKeyLabels,
    setHealth,
    setShield,
    setMaterials,
    setHotbar,
    setWeapon,
    setBuildMode,
    setStorm,
    setStormVisible,
    setCounts,
    setCompass,
    setCrosshair,
    hitMarker,
    damageFlash,
    killFeed,
    prompt,
    announce,
    toast,
    floatText,
    setObjectBar,
    getMinimapCanvas: () => r.minimap,
    getFullMapCanvas: () => r.fullmapCanvas,
    setFullMapAspect,
    showFullMap,
    setEmoteHint,
    setLocation,
    setVisible,
    /** Clears transient HUD bits (feed, toasts, prompt, announce) — used when leaving a match. */
    clearTransient() {
      r.feed.textContent = '';
      r.toasts.textContent = '';
      prompt(null);
      r.announce.classList.remove('is-on');
      setObjectBar(null);
      showFullMap(false);
    },
    destroy() {
      window.removeEventListener('resize', measure);
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      hud.remove();
    },
  };
}
