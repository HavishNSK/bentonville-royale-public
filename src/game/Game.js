// BENTONVILLE ROYALE — the match: loading, drop phase, play, end, render loop.
//
// Drop phase: everyone rides the Drop Bus (src/game/DropBus.js) across the map on a
// route derived from the match seed; the jump action leaves it at its current position,
// and anyone still aboard when it reaches the far edge is ejected.
//
//   const game = new Game({ canvas, uiRoot, menus, settings });
//   await game.load(onProgress)      // map, models, world meshes (once)
//   game.startMatch()                // drop phase -> play -> over
//   game.startMatch(seed, { freeBuild: true })  // solo sandbox: no bots, storm off, full mats, start on the ground
//   game.startMatch(seed, { mode: 'squad', fill: true })  // team mode vs bot teams (Teams.js); fill = bot teammates
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
import { CAMERA, PLAYER, QUALITY, MATCH, DROP_ZONES, BOT_NAMES, WEAPONS, STORM, MATERIALS, KNOCK, REBOOT, makeRng, clamp, damp, TAU } from '../core/config.js';
import { normalizeMode, assignTeams, teamCount, teamAlive, sameTeam, TEAM_CSS, TEAM_NOUN } from './Teams.js';
import { loadJSON, loadModels } from '../core/assets.js';
import { Input } from '../core/input.js';
import { World } from '../world/World.js';
import { buildWorldMeshes } from '../world/WorldMeshes.js';
import { INTERIOR_VERSION } from '../world/Interiors.js';
import { Atmosphere } from '../render/Atmosphere.js';
import { Effects } from '../render/Effects.js';
import { Post } from '../render/Post.js';
import { sfx } from '../audio/Sfx.js';
import { buildHud } from '../ui/hud.js';
import { createInventoryPanel } from '../ui/inventoryPanel.js';
import { createEmoteWheel } from '../ui/emoteWheel.js';
import { Minimap } from '../ui/Minimap.js';
import { CharacterKit, Character, registerKits } from './Character.js';
import { skinDef, emoteDef, pickaxeDef, DEFAULT_EQUIPPED, PICKAXES, BACKBLINGS } from './Cosmetics.js';
import { Combat, rayActor } from './Combat.js';
import { Pings } from './Pings.js';
import { Reboot } from './Reboot.js';
import { Player, placeOrbitCamera, itemLabel } from './Player.js';
import * as StormMod from './Storm.js';
import * as LootMod from './Loot.js';
import * as InvMod from './Inventory.js';
import * as StructMod from './Structures.js';
import * as BotsMod from './Bots.js';
import { createFpsMeter } from '../ui/fpsMeter.js';
import { graphicsQuality } from '../ui/settings.js';
import { planBusRoute, makeRoute, routeWire, busPosAt, planBotTargets, DropBusMesh } from './DropBus.js';

