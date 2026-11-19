// BENTONVILLE ROYALE — client for Box Fights custom lobbies (server: party/lobbyRoom.js, list:
// party/lobbyIndex.js, rules: party/lobbyRules.js). No UI here; screens subscribe to the events.
// Same server address as Net.js / Party.js (?party= > VITE_PARTYKIT_HOST > localhost:1999).
// Bots-only offline play needs none of this.
//
//   const list = await listLobbies()                       // HTTP GET; [{code,name,mode,players,max,state,full}]
//   const lb = await createLobby({ name, look, settings })  // settings: {type,mode,maxPlayers,fillWithBots,botDifficulty,roundsToWin}
//   const lb = await joinLobby(code, { name, look })        // rejects Error('Lobby not found' | 'Lobby is full' | 'Match already started' | ...)
//
//   lb.code, lb.you, lb.lobby (last lobbyUpdate), lb.isHost, lb.token
//   lb.list() switchTeam(team) updateSettings(partial) kick(playerId) start() backToLobby()
//   lb.reportResult({ score, final?, winner? })   host's game at round end (final:false) and match end
//   lb.leave()                                    leave on purpose (no onClose)
//   events (assign functions):
//     onUpdate(lobby)  onList(list)  onError(message)  onCountdown(seconds)
//     onMatchStart({ you, relayCode, hostId, mode, maxPlayers, roundsToWin, botDifficulty, seed, slots, hostToken?, tokens? })
//     onHostMigrate({ you, newHostId, relayCode, slots, hostToken?, tokens? })
//     onRoundEnd(score)  onMatchEnd({ winner, score })
//     onClose(reason)    'kicked' | 'lost' | 'replaced'
//
// matchStart hand-off: the host (hostToken present) calls Net.js hostRoom({ name, code: relayCode });
// guests call joinRoom(relayCode, { name, token: lb.token, retryMs }) (the host may arrive later).
// A dropped socket while waiting reconnects with the same token (the server holds the slot 15 s).
// Everything received is untrusted display data.

import { partyUrl, partyHost, isLocal, cleanName } from './Net.js';
import { partyToken } from './Party.js';
import { normalizeLobbyCode, validLobbyCode, randomLobbyCode } from '../../party/lobbyRules.js';

const OPEN_MS = 8000;
const RETRY_DELAYS = [1000, 2000, 4000, 6000]; // inside the server's 15 s away window
export const LOBBY_MSG = {
  offline: 'Could not reach the lobby server.',
  badCode: 'Lobby codes are 6 characters, like BNTV42.',
};

/** Public lobbies from the index (waiting ones first; `full` rows can be greyed out). */
export async function listLobbies() {
  const host = partyHost();
  const res = await fetch(`${isLocal(host) ? 'http' : 'https'}://${host}/parties/lobby-index/index`, { cache: 'no-store' });
  if (!res.ok) throw new Error(LOBBY_MSG.offline);
  const body = await res.json();
  return cleanList(body && body.list);
}

function cleanList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 50).map((e) => ({
    code: validLobbyCode(e && e.code) ? e.code : '',
    name: cleanName(e && e.name),
    mode: String((e && e.mode) || ''),
    players: Number.isInteger(e && e.players) ? e.players : 0,
    max: Number.isInteger(e && e.max) ? e.max : 0,
    state: String((e && e.state) || ''),
    full: !!(e && e.full),
  })).filter((e) => e.code);
}

export function createLobby({ name, look = '', settings = {} }) {
  let tries = 0;
  const attempt = () =>
    connect(randomLobbyCode(), { name, look }, { t: 'createLobby', settings }).catch((err) => {
      if (err.reason === 'taken' && tries++ < 5) return attempt();
      throw err;
    });
  return attempt();
}

export function joinLobby(code, { name, look = '' }) {
  const c = normalizeLobbyCode(code);
  if (!validLobbyCode(c)) return Promise.reject(new Error(LOBBY_MSG.badCode));
  return connect(c, { name, look }, { t: 'joinLobby', code: c });
}

