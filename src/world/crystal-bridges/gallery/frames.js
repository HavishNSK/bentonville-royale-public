// BENTONVILLE ROYALE — Crystal Bridges galleries: frames, canvases, wall plaques, light pools.
//
// Ported from musewalk (https://github.com/shuyan-5200/musewalk, src/hall.js / lobby.js,
// MIT License, Copyright (c) 2026 Musewalk contributors; see credits/crystal-bridges.md):
// buildFrame() keeps musewalk's three frame styles with their exact proportions and colours,
// canvases are unlit MeshBasicMaterial (they never bloom), plaques are canvas textures with
// musewalk's fill / stroke / type ramp. Our adaptation: musewalk lights each work with its own
// SpotLight(lightColor, 76, 17, 0.6, 0.78, 1.7); an open-world game can't afford one light per
// painting, so each work gets a light-pool decal + a soft beam cone shaped like that spot's
// footprint, and index.js moves a small pool of real SpotLights onto the nearest works.

import * as THREE from 'three';

export const FONT_EN = '"Cormorant Garamond", "Times New Roman", serif';

// ---------------------------------------------------------------- frames (musewalk buildFrame)

const MAT = {};
function mats() {
  if (MAT.gold) return MAT;
  // MeshStandard as in musewalk; the gallery has an environment-free scene, so metalness is
  // softened slightly (0.92 -> 0.7) to keep the gilt readable under the game's hemisphere light.
  MAT.gold = new THREE.MeshStandardMaterial({ color: 0xa8843c, metalness: 0.7, roughness: 0.34 });
  MAT.goldLip = new THREE.MeshStandardMaterial({ color: 0x1c150c, roughness: 0.6 });
  MAT.dark = new THREE.MeshStandardMaterial({ color: 0x191310, metalness: 0.25, roughness: 0.5 });
  MAT.floatBack = new THREE.MeshStandardMaterial({ color: 0x77767a, roughness: 0.96 });
  MAT.floatStand = new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.6 });
  MAT.empty = new THREE.MeshBasicMaterial({ color: 0x6f6859 }); // musewalk's empty-frame canvas
  return MAT;
}

/** musewalk buildFrame(style, w, h): returns a Group with userData.canvasZ. */
export function buildFrame(style, w, h) {
  const M = mats();
  const g = new THREE.Group();
  if (style === 'gold') {
    const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, h + 0.34, 0.12), M.gold);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.06), M.goldLip);
    lip.position.z = 0.04;
    g.add(outer, lip);
    g.userData.canvasZ = 0.075;
  } else if (style === 'dark') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.08), M.dark));
    g.userData.canvasZ = 0.045;
  } else {
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.55, h + 0.55, 0.04), M.floatBack);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.06), M.floatStand);
    stand.position.z = 0.045;
    g.add(back, stand);
    g.userData.canvasZ = 0.08;
  }
  for (const m of g.children) m.castShadow = false;
  return g;
}

// ---------------------------------------------------------------- canvas text helpers

function textCanvas(wm, hm, ppm) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(wm * ppm);
  cv.height = Math.round(hm * ppm);
  return cv;
}

