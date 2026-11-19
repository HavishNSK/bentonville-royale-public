// Atlas analysis for tools/skins/swatches.mjs: decodes a kit's embedded texture (sharp, a root
// devDependency) and maps every mesh's UVs onto the 8 x 4 swatch grid, so region tables can be
// written from facts (which cells exist, their colours, which meshes use them).
import path from 'node:path';
import sharp from 'sharp';
import { readGlb, accessor, embeddedImage, meshNodes } from './glb.mjs';
import { ATLAS_GRID, cellId } from '../../../src/game/skinRecipe.js';

export const CHAR_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../public/assets/characters');

const hex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

/** { width, height, data (RGBA), glb } for kit `key`. */
export async function loadAtlas(key) {
  const glb = readGlb(path.join(CHAR_DIR, key + '.glb'));
  const { data, info } = await sharp(embeddedImage(glb)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data, glb };
}

/** cell id -> { mean: '#rrggbb', top: '#rrggbb', bottom: '#rrggbb' } (sampled down the cell's middle). */
export function cellColors(atlas) {
  const out = {};
  const cw = atlas.width / ATLAS_GRID.cols;
  const ch = atlas.height / ATLAS_GRID.rows;
  const px = (x, y) => {
    const o = (Math.floor(y) * atlas.width + Math.floor(x)) * 4;
    return [atlas.data[o], atlas.data[o + 1], atlas.data[o + 2]];
  };
  for (let r = 0; r < ATLAS_GRID.rows; r++)
    for (let c = 0; c < ATLAS_GRID.cols; c++) {
      const sum = [0, 0, 0];
      let n = 0;
      for (let y = r * ch; y < (r + 1) * ch; y += 4)
        for (let x = c * cw; x < (c + 1) * cw; x += 4) {
          px(x, y).forEach((v, i) => (sum[i] += v));
          n++;
        }
      out[cellId(r, c)] = { mean: hex(...sum.map((v) => v / n)), top: hex(...px(c * cw + cw * 0.4, r * ch + 4)), bottom: hex(...px(c * cw + cw * 0.4, (r + 1) * ch - 4)) };
    }
  return out;
}

/** [{ name, skinned, parent, cells: { cell: vertexCount } }] for every mesh node. */
export function meshCells(atlas) {
  return meshNodes(atlas.glb).map((m) => {
    const cells = {};
    for (const [u, v] of accessor(atlas.glb, m.primitive.attributes.TEXCOORD_0)) {
      const id = cellId(Math.min(ATLAS_GRID.rows - 1, Math.floor(v * ATLAS_GRID.rows)), Math.min(ATLAS_GRID.cols - 1, Math.floor(u * ATLAS_GRID.cols)));
      cells[id] = (cells[id] || 0) + 1;
    }
    return { name: m.name, skinned: m.skinned, parent: m.parent, cells };
  });
}
