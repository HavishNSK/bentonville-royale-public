// BENTONVILLE ROYALE — combat (hitscan guns + ballistic sniper rounds), damage and eliminations.
//
//   const combat = new Combat({ world, structures, fx, sfx, view });
//   combat.register(actor)                  // player and every bot
//   combat.fireWeapon(shooter, item, origin, dir, spread) -> [{ hitActor?, point, headshot }]
//   combat.swingPickaxe(shooter, origin, dir) -> { harvested?: { mat, count }, hitActor? }
//   combat.applyDamage(target, amount, { source, headshot, weapon, storm })
//   combat.tickProjectiles(dt)              // every frame: ballistic rounds (WEAPONS[id].ballistic)
//   combat.onDamage = (target, amount, info) => {}      // Game sets these
//   combat.onEliminate = (victim, killer, info) => {}
//   combat.onHarvest = (shooter, collider, info) => {}   // extra hook (HUD object bar)
//
// Notes
// - Callers own fire rate, magazines, reloads and bloom; fireWeapon fires one
//   trigger pull (all pellets) and does not touch the magazine.
// - Harvested materials are NOT added here; the caller adds `harvested` to its
//   inventory (capped at PLAYER.matCap).
// - `shooter.damageScale` (optional, default 1) multiplies outgoing damage
//   (bots set it from DIFFICULTY[...].damageScale).
// - `info.storm` damage skips the shield.
// - Every collider destroyed here is remembered; `restoreWorld()` puts them
//   back for the next match.
//
// Multiplayer (src/net):
// - `combat.authoritative = false` on a client: shots and swings only play
//   effects and sounds; no damage, no structure / harvestable hp changes.
// - fireWeapon(..., opts) takes opts.dirs (exact pellet directions, from the
//   client that fired) and opts.claims (actor the client saw each pellet hit,
//   accepted when the host ray passes within CLAIM_TOL of that actor).
//   `combat.lastDirs` holds the pellet directions of the last call.
// - Hooks: onFire(shooter, weapon, origin, records), onColliderDestroyed(c, point),
//   onBurstShot(shooter, item, origin, dirs, records) after each follow-up round of a
//   burst gun (a multiplayer client forwards it to the host like a trigger pull).
//
// Building wall panels (World.panelHit / breakPanel, src/world/Interiors.js):
// - a pickaxe swing that hits a panel damages it by PICKAXE.harvest and yields
//   PICKAXE.yield[panel.mat] exactly like a tree; bullets do BUILDING_WALL.bulletMult x
//   damage and yield nothing. Only panels break (floors, slabs, stairs, roofs never do),
//   and the building collider itself is never removed.
// - `damagePanel` is authoritative-only; `breakPanel(c, panel, point)` hides the panel and
//   plays the break effect (a multiplayer client calls it for the host's `wx` event).
// - Hooks: onPanelDamage(c, panel, info) while hp > 0, onPanelBreak(c, panel, info) on
//   break (info = { source, point }). restoreWorld() also restores every panel.
//
// Teams (src/game/Teams.js; `combat.teamMode` true in Duos / Trios / Squads):
// - no friendly fire: bullets and swings pass through teammates, applyDamage ignores them.
// - lethal damage knocks (actor.downed, actor.downHp) instead of eliminating while the team
//   still has someone standing; damage to a downed actor hits downHp; when nobody on a team
//   is left standing every downed member is eliminated (team wipe).
// - tickTeams(dt) (authoritative only): bleed-out and revives. A reviver sets
//   `actor.revivingTarget = downedMate`; progress lives on the target (reviveT, reviver).
// - Hooks: onKnock(victim, attacker, info), onRevive(victim, by).
// - Burst guns (WEAPONS[id].burst > 1): a locally-originated trigger pull (no opts.dirs)
//   fires the first round and schedules the rest `burstDelay` apart; each follow-up
//   takes one round from item.mag and stops if the shooter dies, reloads or swaps.

import * as THREE from 'three';
import { WEAPONS, PICKAXE, PLAYER, KNOCK, SIPHON, ASSIST_DAMAGE, BUILDING_WALL, lerp, weaponStats } from '../core/config.js';
import { CAR } from './vehicles/cars.js';
import { sameTeam, teamStanding, aliveTeamCount } from './Teams.js';

const _dir = new THREE.Vector3();
const _pt = new THREE.Vector3();
const _n = new THREE.Vector3();
const _from = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const HARVEST_SOUND = { wood: 'hit_wood', brick: 'hit_stone', metal: 'hit_metal' };
const CLAIM_TOL = 1.6; // m: lag allowance for a client's claimed hit (favour the shooter, a little)
const CLAIM_LATE_MS = 600; // a guest's claim for a round that already landed on the host still counts this long
const BLEND_M = 8; // m: a round's streak blends from the muzzle onto the true path over this distance
const SURFACE = { wood: 'wood', brick: 'brick', metal: 'metal' };

/** Ray (o + t d, |d| = 1) vs. an actor's vertical cylinder. Returns t or Infinity. */
function rayActor(ox, oy, oz, dx, dy, dz, actor, maxT) {
  // sitting in a car: a slimmer cylinder that stays inside the cabin (shots meet the glass first)
  const r = actor.vehicle && !actor.leaning ? 0.3 : (actor.radius || PLAYER.radius) + 0.08;
  const h = actor.vehicle && !actor.leaning ? CAR.seatedHeight : actor.downed ? (actor.height || PLAYER.height) * 0.45 : actor.crouching ? (actor.height || PLAYER.height) * 0.7 : actor.height || PLAYER.height;
  const feet = actor.pos.y;
  const fx = ox - actor.pos.x;
  const fz = oz - actor.pos.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    // vertical ray
    if (fx * fx + fz * fz > r * r) return Infinity;
    const t = dy < 0 ? oy - (feet + h) : feet - oy;
    return t > 0 && t < maxT ? t : Infinity;
  }
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t0 = (-b - s) / a;
  const t1 = (-b + s) / a;
  if (t1 < 0) return Infinity;
  // side entry
  if (t0 > 0 && t0 < maxT) {
    const y = oy + dy * t0;
    if (y >= feet && y <= feet + h) return t0;
  }
  // enter through the top or bottom cap
  if (Math.abs(dy) > 1e-6) {
    for (const capY of [feet + h, feet]) {
      const t = (capY - oy) / dy;
      if (t > Math.max(0, t0) && t < t1 && t < maxT) return t;
    }
  }
  // origin inside the cylinder
  if (t0 <= 0 && oy >= feet && oy <= feet + h) return 0.01;
  return Infinity;
}

