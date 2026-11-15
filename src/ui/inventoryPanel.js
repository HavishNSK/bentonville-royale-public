// BENTONVILLE ROYALE — inventory screen (opened with the `inventory` action, Tab by default).
//
//   const panel = createInventoryPanel(hud.el, { onSwap(a, b), onSelect(i) });
//   panel.show(true);                         // Game unlocks the pointer around this
//   panel.update({ slots, items, selected, ammo, mats, lockedReason });   // every frame while open
//   panel.isDragging()                        // true while a card is being carried
//   panel.shownItem(i)                        // raw slot object the card currently shows
//   panel.setKeyLabels((action) => 'TAB');
//   panel.hovered()                           // slot index under the cursor, or -1
//
// Five big cards mirror the hotbar. Drag a card onto another one to swap them
// (pointer events, so mouse / pen / touch all work); a plain click equips that
// slot. Ammo reserves and building materials are listed underneath. The panel
// never mutates the inventory itself: Game.swapSlots() decides (and syncs it
// to the host in multiplayer). Text goes through textContent; icon() is our
// own static SVG.

import './inventoryPanel.css';
import { icon, hasIcon } from './icons.js';
import { AMMO, MATERIALS, RARITIES } from '../core/config.js';

const SLOTS = 5;
const DRAG_PX = 6; // pointer travel before a press becomes a drag
const AMMO_KINDS = Object.keys(AMMO);
const MAT_NAME = { wood: 'Wood', brick: 'Brick', metal: 'Metal' };

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {HTMLElement} hudEl the .br-hud root (the panel mounts inside it)
 * @param {{ onSwap?: (a:number, b:number, expect?: Array) => void, onSelect?: (i:number) => void }} [opts]
 *   onSwap's `expect` is [item at a, item at b] as shown when the drag started (raw slot
 *   objects); the caller refuses the swap if the inventory changed under the drag.
 */
