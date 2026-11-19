// BENTONVILLE ROYALE — skin recipes: the data side of outfits (schema, region names, limits).
//
// Pure data + validation with no imports, so the account server (via Cosmetics.js), the tests
// and the skin tools can all read it. Character.js does the building (three.js).
//
// A skin def (Cosmetics.SKINS entry) is { name, model, tint, rarity, price } plus, optionally:
//
//   parts:  { head, hat, body, arms, legs, cape } -> kit key ('player'|'bot_a'|'bot_b'|'bot_c')
//           or null (only hat / cape may be null: no hat / no cape). Unlisted slots keep the
//           `model` kit's own part. All four kits share one skeleton, so any part fits any body.
//   colors: { region: '#rrggbb' } recolours named atlas regions (REGIONS below) of every kit
//           in use that has that region. 'kit.region' targets one kit ('bot_c.robe'), and a
//           raw atlas cell ('r1c1' = row 1, column 1; or 'bot_a.r1c1') works for anything the
//           table does not name. The colour is the cell's new average; its shading is kept.
//   addons: [{ shape | preset, bone, pos, rot, scale, color, color2, mirror, ... }] procedural
//           pieces (unit-sized primitives, metres, degrees) riding a bone. See ADDON_SHAPES,
//           ADDON_PRESETS, ADDON_BONES and LIMITS.
//   tint:   0xRRGGBB (or '#rrggbb') multiplied over everything after recolouring (as before).
//
// normalizeSkin(def) turns any def (old or new) into one resolved form and lists problems;
// tools/skins/README.md documents the format with examples.

export const RECIPE_KITS = ['player', 'bot_a', 'bot_b', 'bot_c'];
export const PART_SLOTS = ['head', 'hat', 'body', 'arms', 'legs', 'cape'];
/** Slots that may be null (worn without). */
export const OPTIONAL_SLOTS = ['hat', 'cape'];
/** Rigid (non-skinned) slots and the bone they ride, as in the source files. */
export const RIGID_SLOT_BONE = { hat: 'head', cape: 'chest' };

/** Mesh node names of each kit's part per slot (manifest.json / the GLBs). */
export const KIT_PARTS = {
  player: {
    head: ['Rogue_Head_Hooded'], // head and hood are one mesh
    hat: [],
    body: ['Rogue_Body'],
    arms: ['Rogue_ArmLeft', 'Rogue_ArmRight'],
    legs: ['Rogue_LegLeft', 'Rogue_LegRight'],
    cape: ['Rogue_Cape'],
  },
  bot_a: {
    head: ['Knight_Head'],
    hat: ['Knight_Helmet'],
    body: ['Knight_Body'],
    arms: ['Knight_ArmLeft', 'Knight_ArmRight'],
    legs: ['Knight_LegLeft', 'Knight_LegRight'],
    cape: ['Knight_Cape'],
  },
  bot_b: {
    head: ['Barbarian_Head'],
    hat: ['Barbarian_Hat'],
    body: ['Barbarian_Body'],
    arms: ['Barbarian_ArmLeft', 'Barbarian_ArmRight'],
    legs: ['Barbarian_LegLeft', 'Barbarian_LegRight'],
    cape: ['Barbarian_Cape'],
  },
  bot_c: {
    head: ['Mage_Head'],
    hat: ['Mage_Hat'],
    body: ['Mage_Body'],
    arms: ['Mage_ArmLeft', 'Mage_ArmRight'],
    legs: ['Mage_LegLeft', 'Mage_LegRight'],
    cape: ['Mage_Cape'],
  },
};

/** Every kit's texture is an 8 x 4 grid of gradient swatch cells (128 x 256 px in 1024²). */
export const ATLAS_GRID = { cols: 8, rows: 4 };
export const CELL_RE = /^r([0-3])c([0-7])$/;
export const cellId = (row, col) => `r${row}c${col}`;

/**
 * Named recolour regions per kit: region -> { cells, slots? }. cells: atlas cells ('rRcC');
 * slots: only parts in these slots are recoloured (the same cell is often shared, e.g. the
 * rogue's green is hood, sleeves, tunic trim and cape). Hand-checked with
 * `node tools/skins/render.mjs --probe <kit>` and `--swatches <kit>`; tests check every cell
 * listed is used by that slot's meshes.
 */