/** World-space centre-line ends of wall panel `pn` of building collider `c`: { ax, az, bx, bz }. */
function panelEnds(c, pn) {
  if (pn.kind !== 'outer') return { ax: pn.ax, az: pn.az, bx: pn.bx, bz: pn.bz };
  const mid = c.shell && c.shell.mid;
  const n = c.n;
  if (!mid || !n) return { ax: pn.x, az: pn.z, bx: pn.x, bz: pn.z };
  const i = pn.e;
  const k = (i + 1) % n;
  const ax = mid[i * 2];
  const az = mid[i * 2 + 1];
  const ex = mid[k * 2] - ax;
  const ez = mid[k * 2 + 1] - az;
  return { ax: ax + ex * pn.f0, az: az + ez * pn.f0, bx: ax + ex * pn.f1, bz: az + ez * pn.f1 };
}

export class Combat {
  constructor({ world, structures, fx, sfx, view }) {
    this.world = world;
    this.structures = structures || null;
    this.fx = fx || null;
    this.sfx = sfx || null;
    this.view = view || null;
    this.actors = [];
    this.destroyed = [];
    this.onDamage = null;
    this.onEliminate = null;
    this.onHarvest = null;
    this.onFire = null;
    this.launchProjectile = null; // (shooter, stats, muzzle, origin, dir): rocket launchers (set by Game)
    this.onBurstShot = null;
    this.onColliderDestroyed = null;
    this.onKnock = null;
    this.onRevive = null;
    this.onCarry = null;
    this.onSiphon = null;
    this.onPanelDamage = null; // (building collider, panel, { source, point }) panel hp dropped, still standing
    this.onPanelBreak = null; // (building collider, panel, { source, point }) panel broken
    this.onAssist = null; // (assister, victim) when someone helped with an elimination
    this.onStats = null; // (actor) when kills / assists / damage changed (net sync) // (killer, { hp, shield }) after an elimination heals the killer // (carrier, victim | null) when someone picks up / puts down a teammate
    this.teamMode = false;
    this._burstEpoch = 0;
    this.authoritative = true;
    this.lastDirs = [];
    this._hits = [];
    this.projectiles = []; // ballistic rounds in flight (tickProjectiles)
    this._spent = []; // host: guest rounds that landed recently, still claimable
    this.lastProjectiles = [];
    this.onProjectileHit = null; // (projectile, actor) when a round reaches someone
  }

  register(actor) {
    if (!this.actors.includes(actor)) this.actors.push(actor);
  }

  unregister(actor) {
    const i = this.actors.indexOf(actor);
    if (i >= 0) this.actors.splice(i, 1);
  }

  clear() {
    this.actors.length = 0;
    this._burstEpoch++; // cancels pending burst rounds
    this.clearProjectiles();
  }

  /** Puts every destroyed tree / rock / prop / vehicle back (match restart). */
  restoreWorld() {
    for (const c of this.destroyed) {
      this.world.restore(c);
      if (this.view && this.view.showCollider) this.view.showCollider(c);
    }
    this.destroyed.length = 0;
    if (this.world.restoreAllPanels) this.world.restoreAllPanels(); // broken / damaged wall panels
  }

  get aliveCount() {
    let n = 0;
    for (const a of this.actors) if (a.alive) n++;
    return n;
  }

  /** Teams with anyone alive (= aliveCount in solo, where every actor is its own team). */
  get aliveTeams() {
    return aliveTeamCount(this.actors);
  }

  /** Nearest actor hit by the ray within maxT (excluding `ignore`). */
  rayActors(ox, oy, oz, dx, dy, dz, maxT, ignore) {
    let best = maxT;
    let hit = null;
    for (const a of this.actors) {
      if (!a.alive || a === ignore || a.inBus) continue;
      if (this.teamMode && sameTeam(a, ignore)) continue; // shots pass through teammates
      const t = rayActor(ox, oy, oz, dx, dy, dz, a, best);
      if (t < best) {
        best = t;
        hit = a;
      }
    }
    return hit ? { actor: hit, t: best } : null;
  }

  _surfaceOf(hit) {
    if (!hit) return 'dirt';
    if (hit.kind === 'car') return hit.part === 'window' ? 'glass' : 'metal';
    if (hit.kind === 'ground') return 'dirt';
    if (hit.kind === 'piece') return SURFACE[hit.collider && hit.collider.mat] || 'wood';
    if (hit.panel) return SURFACE[hit.panel.mat] || 'brick';
    return SURFACE[hit.collider && hit.collider.mat] || 'brick';
  }

  _isHarvestable(c) {
    return !!c && c.type !== 'piece' && Number.isFinite(c.hp) && c.hp > 0 && Array.isArray(c.ref);
  }

  /** Breakable but gives no materials (landmark glass panes: World.addBox colliders with `breakable`). */
  _isBreakable(c) {
    return !!c && c.breakable === true && c.alive && c.hp > 0;
  }

  /** The alive breakable wall panel a world.raycast() result hit, or null (resolve before the next raycast). */
  _panelOf(hit) {
    if (!hit || hit.kind !== 'building' || !this.world.panelHit) return null;
    const pn = this.world.panelHit(hit);
    return pn && pn.alive ? pn : null;
  }

  /**
   * Authoritative: take `amount` hp off wall panel `pn` of building collider `c`; breaks it
   * at 0. Returns true when it broke.
   */
  damagePanel(c, pn, amount, point, source = null) {
    if (!this.authoritative || !c || !pn || !pn.alive || !(amount > 0)) return false;
    pn.hp = Math.max(0, pn.hp - amount);
    if (pn.hp > 0) {
      if (this.onPanelDamage) this.onPanelDamage(c, pn, { source, point });
      return false;
    }
    return this.breakPanel(c, pn, point, source);
  }

