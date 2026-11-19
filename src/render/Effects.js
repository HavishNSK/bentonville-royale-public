/**
 * Effects — pooled, batched visual effects for Bentonville Royale.
 *
 * World convention: metres, x = east, z = south, y up, ground at y = 0.
 *
 * API
 * ---
 *   import { Effects } from './render/Effects.js';
 *
 *   const fx = new Effects({ scene, camera, quality: 'medium' });   // 'low' | 'medium' | 'high'
 *   fx.update(dt);                                                   // once per frame, before render
 *
 *   fx.tracer(from, to, { color = 0xfff2b0, width = 0.06, speed = 400 })
 *   fx.muzzleFlash(position, direction, { scale = 1 })
 *   fx.impact(position, normal, surface)          // 'wood' | 'brick' | 'metal' | 'dirt' | 'body' | 'shield'
 *   fx.harvestHit(position, material, isWeakPoint) // 'wood' | 'brick' | 'metal'
 *   fx.debris(position, material, { count = 14, size = 0.35, spread = 2 })
 *   fx.wallBreak({ ax, az, bx, bz }, y0, y1, material) // a broken building wall panel
 *   fx.buildPlace(position, size, material)       // position = box centre, size = box extents (Vector3)
 *   const beam = fx.lootBeam(position, rarity)    // 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' (or 0..4)
 *         beam.setPosition(v); beam.setVisible(b); beam.remove();
 *   fx.pickupBurst(position, rarity)
 *   const glow = fx.chestGlow(position)           // position = chest base
 *         glow.remove();
 *   fx.chestOpen(position)
 *   fx.aura(target, kind, duration)               // kind 'heal' | 'shield'; target = Object3D or Vector3 (feet)
 *   fx.shieldPop(position)
 *   fx.elimination(position, color)               // position = feet of the eliminated character
 *   fx.explosion(position, { radius = 5 })        // grenade blast; the ground ring spreads to `radius`
 *   fx.grenadeBlink(position)                     // one blink of a live grenade's fuse light
 *   fx.rocketTrail(position)                      // exhaust of a flying rocket, once per trail step
 *   fx.ring(position, { color = 0xffffff, radius = 3, duration = 0.5 })
 *   fx.dustPuff(position, { scale = 1 })
 *   fx.setQuality(quality)
 *   fx.clear()                                    // drops every transient effect and every persistent handle
 *   fx.dispose()                                  // removes everything from the scene and frees GPU resources
 *
 * Extras (not in the original spec, harmless to ignore)
 *   fx.stats()      -> { sprites, tracers, debris, decals, beams, boxes, total, capacity } live instance counts
 *                      (returns the same object every call)
 *   fx.group        the single THREE.Group that holds every batch mesh and pooled light
 *   fx.quality      current quality string
 *
 * Contract
 *   - Position / direction / normal / size arguments are read once and never retained or mutated.
 *     The one exception is aura(): `target` is kept (read-only) for `duration` seconds so the
 *     particles can follow it.
 *   - update() and every spawn method except lootBeam()/chestGlow() allocate nothing. Those two
 *     allocate one tiny handle object per call.
 *   - Everything renders in 6 draw calls at most (one per batch, and a batch with nothing alive is
 *     skipped): sprites, tracers, debris chunks, ground decals, vertical beams, build boxes.
 *   - All motion is evaluated in the vertex shaders from spawn-time attributes (stateless
 *     particles), so update() costs the same with 0 or 4000 live particles.
 *   - Pools are ring buffers; when one is full the oldest instance is recycled. Persistent pools
 *     (128 loot beams, 64 chest glows) also recycle their oldest handle, which then goes inert.
 *   - 2 (medium) / 3 (high) / 0 (low) pooled PointLights live permanently in the group at
 *     intensity 0, so muzzle flashes never change the light count. setQuality() across a
 *     light-count boundary adds/removes lights, which costs one shader recompile.
 *   - Effects fade with scene.fog (Fog or FogExp2) instead of tinting towards the fog colour;
 *     debris chunks are ordinary lit Lambert geometry and take scene lights, fog and shadows.
 *   - Requires THREE.WebGLRenderer (GLSL ShaderMaterials).
 */
import * as THREE from 'three';
import { toonGradient } from './Toon.js';
import { MATERIAL_COLOR } from '../core/config.js';

const TAU = Math.PI * 2;

const QUALITY = {
  performance: { count: 0.25, life: 0.7, lights: 0, smoke: false },
  low: { count: 0.5, life: 0.85, lights: 0, smoke: false },
  medium: { count: 1.0, life: 1.0, lights: 2, smoke: true },
  high: { count: 1.6, life: 1.35, lights: 3, smoke: true },
};

// ---------------------------------------------------------------------------------------------
// Pool sizes
// ---------------------------------------------------------------------------------------------
const MAX_LOOT = 128;
const MAX_CHESTS = 64;
const CHEST_SPRITES = 4; // looping sparkle sprites per chest
const MAX_ANCHORS = 16; // concurrent auras (+ index 0 = world origin)

const SPRITE_PERSIST = MAX_CHESTS * CHEST_SPRITES; // 256
const SPRITE_CAP = SPRITE_PERSIST + 4096;
const TRACER_CAP = 128;
const DEBRIS_CAP = 768;
const DECAL_PERSIST = MAX_LOOT + MAX_CHESTS; // 192
const DECAL_CAP = DECAL_PERSIST + 96;
const BEAM_PERSIST = MAX_LOOT;
const BEAM_CAP = BEAM_PERSIST + 48;
const BOX_CAP = 24;

const REBASE_AFTER = 900; // seconds; keeps float32 shader time precise in long sessions

// Sprite shapes (must match the fragment shader)
const GLOW = 0, DOT = 1, STAR = 2, RINGS = 3, SMOKE = 4, PLUS = 5, HEX = 6, STREAK = 7, FLASH = 8, DIAMOND = 9;

// Decal styles
const D_LOOT = 0, D_CHEST = 1, D_RING = 2, D_AURA = 3, D_FLASH = 4;
// Beam styles
const B_LOOT = 0, B_ELIM = 1, B_COLUMN = 2;

// ---------------------------------------------------------------------------------------------
// Palette (linear RGB triples, computed once)
// ---------------------------------------------------------------------------------------------
const _tc = new THREE.Color();
function lin(hex) {
  _tc.setHex(hex);
  return [_tc.r, _tc.g, _tc.b];
}

const P = {
  white: lin(0xffffff),
  hot: lin(0xfff6d8),
  flash: lin(0xffd98a),
  flashDeep: lin(0xff9a3c),
  spark: lin(0xffc85a),
  sparkDeep: lin(0xff8a2a),
  smoke: lin(0xcfd3d6),
  dust: lin(0xd9cdb0),
  star: lin(0xfff4b0),
  starDeep: lin(0xffcf3f),
  shield: lin(0x4db8ff),
  shieldLight: lin(0xb4e6ff),
  heal: lin(0x4fe06a),
  healLight: lin(0xc4ffc8),
  gold: lin(0xffc23d),
  goldLight: lin(0xffe9a0),
  crit: lin(0x9ff0ff),
  soot: lin(0x6b6560),
  alert: lin(0xff4a3a),
};

const MATERIALS = {
  wood: { chips: [lin(0xc99b60), lin(0xa97b46), lin(0x8a5f33)], dust: lin(0xdcc7a0), tint: lin(0xffdf9e), rest: 0.34 },
  brick: { chips: [lin(0xc9583c), lin(0xa8472f), lin(0xd9c2a8)], dust: lin(0xdba088), tint: lin(0xffb08a), rest: 0.26 },
  metal: { chips: [lin(0xaab6c2), lin(0x7d8a98), lin(0xdfe6ec)], dust: lin(0xcdd3da), tint: lin(0xbfe6ff), rest: 0.45 },
  dirt: { chips: [lin(0x8a6a45), lin(0x6f5436), lin(0xa98a5e)], dust: lin(0xbba27a), tint: lin(0xe0c9a0), rest: 0.15 },
  glass: { chips: [lin(0xbfe6ff), lin(0x9ad4ff), lin(0xe8f6ff)], dust: lin(0xe8f2f8), tint: lin(0xd8f1ff), rest: 0.2 },
};

// building wall panels break into chunks of the build-material colour
const WALL_CHIPS = {};
for (const k of Object.keys(MATERIAL_COLOR)) WALL_CHIPS[k] = lin(MATERIAL_COLOR[k]);

const RARITY_NAMES = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
const RARITY_COLORS = [lin(0x9aa3ad), lin(0x4ec04a), lin(0x3b9cff), lin(0xb05cff), lin(0xffb52e)];
const RARITY_HEIGHT = [2.4, 3.2, 4.2, 5.4, 6.8];

function rarityIndex(r) {
  if (typeof r === 'number') return r < 0 ? 0 : r > 4 ? 4 : r | 0;
  const i = RARITY_NAMES[r];
  return i === undefined ? 0 : i;
}

// ---------------------------------------------------------------------------------------------
// Scratch state (module-level so the hot paths allocate nothing)
// ---------------------------------------------------------------------------------------------
let _r = 1, _g = 1, _b = 1; // current spawn colour (linear)
let _dx = 0, _dy = 1, _dz = 0; // last random direction
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector4();

const rnd = Math.random;

function col(a) {
  _r = a[0]; _g = a[1]; _b = a[2];
}
/** Palette colour with a random brightness wobble of +-j. */
function colJ(a, j) {
  const k = 1 + (rnd() * 2 - 1) * j;
  _r = a[0] * k; _g = a[1] * k; _b = a[2] * k;
}
function colMix(a, b, t) {
  _r = a[0] + (b[0] - a[0]) * t; _g = a[1] + (b[1] - a[1]) * t; _b = a[2] + (b[2] - a[2]) * t;
}
/** Accepts a hex number, THREE.Color or CSS string; falls back to the palette entry `def`. */
function colAny(c, def) {
  if (c === undefined || c === null) { col(def); return; }
  if (typeof c === 'number') _tc.setHex(c);
  else if (c.isColor) _tc.copy(c);
  else _tc.set(c);
  _r = _tc.r; _g = _tc.g; _b = _tc.b;
}
function randDir() {
  const y = rnd() * 2 - 1;
  const a = rnd() * TAU;
  const s = Math.sqrt(1 - y * y);
  _dx = s * Math.cos(a); _dy = y; _dz = s * Math.sin(a);
}
/** Random unit direction in the hemisphere around n, pulled towards n by `bias`. */
function coneDir(nx, ny, nz, bias) {
  randDir();
  const d = _dx * nx + _dy * ny + _dz * nz;
  if (d < 0) { _dx -= 2 * d * nx; _dy -= 2 * d * ny; _dz -= 2 * d * nz; }
  _dx += nx * bias; _dy += ny * bias; _dz += nz * bias;
  const l = 1 / Math.sqrt(_dx * _dx + _dy * _dy + _dz * _dz);
  _dx *= l; _dy *= l; _dz *= l;
}

// ---------------------------------------------------------------------------------------------
// Batch: one interleaved instance buffer + one mesh. Slots [0, persist) are handed out by the
// owner; slots [persist, capacity) are a ring buffer that recycles the oldest instance.
// Every layout keeps the spawn time at float offset 3.
// ---------------------------------------------------------------------------------------------
class Batch {
  constructor(capacity, stride, persist) {
    this.capacity = capacity;
    this.stride = stride;
    this.persist = persist;
    this.head = persist;
    this.data = new Float32Array(capacity * stride);
    this.dieAt = new Float32Array(capacity); // absolute death time; Infinity = persistent; 0 = dead
    this.gen = new Uint32Array(capacity); // bumped on every allocation (stale-slot detection)
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.range = { start: 0, count: 0 }; // the one reusable update range
    this.aliveUntil = 0;
    this.persistLive = 0;
    this.mesh = null;
  }

  attr(size, offset) {
    return new THREE.InterleavedBufferAttribute(this.buffer, size, offset);
  }

