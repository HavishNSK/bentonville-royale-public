// BENTONVILLE ROYALE — the local player: an Actor plus controller and camera.
//
//   const player = new Player({ id, name, character, inventory });
//   player.spawnDrop(x, z)              // start falling from PLAYER.dropHeight
//   player.update(dt, input, game)      // game supplies world, combat, loot, structures, hud, fx, sfx, settings
//   player.updateCamera(camera, dt, world)
//
// Keys: WASD move, Shift sprint, Space jump, Ctrl/Z crouch, 1-5 / wheel hotbar,
// F pickaxe, Q/C/V/X build pieces, G cycle material, R reload, E interact,
// LMB fire / place / swing / use, RMB aim, B emote.
//
// Multiplayer client (g.net.isClient): this stays the local, predicted
// controller, but every authoritative effect goes to the host instead:
// fire, swing, build, interact, reload, consumables and fall damage are sent
// with g.net.action(...). Health, shield, kills, inventory and death come back
// from the host (src/net/ClientSession.js). Solo and host play are unchanged.

import * as THREE from 'three';
import { PLAYER, CAMERA, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, clamp, damp, TAU, weaponStats } from '../core/config.js';

const PIECE_ACTIONS = { buildWall: 'wall', buildFloor: 'floor', buildRamp: 'ramp', buildCone: 'cone' };
export const FREEFALL_SPEED = 38;
export const DEPLOY_HEIGHT = 55;
export const FREEFALL_ACROSS = 22; // m/s sideways while skydiving

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _v = new THREE.Vector3();

/** The client session when this player is a multiplayer client, else null. */
const clientNet = (g) => (g && g.net && g.net.isClient ? g.net : null);

/**
 * Positions `camera` behind `pivot` on an orbit (heading/pitch), pulled in
 * when world geometry is in the way. Shared by the player and spectating.
 */
export function placeOrbitCamera(camera, world, pivot, heading, pitch, dist, shoulder, rise = CAMERA.rise) {
  const cp = Math.cos(pitch);
  _fwd.set(Math.sin(heading) * cp, Math.sin(pitch), -Math.cos(heading) * cp);
  _right.set(Math.cos(heading), 0, Math.sin(heading));
  _cam.copy(pivot).addScaledVector(_right, shoulder);
  _cam.y += rise;
  // pull in when something is between the pivot and the camera
  _v.copy(_fwd).multiplyScalar(-1);
  const hit = world ? world.raycast(_cam.x, _cam.y, _cam.z, _v.x, _v.y, _v.z, dist + 0.3, null) : null;
  const d = hit ? Math.max(0.6, hit.t - 0.3) : dist;
  _cam.addScaledVector(_v, d);
  if (_cam.y < 0.3) _cam.y = 0.3;
  camera.position.copy(_cam);
  _v.copy(_cam).add(_fwd);
  camera.lookAt(_v);
}

export class Player {
  constructor({ id = 0, name = 'You', character = null, inventory }) {
    // ---- Actor contract
    this.id = id;
    this.name = name;
    this.isPlayer = true;
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

    // ---- controller state
    this.mode = 'ground'; // 'freefall' | 'glide' | 'ground' | 'dead'
    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.ads = false;
    this.buildPiece = null;
    this.buildMat = 'wood';
    this.cooldown = 0;
    this.reloadT = 0;
    this.reloadTotal = 0;
    this.reloadItem = null;
    this.useT = 0;
    this.useTotal = 0;
    this.useItem = null;
    this.bloom = 0;
    this.spread = 0;
    this.triggerHeld = false;
    this.placeCooldown = 0;
    this.stepT = 0;
    this.fallSpeed = 0;
    this.camDist = CAMERA.distance;
    this.fovMul = 1;
    this.objBar = null; // { collider, until, point }
    this.prompt = null;
    this.placement = null;
    this.aimOrigin = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.lastEquipped = null;
    this.emoting = false;
    this.god = false;
  }

