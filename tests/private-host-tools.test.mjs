// Private-match host tools (src/game/hostTools.js): the host of a private match can spawn bots
// and drop chosen loot from the M map; clients, matchmade hosts, solo and sandbox cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { Loot } from '../src/game/Loot.js';
import { makeRng } from '../src/core/config.js';
import { canSandboxBots, canSandboxLoadout, spawnSandboxBot, SANDBOX_BOT_DIST } from '../src/game/sandboxLoadout.js';
import {
  HOST_BOT_CAP, HOST_BOT_MAX_ID, canHostTools, hostBotStatus, spawnHostBot, clearHostBots, dropHostLoot, hostLootItems,
} from '../src/game/hostTools.js';

// The net modules pull in UI code that imports CSS (Vite); stub .css for Node, as inventory-reorder does.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      "export async function load(url, ctx, next) { if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }; return next(url, ctx); }"
    )
);
const { HostSession } = await import('../src/net/HostSession.js');
const { ClientSession } = await import('../src/net/ClientSession.js');

function fakeCombat() {
  return {
    actors: [],
    register(a) {
      if (!this.actors.includes(a)) this.actors.push(a);
    },
    unregister(a) {
      const i = this.actors.indexOf(a);
      if (i >= 0) this.actors.splice(i, 1);
    },
    swingPickaxe() {},
  };
}

/** A host's game in a started private match, with a real HostSession (no room traffic). */
function hostMatch({ privateMatch = true, matchBots = 3 } = {}) {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const scene = new THREE.Scene();
  const structures = new Structures({ scene, world });
  const combat = fakeCombat();
  const bots = new Bots({ world, structures });
  bots.combat = combat;
  const player = {
    id: 0, team: 0, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0, heading: 0,
    pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), name: 'Host',
  };
  combat.register(player);
  for (let i = 0; i < matchBots; i++) bots.addBot('normal', 40 + i * 5, 40, { id: 2 + i, sandbox: false });
  const loot = new Loot({ scene, world });
  const game = {
    freeBuild: false, museumMode: false, state: 'play', teamMode: false, bots, world, player, combat, loot, structures,
    rng: makeRng(3), totalActors: 2 + matchBots, grenades: null,
  };
  const sent = [];
  const room = { clients: new Map(), broadcast: (msg) => (sent.push(msg), 0), name: 'Host' };
  const net = new HostSession(room, game, { mode: 'solo', privateMatch });
  net._wrap(game); // what prepareMatch does: loot / structures report to the event queue
  net.started = true;
  net._botIdBase = 2;
  game.net = net;
  return { game, net, bots, combat, loot, player, sent };
}

test('gating: only the host of a started private match, playing, gets the tools', () => {
  assert.equal(canHostTools(hostMatch().game), true, 'private-match host');
  assert.equal(canHostTools(hostMatch({ privateMatch: false }).game), false, 'matchmade / public host');
  const client = { freeBuild: false, state: 'play', net: { isHost: false, isClient: true, privateMatch: true, started: true } };
  assert.equal(canHostTools(client), false, 'client');
  assert.equal(canHostTools({ freeBuild: false, state: 'play', net: null }), false, 'solo');
  assert.equal(canHostTools({ freeBuild: true, state: 'play', net: null }), false, 'sandbox');
  for (const over of [{ state: 'drop' }, { state: 'over' }, { freeBuild: true }]) {
    const { game } = hostMatch();
    Object.assign(game, over);
    assert.equal(canHostTools(game), false, JSON.stringify(over));
  }
  const { game, net } = hostMatch();
  net.started = false;
  assert.equal(canHostTools(game), false, 'before the match starts');
  net.started = true;
  net.ended = true;
  assert.equal(canHostTools(game), false, 'after it ends');
  assert.equal(new HostSession({}, {}, {}).privateMatch, false, 'HostSession defaults to not private');
});

test('refused everywhere else: no bot, no loot, nothing on the wire', () => {
  for (const g of [hostMatch({ privateMatch: false }), (() => {
    const h = hostMatch();
    h.net.isHost = false;
    h.net.isClient = true;
    return h;
  })()]) {
    const before = g.bots.list.length;
    assert.equal(spawnHostBot(g.game, 'hard').bot, null);
    assert.equal(g.bots.list.length, before);
    assert.deepEqual(dropHostLoot(g.game, 'rifle'), []);
    assert.equal(g.loot.records.length, 0);
    assert.equal(clearHostBots(g.game), 0);
    assert.equal(g.net.events.length, 0);
    assert.equal(hostBotStatus(g.game).canSpawn, false);
  }
});

test('sandbox is unchanged: sandbox tools stay sandbox-only and refuse a private match', () => {
  const { game, bots } = hostMatch();
  assert.equal(canSandboxBots(game), false);
  assert.equal(canSandboxLoadout(game), false);
  const before = bots.list.length;
  assert.equal(spawnSandboxBot(game, 'easy').bot, null);
  assert.equal(bots.list.length, before);
});

