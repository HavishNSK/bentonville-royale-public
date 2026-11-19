// Retired shop items: gone from every catalog and the shop, refunded once to their owners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RETIRED, SKINS, PICKAXES, BACKBLINGS, EMOTES, PRICES, cosmeticDef, featuredToday, refundRetired } from '../src/game/Cosmetics.js';

const GONE = ['skin_rogue_dusk', 'skin_barbarian_frost', 'pick_gilded', 'pick_frost', 'bb_cape_knight', 'bb_cape_mage', 'emote_magic', 'emote_bow', 'emote_dodge'];

test('the removed items are out of the catalog and the shop', () => {
  for (const id of GONE) {
    assert.ok(RETIRED[id] > 0, `${id} keeps its refund price`);
    assert.equal(cosmeticDef(id), null, `${id} is not in any table`);
    assert.ok(!(id in SKINS) && !(id in PICKAXES) && !(id in BACKBLINGS) && !(id in EMOTES) && !(id in PRICES), id);
  }
  // the daily rotation never features one, over a year of dates
  for (let d = 0; d < 366; d++) for (const id of featuredToday(6, new Date(Date.UTC(2026, 0, 1 + d)))) assert.ok(!GONE.includes(id), id);
});

test('owners are refunded once and lose the items', () => {
  const acc = { coins: 100, owned: ['skin_rogue', 'skin_rogue_dusk', 'pick_gilded', 'bb_cape_mage', 'skin_knight_midnight'], equipped: { skin: 'skin_rogue_dusk' } };
  const coins = refundRetired(acc);
  assert.equal(coins, 1200 + 800 + 400);
  assert.equal(acc.coins, 100 + 2400);
  assert.deepEqual(acc.owned, ['skin_rogue', 'skin_knight_midnight']);
  // a second load refunds nothing more
  assert.equal(refundRetired(acc), 0);
  assert.equal(acc.coins, 2500);
});

test('accounts without retired items are untouched', () => {
  const acc = { coins: 50, owned: ['skin_rogue', 'skin_knight_midnight'] };
  assert.equal(refundRetired(acc), 0);
  assert.equal(acc.coins, 50);
  assert.equal(acc.owned.length, 2);
  assert.equal(refundRetired(null), 0);
});
