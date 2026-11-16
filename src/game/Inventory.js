// BENTONVILLE ROYALE — an actor's inventory. Pure data: no THREE, no DOM, so
// it runs in Node for tests.
//
//   const inv = new Inventory();
//   inv.add({ type: 'weapon', id: 'rifle', rarity: 'rare', mag: 30 })   // -> leftover Item | null
//   hud.setHotbar(inv.hotbar(), inv.selected);
//   hud.setMaterials(inv.mats, activeMat);
//   hud.setWeapon(inv.weaponHud());                                       // extra helper
//
// Item shapes (agents/CONTRACTS.md):
//   { type: 'weapon',     id, rarity, mag }
//   { type: 'consumable', id, count }            (rarity comes from CONSUMABLES[id])
//   { type: 'ammo',       ammo, count }
//   { type: 'material',   mat, count }
//
// Rules
//   - 5 slots; each holds one weapon or one consumable stack (CONSUMABLES[id].stack).
//   - Ammo and materials are counters. Ammo caps at AMMO_CAP, mats at PLAYER.matCap.
//   - add() never mutates the item passed in. Slots hold copies.
//   - add() returns what did not fit. With all slots full and a real slot selected,
//     a weapon or consumable is swapped into the selected slot and the old item is
//     returned. With the pickaxe selected nothing is swapped.

import { PLAYER, WEAPONS, CONSUMABLES, AMMO, MATERIALS, RARITIES } from '../core/config.js';

export const SLOT_COUNT = 5;
export const AMMO_CAP = 999;
const AMMO_KINDS = Object.keys(AMMO);

const rarityOf = (r) => (RARITIES.includes(r) ? r : 'common');

function copyItem(item) {
  switch (item.type) {
    case 'weapon':
      return { type: 'weapon', id: item.id, rarity: rarityOf(item.rarity), mag: Number.isFinite(item.mag) ? item.mag : WEAPONS[item.id].mag };
    case 'consumable':
      return { type: 'consumable', id: item.id, count: Math.max(1, item.count | 0 || 1) };
    case 'ammo':
      return { type: 'ammo', ammo: item.ammo, count: Math.max(0, item.count | 0) };
    case 'material':
      return { type: 'material', mat: item.mat, count: Math.max(0, item.count | 0) };
    default:
      return null;
  }
}

function validItem(item) {
  if (!item || typeof item !== 'object') return false;
  switch (item.type) {
    case 'weapon':
      return !!WEAPONS[item.id];
    case 'consumable':
      return !!CONSUMABLES[item.id];
    case 'ammo':
      return AMMO_KINDS.includes(item.ammo) && item.count > 0;
    case 'material':
      return MATERIALS.includes(item.mat) && item.count > 0;
    default:
      return false;
  }
}

export class Inventory {
  constructor(loadout) {
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.selected = -1;
    this.ammo = { light: 0, medium: 0, shells: 0, heavy: 0 };
    this.mats = { wood: 0, brick: 0, metal: 0 };
    /** Bumped on every change; cheap dirty check for HUD code. */
    this.version = 0;
    this.reset(loadout);
  }

  /**
   * Empties everything and selects the pickaxe. Optional loadout:
   * { items: Item[], ammo: {kind: n}, mats: {mat: n}, selected }
   */
  reset(loadout) {
    for (let i = 0; i < SLOT_COUNT; i++) this.slots[i] = null;
    this.selected = -1;
    for (const k of AMMO_KINDS) this.ammo[k] = 0;
    for (const m of MATERIALS) this.mats[m] = 0;
    if (loadout) {
      if (Array.isArray(loadout.items)) for (const it of loadout.items) this.add(it);
      if (loadout.ammo) for (const k of AMMO_KINDS) if (loadout.ammo[k] > 0) this.add({ type: 'ammo', ammo: k, count: loadout.ammo[k] });
      if (loadout.mats) for (const m of MATERIALS) if (loadout.mats[m] > 0) this.add({ type: 'material', mat: m, count: loadout.mats[m] });
      if (Number.isInteger(loadout.selected)) this.select(loadout.selected);
    }
    this.version++;
    return this;
  }

  _emptySlot() {
    for (let i = 0; i < SLOT_COUNT; i++) if (!this.slots[i]) return i;
    return -1;
  }

  /** Room left in existing stacks of a consumable id. */
  _stackRoom(id) {
    const cap = CONSUMABLES[id].stack;
    let room = 0;
    for (const s of this.slots) if (s && s.type === 'consumable' && s.id === id) room += Math.max(0, cap - s.count);
    return room;
  }

