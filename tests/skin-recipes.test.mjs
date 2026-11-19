// Skin recipes (src/game/skinRecipe.js): every catalog outfit validates, region tables match
// the real atlases, recolouring is deterministic, addon caps hold, old outfits are unchanged,
// and Character builds kitbashed parts / addons on its own skeleton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import * as THREE from 'three';
import sharp from 'sharp';
import { SKINS, PRICES, DEFAULT_OWNED } from '../src/game/Cosmetics.js';
import {
  normalizeSkin, defaultParts, recolorPixels, encodeRecipe, decodeRecipe, addonTriangles,
  REGIONS, KIT_PARTS, PART_SLOTS, RECIPE_KITS, RIGID_SLOT_BONE, ADDON_SHAPES, ADDON_PRESETS, LIMITS, ATLAS_GRID, CELL_RE,
} from '../src/game/skinRecipe.js';
import { primitiveGeometry, addonGeometries, triangleCount } from '../src/render/SkinAddons.js';
import { Character, registerKits } from '../src/game/Character.js';
import { readGlb, accessor, embeddedImage, meshNodes } from '../tools/skins/lib/glb.mjs';

const CHAR_DIR = path.resolve('public/assets/characters');
const glbs = Object.fromEntries(RECIPE_KITS.map((k) => [k, readGlb(path.join(CHAR_DIR, k + '.glb'))]));

/** kit -> mesh name -> Set of atlas cells its UVs fall in. */
function cellUse(k) {
  const out = {};
  for (const m of meshNodes(glbs[k])) {
    const s = (out[m.name] = out[m.name] || new Set());
    for (const [u, v] of accessor(glbs[k], m.primitive.attributes.TEXCOORD_0)) {
      s.add(`r${Math.min(3, Math.floor(v * ATLAS_GRID.rows))}c${Math.min(7, Math.floor(u * ATLAS_GRID.cols))}`);
    }
  }
  return out;
}

// prices / starter items before recipe skins existed: none of them may change
const OLD_SKIN_PRICES = {
  skin_knight: 800, skin_barbarian: 800, skin_mage: 800, skin_rogue_ember: 1200, skin_mage_frost: 1200,
  skin_knight_gold: 1600, skin_barbarian_shadow: 2000, skin_rogue_moss: 1500, skin_knight_crimson: 1200,
  skin_knight_midnight: 2000, skin_barbarian_lava: 1600, skin_mage_rose: 1500,
  skin_mage_void: 2000,
};
const OLD_SKIN_LOOK = {
  skin_rogue: ['player', null], skin_knight: ['bot_a', null], skin_barbarian: ['bot_b', null], skin_mage: ['bot_c', null],
  skin_rogue_ember: ['player', 0xff8a7a], skin_mage_frost: ['bot_c', 0x9fe4ff], skin_knight_gold: ['bot_a', 0xffd36b],
  skin_barbarian_shadow: ['bot_b', 0x8a78c8], skin_rogue_moss: ['player', 0x9fe08a], skin_knight_crimson: ['bot_a', 0xff7f86],
  skin_barbarian_lava: ['bot_b', 0xffa25a], // skin_knight_midnight was restyled as a recipe (2026-11-19)
  skin_mage_rose: ['bot_c', 0xffa8d6], skin_mage_void: ['bot_c', 0x8f7bd8],
};

