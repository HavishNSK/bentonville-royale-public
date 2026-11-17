// Map-wide stair collision/navigation regression. No browser or network required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { World } from '../src/world/World.js';
import { Bots } from '../src/game/Bots.js';

const data = JSON.parse(fs.readFileSync(new URL('../public/data/bentonville-osm.json', import.meta.url), 'utf8'));
const w = new World(data);
for (const a of data.areas) w.addArea(a.p, a.k);
for (const r of data.roads) for (let i = 0; i + 1 < r.p.length; i++) w.addRoadSegment(...r.p[i], ...r.p[i + 1], r.w, r.k);
for (const bd of data.buildings) w.addBuilding(bd);
w.finishBuildings();
const bots = new Bots({ world: w, kits: [] });
let buildings = 0, flights = 0, botTrips = 0;
for (const { collider: c } of w.buildingInteriors()) {
  const plan = c.shell.plan;
  if (!plan.stairs.length) continue;
  buildings++;
  for (const L of plan.levels.slice(1)) assert.ok(plan.lootSpots.some(s => s.level === L.i), `${c.ref.id}: upper floor needs loot`);
  for (const pn of plan.panels) assert.ok(pn.y1 > pn.y0, `${c.ref.id}: no zero-height panels`);
  for (const s of plan.stairs) {
    flights++;
    const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0), ux = (s.x1 - s.x0) / len, uz = (s.z1 - s.z0) / len;
    for (const direction of [1, -1]) {
      let y = direction > 0 ? s.y0 : s.y1;
      for (let k = 0; k <= 60; k++) {
        const t = direction > 0 ? k / 60 : 1 - k / 60;
        const pos = { x: s.x0 + (s.x1 - s.x0) * t, y, z: s.z0 + (s.z1 - s.z0) * t }, before = { ...pos };
        w.resolveCircle(pos, 0.42, 1.8);
        assert.ok(Math.hypot(pos.x - before.x, pos.z - before.z) < 0.02, `${c.ref.id}: partition blocks stairs ${s.level}`);
        y = w.groundHeight(pos.x, pos.z, y, 0.5);
        assert.ok(Math.abs(y - (s.y0 + (s.y1 - s.y0) * t)) < 0.08, `${c.ref.id}: stair surface gap`);
        assert.ok(w.ceilingAbove(pos.x, pos.z, y) >= y + 1.8, `${c.ref.id}: stair headroom`);
      }
      const low = { x: s.x0 - ux, y: s.y0, z: s.z0 - uz }, high = { x: s.x1 + ux, y: s.y1, z: s.z1 + uz };
      const start = direction > 0 ? low : high, target = direction > 0 ? high : low;
      bots.spawn(1, () => 0.5, { dropPoints: [start] });
      const b = bots.brains[0], a = b.actor;
      a.pos.set(start.x, start.y, start.z); a.gliding = false; a.grounded = true; b.state = 'wander'; b.inB = c;
      b.pathN = bots._roomRoute(c, a.pos.x, a.pos.z, a.pos.y, target.x, target.z, target.y, b.path, b.pathK, 0);
      b.pathI = 0;
      for (let step = 0; step < 2400 && b.pathI < b.pathN; step++) {
        const x = b.path[b.pathI * 2], z = b.path[b.pathI * 2 + 1];
        if (Math.hypot(a.pos.x - x, a.pos.z - z) < 0.16) { b.pathI++; continue; }
        bots.time += 0.025; bots._steer(b, x, z, 3, 0); bots._move(b, 0.025);
      }
      assert.ok(b.pathN > 0 && b.pathI === b.pathN && Math.abs(a.pos.y - target.y) < 0.2,
        `${c.ref.id}: bot stair trip ${s.level} direction ${direction} failed at ${b.pathI}/${b.pathN}`);
      botTrips++;
    }
  }
}
assert.ok(buildings > 0 && flights > 0);
console.log(JSON.stringify({ buildings, flights, botTrips, interiorHash: w.interiorHash }));
