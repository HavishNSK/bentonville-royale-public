// BENTONVILLE ROYALE — peer-to-peer rooms over PeerJS (WebRTC data channels).
//
// Lazy-loaded by src/main.js only when the player picks Host or Join, so solo
// play never downloads PeerJS. No server of our own: PeerJS's free public
// broker (0.peerjs.com) only introduces the browsers; game traffic is direct.
// For local testing a self-hosted `peer` server can be used instead:
//   ?peer=localhost:9000            (page URL)  or  VITE_PEER_HOST=localhost:9000
//
//   const room = await hostRoom({ name })          -> HostRoom
//   const conn = await joinRoom(code, { name })     -> ClientConn (rejects with a readable Error)
//
// HostRoom
//   code, link, players -> [{ id, name, host }], fill (bots on/off), started
//   setFill(on), onLobby(fn), close()
//   clients: Map<id, Client>; Client = { id, name, r, u, bytesOut, bytesIn }
//   sendTo(id, msg) / broadcast(msg) (JSON, reliable) / sendRawTo(id, buf) / broadcastRaw(buf)
//   handlers for the match: onMessage(client, msg), onState(client, buf), onLeave(client)
// ClientConn
//   id (slot; host = 0), code, players, fill, send(msg), sendRaw(buf), close()
//   onLobby(info), onStart(msg), onMessage(msg), onRaw(buf), onClose(reason)

import Peer from 'peerjs';
import {
  PROTO_VERSION, MAX_HUMANS, PEER_PREFIX, randomCode, normalizeCode, validCode, sendJSON, makeReassembler,
} from './protocol.js';

const OPEN_MS = 12000;

export const MSG = {
  broker: 'Could not reach the matchmaking server. Check your connection and try again.',
  notFound: (c) => `No room with code ${c}. Check the code and that the host is still in the lobby.`,
  full: `That room is full (${MAX_HUMANS} players).`,
  started: 'That match has already started.',
  version: 'That room runs a different version of the game. Refresh and try again.',
  badCode: 'Room codes are 4 letters, like ABCD.',
  hostLeft: 'Host left the match.',
  timeout: 'The host did not answer. Try again in a moment.',
};

/** PeerJS options: public broker by default; ?peer=host:port (or VITE_PEER_HOST) for a local server. */
export function peerOptions() {
  let spec = '';
  try {
    spec = new URLSearchParams(location.search).get('peer') || '';
  } catch {
    /* no location */
  }
  if (!spec && import.meta.env && import.meta.env.VITE_PEER_HOST) spec = import.meta.env.VITE_PEER_HOST;
  const opts = { debug: 0 };
  if (spec) {
    const [host, port] = spec.split(':');
    opts.host = host;
    opts.port = Number(port) || 9000;
    opts.path = '/';
    opts.secure = location.protocol === 'https:' && host !== 'localhost';
    opts.config = { iceServers: [] }; // local testing: host candidates only
  }
  return opts;
}

function brokerError(err) {
  const t = err && err.type;
  return t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed' || t === 'ssl-unavailable' || t === 'browser-incompatible';
}

/** Share link for a room code (same page, ?room=CODE; keeps a ?peer= override). */
export function shareLink(code) {
  const u = new URL(location.href);
  const keep = u.searchParams.get('peer');
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  if (keep) u.searchParams.set('peer', keep);
  return u.toString();
}

export function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s || 'Player';
}

// ------------------------------------------------------------------ host

export function hostRoom({ name }) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const attempt = () => {
      const code = randomCode();
      const peer = new Peer(PEER_PREFIX + code, peerOptions());
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        peer.destroy();
        reject(new Error(MSG.broker));
      }, OPEN_MS);
      peer.on('open', () => {
        opened = true;
        clearTimeout(timer);
        resolve(new HostRoom(peer, code, cleanName(name)));
      });
      peer.on('error', (err) => {
        if (opened) return; // handled by HostRoom
        clearTimeout(timer);
        peer.destroy();
        if (err && err.type === 'unavailable-id' && tries++ < 5) attempt();
        else reject(new Error(brokerError(err) ? MSG.broker : (err && err.message) || MSG.broker));
      });
    };
    attempt();
  });
}

