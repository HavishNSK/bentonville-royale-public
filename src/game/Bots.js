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
// opts.bus (a DropBus route): every bot rides the Drop Bus (inBus, hidden, untargetable)
// and jumps where the bus passes closest to its landing spot; update() then reads the
// bus clock from ctx.busTime (falls back to the bots' own clock).
//
// Behaviour: glide in -> loot (Loot.near/open/take) -> wander / rotate toward the next
// storm circle (hurry when outside) -> engage targets seen via world.clearLine within
// DIFFICULTY.sight (reaction delay, per-burst aim drift, bursts, strafing, weapon by
// distance vs botRange, reloads, build responses) -> retreat and heal when hurt.
// Building scales with DIFFICULTY.buildPieces / buildCooldown / buildRate: a single wall
// (easy), wall + ramp (normal), up to ramp rushes toward high ground and 1x1 boxes (hard),
// queued and placed one piece at a time through structures.plan/place with real mats.
// Bots fight each other and the player alike. Unarmed bots only brawl at arm's length.
// Stuck bots jump, flip their wall-following side, then get an A* detour from a shared,
// time-sliced grid planner (PLAN_BUDGET expansions per frame).
// Enterable buildings: a goal on the other side of a building wall (loot / cover / a wander
// spot inside, or the way out) gets door waypoints (_doorRoute, every LOD tier); inside a
// building with an interior plan the route continues room to room through interior doors
// (and plan.stairs between storeys, _roomRoute) unless a straight walk is open (a broken
// panel). The A* grid samples only the thin walls / partitions, and exterior and ground-storey
// interior door cells are forced open; a door route that stalls hands over to A*.
// Bots only open / take loot on the same side of a wall; hurt bots heal / retreat indoors.
// Teams (combat.teamMode): opts.teams[i] is bot i's team (default: its own id). Bots never
// target or react to teammates; a knocked bot (actor.downed) crawls toward its nearest
// standing teammate; a bot with a knocked teammate and no enemy within KNOCK.botReviveClear m
// goes to it and revives it (state 'revive', actor.revivingTarget; Combat.tickTeams times it).
// Every collaborator except `world` may be null; the matching behaviour is skipped.
// With an empty `kits` array bots have no Character (headless, used by tests).
//
// Each bot thinks (perception, state choice, steering) at ~4-8 Hz on a staggered
// timer; movement, aiming, firing cadence, reloads and heals run every frame
// without allocating. Sim budget for big lobbies (see _lod): bots far from every human
// (and the camera) think 1.6-3x less often, run physics every 2nd / 4th frame in
// bounded sub-steps, cast fewer steering rays and skip A* detours; a bot fighting a
// human is always full rate. Characters beyond QUALITY[q].charDist are hidden and not
// animated; the skeleton updates every frame within 35 m, every 2nd frame to half the
// draw distance, every 3rd beyond; settled death poses are frozen.

import { stairWalk } from '../world/interiors/stairRouting.js';
import * as THREE from 'three';
import { Character } from './Character.js';
import { Inventory } from './Inventory.js';
import {
  PLAYER, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, RARITIES, DIFFICULTY, QUALITY,
  BOT_NAMES, DROP_ZONES, STORM, KNOCK, angleDelta, clamp, weaponStats,
} from '../core/config.js';
import { sameTeam } from './Teams.js';
import { busPosAt, jumpTimeFor } from './DropBus.js';
import { route as roomRoute } from '../world/Interiors.js';

const EYE = PLAYER.eyeHeight;
const _busPt = { x: 0, y: 0, z: 0 };
const CHEST = 1.2;
const TURN_RATE = 7; // rad/s
const FOV_COS = Math.cos(1.25); // ~72 degrees either side
const INTERACT = 2.0; // metres to open / take loot
const LOOT_SCAN = 70; // metres (chests sit ~100 m apart on average)
const MEMORY = 4; // seconds a lost target is chased
// box fighting (DIFFICULTY.boxFight): a full 1x1 box, edit peeks through the wall facing the target
const BOX_MEMORY = 10; // seconds a boxed bot keeps fighting a target it cannot see
const BOX_RANGE = 38; // metres: fights closer than this may be taken from a box
const BOX_LEAVE = 60; // metres: a target this far away ends the box fight
const CELL_HALF = BUILD.cell / 2;
const WINDOW = 1 << 4; // wall edit: middle tile (chest / eye height)
const DOOR = (1 << 1) | (1 << 4); // wall edit: bottom + middle of the centre column
const STUCK_WINDOW = 1.4;
const PLAN_BUDGET = 350; // A* expansions per frame (~0.3-0.6 ms)
const CANOPY_COLORS = [0x4fc3f7, 0xff7a45, 0x9ccc65, 0xba68c8, 0xffd54f, 0xf06292, 0x4db6ac, 0xa1887f];
const AVOID = [0, 0.55, -0.55, 1.1, -1.1, 1.65, -1.65, 2.3, -2.3, 3.0];
const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r, i]));
// sim budget (LOD by distance to the nearest human / the camera), see update()
const LOD_NEAR = 110; // metres: full think rate inside this
const LOD_FAR = 420; // metres: beyond this, physics every 4th frame instead of every 2nd
const LOD_RECHECK = 0.5; // seconds between a bot's LOD re-evaluations
const SIM_STEP_MAX = 0.05; // longest physics sub-step for time-sliced bots (no tunnelling)
const ANIM_FULL = 35; // metres: animate every frame inside this
const DEAD_ANIM = 3; // seconds a death animation plays before the pose is frozen
// building
const BUILD_Q = 10; // most queued pieces in one build response
const HEAR = 160; // metres: gunfire this close can draw a bot in (third party)
const BUILD_ROOM = 0.85; // bots stop starting builds past this share of BUILD.maxPieces
// enterable buildings (World collider.shell): door waypoints, see _doorRoute
const DOOR_OUT = 1.6; // metres in front of a door's outer face: the approach point
const DOOR_IN = 1.3; // metres behind the outer face: the step inside (wall is 0.4 m)
const DOOR_REACH = 0.8; // waypoint radius for door waypoints (others use WP_REACH)
const WP_REACH = 1.8;
const COVER_RANGE = 30; // metres: buildings this close are used for cover / healing
const INDOOR_WANDER = 0.3; // share of new wander goals placed inside a nearby building
const SHELL_CELL = 64; // metres: spatial hash cell for enterable buildings (Bots._shellGrid)
// interiors (shell.plan): room-graph routes through interior doors and stairs, see _roomRoute
const INNER_STEP = 0.9; // metres either side of an interior door's wall line: its two waypoints
const DOOR_STEPS = [INNER_STEP, 0.7, 0.55]; // fallbacks when that point is in a wall (_doorStep)
const STAIR_STEP = 1.0; // metres before a stair foot / beyond its landing: the approach points
const LEVEL_SLACK = 0.6; // metres: feet this far below a storey's floor still count as on it
const CLEAR_WALK = 30; // metres: a same-building goal closer than this is checked for a straight walk
const CLEAR_STEP = 0.6; // metres between clear-walk samples
const INDOOR_FEELER = 0.7; // steering feeler height above the feet indoors (partitions, furniture)
const OUTDOOR_FEELER = 0.95;

const _v = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pt = { x: 0, z: 0 };
const _route = []; // reused room-graph route (door indices)
const _anim = { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: 0, pitch: 0 };
const _cand = [null, null, null, null];
const _candD = [0, 0, 0, 0];
const _matItem = { type: 'material', mat: 'wood', count: 0 };
const _bpos = { x: 0, y: 0, z: 0 }; // synthetic "stand here" point passed to structures.plan
const _pl = {}; // reused placement


/**
 * Sniper rounds fly (Combat projectiles): aim ahead of a moving target and a little high for the
 * drop. `rel` = target - muzzle (edited in place); `skill` 0..1 scales the correction, so weaker
 * bots under-lead and miss more often. Two passes converge for any range a bot shoots at.
 */
