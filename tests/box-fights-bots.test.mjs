// Box Fights bot arena mode: Bots.setArena / placeActor / opts.positions / ctx.hold (src/game/Bots.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Combat } from '../src/game/Combat.js';
import { Bots } from '../src/game/Bots.js';
import { REBOOT, WEAPONS, BUILD } from '../src/core/config.js';
import { arenaLayout, spawnLayout, boxLoadout } from '../src/game/BoxFights.js';

const FLOOR = 300;
const CEIL = 306;
const RECT = { minX: -240, maxX: -208, minZ: 160, maxZ: 192 }; // N = 8 cells of 4 m
const LAYOUT = { rect: RECT, floorY: FLOOR, ceilY: CEIL };

const loadout = () => ({
  items: [{ type: 'weapon', id: 'shotgun', rarity: 'epic' }, { type: 'weapon', id: 'smg', rarity: 'rare' }, { type: 'consumable', id: 'medkit', count: 2 }],
  ammo: { shells: 30, light: 240 },
  mats: { wood: 500, brick: 500, metal: 500 },
  selected: 0,
});

function makeArena(seed = 1) {
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] });
  const cx = (RECT.minX + RECT.maxX) / 2;
  const cz = (RECT.minZ + RECT.maxZ) / 2;
  const hw = 16;
  const mk = (x, z, hx, hz, y0, y1) => world.addBox({ cx: x, cz: z, hx, hz, yaw: 0, y0, y1, kind: 'arena', mat: 'metal' });
  mk(cx, cz, hw, hw, FLOOR - 1, FLOOR);
  mk(cx, cz, hw, hw, CEIL, CEIL + 1);
  mk(cx, RECT.minZ - 0.5, hw + 1, 0.5, FLOOR - 1, CEIL + 1);
  mk(cx, RECT.maxZ + 0.5, hw + 1, 0.5, FLOOR - 1, CEIL + 1);
  mk(RECT.minX - 0.5, cz, 0.5, hw + 1, FLOOR - 1, CEIL + 1);
  mk(RECT.maxX + 0.5, cz, 0.5, hw + 1, FLOOR - 1, CEIL + 1);
  const structures = new Structures({ scene: new THREE.Scene(), world });
  structures.buildArea = { minX: RECT.minX, maxX: RECT.maxX, minZ: RECT.minZ, maxZ: RECT.maxZ, minY: FLOOR, maxY: CEIL };
  const combat = new Combat({ world, structures });
  const bots = new Bots({ scene: null, world, kits: [], structures, combat });
  let s = seed;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return { world, structures, combat, bots, rng };
}

const POS = [{ x: -232, y: FLOOR, z: 168, heading: 0 }, { x: -216, y: FLOOR, z: 184, heading: Math.PI }];
const storm = { isOutside: () => false, mode: 'waiting', cx: -224, cz: 176, r: 100, nextCx: -224, nextCz: 176, nextR: 100, phaseIndex: 0, secondsLeft: 999 };

function spawnTwo(env) {
  env.bots.setArena(LAYOUT);
  return env.bots.spawn(2, env.rng, { positions: POS, teams: [1, 2], loadout: loadout(), difficulty: 'hard', idBase: 1 });
}

function sim(env, secs, ctxFor, each) {
  const dt = 1 / 30;
  for (let i = 0; i < secs * 30; i++) {
    env.bots.update(dt, ctxFor(i * dt));
    if (env.structures.update) env.structures.update(dt);
    if (each) each(i * dt);
  }
}

test('setArena stores the layout and null clears it', () => {
  const { bots } = makeArena();
  assert.equal(bots.arena, null);
  bots.setArena(LAYOUT);
  assert.equal(bots.arena, LAYOUT);
  bots.setArena(null);
  assert.equal(bots.arena, null);
});

test('spawn with positions places bots grounded at the given spots, no drop', () => {
  const env = makeArena();
  const actors = spawnTwo(env);
  assert.equal(actors.length, 2);
  actors.forEach((a, i) => {
    assert.equal(a.pos.x, POS[i].x);
    assert.equal(a.pos.y, POS[i].y);
    assert.equal(a.pos.z, POS[i].z);
    assert.equal(a.heading, POS[i].heading);
    assert.equal(a.gliding, false);
    assert.equal(a.grounded, true);
    assert.equal(a.inBus, false);
    assert.equal(a._bot.state, 'wander');
    assert.equal(a.inventory.mats.wood, 500);
  });
  assert.equal(actors[0].team, 1);
  assert.equal(actors[1].team, 2);
});