export const REGIONS = {
  // Hooded Rogue
  player: {
    skin: { cells: ['r0c0'] },
    hair: { cells: ['r0c1'] }, // brows (the hood covers the hair)
    eyes: { cells: ['r0c2'] },
    metal: { cells: ['r0c3'] }, // belt buckle
    leather: { cells: ['r0c5'] }, // belt and shoulder straps
    belt: { cells: ['r0c5'], slots: ['body'] },
    pouch: { cells: ['r0c6'] },
    shirt: { cells: ['r1c0'] }, // tunic
    tunic: { cells: ['r1c0'] },
    hood: { cells: ['r1c1'], slots: ['head'] },
    hat: { cells: ['r1c1'], slots: ['head'] }, // = hood
    cloak: { cells: ['r1c1'], slots: ['body', 'arms', 'cape'] }, // scarf, sleeve trims, cape
    cape: { cells: ['r1c1'], slots: ['cape'] },
    pants: { cells: ['r1c7'] },
    boots: { cells: ['r2c3'] },
    gloves: { cells: ['r2c5'] },
    hands: { cells: ['r2c5'] }, // = gloves
  },
  // Square Knight
  bot_a: {
    skin: { cells: ['r0c0'] },
    hair: { cells: ['r0c1'] },
    eyes: { cells: ['r0c2'] },
    armor: { cells: ['r0c3'], slots: ['body', 'arms', 'legs'] },
    shirt: { cells: ['r0c3'], slots: ['body', 'arms'] }, // the torso plate (main colour)
    helmet: { cells: ['r0c3'], slots: ['hat'] },
    hat: { cells: ['r0c3'], slots: ['hat'] }, // = helmet
    chainmail: { cells: ['r0c4'] },
    leather: { cells: ['r0c6'] },
    belt: { cells: ['r0c6'], slots: ['body'] },
    trim: { cells: ['r0c7'] }, // dark plate edges, helmet crest, collar
    cape: { cells: ['r1c0'], slots: ['body', 'cape'] },
    badge: { cells: ['r1c1'] }, // chest emblem
    metal: { cells: ['r1c2'] }, // belt buckle
    pants: { cells: ['r1c7'] },
  },
  // Barbarian
  bot_b: {
    skin: { cells: ['r0c0'] },
    hair: { cells: ['r0c1'] }, // beard and brows
    beard: { cells: ['r0c1'] },
    eyes: { cells: ['r0c2'], slots: ['head'] },
    metal: { cells: ['r0c3'] }, // studs, belt boss
    leather: { cells: ['r0c6'] }, // belt, straps, bracers
    belt: { cells: ['r0c6'], slots: ['body'] },
    fur: { cells: ['r0c7'] }, // bear hat, fur cape
    hat: { cells: ['r0c7'], slots: ['hat'] },
    cape: { cells: ['r0c7'], slots: ['body', 'cape'] },
    shirt: { cells: ['r1c0', 'r1c1'] }, // tunic and sleeves
    tunic: { cells: ['r1c0', 'r1c1'] },
    trim: { cells: ['r1c2'], slots: ['body', 'arms', 'legs'] }, // white fur trims
    teeth: { cells: ['r1c2'], slots: ['hat'] }, // the bear hat's teeth
    pants: { cells: ['r1c7'] },
    boots: { cells: ['r2c3'] },
    gloves: { cells: ['r2c7'] }, // hand wraps
    hands: { cells: ['r2c7'] },
  },
  // Mage
  bot_c: {
    skin: { cells: ['r0c0'] },
    hair: { cells: ['r0c1'] },
    eyes: { cells: ['r0c2'] },
    metal: { cells: ['r0c3'] }, // buttons, hat buckle
    trim: { cells: ['r0c4'] }, // cuffs and hem
    belt: { cells: ['r0c5'], slots: ['body'] },
    hatband: { cells: ['r0c5'], slots: ['hat'] },
    shirt: { cells: ['r1c0'] }, // robe
    robe: { cells: ['r1c0'] },
    hat: { cells: ['r1c1'], slots: ['head', 'hat'] },
    cape: { cells: ['r1c2'] },
    pants: { cells: ['r1c7'] },
    pouch: { cells: ['r2c2'] }, // book pouch on the belt
    boots: { cells: ['r2c3'] },
    hands: { cells: ['r2c7'] }, // bare hands (skin tone; `skin` is the head only)
    gloves: { cells: ['r2c7'] },
  },
};

