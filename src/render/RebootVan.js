// BENTONVILLE ROYALE — Catfish Ken's reboot van: a boxy silver van covered all over (sides,
// roof, hood, front and back) in pink / purple / blue spray paint and black scribbles, with
// "Catfish Ken" lettered down both sides and lime-green rims, and Catfish Ken himself in the
// driver's seat (teal hair, black shades, orange tee) behind the cab window. He is scenery
// only: no actor, no collider of his own, nothing can hit him. A small roof beacon shows
// whether the van can reboot (ready / busy / recharging), and a big cartoon catfish mascot
// rides on the roof in front of it, swaying gently (src/render/CatfishMascot.js).
//
//   const van = buildRebootVan();      // THREE.Group, ground at y = 0, front at -z, right +x
//   van.userData.setBeacon(state, k, dt)  // 'ready' | 'busy' | 'cooldown', k = 0..1 progress
//   van.userData.update(dt, viewerPos)    // Ken: head bob, looks at / waves to people nearby;
//                                         // the roof catfish bobs and sways
//
// REBOOT_VAN gives the footprint the collider and the "use" range are measured from.

import * as THREE from 'three';
import { toToon } from './Toon.js';
import { mergeMeshes } from './mergeMeshes.js';
import { buildCatfishMascot } from './CatfishMascot.js';

export const REBOOT_VAN = Object.freeze({
  halfLength: 2.5,
  halfWidth: 1.0,
  height: 2.1, // roof top (the beacon sticks up above it)
});

const BEACON = {
  ready: 0x38e1ff,
  busy: 0x7dff6b,
  cooldown: 0xff5d4a,
};

const HL = REBOOT_VAN.halfLength;
const W = REBOOT_VAN.halfWidth * 2;
const ROOF = 2.08;
const BOTTOM = 0.35;
const FISH_Z = -0.7; // where the roof catfish's post stands (the beacon is at z = 1.2)

// side silhouette, clockwise (a = along the van, front at -HL; y = up): bumper, short hood,
// steep windshield, long flat roof, flat back
const BODY = [
  [-HL, BOTTOM], [-HL, 0.95], [-2.2, 1.08], [-1.7, 1.15], [-1.15, ROOF], [2.42, ROOF], [HL, 2.0], [HL, BOTTOM],
];
// the cab's side window (cut through the body, so Ken is seen from either side)
const WINDOW = [[-1.5, 1.3], [-1.12, 1.9], [-0.25, 1.9], [-0.25, 1.3]];

const mirror = (pts) => pts.map(([a, y]) => [-a, y]).reverse();

function shapeOf(pts, holes = []) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  for (const h of holes) {
    const p = new THREE.Path();
    p.moveTo(h[0][0], h[0][1]);
    for (let i = 1; i < h.length; i++) p.lineTo(h[i][0], h[i][1]);
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

/** Extruded across the van's width: shape (a, y) -> world (x across, y, z = a). */
function extrudeAcross(shape, width) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // (a, y, c) -> (-c, y, a)
  g.translate(width / 2, 0, 0);
  return g;
}

/** Seeded random (every van gets the same paint job). */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Silver base, soft spray blobs and black scribbles on a canvas. */
function sprayCanvas(w, h, seed, blobs, scribbles) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const R = rng(seed);
  x.fillStyle = '#c9ced6';
  x.fillRect(0, 0, w, h);
  const cols = ['rgba(227,91,214,', 'rgba(138,92,240,', 'rgba(74,163,255,', 'rgba(227,91,214,', 'rgba(156,255,58,'];
  for (let i = 0; i < blobs; i++) {
    const cx = R() * w;
    const cy = R() * h;
    const r = (0.06 + R() * 0.12) * Math.max(w, h);
    const col = cols[Math.floor(R() * cols.length)];
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col + '0.9)');
    g.addColorStop(0.6, col + '0.5)');
    g.addColorStop(1, col + '0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.strokeStyle = 'rgba(18,16,24,0.9)';
  for (let i = 0; i < scribbles; i++) {
    x.lineWidth = (0.007 + R() * 0.01) * Math.max(w, h);
    x.beginPath();
    let px = R() * w;
    let py = R() * h;
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      const nx = px + (R() - 0.5) * w * 0.18;
      const ny = py + (R() - 0.5) * h * 0.5;
      x.quadraticCurveTo(px + (R() - 0.5) * w * 0.12, py + (R() - 0.5) * h * 0.5, nx, ny);
      px = nx;
      py = ny;
    }
    x.stroke();
  }
  return { c, x };
}

function toTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let _side = null;
/** The painted side (shared by every van): blobs, scribbles and "Catfish Ken" low and centred. */
function sideTexture() {
  if (_side) return _side;
  if (typeof document === 'undefined') return null;
  const { c, x } = sprayCanvas(1024, 358, 1337, 40, 10);
  // centred along the van, so it reads the same on both sides; below the cab window
  x.save();
  x.translate(512, 250);
  x.rotate(-0.05);
  x.font = 'italic 900 96px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 12;
  x.strokeStyle = '#1b1a3a';
  x.strokeText('Catfish Ken', 0, 0);
  x.fillStyle = '#3b8cff';
  x.fillText('Catfish Ken', 0, 0);
  x.restore();
  const t = toTexture(c);
  // ShapeGeometry UVs are the shape's own (a, y): a -> 0..1 along, BOTTOM..ROOF -> 0..1 up
  t.repeat.set(1 / (HL * 2), 1 / (ROOF - BOTTOM));
  t.offset.set(0.5, -BOTTOM / (ROOF - BOTTOM));
  _side = t;
  return t;
}

let _top = null;
/** Paint for the roof, hood, front and back (no lettering), tiled. */
function topTexture() {
  if (_top) return _top;
  if (typeof document === 'undefined') return null;
  const { c } = sprayCanvas(512, 512, 4242, 22, 6);
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  _top = t;
  return t;
}

/** Catfish Ken, seated (local frame: he faces -z). Returns { group, head, waveArm }. */
function buildKen(mat) {
  const g = new THREE.Group();
  g.name = 'catfish_ken';
  const shirt = mat(0xe8724f);
  const skin = mat(0xf2c4a8);
  const hair = mat(0x2fd4c4);
  const shades = mat(0x111318);
  const shorts = mat(0x3a4a5e);
  const add = (geo, m, x, y, z, parent = g) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  // seated body (seat height ~0.62)
  add(new THREE.BoxGeometry(0.4, 0.42, 0.24), shirt, 0, 0.92, 0);
  add(new THREE.BoxGeometry(0.36, 0.14, 0.42), shorts, 0, 0.66, -0.14); // lap
  // head + neck
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), skin, 0, 1.16, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.27, 0);
  g.add(head);
  const skull = add(new THREE.SphereGeometry(0.135, 14, 10), skin, 0, 0, 0, head);
  skull.scale.set(0.95, 1.08, 1);
  add(new THREE.SphereGeometry(0.035, 6, 5), skin, -0.13, -0.01, 0.01, head); // ears
  add(new THREE.SphereGeometry(0.035, 6, 5), skin, 0.13, -0.01, 0.01, head);
  // teal hair: a cap plus spikes swept up and back
  const cap = add(new THREE.SphereGeometry(0.145, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), hair, 0, 0.03, 0.01, head);
  cap.scale.set(1, 0.9, 1.05);
  for (let i = 0; i < 7; i++) {
    const s = add(new THREE.ConeGeometry(0.045, 0.13, 5), hair, (i - 3) * 0.035, 0.13 - Math.abs(i - 3) * 0.012, 0.02 + (i % 2) * 0.03, head);
    s.rotation.x = 0.55;
    s.rotation.z = (3 - i) * 0.12;
  }
  // black sunglasses
  add(new THREE.BoxGeometry(0.11, 0.05, 0.02), shades, -0.06, 0.02, -0.128, head);
  add(new THREE.BoxGeometry(0.11, 0.05, 0.02), shades, 0.06, 0.02, -0.128, head);
  add(new THREE.BoxGeometry(0.26, 0.015, 0.02), shades, 0, 0.045, -0.128, head);
  add(new THREE.BoxGeometry(0.012, 0.012, 0.16), shades, -0.13, 0.04, -0.06, head); // arms of the glasses
  add(new THREE.BoxGeometry(0.012, 0.012, 0.16), shades, 0.13, 0.04, -0.06, head);
  // arms: pivot at the shoulder, reaching forward to the wheel
  const arm = (side) => {
    const p = new THREE.Group();
    p.position.set(side * 0.22, 1.08, 0);
    g.add(p);
    const upper = add(new THREE.BoxGeometry(0.1, 0.1, 0.3), shirt, 0, -0.04, -0.14, p);
    upper.rotation.x = 0.35;
    const fore = add(new THREE.BoxGeometry(0.08, 0.08, 0.28), skin, 0, -0.1, -0.4, p);
    fore.rotation.x = -0.1;
    add(new THREE.SphereGeometry(0.05, 6, 5), skin, 0, -0.1, -0.55, p); // hand on the wheel
    return p;
  };
  arm(1);
  const waveArm = arm(-1); // the window side (driver sits on the car's left)
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group: g, head, waveArm };
}

