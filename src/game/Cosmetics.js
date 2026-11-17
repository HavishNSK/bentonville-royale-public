// BENTONVILLE ROYALE — cosmetics catalog: outfits (skins), pickaxes, back blings and emotes.
//
// Shared by the client (shop, locker, lobby showcase, in-match characters) and the
// account server (party/accounts.js checks prices and ownership), so it imports nothing.
//
// Outfits are one of the four KayKit character models (see credits/characters.md) with an
// optional colour tint multiplied into its texture. Emotes are clips every model already
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
  skin_barbarian_shadow: { name: 'Shadow Barbarian', model: 'bot_b', tint: 0x8a78c8, rarity: 'legendary', price: 2000 },
  skin_rogue_moss: { name: 'Ozark Moss Rogue', model: 'player', tint: 0x9fe08a, rarity: 'epic', price: 1500 },
  skin_knight_crimson: { name: 'Crimson Crusader', model: 'bot_a', tint: 0xff7f86, rarity: 'rare', price: 1200 },
  skin_knight_midnight: { name: 'Midnight Knight', model: 'bot_a', tint: 0x7d86c9, rarity: 'legendary', price: 2000 },
  skin_barbarian_frost: { name: 'Frostbeard', model: 'bot_b', tint: 0xb4e8ff, rarity: 'rare', price: 1200 },
  skin_barbarian_lava: { name: 'Lava Brute', model: 'bot_b', tint: 0xffa25a, rarity: 'epic', price: 1600 },
  skin_mage_rose: { name: 'Rose Mage', model: 'bot_c', tint: 0xffa8d6, rarity: 'epic', price: 1500 },
  skin_mage_void: { name: 'Void Mage', model: 'bot_c', tint: 0x8f7bd8, rarity: 'legendary', price: 2000 },
  skin_rogue_dusk: { name: 'Dusk Runner', model: 'player', tint: 0xc9a2ff, rarity: 'rare', price: 1200 },
};

/**
 * Harvesting tools. src: null = the classic pickaxe mesh, else [kit key, mesh name] in that
 * character file (parented to handslot.r there, so it already sits in the hand). tint: colour
 * multiplied into its material.
 */
export const PICKAXES = {
  pick_default: { name: 'Default Pickaxe', src: null, tint: null, rarity: 'common', price: 0 },
  pick_frost: { name: 'Frostbite', src: null, tint: 0x9fe4ff, rarity: 'uncommon', price: 500 },
  pick_gilded: { name: 'Gilded Pick', src: null, tint: 0xffd36b, rarity: 'rare', price: 800 },
  pick_hatchet: { name: 'Bus Loop Hatchet', src: ['bot_b', '1H_Axe'], tint: null, rarity: 'uncommon', price: 500 },
  pick_dagger: { name: 'Back Alley Dagger', src: ['player', 'Knife'], tint: null, rarity: 'uncommon', price: 500 },
  pick_wand: { name: 'Sparkle Wand', src: ['bot_c', '1H_Wand'], tint: null, rarity: 'uncommon', price: 600 },
  pick_blade: { name: 'Square Blade', src: ['bot_a', '1H_Sword'], tint: null, rarity: 'rare', price: 900 },
  pick_cleaver: { name: 'Razorback Cleaver', src: ['bot_b', '2H_Axe'], tint: null, rarity: 'epic', price: 1200 },
  pick_staff: { name: 'Crystal Staff', src: ['bot_c', '2H_Staff'], tint: null, rarity: 'epic', price: 1200 },
  pick_greatsword: { name: 'Crystal Bridge Greatsword', src: ['bot_a', '2H_Sword'], tint: 0xffe08a, rarity: 'legendary', price: 1800 },
  pick_shadow: { name: 'Shadow Reaper', src: ['bot_b', '2H_Axe'], tint: 0x8a78c8, rarity: 'legendary', price: 1800 },
  pick_mug: { name: 'Root Beer Float', src: ['bot_b', 'Mug'], tint: null, rarity: 'legendary', price: 1500 },
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
  bb_cape_knight: { name: 'Knight Cape', src: ['bot_a', 'Knight_Cape', 'cape'], tint: null, rarity: 'uncommon', price: 400 },
  bb_cape_barbarian: { name: 'Fur Cape', src: ['bot_b', 'Barbarian_Cape', 'cape'], tint: null, rarity: 'uncommon', price: 400 },
  bb_cape_mage: { name: 'Mage Mantle', src: ['bot_c', 'Mage_Cape', 'cape'], tint: null, rarity: 'uncommon', price: 400 },
  bb_cape_royal: { name: 'Sunset Cape', src: ['bot_a', 'Knight_Cape', 'cape'], tint: 0xffd36b, rarity: 'epic', price: 1000 },
  bb_shield_round: { name: 'Round Shield', src: ['bot_a', 'Round_Shield', 'back'], tint: null, rarity: 'rare', price: 700 },
  bb_shield_spike: { name: 'Spike Shield', src: ['bot_a', 'Spike_Shield', 'back'], tint: null, rarity: 'epic', price: 1000 },
  bb_shield_badge: { name: 'Bentonville Badge', src: ['bot_a', 'Badge_Shield', 'back'], tint: null, rarity: 'rare', price: 800 },
  bb_spellbook: { name: 'Spellbook', src: ['bot_c', 'Spellbook', 'back'], tint: null, rarity: 'rare', price: 700 },
};

