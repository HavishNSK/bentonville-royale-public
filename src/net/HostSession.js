// BENTONVILLE ROYALE — the host side of a multiplayer match.
//
// The host's browser runs the whole simulation (bots, storm, loot, structures,
// combat, eliminations) exactly as in solo play. Each remote human is a
// RemoteActor registered with Combat, so bots, storm damage and hitscan treat
// it like anyone else. Its movement comes from the client's state packets
// (trusted within a speed bound); its actions arrive as reliable messages and
// are validated and applied here.
//
//   const s = new HostSession(room, game, { fill, mode, humanTeams });
//   (mode 'solo'|'duo'|'trio'|'squad'; humanTeams [{ ids, allowBots }] groups room slot ids,
//   host = 0, into teams; see src/game/Teams.js packHumans / assignTeams)
//   game.net = s; game.startMatch(seed)   // Game calls the hooks below
//
// Hooks Game calls: prepareMatch(game, lm) -> { botCount, idBase }, matchStarted(game),
//   update(dt), onDamage(target, amount, info), onEliminate(victim, killer, info),
//   aliveCount (null = use combat), dispose(game).
//
// Replication (see protocol.js for the binary snapshot):
// - match start: seed, roster, storm, every loot record, drop zone (one JSON message)
// - ~20 Hz: one snapshot buffer for everyone (all actors + storm)
// - events, batched per snapshot tick: shots, swings, hits, eliminations,
//   loot add/remove/open, structure place/damage/destroy, harvested props
//   destroyed, disconnects, match end
// - per-client inventory when it changes (with the last action seq it reflects)

import * as THREE from 'three';
import { PLAYER, WEAPONS, CONSUMABLES, GRENADE, PICKAXE, BUILD, MATERIALS, MATCH, REBOOT, TAU, weaponStats, weaponShotInterval } from '../core/config.js';
import { Character } from '../game/Character.js';
import { heldSlot } from '../game/Inventory.js';
import { SKINS, EMOTES, PICKAXES, BACKBLINGS } from '../game/Cosmetics.js';
import {
  SNAP_HZ, FLAG, XFLAG, EQUIP, SURF, encodeSnapshot, decodeState, seqNewer, rnd,
} from './protocol.js';
import { busPosAt, routeWire } from '../game/DropBus.js';
import { normalizeMode, packHumans, assignTeams, sameTeam, teamAlive } from '../game/Teams.js';

// Bots.js colours its canopies with this palette by spawn index (kept in sync by hand).
const BOT_CANOPY = [0x4fc3f7, 0xff7a45, 0x9ccc65, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0xa1887f];
const BOT_KITS = ['bot_a', 'bot_b', 'bot_c'];
export const HUMAN_CANOPY = [0xffc21f, 0x5ec8ff, 0xff5d8f, 0x7dff6b, 0xc08cff, 0xff6b4a, 0x4ad6c8, 0xfff07a, 0x9fa8ff, 0xff9f43, 0x26de81, 0xfd79a8, 0x74b9ff, 0xa29bfe, 0xffeaa7, 0x55efc4];

const SNAP_BACKLOG_MAX = 48 * 1024; // bytes queued in the host socket before snapshots are skipped
const MAX_SPEED = { ground: 16, freefall: 70, glide: 34, bus: 1e9, dead: 0 };
const DEV = !!(import.meta.env && import.meta.env.DEV);

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export function equipCode(id) {
  const i = EQUIP.indexOf(id);
  return i < 0 ? 0 : i;
}

/** Equipped model id for any actor kind (player, bot, remote). */
function equipOf(a) {
  if (a.isRemote) return a.equipId || 'pickaxe';
  if (a.buildPiece) return 'pickaxe';
  const it = a.inventory && a.inventory.current && a.inventory.current();
  return it ? (it.type === 'weapon' ? it.id : 'none') : 'pickaxe';
}

function flagsOf(a) {
  let f = 0;
  if (a.alive) f |= FLAG.alive;
  if (a.grounded || a.mode === 'ground') f |= FLAG.grounded;
  if (a.gliding || a.mode === 'glide') f |= FLAG.gliding;
  if (a.crouching) f |= FLAG.crouch;
  if (a.inBus || a.mode === 'bus') f |= FLAG.bus;
  if (a.emoting || a.netEmote) f |= FLAG.emote;
  if (a.ads) f |= FLAG.ads;
  const reloading = a.isRemote ? a.netReloading : a._bot ? a._bot.reloading > 0 : a.reloadT > 0;
  if (reloading) f |= FLAG.reloading;
  return f;
}

/** Item given by the QA `give` helper (dev builds only). */
export function debugItem(what, rarity = 'rare') {
  if (typeof what !== 'string') return what;
  if (WEAPONS[what]) return { type: 'weapon', id: what, rarity, mag: WEAPONS[what].mag };
  if (what === 'medkit' || what === 'tonic') return { type: 'consumable', id: what, count: 3 };
  if (what === 'grenade') return { type: 'consumable', id: 'grenade', count: 6 };
  if (what === 'smoke') return { type: 'consumable', id: 'smoke', count: CONSUMABLES.smoke.stack };
  if (MATERIALS.includes(what)) return { type: 'material', mat: what, count: 300 };
  return null;
}

export class RemoteActor {
  constructor(id, name, character, inventory) {
    this.id = id;
    this.name = name;
    this.isPlayer = false;
    this.isHuman = true;
    this.isRemote = true;
    this.team = id;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.radius = PLAYER.radius;
    this.height = PLAYER.height;
    this.health = PLAYER.maxHealth;
    this.shield = 0;
    this.alive = true;
    this.kills = 0;
    this.inventory = inventory;
    this.character = character;
    this.mode = 'bus';
    this.inBus = true;
    this.gliding = false;
    this.grounded = false;
    this.crouching = false;
    this.ads = false;
    this.equipId = 'pickaxe';
    this.netReloading = false;
    this.netEmote = false;
    this.lastFire = -1;
    this.lastSwing = -1;
    this.lastStateT = 0;
    this.lastSeq = -1;
    this.allowJump = false;
    this.ack = 0;
    this.drawPos = new THREE.Vector3();
    this.placement = 0;
    this.lastKillerName = null;
    this.downed = false;
    this.downHp = 0;
    this.knockedBy = null;
    this.reviver = null;
    this.reviveT = 0;
    this.revivingTarget = null;
  }

  get airborneDrop() {
    return this.mode === 'freefall' || this.mode === 'glide';
  }
}

