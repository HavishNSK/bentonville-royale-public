// BENTONVILLE ROYALE — realistic furry paw boots and paw gloves (Scruff's `gear: 'furPaws'`).
//
//   attachFurGear(bones)   // adds a boot to each foot and a paw glove to each hand slot
//
// Unlike the cel-shaded kit and recipe addons, these are drawn with shell fur: each furry part
// is repeated SHELLS times, every shell pushed a little further out along its normals, and a
// shader cuts each shell into thin strands (a strand is cut off once the shell passes its own
// random height). Roots are darker than tips, the strands droop a little and catch the scene's
// light through MeshStandardMaterial. Toe beans and claws are smooth (no shells).
//
// One merged mesh per boot / glove (one draw call each). Geometry and material are built once
// and shared by every character wearing them. Sizes are model units (all four kits share one
// skeleton, ~1.3 tall). Each piece is designed in its own simple frame and mapped onto the bone
// by a fixed basis (measured from the rig standing in its idle):
//   boot  (origin at the ankle / foot bone): x right, y up, z forward (toes)
//   glove (origin at the hand slot / grip):   x out (back of the hand), y up the arm, z forward

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SHELLS = 12;
const FUR_LEN = 0.03; // strand length (model units: the character is ~1.3 tall)
const FUR_DENSITY = 300; // strand cells per model unit

export const FUR_COLORS = {
  pink: 0xf4a3c4,
  white: 0xfbf6f8,
  bean: 0xe8829f,
  claw: 0x1b1d24,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const DEG = Math.PI / 180;

/** A part: base geometry placed in the gear's frame, its colour and whether it grows fur. */
function part(geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], fur = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  _m.compose(new THREE.Vector3(...pos), _q.setFromEuler(_e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)), new THREE.Vector3(...scale));
  g.applyMatrix4(_m);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.userData.fur = fur;
  return g;
}

/** Repeats furry parts as shells (furLayer 0..1); smooth parts get one layer at 0. */
function shellGeometry(parts) {
  const out = [];
  for (const p of parts) {
    const layers = p.userData.fur > 0 ? SHELLS : 1;
    for (let i = 0; i < layers; i++) {
      const g = p.clone();
      const n = g.attributes.position.count;
      const layer = new Float32Array(n).fill(layers === 1 ? 0 : i / (SHELLS - 1));
      const amt = new Float32Array(n).fill(p.userData.fur);
      g.setAttribute('furLayer', new THREE.BufferAttribute(layer, 1));
      g.setAttribute('furAmt', new THREE.BufferAttribute(amt, 1));
      out.push(g);
    }
  }
  const merged = mergeGeometries(out, false);
  for (const g of out) g.dispose();
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

let _mat = null;
/** Shared fur material: standard lighting (not toon) plus the shell / strand shader. */
function furMaterial() {
  if (_mat) return _mat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.furLen = { value: FUR_LEN };
    sh.uniforms.furDensity = { value: FUR_DENSITY };
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float furLayer;
attribute float furAmt;
uniform float furLen;
uniform float furDensity;
varying float vFurLayer;
varying vec3 vFurP;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vFurLayer = furLayer;
vFurP = position * furDensity;
float fl = furLayer * furAmt;
transformed += normal * fl * furLen;
transformed.y -= fl * fl * furLen * 0.35; // tips droop a little`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vFurLayer;
varying vec3 vFurP;
float furHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if (vFurLayer > 0.0) {
  vec3 cell = floor(vFurP);
  float strand = 0.35 + 0.65 * furHash(cell);           // this strand's height (0..1 of furLen)
  if (strand < vFurLayer) discard;
  float d = length(fract(vFurP) - 0.5);
  if (d > 0.62 * (1.0 - vFurLayer * 0.85)) discard;    // strands thin toward the tip
}
diffuseColor.rgb *= mix(0.5, 1.08, vFurLayer);         // shadowed roots, bright tips`
      );
  };
  m.customProgramCacheKey = () => 'furShell1';
  _mat = m;
  return m;
}

