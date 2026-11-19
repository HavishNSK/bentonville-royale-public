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

test('Scruff Set bundle: 10,000 coins for the four Scruff items, kept out of Featured', async () => {
  const { BUNDLES, featuredToday } = await import('../src/game/Cosmetics.js');
  const b = BUNDLES.bundle_scruff;
  assert.deepEqual(b.items, ['skin_scruff', 'pick_paw', 'bb_gecko', 'gl_paws']);
  assert.equal(PRICES.bundle_scruff, 10000);
  assert.deepEqual([PRICES.skin_scruff, PRICES.pick_paw, PRICES.bb_gecko, PRICES.gl_paws], [5000, 2000, 1000, 1000]);
  assert.equal(cosmeticDef('bundle_scruff').kind, 'bundle');
  for (let d = 0; d < 60; d++) assert.ok(!featuredToday(4, new Date(Date.UTC(2026, 10, 1 + d))).includes('bundle_scruff'));
});
