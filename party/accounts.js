// BENTONVILLE ROYALE — account server (PartyServer on Cloudflare Workers, bound as `Accounts`
// in wrangler.jsonc). One Durable Object room ("global") holds every account.
//
// Accounts live in the room's durable storage:
//   user:<lowercase name>  -> { name, salt, hash, coins, owned:[ids], equipped:{skin, emotes:[6]},
//                               friends:[lower], incoming:[lower], outgoing:[lower],
//                               stats:{matches, wins, kills}, created, lastReward }
//   sess:<token>           -> { u: lower, exp }
// Passwords are PBKDF2-SHA256 hashed (100k rounds, random 16-byte salt).
//
// HTTP:  POST /parties/accounts/global  {op, ...}  -> JSON
//   register {name, password} / login {name, password}   -> {token, profile}
//   me {token}  logout {token}
//   buy {token, item}   equip {token, skin?, emotes?}
//   reward {token, kills, placement, players, won}       -> {profile, earned}
//   friendAdd {token, name}  friendAccept {token, name}  friendDecline {token, name}  friendRemove {token, name}
//   invite {token, name, code}                            (delivered over the socket)
// Suggestion / bug board (no account needed; signed-in posts carry the account name):
//   feedback {kind: 'idea'|'bug', text, token?, anon?}   -> {item}   (one post per IP per 30 s)
//   feedbackList {}                                       -> {items: newest first, max 60}
//   feedbackVote {id, token?, anon}                       -> {item}   (one vote per voter)
// WebSocket: /parties/accounts/global?token=   presence + live friend updates
//   client -> server  {t:'status', s:'lobby'|'match', party?:CODE, skin?}
//   server -> client  {t:'friends', list:[{name, online, status, skin}], incoming:[names], outgoing:[names]}
//                     {t:'invite', from, code}  {t:'request', from}  {t:'profile', profile}
// The shop catalog's prices are mirrored here (PRICES) so a client cannot buy for free.

import { Server } from 'partyserver';
import { PRICES, DEFAULT_OWNED, DEFAULT_EQUIPPED, EMOTE_SLOTS } from '../src/game/Cosmetics.js';

const START_COINS = 1500;
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 100000;
const MAX_FRIENDS = 100;
const REWARD_GAP_MS = 60 * 1000; // at most one match reward per minute per account

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, key, 256);
  return hex(bits);
}

/** Constant-time string compare. */
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 3-16 letters, digits, _ or - */
export function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_-]{3,16}$/.test(name);
}

function err(text, status = 400) {
  return json({ error: text }, status);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
    },
  });
}

/** What the owner sees about their own account. */
function profileOf(acc) {
  return {
    name: acc.name,
    coins: acc.coins,
    owned: acc.owned,
    equipped: acc.equipped,
    friends: acc.friends.slice(),
    incoming: acc.incoming.slice(),
    outgoing: acc.outgoing.slice(),
    stats: acc.stats,
  };
}

