// BENTONVILLE ROYALE — Crystal Bridges Museum of American Art: the bespoke landmark.
//
//   const cb = createCrystalBridges(world, mapData)   // BEFORE any other world registration:
//                                                      // sets the ravine heightfield, reserves the
//                                                      // site, registers ponds, boxes and loot
//   cb.skipBuilding(id) / cb.skipFlat(points)          // what the generic map layers leave out
//   cb.treeSpots()                                      // [{ x, z, pine }] forest on the slopes
//   const view = cb.buildMeshes(root)                   // three.js (browser only)
//   view.update(dt) ; view.hideCollider(c) ; view.showCollider(c)
//
// Layout: site.js (cites docs/crystal-bridges-layout.md). Colliders: build.js. Meshes: meshes.js.

import { buildSite } from './build.js';
import { PAVILIONS, PADS, TILE, LEVEL, WALKER_LANDING, pointInPolygon, distToPolygon, bowMargin } from './site.js';

export const CB_KEY = 'crystal_bridges';

/** Is the composed map's crystal_bridges tile where site.js expects it? */
export function hasCrystalBridges(mapData) {
  const lm = mapData && mapData.landmarks && mapData.landmarks[CB_KEY];
  return !!(lm && lm.found && lm.x > TILE.x0 && lm.x < TILE.x1 && lm.z > TILE.z0 && lm.z < TILE.z1);
}

export function createCrystalBridges(world, mapData) {
  const lm = mapData.landmarks[CB_KEY];
  const skipIds = new Set(lm.ids || []);
  const site = buildSite(world, mapData);

  const inTile = (x, z) => x > TILE.x0 && x < TILE.x1 && z > TILE.z0 && z < TILE.z1;
  return {
    site,
    skipBuilding(id) {
      return skipIds.has(id);
    },
    /** A flat map feature (road ribbon / land-cover polygon / old pond) that would float over the ravine. */
    skipFlat(points, kind) {
      if (kind === 'water' && points.some(([x, z]) => inTile(x, z))) return true; // replaced by the three ponds
      for (const [x, z] of points) if (inTile(x, z) && world.terrainHeight(x, z) < -0.25) return true;
      return false;
    },
    treeSpots() {
      return forest(world, site);
    },
    async buildMeshes(root) {
      const { buildSiteMeshes } = await import('./meshes.js');
      return buildSiteMeshes({ root, world, site });
    },
  };
}

/**
 * Oaks and dogwoods on the ravine slopes, pines on the crest (Outside Guide / audio tour): a
 * jittered grid, denser on slopes, never in water, pavilions, pads, Walker Landing or the decks.
 */
function forest(world, site) {
  const out = [];
  let seed = 20111111; // opened 11/11/11
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const clear = (x, z) => {
    for (const pv of PAVILIONS) {
      if (x > pv.x0 - 4 - bowMargin(pv, 'w') && x < pv.x1 + 4 + bowMargin(pv, 'e') && z > pv.z0 - 4 && z < pv.z1 + 4) return false;
    }
    for (const pd of PADS) if (x > pd.x0 - 3 && x < pd.x1 + 3 && z > pd.z0 - 3 && z < pd.z1 + 3) return false;
    for (const pd of site.ponds) if (pointInPolygon(pd.p, x, z) || distToPolygon(pd.p, x, z) < 2.5) return false;
    if (Math.hypot(x - WALKER_LANDING.cx, z - WALKER_LANDING.cz) < WALKER_LANDING.r0 + WALKER_LANDING.tiers * WALKER_LANDING.step + 3) return false;
    for (const d of site.decks) {
      const ex = d.b[0] - d.a[0], ez = d.b[2] - d.a[2];
      const t = Math.max(0, Math.min(1, ((x - d.a[0]) * ex + (z - d.a[2]) * ez) / (ex * ex + ez * ez)));
      if (Math.hypot(d.a[0] + ex * t - x, d.a[2] + ez * t - z) < d.hw + 3) return false;
    }
    return true;
  };
  const step = 6.5;
  for (let z = TILE.z0 + 6; z < TILE.z1 - 6; z += step) {
    for (let x = TILE.x0 + 6; x < TILE.x1 - 6; x += step) {
      const px = x + (rnd() - 0.5) * step * 0.9;
      const pz = z + (rnd() - 0.5) * step * 0.9;
      const y = world.terrainHeight(px, pz);
      const slope = 1 - world.terrainNormal(px, pz).y;
      const onSlope = y < -0.8 && y > LEVEL.NORTH_POND + 0.3;
      const keep = onSlope ? rnd() < 0.55 + Math.min(0.35, slope * 3) : rnd() < 0.16;
      if (!keep || !clear(px, pz)) continue;
      out.push({ x: px, z: pz, y, pine: !onSlope && rnd() < 0.6 });
    }
  }
  return out;
}

export { PAVILIONS, LEVEL };