/**
 * Bones addons can ride: recipe name -> three.js node name (GLTFLoader drops the dots).
 * Frames at rest: +Y up the bone, +Z the way the character faces (check in the skin lab).
 */
export const ADDON_BONES = {
  head: 'head',
  chest: 'chest',
  spine: 'spine',
  hips: 'hips',
  'hand.l': 'handslotl',
  'hand.r': 'handslotr',
  'upperarm.l': 'upperarml',
  'upperarm.r': 'upperarmr',
  'lowerarm.l': 'lowerarml',
  'lowerarm.r': 'lowerarmr',
  'upperleg.l': 'upperlegl',
  'upperleg.r': 'upperlegr',
  'lowerleg.l': 'lowerlegl',
  'lowerleg.r': 'lowerlegr',
  'foot.l': 'footl',
  'foot.r': 'footr',
};

/**
 * Unit primitives (fit a 1 m cube, centred; `scale` sizes them in metres) and their exact
 * triangle counts as built by src/render/SkinAddons.js (a test checks the two agree).
 *   box        cube
 *   sphere     ball
 *   dome       upper half ball (flat side down)
 *   cylinder   upright; taper: top radius as a fraction of the bottom one (default 1)
 *   cone       upright, tip up
 *   torus      ring lying flat (XZ); tube: thickness as a fraction of the diameter (default 0.2); arc: degrees (default 360)
 *   capsule    upright pill
 *   band       open ring wall (headbands, visors); arc: degrees (default 360), centred on +Z
 */
export const ADDON_SHAPES = {
  box: 12,
  sphere: 120,
  dome: 70,
  cylinder: 40,
  cone: 20,
  torus: 168,
  capsule: 140,
  band: 32,
};

/**
 * Presets: small assemblies of primitives sized for the head bone. Head bone = base of the
 * skull; on every kit the head spans about x -0.43..0.43, y 0..0.8 (top), z -0.4..0.42 (face
 * front), metres. `color` paints the main pieces, `color2` the accents. Scale / move / turn a
 * preset like any addon (its scale multiplies the whole assembly).
 */
