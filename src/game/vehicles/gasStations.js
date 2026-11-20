// BENTONVILLE ROYALE — gas stations: where they stand, what is solid there, which brand they fly.
//
// None of the real fuel stations in the raw OSM extract (data-raw/) fall inside the composed tile
// map (scripts/compose-map.mjs keeps only the cut-out POI tiles), so the stations are invented
// lots (each flying one of the made-up brands of gasBrands.js) picked from the map geometry: beside a street, on open ground (no building,
// road, path, stream, water, parking lot, pitch or bus loop), at least one in every quadrant of
// the map and STATION.minGap apart. Pure geometry over the map data: same spots on every machine.
//
//   const stations = planGasStations(world)      // right after `new World(mapData)`, BEFORE the
//                                                // world meshes: reserves each lot so trees,
//                                                // rocks and benches keep out of it
//   buildGasStations(world, stations, { scene, meshFactory })  // after the world meshes: the
//                                                // colliders, one mesh per station, a gas can
//   pumpNear(stations, x, z)                    // nearest pump spot
//
// Pumps (hp, fire, chain explosions) and the hand-held nozzle that refuels cars live in
// game/GasPumps.js; the per-station brand (sign, trim colours, map label) in gasBrands.js.
//
// Station-local frame: u along the street, v away from it (v = 0 is the lot's street-side edge,
// STATION.roadGap metres off the kerb). World = (ox, oz) + u * (cos yaw, sin yaw) + v * (-sin yaw,
// cos yaw): the same axes as an oriented World box with that yaw (boxColliders.js), and a mesh
// built with x = u, z = v gets rotation.y = -yaw.
//
// The art is an original cartoon design in the game's palette. Station names and marks come from
// the invented brands in gasBrands.js (no real brand names, logos or trade dress).

import { brandFor } from './gasBrands.js';

export const STATION = Object.freeze({
  label: 'Gas Station', // generic name (each station's own label is its brand name)
  count: 6, // stations wanted (one per quadrant first, then the most spread-out extra spots)
  minGap: 150, // m between stations
  roadGap: 3.5, // m from the kerb to the lot (street lamps / hydrants stand 2.3 m off the kerb)
  lot: { u0: -12, u1: 12, v0: 0, v1: 22 },
  canopy: { u0: -8.5, u1: 8.5, v0: 1, v1: 13, y0: 4.75, y1: 5.35 },
  islands: [4.7, 9.3], // v of the two pump islands (lanes run along u between them)
  island: { hu: 3.4, hv: 0.6, h: 0.15 },
  pumpU: [-1.6, 1.6], // two pumps per island
  pump: { hu: 0.45, hv: 0.3, h: 1.8 },
  postU: 3, // canopy posts stand on the island ends (u = +-postU)
  post: 0.18, // half thickness
  kiosk: { u0: -5.5, u1: 5.5, v0: 15.5, v1: 21, h: 3.6 },
  sign: { u: -10.8, v: 16, pole: 0.15, y0: 4.2, y1: 6.3, hu: 1.25, hv: 0.18 },
  gasCan: { u: 7.6, v: 17.6 },
  pumpRange: 3.5, // m: pumpNear's default search radius
  // the nozzle (GasPumps.js): grab it on foot, walk it to a car, hold fire to pump
  grabRange: 2, // m from the player to the pump to grab its nozzle
  hoseLen: 6, // m: walk further from the pump and the nozzle snaps back to it
  fuelRange: 2.5, // m from the nozzle (the player) to a car's body to fuel it
  refuelRate: 10, // fuel per second (an empty tank fills in 10 s)
  // pumps take damage, burn and blow up (GasPumps.js)
  pumpHp: 150,
  fireAt: 0.35, // hp fraction: the pump catches fire and burns down on its own
  burnRate: 14, // hp per second while burning (from 35% that is about 4 s)
  chainDelay: [0.6, 2.2], // s: each other pump of an exploded pump's station catches fire after this
  blastRadius: 7, // m
  blastDamage: 70, // to a character at the pump (falls off to blastMinDamage at the edge)
  blastMinDamage: 15,
  blastCarDamage: 220, // to cars in the radius (Vehicles.blast falloff)
  blastPumpDamage: 90, // to pumps of other stations in the radius (none are that close today)
  drawDist: 320, // m: meshes further than this from the camera are hidden
});

