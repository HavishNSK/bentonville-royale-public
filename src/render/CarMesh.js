// BENTONVILLE ROYALE — drivable car meshes (built in code; Sedan, SUV, Pickup).
//
//   const m = buildCarMesh(spec, color)   // THREE.Group, car-local frame (cars.js): x right,
//                                         // y up (0 = ground under the wheels), front at -z
//   m.userData.breakPane(i)               // a glass pane (WINDOW order) shatters (hidden)
//   m.userData.resetPanes()
//   m.userData.panePos(i, out)            // world position of a pane (for the shatter effect)
//   m.userData.pose(car, dt)              // place / tilt the group, spin and steer the wheels
//   m.userData.setWreck(on)               // burnt-out look
//
// Draw calls matter (30 cars, most of them parked): everything opaque is ONE vertex-coloured
// mesh shared by every car type (one material), the six panes are one glass mesh (a broken pane
// collapses to nothing), and the wheels are one static mesh. Separate spinning / steering wheels
// only appear while the car moves near the camera.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from './Toon.js';
import { carGeom } from '../game/vehicles/cars.js';

const LIVE_WHEELS = 70; // m: closer than this, a moving car shows turning wheels

const _mats = new Map();
function mat(key, make) {
  let m = _mats.get(key);
  if (!m) {
    m = make();
    _mats.set(key, m);
  }
  return m;
}
const bodyMat = () => mat('body', () => toToon(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.05 })));
const burntMat = () => mat('burnt', () => toToon(new THREE.MeshStandardMaterial({ color: 0x3a3532, vertexColors: true, roughness: 1 })));
const glassMat = () =>
  mat('glass', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x9ad4ff, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.45, emissive: 0x1a3a55, emissiveIntensity: 0.25, depthWrite: false });
    m.side = THREE.DoubleSide;
    return m;
  });

const TRIM = new THREE.Color(0x23262b);
const CHROME = new THREE.Color(0xb9bfc6);
const HEAD = new THREE.Color(0xfff6d8);
const TAIL = new THREE.Color(0xff3b30);
const TYRE = new THREE.Color(0x1b1c1f);
const RIM = new THREE.Color(0xb8bec6);

function painted(g, color) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function box(list, color, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  list.push(painted(g, color));
}

/** Wheel radius for a car type. */
export function wheelRadius(spec) {
  return Math.max(0.32, spec.body.y0 + 0.02);
}

/** One wheel (tyre + hub), centred at the origin, axle along x. */
function wheelGeo(r) {
  const t = new THREE.CylinderGeometry(r, r, 0.26, 14);
  t.rotateZ(Math.PI / 2);
  const h = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.28, 10);
  h.rotateZ(Math.PI / 2);
  const g = mergeGeometries([painted(t.toNonIndexed(), TYRE), painted(h.toNonIndexed(), RIM)], false);
  t.dispose();
  h.dispose();
  return g;
}

const _wheelCache = new Map();
function sharedWheel(r) {
  const k = r.toFixed(3);
  let g = _wheelCache.get(k);
  if (!g) _wheelCache.set(k, (g = wheelGeo(r)));
  return g;
}