  reset() {
    this.health = PLAYER.maxHealth;
    this.shield = 0;
    this.alive = true;
    this.kills = 0;
    this.vel.set(0, 0, 0);
    this.mode = 'ground';
    this.buildPiece = null;
    this.buildMat = 'wood';
    this.cooldown = this.reloadT = this.useT = this.bloom = 0;
    this.reloadItem = this.useItem = null;
    this.placement = null;
    this.emoting = false;
    this.lastEquipped = null;
    if (this.inventory) this.inventory.reset();
    if (this.character) this.character.reset();
  }

  spawnDrop(x, z, height = PLAYER.dropHeight) {
    this.pos.set(x, height, z);
    this.vel.set(0, 0, 0);
    this.mode = 'freefall';
    this.grounded = false;
  }

  get position() {
    return this.pos;
  }

  get airborneDrop() {
    return this.mode === 'freefall' || this.mode === 'glide';
  }

  // ------------------------------------------------------------------ update

  update(dt, input, g) {
    const { world, hud } = g;
    if (!this.alive) {
      this.mode = 'dead';
      if (this.character) this.character.update(dt, { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: this.heading, pitch: 0 });
      return;
    }

    // ---- look
    const sens = (g.settings.sensitivity || 1) * 0.0022 * (this.ads ? (g.settings.adsSensitivity ?? 0.6) : 1);
    this.heading = (this.heading + input.dx * sens) % TAU;
    if (this.heading < 0) this.heading += TAU;
    this.pitch = clamp(this.pitch - input.dy * sens * (g.settings.invertY ? -1 : 1), CAMERA.minPitch, CAMERA.maxPitch);

    // ---- loadout keys (ignored while dropping)
    const inv = this.inventory;
    if (!this.airborneDrop) this._handleLoadoutKeys(input, g);

    // ---- movement wish
    let mf = 0;
    let ms = 0;
    if (input.action('moveForward')) mf += 1;
    if (input.action('moveBack')) mf -= 1;
    if (input.action('moveRight')) ms += 1;
    if (input.action('moveLeft')) ms -= 1;
    const len = Math.hypot(mf, ms);
    if (len > 1) {
      mf /= len;
      ms /= len;
    }
    const sh = Math.sin(this.heading);
    const ch = Math.cos(this.heading);
    const wx = sh * mf + ch * ms;
    const wz = -ch * mf + sh * ms;

    this.crouching = this.mode === 'ground' && (input.action('crouch') || input.action('crouchAlt'));
    this.sprinting = this.mode === 'ground' && input.action('sprint') && mf > 0 && !this.ads && !this.crouching && this.useT <= 0;
    this.ads = this.mode === 'ground' && input.action('aim') && !this.buildPiece && !!this._gun();

    let speed = PLAYER.runSpeed;
    if (this.sprinting) speed = PLAYER.sprintSpeed;
    if (this.ads || this.useT > 0) speed = PLAYER.walkSpeed;
    if (this.crouching) speed = PLAYER.walkSpeed * 0.65;

    const p = this.pos;
    const v = this.vel;
    const groundY = world.groundHeight(p.x, p.z, p.y);
    if (this.mode === 'freefall' || this.mode === 'glide') {
      const above = p.y - groundY;
      if (this.mode === 'freefall' && (above < DEPLOY_HEIGHT || input.actionHit('jump'))) {
        this.mode = 'glide';
        g.sfx.play('jump', { volume: 0.6 });
      }
      const hs = this.mode === 'glide' ? PLAYER.glideSpeed : FREEFALL_ACROSS;
      const fall = this.mode === 'glide' ? PLAYER.glideFallSpeed : FREEFALL_SPEED;
      v.x = damp(v.x, wx * hs, 3, dt);
      v.z = damp(v.z, wz * hs, 3, dt);
      v.y = damp(v.y, -fall - (this.mode === 'freefall' ? mf * 10 : 0), 2.5, dt);
    } else {
      const accel = this.grounded ? PLAYER.accelGround : PLAYER.accelAir;
      const tx = wx * speed;
      const tz = wz * speed;
      const dx = tx - v.x;
      const dz = tz - v.z;
      const dl = Math.hypot(dx, dz);
      const step = accel * dt;
      if (dl <= step) {
        v.x = tx;
        v.z = tz;
      } else {
        v.x += (dx / dl) * step;
        v.z += (dz / dl) * step;
      }
      if (this.grounded && input.actionHit('jump') && !this.crouching) {
        v.y = PLAYER.jumpSpeed;
        this.grounded = false;
        g.sfx.play('jump', { volume: 0.5 });
      }
      v.y -= PLAYER.gravity * dt;
    }

    // ---- integrate
    p.x += v.x * dt;
    p.z += v.z * dt;
    if (!this.airborneDrop || p.y - groundY < 20) world.resolveCircle(p, this.radius, this.height);
    const b = world.bounds;
    p.x = clamp(p.x, b.minX + 2, b.maxX - 2);
    p.z = clamp(p.z, b.minZ + 2, b.maxZ - 2);

    const wasGrounded = this.grounded;
    const prevVy = v.y;
    p.y += v.y * dt;
    const gy = world.groundHeight(p.x, p.z, Math.max(p.y, p.y - v.y * dt));
    if (wasGrounded && v.y <= 0 && p.y > gy && p.y - gy < 0.75) p.y = gy; // stick to ramps / steps
    const ceil = world.ceilingAbove(p.x, p.z, p.y);
    if (v.y > 0 && p.y + this.height > ceil) {
      p.y = Math.max(gy, ceil - this.height);
      v.y = 0;
    }
    if (p.y <= gy) {
      p.y = gy;
      if (!wasGrounded) this._land(prevVy, g);
      v.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.surface = world.surface;

    // ---- actions
    if (!this.airborneDrop) this._actions(dt, input, g);
    else {
      hud.prompt(null);
      if (g.structures) g.structures.setGhost(null);
    }

    // ---- character
    const hspeed = Math.hypot(v.x, v.z);
    if (this.character) {
      const c = this.character;
      if (this.emoting && (hspeed > 0.5 || input.action('fire'))) {
        this.emoting = false;
        c.emote(false);
      }
      c.root.position.copy(p);
      const sg = this.ads && this._gun() && WEAPONS[this._gun().id];
      c.root.visible = !(sg && sg.kind === 'sniper' && sg.zoom <= 0.35);
      c.update(dt, {
        fwd: hspeed > 0.1 ? (v.x * sh - v.z * ch) / hspeed : 0,
        side: hspeed > 0.1 ? (v.x * ch + v.z * sh) / hspeed : 0,
        speed: hspeed,
        grounded: this.grounded || this.mode === 'ground',
        gliding: this.mode === 'glide',
        heading: this.heading,
        pitch: this.pitch,
      });
    }

    // ---- footsteps
    if (this.grounded && hspeed > 2 && !this.crouching) {
      this.stepT -= dt * (hspeed / PLAYER.runSpeed);
      if (this.stepT <= 0) {
        this.stepT = 0.36;
        // indoor floors (raised 'floor', or a shell interior at terrain level) sound like
        // boards; roofs and roads are hard
        const sf = this.surface;
        const s =
          sf === 'build' || sf === 'floor' || (sf === 'ground' && world.interiorAt(p.x, p.z))
            ? 'wood'
            : sf === 'roof' || world.roadAt(p.x, p.z)
              ? 'road'
              : 'grass';
        g.sfx.play('footstep', { surface: s, volume: 0.45 });
      }
    }
    void inv;
  }

  _land(vy, g) {
    if (this.mode === 'freefall' || this.mode === 'glide') {
      this.mode = 'ground';
      g.fx.dustPuff(this.pos, { scale: 1.6 });
      g.sfx.play('land', {});
      if (g.onPlayerLanded) g.onPlayerLanded(this);
    } else if (vy < -8) {
      g.sfx.play('land', { volume: clamp(-vy / 20, 0.3, 1) });
      if (vy < -22 && !this.god) {
        const net = clientNet(g);
        if (net) net.action({ k: 'fall', d: Math.round((-vy - 22) * 4) });
        else g.combat.applyDamage(this, (-vy - 22) * 4, { fall: true, source: null, storm: true });
      }
    }
  }

  _gun() {
    const it = this.inventory && this.inventory.current();
    return it && it.type === 'weapon' ? it : null;
  }

  // ------------------------------------------------------------- loadout

  _handleLoadoutKeys(input, g) {
    const inv = this.inventory;
    for (let i = 0; i < 5; i++) {
      if (input.actionHit('slot' + (i + 1))) {
        this.buildPiece = null;
        inv.select(i);
      }
    }
    if (input.wheel) {
      this.buildPiece = null;
      inv.next(input.wheel > 0 ? 1 : -1);
    }
    if (input.actionHit('pickaxe')) {
      this.buildPiece = null;
      inv.select(-1);
    }
    for (const a in PIECE_ACTIONS) {
      if (input.actionHit(a)) this.setBuildPiece(PIECE_ACTIONS[a]);
    }
    if (input.actionHit('cycleMaterial')) this.cycleMaterial();
    if (input.actionHit('emote') && this.character && this.grounded) {
      this.emoting = !this.emoting;
      this.character.emote(this.emoting);
    }
  }

  setBuildPiece(kind) {
    this.buildPiece = BUILD.pieces.includes(kind) ? kind : null;
    this._cancelUse();
    this._cancelReload();
  }

  cycleMaterial() {
    const i = MATERIALS.indexOf(this.buildMat);
    this.buildMat = MATERIALS[(i + 1) % MATERIALS.length];
  }

  _cancelReload() {
    this.reloadT = 0;
    this.reloadItem = null;
  }

  _cancelUse() {
    if (this.useT > 0 && this.character) this.character.cancelOneShot();
    this.useT = 0;
    this.useItem = null;
  }

  // ------------------------------------------------------------- actions

  _actions(dt, input, g) {
    const inv = this.inventory;
    const cur = inv.current();
    this.cooldown -= dt;
    this.placeCooldown -= dt;

    // equipped model on the character
    const eqId = this.buildPiece ? 'pickaxe' : cur ? (cur.type === 'weapon' ? cur.id : 'none') : 'pickaxe';
    if (eqId !== this.lastEquipped) {
      if (this.lastEquipped !== null) g.sfx.play('weapon_switch', { volume: 0.5 });
      this.lastEquipped = eqId;
      if (this.character) this.character.setEquipped(eqId, cur && WEAPONS[cur.id] ? WEAPONS[cur.id].twoHanded : true);
      if (this.reloadItem && this.reloadItem !== cur) this._cancelReload();
      if (this.useItem && this.useItem !== cur) this._cancelUse();
      this.cooldown = Math.max(this.cooldown, 0.2);
    }

    // bloom decay
    this.bloom = Math.max(0, this.bloom - dt * 0.12);

    const lmb = input.action('fire');
    const lmbClick = input.actionHit('fire');

    // ---- reload
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this._finishReload();
    }
    if (input.actionHit('reload') && !this.buildPiece) this.startReload(g);

    // ---- consumable channel
    if (this.useT > 0) {
      this.useT -= dt;
      if (this.useT <= 0) this._finishUse(g);
    }

    // ---- interact
    this._interact(input, g, dt);

    if (this.buildPiece) {
      this._buildMode(dt, lmb, lmbClick, g);
    } else {
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      if (cur && cur.type === 'weapon') {
        const w = WEAPONS[cur.id];
        const want = w.auto ? lmb : lmbClick || (lmb && !this.triggerHeld);
        if (want) this.fire(g);
      } else if (cur && cur.type === 'consumable') {
        if (lmbClick && this.useT <= 0) this.startUse(g);
      } else if (lmb && this.cooldown <= 0) {
        this.swing(g);
      }
    }
    this.triggerHeld = lmb;
  }

