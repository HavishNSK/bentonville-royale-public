// Every wall and roof surface of an enterable (hollow, interior) building is a breakable panel:
// outer walls, interior partitions, the walls over the outer and interior doors (kind 'lintel')
// and the whole roof including its rim (kind 'roof'; interiors/shellPanels.js). A pickaxe swing
// on any of them gives BUILDING_WALL.yield mats of the panel's material (floor tiles and solid
// blocks keep PICKAXE.yield). Breaking one opens it for collision and rays like other panels.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { World, pointInPoly } from '../src/world/World.js';
import { Combat } from '../src/game/Combat.js';
import { BUILDING_WALL, PICKAXE } from '../src/core/config.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));

function mapWorld() {
  const w = new World(data);
  for (const road of data.roads) for (let i = 0; i + 1 < road.p.length; i++) w.addRoadSegment(...road.p[i], ...road.p[i + 1], road.w, road.k);
  for (const b of data.buildings) w.addBuilding(b);
  w.finishBuildings();
  return w;
}

const W = mapWorld();
const SHELLS = W.buildingInteriors().map((e) => e.collider).filter((c) => c.shell && c.shell.plan);
const WALL_KINDS = new Set(['outer', 'inner', 'lintel', 'roof']);

test('the map has enterable buildings with every panel kind', () => {
  assert.ok(SHELLS.length >= 20, `shells ${SHELLS.length}`);
  const kinds = new Set();
  for (const c of SHELLS) for (const pn of c.shell.panels) kinds.add(pn.kind);
  for (const k of ['outer', 'inner', 'lintel', 'roof', 'floor']) assert.ok(kinds.has(k), `has ${k} panels`);
});

test('every interior partition and door lintel (all storeys) is a breakable wood panel', () => {
  let walls = 0;
  let lintels = 0;
  for (const c of SHELLS) {
    const s = c.shell;
    for (const L of s.plan.levels) {
      L.wallMeta.forEach((m, w) => {
        assert.ok(m.panel >= 0, `building ${c.ref.id} level ${L.i} wall ${w} (${m.kind}) has a panel`);
        const pn = s.panels[m.panel];
        assert.equal(pn.wall, w, 'panel points back at its walls entry');
        assert.equal(pn.level, L.i);
        assert.equal(pn.kind, m.kind === 'lintel' ? 'lintel' : 'inner');
        assert.equal(pn.mat, 'wood');
        assert.equal(pn.maxHp, BUILDING_WALL.innerHp);
        assert.ok(Math.abs(pn.y0 - L.walls[w * 7 + 5]) < 1e-4 && Math.abs(pn.y1 - L.walls[w * 7 + 6]) < 1e-4, 'same height range');
        if (m.kind === 'lintel') lintels++;
        else walls++;
      });
    }
  }
  assert.ok(walls > 1000 && lintels > 100, `walls ${walls}, lintels ${lintels}`);
});

test('the outer wall is panels from the floor to the top ceiling (door openings aside, lintels included)', () => {
  let samples = 0;
  for (const c of SHELLS) {
    const s = c.shell;
    const mat = ['wood', 'brick', 'metal'].includes(c.ref.mat) ? c.ref.mat : 'brick';
    for (let e = 0; e < c.n; e++) {
      const k = (e + 1) % c.n;
      if (Math.hypot(c.p[k * 2] - c.p[e * 2], c.p[k * 2 + 1] - c.p[e * 2 + 1]) < 1e-3) continue;
      for (let u = 0.01; u < 1; u += 0.049) {
        for (let y = s.floor + 0.05; y < s.ceil; y += 0.37) {
          samples++;
          if (y < s.doorTop && W._inDoor(s, e, u)) continue; // the door opening itself
          const pn = W.panelAt(c, e, u, y);
          assert.ok(pn, `building ${c.ref.id} edge ${e} u ${u.toFixed(2)} y ${(y - s.floor).toFixed(2)}: no panel`);
          assert.ok(pn.kind === 'outer' || pn.kind === 'lintel');
          assert.equal(pn.mat, mat);
        }
      }
    }
    // one lintel per outer door, door top -> ground ceiling
    const lin = s.panels.filter((p) => p.kind === 'lintel' && p.e !== undefined);
    assert.equal(lin.length, s.doors.length, `building ${c.ref.id} door lintels`);
    for (const p of lin) {
      assert.equal(p.y0, s.doorTop);
      assert.equal(p.y1, s.groundCeil);
      assert.equal(p.maxHp, BUILDING_WALL.hp[mat]);
    }
  }
  assert.ok(samples > 10000, `samples ${samples}`);
});

