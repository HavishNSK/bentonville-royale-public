// BENTONVILLE ROYALE — free-build POI fast travel. Sandbox only: never used in a match.
import { DROP_ZONES } from '../core/config.js';

/** World metres: map-click must land this close to a POI centre to travel there. */
export const TRAVEL_CLICK_M = 90;

export function canFastTravel(game) {
  return !!(game && game.freeBuild && game.state === 'play' && !game.paused);
}

/** Named drop-zone POIs that exist in this map's landmarks, in DROP_ZONES order. */
export function poiTargets(landmarks, zones = DROP_ZONES) {
  if (!landmarks || typeof landmarks !== 'object') return [];
  const out = [];
  for (const z of zones) {
    const l = landmarks[z.key];
    if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.z)) continue;
    out.push({ key: z.key, label: z.label || l.n || z.key, x: l.x, z: l.z });
  }
  return out;
}

export function nearestPoi(targets, x, z, maxM = TRAVEL_CLICK_M) {
  if (!targets || !targets.length || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best = null;
  let bd = maxM;
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.z - z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Open ground next to (x, z), same search as free-build spawn. */
export function landAt(world, x, z, rng = Math.random) {
  let lx = x;
  let lz = z;
  if (world && typeof world.randomOpenPoint === 'function') {
    const roll = typeof rng === 'function' ? rng : Math.random;
    for (let i = 0; i < 40; i++) {
      const pt = world.randomOpenPoint(roll, x, z, 40, 6);
      if (!pt) continue;
      const blocked = world.polyAt && world.polyAt(pt.x, pt.z);
      const solid = world.blockedAt && world.blockedAt(pt.x, pt.z, 6);
      if (!blocked && !solid) {
        lx = pt.x;
        lz = pt.z;
        break;
      }
    }
  }
  const y = world && world.groundHeight ? world.groundHeight(lx, lz, 1e4) : 0;
  return { x: lx, y, z: lz };
}
