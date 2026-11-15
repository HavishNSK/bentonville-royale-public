// BENTONVILLE ROYALE — computer-controlled players.
//
//   const bots = new Bots({ scene, world, kits, weaponModels, loot, structures, combat, fx, sfx });
//   bots.spawn(31, rng, { names: BOT_NAMES, difficulty: 'normal', dropPoints })
//   bots.update(dt, { player, storm, time })      // every frame
//   bots.list                                      // Actor[] (alive and dead)
//   bots.clear()
//
// Extras (not in CONTRACTS.md, optional for callers)
//   bots.notifyDamage(victim, amount, info)        // call from combat.onDamage: the bot turns on its attacker
//   bots.setQuality('low'|'medium'|'high')         // character draw / animation distance (QUALITY[q].charDist)
//   bots.alive                                     // number of bots still alive
//   bots.dropLootOnDeath = true                    // bots spill their inventory via loot.drop when they die
//   actor.botState    'drop'|'loot'|'rotate'|'engage'|'retreat'|'heal'|'harvest'|'wander'|'dead'
//   actor.gliding, actor.grounded, actor.isBot, actor.damageScale (= DIFFICULTY[d].damageScale; Combat applies it)
//
// spawn() options beyond the contract: dropPoints may be {x,z[,r]} points (bot i lands
// near dropPoints[i % n]) or landmark keys; idBase (first actor id, default 1);
// loadout (passed to Inventory.reset); quality. Bots start gliding from
// PLAYER.dropHeight (+0..30 m, 30-120 m from their landing spot) at spawn time.
//
// Behaviour: glide in -> loot (Loot.near/open/take) -> wander / rotate toward the next
// storm circle (hurry when outside) -> engage targets seen via world.clearLine within
// DIFFICULTY.sight (reaction delay, per-burst aim drift, bursts, strafing, weapon by
// distance vs botRange, reloads, occasional wall / ramp) -> retreat and heal when hurt.
// Bots fight each other and the player alike. Unarmed bots only brawl at arm's length.
// Stuck bots jump, flip their wall-following side, then get an A* detour from a shared,
// time-sliced grid planner (PLAN_BUDGET expansions per frame).
// Every collaborator except `world` may be null; the matching behaviour is skipped.
// With an empty `kits` array bots have no Character (headless, used by tests).
//
// Each bot thinks (perception, state choice, steering) at ~4-8 Hz on a staggered
// timer; movement, aiming, firing cadence, reloads and heals run every frame
// without allocating. Characters beyond QUALITY[q].charDist are hidden and not
// animated; past half that distance they animate at half rate.

import * as THREE from 'three';
import { Character } from './Character.js';
import { Inventory } from './Inventory.js';
import {
  PLAYER, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, RARITIES, DIFFICULTY, QUALITY,
  BOT_NAMES, DROP_ZONES, angleDelta, clamp,
} from '../core/config.js';

const EYE = PLAYER.eyeHeight;
const CHEST = 1.2;
const TURN_RATE = 7; // rad/s
const FOV_COS = Math.cos(1.25); // ~72 degrees either side
const INTERACT = 2.0; // metres to open / take loot
const LOOT_SCAN = 45; // metres
const MEMORY = 4; // seconds a lost target is chased
const STUCK_WINDOW = 1.4;
const PLAN_BUDGET = 350; // A* expansions per frame (~0.3-0.6 ms)
const CANOPY_COLORS = [0x4fc3f7, 0xff7a45, 0x9ccc65, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0xa1887f];
const AVOID = [0, 0.55, -0.55, 1.1, -1.1, 1.65, -1.65, 2.3, -2.3, 3.0];
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));

const _v = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = { x: 0, z: 0 };
const _anim = { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: 0, pitch: 0 };
const _cand = [null, null, null, null];
const _candD = [0, 0, 0, 0];
const _matItem = { type: 'material', mat: 'wood', count: 0 };

export class Bots {
  constructor({ scene, world, kits, weaponModels, loot, structures, combat, fx, sfx } = {}) {
    this.scene = scene || null;
    this.world = world;
    this.kits = kits || [];
    this.weaponModels = {};
    for (const k in weaponModels || {}) {
      const m = weaponModels[k];
      this.weaponModels[k] = m && m.scene ? m.scene : m;
    }
    this.loot = loot || null;
    this.structures = structures || null;
    this.combat = combat || null;
    this.fx = fx || null;
    this.sfx = sfx || null;
    this.actors = [];
    this.brains = [];
    this.dropLootOnDeath = true;
    this.charDist = QUALITY.medium.charDist;
    this.time = 0;
    this.rng = Math.random;
    this.diff = DIFFICULTY.normal;
    this._all = [];
    this.planner = new Planner(world);
  }

  get list() {
    return this.actors;
  }

  get alive() {
    let n = 0;
    for (const a of this.actors) if (a.alive) n++;
    return n;
  }

  setQuality(q) {
    this.charDist = (QUALITY[q] || QUALITY.medium).charDist;
  }

  // ------------------------------------------------------------------ spawn

  /**
   * opts.names: string[]; opts.difficulty: 'easy'|'normal'|'hard';
   * opts.dropPoints: [{x,z}] | landmark keys; opts.idBase (first id, default 1);
   * opts.loadout: Inventory.reset() loadout every bot starts with (default empty);
   * opts.quality.
   */
  spawn(count, rng = Math.random, opts = {}) {
    this.clear();
    const world = this.world;
    this.rng = rng;
    this.diffName = DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
    this.diff = DIFFICULTY[this.diffName];
    if (opts.quality) this.setQuality(opts.quality);
    const names = shuffled(opts.names || BOT_NAMES, rng);
    const points = this._dropTargets(count, rng, opts.dropPoints);
    const idBase = opts.idBase ?? 1;
    this.time = 0;
    // opts.launchWindow (s): bots wait in the "bus" and jump one by one, staggered
    // evenly (in random order) across the window that starts now. 0 = all at once.
    const win = Math.max(0, opts.launchWindow || 0);
    const order = shuffled(Array.from({ length: count }, (_, k) => k), rng);

    for (let i = 0; i < count; i++) {
      const t = points[i];
      // start in the sky, up to ~120 m from the target, with staggered heights
      const a = rng() * Math.PI * 2;
      const off = 30 + rng() * 90;
      const sx = clamp(t.x + Math.cos(a) * off, world.bounds.minX + 5, world.bounds.maxX - 5);
      const sz = clamp(t.z + Math.sin(a) * off, world.bounds.minZ + 5, world.bounds.maxZ - 5);
      const actor = {
        id: idBase + i,
        name: names[i % names.length] + (i >= names.length ? ' ' + (1 + Math.floor(i / names.length)) : ''),
        isPlayer: false,
        isBot: true,
        team: idBase + i,
        pos: new THREE.Vector3(sx, PLAYER.dropHeight + rng() * 30, sz),
        vel: new THREE.Vector3(),
        heading: Math.atan2(t.x - sx, -(t.z - sz)),
        pitch: 0,
        radius: PLAYER.radius,
        height: PLAYER.height,
        health: PLAYER.maxHealth,
        shield: 0,
        alive: true,
        kills: 0,
        inventory: new Inventory(opts.loadout),
        character: null,
        gliding: true,
        grounded: false,
        damageScale: this.diff.damageScale,
        botState: 'drop',
      };
      if (this.kits.length) {
        const kit = this.kits[i % this.kits.length];
        const ch = new Character(kit, { weapons: this.weaponModels, canopyColor: CANOPY_COLORS[i % CANOPY_COLORS.length] });
        ch.root.position.copy(actor.pos);
        ch.root.visible = false;
        actor.character = ch;
        if (this.scene) this.scene.add(ch.root);
      }
      const b = newBrain(actor, t, rng);
      b.launchAt = win > 0 ? (win * (order[i] + 0.15 + rng() * 0.7)) / count : 0;
      actor.inBus = b.launchAt > 0;
      actor._bot = b;
      this.actors.push(actor);
      this.brains.push(b);
      if (this.combat) this.combat.register(actor);
    }
    return this.actors;
  }

