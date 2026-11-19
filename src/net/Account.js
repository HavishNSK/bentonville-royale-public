// BENTONVILLE ROYALE — the player's account on the client (server: party/accounts.js).
//
//   const acct = createAccount();
//   await acct.init();                      // resumes a saved session, else a local guest profile
//   acct.signedIn, acct.profile = { name, coins, owned, equipped:{skin, emotes}, friends, incoming, outgoing, stats }
//   await acct.register(name, pw) / acct.login(name, pw) / acct.loginWithGoogle(idToken)
//   await acct.logout() / acct.logoutAll()   (logoutAll: every device)
//   await acct.rename(name)                 only while profile.mustRename (name breaks the username rules)
//   profile.banned {reason, until, permanent, label} | null, profile.warning {reason, at} | null (moderation)
//   await acct.ackWarning()                 the player saw the moderator warning; clears it
//   await acct.report(name, reason, note) -> confirmation text   private player report for the devs
//   await acct.mod(op, body) -> lines[]     DEV panel actions (modBan, modTitle, ...); the server checks dev rights
//   await acct.buy(id) / acct.equip({ skin, pickaxe, backbling, emotes })
//   await acct.reward({ kills, placement, players, won, ranked }) -> { earned, saved, ranked, guest?, error? }
//   await acct.boxResult({ won, size, oppElo, score:[us, them], forfeit })
//     -> { ok:true, elo, delta, tier:{id,name}, games } | { guest:true } | { ok:false, rateLimited:true } | { ok:false, error }
//   profile.box = { elo, games, wins, peak, tier:{id,name} }   Box Fights Elo (client-reported results, not verified)
//   await acct.friendAdd(name) / friendAccept / friendDecline / friendRemove / invite(name, partyCode)
//   await acct.leaderboard() -> { online, wins:[{name,wins,kills}], kills:[...] }
//   acct.setStatus('lobby'|'match', partyCode)
//   await acct.feedbackList() / feedback(kind, text) / feedbackVote(id)
//   await acct.feedbackReply(id, text) / feedbackDelete(id, replyId?)   suggestions + bugs board
//   acct.on('change', fn(profile)) / on('friends', fn({list, incoming, outgoing})) / on('invite', fn({from, code}))
//   acct.on('request', fn(from)) / on('online', fn(bool))
//
// Guests can play and equip free defaults only. Coins, match rewards, and shop purchases
// require a signed-in account. Guest localStorage no longer stores a coin balance.

import { partyHost, isLocal } from './Net.js';
import { DEFAULT_OWNED, DEFAULT_EQUIPPED, EMOTE_SLOTS, SKINS, EMOTES, PICKAXES, BACKBLINGS, GLIDERS } from '../game/Cosmetics.js';
import { ELO_START, clampElo, tierOf } from '../game/BoxElo.js';

const TOKEN_KEY = 'bentonville-royale.account';
const GUEST_KEY = 'bentonville-royale.guest';
const ANON_KEY = 'bentonville-royale.anon'; // stable id for guests' board posts / votes

function anonId() {
  let a = load(ANON_KEY);
  if (!a || a.length < 8) {
    a = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    store(ANON_KEY, a);
  }
  return a;
}

function store(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch {
    /* private mode: nothing persists, the session still works */
  }
}
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function baseUrl() {
  const host = partyHost();
  return `${isLocal(host) ? 'http' : 'https'}://${host}/parties/accounts/global`;
}

function wsUrl(token) {
  const host = partyHost();
  return `${isLocal(host) ? 'ws' : 'wss'}://${host}/parties/accounts/global?token=${encodeURIComponent(token)}`;
}

async function api(op, body = {}) {
  let res;
  try {
    res = await fetch(baseUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...body }) });
  } catch {
    const e = new Error('Could not reach the account server.');
    e.offline = true;
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* fall through */
  }
  if (!res.ok || !data || data.error) {
    const e = new Error((data && data.error) || 'Account server error.');
    e.status = res.status;
    e.rateLimited = !!(data && data.rateLimited);
    throw e;
  }
  return data;
}

