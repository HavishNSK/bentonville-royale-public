// BENTONVILLE ROYALE — Crystal Bridges: entrances and the bot waypoint graph (pure; no three.js).
//
// The museum is a stack of oriented boxes on three levels (crest, main, lower), not an OSM
// "shell" building, so bots cannot use Bots._doorRoute's door logic for it. Instead:
//
//   const nav = createSiteNav()
//   nav.inside(x, z, y)                     -> pavilion or null
//   nav.route(fx, fz, fy, gx, gz, gy, P, K, max) -> waypoint count written to P (x, z pairs)
//                                              and K (1 = narrow: door / stair, 0 = open floor)
//
// Routes run over a hand-placed graph whose every edge is a straight, walkable leg (checked by
// tests/crystal-bridges-nav.test.mjs with the same walk the visitor-route tests use). Outside
// the museum the graph starts at the three entrances' approach points.

import { PAVILIONS, LEVEL, pavilionAt } from './site.js';

/**
 * The three public entrances (the doors themselves are spans in site.js PAVILIONS):
 *   main    — east colonnade on the crest, down the Entrance Hall stair to the lobby
 *   south   — the South Lobby door at the foot of the lawn path from the Art Trail
 *   library — the upper east door of the library, on the crest-side ramp
 * pv / side / a..b name the door span; out is the approach point outside (crest or path).
 */
export const ENTRANCES = Object.freeze([
  { id: 'main', name: 'Main Entrance', pv: 'entry-tower', side: 'e', a: -242, b: -236, sill: LEVEL.CREST, sign: 'CRYSTAL BRIDGES', sub: 'MAIN ENTRANCE' },
  { id: 'south', name: 'South Entrance', pv: 'south-lobby', side: 's', a: -4, b: 6, sill: LEVEL.MAIN, sign: 'SOUTH ENTRANCE', sub: 'CAFÉ · GREAT HALL' },
  { id: 'library', name: 'Library Entrance', pv: 'library', side: 'e', a: -214, b: -206, sill: LEVEL.MAIN + 6, sign: 'LIBRARY ENTRANCE', sub: 'GALLERIES BELOW' },
]);

const M = LEVEL.MAIN;
const L = LEVEL.LOWER;
const LIB = LEVEL.MAIN + 6;

// [id, x, z, y, narrow]
const NODES = [
  // main entrance: colonnade -> door -> down the stair hall -> lobby
  ['main-out', 64, -239, LEVEL.CREST, 0],
  ['main-door', 57.4, -239, LEVEL.CREST, 1],
  ['main-stair', 47, -239, -3.5, 1],
  ['main-foot', 37.5, -239, M, 1],
  ['tower-n', 36, -244, M, 0],
  ['lobby-se', 35, -251, M, 0],
  ['lobby', 26, -259, M, 0],
  ['lobby-s', 24, -249, M, 0],
  ['lobby-w', 17, -257, M, 0],
  ['lobby-ne', 35, -268, M, 0],
  // Great Hall Corridor, library stair, library entrance
  ['corridor-n', 23, -238, M, 0],
  ['corridor-mid', 21, -212, M, 0],
  ['corridor-s', 21, -186, M, 0],
  ['ramp-foot', 31.5, -186.3, M, 1],
  ['ramp-top', 31.5, -210.4, LIB, 1],
  ['lib-in', 31.5, -212.2, LIB, 1],
  ['library', 27, -224, LIB, 0],
  ['lib-door', 35.2, -211.5, LIB, 1],
  ['lib-out', 44, -211.5, -0.3, 0],
  // south entrance, café, Great Hall
  ['south-out', 1, -150, -4, 0],
  ['south-door', 1, -157, M, 1],
  ['south-in', 1, -162, M, 0],
  ['sl-c', 1, -167, M, 0],
  ['sl-e', 19, -167, M, 0],
  ['sl-w', -24, -167, M, 0],
  ['great-hall-s', -24, -180, M, 0],
  ['great-hall', -26, -190, M, 0],
  // Eleven, West Stair, Contemporary
  ['eleven-e', 8, -257, M, 0],
  ['eleven-w', -34, -257, M, 0],
  ['wt-landing', -45, -253, M, 0],
  ['wt-top', -52.5, -252.6, M, 1],
  ['wt-foot', -52.5, -271, L, 1],
  ['contemp-s', -44, -278, L, 0],
  ['contemp-mid', -42, -305, L, 0],
  ['contemp-n', -44, -338, L, 0],
  // Early American galleries
  ['ea1', 35, -284, M, 0],
  ['ea1-n', 35.5, -296, M, 0],
  ['terrace', 40, -300, M, 0],
  ['ea2', 44, -318, M, 0],
];

