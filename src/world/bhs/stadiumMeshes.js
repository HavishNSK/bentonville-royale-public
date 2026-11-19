// BENTONVILLE ROYALE — Tiger Stadium meshes (three.js). Owned by the stadium agent, see
// docs/bhs/BHS_CONTRACT.md. Draws the parts built by stadium.js (no gameplay state here).
//
//   const view = buildStadiumMeshes({ root, world, parts })
//   view.update(dt, ctx) ; view.hideCollider(c) ; view.showCollider(c)
//
// Draw calls: one merged mesh per material (concrete, aluminium, steel, brick, roof, glass,
// chain-link, goalpost yellow, scoreboard, ...) plus a few InstancedMeshes (rail posts, fence
// posts, lamp heads). Each collider's quads are recorded as vertex ranges, so a broken piece is
// hidden by collapsing its ranges to a point (restored on match restart), the way the Crystal
// Bridges roof tiles are. Small details (rails, posts, lamps) sit in a group culled with distance.
//
// Field: synthetic turf with mowing-style bands, plain dark end zones (no lettering), white
// yard lines, hash marks and yard numbers drawn as plain geometry (seven-segment strokes).
// GeoBuf / addBox / canvasTex are small local versions of the (unexported) Crystal Bridges
// helpers in src/world/crystal-bridges/meshes.js.

import * as THREE from 'three';
import { GLASS_PANE } from '../crystal-bridges/meshes.js';
import { YD, collapseStadiumDeps, restoreStadiumDeps } from './stadium.js';

const DETAIL_FAR = 260; // m from the stadium centre: rails, posts and lamp heads are hidden beyond

// ---------------------------------------------------------------- geometry buffer

class GeoBuf {
  constructor(colors = false) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.col = colors ? [] : null;
    this.ranges = new Map(); // key (collider) -> [[start, end), ...] vertex ranges
  }
  get verts() {
    return this.pos.length / 3;
  }
  quad(a, b, c, d, n, uva, uvb, uvc, uvd, color) {
    const i = this.verts;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of [uva, uvb, uvc, uvd]) this.uv.push(t[0], t[1]);
    if (this.col) for (let k = 0; k < 4; k++) this.col.push(color[0], color[1], color[2]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  /** Record the vertices written by fn() under key (for hide / show). */
  keyed(key, fn) {
    const s = this.verts;
    fn(this);
    if (key && this.verts > s) {
      let list = this.ranges.get(key);
      if (!list) this.ranges.set(key, (list = []));
      list.push([s, this.verts]);
    }
  }
  get empty() {
    return this.idx.length === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.verts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Axis-aligned box p ({ cx, cz, hx, hz, y0, y1 }) with world-space UVs (sides: u along, v = y). */
function addBox(buf, p, faces = {}) {
  const x0 = p.cx - p.hx, x1 = p.cx + p.hx, z0 = p.cz - p.hz, z1 = p.cz + p.hz;
  const { y0, y1 } = p;
  // corners counter-clockwise seen from above
  const P = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const lo = P.map((q) => [q[0], y0, q[1]]);
  const hi = P.map((q) => [q[0], y1, q[1]]);
  const side = (i, j) => {
    const a = lo[i];
    const b = lo[j];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const n = [dz / len, 0, -dx / len];
    const ua = (a[0] * dx + a[2] * dz) / len;
    buf.quad(a, b, hi[j], hi[i], n, [ua, y0], [ua + len, y0], [ua + len, y1], [ua, y1]);
  };
  if (faces.sides !== false) {
    side(1, 0);
    side(2, 1);
    side(3, 2);
    side(0, 3);
  }
  if (faces.top !== false) buf.quad(hi[3], hi[2], hi[1], hi[0], [0, 1, 0], [x0, z1], [x1, z1], [x1, z0], [x0, z0]);
  if (faces.bottom) buf.quad(lo[0], lo[1], lo[2], lo[3], [0, -1, 0], [x0, z0], [x1, z0], [x1, z1], [x0, z1]);
}

/** Square-section beam from point a to point b (3D), side w. */
function addBeam(buf, a, b, w) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return;
  const t = [d[0] / len, d[1] / len, d[2] / len];
  // two axes perpendicular to t
  const ref = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
  const h = w / 2;
  const off = (p, su, sv) => [p[0] + (u[0] * su + v[0] * sv) * h, p[1] + (u[1] * su + v[1] * sv) * h, p[2] + (u[2] * su + v[2] * sv) * h];
  const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < 4; i++) {
    const [su0, sv0] = ring[i];
    const [su1, sv1] = ring[(i + 1) % 4];
    const nx = (su0 + su1) / 2, nv = (sv0 + sv1) / 2;
    const n = [u[0] * nx + v[0] * nv, u[1] * nx + v[1] * nv, u[2] * nx + v[2] * nv];
    buf.quad(off(a, su0, sv0), off(b, su0, sv0), off(b, su1, sv1), off(a, su1, sv1), n, [0, 0], [len, 0], [len, w], [0, w]);
  }
}

