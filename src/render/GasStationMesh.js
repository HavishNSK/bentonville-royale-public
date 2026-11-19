// BENTONVILLE ROYALE — gas station mesh (built in code): a canopy on four posts over two pump
// islands (two pumps each, with hoses), a small kiosk behind them and a pylon sign, all dressed in
// the station's brand (game/vehicles/gasBrands.js: an invented name, colours and an original mark).
//
//   const m = buildGasStationMesh(brand)  // THREE.Group in station-local space (vehicles/gasStations.js):
//                                         // x = u (along the street), z = v (away from it), ground y = 0
//   m.userData.setPump(k, { dead, held })  // pump k whole / a scorched stump; nozzle holstered or not
//
// Draw calls: the station body is ONE vertex-coloured toon mesh per brand (shared by its stations);
// every pump is its own small mesh (so it can blow up), with its holstered nozzle and its stump;
// the sign and fascia faces are small textured meshes (canvas textures, only when a document exists).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from './Toon.js';
import { STATION, pumpSpots } from '../game/vehicles/gasStations.js';
import { brandFor, drawBrandSign, drawBrandFascia } from '../game/vehicles/gasBrands.js';

const C = {
  ink: 0x2a2150,
  cream: 0xfff1d6,
  creamShade: 0xe9dcc0,
  white: 0xfbf8f2,
  concrete: 0xc8c2b4,
  slab: 0xb4afa4,
  screen: 0x13202c,
  glass: 0x8fd4ff,
  hose: 0x1d1a2a,
  nozzle: 0x8a93a3,
  char: 0x2b2522,
  scorch: 0x171312,
};

const FASCIA = { y0: STATION.canopy.y0 + 0.1, y1: STATION.canopy.y1 + 0.35 }; // above the underside, taller than the roof collider: room for the name

const _brandCache = new Map();
let _mat = null;

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

/** A hose: a tube through points. */
function hose(list, pts, r, hex) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const g = new THREE.TubeGeometry(curve, 12, r, 5, false);
  list.push(colorize(g, hex));
}

function merged(list) {
  const geo = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return geo;
}

function material() {
  if (!_mat) _mat = toToon(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.05 }));
  return _mat;
}

/** One pump, centred on its island spot (local x = u, z = v), in the brand's trim. */
function pumpGeo(brand) {
  const B = brand.colors;
  const P = STATION.pump;
  const ib = STATION.island.h;
  const list = [];
  box(list, -P.hu, P.hu, ib, ib + 0.22, -P.hv, P.hv, B.trim); // plinth
  box(list, -P.hu, P.hu, ib + 0.22, P.h - 0.22, -P.hv, P.hv, C.white); // body
  box(list, -P.hu - 0.03, P.hu + 0.03, P.h - 0.22, P.h, -P.hv - 0.03, P.hv + 0.03, B.cap); // cap
  for (const s of [-1, 1]) {
    const f = s < 0 ? -P.hv - 0.02 : P.hv;
    box(list, -0.3, 0.3, P.h - 0.62, P.h - 0.32, f, f + 0.02, C.screen); // display
    box(list, -P.hu, P.hu, ib + 0.62, ib + 0.82, f, f + 0.02, B.stripe); // brand band
    box(list, -0.2, 0.2, ib + 0.34, ib + 0.5, f, f + 0.02, B.cap); // price window
  }
  return merged(list);
}

/** The holstered nozzle and its hose loop on the pump's outer side (`so` = -1 / +1). */
function holsterGeo(so) {
  const P = STATION.pump;
  const list = [];
  const hx = so * (P.hu + 0.06);
  box(list, hx - 0.06, hx + 0.06, 0.9, 1.25, -0.12, 0.12, C.nozzle);
  hose(list, [[so * P.hu * 0.6, P.h - 0.25, 0], [hx + so * 0.2, 1.3, 0.05], [hx + so * 0.25, 0.55, 0.1], [hx + so * 0.08, 0.95, 0]], 0.035, C.hose);
  return merged(list);
}

