/**
 * BENTONVILLE ROYALE — minimap + full-map renderer (pure Canvas 2D, no three.js).
 *
 * World space: metres, x = east, z = SOUTH (north is -z). Headings are radians,
 * 0 = north, clockwise (east = PI/2). On every canvas +x is right and +z is down,
 * so north is up and nothing is mirrored.
 *
 * API
 * ---
 *   const mm = new Minimap({
 *     mapData,                  // parsed public/data/bentonville-osm.json
 *     miniCanvas, fullCanvas,   // HUD canvases; drawn at their backing-store size, never resized
 *     miniRadiusMeters = 140,   // world radius shown from the centre to the edge of the mini view
 *     rotate = false,           // false: north-up with a rotating arrow; true: heading-up (map rotates)
 *     miniHz = 24, fullHz = 12, // redraw ceilings (redraws are also skipped when nothing changed)
 *     fontFamily,               // CSS font-family for labels (defaults to the HUD's Nunito stack)
 *     blipRange,                // metres beyond which off-view 'chest'/'loot' blips are hidden
 *   });                         //   instead of clamped (default 3 x miniRadiusMeters)
 *
 *   mm.update(state)            // call every frame; throttles and dirty-checks internally
 *     state = {
 *       player: { x, z, heading },
 *       storm:  { cx, cz, r, nextCx, nextCz, nextR } | null,
 *       fullOpen: boolean,
 *       marker: { x, z } | null,
 *       route:  { ax, az, bx, bz } | null,   // Drop Bus flight line (full map only)
 *       bus:    { x, z, heading } | null,    // Drop Bus position on that line
 *       blips:  [{ x, z, kind }]      // optional; kind: 'chest' | 'loot' | 'enemy' | 'drop'
 *                                     //   | 'mate0'..'mate3' (teammate, slot colour) | 'mateDown' (knocked teammate)
 *                                     //   | 'van' / 'vanCd' (reboot van ready / recharging) | 'vanHot' (ready, while
 *                                     //   carrying a reboot card) | 'card' (teammate's reboot card)
 *                                     //   optional label: text drawn under the icon (full map; mini when on view)
 *     }
 *   mm.fullCanvasToWorld(px, py)      // full-canvas backing-store pixel -> { x, z, inBounds }
 *   mm.worldToFullCanvas(x, z)        // -> { px, py }
 *   mm.fullClientToWorld(cx, cy)      // convenience: MouseEvent clientX/Y -> { x, z, inBounds }
 *   mm.ready                          // boolean: static full-map layer finished
 *   mm.whenReady                      // Promise<Minimap>, resolves when `ready` flips to true
 *   mm.invalidate()                   // force both views to redraw on the next update()
 *   mm.dispose()
 *
 * How it draws
 * ------------
 * - Full map: the whole map is painted once into an offscreen canvas the size of the
 *   full-map canvas (world aspect kept, letterboxed). A second transparent layer holds
 *   landmark labels, the scale bar and the north indicator so they sit above the storm.
 * - Mini view: the map is cut into 512 px tiles at exactly the mini view's resolution
 *   (canvas px / (2 * radius), about 1.14 px/m). Tiles are painted lazily from a
 *   per-tile feature index, only around the player, and kept in a small cache, so the
 *   mini view is a handful of drawImage calls. Until a tile exists the same region is
 *   blitted (blurry) from the full-map layer.
 * - All painting outside update() runs in time-sliced idle callbacks (a few ms each),
 *   so neither startup nor walking into a new tile blocks a frame.
 */

import { DROP_ZONES } from '../core/config.js';

const TAU = Math.PI * 2;
const TILE_PX = 512;
const TILE_GUTTER = 1; // tiles overlap by this many px so rotated blits show no seams
const BATCH_FEATURES = 140;
const BATCH_VERTS = 2600;
const SLICE_MS = 5;
const DEFAULT_FONT = '"Nunito", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ---- palette: a bold battle-royale overview — saturated grass, dark woods, bright water,
// pale roofs that pop off the green, clean light roads, violet storm
const C = {
  outside: '#16324f',
  land: '#86c35a',
  border: '#0e151c',
  water: '#3fb4f0',
  waterEdge: '#1f86c4',
  tree: 'rgba(38, 104, 46, 0.6)',
  ink: '#1d2a36',
  halo: 'rgba(255, 255, 255, 0.94)',
  stormFill: 'rgba(116, 52, 214, 0.36)',
  stormEdge: '#c9a4ff',
  stormEdgeDark: 'rgba(52, 18, 110, 0.9)',
  nextRing: '#ffffff',
  nextRingDark: 'rgba(24, 20, 44, 0.55)',
  player: '#ffffff',
  playerEdge: '#16202b',
  marker: '#ff4f86',
  route: '#ffc21f',
  routeDark: 'rgba(29, 42, 54, 0.8)',
};
// areas, drawn in this order (water last so ponds inside parks/woods stay visible)
const AREA_KINDS = ['grass', 'park', 'garden', 'wood', 'pitch', 'parking', 'water', 'busloop'];
const AREA_FILL = ['#8fca5e', '#7dbd4f', '#94cf66', '#4f9a3f', '#6cc172', '#c7c2b2', C.water, '#c7c2b2'];
const AREA_EDGE = [null, null, null, '#3d7f31', '#4f9d57', '#a19c8a', C.waterEdge];
// buildings: wood, brick, metal, then the same three for landmark buildings
const MATS = { wood: 0, brick: 1, metal: 2 };
const BLD_FILL = ['#f1e6cf', '#eccfbf', '#e4e7ec', '#ffe08a', '#ffe08a', '#ffe08a'];
const BLD_EDGE = ['#6f5d43', '#7a5446', '#5b6470', '#8a6418', '#8a6418', '#8a6418'];
// roads by rank: 0 trail/footway, 1 pedestrian, 2 service, 3 minor, 4 mid, 5 major
const ROAD_RANK = {
  footway: 0, path: 0, cycleway: 0, track: 0, steps: 0,
  pedestrian: 1,
  service: 2,
  residential: 3, unclassified: 3, living_street: 3,
  secondary: 4, tertiary: 4, secondary_link: 4, tertiary_link: 4,
  motorway: 5, trunk: 5, primary: 5, motorway_link: 5, trunk_link: 5, primary_link: 5,
};
const ROAD_STYLE = [
  { fill: '#c9a46a', casing: null, minPx: 1.3, minOv: 0.75, alphaOv: 0.55 },
  { fill: '#ece6d6', casing: '#6f7a5c', minPx: 2, minOv: 0.9, alphaOv: 1 },
  { fill: '#e8e6dc', casing: '#6f7a5c', minPx: 1.6, minOv: 0.9, alphaOv: 0.9 },
  { fill: '#f7f5ee', casing: '#59654a', minPx: 2.6, minOv: 1.7, alphaOv: 1 },
  { fill: '#fbf8ef', casing: '#4d573f', minPx: 3.2, minOv: 2.6, alphaOv: 1 },
  { fill: '#fff6d8', casing: '#4a4535', minPx: 3.8, minOv: 3.4, alphaOv: 1 },
];
const BLIP_KINDS = ['chest', 'loot', 'enemy', 'drop', 'mate0', 'mate1', 'mate2', 'mate3', 'mateDown', 'pin0', 'pin1', 'pin2', 'pin3', 'ping0', 'ping1', 'ping2', 'ping3', 'pingEnemy', 'van', 'vanCd', 'vanHot', 'card', 'car'];
const MATE_COLORS = ['#ffc21f', '#5ec8ff', '#7dff6b', '#ff5d8f']; // = Teams.js TEAM_COLORS
/** Blips that stay pinned to the minimap edge at any distance. */
const isPinnedBlip = (kind, label) => kind === 'enemy' || kind === 'drop' || kind === 'card' || kind === 'vanHot' || (!!label && kind.startsWith('van')) || kind.startsWith('mate') || kind.startsWith('pin');
// full-map grid: lettered columns, numbered rows (call-outs like "C4"), square cells this wide
const GRID_M = 100; // metres
const LABEL_FONT = '"Lilita One", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
const DASH_GUIDE = [7, 6];
const DASH_NONE = [];

const hasDoc = typeof document !== 'undefined';
const nowMs = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function angleDelta(a, b) {
  let d = a - b;
  d -= TAU * Math.round(d / TAU);
  return d < 0 ? -d : d;
}

// ------------------------------------------------------------------ data packing

/**
 * Packs a list of `{ p: [[x,z],...] }` features into flat typed arrays, sorted by
 * (style key, width) so that features sharing a style are adjacent and can be
 * painted as one path.
 */
function packLayer(list, keyOf, widthOf) {
  const src = [];
  const keys = [];
  const widths = [];
  let total = 0;
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const p = f && f.p;
      if (!Array.isArray(p) || p.length < 2) continue;
      const k = keyOf(f);
      if (k < 0) continue;
      src.push(f);
      keys.push(k);
      widths.push(widthOf ? widthOf(f) : 0);
      total += p.length;
    }
  }
  const n = src.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => keys[a] - keys[b] || widths[a] - widths[b] || a - b);
  const L = {
    n,
    start: new Uint32Array(n + 1),
    xy: new Float32Array(total * 2),
    key: new Uint8Array(n),
    w: new Float32Array(n),
    bbox: new Float32Array(n * 4),
    tiles: null,
  };
  let v = 0;
  for (let o = 0; o < n; o++) {
    const i = order[o];
    const p = src[i].p;
    L.start[o] = v;
    L.key[o] = keys[i];
    L.w[o] = widths[i];
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let j = 0; j < p.length; j++) {
      const x = +p[j][0];
      const z = +p[j][1];
      L.xy[v * 2] = x;
      L.xy[v * 2 + 1] = z;
      v++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    L.bbox[o * 4] = x0;
    L.bbox[o * 4 + 1] = z0;
    L.bbox[o * 4 + 2] = x1;
    L.bbox[o * 4 + 3] = z1;
  }
  L.start[n] = v;
  return L;
}

