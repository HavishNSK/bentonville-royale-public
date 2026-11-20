// BENTONVILLE ROYALE — client side of the party system (server: party/partyRoom.js).
//
// Everyone sits in a party on the title screen (a party of one by default).
// Uses the same relay host as Net.js (?party= / VITE_PARTYKIT_HOST / localhost:1999).
// Party invite links use ?p=CODE (?party= is already the relay host override).
//
//   const p = await openParty({ name, code?, game?, mode?, fill?, skin? })  // code: join that party; none: make one
//     game ('br' | 'boxfights', default 'br') is only sent when creating; a join takes the party's game.
//   p.code, p.token, p.you, p.party = { code, leaderId, game, mode, fill, state, queuedFor, members:[{id,name,ready,leader}] }
//     party.game is 'br' when an older server leaves it out.
//   p.isLeader, p.me
//   p.onState(party), p.onMatch({ code, hostToken, teams:[{tokens, allowBots}], mode, game }), p.onNotice(text, isError)
//   p.onClose(reason)   reason: 'kicked' | 'lost'
//   p.ready(on), p.setName(n), p.setGame(g), p.setMode(m), p.setFill(on), p.kick(id), p.promote(id), p.play(), p.cancel(), p.leave()

import { partyUrl, cleanName } from './Net.js';
import { randomCode, normalizeCode, validCode } from './protocol.js';
import { normalizeGame } from '../game/GameModes.js';

const OPEN_MS = 8000;
const TOKEN_KEY = 'bentonville-royale.partyToken';

export const PARTY_MSG = {
  notFound: (c) => `No party with code ${c}.`,
  full: 'That party is full (4 players).',
  fullBox: 'That Box Fights party is full (4 players).',
  busy: 'That party is in matchmaking. Try again in a moment.',
  badCode: 'Party codes are 4 letters, like ABCD.',
  offline: 'Could not reach the party server.',
  kicked: 'You were removed from the party.',
};

/** Stable random id for this tab (sessionStorage: two tabs are two players). */
export function partyToken() {
  try {
    let t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) {
      t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    if (!partyToken._t) partyToken._t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return partyToken._t;
  }
}

/** Invite link for a party code (?p=CODE; keeps a ?party= relay override). */
export function inviteLink(code) {
  const u = new URL(location.href);
  const keep = u.searchParams.get('party');
  u.search = '';
  u.hash = '';
  u.searchParams.set('p', code);
  if (keep) u.searchParams.set('party', keep);
  return u.toString();
}

/** Party code from the page URL (?p=CODE or ?invite=CODE), or ''. */
export function inviteFromUrl() {
  try {
    const q = new URLSearchParams(location.search);
    const c = normalizeCode(q.get('p') || q.get('invite') || '');
    return validCode(c) ? c : '';
  } catch {
    return '';
  }
}

export function openParty({ name, code = null, game = 'br', mode = 'solo', fill = true, skin = '' }) {
  const token = partyToken();
  if (code) {
    const c = normalizeCode(code);
    if (!validCode(c)) return Promise.reject(new Error(PARTY_MSG.badCode));
    return connectOnce(c, { name: cleanName(name), token, skin: skin || '' }, false);
  }
  let tries = 0;
  const attempt = () =>
    connectOnce(randomCode(), { name: cleanName(name), token, skin: skin || '', create: '1', game: normalizeGame(game), mode, fill: fill ? '1' : '0' }, true).catch((err) => {
      if (err.reason === 'taken' && tries++ < 5) return attempt();
      throw err;
    });
  return attempt();
}

function connectOnce(code, query, creating) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(partyUrl('party', code, query));
    } catch {
      reject(new Error(PARTY_MSG.offline));
      return;
    }
    let settled = false;
    const fail = (text, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      const err = new Error(text);
      err.reason = reason || null;
      reject(err);
    };
    const timer = setTimeout(() => fail(PARTY_MSG.offline, 'offline'), OPEN_MS);
    const conn = new PartyConn(ws, code, query.token);
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg) return;
      if (!settled) {
        if (msg.t === 'state') {
          settled = true;
          clearTimeout(timer);
          conn._handle(msg);
          resolve(conn);
        } else if (msg.t === 'reject') {
          const m = PARTY_MSG[msg.reason];
          fail(typeof m === 'function' ? m(code) : m || (creating ? PARTY_MSG.offline : 'Could not join that party.'), msg.reason);
        }
        return;
      }
      conn._handle(msg);
    };
    ws.onclose = () => fail(PARTY_MSG.offline, 'offline');
  });
}

class PartyConn {
  constructor(ws, code, token) {
    this.ws = ws;
    this.code = code;
    this.token = token;
    this.you = null;
    this.party = null;
    this.closed = false;
    this.onState = null;
    this.onMatch = null;
    this.onNotice = null;
    this.onClose = null;
    ws.onclose = (ev) => this._closed(ev && ev.code === 4002 ? 'kicked' : 'lost');
  }

  get me() {
    return (this.party && this.party.members.find((m) => m.id === this.you)) || null;
  }

  get isLeader() {
    return !!this.party && this.party.leaderId === this.you;
  }

  _handle(msg) {
    if (msg.t === 'state') {
      this.you = msg.you;
      // local clock for the matchmaking timer
      const p = msg.party;
      p.game = normalizeGame(p.game); // older servers send no game
      p.queuedSince = p.state === 'queued' ? performance.now() - (p.queuedFor || 0) : 0;
      if (this.party && this.party.state === 'queued' && p.state === 'queued') p.queuedSince = this.party.queuedSince;
      this.party = p;
      if (this.onState) this.onState(p);
    } else if (msg.t === 'match') {
      if (this.onMatch) this.onMatch({ code: msg.code, hostToken: msg.hostToken, teams: msg.teams || [], mode: msg.mode, game: normalizeGame(msg.game) });
    } else if (msg.t === 'notice' || msg.t === 'error') {
      if (this.onNotice) this.onNotice(msg.text, msg.t === 'error');
    } else if (msg.t === 'kicked') {
      this._closed('kicked');
    }
  }

  _send(msg) {
    if (this.closed || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  ready(on) {
    return this._send({ t: 'ready', on: !!on });
  }
  setSkin(skin) {
    return this._send({ t: 'skin', skin: String(skin || '') });
  }

  setName(name) {
    return this._send({ t: 'name', name: cleanName(name) });
  }
  setGame(game) {
    return this._send({ t: 'setGame', game: normalizeGame(game) });
  }
  setMode(mode) {
    return this._send({ t: 'setMode', mode });
  }
  setFill(on) {
    return this._send({ t: 'setFill', on: !!on });
  }
  kick(id) {
    return this._send({ t: 'kick', id });
  }
  promote(id) {
    return this._send({ t: 'promote', id });
  }
  play() {
    return this._send({ t: 'play' });
  }
  cancel() {
    return this._send({ t: 'cancel' });
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

  /** Leave on purpose (no onClose). */
  leave() {
    if (this.closed) return;
    this._send({ t: 'leave' });
    this.closed = true;
    this.ws.onclose = null;
    const ws = this.ws;
    setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }, 100);
  }
}
