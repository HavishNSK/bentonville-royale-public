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
