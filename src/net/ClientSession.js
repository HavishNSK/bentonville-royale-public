// BENTONVILLE ROYALE — the client side of a multiplayer match.
//
// The client runs only its own Player (movement predicted locally) and draws
// everyone else as Puppets interpolated ~INTERP_DELAY behind the host's
// snapshots. Authoritative actions (fire, swing, build, interact, reload, use,
// fall damage) go to the host through action(); the host's events drive
// effects, the kill feed, loot, structures, damage and death.
//
//   const s = new ClientSession(conn, game);      // conn = Net.js ClientConn
//   game.net = s; game.startClientMatch(startMsg)  // calls s.begin(game, start)
//
// Combat runs with `authoritative = false` here, so local shots and swings only
// play effects; the pellets and what they appeared to hit are sent to the host.

import * as THREE from 'three';
import { WEAPONS, PLAYER, QUALITY, TAU, weaponStats } from '../core/config.js';
import { Character } from '../game/Character.js';
import { Inventory } from '../game/Inventory.js';
import { SKINS, EMOTES, botLoadout } from '../game/Cosmetics.js';
import { itemLabel } from '../game/Player.js';
import { impactSound, placeOnShoulder } from '../game/Combat.js';
import {
  STATE_HZ, INTERP_DELAY, FLAG, XFLAG, EQUIP, SURF, decodeSnapshot, encodeState, seqNewer, rnd, resolvePanelEvent,
} from './protocol.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const DEV = !!(import.meta.env && import.meta.env.DEV);
const PREDICT_MS = 3000; // a locally placed build the host has not echoed by then was refused

function equipIdOf(p) {
  if (p.buildPiece) return 'pickaxe';
  const it = p.inventory && p.inventory.current();
  return it ? (it.type === 'weapon' ? it.id : it.id === 'grenade' ? 'grenade' : 'none') : 'pickaxe';
}