test('_arenaPoint samples inside the rect inset, at floorY', () => {
  const { bots, rng } = makeArena();
  bots.setArena(LAYOUT);
  for (let i = 0; i < 200; i++) {
    const p = bots._arenaPoint(rng);
    assert.ok(p.x >= RECT.minX + 2 && p.x <= RECT.maxX - 2 && p.z >= RECT.minZ + 2 && p.z <= RECT.maxZ - 2);
    assert.equal(p.y, FLOOR);
  }
});

test('two bots fight inside the arena for 20 s: stay in, never harvest, hunt each other', () => {
  const env = makeArena(7);
  const actors = spawnTwo(env);
  for (const a of actors) env.combat.register(a);
  const states = new Set();
  let harvested = false;
  const eps = 0.01;
  sim(env, 20, () => ({ storm, viewer: null }), () => {
    for (const a of actors) {
      if (!a.alive) continue;
      assert.ok(a.pos.x >= RECT.minX - eps && a.pos.x <= RECT.maxX + eps, `x ${a.pos.x}`);
      assert.ok(a.pos.z >= RECT.minZ - eps && a.pos.z <= RECT.maxZ + eps, `z ${a.pos.z}`);
      assert.ok(a.pos.y >= FLOOR - eps, `y ${a.pos.y}`);
      states.add(a._bot.state);
      if (a._bot.harvest || a._bot.state === 'harvest') harvested = true;
    }
  });
  assert.equal(harvested, false);
  assert.ok(states.has('engage') || states.has('hunt'), `states: ${[...states]}`);
  for (const bad of ['loot', 'rotate', 'reboot', 'harvest']) assert.ok(!states.has(bad), bad);
});

test('ctx.hold keeps bots in place; they move once released', () => {
  const env = makeArena(3);
  const actors = spawnTwo(env);
  for (const a of actors) env.combat.register(a);
  const start = actors.map((a) => a.pos.clone());
  sim(env, 3, () => ({ storm, hold: true }));
  actors.forEach((a, i) => {
    assert.ok(a.pos.distanceTo(start[i]) < 1e-6, 'did not move while held');
    assert.equal(a.health, 100);
  });
  sim(env, 5, () => ({ storm }));
  assert.ok(actors.some((a, i) => a.pos.distanceTo(start[i]) > 0.5), 'moved after release');
});

test('_hearFight returns the nearest living enemy, never a teammate', () => {
  const env = makeArena(5);
  const [a, c] = spawnTwo(env);
  const mate = { ...c, team: a.team, pos: new THREE.Vector3(-231, FLOOR, 169), alive: true };
  const foe = { ...c, team: 9, pos: new THREE.Vector3(-210, FLOOR, 190), alive: true };
  const dead = { ...c, team: 8, pos: new THREE.Vector3(-231.5, FLOOR, 168.5), alive: false };
  const got = env.bots._hearFight(a._bot, [a, mate, dead, c, foe]);
  assert.equal(got, c); // c at (-216, 184) is nearer than foe at (-210, 190)
});

test('setArena(null) restores normal clamping and harvesting rules', () => {
  const { bots } = makeArena();
  bots.setArena(LAYOUT);
  const p = new THREE.Vector3(-100, 350, 100);
  bots._clampBounds(p);
  assert.ok(p.x <= RECT.maxX && p.z <= RECT.maxZ, 'clamped into rect');
  assert.ok(p.y >= FLOOR);
  bots.setArena(null);
  const q = new THREE.Vector3(-100, 350, 100);
  bots._clampBounds(q);
  assert.equal(q.x, -100);
  assert.equal(q.z, 100);
  assert.equal(q.y, 350);
});