const ANCHOR_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'residential', 'unclassified']);
const BAD_AREAS = new Set(['water', 'parking', 'busloop', 'pitch']);
const STEP_ALONG = 10; // m between candidate spots along a street
const SAMPLE = 2; // m between footprint samples
const ROAD_CLEAR = 3; // m every footprint sample keeps from any road / path edge
const BUILDING_CLEAR = 2; // m from any building wall
const STREAM_CLEAR = 4; // m from a stream / river centre line
const BOUNDS_MARGIN = 8;
const GRID = 40; // m: segment index cell
// the bespoke Crystal Bridges tile (src/world/crystal-bridges/site.js TILE) builds its own site
const CB_TILE = { x0: -125, x1: 125, z0: -480, z1: -135 };
const CB_PAD = 10;
const EDGE_KEEP = 80; // m: extra stations (after the four quadrant ones) stay this far inside the map

/** World position of station-local (u, v). */
export function stationToWorld(st, u, v, out = { x: 0, z: 0 }) {
  out.x = st.ox + u * st.cos - v * st.sin;
  out.z = st.oz + u * st.sin + v * st.cos;
  return out;
}

/** Station-local (u, v) of world (x, z). */
export function worldToStation(st, x, z, out = { u: 0, v: 0 }) {
  const dx = x - st.ox;
  const dz = z - st.oz;
  out.u = dx * st.cos + dz * st.sin;
  out.v = -dx * st.sin + dz * st.cos;
  return out;
}

function pointInPoly(p, x, z) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0];
    const zi = p[i][1];
    const xj = p[j][0];
    const zj = p[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + dx * t - x;
  const pz = az + dz * t - z;
  return px * px + pz * pz;
}

/** Spatial index of map line segments (roads, paths, streams) and polygons (buildings, areas). */
function indexMap(data) {
  const cells = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  const put = (item, minX, minZ, maxX, maxZ) => {
    for (let cx = Math.floor(minX / GRID); cx <= Math.floor(maxX / GRID); cx++) {
      for (let cz = Math.floor(minZ / GRID); cz <= Math.floor(maxZ / GRID); cz++) {
        const k = key(cx, cz);
        let c = cells.get(k);
        if (!c) cells.set(k, (c = []));
        c.push(item);
      }
    }
  };
  const lines = (list, clear) => {
    for (const r of list || []) {
      if (!r || !Array.isArray(r.p)) continue;
      const lim = (clear(r) || 0) + 0.01;
      for (let i = 0; i + 1 < r.p.length; i++) {
        const [ax, az] = r.p[i];
        const [bx, bz] = r.p[i + 1];
        put({ t: 's', ax, az, bx, bz, lim2: lim * lim }, Math.min(ax, bx) - lim, Math.min(az, bz) - lim, Math.max(ax, bx) + lim, Math.max(az, bz) + lim);
      }
    }
  };
  lines(data.roads, (r) => (r.w || 6) / 2 + ROAD_CLEAR);
  lines(data.waterways, () => STREAM_CLEAR);
  const polys = (list, pad, test) => {
    for (const a of list || []) {
      if (!a || !Array.isArray(a.p) || a.p.length < 3 || (test && !test(a))) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [x, z] of a.p) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      put({ t: 'p', p: a.p, pad, minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad }, minX - pad, minZ - pad, maxX + pad, maxZ + pad);
    }
  };
  polys(data.buildings, BUILDING_CLEAR);
  polys(data.buildingParts, BUILDING_CLEAR);
  polys(data.areas, 0, (a) => BAD_AREAS.has(a.k));
  return {
    /** Is (x, z) free of every indexed obstacle? */
    open(x, z) {
      const c = cells.get(key(Math.floor(x / GRID), Math.floor(z / GRID)));
      if (!c) return true;
      for (const it of c) {
        if (it.t === 's') {
          if (segDist2(x, z, it.ax, it.az, it.bx, it.bz) < it.lim2) return false;
          continue;
        }
        if (x < it.minX || x > it.maxX || z < it.minZ || z > it.maxZ) continue;
        if (pointInPoly(it.p, x, z)) return false;
        if (it.pad > 0) {
          const p = it.p;
          const lim2 = it.pad * it.pad;
          for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (segDist2(x, z, p[j][0], p[j][1], p[i][0], p[i][1]) < lim2) return false;
        }
      }
      return true;
    },
  };
}