export const ADDON_PRESETS = {
  horns: [
    { shape: 'cone', pos: [0.32, 0.72, 0.04], rot: [10, 0, -38], scale: [0.14, 0.38, 0.14], paint: 1 },
    { shape: 'cone', pos: [-0.32, 0.72, 0.04], rot: [10, 0, 38], scale: [0.14, 0.38, 0.14], paint: 1 },
  ],
  visor: [
    { shape: 'band', pos: [0, 0.3, 0], scale: [0.94, 0.17, 0.92], arc: 150, paint: 1 },
    { shape: 'box', pos: [0, 0.39, 0.45], scale: [0.5, 0.04, 0.05], paint: 2 },
  ],
  crown: [
    { shape: 'band', pos: [0, 0.8, 0], scale: [0.52, 0.14, 0.52], paint: 1 },
    { shape: 'cone', pos: [0, 0.94, 0.24], scale: [0.1, 0.16, 0.1], paint: 1 },
    { shape: 'cone', pos: [0.23, 0.94, 0.07], scale: [0.1, 0.16, 0.1], paint: 1 },
    { shape: 'cone', pos: [-0.23, 0.94, 0.07], scale: [0.1, 0.16, 0.1], paint: 1 },
    { shape: 'cone', pos: [0.14, 0.94, -0.19], scale: [0.1, 0.16, 0.1], paint: 1 },
    { shape: 'cone', pos: [-0.14, 0.94, -0.19], scale: [0.1, 0.16, 0.1], paint: 1 },
    { shape: 'sphere', pos: [0, 0.8, 0.265], scale: [0.08, 0.08, 0.04], paint: 2 },
  ],
  mask: [
    { shape: 'dome', pos: [0, 0.3, 0.33], rot: [90, 0, 0], scale: [0.8, 0.26, 0.42], paint: 1 },
    { shape: 'sphere', pos: [0.15, 0.36, 0.45], scale: [0.14, 0.09, 0.04], paint: 2 },
    { shape: 'sphere', pos: [-0.15, 0.36, 0.45], scale: [0.14, 0.09, 0.04], paint: 2 },
  ],
  ears: [
    { shape: 'cone', pos: [0.3, 0.82, 0], rot: [0, 0, -20], scale: [0.24, 0.32, 0.08], paint: 1 },
    { shape: 'cone', pos: [-0.3, 0.82, 0], rot: [0, 0, 20], scale: [0.24, 0.32, 0.08], paint: 1 },
    { shape: 'cone', pos: [0.3, 0.8, 0.035], rot: [0, 0, -20], scale: [0.13, 0.2, 0.04], paint: 2 },
    { shape: 'cone', pos: [-0.3, 0.8, 0.035], rot: [0, 0, 20], scale: [0.13, 0.2, 0.04], paint: 2 },
  ],
  antenna: [
    { shape: 'cylinder', pos: [0.14, 0.92, 0], rot: [0, 0, -15], scale: [0.035, 0.3, 0.035], paint: 1 },
    { shape: 'cylinder', pos: [-0.14, 0.92, 0], rot: [0, 0, 15], scale: [0.035, 0.3, 0.035], paint: 1 },
    { shape: 'sphere', pos: [0.18, 1.07, 0], scale: [0.11, 0.11, 0.11], paint: 2 },
    { shape: 'sphere', pos: [-0.18, 1.07, 0], scale: [0.11, 0.11, 0.11], paint: 2 },
  ],
};

/** Per-skin caps (each bone with addons is one extra draw call per character). */
export const LIMITS = {
  addons: 8, // addon entries in a recipe
  primitives: 32, // after presets and mirroring
  triangles: 2400, // all addon triangles together (a kit body is ~4,500)
  addonBones: 4, // distinct bones carrying addons (draw calls)
  colors: 24, // colour entries
  pos: 1.5, // |pos| per axis, metres from the bone
  scaleMin: 0.005,
  scaleMax: 2, // metres per axis
  presetScaleMax: 3, // a preset's own scale multiplier
};

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** '#rrggbb' | 'rrggbb' | 0xRRGGBB -> integer, else null. */
export function parseColor(v) {
  if (isNum(v) && v >= 0 && v <= 0xffffff && Math.floor(v) === v) return v;
  if (typeof v === 'string') {
    const m = HEX_RE.exec(v.trim());
    if (m) return parseInt(m[1], 16);
  }
  return null;
}

/** The `model` kit's own parts for every slot (a skin without `parts`). */
export function defaultParts(model) {
  const out = {};
  for (const s of PART_SLOTS) out[s] = KIT_PARTS[model][s].length ? model : null;
  return out;
}

function vec3(v, def, errors, label, lo, hi) {
  if (v == null) return def.slice();
  const a = isNum(v) ? [v, v, v] : v;
  if (!Array.isArray(a) || a.length !== 3 || !a.every(isNum)) {
    errors.push(`${label}: expected a number or [x, y, z]`);
    return def.slice();
  }
  return a.map((x, i) => {
    if (x < lo || x > hi) {
      errors.push(`${label}[${i}] = ${x} is outside ${lo}..${hi}`);
      return Math.min(hi, Math.max(lo, x));
    }
    return x;
  });
}