  /**
   * Walk-over ammo: floor ammo and ammo boxes are collected without E (a few times a
   * second). A multiplayer client sends the same 'int' request E does; the host
   * validates and applies it, so requests are throttled per record until it answers.
   */
  _autoPickup(dt, g) {
    if (g.settings && g.settings.autoPickupAmmo === false) return; // settings toggle (default on)
    const loot = g.loot;
    if (!loot || !loot.autoPickups || this.airborneDrop) return;
    this._autoT = (this._autoT || 0) - dt;
    if (this._autoT > 0) return;
    this._autoT = 0.1;
    const net = clientNet(g);
    const now = g.time || 0;
    const sent = this._autoSent || (this._autoSent = new Map());
    const recs = loot.autoPickups(this.pos, undefined, this._autoBuf || (this._autoBuf = []));
    for (const rec of recs) {
      if (rec.kind === 'item' && !this.inventory.canTake(rec.item)) continue;
      if (net) {
        const last = sent.get(rec.id);
        if (last != null && now - last < 1) continue;
        sent.set(rec.id, now);
      }
      this.interactWith(rec, g);
    }
    if (sent.size > 64) for (const [id, t] of sent) if (now - t > 2) sent.delete(id);
  }

  _interact(input, g, dt = 0) {
    const loot = g.loot;
    this._autoPickup(dt, g);
    let rec = null;
    if (loot && loot.nearest) rec = loot.nearest(this.pos);
    if (rec) {
      const swap = rec.kind === 'item' && rec.item && this.inventory.wouldSwap && this.inventory.wouldSwap(rec.item);
      const verb = rec.kind === 'item' ? (swap ? 'Swap for' : 'Pick up') : 'Open';
      g.hud.prompt('[' + (input.label ? input.label('interact') : 'E') + '] ' + verb + ' ' + (rec.label || ''));
      if (input.actionHit('interact')) this.interactWith(rec, g);
    } else g.hud.prompt(null);
  }