  /** Break panel `pn` of building `c` (world + mesh via onPanelChange) and play the break effect. */
  breakPanel(c, pn, point = null, source = null) {
    if (!c || !pn || !this.world.breakPanel(c, pn.id)) return false;
    const y = (pn.y0 + pn.y1) / 2;
    const at = point ? point.clone() : new THREE.Vector3(pn.x, y, pn.z);
    if (this.fx && pn.kind === 'floor') {
      // a floor / ceiling tile: a burst of slab debris at the tile (it falls to the storey below)
      this.fx.debris(new THREE.Vector3(pn.x, y, pn.z), SURFACE[pn.mat] || 'wood', { count: 22, size: 0.45, spread: 2.2 });
    } else if (this.fx) {
      const ends = panelEnds(c, pn);
      if (this.fx.wallBreak) this.fx.wallBreak(ends, pn.y0, pn.y1, pn.mat);
      else this.fx.debris(at, SURFACE[pn.mat] || 'wood', { count: 18, size: 0.4, spread: 2.4 });
    }
    if (this.sfx) this.sfx.play('building_collapse', { x: pn.x, y, z: pn.z, volume: 0.55 });
    if (this.onPanelBreak) this.onPanelBreak(c, pn, { source, point: at });
    return true;
  }

  _destroyCollider(c, point) {
    this.world.remove(c);
    if (this.view && this.view.hideCollider) this.view.hideCollider(c);
    this.destroyed.push(c);
    if (this.onColliderDestroyed) this.onColliderDestroyed(c, point);
    if (this.fx && point) this.fx.debris(point, SURFACE[c.mat] || 'wood', { count: 18, size: 0.4, spread: 2.4 });
    if (this.sfx && point) this.sfx.play(c.kind === 'tree' ? 'tree_fall' : 'building_collapse', { x: point.x, y: point.y, z: point.z, volume: 0.7 });
  }

  /**
   * One trigger pull. `origin` is the aim-ray start (camera-aligned for the
   * player, eye for bots); tracers start at the shooter's muzzle when known.
   */
  fireWeapon(shooter, weaponItem, origin, dir, spread = 0, opts = null) {
    if (shooter) shooter.shotAt = performance.now() / 1000; // gunfire is heard (bots third-party it)
    this._shooter = shooter || null; // for car damage credit (_resolveHit)
    const dirs = opts && opts.dirs;
    const claims = opts && opts.claims;
    const w = weaponStats(weaponItem && WEAPONS[weaponItem.id] ? weaponItem.id : 'pistol', weaponItem && weaponItem.rarity);
    const scale = shooter && shooter.damageScale != null ? shooter.damageScale : 1;
    const results = this._hits;
    results.length = 0;
    const out = [];

    // muzzle for tracers / flash
    if (shooter && shooter.character && shooter.character.muzzle) shooter.character.muzzle(_from);
    else _from.copy(origin);
    if (this.fx) this.fx.muzzleFlash(_from, dir, { scale: w.kind === 'shotgun' ? 1.4 : 1 });
    if (this.sfx) this.sfx.play(w.sound, { x: _from.x, y: _from.y, z: _from.z, volume: w.soundVolume });

    // launchers fire a projectile; the blast does the damage (game/Grenades.js)
    if (w.projectile) {
      _dir.copy(dirs ? dirs[0] : dir).normalize();
      this.lastDirs = [_dir.clone()];
      if (this.authoritative && this.launchProjectile) this.launchProjectile(shooter, w, _from, origin, _dir); // (was an undefined `auth`: firing a launcher threw)
      return out;
    }

    const actorDamage = new Map();
    const pellets = dirs ? dirs.length : w.pellets || 1;
    const used = (this.lastDirs = []);
    const spawned = (this.lastProjectiles = []);
    for (let p = 0; p < pellets; p++) {
      if (dirs) _dir.copy(dirs[p]).normalize();
      else _dir.copy(dir).normalize();
      const s = dirs ? 0 : spread;
      if (s > 0) {
        // uniform-ish cone around dir
        _tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        _a.crossVectors(_dir, _tmp).normalize();
        const ang = Math.sqrt(Math.random()) * s;
        _dir.applyAxisAngle(_a, ang);
      }
      used.push(_dir.clone());
      if (w.ballistic) {
        // sniper rounds fly: travel time + bullet drop, resolved in tickProjectiles()
        spawned.push(this.spawnProjectile(shooter, w, scale, origin, _dir, _from, opts && opts.shot));
        continue;
      }
      let res = this._trace(shooter, origin, _dir, w.range);
      const claim = claims && claims[p];
      if (claim && !res.actor && claim !== shooter && claim.alive && !claim.inBus && !(this.teamMode && sameTeam(claim, shooter))) {
        const t = this._claimT(origin, _dir, claim, res.t);
        if (t != null) res = { t, actor: claim, hit: null };
      }
      const dist = res.t;
      _pt.set(origin.x + _dir.x * dist, origin.y + _dir.y * dist, origin.z + _dir.z * dist);
      const record = this._resolveHit(w, scale, _dir, dist, res, actorDamage, p === 0);
      if (this.fx && (p === 0 || pellets <= 3 || p % 3 === 0)) this.fx.tracer(_from, _pt, { color: w.tracer, width: w.kind === 'sniper' ? 0.08 : 0.05 });
      out.push(record);
    }

    if (this.sfx && actorDamage.size) {
      const first = actorDamage.values().next().value;
      this.sfx.play('bullet_impact', { x: first.point.x, y: first.point.y, z: first.point.z, volume: 0.6, surface: 'body' });
    }
    if (w.pump && this.sfx) {
      const sfx = this.sfx;
      const x = _from.x, y = _from.y, z = _from.z;
      setTimeout(() => sfx.play('shotgun_pump', { x, y, z, volume: 0.7 }), 350);
    }
    this._applyActorDamage(shooter, w, actorDamage);
    if (this.onFire) this.onFire(shooter, w.id, origin, out, used, !!w.ballistic);
    if (w.burst > 1 && !dirs && !(opts && opts.burstRound)) this._scheduleBurst(shooter, weaponItem, origin, dir, spread, w);
    return out;
  }