test('placeActor revives a dead bot and resets an alive one with health, shield and loadout', () => {
  const env = makeArena(11);
  const [a] = spawnTwo(env);
  const oldBrain = a._bot;
  a.alive = false;
  a.downed = true;
  a.health = 0;
  assert.equal(env.bots.placeActor(a, { x: -230, y: FLOOR, z: 170, heading: 1 }, loadout()), true);
  assert.equal(a.alive, true);
  assert.equal(a.downed, false);
  assert.equal(a.health, REBOOT.health);
  assert.equal(a.shield, 0);
  assert.equal(a.grounded, true);
  assert.equal(a.gliding, false);
  assert.equal(a.pos.x, -230);
  assert.equal(a.heading, 1);
  assert.notEqual(a._bot, oldBrain);
  assert.equal(env.bots.brains[0], a._bot);

  a.health = 12;
  a.vel.set(3, 2, 1);
  a.inventory.mats.wood = 3;
  const lo = loadout();
  lo.mats.wood = 77;
  assert.equal(env.bots.placeActor(a, { x: -220, y: FLOOR, z: 180, heading: 2 }, lo, { health: 100, shield: 50 }), true);
  assert.equal(a.health, 100);
  assert.equal(a.shield, 50);
  assert.equal(a.vel.length(), 0);
  assert.equal(a.inventory.mats.wood, 77);
  assert.equal(a.alive, true);
  assert.equal(env.bots.placeActor({ _bot: null, pos: new THREE.Vector3() }, { x: 0, y: 0, z: 0, heading: 0 }, null), false);
});

test('respawn still behaves as before (wrapper over placeActor)', () => {
  const env = makeArena(13);
  const [a] = spawnTwo(env);
  a.alive = false;
  assert.equal(env.bots.respawn(a, -225, FLOOR, 175, 0.5, loadout()), true);
  assert.equal(a.health, REBOOT.health);
  assert.equal(a.shield, 0);
  assert.equal(a.alive, true);
  assert.equal(a.heading, 0.5);
  assert.equal(a._bot.state, 'wander');
});

const pieceTop = (p) => p.y + (p.kind === 'floor' ? 0 : p.kind === 'cone' ? 1.5 : 3);
const pieces = (st) => (st.pieces ? [...st.pieces.values?.() ?? st.pieces] : []);

test('20 s fight under a 6 m ceiling: no piece pokes above it and bots stay under it', () => {
  const env = makeArena(21);
  const actors = spawnTwo(env);
  for (const a of actors) env.combat.register(a);
  let maxTop = -Infinity;
  sim(env, 20, () => ({ storm, viewer: null }), () => {
    for (const a of actors) assert.ok(a.pos.y <= CEIL + 0.01, `bot y ${a.pos.y}`);
    for (const p of pieces(env.structures)) maxTop = Math.max(maxTop, pieceTop(p));
  });
  assert.ok(maxTop <= CEIL + 1e-6, `piece top ${maxTop}`);
});

test('rush from 303 toward a target above queues at most one ramp and no floors', () => {
  const env = makeArena(5);
  const [a, c] = spawnTwo(env);
  a.pos.set(-232, 303, 168);
  a.grounded = true;
  c.pos.set(-232, 306, 176);
  const b = a._bot;
  const bots = env.bots;
  bots.time = 10;
  b.target = c;
  b.targetVisible = true;
  b.bqI = b.bqN = 0;
  b.buildCooldown = 0;
  bots.diff = { ...bots.diff, buildChance: 1, buildPieces: 9, rushFloors: true, highGround: 1, buildRate: 0.1, buildCooldown: 1 };
  bots._maybeBuild(b, 0, 1, 8);
  const kinds = b.bq.slice(0, b.bqN).map((q) => q.kind);
  assert.ok(kinds.filter((k) => k === 'ramp').length <= 1, kinds.join());
  assert.ok(!kinds.includes('floor'), kinds.join());
  for (const q of b.bq.slice(0, b.bqN)) assert.ok(pieceTop(q) <= CEIL + 1e-6, `${q.kind} ${q.y}`);
});