test('the whole roof (rim over the wall band included) is roof tiles', () => {
  let samples = 0;
  for (const c of SHELLS) {
    const s = c.shell;
    assert.ok(s.roof, `building ${c.ref.id} has a roof grid`);
    for (let x = c.minX + 0.07; x < c.maxX; x += 0.43) {
      for (let z = c.minZ + 0.05; z < c.maxZ; z += 0.43) {
        if (!pointInPoly(c.p, c.n, x, z)) continue;
        samples++;
        const pn = W._roofTileAt(s, x, z);
        assert.ok(pn && pn.kind === 'roof', `building ${c.ref.id} roof at (${x.toFixed(2)}, ${z.toFixed(2)}): no tile`);
        assert.equal(pn.y0, s.ceil);
        assert.ok(Math.abs(pn.y1 - c.h) < 1e-6);
      }
    }
  }
  assert.ok(samples > 20000, `samples ${samples}`);
});

test('rays resolve every wall / roof surface to its panel (outer, rim, lintel, roof top)', () => {
  const counts = { outer: 0, lintel: 0, rim: 0, top: 0 };
  for (const c of SHELLS) {
    const s = c.shell;
    for (let e = 0; e < c.n; e++) {
      const k = (e + 1) % c.n;
      const ax = c.p[e * 2], az = c.p[e * 2 + 1];
      const ex = c.p[k * 2] - ax, ez = c.p[k * 2 + 1] - az;
      const l = Math.hypot(ex, ez);
      if (l < 2) continue;
      // inward normal: toward the footprint
      let nx = -ez / l, nz = ex / l;
      const mx = ax + ex * 0.5, mz = az + ez * 0.5;
      if (!pointInPoly(c.p, c.n, mx + nx * 0.6, mz + nz * 0.6)) { nx = -nx; nz = -nz; }
      for (const f of [0.25, 0.5, 0.75]) {
        const px = ax + ex * f, pz = az + ez * f;
        const heights = [[s.floor + 1.2, 'outer'], [(s.ceil + c.h) / 2, 'rim']];
        if (W._inDoor(s, e, f)) heights[0] = [(s.doorTop + s.groundCeil) / 2, 'lintel'];
        for (const [y, what] of heights) {
          const hit = W.raycast(px - nx * 2, y, pz - nz * 2, nx, 0, nz, 2.3);
          if (!hit || hit.collider !== c || hit.t < 1.9) continue; // something else in front
          const pn = W.panelHit(hit);
          assert.ok(pn, `building ${c.ref.id} edge ${e} ${what}: hit without a panel`);
          assert.equal(pn.kind, what === 'rim' ? 'roof' : what === 'lintel' ? 'lintel' : 'outer');
          counts[what]++;
        }
      }
    }
    for (const pn of s.panels) {
      if (pn.kind !== 'roof') continue;
      const hit = W.raycast(pn.x, c.h + 2, pn.z, 0, -1, 0, 3);
      if (!hit || hit.collider !== c) continue;
      assert.equal(W.panelHit(hit), pn, `building ${c.ref.id} roof tile ${pn.id} from above`);
      counts.top++;
    }
  }
  assert.ok(counts.outer > 500 && counts.rim > 500 && counts.lintel > 20 && counts.top > 3000, JSON.stringify(counts));
});

/** A fresh world with one building (by map id) for swing / break tests. */
function oneBuilding(id) {
  const w = new World(data);
  for (const road of data.roads) for (let i = 0; i + 1 < road.p.length; i++) w.addRoadSegment(...road.p[i], ...road.p[i + 1], road.w, road.k);
  w.addBuilding(data.buildings.find((b) => b.id === id));
  w.finishBuildings();
  return { w, c: w.buildingById(id) };
}

/** Swing at a target until it breaks: every swing yields `count` of `mat`. Returns the swing count. */
function swingUntilBroken(combat, shooter, origin, dir, pn) {
  let swings = 0;
  while (pn.alive && swings < 100) {
    const out = combat.swingPickaxe(shooter, origin, dir);
    assert.equal(out.panel, pn, `swing ${swings} hits the panel (${pn.kind})`);
    const mat = pn.mat;
    assert.deepEqual(out.harvested, { mat, count: BUILDING_WALL.yield }, `${pn.kind} gives ${BUILDING_WALL.yield} ${mat}`);
    swings++;
  }
  assert.equal(pn.alive, false, `${pn.kind} breaks`);
  return swings;
}

