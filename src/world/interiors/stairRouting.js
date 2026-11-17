// Walk around an authored stair shaft on a floor; flights themselves use explicit bot legs.
import { q, toLocal, toWorld } from './layout.js';

const CLEARANCE = 0.6;
const inside = (p, box) => p[0] > box.a0 && p[0] < box.a1 && p[1] > box.b0 && p[1] < box.b1;

function crosses(A, B, box) {
  let lo = 0, hi = 1;
  for (const [k, min, max] of [[0, box.a0, box.a1], [1, box.b0, box.b1]]) {
    const d = B[k] - A[k];
    if (Math.abs(d) < 1e-9) {
      if (A[k] <= min + 1e-6 || A[k] >= max - 1e-6) return false;
      continue;
    }
    let a = (min - A[k]) / d, b = (max - A[k]) / d;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a); hi = Math.min(hi, b);
  }
  return hi - lo > 1e-6 && hi > 1e-6 && lo < 1 - 1e-6;
}

/** World-space walking waypoints, including the destination, clear of the stair footprint. */
export function stairWalk(plan, x, z, gx, gz) {
  if (!plan.stairs || !plan.stairs.length) return [[gx, gz]];
  // one keep-out box per shaft (every storey's flight in a shaft shares its footprint)
  const boxes = [];
  for (const s of plan.stairs) {
    if (boxes.some((b) => b.s.a0 === s.a0 && b.s.b0 === s.b0 && b.s.a1 === s.a1 && b.s.b1 === s.b1)) continue;
    boxes.push({ s, a0: s.a0 - CLEARANCE, b0: s.b0 - CLEARANCE, a1: s.a1 + CLEARANCE, b1: s.b1 + CLEARANCE });
  }
  const start = toLocal(plan.frame, x, z), end = toLocal(plan.frame, gx, gz);
  // Authored doorway points may fall in a partition removed for a shaft. Move them to
  // its reserved side aisle. Flight endpoints never pass through this walking helper.
  const project = (p, near) => {
    const box = boxes.find((b) => inside(p, b));
    if (!box) return p;
    if (box.s.axis === 'a') return [p[0], Math.abs(near[1] - box.b0) <= Math.abs(near[1] - box.b1) ? box.b0 : box.b1];
    return [Math.abs(near[0] - box.a0) <= Math.abs(near[0] - box.a1) ? box.a0 : box.a1, p[1]];
  };
  const target = project(end, start);
  const source = project(start, target);
  const points = [source, target];
  for (const box of boxes) points.push([box.a0, box.b0], [box.a1, box.b0], [box.a1, box.b1], [box.a0, box.b1]);
  const dist = points.map(() => Infinity), prev = points.map(() => -1), seen = new Set();
  dist[0] = 0;
  for (let pass = 0; pass < points.length; pass++) {
    let i = -1;
    for (let j = 0; j < points.length; j++) if (!seen.has(j) && (i < 0 || dist[j] < dist[i])) i = j;
    if (i < 0 || !Number.isFinite(dist[i]) || i === 1) break;
    seen.add(i);
    for (let j = 0; j < points.length; j++) {
      if (i === j || boxes.some((box) => crosses(points[i], points[j], box))) continue;
      const dx = points[i][0] - points[j][0], dz = points[i][1] - points[j][1];
      const d = dist[i] + Math.sqrt(dx * dx + dz * dz);
      if (d < dist[j] - 1e-9) { dist[j] = d; prev[j] = i; }
    }
  }
  const out = [];
  for (let i = 1; i > 0; i = prev[i]) out.push(points[i]);
  out.reverse();
  if (source !== start) out.unshift(source);
  return out.map(([a, b]) => toWorld(plan.frame, q(a), q(b)));
}
