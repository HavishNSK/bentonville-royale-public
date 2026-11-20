// Inventory screen reordering: Inventory.swap, the panel's drag-and-drop and click-to-swap
// (driven through a tiny fake DOM), and the multiplayer path (host applies 'mv', the client
// keeps its optimistic swap until the host's sync confirms it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Vite imports CSS from JS modules; Node cannot, so stub .css imports as empty modules.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }; return next(url, ctx); }"
    )
);

// ---- minimal DOM: just what src/ui/inventoryPanel.js touches -----------------------------
class FakeClassList {
  constructor() {
    this.s = new Set();
  }
  add(...c) {
    for (const x of c) this.s.add(x);
  }
  remove(...c) {
    for (const x of c) this.s.delete(x);
  }
  contains(c) {
    return this.s.has(c);
  }
  toggle(c, on) {
    const v = on === undefined ? !this.s.has(c) : !!on;
    if (v) this.s.add(c);
    else this.s.delete(c);
    return v;
  }
}
class FakeTarget {
  constructor() {
    this.listeners = {};
  }
  addEventListener(t, f) {
    (this.listeners[t] ||= []).push(f);
  }
  removeEventListener(t, f) {
    this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f);
  }
  fire(t, e = {}) {
    e.type = t;
    e.preventDefault ||= () => {};
    e.stopPropagation ||= () => {};
    for (const f of [...(this.listeners[t] || [])]) f(e);
  }
}
class FakeEl extends FakeTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.children = [];
    this.parent = null;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.innerHTML = '';
    this.textContent = '';
    this.hidden = false;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    this.captureThrows = false;
  }
  set className(v) {
    this.classList = new FakeClassList();
    for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c);
  }
  append(...c) {
    for (const x of c) this.appendChild(x);
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height };
  }
  setPointerCapture() {
    if (this.captureThrows) throw new Error('InvalidStateError');
  }
  querySelector() {
    return new FakeEl('span');
  }
  closest(sel) {
    for (let e = this; e; e = e.parent) if (sel === '.br-inv-card' && e.classList.contains('br-inv-card')) return e;
    return null;
  }
  focus() {}
  get offsetWidth() {
    return 0;
  }
}
const fakeWindow = new FakeTarget();
globalThis.window = fakeWindow;
globalThis.document = { createElement: (t) => new FakeEl(t) };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

const { createInventoryPanel } = await import('../src/ui/inventoryPanel.js');
const { Inventory } = await import('../src/game/Inventory.js');
const { HostSession } = await import('../src/net/HostSession.js');
const { ClientSession } = await import('../src/net/ClientSession.js');

const RIFLE = { type: 'weapon', id: 'rifle', rarity: 'rare' };
const SMG = { type: 'weapon', id: 'smg', rarity: 'common' };

function inventory() {
  return new Inventory({ items: [RIFLE, SMG] });
}

/**
 * Panel wired like Game.js: onSwap -> a swapSlots() with the same stale check, onSelect ->
 * select. Card i sits at x = 100 + 120 i.
 */
