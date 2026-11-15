// BENTONVILLE ROYALE — the match: loading, drop phase, play, end, render loop.
//
//   const game = new Game({ canvas, uiRoot, menus, settings });
//   await game.load(onProgress)      // map, models, world meshes (once)
//   game.startMatch()                // drop phase -> play -> over
//   game.pause(on) / game.leave()    // back to the menu
//   game.applySettings(settings)
//
// window.__game exposes { state, player, bots, storm, combat, loot, structures, debug } for QA.
//
// Multiplayer (src/net, lazy-loaded by main.js; solo never touches it):
//   game.net = hostSession;  game.startMatch(seed)       // host: full simulation + remote humans
//   game.net = clientSession; game.startClientMatch(msg)  // client: own Player + puppets from snapshots
// `this.net` is null in solo play. On a client, Combat is non-authoritative and
// storm, bots, storm damage and the win check are left to the host.

import * as THREE from 'three';
import { CAMERA, PLAYER, QUALITY, MATCH, DROP_ZONES, BOT_NAMES, WEAPONS, STORM, makeRng, clamp, damp, TAU } from '../core/config.js';
import { loadJSON, loadModels } from '../core/assets.js';
import { Input } from '../core/input.js';
import { World } from '../world/World.js';
import { buildWorldMeshes } from '../world/WorldMeshes.js';
import { Atmosphere } from '../render/Atmosphere.js';
import { Effects } from '../render/Effects.js';
import { Post } from '../render/Post.js';
import { sfx } from '../audio/Sfx.js';
import { buildHud } from '../ui/hud.js';
import { Minimap } from '../ui/Minimap.js';
import { CharacterKit, Character } from './Character.js';
import { Combat } from './Combat.js';
import { Player, placeOrbitCamera, itemLabel } from './Player.js';
import * as StormMod from './Storm.js';
import * as LootMod from './Loot.js';
import * as InvMod from './Inventory.js';
import * as StructMod from './Structures.js';
import * as BotsMod from './Bots.js';

const DROP_SECONDS = 15;
const DEATH_SCREEN_DELAY = 3.5;
const WIN_SCREEN_DELAY = 3;

const NATURE = ['tree_a', 'tree_b', 'tree_c', 'tree_d', 'pine_a', 'pine_b', 'rock_a', 'rock_b', 'rock_c', 'bush_a', 'bush_b', 'stump'];
const PROPS = ['bench', 'streetlamp', 'streetlamp_curved', 'fire_hydrant', 'dumpster', 'trash_can', 'table', 'parasol', 'tent', 'traffic_cone', 'planter'];
const VEHICLES = ['sedan', 'suv', 'pickup', 'van', 'truck'];
const LOOT_MODELS = ['chest', 'ammo', 'crate', 'medkit', 'potion'];
const WEAPON_MODELS = ['pickaxe', 'rifle', 'smg', 'shotgun', 'sniper', 'pistol'];
const CHARACTERS = ['player', 'bot_a', 'bot_b', 'bot_c'];

// ---- minimal stand-ins used only while a sibling module is still a placeholder
class NullBots {
  constructor() {
    this.list = [];
  }
  spawn() {}
  update() {}
  clear() {
    this.list = [];
  }
}
class StaticStorm {
  constructor() {
    this.cx = this.cz = this.nextCx = this.nextCz = 0;
    this.r = this.nextR = STORM.startRadius;
    this.phase = 1;
    this.mode = 'waiting';
    this.secondsLeft = 0;
    this.dps = 0;
  }
  reset(rng, c) {
    this.cx = this.nextCx = c.x;
    this.cz = this.nextCz = c.z;
  }
  update() {}
  skip() {}
  isOutside() {
    return false;
  }
  distanceOutside() {
    return 0;
  }
  intensityAt() {
    return 0;
  }
  hudState() {
    return { phase: 1, secondsLeft: 0, state: 'waiting', outside: false };
  }
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Game {
  constructor({ canvas, uiRoot, menus, settings }) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.menus = menus;
    this.settings = { ...settings };
    this.state = 'menu'; // 'menu' | 'loading' | 'drop' | 'play' | 'over'
    this.paused = false;
    this.loaded = false;
    this.time = 0;
    this.matchTime = 0;
    this.sfx = sfx;
    this.errors = [];
    this.net = null; // HostSession | ClientSession while in a multiplayer match

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 120, 200);
    this.camera.lookAt(0, 0, 0);
    // post chain (ink outlines + bloom + tone mapping); plain render when the preset disables both
    const q0 = QUALITY[this.settings.quality] || QUALITY.medium;
    this.post = new Post(this.renderer, this.scene, this.camera, { outline: q0.outline, bloom: q0.bloom, msaa: q0.msaa });
    this._applyPixelRatio();

    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => this._onLockChange(locked);
    this._wasLocked = false;
    canvas.addEventListener('click', () => {
      if (this.state === 'play' && !this.paused) this.input.lock();
    });

