import test from 'node:test';
import assert from 'node:assert/strict';
import { createAds, pickPlatform, FIRST_MS, GAP_MS } from '../src/net/Ads.js';

function fakeProvider(result = true) {
  const shown = [];
  return {
    shown,
    canReward: true,
    async show(kind, name, hooks) {
      hooks.pause();
      shown.push([kind, name]);
      hooks.resume();
      return result;
    },
  };
}

test('platform comes from the build settings', () => {
  assert.equal(pickPlatform({}), 'none');
  assert.equal(pickPlatform({ VITE_PLATFORM: 'crazygames' }), 'crazygames');
  assert.equal(pickPlatform({ VITE_ADSENSE_CLIENT: 'ca-pub-1234567890' }), 'adsense');
  assert.equal(pickPlatform({ VITE_ADSENSE_CLIENT: 'not-an-id' }), 'none');
  assert.equal(pickPlatform({ VITE_PLATFORM: 'crazygames', VITE_ADSENSE_CLIENT: 'ca-pub-1' }), 'crazygames');
});

test('no interstitial in the first minute, then at most one per gap', async () => {
  let t = 0;
  const prov = fakeProvider();
  const paused = [];
  const ads = createAds({ provider: prov, now: () => t, onPause: () => paused.push('p'), onResume: () => paused.push('r') });
  assert.equal(await ads.interstitial('match-end'), false, 'too early');
  t = FIRST_MS;
  assert.equal(await ads.interstitial('match-end'), true);
  assert.deepEqual(paused, ['p', 'r'], 'game paused and resumed around the ad');
  t += GAP_MS - 1;
  assert.equal(await ads.interstitial('match-end'), false, 'within the gap');
  t += 1;
  assert.equal(await ads.interstitial('match-end'), true);
  assert.equal(prov.shown.length, 2);
});

test('rewarded ads: player-initiated, true only when watched; they also reset the gap', async () => {
  let t = FIRST_MS;
  const ads = createAds({ provider: fakeProvider(true), now: () => t });
  assert.equal(ads.canReward, true);
  assert.equal(await ads.rewarded('coins'), true);
  assert.equal(await ads.interstitial('match-end'), false, 'no interstitial right after a rewarded ad');
  const skipped = createAds({ provider: fakeProvider(false), now: () => t });
  assert.equal(await skipped.rewarded('coins'), false);
});

test('no provider = no ads, never throws', async () => {
  const ads = createAds({ platform: 'none' });
  await ads.init();
  assert.equal(ads.ready, false);
  assert.equal(ads.canReward, false);
  assert.equal(await ads.interstitial('x'), false);
  assert.equal(await ads.rewarded('x'), false);
  ads.gameplayStart();
  ads.gameplayStop();
});

test('a provider that throws counts as no ad', async () => {
  const ads = createAds({ provider: { canReward: true, show: async () => { throw new Error('boom'); } }, now: () => FIRST_MS });
  assert.equal(await ads.interstitial('x'), false);
  assert.equal(await ads.rewarded('x'), false);
});

test('an ad network that never answers does not hang the game', async () => {
  const fired = [];
  const timers = { set: (fn, ms) => (fired.push([fn, ms]), fired.length), clear: () => {} };
  let resumed = 0;
  let t = 0;
  const ads = createAds({ provider: { canReward: true, show: () => new Promise(() => {}) }, now: () => t, timers, onResume: () => resumed++ });
  t = FIRST_MS;
  const p = ads.interstitial('x');
  await Promise.resolve();
  fired.find(([, ms]) => ms === 6000)[0](); // the start timeout fires
  assert.equal(await p, false);
  assert.equal(resumed, 0, 'never paused, so nothing to resume');
});

test('an ad that started is waited for, and the game always resumes', async () => {
  let t = 0;
  let paused = 0;
  let resumed = 0;
  const prov = { canReward: true, show: async (kind, name, hooks) => { hooks.pause(); return true; } }; // forgets to resume
  const ads = createAds({ provider: prov, now: () => t, onPause: () => paused++, onResume: () => resumed++ });
  t = FIRST_MS;
  assert.equal(await ads.interstitial('x'), true);
  assert.equal(paused, 1);
  assert.equal(resumed, 1, 'resumed even though the provider forgot');
});
