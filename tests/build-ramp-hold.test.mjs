// One ramp click places one ramp: standing at the back of a cell must not put the ramp under
// your own feet (which lifted you onto it, after which hold-to-build stacked a second ramp one
// level up, right over your head). Boxed in, ramping again still climbs a level.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Structures } from '../src/game/Structures.js';
import { World } from '../src/world/World.js';
import { BUILD } from '../src/core/config.js';

const CELL = BUILD.cell;
const LEVEL = BUILD.level;

function setup() {
  const world = new World({ meta: { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 } }, buildings: [], roads: [], areas: [], landmarks: {} });
  const st = new Structures({ scene: new THREE.Scene(), world });
  return { world, st };
}

const cellOf = (v) => Math.floor(v / CELL);

test('a ramp from the back of a cell goes in the next cell, never under your own feet', () => {
  // facing north (heading 0, forward = -z); cell 1 spans z 4..8, so offsets 3.2..3.9 are its back
  for (const o of [3.2, 3.3, 3.45, 3.6, 3.9]) {
    const { st } = setup();
    const pos = { x: 2, y: 0, z: 4 + o };
    const pl = st.plan('ramp', pos, 0, 0, {});
    assert.equal(pl.valid, true, `offset ${o}: valid`);
    assert.notEqual(cellOf(pl.z), cellOf(pos.z), `offset ${o}: ramp planned in the player's own cell`);
    assert.equal(cellOf(pl.z), cellOf(pos.z) - 1, `offset ${o}: the cell ahead`);
  }
});

test('holding the click after placing one ramp never stacks a second one over the player', () => {
  for (const walk of [0, 4.5]) {
    for (const o of [3.2, 3.3, 3.45, 3.6]) {
      const { world, st } = setup();
      const pos = { x: 2, y: 0, z: 4 + o };
      const dt = 1 / 60;
      let held = 0.12; // a normal click
      let cooldown = 0;
      for (let f = 0; f < 12; f++) {
        // walk forward (holding W) and stand on whatever is under the feet, like Player does
        pos.z -= walk * dt;
        pos.y = Math.max(0, world.groundHeight(pos.x, pos.z, pos.y + 0.6));
        cooldown -= dt;
        const pl = st.plan('ramp', pos, 0, 0, {});
        if ((f === 0 || (held > 0 && cooldown <= 0)) && pl.valid) {
          st.place(pl, 'wood', null);
          cooldown = 0.07; // Player.tryPlace: hold-to-build repeat
        }
        held -= dt;
      }
      assert.equal(st.pieces.length, 1, `walk ${walk}, offset ${o}: ${st.pieces.length} ramps (${st.pieces.map((p) => `${p.x},${p.y},${p.z}`).join(' | ')})`);
    }
  }
});

test('boxed in on a ramp, ramping again still climbs a level', () => {
  const { world, st } = setup();
  // a 1x1 box around cell (0, 1): x 0..4, z 4..8, with a ramp inside facing north
  const cx = 2;
  const cz = 6;
  st.place({ kind: 'wall', x: cx, y: 0, z: 4, rot: 0, valid: true }, 'wood', null);
  st.place({ kind: 'wall', x: cx, y: 0, z: 8, rot: 0, valid: true }, 'wood', null);
  st.place({ kind: 'wall', x: 0, y: 0, z: cz, rot: Math.PI / 2, valid: true }, 'wood', null);
  st.place({ kind: 'wall', x: 4, y: 0, z: cz, rot: Math.PI / 2, valid: true }, 'wood', null);
  st.place({ kind: 'ramp', x: cx, y: 0, z: cz, rot: 0, valid: true }, 'wood', null);
  const pos = { x: cx, y: 0, z: cz };
  pos.y = world.groundHeight(pos.x, pos.z, LEVEL);
  assert.ok(pos.y > 0.4, 'standing on the ramp');
  const pl = st.plan('ramp', pos, 0, 0, {});
  assert.equal(cellOf(pl.z), cellOf(cz), 'stays in the box');
  assert.equal(pl.y, LEVEL, 'one level up');
  assert.equal(pl.valid, true);
});

test('a normal tap places one piece; holding only repeats after a short delay', async () => {
  const { Player } = await import('../src/game/Player.js');
  // drive Player._buildMode the way _actions does each frame (placeCooldown ticks down first)
  let placed = 0;
  const fake = {
    placeCooldown: 0,
    buildPiece: 'ramp',
    placement: null,
    _autoMaterial() {},
    tryPlace() {
      placed++;
      this.placeCooldown = 0.07; // what the real tryPlace sets
      return {};
    },
  };
  let n = 0;
  const g = { structures: { plan: () => ({ kind: 'ramp', valid: true, key: `k${n++}` }), setGhost() {} } };
  const run = (holdS, dt = 1 / 60, frames = 60) => {
    placed = 0;
    fake.placeCooldown = 0;
    for (let f = 0; f < frames; f++) {
      const t = f * dt;
      fake.placeCooldown -= dt;
      const lmb = t < holdS;
      Player.prototype._buildMode.call(fake, dt, lmb, f === 0, g);
    }
    return placed;
  };
  assert.equal(run(0.1), 1, 'a 100 ms tap: one piece');
  assert.equal(run(0.18), 1, 'a slow 180 ms tap: still one piece');
  assert.ok(run(0.6) >= 4, 'holding keeps building (turbo build)');
});
