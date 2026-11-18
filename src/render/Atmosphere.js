/**
 * Atmosphere — sky, sun + fill lighting, shadows, fog, clouds and the storm wall.
 *
 * World convention: metres, x = east, z = south (north is -z), y up, ground at y = 0.
 *
 * API
 * ---
 *   import { Atmosphere } from './render/Atmosphere.js';
 *
 *   const atmosphere = new Atmosphere({ scene, renderer, camera, quality: 'medium' });
 *     quality: 'low' | 'medium' | 'high'
 *     The constructor sets the renderer look (sRGB output, Neutral tone mapping at
 *     exposure 1.0, PCF shadow maps), replaces scene.fog / scene.background, and adds
 *     one THREE.Group (sky, clouds, lights, storm wall) to the scene.
 *
 *   atmosphere.update(dt, { focus, stormIntensity01 = 0 })      call once per frame
 *     dt                seconds since last frame
 *     focus             THREE.Vector3 the shadow box follows (player position). Optional;
 *                       the last focus is kept when omitted.
 *     stormIntensity01  0 = safe ... 1 = deep in the storm. Smoothed internally
 *                       (~0.4 s time constant), so it may be set abruptly.
 *
 *   atmosphere.setStorm({ cx, cz, r })    storm wall circle in world metres; cheap, call every frame
 *   atmosphere.setStorm(null)             hide the wall
 *   atmosphere.setQuality('low' | 'medium' | 'high')
 *   atmosphere.sun                        the THREE.DirectionalLight (read-only getter)
 *   atmosphere.dispose()                  removes everything, restores scene.fog / scene.background
 *
 * Extras (not required by the game, handy for tuning / debugging)
 *   atmosphere.hemisphere    the THREE.HemisphereLight fill
 *   atmosphere.stormWall     the wall THREE.Mesh (transparent; renderOrder -5 so it draws
 *                            before other transparent objects — change if you need otherwise)
 *   atmosphere.group         the THREE.Group holding everything
 *   atmosphere.quality       current quality string
 *   atmosphere.stormLevel    the smoothed storm intensity actually being rendered (0..1)
 *   atmosphere.fogColor      THREE.Color currently used for fog + horizon (live, do not mutate)
 *
 * Look (cartoon pass): saturated sky, cel-shaded puffy clouds (smooth ellipsoid normals, hard
 * sun terminator), crisp PCF shadows (radius 0.8), strong sky-tinted hemisphere fill so the
 * toon materials' dark sides stay colourful. Post-processing flags (outline / bloom /
 * renderScale) live in config.js QUALITY and are applied by render/Post.js, not here.
 * Tone mapping: on the plain path (low) the renderer tone-maps lit materials while the sky,
 * clouds, wall and fog colour are display-referred (toneMapped: false). On the post path the
 * scene renders linear into a half-float target and OutputPass tone-maps everything, sky and
 * fog included, so horizon and fog still match exactly (both get the same curve).
 *
 * Quality levels
 *   low     no shadows, 12 clouds, reduced storm-wall noise
 *   medium  2048 shadow map over a 180 m box (±90 m), 30 clouds
 *   high    4096 shadow map over a 260 m box (±130 m), 48 clouds
 *
 * Notes for the integrator
 *   - World materials only need `fog: true` (the default) and castShadow/receiveShadow flags.
 *   - The sky is drawn with depth test off before everything else and is always centred on
 *     whichever camera is rendering; below the horizon it is exactly the fog colour, so
 *     geometry that is fully fogged (≈2 km) melts into it.
 *   - update() and setStorm() allocate nothing.
 */
import * as THREE from 'three';

const _intTmp = new THREE.Color();

const TAU = Math.PI * 2;

const QUALITY = {
  performance: { shadows: false, shadowMapSize: 512, shadowExtent: 60, clouds: 0, wallDetail: 0 },
  low: { shadows: false, shadowMapSize: 1024, shadowExtent: 90, clouds: 12, wallDetail: 0 },
  medium: { shadows: true, shadowMapSize: 2048, shadowExtent: 90, clouds: 30, wallDetail: 1 },
  high: { shadows: true, shadowMapSize: 4096, shadowExtent: 130, clouds: 48, wallDetail: 1 },
};

// Direction *towards* the sun: mid-afternoon summer sun, south-west sky, ~48° elevation.
const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.74, 0.52).normalize();

