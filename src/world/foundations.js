// Shared foundation grading for collision, ground rendering, and prop placement.
// The original DEM remains unchanged: building registration always samples raw elevations.
export function foundationBand(c, sample) {
  let high = c.y0;
  for (let i = 0; i < c.n; i++) high = Math.max(high, sample(c.p[i * 2], c.p[i * 2 + 1]));
  return Math.min(32, Math.max(4, (high - c.y0) * 4 + 4));
}

/** Distance to the boundary; zero inside. Handles concave and rotated footprints. */
export function footprintDistance(c, x, z) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = c.n - 1; i < c.n; j = i++) {
    const ax = c.p[j * 2], az = c.p[j * 2 + 1];
    const bx = c.p[i * 2], bz = c.p[i * 2 + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return inside ? 0 : best;
}

export function foundationHeight(c, raw, distance) {
  if (distance === 0) return c.y0;
  if (distance >= c.foundationBand) return raw;
  const t = distance / c.foundationBand;
  const blend = t * t * (3 - 2 * t);
  // Cut a gradual approach; do not raise a neighbour's lower ground.
  return Math.min(raw, c.y0 + (raw - c.y0) * blend);
}