  /** Next ring slot (recycles the oldest). Returns the float offset of the instance. */
  alloc(dieAt) {
    const i = this.head;
    this.head = i + 1 >= this.capacity ? this.persist : i + 1;
    this.dieAt[i] = dieAt;
    this.gen[i]++;
    if (dieAt > this.aliveUntil) this.aliveUntil = dieAt;
    this.mesh.visible = true;
    this.touch(i);
    return i * this.stride;
  }

  /** Mark instance i dirty. Grows a single update range in place — no allocation. */
  touch(i) {
    const b = this.buffer, r = this.range, s = i * this.stride;
    if (b.updateRanges.length === 0) {
      r.start = s; r.count = this.stride;
      b.updateRanges.push(r);
    } else {
      const end = Math.max(r.start + r.count, s + this.stride);
      if (s < r.start) r.start = s;
      r.count = end - r.start;
    }
    b.version++;
  }

  /** Kill instance i (life is always the 8th float of a layout). */
  kill(i) {
    this.data[i * this.stride + 7] = 0;
    this.dieAt[i] = 0;
    this.touch(i);
  }

  reset() {
    this.data.fill(0);
    this.dieAt.fill(0);
    this.head = this.persist;
    this.aliveUntil = 0;
    this.persistLive = 0;
    this.buffer.updateRanges.length = 0; // full re-upload
    this.buffer.version++;
    if (this.mesh) this.mesh.visible = false;
  }

  rebase(t) {
    const d = this.data, st = this.stride, n = this.capacity;
    for (let i = 0; i < n; i++) {
      d[i * st + 3] -= t;
      if (this.dieAt[i] > 0) this.dieAt[i] -= t; // Infinity stays Infinity
    }
    this.aliveUntil -= t;
    this.buffer.updateRanges.length = 0;
    this.buffer.version++;
  }

  live(now) {
    let n = 0;
    const d = this.dieAt;
    for (let i = 0, l = this.capacity; i < l; i++) if (d[i] > now) n++;
    return n;
  }
}

/** Free-list for persistent slots, with oldest-first recycling. */
class SlotSet {
  constructor(cap) {
    this.cap = cap;
    this.free = new Int16Array(cap);
    this.n = cap;
    for (let i = 0; i < cap; i++) this.free[i] = cap - 1 - i;
    this.handles = new Array(cap).fill(null);
    this.seq = new Uint32Array(cap);
    this.counter = 0;
  }
  take() {
    return this.n > 0 ? this.free[--this.n] : -1;
  }
  give(i) {
    this.handles[i] = null;
    this.free[this.n++] = i;
  }
  oldest() {
    let best = -1, bs = 0xffffffff;
    for (let i = 0; i < this.cap; i++) {
      if (this.handles[i] !== null && this.seq[i] < bs) { bs = this.seq[i]; best = i; }
    }
    return best;
  }
  reset() {
    for (let i = 0; i < this.cap; i++) {
      const h = this.handles[i];
      if (h !== null) h._alive = false;
      this.handles[i] = null;
      this.free[i] = this.cap - 1 - i;
    }
    this.n = this.cap;
  }
}

class LootBeamHandle {
  constructor(fx, slot) {
    this._fx = fx; this._slot = slot; this._alive = true;
  }
  setPosition(v) {
    if (this._alive) this._fx._lootMove(this._slot, v.x, v.y, v.z);
    return this;
  }
  setVisible(b) {
    if (this._alive) this._fx._lootShow(this._slot, b ? 1 : 0);
    return this;
  }
  remove() {
    if (!this._alive) return;
    this._alive = false;
    this._fx._lootFree(this._slot);
  }
}

class ChestGlowHandle {
  constructor(fx, slot) {
    this._fx = fx; this._slot = slot; this._alive = true;
  }
  remove() {
    if (!this._alive) return;
    this._alive = false;
    this._fx._chestFree(this._slot);
  }
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
const GLSL_SHARED_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uViewport;
uniform vec4 uFog; // x: 0 none / 1 linear / 2 exp2, y: near | density, z: far
float fxFog(float d) {
  if (uFog.x < 0.5) return 1.0;
  if (uFog.x < 1.5) return 1.0 - smoothstep(uFog.y, uFog.z, d);
  float f = uFog.y * d;
  return exp(-f * f);
}
// world-space size of one pixel at unit view depth
float fxPx() { return 2.0 / (projectionMatrix[1][1] * uViewport.y); }
#define FX_CULL gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return;
`;

// Colour is encoded for the output *before* premultiplying so soft edges stay clean, then written
// premultiplied with a per-effect "additive" amount: add = 1 is pure additive light, add = 0 is
// ordinary alpha blending. In-between values give glows enough body to read against a bright sky.
const GLSL_SHARED_FRAG = /* glsl */ `
vec4 fxOut(vec3 c, float a, float add) {
  a = clamp(a, 0.0, 1.0);
  vec3 e = linearToOutputTexel(vec4(c, 1.0)).rgb;
  return vec4(e * a, a * (1.0 - add));
}
`;

const SPRITE_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_SHARED_VERT}
attribute vec4 aPosBirth;
attribute vec4 aVelLife;
attribute vec4 aColor;  // rgb, additive
attribute vec4 aSize;   // size0, size1, gravity, drag
attribute vec4 aShape;  // shape, anchor, stretch (or loop jitter radius), rotation
attribute vec4 aFx;     // alpha, loop, fadeIn, spin
uniform vec3 uAnchors[${MAX_ANCHORS + 1}];
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vParams; // shape, alpha, seed
float fxHash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float life = aVelLife.w;
  float age = uTime - aPosBirth.w;
  vec3 p0 = aPosBirth.xyz;
  bool loop = aFx.y > 0.5;
  if (life <= 0.0 || age < 0.0) { FX_CULL }
  if (loop) {
    float n = floor(age / life);
    age -= n * life;
    float h = n * 7.13 + aShape.w * 3.7;
    p0.xz += (vec2(fxHash(h + 1.0), fxHash(h + 2.0)) - 0.5) * 2.0 * aShape.z;
    p0.y += (fxHash(h + 3.0) - 0.5) * aShape.z;
  }
  float t = age / life;
  if (t >= 1.0) { FX_CULL }

  float k = aSize.w;
  float e = exp(-k * age);
  vec3 gk = vec3(0.0, -aSize.z / k, 0.0);
  vec3 pos = p0 + (aVelLife.xyz - gk) * ((1.0 - e) / k) + gk * age + uAnchors[int(aShape.y + 0.5)];
  vec3 vel = aVelLife.xyz * e + gk * (1.0 - e);

  vec4 mv = viewMatrix * vec4(pos, 1.0);
  float size = mix(aSize.x, aSize.y, 1.0 - (1.0 - t) * (1.0 - t));
  float alpha = aFx.x * fxFog(-mv.z) * min(t / max(aFx.z, 1e-3), 1.0);
  alpha *= aShape.x > 3.5 && aShape.x < 4.5 ? 1.0 - t : 1.0 - t * t * t;

  // keep distant particles at least ~1.3 px wide, trading a little brightness for it
  float minSize = -mv.z * fxPx() * 1.3;
  if (size < minSize) { alpha *= sqrt(size / minSize); size = minSize; }

  vec2 corner = position.xy * 2.0;
  vec2 offs;
  if (aShape.z > 0.0 && !loop) {
    vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0);
    float len = size * (1.0 + aShape.z * sp);
    offs = dir * corner.y * len * 0.5 + vec2(-dir.y, dir.x) * corner.x * size * 0.5;
  } else {
    float a = aShape.w + aFx.w * age;
    float c = cos(a), s = sin(a);
    offs = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size * 0.5;
  }
  mv.xy += offs;
  gl_Position = projectionMatrix * mv;
  vUv = corner;
  vColor = aColor;
  vParams = vec3(aShape.x, alpha, aShape.w);
  #include <logdepthbuf_vertex>
}
`;

const SPRITE_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SHARED_FRAG}
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vParams;
void main() {
  #include <logdepthbuf_fragment>
  int shape = int(vParams.x + 0.5);
  vec2 q = abs(vUv);
  float r = length(vUv);
  float a = 0.0;
  float white = 0.0;
  vec3 c = vColor.rgb;
  if (shape == 0) {            // soft glow
    a = max(1.0 - r, 0.0); a *= a;
    white = a * a * 0.6;
  } else if (shape == 1) {     // dot
    a = smoothstep(1.0, 0.55, r);
    white = smoothstep(0.7, 0.0, r) * 0.8;
  } else if (shape == 2) {     // four-point star
    float s = sqrt(q.x) + sqrt(q.y);
    a = smoothstep(1.0, 0.82, s);
    white = smoothstep(0.85, 0.3, s);
  } else if (shape == 3) {     // thin ring
    a = smoothstep(0.16, 0.04, abs(r - 0.82));
    white = a * 0.35;
  } else if (shape == 4) {     // cartoon puff: flat, lobed, soft-edged
    float rr = r * (1.0 + 0.09 * sin(atan(vUv.y, vUv.x) * 5.0 + vParams.z * 9.0));
    a = smoothstep(1.0, 0.72, rr);
    c *= mix(0.84, 1.06, smoothstep(-0.7, 0.7, vUv.y));
  } else if (shape == 5) {     // plus
    float d = min(max(q.x - 0.24, q.y - 0.86), max(q.y - 0.24, q.x - 0.86));
    a = smoothstep(0.07, -0.02, d);
    white = smoothstep(0.0, -0.2, d) * 0.5;
  } else if (shape == 6) {     // hexagon outline with a faint fill
    float h = max(q.x * 0.8660254 + q.y * 0.5, q.y);
    a = smoothstep(0.13, 0.03, abs(h - 0.8)) + 0.16 * step(h, 0.8);
    white = smoothstep(0.08, 0.0, abs(h - 0.8)) * 0.4;
  } else if (shape == 7) {     // streak (stretched along velocity, head at +y)
    a = smoothstep(1.0, 0.25, q.x) * smoothstep(-1.0, 0.5, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
    white = smoothstep(0.6, 0.0, q.x) * smoothstep(-0.2, 0.8, vUv.y) * 0.8;
  } else if (shape == 8) {     // spiky flash
    float ang = atan(vUv.y, vUv.x);
    float spikes = pow(abs(cos(ang * 2.5 + vParams.z)), 5.0);
    float rr = r / (0.34 + 0.66 * spikes);
    a = smoothstep(1.0, 0.25, rr);
    white = smoothstep(0.75, 0.1, rr);
  } else {                     // diamond
    float d = q.x * 1.5 + q.y;
    a = smoothstep(1.0, 0.82, d);
    white = smoothstep(0.7, 0.1, d) * 0.6;
  }
  c = mix(c, vec3(1.0), white * vColor.a);
  gl_FragColor = fxOut(c, a * vParams.y, vColor.a);
}
`;

const TRACER_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_SHARED_VERT}
attribute vec4 aFromBirth;
attribute vec4 aToSpeed;
attribute vec4 aColorWidth;
attribute vec4 aLen; // streak length, life, -, -
varying vec3 vUv;    // x: -1..1 across, y: 0 tail .. 1 head, z: core fraction
varying vec4 vColor;
void main() {
  vec3 d = aToSpeed.xyz - aFromBirth.xyz;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-4);
  float age = uTime - aFromBirth.w;
  float head = age * aToSpeed.w;
  float tail = head - aLen.x;
  if (aLen.y <= 0.0 || age < 0.0 || tail >= dist) { FX_CULL }
  head = min(head, dist);
  tail = max(tail, 0.0);
  float u = position.y + 0.5;
  vec4 mv = viewMatrix * vec4(aFromBirth.xyz + dir * mix(tail, head, u), 1.0);
  vec3 dv = (viewMatrix * vec4(dir, 0.0)).xyz;
  vec3 side = cross(dv, mv.xyz);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float halfW = aColorWidth.w * 2.2;                     // glow half-width
  float hw = max(halfW, -mv.z * fxPx() * 1.7);           // never thinner than ~3.4 px in total
  mv.xyz += side * (position.x * 2.0 * hw);
  gl_Position = projectionMatrix * mv;
  // the streak fades as its tail runs into the target
  float fade = clamp((head - tail) / max(min(aLen.x, dist) * 0.6, 1e-3), 0.0, 1.0);
  vUv = vec3(position.x * 2.0, u, clamp(aColorWidth.w * 0.5 / hw, 0.24, 0.6));
  vColor = vec4(aColorWidth.rgb, fxFog(-mv.z) * fade);
  #include <logdepthbuf_vertex>
}
`;

const TRACER_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SHARED_FRAG}
varying vec3 vUv;
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  float x = abs(vUv.x);
  float u = vUv.y;
  float cap = smoothstep(1.0, 0.93, u);
  float glow = (1.0 - x) * (1.0 - x) * smoothstep(0.0, 0.7, u) * cap;
  float core = smoothstep(vUv.z, vUv.z * 0.45, x) * smoothstep(0.05, 0.45, u) * cap;
  vec3 deep = vColor.rgb * vColor.rgb;                 // squaring saturates the tint for the glow
  vec3 c = mix(deep, mix(vColor.rgb, vec3(1.0), 0.65), core);
  float a = max(glow * 0.8, core) * vColor.a;
  gl_FragColor = fxOut(c, a, 0.5);
}
`;

const DECAL_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_SHARED_VERT}
attribute vec4 aPosBirth;
attribute vec4 aColorLife; // rgb, life (>0 transient, <0 persistent, 0 dead)
attribute vec4 aMisc;      // radius0, radius1, style, tier
attribute vec4 aMisc2;     // alpha, seed, -, -
varying vec2 vUv;
varying vec4 vColor;       // rgb, alpha
varying vec4 vParams;      // style, tier, t, seed
void main() {
  float life = aColorLife.w;
  float age = uTime - aPosBirth.w;
  float t = life > 0.0 ? age / life : 0.0;
  if (life == 0.0 || age < 0.0 || t >= 1.0 || aMisc2.x <= 0.0) { FX_CULL }
  float e = 1.0 - (1.0 - t) * (1.0 - t) * (1.0 - t);
  float R = mix(aMisc.x, aMisc.y, e);
  vec3 pos = aPosBirth.xyz + vec3(position.x, 0.0, position.y) * (2.0 * R);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float alpha = aMisc2.x * fxFog(-mv.z);
  if (life < 0.0) alpha *= smoothstep(0.0, 0.35, age) * (1.0 - smoothstep(90.0, 150.0, -mv.z));
  vUv = position.xy * 2.0;
  vColor = vec4(aColorLife.rgb, alpha);
  vParams = vec4(aMisc.z, aMisc.w, t, aMisc2.y);
  #include <logdepthbuf_vertex>
}
`;