const EDGES = [
  ['main-out', 'main-door'], ['main-door', 'main-stair'], ['main-stair', 'main-foot'], ['main-foot', 'tower-n'],
  ['tower-n', 'lobby-se'], ['lobby-se', 'lobby'], ['lobby-se', 'lobby-s'], ['lobby', 'lobby-s'], ['lobby', 'lobby-w'],
  ['lobby', 'lobby-ne'], ['lobby-se', 'lobby-ne'],
  ['lobby-s', 'corridor-n'], ['corridor-n', 'corridor-mid'], ['corridor-mid', 'corridor-s'],
  ['corridor-s', 'ramp-foot'], ['ramp-foot', 'ramp-top'], ['ramp-top', 'lib-in'], ['lib-in', 'library'], ['lib-in', 'lib-door'],
  ['lib-door', 'lib-out'],
  ['south-out', 'south-door'], ['south-door', 'south-in'], ['south-in', 'sl-c'], ['sl-c', 'sl-e'], ['sl-c', 'sl-w'],
  ['sl-e', 'corridor-s'], ['sl-w', 'great-hall-s'], ['great-hall-s', 'great-hall'],
  ['lobby-w', 'eleven-e'], ['eleven-e', 'eleven-w'], ['eleven-w', 'wt-landing'], ['wt-landing', 'wt-top'], ['wt-top', 'wt-foot'],
  ['wt-foot', 'contemp-s'], ['contemp-s', 'contemp-mid'], ['contemp-mid', 'contemp-n'],
  ['lobby-ne', 'ea1'], ['ea1', 'ea1-n'], ['ea1-n', 'terrace'], ['terrace', 'ea2'],
];

/** Approach points outside each entrance (the graph's way in from the rest of the map). */
const OUTSIDE = ['main-out', 'south-out', 'lib-out'];

export const NAV = Object.freeze({
  nodes: NODES.map(([id, x, z, y, k]) => Object.freeze({ id, x, z, y, k })),
  edges: EDGES,
  outside: OUTSIDE,
});

/** Distance from (x, z) to segment a-b. */
export function segDist(x, z, ax, az, bx, bz) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)) : 0;
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
}

/** Shortest distance from (x, z) to any graph edge (furniture keeps clear of the bot lanes). */
export function navClearance(x, z) {
  const byId = new Map(NAV.nodes.map((n) => [n.id, n]));
  let best = Infinity;
  for (const [a, b] of NAV.edges) {
    const p = byId.get(a);
    const q = byId.get(b);
    best = Math.min(best, segDist(x, z, p.x, p.z, q.x, q.z));
  }
  return best;
}

export function createSiteNav() {
  const nodes = NAV.nodes;
  const n = nodes.length;
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of NAV.edges) {
    const i = index.get(a);
    const j = index.get(b);
    const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z, nodes[i].y - nodes[j].y);
    adj[i].push(j, w);
    adj[j].push(i, w);
  }
  const outside = NAV.outside.map((id) => index.get(id));
  const pvOf = nodes.map((nd) => pavilionAt(nd.x, nd.z, nd.y));
  const dist = new Float64Array(n);
  const next = new Int32Array(n);
  const done = new Uint8Array(n);

  /** Pavilion a point at height y (null = any height) stands in, or null outside the museum. */
  const inside = (x, z, y = null) => pavilionAt(x, z, y);

  /** Seed cost of graph node i for a point (x, z, y) in pavilion pv, or Infinity if unrelated. */
  const seed = (i, x, z, y, pv) => {
    const nd = nodes[i];
    if (pv) {
      if (y != null && Math.abs(nd.y - y) > 3.2) return Infinity; // another storey
      const d = Math.hypot(nd.x - x, nd.z - z);
      return pvOf[i] === pv ? d : d + 40; // prefer nodes in the same room (straight walk)
    }
    return Math.hypot(nd.x - x, nd.z - z);
  };

  /**
   * Waypoints from (fx, fz, fy) to (gx, gz, gy) through the museum. Returns the count written
   * (0 when neither end is inside, or both stand in the same pavilion on the same level).
   */
  function route(fx, fz, fy, gx, gz, gy, P, K, max = 64) {
    const fpv = inside(fx, fz, fy);
    const gpv = inside(gx, gz, gy);
    if (!fpv && !gpv) return 0;
    if (fpv && fpv === gpv && (gy == null || Math.abs(fy - gy) < 2)) return 0;
    // Dijkstra from the goal side: seeds are the goal's nearby nodes (or the entrances).
    dist.fill(Infinity);
    next.fill(-1);
    done.fill(0);
    const goalSeeds = gpv ? nodes.map((_, i) => i) : outside;
    for (const i of goalSeeds) dist[i] = seed(i, gx, gz, gy, gpv);
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || !Number.isFinite(dist[u])) break;
      done[u] = 1;
      const a = adj[u];
      for (let k = 0; k < a.length; k += 2) {
        const v = a[k];
        const d = dist[u] + a[k + 1];
        if (d < dist[v]) {
          dist[v] = d;
          next[v] = u;
        }
      }
    }
    // start: the from side's best node (total = walk to it + its distance to the goal)
    const startSeeds = fpv ? nodes.map((_, i) => i) : outside;
    let s = -1;
    let sv = Infinity;
    for (const i of startSeeds) {
      const v = seed(i, fx, fz, fy, fpv) + dist[i];
      if (v < sv) {
        sv = v;
        s = i;
      }
    }
    if (s < 0 || !Number.isFinite(sv)) return 0;
    let c = 0;
    for (let i = s, guard = 0; i >= 0 && c < max && guard < n; i = next[i], guard++) {
      P[c * 2] = nodes[i].x;
      P[c * 2 + 1] = nodes[i].z;
      K[c] = nodes[i].k;
      c++;
    }
    return c;
  }

  return { inside, route, nodes, entrances: ENTRANCES };
}

export { PAVILIONS };
