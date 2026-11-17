// Crystal Bridges landmark: the site plan builds into walkable, connected, fightable architecture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { PAVILIONS, LEVEL, siteHeight, clipRect, pondsFrom } from '../src/world/crystal-bridges/site.js';
import { buildSite, roofUnder, sideSpans, subtractRects } from '../src/world/crystal-bridges/build.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62;

function site() {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const out = buildSite(world, mapData);
  return { world, out };
}

test('clipRect and subtractRects', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const c = clipRect(sq, 5, 20, -5, 5);
  const xs = c.map((p) => p[0]);
  assert.ok(Math.min(...xs) === 5 && Math.max(...xs) === 10);
  const pieces = subtractRects({ x0: 0, x1: 10, z0: 0, z1: 10 }, [{ x0: 4, x1: 6, z0: 4, z1: 6 }]);
  const area = pieces.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
  assert.equal(area, 96);
});

test('every side span list covers its side exactly once', () => {
  for (const pv of PAVILIONS) {
    for (const side of ['n', 's', 'w', 'e']) {
      const sp = sideSpans(pv, side);
      const lo = side === 'n' || side === 's' ? pv.x0 : pv.z0;
      const hi = side === 'n' || side === 's' ? pv.x1 : pv.z1;
      assert.ok(Math.abs(sp[0].a - lo) < 1e-6 && Math.abs(sp[sp.length - 1].b - hi) < 1e-6, `${pv.id} ${side}`);
      for (let i = 1; i < sp.length; i++) assert.ok(Math.abs(sp[i].a - sp[i - 1].b) < 1e-6, `${pv.id} ${side} gap at ${sp[i].a}`);
    }
  }
});

test('three ponds step down northward over the weirs', () => {
  const ponds = pondsFrom(mapData);
  assert.deepEqual(ponds.map((p) => p.id), ['south-pond', 'north-pond', 'expansion-pond']);
  assert.ok(ponds[0].y > ponds[1].y && ponds[1].y > ponds[2].y);
  // the ravine reaches the street at the tile edge and the crest stays at street level
  assert.ok(Math.abs(siteHeight(ponds, -40, -136)) < 0.05, 'street level at the tile edge');
  assert.ok(siteHeight(ponds, 100, -300) > -0.5, 'east crest');
  assert.ok(siteHeight(ponds, 0, -300) < -12, 'north pond bed');
});

test('builds deterministic colliders: glass, props, loot and a high-tier chest', () => {
  const a = site();
  const b = site();
  assert.equal(a.out.stats.boxes, b.out.stats.boxes);
  assert.ok(a.out.stats.boxes > 400 && a.out.stats.boxes < 4000, `boxes ${a.out.stats.boxes}`);
  assert.ok(a.out.stats.glass > 60, `glass ${a.out.stats.glass}`);
  assert.ok(a.out.stats.props > 30, `props ${a.out.stats.props}`);
  for (const g of a.out.glass) assert.ok(g.collider.breakable && g.collider.maxHp < 1e6);
  assert.ok(a.out.loot.filter((l) => l.tier === 'high').length >= 2);
  assert.equal(a.world.fixedLoot.length, a.out.loot.length);
});

test('no terrain pokes through a pavilion floor', () => {
  const { world } = site();
  for (const pv of PAVILIONS) {
    if (pv.noSlab) continue;
    for (let x = pv.x0 + 0.5; x < pv.x1; x += 2) {
      for (let z = pv.z0 + 0.5; z < pv.z1; z += 2) {
        assert.ok(world.terrainHeight(x, z) <= pv.floor + 1e-3, `${pv.id} terrain ${world.terrainHeight(x, z).toFixed(2)} above floor at ${x},${z}`);
      }
    }
  }
});

test('standing in every pavilion lands on its floor, under its roof', () => {
  const { world } = site();
  for (const pv of PAVILIONS) {
    const x = (pv.x0 + pv.x1) / 2;
    const z = (pv.z0 + pv.z1) / 2;
    const g = world.groundHeight(x, z, pv.floor + 0.1, STEP);
    assert.ok(g >= pv.floor - 0.06 && g <= pv.floor + 0.62, `${pv.id}: ground ${g.toFixed(2)} vs floor ${pv.floor}`);
    const ceil = world.ceilingAbove(x, z, g, STEP);
    assert.ok(ceil >= g + 2.5, `${pv.id}: headroom ${(ceil - g).toFixed(2)}`);
    assert.ok(Math.abs(ceil - roofUnder(pv, x, z)) < 1.5 || ceil < roofUnder(pv, x, z), `${pv.id}: ceiling ${ceil}`);
  }
});

