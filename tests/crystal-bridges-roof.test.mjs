// Crystal Bridges roof, joints, entrances and building on the museum: no sky through the roof
// or over a lower neighbour, roof tiles break (explosions especially), the entrance paths are
// walkable slopes without cliff edges, and build pieces sit flush on the museum's floors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { buildSite, roofUnder, ROOF_HP } from '../src/world/crystal-bridges/build.js';
import { PAVILIONS, PADS, LEVEL } from '../src/world/crystal-bridges/site.js';
import { Combat } from '../src/game/Combat.js';
import { Grenades } from '../src/game/Grenades.js';
import { Structures } from '../src/game/Structures.js';
import { GRENADE, BUILD } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const site = () => {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  return { world, out: buildSite(world, mapData) };
};

test('every pavilion roof is breakable tiles (bar the one holding the high-tier chest)', () => {
  const { out } = site();
  for (const pv of PAVILIONS) {
    const tiles = out.parts.filter((p) => p.roofTile && p.roofOf === pv.id);
    assert.ok(tiles.length >= 1, `${pv.id} has roof tiles`);
    for (const t of tiles) {
      if (t.solid) continue;
      assert.ok(t.collider.breakable && t.collider.maxHp < 1e6, `${pv.id} tile breakable`);
      assert.ok(t.collider.maxHp <= ROOF_HP, `${pv.id} tile hp ${t.collider.maxHp}`);
    }
  }
  const high = out.loot.find((l) => l.tier === 'high' && l.pv === 'north-tower');
  const under = out.parts.find((p) => p.roofTile && p.solid && Math.abs(high.x - p.cx) <= p.hx + 0.6 && Math.abs(high.z - p.cz) <= p.hz + 0.6);
  assert.ok(under && !under.collider.breakable, 'the tile under the North Tower chest stays solid');
});

test('no glance from standing height escapes through a roof or over a lower neighbour', () => {
  const { world } = site();
  // the open doorways are the only way out at these angles (checked separately)
  const doorway = (x, y, z) => (x > 56.5 && z > -243 && z < -235) || (z > -158.6 && x > -5 && x < 7) || (x > 57.5 && z > -421 && z < -413);
  for (const pv of PAVILIONS) {
    let n = 0;
    let leaks = 0;
    for (let x = pv.x0 + 1.5; x < pv.x1 - 1; x += 3) {
      for (let z = pv.z0 + 1.5; z < pv.z1 - 1; z += 3) {
        const top = roofUnder(pv, x, z);
        for (const y of [pv.floor + 1.6, pv.floor + (top - pv.floor) * 0.45]) {
          for (let a = 0; a < 12; a++) {
            for (const el of [1.0, 0.6]) {
              const ce = Math.cos(el);
              const dx = Math.cos((a / 12) * Math.PI * 2) * ce;
              const dz = Math.sin((a / 12) * Math.PI * 2) * ce;
              n++;
              const h = world.raycast(x, y, z, dx, Math.sin(el), dz, 120);
              if (h && (h.collider || h.kind === 'ground' || h.kind === 'building')) continue;
              // where did it leave the room?
              let t = 0;
              while (t < 60 && x + dx * t > pv.x0 - 0.3 && x + dx * t < pv.x1 + 0.3 && z + dz * t > pv.z0 - 0.3 && z + dz * t < pv.z1 + 0.3) t += 0.25;
              if (!doorway(x + dx * t, y + Math.sin(el) * t, z + dz * t)) leaks++;
            }
          }
        }
      }
    }
    // a few hairline corner seams are tolerated (< 0.5% of glances), never a hole
    assert.ok(leaks <= Math.max(2, n * 0.005), `${pv.id}: ${leaks} of ${n} glances reach the sky`);
  }
});

test('the Reflection Room is walled above the lower North Gallery it opens onto', () => {
  const { out } = site();
  const walls = out.parts.filter((p) => p.transfer && p.pv === 'reflection' && p.nb === 'north-gallery');
  assert.ok(walls.length >= 3, `transfer walls ${walls.length}`);
  const nb = PAVILIONS.find((p) => p.id === 'north-gallery');
  for (const w of walls) assert.ok(w.y0 <= nb.floor + nb.height && w.y1 > nb.floor + nb.height + 1, 'covers from the neighbour ceiling up');
});