function harness(inv = inventory()) {
  const hud = new FakeEl('div');
  const log = [];
  const panel = createInventoryPanel(hud, {
    onSwap(a, b, expect) {
      log.push(['swap', a, b]);
      if (expect && (inv.slots[a] !== (expect[0] || null) || inv.slots[b] !== (expect[1] || null))) return log.push('stale');
      inv.swap(a, b);
    },
    onSelect(i) {
      log.push(['select', i]);
      inv.select(i);
    },
    onDrop(what) {
      log.push(['drop', what]);
    },
  });
  const root = hud.children[0];
  const frame = root.children[0];
  const row = frame.children[1];
  frame.rect = { left: 50, top: 50, width: 700, height: 420 };
  row.rect = { left: 100, top: 100, width: 600, height: 160 };
  row.children.forEach((c, i) => (c.rect = { left: 100 + i * 120, top: 100, width: 110, height: 160 }));
  const update = () => panel.update({ slots: inv.hotbar(), items: inv.slots, selected: inv.selected, ammo: inv.ammo, mats: inv.mats });
  panel.show(true);
  update();
  const card = (i) => row.children[i];
  const cx = (i) => 155 + i * 120;
  const down = (i, extra = {}) => card(i).fire('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: cx(i), clientY: 180, target: card(i), ...extra });
  // move / up go to window (as when pointer capture is lost or refused)
  const move = (x, y = 180, extra = {}) => fakeWindow.fire('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 1, clientX: x, clientY: y, ...extra });
  const up = (x, y = 180) => fakeWindow.fire('pointerup', { pointerType: 'mouse', pointerId: 1, buttons: 0, clientX: x, clientY: y });
  const click = (i) => {
    down(i);
    up(cx(i));
    update();
  };
  const drag = (a, b) => {
    down(a);
    move(cx(a) + 20);
    update();
    move(cx(b));
    update();
    up(cx(b));
    update();
  };
  return { inv, panel, log, card, down, move, up, click, drag, update, root };
}

const ids = (inv) => inv.slots.map((s) => (s ? s.id : null));

// ---- Inventory.swap ------------------------------------------------------------------------

test('Inventory.swap swaps two slots, keeps the held item selected and bumps the version', () => {
  const inv = inventory();
  inv.select(0);
  const v = inv.version;
  assert.equal(inv.swap(0, 3), true);
  assert.deepEqual(ids(inv), [null, 'smg', null, 'rifle', null]);
  assert.equal(inv.selected, 3, 'the selection follows the held rifle');
  assert.equal(inv.current().id, 'rifle');
  assert.ok(inv.version > v);
  assert.deepEqual(inv.hotbar().map((s) => !!s), [false, true, false, true, false], 'the HUD view follows the slots');
});

test('Inventory.swap rejects bad indexes and same-slot swaps', () => {
  const inv = inventory();
  for (const [a, b] of [[0, 0], [-1, 2], [0, 5], [1.5, 2], ['0', 1], [null, 1]]) assert.equal(inv.swap(a, b), false, `${a},${b}`);
  assert.deepEqual(ids(inv), ['rifle', 'smg', null, null, null]);
});

// ---- panel: drag and drop ------------------------------------------------------------------

test('dragging a card onto another card swaps them', () => {
  const h = harness();
  h.drag(0, 1);
  assert.deepEqual(ids(h.inv), ['smg', 'rifle', null, null, null]);
  assert.equal(h.panel.isDragging(), false);
});

test('dragging onto an empty card moves the item there', () => {
  const h = harness();
  h.drag(1, 4);
  assert.deepEqual(ids(h.inv), ['rifle', null, null, null, 'smg']);
});

test('a drag still completes when pointer capture is refused', () => {
  const h = harness();
  h.card(0).captureThrows = true;
  h.drag(0, 2);
  assert.deepEqual(ids(h.inv), [null, 'smg', 'rifle', null, null]);
});

test('a press whose release was never seen does not block the next drag', () => {
  const h = harness();
  h.down(0); // no pointerup (released outside the page)
  assert.equal(h.panel.isDragging(), true);
  h.drag(1, 3);
  assert.deepEqual(ids(h.inv), ['rifle', null, null, 'smg', null]);
  assert.equal(h.panel.isDragging(), false);
});

test('a mouse move with no button held ends a stranded press', () => {
  const h = harness();
  h.down(0);
  h.move(400, 180, { buttons: 0 });
  assert.equal(h.panel.isDragging(), false, 'the client inventory sync is no longer held');
});

test('a stale drag (inventory changed under it) is refused', () => {
  const h = harness();
  h.down(0);
  h.move(200);
  h.inv.slots[1] = { ...h.inv.slots[1] }; // e.g. a host sync replaced the slot objects
  h.move(275);
  h.up(275);
  assert.deepEqual(h.log.at(-1), 'stale');
  assert.deepEqual(ids(h.inv), ['rifle', 'smg', null, null, null]);
});

// ---- panel: click-to-swap ------------------------------------------------------------------

test('click one card, then another, swaps them', () => {
  const h = harness();
  h.click(0);
  assert.equal(h.panel.picked(), 0);
  assert.ok(h.card(0).classList.contains('is-picked'));
  h.click(3);
  assert.deepEqual(ids(h.inv), [null, 'smg', null, 'rifle', null]);
  assert.equal(h.panel.picked(), -1);
  assert.equal(h.card(0).classList.contains('is-picked'), false);
});

test('clicking the picked card again equips it instead', () => {
  const h = harness();
  h.click(1);
  h.click(1);
  assert.deepEqual(h.log, [['select', 1]]);
  assert.equal(h.inv.selected, 1);
  assert.equal(h.panel.picked(), -1);
});

test('closing the panel or a stale pick does not swap', () => {
  const h = harness();
  h.click(0);
  h.panel.show(false);
  assert.equal(h.panel.picked(), -1);
  h.panel.show(true);
  h.update();
  h.click(0);
  h.inv.swap(0, 2); // the picked item moved (e.g. slot key while hovering)
  h.update();
  assert.equal(h.panel.picked(), -1, 'the pick is dropped when its item leaves the slot');
});

// ---- multiplayer ---------------------------------------------------------------------------

test("host applies a client's 'mv' to its copy of that inventory", () => {
  const a = { inventory: inventory(), inBus: false, airborneDrop: false, netReloading: false };
  const host = { game: { combat: { cancelBurst() {} } } };
  HostSession.prototype._action.call(host, a, { k: 'mv', a: 0, b: 2 });
  assert.deepEqual(ids(a.inventory), [null, 'smg', 'rifle', null, null]);
  // out-of-range / malformed indexes are ignored
  HostSession.prototype._action.call(host, a, { k: 'mv', a: 0, b: 9 });
  HostSession.prototype._action.call(host, a, { k: 'mv', a: '1', b: 2 });
  assert.deepEqual(ids(a.inventory), [null, 'smg', 'rifle', null, null]);
});

test("a client's swap survives an older host sync and is confirmed by the newer one", () => {
  const inv = inventory();
  const player = { inventory: inv, alive: true, reloadT: 0, useT: 0 };
  const sent = [];
  const cs = Object.create(ClientSession.prototype);
  Object.assign(cs, {
    started: true,
    seq: 0,
    lastInvSeq: 0,
    pendingInv: null,
    _specAsk: -1,
    _stateAcc: 0,
    _interpolate() {},
    _expirePredicted() {},
    conn: { send: (m) => sent.push(m), backlog: 0 },
    game: { player, inventoryOpen: false, state: 'play' },
  });
  const wire = (slots, ack) => ({ t: 'inv', ack, s: slots.map((s) => (s ? { ...s } : null)), ammo: { ...inv.ammo }, mats: { ...inv.mats } });
  const before = inv.slots.map((s) => (s ? { ...s } : null));
  // the client swaps locally and tells the host
  inv.swap(0, 2);
  cs.sendSwap(0, 2);
  assert.deepEqual(sent.at(-1), { k: 'mv', a: 0, b: 2, t: 'a', seq: 1 });
  // a sync the host sent before it saw the swap must not put the old order back
  cs._message(wire(before, 0));
  cs.update(0);
  assert.deepEqual(ids(inv), [null, 'smg', 'rifle', null, null]);
  // the host's sync after applying 'mv' (ack = 1) is applied and agrees
  const hostInv = inventory();
  hostInv.swap(0, 2);
  cs._message(wire(hostInv.slots, 1));
  cs.update(0);
  assert.deepEqual(ids(inv), [null, 'smg', 'rifle', null, null]);
  assert.equal(cs.pendingInv, null);
});
