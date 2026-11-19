// BENTONVILLE ROYALE — Box Fights custom lobby (PartyServer Durable Object). One room per
// 6-character lobby code (party/lobbyRules.js LOBBY_CODE_ALPHABET: no 0 O 1 I L). This class is
// a thin shell: every decision is a pure function in party/lobbyRules.js.
//
// The lobby only decides who is in and on which team. The match itself still runs in the HOST'S
// BROWSER over the existing relay (party/server.js Main, 4-letter relay code): on matchStart the
// host opens that relay room and the guests join it with their party tokens.
// Lobby codes and room membership are joining conveniences, not authentication or anti-cheat.
//
// Connect:  /parties/lobby/<CODE>?name=&token=&look=     (then send createLobby or joinLobby)
//   token: the tab's party token (src/net/Party.js partyToken); same token = same player
//   (a refresh reclaims the slot). look: Cosmetics.lookString, cosmetic only.
//
// MESSAGE TABLE (JSON text frames {t, ...}; unknown fields are ignored)
//   client -> server
//     {t:'createLobby', settings}        settings: {type, mode, maxPlayers, fillWithBots, botDifficulty, roundsToWin}
//     {t:'joinLobby', code}              code must be this room's code
//     {t:'listLobbies'}                  -> lobbyList (also GET /parties/lobby-index/index)
//     {t:'leaveLobby'}
//     {t:'switchTeam', team}             0 | 1, waiting only
//     {t:'updateSettings', settings}     host, waiting only (partial settings)
//     {t:'kick', playerId}               host
//     {t:'startMatch'}                   host, waiting -> countdown
//     {t:'backToLobby'}                  host, results -> waiting
//     {t:'reportResult', result}         host's browser, playing; result {score, final?, winner?}
//                                        final:false -> roundEnd; otherwise -> matchEnd + results
//   server -> client
//     {t:'lobbyUpdate', you, lobby}      lobby = publicLobby() (party/lobbyRules.js)
//     {t:'lobbyList', list}
//     {t:'error', message}               exact copy: "Lobby not found", "Lobby is full",
//                                        "Match already started" (then the socket closes, 4000)
//     {t:'countdown', seconds}           5, 4, 3, 2, 1
//     {t:'matchStart', you, relayCode, hostId, mode, maxPlayers, roundsToWin, botDifficulty, seed,
//                      slots, hostToken*, tokens*}               (* host only)
//     {t:'hostMigrate', you, newHostId, relayCode, slots, hostToken*, tokens*}  (* new host only)
//     {t:'roundEnd', score}
//     {t:'matchEnd', results:{winner, score}}
//     {t:'kicked'} then close 4002
// Close codes: 4000 refused, 4001 code taken (client retries with a new code), 4002 kicked,
//              4003 origin, 4004 replaced by a newer tab with the same token, 4008 flooding.
//
// Disconnects: waiting/results -> the slot is held AWAY_MS for a refresh, then freed.
// countdown/playing -> the slot becomes a bot at once (same team). The host leaving mid-match
// passes host to the next human in join order, the lobby stays 'playing', everyone gets
// hostMigrate and the relay room is told which token takes over (party/relayMigration.js).

import { Server, getServerByName } from 'partyserver';
import { randomCode } from '../src/net/protocol.js';
import { originAllowed } from './authLimits.js';
import { cleanRelayToken } from './relayMigration.js';
import { INDEX_ROOM } from './lobbyIndex.js';
import {
  ERR, COUNTDOWN_SECONDS, normalizeLobbyCode, validLobbyCode, cleanLobbyName, cleanLookString,
  createLobby, joinLobby, leaveLobby, switchTeam, updateSettings, kickPlayer, startMatch, beginPlaying,
  matchStartPayload, hostMigratePayload, reportResult, backToLobby, publicLobby, indexEntry,
} from './lobbyRules.js';

const MAX_CONNECTIONS = 12; // 6 players plus refreshes / lookers
const MAX_MSG = 2048; // characters per frame
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 20; // frames per window; more are dropped
const RATE_KILL = 60; // ...and this many closes the socket (4008)
const HELLO_MS = 10000; // createLobby / joinLobby must arrive this soon
const AWAY_MS = 15000;
const HEARTBEAT_MS = 30000; // index refresh (the index drops rows after 60 s)

