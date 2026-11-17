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
    const c = world.interiorAt(r.x, r.z, r.y);
    if (!c) continue;
    indoor++;
    const L = c.shell.plan.levels.find(L => Math.abs(r.y - L.y) <= 0.6);
    const pos = { x: r.x, y: L ? L.y : r.y, z: r.z };
    world.resolveCircle(pos, 0.25, 0.6);
    const floor = world.groundHeight(r.x, r.z, r.y, 0.1);
    if (!L || Math.hypot(pos.x - r.x, pos.z - r.z) > 0.02 || Math.abs(floor - L.y) > 0.1) badLoot++;
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

// Phase 2C: landmark recipes. Every landmark id plans with recipe 'landmark' (not its generic
// fallback), every room is labelled, 8th & Plate gets one stall per eatery POI, and every level
// tree a landmark returns (the { levels } form, asked for up to 8 storeys) partitions into one
// connected room graph on its own (upper levels have no exterior doors; stairs come from Phase 2A).
{
  const { LANDMARK_IDS, LANDMARK_RECIPES } = await import('../src/world/interiors/landmarks.js');
  const { toLocal, partition, placeDoors, q } = await import('../src/world/interiors/layout.js');
  const lfails = [];
  const captured = {};
  const orig = {};
  for (const id of Object.keys(LANDMARK_RECIPES)) {
    orig[id] = LANDMARK_RECIPES[id];
    LANDMARK_RECIPES[id] = (f) => {
      captured[id] = f;
      return orig[id](f);
    };
  }
  const w3 = build();
  for (const id of Object.keys(orig)) LANDMARK_RECIPES[id] = orig[id];
  if (w3.interiorHash !== world.interiorHash) lfails.push('landmark recipes are not deterministic across builds');
  const byId = new Map(w3.buildingInteriors().map((b) => [String(b.collider.ref.id), b.collider]));
  const HUBK = { corridor: 1, hall: 1, lobby: 1, sales: 1, living: 1, open: 1 };
  console.log('\nlandmarks:');
  for (const id of Object.keys(LANDMARK_IDS)) {
    const c = byId.get(id);
    const key = LANDMARK_IDS[id].key;
    if (!c) {
      lfails.push(`landmark ${id} ${key}: not a hollow building`);
      continue;
    }
    const plan = c.shell.plan;
    if (plan.recipe !== 'landmark') lfails.push(`landmark ${id} ${key}: planned with '${plan.recipe}', expected 'landmark'`);
    const L0 = plan.levels[0];
    for (const r of L0.rooms) if (!r.label) lfails.push(`landmark ${id} ${key}: room ${r.id} (${r.kind}) has no label`);
    if (L0.rooms.length < 3) lfails.push(`landmark ${id} ${key}: only ${L0.rooms.length} rooms`);
    console.log(`  ${key} (${id}): ${L0.rooms.length} rooms - ${L0.rooms.map((r) => r.label).join(', ')}`);
    // every level tree on its own forms one connected room graph
    const f = captured[id];
    if (!f) continue;
    const out = orig[id]({ ...f, levels: 8 });
    const trees = out && out.levels ? out.levels : [out];
    const F = plan.frame;
    const P = [];
    for (let i = 0; i < c.shell.inner.length; i += 2) {
      const [a, b] = toLocal(F, c.shell.inner[i], c.shell.inner[i + 1]);
      P.push(q(a), q(b));
    }
    trees.forEach((tree, k) => {
      const lay = partition(tree, P, F, []);
      placeDoors(lay.rooms, lay.pieces, () => 1.7, (r) => !!HUBK[r.kind]);
      const par = lay.rooms.map((_, i) => i);
      const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
      for (const p of lay.pieces) if ((p.door || p.open) && p.ra >= 0 && p.rb >= 0) par[find(p.ra)] = find(p.rb);
      const comps = new Set(lay.rooms.map((_, i) => find(i))).size;
      if (comps !== 1) lfails.push(`landmark ${id} ${key}: level ${k} tree splits into ${comps} room groups`);
      if (k > 0) console.log(`    level ${k}: ${lay.rooms.length} rooms - ${lay.rooms.map((r) => r.label).join(', ')}`);
    });
    if (out && out.stairs) for (const s of out.stairs) if (!(s.a > 0 && s.a < F.L && s.b > 0 && s.b < F.W)) lfails.push(`landmark ${id} ${key}: stair hint outside the frame`);
  }
  // 8th & Plate: one labelled stall per eatery POI
  const ep = byId.get('949466253');
  if (ep) {
    const stalls = ep.shell.plan.levels[0].rooms.filter((r) => r.kind === 'stall').map((r) => r.label);
    const eats = (data.pois || []).filter((p) => /amenity=(fast_food|restaurant|cafe)/.test(p.k || '') && pointInPoly(ep.p, ep.n, p.x, p.z)).map((p) => p.n);
    for (const n of eats) if (!stalls.includes(n)) lfails.push(`8th & Plate: no stall labelled "${n}"`);
    if (stalls.length !== eats.length) lfails.push(`8th & Plate: ${stalls.length} stalls for ${eats.length} eatery POIs`);
  }
  if (lfails.length) {
    console.log(`\nFAIL Phase 2C (${lfails.length})`);
    for (const f of lfails.slice(0, 80)) console.log('  ' + f);
    process.exit(1);
  }
  console.log('OK');
}