function makeStation(ox, oz, yaw) {
  const st = { ox, oz, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), x: 0, z: 0, y: 0 };
  const c = STATION.canopy;
  const mid = stationToWorld(st, (c.u0 + c.u1) / 2, (c.v0 + c.v1) / 2);
  st.x = mid.x;
  st.z = mid.z;
  return st;
}

/** Every footprint sample of a station lot is open ground. */
function lotClear(st, idx, bounds) {
  const L = STATION.lot;
  const p = { x: 0, z: 0 };
  const inB = (x, z) => x >= bounds.minX + BOUNDS_MARGIN && x <= bounds.maxX - BOUNDS_MARGIN && z >= bounds.minZ + BOUNDS_MARGIN && z <= bounds.maxZ - BOUNDS_MARGIN;
  const inCb = (x, z) => x > CB_TILE.x0 - CB_PAD && x < CB_TILE.x1 + CB_PAD && z > CB_TILE.z0 - CB_PAD && z < CB_TILE.z1 + CB_PAD;
  for (let u = L.u0; u <= L.u1 + 1e-6; u += SAMPLE) {
    for (let v = L.v0; v <= L.v1 + 1e-6; v += SAMPLE) {
      stationToWorld(st, u, v, p);
      if (!inB(p.x, p.z) || inCb(p.x, p.z) || !idx.open(p.x, p.z)) return false;
    }
  }
  return true;
}

/**
 * Candidate lots beside the streets, in map order. Pure: mapData -> [{ ox, oz, yaw, x, z, ... }].
 */
export function stationCandidates(mapData) {
  const data = mapData || {};
  const bounds = (data.meta && data.meta.bounds) || { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity };
  const idx = indexMap(data);
  const out = [];
  const L = STATION.lot;
  const half = (L.u1 - L.u0) / 2;
  for (const r of data.roads || []) {
    if (!ANCHOR_ROADS.has(r.k) || !Array.isArray(r.p) || r.p.length < 2) continue;
    const hw = (r.w || 6) / 2;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const [ax, az] = r.p[i];
      const [bx, bz] = r.p[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2 * half + 4) continue;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      for (let t = half + 2; t <= len - half - 2; t += STEP_ALONG) {
        const px = ax + dx * t;
        const pz = az + dz * t;
        for (const s of [1, -1]) {
          // v (away from the street) = s * left normal; u = s * street direction
          const vx = -dz * s;
          const vz = dx * s;
          const off = hw + STATION.roadGap;
          const st = makeStation(px + vx * off, pz + vz * off, Math.atan2(dz * s, dx * s));
          if (lotClear(st, idx, bounds)) out.push(st);
        }
      }
    }
  }
  return out;
}

/**
 * Picks the stations from the candidates: the one nearest each quadrant's centre first (NW, NE,
 * SW, SE), then the most spread-out remaining spots away from the map's outer edge (the storm
 * closes in from there) up to STATION.count, all STATION.minGap apart.
 */