// a multi-storey building whose ground storey is taller than its doors (a lintel to hit)
const TARGET = SHELLS.find((c) => c.shell.plan.levels.length >= 2 && c.shell.groundCeil - c.shell.doorTop > 0.6 && c.shell.doors.length);

test('pickaxe: outer door lintel gives 10 of the building material per swing, then the doorway is full height', () => {
  assert.equal(BUILDING_WALL.yield, 10);
  assert.ok(TARGET, 'a building with a lintel over its door');
  const { w, c } = oneBuilding(TARGET.ref.id);
  const s = c.shell;
  const d = s.doors[0];
  const pn = s.panels.find((p) => p.kind === 'lintel' && p.e === d.e && p.f0 === d.f0);
  const combat = new Combat({ world: w });
  const y = (s.doorTop + s.groundCeil) / 2;
  const origin = new THREE.Vector3(d.x + d.nx * 1.2, y, d.z + d.nz * 1.2);
  const dir = new THREE.Vector3(-d.nx, 0, -d.nz);
  // before: a tall body is stopped by the lintel, the head bumps at the door top
  const ix = d.x - d.nx * 0.2, iz = d.z - d.nz * 0.2;
  assert.ok(Math.abs(w.ceilingAbove(ix, iz, s.floor) - s.doorTop) < 1e-6, 'lintel overhead');
  const n = swingUntilBroken(combat, { pos: origin.clone() }, origin, dir, pn);
  assert.equal(n, Math.ceil(pn.maxHp / PICKAXE.harvest));
  assert.ok(w.ceilingAbove(ix, iz, s.floor) > s.doorTop + 0.3, 'nothing over the doorway at the door top any more');
  const thru = w.raycast(origin.x, y, origin.z, dir.x, 0, dir.z, 2);
  assert.ok(!thru || thru.collider !== c || thru.t > 1.6, 'rays pass where the lintel was');
  // a 2.6 m body walks in through the doorway (it was pushed back by the lintel before)
  const tall = (s.groundCeil - s.floor) - 0.1;
  const pos = { x: d.x + d.nx * 0.8, y: s.floor, z: d.z + d.nz * 0.8 };
  for (let i = 0; i < 20; i++) { pos.x -= d.nx * 0.1; pos.z -= d.nz * 0.1; w.resolveCircle(pos, 0.3, tall); }
  assert.ok((pos.x - d.x) * d.nx + (pos.z - d.z) * d.nz < -0.5, 'walked through');
  w.restoreAllPanels();
  assert.equal(pn.alive, true);
  assert.ok(Math.abs(w.ceilingAbove(ix, iz, s.floor) - s.doorTop) < 1e-6, 'restored');
});

