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
import { botLoadout } from './Cosmetics.js';
import { Inventory } from './Inventory.js';
import {
  PLAYER, WEAPONS, CONSUMABLES, PICKAXE, BUILD, MATERIALS, RARITIES, DIFFICULTY, QUALITY,
  BOT_NAMES, DROP_ZONES, STORM, KNOCK, REBOOT, SWIM, angleDelta, clamp, weaponStats,
} from '../core/config.js';
import { sameTeam } from './Teams.js';
import { PRESETS, simpleEditMask } from './Structures.js';
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
const BOX_MIN = 8; // metres: closer than this a bot boxes the enemy in, never itself
const BOX_LEAVE = 60; // metres: a target this far away ends the box fight
const CELL_HALF = BUILD.cell / 2;
const WALL_EVERY_DMG = 30; // damage taken between two walls toward a guessed shooter (_wallOnHit)
const TRAP_RANGE = 14; // metres: a bot may full-box a target this close (diff.trap); was 11
const TRAP_TIME = 9; // s a trap is worked before the bot moves on
const TRAP_SEEN = 1.0; // s: a target seen this recently may still be trapped (a closed box peek hides it)
// normal bots trap now and then (DIFFICULTY.normal has no `trap`); easy never does
const TRAP_FALLBACK = { normal: 0.4 };
// getting shot: how much of DIFFICULTY.reaction is left before the first shot back (notifyDamage)
const HIT_REACT = { easy: 0.35, normal: 0.12, hard: 0 };
// grudge (_grudgeTick): an enemy that shot us (or that we shot at) is hunted until it dies,
// gets this far away (m), or the storm forces a rotation; the bot "hears" where it is every
// GRUDGE_REFRESH s while it is out of sight
const GRUDGE_RANGE = { easy: 90, normal: 130, hard: 220 };
const GRUDGE_REFRESH = { easy: 3, normal: 2, hard: 1 };
// hard bots shot from range build a ramp-wall tower toward the shooter and hold its top (_towerUp)
const TOWER_LEVELS = 4; // ramps (each: the ramp + a wall on its far edge), mats permitting
const TOWER_MIN = 3;
const LANDING_MATS = { easy: 0, normal: 60, hard: 120 }; // wood a bot holds on landing
const TOWER_NEAR = 20; // m: closer fights are boxed / trapped instead
const TOWER_FAR = 120;
const TOWER_CLOSE = 10; // m: an enemy this close ends a tower (fight it instead)
const HIT_FRESH = 4; // s without being hit before a hit counts as a fresh attack (instant cover)
// enclosure check (_enclosureCheck): walled in on our own cell with nothing to fight
const ENCLOSED_EVERY = 0.5; // s between checks
const ENCLOSED_WALLS = 3; // closed walls around our cell that count as boxed in
// Crystal Bridges (bespoke landmark): a share of the lobby always drops there (_crystalBridgesShare)
const CB_KEY = 'crystal_bridges';
const CB_SHARE = 0.07; // ~7 of 99 bots
const CB_MIN_FULL = 4; // at least this many in a big lobby (>= CB_FULL bots)
const CB_FULL = 60;
const CB_MAX = 8;
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
const SHADOW_DIST = 55; // metres: bots farther than this cast no shadow
const DEAD_ANIM = 3; // seconds a death animation plays before the pose is frozen
// building
const BUILD_Q = 16; // most queued pieces in one build response
// Simple Build / Simple Edit variety (Structures.PRESETS, simpleEditMask)
const COVER_ON_HIT = 0.35; // share of hit reactions (x diff.wallOnHit) that raise a cover pocket
const TOWER_CHANCE = 0.4; // enemy above: tower up instead of a ramp rush
const COVER_CHANCE = 0.25; // mid range, not hurt: a cover pocket instead of a wall / ramp
const SIMPLE_EDIT_CHANCE = 0.35; // a peek uses the tile's simple-edit shape when it still lines up
const HEAR = 160; // metres: gunfire this close can draw a bot in (third party)
const BUILD_ROOM = 0.85; // bots stop starting builds past this share of BUILD.maxPieces
const RECLAIM_AT = 0.6; // past this share of BUILD.maxPieces, old bot pieces are taken down (_reclaimPieces)
const RECLAIM_TO = 0.5;
const RECLAIM_MAX = 40; // pieces per second at most
const RECLAIM_CLEAR = 40; // m: never near a human player
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
    this._baseDiffName = this.diffName; // the match's difficulty (per-bot: b.diffName, _useDiff)
    if (opts.quality) this.setQuality(opts.quality);
    const names = shuffled(opts.names || BOT_NAMES, rng);
    // fallback drop area centre: opts.center {x,z} or opts.storm (its first circle), else the origin
    const sc = opts.center || opts.storm || ctxStorm(this._storm);
    const points = this._dropTargets(count, rng, opts.dropPoints, sc, opts.teams);
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
        const ch = new Character(kit, { weapons: this.weaponModels, canopyColor: CANOPY_COLORS[i % CANOPY_COLORS.length], ...botLoadout(actor.id) });
        ch.root.position.copy(actor.pos);
        ch.root.visible = false;
        actor.character = ch;
        if (this.scene) this.scene.add(ch.root);
      }
      const b = newBrain(actor, t, rng);
      b.diffName = this.diffName;
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

  _dropTargets(count, rng, dropPoints, centre, teams = null) {
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
    this._crystalBridgesShare(out, rng, teams);
    return out;
  }

  /** How many of `count` bots should land at Crystal Bridges (7% of the lobby, 4..8 when full). */
  static crystalBridgesQuota(count) {
    if (!(count > 0)) return 0;
    const lo = count >= CB_FULL ? CB_MIN_FULL : count >= 8 ? 1 : 0;
    return Math.min(CB_MAX, count, Math.max(lo, Math.round(count * CB_SHARE)));
  }

  /**
   * The museum (bespoke POI) drew almost nobody from the spread-out planner: move landing
   * spots there until crystalBridgesQuota(n) bots land on its site. Team modes move whole teams
   * (consecutive bots sharing a team id) so a team still lands together. Edits `out` in place.
   */
  _crystalBridgesShare(out, rng, teams) {
    const world = this.world;
    const lm = world.landmarks && world.landmarks[CB_KEY];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.z) || !world.randomOpenPoint) return 0;
    // "at the museum": the inner ravine / pavilions, not the wooded rim of its tile
    const siteR = clamp(lm.r || 100, 40, 125) * 0.75;
    const scatter = siteR * 0.9;
    const at = (p) => p && Math.hypot(p.x - lm.x, p.z - lm.z) < siteR;
    const want = Bots.crystalBridgesQuota(out.length);
    let have = 0;
    for (const p of out) if (at(p)) have++;
    // groups of bot indices that land together (a team; solo: one bot each), not there yet
    const groups = [];
    for (let i = 0; i < out.length; i++) {
      const same = teams && i > 0 && teams[i] != null && teams[i] === teams[i - 1];
      if (same) groups[groups.length - 1].push(i);
      else groups.push([i]);
    }
    const free = groups.filter((g) => !g.some((i) => at(out[i])));
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    const spot = { x: 0, z: 0 };
    for (const g of free) {
      if (have >= want) break;
      world.randomOpenPoint(rng, lm.x, lm.z, scatter, 1.2, spot);
      for (const i of g) out[i] = world.randomOpenPoint(rng, spot.x, spot.z, g.length > 1 ? 4 : 0.5, 1.2, { x: 0, z: 0 });
      have += g.length;
    }
    return have;
  }

  /**
   * One more bot, standing at (x, z) right now (no bus, no glide), with its OWN difficulty:
   * the sandbox spawner (Game.spawnSandboxBot). opts: name, loadout (Inventory.reset),
   * team (default: its own id), heading, sandbox (tag, default true). Returns the actor.
   * Existing bots are untouched (spawn() replaces them all).
   */
  addBot(diffName, x, z, opts = {}) {
    const world = this.world;
    const name = DIFFICULTY[diffName] ? diffName : 'normal';
    if (!this._baseDiffName) this._baseDiffName = this.diffName || 'normal';
    let id = opts.id;
    if (id == null) {
      id = 9000;
      for (const o of this.actors) if (o.id >= id) id = o.id + 1;
    }
    const y = world.groundHeight ? world.groundHeight(x, z, 1e4) : 0;
    const actor = {
      id,
      name: opts.name || `${name.toUpperCase()} BOT`,
      isPlayer: false,
      isBot: true,
      team: opts.team ?? id,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      heading: opts.heading || 0,
      pitch: 0,
      radius: PLAYER.radius,
      height: PLAYER.height,
      health: PLAYER.maxHealth,
      shield: opts.shield ?? 0,
      alive: true,
      kills: 0,
      inventory: new Inventory(opts.loadout),
      character: null,
      gliding: false,
      grounded: true,
      inBus: false,
      damageScale: DIFFICULTY[name].damageScale,
      botState: 'wander',
      sandbox: opts.sandbox !== false,
    };
    if (this.kits.length) {
      const kit = this.kits[id % this.kits.length];
      const ch = new Character(kit, { weapons: this.weaponModels, canopyColor: CANOPY_COLORS[id % CANOPY_COLORS.length], ...botLoadout(id) });
      ch.root.position.copy(actor.pos);
      actor.character = ch;
      if (this.scene) this.scene.add(ch.root);
      const cur = actor.inventory.current();
      if (ch.setEquipped) {
        const wid = cur && cur.type === 'weapon' ? cur.id : 'pickaxe';
        ch.setEquipped(wid, WEAPONS[wid] ? WEAPONS[wid].twoHanded !== false : true);
      }
    }
    const b = newBrain(actor, { x, z }, this.rng);
    b.diffName = name;
    b.sandbox = actor.sandbox;
    b.state = 'wander';
    b.launchAt = 0;
    b.landedAt = this.time;
    b.thinkIn = 0.05;
    actor._bot = b;
    this.actors.push(actor);
    this.brains.push(b);
    if (this.combat) this.combat.register(actor);
    return actor;
  }

  /** Removes every bot `pred(actor)` accepts (dead or alive). Returns how many went. */
  removeBots(pred) {
    let n = 0;
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i];
      if (!pred(a)) continue;
      const b = a._bot;
      if (b) {
        if (b.box) this._endBox(b);
        if (b.trap) this._endTrap(b);
        this.planner.cancel(b);
      }
      if (this.combat) this.combat.unregister(a);
      if (a.character) a.character.dispose();
      a.alive = false;
      a._bot = null;
      this.actors.splice(i, 1);
      const k = this.brains.indexOf(b);
      if (k >= 0) this.brains.splice(k, 1);
      n++;
    }
    return n;
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

  /**
   * Bots build a lot (towers, boxes, traps), and Structures stops at BUILD.maxPieces; bots stop
   * starting builds at BUILD_ROOM of it, so after a couple of minutes of hard bots nobody could
   * build at all. Past RECLAIM_AT of the cap, the oldest bot-built pieces that no human is near
   * (RECLAIM_CLEAR m) and that no bot is still fighting from are taken down, back to RECLAIM_TO.
   * Player-built pieces are never touched. Runs on the simulating side only (host / solo), so
   * removals sync to clients like any other destroyed piece.
   */
  _reclaimPieces(all) {
    const st = this.structures;
    if (!st || !st.pieces || !st.remove) return 0;
    const cap = BUILD.maxPieces;
    // hysteresis: once past RECLAIM_AT keep going (RECLAIM_MAX a call) until below RECLAIM_TO
    if (st.pieces.length >= cap * RECLAIM_AT) this._reclaiming = true;
    else if (st.pieces.length <= cap * RECLAIM_TO) this._reclaiming = false;
    if (!this._reclaiming) return 0;
    const humans = all.filter((x) => x && x.alive && !x.isBot && x.pos).map((x) => x.pos); // (positions: near() reads .x / .z)
    const busy = this.brains.filter((b) => b.actor.alive && (b.tower || b.box || b.trap || b.bqI < b.bqN)).map((b) => b.actor.pos);
    const near = (p, pts, r) => pts.some((q) => Math.abs(q.x - p.x) < r && Math.abs(q.z - p.z) < r && Math.hypot(q.x - p.x, q.z - p.z) < r);
    const want = Math.min(RECLAIM_MAX, st.pieces.length - Math.floor(cap * RECLAIM_TO));
    const old = st.pieces
      .filter((p) => p.alive !== false && p.owner && p.owner.isBot && !near(p, humans, RECLAIM_CLEAR) && !near(p, busy, 14))
      .sort((p, q) => p.id - q.id);
    let n = 0;
    for (const p of old) {
      if (n >= want) break;
      st.remove(p, false);
      n++;
    }
    this.reclaimed = (this.reclaimed || 0) + n;
    return n;
  }

  // ------------------------------------------------------------- awareness

  /** Hook for combat.onDamage: lets a bot react to who hurt it. */
  notifyDamage(victim, amount, info) {
    const b = victim && victim._bot;
    if (!b || !victim.alive) return;
    this._useDiff(b);
    try {
      this._onDamage(b, victim, amount, info);
    } finally {
      this._useDiff(null);
    }
  }

  /**
   * Per-bot difficulty: every brain carries b.diffName (the match's, or its own for sandbox
   * bots, see addBot); the shared this.diff / this.diffName the brain code reads are switched
   * to it while that bot thinks / acts, and back to the match's (`null`) afterwards. Brains
   * without one (hand-built test brains) keep whatever is set.
   */
  _useDiff(b) {
    const name = b ? b.diffName : this._baseDiffName;
    if (!name || !DIFFICULTY[name] || name === this.diffName) return;
    this.diffName = name;
    this.diff = DIFFICULTY[name];
  }

  _onDamage(b, victim, amount, info) {
    const src = info && info.source;
    this._resetPeekOnHit(b);
    if (sameTeam(src, victim)) return;
    const t = this.time;
    b.alertUntil = t + 5;
    if (src && src !== victim && src.alive && src.pos) {
      // a fresh attack (nothing hit us for a while, or someone new): cover goes up right away
      const fresh = t - (b.lastHitAt ?? -Infinity) > HIT_FRESH || b.lastHitBy !== src;
      b.lastHitAt = t;
      b.lastHitBy = src;
      b.hurtAt = t;
      b.threat = src;
      b.thinkIn = Math.min(b.thinkIn ?? 0, 0.05);
      if (!src.isBot) b.lodAt = 0; // a human is on it: back to full rate next frame
      this._awareOf(b, src);
      // the first hit of an attack, then every 30 damage taken: a guess at where it came from,
      // and a wall that way
      b.hitDmg = Math.min(60, (fresh ? 0 : b.hitDmg || 0) + (amount > 0 ? amount : 0));
      this._setGrudge(b, src);
      // (on the same frame: _startQueue places the first piece right away)
      if (b.tower) {
        // up on (or climbing) our tower: its walls are the cover
      } else if (this._tryTower(b, src)) {
        b.hitDmg = 0; // hard, shot from range: height now (any other build is dropped for it)
      } else if (fresh) {
        if (this._wallOnHit(b, src)) b.hitDmg = 0;
      } else if (b.hitDmg >= WALL_EVERY_DMG && this._wallOnHit(b, src)) b.hitDmg -= WALL_EVERY_DMG;
    }
  }

  /**
   * Shot by `src`: know about them NOW (no awareness ramp). The bot targets them, turns toward
   * them (hard: instantly; others keep TURN_RATE) and shoots back after HIT_REACT of its usual
   * reaction delay (hard: none). A shooter behind cover is chased to where the shots came from.
   */
  _awareOf(b, src) {
    const a = b.actor;
    const t = this.time;
    if (b.state === 'drop' || a.inBus || a.downed) return;
    const switching = b.target !== src;
    const react = (this.diff.reaction || 0) * (HIT_REACT[this.diffName] ?? 0.3);
    if (switching || !b.targetVisible) {
      b.reactLeft = switching ? react : Math.min(b.reactLeft ?? react, react);
      b.trackTime = switching ? 0 : b.trackTime || 0;
      if (switching) b.burstLeft = 0;
    } else b.reactLeft = Math.min(b.reactLeft ?? react, react);
    b.target = src;
    b.lastSeen = t;
    b.lastSeenX = src.pos.x;
    b.lastSeenZ = src.pos.z;
    const ex = a.pos.x;
    const ey = a.pos.y + EYE;
    const ez = a.pos.z;
    b.targetVisible = !this.world || !this.world.clearLine || this._los(ex, ey, ez, src.pos.x, src.pos.y + CHEST, src.pos.z);
    b.faceX = src.pos.x;
    b.faceZ = src.pos.z;
    const want = Math.atan2(src.pos.x - ex, -(src.pos.z - ez));
    if (this.diffName === 'hard') a.heading = want; // a flick toward the shooter
    else a.heading += angleDelta(a.heading, want) * (this.diffName === 'normal' ? 0.5 : 0.25);
    // fight now: think next frame (the state machine moves us into 'engage')
    b.thinkIn = 0;
  }

  /** Hunt `e` until it dies / leaves GRUDGE_RANGE / the storm calls (see _grudgeTick). */
  _setGrudge(b, e) {
    if (!e || !e.alive || !e.pos || e === b.actor || sameTeam(e, b.actor)) return;
    const g = b.grudge;
    if (g && g.actor === e) return;
    b.grudge = { actor: e, since: this.time, refreshAt: 0 };
  }

  /**
   * Think-time grudge upkeep: ends it (enemy dead, out of range, storm pressure), else keeps
   * the enemy as the target when nothing else is in plain sight (the perception timeouts
   * drop a lost target; this puts it back) and refreshes where it is while it is hidden.
   * Returns the hunted enemy or null.
   */
  _grudgeTick(b, urgent) {
    const g = b.grudge;
    if (!g) return null;
    const a = b.actor;
    const e = g.actor;
    const t = this.time;
    const range = GRUDGE_RANGE[this.diffName] ?? GRUDGE_RANGE.normal;
    if (!e || !e.alive || urgent || a.downed || sameTeam(e, a) || Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) > range) {
      b.grudge = null;
      b.towerLost = false;
      return null;
    }
    if (b.target !== e && !(b.target && b.target.alive && b.targetVisible)) {
      b.target = e;
      b.targetVisible = false;
      g.refreshAt = 0;
    }
    if (b.target === e && !b.targetVisible && t >= g.refreshAt) {
      g.refreshAt = t + (GRUDGE_REFRESH[this.diffName] ?? 2);
      b.lastSeen = t;
      b.lastSeenX = e.pos.x;
      b.lastSeenZ = e.pos.z;
    }
    return e;
  }

  /**
   * Hard bots shot from TOWER_NEAR..TOWER_FAR m: a ramp-wall tower climbing toward the shooter
   * (per level: the ramp, then a wall on its far edge), then climb it and hold the top ramp, shooting over the top wall
   * (_towerTick). Placed one piece per buildRate through _buildStep (mats, slots and
   * BUILD.maxPieces apply); the first piece goes down on this frame. True when started.
   */
  /**
   * Hard bot shot by `src` from TOWER_NEAR..TOWER_FAR m: clear the way for a tower and start
   * it. Another build queue in progress is dropped (a box going up while healing is kept), a
   * box fight ends with a door toward the shooter, and a bot in the air remembers the wish
   * (b.towerWant) until it lands. True when the tower started.
   */
  _tryTower(b, src) {
    const a = b.actor;
    const t = this.time;
    if (this.diffName !== 'hard' || !this.structures || !src || !src.alive || !src.pos || b.tower || b.trap || a.downed || b.stormUrgent) return false;
    const d = Math.hypot(src.pos.x - a.pos.x, src.pos.z - a.pos.z);
    if (d < TOWER_NEAR || d > TOWER_FAR) return false;
    b.towerWant = { src, until: t + 3 };
    if (!a.grounded) return false; // landing first
    if (b.box) {
      if (b.healing > 0) return false;
      b.target = src;
      this._endBox(b, DOOR);
    }
    if (b.bqI < b.bqN) {
      if (b.bqMode === 'box' && b.healing > 0) return false;
      b.bqN = 0;
      b.bqI = 0;
      b.rushUntil = 0;
      b.holdUntil = 0;
      b.buildCooldown = t;
    }
    if (!this._towerUp(b, src)) return false;
    b.towerWant = null;
    return true;
  }

  /**
   * Think-time: a tower is worked against ITS target. A bot that perceives someone else (the
   * 99-bot lobby is full of them) swaps back to the tower's target unless that one is dead /
   * out of range (the tower ends) or the other enemy is within TOWER_CLOSE m (the tower ends:
   * fight what is in your face).
   */
  _towerHold(b) {
    const tw = b.tower;
    if (!tw) return;
    const a = b.actor;
    const e = tw.target;
    const range = GRUDGE_RANGE[this.diffName] ?? GRUDGE_RANGE.normal;
    if (!e || !e.alive || Math.hypot(e.pos.x - a.pos.x, e.pos.z - a.pos.z) > range) {
      b.tower = null;
      return;
    }
    const o = b.target;
    if (o === e) return;
    if (o && o.alive && o.pos && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < TOWER_CLOSE) {
      b.tower = null;
      return;
    }
    const t = this.time;
    b.target = e;
    b.targetVisible = this._los(a.pos.x, a.pos.y + EYE, a.pos.z, e.pos.x, e.pos.y + CHEST, e.pos.z);
    if (b.targetVisible) b.lastSeen = t;
    if (b.targetVisible || t - (b.lastSeen ?? -Infinity) > 1) {
      b.lastSeen = t;
      b.lastSeenX = e.pos.x;
      b.lastSeenZ = e.pos.z;
    }
    if (!b.grudge || b.grudge.actor !== e) b.grudge = { actor: e, since: t, refreshAt: 0 };
  }

  _towerUp(b, src) {
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    if (!st || this.diffName !== 'hard' || !src || !src.pos || a.downed || !a.grounded) return false;
    if (b.box || b.trap || b.tower || b.bqI < b.bqN || t < (b.towerAt || 0) || b.stormUrgent) return false;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM - TOWER_LEVELS * 3) return false;
    const dx = src.pos.x - a.pos.x;
    const dz = src.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < TOWER_NEAR || d > TOWER_FAR) return false;
    const mat = bestMat(a.inventory);
    let afford = 0;
    for (const m of MATERIALS) afford += Math.floor((a.inventory.mats[m] || 0) / BUILD.cost);
    const levels = Math.min(TOWER_LEVELS, Math.floor(afford / 2), Math.floor((d - 8) / BUILD.cell), Math.floor(BUILD_Q / 3));
    if (!mat || levels < TOWER_MIN) return false;
    const hs = (Math.round(Math.atan2(dx, -dz) / (Math.PI / 2)) * Math.PI) / 2;
    const ux = Math.sin(hs);
    const uz = -Math.cos(hs);
    // per level: the ramp, then a wall on its far edge (a wall between us and them on every
    // level), each placed off the ramp actually built below it (chainStep)
    // order r0 r1 w0 r2 w1 ... : a ramp's wall goes up only after the next ramp, since
    // Structures.plan keeps a ramp out of a cell behind a wall (it would stack in place)
    let n = 0;
    for (let i = 0; i < levels; i++) {
      n = chainStep(b, n, 'ramp', hs);
      if (i > 0) n = chainStep(b, n, 'wall', hs, 0, 1);
    }
    n = chainStep(b, n, 'wall', hs);
    b.chainRamp = null;
    b.chainRamps = 0;
    // the top (hold point, top ramp) is known once the ramps are up: _towerTick reads chainRamp
    b.tower = { target: src, since: t, levels, hs, ux, uz, top: null, topX: 0, topZ: 0, topY: 0, reached: false, checkAt: 0 };
    b.towers = (b.towers || 0) + 1;
    b.towerLost = false;
    this._startQueue(b, n, 'tower', mat, ux, uz);
    b.rushUntil = t + 0.5;
    return true;
  }

  /**
   * Engage-state hook while a tower is up: climb to its top ramp and hold there (the shooting
   * is _act's), or drop it when it is broken / the target is gone (b.towerLost: take height
   * again). Writes the steering goal to _pt; returns false when there is no tower any more.
   */
  _towerTick(b, target) {
    const tw = b.tower;
    const a = b.actor;
    const t = this.time;
    const st = this.structures;
    if (!st || !tw.target || !tw.target.alive || b.stormUrgent || a.downed) {
      b.tower = null;
      return false;
    }
    if (target !== tw.target) return false; // this frame's fight is elsewhere (_towerHold decides)
    const building = b.bqMode === 'tower' && b.bqI < b.bqN;
    const r = b.bqMode === 'tower' || !tw.top ? b.chainRamp : tw.top;
    if (r && r.alive && r !== tw.top) {
      // the highest ramp so far: climb toward its high end (eyes over its wall)
      tw.top = r;
      tw.topX = r.x + tw.ux * BUILD.cell * 0.38;
      tw.topZ = r.z + tw.uz * BUILD.cell * 0.38;
      tw.topY = r.y + BUILD.level;
    }
    // at the hold point itself: from the middle of the top ramp its rising high end still
    // hides a target below (the eyes must clear the top of the ramp and its wall)
    const near = tw.top && Math.hypot(a.pos.x - tw.topX, a.pos.z - tw.topZ) < 0.8;
    if (near && !building && a.pos.y > tw.topY - 1.4) tw.reached = true;
    let broken = false;
    if (t >= tw.checkAt) {
      tw.checkAt = t + 0.3;
      if (!building && !(tw.top && tw.top.alive)) broken = true; // shot out / never fit
      if (tw.reached && a.grounded && a.pos.y < tw.topY - 2.8) broken = true; // knocked off it
      if (!tw.reached && b.bqI >= b.bqN && t - tw.since > tw.levels * 1.5 + 4) broken = true; // could not climb
      // up top but they are out of sight (moved under / behind something) for a while: come
      // down and fight from where they are now (a new tower toward them if needed)
      if (tw.reached && !b.targetVisible) {
        if (!tw.hiddenSince) tw.hiddenSince = t;
        else if (t - tw.hiddenSince > 3) broken = true;
      } else tw.hiddenSince = 0;
    }
    if (broken) {
      b.tower = null;
      b.towerLost = true;
      b.towerAt = t + 0.6;
      b.rushUntil = 0;
      return false;
    }
    if (tw.reached) {
      _pt.x = a.pos.x;
      _pt.z = a.pos.z;
    } else if (!tw.top) {
      // first ramp not up yet: hold here (it goes up ahead of us)
      _pt.x = a.pos.x;
      _pt.z = a.pos.z;
    } else {
      _pt.x = tw.topX;
      _pt.z = tw.topZ;
      b.rushUntil = t + 0.4; // straight up our own ramps (no avoidance feelers)
    }
    return true;
  }

  /**
   * Shot at (every WALL_EVERY_DMG damage taken): throw a wall toward where we GUESS the shots
   * came from (a box when low), the first thing a good player does. Skipped mid-build, mid-air,
   * knocked or without mats: returns false then, so the damage keeps counting toward the next.
   */
  _wallOnHit(b, src) {
    const st = this.structures;
    const a = b.actor;
    const diff = this.diff;
    if (!st || !diff.wallOnHit || a.downed || !a.grounded || b.bqI < b.bqN) return false;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return false;
    const mat = bestMat(a.inventory);
    if (!mat) return false;
    const fx = src.pos.x - a.pos.x;
    const fz = src.pos.z - a.pos.z;
    // a guess at where the shots came from: off by guessError, and now and then the wrong side
    // entirely (misguess), like a player who only heard the hit
    let ang = Math.atan2(fx, -fz) + gauss(this.rng) * (diff.guessError || 0);
    if (this.rng() < (diff.misguess || 0)) ang += this.rng() < 0.3 ? Math.PI : (this.rng() < 0.5 ? 1 : -1) * (Math.PI / 2);
    b.guessedHit = ang;
    const hs = (Math.round(ang / (Math.PI / 2)) * Math.PI) / 2;
    const low = a.health + a.shield < 60;
    let n;
    let mode = 'wall';
    if (low && diff.buildPieces >= 5 && this.rng() < diff.boxHeal) {
      n = this._queueBox(b, 0, hs);
      mode = 'box';
    } else if (diff.buildPieces >= 3 && this.rng() < COVER_ON_HIT * (diff.wallOnHit || 0)) {
      n = this._queuePreset(b, 0, 'cover', hs); // three walls: covered from the shot and both flanks
    } else n = queueStep(b, 0, 'wall', a.pos.x, a.pos.y, a.pos.z, ang, 0);
    this._startQueue(b, n, mode, mat, Math.sin(hs), -Math.cos(hs));
    return true;
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

  /**
   * A Simple Build preset (Structures.PRESETS: box, rampwall, tower, cover) around the bot's own
   * cell from piece n, facing heading hs: the same structures a player gets from the preset key.
   */
  _queuePreset(b, n, name, hs) {
    const preset = PRESETS[name];
    if (!preset) return n;
    const a = b.actor;
    const cx = (Math.floor(a.pos.x / BUILD.cell) + 0.5) * BUILD.cell;
    const cz = (Math.floor(a.pos.z / BUILD.cell) + 0.5) * BUILD.cell;
    for (const [kind, q, pitch] of preset.parts) n = queueStep(b, n, kind, cx, a.pos.y, cz, hs + q * (Math.PI / 2), pitch || 0);
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
    // up close they get boxed in (_maybeTrap), not us with them
    if (!st || !diff.boxFight || !target || !target.alive || dist > BOX_RANGE || dist < BOX_MIN || !a.grounded) return false;
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
    // the enemy came in here with us: no peeks (a window in our own wall shows nothing). Box
    // THEM in instead: cut a door, step out, shut it behind us and work them from outside (the
    // exit in the update loop hands over to a trap when it is through)
    const tgIn = b.target && b.target.alive ? b.target : null;
    if (tgIn && Math.hypot(tgIn.pos.x - bx.x, tgIn.pos.z - bx.z) < CELL_HALF + 0.3 && Math.abs(tgIn.pos.y - bx.y) < 2) {
      if (bx.peek === 'open' || bx.editKey) this._closePeek(bx);
      bx.peek = 'closed';
      this._endBox(b, DOOR, true);
      return;
    }
    if (bx.peek === 'open' && bx.blocked > 3 && bx.editKey) {
      // the window does not line up with them: open the full door instead
      const w = this.structures.slots.get(bx.editKey);
      const tg = b.target;
      const dm = w && tg ? this._peekMask(b, w, tg.pos.x, tg.pos.y, tg.pos.z, true) : DOOR;
      if (w && w.alive && w.edit !== dm) this._botEdit(b, w, dm);
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
      const close = Math.hypot(tx - a.pos.x, tz - a.pos.z) < 9;
      const ty = b.target ? b.target.pos.y : a.pos.y;
      // edit whatever of ours is actually on the line to them: the roof cone / floor when they
      // are above us, else the facing wall at the tile the line crosses (not always the middle)
      const own = this._ownBlocker(b, tx, ty, tz);
      const w = own || this._boxWall(b, face);
      if (!w) {
        bx.peekT = t + 0.2;
        return;
      }
      this._botEdit(b, w, w.kind === 'wall' ? this._peekMask(b, w, tx, ty, tz, close && !diff.peekWindow) : this._quarterMask(w, tx, tz)); // hard: window first (door if it does not line up)
      bx.extraKeys = this._openRestOfLine(b, w, tx, ty, tz); // a trap wall of ours behind it too
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
      this._closePeek(bx);
      bx.peek = 'closed';
      bx.peekT = t + diff.peekClosed * (0.7 + this.rng() * 0.8);
    }
  }

  /**
   * Edit mask for a peek through wall `w` at a target at (tx, ty, tz): the 3 x 3 tile where the
   * line from the bot's eyes to the target's chest crosses the wall (index = row * 3 + col, row 0
   * at the bottom), so the window lines up with them. door: that column's bottom two tiles.
   * Falls back to the centre window / door when the line does not cross the wall plane.
   */
  _peekMask(b, w, tx, ty, tz, door = false) {
    const a = b.actor;
    const ux = Math.cos(w.rot);
    const uz = Math.sin(w.rot); // the wall's local +x (Structures draws it with rotation.y = -rot)
    const nx = -uz;
    const nz = ux;
    const ex = a.pos.x;
    const ey = a.pos.y + EYE;
    const ez = a.pos.z;
    const dB = (w.x - ex) * nx + (w.z - ez) * nz;
    const dT = (tx - ex) * nx + (tz - ez) * nz;
    const tw = BUILD.cell / 3;
    const th = BUILD.level / 3;
    let col = 1;
    let row = 1;
    let cols = [1];
    let rows = [1];
    if (Math.abs(dT) > 1e-3 && dB / dT > 0 && dB / dT < 1) {
      const f = dB / dT;
      const hx = ex + (tx - ex) * f;
      const hz = ez + (tz - ez) * f;
      const hy = ey + (ty + CHEST - ey) * f;
      const u = (hx - w.x) * ux + (hz - w.z) * uz + 1.5 * tw; // 0 .. 3 tw across the wall
      const v = hy - w.y; // 0 .. 3 th up the wall
      col = Math.max(0, Math.min(2, Math.floor(u / tw)));
      row = Math.max(0, Math.min(2, Math.floor(v / th)));
      // a line close to a tile edge (a body is ~0.8 m wide, aim scatters): open the neighbour too
      const near = (x, i, size, edge) => (x - i * size < edge && i > 0 ? [i - 1, i] : (i + 1) * size - x < edge && i < 2 ? [i, i + 1] : [i]);
      cols = near(u, col, tw, 0.4);
      rows = near(v, row, th, 0.3);
    }
    let m = 0;
    if (door || row === 0) {
      // a door in that column (both columns when the line runs along their edge), plus the tile
      // the line crosses when it runs higher than a door
      for (const c of cols) m |= (1 << c) | (1 << (3 + c));
      if (row === 2) for (const c of cols) m |= 1 << (6 + c);
    } else for (const r of rows) for (const c of cols) m |= 1 << (r * 3 + c);
    // now and then the simple-edit shape for that tile instead (a door, a half wall, an arch):
    // more varied edits, and still open where the line to the target crosses
    if (this.rng() < SIMPLE_EDIT_CHANCE) {
      const s = simpleEditMask('wall', row * 3 + col);
      if (s > 0 && (s & m) === m) m = s;
    }
    return m === 0x1ff ? 1 << 4 : m;
  }

  /**
   * After opening `first`, open every other piece of ours still on the line to the target (a
   * box wall and the trap wall around them, or a roof cone): one window that lines up is useless
   * behind a second closed wall. Returns their keys (reset with the peek), at most 3.
   */
  _openRestOfLine(b, first, tx, ty, tz) {
    const st = this.structures;
    const out = [];
    for (let i = 0; i < 3; i++) {
      const p = this._ownBlocker(b, tx, ty, tz);
      if (!p || p === first || out.includes(p.key)) break;
      const m = p.kind === 'wall' ? this._peekMask(b, p, tx, ty, tz, false) : this._quarterMask(p, tx, tz);
      if (!this._botEdit(b, p, m)) break;
      out.push(p.key);
    }
    return out.length ? out : null;
  }

  /**
   * Edit one of our pieces, and swing any door that edit makes open, away from us. A door edit
   * is a closed door until someone opens it (Structures doorColumns: it blocks bodies and shots);
   * bots used to cut doors and never open them, so a "door" out of a box sealed it.
   */
  _botEdit(b, p, mask) {
    const st = this.structures;
    if (!st || !st.edit(p, mask)) return false;
    const dc = p.kind === 'wall' && st.doorColumns ? st.doorColumns(p) : 0;
    if (dc) {
      const a = b.actor;
      // the wall's local +z (Structures: local x = (cos rot, sin rot)); open toward the far side
      const lz = (a.pos.x - p.x) * -Math.sin(p.rot) + (a.pos.z - p.z) * Math.cos(p.rot);
      for (let c = 0; c < 3; c++) if (dc & (1 << c)) st.setDoor(p, c, lz < 0 ? 1 : -1);
    }
    return true;
  }

  /** Reset a peek's edits (the main piece and any opened behind it). */
  _closePeek(pk) {
    const st = this.structures;
    if (!pk || !st) return;
    for (const key of [pk.editKey, ...(pk.extraKeys || [])]) {
      const w = key && st.slots.get(key);
      if (w && w.alive && w.edit) st.edit(w, 0);
    }
    pk.editKey = null;
    pk.extraKeys = null;
  }

  /** First built piece of this bot's on the line from its eyes to (tx, ty + CHEST, tz), or null. */
  _ownBlocker(b, tx, ty, tz) {
    const a = b.actor;
    const w = this.world;
    if (!w || !w.raycast) return null;
    const ex = a.pos.x;
    const ey = a.pos.y + EYE;
    const ez = a.pos.z;
    const dx = tx - ex;
    const dy = ty + CHEST - ey;
    const dz = tz - ez;
    const L = Math.hypot(dx, dy, dz);
    if (L < 0.1) return null;
    const h = w.raycast(ex, ey, ez, dx / L, dy / L, dz / L, Math.min(L, 16));
    const c = h && h.collider;
    return c && c.isStructure && c.alive !== false && c.owner === a && c.kind !== 'ramp' ? c : null;
  }

  /** Cone / floor edit opening the quarter toward (tx, tz) (2 x 2: bit = col + 2 * row, local). */
  _quarterMask(p, tx, tz) {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const c = Math.cos(p.rot || 0);
    const s = Math.sin(p.rot || 0);
    const lx = dx * c + dz * s;
    const lz = -dx * s + dz * c;
    return 1 << ((lx > 0 ? 1 : 0) | (lz > 0 ? 2 : 0));
  }

  /**
   * Shot while a peek (box or trap window / door) is open: reset the edit at once, like a player
   * taking a hit mid-peek, then reopen after a short beat (hard bots reopen sooner).
   */
  _resetPeekOnHit(b) {
    const st = this.structures;
    if (!st || this.diffName === 'easy') return false;
    const t = this.time;
    for (const pk of [b.box, b.trap]) {
      if (!pk || pk.peek !== 'open' || !pk.editKey) continue;
      this._closePeek(pk);
      pk.peek = 'closed';
      pk.peekT = t + this.diff.peekClosed * (this.diffName === 'hard' ? 0.6 : 1) * (0.7 + this.rng() * 0.6);
      return true;
    }
    return false;
  }

  /** Leaves the box: closes the peek, or edits a door toward the target to push out. */
  /**
   * Out of our box with the enemy still inside it: shut the door behind us (the wall goes back
   * solid) and work them from outside with window peeks, like a trap we built around them.
   */
  _sealIn(b, ex) {
    const st = this.structures;
    const tg = b.target;
    const w = st && st.slots.get(ex.seal);
    if (!w || !w.alive || !tg || !tg.alive) return false;
    if (Math.hypot(tg.pos.x - ex.cx, tg.pos.z - ex.cz) > CELL_HALF + 0.3 || Math.abs(tg.pos.y - ex.y) > 2) return false;
    st.edit(w, 0);
    const t = this.time;
    b.trap = { x: ex.cx, y: ex.y, z: ex.cz, face: ex.face, since: t, peek: 'closed', peekT: t + 0.25, editKey: null };
    b.traps = (b.traps || 0) + 1;
    return true;
  }

  _endBox(b, mask = 0, seal = false) {
    const bx = b.box;
    if (!bx) return;
    const st = this.structures;
    this._closePeek(bx);
    // still inside when the fight ends (target gone, storm): edit a door out, or the bot is
    // sealed in its own four walls and roof for good (it bounced around in there)
    const a = b.actor;
    const inside = a && Math.hypot(a.pos.x - bx.x, a.pos.z - bx.z) < CELL_HALF + 0.3 && Math.abs(a.pos.y - bx.y) < 2;
    if (!mask && inside) mask = DOOR;
    if (mask && st) {
      const tg = b.target && b.target.alive ? b.target : null;
      // sealing them in: out on our side of the box (away from them), not through them
      const ang = seal && a ? Math.atan2(a.pos.x - bx.x, -(a.pos.z - bx.z)) : tg ? Math.atan2(tg.pos.x - bx.x, -(tg.pos.z - bx.z)) : a ? a.heading || 0 : 0;
      const face = (Math.round(ang / (Math.PI / 2)) * Math.PI) / 2;
      const d = this._boxWall(b, face);
      // a door that lines up with them (same column as the line out), not always the middle one
      // (from inside: the middle door, so the walk out below goes straight through it)
      if (d) this._botEdit(b, d, mask === DOOR && tg && !inside ? this._peekMask(b, d, tg.pos.x, tg.pos.y, tg.pos.z, true) : mask);
      if (d && inside && mask === DOOR) {
        // walk out through it (the update loop steers straight to the doorway, then outside)
        const ux = Math.sin(face);
        const uz = -Math.cos(face);
        b.boxExit = { cx: bx.x, cz: bx.z, y: bx.y, face, seal: seal ? d.key : null, dx: bx.x + ux * (CELL_HALF - 0.2), dz: bx.z + uz * (CELL_HALF - 0.2), x: bx.x + ux * (CELL_HALF + 1.4), z: bx.z + uz * (CELL_HALF + 1.4), until: this.time + 3 };
      }
    }
    b.box = null;
    b.holdUntil = 0;
  }

  /**
   * Hard bots: full-box a close, grounded target (4 walls + a cone roof on ITS cell), then work
   * the wall facing us with quick window edits: open, shoot, close. True while trapping (the
   * caller holds the bot still). Players cannot edit someone else's walls: they must break out.
   */
  _maybeTrap(b, target, dist) {
    const diff = this.diff;
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    if (b.trap) return this._trapTick(b, target, dist);
    const chance = diff.trap ?? TRAP_FALLBACK[this.diffName] ?? 0;
    if (!chance || !st || !target || !target.alive || !a.grounded) return false;
    // a target behind our own closed box peek is still "seen" for a moment
    const seen = b.targetVisible || (b.target === target && t - (b.lastSeen ?? -Infinity) < TRAP_SEEN);
    if (!seen || dist > TRAP_RANGE || dist < 3.2 || b.bqI < b.bqN || t < (b.trapRollAt || 0)) return false;
    // hard bots look for the trap every ~2 s; others every 4-7 s
    b.trapRollAt = t + (this.diffName === 'hard' ? 1.2 + this.rng() * 1.2 : 4 + this.rng() * 3);
    if (this.rng() > chance || target.grounded === false) return false;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return false;
    const mat = bestMat(a.inventory);
    let afford = 0;
    for (const m of MATERIALS) afford += Math.floor(a.inventory.mats[m] / BUILD.cost);
    if (!mat || afford < 6) return false;
    const tp = target.pos;
    const cx = (Math.floor(tp.x / BUILD.cell) + 0.5) * BUILD.cell;
    const cz = (Math.floor(tp.z / BUILD.cell) + 0.5) * BUILD.cell;
    if (Math.floor(a.pos.x / BUILD.cell) === Math.floor(tp.x / BUILD.cell) && Math.floor(a.pos.z / BUILD.cell) === Math.floor(tp.z / BUILD.cell)) return false;
    // boxed up ourselves (a box fight that closed in): open a door toward them and trap them
    // (their box is the cover now; a trap used to never start from a box, so it never fired)
    if (b.box) this._endBox(b, DOOR);
    // the side of their cell that faces us goes up last (it is the one we will edit)
    const face = (Math.round(Math.atan2(a.pos.x - cx, -(a.pos.z - cz)) / (Math.PI / 2)) * Math.PI) / 2;
    let n = 0;
    for (const h of [face + Math.PI, face + Math.PI / 2, face - Math.PI / 2, face]) n = queueStep(b, n, 'wall', tp.x, tp.y, tp.z, h, 0);
    n = queueStep(b, n, 'cone', tp.x, tp.y, tp.z, face, 1);
    b.trap = { x: cx, y: tp.y, z: cz, face, since: t, peek: 'closed', peekT: t + n * diff.buildRate + 0.12, editKey: null };
    this._startQueue(b, n, 'trap', mat, Math.sin(face), -Math.cos(face));
    b.traps = (b.traps || 0) + 1;
    return true;
  }

  /** The trap's wall on side `h`, or null if it is gone. */
  _trapWall(b, h) {
    const tr = b.trap;
    _bpos.x = tr.x;
    _bpos.y = tr.y;
    _bpos.z = tr.z;
    const pl = this.structures.plan('wall', _bpos, h, 0, _pl);
    const w = this.structures.slots.get(pl.key);
    return w && w.alive && w.owner === b.actor ? w : null;
  }

  _endTrap(b) {
    const tr = b.trap;
    const st = this.structures;
    if (tr && st) this._closePeek(tr);
    b.trap = null;
  }

  _trapTick(b, target, dist) {
    const tr = b.trap;
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    const diff = this.diff;
    const escaped = !target || !target.alive || Math.hypot(target.pos.x - tr.x, target.pos.z - tr.z) > CELL_HALF + 0.9 || Math.abs(target.pos.y - tr.y) > 2.5;
    if (!st || !a.alive || a.downed || escaped || dist > TRAP_RANGE + 6 || t - tr.since > TRAP_TIME) {
      this._endTrap(b);
      b.trapRollAt = t + 3;
      return false;
    }
    if (b.bqI < b.bqN || t < tr.peekT) return true; // still going up / between edits
    if (b.reloading > 0) {
      tr.peekT = t + 0.15;
      return true;
    }
    const w = this._trapWall(b, tr.face);
    if (!w) return false; // our side was shot out: fight through the gap like a normal fight
    if (tr.peek === 'closed') {
      const tg = b.target;
      this._botEdit(b, w, tg ? this._peekMask(b, w, tg.pos.x, tg.pos.y, tg.pos.z, false) : WINDOW);
      tr.peek = 'open';
      tr.editKey = w.key;
      tr.extraKeys = tg ? this._openRestOfLine(b, w, tg.pos.x, tg.pos.y, tg.pos.z) : null; // our own box wall too
      tr.peekT = t + diff.peekOpen * (0.7 + this.rng() * 0.6);
      // pre-aimed at the window: shoot the moment it opens
      b.reactLeft = Math.min(b.reactLeft, diff.reaction * 0.4);
      b.trackTime = Math.max(b.trackTime, 2.5);
      b.burstPaused = false;
      b.burstLeft = 6;
      b.fireCd = Math.min(b.fireCd, 0.06);
    } else {
      this._closePeek(tr);
      tr.peek = 'closed';
      tr.peekT = t + diff.peekClosed * (0.7 + this.rng() * 0.8);
    }
    return true;
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

    if (this.time >= (this._reclaimAt || 0)) {
      this._reclaimAt = this.time + 1;
      this._reclaimPieces(all);
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
      // (the stuck count stays: a plan that does not get the bot moving either escalates to a
      // new goal (_stuckCheck), instead of being re-planned the same way for ever)
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
      this._useDiff(b);
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
    this._useDiff(null);
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
    // storm pressure: outside, or (after phase 1) the closing edge is about to pass a bot that
    // is not yet inside the next circle. Urgent bots stop fighting / boxing and run for it.
    let urgent = outside;
    if (!urgent && storm && (storm.phaseIndex | 0) > 0 && (storm.mode === 'shrinking' || storm.mode === 'final')) {
      const edge = storm.r - Math.hypot(a.pos.x - storm.cx, a.pos.z - storm.cz);
      const dn = Math.hypot(a.pos.x - storm.nextCx, a.pos.z - storm.nextCz);
      urgent = edge < 14 && dn > storm.nextR * 0.85;
    }
    b.stormUrgent = urgent;
    if (urgent) {
      // leave any box / ramp rush / box build: they hold the bot in place in the storm
      if (b.box) this._endBox(b, 0);
      b.rushUntil = 0;
      b.holdUntil = 0;
      if (b.bqN > 0 && b.bqMode !== 'escape') {
        b.bqN = b.bqI = 0;
        b.buildCooldown = t + 1;
      }
    }
    const hunted = this._grudgeTick(b, urgent);
    this._towerHold(b);
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
      // in the storm (or about to be): run for the circle, shooting back on the way (_act)
      if (urgent) fight = false;
      // badly hurt with heals in the bag: break off and patch up (cautious bots more often)
      if (fight && !b.box && dist > 8 && a.health + a.shield < 45 && t > b.retreatUntil + 6 && this.rng() < 0.35 + b.caution * 0.5 &&
          (findConsumable(inv, 'medkit') >= 0 || findConsumable(inv, 'tonic') >= 0)) {
        b.retreatUntil = t + 3 + this.rng() * 2;
      }
      if (t < b.retreatUntil) fight = false;
      // a grudge: no going back to loot / wander while they live; only the storm (urgent ends
      // the grudge) or patching up when low with the enemy out of sight breaks it off
      if (hunted && target === hunted && !urgent && t >= b.retreatUntil && (armed || dist < 6)) {
        const low = a.health + a.shield < 40 && !b.targetVisible && (findConsumable(inv, 'medkit') >= 0 || findConsumable(inv, 'tonic') >= 0);
        if (!low) fight = true;
      }
      if (!fight && !b.targetVisible) b.target = null;
    }
    const mate = this._downedMate(b, all);
    if (mate && !urgent) state = 'revive';
    else if (fight) state = 'engage';
    else if (urgent) state = 'rotate';
    else if (t < b.retreatUntil && target) state = 'retreat';
    else if (b.healing > 0 || this._wantHeal(b)) state = 'heal';
    else if (this._rebootPlan(b)) state = 'reboot';
    else if (this._needRotate(b, storm)) state = 'rotate';
    else if (b.harvest && b.harvest.alive && t < b.harvestUntil && !target) state = 'harvest';
    else if (!target && this._hearFight(b, all)) state = 'hunt';
    else if (this._pickLoot(b)) state = 'loot';
    else if (this._pickHarvest(b)) state = 'harvest';
    else state = 'wander';

    if (state !== 'engage' && b.tower) b.tower = null; // left the fight (storm / heal): off the tower
    if (state !== 'heal' && b.healing > 0 && !b.box) this._cancelHeal(b); // boxed bots heal mid-fight
    if (state !== 'revive' && a.revivingTarget && this.combat) this.combat.stopRevive(a);
    if (state !== 'reboot' && a.rebootVan) a.rebootVan = null;
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
        // reached the last seen spot (a grudge keeps the target: _grudgeTick says where it went)
        if (!b.targetVisible && d < 1.5 && !(b.grudge && b.grudge.actor === target)) b.target = null;
        // hard: take height again when our tower was broken (or after a hit with none up)
        if (!b.tower && this.diffName === 'hard' && target && target.alive) {
          const want = b.towerWant && t < b.towerWant.until && b.towerWant.src.alive ? b.towerWant.src : null;
          if (want || b.towerLost || t - b.hurtAt < 3) this._tryTower(b, want || target);
          // still waiting for it (landing / just out of reach): do not rush inside tower range
          if (!b.tower && want && d >= TOWER_NEAR && d < TOWER_NEAR + 10) {
            gx = a.pos.x;
            gz = a.pos.z;
          }
        }
        if (b.tower && this._towerTick(b, target)) {
          gx = _pt.x;
          gz = _pt.z;
          // walk the last bit: running momentum carried bots over the top wall and off
          const left = Math.hypot(gx - a.pos.x, gz - a.pos.z);
          speed = b.tower.reached ? 0 : left < 2.5 ? PLAYER.walkSpeed : PLAYER.runSpeed;
          stop = 0.25;
          b.wantJump = false; // no strafe hops on a tower top
          break;
        }
        if (this._maybeTrap(b, target, d)) {
          // trapping them: stand and work the window edits
          gx = a.pos.x;
          gz = a.pos.z;
          speed = 0;
          stop = 0.15;
          break;
        }
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
        // b.goalX/Z is shared with wander / loot: re-pick when it is not inside the next circle
        if (b.rotGoal && storm && Math.hypot(b.goalX - storm.nextCx, b.goalZ - storm.nextCz) > Math.max(2, storm.nextR * 0.8)) b.rotGoal = false;
        if (!b.rotGoal && storm) {
          // tiny last circles: aim for the very centre (a 4 m scatter is already outside)
          world_pointIn(this.world, this.rng, storm.nextCx, storm.nextCz, storm.nextR < 10 ? Math.max(0.5, storm.nextR * 0.3) : Math.max(4, storm.nextR * 0.55), _pt);
          b.goalX = _pt.x;
          b.goalZ = _pt.z;
          b.rotGoal = true;
        }
        gx = b.goalX;
        gz = b.goalZ;
        speed = outside || (storm && storm.mode !== 'waiting') ? PLAYER.sprintSpeed : PLAYER.runSpeed;
        stop = storm && storm.nextR < 10 ? 0.5 : 3;
        break;
      }
      case 'reboot': {
        // bring teammates back: fetch their card, then hold interact at a reboot van
        const rb = this.reboot;
        if (b.rbVan) {
          const v = b.rbVan;
          rb.standPoint(v, _pt);
          gx = _pt.x;
          gz = _pt.z;
          const d = Math.hypot(gx - a.pos.x, gz - a.pos.z);
          if (rb.vanNear(a) === v && rb.vanReady(v) && (v.user == null || v.user === a)) {
            speed = 0;
            a.rebootVan = v;
            b.faceX = v.x;
            b.faceZ = v.z;
          } else {
            a.rebootVan = null;
            speed = d > 25 ? PLAYER.sprintSpeed : PLAYER.runSpeed;
            stop = 0.4;
          }
        } else if (b.rbCard) {
          const c = b.rbCard;
          gx = c.x;
          gz = c.z;
          const d = Math.hypot(gx - a.pos.x, gz - a.pos.z);
          speed = d > 25 ? PLAYER.sprintSpeed : PLAYER.runSpeed;
          stop = 0.5;
          const near = rb.cardNear(a);
          if (near) {
            rb.take(a, near);
            b.thinkIn = 0; // head for a van right away
          }
        }
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
    // leaving our own box through the door just cut (_endBox): straight out first
    const ex = b.boxExit;
    if (ex) {
      const inBox = Math.hypot(a.pos.x - ex.cx, a.pos.z - ex.cz) < CELL_HALF + 0.2;
      if (this.time > ex.until || (!inBox && Math.hypot(a.pos.x - ex.x, a.pos.z - ex.z) < 1.2) || (!inBox && Math.hypot(a.pos.x - ex.cx, a.pos.z - ex.cz) > BUILD.cell)) {
        b.boxExit = null;
        if (ex.seal && !inBox) this._sealIn(b, ex);
      }
      else {
        // through the door's middle: to the doorway, then the point outside
        const tx = inBox ? ex.dx : ex.x;
        const tz = inBox ? ex.dz : ex.z;
        const L = Math.hypot(tx - a.pos.x, tz - a.pos.z) || 1;
        b.mx = (tx - a.pos.x) / L;
        b.mz = (tz - a.pos.z) / L;
        b.speed = PLAYER.runSpeed;
        b.steerGX = tx;
        b.steerGZ = tz;
        return;
      }
    }
    b.steerGX = gx;
    b.steerGZ = gz;
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
      if (d2 < s2 * 1.3 && this._los(ex, ey, ez, tgt.pos.x, tgt.pos.y + CHEST, tgt.pos.z)) {
        this._see(b, tgt);
        return;
      }
      b.targetVisible = false;
      if (t - b.lastSeen > (b.box ? BOX_MEMORY : MEMORY)) tgt = b.target = null;
    }

    // a known attacker is checked first, in any direction
    const th = b.threat;
    if (th && th.alive && dist2(a.pos, th.pos) < s2 * 1.5 && this._los(ex, ey, ez, th.pos.x, th.pos.y + CHEST, th.pos.z)) {
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
      if (this._los(ex, ey, ez, o.pos.x, o.pos.y + CHEST, o.pos.z)) {
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

  _los(ax, ay, az, bx, by, bz) {
    if (!this.world.clearLine(ax, ay, az, bx, by, bz)) return false;
    const g = this.combat && this.combat.grenades;
    return !(g && g.blocksSight && g.blocksSight(ax, ay, az, bx, by, bz));
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

  /**
   * Team modes: a teammate's reboot card to fetch (within 160 m), or — carrying cards — a
   * reboot van to take them to (ready, or ready by the time we get there; inside the storm).
   * Not while a target is in sight. Sets b.rbCard / b.rbVan.
   */
  _rebootPlan(b) {
    const rb = this.reboot;
    b.rbCard = null;
    b.rbVan = null;
    if (!rb || !rb.teamMode || !this.combat || !this.combat.teamMode) return false;
    const a = b.actor;
    if (b.target && b.targetVisible) return false;
    const storm = this._storm;
    const safe = (x, z) => !storm || !storm.isOutside(x, z);
    if (rb.cardsOf(a).length) {
      let best = null;
      let bd = 450;
      for (const v of rb.vans) {
        const d = Math.hypot(v.x - a.pos.x, v.z - a.pos.z);
        if (d >= bd || !safe(v.x, v.z)) continue;
        if (rb.vanCooldown(v) > d / PLAYER.runSpeed + 5) continue;
        if (v.user != null && v.user !== a) continue;
        bd = d;
        best = v;
      }
      b.rbVan = best;
      return !!best;
    }
    let best = null;
    let bd = 160;
    for (const c of rb.groundCards(a.team)) {
      const d = Math.hypot(c.x - a.pos.x, c.z - a.pos.z);
      if (d < bd && safe(c.x, c.z)) {
        bd = d;
        best = c;
      }
    }
    b.rbCard = best;
    return !!best;
  }

  /**
   * Reboot van (Game.respawnActor): brings a dead bot back standing at (x, y, z) with
   * `loadout` and a fresh brain; kills / team / character are kept.
   */
  respawn(a, x, y, z, heading = 0, loadout = null) {
    const old = a._bot;
    const i = old ? this.brains.indexOf(old) : -1;
    if (i < 0) return false;
    a.alive = true;
    a.health = REBOOT.health;
    a.shield = 0;
    a.downed = false;
    a.downHp = 0;
    a.knockedBy = null;
    a.reviver = null;
    a.reviveT = 0;
    a.revivingTarget = null;
    a.carrying = null;
    a.carriedBy = null;
    a.rebootVan = null;
    a.lootDropped = false;
    a.inBus = false;
    a.gliding = false;
    a.grounded = true;
    a.pos.set(x, y, z);
    a.vel.set(0, 0, 0);
    a.heading = heading;
    a.inventory.reset(loadout);
    const b = newBrain(a, { x, z }, this.rng);
    b.diffName = old.diffName;
    b.sandbox = old.sandbox;
    b.state = 'wander';
    b.launchAt = 0;
    a.botState = 'wander';
    a._bot = b;
    this.brains[i] = b;
    if (a.character) {
      a.character.reset();
      a.character.root.visible = true;
      a.character.root.position.copy(a.pos);
    }
    const cur = a.inventory.current();
    if (a.character && a.character.setEquipped) {
      const id = cur && cur.type === 'weapon' ? cur.id : 'pickaxe';
      a.character.setEquipped(id, WEAPONS[id] ? WEAPONS[id].twoHanded !== false : true);
    }
    return true;
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
    const late = (storm.phaseIndex | 0) >= 3 ? 15 : 0; // small, deadly circles: leave earlier
    return storm.secondsLeft < travel * (1.6 + (this.diff.rotateEarly || 0)) + 12 + late + b.caution * 25;
  }

  /** Stuck in the storm: a ramp toward the goal (climb over whatever blocks us). */
  _escapeBuild(b) {
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    if (!st || !a.grounded || b.bqI < b.bqN || t < (b.escapeAt || 0)) return;
    if (st.count >= BUILD.maxPieces * BUILD_ROOM) return;
    const mat = bestMat(a.inventory);
    if (!mat) return;
    b.escapeAt = t + 4;
    const dx = (b.steerGX ?? b.navX) - a.pos.x;
    const dz = (b.steerGZ ?? b.navZ) - a.pos.z;
    const hs = (Math.round(Math.atan2(dx, -dz) / (Math.PI / 2)) * Math.PI) / 2;
    const n = queueStep(b, 0, 'ramp', a.pos.x, a.pos.y, a.pos.z, hs, 0);
    this._startQueue(b, n, 'escape', mat, Math.sin(hs), -Math.cos(hs));
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
      // a bespoke landmark's graph (siteNav) reaches loot several storeys down the ravine
      const navIn = this.world.siteNav ? this.world.siteNav.inside(p.x, p.z, p.y) : null;
      if (Math.abs(p.y - a.pos.y) > (navIn ? 16 : 6)) continue;
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
      b.lootUntil = t + 4 + Math.hypot(p.x - a.pos.x, p.z - a.pos.z) / 3 + (b.lootIn !== b.inB ? 10 : b.lootIn ? 6 : 0) + (navIn ? 20 : 0);
      return true;
    }
    return false;
  }

  _wants(inv, item) {
    if (!item) return false;
    if (item.type === 'ammo' || item.type === 'material') return inv.canTake(item);
    // bots do not throw grenades: leave them for the humans
    if (item.type === 'consumable') return !(CONSUMABLES[item.id] && CONSUMABLES[item.id].throwable) && inv.canTake(item);
    if (item.type === 'weapon') {
      if (!WEAPONS[item.id] || WEAPONS[item.id].projectile) return false; // no rocket launchers either
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
    if (m.wood + m.brick + m.metal >= 300 || !this.combat) return false;
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
    } else if (maxN >= 5 && high && d < 30 && this.rng() < TOWER_CHANCE) {
      // tower preset: boxed in with a ramp up the middle, climbing out above the enemy
      mode = 'box';
      n = this._queuePreset(b, n, 'tower', hs);
    } else if (maxN >= 3 && !high && d > 12 && d < 50 && this.rng() < COVER_CHANCE) {
      // cover preset: a three-wall pocket facing the enemy, to heal or peek from
      mode = 'wall';
      n = this._queuePreset(b, n, 'cover', hs);
    } else if (maxN >= 3 && (high || (d > 18 && this.rng() < 0.45) || (diff.highGround && d > 8 && d < 45 && this.rng() < diff.highGround))) {
      // ramp rush: a chain of rising ramps toward the target, run up while it is built
      mode = 'rush';
      const ramps = Math.min(maxN, high ? 2 + Math.ceil((tgt.pos.y - py) / BUILD.level) : 3);
      // with pieces to spare, each ramp gets a wall in front (ramp-wall: climb behind cover);
      // hard bots also roof each ramp with a floor (ramp-wall-floor: no shots from above)
      const floors = !!diff.rushFloors && maxN >= ramps * 3;
      const covered = maxN >= ramps * 2;
      // chained off the ramps actually built (chainStep): planned up front from absolute
      // heights, every wall above the first level landed a level off (or did not fit) and
      // sloped ground broke the chain. A ramp's wall goes up after the next ramp (a wall
      // between two cells keeps the next ramp out of the cell ahead), the floor goes ahead of
      // each ramp under the next one (the landing at the top)
      for (let i = 0; i < ramps && n < maxN; i++) {
        n = chainStep(b, n, 'ramp', hs);
        if (floors) n = chainStep(b, n, 'floor', hs, 0.6);
        if (covered && i > 0) n = chainStep(b, n, 'wall', hs, 0, 1);
      }
      if (covered) n = chainStep(b, n, 'wall', hs);
      b.chainRamp = null;
      b.chainRamps = 0;
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

  /**
   * Where a player would stand to place chain piece `q` (see chainStep), written to `out`:
   * a ramp from the top of the chain's last ramp (the first from the bot's feet, a fresh
   * chain), a wall / floor from the middle of that ramp. False when the chain has no ramp.
   */
  _chainPos(b, q, out) {
    const a = b.actor;
    const r = b.chainRamp;
    const ux = Math.sin(q.h);
    const uz = -Math.cos(q.h);
    if (q.kind === 'ramp' && (!r || !b.chainRamps)) {
      out.x = a.pos.x;
      out.y = a.pos.y;
      out.z = a.pos.z;
      return true;
    }
    if (!r || !r.alive) return false;
    // on the ramp's surface: near its high end (next ramp) or in its middle (wall / floor);
    // a "back" piece stands on the ramp below the last one (one cell back, one level down)
    const back = q.c > 1 ? 1 : 0;
    const f = q.kind === 'ramp' ? 0.4 : 0;
    out.x = r.x + ux * BUILD.cell * (f - back);
    out.z = r.z + uz * BUILD.cell * (f - back);
    const below = back ? this._rampAt(r.x - ux * BUILD.cell, r.y - BUILD.level, r.z - uz * BUILD.cell, r.rot) : r;
    if (!below) return false;
    out.y = below.surf ? below.surf(out.x, out.z) : below.y + BUILD.level * (0.5 + f);
    return true;
  }

  /** Our live ramp piece at (x, y, z) with rotation rot, or null. */
  _rampAt(x, y, z, rot) {
    for (const p of this.structures.pieces) {
      if (p.alive && p.kind === 'ramp' && Math.abs(p.x - x) < 0.5 && Math.abs(p.z - z) < 0.5 && Math.abs(p.y - y) < 0.5 && Math.abs(angleDelta(p.rot || 0, rot || 0)) < 0.1) return p;
    }
    return null;
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
      let ok = true;
      if (q.c) ok = this._chainPos(b, q, _bpos);
      else {
        _bpos.x = q.x;
        _bpos.y = q.y;
        _bpos.z = q.z;
      }
      const pl = ok ? st.plan(q.kind, _bpos, q.h, q.p, _pl) : null;
      const inv = a.inventory;
      let mat = b.bqMat;
      if ((inv.mats[mat] || 0) < BUILD.cost) mat = b.bqMat = bestMat(inv);
      if (pl && pl.valid && mat && inv.spendMats(mat, BUILD.cost)) {
        const piece = st.place(pl, mat, a);
        if (piece) {
          b.builds++;
          if (q.c && q.kind === 'ramp') {
            b.chainRamp = piece;
            b.chainRamps = (b.chainRamps || 0) + 1;
          }
        } else inv.mats[mat] += BUILD.cost;
      } else if (q.c && q.kind === 'ramp') {
        b.bqI = b.bqN - 1; // the chain broke: a ramp that did not fit ends it
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
    if (!ib && !ig) return this._siteRoute(b, gx, gz, gy);
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
   * Bespoke landmark with its own waypoint graph (world.siteNav, Crystal Bridges nav.js): a goal
   * inside the museum from outside (or the way out, or another level / pavilion) walks the graph
   * through one of its entrances. No-op when the landmark is absent or no route is needed.
   */
  _siteRoute(b, gx, gz, gy = null) {
    const nav = this.world.siteNav;
    if (!nav) return false;
    const a = b.actor;
    const n = nav.route(a.pos.x, a.pos.z, a.pos.y, gx, gz, gy, b.path, b.pathK, PATH_MAX);
    if (!n) return false;
    b.pathN = n;
    b.pathI = 0;
    b.pathGoalX = gx;
    b.pathGoalZ = gz;
    b.pathUntil = this.time + 12 + Math.hypot(gx - a.pos.x, gz - a.pos.z) / 3 + n * 1.5;
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
      // the flight between these storeys with the shortest walk: to its foot (or top) from here,
      // plus from its other end to the goal (big buildings have several, see interiors/storeys.js)
      let s = null;
      let sBest = Infinity;
      for (let i = 0; i < stairs.length; i++) {
        const t = stairs[i];
        if (t.level !== sl) continue;
        const ex = up ? t.x0 : t.x1, ez = up ? t.z0 : t.z1, lx = up ? t.x1 : t.x0, lz = up ? t.z1 : t.z0;
        const cost = Math.hypot(ex - cursorX, ez - cursorZ) + Math.hypot(gx - lx, gz - lz);
        if (cost < sBest) {
          sBest = cost;
          s = t;
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
      // walled in by a build (our own box, or someone's trap): edit a door out of our own wall,
      // else pickaxe through it
      if (!b.box && !b.trap && !b.tower) this._breakOut(b);
      // in the storm: smash whatever is in the way (builds, building walls) instead of only
      // walking around it, and drop an escape ramp when a wall is in front of us
      if (b.stormUrgent) {
        b.breakUntil = t + 2.5;
        if (b.stuck >= 2) this._escapeBuild(b);
      }
      b.avoidSide = -b.avoidSide;
      if (b.stuck >= 2 && b.state !== 'engage' && b.pathN === 0 && b.lod < 2) {
        // plan a way around on a coarse grid toward the current goal (delivered in a later
        // frame; bots near a human jump the queue). Far bots skip A* and just re-goal below.
        this.planner.request(b, a.pos.x, a.pos.z, b.navX, b.navZ, b.lod === 0);
      } else if (b.stuck >= 3 && b.state !== 'engage' && b.pathN > 0 && b.lod < 2) {
        // a door / room route that does not get through (a room split by a footprint notch,
        // a blocked doorway), or an open leg that does not either (a landmark route's straight
        // walk from the ravine floor to a crest entrance runs into the bank under a bridge):
        // drop it and let A* (which knows the doors) find a way; hold door routing off until
        // the plan arrives
        if (b.pathK[b.pathI]) b.routeFails++;
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

  /**
   * Stuck against a built wall on our own cell (a box we sat in, or an enemy's trap): open a
   * door in our own wall toward where we are going, or pickaxe through one that is not ours
   * (or already a door that still does not let us out). True when it acted.
   */
  _breakOut(b) {
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    if (!st || a.downed || t < (b.breakOutAt || 0)) return false;
    const dx = (b.steerGX ?? b.navX) - a.pos.x;
    const dz = (b.steerGZ ?? b.navZ) - a.pos.z;
    if (!(Math.hypot(dx, dz) > 0.5)) return false;
    // the wall toward the goal, then the other axis' wall toward it (a diagonal goal)
    const xMajor = Math.abs(dx) >= Math.abs(dz);
    const sides = [Math.atan2(xMajor ? Math.sign(dx) : 0, xMajor ? 0 : -Math.sign(dz)), Math.atan2(xMajor ? 0 : Math.sign(dx), xMajor ? -Math.sign(dz) : 0)];
    for (const h of sides) {
      _bpos.x = a.pos.x;
      _bpos.y = a.pos.y;
      _bpos.z = a.pos.z;
      const pl = st.plan('wall', _bpos, h, 0, _pl);
      const w = st.slots.get(pl.key);
      if (!w || !w.alive || Math.abs(w.y - a.pos.y) > 1.5) continue;
      b.breakOutAt = t + 1.2;
      if (w.owner === a && (w.edit | 0) !== DOOR && this._botEdit(b, w, DOOR)) {
        b.editsOut = (b.editsOut || 0) + 1;
        b.thinkIn = 0;
        return true;
      }
      b.smashUntil = t + 3;
      b.smashX = w.x;
      b.smashZ = w.z;
      b.smashes = (b.smashes || 0) + 1;
      return true;
    }
    // no wall on our own cell that way (a ramp / floor edge / the next cell's wall right in
    // front): whatever built piece blocks the way toward the goal, at knee or chest height
    const d = Math.hypot(dx, dz);
    _dir.set(dx / d, 0, dz / d);
    for (const hy of [0.5, 1.2]) {
      _origin.set(a.pos.x, a.pos.y + hy, a.pos.z);
      const hit = st.pickPiece(_origin, _dir, 2.2);
      if (!hit) continue;
      const p = hit.piece;
      b.breakOutAt = t + 1.2;
      if (p.kind === 'wall' && p.owner === a && ((p.edit | 0) & DOOR) !== DOOR && this._botEdit(b, p, DOOR)) {
        b.editsOut = (b.editsOut || 0) + 1;
        b.thinkIn = 0;
        return true;
      }
      b.smashUntil = t + 3;
      b.smashX = a.pos.x + _dir.x * (hit.t + 0.2);
      b.smashZ = a.pos.z + _dir.z * (hit.t + 0.2);
      b.smashes = (b.smashes || 0) + 1;
      return true;
    }
    return false;
  }

  /** The closed (not door-edited) wall on our own cell's side `h` at our level, or null. */
  _cellWall(a, h) {
    const st = this.structures;
    _bpos.x = a.pos.x;
    _bpos.y = a.pos.y;
    _bpos.z = a.pos.z;
    const pl = st.plan('wall', _bpos, h, 0, _pl);
    const w = st.slots.get(pl.key);
    if (!w || !w.alive || Math.abs(w.y - a.pos.y) > 1.5) return null;
    return ((w.edit | 0) & DOOR) === DOOR ? null : w;
  }

  /**
   * Stuck-in-our-own-box detector (every ENCLOSED_EVERY s): walled in on 3+ sides of our
   * cell (a panic box from _wallOnHit / _maybeBuild, a box fight that ended, or an enemy trap)
   * with no enemy in sight and somewhere to go outside the cell. Sliding around inside a box
   * moves the bot enough that the distance-based _stuckCheck never fired, so it sat there:
   * now it edits a door in its own wall toward the goal (or pickaxes someone else's).
   */
  _enclosureCheck(b) {
    const st = this.structures;
    const a = b.actor;
    const t = this.time;
    if (!st || !st.count || t < (b.encAt || 0)) return false;
    b.encAt = t + ENCLOSED_EVERY;
    if (!a.alive || a.downed || !a.grounded || b.box || b.trap || b.tower || b.bqI < b.bqN || b.healing > 0) return false;
    if (t < (b.holdUntil || 0) || (b.state === 'engage' && b.targetVisible)) return false;
    let walls = 0;
    for (let q = 0; q < 4; q++) if (this._cellWall(a, (q * Math.PI) / 2)) walls++;
    if (walls < ENCLOSED_WALLS) return false;
    const dx = (b.steerGX ?? b.navX) - a.pos.x;
    const dz = (b.steerGZ ?? b.navZ) - a.pos.z;
    if (!(Math.hypot(dx, dz) > CELL_HALF)) return false; // nowhere to go: staying in is fine
    // the side toward the goal is already open: just walk out
    const xMajor = Math.abs(dx) >= Math.abs(dz);
    const h = Math.atan2(xMajor ? Math.sign(dx) : 0, xMajor ? 0 : -Math.sign(dz));
    if (!this._cellWall(a, h)) return false;
    b.boxedIn = (b.boxedIn || 0) + 1;
    return this._breakOut(b);
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
    else this._enclosureCheck(b);
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
          it.mag += inv.takeAmmo(w.ammo, w.shellReload ? 1 : w.mag - it.mag);
          // shotguns: one shell at a time; keep loading unless a visible target is in range
          if (w.shellReload && it.mag < w.mag && inv.ammo[w.ammo] > 0 && !(it.mag >= 2 && b.targetVisible)) {
            b.reloading = (weaponStats(it.id, it.rarity) || w).reload;
          }
        }
      }
    }

    // facing
    let want = a.heading;
    let pitch = 0;
    const tgt = b.target;
    const runGun = b.state === 'rotate' && b.stormUrgent && tgt && b.targetVisible && tgt.alive;
    if (tgt && (b.targetVisible || b.box) && (b.state === 'engage' || runGun)) {
      const dx = (b.targetVisible ? tgt.pos.x : b.lastSeenX) - a.pos.x;
      const dz = (b.targetVisible ? tgt.pos.z : b.lastSeenZ) - a.pos.z;
      want = Math.atan2(dx, -dz);
      pitch = Math.atan2(tgt.pos.y + CHEST - (a.pos.y + EYE), Math.hypot(dx, dz) || 1);
    } else if ((b.state === 'harvest' && b.harvest) || (b.state === 'revive' && a.revivingTarget) || (b.state === 'reboot' && a.rebootVan)) {
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

    if ((b.state === 'engage' || runGun) && tgt && b.targetVisible) {
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
    } else if (t < (b.smashUntil || 0) && b.fireCd <= 0 && b.healing <= 0) {
      // breaking out of a box: pickaxe the wall in the way
      this._swingAt(b, b.smashX, a.pos.y + 1.0, b.smashZ, null);
    } else if (b.stormUrgent && t < (b.breakUntil || 0) && b.fireCd <= 0 && b.healing <= 0) {
      // stuck in the storm: pickaxe toward where we are trying to go
      const dx = (b.steerGX ?? b.navX) - a.pos.x;
      const dz = (b.steerGZ ?? b.navZ) - a.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this._swingAt(b, a.pos.x + (dx / d) * 2, a.pos.y + 1.0, a.pos.z + (dz / d) * 2, null);
    }
  }

  _fireControl(b, tgt) {
    const a = b.actor;
    const inv = a.inventory;
    if (b.fireCd > 0 || b.reloading > 0 || b.healing > 0 || a.swimming) return;
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
    // close-range scatter: closeMiss metres at the target, as an angle (an angular error alone
    // vanishes up close: 0.017 rad is 8 cm at 5 m, so a bot never missed there)
    // (full within 10 m, fading beyond: long-range aim stays as it was)
    const near = ((this.diff.closeMiss || 0) * Math.min(1, 10 / len)) / Math.max(1.5, len) * Math.max(0.7, settle);
    const yaw = (b.errYaw + gauss(this.rng) * this.diff.aimError * 0.35) * err + gauss(this.rng) * near;
    const pit = (b.errPitch + gauss(this.rng) * this.diff.aimError * 0.25) * err + gauss(this.rng) * near * 0.6;
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
    if (!b.grudge) this._setGrudge(b, tgt); // we started it: see it through
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
      // feet before this frame's sink: a fast glide at a low frame rate can't skip a floor
      const g = world.groundHeight(pos.x, pos.z, pos.y - vel.y * dt);
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
        // a landing stash, so getting shot early can still be answered with walls / a tower
        // (hard: enough for ~3 towers at BUILD.cost 5); the rest comes from harvesting
        const stash = LANDING_MATS[this.diffName] || 0;
        if (stash > 0 && a.inventory && a.inventory.mats) a.inventory.mats.wood = Math.max(a.inventory.mats.wood || 0, stash);
        b.thinkIn = 0.05 + this.rng() * 0.2;
        b.stuckX = pos.x;
        b.stuckZ = pos.z;
        b.stuckAt = this.time + STUCK_WINDOW;
        if (this.fx && a.character && a.character.root.visible) this.fx.dustPuff(pos);
        if (this.sfx) this.sfx.play('land', pos);
        if (a.character) a.character.land(0.6);
      }
      this._clampBounds(pos);
      return;
    }

    if (world.siteDoors) world.siteDoors.openNear(pos, 4.5);
    let sp = b.speed;
    if (b.healing > 0) sp = Math.min(sp, 1.5);
    // swimming (World.inWater): slower, like players
    a.swimming = a.grounded && !a.downed && !!world.inWater && world.inWater(pos.x, pos.z, pos.y);
    if (a.swimming) sp = Math.min(sp, PLAYER.runSpeed * SWIM.speed);
    approach(vel, b.mx * sp, b.mz * sp, (a.grounded ? PLAYER.accelGround : PLAYER.accelAir) * dt);
    if (b.wantJump && a.grounded) {
      vel.y = PLAYER.jumpSpeed;
      a.grounded = false;
      b.jumps++;
    }
    b.wantJump = false;
    if (!a.grounded) vel.y -= PLAYER.gravity * dt;
    const oy = pos.y;
    const ox = pos.x;
    const oz = pos.z;
    const cap = world.builtAbove(pos.x, pos.z, oy); // a floor over our head is not a step
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    pos.z += vel.z * dt;
    world.resolveCircle(pos, a.radius, a.height);
    // a push never carries a bot through a museum wall (World.crossesSolid)
    if (world.crossesSolid && world.crossesSolid(ox, oz, pos.x, pos.z, oy, a.height)) {
      pos.x = ox;
      pos.z = oz;
    }
    // head bump: jumping (or a step-up) never pushes the body up through a floor or ramp
    if (pos.y > oy) {
      const ceil = world.ceilingAbove(pos.x, pos.z, oy);
      if (pos.y + a.height > ceil) {
        pos.y = Math.max(oy, ceil - a.height);
        if (vel.y > 0) vel.y = 0;
      }
    }
    // ground from the feet before the move, so a fast fall can't skip a floor
    let g = world.groundHeight(pos.x, pos.z, Math.max(pos.y, oy), undefined, cap);
    // no headroom there (a bank rising under a bridge deck, the low end of a ramp): it is a
    // wall to a body, slid along like one. Walking on, the head went into the slab and the
    // push shoved the bot against the next plinth, wedged under the deck for good. A move
    // toward more headroom (out of such a spot) is still allowed. Airborne too: a hop onto a
    // weir under a deck used to be snapped up into the slab.
    if (pos.x !== ox || pos.z !== oz) {
      const og = a.grounded ? oy : world.groundHeight(ox, oz, oy, undefined, cap);
      const was = Math.min(a.height, world.ceilingAbove(ox, oz, og, 0) - og);
      const fy = Math.max(pos.y, oy);
      const nx = pos.x;
      const nz = pos.z;
      if (headroom(world, nx, nz, fy, cap) < was) {
        if (headroom(world, nx, oz, fy, cap) >= was) pos.z = oz;
        else if (headroom(world, ox, nz, fy, cap) >= was) pos.x = ox;
        else {
          pos.x = ox;
          pos.z = oz;
        }
        g = world.groundHeight(pos.x, pos.z, fy, undefined, cap);
      }
    }
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
    const floor = this.world.terrainHeight ? this.world.terrainHeight(pos.x, pos.z) : 0; // the Crystal Bridges ravine is below 0
    if (pos.y < floor) pos.y = floor;
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
    ch.setSwim(!!a.swimming);
    if (!show) {
      b.animAcc = 0;
      return;
    }
    // position / facing every frame (cheap); the skeleton (mixer) at a distance-scaled rate:
    // every frame inside ANIM_FULL, every 2nd frame to half the draw distance, every 3rd beyond
    ch.setShadows(d2 < SHADOW_DIST * SHADOW_DIST);
    ch.root.position.copy(a.pos);
    // facing: eased every frame (Character.update does the same on animated frames; writing the
    // raw heading here made far bots flick between the two)
    ch.turn(dt, a.heading);
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
    if (b.trap) this._endTrap(b);
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

/**
 * Clear height over the ground a body at feet fy would stand on at (x, z). Step 0: an
 * underside lower than a step over the ground (a deck's end over a rising bank) still counts.
 */
function headroom(world, x, z, fy, cap) {
  const g = world.groundHeight(x, z, fy, undefined, cap);
  return world.ceilingAbove(x, z, g, 0) - g;
}

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
    rbCard: null, // reboot card being fetched (_rebootPlan)
    rbVan: null, // reboot van being headed to
    stormUrgent: false,
    breakUntil: 0,
    smashUntil: 0, // pickaxing out of a box (_breakOut): until, at smashX / smashZ
    smashX: 0,
    smashZ: 0,
    escapeAt: 0,
    steerGX: undefined,
    steerGZ: undefined,
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
  q.c = 0;
  q.kind = kind;
  q.x = x;
  q.y = y;
  q.z = z;
  q.h = h;
  q.p = p;
  return n + 1;
}

/**
 * A piece of a ramp chain (tower / ramp rush), placed relative to the chain's last ramp when
 * its turn comes (Bots._chainPos): a ramp off the top of the previous one (the first: ahead of
 * where the bot stands then), a wall on that ramp's far edge, a floor past it (pitch p).
 * Planned up front from absolute heights, the pieces missed their levels on sloped ground:
 * Structures.plan reads the ground / built surface under the point, like for a player.
 */
function chainStep(b, n, kind, h, p = 0, back = 0) {
  if (n >= BUILD_Q) return n;
  n = queueStep(b, n, kind, 0, 0, 0, h, p);
  b.bq[n - 1].c = 1 + back; // back: on the ramp below the chain's last one
  return n;
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

  /** Drops `b`'s queued / running plan (a bot being removed). */
  cancel(b) {
    const i = this.queue.indexOf(b);
    if (i >= 0) this.queue.splice(i, 1);
    if (this.owner === b) {
      this.owner = null;
      this.busy = false;
    }
    b.planQueued = false;
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
    this.fy = b.actor ? b.actor.pos.y : 0; // the feet: a raised floor above them is a wall (World.ledgeAt)
    this.sx = b.planSX;
    this.sz = b.planSZ;
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
        // the grid is height-blind: from the bot's own level, a raised museum floor beside a
        // bridge is a wall (World.ledgeAt) and the bank under a deck's end has no headroom
        this.occ[i] = d >= 0 || (!w.blockedAt(x, z, 0.75, true) && !this._walledFrom(x, z)) ? 1 : 2;
      }
    }
    return this.occ[i] === 1;
  }

  /** Blocked for a body with feet at the planning bot's level, though blockedAt says open. */
  _walledFrom(x, z, r = 0.75) {
    const w = this.world;
    if (w.ledgeAt && w.ledgeAt(x, z, r, this.fy)) return true;
    return !!w.ceilingAbove && headroom(w, x, z, this.fy, Infinity) < PLAYER.height;
  }

  /**
   * Can the bot walk straight from where it stands to start-cell neighbour ni? The start cell
   * is open whatever is in it, so a plinth face or a deck's low end inside it (the bot at the
   * bank under a bridge) would otherwise be planned straight through.
   */
  _leaves(ni) {
    const x1 = this.ox + ((ni % PG) + 0.5) * PC;
    const z1 = this.oz + (Math.floor(ni / PG) + 0.5) * PC;
    const x0 = this.sx;
    const z0 = this.sz;
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.5);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this._walledFrom(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, PLAYER.radius)) return false;
    }
    return true;
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
        if (cur === this.start && !this._leaves(ni)) continue;
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
