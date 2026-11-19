#!/usr/bin/env node
// Lists a kit's atlas swatch cells: colour, which meshes (slots) use them, and the region
// names src/game/skinRecipe.js gives them. Use it (with `render.mjs --probe <kit>`) to write or
// check a REGIONS table.
//
//   node tools/skins/swatches.mjs            all four kits
//   node tools/skins/swatches.mjs bot_b      one kit
//   node tools/skins/swatches.mjs --json     machine-readable

import { loadAtlas, cellColors, meshCells } from './lib/atlas.mjs';
import { RECIPE_KITS, KIT_PARTS, PART_SLOTS, REGIONS } from '../../src/game/skinRecipe.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const kits = args.filter((a) => !a.startsWith('--'));
for (const k of kits) {
  if (!RECIPE_KITS.includes(k)) {
    console.error(`unknown kit ${k} (one of ${RECIPE_KITS.join(', ')})`);
    process.exit(2);
  }
}

const report = {};
for (const key of kits.length ? kits : RECIPE_KITS) {
  const atlas = await loadAtlas(key);
  const colors = cellColors(atlas);
  const slotOf = {};
  for (const s of PART_SLOTS) for (const n of KIT_PARTS[key][s]) slotOf[n] = s;
  const cells = {};
  for (const m of meshCells(atlas)) {
    for (const [cell, n] of Object.entries(m.cells)) {
      const c = (cells[cell] = cells[cell] || { ...colors[cell], meshes: {}, slots: new Set(), regions: [] });
      c.meshes[m.name] = n;
      c.slots.add(slotOf[m.name] || 'gear');
    }
  }
  for (const [name, r] of Object.entries(REGIONS[key])) for (const cell of r.cells) if (cells[cell]) cells[cell].regions.push(name + (r.slots ? `(${r.slots.join(',')})` : ''));
  report[key] = Object.fromEntries(Object.keys(cells).sort().map((c) => [c, { ...cells[c], slots: [...cells[c].slots] }]));
}

if (json) console.log(JSON.stringify(report, null, 2));
else
  for (const [key, cells] of Object.entries(report)) {
    console.log(`\n== ${key}`);
    for (const [cell, c] of Object.entries(cells)) {
      const used = Object.entries(c.meshes).map(([n, v]) => `${n}:${v}`).join(' ');
      console.log(`${cell}  mean ${c.mean} (${c.top} -> ${c.bottom})  slots ${c.slots.join(',').padEnd(18)} regions ${c.regions.join(' ') || '-'}\n      ${used}`);
    }
  }