function packPoints(list) {
  const n = Array.isArray(list) ? list.length : 0;
  const xy = new Float32Array(n * 2);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const t = list[i];
    if (!t || !Number.isFinite(t[0]) || !Number.isFinite(t[1])) continue;
    xy[m * 2] = t[0];
    xy[m * 2 + 1] = t[1];
    m++;
  }
  return { n: m, xy, tiles: null };
}

// ------------------------------------------------------------------ map painting

/** End (exclusive) of the batch starting at `pos`: same style key (and width), bounded size. */
function batchEnd(L, sel, pos, n, sameWidth) {
  const first = sel ? sel[pos] : pos;
  const key = L.key[first];
  const w = L.w[first];
  let verts = 0;
  let end = pos;
  while (end < n && end - pos < BATCH_FEATURES && verts < BATCH_VERTS) {
    const i = sel ? sel[end] : end;
    if (L.key[i] !== key || (sameWidth && L.w[i] !== w)) break;
    verts += L.start[i + 1] - L.start[i];
    end++;
  }
  return end;
}

/** Adds features [pos, end) to the current path. `minStep` (px) drops vertices that would not be visible. */
function trace(ctx, L, sel, pos, end, s, ox, oz, closed, minStep) {
  const xy = L.xy;
  const start = L.start;
  for (let q = pos; q < end; q++) {
    const i = sel ? sel[q] : q;
    const a = start[i];
    const b = start[i + 1];
    let lx = xy[a * 2] * s + ox;
    let ly = xy[a * 2 + 1] * s + oz;
    ctx.moveTo(lx, ly);
    for (let j = a + 1; j < b; j++) {
      const x = xy[j * 2] * s + ox;
      const y = xy[j * 2 + 1] * s + oz;
      if (minStep > 0 && j < b - 1) {
        const dx = x - lx;
        const dy = y - ly;
        if ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) < minStep) continue;
      }
      ctx.lineTo(x, y);
      lx = x;
      ly = y;
    }
    if (closed) ctx.closePath();
  }
}

/**
 * Paints the vector map. A generator so the caller can time-slice it: it yields
 * after every batch of features.
 *   T   = { s, ox, oz }: canvas px = world * s + offset
 *   sel = null (everything) or { areas, water, roads, buildings, trees }: per-layer index lists
 *   k   = UI scale (1 at the reference canvas size)
 */
function* paintMap(ctx, D, T, sel, k) {
  const s = T.s;
  const ox = T.ox;
  const oz = T.oz;
  const detail = s >= 0.5; // tile zoom vs whole-map overview
  const minStep = detail ? 0 : 0.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(DASH_NONE);
  ctx.globalAlpha = 1;

  // -- land cover
  {
    const L = D.areas;
    const S = sel ? sel.areas : null;
    const n = S ? S.length : L.n;
    for (let pos = 0; pos < n; ) {
      const end = batchEnd(L, S, pos, n, false);
      const key = L.key[S ? S[pos] : pos];
      ctx.beginPath();
      trace(ctx, L, S, pos, end, s, ox, oz, true, minStep);
      ctx.fillStyle = AREA_FILL[key];
      ctx.fill();
      if (AREA_EDGE[key] && (detail || key === 6)) {
        ctx.strokeStyle = AREA_EDGE[key];
        ctx.lineWidth = (detail ? 1.2 : 0.7) * k;
        ctx.stroke();
      }
      pos = end;
      yield;
    }
  }

  // -- streams
  {
    const L = D.water;
    const S = sel ? sel.water : null;
    const n = S ? S.length : L.n;
    ctx.strokeStyle = C.water;
    for (let pos = 0; pos < n; ) {
      const end = batchEnd(L, S, pos, n, false);
      const key = L.key[S ? S[pos] : pos];
      ctx.beginPath();
      trace(ctx, L, S, pos, end, s, ox, oz, false, minStep);
      ctx.lineWidth = Math.max((detail ? 1.6 : 1.1) * k, (key ? 7 : 2.6) * s);
      ctx.stroke();
      pos = end;
      yield;
    }
  }

  // -- single trees (tile zoom only)
  if (detail) {
    const L = D.trees;
    const S = sel ? sel.trees : null;
    const n = S ? S.length : L.n;
    const r = Math.max(1.6 * k, 2.4 * s);
    ctx.fillStyle = C.tree;
    for (let pos = 0; pos < n; ) {
      const end = Math.min(n, pos + 300);
      ctx.beginPath();
      for (let q = pos; q < end; q++) {
        const i = S ? S[q] : q;
        const x = L.xy[i * 2] * s + ox;
        const y = L.xy[i * 2 + 1] * s + oz;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fill();
      pos = end;
      yield;
    }
  }

  // -- roads: every casing first, then every fill, minor classes under major ones
  {
    const L = D.roads;
    const S = sel ? sel.roads : null;
    const n = S ? S.length : L.n;
    for (let pass = 0; pass < 2; pass++) {
      for (let pos = 0; pos < n; ) {
        const end = batchEnd(L, S, pos, n, true);
        const first = S ? S[pos] : pos;
        const rank = L.key[first];
        const st = ROAD_STYLE[rank];
        const wpx = Math.max((detail ? st.minPx : st.minOv) * k, L.w[first] * s);
        let draw = true;
        if (pass === 0) {
          if (!st.casing || (!detail && rank < 3)) draw = false;
          else {
            ctx.strokeStyle = st.casing;
            ctx.lineWidth = wpx + (detail ? 2.2 : rank >= 4 ? 1.5 : 1.1) * k;
            ctx.globalAlpha = detail ? 1 : rank >= 4 ? 0.95 : 0.6;
          }
        } else {
          ctx.strokeStyle = st.fill;
          ctx.lineWidth = wpx;
          ctx.globalAlpha = detail ? 1 : st.alphaOv;
        }
        if (draw) {
          ctx.beginPath();
          trace(ctx, L, S, pos, end, s, ox, oz, false, minStep);
          ctx.stroke();
        }
        pos = end;
        if (draw) yield;
      }
    }
    ctx.globalAlpha = 1;
  }

  // -- buildings
  {
    const L = D.buildings;
    const S = sel ? sel.buildings : null;
    const n = S ? S.length : L.n;
    for (let pos = 0; pos < n; ) {
      const end = batchEnd(L, S, pos, n, false);
      const key = L.key[S ? S[pos] : pos];
      ctx.beginPath();
      trace(ctx, L, S, pos, end, s, ox, oz, true, detail ? 0 : 0.35);
      ctx.fillStyle = BLD_FILL[key];
      ctx.fill();
      ctx.strokeStyle = BLD_EDGE[key];
      ctx.lineWidth = (detail ? 1 : 0.45) * k;
      ctx.stroke();
      pos = end;
      yield;
    }
  }
}

// ------------------------------------------------------------------ small drawing helpers

function haloText(ctx, text, x, y, fill, halo, lw) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Pre-rendered icon: { c: canvas, w, h, ax, ay } with (ax, ay) the anchor inside the sprite. */
function makeSprite(w, h, ax, ay, draw) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  return { c, w: c.width, h: c.height, ax, ay };
}