/** Box Fights ladder numbers from the server (or defaults), clamped; the tier follows the Elo. */
export function boxProfile(b) {
  const src = b && typeof b === 'object' ? b : {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const elo = Number.isFinite(src.elo) ? clampElo(src.elo) : ELO_START;
  const peak = Number.isFinite(src.peak) ? clampElo(src.peak) : elo;
  return { elo, games: n(src.games), wins: n(src.wins), peak: Math.max(peak, elo), tier: tierOf(elo) };
}

function guestProfile() {
  let p = null;
  try {
    p = JSON.parse(load(GUEST_KEY) || 'null');
  } catch {
    p = null;
  }
  if (!p || typeof p !== 'object') p = {};
  // Guests only keep free defaults (no leftover shop unlocks or coin balance).
  const owned = DEFAULT_OWNED.slice();
  const eq = p.equipped || {};
  return {
    name: 'Guest',
    guest: true,
    coins: 0,
    owned,
    equipped: {
      skin: owned.includes(eq.skin) && SKINS[eq.skin] ? eq.skin : DEFAULT_EQUIPPED.skin,
      pickaxe: owned.includes(eq.pickaxe) && PICKAXES[eq.pickaxe] ? eq.pickaxe : DEFAULT_EQUIPPED.pickaxe,
      backbling: owned.includes(eq.backbling) && BACKBLINGS[eq.backbling] ? eq.backbling : DEFAULT_EQUIPPED.backbling,
      glider: owned.includes(eq.glider) && GLIDERS[eq.glider] ? eq.glider : DEFAULT_EQUIPPED.glider,
      emotes: Array.from({ length: EMOTE_SLOTS }, (_, i) => {
        const e = Array.isArray(eq.emotes) ? eq.emotes[i] : DEFAULT_EQUIPPED.emotes[i];
        return e && owned.includes(e) && EMOTES[e] ? e : null;
      }),
    },
    friends: [],
    incoming: [],
    outgoing: [],
    stats: { matches: 0, wins: 0, kills: 0 },
    box: boxProfile(null),
  };
}

export function createAccount() {
  const handlers = {};
  const emit = (ev, v) => (handlers[ev] || []).forEach((fn) => fn(v));
  let token = load(TOKEN_KEY) || null;
  let ws = null;
  let wsTimer = 0;
  let status = { s: 'lobby', party: null };
  let friendsData = { list: [], incoming: [], outgoing: [] };

  const acct = {
    profile: guestProfile(),
    get signedIn() {
      return !!token && !acct.profile.guest;
    },
    /** Account session, for the presence server to verify dev chat. Empty when signed out. */
    get sessionToken() {
      return token || '';
    },
    get friends() {
      return friendsData;
    },
    on(ev, fn) {
      (handlers[ev] = handlers[ev] || []).push(fn);
    },

    async init() {
      if (!token) return acct.profile;
      try {
        const { profile } = await api('me', { token });
        setProfile(profile);
        connect();
      } catch (e) {
        if (e.status === 401) setToken(null); // expired: back to guest
        // offline: stay a guest for now, keep the token for next time
      }
      return acct.profile;
    },

    async register(name, password) {
      const r = await api('register', { name, password });
      setToken(r.token);
      setProfile(r.profile);
      connect();
      return r.profile;
    },

    async login(name, password) {
      const r = await api('login', { name, password });
      setToken(r.token);
      setProfile(r.profile);
      connect();
      return r.profile;
    },

    /** Google Identity Services ID token (credential). Server verifies JWT + JWKS. */
    async loginWithGoogle(idToken) {
      const r = await api('googleLogin', { idToken });
      setToken(r.token);
      setProfile(r.profile);
      connect();
      return r.profile;
    },

    /** Forced rename of a name that breaks the username rules (server refuses otherwise). */
    async rename(name) {
      if (!acct.signedIn) throw new Error('Sign in first.');
      const r = await api('rename', { token, name });
      setProfile(r.profile);
      return r.profile;
    },

    /** The player saw the moderator warning: clear it on the server. */
    async ackWarning() {
      if (!acct.signedIn || !acct.profile.warning) return;
      try {
        const r = await api('ackWarning', { token });
        setProfile(r.profile);
      } catch {
        /* shown again next time */
      }
    },

    /** A DEV panel action. Only dev accounts succeed (checked on the server). Throws with its message. */
    async mod(op, body = {}) {
      if (!acct.signedIn) throw new Error('Sign in first.');
      const r = await api(op, { ...body, token });
      return Array.isArray(r.lines) ? r.lines.map((l) => String(l).slice(0, 300)) : ['Done.'];
    },

    /** Report a player (private: only devs read reports). Throws with the server's message. */
    async report(name, reason, note = '') {
      if (!acct.signedIn) throw new Error('Sign in to send reports.');
      const r = await api('report', { token, name, reason, note });
      return r.text || '';
    },

    async logout() {
      const t = token;
      setToken(null);
      disconnect();
      friendsData = { list: [], incoming: [], outgoing: [] };
      emit('friends', friendsData);
      setProfile(guestProfile());
      if (t) api('logout', { token: t }).catch(() => {});
    },

    /** Sign this account out on every device (then locally). */
    async logoutAll() {
      const t = token;
      if (t) await api('logoutAll', { token: t }).catch(() => {});
      await acct.logout();
    },

    /** Rewarded ad watched to the end: +coins (the server caps it per day). */
    async adReward() {
      if (!acct.signedIn) throw new Error('Sign in to earn coins.');
      const r = await api('adReward', { token });
      setProfile(r.profile);
      return r.earned || 0;
    },

    async buy(id) {
      if (!acct.signedIn) throw new Error('Sign in to earn coins and buy outfits.');
      const r = await api('buy', { token, item: id });
      setProfile(r.profile);
      return r.profile;
    },

    async equip({ skin, emotes, pickaxe, backbling, glider } = {}) {
      const p = acct.profile;
      // optimistic: the locker updates at once, the server confirms
      if (skin && p.owned.includes(skin)) p.equipped.skin = skin;
      if (pickaxe && p.owned.includes(pickaxe)) p.equipped.pickaxe = pickaxe;
      if (backbling && p.owned.includes(backbling)) p.equipped.backbling = backbling;
      if (glider && p.owned.includes(glider)) p.equipped.glider = glider;
      if (emotes) p.equipped.emotes = emotes.slice(0, EMOTE_SLOTS);
      emit('change', p);
      if (!acct.signedIn) {
        saveGuest();
        return p;
      }
      const r = await api('equip', { token, skin, emotes, pickaxe, backbling, glider });
      setProfile(r.profile);
      if (skin) acct.setStatus(status.s, status.party);
      return r.profile;
    },

    /**
     * Match payout + stats. Guests earn nothing — sign in required.
     * Returns { earned, saved, guest?, error? }.
     */
    async reward({ kills = 0, placement = 1, players = 1, won = false, ranked = false } = {}) {
      if (!acct.signedIn) return { earned: 0, saved: false, guest: true };
      try {
        const r = await api('reward', { token, kills, placement, players, won, ranked: !!ranked });
        setProfile(r.profile);
        return { earned: r.earned || 0, saved: true, rateLimited: !!r.rateLimited, ranked: r.ranked === true };
      } catch (err) {
        return { earned: 0, saved: false, error: err && err.message ? err.message : 'Could not save match stats.' };
      }
    },

    /**
     * Box Fights result for the Elo ladder. The server computes the change from its stored rating;
     * the result itself is reported by this browser and is not verified. Guests are never sent.
     */
    async boxResult({ won = false, size = 1, oppElo = ELO_START, score = [0, 0], forfeit = false } = {}) {
      if (!acct.signedIn) return { guest: true };
      const sc = Array.isArray(score) ? [score[0] | 0, score[1] | 0] : [0, 0];
      try {
        // only the keys the server accepts (any other key is refused)
        const r = await api('boxResult', { token, won: !!won, size: size | 0, oppElo: clampElo(oppElo), score: sc, forfeit: !!forfeit });
        if (!r || r.ok !== true || !Number.isFinite(r.elo)) return { ok: false, rateLimited: !!(r && r.rateLimited), error: 'Box Fights Elo is unavailable right now.' };
        const elo = clampElo(r.elo);
        const delta = Number.isFinite(r.delta) ? Math.round(r.delta) : 0;
        const prev = boxProfile(acct.profile.box);
        const games = Number.isFinite(r.games) ? r.games : prev.games + 1;
        acct.profile = { ...acct.profile, box: boxProfile({ elo, games, wins: prev.wins + (won ? 1 : 0), peak: Math.max(prev.peak, elo) }) };
        emit('change', acct.profile);
        return { ok: true, elo, delta, tier: tierOf(elo), games };
      } catch (err) {
        if (err && (err.rateLimited || err.status === 429)) return { ok: false, rateLimited: true };
        return { ok: false, error: err && err.message ? err.message : 'Box Fights Elo is unavailable right now.', status: err && err.status };
      }
    },

    async friendAdd(name) {
      return friendOp('friendAdd', name);
    },
    async friendAccept(name) {
      return friendOp('friendAccept', name);
    },
    async friendDecline(name) {
      return friendOp('friendDecline', name);
    },
    async friendRemove(name) {
      return friendOp('friendRemove', name);
    },
    async invite(name, code) {
      if (!acct.signedIn) throw new Error('Sign in to invite friends.');
      await api('invite', { token, name, code });
    },

    /** Public wins/kills boards + displayed online count (server pads the number). */
    async leaderboard() {
      return api('leaderboard', {});
    },

    /** Suggestions / bug board (works signed in or as a guest). */
    async feedbackList() {
      return (await api('feedbackList')).items || [];
    },
    async feedback(kind, text) {
      return (await api('feedback', { kind, text, token: token || undefined, anon: anonId() })).item;
    },
    async feedbackVote(id) {
      return (await api('feedbackVote', { id, token: token || undefined, anon: anonId() })).item;
    },
    async feedbackReply(id, text) {
      return (await api('feedbackReply', { id, text, token: token || undefined, anon: anonId() })).item;
    },
    async feedbackDelete(id, replyId) {
      const r = await api('feedbackDelete', { id, replyId: replyId || undefined, token });
      return r.item || r;
    },

    setStatus(s, party) {
      status = { s, party: party || null };
      send({ t: 'status', s, party: party || null, skin: acct.profile.equipped.skin });
    },
  };

  async function friendOp(op, name) {
    if (!acct.signedIn) throw new Error('Sign in to add friends.');
    const r = await api(op, { token, name });
    setProfile(r.profile);
    return r.text || '';
  }

  function setToken(t) {
    token = t;
    store(TOKEN_KEY, t);
  }

  function setProfile(p) {
    // an older server may not send the newer loadout slots yet
    const eq = { ...DEFAULT_EQUIPPED, ...(p.equipped || {}) };
    acct.profile = { ...p, owned: [...new Set([...(p.owned || []), ...DEFAULT_OWNED])], equipped: eq, guest: false, box: boxProfile(p.box) };
    emit('change', acct.profile);
  }

  function saveGuest() {
    const p = acct.profile;
    // Coins/shop unlocks are account-only; guests only persist free equip prefs.
    store(GUEST_KEY, { equipped: p.equipped });
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function connect() {
    disconnect();
    if (!token) return;
    const t = token;
    let sock;
    try {
      sock = new WebSocket(wsUrl(t));
    } catch {
      return;
    }
    ws = sock;
    sock.onopen = () => {
      emit('online', true);
      send({ t: 'status', s: status.s, party: status.party, skin: acct.profile.equipped.skin });
    };
    sock.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === 'friends') {
        friendsData = { list: m.list || [], incoming: m.incoming || [], outgoing: m.outgoing || [] };
        emit('friends', friendsData);
      } else if (m.t === 'invite') emit('invite', { from: m.from, code: m.code });
      else if (m.t === 'request') emit('request', m.from);
      else if (m.t === 'profile' && m.profile) setProfile(m.profile);
      else if (m.t === 'error' && m.text === 'signed-out') {
        setToken(null);
        setProfile(guestProfile());
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      emit('online', false);
      if (token === t) wsTimer = setTimeout(connect, 4000); // keep presence alive
    };
  }

  function disconnect() {
    clearTimeout(wsTimer);
    const s = ws;
    ws = null;
    if (s) {
      s.onclose = null;
      try {
        s.close();
      } catch {
        /* closed */
      }
    }
  }

  return acct;
}