// Clear-day and storm palettes. Colours are authored in sRGB hex; THREE converts to linear.
// Cartoon palette: deep saturated zenith, bright cyan-white horizon, warm sun and a strong
// sky-tinted fill so cel-shaded dark sides stay colourful instead of muddy.
const CLEAR = {
  zenith: 0x1565e8,
  mid: 0x46a2ff,
  horizon: 0xc2e8ff,
  fogDensity: 0.00085, // FogExp2: ~1% at 100 m, ~33% at 750 m, ~90% at 1800 m
  sunColor: 0xfff0cf,
  sunDisc: 0xfffcec,
  sunIntensity: 2.45,
  hemiSky: 0xc6e0ff,
  hemiGround: 0xd8c39a,
  hemiIntensity: 2.5,
  sunGlow: 1.0,
  cloudLit: 0xffffff,
  cloudShade: 0xb9cdf2,
};
const STORM = {
  zenith: 0x1f1447,
  mid: 0x38276b,
  horizon: 0x584686,
  fogDensity: 0.0024, // hazy by ~300 m, gone by ~800 m
  sunColor: 0xbbaefa,
  sunDisc: 0xcfc4ff,
  sunIntensity: 1.3,
  hemiSky: 0xa395e8,
  hemiGround: 0x5d4d82,
  hemiIntensity: 2.5,
  sunGlow: 0.1,
  cloudLit: 0x8372b8,
  cloudShade: 0x3c2f66,
};

const WALL_HEIGHT = 250; // metres above ground
const WALL_SINK = 6; // metres below ground, so the base never z-fights with the ground plane
const WALL_SEGMENTS = 192;

const CLOUD_TILE = 5200; // clouds live in a wrapping square tile centred on the camera
const CLOUD_MAX = QUALITY.high.clouds;
const CLOUD_WIND = new THREE.Vector2(7.5, -3.0); // m/s, drifting east-north-east

const SHADOW_LIGHT_DISTANCE = 260;
const STORM_SMOOTHING = 2.5; // 1/s

/* ------------------------------------------------------------------------------------ */
/* GLSL                                                                                   */
/* ------------------------------------------------------------------------------------ */

const GLSL_NOISE = /* glsl */ `
// Fixed rotation applied to noise inputs so the value-noise lattice never lines up with
// the world's horizontal / vertical axes (hides its grid).
const mat3 ATMO_LATTICE = mat3(0.80, 0.36, -0.48, -0.60, 0.48, -0.64, 0.0, 0.80, 0.60);
float atmoHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float atmoHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float atmoNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = atmoHash13(i);
  float n100 = atmoHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = atmoHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = atmoHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = atmoHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = atmoHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = atmoHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = atmoHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float atmoFbm2(vec3 p) {
  return atmoNoise(p) * 0.667 + atmoNoise(p * 2.03 + 11.7) * 0.333;
}
float atmoFbm3(vec3 p) {
  return atmoNoise(p) * 0.571 + atmoNoise(p * 2.03 + 11.7) * 0.286 + atmoNoise(p * 4.01 + 23.1) * 0.143;
}
`;

// Shared by the sky dome and the clouds so far clouds can dissolve into the exact sky colour.
const GLSL_SKY_GRADIENT = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
vec3 skyGradient(float h) {
  h = max(h, 0.0);
  vec3 c = mix(uHorizon, uMid, smoothstep(0.015, 0.34, h));
  return mix(c, uZenith, smoothstep(0.16, 1.0, h));
}
`;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // rotation only: the dome is always centred on the rendering camera
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunDisc;
uniform float uSunGlow;
uniform float uStorm;
uniform float uTime;
varying vec3 vDir;
${GLSL_SKY_GRADIENT}
${GLSL_NOISE}
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyGradient(dir.y);

  // overcast churn, only while the storm mood is active
  if (uStorm > 0.002) {
    vec2 p = dir.xz / (max(dir.y, 0.0) + 0.3);
    float n = atmoFbm3(ATMO_LATTICE * vec3(p * 1.1 + vec2(uTime * 0.021, -uTime * 0.013), uTime * 0.02));
    float lift = smoothstep(0.02, 0.32, dir.y);
    col *= mix(1.0, 0.66 + 0.72 * n, uStorm * lift);
  }

  // Sun disc + glow, blended (not added) so nothing clips. Zero at the horizon, so the
  // horizon stays exactly the fog colour.
  float mu = max(dot(dir, uSunDir), 0.0);
  float above = smoothstep(0.0, 0.14, dir.y);
  float disc = smoothstep(0.99948, 0.99962, mu);
  float halo = pow(mu, 1400.0) * 0.85 + pow(mu, 120.0) * 0.34 + pow(mu, 10.0) * 0.13;
  col = mix(col, uSunDisc, clamp((disc + halo) * uSunGlow * above, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // break up 8-bit banding in the gradient
  gl_FragColor.rgb += (atmoHash12(gl_FragCoord.xy) - 0.5) / 255.0;
}
`;

