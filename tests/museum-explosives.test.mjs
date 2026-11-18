// Grenades and rockets must shatter museum glass and break benches.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';
import { Loot } from '../src/game/Loot.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));

function site() {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const out = buildSite(world, mapData);
  return { world, out };
}

function explodeAt(world, x, y, z, rocket, loot = null) {
  const combat = new Combat({ world });
  const grenades = new Grenades({ world, combat, loot, fx: null, sfx: null });
  grenades._explode({ pos: new THREE.Vector3(x, y, z), rocket: !!rocket, owner: null, damage: 100 });
  return combat;
}

function lootWorld() {
  const world = new World({ meta: { bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }, buildings: [], roads: [], areas: [], pois: [] });
  const loot = new Loot({ scene: null, world });
  loot._rng = () => 0.5;
  return { world, loot };
}

function paneAndBench(out) {
  const pane = out.glass.find((g) => !g.visOnly && g.collider && g.collider.alive);
  const bench = out.props.find((p) => p.type === 'bench' && p.collider && p.collider.alive);
  const wall = out.parts.find((p) => p.wall && p.collider && p.collider.alive && p.collider.hp > 1e6);
  assert.ok(pane, 'need a solid museum window');
  assert.ok(bench, 'need a bench');
  assert.ok(wall, 'need a museum wall');
  return { pane, bench, wall };
}

test('a grenade blast shatters museum glass and breaks a bench, not the walls', () => {
  const { world, out } = site();
  const { pane, bench, wall } = paneAndBench(out);
  explodeAt(world, pane.cx, (pane.y0 + pane.y1) / 2, pane.cz, false);
  explodeAt(world, bench.cx, (bench.y0 + bench.y1) / 2, bench.cz, false);
  assert.equal(pane.collider.alive, false, 'window should shatter');
  assert.equal(bench.collider.alive, false, 'bench should break');
  assert.equal(wall.collider.alive, true, 'concrete walls stay up');
});

test('a rocket blast shatters museum glass and breaks a bench, not the walls', () => {
  const { world, out } = site();
  const { pane, bench, wall } = paneAndBench(out);
  explodeAt(world, pane.cx, (pane.y0 + pane.y1) / 2, pane.cz, true);
  explodeAt(world, bench.cx, (bench.y0 + bench.y1) / 2, bench.cz, true);
  assert.equal(pane.collider.alive, false, 'window should shatter');
  assert.equal(bench.collider.alive, false, 'bench should break');
  assert.equal(wall.collider.alive, true, 'concrete walls stay up');
});

test('a grenade blast opens a chest, spills its loot, and destroys the chest', () => {
  const { world, loot } = lootWorld();
  const chest = loot._add('chest', 0, 0, 0, 0);
  const far = loot._add('chest', 40, 0, 0, 0);
  explodeAt(world, 0, 0.4, 0, false, loot);
  assert.equal(loot.byId.has(chest.id), false, 'chest in the blast should be destroyed');
  assert.equal(far.opened, false, 'a chest outside the blast stays shut');
  assert.ok(loot.byId.has(far.id), 'a chest outside the blast is still there');
  const spilled = loot.records.filter((r) => r.kind === 'item');
  assert.ok(spilled.length >= 3, `chest should dump its loot, got ${spilled.length} items`);
});

test('a rocket blast opens a chest, spills its loot, and destroys the chest', () => {
  const { world, loot } = lootWorld();
  const chest = loot._add('chest', 2, 0, 0, 0);
  explodeAt(world, 0, 0.4, 0, true, loot);
  assert.equal(loot.byId.has(chest.id), false);
  assert.ok(loot.records.filter((r) => r.kind === 'item').length >= 3);
});

test('an already-open chest is destroyed without spilling again', () => {
  const { world, loot } = lootWorld();
  const chest = loot._add('chest', 0, 0, 0, 0);
  loot.open(chest.id);
  const n = loot.records.filter((r) => r.kind === 'item').length;
  explodeAt(world, 0, 0.4, 0, false, loot);
  assert.equal(loot.records.filter((r) => r.kind === 'item').length, n);
  assert.equal(loot.byId.has(chest.id), false, 'opened chest should still be destroyed');
});

test('a grenade blast destroys window frames around a pane, not the walls', () => {
  const { world, out } = site();
  const pane = out.glass.find((g) => !g.visOnly && g.collider && g.collider.alive);
  assert.ok(pane, 'need a solid museum window');
  const frames = out.parts.filter((p) => (p.frame || p.mullion) && p.collider && p.collider.alive
    && Math.hypot(p.cx - pane.cx, p.cz - pane.cz) < 2.2);
  assert.ok(frames.length >= 1, `need window frames near the pane, got ${frames.length}`);
  const wall = out.parts.find((p) => p.wall && p.collider && p.collider.alive && p.collider.hp > 1e6);
  explodeAt(world, pane.cx, (pane.y0 + pane.y1) / 2, pane.cz, false);
  for (const f of frames) {
    assert.equal(f.collider.alive, false, `frame at ${f.cx.toFixed(1)},${f.cz.toFixed(1)} should be destroyed`);
  }
  assert.equal(wall.collider.alive, true, 'concrete walls stay up');
});
