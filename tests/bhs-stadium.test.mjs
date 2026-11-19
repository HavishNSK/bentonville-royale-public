// Tiger Stadium (BHS): colliders stay in the site, rows are climbable, every piece is breakable,
// nothing is left floating when a support breaks, ids are deterministic, loot sits on surfaces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { BHS_STADIUM_SITE, BHS_NORTH } from '../src/world/bhs/data.js';
import { buildStadium, collapseStadiumDeps, restoreStadiumDeps, RISE, STADIUM_HP } from '../src/world/bhs/stadium.js';
import { PLAYER } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62; // World STEP / Player STEP_UP
const SITE = BHS_STADIUM_SITE;

function build() {
  const world = new World(mapData);
  const before = world._boxes ? world._boxes.length : 0;
  const out = buildStadium(world, { site: SITE, owner: 'bhs', mapData });
  const cols = out.parts.map((p) => p.collider);
  return { world, out, cols, before };
}

/** Walk a body (PLAYER radius / height) from `from` toward `to` in small steps like Player does. */
function walk(world, from, to, step = 0.05) {
  const pos = { x: from[0], y: from[1], z: from[2] };
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const n = Math.ceil(Math.hypot(dx, dz) / step);
  let minY = pos.y;
  for (let i = 1; i <= n; i++) {
    const ox = pos.x, oz = pos.z;
    pos.x += dx / n;
    pos.z += dz / n;
    const cap = world.builtAbove(ox, oz, pos.y);
    world.resolveCircle(pos, PLAYER.radius, PLAYER.height);
    pos.y = world.groundHeight(pos.x, pos.z, pos.y, STEP, cap);
    minY = Math.min(minY, pos.y);
  }
  return { ...pos, minY };
}

test('every stadium collider stays inside the site and clear of the North Building', () => {
  const { cols } = build();
  assert.ok(cols.length > 200, `collider count ${cols.length}`);
  for (const c of cols) {
    assert.ok(c.minX >= SITE.x0 && c.maxX <= SITE.x1 && c.minZ >= SITE.z0 && c.maxZ <= SITE.z1, `box ${c.id} (${c.stadium}) leaves the site`);
  }
  const north = mapData.buildings.find((b) => b.id === BHS_NORTH);
  assert.ok(north, 'North Building in the map');
  const bx = north.p.map((p) => p[0]);
  const bz = north.p.map((p) => p[1]);
  const nb = { minX: Math.min(...bx), maxX: Math.max(...bx), minZ: Math.min(...bz), maxZ: Math.max(...bz) };
  for (const c of cols) {
    const apart = c.maxX < nb.minX || c.minX > nb.maxX || c.maxZ < nb.minZ || c.minZ > nb.maxZ;
    assert.ok(apart, `box ${c.id} (${c.stadium}) overlaps the North Building footprint`);
  }
});

test('every collider is owned, finite, harvestable or breakable, with a real material', () => {
  const { cols } = build();
  for (const c of cols) {
    assert.equal(c.owner, 'bhs', `box ${c.id} owner`);
    assert.ok(Number.isFinite(c.hp) && c.hp > 0 && c.hp <= 600 && c.maxHp === c.hp, `box ${c.id} hp ${c.hp}`);
    if (c.mat === 'glass') {
      assert.equal(c.breakable, true);
      assert.equal(c.hp, STADIUM_HP.glass);
      assert.equal(c.ref, null, 'glass gives no mats');
    } else {
      assert.ok(['brick', 'metal', 'wood'].includes(c.mat), `box ${c.id} mat ${c.mat}`);
      // kind 'prop' + ref array: bullets wear it down, the pickaxe harvests it, explosives smash it
      assert.equal(c.kind, 'prop');
      assert.ok(Array.isArray(c.ref));
      if (c.mat === 'brick') assert.ok(c.hp >= 300 && c.hp <= 600, `concrete ${c.id} hp ${c.hp}`);
      if (c.mat === 'metal') assert.ok(c.hp >= 150 && c.hp <= 300, `metal ${c.id} hp ${c.hp}`);
    }
  }
});

test('box ids and layout are deterministic', () => {
  const a = build();
  const b = build();
  assert.equal(a.cols.length, b.cols.length);
  const sig = (r) => r.cols.map((c) => [c.id - r.before, c.stadium, c.cx.toFixed(3), c.cz.toFixed(3), c.y0.toFixed(3), c.y1.toFixed(3)].join(',')).join(';');
  assert.equal(sig(a), sig(b));
  a.cols.forEach((c, i) => assert.equal(c.id, a.before + i, 'sequential ids'));
});

test('stand rows rise less than the step height', () => {
  const { out } = build();
  const { home } = out.plan;
  assert.ok(RISE < STEP);
  let prev = 0;
  for (const L of home.levels) {
    assert.ok(L.top - prev <= STEP + 1e-9, `home level ${L.k}`);
    prev = L.top;
  }
  assert.ok(out.plan.press.floor - prev <= STEP + 1e-9, 'top walkway -> press box floor');
});

