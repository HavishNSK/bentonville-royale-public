// BENTONVILLE ROYALE — procedural outfit pieces (skin recipe `addons`, src/game/skinRecipe.js).
//
//   const byBone = addonGeometries(normalizedAddons);  // Map(boneName -> BufferGeometry)
//
// Unit primitives in the house style of the catfish mascot: low-poly, vertex coloured and
// merged, so every bone that carries addons costs one draw call with one shared toon
// material. Geometry is in metres in the bone's frame (Character scales it to the rig).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from './Toon.js';

const DEG = Math.PI / 180;
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Unit-sized geometry for a normalized primitive (segment counts match ADDON_SHAPES). */
export function primitiveGeometry(p) {
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 10, 7);
    case 'dome':
      return new THREE.SphereGeometry(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5 * (p.taper ?? 1), 0.5, 1, 10, 1);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 10, 1);
    case 'torus': {
      const tube = p.tube ?? 0.2;
      const g = new THREE.TorusGeometry(0.5 - tube / 2, tube / 2, 6, 14, (p.arc ?? 360) * DEG);
      g.rotateX(-Math.PI / 2); // lie flat
      return g;
    }
    case 'capsule': {
      const g = new THREE.CapsuleGeometry(0.25, 0.5, 3, 10);
      return g;
    }
    case 'band': {
      const arc = (p.arc ?? 360) * DEG;
      // thetaStart is measured from +Z in three's cylinder: centre the opening on the back
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, true, -arc / 2, arc);
    }
    default:
      return null;
  }
}

/** Non-indexed copy with position / normal / colour only, transformed by `m`. */
function bake(geo, m, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  out.setAttribute('normal', g.attributes.normal.clone());
  out.applyMatrix4(m);
  const n = out.attributes.position.count;
  const col = new Float32Array(n * 3);
  _c.setHex(color, THREE.SRGBColorSpace);
  for (let i = 0; i < n; i++) {
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g !== geo) g.dispose();
  return out;
}

function trs(pos, rot, scale) {
  _e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
}

const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Normalized addons (normalizeSkin().addons) -> Map(recipe bone name -> merged geometry).
 * Mirrored addons are reflected across the bone's X (left / right) axis.
 */
export function addonGeometries(addons) {
  const parts = new Map();
  for (const a of addons) {
    const base = trs(a.pos, a.rot, a.scale);
    for (const p of a.prims) {
      const unit = primitiveGeometry(p);
      if (!unit) continue;
      const m = base.clone().multiply(trs(p.pos, p.rot, p.scale));
      const list = parts.get(a.bone) || [];
      list.push(bake(unit, m, p.color));
      if (a.mirror) {
        const mm = MIRROR_X.clone().multiply(m);
        const g = bake(unit, mm, p.color);
        // a reflection turns the winding inside out: flip it back
        const pos = g.attributes.position;
        const nor = g.attributes.normal;
        const col = g.attributes.color;
        for (let i = 0; i < pos.count; i += 3) {
          for (const attr of [pos, nor, col]) {
            for (let k = 0; k < attr.itemSize; k++) {
              const t = attr.array[(i + 1) * attr.itemSize + k];
              attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
              attr.array[(i + 2) * attr.itemSize + k] = t;
            }
          }
        }
        list.push(g);
      }
      unit.dispose();
      parts.set(a.bone, list);
    }
  }
  const out = new Map();
  for (const [bone, list] of parts) {
    const g = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    g.computeBoundingSphere();
    out.set(bone, g);
  }
  return out;
}

/** Triangles in a geometry (non-indexed or indexed). */
export function triangleCount(g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

let _mat = null;
/** The one toon material every addon shares (vertex colours, both sides: bands are open). */
export function addonMaterial(saturate = 1.2) {
  if (!_mat) {
    _mat = toToon(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), { saturate });
  }
  return _mat;
}