  /** True when at least part of `item` fits without swapping anything out. */
  canTake(item) {
    if (!validItem(item)) return false;
    switch (item.type) {
      case 'weapon':
        return this._emptySlot() >= 0;
      case 'consumable':
        return this._emptySlot() >= 0 || this._stackRoom(item.id) > 0;
      case 'ammo':
        return this.ammo[item.ammo] < AMMO_CAP;
      case 'material':
        return this.mats[item.mat] < PLAYER.matCap;
    }
    return false;
  }

  /** True when add(item) would swap the selected slot's item out (for "[E] Swap" prompts). */
  wouldSwap(item) {
    if (!validItem(item) || (item.type !== 'weapon' && item.type !== 'consumable')) return false;
    if (this.canTake(item)) return false;
    return this.selected >= 0 && !!this.slots[this.selected];
  }

  /** Adds an item. Returns the leftover / swapped-out Item, or null when everything fit. */
  add(item) {
    if (!validItem(item)) return item || null;
    const it = copyItem(item);
    let out = null;
    switch (it.type) {
      case 'weapon': {
        const e = this._emptySlot();
        if (e >= 0) this.slots[e] = it;
        else if (this.selected >= 0) {
          out = this.slots[this.selected];
          this.slots[this.selected] = it;
        } else out = it;
        break;
      }
      case 'consumable': {
        const cap = CONSUMABLES[it.id].stack;
        let left = it.count;
        for (let i = 0; i < SLOT_COUNT && left > 0; i++) {
          const s = this.slots[i];
          if (s && s.type === 'consumable' && s.id === it.id && s.count < cap) {
            const n = Math.min(cap - s.count, left);
            s.count += n;
            left -= n;
          }
        }
        while (left > 0) {
          const e = this._emptySlot();
          if (e < 0) break;
          const n = Math.min(cap, left);
          this.slots[e] = { type: 'consumable', id: it.id, count: n };
          left -= n;
        }
        if (left > 0) {
          const rest = { type: 'consumable', id: it.id, count: left };
          const sel = this.selected >= 0 ? this.slots[this.selected] : null;
          // swap only when nothing was absorbed, the rest fits one stack, and the
          // held item is something else (add() returns a single Item)
          if (sel && left === it.count && left <= cap && !(sel.type === 'consumable' && sel.id === it.id)) {
            out = sel;
            this.slots[this.selected] = rest;
          } else out = rest;
        }
        break;
      }
      case 'ammo': {
        const n = Math.min(AMMO_CAP - this.ammo[it.ammo], it.count);
        this.ammo[it.ammo] += Math.max(0, n);
        if (it.count - n > 0) out = { type: 'ammo', ammo: it.ammo, count: it.count - n };
        break;
      }
      case 'material': {
        const n = Math.min(PLAYER.matCap - this.mats[it.mat], it.count);
        this.mats[it.mat] += Math.max(0, n);
        if (it.count - n > 0) out = { type: 'material', mat: it.mat, count: it.count - n };
        break;
      }
    }
    this.version++;
    return out;
  }

  /** The held item, or null for the pickaxe (or an empty slot). */
  current() {
    return this.selected >= 0 ? this.slots[this.selected] : null;
  }

  /** Selects slot i (0..4) or the pickaxe (-1). Empty slots may be selected. */
  select(i) {
    const n = Number.isInteger(i) && i >= -1 && i < SLOT_COUNT ? i : -1;
    if (n !== this.selected) {
      this.selected = n;
      this.version++;
    }
    return this.selected;
  }

  /**
   * Swaps slots a and b (0..4; either may be empty). The selection follows the held
   * item: holding a -> now holding it in b, and vice versa. Returns true on a change.
   */
  swap(a, b) {
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < SLOT_COUNT;
    if (!ok(a) || !ok(b) || a === b) return false;
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    if (this.selected === a) this.selected = b;
    else if (this.selected === b) this.selected = a;
    this.version++;
    return true;
  }

  /** Scroll-wheel cycling over pickaxe + filled slots. dir = +1 / -1. */
  next(dir = 1) {
    const order = [-1, 0, 1, 2, 3, 4];
    let idx = order.indexOf(this.selected);
    const step = dir < 0 ? -1 : 1;
    for (let k = 0; k < order.length; k++) {
      idx = (idx + step + order.length) % order.length;
      const s = order[idx];
      if (s === -1 || this.slots[s]) return this.select(s);
    }
    return this.selected;
  }