export function createInventoryPanel(hudEl, opts = {}) {
  const root = h('div', 'br-inv');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Inventory');
  root.setAttribute('aria-hidden', 'true');

  const frame = h('div', 'br-inv-frame');
  const head = h('div', 'br-inv-head');
  const title = h('div', 'br-inv-title');
  title.textContent = 'INVENTORY';
  const status = h('div', 'br-inv-status');
  head.append(title, status);

  const row = h('div', 'br-inv-slots');
  const cards = [];
  for (let i = 0; i < SLOTS; i++) {
    const el = h('div', 'br-inv-card is-empty');
    el.dataset.slot = String(i);
    const key = h('span', 'br-slot-key br-inv-key', String(i + 1));
    const ico = h('div', 'br-inv-ico');
    const name = h('div', 'br-inv-name');
    const meta = h('div', 'br-inv-meta');
    const rar = h('span', 'br-inv-rar');
    const num = h('b', 'br-inv-num');
    meta.append(rar, num);
    const tag = h('span', 'br-inv-tag', 'EQUIPPED');
    el.append(key, tag, ico, name, meta);
    row.appendChild(el);
    cards.push({ el, key, ico, name, rar, num, sig: null, active: null });
  }

  const lower = h('div', 'br-inv-lower');
  const ammoBox = h('div', 'br-inv-group');
  ammoBox.appendChild(h('div', 'br-inv-sub', 'AMMO'));
  const ammoEls = {};
  for (const k of AMMO_KINDS) {
    const r = h('div', 'br-inv-res');
    r.dataset.ammo = k;
    const ic = h('span', 'br-inv-res-ico');
    ic.innerHTML = icon('bullets');
    const n = h('span', 'br-inv-res-name', AMMO[k].name.replace(/ Rounds$/, '')); // 'Light', 'Shells', ...
    r.title = AMMO[k].name;
    const c = h('b', 'br-inv-res-num', '0');
    r.append(ic, n, c);
    ammoBox.appendChild(r);
    ammoEls[k] = { el: r, num: c, v: null };
  }
  const matBox = h('div', 'br-inv-group');
  matBox.appendChild(h('div', 'br-inv-sub', 'MATERIALS'));
  const matEls = {};
  for (const m of MATERIALS) {
    const r = h('div', 'br-inv-res');
    r.dataset.mat = m;
    const ic = h('span', 'br-inv-res-ico');
    ic.innerHTML = hasIcon(m) ? icon(m) : '';
    const n = h('span', 'br-inv-res-name', MAT_NAME[m] || m);
    const c = h('b', 'br-inv-res-num', '0');
    r.append(ic, n, c);
    matBox.appendChild(r);
    matEls[m] = { el: r, num: c, v: null };
  }
  lower.append(ammoBox, matBox);

  const hint = h('div', 'br-inv-hint');
  const hintText = h('span', null, 'DRAG TO REORDER · CLICK TO EQUIP · ');
  const closeKey = h('kbd', 'br-key', 'TAB');
  const closeText = h('span', null, 'CLOSE');
  hint.append(hintText, closeKey, closeText);

  frame.append(head, row, lower, hint);
  root.appendChild(frame);
  hudEl.appendChild(root);

  let open = false;
  let hover = -1;
  let locked = false;
  let drag = null; // { from, id, x0, y0, moved, ghost, target, items }
  let shown = new Array(SLOTS).fill(null); // raw slot objects the cards show (identity checks)

  // ---- drag & drop -------------------------------------------------------------
  const cardAt = (x, y) => {
    const t = document.elementFromPoint(x, y);
    const c = t && t.closest ? t.closest('.br-inv-card') : null;
    return c && root.contains(c) ? +c.dataset.slot : -1;
  };
  function setTarget(i) {
    if (!drag || drag.target === i) return;
    if (drag.target >= 0) cards[drag.target].el.classList.remove('is-target');
    drag.target = i;
    if (i >= 0 && i !== drag.from) cards[i].el.classList.add('is-target');
  }
  function placeGhost(x, y) {
    if (drag && drag.ghost) drag.ghost.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%) rotate(-4deg)`;
  }
  function endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    cards[d.from].el.classList.remove('is-lifted');
    if (d.target >= 0) cards[d.target].el.classList.remove('is-target');
    root.classList.remove('is-dragging');
    if (!commit) return;
    if (d.moved) {
      if (d.target >= 0 && d.target !== d.from && opts.onSwap) opts.onSwap(d.from, d.target, [d.items[d.from], d.items[d.target]]);
    } else if (opts.onSelect) opts.onSelect(d.from);
  }

  cards.forEach((c, i) => {
    c.el.addEventListener('pointerenter', () => (hover = i));
    c.el.addEventListener('pointerleave', () => {
      if (hover === i) hover = -1;
    });
    c.el.addEventListener('pointerdown', (e) => {
      if (!open || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      drag = { from: i, id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, target: -1, items: shown.slice() };
      try {
        c.el.setPointerCapture(e.pointerId);
      } catch (err) {
        /* synthetic events have no active pointer */
      }
    });
    c.el.addEventListener('pointermove', (e) => {
      if (!drag || drag.from !== i || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
        if (c.el.classList.contains('is-empty') || locked) return; // nothing to carry / swaps blocked
        drag.moved = true;
        const g = h('div', 'br-inv-ghost');
        if (c.el.dataset.rarity) g.dataset.rarity = c.el.dataset.rarity;
        g.innerHTML = c.ico.innerHTML; // our own SVG markup
        root.appendChild(g);
        drag.ghost = g;
        c.el.classList.add('is-lifted');
        root.classList.add('is-dragging');
      }
      placeGhost(e.clientX, e.clientY);
      setTarget(cardAt(e.clientX, e.clientY));
    });
    c.el.addEventListener('pointerup', (e) => {
      if (!drag || drag.from !== i || e.pointerId !== drag.id) return;
      if (drag.moved) setTarget(cardAt(e.clientX, e.clientY));
      endDrag(true);
    });
    c.el.addEventListener('pointercancel', () => endDrag(false));
    c.el.addEventListener('lostpointercapture', () => {
      if (drag && drag.from === i && drag.moved) endDrag(false);
    });
  });
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- per-frame state -----------------------------------------------------------
  /**
   * @param {{ slots: Array, selected: number, ammo: object, mats: object, lockedReason?: string|null }} s
   *   slots are Inventory.hotbar() views: null | { name, icon, rarity, ammo?, count? }
   *   items are the raw Inventory.slots objects behind them (identity-checked on swap)
   */
  function update(s) {
    if (!open || !s) return;
    const list = s.slots || [];
    for (let i = 0; i < SLOTS; i++) shown[i] = (s.items && s.items[i]) || null;
    for (let i = 0; i < SLOTS; i++) {
      const c = cards[i];
      const it = list[i] || null;
      const rarity = it ? (RARITIES.includes(it.rarity) ? it.rarity : 'common') : '';
      const num = !it ? '' : it.ammo != null ? String(it.ammo | 0) : it.count != null ? 'x' + (it.count | 0) : '';
      const sig = it ? `${it.icon}|${it.name}|${rarity}|${num}` : '';
      if (sig !== c.sig) {
        c.sig = sig;
        c.el.classList.toggle('is-empty', !it);
        if (it) {
          c.el.dataset.rarity = rarity;
          c.ico.innerHTML = hasIcon(it.icon) ? icon(it.icon) : '';
          c.name.textContent = it.name || '';
          c.rar.textContent = rarity.toUpperCase();
          c.num.textContent = it.ammo != null ? num + ' IN MAG' : num;
          c.num.classList.toggle('is-zero', it.ammo != null && (it.ammo | 0) === 0);
        } else {
          c.el.removeAttribute('data-rarity');
          c.ico.textContent = '';
          c.name.textContent = 'Empty';
          c.rar.textContent = '';
          c.num.textContent = '';
        }
      }
      const active = s.selected === i;
      if (active !== c.active) {
        c.active = active;
        c.el.classList.toggle('is-active', active);
      }
    }
    for (const k of AMMO_KINDS) {
      const v = Math.max(0, (s.ammo && s.ammo[k]) | 0);
      const a = ammoEls[k];
      if (v !== a.v) {
        a.v = v;
        a.num.textContent = String(v);
        a.el.classList.toggle('is-zero', v === 0);
      }
    }
    for (const m of MATERIALS) {
      const v = Math.max(0, (s.mats && s.mats[m]) | 0);
      const a = matEls[m];
      if (v !== a.v) {
        a.v = v;
        a.num.textContent = String(v);
        a.el.classList.toggle('is-zero', v === 0);
      }
    }
    const reason = s.lockedReason || '';
    if (!!reason !== locked || status.textContent !== reason) {
      locked = !!reason;
      status.textContent = reason;
      root.classList.toggle('is-locked', locked);
      if (locked && drag && drag.moved) endDrag(false);
    }
  }

  function show(on) {
    const v = !!on;
    if (v === open) return;
    open = v;
    if (!v) {
      endDrag(false);
      hover = -1;
    }
    root.classList.toggle('is-on', v);
    root.setAttribute('aria-hidden', v ? 'false' : 'true');
    hudEl.classList.toggle('has-inventory', v);
  }

  /** Keycaps from the player's bindings. labelOf(actionId) -> 'TAB'. */
  function setKeyLabels(labelOf) {
    for (let i = 0; i < SLOTS; i++) cards[i].key.textContent = labelOf('slot' + (i + 1));
    closeKey.textContent = labelOf('inventory');
  }

  return {
    el: root,
    show,
    update,
    setKeyLabels,
    isOpen: () => open,
    /** True while a card is lifted or pressed (the caller should hold inventory syncs). */
    isDragging: () => !!drag,
    /** Raw slot object card i showed at the last update(). */
    shownItem: (i) => shown[i] || null,
    /** Slot index under the cursor (for "press a slot key to move the hovered item there"), or -1. */
    hovered: () => (open && !drag ? hover : -1),
    destroy() {
      endDrag(false);
      root.remove();
    },
  };
}