const rand32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
const rng = () => rand32() / 2 ** 32;
const newPid = () => 'p' + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

async function ownerKey(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('lobby:' + ip));
  return Array.from(new Uint8Array(d).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Lobby extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.lobby = null;
    this.peers = new Map(); // connection id -> {pid, name, token, look, ip, times[], helloTimer}
    this.pidConn = new Map(); // player id -> connection id
    this.away = new Map(); // player id -> timer
    this.creating = false;
    this.countdownTimer = null;
    this.heartbeat = null;
  }

  // ---------------------------------------------------------------- plumbing

  _send(conn, msg) {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* gone */
    }
  }

  _sendPid(pid, msg) {
    const c = this.pidConn.get(pid) && this.getConnection(this.pidConn.get(pid));
    if (c) this._send(c, msg);
  }

  _close(conn, code, reason) {
    try {
      conn.close(code, reason);
    } catch {
      /* gone */
    }
  }

  _refuse(conn, message, code = 4000) {
    this._send(conn, { t: 'error', message });
    this._close(conn, code, 'refused');
  }

  _humans() {
    return this.lobby ? this.lobby.slots.filter((s) => s.kind === 'human') : [];
  }

  _broadcastUpdate() {
    if (!this.lobby) return;
    const lobby = publicLobby(this.lobby);
    for (const s of this._humans()) this._sendPid(s.id, { t: 'lobbyUpdate', you: s.id, lobby });
  }

  _broadcast(msg) {
    for (const s of this._humans()) this._sendPid(s.id, msg);
  }

  async _index(body) {
    const stub = await getServerByName(this.env.LobbyIndex, INDEX_ROOM);
    const res = await stub.fetch(new Request('https://lobby-index/' + INDEX_ROOM, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    if (!res.ok) throw new Error('index ' + res.status);
    return res.json();
  }

  _publishIndex() {
    if (!this.lobby) return;
    this._index({ t: 'upsert', entry: indexEntry(this.lobby) }).catch((e) => console.warn('[lobby] index upsert failed', e && e.message));
  }

  _relay(code, body) {
    if (!code) return;
    getServerByName(this.env.Main, code)
      .then((s) => s.fetch(new Request('https://main/' + code, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })))
      .catch((e) => console.warn('[lobby] relay notice failed', e && e.message));
  }

  /** Take a rules result: store it, tell everyone, refresh the index. */
  _apply(result) {
    if (result.closed) return this._shutdown();
    this.lobby = result.lobby;
    if (result.hostMigrated) {
      const host = this.lobby.slots.find((s) => s.id === this.lobby.hostId);
      this._relay(this.lobby.relayCode, { t: 'promote', token: host ? host.token : '' });
      for (const s of this._humans()) this._sendPid(s.id, hostMigratePayload(this.lobby, s.id));
    }
    if (this.lobby.state !== 'countdown') this._stopCountdown();
    this._broadcastUpdate();
    this._publishIndex();
  }

  _shutdown() {
    const code = (this.lobby && this.lobby.code) || this.name;
    this.lobby = null;
    this._stopCountdown();
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const t of this.away.values()) clearTimeout(t);
    this.away.clear();
    this.pidConn.clear();
    this._index({ t: 'remove', code }).catch(() => {});
  }

  _stopCountdown() {
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  _runCountdown() {
    this._stopCountdown();
    let left = COUNTDOWN_SECONDS;
    this._broadcast({ t: 'countdown', seconds: left });
    this.countdownTimer = setInterval(() => {
      if (!this.lobby || this.lobby.state !== 'countdown') return this._stopCountdown();
      left--;
      if (left > 0) return this._broadcast({ t: 'countdown', seconds: left });
      this._stopCountdown();
      const ctx = { relayCode: randomCode(rng), seed: rand32() };
      const r = beginPlaying(this.lobby, ctx);
      if (r.error) return;
      this.lobby = r.lobby;
      this._relay(ctx.relayCode, { t: 'lobby' }); // this relay room may migrate its host
      for (const s of this._humans()) this._sendPid(s.id, matchStartPayload(this.lobby, ctx, s.id));
      this._broadcastUpdate();
      this._publishIndex();
    }, 1000);
  }

  /** Per-connection flood guard. false = drop this frame. */
  _rateOk(conn, peer) {
    const now = Date.now();
    peer.times = peer.times.filter((t) => now - t < RATE_WINDOW_MS);
    peer.times.push(now);
    if (peer.times.length > RATE_KILL) {
      this._close(conn, 4008, 'flood');
      return false;
    }
    if (peer.times.length > RATE_MAX) {
      if (peer.times.length === RATE_MAX + 1) this._send(conn, { t: 'error', message: 'Slow down.' });
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- connections

  onConnect(conn, ctx) {
    if (!originAllowed(ctx.request.headers.get('origin'), this.env && this.env.ALLOWED_ORIGINS)) return this._close(conn, 4003, 'origin');
    if (!validLobbyCode(this.name) || this.peers.size >= MAX_CONNECTIONS) return this._refuse(conn, ERR.notFound);
    const url = new URL(ctx.request.url);
    const peer = {
      pid: null,
      name: cleanLobbyName(url.searchParams.get('name')),
      token: cleanRelayToken(url.searchParams.get('token')),
      look: cleanLookString(url.searchParams.get('look')),
      ip: (ctx.request.headers.get('cf-connecting-ip') || 'local').slice(0, 64),
      times: [],
      helloTimer: null,
    };
    peer.helloTimer = setTimeout(() => {
      if (!peer.pid) this._close(conn, 4000, 'idle');
    }, HELLO_MS);
    this.peers.set(conn.id, peer);
  }

  onClose(conn) {
    const peer = this.peers.get(conn.id);
    this.peers.delete(conn.id);
    if (!peer) return;
    clearTimeout(peer.helloTimer);
    const pid = peer.pid;
    if (!pid || this.pidConn.get(pid) !== conn.id) return; // never joined, or replaced by a newer tab
    this.pidConn.delete(pid);
    if (!this.lobby) return;
    if (this.lobby.state === 'countdown' || this.lobby.state === 'playing') return this._apply(leaveLobby(this.lobby, pid));
    clearTimeout(this.away.get(pid));
    this.away.set(
      pid,
      setTimeout(() => {
        this.away.delete(pid);
        if (this.lobby && !this.pidConn.has(pid)) this._apply(leaveLobby(this.lobby, pid));
      }, AWAY_MS)
    );
  }

  onError(conn) {
    this.onClose(conn);
  }

  _seat(conn, peer, pid) {
    clearTimeout(peer.helloTimer);
    clearTimeout(this.away.get(pid));
    this.away.delete(pid);
    const prev = this.pidConn.get(pid);
    peer.pid = pid;
    this.pidConn.set(pid, conn.id);
    if (prev && prev !== conn.id) {
      const old = this.getConnection(prev);
      if (old) this._close(old, 4004, 'replaced');
    }
    if (!this.heartbeat) this.heartbeat = setInterval(() => this._publishIndex(), HEARTBEAT_MS);
  }

  async _create(conn, peer, settings) {
    if (this.lobby || this.creating) return this._refuse(conn, 'That lobby code is in use.', 4001);
    this.creating = true;
    try {
      const owner = await ownerKey(peer.ip);
      let claim = { ok: true };
      try {
        claim = await this._index({ t: 'claim', code: this.name, owner });
      } catch (e) {
        // The code is this Durable Object's own name, so it cannot collide even without the index;
        // only the public list and the per-creator cap are skipped while the index is unreachable.
        console.warn('[lobby] index claim failed', e && e.message);
      }
      if (!claim.ok) {
        if (claim.error === 'limit') return this._refuse(conn, 'You have too many open lobbies.');
        return this._refuse(conn, 'That lobby code is in use.', 4001);
      }
      if (this.lobby || !this.peers.has(conn.id)) return this._refuse(conn, 'That lobby code is in use.', 4001);
      const pid = newPid();
      const r = createLobby({ code: this.name, settings, player: { id: pid, name: peer.name, token: peer.token, look: peer.look } });
      if (r.error) {
        this._index({ t: 'remove', code: this.name }).catch(() => {});
        return this._refuse(conn, r.error);
      }
      this._seat(conn, peer, pid);
      this._apply(r);
    } finally {
      this.creating = false;
    }
  }

  _join(conn, peer, code) {
    if (normalizeLobbyCode(code) !== this.name || !this.lobby) return this._refuse(conn, ERR.notFound);
    const r = joinLobby(this.lobby, { id: newPid(), name: peer.name, token: peer.token, look: peer.look });
    if (r.error) return this._refuse(conn, r.error);
    this._seat(conn, peer, r.id);
    this._apply(r);
    // a refresh mid-match gets the start message again so it can rejoin the relay room
    if (r.reclaimed && this.lobby.state === 'playing') this._send(conn, matchStartPayload(this.lobby, {}, r.id));
  }

  async _list(conn) {
    try {
      const stub = await getServerByName(this.env.LobbyIndex, INDEX_ROOM);
      const res = await stub.fetch(new Request('https://lobby-index/' + INDEX_ROOM, { method: 'GET' }));
      const body = await res.json();
      this._send(conn, { t: 'lobbyList', list: Array.isArray(body.list) ? body.list : [] });
    } catch {
      this._send(conn, { t: 'error', message: 'Could not load lobbies.' });
    }
  }

  // ---------------------------------------------------------------- messages

  onMessage(conn, message) {
    const peer = this.peers.get(conn.id);
    if (!peer || typeof message !== 'string' || message.length > MAX_MSG) return;
    if (!this._rateOk(conn, peer)) return;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (msg.t === 'listLobbies') return void this._list(conn);
    if (!peer.pid) {
      if (msg.t === 'createLobby') return void this._create(conn, peer, msg.settings);
      if (msg.t === 'joinLobby') return this._join(conn, peer, msg.code);
      return;
    }
    if (!this.lobby) return;
    const pid = peer.pid;
    const run = (r) => {
      if (r.error) return this._send(conn, { t: 'error', message: r.error });
      if (r.changed === false) return;
      this._apply(r);
    };

    switch (msg.t) {
      case 'leaveLobby': {
        this.pidConn.delete(pid);
        peer.pid = null;
        this._apply(leaveLobby(this.lobby, pid));
        return this._close(conn, 1000, 'left');
      }
      case 'switchTeam':
        return run(switchTeam(this.lobby, pid, msg.team));
      case 'updateSettings':
        return run(updateSettings(this.lobby, pid, msg.settings));
      case 'kick': {
        const target = typeof msg.playerId === 'string' ? msg.playerId.slice(0, 32) : '';
        const r = kickPlayer(this.lobby, pid, target);
        if (r.error) return run(r);
        const cid = this.pidConn.get(target);
        this.pidConn.delete(target);
        clearTimeout(this.away.get(target));
        this.away.delete(target);
        const c = cid && this.getConnection(cid);
        if (c) {
          const p = this.peers.get(cid);
          if (p) p.pid = null;
          this._send(c, { t: 'kicked' });
          this._close(c, 4002, 'kicked');
        }
        return this._apply(r);
      }
      case 'startMatch': {
        const r = startMatch(this.lobby, pid);
        if (r.error) return run(r);
        this._apply(r);
        return this._runCountdown();
      }
      case 'backToLobby':
        return run(backToLobby(this.lobby, pid));
      case 'reportResult': {
        const r = reportResult(this.lobby, pid, msg.result);
        if (r.error) return run(r);
        if (r.event === 'roundEnd') this._broadcast({ t: 'roundEnd', score: r.payload.score });
        else this._broadcast({ t: 'matchEnd', results: r.payload });
        return this._apply(r);
      }
    }
  }

  async onRequest() {
    // Lobby state is only served over the socket; POSTs are refused at the Worker (party/server.js).
    return new Response('Not found', { status: 404 });
  }
}
