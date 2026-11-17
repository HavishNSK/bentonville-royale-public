import test from 'node:test';
import assert from 'node:assert/strict';
import { Reboot } from '../src/game/Reboot.js';
import { REBOOT, DROP_ZONES } from '../src/core/config.js';

// flat, empty world with every POI landmark spread out
function fakeWorld() {
  const landmarks = {};
  DROP_ZONES.forEach((z, i) => (landmarks[z.key] = { x: i * 200 - 500, z: 100, r: 60 }));
  const polys = [];
  return {
    landmarks,
    polys,
    inBounds: () => true,
    blockedAt: () => false,
    areaAt: () => null,
    interiorAt: () => null,
    terrainHeight: () => 0,
    groundHeight: () => 0,
    addPoly(corners, h, kind) {
      const c = { corners, h, kind };
      polys.push(c);
      return c;
    },
  };
}

function actor(id, team, x = 0, z = 0) {
  return { id, team, name: 'A' + id, alive: true, downed: false, pos: { x, y: 0, z } };
}

test('one van per POI, same spots on every machine, indestructible colliders', () => {
  const w1 = fakeWorld();
  const a = new Reboot({ world: w1 }).setup();
  const b = new Reboot({ world: fakeWorld() }).setup();
  assert.equal(a.length, DROP_ZONES.length);
  assert.deepEqual(a.map((v) => [v.x, v.z, v.heading]), b.map((v) => [v.x, v.z, v.heading]));
  assert.equal(w1.polys.length, DROP_ZONES.length);
  for (const p of w1.polys) assert.equal(p.hp, Infinity);
});

test('card -> pick up -> hold at van -> reboot, then the van cools down', () => {
  const rb = new Reboot({ world: fakeWorld() });
  rb.setup();
  rb.reset({ teamMode: true, authoritative: true });
  const events = [];
  rb.onEvent = (e) => events.push(e.e);
  const back = [];
  rb.onReboot = (victim, van, x, y, z) => {
    victim.alive = true;
    back.push([victim.id, van.i]);
  };
  const van = rb.vans[0];
  const mate = actor(1, 7, van.x + 50, van.z);
  const dead = actor(2, 7, van.x + 50, van.z + 1);
  const enemy = actor(3, 9, van.x + 50, van.z + 1);
  const all = [mate, dead, enemy];
  dead.alive = false;
  const card = rb.dropCard(dead, all);
  assert.ok(card);
  assert.equal(rb.cardNear(enemy), null, 'other teams cannot take it');
  assert.equal(rb.cardNear(mate), card);
  assert.ok(rb.take(mate, card));
  assert.equal(rb.cardsOf(mate).length, 1);
  // walk to the van's side and hold
  rb.standPoint(van, mate.pos);
  assert.equal(rb.vanNear(mate), van);
  mate.rebootVan = van;
  for (let t = 0; t < REBOOT.time + 0.5; t += 0.1) rb.update(0.1, all);
  assert.deepEqual(back, [[2, 0]]);
  assert.equal(rb.cards.size, 0);
  assert.ok(!rb.vanReady(van));
  assert.ok(rb.vanCooldown(van) > REBOOT.cooldown - 2);
  assert.deepEqual(events, ['rcd', 'rcp', 'rbu', 'rbd']);
});

test('letting go cancels; a dead carrier drops the card; no card without a standing teammate', () => {
  const rb = new Reboot({ world: fakeWorld() });
  rb.setup();
  rb.reset({ teamMode: true, authoritative: true });
  const van = rb.vans[1];
  const mate = actor(1, 4);
  const dead = actor(2, 4);
  const all = [mate, dead];
  dead.alive = false;
  const card = rb.dropCard(dead, all);
  rb.take(mate, card);
  rb.standPoint(van, mate.pos);
  mate.rebootVan = van;
  rb.update(1, all);
  mate.rebootVan = null; // let go
  rb.update(0.1, all);
  assert.equal(van.user, null);
  assert.equal(van.t, 0);
  mate.alive = false; // carrier dies: card falls where they were, but the team is gone -> removed
  rb.update(0.1, all);
  assert.equal(rb.cards.size, 0);
  // solo team: nobody to bring it in, no card
  const lone = actor(5, 11);
  lone.alive = false;
  assert.equal(rb.dropCard(lone, [lone]), null);
});

test('client mirror follows host events', () => {
  const host = new Reboot({ world: fakeWorld() });
  host.setup();
  host.reset({ teamMode: true, authoritative: true });
  const client = new Reboot({ world: fakeWorld() });
  client.setup();
  client.reset({ teamMode: true, authoritative: false });
  host.onEvent = (e) => client.applyEvent(e);
  host.onReboot = (v) => (v.alive = true);
  const mate = actor(1, 2);
  const dead = actor(2, 2);
  dead.alive = false;
  const card = host.dropCard(dead, [mate, dead]);
  assert.equal(client.cards.size, 1);
  host.take(mate, card);
  assert.equal(client.cards.get(2).holder, 1);
  const van = host.vans[2];
  host.standPoint(van, mate.pos);
  mate.rebootVan = van;
  for (let t = 0; t < REBOOT.time + 0.5; t += 0.1) host.update(0.1, [mate, dead]);
  assert.equal(client.cards.size, 0);
  assert.ok(!client.vanReady(client.vans[2]));
});
