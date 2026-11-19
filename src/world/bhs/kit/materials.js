// BENTONVILLE ROYALE — Bentonville High School kit: materials (three.js, browser only).
//
// Every look is a procedural canvas texture (no image files) tinted from kit/palette.js, mapped with
// world-space UVs in METRES (kit/meshes.js), so `tile` says how many metres one texture repeat
// covers. A look may also be '#rrggbb' (a plain colour: props, accents) or 'none' (not drawn).
// Materials are cached per look and shared by every BHS mesh.

import * as THREE from 'three';
import { PAL } from './palette.js';
import { drawEmblem } from './emblem.js';
import { GLASS_PANE } from '../../crystal-bridges/meshes.js';

// BHS glass = the Crystal Bridges pane (clear, specular, sky streaks; user 2026-11-19) with a bluer
// tint: the curtain walls in the photos read blue-green [ENT, DRW].
const BHS_GLASS = { ...GLASS_PANE, color: 0x9cc6ec, emissive: 0x0a1c30, opacity: 0.45 }; // bluer: the curtain wall read grey (QA)

const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** A canvas texture tile drawn by draw(ctx, w, h, r). */
function tex(w, h, draw, seed = 7) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h, rng(seed));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

const shade = (hex, k) => {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.max(0, (hex & 255) * k));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
};

function speckle(ctx, w, h, n, r, base, amt) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = shade(base, 1 + (r() - 0.5) * amt);
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

// ---------------------------------------------------------------- texture recipes

/** Running-bond brick: 8 courses x 4 bricks per tile (tile 1.6 x 0.533 m: 0.2 x 0.067 m bricks). */
function brickTex(base, mortar, seed, soldier = false) {
  return tex(512, 256, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(mortar);
    ctx.fillRect(0, 0, w, h);
    const rows = soldier ? 1 : 8;
    const cols = soldier ? 24 : 8;
    const bh = h / rows;
    const bw = w / cols;
    for (let y = 0; y < rows; y++) {
      const off = soldier ? 0 : (y % 2) * bw * 0.5;
      for (let x = -1; x < cols + 1; x++) {
        const k = 1 + (r() - 0.5) * 0.16;
        ctx.fillStyle = shade(base, k);
        ctx.fillRect(x * bw + off + 2, y * bh + 2, bw - 4, bh - 4);
        speckle(ctx, 0, 0, 0, r, base, 0); // keep rng stream stable
      }
    }
    speckle(ctx, w, h, 2400, r, base, 0.35);
  }, seed);
}

/** Split-face / ground-face block, stack bond 0.4 x 0.2 m (tile 1.6 x 0.8 m). */
function blockTex(base, seed, stack = true) {
  return tex(512, 256, (ctx, w, h, r) => {
    ctx.fillStyle = shade(base, 0.82);
    ctx.fillRect(0, 0, w, h);
    const bw = w / 4;
    const bh = h / 4;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 5; x++) {
        const off = stack ? 0 : (y % 2) * bw * 0.5;
        ctx.fillStyle = shade(base, 1 + (r() - 0.5) * 0.08);
        ctx.fillRect(x * bw + off + 2, y * bh + 2, bw - 3, bh - 3);
      }
    speckle(ctx, w, h, 5000, r, base, 0.3);
  }, seed);
}

/** Horizontal ribbed metal panel: ribs every 0.3 m (tile 1 x 1.2 m). */
function ribbedTex(base) {
  return tex(64, 256, (ctx, w, h) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const y = (i * h) / 4;
      const g = ctx.createLinearGradient(0, y, 0, y + h / 4);
      g.addColorStop(0, shade(base, 1.06));
      g.addColorStop(0.5, shade(base, 0.97));
      g.addColorStop(0.92, shade(base, 0.9));
      g.addColorStop(1, shade(base, 0.75));
      ctx.fillStyle = g;
      ctx.fillRect(0, y, w, h / 4);
    }
  });
}

