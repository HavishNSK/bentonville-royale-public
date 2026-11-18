// BENTONVILLE ROYALE — multiplayer relay (PartyServer on Cloudflare Workers; hosted PartyKit
// shut down on 23 Oct 2026). One Durable Object room per 4-letter room code.
//
// This server does no game logic: the host's browser runs the whole match.
// It only routes frames between the host and its guests and keeps the lobby
// rules (one host per room, MAX_HUMANS, no joining a started match).
//
// Connect:  /parties/main/<CODE>?role=host|guest&v=<PROTO_VERSION>&name=<name>[&token=<party token>]
//
// Text frames (JSON payloads, forwarded verbatim, never parsed except control):
//   host  -> server   "<to>:<json>"   to = guest slot id, '*' (all guests) or '@' (control)
//   server -> host    "<from>:<json>" from = guest slot id, or '@' for server notices
//   guest <-> server  "<json>"        guest frames go to the host; host frames arrive bare
// Binary frames (ArrayBuffer) carry a 1-byte routing prefix:
//   host  -> server   [to u8][payload]  to = slot id, 255 = all guests
//   server -> host    [from u8][payload]
//   guest <-> server  [payload]         (no prefix)
//
// Server notices to the host ('@'):  ready, join {id,name,token}, leave {id}, taken
// Host control ('@'):                 started {on}, kick {id, reason?}
// To guests:                          {t:'reject', reason} then close; {t:'bye', reason:'host-left'}
// Reject reasons match Net.js MSG keys: notFound, full, started, version, kicked.

import { Server, routePartykitRequest } from 'partyserver';
import { MAX_HUMANS } from '../src/net/protocol.js';
import { nameIsClean } from '../src/net/chatFilter.js';
import { originAllowed } from './authLimits.js';

// The party lobby, matchmaker, accounts and online list run in the same Worker (wrangler.jsonc binds them all).
export { Party } from './partyRoom.js';
export { Matchmaker } from './matchmaker.js';
export { Accounts } from './accounts.js';
export { Presence } from './presence.js';

const BROADCAST = 255;

function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s && nameIsClean(s) ? s : 'Player'; // names with swear words show as Player
}

export class Main extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.hostId = null; // connection id of the host
    this.version = null;
    this.started = false;
    this.guests = new Map(); // slot id -> connection
  }

  _reject(conn, reason) {
    try {
      conn.send(JSON.stringify({ t: 'reject', reason }));
      // 4002 = removed by the host (Net.js shows "You were removed"); 4000 = refused at the door
      conn.close(reason === 'kicked' ? 4002 : 4000, reason);
    } catch {
      /* already gone */
    }
  }

  _host() {
    return this.hostId ? this.getConnection(this.hostId) : null;
  }

  _toHost(text) {
    const h = this._host();
    if (h) h.send(text);
  }

  _freeSlot() {
    for (let i = 1; i < MAX_HUMANS; i++) if (!this.guests.has(i)) return i;
    return -1;
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
    const url = new URL(ctx.request.url);
    const role = url.searchParams.get('role');
    const v = url.searchParams.get('v') || '';
    const name = cleanName(url.searchParams.get('name'));
    const token = String(url.searchParams.get('token') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

    if (role === 'host') {
      if (this.hostId && this._host()) {
        conn.send('@:' + JSON.stringify({ t: 'taken' }));
        conn.close(4001, 'taken');
        return;
      }
      this.hostId = conn.id;
      this.version = v;
      this.started = false;
      this.guests.clear();
      conn.setState({ role: 'host' });
      conn.send('@:' + JSON.stringify({ t: 'ready', code: this.name, max: MAX_HUMANS }));
      return;
    }

    if (!this.hostId || !this._host()) return this._reject(conn, 'notFound');
    if (v !== this.version) return this._reject(conn, 'version');
    if (this.started) return this._reject(conn, 'started');
    const slot = this._freeSlot();
    if (slot < 0) return this._reject(conn, 'full');
    this.guests.set(slot, conn);
    conn.setState({ role: 'guest', slot });
    this._toHost('@:' + JSON.stringify({ t: 'join', id: slot, name, token }));
  }

  onMessage(sender, message) {
    const st = sender.state || {};
    if (st.role === 'host') {
      if (typeof message === 'string') {
        const i = message.indexOf(':');
        if (i < 0) return;
        const to = message.slice(0, i);
        const payload = message.slice(i + 1);
        if (to === '@') return this._control(payload);
        if (to === '*') {
          for (const g of this.guests.values()) g.send(payload);
          return;
        }
        const g = this.guests.get(Number(to));
        if (g) g.send(payload);
        return;
      }
      const bytes = new Uint8Array(message);
      if (bytes.length < 1) return;
      const to = bytes[0];
      const payload = bytes.slice(1).buffer;
      if (to === BROADCAST) for (const g of this.guests.values()) g.send(payload);
      else {
        const g = this.guests.get(to);
        if (g) g.send(payload);
      }
      return;
    }
    if (st.role !== 'guest') return;
    if (typeof message === 'string') {
      this._toHost(st.slot + ':' + message);
      return;
    }
    const h = this._host();
    if (!h) return;
    const src = new Uint8Array(message);
    const out = new Uint8Array(src.length + 1);
    out[0] = st.slot;
    out.set(src, 1);
    h.send(out.buffer);
  }

  _control(payload) {
    let msg;
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (msg.t === 'started') this.started = !!msg.on;
    else if (msg.t === 'kick') {
      const g = this.guests.get(msg.id);
      if (!g) return;
      this._reject(g, msg.reason || 'kicked');
    }
  }

  onClose(conn) {
    const st = conn.state || {};
    if (st.role === 'host' && conn.id === this.hostId) {
      this.hostId = null;
      this.started = false;
      const bye = JSON.stringify({ t: 'bye', reason: 'host-left' });
      for (const g of this.guests.values()) {
        try {
          g.send(bye);
          g.close(4003, 'host-left');
        } catch {
          /* ignore */
        }
      }
      this.guests.clear();
      return;
    }
    if (st.role === 'guest' && this.guests.get(st.slot) === conn) {
      this.guests.delete(st.slot);
      this._toHost('@:' + JSON.stringify({ t: 'leave', id: st.slot }));
    }
  }

  onError(conn) {
    this.onClose(conn);
  }
}

export default {
  async fetch(request, env) {
    // Internal-only endpoints: the matchmaker and the party rooms' match-plan POST are called by
    // other Durable Objects through bindings, never by browsers. Refuse them from the internet.
    const path = new URL(request.url).pathname;
    if (path.startsWith('/parties/matchmaker/') || (path.startsWith('/parties/party/') && request.method === 'POST')) {
      return new Response('Not found', { status: 404 });
    }
    return (await routePartykitRequest(request, env)) || new Response('Not found', { status: 404 });
  },
};