/** The van as a THREE.Group (fresh geometry and materials every call, shared paint textures). */
export function buildRebootVan() {
  const g = new THREE.Group();
  g.name = 'reboot_van';
  const mat = (color, extra = {}) => toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra }));
  const M = {
    silver: mat(0xc9ced6, { metalness: 0.2 }),
    ink: mat(0x1b1d24),
    tire: mat(0x16171c),
    lime: mat(0x9cff3a),
    light: mat(0xfff6dc, { emissive: 0xfff2b0, emissiveIntensity: 0.4 }),
    tail: mat(0xd8253a, { emissive: 0x7a0010, emissiveIntensity: 0.4 }),
    white: mat(0xffffff),
    steel: mat(0xaab4bf, { metalness: 0.3 }),
    darkGlass: mat(0x2a3a52, { emissive: 0x0d1a2a, emissiveIntensity: 0.3 }),
  };
  const glass = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };

  // solid body (silver underneath the paint), the cab window cut all the way through
  const body = new THREE.Mesh(extrudeAcross(shapeOf(BODY, [WINDOW]), W), M.silver);
  body.castShadow = true;
  g.add(body);

  // painted sides: decals just outside the body; the lettering reads left-to-right on each
  // left (-x): the profile as is, rotateY(-90deg) -> faces -x with z = a
  // right (+x): the mirrored profile, rotateY(+90deg) -> faces +x with z = a
  const sideTex = sideTexture();
  const sidePaint = sideTex ? new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }) : M.silver;
  for (const sx of [-1, 1]) {
    const outline = sx < 0 ? BODY : mirror(BODY);
    const hole = sx < 0 ? WINDOW : mirror(WINDOW);
    const geo = new THREE.ShapeGeometry(shapeOf(outline, [hole]));
    geo.rotateY(sx < 0 ? -Math.PI / 2 : Math.PI / 2);
    const m = new THREE.Mesh(geo, sidePaint);
    m.position.x = sx * (W / 2 + 0.004);
    g.add(m);
    // cab window glass
    const gl = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(sx < 0 ? WINDOW : mirror(WINDOW))), glass);
    gl.geometry.rotateY(sx < 0 ? -Math.PI / 2 : Math.PI / 2);
    gl.position.x = sx * (W / 2 - 0.02);
    g.add(gl);
  }

  // painted top: every outer face of the profile except the windshield and the underside
  const topTex = topTexture();
  const facePaint = (len) => {
    if (!topTex) return M.silver;
    const t = topTex.clone();
    t.needsUpdate = true;
    t.repeat.set(W / 2, len / 2);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  };
  for (let i = 0; i < BODY.length; i++) {
    const [a0, y0] = BODY[i];
    const [a1, y1] = BODY[(i + 1) % BODY.length];
    const da = a1 - a0;
    const dy = y1 - y0;
    const len = Math.hypot(da, dy);
    if (y0 === BOTTOM && y1 === BOTTOM) continue; // underside
    const windshield = a0 === -1.7 && a1 === -1.15;
    const na = -dy / len; // outward normal of a clockwise profile: (-dy, da)
    const ny = da / len;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, len), windshield ? M.darkGlass : facePaint(len));
    plane.position.set(0, (y0 + y1) / 2 + ny * 0.006, (a0 + a1) / 2 + na * 0.006);
    // plane +y along the edge (rotation.x = atan2(da, dy)); + pi turns its face outward
    plane.rotation.x = Math.atan2(da, dy) + Math.PI;
    g.add(plane);
  }

  // details: lights, bumpers, grille, mirrors, door seams and handles
  box(0.42, 0.16, 0.04, M.light, -0.66, 0.75, -HL - 0.012);
  box(0.42, 0.16, 0.04, M.light, 0.66, 0.75, -HL - 0.012);
  box(0.6, 0.12, 0.03, M.ink, 0, 0.6, -HL - 0.012); // grille
  box(0.16, 0.6, 0.04, M.tail, -0.86, 1.15, HL + 0.012);
  box(0.16, 0.6, 0.04, M.tail, 0.86, 1.15, HL + 0.012);
  box(0.02, 1.4, 0.04, M.ink, 0, 1.15, HL + 0.014); // rear door split
  box(W + 0.06, 0.18, 0.14, M.ink, 0, 0.42, -HL - 0.03);
  box(W + 0.06, 0.18, 0.14, M.ink, 0, 0.42, HL + 0.03);
  for (const sx of [-1, 1]) {
    const mir = box(0.08, 0.22, 0.14, M.ink, sx * (W / 2 + 0.09), 1.45, -1.6);
    mir.rotation.y = sx * 0.2;
    box(0.012, 1.45, 0.02, M.ink, sx * (W / 2 + 0.01), 1.05, -0.1); // cab door seam
    box(0.012, 1.5, 0.02, M.ink, sx * (W / 2 + 0.01), 1.1, 1.0); // sliding door seam
    box(0.025, 0.05, 0.18, M.ink, sx * (W / 2 + 0.014), 1.1, -0.45);
    box(0.025, 0.05, 0.18, M.ink, sx * (W / 2 + 0.014), 1.15, 0.85);
  }

  // wheels: dark tires, lime-green spoked rims
  const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.02, 16);
  rimGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.75, 1.7]) {
    for (const sx of [-1, 1]) {
      const t = new THREE.Mesh(tireGeo, M.tire);
      t.position.set(sx * (W / 2 - 0.1), 0.38, z);
      g.add(t);
      const rim = new THREE.Mesh(rimGeo, M.lime);
      rim.position.set(sx * (W / 2 + 0.04), 0.38, z);
      g.add(rim);
      for (let k = 0; k < 5; k++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.21, 0.045), M.ink);
        const a = (k / 5) * Math.PI * 2;
        s.position.set(sx * (W / 2 + 0.052), 0.38 + Math.cos(a) * 0.125, z + Math.sin(a) * 0.125);
        s.rotation.x = -a;
        g.add(s);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 10), M.steel);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(sx * (W / 2 + 0.055), 0.38, z);
      g.add(hub);
    }
  }

  // Catfish Ken in the driver's seat (left, behind the cab window)
  const ken = buildKen(mat);
  ken.group.position.set(-0.45, 0.3, -0.82);
  g.add(ken.group);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.024, 6, 18), M.ink);
  wheel.position.set(-0.45, 1.32, -1.38);
  wheel.rotation.x = -0.6;
  g.add(wheel);

  // reboot beacon on the roof: a small dish and a glowing ring
  box(0.08, 0.28, 0.08, M.steel, 0, ROOF + 0.14, 1.2);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), M.white);
  dish.rotation.x = Math.PI * 0.75;
  dish.position.set(0, ROOF + 0.34, 1.2);
  g.add(dish);
  const glowMat = new THREE.MeshBasicMaterial({ color: BEACON.ready, transparent: true, opacity: 0.9, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 8, 28), glowMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, ROOF + 0.7, 1.2);
  ring.userData.dynamic = true;
  g.add(ring);
  const beamMat = new THREE.MeshBasicMaterial({ color: BEACON.busy, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 30, 16, 1, true), beamMat);
  beam.position.set(0, ROOF + 0.7 + 15, 1.2);
  beam.visible = false;
  beam.userData.dynamic = true;
  g.add(beam);

  // the catfish mascot on the roof, between the cab and the beacon (one mesh, one draw call);
  // its tail stays clear of the beacon ring even when the ring grows during a reboot
  const fish = buildCatfishMascot();
  fish.position.set(0, ROOF, FISH_Z);
  fish.userData.dynamic = true;
  g.add(fish);

  // ~70 parts -> one mesh per material (Ken's head and waving arm stay movable)
  ken.head.userData.dynamic = true;
  ken.waveArm.userData.dynamic = true;
  mergeMeshes(ken.head);
  mergeMeshes(ken.waveArm);
  mergeMeshes(g);

  let spin = 0;
  g.userData.setBeacon = (state, k = 0, dt = 0) => {
    glowMat.color.setHex(BEACON[state] || BEACON.ready);
    spin += dt * (state === 'busy' ? 6 : state === 'ready' ? 1.5 : 0.3);
    ring.rotation.z = spin;
    glowMat.opacity = state === 'busy' ? 0.6 + 0.4 * Math.sin(spin * 2) : state === 'ready' ? 0.75 + 0.25 * Math.sin(spin) : 0.45;
    ring.scale.setScalar(state === 'busy' ? 1 + k * 0.6 : 1);
    beam.visible = state === 'busy';
    beamMat.opacity = 0.2 + 0.3 * k;
  };

  // Ken: head bob, looks at whoever is near, waves out of the window when someone walks up
  const local = new THREE.Vector3();
  let clock = Math.random() * 10;
  let wave = 0; // seconds of waving left
  let greeted = false;
  let yaw = 0;
  g.userData.update = (dt, viewer) => {
    clock += dt;
    let want = 0;
    if (viewer) {
      local.copy(viewer);
      g.worldToLocal(local);
      const dx = local.x - ken.group.position.x;
      const dz = local.z - ken.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 15) want = Math.max(-1.3, Math.min(1.3, Math.atan2(-dx, -dz)));
      if (d < 6 && !greeted) {
        greeted = true;
        wave = 1.6;
      } else if (d > 9) greeted = false;
    }
    fish.position.y = ROOF + Math.sin(clock * 1.7) * 0.03;
    fish.rotation.y = Math.sin(clock * 0.9) * 0.12;
    fish.rotation.z = Math.sin(clock * 1.3) * 0.04;
    yaw += (want - yaw) * Math.min(1, dt * 4);
    ken.head.rotation.y = yaw;
    ken.head.position.y = 1.27 + Math.sin(clock * 2.2) * 0.012;
    ken.head.rotation.z = Math.sin(clock * 1.1) * 0.05;
    if (wave > 0) {
      wave -= dt;
      const up = Math.min(1, (1.6 - wave) * 6, wave * 6);
      // out of the driver's window (-x), raised a little, wagging
      ken.waveArm.rotation.y = up * 1.45;
      ken.waveArm.rotation.x = up * (0.75 + Math.sin(clock * 14) * 0.3);
    } else {
      ken.waveArm.rotation.x = 0;
      ken.waveArm.rotation.y = 0;
    }
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