  _dropTargets(count, rng, dropPoints) {
    const world = this.world;
    const lm = world.landmarks || {};
    const anchors = [];
    if (dropPoints && dropPoints.length) {
      for (const p of dropPoints) {
        if (typeof p === 'string') {
          if (lm[p]) anchors.push({ x: lm[p].x, z: lm[p].z, r: Math.min(lm[p].r || 40, 120) + 40 });
        } else if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) anchors.push({ x: p.x, z: p.z, r: p.r ?? 12 });
      }
    }
    if (!anchors.length) {
      for (const z of DROP_ZONES) {
        const l = lm[z.key];
        if (l && Math.hypot(l.x, l.z) < 520) anchors.push({ x: l.x, z: l.z, r: Math.min(l.r || 40, 120) + 50 });
      }
      if (!anchors.length) anchors.push({ x: 0, z: 0, r: 300 });
    }
    const out = [];
    const given = anchors.length && dropPoints && dropPoints.length;
    for (let i = 0; i < count; i++) {
      let cx;
      let cz;
      let r;
      if (given || rng() < 0.4) {
        // caller's points: one per bot in order (cycled); default: a random landmark
        const a = given ? anchors[i % anchors.length] : anchors[Math.floor(rng() * anchors.length)];
        cx = a.x;
        cz = a.z;
        r = a.r;
      } else {
        // anywhere within ~550 m of downtown (the storm's first circle is around there)
        cx = 0;
        cz = 0;
        r = 550;
      }
      out.push(world.randomOpenPoint(rng, cx, cz, r, 1.2, { x: 0, z: 0 }));
    }
    return out;
  }

  clear() {
    this.planner.cancelAll();
    for (const a of this.actors) {
      if (this.combat) this.combat.unregister(a);
      if (a.character) a.character.dispose();
      a._bot = null;
    }
    this.actors.length = 0;
    this.brains.length = 0;
  }

  // ------------------------------------------------------------- awareness

  /** Hook for combat.onDamage: lets a bot react to who hurt it. */
  notifyDamage(victim, amount, info) {
    const b = victim && victim._bot;
    if (!b || !victim.alive) return;
    const src = info && info.source;
    b.alertUntil = this.time + 5;
    if (src && src !== victim && src.alive && src.pos) {
      b.threat = src;
      b.thinkIn = Math.min(b.thinkIn, 0.05);
    }
  }

  // ----------------------------------------------------------------- update

  update(dt, ctx = {}) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const player = ctx.player || null;
    const storm = ctx.storm || null;
    const viewer = ctx.viewer || (player && player.pos) || null;
    this._player = player;
    this._storm = storm;

    // everyone a bot can fight
    const all = this._all;
    all.length = 0;
    const reg = this.combat && this.combat.actors;
    if (reg && reg.length) for (let i = 0; i < reg.length; i++) all.push(reg[i]);
    else {
      for (let i = 0; i < this.actors.length; i++) all.push(this.actors[i]);
      if (player) all.push(player);
    }

    // time-sliced path planning for stuck bots
    const done = this.planner.step(PLAN_BUDGET);
    if (done && done.actor.alive && done.planN > 0) {
      done.pathN = done.planN;
      done.pathI = 0;
      done.pathGoalX = done.planGX;
      done.pathGoalZ = done.planGZ;
      done.pathUntil = this.time + 25;
      done.stuck = 0;
      done.paths++;
    }

    const cd2 = this.charDist * this.charDist;
    for (let i = 0; i < this.brains.length; i++) {
      const b = this.brains[i];
      const a = b.actor;
      if (!a.alive) {
        if (b.state !== 'dead') this._die(b);
        b.deadTime += dt;
        this._present(b, dt, viewer, cd2);
        continue;
      }
      // still in the bus: not launched yet (hidden, frozen, not a target)
      if (a.inBus) {
        if (this.time < b.launchAt) {
          if (a.character) a.character.root.visible = false;
          continue;
        }
        a.inBus = false;
      }
      // damage detection without a hook
      const hp = a.health + a.shield;
      if (hp < b.lastHp - 0.01) {
        b.alertUntil = this.time + 4;
        b.hurtAt = this.time;
      }
      b.lastHp = hp;

      b.thinkIn -= dt;
      if (b.thinkIn <= 0) {
        this._think(b, all);
        const busy = b.state === 'engage' || b.state === 'drop';
        b.thinkIn += (busy ? 0.125 : 0.2) + this.rng() * 0.06;
        if (b.thinkIn < 0) b.thinkIn = 0.05;
      }
      this._act(b, dt);
      this._move(b, dt);
      this._present(b, dt, viewer, cd2);
    }
  }

  // -------------------------------------------------------------- thinking

  _think(b, all) {
    const a = b.actor;
    const t = this.time;
    if (b.state === 'drop') {
      // steering while gliding is per-frame; just make sure the landing spot is inside the storm
      const storm = this._storm;
      if (storm && !b.dropChecked && storm.r > 0) {
        b.dropChecked = true;
        const dx = b.dropX - storm.cx;
        const dz = b.dropZ - storm.cz;
        if (dx * dx + dz * dz > storm.r * storm.r * 0.8) {
          world_pointIn(this.world, this.rng, storm.nextCx, storm.nextCz, storm.nextR * 0.8, _pt);
          b.dropX = _pt.x;
          b.dropZ = _pt.z;
        }
      }
      return;
    }
    const storm = this._storm;
    const inv = a.inventory;

    this._perceive(b, all);

    const outside = storm ? storm.isOutside(a.pos.x, a.pos.z) : false;
    const target = b.target;
    const dist = target ? Math.hypot(target.pos.x - a.pos.x, target.pos.z - a.pos.z) : Infinity;
    const armed = this._hasGun(inv);

    // storm circle changed -> new rotation goal
    if (storm && (storm.nextCx !== b.stormCx || storm.nextCz !== b.stormCz || storm.nextR !== b.stormR)) {
      b.stormCx = storm.nextCx;
      b.stormCz = storm.nextCz;
      b.stormR = storm.nextR;
      b.rotGoal = false;
    }

    let state;
    // will this bot take the fight? armed: within its personal aggression range, or always when
    // shot at; unarmed: only a brawl at arm's length
    const provoked = t - b.hurtAt < 6;
    let fight = false;
    if (target) {
      if (armed) fight = provoked || b.state === 'engage' || dist < 20 + b.aggression * (this.diff.sight - 20) * 0.55;
      else fight = dist < 6 && (provoked || !this._hasGun(target.inventory));
      if (outside && storm.distanceOutside(a.pos.x, a.pos.z) > 25 && dist > 15) fight = false;
      // badly hurt with heals in the bag: break off and patch up (cautious bots more often)
      if (fight && dist > 8 && a.health + a.shield < 45 && t > b.retreatUntil + 6 && this.rng() < 0.35 + b.caution * 0.5 &&
          (findConsumable(inv, 'medkit') >= 0 || findConsumable(inv, 'tonic') >= 0)) {
        b.retreatUntil = t + 3 + this.rng() * 2;
      }
      if (t < b.retreatUntil) fight = false;
      if (!fight && !b.targetVisible) b.target = null;
    }
    if (fight) state = 'engage';
    else if (outside) state = 'rotate';
    else if (t < b.retreatUntil && target) state = 'retreat';
    else if (b.healing > 0 || this._wantHeal(b)) state = 'heal';
    else if (this._needRotate(b, storm)) state = 'rotate';
    else if (b.harvest && b.harvest.alive && t < b.harvestUntil && !target) state = 'harvest';
    else if (this._pickLoot(b)) state = 'loot';
    else if (this._pickHarvest(b)) state = 'harvest';
    else state = 'wander';

    if (state !== 'heal' && b.healing > 0) this._cancelHeal(b);
    if (state !== b.state) {
      b.state = state;
      b.stateTime = 0;
      if (state === 'engage') this._startEngage(b);
    }
    a.botState = state;

    // goal + speed
    let gx = a.pos.x;
    let gz = a.pos.z;
    let speed = PLAYER.runSpeed;
    let stop = 0.8;
    switch (state) {
      case 'engage': {
        this._chooseWeapon(b, dist);
        const lx = b.targetVisible ? target.pos.x : b.lastSeenX;
        const lz = b.targetVisible ? target.pos.z : b.lastSeenZ;
        const cur = inv.current();
        const pref = cur && cur.type === 'weapon' ? clamp(WEAPONS[cur.id].botRange * 0.6, 5, 60) : 1.4;
        const dx = lx - a.pos.x;
        const dz = lz - a.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        const fx = dx / d;
        const fz = dz / d;
        // strafe side flips every so often
        if (t > b.strafeUntil) {
          b.strafe = this.rng() < 0.5 ? -1 : 1;
          if (this.rng() < 0.2) b.strafe = 0;
          b.strafeUntil = t + 0.6 + this.rng() * 1.1;
          if (this.rng() < 0.12 && a.grounded) b.wantJump = true;
        }
        let fw = 0;
        if (!b.targetVisible) fw = 1;
        else if (d > pref * 1.35) fw = 1;
        else if (d < pref * 0.55) fw = -0.8;
        const s = b.targetVisible ? b.strafe : 0;
        gx = a.pos.x + (fx * fw - fz * s) * 6;
        gz = a.pos.z + (fz * fw + fx * s) * 6;
        stop = 0.2;
        speed = b.targetVisible ? PLAYER.runSpeed : PLAYER.sprintSpeed;
        if (!b.targetVisible && d < 1.5) b.target = null; // reached last seen spot
        this._maybeBuild(b, fx, fz, d);
        break;
      }
      case 'retreat': {
        const dx = a.pos.x - b.lastSeenX;
        const dz = a.pos.z - b.lastSeenZ;
        const d = Math.hypot(dx, dz) || 1;
        gx = a.pos.x + (dx / d) * 10;
        gz = a.pos.z + (dz / d) * 10;
        speed = PLAYER.sprintSpeed;
        b.target = null;
        b.targetVisible = false;
        b.lastSeen = t;
        break;
      }
      case 'rotate': {
        if (!b.rotGoal && storm) {
          world_pointIn(this.world, this.rng, storm.nextCx, storm.nextCz, Math.max(4, storm.nextR * 0.55), _pt);
          b.goalX = _pt.x;
          b.goalZ = _pt.z;
          b.rotGoal = true;
        }
        gx = b.goalX;
        gz = b.goalZ;
        speed = outside || (storm && storm.mode !== 'waiting') ? PLAYER.sprintSpeed : PLAYER.runSpeed;
        stop = 3;
        break;
      }
      case 'heal': {
        if (b.healing <= 0) this._startHeal(b);
        speed = 0;
        break;
      }
      case 'loot': {
        gx = b.lootX;
        gz = b.lootZ;
        stop = 0.3;
        const d = Math.hypot(gx - a.pos.x, gz - a.pos.z);
        if (d < INTERACT) this._interact(b);
        break;
      }
      case 'harvest': {
        const h = b.harvest;
        const dx = h.x - a.pos.x;
        const dz = h.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        gx = h.x;
        gz = h.z;
        stop = h.r + 1.4;
        b.faceX = h.x;
        b.faceZ = h.z;
        b.harvestReach = d < h.r + PICKAXE.range - 0.6;
        if (inv.selected !== -1) this._equip(b, -1);
        break;
      }
      default: {
        // wander toward somewhere inside the next safe circle (or around here)
        if (!b.wanderGoal || Math.hypot(b.goalX - a.pos.x, b.goalZ - a.pos.z) < 4 || t > b.wanderUntil) {
          if (storm) world_pointIn(this.world, this.rng, storm.nextCx, storm.nextCz, Math.max(4, storm.nextR * 0.75), _pt);
          else world_pointIn(this.world, this.rng, a.pos.x, a.pos.z, 120, _pt);
          // do not wander across the whole map: cap the leg to ~150 m
          const dx = _pt.x - a.pos.x;
          const dz = _pt.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 150) {
            b.goalX = a.pos.x + (dx / d) * 150;
            b.goalZ = a.pos.z + (dz / d) * 150;
          } else {
            b.goalX = _pt.x;
            b.goalZ = _pt.z;
          }
          b.wanderGoal = true;
          b.wanderUntil = t + 25;
        }
        gx = b.goalX;
        gz = b.goalZ;
        speed = PLAYER.runSpeed;
        stop = 2;
        // opportunistic reload while nothing is around
        const cur = inv.current();
        if (cur && cur.type === 'weapon' && cur.mag < WEAPONS[cur.id].mag && b.reloading <= 0) this._startReload(b, cur);
      }
    }
    if (state !== 'wander') b.wanderGoal = false;
    b.navX = gx;
    b.navZ = gz;
    // follow a planned detour (set up when the bot got stuck) while it still leads to this goal
    if (b.pathN > 0 && state !== 'engage' && state !== 'heal') {
      if (t > b.pathUntil || Math.hypot(gx - b.pathGoalX, gz - b.pathGoalZ) > 12) b.pathN = 0;
      else {
        while (b.pathI < b.pathN - 1 && Math.hypot(b.path[b.pathI * 2] - a.pos.x, b.path[b.pathI * 2 + 1] - a.pos.z) < 1.8) b.pathI++;
        const wx = b.path[b.pathI * 2];
        const wz = b.path[b.pathI * 2 + 1];
        if (b.pathI >= b.pathN - 1 && Math.hypot(wx - a.pos.x, wz - a.pos.z) < 1.8) b.pathN = 0;
        else {
          gx = wx;
          gz = wz;
          stop = 0;
        }
      }
    }
    this._steer(b, gx, gz, speed, stop);
    this._stuckCheck(b);
  }

  _perceive(b, all) {
    const a = b.actor;
    const world = this.world;
    const t = this.time;
    const sight = this.diff.sight;
    const s2 = sight * sight;
    const alert = t < b.alertUntil;
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    const ex = a.pos.x;
    const ey = a.pos.y + EYE;
    const ez = a.pos.z;

    // keep the current target while it is visible
    let tgt = b.target;
    if (tgt && (!tgt.alive || tgt.pos.y - a.pos.y > 40)) tgt = b.target = null;
    if (tgt) {
      const d2 = dist2(a.pos, tgt.pos);
      if (d2 < s2 * 1.3 && world.clearLine(ex, ey, ez, tgt.pos.x, tgt.pos.y + CHEST, tgt.pos.z)) {
        this._see(b, tgt);
        return;
      }
      b.targetVisible = false;
      if (t - b.lastSeen > MEMORY) tgt = b.target = null;
    }

    // a known attacker is checked first, in any direction
    const th = b.threat;
    if (th && th.alive && dist2(a.pos, th.pos) < s2 * 1.5 && world.clearLine(ex, ey, ez, th.pos.x, th.pos.y + CHEST, th.pos.z)) {
      b.threat = null;
      this._see(b, th);
      return;
    }
    if (th && !th.alive) b.threat = null;

    // nearest few candidates in view, then line-of-sight tests nearest first
    let n = 0;
    for (let i = 0; i < 4; i++) {
      _cand[i] = null;
      _candD[i] = Infinity;
    }
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o === a || !o.alive || o.team === a.team || inAir(o)) continue;
      const dx = o.pos.x - ex;
      const dz = o.pos.z - ez;
      const d2 = dx * dx + dz * dz;
      if (d2 > s2 || Math.abs(o.pos.y - a.pos.y) > 45) continue;
      if (!alert && d2 > 144) {
        const d = Math.sqrt(d2);
        if ((dx * fx + dz * fz) / d < FOV_COS) continue;
      }
      // insertion into the 4-slot list
      let k = 3;
      if (d2 >= _candD[3]) continue;
      while (k > 0 && _candD[k - 1] > d2) {
        _cand[k] = _cand[k - 1];
        _candD[k] = _candD[k - 1];
        k--;
      }
      _cand[k] = o;
      _candD[k] = d2;
      n++;
    }
    for (let i = 0; i < 4 && i < n; i++) {
      const o = _cand[i];
      if (!o) break;
      if (world.clearLine(ex, ey, ez, o.pos.x, o.pos.y + CHEST, o.pos.z)) {
        this._see(b, o);
        return;
      }
    }
    if (!b.target && th && th.alive && dist2(a.pos, th.pos) < 30 * 30) {
      // heard / hurt by someone hidden and close: go to where they are
      b.target = th;
      b.targetVisible = false;
      b.lastSeen = t;
      b.lastSeenX = th.pos.x;
      b.lastSeenZ = th.pos.z;
      b.threat = null;
    }
  }

  _see(b, o) {
    const t = this.time;
    if (b.target !== o || !b.targetVisible) {
      // fresh sighting: reaction delay before the first shot
      if (b.target !== o || t - b.lastSeen > 1.2) {
        b.reactLeft = this.diff.reaction * (0.7 + this.rng() * 0.6);
        b.trackTime = 0;
        b.burstLeft = 0;
      }
    }
    b.target = o;
    b.targetVisible = true;
    b.lastSeen = t;
    b.lastSeenX = o.pos.x;
    b.lastSeenZ = o.pos.z;
  }

  _startEngage(b) {
    b.buildRolled = false;
  }

  _hasGun(inv) {
    if (!inv || !inv.slots) return true; // unknown (e.g. no inventory): assume armed
    for (let i = 0; i < 5; i++) {
      const s = inv.slots[i];
      if (s && s.type === 'weapon' && (s.mag > 0 || inv.ammo[WEAPONS[s.id].ammo] > 0)) return true;
    }
    return false;
  }

  _chooseWeapon(b, dist) {
    const inv = b.actor.inventory;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < 5; i++) {
      const s = inv.slots[i];
      if (!s || s.type !== 'weapon') continue;
      const w = WEAPONS[s.id];
      if (s.mag <= 0 && inv.ammo[w.ammo] <= 0) continue;
      let score = Math.abs(Math.log(Math.max(1, dist) / w.botRange));
      if (dist > w.range * 0.9) score += 4;
      if (s.mag <= 0) score += 0.6;
      score -= (RARITY_RANK[s.rarity] || 0) * 0.06;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best !== inv.selected && b.reloading <= 0 && this.time > b.switchAt) this._equip(b, best);
  }

  _equip(b, slot) {
    const a = b.actor;
    const inv = a.inventory;
    if (inv.selected === slot) return;
    inv.select(slot);
    b.reloading = 0;
    b.switchAt = this.time + 0.6;
    b.fireCd = Math.max(b.fireCd, 0.3);
    b.burstLeft = 0;
    b.bloom = 0;
    const it = inv.current();
    if (a.character) {
      if (it && it.type === 'weapon') a.character.setEquipped(it.id, WEAPONS[it.id].twoHanded);
      else a.character.setEquipped('pickaxe', true);
    }
  }

  _wantHeal(b) {
    const a = b.actor;
    if (this.time - b.lastSeen < 2.5 || this.time - b.hurtAt < 1.5) return false;
    const inv = a.inventory;
    if (a.health < 75 && findConsumable(inv, 'medkit') >= 0) return true;
    if (a.shield < 50 && findConsumable(inv, 'tonic') >= 0) return true;
    return false;
  }

  _startHeal(b) {
    const a = b.actor;
    const inv = a.inventory;
    let slot = -1;
    if (a.health < 75) slot = findConsumable(inv, 'medkit');
    if (slot < 0 && a.shield < 50) slot = findConsumable(inv, 'tonic');
    if (slot < 0) return;
    inv.select(slot);
    const c = CONSUMABLES[inv.slots[slot].id];
    b.healing = c.useTime;
    b.reloading = 0;
    if (a.character) {
      a.character.setEquipped('pickaxe', true);
      a.character.useItem(c.useTime);
    }
  }

  _cancelHeal(b) {
    b.healing = 0;
    if (b.actor.character) b.actor.character.cancelOneShot();
  }

  _finishHeal(b) {
    const a = b.actor;
    const used = a.inventory.useConsumable();
    b.healing = 0;
    if (!used) return;
    const c = CONSUMABLES[used.id];
    a.health = Math.min(PLAYER.maxHealth, a.health + c.heal);
    a.shield = Math.min(PLAYER.maxShield, a.shield + c.shield);
    b.lastHp = a.health + a.shield;
    if (this.sfx) this.sfx.play(c.sound, a.pos);
    if (this.fx) this.fx.aura(a.character ? a.character.root : a.pos, c.shield > 0 ? 'shield' : 'heal', 1.2);
  }

  _needRotate(b, storm) {
    if (!storm || storm.mode === 'done') return false;
    const a = b.actor;
    const d = Math.hypot(a.pos.x - storm.nextCx, a.pos.z - storm.nextCz);
    // hysteresis: once rotating, keep going until comfortably inside
    const inside = storm.nextR * (b.state === 'rotate' ? 0.6 : 0.85) - d;
    if (inside > 0) return false;
    if (storm.mode !== 'waiting') return true;
    const travel = -inside / PLAYER.runSpeed;
    return storm.secondsLeft < travel * 1.6 + 12 + b.caution * 25;
  }

  _pickLoot(b) {
    const loot = this.loot;
    if (!loot) return false;
    const a = b.actor;
    const inv = a.inventory;
    const t = this.time;
    // keep the current loot target a while
    if (b.lootId != null) {
      if (t < b.lootUntil && !b.ignore.has(b.lootId)) return true;
      b.ignore.set(b.lootId, t + 30); // could not reach it in time
      b.lootId = null;
    }
    const recs = loot.near(a.pos, LOOT_SCAN);
    if (!recs || !recs.length) return false;
    const storm = this._storm;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      const until = b.ignore.get(r.id);
      if (until !== undefined) {
        if (t < until) continue;
        b.ignore.delete(r.id);
      }
      const p = r.position;
      if (Math.abs(p.y - a.pos.y) > 6) continue;
      if (storm && storm.isOutside(p.x, p.z)) continue;
      // late in a wait (or while shrinking) only loot inside the next circle
      if (storm && (storm.mode !== 'waiting' || storm.secondsLeft < 45) &&
          Math.hypot(p.x - storm.nextCx, p.z - storm.nextCz) > storm.nextR * 0.85) continue;
      if (r.kind === 'item' && !this._wants(inv, r.item)) continue;
      b.lootId = r.id;
      b.lootKind = r.kind;
      b.lootX = p.x;
      b.lootZ = p.z;
      b.lootUntil = t + 4 + Math.hypot(p.x - a.pos.x, p.z - a.pos.z) / 3;
      return true;
    }
    return false;
  }

  _wants(inv, item) {
    if (!item) return false;
    if (item.type === 'ammo' || item.type === 'material') return inv.canTake(item);
    if (item.type === 'consumable') return inv.canTake(item);
    if (item.type === 'weapon') {
      if (!WEAPONS[item.id]) return false;
      let weapons = 0;
      let worst = -1;
      let worstRank = Infinity;
      for (let i = 0; i < 5; i++) {
        const s = inv.slots[i];
        if (!s) continue;
        if (s.type === 'weapon') {
          weapons++;
          if (s.id === item.id && (RARITY_RANK[s.rarity] || 0) >= (RARITY_RANK[item.rarity] || 0)) return false;
          const r = RARITY_RANK[s.rarity] || 0;
          if (r < worstRank) {
            worstRank = r;
            worst = i;
          }
        }
      }
      if (inv.canTake(item) && weapons < 4) return true;
      return worst >= 0 && (RARITY_RANK[item.rarity] || 0) > worstRank;
    }
    return false;
  }

  _interact(b) {
    const loot = this.loot;
    const a = b.actor;
    const id = b.lootId;
    b.lootId = null;
    if (id == null) return;
    b.ignore.set(id, this.time + 60);
    if (b.lootKind === 'chest' || b.lootKind === 'ammoBox') {
      loot.open(id);
      b.thinkIn = 0.15;
      return;
    }
    const inv = a.inventory;
    const item = loot.take(id);
    if (!item) return;
    let out;
    if (item.type === 'weapon' && !inv.canTake(item)) {
      // swap out the weakest weapon
      let worst = -1;
      let worstRank = Infinity;
      for (let i = 0; i < 5; i++) {
        const s = inv.slots[i];
        if (s && s.type === 'weapon' && (RARITY_RANK[s.rarity] || 0) < worstRank) {
          worstRank = RARITY_RANK[s.rarity] || 0;
          worst = i;
        }
      }
      if (worst < 0) {
        loot.drop(item, a.pos);
        return;
      }
      inv.select(worst);
      out = inv.add(item);
      this._syncEquip(b);
    } else out = inv.add(item);
    if (out) {
      _v.copy(a.pos);
      _v.x += Math.sin(a.heading + 2) * 0.8;
      _v.z -= Math.cos(a.heading + 2) * 0.8;
      loot.drop(out, _v);
    }
  }

  _syncEquip(b) {
    const a = b.actor;
    if (!a.character) return;
    const it = a.inventory.current();
    if (it && it.type === 'weapon') a.character.setEquipped(it.id, WEAPONS[it.id].twoHanded);
    else a.character.setEquipped('pickaxe', true);
  }

  _pickHarvest(b) {
    const a = b.actor;
    const m = a.inventory.mats;
    if (m.wood + m.brick + m.metal >= 120 || !this.combat) return false;
    if (this.time < b.harvestCooldown) return false;
    const fx = Math.sin(a.heading);
    const fz = -Math.cos(a.heading);
    const c = this.world.probeCircle(a.pos.x, a.pos.z, fx, fz, 8, 1.5);
    if (!c || !c.alive || !(c.hp > 0) || c.hp === Infinity) return false;
    b.harvest = c;
    b.harvestUntil = this.time + 7;
    b.harvestCooldown = this.time + 10;
    return true;
  }

  _maybeBuild(b, fx, fz, d) {
    const st = this.structures;
    if (!st || b.buildRolled || !b.targetVisible) return;
    if (this.time < b.buildCooldown) return;
    b.buildRolled = true;
    if (this.rng() > this.diff.buildChance) return;
    const inv = b.actor.inventory;
    let mat = null;
    let most = BUILD.cost - 1;
    for (const m of MATERIALS) {
      if (inv.mats[m] > most) {
        most = inv.mats[m];
        mat = m;
      }
    }
    if (!mat) return;
    const a = b.actor;
    const heading = Math.atan2(fx, -fz);
    const kind = d > 25 && this.rng() < 0.5 ? 'ramp' : 'wall';
    const placement = st.plan(kind, a.pos, heading, 0);
    if (!placement || !placement.valid) return;
    if (!inv.spendMats(mat, BUILD.cost)) return;
    const piece = st.place(placement, mat, a);
    if (!piece) inv.mats[mat] += BUILD.cost;
    else {
      b.buildCooldown = this.time + 5 + this.rng() * 6;
      b.builds++;
      // run up a ramp toward the target for a moment
      if (kind === 'ramp') b.wantJump = false;
    }
  }

  // ------------------------------------------------------------- steering

  /** Picks a move direction toward (gx, gz), avoiding obstacles with short horizontal rays. */
  _steer(b, gx, gz, speed, stop) {
    const a = b.actor;
    const dx = gx - a.pos.x;
    const dz = gz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stop || speed <= 0) {
      b.mx = 0;
      b.mz = 0;
      b.speed = 0;
      return;
    }
    const ux = dx / d;
    const uz = dz / d;
    const base = Math.atan2(ux, -uz);
    const world = this.world;
    const oy = a.pos.y + 0.95;
    const range = Math.min(d, 3.2);
    const side = b.avoidSide;
    let chosen = base;
    let ok = false;
    for (let i = 0; i < AVOID.length; i++) {
      const h = base + AVOID[i] * side;
      const hx = Math.sin(h);
      const hz = -Math.cos(h);
      if (!world.raycast(a.pos.x, oy, a.pos.z, hx, 0, hz, range + a.radius)) {
        chosen = h;
        ok = true;
        if (i > 0 && i % 2 === 0) b.avoidSide = -b.avoidSide; // the other side was the clear one; follow it
        break;
      }
    }
    if (!ok) chosen = base + Math.PI * 0.75 * side;
    b.mx = Math.sin(chosen);
    b.mz = -Math.cos(chosen);
    b.speed = speed;
  }

  _stuckCheck(b) {
    const a = b.actor;
    const t = this.time;
    if (t < b.stuckAt) return;
    const moved = Math.hypot(a.pos.x - b.stuckX, a.pos.z - b.stuckZ);
    const wanted = b.speed > 0 ? b.speed * STUCK_WINDOW * 0.25 : 0;
    if (b.speed > 0 && moved < Math.max(0.8, wanted)) {
      b.stuck++;
      b.stuckTotal++;
      b.wantJump = true;
      b.avoidSide = -b.avoidSide;
      if (b.stuck >= 2 && b.state !== 'engage' && b.pathN === 0) {
        // plan a way around on a coarse grid toward the current goal (delivered in a later frame)
        this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ);
      }
      if (b.stuck >= 5) {
        // re-path: drop this goal and go somewhere else nearby
        b.stuck = 0;
        if (b.lootId != null) {
          b.ignore.set(b.lootId, t + 30);
          b.lootId = null;
        }
        b.harvest = null;
        world_pointIn(this.world, this.rng, a.pos.x, a.pos.z, 40, _pt);
        b.goalX = _pt.x;
        b.goalZ = _pt.z;
        b.wanderGoal = true;
        b.wanderUntil = t + 8;
        b.rotGoal = b.state === 'rotate' ? false : b.rotGoal;
      }
    } else if (moved > 1.5) b.stuck = 0;
    // long-horizon progress: moving but oscillating in place also counts as stuck
    if (t > b.progAt) {
      const d = Math.hypot(b.navX - a.pos.x, b.navZ - a.pos.z);
      const travelling = b.speed > 0 && b.state !== 'engage' && b.state !== 'harvest' && d > 4;
      if (travelling && b.progD - d < 3 && b.pathN === 0) {
        b.stuck = Math.max(b.stuck, 2);
        this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ);
      }
      b.progD = d;
      b.progAt = t + 6;
    }
    b.stuckX = a.pos.x;
    b.stuckZ = a.pos.z;
    b.stuckAt = t + STUCK_WINDOW;
  }

  // ---------------------------------------------------------- per-frame act

  _act(b, dt) {
    const a = b.actor;
    if (b.state === 'drop') return;
    const t = this.time;
    b.stateTime += dt;
    b.fireCd -= dt;
    b.bloom = Math.max(0, b.bloom - dt * 0.08);
    const inv = a.inventory;

    if (b.healing > 0) {
      b.healing -= dt;
      if (b.healing <= 0) this._finishHeal(b);
    }
    if (b.reloading > 0) {
      b.reloading -= dt;
      if (b.reloading <= 0) {
        const it = inv.current();
        if (it && it.type === 'weapon') {
          const w = WEAPONS[it.id];
          it.mag += inv.takeAmmo(w.ammo, w.mag - it.mag);
        }
      }
    }

    // facing
    let want = a.heading;
    let pitch = 0;
    const tgt = b.target;
    if (tgt && b.targetVisible && b.state === 'engage') {
      const dx = tgt.pos.x - a.pos.x;
      const dz = tgt.pos.z - a.pos.z;
      want = Math.atan2(dx, -dz);
      pitch = Math.atan2(tgt.pos.y + CHEST - (a.pos.y + EYE), Math.hypot(dx, dz) || 1);
    } else if (b.state === 'harvest' && b.harvest) {
      want = Math.atan2(b.faceX - a.pos.x, -(b.faceZ - a.pos.z));
    } else if (b.speed > 0 && (b.mx || b.mz)) {
      want = Math.atan2(b.mx, -b.mz);
    } else if (t < b.alertUntil && !tgt) {
      want = a.heading + 2.5 * dt * b.avoidSide * 2; // look around
    }
    const dh = angleDelta(a.heading, want);
    const turn = TURN_RATE * dt;
    a.heading += dh > turn ? turn : dh < -turn ? -turn : dh;
    a.pitch += (pitch - a.pitch) * Math.min(1, dt * 10);

    if (b.state === 'engage' && tgt && b.targetVisible) {
      b.trackTime += dt;
      if (b.reactLeft > 0) {
        b.reactLeft -= dt;
        return;
      }
      if (Math.abs(angleDelta(a.heading, want)) > 0.3) return;
      this._fireControl(b, tgt);
    } else if (b.state === 'harvest' && b.harvestReach && b.fireCd <= 0 && b.harvest) {
      this._swingAt(b, b.harvest.x, a.pos.y + 1.0, b.harvest.z, null);
    }
  }

  _fireControl(b, tgt) {
    const a = b.actor;
    const inv = a.inventory;
    if (b.fireCd > 0 || b.reloading > 0 || b.healing > 0) return;
    const it = inv.current();
    const dx = tgt.pos.x - a.pos.x;
    const dz = tgt.pos.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    if (!it || it.type !== 'weapon') {
      if (dist < PICKAXE.range + 0.4) this._swingAt(b, tgt.pos.x, tgt.pos.y + CHEST, tgt.pos.z, tgt);
      return;
    }
    const w = WEAPONS[it.id];
    if (it.mag <= 0) {
      if (inv.ammo[w.ammo] > 0) this._startReload(b, it);
      else this._chooseWeapon(b, dist);
      return;
    }
    if (dist > w.range) return;
    // bursts: `burst` is how much of the time a bot keeps the trigger down
    const diff = this.diff;
    if (b.burstLeft <= 0) {
      if (b.burstPaused) {
        b.burstPaused = false;
        b.burstLeft = w.auto ? 3 + Math.floor(this.rng() * 7 * diff.burst) : 1 + Math.floor(this.rng() * 3 * diff.burst);
        // aim drift for this burst (radians)
        b.errYaw = gauss(this.rng) * diff.aimError;
        b.errPitch = gauss(this.rng) * diff.aimError * 0.6;
      } else {
        b.burstPaused = true;
        b.fireCd = (1 - diff.burst) * (w.auto ? 1.6 : 0.8) + 0.15 + this.rng() * 0.35;
        return;
      }
    }

    // origin: muzzle when the character is drawn, else the eye
    const ch = a.character;
    if (ch && ch.root.visible) ch.muzzle(_origin);
    else _origin.set(a.pos.x + Math.sin(a.heading) * 0.4, a.pos.y + EYE - 0.15, a.pos.z - Math.cos(a.heading) * 0.4);
    // aim at the chest (head now and then), with drift that shrinks while tracking
    const settle = Math.max(0.45, 1 - b.trackTime / 5);
    const tSpeed = tgt.vel ? Math.min(1.5, Math.hypot(tgt.vel.x, tgt.vel.z) / 7) : 0;
    const err = settle * (1 + tSpeed * 0.6);
    const aimY = tgt.pos.y + (this.rng() < 0.15 ? 1.62 : CHEST);
    _dir.set(tgt.pos.x - _origin.x, aimY - _origin.y, tgt.pos.z - _origin.z);
    const len = _dir.length() || 1;
    _dir.multiplyScalar(1 / len);
    const yaw = (b.errYaw + gauss(this.rng) * this.diff.aimError * 0.35) * err;
    const pit = (b.errPitch + gauss(this.rng) * this.diff.aimError * 0.25) * err;
    rotateDir(_dir, yaw, pit);

    const moving = Math.hypot(a.vel.x, a.vel.z) > 1 ? 1.35 : 1;
    const base = w.hipSpread ? w.hipSpread * 0.5 : w.spread;
    const spread = (base + b.bloom) * moving * (a.grounded ? 1 : 1.6);
    it.mag--;
    b.bloom = Math.min(w.maxBloom, b.bloom + w.bloom);
    b.burstLeft--;
    b.shots++;
    b.fireCd = 1 / w.rate + (w.auto ? 0 : 0.12 + this.rng() * 0.2);
    if (ch) ch.fire();
    if (this.combat) this.combat.fireWeapon(a, it, _origin, _dir, spread);
    if (it.mag <= 0 && inv.ammo[w.ammo] > 0) this._startReload(b, it);
  }

  _swingAt(b, x, y, z, target) {
    const a = b.actor;
    b.fireCd = 1 / PICKAXE.rate;
    _origin.set(a.pos.x, a.pos.y + EYE - 0.2, a.pos.z);
    _dir.set(x - _origin.x, y - _origin.y, z - _origin.z);
    const len = _dir.length() || 1;
    _dir.multiplyScalar(1 / len);
    if (a.character) a.character.swing();
    b.swings++;
    if (!this.combat) return;
    const res = this.combat.swingPickaxe(a, _origin, _dir);
    if (res && res.harvested && res.harvested.count > 0) {
      _matItem.mat = res.harvested.mat;
      _matItem.count = res.harvested.count;
      a.inventory.add(_matItem);
    }
    if (!target && b.harvest && !b.harvest.alive) {
      b.harvest = null;
      b.thinkIn = 0;
    }
  }

  _startReload(b, it) {
    const a = b.actor;
    const w = WEAPONS[it.id];
    if (b.reloading > 0 || it.mag >= w.mag || a.inventory.ammo[w.ammo] <= 0) return;
    b.reloading = w.reload;
    b.burstLeft = 0;
    if (a.character) a.character.reload(w.reload);
    if (this.sfx) this.sfx.play('reload', { x: a.pos.x, y: a.pos.y, z: a.pos.z, weapon: it.id });
    if (this.onReload) this.onReload(a, it.id); // multiplayer: host replicates the sound
  }

  // --------------------------------------------------------------- physics

  _move(b, dt) {
    const a = b.actor;
    const world = this.world;
    const pos = a.pos;
    const vel = a.vel;

    if (b.state === 'drop') {
      // glide: constant sink, steer toward the landing point
      const dx = b.dropX - pos.x;
      const dz = b.dropZ - pos.z;
      const d = Math.hypot(dx, dz);
      const sp = Math.min(PLAYER.glideSpeed, d * 0.8);
      const tx = d > 0.01 ? (dx / d) * sp : 0;
      const tz = d > 0.01 ? (dz / d) * sp : 0;
      approach(vel, tx, tz, PLAYER.accelAir * 1.5 * dt);
      vel.y = -PLAYER.glideFallSpeed;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
      pos.z += vel.z * dt;
      world.resolveCircle(pos, a.radius, a.height);
      const g = world.groundHeight(pos.x, pos.z, pos.y);
      if (d > 0.5) a.heading += clamp(angleDelta(a.heading, Math.atan2(dx, -dz)), -3 * dt, 3 * dt);
      if (pos.y <= g + 0.02) {
        pos.y = g;
        vel.y = 0;
        vel.x *= 0.3;
        vel.z *= 0.3;
        a.gliding = false;
        a.grounded = true;
        b.state = 'wander';
        a.botState = 'wander';
        b.landedAt = this.time;
        b.thinkIn = 0.05 + this.rng() * 0.2;
        b.stuckX = pos.x;
        b.stuckZ = pos.z;
        b.stuckAt = this.time + STUCK_WINDOW;
        if (this.fx && a.character && a.character.root.visible) this.fx.dustPuff(pos);
        if (this.sfx) this.sfx.play('land', pos);
      }
      this._clampBounds(pos);
      return;
    }

    let sp = b.speed;
    if (b.healing > 0) sp = Math.min(sp, 1.5);
    approach(vel, b.mx * sp, b.mz * sp, (a.grounded ? PLAYER.accelGround : PLAYER.accelAir) * dt);
    if (b.wantJump && a.grounded) {
      vel.y = PLAYER.jumpSpeed;
      a.grounded = false;
      b.jumps++;
    }
    b.wantJump = false;
    if (!a.grounded) vel.y -= PLAYER.gravity * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    world.resolveCircle(pos, a.radius, a.height);
    const g = world.groundHeight(pos.x, pos.z, pos.y);
    if (pos.y <= g) {
      pos.y = g;
      if (vel.y < 0) vel.y = 0;
      a.grounded = true;
    } else if (a.grounded && vel.y <= 0 && pos.y - g <= PLAYER.stepHeight) {
      pos.y = g; // step down
      vel.y = 0;
    } else a.grounded = false;
    this._clampBounds(pos);
  }

  _clampBounds(pos) {
    const bd = this.world.bounds;
    if (pos.x < bd.minX + 1) pos.x = bd.minX + 1;
    else if (pos.x > bd.maxX - 1) pos.x = bd.maxX - 1;
    if (pos.z < bd.minZ + 1) pos.z = bd.minZ + 1;
    else if (pos.z > bd.maxZ - 1) pos.z = bd.maxZ - 1;
    if (pos.y < 0) pos.y = 0;
  }

  // ------------------------------------------------------------- presentation

  _present(b, dt, viewer, cd2) {
    const a = b.actor;
    const ch = a.character;
    if (!ch) return;
    let d2 = 0;
    if (viewer) {
      const dx = a.pos.x - viewer.x;
      const dy = a.pos.y - viewer.y;
      const dz = a.pos.z - viewer.z;
      d2 = dx * dx + dy * dy * 0.25 + dz * dz;
    }
    const show = d2 < cd2 && !(b.state === 'dead' && b.deadTime > 6);
    ch.root.visible = show;
    if (!show) {
      b.animAcc = 0;
      return;
    }
    // half-rate animation in the outer half of the draw distance
    b.animAcc += dt;
    if (d2 > cd2 * 0.25) {
      b.animFlip = !b.animFlip;
      if (b.animFlip) return;
    }
    const step = b.animAcc;
    b.animAcc = 0;
    ch.root.position.copy(a.pos);
    const h = a.heading;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const vx = a.vel.x;
    const vz = a.vel.z;
    const speed = Math.hypot(vx, vz);
    _anim.speed = speed;
    _anim.fwd = speed > 0.1 ? (vx * fx + vz * fz) / speed : 0;
    _anim.side = speed > 0.1 ? (vx * -fz + vz * fx) / speed : 0;
    _anim.grounded = a.grounded || b.state === 'dead';
    _anim.gliding = a.gliding;
    _anim.heading = h;
    _anim.pitch = a.pitch;
    ch.animate = true;
    ch.update(step, _anim);
  }

  _die(b) {
    const a = b.actor;
    b.state = 'dead';
    a.botState = 'dead';
    b.deadTime = 0;
    b.healing = 0;
    b.reloading = 0;
    b.speed = 0;
    a.vel.set(0, 0, 0);
    a.gliding = false;
    if (a.character) a.character.die();
    if (this.dropLootOnDeath && this.loot && !a.lootDropped) {
      a.lootDropped = true;
      const items = a.inventory.dropAll();
      for (let i = 0; i < items.length; i++) {
        const ang = (i / Math.max(1, items.length)) * Math.PI * 2;
        _v.set(a.pos.x + Math.cos(ang) * 1.1, a.pos.y, a.pos.z + Math.sin(ang) * 1.1);
        this.loot.drop(items[i], _v);
      }
    }
  }
}