export function buildCarMesh(spec, colorHex = spec.colors[0]) {
  const g = carGeom(spec);
  const root = new THREE.Group();
  root.name = 'car_' + spec.id;
  const tilt = new THREE.Group(); // pitch / roll live here, yaw on root
  root.add(tilt);
  const paint = new THREE.Color(colorHex);
  const parts = [];
  const b = g.body;
  const c = g.cabin;
  const W = b.x1 - b.x0;
  const L = b.z1 - b.z0;
  const bh = b.y1 - b.y0;
  box(parts, paint, W, bh, L, 0, b.y0 + bh / 2, 0); // lower body
  const cw = c.x1 - c.x0;
  const cl = c.z1 - c.z0;
  const ch = c.y1 - c.y0;
  box(parts, paint, cw, 0.08, cl, 0, c.y1 - 0.04, (c.z0 + c.z1) / 2); // roof
  const pw = 0.09;
  for (const z of [c.z0 + pw / 2, (c.z0 + c.z1) / 2, c.z1 - pw / 2]) {
    box(parts, TRIM, pw, ch - 0.08, pw, c.x0 + pw / 2, c.y0 + (ch - 0.08) / 2, z);
    box(parts, TRIM, pw, ch - 0.08, pw, c.x1 - pw / 2, c.y0 + (ch - 0.08) / 2, z);
  }
  // seat backs and a dash, so the inside is not empty through broken glass
  for (const st of g.seats) box(parts, TRIM, 0.5, 0.65, 0.12, st.x, b.y1 + 0.07, st.z + 0.32);
  box(parts, TRIM, cw - 0.1, 0.18, 0.35, 0, b.y1 + 0.05, c.z0 + 0.2);
  if (spec.bed) {
    const bz0 = c.z1 + 0.05;
    const bl = b.z1 - bz0;
    box(parts, TRIM, W - 0.16, 0.04, bl - 0.1, 0, b.y1 + 0.01, bz0 + bl / 2);
    box(parts, paint, 0.08, 0.32, bl, b.x0 + 0.04, b.y1 + 0.16, bz0 + bl / 2);
    box(parts, paint, 0.08, 0.32, bl, b.x1 - 0.04, b.y1 + 0.16, bz0 + bl / 2);
    box(parts, paint, W, 0.32, 0.08, 0, b.y1 + 0.16, b.z1 - 0.04);
  }
  // bumpers, grille, mirrors, lamps
  box(parts, CHROME, W + 0.04, 0.16, 0.14, 0, b.y0 + 0.12, b.z0 - 0.02);
  box(parts, CHROME, W + 0.04, 0.16, 0.14, 0, b.y0 + 0.12, b.z1 + 0.02);
  box(parts, TRIM, W * 0.5, 0.2, 0.04, 0, b.y0 + bh * 0.55, b.z0 - 0.01);
  box(parts, TRIM, 0.18, 0.1, 0.08, b.x0 - 0.08, b.y1 + 0.12, c.z0 + 0.15);
  box(parts, TRIM, 0.18, 0.1, 0.08, b.x1 + 0.08, b.y1 + 0.12, c.z0 + 0.15);
  box(parts, HEAD, 0.32, 0.12, 0.04, b.x0 + 0.3, b.y0 + bh * 0.62, b.z0 - 0.03);
  box(parts, HEAD, 0.32, 0.12, 0.04, b.x1 - 0.3, b.y0 + bh * 0.62, b.z0 - 0.03);
  box(parts, TAIL, 0.28, 0.12, 0.04, b.x0 + 0.25, b.y0 + bh * 0.62, b.z1 + 0.03);
  box(parts, TAIL, 0.28, 0.12, 0.04, b.x1 - 0.25, b.y0 + bh * 0.62, b.z1 + 0.03);
  const bodyGeo = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  for (const p of parts) p.dispose();
  const body = new THREE.Mesh(bodyGeo, bodyMat());
  body.castShadow = true;
  body.receiveShadow = true;
  tilt.add(body);

  // glass: six panes in one mesh (WINDOW order, 6 vertices each once non-indexed)
  const paneGeos = [];
  const paneCenters = [];
  for (const w of g.windows) {
    const pg = new THREE.PlaneGeometry(w.u1 - w.u0, w.y1 - w.y0).toNonIndexed();
    const v = (w.y0 + w.y1) / 2;
    const u = (w.u0 + w.u1) / 2;
    if (w.axis === 'z') {
      const z = (w.side < 0 ? c.z0 : c.z1) + w.side * 0.01;
      pg.translate(u, v, z);
      paneCenters.push(new THREE.Vector3(u, v, z));
    } else {
      pg.rotateY(Math.PI / 2);
      const x = (w.side < 0 ? c.x0 : c.x1) + w.side * 0.01;
      pg.translate(x, v, u);
      paneCenters.push(new THREE.Vector3(x, v, u));
    }
    paneGeos.push(pg);
  }
  const glassGeo = mergeGeometries(paneGeos, false);
  const per = paneGeos[0].attributes.position.count;
  for (const p of paneGeos) p.dispose();
  const original = glassGeo.attributes.position.array.slice();
  const glass = new THREE.Mesh(glassGeo, glassMat());
  glass.renderOrder = 2;
  tilt.add(glass);

  // wheels: one static mesh, plus four live (spinning / steering) wheels near the camera
  const wr = wheelRadius(spec);
  const wg = sharedWheel(wr);
  const ax = g.wheelbase / 2;
  const spots = [[b.x0 + 0.12, -ax, 1], [b.x1 - 0.12, -ax, 1], [b.x0 + 0.12, ax, 0], [b.x1 - 0.12, ax, 0]];
  const statGeo = mergeGeometries(spots.map(([x, z]) => wg.clone().translate(x, wr, z)), false);
  const wheelsStatic = new THREE.Mesh(statGeo, bodyMat());
  wheelsStatic.castShadow = true;
  tilt.add(wheelsStatic);
  const live = new THREE.Group();
  live.visible = false;
  tilt.add(live);
  const wheels = [];
  for (const [x, z, front] of spots) {
    const steer = new THREE.Group();
    steer.position.set(x, wr, z);
    const spin = new THREE.Mesh(wg, bodyMat());
    steer.add(spin);
    live.add(steer);
    wheels.push({ steer, spin, front: !!front });
  }

  let wheelAngle = 0;
  let wreck = false;
  root.userData = {
    breakPane(i) {
      if (i < 0 || i >= paneCenters.length) return;
      const a = glassGeo.attributes.position;
      const pc = paneCenters[i];
      for (let k = i * per; k < (i + 1) * per; k++) a.setXYZ(k, pc.x, pc.y, pc.z);
      a.needsUpdate = true;
    },
    resetPanes() {
      const a = glassGeo.attributes.position;
      a.array.set(original);
      a.needsUpdate = true;
      glass.visible = true;
    },
    panePos(i, out = new THREE.Vector3()) {
      out.copy(paneCenters[i] || paneCenters[0]);
      tilt.updateWorldMatrix(true, false);
      return out.applyMatrix4(tilt.matrixWorld);
    },
    /** Place the group at the car and animate wheels. */
    pose(car, dt = 0, camDist2 = 0) {
      root.position.set(car.x, car.y, car.z);
      root.rotation.y = -car.heading;
      tilt.rotation.x = car.pitch || 0; // nose up = positive pitch (front is -z)
      tilt.rotation.z = -(car.roll || 0);
      const showLive = !wreck && Math.abs(car.speed || 0) > 0.2 && camDist2 < LIVE_WHEELS * LIVE_WHEELS;
      if (showLive !== live.visible) {
        live.visible = showLive;
        wheelsStatic.visible = !showLive;
      }
      if (!showLive) return;
      wheelAngle -= ((car.speed || 0) / wr) * dt;
      const steerA = -(car.steer || 0) * spec.steer;
      for (const w of wheels) {
        w.spin.rotation.x = wheelAngle;
        if (w.front) w.steer.rotation.y = steerA;
      }
    },
    setWreck(on) {
      wreck = !!on;
      body.material = on ? burntMat() : bodyMat();
      glass.visible = !on;
      if (on) {
        live.visible = false;
        wheelsStatic.visible = true;
      }
    },
  };
  return root;
}
