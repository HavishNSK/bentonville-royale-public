// BENTONVILLE ROYALE — reboot vans and reboot cards (team modes).
//
// One Catfish Ken's reboot van parks at every DROP_ZONES POI (same spot on every machine:
// the placement only depends on the map). When a player in a team mode is eliminated while
// a teammate still stands, they drop a reboot card. A teammate picks it up (interact) and
// holds interact at a ready van for REBOOT.time; every card they carry is rebooted: those
// players come back standing next to the van with REBOOT.loadout, and the van cools down.
//
//   const rb = new Reboot({ scene, world, fx, sfx });
//   rb.setup()                        // once the world is built (vans + colliders)
//   rb.reset({ teamMode, authoritative }) // match start (clears cards / cooldowns)
//   rb.dropCard(victim, actors)       // host / solo, from Game._onEliminate
//   rb.cardNear(actor) / rb.take(actor, card)       // pick a card up
//   rb.vanNear(actor) / actor.rebootVan = van       // holding interact at a van
//   rb.cardsOf(actor)                 // cards an actor carries
//   rb.update(dt, actors)             // every frame: timers (authoritative) + visuals
//   rb.onReboot = (victim, van, x, y, z, heading) => {}  // host / solo: bring them back
//   rb.onEvent = (e) => {}            // host: replicate (see HostSession)
//   rb.applyEvent(e, actorById)       // client: mirror the host's events
//
// Authoritative (solo / host): cards, holders, progress and the reboot itself. A client only
// mirrors events ('rcd' card dropped, 'rcp' picked up, 'rcx' gone, 'rbu' van in use / free,
// 'rbd' rebooted) and predicts its own progress ring.

import * as THREE from 'three';
import { DROP_ZONES, REBOOT } from '../core/config.js';
import { buildRebootVan, buildRebootCard, REBOOT_VAN } from '../render/RebootVan.js';
import { sameTeam } from './Teams.js';

const CARD_COLOR = 0x38e1ff;
const VAN_DRAW_DIST = 320; // metres

/** Small deterministic RNG from a string (same van spots on every machine). */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  let s = h >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 1) / 0x7fffffff;
  };
}

