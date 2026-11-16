// BENTONVILLE ROYALE — guillotine room partition for building interiors (pure JS, no three.js).
//
// Rooms are rectangles in the footprint's oriented frame (see Interiors.frameOf): a = the long
// axis [0, L], b = across [0, W]. A recipe is a tree of cuts:
//   { leaf: true, kind, label }                        a room
//   { axis: 'a' | 'b', at, A, B }                     a straight wall at `at` along `axis`;
//                                                     A = the low side, B = the high side
// `at`: number >= 0 (m from the rect's low edge), number < 0 (m from its high edge),
// 'NN%' (of the rect), { abs } (absolute local coordinate) or { x, z } (world point).
// Walls are clipped to the shell's inner polygon (interval clipping), leaf rooms with less
// than MIN_ROOM_AREA m^2 inside the footprint are dropped (their cut is removed), cuts are
// nudged at least DOOR_CLEAR m away from exterior doors, and interior doors are added
// (each room to its best neighbour, then union-find until everything is connected).
//
// Determinism: only + - * / Math.sqrt / Math.round / Math.floor / comparisons; every local
// coordinate is quantised to 1/64 m; ties break on array index.

export const QUANT = 64;
export const q = (v) => Math.round(v * QUANT) / QUANT;

const MIN_ROOM_AREA = 4; // m^2 inside the footprint
const MIN_SIDE = 2;
const MIN_CLEAR = 0.75; // a room needs a point this far (m) from every wall
const ZONE_GAP = 1.0; // walls are left out this far (m) around an exterior doorway zone // a cut leaves at least this much on each side (m)
const DOOR_CLEAR = 1.5; // cuts keep this far (m) from an exterior doorway
const DOOR_EDGE = 0.45; // interior door keeps this far (m) from the ends of its wall piece
export const WALL_R = 0.1; // interior partition half thickness (capsule radius)

// ------------------------------------------------------------------ geometry

/** Point in polygon (flat [a, b, ...] array). */
export function inPoly(P, a, b) {
  const n = P.length >> 1;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ai = P[i * 2];
    const bi = P[i * 2 + 1];
    const aj = P[j * 2];
    const bj = P[j * 2 + 1];
    if (bi > b !== bj > b && a < ((aj - ai) * (b - bi)) / (bj - bi) + ai) inside = !inside;
  }
  return inside;
}

/** Signed shoelace area of a flat polygon. */
export function polyArea(P) {
  const n = P.length >> 1;
  let s = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) s += P[j * 2] * P[i * 2 + 1] - P[i * 2] * P[j * 2 + 1];
  return s / 2;
}

/** Squared distance from (a, b) to the polygon's boundary. */
export function polyEdgeDist2(P, a, b) {
  const n = P.length >> 1;
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const d = segDist2(P[j * 2], P[j * 2 + 1], P[i * 2], P[i * 2 + 1], a, b);
    if (d < best) best = d;
  }
  return best;
}

export function segDist2(ax, az, bx, bz, x, z) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = x - (ax + ex * t);
  const dz = z - (az + ez * t);
  return dx * dx + dz * dz;
}

/** Sutherland-Hodgman: polygon P (flat) clipped to the rect [a0, a1] x [b0, b1]. */
export function clipRect(P, a0, b0, a1, b1) {
  let cur = Array.from(P);
  const planes = [
    [0, a0, 1],
    [0, a1, -1],
    [1, b0, 1],
    [1, b1, -1],
  ];
  for (const [k, v, s] of planes) {
    const n = cur.length >> 1;
    if (!n) break;
    const out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pa = cur[i * 2];
      const pb = cur[i * 2 + 1];
      const qa = cur[j * 2];
      const qb = cur[j * 2 + 1];
      const dp = ((k === 0 ? pa : pb) - v) * s;
      const dq = ((k === 0 ? qa : qb) - v) * s;
      if (dp >= 0) out.push(pa, pb);
      if (dp >= 0 !== dq >= 0) {
        const t = dp / (dp - dq);
        out.push(pa + (qa - pa) * t, pb + (qb - pb) * t);
      }
    }
    cur = out;
  }
  return cur;
}

