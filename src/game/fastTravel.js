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

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * Gas stations as travel targets ({ key, label, x, z, gas }), labelled with their brand and where
 * they sit on the map ("Clam Oil (NW)"; north = -z; "Gas Station" when a station has no label).
 * `stations` from planGasStations, `bounds` the map's.
 */
export function gasTargets(stations, bounds) {
  if (!Array.isArray(stations) || !stations.length) return [];
  const cx = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
  const cz = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;
  const out = [];
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) continue;
    const ang = Math.atan2(s.x - cx, -(s.z - cz)); // 0 = north, clockwise
    const dir = COMPASS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    const name = typeof s.label === 'string' && s.label ? s.label : 'Gas Station';
    out.push({ key: s.key || 'gas' + i, dir, name, label: `${name} (${dir})`, x: s.x, z: s.z, gas: true });
  }
  // two of a brand in the same direction: number them, west to east (or north to south)
  const byDir = new Map();
  for (const g of out) byDir.set(g.label, [...(byDir.get(g.label) || []), g]);
  for (const list of byDir.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.x - b.x || a.z - b.z).forEach((g, k) => (g.label = `${g.name} (${g.dir} ${k + 1})`));
  }
  return out.sort((a, b) => a.label.localeCompare(b.label)); // listed in order (E, N, NW, SE 1, SE 2...)
}

/** Everything the sandbox map can send you to: the named POIs, then the gas stations. */
export function travelTargets(game) {
  if (!game || !game.world) return [];
  return [...poiTargets(game.world.landmarks), ...gasTargets(game.gasStations, game.world.bounds)];
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
export function landAt(world, x, z, rng = Math.random, radius = 40) {
  let lx = x;
  let lz = z;
  if (world && typeof world.randomOpenPoint === 'function') {
    const roll = typeof rng === 'function' ? rng : Math.random;
    for (let i = 0; i < 40; i++) {
      const pt = world.randomOpenPoint(roll, x, z, radius, 6);
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
