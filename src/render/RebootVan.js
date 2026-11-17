// BENTONVILLE ROYALE — Catfish Ken's reboot van: a cream-and-river-blue food truck with a
// big catfish riding on the roof, "CATFISH KEN'S" boards on both sides, a serving window
// under a striped awning, and the reboot beacon (a dish with a glowing ring) at the back.
//
//   const van = buildRebootVan();     // THREE.Group, ground at y = 0, front (cab) at -z
//   van.userData.setBeacon(state, k)  // 'ready' | 'busy' | 'cooldown', k = 0..1 progress
//
// REBOOT_VAN gives the footprint the collider and the "use" range are measured from.

import * as THREE from 'three';
import { toToon } from './Toon.js';

export const REBOOT_VAN = Object.freeze({
  halfLength: 3.3,
  halfWidth: 1.25,
  height: 3.3, // roof top (the catfish and the dish stick up above it)
});

const BEACON = {
  ready: 0x38e1ff,
  busy: 0x7dff6b,
  cooldown: 0xff5d4a,
};

function signTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1d3f5e';
  x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#ffc21f';
  x.lineWidth = 8;
  x.strokeRect(6, 6, 500, 116);
  x.fillStyle = '#fff6df';
  x.font = '900 62px "Arial Black", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText("CATFISH KEN'S", 256, 56);
  x.fillStyle = '#ffc21f';
  x.font = '800 24px Arial, sans-serif';
  x.fillText('REBOOT VAN  ·  FRIED FRESH', 256, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The van as a THREE.Group (fresh geometry and materials every call). */
export function buildRebootVan() {
  const g = new THREE.Group();
  g.name = 'reboot_van';
  const mat = (color, extra = {}) => toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra }));
  const M = {
    cream: mat(0xf4ecd8),
    blue: mat(0x2a6f97),
    ink: mat(0x1d2a36),
    glass: mat(0x8fd3ff, { emissive: 0x1a3a55, emissiveIntensity: 0.4 }),
    red: mat(0xd8452f),
    white: mat(0xffffff),
    fish: mat(0x8a7a42),
    belly: mat(0xe8d9a8),
    fin: mat(0x6b5c2e),
    steel: mat(0xaab4bf, { metalness: 0.3 }),
  };
  const box = (w, h, d, m, x, y, z, parent = g) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const L = REBOOT_VAN.halfLength * 2;
  const W = REBOOT_VAN.halfWidth * 2;

  // body (step-van box behind a shorter cab)
  box(W, 2.35, L - 1.6, M.cream, 0, 1.75, 0.8); // cargo box
  box(W + 0.02, 0.5, L - 1.58, M.blue, 0, 0.85, 0.8); // river-blue skirt
  box(W + 0.03, 0.12, L - 1.56, M.ink, 0, 1.15, 0.8); // pin stripe
  box(W, 1.75, 1.6, M.cream, 0, 1.45, -L / 2 + 0.8); // cab
  box(W + 0.02, 0.5, 1.6, M.blue, 0, 0.85, -L / 2 + 0.8);
  box(W - 0.2, 0.75, 0.06, M.glass, 0, 1.85, -L / 2 - 0.01); // windshield
  box(0.06, 0.6, 0.9, M.glass, W / 2 + 0.01, 1.85, -L / 2 + 0.75); // cab side windows
  box(0.06, 0.6, 0.9, M.glass, -W / 2 - 0.01, 1.85, -L / 2 + 0.75);
  box(W + 0.1, 0.22, 0.2, M.ink, 0, 0.55, -L / 2 - 0.05); // front bumper
  box(W + 0.1, 0.22, 0.2, M.ink, 0, 0.55, L / 2 + 0.05); // rear bumper
  box(0.5, 0.18, 0.06, M.white, -0.75, 1.05, -L / 2 - 0.02); // headlights
  box(0.5, 0.18, 0.06, M.white, 0.75, 1.05, -L / 2 - 0.02);
  box(0.3, 0.3, 0.06, M.red, -0.95, 1.25, L / 2 + 0.01); // tail lights
  box(0.3, 0.3, 0.06, M.red, 0.95, 1.25, L / 2 + 0.01);

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of [-L / 2 + 1.0, L / 2 - 1.1]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, M.ink);
      w.position.set(sx * (W / 2 - 0.1), 0.45, z);
      g.add(w);
    }
  }

  // serving window + striped awning on the right side (+x)
  box(0.06, 0.9, 2.0, M.ink, W / 2 + 0.01, 2.0, 0.9); // dark window opening
  box(0.08, 0.08, 2.1, M.steel, W / 2 + 0.04, 1.52, 0.9); // counter
  for (let i = 0; i < 6; i++) {
    const a = box(0.9, 0.05, 0.36, i % 2 ? M.white : M.red, W / 2 + 0.42, 2.62, 0.9 - 0.9 + i * 0.36);
    a.rotation.z = -0.32;
  }

  // CATFISH KEN'S boards on both sides of the roof
  const tex = signTexture();
  const signMat = tex ? new THREE.MeshBasicMaterial({ map: tex }) : M.blue;
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), signMat);
    s.position.set(sx * (W / 2 + 0.03), 3.4, 0.6);
    s.rotation.y = sx * Math.PI / 2;
    g.add(s);
    box(0.05, 0.95, 3.7, M.ink, sx * (W / 2 - 0.01), 3.4, 0.6); // board backing
  }

  // the catfish on the roof (body, belly, tail, fins, whiskers)
  const fish = new THREE.Group();
  fish.position.set(0, 4.45, 0.5); // up on posts, above the sign boards
  g.add(fish);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 12), M.fish);
  body.scale.set(1, 0.75, 3.2);
  fish.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), M.belly);
  belly.scale.set(0.9, 0.5, 2.8);
  belly.position.set(0, -0.15, 0.05);
  fish.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 18, 12), M.fish);
  head.scale.set(1.1, 0.7, 1);
  head.position.set(0, 0, -1.6);
  fish.add(head);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.9, 4), M.fin);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.set(0.15, 1, 1);
  tail.position.set(0, 0.05, 2.0);
  fish.add(tail);
  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.6, 3), M.fin);
  dorsal.scale.set(0.2, 1, 1);
  dorsal.position.set(0, 0.55, -0.4);
  fish.add(dorsal);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.ink);
    eye.position.set(sx * 0.42, 0.18, -1.95);
    fish.add(eye);
    for (let k = 0; k < 2; k++) {
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.012, 0.9, 5), M.ink);
      wh.position.set(sx * (0.3 + k * 0.12), -0.12 - k * 0.1, -2.3);
      wh.rotation.set(Math.PI / 2 + 0.3, 0, sx * (0.7 + k * 0.35));
      fish.add(wh);
    }
    const pec = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.6, 3), M.fin);
    pec.scale.set(0.2, 1, 1);
    pec.rotation.z = sx * 1.9;
    pec.position.set(sx * 0.6, -0.2, -0.9);
    fish.add(pec);
  }
  // roof rack and the two posts it rides on
  box(1.2, 0.12, 4.2, M.steel, 0, 3.0, 0.5);
  box(0.14, 1.0, 0.14, M.steel, 0, 3.5, -0.6);
  box(0.14, 1.0, 0.14, M.steel, 0, 3.5, 1.6);

  // reboot beacon: a dish on a mast at the back with a glowing ring
  const mast = box(0.12, 1.1, 0.12, M.steel, 0, 3.55, L / 2 - 0.5);
  mast.castShadow = false;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), M.white);
  dish.rotation.x = Math.PI * 0.75;
  dish.position.set(0, 4.15, L / 2 - 0.5);
  g.add(dish);
  const glowMat = new THREE.MeshBasicMaterial({ color: BEACON.ready, transparent: true, opacity: 0.9, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 8, 32), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 4.75, L / 2 - 0.5);
  g.add(ring);
  // light column while it reboots (hidden otherwise)
  const beamMat = new THREE.MeshBasicMaterial({ color: BEACON.busy, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 30, 16, 1, true), beamMat);
  beam.position.set(0, 4.75 + 15, L / 2 - 0.5);
  beam.visible = false;
  g.add(beam);

  let spin = 0;
  g.userData.setBeacon = (state, k = 0, dt = 0) => {
    const c = BEACON[state] || BEACON.ready;
    glowMat.color.setHex(c);
    spin += dt * (state === 'busy' ? 6 : state === 'ready' ? 1.5 : 0.3);
    ring.rotation.z = spin;
    const pulse = state === 'busy' ? 0.6 + 0.4 * Math.sin(spin * 2) : state === 'ready' ? 0.75 + 0.25 * Math.sin(spin) : 0.45;
    glowMat.opacity = pulse;
    ring.scale.setScalar(state === 'busy' ? 1 + k * 0.6 : 1);
    beam.visible = state === 'busy';
    beamMat.opacity = 0.2 + 0.3 * k;
  };
  return g;
}

/** A reboot card: a small glowing card with the team colour, floating and spinning. */
export function buildRebootCard(color = 0x38e1ff) {
  const g = new THREE.Group();
  g.name = 'reboot_card';
  const card = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  g.add(card);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.62), new THREE.MeshBasicMaterial({ color }));
  face.position.z = 0.03;
  g.add(face);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.03;
  g.add(back);
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.75, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.85;
  g.add(glow);
  return g;
}
