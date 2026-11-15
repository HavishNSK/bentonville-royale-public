// BENTONVILLE ROYALE — the host side of a multiplayer match.
//
// The host's browser runs the whole simulation (bots, storm, loot, structures,
// combat, eliminations) exactly as in solo play. Each remote human is a
// RemoteActor registered with Combat, so bots, storm damage and hitscan treat
// it like anyone else. Its movement comes from the client's state packets
// (trusted within a speed bound); its actions arrive as reliable messages and
// are validated and applied here.
//
//   const s = new HostSession(room, game, { fill });
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
import { PLAYER, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, MATCH, TAU } from '../core/config.js';
import { Character } from '../game/Character.js';
import {
  SNAP_HZ, FLAG, EQUIP, SURF, encodeSnapshot, decodeState, seqNewer, rnd,
} from './protocol.js';

// Bots.js colours its canopies with this palette by spawn index (kept in sync by hand).
const BOT_CANOPY = [0x4fc3f7, 0xff7a45, 0x9ccc65, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0xa1887f];
const BOT_KITS = ['bot_a', 'bot_b', 'bot_c'];
export const HUMAN_CANOPY = [0xffc21f, 0x5ec8ff, 0xff5d8f, 0x7dff6b, 0xc08cff, 0xff6b4a, 0x4ad6c8, 0xfff07a, 0x9fa8ff, 0xff9f43, 0x26de81, 0xfd79a8, 0x74b9ff, 0xa29bfe, 0xffeaa7, 0x55efc4];

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
  }

  get airborneDrop() {
    return this.mode === 'freefall' || this.mode === 'glide';
  }
}