/** Walk a body in small steps along a polyline like the player controller (ground snap + push-out). */
function walk(world, pts, y) {
  const pos = { x: pts[0][0], y, z: pts[0][1] };
  for (let i = 1; i < pts.length; i++) {
    const [tx, tz] = pts[i];
    for (let k = 0; k < 400; k++) {
      const dx = tx - pos.x;
      const dz = tz - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) break;
      const s = Math.min(0.25, d);
      pos.x += (dx / d) * s;
      pos.z += (dz / d) * s;
      world.resolveCircle(pos, 0.42, 1.8, STEP);
      const cap = world.builtAbove(pos.x, pos.z, pos.y);
      const g = world.groundHeight(pos.x, pos.z, pos.y, STEP, cap);
      pos.y = g < pos.y - 0.05 ? Math.max(g, pos.y - 0.6) : g; // fall a little per step
    }
  }
  return pos;
}

test('the visitor route is walkable: crest -> stair hall -> lobby -> Early American -> down -> Modern Art bridge -> Contemporary -> up -> Eleven', () => {
  const { world } = site();
  const route = [
    [66, -239], [57, -239], [40, -239], // entrance colonnade, down the stair hall
    [36, -244], [36, -250], [30, -260], // into the Garrison Lobby
    [35, -268], [43, -280], [42, -300], [43, -320], // Early American 1, East Terrace, People on the Move
    [49, -334], [49, -345], [38, -346], [38, -356], // down through the Reflection Room
    [10, -356], [-20, -354], [-34, -354], // Lower North Gallery, Modern Art bridge
    [-46, -352], [-46, -320], [-42, -300], [-42, -278], [-52, -276], // Contemporary (past the Infinity Room)
    [-52, -270], [-52.5, -252], [-46, -257], [-30, -257], [0, -257], [16, -257], // up the West Stair, across Eleven, back to the lobby
  ];
  const end = walk(world, route, LEVEL.CREST);
  assert.ok(Math.hypot(end.x - 16, end.z + 257) < 1.5, `stuck at ${end.x.toFixed(1)}, ${end.z.toFixed(1)}, y ${end.y.toFixed(1)}`);
  assert.ok(Math.abs(end.y - LEVEL.MAIN) < 0.7, `ended at y ${end.y}`);
});

test('the south route is walkable: lobby -> Great Hall Corridor -> library stair -> South Lobby -> Great Hall', () => {
  const { world } = site();
  const toLibrary = walk(world, [[26, -255], [24, -240], [31.5, -186], [31.5, -212], [26, -220]], LEVEL.MAIN);
  assert.ok(Math.abs(toLibrary.y - (LEVEL.MAIN + 6)) < 0.7, `library y ${toLibrary.y.toFixed(2)} at ${toLibrary.x.toFixed(1)},${toLibrary.z.toFixed(1)}`);
  const toHall = walk(world, [[20, -240], [20, -180], [10, -167], [-24, -167], [-24, -188]], LEVEL.MAIN);
  assert.ok(Math.hypot(toHall.x + 24, toHall.z + 188) < 1.5, `stuck at ${toHall.x.toFixed(1)}, ${toHall.z.toFixed(1)}`);
});

test('glass blocks until shot out; loot stands on solid ground', () => {
  const { world, out } = site();
  const pane = out.glass.find((g) => g.pv === 'eleven');
  const c = pane.collider;
  const y = c.y0 + 1.5;
  const nx = -Math.sin(Math.atan2(c.sin, c.cos));
  const nz = Math.cos(Math.atan2(c.sin, c.cos));
  const hit = world.raycast(c.cx + nx * 6, y, c.cz + nz * 6, -nx, 0, -nz, 12);
  assert.ok(hit && hit.collider === c, 'a ray hits the pane');
  world.remove(c);
  const h2 = world.raycast(c.cx + nx * 6, y, c.cz + nz * 6, -nx, 0, -nz, 6.5);
  assert.ok(!h2 || h2.collider !== c);
  for (const l of out.loot) {
    const g = world.groundHeight(l.x, l.z, l.y + 0.3, STEP);
    assert.ok(Math.abs(g - l.y) < 0.35, `loot ${l.pv} at ${l.x.toFixed(1)},${l.z.toFixed(1)} expects ${l.y} ground ${g.toFixed(2)}`);
  }
});