// ------------------------------------------------------------------ helpers

function newBrain(actor, target, rng) {
  return {
    actor,
    state: 'drop',
    stateTime: 0,
    thinkIn: rng() * 0.25,
    dropX: target.x,
    dropZ: target.z,
    landedAt: -1,
    dropChecked: false,
    // movement
    mx: 0,
    mz: 0,
    speed: 0,
    wantJump: false,
    avoidSide: rng() < 0.5 ? -1 : 1,
    goalX: target.x,
    goalZ: target.z,
    wanderGoal: false,
    wanderUntil: 0,
    rotGoal: false,
    stormCx: NaN,
    stormCz: NaN,
    stormR: NaN,
    caution: rng(),
    aggression: 0.25 + rng() * 0.75,
    retreatUntil: -99,
    stuckX: actor.pos.x,
    stuckZ: actor.pos.z,
    stuckAt: 0,
    stuck: 0,
    progAt: 0,
    progD: Infinity,
    // combat
    target: null,
    targetVisible: false,
    threat: null,
    lastSeen: -99,
    lastSeenX: 0,
    lastSeenZ: 0,
    alertUntil: 0,
    hurtAt: -99,
    lastHp: actor.health + actor.shield,
    reactLeft: 0,
    trackTime: 0,
    fireCd: 0,
    burstLeft: 0,
    burstPaused: true,
    errYaw: 0,
    errPitch: 0,
    bloom: 0,
    reloading: 0,
    switchAt: 0,
    strafe: 1,
    strafeUntil: 0,
    buildRolled: false,
    buildCooldown: 0,
    // items
    healing: 0,
    lootId: null,
    lootKind: null,
    lootX: 0,
    lootZ: 0,
    lootUntil: 0,
    ignore: new Map(),
    harvest: null,
    harvestUntil: 0,
    harvestCooldown: 0,
    harvestReach: false,
    faceX: 0,
    faceZ: 0,
    // presentation
    deadTime: 0,
    animAcc: 0,
    animFlip: false,
    // counters (debug / QA)
    shots: 0,
    swings: 0,
    jumps: 0,
    builds: 0,
    stuckTotal: 0,
    paths: 0,
    // planned detour: flat x,z waypoints
    navX: 0,
    navZ: 0,
    path: new Float32Array(PATH_MAX * 2),
    pathN: 0,
    pathI: 0,
    pathGoalX: 0,
    pathGoalZ: 0,
    pathUntil: 0,
    planQueued: false,
    planN: 0,
    planSX: 0,
    planSZ: 0,
    planGX: 0,
    planGZ: 0,
  };
}

