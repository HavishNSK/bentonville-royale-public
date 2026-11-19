// BENTONVILLE ROYALE — Box Fights lobby index (PartyServer Durable Object, one room: "index").
// Durable Objects cannot be enumerated, so every lobby room (party/lobbyRoom.js) reports itself
// here. The index reserves codes (collision check + per-creator cap) and serves the public list.
// Rules live in party/lobbyRules.js (indexClaim / indexUpsert / indexRemove / indexList).
//
// HTTP only (WebSockets are refused):
//   GET  /parties/lobby-index/index        -> {t:'lobbyList', list:[{code,name,mode,players,max,state,full}]}
//        Browsers may call this; the Origin must pass originAllowed (party/authLimits.js).
//        Private lobbies are never listed. Entries not refreshed for 60 s expire (crashed rooms).
//   POST (internal only: party/server.js refuses POSTs to /parties/lobby-index/ from the internet;
//        lobby rooms reach this object through the LobbyIndex binding)
//        {t:'claim', code, owner}  -> {ok, error?: 'taken'|'limit'|'bad'}   owner = hashed creator IP
//        {t:'upsert', entry}       -> {ok}
//        {t:'remove', code}        -> {ok}
// Everything is in memory: if this object is evicted the list refills from the rooms' heartbeats.

import { Server } from 'partyserver';
import { indexClaim, indexUpsert, indexRemove, indexList } from './lobbyRules.js';
import { originAllowed } from './authLimits.js';

export const INDEX_ROOM = 'index';
const MAX_BODY = 2048;
const MAX_ENTRIES = 5000; // refuses claims past this (abuse bound; prototype traffic is far lower)

export class LobbyIndex extends Server {
  constructor(ctx, env) {
    super(ctx, env);
    this.index = new Map();
  }

  onConnect(conn) {
    try {
      conn.close(4000, 'unavailable');
    } catch {
      /* gone */
    }
  }

  async onRequest(req) {
    if (this.name !== INDEX_ROOM) return new Response('Not found', { status: 404 });
    const now = Date.now();
    if (req.method === 'GET') {
      const origin = req.headers.get('origin');
      if (!originAllowed(origin, this.env && this.env.ALLOWED_ORIGINS)) return new Response('Forbidden', { status: 403 });
      const headers = { 'cache-control': 'no-store', vary: 'Origin' };
      if (origin) headers['access-control-allow-origin'] = origin; // only allowlisted origins reach here
      return Response.json({ t: 'lobbyList', list: indexList(this.index, now) }, { headers });
    }
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const text = await req.text();
    if (text.length > MAX_BODY) return new Response('too large', { status: 413 });
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return new Response('bad json', { status: 400 });
    }
    if (!msg || typeof msg !== 'object') return new Response('bad', { status: 400 });
    switch (msg.t) {
      case 'claim':
        if (this.index.size >= MAX_ENTRIES) return Response.json({ ok: false, error: 'limit' });
        return Response.json(indexClaim(this.index, msg.code, typeof msg.owner === 'string' ? msg.owner.slice(0, 64) : '', now));
      case 'upsert':
        return Response.json(indexUpsert(this.index, msg.entry, now));
      case 'remove':
        indexRemove(this.index, String(msg.code || ''));
        return Response.json({ ok: true });
      default:
        return new Response('unknown', { status: 400 });
    }
  }
}
