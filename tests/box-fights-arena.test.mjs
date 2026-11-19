// Box Fights arena: six static addBox colliders at y 300, Structures.buildArea / placeBuilt,
// Combat.noKnock / resetRound. Headless (no WebGL); layout values are constructed inline.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { Combat } from '../src/game/Combat.js';
import { BUILD } from '../src/core/config.js';

const STEP = 0.62;
const R = 0.45;
const H = 1.8;
const FLOOR = 300;
const CEIL = 306;
const N = 8;
const rect = { minX: -240, minZ: 160, maxX: -240 + N * 4, maxZ: 160 + N * 4 };
const buildArea = { ...rect, minY: FLOOR, maxY: CEIL };

function setup() {
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], landmarks: {} });
  const mid = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
  const hx = (rect.maxX - rect.minX) / 2;
  const hz = (rect.maxZ - rect.minZ) / 2;
  const base = { kind: 'arena', mat: 'metal', hp: 1e9 };
  const cols = [
    world.addBox({ ...base, cx: mid.x, cz: mid.z, hx, hz, y0: FLOOR - 1, y1: FLOOR }),
    world.addBox({ ...base, cx: mid.x, cz: mid.z, hx, hz, y0: CEIL, y1: CEIL + 1 }),
    world.addBox({ ...base, cx: rect.minX - 0.5, cz: mid.z, hx: 0.5, hz: hz + 1, y0: FLOOR - 1, y1: CEIL + 1 }),
    world.addBox({ ...base, cx: rect.maxX + 0.5, cz: mid.z, hx: 0.5, hz: hz + 1, y0: FLOOR - 1, y1: CEIL + 1 }),
    world.addBox({ ...base, cx: mid.x, cz: rect.minZ - 0.5, hx: hx + 1, hz: 0.5, y0: FLOOR - 1, y1: CEIL + 1 }),
    world.addBox({ ...base, cx: mid.x, cz: rect.maxZ + 0.5, hx: hx + 1, hz: 0.5, y0: FLOOR - 1, y1: CEIL + 1 }),
  ];
  const st = new Structures({ scene: new THREE.Scene(), world });
  return { world, st, cols, mid };
}

test('arena floor is solid at 300 m and the ceiling is at 306 m', () => {
  const { world, mid } = setup();
  assert.ok(Math.abs(world.groundHeight(mid.x, mid.z, FLOOR + 0.3, STEP) - FLOOR) < 1e-6);
  assert.ok(Math.abs(world.ceilingAbove(mid.x, mid.z, FLOOR + 1, STEP) - CEIL) < 1e-6);
});

test('a player cannot be pushed through any wall', () => {
  const { world, mid } = setup();
  const probes = [
    { x: rect.minX + 0.2, z: mid.z, axis: 'x', sign: 1 },
    { x: rect.maxX - 0.2, z: mid.z, axis: 'x', sign: -1 },
    { x: mid.x, z: rect.minZ + 0.2, axis: 'z', sign: 1 },
    { x: mid.x, z: rect.maxZ - 0.2, axis: 'z', sign: -1 },
  ];
  for (const p of probes) {
    const pos = { x: p.x, y: FLOOR, z: p.z };
    world.resolveCircle(pos, R, H, STEP);
    const inward = p.axis === 'x' ? (pos.x - p.x) * p.sign : (pos.z - p.z) * p.sign;
    assert.ok(inward >= 0, `pushed outward ${JSON.stringify(p)} -> ${JSON.stringify(pos)}`);
    assert.ok(pos.x >= rect.minX && pos.x <= rect.maxX && pos.z >= rect.minZ && pos.z <= rect.maxZ);
  }
  // a circle that overlaps the wall is moved clear of it, back into the interior
  const pos = { x: rect.minX - 0.1, y: FLOOR, z: (rect.minZ + rect.maxZ) / 2 };
  assert.equal(world.resolveCircle(pos, R, H, STEP), true);
  assert.ok(pos.x >= rect.minX + R - 1e-6 || pos.x <= rect.minX - 1 - R + 1e-6);
});

