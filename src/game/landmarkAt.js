import { BHS_KEY } from '../world/bhs/data.js';

/** The school's composed tile covers both buildings and the stadium. Its map pin
 * sits near the main building, too far from the north end for a circular trigger. */
export function landmarkAt(map, x, z) {
  const schoolRect = map.meta?.composition?.tiles?.find(tile => tile.key === BHS_KEY)?.rect;
  let nearest = null;
  let distance = Infinity;
  for (const [key, landmark] of Object.entries(map.landmarks || {})) {
    if (key === BHS_KEY && schoolRect) {
      const [west, north, east, south] = schoolRect;
      if (x >= west && x <= east && z >= north && z <= south) return landmark;
      continue;
    }
    const d = Math.hypot(landmark.x - x, landmark.z - z);
    if (d < Math.max(60, landmark.r * 1.2) && d < distance) {
      nearest = landmark;
      distance = d;
    }
  }
  return nearest;
}
