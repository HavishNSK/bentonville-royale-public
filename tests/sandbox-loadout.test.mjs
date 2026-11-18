// Sandbox loadout: pick any gun from a menu. Match play never gets it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPON_IDS, WEAPONS, CONSUMABLES } from '../src/core/config.js';
import { ACTIONS, DEFAULT_BINDINGS } from '../src/ui/settings.js';
import { Inventory } from '../src/game/Inventory.js';
import { canSandboxLoadout, canCreativeMap, sandboxWeapons, giveSandboxWeapon } from '../src/game/sandboxLoadout.js';
import { hasIcon } from '../src/ui/icons.js';

test('the loadout menu is sandbox-only', () => {
  assert.equal(canSandboxLoadout({ freeBuild: true, state: 'play' }), true);
  assert.equal(canSandboxLoadout({ freeBuild: true, state: 'play', paused: true }), true);
  assert.equal(canSandboxLoadout({ freeBuild: false, state: 'play' }), false);
  assert.equal(canSandboxLoadout({ freeBuild: true, state: 'drop' }), false);
  assert.equal(canSandboxLoadout({}), false);
});

test('the creative map key is sandbox-only and is not the match map key', () => {
  assert.equal(canCreativeMap({ freeBuild: true, state: 'play', paused: false }), true);
  assert.equal(canCreativeMap({ freeBuild: true, state: 'play', paused: true }), false);
  assert.equal(canCreativeMap({ freeBuild: false, state: 'play', paused: false }), false);
  const act = ACTIONS.find((a) => a.id === 'creativeMap');
  assert.ok(act, 'creativeMap action missing');
  assert.equal(DEFAULT_BINDINGS.creativeMap, 'KeyN');
  assert.notEqual(DEFAULT_BINDINGS.creativeMap, DEFAULT_BINDINGS.map);
});

test('sandboxWeapons lists every gun in the game with its picture', () => {
  const list = sandboxWeapons();
  assert.ok(list.length >= WEAPON_IDS.length);
  const ids = new Set(list.map((w) => w.id));
  for (const id of WEAPON_IDS) {
    assert.ok(ids.has(id), `missing ${id}`);
    const row = list.find((w) => w.id === id);
    assert.equal(row.name, WEAPONS[id].name);
    assert.ok(row.rarities.includes('rare') || row.rarities.length >= 1);
    assert.equal(row.icon, WEAPONS[id].icon);
    assert.ok(hasIcon(row.icon), `${id} has no picture ${row.icon}`);
  }
  assert.ok(ids.has('rocket_launcher'), 'rocket launcher stays on the weapons menu');
});

test('sandboxWeapons lists grenades with their picture', () => {
  const row = sandboxWeapons().find((w) => w.id === 'grenade');
  assert.ok(row, 'grenade missing from the weapons menu');
  assert.equal(row.name, CONSUMABLES.grenade.name);
  assert.equal(row.icon, CONSUMABLES.grenade.icon);
  assert.ok(hasIcon(row.icon), 'grenade has no picture');
});

test('sandboxWeapons lists smoke grenades with their picture', () => {
  const row = sandboxWeapons().find((w) => w.id === 'smoke');
  assert.ok(row, 'smoke missing from the weapons menu');
  assert.equal(row.name, CONSUMABLES.smoke.name);
  assert.ok(hasIcon(row.icon), 'smoke has no picture');
});

test('giveSandboxWeapon puts a full mag and reserve ammo on the hotbar', () => {
  const inv = new Inventory();
  const got = giveSandboxWeapon(inv, 'rifle', 'legendary');
  assert.equal(got.id, 'rifle');
  assert.equal(got.rarity, 'legendary');
  assert.equal(got.mag, WEAPONS.rifle.mag);
  assert.equal(inv.slots[0].id, 'rifle');
  assert.ok(inv.ammo.medium >= 60);
  assert.equal(giveSandboxWeapon(inv, 'nope'), null);
});

test('giveSandboxWeapon puts a full stack of grenades on the hotbar', () => {
  const inv = new Inventory();
  const got = giveSandboxWeapon(inv, 'grenade');
  assert.equal(got.id, 'grenade');
  assert.equal(got.type, 'consumable');
  assert.equal(got.count, CONSUMABLES.grenade.stack);
  assert.equal(inv.slots[0].id, 'grenade');
});
