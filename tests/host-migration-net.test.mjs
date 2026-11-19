// Box Fights host migration over the relay: Net.js promotion, ClientSession takeover and the
// new HostSession's adoption / resync, with fake sockets and a fake game (no browser, no Three.js scene).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = globalThis.location || { search: '', href: 'http://localhost:5173/' };

class FakeWS {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
    FakeWS.last = this;
  }
  send(d) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
  }
}
globalThis.WebSocket = FakeWS;

const { joinRoom, hostRoomFromGuest } = await import('../src/net/Net.js');
const { ClientSession } = await import('../src/net/ClientSession.js');
const { HostSession } = await import('../src/net/HostSession.js');
const { Inventory } = await import('../src/game/Inventory.js');
const { boxLoadout } = await import('../src/game/BoxFights.js');

async function joined(id = 2) {
  const p = joinRoom('ABCD', { name: 'Me' });
  const ws = FakeWS.last;
  ws.onmessage({ data: JSON.stringify({ t: 'welcome', id, code: 'ABCD' }) });
  return { conn: await p, ws };
}
const promotedFrame = (guests) => ({ data: '@:' + JSON.stringify({ t: 'promoted', code: 'ABCD', max: 8, guests }) });

test('Net: a promoted guest socket becomes a HostRoom with the remaining guests', async () => {
  const { conn, ws } = await joined(2);
  let promo = null;
  let room = null;
  conn.onPromoted = (p) => {
    promo = p;
    room = hostRoomFromGuest(conn, { name: 'Me', game: 'boxfights', mode: 'duo' });
    return true;
  };
  ws.onmessage(promotedFrame([{ id: 3, name: 'Guesty', token: 'abc<>' }, { id: 3, name: 'dup' }, { id: 99, name: 'bad' }]));
  assert.deepEqual(promo.guests, [{ id: 3, name: 'Guesty', token: 'abc' }]);
  assert.ok(room.started);
  assert.deepEqual([...room.clients.keys()], [3]);
  assert.equal(ws.sent.length, 0); // no welcome / lobby / started frames to guests already playing
  // host protocol on the same socket
  room.sendTo(3, { t: 'x' });
  assert.equal(ws.sent.at(-1), '3:{"t":"x"}');
  const got = [];
  room.onMessage = (c, m) => got.push([c.id, m.t]);
  ws.onmessage({ data: '3:' + JSON.stringify({ t: 'a', k: 'fire' }) });
  assert.deepEqual(got, [[3, 'a']]);
  // the app closing "the connection" closes the room
  conn.close();
  assert.ok(room.closed);
});

test('Net: nobody takes over -> the guest leaves as if the host had left', async () => {
  const { conn, ws } = await joined(2);
  let reason = null;
  conn.onClose = (r) => (reason = r);
  ws.onmessage(promotedFrame([{ id: 3, name: 'G' }]));
  assert.match(reason, /Host left/);
  assert.ok(ws.closed);
});

test('Net: a quiet (Box Fights) host room says no bye; others still do', async () => {
  const { conn } = await joined(2);
  const room = hostRoomFromGuest(Object.assign(conn, { promotion: { code: 'ABCD', guests: [{ id: 3, name: 'G' }] } }), { name: 'Me' });
  room.quietClose = true;
  room.close();
  assert.ok(!FakeWS.last.sent.some((d) => d.includes('"bye"')));
});

// ------------------------------------------------------------------ ClientSession takeover

function fakePuppet(o) {
  return { pos: new THREE.Vector3(1, 300, 2), heading: 0, alive: true, health: 100, shield: 50, kills: 0, character: null, dispose() {}, ...o };
}

function fakeGame() {
  const registered = new Set();
  return {
    registered,
    hud: { announce() {}, killFeed() {} },
    combat: { register: (a) => registered.add(a), unregister: (a) => registered.delete(a), swingPickaxe() {}, onBurstShot: null, onProjectileHit: null },
    world: {},
    player: { id: 2, name: 'Me', team: 0, kills: 1, inventory: new Inventory(boxLoadout()) },
    boxFight: { client: true, phase: 'fight', t: 0, round: 3, score: [1, 1], elims: [2, 1], state: { winRounds: 5 }, ffa: false, sides: [0, 1], mode: 'duo', botElo: 1600 },
    takeOverAsHost(host, plan) {
      this.took = { host, plan };
      const chars = this.net.releaseForTakeover(this, new Set(plan.remotes.map((r) => r.id)));
      this.net = host;
      host.adoptMatch(this, { remotes: plan.remotes.map((r) => ({ ...r, character: chars.get(r.id) || null })) });
      host.takeoverSync(this, { state: plan.state, left: plan.left, ended: plan.ended });
      return true;
    },
    structures: { exportNet: () => [['wall', 'wood', 1, 300, 2, 0, 150, 'k1', 0, '']], place() {}, damage() {}, edit() {}, editValue() {}, setDoor() {}, _destroy() {} },
  };
}