/** What is left after a pump blows up: a charred stub on a scorch mark. */
function stumpGeo() {
  const P = STATION.pump;
  const ib = STATION.island.h;
  const list = [];
  box(list, -P.hu - 0.25, P.hu + 0.25, ib, ib + 0.012, -P.hv - 0.25, P.hv + 0.25, C.scorch);
  box(list, -P.hu, P.hu, ib, ib + 0.22, -P.hv, P.hv, C.char);
  box(list, -P.hu * 0.8, P.hu * 0.3, ib + 0.22, ib + 0.42, -P.hv * 0.8, P.hv * 0.6, C.char);
  box(list, P.hu * 0.1, P.hu * 0.7, ib + 0.22, ib + 0.33, -P.hv * 0.5, P.hv * 0.8, C.scorch);
  return merged(list);
}

function bodyGeo(brand) {
  const B = brand.colors;
  const S = STATION;
  const list = [];
  const L = S.lot;
  // concrete forecourt over the whole lot (sits just above the ground layers)
  box(list, L.u0, L.u1, 0, 0.04, L.v0, L.v1, C.slab);
  // canopy: cream underside, a tall fascia in the brand colour with its stripe, flat top
  const c = S.canopy;
  box(list, c.u0, c.u1, c.y0, c.y0 + 0.1, c.v0, c.v1, C.cream);
  box(list, c.u0 - 0.08, c.u1 + 0.08, FASCIA.y0, FASCIA.y1, c.v0 - 0.08, c.v1 + 0.08, B.fascia);
  box(list, c.u0 - 0.1, c.u1 + 0.1, FASCIA.y0 - 0.01, FASCIA.y0 + 0.16, c.v0 - 0.1, c.v1 + 0.1, B.stripe);
  box(list, c.u0 - 0.1, c.u1 + 0.1, FASCIA.y1 - 0.07, FASCIA.y1 + 0.01, c.v0 - 0.1, c.v1 + 0.1, B.stripe); // thin top band
  box(list, c.u0 + 0.1, c.u1 - 0.1, FASCIA.y1, FASCIA.y1 + 0.03, c.v0 + 0.1, c.v1 - 0.1, C.creamShade);
  // canopy lights: small panels under the roof
  for (const iv of S.islands) for (const lu of [-6, -2, 2, 6]) box(list, lu - 0.5, lu + 0.5, c.y0 - 0.04, c.y0, iv - 0.25, iv + 0.25, 0xffffff);
  // islands and posts (the pumps are separate meshes)
  const I = S.island;
  for (const iv of S.islands) {
    box(list, -I.hu, I.hu, 0, I.h, iv - I.hv, iv + I.hv, C.concrete);
    box(list, -I.hu - 0.02, I.hu + 0.02, I.h - 0.04, I.h, iv - I.hv - 0.02, iv + I.hv + 0.02, B.cap); // curb paint
    for (const su of [-1, 1]) {
      const pu = su * S.postU;
      box(list, pu - S.post, pu + S.post, I.h, c.y0, iv - S.post, iv + S.post, C.white);
      box(list, pu - S.post - 0.05, pu + S.post + 0.05, I.h, I.h + 0.5, iv - S.post - 0.05, iv + S.post + 0.05, B.trim); // bumper collar
    }
  }
  // kiosk: cream walls, a roof slab in the brand colour, windows and a door facing the pumps
  const k = S.kiosk;
  box(list, k.u0, k.u1, 0, k.h - 0.4, k.v0, k.v1, C.cream);
  box(list, k.u0 - 0.35, k.u1 + 0.35, k.h - 0.4, k.h, k.v0 - 0.45, k.v1 + 0.25, B.fascia);
  box(list, k.u0 - 0.38, k.u1 + 0.38, k.h - 0.3, k.h - 0.18, k.v0 - 0.48, k.v0 - 0.44, B.stripe);
  const f = k.v0 - 0.03;
  box(list, k.u0 + 0.6, -1.3, 0.9, 2.5, f, k.v0, C.glass);
  box(list, 1.7, k.u1 - 0.6, 0.9, 2.5, f, k.v0, C.glass);
  box(list, -0.9, 1.1, 0.04, 2.35, f, k.v0, C.ink); // door
  box(list, -1.2, 1.4, 2.5, 2.62, f - 0.5, k.v0, B.stripe); // little awning over the door
  box(list, k.u0 - 0.02, k.u1 + 0.02, 0, 0.35, k.v0 - 0.02, k.v1 + 0.02, B.trim); // base trim
  // pylon sign: pole and cabinet (its faces carry the brand's sign texture)
  const g = S.sign;
  box(list, g.u - g.pole, g.u + g.pole, 0, g.y0, g.v - g.pole, g.v + g.pole, C.ink);
  box(list, g.u - g.hu, g.u + g.hu, g.y0, g.y1, g.v - g.hv, g.v + g.hv, B.sign);
  box(list, g.u - g.hu - 0.06, g.u + g.hu + 0.06, g.y1, g.y1 + 0.12, g.v - g.hv - 0.06, g.v + g.hv + 0.06, B.stripe);
  return merged(list);
}

