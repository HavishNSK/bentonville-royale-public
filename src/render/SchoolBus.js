// BENTONVILLE ROYALE — the yellow school-bus body, shared by the Drop Bus (DropBus.js, hung
// under its balloon) and the parked buses in West High's bus loop (WorldMeshes.js).
//
//   const mats = schoolBusMaterials();
//   for (const part of schoolBusParts()) new THREE.Mesh(part.geometry, mats[part.mat])
//
// Bus-local frame: x across (right), y up with 0 = body centre, z along the bus with the
// hood / front at -z. Each part's geometry is already placed in that frame.
//   SCHOOL_BUS.groundY      body centre height above the ground when parked (wheels touch y = 0)
//   SCHOOL_BUS.front / rear z of the front bumper / rear face
//   SCHOOL_BUS.halfWidth    half the body width (the folded-out stop arm sticks out ~0.4 m more)
//   SCHOOL_BUS.top          roof-crown top above the body centre

import * as THREE from 'three';
import { toToon } from './Toon.js';

const L = 12; // body length; the hood adds 2.2 m and the bumper 0.15 m in front

export const SCHOOL_BUS = Object.freeze({
  length: L,
  groundY: 2.05, // wheel radius 0.7, axle 1.35 below the body centre
  front: -L / 2 - 2.35,
  rear: L / 2 + 0.06,
  halfWidth: 1.53,
  top: 1.7,
});

/** Toon materials keyed by the part names schoolBusParts() uses. */
export function schoolBusMaterials() {
  const mat = (color, extra = {}) => toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
  return {
    yellow: mat(0xffc21f),
    ink: mat(0x1d2a36),
    glass: mat(0x8fd3ff, { emissive: 0x1a3a55, emissiveIntensity: 0.4 }),
    red: mat(0xd8452f),
  };
}

/** The body as [{ geometry, mat }] in the bus-local frame (fresh geometries every call). */
export function schoolBusParts() {
  const parts = [];
  const box = (w, h, d, m, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push({ geometry: g, mat: m });
  };
  box(3, 2.6, L, 'yellow', 0, 0, 0);
  box(2.9, 0.4, L - 0.6, 'yellow', 0, 1.5, 0); // roof crown
  box(3.04, 0.22, L + 0.04, 'ink', 0, -0.35, 0); // black rub rails
  box(3.04, 0.22, L + 0.04, 'ink', 0, 0.15, 0);
  box(3, 1.8, 2.2, 'yellow', 0, -0.4, -L / 2 - 1.1); // hood
  box(3.06, 0.3, 0.3, 'ink', 0, -1.2, -L / 2 - 2.2); // bumper
  box(2.6, 1, 0.08, 'glass', 0, 0.75, -L / 2 - 0.02); // windshield
  for (let i = 0; i < 6; i++) {
    const z = -L / 2 + 1.4 + i * 1.75;
    box(0.06, 0.85, 1.3, 'glass', 1.52, 0.75, z);
    box(0.06, 0.85, 1.3, 'glass', -1.52, 0.75, z);
  }
  box(2.4, 0.8, 0.06, 'glass', 0, 0.75, L / 2 + 0.02); // rear window
  // a stop arm on the driver's side, folded out (it is a school bus after all)
  const arm = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 8);
  arm.rotateZ(Math.PI / 2);
  arm.translate(-1.9, 0.4, -L / 2 + 1.2);
  parts.push({ geometry: arm, mat: 'red' });
  for (const [x, z] of [[1.4, -L / 2 + 1.6], [-1.4, -L / 2 + 1.6], [1.4, L / 2 - 2], [-1.4, L / 2 - 2]]) {
    const w = new THREE.CylinderGeometry(0.7, 0.7, 0.5, 14);
    w.rotateZ(Math.PI / 2);
    w.translate(x, -1.35, z);
    parts.push({ geometry: w, mat: 'ink' });
  }
  return parts;
}