  /**
   * One pellet / bullet that ended at `_pt` after `dist` m (`res` from _trace). Plays the impact,
   * damages a built piece or harvestable (authoritative only) and adds actor hits to
   * `actorDamage`. Returns the shot record.
   */
  _resolveHit(w, scale, dir, dist, res, actorDamage, sound) {
    let fall = 1;
    if (dist > w.falloffStart) fall = dist >= w.falloffEnd ? w.minFalloff : lerp(1, w.minFalloff, (dist - w.falloffStart) / Math.max(1, w.falloffEnd - w.falloffStart));
    let dmg = w.damage * fall * scale;

    const record = { hitActor: null, point: _pt.clone(), headshot: false, surface: 'none' };
    if (res.actor) {
      const a = res.actor;
      const head = _pt.y > a.pos.y + (a.downed ? a.height * 0.45 : a.crouching ? a.height * 0.7 : a.height) * 0.8;
      record.hitActor = a;
      record.headshot = head;
      record.surface = a.shield > 0 ? 'shield' : 'body';
      if (head) dmg *= w.headMult;
      const prev = actorDamage.get(a) || { dmg: 0, head: false, point: record.point };
      prev.dmg += dmg;
      prev.head = prev.head || head;
      actorDamage.set(a, prev);
      if (this.fx) {
        _n.copy(dir).multiplyScalar(-1);
        this.fx.impact(_pt, _n, a.shield > 0 ? 'shield' : 'body');
      }
    } else if (res.hit) {
      _n.set(res.hit.nx, res.hit.ny, res.hit.nz);
      record.surface = res.surface;
      if (this.fx) this.fx.impact(_pt, _n, res.surface);
      const c = res.hit.collider;
      if (!this.authoritative) {
        // client: effects only, the host applies damage
      } else if (res.hit.kind === 'car' && this.vehicles) {
        this.vehicles.damage(res.hit.car, dmg, { source: this._shooter || null, weapon: w.id }, res.hit.part, res.hit.idx);
      } else if (c && res.hit.kind === 'piece' && this.structures) {
        this.structures.damage(c, dmg, _pt);
      } else if (res.hit.panel) {
        this.damagePanel(c, res.hit.panel, dmg * BUILDING_WALL.bulletMult, _pt); // no mats from bullets
      } else if (this._isHarvestable(c) || this._isBreakable(c)) {
        c.hp -= dmg;
        if (c.hp <= 0) this._destroyCollider(c, _pt);
      }
      if (this.sfx && sound) this.sfx.play('bullet_impact', { x: _pt.x, y: _pt.y, z: _pt.z, volume: 0.6, surface: impactSound(res.surface) });
    }
    return record;
  }

  _applyActorDamage(shooter, w, actorDamage) {
    if (!this.authoritative) return;
    for (const [a, d] of actorDamage) {
      this.applyDamage(a, d.dmg, { source: shooter, headshot: d.head, weapon: w.id, point: d.point });
    }
  }

  // ---------------------------------------------------------------- projectiles (ballistic guns)
  //
  // A ballistic round starts at the aim origin with velocity dir * speed and falls with its own
  // gravity. Each frame tickProjectiles() traces the segment it covers (world + actors) and
  // resolves the first hit exactly like a hitscan pellet. The visible streak starts at the
  // muzzle and blends onto the true path over the first BLEND_M metres.
  //
  // Multiplayer: `netSeq` tags a guest's round on both ends. The guest's own (visual) round
  // calls onProjectileHit(pj, actor) when it reaches someone; the host then calls
  // claimProjectile(shooter, netSeq, actor), accepted only when the host round's path passed
  // within CLAIM_TOL of that actor (the same lag allowance hitscan claims get).

  /** Starts one round. `from` = muzzle for the streak. Returns the projectile. */
  spawnProjectile(shooter, w, scale, origin, dir, from, netSeq) {
    const b = w.ballistic;
    const pj = {
      shooter: shooter || null,
      w,
      scale,
      pos: origin.clone(),
      vel: dir.clone().normalize().multiplyScalar(b.speed),
      travelled: 0,
      off: (from || origin).clone().sub(origin),
      vis: (from || origin).clone(),
      netSeq: netSeq || 0,
      claim: null,
      path: netSeq ? [origin.clone()] : null,
    };
    this.projectiles.push(pj);
    return pj;
  }