function canvasTexture(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d');
  if (!x) return null;
  draw(x, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Two faces (front / back) of a w x h plane centred at (u, y), at v -+ dv. */
function facePair(u, y, v, dv, w, h) {
  const faces = [];
  for (const s of [-1, 1]) {
    const p = new THREE.PlaneGeometry(w, h);
    if (s < 0) p.rotateY(Math.PI); // faces the street (-v)
    p.translate(u, y, v + s * dv);
    faces.push(p);
  }
  return mergeGeometries(faces, false);
}

function texturedMesh(geo, tex) {
  return new THREE.Mesh(geo, toToon(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })));
}

function forBrand(brand) {
  let s = _brandCache.get(brand.id);
  if (s) return s;
  const g = STATION.sign;
  const c = STATION.canopy;
  s = { body: bodyGeo(brand), pump: pumpGeo(brand), holster: [holsterGeo(-1), holsterGeo(1)], stump: stumpGeo(), sign: null, fascia: null };
  const signTex = canvasTexture(256, 200, (x, w, h) => drawBrandSign(x, brand, w, h));
  if (signTex) s.sign = texturedMesh(facePair(g.u, (g.y0 + g.y1) / 2, g.v, g.hv + 0.01, g.hu * 2 - 0.16, g.y1 - g.y0 - 0.16), signTex);
  const fw = 7.6;
  const fh = FASCIA.y1 - FASCIA.y0 - 0.26;
  const fasciaTex = canvasTexture(1024, Math.round((1024 * fh) / fw), (x, w, h) => drawBrandFascia(x, brand, w, h));
  if (fasciaTex) {
    const geo = facePair(0, (FASCIA.y0 + 0.16 + FASCIA.y1 - 0.07) / 2, (c.v0 + c.v1) / 2, (c.v1 - c.v0) / 2 + 0.09, fw, fh);
    s.fascia = texturedMesh(geo, fasciaTex);
  }
  _brandCache.set(brand.id, s);
  return s;
}

/** One gas station in `brand` (shared geometry and materials). */
export function buildGasStationMesh(brand = brandFor(0)) {
  const s = forBrand(brand || brandFor(0));
  const mat = material();
  const g = new THREE.Group();
  g.name = 'gas-station';
  const body = new THREE.Mesh(s.body, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  for (const t of [s.sign, s.fascia]) if (t) g.add(new THREE.Mesh(t.geometry, t.material));
  const pumps = [];
  for (const sp of pumpSpots()) {
    const at = (m) => {
      m.position.set(sp.u, 0, sp.v);
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      g.add(m);
      return m;
    };
    const pump = at(new THREE.Mesh(s.pump, mat));
    pump.castShadow = true;
    const holster = at(new THREE.Mesh(s.holster[sp.side < 0 ? 0 : 1], mat));
    const stump = at(new THREE.Mesh(s.stump, mat));
    stump.visible = false;
    pumps.push({ pump, holster, stump });
  }
  g.userData.pumps = pumps;
  g.userData.setPump = (k, { dead = false, held = false } = {}) => {
    const p = pumps[k];
    if (!p) return;
    p.pump.visible = !dead;
    p.holster.visible = !dead && !held;
    p.stump.visible = dead;
  };
  g.userData.brand = brand.id;
  g.matrixAutoUpdate = false;
  return g;
}
