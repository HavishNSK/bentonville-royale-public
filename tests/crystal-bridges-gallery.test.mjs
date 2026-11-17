// Crystal Bridges galleries: every configured work hangs on a real wall of its wing, facing the
// room, without overlapping or hiding behind stairs; the config is validated as untrusted data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { PAVILIONS } from '../src/world/crystal-bridges/site.js';
import { buildSite } from '../src/world/crystal-bridges/build.js';
import { placeArt, obstaclesFrom, paintingSize } from '../src/world/crystal-bridges/gallery/hang.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../public/data/crystal-bridges.config.json', import.meta.url)));

import { sanitizeConfig, configUrl } from '../src/world/crystal-bridges/gallery/config.js';

function setup() {
  const world = new World({ ...mapData, buildings: [], roads: [] });
  const site = buildSite(world, mapData);
  const artIndex = {};
  for (const w of config.wings) for (const x of w.works) if (x.art) artIndex[x.art] = { width: 1000, height: 760 };
  return { world, site, placements: placeArt(site.hangLines, config.wings, artIndex, obstaclesFrom(site)) };
}

test('musewalk sizing rule', () => {
  assert.deepEqual(paintingSize(1), { w: 2.35, h: 2.35 });
  const wide = paintingSize(2, false);
  assert.equal(wide.w, 2.7);
  assert.ok(Math.abs(wide.h - 1.35) < 1e-9);
  assert.equal(paintingSize(2, true).w, 3.9);
});

test('every configured work in a wing with walls is hung', () => {
  const { site, placements } = setup();
  for (const w of config.wings) {
    if (!site.hangLines.some((L) => L.wing === w.id)) continue;
    const n = placements.filter((p) => p.wing === w.id).length;
    assert.equal(n, w.works.length, `${w.id}: hung ${n} of ${w.works.length}`);
  }
  assert.ok(placements.length >= 35, `placements ${placements.length}`);
});

test('works hang inside their pavilion, face the room, clear of stairs and of each other', () => {
  const { site, placements } = setup();
  const obstacles = obstaclesFrom(site);
  for (const p of placements) {
    const pv = PAVILIONS.find((q) => q.id === p.pv);
    const m = 4;
    assert.ok(p.x > pv.x0 - m && p.x < pv.x1 + m && p.z > pv.z0 - m && p.z < pv.z1 + m, `${p.work.art || p.work.title} outside ${pv.id}`);
    const fx = p.x + p.nx * 1.0;
    const fz = p.z + p.nz * 1.0;
    const bw = (pv.bow && Math.max(pv.bow.w || 0, pv.bow.e || 0)) || 0;
    assert.ok(fx > pv.x0 - bw && fx < pv.x1 + bw && fz > pv.z0 && fz < pv.z1, `${p.work.art || p.work.title} faces out of ${pv.id}`);
    for (const o of obstacles) assert.ok(!(fx > o.x0 && fx < o.x1 && fz > o.z0 && fz < o.z1), `${p.work.art} in front of an obstacle`);
    assert.ok(p.y - p.h / 2 > p.floor + 0.6, 'bottom edge above the floor');
  }
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i];
      const b = placements[j];
      if (a.pv !== b.pv || Math.abs(a.nx - b.nx) > 0.2 || Math.abs(a.nz - b.nz) > 0.2) continue;
      if (Math.abs((a.x - b.x) * a.nx + (a.z - b.z) * a.nz) > 0.5) continue; // different (parallel) walls
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      assert.ok(d > (a.w + b.w) / 2 + 1.2, `${a.work.art} overlaps ${b.work.art} (${d.toFixed(2)} m)`);
    }
  }
});

test('copyrighted works are placeholders, never fetched art', () => {
  for (const w of config.wings) {
    for (const x of w.works) {
      if (x.placeholder) assert.ok(!x.art, `${x.title} has an art file`);
      if (/Rockwell|Warhol|Kusama|O'Keeffe|Bourgeois|Marshall|Maya Lin|Rothko|Koons|Haring/.test(x.artist || '')) assert.ok(x.placeholder, `${x.artist} must be a placeholder`);
    }
  }
});

test('config sanitising and the ?cbConfig override', () => {
  const c = sanitizeConfig({ wings: [{ id: 'x', accent: 'red;}', frameStyle: 'evil', works: [{ art: 'a', title: 'T'.repeat(500), portal: { to: [1, 'x', 3] } }, null] }, 'junk'] });
  assert.equal(c.wings.length, 1);
  assert.equal(c.wings[0].accent, '#b7a98c');
  assert.equal(c.wings[0].frameStyle, 'dark');
  assert.equal(c.wings[0].works.length, 1);
  assert.equal(c.wings[0].works[0].title.length, 120);
  assert.equal(c.wings[0].works[0].portal, null);
  assert.equal(configUrl('?cbConfig=/data/test.json'), '/data/test.json');
  assert.equal(configUrl('?cbConfig=https://evil.example/x.json'), '/data/crystal-bridges.config.json');
  assert.equal(configUrl('?cbConfig=/data/../secret.json'), '/data/crystal-bridges.config.json');
  assert.equal(configUrl(''), '/data/crystal-bridges.config.json');
});
