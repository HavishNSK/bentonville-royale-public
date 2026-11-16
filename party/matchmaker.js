// BENTONVILLE ROYALE — matchmaker. One PartyKit room per mode (solo/duo/trio/squad).
//
// Party rooms (party/partyRoom.js) POST to /parties/matchmaker/<mode>:
//   {t:'ticket', partyId, ticketId, fill, members:[{token, name, leader}]}
//   {t:'cancel', partyId, ticketId}   -> {removed}
//   {t:'poll'}                        (keeps the room awake; closes a due batch)
//
// A batch closes WINDOW_MS after its first ticket, or as soon as it holds
// MAX_HUMANS players. Parties stay whole on one team; Fill parties smaller than
// the team size can share a team, No Fill parties keep their team to
// themselves (bots never join it). The match host is the leader of the largest
// party. The plan is POSTed back to every party room:
//   {t:'plan', ticketId, code, hostToken, mode, teams:[{tokens:[...], allowBots}]}

import { Server, getServerByName } from 'partyserver';
import { MAX_HUMANS, randomCode } from '../src/net/protocol.js';
import { modeSize, validMode } from './modes.js';

export const WINDOW_MS = 8000;

/** parties: [{partyId, fill, members:[{token, leader}]}] in queue order -> {teams, hostToken} */
export function packTeams(parties, size) {
  const teams = [];
  for (const p of parties) {
    if (!p.fill) teams.push({ tokens: p.members.map((m) => m.token), allowBots: false });
  }
  const fillers = parties.filter((p) => p.fill).sort((a, b) => b.members.length - a.members.length);
  for (const p of fillers) {
    const n = p.members.length;
    let team = teams.find((t) => t.allowBots && t.tokens.length + n <= size);
    if (!team) {
      team = { tokens: [], allowBots: true };
      teams.push(team);
    }
    team.tokens.push(...p.members.map((m) => m.token));
  }
  let host = null;
  for (const p of parties) if (!host || p.members.length > host.members.length) host = p;
  const leader = host ? host.members.find((m) => m.leader) || host.members[0] : null;
  return { teams, hostToken: leader ? leader.token : null };
}

export class Matchmaker extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.tickets = new Map(); // partyId -> ticket (insertion order = queue order)
    this.batchStart = 0;
    this.timer = null;
  }

  /** One matchmaker room per mode; the room name is the mode. */
  get mode() {
    return validMode(this.name) ? this.name : 'solo';
  }

  _humans() {
    let n = 0;
    for (const t of this.tickets.values()) n += t.members.length;
    return n;
  }

  _check() {
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
    const code = randomCode();
    for (const t of batch) {
      const plan = { t: 'plan', ticketId: t.ticketId, code, hostToken, mode: this.mode, teams };
      getServerByName(this.env.Party, t.partyId)
        .then((party) => party.fetch(new Request('https://party/' + t.partyId, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan) })))
        .catch((err) => console.warn('[matchmaker] plan to', t.partyId, 'failed', err && err.message));
    }
  }

  async onRequest(req) {
    if (req.method !== 'POST') {
      return Response.json({ mode: this.mode, parties: this.tickets.size, humans: this._humans() });
    }
    let msg;
    try {
      msg = await req.json();
    } catch {
      return new Response('bad json', { status: 400 });
    }
    const size = modeSize(this.mode);
    if (msg.t === 'ticket') {
      const members = Array.isArray(msg.members) ? msg.members.slice(0, size) : [];
      if (!members.length || !msg.partyId) return new Response('bad ticket', { status: 400 });
      this.tickets.delete(msg.partyId); // re-queue goes to the back
      this.tickets.set(msg.partyId, { partyId: String(msg.partyId), ticketId: msg.ticketId, fill: !!msg.fill || size === 1, members });
      this._check();
      return Response.json({ ok: true, queued: this._humans() });
    }
    if (msg.t === 'cancel') {
      const t = this.tickets.get(msg.partyId);
      const removed = !!t && (!msg.ticketId || t.ticketId === msg.ticketId);
      if (removed) this.tickets.delete(msg.partyId);
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