test('wall plan on the arena floor sits at y = 300 and is valid', () => {
  const { st, mid } = setup();
  st.buildArea = buildArea;
  const pl = st.plan('wall', { x: mid.x + 1, y: FLOOR, z: mid.z + 1 }, 0, 0, {});
  assert.equal(pl.y, FLOOR);
  assert.equal(pl.valid, true);
});

test('a placed piece in the arena is grounded', () => {
  const { st, mid } = setup();
  st.buildArea = buildArea;
  const pl = st.plan('wall', { x: mid.x + 1, y: FLOOR, z: mid.z + 1 }, 0, 0, {});
  const p = st.place(pl, 'wood', null);
  assert.ok(p);
  assert.equal(p.grounded, true);
});

test('buildArea rejects outside, boundary-line walls and anything above the ceiling', () => {
  const { st } = setup();
  const wall = (x, z, y = FLOOR, rot = 0) => ({ kind: 'wall', x, y, z, rot });
  const floor = (x, z, y = FLOOR) => ({ kind: 'floor', x, y, z, rot: 0 });
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4)), true, 'no area: unrestricted');
  st.buildArea = buildArea;
  // interior line and cell centres are fine
  assert.equal(st.fits(wall(rect.minX + 4, rect.minZ + 2, FLOOR, Math.PI / 2)), true);
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4)), true);
  assert.equal(st.fits(floor(rect.minX + 2, rect.minZ + 2)), true);
  // boundary lines (would overlap the barrier)
  assert.equal(st.fits(wall(rect.minX, rect.minZ + 2, FLOOR, Math.PI / 2)), false);
  assert.equal(st.fits(wall(rect.maxX, rect.minZ + 2, FLOOR, Math.PI / 2)), false);
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ)), false);
  assert.equal(st.fits(wall(rect.minX + 2, rect.maxZ)), false);
  // outside
  assert.equal(st.fits(wall(rect.maxX + 4, rect.minZ + 2, FLOOR, Math.PI / 2)), false);
  assert.equal(st.fits(floor(rect.minX - 2, rect.minZ + 2)), false);
  // floors on the boundary are not strictly inside either
  assert.equal(st.fits(floor(rect.minX, rect.minZ + 2)), false);
  // vertical: wall top above ceiling, below floor
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4, CEIL - BUILD.level + 3)), false);
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4, CEIL - BUILD.level)), true);
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4, FLOOR - 3)), false);
  assert.equal(st.fits(floor(rect.minX + 2, rect.minZ + 2, CEIL)), false, 'floor flush with the ceiling');
  assert.equal(st.fits(floor(rect.minX + 2, rect.minZ + 2, CEIL - 3)), true);
  assert.equal(st.fits(floor(rect.minX + 2, rect.minZ + 2, CEIL + 3)), false);
  assert.equal(st.fits({ kind: 'ramp', x: rect.minX + 2, y: CEIL - 3, z: rect.minZ + 2, rot: 0 }), true, 'ramp one level under');
  assert.equal(st.fits({ kind: 'cone', x: rect.minX + 2, y: CEIL - 3, z: rect.minZ + 2, rot: 0 }), true, 'cone one level under');
  assert.equal(st.fits({ kind: 'cone', x: rect.minX + 2, y: CEIL, z: rect.minZ + 2, rot: 0 }), false, 'cone at the ceiling');
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4, CEIL)), false, 'wall at the ceiling');
  // non-finite
  assert.equal(st.fits(wall(NaN, rect.minZ + 4)), false);
  // clearing the area restores the old behaviour
  st.buildArea = null;
  assert.equal(st.fits(wall(rect.minX + 2, rect.minZ + 4)), true);
});

