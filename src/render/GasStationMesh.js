// BENTONVILLE ROYALE — gas station mesh (built in code): a canopy on four posts over two pump
// islands (two pumps each, with hoses), a small kiosk behind them and a pylon sign with a generic
// fuel-pump pictogram and the word GAS.
//
//   const m = buildGasStationMesh()   // THREE.Group in station-local space (vehicles/gasStations.js):
//                                     // x = u (along the street), z = v (away from it), ground y = 0
//
// An original cartoon design in the game's own palette (violet ink, sun gold, cream). It copies no
// fuel brand: no logos, emblems, brand names or brand colour schemes.
//
// Draw calls: everything opaque is ONE vertex-coloured toon mesh shared by every station; the sign
// faces are one small textured mesh (canvas texture, only when a document exists).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from './Toon.js';
import { STATION } from '../game/vehicles/gasStations.js';
import { FUEL_ICON } from '../ui/fuelIcon.js';

const C = {
  ink: 0x2a2150, // posts, fascia, kiosk roof
  violet: 0x5b44a6,
  sun: 0xffc21f,
  cream: 0xfff1d6,
  creamShade: 0xe9dcc0,
  concrete: 0xc8c2b4,
  slab: 0xb4afa4,
  screen: 0x13202c,
  glass: 0x8fd4ff,
  hose: 0x1d1a2a,
  nozzle: 0x8a93a3,
};

let _shared = null;

function colorize(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

/** Box from u0..u1, y0..y1, v0..v1 (station-local), one colour. */
function box(list, u0, u1, y0, y1, v0, v1, hex) {
  const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
  g.translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  list.push(colorize(g, hex));
}

/** A hose: a tube through station-local points. */
function hose(list, pts, r, hex) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const g = new THREE.TubeGeometry(curve, 12, r, 5, false);
  list.push(colorize(g, hex));
}

function pumpParts(list, u, v) {
  const P = STATION.pump;
  const ib = STATION.island.h;
  const u0 = u - P.hu;
  const u1 = u + P.hu;
  const v0 = v - P.hv;
  const v1 = v + P.hv;
  box(list, u0, u1, ib, ib + 0.22, v0, v1, C.violet); // plinth
  box(list, u0, u1, ib + 0.22, P.h - 0.22, v0, v1, C.cream); // body
  box(list, u0 - 0.03, u1 + 0.03, P.h - 0.22, P.h, v0 - 0.03, v1 + 0.03, C.sun); // cap
  // display + price window on both lane-facing sides
  for (const s of [-1, 1]) {
    const f = s < 0 ? v0 - 0.02 : v1;
    box(list, u - 0.3, u + 0.3, P.h - 0.62, P.h - 0.32, f, f + 0.02, C.screen);
    box(list, u - 0.22, u + 0.22, ib + 0.5, ib + 0.62, f, f + 0.02, C.sun);
  }
  // nozzle holster on the outer side, hose looping down from the top
  const so = u < 0 ? -1 : 1;
  const hx = u + so * (P.hu + 0.06);
  box(list, hx - 0.06, hx + 0.06, 0.9, 1.25, v - 0.12, v + 0.12, C.nozzle);
  hose(list, [[u + so * P.hu * 0.6, P.h - 0.25, v], [hx + so * 0.2, 1.3, v + 0.05], [hx + so * 0.25, 0.55, v + 0.1], [hx + so * 0.08, 0.95, v]], 0.035, C.hose);
}