function makeBlipSprites(k) {
  const edge = '#17212c';
  const out = {};
  // chest: amber crate with a lid line
  out.chest = makeSprite(16 * k, 14 * k, 8 * k, 7 * k, (g) => {
    g.fillStyle = '#ffc93c';
    g.strokeStyle = edge;
    g.lineWidth = 1.6 * k;
    g.beginPath();
    g.rect(2 * k, 2.5 * k, 12 * k, 9 * k);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(2 * k, 6 * k);
    g.lineTo(14 * k, 6 * k);
    g.stroke();
  });
  // loot: small mint diamond
  out.loot = makeSprite(12 * k, 12 * k, 6 * k, 6 * k, (g) => {
    g.fillStyle = '#5ff0b0';
    g.strokeStyle = edge;
    g.lineWidth = 1.5 * k;
    g.beginPath();
    g.moveTo(6 * k, 1.5 * k);
    g.lineTo(10.5 * k, 6 * k);
    g.lineTo(6 * k, 10.5 * k);
    g.lineTo(1.5 * k, 6 * k);
    g.closePath();
    g.fill();
    g.stroke();
  });
  // enemy: red dot with a light ring
  out.enemy = makeSprite(14 * k, 14 * k, 7 * k, 7 * k, (g) => {
    g.fillStyle = '#ff4338';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.6 * k;
    g.beginPath();
    g.arc(7 * k, 7 * k, 4.6 * k, 0, TAU);
    g.fill();
    g.stroke();
  });
  // reboot van: a cyan rounded square with a white "R" (grey while recharging)
  for (const [key, col] of [['van', '#38e1ff'], ['vanCd', '#8a96a3'], ['vanHot', '#7dff6b']]) {
    out[key] = makeSprite(24 * k, 24 * k, 12 * k, 12 * k, (g) => {
      g.fillStyle = col;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.6 * k;
      g.beginPath();
      if (g.roundRect) g.roundRect(2.5 * k, 2.5 * k, 19 * k, 19 * k, 5 * k);
      else g.rect(2.5 * k, 2.5 * k, 19 * k, 19 * k);
      g.fill();
      g.stroke();
      g.strokeStyle = edge;
      g.lineWidth = 1.2 * k;
      g.stroke();
      g.fillStyle = edge;
      g.font = `900 ${13 * k}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('R', 12 * k, 12.8 * k);
    });
  }
  // drivable car: a little white car seen from above
  out.car = makeSprite(14 * k, 20 * k, 7 * k, 10 * k, (g) => {
    g.fillStyle = '#f4f1e6';
    g.strokeStyle = edge;
    g.lineWidth = 1.8 * k;
    g.beginPath();
    if (g.roundRect) g.roundRect(2 * k, 2 * k, 10 * k, 16 * k, 3.5 * k);
    else g.rect(2 * k, 2 * k, 10 * k, 16 * k);
    g.fill();
    g.stroke();
    g.fillStyle = '#5ec8ff';
    g.fillRect(3.6 * k, 5 * k, 6.8 * k, 3 * k);
    g.fillRect(3.6 * k, 12.5 * k, 6.8 * k, 2.4 * k);
  });
  // reboot card: a small cyan card
  out.card = makeSprite(12 * k, 16 * k, 6 * k, 8 * k, (g) => {
    g.fillStyle = '#38e1ff';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.6 * k;
    g.beginPath();
    g.rect(2 * k, 2 * k, 8 * k, 12 * k);
    g.fill();
    g.stroke();
  });
  // teammates: a slot-coloured dot with an ink edge; knocked: a red dot with a white cross
  MATE_COLORS.forEach((col, i) => {
    out['mate' + i] = makeSprite(16 * k, 16 * k, 8 * k, 8 * k, (g) => {
      g.fillStyle = col;
      g.strokeStyle = edge;
      g.lineWidth = 2.2 * k;
      g.beginPath();
      g.arc(8 * k, 8 * k, 5.6 * k, 0, TAU);
      g.fill();
      g.stroke();
    });
  });
  out.mateDown = makeSprite(16 * k, 16 * k, 8 * k, 8 * k, (g) => {
    g.fillStyle = '#ff3b3b';
    g.strokeStyle = edge;
    g.lineWidth = 2.2 * k;
    g.beginPath();
    g.arc(8 * k, 8 * k, 5.6 * k, 0, TAU);
    g.fill();
    g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.8 * k;
    g.beginPath();
    g.moveTo(8 * k, 4.8 * k);
    g.lineTo(8 * k, 11.2 * k);
    g.moveTo(4.8 * k, 8 * k);
    g.lineTo(11.2 * k, 8 * k);
    g.stroke();
  });
  // drop: sky-blue canopy over a small crate
  out.drop = makeSprite(20 * k, 22 * k, 10 * k, 12 * k, (g) => {
    g.strokeStyle = edge;
    g.lineWidth = 1.6 * k;
    g.fillStyle = '#4fc3ff';
    g.beginPath();
    g.arc(10 * k, 9.5 * k, 7.5 * k, Math.PI, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(3.2 * k, 9.5 * k);
    g.lineTo(8 * k, 15 * k);
    g.moveTo(16.8 * k, 9.5 * k);
    g.lineTo(12 * k, 15 * k);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.rect(7 * k, 14.5 * k, 6 * k, 5.5 * k);
    g.fill();
    g.stroke();
  });
  // teammates' map markers (pins in their slot colour) and pings (a diamond; red for enemies)
  const pin = (col) =>
    makeSprite(20 * k, 27 * k, 10 * k, 25 * k, (g) => {
      g.fillStyle = col;
      g.strokeStyle = edge;
      g.lineWidth = 2.2 * k;
      g.beginPath();
      g.moveTo(10 * k, 25 * k);
      g.bezierCurveTo(3 * k, 17 * k, 2.5 * k, 13.5 * k, 2.5 * k, 10 * k);
      g.arc(10 * k, 10 * k, 7.5 * k, Math.PI, 0);
      g.bezierCurveTo(17.5 * k, 13.5 * k, 17 * k, 17 * k, 10 * k, 25 * k);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(10 * k, 10 * k, 2.8 * k, 0, TAU);
      g.fill();
    });
  const ping = (col) =>
    makeSprite(18 * k, 18 * k, 9 * k, 9 * k, (g) => {
      g.fillStyle = col;
      g.strokeStyle = edge;
      g.lineWidth = 2 * k;
      g.beginPath();
      g.moveTo(9 * k, 1.5 * k);
      g.lineTo(16.5 * k, 9 * k);
      g.lineTo(9 * k, 16.5 * k);
      g.lineTo(1.5 * k, 9 * k);
      g.closePath();
      g.fill();
      g.stroke();
    });
  MATE_COLORS.forEach((col, i) => {
    out['pin' + i] = pin(col);
    out['ping' + i] = ping(col);
  });
  out.pingEnemy = ping('#ff3b3b');
  // waypoint pin, anchored at its tip
  out.marker = makeSprite(20 * k, 27 * k, 10 * k, 25 * k, (g) => {
    g.fillStyle = C.marker;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(10 * k, 25 * k);
    g.bezierCurveTo(3 * k, 17 * k, 2.5 * k, 13.5 * k, 2.5 * k, 10 * k);
    g.arc(10 * k, 10 * k, 7.5 * k, Math.PI, 0);
    g.bezierCurveTo(17.5 * k, 13.5 * k, 17 * k, 17 * k, 10 * k, 25 * k);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(10 * k, 10 * k, 2.8 * k, 0, TAU);
    g.fill();
  });
  return out;
}

/** Text sprite with a halo (used for upright labels on the mini view). */
function makeTextSprite(lines, font, sizePx, lineH, haloW) {
  const probe = makeCanvas(4, 4).getContext('2d');
  probe.font = font;
  let w = 0;
  for (const ln of lines) w = Math.max(w, probe.measureText(ln).width);
  const pad = Math.ceil(haloW) + 2;
  const cw = Math.ceil(w) + pad * 2;
  const ch = Math.ceil(lineH * lines.length) + pad * 2;
  return makeSprite(cw, ch, cw / 2, ch, (g) => {
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < lines.length; i++) haloText(g, lines[i], cw / 2, pad + lineH * (i + 0.5), '#ffffff', '#13202c', haloW);
  });
}

// ------------------------------------------------------------------ Minimap

export class Minimap {
  constructor({
    mapData,
    miniCanvas = null,
    fullCanvas = null,
    miniRadiusMeters = 140,
    rotate = false,
    miniHz = 24,
    fullHz = 12,
    fontFamily = DEFAULT_FONT,
    blipRange = null,
  } = {}) {
    this.ready = false;
    this._resolveReady = null;
    this.whenReady = new Promise((res) => {
      this._resolveReady = res;
    });

    this._map = mapData || {};
    this._mini = miniCanvas;
    this._full = fullCanvas;
    this._mctx = miniCanvas ? miniCanvas.getContext('2d') : null;
    this._fctx = fullCanvas ? fullCanvas.getContext('2d') : null;
    this._radius = miniRadiusMeters > 1 ? miniRadiusMeters : 140;
    this._rotate = !!rotate;
    this._miniInterval = 1000 / clamp(miniHz || 24, 1, 240) - 2;
    this._fullInterval = 1000 / clamp(fullHz || 12, 1, 240) - 2;
    this._font = fontFamily || DEFAULT_FONT;
    // labels use the display font: redraw them once it has loaded
    if (hasDoc && document.fonts && document.fonts.load) {
      document.fonts
        .load(`24px ${LABEL_FONT}`)
        .then(() => {
          if (this._disposed) return;
          this._buildMiniSprites();
          if (this.ready) this._buildOverlay();
          this.invalidate();
        })
        .catch(() => {});
    }
    this._blipRange = blipRange > 0 ? blipRange : this._radius * 3;
    this._disposed = false;

    this._bounds = this._readBounds();
    this._landmarks = this._readLandmarks();

    // scratch outputs of _toMini / _toFull (no allocation in the hot path)
    this._sx = 0;
    this._sy = 0;
    this._clamped = false;

    // packed data (filled by the prep job)
    this._data = null;
    this._prepped = false;

    // full view
    this._fw = 0;
    this._fh = 0;
    this._fs = 1;
    this._fox = 0;
    this._foz = 0;
    this._fk = 1;
    this._static = null; // offscreen: painted map
    this._sctx = null;
    this._staticStarted = false;
    this._overlay = null; // offscreen: labels, scale bar, north indicator
    this._fullSprites = null;
    this._fullT = -1e9;
    this._fullWasOpen = false;
    this._fullForce = true;
    this._fSnap = new Float64Array(14);
    this._fBlipHash = 0;

    // mini view
    this._mw = 0;
    this._mh = 0;
    this._ppm = 1;
    this._mk = 1;
    this._tw = 1; // tile size in metres
    this._cols = 0;
    this._rows = 0;
    this._ring = 1;
    this._tileCap = 16;
    this._tiles = new Map(); // key -> { key, i, j, canvas, ctx, ready }
    this._tilePool = [];
    this._miniSprites = null;
    this._labelSprites = null;
    this._northSprite = null;
    this._miniT = -1e9;
    this._miniForce = true;
    this._mSnap = new Float64Array(14);
    this._mBlipHash = 0;
    this._mVersion = -1;
    this._version = 0; // bumped whenever a layer or tile gains content
    this._mcx = 0;
    this._mcz = 0;
    this._mcos = 1;
    this._msin = 0;
    this._pti = -999;
    this._ptj = -999;
    this._lastPrefetch = -1;
    this._distText = '';
    this._distValue = -1;

    // job scheduler
    this._jobs = [];
    this._scheduled = false;
    this._idleId = 0;
    this._timerId = 0;
    this._tick = this._tick.bind(this);
    this._hasIdle = typeof requestIdleCallback === 'function';
    this._layoutFull();
    this._layoutMini();
    this._addJob(-1, this._prepJob(), null);
    this._startStatic();

    // labels are drawn with the HUD font; redo them once web fonts finish loading
    if (hasDoc && document.fonts && document.fonts.status !== 'loaded' && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (this._disposed) return;
        this._buildOverlay();
        this._buildMiniSprites();
        this.invalidate();
      });
    }
  }

  // ---------------------------------------------------------------- public API

  update(state) {
    if (this._disposed || !state) return;
    const p = state.player;
    if (!p || !(p.x === p.x) || !(p.z === p.z)) return;
    const t = nowMs();
    if (this._mctx && t - this._miniT >= this._miniInterval) {
      if (this._mini.width !== this._mw || this._mini.height !== this._mh) this._layoutMini();
      if (this._miniChanged(state)) {
        this._miniT = t;
        this._drawMini(state);
      }
    }
    if (state.fullOpen) {
      if (this._fctx) {
        const opened = !this._fullWasOpen;
        if (opened || t - this._fullT >= this._fullInterval) {
          if (this._full.width !== this._fw || this._full.height !== this._fh) {
            this._layoutFull();
            this._startStatic();
          }
          if (opened || this._fullChanged(state)) {
            this._fullT = t;
            this._drawFull(state);
          }
        }
      }
      this._fullWasOpen = true;
    } else this._fullWasOpen = false;
  }

  /** Full-map canvas backing-store pixel -> world metres. */
  fullCanvasToWorld(px, py) {
    const x = (px - this._fox) / this._fs;
    const z = (py - this._foz) / this._fs;
    const b = this._bounds;
    return { x, z, inBounds: x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ };
  }

  /** World metres -> full-map canvas backing-store pixel. */
  worldToFullCanvas(x, z) {
    return { px: x * this._fs + this._fox, py: z * this._fs + this._foz };
  }

  /** MouseEvent clientX/clientY over the full-map canvas -> world metres (handles CSS scaling). */
  fullClientToWorld(clientX, clientY) {
    const c = this._full;
    if (!c || !c.getBoundingClientRect) return this.fullCanvasToWorld(clientX, clientY);
    const r = c.getBoundingClientRect();
    // content box only (the canvas has a CSS border); clientLeft/Top = border widths in
    // layout px, scaled by any CSS transform on the frame (rect / offset size)
    const sx = c.offsetWidth ? r.width / c.offsetWidth : 1;
    const sy = c.offsetHeight ? r.height / c.offsetHeight : 1;
    const bl = (c.clientLeft || 0) * sx;
    const bt = (c.clientTop || 0) * sy;
    const w = (c.clientWidth ? c.clientWidth * sx : r.width) || 1;
    const h = (c.clientHeight ? c.clientHeight * sy : r.height) || 1;
    return this.fullCanvasToWorld(((clientX - r.left - bl) / w) * c.width, ((clientY - r.top - bt) / h) * c.height);
  }

  invalidate() {
    this._miniForce = true;
    this._fullForce = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(this._idleId);
    if (this._timerId) clearTimeout(this._timerId);
    this._jobs.length = 0;
    for (const t of this._tiles.values()) t.canvas.width = t.canvas.height = 1;
    for (const t of this._tilePool) t.canvas.width = t.canvas.height = 1;
    this._tiles.clear();
    this._tilePool.length = 0;
    if (this._static) this._static.width = this._static.height = 1;
    if (this._overlay) this._overlay.width = this._overlay.height = 1;
    this._static = this._overlay = this._sctx = null;
    this._data = null;
    this._map = null;
    this._miniSprites = this._fullSprites = this._labelSprites = this._northSprite = null;
    this._mctx = this._fctx = this._mini = this._full = null;
  }

  // ---------------------------------------------------------------- setup

  _readBounds() {
    const m = this._map.meta && this._map.meta.bounds;
    if (m && m.maxX > m.minX && m.maxZ > m.minZ) return { minX: +m.minX, maxX: +m.maxX, minZ: +m.minZ, maxZ: +m.maxZ };
    // no usable meta: scan the geometry
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const name of ['buildings', 'roads', 'areas', 'waterways']) {
      const list = this._map[name];
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (!f || !Array.isArray(f.p)) continue;
        for (const q of f.p) {
          if (q[0] < b.minX) b.minX = q[0];
          if (q[0] > b.maxX) b.maxX = q[0];
          if (q[1] < b.minZ) b.minZ = q[1];
          if (q[1] > b.maxZ) b.maxZ = q[1];
        }
      }
    }
    if (!(b.maxX > b.minX) || !(b.maxZ > b.minZ)) return { minX: -500, maxX: 500, minZ: -500, maxZ: 500 };
    return b;
  }

  _readLandmarks() {
    const out = [];
    const lm = this._map.landmarks;
    if (lm && typeof lm === 'object') {
      for (const key of Object.keys(lm)) {
        const l = lm[key];
        if (!l || !l.n || !Number.isFinite(l.x) || !Number.isFinite(l.z)) continue;
        out.push({ key, n: String(l.n), x: l.x, z: l.z, r: l.r || 0, ids: Array.isArray(l.ids) ? l.ids : [], sprite: null });
      }
    }
    // Drop zones first: full-map labels are placed greedily in this order, and on the
    // expanded map the downtown landmarks sit a few pixels apart, so the named POIs
    // must claim their label space before the minor landmarks around them.
    const rank = (k) => {
      const i = DROP_ZONES.findIndex((z) => z.key === k);
      return i < 0 ? DROP_ZONES.length : i;
    };
    out.sort((a, b) => rank(a.key) - rank(b.key));
    return out;
  }

  _layoutFull() {
    const c = this._full;
    if (!c) return;
    const W = (this._fw = c.width);
    const H = (this._fh = c.height);
    const b = this._bounds;
    const k = (this._fk = Math.min(W, H) / 1024);
    const pad = Math.round(10 * k);
    const s = Math.min((W - pad * 2) / (b.maxX - b.minX), (H - pad * 2) / (b.maxZ - b.minZ));
    this._fs = s;
    this._fox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
    this._foz = (H - (b.maxZ - b.minZ) * s) / 2 - b.minZ * s;
    this._fullSprites = makeBlipSprites(k);
    this._fullForce = true;
  }

  _layoutMini() {
    const c = this._mini;
    if (!c) return;
    const W = (this._mw = c.width);
    this._mh = c.height;
    const b = this._bounds;
    this._ppm = W / (2 * this._radius);
    this._mk = W / 320;
    this._tw = TILE_PX / this._ppm;
    this._cols = Math.max(1, Math.ceil((b.maxX - b.minX) / this._tw));
    this._rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / this._tw));
    // world half-extent that must be covered (the corners matter when the view rotates)
    const half = Math.max(W, c.height) / 2 / this._ppm;
    this._ext = this._rotate ? half * Math.SQRT2 : half;
    this._ring = Math.max(1, Math.ceil(this._ext / this._tw));
    this._tileCap = (2 * this._ring + 1) * (2 * this._ring + 1) + 7;
    // any existing tiles are at the wrong resolution now
    for (const t of this._tiles.values()) this._tilePool.push(t);
    this._tiles.clear();
    for (let i = this._jobs.length - 1; i >= 0; i--) if (this._jobs[i].tile) this._jobs.splice(i, 1);
    this._lastPrefetch = -1;
    if (this._prepped) this._buildTileIndex();
    this._miniSprites = makeBlipSprites(this._mk);
    this._buildMiniSprites();
    this._miniForce = true;
  }

  _buildMiniSprites() {
    if (!this._mini) return;
    const k = this._mk;
    const size = Math.round(12 * k);
    const font = `400 ${size}px ${LABEL_FONT}`;
    for (const l of this._landmarks) l.sprite = makeTextSprite(wrapWords(l.n.toUpperCase(), 18), font, size, Math.round(size * 1.08), 3.6 * k);
    // "N" badge for the heading-up variant
    const d = Math.round(18 * k);
    this._northSprite = makeSprite(d, d, d / 2, d / 2, (g) => {
      g.fillStyle = 'rgba(22, 32, 43, 0.88)';
      g.beginPath();
      g.arc(d / 2, d / 2, d / 2 - 1, 0, TAU);
      g.fill();
      g.font = `900 ${Math.round(11 * k)}px ${this._font}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.fillText('N', d / 2, d / 2 + 0.5 * k);
    });
  }

  // ---------------------------------------------------------------- job scheduler

  _addJob(priority, gen, tile) {
    const job = { priority, gen, tile, started: false };
    const jobs = this._jobs;
    let i = jobs.length;
    while (i > 0 && jobs[i - 1].priority > priority) i--;
    jobs.splice(i, 0, job);
    this._schedule();
    return job;
  }

  _schedule() {
    if (this._scheduled || this._disposed || !this._jobs.length) return;
    this._scheduled = true;
    if (this._hasIdle) this._idleId = requestIdleCallback(this._tick, { timeout: 80 });
    else this._timerId = setTimeout(this._tick, 4);
  }

  _tick(deadline) {
    this._scheduled = false;
    this._idleId = this._timerId = 0;
    if (this._disposed) return;
    let budget = SLICE_MS;
    if (deadline && typeof deadline.timeRemaining === 'function' && !deadline.didTimeout) {
      budget = clamp(deadline.timeRemaining() - 1, 2, 8);
    }
    const t0 = nowMs();
    const jobs = this._jobs;
    while (jobs.length) {
      const job = jobs[0];
      if (job.tile && !job.started && this._tileIsStale(job.tile)) {
        jobs.shift();
        this._tiles.delete(job.tile.key);
        this._tilePool.push(job.tile);
        continue;
      }
      job.started = true;
      let done;
      try {
        done = job.gen.next().done;
      } catch (err) {
        done = true;
        if (typeof console !== 'undefined') console.error('[Minimap] render job failed', err);
      }
      if (done) {
        const idx = jobs.indexOf(job);
        if (idx >= 0) jobs.splice(idx, 1);
      }
      if (nowMs() - t0 >= budget) break;
    }
    this._schedule();
  }

  // ---------------------------------------------------------------- data prep

  *_prepJob() {
    const map = this._map;
    const lmIds = new Set();
    for (const l of this._landmarks) for (const id of l.ids) lmIds.add(id);
    const D = {};
    D.areas = packLayer(map.areas, (f) => AREA_KINDS.indexOf(f.k), null);
    yield;
    D.water = packLayer(map.waterways, (f) => (f.k === 'river' || f.k === 'canal' ? 1 : 0), null);
    yield;
    D.roads = packLayer(
      map.roads,
      (f) => (f.k in ROAD_RANK ? ROAD_RANK[f.k] : 3),
      (f) => (f.w > 0 ? +f.w : 6),
    );
    yield;
    D.buildings = packLayer(map.buildings, (f) => (MATS[f.mat] || 0) + (lmIds.has(f.id) ? 3 : 0), null);
    yield;
    D.trees = packPoints(map.trees);
    this._data = D;
    yield;
    this._buildTileIndex();
    this._prepped = true;
    this._miniForce = true;
    this._version++;
  }

  /** Per-tile feature index lists (in style order, so tiles batch the same way the full map does). */
  _buildTileIndex() {
    const D = this._data;
    if (!D || !this._mini) return;
    const cols = this._cols;
    const rows = this._rows;
    const tw = this._tw;
    const gx = this._bounds.minX;
    const gz = this._bounds.minZ;
    const px = 1 / this._ppm;
    const index = (L, padOf) => {
      const tiles = new Array(cols * rows).fill(null);
      for (let f = 0; f < L.n; f++) {
        const pad = padOf(f);
        const i0 = clamp(Math.floor((L.bbox[f * 4] - pad - gx) / tw), 0, cols - 1);
        const j0 = clamp(Math.floor((L.bbox[f * 4 + 1] - pad - gz) / tw), 0, rows - 1);
        const i1 = clamp(Math.floor((L.bbox[f * 4 + 2] + pad - gx) / tw), 0, cols - 1);
        const j1 = clamp(Math.floor((L.bbox[f * 4 + 3] + pad - gz) / tw), 0, rows - 1);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = j * cols + i;
            (tiles[key] || (tiles[key] = [])).push(f);
          }
        }
      }
      L.tiles = tiles;
    };
    const flat = () => 4 * px;
    index(D.areas, flat);
    index(D.water, () => 6 * px + 4);
    index(D.roads, (f) => D.roads.w[f] / 2 + 5 * px);
    index(D.buildings, flat);
    // trees are points
    const T = D.trees;
    const tiles = new Array(cols * rows).fill(null);
    const pad = 4 * px + 3;
    for (let f = 0; f < T.n; f++) {
      const x = T.xy[f * 2];
      const z = T.xy[f * 2 + 1];
      const i0 = clamp(Math.floor((x - pad - gx) / tw), 0, cols - 1);
      const i1 = clamp(Math.floor((x + pad - gx) / tw), 0, cols - 1);
      const j0 = clamp(Math.floor((z - pad - gz) / tw), 0, rows - 1);
      const j1 = clamp(Math.floor((z + pad - gz) / tw), 0, rows - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (tiles[j * cols + i] || (tiles[j * cols + i] = [])).push(f);
    }
    T.tiles = tiles;
  }

  // ---------------------------------------------------------------- full-map static layers

  _startStatic() {
    if (!this._full) {
      // no full-map canvas: "ready" just means the data is indexed
      this._addJob(1, this._readyJob(), null);
      return;
    }
    for (let i = this._jobs.length - 1; i >= 0; i--) if (this._jobs[i].isStatic) this._jobs.splice(i, 1);
    const W = this._fw;
    const H = this._fh;
    if (!this._static || this._static.width !== W || this._static.height !== H) {
      this._static = makeCanvas(W, H);
      this._sctx = this._static.getContext('2d', { alpha: false });
      this._overlay = makeCanvas(W, H);
    }
    this._staticStarted = false;
    this._addJob(1, this._staticJob(), null).isStatic = true;
  }

  *_readyJob() {
    while (!this._prepped) yield;
    this._markReady();
  }

  _markReady() {
    this._version++;
    this.invalidate();
    if (!this.ready) {
      this.ready = true;
      this._resolveReady(this);
    }
  }

  *_staticJob() {
    while (!this._prepped) yield;
    const ctx = this._sctx;
    const b = this._bounds;
    const s = this._fs;
    const k = this._fk;
    const x0 = b.minX * s + this._fox;
    const y0 = b.minZ * s + this._foz;
    const w = (b.maxX - b.minX) * s;
    const h = (b.maxZ - b.minZ) * s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, this._fw, this._fh);
    ctx.fillStyle = C.land;
    ctx.fillRect(x0, y0, w, h);
    this._staticStarted = true;
    this._version++;
    yield;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    const T = { s, ox: this._fox, oz: this._foz };
    let step = 0;
    for (const _ of paintMap(ctx, this._data, T, null, k)) {
      if ((++step & 7) === 0) this._version++; // lets an open full map / mini placeholder fill in progressively
      yield;
    }
    ctx.restore();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2 * k;
    ctx.strokeRect(x0, y0, w, h);
    yield;
    this._buildOverlay();
    this._markReady();
  }

  /** Transparent layer above the storm: landmark labels, scale bar, north indicator. */
  _buildOverlay() {
    const c = this._overlay;
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = this._fw;
    const H = this._fh;
    const k = this._fk;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // ---- call-out grid: square GRID_M-metre cells centred on the map (letters across, numbers
    // down), drawn faintly so it never competes with roads and names
    const b = this._bounds;
    const gx0 = b.minX * this._fs + this._fox;
    const gy0 = b.minZ * this._fs + this._foz;
    const gw = (b.maxX - b.minX) * this._fs;
    const gh = (b.maxZ - b.minZ) * this._fs;
    const cell = GRID_M * this._fs; // one cell in canvas pixels (same both ways: square)
    const cols = Math.max(1, Math.round((b.maxX - b.minX) / GRID_M));
    const rows = Math.max(1, Math.round((b.maxZ - b.minZ) / GRID_M));
    const ox0 = gx0 + (gw - cols * cell) / 2;
    const oy0 = gy0 + (gh - rows * cell) / 2;
    ctx.strokeStyle = 'rgba(16, 28, 20, 0.16)';
    ctx.lineWidth = 1 * k;
    ctx.beginPath();
    for (let i = 0; i <= cols; i++) {
      const x = Math.round(ox0 + cell * i) + 0.5;
      if (x <= gx0 + 1 || x >= gx0 + gw - 1) continue;
      ctx.moveTo(x, gy0);
      ctx.lineTo(x, gy0 + gh);
    }
    for (let i = 0; i <= rows; i++) {
      const y = Math.round(oy0 + cell * i) + 0.5;
      if (y <= gy0 + 1 || y >= gy0 + gh - 1) continue;
      ctx.moveTo(gx0, y);
      ctx.lineTo(gx0 + gw, y);
    }
    ctx.stroke();
    ctx.font = `400 ${Math.round(13 * k)}px ${LABEL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.8;
    for (let i = 0; i < cols; i++) haloText(ctx, String.fromCharCode(65 + (i % 26)), ox0 + cell * (i + 0.5), gy0 + 11 * k, '#ffffff', 'rgba(14, 21, 28, 0.8)', 3.5 * k);
    for (let i = 0; i < rows; i++) haloText(ctx, String(i + 1), gx0 + 11 * k, oy0 + cell * (i + 0.5), '#ffffff', 'rgba(14, 21, 28, 0.8)', 3.5 * k);
    ctx.globalAlpha = 1;

    // ---- POI names: big, bold, upper-case, white with a heavy dark outline. The named
    // drop zones are large; minor landmarks smaller. Simple collision avoidance.
    const isPoi = (key) => DROP_ZONES.some((z) => z.key === key);
    const taken = []; // [x0, y0, x1, y1]
    const hits = (x0, y0, x1, y1) => {
      for (const r of taken) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true;
      return false;
    };
    const pts = this._landmarks.map((l) => ({ l, x: l.x * this._fs + this._fox, y: l.z * this._fs + this._foz, poi: isPoi(l.key) }));
    const dirs = [[0, 0], [0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
    for (const p of pts) {
      const size = Math.round((p.poi ? 24 : 15) * k);
      const lineH = Math.round(size * 1.02);
      ctx.font = `400 ${size}px ${LABEL_FONT}`;
      const lines = wrapWords(p.l.n.toUpperCase(), p.poi ? 16 : 18);
      let tw = 0;
      for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
      // room for the outline halo + drop shadow, plus a gap, so neighbouring names never touch
      tw += (p.poi ? 18 : 14) * k;
      const th = lineH * lines.length + (p.poi ? 14 : 10) * k;
      let best = null;
      for (let ring = 0; ring < 4 && !best; ring++) {
        const gap = ring * 14 * k;
        for (const d of dirs) {
          if (ring === 0 && (d[0] || d[1])) continue;
          if (ring > 0 && !d[0] && !d[1]) continue;
          const cx = p.x + d[0] * (gap + tw / 2);
          const cy = p.y + d[1] * (gap + th / 2);
          const x0 = cx - tw / 2;
          const y0 = cy - th / 2;
          if (x0 < 30 * k || y0 < 28 * k || x0 + tw > W - 6 * k || y0 + th > H - 34 * k) continue;
          if (hits(x0, y0, x0 + tw, y0 + th)) continue;
          best = { cx, cy, x0, y0 };
          break;
        }
      }
      if (!best) continue;
      taken.push([best.x0, best.y0, best.x0 + tw, best.y0 + th]);
      const top = best.cy - (lineH * lines.length) / 2;
      const fill = p.poi ? '#ffffff' : '#fff6dc';
      for (let i = 0; i < lines.length; i++) {
        const y = top + lineH * (i + 0.5);
        // drop shadow, outline, fill
        ctx.lineJoin = 'round';
        ctx.lineWidth = (p.poi ? 7 : 5) * k;
        ctx.strokeStyle = 'rgba(14, 21, 28, 0.55)';
        ctx.strokeText(lines[i], best.cx, y + 2.5 * k);
        haloText(ctx, lines[i], best.cx, y, fill, '#13202c', (p.poi ? 6.5 : 4.5) * k);
      }
    }

    // ---- scale bar (bottom-left)
    const nice = [5000, 2000, 1000, 500, 250, 200, 100, 50, 25, 10];
    let len = nice[nice.length - 1];
    for (const m of nice) {
      if (m * this._fs <= 118 * k) {
        len = m;
        break;
      }
    }
    const bw = len * this._fs;
    const bx = Math.round(16 * k);
    const by = Math.round(H - 22 * k);
    const bh = Math.round(6 * k);
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx - 2 * k, by - 2 * k, bw + 4 * k, bh + 4 * k);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx + bw / 4, by, bw / 4, bh);
    ctx.fillRect(bx + (bw * 3) / 4, by, bw / 4, bh);
    ctx.font = `800 ${Math.round(13 * k)}px ${this._font}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    haloText(ctx, len >= 1000 ? len / 1000 + ' km' : len + ' m', bx, by - 7 * k, C.ink, C.halo, 4 * k);

    // ---- north indicator (top-right)
    const nx = W - 34 * k;
    const ny = 40 * k;
    ctx.beginPath();
    ctx.arc(nx, ny, 22 * k, 0, TAU);
    ctx.fillStyle = 'rgba(22, 32, 43, 0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 1.5 * k;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nx, ny - 17 * k);
    ctx.lineTo(nx + 6.5 * k, ny - 3 * k);
    ctx.lineTo(nx, ny - 6.5 * k);
    ctx.lineTo(nx - 6.5 * k, ny - 3 * k);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.font = `900 ${Math.round(14 * k)}px ${this._font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 8.5 * k);
    this._fullForce = true;
  }

  // ---------------------------------------------------------------- mini tiles

  _tileIsStale(tile) {
    const far = this._ring + 2;
    const di = tile.i - this._pti;
    const dj = tile.j - this._ptj;
    return (di < 0 ? -di : di) > far || (dj < 0 ? -dj : dj) > far;
  }

  _requestTile(i, j, priority) {
    const key = j * this._cols + i;
    const have = this._tiles.get(key);
    if (have) {
      if (!have.ready && have.job && priority < have.job.priority) {
        // promoted from prefetch to visible: move its job forward
        const jobs = this._jobs;
        const at = jobs.indexOf(have.job);
        if (at >= 0) {
          jobs.splice(at, 1);
          have.job.priority = priority;
          let q = 0;
          while (q < jobs.length && jobs[q].priority <= priority) q++;
          jobs.splice(q, 0, have.job);
        }
      }
      return;
    }
    if (!this._prepped) return;
    // evict the tiles farthest from the player
    while (this._tiles.size >= this._tileCap) {
      let worst = null;
      let worstD = -1;
      for (const t of this._tiles.values()) {
        const di = t.i - this._pti;
        const dj = t.j - this._ptj;
        const d = Math.max(di < 0 ? -di : di, dj < 0 ? -dj : dj);
        if (d > worstD) {
          worstD = d;
          worst = t;
        }
      }
      if (!worst) break;
      this._tiles.delete(worst.key);
      if (worst.job) {
        const at = this._jobs.indexOf(worst.job);
        if (at >= 0) this._jobs.splice(at, 1);
      }
      this._tilePool.push(worst);
    }
    let tile = this._tilePool.pop();
    if (!tile) {
      const canvas = makeCanvas(TILE_PX + TILE_GUTTER * 2, TILE_PX + TILE_GUTTER * 2);
      tile = { key: 0, i: 0, j: 0, canvas, ctx: canvas.getContext('2d', { alpha: false }), ready: false, job: null };
    }
    tile.key = key;
    tile.i = i;
    tile.j = j;
    tile.ready = false;
    this._tiles.set(key, tile);
    tile.job = this._addJob(priority, this._tileJob(tile), tile);
  }

  *_tileJob(tile) {
    const D = this._data;
    const b = this._bounds;
    const s = this._ppm;
    const key = tile.key;
    const ctx = tile.ctx;
    const T = {
      s,
      ox: TILE_GUTTER - (b.minX + tile.i * this._tw) * s,
      oz: TILE_GUTTER - (b.minZ + tile.j * this._tw) * s,
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, tile.canvas.width, tile.canvas.height);
    const x0 = b.minX * s + T.ox;
    const y0 = b.minZ * s + T.oz;
    const w = (b.maxX - b.minX) * s;
    const h = (b.maxZ - b.minZ) * s;
    ctx.fillStyle = C.land;
    ctx.fillRect(x0, y0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    const none = [];
    const sel = {
      areas: D.areas.tiles[key] || none,
      water: D.water.tiles[key] || none,
      roads: D.roads.tiles[key] || none,
      buildings: D.buildings.tiles[key] || none,
      trees: D.trees.tiles[key] || none,
    };
    for (const _ of paintMap(ctx, D, T, sel, this._mk)) yield;
    ctx.restore();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 3 * this._mk;
    ctx.strokeRect(x0, y0, w, h);
    tile.ready = true;
    tile.job = null;
    this._version++;
  }

  // ---------------------------------------------------------------- change detection

  /** Writes the values a view depends on into `out`; returns true if they differ from what is there. */
  _snapshot(state, out, posEps, write) {
    const p = state.player;
    const st = state.storm;
    const mk = state.marker;
    let changed = false;
    const h = +p.heading || 0;
    if (Math.abs(p.x - out[0]) > posEps || Math.abs(p.z - out[1]) > posEps) changed = true;
    else if (angleDelta(h, out[2]) > 0.012) changed = true;
    const hasStorm = st ? 1 : 0;
    if (hasStorm !== out[3]) changed = true;
    else if (st) {
      if (
        Math.abs(st.cx - out[4]) > posEps || Math.abs(st.cz - out[5]) > posEps || Math.abs(st.r - out[6]) > posEps ||
        Math.abs(st.nextCx - out[7]) > posEps || Math.abs(st.nextCz - out[8]) > posEps || Math.abs(st.nextR - out[9]) > posEps
      ) changed = true;
    }
    const hasMarker = mk ? 1 : 0;
    if (hasMarker !== out[10]) changed = true;
    else if (mk && (mk.x !== out[11] || mk.z !== out[12])) changed = true;
    if (write) {
      out[0] = p.x;
      out[1] = p.z;
      out[2] = h;
      out[3] = hasStorm;
      if (st) {
        out[4] = st.cx;
        out[5] = st.cz;
        out[6] = st.r;
        out[7] = st.nextCx;
        out[8] = st.nextCz;
        out[9] = st.nextR;
      }
      out[10] = hasMarker;
      if (mk) {
        out[11] = mk.x;
        out[12] = mk.z;
      }
    }
    return changed;
  }

  /** A blip's label: small haloed text centred at x with its top at y. */
  _blipLabel(ctx, text, x, y, k) {
    ctx.font = `900 ${Math.round(10 * k)}px ${this._font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    haloText(ctx, text, Math.round(x), Math.round(y), '#ffffff', '#13202c', 3 * k);
  }

  _blipHash(blips) {
    if (!blips) return 0;
    const n = blips.length;
    let h = n | 0;
    for (let i = 0; i < n; i++) {
      const b = blips[i];
      h = (Math.imul(h, 31) + ((b.x * 4) | 0)) | 0;
      h = (Math.imul(h, 31) + ((b.z * 4) | 0)) | 0;
      h = (Math.imul(h, 31) + (b.kind ? b.kind.charCodeAt(0) + b.kind.length * 7 + b.kind.charCodeAt(b.kind.length - 1) * 131 : 0)) | 0;
      if (b.label) for (let j = 0; j < b.label.length; j++) h = (Math.imul(h, 31) + b.label.charCodeAt(j)) | 0;
    }
    return h;
  }

  _miniChanged(state) {
    const bh = this._blipHash(state.blips);
    const changed = this._snapshot(state, this._mSnap, 0.3 / this._ppm, false);
    if (changed || this._miniForce || bh !== this._mBlipHash || this._version !== this._mVersion) {
      this._snapshot(state, this._mSnap, 0, true);
      this._mBlipHash = bh;
      this._mVersion = this._version;
      this._miniForce = false;
      return true;
    }
    return false;
  }

  _fullChanged(state) {
    const bh = this._blipHash(state.blips);
    const changed = this._snapshot(state, this._fSnap, 0.4 / this._fs, false);
    const rt = state.route || null;
    const bus = state.bus || null;
    const busMoved = !!bus !== !!this._fBus || (bus && Math.hypot(bus.x - this._fBus.x, bus.z - this._fBus.z) > 0.4 / this._fs);
    if (changed || this._fullForce || bh !== this._fBlipHash || this._version !== this._fSnap[13] || rt !== this._fRoute || busMoved) {
      this._snapshot(state, this._fSnap, 0, true);
      this._fRoute = rt;
      this._fBus = bus ? { x: bus.x, z: bus.z } : null;
      this._fBlipHash = bh;
      this._fSnap[13] = this._version;
      this._fullForce = false;
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- mini view

  /** World -> mini canvas px, result in this._sx / this._sy. */
  _toMini(x, z) {
    const dx = (x - this._mcx) * this._ppm;
    const dz = (z - this._mcz) * this._ppm;
    this._sx = this._mw / 2 + dx * this._mcos + dz * this._msin;
    this._sy = this._mh / 2 - dx * this._msin + dz * this._mcos;
  }

  /** Pulls this._sx/_sy back inside the view (inset by `m` px) along the ray from the centre. */
  _clampMini(m) {
    const hx = this._mw / 2;
    const hy = this._mh / 2;
    const dx = this._sx - hx;
    const dy = this._sy - hy;
    const ax = (dx < 0 ? -dx : dx) / (hx - m);
    const ay = (dy < 0 ? -dy : dy) / (hy - m);
    const f = ax > ay ? ax : ay;
    if (f > 1) {
      this._sx = hx + dx / f;
      this._sy = hy + dy / f;
      this._clamped = true;
    } else this._clamped = false;
  }

  _drawMini(state) {
    const ctx = this._mctx;
    const W = this._mw;
    const H = this._mh;
    const ppm = this._ppm;
    const k = this._mk;
    const b = this._bounds;
    const p = state.player;
    const heading = +p.heading || 0;
    const rot = this._rotate;
    const G = TILE_GUTTER;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, W, H);

    // view origin: north-up snaps to whole tile pixels so tiles blit 1:1 (crisp, fastest path)
    let vx = 0;
    let vy = 0;
    if (rot) {
      this._mcx = p.x;
      this._mcz = p.z;
      this._mcos = Math.cos(heading);
      this._msin = Math.sin(heading);
      ctx.setTransform(this._mcos, -this._msin, this._msin, this._mcos, W / 2, H / 2);
    } else {
      vx = Math.round((p.x - b.minX) * ppm - W / 2);
      vy = Math.round((p.z - b.minZ) * ppm - H / 2);
      this._mcx = (vx + W / 2) / ppm + b.minX;
      this._mcz = (vy + H / 2) / ppm + b.minZ;
      this._mcos = 1;
      this._msin = 0;
    }

    // ---- map tiles
    const tw = this._tw;
    const cols = this._cols;
    const rows = this._rows;
    const ext = this._ext;
    const pti = Math.floor((p.x - b.minX) / tw);
    const ptj = Math.floor((p.z - b.minZ) / tw);
    this._pti = pti;
    this._ptj = ptj;
    const i0 = Math.max(0, Math.floor((p.x - ext - b.minX) / tw));
    const i1 = Math.min(cols - 1, Math.floor((p.x + ext - b.minX) / tw));
    const j0 = Math.max(0, Math.floor((p.z - ext - b.minZ) / tw));
    const j1 = Math.min(rows - 1, Math.floor((p.z + ext - b.minZ) / tw));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tile = this._tiles.get(j * cols + i);
        if (tile && tile.ready) {
          if (rot) ctx.drawImage(tile.canvas, (b.minX + i * tw - p.x) * ppm - G, (b.minZ + j * tw - p.z) * ppm - G);
          else ctx.drawImage(tile.canvas, i * TILE_PX - vx - G, j * TILE_PX - vy - G);
          continue;
        }
        this._requestTile(i, j, 0);
        // placeholder: the same region, magnified from the full-map layer (or flat land)
        const wx0 = Math.max(b.minX, b.minX + i * tw);
        const wz0 = Math.max(b.minZ, b.minZ + j * tw);
        const wx1 = Math.min(b.maxX, b.minX + (i + 1) * tw);
        const wz1 = Math.min(b.maxZ, b.minZ + (j + 1) * tw);
        if (wx1 <= wx0 || wz1 <= wz0) continue;
        const dx = rot ? (wx0 - p.x) * ppm : (wx0 - b.minX) * ppm - vx;
        const dy = rot ? (wz0 - p.z) * ppm : (wz0 - b.minZ) * ppm - vy;
        const dw = (wx1 - wx0) * ppm;
        const dh = (wz1 - wz0) * ppm;
        if (this._static && this._staticStarted) {
          const fs = this._fs;
          ctx.drawImage(this._static, wx0 * fs + this._fox, wz0 * fs + this._foz, (wx1 - wx0) * fs, (wz1 - wz0) * fs, dx, dy, dw + 0.5, dh + 0.5);
        } else {
          ctx.fillStyle = C.land;
          ctx.fillRect(dx, dy, dw + 0.5, dh + 0.5);
        }
      }
    }
    // prefetch the block of tiles around the player whenever they enter a new tile
    const here = ptj * 4096 + pti;
    if (here !== this._lastPrefetch && this._prepped) {
      this._lastPrefetch = here;
      const ring = this._ring;
      for (let j = ptj - ring; j <= ptj + ring; j++) {
        if (j < 0 || j >= rows) continue;
        for (let i = pti - ring; i <= pti + ring; i++) {
          if (i < 0 || i >= cols) continue;
          this._requestTile(i, j, 2);
        }
      }
    }
    if (rot) ctx.setTransform(1, 0, 0, 1, 0, 0);

    const hx = W / 2;
    const hy = H / 2;
    const diag = Math.sqrt(hx * hx + hy * hy);

    // ---- storm
    const st = state.storm;
    if (st) {
      this._toMini(st.cx, st.cz);
      const scx = this._sx;
      const scy = this._sy;
      const sr = st.r > 0 ? st.r * ppm : 0;
      const d = Math.sqrt((scx - hx) * (scx - hx) + (scy - hy) * (scy - hy));
      if (d + diag > sr) {
        // some of the view is in the storm
        ctx.fillStyle = C.stormFill;
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        if (d - diag < sr) {
          ctx.moveTo(scx + sr, scy);
          ctx.arc(scx, scy, sr, 0, TAU);
        }
        ctx.fill('evenodd');
      }
      if (Math.abs(d - sr) < diag + 6 * k) {
        ctx.beginPath();
        ctx.arc(scx, scy, sr, 0, TAU);
        ctx.strokeStyle = C.stormEdgeDark;
        ctx.lineWidth = 6 * k;
        ctx.stroke();
        ctx.strokeStyle = C.stormEdge;
        ctx.lineWidth = 3.2 * k;
        ctx.stroke();
      }
      if (st.nextR >= 0) {
        this._toMini(st.nextCx, st.nextCz);
        const ncx = this._sx;
        const ncy = this._sy;
        const nr = st.nextR * ppm;
        const nd = Math.sqrt((ncx - hx) * (ncx - hx) + (ncy - hy) * (ncy - hy));
        if (Math.abs(nd - nr) < diag + 4 * k) {
          ctx.beginPath();
          ctx.arc(ncx, ncy, nr, 0, TAU);
          ctx.strokeStyle = C.nextRingDark;
          ctx.lineWidth = 3.4 * k;
          ctx.stroke();
          ctx.strokeStyle = C.nextRing;
          ctx.lineWidth = 1.6 * k;
          ctx.stroke();
        }
        // guide line from the player to the nearest point of the next circle
        const wdx = p.x - st.nextCx;
        const wdz = p.z - st.nextCz;
        const wd = Math.sqrt(wdx * wdx + wdz * wdz);
        if (wd > st.nextR + 0.5) {
          this._toMini(p.x, p.z);
          const px0 = this._sx;
          const py0 = this._sy;
          const f = st.nextR / wd;
          this._toMini(st.nextCx + wdx * f, st.nextCz + wdz * f);
          ctx.beginPath();
          ctx.moveTo(px0, py0);
          ctx.lineTo(this._sx, this._sy);
          ctx.strokeStyle = C.nextRingDark;
          ctx.lineWidth = 3.6 * k;
          ctx.stroke();
          ctx.setLineDash(DASH_GUIDE);
          ctx.strokeStyle = C.nextRing;
          ctx.lineWidth = 1.8 * k;
          ctx.stroke();
          ctx.setLineDash(DASH_NONE);
        }
      }
    }

    // ---- landmark names (upright sprites)
    const lms = this._landmarks;
    for (let i = 0; i < lms.length; i++) {
      const l = lms[i];
      const sp = l.sprite;
      if (!sp) continue;
      this._toMini(l.x, l.z);
      const sx = this._sx;
      const sy = this._sy;
      if (sx < -sp.w / 2 || sx > W + sp.w / 2 || sy < 0 || sy > H + sp.h) continue;
      ctx.drawImage(sp.c, Math.round(sx - sp.ax), Math.round(sy - sp.ay - 4 * k));
    }

    // ---- blips
    const blips = state.blips;
    const spr = this._miniSprites;
    if (blips && blips.length) {
      const range2 = this._blipRange * this._blipRange;
      for (let i = 0; i < blips.length; i++) {
        const bl = blips[i];
        const sp = spr[bl.kind] || spr.loot;
        this._toMini(bl.x, bl.z);
        this._clampMini(9 * k);
        if (this._clamped) {
          if (!isPinnedBlip(bl.kind, bl.label)) {
            const ddx = bl.x - p.x;
            const ddz = bl.z - p.z;
            if (ddx * ddx + ddz * ddz > range2) continue;
          }
          ctx.globalAlpha = 0.72;
          ctx.drawImage(sp.c, this._sx - sp.ax * 0.8, this._sy - sp.ay * 0.8, sp.w * 0.8, sp.h * 0.8);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(sp.c, Math.round(this._sx - sp.ax), Math.round(this._sy - sp.ay));
          if (bl.label) this._blipLabel(ctx, bl.label, this._sx, this._sy - sp.ay + sp.h + 2 * k, k);
        }
      }
    }

    // ---- waypoint marker
    const mk = state.marker;
    if (mk) {
      const sp = spr.marker;
      this._toMini(mk.x, mk.z);
      this._clampMini(13 * k);
      if (this._clamped) {
        const sx = this._sx;
        const sy = this._sy;
        ctx.drawImage(sp.c, Math.round(sx - sp.ax), Math.round(sy - sp.h / 2));
        const ddx = mk.x - p.x;
        const ddz = mk.z - p.z;
        const dist = Math.round(Math.sqrt(ddx * ddx + ddz * ddz) / 5) * 5;
        if (dist !== this._distValue) {
          this._distValue = dist;
          this._distText = dist + 'm';
        }
        ctx.font = this._distFont || (this._distFont = `800 ${Math.round(11 * k)}px ${this._font}`);
        ctx.textBaseline = 'middle';
        // put the read-out on the inward side of the pin
        const left = sx > hx;
        ctx.textAlign = left ? 'right' : 'left';
        const ty = clamp(sy + (sy < hy * 0.4 ? 22 * k : sy > hy * 1.6 ? -22 * k : 0), 10 * k, H - 10 * k);
        const tx = ty === sy ? sx + (left ? -13 : 13) * k : clamp(sx, 26 * k, W - 26 * k);
        if (ty !== sy) ctx.textAlign = 'center';
        haloText(ctx, this._distText, tx, ty, C.ink, C.halo, 3 * k);
      } else ctx.drawImage(sp.c, Math.round(this._sx - sp.ax), Math.round(this._sy - sp.ay));
    }

    // ---- north badge (heading-up only; north-up needs none)
    if (rot && this._northSprite) {
      const ns = this._northSprite;
      const e = hx - 13 * k;
      const nx = -this._msin;
      const ny = -this._mcos;
      const f = e / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
      ctx.drawImage(ns.c, Math.round(hx + nx * f - ns.ax), Math.round(hy + ny * f - ns.ay));
    }

    // ---- player arrow
    this._toMini(p.x, p.z);
    this._drawArrow(ctx, this._sx, this._sy, rot ? 0 : heading, k);
  }

  _drawArrow(ctx, x, y, heading, k) {
    const c = Math.cos(heading) * k;
    const s = Math.sin(heading) * k;
    ctx.setTransform(c, s, -s, c, x, y);
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7.2, 7.5);
    ctx.lineTo(0, 3.6);
    ctx.lineTo(-7.2, 7.5);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.playerEdge;
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.fillStyle = C.player;
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------------------------------------------------------- full view

  _drawFull(state) {
    const ctx = this._fctx;
    const W = this._fw;
    const H = this._fh;
    const s = this._fs;
    const ox = this._fox;
    const oz = this._foz;
    const k = this._fk;
    const b = this._bounds;
    const p = state.player;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const mx = b.minX * s + ox;
    const my = b.minZ * s + oz;
    const mw = (b.maxX - b.minX) * s;
    const mh = (b.maxZ - b.minZ) * s;
    if (this._static && this._staticStarted) ctx.drawImage(this._static, 0, 0);
    else {
      // plain placeholder until the first slice of the static layer has run
      ctx.fillStyle = C.outside;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.land;
      ctx.fillRect(mx, my, mw, mh);
    }

    // ---- storm (clipped to the map so nothing spills into the letterbox)
    const st = state.storm;
    if (st) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();
      const scx = st.cx * s + ox;
      const scy = st.cz * s + oz;
      const sr = st.r > 0 ? st.r * s : 0;
      ctx.fillStyle = C.stormFill;
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.moveTo(scx + sr, scy);
      ctx.arc(scx, scy, sr, 0, TAU);
      ctx.fill('evenodd');
      ctx.beginPath();
      ctx.arc(scx, scy, sr, 0, TAU);
      ctx.strokeStyle = C.stormEdgeDark;
      ctx.lineWidth = 6.5 * k;
      ctx.stroke();
      ctx.strokeStyle = C.stormEdge;
      ctx.lineWidth = 3.5 * k;
      ctx.stroke();
      if (st.nextR >= 0) {
        const ncx = st.nextCx * s + ox;
        const ncy = st.nextCz * s + oz;
        ctx.beginPath();
        ctx.arc(ncx, ncy, st.nextR * s, 0, TAU);
        ctx.strokeStyle = C.nextRingDark;
        ctx.lineWidth = 4 * k;
        ctx.stroke();
        ctx.strokeStyle = C.nextRing;
        ctx.lineWidth = 1.8 * k;
        ctx.stroke();
        const wdx = p.x - st.nextCx;
        const wdz = p.z - st.nextCz;
        const wd = Math.sqrt(wdx * wdx + wdz * wdz);
        if (wd > st.nextR + 0.5) {
          const f = st.nextR / wd;
          ctx.beginPath();
          ctx.moveTo(p.x * s + ox, p.z * s + oz);
          ctx.lineTo((st.nextCx + wdx * f) * s + ox, (st.nextCz + wdz * f) * s + oz);
          ctx.strokeStyle = C.nextRingDark;
          ctx.lineWidth = 4 * k;
          ctx.stroke();
          ctx.setLineDash(DASH_GUIDE);
          ctx.strokeStyle = C.nextRing;
          ctx.lineWidth = 2 * k;
          ctx.stroke();
          ctx.setLineDash(DASH_NONE);
        }
      }
      ctx.restore();
    }

    // ---- labels, scale bar, north indicator
    if (this.ready && this._overlay) ctx.drawImage(this._overlay, 0, 0);

    // ---- Drop Bus route (dashed flight line with direction chevrons) and the bus
    const rt = state.route;
    if (rt) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx, my, mw, mh);
      ctx.clip();
      const x0 = rt.ax * s + ox;
      const y0 = rt.az * s + oz;
      const x1 = rt.bx * s + ox;
      const y1 = rt.bz * s + oz;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineCap = 'round';
      ctx.strokeStyle = C.routeDark;
      ctx.lineWidth = 13 * k;
      ctx.stroke();
      ctx.setLineDash([24 * k, 12 * k]);
      ctx.strokeStyle = C.route;
      ctx.lineWidth = 7 * k;
      ctx.stroke();
      ctx.setLineDash(DASH_NONE);
      // chevrons every ~90 px pointing along the flight
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const ux = (x1 - x0) / len;
      const uy = (y1 - y0) / len;
      const step = 140 * k;
      const c = 11 * k;
      ctx.lineWidth = 3 * k;
      for (let d = step * 0.5; d < len; d += step) {
        const cx = x0 + ux * d;
        const cy = y0 + uy * d;
        ctx.beginPath();
        ctx.moveTo(cx - ux * c - uy * c, cy - uy * c + ux * c);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - ux * c + uy * c, cy - uy * c - ux * c);
        ctx.strokeStyle = C.routeDark;
        ctx.lineWidth = 8 * k;
        ctx.stroke();
        ctx.strokeStyle = C.route;
        ctx.lineWidth = 4 * k;
        ctx.stroke();
      }
      ctx.restore();
    }
    const bus = state.bus;
    if (bus) {
      // a little yellow bus body, nose along the heading
      const bx = bus.x * s + ox;
      const by = bus.z * s + oz;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(+bus.heading || 0);
      ctx.fillStyle = C.route;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 5 * k;
      ctx.beginPath();
      ctx.rect(-18 * k, -34 * k, 36 * k, 68 * k);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.fillRect(-13 * k, -26 * k, 26 * k, 10 * k);
      ctx.restore();
    }

    // ---- blips
    const spr = this._fullSprites;
    const blips = state.blips;
    if (blips && blips.length) {
      for (let i = 0; i < blips.length; i++) {
        const bl = blips[i];
        const sp = spr[bl.kind] || spr.loot;
        const bx = Math.round(bl.x * s + ox - sp.ax);
        const by = Math.round(bl.z * s + oz - sp.ay);
        ctx.drawImage(sp.c, bx, by);
        if (bl.label) this._blipLabel(ctx, bl.label, bx + sp.ax, by + sp.h + 2 * k, k * 1.5);
      }
    }

    // ---- marker
    const mk = state.marker;
    if (mk) {
      const sp = spr.marker;
      ctx.drawImage(sp.c, Math.round(mk.x * s + ox - sp.ax), Math.round(mk.z * s + oz - sp.ay));
    }

    // ---- player: a ring so the arrow is easy to find on the big map
    const px = clamp(p.x * s + ox, mx, mx + mw);
    const py = clamp(p.z * s + oz, my, my + mh);
    ctx.beginPath();
    ctx.arc(px, py, 17 * k, 0, TAU);
    ctx.strokeStyle = 'rgba(22, 32, 43, 0.55)';
    ctx.lineWidth = 4 * k;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2 * k;
    ctx.stroke();
    this._drawArrow(ctx, px, py, +p.heading || 0, k * 1.15);
  }
}

export default Minimap;
