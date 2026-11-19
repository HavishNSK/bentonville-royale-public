// BENTONVILLE ROYALE — the catfish mascot on the roof of Catfish Ken's reboot van: a big
// friendly diner-sign catfish (violet back, cream belly, sun-gold fins, ink whiskers, a wide
// grin and big eyes) on a short ink post.
//
//   const fish = buildCatfishMascot();  // THREE.Mesh, post foot at y = 0, nose at -z
//
// Every part is baked into ONE geometry with vertex colours and one toon material, so the
// whole fish is a single draw call (plus its shadow). Original design, code-built only.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from './Toon.js';

export const CATFISH_COLORS = Object.freeze({
  back: 0x8a5cf0, // violet, the van's purple spray paint
  belly: 0xfff1d6, // cream
  fin: 0xffc21f, // sun-gold
  ink: 0x1b1d24,
  eye: 0xffffff,
});

// size, in the mascot's own frame (metres): nose at -z, tail at +z
export const CATFISH_MASCOT = Object.freeze({
  post: 0.3, // post height (the body sits on top)
  bodyY: 0.62, // body centre height above the post foot
  nose: -0.84, // z of the tip of the nose
  tail: 1.08, // z of the end of the tail fin
});

const _c = new THREE.Color();

/** Non-indexed copy with only position / normal / color (colour per vertex: fn(x, y, z) or hex). */
function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute('normal', g.attributes.normal);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    _c.setHex(typeof color === 'function' ? color(p.getX(i), p.getY(i), p.getZ(i)) : color);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** A flat fin: a 2-D outline (u along the fish, v up) extruded `thick` across x. */
function fin(pts, thick) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // (u, v, c) -> (-c, v, u)
  g.translate(thick / 2, 0, 0);
  return g;
}

/** An ink whisker (barbel) from `a` bending through `b` to `c`. */
function whisker(a, b, c) {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c));
  return new THREE.TubeGeometry(curve, 6, 0.028, 4, false);
}

/** The geometry of the whole fish (vertex coloured), post foot at the origin. */
export function catfishGeometry() {
  const C = CATFISH_COLORS;
  const Y = CATFISH_MASCOT.bodyY;
  const parts = [];

  // body: a lathe (wide flat head tapering to the tail), flattened top-to-bottom like a catfish;
  // violet on top, cream underneath
  const prof = [
    [0, -0.84], [0.2, -0.8], [0.33, -0.66], [0.4, -0.45], [0.39, -0.15], [0.32, 0.18], [0.2, 0.46], [0.09, 0.66], [0, 0.72],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const body = new THREE.LatheGeometry(prof, 12);
  body.rotateX(Math.PI / 2); // lathe axis y -> z (a = z)
  body.scale(1.05, 0.78, 1);
  body.translate(0, Y, 0);
  parts.push(paint(body, (x, y) => (y < Y - 0.07 ? C.belly : C.back)));

  // wide grin wrapped round the front of the head
  const grin = new THREE.TorusGeometry(0.3, 0.035, 4, 10, Math.PI);
  grin.rotateX(-Math.PI / 2); // arc in the xz plane, bulging to -z
  grin.translate(0, Y - 0.08, -0.5);
  parts.push(paint(grin, C.ink));

  // big friendly eyes, high on the sides of the head, pupils looking forward
  for (const sx of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.1, 8, 6);
    eye.translate(sx * 0.27, Y + 0.13, -0.5);
    parts.push(paint(eye, C.eye));
    const pupil = new THREE.SphereGeometry(0.05, 6, 4);
    pupil.translate(sx * 0.33, Y + 0.14, -0.55);
    parts.push(paint(pupil, C.ink));
    // barbels: a long pair from the mouth corners drooping out and down, a short pair on the snout
    parts.push(paint(whisker([sx * 0.3, Y - 0.08, -0.55], [sx * 0.7, Y - 0.05, -0.75], [sx * 0.8, Y - 0.38, -0.95]), C.ink));
    parts.push(paint(whisker([sx * 0.14, Y + 0.02, -0.8], [sx * 0.42, Y + 0.12, -1.0], [sx * 0.55, Y - 0.06, -1.12]), C.ink));
    // pectoral fins, swept back
    const pec = new THREE.SphereGeometry(1, 6, 4);
    pec.scale(0.2, 0.025, 0.1);
    pec.rotateY(sx * 0.6);
    pec.rotateZ(sx * -0.35);
    pec.translate(sx * 0.42, Y - 0.12, -0.15);
    parts.push(paint(pec, C.fin));
  }

  // dorsal fin on the back, forked tail fin, a small fin underneath
  const dorsal = fin([[-0.3, 0], [-0.12, 0.34], [0.22, 0]], 0.05);
  dorsal.translate(0, Y + 0.2, 0);
  parts.push(paint(dorsal, C.fin));
  const tail = fin([[0, 0], [0.4, 0.34], [0.3, 0], [0.4, -0.34]], 0.05);
  tail.translate(0, Y, 0.66);
  parts.push(paint(tail, C.fin));
  const anal = fin([[0.05, 0], [0.32, -0.16], [0.4, 0]], 0.04);
  anal.translate(0, Y - 0.17, 0);
  parts.push(paint(anal, C.fin));

  // the post it is mounted on
  const post = new THREE.CylinderGeometry(0.06, 0.08, CATFISH_MASCOT.post + 0.1, 6);
  post.translate(0, (CATFISH_MASCOT.post + 0.1) / 2, 0);
  parts.push(paint(post, C.ink));
  const foot = new THREE.CylinderGeometry(0.22, 0.25, 0.06, 8);
  foot.translate(0, 0.03, 0);
  parts.push(paint(foot, C.ink));

  const geo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

let _geo = null;
/** The rooftop catfish: one mesh, one vertex-coloured toon material (geometry shared by every van). */
export function buildCatfishMascot() {
  _geo = _geo || catfishGeometry();
  const mat = toToon(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  const mesh = new THREE.Mesh(_geo, mat);
  mesh.name = 'catfish_mascot';
  mesh.castShadow = true;
  return mesh;
}