test('players can climb the home stand (rows and aisles) and enter the press box', () => {
  const { world, out } = build();
  const { home, press } = out.plan;
  const top = home.levels[home.levels.length - 1];
  for (const sec of home.sections) {
    if (sec.press) continue;
    // up the aisle from the track to the top walkway
    const z = sec.aisle;
    const end = walk(world, [home.front + 1.2, 0, z], [top.b + 0.5, 0, z]);
    assert.ok(Math.abs(end.x - (top.b + 0.5)) < 0.05, `aisle ${sec.i} blocked at x ${end.x.toFixed(2)}`);
    assert.ok(Math.abs(end.y - top.top) < 1e-6, `aisle ${sec.i} ends at y ${end.y}`);
    // straight over the seat rows (from row 1)
    const zr = (sec.z0 + sec.aisle) / 2;
    const r = walk(world, [home.levels[0].a - 0.3, home.levels[0].top, zr], [top.b + 0.5, 0, zr]);
    assert.ok(Math.abs(r.y - top.top) < 1e-6, `rows of section ${sec.i} end at y ${r.y}`);
  }
  // the press box: from the top walkway through the north and south doors
  const xw = press.x0 + 0.6;
  const n = walk(world, [xw, top.top, home.sections[1].z0 + 2], [xw, 0, press.z0 + 3]);
  assert.ok(Math.abs(n.z - (press.z0 + 3)) < 0.05 && Math.abs(n.y - press.floor) < 1e-6, `north door: ${n.z.toFixed(2)} ${n.y}`);
  const s = walk(world, [xw, top.top, home.sections[4].z1 - 2], [xw, 0, press.z1 - 3]);
  assert.ok(Math.abs(s.z - (press.z1 - 3)) < 0.05 && Math.abs(s.y - press.floor) < 1e-6, `south door: ${s.z.toFixed(2)} ${s.y}`);
  // inside: under the ceiling with headroom
  assert.ok(press.ceil - press.floor >= PLAYER.height + 0.3);
});

test('no visitor bleachers: the strip east of the field is open for the North Building entrance', () => {
  const { out } = build();
  const { field, fence } = out.plan;
  assert.equal(out.plan.visitor.built, false);
  assert.ok(out.parts.every((p) => p.cx - p.hx <= fence.x1 + 0.3), 'nothing east of the east fence');
  assert.ok(fence.x1 - field.x1 <= 4.5 && -46.2 - fence.x1 >= 11, 'an entrance plaza of 11 m or more');
});

test('breaking any one piece never leaves another floating; restore puts it all back', () => {
  const { world, cols } = build();
  const byId = new Map(cols.map((c) => [c.id, c]));
  // every piece above the ground names the supports it rests on
  for (const c of cols) {
    if (c.y0 > 0.05) assert.ok(c.supports && c.supports.length, `box ${c.id} (${c.stadium}) floats with no support`);
  }
  const supported = () => {
    for (const c of cols) {
      if (!c.alive || !c.supports) continue;
      for (const id of c.supports) if (!byId.get(id).alive) return c;
    }
    return null;
  };
  for (const c of cols) {
    world.remove(c);
    const gone = collapseStadiumDeps(world, c);
    const bad = supported();
    assert.equal(bad, null, bad && `breaking ${c.id} (${c.stadium}) leaves ${bad.id} (${bad.stadium}) floating`);
    world.restore(c);
    const back = restoreStadiumDeps(world, c);
    assert.equal(back.length, gone.length);
    assert.ok(cols.every((k) => k.alive), `restore after ${c.id}`);
  }
});

test('a broken press box base drops the press box above it', () => {
  const { world, out, cols } = build();
  const base = cols.find((c) => c.stadium === 'pressBase');
  world.remove(base);
  const gone = collapseStadiumDeps(world, base);
  const roles = new Set(gone.map((c) => c.stadium));
  for (const r of ['pressWall', 'glass', 'roof']) assert.ok(roles.has(r), `base takes the ${r} with it`);
  // standing on the press floor there now means falling to the ground below
  const sg = out.plan.press.segs[0];
  assert.ok(world.groundHeight(out.plan.press.x0 + 2, (sg.z0 + sg.z1) / 2, out.plan.press.floor) < 1);
  world.restore(base);
  restoreStadiumDeps(world, base);
  assert.ok(Math.abs(world.groundHeight(out.plan.press.x0 + 2, (sg.z0 + sg.z1) / 2, out.plan.press.floor) - out.plan.press.floor) < 1e-6);

  // (the visitor bleachers, whose frame posts carried planks, are not built: user 2026-11-18)
  assert.ok(!cols.some((c) => c.stadium === 'post' || c.stadium === 'plank'));
});

test('loot spots sit on surfaces inside the site, one high-tier chest in the press box', () => {
  const { world, out } = build();
  assert.ok(out.loot.length >= 4);
  assert.ok(world.fixedLoot.length >= out.loot.length);
  const press = out.plan.press;
  const high = out.loot.filter((l) => l.tier === 'high');
  assert.equal(high.length, 1);
  const h = high[0];
  assert.ok(h.x > press.x0 && h.x < press.x1 && h.z > press.z0 && h.z < press.z1 && h.y === press.floor, 'high-tier chest in the press box');
  for (const l of out.loot) {
    assert.ok(['chest', 'ammoBox', 'item'].includes(l.kind));
    assert.ok(l.x > SITE.x0 && l.x < SITE.x1 && l.z > SITE.z0 && l.z < SITE.z1, `${l.at} in site`);
    assert.ok(Math.abs(world.groundHeight(l.x, l.z, l.y + 0.3) - l.y) < 1e-6, `${l.at} sits on a surface`);
    // nothing solid through the spot (a body-sized column above it is clear)
    for (const c of out.parts.map((p) => p.collider)) {
      const inside = l.x > c.minX - 0.3 && l.x < c.maxX + 0.3 && l.z > c.minZ - 0.3 && l.z < c.maxZ + 0.3;
      if (inside) assert.ok(c.y1 <= l.y + 1e-6 || c.y0 >= l.y + 1.2, `${l.at} inside box ${c.id} (${c.stadium})`);
    }
  }
});

test('the site stays reserved for the stadium', () => {
  const { world } = build();
  assert.ok(world.reservedAt((SITE.x0 + SITE.x1) / 2, (SITE.z0 + SITE.z1) / 2));
});
