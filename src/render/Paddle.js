// BENTONVILLE ROYALE — the Pickleball Paddle "pickaxe": built in code (no source mesh).
//
//   const g = buildPaddle(materialFn)   // THREE.Group in hand-slot space: grip at the origin,
//                                       // face up along +Y, flat across X (thin along Z)
// materialFn(color) -> material (Character passes its toon material maker).

import * as THREE from 'three';

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function buildPaddle(mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.6 })) {
  const g = new THREE.Group();
  g.name = 'pickleball_paddle';
  const face = mat(0x19c2b0); // teal face
  const stripe = mat(0xffe14d); // yellow stripe
  const edge = mat(0x1d2a36); // edge guard
  const grip = mat(0xf4f1ea); // white grip wrap
  const butt = mat(0x1d2a36);

  // grip (handle) from the hand up
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.36, 10), grip);
  handle.position.y = 0.08;
  g.add(handle);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10), butt);
  cap.position.y = -0.11;
  g.add(cap);
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.08, 10), edge);
  throat.position.y = 0.29;
  g.add(throat);

  // face: rounded rectangle, a little thicker edge guard behind it
  const W = 0.42;
  const H = 0.5;
  const faceY = 0.33 + H / 2;
  const guard = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRect(W + 0.04, H + 0.04, 0.13), { depth: 0.035, bevelEnabled: false }), edge);
  guard.position.set(0, faceY, -0.0175);
  g.add(guard);
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W, H, 0.12)), face);
    f.position.set(0, faceY, side * 0.019);
    if (side < 0) f.rotation.y = Math.PI;
    g.add(f);
    const st = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.92, 0.06), stripe);
    st.position.set(0, faceY - H * 0.18, side * 0.0205);
    if (side < 0) st.rotation.y = Math.PI;
    g.add(st);
  }
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  g.scale.setScalar(1.45); // game-sized: about as long as the swords
  return g;
}