export function pickStations(cands, bounds, count = STATION.count) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const qw = (bounds.maxX - bounds.minX) / 4;
  const qh = (bounds.maxZ - bounds.minZ) / 4;
  const out = [];
  const far = (c) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= STATION.minGap);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = cx + sx * qw;
    const tz = cz + sz * qh;
    let best = null;
    let bd = Infinity;
    for (const c of cands) {
      if (Math.sign(c.x - cx) !== sx || Math.sign(c.z - cz) !== sz || !far(c)) continue;
      const d = Math.hypot(c.x - tx, c.z - tz);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) out.push(best);
  }
  const inner = (c) => c.x > bounds.minX + EDGE_KEEP && c.x < bounds.maxX - EDGE_KEEP && c.z > bounds.minZ + EDGE_KEEP && c.z < bounds.maxZ - EDGE_KEEP;
  while (out.length < count) {
    let best = null;
    let bd = -Infinity;
    for (const c of cands) {
      if (!inner(c)) continue;
      let d = Infinity;
      for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z));
      if (d >= STATION.minGap && d > bd) {
        bd = d;
        best = c;
      }
    }
    if (!best) break;
    out.push(best);
  }
  return out.map((c, i) => {
    const brand = brandFor(i);
    return { ...c, i, key: 'gas' + i, brand: brand.id, label: brand.name, mesh: null, colliders: [] };
  });
}

/** Station-local corners of the lot (plan polygon, clockwise in u/v). */
function lotCorners(st, pad = 0) {
  const L = STATION.lot;
  return [
    [L.u0 - pad, L.v0 - pad],
    [L.u1 + pad, L.v0 - pad],
    [L.u1 + pad, L.v1 + pad],
    [L.u0 - pad, L.v1 + pad],
  ].map(([u, v]) => {
    const p = stationToWorld(st, u, v);
    return [p.x, p.z];
  });
}

/** Is (x, z) within `pad` m of a station lot? */
export function stationAt(stations, x, z, pad = 0) {
  const L = STATION.lot;
  const q = { u: 0, v: 0 };
  for (const st of stations || []) {
    worldToStation(st, x, z, q);
    if (q.u >= L.u0 - pad && q.u <= L.u1 + pad && q.v >= L.v0 - pad && q.v <= L.v1 + pad) return st;
  }
  return null;
}

/**
 * Plans the stations for a World (before its meshes are built) and reserves their lots, so the
 * scatter (trees, rocks, benches, dumpsters) and generic car / loot spots keep out of them.
 */
export function planGasStations(world) {
  const data = (world && world.data) || {};
  const bounds = (world && world.bounds) || (data.meta && data.meta.bounds);
  if (!bounds) return [];
  const stations = pickStations(stationCandidates(data), bounds);
  if (world) {
    for (const st of stations) if (world.reserve) world.reserve(lotCorners(st, 1));
    world.gasStations = stations;
    world.gasStationAt = (x, z, pad = 0) => stationAt(stations, x, z, pad);
  }
  return stations;
}

/** The solid parts of a station in station-local terms: [{ u, v, hu, hv, y0, y1, mat }]. */
export function stationSolids() {
  const S = STATION;
  const out = [];
  const c = S.canopy;
  out.push({ part: 'canopy', u: (c.u0 + c.u1) / 2, v: (c.v0 + c.v1) / 2, hu: (c.u1 - c.u0) / 2, hv: (c.v1 - c.v0) / 2, y0: c.y0, y1: c.y1, mat: 'metal' });
  let pk = 0; // pump index (same order as stationPumps)
  for (const iv of S.islands) {
    for (const su of [-1, 1]) out.push({ part: 'post', u: su * S.postU, v: iv, hu: S.post, hv: S.post, y0: 0, y1: c.y0, mat: 'metal' });
    for (const pu of S.pumpU) out.push({ part: 'pump', k: pk++, u: pu, v: iv, hu: S.pump.hu, hv: S.pump.hv, y0: 0, y1: S.pump.h, mat: 'metal' });
  }
  const k = S.kiosk;
  out.push({ part: 'kiosk', u: (k.u0 + k.u1) / 2, v: (k.v0 + k.v1) / 2, hu: (k.u1 - k.u0) / 2, hv: (k.v1 - k.v0) / 2, y0: 0, y1: k.h, mat: 'brick' });
  const g = S.sign;
  out.push({ part: 'signPole', u: g.u, v: g.v, hu: g.pole, hv: g.pole, y0: 0, y1: g.y0, mat: 'metal' });
  out.push({ part: 'signPanel', u: g.u, v: g.v, hu: g.hu, hv: g.hv, y0: g.y0, y1: g.y1, mat: 'metal' });
  return out;
}