/** Flat quad on the ground (y) from four [x, z] corners. */
function groundQuad(buf, pts, y, color) {
  const P = pts.map(([x, z]) => [x, y, z]);
  buf.quad(P[0], P[1], P[2], P[3], [0, 1, 0], [pts[0][0], pts[0][1]], [pts[1][0], pts[1][1]], [pts[2][0], pts[2][1]], [pts[3][0], pts[3][1]], color);
}

// ---------------------------------------------------------------- procedural textures

function canvasTex(size, draw, repeat = true, h = size) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, size, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Deterministic noise (no Math.random, so every client's texture is the same). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(ctx, w, h, n, alpha, light, r) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Cast-in-place concrete (one tile = 2 m): speckle and faint form-panel joints. */
function concreteTexture() {
  const r = rng(11);
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#c9c6bf';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 2600, 0.09, false, r);
    speckle(ctx, S, S, 900, 0.1, true, r);
    ctx.fillStyle = 'rgba(70,66,60,0.16)';
    ctx.fillRect(0, S / 2 - 1, S, 2);
    ctx.fillRect(S / 2 - 1, 0, 2, S);
  });
}

/** Mill-finish aluminium boards: 4 boards per metre with dark gaps (u across the boards). */
function aluTexture() {
  const r = rng(23);
  return canvasTex(128, (ctx, S) => {
    const g = ctx.createLinearGradient(0, 0, S, 0);
    g.addColorStop(0, '#b9bec2');
    g.addColorStop(0.5, '#d9dde0');
    g.addColorStop(1, '#aeb3b8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, S, 300, 0.06, false, r);
    ctx.fillStyle = 'rgba(40,44,48,0.55)';
    ctx.fillRect(S - 4, 0, 4, S);
  });
}

/** Running-bond red-brown brick, 1.6 m x 0.8 m tile (u along the wall, v = height). */
function brickTexture() {
  const r = rng(37);
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#b8ab98'; // mortar
    ctx.fillRect(0, 0, S, S);
    const rows = 12;
    const bh = S / rows;
    const bw = S / 8;
    for (let y = 0; y < rows; y++) {
      const off = y % 2 ? bw / 2 : 0;
      for (let x = -1; x < 9; x++) {
        const t = r();
        const R = Math.round(132 + t * 30), G = Math.round(62 + t * 14), B = Math.round(46 + t * 10);
        ctx.fillStyle = `rgb(${R},${G},${B})`;
        ctx.fillRect(x * bw + off + 1.5, y * bh + 1.5, bw - 3, bh - 3);
      }
    }
    speckle(ctx, S, S, 800, 0.12, false, r);
  });
}

/** Galvanised chain-link mesh (transparent between the wires). */
function chainTexture() {
  return canvasTex(64, (ctx, S) => {
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(170,176,180,1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, S / 2);
    ctx.lineTo(S / 2, 0);
    ctx.lineTo(S, S / 2);
    ctx.lineTo(S / 2, S);
    ctx.closePath();
    ctx.stroke();
  });
}

/** Synthetic turf fibres (grey; tinted by vertex colour). */
function turfTexture() {
  const r = rng(53);
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const v = 170 + Math.floor(r() * 85);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * S, r() * S, 1, 2 + r() * 3);
    }
  });
}