function normPrim(p, errors, label, colors) {
  const shape = p.shape;
  if (!Object.prototype.hasOwnProperty.call(ADDON_SHAPES, shape)) {
    errors.push(`${label}: unknown shape ${JSON.stringify(shape)}`);
    return null;
  }
  const out = {
    shape,
    pos: vec3(p.pos, [0, 0, 0], errors, label + '.pos', -LIMITS.pos, LIMITS.pos),
    rot: vec3(p.rot, [0, 0, 0], errors, label + '.rot', -360, 360),
    scale: vec3(p.scale, [0.1, 0.1, 0.1], errors, label + '.scale', LIMITS.scaleMin, LIMITS.scaleMax),
    color: colors[p.paint === 2 ? 1 : 0],
  };
  if (p.taper != null) out.taper = isNum(p.taper) ? Math.min(4, Math.max(0, p.taper)) : 1;
  if (p.tube != null) out.tube = isNum(p.tube) ? Math.min(0.45, Math.max(0.02, p.tube)) : 0.2;
  if (p.arc != null) out.arc = isNum(p.arc) ? Math.min(360, Math.max(10, p.arc)) : 360;
  return out;
}

const ADDON_KEYS = new Set(['shape', 'preset', 'bone', 'pos', 'rot', 'scale', 'color', 'color2', 'mirror', 'taper', 'tube', 'arc', 'name']);

/**
 * One recipe addon -> { bone, pos, rot, scale, mirror, prims: [...] } (prims in the addon's
 * own frame), or null when unusable. Problems are pushed to `errors`.
 */
export function normalizeAddon(a, i, errors) {
  const label = `addons[${i}]`;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    errors.push(`${label}: not an object`);
    return null;
  }
  for (const k of Object.keys(a)) if (!ADDON_KEYS.has(k)) errors.push(`${label}: unknown field ${JSON.stringify(k)}`);
  const bone = a.bone == null ? 'head' : a.bone;
  if (!Object.prototype.hasOwnProperty.call(ADDON_BONES, bone)) {
    errors.push(`${label}: unknown bone ${JSON.stringify(bone)}`);
    return null;
  }
  const c1 = a.color == null ? 0xffc21f : parseColor(a.color);
  const c2 = a.color2 == null ? 0x1b1d24 : parseColor(a.color2);
  if (c1 == null) errors.push(`${label}.color: expected '#rrggbb'`);
  if (c2 == null) errors.push(`${label}.color2: expected '#rrggbb'`);
  const colors = [c1 ?? 0xffc21f, c2 ?? 0x1b1d24];
  let prims;
  let scale;
  if (a.preset != null) {
    const src = Object.prototype.hasOwnProperty.call(ADDON_PRESETS, a.preset) ? ADDON_PRESETS[a.preset] : null;
    if (!src) {
      errors.push(`${label}: unknown preset ${JSON.stringify(a.preset)}`);
      return null;
    }
    prims = src.map((p, j) => normPrim(p, errors, `${label}.preset[${j}]`, colors)).filter(Boolean);
    scale = vec3(a.scale, [1, 1, 1], errors, label + '.scale', 0.05, LIMITS.presetScaleMax);
  } else {
    const p = normPrim({ ...a, pos: null, rot: null, paint: 1 }, errors, label, colors);
    if (!p) return null;
    prims = [p];
    // a lone primitive's scale is its size: keep it on the primitive, unit on the addon
    p.scale = vec3(a.scale, [0.1, 0.1, 0.1], errors, label + '.scale', LIMITS.scaleMin, LIMITS.scaleMax);
    scale = [1, 1, 1];
  }
  return {
    bone,
    pos: vec3(a.pos, [0, 0, 0], errors, label + '.pos', -LIMITS.pos, LIMITS.pos),
    rot: vec3(a.rot, [0, 0, 0], errors, label + '.rot', -360, 360),
    scale,
    mirror: !!a.mirror,
    prims,
  };
}

/** Triangles of normalized addons (what SkinAddons.js will build). */
export function addonTriangles(addons) {
  let n = 0;
  for (const a of addons) for (const p of a.prims) n += ADDON_SHAPES[p.shape] * (a.mirror ? 2 : 1);
  return n;
}