test('placeBuilt gives a finished piece (full hp, grown) and importNet still does', () => {
  const { st, mid } = setup();
  const pl = { kind: 'wall', x: mid.x + 2, y: FLOOR, z: mid.z, rot: 0, valid: true };
  const p = st.placeBuilt(pl, 'brick', null);
  assert.ok(p);
  assert.equal(p.hp, p.maxHp);
  assert.equal(p.growing, false);
  assert.ok(p.age >= 99);
  assert.equal(st.placeBuilt(pl, 'brick', null), null, 'same slot twice');
  const q = st.place({ kind: 'floor', x: mid.x + 2, y: FLOOR, z: mid.z + 2, rot: 0, valid: true }, 'wood', null);
  assert.ok(q.hp < q.maxHp && q.growing === true);
  // importNet round trip of the exported pieces
  const rows = st.exportNet();
  const st2 = new Structures({ scene: new THREE.Scene(), world: setup().world });
  st2.importNet(rows);
  assert.equal(st2.pieces.length, rows.length);
  for (const x of st2.pieces) assert.equal(x.growing, false);
});

test('Structures.clear() removes every piece and its collider (between rounds)', () => {
  const { st, world, mid } = setup();
  const p = st.placeBuilt({ kind: 'wall', x: mid.x + 2, y: FLOOR, z: mid.z, rot: 0, valid: true }, 'brick', null);
  assert.ok(p.alive);
  st.clear();
  assert.equal(st.pieces.length, 0);
  assert.equal(st.slots.size, 0);
  assert.equal(p.alive, false);
  const again = st.placeBuilt({ kind: 'wall', x: mid.x + 2, y: FLOOR, z: mid.z, rot: 0, valid: true }, 'brick', null);
  assert.ok(again, 'slot is free again');
  void world;
});

test('world.remove / restore toggles arena collision', () => {
  const { world, cols, mid } = setup();
  for (const c of cols) world.remove(c);
  assert.ok(world.groundHeight(mid.x, mid.z, FLOOR + 0.3, STEP) < FLOOR - 5, 'floor gone');
  assert.equal(world.ceilingAbove(mid.x, mid.z, FLOOR + 1, STEP), Infinity);
  for (const c of cols) world.restore(c);
  assert.ok(Math.abs(world.groundHeight(mid.x, mid.z, FLOOR + 0.3, STEP) - FLOOR) < 1e-6);
  assert.ok(Math.abs(world.ceilingAbove(mid.x, mid.z, FLOOR + 1, STEP) - CEIL) < 1e-6);
});

test('Combat.noKnock makes downed players go straight to elimination', () => {
  const c = new Combat({ world: null, structures: null, fx: null, sfx: null, view: null });
  const a = { team: 1, alive: true, downed: false, pos: { x: 0, y: 0, z: 0 } };
  const b = { team: 1, alive: true, downed: false, pos: { x: 1, y: 0, z: 0 } };
  c.actors.push(a, b);
  c.teamMode = true;
  assert.equal(c.noKnock, false);
  assert.equal(c._canKnock(a, {}), true, 'baseline: teammate standing');
  c.noKnock = true;
  assert.equal(c._canKnock(a, {}), false);
});

test('Combat.resetRound clears projectiles and cancels bursts but keeps actors', () => {
  const c = new Combat({ world: null, structures: null, fx: null, sfx: null, view: null });
  c.actors.push({ team: 1 });
  c.projectiles.push({}, {});
  c._spent.push({});
  const e = c._burstEpoch;
  c.resetRound();
  assert.equal(c.projectiles.length, 0);
  assert.equal(c._spent.length, 0);
  assert.ok(c._burstEpoch > e);
  assert.equal(c.actors.length, 1);
});

