// BENTONVILLE ROYALE — Bentonville High School reference-photo helpers (dev tooling, Node).
// The photos live OUTSIDE the repo (BHS_REFS, default ~/Pictures/bhs-refs) and never
// enter it: everything derived from them is written to <refs>/_work/. See docs/bhs/STYLE_BIBLE.md.
//
//   node tools/bhs/refs.mjs decode     -> <refs>/_work/decoded/<name>.png for every ref (any real
//                                         format: some .jpg files are really AVIF / WebP)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export const REFS = process.env.BHS_REFS || path.join(os.homedir(), 'Pictures', 'bhs-refs');
export const WORK = path.join(REFS, '_work');
export const DECODED = path.join(WORK, 'decoded');

/** Every reference image file (flat folder, `_work` skipped). */
export function listRefs() {
  return fs.readdirSync(REFS).filter((f) => !f.startsWith('_') && /\.(png|jpe?g|webp|avif|heic)$/i.test(f));
}

/** Path of the decoded PNG for a reference filename (decode first). */
export function decodedPath(name) {
  return path.join(DECODED, name.replace(/\.[^.]+$/, '') + '.png');
}

export async function decodeAll() {
  fs.mkdirSync(DECODED, { recursive: true });
  for (const f of listRefs()) {
    const out = decodedPath(f);
    const meta = await sharp(path.join(REFS, f)).metadata();
    await sharp(path.join(REFS, f)).png().toFile(out);
    console.log(f.padEnd(52), meta.format, `${meta.width}x${meta.height}`);
  }
}

if (process.argv[1] && /refs.mjs$/.test(process.argv[1])) {
  if (process.argv[2] === 'decode') await decodeAll();
  else console.log('usage: node tools/bhs/refs.mjs decode');
}

/** <refs>/_work/grid/<name>.png: the decoded photo with a labelled `step` px grid (for picking sample rects). */
export async function gridRef(name, step = 50) {
  const src = decodedPath(name);
  const { width: w, height: h } = await sharp(src).metadata();
  let g = '';
  for (let x = 0; x < w; x += step) g += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="yellow" stroke-opacity="0.6"/><text x="${x + 2}" y="12" fill="yellow" font-size="12" font-family="sans-serif">${x}</text>`;
  for (let y = 0; y < h; y += step) g += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="cyan" stroke-opacity="0.6"/><text x="2" y="${y + 12}" fill="cyan" font-size="12" font-family="sans-serif">${y}</text>`;
  const dir = path.join(WORK, 'grid');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name.replace(/\.[^.]+$/, '') + '.png');
  await sharp(src).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${g}</svg>`) }]).toFile(out);
  return out;
}
