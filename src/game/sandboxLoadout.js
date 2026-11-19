// BENTONVILLE ROYALE — sandbox gun picker. Menu-only; never used in a match.
import { WEAPON_IDS, WEAPONS, AMMO, CONSUMABLES, PLAYER, MATERIALS, weaponRarities, clampWeaponRarity } from '../core/config.js';

export function canSandboxLoadout(game) {
  return !!(game && game.freeBuild && (game.state === 'play' || game.state === 'over'));
}

/** Sandbox-only full map (N). Match play keeps M. */
export function canCreativeMap(game) {
  return !!(game && game.freeBuild && (game.state === 'play' || game.state === 'drop') && !game.paused);
}

/** Every gun the game defines, plus throwable grenades, with the rarities they actually come in. */
export function sandboxWeapons() {
  const throws = ['grenade', 'smoke']
    .map((id) => CONSUMABLES[id])
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name, icon: c.icon, rarities: [c.rarity] }));
  const guns = WEAPON_IDS.map((id) => ({
    id,
    name: WEAPONS[id].name,
    icon: WEAPONS[id].icon,
    rarities: weaponRarities(id),
  }));
  const rocket = guns.find((w) => w.id === 'rocket_launcher');
  const rest = guns.filter((w) => w.id !== 'rocket_launcher');
  return [...throws, rocket, ...rest].filter(Boolean);
}

/**
 * Put `id` in the first empty hotbar slot (or swap the selected one). Guns get a full mag
 * plus reserve ammo; grenades get a full stack. Returns the stored item, or null when unknown.
 */
export function giveSandboxWeapon(inv, id, rarity = 'rare') {
  if (!inv) return null;
  const consumable = CONSUMABLES[id];
  if (consumable && consumable.throwable) {
    const item = { type: 'consumable', id, count: consumable.stack };
    inv.add(item);
    if (inv.selected < 0) {
      const i = inv.slots.findIndex((s) => s && s.type === 'consumable' && s.id === id);
      if (i >= 0) inv.select(i);
    }
    return inv.slots.find((s) => s && s.type === 'consumable' && s.id === id) || item;
  }
  const w = WEAPONS[id];
  if (!w) return null;
  const item = { type: 'weapon', id, rarity: clampWeaponRarity(id, rarity), mag: w.mag };
  inv.add(item);
  if (w.ammo && AMMO[w.ammo]) inv.add({ type: 'ammo', ammo: w.ammo, count: AMMO[w.ammo].cap || 999 });
  if (inv.selected < 0) {
    const i = inv.slots.findIndex((s) => s && s.type === 'weapon' && s.id === id);
    if (i >= 0) inv.select(i);
  }
  return inv.slots.find((s) => s && s.type === 'weapon' && s.id === id) || item;
}

// ---------------------------------------------------------------- sandbox bots
// The BOTS section of the sandbox overlay (Game.spawnSandboxBot / clearSandboxBots): spawn an
// Easy / Normal / Hard bot near the player. Sandbox is solo-only (Game.startMatch never gives a
// multiplayer host free build), and spawning is refused whenever a net session exists, so no
// bot ever reaches the network. SANDBOX_BOT_CAP bounds live bots (the bot sim, characters and
// their builds); dead ones free their slot and their bodies are removed shortly after.

export const SANDBOX_BOT_CAP = 12;
export const SANDBOX_BOT_DIST = 25; // metres in front of you a new bot appears (+-1 m so they don't stack)
export const SANDBOX_BOT_DIFFS = Object.freeze(['easy', 'normal', 'hard']);
export const SANDBOX_BOT_TEAM = -77; // every sandbox bot is on one team: they all hunt the player
export const SANDBOX_BOT_FFA_TEAM = -1000; // "bots fight each other": bot n is on team -1000 - n (its own)

/** The team a sandbox bot gets: the shared one, or its own when bots fight each other. */
export function sandboxBotTeam(game, seq) {
  return game && game.sandboxBotsHostile ? SANDBOX_BOT_FFA_TEAM - seq : SANDBOX_BOT_TEAM;
}

/**
 * Sandbox toggle: bots fight each other (each on its own team) or stay one team that only hunts
 * the player. Applies to the bots already out too; a bot that was fighting one that is now a
 * teammate drops it. Returns the new setting.
 */
export function setSandboxBotsHostile(game, on) {
  if (!game) return false;
  game.sandboxBotsHostile = !!on;
  const list = game.bots ? game.bots.list || game.bots.actors || [] : [];
  for (const a of list) {
    if (!a || !a.sandbox) continue;
    a.team = sandboxBotTeam(game, a.sandboxSeq || 0);
    const b = a._bot;
    if (!b || on) continue;
    for (const k of ['target', 'threat', 'hunt']) if (b[k] && b[k].sandbox) b[k] = null;
    if (b.grudge && b.grudge.actor && b.grudge.actor.sandbox) b.grudge = null;
    if (b.target == null) b.targetVisible = false;
  }
  return game.sandboxBotsHostile;
}
export const SANDBOX_CORPSE_TIME = 6; // s a dead sandbox bot's body stays before it is removed

/** Free build in the open world (not Museum Mode), playing, solo. */
export function canSandboxBots(game) {
  return !!(game && game.freeBuild && !game.museumMode && game.state === 'play' && !game.net);
}

