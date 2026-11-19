// BENTONVILLE ROYALE — the invented fuel brands of the gas stations: one table, easy to edit.
//
//   brandFor(i)               // station i's brand (two stations of each, same on every machine)
//   brandById(id)
//   drawBrandLogo(ctx, brand, cx, cy, r)       // the brand's mark on a 2D canvas, centred, radius r
//   drawBrandSign(ctx, brand, w, h)            // a whole pylon-sign face (render/GasStationMesh.js)
//   drawBrandFascia(ctx, brand, w, h)          // the canopy fascia band with the name
//
// Owner-approved exception (AGENTS.md section 21, 2026-11-18): the three parody brands may use
// colour schemes evoking real fuel chains. The names and marks below are ORIGINAL: a cartoon clam,
// a little sun, a ring with an O. Real brand names never appear in code, art or copy.
//
// Colours are 0xRRGGBB numbers (3D vertex colours); css() turns one into a canvas colour.

export const GAS_BRANDS = Object.freeze([
  Object.freeze({
    id: 'clam',
    name: 'Clam Oil',
    // yellow fascia and sign, red lettering and trim
    colors: Object.freeze({ fascia: 0xffd21c, stripe: 0xd8222a, trim: 0xd8222a, cap: 0xffd21c, text: 0xd8222a, sign: 0xffd21c, ink: 0x7a1016 }),
    logo: 'clam',
  }),
  Object.freeze({
    id: 'floormart',
    name: 'Floor Mart',
    // blue fascia, yellow stripe and sun, white lettering
    colors: Object.freeze({ fascia: 0x1160b8, stripe: 0xffc627, trim: 0x1160b8, cap: 0xffc627, text: 0xffffff, sign: 0x1160b8, ink: 0x0a2f5c }),
    logo: 'sun',
  }),
  Object.freeze({
    id: 'circleo',
    name: 'Circle O',
    // red and orange stripes, white lettering
    colors: Object.freeze({ fascia: 0xe2231a, stripe: 0xf7901e, trim: 0xe2231a, cap: 0xf7901e, text: 0xffffff, sign: 0xe2231a, ink: 0x6e0e0a }),
    logo: 'ringO',
  }),
]);

/** Station i's brand: the table in order, round and round (6 stations: two of each). */
export function brandFor(i) {
  const n = GAS_BRANDS.length;
  const k = Number.isFinite(+i) ? ((Math.floor(+i) % n) + n) % n : 0;
  return GAS_BRANDS[k];
}

export function brandById(id) {
  return GAS_BRANDS.find((b) => b.id === id) || null;
}

/** 0xRRGGBB -> '#rrggbb'. */
export function css(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}

const FONT = "'Lilita One', 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif";

// ------------------------------------------------------------------ logos (original drawings)