/** Parameter intervals [[t0, t1], ...] of segment A->B (local) inside polygon P. */
export function clipSegment(P, aa, ab, ba, bb) {
  const n = P.length >> 1;
  const da = ba - aa;
  const db = bb - ab;
  const ts = [0, 1];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pa = P[j * 2];
    const pb = P[j * 2 + 1];
    const ea = P[i * 2] - pa;
    const eb = P[i * 2 + 1] - pb;
    const den = da * eb - db * ea;
    if (den > -1e-12 && den < 1e-12) continue;
    const wa = pa - aa;
    const wb = pb - ab;
    const t = (wa * eb - wb * ea) / den;
    const s = (wa * db - wb * da) / den;
    if (t > 0 && t < 1 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k];
    const t1 = ts[k + 1];
    if (t1 - t0 < 1e-6) continue;
    const tm = (t0 + t1) / 2;
    if (!inPoly(P, aa + da * tm, ab + db * tm)) continue;
    const last = out[out.length - 1];
    if (last && t0 - last[1] < 1e-6) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

// ------------------------------------------------------------------ frame

export function toLocal(F, x, z) {
  const dx = x - F.ox;
  const dz = z - F.oz;
  return [dx * F.ux + dz * F.uz, dx * F.vx + dz * F.vz];
}

export function toWorld(F, a, b) {
  return [F.ox + F.ux * a + F.vx * b, F.oz + F.uz * a + F.vz * b];
}

// ------------------------------------------------------------------ builders

export const leaf = (kind, label) => ({ leaf: true, kind, label: label || null });
export const cut = (axis, at, A, B) => ({ axis, at, A, B });
/** parts: [[weight, node], ...] laid out in order along axis (nested cuts). */
export function row(axis, parts) {
  if (parts.length === 1) return parts[0][1];
  let tot = 0;
  for (const p of parts) tot += p[0];
  const pct = (parts[0][0] / tot) * 100;
  return cut(axis, pct + '%', parts[0][1], row(axis, parts.slice(1)));
}

// ------------------------------------------------------------------ partition

/**
 * Lay out one level.
 *   tree    recipe tree
 *   P       inner polygon in local coords (flat, quantised)
 *   F       frame { ox, oz, ux, uz, vx, vz, L, W }
 *   zones   exterior door zones [{ a0, b0, a1, b1, a, b }] (local bbox of the doorway + 1 m inside)
 *   hash    (salt) => [0, 1) deterministic per building
 * Returns { rooms, pieces, cuts } where rooms = [{ kind, label, a0, b0, a1, b1, area, poly }]
 * (dropped rooms removed, indices compact) and pieces = wall pieces
 * [{ axis, c, s0, s1, ra, rb }] (local; ra = room on the low side, rb the high side; -1 none).
 */
export function partition(tree, P, F, zones) {
  const leaves = [];
  const cuts = [];
  const resolveAt = (at, axis, lo, hi) => {
    if (typeof at === 'number') return at >= 0 ? lo + at : hi + at;
    if (typeof at === 'string' && at.endsWith('%')) return lo + ((hi - lo) * parseFloat(at)) / 100;
    if (at && typeof at.abs === 'number') return at.abs;
    if (at && typeof at.x === 'number') {
      const l = toLocal(F, at.x, at.z);
      return axis === 'a' ? l[0] : l[1];
    }
    return (lo + hi) / 2;
  };
  const walk = (node, a0, b0, a1, b1, parent) => {
    if (!node) return;
    if (node.leaf) {
      leaves.push({ kind: node.kind, label: node.label, a0, b0, a1, b1, parent, dropped: false });
      return;
    }
    const isA = node.axis === 'a';
    const lo = isA ? a0 : b0;
    const hi = isA ? a1 : b1;
    const s0 = isA ? b0 : a0;
    const s1 = isA ? b1 : a1;
    let c = resolveAt(node.at, node.axis, lo, hi);
    if (hi - lo < MIN_SIDE * 2) {
      // too small to cut: the side the cut favours takes the whole rect
      walk(c - lo >= hi - c ? node.A : node.B, a0, b0, a1, b1, parent);
      return;
    }
    const cl = (v) => (v < lo + MIN_SIDE ? lo + MIN_SIDE : v > hi - MIN_SIDE ? hi - MIN_SIDE : v);
    c = cl(c);
    // keep away from exterior doorways (a few passes: moving off one may land on another)
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const z of zones) {
        const zl = isA ? z.a0 : z.b0;
        const zh = isA ? z.a1 : z.b1;
        const ol = isA ? z.b0 : z.a0;
        const oh = isA ? z.b1 : z.a1;
        if (oh < s0 - 0.3 || ol > s1 + 0.3) continue; // the wall does not reach this door
        if (c <= zl - DOOR_CLEAR || c >= zh + DOOR_CLEAR) continue;
        const down = zl - DOOR_CLEAR;
        const up = zh + DOOR_CLEAR;
        const okDown = down >= lo + MIN_SIDE;
        const okUp = up <= hi - MIN_SIDE;
        let nc = c;
        if (okDown && okUp) nc = c - down <= up - c ? down : up;
        else if (okDown) nc = down;
        else if (okUp) nc = up;
        if (nc !== c) {
          c = nc;
          moved = true;
        }
      }
      if (!moved) break;
    }
    c = q(c);
    const k = cuts.length;
    const cutRec = { axis: node.axis, c, s0, s1, removed: false, leafA: -1, leafB: -1 };
    cuts.push(cutRec);
    const nA = leaves.length;
    if (isA) walk(node.A, a0, b0, c, b1, k);
    else walk(node.A, a0, b0, a1, c, k);
    if (node.A && node.A.leaf && leaves.length === nA + 1) cutRec.leafA = nA;
    const nB = leaves.length;
    if (isA) walk(node.B, c, b0, a1, b1, k);
    else walk(node.B, a0, c, a1, b1, k);
    if (node.B && node.B.leaf && leaves.length === nB + 1) cutRec.leafB = nB;
  };
  walk(tree, 0, 0, q(F.L), q(F.W), -1);

  // area inside the footprint; drop tiny leaves (their cut goes, the sibling leaf grows)
  for (const lf of leaves) {
    lf.poly = clipRect(P, lf.a0, lf.b0, lf.a1, lf.b1);
    lf.area = Math.abs(polyArea(lf.poly));
    lf.clear = lf.area >= MIN_ROOM_AREA ? roomPoint(lf, P)[2] : 0;
  }
  for (let i = 0; i < leaves.length; i++) {
    const lf = leaves[i];
    // too small, or only slivers too narrow to stand in
    if (lf.area >= MIN_ROOM_AREA && lf.clear >= MIN_CLEAR) continue;
    lf.dropped = true;
    if (lf.parent < 0) continue;
    const cr = cuts[lf.parent];
    if (cr.removed) continue;
    cr.removed = true;
    const sib = cr.leafA === i ? cr.leafB : cr.leafB === i ? cr.leafA : -1;
    if (sib >= 0 && !leaves[sib].dropped) {
      const s = leaves[sib];
      s.a0 = Math.min(s.a0, lf.a0);
      s.b0 = Math.min(s.b0, lf.b0);
      s.a1 = Math.max(s.a1, lf.a1);
      s.b1 = Math.max(s.b1, lf.b1);
      s.poly = clipRect(P, s.a0, s.b0, s.a1, s.b1);
      s.area = Math.abs(polyArea(s.poly));
    }
  }
  const rooms = [];
  const roomOf = new Int32Array(leaves.length).fill(-1);
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i].dropped) continue;
    roomOf[i] = rooms.length;
    rooms.push(leaves[i]);
  }
  // which room holds local point (a, b) (rect test; -1 none)
  const roomAt = (a, b) => {
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      if (a >= r.a0 - 1e-6 && a <= r.a1 + 1e-6 && b >= r.b0 - 1e-6 && b <= r.b1 + 1e-6) return i;
    }
    return -1;
  };

  // wall pieces: each kept cut, clipped to the footprint, split where the rooms on either side change
  const pieces = [];
  for (const cr of cuts) {
    if (cr.removed) continue;
    const isA = cr.axis === 'a';
    const P0 = isA ? [cr.c, cr.s0] : [cr.s0, cr.c];
    const P1 = isA ? [cr.c, cr.s1] : [cr.s1, cr.c];
    const iv = clipSegment(P, P0[0], P0[1], P1[0], P1[1]);
    const len = cr.s1 - cr.s0;
    // breakpoints from the room rects touching the line
    const bp = [];
    for (const r of rooms) {
      const lo = isA ? r.a0 : r.b0;
      const hi = isA ? r.a1 : r.b1;
      if (Math.abs(lo - cr.c) > 1e-6 && Math.abs(hi - cr.c) > 1e-6) continue;
      bp.push(isA ? r.b0 : r.a0, isA ? r.b1 : r.a1);
    }
    // leave the wall out in front of exterior doorways (cuts that could not be nudged clear)
    const ivs = [];
    for (const [t0, t1] of iv) {
      let parts = [[cr.s0 + len * t0, cr.s0 + len * t1]];
      for (const z of zones) {
        const zl = (isA ? z.a0 : z.b0) - ZONE_GAP;
        const zh = (isA ? z.a1 : z.b1) + ZONE_GAP;
        if (cr.c <= zl || cr.c >= zh) continue;
        const ol = (isA ? z.b0 : z.a0) - ZONE_GAP;
        const oh = (isA ? z.b1 : z.a1) + ZONE_GAP;
        const next = [];
        for (const [u0, u1] of parts) {
          if (oh <= u0 || ol >= u1) {
            next.push([u0, u1]);
            continue;
          }
          if (ol > u0) next.push([u0, ol]);
          next.push([Math.max(u0, ol), Math.min(u1, oh), true]);
          if (oh < u1) next.push([oh, u1]);
        }
        parts = next;
      }
      for (const pt of parts) ivs.push(pt);
    }
    for (const [v0, v1, gap] of ivs) {
      const s0 = q(v0);
      const s1 = q(v1);
      if (s1 - s0 < 1e-3) continue;
      if (gap) {
        const um = (s0 + s1) / 2;
        const ra = isA ? roomAt(cr.c - 0.05, um) : roomAt(um, cr.c - 0.05);
        const rb = isA ? roomAt(cr.c + 0.05, um) : roomAt(um, cr.c + 0.05);
        pieces.push({ axis: cr.axis, c: cr.c, s0, s1, ra, rb, cutRec: cr, door: null, open: true, gap: true });
        continue;
      }
      const br = [s0, s1];
      for (const v of bp) if (v > s0 + 1e-6 && v < s1 - 1e-6) br.push(v);
      br.sort((x, y) => x - y);
      for (let k = 0; k + 1 < br.length; k++) {
        const u0 = br[k];
        const u1 = br[k + 1];
        if (u1 - u0 < 1e-3) continue;
        const um = (u0 + u1) / 2;
        const ra = isA ? roomAt(cr.c - 0.05, um) : roomAt(um, cr.c - 0.05);
        const rb = isA ? roomAt(cr.c + 0.05, um) : roomAt(um, cr.c + 0.05);
        const last = pieces[pieces.length - 1];
        if (last && !last.open && last.cutRec === cr && last.ra === ra && last.rb === rb && Math.abs(last.s1 - u0) < 1e-6) last.s1 = u1;
        else pieces.push({ axis: cr.axis, c: cr.c, s0: u0, s1: u1, ra, rb, cutRec: cr, door: null, open: false });
      }
    }
  }
  // door run per piece: the longest span where both sides are footprint interior
  for (const p of pieces) {
    delete p.cutRec;
    p.run = null;
    if (p.open) continue;
    const isA = p.axis === 'a';
    const st = 0.125;
    let r0 = -1;
    let best = null;
    for (let u = p.s0; ; u += st) {
      const uu = u > p.s1 ? p.s1 : u;
      const ok =
        (isA ? inPoly(P, p.c - 0.7, uu) && inPoly(P, p.c + 0.7, uu) : inPoly(P, uu, p.c - 0.7) && inPoly(P, uu, p.c + 0.7));
      if (ok && r0 < 0) r0 = uu;
      if ((!ok || uu >= p.s1) && r0 >= 0) {
        const r1 = ok ? uu : uu - st;
        if (!best || r1 - r0 > best[1] - best[0] + 1e-9) best = [r0, r1];
        r0 = -1;
      }
      if (uu >= p.s1) break;
    }
    // the run is measured on samples; the door edge margin keeps the opening inside it
    if (best) p.run = [q(best[0]), q(best[1])];
  }
  return { rooms, pieces, roomAt };
}