function lerpAngle(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

/** A remote human or bot drawn on this client from host snapshots. */
export class Puppet {
  constructor(info, character) {
    this.id = info.id;
    this.name = info.n;
    this.human = !!info.h;
    this.team = info.tm != null ? info.tm : info.id;
    this.isPlayer = false;
    this.isPuppet = true;
    this.character = character;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.pitch = 0;
    this.radius = PLAYER.radius;
    this.height = PLAYER.height;
    this.alive = true;
    this.inBus = true;
    this.crouching = false;
    this.health = PLAYER.maxHealth;
    this.shield = 0;
    this.kills = 0;
    this.flags = 0;
    this.equip = 'pickaxe';
    this.downed = false;
    this.downHp = 0;
    this.beingRevived = false;
    this.reviveT = 0;
    this.seen = false;
    this._prev = new THREE.Vector3();
  }

  get mode() {
    return !this.alive ? 'dead' : this.downed ? 'downed' : this.inBus ? 'bus' : this.flags & FLAG.gliding ? 'glide' : this.flags & FLAG.grounded ? 'ground' : 'freefall';
  }

  setRow(r) {
    const was = this.flags;
    this.flags = r.flags;
    this.inBus = !!(r.flags & FLAG.bus);
    this.crouching = !!(r.flags & FLAG.crouch);
    this.downed = this.alive && !!(r.xf & XFLAG.downed);
    this.beingRevived = this.downed && !!(r.xf & XFLAG.revived);
    if (this.downed) {
      this.downHp = r.health;
      this.health = 0;
    } else this.health = r.health;
    this.shield = r.shield;
    this.kills = r.kills;
    const eq = EQUIP[r.equip] || 'pickaxe';
    const c = this.character;
    if (c && this.alive) {
      if (eq !== this.equip) c.setEquipped(eq, WEAPONS[eq] ? WEAPONS[eq].twoHanded !== false : true);
      if (r.flags & FLAG.reloading && !(was & FLAG.reloading) && WEAPONS[eq]) c.reload(weaponStats(eq).reload); // rarity is not replicated; lowest-rarity time
      const em = !!(r.flags & FLAG.emote);
      if (em !== !!(was & FLAG.emote)) c.emote(em, this.emoteId);
    }
    this.equip = eq;
    if (this.alive && !(r.flags & FLAG.alive)) this.kill();
    else if (!this.alive && r.flags & FLAG.alive) this.revive(); // rebooted (the 'rbd' event normally gets here first)
  }

  /** Back from the dead (reboot van). */
  revive() {
    if (this.alive) return;
    this.alive = true;
    this.downed = false;
    this.equip = null; // re-equip from the next snapshot row
    if (this.character) this.character.reset();
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.downed = false;
    if (this.character) this.character.die();
  }

  present(dt, viewer, cd2) {
    const c = this.character;
    if (!c) return;
    if (dt > 0) {
      _v.copy(this.pos).sub(this._prev).divideScalar(dt);
      if (_v.lengthSq() > 2500) _v.set(0, 0, 0); // a snap, not motion
      this.vel.lerp(_v, 1 - Math.exp(-12 * dt));
    }
    this._prev.copy(this.pos);
    c.root.position.copy(this.pos);
    const far = viewer && (this.pos.x - viewer.x) ** 2 + (this.pos.z - viewer.z) ** 2 > cd2;
    c.root.visible = this.seen && !this.inBus && !far;
    c.setDowned(this.downed);
    if (!c.root.visible) return;
    const v = this.vel;
    const hs = this.alive ? Math.hypot(v.x, v.z) : 0;
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    c.update(dt, {
      fwd: hs > 0.3 ? (v.x * sh - v.z * ch) / hs : 0,
      side: hs > 0.3 ? (v.x * ch + v.z * sh) / hs : 0,
      speed: hs > 0.3 ? hs : 0,
      grounded: !this.alive || !!(this.flags & FLAG.grounded),
      gliding: this.alive && !!(this.flags & FLAG.gliding),
      heading: this.heading,
      pitch: this.pitch,
    });
  }

  dispose() {
    if (!this.character) return;
    this.character.root.removeFromParent();
    this.character.dispose();
    this.character = null;
  }
}

export class ClientSession {
  constructor(conn, game) {
    this.conn = conn;
    this.game = game;
    this.isClient = true;
    this.isHost = false;
    this.id = conn.id;
    this.puppets = new Map();
    this.snaps = [];
    this.offset = null;
    this.lastSeq = -1;
    this._predicted = new Map(); // piece -> performance.now() it was placed locally
    this.aliveCount = 0;
    this.started = false;
    this.ended = false;
    this.queue = [];
    this.seq = 0;
    this.stateSeq = 0;
    this.lastInvSeq = 0;
    this._specAsk = -1;
    this._specInv = null;
    this._specInvOf = -1;
    this.pendingInv = null;
    this._stateAcc = 0;
    this._tpUntil = 0;
    this.stats = { t0: performance.now(), snaps: 0, snapBytes: 0, lost: 0 };
    conn.onMessage = (msg) => (this.started ? this._message(msg) : this.queue.push(msg));
    conn.onRaw = (buf) => this._raw(buf);
  }

  // ---------------------------------------------------------------- start

  /** Called by Game.startClientMatch once the scene is reset. */
  begin(game, start) {
    this.id = start.you;
    const kits = game.kits;
    for (const info of start.roster) {
      if (info.id === this.id) {
        game.player.name = info.n;
        continue;
      }
      const kit = kits[info.k] || kits.player;
      // bots' pickaxe / back bling follow from their id; humans send theirs
      const look = info.h ? { pickaxe: info.px || undefined, backbling: info.bb || undefined } : botLoadout(info.id);
      const ch =
        info.sk && SKINS[info.sk] && game.makeSkinCharacter
          ? game.makeSkinCharacter(info.sk, info.c, look.pickaxe, look.backbling)
          : kit
            ? new Character(kit, { weapons: game.weaponScenes, canopyColor: info.c, ...look })
            : null;
      if (ch) {
        ch.root.visible = false;
        game.scene.add(ch.root);
      }
      const pup = new Puppet(info, ch);
      if (info.sk) pup.skin = info.sk;
      this.puppets.set(info.id, pup);
      game.combat.register(pup);
    }
    this.aliveCount = start.roster.length;
    // tell the host (and through it everyone) which outfit we wear
    if (game.skin && SKINS[game.skin]) this.action({ k: 'sk', id: game.skin, px: game.pickaxe, bb: game.backbling });
    // Follow-up rounds of a burst gun are scheduled by Combat; forward each one like a trigger pull.
    game.combat.onBurstShot = (s, it, o, dirs, res) => {
      if (s === game.player) this.sendFire(s, it, o, dirs, res);
    };
    // Our own sniper round reached someone here: ask the host to count it (it checks its own path).
    game.combat.onProjectileHit = (pj, actor) => {
      if (pj.shooter === game.player && pj.netSeq && actor && actor.id != null) this.action({ k: 'ph', n: pj.netSeq, v: actor.id });
    };
    this.started = true;
    this.stats.t0 = performance.now();
    this.conn.bytesIn = 0;
    this.conn.bytesOut = 0;
    const q = this.queue;
    this.queue = [];
    for (const m of q) this._message(m);
  }

  /** A piece this client placed ahead of the host's echo ('sp'); see _expirePredicted. */
  predictBuild(piece) {
    this._predicted.set(piece, performance.now());
  }

  /** Predicted pieces the host never confirmed (refused): taken back quietly. */
  _expirePredicted() {
    if (!this._predicted.size) return;
    const now = performance.now();
    const st = this.game.structures;
    for (const [piece, at] of this._predicted) {
      if (!piece.alive) this._predicted.delete(piece);
      else if (now - at > PREDICT_MS) {
        this._predicted.delete(piece);
        if (st) st._destroy(piece, null, false, false);
      }
    }
  }

  actorById(id) {
    if (id === this.id) return this.game.player;
    return this.puppets.get(id) || null;
  }

  nameOf(id) {
    const a = this.actorById(id);
    return a ? a.name : '?';
  }

  // ---------------------------------------------------------------- outgoing

  /** Reliable action to the host. `inv`: it changes the inventory (host sync waits for it). */
  /** Spectating: the host's copy of actor `a`'s inventory (null until it arrives). */
  specInventory(a) {
    return a && this._specInv && this._specInvOf === a.id ? this._specInv : null;
  }

  action(msg, inv = false) {
    msg.t = 'a';
    msg.seq = ++this.seq;
    if (inv) this.lastInvSeq = this.seq;
    this.conn.send(msg);
  }

  sendFire(player, item, origin, dirs, records) {
    const s = player.inventory.slots.indexOf(item);
    if (s < 0) return;
    this.action(
      {
        k: 'fire',
        s,
        w: item.id,
        o: [rnd(origin.x, 3), rnd(origin.y, 3), rnd(origin.z, 3)],
        d: dirs.map((d) => [rnd(d.x, 5), rnd(d.y, 5), rnd(d.z, 5)]),
        c: (records || []).map((r) => (r.hitActor && r.hitActor !== player ? r.hitActor.id : -1)),
      },
      true
    );
    // sniper rounds from this trigger pull carry the action seq, so a later hit claim names them
    for (const pj of this.game.combat.lastProjectiles || []) pj.netSeq = this.seq;
  }

  /** Crystal Bridges painting portal: the host validates (range, cooldown, storm) and allows the jump. */
  portal(i) {
    this._tpUntil = performance.now() + 1500;
    this.action({ k: 'ptl', i: i | 0 });
  }

  /** QA: teleports must be announced so the host's speed check lets them through. */
  debugTeleport(p) {
    this._tpUntil = performance.now() + 1500;
    this.action({ k: 'tp', x: p.x, y: p.y, z: p.z });
  }

  /** Inventory screen reorder; the host swaps its copy and the next sync confirms it. */
  sendSwap(a, b) {
    this.action({ k: 'mv', a, b }, true);
  }

  debugGive(what, rarity) {
    this.action({ k: 'dbg', give: what, rarity }, true);
  }

  _sendState() {
    const p = this.game.player;
    let f = 0;
    if (p.alive) f |= FLAG.alive;
    if (p.grounded) f |= FLAG.grounded;
    if (p.mode === 'glide') f |= FLAG.gliding;
    if (p.crouching) f |= FLAG.crouch;
    if (p.mode === 'bus') f |= FLAG.bus;
    if (p.emoting) f |= FLAG.emote;
    if (p.ads) f |= FLAG.ads;
    if (p.reloadT > 0) f |= FLAG.reloading;
    const eq = EQUIP.indexOf(equipIdOf(p));
    this.conn.sendRaw(
      encodeState(this.stateSeq++, {
        x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x, vy: p.vel.y, vz: p.vel.z,
        heading: p.heading, pitch: p.pitch, flags: f, mode: p.mode === 'dead' ? 'ground' : p.mode, equip: eq < 0 ? 0 : eq,
      })
    );
  }

  // ---------------------------------------------------------------- incoming

  _raw(buf) {
    const s = decodeSnapshot(buf);
    if (!s) return;
    if (this.lastSeq >= 0 && !seqNewer(s.seq, this.lastSeq)) return; // late or duplicate (unordered channel)
    if (this.lastSeq >= 0) this.stats.lost += ((s.seq - this.lastSeq) & 0xffff) - 1;
    this.lastSeq = s.seq;
    this.stats.snaps++;
    this.stats.snapBytes += buf.byteLength;
    const now = performance.now() / 1000;
    const sample = s.time - now;
    if (this.offset == null || Math.abs(sample - this.offset) > 0.5) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.08;
    s.byId = new Map();
    for (const r of s.actors) s.byId.set(r.id, r);
    this.snaps.push(s);
    if (this.snaps.length > 30) this.snaps.shift();
    if (!this.started) return;
    this._applyLatest(s);
  }

  _applyLatest(s) {
    const g = this.game;
    const st = g.storm;
    if (st) {
      for (const k of ['cx', 'cz', 'r', 'nextCx', 'nextCz', 'nextR', 'phase', 'mode', 'secondsLeft', 'dps']) st[k] = s.storm[k];
    }
    this.aliveCount = s.alive;
    const me = s.byId.get(this.id);
    const p = g.player;
    if (me && p.alive) {
      const down = !!(me.xf & XFLAG.downed);
      if (down && !p.downed) g.netKnock(null); // the 'kn' event normally gets here first
      p.downed = down;
      p.beingRevived = down && !!(me.xf & XFLAG.revived);
      if (down) {
        p.downHp = me.health;
        p.health = 0;
      } else p.health = me.health;
      p.shield = me.shield;
      p.kills = me.kills;
    }
    for (const r of s.actors) {
      const pup = this.puppets.get(r.id);
      if (pup) pup.setRow(r);
    }
  }

  _message(msg) {
    if (msg.t === 'ev') {
      for (const e of msg.l) {
        try {
          this._event(e);
        } catch (err) {
          this.game._error('net event ' + e.e, err);
        }
      }
    } else if (msg.t === 'inv') this.pendingInv = msg;
    else if (msg.t === 'sinv') {
      // inventory of the player we are spectating
      const I = this._specInv || (this._specInv = new Inventory());
      for (let i = 0; i < I.slots.length; i++) I.slots[i] = msg.s[i] ? { ...msg.s[i] } : null;
      Object.assign(I.ammo, msg.ammo);
      Object.assign(I.mats, msg.mats);
      I.selected = msg.sel;
      this._specInvOf = msg.id;
    }
    else if (msg.t === 'cor') {
      if (performance.now() < this._tpUntil) return;
      const p = this.game.player;
      p.pos.set(msg.x, msg.y, msg.z);
      p.vel.set(0, 0, 0);
    }
  }

  _event(e) {
    const g = this.game;
    const fx = g.fx;
    const sfx = g.sfx;
    switch (e.e) {
      case 'sh':
        if (e.a !== this.id) this._shot(e);
        return;
      case 'sw': {
        if (e.a === this.id) return;
        const a = this.puppets.get(e.a);
        if (a && a.character) a.character.swing();
        if (a) sfx.play('swing', { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z, volume: 0.6 });
        return;
      }
      case 'hit':
        return this._hit(e);
      case 'el':
        return this._elim(e);
      case 'rcd':
      case 'rcx':
      case 'rbu':
        if (g.reboot) g.reboot.applyEvent(e);
        return;
      case 'rcp':
        if (g.reboot) g.reboot.applyEvent(e);
        if (e.by === this.id && g.reboot) {
          const c = g.reboot.cards.get(e.v);
          g.hud.toast((c ? c.name : 'Teammate') + "'s reboot card: take it to a reboot van", 'pickup');
        }
        return;
      case 'rbd':
        return this._rebooted(e);
      case 'kn':
        return this._knock(e);
      case 'sph':
        if (e.a === this.id && g.showSiphon) g.showSiphon(e.h, e.s);
        return;
      case 'pg': {
        if (e.a === this.id) return;
        const a = this.actorById(e.a);
        if (a && g.netPing) g.netPing(a, e);
        return;
      }
      case 'as':
        if (e.a === this.id && g.showAssist) {
          const v = this.actorById(e.v);
          g.showAssist(v ? v.name : '');
        }
        return;
      case 'ts':
        // kills / assists / damage dealt (team breakdown on the full map)
        for (const [id, k, as, d] of e.s || []) {
          const a = this.actorById(id);
          if (!a) continue;
          a.kills = k;
          a.assists = as;
          a.damageDealt = d;
        }
        return;
      case 'sk': {
        if (e.a === this.id) return;
        const pup = this.puppets.get(e.a);
        if (pup && g.reskinActor) g.reskinActor(pup, SKINS[e.id] ? e.id : null, e.px, e.bb);
        return;
      }
      case 'em': {
        if (e.a === this.id) return;
        const pup = this.puppets.get(e.a);
        if (!pup) return;
        pup.emoteId = EMOTES[e.id] ? e.id : null;
        if (pup.character && pup.character.mode === 'emote') pup.character.emote(true, pup.emoteId);
        return;
      }
      case 'cy': {
        // a teammate picked someone up (v) or put them down (-1)
        const c = this.actorById(e.c);
        if (!c) return;
        const was = c.carrying;
        if (was && was.carriedBy === c) was.carriedBy = null;
        c.carrying = null;
        const v = e.v >= 0 ? this.actorById(e.v) : null;
        if (v) {
          c.carrying = v;
          v.carriedBy = c;
          if (v === g.player) g.hud.toast(`${c.name} picked you up`, 'pickup');
        }
        return;
      }
      case 'rv': {
        const v = this.actorById(e.v);
        const by = e.by >= 0 ? this.actorById(e.by) : null;
        if (!v) return;
        v.downed = false;
        v.health = e.hp;
        v.reviveT = 0;
        if (v === g.player) {
          g.player.beingRevived = false;
          g.hud.announce('REVIVED', by ? `by ${by.name}` : '', 1800);
        }
        if (by === g.player && g.player.revivingTarget) {
          g.player.revivingTarget = null;
          g.player.reviveLocalT = 0;
        }
        if (fx && fx.aura) fx.aura(v.pos, 'heal', 1.2);
        g.hud.killFeed(by ? `${by.name} revived ${v.name}` : `${v.name} is back up`, 'revive', [v.name, by && by.name], g.player.name);
        return;
      }
      case 'au': {
        const a = this.puppets.get(e.a);
        if (a && fx) fx.aura(a.pos, e.kind, 1.2);
        return;
      }
      case 'gr': {
        // a grenade left someone's hand: fly it here too (the host owns the blast)
        if (!g.grenades) return;
        const a = this.actorById(e.a);
        if (e.r) {
          // a rocket: we already heard our own launch
          g.grenades.spawnRocket(e.id, a, _v.set(e.p[0], e.p[1], e.p[2]), _v2.set(e.v[0], e.v[1], e.v[2]));
          if (a !== g.player) {
            sfx.play('rocket_launch', { x: e.p[0], y: e.p[1], z: e.p[2] });
            if (a && a.character) a.character.fire();
          }
          return;
        }
        g.grenades.spawn(e.id, a, _v.set(e.p[0], e.p[1], e.p[2]), _v2.set(e.v[0], e.v[1], e.v[2]));
        sfx.play('grenade_throw', { x: e.p[0], y: e.p[1], z: e.p[2], volume: 0.7 });
        if (a && a !== g.player && a.character) a.character.swing();
        return;
      }
      case 'gx':
        if (g.grenades) g.grenades.explodeAt(e.id, _v.set(e.p[0], e.p[1], e.p[2]), !!e.r);
        return;
      case 'la': {
        const loot = g.loot;
        if (!loot || loot.byId.has(e.id)) return;
        const rec = loot._add(e.kind, e.x, e.y, e.z, e.yaw || 0, e.it || null, e.id);
        if (e.sp) rec.spill = { fx: e.sp[0], fy: e.sp[1], fz: e.sp[2], t: 0 };
        return;
      }
      case 'lr': {
        const loot = g.loot;
        const rec = loot && loot.byId.get(e.id);
        if (!rec) return;
        const item = rec.item;
        loot.take(e.id); // burst + sound + removal
        if (e.by === this.id && item) g.hud.toast(itemLabel(item), 'pickup');
        return;
      }
      case 'lo': {
        const loot = g.loot;
        const rec = loot && loot.byId.get(e.id);
        if (!rec || rec.opened) return;
        rec.opened = true;
        loot._fxOff(rec);
        loot._blipsDirty = true;
        _v.set(rec.x, rec.y, rec.z);
        if (fx) rec.kind === 'chest' ? fx.chestOpen(_v) : fx.pickupBurst(_v, 'common');
        sfx.play('chest_open', { x: rec.x, y: rec.y, z: rec.z });
        return;
      }
      case 'sp': {
        const st = g.structures;
        if (!st) return;
        const pl = { kind: e.kind, x: e.x, y: e.y, z: e.z, rot: e.rot, key: e.key, level: e.lv, valid: true };
        const had = st.at(pl);
        if (had && this._predicted.has(had)) {
          this._predicted.delete(had);
          if (e.a === this.id && had.mat === e.m) return; // our predicted piece: confirmed
          // someone else got the slot first (or another material): the host's piece wins
          st._destroy(had, null, false, false);
        } else if (had) return;
        st.place(pl, e.m, this.actorById(e.a));
        return;
      }
      case 'sd': {
        const st = g.structures;
        const piece = st && st.slots.get(e.key);
        if (!piece) return;
        piece.hp = Math.min(piece.maxHp, e.hp);
        if (st._paint) st._paint(piece);
        return;
      }
      case 'se': {
        const st = g.structures;
        const piece = st && st.slots.get(e.key);
        if (piece && st.edit) st.edit(piece, e.ed | 0);
        return;
      }
      case 'sdr': {
        const st = g.structures;
        const piece = st && st.slots.get(e.key);
        if (piece && st.setDoor) st.setDoor(piece, e.c | 0, e.v | 0);
        return;
      }
      case 'sx': {
        const st = g.structures;
        const piece = st && st.slots.get(e.key);
        if (piece) st.remove(piece, true);
        return;
      }
      case 'cx':
        return this._colliderGone(e);
      case 'wd':
      case 'wx':
        return this._panelEvent(e);
      case 'left':
        return;
      case 'end':
        this.ended = true;
        if (e.w === this.id || (g.teamMode && e.tm != null && e.tm >= 0 && e.tm === g.player.team)) g.netWin();
        return;
      default:
    }
  }

  _shot(e) {
    const g = this.game;
    const w = WEAPONS[e.w] || WEAPONS.pistol;
    const a = this.puppets.get(e.a);
    const from = _v;
    if (a && a.character && a.character.root.visible) a.character.muzzle(from);
    else from.set(e.o[0], e.o[1], e.o[2]);
    if (a && a.character) a.character.fire();
    if (e.b && Array.isArray(e.d) && Array.isArray(e.o)) return this._ballisticShot(e, w, a, from);
    const n = e.p.length / 3;
    if (!n) return;
    _v2.set(e.p[0], e.p[1], e.p[2]);
    _n.copy(_v2).sub(from).normalize();
    if (g.fx) g.fx.muzzleFlash(from, _n, { scale: w.kind === 'shotgun' ? 1.4 : 1 });
    g.sfx.play(w.sound, { x: from.x, y: from.y, z: from.z, volume: w.soundVolume });
    let impact = null;
    for (let i = 0; i < n; i++) {
      _v2.set(e.p[i * 3], e.p[i * 3 + 1], e.p[i * 3 + 2]);
      const surf = SURF[e.k[i]] || 'none';
      if (g.fx) {
        if (i === 0 || n <= 3 || i % 3 === 0) g.fx.tracer(from, _v2, { color: w.tracer, width: w.kind === 'sniper' ? 0.08 : 0.05 });
        if (surf !== 'none') {
          _n.copy(from).sub(_v2).normalize();
          g.fx.impact(_v2, _n, surf);
        }
      }
      if (surf !== 'none' && !impact) impact = { x: _v2.x, y: _v2.y, z: _v2.z, surf };
    }
    if (impact) g.sfx.play('bullet_impact', { x: impact.x, y: impact.y, z: impact.z, volume: 0.6, surface: impactSound(impact.surf) });
    if (w.pump) setTimeout(() => g.sfx.play('shotgun_pump', { x: from.x, y: from.y, z: from.z, volume: 0.7 }), 350);
  }

  /** Someone else's sniper round: fly a local copy for the streak and impact (no damage here). */
  _ballisticShot(e, w, a, from) {
    const g = this.game;
    if (!w.ballistic) return;
    _v2.set(+e.o[0], +e.o[1], +e.o[2]);
    if (!Number.isFinite(_v2.x + _v2.y + _v2.z)) return;
    if (g.fx) g.fx.muzzleFlash(from, _n.set(+e.d[0][0], +e.d[0][1], +e.d[0][2]), { scale: 1 });
    g.sfx.play(w.sound, { x: from.x, y: from.y, z: from.z, volume: w.soundVolume });
    for (const d of e.d.slice(0, 1)) {
      if (!Array.isArray(d)) continue;
      _n.set(+d[0], +d[1], +d[2]);
      if (!Number.isFinite(_n.x + _n.y + _n.z) || _n.lengthSq() < 1e-6) continue;
      g.combat.spawnProjectile(a || null, w, 1, _v2, _n.normalize(), from, 0);
    }
  }

  _hit(e) {
    const g = this.game;
    const p = g.player;
    const victim = this.actorById(e.v);
    if (victim && victim !== p) {
      if (e.dn) victim.downHp = e.hp;
      else victim.health = e.hp;
      victim.shield = e.sp;
    }
    if (e.sh > 0 && e.sp <= 0 && victim) {
      _v.copy(victim.pos).setY(victim.pos.y + 1.2);
      if (g.fx) g.fx.shieldPop(_v);
      g.sfx.play('shield_break', { x: _v.x, y: _v.y, z: _v.z });
    }
    if (e.v === this.id) {
      if (e.dn) p.downHp = e.hp;
      else p.health = e.hp;
      p.shield = e.sp;
      if (p.revivingTarget && p._stopRevive) p._stopRevive(g); // hurt while reviving: cancelled
      g.hud.damageFlash(Math.max(0.15, Math.min(1, e.d / 40)));
      if (!e.st) g.sfx.play('hurt', { volume: 0.7 });
    }
    if (e.s === this.id && e.v !== this.id) {
      g.hud.hitMarker(!!e.h, e.hp <= 0);
      g.sfx.play(e.h ? 'headshot' : 'hitmarker', { volume: 0.8 });
      if (e.p) {
        const s = g.project(_v.set(e.p[0], e.p[1], e.p[2]));
        if (s) g.hud.floatText(s.x, s.y, String(Math.round(e.d)), e.h ? 'crit' : e.sh > 0 ? 'shield' : 'damage');
      }
    }
  }

  _elim(e) {
    const g = this.game;
    const p = g.player;
    const victim = this.actorById(e.v);
    const killer = e.k >= 0 ? this.actorById(e.k) : null;
    if (victim && killer && killer !== victim) victim.lastAttacker = killer; // spectating follows the chain
    this.aliveCount = e.n;
    const vName = victim ? victim.name : '?';
    const kName = killer ? killer.name : null;
    let text;
    let kind = 'elim';
    if (e.how === 'left') text = `${vName} left the match`;
    else if (e.how === 'storm') {
      text = `${vName} was lost in the storm`;
      kind = 'storm';
    } else if (e.how === 'fall') text = `${vName} fell too far`;
    else if (e.how === 'bleed') text = kName ? `${vName} bled out (${kName})` : `${vName} bled out`;
    else if (e.how === 'wipe') text = kName ? `${kName} wiped ${vName}` : `${vName} was eliminated`;
    else if (e.how === 'grenade' && !kName) text = `${vName} blew themselves up`;
    else if (kName) text = `${kName} ${e.how === 'pickaxe' ? 'bonked' : e.how === 'grenade' ? 'blew up' : e.how === 'headshot' ? 'headshot' : 'eliminated'} ${vName}`;
    else text = `${vName} was eliminated`;
    if (e.k === this.id) kind = 'kill';
    if (e.v === this.id) kind = 'self';
    g.hud.killFeed(text, kind, [vName, kName], g.player.name);

    if (victim && victim !== p) {
      victim.kill();
      if (g.fx) g.fx.elimination(victim.pos, e.k === this.id ? 0xffc21f : 0xa66bff);
      g.sfx.play('elimination', { x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z });
    }
    if (e.k === this.id) {
      p.kills = e.kk;
      g.hud.announce(`ELIMINATED ${vName.toUpperCase()}`, `${p.kills} elimination${p.kills === 1 ? '' : 's'}`, 1800);
    }
    // team modes: our place, once the last of our team goes (pl 0 while teammates live on)
    if (e.pl > 0 && victim && g.teamMode && victim.team === p.team) g._deathPlacement = e.pl;
    if (e.v === this.id) {
      g.netDeath({ killer: killer && killer.alive ? killer : null, killerName: kName || (e.how === 'storm' ? 'the storm' : null), placement: e.pl, how: e.how });
    }
  }

  /** Host: a reboot van brought players back ([id, x, y, z, heading] each). */
  _rebooted(e) {
    const g = this.game;
    if (g.reboot) g.reboot.applyEvent(e);
    for (const [id, x, y, z, h] of e.r || []) {
      const a = this.actorById(id);
      if (!a) continue;
      if (a === g.player) {
        g.netRespawn(x, y, z, h);
      } else {
        a.revive();
        a.pos.set(x, y, z);
        a._prev.copy(a.pos);
        a.heading = h;
      }
      g.hud.killFeed(`${a.name} was rebooted`, 'revive', [a.name], g.player.name);
      if (g.fx && g.fx.aura) g.fx.aura(a.pos, 'shield', 1.4);
    }
  }

  _knock(e) {
    const g = this.game;
    const p = g.player;
    const victim = this.actorById(e.v);
    const by = e.k >= 0 ? this.actorById(e.k) : null;
    if (!victim || !victim.alive) return;
    const vName = victim.name;
    const kName = by ? by.name : null;
    let text;
    if (e.how === 'storm') text = `${vName} was knocked by the storm`;
    else if (e.how === 'fall') text = `${vName} fell and was knocked`;
    else if (kName) text = `${kName} ${e.how === 'pickaxe' ? 'bonked' : 'knocked'} ${vName}`;
    else text = `${vName} was knocked`;
    g.hud.killFeed(text, e.k === this.id ? 'kill' : e.v === this.id ? 'self' : victim.team === p.team ? 'mate' : 'knock', [vName, kName], g.player.name);
    if (e.k === this.id) g.hud.announce(`KNOCKED ${vName.toUpperCase()}`, 'Finish them before they are revived', 1600);
    if (victim === p) g.netKnock(kName);
    else {
      victim.downed = true;
      victim.health = 0;
      victim.shield = 0;
    }
  }

  /** Host's building wall panel damage / break (validated: peer messages are untrusted). */
  _panelEvent(e) {
    const g = this.game;
    const r = resolvePanelEvent(g.world, e);
    if (!r || !r.pn.alive) return;
    if (e.e === 'wx') g.combat.breakPanel(r.c, r.pn);
    else r.pn.hp = r.hp;
  }

  _colliderGone(e) {
    const g = this.game;
    const w = g.world;
    let found = null;
    if (e.ty === 'b') {
      // architecture box (Crystal Bridges glass): ids are assigned in build order, equal on every client
      const b = Number.isInteger(e.id) && w.boxById ? w.boxById(e.id) : null;
      if (!b || !b.alive || !(b.maxHp < 1e6)) return; // only breakable boxes (glass, furniture), never the building
      g.combat._destroyCollider(b, new THREE.Vector3(b.cx, (b.y0 + b.y1) / 2, b.cz));
      return;
    }
    w._each(e.x - 1, e.z - 1, e.x + 1, e.z + 1, false, (cell) => {
      const list = e.ty === 'p' ? cell.polys : cell.circles;
      for (const c of list) {
        if (!c.alive) continue;
        const hit = e.ty === 'p' ? Math.abs(c.minX - e.x) < 1e-3 && Math.abs(c.minZ - e.z) < 1e-3 : Math.abs(c.x - e.x) < 1e-3 && Math.abs(c.z - e.z) < 1e-3;
        if (hit) found = c;
      }
    });
    if (!found) return;
    const gy = w.groundHeight ? w.groundHeight(e.x, e.z, 1e4) : 0;
    g.combat._destroyCollider(found, new THREE.Vector3(e.x, gy + Math.min(3, (found.h || 2) * 0.5), e.z));
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const g = this.game;
    if (!this.started) return;
    this._interpolate(dt);
    this._expirePredicted();

    // host inventory, once it reflects every inventory action we sent
    const inv = this.pendingInv;
    const p = g.player;
    // (held while the inventory screen has a card pressed/lifted, so a drop swaps what was dragged)
    const dragging = g.inventoryOpen && g.invPanel && g.invPanel.isDragging && g.invPanel.isDragging();
    if (inv && inv.ack >= this.lastInvSeq && !(p.reloadT > 0) && !(p.useT > 0) && !dragging) {
      this.pendingInv = null;
      const I = p.inventory;
      for (let i = 0; i < I.slots.length; i++) I.slots[i] = inv.s[i] ? { ...inv.s[i] } : null;
      Object.assign(I.ammo, inv.ammo);
      Object.assign(I.mats, inv.mats);
    }

    // spectating: the host sends the inventory of whoever we watch
    const st = !p.alive && g.spectating && g.spectating.id != null ? g.spectating.id : -1;
    if (st !== this._specAsk) {
      this._specAsk = st;
      this.conn.send({ t: 'spec', id: st });
    }

    this._stateAcc += dt;
    if (this._stateAcc >= 1 / STATE_HZ && (g.state === 'drop' || g.state === 'play' || g.state === 'over')) {
      this._stateAcc = 0;
      // a backed-up upload only delays newer states: skip this one (the next supersedes it)
      if (p.alive && !(this.conn.backlog > 16 * 1024)) this._sendState();
    }
  }

  _interpolate(dt) {
    const snaps = this.snaps;
    if (!snaps.length) return;
    const g = this.game;
    const t = performance.now() / 1000 + this.offset - INTERP_DELAY;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i > 0; i--) {
      if (snaps[i - 1].time <= t) {
        a = snaps[i - 1];
        b = snaps[i];
        break;
      }
    }
    let k = b.time > a.time ? (t - a.time) / (b.time - a.time) : 1;
    k = Math.max(0, Math.min(1, k));
    const viewer = g.camera ? g.camera.position : null;
    const q = QUALITY[g.settings.performanceMode ? 'performance' : g.settings.quality] || QUALITY.medium;
    const cd2 = (q.charDist || 160) ** 2;
    for (const pup of this.puppets.values()) {
      const ra = a.byId.get(pup.id);
      const rb = b.byId.get(pup.id) || ra;
      if (!rb) continue;
      const r0 = ra || rb;
      if (!pup.seen || (r0.flags & FLAG.bus) !== (rb.flags & FLAG.bus)) {
        pup.pos.set(rb.x, rb.y, rb.z);
        pup._prev.copy(pup.pos);
        pup.heading = rb.heading;
        pup.seen = true;
      } else {
        pup.pos.set(r0.x + (rb.x - r0.x) * k, r0.y + (rb.y - r0.y) * k, r0.z + (rb.z - r0.z) * k);
        pup.heading = lerpAngle(r0.heading, rb.heading, k);
      }
      pup.pitch = r0.pitch + (rb.pitch - r0.pitch) * k;
      // the teammate we carry rides on our (unlagged) shoulder
      if (pup.carriedBy === g.player && pup.alive && pup.downed) placeOnShoulder(pup, g.player);
      pup.present(dt, viewer, cd2);
    }
  }

  bandwidth() {
    const secs = Math.max(0.001, (performance.now() - this.stats.t0) / 1000);
    return {
      secs,
      inBps: Math.round(this.conn.bytesIn / secs),
      outBps: Math.round(this.conn.bytesOut / secs),
      snapHz: +(this.stats.snaps / secs).toFixed(1),
      snapBytesAvg: this.stats.snaps ? Math.round(this.stats.snapBytes / this.stats.snaps) : 0,
      lost: this.stats.lost,
    };
  }

  dispose(game) {
    this.started = false;
    if (game.combat.onBurstShot) game.combat.onBurstShot = null;
    game.combat.onProjectileHit = null;
    for (const pup of this.puppets.values()) {
      game.combat.unregister(pup);
      pup.dispose();
    }
    this.puppets.clear();
    this.conn.close();
  }
}

export { DEV };