let _boot = null;
/** Pink fluffy boot with a white furry toe cap (foot bone frame). */
function bootGeometry() {
  if (_boot) return _boot;
  const ball = new THREE.SphereGeometry(0.5, 20, 14);
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 3, true);
  _boot = shellGeometry([
    part(ball, FUR_COLORS.pink, { pos: [0, -0.06, 0.04], scale: [0.29, 0.25, 0.42] }), // foot
    part(cyl, FUR_COLORS.pink, { pos: [0, 0.07, -0.01], scale: [0.26, 0.24, 0.27] }), // shaft up the shin
    part(ball, FUR_COLORS.pink, { pos: [0, 0.19, -0.01], scale: [0.265, 0.06, 0.275] }), // closes the shaft top
    part(ball, FUR_COLORS.white, { pos: [0, -0.09, 0.17], scale: [0.29, 0.18, 0.25] }), // white toe cap
  ]);
  ball.dispose();
  cyl.dispose();
  return _boot;
}

let _glove = null;
/** Pink paw glove: furry back, smooth pink toe beans on the palm, dark claws (hand slot frame). */
function gloveGeometry() {
  if (_glove) return _glove;
  const ball = new THREE.SphereGeometry(0.5, 18, 12);
  const bean = new THREE.SphereGeometry(0.5, 10, 8);
  const cone = new THREE.ConeGeometry(0.5, 1, 8);
  const parts = [
    part(ball, FUR_COLORS.pink, { pos: [0, 0.06, 0], scale: [0.2, 0.27, 0.21] }), // the glove over hand and wrist
    part(ball, FUR_COLORS.white, { pos: [0, -0.02, 0.02], scale: [0.205, 0.16, 0.195] }), // white paw (curled fingers)
    part(bean, FUR_COLORS.bean, { pos: [-0.098, 0.04, 0.0], scale: [0.026, 0.08, 0.075], fur: 0 }), // palm pad
  ];
  for (const z of [-0.054, -0.018, 0.018, 0.054]) {
    parts.push(part(bean, FUR_COLORS.bean, { pos: [-0.086, -0.04, z], scale: [0.022, 0.036, 0.032], fur: 0 })); // toe beans
    parts.push(part(cone, FUR_COLORS.claw, { pos: [-0.02, -0.11, z], rot: [180, 0, 0], scale: [0.014, 0.042, 0.014], fur: 0 })); // claws
  }
  _glove = shellGeometry(parts);
  ball.dispose();
  bean.dispose();
  cone.dispose();
  return _glove;
}

// design frame -> bone frame (columns: where the design x, y, z axes point in the bone's frame)
const unit = (v) => new THREE.Vector3(...v).normalize();
const basis = (x, y, z) => new THREE.Matrix4().makeBasis(unit(x), unit(y), unit(z));
// foot bones: +Y runs down-forward along the foot, +Z down-back (same on both feet)
const FOOT = basis([1, 0, 0], [0, -0.72, -0.69], [0, 0.69, -0.72]);
// hand slots: +Z is the back of the hand, +Y forward; +X runs up the arm on the left, down on the right
const GLOVE_SIZE = new THREE.Matrix4().makeScale(1.25, 1.25, 1.25); // big enough to swallow the kit's fist
const HAND_L = basis([0, 0, 1], [1, 0, 0], [0, 1, 0]).multiply(GLOVE_SIZE);
const HAND_R = basis([0, 0, 1], [-1, 0, 0], [0, 1, 0]).multiply(GLOVE_SIZE);

/** Boots on both feet, paw gloves on both hand slots. Returns the meshes added. */
export function attachFurGear(bones) {
  const out = [];
  const add = (bone, geo, frame) => {
    if (!bone) return;
    const m = new THREE.Mesh(geo, furMaterial());
    m.name = 'FurGear';
    m.matrixAutoUpdate = false;
    m.matrix.copy(frame); // a mirrored frame (the right hand) is fine: three flips the winding
    m.castShadow = true;
    m.frustumCulled = false; // skinned parents: bounds are unreliable (as for the kit meshes)
    bone.add(m);
    out.push(m);
  };
  add(bones.footl, bootGeometry(), FOOT);
  add(bones.footr, bootGeometry(), FOOT);
  add(bones.handslotl, gloveGeometry(), HAND_L);
  add(bones.handslotr, gloveGeometry(), HAND_R);
  return out;
}
