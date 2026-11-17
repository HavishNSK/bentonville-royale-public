// BENTONVILLE ROYALE — who's online. One PartyServer room ("global") that every title screen
// joins, signed in or not. It only lists display names and what each player is doing so people
// can see who else is around and queue in the same mode at the same time (the matchmaker then
// puts them in one match and bots fill the rest). It is not identity, auth or anti-cheat:
// names and statuses are whatever the clients say.
//
// Connect:  /parties/presence/global?name=&token=&status=&mode=
// Client -> server (JSON):  {t:'status', status:'lobby'|'queued'|'match', mode, name}
// Server -> client (JSON):  {t:'online', count, searching:{solo,duo,trio,squad}, inMatch,
//                            players:[{name, status, mode}]}   (tokens are never sent out)
//
// Global chat (everyone connected, in a lobby or in a match):
//   client -> server  {t:'chat', text}
//   server -> client  {t:'chat', m:{id, name, text, at, dev, announce}}
//                     {t:'chatHistory', list:[m...]}           the last CHAT_KEEP, on connect
//                     {t:'chatError', reason}                  to the sender only
// Dev accounts (src/net/devs.js) are verified from the signed-in session (`acct` on the
// socket, or a later status message). Their name is sent as `[DEV]` by the client, in red.
// `/announce ...` from a dev is broadcast to everyone as an announcement. Anyone else
// who tries it is refused. The displayed name is the account name, not a typed nickname.
// The server is the authority: text goes through cleanChat (src/net/chatFilter.js: length,
// no links / e-mails / phone numbers, swear words masked) and is rate limited per player.
// History lives in memory only (it is gone when the room sleeps).

import { Server } from 'partyserver';
import { validMode } from './modes.js';
import { cleanChat, nameIsClean } from '../src/net/chatFilter.js';
import { isDevName, parseDevChat } from '../src/net/devs.js';

export const ROOM = 'global';
const MAX_CONNECTIONS = 2000; // well past what a prototype sees; refuses floods
const MAX_LISTED = 60; // names sent to clients; the counts still cover everyone
const BROADCAST_MS = 1000; // at most one list update per second
const MIN_MSG_MS = 250; // status updates faster than this are dropped
const STATUSES = new Set(['lobby', 'queued', 'match']);
const ORDER = { queued: 0, lobby: 1, match: 2 };
const CHAT_KEEP = 30; // recent messages sent to new connections
const CHAT_GAP_MS = 1500; // at least this between one player's messages
const CHAT_BURST = 6; // ...and at most this many per CHAT_WINDOW_MS
const CHAT_WINDOW_MS = 30000;
const CHAT_MUTE_MS = 60000; // going over the burst limit mutes for this long

function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s && nameIsClean(s) ? s : 'Player'; // names with swear words show as Player
}

function cleanAcct(t) {
  const s = String(t || '')
    .replace(/[^a-f0-9]/gi, '')
    .slice(0, 64);
  return s.length >= 32 ? s : '';
}

function cleanToken(t) {
  return String(t || '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 40);
}

function cleanStatus(s) {
  return STATUSES.has(s) ? s : 'lobby';
}

function cleanMode(m) {
  return validMode(m) ? m : 'solo';
}

/** players: iterable of {name, status, mode} -> the public snapshot (exported for tests). */
export function snapshot(players) {
  const all = [...players];
  const searching = { solo: 0, duo: 0, trio: 0, squad: 0 };
  let inMatch = 0;
  for (const p of all) {
    if (p.status === 'queued') searching[p.mode] = (searching[p.mode] || 0) + 1;
    else if (p.status === 'match') inMatch++;
  }
  const list = all
    .slice()
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.since - b.since)
    .slice(0, MAX_LISTED)
    .map((p) => ({ name: p.name, status: p.status, mode: p.mode }));
  return { t: 'online', count: all.length, searching, inMatch, players: list };
}

