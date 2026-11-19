// Arend Arts Center (BHS south building hero): the raked house rows are climbable, the stage is
// 1.0-1.1 m up and reachable by its side stairs, the balcony is reachable (side stair and upper
// lobby), the seat count, everything inside the hero rects, loot on surfaces, budgets, determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { AREND_LOBBY, AREND_HOUSE, AREND_STAGE } from '../src/world/bhs/south.js';
import { STAGE_Y, Y_REAR, Y_BAL_REAR, ZC, aisleZ, BAL_STAIR, BAL_DOOR_Z, ROWS, FX, HOUSE_IN, R_REAR } from '../src/world/bhs/interior/arend/layout.js';
import { PLAYER } from '../src/core/config.js';

const mapData = JSON.parse(readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url)));
const STEP = 0.62;

function build() {
  const world = new World(mapData);
  const bhs = createBhs(world, mapData);
  return { world, K: bhs.kit, info: bhs.kit.arendInfo };
}
const { world, K, info } = build();

/** Walk a body (PLAYER radius / height) through waypoints in small steps like Player does. */
function walk(pts, y0 = 0, step = 0.05) {
  const pos = { x: pts[0][0], y: y0, z: pts[0][1] };
  let minY = pos.y;
  for (let k = 1; k < pts.length; k++) {
    const [tx, tz] = pts[k];
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
    for (let i = 1; i <= n; i++) {
      const ox = pos.x;
      const oz = pos.z;
      pos.x += dx / n;
      pos.z += dz / n;
      const cap = world.builtAbove(ox, oz, pos.y);
      world.resolveCircle(pos, PLAYER.radius, PLAYER.height);
      pos.y = world.groundHeight(pos.x, pos.z, pos.y, STEP, cap);
      minY = Math.min(minY, pos.y);
    }
  }
  return { ...pos, minY };
}
const near = (p, x, z, tol = 0.6) => Math.hypot(p.x - x, p.z - z) < tol;

test('the Arend builder ran and stays within its budgets', () => {
  assert.ok(info, 'K.arendInfo set by buildArend');
  const parts = info.parts[1] - info.parts[0];
  const decors = info.decors[1] - info.decors[0];
  assert.ok(parts > 300 && parts < 1500, `colliders ${parts}`);
  assert.ok(decors > 3000 && decors < 35000, `decor pieces ${decors}`);
});

test('one big house: at least 900 seats, with a balcony section', () => {
  assert.ok(info.seats >= 900, `seats ${info.seats}`);
  assert.ok(info.balconySeats >= 250, `balcony seats ${info.balconySeats}`);
  assert.ok(info.mainSeats >= 650, `main-floor seats ${info.mainSeats}`);
});