// Phase 2E: breakable building walls in Combat + host -> client panel sync (wd / wx).
// Pickaxe a panel down (mats per swing = PICKAXE.yield), shoot one down (no mats), the hole is
// walkable and shootable while neighbours stay solid, roofs never break, restoreWorld() restores
// every panel, a non-authoritative Combat changes nothing, and a HostSession -> ClientSession
// loopback (fake relay, JSON round trip) mirrors damage / breaks on a second World, with the
// untrusted-input validation of resolvePanelEvent.
{
  const THREE = await import('three');
  const { Combat } = await import('../src/game/Combat.js');
  const { PICKAXE, BUILDING_WALL, weaponStats } = await import('../src/core/config.js');
  const { resolvePanelEvent } = await import('../src/net/protocol.js');
  const { HostSession } = await import('../src/net/HostSession.js');
  const { ClientSession } = await import('../src/net/ClientSession.js');
  const fails2 = [];
  const f2 = (m) => fails2.push(m);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const actor = (x, y, z) => ({ id: 1, pos: V(x, y, z), alive: true, radius: 0.42, height: 1.8, damageScale: 1 });
  const pistol = () => ({ id: 'pistol', rarity: 'common', mag: 99 });

  // outer panels with a clear outside approach, one per building: { c, pn, px, pz, onx, onz, y }
  const targets = [];
  for (const c of shells) {
    const s = c.shell;
    for (const pn of s.panels) {
      if (pn.kind !== 'outer') continue;
      const k = (pn.e + 1) % c.n;
      const ax = c.p[pn.e * 2];
      const az = c.p[pn.e * 2 + 1];
      const ex = c.p[k * 2] - ax;
      const ez = c.p[k * 2 + 1] - az;
      const l = Math.hypot(ex, ez);
      if ((pn.f1 - pn.f0) * l < 2.5) continue;
      const fm = (pn.f0 + pn.f1) / 2;
      const px = ax + ex * fm;
      const pz = az + ez * fm;
      let onx = -ez / l;
      let onz = ex / l;
      if (pointInPoly(c.p, c.n, px + onx * 0.5, pz + onz * 0.5)) {
        onx = -onx;
        onz = -onz;
      }
      const y = s.floor + 1.3;
      const far = world.raycast(px + onx * 5, y, pz + onz * 5, -onx, 0, -onz, 7);
      if (!far || far.collider !== c || world.panelHit(far) !== pn) continue;
      targets.push({ c, pn, px, pz, onx, onz, y });
      break;
    }
    if (targets.length >= 12) break;
  }
  if (targets.length < 5) f2(`only ${targets.length} outer panels with a clear approach`);

  const combat = new Combat({ world });
  let harvestHook = 0;
  combat.onHarvest = () => harvestHook++;

  // a) pickaxe: every swing = PICKAXE.harvest hp and PICKAXE.yield[mat] mats; breaks at 0
  const T = targets[0];
  if (T) {
    const { c, pn, px, pz, onx, onz, y } = T;
    const sh = actor(px + onx * 1.6, y - 1.3, pz + onz * 1.6);
    const o = V(px + onx * 1.6, y, pz + onz * 1.6);
    const d = V(-onx, 0, -onz);
    const swings = Math.ceil(pn.maxHp / PICKAXE.harvest);
    let mats = 0;
    for (let i = 0; i < swings; i++) {
      const before = pn.hp;
      const r = combat.swingPickaxe(sh, o, d);
      if (!r.harvested || r.harvested.mat !== pn.mat || r.harvested.count !== PICKAXE.yield[pn.mat]) f2(`swing ${i}: harvested ${JSON.stringify(r.harvested)} (want ${pn.mat} x${PICKAXE.yield[pn.mat]})`);
      else mats += r.harvested.count;
      if (r.collider !== pn) f2(`swing ${i}: out.collider is not the panel (the HUD bar reads it)`);
      if (i < swings - 1 && Math.abs(before - pn.hp - PICKAXE.harvest) > 1e-6) f2(`swing ${i}: hp ${before} -> ${pn.hp}`);
      if (i < swings - 1 && !pn.alive) f2(`panel broke early at swing ${i}`);
    }
    if (pn.alive) f2(`panel ${pn.id} still alive after ${swings} swings (hp ${pn.hp})`);
    if (mats !== swings * PICKAXE.yield[pn.mat]) f2(`mats ${mats}, want ${swings * PICKAXE.yield[pn.mat]}`);
    if (harvestHook !== swings) f2(`onHarvest fired ${harvestHook} times, want ${swings}`);
    // the hole is shootable (ray passes) and walkable; the next swing does not hit it
    const h = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 2.2);
    if (h && h.collider === c) f2(`ray still blocked by broken panel ${pn.id}`);
    const r2 = combat.swingPickaxe(sh, o, d);
    if (r2.panel === pn) f2('swing hit a broken panel');
    const body = { x: px + onx * 1.5, y: c.shell.floor, z: pz + onz * 1.5 };
    for (let i = 0; i < 60; i++) {
      body.x -= onx * 0.1;
      body.z -= onz * 0.1;
      world.resolveCircle(body, R, 1.8);
    }
    if (!pointInPoly(c.p, c.n, body.x, body.z)) f2(`could not walk through the pickaxed hole of ${c.ref.id}/${pn.id}`);
    for (const nb of c.shell.panels) if (nb !== pn && !nb.alive) f2(`neighbour panel ${nb.id} broke too`);
  }

  // b) bullets: BUILDING_WALL.bulletMult x damage, no mats, no onHarvest
  const T2 = targets[1];
  if (T2) {
    const { pn, px, pz, onx, onz, y } = T2;
    const sh = actor(px + onx * 5, y - 1.3, pz + onz * 5);
    const o = V(px + onx * 5, y, pz + onz * 5);
    const d = V(-onx, 0, -onz);
    const w = weaponStats('pistol', 'common');
    const hooks0 = harvestHook;
    const before = pn.hp;
    combat.fireWeapon(sh, pistol(), o, d, 0, { dirs: [d.clone()] });
    const want = w.damage * BUILDING_WALL.bulletMult;
    if (Math.abs(before - pn.hp - want) > 1e-6) f2(`bullet did ${before - pn.hp} to the panel, want ${want}`);
    let shots = 1;
    while (pn.alive && shots < 500) {
      combat.fireWeapon(sh, pistol(), o, d, 0, { dirs: [d.clone()] });
      shots++;
    }
    if (pn.alive) f2('panel survived 500 pistol shots');
    else if (shots !== Math.ceil(pn.maxHp / want)) f2(`panel broke after ${shots} shots, want ${Math.ceil(pn.maxHp / want)}`);
    if (harvestHook !== hooks0) f2('bullets triggered onHarvest');
    const recs = combat.fireWeapon(sh, pistol(), o, d, 0, { dirs: [d.clone()] });
    if (recs[0] && recs[0].point.distanceTo(o) < 5.3) f2(`bullet still stops at the broken panel (t=${recs[0].point.distanceTo(o).toFixed(2)})`);
  }

  // c) roofs / floors never break: shooting straight down onto a roof leaves every panel alone
  const T3 = targets[2];
  if (T3) {
    const { c } = T3;
    const snap = c.shell.panels.map((p) => p.hp + ':' + p.alive).join();
    const o = V(T3.px - T3.onx * 2, c.h + 20, T3.pz - T3.onz * 2);
    const sh = actor(o.x, o.y - 1.3, o.z);
    for (let i = 0; i < 50; i++) combat.fireWeapon(sh, pistol(), o, V(0, -1, 0), 0, { dirs: [V(0, -1, 0)] });
    if (c.shell.panels.map((p) => p.hp + ':' + p.alive).join() !== snap) f2('shooting the roof changed panel hp');
  }

  // d) inner partition panel: a pickaxe swing from inside harvests wood
  {
    let done = false;
    for (const c of shells) {
      if (done) break;
      for (const inner of c.shell.panels) {
        if (done) break;
        if (inner.kind !== 'inner' || Math.hypot(inner.bx - inner.ax, inner.bz - inner.az) < 1.5) continue;
        const l = Math.hypot(inner.bx - inner.ax, inner.bz - inner.az);
        const nx = -(inner.bz - inner.az) / l;
        const nz = (inner.bx - inner.ax) / l;
        for (const sgn of [1, -1]) {
          const o = V(inner.x + nx * sgn * 1.2, inner.y0 + 1.3, inner.z + nz * sgn * 1.2);
          const h = world.raycast(o.x, o.y, o.z, -nx * sgn, 0, -nz * sgn, 3);
          if (!h || world.panelHit(h) !== inner) continue;
          const r = combat.swingPickaxe(actor(o.x, inner.y0, o.z), o, V(-nx * sgn, 0, -nz * sgn));
          if (r.panel !== inner || !r.harvested || r.harvested.mat !== 'wood') f2(`inner panel swing: ${JSON.stringify(r.harvested)}`);
          if (inner.hp !== BUILDING_WALL.innerHp - PICKAXE.harvest) f2(`inner panel hp ${inner.hp}`);
          done = true;
          break;
        }
      }
    }
    if (!done) f2('no inner panel reachable for the swing test');
  }

  // e) a non-authoritative (client) Combat predicts the harvest but changes nothing
  const T4 = targets[3];
  if (T4) {
    const cc = new Combat({ world });
    cc.authoritative = false;
    const { pn, px, pz, onx, onz, y } = T4;
    const o = V(px + onx * 1.6, y, pz + onz * 1.6);
    const r = cc.swingPickaxe(actor(o.x, y - 1.3, o.z), o, V(-onx, 0, -onz));
    if (!r.predicted || r.panel !== pn) f2('client swing did not predict the panel harvest');
    cc.fireWeapon(actor(o.x, y - 1.3, o.z), pistol(), o, V(-onx, 0, -onz), 0, { dirs: [V(-onx, 0, -onz)] });
    if (pn.hp !== pn.maxHp || !pn.alive) f2(`client combat changed panel hp to ${pn.hp}`);
  }

  // f) restoreWorld (rematch) restores every panel and its hp
  combat.restoreWorld();
  let bad = 0;
  for (const c of shells) for (const p of c.shell.panels) if (!p.alive || p.hp !== p.maxHp) bad++;
  if (bad) f2(`${bad} panels not restored by restoreWorld`);
  if (T) {
    const h = world.raycast(T.px + T.onx * 2, T.y, T.pz + T.onz * 2, -T.onx, 0, -T.onz, 4);
    if (!h || world.panelHit(h) !== T.pn) f2('restored panel not hit again');
  }

  // g) host -> client loopback through the real session classes (fake relay, JSON round trip)
  {
    const wire = [];
    const room = { clients: new Map(), broadcast: (m) => (wire.push(JSON.stringify(m)), 1), sendTo() {}, sendRawTo: () => 0 };
    const hostGame = { combat: new Combat({ world }), loot: null, structures: null };
    const host = new HostSession(room, hostGame, { fill: false });
    host._wrap(hostGame);
    host.started = true;
    host._spawning = false;
    const cWorld = world2;
    const cliCombat = new Combat({ world: cWorld });
    cliCombat.authoritative = false;
    const errs = [];
    const conn = { id: 2 };
    const client = new ClientSession(conn, { world: cWorld, combat: cliCombat, fx: null, sfx: { play() {} }, _error: (m, e) => errs.push(m + ': ' + e.message) });
    client.started = true;
    const flush = () => {
      host._flushEvents();
      return wire.splice(0).map((s) => JSON.parse(s));
    };
    const deliver = (msgs) => msgs.forEach((m) => conn.onMessage(m));
    const [A, B] = targets;
    if (A && B) {
      const sh = actor(A.px + A.onx * 1.6, A.y - 1.3, A.pz + A.onz * 1.6);
      const o = V(A.px + A.onx * 1.6, A.y, A.pz + A.onz * 1.6);
      const d = V(-A.onx, 0, -A.onz);
      hostGame.combat.swingPickaxe(sh, o, d);
      hostGame.combat.swingPickaxe(sh, o, d); // two hits in one tick -> one coalesced wd
      const sent = flush();
      const wds = sent.flatMap((m) => m.l.filter((e) => e.e === 'wd'));
      if (wds.length !== 1 || wds[0].hp !== A.pn.maxHp - 2 * PICKAXE.harvest || wds[0].b !== A.c.ref.id || wds[0].p !== A.pn.id) f2(`coalesced wd wrong: ${JSON.stringify(wds)}`);
      if (sent.some((m) => m.l.some((e) => e.e === 'cx'))) f2('panel damage emitted a cx event');
      deliver(sent);
      const cA = cWorld.buildingById(A.c.ref.id);
      const cpn = cA && cA.shell.panels[A.pn.id];
      if (!cpn || cpn.hp !== A.pn.hp) f2(`client panel hp ${cpn && cpn.hp}, host ${A.pn.hp}`);
      while (A.pn.alive) hostGame.combat.swingPickaxe(sh, o, d);
      const sent2 = flush();
      if (!sent2.some((m) => m.l.some((e) => e.e === 'wx' && e.b === A.c.ref.id && e.p === A.pn.id))) f2('no wx sent for the broken panel');
      deliver(sent2);
      if (!cpn || cpn.alive) f2('client panel not broken by wx');
      const ch = cWorld.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 2.2);
      if (ch && ch.collider === cA) f2('client ray still blocked after wx');
      // bullets break B on the host -> client
      const oB = V(B.px + B.onx * 5, B.y, B.pz + B.onz * 5);
      const shB = actor(oB.x, B.y - 1.3, oB.z);
      const dB = V(-B.onx, 0, -B.onz);
      let n = 0;
      while (B.pn.alive && n++ < 500) hostGame.combat.fireWeapon(shB, pistol(), oB, dB, 0, { dirs: [dB.clone()] });
      deliver(flush());
      const cB = cWorld.buildingById(B.c.ref.id).shell.panels[B.pn.id];
      if (cB.alive) f2('client panel B not broken');
      if (!A.c.alive || !cA.alive) f2('building collider removed');
    }
    // untrusted input: bogus events are ignored, never throw, never touch state
    const P = targets[4] || targets[0];
    if (P) {
      const cP = cWorld.buildingById(P.c.ref.id);
      const hp0 = cP.shell.panels[P.pn.id].hp;
      const count = () => shells.reduce((k, c) => k + cWorld.buildingById(c.ref.id).shell.panels.filter((p) => p.alive).length, 0);
      const alive0 = count();
      const bogus = [
        { e: 'wx', b: { shell: { panels: [{ id: 0, alive: true }] } }, p: 0 },
        { e: 'wx', b: 'nope', p: 0 },
        { e: 'wx', b: 123456789012, p: 0 },
        { e: 'wx', b: P.c.ref.id, p: -1 },
        { e: 'wx', b: P.c.ref.id, p: 1.5 },
        { e: 'wx', b: P.c.ref.id, p: 1e9 },
        { e: 'wx', b: P.c.ref.id, p: String(P.pn.id) },
        { e: 'wx', b: [P.c.ref.id], p: P.pn.id },
        { e: 'wd', b: P.c.ref.id, p: P.pn.id, hp: 'x' },
        { e: 'wd', b: P.c.ref.id, p: P.pn.id, hp: null },
        { e: 'wd', b: P.c.ref.id, p: P.pn.id },
        { e: 'wd', b: 'x'.repeat(5000), p: 0, hp: 1 },
      ];
      conn.onMessage({ t: 'ev', l: bogus });
      if (errs.length) f2('bogus events threw: ' + errs.join('; '));
      if (count() !== alive0) f2(`bogus events changed the alive panel count: ${count()} vs ${alive0}`);
      if (cP.shell.panels[P.pn.id].hp !== hp0) f2('bogus wd changed hp');
      const big = resolvePanelEvent(cWorld, { e: 'wd', b: P.c.ref.id, p: P.pn.id, hp: 1e9 });
      const neg = resolvePanelEvent(cWorld, { e: 'wd', b: P.c.ref.id, p: P.pn.id, hp: -50 });
      if (!big || big.hp !== P.pn.maxHp || !neg || neg.hp !== 1) f2(`hp clamp wrong: ${big && big.hp}, ${neg && neg.hp}`);
    }
    hostGame.combat.restoreWorld();
    cliCombat.restoreWorld();
  }

  if (fails2.length) {
    console.log(`\nPhase 2E FAIL (${fails2.length})`);
    for (const m of fails2.slice(0, 60)) console.log('  ' + m);
    process.exit(1);
  }
  console.log(`Phase 2E walls: ${targets.length} outer targets; pickaxe / bullet / roof / inner / client / restore / loopback checks OK`);
}