class HostRoom {
  constructor(peer, code, name) {
    this.peer = peer;
    this.code = code;
    this.link = shareLink(code);
    this.name = name;
    this.fill = true;
    this.started = false;
    this.closed = false;
    this.clients = new Map(); // id -> client
    this._byPeer = new Map(); // peer id -> client (pending or joined)
    this._lobbyFns = [];
    this.onMessage = null;
    this.onState = null;
    this.onLeave = null;
    this.onError = null;
    this.bytesOut = 0;

    peer.on('connection', (conn) => this._accept(conn));
    peer.on('disconnected', () => {
      // lost the broker: existing data channels keep working; try to stay joinable
      if (!this.closed && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch {
          /* ignore */
        }
      }
    });
    peer.on('error', (err) => {
      if (this.onError) this.onError(brokerError(err) ? MSG.broker : (err && err.message) || String(err));
    });
  }

  get players() {
    const out = [{ id: 0, name: this.name, host: true }];
    for (const c of [...this.clients.values()].sort((a, b) => a.id - b.id)) out.push({ id: c.id, name: c.name, host: false });
    return out;
  }

  lobbyInfo() {
    return { code: this.code, link: this.link, players: this.players, fill: this.fill, max: MAX_HUMANS, started: this.started };
  }

  onLobby(fn) {
    this._lobbyFns.push(fn);
  }

  _lobbyChanged() {
    const info = this.lobbyInfo();
    for (const fn of this._lobbyFns) fn(info);
    this.broadcast({ t: 'lobby', players: info.players, fill: info.fill, max: info.max });
  }

  setFill(on) {
    this.fill = !!on;
    this._lobbyChanged();
  }

  _freeId() {
    for (let i = 1; i < MAX_HUMANS; i++) if (![...this.clients.values()].some((c) => c.id === i)) return i;
    return -1;
  }

  _accept(conn) {
    let c = this._byPeer.get(conn.peer);
    if (!c) {
      c = { id: -1, name: '', peer: conn.peer, r: null, u: null, bytesOut: 0, bytesIn: 0, joined: false, reasm: makeReassembler() };
      this._byPeer.set(conn.peer, c);
    }
    if (conn.label === 'u') {
      c.u = conn;
      conn.on('data', (buf) => {
        if (!c.joined || !(buf instanceof ArrayBuffer)) return;
        c.bytesIn += buf.byteLength;
        if (this.onState) this.onState(c, buf);
      });
      conn.on('close', () => {
        if (c.u === conn) c.u = null;
      });
      return;
    }
    c.r = conn;
    conn.on('data', (raw) => {
      c.bytesIn += JSON.stringify(raw).length;
      const msg = c.reasm(raw);
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'hello') this._hello(c, msg);
      else if (c.joined && this.onMessage) this.onMessage(c, msg);
    });
    conn.on('close', () => this._drop(c));
    conn.on('error', () => this._drop(c));
  }

  _hello(c, msg) {
    const reject = (reason) => {
      sendJSON(c.r, { t: 'reject', reason });
      setTimeout(() => c.r && c.r.close(), 400);
      this._byPeer.delete(c.peer);
    };
    if (msg.v !== PROTO_VERSION) return reject('version');
    if (this.started) return reject('started');
    const id = this._freeId();
    if (id < 0 || this.clients.size >= MAX_HUMANS - 1) return reject('full');
    c.id = id;
    c.name = cleanName(msg.name);
    c.joined = true;
    this.clients.set(id, c);
    this.sendTo(id, { t: 'welcome', id, code: this.code });
    this._lobbyChanged();
  }

  _drop(c) {
    if (c.dropped) return;
    c.dropped = true;
    this._byPeer.delete(c.peer);
    if (!c.joined) return;
    this.clients.delete(c.id);
    if (c.u) c.u.close();
    if (this.onLeave) this.onLeave(c);
    if (!this.closed) this._lobbyChanged();
  }

  kick(id) {
    const c = this.clients.get(id);
    if (c && c.r) c.r.close();
  }

  sendTo(id, msg) {
    const c = this.clients.get(id);
    if (!c || !c.r || !c.r.open) return 0;
    const n = sendJSON(c.r, msg);
    c.bytesOut += n;
    this.bytesOut += n;
    return n;
  }

  broadcast(msg) {
    let n = 0;
    for (const id of this.clients.keys()) n += this.sendTo(id, msg);
    return n;
  }

  sendRawTo(id, buf) {
    const c = this.clients.get(id);
    if (!c || !c.u || !c.u.open) return 0;
    c.u.send(buf);
    c.bytesOut += buf.byteLength;
    this.bytesOut += buf.byteLength;
    return buf.byteLength;
  }

  broadcastRaw(buf) {
    for (const id of this.clients.keys()) this.sendRawTo(id, buf);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.broadcast({ t: 'bye', reason: 'host-left' });
    const peer = this.peer;
    // let the goodbye flush before tearing the channels down
    setTimeout(() => {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    }, 150);
  }
}