/**
 * Interior doors: every room to its best neighbour, then union-find until connected.
 * Mutates pieces (piece.door = { s, w } or piece.open = true when no door fits).
 * widthOf(k) -> door width for the k-th door.
 */
export function placeDoors(rooms, pieces, widthOf, isHub) {
  const parent = rooms.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (i, j) => {
    const a = find(i);
    const b = find(j);
    if (a === b) return false;
    if (a < b) parent[b] = a;
    else parent[a] = b;
    return true;
  };
  let nDoors = 0;
  for (const p of pieces) if (p.open && p.ra >= 0 && p.rb >= 0) join(p.ra, p.rb);
  const fits = (p, w) => !!p.run && p.run[1] - p.run[0] >= w + 2 * DOOR_EDGE - 0.25;
  const addDoor = (p) => {
    let w = widthOf(nDoors++);
    if (!fits(p, w)) w = 1.6;
    let c = (p.run[0] + p.run[1]) / 2;
    // keep the opening inside the piece's solid span (DOOR_EDGE from its ends)
    if (c - w / 2 < p.s0 + DOOR_EDGE) c = p.s0 + DOOR_EDGE + w / 2;
    if (c + w / 2 > p.s1 - DOOR_EDGE) c = p.s1 - DOOR_EDGE - w / 2;
    p.door = { s: q(c), w: q(w) };
    join(p.ra, p.rb);
  };
  const cand = (p) => p.ra >= 0 && p.rb >= 0 && p.ra !== p.rb && !p.door && !p.open;
  // 1. each room to its best neighbour (hubs = corridors / halls / lobbies first, then the longest wall)
  for (let r = 0; r < rooms.length; r++) {
    let best = null;
    let bestV = -Infinity;
    let has = false;
    for (const p of pieces) {
      if (p.ra !== r && p.rb !== r) continue;
      if (p.door) has = true;
      if (!cand(p)) continue;
      const o = p.ra === r ? p.rb : p.ra;
      const len = p.run ? p.run[1] - p.run[0] : 0;
      if (!fits(p, 1.6)) continue;
      const v = (isHub(rooms[o]) ? 1000 : 0) + len;
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    if (has || !best || find(best.ra) === find(best.rb)) continue;
    addDoor(best);
  }
  // 2. union until connected: longest fitting wall between two components; else open the longest wall
  for (let guard = 0; guard < rooms.length * 2; guard++) {
    let best = null;
    let bestV = -Infinity;
    let open = null;
    let openV = -Infinity;
    for (const p of pieces) {
      if (!cand(p) || find(p.ra) === find(p.rb)) continue;
      const len = p.run ? p.run[1] - p.run[0] : 0;
      if (fits(p, 1.6) && len > bestV) {
        bestV = len;
        best = p;
      }
      if (len > openV) {
        openV = len;
        open = p;
      }
    }
    if (best) addDoor(best);
    else if (open) {
      // no wall between these two groups is long enough for a door: leave that wall out
      open.open = true;
      join(open.ra, open.rb);
    } else break;
  }
}

/** Best standable point of a room (local): the rect centre, else the sample farthest from the walls. */
export function roomPoint(r, P) {
  const ca = (r.a0 + r.a1) / 2;
  const cb = (r.b0 + r.b1) / 2;
  const clearance = (a, b) => {
    if (!inPoly(P, a, b)) return -1;
    const de = Math.sqrt(polyEdgeDist2(P, a, b));
    const dr = Math.min(a - r.a0, r.a1 - a, b - r.b0, r.b1 - b);
    return de < dr ? de : dr;
  };
  const c0 = clearance(ca, cb);
  if (c0 >= 1.0) return [q(ca), q(cb), c0];
  const span = Math.max(r.a1 - r.a0, r.b1 - r.b0);
  const step = Math.max(0.5, span / 40);
  let best = [ca, cb];
  let bestV = -Infinity;
  let bestC = c0;
  for (let b = r.b0 + step / 2; b < r.b1; b += step) {
    for (let a = r.a0 + step / 2; a < r.a1; a += step) {
      const c = clearance(a, b);
      if (c < 0) continue;
      const dc = (a - ca) * (a - ca) + (b - cb) * (b - cb);
      const v = (c > 1.5 ? 1.5 : c) * 1000 - dc * 1e-3;
      if (v > bestV) {
        bestV = v;
        best = [a, b];
        bestC = c;
      }
    }
  }
  return [q(best[0]), q(best[1]), bestC];
}