/** Flat metal panel with staggered joints (tile 3 x 1.2 m). */
function panelTex(base, seed) {
  return tex(256, 128, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = shade(base, 0.7);
    for (let y = 0; y < 2; y++) {
      ctx.fillRect(0, y * (h / 2), w, 2);
      const off = (y % 2) * (w / 4);
      for (let x = 0; x < 3; x++) ctx.fillRect(off + (x * w) / 2, y * (h / 2), 2, h / 2);
    }
    speckle(ctx, w, h, 300, r, base, 0.06);
  }, seed);
}

/** Polished terrazzo field (tile 2 x 2 m). */
function terrazzoTex(base, seed) {
  return tex(512, 512, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const k = r();
      ctx.fillStyle = k < 0.33 ? shade(base, 0.7) : k < 0.66 ? shade(base, 1.18) : shade(0x6e6259, 1);
      ctx.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
    }
  }, seed);
}

/** Horizontal wood plank banding: 0.3 m planks with dark reveals (tile 2.4 x 1.2 m). */
function woodBandTex(base, seed) {
  return tex(512, 256, (ctx, w, h, r) => {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const y = (i * h) / n;
      ctx.fillStyle = shade(base, 1 + (r() - 0.5) * 0.12);
      ctx.fillRect(0, y, w, h / n);
      ctx.strokeStyle = shade(base, 0.85);
      for (let k = 0; k < 14; k++) {
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        const yy = y + r() * (h / n);
        ctx.moveTo(0, yy);
        ctx.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 6, w * 0.6, yy + (r() - 0.5) * 6, w, yy + (r() - 0.5) * 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexCss(PAL.woodReveal);
      ctx.fillRect(0, y + h / n - 4, w, 4);
    }
  }, seed);
}

/** VCT floor: 0.3 m tiles, field + scattered accent tiles (tile 2.4 x 2.4 m). */
function vctTex(base, accent, seed) {
  return tex(512, 512, (ctx, w, h, r) => {
    const n = 8;
    const s = w / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = (x + y * 3) % 7 === 0;
        ctx.fillStyle = shade(a ? accent : base, 1 + (r() - 0.5) * 0.05);
        ctx.fillRect(x * s, y * s, s, s);
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x * s, y * s, s, 1);
        ctx.fillRect(x * s, y * s, 1, s);
      }
    speckle(ctx, w, h, 4000, r, base, 0.12);
  }, seed);
}

/** Acoustic ceiling: 0.6 x 1.2 m lay-in tiles on a white grid (tile 2.4 x 2.4 m). */
function ceilingTex(base, seed) {
  return tex(256, 256, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 3000, r, base, 0.14);
    ctx.fillStyle = '#f6f6f4';
    for (let i = 0; i < 4; i++) ctx.fillRect((i * w) / 4, 0, 3, h);
    for (let i = 0; i < 2; i++) ctx.fillRect(0, (i * h) / 2, w, 3);
  }, seed);
}

/** Carpet: fine noise (tile 2 x 2 m). */
function carpetTex(base, seed) {
  return tex(256, 256, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 14000, r, base, 0.3);
  }, seed);
}

/** Broom-finished concrete with saw joints every 1.5 m (tile 3 x 3 m). */
function pavingTex(base, seed) {
  return tex(256, 256, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 6000, r, base, 0.12);
    ctx.fillStyle = shade(base, 0.72);
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h / 2, w, 2);
    ctx.fillRect(0, 0, 2, h);
    ctx.fillRect(w / 2, 0, 2, h);
  }, seed);
}

/** White membrane roof with seams every 3 m and grey walk pads (tile 6 x 6 m). */
function roofTex(base, seed) {
  return tex(256, 256, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1500, r, base, 0.08);
    ctx.fillStyle = shade(base, 0.9);
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h / 2, w, 2);
  }, seed);
}

