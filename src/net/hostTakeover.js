// BENTONVILLE ROYALE — Box Fights host migration: the pure conversions (no Three.js, no DOM).
//
// When the host of a lobby Box Fight leaves, the relay (party/server.js, party/relayMigration.js)
// promotes one guest's socket. That guest (ClientSession._promoted) rebuilds the authoritative
// match from what it already knows as a client and becomes the host (Game.takeOverAsHost +
// HostSession.adoptMatch). This module turns the client's view into the host's starting state:
//
//   actorRow(puppetLike)                -> plain row (id, name, human, team, position, vitals, stats)
//   takeoverPlan({ myId, actors, guests, replaced }) -> { remotes, bots, left }
//       remotes: humans still connected (relay roster) -> RemoteActors on the new host
//       bots:    bots (kept as bots) + humans who are gone (the old host, or anyone not in the roster)
//                -> local bots under the same actor id; a gone human's bot gets a fresh "Bot X" name
//                   and `replaced` = the human's name (their stats row carries on, like
//                   Game.boxReplaceLeaver)
//       left:    [{ id, name, was }] the humans a bot replaced now (sent to guests as left + rb)
//   takeoverRoundState(view)            -> round-machine state (createBoxFightState shape)
//   sanitizeReportedInventory(rep, loadout) -> a guest's own inventory report, clamped to the kit
//   difficultyFromBotElo(elo)           -> 'easy' | 'normal' | 'hard'
//   cleanMigrationEvent(e, sides)       -> guest side: the new host's 'hm' event, clamped
//
// What carries over exactly: actor ids, names, teams / sides, bot-or-human, positions, headings,
// health / shield, alive / dead, kills, damage dealt ('ts'), builds (local 'sp' replays), Box Elo,
// round number, score, elims, phase and timer, structures (the new host's own grid, with hp).
// Approximated: bots' inventories (a fresh standard kit; bots never report theirs), guests'
// inventories until their one-off report ('mig', clamped here), FFA / team elims during a fight
// (max of the last round event's tally and the side's kills), the round-end pause (restarted from
// when this client saw 're'). Nothing here is verified: the new host is another player's browser,
// exactly like the old one.

import { BOX_FIGHT, createBoxFightState } from '../game/BoxFights.js';
import { boxBotNames } from '../core/botProfile.js';
import { BOT_ELO } from '../game/BoxElo.js';
import { WEAPONS, MATERIALS, PLAYER, weaponStats } from '../core/config.js';

/** Seconds after the takeover during which a guest's one inventory report is accepted. */
export const MIGRATION_INV_WINDOW = 15;

const SLOTS = 5; // Inventory SLOT_COUNT
const int = (v, lo, hi, d = lo) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const txt = (v, d = '') => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, 16) || d : d);

/** The match's shared bot difficulty from the start message's bot Elo (nearest BOT_ELO entry). */
export function difficultyFromBotElo(elo) {
  if (!Number.isFinite(elo)) return 'normal';
  let best = 'normal';
  let gap = Infinity;
  for (const [k, v] of Object.entries(BOT_ELO)) {
    const d = Math.abs(v - elo);
    if (d < gap) {
      gap = d;
      best = k;
    }
  }
  return best;
}

/** A client-side actor (Puppet, or the local Player with human = true) as a plain row. */
export function actorRow(a, { human = null } = {}) {
  const p = a.pos || {};
  return {
    id: a.id,
    name: txt(a.name, '?'),
    human: human != null ? !!human : !!a.human,
    team: Number.isInteger(a.team) ? a.team : a.id,
    x: num(p.x),
    y: num(p.y),
    z: num(p.z),
    heading: num(a.heading),
    alive: !!a.alive,
    health: int(a.health, 0, 1000, 0),
    shield: int(a.shield, 0, 1000, 0),
    kills: int(a.kills, 0, 9999, 0),
    assists: int(a.assists, 0, 9999, 0),
    damage: int(a.damageDealt, 0, 1e7, 0),
    builds: int(a.buildsPlaced, 0, 1e6, 0),
    boxElo: Number.isFinite(a.boxElo) ? a.boxElo : undefined,
    skin: typeof a.skin === 'string' ? a.skin : null,
  };
}

/**
 * Who becomes what on the new host. actors: actorRow()s of everyone but ourselves (our own row is
 * skipped by id); guests: the relay's `promoted.guests` [{ id, name, token }]; replaced: Map(actor
 * id -> human name) of earlier leaver replacements ('rb'), so those rows keep their note; myName: our
 * own name (never given to a bot).
 */
export function takeoverPlan({ myId, myName = '', actors, guests, replaced = null }) {
  const guestIds = new Set((Array.isArray(guests) ? guests : []).map((g) => g && g.id).filter(Number.isInteger));
  const rows = (Array.isArray(actors) ? actors : []).filter((a) => a && Number.isInteger(a.id) && a.id !== myId).sort((a, b) => a.id - b.id);
  const stays = (a) => !a.human || guestIds.has(a.id);
  // names still in the match (ours too): a new bot never shares one
  const used = new Set(rows.filter(stays).map((a) => a.name));
  if (myName) used.add(myName);
  const free = boxBotNames(24).filter((n) => !used.has(n));
  const remotes = [];
  const bots = [];
  const left = [];
  for (const a of rows) {
    if (a.human && guestIds.has(a.id)) {
      remotes.push({ ...a });
      continue;
    }
    if (a.human) {
      // the old host, or a human the relay no longer lists: a bot takes over under the same id
      const name = free.shift() || 'Bot';
      bots.push({ ...a, human: false, name, replaced: a.name, boxElo: undefined, skin: null });
      left.push({ id: a.id, name, was: a.name });
      continue;
    }
    const was = replaced && replaced.get ? replaced.get(a.id) : null;
    bots.push({ ...a, replaced: typeof was === 'string' && was ? was : null });
  }
  return { remotes, bots, left };
}