  /** Advances every round in flight; call once per frame (host, solo and clients). */
  tickProjectiles(dt) {
    if (this._spent.length) {
      const now = performance.now();
      this._spent = this._spent.filter((s) => s.until > now);
    }
    if (!this.projectiles.length || !(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pj = this.projectiles[i];
      const g = pj.w.ballistic.gravity;
      _a.copy(pj.pos);
      _b.set(pj.pos.x + pj.vel.x * dt, pj.pos.y + pj.vel.y * dt - 0.5 * g * dt * dt, pj.pos.z + pj.vel.z * dt);
      pj.vel.y -= g * dt;
      _dir.subVectors(_b, _a);
      let seg = _dir.length();
      if (seg < 1e-6) continue;
      _dir.multiplyScalar(1 / seg);
      seg = Math.min(seg, Math.max(0.01, pj.w.range - pj.travelled));
      let res = this._trace(pj.shooter, _a, _dir, seg);
      if (!res.actor && pj.claim && this._claimable(pj.claim, pj.shooter)) {
        const t = this._claimT(_a, _dir, pj.claim, res.hit ? res.t : seg);
        if (t != null && t <= seg) res = { t, actor: pj.claim, hit: null };
      }
      const ended = !!(res.actor || res.hit);
      const t = ended ? res.t : seg;
      _pt.copy(_a).addScaledVector(_dir, t);
      // streak: muzzle offset fades out over the first metres
      const k = Math.max(0, 1 - (pj.travelled + t) / BLEND_M);
      _tmp.copy(_pt).addScaledVector(pj.off, k);
      if (this.fx) this.fx.tracer(pj.vis, _tmp, { color: pj.w.tracer, width: 0.08, speed: pj.w.ballistic.speed });
      pj.vis.copy(_tmp);
      pj.travelled += t;
      if (pj.path) pj.path.push(_pt.clone());
      if (ended) {
        const actorDamage = new Map();
        this._shooter = pj.shooter;
        const record = this._resolveHit(pj.w, pj.scale, _dir, pj.travelled, res, actorDamage, true);
        if (this.sfx && actorDamage.size) this.sfx.play('bullet_impact', { x: _pt.x, y: _pt.y, z: _pt.z, volume: 0.6, surface: 'body' });
        this._applyActorDamage(pj.shooter, pj.w, actorDamage);
        if (record.hitActor && this.onProjectileHit) this.onProjectileHit(pj, record.hitActor);
        this._endProjectile(i, pj, !!record.hitActor);
      } else if (pj.travelled >= pj.w.range - 0.01) {
        this._endProjectile(i, pj, false);
      } else {
        pj.pos.copy(_b);
      }
    }
  }

  _endProjectile(i, pj, hitActor) {
    this.projectiles.splice(i, 1);
    // host: a guest's round that missed here may still be claimed for a short while
    if (this.authoritative && pj.netSeq && !hitActor && !pj.claimed) {
      this._spent.push({ shooter: pj.shooter, netSeq: pj.netSeq, w: pj.w, scale: pj.scale, path: pj.path, until: performance.now() + CLAIM_LATE_MS });
    }
  }

  _claimable(a, shooter) {
    return !!a && a !== shooter && a.alive && !a.inBus && !(this.teamMode && sameTeam(a, shooter));
  }

  /**
   * Host: a guest says its round `netSeq` hit `actor`. In flight -> the round now also counts
   * passing near that actor; already landed -> checked against the recorded path. Each round
   * can be claimed once.
   */
  claimProjectile(shooter, netSeq, actor) {
    if (!this.authoritative || !netSeq || !this._claimable(actor, shooter)) return false;
    const live = this.projectiles.find((p) => p.shooter === shooter && p.netSeq === netSeq);
    if (live) {
      if (live.claimed) return false;
      live.claimed = true;
      live.claim = actor;
      return true;
    }
    const k = this._spent.findIndex((s) => s.shooter === shooter && s.netSeq === netSeq);
    if (k < 0) return false;
    const sp = this._spent[k];
    this._spent.splice(k, 1);
    let travelled = 0;
    for (let j = 1; j < sp.path.length; j++) {
      const a = sp.path[j - 1];
      _dir.subVectors(sp.path[j], a);
      const len = _dir.length();
      if (len < 1e-6) continue;
      _dir.multiplyScalar(1 / len);
      const t = this._claimT(a, _dir, actor, len);
      if (t != null && t <= len) {
        _pt.copy(a).addScaledVector(_dir, t);
        const actorDamage = new Map();
        this._resolveHit(sp.w, sp.scale, _dir, travelled + t, { t, actor, hit: null }, actorDamage, true);
        this._applyActorDamage(shooter, sp.w, actorDamage);
        return true;
      }
      travelled += len;
    }
    return false;
  }

  /** Drops every round in flight (match end / restart). */
  clearProjectiles() {
    this.projectiles.length = 0;
    this._spent.length = 0;
  }

  /**
   * Drops the pending rounds of `shooter`'s burst (reload start, weapon swap, heal). Players
   * are also covered by the reloadT / current-item checks in _scheduleBurst; bots keep their
   * reload timer on the brain, so Bots calls this.
   */
  cancelBurst(shooter) {
    if (shooter) shooter._burstGen = (shooter._burstGen || 0) + 1;
  }

  /** Queues the remaining rounds of a burst gun's trigger pull. */
  _scheduleBurst(shooter, item, origin, dir, spread, w) {
    const epoch = this._burstEpoch;
    const gen = shooter ? shooter._burstGen || 0 : 0;
    const o0 = origin.clone();
    const d0 = dir.clone();
    const delay = Math.max(0.02, w.burstDelay || 0.08) * 1000;
    let left = w.burst - 1;
    const next = () => {
      if (epoch !== this._burstEpoch || !shooter || shooter.alive === false || !(item.mag > 0)) return;
      if ((shooter._burstGen || 0) !== gen) return; // cancelBurst(): reload / swap / heal since the trigger pull
      if (shooter.reloadT > 0 || shooter.reloading > 0 || shooter.buildPiece) return;
      const inv = shooter.inventory;
      if (inv && inv.current && inv.current() !== item) return;
      item.mag--;
      left--;
      const o = shooter.aimOrigin || o0;
      const d = shooter.aimDir || d0;
      const s = shooter.computeSpread ? shooter.computeSpread() : spread;
      if (shooter.character && shooter.character.fire) shooter.character.fire();
      const res = this.fireWeapon(shooter, item, o, d, s, { burstRound: true });
      if (this.onBurstShot) this.onBurstShot(shooter, item, o, this.lastDirs, res);
      if (left > 0) setTimeout(next, delay);
    };
    setTimeout(next, delay);
  }

  /** Distance along the ray at which it passes within CLAIM_TOL of `a`'s body axis (before `maxT`), or null. */
  _claimT(origin, dir, a, maxT) {
    const cx = a.pos.x - origin.x;
    const cy = a.pos.y + (a.height || PLAYER.height) * 0.5 - origin.y;
    const cz = a.pos.z - origin.z;
    const t = cx * dir.x + cy * dir.y + cz * dir.z;
    if (!(t > 0) || t > maxT + 1) return null;
    const px = origin.x + dir.x * t - a.pos.x;
    const pz = origin.z + dir.z * t - a.pos.z;
    const py = origin.y + dir.y * t;
    if (Math.hypot(px, pz) > (a.radius || PLAYER.radius) + CLAIM_TOL) return null;
    if (py < a.pos.y - 0.5 || py > a.pos.y + (a.height || PLAYER.height) + 0.6) return null;
    return Math.min(t, maxT);
  }

  /** Nearest of world geometry vs actors along a ray. */
  _trace(shooter, origin, dir, range) {
    const hit = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range, null);
    let t = hit ? hit.t : range;
    let copy = hit ? { t: hit.t, nx: hit.nx, ny: hit.ny, nz: hit.nz, collider: hit.collider, kind: hit.kind, panel: this._panelOf(hit) } : null;
    // drivable cars (Vehicles): glass stops a shot until it breaks; the body always does
    const ch = this.vehicles ? this.vehicles.ray(origin, dir, t, shooter) : null;
    if (ch) {
      t = ch.t;
      copy = { t: ch.t, nx: ch.nx, ny: ch.ny, nz: ch.nz, collider: null, kind: 'car', car: ch.car, part: ch.part, idx: ch.idx, panel: null };
    }
    const ah = this.rayActors(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, t, shooter);
    const smokeT = this.grenades && this.grenades.blockT ? this.grenades.blockT(origin, dir, t) : null;
    if (smokeT != null && smokeT < t && (!ah || smokeT < ah.t)) {
      return { t: smokeT, actor: null, hit: { t: smokeT, nx: -dir.x, ny: -dir.y, nz: -dir.z, collider: null, kind: 'smoke' }, surface: 'none' };
    }
    if (ah) return { t: ah.t, actor: ah.actor, hit: null };
    return { t, actor: null, hit: copy, surface: this._surfaceOf(copy) };
  }