/** Open a socket, send the hello, resolve on the first lobbyUpdate. */
function openSocket(code, query, hello) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(partyUrl('lobby', code, query));
    } catch {
      reject(Object.assign(new Error(LOBBY_MSG.offline), { reason: 'offline' }));
      return;
    }
    let settled = false;
    let refusal = null;
    const fail = (text, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onclose = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(Object.assign(new Error(text), { reason }));
    };
    const timer = setTimeout(() => fail(LOBBY_MSG.offline, 'offline'), OPEN_MS);
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.t === 'error') refusal = String(msg.message || '').slice(0, 200);
      else if (msg.t === 'lobbyUpdate' && msg.lobby) {
        settled = true;
        clearTimeout(timer);
        ws.onmessage = ws.onclose = null;
        resolve({ ws, first: msg });
      }
    };
    ws.onclose = (ev) => fail(refusal || LOBBY_MSG.offline, ev && ev.code === 4001 ? 'taken' : refusal ? 'refused' : 'offline');
  });
}

async function connect(code, { name, look }, hello) {
  const query = { name: cleanName(name), token: partyToken(), look: String(look || '').slice(0, 96) };
  const { ws, first } = await openSocket(code, query, hello);
  const lb = new LobbyConn(code, query);
  lb._attach(ws);
  lb._handle(first);
  return lb;
}

class LobbyConn {
  constructor(code, query) {
    this.code = code;
    this.token = query.token;
    this._query = query;
    this.you = null;
    this.lobby = null;
    this.closed = false;
    this.onUpdate = null;
    this.onList = null;
    this.onError = null;
    this.onCountdown = null;
    this.onMatchStart = null;
    this.onHostMigrate = null;
    this.onRoundEnd = null;
    this.onMatchEnd = null;
    this.onClose = null;
  }

  get isHost() {
    return !!this.lobby && this.lobby.hostId === this.you;
  }

  _attach(ws) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string') this._handle(msg);
    };
    ws.onclose = (ev) => {
      const code = ev && ev.code;
      if (code === 4002) return this._closed('kicked');
      if (code === 4004) return this._closed('replaced');
      this._reconnect();
    };
  }

  /** Lost the socket: rejoin with the same token while the server still holds the slot. */
  async _reconnect() {
    if (this.closed) return;
    for (const wait of RETRY_DELAYS) {
      await new Promise((r) => setTimeout(r, wait));
      if (this.closed) return;
      try {
        const { ws, first } = await openSocket(this.code, this._query, { t: 'joinLobby', code: this.code });
        if (this.closed) return ws.close();
        this._attach(ws);
        this._handle(first);
        return;
      } catch (err) {
        if (err.reason === 'refused') break; // e.g. the slot became a bot mid-match
      }
    }
    this._closed('lost');
  }

  _handle(msg) {
    const call = (fn, ...a) => {
      if (typeof fn === 'function') fn(...a);
    };
    switch (msg.t) {
      case 'lobbyUpdate':
        if (!msg.lobby || !Array.isArray(msg.lobby.slots)) return;
        this.you = typeof msg.you === 'string' ? msg.you : this.you;
        this.lobby = msg.lobby;
        return call(this.onUpdate, this.lobby);
      case 'lobbyList':
        return call(this.onList, cleanList(msg.list));
      case 'error':
        return call(this.onError, String(msg.message || '').slice(0, 200));
      case 'countdown':
        return call(this.onCountdown, Number(msg.seconds) || 0);
      case 'matchStart':
        return call(this.onMatchStart, msg);
      case 'hostMigrate':
        return call(this.onHostMigrate, msg);
      case 'roundEnd':
        return call(this.onRoundEnd, msg.score || {});
      case 'matchEnd':
        return call(this.onMatchEnd, msg.results || {});
      case 'kicked':
        return this._closed('kicked');
    }
  }

  _send(msg) {
    if (this.closed || !this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  list() {
    return this._send({ t: 'listLobbies' });
  }
  switchTeam(team) {
    return this._send({ t: 'switchTeam', team });
  }
  updateSettings(settings) {
    return this._send({ t: 'updateSettings', settings });
  }
  kick(playerId) {
    return this._send({ t: 'kick', playerId });
  }
  start() {
    return this._send({ t: 'startMatch' });
  }
  backToLobby() {
    return this._send({ t: 'backToLobby' });
  }
  reportResult(result) {
    return this._send({ t: 'reportResult', result });
  }

  _closed(reason) {
    if (this.closed) return;
    this.closed = true;
    if (this.ws) {
      this.ws.onclose = this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    if (typeof this.onClose === 'function') this.onClose(reason);
  }

  /** Leave on purpose (no onClose). */
  leave() {
    if (this.closed) return;
    this._send({ t: 'leaveLobby' });
    this.closed = true;
    const ws = this.ws;
    if (ws) ws.onclose = ws.onmessage = null;
    setTimeout(() => {
      try {
        ws && ws.close();
      } catch {
        /* ignore */
      }
    }, 100);
  }
}