function leadBallistic(rel, tgt, ballistic, skill) {
  if (!(skill > 0)) return;
  const vx = tgt.vel ? tgt.vel.x : 0;
  const vy = tgt.vel ? tgt.vel.y : 0;
  const vz = tgt.vel ? tgt.vel.z : 0;
  const bx = rel.x, by = rel.y, bz = rel.z;
  let t = Math.hypot(bx, by, bz) / ballistic.speed;
  for (let k = 0; k < 2; k++) {
    const px = bx + vx * t, py = by + vy * t, pz = bz + vz * t;
    t = Math.hypot(px, py, pz) / ballistic.speed;
  }
  rel.x = bx + vx * t * skill;
  rel.y = by + (vy * t + 0.5 * ballistic.gravity * t * t) * skill;
  rel.z = bz + vz * t * skill;
}

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
    this._eyes = []; // flat x,z of every live human (+ the camera): the sim budget centres
    this._frame = 0;
    this.lodStats = [0, 0, 0]; // bots per LOD tier at the last update (debug / QA)
    this.planner = new Planner(world);
    this.navStats = { doorRoutes: 0, indoorLoot: 0, plans: 0, cover: 0, lootLos: 0 };
    this._shellGrid = null; // Map: SHELL_CELL hash -> enterable building colliders (lazy)
    this._shellSrc = null; // the world.buildingInteriors() list _shellGrid was built from
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
    // fallback drop area centre: opts.center {x,z} or opts.storm (its first circle), else the origin
    const sc = opts.center || opts.storm || ctxStorm(this._storm);
    const points = this._dropTargets(count, rng, opts.dropPoints, sc);
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
        team: opts.teams && opts.teams[i] != null ? opts.teams[i] : idBase + i,
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
      if (opts.bus) {
        // Drop Bus: jump where the flight passes closest to the landing spot (+-0.6 s)
        const r = opts.bus;
        b.busRoute = r;
        b.launchAt = clamp(jumpTimeFor(r, t.x, t.z) + (rng() - 0.5) * 1.2, r.tOpen, r.tClose);
        actor.inBus = true;
      } else {
        b.launchAt = win > 0 ? (win * (order[i] + 0.15 + rng() * 0.7)) / count : 0;
        actor.inBus = b.launchAt > 0;
      }
      actor._bot = b;
      this.actors.push(actor);
      this.brains.push(b);
      if (this.combat) this.combat.register(actor);
    }
    return this.actors;
  }

  _dropTargets(count, rng, dropPoints, centre) {
    const ccx = centre && Number.isFinite(centre.cx ?? centre.x) ? (centre.cx ?? centre.x) : 0;
    const ccz = centre && Number.isFinite(centre.cz ?? centre.z) ? (centre.cz ?? centre.z) : 0;
    const cr = STORM.startRadius;
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
        if (l && Math.hypot(l.x - ccx, l.z - ccz) < cr * 0.85) anchors.push({ x: l.x, z: l.z, r: Math.min(l.r || 40, 120) + 50 });
      }
      if (!anchors.length) anchors.push({ x: ccx, z: ccz, r: cr * 0.5 });
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
        // anywhere inside the storm's first circle
        cx = ccx;
        cz = ccz;
        r = cr * 0.9;
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
    if (sameTeam(src, victim)) return;
    b.alertUntil = this.time + 5;
    if (src && src !== victim && src.alive && src.pos) {
      b.threat = src;
      b.thinkIn = Math.min(b.thinkIn, 0.05);
      if (!src.isBot) b.lodAt = 0; // a human is on it: back to full rate next frame
      this._wallOnHit(b, src);
    }
  }

  /**
   * Shot at: throw a wall between us and the shooter right away (a box when low), the
   * first thing a good player does. Skipped mid-build, mid-air, knocked or without mats.
   */
  _wallOnHit(b, src) {
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    const diff = this.diff;
    if (!st || !diff.wallOnHit || a.downed || !a.grounded || b.bqI < b.bqN || t < (b.hitWallAt || 0)) return;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return;
    b.hitWallAt = t + 1.2 + this.rng() * 1.5;
    if (this.rng() > diff.wallOnHit) return;
    const mat = bestMat(a.inventory);
    if (!mat) return;
    const fx = src.pos.x - a.pos.x;
    const fz = src.pos.z - a.pos.z;
    const hs = (Math.round(Math.atan2(fx, -fz) / (Math.PI / 2)) * Math.PI) / 2;
    const low = a.health + a.shield < 60;
    const n = low && diff.buildPieces >= 5 && this.rng() < diff.boxHeal ? this._queueBox(b, 0, hs) : queueStep(b, 0, 'wall', a.pos.x, a.pos.y, a.pos.z, Math.atan2(fx, -fz), 0);
    this._startQueue(b, n, n > 1 ? 'box' : 'wall', mat, Math.sin(hs), -Math.cos(hs));
  }

  /** 1x1 box around the bot's own cell from piece n: front wall, sides, back, then a cone roof. */
  _queueBox(b, n, hs) {
    const a = b.actor;
    const cx = (Math.floor(a.pos.x / BUILD.cell) + 0.5) * BUILD.cell;
    const cz = (Math.floor(a.pos.z / BUILD.cell) + 0.5) * BUILD.cell;
    const py = a.pos.y;
    n = queueStep(b, n, 'wall', cx, py, cz, hs, 0);
    n = queueStep(b, n, 'wall', cx, py, cz, hs + Math.PI / 2, 0);
    n = queueStep(b, n, 'wall', cx, py, cz, hs - Math.PI / 2, 0);
    n = queueStep(b, n, 'wall', cx, py, cz, hs + Math.PI, 0);
    n = queueStep(b, n, 'cone', cx, py, cz, hs, 1);
    return n;
  }

  // ------------------------------------------------------------- box fighting

  /**
   * Engage-state hook. Starts a box fight (full 1x1 box around us) when the target is close
   * and the dice say so, keeps one going, or ends it. True while boxed (the caller holds us in
   * the middle of the box).
   */
  _boxFight(b, target, dist) {
    const a = b.actor;
    const t = this.time;
    const diff = this.diff;
    const st = this.structures;
    if (b.box) {
      const bx = b.box;
      const gone = !target || !target.alive || t - b.lastSeen > BOX_MEMORY || dist > BOX_LEAVE;
      const left = Math.hypot(a.pos.x - bx.x, a.pos.z - bx.z) > CELL_HALF + 0.6 || Math.abs(a.pos.y - bx.y) > 2.5;
      // cracked enemy: edit a door out and push them (box ends, the push logic takes over)
      const push = target && target.alive && b.targetVisible && target.health + target.shield < 60 && a.health + a.shield > 90 && this.rng() < diff.pushWeak * 0.15;
      if (gone || left || push || (this._storm && this._storm.isOutside(a.pos.x, a.pos.z))) {
        this._endBox(b, push ? DOOR : 0);
        if (push) {
          b.pushRollAt = t + 2.5;
          b.pushUntil = t + 2.5;
        }
        return false;
      }
      return true;
    }
    if (!st || !diff.boxFight || !target || !target.alive || dist > BOX_RANGE || !a.grounded) return false;
    if (t < (b.boxRollAt || 0) || b.bqI < b.bqN) return false;
    b.boxRollAt = t + 3 + this.rng() * 2;
    if (this.rng() > diff.boxFight) return false;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return false;
    const mat = bestMat(a.inventory);
    let afford = 0;
    for (const m of MATERIALS) afford += Math.floor(a.inventory.mats[m] / BUILD.cost);
    if (!mat || afford < 6) return false;
    const hs = (Math.round(Math.atan2(target.pos.x - a.pos.x, -(target.pos.z - a.pos.z)) / (Math.PI / 2)) * Math.PI) / 2;
    const cx = (Math.floor(a.pos.x / BUILD.cell) + 0.5) * BUILD.cell;
    const cz = (Math.floor(a.pos.z / BUILD.cell) + 0.5) * BUILD.cell;
    b.box = { x: cx, y: a.pos.y, z: cz, since: t, peek: 'closed', peekT: t + 0.6 + this.rng() * 0.4, editKey: null, fixAt: 0, fails: 0, blocked: 0, checked: false };
    this._startQueue(b, this._queueBox(b, 0, hs), 'box', mat, Math.sin(hs), -Math.cos(hs));
    b.holdUntil = Infinity;
    return true;
  }

  /** The wall piece of our box on side `h` (heading), or null if it is gone. */
  _boxWall(b, h) {
    const st = this.structures;
    _bpos.x = b.box.x;
    _bpos.y = b.box.y;
    _bpos.z = b.box.z;
    const pl = st.plan('wall', _bpos, h, 0, _pl);
    const w = st.slots.get(pl.key);
    return w && w.alive ? w : null;
  }

  /** Every sim frame while boxed: replace broken walls, run the edit-peek loop. */
  _boxTick(b) {
    const bx = b.box;
    const a = b.actor;
    const st = this.structures;
    const t = this.time;
    if (!st || !a.alive || a.downed) {
      b.box = null;
      return;
    }
    if (b.state !== 'engage' && b.state !== 'heal') {
      this._endBox(b);
      return;
    }
    if (b.bqI < b.bqN) return; // still going up
    if (!bx.checked) {
      // the box went up as far as it could: a spot where walls do not fit is no box
      bx.checked = true;
      let walls = 0;
      for (let q = 0; q < 4; q++) if (this._boxWall(b, (q * Math.PI) / 2)) walls++;
      if (walls < 3) {
        this._endBox(b);
        b.boxRollAt = this.time + 8;
        return;
      }
    }
    if (bx.peek === 'open' && bx.blocked > 3 && bx.editKey) {
      // the window does not line up with them: open the full door instead
      const w = this.structures.slots.get(bx.editKey);
      if (w && w.alive && w.edit !== DOOR) st.edit(w, DOOR);
      bx.blocked = 0;
    }
    const tx = b.targetVisible && b.target ? b.target.pos.x : b.lastSeenX;
    const tz = b.targetVisible && b.target ? b.target.pos.z : b.lastSeenZ;
    const face = (Math.round(Math.atan2(tx - bx.x, -(tz - bx.z)) / (Math.PI / 2)) * Math.PI) / 2;

    // replace a broken wall (the enemy shot one out): the box must stay a box
    if (t > bx.fixAt) {
      bx.fixAt = t + 0.25;
      for (let q = 0; q < 4; q++) {
        const h = face + (q * Math.PI) / 2;
        if (this._boxWall(b, h)) continue;
        const mat = bestMat(a.inventory);
        if (!mat) break;
        _bpos.x = bx.x;
        _bpos.y = bx.y;
        _bpos.z = bx.z;
        const pl = st.plan('wall', _bpos, h, 0, _pl);
        if (!pl.valid && ++bx.fails > 6) {
          this._endBox(b); // cannot rebuild here: fight in the open
          b.boxRollAt = t + 8;
          return;
        }
        if (pl.valid && a.inventory.spendMats(mat, BUILD.cost)) {
          if (st.place({ ...pl }, mat, a)) b.builds++;
          else a.inventory.mats[mat] += BUILD.cost;
          if (bx.peek === 'open' && q === 0) bx.peek = 'closed'; // the peek wall was the one replaced
        }
        break; // one piece per tick, like a player
      }
    }

    // edit peek loop: closed (heal / reload behind it) -> window / door open -> reset
    if (t < bx.peekT) return;
    const diff = this.diff;
    if (bx.peek === 'closed') {
      // stay closed while healing / reloading (and patch up when hurt); otherwise open the
      // side facing them
      if (b.healing <= 0 && a.health + a.shield < 110 && (a.health < 75 ? findConsumable(a.inventory, 'medkit') >= 0 : a.shield < 50 && findConsumable(a.inventory, 'tonic') >= 0)) {
        this._startHeal(b);
      }
      if (b.healing > 0 || b.reloading > 0) {
        bx.peekT = t + 0.2;
        return;
      }
      const w = this._boxWall(b, face);
      if (!w) {
        bx.peekT = t + 0.2;
        return;
      }
      const close = Math.hypot(tx - a.pos.x, tz - a.pos.z) < 9;
      st.edit(w, close ? DOOR : WINDOW);
      bx.blocked = 0;
      bx.peek = 'open';
      bx.editKey = w.key;
      bx.peekT = t + diff.peekOpen * (0.7 + this.rng() * 0.6);
      // pre-aimed at the spot they were last seen: shoot as soon as the edit opens
      b.reactLeft = Math.min(b.reactLeft, diff.reaction * 0.4);
      b.trackTime = Math.max(b.trackTime, 2.5);
      b.burstPaused = false;
      b.burstLeft = 8;
      b.errYaw *= 0.5;
      b.errPitch *= 0.5;
      b.fireCd = Math.min(b.fireCd, 0.08);
    } else {
      // reset the edit (edit course: open, shoot, close)
      const w = bx.editKey && st.slots.get(bx.editKey);
      if (w && w.alive && w.edit) st.edit(w, 0);
      bx.peek = 'closed';
      bx.editKey = null;
      bx.peekT = t + diff.peekClosed * (0.7 + this.rng() * 0.8);
    }
  }

  /** Leaves the box: closes the peek, or edits a door toward the target to push out. */
  _endBox(b, mask = 0) {
    const bx = b.box;
    if (!bx) return;
    const st = this.structures;
    const w = bx.editKey && st && st.slots.get(bx.editKey);
    if (w && w.alive) st.edit(w, 0);
    if (mask && st && b.target) {
      const face = (Math.round(Math.atan2(b.target.pos.x - bx.x, -(b.target.pos.z - bx.z)) / (Math.PI / 2)) * Math.PI) / 2;
      const d = this._boxWall(b, face);
      if (d) st.edit(d, mask);
    }
    b.box = null;
    b.holdUntil = 0;
  }

  /** Starts placing queued pieces 0..n-1 (one per diff.buildRate). */
  _startQueue(b, n, mode, mat, dx, dz) {
    const t = this.time;
    b.bqN = n;
    b.bqI = 0;
    b.bqNext = t;
    b.bqMat = mat;
    b.bqMode = mode;
    b.bqDirX = dx;
    b.bqDirZ = dz;
    b.buildCooldown = Infinity; // set for real when the queue finishes
    if (mode === 'box') {
      b.holdUntil = t + n * this.diff.buildRate + 2.5;
      b.boxedAt = t;
    }
    this._buildStep(b);
  }

  /**
   * Third party: gunfire from an enemy within HEAR m that we are not already in, while we
   * are healthy and armed. Returns that shooter (sticky for a few seconds) or null.
   */
  _hearFight(b, all) {
    const a = b.actor;
    const t = this.time;
    if (!this.diff.thirdParty) return null;
    if (b.hunt && b.hunt.alive && t < b.huntUntil) return b.hunt;
    b.hunt = null;
    if (t < (b.hearAt || 0)) return null;
    b.hearAt = t + 1.5 + this.rng();
    if (a.health + a.shield < 110 || !this._hasGun(a.inventory)) return null;
    const now = performance.now() / 1000;
    let best = null;
    let bd = HEAR * HEAR;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o === a || !o.alive || o.downed || sameTeam(o, a) || inAir(o) || !(now - (o.shotAt || -99) < 3)) continue;
      const d2 = dist2(a.pos, o.pos);
      if (d2 < bd && d2 > 15 * 15) {
        bd = d2;
        best = o;
      }
    }
    if (best && this.rng() < this.diff.thirdParty * (0.5 + b.aggression * 0.5)) {
      b.hunt = best;
      b.huntUntil = t + 12;
      return best;
    }
    return null;
  }

  // ----------------------------------------------------------------- update

  update(dt, ctx = {}) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const busTime = Number.isFinite(ctx.busTime) ? ctx.busTime : this.time;
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
      this.navStats.plans++;
      this._planDoorTail(done);
      done.pathN = done.planN;
      done.pathI = 0;
      done.pathGoalX = done.planGX;
      done.pathGoalZ = done.planGZ;
      done.pathUntil = this.time + 25;
      done.stuck = 0;
      done.routeHold = 0;
      done.paths++;
    }

    // sim budget centres: every live human (local player, remote humans on a host) plus
    // the camera / viewer. ctx.humans may add more ({pos} objects).
    const eyes = this._eyes;
    eyes.length = 0;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (!o.isBot && o.alive && o.pos) eyes.push(o.pos.x, o.pos.z);
    }
    if (viewer) eyes.push(viewer.x, viewer.z);
    if (ctx.humans) for (const h of ctx.humans) if (h && h.pos) eyes.push(h.pos.x, h.pos.z);
    const frame = ++this._frame;
    const lodStats = this.lodStats;
    lodStats[0] = lodStats[1] = lodStats[2] = 0;

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
        if (busTime < b.launchAt) {
          if (a.character) a.character.root.visible = false;
          continue;
        }
        a.inBus = false;
        if (b.busRoute) {
          // leave the bus where it is now, a little below it, facing the landing spot
          busPosAt(b.busRoute, busTime, _busPt);
          a.pos.set(_busPt.x, _busPt.y - 1 - this.rng() * 2, _busPt.z);
          a.vel.set(b.busRoute.dx * 6, 0, b.busRoute.dz * 6);
          a.heading = Math.atan2(b.dropX - a.pos.x, -(b.dropZ - a.pos.z));
          if (a.character) a.character.root.position.copy(a.pos);
        }
      }
      // knocked: crawl toward help, nothing else
      if (a.downed) {
        this._downedStep(b, dt);
        this._present(b, dt, viewer, cd2);
        continue;
      }
      if (b.state === 'downed') {
        // revived: back on our feet, think right away
        b.state = 'wander';
        a.botState = 'wander';
        b.thinkIn = 0;
        b.lastHp = a.health + a.shield;
      }
      // damage detection without a hook
      const hp = a.health + a.shield;
      if (hp < b.lastHp - 0.01) {
        b.alertUntil = this.time + 4;
        b.hurtAt = this.time;
      }
      b.lastHp = hp;
      if (this.time >= b.lodAt) this._lod(b);
      lodStats[b.lod]++;

      b.thinkIn -= dt;
      if (b.thinkIn <= 0) {
        this._think(b, all);
        const busy = b.state === 'engage' || b.state === 'drop';
        // far bots think less often, but a fight (few at a time) keeps most of its rate
        const mul = b.state === 'engage' && b.thinkMul > 1.3 ? 1.3 : b.thinkMul;
        b.thinkIn += ((busy ? 0.125 : 0.2) + this.rng() * 0.06) * mul;
        if (b.doorNear && b.thinkIn > 0.12) b.thinkIn = 0.12; // threading a door: steer often
        if (b.thinkIn < 0) b.thinkIn = 0.05;
      }
      // physics + per-frame actions: every frame for near bots; far bots are time-sliced
      // (staggered by index) and catch up with the accumulated time in bounded sub-steps
      b.simAcc += dt;
      if (b.slice > 1 && (frame + i) % b.slice !== 0) {
        this._present(b, dt, viewer, cd2);
        continue;
      }
      const sdt = b.simAcc;
      b.simAcc = 0;
      this._act(b, sdt);
      if (sdt <= SIM_STEP_MAX) this._move(b, sdt);
      else {
        let left = sdt;
        while (left > 1e-4) {
          const s = left < SIM_STEP_MAX ? left : SIM_STEP_MAX;
          this._move(b, s);
          left -= s;
        }
      }
      this._present(b, dt, viewer, cd2);
    }
  }

  /**
   * Sim budget tier from the distance to the nearest human / the camera:
   *   0 (< LOD_NEAR)            full rate
   *   1 (< draw distance)       thinks ~1.6x less often, physics every frame (it may be on screen)
   *   2 (beyond)                thinks 2-3x less often, physics every 2nd / 4th frame,
   *                             fewer steering rays, no A* detours
   * A bot fighting (or hunted by) a human is always tier 0. Without any reference point
   * (headless tests) everyone runs at full rate.
   */
  _lod(b) {
    const a = b.actor;
    const eyes = this._eyes;
    let best = Infinity;
    for (let k = 0; k < eyes.length; k += 2) {
      const dx = eyes[k] - a.pos.x;
      const dz = eyes[k + 1] - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    if (!eyes.length || (b.target && !b.target.isBot) || (b.threat && !b.threat.isBot)) best = 0;
    const d = Math.sqrt(best);
    b.lodDist = d;
    if (d < LOD_NEAR) {
      b.lod = 0;
      b.slice = 1;
      b.thinkMul = 1;
    } else if (d < Math.max(this.charDist, LOD_NEAR + 40)) {
      b.lod = 1;
      b.slice = 1;
      b.thinkMul = 1.6;
    } else {
      b.lod = 2;
      b.slice = d < LOD_FAR ? 2 : 4;
      b.thinkMul = d < LOD_FAR ? 2.2 : 3;
    }
    b.lodAt = this.time + LOD_RECHECK + this.rng() * 0.2;
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
    b.inB = this._shellAt(a.pos.x, a.pos.z, a.pos.y);
    if (b.inB) b.wasInside = true;

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
      if (fight && !b.box && dist > 8 && a.health + a.shield < 45 && t > b.retreatUntil + 6 && this.rng() < 0.35 + b.caution * 0.5 &&
          (findConsumable(inv, 'medkit') >= 0 || findConsumable(inv, 'tonic') >= 0)) {
        b.retreatUntil = t + 3 + this.rng() * 2;
      }
      if (t < b.retreatUntil) fight = false;
      if (!fight && !b.targetVisible) b.target = null;
    }
    const mate = this._downedMate(b, all);
    if (mate) state = 'revive';
    else if (fight) state = 'engage';
    else if (outside) state = 'rotate';
    else if (t < b.retreatUntil && target) state = 'retreat';
    else if (b.healing > 0 || this._wantHeal(b)) state = 'heal';
    else if (this._needRotate(b, storm)) state = 'rotate';
    else if (b.harvest && b.harvest.alive && t < b.harvestUntil && !target) state = 'harvest';
    else if (!target && this._hearFight(b, all)) state = 'hunt';
    else if (this._pickLoot(b)) state = 'loot';
    else if (this._pickHarvest(b)) state = 'harvest';
    else state = 'wander';

    if (state !== 'heal' && b.healing > 0 && !b.box) this._cancelHeal(b); // boxed bots heal mid-fight
    if (state !== 'revive' && a.revivingTarget && this.combat) this.combat.stopRevive(a);
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
      case 'revive': {
        const dx = mate.pos.x - a.pos.x;
        const dz = mate.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        gx = mate.pos.x;
        gz = mate.pos.z;
        b.faceX = mate.pos.x;
        b.faceZ = mate.pos.z;
        if (d <= KNOCK.reviveRange - 0.5) {
          speed = 0;
          if (a.revivingTarget !== mate && this.combat) {
            if (a.revivingTarget) this.combat.stopRevive(a);
            a.revivingTarget = mate;
          }
        } else {
          if (a.revivingTarget && this.combat) this.combat.stopRevive(a);
          speed = d > 12 ? PLAYER.sprintSpeed : PLAYER.runSpeed;
          stop = 0.9;
        }
        b.target = null;
        b.targetVisible = false;
        break;
      }
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
        // cracked shield / healing / reloading: push them (decided once per target window)
        const weak = b.targetVisible && target && (target.health + target.shield < 75 || (target._bot && (target._bot.healing > 0 || target._bot.reloading > 0)));
        if (weak && t > (b.pushRollAt || 0)) {
          b.pushRollAt = t + 2.5;
          b.pushUntil = this.rng() < this.diff.pushWeak * (0.6 + b.aggression * 0.4) ? t + 2.5 : 0;
        }
        const pushing = weak && t < (b.pushUntil || 0) && a.health + a.shield > 60;
        if (pushing && d > 3.5) fw = 1;
        const s = b.targetVisible ? b.strafe : 0;
        gx = a.pos.x + (fx * fw - fz * s) * 6;
        gz = a.pos.z + (fz * fw + fx * s) * 6;
        stop = 0.2;
        speed = b.targetVisible && !pushing ? PLAYER.runSpeed : PLAYER.sprintSpeed;
        if (pushing) this._chooseWeapon(b, Math.min(d, 8)); // pull the close-range gun while closing in
        if (!b.targetVisible && d < 1.5) b.target = null; // reached last seen spot
        if (this._boxFight(b, target, d)) {
          // boxed: hold the middle of the box; the edit peeks do the fighting
          gx = b.box.x;
          gz = b.box.z;
          speed = Math.hypot(gx - a.pos.x, gz - a.pos.z) > 0.4 ? PLAYER.walkSpeed : 0;
          stop = 0.15;
          break;
        }
        // box fighters skip loose walls at box range: they would block their own peeks
        if (!(this.diff.boxFight && d < BOX_RANGE)) this._maybeBuild(b, fx, fz, d);
        if (t < b.rushUntil) {
          // ramp rush: run straight up the ramps being built toward the target
          gx = a.pos.x + b.bqDirX * 6;
          gz = a.pos.z + b.bqDirZ * 6;
          speed = PLAYER.runSpeed;
          stop = 0;
        } else if (b.bqMode === 'box' && t < b.holdUntil) {
          // boxed up: stay inside while it goes up (and heal / reload behind it)
          speed = 0;
        }
        break;
      }
      case 'retreat': {
        const dx = a.pos.x - b.lastSeenX;
        const dz = a.pos.z - b.lastSeenZ;
        const d = Math.hypot(dx, dz) || 1;
        gx = a.pos.x + (dx / d) * 10;
        gz = a.pos.z + (dz / d) * 10;
        // break line of sight inside a nearby building when there is one
        if (b.stateTime === 0) {
          if (b.inB && this._interiorPoint(b.inB, _pt)) {
            b.coverC = b.inB; // already indoors: stay in, move to another spot
            b.coverX = _pt.x;
            b.coverZ = _pt.z;
          } else this._pickCover(b, b.lastSeenX, b.lastSeenZ);
        }
        if (b.coverC) {
          gx = b.coverX;
          gz = b.coverZ;
        }
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
      case 'hunt': {
        // third party: close in on the fight we hear, slowing to a walk for the last stretch
        const h = b.hunt;
        const d = Math.hypot(h.pos.x - a.pos.x, h.pos.z - a.pos.z);
        gx = h.pos.x;
        gz = h.pos.z;
        speed = d > 60 ? PLAYER.sprintSpeed : PLAYER.runSpeed;
        stop = 6;
        b.faceX = h.pos.x;
        b.faceZ = h.pos.z;
        if (d < 30) {
          // close enough to see it: treat them as our target (perception takes over)
          b.threat = h;
          b.alertUntil = t + 4;
        }
        break;
      }
      case 'heal': {
        // just out of a fight: box up first, then heal inside it
        if (b.healing <= 0 && !b.inB && b.bqI >= b.bqN && this.diff.boxHeal && t - (b.boxedAt || -99) > 15 && (t - b.hurtAt < 10 || t < b.alertUntil) && this.structures && a.grounded) {
          const mat = bestMat(inv);
          let afford = 0;
          for (const m of MATERIALS) afford += Math.floor(inv.mats[m] / BUILD.cost);
          if (mat && afford >= 5 && this.rng() < this.diff.boxHeal) {
            const hs = (Math.round(a.heading / (Math.PI / 2)) * Math.PI) / 2;
            this._startQueue(b, this._queueBox(b, 0, hs), 'box', mat, Math.sin(hs), -Math.cos(hs));
          } else b.boxedAt = t; // no box this time; do not re-roll every think
        }
        if (b.bqMode === 'box' && t < b.holdUntil && b.bqI < b.bqN) {
          speed = 0; // stand still while the walls go up
          break;
        }
        // patch up indoors when a building is close (give up after a few seconds)
        if (b.healing <= 0 && b.stateTime === 0 && !b.inB) this._pickCover(b, NaN, NaN);
        if (b.healing <= 0 && b.coverC && !b.inB && b.stateTime < 9 && !b.target) {
          gx = b.coverX;
          gz = b.coverZ;
          stop = 0.6;
          break;
        }
        if (b.healing <= 0) this._startHeal(b);
        speed = 0;
        break;
      }
      case 'loot': {
        gx = b.lootX;
        gz = b.lootZ;
        stop = 0.3;
        const d = Math.hypot(gx - a.pos.x, gz - a.pos.z);
        // not through a building wall: the loot and the bot must be on the same side of it
        // (walkable interior of the same building, or both outside) with a clear line to it
        if (d < INTERACT && b.lootIn === b.inB && this._sameStorey(b.inB, a.pos.y, b.lootY)) {
          if (this.world.clearLine(a.pos.x, a.pos.y + CHEST, a.pos.z, gx, b.lootY + 0.4, gz)) this._interact(b);
          else {
            this.navStats.lootLos++;
            if (b.lootId != null) b.ignore.set(b.lootId, t + 20);
            b.lootId = null;
          }
        }
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
          // now and then explore a building on the way instead
          if (this.rng() < INDOOR_WANDER) {
            const cx = (b.goalX + a.pos.x) / 2;
            const cz = (b.goalZ + a.pos.z) / 2;
            const c = this._nearShell(cx, cz, 70, b.inB);
            if (c && this._interiorPoint(c, _pt)) {
              b.goalX = _pt.x;
              b.goalZ = _pt.z;
            }
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
    if (state !== 'retreat' && state !== 'heal') b.coverC = null;
    b.navX = gx;
    b.navZ = gz;
    // route goal: where the bot is really heading (a fight with the target out of sight
    // chases its last seen spot, which may be inside a building)
    let rgx = gx;
    let rgz = gz;
    let routed = speed > 0; // (healing stands still; walking into cover first is routed)
    if (state === 'engage') {
      if (b.targetVisible || t < b.rushUntil) routed = false;
      else {
        rgx = b.lastSeenX;
        rgz = b.lastSeenZ;
      }
    }
    // a goal on the other side of a building wall: go through a door (cheap, every LOD tier)
    if (routed && b.pathN === 0 && t >= b.routeHold) {
      if (state === 'loot') this._doorRoute(b, rgx, rgz, b.lootIn, b.lootY);
      else this._doorRoute(b, rgx, rgz);
    }
    // follow the door route / planned detour while it still leads to this goal
    b.doorNear = false;
    if (b.pathN > 0 && routed) {
      if (t > b.pathUntil || Math.hypot(rgx - b.pathGoalX, rgz - b.pathGoalZ) > 12) {
        if (t > b.pathUntil && b.pathK[b.pathI]) b.routeFails++;
        b.pathN = 0;
      } else {
        const P = b.path;
        const K = b.pathK;
        // advance past reached waypoints (or ones already passed on the way to the next)
        for (;;) {
          const i = b.pathI;
          const dx = a.pos.x - P[i * 2];
          const dz = a.pos.z - P[i * 2 + 1];
          const r = K[i] ? DOOR_REACH : WP_REACH;
          const d2 = dx * dx + dz * dz;
          let next = d2 < r * r;
          if (!next && K[i]) {
            // door waypoint: passed only beyond it along the leg into it (a door pair's
            // next leg runs along the wall, so "past along the next leg" fires on the wrong side)
            if (i > 0 && d2 < 1.44) next = dx * (P[i * 2] - P[i * 2 - 2]) + dz * (P[i * 2 + 1] - P[i * 2 - 1]) > 0;
          } else if (!next && i < b.pathN - 1 && d2 < 6.25) {
            const sx = P[i * 2 + 2] - P[i * 2];
            const sz = P[i * 2 + 3] - P[i * 2 + 1];
            next = dx * sx + dz * sz > 0; // past the waypoint along the next leg
          }
          if (!next) break;
          if (i >= b.pathN - 1) {
            b.pathN = 0;
            b.routeFails = 0;
            break;
          }
          b.pathI++;
        }
        if (b.pathN > 0) {
          const i = b.pathI;
          gx = P[i * 2];
          gz = P[i * 2 + 1];
          stop = 0;
          if (K[i] || (i > 0 && K[i - 1])) {
            const d = Math.hypot(gx - a.pos.x, gz - a.pos.z);
            if (d < 5) {
              b.doorNear = true; // think faster and slow down through the door
              if (d < 3) speed = Math.min(speed, PLAYER.runSpeed);
            }
          }
        }
      }
    }
    this._steer(b, gx, gz, speed, stop);
    this._stuckCheck(b);
  }

  /**
   * Nearest knocked teammate worth reviving (within 90 m, nobody else on it, no enemy within
   * KNOCK.botReviveClear of us or of it), or null. Team modes only.
   */
  _downedMate(b, all) {
    const a = b.actor;
    if (!this.combat || !this.combat.teamMode) return null;
    let best = null;
    let bd = 90 * 90;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (!o.alive || !o.downed || !sameTeam(o, a)) continue;
      if (o.reviver && o.reviver !== a) continue;
      const d2 = dist2(a.pos, o.pos);
      if (d2 < bd) {
        bd = d2;
        best = o;
      }
    }
    if (!best) return null;
    const c2 = KNOCK.botReviveClear * KNOCK.botReviveClear;
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (!o.alive || o.downed || o === a || (o.team != null && o.team === a.team) || inAir(o)) continue;
      if (dist2(a.pos, o.pos) < c2 || dist2(best.pos, o.pos) < c2) return null;
    }
    return best;
  }

  /** Knocked bot: drop everything, crawl toward the nearest standing teammate. */
  _downedStep(b, dt) {
    const a = b.actor;
    if (b.state !== 'downed') {
      if (b.healing > 0) this._cancelHeal(b);
      b.state = 'downed';
      a.botState = 'downed';
      b.stateTime = 0;
      b.reloading = 0;
      b.bqN = b.bqI = 0;
      b.target = null;
      b.targetVisible = false;
      b.pathN = 0;
      b.rushUntil = 0;
      b.wantJump = false;
      b.thinkIn = 0;
      if (a.revivingTarget && this.combat) this.combat.stopRevive(a);
    }
    if (a.carriedBy) {
      // riding on a teammate's shoulder (Combat.tickCarry places us)
      b.speed = 0;
      b.mx = b.mz = 0;
      return;
    }
    b.thinkIn -= dt;
    if (b.thinkIn <= 0) {
      b.thinkIn = 0.3 + this.rng() * 0.1;
      let best = null;
      let bd = Infinity;
      const all = this._all;
      for (let i = 0; i < all.length; i++) {
        const o = all[i];
        if (!o.alive || o.downed || !sameTeam(o, a) || inAir(o)) continue;
        const d2 = dist2(a.pos, o.pos);
        if (d2 < bd) {
          bd = d2;
          best = o;
        }
      }
      // being revived (or nobody to crawl to): stay put
      if (best && !a.reviver) this._steer(b, best.pos.x, best.pos.z, PLAYER.runSpeed * KNOCK.crawlSpeed, 1.6);
      else this._steer(b, a.pos.x, a.pos.z, 0, 1);
    }
    if (b.speed > 0 && (b.mx || b.mz)) {
      const want = Math.atan2(b.mx, -b.mz);
      const dh = angleDelta(a.heading, want);
      const turn = TURN_RATE * 0.5 * dt;
      a.heading += dh > turn ? turn : dh < -turn ? -turn : dh;
    }
    this._move(b, dt);
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
      if (t - b.lastSeen > (b.box ? BOX_MEMORY : MEMORY)) tgt = b.target = null;
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
      if (o === a || !o.alive || (o.team != null && o.team === a.team) || inAir(o)) continue;
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
    // a fresh fight may open with a build quickly, but not on a cooldown-reset spam
    b.buildCooldown = Math.max(b.buildCooldown, this.time + 0.3 + this.rng() * 0.5);
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
    if (this.combat && this.combat.cancelBurst) this.combat.cancelBurst(a);
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
    if (this.combat && this.combat.cancelBurst) this.combat.cancelBurst(a);
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
    // Phase 1 closes from a map-wide dormant circle over a long shrink: running for the far
    // target straight away would skip looting entirely. Move only once the live edge gets close.
    if ((storm.phaseIndex | 0) === 0) {
      const p0 = storm.phases ? storm.phases[0] : null;
      const left = storm.mode === 'waiting' ? storm.secondsLeft + (p0 ? p0.shrink : 0) : storm.secondsLeft;
      const far = Math.hypot(a.pos.x - storm.nextCx, a.pos.z - storm.nextCz) - storm.nextR * 0.7;
      if (far <= 0) return false;
      // leave in time to reach the phase-1 circle by sprinting, with slack for fights/detours
      if (far / PLAYER.sprintSpeed * (1.35 + (this.diff.rotateEarly || 0) * 0.5) + 15 + b.caution * 20 > left) return true;
      const edge = storm.r - Math.hypot(a.pos.x - storm.cx, a.pos.z - storm.cz);
      return storm.mode !== 'waiting' && edge < (b.state === 'rotate' ? 220 : 120);
    }
    const d = Math.hypot(a.pos.x - storm.nextCx, a.pos.z - storm.nextCz);
    // hysteresis: once rotating, keep going until comfortably inside
    const inside = storm.nextR * (b.state === 'rotate' ? 0.6 : 0.85) - d;
    if (inside > 0) return false;
    if (storm.mode !== 'waiting') return true;
    const travel = -inside / PLAYER.runSpeed;
    return storm.secondsLeft < travel * (1.6 + (this.diff.rotateEarly || 0)) + 12 + b.caution * 25;
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
      if (storm && (storm.phaseIndex | 0) === 0) {
        // phase 1: anything comfortably inside the live (slowly closing) circle is fair game
        if (Math.hypot(p.x - storm.cx, p.z - storm.cz) > storm.r - 140) continue;
      } else if (storm && (storm.mode !== 'waiting' || storm.secondsLeft < 45) &&
          Math.hypot(p.x - storm.nextCx, p.z - storm.nextCz) > storm.nextR * 0.85) continue;
      if (r.kind === 'item' && !this._wants(inv, r.item)) continue;
      b.lootId = r.id;
      b.lootKind = r.kind;
      b.lootX = p.x;
      b.lootY = p.y;
      b.lootZ = p.z;
      b.lootIn = this._shellAt(p.x, p.z, p.y);
      // the way in (or out) through a door takes longer than the straight line
      b.lootUntil = t + 4 + Math.hypot(p.x - a.pos.x, p.z - a.pos.z) / 3 + (b.lootIn !== b.inB ? 10 : b.lootIn ? 6 : 0);
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
    if (b.lootIn) {
      b.indoorLoot++;
      this.navStats.indoorLoot++;
    }
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

  /**
   * Rolls for a build response in a fight and queues it; _buildStep places the pieces one
   * per DIFFICULTY.buildRate seconds through the same plan / spendMats / place path players
   * use (so mats, slot rules and BUILD.maxPieces all apply). DIFFICULTY.buildPieces caps
   * the response:
   *   1   a wall toward the target
   *   2   wall + ramp (the wall covers the ramp's high end), or a lone wall
   *   3+  ramp rush toward a target on higher ground (or a far one now and then)
   *   5   1x1 box (4 walls + cone roof) when hurt in a close fight
   */
  _maybeBuild(b, fx, fz, d) {
    const st = this.structures;
    const tgt = b.target;
    if (!st || !tgt || !b.targetVisible || b.bqI < b.bqN) return;
    const t = this.time;
    if (t < b.buildCooldown) return;
    const diff = this.diff;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return;
    if (this.rng() > diff.buildChance) {
      b.buildCooldown = t + diff.buildCooldown * (0.3 + this.rng() * 0.4);
      return;
    }
    const a = b.actor;
    if (!a.grounded) return;
    const mat = bestMat(a.inventory);
    if (!mat) return;
    let afford = 0;
    for (const m of MATERIALS) afford += Math.floor(a.inventory.mats[m] / BUILD.cost);
    const maxN = Math.min(diff.buildPieces || 1, afford, BUILD_Q);
    const heading = Math.atan2(fx, -fz);
    // axis-snapped heading toward the target (ramps and box sides sit on the grid)
    const hs = (Math.round(heading / (Math.PI / 2)) * Math.PI) / 2;
    const dx = Math.sin(hs);
    const dz = -Math.cos(hs);
    const px = a.pos.x;
    const py = a.pos.y;
    const pz = a.pos.z;
    const hurt = a.health + a.shield < 70 || t - b.hurtAt < 1.2;
    const high = tgt.pos.y - py > 1.5;
    let n = 0;
    let mode;
    if (maxN >= 5 && hurt && d < 40) {
      // 1x1 box around the bot's own cell: front wall first, then sides, back, roof
      mode = 'box';
      n = this._queueBox(b, n, hs);
    } else if (maxN >= 3 && (high || (d > 18 && this.rng() < 0.45))) {
      // ramp rush: a chain of rising ramps toward the target, run up while it is built
      mode = 'rush';
      const ramps = Math.min(maxN, high ? 2 + Math.ceil((tgt.pos.y - py) / BUILD.level) : 3);
      // with pieces to spare, each ramp gets a wall in front (ramp-wall: climb behind cover)
      const covered = maxN >= ramps * 2;
      for (let i = 0; i < ramps && n < maxN; i++) {
        const rx = px + dx * BUILD.cell * i;
        const ry = py + BUILD.level * i;
        const rz = pz + dz * BUILD.cell * i;
        if (covered) {
          _bpos.x = rx;
          _bpos.y = ry;
          _bpos.z = rz;
          const pl = st.plan('ramp', _bpos, hs, 0, _pl);
          n = queueStep(b, n, 'wall', pl.x, pl.y, pl.z, hs, 0);
        }
        n = queueStep(b, n, 'ramp', rx, ry, rz, hs, 0);
      }
    } else if (maxN >= 2 && (d > 25 || this.rng() < (maxN >= 3 ? 0.75 : 0.4))) {
      // wall + ramp: the wall goes on the far edge of the ramp's cell, so it covers the climb
      mode = 'wallramp';
      _bpos.x = px;
      _bpos.y = py;
      _bpos.z = pz;
      const pl = st.plan('ramp', _bpos, hs, 0, _pl);
      n = queueStep(b, n, 'wall', pl.x, pl.y, pl.z, hs, 0);
      n = queueStep(b, n, 'ramp', px, py, pz, hs, 0);
    } else {
      mode = 'wall';
      n = queueStep(b, n, 'wall', px, py, pz, heading, 0);
    }
    b.bqN = n;
    b.bqI = 0;
    b.bqNext = t;
    b.bqMat = mat;
    b.bqMode = mode;
    b.bqDirX = dx;
    b.bqDirZ = dz;
    b.buildCooldown = Infinity; // set for real when the queue finishes
    if (mode === 'rush') b.rushUntil = t + 0.6 + n * Math.max(0.5, diff.buildRate * 2.5);
    else if (mode === 'box') b.holdUntil = t + n * diff.buildRate + 2.5;
    this._buildStep(b);
  }

  /** Places the next queued piece when its time has come (called every sim frame). */
  _buildStep(b) {
    const t = this.time;
    if (t < b.bqNext) return;
    const st = this.structures;
    const a = b.actor;
    const diff = this.diff;
    // a rush toward a target that is gone (or a dead builder) stops; walls and boxes finish
    const stop = !st || !a.alive || (b.bqMode === 'rush' && (!b.target || !b.target.alive));
    if (!stop) {
      const q = b.bq[b.bqI];
      _bpos.x = q.x;
      _bpos.y = q.y;
      _bpos.z = q.z;
      const pl = st.plan(q.kind, _bpos, q.h, q.p, _pl);
      const inv = a.inventory;
      let mat = b.bqMat;
      if ((inv.mats[mat] || 0) < BUILD.cost) mat = b.bqMat = bestMat(inv);
      if (pl && pl.valid && mat && inv.spendMats(mat, BUILD.cost)) {
        if (st.place(pl, mat, a)) b.builds++;
        else inv.mats[mat] += BUILD.cost;
      }
      b.bqI++;
      b.bqNext = t + diff.buildRate * (0.8 + this.rng() * 0.4);
    } else b.bqI = b.bqN;
    if (b.bqI >= b.bqN) {
      b.bqN = 0;
      b.bqI = 0;
      if (stop) b.rushUntil = 0;
      b.buildCooldown = t + diff.buildCooldown * (0.7 + this.rng() * 0.6);
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
    if (this.time < b.rushUntil || (b.pathN > 0 && b.pathK[b.pathI] === 2)) {
      // Authored stair flights and running up own ramps: the avoidance rays would see the ramp as a wall
      b.mx = ux;
      b.mz = uz;
      b.speed = speed;
      return;
    }
    const world = this.world;
    // indoors the feeler runs lower: partitions and furniture tops sit under chest height
    const oy = a.pos.y + (b.inB ? INDOOR_FEELER : OUTDOOR_FEELER);
    const range = Math.min(d, 3.2);
    const side = b.avoidSide;
    let chosen = base;
    let ok = false;
    // far bots (sim budget tier 2) probe only the first few directions
    const probes = b.lod === 2 ? 5 : AVOID.length;
    for (let i = 0; i < probes; i++) {
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

  // ---------------------------------------------------- enterable buildings

  /**
   * The hollow building whose walkable interior (inside the footprint, clear of the wall band
   * and door openings) holds (x, z) below its interior ceiling, or null. Used for both the bot
   * (b.inB) and its loot (b.lootIn), so 'same building' means the same side of the walls.
   */
  _shellAt(x, z, y) {
    const c = this.world.interiorAt ? this.world.interiorAt(x, z, y) : null;
    if (!c || !c.shell) return null;
    const top = c.shell.top ?? c.shell.ceil; // multi-storey: the top storey's ceiling
    return y == null || y < top - 0.3 ? c : null;
  }

  /**
   * Goal on the other side of a wall (bot inside and goal elsewhere, goal inside a building the
   * bot is not in, or another room / storey of the bot's own building): writes waypoints into
   * b.path — room-graph legs through interior doors and stairs (_roomRoute), the step inside
   * and the approach point outside an exterior door (reversed to get out). gy = goal height
   * (picks the goal's storey; null = the bot's own storey in its building, else the ground).
   * No-op when nothing needs a door, or a straight walk is clear (a broken wall panel).
   */
  _doorRoute(b, gx, gz, ig = undefined, gy = null) {
    const a = b.actor;
    const ib = b.inB;
    if (ig === undefined) ig = this._shellAt(gx, gz, gy);
    if (!ib && !ig) return false;
    const P = b.path;
    const K = b.pathK;
    let n = 0;
    let fx = a.pos.x;
    let fz = a.pos.z;
    if (ib && ib === ig) {
      // same building: rooms / storeys apart, unless a straight walk is open
      const gyy = gy ?? a.pos.y;
      n = this._roomRoute(ib, fx, fz, a.pos.y, gx, gz, gyy, P, K, 0);
      if (!n || this._walkClear(b, gx, gz, ib, gyy)) return false;
    } else {
      if (ib) {
        const d = this._pickDoor(b, ib, fx, fz, gx, gz);
        if (!d) return false;
        // Only a ground-storey actor can already be in this exterior doorway.
        const upstairs = ib.shell.plan && levelAt(ib.shell.plan, a.pos.y) > 0;
        if (upstairs || Math.hypot(d.x - fx, d.z - fz) > 1.1) {
          const ix = d.x - d.nx * DOOR_IN;
          const iz = d.z - d.nz * DOOR_IN;
          n = this._roomRoute(ib, fx, fz, a.pos.y, ix, iz, ib.shell.floor, P, K, 0);
          n = pushWp(P, K, n, ix, iz, 1);
        }
        n = pushWp(P, K, n, d.x + d.nx * DOOR_OUT, d.z + d.nz * DOOR_OUT, 1);
        fx = P[n * 2 - 2];
        fz = P[n * 2 - 1];
      }
      if (ig) {
        const d = this._pickDoor(b, ig, fx, fz, gx, gz);
        if (d) {
          if (Math.hypot(d.x - fx, d.z - fz) > 1.1) n = pushWp(P, K, n, d.x + d.nx * DOOR_OUT, d.z + d.nz * DOOR_OUT, 1);
          const ix = d.x - d.nx * DOOR_IN;
          const iz = d.z - d.nz * DOOR_IN;
          n = pushWp(P, K, n, ix, iz, 1);
          n = this._roomRoute(ig, ix, iz, ig.shell.floor, gx, gz, gy ?? ig.shell.floor, P, K, n);
        }
      }
      // a short hop through a broken outer panel beats walking round to a door
      if (n && this._walkClear(b, gx, gz, ib || ig, gy ?? (ig ? ig.shell.floor : a.pos.y))) return false;
    }
    if (!n) return false;
    b.pathN = n;
    b.pathI = 0;
    b.pathGoalX = gx;
    b.pathGoalZ = gz;
    b.pathUntil = this.time + 10 + Math.hypot(gx - a.pos.x, gz - a.pos.z) / 3 + n * 1.5;
    b.doorRoutes++;
    this.navStats.doorRoutes++;
    return true;
  }

  /**
   * Room-graph leg inside building c from (x, z) at height y to (gx, gz) at height gy:
   * appends interior-door waypoint pairs (INNER_STEP either side of each door's wall line)
   * and, between storeys, stair waypoints (plan.stairs used as portals: approach, foot,
   * landing, step off) to P / K from index n. Returns the new count (n when no leg is
   * needed or the plan has none). Doors are always open, so the route never goes stale when
   * panels break; a broken partition is only a shortcut (see _walkClear).
   */
  _roomRoute(c, x, z, y, gx, gz, gy, P, K, n) {
    const plan = c.shell && c.shell.plan;
    if (!plan || !plan.levels || !plan.levels.length) return n;
    let lv = levelAt(plan, y);
    const glv = levelAt(plan, gy);
    let r = roomAt(plan, lv, x, z);
    const gr = roomAt(plan, glv, gx, gz);
    const stairs = plan.stairs || [];
    let cursorX = x, cursorZ = z;
    const walkTo = (tx, tz) => {
      for (const [wx, wz] of stairWalk(plan, cursorX, cursorZ, tx, tz)) {
        n = pushWp(P, K, n, wx, wz, 1);
        cursorX = wx; cursorZ = wz;
      }
    };
    const levelLeg = (from, to) => {
      const points = new Float32Array(PATH_MAX * 2), kinds = new Uint8Array(PATH_MAX);
      const count = this._levelLeg(plan, lv, from, to, points, kinds, 0);
      for (let i = 0; i < count; i++) walkTo(points[i * 2], points[i * 2 + 1]);
    };
    while (lv !== glv) {
      const up = glv > lv;
      const sl = up ? lv : lv - 1;
      let s = null;
      for (let i = 0; i < stairs.length; i++) {
        if (stairs[i].level === sl) {
          s = stairs[i];
          break;
        }
      }
      if (!s) break; // no way between these storeys: walk the rooms of this one
      const enter = up ? s.room0 : s.room1;
      levelLeg(r, enter ?? -1);
      let ux = s.x1 - s.x0;
      let uz = s.z1 - s.z0;
      const l = Math.hypot(ux, uz) || 1;
      ux /= l;
      uz /= l;
      if (n > PATH_MAX - 4) return n;
      if (up) {
        walkTo(s.x0 - ux * STAIR_STEP, s.z0 - uz * STAIR_STEP);
        n = pushWp(P, K, n, s.x0, s.z0, 1);
        n = pushWp(P, K, n, s.x1, s.z1, 2);
        n = pushWp(P, K, n, s.x1 + ux * STAIR_STEP, s.z1 + uz * STAIR_STEP, 1);
      } else {
        walkTo(s.x1 + ux * STAIR_STEP, s.z1 + uz * STAIR_STEP);
        n = pushWp(P, K, n, s.x1, s.z1, 1);
        n = pushWp(P, K, n, s.x0, s.z0, 2);
        n = pushWp(P, K, n, s.x0 - ux * STAIR_STEP, s.z0 - uz * STAIR_STEP, 1);
      }
      cursorX = P[n * 2 - 2]; cursorZ = P[n * 2 - 1];
      lv = up ? lv + 1 : lv - 1;
      r = (up ? s.room1 : s.room0) ?? roomAt(plan, lv, P[n * 2 - 2], P[n * 2 - 1]);
    }
    if (lv === glv) { levelLeg(r, gr); walkTo(gx, gz); }
    return n;
  }

  /**
   * Distance (m) from interior door d's wall line, on side sgn of its normal, for the door's
   * waypoint: INNER_STEP, or less when that point is in a wall (a sliver of a room behind the
   * door). Ground storey (blockedAt samples its partitions).
   */
  _doorStep(d, sgn) {
    const w = this.world;
    for (let k = 0; k < DOOR_STEPS.length; k++) {
      const o = DOOR_STEPS[k] * sgn;
      if (!w.blockedAt(d.x + d.nx * o, d.z + d.nz * o, 0.3, true)) return DOOR_STEPS[k];
    }
    return DOOR_STEPS[DOOR_STEPS.length - 1];
  }

  /** Are heights y0 and y1 on the same storey of building c (always true outdoors / one storey)? */
  _sameStorey(c, y0, y1) {
    const plan = c && c.shell && c.shell.plan;
    return !plan || plan.levels.length < 2 || levelAt(plan, y0) === levelAt(plan, y1);
  }

  /** Interior-door waypoint pairs from room r0 to room r1 on storey lv (appended at n). */
  _levelLeg(plan, lv, r0, r1, P, K, n) {
    if (r0 < 0 || r1 < 0 || r0 === r1) return n;
    const doors = plan.levels[lv] && plan.levels[lv].doors;
    if (!doors || !roomRoute(plan, r0, r1, _route, lv)) return n;
    let cur = r0;
    for (let k = 0; k < _route.length && n < PATH_MAX - 2; k++) {
      const d = doors[_route[k]];
      const s = d.roomA === cur ? 1 : -1; // +1: walking along the normal (toward roomB)
      const o0 = lv === 0 ? this._doorStep(d, -s) : INNER_STEP;
      const o1 = lv === 0 ? this._doorStep(d, s) : INNER_STEP;
      n = pushWp(P, K, n, d.x - d.nx * o0 * s, d.z - d.nz * o0 * s, 1);
      n = pushWp(P, K, n, d.x + d.nx * o1 * s, d.z + d.nz * o1 * s, 1);
      cur = s > 0 ? d.roomB : d.roomA;
    }
    return n;
  }

  /**
   * Can the bot walk straight to (gx, gz) (within CLEAR_WALK m)? Samples blockedAt(..., true)
   * along the line, so partitions and outer panels count only while they stand: a broken panel
   * opens the shortcut on the next check. Cached per goal for a moment (b.walkAt). Ground
   * storey only (blockedAt samples the ground-storey partitions): false when the bot or the
   * goal (height gy) is on an upper storey of building c.
   */
  _walkClear(b, gx, gz, c, gy) {
    const a = b.actor;
    const plan = c && c.shell && c.shell.plan;
    if (plan && (levelAt(plan, a.pos.y) !== 0 || levelAt(plan, gy) !== 0)) return false;
    const dx = gx - a.pos.x;
    const dz = gz - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > CLEAR_WALK) return false;
    const t = this.time;
    if (t < b.walkAt && Math.abs(gx - b.walkGX) < 1 && Math.abs(gz - b.walkGZ) < 1) return b.walkOk;
    const w = this.world;
    let ok = true;
    const steps = Math.ceil(d / CLEAR_STEP);
    for (let i = 1; i < steps && ok; i++) {
      const f = i / steps;
      if (w.blockedAt(a.pos.x + dx * f, a.pos.z + dz * f, 0.35, true)) ok = false;
    }
    b.walkAt = t + 1.5;
    b.walkGX = gx;
    b.walkGZ = gz;
    b.walkOk = ok;
    return ok;
  }

  /** Door of building c with the shortest from -> door -> goal walk (randomised after failed tries). */
  _pickDoor(b, c, fx, fz, gx, gz) {
    const doors = c.shell.doors;
    let best = null;
    let bestV = Infinity;
    const noise = b.routeFails > 0 ? 25 * Math.min(b.routeFails, 4) : 0;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const ox = d.x + d.nx * DOOR_OUT;
      const oz = d.z + d.nz * DOOR_OUT;
      let v = Math.hypot(ox - fx, oz - fz) + Math.hypot(gx - d.x, gz - d.z);
      if (noise) v += this.rng() * noise;
      if (v < bestV) {
        bestV = v;
        best = d;
      }
    }
    return best;
  }

  /** Enterable buildings binned by SHELL_CELL (built on first use). */
  _shells() {
    const list = this.world.buildingInteriors ? this.world.buildingInteriors() : null;
    if (this._shellGrid && list === this._shellSrc) return this._shellGrid; // rebuilt when the world's list changes
    this._shellSrc = list;
    const grid = new Map();
    if (!list) {
      this._shellGrid = grid;
      return grid;
    }
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const k = shellKey(Math.floor(e.x / SHELL_CELL), Math.floor(e.z / SHELL_CELL));
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(e.collider);
    }
    this._shellGrid = grid;
    return grid;
  }

  /** A random enterable building whose door is within r of (x, z) (not `skip`), or null. */
  _nearShell(x, z, r, skip = null) {
    const grid = this._shells();
    if (!grid.size) return null;
    const i0 = Math.floor((x - r) / SHELL_CELL);
    const i1 = Math.floor((x + r) / SHELL_CELL);
    const j0 = Math.floor((z - r) / SHELL_CELL);
    const j1 = Math.floor((z + r) / SHELL_CELL);
    let pick = null;
    let seen = 0;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = grid.get(shellKey(i, j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k];
          if (c === skip || !c.alive) continue;
          const d0 = this._nearDoor(c, x, z);
          if (!d0 || Math.hypot(d0.x - x, d0.z - z) > r) continue;
          if (this.rng() * ++seen < 1) pick = c; // reservoir sample
        }
      }
    }
    return pick;
  }

  /** Door of building c nearest to (x, z), or null. */
  _nearDoor(c, x, z) {
    const doors = c.shell.doors;
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const v = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (v < bestD) {
        bestD = v;
        best = d;
      }
    }
    return best;
  }

  /**
   * A* plan (b.path / b.planN) toward a goal inside a building it does not enter (a partial
   * plan, or one that ends at the wall): append the door approach + step inside, so the bot
   * does not follow it to the wall and stall with door routing held off by pathN > 0.
   */
  _planDoorTail(b) {
    const ig = this._shellAt(b.planGX, b.planGZ, null);
    if (!ig || !ig.shell.doors.length) return;
    let n = b.planN;
    const P = b.path;
    const K = b.pathK;
    const lx = P[n * 2 - 2];
    const lz = P[n * 2 - 1];
    const fl = ig.shell.floor;
    if (this._shellAt(lx, lz, null) === ig) {
      // already gets inside (maybe through interior doors): finish the room legs to the goal
      b.planN = this._roomRoute(ig, lx, lz, fl, b.planGX, b.planGZ, fl, P, K, n);
      return;
    }
    const d = this._pickDoor(b, ig, lx, lz, b.planGX, b.planGZ);
    if (!d) return;
    n = Math.min(n, PATH_MAX - 16); // room for the door and a few room legs
    n = pushWp(P, K, n, d.x + d.nx * DOOR_OUT, d.z + d.nz * DOOR_OUT, 1);
    const ix = d.x - d.nx * DOOR_IN;
    const iz = d.z - d.nz * DOOR_IN;
    n = pushWp(P, K, n, ix, iz, 1);
    b.planN = this._roomRoute(ig, ix, iz, fl, b.planGX, b.planGZ, fl, P, K, n);
  }

  /** Random open floor point inside building c (clear of its walls), or false. */
  _interiorPoint(c, out) {
    const w = this.world;
    for (let k = 0; k < 14; k++) {
      const x = c.minX + this.rng() * (c.maxX - c.minX);
      const z = c.minZ + this.rng() * (c.maxZ - c.minZ);
      if (w.interiorAt(x, z) !== c || w.blockedAt(x, z, 0.7, true)) continue;
      out.x = x;
      out.z = z;
      return true;
    }
    return false;
  }

  /** Cover inside a nearby building (away from the threat at fromX/fromZ when given). */
  _pickCover(b, fromX, fromZ) {
    const a = b.actor;
    b.coverC = null;
    if (b.inB) return false;
    const c = this._nearShell(a.pos.x, a.pos.z, COVER_RANGE);
    if (!c) return false;
    // do not run toward the shooter (through the door the bot would use)
    const d0 = this._nearDoor(c, a.pos.x, a.pos.z);
    if (Number.isFinite(fromX) && Math.hypot(d0.x - fromX, d0.z - fromZ) < Math.hypot(a.pos.x - fromX, a.pos.z - fromZ) - 4) return false;
    if (!this._interiorPoint(c, _pt)) return false;
    b.coverC = c;
    b.coverX = _pt.x;
    b.coverZ = _pt.z;
    this.navStats.cover++;
    return true;
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
      if (b.stuck >= 2 && b.state !== 'engage' && b.pathN === 0 && b.lod < 2) {
        // plan a way around on a coarse grid toward the current goal (delivered in a later
        // frame; bots near a human jump the queue). Far bots skip A* and just re-goal below.
        this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ, b.lod === 0);
      } else if (b.stuck >= 3 && b.state !== 'engage' && b.pathN > 0 && b.pathK[b.pathI] && b.lod < 2) {
        // a door / room route that does not get through (a room split by a footprint notch,
        // a blocked doorway): drop it and let A* (which knows the doors) find a way; hold
        // door routing off until the plan arrives
        b.routeFails++;
        b.pathN = 0;
        b.routeHold = t + 6;
        this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ, b.lod === 0);
      }
      if (b.stuck >= 5) this._regoal(b);
    } else if (moved > 1.5) b.stuck = 0;
    // long-horizon progress: moving but oscillating in place also counts as stuck
    if (t > b.progAt) {
      const d = Math.hypot(b.navX - a.pos.x, b.navZ - a.pos.z);
      const travelling = b.speed > 0 && b.state !== 'engage' && b.state !== 'harvest' && d > 4;
      if (travelling && b.progD - d < 3 && b.pathN === 0) {
        b.stuck = Math.max(b.stuck, 2);
        if (b.lod < 2) this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ, b.lod === 0);
        else this._regoal(b); // far from every human: no A*, just pick another goal
      }
      b.progD = d;
      b.progAt = t + 6;
    }
    b.stuckX = a.pos.x;
    b.stuckZ = a.pos.z;
    b.stuckAt = t + STUCK_WINDOW;
  }

  /** Re-path: drop the current goal and go somewhere else nearby. */
  _regoal(b) {
    const a = b.actor;
    const t = this.time;
    b.stuck = 0;
    if (b.pathN > 0 && b.pathK[b.pathI]) b.routeFails++; // the door route did not work: try another door
    b.pathN = 0;
    b.coverC = null;
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

  // ---------------------------------------------------------- per-frame act

  _act(b, dt) {
    const a = b.actor;
    if (b.state === 'drop') return;
    const t = this.time;
    b.stateTime += dt;
    b.fireCd -= dt;
    b.bloom = Math.max(0, b.bloom - dt * 0.08);
    const inv = a.inventory;

    if (b.bqI < b.bqN) this._buildStep(b);
    if (b.box) this._boxTick(b);
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
    if (tgt && (b.targetVisible || b.box) && b.state === 'engage') {
      const dx = (b.targetVisible ? tgt.pos.x : b.lastSeenX) - a.pos.x;
      const dz = (b.targetVisible ? tgt.pos.z : b.lastSeenZ) - a.pos.z;
      want = Math.atan2(dx, -dz);
      pitch = Math.atan2(tgt.pos.y + CHEST - (a.pos.y + EYE), Math.hypot(dx, dz) || 1);
    } else if ((b.state === 'harvest' && b.harvest) || (b.state === 'revive' && a.revivingTarget)) {
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
      // time-sliced (far) bots: catch up on the shots that fell inside the skipped frames
      let rem = dt;
      for (let k = 1; k < b.slice; k++) {
        const c = b.fireCd;
        if (!(c > 0) || c >= rem) break;
        rem -= c;
        b.fireCd = 0;
        const shots = b.shots;
        this._fireControl(b, tgt);
        if (b.shots === shots) break;
      }
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
    // peeking through an edit: the shot leaves from the eye (aimed down sights), not the hip
    if (b.box && b.box.peek === 'open') _origin.set(a.pos.x + Math.sin(a.heading) * 0.3, a.pos.y + EYE, a.pos.z - Math.cos(a.heading) * 0.3);
    else if (ch && ch.root.visible) ch.muzzle(_origin);
    else _origin.set(a.pos.x + Math.sin(a.heading) * 0.4, a.pos.y + EYE - 0.15, a.pos.z - Math.cos(a.heading) * 0.4);
    // aim at the chest (head now and then), with drift that shrinks while tracking
    const settle = Math.max(0.45, 1 - b.trackTime / 5);
    const tSpeed = tgt.vel ? Math.min(1.5, Math.hypot(tgt.vel.x, tgt.vel.z) / 7) : 0;
    const err = settle * (1 + tSpeed * 0.6);
    const aimY = tgt.pos.y + (this.rng() < 0.15 ? 1.62 : CHEST);
    _dir.set(tgt.pos.x - _origin.x, aimY - _origin.y, tgt.pos.z - _origin.z);
    if (w.ballistic) leadBallistic(_dir, tgt, w.ballistic, this.diff.lead ?? 1);
    const len = _dir.length() || 1;
    _dir.multiplyScalar(1 / len);
    const yaw = (b.errYaw + gauss(this.rng) * this.diff.aimError * 0.35) * err;
    const pit = (b.errPitch + gauss(this.rng) * this.diff.aimError * 0.25) * err;
    rotateDir(_dir, yaw, pit);
    // never shoot our own build point-blank (a wall just placed / a closed peek): hold fire
    if (b.builds > 0 || b.box) {
      const own = this.world.raycast(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, 4.5, null);
      if (own && own.collider && own.collider.owner === a) {
        b.ownHolds = (b.ownHolds || 0) + 1;
        if (b.box && b.box.peek === 'open') b.box.blocked = (b.box.blocked || 0) + 1;
        b.fireCd = 0.1;
        return;
      }
    }

    const moving = Math.hypot(a.vel.x, a.vel.z) > 1 ? 1.35 : 1;
    const base = w.hipSpread ? w.hipSpread * 0.5 : w.spread;
    // peeking through an edit: aimed down sights (tight), so the frame is not shot to bits
    const ads = b.box && b.box.peek === 'open' ? 0.45 : 1;
    const spread = (base + b.bloom) * moving * (a.grounded ? 1 : 1.6) * ads;
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
    const st = weaponStats(it.id, it.rarity) || w;
    b.reloading = st.reload;
    b.burstLeft = 0;
    if (this.combat && this.combat.cancelBurst) this.combat.cancelBurst(a); // no burst rounds 2-3 during the reload
    if (a.character) a.character.reload(st.reload);
    // Sfx plays the shell-by-shell loading only for 'shotgun'
    if (this.sfx) this.sfx.play('reload', { x: a.pos.x, y: a.pos.y, z: a.pos.z, weapon: w.kind === 'shotgun' ? 'shotgun' : it.id });
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
    ch.setDowned(!!a.downed);
    if (!show) {
      b.animAcc = 0;
      return;
    }
    // position / facing every frame (cheap); the skeleton (mixer) at a distance-scaled rate:
    // every frame inside ANIM_FULL, every 2nd frame to half the draw distance, every 3rd beyond
    ch.root.position.copy(a.pos);
    ch.root.rotation.y = Math.PI - a.heading;
    if (b.state === 'dead' && b.deadAnimated > DEAD_ANIM) return; // death pose settled: frozen
    b.animAcc += dt;
    const every = d2 > cd2 * 0.25 ? 3 : d2 > ANIM_FULL * ANIM_FULL ? 2 : 1;
    if (++b.animTick < every) return;
    b.animTick = 0;
    const step = b.animAcc;
    b.animAcc = 0;
    if (b.state === 'dead') b.deadAnimated += step;
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
    b.box = null;
    b.state = 'dead';
    a.botState = 'dead';
    b.deadTime = 0;
    b.healing = 0;
    b.reloading = 0;
    b.speed = 0;
    a.vel.set(0, 0, 0);
    a.gliding = false;
    if (a.revivingTarget && this.combat) this.combat.stopRevive(a);
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
    buildCooldown: 0,
    // queued build response, placed one piece per buildRate seconds (see _maybeBuild)
    bq: Array.from({ length: BUILD_Q }, () => ({ kind: 'wall', x: 0, y: 0, z: 0, h: 0, p: 0 })),
    bqN: 0,
    bqI: 0,
    bqNext: 0,
    bqMat: 'wood',
    bqMode: '',
    bqDirX: 0,
    bqDirZ: 0,
    rushUntil: 0,
    holdUntil: 0,
    // items
    healing: 0,
    lootId: null,
    lootKind: null,
    lootX: 0,
    lootY: 0,
    lootZ: 0,
    lootUntil: 0,
    lootIn: null, // enterable building (World collider) holding the loot target, or null
    ignore: new Map(),
    // enterable buildings
    inB: null, // building the bot is inside (updated every think), or null
    wasInside: false,
    doorNear: false,
    doorRoutes: 0,
    walkAt: 0, // _walkClear cache: valid until, goal, result
    walkGX: 0,
    walkGZ: 0,
    walkOk: false,
    routeHold: 0, // no door routing before this (an A* detour for a failed route is pending)
    routeFails: 0,
    indoorLoot: 0,
    coverC: null,
    coverX: 0,
    coverZ: 0,
    harvest: null,
    harvestUntil: 0,
    harvestCooldown: 0,
    harvestReach: false,
    faceX: 0,
    faceZ: 0,
    // presentation
    deadTime: 0,
    animAcc: 0,
    animTick: 0,
    deadAnimated: 0,
    // sim budget (see Bots._lod)
    lod: 0,
    slice: 1,
    thinkMul: 1,
    lodAt: 0,
    lodDist: 0,
    simAcc: 0,
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
    pathK: new Uint8Array(PATH_MAX), // 1 = door/walk waypoint, 2 = authored flight (tight reach, no slope avoidance)
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

/** Material with the most stock that still pays for a piece, or null. */
function bestMat(inv) {
  let mat = null;
  let most = BUILD.cost - 1;
  for (const m of MATERIALS) {
    if (inv.mats[m] > most) {
      most = inv.mats[m];
      mat = m;
    }
  }
  return mat;
}

/** Writes build step n of b's queue; returns n + 1 (or n when the queue is full). */
function queueStep(b, n, kind, x, y, z, h, p) {
  if (n >= BUILD_Q) return n;
  const q = b.bq[n];
  q.kind = kind;
  q.x = x;
  q.y = y;
  q.z = z;
  q.h = h;
  q.p = p;
  return n + 1;
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
const PATH_MAX = 64; // room-graph routes through big interiors need more than the old 24
const PLAN_MAX_EXPANSIONS = 6000;
// neighbour offsets as (dx, dz, cost) triples
const NB = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1, 1, 1, 1.4142, 1, -1, 1.4142, -1, 1, 1.4142, -1, -1, 1.4142];

// Enterable buildings: cells are sampled with blockedAt(..., true) (only the thin outer
// walls block, interiors are open) and cells straddling a door opening are forced open
// (a 2 m cell lattice rarely has a centre inside a 1.8 m door); _emit turns a run of
// door cells into two door-aligned waypoints (outside -> inside, or back).
const DOOR_HASH = 16; // metres per door hash cell
const DOOR_ALONG = 1.45; // |offset along the wall| (m) of a cell centre counted as in the door
const DOOR_ACROSS = 1.5; // |offset across the wall| (m)

class Planner {
  constructor(world, legacy = false) {
    this.world = world;
    this.legacy = legacy; // true: whole footprints block (the old behaviour; benchmarks)
    this.doorOf = new Int32Array(PG * PG); // door index of a forced-open cell, else -1 (valid when seen[i] == stamp)
    this.doors = null; // flat door list [{ x, z, nx, nz, o, i, al }] (lazy, see _doorIndex)
    this.doorHash = null; // Map: DOOR_HASH cell -> door indices
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

  request(b, sx, sz, gx, gz, urgent = false) {
    if (b.planQueued) return;
    b.planQueued = true;
    b.planSX = sx;
    b.planSZ = sz;
    b.planGX = gx;
    b.planGZ = gz;
    if (urgent) this.queue.unshift(b);
    else this.queue.push(b);
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
    b.planN = this._emit(b.path, b.pathK);
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
    this.doorOf[start] = -1;
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
      this.doorOf[i] = -1;
      if (!w.inBounds(x, z, 3)) this.occ[i] = 2;
      else if (this.legacy) this.occ[i] = w.blockedAt(x, z, 0.75) ? 2 : 1;
      else {
        // door cells are open (and tagged, so _emit lines the path up with the opening)
        const d = this._doorCell(x, z);
        this.doorOf[i] = d;
        this.occ[i] = d >= 0 || !w.blockedAt(x, z, 0.75, true) ? 1 : 2;
      }
    }
    return this.occ[i] === 1;
  }

  /** Door (index into this.doors) whose opening the cell centre (x, z) straddles, or -1. */
  _doorCell(x, z) {
    if (!this.doorHash) this._doorIndex();
    const arr = this.doorHash.get(shellKey(Math.floor(x / DOOR_HASH), Math.floor(z / DOOR_HASH)));
    if (!arr) return -1;
    const D = this.doors;
    for (let k = 0; k < arr.length; k++) {
      const d = D[arr[k]];
      const rx = x - d.x;
      const rz = z - d.z;
      const across = rx * d.nx + rz * d.nz;
      const along = rz * d.nx - rx * d.nz;
      if (across > -DOOR_ACROSS && across < DOOR_ACROSS && along > -d.al && along < d.al) return arr[k];
    }
    return -1;
  }

  /**
   * Hash every door of every enterable building into each DOOR_HASH cell its catch box
   * touches: exterior doors (o / i = DOOR_OUT / DOOR_IN along the outward normal) and the
   * ground storey's interior doors (INNER_STEP either side; the catch box is narrowed to the
   * doorway, al, so it does not open cells deep in the partition). Upper-storey doors are left
   * out: the grid is 2D and samples ground-storey walls, so they would open ground-floor walls.
   * Doors never close, so the index stays valid when panels break (cells re-sample blockedAt).
   */
  _doorIndex() {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const D = (this.doors = []);
    const H = (this.doorHash = new Map());
    const list = this.world.buildingInteriors ? this.world.buildingInteriors() : [];
    const add = (x, z, nx, nz, o, i, al) => {
      const id = D.length;
      D.push({ x, z, nx, nz, o, i, al });
      const m = Math.hypot(al, DOOR_ACROSS);
      const i0 = Math.floor((x - m) / DOOR_HASH);
      const i1 = Math.floor((x + m) / DOOR_HASH);
      const j0 = Math.floor((z - m) / DOOR_HASH);
      const j1 = Math.floor((z + m) / DOOR_HASH);
      for (let a = i0; a <= i1; a++) {
        for (let b = j0; b <= j1; b++) {
          const k = shellKey(a, b);
          let arr = H.get(k);
          if (!arr) H.set(k, (arr = []));
          arr.push(id);
        }
      }
    };
    for (let i = 0; i < list.length; i++) {
      const sh = list[i].collider.shell;
      if (!sh) continue;
      for (const d of sh.doors) add(d.x, d.z, d.nx, d.nz, DOOR_OUT, DOOR_IN, DOOR_ALONG);
      const L0 = sh.plan && sh.plan.levels && sh.plan.levels[0];
      for (const d of (L0 && L0.doors) || []) add(d.x, d.z, d.nx, d.nz, INNER_STEP, INNER_STEP, Math.min(DOOR_ALONG, d.w / 2 + 0.5));
    }
    this.indexMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
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

  /**
   * Writes waypoints (every 3rd cell from start toward the best cell) into out, kinds into
   * kout (1 = door waypoint); returns the count. A run of door cells becomes the door's
   * approach point and its step through (DOOR_OUT / DOOR_IN), in walking order.
   */
  _emit(out, kout) {
    if (this.best === this.start) return 0;
    const cells = this.cells;
    let n = 0;
    for (let i = this.best; i !== -1 && n < cells.length; i = this.parent[i]) cells[n++] = i;
    let w = 0;
    let since = 0;
    let lastDoor = -1;
    let px = this.ox + ((this.start % PG) + 0.5) * PC;
    let pz = this.oz + (Math.floor(this.start / PG) + 0.5) * PC;
    for (let k = n - 2; k >= 0 && w < PATH_MAX; k--) {
      const i = cells[k];
      const cx = this.ox + ((i % PG) + 0.5) * PC;
      const cz = this.oz + (Math.floor(i / PG) + 0.5) * PC;
      const di = this.legacy || this.seen[i] !== this.stamp ? -1 : this.doorOf[i];
      if (di >= 0) {
        if (di !== lastDoor && w < PATH_MAX - 1) {
          const d = this.doors[di];
          const side = (px - d.x) * d.nx + (pz - d.z) * d.nz >= 0 ? 1 : -1; // +1: from the normal's side (outside)
          const a = side > 0 ? d.o : -d.i;
          const c = side > 0 ? -d.i : d.o;
          out[w * 2] = d.x + d.nx * a;
          out[w * 2 + 1] = d.z + d.nz * a;
          if (kout) kout[w] = 1;
          w++;
          out[w * 2] = d.x + d.nx * c;
          out[w * 2 + 1] = d.z + d.nz * c;
          if (kout) kout[w] = 1;
          w++;
          since = 0;
        }
        lastDoor = di;
        continue;
      }
      px = cx;
      pz = cz;
      since++;
      if (k !== 0 && since % 3 !== 0) continue;
      out[w * 2] = cx;
      out[w * 2 + 1] = cz;
      if (kout) kout[w] = 0;
      w++;
    }
    return w;
  }
}

/** Blocking one-shot plan (tests / debugging). */
function planPath(world, sx, sz, gx, gz, out, opts = {}) {
  const p = opts.planner || new Planner(world, !!opts.legacy);
  const b = { path: out, pathK: opts.kinds || null, planQueued: false, planN: 0 };
  p.request(b, sx, sz, gx, gz);
  let r = null;
  while (!r) r = p.step(1e9);
  return b.planN;
}

/** Appends waypoint (x, z) of kind k to P / K at n (dropped past PATH_MAX); returns the count. */
function pushWp(P, K, n, x, z, k) {
  if (n >= PATH_MAX) return n;
  P[n * 2] = x;
  P[n * 2 + 1] = z;
  K[n] = k;
  return n + 1;
}

/** Storey of interior plan `plan` holding feet height y (the highest floor at or below it). */
function levelAt(plan, y) {
  const L = plan.levels;
  if (y == null || !Number.isFinite(y)) return 0;
  let k = 0;
  for (let i = 1; i < L.length; i++) if (L[i].y <= y + LEVEL_SLACK) k = i;
  return k;
}

/**
 * Room (id) of storey lv of `plan` holding world (x, z): the room rect (frame-local a0..b1)
 * containing it, else the nearest rect; -1 when the storey has no rooms.
 */
function roomAt(plan, lv, x, z) {
  const L = plan.levels[lv];
  if (!L || !L.rooms.length) return -1;
  const F = plan.frame;
  const rx = x - F.ox;
  const rz = z - F.oz;
  const la = rx * F.ux + rz * F.uz;
  const lb = rx * F.vx + rz * F.vz;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < L.rooms.length; i++) {
    const r = L.rooms[i];
    const da = la < r.a0 ? r.a0 - la : la > r.a1 ? la - r.a1 : 0;
    const db = lb < r.b0 ? r.b0 - lb : lb > r.b1 ? lb - r.b1 : 0;
    const d = da * da + db * db;
    if (d < bestD) {
      bestD = d;
      best = r.id ?? i;
      if (d === 0) break;
    }
  }
  return best;
}

function shellKey(i, j) {
  return (i + 32768) * 65536 + (j + 32768);
}

/** The storm as a drop centre ({cx, cz}) when it has one, else null. */
function ctxStorm(storm) {
  return storm && Number.isFinite(storm.cx) && Number.isFinite(storm.cz) ? storm : null;
}

function world_pointIn(world, rng, cx, cz, r, out) {
  return world.randomOpenPoint(rng, cx, cz, r, 0.9, out);
}

export { planPath as _planPath }; // for tests