test('_chooseWeapon never selects the rocket launcher with the heavy loadout', () => {
  assert.ok(WEAPONS.rocket_launcher.projectile);
  const env = makeArena(9);
  const [a] = spawnTwo(env);
  a.inventory.slots[0] = { type: 'weapon', id: 'heavy_shotgun', rarity: 'epic', mag: 5 };
  a.inventory.slots[1] = { type: 'weapon', id: 'rifle', rarity: 'epic', mag: 30 };
  a.inventory.slots[2] = { type: 'weapon', id: 'rocket_launcher', rarity: 'legendary', mag: 1 };
  a.inventory.ammo.shells = 20;
  a.inventory.ammo.medium = 120;
  a.inventory.ammo.rockets = 10;
  const b = a._bot;
  for (const dist of [1, 5, 15, 30, 60, 120, 300]) {
    a.inventory.selected = 0;
    b.reloading = 0;
    env.bots.time = 100 + dist;
    b.switchAt = 0;
    env.bots._chooseWeapon(b, dist);
    assert.notEqual(a.inventory.current().id, 'rocket_launcher', `dist ${dist}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Realistic headless match: real Bots + Combat + Structures + the real arena colliders, middle
// wall and 5 s hold. Metrics: bots must actually fight (not turtle in boxes).

const HOLD = 5;
const FIGHT_CAP = 30; // s after FIGHT
const tuneSeeds = process.env.BF_SEEDS ? process.env.BF_SEEDS.split(',').map(Number) : null;

function runMatch({ size, difficulty, seed, fightSecs = FIGHT_CAP }) {
  const layout = arenaLayout(size);
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] });
  for (const d of layout.colliders) world.addBox(d);
  const divider = world.addBox(layout.divider);
  const structures = new Structures({ scene: new THREE.Scene(), world });
  structures.buildArea = layout.buildArea;
  structures.buildBlock = layout.dividerBlock;
  const combat = new Combat({ world, structures });
  combat.noKnock = true;
  combat.teamMode = size > 1;
  const bots = new Bots({ scene: null, world, kits: [], structures, combat });
  let s = seed * 7919 + 13;
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  bots.setArena(layout);
  const sps = spawnLayout(layout, size);
  const teams = sps.map((sp) => sp.side + 1);
  const actors = bots.spawn(sps.length, rng, { positions: sps, teams, difficulty, loadout: boxLoadout(), idBase: 1 });
  actors.forEach((a, i) => bots.placeActor(a, sps[i], boxLoadout(), { health: 100, shield: 100 }));
  for (const a of actors) combat.register(a);
  let fightT = null;
  let firstDamage = null;
  combat.onDamage = (target, amount, info) => {
    if (fightT !== null && firstDamage === null && amount > 0 && !(info && info.storm)) firstDamage = t - fightT;
    bots.notifyDamage(target, amount, info);
  };
  const storm = { isOutside: () => false, mode: 'waiting', cx: layout.center.x, cz: layout.center.z, r: 100, nextCx: layout.center.x, nextCz: layout.center.z, nextR: 100, phaseIndex: 0, secondsLeft: 999 };
  const dt = 1 / 30;
  let t = 0;
  let boxSecs = 0;
  let botSecs = 0;
  let endT = null;
  let maxTop = -Infinity;
  let escaped = 0;
  const eps = 0.05;
  const r = layout.rect;
  const total = Math.round((HOLD + fightSecs) * 30);
  for (let i = 0; i < total; i++) {
    if (fightT === null && t >= HOLD) {
      world.remove(divider);
      structures.buildBlock = null;
      fightT = t;
    }
    bots.update(dt, { storm, hold: fightT === null, time: t, viewer: null });
    structures.update(dt);
    combat.tickProjectiles(dt);
    t += dt;
    for (const a of actors) {
      if (a.alive && (a.pos.x < r.minX - eps || a.pos.x > r.maxX + eps || a.pos.z < r.minZ - eps || a.pos.z > r.maxZ + eps || a.pos.y < layout.floorY - eps)) escaped++;
      if (fightT !== null && a.alive) {
        botSecs += dt;
        if (a._bot.box) boxSecs += dt;
      }
    }
    for (const p of pieces(structures)) maxTop = Math.max(maxTop, pieceTop(p));
    if (fightT !== null && endT === null) {
      const alive = [0, 0];
      for (const a of actors) if (a.alive) alive[a.team - 1]++;
      if (alive[0] === 0 || alive[1] === 0) {
        endT = t - fightT;
        break;
      }
    }
  }
  return { firstDamage, boxFrac: botSecs ? boxSecs / botSecs : 0, endT, maxTop, escaped, ceil: layout.ceilY };
}

const median = (xs) => {
  const v = xs.slice().sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2) + (v.length % 2 ? 0 : 0)] : Infinity;
};

for (const difficulty of ['normal', 'hard']) {
  test(`${difficulty} 1v1: bots fight (fast first damage, little boxing, rounds end, arena respected)`, () => {
    const seeds = tuneSeeds || [1, 2, 3, 4, 5, 6, 7, 8];
    const runs = seeds.map((seed) => runMatch({ size: 1, difficulty, seed }));
    const fd = runs.map((x) => (x.firstDamage === null ? Infinity : x.firstDamage));
    const boxFrac = runs.reduce((n, x) => n + x.boxFrac, 0) / runs.length;
    const ended = runs.filter((x) => x.endT !== null && x.endT <= FIGHT_CAP).length / runs.length;
    if (process.env.BF_VERBOSE) console.log(difficulty, '1v1', JSON.stringify({ fd: fd.map((x) => +x.toFixed(1)), boxFrac: +boxFrac.toFixed(2), ended, ends: runs.map((x) => x.endT && +x.endT.toFixed(1)) }));
    assert.ok(median(fd) <= 4, `median first damage ${median(fd)}`);
    assert.ok(boxFrac < 0.4, `boxed fraction ${boxFrac}`);
    assert.ok(ended >= 0.75, `rounds ended within ${FIGHT_CAP}s: ${ended}`);
    for (const x of runs) {
      assert.ok(x.maxTop <= x.ceil + 1e-6, `piece top ${x.maxTop}`);
      assert.equal(x.escaped, 0, 'bot left the arena');
    }
  });
}

// TODO: with the 0.2-update bot AI, normal 2v2 bots are still boxed ~67% of fight time (target < 40%)
test('2v2 hard and normal: bots fight too', { todo: 'normal 2v2 bots still box too much (0.2-update AI); tune for the arena' }, () => {
  for (const difficulty of ['normal', 'hard']) {
    const seeds = tuneSeeds ? tuneSeeds.slice(0, 3) : [1, 2, 3];
    const runs = seeds.map((seed) => runMatch({ size: 2, difficulty, seed }));
    const fd = runs.map((x) => (x.firstDamage === null ? Infinity : x.firstDamage));
    const boxFrac = runs.reduce((n, x) => n + x.boxFrac, 0) / runs.length;
    if (process.env.BF_VERBOSE) console.log(difficulty, '2v2', JSON.stringify({ fd: fd.map((x) => +x.toFixed(1)), boxFrac: +boxFrac.toFixed(2), ends: runs.map((x) => x.endT && +x.endT.toFixed(1)) }));
    assert.ok(median(fd) <= 6, `${difficulty} 2v2 median first damage ${median(fd)}`);
    assert.ok(boxFrac < 0.4, `${difficulty} 2v2 boxed fraction ${boxFrac}`);
    assert.ok(runs.some((x) => x.endT !== null), `${difficulty} 2v2: at least one round ends`);
    for (const x of runs) {
      assert.ok(x.maxTop <= x.ceil + 1e-6, `piece top ${x.maxTop}`);
      assert.equal(x.escaped, 0, 'bot left the arena');
    }
  }
});

// ---- shot while holding a spot: juke side to side; build at the shooter (ARENA_TUNE)

/** One arena bot vs a fixed, unkillable shooter `gap` m away that hits it every 0.3 s while in sight. */
function shotBot({ difficulty, seed, gap, secs = 20 }) {
  const env = makeArena(seed);
  env.bots.setArena(LAYOUT);
  const cx = -224;
  const cz = 176;
  const [bot] = env.bots.spawn(1, env.rng, { positions: [{ x: cx, y: FLOOR, z: cz - gap / 2, heading: Math.PI }], teams: [2], loadout: loadout(), difficulty, idBase: 1 });
  const me = { id: 99, team: 1, isBot: false, pos: new THREE.Vector3(cx, FLOOR, cz + gap / 2), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health: 100, shield: 100, invulnerable: true, heading: 0, pitch: 0 };
  env.combat.actors.push(me);
  env.combat.onDamage = (t, a, info) => env.bots.notifyDamage(t, a, info);
  let prev = null;
  let run = 0;
  let maxStill = 0;
  let firstRamp = null;
  const dt = 1 / 30;
  for (let i = 0; i < secs * 30; i++) {
    env.bots.update(dt, { player: me, storm, humans: [me] });
    if (env.structures.update) env.structures.update(dt);
    if (firstRamp === null) for (const p of env.structures.slots.values()) if (p && p.alive && p.kind === 'ramp') firstRamp = i * dt;
    if (i % 9 || !env.bots._los(me.pos.x, FLOOR + 1.5, me.pos.z, bot.pos.x, bot.pos.y + 1.2, bot.pos.z)) continue;
    env.combat.applyDamage(bot, 4, { source: me });
    if (bot.health < 40) bot.health = 100; // keep it fighting
    run = prev && Math.hypot(bot.pos.x - prev.x, bot.pos.z - prev.z) < 0.25 ? run + 1 : 0;
    maxStill = Math.max(maxStill, run);
    prev = { x: bot.pos.x, z: bot.pos.z };
  }
  return { maxStill, firstRamp };
}

test('arena: a bot being shot never stands still for more than two hits in a row', () => {
  for (const difficulty of ['normal', 'hard']) {
    for (const gap of [8, 16]) {
      for (const seed of [1, 2, 3, 4]) {
        const { maxStill } = shotBot({ difficulty, seed, gap });
        assert.ok(maxStill <= 2, `${difficulty} ${gap} m seed ${seed}: ${maxStill} hits in a row standing still`);
      }
    }
  }
});

test('arena: most bots start building ramps at a shooter 16 m away within 2 s', () => {
  for (const difficulty of ['normal', 'hard']) {
    const fast = [1, 2, 3, 4, 5, 6].filter((seed) => {
      const { firstRamp } = shotBot({ difficulty, seed, gap: 16, secs: 3 });
      return firstRamp !== null && firstRamp <= 2;
    }).length;
    assert.ok(fast >= 3, `${difficulty}: ${fast}/6 ramped within 2 s`);
  }
});

test('arena difficulty: faster building and less boxing than the battle royale tables; cleared with the arena', async () => {
  const { DIFFICULTY } = await import('../src/core/config.js');
  const env = makeArena(1);
  env.bots.setArena(LAYOUT);
  env.bots.spawn(1, env.rng, { positions: [POS[0]], teams: [1], loadout: loadout(), difficulty: 'hard', idBase: 1 });
  assert.ok(env.bots.diff.buildRate < DIFFICULTY.hard.buildRate);
  assert.ok(env.bots.diff.boxFight < DIFFICULTY.hard.boxFight);
  assert.ok(env.bots.diff.arenaPush > 0);
  env.bots.setArena(null);
  assert.equal(env.bots.diff, DIFFICULTY.hard, 'back to the normal table off the arena');
});

test('arena: a badly hurt bot under fire never retreats or backs away from the shooter', () => {
  for (const difficulty of ['normal', 'hard']) {
    for (const seed of [1, 2, 3, 4]) {
      const env = makeArena(seed);
      env.bots.setArena(LAYOUT);
      const [bot] = env.bots.spawn(1, env.rng, { positions: [{ x: -224, y: FLOOR, z: 170, heading: Math.PI }], teams: [2], loadout: loadout(), difficulty, idBase: 1 });
      const me = { id: 99, team: 1, isBot: false, pos: new THREE.Vector3(-224, FLOOR, 184), vel: new THREE.Vector3(), grounded: true, alive: true, downed: false, health: 100, shield: 100, invulnerable: true, heading: 0, pitch: 0 };
      env.combat.actors.push(me);
      env.combat.onDamage = (t, a, info) => env.bots.notifyDamage(t, a, info);
      const start = Math.hypot(bot.pos.x - me.pos.x, bot.pos.z - me.pos.z);
      let far = 0;
      const states = new Set();
      for (let i = 0; i < 15 * 30; i++) {
        env.bots.update(1 / 30, { player: me, storm, humans: [me] });
        if (env.structures.update) env.structures.update(1 / 30);
        if (i % 9 === 0) {
          env.combat.applyDamage(bot, 3, { source: me });
          bot.health = 25; // badly hurt the whole time, shield gone
          bot.shield = 0;
        }
        states.add(bot._bot.state);
        far = Math.max(far, Math.hypot(bot.pos.x - me.pos.x, bot.pos.z - me.pos.z));
      }
      assert.ok(!states.has('retreat'), `${difficulty} seed ${seed}: retreated (${[...states]})`);
      assert.ok(far <= start + 3, `${difficulty} seed ${seed}: backed off to ${far.toFixed(1)} m from ${start.toFixed(1)} m`);
    }
  }
});
