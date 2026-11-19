// BENTONVILLE ROYALE — skin lab (dev only, /skinlab.html): renders outfits for visual checks.
// Nothing imports this from the game; vite builds index.html only, so it never ships.
//
// Query: ?skin=<id> | ?recipe=<base64url JSON> | ?swatches=<kit> | ?probe=<kit> | ?all=1
// Signals tools/skins/render.mjs through window.__skinlab = { ready, error, info }.

import * as THREE from 'three';
import { loadGLB, loadJSON } from '../core/assets.js';
import { CharacterKit, Character, registerKits, skinRecipe } from '../game/Character.js';
import { SKINS } from '../game/Cosmetics.js';
import { REGIONS, KIT_PARTS, PART_SLOTS, RECIPE_KITS, ATLAS_GRID, cellId, decodeRecipe } from '../game/skinRecipe.js';

const lab = (window.__skinlab = { ready: false, error: null, info: null });
const sheet = document.getElementById('sheet');
const q = new URLSearchParams(location.search);
const BACKDROP = 0xd8d3c8;
const STATE = { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: Math.PI, pitch: 0 };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

async function loadKits() {
  const manifest = await loadJSON('/assets/characters/manifest.json');
  const kits = {};
  await Promise.all(
    RECIPE_KITS.map(async (k) => {
      const info = manifest.characters[k];
      kits[k] = new CharacterKit(await loadGLB(`/assets/characters/${info.file}`), info);
    })
  );
  registerKits(kits);
  return kits;
}

// ---- rendering: one renderer, panels drawn with scissor rectangles

function makeRenderer(w, h) {
  const canvas = document.createElement('canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setPixelRatio(1);
  r.setSize(w, h);
  r.setScissorTest(true);
  return r;
}

/** The lobby showcase's light rig (src/ui/Showcase.js), turned to follow each camera. */
function lightRig() {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0xfff1d6, 0x4b2f9a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 5, 4);
  const rim = new THREE.DirectionalLight(0xff9a5a, 1.4);
  rim.position.set(-3, 2, -3);
  g.add(sun, sun.target, rim, rim.target);
  return g;
}

function stage() {
  const scene = new THREE.Scene();
  const rig = lightRig();
  scene.add(rig);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);
  return { scene, rig };
}

/** A character wearing `skin` (id or recipe), posed in idle at a fixed time. */
function dress(kits, skin) {
  const recipe = skinRecipe(skin);
  const kit = kits[recipe.model] || kits.player;
  const ch = new Character(kit, { weapons: {}, skin });
  for (let i = 0; i < 12; i++) ch.update(1 / 30, STATE);
  ch.root.updateMatrixWorld(true);
  return { ch, recipe };
}

/** Draws `scene` from azimuth `deg` (0 = front) into a panel. */
function shoot(r, scene, rig, rect, H, { deg, target, height, fov = 18 }) {
  const cam = new THREE.PerspectiveCamera(fov, rect.w / rect.h, 0.05, 50);
  const d = height / 2 / Math.tan((fov / 2) * (Math.PI / 180));
  const a = (deg * Math.PI) / 180;
  cam.position.set(target.x + Math.sin(a) * d, target.y + 0.05 * d, target.z + Math.cos(a) * d);
  cam.lookAt(target);
  rig.rotation.y = a;
  const y = H - rect.y - rect.h; // GL origin is bottom-left
  r.setViewport(rect.x, y, rect.w, rect.h);
  r.setScissor(rect.x, y, rect.w, rect.h);
  r.setClearColor(BACKDROP, 1);
  r.clear();
  r.render(scene, cam);
}

function headCentre(ch) {
  const head = ch.bones.head;
  const v = new THREE.Vector3();
  if (head) head.getWorldPosition(v);
  else v.set(0, 1.35, 0);
  v.y += 0.4;
  return v;
}

function headerBar(name, rarity, id, extra) {
  const bar = el('div', 'bar');
  bar.append(el('h1', null, name));
  if (rarity) bar.append(el('span', 'pill r-' + rarity, rarity));
  if (id) bar.append(el('span', 'id', id));
  bar.append(el('span', 'meta', extra));
  return bar;
}

