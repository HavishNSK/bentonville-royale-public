// BENTONVILLE ROYALE — Cloudflare Worker entry (PartyServer on Durable Objects).
//
// Hosted PartyKit shut down on 23 Oct 2026. The four servers in this folder were written
// against PartyKit's room API; this file runs them unchanged on PartyServer
// (https://github.com/cloudflare/partykit/tree/main/packages/partyserver) by giving each
// one a PartyKit-shaped `room` object:
//
//   room.id                     -> this.name (the room code in the URL)
//   room.storage                -> this.ctx.storage (Durable Object storage)
//   room.getConnection(id)      -> this.getConnection(id)
//   room.getConnections()       -> this.getConnections()
//   room.context.parties.<p>.get(id).fetch(init)  -> a request to that Durable Object
//
// URLs stay the same: routePartykitRequest maps /parties/<party>/<room> to the binding whose
// kebab-case name is <party> (Main -> main, Party -> party, Matchmaker -> matchmaker,
// Accounts -> accounts). Bindings live in wrangler.toml. Rooms keep their state in memory
// while anyone is connected, like on PartyKit, so hibernation stays off.

import { Server, routePartykitRequest, getServerByName } from 'partyserver';
import RelayServer from './server.js';
import PartyRoom from './partyRoom.js';
import MatchmakerServer from './matchmaker.js';
import AccountServer from './accounts.js';

/** PARTY name used in URLs and room.context.parties -> env binding. */
const BINDINGS = { main: 'Main', party: 'Party', matchmaker: 'Matchmaker', accounts: 'Accounts' };

function makeRoom(server, env) {
  const parties = {};
  for (const [party, binding] of Object.entries(BINDINGS)) {
    parties[party] = {
      get(id) {
        return {
          // PartyKit's stub.fetch(init): a request to that room's onRequest
          async fetch(init = {}) {
            const stub = await getServerByName(env[binding], id);
            return stub.fetch(new Request(`https://internal/parties/${party}/${encodeURIComponent(id)}`, init));
          },
        };
      },
    };
  }
  return {
    get id() {
      return server.name;
    },
    get storage() {
      return server.ctx.storage;
    },
    getConnection: (id) => server.getConnection(id),
    getConnections: (tag) => server.getConnections(tag),
    context: { parties },
  };
}

/** A PartyServer class that hosts one of our PartyKit-style servers. */
function host(Impl) {
  return class extends Server {
    static options = { hibernate: false };

    get impl() {
      if (!this._impl) this._impl = new Impl(makeRoom(this, this.env));
      return this._impl;
    }

    onConnect(conn, ctx) {
      return this.impl.onConnect && this.impl.onConnect(conn, ctx);
    }

    // PartyKit: onMessage(message, sender); PartyServer: onMessage(connection, message)
    onMessage(conn, message) {
      return this.impl.onMessage && this.impl.onMessage(message, conn);
    }

    onClose(conn) {
      return this.impl.onClose && this.impl.onClose(conn);
    }

    onError(conn, err) {
      if (this.impl.onError) return this.impl.onError(conn, err);
    }

    onRequest(req) {
      return this.impl.onRequest ? this.impl.onRequest(req) : new Response('ok');
    }
  };
}

export const Main = host(RelayServer);
export const Party = host(PartyRoom);
export const Matchmaker = host(MatchmakerServer);
export const Accounts = host(AccountServer);

export default {
  async fetch(request, env) {
    const res = await routePartykitRequest(request, env);
    if (res) return res;
    return new Response('Bentonville Royale servers: connect to /parties/<party>/<room>', { status: 404 });
  },
};
