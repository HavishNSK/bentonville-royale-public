// Solid interior furniture (plan.levels[i].props / propBlock, see the interior contract):
// movement push, step-over, standing on top, ray blocking and placement checks in World.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';

const data = { meta: { bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 } }, buildings: [], roads: [], areas: [], pois: [] };
const R = 0.42; // player radius
const H = 1.8; // player height

/** A 3-storey building; its furniture colliders replaced by `props(levels)` (or removed). */
function fixture(props = null) {
  const w = new World(data);
  w.addBuilding({ id: 123456, t: 'apartments', mat: 'brick', lv: 3, h: 11, p: [[0, 0], [25, 0], [25, 20], [0, 20]] });
  w.finishBuildings();
  const c = w.buildingInteriors()[0].collider;
  const p = c.shell.plan;
  for (const L of p.levels) {
    delete L.props;
    delete L.propBlock;
  }
  // a ground-floor spot with room around it (clear of partitions)
  const spot = p.lootSpots.find((s) => s.level === 0 && !w._wallsNear(c, s.x, s.z, 1.6)) || p.lootSpots.find((s) => s.level === 0);
  if (props) props(p.levels, spot);
  return { w, c, p, x: spot.x, z: spot.z, y: p.levels[0].y };
}

/** Capsule along x through (x, z): half-length 0.4 + r, radius r, solid y0..y1. */
function cap(x, z, r, y0, y1) {
  return [x - 0.4, z, x + 0.4, z, r, y0, y1];
}

function put(L, caps, block) {
  L.props = new Float32Array(caps.flat());
  if (block) L.propBlock = new Uint8Array(block);
}

test('a solid prop pushes a player circle out of its capsule', () => {
  const { w, x, z, y } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 0.92)], [1]));
  const pos = { x, y, z: z + 0.5 };
  assert.ok(w.resolveCircle(pos, R, H), 'touched');
  assert.ok(Math.abs(pos.z - z - (0.4 + R)) < 0.02, `pushed to the capsule edge: ${pos.z - z}`);
  assert.ok(Math.abs(pos.x - x) < 0.02, 'pushed straight out');
  assert.ok(w.pushZ > 0, 'push direction recorded');
});

test('a prop lower than the step height is stepped over and stood on', () => {
  const { w, x, z, y } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 0.5)], [0]));
  const pos = { x, y, z: z + 0.5 };
  w.resolveCircle(pos, R, H);
  assert.ok(Math.abs(pos.z - (z + 0.5)) < 1e-6, 'not pushed');
  assert.ok(Math.abs(w.groundHeight(x, z, y) - (y + 0.5)) < 1e-4, 'lifted onto the low prop');
  assert.equal(w.surface, 'floor');
});

test('a tall prop holds from the floor but carries a player who jumped onto it', () => {
  const { w, x, z, y } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 0.92)]));
  assert.ok(Math.abs(w.groundHeight(x, z, y) - y) < 1e-4, 'too tall to step onto from the floor');
  const top = y + 0.92;
  assert.ok(Math.abs(w.groundHeight(x, z, top - 0.3) - top) < 1e-4, 'lands on the top mid-jump');
  const pos = { x, y: top, z: z + 0.1 };
  w.resolveCircle(pos, R, H);
  assert.ok(Math.abs(pos.z - (z + 0.1)) < 1e-6, 'standing on top is not pushed off');
  assert.ok(w.ceilingAbove(x, z, top) >= top + H, 'a prop is never a ceiling');
});

test('a block=1 prop stops a ray with the facing normal and no breakable panel', () => {
  const { w, x, z, y, c } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 1.2)], [1]));
  const hit = w.raycast(x, y + 0.7, z + 1.5, 0, 0, -1, 3, null);
  assert.ok(hit, 'blocked');
  assert.ok(Math.abs(hit.t - (1.5 - 0.4)) < 1e-3, `hits the near face: ${hit.t}`);
  assert.ok(Math.abs(hit.nz - 1) < 1e-6 && Math.abs(hit.nx) < 1e-6 && hit.ny === 0, 'normal faces the shooter');
  assert.equal(hit.collider, c);
  assert.equal(hit.kind, c.kind);
  assert.equal(hit.panel, null);
  assert.equal(hit.edge, -1);
  assert.equal(w.panelHit(hit), null, 'never a breakable panel');
  // along the spine: the end face (spine extended by r)
  const end = w.raycast(x - 1.2, y + 0.7, z, 1, 0, 0, 4, null);
  assert.ok(end && Math.abs(end.t - (1.2 - 0.8)) < 1e-3 && Math.abs(end.nx + 1) < 1e-6, `end face: ${end && end.t}`);
  // over the top: passes; shot down onto it: the top face
  assert.equal(w.raycast(x, y + 1.5, z + 1.5, 0, 0, -1, 3, null), null, 'over the top passes');
  const down = w.raycast(x, y + 2, z + 0.1, 0.001, -1, 0, 3, null);
  assert.ok(down && Math.abs(down.y - (y + 1.2)) < 1e-3 && down.ny === 1, 'top face from above');
  assert.equal(w.clearLine(x, y + 0.7, z + 1.5, x, y + 0.7, z - 1.5), false, 'blocks sight');
});