test('buildArenaMeshes builds a solid, shadowless indoor room and disposes cleanly', async () => {
  const { buildArenaMeshes } = await import('../src/render/BoxArena.js');
  const a = buildArenaMeshes({ rect, floorY: FLOOR, ceilY: CEIL });
  assert.ok(a.group.isGroup && a.group.children.length > 0);
  let meshes = 0;
  const eps = 1e-3;
  const v = new THREE.Vector3();
  a.group.traverse((o) => {
    assert.equal(o.castShadow, false, `castShadow ${o.name}`);
    if (!o.isMesh) return;
    meshes++;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      assert.ok(v.x >= rect.minX - eps && v.x <= rect.maxX + eps, `x ${v.x} in ${o.name}`);
      assert.ok(v.z >= rect.minZ - eps && v.z <= rect.maxZ + eps, `z ${v.z} in ${o.name}`);
      assert.ok(v.y >= FLOOR - eps && v.y <= CEIL + eps, `y ${v.y} in ${o.name}`);
    }
  });
  assert.ok(meshes >= 4 && meshes < 12, `mesh count ${meshes}`);
  const floor = a.group.getObjectByName('BoxArenaFloor');
  assert.equal(floor.receiveShadow, true);
  const walls = a.group.getObjectByName('BoxArenaWalls');
  assert.equal(walls.material.transparent, false);
  assert.equal(walls.material.depthWrite, true);
  assert.equal(walls.material.side, THREE.FrontSide);
  const ceil = a.group.getObjectByName('BoxArenaCeiling');
  assert.ok(ceil && ceil.isMesh);
  const cb = new THREE.Box3().setFromObject(ceil);
  assert.ok(Math.abs(cb.min.y - CEIL) < 1e-6 && Math.abs(cb.max.y - CEIL) < 1e-6);
  const cn = ceil.geometry.getAttribute('normal');
  assert.ok(cn.getY(0) < -0.99, 'ceiling faces down');
  assert.ok(a.group.getObjectByName('BoxArenaLights'));
  assert.equal(a.group.getObjectByName('BoxArenaRings'), undefined, 'void decor removed');
  a.update(0.5);
  a.update(0);
  let disposed = 0;
  a.group.traverse((o) => o.geometry && o.geometry.addEventListener('dispose', () => disposed++));
  a.dispose();
  a.dispose();
  assert.ok(disposed > 0);
  assert.equal(a.group.children.length, 0);
});

test('the middle wall blocks players and shots, and nobody can build on the midline while it is down', () => {
  const { world, st, mid } = setup();
  const hx = (rect.maxX - rect.minX) / 2;
  const midZ = mid.z;
  const divider = world.addBox({ kind: 'arena', mat: 'metal', hp: 1e9, cx: mid.x, cz: midZ, hx: hx + 1, hz: 0.25, y0: FLOOR - 1, y1: CEIL + 1 });
  // a player walking into it from the north side stays north of it
  const pos = { x: mid.x, y: FLOOR, z: midZ - 0.3 };
  world.resolveCircle(pos, R, H, STEP);
  assert.ok(pos.z <= midZ - 0.25 - R + 1e-6, `pushed back to the north side: ${pos.z}`);
  // a shot across the arena at chest height stops at the wall
  const hit = world.raycast(mid.x, FLOOR + 1.4, rect.minZ + 2, 0, 0, 1, 40);
  assert.ok(hit && hit.t < midZ - (rect.minZ + 2) + 0.01, 'the ray hits the middle wall');
  // no builds on the midline while it is down; building elsewhere is unaffected
  st.buildArea = buildArea;
  const block = { minX: rect.minX - 1, maxX: rect.maxX + 1, minZ: midZ - 0.6, maxZ: midZ + 0.6 };
  st.buildBlock = block;
  assert.equal(st.fits({ kind: 'wall', x: rect.minX + 2, y: FLOOR, z: midZ, rot: 0 }), false, 'midline wall refused');
  assert.equal(st.fits({ kind: 'wall', x: rect.minX + 2, y: FLOOR, z: midZ - 4, rot: 0 }), true, 'own side fine');
  // lifted: the wall is gone and the midline opens up
  world.remove(divider);
  st.buildBlock = null;
  assert.equal(st.fits({ kind: 'wall', x: rect.minX + 2, y: FLOOR, z: midZ, rot: 0 }), true, 'midline wall allowed after the lift');
  const pos2 = { x: mid.x, y: FLOOR, z: midZ - 0.3 };
  world.resolveCircle(pos2, R, H, STEP);
  assert.ok(Math.abs(pos2.z - (midZ - 0.3)) < 1e-6, 'nothing in the way once lifted');
});

