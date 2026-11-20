// Box Fights multiplayer round start: the host's spawn boxes (Game._boxSpawnBoxes) replicated to a
// guest through Structures.exportNet -> importNet must land exactly where the host has them, and
// nobody may start inside a box piece (owner bug: "a plank on the floor I'm stuck inside").
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World.js';
import { Structures } from '../src/game/Structures.js';
import { PLAYER } from '../src/core/config.js';
import { arenaLayout, spawnLayout, ffaSpawnLayout, spawnBoxPieces } from '../src/game/BoxFights.js';

function arena(L) {
  const world = new World({ meta: { bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 } }, buildings: [], roads: [], areas: [], pois: [] });
  for (const c of L.colliders) world.addBox({ ...c });
  const structures = new Structures({ scene: new THREE.Scene(), world });
  structures.buildArea = { ...L.buildArea };
  return { world, structures };
}

function hostBoxes(st, spawns, floorY) {
  for (const sp of spawns) for (const pc of spawnBoxPieces(sp, floorY)) st.placeBuilt({ ...pc, valid: true }, 'wood', null);
}

const shape = (p) => ({
  kind: p.kind, key: p.key, x: p.x, y: p.y, z: p.z, rot: +p.rot.toFixed(2), edit: p.edit | 0,
  minX: +p.minX.toFixed(3), maxX: +p.maxX.toFixed(3), minZ: +p.minZ.toFixed(3), maxZ: +p.maxZ.toFixed(3),
  y0: +p.y0.toFixed(3), y1: +p.y1.toFixed(3), segs: JSON.stringify(p.segs), seg: JSON.stringify(p.seg && p.seg.map((v) => +v.toFixed(3))),
});

const cases = [
  ...[1, 2, 3].map((n) => ({ name: `${n}v${n}`, L: arenaLayout(n), spawns: spawnLayout(arenaLayout(n), n) })),
  ...[2, 6].map((n) => ({ name: `ffa ${n}`, L: arenaLayout('ffa'), spawns: ffaSpawnLayout(arenaLayout('ffa'), n) })),
];

function stuck(world, sp) {
  const pos = new THREE.Vector3(sp.x, sp.y, sp.z);
  world.resolveCircle(pos, PLAYER.radius, PLAYER.height || 1.8);
  return Math.hypot(pos.x - sp.x, pos.z - sp.z);
}

for (const c of cases) {
  test(`box spawn net ${c.name}: guest pieces match host, nobody starts inside a piece`, () => {
    const host = arena(c.L);
    hostBoxes(host.structures, c.spawns, c.L.floorY);
    const rows = host.structures.exportNet();
    assert.equal(rows.length, c.spawns.length * 5);
    // a round-trip through JSON, as the wire does
    const guest = arena(c.L);
    guest.structures.importNet(JSON.parse(JSON.stringify(rows)));
    const hs = host.structures.pieces.map(shape).sort((a, b) => a.key.localeCompare(b.key));
    const gs = guest.structures.pieces.map(shape).sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(gs, hs);
    for (const { world } of [host, guest]) {
      for (const sp of c.spawns) {
        assert.ok(stuck(world, sp) < 1e-6, `spawn ${sp.side}/${sp.slot} pushed out of a collider`);
        assert.equal(world.groundHeight(sp.x, sp.z, sp.y + 0.3), c.L.floorY, 'feet on the arena floor');
      }
    }
  });
}

// The rendered instance must be the finished piece: placeBuilt used to set age = 99 only after
// place() had written the instance matrix at age 0 (the build-up pop: y squashed to 4 %), and a
// finished piece is never rewritten, so every spawn-box wall showed as a flat plank on the floor
// (and its full-height collider felt like being stuck inside it).
function instanceScales(st, p) {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  return p._inst.map((e) => {
    e.b.mesh.getMatrixAt(e.i, m);
    m.decompose(pos, q, s);
    return { y: +s.y.toFixed(3), xz: +s.x.toFixed(3), py: +pos.y.toFixed(3) };
  });
}

test('placeBuilt / importNet pieces render full size (host and guest)', () => {
  const L = arenaLayout(2);
  const spawns = spawnLayout(L, 2);
  const host = arena(L);
  hostBoxes(host.structures, spawns, L.floorY);
  const guest = arena(L);
  guest.structures.importNet(host.structures.exportNet());
  for (const st of [host.structures, guest.structures]) {
    assert.equal(st.pieces.length, 20);
    for (const p of st.pieces) {
      for (const sc of instanceScales(st, p)) {
        assert.equal(sc.y, 1, `${p.kind} ${p.key} instance squashed (y scale ${sc.y})`);
        assert.equal(sc.xz, 1);
        assert.equal(sc.py, p.y);
      }
    }
  }
});

test('round 2 on a guest: last round\'s pieces in the box slots become the host\'s fresh wood box', () => {
  const L = arenaLayout(1);
  const spawns = spawnLayout(L, 1);
  const host = arena(L);
  hostBoxes(host.structures, spawns, L.floorY);
  const guest = arena(L);
  // round 1 leftovers: a brick wall built into one box slot, a shot-up wall in another
  const [a, b] = spawnBoxPieces(spawns[0], L.floorY);
  guest.structures.placeBuilt({ ...a, valid: true }, 'brick', null);
  const hurt = guest.structures.placeBuilt({ ...b, valid: true }, 'wood', null);
  guest.structures.damage ? guest.structures.damage(hurt, 60) : (hurt.taken = 60, hurt.hp -= 60);
  guest.structures.importNet(host.structures.exportNet());
  for (const p of guest.structures.pieces) {
    assert.equal(p.mat, 'wood', `${p.key} material`);
    assert.equal(p.hp, p.maxHp);
    assert.equal(p.taken, 0, `${p.key} still shows last round's damage`);
  }
});
