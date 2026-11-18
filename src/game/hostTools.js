// BENTONVILLE ROYALE — private-match host tools: the sandbox WEAPONS / BOTS panels, for the host
// of a private match only (Game.toggleSandboxLoadout / toggleSandboxBots on the M map).
//
// Gate (canHostTools): a HostSession that is a private match (main.js startHostedMatch passes
// privateMatch: true; matchmade games do not), the match has started, not free build, state
// 'play'. Clients never get these: there is no client->host message for them; the host calls
// them locally and the results reach clients through the normal sync:
//   - bots: Bots.addBot registers them with Combat, so the ~20 Hz snapshot carries them; the
//     HostSession 'ab' event tells clients to create a puppet for the new id ('rb' removes).
//   - loot: Loot.drop -> Loot._add, which HostSession wraps, so every client gets an 'la' record.
//
// Host bots are ordinary hostile match bots (sandbox: false): each is its own team, they can
// eliminate anyone, count toward alive counts and the win condition, and drop loot like any bot.
import { WEAPONS, AMMO, CONSUMABLES, clampWeaponRarity } from '../core/config.js';
import { SANDBOX_BOT_CAP, SANDBOX_BOT_DIFFS, sandboxBotLoadout, sandboxWeapons, botSpotInFront } from './sandboxLoadout.js';

/** Live host-spawned bots at once (same bound as the sandbox). */
export const HOST_BOT_CAP = SANDBOX_BOT_CAP;
/** Snapshot actor ids are one byte (protocol.encodeSnapshot), so a new bot's id must stay below this. */
export const HOST_BOT_MAX_ID = 255;
/** A gun drop comes with this many ammo pickups' worth of its ammo. */
export const HOST_LOOT_AMMO_PICKUPS = 3;
/** Metres in front of the host that chosen loot lands. */
export const HOST_LOOT_DIST = 2.5;

/** This peer hosts a started private match and is playing (not free build). */
export function canHostTools(game) {
  const net = game && game.net;
  return !!(net && net.isHost && !net.isClient && net.privateMatch && net.started && !net.ended && !game.freeBuild && game.state === 'play');
}

function hostBotList(game) {
  const list = game && game.bots ? game.bots.list || game.bots.actors || [] : [];
  return list.filter((a) => a && a.hostSpawned);
}

/** { count, cap, canSpawn, reason, bodies } for the BOTS panel. */
export function hostBotStatus(game) {
  const mine = hostBotList(game);
  const count = mine.filter((a) => a.alive).length;
  const bodies = mine.length - count;
  let reason = null;
  if (!canHostTools(game)) reason = 'Private match host only';
  else if (game.player && !game.player.alive) reason = 'You are out of the match';
  else if (count >= HOST_BOT_CAP) reason = `Bot limit reached (${HOST_BOT_CAP}) — clear some first`;
  return { count, cap: HOST_BOT_CAP, canSpawn: !reason, reason, bodies };
}

/** Next unused actor id (never reused this match), or -1 when the one-byte id space is full. */
function nextBotId(game) {
  let id = (game._hostBotLastId || 0) + 1;
  for (const a of game.combat ? game.combat.actors : []) if (a && a.id >= id) id = a.id + 1;
  for (const a of game.bots.list || []) if (a && a.id >= id) id = a.id + 1;
  return id <= HOST_BOT_MAX_ID ? id : -1;
}

/** Removes host bots `pred` accepts and tells clients. Returns how many went. */
function removeHostBots(game, pred) {
  const bots = game && game.bots;
  if (!bots || !bots.removeBots) return 0;
  const ids = [];
  const n = bots.removeBots((a) => {
    const ok = !!a.hostSpawned && pred(a);
    if (ok) ids.push(a.id);
    return ok;
  });
  if (ids.length && game.net && game.net.removeSpawnedBots) game.net.removeSpawnedBots(ids);
  return n;
}

/**
 * One hostile bot of difficulty `d` about SANDBOX_BOT_DIST m in front of the host, armed with
 * sandboxBotLoadout(d), on its own team. Dead host bots are removed first (their slot and id
 * room). Returns { bot, reason }.
 */
export function spawnHostBot(game, d) {
  if (!SANDBOX_BOT_DIFFS.includes(d)) return { bot: null, reason: 'Unknown difficulty' };
  const status = hostBotStatus(game);
  if (!status.canSpawn) return { bot: null, reason: status.reason };
  const { bots, player: p, world } = game;
  if (!p || !bots || !bots.addBot || !world) return { bot: null, reason: 'Match not ready' };
  removeHostBots(game, (a) => !a.alive);
  const id = nextBotId(game);
  if (id < 0) return { bot: null, reason: 'No room for more players' };
  const { x, z } = botSpotInFront(game);
  game._hostBotSeq = (game._hostBotSeq || 0) + 1;
  const bot = bots.addBot(d, x, z, {
    id,
    name: `${d[0].toUpperCase()}${d.slice(1)} Bot ${game._hostBotSeq}`,
    loadout: sandboxBotLoadout(d),
    team: id, // its own team: hostile to everyone, like a solo match bot
    heading: Math.atan2(p.pos.x - x, -(p.pos.z - z)),
    sandbox: false,
  });
  if (!bot) return { bot: null, reason: 'Could not spawn a bot' };
  bot.hostSpawned = true;
  game._hostBotLastId = id;
  game.totalActors = (game.totalActors || 0) + 1;
  if (game.teamMode && game.totalTeams != null) game.totalTeams += 1;
  if (game.net && game.net.announceSpawnedBot) game.net.announceSpawnedBot(bot);
  return { bot, reason: null };
}

/** Removes every host-spawned bot (alive or dead). Returns how many went. */
export function clearHostBots(game) {
  if (!canHostTools(game)) return 0;
  return removeHostBots(game, () => true);
}

/** The floor items for catalogue entry `id`: a gun plus a stack of its ammo, or a grenade stack. */
export function hostLootItems(id) {
  if (!sandboxWeapons().some((w) => w.id === id)) return [];
  const c = CONSUMABLES[id];
  if (c && c.throwable) return [{ type: 'consumable', id, count: c.stack }];
  const w = WEAPONS[id];
  if (!w) return [];
  const items = [{ type: 'weapon', id, rarity: clampWeaponRarity(id, 'legendary'), mag: w.mag }];
  if (w.ammo && AMMO[w.ammo]) items.push({ type: 'ammo', ammo: w.ammo, count: (AMMO[w.ammo].pickup || 30) * HOST_LOOT_AMMO_PICKUPS });
  return items;
}

/**
 * Drops catalogue item `id` on the floor HOST_LOOT_DIST m in front of the host (Loot.drop), so
 * clients get it as an ordinary loot record and anyone can pick it up. Returns the new record ids.
 */
export function dropHostLoot(game, id) {
  if (!canHostTools(game) || !game.loot || !game.loot.drop || !game.player) return [];
  if (!game.player.alive) return [];
  const p = game.player;
  const at = {
    x: p.pos.x + Math.sin(p.heading) * HOST_LOOT_DIST,
    y: p.pos.y,
    z: p.pos.z - Math.cos(p.heading) * HOST_LOOT_DIST,
  };
  const out = [];
  for (const item of hostLootItems(id)) {
    const rid = game.loot.drop(item, at);
    if (rid != null) out.push(rid);
  }
  return out;
}