const CLOUD_VERTEX = /* glsl */ `
attribute vec3 aCenter;
uniform vec2 uDrift;
uniform float uTile;
uniform float uRange;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vHaze;
void main() {
  // wrap the cloud's centre into a tile centred on the camera, so the field is endless
  vec2 c = aCenter.xz + uDrift;
  c = mod(c - cameraPosition.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
  float d = length(c) / uRange;
  float grow = 1.0 - smoothstep(0.88, 1.0, d); // shrink to nothing at the edge: no popping
  vec3 wp = vec3(c.x + cameraPosition.x, aCenter.y, c.y + cameraPosition.z) + position * grow;
  vWorld = wp;
  vNormalW = normal;
  vHaze = smoothstep(0.5, 0.98, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CLOUD_FRAGMENT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
varying vec3 vNormalW;
varying vec3 vWorld;
varying float vHaze;
${GLSL_SKY_GRADIENT}
void main() {
  vec3 n = normalize(vNormalW);
  // cel bands: crisp sun terminator, a soft-edged shade, and a darker flat underside
  float d = dot(n, uSunDir);
  float lit = smoothstep(-0.08, 0.04, d);
  vec3 col = mix(uCloudShade, uCloudLit, lit);
  col *= 1.0 - 0.12 * (1.0 - smoothstep(-0.75, -0.55, n.y));
  vec3 view = vWorld - cameraPosition;
  vec3 sky = skyGradient(view.y / max(length(view), 1.0));
  col = mix(col, sky, vHaze);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const WALL_VERTEX = /* glsl */ `