// ------------------------------------------------------------------ client

export function joinRoom(rawCode, { name }) {
  const code = normalizeCode(rawCode);
  if (!validCode(code)) return Promise.reject(new Error(MSG.badCode));
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, peerOptions());
    let settled = false;
    const fail = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(text));
    };
    const timer = setTimeout(() => fail(peer.open ? MSG.timeout : MSG.broker), OPEN_MS);
    peer.on('error', (err) => {
      if (settled) {
        return;
      }
      if (err && err.type === 'peer-unavailable') fail(MSG.notFound(code));
      else if (brokerError(err)) fail(MSG.broker);
      else fail((err && err.message) || MSG.broker);
    });
    peer.on('open', () => {
      const target = PEER_PREFIX + code;
      const r = peer.connect(target, { label: 'r', reliable: true, serialization: 'json' });
      const reasm = makeReassembler();
      const conn = new ClientConn(peer, code, r);
      r.on('open', () => {
        sendJSON(r, { t: 'hello', v: PROTO_VERSION, name: cleanName(name) });
      });
      r.on('data', (raw) => {
        conn.bytesIn += JSON.stringify(raw).length;
        const msg = reasm(raw);
        if (!msg) return;
        if (!settled) {
          if (msg.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            conn.id = msg.id;
            conn._openRaw(target);
            resolve(conn);
          } else if (msg.t === 'reject') fail(MSG[msg.reason] || 'The host refused the connection.');
          return;
        }
        conn._handle(msg);
      });
      r.on('close', () => {
        if (!settled) fail(MSG.timeout);
        else conn._closed(MSG.hostLeft);
      });
      r.on('error', () => {
        if (!settled) fail(MSG.timeout);
      });
    });
  });
}

class ClientConn {
  constructor(peer, code, r) {
    this.peer = peer;
    this.code = code;
    this.r = r;
    this.u = null;
    this.id = -1;
    this.players = [];
    this.fill = true;
    this.max = MAX_HUMANS;
    this.closed = false;
    this.bytesOut = 0;
    this.bytesIn = 0;
    this.onLobby = null;
    this.onStart = null;
    this.onMessage = null;
    this.onRaw = null;
    this.onClose = null;
    peer.on('disconnected', () => {
      // the broker dropped us; the data channels to the host keep working
    });
  }

  _openRaw(target) {
    const u = this.peer.connect(target, { label: 'u', reliable: false, serialization: 'raw' });
    this.u = u;
    u.on('data', (buf) => {
      if (!(buf instanceof ArrayBuffer)) return;
      this.bytesIn += buf.byteLength;
      if (this.onRaw) this.onRaw(buf);
    });
  }

  _handle(msg) {
    if (msg.t === 'lobby') {
      this.players = msg.players || [];
      this.fill = !!msg.fill;
      this.max = msg.max || MAX_HUMANS;
      if (this.onLobby) this.onLobby(this.lobbyInfo());
    } else if (msg.t === 'start') {
      if (this.onStart) this.onStart(msg);
    } else if (msg.t === 'bye') {
      this._closed(MSG.hostLeft);
    } else if (this.onMessage) this.onMessage(msg);
  }

  lobbyInfo() {
    return { code: this.code, link: shareLink(this.code), players: this.players, fill: this.fill, max: this.max, you: this.id };
  }

  send(msg) {
    if (this.closed) return 0;
    const n = sendJSON(this.r, msg);
    this.bytesOut += n;
    return n;
  }

  sendRaw(buf) {
    if (this.closed || !this.u || !this.u.open) return 0;
    this.u.send(buf);
    this.bytesOut += buf.byteLength;
    return buf.byteLength;
  }

  _closed(reason) {
    if (this.closed) return;
    this.closed = true;
    try {
      this.peer.destroy();
    } catch {
      /* ignore */
    }
    if (this.onClose) this.onClose(reason);
  }

  /** Leave on purpose (no "host left" message). */
  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      sendJSON(this.r, { t: 'leave' });
    } catch {
      /* ignore */
    }
    const peer = this.peer;
    setTimeout(() => {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    }, 100);
  }
}

export { MAX_HUMANS, normalizeCode, validCode };
