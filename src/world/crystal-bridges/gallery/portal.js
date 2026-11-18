// BENTONVILLE ROYALE — "walk into the painting": the painting dissolves into brush-stroke chips
// that rise in relief and drift toward you, a white veil washes in, and you arrive somewhere else.
//
// The stroke body is ported from musewalk src/dreamBodies/strokes.js (MIT License, Copyright (c)
// 2026 Musewalk contributors): instanced billboard chips on a grid over the painting, each
// sampling a UV patch so the front view reassembles the picture, relief from luminance (dark =
// near, musewalk's auto-depth sign -1), superellipse chip mask, rotation ±0.45 rad, size
// variation ±20 %, anisotropy up to 0.16, gentle bob. Adaptation: musewalk computes depth from a
// blurred 128² luminance texture on the CPU; here the vertex shader reads the painting's own
// mip chain (WebGL2), and a uDrift term blows the chips toward the viewer for the hand-off.
// Timings: musewalk RISE_DELAY 1.1 s / RISE_DUR 1.5 s were shortened to fit a ~3 s game transition.

import * as THREE from 'three';

const VERT = /* glsl */ `
  attribute vec2 aUv;
  attribute vec4 aSeed;
  uniform sampler2D uMap;
  uniform vec2 uPaint;
  uniform vec2 uQuad;
  uniform float uMix;
  uniform float uDrift;
  uniform float uTime;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vShade;
  varying float vFade;
  void main() {
    vec3 c = textureLod(uMap, aUv, 4.0).rgb;
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float d = 0.5 - (lum - 0.5);            // dark = near (musewalk uDepthSign -1)
    float ef = smoothstep(0.0, 0.05, aUv.x) * (1.0 - smoothstep(0.95, 1.0, aUv.x))
             * smoothstep(0.0, 0.05, aUv.y) * (1.0 - smoothstep(0.95, 1.0, aUv.y));
    float z = ((d - 0.35) * 1.6 * 0.5 + (aSeed.x - 0.5) * 0.1) * ef * uMix;
    vec3 anchor = vec3((aUv - 0.5) * uPaint, z);
    anchor.y += sin(uTime * 0.4 + aSeed.y * 6.2832) * 0.012 * uMix;
    // drift toward the viewer (+z) and outward, staggered per chip
    float k = clamp(uDrift * (0.55 + 0.9 * aSeed.w) - aSeed.z * 0.25, 0.0, 1.5);
    anchor.z += k * (2.5 + aSeed.x * 4.0);
    anchor.xy += (aUv - 0.5) * uPaint * k * (0.35 + aSeed.y * 0.5);
    anchor.y += sin(uTime * (0.6 + aSeed.x) + aSeed.w * 6.28) * 0.25 * k;
    float sizeVar = 1.0 + (aSeed.z - 0.5) * 0.4;
    float aniso = fract(aSeed.x * 13.7) * 0.16;
    float ang = (aSeed.w - 0.5) * 0.9;
    float ca = cos(ang), sa = sin(ang);
    vec2 lo = position.xy * vec2(1.0 + aniso, 1.0 - aniso);
    vec2 off = vec2(lo.x * ca - lo.y * sa, lo.x * sa + lo.y * ca) * uQuad * sizeVar * (1.0 + k * 0.6);
    vUv = aUv + off / uPaint;
    vLocal = position.xy * 2.0;
    vShade = d - 0.5;
    vFade = 1.0 - smoothstep(0.9, 1.5, k);
    vec4 mv = modelViewMatrix * vec4(anchor, 1.0);
    mv.xy += off;
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vShade;
  varying float vFade;
  void main() {
    vec2 p = abs(vLocal);
    float m = 1.0 - (p.x * p.x * p.x * p.x + p.y * p.y * p.y * p.y);   // superellipse chip
    if (m < 0.35) discard;
    vec3 col = texture2D(uMap, clamp(vUv, 0.0, 1.0)).rgb;
    col *= 1.0 + vShade * 0.12;
    col *= 1.0 - (1.0 - m) * 0.12;
    col = min(col, vec3(1.0));
    gl_FragColor = vec4(col, uOpacity * vFade);
    #include <colorspace_fragment>
  }`;

/** Instanced stroke body for one painting texture (w x h metres). */
export function buildStrokes(texture, w, h, count = 22000) {
  const aspect = w / h;
  const gx = Math.max(24, Math.round(Math.sqrt(count * aspect)));
  const gy = Math.max(24, Math.round(gx / aspect));
  const n = gx * gy;
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  const uv = new Float32Array(n * 2);
  const seed = new Float32Array(n * 4);
  let s = 1234567;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let j = 0, i = 0; j < gy; j++) {
    for (let k = 0; k < gx; k++, i++) {
      uv[i * 2] = (k + 0.5 + (rnd() - 0.5) * 0.6) / gx;
      uv[i * 2 + 1] = (j + 0.5 + (rnd() - 0.5) * 0.6) / gy;
      for (let q = 0; q < 4; q++) seed[i * 4 + q] = rnd();
    }
  }
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.instanceCount = n;
  const step = w / gx;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uPaint: { value: new THREE.Vector2(w, h) },
      uQuad: { value: new THREE.Vector2(step * 2.35, step * 2.35) },
      uMix: { value: 0 },
      uDrift: { value: 0 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false, // keeps the chips out of the ink-outline pass (no black rims)
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

const easeInOutSine = (t) => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

/**
 * One portal transition. Calls onArrive() at the moment the screen is fully white.
 * Returns { update(dt) -> done?, dispose() }.
 */
export function runPortal({ scene, placement, texture, ui, onArrive, canvasMesh }) {
  const body = buildStrokes(texture, placement.w, placement.h);
  body.position.set(placement.x + placement.nx * 0.09, placement.y, placement.z + placement.nz * 0.09);
  body.rotation.y = Math.atan2(placement.nx, placement.nz);
  scene.add(body);
  if (canvasMesh) canvasMesh.visible = false;
  const u = body.material.uniforms;
  let t = 0;
  let arrived = false;
  let veilOn = false;
  return {
    update(dt) {
      t += dt;
      u.uTime.value += dt;
      u.uMix.value = easeInOutSine((t - 0.15) / 1.1);
      u.uDrift.value = Math.max(0, (t - 0.55) / 1.2);
      if (!veilOn && t > 1.05) {
        veilOn = true;
        ui.veil(true, 800);
      }
      if (!arrived && t > 1.9) {
        arrived = true;
        scene.remove(body);
        if (canvasMesh) canvasMesh.visible = true;
        onArrive();
        ui.veil(false, 1800);
      }
      return t > 3.8;
    },
    dispose() {
      if (body.parent) body.parent.remove(body);
      body.geometry.dispose();
      body.material.dispose();
      if (canvasMesh) canvasMesh.visible = true;
    },
  };
}
