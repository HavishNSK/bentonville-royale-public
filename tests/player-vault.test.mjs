// Vaulting: a thin fence ahead is vaulted (Player._findLedge -> _findVault); a wall is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Player } from '../src/game/Player.js';
import { createBhs } from '../src/world/bhs/index.js';

function setup() {
  const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
  const world = new World(data);
  const bhs = createBhs(world, data);
  return { world, bhs };
}

/** A body with just what _findLedge / _findVault read. */
const body = (x, y, z) => ({ pos: new THREE.Vector3(x, y, z), radius: 0.42, height: 1.8, _findVault: Player.prototype._findVault });

test('a player vaults the stadium fence (thin, ~2 m) and lands past it', () => {
  const { world, bhs } = setup();
  const fenceX = bhs.stadium.plan.fence.x1;
  const z = 200;
  const p = body(fenceX + 0.7, 0, z);
  // facing west: forward = (sh, -ch) = (-1, 0)
  const plan = Player.prototype._findLedge.call(p, world, -1, 0);
  assert.ok(plan, 'a vault plan');
  assert.equal(plan.vault, true);
  assert.ok(plan.x1 < fenceX - 0.3, `lands past the fence (x1 ${plan.x1.toFixed(2)})`);
  assert.ok(plan.y1 > 1.9 && plan.y1 < 2.4, `clears the fence top (y1 ${plan.y1})`);
});

test('a solid building wall is not vaulted', () => {
  const { world } = setup();
  // outside the North Building's west brick wall (x -38.2), facing east
  const p = body(-39.2, 0, 195);
  assert.equal(Player.prototype._findLedge.call(p, world, 1, 0), null);
});