  /** Opens / takes a loot record (see Loot.nearest). */
  interactWith(rec, g) {
    const loot = g.loot;
    if (!loot || !rec) return false;
    const net = clientNet(g);
    if (net) {
      net.action({ k: 'int', id: rec.id }, true);
      return true;
    }
    if (rec.kind === 'chest' || rec.kind === 'ammoBox') {
      const ok = loot.open(rec.id);
      return ok;
    }
    const item = loot.take(rec.id);
    if (!item) return false;
    this.takeItem(item, g);
    return true;
  }

  /** Adds an item to the inventory, drops anything displaced, plays feedback. */
  takeItem(item, g) {
    const left = this.inventory.add(item);
    if (left && g.loot) g.loot.drop(left, this.pos.clone());
    const isAmmo = item.type === 'ammo';
    g.sfx.play(isAmmo ? 'pickup_ammo' : 'pickup', { volume: 0.7 });
    if (g.fx && item.rarity) g.fx.pickupBurst(this.pos.clone().setY(this.pos.y + 0.6), item.rarity);
    g.hud.toast(itemLabel(item), 'pickup');
  }

  // --- guns

  startReload(g) {
    const it = this._gun();
    if (!it || this.reloadT > 0) return false;
    const w = WEAPONS[it.id];
    if (it.mag >= w.mag) return false;
    if ((this.inventory.ammo[w.ammo] || 0) <= 0) {
      g.hud.toast('No ' + w.ammo + ' ammo', 'warn');
      return false;
    }
    this.reloadItem = it;
    this._g = g;
    const reload = weaponStats(it.id, it.rarity).reload;
    this.reloadT = this.reloadTotal = reload;
    if (this.character) this.character.reload(reload);
    g.sfx.play('reload', { volume: 0.7, weapon: w.kind === 'shotgun' ? 'shotgun' : it.id });
    return true;
  }