const DECAL_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SHARED_FRAG}
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
float band(float x, float c, float w, float aa) { return smoothstep(w + aa, w, abs(x - c)); }
void main() {
  #include <logdepthbuf_fragment>
  int style = int(vParams.x + 0.5);
  float tier = vParams.y, t = vParams.z, seed = vParams.w;
  float r = length(vUv);
  float aa = max(fwidth(r), 0.012);
  float ang = atan(vUv.y, vUv.x);
  float a = 0.0, white = 0.0, add = 0.55;
  if (style == 0) {
    // loot ring: (tier + 2) arc segments slowly turning, a breathing ripple, inner ticks for epic+
    float n = tier + 2.0;
    float seg = fract((ang + uTime * 0.55 + seed) / 6.2831853 * n);
    float mask = smoothstep(0.09, 0.15, seg) * smoothstep(0.91, 0.85, seg);
    float ring = band(r, 0.8, 0.055, aa) * mask;
    float rp = fract(uTime * 0.45 + seed);
    float ripple = band(r, 0.1 + rp * 0.62, 0.02, aa) * (1.0 - rp) * 0.55;
    float fill = (1.0 - smoothstep(0.0, 0.74, r)) * 0.22;
    float ticks = 0.0;
    if (tier > 2.5) {
      float tk = fract((ang - uTime * 0.9) / 6.2831853 * 14.0);
      ticks = band(r, 0.6, 0.03, aa) * smoothstep(0.5, 0.42, abs(tk - 0.5) * 2.0) * 0.7;
    }
    a = ring + ripple + fill + ticks;
    white = ring * 0.35;
  } else if (style == 1) {
    // chest halo: soft warm disc with slow rays
    float rays = 0.5 + 0.5 * sin(ang * 9.0 + uTime * 0.7 + seed);
    float pulse = 0.8 + 0.2 * sin(uTime * 2.1 + seed * 5.0);
    a = (1.0 - smoothstep(0.1, 1.0, r)) * (0.34 + 0.2 * rays) * pulse + band(r, 0.62, 0.02, aa) * 0.3;
    add = 0.75;
  } else if (style == 2) {
    // expanding ring
    float w = mix(0.11, 0.03, t);
    float k = (1.0 - t);
    a = band(r, 0.88 - w, w, aa) * pow(k, 1.3) + (1.0 - smoothstep(0.0, 0.85, r)) * 0.14 * k * k * k;
    white = band(r, 0.88 - w, w * 0.4, aa) * k * 0.5;
  } else if (style == 3) {
    // aura ring under a character
    float k = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.8, t);
    float dash = 0.6 + 0.4 * sin(ang * 6.0 - uTime * 3.0);
    a = (band(r, 0.84, 0.05, aa) * dash + (1.0 - smoothstep(0.2, 0.9, r)) * 0.2) * k;
  } else {
    // soft ground flash
    float k = 1.0 - t;
    a = (1.0 - smoothstep(0.0, 1.0, r)) * k * k;
    white = a * 0.5;
    add = 0.8;
  }
  vec3 c = mix(vColor.rgb, vec3(1.0), clamp(white, 0.0, 1.0));
  gl_FragColor = fxOut(c, a * vColor.a, add);
}
`;

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_SHARED_VERT}
attribute vec4 aPosBirth;
attribute vec4 aColorLife; // rgb, life (>0 transient, <0 persistent, 0 dead)
attribute vec4 aDims;      // width, height, style, tier
attribute vec4 aMisc2;     // alpha, seed, -, -
varying vec4 vUv;          // x: -1..1, y: height (m), z: half width (m), w: height total (m)
varying vec4 vColor;
varying vec4 vParams;      // style, tier, t, seed
varying float vFar;
void main() {
  float life = aColorLife.w;
  float age = uTime - aPosBirth.w;
  float t = life > 0.0 ? age / life : 0.0;
  if (life == 0.0 || age < 0.0 || t >= 1.0 || aMisc2.x <= 0.0) { FX_CULL }
  vec3 base = aPosBirth.xyz;
  vec3 toCam = cameraPosition - base;
  float dist = length(toCam);
  vec2 rxz = normalize(vec2(toCam.z, -toCam.x) + vec2(1e-5, 0.0));
  float far = life < 0.0 ? smoothstep(40.0, 100.0, dist) : 0.0;
  float H = aDims.y * (1.0 + 0.45 * far);
  float halfW = max(aDims.x * 0.5, dist * fxPx() * mix(1.5, 2.6, far));
  float v = position.y + 0.5;
  vec3 pos = base + vec3(rxz.x, 0.0, rxz.y) * (position.x * 2.0 * halfW) + vec3(0.0, v * H, 0.0);
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float alpha = aMisc2.x * mix(1.0, fxFog(dist), 0.7);
  if (life < 0.0) alpha *= smoothstep(0.0, 0.4, age) * (1.0 - smoothstep(170.0, 240.0, dist));
  vUv = vec4(position.x * 2.0, v * H, halfW, H);
  vColor = vec4(aColorLife.rgb, alpha);
  vParams = vec4(aDims.z, aDims.w, t, aMisc2.y);
  vFar = far;
  #include <logdepthbuf_vertex>
}
`;

const BEAM_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SHARED_FRAG}
uniform float uTime;
varying vec4 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying float vFar;
float gs(float x) { return exp(-x * x); }
void main() {
  #include <logdepthbuf_fragment>
  int style = int(vParams.x + 0.5);
  float tier = vParams.y, t = vParams.z, seed = vParams.w;
  float xw = vUv.x * vUv.z;   // metres from the axis
  float y = vUv.y, H = vUv.w;
  float yn = y / H;
  float px = max(fwidth(xw), 1e-4);
  float a = 0.0, white = 0.0, add = 0.6;
  if (style == 0) {
    // loot marker: a twin helix of light winding up a tapering stem, with rising beads
    float top = pow(1.0 - yn, 1.25);
    float R = mix(0.27, 0.035, sqrt(yn));
    float ph = y * 3.4 - uTime * 2.2 + seed;
    float s = sin(ph), c = cos(ph);
    float w = 0.03 + px * 0.9;
    float strandA = gs((xw - R * s) / w) * (0.55 + 0.45 * c);
    float strandB = tier > 0.5 ? gs((xw + R * s) / w) * (0.55 - 0.45 * c) : 0.0;
    float stem = gs(xw / (0.022 + px * 0.7)) * 0.42;
    float haze = gs(xw / 0.24) * 0.2 * (1.0 - yn) * (1.0 - yn);
    float bead = fract(y * 0.55 - uTime * 0.7 + seed * 0.37);
    float beads = gs(xw / (0.05 + px)) * smoothstep(0.1, 0.0, abs(bead - 0.5)) * (0.5 + 0.12 * tier);
    float pulse = tier > 2.5 ? 0.85 + 0.15 * sin(uTime * 3.0 + seed) : 1.0;
    float near = ((strandA + strandB) * 0.9 + stem + beads) * top * pulse * smoothstep(0.0, 0.05, yn) + haze;
    float farA = gs(vUv.x / 0.55) * (0.35 + 0.65 * top);
    a = mix(near, farA, vFar);
    white = mix((strandA + strandB) * 0.3 + beads * 0.6, gs(vUv.x / 0.25) * 0.4, vFar);
    add = 0.5;
  } else if (style == 1) {
    // elimination: a column of light that lifts off the ground while two rails close inwards
    float top = H * (1.0 - pow(1.0 - min(t * 2.4, 1.0), 3.0));
    float k = max(t - 0.28, 0.0) / 0.72;
    float bottom = H * k * k;
    float win = smoothstep(bottom - 0.05, bottom + 0.9, y) * smoothstep(top, top - 1.6, y);
    float fadeT = 1.0 - smoothstep(0.55, 1.0, t);
    float rail = mix(0.42, 0.06, clamp((y - bottom) / (H * 0.6), 0.0, 1.0));
    float rails = gs((abs(xw) - rail) / (0.035 + px)) * 0.85;
    float coreA = gs(xw / (0.07 + px)) ;
    float haze = gs(xw / 0.4) * 0.3;
    float dash = 0.6 + 0.4 * step(0.5, fract(y * 0.9 - uTime * 5.0));
    a = (coreA + rails * dash + haze) * win * fadeT;
    white = coreA * 0.8;
    add = 0.7;
  } else {
    // column flash (pickup / chest): a short bar of light that shoots upward and thins out
    float top = H * (1.0 - pow(1.0 - min(t * 1.8, 1.0), 3.0));
    float bottom = H * t * t;
    float win = smoothstep(bottom, bottom + 0.4, y) * smoothstep(top, top - 0.8, y);
    float wd = mix(0.16, 0.03, t) + px;
    a = (gs(xw / wd) + gs(xw / 0.35) * 0.25) * win * (1.0 - t);
    white = gs(xw / (wd * 0.5)) * 0.7;
    add = 0.7;
  }
  vec3 c = mix(vColor.rgb, vec3(1.0), clamp(white, 0.0, 1.0));
  gl_FragColor = fxOut(c, a * vColor.a, add);
}
`;

const BOX_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_SHARED_VERT}
attribute vec4 aPosBirth;
attribute vec4 aSizeLife;
attribute vec4 aColor;
varying vec4 vUv;     // uv, face size (m)
varying vec4 vColor;  // rgb, alpha
varying vec2 vParams; // t, height 0..1
void main() {
  float life = aSizeLife.w;
  float age = uTime - aPosBirth.w;
  float t = age / max(life, 1e-4);
  if (life <= 0.0 || age < 0.0 || t >= 1.0) { FX_CULL }
  float k = min(t / 0.4, 1.0) - 1.0;
  float s = 1.0 + 0.16 * (2.4 * k * k * k + 1.4 * k * k);   // overshooting scale-in, 0.84 -> 1
  vec3 size = aSizeLife.xyz * s + 0.07;
  vec3 pos = aPosBirth.xyz + position * size;
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 an = abs(normal);
  vec2 face = an.x > 0.5 ? size.zy : (an.y > 0.5 ? size.xz : size.xy);
  vUv = vec4(uv, face);
  vColor = vec4(aColor.rgb, fxFog(-mv.z));
  vParams = vec2(t, position.y + 0.5);
  #include <logdepthbuf_vertex>
}
`;

