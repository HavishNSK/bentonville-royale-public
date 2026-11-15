// BENTONVILLE ROYALE — multiplayer rooms over a PartyKit WebSocket relay.
//
// Lazy-loaded by src/main.js only when the player picks Host or Join, so solo
// play never downloads net code. Everyone (host and guests) opens one
// WebSocket to the relay in party/server.js; the relay routes frames between
// the host and its guests and does no game logic (the host runs the match).
//
// Relay address: ?party=host:port (page URL) > VITE_PARTYKIT_HOST > localhost:1999.
// ws:// is used for localhost / LAN addresses, wss:// for everything else.
//
//   const room = await hostRoom({ name })          -> HostRoom
//   const conn = await joinRoom(code, { name })     -> ClientConn (rejects with a readable Error)
//
// HostRoom
//   code, link, players -> [{ id, name, host }], fill (bots on/off), started
//   setFill(on), onLobby(fn), close()
//   clients: Map<id, Client>; Client = { id, name, bytesOut, bytesIn }
//   sendTo(id, msg) / broadcast(msg) (JSON) / sendRawTo(id, buf) / broadcastRaw(buf)
//   handlers for the match: onMessage(client, msg), onState(client, buf), onLeave(client)
// ClientConn
//   id (slot; host = 0), code, players, fill, send(msg), sendRaw(buf), close()
//   onLobby(info), onStart(msg), onMessage(msg), onRaw(buf), onClose(reason)
//
// Everything travels over one ordered, reliable WebSocket (no separate
// unreliable channel); see party/server.js for the frame routing format.

import { PROTO_VERSION, MAX_HUMANS, randomCode, normalizeCode, validCode, makeReassembler } from './protocol.js';

const OPEN_MS = 12000;
const CHUNK = 256 * 1024; // chars per text frame; PartyKit's frame limit is 1 MB
const BROADCAST = 255;

export const MSG = {
  broker: 'Could not reach the multiplayer server. Check your connection and try again.',
  notFound: (c) => `No room with code ${c}. Check the code and that the host is still in the lobby.`,
  full: `That room is full (${MAX_HUMANS} players).`,
  started: 'That match has already started.',
  version: 'That room runs a different version of the game. Refresh and try again.',
  badCode: 'Room codes are 4 letters, like ABCD.',
  hostLeft: 'Host left the match.',
  kicked: 'You were removed from the match.',
  timeout: 'The host did not answer. Try again in a moment.',
};

function rejectText(reason, code) {
  const m = MSG[reason];
  if (typeof m === 'function') return m(code);
  return m || 'The host refused the connection.';
}

/** Relay host:port: ?party= override, then VITE_PARTYKIT_HOST, then the local dev server. */
export function partyHost() {
  let spec = '';
  try {
    spec = new URLSearchParams(location.search).get('party') || '';
  } catch {
    /* no location */
  }
  if (!spec && import.meta.env && import.meta.env.VITE_PARTYKIT_HOST) spec = import.meta.env.VITE_PARTYKIT_HOST;
  return (spec || 'localhost:1999').replace(/^\w+:\/\//, '').replace(/\/+$/, '');
}

function isLocal(host) {
  const h = host.split(':')[0];
  return h === 'localhost' || h === '0.0.0.0' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
}

function roomUrl(code, role, name) {
  const host = partyHost();
  const scheme = isLocal(host) ? 'ws' : 'wss';
  const q = new URLSearchParams({ role, v: String(PROTO_VERSION), name });
  return `${scheme}://${host}/parties/main/${code}?${q}`;
}

function openSocket(url) {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  return ws;
}

/** JSON message -> text frames (chunked in the protocol.js '_c' format if huge). */
function frames(msg) {
  const s = JSON.stringify(msg);
  if (s.length <= CHUNK) return [s];
  const id = (frames._id = (frames._id || 0) + 1);
  const n = Math.ceil(s.length / CHUNK);
  const out = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ t: '_c', id, i, n, s: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  return out;
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Share link for a room code (same page, ?room=CODE; keeps a ?party= override). */
export function shareLink(code) {
  const u = new URL(location.href);
  const keep = u.searchParams.get('party');
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  if (keep) u.searchParams.set('party', keep);
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
  const who = cleanName(name);
  return new Promise((resolve, reject) => {
    let tries = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(MSG.broker));
    }, OPEN_MS);
    const attempt = () => {
      const code = randomCode();
      let ws;
      try {
        ws = openSocket(roomUrl(code, 'host', who));
      } catch {
        settled = true;
        clearTimeout(timer);
        reject(new Error(MSG.broker));
        return;
      }
      let ready = false;
      ws.onmessage = (ev) => {
        if (ready || settled || typeof ev.data !== 'string' || !ev.data.startsWith('@:')) return;
        const msg = parse(ev.data.slice(2));
        if (!msg) return;
        if (msg.t === 'ready') {
          ready = true;
          settled = true;
          clearTimeout(timer);
          resolve(new HostRoom(ws, code, who));
        } else if (msg.t === 'taken') {
          ws.onclose = null;
          ws.close();
          if (tries++ < 5) attempt();
          else {
            settled = true;
            clearTimeout(timer);
            reject(new Error(MSG.broker));
          }
        }
      };
      ws.onclose = () => {
        if (ready || settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(MSG.broker));
      };
    };
    attempt();
  });
}

