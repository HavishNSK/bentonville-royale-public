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
//                     {t:'chatBlocked', c}   the client's filter stopped a message (category only, never the text)
//   server -> client  {t:'chat', m:{id, name, text, at, dev, announce}}
//                     {t:'chatHistory', list:[m...]}           the last CHAT_KEEP, on connect
//                     {t:'chatError', reason}                  to the sender only
// Dev accounts (src/net/devs.js) are verified from the signed-in session (`acct` on the
// socket, or a later status message). Their name is sent as `[DEV]` by the client, in red.
// `/announce ...` from a dev is broadcast to everyone as an announcement. Anyone else
// who tries it is refused. The displayed name is the account name, not a typed nickname.
// The server is the authority: text goes through cleanChat (src/net/chatFilter.js: length,
// no links / e-mails / phone numbers; swearing, slurs, unsafe phrases and personal-info requests
// are refused, not masked) and is rate limited per player. Breaking the content rules
// CHAT_STRIKES times in CHAT_STRIKE_WINDOW_MS pauses that player's chat for CHAT_STRIKE_MUTE_MS.
// History lives in memory only (it is gone when the room sleeps).
//
// Moderation (party/moderation.js): a banned account cannot chat. Dev commands (/ban, /warn,
// /unban, /history, /resetstats, /flags, /reports, /dismiss) are forwarded to the account server with the dev's own
// session token; the account server re-checks dev rights. Results go only to that dev:
//   server -> client  {t:'modResult', ok, lines:[...]}
// Commands are never broadcast or kept in chat history.

import { Server } from 'partyserver';
import { validMode } from './modes.js';
import { cleanChat, nameIsClean } from '../src/net/chatFilter.js';
import { parseDevChat, parseModCommand, accountGrants } from '../src/net/devs.js';
import { originAllowed } from './authLimits.js';