const BOX_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_SHARED_FRAG}
varying vec4 vUv;
varying vec4 vColor;
varying vec2 vParams;
void main() {
  #include <logdepthbuf_fragment>
  float t = vParams.x;
  vec2 d2 = min(vUv.xy, 1.0 - vUv.xy) * vUv.zw;
  float d = min(d2.x, d2.y);
  float aa = max(fwidth(d), 1e-4);
  float edge = smoothstep(0.07 + aa, 0.03, d);
  float sweep = smoothstep(0.16, 0.0, abs(vParams.y - t * 1.5));
  float k = 1.0 - t;
  float a = (edge * 0.95 + 0.07 + sweep * 0.3) * k * sqrt(k);
  vec3 c = mix(vColor.rgb, vec3(1.0), edge * 0.45);
  gl_FragColor = fxOut(c, a * vColor.a, 0.6);
}
`;

// Debris uses a stock Lambert material (so chunks take the scene's lights, shadows, fog and tone
// mapping exactly like the world they broke off from) with the ballistic motion patched in.
const DEBRIS_PARS = /* glsl */ `
attribute vec4 aPosBirth;
attribute vec4 aVelLife;
attribute vec4 aScaleHit;  // box scale xyz, time of first ground contact
attribute vec4 aColorEmis; // rgb, emissive amount
attribute vec4 aRot;       // unit axis, angular speed
attribute vec4 aPhys;      // gravity, restitution, rest height, -
uniform float uTime;
varying vec4 vFxColor;
float fxAng;
float fxScale;
vec3 fxPos;
vec3 fxRotate(vec3 v) {
  float s = sin(fxAng), c = cos(fxAng);
  return v * c + cross(aRot.xyz, v) * s + aRot.xyz * (dot(aRot.xyz, v) * (1.0 - c));
}
void fxSimulate() {
  float age = uTime - aPosBirth.w;
  float life = aVelLife.w;
  float g = aPhys.x;
  float tHit = aScaleHit.w;
  vec3 p = aPosBirth.xyz;
  vec3 v = aVelLife.xyz;
  float spinT;
  if (age < tHit) {
    p += v * age;
    p.y -= 0.5 * g * age * age;
    spinT = age;
  } else {
    // one bounce, then the chunk settles where it lands
    vec3 ph = p + v * tHit;
    ph.y = aPhys.z;
    vec3 v2 = vec3(v.x * 0.45, -(v.y - g * tHit) * aPhys.y, v.z * 0.45);
    float tAir = 2.0 * v2.y / g;
    float tc = min(age - tHit, tAir);
    p = ph + v2 * tc;
    p.y -= 0.5 * g * tc * tc;
    spinT = tHit + tc * 0.5;
  }
  fxPos = p;
  fxAng = aRot.w * spinT;
  fxScale = (life <= 0.0 || age < 0.0 || age >= life) ? 0.0 : 1.0 - smoothstep(0.72, 1.0, age / life);
  vFxColor = aColorEmis;
}
`;

function patchDebrisShader(shader, uTime) {
  shader.uniforms.uTime = uTime;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + DEBRIS_PARS)
    .replace('#include <beginnormal_vertex>', 'fxSimulate();\nvec3 objectNormal = fxRotate(normal);')
    .replace('#include <begin_vertex>', 'vec3 transformed = fxRotate(position * aScaleHit.xyz * fxScale) + fxPos;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec4 vFxColor;')
    .replace('#include <color_fragment>', 'diffuseColor.rgb *= vFxColor.rgb;')
    .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += vFxColor.rgb * vFxColor.a;');
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------
export class Effects {
  constructor({ scene, camera, quality = 'medium' }) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;
    this.quality = 'medium';
    this._qCount = 1;
    this._qLife = 1;
    this._smoke = true;
    this._disposed = false;

    this.group = new THREE.Group();
    this.group.name = 'Effects';
    this.group.matrixAutoUpdate = false;

    const anchors = [];
    for (let i = 0; i <= MAX_ANCHORS; i++) anchors.push(new THREE.Vector3());
    this._anchors = anchors;
    this._u = {
      uTime: { value: 0 },
      uViewport: { value: new THREE.Vector2(1280, 720) },
      uFog: { value: new THREE.Vector4(0, 0, 0, 0) },
      uAnchors: { value: anchors },
    };
    const u = this._u;
    this._onBeforeRender = (renderer) => {
      renderer.getCurrentViewport(_v4);
      u.uViewport.value.set(_v4.z, _v4.w);
    };

    this._geometries = [];
    this._materials = [];
    this._batches = [];

    // --- shared unit quad / box -------------------------------------------------------------
    const quadPos = new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3);
    const quadIdx = [0, 1, 2, 0, 2, 3];
    const box = new THREE.BoxGeometry(1, 1, 1);

    const makeGeometry = (batch, names, withBox) => {
      const g = new THREE.InstancedBufferGeometry();
      if (withBox) {
        g.setIndex(box.index);
        g.setAttribute('position', box.attributes.position);
        g.setAttribute('normal', box.attributes.normal);
        g.setAttribute('uv', box.attributes.uv);
      } else {
        g.setIndex(quadIdx);
        g.setAttribute('position', quadPos);
      }
      for (let i = 0; i < names.length; i++) g.setAttribute(names[i], batch.attr(4, i * 4));
      g.instanceCount = batch.capacity;
      this._geometries.push(g);
      return g;
    };
    const makeMaterial = (vertexShader, fragmentShader, extra) => {
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        fog: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        ...extra,
      });
      this._materials.push(m);
      return m;
    };
    const makeMesh = (batch, geometry, material, renderOrder, name) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = renderOrder;
      mesh.visible = false;
      mesh.onBeforeRender = this._onBeforeRender;
      batch.mesh = mesh;
      this._batches.push(batch);
      this.group.add(mesh);
      return mesh;
    };

    // --- debris chunks (opaque, lit) --------------------------------------------------------
    this._debris = new Batch(DEBRIS_CAP, 24, 0);
    {
      const g = makeGeometry(this._debris, ['aPosBirth', 'aVelLife', 'aScaleHit', 'aColorEmis', 'aRot', 'aPhys'], true);
      // cel-shaded like the world it broke off from (patch hooks exist in MeshToonMaterial too)
      const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
      m.onBeforeCompile = (shader) => patchDebrisShader(shader, u.uTime);
      m.customProgramCacheKey = () => 'fx-debris-toon';
      this._materials.push(m);
      const mesh = makeMesh(this._debris, g, m, 0, 'fx-debris');
      mesh.receiveShadow = true;
    }

    // --- ground decals ----------------------------------------------------------------------
    this._decals = new Batch(DECAL_CAP, 16, DECAL_PERSIST);
    makeMesh(
      this._decals,
      makeGeometry(this._decals, ['aPosBirth', 'aColorLife', 'aMisc', 'aMisc2']),
      makeMaterial(DECAL_VERT, DECAL_FRAG, { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      20, 'fx-decals',
    );

    // --- vertical beams ---------------------------------------------------------------------
    this._beams = new Batch(BEAM_CAP, 16, BEAM_PERSIST);
    makeMesh(
      this._beams,
      makeGeometry(this._beams, ['aPosBirth', 'aColorLife', 'aDims', 'aMisc2']),
      makeMaterial(BEAM_VERT, BEAM_FRAG, { side: THREE.DoubleSide }),
      21, 'fx-beams',
    );

    // --- build-place boxes ------------------------------------------------------------------
    this._boxes = new Batch(BOX_CAP, 12, 0);
    makeMesh(
      this._boxes,
      makeGeometry(this._boxes, ['aPosBirth', 'aSizeLife', 'aColor'], true),
      makeMaterial(BOX_VERT, BOX_FRAG, { side: THREE.DoubleSide }),
      22, 'fx-boxes',
    );

    // --- sprites ----------------------------------------------------------------------------
    this._sprites = new Batch(SPRITE_CAP, 24, SPRITE_PERSIST);
    makeMesh(
      this._sprites,
      makeGeometry(this._sprites, ['aPosBirth', 'aVelLife', 'aColor', 'aSize', 'aShape', 'aFx']),
      makeMaterial(SPRITE_VERT, SPRITE_FRAG, { side: THREE.DoubleSide }),
      23, 'fx-sprites',
    );

    // --- tracers ----------------------------------------------------------------------------
    this._tracers = new Batch(TRACER_CAP, 16, 0);
    makeMesh(
      this._tracers,
      makeGeometry(this._tracers, ['aFromBirth', 'aToSpeed', 'aColorWidth', 'aLen']),
      makeMaterial(TRACER_VERT, TRACER_FRAG, { side: THREE.DoubleSide }),
      24, 'fx-tracers',
    );

    box.dispose(); // only its attributes are reused

    // --- persistent slots, auras, lights ----------------------------------------------------
    this._loot = new SlotSet(MAX_LOOT);
    this._chests = new SlotSet(MAX_CHESTS);

    this._auras = [];
    for (let i = 0; i < MAX_ANCHORS; i++) {
      this._auras.push({ active: false, target: null, isObject: false, shield: false, end: 0, free: 0, acc: 0, decal: -1, decalGen: 0, seq: 0 });
    }
    this._auraSeq = 0;
    this._auraLive = 0;

    this._lights = [];
    this._lightNext = 0;

    this._stats = { sprites: 0, tracers: 0, debris: 0, decals: 0, beams: 0, boxes: 0, total: 0, capacity: 0 };
    this._stats.capacity = SPRITE_CAP + TRACER_CAP + DEBRIS_CAP + DECAL_CAP + BEAM_CAP + BOX_CAP;

    scene.add(this.group);
    this.setQuality(quality);
  }

  // -------------------------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------------------------
  update(dt) {
    if (this._disposed) return;
    this.time += dt;
    if (this.time > REBASE_AFTER) this._rebase();
    const now = this.time;
    this._u.uTime.value = now;

    const fog = this.scene.fog;
    const uf = this._u.uFog.value;
    if (!fog) uf.x = 0;
    else if (fog.isFogExp2) { uf.x = 2; uf.y = fog.density; }
    else { uf.x = 1; uf.y = fog.near; uf.z = fog.far; }

    // muzzle lights
    const lights = this._lights;
    for (let i = 0; i < lights.length; i++) {
      const L = lights[i];
      if (L.peak <= 0) continue;
      const a = (now - L.t0) / L.dur;
      if (a >= 1) { L.peak = 0; L.light.intensity = 0; } else L.light.intensity = L.peak * (1 - a) * (1 - a);
    }

    if (this._auraLive > 0) this._updateAuras(dt, now);

    const batches = this._batches;
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      b.mesh.visible = b.persistLive > 0 || now < b.aliveUntil;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Low-level writers
  // -------------------------------------------------------------------------------------------
  _n(n) {
    const k = Math.round(n * this._qCount);
    return k < 1 ? 1 : k;
  }

  /** Billboard sprite in the current colour. Returns its float offset in the sprite buffer. */
  _sp(x, y, z, vx, vy, vz, life, s0, s1, shape, add, alpha, grav, drag, stretch) {
    const b = this._sprites;
    const o = b.alloc(this.time + life);
    const d = b.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = _r; d[o + 9] = _g; d[o + 10] = _b; d[o + 11] = add;
    d[o + 12] = s0; d[o + 13] = s1; d[o + 14] = grav; d[o + 15] = drag < 0.1 ? 0.1 : drag;
    d[o + 16] = shape; d[o + 17] = 0; d[o + 18] = stretch;
    d[o + 19] = shape === PLUS || shape === HEX ? 0 : shape === STAR || shape === DIAMOND ? (rnd() - 0.5) * 0.7 : rnd() * TAU;
    d[o + 20] = alpha; d[o + 21] = 0; d[o + 22] = 0.04;
    d[o + 23] = shape === SMOKE ? (rnd() - 0.5) * 1.2 : shape === STAR ? (rnd() - 0.5) * 3 : 0;
    return o;
  }

  /** Delay a just-spawned sprite by `delay` seconds. */
  _later(o, delay) {
    const b = this._sprites;
    b.data[o + 3] += delay;
    const i = o / b.stride;
    b.dieAt[i] += delay;
    if (b.dieAt[i] > b.aliveUntil) b.aliveUntil = b.dieAt[i];
  }

  /** Lit box chunk in the current colour. */
  _chunk(x, y, z, vx, vy, vz, life, sx, sy, sz, emis, grav, rest) {
    const b = this._debris;
    const o = b.alloc(this.time + life);
    const d = b.data;
    const restY = Math.min(sx, sy, sz) * 0.5 + 0.01;
    const y0 = y - restY > 0.01 ? y - restY : 0.01;
    d[o] = x; d[o + 1] = y0 + restY; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = sx; d[o + 9] = sy; d[o + 10] = sz;
    d[o + 11] = (vy + Math.sqrt(vy * vy + 2 * grav * y0)) / grav;
    d[o + 12] = _r; d[o + 13] = _g; d[o + 14] = _b; d[o + 15] = emis;
    randDir();
    d[o + 16] = _dx; d[o + 17] = _dy; d[o + 18] = _dz; d[o + 19] = 5 + rnd() * 11;
    d[o + 20] = grav; d[o + 21] = rest; d[o + 22] = restY; d[o + 23] = 0;
  }

  /** Ground decal in the current colour (ring-buffer slot). Returns the slot index. */
  _decal(x, y, z, life, r0, r1, style, tier, alpha) {
    const b = this._decals;
    const o = b.alloc(this.time + life);
    this._writeDecal(o, x, y, z, life, r0, r1, style, tier, alpha);
    return o / b.stride;
  }
  _writeDecal(o, x, y, z, life, r0, r1, style, tier, alpha) {
    const d = this._decals.data;
    d[o] = x; d[o + 1] = y + 0.04; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = _r; d[o + 5] = _g; d[o + 6] = _b; d[o + 7] = life;
    d[o + 8] = r0; d[o + 9] = r1; d[o + 10] = style; d[o + 11] = tier;
    d[o + 12] = alpha; d[o + 13] = rnd() * TAU; d[o + 14] = 0; d[o + 15] = 0;
  }

  /** Vertical camera-facing beam in the current colour (ring-buffer slot). */
  _beam(x, y, z, life, width, height, style, tier, alpha) {
    const b = this._beams;
    this._writeBeam(b.alloc(this.time + life), x, y, z, life, width, height, style, tier, alpha);
  }
  _writeBeam(o, x, y, z, life, width, height, style, tier, alpha) {
    const d = this._beams.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = _r; d[o + 5] = _g; d[o + 6] = _b; d[o + 7] = life;
    d[o + 8] = width; d[o + 9] = height; d[o + 10] = style; d[o + 11] = tier;
    d[o + 12] = alpha; d[o + 13] = rnd() * TAU; d[o + 14] = 0; d[o + 15] = 0;
  }

  /** A cartoon dust / smoke puff. */
  _puff(x, y, z, vx, vy, vz, s0, s1, life, alpha) {
    return this._sp(x, y, z, vx, vy, vz, life * this._qLife, s0, s1, SMOKE, 0, alpha, -0.5, 2.6, 0);
  }

  _light(x, y, z, peak) {
    const n = this._lights.length;
    if (n === 0) return;
    const L = this._lights[this._lightNext];
    this._lightNext = (this._lightNext + 1) % n;
    L.light.position.set(x, y, z);
    L.light.intensity = peak;
    L.peak = peak;
    L.t0 = this.time;
    L.dur = 0.075;
  }

  // -------------------------------------------------------------------------------------------
  // Guns
  // -------------------------------------------------------------------------------------------
  tracer(from, to, opts) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.05) return;
    const speed = opts && opts.speed > 0 ? opts.speed : 400;
    const width = opts && opts.width > 0 ? opts.width : 0.06;
    colAny(opts ? opts.color : undefined, P.star);
    if (!opts || opts.color === undefined || opts.color === null) _tc.setHex(0xfff2b0), (_r = _tc.r), (_g = _tc.g), (_b = _tc.b);
    // Honour `speed`, but keep the flight between 45 and 105 ms so short shots are still seen for a
    // couple of frames and long shots never hang in the air.
    let T = dist / speed;
    T = T < 0.045 ? 0.045 : T > 0.105 ? 0.105 : T;
    const v = dist / T;
    let len = v * 0.02;
    len = len < 1.6 ? 1.6 : len > 16 ? 16 : len;
    if (len > dist * 0.75) len = dist * 0.75;
    const life = T + len / v;
    const b = this._tracers;
    const o = b.alloc(this.time + life);
    const d = b.data;
    d[o] = from.x; d[o + 1] = from.y; d[o + 2] = from.z; d[o + 3] = this.time;
    d[o + 4] = to.x; d[o + 5] = to.y; d[o + 6] = to.z; d[o + 7] = v;
    d[o + 8] = _r; d[o + 9] = _g; d[o + 10] = _b; d[o + 11] = width;
    d[o + 12] = len; d[o + 13] = life; d[o + 14] = 0; d[o + 15] = 0;
  }

  muzzleFlash(position, direction, opts) {
    const s = opts && opts.scale > 0 ? opts.scale : 1;
    let nx = 0, ny = 0, nz = -1;
    if (direction) {
      const l = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
      if (l > 1e-5) { nx = direction.x / l; ny = direction.y / l; nz = direction.z / l; }
    }
    const x = position.x, y = position.y, z = position.z;
    // spiky star + soft bloom + a forward tongue
    col(P.flash);
    this._sp(x + nx * 0.1 * s, y + ny * 0.1 * s, z + nz * 0.1 * s, 0, 0, 0, 0.055, 0.5 * s, 0.72 * s, FLASH, 0.7, 1, 0, 0.1, 0);
    col(P.flashDeep);
    this._sp(x + nx * 0.12 * s, y + ny * 0.12 * s, z + nz * 0.12 * s, 0, 0, 0, 0.075, 0.75 * s, 1.15 * s, GLOW, 0.85, 0.5, 0, 0.1, 0);
    col(P.flash);
    this._sp(x + nx * 0.2 * s, y + ny * 0.2 * s, z + nz * 0.2 * s, nx * 7, ny * 7, nz * 7, 0.06, 0.2 * s, 0.14 * s, STREAK, 0.75, 1, 0, 0.1, 0.32);
    // a few sparks
    const n = this._n(3);
    for (let i = 0; i < n; i++) {
      coneDir(nx, ny, nz, 2.2);
      const sp = 7 + rnd() * 9;
      colMix(P.spark, P.sparkDeep, rnd());
      this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, 0.12 + rnd() * 0.12, 0.035 * s, 0.02 * s, STREAK, 0.8, 1, 9, 4, 0.5);
    }
    if (this._smoke) {
      for (let i = 0; i < 2; i++) {
        coneDir(nx, ny, nz, 1.5);
        const sp = 0.8 + rnd() * 1.2;
        colJ(P.smoke, 0.06);
        const o = this._puff(x + nx * 0.15, y + ny * 0.15, z + nz * 0.15, _dx * sp, _dy * sp + 0.4, _dz * sp, 0.1 * s, (0.3 + rnd() * 0.16) * s, 0.45 + rnd() * 0.25, 0.3);
        this._later(o, 0.03);
      }
    }
    this._light(x + nx * 0.3, y + ny * 0.3 + 0.05, z + nz * 0.3, 22 * s);
  }

  impact(position, normal, surface) {
    let nx = 0, ny = 1, nz = 0;
    if (normal) {
      const l = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
      if (l > 1e-5) { nx = normal.x / l; ny = normal.y / l; nz = normal.z / l; }
    }
    const x = position.x + nx * 0.06, y = position.y + ny * 0.06, z = position.z + nz * 0.06;
    if (surface === 'body') this._impactBody(x, y, z, nx, ny, nz);
    else if (surface === 'shield') this._impactShield(x, y, z, nx, ny, nz);
    else if (surface === 'metal') this._impactMetal(x, y, z, nx, ny, nz);
    else this._impactSoft(x, y, z, nx, ny, nz, MATERIALS[surface] || MATERIALS.dirt, surface);
  }

  _impactMetal(x, y, z, nx, ny, nz) {
    const n = this._n(7);
    for (let i = 0; i < n; i++) {
      coneDir(nx, ny, nz, 0.55);
      const sp = 4 + rnd() * 9;
      colMix(P.hot, P.sparkDeep, rnd() * 0.8);
      this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, (0.16 + rnd() * 0.2) * this._qLife, 0.045, 0.02, STREAK, 0.85, 1, 13, 2.6, 0.55);
    }
    col(P.flash);
    this._sp(x, y, z, 0, 0, 0, 0.07, 0.3, 0.7, GLOW, 0.9, 0.75, 0, 0.1, 0);
    col(P.hot);
    this._sp(x, y, z, 0, 0, 0, 0.085, 0.3, 0.46, STAR, 0.85, 1, 0, 0.1, 0);
  }

  /** wood / brick / dirt: opaque bits, a dust puff and a couple of real chips. */
  _impactSoft(x, y, z, nx, ny, nz, M, surface) {
    const dirt = surface !== 'wood' && surface !== 'brick';
    const wood = surface === 'wood';
    const n = this._n(5);
    for (let i = 0; i < n; i++) {
      coneDir(nx, ny, nz, dirt ? 1.1 : 0.5);
      const sp = 2 + rnd() * 3.8;
      colJ(M.chips[(rnd() * 3) | 0], 0.12);
      if (wood) this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, (0.3 + rnd() * 0.2) * this._qLife, 0.04, 0.03, STREAK, 0.05, 1, 9, 1.6, 0.45);
      else this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, (0.32 + rnd() * 0.22) * this._qLife, 0.05 + rnd() * 0.04, 0.03, DOT, 0, 1, 10.5, 1.4, 0);
    }
    col(P.hot);
    this._sp(x, y, z, 0, 0, 0, 0.06, 0.2, 0.42, GLOW, 0.8, 0.55, 0, 0.1, 0);
    if (this._smoke) {
      const k = dirt ? 2 : 1;
      for (let i = 0; i < k; i++) {
        coneDir(nx, ny, nz, 1.2);
        colJ(M.dust, 0.05);
        this._puff(x, y, z, _dx * 1.1, _dy * 1.1 + 0.2, _dz * 1.1, 0.14, 0.5 + rnd() * 0.2, 0.42 + rnd() * 0.15, 0.5);
      }
    }
    if (!dirt) {
      const c = this._n(2);
      for (let i = 0; i < c; i++) {
        coneDir(nx, ny, nz, 0.6);
        const sp = 1.8 + rnd() * 2.6;
        const s = 0.05 + rnd() * 0.05;
        colJ(M.chips[(rnd() * 3) | 0], 0.1);
        this._chunk(x, y, z, _dx * sp, _dy * sp + 1.2, _dz * sp, (0.9 + rnd() * 0.5) * this._qLife, wood ? s * 2 : s, s * 0.7, s, 0, 13, M.rest);
      }
    }
  }

  _impactBody(x, y, z, nx, ny, nz) {
    // family-friendly hit: a pop of stars and a quick ring
    col(P.star);
    this._sp(x, y, z, 0, 0, 0, 0.1, 0.34, 0.6, STAR, 0.8, 1, 0, 0.1, 0);
    this._sp(x, y, z, 0, 0, 0, 0.17, 0.16, 0.62, RINGS, 0.75, 0.85, 0, 0.1, 0);
    const n = this._n(4);
    for (let i = 0; i < n; i++) {
      coneDir(nx, ny, nz, 0.35);
      const sp = 1.6 + rnd() * 2.6;
      colMix(P.star, P.starDeep, rnd());
      this._sp(x, y, z, _dx * sp, _dy * sp + 0.6, _dz * sp, (0.26 + rnd() * 0.16) * this._qLife, 0.2 + rnd() * 0.08, 0.06, STAR, 0.7, 1, 2.5, 3.5, 0);
    }
    const m = this._n(4);
    for (let i = 0; i < m; i++) {
      coneDir(nx, ny, nz, 0.3);
      const sp = 3 + rnd() * 4;
      colMix(P.white, P.starDeep, rnd());
      this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, 0.18 + rnd() * 0.12, 0.05, 0.02, STREAK, 0.8, 1, 5, 4, 0.4);
    }
  }

  _impactShield(x, y, z, nx, ny, nz) {
    col(P.shield);
    this._sp(x, y, z, 0, 0, 0, 0.22, 0.24, 0.85, HEX, 0.7, 1, 0, 0.1, 0);
    this._sp(x, y, z, 0, 0, 0, 0.09, 0.3, 0.7, GLOW, 0.85, 0.7, 0, 0.1, 0);
    col(P.shieldLight);
    this._sp(x, y, z, 0, 0, 0, 0.14, 0.14, 0.42, HEX, 0.8, 1, 0, 0.1, 0);
    const n = this._n(5);
    for (let i = 0; i < n; i++) {
      coneDir(nx, ny, nz, 0.3);
      const sp = 2 + rnd() * 3.5;
      colMix(P.shield, P.shieldLight, rnd());
      this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, (0.24 + rnd() * 0.16) * this._qLife, 0.11 + rnd() * 0.05, 0.03, DIAMOND, 0.7, 1, 1.5, 3.5, 0);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Harvesting, destruction, building
  // -------------------------------------------------------------------------------------------
  harvestHit(position, material, isWeakPoint) {
    const M = MATERIALS[material] || MATERIALS.wood;
    const x = position.x, y = position.y, z = position.z;
    // no surface normal is given: throw the chips back towards the viewer and up
    const cp = this.camera.position;
    let nx = cp.x - x, nz = cp.z - z;
    const l = Math.sqrt(nx * nx + nz * nz);
    if (l > 1e-4) { nx /= l; nz /= l; } else { nx = 0; nz = 1; }
    const wood = material === 'wood' || !MATERIALS[material];
    const n = this._n(isWeakPoint ? 8 : 4);
    for (let i = 0; i < n; i++) {
      coneDir(nx, 0.5, nz, 0.7);
      const sp = (isWeakPoint ? 2.8 : 2) + rnd() * 2.6;
      const s = 0.06 + rnd() * 0.07;
      colJ(M.chips[(rnd() * 3) | 0], 0.1);
      this._chunk(x + nx * 0.08, y, z + nz * 0.08, _dx * sp, _dy * sp + 1.6, _dz * sp, (0.9 + rnd() * 0.5) * this._qLife, wood ? s * 2.2 : s, s * 0.6, s, 0, 13, M.rest);
    }
    if (this._smoke) {
      colJ(M.dust, 0.05);
      this._puff(x + nx * 0.1, y, z + nz * 0.1, nx * 0.7, 0.5, nz * 0.7, 0.16, 0.55, 0.42, 0.5);
    }
    col(P.hot);
    this._sp(x + nx * 0.1, y, z + nz * 0.1, 0, 0, 0, 0.09, 0.26, 0.44, STAR, 0.8, 1, 0, 0.1, 0);
    if (material === 'metal') {
      const k = this._n(3);
      for (let i = 0; i < k; i++) {
        coneDir(nx, 0.4, nz, 0.5);
        const sp = 4 + rnd() * 6;
        colMix(P.hot, P.sparkDeep, rnd() * 0.8);
        this._sp(x, y, z, _dx * sp, _dy * sp, _dz * sp, 0.16 + rnd() * 0.16, 0.045, 0.02, STREAK, 0.85, 1, 13, 2.6, 0.55);
      }
    }
    if (isWeakPoint) {
      const bx = x + nx * 0.14, bz = z + nz * 0.14;
      col(P.crit);
      this._sp(bx, y, bz, 0, 0, 0, 0.24, 0.2, 1.05, RINGS, 0.75, 1, 0, 0.1, 0);
      this._sp(bx, y, bz, 0, 0, 0, 0.1, 0.5, 0.95, GLOW, 0.85, 0.7, 0, 0.1, 0);
      const k = this._n(6);
      for (let i = 0; i < k; i++) {
        coneDir(nx, 0.3, nz, 0.2);
        const sp = 2.2 + rnd() * 3;
        colMix(P.crit, P.star, rnd());
        this._sp(bx, y, bz, _dx * sp, _dy * sp + 0.5, _dz * sp, (0.3 + rnd() * 0.2) * this._qLife, 0.2 + rnd() * 0.1, 0.05, STAR, 0.75, 1, 2, 3.5, 0);
      }
    }
  }

  debris(position, material, opts) {
    const M = MATERIALS[material] || MATERIALS.wood;
    const count = opts && opts.count > 0 ? opts.count : 14;
    const size = opts && opts.size > 0 ? opts.size : 0.35;
    const spread = opts && opts.spread > 0 ? opts.spread : 2;
    const x = position.x, y = position.y, z = position.z;
    const metal = material === 'metal', wood = material === 'wood' || !MATERIALS[material];
    const n = this._n(count);
    for (let i = 0; i < n; i++) {
      randDir();
      const ox = _dx * spread * 0.28 * rnd(), oy = _dy * spread * 0.24 * rnd(), oz = _dz * spread * 0.28 * rnd();
      const sp = spread * (0.7 + rnd() * 1.2);
      const vy = Math.abs(_dy) * sp * 0.8 + 1.4 + rnd() * 2.6;
      const s = size * (0.45 + rnd() * 0.75);
      colJ(M.chips[(rnd() * 3) | 0], 0.1);
      // planks for wood, blocks for brick, plates for metal
      const sx = wood ? s * 1.5 : metal ? s * 1.1 : s * 0.95;
      const sy = wood ? s * 0.32 : metal ? s * 0.12 : s * 0.58;
      const sz = wood ? s * 0.5 : metal ? s * 0.75 : s * 0.62;
      this._chunk(x + ox, y + oy, z + oz, _dx * sp, vy, _dz * sp, (1.5 + rnd() * 0.9) * this._qLife, sx, sy, sz, 0, 14, M.rest);
    }
    if (this._smoke) {
      const k = this._n(3);
      for (let i = 0; i < k; i++) {
        randDir();
        colJ(M.dust, 0.05);
        this._puff(x + _dx * spread * 0.2, y + Math.abs(_dy) * spread * 0.15, z + _dz * spread * 0.2, _dx * spread * 0.6, 0.5 + rnd() * 0.6, _dz * spread * 0.6, spread * 0.3, spread * (0.7 + rnd() * 0.3), 0.6 + rnd() * 0.25, 0.48);
      }
    }
    if (metal) {
      const k = this._n(5);
      for (let i = 0; i < k; i++) {
        randDir();
        const sp = 4 + rnd() * 6;
        colMix(P.hot, P.sparkDeep, rnd() * 0.8);
        this._sp(x, y, z, _dx * sp, Math.abs(_dy) * sp, _dz * sp, 0.2 + rnd() * 0.2, 0.05, 0.02, STREAK, 0.85, 1, 13, 2.4, 0.55);
      }
    }
  }

  /**
   * A building wall panel breaking: chunks in the material colour (MATERIAL_COLOR) spread over
   * the panel face from centre-line (ax, az) -> (bx, bz) between heights y0 and y1, plus dust.
   */
  wallBreak(ends, y0, y1, material) {
    const M = MATERIALS[material] || MATERIALS.wood;
    const chip = WALL_CHIPS[material] || WALL_CHIPS.wood;
    const metal = material === 'metal', wood = material === 'wood' || !MATERIALS[material];
    const ax = ends.ax, az = ends.az;
    const ex = ends.bx - ax, ez = ends.bz - az;
    const h = Math.max(0.5, y1 - y0);
    const n = this._n(26);
    for (let i = 0; i < n; i++) {
      const u = rnd(), v = rnd();
      randDir();
      const sp = 1.6 + rnd() * 2.6;
      const s = 0.22 + rnd() * 0.38;
      if (rnd() < 0.7) colJ(chip, 0.14);
      else colJ(M.chips[(rnd() * 3) | 0], 0.1);
      const sx = wood ? s * 1.5 : metal ? s * 1.1 : s * 0.95;
      const sy = wood ? s * 0.32 : metal ? s * 0.12 : s * 0.58;
      const sz = wood ? s * 0.5 : metal ? s * 0.75 : s * 0.62;
      this._chunk(ax + ex * u, y0 + h * v, az + ez * u, _dx * sp, Math.abs(_dy) * sp * 0.6 + 0.8 + rnd() * 1.6, _dz * sp, (1.4 + rnd() * 0.9) * this._qLife, sx, sy, sz, 0, 14, M.rest);
    }
    if (this._smoke) {
      const k = this._n(5);
      for (let i = 0; i < k; i++) {
        const u = rnd();
        colJ(M.dust, 0.05);
        this._puff(ax + ex * u, y0 + 0.4 + rnd() * h * 0.5, az + ez * u, (rnd() - 0.5) * 1.2, 0.4 + rnd() * 0.5, (rnd() - 0.5) * 1.2, 0.8, 2.2 + rnd() * 0.8, 0.8 + rnd() * 0.3, 0.5);
      }
    }
  }

  buildPlace(position, size, material) {
    const M = MATERIALS[material] || MATERIALS.wood;
    const x = position.x, y = position.y, z = position.z;
    const sx = size.x, sy = size.y, sz = size.z;
    const b = this._boxes;
    const life = 0.36;
    const o = b.alloc(this.time + life);
    const d = b.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = this.time;
    d[o + 4] = sx; d[o + 5] = sy; d[o + 6] = sz; d[o + 7] = life;
    d[o + 8] = M.tint[0]; d[o + 9] = M.tint[1]; d[o + 10] = M.tint[2]; d[o + 11] = 0;
    // dust kicked out along the base, sparkles on the outline
    const by = y - sy * 0.5;
    if (this._smoke) {
      const n = this._n(5);
      for (let i = 0; i < n; i++) {
        const px = (rnd() - 0.5) * sx, pz = (rnd() - 0.5) * sz;
        const a = rnd() * TAU;
        colJ(M.dust, 0.05);
        this._puff(x + px, by + 0.12, z + pz, Math.cos(a) * 1.3, 0.35 + rnd() * 0.3, Math.sin(a) * 1.3, 0.2, 0.6 + rnd() * 0.25, 0.4 + rnd() * 0.15, 0.42);
      }
    }
    const k = this._n(6);
    for (let i = 0; i < k; i++) {
      // random point on a random vertical edge-ish region of the box
      const ex = (rnd() < 0.5 ? -0.5 : 0.5) * sx, ez = (rnd() < 0.5 ? -0.5 : 0.5) * sz;
      const ey = (rnd() - 0.5) * sy;
      col(M.tint);
      const o2 = this._sp(x + ex, y + ey, z + ez, (rnd() - 0.5) * 0.6, 0.4 + rnd() * 0.6, (rnd() - 0.5) * 0.6, 0.3 + rnd() * 0.2, 0.2, 0.05, STAR, 0.8, 1, 0, 1.5, 0);
      this._later(o2, rnd() * 0.12);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Loot and chests
  // -------------------------------------------------------------------------------------------
  lootBeam(position, rarity) {
    const tier = rarityIndex(rarity);
    const set = this._loot;
    let s = set.take();
    if (s < 0) {
      s = set.oldest();
      set.handles[s]._alive = false;
    } else {
      this._beams.persistLive++;
      this._decals.persistLive++;
    }
    const h = new LootBeamHandle(this, s);
    set.handles[s] = h;
    set.seq[s] = ++set.counter;
    col(RARITY_COLORS[tier]);
    this._writeBeam(s * 16, position.x, position.y, position.z, -1, 1.1, RARITY_HEIGHT[tier], B_LOOT, tier, 1);
    this._writeDecal(s * 16, position.x, position.y, position.z, -1, 0.7 + tier * 0.04, 0.7 + tier * 0.04, D_LOOT, tier, 1);
    this._beams.dieAt[s] = Infinity;
    this._decals.dieAt[s] = Infinity;
    this._beams.mesh.visible = true;
    this._decals.mesh.visible = true;
    this._beams.touch(s);
    this._decals.touch(s);
    return h;
  }
  _lootMove(s, x, y, z) {
    const o = s * 16;
    let d = this._beams.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z;
    d = this._decals.data;
    d[o] = x; d[o + 1] = y + 0.04; d[o + 2] = z;
    this._beams.touch(s);
    this._decals.touch(s);
  }
  _lootShow(s, a) {
    this._beams.data[s * 16 + 12] = a;
    this._decals.data[s * 16 + 12] = a;
    this._beams.touch(s);
    this._decals.touch(s);
  }
  _lootFree(s) {
    this._beams.kill(s);
    this._decals.kill(s);
    this._beams.persistLive--;
    this._decals.persistLive--;
    this._loot.give(s);
  }

  pickupBurst(position, rarity) {
    const tier = rarityIndex(rarity);
    const C = RARITY_COLORS[tier];
    const x = position.x, y = position.y, z = position.z;
    col(C);
    this._beam(x, y, z, 0.42, 1.2, 3.2 + tier * 0.3, B_COLUMN, tier, 1);
    this._decal(x, y, z, 0.4, 0.3, 1.3, D_RING, 0, 1);
    this._sp(x, y + 0.5, z, 0, 0, 0, 0.12, 0.5, 1.0, GLOW, 0.85, 0.6, 0, 0.1, 0);
    const n = this._n(9);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, rr = 0.25 + rnd() * 0.35;
      colMix(C, P.white, rnd() * 0.5);
      this._sp(x + Math.cos(a) * rr, y + 0.2 + rnd() * 0.5, z + Math.sin(a) * rr, Math.cos(a) * 0.8, 2.2 + rnd() * 2.2, Math.sin(a) * 0.8, (0.35 + rnd() * 0.2) * this._qLife, 0.2 + rnd() * 0.08, 0.04, i & 1 ? STAR : DIAMOND, 0.7, 1, 0, 2.2, 0);
    }
  }

  chestGlow(position) {
    const set = this._chests;
    let s = set.take();
    if (s < 0) {
      s = set.oldest();
      set.handles[s]._alive = false;
    } else {
      this._sprites.persistLive += CHEST_SPRITES;
      this._decals.persistLive++;
    }
    const h = new ChestGlowHandle(this, s);
    set.handles[s] = h;
    set.seq[s] = ++set.counter;
    const x = position.x, y = position.y, z = position.z;
    col(P.gold);
    const di = MAX_LOOT + s;
    this._writeDecal(di * 16, x, y, z, -1, 1.25, 1.25, D_CHEST, 0, 1);
    this._decals.dieAt[di] = Infinity;
    this._decals.mesh.visible = true;
    this._decals.touch(di);
    // looping sprites: one breathing glow + three drifting sparkles
    const b = this._sprites, d = b.data;
    for (let k = 0; k < CHEST_SPRITES; k++) {
      const i = s * CHEST_SPRITES + k;
      const o = i * 24;
      const glow = k === 0;
      const life = glow ? 2.8 : 1.5 + rnd() * 0.9;
      d[o] = x; d[o + 1] = y + (glow ? 0.55 : 0.75); d[o + 2] = z; d[o + 3] = this.time - rnd() * life;
      d[o + 4] = 0; d[o + 5] = glow ? 0 : 0.38; d[o + 6] = 0; d[o + 7] = life;
      const C = glow ? P.gold : P.goldLight;
      d[o + 8] = C[0]; d[o + 9] = C[1]; d[o + 10] = C[2]; d[o + 11] = glow ? 0.9 : 0.75;
      d[o + 12] = glow ? 1.3 : 0.2; d[o + 13] = glow ? 1.7 : 0.1; d[o + 14] = 0; d[o + 15] = 0.1;
      d[o + 16] = glow ? GLOW : STAR; d[o + 17] = 0; d[o + 18] = glow ? 0 : 0.42; d[o + 19] = rnd() * 10;
      d[o + 20] = glow ? 0.32 : 1; d[o + 21] = 1; d[o + 22] = glow ? 0.45 : 0.25; d[o + 23] = glow ? 0 : 1.2;
      b.dieAt[i] = Infinity;
      b.touch(i);
    }
    b.mesh.visible = true;
    return h;
  }
  _chestFree(s) {
    const di = MAX_LOOT + s;
    this._decals.kill(di);
    this._decals.persistLive--;
    for (let k = 0; k < CHEST_SPRITES; k++) this._sprites.kill(s * CHEST_SPRITES + k);
    this._sprites.persistLive -= CHEST_SPRITES;
    this._chests.give(s);
  }

  chestOpen(position) {
    const x = position.x, y = position.y, z = position.z;
    col(P.gold);
    this._beam(x, y + 0.3, z, 0.55, 1.5, 4.6, B_COLUMN, 4, 1);
    this._decal(x, y, z, 0.55, 0.4, 2.4, D_RING, 0, 1);
    this._decal(x, y, z, 0.35, 1.2, 2.0, D_FLASH, 0, 0.8);
    this._sp(x, y + 0.7, z, 0, 0, 0, 0.16, 0.8, 1.9, GLOW, 0.9, 0.7, 0, 0.1, 0);
    col(P.goldLight);
    this._sp(x, y + 0.7, z, 0, 0, 0, 0.12, 0.6, 1.1, FLASH, 0.8, 1, 0, 0.1, 0);
    // fountain of stars
    const n = this._n(18);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, h = 1.2 + rnd() * 1.6;
      colMix(P.gold, P.goldLight, rnd());
      const o = this._sp(x, y + 0.6, z, Math.cos(a) * h, 3.2 + rnd() * 2.8, Math.sin(a) * h, (0.55 + rnd() * 0.35) * this._qLife, 0.24 + rnd() * 0.1, 0.05, i % 3 === 0 ? DIAMOND : STAR, 0.72, 1, 6.5, 1.6, 0);
      this._later(o, rnd() * 0.08);
    }
    // a little confetti
    const c = this._n(8);
    for (let i = 0; i < c; i++) {
      const a = rnd() * TAU, h = 1 + rnd() * 1.8;
      colMix(P.gold, P.white, rnd() * 0.6);
      const s = 0.07 + rnd() * 0.05;
      this._chunk(x, y + 0.7, z, Math.cos(a) * h, 3.5 + rnd() * 2.5, Math.sin(a) * h, (1.1 + rnd() * 0.5) * this._qLife, s * 1.6, s * 0.15, s, 0.45, 7.5, 0.2);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Characters
  // -------------------------------------------------------------------------------------------
  aura(target, kind, duration) {
    if (!target) return;
    const dur = duration > 0 ? duration : 1;
    const list = this._auras;
    let e = null;
    let idx = -1;
    for (let i = 0; i < list.length; i++) {
      if (!list[i].active) { e = list[i]; idx = i; break; }
    }
    if (e === null) {
      // all anchors busy: steal the oldest
      let best = 0;
      for (let i = 1; i < list.length; i++) if (list[i].seq < list[best].seq) best = i;
      e = list[best]; idx = best;
    } else this._auraLive++;
    e.active = true;
    e.target = target;
    e.isObject = !!target.isObject3D;
    e.shield = kind === 'shield';
    e.end = this.time + dur;
    e.free = e.end + 1.3; // keep the anchor alive until the last particles are gone
    e.acc = 1;
    e.seq = ++this._auraSeq;
    this._auraPos(e);
    this._anchors[idx + 1].copy(_v3);
    col(e.shield ? P.shield : P.heal);
    e.decal = this._decal(_v3.x, _v3.y, _v3.z, dur + 0.25, 0.8, 0.8, D_AURA, 0, 0.9);
    e.decalGen = this._decals.gen[e.decal];
  }
  _auraPos(e) {
    if (e.isObject) e.target.getWorldPosition(_v3);
    else _v3.set(e.target.x, e.target.y, e.target.z);
  }
  _updateAuras(dt, now) {
    const list = this._auras;
    const rate = 24 * this._qCount;
    const sd = this._sprites.data;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.active) continue;
      if (now >= e.free) {
        e.active = false; e.target = null;
        this._auraLive--;
        continue;
      }
      this._auraPos(e);
      this._anchors[i + 1].copy(_v3);
      if (now >= e.end) continue;
      // ground ring follows the target (only while this aura still owns the slot)
      const dec = this._decals;
      if (dec.gen[e.decal] === e.decalGen) {
        const o = e.decal * 16;
        dec.data[o] = _v3.x; dec.data[o + 1] = _v3.y + 0.04; dec.data[o + 2] = _v3.z;
        dec.touch(e.decal);
      }
      e.acc += dt * rate;
      let burst = 0;
      while (e.acc >= 1 && burst < 6) {
        e.acc -= 1; burst++;
        const a = rnd() * TAU, rr = 0.36 + rnd() * 0.26;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        const pick = rnd();
        let o;
        if (e.shield) {
          colMix(P.shield, P.shieldLight, rnd() * 0.7);
          o = this._sp(lx, 0.05 + rnd() * 0.5, lz, -lz * 0.9, 1.3 + rnd() * 0.7, lx * 0.9, 0.8 + rnd() * 0.3, 0.17 + rnd() * 0.07, 0.05, pick < 0.5 ? HEX : DIAMOND, 0.65, 1, 0, 0.4, 0);
        } else {
          colMix(P.heal, P.healLight, rnd() * 0.6);
          o = this._sp(lx, 0.05 + rnd() * 0.5, lz, lx * 0.15, 1.2 + rnd() * 0.8, lz * 0.15, 0.8 + rnd() * 0.3, 0.17 + rnd() * 0.08, 0.06, pick < 0.55 ? PLUS : DOT, 0.6, 1, 0, 0.4, 0);
        }
        sd[o + 17] = i + 1; // anchor
        sd[o + 22] = 0.15; // fade in
      }
      if (e.acc > 1) e.acc = 1;
    }
  }

  shieldPop(position) {
    const x = position.x, y = position.y, z = position.z;
    col(P.shield);
    this._sp(x, y, z, 0, 0, 0, 0.3, 0.7, 2.6, HEX, 0.7, 1, 0, 0.1, 0);
    this._sp(x, y, z, 0, 0, 0, 0.14, 1.0, 2.2, GLOW, 0.9, 0.7, 0, 0.1, 0);
    col(P.shieldLight);
    this._sp(x, y, z, 0, 0, 0, 0.2, 0.5, 1.7, HEX, 0.8, 1, 0, 0.1, 0);
    this._sp(x, y, z, 0, 0, 0, 0.1, 0.6, 1.0, FLASH, 0.85, 1, 0, 0.1, 0);
    // glassy shards
    const n = this._n(14);
    for (let i = 0; i < n; i++) {
      randDir();
      const sp = 2.5 + rnd() * 3.5;
      const s = 0.09 + rnd() * 0.08;
      colMix(P.shield, P.shieldLight, rnd());
      this._chunk(x + _dx * 0.4, y + _dy * 0.6, z + _dz * 0.4, _dx * sp, _dy * sp * 0.6 + 2, _dz * sp, (0.8 + rnd() * 0.4) * this._qLife, s * 1.4, s * 0.1, s, 0.7, 9, 0.25);
    }
    const m = this._n(8);
    for (let i = 0; i < m; i++) {
      randDir();
      const sp = 3 + rnd() * 4;
      colMix(P.shield, P.white, rnd() * 0.6);
      this._sp(x + _dx * 0.3, y + _dy * 0.5, z + _dz * 0.3, _dx * sp, _dy * sp, _dz * sp, (0.3 + rnd() * 0.2) * this._qLife, 0.16, 0.03, DIAMOND, 0.75, 1, 3, 3.5, 0);
    }
  }

  elimination(position, color) {
    const x = position.x, y = position.y, z = position.z;
    colAny(color, P.shieldLight);
    const cr = _r, cg = _g, cb = _b;
    // light leaves upward, the ground remembers it for a moment
    this._beam(x, y, z, 1.05, 1.8, 9, B_ELIM, 0, 1);
    this._decal(x, y, z, 0.7, 0.4, 2.6, D_RING, 0, 1);
    this._decal(x, y, z, 0.5, 1.0, 1.8, D_FLASH, 0, 0.9);
    this._sp(x, y + 1.0, z, 0, 0, 0, 0.22, 1.2, 2.6, GLOW, 0.9, 0.75, 0, 0.1, 0);
    // motes drifting up out of the silhouette
    const n = this._n(16);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, rr = rnd() * 0.35;
      const k = rnd() * 0.7;
      _r = cr + (1 - cr) * k; _g = cg + (1 - cg) * k; _b = cb + (1 - cb) * k;
      const o = this._sp(x + Math.cos(a) * rr, y + 0.2 + rnd() * 1.5, z + Math.sin(a) * rr, Math.cos(a) * 0.5, 1.6 + rnd() * 2.4, Math.sin(a) * 0.5, (0.6 + rnd() * 0.5) * this._qLife, 0.2 + rnd() * 0.1, 0.04, i % 3 === 0 ? DIAMOND : STAR, 0.72, 1, -1, 1.2, 0);
      this._later(o, rnd() * 0.25);
    }
    // confetti shards: player colour, white and a warm accent, slow to fall
    const c = this._n(22);
    for (let i = 0; i < c; i++) {
      randDir();
      const sp = 1.8 + rnd() * 3.2;
      const s = 0.09 + rnd() * 0.08;
      const pick = i % 4;
      if (pick === 0) col(P.white);
      else if (pick === 1) col(P.starDeep);
      else { _r = cr; _g = cg; _b = cb; }
      this._chunk(x + _dx * 0.25, y + 0.5 + rnd() * 1.1, z + _dz * 0.25, _dx * sp, Math.abs(_dy) * sp * 0.7 + 2.2, _dz * sp, (1.3 + rnd() * 0.7) * this._qLife, s * 1.5, s * 0.1, s, 0.5, 6.5, 0.22);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Grenades
  // -------------------------------------------------------------------------------------------
  /** Grenade blast: fireball, shockwave ring, sparks, smoke, dirt. `opts.radius` = blast radius (m). */
  explosion(position, opts) {
    const R = opts && opts.radius > 0 ? opts.radius : 5;
    const s = R / 5;
    const x = position.x, gy = position.y, y = position.y + 0.3, z = position.z;
    col(P.hot);
    this._sp(x, y, z, 0, 0, 0, 0.12, 1.6 * s, 5.5 * s, FLASH, 0.9, 1, 0, 0.1, 0);
    col(P.flash);
    this._sp(x, y, z, 0, 0, 0, 0.3, 1.2 * s, 4.6 * s, GLOW, 0.9, 0.9, 0, 0.1, 0);
    col(P.flashDeep);
    this._sp(x, y + 0.3 * s, z, 0, 1.5, 0, 0.45, 1.0 * s, 3.6 * s, GLOW, 0.8, 0.8, 0, 0.1, 0);
    // the shockwave ring marks the damage radius
    this._decal(x, gy, z, 0.45, R * 0.15, R, D_RING, 0, 1);
    this._decal(x, gy, z, 0.35, R * 0.3, R * 0.6, D_FLASH, 0, 0.9);
    const n = this._n(10);
    for (let i = 0; i < n; i++) {
      randDir();
      const sp = 3 + rnd() * 5;
      colMix(P.flash, P.flashDeep, rnd());
      this._sp(x + _dx * 0.4, y + Math.abs(_dy) * 0.4, z + _dz * 0.4, _dx * sp, Math.abs(_dy) * sp + 1, _dz * sp, 0.25 + rnd() * 0.2, 0.7 * s, 1.5 * s, GLOW, 0.8, 0.85, 0, 2.5, 0);
    }
    const m = this._n(22);
    for (let i = 0; i < m; i++) {
      randDir();
      const sp = 9 + rnd() * 14;
      colMix(P.hot, P.sparkDeep, rnd());
      this._sp(x, y, z, _dx * sp, Math.abs(_dy) * sp * 0.9 + 2, _dz * sp, 0.35 + rnd() * 0.35, 0.07, 0.02, STREAK, 0.85, 1, 12, 1.6, 0.55);
    }
    if (this._smoke) {
      const k = this._n(9);
      for (let i = 0; i < k; i++) {
        randDir();
        colJ(P.soot, 0.08);
        const o = this._puff(x + _dx * R * 0.15, y + Math.abs(_dy) * R * 0.12, z + _dz * R * 0.15, _dx * 2.2, 1 + rnd() * 1.6, _dz * 2.2, 0.9 * s, (2.2 + rnd() * 1.1) * s, 1.1 + rnd() * 0.6, 0.55);
        this._later(o, 0.06 + rnd() * 0.1);
      }
    }
    this.debris(position, 'dirt', { count: 12, size: 0.22, spread: R * 0.6 });
    this._light(x, y + 0.6, z, 90);
  }

  /** One step of a flying rocket's exhaust: flame at the tail and a smoke puff left behind. */
  rocketTrail(position) {
    const x = position.x, y = position.y, z = position.z;
    col(P.flash);
    this._sp(x, y, z, 0, 0, 0, 0.09, 0.5, 0.2, GLOW, 0.9, 0.95, 0, 0.1, 0);
    if (this._smoke) {
      colJ(P.soot, 0.1);
      this._puff(x, y, z, (rnd() - 0.5) * 0.5, 0.3 + rnd() * 0.3, (rnd() - 0.5) * 0.5, 0.22, 0.75 + rnd() * 0.3, 0.7 + rnd() * 0.3, 0.38);
    }
  }

  /** One blink of a live grenade's fuse light. */
  grenadeBlink(position) {
    col(P.alert);
    this._sp(position.x, position.y + 0.05, position.z, 0, 0, 0, 0.12, 0.3, 0.7, GLOW, 0.9, 0.9, 0, 0.1, 0);
  }

  // -------------------------------------------------------------------------------------------
  // Ground
  // -------------------------------------------------------------------------------------------
  ring(position, opts) {
    const radius = opts && opts.radius > 0 ? opts.radius : 3;
    const duration = opts && opts.duration > 0 ? opts.duration : 0.5;
    colAny(opts ? opts.color : undefined, P.white);
    this._decal(position.x, position.y, position.z, duration, radius * 0.18, radius, D_RING, 0, 1);
  }

  /** A damaged car's engine: grey smoke, or flames under black smoke when it is about to blow. */
  carSmoke(position, fire = false) {
    const x = position.x, y = position.y, z = position.z;
    if (fire) {
      col(P.flash);
      this._sp(x, y, z, 0, 1.4, 0, 0.3, 0.45, 0.9, GLOW, 0.85, 0.9, 0, 0.2, 0);
    }
    if (fire) colJ(P.soot, 0.06);
    else colJ(P.dust, 0.06);
    this._puff(x, y, z, (rnd() - 0.5) * 0.5, 1.2 + rnd() * 0.6, (rnd() - 0.5) * 0.5, 0.3, 1.1 + rnd() * 0.4, 1.2 + rnd() * 0.4, fire ? 0.6 : 0.45);
  }

  dustPuff(position, opts) {
    const s = opts && opts.scale > 0 ? opts.scale : 1;
    const x = position.x, y = position.y, z = position.z;
    const n = this._smoke ? this._n(4) : 2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const sp = (0.7 + rnd() * 0.8) * s;
      colJ(P.dust, 0.06);
      this._puff(x + Math.cos(a) * 0.12 * s, y + 0.1 * s, z + Math.sin(a) * 0.12 * s, Math.cos(a) * sp, 0.25 + rnd() * 0.35, Math.sin(a) * sp, 0.16 * s, (0.42 + rnd() * 0.2) * s, 0.4 + rnd() * 0.2, 0.5);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------------------------
  setQuality(quality) {
    const q = QUALITY[quality] ? quality : 'medium';
    const Q = QUALITY[q];
    this.quality = q;
    this._qCount = Q.count;
    this._qLife = Q.life;
    this._smoke = Q.smoke;
    if (this._disposed) return;
    while (this._lights.length < Q.lights) {
      const light = new THREE.PointLight(0xffc878, 0, 9, 2);
      light.castShadow = false;
      light.name = 'fx-muzzle-light';
      this.group.add(light);
      this._lights.push({ light, peak: 0, t0: 0, dur: 0.075 });
    }
    while (this._lights.length > Q.lights) {
      const L = this._lights.pop();
      this.group.remove(L.light);
      L.light.dispose();
    }
    this._lightNext = 0;
  }

  /** Remove every transient effect and every persistent handle (they go inert). */
  clear() {
    for (let i = 0; i < this._batches.length; i++) this._batches[i].reset();
    this._loot.reset();
    this._chests.reset();
    for (let i = 0; i < this._auras.length; i++) {
      this._auras[i].active = false;
      this._auras[i].target = null;
    }
    this._auraLive = 0;
    for (let i = 0; i < this._lights.length; i++) {
      this._lights[i].peak = 0;
      this._lights[i].light.intensity = 0;
    }
    this.time = 0;
    this._u.uTime.value = 0;
  }

  dispose() {
    if (this._disposed) return;
    this.clear();
    this._disposed = true;
    this.scene.remove(this.group);
    for (let i = 0; i < this._lights.length; i++) {
      this.group.remove(this._lights[i].light);
      this._lights[i].light.dispose();
    }
    this._lights.length = 0;
    for (let i = 0; i < this._batches.length; i++) this.group.remove(this._batches[i].mesh);
    for (let i = 0; i < this._geometries.length; i++) this._geometries[i].dispose();
    for (let i = 0; i < this._materials.length; i++) this._materials[i].dispose();
  }

  /** Live instance counts per batch. Returns the same object every call. */
  stats() {
    const s = this._stats, t = this.time;
    s.sprites = this._sprites.live(t);
    s.tracers = this._tracers.live(t);
    s.debris = this._debris.live(t);
    s.decals = this._decals.live(t);
    s.beams = this._beams.live(t);
    s.boxes = this._boxes.live(t);
    s.total = s.sprites + s.tracers + s.debris + s.decals + s.beams + s.boxes;
    return s;
  }

  _rebase() {
    const t = this.time;
    for (let i = 0; i < this._batches.length; i++) this._batches[i].rebase(t);
    for (let i = 0; i < this._auras.length; i++) {
      this._auras[i].end -= t;
      this._auras[i].free -= t;
    }
    for (let i = 0; i < this._lights.length; i++) this._lights[i].t0 -= t;
    this.time = 0;
  }
}