export class HostSession {
  constructor(room, game, { fill = true } = {}) {
    this.room = room;
    this.game = game;
    this.isHost = true;
    this.isClient = false;
    this.fill = fill;
    this.remotes = new Map(); // client id -> RemoteActor
    this.events = [];
    this.seq = 0;
    this.time = 0;
    this._snapAcc = 0;
    this._invAcc = 0;
    this._invSent = new Map();
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
      a.pos.set(lm.x, PLAYER.dropHeight, lm.z);
      a.drawPos.copy(a.pos);
      this.remotes.set(c.id, a);
      game.combat.register(a);
    }
    game.player.name = this.room.name;
    const slots = MATCH.bots + 1;
    const maxId = humans.length ? humans[humans.length - 1].id : 0;
    return { botCount: this.fill ? Math.max(0, slots - 1 - humans.length) : 0, idBase: maxId + 1 };
  }

  /** After bots and loot exist: tell everyone. */
  matchStarted(game) {
    this._spawning = false;
    this._pendingLoot.length = 0;
    this.events.length = 0;
    this.ended = false;
    this.started = true;
    this.room.started = true;
    this.time = 0;
    this.stats = { t0: 0, snapBytes: 0, snaps: 0, evBytes: 0, invBytes: 0, startBytes: 0 };
    this._invSent.clear();
    const roster = [{ id: 0, n: game.player.name, k: 'player', c: HUMAN_CANOPY[0], h: 1 }];
    for (const a of this.remotes.values()) roster.push({ id: a.id, n: a.name, k: 'player', c: HUMAN_CANOPY[a.id % HUMAN_CANOPY.length], h: 1 });
    const idBase = game.bots.list.length ? game.bots.list[0].id : 0;
    for (const b of game.bots.list) {
      const i = b.id - idBase;
      roster.push({ id: b.id, n: b.name, k: BOT_KITS[i % BOT_KITS.length], c: BOT_CANOPY[i % BOT_CANOPY.length], h: 0 });
    }
    const s = game.storm;
    const loot = [];
    for (const r of game.loot ? game.loot.records : []) loot.push([r.id, r.kind, rnd(r.x), rnd(r.y), rnd(r.z), rnd(r.yaw, 3), r.opened ? 1 : 0, r.item || 0]);
    const msg = {
      t: 'start',
      seed: game.seed,
      roster,
      total: game.totalActors,
      zone: game.dropZone ? game.dropZone.key : null,
      marker: game.dropMarker,
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
    keep(game.combat, 'swingPickaxe');
    for (const k of ['_add', 'take', 'open']) keep(game.loot, k);
    for (const k of ['place', 'damage', '_destroy']) keep(game.structures, k);
    const ev = (e) => this.started && !this._spawning && this.events.push(e);
    const combat = game.combat;
    combat.onFire = (shooter, wid, origin, records) => {
      if (!this.started) return;
      const p = [];
      const k = [];
      for (const r of records) {
        p.push(rnd(r.point.x), rnd(r.point.y), rnd(r.point.z));
        k.push(Math.max(0, SURF.indexOf(r.surface)));
      }
      ev({ e: 'sh', a: shooter ? shooter.id : -1, w: wid, o: [rnd(origin.x), rnd(origin.y), rnd(origin.z)], p, k });
    };
    combat.onColliderDestroyed = (c) => {
      if (c.type === 'poly') ev({ e: 'cx', ty: 'p', x: c.minX, z: c.minZ });
      else ev({ e: 'cx', ty: 'c', x: c.x, z: c.z });
    };
    const swing = combat.swingPickaxe.bind(combat);
    combat.swingPickaxe = (shooter, origin, dir) => {
      if (shooter) ev({ e: 'sw', a: shooter.id });
      return swing(shooter, origin, dir);
    };

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
      if (st._destroy) {
        const destroy = st._destroy.bind(st);
        st._destroy = (piece, ...rest) => {
          if (piece && piece.alive) ev({ e: 'sx', key: piece.key });
          return destroy(piece, ...rest);
        };
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const g = this.game;
    if (!this.started) return;
    this.time += dt;
    for (const a of this.remotes.values()) this._present(a, dt);

    // match end: last one standing (the host's own victory/defeat screens are Game's)
    if (!this.ended && (g.state === 'play' || g.state === 'over') && g.totalActors > 1 && g.combat.aliveCount <= 1) {
      this.ended = true;
      const w = g.combat.actors.find((a) => a.alive);
      this.events.push({ e: 'end', w: w ? w.id : -1 });
    }

    this._snapAcc += dt;
    if (this._snapAcc >= 1 / SNAP_HZ) {
      this._snapAcc = Math.min(this._snapAcc - 1 / SNAP_HZ, 0.1);
      this._sendSnapshot();
      this._flushEvents();
    }
    this._invAcc += dt;
    if (this._invAcc >= 0.1) {
      this._invAcc = 0;
      for (const a of this.remotes.values()) this._syncInventory(a);
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
        health: a.health,
        shield: a.shield,
        kills: a.kills,
      });
    };
    push(g.player);
    for (const a of this.remotes.values()) push(a);
    for (const b of g.bots.list) push(b);
    return rows;
  }

  _sendSnapshot() {
    const g = this.game;
    const buf = encodeSnapshot(this.seq++, this.time, g.storm, g.combat.aliveCount, this._actorRows());
    for (const a of this.remotes.values()) {
      if (!this.room.clients.has(a.id)) continue;
      this.stats.snapBytes += this.room.sendRawTo(a.id, buf);
    }
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
    this.stats.evBytes += this.room.broadcast(msg);
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
    if (!a.alive) {
      c.update(dt, { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: a.heading, pitch: 0 });
      return;
    }
    const v = a.vel;
    const hs = Math.hypot(v.x, v.z);
    const sh = Math.sin(a.heading);
    const ch = Math.cos(a.heading);
    c.setEquipped(a.equipId, WEAPONS[a.equipId] ? WEAPONS[a.equipId].twoHanded !== false : true);
    c.emote(!!a.netEmote);
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
      hp: Math.round(target.health),
      sp: Math.round(target.shield),
    });
  }

  onEliminate(victim, killer, info) {
    if (!this.started) return;
    const g = this.game;
    const placement = g.combat.aliveCount + 1;
    victim.placement = placement;
    if (victim.isRemote) victim.lastKillerName = killer ? killer.name : info.storm ? 'the storm' : null;
    let how = 'elim';
    if (info.left) how = 'left';
    else if (info.storm && !killer) how = 'storm';
    else if (info.fall) how = 'fall';
    else if (info.weapon === 'pickaxe') how = 'pickaxe';
    else if (info.headshot) how = 'headshot';
    this.events.push({ e: 'el', v: victim.id, k: killer ? killer.id : -1, how, pl: placement, n: g.combat.aliveCount, kk: killer ? killer.kills : 0 });
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
    const b = this.game.world.bounds;
    const inBounds = s.x > b.minX - 5 && s.x < b.maxX + 5 && s.z > b.minZ - 5 && s.z < b.maxZ + 5;
    if (inBounds && (fromBus || a.allowJump || dist <= cap || was === 'bus')) {
      a.pos.set(s.x, s.y, s.z);
      a.allowJump = false;
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
      const it = WEAPONS[EQUIP[s.equip]];
      if (it) a.character.reload(it.reload);
    }
    a.netReloading = !!(s.flags & FLAG.reloading);
    a.equipId = EQUIP[s.equip] || 'pickaxe';
  }

  _onMessage(c, msg) {
    if (msg.t === 'leave') {
      this.room.kick(c.id);
      return;
    }
    if (msg.t !== 'a') return;
    const a = this.remotes.get(c.id);
    if (!a || !this.started) return;
    if (msg.seq > a.ack) a.ack = msg.seq;
    if (!a.alive) return;
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
        if (this.time - a.lastFire < (1 / w.rate) * 0.6) return;
        if (!Array.isArray(m.o) || !Array.isArray(m.d) || !m.d.length || m.d.length > (w.pellets || 1)) return;
        _o.set(+m.o[0], +m.o[1], +m.o[2]);
        if (!Number.isFinite(_o.x + _o.y + _o.z) || _o.distanceTo(a.pos) > 9) return;
        const dirs = m.d.map((d) => new THREE.Vector3(+d[0], +d[1], +d[2]).normalize()).filter((v) => Number.isFinite(v.x + v.y + v.z));
        if (!dirs.length) return;
        const claims = (m.c || []).map((id) => (id >= 0 && id !== a.id ? g.combat.actors.find((x) => x.id === id) || null : null));
        a.lastFire = this.time;
        it.mag--;
        if (a.character) a.character.fire();
        g.combat.fireWeapon(a, it, _o, dirs[0], 0, { dirs, claims });
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
        const piece = st.place({ kind: p.kind, x: +p.x, y: +p.y, z: +p.z, rot: +p.rot, key: p.key, level: p.level, valid: true }, mat, a);
        if (piece) inv.spendMats(mat, BUILD.cost);
        return;
      }
      case 'int': {
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
      case 'rl': {
        const it = inv.slots[m.s];
        if (!it || it.type !== 'weapon') return;
        const w = WEAPONS[it.id];
        it.mag += inv.takeAmmo(w.ammo, Math.max(0, w.mag - it.mag));
        return;
      }
      case 'use': {
        const it = inv.slots[m.s];
        if (!it || it.type !== 'consumable') return;
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
      case 'fall': {
        const d = Math.max(0, Math.min(250, +m.d || 0));
        if (d > 0) g.combat.applyDamage(a, d, { fall: true, source: null, storm: true });
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
        if (m.give === 'ammo') for (const k of ['light', 'medium', 'shells', 'heavy']) inv.add({ type: 'ammo', ammo: k, count: 120 });
        else {
          const item = debugItem(m.give, m.rarity);
          if (item) inv.add(item);
        }
        return;
      default:
    }
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

  dispose(game) {
    this.started = false;
    this._clearRemotes(game);
    for (const [obj, k, own, v] of this._saved || []) {
      if (own) obj[k] = v;
      else delete obj[k];
    }
    this._saved = null;
    this._wrapped = false;
    this.room.close();
  }
}

void TAU;