test('house rows are climbable from the front cross-aisle to the rear cross-aisle (both side aisles)', () => {
  for (const side of [-1, 1]) {
    const p = walk([[71.5, aisleZ(71.5, side)], [45.6, aisleZ(45.6, side)]]);
    assert.ok(near(p, 45.6, aisleZ(45.6, side)), `side ${side}: blocked at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
    assert.ok(Math.abs(p.y - Y_REAR) < 0.05, `side ${side}: rear at y ${p.y}`);
  }
  // every riser on the way is a step (the walk above would stall otherwise); the rake really rises
  assert.ok(Y_REAR > 2 && Y_REAR < 3.2, `rake height ${Y_REAR}`);
});

test('the raked floor has no holes (every point of the rows stands on its row)', () => {
  let bad = 0;
  let first = '';
  for (let x = HOUSE_IN.x0 + 5; x < ROWS.FRONT_X - 0.6; x += 0.23)
    for (let z = HOUSE_IN.z0 + 0.5; z < HOUSE_IN.z1 - 0.5; z += 0.23) {
      const r = Math.hypot(FX - x, z - ZC);
      if (r < ROWS.R0 + 0.1 || r > R_REAR - 0.1) continue;
      const i = Math.floor((r - ROWS.R0) / ROWS.D);
      const want = ROWS.RISE * (i + 1);
      const y = world.groundHeight(x, z, want, STEP, want + 0.4);
      if (y < want - ROWS.RISE - 0.01) {
        bad++;
        if (!first) first = `${x.toFixed(2)}, ${z.toFixed(2)}: ${y} (row ${i} at ${want.toFixed(2)})`;
      }
    }
  assert.equal(bad, 0, `holes in the rake, first at ${first}`);
});

test('the ground-floor doors lead up the door wells to the rear cross-aisle', () => {
  for (const z of [302.5, 311, 326.5]) {
    const p = walk([[37, z], [46, z]]);
    assert.ok(near(p, 46, z) && Math.abs(p.y - Y_REAR) < 0.05, `door at z ${z}: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
  }
  const s = walk([[46, 338], [46, 330]]);
  assert.ok(near(s, 46, 330) && Math.abs(s.y - Y_REAR) < 0.05, `south door: ${s.z.toFixed(2)}, ${s.y.toFixed(2)}`);
});

test('the stage is 1.0-1.1 m above the house floor and reachable by both side stairs', () => {
  const floor = world.groundHeight(72, ZC, 0.5);
  const deck = world.groundHeight(90, ZC, STAGE_Y + 0.1);
  assert.ok(deck - floor >= 1.0 && deck - floor <= 1.1, `stage ${deck} over floor ${floor}`);
  for (const z of [303.2, 323.8]) {
    const p = walk([[72, z], [80, z], [83, z], [83, ZC], [91, ZC]]);
    assert.ok(near(p, 91, ZC), `from the stair at z ${z}: stopped at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
    assert.ok(Math.abs(p.y - STAGE_Y) < 0.02, `on stage at y ${p.y}`);
  }
  // the proscenium is open (no wall left across it)
  assert.ok(world.clearLine(70, 4, ZC, 92, 4, ZC), 'clear sight line through the proscenium');
});

test('the balcony is reachable by the side stair and from the upper lobby', () => {
  const a = walk([[44, 309], [46.2, 304], [46.2, 299.5], [40.9, BAL_STAIR.z], [BAL_STAIR.x1 + 0.2, BAL_STAIR.z], [BAL_STAIR.x1 + 0.7, BAL_STAIR.z], [BAL_STAIR.x1 + 0.7, 299.5]], Y_REAR);
  assert.ok(near(a, BAL_STAIR.x1 + 0.7, 299.5) && a.y >= 5.3 - 1e-6, `side stair: ${a.x.toFixed(2)}, ${a.z.toFixed(2)}, y ${a.y.toFixed(2)}`);
  const b = walk([[33, 335], [34.8, 335.4], [34.8, 327], [38.5, 320], [38.5, BAL_DOOR_Z], [45.3, BAL_DOOR_Z], [44, 310]]);
  assert.ok(near(b, 44, 310) && Math.abs(b.y - Y_BAL_REAR) < 0.05, `upper lobby -> balcony: ${b.x.toFixed(2)}, ${b.z.toFixed(2)}, y ${b.y.toFixed(2)}`);
});

test('every Arend piece stays inside the lobby, house and stage rects', () => {
  const rects = [{ ...AREND_LOBBY, top: 8.8 }, AREND_HOUSE, AREND_STAGE];
  const tol = 0.06;
  // (kit stair stringers reach 0.35 m below the floor, out of sight)
  const inside = (x, z, y0, y1) => rects.some((r) => x >= r.x0 - tol && x <= r.x1 + tol && z >= r.z0 - tol && z <= r.z1 + tol && y0 >= -0.4 && y1 <= r.top + 0.5);
  const check = (b, what) => {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    for (const [u, v] of [[b.hx, b.hz], [b.hx, -b.hz], [-b.hx, b.hz], [-b.hx, -b.hz]]) {
      const x = b.cx + u * c - v * s;
      const z = b.cz + u * s + v * c;
      assert.ok(inside(x, z, b.y0, b.y1), `${what} corner ${x.toFixed(2)}, ${z.toFixed(2)} (y ${b.y0.toFixed(2)}..${b.y1.toFixed(2)}) outside`);
    }
  };
  for (let i = info.parts[0]; i < info.parts[1]; i++) check(K.parts[i], `part ${i} (${K.parts[i].role})`);
  for (let i = info.decors[0]; i < info.decors[1]; i++) check(K.decors[i], `decor ${i} (${K.decors[i].look})`);
});

test('Arend loot (4-6 spots) sits on surfaces: stage, booth, balcony and lobby', () => {
  const spots = K.lootSpots.slice(info.loot[0], info.loot[1]);
  assert.ok(spots.length >= 4 && spots.length <= 6, `loot spots ${spots.length}`);
  for (const l of spots) {
    const y = world.groundHeight(l.x, l.z, l.y + 0.05);
    assert.ok(Math.abs(y - l.y) < 0.03, `${l.kind} at ${l.x}, ${l.z}: y ${l.y} vs surface ${y}`);
  }
  assert.ok(spots.some((l) => l.kind === 'chest' && Math.abs(l.y - STAGE_Y) < 1e-6), 'a chest on the stage');
  assert.ok(spots.some((l) => Math.abs(l.y - Y_BAL_REAR) < 1e-6), 'loot on the balcony / in the booth');
});

test('the Arend build is deterministic', () => {
  const B = build();
  assert.deepEqual(B.info, info);
  const sig = (b) => [b.cx, b.cz, b.hx, b.hz, b.yaw, b.y0, b.y1, b.look, b.group].map((v) => (typeof v === 'number' ? v.toFixed(5) : v)).join(',');
  for (let i = info.parts[0]; i < info.parts[1]; i++) {
    assert.equal(sig(B.K.parts[i]), sig(K.parts[i]));
    assert.equal(B.K.parts[i].collider.id, K.parts[i].collider.id);
  }
  for (let i = info.decors[0]; i < info.decors[1]; i += 7) assert.equal(sig(B.K.decors[i]), sig(K.decors[i]));
});