/** A cartoon clam: a scalloped fan on a little hinge, ridges, two dot eyes. Yellow, red outline. */
function drawClam(x, b, cx, cy, r) {
  const C = b.colors;
  const lobes = 7;
  const hingeY = cy + r * 0.62;
  const a0 = Math.PI * 1.08;
  const a1 = Math.PI * 1.92;
  x.save();
  x.lineJoin = 'round';
  x.lineCap = 'round';
  // fan outline: lobes along an arc around the hinge
  x.beginPath();
  x.moveTo(cx - r * 0.2, hingeY);
  for (let i = 0; i < lobes; i++) {
    const t0 = a0 + ((a1 - a0) * i) / lobes;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / lobes;
    const tm = (t0 + t1) / 2;
    const R = r * 1.02;
    const p0 = [cx + Math.cos(t0) * R, hingeY + Math.sin(t0) * R * 1.05];
    const p1 = [cx + Math.cos(t1) * R, hingeY + Math.sin(t1) * R * 1.05];
    const pc = [cx + Math.cos(tm) * R * 1.2, hingeY + Math.sin(tm) * R * 1.26];
    if (i === 0) x.lineTo(p0[0], p0[1]);
    x.quadraticCurveTo(pc[0], pc[1], p1[0], p1[1]);
  }
  x.lineTo(cx + r * 0.2, hingeY);
  x.closePath();
  x.fillStyle = css(C.cap);
  x.fill();
  x.strokeStyle = css(C.stripe);
  x.lineWidth = Math.max(2, r * 0.14);
  x.stroke();
  // ridges from the hinge to the lobe dips
  x.lineWidth = Math.max(1.5, r * 0.08);
  for (let i = 1; i < lobes; i++) {
    const t = a0 + ((a1 - a0) * i) / lobes;
    x.beginPath();
    x.moveTo(cx + Math.cos(t) * r * 0.28, hingeY + Math.sin(t) * r * 0.28);
    x.lineTo(cx + Math.cos(t) * r * 0.95, hingeY + Math.sin(t) * r * 1.0);
    x.stroke();
  }
  // hinge foot
  x.fillStyle = css(C.stripe);
  x.beginPath();
  x.moveTo(cx - r * 0.34, hingeY + r * 0.02);
  x.lineTo(cx + r * 0.34, hingeY + r * 0.02);
  x.lineTo(cx + r * 0.22, hingeY + r * 0.3);
  x.lineTo(cx - r * 0.22, hingeY + r * 0.3);
  x.closePath();
  x.fill();
  // cartoon eyes
  for (const s of [-1, 1]) {
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.arc(cx + s * r * 0.24, cy + r * 0.08, r * 0.15, 0, Math.PI * 2);
    x.fill();
    x.lineWidth = Math.max(1, r * 0.05);
    x.stroke();
    x.fillStyle = css(C.ink);
    x.beginPath();
    x.arc(cx + s * r * 0.22, cy + r * 0.11, r * 0.07, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

/** A round little sun: a disc and eight pointed rays, all yellow. */
function drawSun(x, b, cx, cy, r) {
  const C = b.colors;
  x.save();
  x.fillStyle = css(C.stripe);
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const w = 0.2;
    x.moveTo(cx + Math.cos(t - w) * r * 0.55, cy + Math.sin(t - w) * r * 0.55);
    x.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
    x.lineTo(cx + Math.cos(t + w) * r * 0.55, cy + Math.sin(t + w) * r * 0.55);
    x.closePath();
  }
  x.fill();
  x.beginPath();
  x.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** A red ring-disc with a bold white O in it, white rim. */
function drawRingO(x, b, cx, cy, r) {
  const C = b.colors;
  x.save();
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = css(C.fascia);
  x.beginPath();
  x.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#ffffff';
  x.lineWidth = r * 0.26;
  x.beginPath();
  x.ellipse(cx, cy, r * 0.42, r * 0.5, 0, 0, Math.PI * 2);
  x.stroke();
  x.restore();
}

const LOGOS = { clam: drawClam, sun: drawSun, ringO: drawRingO };

export function drawBrandLogo(ctx, brand, cx, cy, r) {
  const fn = brand && LOGOS[brand.logo];
  if (ctx && fn) fn(ctx, brand, cx, cy, r);
}

function fitText(x, text, maxW, size) {
  let s = size;
  x.font = `${s}px ${FONT}`;
  while (s > 10 && x.measureText(text).width > maxW) {
    s -= 2;
    x.font = `${s}px ${FONT}`;
  }
  return s;
}

function outlined(x, text, px, py, fill, ink, lw) {
  x.lineJoin = 'round';
  x.strokeStyle = ink;
  x.lineWidth = lw;
  x.strokeText(text, px, py);
  x.fillStyle = fill;
  x.fillText(text, px, py);
}

/** One pylon-sign face (w x h px): the brand's field, mark and name. */
export function drawBrandSign(x, brand, w, h) {
  const C = brand.colors;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (brand.id === 'clam') {
    x.fillStyle = css(C.stripe);
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(C.sign);
    x.fillRect(8, 8, w - 16, h - 16);
    drawBrandLogo(x, brand, w / 2, h * 0.36, h * 0.27);
    fitText(x, 'CLAM OIL', w - 30, 48);
    outlined(x, 'CLAM OIL', w / 2, h * 0.8, css(C.text), '#ffffff', 6);
  } else if (brand.id === 'floormart') {
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(C.sign);
    x.fillRect(8, 8, w - 16, h - 16);
    x.fillStyle = css(C.stripe);
    x.fillRect(8, h - 34, w - 16, 12);
    drawBrandLogo(x, brand, w * 0.2, h * 0.42, h * 0.2);
    x.textAlign = 'left';
    fitText(x, 'FLOOR', w * 0.62, 50);
    outlined(x, 'FLOOR', w * 0.36, h * 0.27, css(C.text), css(C.ink), 6);
    fitText(x, 'MART', w * 0.62, 50);
    outlined(x, 'MART', w * 0.36, h * 0.57, css(C.text), css(C.ink), 6);
  } else {
    // red field, orange band, the ring O and the name in white
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.fillStyle = css(C.sign);
    x.fillRect(8, 8, w - 16, h - 16);
    x.fillStyle = css(C.stripe);
    x.fillRect(8, h * 0.66, w - 16, h * 0.12);
    x.fillStyle = css(C.cap);
    x.fillRect(8, h * 0.8, w - 16, h * 0.05);
    drawBrandLogo(x, brand, w / 2, h * 0.34, h * 0.24);
    fitText(x, 'CIRCLE O', w - 30, 40);
    outlined(x, 'CIRCLE O', w / 2, h * 0.72, '#ffffff', css(C.ink), 6);
  }
}

/** The canopy fascia band (w x h px): the brand's colours, mark and name. */
export function drawBrandFascia(x, brand, w, h) {
  const C = brand.colors;
  // the field only: the fascia's stripes are part of the canopy mesh around it
  x.fillStyle = css(C.fascia);
  x.fillRect(0, 0, w, h);
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const r = h * 0.36;
  const name = brand.name.toUpperCase();
  fitText(x, name, w * 0.6, Math.round(h * 0.62));
  const tw = x.measureText(name).width;
  const total = tw + r * 2.6;
  const lx = w / 2 - total / 2 + r;
  drawBrandLogo(x, brand, lx, h * 0.5, r);
  x.textAlign = 'left';
  outlined(x, name, lx + r * 1.6, h * 0.52, css(C.text), brand.id === 'clam' ? '#ffffff' : css(C.ink), Math.max(3, h * 0.06));
}
