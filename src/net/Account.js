// BENTONVILLE ROYALE — the player's account on the client (server: party/accounts.js).
//
//   const acct = createAccount();
//   await acct.init();                      // resumes a saved session, else a local guest profile
//   acct.signedIn, acct.profile = { name, coins, owned, equipped:{skin, emotes}, friends, incoming, outgoing, stats }
//   await acct.register(name, pw) / acct.login(name, pw) / acct.loginWithGoogle(idToken) / acct.logout()
//   await acct.buy(id) / acct.equip({ skin, emotes })
//   await acct.reward({ kills, placement, players, won })   -> coins earned
//   await acct.friendAdd(name) / friendAccept / friendDecline / friendRemove / invite(name, partyCode)
//   acct.setStatus('lobby'|'match', partyCode)
//   acct.on('change', fn(profile)) / on('friends', fn({list, incoming, outgoing})) / on('invite', fn({from, code}))
//   acct.on('request', fn(from)) / on('online', fn(bool))
//
// Without the account server (or signed out) everything still works on a guest profile
// kept in localStorage: coins, shop, locker. Friends need a signed-in account.

import { partyHost, isLocal } from './Net.js';
import { DEFAULT_OWNED, DEFAULT_EQUIPPED, PRICES, EMOTE_SLOTS, SKINS, EMOTES } from '../game/Cosmetics.js';

const TOKEN_KEY = 'bentonville-royale.account';
const GUEST_KEY = 'bentonville-royale.guest';
const GUEST_COINS = 1500;

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
    throw e;
  }
  return data;
}

function guestProfile() {
  let p = null;
  try {
    p = JSON.parse(load(GUEST_KEY) || 'null');
  } catch {
    p = null;
  }
  if (!p || typeof p !== 'object') p = {};
  const owned = Array.isArray(p.owned) ? p.owned.filter((id) => SKINS[id] || EMOTES[id]) : [];
  for (const id of DEFAULT_OWNED) if (!owned.includes(id)) owned.push(id);
  const eq = p.equipped || {};
  return {
    name: 'Guest',
    guest: true,
    coins: Number.isFinite(p.coins) ? Math.max(0, p.coins | 0) : GUEST_COINS,
    owned,
    equipped: {
      skin: owned.includes(eq.skin) && SKINS[eq.skin] ? eq.skin : DEFAULT_EQUIPPED.skin,
      emotes: Array.from({ length: EMOTE_SLOTS }, (_, i) => {
        const e = Array.isArray(eq.emotes) ? eq.emotes[i] : DEFAULT_EQUIPPED.emotes[i];
        return e && owned.includes(e) && EMOTES[e] ? e : null;
      }),
    },
    friends: [],
    incoming: [],
    outgoing: [],
    stats: p.stats || { matches: 0, wins: 0, kills: 0 },
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

    async logout() {
      const t = token;
      setToken(null);
      disconnect();
      friendsData = { list: [], incoming: [], outgoing: [] };
      emit('friends', friendsData);
      setProfile(guestProfile());
      if (t) api('logout', { token: t }).catch(() => {});
    },

    async buy(id) {
      if (!acct.signedIn) {
        const p = acct.profile;
        const price = PRICES[id];
        if (price == null) throw new Error('That item is not in the shop.');
        if (p.owned.includes(id)) throw new Error('You already own that.');
        if (p.coins < price) throw new Error('Not enough coins.');
        p.coins -= price;
        p.owned.push(id);
        saveGuest();
        emit('change', p);
        return p;
      }
      const r = await api('buy', { token, item: id });
      setProfile(r.profile);
      return r.profile;
    },

    async equip({ skin, emotes } = {}) {
      const p = acct.profile;
      // optimistic: the locker updates at once, the server confirms
      if (skin && p.owned.includes(skin)) p.equipped.skin = skin;
      if (emotes) p.equipped.emotes = emotes.slice(0, EMOTE_SLOTS);
      emit('change', p);
      if (!acct.signedIn) {
        saveGuest();
        return p;
      }
      const r = await api('equip', { token, skin, emotes });
      setProfile(r.profile);
      if (skin) acct.setStatus(status.s, status.party);
      return r.profile;
    },

    /** Match payout. Returns coins earned. */
    async reward({ kills = 0, placement = 1, players = 1, won = false } = {}) {
      if (!acct.signedIn) {
        // guests earn with the same formula (no server: no cap beyond the formula itself)
        const outlasted = Math.round(((players - placement) / Math.max(1, players - 1)) * 250);
        const earned = Math.min(1500, Math.max(0, outlasted) + Math.min(40, kills) * 75 + (won ? 400 : 0));
        const p = acct.profile;
        p.coins += earned;
        p.stats.matches++;
        p.stats.kills += kills;
        if (won) p.stats.wins++;
        saveGuest();
        emit('change', p);
        return earned;
      }
      try {
        const r = await api('reward', { token, kills, placement, players, won });
        setProfile(r.profile);
        return r.earned || 0;
      } catch {
        return 0;
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
    acct.profile = { ...p, guest: false };
    emit('change', acct.profile);
  }

  function saveGuest() {
    const p = acct.profile;
    store(GUEST_KEY, { coins: p.coins, owned: p.owned, equipped: p.equipped, stats: p.stats });
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