/** Still in the drop (bus / freefall / glide): not a target yet. */
function inAir(o) {
  return !!(o.gliding || o.airborneDrop || o.mode === 'bus' || o.mode === 'freefall' || o.mode === 'glide');
}

function findConsumable(inv, id) {
  for (let i = 0; i < 5; i++) {
    const s = inv.slots[i];
    if (s && s.type === 'consumable' && s.id === id && s.count > 0) return i;
  }
  return -1;
}

function dist2(p, q) {
  const dx = p.x - q.x;
  const dz = p.z - q.z;
  return dx * dx + dz * dz;
}

function approach(vel, tx, tz, maxDelta) {
  const dx = tx - vel.x;
  const dz = tz - vel.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < 1e-6) {
    vel.x = tx;
    vel.z = tz;
  } else {
    vel.x += (dx / d) * maxDelta;
    vel.z += (dz / d) * maxDelta;
  }
}

/** Rotates a unit direction by small yaw (about y) and pitch offsets. */
function rotateDir(d, yaw, pitch) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = d.x * c - d.z * s;
  const z = d.x * s + d.z * c;
  d.x = x;
  d.z = z;
  d.y += pitch;
  d.normalize();
}

function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) * 2; // ~unit standard deviation
}

function shuffled(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

// ------------------------------------------------------------- path planner
// A* on a lazily-sampled 2 m grid in a 192 m window around a stuck bot. One shared
// planner serves a queue of requests and is time-sliced: step() runs a bounded
// number of expansions per frame, so planning never spikes a frame.

const PG = 96; // cells per side
const PC = 2; // metres per cell
const PATH_MAX = 24;
const PLAN_MAX_EXPANSIONS = 6000;
// neighbour offsets as (dx, dz, cost) triples
const NB = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1, 1, 1, 1.4142, 1, -1, 1.4142, -1, 1, 1.4142, -1, -1, 1.4142];

