// BENTONVILLE ROYALE — the Drop Bus: one straight flight across the map per match.
//
//   const route = planBusRoute(seed, world.bounds)   // same seed -> same route everywhere
//   busPosAt(route, t, out)        // {x, y, z} at t seconds after the match start
//   route.tOpen / route.tClose     // jumping allowed from tOpen; everyone left aboard is
//                                  // ejected at tClose (the bus is still over the map there)
//   jumpTimeFor(route, x, z)       // the time the bus passes closest to (x, z), in [tOpen, tClose]
//   routeDistance(route, x, z)     // perpendicular distance from (x, z) to the flight line
//   planBotTargets(route, world, rng, count)  // landing spots, busier near the route
//   const bus = new DropBusMesh(); scene.add(bus.root); bus.update(route, t, dt)
//
// The route is a straight line in a random direction through a point near the map centre
// (lateral offset up to 30% of the half-size across the flight), starting and ending
// ROUTE_MARGIN outside world.bounds, flown at PLAYER.dropHeight at ~46-54 m/s (22-30 s on
// the tile-pack map; longer maps are capped at 45 s). The route has
// its own RNG stream (derived from the match seed), so planning it never shifts the match
// RNG and a multiplayer client derives the identical route from the shared seed.
//
// The look: an original Bentonville take, a yellow school bus slung under a striped
// hot-air balloon (built from three.js primitives, toon-shaded like the rest of the scene).

import * as THREE from 'three';
import { PLAYER, TAU, makeRng, clamp } from '../core/config.js';
import { FREEFALL_SPEED, DEPLOY_HEIGHT, FREEFALL_ACROSS } from './Player.js';
import { toToon } from '../render/Toon.js';

const ROUTE_MARGIN = 100; // m outside the map at both ends
const OPEN_INSET = 10; // m inside the map edge before anyone may jump
const CLOSE_INSET = 40; // m before the far edge: auto-eject point
const MAX_OFFSET = 0.3; // lateral offset, fraction of the half-size across the flight

/**
 * Horizontal distance a human covers from the bus to the ground (freefall to the
 * auto-deploy height, then a full glide), from the constants Player.js flies with.
 * Freefall: average sink ~FREEFALL_SPEED + half the dive boost, FREEFALL_ACROSS m/s across.
 */
export const PLAYER_DROP_REACH = Math.round(
  ((PLAYER.dropHeight - DEPLOY_HEIGHT) / (FREEFALL_SPEED + 5)) * FREEFALL_ACROSS + (DEPLOY_HEIGHT / PLAYER.glideFallSpeed) * PLAYER.glideSpeed
);
/** Bots glide all the way down (Bots._move 'drop'): sink glideFallSpeed, glideSpeed across. */
export const BOT_DROP_REACH = Math.round((PLAYER.dropHeight / PLAYER.glideFallSpeed) * PLAYER.glideSpeed * 0.85);

/** Plans the match's flight. `bounds` = world.bounds. Pure function of (seed, bounds). */
export function planBusRoute(seed, bounds) {
  const rng = makeRng(((seed | 0) ^ 0x0b05d00d) >>> 0);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const hw = (bounds.maxX - bounds.minX) / 2;
  const hh = (bounds.maxZ - bounds.minZ) / 2;
  const heading = rng() * TAU;
  // forward = (sin h, -cos h) (config.js convention); perp is forward turned 90 deg clockwise
  const dx = Math.sin(heading);
  const dz = -Math.cos(heading);
  const px = Math.cos(heading);
  const pz = Math.sin(heading);
  const halfPerp = Math.abs(px) * hw + Math.abs(pz) * hh;
  const off = (rng() * 2 - 1) * MAX_OFFSET * halfPerp;
  const ox = cx + px * off;
  const oz = cz + pz * off;
  // slab test: the s range (along forward) where the line is inside the rectangle
  let sIn = -Infinity;
  let sOut = Infinity;
  for (const [o, d, lo, hi] of [
    [ox, dx, bounds.minX, bounds.maxX],
    [oz, dz, bounds.minZ, bounds.maxZ],
  ]) {
    if (Math.abs(d) < 1e-6) continue; // parallel: |off| < halfPerp keeps it inside
    const a = (lo - o) / d;
    const b = (hi - o) / d;
    sIn = Math.max(sIn, Math.min(a, b));
    sOut = Math.min(sOut, Math.max(a, b));
  }
  const sa = sIn - ROUTE_MARGIN;
  const sb = sOut + ROUTE_MARGIN;
  const length = sb - sa;
  // speed scales with the route so a small map is not a slow crawl: ~22-30 s here
  const duration = clamp(length / (46 + rng() * 8), 22, 45);
  const speed = length / duration;
  return makeRoute({
    ax: ox + dx * sa,
    az: oz + dz * sa,
    bx: ox + dx * sb,
    bz: oz + dz * sb,
    duration,
    tOpen: (ROUTE_MARGIN + OPEN_INSET) / speed,
    tClose: (sOut - sa - CLOSE_INSET) / speed,
  });
}