/** Glass lite: the Crystal Bridges pane texture (pale sky gradient + two diagonal reflection streaks), one lite per tile. */
function glassTex() {
  return tex(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f2f8fa');
    g.addColorStop(0.45, '#c9dde4');
    g.addColorStop(1, '#a9c2ca');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const band = (x0, bw, a) => {
      ctx.save();
      ctx.translate(x0, 0);
      ctx.transform(1, 0, -0.55, 1, 0, 0);
      const s = ctx.createLinearGradient(0, 0, bw, 0);
      s.addColorStop(0, 'rgba(255,255,255,0)');
      s.addColorStop(0.5, 'rgba(255,255,255,' + a + ')');
      s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, bw, h);
      ctx.restore();
    };
    band(w * 0.38, w * 0.22, 0.75);
    band(w * 0.7, w * 0.08, 0.6);
  });
}

/** Painted gypsum / block (tile 1.6 x 0.8 m), very faint block lines when `block`. */
function paintTex(base, seed, block = true) {
  return tex(256, 128, (ctx, w, h, r) => {
    ctx.fillStyle = hexCss(base);
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 1200, r, base, 0.05);
    if (block) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let y = 0; y < 4; y++) ctx.fillRect(0, (y * h) / 4, w, 1);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ctx.fillRect((x * w) / 4 + ((y % 2) * w) / 8, (y * h) / 4, 1, h / 4);
    }
  }, seed);
}

/** Lockers: two-tier steel lockers 0.3 m wide with vents and handles (tile 0.6 x 1.8 m). */
function lockerTex(base) {
  return tex(128, 384, (ctx, w, h) => {
    ctx.fillStyle = shade(base, 0.7);
    ctx.fillRect(0, 0, w, h);
    for (let c = 0; c < 2; c++)
      for (let t = 0; t < 2; t++) {
        const x = (c * w) / 2 + 2;
        const y = (t * h) / 2 + 2;
        ctx.fillStyle = shade(base, 1 + (c - 0.5) * 0.04);
        ctx.fillRect(x, y, w / 2 - 4, h / 2 - 4);
        ctx.fillStyle = shade(base, 0.6);
        for (let v = 0; v < 5; v++) ctx.fillRect(x + 10, y + 10 + v * 6, w / 2 - 24, 2);
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(x + w / 2 - 14, y + h / 4 - 10, 4, 20);
      }
  });
}

/** The original tiger emblem (kit/emblem.js) as a texture. */
function emblemTex() {
  return tex(256, 256, (ctx) => drawEmblem(ctx), 41);
}

/** The US flag (public-domain design): 13 stripes, a blue canton with 50 stars. Tile = the whole flag. */
function usFlagTex() {
  return tex(760, 400, (ctx, w, h) => {
    const sh = h / 13;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#b22234';
      ctx.fillRect(0, i * sh, w, sh + 1);
    }
    const cw = w * 0.4;
    const ch = sh * 7;
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ffffff';
    const star = (x, y, r) => {
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? r * 0.4 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
    };
    // 9 rows alternating 6 and 5 stars
    for (let row = 0; row < 9; row++) {
      const n = row % 2 ? 5 : 6;
      for (let k = 0; k < n; k++) star((cw / 12) * (2 * k + 1 + (row % 2)), (ch / 10) * (row + 1), ch / 24);
    }
  }, 44);
}

/** Entrance sign band: gold field, black text (school name + MAIN ENTRANCE) [ENT]. Tile = whole sign. */
function signTex() {
  return tex(1024, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#cdb06a');
    g.addColorStop(1, '#b29452');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillRect(0, h - 4, w, 4);
    ctx.textAlign = 'center';
    ctx.font = '600 34px "Nunito", sans-serif';
    ctx.fillText('BENTONVILLE HIGH SCHOOL', w / 2, 48);
    ctx.font = '800 46px "Nunito", sans-serif';
    ctx.fillText('MAIN ENTRANCE', w / 2, 104);
  }, 42);
}

// ---------------------------------------------------------------- look table

/**
 * look -> { map: () => texture, tile: [u metres, v metres], color, shininess?, transparent?, opacity?,
 *           emissive? }. color multiplies the map (white for textures that carry their own colour).
 */