  /**
   * Consumes one unit of the held consumable. Returns
   * { type: 'consumable', id, count: 1 } for the unit used, or null.
   * The slot is cleared when its stack runs out (selection stays on the slot).
   */
  useConsumable() {
    const s = this.current();
    if (!s || s.type !== 'consumable' || s.count <= 0) return null;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.version++;
    return { type: 'consumable', id: s.id, count: 1 };
  }

  /** Removes up to n rounds of `kind`; returns how many were taken. */
  takeAmmo(kind, n) {
    const have = this.ammo[kind] | 0;
    const t = Math.max(0, Math.min(have, Math.floor(n)));
    if (t > 0) {
      this.ammo[kind] = have - t;
      this.version++;
    }
    return t;
  }

  /**
   * Takes something out to drop on the ground (inventory screen drag-out).
   * what = { s: slot 0..4 } | { ammo: kind } | { mat: material }, plus an optional n: how
   * many to split off a stack (ammo, materials, a consumable stack; default all).
   * Returns the Item or null.
   */
  takeOut(what) {
    if (!what) return null;
    const want = (have) => (Number.isInteger(what.n) && what.n > 0 ? Math.min(have, what.n) : have);
    if (Number.isInteger(what.s) && what.s >= 0 && what.s < SLOT_COUNT) {
      const it = this.slots[what.s];
      if (!it) return null;
      if (it.type === 'consumable' && it.count > 1) {
        const n = want(it.count);
        if (n < it.count) {
          it.count -= n;
          this.version++;
          return { ...it, count: n };
        }
      }
      this.slots[what.s] = null;
      this.version++;
      return it;
    }
    if (what.ammo && AMMO_KINDS.includes(what.ammo)) {
      const n = want(this.ammo[what.ammo] | 0);
      if (n <= 0) return null;
      this.ammo[what.ammo] -= n;
      this.version++;
      return { type: 'ammo', ammo: what.ammo, count: n };
    }
    if (what.mat && MATERIALS.includes(what.mat)) {
      const n = want(this.mats[what.mat] | 0);
      if (n <= 0) return null;
      this.mats[what.mat] -= n;
      this.version++;
      return { type: 'material', mat: what.mat, count: n };
    }
    return null;
  }

  /** Spends n of a material if there is enough. */
  spendMats(mat, n) {
    if (!(mat in this.mats) || this.mats[mat] < n) return false;
    this.mats[mat] -= n;
    this.version++;
    return true;
  }

  /** Reserve ammo for a weapon id (or weapon Item). */
  reserveFor(weapon) {
    const w = WEAPONS[typeof weapon === 'string' ? weapon : weapon && weapon.id];
    return w ? this.ammo[w.ammo] : 0;
  }

  /** Everything as Items (for death drops); the inventory is reset afterwards. */
  dropAll() {
    const out = [];
    for (const s of this.slots) if (s) out.push(s);
    for (const k of AMMO_KINDS) if (this.ammo[k] > 0) out.push({ type: 'ammo', ammo: k, count: this.ammo[k] });
    for (const m of MATERIALS) if (this.mats[m] > 0) out.push({ type: 'material', mat: m, count: this.mats[m] });
    this.reset();
    return out;
  }

  /**
   * Array(5) for hud.setHotbar(slots, inv.selected):
   * null | { name, icon, rarity, ammo? (weapon mag), count? (consumable stack) }
   */
  hotbar() {
    const out = this._hotbar || (this._hotbar = new Array(SLOT_COUNT).fill(null));
    for (let i = 0; i < SLOT_COUNT; i++) out[i] = slotView(this.slots[i]);
    return out;
  }

  /** Shape for hud.setWeapon(...): null for pickaxe / consumable / empty slot. */
  weaponHud(reloading01) {
    const s = this.current();
    if (!s || s.type !== 'weapon') return null;
    const w = WEAPONS[s.id];
    return { name: w.name, rarity: rarityOf(s.rarity), mag: s.mag, reserve: this.ammo[w.ammo], magSize: w.mag, reloading01: reloading01 == null ? 0 : reloading01 };
  }
}

/** HUD view of one slot item. */
export function slotView(s) {
  if (!s) return null;
  if (s.type === 'weapon') {
    const w = WEAPONS[s.id];
    return { name: w.name, icon: w.icon, rarity: rarityOf(s.rarity), ammo: s.mag };
  }
  if (s.type === 'consumable') {
    const c = CONSUMABLES[s.id];
    return { name: c.name, icon: c.icon, rarity: c.rarity, count: s.count };
  }
  return null;
}
