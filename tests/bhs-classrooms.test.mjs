// Bentonville High School classroom generator (src/world/bhs/interior/classrooms/): determinism,
// neighbour variety, clear doors and paths, loot on surfaces, riser steps, budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { classroomReport, CLASSROOM_BUDGET, insideOutline, roomType, LAYOUTS } from '../src/world/bhs/interior/classrooms/index.js';

const data = () => JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));

function build() {
  const world = new World(data());
  const bhs = createBhs(world, data());
  return { world, rep: classroomReport(bhs.kit) };
}

const A = build();
const rooms = A.rep.rooms.filter((r) => !r.skipped);
const allParts = rooms.flatMap((r) => r.parts);

const corners = (p) => {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [p.cx + a * p.hx * c - b * p.hz * s, p.cz + a * p.hx * s + b * p.hz * c]);
};
/** Separating-axis overlap of two convex quads ([x, z] corners). */
function overlap(P, Q) {
  for (const poly of [P, Q])
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const nx = b[1] - a[1];
      const nz = a[0] - b[0];
      const pr = (q) => q.map(([x, z]) => x * nx + z * nz);
      const p1 = pr(P);
      const p2 = pr(Q);
      if (Math.max(...p1) <= Math.min(...p2) + 1e-6 || Math.max(...p2) <= Math.min(...p1) + 1e-6) return false;
    }
  return true;
}
/** The 1.6 m clear zone inside a door (from the partition face). */
function doorZone(d) {
  const t = 0.1;
  const hw = d.w / 2;
  if (d.side === 'z0') return [[d.x - hw, d.z + t], [d.x + hw, d.z + t], [d.x + hw, d.z + t + 1.6], [d.x - hw, d.z + t + 1.6]];
  if (d.side === 'z1') return [[d.x - hw, d.z - t - 1.6], [d.x + hw, d.z - t - 1.6], [d.x + hw, d.z - t], [d.x - hw, d.z - t]];
  if (d.side === 'x0') return [[d.x + t, d.z - hw], [d.x + t + 1.6, d.z - hw], [d.x + t + 1.6, d.z + hw], [d.x + t, d.z + hw]];
  return [[d.x - t - 1.6, d.z - hw], [d.x - t, d.z - hw], [d.x - t, d.z + hw], [d.x - t - 1.6, d.z + hw]];
}

test('classrooms: budgets (decor, colliders) and per-type counts', () => {
  const byType = {};
  for (const r of rooms) byType[r.type] = (byType[r.type] || 0) + 1;
  const chests = rooms.filter((r) => r.lootSpots.some((l) => l.kind === 'chest')).length;
  console.log(`[classrooms] rooms ${rooms.length} (skipped ${A.rep.rooms.length - rooms.length}), decor ${A.rep.decor}, colliders ${A.rep.colliders}, loot ${A.rep.loot} (chests in ${chests} rooms)`);
  console.log('[classrooms] types', JSON.stringify(byType));
  assert.ok(A.rep.decor < CLASSROOM_BUDGET.decor, `decor ${A.rep.decor} < ${CLASSROOM_BUDGET.decor}`);
  assert.ok(A.rep.colliders < CLASSROOM_BUDGET.colliders, `colliders ${A.rep.colliders} < ${CLASSROOM_BUDGET.colliders}`);
  assert.ok(rooms.length >= 80, 'most rooms dressed');
  for (const t of ['regular', 'science', 'art', 'computer', 'music', 'seminar', 'gallery']) assert.ok(byType[t] > 0, `has ${t} rooms`);
});

test('classrooms: deterministic output (two builds match)', () => {
  const B = build();
  assert.equal(B.rep.decor, A.rep.decor);
  assert.equal(B.rep.colliders, A.rep.colliders);
  assert.equal(B.rep.loot, A.rep.loot);
  const sig = (rep) => rep.rooms.map((r) => [r.key, r.layout, r.accent, r.mood, r.decor, r.colliders, (r.parts || []).map((p) => p.cx.toFixed(3) + ',' + p.cz.toFixed(3)).join(';')].join('|')).join('\n');
  assert.equal(sig(B.rep), sig(A.rep));
});

test('classrooms: room types come from the labels', () => {
  assert.equal(roomType('Chemistry Lab', 'lab'), 'science');
  assert.equal(roomType('Art Studio', 'classroom'), 'art');
  assert.equal(roomType('Computer Lab', 'classroom'), 'computer');
  assert.equal(roomType('Band Room', 'music'), 'music');
  assert.equal(roomType('Piano Lab', 'music'), 'piano');
  assert.equal(roomType('Robotics Lab', 'classroom'), 'robotics');
  assert.equal(roomType('Gallery', 'gallery'), 'gallery');
  assert.equal(roomType('Underwater Basket Weaving', 'classroom'), 'regular');
  assert.ok(LAYOUTS.length >= 6, 'at least 6 seating layouts');
  const used = new Set(rooms.filter((r) => r.type === 'regular').map((r) => r.layout));
  assert.ok(used.size >= 6, `regular rooms use >= 6 layouts (${[...used]})`);
});

test('classrooms: 6 neighbouring rooms (North south row, level 0) all differ in layout or accent', () => {
  const row = rooms.filter((r) => r.building === 'north' && r.level === 0 && r.ir.z0 > 247 && r.ir.x0 > -7 && r.ir.x1 < 58).sort((a, b) => a.ir.x0 - b.ir.x0);
  assert.equal(row.length, 6, row.map((r) => r.id).join(','));
  for (let i = 0; i < row.length; i++)
    for (let j = i + 1; j < row.length; j++) assert.ok(row[i].layout !== row[j].layout || row[i].accent !== row[j].accent, `${row[i].id} vs ${row[j].id}`);
  // adjacent rooms differ in accent outright
  for (let i = 0; i + 1 < row.length; i++) assert.notEqual(row[i].accent, row[i + 1].accent, `${row[i].id} / ${row[i + 1].id} accents`);
});

