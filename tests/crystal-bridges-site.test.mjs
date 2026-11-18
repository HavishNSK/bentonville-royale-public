// Crystal Bridges landmark: the site plan builds into walkable, connected, fightable architecture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { PAVILIONS, LEVEL, SLABS, WALKER_LANDING, siteHeight, clipRect, pondsFrom } from '../src/world/crystal-bridges/site.js';
import { createCrystalBridges } from '../src/world/crystal-bridges/index.js';
import { buildSite, roofUnder, sideSpans, subtractRects } from '../src/world/crystal-bridges/build.js';
import { GLASS_PANE, DOOR_GLASS } from '../src/world/crystal-bridges/meshes.js';
import * as THREE from 'three';
import { placeOrbitCamera } from '../src/game/Player.js';

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

test('weirs are labyrinth teeth, not a single straight sill', () => {
  const eleven = SLABS.filter((s) => String(s.id).startsWith('weir-eleven'));
  const modern = SLABS.filter((s) => String(s.id).startsWith('weir-modern'));
  assert.ok(eleven.length >= 5, `eleven teeth ${eleven.length}`);
  assert.ok(modern.length >= 5, `modern teeth ${modern.length}`);
  const span = (list) => {
    const zs = list.flatMap((s) => [s.z0, s.z1]);
    return Math.max(...zs) - Math.min(...zs);
  };
  assert.ok(span(eleven) > 4, `eleven weir depth ${span(eleven)}`);
  assert.ok(span(modern) > 4, `modern weir depth ${span(modern)}`);
  assert.ok(eleven.some((s) => s.id === 'weir-eleven'), 'keeps a walkable spine named weir-eleven');
});

