// Tiger Arena + auxiliary gym (src/world/bhs/interior/gym): bleacher rows and aisles are climbable,
// the concourse is reached by stairs, every piece stays inside the hero rects, loot sits on surfaces,
// budgets hold and the build is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { GYM, RISE, CONC_Y, CONC } from '../src/world/bhs/interior/gym/index.js';
import { PLAYER } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62; // World STEP / Player STEP_UP

function build() {
  const world = new World(mapData);
  const bhs = createBhs(world, mapData);
  const g = { ...GYM };
  const parts = bhs.kit.parts.slice(g.parts[0], g.parts[1]);
  const decors = bhs.kit.decors.slice(g.decors[0], g.decors[1]);
  return { world, bhs, g, parts, decors };
}
const B = build();

/** Walk a body (PLAYER radius / height) from `from` toward `to` in small steps like Player does. */
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

/** World-space corners of an oriented box. */
function corners(b) {
  const c = Math.cos(b.yaw || 0);
  const s = Math.sin(b.yaw || 0);
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => [b.cx + u * b.hx * c - v * b.hz * s, b.cz + u * b.hx * s + v * b.hz * c]);
}
const inRect = (r, [x, z], m = 1e-3) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;

test('budgets: colliders and decor pieces', () => {
  assert.ok(B.parts.length > 200 && B.parts.length < 1200, `colliders ${B.parts.length}`);
  assert.ok(B.decors.length > 2000 && B.decors.length < 20000, `decor ${B.decors.length}`);
});

test('every gym piece stays inside the arena or the auxiliary gym rect', () => {
  const { ARENA, AUX_GYM } = B.g;
  for (const p of [...B.parts, ...B.decors]) {
    const cs = corners(p);
    const ok = cs.every((q) => inRect(ARENA, q)) || cs.every((q) => inRect(AUX_GYM, q));
    assert.ok(ok, `piece ${p.look} at ${p.cx.toFixed(2)}, ${p.cz.toFixed(2)} leaves the gym rects`);
    assert.ok(p.y0 >= -0.4 && /* kit stair stringers dip under the floor */ p.y1 <= (inRect(ARENA, [p.cx, p.cz]) ? ARENA.top : AUX_GYM.top), `piece ${p.look} y ${p.y0}..${p.y1}`);
  }
  for (const l of B.g.loot) assert.ok(inRect(ARENA, [l.x, l.z]) || inRect(AUX_GYM, [l.x, l.z]), `loot ${l.at}`);
});

test('colliders are owned, finite and use kit materials; groups are interior groups', () => {
  for (const p of B.parts) {
    const c = p.collider;
    assert.equal(c.owner, 'bhs');
    assert.ok(Number.isFinite(c.minX) && Number.isFinite(c.maxY ?? c.y1));
    assert.ok(['brick', 'metal', 'wood', 'glass'].includes(c.mat), `mat ${c.mat}`);
    assert.ok(/^int:south:[01]$/.test(p.group), `group ${p.group}`);
  }
  for (const d of B.decors) assert.ok(/^int:south:[01]$/.test(d.group), `decor group ${d.group}`);
});

test('bleacher rows rise 0.4 m (under the step height) up to the concourse', () => {
  assert.ok(RISE <= 0.6 && RISE < STEP);
  for (const S of B.g.arena.sides) {
    let prev = 0;
    for (const r of S.rows) {
      assert.ok(r.top - prev <= 0.6 + 1e-9, `${S.name} row ${r.k}`);
      prev = r.top;
    }
    assert.ok(Math.abs(prev - CONC_Y) < 1e-9, 'top row is level with the concourse');
    assert.ok(S.rows.length >= 10 && S.rows.length <= 12);
  }
});

test('players climb every aisle to the concourse, and over the rows to the top row', () => {
  const { world } = B;
  for (const S of B.g.arena.sides) {
    const front = S.xw + S.s * (CONC + S.rows.length * 0.8);
    const conc = S.xw + S.s * (CONC / 2);
    for (const a of S.aisles) {
      const end = walk(world, [front + S.s * 1.5, 0, a], [conc, 0, a]);
      assert.ok(Math.abs(end.x - conc) < 0.05, `${S.name} aisle ${a} blocked at x ${end.x.toFixed(2)}`);
      assert.ok(Math.abs(end.y - CONC_Y) < 1e-6, `${S.name} aisle ${a} ends at y ${end.y}`);
    }
    for (const [z0, z1] of S.sections) {
      const z = (z0 + z1) / 2;
      const end = walk(world, [front + S.s * 1.5, 0, z], [conc, 0, z]);
      // the concourse railing stops the walk on the top row
      assert.ok(Math.abs(end.y - CONC_Y) < 1e-6, `${S.name} rows ${z0}..${z1} end at y ${end.y}`);
      const top = S.rows[S.rows.length - 1];
      assert.ok(end.x >= top.x0 - 0.4 && end.x <= top.x1 + 0.4, `${S.name} rows ${z0}..${z1} stop on the top row (x ${end.x.toFixed(2)})`);
    }
  }
});