function fitFont(ctx, text, weight, style, startPx, minPx, maxW) {
  let px = startPx;
  for (; px > minPx; px -= 1) {
    ctx.font = `${style} ${weight} ${px}px ${FONT_EN}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = `${style} ${weight} ${px}px ${FONT_EN}`;
  return px;
}

/**
 * Wall plaque (musewalk "textPlane" label): fill rgba(10,10,14,0.64), accent stroke at α0.58,
 * title, artist (italic, accent), year. Returns { mesh, width }. Text is drawn, never parsed as HTML.
 */
export function buildPlaque(work, accent, opts = {}) {
  const title = String(work.title || '').slice(0, 80);
  const artist = String(work.artist || '').slice(0, 60);
  const year = String(work.year || '').slice(0, 24);
  const note = opts.note ? String(opts.note).slice(0, 60) : '';
  const width = Math.min(1.55, Math.max(0.9, 0.55 + title.length * 0.022));
  const height = note ? 0.5 : 0.42;
  const ppm = 460;
  const cv = textCanvas(width, height, ppm);
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const h = 0.42 * ppm;
  const pad = h * 0.13;
  ctx.fillStyle = 'rgba(10,10,14,0.64)';
  ctx.fillRect(0, 0, W, H);
  const acc = new THREE.Color(accent);
  const accRgb = `${Math.round(acc.r * 255)},${Math.round(acc.g * 255)},${Math.round(acc.b * 255)}`;
  ctx.strokeStyle = `rgba(${accRgb},0.58)`;
  ctx.lineWidth = Math.max(2, Math.round(h * 0.012));
  ctx.strokeRect(pad * 0.48, pad * 0.48, W - pad * 0.96, H - pad * 0.96);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(238,231,217,0.95)';
  fitFont(ctx, title, 500, 'normal', Math.round(h * 0.2), Math.round(h * 0.135), W - pad * 2);
  ctx.fillText(title, W / 2, h * 0.3);
  ctx.fillStyle = `rgba(${accRgb},0.85)`;
  fitFont(ctx, artist, 400, 'italic', Math.round(h * 0.13), Math.round(h * 0.09), W - pad * 2);
  ctx.fillText(artist, W / 2, h * 0.56);
  ctx.fillStyle = 'rgba(238,231,217,0.58)';
  fitFont(ctx, year, 400, 'normal', Math.round(h * 0.11), Math.round(h * 0.085), W - pad * 2);
  ctx.fillText(year, W / 2, h * 0.78);
  if (note) {
    ctx.fillStyle = 'rgba(238,231,217,0.5)';
    fitFont(ctx, note, 400, 'italic', Math.round(h * 0.09), Math.round(h * 0.07), W - pad * 2);
    ctx.fillText(note, W / 2, h * 0.98);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.renderOrder = 3;
  return { mesh, width };
}

// ---------------------------------------------------------------- light pool + beam

let _poolTex = null;
function poolTexture() {
  if (_poolTex) return _poolTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  // the oval footprint of musewalk's spot (angle 0.6, penumbra 0.78) on the wall: bright top, soft fall-off
  const g = ctx.createRadialGradient(64, 52, 4, 64, 60, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _poolTex = new THREE.CanvasTexture(cv);
  return _poolTex;
}

/** Additive warm pool on the wall around a work (stands in for its musewalk spotlight). */
export function buildLightPool(w, h, lightColor, strength = 0.55) {
  const mat = new THREE.MeshBasicMaterial({
    map: poolTexture(), color: new THREE.Color(lightColor).multiplyScalar(strength),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w + 2.6, h + 3.0), mat);
  m.renderOrder = 2;
  return m;
}

/** musewalk makeBeam: open cylinder, vertical alpha gradient (0.55 -> 0.12 @ 0.6 -> 0), additive. */
export function buildBeam(rTop, rBottom, height, color, opacity) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, 24, 1, true);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uH: { value: height } },
    vertexShader: 'uniform float uH; varying float vT; void main(){ vT = 0.5 - position.y / uH; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vT;
      void main(){ float a = vT < 0.6 ? mix(0.55, 0.12, vT / 0.6) : mix(0.12, 0.0, (vT - 0.6) / 0.4); gl_FragColor = vec4(uColor, a * uOpacity); }`,
  });
  return new THREE.Mesh(geo, mat);
}

// ---------------------------------------------------------------- stand-ins

/** Original stand-in art (procedural colour field) for copyrighted works shown as stand-ins. */
export function standInTexture(seed, accent) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  const base = new THREE.Color(accent).offsetHSL(rnd() * 0.2 - 0.1, -0.2, -0.25);
  ctx.fillStyle = '#' + base.getHexString();
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3; i++) {
    const c = base.clone().offsetHSL(rnd() * 0.5, 0.1, rnd() * 0.35);
    ctx.fillStyle = '#' + c.getHexString();
    ctx.globalAlpha = 0.85;
    const y = 20 + i * 76 + rnd() * 10;
    ctx.fillRect(18 + rnd() * 10, y, 220 - rnd() * 20, 58 + rnd() * 12);
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** musewalk's empty-frame canvas with its coloured bar (for works that are not reproduced). */
export function emptyCanvas(w, h, accent) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats().empty));
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.55, 0.045), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(1.25) }));
  bar.position.set(0, -h * 0.28, 0.002);
  g.add(bar);
  return g;
}