test('Walker Landing wraps more than a half-circle into the pond', () => {
  assert.ok(WALKER_LANDING.a1 - WALKER_LANDING.a0 > Math.PI, `arc ${WALKER_LANDING.a1 - WALKER_LANDING.a0}`);
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

test('visitor rooms have red-oak floors; Eleven keeps quartzite; the library is a thin slab', () => {
  const { out } = site();
  const oak = new Set([
    'lobby', 'entry-tower', 'south-lobby', 'great-hall', 'corridor', 'library', 'store',
    'early-american-1', 'early-american-2', 'east-terrace', 'reflection', 'north-gallery',
    'modern-bridge', 'contemporary', 'lower-west', 'west-wing-2026', 'bridge-gallery-2026',
    'east-wing-2026',
  ]);
  for (const pv of PAVILIONS) {
    const floors = out.parts.filter((p) => p.floorOf === pv.id);
    assert.ok(floors.length >= 1, `${pv.id} has no floor mesh`);
    if (pv.id === 'eleven') {
      assert.ok(floors.every((p) => p.mat === 'quartzite'), `Eleven floor ${floors[0] && floors[0].mat}`);
    } else if (oak.has(pv.id)) {
      assert.ok(floors.every((p) => p.mat === 'oak'), `${pv.id} floor ${floors[0] && floors[0].mat}`);
    }
    if (pv.id === 'library') {
      const t = Math.max(...floors.map((p) => p.y1 - p.y0));
      assert.ok(t < 0.35, `library plinth ${t.toFixed(2)} m would fill the corridor below`);
    }
  }
});

test('builds deterministic colliders: glass, props, loot and a high-tier chest', () => {
  const a = site();
  const b = site();
  assert.equal(a.out.stats.boxes, b.out.stats.boxes);
  // budget raised 4000 -> 5000 for the breakable roof tiles (~1600); measured ~56 fps in the museum on an M4
  assert.ok(a.out.stats.boxes > 400 && a.out.stats.boxes < 5000, `boxes ${a.out.stats.boxes}`);
  assert.ok(a.out.stats.glass > 60, `glass ${a.out.stats.glass}`);
  assert.ok(a.out.stats.props > 30, `props ${a.out.stats.props}`);
  for (const g of a.out.glass) {
    assert.ok(g.collider.breakable && g.collider.maxHp < 1e6);
    if (g.visOnly) assert.equal(g.collider.passable, true);
    else assert.ok(!g.collider.passable);
  }
  assert.ok(a.out.loot.filter((l) => l.tier === 'high').length >= 2);
  assert.equal(a.world.fixedLoot.length, a.out.loot.length);
});

test('OSM grass that spans the ravine is skipped even when every vertex sits on the crest', () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const cb = createCrystalBridges(world, mapData);
  const poly = [
    [90, -280],
    [90, -320],
    [-90, -320],
    [-90, -280],
  ];
  for (const [x, z] of poly) {
    assert.ok(world.terrainHeight(x, z) > -0.6, `vertex ${x},${z} already in the ravine (${world.terrainHeight(x, z).toFixed(2)})`);
  }
  assert.equal(cb.skipFlat(poly, 'grass'), true);
  const rim = [[90, -150], [110, -150], [110, -170], [90, -170]];
  assert.equal(cb.skipFlat(rim, 'grass'), false, 'crest-only grass next to the tile should stay');
});

test('no terrain pokes through a pavilion floor', () => {
  const { world } = site();
  for (const pv of PAVILIONS) {
    if (pv.noSlab) continue;
    for (let x = pv.x0 + 0.5; x < pv.x1; x += 2) {
      for (let z = pv.z0 + 0.5; z < pv.z1; z += 2) {
        assert.ok(world.terrainHeight(x, z) <= pv.floor - 0.2, `${pv.id} terrain ${world.terrainHeight(x, z).toFixed(2)} z-fights floor ${pv.floor} at ${x},${z}`);
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

test('south and library doors read as real doors: framed glass you can see', () => {
  assert.ok(DOOR_GLASS.opacity >= 0.5, `door glass opacity ${DOOR_GLASS.opacity} is invisible`);
  assert.equal(DOOR_GLASS.depthWrite, true, 'door glass must write depth so the opening is not a hole');
  const { out } = site();
  for (const id of ['south', 'library']) {
    const leaves = out.parts.filter((p) => p.doorLeaf && p.entrance === id);
    assert.equal(leaves.length, 2, `${id} has two leaves`);
    assert.ok(leaves.every((p) => p.y1 - p.y0 >= 2.4), `${id} leaves are door-height`);
    assert.ok(leaves.every((p) => p.hx >= 1.2), `${id} leaves are wide enough to see`);
  }
});

test('museum windows read as real glass: see-through, tinted, reflective, framed', () => {
  assert.ok(GLASS_PANE.opacity >= 0.25, `glass opacity ${GLASS_PANE.opacity} is invisible`);
  assert.ok(GLASS_PANE.opacity <= 0.6, `glass opacity ${GLASS_PANE.opacity} reads as a frosted panel, not a window`);
  assert.equal(GLASS_PANE.transparent, true);
  assert.ok(GLASS_PANE.shininess > 40, 'glass needs a specular highlight');
  const { out } = site();
  const solid = out.glass.filter((g) => !g.visOnly);
  const frames = out.parts.filter((p) => p.frame);
  assert.ok(frames.length >= solid.length, `window frames ${frames.length} for ${solid.length} panes`);
  assert.ok(frames.every((f) => f.collider.passable), 'frames are visual only');
});

test('the lobby north door is glazed so Walker Landing is not an open hole', () => {
  const { out } = site();
  const panes = out.glass.filter((g) => g.pv === 'lobby' && g.side === 'n');
  assert.ok(panes.length >= 1, `lobby north glass ${panes.length}`);
  assert.ok(panes.every((g) => g.visOnly), 'exterior door glass must stay walkable');
});

test('looking up in the lobby does not put the camera through the oak floor', () => {
  const { world } = site();
  const cam = new THREE.PerspectiveCamera();
  const pivot = new THREE.Vector3(26, LEVEL.MAIN + 1.55, -258);
  placeOrbitCamera(cam, world, pivot, 0, 0.7, 4.4, 0.75);
  const floor = world.groundHeight(26, -258, LEVEL.MAIN + 0.1, STEP);
  assert.ok(cam.position.y >= floor + 0.25, `camera y ${cam.position.y.toFixed(2)} is through lobby floor ${floor.toFixed(2)}`);
});

test('looking at a lobby wall does not put the camera through it', () => {
  const { world } = site();
  const cam = new THREE.PerspectiveCamera();
  const pivot = new THREE.Vector3(26, LEVEL.MAIN + 1.55, -258);
  placeOrbitCamera(cam, world, pivot, Math.PI / 2, 0, 4.4, 0.75); // look east; camera pulls west toward x=14
  assert.ok(cam.position.x > 14.3, `camera x ${cam.position.x.toFixed(2)} is through the west wall`);
});

test('frosted door glass stops the camera but stays walkable', () => {
  const { world } = site();
  const cam = new THREE.PerspectiveCamera();
  const pivot = new THREE.Vector3(35, LEVEL.MAIN + 1.55, -261);
  placeOrbitCamera(cam, world, pivot, -Math.PI / 2, 0, 4.4, 0.75); // look west; camera toward the east door pane at x≈37.8
  assert.ok(cam.position.x < 37.5, `camera x ${cam.position.x.toFixed(2)} went through the frosted east door`);
  const body = { x: 35, y: LEVEL.MAIN, z: -261 };
  for (let i = 0; i < 24; i++) {
    body.x += 0.25;
    world.resolveCircle(body, 0.42, 1.7);
  }
  assert.ok(body.x > 38.5, `stuck at ${body.x.toFixed(2)}; visOnly glass must stay walkable`);
});

test('sloped roofs do not leave sky gaps above the walls', () => {
  const { out } = site();
  const byId = Object.fromEntries(PAVILIONS.map((pv) => [pv.id, pv]));
  const walls = out.parts.filter((p) => p.wall && p.side && !p.partition && p.pv && byId[p.pv] && byId[p.pv].roof && byId[p.pv].roof.rise);
  assert.ok(walls.length > 20, `wall pieces ${walls.length}`);
  for (const p of walls) {
    const pv = byId[p.pv];
    if (p.lintel || p.y0 > pv.floor + 0.2 || p.y1 < pv.floor + pv.height - 0.3) continue;
    const yRoof = roofUnder(pv, p.cx, p.cz);
    assert.ok(p.y1 + 1e-6 >= yRoof, `${pv.id} ${p.side || ''} wall top ${p.y1.toFixed(2)} leaves a ${(yRoof - p.y1).toFixed(2)} m hole under roof ${yRoof.toFixed(2)} at ${p.cx.toFixed(1)},${p.cz.toFixed(1)}`);
  }
  for (const g of out.glass.filter((p) => p.pv && byId[p.pv] && byId[p.pv].roof && byId[p.pv].roof.rise && !p.visOnly)) {
    const pv = byId[g.pv];
    const yRoof = roofUnder(pv, g.cx, g.cz);
    assert.ok(g.y1 + 1e-6 >= yRoof - 0.12, `${pv.id} glass top ${g.y1.toFixed(2)} leaves a hole under roof ${yRoof.toFixed(2)}`);
  }
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