  /**
   * Pickaxe swing: hits an actor in reach, else a built piece, else the
   * nearest harvestable (forgiving probe). Returns what happened.
   */
  swingPickaxe(shooter, origin, dir) {
    const out = {};
    const range = PICKAXE.range + 1.2;
    _dir.copy(dir).normalize();
    if (this.sfx) this.sfx.play('swing', { x: origin.x, y: origin.y, z: origin.z, volume: 0.6 });

    const hit = this.world.raycast(origin.x, origin.y, origin.z, _dir.x, _dir.y, _dir.z, range, null);
    const tWorld = hit ? hit.t : range;
    const hitCopy = hit ? { t: hit.t, x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, collider: hit.collider, kind: hit.kind, panel: this._panelOf(hit) } : null;
    const ah = this.rayActors(origin.x, origin.y, origin.z, _dir.x, _dir.y, _dir.z, tWorld, shooter);
    if (ah) {
      _pt.copy(origin).addScaledVector(_dir, ah.t);
      if (this.authoritative) this.applyDamage(ah.actor, PICKAXE.damage * (shooter && shooter.damageScale != null ? shooter.damageScale : 1), { source: shooter, weapon: 'pickaxe', point: _pt.clone() });
      if (this.fx) this.fx.impact(_pt, _n.copy(_dir).negate(), 'body');
      out.hitActor = ah.actor;
      return out;
    }

    // a drivable car in reach: dents it (glass first), no materials
    const carHit = this.vehicles ? this.vehicles.ray(origin, _dir, hitCopy ? hitCopy.t : range, shooter) : null;
    if (carHit) {
      _pt.copy(origin).addScaledVector(_dir, carHit.t);
      if (this.authoritative) this.vehicles.damage(carHit.car, CAR.pickaxeDamage, { source: shooter, weapon: 'pickaxe' }, carHit.part, carHit.idx);
      if (this.fx) this.fx.impact(_pt, _n.set(carHit.nx, carHit.ny, carHit.nz), carHit.part === 'window' ? 'glass' : 'metal');
      if (this.sfx) this.sfx.play('hit_metal', { x: _pt.x, y: _pt.y, z: _pt.z });
      out.car = carHit.car;
      return out;
    }

    let c = hitCopy && hitCopy.collider;
    let point = hitCopy ? _pt.set(hitCopy.x, hitCopy.y, hitCopy.z) : null;
    if (c && hitCopy.kind === 'piece' && this.structures) {
      if (this.authoritative) this.structures.damage(c, PICKAXE.harvest, point);
      if (this.fx) this.fx.harvestHit(point, c.mat || 'wood', false);
      if (this.sfx) this.sfx.play(HARVEST_SOUND[c.mat] || 'hit_wood', { x: point.x, y: point.y, z: point.z });
      out.piece = c;
      return out;
    }
    if (hitCopy && hitCopy.panel) return this._swingPanel(shooter, c, hitCopy.panel, point, out);
    if (this._isBreakable(c)) {
      // glass: the pickaxe smashes it (no materials)
      if (this.fx) this.fx.impact(point, _n.set(hitCopy.nx, hitCopy.ny, hitCopy.nz), 'metal');
      if (this.sfx) this.sfx.play('bullet_impact', { x: point.x, y: point.y, z: point.z, volume: 0.7, surface: 'metal' });
      out.collider = c;
      out.point = point.clone();
      if (!this.authoritative) return out;
      c.hp -= PICKAXE.harvest;
      if (c.hp <= 0) {
        out.destroyed = true;
        this._destroyCollider(c, point);
      }
      return out;
    }
    if (!this._isHarvestable(c)) {
      // forgiving probe for trees / rocks / props near the swing
      const probe = this.world.probeCircle(origin.x, origin.z, _dir.x, _dir.z, PICKAXE.range, 0.6);
      if (probe && this._isHarvestable(probe) && probe.h > shooter.pos.y - 0.5 && probe.h > 0.2) {
        c = probe;
        const dx = probe.x - origin.x;
        const dz = probe.z - origin.z;
        const d = Math.hypot(dx, dz) || 1;
        point = _pt.set(probe.x - (dx / d) * probe.r, Math.min(origin.y, probe.h * 0.5 + shooter.pos.y * 0.5), probe.z - (dz / d) * probe.r);
      } else c = null;
    }
    if (!c) {
      if (hitCopy && this.fx) this.fx.impact(_pt.set(hitCopy.x, hitCopy.y, hitCopy.z), _n.set(hitCopy.nx, hitCopy.ny, hitCopy.nz), this._surfaceOf(hitCopy));
      return out;
    }
    const mat = c.mat === 'brick' || c.mat === 'metal' ? c.mat : 'wood';
    if (!this.authoritative) {
      // client: predicted harvest for feedback only; the host owns hp and mats
      out.harvested = { mat, count: PICKAXE.yield[mat] };
      out.collider = c;
      out.point = point.clone();
      out.predicted = true;
      if (this.fx) this.fx.harvestHit(point, mat, false);
      if (this.sfx) this.sfx.play(HARVEST_SOUND[mat], { x: point.x, y: point.y, z: point.z });
      return out;
    }
    c.hp -= PICKAXE.harvest;
    const count = PICKAXE.yield[mat];
    out.harvested = { mat, count };
    out.collider = c;
    out.point = point.clone();
    if (this.fx) this.fx.harvestHit(point, mat, false);
    if (this.sfx) this.sfx.play(HARVEST_SOUND[mat], { x: point.x, y: point.y, z: point.z });
    if (c.hp <= 0) {
      out.destroyed = true;
      this._destroyCollider(c, point);
    }
    if (this.onHarvest) this.onHarvest(shooter, c, out);
    return out;
  }

  /** Pickaxe hit on a building wall panel: harvested like a tree (PICKAXE.harvest hp, PICKAXE.yield mats). */
  _swingPanel(shooter, c, pn, point, out) {
    const mat = pn.mat === 'brick' || pn.mat === 'metal' ? pn.mat : 'wood';
    out.harvested = { mat, count: PICKAXE.yield[mat] };
    out.collider = pn; // { hp, maxHp, alive }: what the HUD object bar reads
    out.building = c;
    out.panel = pn;
    out.point = point.clone();
    if (this.fx) this.fx.harvestHit(point, mat, false);
    if (this.sfx) this.sfx.play(HARVEST_SOUND[mat], { x: point.x, y: point.y, z: point.z });
    if (!this.authoritative) {
      out.predicted = true; // client: feedback only; the host owns panel hp and mats
      return out;
    }
    if (this.damagePanel(c, pn, PICKAXE.harvest, point, shooter)) out.destroyed = true;
    if (this.onHarvest) this.onHarvest(shooter, pn, out);
    return out;
  }