/** [kit, region-or-cell] pairs a colours key refers to. */
function regionTargets(key, model, kitsInUse) {
  // 'kit.name' -> that kit only; plain name -> every kit in use that has it (raw cells: the model kit)
  const dot = key.indexOf('.');
  if (dot > 0) {
    const kit = key.slice(0, dot);
    const name = key.slice(dot + 1);
    return RECIPE_KITS.includes(kit) ? [[kit, name]] : [];
  }
  if (CELL_RE.test(key)) return [[model, key]];
  return kitsInUse.map((k) => [k, key]);
}

const SKIN_KEYS = new Set(['name', 'model', 'tint', 'rarity', 'price', 'parts', 'colors', 'addons', 'note', 'idle', 'gear']);
// optional standing-still pose (Character idlePose); null = the kit's own idle
export const IDLE_POSES = ['paws'];
// optional extra gear drawn outside the recipe system (Character / render/FurGear.js)
export const GEAR = ['furPaws'];

/**
 * Any skin def -> {
 *   model, parts: { slot: kit|null }, tint: int|null,
 *   paint: { kit: { slot: { cell: int } } }  (recolour per part),
 *   addons: [normalized], triangles, custom (needs more than a tint), errors: [], warnings: []
 * }. Never throws; bad values are dropped or clamped and reported.
 */
export function normalizeSkin(def) {
  const errors = [];
  const warnings = [];
  const d = def && typeof def === 'object' ? def : {};
  for (const k of Object.keys(d)) if (!SKIN_KEYS.has(k)) warnings.push(`unknown field ${JSON.stringify(k)}`);
  const model = RECIPE_KITS.includes(d.model) ? d.model : 'player';
  if (d.gear != null && !GEAR.includes(d.gear)) errors.push(`gear ${JSON.stringify(d.gear)} is not known (${GEAR.join(', ')})`);
  if (d.idle != null && !IDLE_POSES.includes(d.idle)) errors.push(`idle ${JSON.stringify(d.idle)} is not a pose (${IDLE_POSES.join(', ')})`);
  if (d.model != null && model !== d.model) errors.push(`model ${JSON.stringify(d.model)} is not a kit`);
  let tint = null;
  if (d.tint != null) {
    tint = parseColor(d.tint);
    if (tint == null) errors.push('tint: expected 0xRRGGBB or "#rrggbb"');
  }

  const parts = defaultParts(model);
  let custom = false;
  if (d.parts != null) {
    if (typeof d.parts !== 'object' || Array.isArray(d.parts)) errors.push('parts: expected an object');
    else
      for (const [slot, kit] of Object.entries(d.parts)) {
        if (!PART_SLOTS.includes(slot)) {
          errors.push(`parts.${slot}: unknown slot`);
          continue;
        }
        if (kit === null) {
          if (!OPTIONAL_SLOTS.includes(slot)) errors.push(`parts.${slot}: only ${OPTIONAL_SLOTS.join(' / ')} can be null`);
          else parts[slot] = null;
          continue;
        }
        if (!RECIPE_KITS.includes(kit)) {
          errors.push(`parts.${slot}: unknown kit ${JSON.stringify(kit)}`);
          continue;
        }
        if (!KIT_PARTS[kit][slot].length) {
          errors.push(`parts.${slot}: kit ${kit} has no ${slot}`);
          continue;
        }
        parts[slot] = kit;
      }
    for (const s of PART_SLOTS) if (parts[s] !== defaultParts(model)[s]) custom = true;
  }

  const kitsInUse = [...new Set(PART_SLOTS.map((s) => parts[s]).filter(Boolean))];
  const paint = {};
  if (d.colors != null) {
    if (typeof d.colors !== 'object' || Array.isArray(d.colors)) errors.push('colors: expected an object');
    else {
      const entries = Object.entries(d.colors);
      if (entries.length > LIMITS.colors) errors.push(`colors: ${entries.length} entries (max ${LIMITS.colors})`);
      for (const [key, value] of entries.slice(0, LIMITS.colors)) {
        const c = parseColor(value);
        if (c == null) {
          errors.push(`colors.${key}: expected '#rrggbb'`);
          continue;
        }
        let hit = false;
        for (const [kit, name] of regionTargets(key, model, kitsInUse)) {
          const region = CELL_RE.test(name) ? { cells: [name] } : Object.prototype.hasOwnProperty.call(REGIONS[kit], name) ? REGIONS[kit][name] : null;
          if (!region) continue;
          for (const slot of PART_SLOTS) {
            if (parts[slot] !== kit) continue;
            if (region.slots && !region.slots.includes(slot)) continue;
            hit = true;
            const pk = (paint[kit] = paint[kit] || {});
            const p = (pk[slot] = pk[slot] || {});
            for (const cell of region.cells) p[cell] = c;
          }
        }
        if (!hit) warnings.push(`colors.${key}: no such region on the parts worn (${kitsInUse.join(' / ')}); ignored`);
      }
    }
  }
  if (Object.keys(paint).length) custom = true;

  const addons = [];
  if (d.addons != null) {
    if (!Array.isArray(d.addons)) errors.push('addons: expected an array');
    else {
      if (d.addons.length > LIMITS.addons) errors.push(`addons: ${d.addons.length} entries (max ${LIMITS.addons})`);
      d.addons.slice(0, LIMITS.addons).forEach((a, i) => {
        const n = normalizeAddon(a, i, errors);
        if (n) addons.push(n);
      });
    }
  }
  // enforce the caps by dropping trailing addons (never building over budget)
  const kept = [];
  let tris = 0;
  let prims = 0;
  const bones = new Set();
  for (const a of addons) {
    const t = addonTriangles([a]);
    const p = a.prims.length * (a.mirror ? 2 : 1);
    const nb = new Set(bones).add(a.bone);
    if (tris + t > LIMITS.triangles || prims + p > LIMITS.primitives || nb.size > LIMITS.addonBones) {
      errors.push(`addon on ${a.bone} dropped: over the per-skin cap (${LIMITS.triangles} triangles, ${LIMITS.primitives} primitives, ${LIMITS.addonBones} bones)`);
      continue;
    }
    kept.push(a);
    tris += t;
    prims += p;
    bones.add(a.bone);
  }
  if (kept.length) custom = true;

  return { model, parts, tint, paint, addons: kept, triangles: tris, custom, errors, warnings };
}

