// Smoke test of the Durable Object shells (party/lobbyRoom.js, party/lobbyIndex.js and the relay
// host migration in party/server.js Main). partyserver needs the Workers runtime
// ('cloudflare:workers'), so a module hook swaps it for a tiny fake: rooms get `name`, `env` and
// getConnection(); getServerByName() returns in-process rooms. This checks the shells' wiring
// (messages, closes, index and relay calls), not partyserver itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const FAKE = `
export class Server {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.name = ctx && ctx.name; this.conns = new Map(); }
  getConnection(id) { return this.conns.get(id); }
  getConnections() { return this.conns.values(); }
  broadcast(text) { for (const c of this.conns.values()) c.send(text); }
}
export async function getServerByName(ns, name) { return globalThis.__rooms(ns, name); }
export async function routePartykitRequest() { return null; }
`;
const HOOKS = `
export async function resolve(spec, ctx, next) {
  if (spec === 'partyserver') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(FAKE)}), shortCircuit: true };
  return next(spec, ctx);
}`;
register('data:text/javascript,' + encodeURIComponent(HOOKS));

const { Lobby } = await import('../party/lobbyRoom.js');
const { LobbyIndex } = await import('../party/lobbyIndex.js');
const { Main } = await import('../party/server.js');

const tick = () => new Promise((r) => setImmediate(r));
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await tick();
}

function world() {
  const rooms = new Map();
  const env = { LobbyIndex: { cls: LobbyIndex }, Main: { cls: Main }, Lobby: { cls: Lobby } };
  globalThis.__rooms = (ns, name) => {
    const key = ns.cls.name + '/' + name;
    if (!rooms.has(key)) rooms.set(key, new ns.cls({ name }, env));
    return rooms.get(key);
  };
  // stub.fetch -> onRequest
  for (const cls of [LobbyIndex, Main, Lobby]) cls.prototype.fetch = function (req) { return this.onRequest(req); };
  return { room: (cls, name) => globalThis.__rooms(env[cls.name] || { cls }, name), rooms };
}

let nextId = 0;
function connect(room, query) {
  const conn = {
    id: 'c' + nextId++,
    state: null,
    out: [],
    closedWith: null,
    send(s) { this.out.push(typeof s === 'string' ? s : s); },
    setState(s) { this.state = s; },
    close(code) {
      if (this.closedWith != null) return;
      this.closedWith = code;
      room.conns.delete(this.id);
      room.onClose(this);
    },
    msgs(t) { return this.out.filter((s) => typeof s === 'string' && s[0] === '{').map((s) => JSON.parse(s)).filter((m) => !t || m.t === t); },
    say(msg) { room.onMessage(this, JSON.stringify(msg)); },
  };
  room.conns.set(conn.id, conn);
  const url = 'https://x/parties/' + (room instanceof Main ? 'main' : 'lobby') + '/' + room.name + '?' + new URLSearchParams(query);
  room.onConnect(conn, { request: new Request(url, { headers: { origin: 'http://localhost:5173', 'cf-connecting-ip': '203.0.113.9' } }) });
  return conn;
}

test('lobby room: create, join, full, list, kick, refusals with exact copy', async (t) => {
  const w = world();
  const lobby = w.room(Lobby, 'BNTV42');
  const a = connect(lobby, { name: 'Ann', token: 'tokA' });
  a.say({ t: 'createLobby', settings: { mode: '1v1', type: 'public' } });
  await settle();
  const up = a.msgs('lobbyUpdate').at(-1);
  assert.ok(up, 'creator gets lobbyUpdate');
  assert.equal(up.lobby.hostId, up.you);
  assert.equal(up.lobby.code, 'BNTV42');
  assert.ok(!JSON.stringify(up).includes('tokA'));

  // second create on the same code -> taken (4001)
  const dup = connect(lobby, { name: 'Dup', token: 'tokD' });
  dup.say({ t: 'createLobby', settings: {} });
  await settle();
  assert.equal(dup.closedWith, 4001);

  const b = connect(lobby, { name: 'Bo', token: 'tokB' });
  b.say({ t: 'joinLobby', code: 'bntv42' });
  await settle();
  assert.equal(b.msgs('lobbyUpdate').at(-1).lobby.slots.filter((s) => s.kind === 'human').length, 2);

  const c = connect(lobby, { name: 'Cy', token: 'tokC' });
  c.say({ t: 'joinLobby', code: 'BNTV42' });
  assert.deepEqual(c.msgs('error').map((m) => m.message), ['Lobby is full']);
  assert.equal(c.closedWith, 4000);

  const ghost = connect(w.room(Lobby, 'ZZZZZ2'), { name: 'G', token: 'tokG' });
  ghost.say({ t: 'joinLobby', code: 'ZZZZZ2' });
  assert.deepEqual(ghost.msgs('error').map((m) => m.message), ['Lobby not found']);

  // public list through the index (HTTP GET, allowlisted origin)
  const idx = w.room(LobbyIndex, 'index');
  const res = await idx.onRequest(new Request('https://x/parties/lobby-index/index', { headers: { origin: 'http://localhost:5173' } }));
  const body = await res.json();
  assert.deepEqual(body.list.map((e) => [e.code, e.players, e.max, e.full]), [['BNTV42', 2, 2, true]]);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const evil = await idx.onRequest(new Request('https://x/parties/lobby-index/index', { headers: { origin: 'https://evil.example' } }));
  assert.equal(evil.status, 403);

  // non-host kick refused; host kick closes 4002
  b.say({ t: 'kick', playerId: up.you });
  assert.equal(b.msgs('error').at(-1).message, 'Only the host can do that.');
  const bid = b.msgs('lobbyUpdate').at(-1).you;
  a.say({ t: 'kick', playerId: bid });
  assert.equal(b.closedWith, 4002);
  assert.equal(a.msgs('lobbyUpdate').at(-1).lobby.slots.filter((s) => s.kind === 'human').length, 1);

  // oversize and junk frames are ignored
  lobby.onMessage(a, 'x'.repeat(5000));
  lobby.onMessage(a, '{not json');
  a.say({ t: 'leaveLobby' });
  await settle();
  const after = await (await idx.onRequest(new Request('https://x/i'))).json();
  assert.deepEqual(after.list, []); // last human left -> removed from the index
});

test('lobby room: countdown, matchStart hand-off, mid-match host migration through the relay', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const w = world();
  const lobby = w.room(Lobby, 'QWERT7');
  const a = connect(lobby, { name: 'Ann', token: 'tokA' });
  a.say({ t: 'createLobby', settings: { mode: '2v2' } });
  await settle();
  const b = connect(lobby, { name: 'Bo', token: 'tokB' });
  b.say({ t: 'joinLobby', code: 'QWERT7' });
  const c = connect(lobby, { name: 'Cy', token: 'tokC' });
  c.say({ t: 'joinLobby', code: 'QWERT7' });
  b.say({ t: 'startMatch' });
  assert.equal(b.msgs('error').at(-1).message, 'Only the host can do that.');
  a.say({ t: 'startMatch' });
  for (let i = 0; i < 5; i++) t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(a.msgs('countdown').map((m) => m.seconds), [5, 4, 3, 2, 1]);
  const msA = a.msgs('matchStart')[0];
  const msB = b.msgs('matchStart')[0];
  assert.match(msA.relayCode, /^[A-Z]{4}$/);
  assert.equal(msA.hostToken, 'tokA');
  assert.equal(msB.hostToken, undefined);
  assert.equal(msA.slots.length, 4);
  assert.equal(msA.slots.filter((s) => s.kind === 'bot').length, 1);

  // the relay room: host + two guests, registered as a lobby room by the matchStart POST
  const relay = w.room(Main, msA.relayCode);
  assert.equal(relay.lobbyManaged, true);
  const h = connect(relay, { role: 'host', v: '7', name: 'Ann', token: 'tokA' });
  const gB = connect(relay, { role: 'guest', v: '7', name: 'Bo', token: 'tokB' });
  const gC = connect(relay, { role: 'guest', v: '7', name: 'Cy', token: 'tokC' });
  assert.equal(gB.state.slot, 1);

  // host's browser goes away: lobby first (names Bo, join order), then the relay socket
  a.close(1006);
  await settle();
  const mig = b.msgs('hostMigrate')[0];
  assert.equal(mig.newHostId, msB.you);
  assert.equal(mig.hostToken, 'tokB');
  assert.equal(c.msgs('hostMigrate')[0].hostToken, undefined);
  assert.equal(b.msgs('lobbyUpdate').at(-1).lobby.state, 'playing');
  h.close(1006);
  assert.equal(gB.state.role, 'host');
  const promoted = gB.out.filter((s) => s.startsWith('@:')).map((s) => JSON.parse(s.slice(2))).find((m) => m.t === 'promoted');
  assert.deepEqual(promoted.guests, [{ id: 2, name: 'Cy', token: 'tokC' }]);
  assert.deepEqual(gC.msgs('newHost'), [{ t: 'newHost', id: 1 }]);
  assert.equal(gC.closedWith, null);
  // routing resumes from the new host
  relay.onMessage(gB, '*:{"t":"ping"}');
  assert.ok(gC.out.includes('{"t":"ping"}'));

  // results: only the (new) host may report
  c.say({ t: 'reportResult', result: { winner: 0, score: { team0: 5, team1: 0 } } });
  assert.equal(c.msgs('error').at(-1).message, 'Only the host can do that.');
  b.say({ t: 'reportResult', result: { final: false, score: { team0: 1, team1: 0 } } });
  assert.deepEqual(c.msgs('roundEnd')[0].score, { team0: 1, team1: 0 });
  b.say({ t: 'reportResult', result: { winner: 0, score: { team0: 5, team1: 0 } } });
  assert.deepEqual(c.msgs('matchEnd')[0].results, { winner: 0, score: { team0: 5, team1: 0 } });
  b.say({ t: 'backToLobby' });
  assert.equal(c.msgs('lobbyUpdate').at(-1).lobby.state, 'waiting');
});

test('relay without a lobby keeps the old bye behaviour; lobby room with no successor falls back after the grace window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = world();
  const br = w.room(Main, 'ABCD');
  const h = connect(br, { role: 'host', v: '7', name: 'H' });
  const g = connect(br, { role: 'guest', v: '7', name: 'G', token: 'tg' });
  h.close(1006);
  assert.deepEqual(g.msgs('bye'), [{ t: 'bye', reason: 'host-left' }]);
  assert.equal(g.closedWith, 4003);

  const lm = w.room(Main, 'EFGH');
  await lm.onRequest(new Request('https://main/EFGH', { method: 'POST', body: JSON.stringify({ t: 'lobby' }) }));
  const h2 = connect(lm, { role: 'host', v: '7', name: 'H' });
  const g2 = connect(lm, { role: 'guest', v: '7', name: 'G', token: 'tg' });
  h2.close(1006);
  assert.equal(g2.msgs('hostLost').length, 1);
  assert.equal(g2.closedWith, null);
  // a role=host connect cannot grab the room while it waits
  const grab = connect(lm, { role: 'host', v: '7', name: 'X' });
  assert.equal(grab.closedWith, 4001);
  // a promote for a token nobody holds does nothing; the window runs out -> bye
  await lm.onRequest(new Request('https://main/EFGH', { method: 'POST', body: JSON.stringify({ t: 'promote', token: 'nobody' }) }));
  t.mock.timers.tick(10000);
  assert.equal(g2.msgs('bye').length, 1);
  assert.equal(g2.closedWith, 4003);
});
