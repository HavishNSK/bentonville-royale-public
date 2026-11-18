// Oriented box colliders (World.addBox): floating slabs you can walk under and stand on, walls that
// block, glass that breaks, and rays that hit all of them. Used by the Crystal Bridges landmark.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { makeBox, boxRay, boxPushCircle, boxContains } from '../src/world/boxColliders.js';

const data = { meta: { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } }, buildings: [], roads: [], areas: [], pois: [] };
const STEP = 0.62;
const R = 0.45;
const H = 1.8;

test('makeBox rejects degenerate boxes and computes a rotated AABB', () => {
  assert.throws(() => makeBox({ cx: 0, cz: 0, hx: 0, hz: 1, y0: 0, y1: 1 }));
  assert.throws(() => makeBox({ cx: 0, cz: 0, hx: 1, hz: 1, y0: 2, y1: 1 }));
  const b = makeBox({ cx: 10, cz: 5, hx: 4, hz: 1, yaw: Math.PI / 2, y0: 0, y1: 3 });
  assert.ok(Math.abs(b.minX - 9) < 1e-9 && Math.abs(b.maxX - 11) < 1e-9);
  assert.ok(Math.abs(b.minZ - 1) < 1e-9 && Math.abs(b.maxZ - 9) < 1e-9);
  assert.ok(boxContains(b, 10, 8.9) && !boxContains(b, 12, 5));
});

test('boxPushCircle pushes out of the nearest face and ignores far circles', () => {
  const b = makeBox({ cx: 0, cz: 0, hx: 5, hz: 0.2, y0: 0, y1: 4 });
  assert.equal(boxPushCircle(b, 0, 3, R), null);
  const p = boxPushCircle(b, 0, 0.5, R);
  assert.ok(p && p.z > 0 && Math.abs(p.x) < 1e-9, JSON.stringify(p));
  const q = boxPushCircle(b, 0, 0.05, R); // centre inside: leaves through +z
  assert.ok(q.z > 0.5);
});

test('boxRay hits the right face from outside and never from inside', () => {
  const b = makeBox({ cx: 0, cz: 0, hx: 2, hz: 2, yaw: 0.3, y0: 1, y1: 3 });
  const h = boxRay(b, 0, 10, 0, 0, -1, 0, 0, 100);
  assert.ok(h && Math.abs(h.t - 7) < 1e-9 && h.ny === 1);
  const u = boxRay(b, 0, 0, 0, 0, 1, 0, 0, 100);
  assert.ok(u && Math.abs(u.t - 1) < 1e-9 && u.ny === -1);
  assert.equal(boxRay(b, 0, 2, 0, 1, 0, 0, 0, 100), null, 'origin inside');
  assert.equal(boxRay(b, -10, 5, 0, 1, 0, 0, 0, 100), null, 'passes above');
  const s = boxRay(b, -10, 2, 0, 1, 0, 0, 0, 100);
  assert.ok(s && s.t > 7 && s.t < 9 && s.nx < 0);
});

function bridge() {
  const w = new World(data);
  // a 4 m-thick-free slab bridge at 6..6.5 m, 20 x 8 m, and a wall on the ground
  const slab = w.addBox({ cx: 0, cz: 0, hx: 10, hz: 4, y0: 6, y1: 6.5, kind: 'museum', mat: 'brick', hp: 1e9 });
  const wall = w.addBox({ cx: 30, cz: 0, hx: 0.2, hz: 6, y0: 0, y1: 4, kind: 'museum', mat: 'brick', hp: 1e9 });
  const glass = w.addBox({ cx: 50, cz: 0, hx: 0.1, hz: 3, y0: 0, y1: 4, kind: 'glass', mat: 'glass', hp: 60 });
  return { w, slab, wall, glass };
}

test('walk under a floating slab, stand on its top, bump its underside', () => {
  const { w } = bridge();
  // under it on the ground: no push, ground stays 0, ceiling is the underside
  const pos = { x: 0, y: 0, z: 0 };
  assert.equal(w.resolveCircle(pos, R, H, STEP), false);
  assert.equal(w.groundHeight(0, 0, 0, STEP), 0);
  assert.equal(w.ceilingAbove(0, 0, 0, STEP), 6);
  assert.equal(w.builtAbove(0, 0, 0), 6.5, 'slab caps snapping from below');
  assert.ok(w.groundHeight(0, 0, 5.5, STEP, w.builtAbove(0, 0, 5.5)) < 6, 'never snaps up through it from below');
  // on top
  assert.equal(w.groundHeight(0, 0, 6.5, STEP), 6.5);
  assert.equal(w.surface, 'floor');
  const top = { x: 3, y: 6.5, z: 1 };
  assert.equal(w.resolveCircle(top, R, H, STEP), false);
});

test('a ground wall blocks a body, rays and spawn points; a high slab does not block spawns', () => {
  const { w, wall } = bridge();
  const pos = { x: 29.9, y: 0, z: 0 };
  assert.ok(w.resolveCircle(pos, R, H, STEP));
  assert.ok(pos.x < 30 - 0.2 - R + 1e-6, `pushed to ${pos.x}`);
  const hit = w.raycast(20, 1.5, 0, 1, 0, 0, 50);
  assert.ok(hit && hit.collider === wall && Math.abs(hit.x - 29.8) < 1e-6 && hit.kind === 'museum');
  assert.equal(w.blockedAt(30, 0, 0.5), true);
  assert.equal(w.blockedAt(0, 0, 0.5), false, 'a slab 6 m up is no obstacle on the ground');
  assert.equal(w.clearLine(20, 1, 0, 40, 1, 0), false);
});

test('glass breaks (remove) and comes back on restore; boxes are found by id', () => {
  const { w, glass } = bridge();
  assert.equal(w.boxById(glass.id), glass);
  assert.equal(w.raycast(40, 1.5, 0, 1, 0, 0, 50).collider, glass);
  w.remove(glass);
  assert.equal(glass.alive, false);
  const h = w.raycast(40, 1.5, 0, 1, 0, 0, 20);
  assert.ok(!h || h.collider !== glass);
  glass.hp = 0;
  w.restore(glass);
  assert.equal(glass.alive, true);
  assert.equal(glass.hp, 60);
  assert.equal(w.raycast(40, 1.5, 0, 1, 0, 0, 50).collider, glass);
});

test('a vertical ray (looking straight down) hits a slab top', () => {
  const { w, slab } = bridge();
  const h = w.raycast(1, 20, 1, 0, -1, 0, 50);
  assert.ok(h && h.collider === slab && Math.abs(h.y - 6.5) < 1e-6);
});
