// BENTONVILLE ROYALE — Crystal Bridges: three.js meshes for the site (terrain, ponds, pavilions,
// copper roofs, glulam ribs, glass, furniture). Reads build.js output; no gameplay state here.
//
// Materials follow the real building (docs/crystal-bridges-research.md §3): hand-polished
// architectural concrete with inset cedar bands, red-oak floors, green-quartzite in Eleven,
// curved glulam ribs, copper roofs weathered to deep brown with green streaks, floor-to-ceiling
// glass. All textures are procedural canvases (no third-party image assets).
//
// Draw calls: one merged mesh per material (concrete, stone, oak, quartzite, mullions, roofs by
// material, ceilings, ribs), one InstancedMesh for all glass panes and one per furniture type
// (so a broken pane / bench hides just its instance), the terrain, and one mesh per pond.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAVILIONS, LEVEL, TILE, WALKER_LANDING, SLABS } from './site.js';
import { roofUnder, roofTileLines, roofNeighborSides } from './build.js';
import { STATUE_MODELS } from './statues.js';

const ROOF_T = 0.45;
const BAND = 1.22; // cedar band spacing (m): bands line up across every wall (world-space v)

/**
 * Floor-to-ceiling wall glass: clear, faintly green-blue (low-iron float glass seen edge-on),
 * with a specular highlight and soft sky-reflection streaks so it reads as a window you look
 * THROUGH (to the ponds and woods), not a frosted sheet. Opacity 1 would be an opaque panel.
 */
export const GLASS_PANE = { color: 0xd4e8ee, emissive: 0x0a1418, opacity: 0.36, transparent: true, shininess: 96 };

/** South / library sliding doors: tinted glass thick enough to read as a door, not a hole. */
export const DOOR_GLASS = { color: 0x9eb8c4, opacity: 0.62, transparent: true, shininess: 70, depthWrite: true };

// ---------------------------------------------------------------- geometry buffer

class GeoBuf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
  }
  quad(a, b, c, d, n, uva, uvb, uvc, uvd) {
    const i = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 4; k++) this.nor.push(n[0], n[1], n[2]);
    for (const t of [uva, uvb, uvc, uvd]) this.uv.push(t[0], t[1]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  get empty() {
    return this.idx.length === 0;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Add an oriented box (a build.js part) with world-space UVs: sides u = along the face (m),
 * v = world y (m); top / bottom u = x, v = z. `faces` can skip faces ({ top:false, ... }).
 */
function addBox(buf, p, faces = {}) {
  const c = Math.cos(p.yaw || 0);
  const s = Math.sin(p.yaw || 0);
  const corner = (lx, lz, y) => [p.cx + lx * c - lz * s, y, p.cz + lx * s + lz * c];
  const { hx, hz, y0, y1 } = p;
  const P = [corner(-hx, -hz, 0), corner(hx, -hz, 0), corner(hx, hz, 0), corner(-hx, hz, 0)];
  const lo = P.map((q) => [q[0], y0, q[2]]);
  const hi = P.map((q) => [q[0], y1, q[2]]);
  const side = (i, j) => {
    const a = lo[i];
    const b = lo[j];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const n = [dz / len, 0, -dx / len];
    // u along the face in world terms: projection on the face direction (stable across pieces)
    const ua = (a[0] * dx + a[2] * dz) / len;
    const ub = ua + len;
    buf.quad(a, b, hi[j], hi[i], n, [ua, y0], [ub, y0], [ub, y1], [ua, y1]);
  };
  // winding: corners go counter-clockwise seen from above (-hx,-hz) -> (hx,-hz) -> (hx,hz) -> (-hx,hz)
  if (faces.sides !== false) {
    side(1, 0);
    side(2, 1);
    side(3, 2);
    side(0, 3);
  }
  if (faces.top !== false) buf.quad(hi[3], hi[2], hi[1], hi[0], [0, 1, 0], [hi[3][0], hi[3][2]], [hi[2][0], hi[2][2]], [hi[1][0], hi[1][2]], [hi[0][0], hi[0][2]]);
  if (faces.bottom) buf.quad(lo[0], lo[1], lo[2], lo[3], [0, -1, 0], [lo[0][0], lo[0][2]], [lo[1][0], lo[1][2]], [lo[2][0], lo[2][2]], [lo[3][0], lo[3][2]]);
}

// ---------------------------------------------------------------- procedural textures

function canvasTex(size, draw, repeat = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, size, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

/** Polished concrete (one BAND tall) with an inset cedar band (red-gold, silvering at the edges). */
function concreteTexture() {
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#d9d2c4';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 2200, 0.08, false);
    speckle(ctx, S, 900, 0.1, true);
    // form-tie divots on a grid (left visible in the real building)
    ctx.fillStyle = 'rgba(80,72,60,0.35)';
    for (let x = S / 8; x < S; x += S / 4) ctx.beginPath(), ctx.arc(x, S * 0.62, 2.2, 0, Math.PI * 2), ctx.fill();
    // cedar band: 0.15 m of the 1.22 m module
    const b0 = Math.round(S * 0.06);
    const bh = Math.round(S * 0.13);
    const g = ctx.createLinearGradient(0, b0, 0, b0 + bh);
    g.addColorStop(0, '#8e6a4f');
    g.addColorStop(0.5, '#b07446');
    g.addColorStop(1, '#8a6550');
    ctx.fillStyle = g;
    ctx.fillRect(0, b0, S, bh);
    ctx.strokeStyle = 'rgba(60,35,20,0.25)';
    for (let x = 0; x < S; x += 9 + Math.random() * 14) ctx.beginPath(), ctx.moveTo(x, b0), ctx.lineTo(x + 3, b0 + bh), ctx.stroke();
    ctx.fillStyle = 'rgba(40,30,20,0.35)';
    ctx.fillRect(0, b0 - 1, S, 1.5);
    ctx.fillRect(0, b0 + bh, S, 1.5);
  });
}

/**
 * Window reflection: per pane (BoxGeometry faces map 0..1), a sky gradient that is brighter at
 * the top, plus two soft diagonal sheen bands — the cue the eye reads as glass.
 */
function glassTexture() {
  return canvasTex(256, (ctx, S) => {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#f2f8fa');
    g.addColorStop(0.45, '#c9dde4');
    g.addColorStop(1, '#a9c2ca');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const band = (x0, w, a) => {
      ctx.save();
      ctx.translate(x0, 0);
      ctx.transform(1, 0, -0.55, 1, 0, 0);
      const h = ctx.createLinearGradient(0, 0, w, 0);
      h.addColorStop(0, 'rgba(255,255,255,0)');
      h.addColorStop(0.5, `rgba(255,255,255,${a})`);
      h.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = h;
      ctx.fillRect(0, 0, w, S);
      ctx.restore();
    };
    band(S * 0.38, S * 0.22, 0.75);
    band(S * 0.7, S * 0.08, 0.6);
  }, false);
}

function oakTexture() {
  // Red-oak strip flooring (Crystal Bridges galleries / Street View): ~12 cm boards,
  // warm reddish brown, tight seams — not the old 40 cm orange planks.
  return canvasTex(512, (ctx, S) => {
    const planks = 16;
    for (let i = 0; i < planks; i++) {
      const y = (i * S) / planks;
      const h = S / planks;
      const shade = 0.88 + ((i * 37) % 11) / 40 + Math.random() * 0.06;
      const r = Math.round(168 * shade);
      const g = Math.round(98 * shade);
      const b = Math.round(58 * shade);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, y, S, h);
      ctx.strokeStyle = 'rgba(120,70,40,0.22)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        ctx.beginPath();
        const yy = y + 2 + Math.random() * (h - 4);
        ctx.moveTo(0, yy);
        ctx.bezierCurveTo(S * 0.3, yy + (Math.random() - 0.5) * 3, S * 0.7, yy + (Math.random() - 0.5) * 3, S, yy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(70,38,18,0.55)';
      ctx.fillRect(0, y, S, 1);
      const cut = ((i * 97) % S);
      ctx.fillRect(cut, y, 1, h);
    }
  });
}

function tileTexture(base, line, n = 4) {
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 1400, 0.07, false);
    speckle(ctx, S, 600, 0.08, true);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * S) / n);
      ctx.lineTo(S, (i * S) / n);
      ctx.moveTo((i * S) / n, 0);
      ctx.lineTo((i * S) / n, S);
      ctx.stroke();
    }
  });
}