/** Live sandbox bots in `bots` (a Bots instance or its actor list). */
export function sandboxBotCount(bots) {
  const list = bots ? bots.list || bots.actors || bots : [];
  let n = 0;
  for (const a of list) if (a && a.sandbox && a.alive) n++;
  return n;
}

/**
 * What the BOTS section shows: { count, cap, canSpawn, reason, bodies }. reason is a short line when
 * spawning is not possible (null otherwise).
 */
export function sandboxBotStatus(game) {
  const count = game && game.bots ? sandboxBotCount(game.bots) : 0;
  let reason = null;
  if (!canSandboxBots(game)) reason = game && game.museumMode ? 'Not in Museum Mode' : 'Sandbox only';
  else if (count >= SANDBOX_BOT_CAP) reason = `Bot limit reached (${SANDBOX_BOT_CAP}) — clear some first`;
  let bodies = 0;
  const list = game && game.bots ? game.bots.list || game.bots.actors || [] : [];
  for (const a of list) if (a && a.sandbox && !a.alive) bodies++;
  return { count, cap: SANDBOX_BOT_CAP, canSpawn: !reason, reason, bodies, hostile: !!(game && game.sandboxBotsHostile) };
}

/** A basic loadout for a sandbox bot of difficulty `d`: a rifle (+ a shotgun above easy), ammo, a medkit. Mats: infinite (spawnSandboxBot). */
export function sandboxBotLoadout(d) {
  const rarity = d === 'hard' ? 'epic' : d === 'normal' ? 'rare' : 'common';
  const items = [{ type: 'weapon', id: 'rifle', rarity, mag: WEAPONS.rifle.mag }];
  if (d !== 'easy') items.push({ type: 'weapon', id: 'shotgun', rarity: clampWeaponRarity('shotgun', rarity), mag: WEAPONS.shotgun.mag });
  items.push({ type: 'consumable', id: 'medkit', count: 1 });
  return {
    items,
    ammo: { medium: 240, shells: 30 },
    mats: {}, // topped up to the cap while it lives (bot.infiniteMats, like the player in Sandbox)
    selected: 0,
  };
}

/**
 * Spawns one sandbox bot of difficulty `d` on open ground 9-15 m in front of the player
 * (game.bots.addBot), armed with sandboxBotLoadout(d), on SANDBOX_BOT_TEAM (they all hunt the
 * player, not each other). Refused (bot null, reason set) outside the open-world sandbox, with
 * a net session, for an unknown difficulty, or at SANDBOX_BOT_CAP live bots.
 * Returns { bot, reason }.
 */
export function spawnSandboxBot(game, d) {
  if (!SANDBOX_BOT_DIFFS.includes(d)) return { bot: null, reason: 'Unknown difficulty' };
  const status = sandboxBotStatus(game);
  if (!status.canSpawn) return { bot: null, reason: status.reason };
  const bots = game.bots;
  const p = game.player;
  const world = game.world;
  if (!p || !bots || !bots.addBot || !world) return { bot: null, reason: 'Sandbox not ready' };
  purgeSandboxBodies(game, true); // make room: bodies go before a new bot comes in
  const rng = game.rng || Math.random;
  let x = p.pos.x + Math.sin(p.heading) * SANDBOX_BOT_DIST;
  let z = p.pos.z - Math.cos(p.heading) * SANDBOX_BOT_DIST;
  for (let i = 0; i < 16; i++) {
    const a = p.heading + (rng() - 0.5) * 1.4;
    const r = SANDBOX_BOT_DIST - 1 + rng() * 2;
    const cx = p.pos.x + Math.sin(a) * r;
    const cz = p.pos.z - Math.cos(a) * r;
    if (world.inBounds && !world.inBounds(cx, cz, 20)) continue;
    if (world.blockedAt && world.blockedAt(cx, cz, 1.2)) continue;
    if (world.areaAt && world.areaAt(cx, cz) === 'water') continue;
    x = cx;
    z = cz;
    break;
  }
  game._sandboxBotSeq = (game._sandboxBotSeq || 0) + 1;
  const bot = bots.addBot(d, x, z, {
    name: `${d[0].toUpperCase()}${d.slice(1)} Bot ${game._sandboxBotSeq}`,
    loadout: sandboxBotLoadout(d),
    team: sandboxBotTeam(game, game._sandboxBotSeq),
    heading: Math.atan2(p.pos.x - x, -(p.pos.z - z)),
    sandbox: true,
  });
  if (bot) {
    bot.sandboxSeq = game._sandboxBotSeq;
    bot.infiniteMats = true; // Sandbox: build freely, like the player (Bots tops it up)
    for (const m of MATERIALS) bot.inventory.mats[m] = PLAYER.matCap;
  }
  return { bot, reason: null };
}

/** Removes every sandbox bot (alive or dead). Returns how many went. */
export function clearSandboxBots(game) {
  const bots = game && game.bots;
  return bots && bots.removeBots ? bots.removeBots((a) => !!a.sandbox) : 0;
}

/** Removes dead sandbox bots whose body has lain SANDBOX_CORPSE_TIME s (all: every dead one). */
export function purgeSandboxBodies(game, all = false) {
  const bots = game && game.bots;
  if (!bots || !bots.removeBots) return 0;
  return bots.removeBots((a) => !!a.sandbox && !a.alive && (all || !a._bot || a._bot.deadTime > SANDBOX_CORPSE_TIME));
}