class HostRoom {
  constructor(ws, code, name) {
    this.ws = ws;
    this.code = code;
    this.link = shareLink(code);
    this.name = name;
    this.fill = true;
    this._started = false;
    this.closed = false;
    this.clients = new Map(); // slot id -> client
    this._lobbyFns = [];
    this.onMessage = null;
    this.onState = null;
    this.onLeave = null;
    this.onError = null;
    this.bytesOut = 0;

    ws.onmessage = (ev) => this._frame(ev.data);
    ws.onclose = () => {
      if (this.closed) return;
      this.closed = true;
      for (const c of [...this.clients.values()]) this._drop(c.id);
      if (this.onError) this.onError('Lost the connection to the multiplayer server.');
    };
  }

  /** Setting `started` (HostSession does at match start) closes the room to new joins. */
  get started() {
    return this._started;
  }

  set started(on) {
    on = !!on;
    if (on === this._started) return;
    this._started = on;
    this._ctl({ t: 'started', on });
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

  _send(data) {
    if (this.closed || this.ws.readyState !== 1) return false;
    this.ws.send(data);
    return true;
  }

  _ctl(msg) {
    this._send('@:' + JSON.stringify(msg));
  }

  _frame(data) {
    if (typeof data !== 'string') {
      // binary: [from u8][payload]
      if (!(data instanceof ArrayBuffer) || data.byteLength < 2) return;
      const from = new Uint8Array(data, 0, 1)[0];
      const c = this.clients.get(from);
      if (!c) return;
      const buf = data.slice(1);
      c.bytesIn += buf.byteLength;
      if (this.onState) this.onState(c, buf);
      return;
    }
    const i = data.indexOf(':');
    if (i < 0) return;
    const from = data.slice(0, i);
    const body = data.slice(i + 1);
    if (from === '@') {
      const msg = parse(body);
      if (!msg) return;
      if (msg.t === 'join') this._join(msg.id, msg.name);
      else if (msg.t === 'leave') this._drop(msg.id);
      return;
    }
    const c = this.clients.get(Number(from));
    if (!c) return;
    c.bytesIn += body.length;
    const msg = c.reasm(parse(body));
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'leave') return this.kick(c.id);
    if (this.onMessage) this.onMessage(c, msg);
  }

  _join(id, name) {
    if (this.started) return this._ctl({ t: 'kick', id, reason: 'started' });
    if (this.clients.size >= MAX_HUMANS - 1) return this._ctl({ t: 'kick', id, reason: 'full' });
    const c = { id, name: cleanName(name), bytesOut: 0, bytesIn: 0, reasm: makeReassembler() };
    this.clients.set(id, c);
    this.sendTo(id, { t: 'welcome', id, code: this.code });
    this._lobbyChanged();
  }