export class Accounts extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.online = new Map(); // lower name -> Set(connection id)
    this.status = new Map(); // lower name -> { s, party, skin }
  }

  // ---------------------------------------------------------------- storage

  async _acc(lower) {
    return lower ? (await this.ctx.storage.get('user:' + lower)) || null : null;
  }

  async _save(acc) {
    await this.ctx.storage.put('user:' + acc.name.toLowerCase(), acc);
  }

  async _session(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
    const s = await this.ctx.storage.get('sess:' + token);
    if (!s || s.exp < Date.now()) return null;
    return this._acc(s.u);
  }

  async _newSession(acc) {
    const token = randHex(24);
    await this.ctx.storage.put('sess:' + token, { u: acc.name.toLowerCase(), exp: Date.now() + SESSION_DAYS * 864e5 });
    return token;
  }

  // ---------------------------------------------------------------- HTTP API

  async onRequest(req) {
    if (req.method === 'OPTIONS') return json({});
    if (req.method !== 'POST') return json({ ok: true, online: this.online.size });
    let m;
    try {
      m = await req.json();
    } catch {
      return err('Bad request.');
    }
    try {
      if (m && typeof m.op === 'string' && m.op.startsWith('feedback')) return await this._feedback(m, req);
      return await this._op(m || {});
    } catch (e) {
      console.error(e);
      return err('Server error.', 500);
    }
  }

  // ---------------------------------------------------------------- suggestions / bugs board

  async _feedback(m, req) {
    const voterOf = async () => {
      const acc = m.token ? await this._session(m.token) : null;
      if (acc) return { id: 'u:' + acc.name.toLowerCase(), name: acc.name };
      const anon = String(m.anon || '').replace(/[^a-z0-9]/gi, '').slice(0, 32);
      return anon.length >= 8 ? { id: 'a:' + anon, name: null } : null;
    };
    if (m.op === 'feedbackList') {
      const rows = await this.ctx.storage.list({ prefix: 'fb:', reverse: true, limit: 60 });
      const items = [...rows.values()].map(({ voters, ip, ...pub }) => pub); // voters / IPs stay private
      return json({ items });
    }
    if (m.op === 'feedback') {
      const text = String(m.text || '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').trim().slice(0, 500);
      if (text.length < 4) return err('Write a few words first.');
      const kind = m.kind === 'bug' ? 'bug' : 'idea';
      const ip = (req.headers.get('cf-connecting-ip') || 'local').slice(0, 64);
      const last = (await this.ctx.storage.get('fbip:' + ip)) || 0;
      if (Date.now() - last < 30000) return err('Thanks! Give it 30 seconds before posting again.', 429);
      await this.ctx.storage.put('fbip:' + ip, Date.now());
      const who = await voterOf();
      const at = Date.now();
      const id = String(at).padStart(14, '0') + Math.random().toString(36).slice(2, 6);
      const item = { id, kind, text, by: who && who.name ? who.name : 'Guest', at, votes: 1, voters: who ? [who.id] : [] };
      await this.ctx.storage.put('fb:' + id, item);
      const { voters, ...pub } = item;
      return json({ item: pub });
    }
    if (m.op === 'feedbackVote') {
      const id = String(m.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
      const item = await this.ctx.storage.get('fb:' + id);
      if (!item) return err('That post is gone.', 404);
      const who = await voterOf();
      if (!who) return err('Could not count that vote.');
      if (!item.voters.includes(who.id)) {
        if (item.voters.length < 5000) item.voters.push(who.id);
        item.votes = item.voters.length;
        await this.ctx.storage.put('fb:' + id, item);
      }
      const { voters, ...pub } = item;
      return json({ item: pub });
    }
    return err('Unknown request.');
  }

  async _op(m) {
    switch (m.op) {
      case 'register': {
        const name = String(m.name || '').trim();
        const password = String(m.password || '');
        if (!validName(name)) return err('Usernames are 3-16 letters, numbers, _ or -.');
        if (password.length < 6 || password.length > 72) return err('Passwords need 6-72 characters.');
        const lower = name.toLowerCase();
        if (await this._acc(lower)) return err('That username is taken.', 409);
        const salt = randHex(16);
        const acc = {
          name,
          salt,
          hash: await hashPassword(password, salt),
          coins: START_COINS,
          owned: DEFAULT_OWNED.slice(),
          equipped: { skin: DEFAULT_EQUIPPED.skin, emotes: DEFAULT_EQUIPPED.emotes.slice() },
          friends: [],
          incoming: [],
          outgoing: [],
          stats: { matches: 0, wins: 0, kills: 0 },
          created: Date.now(),
          lastReward: 0,
        };
        await this._save(acc);
        return json({ token: await this._newSession(acc), profile: profileOf(acc) });
      }
      case 'login': {
        const acc = await this._acc(String(m.name || '').trim().toLowerCase());
        const ok = acc && same(await hashPassword(String(m.password || ''), acc.salt), acc.hash);
        if (!ok) return err('Wrong username or password.', 401);
        return json({ token: await this._newSession(acc), profile: profileOf(acc) });
      }
    }

    // everything else needs a session
    const acc = await this._session(m.token);
    if (!acc) return err('Signed out. Please sign in again.', 401);
    const lower = acc.name.toLowerCase();

    switch (m.op) {
      case 'me':
        return json({ profile: profileOf(acc) });
      case 'logout':
        await this.ctx.storage.delete('sess:' + m.token);
        return json({ ok: true });
      case 'buy': {
        const id = String(m.item || '');
        const price = PRICES[id];
        if (price == null) return err('That item is not in the shop.');
        if (acc.owned.includes(id)) return err('You already own that.');
        if (acc.coins < price) return err('Not enough coins.');
        acc.coins -= price;
        acc.owned.push(id);
        await this._save(acc);
        this._push(lower, { t: 'profile', profile: profileOf(acc) });
        return json({ profile: profileOf(acc) });
      }
      case 'equip': {
        if (m.skin != null) {
          if (!acc.owned.includes(m.skin) || !String(m.skin).startsWith('skin_')) return err('You do not own that outfit.');
          acc.equipped.skin = m.skin;
        }
        if (Array.isArray(m.emotes)) {
          const list = m.emotes.slice(0, EMOTE_SLOTS).map((e) => (e && acc.owned.includes(e) && String(e).startsWith('emote_') ? e : null));
          while (list.length < EMOTE_SLOTS) list.push(null);
          acc.equipped.emotes = list;
        }
        await this._save(acc);
        this._sendFriendsOf(lower);
        return json({ profile: profileOf(acc) });
      }
      case 'reward': {
        // match payout: 25 per player outlasted (scaled to 100), 75 per elimination, 400 for a win
        const now = Date.now();
        if (now - (acc.lastReward || 0) < REWARD_GAP_MS) return json({ profile: profileOf(acc), earned: 0 });
        const players = Math.max(1, Math.min(100, m.players | 0));
        const placement = Math.max(1, Math.min(players, m.placement | 0 || players));
        const kills = Math.max(0, Math.min(40, m.kills | 0));
        const won = !!m.won && placement === 1;
        const outlasted = Math.round(((players - placement) / Math.max(1, players - 1)) * 250);
        const earned = Math.min(1500, outlasted + kills * 75 + (won ? 400 : 0));
        acc.coins += earned;
        acc.lastReward = now;
        acc.stats.matches++;
        acc.stats.kills += kills;
        if (won) acc.stats.wins++;
        await this._save(acc);
        return json({ profile: profileOf(acc), earned });
      }
      case 'friendAdd': {
        const to = String(m.name || '').trim().toLowerCase();
        if (to === lower) return err('That is you!');
        const other = await this._acc(to);
        if (!other) return err('No player with that username.', 404);
        if (acc.friends.includes(to)) return err(`${other.name} is already your friend.`);
        if (acc.friends.length >= MAX_FRIENDS) return err('Your friends list is full.');
        if (acc.incoming.includes(to)) return this._accept(acc, other); // they asked first
        if (!acc.outgoing.includes(to)) acc.outgoing.push(to);
        if (!other.incoming.includes(lower)) other.incoming.push(lower);
        await this._save(acc);
        await this._save(other);
        this._push(to, { t: 'request', from: acc.name });
        this._sendFriends(to, other);
        this._sendFriends(lower, acc);
        return json({ profile: profileOf(acc), text: `Friend request sent to ${other.name}.` });
      }
      case 'friendAccept': {
        const from = String(m.name || '').trim().toLowerCase();
        const other = await this._acc(from);
        if (!other || !acc.incoming.includes(from)) return err('That request is gone.');
        return this._accept(acc, other);
      }
      case 'friendDecline':
      case 'friendRemove': {
        const o = String(m.name || '').trim().toLowerCase();
        const other = await this._acc(o);
        const drop = (arr, x) => {
          const i = arr.indexOf(x);
          if (i >= 0) arr.splice(i, 1);
        };
        drop(acc.incoming, o);
        drop(acc.outgoing, o);
        drop(acc.friends, o);
        await this._save(acc);
        if (other) {
          drop(other.incoming, lower);
          drop(other.outgoing, lower);
          drop(other.friends, lower);
          await this._save(other);
          this._sendFriends(o, other);
        }
        this._sendFriends(lower, acc);
        return json({ profile: profileOf(acc) });
      }
      case 'invite': {
        const to = String(m.name || '').trim().toLowerCase();
        const code = String(m.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
        if (!acc.friends.includes(to)) return err('You can only invite friends.');
        if (code.length !== 4) return err('No party to invite to.');
        if (!this.online.has(to)) return err('That friend is offline.');
        this._push(to, { t: 'invite', from: acc.name, code });
        return json({ ok: true });
      }
    }
    return err('Unknown request.');
  }

  async _accept(acc, other) {
    const a = acc.name.toLowerCase();
    const b = other.name.toLowerCase();
    for (const [x, y] of [
      [acc, b],
      [other, a],
    ]) {
      x.incoming = x.incoming.filter((n) => n !== y);
      x.outgoing = x.outgoing.filter((n) => n !== y);
      if (!x.friends.includes(y)) x.friends.push(y);
    }
    await this._save(acc);
    await this._save(other);
    this._sendFriends(a, acc);
    this._sendFriends(b, other);
    return json({ profile: profileOf(acc), text: `You and ${other.name} are now friends.` });
  }

  // ---------------------------------------------------------------- presence

  async onConnect(conn, ctx) {
    const url = new URL(ctx.request.url);
    const acc = await this._session(url.searchParams.get('token'));
    if (!acc) {
      conn.send(JSON.stringify({ t: 'error', text: 'signed-out' }));
      conn.close(4001, 'signed-out');
      return;
    }
    const lower = acc.name.toLowerCase();
    conn.setState({ u: lower });
    let set = this.online.get(lower);
    const wasOnline = !!set;
    if (!set) this.online.set(lower, (set = new Set()));
    set.add(conn.id);
    if (!this.status.has(lower)) this.status.set(lower, { s: 'lobby', party: null, skin: acc.equipped.skin });
    this._sendFriends(lower, acc);
    if (!wasOnline) this._sendFriendsOf(lower);
  }

  async onMessage(conn, raw) {
    const u = conn.state && conn.state.u;
    if (!u || typeof raw !== 'string' || raw.length > 512) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'status') {
      const s = m.s === 'match' ? 'match' : 'lobby';
      const party = typeof m.party === 'string' ? m.party.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : null;
      const prev = this.status.get(u) || {};
      this.status.set(u, { s, party, skin: typeof m.skin === 'string' ? m.skin.slice(0, 40) : prev.skin });
      this._sendFriendsOf(u);
    }
  }

  onClose(conn) {
    const u = conn.state && conn.state.u;
    if (!u) return;
    const set = this.online.get(u);
    if (!set) return;
    set.delete(conn.id);
    if (set.size) return;
    this.online.delete(u);
    this.status.delete(u);
    this._sendFriendsOf(u);
  }

  onError(conn) {
    this.onClose(conn);
  }

  _push(lower, msg) {
    const set = this.online.get(lower);
    if (!set) return;
    const s = JSON.stringify(msg);
    for (const id of set) {
      const c = this.getConnection(id);
      if (c) c.send(s);
    }
  }

  /** Friend list with presence, pushed to `lower` (acc = their account). */
  async _sendFriends(lower, acc) {
    if (!this.online.has(lower)) return;
    acc = acc || (await this._acc(lower));
    if (!acc) return;
    const list = [];
    for (const f of acc.friends) {
      const st = this.status.get(f);
      const other = await this._acc(f);
      list.push({ name: other ? other.name : f, online: this.online.has(f), status: st ? st.s : 'offline', party: st ? st.party : null, skin: st ? st.skin : null });
    }
    list.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    const names = async (arr) => Promise.all(arr.map(async (n) => ((await this._acc(n)) || { name: n }).name));
    this._push(lower, { t: 'friends', list, incoming: await names(acc.incoming), outgoing: await names(acc.outgoing) });
  }

  /** Someone's presence changed: refresh every online friend of theirs. */
  async _sendFriendsOf(lower) {
    const acc = await this._acc(lower);
    if (!acc) return;
    for (const f of acc.friends) if (this.online.has(f)) this._sendFriends(f);
  }
}
