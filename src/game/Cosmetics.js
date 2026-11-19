// BENTONVILLE ROYALE — cosmetics catalog: outfits (skins), pickaxes, back blings and emotes.
//
// Shared by the client (shop, locker, lobby showcase, in-match characters) and the
// account server (party/accounts.js checks prices and ownership), so it imports nothing.
//
// Outfits are one of the four KayKit character models (see credits/characters.md) with an
// optional colour tint multiplied into its texture, or a recipe on top of one: body parts
// borrowed from the other kits, recoloured atlas regions and small procedural addons
// (`parts` / `colors` / `addons`, see src/game/skinRecipe.js and tools/skins/README.md).
// Emotes are clips every model already
// carries (all four share one skeleton and the same 76 clips). Pickaxes and back blings reuse
// the rigid accessory meshes inside those same files (src: [kit key, mesh name]), so every
// model can wear any of them (Character.setLoadout).

/** model: kit key in Game.kits / manifest.json; tint: 0xRRGGBB multiplied into the texture. */
export const SKINS = {
  skin_rogue: { name: 'Hooded Rogue', model: 'player', tint: null, rarity: 'common', price: 0 },
  skin_knight: { name: 'Square Knight', model: 'bot_a', tint: null, rarity: 'uncommon', price: 800 },
  skin_barbarian: { name: 'Bus Loop Barbarian', model: 'bot_b', tint: null, rarity: 'uncommon', price: 800 },
  skin_mage: { name: 'Crystal Mage', model: 'bot_c', tint: null, rarity: 'uncommon', price: 800 },
  skin_rogue_ember: { name: 'Ember Rogue', model: 'player', tint: 0xff8a7a, rarity: 'rare', price: 1200 },
  skin_mage_frost: { name: 'Frost Mage', model: 'bot_c', tint: 0x9fe4ff, rarity: 'rare', price: 1200 },
  skin_knight_gold: { name: 'Golden Knight', model: 'bot_a', tint: 0xffd36b, rarity: 'epic', price: 1600 },
  // Primal Barbarian (was Shadow Barbarian; same id so owners keep it): a tiger pelt in place of the bear,
  // black stripes on the head and down the back, white fangs, a gold collar. An exclusive legendary.
  skin_barbarian_shadow: {
    name: 'Primal Barbarian',
    model: 'bot_b',
    tint: null,
    rarity: 'legendary',
    price: 7500,
    colors: {
      fur: '#f2841a', hat: '#f2841a', cape: '#f2841a', teeth: '#fff6e6', tunic: '#3a2418', leather: '#1b1d24', trim: '#1b1d24',
      hair: '#5a3418', pants: '#fff1d6', boots: '#1b1d24', gloves: '#fff1d6', metal: '#ffc21f',
    },
    addons: [
      { shape: 'box', bone: 'head', pos: [0.13, 0.85, 0.02], rot: [0, 0, 12], scale: [0.05, 0.06, 0.42], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'head', pos: [0, 0.8, 0.3], rot: [40, 0, 0], scale: [0.05, 0.06, 0.2], color: '#15161b' },
      { shape: 'box', bone: 'head', pos: [0.4, 0.62, 0], rot: [0, 0, -14], scale: [0.05, 0.22, 0.08], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'head', pos: [0.395, 0.5, -0.22], rot: [0, 0, -14], scale: [0.05, 0.18, 0.08], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'chest', pos: [0.17, -0.12, -0.32], rot: [0, 0, 28], scale: [0.26, 0.055, 0.04], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'chest', pos: [0.17, -0.33, -0.335], rot: [0, 0, 28], scale: [0.26, 0.055, 0.04], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'chest', pos: [0.17, -0.54, -0.35], rot: [0, 0, 28], scale: [0.24, 0.055, 0.04], color: '#15161b', mirror: true },
      { shape: 'torus', bone: 'chest', pos: [0, 0.2, 0.06], rot: [80, 0, 0], scale: [0.66, 0.66, 0.66], tube: 0.09, color: '#ffc21f' },
    ],
  },
  skin_rogue_moss: { name: 'Ozark Moss Rogue', model: 'player', tint: 0x9fe08a, rarity: 'epic', price: 1500 },
  skin_knight_crimson: { name: 'Crimson Crusader', model: 'bot_a', tint: 0xff7f86, rarity: 'rare', price: 1200 },
  // a living shadow: vantablack armour, near-black cape, gunmetal trim and cold glowing eyes
  skin_knight_midnight: {
    name: 'Vanta Knight',
    model: 'bot_a',
    tint: null,
    rarity: 'legendary',
    price: 7500,
    colors: {
      armor: '#0b0c10', helmet: '#0b0c10', chainmail: '#121318', cape: '#07070a', leather: '#0e0f13', belt: '#0e0f13',
      pants: '#0a0b0e', badge: '#16171d', trim: '#2b2f3a', metal: '#2b2f3a', skin: '#14151b', hair: '#07070a', eyes: '#bfd0ff',
    },
  },
  // sharp dark suit, white shirt, red tie, black hair and sunglasses (knight kit without helmet or cape)
  skin_software_engineer: {
    name: 'Software Engineer',
    model: 'bot_a',
    tint: null,
    rarity: 'legendary',
    price: 7500,
    parts: { hat: null, cape: null },
    colors: {
      armor: '#262a33', chainmail: '#1e2129', cape: '#262a33', pants: '#262a33', leather: '#15161b', belt: '#15161b',
      trim: '#30343f', badge: '#30343f', metal: '#9aa0aa', hair: '#15161b',
    },
    addons: [
      { shape: 'box', bone: 'chest', pos: [0, 0.1, 0.25], scale: [0.24, 0.12, 0.04], color: '#f4f2ec' }, // shirt collar
      { shape: 'box', bone: 'chest', pos: [0, -0.06, 0.255], rot: [9, 0, 0], scale: [0.08, 0.3, 0.03], color: '#a3242c' }, // tie
      { shape: 'box', bone: 'chest', pos: [0, 0.12, 0.275], scale: [0.1, 0.07, 0.035], color: '#a3242c' }, // knot
      // big wraparound shades: lenses angled round the face, a heavy brow bar, reflection glints, arms to the ears
      { shape: 'box', bone: 'head', pos: [0.17, 0.3, 0.39], rot: [0, 12, 0], scale: [0.27, 0.16, 0.035], color: '#0b0c10', mirror: true },
      { shape: 'box', bone: 'head', pos: [0, 0.385, 0.415], scale: [0.62, 0.04, 0.04], color: '#15161b' },
      { shape: 'box', bone: 'head', pos: [0.2, 0.33, 0.41], rot: [0, 12, 35], scale: [0.13, 0.022, 0.012], color: '#7fd4ff', mirror: true },
      { shape: 'box', bone: 'head', pos: [0.38, 0.36, 0.17], rot: [0, 90, 0], scale: [0.42, 0.035, 0.03], color: '#15161b', mirror: true },
      { shape: 'box', bone: 'head', pos: [0, 0.31, 0.43], scale: [0.08, 0.03, 0.02], color: '#15161b' },
    ],
  },
  skin_barbarian_lava: { name: 'Lava Brute', model: 'bot_b', tint: 0xffa25a, rarity: 'epic', price: 1600 },
  skin_mage_rose: { name: 'Rose Mage', model: 'bot_c', tint: 0xffa8d6, rarity: 'epic', price: 1500 },
  // all hot pink: robe, hat, cape and boots in pink shades, light pink trim and buttons
  skin_mage_void: {
    name: 'Bubblegum Mage',
    model: 'bot_c',
    tint: null,
    rarity: 'legendary',
    price: 5000,
    colors: {
      robe: '#ff2e93', hat: '#ff2e93', cape: '#d10f74', trim: '#ff9ccc', hatband: '#ff6fb5', belt: '#c40a6a', metal: '#ffd1e8',
      pants: '#ff5aab', boots: '#e0147f', pouch: '#ff6fb5', hair: '#ff3ea0',
    },
  },
  // recipe skin: the reboot van's catfish colours (violet, cream, sun-gold, ink) on a kitbash
  // of the rogue's tunic, the mage's head and the barbarian's legs, with a finned cap and barbels
  skin_catfish_ken: {
    name: 'Catfish Ken Superfan',
    model: 'player',
    tint: null,
    rarity: 'epic',
    price: 1500,
    parts: { head: 'bot_c', hat: null, legs: 'bot_b', cape: null },
    colors: {
      shirt: '#8a5cf0',
      cloak: '#6a3fd0',
      leather: '#2a2540',
      metal: '#ffc21f',
      pouch: '#ffc21f',
      gloves: '#ffc21f',
      pants: '#fff1d6',
      boots: '#ffc21f',
      hair: '#3a2a20',
    },
    addons: [
      { shape: 'dome', bone: 'head', pos: [0, 0.42, -0.02], scale: [1, 0.86, 1], color: '#8a5cf0' }, // cap
      { shape: 'cone', bone: 'head', pos: [0, 0.9, -0.08], rot: [-20, 0, 0], scale: [0.05, 0.3, 0.36], color: '#ffc21f' }, // dorsal fin
      { shape: 'cylinder', bone: 'head', pos: [0.27, 0.12, 0.36], rot: [0, 0, 64], scale: [0.028, 0.3, 0.028], color: '#1b1d24', mirror: true }, // barbels
    ],
  },
  // recipe skin: Scruff, a kid with dog DNA (tools/skins/examples/scruff.json). The rogue's tunic
  // recoloured as a big dusky-purple sweater, the mage's bare head with a curly ink mop, floppy
  // dog ears, cheek blush, a ribbed sweater collar and a fluffy tail with a lighter tip
  skin_scruff: {
    name: 'Femboy Jaithra',
    model: 'player',
    idle: 'paws', // stands with both paws held up in front (Character idlePose)
    gear: 'furPaws', // realistic furry paw boots and paw gloves (render/FurGear.js)
    tint: null,
    rarity: 'legendary',
    price: 15000,
    parts: { head: 'bot_c', hat: null, cape: null },
    colors: {
      skin: '#c98a5e',
      hair: '#1b1d24',
      eyes: '#3a2418',
      shirt: '#463a58',
      cloak: '#3a3048',
      leather: '#2e2640',
      pouch: '#b9a3d6',
      metal: '#b9a3d6',
      gloves: '#f4a3c4', // under the fur paw gloves
      pants: '#2a2540',
      boots: '#f4a3c4', // under the fur boots
    },
    addons: [
      { shape: 'dome', bone: 'head', pos: [0, 0.44, -0.03], scale: [0.98, 0.8, 0.96], color: '#1b1d24' }, // curly mop
      { shape: 'cone', bone: 'head', pos: [0.17, 0.62, 0.36], rot: [118, 0, -12], scale: [0.2, 0.24, 0.12], color: '#1b1d24', mirror: true }, // fringe curls
      { shape: 'cone', bone: 'head', pos: [0, 0.66, 0.38], rot: [112, 0, 0], scale: [0.2, 0.26, 0.12], color: '#1b1d24' },
      { shape: 'capsule', bone: 'head', pos: [0.47, 0.44, -0.04], rot: [0, 0, 18], scale: [0.34, 0.5, 0.52], color: '#f29ab8', mirror: true }, // floppy ears (pink)
      { shape: 'sphere', bone: 'head', pos: [0.2, 0.17, 0.33], rot: [0, 22, 0], scale: [0.13, 0.065, 0.06], color: '#e88aa0', mirror: true }, // blush, pressed onto the cheeks
      { shape: 'torus', bone: 'chest', pos: [0, 0.2, 0.01], scale: [0.52, 0.12, 0.46], tube: 0.32, color: '#2e2640' }, // sweater collar
      { shape: 'capsule', bone: 'hips', pos: [0, 0.19, -0.46], rot: [-53, 0, 0], scale: [0.42, 0.46, 0.42], color: '#2a2228' }, // tail
      { shape: 'sphere', bone: 'hips', pos: [0, 0.33, -0.64], scale: [0.24, 0.22, 0.24], color: '#3d3442' }, // tail tuft
    ],
  },
};

