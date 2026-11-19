// BENTONVILLE ROYALE — Bentonville High School kit: meshes (three.js, browser only).
//
//   const view = buildKitMeshes({ root, kit, name: 'bhs' })
//   view.update(dt, ctx) ; view.hideCollider(c) ; view.showCollider(c) ; view.owns(c)
//
// Draws every kit part and decor as merged geometry: one mesh per (group, look). UVs are
// world-space metres (materials.js tiles), so brick courses, block joints and floor tiles stay
// real-size and continuous across pieces. Vertex colours carry a soft baked contact-shadow term
// (darker near the bottom of walls and columns, a little under slabs). Groups other than 'ext'
// are interiors / details: hidden beyond STREAM_DIST from the camera (rooms load only nearby).
// A broken collider's quads are collapsed (its decor with it) and restored on match restart.
// Lighting: emissive fixtures and ceiling fill; the point-light pool (POOL) is off, see below.

import * as THREE from 'three';
import { materialFor, BOX_MAPPED } from './materials.js';

const STREAM_DIST = 75; // m from a group's bounds to the camera: interiors beyond are hidden
const FINE_DIST = 30; // small interior props (chair legs, books, cups...) draw only this close
const FINE_SIZE = 0.7; // m: decor no wider than this in plan is a 'fine' prop
// Real point lights that follow the camera. OFF: three.js shades EVERY lit fragment in the scene
// for each point light, so even 4 cost ~20% frame rate everywhere, other POIs included (measured
// 2026-11-19). BHS interiors are lit by emissive fixtures and the ceiling fill (materials.js).
const POOL = 0;

class Buf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.ranges = new Map(); // collider -> [[v0, v1), ...]
  }
  get n() {
    return this.pos.length / 3;
  }
  quad(p, n, uv, shadeA = 1, shadeB = 1) {
    const i = this.n;
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k][0], p[k][1], p[k][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uv[k][0], uv[k][1]);
      const s = k < 2 ? shadeA : shadeB;
      const t = this.tint;
      if (t) this.col.push(s * t[0], s * t[1], s * t[2]);
      else this.col.push(s, s, s);
    }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Face look for face key of a box (faces override, else the box look). */
const faceLook = (b, k) => (b.faces && b.faces[k] !== undefined ? b.faces[k] : b.look);

/**
 * Emit an oriented box into per-look buffers via get(look) -> Buf (or null to skip).
 * Corners in local (u, v): u along (cos, sin), v along (-sin, cos).
 */
function emitBox(b, get, ao) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const P = (u, v, y) => [b.cx + u * c - v * s, y, b.cz + u * s + v * c];
  const { hx, hz, y0, y1 } = b;
  const tall = y1 - y0;
  // contact shade at the bottom of a tall vertical piece standing on a floor
  const bot = ao && tall > 1.2 ? 0.74 : ao ? 0.86 : 1;
  const faces = [
    // key, corners (bottom-left, bottom-right, top-right, top-left seen from outside), normal, length along face
    ['pu', [[hx, hz], [hx, -hz]], [c, 0, s], 2 * hz],
    ['nu', [[-hx, -hz], [-hx, hz]], [-c, 0, -s], 2 * hz],
    ['pv', [[-hx, hz], [hx, hz]], [-s, 0, c], 2 * hx],
    ['nv', [[hx, -hz], [-hx, -hz]], [s, 0, -c], 2 * hx],
  ];
  for (const [k, [a, d], n] of faces) {
    const look = faceLook(b, k);
    const buf = get(look);
    if (!buf) continue;
    const A = P(a[0], a[1], y0);
    const D = P(d[0], d[1], y0);
    // world-space u: the projection of the corner on the face's tangent (continuous across pieces)
    const tx = -n[2];
    const tz = n[0];
    const ua = A[0] * tx + A[2] * tz;
    const ud = D[0] * tx + D[2] * tz;
    const uv = BOX_MAPPED.has(look) ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[ua, y0], [ud, y0], [ud, y1], [ua, y1]];
    buf.quad([A, D, P(d[0], d[1], y1), P(a[0], a[1], y1)], n, uv, BOX_MAPPED.has(look) ? 1 : bot, 1);
  }
  const top = get(faceLook(b, 'top'));
  if (top) {
    const q = [P(-hx, hz, y1), P(hx, hz, y1), P(hx, -hz, y1), P(-hx, -hz, y1)];
    top.quad(q, [0, 1, 0], BOX_MAPPED.has(faceLook(b, 'top')) ? [[0, 0], [1, 0], [1, 1], [0, 1]] : q.map((p) => [p[0], -p[2]]));
  }
  const bottom = get(faceLook(b, 'bottom'));
  if (bottom) {
    const q = [P(-hx, -hz, y0), P(hx, -hz, y0), P(hx, hz, y0), P(-hx, hz, y0)];
    bottom.quad(q, [0, -1, 0], q.map((p) => [p[0], p[2]]), 0.92, 0.92);
  }
}