class Planner {
  constructor(world) {
    this.world = world;
    this.occ = new Uint8Array(PG * PG); // 1 free, 2 blocked (valid when seen[i] == stamp)
    this.seen = new Uint32Array(PG * PG);
    this.g = new Float32Array(PG * PG);
    this.parent = new Int32Array(PG * PG);
    this.state = new Uint32Array(PG * PG); // stamp = closed, stamp + 1e9 = open
    this.heap = new Int32Array(PG * PG * 4);
    this.hf = new Float32Array(PG * PG * 4);
    this.cells = new Int32Array(PG * PG);
    this.stamp = 0;
    this.busy = false;
    this.owner = null;
    this.queue = [];
  }

  request(b, sx, sz, gx, gz) {
    if (b.planQueued) return;
    b.planQueued = true;
    b.planSX = sx;
    b.planSZ = sz;
    b.planGX = gx;
    b.planGZ = gz;
    this.queue.push(b);
  }

  cancelAll() {
    for (const b of this.queue) b.planQueued = false;
    this.queue.length = 0;
    if (this.owner) this.owner.planQueued = false;
    this.owner = null;
    this.busy = false;
  }

  /** Runs up to `budget` expansions. Returns the brain whose plan finished (path in b.path), or null. */
  step(budget) {
    if (!this.busy) {
      if (!this.queue.length) return null;
      const b = this.queue.shift();
      this._start(b);
    }
    const done = this._run(budget);
    if (!done) return null;
    const b = this.owner;
    this.owner = null;
    this.busy = false;
    b.planQueued = false;
    b.planN = this._emit(b.path);
    return b;
  }

