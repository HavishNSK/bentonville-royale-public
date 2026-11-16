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

console.log(`buildings ${data.buildings.length}, hollow ${shells.length}, rooms ${rooms}, interior walls ${walls}, interior doors ${idoors}, panels ${panels} (outer ${outerPanels}, inner ${panels - outerPanels})`);
console.log('recipes', JSON.stringify(recipes));
console.log(`ray checks: inner ${rayChecked}, outer ${outerChecked}; plan time ${ms} ms (whole World build)`);
console.log('interiorHash', world.interiorHash);
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
