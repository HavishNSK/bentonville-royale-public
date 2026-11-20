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
//
// HOST MIGRATION (Box Fights lobby matches only; party/relayMigration.js decides):
//   A lobby room (party/lobbyRoom.js) registers the relay room with an internal POST {t:'lobby'}
//   at matchStart. Rooms that were never registered (battle royale, friend lobbies) keep the
//   old rule: host gone -> {t:'bye', reason:'host-left'} to every guest, then close.
//   In a registered room, when the host's socket closes:
//     - if the lobby already named a successor (internal POST {t:'promote', token}) and that
//       guest is connected, it is promoted at once;
//     - otherwise guests get {t:'hostLost', graceMs} and the room waits HOST_GRACE_MS for the
//       promote POST; nobody named in time -> the old bye behaviour.
//   The successor is chosen ONLY by the lobby server (by the party token the guest connected
//   with); nothing a guest sends can promote it. Promotion upgrades the guest's existing socket:
//     to the new host  '@:' {t:'promoted', code, max, guests:[{id, name, token}]}
//                      from now on it speaks the host protocol above ("<to>:<json>" etc.);
//                      its old guest slot id is gone, the other guests keep their slot ids
//     to the others    {t:'newHost', id}   id = the relay slot the new host had as a guest
//   No reconnect is needed. A role=host connect while a room waits for promotion gets 'taken'.
//   POSTs to /parties/main/ are refused from the internet (default fetch below).

import { Server, routePartykitRequest } from 'partyserver';
import { MAX_HUMANS } from '../src/net/protocol.js';
import { nameIsClean } from '../src/net/chatFilter.js';
import { originAllowed } from './authLimits.js';
import { HOST_GRACE_MS, cleanRelayToken, hostClosedDecision, promoteDecision, rosterAfterPromotion } from './relayMigration.js';

// The party lobby, matchmaker, accounts and online list run in the same Worker (wrangler.jsonc binds them all).
export { Party } from './partyRoom.js';
export { Matchmaker } from './matchmaker.js';
export { Accounts } from './accounts.js';
export { Presence } from './presence.js';
// Box Fights custom lobbies (6-character codes) and their public list.
export { Lobby } from './lobbyRoom.js';
export { LobbyIndex } from './lobbyIndex.js';

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
    // host migration (lobby rooms only, see the header)
    this.lobbyManaged = false;
    this.pendingToken = '';
    this.hostWait = null; // grace timer while the room has no host
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
    const token = cleanRelayToken(url.searchParams.get('token'));

    if (role === 'host') {
      if ((this.hostId && this._host()) || this.hostWait) {
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
    conn.setState({ role: 'guest', slot, name, token });
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
      const d = hostClosedDecision({ lobbyManaged: this.lobbyManaged, pendingToken: this.pendingToken, guests: this._guestInfo() });
      if (d.action === 'promote') return this._promote(d.slot);
      if (d.action === 'wait') {
        const lost = JSON.stringify({ t: 'hostLost', graceMs: HOST_GRACE_MS });
        for (const g of this.guests.values()) this._sendTo(g, lost);
        this.hostWait = setTimeout(() => {
          this.hostWait = null;
          if (!this.hostId) this._bye();
        }, HOST_GRACE_MS);
        return;
      }
      this._bye();
      return;
    }
    if (st.role === 'guest' && this.guests.get(st.slot) === conn) {
      this.guests.delete(st.slot);
      this._toHost('@:' + JSON.stringify({ t: 'leave', id: st.slot }));
    }
  }

  _sendTo(conn, text) {
    try {
      conn.send(text);
    } catch {
      /* gone */
    }
  }

  /** Map<slot, {token, name}> of the connected guests. */
  _guestInfo() {
    const out = new Map();
    for (const [slot, g] of this.guests) out.set(slot, { token: (g.state && g.state.token) || '', name: (g.state && g.state.name) || 'Player' });
    return out;
  }

  /** Guest `slot` becomes the host on its existing socket. */
  _promote(slot) {
    const conn = this.guests.get(slot);
    if (!conn) return this._bye();
    clearTimeout(this.hostWait);
    this.hostWait = null;
    const roster = rosterAfterPromotion(this._guestInfo(), slot);
    this.guests.delete(slot);
    this.hostId = conn.id;
    this.pendingToken = '';
    conn.setState({ role: 'host' });
    this._sendTo(conn, '@:' + JSON.stringify({ t: 'promoted', code: this.name, max: MAX_HUMANS, guests: roster }));
    const note = JSON.stringify({ t: 'newHost', id: slot });
    for (const g of this.guests.values()) this._sendTo(g, note);
  }

  /** No host and nobody to take over: close everyone (the original behaviour). */
  _bye() {
    this.hostId = null;
    this.started = false;
    this.lobbyManaged = false;
    this.pendingToken = '';
    clearTimeout(this.hostWait);
    this.hostWait = null;
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
  }

  onError(conn) {
    this.onClose(conn);
  }

  /**
   * Internal only (party/lobbyRoom.js through the Main binding; the Worker refuses these POSTs
   * from the internet): {t:'lobby'} marks a lobby match room, {t:'promote', token} names the
   * guest that takes over when the host is gone.
   */
  async onRequest(req) {
    if (req.method !== 'POST') return new Response('Not found', { status: 404 });
    const text = await req.text();
    if (text.length > 1024) return new Response('too large', { status: 413 });
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if (msg && msg.t === 'lobby') {
      this.lobbyManaged = true;
      return Response.json({ ok: true });
    }
    if (!msg || msg.t !== 'promote') return new Response('unknown', { status: 400 });
    const token = cleanRelayToken(msg.token);
    const d = promoteDecision({ hostConnected: !!(this.hostId && this._host()), waiting: !!this.hostWait, token, guests: this._guestInfo() });
    if (d.action === 'promote') this._promote(d.slot);
    else if (d.action === 'pending') this.pendingToken = token;
    return Response.json({ ok: true, action: d.action });
  }
}

export default {
  async fetch(request, env) {
    // Internal-only endpoints: the matchmaker, the party rooms' match-plan POST and the presence
    // account-update POST are called by other Durable Objects through bindings, never by browsers.
    // Refuse them from the internet.
    const path = new URL(request.url).pathname;
    // Lobby rooms, the lobby index and relay rooms also take internal POSTs (lobby claims / list
    // updates / host migration); browsers only GET the lobby list (/parties/lobby-index/index).
    const internalPost = ['/parties/party/', '/parties/presence/', '/parties/lobby/', '/parties/lobby-index/', '/parties/main/'].some((p) => path.startsWith(p));
    if (path.startsWith('/parties/matchmaker/') || (internalPost && request.method === 'POST')) {
      return new Response('Not found', { status: 404 });
    }
    return (await routePartykitRequest(request, env)) || new Response('Not found', { status: 404 });
  },
};
