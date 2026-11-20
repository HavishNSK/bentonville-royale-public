// BENTONVILLE ROYALE — matchmaker. One PartyKit room per queue: the BR modes
// (solo/duo/trio/squad) and Box Fights 'bf-solo'/'bf-duo'/'bf-trio'/'bf-ffa' (parseQueue; no 4v4).
// Any other room name answers 404 and does nothing.
//
// Party rooms (party/partyRoom.js) POST to /parties/matchmaker/<queue>:
//   {t:'ticket', partyId, ticketId, fill, at, members:[{token, name, leader}]}
//   {t:'cancel', partyId, ticketId}   -> {removed}
//   {t:'poll'}                        (keeps the room awake; closes a due batch)
//
// A batch closes WINDOW_MS after its first ticket, or as soon as it holds
// MAX_HUMANS players. Parties stay whole on one team; Fill parties smaller than
// the team size can share a team, No Fill parties keep their team to
// themselves (bots never join it). The match host is the leader of the largest
// party. The plan is POSTed back to every party room:
//   {t:'plan', ticketId, code, hostToken, mode, game, teams:[{tokens:[...], allowBots}]}
//
// Box Fights rooms instead pack exactly two teams of the mode's size with
// packBoxFight (party/matchPack.js), as many matches as the queue allows; a match
// waits for both teams to fill, or starts with bots after the pack window (never when a No Fill
// party is in it: that keeps searching for human opponents). 'bf-ffa' packs up
// to 6 humans, one per side (packBoxFfa).

import { Server, getServerByName } from 'partyserver';
import { MAX_HUMANS, randomCode } from '../src/net/protocol.js';
import { modeSize, parseQueue, PARTY_MAX, BOX_MAX_PLAYERS } from './modes.js';
import { packTeams, packBoxFight, packBoxFfa } from './matchPack.js';
import { ticketMembers, ticketTime } from './partyRules.js';

export { packTeams };

export const WINDOW_MS = 8000;
// most parties one queue holds (the queue room is publicly reachable: bound its memory and work)
const MAX_TICKETS = 500;

export class Matchmaker extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.tickets = new Map(); // partyId -> ticket (insertion order = queue order)
    this.batchStart = 0;
    this.timer = null;
  }

  /** {game, mode} from the room name (queueName), or null for an unknown room. */
  get queue() {
    return parseQueue(this.name);
  }

  get game() {
    return this.queue ? this.queue.game : 'br';
  }

  get mode() {
    return this.queue ? this.queue.mode : 'solo';
  }

  _humans() {
    let n = 0;
    for (const t of this.tickets.values()) n += t.members.length;
    return n;
  }

  _check() {
    if (this.game === 'boxfights') return this._checkBox();
    if (!this.tickets.size) {
      this.batchStart = 0;
      clearTimeout(this.timer);
      this.timer = null;
      return;
    }
    if (!this.batchStart) this.batchStart = Date.now();
    const due = this.batchStart + WINDOW_MS - Date.now();
    if (this._humans() >= MAX_HUMANS || due <= 0) {
      this._flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this._check();
      }, due + 20);
    }
  }

  _flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const batch = [];
    let n = 0;
    for (const t of this.tickets.values()) {
      if (n + t.members.length > MAX_HUMANS) continue; // waits for the next batch
      batch.push(t);
      n += t.members.length;
    }
    for (const t of batch) this.tickets.delete(t.partyId);
    this.batchStart = this.tickets.size ? Date.now() : 0;
    if (this.tickets.size) this._check();
    if (!batch.length) return;

    const { teams, hostToken } = packTeams(batch, modeSize(this.mode));
    this._sendPlans(batch, hostToken, teams);
  }

  /** Box Fights: form as many two-team matches as the queue allows, then wait for the next due time. */
  _checkBox() {
    clearTimeout(this.timer);
    this.timer = null;
    const ffa = this.mode === 'ffa';
    const size = modeSize(this.mode);
    let nextAt = null;
    // bounded: each pass removes at least one ticket, and never more passes than tickets
    for (let pass = 0, max = this.tickets.size; pass < max; pass++) {
      const list = [...this.tickets.values()];
      const r = ffa ? packBoxFfa(list, BOX_MAX_PLAYERS, Date.now()) : packBoxFight(list, size, Date.now());
      nextAt = r.nextAt;
      if (!r.match) break;
      const used = new Set(r.match.used);
      const batch = [...this.tickets.values()].filter((t) => used.has(t.ticketId));
      if (!batch.length) break; // cannot happen; guards the loop
      const before = this.tickets.size;
      for (const t of batch) this.tickets.delete(t.partyId);
      if (this.tickets.size === before) break; // nothing removed: never spin
      const teams = r.match.teams.map((tm) => ({ tokens: tm.tokens, allowBots: tm.allowBots }));
      this._sendPlans(batch, r.match.hostToken, teams);
    }
    if (this.tickets.size && nextAt !== null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this._check();
      }, Math.max(0, nextAt - Date.now()) + 20);
    }
  }

  /** POST one plan per ticket back to its party room (same room code for everyone). */
  _sendPlans(batch, hostToken, teams) {
    const code = randomCode();
    for (const t of batch) {
      const plan = { t: 'plan', ticketId: t.ticketId, code, hostToken, mode: this.mode, game: this.game, teams };
      getServerByName(this.env.Party, t.partyId)
        .then((party) => party.fetch(new Request('https://party/' + t.partyId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan) })))
        .catch((err) => console.warn('[matchmaker] plan to', t.partyId, 'failed', err && err.message));
    }
  }

  async onRequest(req) {
    if (!this.queue) return new Response('not found', { status: 404 });
    if (req.method !== 'POST') {
      return Response.json({ game: this.game, mode: this.mode, parties: this.tickets.size, humans: this._humans() });
    }
    let msg;
    try {
      msg = await req.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    // FFA: a whole party (up to PARTY_MAX) queues together, each member on their own side
    const size = this.mode === 'ffa' ? PARTY_MAX : modeSize(this.mode);
    if (!msg || typeof msg !== 'object') return new Response('bad message', { status: 400 });
    // party ids are short room codes and ticket ids short random strings: one key form everywhere
    const partyId = typeof msg.partyId === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(msg.partyId) ? msg.partyId : null;
    const ticketId = typeof msg.ticketId === 'string' && msg.ticketId.length <= 64 ? msg.ticketId : null;
    if (msg.t === 'ticket') {
      const box = this.game === 'boxfights';
      const members = box ? ticketMembers(msg.members, size) : Array.isArray(msg.members) ? msg.members.slice(0, size) : [];
      if (!members.length || !partyId || !ticketId) return new Response('bad ticket', { status: 400 });
      if (!this.tickets.has(partyId) && this.tickets.size >= MAX_TICKETS) return new Response('busy', { status: 429 });
      const ticket = { partyId, ticketId, fill: !!msg.fill || size === 1, members };
      if (box) ticket.at = ticketTime(msg.at, Date.now());
      this.tickets.delete(partyId); // re-queue goes to the back
      this.tickets.set(partyId, ticket);
      this._check();
      return Response.json({ ok: true, queued: this._humans() });
    }
    if (msg.t === 'cancel') {
      const t = partyId ? this.tickets.get(partyId) : null;
      const removed = !!t && (!msg.ticketId || t.ticketId === msg.ticketId);
      if (removed) this.tickets.delete(partyId);
      this._check();
      return Response.json({ ok: true, removed });
    }
    if (msg.t === 'poll') {
      this._check();
      return Response.json({ ok: true });
    }
    return new Response('unknown', { status: 400 });
  }
}