export class Reboot {
  constructor({ scene = null, world = null, fx = null, sfx = null } = {}) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sfx = sfx;
    this.vans = [];
    this.cards = new Map(); // victim id -> card
    this.time = 0;
    this.teamMode = false;
    this.authoritative = true;
    this.onReboot = null;
    this.onEvent = null;
    this.myTeam = null; // client / local player: only this team's cards are drawn
    this.viewer = null; // camera position (Vector3): Catfish Ken looks at / waves to it
  }

  /** Parks one van near each POI and registers its collider. Safe to call once. */
  setup() {
    if (this.vans.length || !this.world) return this.vans;
    const world = this.world;
    const lm = world.landmarks || {};
    const hl = REBOOT_VAN.halfLength;
    const hw = REBOOT_VAN.halfWidth;
    for (const zone of DROP_ZONES) {
      const l = lm[zone.key];
      if (!l) continue;
      const rng = seeded('reboot:' + zone.key);
      const spot = this._findSpot(rng, l.x, l.z, Math.min(70, Math.max(25, (l.r || 40) * 0.6)));
      const heading = rng() * Math.PI * 2;
      const fx = Math.sin(heading);
      const fz = -Math.cos(heading);
      const rx = -fz; // right of the van
      const rz = fx;
      const corners = [
        [spot.x + fx * hl + rx * hw, spot.z + fz * hl + rz * hw],
        [spot.x + fx * hl - rx * hw, spot.z + fz * hl - rz * hw],
        [spot.x - fx * hl - rx * hw, spot.z - fz * hl - rz * hw],
        [spot.x - fx * hl + rx * hw, spot.z - fz * hl + rz * hw],
      ];
      let col = null;
      if (world.addPoly) {
        col = world.addPoly(corners, REBOOT_VAN.height, 'vehicle', 'metal', []);
        col.hp = col.maxHp = Infinity; // can't be harvested or destroyed
        col.rebootVan = true;
      }
      const y = world.surfaceHeight ? world.surfaceHeight(spot.x, spot.z) : 0;
      const van = {
        i: this.vans.length,
        key: zone.key,
        label: zone.label,
        x: spot.x,
        y,
        z: spot.z,
        heading,
        fx,
        fz,
        cooldownUntil: 0,
        user: null, // actor holding interact (authoritative), or the id the host told us about
        t: 0,
        col,
        mesh: null,
      };
      if (this.scene && typeof document !== 'undefined') {
        const m = buildRebootVan();
        m.position.set(spot.x, y, spot.z);
        // model front is -z; heading 0 faces -z too (atan2(fx, -fz))
        m.rotation.y = -heading;
        this.scene.add(m);
        van.mesh = m;
      }
      this.vans.push(van);
    }
    return this.vans;
  }

  _findSpot(rng, cx, cz, radius) {
    const world = this.world;
    const clear = REBOOT_VAN.halfLength + 1.5;
    for (let i = 0; i < 80; i++) {
      const a = rng() * Math.PI * 2;
      const d = 12 + rng() * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (world.inBounds && !world.inBounds(x, z, 30)) continue;
      if (world.blockedAt && world.blockedAt(x, z, clear)) continue;
      if (world.areaAt && world.areaAt(x, z) === 'water') continue;
      if (world.interiorAt && world.interiorAt(x, z)) continue;
      if (world.gasStationAt && world.gasStationAt(x, z, clear)) continue; // not parked on a gas station forecourt
      return { x, z };
    }
    const p = world.randomOpenPoint ? world.randomOpenPoint(rng, cx, cz, radius * 2, clear, { x: cx, z: cz }) : { x: cx, z: cz };
    return { x: p.x, z: p.z };
  }

  /** Match start. */
  reset({ teamMode = false, authoritative = true, myTeam = null } = {}) {
    for (const c of this.cards.values()) this._removeCardMesh(c);
    this.cards.clear();
    this.time = 0;
    this.teamMode = !!teamMode;
    this.authoritative = authoritative;
    this.myTeam = myTeam;
    for (const v of this.vans) {
      v.cooldownUntil = 0;
      v.user = null;
      v.t = 0;
      if (v.mesh) v.mesh.visible = true;
    }
  }

  // ------------------------------------------------------------------ queries

  vanReady(van) {
    return this.time >= van.cooldownUntil;
  }

  /** Seconds until `van` is ready again (0 = ready). */
  vanCooldown(van) {
    return Math.max(0, van.cooldownUntil - this.time);
  }

  /** Distance from (x, z) to the van's side (0 inside its footprint). */
  _vanDist(van, x, z) {
    const dx = x - van.x;
    const dz = z - van.z;
    const along = Math.abs(dx * van.fx + dz * van.fz) - REBOOT_VAN.halfLength;
    const across = Math.abs(dx * -van.fz + dz * van.fx) - REBOOT_VAN.halfWidth;
    return Math.hypot(Math.max(0, along), Math.max(0, across));
  }

  /** Nearest van within use range of `actor`, or null. */
  vanNear(actor, slack = 0) {
    let best = null;
    let bd = REBOOT.useRange + slack;
    for (const v of this.vans) {
      if (Math.abs(actor.pos.y - v.y) > 3) continue;
      const d = this._vanDist(v, actor.pos.x, actor.pos.z);
      if (d <= bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** Nearest ready van to (x, z) (bots), or null. */
  nearestReadyVan(x, z, eta = 0) {
    let best = null;
    let bd = Infinity;
    for (const v of this.vans) {
      if (v.cooldownUntil > this.time + eta) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  /** A point next to the van's serving side (where bots stand to use it). */
  standPoint(van, out = { x: 0, z: 0 }) {
    const rx = -van.fz;
    const rz = van.fx;
    out.x = van.x + rx * (REBOOT_VAN.halfWidth + 0.9);
    out.z = van.z + rz * (REBOOT_VAN.halfWidth + 0.9);
    return out;
  }

  /** A card `actor` can pick up right now (a teammate's, on the ground, in range), or null. */
  cardNear(actor) {
    if (!this.teamMode) return null;
    let best = null;
    let bd = REBOOT.cardRange * REBOOT.cardRange;
    for (const c of this.cards.values()) {
      if (c.holder != null || c.team !== actor.team) continue;
      const dx = c.x - actor.pos.x;
      const dz = c.z - actor.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bd && Math.abs(c.y - actor.pos.y) < 3) {
        bd = d2;
        best = c;
      }
    }
    return best;
  }

  /** Cards on the ground for `team` (bots go get them). */
  groundCards(team) {
    const out = [];
    for (const c of this.cards.values()) if (c.holder == null && c.team === team) out.push(c);
    return out;
  }

  /** Cards carried by `actor` (actor object on the host, or its id on a client). */
  cardsOf(actor) {
    const out = [];
    const id = actor && actor.id != null ? actor.id : actor;
    for (const c of this.cards.values()) if (c.holder === id) out.push(c);
    return out;
  }

  // -------------------------------------------------------------- authoritative

  /** Host / solo: an eliminated team player leaves a card when a teammate still stands. */
  dropCard(victim, actors) {
    if (!this.teamMode || !this.authoritative || !victim || victim.left) return null;
    let mate = false;
    for (const a of actors) if (a !== victim && a.alive && sameTeam(a, victim)) mate = true;
    if (!mate) return null;
    // cards the victim carried fall where they died
    for (const c of this.cardsOf(victim)) this._dropHeld(c, victim.pos);
    // the card lands on the ground under them (eliminated mid-air, mid-jump or up on builds it
    // used to hang where they died, out of reach)
    const p = victim.pos;
    return this._addCard({ v: victim.id, name: victim.name, team: victim.team, x: p.x, y: this._groundY(p.x, p.y, p.z), z: p.z, until: this.time + REBOOT.cardTime });
  }

  /** Host / solo: `actor` takes `card`. */
  take(actor, card) {
    if (!this.authoritative || !card || card.holder != null || !actor.alive || actor.downed) return false;
    if (card.team !== actor.team) return false;
    card.holder = actor.id;
    this._showCard(card);
    if (this.sfx) this.sfx.play('pickup', { x: card.x, y: card.y, z: card.z, volume: 0.8 });
    this._emit({ e: 'rcp', v: card.v, by: actor.id });
    return true;
  }

  /** The walkable surface at or below (x, y, z): terrain, a floor, a roof or a build. */
  _groundY(x, y, z) {
    const w = this.world;
    if (!w || !w.groundHeight) return y;
    const g = w.groundHeight(x, z, y + 0.3);
    return Number.isFinite(g) && g <= y + 0.35 ? g : y;
  }

  _dropHeld(card, pos) {
    card.holder = null;
    card.x = pos.x;
    card.y = this._groundY(pos.x, pos.y, pos.z);
    card.z = pos.z;
    card.until = Math.max(card.until, this.time + 30);
    this._showCard(card);
    this._emit({ e: 'rcd', v: card.v, n: card.name, tm: card.team, x: r2(card.x), y: r2(card.y), z: r2(card.z), u: Math.round(card.until - this.time) });
  }

  _addCard({ v, name, team, x, y, z, until }) {
    const old = this.cards.get(v);
    if (old) this._removeCardMesh(old);
    const card = { v, name, team, x, y, z, until, holder: null, mesh: null, spin: Math.random() * 6 };
    this.cards.set(v, card);
    this._showCard(card);
    this._emit({ e: 'rcd', v, n: name, tm: team, x: r2(x), y: r2(y), z: r2(z), u: Math.round(until - this.time) });
    return card;
  }

  _removeCard(card, emit = true) {
    this._removeCardMesh(card);
    this.cards.delete(card.v);
    if (emit) this._emit({ e: 'rcx', v: card.v });
  }

  _emit(e) {
    if (this.authoritative && this.onEvent) this.onEvent(e);
  }

  /**
   * Every frame. Authoritative: card timers, holders that died, van progress for actors with
   * actor.rebootVan set (holding interact), and the reboot itself.
   */
  update(dt, actors) {
    this.time += dt;
    if (this.authoritative && this.teamMode) this._tick(dt, actors);
    this._present(dt);
  }

  _tick(dt, actors) {
    const byId = this._byId || (this._byId = new Map());
    byId.clear();
    for (const a of actors) byId.set(a.id, a);
    const standing = this._standing || (this._standing = new Set());
    standing.clear();
    for (const a of actors) if (a.alive) standing.add(a.team);
    for (const c of [...this.cards.values()]) {
      const victim = byId.get(c.v);
      // rebooted some other way, gone, or nobody on the team is left to bring it in
      if (!victim || victim.alive || !standing.has(c.team)) {
        this._removeCard(c);
        continue;
      }
      if (c.holder != null) {
        const h = byId.get(c.holder);
        if (!h || !h.alive) this._dropHeld(c, h ? h.pos : c);
        continue;
      }
      if (this.time > c.until) this._removeCard(c);
    }
    // van progress
    for (const v of this.vans) {
      const u = v.user;
      if (!u) continue;
      const ok = u.alive && !u.downed && u.rebootVan === v && this.vanReady(v) && this.cardsOf(u).length > 0 && this._vanDist(v, u.pos.x, u.pos.z) <= REBOOT.useRange + 0.5;
      if (!ok) {
        this._release(v);
        continue;
      }
      v.t += dt;
      if (v.t >= REBOOT.time) this._reboot(v, u, byId);
    }
    for (const a of actors) {
      const v = a.rebootVan;
      if (!v || v.user === a) continue;
      if (v.user || !a.alive || a.downed || !this.vanReady(v) || !this.cardsOf(a).length || this._vanDist(v, a.pos.x, a.pos.z) > REBOOT.useRange + 0.5) {
        a.rebootVan = null;
        continue;
      }
      v.user = a;
      v.t = 0;
      this._emit({ e: 'rbu', i: v.i, by: a.id });
    }
  }

  _release(v) {
    if (v.user && v.user.rebootVan === v) v.user.rebootVan = null;
    v.user = null;
    v.t = 0;
    this._emit({ e: 'rbu', i: v.i, by: -1 });
  }

  _reboot(v, user, byId) {
    const cards = this.cardsOf(user);
    const ids = [];
    // spread rebooted players along the serving side
    const rx = -v.fz;
    const rz = v.fx;
    cards.forEach((c, k) => {
      const victim = byId.get(c.v);
      this._removeCard(c, false);
      if (!victim || victim.alive) return;
      const along = (k - (cards.length - 1) / 2) * 1.4;
      const x = v.x + rx * (REBOOT_VAN.halfWidth + 1.4) + v.fx * along;
      const z = v.z + rz * (REBOOT_VAN.halfWidth + 1.4) + v.fz * along;
      const y = this.world && this.world.groundHeight ? this.world.groundHeight(x, z, v.y + 2) : v.y;
      const heading = Math.atan2(rx, -rz);
      ids.push([c.v, r2(x), r2(y), r2(z), r2(heading)]);
      if (this.onReboot) this.onReboot(victim, v, x, y, z, heading);
    });
    v.cooldownUntil = this.time + REBOOT.cooldown;
    if (user.rebootVan === v) user.rebootVan = null;
    v.user = null;
    v.t = 0;
    this._rebootFx(v);
    this._emit({ e: 'rbd', i: v.i, by: user.id, r: ids, cd: REBOOT.cooldown });
  }

  _rebootFx(v) {
    if (this.fx && this.fx.aura) this.fx.aura(new THREE.Vector3(v.x, v.y, v.z), 'shield', 2);
    if (this.sfx) this.sfx.play('chest_open', { x: v.x, y: v.y + 2, z: v.z, volume: 1 });
  }

  // ---------------------------------------------------------------- client mirror

  /** Client: mirrors one host event. */
  applyEvent(e) {
    switch (e.e) {
      case 'rcd': {
        const old = this.cards.get(e.v);
        const card = old || { v: e.v, name: e.n, team: e.tm, mesh: null, spin: Math.random() * 6 };
        Object.assign(card, { x: e.x, y: e.y, z: e.z, until: this.time + (e.u || 0), holder: null, name: e.n, team: e.tm });
        this.cards.set(e.v, card);
        this._showCard(card);
        return;
      }
      case 'rcp': {
        const c = this.cards.get(e.v);
        if (!c) return;
        c.holder = e.by;
        this._showCard(c);
        if (this.sfx) this.sfx.play('pickup', { x: c.x, y: c.y, z: c.z, volume: 0.8 });
        return;
      }
      case 'rcx': {
        const c = this.cards.get(e.v);
        if (c) this._removeCard(c, false);
        return;
      }
      case 'rbu': {
        const v = this.vans[e.i];
        if (!v) return;
        v.user = e.by >= 0 ? e.by : null;
        v.t = 0;
        return;
      }
      case 'rbd': {
        const v = this.vans[e.i];
        if (!v) return;
        for (const r of e.r || []) {
          const c = this.cards.get(r[0]);
          if (c) this._removeCard(c, false);
        }
        v.cooldownUntil = this.time + (e.cd || REBOOT.cooldown);
        v.user = null;
        v.t = 0;
        this._rebootFx(v);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ visuals

  _showCard(card) {
    // only your own team sees its cards (on the ground)
    const visible = card.holder == null && (this.myTeam == null || card.team === this.myTeam);
    if (!visible) {
      if (card.mesh) card.mesh.visible = false;
      return;
    }
    if (!card.mesh && this.scene && typeof document !== 'undefined') {
      card.mesh = buildRebootCard(CARD_COLOR);
      this.scene.add(card.mesh);
    }
    if (card.mesh) {
      card.mesh.visible = true;
      card.mesh.position.set(card.x, card.y + 1.1, card.z);
    }
  }

  _removeCardMesh(card) {
    if (!card.mesh) return;
    if (card.mesh.parent) card.mesh.parent.remove(card.mesh);
    card.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    card.mesh = null;
  }

  _present(dt) {
    for (const c of this.cards.values()) {
      if (!c.mesh || !c.mesh.visible) continue;
      c.spin += dt * 2;
      c.mesh.rotation.y = c.spin;
      c.mesh.position.y = c.y + 1.1 + Math.sin(c.spin * 1.3) * 0.12;
    }
    for (const v of this.vans) {
      // far vans are not drawn (the map is ~1 km across; the minimap still shows them)
      if (v.mesh && this.viewer) {
        const far = (v.x - this.viewer.x) ** 2 + (v.z - this.viewer.z) ** 2 > VAN_DRAW_DIST * VAN_DRAW_DIST;
        v.mesh.visible = !far;
        if (far) continue;
      }
      if (v.mesh && v.mesh.userData.update) v.mesh.userData.update(dt, this.viewer);
      const set = v.mesh && v.mesh.userData.setBeacon;
      if (!set) continue;
      if (v.user != null) v.t = Math.min(REBOOT.time, v.t + (this.authoritative ? 0 : dt)); // clients advance the ring locally
      const state = !this.vanReady(v) ? 'cooldown' : v.user != null ? 'busy' : 'ready';
      set(state, v.user != null ? v.t / REBOOT.time : 0, dt);
    }
  }

  dispose() {
    for (const c of this.cards.values()) this._removeCardMesh(c);
    this.cards.clear();
  }
}

function r2(v) {
  return Math.round(v * 100) / 100;
}
