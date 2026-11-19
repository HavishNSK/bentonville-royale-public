// BENTONVILLE ROYALE — the pump hose and nozzle in a player's hand (GasPumps.js holders).
//
//   const hv = new NozzleHose(scene);
//   hv.sync([{ id, from: { x, y, z }, to: { x, y, z }, ground }])   // every frame: one per holder
//
// The hose is a thin toon tube that sags between the pump and the hand (rebuilt only when an end
// moves); the nozzle is a small grey handle with a spout at the hand, pointing along the hose.

import * as THREE from 'three';
import { toToon } from './Toon.js';

const SEGS = 16;
const RADIUS = 0.045;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Vector3();
const _q = new THREE.Vector3();

function nozzleMesh(mat, dark) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.2), mat);
  handle.position.set(0, -0.02, 0);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.26, 8), mat);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(0, 0.04, 0.2);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.14), dark);
  guard.position.set(0, -0.11, 0.02);
  g.add(handle, spout, guard);
  g.scale.setScalar(1.5); // cartoon-sized, readable in third person
  return g;
}

export class NozzleHose {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this.hoseMat = toToon(new THREE.MeshStandardMaterial({ color: 0x1d1a2a, roughness: 0.8 }));
    this.metalMat = toToon(new THREE.MeshStandardMaterial({ color: 0x9aa3b3, roughness: 0.5, metalness: 0.2 }));
  }

  _make(id) {
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat);
    tube.frustumCulled = false;
    const nozzle = nozzleMesh(this.metalMat, this.hoseMat);
    this.scene.add(tube, nozzle);
    const it = { id, tube, nozzle, key: '' };
    this.items.set(id, it);
    return it;
  }

  _drop(it) {
    this.scene.remove(it.tube, it.nozzle);
    it.tube.geometry.dispose();
    this.items.delete(it.id);
  }

  sync(list) {
    const seen = new Set();
    for (const e of list || []) {
      seen.add(e.id);
      const it = this.items.get(e.id) || this._make(e.id);
      _a.set(e.from.x, e.from.y, e.from.z);
      _b.set(e.to.x, e.to.y, e.to.z);
      // the nozzle points away from the pump, tipped down a little
      _q.subVectors(_b, _a).setY(0);
      if (_q.lengthSq() < 1e-6) _q.set(0, 0, 1);
      _q.normalize();
      it.nozzle.position.copy(_b);
      it.nozzle.rotation.set(0.35, Math.atan2(_q.x, _q.z), 0);
      // the hose plugs into the back of the handle
      _b.addScaledVector(_q, -0.1);
      const key = `${_a.x.toFixed(2)},${_a.y.toFixed(2)},${_a.z.toFixed(2)},${_b.x.toFixed(2)},${_b.y.toFixed(2)},${_b.z.toFixed(2)}`;
      if (key === it.key) continue;
      it.key = key;
      const d = _a.distanceTo(_b);
      const ground = Number.isFinite(e.ground) ? e.ground + 0.06 : -Infinity;
      const sag = Math.min(1.3, 0.25 + d * 0.18);
      _m.lerpVectors(_a, _b, 0.5);
      _m.y = Math.max(ground, Math.min(_a.y, _b.y) - sag);
      const p1 = new THREE.Vector3().lerpVectors(_a, _m, 0.4);
      p1.y = Math.max(ground, p1.y - sag * 0.3);
      const p3 = new THREE.Vector3().lerpVectors(_m, _b, 0.6);
      p3.y = Math.max(ground, p3.y - sag * 0.2);
      const curve = new THREE.CatmullRomCurve3([_a.clone(), p1, _m.clone(), p3, _b.clone()]);
      const geo = new THREE.TubeGeometry(curve, SEGS, RADIUS, 5, false);
      it.tube.geometry.dispose();
      it.tube.geometry = geo;
    }
    for (const it of [...this.items.values()]) if (!seen.has(it.id)) this._drop(it);
  }

  dispose() {
    for (const it of [...this.items.values()]) this._drop(it);
  }
}
