// Node assertions for building interiors (no browser, no three.js):
//   node scripts/check-interiors.mjs [--verbose]
// Builds the World from public/data/bentonville-osm.json the way WorldMeshes does (areas,
// roads, buildings, finishBuildings) and checks every interior plan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World, pointInPoly } from '../src/world/World.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verbose = process.argv.includes('--verbose');
const data = JSON.parse(fs.readFileSync(path.join(root, 'public/data/bentonville-osm.json'), 'utf8'));
const R = 0.42; // PLAYER.radius
const STEP = 0.5;

function build() {
  const w = new World(data);
  for (const a of data.areas) w.addArea(a.p, a.k);
  for (const r of data.roads) for (let i = 0; i + 1 < r.p.length; i++) w.addRoadSegment(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w, r.k);
  for (const bd of data.buildings) if (bd.p && bd.p.length >= 3) w.addBuilding(bd);
  w.finishBuildings();
  return w;
}

const fails = [];
const fail = (msg) => fails.push(msg);

const t0 = Date.now();
const world = build();
const ms = Date.now() - t0;
const world2 = build();

// 1. every hollow building has a plan
const shells = world.buildingInteriors().map((b) => b.collider);
let rooms = 0;
let walls = 0;
let idoors = 0;
let panels = 0;
let outerPanels = 0;
const recipes = {};
for (const c of shells) {
  const s = c.shell;
  const id = c.ref.id;
  if (!s.plan) {
    fail(`building ${id}: no interior plan`);
    continue;
  }
  const plan = s.plan;
  recipes[plan.recipe] = (recipes[plan.recipe] || 0) + 1;
  const L = plan.levels[0];
  rooms += L.rooms.length;
  walls += L.walls.length / 7;
  idoors += L.doors.length;
  panels += plan.panels.length;
  outerPanels += plan.panels.filter((p) => p.kind === 'outer').length;
  if (!L.rooms.length) fail(`building ${id}: no rooms`);
  for (const p of plan.panels) {
    if (p.kind === 'outer' && (p.f1 - p.f0) * 1 < 0) fail(`building ${id}: bad panel ${p.id}`);
    if (p.kind === 'inner' && Math.hypot(p.bx - p.ax, p.bz - p.az) > 4.01) fail(`building ${id}: inner panel ${p.id} wider than 4 m`);
  }

  // 2. flood fill (0.5 m, 8-neighbour) from the exterior doors against blockedAt(..., true)
  const x0 = c.minX - 1;
  const z0 = c.minZ - 1;
  const nx = Math.ceil((c.maxX - x0 + 1) / STEP) + 1;
  const nz = Math.ceil((c.maxZ - z0 + 1) / STEP) + 1;
  const free = new Int8Array(nx * nz).fill(-1); // -1 unknown, 0 blocked, 1 free
  const isFree = (i, j) => {
    const k = j * nx + i;
    if (free[k] < 0) {
      const x = x0 + i * STEP;
      const z = z0 + j * STEP;
      free[k] = pointInPoly(c.p, c.n, x, z) && !world.blockedAt(x, z, R, true) ? 1 : 0;
    }
    return free[k] === 1;
  };
  const seen = new Uint8Array(nx * nz);
  const queue = [];
  const cellOf = (x, z) => [Math.round((x - x0) / STEP), Math.round((z - z0) / STEP)];
  for (const d of s.doors) {
    // no partition blocks the doorway: the strip just inside the opening is clear
    for (const depth of [s.t + 0.5, s.t + 0.9, s.t + 1.3]) {
      for (const along of [-0.35, 0, 0.35]) {
        const x = d.x - d.nx * depth + -d.nz * along;
        const z = d.z - d.nz * depth + d.nx * along;
        if (world._wallsNear(c, x, z, R)) fail(`building ${id}: a partition blocks exterior door at (${d.x.toFixed(1)}, ${d.z.toFixed(1)})`);
      }
    }
    // seed: cells just inside the door
    for (const depth of [s.t + 0.6, s.t + 0.9, s.t + 1.2]) {
      const [i, j] = cellOf(d.x - d.nx * depth, d.z - d.nz * depth);
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
          const k = jj * nx + ii;
          if (!seen[k] && isFree(ii, jj)) {
            seen[k] = 1;
            queue.push(k);
          }
        }
    }
  }
  if (!queue.length) fail(`building ${id}: no free cell inside any exterior door`);
  for (let qi = 0; qi < queue.length; qi++) {
    const k = queue[qi];
    const i = k % nx;
    const j = (k / nx) | 0;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const kk = jj * nx + ii;
        if (seen[kk] || !isFree(ii, jj)) continue;
        seen[kk] = 1;
        queue.push(kk);
      }
  }
  for (const r of L.rooms) {
    // the room is reached when a reached cell lies within 0.75 m of its centre point
    const [ci, cj] = cellOf(r.cx, r.cz);
    let ok = false;
    for (let di = -1; di <= 1 && !ok; di++) for (let dj = -1; dj <= 1 && !ok; dj++) ok = !!seen[(cj + dj) * nx + ci + di];
    if (!ok) fail(`building ${id} (${plan.recipe}): room ${r.id} ${r.kind} "${r.label}" (${r.area} m2) unreachable from the exterior doors`);
    if (!world._onInteriorFloor(c, r.cx, r.cz, R)) fail(`building ${id}: room ${r.id} centre is not open interior floor`);
    if (world.interiorAt(r.cx, r.cz) !== c) fail(`building ${id}: interiorAt(room ${r.id} centre) is not this building`);
  }
  if (verbose) console.log(id, plan.recipe, 'rooms', L.rooms.length, L.rooms.map((r) => r.kind).join(','), 'walls', L.walls.length / 7, 'doors', L.doors.length, 'panels', plan.panels.length);
}