/** Copper weathered to deep brown, with blue-green runoff streaks; standing seams every 0.6 m. */
function copperTexture() {
  return canvasTex(256, (ctx, S) => {
    ctx.fillStyle = '#5e4a3c'; // aged copper: deep bronze-brown (2011 orange has long weathered)
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${105 + Math.random() * 40},${80 + Math.random() * 25},${60},${0.04 + Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 20 + Math.random() * 60, 6 + Math.random() * 20);
    }
    for (let i = 0; i < 9; i++) {
      const x = Math.random() * S;
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(90,160,140,0)');
      g.addColorStop(1, 'rgba(90,165,140,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x, S * 0.4, 3 + Math.random() * 6, S * 0.6);
    }
    // standing seams: pale ridges catching the light, as in the aerial photos
    for (let x = 0; x < S; x += S / 4) {
      ctx.fillStyle = 'rgba(205,190,165,0.75)';
      ctx.fillRect(x, 0, 3, S);
      ctx.fillStyle = 'rgba(30,20,12,0.5)';
      ctx.fillRect(x + 3, 0, 2, S);
    }
  });
}

function steelTexture() {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = '#8d9296';
    ctx.fillRect(0, 0, S, S);
    speckle(ctx, S, 400, 0.08, true);
    ctx.fillStyle = 'rgba(40,44,48,0.5)';
    for (let x = 0; x < S; x += S / 4) ctx.fillRect(x, 0, 2, S);
  });
}

function grassTexture() {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = '#6f9c4c';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,80,30' : '150,190,90'},${Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 1.5, 3);
    }
  });
}

