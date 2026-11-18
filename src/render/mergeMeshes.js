// BENTONVILLE ROYALE — merge the small meshes of a code-built prop into one mesh per material.
// A prop made of dozens of boxes is one draw call per box otherwise (two with shadows).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges every mesh under `container` that shares a material into one mesh, in the container's
 * own space. Sub-trees flagged userData.dynamic are left alone so they can still move (merge
 * those separately).
 */
export function mergeMeshes(container) {
  container.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const groups = new Map();
  const gone = [];
  const m4 = new THREE.Matrix4();
  container.traverse((o) => {
    if (!o.isMesh || o === container) return;
    for (let p = o; p && p !== container; p = p.parent) if (p.userData.dynamic) return;
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const geo = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) if (src.attributes[k]) geo.setAttribute(k, src.attributes[k]);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
    let e = groups.get(o.material);
    if (!e) groups.set(o.material, (e = { list: [], shadow: false }));
    e.list.push(geo);
    e.shadow = e.shadow || o.castShadow;
    gone.push(o);
  });
  for (const o of gone) {
    o.parent.remove(o);
    o.geometry.dispose();
  }
  for (const [material, e] of groups) {
    const merged = e.list.length > 1 ? mergeGeometries(e.list, false) : e.list[0];
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = e.shadow;
    container.add(mesh);
  }
}