/** Rebuilds the derived fields from the wire form ({ax, az, bx, bz, duration, tOpen, tClose}). */
export function makeRoute(r) {
  const vx = r.bx - r.ax;
  const vz = r.bz - r.az;
  const length = Math.hypot(vx, vz) || 1;
  const dx = vx / length;
  const dz = vz / length;
  return {
    ax: r.ax,
    az: r.az,
    bx: r.bx,
    bz: r.bz,
    duration: r.duration,
    tOpen: r.tOpen,
    tClose: Math.max(r.tOpen + 1, r.tClose),
    y: PLAYER.dropHeight,
    length,
    speed: length / r.duration,
    dx,
    dz,
    heading: Math.atan2(dx, -dz),
  };
}

/** Compact JSON for the start message. */
export function routeWire(r) {
  const k = (v) => Math.round(v * 100) / 100;
  return { ax: k(r.ax), az: k(r.az), bx: k(r.bx), bz: k(r.bz), duration: k(r.duration), tOpen: k(r.tOpen), tClose: k(r.tClose) };
}

/** Bus position at time t (keeps flying past both ends). */
export function busPosAt(r, t, out = { x: 0, y: 0, z: 0 }) {
  const s = r.speed * t;
  out.x = r.ax + r.dx * s;
  out.z = r.az + r.dz * s;
  out.y = r.y;
  return out;
}

/** Time the bus passes closest to (x, z), clamped to the jump window. */
export function jumpTimeFor(r, x, z) {
  const s = (x - r.ax) * r.dx + (z - r.az) * r.dz;
  return clamp(s / r.speed, r.tOpen, r.tClose);
}

/** Perpendicular distance from (x, z) to the flight line. */
export function routeDistance(r, x, z) {
  return Math.abs((x - r.ax) * r.dz - (z - r.az) * r.dx);
}

/**
 * Landing spots for `count` bots: POIs (world landmarks) weighted toward those within
 * glide reach of the route, open ground along the route, and a few anywhere on the map.
 * Returns [{x, z, r}] (r: scatter radius for Bots._dropTargets).
 */
export function planBotTargets(r, world, rng, count) {
  const reach = BOT_DROP_REACH;
  const b = world.bounds;
  const pois = [];
  for (const key in world.landmarks || {}) {
    const l = world.landmarks[key];
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.z)) continue;
    const lr = l.r || 40;
    if (lr > 600) continue; // linear features (the greenway) are not a place to land
    const d = Math.max(0, routeDistance(r, l.x, l.z) - Math.min(lr, 150) * 0.6);
    // in reach: busy; a little beyond: some; far off the route: the odd loner
    const w = d <= reach ? 4 : d <= reach * 2.2 ? 1 : 0.3;
    const size = clamp(lr / 120, 0.5, 2.2); // big POIs hold more people
    pois.push({ x: l.x, z: l.z, r: clamp(lr * 0.9, 30, 180), w: w * size, n: 0 });
  }
  const out = [];
  const tmp = { x: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    const u = rng();
    if (pois.length && u < 0.62) {
      // weighted pick with diminishing returns, so one POI on the route does not take everyone
      let total = 0;
      for (const q of pois) total += q.w / (1 + q.n / 10);
      let pick = rng() * total;
      let p = pois[pois.length - 1];
      for (const q of pois) {
        pick -= q.w / (1 + q.n / 10);
        if (pick <= 0) {
          p = q;
          break;
        }
      }
      p.n++;
      world.randomOpenPoint(rng, p.x, p.z, p.r, 1.2, tmp);
    } else if (u < 0.93) {
      // open ground along the route, within glide reach of it
      const t = r.tOpen + rng() * (r.tClose - r.tOpen);
      const bp = busPosAt(r, t);
      const side = (rng() * 2 - 1) * reach * 0.9;
      const x = clamp(bp.x + r.dz * side, b.minX + 25, b.maxX - 25);
      const z = clamp(bp.z - r.dx * side, b.minZ + 25, b.maxZ - 25);
      world.randomOpenPoint(rng, x, z, 30, 1.2, tmp);
    } else {
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      world.randomOpenPoint(rng, cx, cz, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5, 1.2, tmp);
    }
    out.push({ x: tmp.x, z: tmp.z, r: 4 });
  }
  return out;
}

// ---------------------------------------------------------------- the mesh

const BUS_Y = 2.2; // body centre above the route altitude (riders drop from route.y)
const BALLOON_Y = 24;

function mat(color, extra = {}) {
  return toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
}

export class DropBusMesh {
  constructor() {
    const root = (this.root = new THREE.Group());
    root.name = 'drop-bus';
    root.visible = false;
    const yellow = mat(0xffc21f);
    const ink = mat(0x1d2a36);
    const glass = mat(0x8fd3ff, { emissive: 0x1a3a55, emissiveIntensity: 0.4 });
    const white = mat(0xfff6e0);
    const red = mat(0xd8452f);
    const teal = mat(0x2fb3a6);
    const rope = mat(0x6b4a2b);
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      root.add(mesh);
      return mesh;
    };

