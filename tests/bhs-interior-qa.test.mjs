// Bentonville High interior QA (user, 2026-11-19): grass showing through the south building's ground
// floor, empty rooms, the commons stair not reaching the bridge, wall gaps / stray corridors.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { createBhs } from '../src/world/bhs/index.js';
import { ATRIUM, LANDING } from '../src/world/bhs/north.js';
import { SIZE } from '../src/world/bhs/kit/palette.js';

const mapData = () => JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
let cached = null;
function build() {
  if (cached) return cached;
  const data = mapData();
  const world = new World(data);
  cached = { world, bhs: createBhs(world, data) };
  return cached;
}

/** Walk from a to b in small steps, letting groundHeight lift / drop the feet (like the player). */
function walk(world, [x, y, z], [tx, tz], step = 0.2) {
  const n = Math.ceil(Math.hypot(tx - x, tz - z) / step);
  for (let i = 1; i <= n; i++) {
    const nx = x + ((tx - x) * i) / n;
    const nz = z + ((tz - z) * i) / n;
    const g = world.groundHeight(nx, nz, y + 0.45);
    if (!Number.isFinite(g)) return { x: nx, y, z: nz, stuck: true };
    if (g < y - 0.6) return { x: nx, y: g, z: nz, fell: true };
    y = g;
  }
  return { x: tx, y, z: tz };
}

const covers = (p, x, z) => {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const dx = x - p.cx;
  const dz = z - p.cz;
  return Math.abs(dx * c + dz * s) <= p.hx + 0.05 && Math.abs(-dx * s + dz * c) <= p.hz + 0.05; // 5 cm: float edges
};

test('the ground floor has a finish everywhere inside both buildings (no grass indoors)', () => {
  const { bhs } = build();
  const K = bhs.kit;
  const floors = [...K.parts, ...K.decors].filter((p) => p.y1 > 0.005 && p.y1 < 0.6 && (!p.faces || p.faces.top !== 'none'));
  const solids = K.parts.filter((p) => p.y0 < 0.3 && p.y1 > 0.5);
  for (const plan of [bhs.south, bhs.north]) {
    const bare = [];
    for (let x = -120; x < 120; x += 1.3)
      for (let z = 150; z < 440; z += 1.3) {
        if (!plan.inside(x, z)) continue;
        if (!floors.some((p) => covers(p, x, z)) && !solids.some((p) => covers(p, x, z))) bare.push([x.toFixed(1), z.toFixed(1)]);
      }
    assert.deepEqual(bare, [], `${plan.name}: bare ground at ${bare.slice(0, 5).join(' ')}`);
  }
});

test('the commons feature stair lands on a landing that meets the 2nd-floor walkway', () => {
  const { world } = build();
  const H = SIZE.storey;
  // up the flight from the commons floor ...
  const top = walk(world, [LANDING.cx, 0, 231], [LANDING.cx, (LANDING.z0 + LANDING.z1) / 2]);
  assert.ok(!top.stuck && !top.fell, `climbed the flight (${JSON.stringify(top)})`);
  assert.ok(Math.abs(top.y - H) < 0.1, `top of the flight at the 2nd floor (got ${top.y})`);
  // ... then east across the landing onto the walkway
  const on = walk(world, [top.x, top.y, top.z], [ATRIUM.x1 + 2.5, top.z]);
  assert.ok(!on.stuck && !on.fell, `crossed onto the walkway (${JSON.stringify(on)})`);
  assert.ok(Math.abs(on.y - H) < 0.1, `on the walkway (got ${on.y})`);
});

test('no room or corridor rect overlaps another on the same level (no stray corridors)', () => {
  const { bhs } = build();
  for (const plan of [bhs.south, bhs.north]) {
    const rs = plan.rooms;
    const span = (r, L) => r.level <= L && L < r.level + (r.tall || 1);
    for (let i = 0; i < rs.length; i++)
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        if (a.kind === 'atrium' || b.kind === 'atrium') continue; // open-over rects above tall rooms
        if (a.kind === 'corridor' && b.kind === 'corridor') continue; // hallway junctions
        const L = Math.max(a.level, b.level);
        if (!span(a, L) || !span(b, L)) continue;
        const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
        assert.ok(!(ox > 0.3 && oz > 0.3), `${plan.name}: ${a.id} overlaps ${b.id} (${ox.toFixed(1)} x ${oz.toFixed(1)} m)`);
      }
  }
});

test('every enclosed room is furnished (no empty rooms)', () => {
  const { bhs } = build();
  const K = bhs.kit;
  const props = K.parts.filter((p) => p.role === 'prop' || p.role === 'locker');
  const skip = new Set(['corridor', 'stair', 'atrium', 'restroom', 'chase']);
  for (const plan of [bhs.south, bhs.north]) {
    for (const r of plan.rooms) {
      if (skip.has(r.kind) || r.hero || r.kind === 'commons' || r.kind === 'cafeteria') continue;
      const y = plan.levelY(r.level);
      const n = props.filter((p) => p.cx > r.x0 && p.cx < r.x1 && p.cz > r.z0 && p.cz < r.z1 && p.y0 > y - 0.1 && p.y0 < y + 2).length;
      assert.ok(n >= 2, `${plan.name}: ${r.id} (${r.label}) has ${n} furniture pieces`);
    }
  }
});