const LOOKS = {
  brick: { map: () => brickTex(PAL.brick, PAL.mortar, 11), tile: [1.6, 0.533] },
  brickBand: { map: () => brickTex(PAL.brickBand, PAL.mortar, 12, true), tile: [4.8, 0.2] },
  buffBrick: { map: () => brickTex(PAL.buffBrick, 0xb3aa9c, 13), tile: [1.6, 0.533] },
  buffStone: { map: () => paintTex(PAL.buffStone, 14, false), tile: [1.6, 0.8] },
  buffFascia: { map: () => paintTex(PAL.buffFascia, 15, false), tile: [1.6, 0.8] },
  cmuLight: { map: () => blockTex(PAL.cmuLight, 16), tile: [1.6, 0.8] },
  blockGrey: { map: () => blockTex(PAL.blockGrey, 17, false), tile: [1.6, 0.8] },
  metalWhite: { map: () => ribbedTex(PAL.metalWhite), tile: [1, 1.2], shininess: 40 },
  metalGrey: { map: () => panelTex(PAL.metalGrey, 18), tile: [3, 1.2], shininess: 30 },
  metalSilver: { map: () => ribbedTex(0xbfc5ca), tile: [1, 1.2], shininess: 55, specular: 0x555555 }, // the silver corner block [NOR]
  canopy: { color: PAL.canopy, shininess: 30, emissive: 0x3c3b38, emissiveIntensity: 1 }, // undersides read dark brown (QA)
  coping: { color: PAL.coping, shininess: 20 },
  alu: { color: PAL.alu, shininess: 60 },
  glass: { map: () => glassTex(), tile: [1.5, 2.4], color: BHS_GLASS.color, emissive: BHS_GLASS.emissive, emissiveIntensity: 1, shininess: BHS_GLASS.shininess, transparent: true, opacity: BHS_GLASS.opacity, specular: 0x888888 },
  paving: { map: () => pavingTex(PAL.paving, 19), tile: [3, 3] },
  roof: { map: () => roofTex(PAL.roof, 20), tile: [6, 6] },
  roofPad: { color: PAL.roofPad },
  wood: { map: () => woodBandTex(PAL.wood, 21), tile: [2.4, 1.2] },
  column: { color: PAL.column, shininess: 25 },
  terrazzo: { map: () => terrazzoTex(PAL.floorLight, 22), tile: [2, 2], shininess: 110, specular: 0x8a8a8a },
  terrazzoDark: { map: () => terrazzoTex(PAL.floorDark, 23), tile: [2, 2], shininess: 70, specular: 0x555555 },
  banner: { color: PAL.banner },
  libWall: { map: () => paintTex(PAL.libWall, 24, false), tile: [1.6, 0.8], emissive: 0x4a4a46, emissiveIntensity: 1 },
  libPier: { map: () => brickTex(PAL.libPier, 0x8f857a, 25), tile: [1.6, 0.533] },
  carpet: { map: () => carpetTex(PAL.carpet, 26), tile: [2, 2] },
  carpetBand: { map: () => carpetTex(PAL.carpetBand, 27), tile: [2, 2] },
  shelfWood: { color: PAL.shelfWood, shininess: 20 },
  shelfEnd: { color: PAL.shelfEnd },
  seat: { color: PAL.seat },
  stageWood: { map: () => woodBandTex(PAL.stageWood, 28), tile: [1.2, 2.4] },
  acoustic: { map: () => carpetTex(PAL.acoustic, 29), tile: [2, 2] },
  aacCeiling: { map: () => paintTex(PAL.aacCeiling, 30, false), tile: [2, 2], emissive: 0x3a3832, emissiveIntensity: 1 },
  valance: { color: PAL.valance },
  vct: { map: () => vctTex(PAL.vct, PAL.vctAccent, 31), tile: [2.4, 2.4], shininess: 35 },
  ceilingTile: { map: () => ceilingTex(PAL.ceilingTile, 32), tile: [2.4, 2.4], emissive: 0x55544f, emissiveIntensity: 1 },
  paint: { map: () => paintTex(PAL.paintWall, 33), tile: [1.6, 0.8] },
  doorWood: { color: PAL.doorWood, shininess: 25 },
  doorFrame: { color: PAL.doorFrame, shininess: 30 },
  locker: { map: () => lockerTex(PAL.locker), tile: [0.6, 1.8], shininess: 40 },
  base: { color: PAL.base },
  sillIn: { color: 0xd9d4c8 },
  slabEdge: { color: 0x9b9892 },
  stairTread: { map: () => terrazzoTex(PAL.floorLight, 34), tile: [2, 2], shininess: 50 },
  stairRiser: { color: 0x8f8a84 },
  stringer: { color: 0xc9c9c6, shininess: 30 },
  nosing: { color: 0x2d2d2d },
  railCap: { color: 0xc2c4c6, shininess: 60 },
  railGlass: { color: 0xbfd2d4, transparent: true, opacity: 0.28, shininess: 90 },
  picket: { color: 0x8d9092, shininess: 40 },
  fixture: { color: 0xffffff, emissive: 0xfff4de, emissiveIntensity: 0.9 },
  water: { color: 0x5f7e86, shininess: 100, transparent: true, opacity: 0.85, specular: 0x999999 },
  grass: { color: 0x6f8f4f },
  turf: { color: 0x5f8a45 },
  mulch: { color: 0x5a4636 },
  duct: { color: 0x5f7f9e, shininess: 50 },
  screen: { color: 0xdfe9f5, emissive: 0x9fc2e8, emissiveIntensity: 0.6 }, // monitors, smartboards, TVs
  woodFloor: { map: () => woodBandTex(0xb3814f, 43), tile: [2.4, 1.2], shininess: 35 },
  emblem: { map: () => emblemTex(), tile: 'box', transparent: true, alphaTest: 0.4 },
  signMain: { map: () => signTex(), tile: 'box' },
  usFlag: { map: () => usFlagTex(), tile: 'box' },
};

