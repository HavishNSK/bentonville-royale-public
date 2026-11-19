// A player who boxes up / walls off is not forgotten: the bot walks up and pickaxes through.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Bots } from '../src/game/Bots.js';
import { Combat } from '../src/game/Combat.js';
import { WEAPONS, makeRng } from '../src/core/config.js';

function sim(difficulty) {
  const world = new World({ meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] });
  const structures = new Structures({ scene: new THREE.Scene(), world });
  const bots = new Bots({ world, structures });
  bots.combat = new Combat({ world, structures }); // the pickaxe swings land (authoritative)
  const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: {}, selected: 0 };
  bots.spawn(1, makeRng(5), { difficulty, dropPoints: [{ x: 0, z: 0 }], loadout });
  const bot = bots.actors[0];
  const b = bot._bot;
  bot.pos.set(2, world.groundHeight(2, 14, 50), 14);
  Object.assign(bot, { gliding: false, grounded: true, inBus: false });
  b.launchAt = 0;
  b.landedAt = 0;
  b.state = 'wander';
  const player = {
    id: 500, team: 500, isPlayer: true, alive: true, grounded: true, radius: 0.42, height: 1.8, health: 100, shield: 0,
    pos: new THREE.Vector3(2, 0, 2), vel: new THREE.Vector3(),
  };
  const step = (secs) => {
    for (let i = 0; i < secs * 60; i++) bots.update(1 / 60, { player });
  };
  return { world, structures, bots, bot, b, player, step };
}

test('box up mid-fight: the bot keeps after you and pickaxes into the box instead of walking away', () => {
  const { structures: st, bots, bot, b, player, step } = sim('normal');
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  step(1);
  assert.equal(b.target, player);
  // the player boxes up: four walls and a roof of their own around their cell
  for (const h of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) st.place(st.plan('wall', player.pos, h, 0), 'wood', player);
  st.place(st.plan('cone', player.pos, 0, 0.8), 'wood', player);
  const walls = st.pieces.filter((p) => p.owner === player && p.kind === 'wall');
  const hp0 = walls.map((w) => w.hp);
  const states = new Set();
  let sawAgain = false;
  for (let i = 0; i < 15 * 60; i++) {
    bots.update(1 / 60, { player });
    states.add(b.state);
    if (b.targetVisible && b.target === player) sawAgain = true;
  }
  assert.ok(!states.has('wander') && !states.has('loot'), `states: ${[...states]}`);
  assert.equal(b.target, player, 'still after them');
  const broke = walls.some((w, i) => !w.alive || w.hp < hp0[i]);
  assert.ok(broke, 'it went at the box walls');
  assert.ok(walls.some((w) => !w.alive), 'and broke one open');
  assert.ok(sawAgain, 'then it had eyes on them again (and the normal fight takes over)');
});

test('out of mats mid-fight with the enemy out of sight, a bot farms the nearest tree, then has wood', () => {
  const { world, bots, bot, b, player, step } = sim('hard');
  // a tree 5 m from the bot (harvestable circle collider, like Scatter's)
  const tree = world.addCircle(bot.pos.x + 5, bot.pos.z, 0.6, 6, 'tree', 'wood', 300, []);
  step(0.2);
  bots.notifyDamage(bot, 10, { source: player });
  player.pos.set(150, 0, 150); // far off and out of sight
  bots._los = () => false;
  const states = new Set();
  for (let i = 0; i < 10 * 60; i++) {
    bots.update(1 / 60, { player });
    states.add(b.state);
  }
  assert.ok(states.has('harvest'), `farmed mid-fight: ${[...states]}`);
  const m = bot.inventory.mats;
  assert.ok(m.wood + m.brick + m.metal > 0, 'has mats now');
});

test('no mats, enemy in plain sight 25 m off but not shooting: it farms (then it can build)', () => {
  const { world, bots, bot, b, player } = sim('hard');
  world.addCircle(bot.pos.x - 5, bot.pos.z, 0.6, 6, 'tree', 'wood', 300, []);
  player.pos.set(bot.pos.x, 0, bot.pos.z - 25);
  b.target = player;
  b.state = 'engage';
  b.targetVisible = true;
  b.lastSeen = bots.time;
  bots._los = () => true; // in plain sight the whole time
  const states = new Set();
  for (let i = 0; i < 10 * 60; i++) {
    bots.update(1 / 60, { player });
    states.add(b.state);
  }
  assert.ok(states.has('harvest'), `farmed: ${[...states]}`);
  const m = bot.inventory.mats;
  assert.ok(m.wood + m.brick + m.metal > 0, 'has mats now');
});

test('farming is spread over time: ~80-mat sessions with rests in between, not one burst', () => {
  const { world, bots, bot, b, player } = sim('normal');
  // trees all over, like the real map (one every ~14 m)
  for (let x = -150; x <= 150; x += 14) for (let z = -150; z <= 150; z += 14) world.addCircle(x + 5, z + 3, 0.6, 6, 'tree', 'wood', 2000, []);
  player.pos.set(180, 0, 180); // nobody around
  player.alive = false;
  const total = () => { const m = bot.inventory.mats; return m.wood + m.brick + m.metal; };
  const at = [];
  for (let s = 0; s < 90; s++) {
    for (let i = 0; i < 60; i++) bots.update(1 / 60, { player });
    at.push(total());
  }
  // the first session stops around FARM_SESSION, well short of everything at once
  const firstStop = at.findIndex((v, i) => i > 0 && v > 0 && at[i + 5] === v);
  assert.ok(firstStop > 0, `a session ended: ${at.join(',')}`);
  assert.ok(at[firstStop] >= 60 && at[firstStop] <= 120, `first session gathered ${at[firstStop]}`);
  // and later it farms again (mats keep growing over the minute and a half)
  assert.ok(at[at.length - 1] > at[firstStop] + 40, `more later: ${at[firstStop]} -> ${at[at.length - 1]}`);
});
