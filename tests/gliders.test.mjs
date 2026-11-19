// Gliders: the cosmetic slot added with the Scruff set (Cosmetics.GLIDERS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { GLIDERS, PRICES, DEFAULT_OWNED, DEFAULT_EQUIPPED, cosmeticDef, gliderDef, lookString, parseLook, SKINS, PICKAXES, BACKBLINGS } from '../src/game/Cosmetics.js';

test('the classic canopy is free and equipped by default; Paws Up is for sale', () => {
  assert.equal(DEFAULT_EQUIPPED.glider, 'gl_default');
  assert.ok(DEFAULT_OWNED.includes('gl_default'));
  assert.ok(!DEFAULT_OWNED.includes('gl_paws'));
  assert.equal(PRICES.gl_paws, GLIDERS.gl_paws.price);
  assert.equal(cosmeticDef('gl_paws').kind, 'glider');
  assert.equal(gliderDef('gl_paws').pose, 'paws');
  assert.equal(gliderDef('nope'), GLIDERS.gl_default);
});

test('lobby look strings carry the glider and old three-part strings still parse', () => {
  const s = lookString({ skin: 'skin_scruff', pickaxe: 'pick_paw', backbling: 'bb_gecko', glider: 'gl_paws' });
  assert.equal(s, 'skin_scruff|pick_paw|bb_gecko|gl_paws');
  assert.deepEqual(parseLook(s), { skin: 'skin_scruff', pickaxe: 'pick_paw', backbling: 'bb_gecko', glider: 'gl_paws' });
  assert.equal(parseLook('skin_rogue|pick_default|bb_outfit').glider, 'gl_default');
  assert.equal(parseLook('skin_rogue|pick_default|bb_outfit|gl_hacked').glider, 'gl_default');
});

test('the Scruff set is in the catalog', () => {
  assert.ok(SKINS.skin_scruff && PICKAXES.pick_paw && BACKBLINGS.bb_gecko && GLIDERS.gl_paws);
  for (const id of ['skin_scruff', 'pick_paw', 'bb_gecko', 'gl_paws']) assert.ok(PRICES[id] > 0, id);
});

test('Puppy Kick and Tail Spin are pose gliders for sale; Scruff idles with paws up', () => {
  assert.equal(gliderDef('gl_kick').pose, 'kick');
  assert.equal(gliderDef('gl_spin').pose, 'spin');
  for (const id of ['gl_kick', 'gl_spin']) assert.ok(PRICES[id] > 0 && !DEFAULT_OWNED.includes(id), id);
  assert.equal(SKINS.skin_scruff.idle, 'paws');
});

test('Scruff Set bundle: 25,000 coins for the four Scruff items, kept out of Featured', async () => {
  const { BUNDLES, featuredToday } = await import('../src/game/Cosmetics.js');
  const b = BUNDLES.bundle_scruff;
  assert.deepEqual(b.items, ['skin_scruff', 'pick_paw', 'bb_gecko', 'gl_paws']);
  assert.equal(PRICES.bundle_scruff, 25000);
  assert.deepEqual([PRICES.skin_scruff, PRICES.pick_paw, PRICES.bb_gecko, PRICES.gl_paws], [15000, 5500, 3500, 3500]);
  const separately = b.items.reduce((t, id) => t + PRICES[id], 0);
  assert.ok(PRICES.bundle_scruff < separately, 'the bundle is cheaper than buying each item');
  assert.equal(cosmeticDef('bundle_scruff').kind, 'bundle');
  for (let d = 0; d < 60; d++) assert.ok(!featuredToday(4, new Date(Date.UTC(2026, 10, 1 + d))).includes('bundle_scruff'));
});

test('bundle price drops for the pieces you already own, never above buying the rest', async () => {
  const { bundlePrice, priceFor } = await import('../src/game/Cosmetics.js');
  assert.equal(bundlePrice('bundle_scruff', []), 25000);
  assert.equal(priceFor('bundle_scruff', []), 25000);
  // own the outfit (15,000 of 27,500): pay for the other 12,500 worth, at the bundle discount
  const rest = bundlePrice('bundle_scruff', ['skin_scruff']);
  assert.ok(rest < 12500 && rest > 0, String(rest));
  assert.equal(rest % 100, 0);
  // one piece left: never more than buying that piece alone
  assert.ok(bundlePrice('bundle_scruff', ['skin_scruff', 'pick_paw', 'bb_gecko']) <= PRICES.gl_paws);
  assert.equal(bundlePrice('bundle_scruff', ['skin_scruff', 'pick_paw', 'bb_gecko', 'gl_paws']), 0);
  assert.equal(priceFor('pick_paw', ['skin_scruff']), PRICES.pick_paw, 'single items keep their price');
});