test('the bleachers are solid cover from the court floor', () => {
  const { world } = B;
  for (const S of B.g.arena.sides) {
    const z = (S.sections[1][0] + S.sections[1][1]) / 2;
    const top = S.rows[S.rows.length - 1];
    const mid = (top.x0 + top.x1) / 2;
    // under the concourse, behind the top row: walking toward the court is blocked by the row
    const end = walk(world, [S.xw + S.s * 1.5, 0, z], [mid + S.s * 3, 0, z]);
    assert.ok(Math.abs(end.y) < 1e-6 && (S.s > 0 ? end.x < top.x0 : end.x > top.x1), `${S.name} top row blocks at x ${end.x.toFixed(2)}`);
  }
});

test('the concourse is reachable from the floor by its stairs (risers <= 0.6 m)', () => {
  const { world } = B;
  const stairs = B.g.arena.stairs;
  assert.equal(stairs.length, 4);
  for (const s of stairs) {
    const dx = s.b[0] - s.a[0];
    const L = Math.abs(dx);
    const dir = Math.sign(dx);
    assert.ok((s.y1 - s.y0) / Math.ceil((s.y1 - s.y0) / 0.17) <= 0.6);
    const from = [s.a[0] - dir * 1.5, 0, s.a[1]];
    const to = [s.b[0] + dir * 1.5, 0, s.b[1]];
    const end = walk(world, from, to);
    assert.ok(Math.abs(end.y - CONC_Y) < 1e-6, `${s.side} stair at z ${s.a[1].toFixed(1)} ends at y ${end.y} (x ${end.x.toFixed(2)}, L ${L.toFixed(1)})`);
  }
});

test('the east entry gap and the under-concourse walk connect the door to the court', () => {
  const { world } = B;
  const E = B.g.arena.sides[1];
  const zg = (E.gap[0] + E.gap[1]) / 2;
  const end = walk(world, [E.xw - 0.6, 0, zg], [B.g.arena.CX, 0, zg]);
  assert.ok(Math.abs(end.x - B.g.arena.CX) < 0.05 && Math.abs(end.y) < 1e-6, `gap blocked at ${end.x.toFixed(2)}`);
});

test('loot sits on surfaces, with one high-tier chest on the concourse', () => {
  const { world } = B;
  const loot = B.g.loot;
  assert.ok(loot.length >= 8, `loot ${loot.length}`);
  const chests = loot.filter((l) => l.kind === "chest").length;
  assert.ok(chests >= 4 && chests <= 6, `gym chests ${chests}`);
  const high = loot.filter((l) => l.tier === 'high');
  assert.equal(high.length, 1);
  assert.equal(high[0].kind, 'chest');
  assert.ok(Math.abs(high[0].y - CONC_Y) < 1e-9, 'chest on the concourse');
  for (const l of loot) {
    assert.ok(['chest', 'ammoBox', 'item'].includes(l.kind));
    assert.ok(Math.abs(world.groundHeight(l.x, l.z, l.y + 0.3) - l.y) < 1e-6, `${l.at} sits on a surface`);
    for (const p of B.parts) {
      const c = p.collider;
      const near = l.x > c.minX - 0.2 && l.x < c.maxX + 0.2 && l.z > c.minZ - 0.2 && l.z < c.maxZ + 0.2;
      if (near) assert.ok(c.y1 <= l.y + 1e-6 || c.y0 >= l.y + 1.2, `${l.at} inside a ${p.role} box`);
    }
  }
  assert.ok(world.fixedLoot.some((f) => f.at === 'gymConcourse'));
});

test('the build is deterministic', () => {
  const A = B;
  const C = build();
  assert.equal(A.parts.length, C.parts.length);
  assert.equal(A.decors.length, C.decors.length);
  const sig = (r) => r.parts.map((p) => [p.collider.id, p.role, p.cx.toFixed(3), p.cz.toFixed(3), p.y0.toFixed(3), p.y1.toFixed(3)].join(',')).join(';');
  assert.equal(sig(A), sig(C));
  const dsig = (r) => r.decors.map((d) => [d.look, d.cx.toFixed(3), d.cz.toFixed(3), d.y1.toFixed(3)].join(',')).join(';');
  assert.equal(dsig(A), dsig(C));
});
