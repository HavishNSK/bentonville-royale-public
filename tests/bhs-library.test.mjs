// Bentonville High School library hero (src/world/bhs/interior/library): everything stays in the
// LIBRARY rect, the gallery (mezzanine) is reachable by its stair, loot sits on surfaces, the build
// is deterministic and within the decor budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { createKit } from '../src/world/bhs/kit/builder.js';
import { buildSouth, LIBRARY } from '../src/world/bhs/south.js';
import { buildLibrary } from '../src/world/bhs/interior/library/index.js';
import { PLAYER } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62; // World STEP / Player STEP_UP
const MY = 4.4; // gallery floor
const R = LIBRARY;
const EPS = 1e-6; // (kit stairs: the first tread and stringers sink up to 0.35 m into the ground)

/** The South building with only the library hero, recording which kit entries the library added. */
function buildIsolated() {
  const world = new World(mapData);
  const K = createKit(world, { owner: 'bhs', seed: 20061 });
  const span = {};
  buildSouth(K, {
    library: (k, ctx) => {
      span.p0 = k.parts.length;
      span.d0 = k.decors.length;
      span.l0 = k.lootSpots.length;
      span.g0 = k.lights.length;
      buildLibrary(k, ctx);
      span.p1 = k.parts.length;
      span.d1 = k.decors.length;
      span.l1 = k.lootSpots.length;
      span.g1 = k.lights.length;
    },
  });
  return {
    world,
    K,
    parts: K.parts.slice(span.p0, span.p1),
    decors: K.decors.slice(span.d0, span.d1),
    loot: K.lootSpots.slice(span.l0, span.l1),
    lights: K.lights.slice(span.g0, span.g1),
  };
}

/** The full BHS build the game uses. */
function buildFull() {
  const world = new World(mapData);
  const bhs = createBhs(world, mapData);
  return { world, bhs };
}

const corners = (b) => {
  const c = Math.cos(b.yaw || 0);
  const s = Math.sin(b.yaw || 0);
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([u, v]) => [b.cx + u * b.hx * c - v * b.hz * s, b.cz + u * b.hx * s + v * b.hz * c]);
};

/** Walk a body from `from` toward `to` in small steps like Player does (tests/bhs-stadium.test.mjs). */
function walk(world, from, to, step = 0.05) {
  const pos = { x: from[0], y: from[1], z: from[2] };
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const n = Math.ceil(Math.hypot(dx, dz) / step);
  for (let i = 1; i <= n; i++) {
    const ox = pos.x;
    const oz = pos.z;
    pos.x += dx / n;
    pos.z += dz / n;
    const cap = world.builtAbove(ox, oz, pos.y);
    world.resolveCircle(pos, PLAYER.radius, PLAYER.height);
    pos.y = world.groundHeight(pos.x, pos.z, pos.y, STEP, cap);
  }
  return pos;
}

const iso = buildIsolated();
const full = buildFull();

test('every library piece, light and loot spot stays inside the LIBRARY rect', () => {
  assert.ok(iso.parts.length > 80, `parts ${iso.parts.length}`);
  assert.ok(iso.decors.length > 2000, `decors ${iso.decors.length}`);
  for (const b of [...iso.parts, ...iso.decors]) {
    for (const [x, z] of corners(b)) assert.ok(x >= R.x0 - EPS && x <= R.x1 + EPS && z >= R.z0 - EPS && z <= R.z1 + EPS, `${b.look} at ${b.cx.toFixed(2)},${b.cz.toFixed(2)} leaves the rect`);
    assert.ok(b.y0 >= -0.4 && b.y1 <= R.top + EPS, `${b.look} y ${b.y0}..${b.y1}`);
    assert.ok(['int:south:0', 'int:south:1'].includes(b.group), `group ${b.group}`);
  }
  for (const l of [...iso.lights, ...iso.loot]) assert.ok(l.x > R.x0 && l.x < R.x1 && l.z > R.z0 && l.z < R.z1 && l.y < R.top, 'light / loot in the rect');
});

test('decor budget: under 20k pieces', () => {
  assert.ok(iso.decors.length < 20000, `decors ${iso.decors.length}`);
});

test('gallery slab is walkable, in the gallery group, at the 2nd-floor height', () => {
  const slabs = iso.parts.filter((p) => p.role === 'slab');
  assert.ok(slabs.length >= 2);
  for (const s of slabs) {
    assert.equal(s.group, 'int:south:1');
    assert.equal(s.y1, MY);
    assert.ok(s.collider.walkable);
  }
  // railings on the gallery edges
  assert.ok(iso.parts.filter((p) => p.role === 'rail').length >= 3);
});