  _drop(id) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    if (this.onLeave) this.onLeave(c);
    if (!this.closed) this._lobbyChanged();
  }

  kick(id, reason = 'kicked') {
    if (this.clients.has(id)) this._ctl({ t: 'kick', id, reason });
  }

  sendTo(id, msg) {
    const c = this.clients.get(id);
    if (!c) return 0;
    let n = 0;
    for (const f of frames(msg)) {
      if (!this._send(id + ':' + f)) return n;
      n += f.length;
    }
    c.bytesOut += n;
    this.bytesOut += n;
    return n;
  }

  broadcast(msg) {
    if (!this.clients.size) return 0;
    let n = 0;
    for (const f of frames(msg)) {
      if (!this._send('*:' + f)) return n;
      n += f.length;
    }
    for (const c of this.clients.values()) c.bytesOut += n;
    this.bytesOut += n * this.clients.size;
    return n * this.clients.size;
  }

  _raw(to, buf) {
    const out = new Uint8Array(buf.byteLength + 1);
    out[0] = to;
    out.set(new Uint8Array(buf), 1);
    return this._send(out.buffer);
  }

  sendRawTo(id, buf) {
    const c = this.clients.get(id);
    if (!c || !this._raw(id, buf)) return 0;
    c.bytesOut += buf.byteLength;
    this.bytesOut += buf.byteLength;
    return buf.byteLength;
  }

  broadcastRaw(buf) {
    if (!this.clients.size || !this._raw(BROADCAST, buf)) return;
    for (const c of this.clients.values()) c.bytesOut += buf.byteLength;
    this.bytesOut += buf.byteLength * this.clients.size;
  }

  close() {
    if (this.closed) return;
    this.broadcast({ t: 'bye', reason: 'host-left' });
    this.closed = true;
    const ws = this.ws;
    ws.onclose = null;
    // let the goodbye flush; the relay also tells guests when the host socket closes
    setTimeout(() => {
      try {
        ws.close();
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
    let ws;
    try {
      ws = openSocket(roomUrl(code, 'guest', cleanName(name)));
    } catch {
      reject(new Error(MSG.broker));
      return;
    }
    let settled = false;
    let opened = false;
    const fail = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(text));
    };
    const timer = setTimeout(() => fail(opened ? MSG.timeout : MSG.broker), OPEN_MS);
    const conn = new ClientConn(ws, code);
    const reasm = makeReassembler();
    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        if (settled) conn._raw(ev.data);
        return;
      }
      conn.bytesIn += ev.data.length;
      const msg = reasm(parse(ev.data));
      if (!msg) return;
      if (!settled) {
        if (msg.t === 'welcome') {
          settled = true;
          clearTimeout(timer);
          conn.id = msg.id;
          resolve(conn);
        } else if (msg.t === 'reject') fail(rejectText(msg.reason, code));
        else if (msg.t === 'bye') fail(MSG.hostLeft);
        return;
      }
      conn._handle(msg);
    };
    ws.onclose = (ev) => {
      if (!settled) fail(opened ? MSG.timeout : MSG.broker);
      else conn._closed(ev && ev.code === 4002 ? MSG.kicked : MSG.hostLeft); // 4002 = relay kick
    };
  });
}

class ClientConn {
  constructor(ws, code) {
    this.ws = ws;
    this.code = code;
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
  }

  _raw(buf) {
    if (!(buf instanceof ArrayBuffer)) return;
    this.bytesIn += buf.byteLength;
    if (this.onRaw) this.onRaw(buf);
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
    } else if (msg.t === 'reject') {
      this._closed(rejectText(msg.reason, this.code));
    } else if (this.onMessage) this.onMessage(msg);
  }

  lobbyInfo() {
    return { code: this.code, link: shareLink(this.code), players: this.players, fill: this.fill, max: this.max, you: this.id };
  }

  send(msg) {
    if (this.closed || this.ws.readyState !== 1) return 0;
    let n = 0;
    for (const f of frames(msg)) {
      this.ws.send(f);
      n += f.length;
    }
    this.bytesOut += n;
    return n;
  }

  sendRaw(buf) {
    if (this.closed || this.ws.readyState !== 1) return 0;
    this.ws.send(buf);
    this.bytesOut += buf.byteLength;
    return buf.byteLength;
  }

  _closed(reason) {
    if (this.closed) return;
    this.closed = true;
    this.ws.onclose = null;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    if (this.onClose) this.onClose(reason);
  }

  /** Leave on purpose (no "host left" message). */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.ws.onclose = null;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export { MAX_HUMANS, normalizeCode, validCode };