export class Presence extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.players = new Map(); // connection id -> {token, name, status, mode, since, last}
    this.timer = null;
    this.chat = []; // recent messages, oldest first
    this.chatSeq = 0;
    this.chatBy = new Map(); // token -> {last, times:[ms], mutedUntil, lastText} (survives reconnects)
  }

  onConnect(conn, ctx) {
    if (this.name !== ROOM || this.players.size >= MAX_CONNECTIONS) {
      try {
        conn.close(4000, 'unavailable');
      } catch {
        /* gone */
      }
      return;
    }
    const url = new URL(ctx.request.url);
    const token = cleanToken(url.searchParams.get('token')) || 'anon-' + conn.id;
    // one row per tab: a reconnect with the same token replaces the old socket
    for (const [id, p] of this.players) {
      if (p.token !== token) continue;
      this.players.delete(id);
      const old = this.getConnection(id);
      if (old && old !== conn) {
        try {
          old.close(4004, 'replaced');
        } catch {
          /* gone */
        }
      }
    }
    this.players.set(conn.id, {
      token,
      acct: cleanAcct(url.searchParams.get('acct')),
      name: cleanName(url.searchParams.get('name')),
      dev: false,
      devName: '',
      devFor: '',
      devCheck: null,
      status: cleanStatus(url.searchParams.get('status')),
      mode: cleanMode(url.searchParams.get('mode')),
      since: Date.now(),
      last: 0,
    });
    this._markDev(this.players.get(conn.id));
    try {
      conn.send(JSON.stringify(snapshot(this.players.values())));
      if (this.chat.length) conn.send(JSON.stringify({ t: 'chatHistory', list: this.chat }));
    } catch {
      /* gone */
    }
    this._schedule();
  }

  /** Resolve the signed-in account. Dev rights stick to that account, not the typed name. */
  _markDev(p) {
    const acct = p.acct;
    if (!acct) {
      p.dev = false;
      p.devName = '';
      p.devFor = '';
      p.devCheck = null;
      return Promise.resolve();
    }
    if (p.devCheck && p.devFor === acct) return p.devCheck;
    p.devFor = acct;
    p.dev = false;
    p.devName = '';
    p.devCheck = this._lookupDev(acct)
      .then((name) => {
        if (p.acct !== acct) return;
        p.dev = !!name;
        p.devName = name || '';
        if (name) p.name = name;
      })
      .catch(() => {
        if (p.acct === acct) {
          p.dev = false;
          p.devName = '';
        }
      });
    return p.devCheck;
  }

  async _lookupDev(acct) {
    if (!this.env || !this.env.Accounts) return null;
    const id = this.env.Accounts.idFromName('global');
    const stub = this.env.Accounts.get(id);
    const res = await stub.fetch(
      new Request('https://accounts/global', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op: 'me', token: acct }),
      })
    );
    if (!res.ok) return null;
    const data = await res.json();
    const name = data && data.profile && data.profile.name;
    return isDevName(name) ? String(name).slice(0, 16) : null;
  }

  /** One chat message from `p` (rate limited, filtered), broadcast to everyone. */
  async _chat(conn, p, raw) {
    const now = Date.now();
    const lim = this.chatBy.get(p.token) || { last: 0, times: [], mutedUntil: 0, lastText: '' };
    this.chatBy.set(p.token, lim);
    if (this.chatBy.size > 5000) this.chatBy.delete(this.chatBy.keys().next().value);
    const fail = (reason) => {
      try {
        conn.send(JSON.stringify({ t: 'chatError', reason }));
      } catch {
        /* gone */
      }
    };
    if (now < lim.mutedUntil) return fail(`Slow down: you can chat again in ${Math.ceil((lim.mutedUntil - now) / 1000)} s.`);
    if (now - lim.last < CHAT_GAP_MS) return fail('Slow down a little.');
    lim.times = lim.times.filter((t) => now - t < CHAT_WINDOW_MS);
    if (lim.times.length >= CHAT_BURST) {
      lim.mutedUntil = now + CHAT_MUTE_MS;
      return fail('Too many messages: chat paused for a minute.');
    }
    await this._markDev(p);
    const parsed = parseDevChat(raw, p.dev);
    if (parsed.error) return fail(parsed.error);
    const r = cleanChat(parsed.text);
    if (!r.ok) return r.reason === 'empty' ? undefined : fail(r.reason);
    if (r.text.toLowerCase() === lim.lastText) return fail('You just said that.');
    lim.last = now;
    lim.times.push(now);
    lim.lastText = r.text.toLowerCase();
    const m = { id: ++this.chatSeq, name: p.dev ? p.devName : p.name, text: r.text, at: now, dev: !!p.dev, announce: !!parsed.announce };
    this.chat.push(m);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.broadcast(JSON.stringify({ t: 'chat', m }));
  }

  onMessage(sender, message) {
    const p = this.players.get(sender.id);
    if (!p || typeof message !== 'string' || message.length > 600) return;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg && msg.t === 'chat') {
      this._chat(sender, p, msg.text).catch(() => {});
      return;
    }
    if (msg && msg.acct != null) {
      const next = cleanAcct(msg.acct);
      if (next !== p.acct) {
        p.acct = next;
        this._markDev(p);
      }
    }
    const now = Date.now();
    if (now - p.last < MIN_MSG_MS) return;
    p.last = now;
    if (!msg || msg.t !== 'status') return;
    p.status = cleanStatus(msg.status);
    p.mode = cleanMode(msg.mode);
    if (msg.name != null && !p.dev) p.name = cleanName(msg.name);
    this._schedule();
  }

  onClose(conn) {
    if (this.players.delete(conn.id)) this._schedule();
  }

  onError(conn) {
    this.onClose(conn);
  }

  _schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.broadcast(JSON.stringify(snapshot(this.players.values())));
    }, BROADCAST_MS);
  }

  onRequest() {
    // counts only (no names) for a quick status check
    const s = snapshot(this.players.values());
    return Response.json({ count: s.count, searching: s.searching, inMatch: s.inMatch });
  }
}