test('stair risers stay under the step height', () => {
  const steps = iso.parts.filter((p) => p.role === 'stair').map((p) => p.y1).sort((a, b) => a - b);
  assert.ok(steps.length >= 8);
  let prev = 0;
  for (const y of steps) {
    assert.ok(y - prev <= 0.6 + EPS, `riser ${(y - prev).toFixed(3)}`);
    prev = y;
  }
  assert.ok(Math.abs(prev - MY) < EPS, 'stair tops out at the gallery');
});

test('players walk up the stair onto the gallery and along it', () => {
  const { world } = full;
  const g = world.groundHeight(66.4, 418, 0.5);
  assert.ok(g < 0.3, `atrium floor ${g}`);
  const up = walk(world, [66.4, g, 418], [79.0, 0, 418]);
  assert.ok(Math.abs(up.x - 79.0) < 0.05, `stair blocked at x ${up.x.toFixed(2)}`);
  assert.ok(Math.abs(up.y - MY) < 1e-6, `top of stair at y ${up.y}`);
  // north along the gallery to the chest, then west along the north strip
  const along = walk(world, [up.x, up.y, up.z], [79.0, 0, 389.5]);
  assert.ok(Math.abs(along.z - 389.5) < 0.05 && Math.abs(along.y - MY) < 1e-6, `gallery walk ended at ${along.x.toFixed(2)},${along.y},${along.z.toFixed(2)}`);
  const west = walk(world, [along.x, along.y, along.z], [60, 0, 390.6]);
  assert.ok(Math.abs(west.x - 60) < 0.05 && Math.abs(west.y - MY) < 1e-6, `north gallery walk ended at ${west.x.toFixed(2)},${west.y}`);
  // the balustrade stops a body walking off the gallery edge
  const edge = walk(world, [79.0, MY, 405], [72, 0, 405]);
  assert.ok(edge.x > 75.5 && Math.abs(edge.y - MY) < 1e-6, `walked off the gallery at x ${edge.x.toFixed(2)}`);
});

test('several loot spots (chests included) sit on surfaces, chests on the gallery', () => {
  const { world, bhs } = full;
  const loot = bhs.kit.lootSpots.filter((l) => l.x > R.x0 && l.x < R.x1 && l.z > R.z0 && l.z < R.z1);
  assert.ok(loot.length >= 5 && loot.length <= 12, `loot ${loot.length}`);
  const chests = loot.filter((l) => l.kind === 'chest');
  assert.ok(chests.length >= 3, `chests ${chests.length}`);
  assert.ok(chests.filter((c) => c.y === MY).length >= 1, 'a chest on the gallery');
  const cols = bhs.kit.parts.map((p) => p.collider);
  for (const l of loot) {
    assert.ok(['chest', 'ammoBox', 'item'].includes(l.kind));
    assert.ok(Math.abs(world.groundHeight(l.x, l.z, l.y + 0.3) - l.y) < 1e-6, `${l.kind} at ${l.x},${l.z} sits on a surface (y ${l.y})`);
    for (const c of cols) {
      const inside = l.x > c.minX - 0.3 && l.x < c.maxX + 0.3 && l.z > c.minZ - 0.3 && l.z < c.maxZ + 0.3;
      if (inside) assert.ok(c.y1 <= l.y + 1e-6 || c.y0 >= l.y + 1.2, `${l.kind} at ${l.x},${l.z} inside box ${c.id}`);
    }
  }
});

test('shelves and tables are breakable wood cover', () => {
  const cover = iso.parts.filter((p) => p.role === 'shelf' || p.role === 'table' || p.role === 'desk');
  assert.ok(cover.length > 60, `cover ${cover.length}`);
  for (const p of cover) {
    assert.equal(p.collider.mat, 'wood');
    assert.ok(p.collider.hp > 0 && p.collider.hp < 1e6);
  }
});

test('the library build is deterministic', () => {
  const b = buildIsolated();
  const sig = (r) =>
    [...r.parts, ...r.decors].map((p) => [p.look, p.group, p.cx.toFixed(4), p.cz.toFixed(4), p.y0.toFixed(4), p.y1.toFixed(4), (p.yaw || 0).toFixed(4)].join(',')).join(';') +
    '|' + r.loot.map((l) => [l.kind, l.x, l.y, l.z].join(',')).join(';');
  assert.equal(sig(iso), sig(b));
  assert.deepEqual(iso.parts.map((p) => p.collider.id), b.parts.map((p) => p.collider.id), 'sequential collider ids');
  const f2 = buildFull();
  assert.equal(f2.bhs.kit.parts.length, full.bhs.kit.parts.length);
  assert.equal(f2.bhs.kit.decors.length, full.bhs.kit.decors.length);
});
