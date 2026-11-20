// BENTONVILLE ROYALE — Bentonville City Square: the surveyed downtown park (fountain, brick
// paths, mapped shade trees, its own loot). layout.json is the source of truth; evidence in
// docs/square/.
//
//   const sq = createSquare(world, mapData)   // reserves the park (generic scatter / loot stay
//                                             // out), registers the fountain colliders + loot
//   sq.pathHex(road)                          // brick colour for a path inside the park, or null
//   sq.addFlat(buf, addPolygon)               // brick plaza around the fountain (flat layer)
//   sq.treeSpots()                            // [{ id, x, z, scale }] surveyed trees
//   sq.buildMeshes(root)                      // three.js fountain (browser only)
//
// Pure (no three.js) apart from buildMeshes, so it can be tested in Node.

import LAYOUT from './layout.json' with { type: 'json' };

export const SQUARE_KEY = 'square';
export const BRICK = 0xa65a43;
export const BRICK_PLAZA = 0x9c5340;
export { LAYOUT };

const PARK_RE = /bentonville (city )?square/i;

/** The park polygon of the Square in the composed map, or null (other maps / tests). */
export function findParkPolygon(mapData) {
  const F = LAYOUT.fountain;
  for (const a of (mapData && mapData.areas) || []) {
    if (a.k !== 'park' || !a.p || a.p.length < 3) continue;
    if (pointInRing(a.p, F.x, F.z)) return a.p;
  }
  return null;
}

/** Is the composed map's Square where layout.json expects it (fountain inside the city park)? */
export function hasSquare(mapData) {
  const lm = mapData && mapData.landmarks && mapData.landmarks[SQUARE_KEY];
  if (!lm || !lm.found || !PARK_RE.test(lm.n || '')) return false;
  return !!findParkPolygon(mapData);
}

export function pointInRing(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
  const px = ax + dx * t - x;
  const pz = az + dz * t - z;
  return { d: Math.hypot(px, pz), nx: -px, nz: -pz };
}

/**
 * The Square's own walks: footways / paths with most segment midpoints inside the park polygon
 * (or within 3 m of its edge). Spokes that run out to the A Street promenade count; the
 * street sidewalks around the block do not.
 */
export function parkPaths(mapData, park) {
  return ((mapData && mapData.roads) || []).filter((r) => {
    if (!(r.k === 'footway' || r.k === 'path') || !r.p || r.p.length < 2) return false;
    let inside = 0;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const x = (r.p[i][0] + r.p[i + 1][0]) / 2;
      const z = (r.p[i][1] + r.p[i + 1][1]) / 2;
      if (pointInRing(park, x, z) || nearRing(park, x, z, 3)) inside++;
    }
    return inside * 2 > r.p.length - 1;
  });
}

function nearRing(pts, x, z, tol) {
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (distToSegment(x, z, pts[j][0], pts[j][1], pts[i][0], pts[i][1]).d <= tol) return true;
  }
  return false;
}

/**
 * Surveyed trees, trunks moved out of paths: a crown centre read from aerials is not exactly
 * the trunk, so a trunk within `clear` m of a park walk (or the fountain plaza) is pushed
 * straight away from it. Deterministic.
 */
export function placeTrees(paths, clear = 2) {
  const F = LAYOUT.fountain;
  return LAYOUT.trees.list.map((t) => {
    let x = t.x;
    let z = t.z;
    let moved = 0;
    for (let iter = 0; iter < 4; iter++) {
      let worst = null;
      for (const r of paths) {
        for (let i = 0; i + 1 < r.p.length; i++) {
          const s = distToSegment(x, z, r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1]);
          const need = clear + (r.w || 2.5) / 2;
          if (s.d < need && (!worst || need - s.d > worst.push)) worst = { ...s, push: need - s.d };
        }
      }
      const fd = Math.hypot(x - F.x, z - F.z);
      const fNeed = F.plazaR + clear;
      if (fd < fNeed && (!worst || fNeed - fd > worst.push)) worst = { d: fd, nx: x - F.x, nz: z - F.z, push: fNeed - fd };
      if (!worst) break;
      const n = Math.hypot(worst.nx, worst.nz) || 1;
      x += (worst.nx / n) * (worst.push + 0.05);
      z += (worst.nz / n) * (worst.push + 0.05);
      moved += worst.push;
    }
    // canopy model scale: the game's trees are ~3.5 m crown radius at scale 1
    const scale = Math.max(1, Math.min(1.8, t.crown / 3.5));
    return { id: t.id, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, scale, moved: Math.round(moved * 10) / 10 };
  });
}

export function createSquare(world, mapData) {
  const park = findParkPolygon(mapData);
  const F = LAYOUT.fountain;
  const paths = parkPaths(mapData, park);
  const pathSet = new Set(paths);
  const trees = placeTrees(paths);

  // the park is the Square's own: no random trees, rocks, benches, market stalls, cars or loot
  if (world.reserve) world.reserve(park);
  // ...and no reboot van parked on the lawn (src/game/Reboot.js). Other reserved landmarks (BHS)
  // park theirs inside on purpose, so this is the Square's own opt-out, not reservedAt.
  const prevNoVan = world.noVanAt;
  world.noVanAt = (x, z) => pointInRing(park, x, z) || (prevNoVan ? prevNoVan(x, z) : false);

  // buildings the imagery shows but the OSM extract lacks (layout.json buildings.list)
  if (Array.isArray(mapData.buildings)) {
    const have = new Set(mapData.buildings.map((b) => b.id));
    for (const b of LAYOUT.buildings.list) {
      if (have.has(b.id)) continue;
      mapData.buildings.push({ id: b.id, t: b.t, h: b.h, lv: b.lv, mat: b.mat, roof: b.roof, a: 0, hs: 'square-survey', p: b.p.map((q) => [q[0], q[1]]) });
    }
  }

  // fountain: basin rim (step-up height, you can stand on it) and the raised centre planter.
  // Infinite hp and no ref: not harvestable, not breakable, never removed.
  const colliders = [];
  if (world.addCircle) {
    colliders.push(world.addCircle(F.x, F.z, F.rimR, F.rimH, 'landmark', 'brick', Infinity, null));
    colliders.push(world.addCircle(F.x, F.z, F.planterR, F.planterH, 'landmark', 'brick', Infinity, null));
  }

  const ground = (x, z) => (world.surfaceHeight ? world.surfaceHeight(x, z) : 0);
  const loot = LAYOUT.loot.list.map((l) => ({ kind: l.kind, x: l.x, y: ground(l.x, l.z) + 0.02, z: l.z, yaw: l.yaw || 0, square: l.id }));
  world.fixedLoot = (world.fixedLoot || []).concat(loot);

  return {
    park,
    paths,
    trees,
    colliders,
    loot,
    pathHex(road) {
      return pathSet.has(road) ? BRICK : null;
    },
    addFlat(buf, addPolygon) {
      const n = 48;
      const ring = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ring.push([F.x + Math.cos(a) * F.plazaR, F.z + Math.sin(a) * F.plazaR]);
      }
      addPolygon(buf, ring, 0, BRICK_PLAZA);
    },
    treeSpots() {
      return trees;
    },
    async buildMeshes(root) {
      const { buildSquareMeshes } = await import('./meshes.js');
      return buildSquareMeshes({ root, world, layout: LAYOUT });
    },
  };
}
