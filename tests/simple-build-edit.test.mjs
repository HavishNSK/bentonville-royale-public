import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Structures, PRESETS, PRESET_ORDER, simpleEditMask, validEdit } from '../src/game/Structures.js';
import { World } from '../src/world/World.js';
import { sanitizeSettings, DEFAULT_SETTINGS, DEFAULT_BINDINGS } from '../src/ui/settings.js';

function setup() {
  const world = new World({ meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], landmarks: {} });
  return new Structures({ scene: new THREE.Scene(), world });
}

test('every preset plans valid pieces around the own cell and places in full', () => {
  for (const name of PRESET_ORDER) {
    const st = setup();
    const list = st.planPreset(name, { x: 2, y: 0, z: 2 }, 0.3);
    assert.equal(list.length, PRESETS[name].parts.length, name);
    assert.ok(list.every((pl) => pl.valid), `${name}: ${list.map((p) => p.kind + ':' + p.valid).join(' ')}`);
    for (const pl of list) assert.ok(st.place(pl, 'wood', null), `${name} ${pl.kind}`);
    assert.equal(st.count, list.length);
    // every piece touches the player's own cell (x, z in 0..4)
    for (const p of st.pieces) assert.ok(p.x >= 0 && p.x <= 4 && p.z >= 0 && p.z <= 4, `${name} ${p.kind} at ${p.x},${p.z}`);
  }
});

test('a box is four walls and a cone roof one level up; the ramp + wall faces where you look', () => {
  const st = setup();
  const box = st.planPreset('box', { x: 2, y: 0, z: 2 }, 0);
  const walls = box.filter((p) => p.kind === 'wall');
  assert.equal(new Set(walls.map((w) => w.key)).size, 4);
  const cone = box.find((p) => p.kind === 'cone');
  assert.equal(cone.y, 3);
  const rw = st.planPreset('rampwall', { x: 2, y: 0, z: 2 }, 0); // facing north (-z)
  const wall = rw.find((p) => p.kind === 'wall');
  assert.equal(wall.z, 0, 'wall on the north edge of the own cell');
  assert.equal(rw.find((p) => p.kind === 'ramp').z, 2, 'ramp in the own cell');
});

test('a preset next to existing builds skips the taken slots', () => {
  const st = setup();
  for (const pl of st.planPreset('cover', { x: 2, y: 0, z: 2 }, 0)) st.place(pl, 'wood', null);
  const box = st.planPreset('box', { x: 2, y: 0, z: 2 }, 0);
  assert.equal(box.filter((p) => !p.valid).length, 3, 'the three cover walls are already there');
});

test('simple edit: one click makes the common shape; clicking it again resets', () => {
  const DOOR = (1 << 1) | (1 << 4);
  assert.equal(simpleEditMask('wall', 1), DOOR, 'bottom centre: door');
  assert.equal(simpleEditMask('wall', 0), (1 << 0) | (1 << 3), 'bottom left: side door');
  assert.equal(simpleEditMask('wall', 4), 1 << 4, 'centre: window');
  assert.equal(simpleEditMask('wall', 7), (1 << 6) | (1 << 7) | (1 << 8), 'top centre: half wall');
  assert.equal(simpleEditMask('wall', 6), simpleEditMask('wall', 8), 'top corners: arch');
  for (let t = 0; t < 9; t++) assert.ok(validEdit('wall', simpleEditMask('wall', t)), `wall tile ${t}`);
  for (let t = 0; t < 4; t++) {
    assert.equal(simpleEditMask('floor', t), 1 << t);
    assert.ok(validEdit('cone', simpleEditMask('cone', t)));
  }
  assert.equal(simpleEditMask('ramp', 0, 3), 0, 'ramp: a quarter turn');
  assert.equal(simpleEditMask('wall', 1, DOOR, 0), 0, 'the door again: back as placed');
  assert.equal(simpleEditMask('wall', 9), -1);
  assert.equal(simpleEditMask('floor', -1), -1);
});

test('simple build / simple edit are settings (off by default) with a rebindable preset key', () => {
  assert.equal(DEFAULT_SETTINGS.simpleEdit, false);
  assert.equal(DEFAULT_SETTINGS.simpleBuild, false);
  const s = sanitizeSettings({ simpleEdit: true, simpleBuild: 'yes' });
  assert.equal(s.simpleEdit, true);
  assert.equal(s.simpleBuild, false, 'non-booleans fall back');
  assert.equal(DEFAULT_BINDINGS.buildPreset, 'KeyY');
  const codes = Object.values(DEFAULT_BINDINGS);
  assert.equal(codes.filter((c) => c === 'KeyY').length, 1, 'no clash with another default');
});

test('bots build the same presets through their build queue (cover and tower)', async () => {
  const { Bots } = await import('../src/game/Bots.js');
  const { WEAPONS, makeRng } = await import('../src/core/config.js');
  for (const [name, kinds] of [['cover', ['wall', 'wall', 'wall']], ['tower', ['wall', 'wall', 'wall', 'wall', 'ramp']]]) {
    const world = new World({ meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], pois: [] });
    const structures = new Structures({ scene: new THREE.Scene(), world });
    const bots = new Bots({ world, structures });
    const loadout = { items: [{ type: 'weapon', id: 'rifle', rarity: 'rare', mag: WEAPONS.rifle.mag }], ammo: { medium: 300 }, mats: { wood: 300 }, selected: 0 };
    bots.spawn(1, makeRng(3), { difficulty: 'hard', dropPoints: [{ x: 0, z: 0 }], loadout });
    const bot = bots.actors[0];
    const b = bot._bot;
    bot.pos.set(2, world.groundHeight(2, 2, 50), 2);
    Object.assign(bot, { grounded: true, gliding: false, inBus: false });
    b.state = 'wander';
    b.launchAt = 0;
    const n = bots._queuePreset(b, 0, name, 0);
    assert.equal(n, kinds.length, name);
    bots._startQueue(b, n, 'wall', 'wood', 0, -1);
    for (let i = 0; i < 5 * 60 && b.bqN; i++) bots._buildStep(b), (bots.time += 1 / 60);
    assert.deepEqual(structures.pieces.map((p) => p.kind).sort(), [...kinds].sort(), `${name} built`);
    for (const p of structures.pieces) assert.ok(p.x >= 0 && p.x <= 4 && p.z >= 0 && p.z <= 4, `${name} ${p.kind} around the bot's cell`);
  }
});