/** 12-sided vertical cylinder (columns), radius = hx. */
function emitCyl(b, get) {
  const buf = get(b.look);
  if (!buf) return;
  const N = 12;
  const r = b.hx;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2;
    const a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [b.cx + Math.cos(a0) * r, b.cz + Math.sin(a0) * r];
    const p1 = [b.cx + Math.cos(a1) * r, b.cz + Math.sin(a1) * r];
    const am = (a0 + a1) / 2;
    const u0 = a0 * r;
    const u1 = a1 * r;
    buf.quad([[p1[0], b.y0, p1[1]], [p0[0], b.y0, p0[1]], [p0[0], b.y1, p0[1]], [p1[0], b.y1, p1[1]]], [Math.cos(am), 0, Math.sin(am)], [[u1, b.y0], [u0, b.y0], [u0, b.y1], [u1, b.y1]], 0.74, 1);
  }
}

const tints = new Map();
/** Linear-space rgb of a '#rrggbb' look (cached). */
function tintOf(look) {
  let t = tints.get(look);
  if (!t) {
    const c = new THREE.Color(look);
    tints.set(look, (t = [c.r, c.g, c.b]));
  }
  return t;
}

export function buildKitMeshes({ root, kit, name = 'bhs' }) {
  const top = new THREE.Group();
  top.name = name;
  root.add(top);
  const groups = new Map(); // group -> { bufs: Map(look -> Buf), meshes, box }
  const groupOf = (g) => {
    let G = groups.get(g);
    if (!G) groups.set(g, (G = { bufs: new Map(), meshes: [], box: new THREE.Box3(), node: new THREE.Group() }));
    return G;
  };
  const byCollider = new Map(); // collider -> [{ buf, v0, v1 }]
  const record = (col, buf, v0) => {
    if (!col || buf.n === v0) return;
    let L = byCollider.get(col);
    if (!L) byCollider.set(col, (L = []));
    L.push({ buf, v0, v1: buf.n });
  };

  // interior groups are chunked in space so streaming works once you are inside a building: a floor's
  // group would otherwise always contain the camera. Fine props: small cells, short range.
  const chunkOf = (b) => {
    const g = b.group || 'ext';
    if (g === 'ext') return g;
    const s = g.endsWith(':fine') ? 32 : 80;
    return g + '@' + Math.floor(b.cx / s) + ',' + Math.floor(b.cz / s);
  };
  const draw = (b, col) => {
    const G = groupOf(chunkOf(b));
    G.box.expandByPoint(new THREE.Vector3(b.cx - b.hx - b.hz, b.y0, b.cz - b.hx - b.hz));
    G.box.expandByPoint(new THREE.Vector3(b.cx + b.hx + b.hz, b.y1, b.cz + b.hx + b.hz));
    const starts = new Map();
    const get = (look) => {
      if (!look || look === 'none') return null;
      // every plain '#rrggbb' look shares ONE material per chunk: the colour goes into the vertex colours
      // (QA: hundreds of prop colours were hundreds of draw calls)
      const plain = look[0] === '#';
      const keyLook = plain ? 'plain' : look;
      let buf = G.bufs.get(keyLook);
      if (!buf) G.bufs.set(keyLook, (buf = new Buf()));
      buf.tint = plain ? tintOf(look) : null;
      if (!starts.has(buf)) starts.set(buf, buf.n);
      return buf;
    };
    if (b.shape === 'cyl') emitCyl(b, get);
    else emitBox(b, get, b.role === 'wall' || b.role === 'column' || b.ao);
    for (const [buf, v0] of starts) record(col, buf, v0);
  };
  for (const p of kit.parts) draw(p, p.collider);
  for (const d of kit.decors) {
    // decor bottoms are never seen (props sit on floors, trim on walls): skip them unless asked for
    const dd = d.faces && d.faces.bottom !== undefined ? d : { ...d, faces: { ...(d.faces || {}), bottom: 'none' } };
    // small interior props stream at FINE_DIST (QA: ~2x main's triangles inside BHS)
    const g = d.group || 'ext';
    if (g !== 'ext' && 2 * Math.max(d.hx, d.hz) < FINE_SIZE && d.y1 - d.y0 < 1.4 && d.look !== 'fixture') dd.group = g + ':fine';
    draw(dd, d.dep ? d.dep.collider || d.dep : null);
  }

  // meshes
  for (const [gname, G] of groups) {
    G.node.name = name + ':' + gname;
    for (const [look, buf] of G.bufs) {
      if (!buf.n) continue;
      const mat = materialFor(look);
      if (!mat) continue;
      buf.geom = buf.geometry();
      const m = new THREE.Mesh(buf.geom, mat);
      m.name = name + ':' + gname + ':' + look;
      m.receiveShadow = true;
      m.castShadow = gname === 'ext' && !mat.transparent;
      if (mat.transparent) m.renderOrder = 2;
      buf.mesh = m;
      G.node.add(m);
      G.meshes.push(m);
    }
    top.add(G.node);
  }

  // hide / show broken pieces: collapse their vertices onto the first one
  const saved = new Map();
  const setHidden = (col, hide) => {
    const L = byCollider.get(col);
    if (!L) return false;
    for (const r of L) {
      if (!r.buf.geom) continue;
      const pos = r.buf.geom.attributes.position;
      if (hide) {
        if (!saved.has(r)) saved.set(r, pos.array.slice(r.v0 * 3, r.v1 * 3));
        for (let i = r.v0; i < r.v1; i++) pos.setXYZ(i, pos.getX(r.v0), pos.getY(r.v0), pos.getZ(r.v0));
      } else if (saved.has(r)) {
        pos.array.set(saved.get(r), r.v0 * 3);
        saved.delete(r);
      }
      pos.needsUpdate = true;
    }
    return true;
  };

  // light pool
  const pool = [];
  for (let i = 0; i < POOL; i++) {
    const l = new THREE.PointLight(0xfff3e0, 0, 14, 1.6);
    l.castShadow = false;
    top.add(l);
    pool.push(l);
  }
  let lt = 0;
  const tmp = new THREE.Vector3();

  return {
    root: top,
    groups,
    owns: (c) => byCollider.has(c),
    hideCollider: (c) => setHidden(c, true),
    showCollider: (c) => setHidden(c, false),
    update(dt, ctx) {
      const cam = ctx && ctx.camera;
      if (!cam) return;
      lt -= dt;
      if (lt > 0) return;
      lt = 0.4;
      for (const [gname, G] of groups) {
        if (gname === 'ext') continue;
        const d = G.box.distanceToPoint(cam.position);
        G.node.visible = d < (gname.includes(':fine@') ? FINE_DIST : STREAM_DIST);
      }
      // nearest light spots
      if (kit.lights.length) {
        const near = kit.lights
          .map((L) => [L, (L.x - cam.position.x) ** 2 + (L.y - cam.position.y) ** 2 + (L.z - cam.position.z) ** 2])
          .sort((a, b) => a[1] - b[1])
          .slice(0, POOL);
        pool.forEach((l, i) => {
          const e = near[i];
          if (!e || e[1] > 60 * 60) {
            l.intensity = 0;
            return;
          }
          const L = e[0];
          l.position.copy(tmp.set(L.x, L.y, L.z));
          l.color.setHex(L.color);
          l.distance = L.range;
          l.intensity = L.intensity * 6;
        });
      }
    },
  };
}