test('a host bot is a normal hostile match bot, replicated to clients with an ab event', () => {
  const { game, net, combat, player } = hostMatch();
  const total = game.totalActors;
  const { bot, reason } = spawnHostBot(game, 'hard');
  assert.equal(reason, null);
  assert.ok(bot && bot.alive && bot.hostSpawned);
  assert.equal(bot.sandbox, false, 'not a sandbox bot');
  assert.equal(bot.team, bot.id, 'its own team: hostile to everyone');
  assert.ok(bot.id > 4 && bot.id <= HOST_BOT_MAX_ID, `fresh one-byte id ${bot.id}`);
  assert.ok(combat.actors.includes(bot), 'in Combat: counts for alive / win and gets snapshotted');
  assert.equal(game.totalActors, total + 1);
  const d = Math.hypot(bot.pos.x - player.pos.x, bot.pos.z - player.pos.z);
  assert.ok(Math.abs(d - SANDBOX_BOT_DIST) <= 1 + 1e-6, `distance ${d}`);
  const ev = net.events.find((e) => e.e === 'ab');
  assert.ok(ev, 'ab event queued');
  assert.equal(ev.id, bot.id);
  assert.equal(ev.n, bot.name);
  assert.equal(ev.h, 0);
  assert.equal(ev.tm, bot.team);
  assert.equal(ev.tot, game.totalActors);
  assert.ok(net._actorRows().some((r) => r.id === bot.id), 'in the snapshot rows');
  assert.equal(spawnHostBot(game, 'insane').bot, null, 'unknown difficulty');
});

test(`cap ${HOST_BOT_CAP} live host bots; dead ones are removed (rb) when the next spawns`, () => {
  const { game, net, bots } = hostMatch();
  for (let i = 0; i < HOST_BOT_CAP; i++) assert.ok(spawnHostBot(game, ['easy', 'normal', 'hard'][i % 3]).bot, `bot ${i}`);
  let st = hostBotStatus(game);
  assert.equal(st.count, HOST_BOT_CAP);
  assert.equal(st.canSpawn, false);
  assert.match(st.reason, /limit/i);
  assert.equal(spawnHostBot(game, 'hard').bot, null);
  const dead = bots.list.find((a) => a.hostSpawned);
  dead.alive = false;
  st = hostBotStatus(game);
  assert.equal(st.canSpawn, true);
  assert.equal(st.bodies, 1);
  net.events.length = 0;
  const { bot } = spawnHostBot(game, 'easy');
  assert.ok(bot);
  assert.ok(!bots.list.includes(dead), 'body removed');
  assert.deepEqual(net.events.find((e) => e.e === 'rb').ids, [dead.id]);
  assert.ok(bot.id > dead.id, 'ids are never reused in a match');
});

test('clear removes only the host bots and tells clients', () => {
  const { game, net, bots, combat } = hostMatch();
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(spawnHostBot(game, 'normal').bot.id);
  net.events.length = 0;
  assert.equal(clearHostBots(game), 4);
  assert.equal(bots.list.length, 3, 'the match bots stay');
  assert.ok(bots.list.every((a) => !a.hostSpawned));
  assert.ok(combat.actors.every((a) => !a.hostSpawned));
  assert.deepEqual(net.events.find((e) => e.e === 'rb').ids.sort((a, b) => a - b), ids);
});

test('no spawn once the one-byte actor id space is used up', () => {
  const { game, combat } = hostMatch();
  combat.register({ id: HOST_BOT_MAX_ID, alive: true });
  const r = spawnHostBot(game, 'easy');
  assert.equal(r.bot, null);
  assert.ok(r.reason);
});

test('chosen loot lands as a replicated floor record in front of the host', () => {
  const { game, net, loot, player, sent } = hostMatch();
  const ids = dropHostLoot(game, 'rifle');
  assert.equal(ids.length, 2, 'gun + ammo');
  const recs = ids.map((id) => loot.byId.get(id));
  assert.ok(recs.every((r) => r && r.kind === 'item'));
  assert.equal(recs[0].item.type, 'weapon');
  assert.equal(recs[0].item.id, 'rifle');
  assert.equal(recs[1].item.type, 'ammo');
  for (const r of recs) assert.ok(r.z < player.pos.z, 'in front (heading 0 = north = -z)');
  net._flushEvents();
  const la = sent.flatMap((m) => m.l || []).filter((e) => e.e === 'la');
  assert.deepEqual(la.map((e) => e.id).sort((a, b) => a - b), ids.slice().sort((a, b) => a - b), 'clients get every record');
  assert.equal(la.find((e) => e.id === ids[0]).it.id, 'rifle');
  assert.equal(hostLootItems('grenade')[0].type, 'consumable');
  assert.deepEqual(hostLootItems('not_a_gun'), []);
  assert.deepEqual(dropHostLoot(game, '__proto__'), []);
});

test('client: ab adds a sanitized bot puppet, rb removes bot puppets only', () => {
  const cs = Object.create(ClientSession.prototype);
  const combat = fakeCombat();
  cs.puppets = new Map();
  cs.id = 1;
  cs.game = { kits: {}, scene: new THREE.Scene(), combat, weaponScenes: null, totalActors: 5 };
  cs._addPuppet(cs.game, { id: 3, n: 'Friend', k: 'player', c: 0xffffff, h: 1, tm: 3 }); // a human
  cs._event({ e: 'ab', id: 40, n: '<img src=x>\u0007Hard Bot 1 with a very long name indeed', k: '__proto__', c: 'red', tm: 40, h: 1, tot: 6 });
  const pup = cs.puppets.get(40);
  assert.ok(pup);
  assert.equal(pup.human, false, 'never a human');
  assert.ok(!/[<>\u0007]/.test(pup.name) && pup.name.length <= 24, pup.name);
  assert.ok(combat.actors.includes(pup));
  assert.equal(cs.game.totalActors, 6);
  cs._event({ e: 'ab', id: 1, n: 'me' });
  cs._event({ e: 'ab', id: 300, n: 'big' });
  cs._event({ e: 'ab', id: 40, n: 'dup' });
  assert.equal(cs.puppets.size, 2, 'own id, out-of-range and duplicate ids ignored');
  cs._event({ e: 'rb', ids: [40, 3, 1, 999] });
  assert.ok(!cs.puppets.has(40));
  assert.ok(cs.puppets.has(3), 'humans are never removed');
  assert.ok(!combat.actors.includes(pup));
  cs._event({ e: 'rb', ids: 'nope' });
});