test('pickaxe: inner wall, interior lintel, roof tile and roof rim give 10 per swing; floor tiles keep PICKAXE.yield', () => {
  const { w, c } = oneBuilding(TARGET.ref.id);
  const s = c.shell;
  const combat = new Combat({ world: w });
  const L = s.plan.levels[0];
  // an interior lintel a swing reaches from one side
  let done = { lintel: false, inner: false };
  for (let k = 0; k < L.wallMeta.length && !(done.lintel && done.inner); k++) {
    const m = L.wallMeta[k];
    const pn = s.panels[m.panel];
    if (done[pn.kind]) continue;
    const Wl = L.walls;
    const cx = (Wl[k * 7] + Wl[k * 7 + 2]) / 2, cz = (Wl[k * 7 + 1] + Wl[k * 7 + 3]) / 2;
    const y = m.kind === 'lintel' ? (pn.y0 + pn.y1) / 2 : L.y + 1.4;
    const origin = new THREE.Vector3(cx - m.nx * 1.2, y, cz - m.nz * 1.2);
    const dir = new THREE.Vector3(m.nx, 0, m.nz);
    const probe = w.raycast(origin.x, y, origin.z, dir.x, 0, dir.z, 3);
    if (!probe || w.panelHit(probe) !== pn) continue;
    swingUntilBroken(combat, { pos: origin.clone() }, origin, dir, pn);
    assert.equal(s.wallOn[0][k], 0, 'out of collision');
    const again = w.raycast(origin.x, y, origin.z, dir.x, 0, dir.z, 1.4);
    assert.ok(!again || w.panelHit(again) !== pn, 'rays pass');
    done[pn.kind] = true;
  }
  assert.ok(done.lintel && done.inner, JSON.stringify(done));

  // a roof tile from above, and a rim piece (outer face above the top ceiling) from outside
  const tile = s.panels.find((p) => p.kind === 'roof' && !p.clip);
  const above = new THREE.Vector3(tile.x, c.h + 1.5, tile.z);
  swingUntilBroken(combat, { pos: above.clone() }, above, new THREE.Vector3(0, -1, 0), tile);
  assert.ok(w.groundHeight(tile.x, tile.z, c.h + 1) < s.ceil, 'you drop through the hole');

  let rimDone = false;
  for (let e = 0; e < c.n && !rimDone; e++) {
    const k = (e + 1) % c.n;
    const ax = c.p[e * 2], az = c.p[e * 2 + 1];
    const ex = c.p[k * 2] - ax, ez = c.p[k * 2 + 1] - az;
    const l = Math.hypot(ex, ez);
    if (l < 3) continue;
    let nx = -ez / l, nz = ex / l;
    if (!pointInPoly(c.p, c.n, ax + ex * 0.5 + nx * 0.6, az + ez * 0.5 + nz * 0.6)) { nx = -nx; nz = -nz; }
    const y = (s.ceil + c.h) / 2;
    const origin = new THREE.Vector3(ax + ex * 0.5 - nx * 1.2, y, az + ez * 0.5 - nz * 1.2);
    const dir = new THREE.Vector3(nx, 0, nz);
    const probe = w.raycast(origin.x, y, origin.z, nx, 0, nz, 2);
    const rim = probe && w.panelHit(probe);
    if (!rim || rim.kind !== 'roof' || !rim.alive) continue;
    swingUntilBroken(combat, { pos: origin.clone() }, origin, dir, rim);
    const thru = w.raycast(origin.x, y, origin.z, nx, 0, nz, 1.6);
    assert.ok(!thru || thru.collider !== c, 'the rim is open there');
    rimDone = true;
  }
  assert.ok(rimDone, 'swung through a roof rim');

  // a floor tile between storeys: unchanged yield (out of scope)
  const floor = s.panels.find((p) => p.kind === 'floor');
  if (floor) {
    const out = {};
    combat._swingPanel({ pos: new THREE.Vector3() }, c, floor, new THREE.Vector3(floor.x, floor.y0, floor.z), out);
    assert.equal(out.harvested.count, PICKAXE.yield[out.harvested.mat]);
  }
});

test('every wall / roof panel kind of an enterable building yields BUILDING_WALL.yield; solid blocks keep PICKAXE.yield', () => {
  const combat = new Combat({ world: W });
  combat.authoritative = false; // prediction path: no damage, same numbers
  const c = SHELLS[0];
  for (const kind of WALL_KINDS) {
    const pn = c.shell.panels.find((p) => p.kind === kind);
    const out = {};
    combat._swingPanel({ pos: new THREE.Vector3() }, c, pn, new THREE.Vector3(pn.x, pn.y0, pn.z), out);
    assert.equal(out.harvested.count, BUILDING_WALL.yield, kind);
    assert.equal(out.harvested.mat, pn.mat);
  }
  const block = { kind: 'block', mat: 'brick', hp: 1, maxHp: 1, alive: true };
  const out = {};
  combat._swingPanel({ pos: new THREE.Vector3() }, {}, block, new THREE.Vector3(), out);
  assert.equal(out.harvested.count, PICKAXE.yield.brick);
});

test('a room sign over an interior door goes with that door lintel', async () => {
  const { addFurnishingGeometry } = await import('../src/world/InteriorFurnishings.js');
  let signs = 0;
  let tied = 0;
  for (const c of SHELLS) {
    const chunk = { buf: { idx: [], n: 0 }, panelRanges: [] };
    const quad = (ch) => { const i0 = ch.buf.n; ch.buf.n += 4; ch.buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); };
    addFurnishingGeometry(chunk, c.shell, c.h, { quad });
    signs += (c.shell.plan.signs || []).length;
    for (let i = 0; i < chunk.panelRanges.length; i += 3) if (chunk.panelRanges[i].kind === 'lintel') tied++;
  }
  assert.ok(signs > 100 && tied >= signs * 0.95, `signs ${signs}, on lintels ${tied}`);
});