  /**
   * Shield first (unless storm), then health. Eliminates at 0 health, or knocks in a team
   * mode while a teammate is still standing. A downed target takes damage on its downHp.
   */
  applyDamage(target, amount, info = {}) {
    if (!target || !target.alive || !(amount > 0)) return 0;
    if (target.invulnerable) return 0;
    const src = info.source;
    if (src && src !== target && this.teamMode && sameTeam(src, target)) return 0; // no friendly fire
    if (target.revivingTarget) this.stopRevive(target); // hurt while reviving: cancelled
    if (target.downed) {
      if (target.reviver) this.stopRevive(target.reviver);
      const dealt = Math.min(target.downHp, amount);
      target.downHp = Math.max(0, target.downHp - amount);
      target.lastHitTime = performance.now();
      this._creditDamage(src, target, dealt);
      if (this.onDamage) this.onDamage(target, dealt, { ...info, shieldHit: 0, downed: true });
      if (target.downHp <= 0 && target.alive) this._eliminate(target, { ...info, source: src || target.knockedBy || null, finished: true });
      return dealt;
    }
    let left = amount;
    let shieldHit = 0;
    if (!info.storm && target.shield > 0) {
      shieldHit = Math.min(target.shield, left);
      target.shield -= shieldHit;
      left -= shieldHit;
      if (target.shield <= 0 && shieldHit > 0) {
        target.shield = 0;
        if (this.fx) this.fx.shieldPop(_b.copy(target.pos).setY(target.pos.y + 1.2));
        if (this.sfx) this.sfx.play('shield_break', { x: target.pos.x, y: target.pos.y + 1, z: target.pos.z });
      }
    }
    const hpBefore = target.health;
    target.health = Math.max(0, target.health - left);
    target.lastHitTime = performance.now();
    this._creditDamage(src, target, shieldHit + (hpBefore - target.health));
    target.lastAttacker = info.source || target.lastAttacker || null;
    const dealt = shieldHit + Math.min(left, amount);
    if (this.onDamage) this.onDamage(target, dealt, { ...info, shieldHit });
    if (target.health <= 0 && target.alive) {
      if (this._canKnock(target, info)) this._knock(target, info);
      else this._eliminate(target, info);
    }
    return dealt;
  }

  /** Damage stats: `src` dealt `n` real damage to another player (not themself / a teammate). */
  _creditDamage(src, target, n) {
    if (!src || src === target || !(n > 0) || sameTeam(src, target)) return;
    src.damageDealt = (src.damageDealt || 0) + n;
    if (!target.dmgFrom) target.dmgFrom = new Map();
    target.dmgFrom.set(src, (target.dmgFrom.get(src) || 0) + n);
    if (this.onStats) this.onStats(src);
  }

  /** Team mode, not leaving, and someone else on the team is still on their feet. */
  _canKnock(target, info) {
    return this.teamMode && !info.left && !target.inBus && teamStanding(this.actors, target.team, target);
  }

  _knock(victim, info) {
    const by = info.source && info.source !== victim ? info.source : null;
    victim.downed = true;
    victim.downHp = KNOCK.downHp;
    victim.health = 0;
    victim.shield = 0;
    victim.knockedBy = by;
    victim.reviveT = 0;
    victim.reviver = null;
    if (victim.revivingTarget) this.stopRevive(victim);
    if (victim.carrying) this.stopCarry(victim);
    if (this.sfx) this.sfx.play('shield_break', { x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z, volume: 0.8 });
    if (this.onKnock) this.onKnock(victim, by, info);
  }

  _eliminate(victim, info) {
    const wasDowned = !!victim.downed;
    victim.alive = false;
    victim.health = 0;
    victim.shield = 0;
    victim.downed = false;
    victim.downHp = 0;
    if (victim.reviver) this.stopRevive(victim.reviver);
    if (victim.revivingTarget) this.stopRevive(victim);
    if (victim.carrying) this.stopCarry(victim);
    if (victim.carriedBy) this.stopCarry(victim.carriedBy);
    // the elimination goes to whoever KNOCKED them, not whoever finished them off
    let killer = info.source && info.source !== victim ? info.source : null;
    const knocker = wasDowned && victim.knockedBy && victim.knockedBy !== victim ? victim.knockedBy : null;
    if (knocker && !sameTeam(knocker, victim)) killer = knocker;
    if (killer && sameTeam(killer, victim)) killer = null;
    if (killer) {
      killer.kills = (killer.kills || 0) + 1;
      if (this.onStats) this.onStats(killer);
    }
    info = { ...info, finisher: info.source && info.source !== killer && info.source !== victim ? info.source : null };
    // assists: everyone else who did ASSIST_DAMAGE+ to them
    if (victim.dmgFrom) {
      for (const [a, d] of victim.dmgFrom) {
        if (a === killer || a === victim || !a || d < ASSIST_DAMAGE || sameTeam(a, victim)) continue;
        a.assists = (a.assists || 0) + 1;
        if (this.onAssist) this.onAssist(a, victim);
        if (this.onStats) this.onStats(a);
      }
      victim.dmgFrom = null;
    }
    if (killer && this.authoritative !== false) this.siphon(killer);
    if (victim.character) {
      if (victim.character.setDowned) victim.character.setDowned(false);
      victim.character.die();
    }
    if (this.fx) this.fx.elimination(victim.pos, killer && killer.isPlayer ? 0xffc21f : 0xa66bff);
    if (this.sfx) this.sfx.play(victim.isPlayer ? 'death' : 'elimination', { x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z });
    if (this.onEliminate) this.onEliminate(victim, killer, { ...info, wasDowned });
    // team wipe: nobody left standing, so every knocked teammate goes too (credited to whoever knocked them)
    if (this.teamMode && !teamStanding(this.actors, victim.team)) {
      for (const a of this.actors.slice()) {
        if (a.alive && a.downed && a.team === victim.team) this._eliminate(a, { source: a.knockedBy || null, wipe: true, weapon: 'wipe' });
      }
    }
  }

  /**
   * Siphon: +SIPHON for an elimination, health first (to max), the remainder as shield.
   * Returns { hp, shield } actually gained (0s for a knocked / dead killer or a full one).
   */
  siphon(killer, amount = SIPHON) {
    const out = { hp: 0, shield: 0 };
    if (!killer || !killer.alive || killer.downed || !(amount > 0)) return out;
    const maxH = PLAYER.maxHealth;
    const maxS = PLAYER.maxShield;
    out.hp = Math.max(0, Math.min(amount, maxH - (killer.health || 0)));
    out.shield = Math.max(0, Math.min(amount - out.hp, maxS - (killer.shield || 0)));
    killer.health = (killer.health || 0) + out.hp;
    killer.shield = (killer.shield || 0) + out.shield;
    if ((out.hp || out.shield) && this.fx && this.fx.aura) this.fx.aura(killer.pos, out.shield > 0 ? 'shield' : 'heal', 1);
    if (this.onSiphon && (out.hp || out.shield)) this.onSiphon(killer, out);
    return out;
  }