  _start(b) {
    this.owner = b;
    this.busy = true;
    this.stamp++;
    this.ox = b.planSX - (PG * PC) / 2;
    this.oz = b.planSZ - (PG * PC) / 2;
    this.gx = b.planGX;
    this.gz = b.planGZ;
    this.hn = 0;
    this.expanded = 0;
    const cx = Math.floor((b.planSX - this.ox) / PC);
    const cz = Math.floor((b.planSZ - this.oz) / PC);
    const start = cz * PG + cx;
    this.start = start;
    this.seen[start] = this.stamp;
    this.occ[start] = 1;
    this.g[start] = 0;
    this.parent[start] = -1;
    this.state[start] = this.stamp + 1e9;
    this.best = start;
    this.bestH = this._h(start);
    this._push(start, this.bestH);
  }

  _h(i) {
    const x = this.ox + ((i % PG) + 0.5) * PC;
    const z = this.oz + (Math.floor(i / PG) + 0.5) * PC;
    return Math.hypot(this.gx - x, this.gz - z);
  }

  _free(i) {
    if (this.seen[i] !== this.stamp) {
      this.seen[i] = this.stamp;
      const x = this.ox + ((i % PG) + 0.5) * PC;
      const z = this.oz + (Math.floor(i / PG) + 0.5) * PC;
      const w = this.world;
      this.occ[i] = w.inBounds(x, z, 3) && !w.blockedAt(x, z, 0.75) ? 1 : 2;
    }
    return this.occ[i] === 1;
  }

