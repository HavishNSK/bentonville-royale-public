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
import { rampDragQuarter, validEdit } from './Structures.js';
import { PLAYER, CAMERA, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, KNOCK, REBOOT, SWIM, clamp, damp, TAU, weaponStats } from '../core/config.js';
import { sameTeam } from './Teams.js';
import { placeOnShoulder } from './Combat.js';

const PIECE_ACTIONS = { buildWall: 'wall', buildFloor: 'floor', buildRamp: 'ramp', buildCone: 'cone' };
export const FREEFALL_SPEED = 38;
const EDIT_REACH = 7; // m from the aim origin to a piece you can start editing
export const DEPLOY_HEIGHT = 55;
export const FREEFALL_ACROSS = 22; // m/s sideways while skydiving

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _v = new THREE.Vector3();
const _mv = new THREE.Vector3();
// mantle: climbable ledge height above the feet (m); lower ones are steps, higher ones walls
const MANTLE = { min: 0.7, max: 2.3 };
const STEP_UP = 0.62; // World STEP: highest surface walked onto without jumping
const FLOOR_UNDER = 0.22; // a built floor's thickness: its underside sits this far below its top

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
    this.editing = null; // { piece, mask, hover, drag } while editing a built piece
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
    this.scopeT = 0; // 0..1 raise-to-eye progress on a scoped gun
    this.scopeView = false; // true while looking through the scope (first person + HUD overlay)
    this.objBar = null; // { collider, until, point }
    this.prompt = null;
    this.placement = null;
    this.aimOrigin = new THREE.Vector3();
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.lastEquipped = null;
    this.emoting = false;
    this.god = false;
    // team modes (see Combat): knocked state and revives
    this.downed = false;
    this.downHp = 0;
    this.knockedBy = null;
    this.reviver = null; // who is reviving us (host / solo)
    this.reviveT = 0; // our revive progress (s)
    this.revivingTarget = null; // downed teammate we are reviving
    this.reviveLocalT = 0; // our own revive hold time (drives the HUD ring; clients predict it)
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
    this.editing = null;
    this.emoting = false;
    this.lastEquipped = null;
    this.downed = false;
    this.downHp = 0;
    this.knockedBy = null;
    this.reviver = null;
    this.reviveT = 0;
    this.revivingTarget = null;
    this.reviveLocalT = 0;
    this.swimming = false;
    this.rebootVan = null; // reboot van we hold interact at (Reboot.js)
    this.rebootLocalT = 0;
    this._wasDown = false;
    this.mantle = null;
    this.assists = 0;
    this.damageDealt = 0;
    this.dmgFrom = null;
    this._wheel = null;
    this.carrying = null;
    this.carriedBy = null;
    this.dropZone = null;
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
      this.ads = false;
      this.scopeT = 0;
      this.scopeView = false;
      if (this.character) this.character.update(dt, { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: this.heading, pitch: 0 });
      return;
    }

    // ---- emote wheel (held open by the emote key; the mouse picks instead of looking)
    const wheelOpen = !!this._wheel;
    if (wheelOpen) this._emoteWheel(dt, input, g);

    // ---- look
    const sens = (g.settings.sensitivity || 1) * 0.0022 * (this.ads ? (g.settings.adsSensitivity ?? 0.6) : 1) * (this.scopeView ? 0.5 : 1);
    if (!wheelOpen) {
      this.heading = (this.heading + input.dx * sens) % TAU;
      if (this.heading < 0) this.heading += TAU;
      this.pitch = clamp(this.pitch - input.dy * sens * (g.settings.invertY ? -1 : 1), CAMERA.minPitch, CAMERA.maxPitch);
    }

    // ---- knocked: drop whatever was in hand (build / edit / reload / heal / emote)
    const down = !!this.downed;
    if (down && !this._wasDown) {
      this._endEdit(g);
      this.buildPiece = null;
      this._cancelReload();
      this._cancelUse();
      if (this.revivingTarget) this._stopRevive(g);
      if (this.rebootVan) this._stopReboot(g);
      if (this.emoting && this.character) this.character.emote(false);
      this.emoting = false;
      this.mantle = null;
      if (g.structures) g.structures.setGhost(null);
    }
    this._wasDown = down;

    // ---- loadout keys (ignored while dropping or knocked)
    const inv = this.inventory;
    if (!this.airborneDrop && !down && !this.carrying) this._handleLoadoutKeys(input, g);

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

    const swim = this.swimming; // last frame's (set after the ground resolve below)
    this.crouching = this.mode === 'ground' && !down && !swim && (input.action('crouch') || input.action('crouchAlt'));
    this.sprinting = this.mode === 'ground' && !down && !swim && input.action('sprint') && mf > 0 && !this.ads && !this.crouching && this.useT <= 0;
    this.ads = this.mode === 'ground' && !down && !swim && !this.carrying && input.action('aim') && !this.buildPiece && !this.editing && !!this._gun();
    // scoped guns: a short raise-to-eye, then the view snaps into the scope; lowering is instant
    const scoping = this.ads && !!WEAPONS[this._gun().id].scope;
    this.scopeT = scoping ? Math.min(1, this.scopeT + dt / 0.16) : 0;
    this.scopeView = scoping && this.scopeT >= 1;

    let speed = PLAYER.runSpeed;
    if (this.sprinting) speed = PLAYER.sprintSpeed;
    if (this.ads || this.useT > 0) speed = PLAYER.walkSpeed;
    if (this.crouching) speed = PLAYER.walkSpeed * 0.65;
    if (down) speed = PLAYER.runSpeed * KNOCK.crawlSpeed;
    if (this.revivingTarget || this.rebootVan) speed = 0; // kneeling over a teammate / at a reboot van (a move key lets go)
    if (swim) speed = PLAYER.runSpeed * SWIM.speed;
    if (this.carrying) speed *= 0.8; // a teammate on the shoulder slows you down
    if (down && this.carriedBy) speed = 0; // riding on a teammate's shoulder

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
      if (this.grounded && input.actionHit('jump') && !this.crouching && !down && !this.revivingTarget && !swim) {
        v.y = PLAYER.jumpSpeed;
        this.grounded = false;
        g.sfx.play('jump', { volume: 0.5 });
      }
      v.y -= PLAYER.gravity * dt;
    }

    // ---- mantle: jumping (or falling) forward into a chest-to-head-high ledge climbs onto it
    if (!this.mantle && this.mode === 'ground' && !down && !this.carrying && !this.revivingTarget && mf > 0.3 && (input.action('jump') || !this.grounded)) {
      this.mantle = this._findLedge(world, sh, ch);
      if (this.mantle) g.sfx.play('jump', { volume: 0.35 });
    }

    if (this.mantle) {
      // scripted climb: rise to the ledge first, then step over onto it
      const m = this.mantle;
      m.t = Math.min(1, m.t + dt / m.dur);
      const ku = Math.min(1, m.t / 0.6);
      const kf = Math.max(0, (m.t - 0.3) / 0.7);
      p.y = m.y0 + (m.y1 - m.y0) * (1 - (1 - ku) * (1 - ku));
      p.x = m.x0 + (m.x1 - m.x0) * kf * kf * (3 - 2 * kf);
      p.z = m.z0 + (m.z1 - m.z0) * kf * kf * (3 - 2 * kf);
      v.set(0, 0, 0);
      this.grounded = false;
      if (m.t >= 1) {
        this.mantle = null;
        p.y = world.groundHeight(p.x, p.z, p.y + 0.1);
        this.grounded = true;
      }
    } else {
    // ---- integrate
    const ox = p.x;
    const oz = p.z;
    const oy = p.y;
    // a floor / ramp already above us (where we stand now) can't be stepped or snapped onto
    const cap = world.builtAbove(ox, oz, oy);
    p.x += v.x * dt;
    p.z += v.z * dt;
    if (!this.airborneDrop || p.y - groundY < 20) world.resolveCircle(p, this.radius, this.height);
    const b = world.bounds;
    p.x = clamp(p.x, b.minX + 2, b.maxX - 2);
    p.z = clamp(p.z, b.minZ + 2, b.maxZ - 2);
    // walking into a floor's edge at body height (too high to step onto) blocks like a wall
    const fa = world.builtAbove(p.x, p.z, oy);
    if (fa < cap - 0.01 && fa - oy > STEP_UP && fa - FLOOR_UNDER < oy + this.height) {
      p.x = ox;
      p.z = oz;
    } else if (this.grounded && fa < Infinity && (p.x !== ox || p.z !== oz)) {
      // ground rising under a floor: stop where the head would push into it
      const ng = world.groundHeight(p.x, p.z, oy, undefined, cap);
      if (ng > oy + 0.02 && fa - FLOOR_UNDER - ng < this.height * 0.8) {
        p.x = ox;
        p.z = oz;
      }
    }

    const wasGrounded = this.grounded;
    const prevVy = v.y;
    p.y += v.y * dt;
    const gy = world.groundHeight(p.x, p.z, Math.max(p.y, p.y - v.y * dt), undefined, cap);
    if (wasGrounded && v.y <= 0 && p.y > gy && p.y - gy < 0.75) p.y = gy; // stick to ramps / steps
    const ceil = world.ceilingAbove(p.x, p.z, Math.min(oy, p.y));
    // head bump whenever we rose (jump, ramp snap, step-up), not only while jumping
    if ((v.y > 0 || p.y > oy) && p.y + this.height > ceil) {
      p.y = Math.max(Math.min(gy, oy), ceil - this.height);
      if (v.y > 0) v.y = 0;
    }
    if (p.y <= gy) {
      p.y = gy;
      if (!wasGrounded) this._land(prevVy, g);
      v.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    }
    this.surface = world.surface;
    // ---- swimming: on the terrain inside a water area (World.inWater)
    const wasSwim = this.swimming;
    this.swimming = !down && this.mode === 'ground' && this.grounded && this.surface === 'ground' && !this.carriedBy && world.inWater(p.x, p.z, p.y);
    if (this.swimming !== wasSwim) {
      if (this.swimming) {
        this._cancelUse();
        this._endEdit(g);
        this.buildPiece = null;
        if (this.emoting && this.character) this.character.emote(false);
        this.emoting = false;
      }
      g.sfx.play('splash', { volume: this.swimming ? 0.8 : 0.4 });
      if (g.fx && g.fx.impact) g.fx.impact(_v.set(p.x, p.y + 0.05, p.z), null, 'water');
    }
    if (down && this.carriedBy && this.carriedBy.alive) {
      placeOnShoulder(this, this.carriedBy);
      this.grounded = true;
    }

    // ---- actions
    if (down) {
      hud.prompt(null);
      if (hud.setRevive) hud.setRevive(null);
    } else if (!this.airborneDrop) this._actions(dt, input, g);
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
      c.root.visible = !this.scopeView; // first person through the scope: don't draw our own body
      c.setDowned(down);
      c.setSwim(this.swimming);
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

    // ---- swim strokes: a splash and a ripple instead of footsteps
    if (this.swimming && hspeed > 1) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = SWIM.strokeT;
        g.sfx.play('splash', { volume: 0.3 });
        if (g.fx && g.fx.ring) g.fx.ring(_v.set(p.x, p.y + 0.04, p.z), { radius: 1.6, duration: 0.7, color: 0xd8f1ff });
      }
    } else if (this.grounded && hspeed > 2 && !this.crouching) {
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

  /**
   * A ledge straight ahead that we can climb: blocked at foot height, a walkable top between
   * MANTLE.min and MANTLE.max above our feet (a little less while already in the air), and
   * head room on top. Returns a mantle plan or null.
   */
  _findLedge(world, sh, ch) {
    const p = this.pos;
    const fx = sh;
    const fz = -ch;
    const reach = this.radius + 0.45;
    const ax = p.x + fx * reach;
    const az = p.z + fz * reach;
    const top = world.groundHeight(ax, az, p.y, MANTLE.max);
    const rise = top - p.y;
    if (!(rise > MANTLE.min && rise <= MANTLE.max)) return null;
    // a floor over our own head is a ceiling, not a ledge in front of us: never climb through it
    // (checked at the body centre and its front edge)
    const ex = p.x + fx * this.radius;
    const ez = p.z + fz * this.radius;
    if (world.builtAbove(p.x, p.z, p.y) <= top + 0.05 || world.builtAbove(ex, ez, p.y) <= top + 0.05) return null;
    if (world.ceilingAbove(p.x, p.z, p.y, 0.05) <= top + 0.05) return null;
    // ...and not with the front of the body under a floor's edge either (e.g. climbing sideways
    // out of a building's stairwell): the rise would carry it up through the slab
    if (world.ceilingAbove(ex, ez, p.y, 0.05) <= top + 0.05) return null;
    if (world.groundHeight(ax, az, p.y) >= top - 0.05) return null; // just a step: walking handles it
    // stand-on spot a bit further in, with room for a whole body above it
    const lx = p.x + fx * (reach + 0.35);
    const lz = p.z + fz * (reach + 0.35);
    const land = world.groundHeight(lx, lz, top + 0.05);
    if (Math.abs(land - top) > 0.4) return null;
    if (world.ceilingAbove(lx, lz, land) - land < this.height * 0.9) return null;
    _mv.set(lx, land + 0.02, lz);
    world.resolveCircle(_mv, this.radius, this.height);
    if (Math.hypot(_mv.x - lx, _mv.z - lz) > 0.25) return null; // a wall above the ledge
    return { t: 0, dur: 0.22 + rise * 0.12, x0: p.x, y0: p.y, z0: p.z, x1: _mv.x, y1: land + 0.05, z1: _mv.z };
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
        this._endEdit(g);
        this.buildPiece = null;
        inv.select(i);
      }
    }
    if (input.wheel && this.editing && g.settings && g.settings.editWheelReset) {
      this._resetEdit(g); // setting: the mouse wheel resets the piece being edited
    } else if (input.wheel) {
      this._endEdit(g);
      this.buildPiece = null;
      inv.next(input.wheel > 0 ? 1 : -1);
    }
    if (input.actionHit('pickaxe')) {
      this._endEdit(g);
      this.buildPiece = null;
      inv.select(-1);
    }
    for (const a in PIECE_ACTIONS) {
      if (input.actionHit(a)) {
        this._endEdit(g);
        this.setBuildPiece(PIECE_ACTIONS[a]);
      }
    }
    if (input.actionHit('cycleMaterial')) this.cycleMaterial();
    if (input.actionHit('emote') && this.character && this.grounded && !this._wheel) {
      this._wheel = { t: 0, x: 0, y: 0, sel: -1, done: false };
      if (g.emoteWheel) g.emoteWheel.show(g.emotes || []);
    }
  }

  /** While the emote key is held: flick the mouse (or press 1-6) to pick; release plays it. */
  _emoteWheel(dt, input, g) {
    const w = this._wheel;
    const n = 6;
    w.t += dt;
    w.x += input.dx;
    w.y += input.dy;
    const r = Math.hypot(w.x, w.y);
    if (r > 30) {
      const ang = Math.atan2(w.x, -w.y);
      w.sel = (((Math.round(ang / (TAU / n)) % n) + n) % n) | 0;
      if (r > 140) {
        w.x *= 140 / r;
        w.y *= 140 / r;
      }
    }
    for (let i = 0; i < n; i++) {
      if (input.actionHit('slot' + (i + 1))) {
        input.consume(input.bindings['slot' + (i + 1)]); // picking an emote, not a weapon
        w.sel = i;
        w.done = true;
      }
    }
    if (g.emoteWheel) g.emoteWheel.select(w.sel);
    if (input.action('emote') && !w.done && this.alive && !this.downed && !this.carrying) return;
    this._wheel = null;
    if (g.emoteWheel) g.emoteWheel.hide();
    if (!this.alive || this.downed || this.carrying || !this.grounded) return;
    const list = g.emotes || [];
    let id = w.sel >= 0 ? list[w.sel] : null;
    if (w.sel < 0 && w.t < 0.3) id = this.emoting ? null : list.find(Boolean) || 'emote_cheer'; // quick tap
    if (w.sel < 0 && w.t < 0.3 && this.emoting) return this.stopEmote(g);
    if (id) this.startEmote(id, g);
  }

  /** Plays emote `id` (a Cosmetics.EMOTES id) and tells the other players. */
  startEmote(id, g) {
    if (!this.character) return;
    this.emoting = true;
    this.emoteId = id;
    this.character.emote(true, id);
    const net = g.net;
    if (net && net.isClient) net.action({ k: 'em', id });
    else if (net && net.isHost && net.started && net.events) net.events.push({ e: 'em', a: this.id, id });
  }

  stopEmote() {
    this.emoting = false;
    if (this.character) this.character.emote(false);
  }

  setBuildPiece(kind) {
    this.buildPiece = BUILD.pieces.includes(kind) ? kind : null;
    this._cancelUse();
    this._cancelReload();
  }

  /**
   * Out of the selected material: switch to the next one you can afford (wood -> brick ->
   * metal order), no keybind needed. Stays put when nothing is affordable.
   */
  _autoMaterial(g) {
    const mats = this.inventory.mats;
    if ((mats[this.buildMat] || 0) >= BUILD.cost) return;
    const i = MATERIALS.indexOf(this.buildMat);
    for (let k = 1; k < MATERIALS.length; k++) {
      const m = MATERIALS[(i + k) % MATERIALS.length];
      if ((mats[m] || 0) >= BUILD.cost) {
        const was = this.buildMat;
        this.buildMat = m;
        if (g && g.hud) g.hud.toast(`Out of ${was}: building with ${m}`, 'pickup');
        return;
      }
    }
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
    if (input.actionHit('reload') && !this.buildPiece && !this.editing) this.startReload(g);

    // ---- consumable channel
    if (this.useT > 0) {
      this.useT -= dt;
      if (this.useT <= 0) this._finishUse(g);
    }

    // ---- carrying a knocked teammate: hands are full; the carry key puts them down
    if (this.carrying) {
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      this._endEdit(g);
      this.buildPiece = null;
      const t = this.carrying;
      if (!t.alive || !t.downed) {
        this.carrying = null;
      } else {
        g.hud.prompt('[' + (input.label ? input.label('carry') : 'H') + '] Put down ' + t.name);
        if (input.actionHit('carry')) this._carry(g, null);
        this.triggerHeld = lmb;
        return;
      }
    }

    // ---- interact (revive a knocked teammate first)
    const rv = this._reviveInput(input, g, dt);
    if (rv === 2) {
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      this.triggerHeld = lmb;
      return;
    }
    // ---- reboot cards / Catfish Ken's reboot vans (team modes)
    const rb = rv === 1 ? 0 : this._rebootInput(input, g, dt);
    if (rb === 2) {
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      this.triggerHeld = lmb;
      return;
    }
    if (rv !== 1 && rb !== 1) this._interact(input, g, dt);

    // ---- edit (T): opens edit mode on your own piece and it stays open; T again confirms.
    // With "Confirm edit on release" on, letting go of the mouse after selecting confirms too.
    if (input.actionHit('edit')) {
      if (this.editing) this._confirmEdit(g);
      else this._startEdit(g);
    }

    if (this.swimming) {
      // in the water: hands are busy swimming (no shots, swings, builds or heals)
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      this.buildPiece = null;
      if (this.editing) this._endEdit(g);
    } else if (this.editing) {
      if (g.structures) g.structures.setGhost(null);
      this.placement = null;
      this._editMode(input, lmb, lmbClick, g);
    } else if (this.buildPiece) {
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
    const dz = this.dropZone;
    if (dz && (this.pos.x - dz.x) ** 2 + (this.pos.z - dz.z) ** 2 > 5 * 5) this.dropZone = null;
    for (const rec of recs) {
      if (this.dropZone && (rec.position.x - dz.x) ** 2 + (rec.position.z - dz.z) ** 2 < 4 * 4) continue; // just dropped it

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

  /** Nearest knocked teammate within revive range, or null. */
  _reviveCandidate(g) {
    if (!g.teamMode || !g.combat) return null;
    let best = null;
    let bd = KNOCK.reviveRange * KNOCK.reviveRange;
    for (const a of g.combat.actors) {
      if (!a.alive || !a.downed || !sameTeam(a, this) || a.carriedBy) continue;
      if (a.reviver && a.reviver !== this) continue; // someone else is on it
      const dx = a.pos.x - this.pos.x;
      const dz = a.pos.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bd && Math.abs(a.pos.y - this.pos.y) < 2.5) {
        bd = d2;
        best = a;
      }
    }
    return best;
  }

  /**
   * Hold interact next to a knocked teammate for KNOCK.reviveTime. Letting go, moving or
   * taking damage cancels. Solo / host: Combat.tickTeams runs the authoritative timer from
   * revivingTarget; a client sends 'rv' start / stop and the host validates it.
   * Returns 2 while reviving (no other action this frame), 1 when it shows the revive prompt
   * (no loot / door prompt), else 0.
   */
  _reviveInput(input, g, dt) {
    const hud = g.hud;
    if (!g.teamMode) return 0;
    let t = this.revivingTarget;
    if (t) {
      const moving = input.action('moveForward') || input.action('moveBack') || input.action('moveLeft') || input.action('moveRight') || input.actionHit('jump');
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      if (!input.action('interact') || moving || !t.alive || !t.downed || dx * dx + dz * dz > (KNOCK.reviveRange + 0.4) ** 2) {
        this._stopRevive(g);
        t = null;
      }
    }
    const cand = t ? null : this._reviveCandidate(g);
    if (!t && cand && input.actionHit('interact')) {
      t = this.revivingTarget = cand;
      this.reviveLocalT = 0;
      this._cancelReload();
      this._cancelUse();
      this._endEdit(g);
      const net = clientNet(g);
      if (net) net.action({ k: 'rv', id: cand.id });
    }
    if (t) {
      this.reviveLocalT += dt;
      hud.prompt(null);
      if (hud.setRevive) hud.setRevive({ pct: Math.min(1, this.reviveLocalT / KNOCK.reviveTime), name: t.name });
      return 2;
    }
    if (hud.setRevive) hud.setRevive(null);
    if (cand) {
      hud.prompt('[' + (input.label ? input.label('interact') : 'E') + '] Hold to revive  ·  [' + (input.label ? input.label('carry') : 'H') + '] Carry ' + cand.name);
      if (input.actionHit('carry')) this._carry(g, cand);
      return 1;
    }
    return 0;
  }

  /**
   * Reboot cards and vans. Interact next to a teammate's card picks it up; holding interact at
   * a ready van while carrying cards reboots them (REBOOT.time). Solo / host: Reboot._tick
   * runs the authoritative timer from this.rebootVan; a client sends 'rc' / 'rb' to the host.
   * Returns 2 while holding at the van, 1 when it shows a card / van prompt, else 0.
   */
  _rebootInput(input, g, dt) {
    const rb = g.reboot;
    const hud = g.hud;
    if (!g.teamMode || !rb || this.airborneDrop || this.carrying || this.mode !== 'ground') {
      if (this.rebootVan) this._stopReboot(g);
      return 0;
    }
    const key = input.label ? input.label('interact') : 'E';
    const net = clientNet(g);
    const mine = rb.cardsOf(this);
    const names = mine.map((c) => c.name).join(', ');
    let v = this.rebootVan;
    if (v) {
      const moving = input.action('moveForward') || input.action('moveBack') || input.action('moveLeft') || input.action('moveRight') || input.actionHit('jump');
      if (!input.action('interact') || moving || !rb.vanReady(v) || rb.vanNear(this, 0.5) !== v || !mine.length) {
        this._stopReboot(g);
        v = null;
      }
    }
    if (v) {
      this.rebootLocalT += dt;
      hud.prompt(null);
      if (hud.setRevive) hud.setRevive({ pct: Math.min(1, this.rebootLocalT / REBOOT.time), name: names, verb: 'REBOOTING' });
      return 2;
    }
    const card = rb.cardNear(this);
    if (card) {
      hud.prompt('[' + key + '] Pick up ' + card.name + "'s reboot card");
      if (input.actionHit('interact')) {
        if (net) net.action({ k: 'rc', v: card.v });
        else if (rb.take(this, card)) hud.toast(card.name + "'s reboot card: take it to a reboot van", 'pickup');
      }
      return 1;
    }
    const van = rb.vanNear(this);
    if (!van) return 0;
    const meId = this.id;
    const busy = van.user != null && van.user !== this && van.user !== meId;
    if (!rb.vanReady(van)) hud.prompt("Catfish Ken's reboot van: recharging " + Math.ceil(rb.vanCooldown(van)) + 's');
    else if (!mine.length) hud.prompt("Catfish Ken's reboot van: bring a teammate's reboot card");
    else if (busy) hud.prompt('Reboot van in use');
    else {
      hud.prompt('[' + key + '] Hold to reboot ' + names);
      if (input.actionHit('interact')) {
        this.rebootVan = van;
        this.rebootLocalT = 0;
        this._cancelReload();
        this._cancelUse();
        this._endEdit(g);
        if (net) net.action({ k: 'rb', i: van.i });
      }
    }
    return 1;
  }

  _stopReboot(g) {
    if (!this.rebootVan) return;
    const net = clientNet(g);
    if (net) net.action({ k: 'rb', i: -1 });
    this.rebootVan = null;
    this.rebootLocalT = 0;
  }

  /** Picks up a knocked teammate (target) or puts down the one we hold (null). */
  _carry(g, target) {
    const net = clientNet(g);
    if (net) {
      net.action({ k: 'cy', id: target ? target.id : -1 });
      return;
    }
    if (!g.combat) return;
    if (target) {
      this._cancelReload();
      this._cancelUse();
      if (this.emoting && this.character) this.character.emote(false);
      this.emoting = false;
      g.combat.startCarry(this, target);
    } else g.combat.stopCarry(this);
  }

  _stopRevive(g) {
    if (!this.revivingTarget) return;
    const net = clientNet(g);
    if (net) net.action({ k: 'rv', id: -1 });
    if (g.combat && g.combat.stopRevive) g.combat.stopRevive(this);
    this.revivingTarget = null;
    this.reviveLocalT = 0;
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
      return;
    }
    // doors cut into built walls: anyone can open / close them, swinging away from them
    const st = g.structures;
    const door = st && st.doorNear && !this.airborneDrop ? st.doorNear(this.pos) : null;
    if (door) {
      g.hud.prompt('[' + (input.label ? input.label('interact') : 'E') + '] ' + (door.open ? 'Close' : 'Open') + ' door');
      if (input.actionHit('interact')) {
        const net = clientNet(g);
        if (net) net.action({ k: 'dr', key: door.piece.key, c: door.c, s: door.sign });
        else st.toggleDoor(door.piece, door.c, door.sign);
      }
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
    // shell-by-shell guns (shotguns) load one shell per `reload` seconds and keep going
    const n = w.shellReload ? 1 : w.mag - it.mag;
    const got = this.inventory.takeAmmo(w.ammo, n);
    it.mag += got;
    const net = clientNet(this._g);
    if (net) net.action(w.shellReload ? { k: 'rl', s: this.inventory.slots.indexOf(it), n: 1 } : { k: 'rl', s: this.inventory.slots.indexOf(it) }, true);
    if (w.shellReload && got > 0 && it.mag < w.mag && (this.inventory.ammo[w.ammo] || 0) > 0 && this.inventory.current() === it) {
      const per = weaponStats(it.id, it.rarity).reload;
      this.reloadItem = it;
      this.reloadT = this.reloadTotal = per;
      if (this.character) this.character.reload(per);
    }
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
    const w = WEAPONS[it.id];
    // shotguns: pulling the trigger with shells loaded stops the shell-by-shell reload
    if (this.reloadT > 0 && w.shellReload && it.mag > 0 && this.reloadItem === it) this._cancelReload();
    if (this.reloadT > 0) return false;
    this._cancelUse();
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
    this._autoMaterial(g);
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
    this._autoMaterial(g);
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
      // show it now instead of after the round trip; the host's echo confirms it, or it is
      // taken back (ClientSession.predictBuild)
      if (net.predictBuild) {
        const local = st.place(pl, this.buildMat, this);
        if (local) net.predictBuild(local);
      }
      return pl;
    }
    const piece = st.place(pl, this.buildMat, this);
    if (piece) this.inventory.spendMats(this.buildMat, BUILD.cost);
    return piece;
  }

  // --- editing

  /** Start editing the piece under the crosshair, if it is yours and in reach. */
  _startEdit(g) {
    const st = g.structures;
    if (!st || !st.pickPiece || this.airborneDrop || this.mode !== 'ground') return false;
    const hit = st.pickPiece(this.aimOrigin, this.aimDir, EDIT_REACH);
    if (!hit || hit.piece.owner !== this) {
      g.sfx.play('build_denied', { volume: 0.5 });
      return false;
    }
    const piece = hit.piece;
    this.editing = { piece, mask: st.editValue(piece), hover: -1, drag: null, from: -1 };
    this._cancelUse();
    this._cancelReload();
    return true;
  }

  /**
   * Per frame while editing (Fortnite rules): the first tile clicked decides whether a drag
   * selects or deselects, and every tile the crosshair crosses while the button is held gets
   * the same. Selected tiles are cut on confirm. Ramps: drag from one tile to its neighbour
   * and the ramp rises that way. Reset (right mouse, or the wheel when that setting is on)
   * restores the piece at once and leaves edit mode.
   */
  _editMode(input, lmb, lmbClick, g) {
    const e = this.editing;
    const st = g.structures;
    const p = e.piece;
    if (!st || !p.alive || Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > EDIT_REACH + 4 || Math.abs(p.y - this.pos.y) > 8) {
      this._endEdit(g);
      return;
    }
    if (input.actionHit('aim')) {
      this._resetEdit(g);
      return;
    }
    e.hover = st.aimTile(p, this.aimOrigin, this.aimDir);
    if (lmbClick && e.hover >= 0) e.selecting = true;
    if (p.kind === 'ramp') {
      if (lmbClick && e.hover >= 0) e.from = e.hover;
      if (lmb && e.from >= 0 && e.hover >= 0 && e.hover !== e.from) {
        const q = rampDragQuarter(p.rot, e.from, e.hover);
        if (q >= 0) e.mask = q;
      }
      if (!lmb) e.from = -1;
    } else {
      const all = (1 << st.tileCount(p.kind)) - 1;
      if (lmbClick && e.hover >= 0) e.drag = e.mask & (1 << e.hover) ? 'deselect' : 'select';
      if (lmb && e.drag && e.hover >= 0) {
        const bit = 1 << e.hover;
        const next = e.drag === 'select' ? e.mask | bit : e.mask & ~bit;
        if (next !== all) e.mask = next; // a piece keeps at least one tile
      }
      if (!lmb) e.drag = null;
    }
    // confirm edit on release (setting): the mouse came up after selecting
    if (!lmb && e.selecting) {
      e.selecting = false;
      if (g.settings && g.settings.editOnRelease && e.mask !== st.editValue(p)) {
        if (validEdit(p.kind, e.mask)) {
          this._confirmEdit(g);
          return;
        }
        g.sfx.play('build_denied', { volume: 0.5 }); // not a shape: keep editing
      }
    }
    st.setEditGhost(p, e.mask, e.hover);
  }

  /** Apply the pending edit (the host does it for a multiplayer client) and leave edit mode. */
  _confirmEdit(g, mask) {
    const e = this.editing;
    const st = g.structures;
    // applied exactly as selected; a selection that is not a valid shape does nothing
    const m = mask != null ? mask : e && e.mask;
    if (e && st && e.piece.alive && m !== st.editValue(e.piece) && !validEdit(e.piece.kind, m)) {
      g.sfx.play('build_denied', { volume: 0.5 });
    } else if (e && st && e.piece.alive && m !== st.editValue(e.piece)) {
      const net = clientNet(g);
      if (net) net.action({ k: 'e', key: e.piece.key, ed: m });
      else st.edit(e.piece, m);
    }
    this._endEdit(g);
  }

  /** Reset: the piece goes back to how it was placed, right away, and edit mode ends. */
  _resetEdit(g) {
    const e = this.editing;
    if (!e || !g.structures) return;
    this._confirmEdit(g, g.structures.resetValue(e.piece));
  }

  _endEdit(g) {
    if (!this.editing) return;
    this.editing = null;
    if (g && g.structures) g.structures.setEditGhost(null);
  }

  // ------------------------------------------------------------- camera

  updateCamera(camera, dt, world, baseFov = CAMERA.fov) {
    const it = this._gun();
    const w = it ? WEAPONS[it.id] : null;
    const scoped = this.scopeView && !!w;
    // a scoped gun only eases part-way in over the shoulder, then snaps to full zoom in the scope
    const zoom = !this.ads || !w ? 1 : w.scope && !scoped ? 0.8 : w.zoom;
    const want = this.airborneDrop ? 8.5 : this.ads ? CAMERA.distance * 0.55 : CAMERA.distance;
    this.camDist = scoped ? 1.2 : damp(this.camDist, want, 10, dt);
    this.fovMul = scoped ? zoom : damp(this.fovMul, zoom, 14, dt);
    const fov = baseFov * this.fovMul;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const crouchDrop = this.crouching ? 0.45 : 0;
    _pivot.set(this.pos.x, this.pos.y + CAMERA.pivotHeight - crouchDrop, this.pos.z);
    if (scoped) {
      // first person: the eye sits at the pivot and looks straight down the aim direction
      const cp = Math.cos(this.pitch);
      _fwd.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), -Math.cos(this.heading) * cp);
      camera.position.copy(_pivot);
      camera.lookAt(_v.copy(_pivot).add(_fwd));
    } else placeOrbitCamera(camera, world, _pivot, this.heading, this.pitch, this.camDist, this.airborneDrop ? 0 : CAMERA.shoulder);

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