// 3. raycast at a partition hits it and reports its panel; breaking it opens it
let rayChecked = 0;
for (const c of shells) {
  const plan = c.shell.plan;
  if (!plan) continue;
  const inner = plan.panels.find((p) => p.kind === 'inner' && Math.hypot(p.bx - p.ax, p.bz - p.az) > 2); // wide enough to walk into, not around
  if (!inner) continue;
  const W = plan.levels[0].walls;
  const k = inner.wall * 7;
  const mx = (W[k] + W[k + 2]) / 2;
  const mz = (W[k + 1] + W[k + 3]) / 2;
  const ex = W[k + 2] - W[k];
  const ez = W[k + 3] - W[k + 1];
  const l = Math.hypot(ex, ez);
  const nxx = -ez / l;
  const nzz = ex / l;
  const ox = mx + nxx * 1.2;
  const oz = mz + nzz * 1.2;
  const y = plan.levels[0].y + 1.2;
  const hit = world.raycast(ox, y, oz, -nxx, 0, -nzz, 5);
  if (!hit || world.panelHit(hit) !== inner) fail(`building ${c.ref.id}: ray at inner panel ${inner.id} did not resolve it (${hit ? hit.kind + ' t=' + hit.t.toFixed(2) : 'miss'})`);
  else if (Math.abs(hit.t - (1.2 - W[k + 4])) > 0.05) fail(`building ${c.ref.id}: ray hit the partition at t=${hit.t.toFixed(3)}, expected ${(1.2 - W[k + 4]).toFixed(3)}`);
  world.breakPanel(c, inner.id);
  const h2 = world.raycast(ox, y, oz, -nxx, 0, -nzz, 2.4);
  if (h2 && world.panelHit(h2) === inner) fail(`building ${c.ref.id}: broken inner panel still hit`);
  world.restorePanel(c, inner.id);
  // walk into the partition: the body stays on its own side
  const body = { x: ox, y: plan.levels[0].y, z: oz };
  for (let i = 0; i < 40; i++) {
    body.x -= nxx * 0.1;
    body.z -= nzz * 0.1;
    world.resolveCircle(body, R, 1.8);
  }
  const side = (body.x - mx) * nxx + (body.z - mz) * nzz;
  if (side < R + W[k + 4] - 0.02) fail(`building ${c.ref.id}: walked into / through inner panel ${inner.id} (side ${side.toFixed(3)})`);
  const h3 = world.raycast(ox, y, oz, -nxx, 0, -nzz, 5);
  if (!h3 || world.panelHit(h3) !== inner) fail(`building ${c.ref.id}: restored inner panel not hit`);
  rayChecked++;
}

