// BENTONVILLE ROYALE — cosmetics catalog: outfits (skins) and emotes.
//
// Shared by the client (shop, locker, lobby showcase, in-match characters) and the
// account server (party/accounts.js checks prices and ownership), so it imports nothing.
//
// Outfits are one of the four KayKit character models (see credits/characters.md) with an
// optional colour tint multiplied into its texture. Emotes are clips every model already
// carries (all four share one skeleton and the same 76 clips).

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
};

/** clip: animation name; loop: keeps going until you move; hold: clip to loop after `clip` once. */
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
};

export const EMOTE_SLOTS = 6;

/** Everything sold in the shop, id -> price (the server's source of truth). */
export const PRICES = {};
for (const [id, s] of Object.entries(SKINS)) if (s.price > 0) PRICES[id] = s.price;
for (const [id, e] of Object.entries(EMOTES)) if (e.price > 0) PRICES[id] = e.price;

/** Owned by every new account. */
export const DEFAULT_OWNED = [
  ...Object.keys(SKINS).filter((k) => SKINS[k].price === 0),
  ...Object.keys(EMOTES).filter((k) => EMOTES[k].price === 0),
];
export const DEFAULT_EQUIPPED = { skin: 'skin_rogue', emotes: ['emote_cheer', 'emote_sit', null, null, null, null] };

export function skinDef(id) {
  return SKINS[id] || SKINS.skin_rogue;
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
