// BENTONVILLE ROYALE — turns the map data into meshes and registers every
// solid thing with the World collision grid.
//
//   const view = await buildWorldMeshes({ world, scene, models, manifests, onProgress });
//   view.update(cameraPosition, quality)   // distance culling, call a few times a second
//   view.destroyInstance(collider)         // hide a harvested tree / rock / prop / vehicle

import * as THREE from 'three';
import { makeRng } from '../core/config.js';
import { flattenModel } from '../core/assets.js';
import { pointInPoly } from './World.js';

const CHUNK = 256;
const tick = () => new Promise((r) => setTimeout(r, 0));

const AREA_COLOR = {
  water: 0x4f97cf,
  wood: 0x4d8a45,
  park: 0x84bf5f,
  grass: 0x8ac464,
  pitch: 0x6cb257,
  garden: 0x76b65c,
  parking: 0x8a8e93,
};
const MOTOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street']);
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const PATHS = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'track']);

const WALL_COLORS = {
  wood: [0xe8e2d0, 0xcfd8dc, 0xd9c9a8, 0xb7c4a1, 0xc98f6b, 0xf2efe6, 0x9fb3c8, 0xd4b483, 0xc7b8a4],
  brick: [0xb5533c, 0xa6492f, 0xc26a4a, 0x9c5a44, 0xd0b59a, 0xbfa58a, 0xad6248],
  metal: [0xcfd4d8, 0xb8c0c7, 0xe2e4e6, 0xa9b4bd, 0xd6cfc2, 0xc3ccd2],
};
const ROOF_COLORS = {
  wood: [0x5c5148, 0x6b4a3a, 0x4a4f55, 0x7a3b2e, 0x3f4a44],
  brick: [0x8b8d8f, 0x6f7376, 0x7d7468],
  metal: [0xd9dcdf, 0xbfc5ca, 0xa7adb3],
};
const STYLE = { wood: 0, brick: 1, metal: 2 };
// Tree planting: multipliers on the per-area counts for wood / park / garden polygons, and
// yard / street-tree tries per km2 of map (most tries land on a road or building and fail).
const TREE_DENSITY = { wood: 0.8, park: 0.6, garden: 0.7, yard: 2250 };

function hash01(n, salt) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shoelace(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// ------------------------------------------------------------ growable arrays

class Buf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.idx = [];
    this.extra = null;
    this.n = 0;
  }
  v(x, y, z, nx, ny, nz, r, g, b) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(r, g, b);
    return this.n++;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    return g;
  }
}

// ---------------------------------------------------------------- flat layers

const _c = new THREE.Color();

function addPolygon(buf, pts, y, hex) {
  if (pts.length < 3) return;
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, []);
  } catch (err) {
    return;
  }
  _c.setHex(hex);
  const base = buf.n;
  for (const p of pts) buf.v(p[0], y, p[1], 0, 1, 0, _c.r, _c.g, _c.b);
  for (const t of tris) {
    const a = pts[t[0]];
    const c = pts[t[1]];
    const d = pts[t[2]];
    const up = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
    if (up > 0) buf.idx.push(base + t[0], base + t[1], base + t[2]);
    else buf.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

function addRibbon(buf, pts, halfWidth, y, hex) {
  const n = pts.length;
  if (n < 2) return;
  _c.setHex(hex);
  const base = buf.n;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let d1x = p[0] - a[0];
    let d1z = p[1] - a[1];
    let d2x = b[0] - p[0];
    let d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z);
    const l2 = Math.hypot(d2x, d2z);
    if (l1 > 0) {
      d1x /= l1;
      d1z /= l1;
    } else {
      d1x = d2x / (l2 || 1);
      d1z = d2z / (l2 || 1);
    }
    if (l2 > 0) {
      d2x /= l2;
      d2z /= l2;
    } else {
      d2x = d1x;
      d2z = d1z;
    }
    let nx = -(d1z + d2z);
    let nz = d1x + d2x;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-4) {
      nx = -d1z;
      nz = d1x;
    } else {
      nx /= nl;
      nz /= nl;
    }
    // miter length, clamped so sharp corners do not spike
    const cos = Math.max(0.5, nx * -d1z + nz * d1x);
    const w = halfWidth / cos;
    buf.v(p[0] + nx * w, y, p[1] + nz * w, 0, 1, 0, _c.r, _c.g, _c.b);
    buf.v(p[0] - nx * w, y, p[1] - nz * w, 0, 1, 0, _c.r, _c.g, _c.b);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2;
    buf.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
}

function noiseTexture(size, base, spread) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rng = makeRng(1234);
  // two octaves of value noise on a wrapping lattice
  const lattice = (n) => {
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rng();
    return a;
  };
  const l1 = lattice(8);
  const l2 = lattice(32);
  const sample = (l, n, u, v) => {
    const x = u * n;
    const y = v * n;
    const x0 = Math.floor(x) % n;
    const y0 = Math.floor(y) % n;
    const x1 = (x0 + 1) % n;
    const y1 = (y0 + 1) % n;
    let fx = x - Math.floor(x);
    let fy = y - Math.floor(y);
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    return (l[y0 * n + x0] * (1 - fx) + l[y0 * n + x1] * fx) * (1 - fy) + (l[y1 * n + x0] * (1 - fx) + l[y1 * n + x1] * fx) * fy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const nse = sample(l1, 8, u, v) * 0.65 + sample(l2, 32, u, v) * 0.35 + (rng() - 0.5) * 0.12;
      const k = base + (nse - 0.5) * spread;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, k * 255));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ------------------------------------------------------------------ buildings

function buildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWall;\nattribute float aH;\nvarying vec4 vWall;\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall;\nvH = aH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWall;\nvarying float vH;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vWall.z > -0.5) {
          float style = vWall.z;
          float sp = style < 0.5 ? 3.6 : (style < 1.5 ? 3.0 : 4.4);
          float fh = 3.5;
          vec2 g = vec2(vWall.x / sp + 0.5, vWall.y / fh);
          vec2 f = fract(g);
          vec2 id = floor(g);
          vec2 lo = style < 0.5 ? vec2(0.34, 0.30) : (style < 1.5 ? vec2(0.26, 0.26) : vec2(0.07, 0.24));
          vec2 hi = style < 0.5 ? vec2(0.66, 0.68) : (style < 1.5 ? vec2(0.74, 0.74) : vec2(0.93, 0.70));
          vec2 aa = fwidth(g) * 1.2 + 1e-4;
          vec2 m = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
          float rowOk = step((id.y + hi.y) * fh + 0.25, vH);
          float colOk = step(abs(id.x) * sp + (hi.x - 0.5) * sp + 0.3, vWall.w * 0.5);
          float near = 1.0 - smoothstep(0.2, 0.5, max(aa.x, aa.y));
          float hsh = fract(sin(dot(id, vec2(12.9898, 78.233)) + vWall.w * 3.1) * 43758.5453);
          // glass: darker at the top (overhang shadow), sky reflection toward the bottom
          vec3 glass = mix(vec3(0.13, 0.19, 0.27), vec3(0.42, 0.60, 0.78), hsh * hsh);
          float gy = clamp((f.y - lo.y) / max(hi.y - lo.y, 1e-3), 0.0, 1.0);
          glass *= mix(0.72, 1.12, gy);
          // window frame: a thin dark border just outside the glass
          vec2 fr = vec2(0.035, 0.05);
          vec2 mf = smoothstep(lo - fr - aa, lo - fr + aa, f) * (1.0 - smoothstep(hi + fr - aa, hi + fr + aa, f));
          float win = rowOk * colOk * near;
          diffuseColor.rgb *= 1.0 - 0.35 * mf.x * mf.y * (1.0 - m.x * m.y) * win;
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, m.x * m.y * win);
          // sill under each window
          float sill = (1.0 - smoothstep(0.0, aa.y + 0.02, abs(f.y - (lo.y - fr.y - 0.03)))) * step(lo.x - fr.x, f.x) * step(f.x, hi.x + fr.x);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.18, sill * win);
          // plinth at the base
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.55, 0.62, vWall.y));
          // slab line between floors (brick / metal)
          if (style > 0.5) {
            float fl = fract(vWall.y / fh);
            float band = smoothstep(0.0, 0.015 + aa.y, fl) * (1.0 - smoothstep(0.06 - aa.y, 0.06, fl));
            diffuseColor.rgb *= 1.0 - 0.12 * band * near * step(1.0, vWall.y);
          }
          // parapet / cornice cap: a lighter band with a dark shadow line beneath it
          float top = vH - vWall.y;
          diffuseColor.rgb *= mix(1.0, 1.14, 1.0 - smoothstep(0.42, 0.46, top));
          diffuseColor.rgb *= 1.0 - 0.28 * smoothstep(0.42, 0.46, top) * (1.0 - smoothstep(0.58, 0.64, top));
          // corners: darker pilaster at each end of the wall so building edges read up close
          float edge = vWall.w * 0.5 - abs(vWall.x);
          diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(0.32, 0.4, edge));
          // low-frequency grime so a large wall is not one flat colour
          float gx = floor(vWall.x / 1.3);
          float gz = floor(vWall.y / 1.1);
          float grime = fract(sin(gx * 91.7 + gz * 47.3 + vWall.w * 1.7) * 43758.5453);
          diffuseColor.rgb *= 1.0 - 0.05 * grime * near;
          // darker toward the ground (fake AO)
          diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 2.5, vWall.y));
          if (style < 0.5) {
            float l = smoothstep(0.0, 0.1, fract(vWall.y / 0.4));
            diffuseColor.rgb *= mix(1.0, mix(0.9, 1.0, l), near);
          }
        }`
      );
  };
  mat.customProgramCacheKey = () => 'br-building-v2';
  return mat;
}

const INTERIOR_WALL = { wood: 0xe9e1cf, brick: 0xd8d2c6, metal: 0xc9ccce };
const FLOOR_COLOR = { wood: 0x9b7a55, brick: 0x8d8780, metal: 0x7b8086 };
const CEILING_COLOR = 0xeceae4;

/** Push a quad a-b-c-d (each [x, y, z]) facing normal (nx, ny, nz); winding picked from the normal. */
function quad(chunk, a, b, c, d, nx, ny, nz, r, g, bl, wallAttr, h) {
  const buf = chunk.buf;
  const i0 = buf.v(a[0], a[1], a[2], nx, ny, nz, r, g, bl);
  buf.v(b[0], b[1], b[2], nx, ny, nz, r, g, bl);
  buf.v(c[0], c[1], c[2], nx, ny, nz, r, g, bl);
  buf.v(d[0], d[1], d[2], nx, ny, nz, r, g, bl);
  for (let k = 0; k < 4; k++) chunk.wall.push(...(wallAttr ? wallAttr[k] : NO_WALL));
  chunk.bh.push(h, h, h, h);
  // (b - a) x (c - a) against the wanted normal
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  if (cx * nx + cy * ny + cz * nz >= 0) buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  else buf.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
}
const NO_WALL = [0, 0, -1, 0];

/** Horizontal polygon (flat [x, z, ...] or [[x, z], ...]) at height y facing up (dir 1) or down (-1), with precomputed triangles. */
function hcap(chunk, pts, tris, y, dir, hex, h) {
  const buf = chunk.buf;
  _c.setHex(hex);
  const base = buf.n;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    buf.v(pts[i * 2], y, pts[i * 2 + 1], 0, dir, 0, _c.r, _c.g, _c.b);
    chunk.wall.push(0, y, -1, 0);
    chunk.bh.push(h);
  }
  for (const t of tris) {
    const ax = pts[t[0] * 2];
    const az = pts[t[0] * 2 + 1];
    const up = (pts[t[1] * 2 + 1] - az) * (pts[t[2] * 2] - ax) - (pts[t[1] * 2] - ax) * (pts[t[2] * 2 + 1] - az);
    if (up > 0 === dir > 0) buf.idx.push(base + t[0], base + t[1], base + t[2]);
    else buf.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/**
 * Building mesh. `shell` (World collider.shell, or null for a solid prism) adds
 * door openings, the wall thickness (an inner face), door jambs and lintels, an
 * interior floor and ceiling. Geometry sits on y = 0 like the rest of the map.
 */
function addBuilding(chunk, b, tint, shell) {
  const pts = b.p;
  const n = pts.length;
  const h = b.h;
  const sign = shoelace(pts) < 0 ? 1 : -1; // stored winding is negative; flip normals if not
  const wallHex = tint?.wall ?? WALL_COLORS[b.mat][Math.floor(hash01(b.id, 3) * WALL_COLORS[b.mat].length)];
  const roofHex = tint?.roof ?? ROOF_COLORS[b.mat][Math.floor(hash01(b.id, 4) * ROOF_COLORS[b.mat].length)];
  const style = STYLE[b.mat] ?? 1;
  const shade = 0.93 + hash01(b.id, 5) * 0.12;
  _c.setHex(wallHex);
  const wr = _c.r * shade;
  const wg = _c.g * shade;
  const wb = _c.b * shade;
  const buf = chunk.buf;
  const wall = chunk.wall;
  const bh = chunk.bh;

  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
  } catch (err) {
    tris = [];
  }

  if (shell) {
    addShell(chunk, b, shell, sign, style, wr, wg, wb, tris);
  } else {
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % n];
      const ex = c[0] - a[0];
      const ez = c[1] - a[1];
      const len = Math.hypot(ex, ez);
      if (len < 0.05) continue;
      const nx = (-ez / len) * sign;
      const nz = (ex / len) * sign;
      const i0 = buf.v(a[0], 0, a[1], nx, 0, nz, wr, wg, wb);
      buf.v(c[0], 0, c[1], nx, 0, nz, wr, wg, wb);
      buf.v(c[0], h, c[1], nx, 0, nz, wr, wg, wb);
      buf.v(a[0], h, a[1], nx, 0, nz, wr, wg, wb);
      wall.push(-len / 2, 0, style, len, len / 2, 0, style, len, len / 2, h, style, len, -len / 2, h, style, len);
      bh.push(h, h, h, h);
      if (sign > 0) buf.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
      else buf.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
    }
  }

  _c.setHex(roofHex);
  const base = buf.n;
  for (const p of pts) {
    buf.v(p[0], h, p[1], 0, 1, 0, _c.r, _c.g, _c.b);
    wall.push(0, h, -1, 0);
    bh.push(h);
  }
  for (const t of tris) {
    const a = pts[t[0]];
    const c = pts[t[1]];
    const d = pts[t[2]];
    // make the triangle face up (+y): (c-a) x (d-a) must have positive y
    const up = (c[1] - a[1]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[1] - a[1]);
    if (up > 0) buf.idx.push(base + t[0], base + t[1], base + t[2]);
    else buf.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

/** Walls with door openings + inner faces, jambs, lintels, floor and ceiling of a hollow building. */
function addShell(chunk, b, shell, sign, style, wr, wg, wb, tris) {
  const pts = b.p;
  const n = pts.length;
  const h = b.h;
  const inner = shell.inner;
  const top = shell.ceilRel; // interior ceiling above the floor
  const dh = shell.doorH;
  _c.setHex(INTERIOR_WALL[b.mat] || INTERIOR_WALL.brick);
  const ishade = 0.95 + hash01(b.id, 6) * 0.08;
  const ir = _c.r * ishade;
  const ig = _c.g * ishade;
  const ib = _c.b * ishade;
  // outer-wall shader attributes: x along the whole edge (so windows stay continuous), height, style, length
  const wa = (len, f0, f1, y0, y1) => {
    const x0 = -len / 2 + f0 * len;
    const x1 = -len / 2 + f1 * len;
    return [[x0, y0, style, len], [x1, y0, style, len], [x1, y1, style, len], [x0, y1, style, len]];
  };
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const a = pts[i];
    const c = pts[k];
    const ex = c[0] - a[0];
    const ez = c[1] - a[1];
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    const nx = (-ez / len) * sign; // outward
    const nz = (ex / len) * sign;
    const qa = [inner[i * 2], inner[i * 2 + 1]];
    const qc = [inner[k * 2], inner[k * 2 + 1]];
    const O = (f, y) => [a[0] + ex * f, y, a[1] + ez * f];
    const I = (f, y) => [qa[0] + (qc[0] - qa[0]) * f, y, qa[1] + (qc[1] - qa[1]) * f];
    const solid = (f0, f1) => {
      quad(chunk, O(f0, 0), O(f1, 0), O(f1, h), O(f0, h), nx, 0, nz, wr, wg, wb, wa(len, f0, f1, 0, h), h);
      quad(chunk, I(f0, 0), I(f1, 0), I(f1, top), I(f0, top), -nx, 0, -nz, ir, ig, ib, null, h);
    };
    let f = 0;
    for (const d of shell.doors) {
      if (d.e !== i) continue;
      if (d.f0 > f) solid(f, d.f0);
      // above the opening: outer lintel face, inner face, underside
      quad(chunk, O(d.f0, dh), O(d.f1, dh), O(d.f1, h), O(d.f0, h), nx, 0, nz, wr, wg, wb, wa(len, d.f0, d.f1, dh, h), h);
      quad(chunk, I(d.f0, dh), I(d.f1, dh), I(d.f1, top), I(d.f0, top), -nx, 0, -nz, ir, ig, ib, null, h);
      quad(chunk, O(d.f0, dh), O(d.f1, dh), I(d.f1, dh), I(d.f0, dh), 0, -1, 0, ir, ig, ib, null, h);
      // jambs: the wall's cut ends, facing into the opening
      const tx = ex / len;
      const tz = ez / len;
      quad(chunk, O(d.f0, 0), I(d.f0, 0), I(d.f0, dh), O(d.f0, dh), tx, 0, tz, wr, wg, wb, null, h);
      quad(chunk, O(d.f1, 0), I(d.f1, 0), I(d.f1, dh), O(d.f1, dh), -tx, 0, -tz, wr, wg, wb, null, h);
      f = d.f1;
    }
    if (f < 1) solid(f, 1);
  }
  // interior floor (just above the ground layers) and ceiling; the inner ring has the
  // footprint's vertex order, so the footprint triangulation is reused
  hcap(chunk, inner, tris, 0.03, 1, FLOOR_COLOR[b.mat] || FLOOR_COLOR.brick, h);
  hcap(chunk, inner, tris, top, -1, CEILING_COLOR, h);
}

// ------------------------------------------------------------- instanced sets

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

class Scatter {
  constructor(scene, shadows) {
    this.scene = scene;
    this.shadows = shadows;
    this.defs = new Map();
    this.buckets = new Map(); // "cx,cz|name" -> records
    this.meshes = [];
  }

  define(name, gltf, scale) {
    if (!gltf) return false;
    const flat = flattenModel(gltf.scene);
    if (!flat) return false;
    this.defs.set(name, { geometry: flat.geometry, material: flat.material, scale });
    return true;
  }

  has(name) {
    return this.defs.has(name);
  }

  /** Returns a record you can later pass to hide(). */
  add(name, x, z, rotY, scaleMul = 1, colorHex = null, y = 0) {
    const def = this.defs.get(name);
    if (!def) return null;
    const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK) + '|' + name;
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    const rec = { name, x, y, z, rotY, scale: def.scale * scaleMul, color: colorHex, mesh: null, index: list.length };
    list.push(rec);
    return rec;
  }

  build() {
    for (const [key, list] of this.buckets) {
      const def = this.defs.get(key.split('|')[1]);
      const mesh = new THREE.InstancedMesh(def.geometry, def.material, list.length);
      let cx = 0;
      let cz = 0;
      for (const rec of list) {
        _q.setFromAxisAngle(_up, rec.rotY);
        _m.compose(_p.set(rec.x, rec.y, rec.z), _q, _s.setScalar(rec.scale));
        mesh.setMatrixAt(rec.index, _m);
        if (rec.color != null) mesh.setColorAt(rec.index, _c.setHex(rec.color));
        rec.mesh = mesh;
        cx += rec.x;
        cz += rec.z;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = true;
      mesh.userData.cx = cx / list.length;
      mesh.userData.cz = cz / list.length;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.buckets.clear();
  }

  hide(rec) {
    if (!rec || !rec.mesh) return;
    rec.mesh.setMatrixAt(rec.index, _zero);
    rec.mesh.instanceMatrix.needsUpdate = true;
  }

  show(rec) {
    if (!rec || !rec.mesh) return;
    _q.setFromAxisAngle(_up, rec.rotY);
    _m.compose(_p.set(rec.x, rec.y, rec.z), _q, _s.setScalar(rec.scale));
    rec.mesh.setMatrixAt(rec.index, _m);
    rec.mesh.instanceMatrix.needsUpdate = true;
  }

  cull(cam, dist) {
    const lim = dist + CHUNK * 0.75;
    const lim2 = lim * lim;
    for (const m of this.meshes) {
      const dx = m.userData.cx - cam.x;
      const dz = m.userData.cz - cam.z;
      m.visible = dx * dx + dz * dz < lim2;
    }
  }
}

// ----------------------------------------------------------------------- main

export async function buildWorldMeshes({ world, scene, models, manifests, onProgress }) {
  const data = world.data;
  const b = world.bounds;
  const rng = makeRng(20261114);
  const progress = (v, label) => onProgress && onProgress(v, label);
  // Prop / scatter caps were tuned on the original 18.1 km2 downtown map; scale them
  // with the map area so the expanded map (Phase 2) keeps the same density.
  const areaK = Math.max(1, ((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 18.1e6);
  const cap = (n) => Math.round(n * areaK);
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  // ---- ground
  progress(0.02, 'Laying out the ground');
  const margin = 2600;
  const gw = b.maxX - b.minX + margin * 2;
  const gd = b.maxZ - b.minZ + margin * 2;
  const groundTex = noiseTexture(256, 0.92, 0.22);
  groundTex.repeat.set(gw / 70, gd / 70);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), new THREE.MeshLambertMaterial({ color: 0x7daf58, map: groundTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  ground.receiveShadow = true;
  ground.renderOrder = -2;
  root.add(ground);

  // ---- flat layers: land cover, sidewalks, paths, roads, centre lines (painter's order in one mesh)
  const flat = new Buf();
  for (const a of data.areas) {
    if (!AREA_COLOR[a.k]) continue;
    addPolygon(flat, a.p, 0, AREA_COLOR[a.k]);
    world.addArea(a.p, a.k);
  }
  for (const w of data.waterways || []) addRibbon(flat, w.p, w.k === 'river' ? 5 : 1.6, 0, AREA_COLOR.water);
  await tick();
  for (const r of data.roads) if (MOTOR.has(r.k)) addRibbon(flat, r.p, r.w / 2 + 1.7, 0, 0xb7b3a8);
  for (const r of data.roads) {
    if (!PATHS.has(r.k)) continue;
    const hex = r.k === 'path' || r.k === 'track' ? 0xb7a27a : r.k === 'pedestrian' ? 0xd9d1bd : r.k === 'cycleway' ? 0xc4bda8 : 0xcdc5b0;
    addRibbon(flat, r.p, r.w / 2, 0, hex);
  }
  for (const r of data.roads) if (r.k === 'service') addRibbon(flat, r.p, r.w / 2, 0, 0x64686d);
  for (const r of data.roads) if (MOTOR.has(r.k)) addRibbon(flat, r.p, r.w / 2, 0, MAJOR.has(r.k) ? 0x484c52 : 0x53575c);
  for (const r of data.roads) if (MAJOR.has(r.k)) addRibbon(flat, r.p, 0.14, 0, 0xe3c545);
  for (const r of data.roads) {
    for (let i = 0; i + 1 < r.p.length; i++) world.addRoadSegment(r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w, r.k);
  }
  const flatMesh = new THREE.Mesh(
    flat.geometry(),
    new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
  );
  flatMesh.receiveShadow = true;
  flatMesh.renderOrder = -1;
  flatMesh.frustumCulled = false;
  root.add(flatMesh);
  progress(0.15, 'Raising buildings');
  await tick();

  // ---- buildings
  const tints = new Map();
  const lm = world.landmarks;
  const tintIds = (key, tint) => {
    if (lm[key] && lm[key].ids) for (const id of lm[key].ids) tints.set(id, tint);
  };
  tintIds('crystal_bridges', { wall: 0xd8d0bc, roof: 0xb0703c });
  tintIds('courthouse', { wall: 0xe6dcc3, roof: 0x7f8a8c });
  tintIds('walmart_museum', { wall: 0xc9483a, roof: 0x5c5148 });
  tintIds('momentary', { wall: 0xd9dde0, roof: 0xe2574c });
  // 8th Street Market is a converted plant: warm industrial grey, not a sky-blue slab
  tintIds('market_8th', { wall: 0xbdb3a1, roof: 0x6f7376 });

  const chunks = new Map();
  const placed = []; // [chunk, map record, collider] triples
  let count = 0;
  for (const bd of data.buildings) {
    if (!bd.p || bd.p.length < 3) continue;
    let cx = 0;
    let cz = 0;
    for (const p of bd.p) {
      cx += p[0];
      cz += p[1];
    }
    const key = Math.floor(cx / bd.p.length / CHUNK) + ',' + Math.floor(cz / bd.p.length / CHUNK);
    let chunk = chunks.get(key);
    if (!chunk) chunks.set(key, (chunk = { buf: new Buf(), wall: [], bh: [] }));
    placed.push(chunk, bd, world.addBuilding(bd));
    if (++count % 2000 === 0) {
      progress(0.15 + 0.1 * (count / data.buildings.length), 'Raising buildings');
      await tick();
    }
  }
  // doors need every building and road registered first (road-facing, not into a neighbour)
  world.finishBuildings();
  await tick();
  for (let i = 0; i < placed.length; i += 3) {
    const bd = placed[i + 1];
    addBuilding(placed[i], bd, tints.get(bd.id), placed[i + 2].shell || null);
    if ((i / 3) % 600 === 599) {
      progress(0.25 + 0.2 * (i / placed.length), 'Raising buildings');
      await tick();
    }
  }
  const bMat = buildingMaterial();
  const buildingMeshes = [];
  for (const chunk of chunks.values()) {
    const g = chunk.buf.geometry();
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(chunk.wall, 4));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(chunk.bh, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, bMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cx = g.boundingSphere.center.x;
    mesh.userData.cz = g.boundingSphere.center.z;
    mesh.userData.r = g.boundingSphere.radius;
    root.add(mesh);
    buildingMeshes.push(mesh);
  }
  progress(0.48, 'Parking cars');
  await tick();

  // ---- instanced props
  const trees = new Scatter(root, true);
  const props = new Scatter(root, true);
  const scaleOf = (list, file) => (list || []).find((m) => m.file === file)?.suggestedUniformScale || 1;
  const TREE_NAMES = ['tree_a', 'tree_b', 'tree_c', 'tree_d', 'pine_a', 'pine_b'];
  const TREE_H = { tree_a: 9, tree_b: 6.5, tree_c: 7, tree_d: 5.5, pine_a: 10, pine_b: 9 };
  for (const n of TREE_NAMES) trees.define(n, models[n], scaleOf(manifests.nature, n + '.glb'));
  for (const n of ['rock_a', 'rock_b', 'rock_c', 'bush_a', 'bush_b', 'stump']) props.define(n, models[n], scaleOf(manifests.nature, n + '.glb'));
  for (const n of ['bench', 'streetlamp', 'streetlamp_curved', 'fire_hydrant', 'dumpster', 'trash_can', 'table', 'parasol', 'tent', 'traffic_cone', 'planter'])
    props.define(n, models[n], scaleOf(manifests.props, n + '.glb'));
  const VEHICLES = ['sedan', 'suv', 'pickup', 'van', 'truck'];
  const VEH_LEN = { sedan: 4.6, suv: 4.8, pickup: 5.6, van: 5, truck: 7 };
  for (const n of VEHICLES) props.define(n, models[n], scaleOf(manifests.vehicles, n + '.glb'));

  const isOpen = (x, z, r) => world.inBounds(x, z, 4) && !world.blockedAt(x, z, r) && !world.roadAt(x, z, 1.2);
  const harvestables = { trees: 0, rocks: 0, props: 0, vehicles: 0 };

  // parked vehicles
  const CAR_TINTS = [0xffffff, 0xf2f2f2, 0xd9dde2, 0xff8f80, 0x8fb8ff, 0xffd98a, 0xa9e0a0, 0x9aa0a8, 0x70757c];
  let cars = 0;
  for (const a of data.areas) {
    if (a.k !== 'parking' || cars >= cap(650)) continue;
    const p = a.p;
    let best = 0;
    let ang = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      const l = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
      if (l > best) {
        best = l;
        ang = Math.atan2(q[1] - p[i][1], q[0] - p[i][0]);
      }
      minX = Math.min(minX, p[i][0]);
      maxX = Math.max(maxX, p[i][0]);
      minZ = Math.min(minZ, p[i][1]);
      maxZ = Math.max(maxZ, p[i][1]);
    }
    const flatP = new Float32Array(p.length * 2);
    p.forEach((q, i) => {
      flatP[i * 2] = q[0];
      flatP[i * 2 + 1] = q[1];
    });
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    const cxm = (minX + maxX) / 2;
    const czm = (minZ + maxZ) / 2;
    const ext = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    let placed = 0;
    for (let row = -ext; row <= ext && placed < 45; row += 9) {
      for (let col = -ext; col <= ext && placed < 45; col += 3) {
        if (rng() > 0.3) continue;
        const x = cxm + ux * col - uz * row;
        const z = czm + uz * col + ux * row;
        if (!pointInPoly(flatP, p.length, x, z) || !pointInPoly(flatP, p.length, x - uz * 2.6, z + ux * 2.6) || !pointInPoly(flatP, p.length, x + uz * 2.6, z - ux * 2.6)) continue;
        if (world.blockedAt(x, z, 2.6) || world.roadAt(x, z, 0.5)) continue;
        const name = VEHICLES[Math.floor(rng() * rng() * VEHICLES.length)];
        if (!props.has(name)) continue;
        // the car's long axis (+z in model space) runs across the row
        const fx = -uz;
        const fz = ux;
        const flip = rng() < 0.5 ? Math.PI : 0;
        const rec = props.add(name, x, z, Math.atan2(fx, fz) + flip, 1, CAR_TINTS[Math.floor(rng() * CAR_TINTS.length)]);
        const hl = VEH_LEN[name] / 2;
        const hw = 0.95;
        const corners = [
          [x + fx * hl + ux * hw, z + fz * hl + uz * hw],
          [x + fx * hl - ux * hw, z + fz * hl - uz * hw],
          [x - fx * hl - ux * hw, z - fz * hl - uz * hw],
          [x - fx * hl + ux * hw, z - fz * hl + uz * hw],
        ];
        const col2 = world.addPoly(corners, name === 'truck' ? 2.3 : 1.5, 'vehicle', 'metal', [rec]);
        col2.hp = col2.maxHp = 300;
        col2.x = x;
        col2.z = z;
        placed++;
        cars++;
        harvestables.vehicles++;
      }
    }
  }
  progress(0.56, 'Planting trees');
  await tick();

  // street furniture along roads
  let lamps = 0;
  let hydrants = 0;
  for (const r of data.roads) {
    const lampRoad = MAJOR.has(r.k) || r.k === 'residential';
    if (!lampRoad) continue;
    let carry = hash01(r.id, 7) * 55;
    let side = hash01(r.id, 8) < 0.5 ? 1 : -1;
    for (let i = 0; i + 1 < r.p.length; i++) {
      const ax = r.p[i][0];
      const az = r.p[i][1];
      const dx = r.p[i + 1][0] - ax;
      const dz = r.p[i + 1][1] - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      for (let d = carry; d < len; d += 55) {
        const off = r.w / 2 + 2.3;
        const x = ax + (dx / len) * d + (-dz / len) * off * side;
        const z = az + (dz / len) * d + (dx / len) * off * side;
        side = -side;
        if (!world.inBounds(x, z, 4) || world.blockedAt(x, z, 0.6) || world.roadAt(x, z, 0.4)) continue;
        if (lamps < cap(1800) && props.has('streetlamp')) {
          const name = MAJOR.has(r.k) ? 'streetlamp_curved' : 'streetlamp';
          const rec = props.add(props.has(name) ? name : 'streetlamp', x, z, Math.atan2(dx, dz) + (side > 0 ? 0 : Math.PI));
          world.addCircle(x, z, 0.22, 6, 'prop', 'metal', 120, [rec]);
          lamps++;
          harvestables.props++;
        }
        if (hydrants < cap(450) && props.has('fire_hydrant') && hash01(r.id + i * 31 + Math.floor(d), 9) < 0.3) {
          const hx = x + (dx / len) * 6;
          const hz = z + (dz / len) * 6;
          if (!world.blockedAt(hx, hz, 0.5) && !world.roadAt(hx, hz, 0.3)) {
            const rec = props.add('fire_hydrant', hx, hz, rng() * 6.28);
            world.addCircle(hx, hz, 0.28, 0.75, 'prop', 'metal', 80, [rec]);
            hydrants++;
            harvestables.props++;
          }
        }
      }
      carry = (carry - len) % 55;
      if (carry < 0) carry += 55;
    }
  }

  // dumpsters behind the bigger commercial buildings
  let dumpsters = 0;
  if (props.has('dumpster')) {
    for (const bd of data.buildings) {
      if (dumpsters >= cap(450) || bd.a < 350 || bd.mat === 'wood' || hash01(bd.id, 11) > 0.6) continue;
      const i = Math.floor(hash01(bd.id, 12) * bd.p.length);
      const a = bd.p[i];
      const c = bd.p[(i + 1) % bd.p.length];
      const ex = c[0] - a[0];
      const ez = c[1] - a[1];
      const len = Math.hypot(ex, ez);
      if (len < 5) continue;
      const sign = shoelace(bd.p) < 0 ? 1 : -1;
      const x = (a[0] + c[0]) / 2 + (-ez / len) * sign * 1.7;
      const z = (a[1] + c[1]) / 2 + (ex / len) * sign * 1.7;
      if (!isOpen(x, z, 1.3)) continue;
      const rec = props.add('dumpster', x, z, Math.atan2(ex, ez));
      world.addCircle(x, z, 1.05, 1.4, 'prop', 'metal', 240, [rec]);
      dumpsters++;
      harvestables.props++;
    }
  }

  // park furniture
  const areaInfo = data.areas.map((a) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const fp = new Float32Array(a.p.length * 2);
    a.p.forEach((q, i) => {
      fp[i * 2] = q[0];
      fp[i * 2 + 1] = q[1];
      minX = Math.min(minX, q[0]);
      maxX = Math.max(maxX, q[0]);
      minZ = Math.min(minZ, q[1]);
      maxZ = Math.max(maxZ, q[1]);
    });
    return { a, fp, n: a.p.length, minX, maxX, minZ, maxZ, area: Math.abs(shoelace(a.p)) };
  });
  const sampleIn = (info, out) => {
    for (let i = 0; i < 12; i++) {
      const x = info.minX + rng() * (info.maxX - info.minX);
      const z = info.minZ + rng() * (info.maxZ - info.minZ);
      if (pointInPoly(info.fp, info.n, x, z)) {
        out.x = x;
        out.z = z;
        return true;
      }
    }
    return false;
  };
  const pt = { x: 0, z: 0 };
  for (const info of areaInfo) {
    if ((info.a.k !== 'park' && info.a.k !== 'garden') || info.area < 600) continue;
    const n = Math.min(8, Math.ceil(info.area / 2500));
    for (let i = 0; i < n; i++) {
      if (!sampleIn(info, pt) || !isOpen(pt.x, pt.z, 1.2) || world.areaAt(pt.x, pt.z) === 'water') continue;
      const rot = rng() * 6.28;
      if (rng() < 0.6 && props.has('bench')) {
        const recs = [props.add('bench', pt.x, pt.z, rot)];
        if (props.has('trash_can')) recs.push(props.add('trash_can', pt.x + Math.cos(rot) * 1.3, pt.z - Math.sin(rot) * 1.3, rot));
        world.addCircle(pt.x, pt.z, 0.7, 0.85, 'prop', 'wood', 100, recs);
      } else if (props.has('table')) {
        const recs = [props.add('table', pt.x, pt.z, rot)];
        if (props.has('parasol') && rng() < 0.6) recs.push(props.add('parasol', pt.x, pt.z, rot));
        world.addCircle(pt.x, pt.z, 0.9, 0.8, 'prop', 'wood', 100, recs);
      }
      harvestables.props++;
    }
  }
  // a market on the square and at 8th Street Market
  for (const key of ['square', 'market_8th', 'momentary']) {
    const l = lm[key];
    if (!l) continue;
    for (let i = 0; i < 9; i++) {
      world.randomOpenPoint(rng, l.x, l.z, Math.min(60, l.r + 15), 2.2, pt);
      if (!isOpen(pt.x, pt.z, 2.2)) continue;
      const rot = Math.floor(rng() * 4) * (Math.PI / 2);
      if (i % 3 === 0 && props.has('tent')) {
        const rec = props.add('tent', pt.x, pt.z, rot);
        world.addCircle(pt.x, pt.z, 1.3, 2, 'prop', 'wood', 160, [rec]);
      } else if (props.has('table')) {
        const recs = [props.add('table', pt.x, pt.z, rot)];
        if (props.has('parasol')) recs.push(props.add('parasol', pt.x, pt.z, rot));
        world.addCircle(pt.x, pt.z, 0.9, 0.8, 'prop', 'wood', 100, recs);
      }
      harvestables.props++;
    }
  }
  await tick();

  // trees: mapped ones, then woods and parks, then yards everywhere
  const addTree = (x, z, pine) => {
    if (!isOpen(x, z, 1.1)) return false;
    const k = world.areaAt(x, z);
    if (k === 'water' || k === 'parking' || k === 'pitch') return false;
    const pool = pine ? 4 + Math.floor(rng() * 2) : Math.floor(rng() * 4);
    let name = TREE_NAMES[pool];
    if (!trees.has(name)) name = TREE_NAMES.find((t) => trees.has(t));
    if (!name) return false;
    const s = 0.8 + rng() * 0.55;
    const rec = trees.add(name, x, z, rng() * 6.28, s);
    const h = TREE_H[name] * s;
    world.addCircle(x, z, 0.32 + h * 0.022, h * 0.8, 'tree', 'wood', 200, [rec]);
    harvestables.trees++;
    return true;
  };
  // Every tree is planted through addTree, so its collider always matches what is drawn.
  const treesBy = { mapped: 0, wood: 0, park: 0, garden: 0, yard: 0 };
  const plant = (src, x, z, pine) => addTree(x, z, pine) && treesBy[src]++;
  for (const t of data.trees) plant('mapped', t[0], t[1], false);
  for (const info of areaInfo) {
    const k = info.a.k;
    if (k !== 'wood' && k !== 'park' && k !== 'garden') continue;
    const n = (k === 'wood' ? Math.min(1400, info.area / 75) : Math.min(2600, info.area / (k === 'garden' ? 220 : 420))) * TREE_DENSITY[k];
    for (let i = 0; i < n; i++) if (sampleIn(info, pt)) plant(k, pt.x, pt.z, rng() < (k === 'wood' ? 0.45 : 0.2));
  }
  progress(0.7, 'Planting trees');
  await tick();
  // yard / street trees: TREE_DENSITY.yard tries per km2 of map (not cap(): on a small map
  // that floor of 1 would pack the original map's 7000 tries into a fraction of the area)
  const mapKm2 = ((b.maxX - b.minX) * (b.maxZ - b.minZ)) / 1e6;
  for (let i = 0, n = Math.round(TREE_DENSITY.yard * mapKm2); i < n; i++) {
    const x = b.minX + rng() * (b.maxX - b.minX);
    const z = b.minZ + rng() * (b.maxZ - b.minZ);
    plant('yard', x, z, rng() < 0.2);
  }
  // rocks and bushes
  for (let i = 0, n = cap(2600); i < n; i++) {
    const x = b.minX + rng() * (b.maxX - b.minX);
    const z = b.minZ + rng() * (b.maxZ - b.minZ);
    const k = world.areaAt(x, z);
    if (k === 'water' || k === 'parking' || k === 'pitch') continue;
    const wild = k === 'wood' || k === 'park';
    if (i % 3 === 0 && (wild || rng() < 0.35)) {
      const name = ['rock_a', 'rock_b', 'rock_b', 'rock_c'][Math.floor(rng() * 4)];
      if (!props.has(name) || !isOpen(x, z, 1.4)) continue;
      const s = 0.8 + rng() * 0.8;
      const rec = props.add(name, x, z, rng() * 6.28, s);
      if (name !== 'rock_c') {
        world.addCircle(x, z, (name === 'rock_b' ? 0.95 : 0.85) * s, (name === 'rock_b' ? 2.1 : 0.62) * s, 'rock', 'brick', 220, [rec]);
        harvestables.rocks++;
      }
    } else {
      const name = rng() < 0.5 ? 'bush_a' : 'bush_b';
      if (props.has(name) && isOpen(x, z, 0.8)) props.add(name, x, z, rng() * 6.28, 0.8 + rng() * 0.7);
    }
  }
  progress(0.82, 'Finishing touches');
  await tick();
  trees.build();
  props.build();
  await tick();

  const view = {
    root,
    counts: { buildings: count, hollow: world.counts.hollow || 0, chunks: buildingMeshes.length, cars, lamps, ...harvestables, treesBy },
    /** Distance-cull chunks. `q` is a QUALITY entry. */
    update(cam, q) {
      trees.cull(cam, q.treeDist);
      props.cull(cam, q.propDist);
      for (const m of buildingMeshes) {
        const dx = m.userData.cx - cam.x;
        const dz = m.userData.cz - cam.z;
        const lim = q.buildingDist + m.userData.r;
        m.visible = dx * dx + dz * dz < lim * lim;
      }
    },
    /** Hide the instances behind a harvested collider. */
    hideCollider(col) {
      if (!Array.isArray(col.ref)) return;
      for (const rec of col.ref) (TREE_H[rec.name] ? trees : props).hide(rec);
    },
    showCollider(col) {
      if (!Array.isArray(col.ref)) return;
      for (const rec of col.ref) (TREE_H[rec.name] ? trees : props).show(rec);
    },
  };
  progress(0.85, 'World ready');
  return view;
}