// 4. outer panel: ray from outside resolves it; broken -> ray passes and a body walks through
let outerChecked = 0;
for (const c of shells.slice(0, 40)) {
  const s = c.shell;
  const pn = s.panels.find((p) => p.kind === 'outer' && (p.f1 - p.f0) * Math.hypot(c.p[((p.e + 1) % c.n) * 2] - c.p[p.e * 2], c.p[((p.e + 1) % c.n) * 2 + 1] - c.p[p.e * 2 + 1]) > 2.5);
  if (!pn) continue;
  const e = pn.e;
  const k = (e + 1) % c.n;
  const ax = c.p[e * 2];
  const az = c.p[e * 2 + 1];
  const ex = c.p[k * 2] - ax;
  const ez = c.p[k * 2 + 1] - az;
  const fm = (pn.f0 + pn.f1) / 2;
  const px = ax + ex * fm;
  const pz = az + ez * fm;
  const l = Math.hypot(ex, ez);
  let onx = -ez / l;
  let onz = ex / l;
  if (pointInPoly(c.p, c.n, px + onx * 0.5, pz + onz * 0.5)) {
    onx = -onx;
    onz = -onz;
  }
  const y = s.floor + 1.2;
  const hit = world.raycast(px + onx * 3, y, pz + onz * 3, -onx, 0, -onz, 6);
  if (hit && hit.collider !== c) continue; // a neighbouring building stands in front of this wall
  if (!hit || world.panelHit(hit) !== pn) {
    fail(`building ${c.ref.id}: ray at outer panel ${pn.id} resolved ${hit ? world.panelHit(hit) && world.panelHit(hit).id : 'miss'}`);
    continue;
  }
  world.breakPanel(c, pn.id);
  const h2 = world.raycast(px + onx * 3, y, pz + onz * 3, -onx, 0, -onz, 3.5);
  if (h2 && h2.collider === c) fail(`building ${c.ref.id}: broken outer panel still blocks the ray (t=${h2.t.toFixed(2)} panel=${h2.panel && h2.panel.id})`);
  // walk in through the hole
  const body = { x: px + onx * 1.5, y: s.floor, z: pz + onz * 1.5 };
  for (let i = 0; i < 60; i++) {
    body.x -= onx * 0.1;
    body.z -= onz * 0.1;
    world.resolveCircle(body, R, 1.8);
  }
  if (!pointInPoly(c.p, c.n, body.x, body.z)) fail(`building ${c.ref.id}: could not walk in through broken outer panel ${pn.id}`);
  // a body whose head is above the ceiling (feet on a ramp) is stopped by the wall band over the hole
  const hi = s.ceil - 1.0;
  const body3 = { x: px + onx * 1.5, y: hi, z: pz + onz * 1.5 };
  for (let i = 0; i < 60; i++) {
    body3.x -= onx * 0.1;
    body3.z -= onz * 0.1;
    body3.y = hi;
    world.resolveCircle(body3, R, 1.8);
  }
  if (pointInPoly(c.p, c.n, body3.x, body3.z)) fail(`building ${c.ref.id}: head passed through the wall band above broken outer panel ${pn.id}`);
  world.restorePanel(c, pn.id);
  const body2 = { x: px + onx * 1.5, y: s.floor, z: pz + onz * 1.5 };
  for (let i = 0; i < 60; i++) {
    body2.x -= onx * 0.1;
    body2.z -= onz * 0.1;
    world.resolveCircle(body2, R, 1.8);
  }
  if (pointInPoly(c.p, c.n, body2.x, body2.z) && world.interiorAt(body2.x, body2.z)) fail(`building ${c.ref.id}: walked through a restored outer panel`);
  outerChecked++;
}

// 5. determinism
if (world.interiorHash !== world2.interiorHash) fail(`interiorHash differs between two builds: ${world.interiorHash} vs ${world2.interiorHash}`);

// 6. no random / hypot / trig in the generator
const srcs = [path.join(root, 'src/world/Interiors.js'), ...fs.readdirSync(path.join(root, 'src/world/interiors')).map((f) => path.join(root, 'src/world/interiors', f))];
for (const f of srcs) {
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/Math\.(random|hypot|sin|cos|tan|atan|atan2|asin|acos)\b|Date\./g);
  if (m) fail(`${path.relative(root, f)} uses ${[...new Set(m)].join(', ')}`);
}

