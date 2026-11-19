// BENTONVILLE ROYALE — Bentonville High School palette sampler (dev tooling, Node + sharp).
//
//   node tools/bhs/palette.mjs tools/bhs/palette-samples.json
//
// For every surface in the samples file: crops each listed rectangle from the (decoded) reference
// photo, takes each patch's per-channel median, drops patches whose luminance is an outlier (more
// than 1.5 IQR from the others: shadowed / blown-out), and prints the median of the rest as hex.
// Writes <refs>/_work/palette/<surface>.png (the patches outlined on the photo + the swatch) and
// <refs>/_work/palette/sheet.png (all swatches). Photos and sheets stay OUTSIDE the repo; only
// the printed hex values are copied into docs/bhs/STYLE_BIBLE.md.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { WORK, decodedPath } from './refs.mjs';

const OUT = path.join(WORK, 'palette');
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function patchMedian(file, [x, y, w, h]) {
  const { data, info } = await sharp(file).extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = [[], [], []];
  for (let i = 0; i < data.length; i += info.channels) for (let k = 0; k < 3; k++) ch[k].push(data[i + k]);
  return ch.map(median);
}

export async function samplePalette(spec) {
  fs.mkdirSync(OUT, { recursive: true });
  const result = {};
  for (const [surface, list] of Object.entries(spec)) {
    const patches = [];
    for (const { ref, rects } of list) for (const r of rects) patches.push({ ref, r, c: await patchMedian(decodedPath(ref), r) });
    const L = patches.map((p) => lum(p.c));
    let keep = patches;
    if (patches.length >= 4) {
      const s = [...L].sort((a, b) => a - b);
      const q1 = s[Math.floor(s.length / 4)], q3 = s[Math.floor((3 * s.length) / 4)];
      const lo = q1 - 1.5 * (q3 - q1), hi = q3 + 1.5 * (q3 - q1);
      keep = patches.filter((p, i) => L[i] >= lo && L[i] <= hi);
    }
    const c = [0, 1, 2].map((k) => median(keep.map((p) => p.c[k])));
    result[surface] = { hex: hex(c), patches: patches.length, kept: keep.length, refs: [...new Set(list.map((l) => l.ref))] };
    // per-surface check image: first ref with its rects outlined + the swatch
    const first = list[0];
    const meta = await sharp(decodedPath(first.ref)).metadata();
    const outl = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">${first.rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#0f0" stroke-width="3"/>`).join('')}<rect x="${meta.width - 130}" y="10" width="120" height="120" fill="${hex(c)}" stroke="white" stroke-width="3"/></svg>`;
    await sharp(decodedPath(first.ref)).composite([{ input: Buffer.from(outl) }]).png().toFile(path.join(OUT, surface + '.png'));
  }
  const names = Object.keys(result);
  const cols = 4, cw = 230, chh = 70;
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cw}" height="${Math.ceil(names.length / cols) * chh}"><rect width="100%" height="100%" fill="#fff"/>${names.map((n, i) => `<g transform="translate(${(i % cols) * cw},${Math.floor(i / cols) * chh})"><rect x="4" y="4" width="60" height="60" fill="${result[n].hex}"/><text x="70" y="28" font-size="13" font-family="sans-serif">${n}</text><text x="70" y="48" font-size="13" font-family="monospace">${result[n].hex}</text></g>`).join('')}</svg>`;
  await sharp(Buffer.from(sheet)).png().toFile(path.join(OUT, 'sheet.png'));
  return result;
}

if (process.argv[1] && /palette\.mjs$/.test(process.argv[1])) {
  const spec = JSON.parse(fs.readFileSync(process.argv[2] || 'tools/bhs/palette-samples.json', 'utf8'));
  const res = await samplePalette(spec);
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(22), v.hex, `${v.kept}/${v.patches}`, v.refs.join(', '));
}
