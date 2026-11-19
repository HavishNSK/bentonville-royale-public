// BENTONVILLE ROYALE — party server (PartyServer Durable Object). One room per 4-letter party code.
//
// The party is server-authoritative: the leader picks the game (battle royale or
// Box Fights), the mode (team size) and Fill, members ready up, and the leader's
// PLAY sends a ticket to the matchmaker party (party/matchmaker.js, one room per
// queue: queueName(game, mode), e.g. 'duo' or 'bf-duo'). When the matchmaker has
// a match it POSTs the plan back here and every member gets {t:'match', ...}.
//
// Connect:  /parties/party/<CODE>?name=&token=&create=1&game=&mode=&fill=
//   create=1 makes a new party (rejected with 'taken' if the code is in use);
//   without it the party must already exist ('notFound'). game defaults to 'br';
//   a mode the game does not have is coerced (both games accept all four modes).
//   Party cap: partyCap(game) (4 for br -> 'full', 4 for boxfights -> 'fullBox').
//   token is a stable random id per player tab; the match plan refers to members
//   by token and game guests join the game room with it.
//
// Client -> server (JSON):
//   anyone:       {t:'ready', on} {t:'name', name} {t:'skin', skin} {t:'leave'}
//   leader only:  {t:'setGame', game} {t:'setMode', mode} {t:'setFill', on} {t:'kick', id}
//                 {t:'promote', id} {t:'play'} {t:'cancel'}
//                 (setGame/setMode/setFill only while idle)
// Server -> client:
//   {t:'state', you, party:{code, leaderId, game, mode, fill, state, queuedFor, members:[{id,name,ready,leader,skin}]}}
//   {t:'match', code, hostToken, teams:[{tokens, allowBots}], mode, game}   (game is this party's own)
//   {t:'notice', text}   {t:'error', text}   {t:'reject', reason} then close
//   {t:'kicked'} then close (4002)

import { Server, getServerByName } from 'partyserver';
import { MODE_SIZE, queueName } from './modes.js';
import { nameIsClean } from '../src/net/chatFilter.js';
import { cleanToken, createSettings, joinReject, joinMode, modeLabel, setGameDecision, setModeDecision } from './partyRules.js';

const POLL_MS = 2000;
const MATCHED_MS = 4000;
// A dropped connection (page refresh, network blip) keeps its party slot this long, so the
// player comes back into the same party instead of vanishing from everyone's lobby.
const AWAY_MS = 20000;

function cleanName(name) {
  const s = String(name || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 16);
  return s && nameIsClean(s) ? s : 'Player'; // names with swear words show as Player
}

/** Look shown in the lobby line-up: "skin|pickaxe|backbling" (Cosmetics.lookString; unchecked, cosmetic only). */
function cleanSkin(s) {
  const v = String(s || '').replace(/[^a-z0-9_|]/g, '').slice(0, 96);
  return v.startsWith('skin_') ? v : null;
}

