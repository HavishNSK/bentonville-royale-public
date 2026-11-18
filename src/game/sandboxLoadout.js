// BENTONVILLE ROYALE — sandbox gun picker. Menu-only; never used in a match.
import { WEAPON_IDS, WEAPONS, AMMO, CONSUMABLES, weaponRarities, clampWeaponRarity } from '../core/config.js';

export function canSandboxLoadout(game) {
  return !!(game && game.freeBuild && (game.state === 'play' || game.state === 'over'));
}

/** Sandbox-only full map (N). Match play keeps M. */
export function canCreativeMap(game) {
  return !!(game && game.freeBuild && (game.state === 'play' || game.state === 'drop') && !game.paused);
}

/** Every gun the game defines, plus throwable grenades, with the rarities they actually come in. */
export function sandboxWeapons() {
  const throws = ['grenade', 'smoke']
    .map((id) => CONSUMABLES[id])
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, rarities: [c.rarity] }));
  const guns = WEAPON_IDS.map((id) => ({
    id,
    name: WEAPONS[id].name,
    icon: WEAPONS[id].icon,
    rarities: weaponRarities(id),
  }));
  const rocket = guns.find((w) => w.id === 'rocket_launcher');
  const rest = guns.filter((w) => w.id !== 'rocket_launcher');
  return [...throws, rocket, ...rest].filter(Boolean);
}

/**
 * Put `id` in the first empty hotbar slot (or swap the selected one). Guns get a full mag
 * plus reserve ammo; grenades get a full stack. Returns the stored item, or null when unknown.
 */
export function giveSandboxWeapon(inv, id, rarity = 'rare') {
  if (!inv) return null;
  const consumable = CONSUMABLES[id];
  if (consumable && consumable.throwable) {
    const item = { type: 'consumable', id, count: consumable.stack };
    inv.add(item);
    if (inv.selected < 0) {
      const i = inv.slots.findIndex((s) => s && s.type === 'consumable' && s.id === id);
      if (i >= 0) inv.select(i);
    }
    return inv.slots.find((s) => s && s.type === 'consumable' && s.id === id) || item;
  }
  const w = WEAPONS[id];
  if (!w) return null;
  const item = { type: 'weapon', id, rarity: clampWeaponRarity(id, rarity), mag: w.mag };
  inv.add(item);
  if (w.ammo && AMMO[w.ammo]) inv.add({ type: 'ammo', ammo: w.ammo, count: AMMO[w.ammo].cap || 999 });
  if (inv.selected < 0) {
    const i = inv.slots.findIndex((s) => s && s.type === 'weapon' && s.id === id);
    if (i >= 0) inv.select(i);
  }
  return inv.slots.find((s) => s && s.type === 'weapon' && s.id === id) || item;
}
