import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasSquare, createSquare, findParkPolygon, pointInRing, LAYOUT } from '../src/world/bentonville-square/index.js';

const load = () => JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
const fakeWorld = () => {
  const w = { reserved: [], circles: [], fixedLoot: [] };
  w.reserve = (p) => w.reserved.push(p);
  w.addCircle = (x, z, r, h, kind, mat, hp, ref) => {
    const c = { x, z, r, h, kind, mat, hp, ref };
    w.circles.push(c);
    return c;
  };
  w.surfaceHeight = () => 0;
  return w;
};
const segDist = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)) : 0;
  return Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
};

test('the composed map has the Square and its fountain is inside the city park', () => {
  const d = load();
  assert.equal(hasSquare(d), true);
  const park = findParkPolygon(d);
  assert.ok(park && pointInRing(park, LAYOUT.fountain.x, LAYOUT.fountain.z));
});

test('anchor lat/lon matches the map projection (no mirrored or rotated frame)', () => {
  const d = load();
  const O = d.meta.origin;
  const MX = 111320 * Math.cos((O.lat * Math.PI) / 180);
  const MZ = 110574;
  const { game, lat, lon, tileOffset } = LAYOUT.anchor;
  const tile = d.meta.composition.tiles.find((t) => t.key === 'square');
  assert.deepEqual([tile.dx, tile.dz], [tileOffset.dx, tileOffset.dz]);
  const x = (lon - O.lon) * MX + tile.dx; // x east
  const z = -(lat - O.lat) * MZ + tile.dz; // z south: north is -z
  assert.ok(Math.abs(x - game.x) < 0.3 && Math.abs(z - game.z) < 0.3, `${x} ${z}`);
});

test('the park is reserved and the fountain is solid and indestructible', () => {
  const d = load();
  const w = fakeWorld();
  createSquare(w, d);
  assert.equal(w.reserved.length, 1);
  const rim = w.circles.find((c) => c.r === LAYOUT.fountain.rimR);
  assert.ok(rim && rim.h === LAYOUT.fountain.rimH);
  for (const c of w.circles) {
    assert.equal(c.hp, Infinity);
    assert.equal(Array.isArray(c.ref), false); // not harvestable
  }
});

test('every surveyed tree trunk is clear of the park walks and the fountain plaza', () => {
  const d = load();
  const sq = createSquare(fakeWorld(), d);
  assert.equal(sq.trees.length, LAYOUT.trees.list.length);
  assert.ok(sq.paths.length >= 12, `park paths ${sq.paths.length}`);
  for (const t of sq.trees) {
    for (const r of sq.paths) for (let i = 0; i + 1 < r.p.length; i++) assert.ok(segDist(t.x, t.z, r.p[i], r.p[i + 1]) > r.w / 2 + 1.5, `${t.id} on a path`);
    assert.ok(Math.hypot(t.x - LAYOUT.fountain.x, t.z - LAYOUT.fountain.z) > LAYOUT.fountain.plazaR + 1.5, `${t.id} in the plaza`);
    assert.ok(t.moved <= 3, `${t.id} moved ${t.moved} m from its survey point`);
  }
});

test('Square loot is in the park, off the fountain, and the missing north building is added once', () => {
  const d = load();
  const w = fakeWorld();
  const park = findParkPolygon(d);
  const n0 = d.buildings.length;
  createSquare(w, d);
  createSquare(fakeWorld(), d); // a second build (rematch) must not duplicate it
  assert.equal(d.buildings.length, n0 + LAYOUT.buildings.list.length);
  assert.equal(w.fixedLoot.length, LAYOUT.loot.list.length);
  for (const l of w.fixedLoot) {
    assert.ok(pointInRing(park, l.x, l.z), `${l.square} outside the park`);
    assert.ok(Math.hypot(l.x - LAYOUT.fountain.x, l.z - LAYOUT.fountain.z) > LAYOUT.fountain.rimR + 0.8, `${l.square} in the fountain`);
  }
});