test('the middle wall mesh is down at round start and slides up into the ceiling at FIGHT', async () => {
  const { buildArenaMeshes } = await import('../src/render/BoxArena.js');
  const a = buildArenaMeshes({ rect, floorY: FLOOR, ceilY: CEIL });
  const d = a.group.getObjectByName('BoxArenaDivider');
  assert.ok(d && d.isMesh, 'divider mesh exists');
  assert.equal(d.castShadow, false);
  assert.equal(d.material.transparent, false, 'solid: hides the other side');
  const box = new THREE.Box3().setFromObject(d);
  assert.ok(box.min.x <= rect.minX + 0.05 && box.max.x >= rect.maxX - 0.05, 'spans the width');
  assert.ok(box.min.y <= FLOOR + 1e-6 && box.max.y >= CEIL - 1e-6, 'floor to ceiling');
  a.setDivider(true);
  assert.equal(d.visible, true);
  assert.equal(a.dividerUp, true);
  // FIGHT: it rises (still visible mid-lift), then is gone
  a.setDivider(false, { animate: true });
  a.update(0.15);
  assert.equal(d.visible, true);
  assert.ok(d.position.y > 0, 'moving up');
  a.update(1);
  assert.equal(d.visible, false);
  assert.equal(a.dividerUp, false);
  // next round: back down at once
  a.setDivider(true);
  assert.equal(d.visible, true);
  assert.equal(d.position.y, 0);
  // no animation: gone straight away
  a.setDivider(false);
  assert.equal(d.visible, false);
  a.dispose();
});

test('nothing is planned through the middle wall into the other half while it is down', () => {
  const { world, st, mid } = setup();
  const hx = (rect.maxX - rect.minX) / 2;
  const midZ = mid.z; // a cell edge (N even)
  st.buildArea = buildArea;
  const divider = world.addBox({ kind: 'arena', mat: 'metal', hp: 1e9, cx: mid.x, cz: midZ, hx: hx + 1, hz: 0.25, y0: FLOOR - 1, y1: CEIL + 1 });
  // standing on the north side right at the wall, facing south (heading PI) into it
  for (const off of [0.3, 0.8, 1.6, 2.5]) {
    const pos = { x: rect.minX + 6, y: FLOOR, z: midZ - off };
    for (const kind of ['ramp', 'floor', 'cone']) {
      const pl = st.plan(kind, pos, Math.PI, 0, {});
      assert.ok(pl.z < midZ, `${kind} from ${off} m: planned at z ${pl.z}, beyond the wall at ${midZ}`);
    }
  }
  // lifted: the cell across the line is fair game again
  world.remove(divider);
  const pl = st.plan('ramp', { x: rect.minX + 6, y: FLOOR, z: midZ - 0.8 }, Math.PI, 0, {});
  assert.ok(pl.z > midZ, 'after the lift the ramp goes in the cell ahead');
});

test('high up near the ceiling, building ahead is not blocked by the ceiling slab', () => {
  const { st } = setup();
  st.buildArea = buildArea;
  // on the second storey (feet at 303), body band 303.3..304.7 is under the 306 ceiling; at the very
  // top of a ramp (feet ~305) the band reaches into the ceiling slab, which must not count as a wall
  for (const y of [FLOOR + 3, FLOOR + 4.9]) {
    const pl = st.plan('floor', { x: rect.minX + 6, y, z: rect.minZ + 9 }, Math.PI, 0, {});
    assert.ok(pl.z > rect.minZ + 9, `feet ${y}: planned ahead (z ${pl.z})`);
  }
});
