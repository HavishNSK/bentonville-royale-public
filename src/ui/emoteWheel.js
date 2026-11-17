// BENTONVILLE ROYALE — in-match emote wheel (hold the emote key, flick the mouse, let go).
//
//   const wheel = createEmoteWheel(hud.el);
//   wheel.show(['emote_cheer', 'emote_sit', null, ...])   // the six equipped emotes
//   wheel.select(i)                                       // highlighted segment, -1 = none
//   wheel.hide()
//
// Six segments clockwise from the top; number keys 1-6 pick directly. A quick tap of the
// emote key (no flick) plays the first emote. Text goes through textContent.

import './emoteWheel.css';
import { emoteDef, EMOTE_SLOTS } from '../game/Cosmetics.js';

const RARITY_CSS = { common: 'var(--br-common)', uncommon: 'var(--br-uncommon)', rare: 'var(--br-rare)', epic: 'var(--br-epic)', legendary: 'var(--br-legendary)' };

export function createEmoteWheel(hudEl) {
  const root = document.createElement('div');
  root.className = 'br-ew';
  root.setAttribute('aria-hidden', 'true');
  const ring = document.createElement('div');
  ring.className = 'br-ew-ring';
  root.appendChild(ring);
  const hl = document.createElement('div');
  hl.className = 'br-ew-hl';
  root.appendChild(hl);
  const mid = document.createElement('div');
  mid.className = 'br-ew-mid';
  const midName = document.createElement('b');
  const midKind = document.createElement('small');
  mid.append(midName, midKind);
  root.appendChild(mid);
  const segs = [];
  const R = 128; // segment centre radius in --u
  for (let i = 0; i < EMOTE_SLOTS; i++) {
    const a = (i / EMOTE_SLOTS) * Math.PI * 2;
    const s = document.createElement('div');
    s.className = 'br-ew-seg';
    s.style.transform = '';
    s.style.left = `calc(50% + var(--u) * ${Math.round(Math.sin(a) * R)})`;
    s.style.top = `calc(50% - var(--u) * ${Math.round(Math.cos(a) * R)})`;
    const key = document.createElement('i'); // rarity-coloured badge with the number key
    key.textContent = String(i + 1);
    const name = document.createElement('span');
    s.append(key, name);
    root.appendChild(s);
    segs.push({ el: s, name });
  }
  hudEl.appendChild(root);
  let list = [];
  let sel = -2;

  return {
    show(ids) {
      list = (ids || []).slice(0, EMOTE_SLOTS);
      for (let i = 0; i < EMOTE_SLOTS; i++) {
        const d = emoteDef(list[i]);
        segs[i].name.textContent = d ? d.name : 'Empty';
        segs[i].el.classList.toggle('is-empty', !d);
        segs[i].el.style.setProperty('--rar', d ? RARITY_CSS[d.rarity] || RARITY_CSS.common : '');
      }
      sel = -2;
      this.select(-1);
      root.classList.add('is-on');
    },
    select(i) {
      if (i === sel) return;
      sel = i;
      segs.forEach((s, k) => s.el.classList.toggle('is-sel', k === i));
      const d = i >= 0 ? emoteDef(list[i]) : null;
      midName.textContent = d ? d.name : 'EMOTE';
      midKind.textContent = d ? d.rarity : i >= 0 ? 'empty slot' : 'flick or 1-6';
      mid.style.setProperty('--rar', d ? RARITY_CSS[d.rarity] || '' : '');
      hl.classList.toggle('is-on', i >= 0);
      if (i >= 0) {
        hl.style.setProperty('--a', `${i * (360 / EMOTE_SLOTS)}deg`);
        hl.style.setProperty('--hl', d ? RARITY_CSS[d.rarity] || 'var(--br-sun)' : 'rgba(255,246,220,.5)');
      }
    },
    hide() {
      root.classList.remove('is-on');
    },
    isOpen: () => root.classList.contains('is-on'),
  };
}