function makeMaterials() {
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const concrete = concreteTexture();
  concrete.repeat.set(1 / 2, 1 / 2);
  const alu = aluTexture();
  alu.repeat.set(4, 4);
  const brick = brickTexture();
  brick.repeat.set(1 / 1.6, 1 / 0.8);
  const chain = chainTexture();
  chain.repeat.set(1 / 0.12, 1 / 0.12);
  const turf = turfTexture();
  turf.repeat.set(1 / 2, 1 / 2);
  const flat = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  return {
    concrete: lam({ map: concrete }),
    alu: lam({ map: alu }),
    steel: lam({ color: 0x8f969c }),
    brick: lam({ map: brick }),
    roof: lam({ color: 0xd5d6d2 }),
    frame: lam({ color: 0x3a3d40 }),
    wood: lam({ color: 0x8a6b4a }),
    yellow: lam({ color: 0xe8c234 }),
    pad: lam({ color: 0x27292c }),
    board: lam({ color: 0x1b1c1e }),
    boardFace: lam({ color: 0x0d0e10, ...flat }),
    boardTrim: lam({ color: 0x5b5f63 }),
    rail: lam({ color: 0xc4c9cd }),
    post: lam({ color: 0x9aa1a6 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xf4f1e0 }),
    fence: lam({ map: chain, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true }),
    glass: new THREE.MeshPhongMaterial({
      color: GLASS_PANE.color,
      emissive: GLASS_PANE.emissive,
      specular: 0xffffff,
      shininess: GLASS_PANE.shininess,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    turf: lam({ map: turf, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    paving: lam({ map: concrete, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    lines: lam({ color: 0xf3f3ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  };
}

// glassDecor (the booth's window) shares the glass material; detail looks go in the culled group
const LOOK_MAT = { glassDecor: 'glass' };
const DETAIL = new Set(['rail', 'post', 'frameDetail']);

// ---------------------------------------------------------------- field markings

// seven-segment strokes in a 1 x 1 cell (u right, v up): [u0, v0, u1, v1]
const SEG = {
  a: [0, 0.89, 1, 1],
  b: [0.82, 0.5, 1, 1],
  c: [0.82, 0, 1, 0.5],
  d: [0, 0, 1, 0.11],
  e: [0, 0, 0.18, 0.5],
  f: [0, 0.5, 0.18, 1],
  g: [0, 0.445, 1, 0.555],
};
const DIGIT = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd' };

function addField(lines, turf, plan) {
  const F = plan.field;
  const fe = plan.fence;
  const y = 0.03;
  const ly = 0.045;
  const green = [0.24, 0.47, 0.22];
  const greenB = [0.27, 0.52, 0.25];
  const surround = [0.21, 0.42, 0.2];
  const endzone = [0.13, 0.27, 0.15]; // plain dark-green end zones, no lettering (near-black read as asphalt)
  // turf surround inside the fence (four strips around the field)
  const strip = (x0, x1, z0, z1, c) => groundQuad(turf, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], y, c);
  strip(fe.x0, fe.x1, fe.z0, F.z0, surround);
  strip(fe.x0, fe.x1, F.z1, fe.z1, surround);
  strip(fe.x0, F.x0, F.z0, F.z1, surround);
  strip(F.x1, fe.x1, F.z0, F.z1, surround);
  // end zones and 5-yard bands
  strip(F.x0, F.x1, F.z0, F.goalN, endzone);
  strip(F.x0, F.x1, F.goalS, F.z1, endzone);
  for (let i = 0; i < 20; i++) strip(F.x0, F.x1, F.goalN + i * 5 * YD, F.goalN + (i + 1) * 5 * YD, i % 2 ? green : greenB);

  const rect = (x0, x1, z0, z1) => groundQuad(lines, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], ly);
  const W = 4 * 0.0254; // 4 in lines
  const border = 1.2;
  // white border band outside the sidelines and end lines
  rect(F.x0 - border, F.x0, F.z0 - border, F.z1 + border);
  rect(F.x1, F.x1 + border, F.z0 - border, F.z1 + border);
  rect(F.x0, F.x1, F.z0 - border, F.z0);
  rect(F.x0, F.x1, F.z1, F.z1 + border);
  // goal lines (8 in) and yard lines every 5 yd (inset 4 in from the sidelines)
  for (let i = 0; i <= 20; i++) {
    const z = F.goalN + i * 5 * YD;
    const w = i === 0 || i === 20 ? 2 * W : W;
    rect(F.x0 + W, F.x1 - W, z - w / 2, z + w / 2);
  }
  // hash marks (53 ft 4 in from each sideline) and sideline marks, every yard; 2 ft long
  const hashIn = (53 + 4 / 12) * 0.3048;
  const mark = 2 * 0.3048;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const z = F.goalN + yd * YD;
    for (const xa of [F.x0 + W, F.x1 - W - mark, F.x0 + hashIn - mark / 2, F.x1 - hashIn - mark / 2]) rect(xa, xa + mark, z - W / 2, z + W / 2);
  }
  // try marks, 3 yd out, 1 yd wide at the centre
  for (const z of [F.goalN + 3 * YD, F.goalS - 3 * YD]) rect(F.cx - YD / 2, F.cx + YD / 2, z - W / 2, z + W / 2);
  // yard numbers (6 ft tall, tops 9 yd from the sideline), bottoms toward their sideline
  const nh = 6 * 0.3048;
  const nw = 4 * 0.3048;
  const gap = 0.3;
  const digit = (d, ox, oz, rx, rz, ux, uz) => {
    for (const s of DIGIT[d]) {
      const [u0, v0, u1, v1] = SEG[s];
      const P = (u, v) => [ox + rx * u * nw + ux * v * nh, oz + rz * u * nw + uz * v * nh];
      groundQuad(lines, [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)], ly);
    }
  };
  for (let i = 2; i <= 18; i += 2) {
    const z = F.goalN + i * 5 * YD;
    const n = (i <= 10 ? i : 20 - i) * 5;
    const tens = Math.floor(n / 10);
    for (const side of [-1, 1]) {
      // west numbers read from the west sideline (up = +x, right = +z); east ones mirrored
      const ux = side === -1 ? 1 : -1;
      const rz = side === -1 ? 1 : -1;
      const bx = side === -1 ? F.x0 + 9 * YD - nh : F.x1 - 9 * YD + nh;
      digit(tens, bx, z - rz * (gap + nw), 0, rz, ux, 0);
      digit(0, bx, z + rz * gap, 0, rz, ux, 0);
    }
  }
  // pads: visitor front walk and the gate plaza (concrete)
  return plan.pads;
}

// ---------------------------------------------------------------- the view

export function buildStadiumMeshes({ root, world, parts }) {
  const plan = parts && parts.plan;
  if (!plan) return { update() {}, hideCollider() {}, showCollider() {} };
  const M = makeMaterials();
  const group = new THREE.Group();
  group.name = 'bhs-stadium';
  root.add(group);
  const detail = new THREE.Group();
  detail.name = 'bhs-stadium-detail';
  group.add(detail);

  const bufs = new Map(); // look -> GeoBuf
  const buf = (look) => {
    let b = bufs.get(look);
    if (!b) bufs.set(look, (b = new GeoBuf()));
    return b;
  };
  // instanced pieces: look -> [{ key, cx, cz, hx, hz, y0, y1 }]
  const inst = new Map();
  const lamps = [];

  for (const p of parts) {
    const key = p.collider;
    if (p.draw && p.look) {
      const isPane = p.look === 'glass';
      buf(p.look).keyed(key, (b) => addBox(b, p, { bottom: p.y0 > 0.05 || isPane }));
    }
    if (p.role === 'board') addScoreboardFace(buf, key, p);
    for (const d of p.decor) {
      if (d.t === 'box') buf(d.look).keyed(key, (b) => addBox(b, d, { bottom: d.y0 > 0.05 }));
      else if (d.t === 'beam') buf(d.look).keyed(key, (b) => addBeam(b, d.a, d.b, d.w));
      else if (d.t === 'inst') {
        if (!inst.has(d.look)) inst.set(d.look, []);
        inst.get(d.look).push({ key, ...d });
      } else if (d.t === 'rack') addRack(buf(d.look), key, d);
      else if (d.t === 'lamp') lamps.push({ key, ...d });
    }
  }

  // field and paving (scenery: never hidden)
  const turf = new GeoBuf(true);
  const lines = new GeoBuf();
  const pads = addField(lines, turf, plan);
  const paving = new GeoBuf();
  for (const pd of pads) groundQuad(paving, [[pd.x0, pd.z1], [pd.x1, pd.z1], [pd.x1, pd.z0], [pd.x0, pd.z0]], 0.035);
  // open gate leaves, swung back against the fence (visual)
  for (const g of plan.gateLeaves || []) {
    const half = (g.b - g.a) / 2;
    const leaf = (u, dir) => {
      const along = g.axis === 'x';
      const ax = along ? u : g.at, az = along ? g.at : u;
      // swung 90 degrees inward (toward the field)
      const inward = along ? (g.at < plan.field.cz ? 1 : -1) : g.at < plan.field.cx ? 1 : -1;
      const bx = along ? ax : ax + inward * half;
      const bz = along ? az + inward * half : az;
      addBeam(buf('post'), [ax, plan.fence.h - 0.1, az], [bx, plan.fence.h - 0.1, bz], 0.05);
      addBeam(buf('post'), [ax, 0.15, az], [bx, 0.15, bz], 0.05);
      buf('fence').keyed(null, (b) => addBox(b, { cx: (ax + bx) / 2, cz: (az + bz) / 2, hx: Math.max(0.02, Math.abs(bx - ax) / 2), hz: Math.max(0.02, Math.abs(bz - az) / 2), y0: 0.15, y1: plan.fence.h - 0.1 }, { top: false }));
      void dir;
    };
    leaf(g.a, 1);
    leaf(g.b, -1);
  }

  const meshes = new Map(); // GeoBuf -> mesh
  const addMesh = (b, mat, name, parent, shadow = true) => {
    if (b.empty) return null;
    const m = new THREE.Mesh(b.geometry(), mat);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    meshes.set(b, m);
    return m;
  };
  addMesh(turf, M.turf, 'bhs-stadium-turf', group, false);
  addMesh(lines, M.lines, 'bhs-stadium-lines', group, false);
  addMesh(paving, M.paving, 'bhs-stadium-paving', group, false);
  for (const [look, b] of bufs) {
    const mat = M[LOOK_MAT[look] || look] || M.concrete;
    const m = addMesh(b, mat, 'bhs-stadium-' + look, DETAIL.has(look) ? detail : group, look !== 'glass' && look !== 'glassDecor' && look !== 'fence');
    if (m && (look === 'glass' || look === 'glassDecor')) m.renderOrder = 2;
  }

  // instanced posts (rails, fence)
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const mtx = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const instIndex = new Map(); // key -> [{ im, i, m: Matrix4 }]
  const track = (key, im, i, m) => {
    if (!key) return;
    let l = instIndex.get(key);
    if (!l) instIndex.set(key, (l = []));
    l.push({ im, i, m: m.clone() });
  };
  for (const [look, list] of inst) {
    const im = new THREE.InstancedMesh(unit, M[look] || M.post, list.length);
    im.name = 'bhs-stadium-' + look + '-posts';
    list.forEach((d, i) => {
      mtx.makeScale(d.hx * 2, d.y1 - d.y0, d.hz * 2).setPosition(d.cx, d.y0, d.cz);
      im.setMatrixAt(i, mtx);
      track(d.key, im, i, mtx);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    detail.add(im);
  }
  // lamp heads: one InstancedMesh, each lamp a flat box facing the field
  if (lamps.length) {
    const lampGeo = new THREE.BoxGeometry(0.62, 0.62, 0.32);
    const im = new THREE.InstancedMesh(lampGeo, M.lamp, lamps.length);
    im.name = 'bhs-stadium-lamps';
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const pos = new THREE.Vector3();
    const tilt = new THREE.Euler();
    lamps.forEach((l, i) => {
      // face the field and tilt down ~25 degrees
      tilt.set(0, Math.atan2(l.nx, l.nz), 0, 'YXZ');
      tilt.x = 0.45;
      q.setFromEuler(tilt);
      mtx.compose(pos.set(l.x, l.y, l.z), q, s);
      im.setMatrixAt(i, mtx);
      track(l.key, im, i, mtx);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    detail.add(im);
  }

  // ---- hide / show by collapsing a collider's vertex ranges (and instances)
  const originals = new Map(); // mesh -> Float32Array copy, taken on the first hide
  const setHidden = (key, hidden) => {
    let found = false;
    for (const [b, mesh] of meshes) {
      const ranges = b.ranges.get(key);
      if (!ranges) continue;
      found = true;
      const attr = mesh.geometry.attributes.position;
      if (!originals.has(mesh)) originals.set(mesh, attr.array.slice());
      const orig = originals.get(mesh);
      for (const [s, e] of ranges) {
        for (let v = s; v < e; v++) {
          const src = hidden ? s : v; // hidden: every vertex onto the first (degenerate)
          attr.setXYZ(v, orig[src * 3], orig[src * 3 + 1], orig[src * 3 + 2]);
        }
      }
      attr.needsUpdate = true;
    }
    const il = instIndex.get(key);
    if (il) {
      found = true;
      for (const r of il) {
        r.im.setMatrixAt(r.i, hidden ? zero : r.m);
        r.im.instanceMatrix.needsUpdate = true;
      }
    }
    return found;
  };

  const centre = new THREE.Vector3(plan.field.cx, 6, plan.field.cz);
  return {
    group,
    update(dt, ctx) {
      const cam = ctx && ctx.camera;
      if (cam) detail.visible = cam.position.distanceTo(centre) < DETAIL_FAR;
    },
    /** A stadium collider broke: hide it and everything that rested on it (removed from the world too). */
    hideCollider(c) {
      if (!c || !c.part) return false;
      setHidden(c, true);
      collapseStadiumDeps(world, c, (d) => setHidden(d, true));
      return true;
    },
    showCollider(c) {
      if (!c || !c.part) return false;
      setHidden(c, false);
      restoreStadiumDeps(world, c, (d) => setHidden(d, false));
      return true;
    },
  };
}

/** Blank scoreboard face: a dark inset panel and plain unlit panels (no digits, words or logos). */
function addScoreboardFace(buf, key, p) {
  const z = p.cz + p.hz;
  const x0 = p.cx - p.hx, x1 = p.cx + p.hx;
  const face = (xa, xb, ya, yb, dz, look) =>
    buf(look).keyed(key, (b) => b.quad([xa, ya, z + dz], [xb, ya, z + dz], [xb, yb, z + dz], [xa, yb, z + dz], [0, 0, 1], [xa, ya], [xb, ya], [xb, yb], [xa, yb]));
  face(x0 + 0.25, x1 - 0.25, p.y0 + 0.25, p.y1 - 0.25, 0.01, 'boardFace');
  // trim and blank panel blocks: a wide top panel, two side blocks and a centre clock block
  face(x0 + 0.6, x1 - 0.6, p.y1 - 1.25, p.y1 - 0.55, 0.02, 'boardTrim');
  for (const [a, b2] of [[x0 + 0.6, x0 + 3.0], [x1 - 3.0, x1 - 0.6]]) face(a, b2, p.y0 + 0.55, p.y0 + 2.2, 0.02, 'boardTrim');
  face(p.cx - 1.4, p.cx + 1.4, p.y0 + 0.9, p.y0 + 2.2, 0.02, 'boardTrim');
}

/** Light tower lamp rack: two horizontal beams and end uprights, centred on the pole top. */
function addRack(b, key, d) {
  const half = d.w / 2;
  const L = [d.x - d.ux * half, d.z - d.uz * half];
  const R = [d.x + d.ux * half, d.z + d.uz * half];
  b.keyed(key, (bb) => {
    for (const y of [d.y0, d.y0 + (d.y1 - d.y0) / 2, d.y1]) addBeam(bb, [L[0], y, L[1]], [R[0], y, R[1]], 0.14);
    for (const [x, z] of [L, R]) addBeam(bb, [x, d.y0, z], [x, d.y1, z], 0.14);
    // short arm back to the pole
    addBeam(bb, [d.x, d.y0 + 0.4, d.z], [d.x - d.nx * 0.6, d.y0 + 0.4, d.z - d.nz * 0.6], 0.2);
  });
}
