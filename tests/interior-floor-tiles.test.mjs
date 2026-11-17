// Breakable floors / ceilings between storeys (src/world/interiors/floorTiles.js): tiles are
// panels (kind 'floor'); a broken one opens the slab for walking, head room, rays and building,
// restores on match reset, and resolves from host events like any wall panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { tileIdAt, RIM } from '../src/world/interiors/floorTiles.js';
import { FLOOR_THICKNESS, inHole } from '../src/world/interiors/storeys.js';
import { toLocal, inPoly } from '../src/world/interiors/layout.js';
import { resolvePanelEvent } from '../src/net/protocol.js';

const data = { meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] };
function fixture() {
  const w = new World(data);
  w.addBuilding({ id: 424242, t: 'office', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [120, 0], [120, 40], [0, 40]] });
  w.addBuilding({ id: 77, t: 'retail', mat: 'brick', lv: 1, h: 6, p: [[140, 0], [180, 0], [180, 30], [140, 30]] });
  w.finishBuildings();
  const byId = new Map(w.buildingInteriors().map((b) => [b.collider.ref.id, b.collider]));
  return { w, c: byId.get(424242), single: byId.get(77) };
}
const tilesOf = (c) => c.shell.plan.panels.filter((p) => p.kind === 'floor');

test('only slabs between storeys get tiles, clear of holes, furniture, lights and loot', () => {
  const { c, single } = fixture();
  const plan = c.shell.plan, F = plan.frame;
  assert.equal(tilesOf(single).length, 0, 'one-storey buildings: no floor tiles (the roof stays solid)');
  const tiles = tilesOf(c);
  assert.ok(tiles.length > 20, `tiles: ${tiles.length}`);
  const P = [];
  for (let i = 0; i < c.shell.inner.length; i += 2) P.push(...toLocal(F, c.shell.inner[i], c.shell.inner[i + 1]));
  const hit = (A, t, m = 0) => A.a0 - m < t.a1 && A.a1 + m > t.a0 && A.b0 - m < t.b1 && A.b1 + m > t.b0;
  for (const t of tiles) {
    assert.ok(t.level > 0, 'never the ground floor');
    assert.equal(c.shell.panels[t.id], t, 'panel id is its index');
    const L = plan.levels[t.level];
    const r = L.rooms[t.room];
    assert.ok(t.a0 >= r.a0 + RIM - 1e-6 && t.a1 <= r.a1 - RIM + 1e-6 && t.b0 >= r.b0 + RIM - 1e-6 && t.b1 <= r.b1 - RIM + 1e-6, 'inside its room rim');
    for (const [a, b] of [[t.a0, t.b0], [t.a1, t.b1], [(t.a0 + t.a1) / 2, (t.b0 + t.b1) / 2]]) assert.ok(inPoly(P, a, b), 'inside the building');
    assert.ok(!L.holes.some((h) => hit(h, t)), 'not over a stair hole');
    assert.ok(!plan.furniture.some((p) => p.level === t.level && hit(p, t)), 'no furniture on it');
    assert.ok(!plan.lights.some((l) => (l.level === t.level || l.level === t.level - 1) && hit(l, t)), 'no light under / on it');
    assert.equal(tileIdAt(L, (t.a0 + t.a1) / 2, (t.b0 + t.b1) / 2), t.id, 'lookup finds it');
    assert.ok(Math.abs(t.y1 - L.y) < 1e-9 && Math.abs(t.y0 - (L.y - FLOOR_THICKNESS)) < 0.02);
  }
  assert.equal(fixture().w.interiorHash, fixture().w.interiorHash, 'deterministic');
});