const BUS_CAM_DIST = 34; // third-person distance behind the Drop Bus
const DEATH_SCREEN_DELAY = 3.5;
const WIN_SCREEN_DELAY = 3;
const SIM_STEP = 1 / 20; // longest simulation sub-step (s)
const SIM_CATCHUP_MAX = 0.2; // longest stretch one frame catches up (below 5 fps the match slows)
// Worker clock for a hidden host tab (see Game._backgroundTick)
const BG_CLOCK_SRC = 'setInterval(() => postMessage(0), 50);';

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
    this.skin = DEFAULT_EQUIPPED.skin; // Cosmetics: outfit + emote wheel (setCosmetics)
    this.emotes = DEFAULT_EQUIPPED.emotes.slice();
    this.pickaxe = DEFAULT_EQUIPPED.pickaxe;
    this.backbling = DEFAULT_EQUIPPED.backbling;
    this.state = 'menu'; // 'menu' | 'loading' | 'drop' | 'play' | 'over'
    this.paused = false;
    this.loaded = false;
    this.time = 0;
    this.matchTime = 0;
    this.sfx = sfx;
    this.errors = [];
    this.net = null; // HostSession | ClientSession while in a multiplayer match
    this.inventoryOpen = false; // inventory screen (pointer unlocked, no pause)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 120, 200);
    this.camera.lookAt(0, 0, 0);
    // post chain (ink outlines + bloom + tone mapping); plain render when the preset disables both
    const q0 = QUALITY[graphicsQuality(this.settings)] || QUALITY.medium;
    this.post = new Post(this.renderer, this.scene, this.camera, { outline: q0.outline, bloom: q0.bloom, msaa: q0.msaa });
    this._applyPixelRatio();

    this.input = new Input(canvas);
    this.input.onLockChange = (locked) => this._onLockChange(locked);
    this.input.setBindings(this.settings.bindings); // remappable actions (src/ui/settings.js)
    this._wasLocked = false;
    canvas.addEventListener('click', () => {
      if ((this.state === 'play' || this.state === 'drop') && !this.paused) this.input.lock();
    });

    window.addEventListener('resize', () => this._resize());
    this._resize();

    this._last = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this._startBackgroundClock();

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
    this.atmosphere = new Atmosphere({ scene: this.scene, renderer: this.renderer, camera: this.camera, quality: graphicsQuality(this.settings) });
    this.view = await buildWorldMeshes({
      world: this.world,
      scene: this.scene,
      models,
      manifests: { nature, props, vehicles },
      onProgress: (v, label) => P(0.5 + v * 0.4, label || 'Building Bentonville'),
    });
    // a broken / restored building wall panel shows / hides its triangles
    this.world.onPanelChange = (c, panel, alive) => (alive ? this.view.showPanel(c, panel) : this.view.hidePanel(c, panel));

    P(0.92, 'Gearing up');
    this.fx = new Effects({ scene: this.scene, camera: this.camera, quality: graphicsQuality(this.settings) });
    this.hud = buildHud(this.uiRoot);
    this.hud.setVisible(false);
    const mb = mapData && mapData.meta && mapData.meta.bounds;
    if (mb && this.hud.setFullMapAspect) this.hud.setFullMapAspect((mb.maxX - mb.minX) / (mb.maxZ - mb.minZ));
    this.minimap = new Minimap({ mapData, miniCanvas: this.hud.getMinimapCanvas(), fullCanvas: this.hud.getFullMapCanvas() });
    this.pings = new Pings(this.hud.el);
    // full map: left click places your marker, right click removes it
    const fc = this.hud.getFullMapCanvas();
    fc.addEventListener('contextmenu', (e) => e.preventDefault());
    fc.addEventListener('pointerdown', (e) => {
      if (!this.fullMapOpen || (this.state !== 'play' && this.state !== 'drop')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) return this.placeMarker(null);
      if (e.button !== 0) return;
      const w = this.minimap.fullClientToWorld(e.clientX, e.clientY);
      if (!w || !w.inBounds) return;
      const mk = this.pings.markerOf(this.player.id);
      // clicking your own marker again removes it
      if (mk && this.minimap.worldToFullCanvas) {
        const a = this.minimap.worldToFullCanvas(mk.x, mk.z);
        const b = this.minimap.worldToFullCanvas(w.x, w.z);
        if (Math.hypot(a.px - b.px, a.py - b.py) < 18) return this.placeMarker(null);
      }
      this.placeMarker({ x: w.x, z: w.z });
    });
    this.invPanel = createInventoryPanel(this.hud.el, {
      onSwap: (a, b, expect) => this.swapSlots(a, b, expect),
      onSelect: (i) => this._selectSlot(i),
      onDrop: (what, expect) => this.dropFromInventory(what, expect),
    });
    this.invPanel.setKeyLabels((a) => this.input.label(a));
    this.emoteWheel = createEmoteWheel(this.hud.el);

    const Structures = StructMod.Structures;
    this.structures = Structures ? new Structures({ scene: this.scene, world: this.world, fx: this.fx, sfx }) : null;
    this.combat = new Combat({ world: this.world, structures: this.structures, fx: this.fx, sfx, view: this.view });
    this.combat.onDamage = (t, a, info) => this._onDamage(t, a, info);
    this.combat.onEliminate = (v, k, info) => this._onEliminate(v, k, info);
    this.combat.onKnock = (v, k, info) => this._onKnock(v, k, info);
    this.combat.onRevive = (v, by) => this._onRevive(v, by);
    this.combat.onCarry = (c, v, dropped) => this._onCarry(c, v, dropped);
    this.combat.onSiphon = (k, out) => this._onSiphon(k, out);
    this.combat.onAssist = (a, v) => this._onAssist(a, v);
    this._statDirty = new Set();
    this._statT = 0;
    this.combat.onStats = (a) => this._statDirty.add(a);

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
    registerKits(this.kits);
    const weaponScenes = {};
    for (const n of WEAPON_MODELS) if (models[n]) weaponScenes[n] = models[n].scene;
    this.weaponScenes = weaponScenes;
    const Inventory = InvMod.Inventory;
    const playerChar = this.kits.player ? new Character(this.kits.player, { weapons: weaponScenes, canopyColor: 0xffc21f }) : null;
    if (playerChar) this.scene.add(playerChar.root);
    this.player = new Player({ id: 0, name: 'You', character: playerChar, inventory: new Inventory() });
    this.player._skinKey = 'player|null';

    const BotsCls = BotsMod.Bots;
    const botKits = ['bot_a', 'bot_b', 'bot_c'].map((k) => this.kits[k]).filter(Boolean);
    this.bots = BotsCls
      ? new BotsCls({ scene: this.scene, world: this.world, kits: botKits, weaponModels: weaponScenes, loot: this.loot, structures: this.structures, combat: this.combat, fx: this.fx, sfx })
      : new NullBots();
    this.bots.dropLootOnDeath = false; // Game drops every actor's inventory in _onEliminate
    // Catfish Ken's reboot vans (one per POI) and reboot cards (team modes)
    this.reboot = new Reboot({ scene: this.scene, world: this.world, fx: this.fx, sfx });
    try {
      this.reboot.setup();
    } catch (err) {
      this._error('reboot.setup', err);
    }
    this.reboot.onReboot = (victim, van, x, y, z, h) => this.respawnActor(victim, x, y, z, h);
    this.reboot.onEvent = (e) => {
      if (this.net && this.net.isHost && this.net.started && this.net.events) this.net.events.push(e);
    };
    this.bots.reboot = this.reboot;
    this.dropBus = new DropBusMesh();
    this.scene.add(this.dropBus.root);
    this.busRoute = null;
    this.busT = 0;

    this.applySettings(this.settings);
    P(1, 'Ready');
    this.loaded = true;
  }

  // ---------------------------------------------------------------- match lifecycle

  /**
   * Outfit (Cosmetics.SKINS id) for the local player and the emotes on their wheel. Applied
   * now when loaded (the character is rebuilt with that model / tint), else at load.
   */
  setCosmetics({ skin, emotes, pickaxe, backbling } = {}) {
    if (skin) this.skin = skin;
    if (emotes) this.emotes = emotes.slice();
    if (pickaxe && PICKAXES[pickaxe]) this.pickaxe = pickaxe;
    if (this.hud && this.hud.setPickaxeName) this.hud.setPickaxeName(pickaxeDef(this.pickaxe).name);
    if (backbling && BACKBLINGS[backbling]) this.backbling = backbling;
    if (this.loaded && this.player) this._applySkin();
  }

  /** A new Character wearing outfit `skinId` (null when kits are missing). */
  makeSkinCharacter(skinId, canopyColor, pickaxe, backbling) {
    const def = skinDef(skinId);
    const kit = this.kits && (this.kits[def.model] || this.kits.player);
    return kit ? new Character(kit, { weapons: this.weaponScenes, canopyColor, tint: def.tint ?? undefined, pickaxe, backbling }) : null;
  }

  /** Swaps a remote human's / puppet's character for outfit `skinId` (keeps visibility, pose state resets). */
  reskinActor(a, skinId, pickaxe, backbling) {
    if (!a) return;
    const px = PICKAXES[pickaxe] ? pickaxe : null;
    const bb = BACKBLINGS[backbling] ? backbling : null;
    if (px) a.pickaxeCos = px;
    if (bb) a.backbling = bb;
    if (!skinId || a.skin === skinId) {
      if (a.character && (px || bb)) a.character.setLoadout({ pickaxe: px, backbling: bb });
      return;
    }
    a.skin = skinId;
    const old = a.character;
    const ch = this.makeSkinCharacter(skinId, old && old.canopy ? old.canopy.material.color.getHex() : 0xff7a45, a.pickaxeCos, a.backbling);
    if (!ch) return;
    if (old) {
      ch.root.visible = old.root.visible;
      ch.root.position.copy(old.root.position);
      this.scene.remove(old.root);
      if (old.dispose) old.dispose();
      if (old.mode === 'dead') ch.die();
    }
    this.scene.add(ch.root);
    a.character = ch;
    if ('equip' in a) a.equip = null; // puppet: re-attach its weapon on the next snapshot
  }

  /** (Re)builds the player's Character for this.skin when it changed. */
  _applySkin() {
    if (this.hud && this.hud.setPickaxeName) this.hud.setPickaxeName(pickaxeDef(this.pickaxe).name);
    const def = skinDef(this.skin);
    const kit = this.kits && (this.kits[def.model] || this.kits.player);
    const p = this.player;
    if (!kit || !p) return;
    const key = def.model + '|' + def.tint;
    if (p.character && p._skinKey === key) {
      p.character.setLoadout({ pickaxe: this.pickaxe, backbling: this.backbling });
      return;
    }
    const old = p.character;
    const ch = new Character(kit, { weapons: this.weaponScenes, canopyColor: 0xffc21f, tint: def.tint ?? undefined, pickaxe: this.pickaxe, backbling: this.backbling });
    if (old) {
      ch.root.visible = old.root.visible;
      ch.root.position.copy(old.root.position);
      this.scene.remove(old.root);
      if (old.dispose) old.dispose();
    }
    this.scene.add(ch.root);
    p.character = ch;
    p._skinKey = key;
    p.lastEquipped = null; // re-attach the held weapon model
  }

  startMatch(seed = (Math.random() * 1e9) | 0, opts = {}) {
    if (!this.loaded) throw new Error('load() first');
    this._applySkin();
    // free build is a solo sandbox; a multiplayer host never gets it
    const freeBuild = !!opts.freeBuild && !(this.net && this.net.isHost);
    this.freeBuild = freeBuild;
    this.seed = seed;
    const rng = makeRng(seed);
    this.rng = rng;
    this.matchTime = 0;
    this.result = null;
    this._matchEndPosted = false;
    this.paused = false;
    this._endTimer = 0;
    this._stormTick = 0;
    this.spectating = null;
    this._specH = null;
    this._specP = null;
    this._specDist = null;
    this._deathPlacement = 0;
    this._winPending = false;
    const net0 = this.net && this.net.isHost ? this.net : null;
    this._setMode(freeBuild ? 'solo' : net0 ? net0.mode : opts.mode);

    // world back to pristine
    this.combat.restoreWorld();
    this.combat.clear();
    this.combat.authoritative = true;
    if (this.structures) this.structures.clear();
    this.fx.clear();
    this.hud.clearTransient();
    if (this.pings) this.pings.reset();

    // storm, centred toward a random POI (the opening storm is dormant and covers the map;
    // nobody picks a drop spot any more, the Drop Bus decides where people can land)
    const zone = DROP_ZONES[Math.floor(rng() * DROP_ZONES.length)];
    const lm = this.world.landmarks[zone.key] || { x: 0, z: 0 };
    this.storm.reset(rng, { x: lm.x, z: lm.z });
    this.dropZone = zone;
    this.hud.setStormVisible(!freeBuild);

    // loot inside the first circle (with margin)
    if (this.loot) this.loot.spawnMatch(rng, { area: { x: this.storm.cx, z: this.storm.cz, r: STORM.startRadius * 1.15 } });

    // player
    const p = this.player;
    p.reset();
    p.team = p.id;
    p.god = p.invulnerable = freeBuild; // free build: nothing can end the session but Leave
    if (freeBuild) this._refillMats();
    this.combat.register(p);
    // canonical route: exactly what a multiplayer host sends (routeWire rounds), so the host
    // simulates and validates the same geometry / tOpen / tClose its clients rebuild
    this._boardBus(makeRoute(routeWire(planBusRoute(seed, this.world.bounds))));

    // bots (multiplayer host: remote humans take slots first; see HostSession.prepareMatch)
    const net = this.net && this.net.isHost ? this.net : null;
    let botCount = freeBuild ? 0 : MATCH.bots;
    const spawnOpts = {};
    if (net) {
      const plan = net.prepareMatch(this, lm);
      botCount = plan.botCount;
      spawnOpts.idBase = plan.idBase;
      if (this.teamMode) {
        spawnOpts.teams = plan.botTeams;
        if (plan.playerTeam != null) p.team = plan.playerTeam;
      }
    } else if (this.teamMode) {
      // local team match: the player's team (+ bot teammates with fill), then full bot teams
      const plan = assignTeams(this.mode, [{ ids: [p.id], allowBots: opts.fill !== false }], { slots: MATCH.bots + 1, bots: true });
      p.team = plan.humanTeam.get(p.id);
      botCount = plan.botTeams.length;
      spawnOpts.teams = plan.botTeams;
    }
    this.bots.clear();
    const names = botNames(botCount, rng);
    // bots ride the bus too: landing spots spread over POIs and open ground, busier near the route
    // (team modes: one landing spot per bot team, shared by its members)
    const dropPoints = spawnOpts.teams ? teamDropPoints(this.busRoute, this.world, rng, spawnOpts.teams) : planBotTargets(this.busRoute, this.world, rng, botCount);
    try {
      this.bots.spawn(botCount, rng, { names, difficulty: this.settings.difficulty, dropPoints, bus: this.busRoute, ...spawnOpts });
    } catch (err) {
      this._error('bots.spawn', err);
    }
    this.totalActors = 1 + (net ? net.remotes.size : 0) + this.bots.list.length;
    this._setupTeam();

    if (freeBuild) {
      this._startFreeBuild(lm);
      return;
    }

    this._enterBusPhase();
    if (net) net.matchStarted(this);
  }

  /**
   * Identity of the loaded map file (multiplayer start check): meta.generated, else a short
   * hash of meta.composition. null before the map loads or when it carries neither.
   */
  get mapId() {
    const meta = this.mapData && this.mapData.meta;
    if (!meta) return null;
    // '+i<version>.<hash>': building interiors are generated on every client, so their version
    // and plan hash are part of the map (catches stale builds and any nondeterministic layout)
    const iv = '+i' + INTERIOR_VERSION + (this.world && this.world.interiorHash ? '.' + this.world.interiorHash : '');
    if (meta.generated) return String(meta.generated) + iv;
    if (!meta.composition) return null;
    const str = JSON.stringify(meta.composition);
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return 'c' + (h >>> 0).toString(16) + iv;
  }

  /** Puts the local player aboard the Drop Bus flying `route`. */
  _boardBus(route) {
    const p = this.player;
    this.busRoute = route;
    this.busT = 0;
    this.dropMarker = null;
    busPosAt(route, 0, p.pos);
    p.vel.set(0, 0, 0);
    p.heading = route.heading;
    p.pitch = -0.3;
    p.mode = 'bus';
    p.inBus = true;
    if (p.character) p.character.root.visible = false;
  }

  /** Drop phase UI: third-person bus view, M shows the route, SPACE jumps. */
  _enterBusPhase() {
    this.state = 'drop';
    this.fullMapOpen = false;
    if (!this.inventoryOpen && this.input) this.input.trap = false;
    this.hud.setVisible(true);
    this.hud.showFullMap(false);
    this._setFullMapInteractive(false);
    const jumpKey = this.input.label('jump') || 'SPACE';
    this.hud.announce('ALL ABOARD THE DROP BUS', `[${jumpKey}] to jump \u00b7 [${this.input.label('map') || 'M'}] for the route`, 4000);
    this.menus.hideAll();
    this._showBusBanner();
    sfx.stopMusic();
    // the bus hum: the storm loop's low rumble, quietly (stormOn is false during the drop)
    sfx.startLoop('storm_wind');
    sfx.setLoopGain('storm_wind', 0.28);
    this.input.lock();
  }

  /** Seconds until the Drop Bus leaves the map (auto-eject). */
  get busLeft() {
    return this.busRoute ? Math.max(0, this.busRoute.tClose - this.busT) : 0;
  }

  _showBusBanner() {
    const r = this.busRoute;
    const waiting = r && this.busT < r.tOpen;
    this.menus.showDropBanner(true, this.busLeft, null, {
      title: `[${this.input.label('jump') || 'SPACE'}] Jump from the Drop Bus`,
      sub: waiting ? 'Approaching the map\u2026' : 'Seconds until the bus leaves the map',
    });
  }

  /** Free build: skip the bus and stand on open ground near the landmark. */
  _startFreeBuild(lm) {
    const p = this.player;
    this.busRoute = null; // no Drop Bus in the sandbox
    p.inBus = false;
    if (this.dropBus) this.dropBus.root.visible = false;
    let x = lm.x;
    let z = lm.z;
    for (let i = 0; i < 40; i++) {
      const pt = this.world.randomOpenPoint(this.rng, lm.x, lm.z, 40, 6);
      if (!this.world.polyAt(pt.x, pt.z) && !this.world.blockedAt(pt.x, pt.z, 6)) {
        x = pt.x;
        z = pt.z;
        break;
      }
    }
    p.pos.set(x, this.world.groundHeight(x, z, 1e4), z);
    p.vel.set(0, 0, 0);
    p.mode = 'ground';
    p.grounded = true;
    if (p.character) p.character.root.visible = true;
    this.state = 'play';
    this.hud.setVisible(true);
    this.hud.showFullMap(false);
    this._setFullMapInteractive(false);
    this.menus.hideAll();
    this.menus.showDropBanner(false);
    this.hud.announce('FREE BUILD', 'No bots, no storm, unlimited mats. Esc > Leave to exit', 3500);
    sfx.stopMusic();
    this.input.lock();
  }

  _refillMats() {
    const mats = this.player.inventory.mats;
    for (const m of MATERIALS) mats[m] = PLAYER.matCap;
  }

  /**
   * Multiplayer client: set up the match the host described (see HostSession.matchStarted).
   * The static world is identical everywhere (seeded generation); loot and the storm are
   * copied from the host, and everyone else is a Puppet driven by snapshots.
   */
  startClientMatch(start) {
    if (!this.loaded) throw new Error('load() first');
    this._applySkin();
    const net = this.net;
    this.seed = start.seed;
    this.rng = makeRng(start.seed);
    this.matchTime = 0;
    this.result = null;
    this._matchEndPosted = false;
    this.paused = false;
    this._endTimer = 0;
    this._stormTick = 0;
    this.spectating = null;
    this._specH = null;
    this._specP = null;
    this._specDist = null;
    this._deathPlacement = 0;
    this._winPending = false;
    this._setMode(start.mode);

    this.combat.restoreWorld();
    this.combat.clear();
    this.combat.authoritative = false;
    this.freeBuild = false;
    this.hud.setStormVisible(true);
    if (this.structures) this.structures.clear();
    this.fx.clear();
    this.hud.clearTransient();
    if (this.pings) this.pings.reset();
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
    const me = (start.roster || []).find((r) => r.id === start.you);
    p.team = me && me.tm != null ? me.tm : start.you;
    this.combat.register(p);
    // the host's route when it sent one, else the same route derived from the shared seed
    this._boardBus(start.bus ? makeRoute(start.bus) : planBusRoute(start.seed, this.world.bounds));

    net.begin(this, start);
    this.totalActors = start.total;
    this._setupTeam();
    this._enterBusPhase();
  }

  /** Match mode: solo, or a team mode (knocks, revives, team win). */
  _setMode(mode) {
    this.mode = normalizeMode(mode);
    this.teamMode = this.mode !== 'solo';
    this.combat.teamMode = this.teamMode;
    if (this.hud && this.hud.setTeam) {
      this.hud.setTeam(null);
      this.hud.setTags(null);
      this.hud.setDowned(null);
      this.hud.setRevive(null);
    }
  }

  /** After every actor exists: team count, our teammates and their slot colours. */
  _setupTeam() {
    const p = this.player;
    const actors = this.combat.actors;
    this.totalTeams = this.teamMode ? teamCount(actors) : this.totalActors;
    const members = this.teamMode ? actors.filter((a) => a === p || sameTeam(a, p)).sort((a, b) => a.id - b.id) : [p];
    members.forEach((a, i) => (a.teamSlot = i));
    this.mates = members.filter((a) => a !== p);
    if (this.reboot) this.reboot.reset({ teamMode: this.teamMode, authoritative: !(this.net && this.net.isClient), myTeam: this.teamMode ? p.team : null });
  }

  /**
   * Reboot van (host / solo): brings an eliminated actor back standing at (x, y, z) with
   * REBOOT.loadout, keeping their kills / assists / damage. Clients hear about it through the
   * 'rbd' event (ClientSession) and call netRespawn for themselves.
   */
  respawnActor(a, x, y, z, heading = 0) {
    if (!a || a.alive) return;
    if (a._bot && this.bots.respawn) {
      this.bots.respawn(a, x, y, z, heading, rebootLoadout());
    } else {
      reviveFields(a, x, y, z, heading);
      if (a.isRemote) {
        a.allowJump = true; // its next state comes from the van, wherever it was before
        a.lastStateT = 0;
      }
    }
    if (a === this.player) this._onRespawned();
    this.hud.killFeed(`${a.name} was rebooted`, 'revive', [a.name], this.player.name);
    if (this.fx && this.fx.aura) this.fx.aura(a.pos, 'shield', 1.4);
  }

  /** Multiplayer client: the host rebooted us. */
  netRespawn(x, y, z, heading) {
    const p = this.player;
    if (p.alive) return;
    reviveFields(p, x, y, z, heading);
    this._onRespawned();
  }

  _onRespawned() {
    const p = this.player;
    p.mode = 'ground';
    p.cooldown = p.reloadT = p.useT = 0;
    p.reloadItem = p.useItem = null;
    p.lastEquipped = null;
    p.buildPiece = null;
    p.editing = null;
    this.spectating = null;
    this._specH = this._specP = null;
    this._endTimer = DEATH_SCREEN_DELAY;
    this._deathPlacement = 0;
    if (this.hud.setDowned) this.hud.setDowned(null);
    this.hud.announce('REBOOTED', 'Back in the fight at Catfish Ken\'s van', 2400);
    sfx.play('heal', { volume: 0.8 });
  }

  /** Teammates still alive (knocked or not). */
  _mateAlive() {
    if (!this.teamMode) return null;
    for (const m of this.mates) if (m.alive) return m;
    return null;
  }

  /** Alive actors you can watch: teammates first while any remain, else everyone else. */
  _spectatePool() {
    const p = this.player;
    const actors = this.combat && this.combat.actors ? this.combat.actors : [];
    const alive = actors.filter((a) => a && a.alive && a !== p);
    if (!alive.length) return [];
    if (this.teamMode) {
      const mates = alive.filter((a) => sameTeam(a, p));
      if (mates.length) return mates;
    }
    return alive;
  }

  /** Start / retarget spectating. Snaps the camera look to their heading. */
  _setSpectating(actor) {
    this.spectating = actor && actor.alive ? actor : null;
    if (this.spectating) {
      this._specH = this.spectating.heading || 0;
      this._specP = this.spectating.pitch || 0;
      this._specDist = CAMERA.distance;
    }
  }

  /** Cycle to the next (+) or previous (−) alive spectate target. */
  _cycleSpectate(dir = 1) {
    const pool = this._spectatePool();
    if (!pool.length) {
      this._setSpectating(null);
      return;
    }
    let i = pool.indexOf(this.spectating);
    if (i < 0) i = dir > 0 ? -1 : 0;
    const next = pool[(i + dir + pool.length * 8) % pool.length];
    this._setSpectating(next);
  }

  /** Keep a valid target, or pick a default (mate → killer → anyone). */
  _ensureSpectating(preferred) {
    if (this.spectating && this.spectating.alive) {
      const pool = this._spectatePool();
      if (pool.includes(this.spectating)) return;
    }
    const pool = this._spectatePool();
    if (preferred && preferred.alive && pool.includes(preferred)) {
      this._setSpectating(preferred);
      return;
    }
    const mate = this._mateAlive();
    if (mate && pool.includes(mate)) {
      this._setSpectating(mate);
      return;
    }
    this._setSpectating(pool[0] || null);
  }

  /** Drop Bus clock: the host's match clock on a client (once snapshots arrive), else local. */
  _tickBusClock(dt) {
    const net = this.net;
    if (net && net.isClient && net.offset != null) {
      const ht = performance.now() / 1000 + net.offset;
      if (Number.isFinite(ht)) {
        // follow the host clock: snap on a big error (first offset, re-estimate), else ease
        // toward it (small decreases allowed, so a lowered offset estimate is honoured)
        if (Math.abs(ht - this.busT) > 0.75) this.busT = ht;
        else {
          this.busT += dt;
          this.busT += (ht - this.busT) * (1 - Math.exp(-5 * dt));
        }
        return;
      }
    }
    this.busT += dt;
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
    p.downed = false;
    if (placement) this._deathPlacement = placement;
    this._ensureSpectating(killer && killer.alive ? killer : null);
    this._endTimer = DEATH_SCREEN_DELAY;
    this.hud.announce(
      'ELIMINATED',
      killerName
        ? `by ${killerName} · [LMB]/[RMB] switch player`
        : '[LMB]/[RMB] switch player',
      3200,
    );
    sfx.stopLoop('glide_wind');
  }

  /** Multiplayer client: the host says we were knocked (the snapshot carries the state). */
  netKnock(killerName) {
    const p = this.player;
    if (!p.alive) return;
    const was = p.downed;
    p.downed = true;
    if (!was) p.downHp = KNOCK.downHp;
    p.health = 0;
    p.shield = 0;
    if (!was) sfx.play('hurt', { volume: 0.9 }); // the knocked overlay says the rest
    void killerName;
  }

  /** Multiplayer client: the host says we are the last one standing. */
  netWin() {
    // team modes: the whole winning team wins, eliminated members included
    if (this.state !== 'play' || (!this.player.alive && !this.teamMode) || this._winPending) return;
    this._winPending = true;
    this._endTimer = WIN_SCREEN_DELAY;
    this.hud.announce('#1 IN BENTONVILLE', this.teamMode ? 'Last team standing!' : 'Last one standing!', 3000);
    if (this.player.character && this.player.alive && !this.player.downed) this.player.character.emote(true, (this.emotes || []).find(Boolean));
  }

  /**
   * Leave the Drop Bus where it is now. Refused before the bus is over the map unless
   * `force` (auto-eject, QA). `at` {x, z}: QA override of the exit point.
   */
  jump(force = false, at = null) {
    if (this.state !== 'drop') return false;
    const r = this.busRoute;
    // a client's bus clock can run up to ~0.75 s ahead of the host's, which accepts exits from
    // tOpen - 0.5: wait a beat longer so an honest jump is never corrected
    const open = r ? r.tOpen + (this.net && this.net.isClient ? 0.3 : 0) : 0;
    if (!force && r && this.busT < open) return false;
    const p = this.player;
    const bp = r ? busPosAt(r, Math.min(this.busT, r.tClose)) : { x: p.pos.x, y: PLAYER.dropHeight, z: p.pos.z };
    const x = at ? at.x : bp.x;
    const z = at ? at.z : bp.z;
    p.spawnDrop(x, z, bp.y - 1);
    if (r && !at) p.vel.set(r.dx * 8, 0, r.dz * 8); // a little of the bus's momentum
    p.inBus = false;
    if (p.character) p.character.root.visible = true;
    this.state = 'play';
    this.fullMapOpen = false;
    if (!this.inventoryOpen && this.input) this.input.trap = false;
    this.hud.showFullMap(false);
    this._setFullMapInteractive(false);
    this.menus.showDropBanner(false);
    sfx.stopLoop('storm_wind'); // the bus hum
    this.hud.announce('DROP!', 'SPACE opens your glider early', 2200);
    sfx.play('zone_enter', { volume: 0.6 });
    sfx.startLoop('glide_wind');
    if (!this.paused) this.input.lock(); // multiplayer auto-eject under the pause menu: keep the menu
    return true;
  }

  pause(on) {
    if (this.state !== 'play' && this.state !== 'drop') return;
    if (on === this.paused) return;
    this.paused = on;
    if (on) {
      this.closeInventory(false);
      this.input.unlock();
      this.input.releaseAll();
      this.menus.showPause();
    } else {
      this.menus.hideAll();
      if (this.state === 'drop') this._showBusBanner();
      this.input.lock();
    }
  }

  /** Back to the main menu. */
  leave() {
    // Leaving while dead / after a win still counts the match (rewards + leaderboard).
    if (this.state === 'play' && this.player && (!this.player.alive || this._winPending)) {
      this._postMatchEnd(!!this._winPending);
    }
    if (this.net) {
      this.net.dispose(this);
      this.net = null;
      this.combat.authoritative = true;
    }
    this.closeInventory(false);
    if (this.emoteWheel) this.emoteWheel.hide();
    if (this.player) this.player._wheel = null;
    this.state = 'menu';
    this.paused = false;
    this.input.unlock();
    sfx.stopLoop('storm_wind');
    sfx.stopLoop('glide_wind');
    if (this.hud) {
      this.hud.setVisible(false);
      this.hud.clearTransient();
      if (this.pings) this.pings.reset();
    if (this.pings) this.pings.reset();
      this._setFullMapInteractive(false);
    }
    this.menus.showTitle();
  }

  /** Build the result payload and notify account rewards once per match. */
  _postMatchEnd(victory) {
    if (this._matchEndPosted || !this.player) return this.result;
    this._matchEndPosted = true;
    const placement = victory ? 1 : this._deathPlacement || (this.teamMode ? this.combat.aliveTeams + 1 : this.combat.aliveCount + 1);
    this.result = {
      victory,
      placement,
      kills: this.player.kills | 0,
      total: this.totalActors,
      time: this.matchTime,
      killer: this.player.lastKillerName || null,
      mode: this.mode,
      teams: this.totalTeams || this.totalActors,
    };
    if (this.net) {
      this.result.mp = true;
      // the host keeps simulating for everyone until it leaves
      this.result.hostNote = this.net.isHost && !this.net.ended ? 'You are hosting: leaving ends the match for everyone still playing.' : null;
    }
    if (this.onMatchEnd) {
      try {
        this.onMatchEnd(this.result);
      } catch (err) {
        console.error(err);
      }
    }
    return this.result;
  }

  _endMatch(victory) {
    if (this.state === 'over') return;
    this.closeInventory(false);
    this.state = 'over';
    this._postMatchEnd(victory);
    this.input.unlock();
    sfx.stopLoop('storm_wind');
    sfx.stopLoop('glide_wind');
    sfx.playMusic(victory ? 'victory' : 'defeat');
    this.hud.prompt(null);
    this.hud.setRevive(null);
    this.hud.setDowned(null);
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
    // team modes: a reboot card for a teammate to bring to a reboot van
    if (this.reboot && this.teamMode && !info.left && !(this.net && this.net.isClient)) {
      try {
        this.reboot.dropCard(victim, this.combat.actors);
      } catch (err) {
        this._error('reboot.dropCard', err);
      }
    }
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
    else if (info.bleed) text = killer ? `${victim.name} bled out (${killer.name})` : `${victim.name} bled out`;
    else if (info.wipe) text = killer ? `${killer.name} wiped ${victim.name}` : `${victim.name} was eliminated`;
    else if (killer) {
      const how = info.weapon === 'pickaxe' ? 'bonked' : info.headshot ? 'headshot' : 'eliminated';
      text = `${killer.name} ${how} ${victim.name}`;
    } else text = `${victim.name} was eliminated`;
    if (killer === p) kind = 'kill';
    if (victim === p) kind = 'self';
    this.hud.killFeed(text, kind, [victim.name, killer && killer.name], p.name);

    if (killer === p) {
      this.hud.announce(`ELIMINATED ${victim.name.toUpperCase()}`, `${p.kills} elimination${p.kills === 1 ? '' : 's'}`, 1800);
    }
    if (victim === p) {
      p.lastKillerName = killer ? killer.name : info.storm ? 'the storm' : null;
      if (!this.teamMode) this._deathPlacement = this.combat.aliveCount + 1;
      this._ensureSpectating(killer && killer.alive ? killer : null);
      this._endTimer = DEATH_SCREEN_DELAY;
      this.hud.announce(
        'ELIMINATED',
        killer
          ? `by ${killer.name} · [LMB]/[RMB] switch player`
          : info.storm
            ? 'by the storm · [LMB]/[RMB] switch player'
            : '[LMB]/[RMB] switch player',
        3200,
      );
      sfx.stopLoop('glide_wind');
    }
    // team modes: our place is fixed when the last of us goes
    if (this.teamMode && victim.team === p.team && !teamAlive(this.combat.actors, p.team)) this._deathPlacement = this.combat.aliveTeams + 1;
  }

  _onKnock(victim, by, info) {
    const p = this.player;
    if (this.net && this.net.isHost && this.net.onKnock) this.net.onKnock(victim, by, info);
    let text;
    if (info.storm && !by) text = `${victim.name} was knocked by the storm`;
    else if (info.fall) text = `${victim.name} fell and was knocked`;
    else if (by) text = `${by.name} ${info.weapon === 'pickaxe' ? 'bonked' : 'knocked'} ${victim.name}`;
    else text = `${victim.name} was knocked`;
    if (victim === p && !by && !info.storm && !info.fall) text = 'You were knocked';
    this.hud.killFeed(text, by === p ? 'kill' : victim === p ? 'self' : victim.team === p.team ? 'mate' : 'knock', [victim.name, by && by.name], p.name);
    if (by === p) this.hud.announce(`KNOCKED ${victim.name.toUpperCase()}`, 'Finish them before they are revived', 1600);
    if (victim === p) sfx.play('hurt', { volume: 0.9 }); // the knocked overlay says the rest
  }

  _onAssist(a, victim) {
    if (this.net && this.net.isHost && this.net.events && this.net.started) this.net.events.push({ e: 'as', a: a.id, v: victim.id });
    if (a === this.player) this.showAssist(victim.name);
  }

  showAssist(name) {
    this.hud.toast(`ASSIST  ${name || ''}`.trim(), 'kill');
    sfx.play('hitmarker', { volume: 0.5 });
  }

  /** Host: kills / assists / damage of everyone that changed, to the clients (twice a second). */
  _syncStats(dt) {
    const net = this.net;
    this._statT -= dt;
    if (!this._statDirty.size || this._statT > 0) return;
    this._statT = 0.5;
    if (net && net.isHost && net.started && net.events) {
      const s = [];
      for (const a of this._statDirty) s.push([a.id, a.kills | 0, a.assists | 0, Math.round(a.damageDealt || 0)]);
      net.events.push({ e: 'ts', s });
    }
    this._statDirty.clear();
  }

  _onSiphon(killer, out) {
    if (this.net && this.net.isHost && this.net.events && this.net.started) this.net.events.push({ e: 'sph', a: killer.id, h: Math.round(out.hp), s: Math.round(out.shield) });
    if (killer === this.player) this.showSiphon(out.hp, out.shield);
  }

  /** "+40 HP  +10 SHIELD" after an elimination (siphon). */
  showSiphon(hp, shield) {
    const parts = [];
    if (hp > 0) parts.push(`+${Math.round(hp)} HP`);
    if (shield > 0) parts.push(`+${Math.round(shield)} SHIELD`);
    if (!parts.length) return;
    this.hud.toast('SIPHON  ' + parts.join('  '), 'pickup');
    sfx.play('heal', { volume: 0.5 });
  }

  _onCarry(carrier, victim, dropped) {
    if (this.net && this.net.isHost && this.net.onCarry) this.net.onCarry(carrier, victim, dropped);
    const p = this.player;
    if (victim && victim === p) this.hud.toast(`${carrier.name} picked you up`, 'pickup');
  }

  _onRevive(victim, by) {
    const p = this.player;
    if (this.net && this.net.isHost && this.net.onRevive) this.net.onRevive(victim, by);
    this.hud.killFeed(by ? `${by.name} revived ${victim.name}` : `${victim.name} is back up`, 'revive', [victim.name, by && by.name], p.name);
    if (victim === p) this.hud.announce('REVIVED', by ? `by ${by.name}` : '', 1800);
    sfx.play('pickup', { x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z, volume: 0.6 });
  }

  // ---------------------------------------------------------------- per frame

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 0;
    // up to SIM_CATCHUP_MAX s per frame: a slow frame is simulated in <= SIM_STEP sub-steps
    // (frame()), so a host below 20 fps no longer runs the match in slow motion for everyone
    dt = Math.min(dt, SIM_CATCHUP_MAX);
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

    input.inMatch = this.state === 'play' && !this.paused;
    this._inventoryInput(input);
    if (this.fullMapOpen && input.hit('Escape')) {
      input.consume('Escape'); // Escape closes the map, not the game
      this.toggleFullMap(false);
    }
    if (input.hit('Escape') && !input.locked && (this.state === 'play' || this.state === 'drop')) this.pause(!this.paused);
    if (input.actionHit('map') && (this.state === 'play' || this.state === 'drop') && !this.paused) this.toggleFullMap(!this.fullMapOpen);
    if (input.actionHit('ping') && this.state === 'play' && !this.paused && !this.inventoryOpen && !this.fullMapOpen) this.pingAim();

    // a multiplayer match keeps running under the pause menu
    const live = (!this.paused || !!this.net) && (this.state === 'drop' || this.state === 'play' || this.state === 'over');
    if (live) this._simulateSteps(dt);

    this._present(Math.min(dt, SIM_STEP));
    input.endFrame();
  }

  /**
   * Runs _simulate over `dt` in sub-steps of at most SIM_STEP s. Key / click presses and
   * mouse look count once (first sub-step); held keys apply to every sub-step.
   */
  _simulateSteps(dt) {
    const n = Math.max(1, Math.ceil(dt / SIM_STEP - 1e-6));
    const step = dt / n;
    const t1 = this.time;
    for (let i = 0; i < n; i++) {
      this.time = t1 - dt + step * (i + 1);
      this._simulate(step);
      if (i < n - 1) this.input.endFrame();
    }
    this.time = t1;
  }

  /**
   * A hosted match keeps running while the host's tab is hidden (requestAnimationFrame stops
   * there): a worker clock (not throttled like page timers) drives the simulation without
   * rendering until the tab is visible again.
   */
  _startBackgroundClock() {
    if (this._bgWorker || typeof Worker === 'undefined' || typeof Blob === 'undefined') return;
    try {
      const url = URL.createObjectURL(new Blob([BG_CLOCK_SRC], { type: 'text/javascript' }));
      this._bgWorker = new Worker(url);
      URL.revokeObjectURL(url);
      this._bgWorker.onmessage = () => this._backgroundTick();
    } catch {
      this._bgWorker = null; // CSP / old browser: hidden host tabs just pause, as before
    }
  }

  _backgroundTick() {
    const now = performance.now();
    if (!document.hidden || !(this.net && this.net.isHost)) {
      this._bgLast = now;
      return;
    }
    // rAF still ran recently: nothing to cover
    if (now - this._last < 250) {
      this._bgLast = now;
      return;
    }
    const from = Math.max(this._last, this._bgLast || 0);
    let dt = (now - from) / 1000;
    this._bgLast = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, SIM_CATCHUP_MAX);
    this.time += dt;
    try {
      const live = this.state === 'drop' || this.state === 'play' || this.state === 'over';
      if (live) this._simulateSteps(dt);
    } catch (err) {
      this._error('background', err);
    }
    this.input.endFrame();
    this._last = now; // the next visible frame starts from here
  }

  _simulate(dt) {
    const p = this.player;
    const input = this.paused ? NO_INPUT : this.input;
    const client = !!(this.net && this.net.isClient);

    let leftBus = false;
    // the Drop Bus clock runs all match long: bots (and remote humans) leave it after we do
    if (this.busRoute) this._tickBusClock(dt);
    if (this.state === 'drop') {
      const r = this.busRoute;
      if (!r) {
        this.jump(true); // no route (should not happen): drop straight in rather than crash every frame
        return;
      }
      // ride along: the player sits in the bus (hidden), mouse look orbits the camera
      busPosAt(r, Math.min(this.busT, r.tClose), p.pos);
      const sens = (this.settings.sensitivity || 1) * 0.0022;
      p.heading = (((p.heading + input.dx * sens) % TAU) + TAU) % TAU;
      p.pitch = clamp(p.pitch - input.dy * sens * (this.settings.invertY ? -1 : 1), -1.25, 0.45);
      this._showBusBanner();
      if (this.busT >= r.tClose) {
        leftBus = this.jump(true);
        this.hud.announce('EJECTED', 'The Drop Bus left the map', 2200);
      } else if (input.actionHit('jump') && !this.paused) leftBus = this.jump();
    } else {
      this.matchTime += dt;
      if (!client && !this.freeBuild) this.storm.update(dt); // free build: storm stays dormant
      if (this.freeBuild) this._refillMats();
    }

    if (this.state === 'play' || this.state === 'over') {
      if (p.alive) {
        const wasDrop = p.airborneDrop;
        // the frame we leave the bus, the same jump press must not also open the glider
        p.update(dt, this.state === 'play' && !leftBus ? input : NO_INPUT, this);
        if (wasDrop && !p.airborneDrop) sfx.stopLoop('glide_wind');
      } else {
        p.update(dt, NO_INPUT, this);
      }
      if (!client && !this.freeBuild) this._stormDamage(dt);
      if (!client && this.teamMode) this.combat.tickTeams(dt);
    }
    // sniper rounds in flight (host / solo: damage; client: effects only)
    if (this.state === 'play' || this.state === 'over') this.combat.tickProjectiles(dt);

    if (!client) {
      try {
        this.bots.update(dt, { player: p, storm: this.storm, time: this.time, busTime: this.busT });
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
    if (!client && this.teamMode) this.combat.tickCarry(); // carried teammates ride on shoulders
    if (!client) this._syncStats(dt);
    if (this.structures) this.structures.update(dt);
    if (this.loot) this.loot.update(dt, this.camera.position);
    if (this.reboot && (this.state === 'play' || this.state === 'over')) this.reboot.update(dt, this.combat.actors);

    // match end (team modes: a team is out once nobody on it is alive; dead members wait)
    if (this.state === 'play') {
      const mate = p.alive ? null : this._mateAlive();
      const won = client
        ? this._winPending
        : this.teamMode
          ? this.totalTeams > 1 && this.combat.aliveTeams <= 1
          : this.totalActors > 1 && this.combat.aliveCount <= 1;
      if (!p.alive && !this.paused) {
        // LMB / RMB (or A/D) cycle who you're watching from their POV
        if (input.actionHit('fire') || input.actionHit('moveRight') || input.hit('Digit2')) this._cycleSpectate(1);
        else if (input.actionHit('aim') || input.actionHit('moveLeft') || input.hit('Digit1')) this._cycleSpectate(-1);
        this._ensureSpectating();
      }
      if (!p.alive && !mate) {
        this._endTimer -= dt;
        if (this._endTimer <= 0) this._endMatch(false);
      } else if (won) {
        if (!p.alive) this._ensureSpectating(mate);
        if (!this._winPending) {
          this._winPending = true;
          this._endTimer = WIN_SCREEN_DELAY;
          this.hud.announce('#1 IN BENTONVILLE', this.teamMode ? 'Last team standing!' : 'Last one standing!', 3000);
          if (p.character && p.alive && !p.downed) p.character.emote(true, (this.emotes || []).find(Boolean));
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
      // third person behind the Drop Bus
      _v.set(p.pos.x, p.pos.y + 6, p.pos.z);
      placeOrbitCamera(cam, null, _v, p.heading, p.pitch, BUS_CAM_DIST, 0, 0);
    } else if (inMatch) {
      if (!p.alive && this.spectating && this.spectating.alive) {
        // POV follow: over-the-shoulder behind the watched player, looking where they look
        const t = this.spectating;
        const wantH = t.heading || 0;
        const wantP = clamp(t.pitch || 0, CAMERA.minPitch, CAMERA.maxPitch);
        if (this._specH == null) this._specH = wantH;
        if (this._specP == null) this._specP = wantP;
        // shortest-path ease toward their look (avoids spinning the long way)
        let dh = wantH - this._specH;
        while (dh > Math.PI) dh -= TAU;
        while (dh < -Math.PI) dh += TAU;
        const k = 1 - Math.exp(-14 * dt);
        this._specH += dh * k;
        this._specP += (wantP - this._specP) * k;
        this._specDist = damp(this._specDist == null ? CAMERA.distance : this._specDist, CAMERA.distance, 10, dt);
        const crouchDrop = t.crouching ? 0.45 : 0;
        _v.set(t.pos.x, t.pos.y + CAMERA.pivotHeight - crouchDrop, t.pos.z);
        placeOrbitCamera(cam, this.world, _v, this._specH, this._specP, this._specDist, CAMERA.shoulder);
        const baseFov = this.settings.fov || CAMERA.fov;
        if (Math.abs(cam.fov - baseFov) > 0.01) {
          cam.fov = baseFov;
          cam.updateProjectionMatrix();
        }
      } else if (!p.alive) {
        _v.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
        this._specH = (this._specH == null ? p.heading : this._specH) + dt * 0.15;
        placeOrbitCamera(cam, this.world, _v, this._specH, -0.35, 7, 0);
      } else p.updateCamera(cam, dt, this.world, this.settings.fov || CAMERA.fov);
    }

    // the Drop Bus keeps flying its route after everyone has jumped
    if (this.dropBus) this.dropBus.update(this.busRoute, this.busT, dt, inMatch && !this.freeBuild && !!this.busRoute);

    // world culling a few times a second
    this._cullT = (this._cullT || 0) - dt;
    if (this._cullT <= 0 && this.view) {
      this._cullT = 0.25;
      this.view.update(cam.position, QUALITY[graphicsQuality(this.settings)] || QUALITY.medium);
    }

    const s = this.storm;
    const focus = inMatch ? (this.spectating && this.spectating.alive ? this.spectating.pos : p.pos) : cam.position;
    const stormOn = inMatch && this.state !== 'drop';
    const intensity = stormOn ? s.intensityAt(focus.x, focus.z) : 0;
    // no wall while the opening storm is dormant (harmless, up to STORM.openMaxRadius wide) or in free build
    this.atmosphere.setStorm(inMatch && !s.dormant && !this.freeBuild ? s : null);
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
    const watching =
      this.state === 'play' && !p.alive && this.spectating && this.spectating.alive ? this.spectating : null;
    const vitals = watching || p;
    hud.setHealth(vitals.health || 0, PLAYER.maxHealth);
    hud.setShield(vitals.shield || 0, PLAYER.maxShield);
    hud.setMaterials(inv.mats, p.buildMat);
    hud.setHotbar(inv.hotbar(), p.buildPiece ? -1 : inv.selected);
    if (this.inventoryOpen) this._updateInventoryPanel();
    hud.setBuildMode(watching ? null : p.buildPiece);
    const rl = p.reloadT > 0 ? 1 - p.reloadT / p.reloadTotal : 0;
    hud.setWeapon(watching || p.buildPiece ? null : inv.weaponHud ? inv.weaponHud(rl) : null);
    const cur = inv.current();
    const curW = cur && cur.type === 'weapon' ? WEAPONS[cur.id] : null;
    const kind = p.buildPiece ? 'build' : curW ? (curW.kind === 'shotgun' ? 'shotgun' : 'gun') : 'pickaxe';
    const spreadNow = p.computeSpread();
    // true on-screen pellet cone: its radius as a fraction of half the viewport height at the current fov
    const spreadFrac = Math.tan(spreadNow) / Math.tan((this.camera.fov * Math.PI) / 360);
    hud.setCrosshair(watching ? null : { spread01: clamp(spreadNow / 0.06, 0, 1), spreadFrac, hit: false, kind });
    hud.el.classList.toggle('is-onbus', this.state === 'drop'); // no aiming UI while riding the Drop Bus
    hud.el.classList.toggle('is-scoped', this.state === 'play' && p.alive && p.scopeView); // sniper scope overlay
    hud.el.classList.toggle('is-spectating', !!watching);
    const pool = watching ? this._spectatePool() : [];
    const idx = watching ? pool.indexOf(watching) : -1;
    hud.setSpectating(
      watching
        ? {
            name: watching.name || 'Player',
            index: idx >= 0 ? idx + 1 : 1,
            total: Math.max(1, pool.length),
            kills: watching.kills | 0,
            teammate: this.teamMode && sameTeam(watching, p),
          }
        : null,
    );
    const netAlive = this.net && this.net.aliveCount;
    let teamElims = null;
    if (this.teamMode) {
      teamElims = p.kills | 0;
      for (const m of this.mates || []) teamElims += m.kills | 0;
    }
    hud.setCounts({ alive: netAlive != null ? netAlive : this.combat.aliveCount, eliminations: p.kills, teams: this.teamMode ? this.combat.aliveTeams : null, teamEliminations: teamElims });
    if (this.teamMode) this._updateTeamHud(dt);
    const heading = watching ? watching.heading || 0 : p.heading;
    hud.setCompass(((heading * 180) / Math.PI + 360) % 360);
    const s = this.storm;
    if (!this.freeBuild) {
      // also during the drop: the storm is frozen at phase 1's full wait there, and without
      // this the panel kept its initial 0:00
      const hs = s.hudState(p.pos.x, p.pos.z);
      if (this.state === 'drop') hs.outside = false; // no storm vignette over the drop map
      hud.setStorm(hs);
    }

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
    const fullOpen = (this.state === 'drop' || this.state === 'play') && !!this.fullMapOpen;
    if (this.state === 'play' || this.state === 'drop') hud.showFullMap(fullOpen);
    // markers / pings on screen, and the team breakdown beside the full map
    if (this.pings) {
      const cam = this.camera;
      const W = window.innerWidth;
      const H = window.innerHeight;
      this.pings.update(
        dt,
        (v) => {
          _v2.set(v.x, v.y, v.z).project(cam);
          if (_v2.z > 1) return null;
          return { x: (_v2.x * 0.5 + 0.5) * W, y: (-_v2.y * 0.5 + 0.5) * H };
        },
        { x: p.pos.x, z: p.pos.z, heading: p.heading },
        W,
        H
      );
    }
    if (fullOpen && hud.setMapStats) {
      const rows = [p, ...(this.teamMode ? this.mates || [] : [])].map((a) => ({
        name: a === p ? p.name || 'You' : a.name,
        you: a === p,
        color: TEAM_CSS[this._slotOf(a)],
        kills: a.kills | 0,
        assists: a.assists | 0,
        damage: a.damageDealt || 0,
        state: !a.alive ? 'out' : a.downed ? 'down' : 'alive',
      }));
      hud.setMapStats(rows);
    }
    // no loot clutter: only chests you could hear (close by), then teammates, markers, pings
    const blips = this._blips || (this._blips = []);
    blips.length = 0;
    if (this.loot) {
      for (const b of this.loot.blips()) {
        if (b.kind !== 'chest') continue;
        if ((b.x - p.pos.x) ** 2 + (b.z - p.pos.z) ** 2 < 55 * 55) blips.push(b);
      }
    }
    if (this.pings) this.pings.blips(blips);
    // Catfish Ken's reboot vans (team modes), and our team's reboot cards on the ground
    // (vans: every mode, from the bus on, so drops can be planned around them; cards: team modes)
    if (this.reboot && (this.state === 'play' || this.state === 'drop')) {
      for (const v of this.reboot.vans) blips.push({ x: v.x, z: v.z, kind: this.reboot.vanReady(v) ? 'van' : 'vanCd' });
      if (this.teamMode) for (const c of this.reboot.cards.values()) if (c.holder == null && c.team === p.team) blips.push({ x: c.x, z: c.z, kind: 'card' });
    }
    if (this.teamMode && this.mates && this.mates.length && this.state === 'play') {
      for (const m of this.mates) {
        if (!m.alive || m.inBus) continue;
        blips.push({ x: m.pos.x, z: m.pos.z, kind: m.downed ? 'mateDown' : 'mate' + Math.min(3, m.teamSlot || 0) });
      }
    }
    this.minimap.update({
      player: { x: p.pos.x, z: p.pos.z, heading: p.heading },
      // dormant opening storm / free build: no next ring or guide line (nextR < 0 hides them)
      storm: s.dormant || this.freeBuild ? { cx: s.cx, cz: s.cz, r: s.r, nextCx: s.cx, nextCz: s.cz, nextR: -1 } : this.state === 'drop' ? { cx: s.cx, cz: s.cz, r: s.r, nextCx: s.nextCx, nextCz: s.nextCz, nextR: s.nextR } : s,
      fullOpen,
      marker: null,
      // the Drop Bus flight line and the bus itself, while anyone can still ride it
      route: this.state === 'drop' && this.busRoute ? this.busRoute : null,
      bus: this.state === 'drop' && this.busRoute ? { x: p.pos.x, z: p.pos.z, heading: this.busRoute.heading } : null,
      blips,
    });
  }

  /** Team modes: teammate panel, name tags over heads, knocked overlay, revive ring. */
  _updateTeamHud(dt) {
    const hud = this.hud;
    const p = this.player;
    const client = !!(this.net && this.net.isClient);
    // being revived: the host / solo knows the timer; a client counts while the snapshot says so
    if (client) p.reviveT = p.alive && p.downed && p.beingRevived ? (p.reviveT || 0) + dt : 0;
    for (const m of this.mates) if (m.isPuppet) m.reviveT = m.alive && m.downed && m.beingRevived ? (m.reviveT || 0) + dt : 0;

    const rows = this.mates.map((m) => ({
      id: m.id,
      name: m.name,
      color: TEAM_CSS[Math.min(3, m.teamSlot || 0)],
      health: m.health,
      shield: m.shield,
      alive: m.alive,
      downed: !!m.downed,
      down01: m.downed ? clamp((m.downHp || 0) / KNOCK.downHp, 0, 1) : 0,
      revive01: m.downed && m.reviveT > 0 ? clamp(m.reviveT / KNOCK.reviveTime, 0, 1) : 0,
    }));
    hud.setTeam({ rows, selfColor: TEAM_CSS[Math.min(3, p.teamSlot || 0)], noun: TEAM_NOUN[this.mode] });

    // name tags (screen space, visible through walls)
    const tags = [];
    if (this.state === 'play' || this.state === 'over') {
      for (const m of this.mates) {
        if (!m.alive || m.inBus) continue;
        const sc = this.project(_v.set(m.pos.x, m.pos.y + (m.downed ? 1.0 : 2.15), m.pos.z));
        if (!sc) continue;
        const d = Math.hypot(m.pos.x - this.camera.position.x, m.pos.z - this.camera.position.z);
        tags.push({ id: m.id, x: sc.x, y: sc.y, name: m.name, color: TEAM_CSS[Math.min(3, m.teamSlot || 0)], downed: !!m.downed, dist: Math.round(d) });
      }
    }
    hud.setTags(tags);

    // knocked overlay
    if (p.alive && p.downed) {
      hud.setDowned({ down01: clamp((p.downHp || 0) / KNOCK.downHp, 0, 1), revive01: p.reviveT > 0 ? clamp(p.reviveT / KNOCK.reviveTime, 0, 1) : 0, by: p.reviver ? p.reviver.name : null });
    } else hud.setDowned(null);
    if (!p.alive) hud.setRevive(null);
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
    // settings screen extras: channel volumes, key bindings (+ HUD keycaps)
    if (sfx.setSfxVolume) sfx.setSfxVolume(this.settings.sfxVolume ?? 1);
    if (sfx.setUiVolume) sfx.setUiVolume(this.settings.uiVolume ?? 1);
    if (this.settings.musicVolume != null) sfx.setMusicVolume(this.settings.musicVolume);
    if (typeof document !== 'undefined') createFpsMeter(document.body).setVisible(!!this.settings.showFps); // shared with the settings screen
    if (this.input) this.input.setBindings(this.settings.bindings);
    if (this.hud && this.hud.setKeyLabels && this.input) this.hud.setKeyLabels((a) => this.input.label(a));
    if (this.hud && this.hud.setCrosshairStyle) this.hud.setCrosshairStyle(this.settings);
    if (this.invPanel && this.input) this.invPanel.setKeyLabels((a) => this.input.label(a));
    const qKey = graphicsQuality(this.settings);
    this._applyPixelRatio();
    if (this.atmosphere && this.atmosphere.quality !== qKey) this.atmosphere.setQuality(qKey);
    if (this.fx && this.fx.quality !== qKey) this.fx.setQuality(qKey);
    if (this.loot && this.loot.setQuality) this.loot.setQuality(qKey);
    if (this.bots && this.bots.setQuality) this.bots.setQuality(qKey);
    this._cullT = 0;
  }

  _applyPixelRatio() {
    const q = QUALITY[graphicsQuality(this.settings)] || QUALITY.medium;
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
    if (locked) {
      this._wasLocked = true;
      if (this.inventoryOpen) this.closeInventory(false); // something re-grabbed the pointer
      if (this.fullMapOpen) this.toggleFullMap(false);
    } else if (this._wasLocked && (this.state === 'play' || this.state === 'drop') && !this.paused && !this.inventoryOpen && !this.fullMapOpen && !this.chatOpen) this.pause(true);
  }

  /**
   * Global chat box open in a match (src/ui/chat.js): the game lets go of the keyboard and the
   * mouse (no pause menu) until it closes, then grabs the mouse again.
   */
  setChatTyping(on) {
    this.chatOpen = !!on;
    const input = this.input;
    if (on) {
      input.keys.clear();
      input.pressed.clear();
      input.enabled = false;
      input.unlock();
    } else {
      input.enabled = true;
      if ((this.state === 'play' || this.state === 'drop') && !this.paused) input.lock();
    }
  }

  // ---------------------------------------------------------------- inventory screen

  _canOpenInventory() {
    const p = this.player;
    return this.state === 'play' && !this.paused && !!p && p.alive && !p.downed && !this._winPending;
  }

  /** Opens the inventory: frees the mouse for drag & drop without opening the pause menu. */
  openInventory() {
    if (this.inventoryOpen || !this._canOpenInventory() || !this.invPanel) return false;
    this.inventoryOpen = true; // set before unlock(): _onLockChange must not pause
    this.fullMapOpen = false;
    this._setFullMapInteractive(false);
    this.input.trap = true;
    this.input.releaseMouse();
    this.input.unlock();
    this.invPanel.show(true);
    this._updateInventoryPanel();
    sfx.play('ui_click');
    return true;
  }

  /** Closes the inventory; `relock` grabs the pointer again (needs the key press's user activation). */
  closeInventory(relock = true) {
    if (!this.inventoryOpen) return;
    this.inventoryOpen = false;
    this.input.trap = false;
    if (this.invPanel) this.invPanel.show(false);
    if (relock && this.state === 'play' && !this.paused) {
      this.input.lock();
      // Esc grants no user activation, so the browser may refuse the lock: say how to get it back
      setTimeout(() => {
        if (!this.input.locked && !this.inventoryOpen && this.state === 'play' && !this.paused && this.hud) this.hud.toast('Click to aim again');
      }, 400);
    }
  }

  /** Inventory keys, run before the pause / map / gameplay handling of this frame. */
  _inventoryInput(input) {
    const invCode = input.bindings.inventory;
    if (!this.inventoryOpen) {
      if (input.actionHit('inventory') && this._canOpenInventory()) {
        this.openInventory();
        input.consume(invCode);
      }
      return;
    }
    if (!this._canOpenInventory()) {
      this.closeInventory(false);
      return;
    }
    if (input.hit('Escape') || input.actionHit('inventory')) {
      // Escape closes the inventory, not the game: swallow it so the pause check below skips it
      input.consume('Escape');
      input.consume(invCode);
      this.closeInventory(true);
      return;
    }
    // hover a card + press a slot key: move the hovered item to that slot
    const hov = this.invPanel.hovered();
    if (hov >= 0) {
      for (let i = 0; i < 5; i++) {
        if (input.actionHit('slot' + (i + 1))) {
          input.consume(input.bindings['slot' + (i + 1)]); // the player must not also select it
          if (i !== hov) this.swapSlots(hov, i, [this.invPanel.shownItem(hov), this.invPanel.shownItem(i)]);
        }
      }
    }
  }

  /**
   * Swaps hotbar slots a and b (inventory screen). Refused while reloading or using a
   * consumable (both track the item/slot in flight). Multiplayer clients apply it locally
   * and send it to the host, which owns the inventory and syncs it back.
   * `expect` ([item at a, item at b], raw slot objects as the panel showed them) refuses a
   * stale swap: if a host sync replaced the slots since, the player was looking at old items.
   */
  swapSlots(a, b, expect) {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'play') return false;
    if (p.reloadT > 0 || p.useT > 0) return false;
    if (expect && (p.inventory.slots[a] !== (expect[0] || null) || p.inventory.slots[b] !== (expect[1] || null))) {
      this._updateInventoryPanel();
      return false;
    }
    if (!p.inventory.swap(a, b)) return false;
    if (this.combat) this.combat.cancelBurst(p);
    if (this.net && this.net.isClient && this.net.sendSwap) this.net.sendSwap(a, b);
    sfx.play('ui_click');
    this._updateInventoryPanel();
    return true;
  }

  /**
   * Dragging a card / ammo row / material row out of the inventory screen drops it in
   * front of the player. Solo / host drop it straight onto the ground; a client removes it
   * locally and asks the host ('dp'), which drops it and syncs the inventory back.
   */
  dropFromInventory(what, expect) {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'play' || p.inBus || p.airborneDrop) return false;
    if (p.reloadT > 0 || p.useT > 0) return false;
    if (what && Number.isInteger(what.s) && expect !== undefined && expect !== null && p.inventory.slots[what.s] !== expect) {
      this._updateInventoryPanel();
      return false;
    }
    const item = p.inventory.takeOut(what);
    if (!item) return false;
    if (this.combat) this.combat.cancelBurst(p);
    // walk-over pickup must not grab it straight back: off near here until the player walks away
    p.dropZone = { x: p.pos.x, z: p.pos.z };
    if (this.net && this.net.isClient) {
      if (this.net.action) this.net.action({ k: 'dp', ...what }, true);
    } else if (this.loot) {
      const at = p.pos.clone();
      const d = p.aimDir;
      const len = Math.hypot(d.x, d.z) || 1;
      at.x += (d.x / len) * 1.2;
      at.z += (d.z / len) * 1.2;
      this.loot.drop(item, at);
    }
    sfx.play('ui_click');
    this._updateInventoryPanel();
    return true;
  }

  /** Clicking a card equips that slot (like pressing its slot key). */
  _selectSlot(i) {
    const p = this.player;
    if (!p || !p.alive || this.state !== 'play') return;
    p.buildPiece = null;
    p.inventory.select(i);
    this._updateInventoryPanel();
  }

  _updateInventoryPanel() {
    if (!this.inventoryOpen || !this.invPanel) return;
    const p = this.player;
    const inv = p.inventory;
    this.invPanel.update({
      slots: inv.hotbar(),
      items: inv.slots,
      selected: p.buildPiece ? -1 : inv.selected,
      ammo: inv.ammo,
      mats: inv.mats,
      lockedReason: p.reloadT > 0 ? 'Reloading: can\'t reorder' : p.useT > 0 ? 'Healing: can\'t reorder' : null,
    });
  }

  /** Opens / closes the full map. Open, the pointer is free so you can click to place markers. */
  toggleFullMap(on) {
    on = !!on;
    if (on === !!this.fullMapOpen) return;
    this.fullMapOpen = on;
    if (on) {
      this.closeInventory(false);
      this.input.trap = true; // held mouse buttons drop: no firing while the map is up
      this.input.releaseMouse();
      this.input.unlock();
      this._setFullMapInteractive(true);
    } else {
      this.input.trap = false;
      this._setFullMapInteractive(false);
      if ((this.state === 'play' || this.state === 'drop') && !this.paused) this.input.lock();
    }
  }

  /** Your team colour slot (0..3). */
  _slotOf(a) {
    return Math.min(3, (a && a.teamSlot) || 0);
  }

  /** Places (at {x, z}) or removes (null) your map marker, and tells your team. */
  placeMarker(at) {
    const p = this.player;
    if (at) {
      const y = this.world.groundHeight(at.x, at.z, 1e4);
      this.pings.set({ owner: p.id, slot: this._slotOf(p), type: 'm', kind: 'loc', x: at.x, y, z: at.z, label: 'Marker' });
      sfx.play('ui_click');
    } else this.pings.clear(p.id, 'm');
    this._sendPing(at ? { t: 'm', x: at.x, y: this.world.groundHeight(at.x, at.z, 1e4), z: at.z, kind: 'loc' } : { t: 'm', clear: 1 });
  }

  /** Ping whatever the crosshair is on: an enemy, a piece of loot, or a spot. */
  pingAim() {
    const p = this.player;
    if (!p.alive || !p.aimDir) return;
    const o = p.aimOrigin;
    const d = p.aimDir;
    const RANGE = 400;
    const hit = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, RANGE, null);
    let tWorld = hit ? hit.t : RANGE;
    let enemy = null;
    for (const a of this.combat.actors) {
      if (a === p || !a.alive || a.inBus || sameTeam(a, p)) continue;
      const t = rayActor(o.x, o.y, o.z, d.x, d.y, d.z, a, tWorld + 0.5);
      if (t < tWorld + 0.5) {
        tWorld = t;
        enemy = a;
      }
    }
    if (!enemy && !hit) return; // the sky
    const x = enemy ? enemy.pos.x : o.x + d.x * tWorld;
    const y = enemy ? enemy.pos.y : o.y + d.y * tWorld;
    const z = enemy ? enemy.pos.z : o.z + d.z * tWorld;
    let kind = enemy ? 'enemy' : 'loc';
    let label = enemy ? 'Enemy' : this._placeName(x, z);
    if (!enemy && this.loot) {
      // loot within 2.5 m of the spot: ping the item itself
      let best = null;
      let bd = 2.5 * 2.5;
      for (const r of this.loot.records) {
        if (r.kind === 'item' ? false : r.opened) continue;
        const dd = (r.x - x) ** 2 + (r.z - z) ** 2;
        if (dd < bd && Math.abs(r.y - y) < 2.5) {
          bd = dd;
          best = r;
        }
      }
      if (best) {
        kind = 'item';
        label = best.kind === 'chest' ? 'Chest' : best.kind === 'ammoBox' ? 'Ammo Box' : itemLabel(best.item);
      }
    }
    this.pings.set({ owner: p.id, slot: this._slotOf(p), type: 'p', kind, x, y, z, label, target: enemy });
    sfx.play('ui_click', { volume: 0.8 });
    this._sendPing({ t: 'p', kind, x, y, z, label, tg: enemy ? enemy.id : -1 });
  }

  /** "Bentonville Square" for a spot near a named place, else "Here". */
  _placeName(x, z) {
    let best = null;
    let bd = Infinity;
    for (const k in this.world.landmarks || {}) {
      const l = this.world.landmarks[k];
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best && bd < 160 && best.n ? best.n : 'Here';
  }

  /** Multiplayer: markers / pings go to the host, which relays them to everyone (teammates show them). */
  _sendPing(m) {
    const net = this.net;
    if (!net) return;
    const r = (v) => Math.round(v * 10) / 10;
    const msg = { k: 'pg', t: m.t, clear: m.clear ? 1 : 0, x: r(m.x || 0), y: r(m.y || 0), z: r(m.z || 0), kind: m.kind || 'loc', label: String(m.label || '').slice(0, 40), tg: m.tg ?? -1 };
    if (net.isClient) net.action(msg);
    else if (net.isHost && net.started && net.events) net.events.push({ e: 'pg', a: this.player.id, ...msg, k: undefined });
  }

  /** A teammate's marker / ping arrived (from the net). */
  netPing(owner, m) {
    if (!owner || owner === this.player || !sameTeam(owner, this.player)) return;
    const t = m.t === 'm' ? 'm' : 'p';
    if (m.clear) return this.pings.clear(owner.id, t);
    const target = m.tg >= 0 && this.net && this.net.actorById ? this.net.actorById(m.tg) : m.tg >= 0 ? this.combat.actors.find((a) => a.id === m.tg) : null;
    this.pings.set({ owner: owner.id, slot: this._slotOf(owner), type: t, kind: ['loc', 'enemy', 'item'].includes(m.kind) ? m.kind : 'loc', x: +m.x, y: +m.y, z: +m.z, label: (t === 'p' ? owner.name + ': ' : '') + String(m.label || (t === 'm' ? owner.name : '')), target });
    if (t === 'p') sfx.play('ui_click', { volume: 0.6 });
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
      /** Jump from the Drop Bus now (optionally at x,z instead of the bus's position). */
      drop(x, z) {
        if (game.state !== 'drop') return false;
        return game.jump(true, x != null && z != null ? { x, z } : null);
      },
      /** Instantly land the player at (x, z) (or the drop marker). */
      teleport(x, z, y) {
        const p = game.player;
        if (game.state === 'drop') game.jump(true);
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
        if (game.state === 'drop') return game.jump(true);
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
      /** Why a piece would / would not place right now (QA): the plan plus each rule. */
      plan(kind = 'wall') {
        const p = game.player;
        const st = game.structures;
        const w = game.world;
        if (!st) return null;
        const pl = st.plan(kind, p.pos, p.heading, p.pitch);
        return {
          pl: { ...pl },
          slotTaken: !!st.at(pl),
          fits: st.fits(pl),
          supported: st.supported(pl),
          feet: +p.pos.y.toFixed(2),
          terrainFeet: +w.terrainHeight(p.pos.x, p.pos.z).toFixed(2),
          terrainTarget: +w.terrainHeight(pl.x, pl.z).toFixed(2),
          surface: p.surface,
        };
      },
      /** Edit the last piece the player placed (tile mask, or a ramp's quarter turn). */
      edit(mask = 0) {
        const st = game.structures;
        const mine = st ? st.pieces.filter((q) => q.owner === game.player) : [];
        const piece = mine[mine.length - 1];
        if (!piece) return null;
        const changed = st.edit(piece, mask);
        return { changed, key: piece.kind + ':' + piece.key, edit: st.editValue(piece), tris: piece.tris.length / 9, segs: piece.segs ? piece.segs.length : 0, doors: piece.doors ? piece.doors.slice() : null };
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
      /** Interior plan of building `id` (map OSM id), or null. */
      interior(id) {
        const c = game.world.buildingById(id);
        return c ? c.shell.plan : null;
      },
      /** Teleport into room i on `level` of building `id` (the room's centre point). */
      tpRoom(id, level = 0, i = 0) {
        const plan = debug.interior(id);
        const L = plan && plan.levels[level];
        const r = L && L.rooms[i];
        if (!r) return null;
        return { room: r.label || r.kind, ...debug.teleport(r.cx, r.cz, L.y) };
      },
      /** Break panel `idx` of building `id` (World.breakPanel; the mesh hides via onPanelChange). */
      breakPanel(id, idx) {
        return game.world.breakPanel(id, idx);
      },
      restorePanels() {
        return game.world.restoreAllPanels();
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
        p.updateCamera(game.camera, 1, game.world, game.settings.fov || CAMERA.fov);
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
      /** Team modes: mode, our team, teammates and team counts. */
      team() {
        const p = game.player;
        return {
          mode: game.mode,
          teamMode: !!game.teamMode,
          team: p.team,
          downed: !!p.downed,
          downHp: p.downHp,
          totalTeams: game.totalTeams,
          aliveTeams: game.combat.aliveTeams,
          mates: (game.mates || []).map((m) => ({ id: m.id, name: m.name, alive: m.alive, downed: !!m.downed, downHp: m.downHp, state: m.botState || null, d: Math.round(m.pos.distanceTo(p.pos)), reviving: m.revivingTarget ? m.revivingTarget.id : null })),
        };
      },
      /** QA: knock actor `id` (lethal damage from an enemy-less source); the player by default. */
      knock(id = null) {
        const a = id == null ? game.player : game.combat.actors.find((x) => x.id === id);
        if (!a || !a.alive) return null;
        game.combat.applyDamage(a, a.health + a.shield + 1, { source: null });
        return { alive: a.alive, downed: !!a.downed };
      },
      /** QA: put teammate `i` (default the first alive) next to the player. */
      bringMate(i = 0) {
        const m = (game.mates || []).filter((x) => x.alive)[i];
        if (!m) return null;
        const p = game.player;
        m.pos.set(p.pos.x + 1.4, p.pos.y, p.pos.z);
        if (m.vel) m.vel.set(0, 0, 0);
        return { id: m.id, x: m.pos.x, z: m.pos.z };
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
          return game.structures ? game.structures.pieces.map((p) => ({ key: p.key, kind: p.kind, mat: p.mat, hp: Math.round(p.hp), edit: p.edit | 0, doors: p.doors ? p.doors.join(',') : '' })) : [];
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
      /** Dev builds only: the Game itself (QA scripts probe mantling, carrying, emotes). */
      get raw() {
        return import.meta.env && import.meta.env.DEV ? game : null;
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
          editing: p.editing ? p.editing.piece.kind : null,
        };
      },
      get bots() {
        return game.bots ? game.bots.list.map((b) => ({ id: b.id, name: b.name, team: b.team, alive: b.alive, downed: !!b.downed, x: b.pos.x, y: b.pos.y, z: b.pos.z, health: b.health })) : [];
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

/** Shared by respawnActor / netRespawn: alive and standing at (x, y, z) with REBOOT.loadout. */
function reviveFields(a, x, y, z, heading) {
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
  a.mode = 'ground';
  a.inBus = false;
  a.gliding = false;
  a.grounded = true;
  a.pos.set(x, y, z);
  if (a.vel) a.vel.set(0, 0, 0);
  a.heading = heading;
  if (a.inventory && a.inventory.reset) a.inventory.reset(rebootLoadout());
  if (a.character) {
    a.character.reset();
    a.character.root.visible = true;
    a.character.root.position.copy(a.pos);
  }
}

/** A fresh copy of REBOOT.loadout (inventories keep the item objects they are given). */
function rebootLoadout() {
  const L = REBOOT.loadout;
  return { items: L.items.map((it) => ({ ...it })), ammo: { ...L.ammo }, mats: { ...L.mats }, selected: L.selected };
}

const NO_INPUT = {
  dx: 0,
  dy: 0,
  wheel: 0,
  buttons: [false, false, false],
  clicked: [false, false, false],
  down: () => false,
  hit: () => false,
  action: () => false,
  actionHit: () => false,
  label: () => '',
};

/**
 * Team modes: one landing spot per bot team (consecutive bots sharing a team id), repeated for
 * each member, so a bot team drops and lands together.
 */
function teamDropPoints(route, world, rng, teams) {
  const groups = [];
  for (let i = 0; i < teams.length; i++) if (i === 0 || teams[i] !== teams[i - 1]) groups.push(i);
  const spots = planBotTargets(route, world, rng, groups.length);
  const out = [];
  let g = -1;
  for (let i = 0; i < teams.length; i++) {
    if (i === 0 || teams[i] !== teams[i - 1]) g++;
    out.push(spots[g]);
  }
  return out;
}

/** `n` unique bot names: BOT_NAMES shuffled, then numbered repeats once they run out. */
function botNames(n, rng) {
  const base = shuffle(BOT_NAMES.slice(), rng);
  const out = [];
  for (let i = 0; i < n; i++) {
    const round = Math.floor(i / base.length);
    out.push(round === 0 ? base[i] : base[i % base.length] + (round + 1));
  }
  return out;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

void damp;