/** clip: animation name; loop: keeps going until you move; hold: clip to loop after `clip` once;
 *  once: play `clip` once and hold its last frame. */
export const EMOTES = {
  emote_cheer: { name: 'Cheer', clip: 'Cheer', loop: true, rarity: 'common', price: 0 },
  emote_sit: { name: 'Take a Seat', clip: 'Sit_Floor_Down', hold: 'Sit_Floor_Idle', rarity: 'common', price: 0 },
  emote_spin: { name: 'Whirlwind', clip: '2H_Melee_Attack_Spinning', loop: true, rarity: 'rare', price: 500 },
  emote_magic: { name: 'Magic Hands', clip: 'Spellcasting', loop: true, rarity: 'uncommon', price: 400 },
  emote_jab: { name: 'Shadow Box', clip: 'Unarmed_Melee_Attack_Punch_A', loop: true, rarity: 'uncommon', price: 300 },
  emote_kick: { name: 'High Kick', clip: 'Unarmed_Melee_Attack_Kick', loop: true, rarity: 'uncommon', price: 300 },
  emote_nap: { name: 'Nap Time', clip: 'Lie_Down', hold: 'Lie_Idle', rarity: 'rare', price: 600 },
  emote_turtle: { name: 'Turtle Up', clip: 'Blocking', loop: true, rarity: 'common', price: 200 },
  emote_hype: { name: 'Hype Jump', clip: 'Jump_Full_Long', loop: true, rarity: 'epic', price: 800 },
  emote_bow: { name: 'Take a Bow', clip: 'Interact', loop: true, rarity: 'uncommon', price: 300 },
  emote_flex: { name: 'Flex', clip: '2H_Melee_Idle', loop: true, rarity: 'common', price: 200 },
  emote_dodge: { name: 'Dodge Roll', clip: 'Dodge_Forward', loop: true, rarity: 'rare', price: 500 },
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

/** Owned by every new account. */
export const DEFAULT_OWNED = [SKINS, PICKAXES, BACKBLINGS, EMOTES].flatMap((t) => Object.keys(t).filter((k) => t[k].price === 0));
export const DEFAULT_EQUIPPED = {
  skin: 'skin_rogue',
  pickaxe: 'pick_default',
  backbling: 'bb_outfit',
  emotes: ['emote_cheer', 'emote_sit', null, null, null, null],
};

/** Loadout slot kinds: id prefix -> catalog table and the equipped field it fills. */
export const SLOTS = {
  skin: { table: SKINS, prefix: 'skin_', label: 'Outfit' },
  backbling: { table: BACKBLINGS, prefix: 'bb_', label: 'Back Bling' },
  pickaxe: { table: PICKAXES, prefix: 'pick_', label: 'Pickaxe' },
};

/** { kind: 'skin'|'pickaxe'|'backbling'|'emote', def } for any catalog id, else null. */
export function cosmeticDef(id) {
  if (!id) return null;
  if (SKINS[id]) return { kind: 'skin', def: SKINS[id] };
  if (PICKAXES[id]) return { kind: 'pickaxe', def: PICKAXES[id] };
  if (BACKBLINGS[id]) return { kind: 'backbling', def: BACKBLINGS[id] };
  if (EMOTES[id]) return { kind: 'emote', def: EMOTES[id] };
  return null;
}

export function skinDef(id) {
  return SKINS[id] || SKINS.skin_rogue;
}

export function pickaxeDef(id) {
  return PICKAXES[id] || PICKAXES.pick_default;
}

export function backblingDef(id) {
  return BACKBLINGS[id] || BACKBLINGS.bb_outfit;
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

/** Daily shop rotation: `n` items picked by date (same for everyone that day). */
export function featuredToday(n = 4, date = new Date()) {
  const ids = Object.keys(PRICES);
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

/** A loadout as one short string for the party lobby: "skin|pickaxe|backbling". */
export function lookString(eq = {}) {
  return [eq.skin || DEFAULT_EQUIPPED.skin, eq.pickaxe || DEFAULT_EQUIPPED.pickaxe, eq.backbling || DEFAULT_EQUIPPED.backbling].join('|');
}

/** lookString() back to { skin, pickaxe, backbling } (unknown parts fall back to defaults). */
export function parseLook(s) {
  const [skin, pickaxe, backbling] = String(s || '').split('|');
  return {
    skin: SKINS[skin] ? skin : DEFAULT_EQUIPPED.skin,
    pickaxe: PICKAXES[pickaxe] ? pickaxe : DEFAULT_EQUIPPED.pickaxe,
    backbling: BACKBLINGS[backbling] ? backbling : DEFAULT_EQUIPPED.backbling,
  };
}