const cache = new Map();

/** The shared material for a look ('#rrggbb' = plain colour, 'none' = null). */
export function materialFor(look) {
  if (look === 'none') return null;
  if (cache.has(look)) return cache.get(look);
  let m;
  if (look === 'plain') {
    // all plain-colour props: white, coloured by their vertex colours (kit/meshes.js tintOf)
    m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  } else if (typeof look === 'string' && look[0] === '#') {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(look), vertexColors: true });
  } else {
    const L = LOOKS[look] || LOOKS.paint;
    const params = { vertexColors: true };
    if (L.map) {
      const t = L.map();
      if (L.tile === 'box') {
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      } else t.repeat.set(1 / L.tile[0], 1 / L.tile[1]);
      params.map = t;
      params.color = new THREE.Color(L.color ?? 0xffffff);
    } else params.color = new THREE.Color(L.color ?? 0xffffff);
    if (L.alphaTest) params.alphaTest = L.alphaTest;
    if (L.transparent && !L.alphaTest) {
      params.transparent = true;
      params.opacity = L.opacity;
      params.depthWrite = false;
      params.side = THREE.DoubleSide;
    }
    if (L.emissive) {
      params.emissive = new THREE.Color(L.emissive);
      params.emissiveIntensity = L.emissiveIntensity ?? 1;
    }
    m = L.shininess ? new THREE.MeshPhongMaterial({ ...params, shininess: L.shininess, specular: new THREE.Color(L.specular ?? 0x222222) }) : new THREE.MeshLambertMaterial(params);
  }
  m.name = 'bhs-' + look;
  cache.set(look, m);
  return m;
}

export const KNOWN_LOOKS = Object.freeze(Object.keys(LOOKS));

/** Looks whose texture spans each face once (UV 0..1 per face) instead of world metres. */
export const BOX_MAPPED = new Set(Object.keys(LOOKS).filter((k) => LOOKS[k].tile === 'box'));