function notesOf(recipe) {
  return [...recipe.errors.map((e) => 'error: ' + e), ...recipe.warnings.map((w) => 'warning: ' + w)].join('\n');
}

function partsText(recipe) {
  return PART_SLOTS.map((s) => `${s}:${recipe.parts[s] || '-'}`).join('  ');
}

// ---- modes

async function turnaround(kits, skin, id) {
  const { ch, recipe } = dress(kits, skin);
  const { scene, rig } = stage();
  scene.add(ch.root);
  const PW = 300;
  const PH = 600;
  const HW = 420;
  const W = PW * 4 + HW;
  const H = PH;
  const meta = `${partsText(recipe)}\naddon triangles ${recipe.triangles}${recipe.tint != null ? '  tint #' + recipe.tint.toString(16).padStart(6, '0') : ''}`;
  sheet.append(headerBar(skin.name || id || 'Recipe', skin.rarity, id, meta));
  const views = el('div', 'views');
  const r = makeRenderer(W, H);
  views.append(r.domElement);
  const body = { target: new THREE.Vector3(0, 1.12, 0), height: 2.7 };
  const panels = [
    ['front', 0],
    ['3/4', 40],
    ['side', 90],
    ['back', 180],
  ];
  panels.forEach(([label, deg], i) => {
    shoot(r, scene, rig, { x: i * PW, y: 0, w: PW, h: PH }, H, { deg, ...body });
    const t = el('div', 'tag', label);
    t.style.left = i * PW + 12 + 'px';
    views.append(t);
  });
  shoot(r, scene, rig, { x: PW * 4, y: 0, w: HW, h: PH }, H, { deg: 30, target: headCentre(ch), height: 1.55 });
  const t = el('div', 'tag', 'head');
  t.style.left = PW * 4 + 12 + 'px';
  views.append(t);
  sheet.append(views, el('div', 'notes', notesOf(recipe)));
  lab.info = { name: skin.name, parts: recipe.parts, triangles: recipe.triangles, errors: recipe.errors, warnings: recipe.warnings };
}

async function contactSheet(kits, entries, opts = {}) {
  const TW = opts.tw || 200;
  const TH = opts.th || 330;
  const cols = opts.cols || 6;
  const views = opts.views || [[30, 0]];
  const cellW = TW * views.length;
  const rows = Math.ceil(entries.length / cols);
  const CAP = 44;
  const W = cellW * cols;
  const H = rows * (TH + CAP);
  sheet.append(headerBar(opts.title || 'All outfits', null, null, `${entries.length} shown`));
  const wrap = el('div', 'views');
  const r = makeRenderer(W, H);
  r.setClearColor(BACKDROP, 1);
  r.setScissor(0, 0, W, H);
  r.clear();
  wrap.append(r.domElement);
  const problems = [];
  entries.forEach(([key, skin, caption, sub], i) => {
    const { ch, recipe } = dress(kits, skin);
    const { scene, rig } = stage();
    scene.add(ch.root);
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * (TH + CAP);
    views.forEach(([deg], j) => shoot(r, scene, rig, { x: x + j * TW, y, w: TW, h: TH }, H, { deg, target: new THREE.Vector3(0, 1.12, 0), height: 2.75 }));
    const c = el('div', 'cap');
    c.style.left = x + 'px';
    c.style.top = y + TH + 4 + 'px';
    c.style.width = cellW + 'px';
    c.append(el('b', null, caption));
    c.append(document.createTextNode(sub || ''));
    wrap.append(c);
    ch.dispose();
    for (const e of recipe.errors) problems.push(`${key}: ${e}`);
    for (const w of recipe.warnings) problems.push(`${key}: ${w}`);
  });
  sheet.append(wrap, el('div', 'notes', problems.join('\n')));
}

/** Which atlas cells each slot's meshes (and the kit's other gear) use. */
function cellUse(kit, key) {
  const slotOf = {};
  for (const s of PART_SLOTS) for (const n of KIT_PARTS[key][s]) slotOf[n] = s;
  const use = {}; // cell -> Set(slot)
  kit.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.uv) return;
    const slot = slotOf[o.name] || 'gear';
    const uv = o.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const c = cellId(Math.min(3, Math.floor(uv.getY(i) * ATLAS_GRID.rows)), Math.min(7, Math.floor(uv.getX(i) * ATLAS_GRID.cols)));
      (use[c] = use[c] || new Set()).add(slot);
    }
  });
  return use;
}

