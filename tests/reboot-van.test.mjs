// Catfish Ken's reboot van: a card dropped mid-air lands on the ground (it used to hang where
// the player died, out of reach, so the van kept asking for a card); picking it up and holding
// interact at the van reboots the teammate in REBOOT.time (5 s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Reboot } from '../src/game/Reboot.js';
import { REBOOT } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));

function setup() {
  const world = new World(mapData);
  const rb = new Reboot({ world });
  rb.setup();
  rb.reset({ teamMode: true, authoritative: true });
  const v = rb.vans[0];
  const me = { id: 0, team: 0, name: 'me', alive: true, downed: false, pos: new THREE.Vector3(v.x + 20, v.y, v.z), rebootVan: null };
  const mate = { id: 1, team: 0, name: 'mate', alive: false, downed: false, pos: new THREE.Vector3(v.x + 20, v.y + 150, v.z) };
  return { world, rb, v, me, mate };
}

test('a reboot card from a teammate eliminated mid-air lands on the ground', () => {
  const { world, rb, me, mate } = setup();
  const card = rb.dropCard(mate, [me, mate]);
  const ground = world.groundHeight(mate.pos.x, mate.pos.z, mate.pos.y);
  assert.ok(Math.abs(card.y - ground) < 0.05, `card at ${card.y.toFixed(2)}, ground ${ground.toFixed(2)}`);
  me.pos.set(card.x, ground, card.z);
  assert.equal(rb.cardNear(me), card, 'reachable from the ground');
  assert.equal(rb.take(me, card), true);
  assert.equal(rb.cardsOf(me).length, 1);
});

test('holding interact at the van with the card reboots the teammate in 5 s', () => {
  const { rb, v, me, mate } = setup();
  const card = rb.dropCard(mate, [me, mate]);
  me.pos.set(card.x, card.y, card.z);
  rb.take(me, card);
  me.pos.set(v.x - v.fz * 2.3, v.y, v.z + v.fx * 2.3); // the serving side
  assert.equal(rb.vanNear(me), v);
  let rebooted = null;
  rb.onReboot = (victim) => {
    rebooted = victim;
    victim.alive = true;
  };
  me.rebootVan = v;
  assert.equal(REBOOT.time, 5);
  let t = 0;
  while (!rebooted && t < 10) {
    rb.update(1 / 30, [me, mate]);
    t += 1 / 30;
  }
  assert.equal(rebooted, mate);
  assert.ok(t > 4.9 && t < 5.2, `rebooted after ${t.toFixed(2)} s`);
  assert.equal(rb.cardsOf(me).length, 0, 'the card is used up');
});

test('rocket launchers: epic is the usual good find, legendary is rarer than before', async () => {
  const { rollWeapon, LOOT } = await import('../src/game/Loot.js');
  let seed = 12345;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [table, minEpic, maxLeg] of [[LOOT.floorRarity, 0.3, 0.02], [LOOT.chestRarity, 0.38, 0.045]]) {
    const n = { rare: 0, epic: 0, legendary: 0 };
    let total = 0;
    for (let i = 0; i < 200000 && total < 6000; i++) {
      const w = rollWeapon(rng, table);
      if (w.id !== 'rocket_launcher') continue;
      n[w.rarity]++;
      total++;
    }
    assert.ok(total > 1000, `rolled ${total} launchers`);
    assert.ok(n.epic / total > minEpic, `epic ${(n.epic / total).toFixed(3)}`);
    assert.ok(n.legendary / total < maxLeg, `legendary ${(n.legendary / total).toFixed(3)}`);
  }
});