test('a block=0 prop lets rays through but still blocks movement', () => {
  const { w, x, z, y } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 0.8)], [0]));
  assert.equal(w.raycast(x, y + 0.5, z + 1.5, 0, 0, -1, 3, null), null);
  assert.equal(w.clearLine(x, y + 0.5, z + 1.5, x, y + 0.5, z - 1.5), true);
  const pos = { x, y, z: z + 0.5 };
  assert.ok(w.resolveCircle(pos, R, H));
  assert.ok(pos.z - z > 0.8, 'pushed out');
});

test('props on another level are ignored', () => {
  const { w, x, z, y, c } = fixture((levels, s) => {
    const L = levels[1];
    put(L, [cap(s.x, s.z, 0.4, L.y, L.y + 0.92)], [1]);
  });
  const pos = { x, y, z: z + 0.5 };
  assert.equal(w.resolveCircle(pos, R, H), false, 'upstairs prop does not push the ground storey');
  assert.equal(pos.z, z + 0.5);
  assert.equal(w.raycast(x, y + 0.7, z + 1.5, 0, 0, -1, 3, null), null, 'ground-storey ray passes');
  assert.ok(Math.abs(w.groundHeight(x, z, y) - y) < 1e-4);
  assert.equal(w._wallsNear(c, x, z, 0.3), false, 'ground storey clear');
});

test('placement checks (spawn / loot / build) avoid props on the storey', () => {
  const { w, c, x, z, p } = fixture((levels, s) => put(levels[0], [cap(s.x, s.z, 0.4, levels[0].y, levels[0].y + 0.92)], [0]));
  assert.equal(w._wallsNear(c, x, z, 0.3), true);
  assert.equal(w.blockedAt(x, z, 0.3, true), true);
  assert.equal(w.interiorAt(x, z), null, 'inside a prop is not open interior floor');
  assert.equal(w._wallsNear(c, x, z + 2, 0.3), false, 'clear beside it');
  assert.equal(w._wallsNear(c, x, z, 0.3, p.levels[0].y + 0.92), false, 'standing on top of it');
});

test('plans without props behave as before', () => {
  const a = fixture();
  const b = fixture((levels) => {
    for (const L of levels) L.props = new Float32Array(0);
  });
  for (const f of [a, b]) {
    const pos = { x: f.x, y: f.y, z: f.z + 0.5 };
    assert.equal(f.w.resolveCircle(pos, R, H), false);
    assert.equal(f.w.raycast(f.x, f.y + 0.7, f.z + 1.5, 0, 0, -1, 3, null), null);
    assert.equal(f.w.groundHeight(f.x, f.z, f.y), f.y);
    assert.equal(f.w._wallsNear(f.c, f.x, f.z, 0.3), false);
  }
  // full-plan sweep: rays and pushes agree between a plan without props and with empty props
  for (let i = 0; i < 40; i++) {
    const x = 1 + (i * 0.61) % 23;
    const z = 1 + (i * 0.37) % 18;
    const ha = a.w.raycast(x, 1, z, 0.6, -0.05, 0.8, 30, null);
    const ta = ha ? ha.t : -1;
    const hb = b.w.raycast(x, 1, z, 0.6, -0.05, 0.8, 30, null);
    assert.equal(ta, hb ? hb.t : -1);
    const pa = { x, y: 0, z };
    const pb = { x, y: 0, z };
    a.w.resolveCircle(pa, R, H);
    b.w.resolveCircle(pb, R, H);
    assert.deepEqual(pa, pb);
  }
});
