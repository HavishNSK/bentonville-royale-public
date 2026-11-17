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

import { Server } from 'partyserver';
import { validMode } from './modes.js';

export const ROOM = 'global';
const MAX_CONNECTIONS = 2000; // well past what a prototype sees; refuses floods
const MAX_LISTED = 60; // names sent to clients; the counts still cover everyone
const BROADCAST_MS = 1000; // at most one list update per second
const MIN_MSG_MS = 250; // status updates faster than this are dropped
const STATUSES = new Set(['lobby', 'queued', 'match']);
const ORDER = { queued: 0, lobby: 1, match: 2 };

function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s || 'Player';
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
      name: cleanName(url.searchParams.get('name')),
      status: cleanStatus(url.searchParams.get('status')),
      mode: cleanMode(url.searchParams.get('mode')),
      since: Date.now(),
      last: 0,
    });
    try {
      conn.send(JSON.stringify(snapshot(this.players.values())));
    } catch {
      /* gone */
    }
    this._schedule();
  }

  onMessage(sender, message) {
    const p = this.players.get(sender.id);
    if (!p || typeof message !== 'string' || message.length > 300) return;
    const now = Date.now();
    if (now - p.last < MIN_MSG_MS) return;
    p.last = now;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!msg || msg.t !== 'status') return;
    p.status = cleanStatus(msg.status);
    p.mode = cleanMode(msg.mode);
    if (msg.name != null) p.name = cleanName(msg.name);
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