function buildBody() {
  const S = STATION;
  const list = [];
  const L = S.lot;
  // concrete forecourt over the whole lot (sits just above the ground layers)
  box(list, L.u0, L.u1, 0, 0.04, L.v0, L.v1, C.slab);
  // canopy: cream underside, ink fascia with a sun-gold stripe, flat cream top
  const c = S.canopy;
  box(list, c.u0, c.u1, c.y0, c.y0 + 0.1, c.v0, c.v1, C.cream);
  box(list, c.u0 - 0.08, c.u1 + 0.08, c.y0 + 0.1, c.y1, c.v0 - 0.08, c.v1 + 0.08, C.ink);
  box(list, c.u0 - 0.12, c.u1 + 0.12, c.y0 + 0.27, c.y0 + 0.4, c.v0 - 0.12, c.v1 + 0.12, C.sun);
  box(list, c.u0 + 0.1, c.u1 - 0.1, c.y1, c.y1 + 0.05, c.v0 + 0.1, c.v1 - 0.1, C.creamShade);
  // canopy lights: small cream panels under the roof
  for (const iv of S.islands) for (const lu of [-6, -2, 2, 6]) box(list, lu - 0.5, lu + 0.5, c.y0 - 0.04, c.y0, iv - 0.25, iv + 0.25, 0xffffff);
  // islands, posts and pumps
  const I = S.island;
  for (const iv of S.islands) {
    box(list, -I.hu, I.hu, 0, I.h, iv - I.hv, iv + I.hv, C.concrete);
    box(list, -I.hu - 0.02, I.hu + 0.02, I.h - 0.04, I.h, iv - I.hv - 0.02, iv + I.hv + 0.02, C.sun); // curb paint
    for (const su of [-1, 1]) {
      const pu = su * S.postU;
      box(list, pu - S.post, pu + S.post, I.h, c.y0, iv - S.post, iv + S.post, C.ink);
      box(list, pu - S.post - 0.05, pu + S.post + 0.05, I.h, I.h + 0.5, iv - S.post - 0.05, iv + S.post + 0.05, C.sun); // bumper collar
    }
    for (const pu of S.pumpU) pumpParts(list, pu, iv);
  }
  // kiosk: cream walls, ink roof slab with a gold stripe, windows and a door facing the pumps
  const k = S.kiosk;
  box(list, k.u0, k.u1, 0, k.h - 0.4, k.v0, k.v1, C.cream);
  box(list, k.u0 - 0.35, k.u1 + 0.35, k.h - 0.4, k.h, k.v0 - 0.45, k.v1 + 0.25, C.ink);
  box(list, k.u0 - 0.38, k.u1 + 0.38, k.h - 0.3, k.h - 0.18, k.v0 - 0.48, k.v0 - 0.44, C.sun);
  const f = k.v0 - 0.03;
  box(list, k.u0 + 0.6, -1.3, 0.9, 2.5, f, k.v0, C.glass);
  box(list, 1.7, k.u1 - 0.6, 0.9, 2.5, f, k.v0, C.glass);
  box(list, -0.9, 1.1, 0.04, 2.35, f, k.v0, C.violet); // door
  box(list, -1.2, 1.4, 2.5, 2.62, f - 0.5, k.v0, C.sun); // little awning over the door
  box(list, k.u0 - 0.02, k.u1 + 0.02, 0, 0.35, k.v0 - 0.02, k.v1 + 0.02, C.violet); // base trim
  // pylon sign: ink pole, violet cabinet (its faces carry the GAS pictogram texture)
  const g = S.sign;
  box(list, g.u - g.pole, g.u + g.pole, 0, g.y0, g.v - g.pole, g.v + g.pole, C.ink);
  box(list, g.u - g.hu, g.u + g.hu, g.y0, g.y1, g.v - g.hv, g.v + g.hv, C.violet);
  box(list, g.u - g.hu - 0.06, g.u + g.hu + 0.06, g.y1, g.y1 + 0.12, g.v - g.hv - 0.06, g.v + g.hv + 0.06, C.sun);
  const geo = mergeGeometries(list, false);
  for (const gg of list) gg.dispose();
  return geo;
}

/** Sign face: cream frame, violet field, gold pump pictogram, GAS lettering. */
function signTexture() {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 200;
  const x = cv.getContext('2d');
  if (!x) return null;
  x.fillStyle = '#fff1d6';
  x.fillRect(0, 0, 256, 200);
  x.fillStyle = '#5b44a6';
  x.fillRect(10, 10, 236, 180);
  // pictogram (the same original path data as the map icon)
  if (typeof Path2D !== 'undefined') {
    x.save();
    x.translate(14, 46);
    x.scale(2.4, 2.4);
    x.lineJoin = 'round';
    x.lineCap = 'round';
    const body = new Path2D(FUEL_ICON.body);
    x.strokeStyle = '#2a2150';
    x.lineWidth = 4;
    x.stroke(body);
    x.stroke(new Path2D(FUEL_ICON.hose));
    x.fillStyle = '#ffc21f';
    x.fill(body);
    x.strokeStyle = '#ffc21f';
    x.lineWidth = 2.6;
    x.stroke(new Path2D(FUEL_ICON.hose));
    x.fillStyle = '#fff1d6';
    x.fill(new Path2D(FUEL_ICON.screen));
    x.restore();
  }
  x.fillStyle = '#fff1d6';
  x.strokeStyle = '#2a2150';
  x.lineWidth = 8;
  x.lineJoin = 'round';
  x.font = "64px 'Lilita One', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.strokeText('GAS', 186, 104);
  x.fillText('GAS', 186, 104);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildSignFaces(tex) {
  const g = STATION.sign;
  const w = g.hu * 2 - 0.16;
  const h = g.y1 - g.y0 - 0.16;
  const faces = [];
  for (const s of [-1, 1]) {
    const p = new THREE.PlaneGeometry(w, h);
    if (s < 0) p.rotateY(Math.PI); // faces the street (-v)
    p.translate(g.u, (g.y0 + g.y1) / 2, g.v + s * (g.hv + 0.01));
    faces.push(p);
  }
  const geo = mergeGeometries(faces, false);
  for (const p of faces) p.dispose();
  const mat = toToon(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  return new THREE.Mesh(geo, mat);
}

function shared() {
  if (_shared) return _shared;
  const geo = buildBody();
  const mat = toToon(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.05 }));
  const tex = signTexture();
  _shared = { geo, mat, tex };
  return _shared;
}

/** One gas station (shared geometry and materials). */
export function buildGasStationMesh() {
  const s = shared();
  const g = new THREE.Group();
  g.name = 'gas-station';
  const body = new THREE.Mesh(s.geo, s.mat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  if (s.tex) {
    if (!s.sign) s.sign = buildSignFaces(s.tex);
    const sign = new THREE.Mesh(s.sign.geometry, s.sign.material);
    g.add(sign);
  }
  g.matrixAutoUpdate = false;
  return g;
}
