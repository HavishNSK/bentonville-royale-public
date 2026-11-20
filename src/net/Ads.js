// BENTONVILLE ROYALE — ads, one small layer over two providers:
//   'crazygames'  the CrazyGames SDK (build with VITE_PLATFORM=crazygames, see npm run build:crazygames)
//   'adsense'     Google AdSense H5 Games Ads / Ad Placement API (VITE_ADSENSE_CLIENT=ca-pub-...)
//   'none'        no ads (dev, and any build without either setting)
//
//   const ads = createAds({ platform, client, test, onPause, onResume })
//   await ads.init()                 loads the provider; never throws (a failed load = no ads)
//   ads.loadingStart() / ads.loadingDone()
//   ads.gameplayStart() / ads.gameplayStop()
//   await ads.interstitial(name)     -> true if an ad showed. Frequency-guarded (see below).
//   await ads.rewarded(name)         -> true only if the ad was watched to the end
//   ads.platform, ads.ready, ads.canReward, ads.sdk (CrazyGames SDK or null)
//
// Policy (AdSense H5 / CrazyGames): ads only at natural breaks the game chooses (between
// matches), never during play, never at startup, never right after another ad. This module
// enforces the timing part: no interstitial in the first FIRST_MS of the session, at most one
// per GAP_MS, none while another ad is up. Rewarded ads are player-initiated and only wait for
// the one before them to finish.
//
// Kids: many players are under 13, so every AdSense request asks for non-personalized ads
// (requestNonPersonalizedAds = 1) and carries the child age-treatment tag. Also tag the site as
// child-directed in Search Console (docs/MONETIZATION.md). CrazyGames handles this in its SDK.

export const FIRST_MS = 60 * 1000; // no interstitial in the first minute of a session
export const GAP_MS = 3 * 60 * 1000; // at most one interstitial per 3 minutes
export const START_TIMEOUT_MS = 6000; // no ad started by then: carry on without one
// Once an ad has started the game waits for the provider's done callback (AdSense always calls
// adBreakDone; CrazyGames adFinished / adError): the player closes the ad themselves.
const CRAZY_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const ADSENSE_JS = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