test('classrooms: no collider within 1.6 m inside any classroom door', () => {
  for (const r of rooms)
    for (const d of r.doors) {
      const Z = doorZone(d);
      for (const p of allParts) {
        if (p.y1 < r.base - 0.5 || p.y0 > r.base + 3) continue;
        assert.ok(!overlap(Z, corners(p)), `${r.building}:${r.id} door ${d.side} blocked by a ${p.role} at ${p.cx.toFixed(1)}, ${p.cz.toFixed(1)}`);
      }
    }
});

test('classrooms: colliders stay inside the building outline', () => {
  for (const r of rooms)
    for (const p of r.parts) for (const [x, z] of corners(p)) assert.ok(insideOutline(r.building, x, z, 0.1), `${r.building}:${r.id} ${p.role} corner ${x.toFixed(2)}, ${z.toFixed(2)} outside`);
});

test('classrooms: the room is reachable from its door (a walking grid around blocking props)', () => {
  const R = 0.3; // body radius
  for (const r of rooms) {
    const { ir } = r;
    const blocks = r.parts.filter((p) => p.y1 - r.base > 0.62 && p.role !== 'riser');
    const step = 0.25;
    const nx = Math.floor((ir.x1 - ir.x0) / step);
    const nz = Math.floor((ir.z1 - ir.z0) / step);
    const free = new Uint8Array(nx * nz);
    let nFree = 0;
    for (let i = 0; i < nx; i++)
      for (let k = 0; k < nz; k++) {
        const x = ir.x0 + (i + 0.5) * step;
        const z = ir.z0 + (k + 0.5) * step;
        if (!insideOutline(r.building, x, z, 0.35)) continue;
        const hit = blocks.some((p) => {
          const c = Math.cos(p.yaw);
          const s = Math.sin(p.yaw);
          const du = (x - p.cx) * c + (z - p.cz) * s;
          const dv = -(x - p.cx) * s + (z - p.cz) * c;
          return Math.abs(du) < p.hx + R && Math.abs(dv) < p.hz + R;
        });
        if (!hit) {
          free[i * nz + k] = 1;
          nFree++;
        }
      }
    const d = r.doors[0];
    const ins = { z0: [0, 0.5], z1: [0, -0.5], x0: [0.5, 0], x1: [-0.5, 0] }[d.side];
    let si = Math.floor((d.x + ins[0] - ir.x0) / step);
    let sk = Math.floor((d.z + ins[1] - ir.z0) / step);
    si = Math.max(0, Math.min(nx - 1, si));
    sk = Math.max(0, Math.min(nz - 1, sk));
    // a door outside the usable rect (plan overlap): start from the nearest free cell
    if (!free[si * nz + sk]) {
      let best = Infinity;
      for (let i = 0; i < nx; i++)
        for (let k = 0; k < nz; k++) {
          const dd = (i - si) ** 2 + (k - sk) ** 2;
          if (free[i * nz + k] && dd < best && dd <= 16) {
            best = dd;
            [si, sk] = [i, k];
          }
        }
    }
    const seen = new Uint8Array(nx * nz);
    const q = [[si, sk]];
    seen[si * nz + sk] = 1;
    let n = 0;
    while (q.length) {
      const [i, k] = q.pop();
      if (free[i * nz + k]) n++;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a;
        const kk = k + b;
        if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || seen[ii * nz + kk] || !free[ii * nz + kk]) continue;
        seen[ii * nz + kk] = 1;
        q.push([ii, kk]);
      }
    }
    assert.ok(n >= nFree * 0.6, `${r.building}:${r.id} (${r.type}/${r.layout}): only ${n}/${nFree} free cells reachable from the door`);
  }
});

test('classrooms: loot sits on surfaces, >= 1 spot per room, chests in at least half the rooms', () => {
  let chests = 0;
  for (const r of rooms) {
    assert.ok(r.lootSpots.length >= 1, `${r.building}:${r.id} has loot`);
    if (r.lootSpots.some((l) => l.kind === 'chest')) chests++;
    for (const l of r.lootSpots) {
      const g = A.world.groundHeight(l.x, l.z, l.y + 0.05);
      assert.ok(Math.abs(g - l.y) < 0.06, `${r.building}:${r.id} ${l.kind} at y ${l.y.toFixed(2)} but the surface is ${g.toFixed(2)}`);
    }
  }
  assert.ok(chests >= rooms.length / 2, `chests in ${chests} / ${rooms.length} rooms`);
});

test('classrooms: music risers step at most 0.6 m (0.2 m per tier)', () => {
  const risers = allParts.filter((p) => p.role === 'riser');
  assert.ok(risers.length > 0, 'music rooms have risers');
  for (const r of rooms)
    for (const p of r.parts.filter((q) => q.role === 'riser')) {
      const h = p.y1 - r.y; // above the drawn floor
      assert.ok(h <= 0.6 + 1e-6, `${r.id} riser ${h.toFixed(2)} m`);
      assert.ok(Math.abs(h / 0.2 - Math.round(h / 0.2)) < 1e-6, 'tiers are 0.2 m steps');
      assert.ok(p.collider.walkable, 'risers are walkable');
    }
});