test('a broken tile opens the slab: fall through, head room, rays; reset closes it', () => {
  const { w, c } = fixture();
  const t = tilesOf(c).find((p) => p.level === 1);
  const L1 = c.shell.plan.levels[1], L0 = c.shell.plan.levels[0];
  const { x, z } = t;
  // intact: standing on it, solid overhead from below, rays stop on it (and name the tile)
  assert.ok(Math.abs(w.groundHeight(x, z, L1.y + 0.01) - L1.y) < 1e-6, 'stand on the intact tile');
  assert.ok(w.ceilingAbove(x, z, L0.y) <= L1.y - FLOOR_THICKNESS + 1e-6, 'intact tile is a ceiling');
  const down = w.raycast(x, L1.y + 1, z, 0, -1, 0, 5);
  assert.ok(down && Math.abs(down.y - L1.y) < 1e-6, 'shot from above meets the tile');
  assert.equal(w.panelHit(down), t, 'shot from above names the tile');
  const up = w.raycast(x, L0.y + 1.5, z, 0, 1, 0, 5);
  assert.ok(up && Math.abs(up.y - (L1.y - FLOOR_THICKNESS)) < 1e-6, 'shot from below meets the underside');
  assert.equal(w.panelHit(up), t, 'shot from below names the tile');

  let changed = null;
  w.onPanelChange = (cc, pn, alive) => { changed = [pn, alive]; };
  assert.ok(w.breakPanel(c, t.id));
  assert.deepEqual(changed, [t, false], 'mesh hide hook fired');
  assert.ok(w.groundHeight(x, z, L1.y + 0.01) < L1.y - 1, 'fall through a broken tile');
  assert.ok(w.ceilingAbove(x, z, L0.y) > L1.y + 1, 'no ceiling over a broken tile');
  assert.ok(w.builtAbove(x, z, L0.y) > L1.y + 1, 'nothing caps a climb through the hole');
  const thru = w.raycast(x, L1.y + 1, z, 0, -1, 0, 5);
  assert.ok(thru && thru.y < L1.y - 1, 'shots pass through');
  // neighbours stay solid
  const n = tilesOf(c).find((p) => p !== t && p.level === 1 && !inHole(c.shell.plan, L1, p.x, p.z));
  assert.ok(Math.abs(w.groundHeight(n.x, n.z, L1.y + 0.01) - L1.y) < 1e-6, 'other tiles still solid');

  assert.ok(w.restoreAllPanels() >= 1);
  assert.deepEqual(changed, [t, true], 'mesh show hook fired');
  assert.ok(Math.abs(w.groundHeight(x, z, L1.y + 0.01) - L1.y) < 1e-6, 'reset closes it');
});

test('host floor-tile events resolve like wall panels', () => {
  const { w, c } = fixture();
  const t = tilesOf(c)[0];
  const r = resolvePanelEvent(w, { e: 'wx', b: 424242, p: t.id });
  assert.ok(r && r.c === c && r.pn === t);
  const d = resolvePanelEvent(w, { e: 'wd', b: 424242, p: t.id, hp: 50 });
  assert.equal(d.hp, 50);
});

test('every floor tile renders top, sides and underside inside its own panel ranges', async () => {
  const { addInteriorGeometry } = await import('../src/world/InteriorMeshes.js');
  const { c } = fixture();
  const chunk = { buf: { idx: [], n: 0 }, wall: [], bh: [], panelRanges: [] };
  const quad = (ch) => { const i0 = ch.buf.n; ch.buf.n += 4; ch.buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); };
  const hcapFlat = (ch, pts) => { const n = pts.length / 2, i0 = ch.buf.n; ch.buf.n += n; for (let k = 1; k + 1 < n; k++) ch.buf.idx.push(i0, i0 + k, i0 + k + 1); };
  addInteriorGeometry(chunk, c.shell, 11, { quad, hcapFlat });
  const R = chunk.panelRanges, byPanel = new Map();
  for (let i = 0; i < R.length; i += 3) byPanel.set(R[i], (byPanel.get(R[i]) || 0) + R[i + 2]);
  for (const t of tilesOf(c)) {
    const n = byPanel.get(t) || 0;
    // top + underside at least; sides toward neighbouring tiles too (sides toward solid floor are
    // drawn outside the range on purpose: they are the cut edge once this tile breaks)
    assert.ok(n >= 2 * 6, `tile ${t.id}: >= 2 quads (top, underside): ${n / 6}`);
  }
  // ranges never overlap
  const spans = [];
  for (let i = 0; i < R.length; i += 3) spans.push([R[i + 1], R[i + 1] + R[i + 2]]);
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1], 'panel ranges are disjoint');
});