test('a grenade on the roof blows a hole in it; one inside breaks the ceiling above', () => {
  const { world, out } = site();
  const combat = new Combat({ world });
  const grenades = new Grenades({ world, combat, fx: null, sfx: null });
  const pv = PAVILIONS.find((p) => p.id === 'early-american-1');
  const cx = (pv.x0 + pv.x1) / 2;
  const cz = (pv.z0 + pv.z1) / 2;
  const roofTop = roofUnder(pv, cx, cz) + 0.45;
  grenades._explode({ pos: new THREE.Vector3(cx, roofTop + 0.2, cz), rocket: false, owner: null });
  const broken = out.parts.filter((p) => p.roofTile && p.roofOf === pv.id && !p.collider.alive);
  assert.ok(broken.length >= 4, `one grenade on the roof broke ${broken.length} tiles`);
  for (const p of broken) {
    const d = Math.hypot(Math.max(0, Math.abs(p.cx - cx) - p.hx), Math.max(0, Math.abs(p.cz - cz) - p.hz));
    assert.ok(d <= GRENADE.radius * GRENADE.roofRadiusMult + 0.5, 'only tiles in the roof blast radius break');
  }
  // standing on the floor, a grenade at head height still reaches the ceiling (6+ m up)
  const pv2 = PAVILIONS.find((p) => p.id === 'north-gallery');
  const x2 = (pv2.x0 + pv2.x1) / 2;
  const z2 = (pv2.z0 + pv2.z1) / 2;
  grenades._explode({ pos: new THREE.Vector3(x2, pv2.floor + 1.5, z2), rocket: false, owner: null });
  assert.ok(out.parts.some((p) => p.roofTile && p.roofOf === pv2.id && !p.collider.alive), 'the ceiling above breaks');
  // and the concrete walls stay up
  assert.ok(out.parts.filter((p) => p.wall && p.pv === pv.id).every((p) => p.collider.alive));
});

test('entrance paths: gentle ramps whose sides ease into the ravine (no cliff edges)', () => {
  const { world } = site();
  for (const pd of PADS) {
    if (pd.y1 === undefined) continue;
    const run = pd.axis === 'x' ? pd.x1 - pd.x0 : pd.z1 - pd.z0;
    assert.ok(Math.abs(pd.y1 - pd.y0) / run <= 0.45, `${pd.id} ramp slope ${(Math.abs(pd.y1 - pd.y0) / run).toFixed(2)}`);
    for (let f = 0.15; f < 0.9; f += 0.2) {
      // the walkable surface (terrain, or a berm box filling the trench against a wall)
      const g = (x, z) => world.groundHeight(x, z, world.terrainHeight(x, z) + 9, 0.62);
      const side = (inX, inZ, outX, outZ) => Math.abs(g(inX, inZ) - g(outX, outZ)) / 2.5;
      const worst = pd.axis === 'z'
        ? Math.max(side(pd.x0 + 0.5, pd.z0 + run * f, pd.x0 - 2, pd.z0 + run * f), side(pd.x1 - 0.5, pd.z0 + run * f, pd.x1 + 2, pd.z0 + run * f))
        : Math.max(side(pd.x0 + run * f, pd.z0 + 0.5, pd.x0 + run * f, pd.z0 - 2), side(pd.x0 + run * f, pd.z1 - 0.5, pd.x0 + run * f, pd.z1 + 2));
      assert.ok(worst < 0.9, `${pd.id}: side drop slope ${worst.toFixed(2)} at ${f.toFixed(2)}`);
    }
  }
});

test('build pieces sit flush on the museum floors, not a metre above or below', () => {
  const { world } = site();
  const st = new Structures({ scene: new THREE.Scene(), world });
  for (const [x, z, floor] of [[26, -262, LEVEL.MAIN], [-46, -300, LEVEL.LOWER]]) {
    const pos = new THREE.Vector3(x, world.groundHeight(x, z, floor + 0.3), z);
    assert.ok(Math.abs(pos.y - floor) < 0.05, 'standing on the floor');
    for (const kind of ['wall', 'floor', 'ramp']) {
      const pl = st.plan(kind, pos, 0, kind === 'floor' ? -1 : 0);
      assert.ok(Math.abs(pl.y - floor) < 0.02, `${kind} at ${pl.y} on a floor at ${floor}`);
      assert.ok(pl.valid, `${kind} placeable on the museum floor`);
    }
  }
  assert.ok(BUILD.cost <= 5, 'pieces are cheap');
});