/** Cream ceiling between the ribs (the "wood lattice" soffit), slightly warm. */
function soffitTexture() {
  return canvasTex(128, (ctx, S) => {
    ctx.fillStyle = '#c99d6a';
    ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(110,70,35,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < S; i += S / 8) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(S, i);
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------- materials

function makeMaterials() {
  const lam = (o) => new THREE.MeshLambertMaterial(o);
  const concrete = concreteTexture();
  concrete.repeat.set(1 / 4, 1 / BAND); // u: 4 m per tile; v: one band module per BAND m
  const oak = oakTexture();
  oak.repeat.set(1 / 1.9, 1 / 1.9);
  oak.anisotropy = 8;
  const stone = tileTexture('#cfc7b6', 'rgba(110,100,85,0.35)');
  stone.repeat.set(1 / 4, 1 / 4);
  const quartz = tileTexture('#5f8a70', 'rgba(25,50,35,0.4)');
  quartz.repeat.set(1 / 2.4, 1 / 2.4);
  const copper = copperTexture();
  copper.repeat.set(1 / 3.2, 1 / 3.2); // a seam every 0.8 m
  const steel = steelTexture();
  steel.repeat.set(1 / 2.4, 1 / 2.4);
  const grass = grassTexture();
  grass.repeat.set(1 / 3, 1 / 3);
  const soffit = soffitTexture();
  soffit.repeat.set(1 / 2.4, 1 / 2.4);
  return {
    concrete: lam({ map: concrete, side: THREE.DoubleSide }),
    stone: lam({ map: stone }),
    oak: lam({ map: oak }),
    quartzite: lam({ map: quartz }),
    copper: lam({ map: copper, side: THREE.DoubleSide }),
    steel: lam({ map: steel, side: THREE.DoubleSide }),
    green: lam({ map: grass, side: THREE.DoubleSide }),
    soffit: lam({ map: soffit, side: THREE.DoubleSide }),
    rib: lam({ color: 0xc58d58 }),
    mullion: lam({ color: 0x2f3236 }),
    darkwall: lam({ color: 0x141418 }),
    roofGlass: new THREE.MeshLambertMaterial({ color: 0x8aa8b0, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhongMaterial({
      map: glassTexture(),
      color: GLASS_PANE.color,
      emissive: GLASS_PANE.emissive,
      specular: 0xffffff,
      shininess: GLASS_PANE.shininess,
      transparent: GLASS_PANE.transparent,
      opacity: GLASS_PANE.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    // entrance door leaves, the pastry case, the cafeteria sneeze guard
    doorglass: new THREE.MeshPhongMaterial({
      color: DOOR_GLASS.color,
      specular: 0xffffff,
      shininess: DOOR_GLASS.shininess,
      transparent: DOOR_GLASS.transparent,
      opacity: DOOR_GLASS.opacity,
      depthWrite: DOOR_GLASS.depthWrite,
      side: THREE.DoubleSide,
    }),
    espresso: new THREE.MeshPhongMaterial({ color: 0xb8bcc0, specular: 0xffffff, shininess: 60 }),
    prop: lam({ color: 0x8a5a36 }),
    case: new THREE.MeshLambertMaterial({ color: 0xdfeef0, transparent: true, opacity: 0.5, depthWrite: false }),
    deck: lam({ color: 0x9a7a5a }),
  };
}

const FLOOR_MAT = { oak: 'oak', stone: 'stone', quartzite: 'quartzite', concrete: 'stone' };

// ---------------------------------------------------------------- roofs, ceilings, ribs

/**
 * Smooth roof surface (top), its underside (ceiling soffit) and the fascia, over the pavilion's
 * bowed rect plus eaves. The grid follows build.js roofTileLines (split to <= 1 m), so every quad
 * over the footprint belongs to exactly one breakable roof tile: `tiles` is that pavilion's tile
 * parts, and each tile collects { buf, start } for its quads (meshes.js collapses them when the
 * tile breaks). The eave band outside the footprint is not breakable.
 */
function addRoof(pv, roofBufs, soffitBuf, tiles = [], quadsOf = null) {
  const mat = (pv.roof && pv.roof.mat) || 'concrete';
  const buf = roofBufs[mat] || roofBufs.concrete;
  // the hull roofs of the bridges overhang their glass walls by ~1.6 m (eaves follow the arch down)
  const hull = pv.roof && pv.roof.type === 'convex';
  const longX = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
  const spanEave = hull ? 1.6 : 0.4;
  const endEave = 0.4;
  const { xs: tx, zs: tz } = roofTileLines(pv);
  const exX0 = longX ? endEave : spanEave;
  const exZ0 = longX ? spanEave : endEave;
  // no overhang where another pavilion butts on: it would poke through that room's joint wall
  const nbr = roofNeighborSides(pv);
  /** grid lines: eave edge, the tile lines split to <= 1 m, eave edge (an eave of 0 adds no line) */
  const gridLines = (lines, eaveLo, eaveHi) => {
    const out = eaveLo > 0 ? [lines[0] - eaveLo] : [];
    for (let i = 0; i + 1 < lines.length; i++) {
      const n = Math.max(1, Math.ceil(lines[i + 1] - lines[i]));
      for (let s = 0; s < n; s++) out.push(lines[i] + ((lines[i + 1] - lines[i]) * s) / n);
    }
    out.push(lines[lines.length - 1]);
    if (eaveHi > 0) out.push(lines[lines.length - 1] + eaveHi);
    return out;
  };
  const gx = gridLines(tx, nbr.w ? 0 : exX0, nbr.e ? 0 : exX0);
  const gz = gridLines(tz, nbr.n ? 0 : exZ0, nbr.s ? 0 : exZ0);
  const nx = gx.length - 1;
  const nz = gz.length - 1;
  const P = (i, k, top) => {
    const x = gx[i];
    const z = gz[k];
    const y = roofUnder(pv, x, z, hull) + (top ? ROOF_T : 0);
    return [x, y, z];
  };
  const holes = (pv.roof && pv.roof.holes) || [];
  const inHole = (x, z) => holes.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1);
  const tileAt = (x, z) => tiles.find((t) => Math.abs(x - t.cx) < t.hx && Math.abs(z - t.cz) < t.hz) || null;
  const note = (tile, b) => {
    if (!tile || !quadsOf) return;
    if (!quadsOf.has(tile.collider)) quadsOf.set(tile.collider, []);
    quadsOf.get(tile.collider).push({ buf: b, start: b.pos.length / 3 });
  };
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const a = P(i, k, true), b = P(i + 1, k, true), c = P(i + 1, k + 1, true), d = P(i, k + 1, true);
      const mx = (a[0] + c[0]) / 2;
      const mz = (a[2] + c[2]) / 2;
      if (inHole(mx, mz)) continue;
      const tile = tileAt(mx, mz);
      const n = faceNormal(d, c, b);
      note(tile, buf);
      buf.quad(d, c, b, a, n, [d[0], d[2]], [c[0], c[2]], [b[0], b[2]], [a[0], a[2]]);
      const A = P(i, k, false), B = P(i + 1, k, false), C = P(i + 1, k + 1, false), D = P(i, k + 1, false);
      note(tile, soffitBuf);
      soffitBuf.quad(A, B, C, D, [0, -1, 0], [A[0], A[2]], [B[0], B[2]], [C[0], C[2]], [D[0], D[2]]);
    }
  }
  // fascia (roof edge) all round
  const edge = (pa, pb) => {
    const n = faceNormal([pa[0], pa[1], pa[2]], [pb[0], pb[1], pb[2]], [pb[0], pb[1] + 1, pb[2]]);
    buf.quad([pa[0], pa[1] - ROOF_T, pa[2]], [pb[0], pb[1] - ROOF_T, pb[2]], pb, pa, n, [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
  };
  for (let i = 0; i < nx; i++) {
    edge(P(i + 1, 0, true), P(i, 0, true));
    edge(P(i, nz, true), P(i + 1, nz, true));
  }
  for (let k = 0; k < nz; k++) {
    edge(P(0, k, true), P(0, k + 1, true));
    edge(P(nx, k + 1, true), P(nx, k, true));
  }
}

function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** Curved glulam ribs under the ceiling: across the short axis, every 2.4 m along the long axis. */
function addRibs(pv, buf) {
  const long = pv.x1 - pv.x0 >= pv.z1 - pv.z0;
  const L = long ? pv.x1 - pv.x0 : pv.z1 - pv.z0;
  const S = long ? pv.z1 - pv.z0 : pv.x1 - pv.x0;
  const n = Math.floor(L / 2.4);
  const depth = 0.42;
  const width = 0.22;
  for (let i = 1; i < n; i++) {
    const t = pv[long ? 'x0' : 'z0'] + (L * i) / n;
    const segs = Math.max(4, Math.ceil(S / 1.5));
    for (let k = 0; k < segs; k++) {
      const s0 = pv[long ? 'z0' : 'x0'] + 0.3 + ((S - 0.6) * k) / segs;
      const s1 = pv[long ? 'z0' : 'x0'] + 0.3 + ((S - 0.6) * (k + 1)) / segs;
      const [x0, z0] = long ? [t, s0] : [s0, t];
      const [x1, z1] = long ? [t, s1] : [s1, t];
      // a slight downward arch across the span on top of the roof profile
      const sag = (f) => 0.35 * Math.sin(Math.PI * f);
      const f0 = k / segs, f1 = (k + 1) / segs;
      const ya = roofUnder(pv, x0, z0) - sag(f0);
      const yb = roofUnder(pv, x1, z1) - sag(f1);
      const ym = (ya + yb) / 2;
      const len = Math.hypot(x1 - x0, z1 - z0);
      addBox(buf, { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: len / 2 + 0.02, hz: width / 2, yaw: Math.atan2(z1 - z0, x1 - x0), y0: ym - depth, y1: ym }, { bottom: true });
    }
  }
}

// ---------------------------------------------------------------- terrain + water

function terrainMesh(world, ponds) {
  const cell = 1;
  const nx = Math.round((TILE.x1 - TILE.x0) / cell);
  const nz = Math.round((TILE.z1 - TILE.z0) / cell);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const grass = new THREE.Color(0x7daf58); // matches the map's ground plane at the tile edge
  const forest = new THREE.Color(0x58823f);
  const mud = new THREE.Color(0x7b6a4a);
  const tmp = new THREE.Color();
  for (let k = 0; k <= nz; k++) {
    for (let i = 0; i <= nx; i++) {
      const x = TILE.x0 + i * cell;
      const z = TILE.z0 + k * cell;
      const y = world.terrainHeight(x, z);
      const j = k * (nx + 1) + i;
      pos[j * 3] = x;
      pos[j * 3 + 1] = y;
      pos[j * 3 + 2] = z;
      uv[j * 2] = x / 70;
      uv[j * 2 + 1] = z / 70;
      const slope = 1 - world.terrainNormal(x, z).y;
      const depth = Math.min(1, -y / 8);
      tmp.copy(grass).lerp(forest, Math.min(1, slope * 6 + depth * 0.4));
      if (y < LEVEL.SOUTH_POND + 0.6) tmp.lerp(mud, 0.6);
      col[j * 3] = tmp.r;
      col[j * 3 + 1] = tmp.g;
      col[j * 3 + 2] = tmp.b;
    }
  }
  const idx = [];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const a = k * (nx + 1) + i;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Pond water: deep green (Eleven's quartzite floor was chosen to match it), fresnel sky tint, moving ripples. */
function waterMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x2f5a4a) }, uSky: { value: new THREE.Color(0x9fd0e6) } }]),
    vertexShader: `
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uDeep; uniform vec3 uSky;
      varying vec3 vW;
      #include <fog_pars_fragment>
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float r1 = sin(vW.x * 1.7 + uTime * 1.1) * sin(vW.z * 1.3 - uTime * 0.8);
        float r2 = sin((vW.x + vW.z) * 3.1 - uTime * 1.6) * 0.5;
        vec3 N = normalize(vec3(r1 * 0.05 + r2 * 0.03, 1.0, r2 * 0.04 - r1 * 0.03));
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 col = mix(uDeep, uSky, 0.18 + 0.7 * fres);
        float glint = pow(max(r1 * r2, 0.0), 6.0) * 0.6;
        col += vec3(glint);
        gl_FragColor = vec4(col, 0.86);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- the whole site

/**
 * Build every mesh into `root`. site = buildSite() output. Returns { update(dt), hideCollider(c),
 * showCollider(c), meshes } — the hide/show pair hides a broken pane / prop instance.
 */
export function buildSiteMeshes({ root, world, site }) {
  const M = makeMaterials();
  const group = new THREE.Group();
  group.name = 'crystal-bridges';
  root.add(group);
  const uniforms = { time: 0 };

  // terrain
  const terrain = new THREE.Mesh(terrainMesh(world, site.ponds), new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  }));
  terrain.receiveShadow = true;
  terrain.name = 'cb-terrain';
  group.add(terrain);

  // ponds
  const water = waterMaterial();
  for (const pd of site.ponds) {
    const shape = new THREE.Shape(pd.p.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, water);
    m.position.y = pd.y;
    m.renderOrder = 1;
    m.name = 'cb-' + pd.id;
    group.add(m);
  }
  // waterfalls over the north face of each weir tooth (south pond -> north pond, then expansion)
  const fallMat = new THREE.MeshBasicMaterial({ color: 0xe6f2f0, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  for (const s of SLABS) {
    if (!String(s.id).startsWith('weir-')) continue;
    const bot = String(s.id).startsWith('weir-eleven') ? LEVEL.NORTH_POND : LEVEL.EXP_POND;
    const top = s.y;
    const g = new THREE.PlaneGeometry(s.x1 - s.x0, Math.max(0.2, top - bot));
    const m = new THREE.Mesh(g, fallMat);
    m.position.set((s.x0 + s.x1) / 2, (top + bot) / 2, s.z0 - 0.04);
    group.add(m);
  }

  // architecture: merged per material (roof boxes are drawn as smooth roofs instead)
  const bufs = {};
  const bufOf = (k) => bufs[k] || (bufs[k] = new GeoBuf());
  for (const p of site.parts) {
    if (p.roofOf || p.hidden || p.doorLeaf || p.frame || p.mullion) continue; // hidden: statue figure. doorLeaf: animated. frame/mullion: instanced so a blast can hide them.
    let mat = p.mat;
    if (p.floorOf) {
      // floor slab: floor material on top, concrete sides
      addBox(bufOf(FLOOR_MAT[mat] || 'stone'), p, { sides: false });
      // concrete sides AND underside: from under a bridge (the weir chest) or the ravine floor
      // the slab must not vanish (backface culling) and show the roof soffit through it
      addBox(bufOf('concrete'), p, { top: false, bottom: true });
      continue;
    }
    if (mat === 'stone' || mat === 'oak' || mat === 'quartzite') mat = FLOOR_MAT[mat];
    if (!M[mat]) mat = 'concrete';
    addBox(bufOf(mat), p, { bottom: true });
  }
  const roofBufs = { copper: new GeoBuf(), steel: new GeoBuf(), concrete: new GeoBuf(), green: new GeoBuf(), glass: new GeoBuf() };
  const soffit = new GeoBuf();
  const ribs = new GeoBuf();
  const roofQuads = new Map(); // roof tile collider -> [{ buf, start }] (4 vertices each)
  for (const pv of PAVILIONS) {
    const tiles = site.parts.filter((p) => p.roofTile && p.roofOf === pv.id);
    addRoof(pv, roofBufs, soffit, tiles, roofQuads);
    if (pv.ribs) addRibs(pv, ribs);
  }
  // entrance colonnade (east crest): columns and a thin copper canopy (visual; collision in build.js)
  const meshes = [];
  const add = (buf, mat, name, shadow = true) => {
    if (buf.empty) return null;
    const m = new THREE.Mesh(buf.geometry(), mat);
    m.name = name;
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    meshes.push(m);
    return m;
  };
  for (const k in bufs) add(bufs[k], M[k] || M.concrete, 'cb-' + k);
  const meshOfBuf = new Map();
  meshOfBuf.set(roofBufs.copper, add(roofBufs.copper, M.copper, 'cb-roof-copper'));
  meshOfBuf.set(roofBufs.steel, add(roofBufs.steel, M.steel, 'cb-roof-steel'));
  meshOfBuf.set(roofBufs.concrete, add(roofBufs.concrete, M.concrete, 'cb-roof-concrete'));
  meshOfBuf.set(roofBufs.green, add(roofBufs.green, M.green, 'cb-roof-green'));
  meshOfBuf.set(roofBufs.glass, add(roofBufs.glass, M.roofGlass, 'cb-roof-glass', false));
  meshOfBuf.set(soffit, add(soffit, M.soffit, 'cb-soffit', false));
  /** A broken roof tile: collapse its quads (top and soffit) to a point; restore puts them back. */
  const roofOriginal = new Map(); // mesh -> Float32Array copy of positions, taken on first break
  const setRoofTile = (c, broken) => {
    const list = roofQuads.get(c);
    if (!list) return false;
    const dirty = new Set();
    for (const { buf, start } of list) {
      const mesh = meshOfBuf.get(buf);
      if (!mesh) continue;
      const attr = mesh.geometry.attributes.position;
      if (!roofOriginal.has(mesh)) roofOriginal.set(mesh, attr.array.slice());
      const orig = roofOriginal.get(mesh);
      for (let v = 0; v < 4; v++) {
        const src = broken ? start : start + v; // broken: every corner onto the first (degenerate)
        attr.setXYZ(start + v, orig[src * 3], orig[src * 3 + 1], orig[src * 3 + 2]);
      }
      dirty.add(attr);
    }
    for (const attr of dirty) attr.needsUpdate = true;
    return true;
  };
  add(ribs, M.rib, 'cb-ribs');

  // footbridge decks
  const deckBuf = new GeoBuf();
  for (const d of site.decks) {
    const [ax, ay, az] = d.a;
    const [bx, by, bz] = d.b;
    const len = Math.hypot(bx - ax, bz - az);
    const segs = Math.ceil(len / 2);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const x0 = ax + (bx - ax) * t0, x1 = ax + (bx - ax) * t1;
      const z0 = az + (bz - az) * t0, z1 = az + (bz - az) * t1;
      const y = ay + (by - ay) * ((t0 + t1) / 2);
      addBox(deckBuf, { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: Math.hypot(x1 - x0, z1 - z0) / 2 + 0.02, hz: d.hw, yaw: Math.atan2(z1 - z0, x1 - x0), y0: y - 0.25, y1: y }, { bottom: true });
    }
  }
  add(deckBuf, M.deck, 'cb-decks');

  // glass panes: one InstancedMesh (lean outward ~12° on the Modern Art bridge, as built)
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, 0.5, 0);
  const glassMesh = new THREE.InstancedMesh(unit, M.glass, Math.max(1, site.glass.length));
  glassMesh.name = 'cb-glass';
  glassMesh.renderOrder = 2;
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const po = new THREE.Vector3();
  const paneMatrix = (p, out) => {
    const yaw = p.yaw || 0;
    let lean = 0;
    if (p.lean) lean = (p.side === 'n' ? 1 : -1) * 0.2; // top tilts outward
    e.set(lean, -yaw, 0, 'YXZ');
    q.setFromEuler(e);
    po.set(p.cx, p.y0, p.cz);
    sc.set(p.hx * 2, p.y1 - p.y0, p.hz * 2);
    return out.compose(po, q, sc);
  };
  const paneIndex = new Map();
  site.glass.forEach((p, i) => {
    glassMesh.setMatrixAt(i, paneMatrix(p, mtx));
    if (p.collider) paneIndex.set(p.collider, i);
  });
  glassMesh.count = site.glass.length;
  glassMesh.instanceMatrix.needsUpdate = true;
  glassMesh.computeBoundingSphere();
  group.add(glassMesh);

  // window frames / mullions: instanced so a blast can hide them with the pane
  const frameParts = site.parts.filter((p) => p.frame || p.mullion);
  const frameMesh = new THREE.InstancedMesh(unit, M.mullion, Math.max(1, frameParts.length));
  frameMesh.name = 'cb-frames';
  const frameIndex = new Map();
  frameParts.forEach((p, i) => {
    e.set(0, -(p.yaw || 0), 0);
    q.setFromEuler(e);
    frameMesh.setMatrixAt(i, mtx.compose(po.set(p.cx, p.y0, p.cz), q, sc.set(p.hx * 2, p.y1 - p.y0, p.hz * 2)));
    if (p.collider) frameIndex.set(p.collider, i);
  });
  frameMesh.count = frameParts.length;
  frameMesh.instanceMatrix.needsUpdate = true;
  frameMesh.computeBoundingSphere();
  if (frameParts.length) group.add(frameMesh);

  // furniture: one InstancedMesh per type (unit boxes scaled; benches get legs via a second box)
  const propIndex = new Map();
  const byType = new Map();
  for (const p of site.props) {
    const t = p.type || 'bench';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(p);
  }
  const propMeshes = [];
  const shapes = propShapes(unit);
  const propMats = {
    case: M.case,
    bench: new THREE.MeshLambertMaterial({ color: 0xa06d42 }),
    table: new THREE.MeshLambertMaterial({ color: 0xc89f72 }),
    chair: new THREE.MeshLambertMaterial({ color: 0x3b3f45 }),
    counter: new THREE.MeshLambertMaterial({ color: 0x5c4535 }),
  };
  for (const [t, list] of byType) {
    const mat = propMats[t] || M.prop;
    const im = new THREE.InstancedMesh(shapes[t] || unit, mat, list.length);
    im.name = 'cb-prop-' + t;
    im.castShadow = true;
    list.forEach((p, i) => {
      e.set(0, -(p.yaw || 0), 0);
      q.setFromEuler(e);
      im.setMatrixAt(i, mtx.compose(po.set(p.cx, p.y0, p.cz), q, sc.set(p.hx * 2, p.y1 - p.y0, p.hz * 2)));
      propIndex.set(p.collider, { im, i, p });
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
    propMeshes.push(im);
  }

  // painted boards: entrance signs and the café menus (one small canvas each; there are ~5)
  for (const sg of site.signs || []) {
    const w = sg.hx * 2;
    const h = sg.y1 - sg.y0;
    const tex = signTexture(sg, w / h);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
    m.position.set(sg.cx + sg.nx * 0.05, (sg.y0 + sg.y1) / 2, sg.cz + sg.nz * 0.05); // proud of the backing board (no z-fight)
    m.rotation.y = Math.atan2(sg.nx, sg.nz);
    m.name = 'cb-sign';
    group.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.06), M.mullion);
    back.position.set(sg.cx, (sg.y0 + sg.y1) / 2, sg.cz);
    back.rotation.y = m.rotation.y;
    group.add(back);
  }

  if (site.statues && site.statues.length) loadStatues(group, site.statues);

  // sliding entrance leaves (south / library): separate meshes so they can open
  const doorLeaves = [];
  const doorMat = M.doorglass;
  const stileMat = M.mullion;
  for (const p of site.parts) {
    if (!p.doorLeaf) continue;
    const h = p.y1 - p.y0;
    const w = p.hx * 2;
    const t = Math.max(0.12, p.hz * 2);
    const g = new THREE.Group();
    g.position.set(p.cx, p.y0, p.cz);
    g.rotation.y = -(p.yaw || 0);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.08, h - 0.08, t * 0.55), doorMat);
    pane.position.y = h / 2;
    g.add(pane);
    const rail = (y, hh) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, t), stileMat);
      m.position.y = y;
      g.add(m);
    };
    rail(0.08, 0.16);
    rail(h - 0.08, 0.16);
    rail(h * 0.48, 0.1);
    const stile = (x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, t), stileMat);
      m.position.set(x, h / 2, 0);
      g.add(m);
    };
    stile(-(p.hx - 0.05));
    stile(p.hx - 0.05);
    const inner = -(p.leaf || 1);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.14), stileMat);
    handle.position.set(inner * (p.hx - 0.22), h * 0.48, t * 0.55);
    g.add(handle);
    g.name = 'cb-door-' + p.entrance + '-' + p.leaf;
    group.add(g);
    doorLeaves.push({ group: g, part: p, t: 0 });
  }

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    group,
    meshes,
    terrain,
    glassMesh,
    update(dt) {
      uniforms.time += dt;
      water.uniforms.uTime.value = uniforms.time;
      const doors = world.siteDoors;
      for (const leaf of doorLeaves) {
        const d = doors && doors.doors.find((x) => x.id === leaf.part.entrance);
        const want = d && d.open ? 1 : 0;
        leaf.t += (want - leaf.t) * Math.min(1, dt * 8);
        const p = leaf.part;
        leaf.group.position.x = p.cx + (p.openCx - p.cx) * leaf.t;
        leaf.group.position.z = p.cz + (p.openCz - p.cz) * leaf.t;
      }
    },
    /** A broken pane / prop: hide its instance. Returns true when the collider belongs to the site. */
    hideCollider(c) {
      if (roofQuads.has(c)) return setRoofTile(c, true);
      if (paneIndex.has(c)) {
        glassMesh.setMatrixAt(paneIndex.get(c), zero);
        glassMesh.instanceMatrix.needsUpdate = true;
        return true;
      }
      if (frameIndex.has(c)) {
        frameMesh.setMatrixAt(frameIndex.get(c), zero);
        frameMesh.instanceMatrix.needsUpdate = true;
        return true;
      }
      const pr = propIndex.get(c);
      if (pr) {
        pr.im.setMatrixAt(pr.i, zero);
        pr.im.instanceMatrix.needsUpdate = true;
        return true;
      }
      return false;
    },
    showCollider(c) {
      if (roofQuads.has(c)) return setRoofTile(c, false);
      if (paneIndex.has(c)) {
        glassMesh.setMatrixAt(paneIndex.get(c), paneMatrix(c.part, mtx));
        glassMesh.instanceMatrix.needsUpdate = true;
        return true;
      }
      if (frameIndex.has(c)) {
        const p = c.part;
        e.set(0, -(p.yaw || 0), 0);
        q.setFromEuler(e);
        frameMesh.setMatrixAt(frameIndex.get(c), mtx.compose(po.set(p.cx, p.y0, p.cz), q, sc.set(p.hx * 2, p.y1 - p.y0, p.hz * 2)));
        frameMesh.instanceMatrix.needsUpdate = true;
        return true;
      }
      const pr = propIndex.get(c);
      if (pr) {
        const p = pr.p;
        e.set(0, -(p.yaw || 0), 0);
        q.setFromEuler(e);
        pr.im.setMatrixAt(pr.i, mtx.compose(po.set(p.cx, p.y0, p.cz), q, sc.set(p.hx * 2, p.y1 - p.y0, p.hz * 2)));
        pr.im.instanceMatrix.needsUpdate = true;
        return true;
      }
      return false;
    },
  };
}

/**
 * Unit-box furniture shapes (x, z in -0.5..0.5, y 0..1; scaled per instance to the collider):
 * benches get a slab seat on two legs, tables a top on a pedestal, chairs a seat, legs and a back
 * (on local -z), counters a plinth with an overhanging top.
 */
function propShapes(unit) {
  const part = (x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  };
  const merge = (list) => mergeGeometries(list, false) || unit;
  return {
    bench: merge([part(-0.5, 0.5, 0.78, 1, -0.5, 0.5), part(-0.44, -0.36, 0, 0.78, -0.4, 0.4), part(0.36, 0.44, 0, 0.78, -0.4, 0.4)]),
    table: merge([part(-0.5, 0.5, 0.93, 1, -0.5, 0.5), part(-0.06, 0.06, 0.04, 0.93, -0.06, 0.06), part(-0.3, 0.3, 0, 0.04, -0.3, 0.3)]),
    chair: merge([
      part(-0.5, 0.5, 0.5, 0.57, -0.5, 0.5), part(-0.5, 0.5, 0.57, 1, -0.5, -0.36),
      part(-0.46, -0.34, 0, 0.5, -0.46, -0.34), part(0.34, 0.46, 0, 0.5, -0.46, -0.34),
      part(-0.46, -0.34, 0, 0.5, 0.34, 0.46), part(0.34, 0.46, 0, 0.5, 0.34, 0.46),
    ]),
    counter: merge([part(-0.46, 0.46, 0, 0.93, -0.42, 0.42), part(-0.5, 0.5, 0.93, 1, -0.5, 0.5)]),
  };
}

/** Sign board canvas: 'entrance' = cream serif on dark bronze; 'menu' = chalk on slate. */
function signTexture(sg, aspect) {
  const W = 1024;
  const H = Math.max(128, Math.min(1024, Math.round(W / Math.max(0.5, aspect))));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const menu = sg.style === 'menu';
  ctx.fillStyle = menu ? '#22302d' : '#2e2620';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = menu ? 'rgba(240,235,220,0.35)' : '#b08d57';
  ctx.lineWidth = Math.max(4, H * 0.03);
  ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, W - ctx.lineWidth * 2, H - ctx.lineWidth * 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fit = (text, px, maxW) => {
    let size = px;
    do {
      ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
      size -= 2;
    } while (ctx.measureText(text).width > maxW && size > 10);
  };
  ctx.fillStyle = menu ? '#f1ecdc' : '#f3e6c8';
  fit(String(sg.text || ''), Math.round(H * 0.42), W * 0.86);
  ctx.fillText(String(sg.text || ''), W / 2, H * (sg.sub ? 0.4 : 0.5));
  if (sg.sub) {
    ctx.fillStyle = menu ? '#d9c98f' : '#c9a86a';
    fit(String(sg.sub), Math.round(H * 0.2), W * 0.86);
    ctx.fillText(String(sg.sub), W / 2, H * 0.76);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export { WALKER_LANDING };

/**
 * Statues (statues.js): one InstancedMesh per GLB, loaded after the site is up (the plinths are
 * already drawn; the figures pop in). A model that fails to load just leaves its plinths bare.
 */
async function loadStatues(group, statues) {
  const { loadGLB, flattenModel } = await import('../../core/assets.js');
  const byModel = new Map();
  for (const s of statues) {
    if (!byModel.has(s.model)) byModel.set(s.model, []);
    byModel.get(s.model).push(s);
  }
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const po = new THREE.Vector3();
  const sc = new THREE.Vector3();
  await Promise.all([...byModel].map(async ([key, list]) => {
    try {
      const gltf = await loadGLB(STATUE_MODELS[key].url);
      const flat = flattenModel(gltf.scene);
      if (!flat) return;
      const im = new THREE.InstancedMesh(flat.geometry, flat.material, list.length);
      im.name = 'cb-statue-' + key;
      im.castShadow = true;
      im.receiveShadow = true;
      list.forEach((s, i) => {
        q.setFromAxisAngle(up, s.yaw);
        im.setMatrixAt(i, mtx.compose(po.set(s.x, s.y, s.z), q, sc.setScalar(s.s)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
    } catch (err) {
      console.warn('statue model failed to load:', key, err && err.message ? err.message : err);
    }
  }));
}