/**
 * The round machine to continue from what this client saw.
 * view: { phase: 'warmup'|'fight'|'roundEnd'|'over' (client bf.phase), t (client timer), round,
 *   score, elims, winRounds, ffa, sides, sinceRoundEnd (s since the 're' we saw), killsBySide? }
 */
export function takeoverRoundState(view) {
  const v = view || {};
  const base = createBoxFightState({ winRounds: v.winRounds, ffa: !!v.ffa, sides: v.sides });
  const n = base.score.length;
  const sc = Array.isArray(v.score) ? v.score : [];
  const el = Array.isArray(v.elims) ? v.elims : [];
  const kb = Array.isArray(v.killsBySide) ? v.killsBySide : [];
  const s = {
    ...base,
    round: int(v.round, 1, 99, 1),
    score: Array.from({ length: n }, (_, i) => int(sc[i], 0, 99, 0)),
    // a kill since the last round event only reached us as a snapshot kill count
    elims: Array.from({ length: n }, (_, i) => Math.max(int(el[i], 0, 999, 0), int(kb[i], 0, 999, 0))),
  };
  const warm = Math.max(BOX_FIGHT.firstWarmup, BOX_FIGHT.warmup);
  if (v.phase === 'fight') {
    s.phase = 'fight';
    s.t = 0;
  } else if (v.phase === 'roundEnd') {
    s.phase = 'roundEnd';
    s.t = Math.max(0.5, Math.min(BOX_FIGHT.roundEndDelay, BOX_FIGHT.roundEndDelay - num(v.sinceRoundEnd)));
  } else if (v.phase === 'over') {
    // already decided by the old host: run out the end delay; the 'end' is not sent again
    s.phase = 'matchEnd';
    s.t = Math.max(0.5, Math.min(BOX_FIGHT.matchEndDelay, num(v.t, BOX_FIGHT.matchEndDelay)));
    s.winner = null;
  } else {
    s.phase = 'warmup';
    s.t = Math.max(0, Math.min(warm, num(v.t, BOX_FIGHT.warmup)));
  }
  return s;
}

/**
 * A guest's report of its own inventory after a host change (action {k:'mig', s, ammo, mats}).
 * Untrusted: only items from the round kit, each at most once, at the kit's rarity; magazine,
 * counts, ammo and materials clamped to the kit. Returns { slots, ammo, mats } or null.
 */
export function sanitizeReportedInventory(rep, loadout) {
  if (!rep || typeof rep !== 'object' || !loadout) return null;
  const kit = new Map();
  for (const it of loadout.items || []) if (it && !kit.has(it.type + ':' + it.id)) kit.set(it.type + ':' + it.id, it);
  const seen = new Set();
  const slots = Array(SLOTS).fill(null);
  const src = Array.isArray(rep.s) ? rep.s.slice(0, SLOTS) : [];
  src.forEach((r, i) => {
    if (!r || typeof r !== 'object' || (r.type !== 'weapon' && r.type !== 'consumable')) return;
    const key = r.type + ':' + r.id;
    const k = kit.get(key);
    if (!k || seen.has(key)) return;
    seen.add(key);
    if (r.type === 'weapon') {
      const st = weaponStats(k.id, k.rarity);
      const cap = Math.max(WEAPONS[k.id] ? WEAPONS[k.id].mag | 0 : 0, st ? st.mag | 0 : 0);
      slots[i] = { type: 'weapon', id: k.id, rarity: k.rarity, mag: int(r.mag, 0, cap, cap) };
    } else {
      const cap = Math.max(1, k.count | 0);
      const c = int(r.count, 0, cap, 0);
      if (c > 0) slots[i] = { type: 'consumable', id: k.id, count: c };
    }
  });
  const ammo = {};
  const ra = rep.ammo && typeof rep.ammo === 'object' ? rep.ammo : {};
  for (const [kind, cap] of Object.entries(loadout.ammo || {})) ammo[kind] = int(ra[kind], 0, cap | 0, 0);
  const mats = {};
  const rm = rep.mats && typeof rep.mats === 'object' ? rep.mats : {};
  for (const m of MATERIALS) mats[m] = int(rm[m], 0, Math.min(PLAYER.matCap || 999, (loadout.mats && loadout.mats[m]) | 0), 0);
  return { slots, ammo, mats };
}

/**
 * Guest side: the new host's resync event {e:'hm', rn, sc, el, ph, t, bx}. Returns
 * { round, score, elims, phase, t, rows } with numbers clamped; `rows` is the raw structure list
 * (ClientSession filters it into the arena like a round start). null when malformed.
 */
export function cleanMigrationEvent(e, sides = 2) {
  if (!e || typeof e !== 'object') return null;
  const n = Math.max(2, Math.min(6, sides | 0));
  const list = (a, hi) => Array.from({ length: n }, (_, i) => int(Array.isArray(a) ? a[i] : 0, 0, hi, 0));
  const phase = ['warmup', 'fight', 'roundEnd', 'matchEnd'].includes(e.ph) ? e.ph : 'fight';
  return {
    round: int(e.rn, 1, 99, 1),
    score: list(e.sc, 99),
    elims: list(e.el, 999),
    phase,
    t: Math.max(0, Math.min(10, num(e.t))),
    rows: Array.isArray(e.bx) ? e.bx.slice(0, 400) : [],
  };
}