/**
 * Harvesting tools. src: null = the classic pickaxe mesh, else [kit key, mesh name] in that
 * character file (parented to handslot.r there, so it already sits in the hand). tint: colour
 * multiplied into its material. swing: upper-body clips played in turn, one per hit (a combo),
 * each timed to the pickaxe's hit rate.
 */
export const PICKAXES = {
  pick_default: { name: 'Default Pickaxe', src: null, tint: null, swing: ['2H_Melee_Attack_Chop'], rarity: 'common', price: 0 },
  pick_hatchet: { name: 'Bus Loop Hatchet', src: ['bot_b', '1H_Axe'], tint: null, swing: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal'], rarity: 'uncommon', price: 500 },
  pick_dagger: { name: 'Back Alley Dagger', src: ['player', 'Knife'], tint: null, swing: ['1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Horizontal'], rarity: 'uncommon', price: 500 },
  pick_wand: { name: 'Sparkle Wand', src: ['bot_c', '1H_Wand'], tint: null, swing: ['Spellcast_Shoot', '1H_Melee_Attack_Slice_Horizontal'], rarity: 'uncommon', price: 600 },
  pick_blade: { name: 'Square Blade', src: ['bot_a', '1H_Sword'], tint: null, swing: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'], rarity: 'rare', price: 900 },
  pick_cleaver: { name: 'Razorback Cleaver', src: ['bot_b', '2H_Axe'], tint: null, swing: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'], rarity: 'epic', price: 1200 },
  pick_staff: { name: 'Crystal Staff', src: ['bot_c', '2H_Staff'], tint: null, swing: ['2H_Melee_Attack_Stab', '2H_Melee_Attack_Slice'], rarity: 'epic', price: 1200 },
  pick_greatsword: { name: 'Crystal Bridge Greatsword', src: ['bot_a', '2H_Sword'], tint: 0xffe08a, swing: ['2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin', '2H_Melee_Attack_Stab'], rarity: 'legendary', price: 1800 },
  pick_shadow: { name: 'Shadow Reaper', src: ['bot_b', '2H_Axe'], tint: 0x8a78c8, swing: ['2H_Melee_Attack_Spin', '2H_Melee_Attack_Chop'], rarity: 'legendary', price: 1800 },
  pick_paddle: { name: 'Pickleball Paddle', src: null, proc: 'paddle', tint: null, swing: ['1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Slice_Diagonal'], rarity: 'rare', price: 700 },
  pick_mug: { name: 'Root Beer Float', src: ['bot_b', 'Mug'], tint: null, swing: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B'], rarity: 'legendary', price: 1500 },
  // Scruff set: a big fuzzy pink paw on a handle (src/render/PupGear.js), bopped pads-first
  pick_paw: { name: 'Paw Pounder', src: null, proc: 'paw', tint: null, swing: ['1H_Melee_Attack_Chop', 'Unarmed_Melee_Attack_Punch_A'], rarity: 'epic', price: 5500 },
};

/**
 * Worn on the back. src: null keeps the outfit's own cape ('bb_outfit') or wears nothing
 * ('bb_none'); otherwise [kit key, mesh name, slot]: a cape rides the chest bone as in its
 * file, a 'back' item (shield, book) is moved from the hand onto the back.
 */
export const BACKBLINGS = {
  bb_outfit: { name: "Outfit's Own Cape", src: null, tint: null, rarity: 'common', price: 0 },
  bb_none: { name: 'No Back Bling', src: null, none: true, tint: null, rarity: 'common', price: 0 },
  bb_cape_rogue: { name: 'Rogue Cape', src: ['player', 'Rogue_Cape', 'cape'], tint: null, rarity: 'uncommon', price: 400 },
  bb_cape_barbarian: { name: 'Fur Cape', src: ['bot_b', 'Barbarian_Cape', 'cape'], tint: null, rarity: 'uncommon', price: 400 },
  bb_cape_royal: { name: 'Sunset Cape', src: ['bot_a', 'Knight_Cape', 'cape'], tint: 0xffd36b, rarity: 'epic', price: 1000 },
  bb_shield_round: { name: 'Round Shield', src: ['bot_a', 'Round_Shield', 'back'], tint: null, rarity: 'rare', price: 700 },
  bb_shield_spike: { name: 'Spike Shield', src: ['bot_a', 'Spike_Shield', 'back'], tint: null, rarity: 'epic', price: 1000 },
  bb_shield_badge: { name: 'Bentonville Badge', src: ['bot_a', 'Badge_Shield', 'back'], tint: null, rarity: 'common', price: 300 },
  bb_spellbook: { name: 'Spellbook', src: ['bot_c', 'Spellbook', 'back'], tint: null, rarity: 'rare', price: 700 },
  // Scruff set: a chubby rainbow gecko plush clinging to the back (proc: built in src/render/PupGear.js)
  bb_gecko: { name: 'Rainbow Gecko', src: null, proc: 'gecko', tint: null, rarity: 'epic', price: 3500 },
};

/**
 * How you come down from the bus. canopy: colour of the classic canopy over the character;
 * pose: no canopy, a body pose instead (Character.update): 'paws' belly-down with both paws held
 * up in front, 'kick' belly-down with paws up and legs kicking behind, 'spin' upright with one
 * knee up, twirling slowly.
 */
export const GLIDERS = {
  gl_default: { name: 'Classic Canopy', canopy: null, rarity: 'common', price: 0 },
  // Scruff set: dog-DNA powers, no glider needed
  gl_paws: { name: 'Paws Up', pose: 'paws', rarity: 'epic', price: 3500 },
  // legs kicking behind you, paws up, belly-down
  gl_kick: { name: 'Puppy Kick', pose: 'kick', rarity: 'epic', price: 1200 },
  // upright with one knee up, paws up, twirling slowly on the way down
  gl_spin: { name: 'Tail Spin', pose: 'spin', rarity: 'rare', price: 800 },
};

/**
 * Bundles: one purchase grants every item in `items` (the ones you don't own yet). Each item is
 * also sold on its own; the bundle costs less than all of them together, and drops in price for
 * the pieces you already own (bundlePrice). Refused when you own them all (party/accounts.js 'buy').
 */
export const BUNDLES = {
  bundle_scruff: { name: 'Femboy Jaithra Bundle', items: ['skin_scruff', 'pick_paw', 'bb_gecko', 'gl_paws'], rarity: 'legendary', price: 25000 }, // 27,500 bought separately
};

/** clip: animation name; loop: keeps going until you move; hold: clip to loop after `clip` once;
 *  once: play `clip` once and hold its last frame. */
export const EMOTES = {
  emote_cheer: { name: 'Cheer', clip: 'Cheer', loop: true, rarity: 'common', price: 0 },
  emote_sit: { name: 'Take a Seat', clip: 'Sit_Floor_Down', hold: 'Sit_Floor_Idle', rarity: 'common', price: 0 },
  emote_spin: { name: 'Whirlwind', clip: '2H_Melee_Attack_Spinning', loop: true, rarity: 'rare', price: 500 },
  emote_jab: { name: 'Shadow Box', clip: 'Unarmed_Melee_Attack_Punch_A', loop: true, rarity: 'uncommon', price: 300 },
  emote_kick: { name: 'High Kick', clip: 'Unarmed_Melee_Attack_Kick', loop: true, rarity: 'uncommon', price: 300 },
  emote_nap: { name: 'Nap Time', clip: 'Lie_Down', hold: 'Lie_Idle', rarity: 'rare', price: 600 },
  emote_turtle: { name: 'Turtle Up', clip: 'Blocking', loop: true, rarity: 'common', price: 200 },
  emote_hype: { name: 'Hype Jump', clip: 'Jump_Full_Long', loop: true, rarity: 'epic', price: 800 },
  emote_flex: { name: 'Flex', clip: '2H_Melee_Idle', loop: true, rarity: 'common', price: 200 },
  emote_slice: { name: 'Sword Dance', clip: '2H_Melee_Attack_Slice', loop: true, rarity: 'epic', price: 800 },
  emote_throw: { name: 'Fastball', clip: 'Throw', loop: true, rarity: 'uncommon', price: 300 },
  emote_dead: { name: 'Play Dead', clip: 'Death_B', once: true, rarity: 'rare', price: 600 },
};

export const EMOTE_SLOTS = 6;

/** Everything sold in the shop, id -> price (the server's source of truth). */
export const PRICES = {};
for (const [id, s] of Object.entries(SKINS)) if (s.price > 0) PRICES[id] = s.price;
for (const [id, e] of Object.entries(EMOTES)) if (e.price > 0) PRICES[id] = e.price;
for (const [id, e] of Object.entries(PICKAXES)) if (e.price > 0) PRICES[id] = e.price;
for (const [id, e] of Object.entries(BACKBLINGS)) if (e.price > 0) PRICES[id] = e.price;
for (const [id, e] of Object.entries(GLIDERS)) if (e.price > 0) PRICES[id] = e.price;
for (const [id, e] of Object.entries(BUNDLES)) PRICES[id] = e.price;

/**
 * What a bundle costs given what you already own: its price scaled by the share (by item price)
 * of the pieces you still need, rounded to 100 and never more than buying those pieces one by one.
 * 0 once you own everything in it.
 */
export function bundlePrice(id, owned = []) {
  const b = BUNDLES[id];
  if (!b) return null;
  const total = b.items.reduce((t, it) => t + (PRICES[it] || 0), 0);
  const rest = b.items.filter((it) => !owned.includes(it)).reduce((t, it) => t + (PRICES[it] || 0), 0);
  if (!rest || !total) return 0;
  return Math.min(rest, Math.round((b.price * rest) / total / 100) * 100);
}

/** Shop price of any item for an account that owns `owned` (bundles discount owned pieces). */
export function priceFor(id, owned = []) {
  return BUNDLES[id] ? bundlePrice(id, owned) : PRICES[id];
}

/** Owned by every new account. */
export const DEFAULT_OWNED = [SKINS, PICKAXES, BACKBLINGS, GLIDERS, EMOTES].flatMap((t) => Object.keys(t).filter((k) => t[k].price === 0));
export const DEFAULT_EQUIPPED = {
  skin: 'skin_rogue',
  pickaxe: 'pick_default',
  backbling: 'bb_outfit',
  glider: 'gl_default',
  emotes: ['emote_cheer', 'emote_sit', null, null, null, null],
};

/** Loadout slot kinds: id prefix -> catalog table and the equipped field it fills. */
export const SLOTS = {
  skin: { table: SKINS, prefix: 'skin_', label: 'Outfit' },
  backbling: { table: BACKBLINGS, prefix: 'bb_', label: 'Back Bling' },
  pickaxe: { table: PICKAXES, prefix: 'pick_', label: 'Pickaxe' },
  glider: { table: GLIDERS, prefix: 'gl_', label: 'Glider' },
};

/** { kind: 'skin'|'pickaxe'|'backbling'|'glider'|'bundle'|'emote', def } for any catalog id, else null. */
export function cosmeticDef(id) {
  if (!id) return null;
  if (SKINS[id]) return { kind: 'skin', def: SKINS[id] };
  if (PICKAXES[id]) return { kind: 'pickaxe', def: PICKAXES[id] };
  if (BACKBLINGS[id]) return { kind: 'backbling', def: BACKBLINGS[id] };
  if (GLIDERS[id]) return { kind: 'glider', def: GLIDERS[id] };
  if (BUNDLES[id]) return { kind: 'bundle', def: BUNDLES[id] };
  if (EMOTES[id]) return { kind: 'emote', def: EMOTES[id] };
  return null;
}

export function skinDef(id) {
  return SKINS[id] || SKINS.skin_rogue;
}

export function pickaxeDef(id) {
  return PICKAXES[id] || PICKAXES.pick_default;
}

/** Every clip a pickaxe can swing with (CharacterKit builds upper-body actions for these). */
export function swingClips() {
  const out = new Set();
  for (const d of Object.values(PICKAXES)) for (const c of d.swing || []) out.add(c);
  return [...out];
}

export function backblingDef(id) {
  return BACKBLINGS[id] || BACKBLINGS.bb_outfit;
}

export function gliderDef(id) {
  return GLIDERS[id] || GLIDERS.gl_default;
}

/** Bot `id`'s pickaxe and back bling: picked from the id, so host and clients agree. */
export function botLoadout(id) {
  const px = Object.keys(PICKAXES);
  const bb = Object.keys(BACKBLINGS);
  const h = Math.imul((id | 0) + 17, 2654435761) >>> 0;
  return { pickaxe: px[h % px.length], backbling: bb[(h >>> 8) % bb.length] };
}

export function emoteDef(id) {
  return EMOTES[id] || null;
}

/** Every clip an emote can play (Character builds actions for these). */
export function emoteClips() {
  const out = new Set();
  for (const e of Object.values(EMOTES)) {
    out.add(e.clip);
    if (e.hold) out.add(e.hold);
  }
  return [...out];
}

/**
 * Items taken out of the shop, with the price they sold for: the account server refunds owners
 * once (party/accounts.js refundRetired) and drops them from their locker. Keep entries here so
 * accounts that have not logged in since still get their coins back.
 */
export const RETIRED = Object.freeze({
  skin_rogue_dusk: 1200, // Dusk Runner
  skin_barbarian_frost: 1200, // Frostbeard
  pick_gilded: 800, // Gilded Pick
  pick_frost: 500, // Frostbite
  bb_cape_knight: 400, // Knight Cape
  bb_cape_mage: 400, // Mage Mantle
  emote_magic: 400, // Magic Hands
  emote_bow: 300, // Take a Bow
  emote_dodge: 500, // Dodge Roll
});

/**
 * Refund every retired item (Cosmetics RETIRED) the account owns: coins back at the price it sold
 * for, item out of the locker. Returns the coins refunded (0 when nothing changed). The account server
 * runs it on every account load (party/accounts.js _acc) and saves the result, so each item is refunded exactly once.
 */
export function refundRetired(acc) {
  if (!acc || !Array.isArray(acc.owned)) return 0;
  let coins = 0;
  const kept = [];
  for (const id of acc.owned) {
    if (Object.prototype.hasOwnProperty.call(RETIRED, id)) coins += RETIRED[id];
    else kept.push(id);
  }
  if (kept.length === acc.owned.length) return 0;
  acc.owned = kept;
  acc.coins = (acc.coins | 0) + coins;
  return coins;
}

/** Daily shop rotation: `n` items picked by date (same for everyone that day). */
export function featuredToday(n = 4, date = new Date()) {
  const ids = Object.keys(PRICES).filter((id) => !BUNDLES[id]); // bundles have their own shop row
  let seed = date.getUTCFullYear() * 400 + date.getUTCMonth() * 31 + date.getUTCDate();
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pool = ids.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}

/** A loadout as one short string for the party lobby: "skin|pickaxe|backbling|glider". */
export function lookString(eq = {}) {
  return [eq.skin || DEFAULT_EQUIPPED.skin, eq.pickaxe || DEFAULT_EQUIPPED.pickaxe, eq.backbling || DEFAULT_EQUIPPED.backbling, eq.glider || DEFAULT_EQUIPPED.glider].join('|');
}

/** lookString() back to { skin, pickaxe, backbling, glider } (unknown or missing parts, as in
 *  old three-part strings, fall back to defaults). */
export function parseLook(s) {
  const [skin, pickaxe, backbling, glider] = String(s || '').split('|');
  return {
    skin: SKINS[skin] ? skin : DEFAULT_EQUIPPED.skin,
    pickaxe: PICKAXES[pickaxe] ? pickaxe : DEFAULT_EQUIPPED.pickaxe,
    backbling: BACKBLINGS[backbling] ? backbling : DEFAULT_EQUIPPED.backbling,
    glider: GLIDERS[glider] ? glider : DEFAULT_EQUIPPED.glider,
  };
}