    // ---- the school bus (length along -z = forward)
    const L = 12;
    box(3, 2.6, L, yellow, 0, BUS_Y, 0);
    box(2.9, 0.4, L - 0.6, yellow, 0, BUS_Y + 1.5, 0); // roof crown
    box(3.04, 0.22, L + 0.04, ink, 0, BUS_Y - 0.35, 0); // black rub rail
    box(3.04, 0.22, L + 0.04, ink, 0, BUS_Y + 0.15, 0);
    box(3, 1.8, 2.2, yellow, 0, BUS_Y - 0.4, -L / 2 - 1.1); // hood
    box(3.06, 0.3, 0.3, ink, 0, BUS_Y - 1.2, -L / 2 - 2.2); // bumper
    box(2.6, 1, 0.08, glass, 0, BUS_Y + 0.75, -L / 2 - 0.02); // windshield
    for (let i = 0; i < 6; i++) {
      const z = -L / 2 + 1.4 + i * 1.75;
      box(0.06, 0.85, 1.3, glass, 1.52, BUS_Y + 0.75, z);
      box(0.06, 0.85, 1.3, glass, -1.52, BUS_Y + 0.75, z);
    }
    box(2.4, 0.8, 0.06, glass, 0, BUS_Y + 0.75, L / 2 + 0.02); // rear window
    // a stop arm on the driver's side, folded out (it is a school bus after all)
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 8), red);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-1.9, BUS_Y + 0.4, -L / 2 + 1.2);
    root.add(arm);
    // wheels
    const wheelG = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 14);
    for (const [x, z] of [[1.4, -L / 2 + 1.6], [-1.4, -L / 2 + 1.6], [1.4, L / 2 - 2], [-1.4, L / 2 - 2]]) {
      const w = new THREE.Mesh(wheelG, ink);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, BUS_Y - 1.35, z);
      root.add(w);
    }

    // ---- the balloon: vertical gores in cream / tomato / teal, a basket-ring and burner
    const envelope = new THREE.Group();
    envelope.position.y = BALLOON_Y;
    const gores = 12;
    const colors = [white, red, teal];
    for (let i = 0; i < gores; i++) {
      const g = new THREE.SphereGeometry(10, 4, 18, (i / gores) * TAU, TAU / gores, 0, Math.PI * 0.78);
      const m = new THREE.Mesh(g, colors[i % colors.length]);
      envelope.add(m);
    }
    envelope.scale.set(1, 1.18, 1);
    root.add(envelope);
    // skirt: a short cone narrowing toward the burner
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 2.4, 4.5, 12, 1, true), red);
    skirt.material.side = THREE.DoubleSide;
    skirt.position.y = BALLOON_Y - 9.2;
    root.add(skirt);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.18, 6, 16), ink);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = BALLOON_Y - 11.5;
    root.add(ring);
    this.flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.7, 2.6, 8),
      new THREE.MeshBasicMaterial({ color: 0xffa62b, transparent: true, opacity: 0.85 })
    );
    this.flame.position.y = BALLOON_Y - 10;
    root.add(this.flame);
    // ropes from the bus roof corners up to the ring
    const ropeTop = BALLOON_Y - 11.5;
    for (const [x, z] of [[1.3, -L / 2 + 0.6], [-1.3, -L / 2 + 0.6], [1.3, L / 2 - 0.6], [-1.3, L / 2 - 0.6]]) {
      const from = new THREE.Vector3(x, BUS_Y + 1.7, z);
      const to = new THREE.Vector3(Math.sign(x) * 1.7, ropeTop, Math.sign(z) * 1.7);
      const len = from.distanceTo(to);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 5), rope);
      c.position.copy(from).add(to).multiplyScalar(0.5);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      root.add(c);
    }
    // a pennant trailing off the back of the roof
    const pole = box(0.08, 2.2, 0.08, ink, 0, BUS_Y + 2.7, L / 2 - 0.5);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ color: 0x2fb3a6, side: THREE.DoubleSide }));
    flag.rotation.y = Math.PI / 2;
    flag.position.set(0, BUS_Y + 3.3, L / 2 + 0.6);
    root.add(flag);
    this.flag = flag;
    this.pole = pole;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    this.t = 0;
  }

  /** Place the bus for time t; hidden once it has left the route. */
  update(route, t, dt, visible = true) {
    const root = this.root;
    if (!route || !visible || t > route.duration + 0.5) {
      root.visible = false;
      return;
    }
    this.t += dt;
    const p = busPosAt(route, t);
    root.visible = true;
    // gentle bob and sway, so it reads as hanging from the balloon
    root.position.set(p.x, p.y + Math.sin(this.t * 0.9) * 0.6, p.z);
    root.rotation.set(Math.sin(this.t * 0.7) * 0.025, -route.heading, Math.sin(this.t * 1.1) * 0.03);
    const f = 0.85 + Math.sin(this.t * 13) * 0.15 + Math.sin(this.t * 31) * 0.08;
    this.flame.scale.set(f, f * 1.2, f);
    this.flag.rotation.x = Math.sin(this.t * 6) * 0.25;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.root.parent) this.root.parent.remove(this.root);
  }
}
