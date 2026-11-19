// BENTONVILLE ROYALE — Bentonville High School kit: bot waypoint graph (pure, no three.js).
//
//   const nav = createKitNav(K, plans)       plans: buildPlan results (north, south)
//   nav.inside(x, z, y) -> room | null       nav.route(fx, fz, fy, gx, gz, gy, P, K, max) -> count
//
// Same interface as the Crystal Bridges graph (src/world/crystal-bridges/nav.js), which Bots.js uses
// through world.siteNav (inside / route). The graph is generated from the plans, not hand-placed:
//   - a node per room (long corridors: a chain of nodes every ~6 m along their centre line)
//   - a node per partition door (linked to the rooms on both sides) and per opening between two
//     open-plan rooms (both walls: false) that share an edge
//   - stair flights (every K.stairs zone): a node a step beyond each end; flight ends that meet on a
//     landing are linked; the ends link to the room they land in
//   - exterior doors (plan 'extDoor' zones): an outside node (an entrance) and an inside node
// Waypoint kinds written to K: 1 (walk), as the Crystal Bridges graph does.

const STEP = 6; // corridor node spacing (m)

export function createKitNav(K, plans) {
  const nodes = []; // { x, z, y, room }
  const adj = [];
  const add = (x, z, y, room = null) => {
    nodes.push({ x, z, y, room, k: 1 });
    adj.push([]);
    return nodes.length - 1;
  };
  const link = (i, j) => {
    if (i < 0 || j < 0 || i === j) return;
    const a = nodes[i];
    const b = nodes[j];
    const w = Math.hypot(a.x - b.x, a.z - b.z, (a.y - b.y) * 1.5);
    adj[i].push(j, w);
    adj[j].push(i, w);
  };

  const rooms = [];
  for (const p of plans) for (const r of p.rooms) if (r.kind !== 'atrium' && r.floor !== 'none-upper') rooms.push({ r, plan: p });
  const roomNodes = new Map(); // room -> [node indices]
  for (const { r, plan } of rooms) {
    const y = plan.levelY(r.level);
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const ids = [];
    if (r.kind === 'corridor' && Math.max(w, d) > STEP * 1.5) {
      const along = w > d;
      const len = along ? w : d;
      const n = Math.max(2, Math.round(len / STEP));
      for (let i = 0; i <= n; i++) {
        const t = 0.04 + (0.92 * i) / n;
        ids.push(add(along ? r.x0 + w * t : (r.x0 + r.x1) / 2, along ? (r.z0 + r.z1) / 2 : r.z0 + d * t, y, r));
        if (i) link(ids[i - 1], ids[i]);
      }
    } else ids.push(add((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, y, r));
    roomNodes.set(r, ids);
  }
  const nearestOf = (r, x, z) => {
    const ids = roomNodes.get(r);
    if (!ids) return -1;
    let best = -1;
    let bd = Infinity;
    for (const i of ids) {
      const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const planOf = new Map(rooms.map(({ r, plan }) => [r, plan]));
  const roomAtAny = (x, z, L, building) => {
    for (const p of plans) {
      if (building && p.name !== building) continue;
      const r = p.roomAt(x, z, L);
      if (r && roomNodes.has(r)) return r;
    }
    return null;
  };

  // partition doors
  for (const { r } of rooms) {
    for (const d of r.doors || []) {
      const L = d.level ?? r.level;
      const xs = d.side === 'x0' ? r.x0 : d.side === 'x1' ? r.x1 : null;
      const zs = d.side === 'z0' ? r.z0 : d.side === 'z1' ? r.z1 : null;
      const along = xs !== null ? [r.z0, r.z1] : [r.x0, r.x1];
      const c = d.at === 'mid' || d.at === undefined ? (along[0] + along[1]) / 2 : along[0] + d.at;
      const x = xs !== null ? xs : c;
      const z = zs !== null ? zs : c;
      const nx = d.side === 'x0' ? -1 : d.side === 'x1' ? 1 : 0;
      const nz = d.side === 'z0' ? -1 : d.side === 'z1' ? 1 : 0;
      const other = planOf.get(r).roomAt(x + nx * 0.6, z + nz * 0.6, L);
      const y = planOf.get(r).levelY(L);
      const di = add(x, z, y, null);
      link(di, nearestOf(r, x, z));
      if (other && roomNodes.has(other)) link(di, nearestOf(other, x, z));
    }
  }
  // openings between open-plan rooms that share an edge (no wall is built there)
  for (let i = 0; i < rooms.length; i++)
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i].r;
      const b = rooms[j].r;
      if (a.walls || b.walls || a.level !== b.level || rooms[i].plan !== rooms[j].plan) continue;
      const y = rooms[i].plan.levelY(a.level);
      const ox0 = Math.max(a.x0, b.x0);
      const ox1 = Math.min(a.x1, b.x1);
      const oz0 = Math.max(a.z0, b.z0);
      const oz1 = Math.min(a.z1, b.z1);
      let p = null;
      if (Math.abs(a.x1 - b.x0) < 0.05 || Math.abs(b.x1 - a.x0) < 0.05) {
        if (oz1 - oz0 > 1) p = [Math.abs(a.x1 - b.x0) < 0.05 ? a.x1 : a.x0, (oz0 + oz1) / 2];
      } else if (Math.abs(a.z1 - b.z0) < 0.05 || Math.abs(b.z1 - a.z0) < 0.05) {
        if (ox1 - ox0 > 1) p = [(ox0 + ox1) / 2, Math.abs(a.z1 - b.z0) < 0.05 ? a.z1 : a.z0];
      }
      if (!p) continue;
      const k = add(p[0], p[1], y, null);
      link(k, nearestOf(a, p[0], p[1]));
      link(k, nearestOf(b, p[0], p[1]));
    }
  // stairs: every flight the kit built
  const ends = [];
  for (const s of K.zones) {
    if (s.kind !== 'stair' || !s.a || !s.b) continue; // flights only (stairwell rooms share the kind)
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const l = Math.hypot(dx, dz) || 1;
    const lo = add(s.a[0] - (dx / l) * 0.9, s.a[1] - (dz / l) * 0.9, s.y0, null);
    const hi = add(s.b[0] + (dx / l) * 0.9, s.b[1] + (dz / l) * 0.9, s.y1, null);
    link(lo, hi);
    ends.push(lo, hi);
  }
  for (let i = 0; i < ends.length; i++)
    for (let j = i + 1; j < ends.length; j++) {
      const a = nodes[ends[i]];
      const b = nodes[ends[j]];
      if (Math.abs(a.y - b.y) < 0.2 && Math.hypot(a.x - b.x, a.z - b.z) < 4.5) link(ends[i], ends[j]);
    }
  const levelOf = (y) => Math.round(y / 4.4);
  for (const e of ends) {
    const nd = nodes[e];
    const r = roomAtAny(nd.x, nd.z, levelOf(nd.y));
    if (r && Math.abs(planOf.get(r).levelY(r.level) - nd.y) < 0.3) link(e, nearestOf(r, nd.x, nd.z));
  }
  // exterior doors: outside entrance nodes
  const outside = [];
  for (const z of K.zones) {
    if (z.kind !== 'extDoor') continue;
    const o = add(z.x + z.nx * 1.4, z.z + z.nz * 1.4, z.y, null);
    const i = add(z.x - z.nx * 1.2, z.z - z.nz * 1.2, z.y, null);
    link(o, i);
    const r = roomAtAny(z.x - z.nx * 1.5, z.z - z.nz * 1.5, z.level, z.building);
    if (r) link(i, nearestOf(r, z.x, z.z));
    outside.push(o);
  }

  const n = nodes.length;
  const dist = new Float64Array(n);
  const next = new Int32Array(n);
  const done = new Uint8Array(n);
  const heap = [];
  const push = (i) => {
    heap.push(i);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[k]]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  const inside = (x, z, y = null) => {
    const L = y == null ? 0 : Math.max(0, Math.round(y / 4.4));
    for (const p of plans) if (p.inside(x, z)) return roomAtAny(x, z, L, p.name) || p;
    return null;
  };
  const seed = (i, x, z, y, room) => {
    const nd = nodes[i];
    if (room) {
      if (y != null && Math.abs(nd.y - y) > 3.2) return Infinity;
      const d = Math.hypot(nd.x - x, nd.z - z);
      return nd.room === room ? d : d + 40;
    }
    return Math.hypot(nd.x - x, nd.z - z);
  };

  /** Graph nodes a point inside can walk to directly: its room's nodes, else the nodes within 12 m on its level. */
  const seedsNear = (x, z, y, room) => {
    const own = roomNodes.get(room);
    if (own && own.length) return own;
    const out = [];
    for (let i = 0; i < n; i++) if ((y == null || Math.abs(nodes[i].y - y) < 2.5) && Math.hypot(nodes[i].x - x, nodes[i].z - z) < 12) out.push(i);
    return out;
  };

  function route(fx, fz, fy, gx, gz, gy, P, KK, max = 64) {
    const fr = inside(fx, fz, fy);
    const gr = inside(gx, gz, gy);
    if (!fr && !gr) return 0;
    if (fr && fr === gr && (gy == null || Math.abs(fy - gy) < 2)) return 0;
    dist.fill(Infinity);
    next.fill(-1);
    done.fill(0);
    // a goal in the OTHER building: leave by the entrance nearest it (outdoors the bot re-plans)
    const bldg = (r) => (r && r.rooms ? r : plans.find((p) => p.rooms.includes(r)));
    const across = fr && gr && bldg(fr) !== bldg(gr);
    const goalSeeds = gr && !across ? seedsNear(gx, gz, gy, gr) : outside;
    // Dijkstra with a binary heap (the graph has ~1-2k nodes)
    heap.length = 0;
    for (const i of goalSeeds) {
      dist[i] = across ? Math.hypot(nodes[i].x - gx, nodes[i].z - gz) : seed(i, gx, gz, gy, gr);
      if (Number.isFinite(dist[i])) push(i);
    }
    while (heap.length) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      const a = adj[u];
      for (let k = 0; k < a.length; k += 2) {
        const v = a[k];
        const d = dist[u] + a[k + 1];
        if (d < dist[v]) {
          dist[v] = d;
          next[v] = u;
          push(v);
        }
      }
    }
    const startSeeds = fr ? seedsNear(fx, fz, fy, fr) : outside;
    let s = -1;
    let sv = Infinity;
    for (const i of startSeeds) {
      const v = seed(i, fx, fz, fy, fr) + dist[i];
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
      KK[c] = 1;
      c++;
    }
    return c;
  }

  return { inside, route, nodes, adj, outside };
}

/** world.siteNav for two bespoke landmarks: each query goes to the graph that contains it. */
export function combineNav(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    inside: (x, z, y) => a.inside(x, z, y) || b.inside(x, z, y),
    route(fx, fz, fy, gx, gz, gy, P, K, max) {
      const useB = b.inside(fx, fz, fy) || b.inside(gx, gz, gy);
      return useB ? b.route(fx, fz, fy, gx, gz, gy, P, K, max) : a.route(fx, fz, fy, gx, gz, gy, P, K, max);
    },
  };
}