  /** `reviver` stops reviving (moved away, hurt, let go, or done). */
  stopRevive(reviver) {
    const t = reviver && reviver.revivingTarget;
    if (reviver) reviver.revivingTarget = null;
    if (t && t.reviver === reviver) {
      t.reviver = null;
      t.reviveT = 0;
    }
  }

  /** Brings a downed actor back up. */
  revive(target, by = null) {
    if (!target || !target.alive || !target.downed) return false;
    if (target.carriedBy) this.stopCarry(target.carriedBy);
    target.downed = false;
    target.downHp = 0;
    target.health = KNOCK.reviveHp;
    target.shield = 0;
    target.knockedBy = null;
    target.reviveT = 0;
    if (by && by.revivingTarget === target) by.revivingTarget = null;
    target.reviver = null;
    if (target.character && target.character.setDowned) target.character.setDowned(false);
    if (this.fx && this.fx.aura) this.fx.aura(target.pos, 'heal', 1.2);
    if (this.onRevive) this.onRevive(target, by);
    return true;
  }

  // ---------------------------------------------------------------- carrying

  /** Can `carrier` pick up `target` right now (range, team, nobody else holding them)? */
  canCarry(carrier, target) {
    if (!this.teamMode || !carrier || !target || carrier === target) return false;
    if (!carrier.alive || carrier.downed || carrier.carrying || carrier.inBus || carrier.airborneDrop) return false;
    if (!target.alive || !target.downed || target.carriedBy || !sameTeam(carrier, target)) return false;
    const dx = target.pos.x - carrier.pos.x;
    const dz = target.pos.z - carrier.pos.z;
    return dx * dx + dz * dz <= (KNOCK.reviveRange + 0.6) ** 2 && Math.abs(target.pos.y - carrier.pos.y) < 2.5;
  }

  /** Authoritative: `carrier` throws a knocked teammate over their shoulder. */
  startCarry(carrier, target) {
    if (!this.canCarry(carrier, target)) return false;
    if (carrier.revivingTarget) this.stopRevive(carrier);
    if (target.reviver) this.stopRevive(target.reviver);
    carrier.carrying = target;
    target.carriedBy = carrier;
    if (this.sfx) this.sfx.play('pickup', { x: carrier.pos.x, y: carrier.pos.y + 1, z: carrier.pos.z, volume: 0.6 });
    if (this.onCarry) this.onCarry(carrier, target);
    return true;
  }

  /** Authoritative: `carrier` puts down whoever they hold, just in front of them. */
  stopCarry(carrier) {
    const t = carrier && carrier.carrying;
    if (!carrier) return;
    carrier.carrying = null;
    if (!t) return;
    if (t.carriedBy === carrier) t.carriedBy = null;
    if (t.alive) {
      const h = carrier.heading || 0;
      t.pos.set(carrier.pos.x + Math.sin(h) * 0.9, carrier.pos.y, carrier.pos.z - Math.cos(h) * 0.9);
      if (this.world && this.world.resolveCircle) this.world.resolveCircle(t.pos, 0.35, 1);
      if (this.world && this.world.groundHeight) t.pos.y = this.world.groundHeight(t.pos.x, t.pos.z, carrier.pos.y + 0.5);
      if (t.vel) t.vel.set(0, 0, 0);
    }
    if (this.onCarry) this.onCarry(carrier, null, t);
  }

  /**
   * Authoritative, once per frame after everyone has moved: carried actors ride on their
   * carrier's shoulder; a carrier who goes down / dies (or a target that got up) lets go.
   */
  tickCarry() {
    if (!this.teamMode) return;
    for (const a of this.actors) {
      const t = a.carrying;
      if (!t) continue;
      if (!a.alive || a.downed || !t.alive || !t.downed || t.carriedBy !== a) {
        this.stopCarry(a);
        continue;
      }
      placeOnShoulder(t, a);
    }
  }

  /** Authoritative team upkeep: revive progress, then bleed-out. */
  tickTeams(dt) {
    if (!this.teamMode || !(dt > 0)) return;
    const range2 = (KNOCK.reviveRange + 0.4) ** 2;
    for (const a of this.actors) {
      const t = a.revivingTarget;
      if (!t) continue;
      const dx = t.pos.x - a.pos.x;
      const dz = t.pos.z - a.pos.z;
      const ok = a.alive && !a.downed && !a.carrying && t.alive && t.downed && !t.carriedBy && sameTeam(a, t) && dx * dx + dz * dz <= range2 && Math.abs(t.pos.y - a.pos.y) < 2.5 && (!t.reviver || t.reviver === a);
      if (!ok) {
        if (t.reviver === a) this.stopRevive(a);
        else a.revivingTarget = null;
        continue;
      }
      t.reviver = a;
      t.reviveT = (t.reviveT || 0) + dt;
      if (t.reviveT >= KNOCK.reviveTime) this.revive(t, a);
    }
    for (const a of this.actors.slice()) {
      if (!a.alive || !a.downed) continue;
      if (a.reviver && a.reviver.revivingTarget === a) continue; // no bleeding while being revived
      if (a.reviver) {
        a.reviver = null;
        a.reviveT = 0;
      }
      a.downHp -= KNOCK.bleed * dt;
      if (a.downHp <= 0) this._eliminate(a, { source: a.knockedBy || null, bleed: true, weapon: 'bleed' });
    }
  }
}

/** Puts a carried actor on its carrier's shoulder (also used by clients for their own view). */
export function placeOnShoulder(t, carrier) {
  const h = carrier.heading || 0;
  t.pos.set(carrier.pos.x - Math.sin(h) * 0.15, carrier.pos.y + 1.05, carrier.pos.z + Math.cos(h) * 0.15);
  if (t.vel) t.vel.set(0, 0, 0);
  t.heading = h + Math.PI / 2;
}

/** Effects surface name -> Sfx bullet_impact surface. */
function impactSound(s) {
  if (s === 'body' || s === 'shield') return 'body';
  if (s === 'wood' || s === 'metal' || s === 'brick') return s;
  if (s === 'dirt' || s === 'stone' || s === 'rock') return 'stone';
  return 'stone';
}

export { rayActor, impactSound };