// Phase 2D: bots route through rooms (interior doors, stairs), react to broken panels; loot
// spawns at plan.lootSpots. Headless Bots / Loot (no kits, no scene), seeded, fixed dt.
const phase2d = await (async () => {
  const { Bots } = await import('../src/game/Bots.js');
  const { Loot } = await import('../src/game/Loot.js');
  const { route } = await import('../src/world/Interiors.js');
  const { MATCH } = await import('../src/core/config.js');
  world.restoreAllPanels();
  const seeded = (a) => () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const roomOf = (plan, x, z) => {
    const F = plan.frame;
    const a = (x - F.ox) * F.ux + (z - F.oz) * F.uz;
    const b = (x - F.ox) * F.vx + (z - F.oz) * F.vz;
    let best = -1;
    let bd = Infinity;
    for (const r of plan.levels[0].rooms) {
      const da = Math.max(r.a0 - a, 0, a - r.a1);
      const db = Math.max(r.b0 - b, 0, b - r.b1);
      if (da * da + db * db < bd) {
        bd = da * da + db * db;
        best = r.id;
      }
    }
    return best;
  };
  const bots = new Bots({ world, kits: [] });
  bots._nearShell = () => null; // no indoor wander detours: the goal stays where the test puts it
  const rop = world.randomOpenPoint.bind(world);
  let pin = null; // wander re-picks its goal inside 4 m: every re-pick returns the pinned goal
  world.randomOpenPoint = (r, cx, cz, rad, cl, out) => (pin ? ((out.x = pin.x), (out.z = pin.z), out) : rop(r, cx, cz, rad, cl, out));
  const rng = seeded(7);
  /** Bot standing at (x, z) walks (wander) toward (gx, gz); returns seconds to reach the goal's room or -1. */
  const walk = (c, x, z, gx, gz, maxT) => {
    bots.spawn(1, rng, { dropPoints: [{ x, z }] });
    const b = bots.brains[0];
    const a = b.actor;
    a.pos.set(x, world.groundHeight(x, z, 1e4), z);
    a.gliding = false;
    a.grounded = true;
    b.state = 'wander';
    for (const m of ['wood', 'brick', 'metal']) a.inventory.mats[m] = 200; // no harvest detours
    b.wanderGoal = true;
    b.goalX = gx;
    b.goalZ = gz;
    b.wanderUntil = 1e9;
    pin = { x: gx, z: gz };
    const gr = roomOf(c.shell.plan, gx, gz);
    for (let t = 0; t < maxT; t += 0.05) {
      bots.update(0.05, {});
      if (Math.hypot(a.pos.x - gx, a.pos.z - gz) < 2.5 && world.interiorAt(a.pos.x, a.pos.z) === c && roomOf(c.shell.plan, a.pos.x, a.pos.z) === gr) return t;
    }
    return -1;
  };
  /** Outside the main door to the room the most interior doors away (kind preferred). */
  const deepWalk = (c, kind) => {
    const s = c.shell;
    const plan = s.plan;
    const d = s.doors.find((q) => q.main) || s.doors[0];
    const r0 = roomOf(plan, d.x - d.nx * 1.3, d.z - d.nz * 1.3);
    let best = null;
    for (const r of plan.levels[0].rooms) {
      const rt = route(plan, r0, r.id, []);
      if (!rt) continue;
      const score = (kind && r.kind === kind ? 1e4 : 0) + rt.length * 100 + Math.hypot(r.cx - d.x, r.cz - d.z);
      if (!best || score > best.score) best = { r, hops: rt.length, score };
    }
    const t = walk(c, d.x + d.nx * 3, d.z + d.nz * 3, best.r.cx, best.r.cz, 60);
    return { id: c.ref.id, room: best.r.kind, hops: best.hops, t: +t.toFixed(2) };
  };
  const out = { named: [], random: 0, arrived: 0 };
  // named deep rooms: office_block 1427720556's far office, the bank's vault
  for (const [id, kind] of [[1427720556, null], [912573732, 'vault']]) {
    const c = world.buildingById(id);
    if (!c || !c.shell.plan) {
      fail(`phase 2D: building ${id} has no plan`);
      continue;
    }
    const r = deepWalk(c, kind);
    out.named.push(r);
    if (r.t < 0) fail(`phase 2D: bot did not reach ${r.room} of ${id} (${r.hops} doors) in 60 s`);
  }
  // a seeded sample of multi-room buildings
  const pick = seeded(11);
  const pool = shells.filter((c) => c.shell.plan && c.shell.plan.levels[0].rooms.length >= 3 && c.shell.doors.length);
  for (let i = 0; i < 40 && pool.length; i++) {
    const r = deepWalk(pool[Math.floor(pick() * pool.length)]);
    out.random++;
    if (r.t >= 0) out.arrived++;
    else if (verbose) console.log('phase 2D: no arrival', JSON.stringify(r));
  }
  if (out.arrived < Math.ceil(out.random * 0.95)) fail(`phase 2D: only ${out.arrived}/${out.random} deep-room walks arrived (want >= 95%)`);

  // broken partition: a straight walk through the hole replaces the door route
  {
    const c = world.buildingById(912514434);
    const plan = c && c.shell.plan;
    const L = plan && plan.levels[0];
    let done = false;
    for (let w = 0; L && w < L.wallMeta.length && !done; w++) {
      const m = L.wallMeta[w];
      if (m.kind !== 'wall' || m.ra < 0 || m.rb < 0) continue;
      const k = w * 7;
      const W = L.walls;
      if (Math.hypot(W[k + 2] - W[k], W[k + 3] - W[k + 1]) < 1.5) continue;
      const mx = (W[k] + W[k + 2]) / 2;
      const mz = (W[k + 1] + W[k + 3]) / 2;
      const ax = mx - m.nx * 1.2;
      const az = mz - m.nz * 1.2;
      const bx = mx + m.nx * 1.2;
      const bz = mz + m.nz * 1.2;
      if (world.interiorAt(ax, az) !== c || world.interiorAt(bx, bz) !== c || world.blockedAt(ax, az, 0.5, true) || world.blockedAt(bx, bz, 0.5, true)) continue;
      done = true;
      bots.spawn(1, rng, { dropPoints: [{ x: ax, z: az }] });
      const b = bots.brains[0];
      b.actor.pos.set(ax, c.shell.floor, az);
      b.inB = c;
      const routed = bots._doorRoute(b, bx, bz);
      world.breakPanel(c, m.panel);
      b.pathN = 0;
      b.walkAt = 0;
      const routedBroken = bots._doorRoute(b, bx, bz);
      // walk toward a goal 3 m past the wall: time until the bot is 0.6 m beyond the wall line
      const gx = mx + m.nx * 3;
      const gz = mz + m.nz * 3;
      walk(c, ax, az, gx, gz, 0.05);
      const a = bots.brains[0].actor;
      let t = 0;
      while (t < 6 && (a.pos.x - mx) * m.nx + (a.pos.z - mz) * m.nz < 0.6) {
        bots.update(0.05, {});
        t += 0.05;
      }
      world.restoreAllPanels();
      if (!routed) fail('phase 2D: no door route around an intact partition');
      if (routedBroken) fail('phase 2D: door route kept after the partition broke (expected a straight walk)');
      if (t >= 3) fail(`phase 2D: bot did not walk through a broken partition (${t.toFixed(2)} s)`);
      out.broken = { panel: m.panel, routed, routedBroken, t: +t.toFixed(2) };
    }
    if (!done) fail('phase 2D: no partition found for the broken-panel walk');
  }
  world.randomOpenPoint = rop;
  pin = null;

  // loot: exact counts, indoor share, indoor records on a room floor clear of walls
  const loot = new Loot({ scene: null, world });
  const ls = loot.spawnMatch(seeded(3));
  if (ls.chests !== MATCH.chests || ls.ammoBoxes !== MATCH.ammoBoxes) fail(`phase 2D: loot counts ${JSON.stringify(ls)}`);
  if (ls.indoorChests < MATCH.chests * 0.3) fail(`phase 2D: only ${ls.indoorChests} indoor chests`);
  let indoor = 0;
  let badLoot = 0;
  for (const r of loot.records) {
    const c = world.interiorAt(r.x, r.z);
    if (!c) continue;
    indoor++;
    if (world.blockedAt(r.x, r.z, 0.25, true) || Math.abs(r.y - c.shell.floor) > 0.6) badLoot++;
  }
  if (badLoot) fail(`phase 2D: ${badLoot} indoor loot records in a wall or off the floor`);
  out.loot = { ...ls, ms: undefined, indoorRecords: indoor, records: loot.records.length };
  // spacing: marked spots on another storey are not neighbours
  loot._grid = new Map();
  loot._mark(0, 0, 3, 1);
  if (!loot._spaced(1, 0, 3, 2) || loot._spaced(1, 0, 3, 1) || loot._spaced(1, 0, 3, -1)) fail('phase 2D: Loot._spaced storey term');
  loot._grid = null;
  return out;
})();

console.log(`buildings ${data.buildings.length}, hollow ${shells.length}, rooms ${rooms}, interior walls ${walls}, interior doors ${idoors}, panels ${panels} (outer ${outerPanels}, inner ${panels - outerPanels})`);
console.log('recipes', JSON.stringify(recipes));
console.log(`ray checks: inner ${rayChecked}, outer ${outerChecked}; plan time ${ms} ms (whole World build)`);
console.log('interiorHash', world.interiorHash);
console.log('phase 2D', JSON.stringify(phase2d));
if (fails.length) {
  console.log(`\nFAIL (${fails.length})`);
  for (const f of fails.slice(0, 80)) console.log('  ' + f);
  process.exit(1);
}
console.log('OK');