test('every catalog skin validates against the recipe schema (no errors, no warnings)', () => {
  for (const [id, def] of Object.entries(SKINS)) {
    const r = normalizeSkin(def);
    assert.deepEqual(r.errors, [], id + ' errors');
    assert.deepEqual(r.warnings, [], id + ' warnings');
    assert.ok(r.triangles <= LIMITS.triangles, id + ' addon triangles');
    assert.equal(typeof def.name, 'string');
    assert.ok(['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(def.rarity), id + ' rarity');
  }
});

test('old-style skins resolve to the same model, own parts and tint as before', () => {
  for (const [id, [model, tint]] of Object.entries(OLD_SKIN_LOOK)) {
    const def = SKINS[id];
    assert.ok(def, id);
    assert.equal(def.model, model, id);
    assert.equal(def.tint, tint, id);
    const r = normalizeSkin(def);
    assert.equal(r.model, model);
    assert.equal(r.tint, tint);
    assert.deepEqual(r.parts, defaultParts(model));
    assert.deepEqual(r.paint, {});
    assert.deepEqual(r.addons, []);
    assert.equal(r.custom, false, id + ' must take the plain tint path');
  }
});

test('server prices and starter items are unchanged for existing ids', () => {
  for (const [id, p] of Object.entries(OLD_SKIN_PRICES)) assert.equal(PRICES[id], p, id);
  assert.equal(PRICES.skin_rogue, undefined, 'the starter outfit stays free');
  assert.ok(DEFAULT_OWNED.includes('skin_rogue'));
  assert.ok(!DEFAULT_OWNED.includes('skin_catfish_ken'));
  for (const id of DEFAULT_OWNED) assert.ok(!PRICES[id], id + ' is free');
});

test('the demo recipe skin kitbashes, recolours and adds pieces within the caps', () => {
  const r = normalizeSkin(SKINS.skin_catfish_ken);
  assert.equal(r.custom, true);
  assert.equal(r.parts.head, 'bot_c');
  assert.equal(r.parts.legs, 'bot_b');
  assert.equal(r.parts.hat, null);
  assert.equal(r.parts.cape, null);
  assert.equal(r.paint.player.body.r1c0, 0x8a5cf0); // tunic -> violet
  assert.equal(r.paint.bot_b.legs.r1c7, 0xfff1d6); // borrowed legs follow the shared region name
  assert.ok(r.addons.length >= 1 && r.addons.length <= 3);
  assert.equal(PRICES.skin_catfish_ken, 1500);
  assert.equal(SKINS.skin_catfish_ken.rarity, 'epic');
});

test('kit part tables name real meshes: skinned body parts, hat / cape on their bones', () => {
  for (const k of RECIPE_KITS) {
    const nodes = Object.fromEntries(meshNodes(glbs[k]).map((m) => [m.name, m]));
    for (const slot of PART_SLOTS) {
      for (const n of KIT_PARTS[k][slot]) {
        assert.ok(nodes[n], `${k}: ${n} exists`);
        if (RIGID_SLOT_BONE[slot]) assert.equal(nodes[n].parent, RIGID_SLOT_BONE[slot], `${k}: ${n} rides ${RIGID_SLOT_BONE[slot]}`);
        else assert.ok(nodes[n].skinned, `${k}: ${n} is skinned`);
      }
    }
  }
});

test('all four kits share one skeleton (joint order and bind matrices), so parts swap freely', () => {
  const ref = glbs.player;
  const names = (g) => g.json.skins[0].joints.map((j) => g.json.nodes[j].name);
  const ibm = (g) => accessor(g, g.json.skins[0].inverseBindMatrices);
  for (const k of RECIPE_KITS) {
    assert.deepEqual(names(glbs[k]), names(ref), k);
    const a = ibm(glbs[k]);
    const b = ibm(ref);
    for (let i = 0; i < a.length; i++) for (let j = 0; j < 16; j++) assert.ok(Math.abs(a[i][j] - b[i][j]) < 1e-4, `${k} joint ${i}`);
  }
});

test('region tables only name atlas cells their slots really use', () => {
  for (const k of RECIPE_KITS) {
    const use = cellUse(k);
    assert.ok(Object.keys(REGIONS[k]).length >= 10, k + ' has a region table');
    for (const [name, reg] of Object.entries(REGIONS[k])) {
      assert.ok(/^[a-z]+$/.test(name), name);
      const slots = reg.slots || PART_SLOTS;
      for (const s of slots) assert.ok(PART_SLOTS.includes(s), `${k}.${name}: slot ${s}`);
      for (const cell of reg.cells) {
        assert.match(cell, CELL_RE);
        const meshes = slots.flatMap((s) => KIT_PARTS[k][s]);
        assert.ok(meshes.some((n) => use[n] && use[n].has(cell)), `${k}.${name}: ${cell} is used by ${slots.join('/')}`);
      }
      if (reg.slots) for (const s of reg.slots) assert.ok(KIT_PARTS[k][s].some((n) => reg.cells.some((c) => use[n] && use[n].has(c))), `${k}.${name}: slot ${s} has that cell`);
    }
    for (const shared of ['skin', 'hair', 'eyes', 'shirt', 'pants', 'cape', 'hat', 'metal']) assert.ok(REGIONS[k][shared], `${k} has a "${shared}" region`);
  }
});

test('recolouring is deterministic, keeps shading and touches only the listed cells', async () => {
  const { data, info } = await sharp(embeddedImage(glbs.player)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const map = { r1c0: 0x8a5cf0, r2c3: 0xffc21f };
  const a = recolorPixels(new Uint8ClampedArray(data), info.width, info.height, map);
  const b = recolorPixels(new Uint8ClampedArray(data), info.width, info.height, { r2c3: 0xffc21f, r1c0: 0x8a5cf0 });
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
  assert.equal(hash(a), hash(b), 'same map in any key order -> same pixels');
  const cw = info.width / ATLAS_GRID.cols;
  const ch = info.height / ATLAS_GRID.rows;
  const at = (buf, col, row, dx, dy) => {
    const o = ((row * ch + dy) * info.width + col * cw + dx) * 4;
    return [buf[o], buf[o + 1], buf[o + 2]];
  };
  // an untouched cell keeps its pixels
  assert.deepEqual(at(a, 0, 0, 10, 10), at(data, 0, 0, 10, 10));
  // the recoloured cell's mean is the target colour, and its gradient survives (top brighter than bottom)
  let sum = [0, 0, 0];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) at(a, 0, 1, x, y).forEach((v, i) => (sum[i] += v));
  sum = sum.map((v) => v / (cw * ch));
  // (bright texels clip at 255, so the mean can sit a little under the target)
  assert.ok(Math.abs(sum[0] - 0x8a) < 20 && Math.abs(sum[1] - 0x5c) < 20 && Math.abs(sum[2] - 0xf0) < 24, `mean ${sum.map(Math.round)}`);
  const top = at(a, 0, 1, 20, 4).reduce((x, y) => x + y);
  const bottom = at(a, 0, 1, 20, ch - 4).reduce((x, y) => x + y);
  assert.ok(top > bottom, 'shading kept');
});

test('unknown regions, kits, shapes and bad values are rejected or ignored safely', () => {
  const r = normalizeSkin({
    name: 'x', model: 'player',
    parts: { head: 'nope', body: null, hat: 'bot_a', wings: 'bot_a' },
    colors: { sparkle: '#ffffff', shirt: 'red', 'bot_a.shirt': '#00ff00', r9c9: '#ffffff' },
    addons: [{ shape: 'teapot' }, { preset: 'halo' }, { shape: 'box', bone: 'tail' }, { shape: 'box', pos: [9, 0, 0], scale: [5, 0, 0.1] }, 'x'],
  });
  assert.ok(r.errors.some((e) => /parts.head: unknown kit/.test(e)));
  assert.ok(r.errors.some((e) => /parts.body: only hat/.test(e)));
  assert.ok(r.errors.some((e) => /parts.wings/.test(e)));
  assert.ok(r.errors.some((e) => /colors.shirt/.test(e)));
  assert.ok(r.warnings.some((w) => /colors.sparkle/.test(w)));
  assert.ok(r.warnings.some((w) => /bot_a.shirt/.test(w)), 'a region on a kit that is not worn is ignored');
  assert.ok(r.warnings.some((w) => /r9c9/.test(w)));
  assert.equal(r.parts.head, 'player');
  assert.equal(r.parts.body, 'player');
  assert.equal(r.parts.hat, 'bot_a');
  assert.deepEqual(Object.keys(r.paint), []);
  assert.equal(r.addons.length, 1, 'only the clamped box survives');
  assert.deepEqual(r.addons[0].pos, [LIMITS.pos, 0, 0]);
  assert.deepEqual(r.addons[0].prims[0].scale, [LIMITS.scaleMax, LIMITS.scaleMin, 0.1]);
  for (const bad of [null, 42, 'str', [], { model: 'dragon' }]) assert.doesNotThrow(() => normalizeSkin(bad));
});

test('addon caps: count, primitives, triangles and bones are enforced', () => {
  const many = Array.from({ length: LIMITS.addons + 3 }, () => ({ shape: 'box' }));
  const r1 = normalizeSkin({ model: 'player', addons: many });
  assert.equal(r1.addons.length, LIMITS.addons);
  assert.ok(r1.errors.some((e) => /max/.test(e)));
  const heavy = Array.from({ length: LIMITS.addons }, () => ({ shape: 'torus', mirror: true }));
  const r2 = normalizeSkin({ model: 'player', addons: heavy });
  assert.ok(r2.triangles <= LIMITS.triangles);
  assert.ok(r2.addons.length < heavy.length && r2.errors.some((e) => /dropped/.test(e)));
  const bones = ['head', 'chest', 'hips', 'spine', 'hand.l', 'hand.r'].map((bone) => ({ shape: 'box', bone }));
  const r3 = normalizeSkin({ model: 'player', addons: bones });
  assert.equal(new Set(r3.addons.map((a) => a.bone)).size, LIMITS.addonBones);
});

test('addon triangle table matches the geometry SkinAddons builds', () => {
  for (const shape of Object.keys(ADDON_SHAPES)) {
    const g = primitiveGeometry({ shape, arc: 120, taper: 0.5, tube: 0.3 });
    assert.equal(triangleCount(g), ADDON_SHAPES[shape], shape);
  }
  for (const preset of Object.keys(ADDON_PRESETS)) {
    const r = normalizeSkin({ model: 'bot_a', addons: [{ preset, color: '#ffc21f', color2: '#1b1d24', mirror: preset === 'horns' }] });
    assert.deepEqual(r.errors, [], preset);
    const geos = addonGeometries(r.addons);
    let n = 0;
    for (const g of geos.values()) n += triangleCount(g);
    assert.equal(n, addonTriangles(r.addons), preset);
    assert.equal(n, r.triangles);
  }
});

test('recipes round-trip through the skin lab URL encoding', () => {
  const rec = { name: 'Ünïcode fan', model: 'bot_b', colors: { fur: '#123456' } };
  const s = encodeRecipe(rec);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeRecipe(s), rec);
});

// ---- Character: kitbash and addons on a synthetic rig (no GLB / WebGL needed)

const BONES = ['root', 'hips', 'spine', 'chest', 'head'];
function fakeKit(key) {
  const bones = BONES.map((n) => Object.assign(new THREE.Bone(), { name: n }));
  for (let i = 1; i < bones.length; i++) {
    bones[i - 1].add(bones[i]);
    bones[i].position.y = 0.3;
  }
  const rig = new THREE.Group();
  rig.name = 'Rig';
  rig.add(bones[0]);
  const mat = new THREE.MeshStandardMaterial({ name: key + '_tex' });
  for (const slot of PART_SLOTS) {
    for (const n of KIT_PARTS[key][slot]) {
      const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
      if (RIGID_SLOT_BONE[slot]) {
        const m = new THREE.Mesh(geo, mat);
        m.name = n;
        bones[BONES.indexOf(RIGID_SLOT_BONE[slot])].add(m);
        continue;
      }
      const c = geo.attributes.position.count;
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(c * 4).fill(0), 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(c).fill([1, 0, 0, 0]).flat(), 4));
      const m = new THREE.SkinnedMesh(geo, mat);
      m.name = n;
      rig.add(m);
      m.bind(new THREE.Skeleton(bones));
    }
  }
  const scene = new THREE.Group();
  scene.add(rig);
  return { scene, scale: 1, hide: new Set(), lower: {}, upper: {}, over: {}, full: {} };
}