  _push(i, f) {
    const heap = this.heap;
    const hf = this.hf;
    let k = this.hn++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      heap[k] = heap[p];
      hf[k] = hf[p];
      k = p;
    }
    heap[k] = i;
    hf[k] = f;
  }

  _pop() {
    const heap = this.heap;
    const hf = this.hf;
    const top = heap[0];
    const n = --this.hn;
    const li = heap[n];
    const lf = hf[n];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= n) break;
      if (c + 1 < n && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      heap[k] = heap[c];
      hf[k] = hf[c];
      k = c;
    }
    heap[k] = li;
    hf[k] = lf;
    return top;
  }

  /** True when the search is finished (goal reached, exhausted, or out of expansions). */
  _run(budget) {
    const stamp = this.stamp;
    const open = stamp + 1e9;
    const st = this.state;
    const g = this.g;
    for (let n = 0; n < budget; n++) {
      if (this.hn === 0 || this.expanded >= PLAN_MAX_EXPANSIONS) return true;
      if (this.hn >= this.heap.length - 8) return true;
      const cur = this._pop();
      if (st[cur] === stamp) continue;
      st[cur] = stamp;
      this.expanded++;
      const h = this._h(cur);
      if (h < this.bestH) {
        this.bestH = h;
        this.best = cur;
      }
      if (h < PC) return true;
      const cx = cur % PG;
      const cz = (cur - cx) / PG;
      const g0 = g[cur];
      for (let k = 0; k < NB.length; k += 3) {
        const nx = cx + NB[k];
        const nz = cz + NB[k + 1];
        if (nx < 0 || nz < 0 || nx >= PG || nz >= PG) continue;
        const ni = nz * PG + nx;
        if (st[ni] === stamp || !this._free(ni)) continue;
        if (NB[k] !== 0 && NB[k + 1] !== 0 && (!this._free(cz * PG + nx) || !this._free(nz * PG + cx))) continue; // no corner cutting
        const ng = g0 + NB[k + 2] * PC;
        if (st[ni] !== open || ng < g[ni]) {
          g[ni] = ng;
          this.parent[ni] = cur;
          st[ni] = open;
          this._push(ni, ng + this._h(ni) * 1.2);
        }
      }
    }
    return false;
  }

  /** Writes waypoints (every 3rd cell from start toward the best cell) into out; returns the count. */
  _emit(out) {
    if (this.best === this.start) return 0;
    const cells = this.cells;
    let n = 0;
    for (let i = this.best; i !== -1 && n < cells.length; i = this.parent[i]) cells[n++] = i;
    let w = 0;
    for (let k = n - 2; k >= 0 && w < PATH_MAX; k--) {
      if (k !== 0 && (n - 2 - k) % 3 !== 2) continue;
      const i = cells[k];
      out[w * 2] = this.ox + ((i % PG) + 0.5) * PC;
      out[w * 2 + 1] = this.oz + (Math.floor(i / PG) + 0.5) * PC;
      w++;
    }
    return w;
  }
}

/** Blocking one-shot plan (tests / debugging). */
function planPath(world, sx, sz, gx, gz, out) {
  const p = new Planner(world);
  const b = { path: out, planQueued: false, planN: 0 };
  p.request(b, sx, sz, gx, gz);
  let r = null;
  while (!r) r = p.step(1e9);
  return b.planN;
}

function world_pointIn(world, rng, cx, cz, r, out) {
  return world.randomOpenPoint(rng, cx, cz, r, 0.9, out);
}

export { planPath as _planPath }; // for tests