test('ClientSession: promoted -> becomes the host without ending the match', async () => {
  const { conn, ws } = await joined(2);
  const g = fakeGame();
  const s = new ClientSession(conn, g);
  g.net = s;
  s.started = true;
  s.boxFights = true;
  s.id = 2;
  s.puppets.set(0, fakePuppet({ id: 0, name: 'Hosty', human: true, team: 0, kills: 2, damageDealt: 300, buildsPlaced: 9 }));
  s.puppets.set(3, fakePuppet({ id: 3, name: 'Guesty', human: true, team: 1 }));
  s.puppets.set(4, fakePuppet({ id: 4, name: 'Bot Alpha', human: false, team: 1 }));
  for (const p of s.puppets.values()) g.combat.register(p);
  ws.onmessage(promotedFrame([{ id: 3, name: 'Guesty', token: 't3' }]));

  assert.ok(g.took, 'takeOverAsHost was called');
  const host = g.net;
  assert.ok(host instanceof HostSession);
  assert.equal(host.isHost, true);
  assert.equal(host.matchType, 'boxfights');
  assert.equal(host.boxOpts.botDifficulty, 'hard'); // from the start message's bot Elo
  const { plan } = g.took;
  assert.equal(plan.state.phase, 'fight');
  assert.deepEqual(plan.state.score, [1, 1]);
  assert.deepEqual(plan.bots.map((b) => [b.id, b.replaced]), [[0, 'Hosty'], [4, null]]);
  assert.equal(plan.bots[0].kills, 2);
  // the guest who stayed is a RemoteActor now; puppets are gone from combat
  assert.deepEqual([...host.remotes.keys()], [3]);
  assert.ok(g.registered.has(host.remotes.get(3)));
  assert.ok(![...g.registered].some((a) => a.isPuppet));
  assert.equal(s.puppets.size, 0);
  // one resync batch: old host replaced by a bot, then the match state with the structure list
  const ev = ws.sent.map((d) => (typeof d === 'string' && d.startsWith('*:') ? JSON.parse(d.slice(2)) : null)).filter(Boolean).at(-1);
  assert.equal(ev.t, 'ev');
  assert.deepEqual(ev.l.map((e) => e.e), ['left', 'rb', 'hm']);
  const hm = ev.l[2];
  assert.deepEqual([hm.rn, hm.ph, hm.sc], [3, 'fight', [1, 1]]);
  assert.equal(hm.bx.length, 1);
});

test('HostSession: a guest reports its inventory once after the takeover (clamped)', async () => {
  const { conn, ws } = await joined(2);
  const g = fakeGame();
  const s = new ClientSession(conn, g);
  g.net = s;
  s.started = true;
  s.boxFights = true;
  s.puppets.set(3, fakePuppet({ id: 3, name: 'Guesty', human: true, team: 1 }));
  ws.onmessage(promotedFrame([{ id: 3, name: 'Guesty' }]));
  const host = g.net;
  const report = { t: 'a', k: 'mig', seq: 40, s: [{ type: 'weapon', id: 'rifle', rarity: 'legendary', mag: 3 }, null, null, null, null], ammo: { medium: 5 }, mats: { wood: 77, brick: 0, metal: 0 } };
  ws.onmessage({ data: '3:' + JSON.stringify(report) });
  const inv = host.remotes.get(3).inventory;
  assert.equal(inv.slots[0].id, 'rifle');
  assert.equal(inv.slots[0].rarity, 'epic');
  assert.equal(inv.slots[0].mag, 3);
  assert.equal(inv.slots[1], null);
  assert.equal(inv.mats.wood, 77);
  assert.equal(inv.ammo.medium, 5);
  assert.equal(host.remotes.get(3).ack, 40);
  // a second report is ignored
  ws.onmessage({ data: '3:' + JSON.stringify({ ...report, seq: 41, mats: { wood: 500 } }) });
  assert.equal(inv.mats.wood, 77);
});

test('ClientSession: newHost resets snapshot state and reports our inventory', () => {
  const sent = [];
  const conn = { id: 4, send: (m) => sent.push(m), sendRaw() {}, close() {} };
  const g = fakeGame();
  const s = new ClientSession(conn, g);
  s.started = true;
  s.lastSeq = 812;
  s.offset = 3.2;
  s.snaps.push({});
  s.puppets.set(2, fakePuppet({ id: 2, name: 'NewHost', human: true }));
  s._message({ t: 'hostLost', graceMs: 10000 });
  s._message({ t: 'newHost', id: 2 });
  assert.equal(s.lastSeq, -1);
  assert.equal(s.offset, null);
  assert.equal(s.snaps.length, 0);
  const mig = sent.find((m) => m.k === 'mig');
  assert.ok(mig);
  assert.equal(mig.s[0].id, 'shotgun');
  assert.equal(s.lastInvSeq, mig.seq); // only the new host's answer to it is applied
});
