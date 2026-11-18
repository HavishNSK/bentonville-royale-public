// Crystal Bridges statues: real model files, standing on the floor, out of bot lanes and doors,
// clear of furniture and loot, and kept out of the paintings' hang walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { STATUES, STATUE_MODELS } from '../src/world/crystal-bridges/statues.js';
import { navClearance, ENTRANCES } from '../src/world/crystal-bridges/nav.js';
import { obstaclesFrom } from '../src/world/crystal-bridges/gallery/hang.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const site = () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  return { world, out: buildSite(world, mapData) };
};

test('every statue model is a GLB in public/assets/statues', () => {
  for (const [key, m] of Object.entries(STATUE_MODELS)) {
    assert.match(m.url, /^\/assets\/statues\/[a-z-]+\.glb$/, key);
    const file = new URL('../public' + m.url, import.meta.url);
    assert.ok(existsSync(file), `${key}: ${m.url} missing`);
    assert.equal(readFileSync(file).subarray(0, 4).toString('latin1'), 'glTF', `${key} is not a binary glTF`);
    assert.ok(m.h > 0 && m.r > 0, key);
  }
  const ids = new Set(STATUES.map((s) => s.id));
  assert.equal(ids.size, STATUES.length, 'statue ids are unique');
  for (const s of STATUES) assert.ok(STATUE_MODELS[s.model], `${s.id}: unknown model ${s.model}`);
});

test('statues stand on their plinths, which stand on the ground, with a collider for the figure', () => {
  const { world, out } = site();
  assert.equal(out.statues.length, STATUES.length);
  for (const s of out.statues) {
    const def = STATUES.find((d) => d.id === s.id);
    const plinth = out.parts.find((p) => p.plinth === s.id);
    const figure = out.parts.find((p) => p.statue === s.id);
    assert.ok(figure && figure.hidden, `${s.id}: hidden figure collider`);
    if (def.plinth > 0) {
      assert.ok(plinth, `${s.id}: plinth`);
      assert.ok(Math.abs(plinth.y1 - s.y) < 1e-6, `${s.id}: figure sits on the plinth top`);
    }
    // the plinth top is the walkable surface there (nothing floats, nothing is buried); sample a
    // plinth corner, outside the figure's own collider
    const g = world.groundHeight(s.x + s.r - 0.06, s.z + s.r - 0.06, s.y + 0.3, 0.62);
    assert.ok(Math.abs(g - s.y) < 0.05, `${s.id}: ground ${g.toFixed(2)} vs statue base ${s.y.toFixed(2)}`);
  }
});

test('statues keep out of bot lanes, doorways, furniture and loot', () => {
  const { out } = site();
  for (const s of out.statues) {
    assert.ok(navClearance(s.x, s.z) > s.r + 1.0, `${s.id}: on a bot lane (${navClearance(s.x, s.z).toFixed(2)} m)`);
    for (const p of out.props) {
      const ex = p.hx + s.r;
      const ez = p.hz + s.r;
      assert.ok(Math.abs(p.cx - s.x) > ex || Math.abs(p.cz - s.z) > ez || p.y0 > s.y + 3, `${s.id} overlaps a ${p.type}`);
    }
    for (const l of out.loot) assert.ok(Math.max(Math.abs(l.x - s.x), Math.abs(l.z - s.z)) > s.r + 0.45, `${s.id} sits on loot ${l.pv}`);
  }
  for (const e of ENTRANCES) {
    const door = out.parts.filter((p) => p.entrance === e.id);
    for (const s of out.statues) for (const d of door) assert.ok(Math.hypot(d.cx - s.x, d.cz - s.z) > 2.2, `${s.id} blocks the ${e.id} entrance`);
  }
});

test('paintings treat statues as obstacles', () => {
  const { out } = site();
  const obs = obstaclesFrom(out);
  for (const s of out.statues) assert.ok(obs.some((o) => s.x > o.x0 && s.x < o.x1 && s.z > o.z0 && s.z < o.z1), `${s.id} not an obstacle`);
});

test('chests sit in varied spots: on benches, tables, counters and a display case', () => {
  const { out } = site();
  const on = new Set(out.loot.filter((l) => l.kind === 'chest' && l.on).map((l) => l.on));
  for (const t of ['bench', 'table', 'counter', 'case']) assert.ok(on.has(t), `no chest on a ${t}`);
  for (const l of out.loot.filter((q) => q.on)) {
    const p = out.props.find((q) => Math.hypot(q.cx - l.x, q.cz - l.z) < 0.01 && q.type === l.on);
    assert.ok(p && Math.abs(p.y1 - l.y) < 1e-6, `chest on ${l.on} at ${l.x},${l.z} floats or sinks`);
  }
});