    window.addEventListener('resize', () => this._resize());
    this._resize();

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    this._installDebug();
  }

  // ---------------------------------------------------------------- loading

  async load(onProgress = () => {}) {
    if (this.loaded) return;
    const P = (v, label) => onProgress(clamp(v, 0, 1), label);
    P(0.01, 'Reading the map');
    const [mapData, nature, props, vehicles, chars] = await Promise.all([
      loadJSON('/data/bentonville-osm.json'),
      loadJSON('/assets/nature/manifest.json'),
      loadJSON('/assets/props/manifest.json'),
      loadJSON('/assets/vehicles/manifest.json'),
      loadJSON('/assets/characters/manifest.json'),
    ]);
    this.mapData = mapData;
    P(0.08, 'Loading models');
    const urls = {};
    for (const n of NATURE) urls[n] = `/assets/nature/${n}.glb`;
    for (const n of PROPS) urls[n] = `/assets/props/${n}.glb`;
    for (const n of VEHICLES) urls[n] = `/assets/vehicles/${n}.glb`;
    for (const n of LOOT_MODELS) urls[n] = `/assets/loot/${n}.glb`;
    for (const n of WEAPON_MODELS) urls[n] = `/assets/weapons/${n}.glb`;
    for (const n of CHARACTERS) urls['char_' + n] = `/assets/characters/${chars.characters[n].file}`;
    const models = await loadModels(urls, (f) => P(0.08 + f * 0.4, 'Loading models'));
    this.models = models;

    P(0.5, 'Building Bentonville');
    this.world = new World(mapData);
    this.atmosphere = new Atmosphere({ scene: this.scene, renderer: this.renderer, camera: this.camera, quality: this.settings.quality });
    this.view = await buildWorldMeshes({
      world: this.world,
      scene: this.scene,
      models,
      manifests: { nature, props, vehicles },
      onProgress: (v, label) => P(0.5 + v * 0.4, label || 'Building Bentonville'),
    });

    P(0.92, 'Gearing up');
    this.fx = new Effects({ scene: this.scene, camera: this.camera, quality: this.settings.quality });
    this.hud = buildHud(this.uiRoot);
    this.hud.setVisible(false);
    this.minimap = new Minimap({ mapData, miniCanvas: this.hud.getMinimapCanvas(), fullCanvas: this.hud.getFullMapCanvas() });
    this._wireFullMapClicks();

    const Structures = StructMod.Structures;
    this.structures = Structures ? new Structures({ scene: this.scene, world: this.world, fx: this.fx, sfx }) : null;
    this.combat = new Combat({ world: this.world, structures: this.structures, fx: this.fx, sfx, view: this.view });
    this.combat.onDamage = (t, a, info) => this._onDamage(t, a, info);
    this.combat.onEliminate = (v, k, info) => this._onEliminate(v, k, info);

    const lootModels = {};
    for (const k of [...LOOT_MODELS, ...WEAPON_MODELS]) lootModels[k] = models[k];
    this.loot = LootMod.Loot ? new LootMod.Loot({ scene: this.scene, world: this.world, models: lootModels, fx: this.fx, sfx }) : null;

    const StormCls = StormMod.Storm || StaticStorm;
    this.storm = new StormCls({ world: this.world });

    // characters
    this.kits = {};
    for (const n of CHARACTERS) {
      const g = models['char_' + n];
      if (g) this.kits[n] = new CharacterKit(g, chars.characters[n]);
    }
    const weaponScenes = {};
    for (const n of WEAPON_MODELS) if (models[n]) weaponScenes[n] = models[n].scene;
    this.weaponScenes = weaponScenes;
    const Inventory = InvMod.Inventory;
    const playerChar = this.kits.player ? new Character(this.kits.player, { weapons: weaponScenes, canopyColor: 0xffc21f }) : null;
    if (playerChar) this.scene.add(playerChar.root);
    this.player = new Player({ id: 0, name: 'You', character: playerChar, inventory: new Inventory() });

    const BotsCls = BotsMod.Bots;
    const botKits = ['bot_a', 'bot_b', 'bot_c'].map((k) => this.kits[k]).filter(Boolean);
    this.bots = BotsCls
      ? new BotsCls({ scene: this.scene, world: this.world, kits: botKits, weaponModels: weaponScenes, loot: this.loot, structures: this.structures, combat: this.combat, fx: this.fx, sfx })
      : new NullBots();
    this.bots.dropLootOnDeath = false; // Game drops every actor's inventory in _onEliminate

    this.applySettings(this.settings);
    P(1, 'Ready');
    this.loaded = true;
  }

  // ---------------------------------------------------------------- match lifecycle

  startMatch(seed = (Math.random() * 1e9) | 0) {
    if (!this.loaded) throw new Error('load() first');
    this.seed = seed;
    const rng = makeRng(seed);
    this.rng = rng;
    this.matchTime = 0;
    this.result = null;
    this.paused = false;
    this._endTimer = 0;
    this._stormTick = 0;
    this.spectating = null;
    this._deathPlacement = 0;
    this._winPending = false;

    // world back to pristine
    this.combat.restoreWorld();
    this.combat.clear();
    this.combat.authoritative = true;
    if (this.structures) this.structures.clear();
    this.fx.clear();
    this.hud.clearTransient();

    // storm, centred toward a random drop zone
    const zone = DROP_ZONES[Math.floor(rng() * DROP_ZONES.length)];
    const lm = this.world.landmarks[zone.key] || { x: 0, z: 0 };
    this.storm.reset(rng, { x: lm.x, z: lm.z });
    this.dropZone = zone;

    // loot inside the first circle (with margin)
    if (this.loot) this.loot.spawnMatch(rng, { area: { x: this.storm.cx, z: this.storm.cz, r: STORM.startRadius * 1.15 } });

    // player
    const p = this.player;
    p.reset();
    this.combat.register(p);
    this.dropMarker = { x: lm.x, z: lm.z };
    p.pos.set(lm.x, PLAYER.dropHeight, lm.z);
    p.heading = 0;
    p.pitch = -0.6;
    p.mode = 'bus';
    if (p.character) p.character.root.visible = false;

    // bots (multiplayer host: remote humans take slots first; see HostSession.prepareMatch)
    const net = this.net && this.net.isHost ? this.net : null;
    let botCount = MATCH.bots;
    const spawnOpts = {};
    if (net) {
      const plan = net.prepareMatch(this, lm);
      botCount = plan.botCount;
      spawnOpts.idBase = plan.idBase;
    }
    this.bots.clear();
    const names = shuffle(BOT_NAMES.slice(), rng).slice(0, botCount);
    const dropPoints = [];
    for (let i = 0; i < botCount; i++) {
      const z = DROP_ZONES[Math.floor(rng() * DROP_ZONES.length)];
      const l = this.world.landmarks[z.key] || lm;
      const pt = this.world.randomOpenPoint(rng, l.x * 0.5 + this.storm.cx * 0.5, l.z * 0.5 + this.storm.cz * 0.5, STORM.startRadius * 0.7);
      dropPoints.push({ x: pt.x, z: pt.z });
    }
    try {
      this.bots.spawn(botCount, rng, { names, difficulty: this.settings.difficulty, dropPoints, launchWindow: DROP_SECONDS, ...spawnOpts });
    } catch (err) {
      this._error('bots.spawn', err);
    }
    this.totalActors = 1 + (net ? net.remotes.size : 0) + this.bots.list.length;

    this.state = 'drop';
    this.dropLeft = DROP_SECONDS;
    this.hud.setVisible(true);
    this.hud.showFullMap(true);
    this._setFullMapInteractive(true);
    this.hud.announce('PICK YOUR DROP', 'Click the map, then press SPACE to jump', 4000);
    this.menus.hideAll();
    this.menus.showDropBanner(true, this.dropLeft, zone.label);
    sfx.stopMusic();
    if (net) net.matchStarted(this);
  }

  /**
   * Multiplayer client: set up the match the host described (see HostSession.matchStarted).
   * The static world is identical everywhere (seeded generation); loot and the storm are
   * copied from the host, and everyone else is a Puppet driven by snapshots.
   */
  startClientMatch(start) {
    if (!this.loaded) throw new Error('load() first');
    const net = this.net;
    this.seed = start.seed;
    this.rng = makeRng(start.seed);
    this.matchTime = 0;
    this.result = null;
    this.paused = false;
    this._endTimer = 0;
    this._stormTick = 0;
    this.spectating = null;
    this._deathPlacement = 0;
    this._winPending = false;

    this.combat.restoreWorld();
    this.combat.clear();
    this.combat.authoritative = false;
    if (this.structures) this.structures.clear();
    this.fx.clear();
    this.hud.clearTransient();
    this.bots.clear();

    const zone = DROP_ZONES.find((z) => z.key === start.zone) || DROP_ZONES[0];
    const lm = this.world.landmarks[zone.key] || { x: 0, z: 0 };
    this.storm.reset(makeRng(start.seed), { x: lm.x, z: lm.z });
    Object.assign(this.storm, start.storm);
    this.dropZone = zone;

    if (this.loot) {
      this.loot.clear();
      for (const [id, kind, x, y, z, yaw, opened, item] of start.loot) {
        const rec = this.loot._add(kind, x, y, z, yaw, item || null, id);
        if (opened) {
          rec.opened = true;
          this.loot._fxOff(rec);
        }
      }
    }

    const p = this.player;
    p.reset();
    p.id = start.you;
    p.team = start.you;
    this.combat.register(p);
    const m = start.marker || lm;
    this.dropMarker = { x: m.x, z: m.z };
    p.pos.set(m.x, PLAYER.dropHeight, m.z);
    p.heading = 0;
    p.pitch = -0.6;
    p.mode = 'bus';
    if (p.character) p.character.root.visible = false;

    net.begin(this, start);
    this.totalActors = start.total;

    this.state = 'drop';
    this.dropLeft = DROP_SECONDS;
    this.hud.setVisible(true);
    this.hud.showFullMap(true);
    this._setFullMapInteractive(true);
    this.hud.announce('PICK YOUR DROP', 'Click the map, then press SPACE to jump', 4000);
    this.menus.hideAll();
    this.menus.showDropBanner(true, this.dropLeft, zone.label);
    sfx.stopMusic();
  }

  /** Multiplayer client: the host says we were eliminated. */
  netDeath({ killer, killerName, placement }) {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.health = 0;
    p.shield = 0;
    p.lastKillerName = killerName || null;
    if (p.character) p.character.die();
    sfx.play('death', { volume: 0.9 });
    this.fx.elimination(p.pos, 0xa66bff);
    this._deathPlacement = placement;
    this.spectating = killer || null;
    this._endTimer = DEATH_SCREEN_DELAY;
    this.hud.announce('ELIMINATED', killerName ? `by ${killerName}` : '', 3000);
    sfx.stopLoop('glide_wind');
  }

  /** Multiplayer client: the host says we are the last one standing. */
  netWin() {
    if (this.state !== 'play' || !this.player.alive || this._winPending) return;
    this._winPending = true;
    this._endTimer = WIN_SCREEN_DELAY;
    this.hud.announce('#1 IN BENTONVILLE', 'Last one standing!', 3000);
    if (this.player.character) this.player.character.emote(true);
  }

  /** Leave the bus at the marker. */
  jump() {
    if (this.state !== 'drop') return;
    const p = this.player;
    const m = this.dropMarker;
    p.spawnDrop(m.x, m.z);
    if (p.character) p.character.root.visible = true;
    this.state = 'play';
    this.hud.showFullMap(false);
    this._setFullMapInteractive(false);
    this.menus.showDropBanner(false);
    this.hud.announce('DROP!', 'SPACE opens your glider early', 2200);
    sfx.play('zone_enter', { volume: 0.6 });
    sfx.startLoop('glide_wind');
    this.input.lock();
  }

  pause(on) {
    if (this.state !== 'play' && this.state !== 'drop') return;
    if (on === this.paused) return;
    this.paused = on;
    if (on) {
      this.input.unlock();
      this.input.releaseAll();
      this.menus.showPause();
    } else {
      this.menus.hideAll();
      if (this.state === 'drop') this.menus.showDropBanner(true, this.dropLeft, this.dropZone.label);
      this.input.lock();
    }
  }

  /** Back to the main menu. */
  leave() {
    if (this.net) {
      this.net.dispose(this);
      this.net = null;
      this.combat.authoritative = true;
    }
    this.state = 'menu';
    this.paused = false;
    this.input.unlock();
    sfx.stopLoop('storm_wind');
    sfx.stopLoop('glide_wind');
    if (this.hud) {
      this.hud.setVisible(false);
      this.hud.clearTransient();
      this._setFullMapInteractive(false);
    }
    this.menus.showTitle();
  }

  _endMatch(victory) {
    if (this.state === 'over') return;
    this.state = 'over';
    const placement = victory ? 1 : this._deathPlacement || this.combat.aliveCount + 1;
    this.result = { victory, placement, kills: this.player.kills, total: this.totalActors, time: this.matchTime, killer: this.player.lastKillerName || null };
    if (this.net) {
      this.result.mp = true;
      // the host keeps simulating for everyone until it leaves
      this.result.hostNote = this.net.isHost && !this.net.ended ? 'You are hosting: leaving ends the match for everyone still playing.' : null;
    }
    this.input.unlock();
    sfx.stopLoop('storm_wind');
    sfx.stopLoop('glide_wind');
    sfx.playMusic(victory ? 'victory' : 'defeat');
    this.hud.prompt(null);
    this.menus.showResult(this.result);
  }

  // ---------------------------------------------------------------- events

  _onDamage(target, amount, info) {
    const p = this.player;
    if (this.net && this.net.isHost) this.net.onDamage(target, amount, info);
    if (this.bots.notifyDamage && !target.isPlayer) this.bots.notifyDamage(target, amount, info);
    if (target === p) {
      this.hud.damageFlash(clamp(amount / 40, 0.15, 1));
      if (!info.storm) sfx.play('hurt', { volume: 0.7 });
    }
    if (info.source === p && target !== p) {
      this.hud.hitMarker(!!info.headshot, !target.alive || target.health <= 0);
      sfx.play(info.headshot ? 'headshot' : 'hitmarker', { volume: 0.8 });
      const pt = info.point || _v.set(target.pos.x, target.pos.y + 1.6, target.pos.z);
      const s = this.project(pt);
      if (s) this.hud.floatText(s.x, s.y, String(Math.round(amount)), info.headshot ? 'crit' : info.shieldHit > 0 ? 'shield' : 'damage');
    }
  }

  _onEliminate(victim, killer, info) {
    const p = this.player;
    if (this.net && this.net.isHost) this.net.onEliminate(victim, killer, info);
    // death loot
    if (this.loot && victim.inventory && victim.inventory.dropAll) {
      const items = victim.inventory.dropAll();
      items.forEach((it, i) => {
        const a = (i / Math.max(1, items.length)) * TAU;
        this.loot.drop(it, _v2.set(victim.pos.x + Math.cos(a) * 1.2, victim.pos.y, victim.pos.z + Math.sin(a) * 1.2).clone());
      });
    }
    // feed
    let text;
    let kind = 'elim';
    if (info.left) text = `${victim.name} left the match`;
    else if (info.storm && !killer) {
      text = `${victim.name} was lost in the storm`;
      kind = 'storm';
    } else if (info.fall) text = `${victim.name} fell too far`;
    else if (killer) {
      const how = info.weapon === 'pickaxe' ? 'bonked' : info.headshot ? 'headshot' : 'eliminated';
      text = `${killer.name} ${how} ${victim.name}`;
    } else text = `${victim.name} was eliminated`;
    if (killer === p) kind = 'kill';
    if (victim === p) kind = 'self';
    this.hud.killFeed(text, kind);

    if (killer === p) {
      this.hud.announce(`ELIMINATED ${victim.name.toUpperCase()}`, `${p.kills} elimination${p.kills === 1 ? '' : 's'}`, 1800);
    }
    if (victim === p) {
      p.lastKillerName = killer ? killer.name : info.storm ? 'the storm' : null;
      this._deathPlacement = this.combat.aliveCount + 1;
      this.spectating = killer && killer.alive ? killer : null;
      this._endTimer = DEATH_SCREEN_DELAY;
      this.hud.announce('ELIMINATED', killer ? `by ${killer.name}` : info.storm ? 'by the storm' : '', 3000);
      sfx.stopLoop('glide_wind');
    }
  }

  // ---------------------------------------------------------------- per frame

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 1 / 20);
    try {
      this.frame(dt);
    } catch (err) {
      this._error('frame', err);
    }
  }

  frame(dt) {
    this.time += dt;
    const input = this.input;
    if (!this.loaded) {
      this.post.render(this.scene, this.camera, dt);
      input.endFrame();
      return;
    }

    if (input.hit('Escape') && !input.locked && (this.state === 'play' || this.state === 'drop')) this.pause(!this.paused);
    if (input.hit('KeyM') && this.state === 'play' && !this.paused) this.fullMapOpen = !this.fullMapOpen;

    // a multiplayer match keeps running under the pause menu
    const live = (!this.paused || !!this.net) && (this.state === 'drop' || this.state === 'play' || this.state === 'over');
    if (live) this._simulate(dt);

    this._present(dt);
    input.endFrame();
  }

  _simulate(dt) {
    const p = this.player;
    const input = this.paused ? NO_INPUT : this.input;
    const client = !!(this.net && this.net.isClient);

    if (this.state === 'drop') {
      this.dropLeft -= dt;
      this.menus.showDropBanner(true, this.dropLeft, this.dropZone.label);
      if ((input.hit('Space') && !this.paused) || this.dropLeft <= 0) this.jump();
      // slowly orbit the camera above the marker
      const m = this.dropMarker;
      p.pos.set(m.x, PLAYER.dropHeight, m.z);
      p.heading += dt * 0.05;
    } else {
      this.matchTime += dt;
      if (!client) this.storm.update(dt);
    }

    if (this.state === 'play' || this.state === 'over') {
      if (p.alive) {
        const wasDrop = p.airborneDrop;
        p.update(dt, this.state === 'play' ? input : NO_INPUT, this);
        if (wasDrop && !p.airborneDrop) sfx.stopLoop('glide_wind');
      } else {
        p.update(dt, NO_INPUT, this);
      }
      if (!client) this._stormDamage(dt);
    }

    if (!client) {
      try {
        this.bots.update(dt, { player: p, storm: this.storm, time: this.time });
      } catch (err) {
        this._error('bots.update', err);
      }
    }
    if (this.net) {
      try {
        this.net.update(dt);
      } catch (err) {
        this._error('net.update', err);
      }
    }
    if (this.structures) this.structures.update(dt);
    if (this.loot) this.loot.update(dt, this.camera.position);

    // match end
    if (this.state === 'play') {
      const alive = this.combat.aliveCount;
      if (!p.alive) {
        this._endTimer -= dt;
        if (this.spectating && !this.spectating.alive) this.spectating = this.combat.actors.find((a) => a.alive) || null;
        if (this._endTimer <= 0) this._endMatch(false);
      } else if (client ? this._winPending : this.totalActors > 1 && alive <= 1) {
        if (!this._winPending) {
          this._winPending = true;
          this._endTimer = WIN_SCREEN_DELAY;
          this.hud.announce('#1 IN BENTONVILLE', 'Last one standing!', 3000);
          if (p.character) p.character.emote(true);
        }
        this._endTimer -= dt;
        if (this._endTimer <= 0) {
          this._winPending = false;
          this._endMatch(true);
        }
      }
    }
  }

  _stormDamage(dt) {
    const s = this.storm;
    this._stormTick += dt;
    if (this._stormTick < 1) return;
    this._stormTick -= 1;
    if (!(s.dps > 0)) return;
    for (const a of this.combat.actors.slice()) {
      if (!a.alive || a.mode === 'bus' || a.inBus) continue;
      if (a.isPlayer && a.god) continue;
      if (s.isOutside(a.pos.x, a.pos.z)) this.combat.applyDamage(a, s.dps, { storm: true });
    }
  }

  _present(dt) {
    const p = this.player;
    const cam = this.camera;
    const inMatch = this.state === 'drop' || this.state === 'play' || this.state === 'over';

    // camera
    if (this.state === 'drop') {
      const m = this.dropMarker;
      _v.set(m.x, PLAYER.dropHeight * 0.6, m.z);
      placeOrbitCamera(cam, null, _v, p.heading, -0.75, 220, 0, 0);
    } else if (inMatch) {
      if (!p.alive && this.spectating) {
        const t = this.spectating;
        _v.set(t.pos.x, t.pos.y + CAMERA.pivotHeight, t.pos.z);
        this._specYaw = (this._specYaw || t.heading || 0) + dt * 0.25;
        placeOrbitCamera(cam, this.world, _v, this._specYaw, -0.25, 6, 0);
      } else if (!p.alive) {
        _v.set(p.pos.x, p.pos.y + 1, p.pos.z);
        this._specYaw = (this._specYaw || p.heading) + dt * 0.2;
        placeOrbitCamera(cam, this.world, _v, this._specYaw, -0.5, 8, 0);
      } else p.updateCamera(cam, dt, this.world, CAMERA.fov);
    }

    // world culling a few times a second
    this._cullT = (this._cullT || 0) - dt;
    if (this._cullT <= 0 && this.view) {
      this._cullT = 0.25;
      this.view.update(cam.position, QUALITY[this.settings.quality] || QUALITY.medium);
    }

    const s = this.storm;
    const focus = inMatch ? p.pos : cam.position;
    const stormOn = inMatch && this.state !== 'drop';
    const intensity = stormOn ? s.intensityAt(focus.x, focus.z) : 0;
    this.atmosphere.setStorm(inMatch ? s : null);
    this.atmosphere.update(dt, { focus, stormIntensity01: intensity });
    this.fx.update(dt);

    // audio
    cam.getWorldDirection(_v2);
    sfx.setListener(cam.position.x, cam.position.y, cam.position.z, _v2.x, _v2.z);
    if (stormOn && this.state === 'play') {
      sfx.startLoop('storm_wind');
      sfx.setLoopGain('storm_wind', intensity);
    }

    if (inMatch) this._updateHud(dt);
    this.post.render(this.scene, cam, dt);
  }

  _updateHud(dt) {
    const hud = this.hud;
    const p = this.player;
    const inv = p.inventory;
    hud.setHealth(p.health, PLAYER.maxHealth);
    hud.setShield(p.shield, PLAYER.maxShield);
    hud.setMaterials(inv.mats, p.buildMat);
    hud.setHotbar(inv.hotbar(), p.buildPiece ? -1 : inv.selected);
    hud.setBuildMode(p.buildPiece);
    const rl = p.reloadT > 0 ? 1 - p.reloadT / p.reloadTotal : 0;
    hud.setWeapon(p.buildPiece ? null : inv.weaponHud ? inv.weaponHud(rl) : null);
    const kind = p.buildPiece ? 'build' : inv.current() && inv.current().type === 'weapon' ? 'gun' : 'pickaxe';
    hud.setCrosshair({ spread01: clamp(p.computeSpread() / 0.06, 0, 1), hit: false, kind });
    const netAlive = this.net && this.net.aliveCount;
    hud.setCounts({ alive: netAlive != null ? netAlive : this.combat.aliveCount, eliminations: p.kills });
    hud.setCompass(((p.heading * 180) / Math.PI + 360) % 360);
    const s = this.storm;
    if (this.state !== 'drop') hud.setStorm(s.hudState(p.pos.x, p.pos.z));

    // location: nearest landmark we are inside
    this._locT = (this._locT || 0) - dt;
    if (this._locT <= 0) {
      this._locT = 0.5;
      let best = null;
      let bd = Infinity;
      for (const k in this.world.landmarks) {
        const l = this.world.landmarks[k];
        const d = Math.hypot(l.x - p.pos.x, l.z - p.pos.z);
        if (d < Math.max(60, l.r * 1.2) && d < bd) {
          bd = d;
          best = l;
        }
      }
      hud.setLocation(best ? best.n.toUpperCase() : null);
    }

    // harvested object bar
    const ob = p.objBar;
    if (ob && ob.until > this.time && ob.collider.alive) {
      const sc = this.project(_v.set(ob.point.x, ob.point.y + 0.8, ob.point.z));
      if (sc) hud.setObjectBar({ screenX: sc.x, screenY: sc.y, pct: ob.collider.hp / ob.collider.maxHp, kind: ob.kind });
      else hud.setObjectBar(null);
    } else hud.setObjectBar(null);

    // minimap
    const fullOpen = this.state === 'drop' || (this.state === 'play' && !!this.fullMapOpen);
    if (this.state === 'play') hud.showFullMap(fullOpen);
    const blips = this.loot ? this.loot.blips() : [];
    this.minimap.update({
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      storm: this.state === 'drop' ? { cx: s.cx, cz: s.cz, r: s.r, nextCx: s.nextCx, nextCz: s.nextCz, nextR: s.nextR } : s,
      fullOpen,
      marker: this.state === 'drop' ? this.dropMarker : null,
      blips,
    });
  }

  // ---------------------------------------------------------------- helpers

  /** World point -> CSS pixel coords, or null when behind the camera / off screen. */
  project(v) {
    _v2.copy(v).project(this.camera);
    if (_v2.z > 1 || _v2.z < -1) return null;
    const x = (_v2.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v2.y * 0.5 + 0.5) * window.innerHeight;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null;
    return { x, y };
  }

  applySettings(settings) {
    this.settings = { ...this.settings, ...settings };
    sfx.setVolume(this.settings.volume);
    this._applyPixelRatio();
    if (this.atmosphere && this.atmosphere.quality !== this.settings.quality) this.atmosphere.setQuality(this.settings.quality);
    if (this.fx && this.fx.quality !== this.settings.quality) this.fx.setQuality(this.settings.quality);
    if (this.loot && this.loot.setQuality) this.loot.setQuality(this.settings.quality);
    if (this.bots && this.bots.setQuality) this.bots.setQuality(this.settings.quality);
    this._cullT = 0;
  }

  _applyPixelRatio() {
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio) * (q.renderScale || 1);
    this.renderer.setPixelRatio(pr);
    if (this.post) {
      this.post.configure({ outline: q.outline, bloom: q.bloom, msaa: q.msaa });
      this.post.setPixelRatio(pr);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.post) this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _onLockChange(locked) {
    if (locked) this._wasLocked = true;
    else if (this._wasLocked && this.state === 'play' && !this.paused) this.pause(true);
  }

  _wireFullMapClicks() {
    const c = this.hud.getFullMapCanvas();
    c.addEventListener('pointerdown', (e) => {
      if (this.state !== 'drop') return;
      const w = this.minimap.fullClientToWorld(e.clientX, e.clientY);
      if (w && w.inBounds) {
        this.dropMarker = { x: w.x, z: w.z };
        sfx.play('ui_click');
      }
    });
  }

  _setFullMapInteractive(on) {
    const c = this.hud && this.hud.getFullMapCanvas();
    if (!c) return;
    c.style.pointerEvents = on ? 'auto' : '';
    c.style.cursor = on ? 'crosshair' : '';
  }

  _error(where, err) {
    this.errors.push(where + ': ' + (err && err.message));
    if (this.errors.length > 50) this.errors.shift();
    console.error('[game]', where, err);
  }

  // ---------------------------------------------------------------- QA hooks

  _installDebug() {
    const game = this;
    const debug = {
      /** Drop the player now (optionally at x,z). */
      drop(x, z) {
        if (game.state !== 'drop') return false;
        if (x != null && z != null) game.dropMarker = { x, z };
        game.jump();
        return true;
      },
      /** Instantly land the player at (x, z) (or the drop marker). */
      teleport(x, z, y) {
        const p = game.player;
        if (game.state === 'drop') game.jump();
        if (x == null) {
          x = p.pos.x;
          z = p.pos.z;
        }
        const gy = y != null ? y : game.world.groundHeight(x, z, 1e4);
        p.pos.set(x, gy, z);
        p.vel.set(0, 0, 0);
        if (p.airborneDrop) {
          p.mode = 'ground';
          sfx.stopLoop('glide_wind');
        }
        p.grounded = true;
        if (game.net && game.net.isClient) game.net.debugTeleport(p.pos);
        return { x: p.pos.x, y: p.pos.y, z: p.pos.z };
      },
      /** give('rifle'|'smg'|..|'medkit'|'tonic'|'wood'|'ammo'|item object, rarity?) */
      give(what, rarity = 'rare') {
        const p = game.player;
        if (game.net && game.net.isClient) {
          // the host owns the inventory (dev builds accept this); it syncs back in ~0.1 s
          game.net.debugGive(typeof what === 'string' ? what : null, rarity);
          return { ok: true, viaHost: true };
        }
        let item = what;
        if (typeof what === 'string') {
          if (WEAPONS[what]) item = { type: 'weapon', id: what, rarity, mag: WEAPONS[what].mag };
          else if (what === 'medkit' || what === 'tonic') item = { type: 'consumable', id: what, count: 3 };
          else if (what === 'wood' || what === 'brick' || what === 'metal') item = { type: 'material', mat: what, count: 300 };
          else if (what === 'ammo') {
            for (const a of ['light', 'medium', 'shells', 'heavy']) p.inventory.add({ type: 'ammo', ammo: a, count: 120 });
            return true;
          }
        }
        const left = p.inventory.add(item);
        return { ok: true, leftover: left, label: itemLabel(item) };
      },
      skipPhase() {
        if (game.state === 'drop') return game.jump();
        if (game.storm.skip) game.storm.skip();
        return { phase: game.storm.phase, mode: game.storm.mode };
      },
      killAll() {
        for (const a of game.combat.actors.slice()) if (a !== game.player && a.alive) game.combat.applyDamage(a, 1e6, { source: game.player, weapon: 'debug' });
        return game.combat.aliveCount;
      },
      look(heading, pitch = 0) {
        game.player.heading = heading;
        game.player.pitch = pitch;
      },
      select(i) {
        game.player.buildPiece = null;
        game.player.inventory.select(i);
      },
      fire() {
        game.player.cooldown = 0;
        const r = game.player.fire(game);
        return r ? r.map((h) => ({ hit: h.hitActor ? h.hitActor.name : null, headshot: h.headshot, point: [h.point.x, h.point.y, h.point.z] })) : false;
      },
      swing() {
        game.player.cooldown = 0;
        const r = game.player.swing(game);
        return r ? { harvested: r.harvested || null, hit: r.hitActor ? r.hitActor.name : null } : null;
      },
      build(kind = 'wall') {
        const p = game.player;
        p.setBuildPiece(kind);
        p.placement = game.structures ? game.structures.plan(kind, p.pos, p.heading, p.pitch) : null;
        const piece = p.tryPlace(game);
        return { placed: !!piece, valid: !!(p.placement && p.placement.valid), count: game.structures ? game.structures.count : 0 };
      },
      interact() {
        const rec = game.loot && game.loot.nearest(game.player.pos);
        if (!rec) return null;
        game.player.interactWith(rec, game);
        return { kind: rec.kind, label: rec.label };
      },
      nearestLoot() {
        const rec = game.loot && game.loot.near(game.player.pos, 400)[0];
        return rec ? { id: rec.id, kind: rec.kind, label: rec.label, x: rec.position.x, z: rec.position.z } : null;
      },
      /** Teleport to an open spot (no building / tree) near the player. */
      openSpot(radius = 60) {
        const p = game.player;
        const w = game.world;
        for (let i = 0; i < 200; i++) {
          const pt = w.randomOpenPoint(Math.random, p.pos.x, p.pos.z, radius, 6);
          if (!w.polyAt(pt.x, pt.z) && !w.blockedAt(pt.x, pt.z, 6)) return debug.teleport(pt.x, pt.z);
        }
        return null;
      },
      /** Nearest harvestable cylinder (tree / rock / prop) within r metres. */
      nearestHarvestable(r = 150) {
        const p = game.player;
        const w = game.world;
        let best = null;
        let bd = Infinity;
        w._each(p.pos.x - r, p.pos.z - r, p.pos.x + r, p.pos.z + r, false, (cell) => {
          for (const c of cell.circles) {
            if (!c.alive || !Number.isFinite(c.hp) || !Array.isArray(c.ref)) continue;
            const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
            if (d < bd) {
              bd = d;
              best = c;
            }
          }
        });
        return best ? { x: best.x, z: best.z, r: best.r, kind: best.kind, mat: best.mat, hp: best.hp } : null;
      },
      /** Point the player's view at a world point (heading + pitch from the eye). */
      aimAt(x, y, z) {
        const p = game.player;
        const dx = x - p.pos.x;
        const dz = z - p.pos.z;
        const dy = y - (p.pos.y + CAMERA.pivotHeight);
        p.heading = (Math.atan2(dx, -dz) + TAU) % TAU;
        p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        p.updateCamera(game.camera, 1, game.world, CAMERA.fov);
        return { heading: p.heading, pitch: p.pitch };
      },
      nearestBot() {
        const p = game.player;
        let best = null;
        let bd = Infinity;
        for (const b of game.bots.list) {
          if (!b.alive || b.inBus) continue;
          const d = b.pos.distanceTo(p.pos);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        return best ? { name: best.name, x: best.pos.x, y: best.pos.y, z: best.pos.z, d: bd, state: best.botState, health: best.health, shield: best.shield } : null;
      },
      damagePlayer(n) {
        return game.combat.applyDamage(game.player, n, { source: null });
      },
      god(on = true) {
        game.player.god = on;
        game.player.invulnerable = on;
      },
      pause(on) {
        game.pause(on);
      },
      /** Multiplayer helpers (null fields in solo). */
      net: {
        info() {
          const n = game.net;
          if (!n) return { role: 'solo' };
          return { role: n.isHost ? 'host' : 'client', id: n.isHost ? 0 : n.id, alive: n.aliveCount != null ? n.aliveCount : game.combat.aliveCount, ended: !!n.ended };
        },
        bandwidth() {
          return game.net ? game.net.bandwidth() : null;
        },
        /** Every other actor this page knows about: puppets on a client, remotes + bots on the host. */
        actors() {
          return game.combat.actors
            .filter((a) => a !== game.player)
            .map((a) => ({ id: a.id, name: a.name, human: !!(a.isRemote || a.human), alive: a.alive, x: a.pos.x, y: a.pos.y, z: a.pos.z, health: a.health, shield: a.shield, inBus: !!a.inBus }));
        },
        /** Aim at actor `id`'s chest. */
        aimAtActor(id) {
          const a = game.combat.actors.find((x) => x.id === id);
          if (!a) return null;
          return debug.aimAt(a.pos.x, a.pos.y + 1.2, a.pos.z);
        },
        /** Host only: damage any actor (e.g. a remote human). */
        damage(id, n) {
          if (!game.net || !game.net.isHost) return null;
          const a = game.combat.actors.find((x) => x.id === id);
          return a ? game.combat.applyDamage(a, n, { source: null }) : null;
        },
        structures() {
          return game.structures ? game.structures.pieces.map((p) => ({ key: p.key, kind: p.kind, mat: p.mat, hp: Math.round(p.hp) })) : [];
        },
        lootCount() {
          return game.loot ? { records: game.loot.records.length, opened: game.loot.records.filter((r) => r.opened).length } : null;
        },
      },
    };
    window.__game = {
      get state() {
        return game.state;
      },
      get role() {
        return game.net ? (game.net.isHost ? 'host' : 'client') : 'solo';
      },
      get paused() {
        return game.paused;
      },
      get player() {
        const p = game.player;
        if (!p) return null;
        return {
          position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
          mode: p.mode,
          health: p.health,
          shield: p.shield,
          alive: p.alive,
          kills: p.kills,
          heading: p.heading,
          selected: p.inventory.selected,
          slots: p.inventory.slots.map((s) => (s ? { ...s } : null)),
          ammo: { ...p.inventory.ammo },
          mats: { ...p.inventory.mats },
          buildPiece: p.buildPiece,
        };
      },
      get bots() {
        return game.bots ? game.bots.list.map((b) => ({ name: b.name, alive: b.alive, x: b.pos.x, y: b.pos.y, z: b.pos.z, health: b.health })) : [];
      },
      get storm() {
        const s = game.storm;
        return s ? { cx: s.cx, cz: s.cz, r: s.r, nextR: s.nextR, phase: s.phase, mode: s.mode, secondsLeft: s.secondsLeft } : null;
      },
      get result() {
        return game.result;
      },
      get errors() {
        return game.errors.slice();
      },
      get alive() {
        return game.combat ? game.combat.aliveCount : 0;
      },
      game,
      debug,
    };
  }
}

const NO_INPUT = {
  dx: 0,
  dy: 0,
  wheel: 0,
  buttons: [false, false, false],
  clicked: [false, false, false],
  down: () => false,
  hit: () => false,
};

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

void damp;