export const ROOM = 'global';
const MAX_CONNECTIONS = 2000; // well past what a prototype sees; refuses floods
const MAX_LISTED = 60; // names sent to clients; the counts still cover everyone
const BROADCAST_MS = 1000; // at most one list update per second
const MIN_MSG_MS = 250; // status updates faster than this are dropped
const STATUSES = new Set(['lobby', 'queued', 'match']);
const ORDER = { queued: 0, lobby: 1, match: 2 };
const CHAT_KEEP = 30; // recent messages sent to new connections
// Emergency kill switch: reject player chat and stop history (dev /mod commands still work).
const CHAT_DISABLED = true;
const CHAT_GAP_MS = 1500; // at least this between one player's messages
const CHAT_BURST = 6; // ...and at most this many per CHAT_WINDOW_MS
const CHAT_WINDOW_MS = 30000;
const CHAT_MUTE_MS = 60000; // going over the burst limit mutes for this long
const CHAT_STRIKES = 3; // blocked messages (not counting links / personal-info refusals)...
const CHAT_STRIKE_WINDOW_MS = 10 * 60000; // ...within this window...
const CHAT_STRIKE_MUTE_MS = 5 * 60000; // ...pause chat for this long
const MOD_OPS = { ban: 'modBan', warn: 'modWarn', unban: 'modUnban', history: 'modHistory', resetstats: 'modResetStats', flags: 'modFlags', reports: 'modReports', dismiss: 'modDismiss', title: 'modTitle', untitle: 'modUntitle' };
const STRIKE_CATEGORIES = new Set(['slur', 'selfharm', 'threat', 'sexual', 'drugs', 'profanity', 'bully']);

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
    .map((p) => {
      const row = { name: p.name, status: p.status, mode: p.mode };
      if (p.title) {
        row.title = p.title;
        row.color = p.titleColor;
        if (p.nameColor) row.nameColor = p.nameColor; // dev-made titles can colour the username separately
      }
      return row;
    });
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
    // only the game's own pages may open sockets (party/authLimits.js originAllowed)
    if (!originAllowed(ctx.request.headers.get('origin'), this.env && this.env.ALLOWED_ORIGINS)) {
      try {
        conn.close(4003, 'origin');
      } catch {
        /* gone */
      }
      return;
    }
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
      title: '', // verified account title (devs.js PLAYER_TITLES) and its name colour
      titleColor: '',
      acctName: '',
      banned: false,
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
      if (!CHAT_DISABLED && this.chat.length) conn.send(JSON.stringify({ t: 'chatHistory', list: this.chat }));
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
      p.title = '';
      p.titleColor = '';
      p.acctName = '';
      p.banned = false;
      p.devFor = '';
      p.devCheck = null;
      return Promise.resolve();
    }
    if (p.devCheck && p.devFor === acct) return p.devCheck;
    p.devFor = acct;
    p.dev = false;
    p.devName = '';
    p.title = '';
    p.titleColor = '';
    p.acctName = '';
    p.banned = false;
    p.devCheck = this._lookupAccount(acct)
      .then((info) => {
        if (p.acct !== acct || !info) return;
        const name = info.name;
        const g = accountGrants(name, info.title);
        p.acctName = info.lower;
        p.acctDisplay = info.name;
        p.banned = info.banned;
        p.dev = g.dev;
        p.devName = g.shown;
        p.title = g.title;
        p.titleColor = g.titleColor;
        p.nameColor = g.nameColor || '';
        if (p.devName) p.name = p.devName; // a verified name: the typed nickname cannot take it over
      })
      .catch(() => {
        if (p.acct === acct) {
          p.dev = false;
          p.devName = '';
          p.title = '';
          p.titleColor = '';
        }
      });
    return p.devCheck;
  }

  /** POST one op to the account server (same Worker). Returns {status, data}. */
  async _accounts(body) {
    if (!this.env || !this.env.Accounts) return { status: 503, data: { error: 'Accounts are unavailable.' } };
    const stub = this.env.Accounts.get(this.env.Accounts.idFromName('global'));
    const res = await stub.fetch(
      new Request('https://accounts/global', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data: data || {} };
  }

  /** The signed-in account behind `acct`: {name, lower, dev, banned} or null. */
  async _lookupAccount(acct) {
    const { status, data } = await this._accounts({ op: 'me', token: acct });
    const name = status === 200 && data.profile && data.profile.name;
    if (!name) return null;
    const short = String(name).slice(0, 16);
    const t = data.profile.title;
    const title = t && typeof t.title === 'string' ? { title: t.title, color: t.color || null, nameColor: t.nameColor || null } : null;
    return { name: short, lower: short.toLowerCase(), banned: !!data.profile.banned, title };
  }

  /** A dev moderation command: forwarded with the dev's own token, answered to that dev only. */
  async _modCommand(conn, p, cmd) {
    const send = (ok, lines) => {
      try {
        conn.send(JSON.stringify({ t: 'modResult', ok, lines: [].concat(lines).map((l) => String(l).slice(0, 300)) }));
      } catch {
        /* gone */
      }
    };
    if (cmd.error) return send(false, cmd.error);
    const { status, data } = await this._accounts({
      op: MOD_OPS[cmd.cmd],
      token: p.acct,
      name: cmd.name,
      duration: cmd.duration || undefined,
      reason: cmd.reason,
      title: cmd.cmd === 'title' ? cmd.reason : undefined,
      color: cmd.color || undefined,
      nameColor: cmd.nameColor || undefined,
    });
    if (status !== 200) return send(false, data.error || 'That did not work.');
    this._applyAccountUpdate(data);
    return send(true, Array.isArray(data.lines) ? data.lines : 'Done.');
  }

  /** A ban / unban or title change on an account: show it on that player's open sockets right away. */
  _applyAccountUpdate(data) {
    if (!data || typeof data.target !== 'string') return;
    if (typeof data.banned === 'boolean') {
      for (const other of this.players.values()) if (other.acctName === data.target) other.banned = data.banned;
    }
    if ('title' in data) {
      for (const other of this.players.values()) {
        if (other.acctName !== data.target || !other.acctDisplay) continue;
        const g = accountGrants(other.acctDisplay, data.title);
        other.title = g.title;
        other.titleColor = g.titleColor;
        other.nameColor = g.nameColor || '';
        if (g.shown) {
          other.devName = g.shown;
          other.name = g.shown;
        }
      }
      this._schedule();
    }
  }

  _chatLimits(p) {
    const lim = this.chatBy.get(p.token) || { last: 0, times: [], mutedUntil: 0, lastText: '', strikes: [], muteWhy: '' };
    this.chatBy.set(p.token, lim);
    if (this.chatBy.size > 5000) this.chatBy.delete(this.chatBy.keys().next().value);
    return lim;
  }

  /** A message broke the content rules (seen here or by the client's filter): count a strike. */
  _strike(conn, p, category) {
    if (!STRIKE_CATEGORIES.has(category)) return;
    const now = Date.now();
    const lim = this._chatLimits(p);
    lim.strikes = (lim.strikes || []).filter((t) => now - t < CHAT_STRIKE_WINDOW_MS);
    lim.strikes.push(now);
    if (lim.strikes.length < CHAT_STRIKES) return;
    lim.strikes = [];
    lim.mutedUntil = now + CHAT_STRIKE_MUTE_MS;
    lim.muteWhy = 'rules';
    try {
      conn.send(JSON.stringify({ t: 'chatError', reason: 'Your chat is paused for 5 minutes for breaking the chat rules.' }));
    } catch {
      /* gone */
    }
  }

  /** One chat message from `p` (rate limited, filtered), broadcast to everyone. */
  async _chat(conn, p, raw) {
    const now = Date.now();
    const lim = this._chatLimits(p);
    const fail = (reason) => {
      try {
        conn.send(JSON.stringify({ t: 'chatError', reason }));
      } catch {
        /* gone */
      }
    };
    // Kill switch: block public chat; still allow signed-in dev /mod commands.
    if (CHAT_DISABLED) {
      await this._markDev(p);
      const mod = parseModCommand(raw);
      if (mod) {
        if (!p.dev) return fail('Only developers can use that.');
        lim.last = now;
        return this._modCommand(conn, p, mod);
      }
      return fail('Chat is temporarily turned off.');
    }
    if (now < lim.mutedUntil) {
      const s = Math.ceil((lim.mutedUntil - now) / 1000);
      const wait = s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`;
      return fail(lim.muteWhy === 'rules' ? `Your chat is paused for breaking the chat rules. Try again in ${wait}.` : `Slow down: you can chat again in ${wait}.`);
    }
    lim.muteWhy = '';
    if (now - lim.last < CHAT_GAP_MS) return fail('Slow down a little.');
    lim.times = lim.times.filter((t) => now - t < CHAT_WINDOW_MS);
    if (lim.times.length >= CHAT_BURST) {
      lim.mutedUntil = now + CHAT_MUTE_MS;
      return fail('Too many messages: chat paused for a minute.');
    }
    await this._markDev(p);
    if (p.banned) return fail('Your account is banned, so chat is off.');
    const mod = parseModCommand(raw);
    if (mod) {
      if (!p.dev) return fail('Only developers can use that.');
      lim.last = now;
      return this._modCommand(conn, p, mod);
    }
    const parsed = parseDevChat(raw, p.dev);
    if (parsed.error) return fail(parsed.error);
    const r = cleanChat(parsed.text);
    if (!r.ok) {
      if (r.reason === 'empty') return undefined;
      fail(r.reason);
      return this._strike(conn, p, r.category);
    }
    if (r.text.toLowerCase() === lim.lastText) return fail('You just said that.');
    lim.last = now;
    lim.times.push(now);
    lim.lastText = r.text.toLowerCase();
    const m = { id: ++this.chatSeq, name: p.devName || p.name, text: r.text, at: now, dev: !!p.dev, announce: !!parsed.announce };
    if (p.title) {
      m.title = p.title;
      m.color = p.titleColor;
      if (p.nameColor) m.nameColor = p.nameColor;
    }
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
    if (msg && msg.t === 'chatBlocked') {
      this._strike(sender, p, String(msg.c || ''));
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
    if (msg.name != null && !p.devName) p.name = cleanName(msg.name);
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

  async onRequest(req) {
    // POST is internal: the account server reports ban / title changes made from the DEV panel.
    // (party/server.js refuses POSTs to /parties/presence/ from the internet.)
    if (req.method === 'POST') {
      let data = null;
      try {
        data = await req.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      if (!data || data.t !== 'account') return new Response('unknown', { status: 400 });
      this._applyAccountUpdate(data);
      return Response.json({ ok: true });
    }
    // counts only (no names) for a quick status check
    const s = snapshot(this.players.values());
    return Response.json({ count: s.count, searching: s.searching, inMatch: s.inMatch });
  }
}