/** World positions of a station's pumps: [{ x, z }] (same order as stationSolids' pumps). */
export function stationPumps(st) {
  if (st._pumps) return st._pumps;
  const out = [];
  for (const iv of STATION.islands) for (const pu of STATION.pumpU) out.push(stationToWorld(st, pu, iv));
  st._pumps = out;
  return out;
}

/**
 * Station-local pumps in stationSolids / stationPumps order: [{ k, u, v, side }]. `side` (-1 / +1)
 * is the pump's outer end along u, where the nozzle hangs in its holster.
 */
export function pumpSpots() {
  const out = [];
  for (const iv of STATION.islands) for (const pu of STATION.pumpU) out.push({ k: out.length, u: pu, v: iv, side: pu < 0 ? -1 : 1 });
  return out;
}

/** Station-local point where a pump's hose leaves its body (u, y, v). */
export function pumpHoseLocal(spot) {
  const P = STATION.pump;
  return { u: spot.u + spot.side * P.hu * 0.6, y: P.h - 0.25, v: spot.v };
}

/**
 * After the world meshes: registers each station's colliders (boxes: canopy roof, posts, pumps,
 * kiosk, sign; pump boxes carry `pumpIdx`, their hp lives in GasPumps.js), adds its mesh
 * (meshFactory(brand) -> THREE.Object3D in station-local space, ground at y = 0) and a gas can on
 * the ground beside the kiosk (world.fixedLoot).
 */
export function buildGasStations(world, stations, { scene = null, meshFactory = null } = {}) {
  if (!world || !stations) return stations;
  const solids = stationSolids();
  const p = { x: 0, z: 0 };
  const loot = [];
  for (const st of stations) {
    const brand = brandFor(st.i);
    st.y = world.surfaceHeight ? world.surfaceHeight(st.x, st.z) : 0;
    st.colliders = [];
    if (world.addBox) {
      for (const s of solids) {
        stationToWorld(st, s.u, s.v, p);
        const col = world.addBox({ cx: p.x, cz: p.z, hx: s.hu, hz: s.hv, yaw: st.yaw, y0: st.y + s.y0, y1: st.y + s.y1, kind: 'gasStation', mat: s.mat, hp: Infinity, ref: null });
        col.gasStation = st.i;
        if (s.part === 'pump') col.pumpIdx = s.k;
        st.colliders.push(col);
      }
    }
    const gc = stationToWorld(st, STATION.gasCan.u, STATION.gasCan.v);
    loot.push({ kind: 'item', x: gc.x, y: world.surfaceHeight ? world.surfaceHeight(gc.x, gc.z) : st.y, z: gc.z, yaw: st.yaw, item: { type: 'consumable', id: 'gascan', count: 1 } });
    if (scene && meshFactory) {
      const m = meshFactory(brand);
      if (m) {
        m.position.set(st.ox, st.y, st.oz);
        m.rotation.y = -st.yaw;
        if (m.updateMatrix) m.updateMatrix(); // the mesh is static (matrixAutoUpdate off)
        if (m.updateMatrixWorld) m.updateMatrixWorld(true);
        scene.add(m);
        st.mesh = m;
      }
    }
  }
  world.fixedLoot = (world.fixedLoot || []).concat(loot);
  return stations;
}

/** The pump nearest (x, z) within `range`: { station, pump, d } or null. */
export function pumpNear(stations, x, z, range = STATION.pumpRange, y = null) {
  let best = null;
  let bd = range;
  for (const st of stations || []) {
    if (Math.abs(st.x - x) > 30 || Math.abs(st.z - z) > 30) continue;
    if (y != null && Number.isFinite(st.y) && Math.abs(y - st.y) > 2) continue;
    for (const pm of stationPumps(st)) {
      const d = Math.hypot(pm.x - x, pm.z - z);
      if (d <= bd) {
        bd = d;
        best = { station: st, pump: pm, d };
      }
    }
  }
  return best;
}