  _finishReload() {
    const it = this.reloadItem;
    this.reloadItem = null;
    this.reloadT = 0;
    if (!it) return;
    const w = WEAPONS[it.id];
    const got = this.inventory.takeAmmo(w.ammo, w.mag - it.mag);
    it.mag += got;
    const net = clientNet(this._g);
    if (net) net.action({ k: 'rl', s: this.inventory.slots.indexOf(it) }, true);
  }

  computeSpread() {
    const it = this._gun();
    if (!it) return 0;
    const w = WEAPONS[it.id];
    let s = !this.ads && w.hipSpread ? w.hipSpread : w.spread;
    s += this.bloom;
    if (this.ads) s *= 0.55;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded) s *= 2.2;
    else if (hs > 1) s *= 1 + Math.min(1, hs / PLAYER.sprintSpeed) * 0.9;
    if (this.crouching) s *= 0.75;
    return s;
  }

  fire(g) {
    const it = this._gun();
    if (!it || this.cooldown > 0) return false;
    if (this.reloadT > 0) return false;
    this._cancelUse();
    const w = WEAPONS[it.id];
    if (it.mag <= 0) {
      if (!this.startReload(g)) {
        g.sfx.play('empty_click', { volume: 0.6 });
        this.cooldown = 0.3;
      }
      return false;
    }
    it.mag--;
    this.cooldown = 1 / w.rate;
    const spread = this.computeSpread();
    this.bloom = Math.min(w.maxBloom || 0, this.bloom + (w.bloom || 0));
    if (this.character) this.character.fire();
    const res = g.combat.fireWeapon(this, it, this.aimOrigin, this.aimDir, spread);
    const net = clientNet(g);
    if (net) net.sendFire(this, it, this.aimOrigin, g.combat.lastDirs, res);
    // recoil
    this.pitch = clamp(this.pitch + (w.kind === 'sniper' ? 0.05 : w.kind === 'shotgun' ? 0.04 : 0.008), CAMERA.minPitch, CAMERA.maxPitch);
    if (it.mag <= 0) this.startReload(g);
    return res;
  }

  // --- pickaxe

  swing(g) {
    if (this.cooldown > 0) return null;
    this.cooldown = 1 / PICKAXE.rate;
    if (this.character) this.character.swing();
    // swing from the chest, along the aim ray
    _v.set(this.pos.x, this.pos.y + 1.3, this.pos.z);
    const res = g.combat.swingPickaxe(this, _v, this.aimDir);
    const net = clientNet(g);
    if (net) {
      net.action({ k: 'sw', o: [_v.x, _v.y, _v.z], d: [this.aimDir.x, this.aimDir.y, this.aimDir.z] }, true);
      if (res && res.harvested) {
        const sp = g.project(res.point);
        if (sp) g.hud.floatText(sp.x, sp.y, '+' + res.harvested.count, res.harvested.mat);
        this.objBar = { collider: res.collider, until: g.time + 2, point: res.point, kind: res.harvested.mat };
      }
      return res;
    }
    if (res && res.harvested) {
      const m = res.harvested.mat;
      const cap = PLAYER.matCap;
      const mats = this.inventory.mats;
      const before = mats[m] || 0;
      mats[m] = Math.min(cap, before + res.harvested.count);
      const got = mats[m] - before;
      const sp = g.project(res.point);
      if (sp && got > 0) g.hud.floatText(sp.x, sp.y, '+' + got, m);
      const c = res.collider;
      this.objBar = res.destroyed ? null : { collider: c, until: g.time + 2, point: res.point, kind: m };
    }
    return res;
  }

  // --- consumables

  startUse(g) {
    const it = this.inventory.current();
    if (!it || it.type !== 'consumable') return false;
    const def = CONSUMABLES[it.id];
    if (!def) return false;
    if (def.heal > 0 && def.shield <= 0 && this.health >= PLAYER.maxHealth) {
      g.hud.toast('Health is full', 'warn');
      return false;
    }
    if (def.shield > 0 && def.heal <= 0 && this.shield >= PLAYER.maxShield) {
      g.hud.toast('Shield is full', 'warn');
      return false;
    }
    this._cancelReload();
    this.useItem = it;
    this.useT = this.useTotal = def.useTime;
    if (this.character) this.character.useItem(def.useTime);
    return true;
  }

  _finishUse(g) {
    const it = this.useItem;
    this.useItem = null;
    this.useT = 0;
    if (!it || this.inventory.current() !== it) return;
    const slot = this.inventory.slots.indexOf(it);
    const used = this.inventory.useConsumable();
    if (!used) return;
    const def = CONSUMABLES[used.id];
    const net = clientNet(g);
    if (net) {
      // the host applies the heal; play the feedback now
      net.action({ k: 'use', s: slot }, true);
      g.sfx.play(def.sound, { volume: 0.8 });
      if (g.fx) g.fx.aura(this.pos, def.shield > 0 ? 'shield' : 'heal', 1.2);
      return;
    }
    this.health = Math.min(PLAYER.maxHealth, this.health + def.heal);
    this.shield = Math.min(PLAYER.maxShield, this.shield + def.shield);
    g.sfx.play(def.sound, { volume: 0.8 });
    if (g.fx) g.fx.aura(this.pos, def.shield > 0 ? 'shield' : 'heal', 1.2);
  }

  // --- building

  _buildMode(dt, lmb, lmbClick, g) {
    const st = g.structures;
    if (!st || !st.plan) return;
    this.placement = st.plan(this.buildPiece, this.pos, this.heading, this.pitch);
    st.setGhost(this.placement, this.buildMat);
    if ((lmbClick || (lmb && this.placeCooldown <= 0)) && this.placement) this.tryPlace(g);
  }

  /** Places the current ghost if valid and affordable. Returns the piece or null. */
  tryPlace(g) {
    const st = g.structures;
    if (!st || !this.buildPiece) return null;
    if (!this.placement) this.placement = st.plan(this.buildPiece, this.pos, this.heading, this.pitch);
    const pl = this.placement;
    this.placeCooldown = 0.12;
    if (!pl || !pl.valid) return null;
    const mats = this.inventory.mats;
    if ((mats[this.buildMat] || 0) < BUILD.cost) {
      g.sfx.play('build_denied', { volume: 0.6 });
      g.hud.toast('Not enough ' + this.buildMat, 'warn');
      this.placeCooldown = 0.4;
      return null;
    }
    const net = clientNet(g);
    if (net) {
      // the host places it and echoes it to everyone; a refused piece is refunded by the inventory sync
      if (st.at && st.at(pl)) return null;
      net.action({ k: 'b', p: { kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, key: pl.key, level: pl.level }, m: this.buildMat }, true);
      this.inventory.spendMats(this.buildMat, BUILD.cost);
      return pl;
    }
    const piece = st.place(pl, this.buildMat, this);
    if (piece) this.inventory.spendMats(this.buildMat, BUILD.cost);
    return piece;
  }

  // ------------------------------------------------------------- camera

  updateCamera(camera, dt, world, baseFov = CAMERA.fov) {
    const it = this._gun();
    const zoom = this.ads && it ? WEAPONS[it.id].zoom : 1;
    const want = this.airborneDrop ? 8.5 : this.ads ? CAMERA.distance * 0.55 : CAMERA.distance;
    this.camDist = damp(this.camDist, want, 10, dt);
    this.fovMul = damp(this.fovMul, zoom, 14, dt);
    const fov = baseFov * this.fovMul;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const crouchDrop = this.crouching ? 0.45 : 0;
    _pivot.set(this.pos.x, this.pos.y + CAMERA.pivotHeight - crouchDrop, this.pos.z);
    placeOrbitCamera(camera, world, _pivot, this.heading, this.pitch, this.camDist, this.airborneDrop ? 0 : CAMERA.shoulder);

    // aim ray: from the camera through the screen centre, starting level with the player
    camera.getWorldDirection(this.aimDir);
    const along = _v.copy(_pivot).sub(camera.position).dot(this.aimDir);
    this.aimOrigin.copy(camera.position).addScaledVector(this.aimDir, Math.max(0, along));
  }
}

export function itemLabel(item) {
  if (!item) return '';
  if (item.type === 'weapon') return (item.rarity ? cap(item.rarity) + ' ' : '') + (WEAPONS[item.id] ? WEAPONS[item.id].name : item.id);
  if (item.type === 'consumable') return (CONSUMABLES[item.id] ? CONSUMABLES[item.id].name : item.id) + (item.count > 1 ? ' x' + item.count : '');
  if (item.type === 'ammo') return '+' + item.count + ' ' + item.ammo + ' ammo';
  if (item.type === 'material') return '+' + item.count + ' ' + item.mat;
  return String(item.id || item.type);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