varying vec3 vWorld;
varying float vH;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vH = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WALL_FRAGMENT = /* glsl */ `
uniform vec3 uCircle; // cx, cz, r
uniform vec2 uSwirl;  // accumulated swirl angles (radians) of the two flow layers
uniform float uTime;
uniform vec3 uWallDeep;
uniform vec3 uWallMid;
uniform vec3 uWallLight;
uniform vec3 uWallGlow;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec3 vWorld;
varying float vH;
${GLSL_NOISE}
vec2 atmoRot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
// thin bright lines along the 0.5 iso-contours of a noise value
float atmoFilament(float n, float width) {
  return 1.0 - smoothstep(0.0, width, abs(n - 0.5));
}
void main() {
  vec2 rel = vWorld.xz - uCircle.xy;
  float r = max(uCircle.z, 1.0);
  float y = vWorld.y;
  float dist = length(vWorld - cameraPosition);
  float farness = smoothstep(150.0, 1100.0, dist); // widen + calm fine structure before it aliases

  // Layer A: big slow billows, sheared with height, creeping upwards.
  vec2 qa = atmoRot(rel, uSwirl.x + y * 0.6 / r);
  vec3 pa = vec3(qa.x, y * 1.5 - uTime * 2.5, qa.y);
  #if WALL_DETAIL > 0
    float nA = atmoFbm3(ATMO_LATTICE * (pa * 0.0105));
  #else
    float nA = atmoFbm2(ATMO_LATTICE * (pa * 0.0105));
  #endif

  // Layer B: counter-rotating flow lines, very long along the flow and thin vertically,
  // bent by the billows.
  vec2 qb = atmoRot(rel, uSwirl.y - y * 1.3 / r);
  float nB = atmoNoise(ATMO_LATTICE * vec3(qb.x * 0.013, y * 0.085 + nA * 1.5, qb.y * 0.013));
  float flow = atmoFilament(nB, mix(0.05, 0.16, farness)) * mix(1.0, 0.6, farness);
  #if WALL_DETAIL > 0
    // a second, finer set riding with the billow layer; near the camera only
    float nC = atmoNoise(ATMO_LATTICE * vec3(qa.x * 0.027, y * 0.2 - uTime * 0.5, qa.y * 0.027) + 31.7);
    flow += atmoFilament(nC, 0.045) * 0.55 * (1.0 - farness);
  #endif
  flow = min(flow, 1.0);

  // Broad horizontal strata that ripple with the billows.
  float band = 0.5 + 0.5 * sin(y * 0.085 + nA * 6.0 - uTime * 0.35);

  float glowLine = exp(-max(y, 0.0) / mix(3.5, 12.0, farness));
  float glowWide = exp(-max(y, 0.0) / 46.0);
  float topFade = 1.0 - smoothstep(0.34, 1.0, vH + (nA - 0.5) * 0.3);

  float body = clamp(0.2 + 0.55 * nA + 0.2 * band - 0.3 * vH + 0.25 * glowWide, 0.0, 1.0);
  vec3 col = mix(uWallDeep, uWallMid, body);
  col = mix(col, uWallLight, flow * 0.85);
  col = mix(col, uWallGlow, clamp(glowLine * 0.95 + glowWide * 0.22, 0.0, 1.0));

  float alpha = 0.56 + 0.16 * nA + 0.08 * band;
  alpha = mix(alpha, 0.94, flow * 0.6);
  alpha += glowWide * 0.16 + glowLine * 0.3;
  alpha *= topFade;
  alpha *= smoothstep(0.3, 4.5, dist); // dissolve right at the camera so crossing never pops

  // Partial distance haze: the wall must stay readable as a band on the horizon.
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog * 0.38);

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ------------------------------------------------------------------------------------ */
/* Helpers                                                                                */
/* ------------------------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One non-indexed geometry holding CLOUD_MAX low-poly clouds (clusters of squashed,
 * flat-bottomed icospheres). Every vertex carries its cloud's centre in `aCenter`; the
 * vertex shader wraps and drifts whole clouds. Clouds are stored in order, so drawRange
 * selects how many are drawn. `firstVertexOfCloud[i]` is the vertex offset of cloud i.
 */
function buildCloudGeometry() {
  const rand = mulberry32(0xb37a11);
  const ico = new THREE.IcosahedronGeometry(1, 1); // polyhedron geometries are non-indexed
  const src = ico.getAttribute('position').array;
  const vertsPerPuff = src.length / 3;

  // Stratified placement so clouds do not clump and any prefix of the list is well spread.
  const cells = Math.ceil(Math.sqrt(CLOUD_MAX));
  const order = [];
  for (let i = 0; i < cells * cells; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }

  const clouds = [];
  let puffTotal = 0;
  for (let i = 0; i < CLOUD_MAX; i++) {
    const cell = order[i];
    const cellSize = CLOUD_TILE / cells;
    const cx = ((cell % cells) + 0.15 + rand() * 0.7) * cellSize - CLOUD_TILE / 2;
    const cz = (Math.floor(cell / cells) + 0.15 + rand() * 0.7) * cellSize - CLOUD_TILE / 2;
    const size = 0.85 + rand() * 0.8; // overall scale
    const cy = 300 + rand() * 200;
    const yaw = rand() * Math.PI;
    const count = 6 + Math.floor(rand() * 4);
    const puffs = [];
    for (let p = 0; p < count; p++) {
      const t = count === 1 ? 0 : p / (count - 1) - 0.5; // -0.5 .. 0.5 along the cloud
      const bulge = 1 - Math.abs(t) * 1.25; // bigger in the middle
      const radius = (34 + rand() * 22) * (0.55 + 0.6 * Math.max(bulge, 0.1)) * size;
      const along = t * 190 * size + (rand() - 0.5) * 24 * size;
      const across = (rand() - 0.5) * 60 * size;
      puffs.push({
        x: Math.cos(yaw) * along - Math.sin(yaw) * across,
        z: Math.sin(yaw) * along + Math.cos(yaw) * across,
        y: (rand() - 0.2) * 14 * size + radius * 0.45,
        rx: radius * (1.0 + rand() * 0.2),
        ry: radius * (0.82 + rand() * 0.18),
        rz: radius * (0.95 + rand() * 0.2),
        spin: rand() * TAU,
      });
    }
    clouds.push({ cx, cy, cz, puffs });
    puffTotal += count;
  }

  const vertexCount = puffTotal * vertsPerPuff;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const centers = new Float32Array(vertexCount * 3);
  const firstVertexOfCloud = new Uint32Array(CLOUD_MAX + 1);

  let v = 0;
  for (let i = 0; i < CLOUD_MAX; i++) {
    const cloud = clouds[i];
    firstVertexOfCloud[i] = v;
    for (const puff of cloud.puffs) {
      const cs = Math.cos(puff.spin);
      const sn = Math.sin(puff.spin);
      const floor = puff.y - puff.ry * 0.38; // flat cumulus base
      for (let k = 0; k < vertsPerPuff; k++) {
        const sx = src[k * 3];
        const sy = src[k * 3 + 1];
        const sz = src[k * 3 + 2];
        const x = (cs * sx - sn * sz) * puff.rx + puff.x;
        const z = (sn * sx + cs * sz) * puff.rz + puff.z;
        const y = Math.max(sy * puff.ry + puff.y, floor);
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        centers[v * 3] = cloud.cx;
        centers[v * 3 + 1] = cloud.cy;
        centers[v * 3 + 2] = cloud.cz;
        v++;
      }
      // smooth ellipsoid normals (puffy, rounded shading); the clamped base faces down
      for (let f = v - vertsPerPuff; f < v; f++) {
        const lx = positions[f * 3] - puff.x;
        const ly = positions[f * 3 + 1] - puff.y;
        const lz = positions[f * 3 + 2] - puff.z;
        let nx, ny, nz;
        if (positions[f * 3 + 1] <= floor + 1e-3) {
          nx = 0;
          ny = -1;
          nz = 0;
        } else {
          // gradient of the ellipsoid (scaled along world axes after the spin)
          nx = lx / (puff.rx * puff.rx);
          ny = ly / (puff.ry * puff.ry);
          nz = lz / (puff.rz * puff.rz);
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
        }
        normals[f * 3] = nx;
        normals[f * 3 + 1] = ny;
        normals[f * 3 + 2] = nz;
      }
    }
  }
  firstVertexOfCloud[CLOUD_MAX] = v;
  ico.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
  return { geometry, firstVertexOfCloud };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function palette(def) {
  return {
    zenith: new THREE.Color(def.zenith),
    mid: new THREE.Color(def.mid),
    horizon: new THREE.Color(def.horizon),
    sunColor: new THREE.Color(def.sunColor),
    sunDisc: new THREE.Color(def.sunDisc),
    hemiSky: new THREE.Color(def.hemiSky),
    hemiGround: new THREE.Color(def.hemiGround),
    cloudLit: new THREE.Color(def.cloudLit),
    cloudShade: new THREE.Color(def.cloudShade),
    fogDensity: def.fogDensity,
    sunIntensity: def.sunIntensity,
    hemiIntensity: def.hemiIntensity,
    sunGlow: def.sunGlow,
  };
}

/* ------------------------------------------------------------------------------------ */
/* Atmosphere                                                                             */
/* ------------------------------------------------------------------------------------ */

export class Atmosphere {
  constructor({ scene, renderer, camera, quality = 'medium' }) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;

    this._clear = palette(CLEAR);
    this._stormPal = palette(STORM);
    this._storm = 0; // smoothed storm intensity
    this._time = 0;
    this._disposed = false;

    // --- renderer look -----------------------------------------------------------------
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping; // keeps flat stylised colours saturated
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // r187: hardware PCF + rotated Vogel disc

    // --- fog / background --------------------------------------------------------------
    this._prevFog = scene.fog;
    this._prevBackground = scene.background;
    this._fog = new THREE.FogExp2(this._clear.horizon.getHex(), this._clear.fogDensity);
    this._fog.color.copy(this._clear.horizon);
    scene.fog = this._fog;
    // The dome always covers the background; this colour is only a matching fallback and
    // shares the fog's Color instance so it tracks the storm blend for free.
    scene.background = this._fog.color;

    // --- shared uniforms ---------------------------------------------------------------
    const u = (this._uniforms = {
      uZenith: { value: this._clear.zenith.clone() },
      uMid: { value: this._clear.mid.clone() },
      uHorizon: { value: this._fog.color }, // same instance as the fog colour: no seam, ever
      uSunDir: { value: SUN_DIRECTION.clone() },
      uSunDisc: { value: this._clear.sunDisc.clone() },
      uSunGlow: { value: this._clear.sunGlow },
      uStorm: { value: 0 },
      uTime: { value: 0 },
      uCloudLit: { value: this._clear.cloudLit.clone() },
      uCloudShade: { value: this._clear.cloudShade.clone() },
      uDrift: { value: new THREE.Vector2() },
      uTile: { value: CLOUD_TILE },
      uRange: { value: 2400 },
      uCircle: { value: new THREE.Vector3(0, 0, 1) },
      uSwirl: { value: new THREE.Vector2() },
      uWallDeep: { value: new THREE.Color(0x160c4a) },
      uWallMid: { value: new THREE.Color(0x4c2bb5) },
      uWallLight: { value: new THREE.Color(0xcdbfff) },
      uWallGlow: { value: new THREE.Color(0xc4a2ff) },
      uFogColor: { value: this._fog.color },
      uFogDensity: { value: this._clear.fogDensity },
    });

    this.group = new THREE.Group();
    this.group.name = 'Atmosphere';
    scene.add(this.group);

    // --- sky dome ----------------------------------------------------------------------
    this._skyGeometry = new THREE.BoxGeometry(2, 2, 2);
    this._skyMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereSky',
      uniforms: {
        uZenith: u.uZenith,
        uMid: u.uMid,
        uHorizon: u.uHorizon,
        uSunDir: u.uSunDir,
        uSunDisc: u.uSunDisc,
        uSunGlow: u.uSunGlow,
        uStorm: u.uStorm,
        uTime: u.uTime,
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false, // display-referred, exactly like three's fog colour (see header)
    });
    this._sky = new THREE.Mesh(this._skyGeometry, this._skyMaterial);
    this._sky.name = 'AtmosphereSky';
    this._sky.frustumCulled = false;
    this._sky.renderOrder = -1000; // first thing drawn; everything else paints over it
    this._sky.matrixAutoUpdate = false;
    this.group.add(this._sky);

    // --- clouds ------------------------------------------------------------------------
    const cloudData = buildCloudGeometry();
    this._cloudGeometry = cloudData.geometry;
    this._cloudFirstVertex = cloudData.firstVertexOfCloud;
    this._cloudMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereClouds',
      uniforms: {
        uZenith: u.uZenith,
        uMid: u.uMid,
        uHorizon: u.uHorizon,
        uSunDir: u.uSunDir,
        uCloudLit: u.uCloudLit,
        uCloudShade: u.uCloudShade,
        uDrift: u.uDrift,
        uTile: u.uTile,
        uRange: u.uRange,
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      fog: false,
      toneMapped: false,
    });
    this._clouds = new THREE.Mesh(this._cloudGeometry, this._cloudMaterial);
    this._clouds.name = 'AtmosphereClouds';
    this._clouds.frustumCulled = false; // positioned in the vertex shader
    this._clouds.renderOrder = -900; // right after the sky, before the world (they are far away)
    this._clouds.matrixAutoUpdate = false;
    this.group.add(this._clouds);

    // --- lights ------------------------------------------------------------------------
    this._sun = new THREE.DirectionalLight(this._clear.sunColor.getHex(), this._clear.sunIntensity);
    this._sun.color.copy(this._clear.sunColor);
    this._sun.name = 'AtmosphereSun';
    this._sun.shadow.camera.near = 1;
    this._sun.shadow.camera.far = SHADOW_LIGHT_DISTANCE * 2;
    this._sun.shadow.radius = 0.8; // crisp cartoon shadows (a touch of PCF only to kill stair-steps)
    this.group.add(this._sun);
    this.group.add(this._sun.target);

    this._hemi = new THREE.HemisphereLight(
      this._clear.hemiSky.getHex(),
      this._clear.hemiGround.getHex(),
      this._clear.hemiIntensity,
    );
    this._hemi.color.copy(this._clear.hemiSky);
    this._hemi.groundColor.copy(this._clear.hemiGround);
    this._hemi.name = 'AtmosphereFill';
    this.group.add(this._hemi);

    // Shadow-camera basis. Matches Object3D.lookAt for cameras (z = towards the light),
    // so snapping along these axes is snapping along shadow-map texel rows/columns.
    this._lightDir = SUN_DIRECTION.clone();
    this._lightRight = new THREE.Vector3(0, 1, 0).cross(this._lightDir).normalize();
    this._lightUp = new THREE.Vector3().crossVectors(this._lightDir, this._lightRight).normalize();
    this._focus = new THREE.Vector3();

    // --- storm wall --------------------------------------------------------------------
    this._wallGeometry = new THREE.CylinderGeometry(1, 1, 1, WALL_SEGMENTS, 1, true);
    this._wallGeometry.translate(0, 0.5, 0); // y: 0 (base) .. 1 (top)
    this._wallMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereStormWall',
      defines: { WALL_DETAIL: 1 },
      uniforms: {
        uCircle: u.uCircle,
        uSwirl: u.uSwirl,
        uTime: u.uTime,
        uWallDeep: u.uWallDeep,
        uWallMid: u.uWallMid,
        uWallLight: u.uWallLight,
        uWallGlow: u.uWallGlow,
        uFogColor: u.uFogColor,
        uFogDensity: u.uFogDensity,
      },
      vertexShader: WALL_VERTEX,
      fragmentShader: WALL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // three draws back faces then front faces for transparent double-sided
      fog: false,
      toneMapped: false,
    });
    this._wall = new THREE.Mesh(this._wallGeometry, this._wallMaterial);
    this._wall.name = 'AtmosphereStormWall';
    this._wall.renderOrder = -5; // before other transparents, so nearby effects draw over it
    this._wall.visible = false;
    this._wall.position.y = -WALL_SINK;
    this._wall.scale.set(1, WALL_HEIGHT + WALL_SINK, 1);
    this.group.add(this._wall);
    this._wallRadius = 0;

    this._quality = null;
    this.setQuality(quality);
    this._applyMood(0);
    this._placeShadowBox();
  }

  /** The directional sun light. */
  get sun() {
    return this._sun;
  }

  get hemisphere() {
    return this._hemi;
  }

  get stormWall() {
    return this._wall;
  }

  get quality() {
    return this._quality;
  }

  /** Smoothed storm intensity currently rendered (0..1). */
  get stormLevel() {
    return this._storm;
  }

  get fogColor() {
    return this._fog.color;
  }

  /**
   * @param {number} dt seconds
   * @param {{ focus?: THREE.Vector3, stormIntensity01?: number }} [state]
   */
  update(dt, state) {
    if (this._disposed) return;
    if (!(dt > 0)) dt = 0;
    const focus = state ? state.focus : undefined;
    let target = state ? state.stormIntensity01 : 0;
    target = target > 0 ? clamp01(target) : 0; // also swallows undefined / NaN

    // storm mood, exponentially smoothed so abrupt inputs never snap
    const k = 1 - Math.exp(-dt * STORM_SMOOTHING);
    this._storm += (target - this._storm) * k;
    if (Math.abs(target - this._storm) < 1e-4) this._storm = target;
    this._applyMood(this._storm);
    this._applyInterior();

    // time-based animation (clamped so a background-tab hitch does not teleport things)
    const adt = dt > 0.25 ? 0.25 : dt;
    this._time += adt;
    const u = this._uniforms;
    u.uTime.value = this._time;

    const drift = u.uDrift.value;
    drift.x = (drift.x + CLOUD_WIND.x * adt) % CLOUD_TILE;
    drift.y = (drift.y + CLOUD_WIND.y * adt) % CLOUD_TILE;
    // keep the cloud fade-out radius inside the camera's far plane
    const far = this.camera && this.camera.far ? this.camera.far : 3000;
    u.uRange.value = Math.min(CLOUD_TILE * 0.47, far * 0.8);

    if (this._wall.visible) {
      // constant tangential speed whatever the radius: integrate angular speed = v / r
      const r = this._wallRadius > 40 ? this._wallRadius : 40;
      const swirl = u.uSwirl.value;
      swirl.x = (swirl.x + (5.0 / r) * adt) % TAU;
      swirl.y = (swirl.y - (15.0 / r) * adt) % TAU;
    }

    if (focus) this._focus.copy(focus);
    this._placeShadowBox();
  }

  /**
   * Interior gallery mood (Crystal Bridges): k 0..1 blends fog, hemisphere and sun toward a
   * musewalk wing palette { fog, floor, lightColor } (hex strings). Applied after the storm mood
   * every update(); k = 0 leaves the outdoor look untouched. Cheap; call every frame.
   */
  setInterior(k, pal) {
    this._interiorK = k > 0 ? Math.min(1, k) : 0;
    if (pal && pal !== this._interiorPal) {
      this._interiorPal = pal;
      if (!this._intCol) this._intCol = { fog: new THREE.Color(), floor: new THREE.Color(), light: new THREE.Color() };
      this._intCol.fog.set(pal.fog || '#c5d2c8');
      this._intCol.floor.set(pal.floor || '#0d0a08');
      this._intCol.light.set(pal.lightColor || '#ffe2b8');
    }
  }

  _applyInterior() {
    const k = this._interiorK || 0;
    if (k <= 0.001 || !this._intCol) return;
    const c = this._intCol;
    // musewalk halls: Fog(hall.fog, 10, 64) and HemisphereLight(light * 0.5, floor, 1.1). Kept
    // lighter than musewalk's black box: the real galleries are daylit through the glass.
    // Exp2 density 0.0095 keeps a 70 m gallery readable end to end (~8% haze at 30 m, ~36% at
    // 70 m; the old 0.036 washed it out to ~70% at 30 m) and the warm hemisphere fill keeps the
    // rooms bright instead of flat grey.
    this._fog.color.lerp(_intTmp.copy(c.fog).lerp(c.light, 0.3), k * 0.8);
    this._fog.density = this._fog.density + (0.0095 - this._fog.density) * k;
    this._uniforms.uFogDensity.value = this._fog.density;
    this._hemi.color.lerp(_intTmp.copy(c.light).multiplyScalar(0.95), k);
    this._hemi.groundColor.lerp(_intTmp.copy(c.floor).lerp(c.light, 0.35), k);
    this._hemi.intensity *= 1 + 0.15 * k;
    this._sun.intensity *= 1 - 0.55 * k;
  }

  /**
   * Storm wall circle, world metres. Pass null to hide it. Safe to call every frame.
   * @param {{ cx: number, cz: number, r: number } | null} circle
   */
  setStorm(circle) {
    if (this._disposed) return;
    if (!circle || !(circle.r > 0)) {
      this._wall.visible = false;
      return;
    }
    const { cx, cz, r } = circle;
    this._wallRadius = r;
    this._wall.visible = true;
    this._wall.position.x = cx;
    this._wall.position.z = cz;
    this._wall.scale.x = r;
    this._wall.scale.z = r;
    this._uniforms.uCircle.value.set(cx, cz, r);
  }

  /** @param {'low' | 'medium' | 'high'} quality */
  setQuality(quality) {
    if (this._disposed) return;
    const name = QUALITY[quality] ? quality : 'medium';
    if (name === this._quality) return;
    this._quality = name;
    const q = QUALITY[name];

    // shadows
    const shadow = this._sun.shadow;
    this._shadowExtent = q.shadowExtent;
    this._shadowMapSize = q.shadowMapSize;
    this._sun.castShadow = q.shadows;
    if (shadow.mapSize.x !== q.shadowMapSize) {
      shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null; // re-created at the new size on the next render
      }
    }
    if (!q.shadows && shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    const cam = shadow.camera;
    cam.left = -q.shadowExtent;
    cam.right = q.shadowExtent;
    cam.top = q.shadowExtent;
    cam.bottom = -q.shadowExtent;
    cam.updateProjectionMatrix();
    // Bias scales with texel size (world metres per shadow texel).
    const texel = (2 * q.shadowExtent) / q.shadowMapSize;
    shadow.bias = -0.00008;
    shadow.normalBias = texel * 0.9;

    // clouds
    this._clouds.visible = q.clouds > 0;
    this._cloudGeometry.setDrawRange(0, this._cloudFirstVertex[Math.min(q.clouds, CLOUD_MAX)]);

    // storm wall noise detail
    if (this._wallMaterial.defines.WALL_DETAIL !== q.wallDetail) {
      this._wallMaterial.defines.WALL_DETAIL = q.wallDetail;
      this._wallMaterial.needsUpdate = true;
    }

    this._placeShadowBox();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.scene.remove(this.group);
    if (this.scene.fog === this._fog) this.scene.fog = this._prevFog;
    if (this.scene.background === this._fog.color) this.scene.background = this._prevBackground;
    this._skyGeometry.dispose();
    this._skyMaterial.dispose();
    this._cloudGeometry.dispose();
    this._cloudMaterial.dispose();
    this._wallGeometry.dispose();
    this._wallMaterial.dispose();
    this._sun.dispose(); // frees the shadow map
    this._hemi.dispose();
  }

  /* ---------------------------------------------------------------------------------- */

  /** Blend every mood-dependent value between the clear and storm palettes. */
  _applyMood(s) {
    const a = this._clear;
    const b = this._stormPal;
    const u = this._uniforms;
    u.uStorm.value = s;
    u.uZenith.value.lerpColors(a.zenith, b.zenith, s);
    u.uMid.value.lerpColors(a.mid, b.mid, s);
    this._fog.color.lerpColors(a.horizon, b.horizon, s); // also uHorizon, uFogColor, background
    // Haze thins out with camera altitude (full below 80 m, 60% above 450 m) so the town
    // stays readable from the air; at street / rooftop level it is unchanged.
    const camY = this.camera ? this.camera.position.y : 0;
    const t = clamp01((camY - 80) / 370);
    const clarity = 1 - 0.4 * t * t * (3 - 2 * t);
    this._fog.density = lerp(a.fogDensity, b.fogDensity, s) * clarity;
    u.uFogDensity.value = this._fog.density;
    u.uSunDisc.value.lerpColors(a.sunDisc, b.sunDisc, s);
    u.uSunGlow.value = lerp(a.sunGlow, b.sunGlow, s);
    u.uCloudLit.value.lerpColors(a.cloudLit, b.cloudLit, s);
    u.uCloudShade.value.lerpColors(a.cloudShade, b.cloudShade, s);
    this._sun.color.lerpColors(a.sunColor, b.sunColor, s);
    this._sun.intensity = lerp(a.sunIntensity, b.sunIntensity, s);
    this._hemi.color.lerpColors(a.hemiSky, b.hemiSky, s);
    this._hemi.groundColor.lerpColors(a.hemiGround, b.hemiGround, s);
    this._hemi.intensity = lerp(a.hemiIntensity, b.hemiIntensity, s);
  }

  /**
   * Centre the orthographic shadow box on the focus, snapped to whole shadow texels in
   * light space. The light never rotates, so a snapped translation means every static
   * edge rasterises into identical texels frame after frame: no shimmer while moving.
   */
  _placeShadowBox() {
    const texel = (2 * this._shadowExtent) / this._shadowMapSize;
    const f = this._focus;
    const right = this._lightRight;
    const up = this._lightUp;
    const dir = this._lightDir;
    const sx = Math.round(f.dot(right) / texel) * texel;
    const sy = Math.round(f.dot(up) / texel) * texel;
    const sz = Math.round(f.dot(dir)); // depth: 1 m steps keep the depth range stable
    const tx = right.x * sx + up.x * sy + dir.x * sz;
    const ty = right.y * sx + up.y * sy + dir.y * sz;
    const tz = right.z * sx + up.z * sy + dir.z * sz;
    const sun = this._sun;
    sun.target.position.set(tx, ty, tz);
    sun.position.set(
      tx + dir.x * SHADOW_LIGHT_DISTANCE,
      ty + dir.y * SHADOW_LIGHT_DISTANCE,
      tz + dir.z * SHADOW_LIGHT_DISTANCE,
    );
  }
}