export class Party extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this._reset();
  }

  _reset() {
    this.members = []; // [{id, name, token, ready, seq}]
    this.leaderId = null;
    this.game = 'br'; // 'br' | 'boxfights'
    this.mode = 'solo';
    this.queue = null; // matchmaker room of the current ticket
    this.fill = true;
    this.state = 'idle'; // idle | queued | matched
    this.queuedAt = 0;
    this.ticketId = null;
    this.seq = 0;
    this._stopPoll();
    clearTimeout(this._matchedTimer);
  }

  // ---------------------------------------------------------------- helpers

  _member(id) {
    return this.members.find((m) => m.id === id) || null;
  }

  _send(conn, msg) {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* gone */
    }
  }

  _sendTo(id, msg) {
    const c = this.getConnection(id);
    if (c) this._send(c, msg);
  }

  _broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const m of this.members) {
      const c = this.getConnection(m.id);
      if (c) {
        try {
          c.send(s);
        } catch {
          /* gone */
        }
      }
    }
  }

  _publicState() {
    return {
      code: this.name,
      leaderId: this.leaderId,
      game: this.game,
      mode: this.mode,
      fill: this.fill,
      state: this.state,
      queuedFor: this.state === 'queued' ? Date.now() - this.queuedAt : 0,
      members: this.members.map((m) => ({ id: m.id, name: m.name, skin: m.skin || null, ready: m.id === this.leaderId || m.ready, leader: m.id === this.leaderId, away: !!m.away })),
    };
  }

  _sync() {
    const party = this._publicState();
    for (const m of this.members) this._sendTo(m.id, { t: 'state', you: m.id, party });
  }

  _notice(text) {
    this._broadcast({ t: 'notice', text });
  }

  _reject(conn, reason, code = 4000) {
    this._send(conn, { t: 'reject', reason });
    try {
      conn.close(code, reason);
    } catch {
      /* gone */
    }
  }

  /** Matchmaker room of the current ticket (set by _queue, so cancel/poll reach the same room). */
  get _queueName() {
    return this.queue || queueName(this.game, this.mode) || 'solo';
  }

  async _matchmaker() {
    return getServerByName(this.env.Matchmaker, this._queueName);
  }

  async _mm(body) {
    const mm = await this._matchmaker();
    const res = await mm.fetch(new Request('https://matchmaker/' + this._queueName, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    if (!res.ok) throw new Error('matchmaker ' + res.status);
    return res.json().catch(() => ({}));
  }

  _stopPoll() {
    if (this._poll) clearInterval(this._poll);
    this._poll = null;
  }

  // ---------------------------------------------------------------- connections

  onConnect(conn, ctx) {
    const url = new URL(ctx.request.url);
    const name = cleanName(url.searchParams.get('name'));
    const skin = cleanSkin(url.searchParams.get('skin'));
    const token = cleanToken(url.searchParams.get('token')) || 'anon-' + conn.id;
    const create = url.searchParams.get('create') === '1';

    // reconnect: same token takes over its old slot
    const old = this.members.find((m) => m.token === token);
    if (old) {
      const prev = this.getConnection(old.id);
      const wasLeader = this.leaderId === old.id;
      old.id = conn.id;
      old.name = name;
      old.skin = skin;
      old.away = false;
      clearTimeout(old.awayTimer);
      old.ready = false;
      if (wasLeader) this.leaderId = conn.id;
      if (prev && prev !== conn) {
        try {
          prev.close(4004, 'replaced');
        } catch {
          /* gone */
        }
      }
      conn.setState({ token });
      if (this.state === 'queued' && !wasLeader) this._cancel(`${name} reconnected`);
      this._sync();
      return;
    }

    const refused = joinReject({ create, members: this.members.length, state: this.state, game: this.game });
    if (refused) return this._reject(conn, refused, refused === 'taken' ? 4001 : 4000);

    if (!this.members.length) {
      this._reset();
      const s = createSettings(url.searchParams);
      this.game = s.game;
      this.mode = s.mode;
      this.fill = s.fill;
      this.leaderId = conn.id;
    }
    this.members.push({ id: conn.id, name, token, skin, ready: false, seq: this.seq++ });
    conn.setState({ token });
    // a party bigger than its mode moves up (solo + a friend -> duos), within the game's modes
    const fit = joinMode(this.game, this.mode, this.members.length);
    if (fit !== this.mode) {
      this.mode = fit;
      this._notice(`Mode changed to ${modeLabel(fit)} so everyone fits.`);
    }
    this._sync();
  }

  /** Socket gone without a 'leave': hold the slot for AWAY_MS (a refresh reconnects into it). */
  onClose(conn) {
    const m = this._member(conn.id);
    if (!m) return;
    m.away = true;
    clearTimeout(m.awayTimer);
    m.awayTimer = setTimeout(() => {
      if (m.away && m.id === conn.id) this._remove(conn.id);
    }, AWAY_MS);
    this._sync();
  }

  onError(conn) {
    this.onClose(conn);
  }

  _remove(id) {
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return;
    const [gone] = this.members.splice(i, 1);
    clearTimeout(gone.awayTimer);
    if (!this.members.length) {
      if (this.state === 'queued') this._cancel('', true);
      this._reset();
      return;
    }
    if (this.state === 'queued') this._cancel(`${gone.name} left the party.`);
    if (this.leaderId === id) {
      const next = [...this.members].sort((a, b) => a.seq - b.seq)[0];
      this.leaderId = next.id;
      next.ready = false;
      this._notice(`${next.name} is now the party leader.`);
    }
    this._sync();
  }

  // ---------------------------------------------------------------- messages

  onMessage(sender, message) {
    if (typeof message !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (!msg || typeof msg.t !== 'string') return;
    const me = this._member(sender.id);
    if (!me) return;
    const isLeader = sender.id === this.leaderId;
    const err = (text) => this._send(sender, { t: 'error', text });

    switch (msg.t) {
      case 'ready': {
        if (isLeader) return;
        const on = !!msg.on;
        if (me.ready === on) return;
        me.ready = on;
        if (!on && this.state === 'queued') this._cancel(`${me.name} is not ready.`);
        this._sync();
        return;
      }
      case 'name': {
        me.name = cleanName(msg.name);
        this._sync();
        return;
      }
      case 'skin': {
        me.skin = cleanSkin(msg.skin);
        this._sync();
        return;
      }
      case 'leave': {
        this._remove(sender.id);
        try {
          sender.close(1000, 'left');
        } catch {
          /* gone */
        }
        return;
      }
    }

    if (!isLeader) return err('Only the party leader can do that.');

    switch (msg.t) {
      case 'setGame': {
        if (this.state !== 'idle') return err('Cancel matchmaking first.');
        const d = setGameDecision({ game: this.game, mode: this.mode, members: this.members.length, next: msg.game });
        if (!d) return;
        if (d.error) return err(d.error);
        this.game = d.game;
        this.mode = d.mode;
        if (this.mode === 'solo') this.fill = true;
        if (d.modeChanged) this._notice(`Mode changed to ${modeLabel(d.mode)} for ${d.game === 'boxfights' ? 'Box Fights' : 'Battle Royale'}.`);
        this._sync();
        return;
      }
      case 'setMode': {
        if (this.state !== 'idle') return err('Cancel matchmaking first.');
        const d = setModeDecision({ game: this.game, members: this.members.length, next: msg.mode });
        if (!d) return;
        if (d.error) return err(d.error);
        this.mode = d.mode;
        if (this.mode === 'solo') this.fill = true;
        this._sync();
        return;
      }
      case 'setFill': {
        if (this.state !== 'idle') return err('Cancel matchmaking first.');
        this.fill = this.mode === 'solo' ? true : !!msg.on;
        this._sync();
        return;
      }
      case 'kick': {
        if (msg.id === sender.id) return;
        const m = this._member(msg.id);
        if (!m) return;
        const c = this.getConnection(m.id);
        this._remove(m.id);
        if (c) {
          this._send(c, { t: 'kicked' });
          try {
            c.close(4002, 'kicked');
          } catch {
            /* gone */
          }
        }
        return;
      }
      case 'promote': {
        const m = this._member(msg.id);
        if (!m || m.id === sender.id) return;
        if (this.state === 'queued') this._cancel('');
        this.leaderId = m.id;
        m.ready = false;
        me.ready = true; // the old leader was implicitly ready
        this._notice(`${m.name} is now the party leader.`);
        this._sync();
        return;
      }
      case 'play': {
        if (this.state !== 'idle') return;
        const waiting = this.members.filter((m) => m.id !== this.leaderId && !m.ready);
        if (waiting.length) return err(`Waiting for ${waiting.length} to ready up.`);
        this._queue();
        return;
      }
      case 'cancel': {
        if (this.state === 'queued') this._cancel('');
        this._sync();
        return;
      }
    }
  }

  // ---------------------------------------------------------------- matchmaking

  _queue() {
    // unguessable: a plan for this party is only accepted with this id
    const ticketId = crypto.randomUUID();
    this.state = 'queued';
    this.queuedAt = Date.now();
    this.ticketId = ticketId;
    this.queue = queueName(this.game, this.mode) || 'solo';
    this._sync();
    const ticket = {
      t: 'ticket',
      partyId: this.name,
      ticketId,
      fill: this.mode === 'solo' ? true : this.fill,
      at: this.queuedAt,
      members: this.members.map((m) => ({ token: m.token, name: m.name, leader: m.id === this.leaderId })),
    };
    this._mm(ticket).catch(() => {
      if (this.ticketId !== ticketId || this.state !== 'queued') return;
      this.state = 'idle';
      this.ticketId = null;
      this._stopPoll();
      this._broadcast({ t: 'error', text: 'Matchmaking is unavailable right now.' });
      this._sync();
    });
    // the poll keeps the matchmaker awake and lets it close its batch window
    this._stopPoll();
    this._poll = setInterval(() => {
      if (this.state !== 'queued') return this._stopPoll();
      this._mm({ t: 'poll' }).catch(() => {});
    }, POLL_MS);
  }

  _cancel(reason, silent = false) {
    if (this.state !== 'queued') return;
    const ticketId = this.ticketId;
    this.state = 'idle';
    this.ticketId = null;
    this._stopPoll();
    this._mm({ t: 'cancel', partyId: this.name, ticketId }).catch(() => {});
    if (!silent) this._notice(reason ? `Matchmaking cancelled: ${reason}` : 'Matchmaking cancelled.');
  }

  async onRequest(req) {
    if (req.method !== 'POST') return new Response('party ' + this.name + ': ' + this.members.length + ' members', { status: 200 });
    let msg;
    try {
      msg = await req.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if (msg.t !== 'plan') return new Response('unknown', { status: 400 });
    if (this.state !== 'queued' || msg.ticketId !== this.ticketId) return new Response('stale', { status: 409 });
    this.state = 'matched';
    this.ticketId = null;
    this._stopPoll();
    for (const m of this.members) if (m.id !== this.leaderId) m.ready = false;
    this._broadcast({ t: 'match', code: msg.code, hostToken: msg.hostToken, teams: msg.teams, mode: msg.mode, game: this.game });
    this._sync();
    clearTimeout(this._matchedTimer);
    this._matchedTimer = setTimeout(() => {
      if (this.state !== 'matched') return;
      this.state = 'idle';
      this._sync();
    }, MATCHED_MS);
    return Response.json({ ok: true });
  }
}

export { MODE_SIZE };