export class HostSession {
  constructor(room, game, { fill = true, mode = 'solo', humanTeams = null } = {}) {
    this.room = room;
    this.game = game;
    this.isHost = true;
    this.isClient = false;
    this.fill = fill;
    this.mode = normalizeMode(mode);
    this.humanTeams = humanTeams;
    this.remotes = new Map(); // client id -> RemoteActor
    this.events = [];
    this.seq = 0;
    this.time = 0;
    this._snapAcc = 0;
    this._invAcc = 0;
    this._invSent = new Map();
    this._specSent = new Map(); // remote id -> last spectated inventory sent
    this.ended = false;
    this.started = false;
    this.stats = { t0: 0, snapBytes: 0, snaps: 0, evBytes: 0, invBytes: 0, startBytes: 0 };
    this._wrapped = false;
    this._takeBy = null;
    this._pendingLoot = [];
    this._spawning = false;

    room.onMessage = (c, msg) => this._onMessage(c, msg);
    room.onState = (c, buf) => this._onState(c, buf);
    room.onLeave = (c) => this._onLeave(c);
  }

  get aliveCount() {
    return null; // Game uses combat.aliveCount on the host
  }

  // ---------------------------------------------------------------- match setup (called by Game.startMatch)

  /** Creates remote actors; returns how many bots to spawn and their first id. */
  prepareMatch(game, lm) {
    this._wrap(game);
    this._spawning = true;
    this._clearRemotes(game);
    const humans = [...this.room.clients.values()].sort((a, b) => a.id - b.id);
    const Inventory = game.player.inventory.constructor;
    const kit = game.kits.player;
    for (const c of humans) {
      const ch = kit ? new Character(kit, { weapons: game.weaponScenes, canopyColor: HUMAN_CANOPY[c.id % HUMAN_CANOPY.length] }) : null;
      if (ch) {
        ch.root.visible = false;
        game.scene.add(ch.root);
      }
      const a = new RemoteActor(c.id, c.name, ch, new Inventory());
      // aboard the Drop Bus (Game boards the route before this runs)
      if (game.busRoute) busPosAt(game.busRoute, 0, a.pos);
      else a.pos.set(lm.x, PLAYER.dropHeight, lm.z);
      a.drawPos.copy(a.pos);
      this.remotes.set(c.id, a);
      game.combat.register(a);
    }
    game.player.name = this.room.name;
    const slots = MATCH.bots + 1;
    const maxId = humans.length ? humans[humans.length - 1].id : 0;
    const mode = normalizeMode(this.mode);
    if (mode === 'solo') return { botCount: this.fill ? Math.max(0, slots - 1 - humans.length) : 0, idBase: maxId + 1 };
    // teams: listed parties first, everyone else packed in id order; bots fill the rest
    const groups = packHumans(mode, [0, ...humans.map((c) => c.id)], this.humanTeams);
    const plan = assignTeams(mode, groups, { slots, bots: this.fill });
    for (const a of this.remotes.values()) a.team = plan.humanTeam.get(a.id);
    return { botCount: plan.botTeams.length, idBase: maxId + 1, botTeams: plan.botTeams, playerTeam: plan.humanTeam.get(0) };
  }

  /** After bots and loot exist: tell everyone. */
  matchStarted(game) {
    this._spawning = false;
    this._pendingLoot.length = 0;
    this.events.length = 0;
    if (this._wdPending) this._wdPending.clear();
    this.ended = false;
    this.started = true;
    this.room.started = true;
    this.time = 0;
    this.stats = { t0: 0, snapBytes: 0, snaps: 0, evBytes: 0, invBytes: 0, startBytes: 0 };
    this._invSent.clear();
    this._specSent.clear();
    const roster = [{ id: 0, n: game.player.name, k: 'player', c: HUMAN_CANOPY[0], h: 1, tm: game.player.team, sk: game.skin, px: game.pickaxe, bb: game.backbling }];
    for (const a of this.remotes.values()) roster.push({ id: a.id, n: a.name, k: 'player', c: HUMAN_CANOPY[a.id % HUMAN_CANOPY.length], h: 1, tm: a.team, sk: a.skin || null, px: a.pickaxeCos || null, bb: a.backbling || null });
    const idBase = game.bots.list.length ? game.bots.list[0].id : 0;
    for (const b of game.bots.list) {
      const i = b.id - idBase;
      roster.push({ id: b.id, n: b.name, k: BOT_KITS[i % BOT_KITS.length], c: BOT_CANOPY[i % BOT_CANOPY.length], h: 0, tm: b.team });
    }
    const s = game.storm;
    const loot = [];
    for (const r of game.loot ? game.loot.records : []) loot.push([r.id, r.kind, rnd(r.x), rnd(r.y), rnd(r.z), rnd(r.yaw, 3), r.opened ? 1 : 0, r.item || 0]);
    const msg = {
      t: 'start',
      seed: game.seed,
      mode: this.mode,
      diff: game.matchDifficulty || null, // bot difficulty: only 'hard' matches count toward the ranks
      roster,
      total: game.totalActors,
      zone: game.dropZone ? game.dropZone.key : null,
      bus: game.busRoute ? routeWire(game.busRoute) : null, // clients fly the identical Drop Bus
      map: game.mapId, // clients on a different map file refuse to play (stale cache / deploy)
      storm: { cx: s.cx, cz: s.cz, r: s.r, nextCx: s.nextCx, nextCz: s.nextCz, nextR: s.nextR, phase: s.phase, mode: s.mode, secondsLeft: s.secondsLeft, dps: s.dps },
      loot,
    };
    for (const c of this.room.clients.values()) {
      if (!this.remotes.has(c.id)) continue;
      this.stats.startBytes += this.room.sendTo(c.id, { ...msg, you: c.id });
    }
    // per-client byte counters measure the match from here on (the start message is reported separately)
    for (const c of this.room.clients.values()) c.bytesOut = 0;
    this.stats.t0 = performance.now();
  }

  // ---------------------------------------------------------------- wrapping host modules to capture events