/** Stable string for a { cell: color } map (texture cache key). */
export function paintKey(map) {
  return Object.keys(map || {})
    .sort()
    .map((c) => c + ':' + map[c].toString(16).padStart(6, '0'))
    .join(',');
}

/**
 * Recolours an RGBA pixel buffer (row 0 = top, like the PNG and glTF UVs) in place: every
 * pixel of each listed cell becomes `color * luminance(pixel) / luminance(cell average)`, so
 * the swatch's gradient and stripe survive in the new colour. Deterministic, no DOM.
 */
export function recolorPixels(data, width, height, map) {
  const cw = width / ATLAS_GRID.cols;
  const ch = height / ATLAS_GRID.rows;
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (const cell of Object.keys(map).sort()) {
    const m = CELL_RE.exec(cell);
    if (!m) continue;
    const row = +m[1];
    const col = +m[2];
    const x0 = Math.round(col * cw);
    const x1 = Math.round((col + 1) * cw);
    const y0 = Math.round(row * ch);
    const y1 = Math.round((row + 1) * ch);
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * width + x) * 4;
        sum += lum(data[o], data[o + 1], data[o + 2]);
        n++;
      }
    const avg = Math.max(1, sum / Math.max(1, n));
    const tr = (map[cell] >> 16) & 255;
    const tg = (map[cell] >> 8) & 255;
    const tb = map[cell] & 255;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const o = (y * width + x) * 4;
        const k = lum(data[o], data[o + 1], data[o + 2]) / avg;
        data[o] = Math.min(255, Math.round(tr * k));
        data[o + 1] = Math.min(255, Math.round(tg * k));
        data[o + 2] = Math.min(255, Math.round(tb * k));
      }
  }
  return data;
}

/** URL-safe base64 of a recipe (the skin lab's ?recipe=), and back. */
export function encodeRecipe(obj) {
  const s = JSON.stringify(obj);
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : globalThis.Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeRecipe(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const s = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : globalThis.Buffer.from(b64, 'base64').toString('utf8');
  return JSON.parse(s);
}