function meshNames(ch) {
  const out = [];
  ch.model.traverse((o) => o.isMesh && out.push(o.name));
  return out.sort();
}

test('Character: an old-style skin builds exactly the plain model', () => {
  const kits = Object.fromEntries(RECIPE_KITS.map((k) => [k, fakeKit(k)]));
  registerKits(kits);
  const plain = new Character(kits.bot_a, { weapons: {}, tint: 0xffd36b });
  const viaSkin = new Character(kits.bot_a, { weapons: {}, skin: 'skin_knight_gold' });
  assert.deepEqual(meshNames(viaSkin), meshNames(plain));
  const mats = (ch) => {
    const m = [];
    ch.model.traverse((o) => o.isMesh && m.push(o.material));
    return m;
  };
  assert.deepEqual(mats(viaSkin), mats(plain), 'same shared tinted materials');
  plain.dispose();
  viaSkin.dispose();
});

test('Character: kitbashed parts ride this character\'s skeleton; addons sit on their bone', () => {
  const kits = Object.fromEntries(RECIPE_KITS.map((k) => [k, fakeKit(k)]));
  registerKits(kits);
  const recipe = {
    name: 'Bash', model: 'player',
    parts: { head: 'bot_c', hat: 'bot_a', legs: 'bot_b', cape: null },
    addons: [{ preset: 'horns', color: '#ffffff' }, { shape: 'box', bone: 'chest', scale: 0.1 }],
  };
  const ch = new Character(kits.player, { weapons: {}, skin: recipe });
  const names = meshNames(ch);
  for (const gone of ['Rogue_Head_Hooded', 'Rogue_LegLeft', 'Rogue_LegRight', 'Rogue_Cape']) assert.ok(!names.includes(gone), gone + ' removed');
  for (const kept of ['Rogue_Body', 'Rogue_ArmLeft', 'Mage_Head', 'Knight_Helmet', 'Barbarian_LegLeft', 'skin_addon_head', 'skin_addon_chest']) assert.ok(names.includes(kept), kept);
  const own = new Set(Object.values(ch.bones));
  ch.model.traverse((o) => {
    if (o.isSkinnedMesh) for (const b of o.skeleton.bones) assert.ok(own.has(b), `${o.name} is bound to this character's bones`);
  });
  assert.equal(ch.model.getObjectByName('Knight_Helmet').parent, ch.bones.head);
  assert.equal(ch.model.getObjectByName('skin_addon_head').parent, ch.bones.head);
  // two characters in the same outfit share the addon geometry
  const ch2 = new Character(kits.player, { weapons: {}, skin: recipe });
  assert.equal(ch2.model.getObjectByName('skin_addon_head').geometry, ch.model.getObjectByName('skin_addon_head').geometry);
  ch.dispose();
  ch2.dispose();
});