  _wrap(game) {
    if (this._wrapped) return;
    this._wrapped = true;
    // remember the original methods so dispose() leaves solo play untouched
    const saved = (this._saved = []);
    const keep = (obj, k) => obj && saved.push([obj, k, Object.prototype.hasOwnProperty.call(obj, k), obj[k]]);
    keep(game.combat, 'onFire');
    keep(game.combat, 'onColliderDestroyed');
    keep(game.combat, 'onPanelDamage');
    keep(game.combat, 'onPanelBreak');
    keep(game.combat, 'swingPickaxe');
    keep(game.grenades, 'onThrow');
    keep(game.grenades, 'onExplode');
    for (const k of ['_add', 'take', 'open', 'smash']) keep(game.loot, k);
    for (const k of ['place', 'damage', '_destroy', 'edit', 'setDoor']) keep(game.structures, k);
    const siteDoors = game.world && game.world.siteDoors;
    if (siteDoors) keep(siteDoors, 'setOpen');
    const ev = (e) => this.started && !this._spawning && this.events.push(e);
    const combat = game.combat;
    combat.onFire = (shooter, wid, origin, records, dirs, ballistic) => {
      if (!this.started) return;
      if (ballistic) {
        // sniper rounds: clients fly their own copy from the origin and direction
        const d = (dirs || []).slice(0, 1).map((v) => [rnd(v.x, 5), rnd(v.y, 5), rnd(v.z, 5)]);
        ev({ e: 'sh', a: shooter ? shooter.id : -1, w: wid, o: [rnd(origin.x, 3), rnd(origin.y, 3), rnd(origin.z, 3)], d, b: 1, p: [], k: [] });
        return;
      }
      const p = [];
      const k = [];
      for (const r of records) {
        p.push(rnd(r.point.x), rnd(r.point.y), rnd(r.point.z));
        k.push(Math.max(0, SURF.indexOf(r.surface)));
      }
      ev({ e: 'sh', a: shooter ? shooter.id : -1, w: wid, o: [rnd(origin.x), rnd(origin.y), rnd(origin.z)], p, k });
    };
    combat.onColliderDestroyed = (c) => {
      if (c.type === 'box') ev({ e: 'cx', ty: 'b', id: c.id, x: c.cx, z: c.cz }); // museum glass: by box id
      else if (c.type === 'poly') ev({ e: 'cx', ty: 'p', x: c.minX, z: c.minZ });
      else ev({ e: 'cx', ty: 'c', x: c.x, z: c.z });
    };
    // building wall panels (keyed by building map id + panel index; never the `cx` event, which
    // is keyed by x, z and would delete the whole building on clients). Damage to one panel is
    // coalesced to one `wd` per flush.
    const wd = (this._wdPending = new Map());
    combat.onPanelDamage = (c, pn) => {
      const b = c.ref && c.ref.id;
      if (b == null || !this.started || this._spawning) return;
      const k = b + ':' + pn.id;
      const hp = Math.max(1, Math.round(pn.hp));
      const prev = wd.get(k);
      if (prev) prev.hp = hp;
      else {
        const e = { e: 'wd', b, p: pn.id, hp };
        wd.set(k, e);
        ev(e);
      }
    };
    combat.onPanelBreak = (c, pn) => {
      const b = c.ref && c.ref.id;
      if (b != null) ev({ e: 'wx', b, p: pn.id });
    };
    const swing = combat.swingPickaxe.bind(combat);
    combat.swingPickaxe = (shooter, origin, dir) => {
      if (shooter) ev({ e: 'sw', a: shooter.id });
      return swing(shooter, origin, dir);
    };

    // grenades: clients replay the flight from the throw and wait for the blast
    if (game.grenades) {
      game.grenades.onThrow = (gr) =>
        ev({ e: 'gr', id: gr.id, a: gr.owner ? gr.owner.id : -1, p: [rnd(gr.pos.x), rnd(gr.pos.y), rnd(gr.pos.z)], v: [rnd(gr.vel.x), rnd(gr.vel.y), rnd(gr.vel.z)], r: gr.rocket ? 1 : 0, s: gr.smoke ? 1 : 0 });
      game.grenades.onExplode = (gr) => ev({ e: 'gx', id: gr.id, p: [rnd(gr.pos.x), rnd(gr.pos.y), rnd(gr.pos.z)], r: gr.rocket ? 1 : 0, s: gr.smoke ? 1 : 0 });
    }

    const loot = game.loot;
    if (loot) {
      const add = loot._add.bind(loot);
      loot._add = (...args) => {
        const rec = add(...args);
        if (this.started && !this._spawning) this._pendingLoot.push(rec);
        return rec;
      };
      const take = loot.take.bind(loot);
      loot.take = (id) => {
        const item = take(id);
        if (item) ev({ e: 'lr', id, by: this._takeBy != null ? this._takeBy : -1 });
        return item;
      };
      const open = loot.open.bind(loot);
      loot.open = (id) => {
        const ok = open(id);
        if (ok) ev({ e: 'lo', id });
        return ok;
      };
      if (loot.smash) {
        const smash = loot.smash.bind(loot);
        loot.smash = (id) => {
          const ok = smash(id);
          if (ok) ev({ e: 'lx', id });
          return ok;
        };
      }
    }

    const st = game.structures;
    if (st) {
      const place = st.place.bind(st);
      st.place = (pl, mat, owner) => {
        const piece = place(pl, mat, owner);
        if (piece) ev({ e: 'sp', kind: piece.kind, m: piece.mat, x: piece.x, y: piece.y, z: piece.z, rot: piece.rot, key: piece.key, lv: piece.level, a: owner ? owner.id : -1 });
        return piece;
      };
      const damage = st.damage.bind(st);
      st.damage = (piece, amount, hitPos) => {
        const gone = damage(piece, amount, hitPos);
        if (!gone && piece && piece.alive) ev({ e: 'sd', key: piece.key, hp: Math.round(piece.hp) });
        return gone;
      };
      if (st.edit) {
        const edit = st.edit.bind(st);
        st.edit = (piece, mask) => {
          const ok = edit(piece, mask);
          if (ok) ev({ e: 'se', key: piece.key, ed: st.editValue(piece) });
          return ok;
        };
      }
      if (st.setDoor) {
        const setDoor = st.setDoor.bind(st);
        st.setDoor = (piece, c, v) => {
          const ok = setDoor(piece, c, v);
          if (ok) ev({ e: 'sdr', key: piece.key, c, v: piece.doors[c] });
          return ok;
        };
      }
      if (st._destroy) {
        const destroy = st._destroy.bind(st);
        st._destroy = (piece, ...rest) => {
          if (piece && piece.alive) ev({ e: 'sx', key: piece.key });
          return destroy(piece, ...rest);
        };
      }
    }
    if (siteDoors && siteDoors.setOpen) {
      const setOpen = siteDoors.setOpen.bind(siteDoors);
      siteDoors.setOpen = (id, open) => {
        const ok = setOpen(id, open);
        if (ok) ev({ e: 'md', id, o: open ? 1 : 0 });
        return ok;
      };
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const g = this.game;
    if (!this.started) return;
    this.time += dt;
    // a remote still aboard well after the Drop Bus left the map (stalled / backgrounded tab):
    // eject it where the bus left, like the client itself would
    const route = g.busRoute;
    if (route && this.time > route.tClose + 3) {
      for (const a of this.remotes.values()) {
        if (!a.alive || !a.inBus) continue;
        busPosAt(route, route.tClose, a.pos);
        a.pos.y -= 1;
        a.vel.set(0, 0, 0);
        a.mode = 'freefall';
        a.inBus = false;
        this.room.sendTo(a.id, { t: 'cor', x: a.pos.x, y: a.pos.y, z: a.pos.z });
      }
    }
    for (const a of this.remotes.values()) this._present(a, dt);

    // match end: last one (team) standing (the host's own victory/defeat screens are Game's)
    const over = g.teamMode ? g.totalTeams > 1 && g.combat.aliveTeams <= 1 : g.totalActors > 1 && g.combat.aliveCount <= 1;
    if (!this.ended && (g.state === 'play' || g.state === 'over') && over) {
      this.ended = true;
      const w = g.combat.actors.find((a) => a.alive);
      this.events.push({ e: 'end', w: w ? w.id : -1, tm: w && w.team != null ? w.team : -1 });
    }

    this._snapAcc += dt;
    if (this._snapAcc >= 1 / SNAP_HZ) {
      this._snapAcc = Math.min(this._snapAcc - 1 / SNAP_HZ, 0.1);
      this._sendSnapshot();
    }
    // events go out every frame, not with the next snapshot (up to 50 ms sooner)
    this._flushEvents();
    this._invAcc += dt;
    if (this._invAcc >= 0.1) {
      this._invAcc = 0;
      for (const a of this.remotes.values()) {
        this._syncInventory(a);
        if (!a.alive && a.specId >= 0) this._syncSpectated(a);
      }
    }
  }

  _actorRows() {
    const g = this.game;
    const rows = [];
    const push = (a) => {
      rows.push({
        id: a.id,
        flags: flagsOf(a),
        x: a.pos.x,
        y: a.pos.y,
        z: a.pos.z,
        heading: a.heading || 0,
        pitch: a.pitch || 0,
        equip: equipCode(equipOf(a)),
        health: a.downed ? a.downHp : a.health,
        shield: a.shield,
        kills: a.kills,
        xf: (a.downed ? XFLAG.downed : 0) | (a.downed && a.reviver ? XFLAG.revived : 0),
      });
    };
    push(g.player);
    for (const a of this.remotes.values()) push(a);
    for (const b of g.bots.list) push(b);
    return rows;
  }

  _sendSnapshot() {
    const g = this.game;
    // upload backed up (slow connection): skip this snapshot; the next one supersedes it, and
    // queuing more would delay every later snapshot and event for everyone
    if (this.room.backlog > SNAP_BACKLOG_MAX) {
      this.stats.snapSkipped = (this.stats.snapSkipped || 0) + 1;
      return;
    }
    const buf = encodeSnapshot(this.seq++, this.time, g.storm, g.combat.aliveCount, this._actorRows());
    // one upload; the relay fans it out to every guest (was one copy per guest)
    let n = 0;
    for (const a of this.remotes.values()) if (this.room.clients.has(a.id)) n++;
    if (!n) return;
    this.room.broadcastRaw(buf);
    this.stats.snapBytes += buf.byteLength * n;
    this.stats.snaps++;
  }

  _flushEvents() {
    // loot records added this tick go first (a bot may take a spilled item in the same tick);
    // they are serialized now because Loot sets `spill` just after _add returns
    const adds = [];
    for (const rec of this._pendingLoot) {
      const sp = rec.spill ? [rnd(rec.spill.fx), rnd(rec.spill.fy), rnd(rec.spill.fz)] : 0;
      adds.push({ e: 'la', id: rec.id, kind: rec.kind, x: rnd(rec.x), y: rnd(rec.y), z: rnd(rec.z), yaw: rnd(rec.yaw, 3), it: rec.item || 0, sp });
    }
    this._pendingLoot.length = 0;
    if (!adds.length && !this.events.length) return;
    const msg = { t: 'ev', l: adds.concat(this.events) };
    this.events = [];
    if (this._wdPending) this._wdPending.clear();
    this.stats.evBytes += this.room.broadcast(msg);
  }

  /** Spectating: the hotbar, ammo and materials of the player `a` watches. */
  _syncSpectated(a) {
    const t = this.game.combat.actors.find((x) => x.id === a.specId);
    const inv = t && t.inventory;
    if (!inv || !inv.slots) return;
    const sel = t === this.game.player ? (t.buildPiece ? -1 : inv.selected) : heldSlot(t, inv);
    const body = { id: t.id, s: inv.slots, ammo: inv.ammo, mats: inv.mats, sel };
    const key = JSON.stringify(body);
    if (this._specSent.get(a.id) === key) return;
    this._specSent.set(a.id, key);
    this.stats.invBytes += this.room.sendTo(a.id, { t: 'sinv', ...body });
  }

  _syncInventory(a) {
    const inv = a.inventory;
    const body = { s: inv.slots, ammo: inv.ammo, mats: inv.mats };
    const key = JSON.stringify(body);
    if (this._invSent.get(a.id) === key + '|' + a.ack) return;
    this._invSent.set(a.id, key + '|' + a.ack);
    this.stats.invBytes += this.room.sendTo(a.id, { t: 'inv', ack: a.ack, ...body });
  }

  /** Smoothly draws a remote human on the host. */
  _present(a, dt) {
    const c = a.character;
    if (!c) return;
    const k = 1 - Math.exp(-18 * dt);
    if (a.drawPos.distanceToSquared(a.pos) > 400) a.drawPos.copy(a.pos);
    else a.drawPos.lerp(a.pos, k);
    c.root.position.copy(a.drawPos);
    c.root.visible = !a.inBus;
    c.setDowned(!!a.downed);
    const w = this.game.world;
    c.setSwim(a.alive && !a.downed && a.mode === 'ground' && !!w.inWater && w.inWater(a.drawPos.x, a.drawPos.z, a.drawPos.y));
    if (!a.alive) {
      c.update(dt, { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: a.heading, pitch: 0 });
      return;
    }
    const v = a.vel;
    const hs = Math.hypot(v.x, v.z);
    const sh = Math.sin(a.heading);
    const ch = Math.cos(a.heading);
    c.setEquipped(a.equipId, WEAPONS[a.equipId] ? WEAPONS[a.equipId].twoHanded !== false : true);
    c.emote(!!a.netEmote, a.netEmoteId);
    c.update(dt, {
      fwd: hs > 0.1 ? (v.x * sh - v.z * ch) / hs : 0,
      side: hs > 0.1 ? (v.x * ch + v.z * sh) / hs : 0,
      speed: hs,
      grounded: a.grounded,
      gliding: a.mode === 'glide',
      heading: a.heading,
      pitch: a.pitch,
    });
  }

  // ---------------------------------------------------------------- Game event hooks

  onDamage(target, amount, info) {
    if (!this.started) return;
    const p = info.point;
    this.events.push({
      e: 'hit',
      v: target.id,
      s: info.source ? info.source.id : -1,
      d: Math.round(amount * 10) / 10,
      h: info.headshot ? 1 : 0,
      sh: info.shieldHit > 0 ? Math.round(info.shieldHit) : 0,
      st: info.storm ? 1 : 0,
      p: p ? [rnd(p.x), rnd(p.y), rnd(p.z)] : 0,
      hp: Math.round(target.downed ? target.downHp : target.health),
      sp: Math.round(target.shield),
      dn: target.downed ? 1 : 0,
    });
  }

  onKnock(victim, by, info) {
    if (!this.started) return;
    let how = 'knock';
    if (info.storm && !by) how = 'storm';
    else if (info.fall) how = 'fall';
    else if (info.weapon === 'pickaxe') how = 'pickaxe';
    else if (info.headshot) how = 'headshot';
    this.events.push({ e: 'kn', v: victim.id, k: by ? by.id : -1, how });
  }

  onCarry(carrier, victim, dropped) {
    if (!this.started) return;
    this.events.push({ e: 'cy', c: carrier.id, v: victim ? victim.id : -1 });
    // a remote human put down: their client must land where the host placed them
    if (dropped && dropped.isRemote && dropped.alive) {
      dropped.lastCorrect = this.time;
      this.room.sendTo(dropped.id, { t: 'cor', x: dropped.pos.x, y: dropped.pos.y, z: dropped.pos.z });
    }
  }

  onRevive(victim, by) {
    if (!this.started) return;
    this.events.push({ e: 'rv', v: victim.id, by: by ? by.id : -1, hp: Math.round(victim.health) });
  }

  onEliminate(victim, killer, info) {
    if (!this.started) return;
    const g = this.game;
    // team modes: the team's place once its last member is out (0 while teammates live on)
    const placement = !g.teamMode ? g.combat.aliveCount + 1 : teamAlive(g.combat.actors, victim.team) ? 0 : g.combat.aliveTeams + 1;
    victim.placement = placement;
    if (victim.isRemote) victim.lastKillerName = killer ? killer.name : info.storm ? 'the storm' : null;
    let how = 'elim';
    if (info.left) how = 'left';
    else if (info.storm && !killer) how = 'storm';
    else if (info.fall) how = 'fall';
    else if (info.explosive) how = 'grenade';
    else if (info.weapon === 'pickaxe') how = 'pickaxe';
    else if (info.headshot) how = 'headshot';
    else if (info.bleed) how = 'bleed';
    else if (info.wipe) how = 'wipe';
    this.events.push({ e: 'el', v: victim.id, k: killer ? killer.id : -1, how, pl: placement, n: g.combat.aliveCount, kk: killer ? killer.kills : 0 });
  }

  /**
   * A remote's first state out of the bus: its position must be near where the Drop Bus is
   * at our current time. The client flies the bus on our clock (snapshot offset), so it
   * lags by about one-way latency: allow speed * 0.8 s + 25 m along the route (lag plus
   * the jump's momentum and the state interval) and 40 m across it. Not before tOpen.
   */
  _busExitOk(s) {
    const r = this.game.busRoute;
    if (!r) return true;
    const t = this.time;
    if (t < r.tOpen - 0.5) return false;
    const along = (s.x - r.ax) * r.dx + (s.z - r.az) * r.dz;
    const across = Math.abs((s.x - r.ax) * r.dz - (s.z - r.az) * r.dx);
    const now = r.speed * Math.min(t, r.tClose);
    return across <= 40 && Math.abs(along - now) <= r.speed * 0.8 + 25 && s.y > r.y - 60;
  }

  // ---------------------------------------------------------------- client input

  _onState(c, buf) {
    const a = this.remotes.get(c.id);
    if (!a || !a.alive) return;
    const s = decodeState(buf);
    if (!s) return;
    if (a.lastSeq >= 0 && !seqNewer(s.seq, a.lastSeq)) return;
    a.lastSeq = s.seq;
    const now = this.time;
    const dt = Math.max(0.03, now - (a.lastStateT || now));
    a.lastStateT = now;
    if (a.mode !== 'bus' && s.mode === 'bus') s.mode = a.mode; // no going back into the bus

    // loose reconciliation: accept movement within a generous speed bound
    const was = a.mode;
    const dist = Math.hypot(s.x - a.pos.x, s.y - a.pos.y, s.z - a.pos.z);
    const cap = (MAX_SPEED[s.mode] || 20) * dt + 3;
    const fromBus = was === 'bus' && s.mode !== 'bus';
    if (fromBus && !this._busExitOk(s)) {
      // jumped from somewhere the bus never was (or is not now): leave from the bus instead,
      // at the earliest legal exit point (an early jump would otherwise land them outside the
      // map). Below they are accepted as jumped from here (mode freefall, no longer in the
      // bus), and the client snaps to it via 'cor'.
      const r = this.game.busRoute;
      busPosAt(r, Math.max(r.tOpen, Math.min(this.time, r.tClose)), a.pos);
      a.pos.y -= 1;
      a.allowJump = false;
      a.lastCorrect = this.time;
      this.room.sendTo(a.id, { t: 'cor', x: a.pos.x, y: a.pos.y, z: a.pos.z });
      s.x = a.pos.x;
      s.y = a.pos.y;
      s.z = a.pos.z;
    }
    const b = this.game.world.bounds;
    const inBounds = s.x > b.minX - 5 && s.x < b.maxX + 5 && s.z > b.minZ - 5 && s.z < b.maxZ + 5;
    const route = this.game.busRoute;
    if (s.mode === 'bus' && route) {
      busPosAt(route, Math.min(this.time, route.tClose), a.pos); // riding: wherever the bus is
    } else if (a.carriedBy) {
      // on a teammate's shoulder: the host owns where they are (Combat.tickCarry)
    } else if (inBounds && (fromBus || a.allowJump || dist <= cap || was === 'bus' || this._portalOk(a, s))) {
      a.pos.set(s.x, s.y, s.z);
      a.allowJump = false;
      a.portalTo = null;
    } else if (this.time - (a.lastCorrect || -9) > 0.5) {
      a.lastCorrect = this.time;
      this.room.sendTo(a.id, { t: 'cor', x: a.pos.x, y: a.pos.y, z: a.pos.z });
    }
    a.vel.set(s.vx, s.vy, s.vz);
    a.heading = s.heading;
    a.pitch = s.pitch;
    a.mode = s.mode;
    a.inBus = s.mode === 'bus';
    a.gliding = s.mode === 'glide';
    a.grounded = !!(s.flags & FLAG.grounded);
    a.crouching = !!(s.flags & FLAG.crouch);
    a.ads = !!(s.flags & FLAG.ads);
    a.netEmote = !!(s.flags & FLAG.emote);
    if ((s.flags & FLAG.reloading) && !a.netReloading && a.character) {
      const id = EQUIP[s.equip];
      const cur = a.inventory && a.inventory.current ? a.inventory.current() : null;
      const st = WEAPONS[id] ? weaponStats(id, cur && cur.id === id ? cur.rarity : undefined) : null;
      if (st) a.character.reload(st.reload);
    }
    a.netReloading = !!(s.flags & FLAG.reloading);
    a.equipId = EQUIP[s.equip] || 'pickaxe';
  }

  _onMessage(c, msg) {
    if (msg.t === 'leave') {
      this.room.kick(c.id);
      return;
    }
    if (msg.t === 'spec') {
      // an eliminated client says who it is watching
      const r = this.remotes.get(c.id);
      if (r) {
        r.specId = Number.isInteger(msg.id) ? msg.id : -1;
        this._specSent.delete(r.id);
      }
      return;
    }
    if (msg.t !== 'a') return;
    const a = this.remotes.get(c.id);
    if (!a || !this.started) return;
    if (msg.seq > a.ack) a.ack = msg.seq;
    if (!a.alive) return;
    // knocked: crawling only (QA helpers and fall damage still go through)
    if (a.downed && msg.k !== 'tp' && msg.k !== 'dbg' && msg.k !== 'fall') return;
    try {
      this._action(a, msg);
    } catch (err) {
      this.game._error('net action ' + msg.k, err);
    }
  }

  _action(a, m) {
    const g = this.game;
    const inv = a.inventory;
    switch (m.k) {
      case 'fire': {
        if (a.inBus || a.airborneDrop) return;
        const it = inv.slots[m.s];
        if (!it || it.type !== 'weapon' || it.id !== m.w || !(it.mag > 0)) return;
        const w = WEAPONS[it.id];
        // Burst guns: rounds 2..N of a trigger pull arrive weaponShotInterval apart, but network
        // jitter can bunch them into one host frame, so a pull is allowed `burst` messages and
        // only the trigger-pull rate (1 / rate) is enforced between pulls.
        const gap = this.time - a.lastFire;
        let newPull = true;
        if (w.burst > 1) {
          if (gap >= (1 / w.rate) * 0.6) a.burstShots = 0;
          else if ((a.burstShots || 0) < w.burst && gap >= 0) newPull = false;
          else return;
          a.burstShots = (a.burstShots || 0) + 1;
        } else if (gap < weaponShotInterval(it.id) * 0.6) return;
        if (!Array.isArray(m.o) || !Array.isArray(m.d) || !m.d.length || m.d.length > (w.pellets || 1)) return;
        _o.set(+m.o[0], +m.o[1], +m.o[2]);
        if (!Number.isFinite(_o.x + _o.y + _o.z) || _o.distanceTo(a.pos) > 9) return;
        const dirs = m.d.map((d) => new THREE.Vector3(+d[0], +d[1], +d[2]).normalize()).filter((v) => Number.isFinite(v.x + v.y + v.z));
        if (!dirs.length) return;
        const claims = (m.c || []).map((id) => (id >= 0 && id !== a.id ? g.combat.actors.find((x) => x.id === id) || null : null));
        if (newPull) a.lastFire = this.time;
        it.mag--;
        if (a.character) a.character.fire();
        g.combat.fireWeapon(a, it, _o, dirs[0], 0, { dirs, claims, shot: m.seq });
        return;
      }
      case 'ph': {
        // a guest's sniper round reached someone on its screen: Combat checks it against our path
        const n = Number(m.n);
        const v = Number(m.v);
        if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(v) || v === a.id) return;
        const victim = g.combat.actors.find((x) => x.id === v);
        if (victim) g.combat.claimProjectile(a, n, victim);
        return;
      }
      case 'sw': {
        if (a.inBus || a.airborneDrop) return;
        if (this.time - a.lastSwing < (1 / PICKAXE.rate) * 0.6) return;
        _o.set(+m.o[0], +m.o[1], +m.o[2]);
        _d.set(+m.d[0], +m.d[1], +m.d[2]);
        if (!Number.isFinite(_o.x + _o.y + _o.z + _d.x + _d.y + _d.z) || _o.distanceTo(a.pos) > 4) return;
        a.lastSwing = this.time;
        if (a.character) a.character.swing();
        const res = g.combat.swingPickaxe(a, _o.clone(), _d.normalize());
        if (res && res.harvested) {
          const mats = inv.mats;
          mats[res.harvested.mat] = Math.min(PLAYER.matCap, (mats[res.harvested.mat] || 0) + res.harvested.count);
        }
        return;
      }
      case 'b': {
        const p = m.p;
        const mat = MATERIALS.includes(m.m) ? m.m : null;
        if (!p || !mat || !BUILD.pieces.includes(p.kind) || a.inBus || a.airborneDrop) return;
        if (!(Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < 14 && Math.abs(p.y - a.pos.y) < 10)) return;
        if ((inv.mats[mat] || 0) < BUILD.cost) return;
        const st = g.structures;
        if (!st || st.at({ ...p })) return;
        const pl = { kind: p.kind, x: +p.x, y: +p.y, z: +p.z, rot: +p.rot, key: p.key, level: p.level, valid: true };
        if (st.fits && !st.fits(pl)) return; // same world rule as the client's ghost (refunded by the inventory sync)
        if (st.supported && !st.supported(pl)) return; // nothing holding it up: refused (and refunded) like the ghost says
        const piece = st.place(pl, mat, a);
        if (piece) inv.spendMats(mat, BUILD.cost);
        return;
      }
      case 'e': {
        // edit one of your own pieces (tile mask, or a ramp's quarter turn); no mats involved
        const st = g.structures;
        const piece = st && st.edit && st.slots.get(m.key);
        if (!piece || piece.owner !== a || a.inBus || a.airborneDrop) return;
        if (!(Math.hypot(piece.x - a.pos.x, piece.z - a.pos.z) < 14 && Math.abs(piece.y - a.pos.y) < 10)) return;
        st.edit(piece, m.ed | 0);
        return;
      }
      case 'md': {
        const doors = g.world && g.world.siteDoors;
        if (!doors || a.inBus || a.airborneDrop) return;
        const d = doors.near(a.pos);
        if (!d || d.id !== m.id) return;
        doors.toggle(m.id);
        return;
      }
      case 'dr': {
        // open / close a door cut into a built wall (anyone may)
        const st = g.structures;
        const piece = st && st.toggleDoor && st.slots.get(m.key);
        const c = m.c | 0;
        if (!piece || a.inBus || a.airborneDrop || !(st.doorColumns(piece) & (1 << c))) return;
        const at = st.doorPoint(piece, c, _o);
        if (!(Math.hypot(at.x - a.pos.x, at.z - a.pos.z) < 4 && Math.abs(piece.y - a.pos.y) < 3)) return;
        st.toggleDoor(piece, c, m.s >= 0 ? 1 : -1);
        return;
      }
      case 'int': {
        if (a.inBus || a.airborneDrop) return; // no looting from the bus or mid-skydive (dead actors are filtered in _onMessage)
        const loot = g.loot;
        const rec = loot && loot.byId.get(m.id);
        if (!rec || Math.hypot(rec.x - a.pos.x, rec.z - a.pos.z) > 3.6 || Math.abs(rec.y - a.pos.y) > 3) return;
        if (rec.kind === 'chest' || rec.kind === 'ammoBox') {
          loot.open(m.id);
          return;
        }
        this._takeBy = a.id;
        const item = loot.take(m.id);
        this._takeBy = null;
        if (!item) return;
        const left = inv.add(item);
        if (left) loot.drop(left, a.pos.clone());
        return;
      }
      case 'rc': {
        // pick up a teammate's reboot card (Reboot.take checks team / holder)
        const rb = g.reboot;
        const card = rb && g.teamMode ? rb.cards.get(m.v | 0) : null;
        if (!card || card.holder != null || a.inBus || a.airborneDrop) return;
        if (Math.hypot(card.x - a.pos.x, card.z - a.pos.z) > REBOOT.cardRange + 1.5 || Math.abs(card.y - a.pos.y) > 3.5) return;
        rb.take(a, card);
        return;
      }
      case 'rb': {
        // hold / let go of interact at a reboot van (Reboot._tick validates every frame)
        const rb = g.reboot;
        if (!rb || !g.teamMode) return;
        if (!(m.i >= 0)) {
          a.rebootVan = null;
          return;
        }
        const v = rb.vans[m.i | 0];
        if (v && rb.vanNear(a, 1) === v) a.rebootVan = v;
        return;
      }
      case 'rl': {
        const it = inv.slots[m.s];
        if (!it || it.type !== 'weapon') return;
        const w = WEAPONS[it.id];
        const full = Math.max(0, w.mag - it.mag);
        it.mag += inv.takeAmmo(w.ammo, m.n > 0 ? Math.min(full, m.n | 0) : full); // n: shells loaded one at a time
        return;
      }
      case 'use': {
        const it = inv.slots[m.s];
        if (!it || it.type !== 'consumable' || CONSUMABLES[it.id].throwable) return;
        const keep = inv.selected;
        inv.selected = m.s;
        const used = inv.useConsumable();
        inv.selected = keep;
        if (!used) return;
        const def = CONSUMABLES[used.id];
        a.health = Math.min(PLAYER.maxHealth, a.health + def.heal);
        a.shield = Math.min(PLAYER.maxShield, a.shield + def.shield);
        if (g.fx) g.fx.aura(a.pos, def.shield > 0 ? 'shield' : 'heal', 1.2);
        this.events.push({ e: 'au', a: a.id, kind: def.shield > 0 ? 'shield' : 'heal' });
        return;
      }
      case 'gr': {
        // throw one grenade from slot m.s
        if (a.inBus || a.airborneDrop || !g.grenades) return;
        const it = inv.slots[m.s];
        if (!it || it.type !== 'consumable' || !CONSUMABLES[it.id].throwable) return;
        if (this.time - (a.lastThrow || -9) < GRENADE.cooldown * 0.6) return;
        if (!Array.isArray(m.o) || !Array.isArray(m.d)) return;
        _o.set(+m.o[0], +m.o[1], +m.o[2]);
        _d.set(+m.d[0], +m.d[1], +m.d[2]);
        if (!Number.isFinite(_o.x + _o.y + _o.z + _d.x + _d.y + _d.z) || _d.lengthSq() < 1e-6 || _o.distanceTo(a.pos) > 4) return;
        const keep = inv.selected;
        inv.selected = m.s;
        const used = inv.useConsumable();
        inv.selected = keep;
        if (!used) return;
        a.lastThrow = this.time;
        if (a.character) a.character.swing();
        g.grenades.throw(a, _o, _d.normalize(), used.id);
        return;
      }
      case 'mv': {
        // inventory screen: reorder two hotbar slots (the client already applied it locally)
        const sa = m.a;
        const sb = m.b;
        if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0 || sa > 4 || sb > 4) return;
        // same rules as Game.swapSlots: not from the bus / mid-skydive, not while reloading
        // (the client's last state packet says so). A refusal still bumps a.ack, so the next
        // inventory sync puts the client's optimistic swap back.
        if (a.inBus || a.airborneDrop || a.netReloading) return;
        if (inv.swap(sa, sb) && g.combat && g.combat.cancelBurst) g.combat.cancelBurst(a);
        return;
      }
      case 'pg': {
        // a map marker / ping: relayed to everyone (each client shows its own team's)
        const t = m.t === 'm' ? 'm' : 'p';
        const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 10) / 10 : 0);
        const out = { t, clear: m.clear ? 1 : 0, x: num(m.x), y: num(m.y), z: num(m.z), kind: ['loc', 'enemy', 'item'].includes(m.kind) ? m.kind : 'loc', label: String(m.label || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40), tg: Number.isInteger(m.tg) ? m.tg : -1 };
        if (g.netPing) g.netPing(a, out);
        this.events.push({ e: 'pg', a: a.id, ...out });
        return;
      }
      case 'sk': {
        // the guest's outfit, pickaxe and back bling (sent once at match start)
        const id = typeof m.id === 'string' && SKINS[m.id] ? m.id : null;
        const px = typeof m.px === 'string' && PICKAXES[m.px] ? m.px : null;
        const bb = typeof m.bb === 'string' && BACKBLINGS[m.bb] ? m.bb : null;
        if (!id && !px && !bb) return;
        g.reskinActor(a, id, px, bb);
        this.events.push({ e: 'sk', a: a.id, id, px, bb });
        return;
      }
      case 'em': {
        // emote start (id) — the state flag says when it stops
        const id = typeof m.id === 'string' && EMOTES[m.id] ? m.id : null;
        a.netEmoteId = id;
        if (a.character && a.character.mode === 'emote') a.character.emote(true, id);
        this.events.push({ e: 'em', a: a.id, id });
        return;
      }
      case 'cy': {
        // carry a knocked teammate (id) / put them down (-1)
        if (m.id == null || m.id < 0) {
          if (a.carrying) g.combat.stopCarry(a);
          return;
        }
        const t = g.combat.actors.find((x) => x.id === m.id);
        if (t) g.combat.startCarry(a, t);
        return;
      }
      case 'dp': {
        // inventory screen: drag a slot / ammo / material stack out to drop it on the ground
        if (a.inBus || a.airborneDrop || a.netReloading) return;
        const what = Number.isInteger(m.s) ? { s: m.s } : typeof m.ammo === 'string' ? { ammo: m.ammo } : typeof m.mat === 'string' ? { mat: m.mat } : null;
        if (what && Number.isInteger(m.n) && m.n > 0) what.n = m.n;
        const item = inv.takeOut(what);
        if (!item) return;
        if (g.combat && g.combat.cancelBurst) g.combat.cancelBurst(a);
        if (g.loot) g.loot.drop(item, a.pos.clone());
        return;
      }
      case 'rv': {
        // hold-to-revive start (id) / stop (-1); Combat.tickTeams checks range every frame
        if (m.id == null || m.id < 0) {
          g.combat.stopRevive(a);
          return;
        }
        const t = g.combat.actors.find((x) => x.id === m.id);
        if (!t || !t.alive || !t.downed || !sameTeam(t, a) || a.inBus || a.airborneDrop) return;
        if (t.reviver && t.reviver !== a) return;
        if (Math.hypot(t.pos.x - a.pos.x, t.pos.z - a.pos.z) > 4) return;
        if (a.revivingTarget && a.revivingTarget !== t) g.combat.stopRevive(a);
        a.revivingTarget = t;
        return;
      }
      case 'fall': {
        const d = Math.max(0, Math.min(250, +m.d || 0));
        if (d > 0) g.combat.applyDamage(a, d, { fall: true, source: null, storm: true });
        return;
      }
      case 'ptl': {
        // Crystal Bridges painting portal (peer input is untrusted: the gallery checks range, cooldown, storm)
        const gal = g.cbGallery;
        const to = gal && Number.isInteger(m.i) ? gal.validatePortal(a, m.i) : null;
        if (!to) return;
        a.portalTo = { x: to[0], z: to[2], until: this.time + 2 }; // only a jump to THIS destination
        return;
      }
      case 'tp':
        // QA teleport (dev builds only): the next state packet may jump anywhere
        if (!DEV) return;
        a.allowJump = true;
        if ([m.x, m.y, m.z].every(Number.isFinite)) a.pos.set(m.x, m.y, m.z);
        return;
      case 'dbg':
        if (!DEV) return;
        if (m.give === 'ammo') for (const k of Object.keys(inv.ammo)) inv.add({ type: 'ammo', ammo: k, count: 120 });
        else {
          const item = debugItem(m.give, m.rarity);
          if (item) inv.add(item);
        }
        return;
      default:
    }
  }

  /** A Crystal Bridges portal jump the host approved: lands at the approved destination, soon. */
  _portalOk(a, s) {
    const p = a.portalTo;
    return !!p && this.time < p.until && Math.hypot(s.x - p.x, s.z - p.z) < 3;
  }

  _onLeave(c) {
    const a = this.remotes.get(c.id);
    if (!a) return;
    const g = this.game;
    if (this.started && a.alive) {
      a.inBus = false; // so the drop lands where they were
      g.combat.applyDamage(a, 1e6, { source: null, storm: true, left: true });
    }
    this.events.push({ e: 'left', a: c.id });
  }

  // ---------------------------------------------------------------- teardown

  _clearRemotes(game) {
    for (const a of this.remotes.values()) {
      game.combat.unregister(a);
      if (a.character) {
        a.character.root.removeFromParent();
        a.character.dispose();
      }
    }
    this.remotes.clear();
  }

  /** Bandwidth so far: bytes/second sent to each client. */
  bandwidth() {
    const secs = Math.max(0.001, (performance.now() - this.stats.t0) / 1000);
    const per = {};
    for (const c of this.room.clients.values()) per[c.id] = Math.round(c.bytesOut / secs);
    return { secs, perClient: per, snapBytesAvg: this.stats.snaps ? Math.round(this.stats.snapBytes / this.stats.snaps / Math.max(1, this.remotes.size)) : 0, ...this.stats };
  }

  /** keepRoom: unbind from the room but leave it open (a failed start goes back to the lobby). */
  dispose(game, { keepRoom = false } = {}) {
    this.started = false;
    this._clearRemotes(game);
    for (const [obj, k, own, v] of this._saved || []) {
      if (own) obj[k] = v;
      else delete obj[k];
    }
    this._saved = null;
    this._wrapped = false;
    const room = this.room;
    room.onMessage = room.onState = room.onLeave = null; // no handlers left bound to a dead session
    if (!keepRoom) room.close();
  }
}

void TAU;