/** Which provider a build uses (env = import.meta.env). */
export function pickPlatform(env = {}) {
  if (env.VITE_PLATFORM === 'crazygames') return 'crazygames';
  if (/^ca-pub-\d+$/.test(String(env.VITE_ADSENSE_CLIENT || ''))) return 'adsense';
  return 'none';
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    for (const k in attrs) s.setAttribute(k, attrs[k]);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

/** CrazyGames SDK v3. */
async function crazyProvider() {
  await loadScript(CRAZY_SDK);
  const SDK = window.CrazyGames && window.CrazyGames.SDK;
  if (!SDK) throw new Error('CrazyGames SDK missing');
  await SDK.init();
  const call = (fn) => {
    try {
      fn();
    } catch {
      /* the SDK refuses calls outside CrazyGames (environment 'disabled') */
    }
  };
  return {
    sdk: SDK,
    canReward: true,
    loadingStart: () => call(() => SDK.game.loadingStart()),
    loadingStop: () => call(() => SDK.game.loadingStop()),
    gameplayStart: () => call(() => SDK.game.gameplayStart()),
    gameplayStop: () => call(() => SDK.game.gameplayStop()),
    happytime: () => call(() => SDK.game.happytime()),
    show(kind, name, hooks) {
      return new Promise((resolve) => {
        let started = false;
        try {
          SDK.ad.requestAd(kind === 'reward' ? 'rewarded' : 'midgame', {
            adStarted: () => {
              started = true;
              hooks.pause();
            },
            adFinished: () => {
              if (started) hooks.resume();
              resolve(true);
            },
            adError: () => {
              if (started) hooks.resume();
              resolve(false);
            },
          });
        } catch {
          resolve(false);
        }
      });
    },
  };
}

/** AdSense H5 Games Ads (Ad Placement API). */
async function adsenseProvider({ client, test }) {
  const w = window;
  w.adsbygoogle = w.adsbygoogle || [];
  w.adsbygoogle.requestNonPersonalizedAds = 1; // kid-safe: no interest-based ads (read when the tag loads)
  const push = (o) => w.adsbygoogle.push(o);
  const attrs = { crossorigin: 'anonymous', 'data-ad-client': client, 'data-tag-for-age-treatment': '1' };
  if (test) attrs['data-adbreak-test'] = 'on';
  // the website build already has the tag in <head> (vite.config.js adsenseTag): reuse it
  const inHead = !test && document.querySelector(`script[src^="${ADSENSE_JS}"]`);
  if (!inHead) await loadScript(`${ADSENSE_JS}?client=${encodeURIComponent(client)}`, attrs);
  w.adsbygoogle.requestNonPersonalizedAds = 1; // and again on the loaded object
  push({ preloadAdBreaks: 'on', sound: 'on' }); // adConfig
  return {
    sdk: null,
    canReward: true,
    show(kind, name, hooks) {
      return new Promise((resolve) => {
        let viewed = false;
        let showed = false;
        const base = {
          name,
          beforeAd: () => {
            showed = true;
            hooks.pause();
          },
          afterAd: () => hooks.resume(),
          adBreakDone: () => resolve(kind === 'reward' ? viewed : showed),
        };
        try {
          if (kind === 'reward') {
            push({
              ...base,
              type: 'reward',
              beforeReward: (showAdFn) => showAdFn(), // the player already asked for it
              adDismissed: () => {},
              adViewed: () => {
                viewed = true;
              },
            });
          } else push({ ...base, type: 'next' });
        } catch {
          resolve(false);
        }
      });
    },
  };
}

/**
 * @param {{ platform?: string, client?: string, test?: boolean, now?: () => number,
 *           onPause?: () => void, onResume?: () => void, provider?: object }} opts
 *        provider: a ready-made provider (tests); otherwise loaded by init() for `platform`.
 */
export function createAds({ platform = 'none', client = '', test = false, now = () => Date.now(), onPause = () => {}, onResume = () => {}, provider = null, timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) } } = {}) {
  let p = provider;
  let busy = false;
  let lastAd = -Infinity;
  const born = now();

  /** One ad; resolves false if none starts within START_TIMEOUT_MS. */
  async function show(kind, name) {
    if (!p || busy) return false;
    busy = true;
    let started = false;
    let paused = false;
    const hooks = {
      pause: () => {
        started = true;
        if (!paused) {
          paused = true;
          onPause();
        }
      },
      resume: () => {
        if (paused) {
          paused = false;
          onResume();
        }
      },
    };
    let t1 = null;
    try {
      const timeout = new Promise((resolve) => {
        t1 = timers.set(() => {
          if (!started) resolve(false);
        }, START_TIMEOUT_MS);
      });
      const ok = await Promise.race([Promise.resolve(p.show(kind, name, hooks)), timeout]);
      return !!ok;
    } catch {
      return false;
    } finally {
      timers.clear(t1);
      hooks.resume(); // never leave the game muted / frozen
      busy = false;
      lastAd = now();
    }
  }

  const api = {
    platform,
    get ready() {
      return !!p;
    },
    get canReward() {
      return !!(p && p.canReward);
    },
    get sdk() {
      return p ? p.sdk || null : null;
    },
    async init() {
      if (p || platform === 'none' || typeof document === 'undefined') return api;
      try {
        p = platform === 'crazygames' ? await crazyProvider() : platform === 'adsense' ? await adsenseProvider({ client, test }) : null;
      } catch (err) {
        console.warn('[ads] disabled:', err && err.message ? err.message : err);
        p = null;
      }
      return api;
    },
    loadingStart: () => p && p.loadingStart && p.loadingStart(),
    loadingDone: () => p && p.loadingStop && p.loadingStop(),
    gameplayStart: () => p && p.gameplayStart && p.gameplayStart(),
    gameplayStop: () => p && p.gameplayStop && p.gameplayStop(),
    happytime: () => p && p.happytime && p.happytime(),
    /** True when an interstitial may show now (frequency rules). */
    interstitialAllowed() {
      const t = now();
      return !!p && !busy && t - born >= FIRST_MS && t - lastAd >= GAP_MS;
    },
    async interstitial(name = 'break') {
      if (!api.interstitialAllowed()) return false;
      return show('next', name);
    },
    async rewarded(name = 'reward') {
      if (!p || !p.canReward) return false;
      return show('reward', name);
    },
  };
  return api;
}