function atlasImage(kit) {
  let img = null;
  kit.scene.traverse((o) => {
    if (!img && o.isMesh && o.material && o.material.map) img = o.material.map.image;
  });
  return img;
}

async function swatches(kits, key) {
  const kit = kits[key];
  if (!kit) throw new Error(`unknown kit ${key} (one of ${RECIPE_KITS.join(', ')})`);
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.drawImage(atlasImage(kit), 0, 0, S, S);
  const use = cellUse(kit, key);
  const regions = REGIONS[key] || {};
  const cw = S / ATLAS_GRID.cols;
  const chh = S / ATLAS_GRID.rows;
  ctx.textBaseline = 'top';
  for (let row = 0; row < ATLAS_GRID.rows; row++)
    for (let col = 0; col < ATLAS_GRID.cols; col++) {
      const id = cellId(row, col);
      const x = col * cw;
      const y = row * chh;
      ctx.strokeStyle = 'rgba(27,29,36,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, cw - 2, chh - 2);
      const lines = [[id, '700 20px Nunito']];
      const names = Object.entries(regions)
        .filter(([, r]) => r.cells.includes(id))
        .map(([n, r]) => n + (r.slots ? ` (${r.slots.join(',')})` : ''));
      for (const n of names) lines.push([n, '400 17px "Lilita One"']);
      if (use[id]) lines.push(['uses: ' + [...use[id]].join(','), '600 13px Nunito']);
      else lines.push(['unused', '600 13px Nunito']);
      let ty = y + 8;
      for (const [text, font] of lines) {
        ctx.font = font;
        const w = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(27,29,36,0.78)';
        ctx.fillRect(x + 6, ty - 2, Math.min(cw - 12, w + 8), 22);
        ctx.fillStyle = '#fff1d6';
        ctx.fillText(text, x + 10, ty, cw - 20);
        ty += 24;
      }
    }
  sheet.append(headerBar(`Atlas: ${key}`, null, null, `${Object.keys(regions).length} regions  ·  cells rRcC (row, column)`));
  sheet.append(cv);
  lab.info = { kit: key, regions: Object.keys(regions), cellsUsed: Object.fromEntries(Object.entries(use).map(([c, s]) => [c, [...s]])) };
}

async function probe(kits, key) {
  const kit = kits[key];
  if (!kit) throw new Error(`unknown kit ${key}`);
  const use = cellUse(kit, key);
  const cells = Object.keys(use)
    .filter((c) => [...use[c]].some((s) => s !== 'gear'))
    .sort();
  const entries = cells.map((c) => [c, { name: c, model: key, colors: { [c]: '#ff00ff' } }, c, [...use[c]].filter((s) => s !== 'gear').join(',')]);
  await contactSheet(kits, entries, { title: `Probe: ${key} (each cell painted magenta)`, cols: 4, tw: 170, th: 300, views: [[20], [200]] });
}

async function main() {
  await document.fonts.ready.catch(() => {});
  const kits = await loadKits();
  if (q.get('swatches')) await swatches(kits, q.get('swatches'));
  else if (q.get('probe')) await probe(kits, q.get('probe'));
  else if (q.get('all')) {
    const entries = Object.entries(SKINS).map(([id, s]) => [id, s, s.name, `${s.rarity} · ${id}`]);
    await contactSheet(kits, entries, { title: 'All outfits' });
  } else if (q.get('recipe')) {
    let recipe;
    try {
      recipe = decodeRecipe(q.get('recipe'));
    } catch {
      throw new Error('?recipe= is not base64url JSON');
    }
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) throw new Error('recipe must be a JSON object');
    await turnaround(kits, recipe, null);
  } else {
    const id = q.get('skin') || 'skin_rogue';
    if (!SKINS[id]) throw new Error(`unknown skin id ${id}`);
    await turnaround(kits, SKINS[id], id);
  }
  // two frames so the DOM labels are laid out before the screenshot
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  lab.ready = true;
}

main().catch((e) => {
  lab.error = String((e && e.message) || e);
  sheet.append(el('div', 'notes', 'skin lab: ' + lab.error));
  lab.ready = true;
});
