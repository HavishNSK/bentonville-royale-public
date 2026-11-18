// BENTONVILLE ROYALE — tunables shared by every game system.
//
// World conventions (same as the map data): meters, x = east, z = SOUTH
// (north is -z), y up. A `heading` is radians, 0 = facing north, increasing
// clockwise (east = PI/2); forward = (sin h, 0, -cos h).

export const TAU = Math.PI * 2;

export const PLAYER = {
  radius: 0.42,
  height: 1.8,
  eyeHeight: 1.55,
  walkSpeed: 4.6,
  runSpeed: 6.6,
  sprintSpeed: 8.8,
  accelGround: 60,
  accelAir: 14,
  gravity: 30,
  jumpSpeed: 9.6,
  stepHeight: 0.62,
  maxHealth: 100,
  maxShield: 100,
  glideFallSpeed: 13,
  glideSpeed: 19,
  dropHeight: 320, // Drop Bus altitude: open the glider early to reach ~500 m to either side of the route
  matCap: 999,
};

export const CAMERA = {
  fov: 68,
  near: 0.3,
  far: 3000,
  distance: 4.4,
  shoulder: 0.75,
  pivotHeight: 1.55,
  rise: 0.25,
  minPitch: -1.35,
  maxPitch: 1.25,
};

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const RARITY_COLOR = {
  common: 0x9aa3ad,
  uncommon: 0x4ec04a,
  rare: 0x3b9cff,
  epic: 0xb05cff,
  legendary: 0xffb52e,
};
// Legacy flat multiplier, used only for a weapon that has no `rarities` table.
export const RARITY_DAMAGE = { common: 1, uncommon: 1.05, rare: 1.1, epic: 1.16, legendary: 1.22 };

// Ammo pools. Every gun draws from exactly one.
export const AMMO = {
  light: { name: 'Light Rounds', pickup: 30 },
  medium: { name: 'Medium Rounds', pickup: 30 },
  shells: { name: 'Shells', pickup: 8 },
  heavy: { name: 'Heavy Rounds', pickup: 6 },
  // cap: most you can carry (default Inventory AMMO_CAP); weight: share of random ammo drops (default 1)
  rockets: { name: 'Rockets', pickup: 2, cap: 12, weight: 0.12 },
};

// Classic battle-royale roster (generic names). Fields:
//   kind      family for shared behaviour: 'ar' | 'smg' | 'shotgun' | 'sniper' | 'pistol'
//   model     mesh in /assets/weapons (several guns share one); icon = HUD silhouette
//   damage    per pellet / per bullet; shotguns split their damage over `pellets`
//   rate      trigger pulls per second (for burst guns: bursts per second)
//   burst     rounds per trigger pull (default 1); `burstDelay` seconds between them
//   rarities  { rarity: { damage, reload, ...overrides } } — the keys are also the
//             only rarities the gun can drop at. Read stats with weaponStats(id, rarity);
//             the flat top-level damage/reload equal the lowest rarity's (legacy readers).
//   lootWeight relative chance among weapon drops.
//   ballistic { speed m/s, gravity m/s² } = the shot is a projectile with travel time and
//             bullet drop (Combat.tickProjectiles) instead of an instant hitscan ray.
//   scope     true = aiming goes first-person through a scope overlay (scoped snipers);
//             without it aiming is the usual over-the-shoulder zoom (e.g. Hunting Rifle).
// spread values are half-angles in radians. `bloom` is added per shot and
// decays; moving/jumping multiplies the total. `mag` is the same at every rarity.
export const WEAPONS = {
  rifle: {
    id: 'rifle', name: 'Assault Rifle', kind: 'ar', icon: 'rifle', model: 'rifle', sound: 'shot_rifle', ammo: 'medium',
    headMult: 1.5, rate: 5.5, auto: true, mag: 30,
    spread: 0.006, bloom: 0.0045, maxBloom: 0.03, pellets: 1, range: 280, falloffStart: 60, falloffEnd: 160, minFalloff: 0.65,
    zoom: 0.72, twoHanded: true, botRange: 75, tracer: 0xfff0b0, lootWeight: 22,
    rarities: {
      common: { damage: 30, reload: 2.7 },
      uncommon: { damage: 31, reload: 2.6 },
      rare: { damage: 33, reload: 2.5 },
      epic: { damage: 35, reload: 2.4 },
      legendary: { damage: 36, reload: 2.3 },
    },
  },
  smg: {
    id: 'smg', name: 'SMG', kind: 'smg', icon: 'smg', model: 'smg', sound: 'shot_smg', ammo: 'light',
    headMult: 1.75, rate: 12, auto: true, mag: 30,
    spread: 0.013, bloom: 0.004, maxBloom: 0.042, pellets: 1, range: 180, falloffStart: 22, falloffEnd: 65, minFalloff: 0.5,
    zoom: 0.8, twoHanded: true, botRange: 32, tracer: 0xffe9a0, lootWeight: 13,
    rarities: {
      common: { damage: 16, reload: 2.2 },
      uncommon: { damage: 17, reload: 2.1 },
      rare: { damage: 18, reload: 2.0 },
    },
  },
  shotgun: {
    id: 'shotgun', name: 'Pump Shotgun', kind: 'shotgun', pump: true, icon: 'shotgun', model: 'shotgun', sound: 'shot_shotgun', ammo: 'shells',
    headMult: 2, rate: 0.7, auto: false, mag: 5,
    spread: 0.045, bloom: 0, maxBloom: 0, pellets: 10, range: 60, falloffStart: 7, falloffEnd: 28, minFalloff: 0.2,
    zoom: 0.86, twoHanded: true, botRange: 12, tracer: 0xffd890, lootWeight: 13,
    // 10 pellets: 90 / 95 / 100 / 105 for a full body hit
    // shellReload: `reload` is seconds per shell (one shell at a time; firing stops the reload)
    shellReload: true,
    rarities: {
      uncommon: { damage: 9, reload: 0.5 },
      rare: { damage: 9.5, reload: 0.47 },
      epic: { damage: 10, reload: 0.44 },
      legendary: { damage: 10.5, reload: 0.41 },
    },
  },
  sniper: {
    id: 'sniper', name: 'Bolt-Action Sniper Rifle', kind: 'sniper', icon: 'sniper', model: 'sniper', sound: 'shot_sniper', ammo: 'heavy',
    headMult: 2.5, rate: 0.33, auto: false, mag: 1,
    spread: 0.0008, bloom: 0, maxBloom: 0, pellets: 1, range: 600, falloffStart: 600, falloffEnd: 600, minFalloff: 1,
    hipSpread: 0.03, zoom: 0.3, scope: true, twoHanded: true, botRange: 130, tracer: 0xd8f4ff, lootWeight: 5,
    ballistic: { speed: 420, gravity: 8 }, // ~0.23 m drop at 100 m, ~0.9 m at 200 m
    rarities: {
      rare: { damage: 105, reload: 3.0 },
      epic: { damage: 110, reload: 2.85 },
      legendary: { damage: 116, reload: 2.7 },
    },
  },
  pistol: {
    id: 'pistol', name: 'Pistol', kind: 'pistol', icon: 'pistol', model: 'pistol', sound: 'shot_pistol', ammo: 'light',
    headMult: 2, rate: 6.75, auto: false, mag: 16,
    spread: 0.008, bloom: 0.006, maxBloom: 0.035, pellets: 1, range: 200, falloffStart: 30, falloffEnd: 90, minFalloff: 0.55,
    zoom: 0.8, twoHanded: false, botRange: 40, tracer: 0xfff0b0, lootWeight: 14,
    rarities: {
      common: { damage: 23, reload: 1.5 },
      uncommon: { damage: 24, reload: 1.47 },
      rare: { damage: 25, reload: 1.4 },
    },
  },
  burst_rifle: {
    id: 'burst_rifle', name: 'Burst Assault Rifle', kind: 'ar', icon: 'burst_rifle', model: 'rifle', sound: 'shot_rifle', ammo: 'medium',
    headMult: 1.5, rate: 1.6, auto: false, burst: 3, burstDelay: 0.075, mag: 30,
    spread: 0.0045, bloom: 0.0035, maxBloom: 0.025, pellets: 1, range: 280, falloffStart: 60, falloffEnd: 160, minFalloff: 0.65,
    zoom: 0.72, twoHanded: true, botRange: 70, tracer: 0xfff0b0, lootWeight: 12,
    rarities: {
      common: { damage: 27, reload: 2.9 },
      uncommon: { damage: 29, reload: 2.7 },
      rare: { damage: 30, reload: 2.6 },
      epic: { damage: 32, reload: 2.5 },
      legendary: { damage: 33, reload: 2.4 },
    },
  },
  tac_shotgun: {
    id: 'tac_shotgun', name: 'Tactical Shotgun', kind: 'shotgun', icon: 'tac_shotgun', model: 'shotgun', sound: 'shot_shotgun', ammo: 'shells',
    headMult: 2, rate: 1.5, auto: false, mag: 8,
    spread: 0.06, bloom: 0, maxBloom: 0, pellets: 10, range: 55, falloffStart: 6, falloffEnd: 24, minFalloff: 0.2,
    zoom: 0.86, twoHanded: true, botRange: 11, tracer: 0xffd890, lootWeight: 13,
    // 10 pellets: 67 / 71 / 74 / 77 / 81 for a full body hit
    shellReload: true,
    rarities: {
      common: { damage: 6.7, reload: 0.45 },
      uncommon: { damage: 7.1, reload: 0.43 },
      rare: { damage: 7.4, reload: 0.41 },
      epic: { damage: 7.7, reload: 0.39 },
      legendary: { damage: 8.1, reload: 0.37 },
    },
  },
  heavy_shotgun: {
    id: 'heavy_shotgun', name: 'Heavy Shotgun', kind: 'shotgun', pump: true, icon: 'heavy_shotgun', model: 'shotgun', sound: 'shot_shotgun', ammo: 'shells',
    headMult: 2.25, rate: 1.0, auto: false, mag: 7,
    spread: 0.035, bloom: 0, maxBloom: 0, pellets: 10, range: 65, falloffStart: 9, falloffEnd: 32, minFalloff: 0.25,
    zoom: 0.86, twoHanded: true, botRange: 13, tracer: 0xffd890, lootWeight: 3,
    // 10 pellets: 73 / 77 for a full body hit
    shellReload: true,
    rarities: {
      epic: { damage: 7.3, reload: 0.55 },
      legendary: { damage: 7.7, reload: 0.5 },
    },
  },
  suppressed_smg: {
    id: 'suppressed_smg', name: 'Suppressed SMG', kind: 'smg', icon: 'suppressed_smg', model: 'smg', sound: 'shot_smg', soundVolume: 0.45, ammo: 'light',
    headMult: 1.75, rate: 10, auto: true, mag: 30,
    spread: 0.01, bloom: 0.0035, maxBloom: 0.035, pellets: 1, range: 180, falloffStart: 25, falloffEnd: 70, minFalloff: 0.5,
    zoom: 0.8, twoHanded: true, botRange: 34, tracer: 0xe8f0ff, lootWeight: 6,
    rarities: {
      epic: { damage: 20, reload: 2.1 },
      legendary: { damage: 21, reload: 2.0 },
    },
  },
  hunting_rifle: {
    id: 'hunting_rifle', name: 'Hunting Rifle', kind: 'sniper', icon: 'hunting_rifle', model: 'sniper', sound: 'shot_sniper', ammo: 'heavy',
    headMult: 2.5, rate: 0.8, auto: false, mag: 1,
    spread: 0.0015, bloom: 0, maxBloom: 0, pellets: 1, range: 450, falloffStart: 450, falloffEnd: 450, minFalloff: 1,
    hipSpread: 0.02, zoom: 0.55, twoHanded: true, botRange: 110, tracer: 0xd8f4ff, lootWeight: 2.5,
    ballistic: { speed: 340, gravity: 8 }, // ~0.35 m drop at 100 m, ~1.4 m at 200 m
    rarities: {
      uncommon: { damage: 86, reload: 1.9 },
      rare: { damage: 90, reload: 1.8 },
    },
  },
};
// Fires a rocket (game/Grenades.js) instead of a hitscan shot: `damage` is a clean hit, the
// blast around it is ROCKET below.
WEAPONS.rocket_launcher = {
  id: 'rocket_launcher', name: 'Rocket Launcher', kind: 'launcher', projectile: 'rocket', icon: 'rocket_launcher', model: 'rocket_launcher', sound: 'rocket_launch', ammo: 'rockets',
  headMult: 1, rate: 0.75, auto: false, mag: 1,
  spread: 0, bloom: 0, maxBloom: 0, pellets: 1, range: 300, falloffStart: 300, falloffEnd: 300, minFalloff: 1,
  zoom: 0.85, twoHanded: true, botRange: 30, tracer: 0xffb070, lootWeight: 2,
  rarities: {
    rare: { damage: 100, reload: 2.8 },
    epic: { damage: 100, reload: 2.66 },
    legendary: { damage: 100, reload: 2.52 },
  },
};

// Top-level damage/reload mirror the lowest rarity so code that reads WEAPONS[id]
// directly still gets sane numbers.
for (const id in WEAPONS) {
  const w = WEAPONS[id];
  const low = RARITIES.find((r) => w.rarities && w.rarities[r]);
  if (low) Object.assign(w, { damage: w.rarities[low].damage, reload: w.rarities[low].reload });
}
export const WEAPON_IDS = Object.keys(WEAPONS);

/** Rarities `id` can drop at, lowest first (all five for a gun without a table). */
export function weaponRarities(id) {
  const w = WEAPONS[id];
  if (!w) return [];
  return w.rarities ? RARITIES.filter((r) => w.rarities[r]) : RARITIES.slice();
}

/** Nearest rarity `id` actually comes in (ties round down). */
export function clampWeaponRarity(id, rarity) {
  const allowed = weaponRarities(id);
  if (!allowed.length || allowed.includes(rarity)) return allowed.length ? rarity : 'common';
  const want = Math.max(0, RARITIES.indexOf(rarity));
  let best = allowed[0];
  for (const r of allowed) if (Math.abs(RARITIES.indexOf(r) - want) < Math.abs(RARITIES.indexOf(best) - want)) best = r;
  return best;
}

const _statCache = new Map();
/**
 * Effective stats for a gun at a rarity: the base def with that rarity's overrides
 * (damage, reload, ...) applied. Unknown rarities snap to the nearest available one.
 * Returns a cached, shared object — do not mutate it. Unknown id -> null.
 */
export function weaponStats(id, rarity) {
  const w = WEAPONS[id];
  if (!w) return null;
  const key = id + '|' + rarity;
  let s = _statCache.get(key);
  if (!s) {
    const r = clampWeaponRarity(id, rarity);
    s = w.rarities ? { ...w, ...w.rarities[r], rarity: r } : { ...w, damage: w.damage * (RARITY_DAMAGE[r] || 1), rarity: r };
    _statCache.set(key, s);
  }
  return s;
}

/** Shortest legal gap between two shots (burst guns: between rounds of a burst). */
export function weaponShotInterval(id) {
  const w = WEAPONS[id];
  if (!w) return 0;
  return w.burst > 1 ? Math.min(w.burstDelay || 0.08, 1 / w.rate) : 1 / w.rate;
}

export const CONSUMABLES = {
  medkit: { id: 'medkit', name: 'Med Kit', icon: 'medkit', model: 'medkit', rarity: 'uncommon', useTime: 3.2, heal: 60, shield: 0, stack: 3, sound: 'heal' },
  tonic: { id: 'tonic', name: 'Shield Tonic', icon: 'potion', model: 'potion', rarity: 'rare', useTime: 2.4, heal: 0, shield: 50, stack: 3, sound: 'drink_shield' },
  // throwable: fire throws one instead of channelling a heal (see GRENADE and game/Grenades.js)
  grenade: { id: 'grenade', name: 'Grenade', icon: 'grenade', model: 'grenade', rarity: 'common', throwable: true, useTime: 0, heal: 0, shield: 0, stack: 6, pickup: 3, sound: null },
  smoke: { id: 'smoke', name: 'Smoke Grenade', icon: 'smoke', model: 'smoke', rarity: 'uncommon', throwable: true, useTime: 0, heal: 0, shield: 0, stack: 4, pickup: 2, sound: null },
};

// Smoke grenades (game/Grenades.js): same throw as a frag, then a cloud instead of a blast.
export const SMOKE = {
  radius: 12, // m, horizontal (~3x the original area)
  height: 6.5, // m, above the canister
  duration: 12, // s
  opacity: 1, // opaque — looking at it must not show the world or ink outlines through it
  fogBoost: 0, // never crank scene FogExp2; that washed the view to white
};

// Grenades (game/Grenades.js): thrown along the aim ray in an arc, bounce off the world,
// and explode when the fuse (started at the throw) runs out.
export const GRENADE = {
  damage: 75, // flat, to every character within `radius` that the blast can see (the thrower too)
  radius: 5.5, // m
  structureDamage: 600, // one blast breaks a build, a wall panel, a tree or a prop in range
  roofDamageMult: 3, // museum roof tiles take 3x structureDamage...
  roofRadiusMult: 1.6, // ...out to 1.6x the radius (one grenade opens a ~9 m hole)
  fuse: 2.2, // s
  speed: 20, // m/s along the aim direction
  lift: 4, // m/s added straight up
  gravity: 22,
  bounce: 0.36, // speed kept along the surface normal
  friction: 0.6, // speed kept along the surface per bounce
  size: 0.13, // collision radius (m)
  cooldown: 0.75, // s between throws
};

// Rockets fly straight at whatever the crosshair is on and explode on the first thing they
// touch. A clean hit (the body it struck, or anyone within `cleanRadius`) takes the
// launcher's full damage; the blast fades to `minDamage` at `radius`. It hurts the shooter too.
export const ROCKET = {
  speed: 26, // m/s: slow enough to see coming and dodge
  life: 6, // s before it goes off on its own
  radius: 4.5, // m
  cleanRadius: 1.3, // m
  minDamage: 40,
  structureDamage: 600, // one blast breaks a build, a wall panel, a tree or a prop in range
  roofDamageMult: 3, // museum roof tiles: 3x structureDamage out to 1.8x the radius
  roofRadiusMult: 1.8,
  size: 0.15, // collision radius (m)
};

export const PICKAXE = {
  damage: 20, // to characters
  rate: 1.9, // swings per second
  range: 3.1,
  harvest: 50, // damage to harvestables per swing
  yield: { wood: 20, brick: 20, metal: 20 }, // mats granted per harvesting swing (trees, rocks, cars)
};

// Breakable building wall panels (see World.breakPanel / Interiors.js): outer walls use the
// building's material, interior partitions are wood. Panels are at most panelW m wide and one
// storey tall; bullets do bulletMult of their damage to a panel (and grant no mats).
// floorHp: each breakable floor / ceiling tile between storeys (interiors/floorTiles.js).
export const BUILDING_WALL = { hp: { wood: 300, brick: 450, metal: 600 }, innerHp: 150, floorHp: 200, panelW: 4, bulletMult: 0.5 };

export const MATERIALS = ['wood', 'brick', 'metal'];
export const MATERIAL_COLOR = { wood: 0xb9803f, brick: 0xb5533c, metal: 0x8d99a6 };

// Player-built pieces.
export const BUILD = {
  cell: 4,
  level: 3,
  cost: 5, // mats per piece (was 10: building should be quick and cheap)
  hp: { wood: 150, brick: 260, metal: 380 },
  pieces: ['wall', 'floor', 'ramp', 'cone'],
  maxPieces: 900,
};

// The storm: `wait` seconds holding, then `shrink` seconds closing to `radius`.
// openStart: the match opens with a dormant storm covering the map (capped at openMaxRadius; no damage,
// no circle drawn) for phase 1's `wait`; phase 1's shrink then closes in from there.
export const STORM = {
  startRadius: 400, // phase 1's target circle is picked inside this (clamped to the map)
  openStart: true,
  openMargin: 60, // metres beyond the farthest map corner for the dormant circle
  openMaxRadius: 2500, // ...but never larger than this (safety cap; the tile-pack map needs ~1.3 km)
  phases: [
    // Paced for the ~0.9 x 0.95 km tile-pack map (neighbouring POIs ~30-45 s apart on foot):
    // the storm clock starts when you leave the bus, so phase 1 gives ~2.5 min of looting
    // before its circle (320 m) is set; a whole match is ~10 min of storm plus the ~25 s bus.
    { wait: 85, shrink: 80, radius: 320, dps: 1 },
    { wait: 55, shrink: 45, radius: 200, dps: 1 },
    { wait: 45, shrink: 40, radius: 125, dps: 2 },
    { wait: 40, shrink: 35, radius: 75, dps: 3 },
    { wait: 30, shrink: 30, radius: 40, dps: 5 },
    { wait: 25, shrink: 25, radius: 15, dps: 8 },
    { wait: 15, shrink: 25, radius: 0, dps: 10 },
  ],
};

// Loot totals for the ~0.7 km2 of tiles: denser per m2 than the old 8 km2 map (which had
// 320 / 180 / 450) because 100 players still need ~1 chest each.
export const MATCH = {
  bots: 99, // solo = 100 players, landing spread over the whole map (DropBus.planBotTargets); in multiplayer remote humans take slots first
  chests: 200,
  floorLoot: 630,
  ammoBoxes: 270,
};

// Team modes (Duos / Trios / Squads): knocked ("downed") state and revives. A downed actor
// crawls at crawlSpeed x run speed, can't shoot / build / loot, and bleeds downHp at `bleed`
// per second; a teammate holding interact within reviveRange for reviveTime brings it back up
// with reviveHp health. Solo never knocks (see src/game/Teams.js).
// Siphon: every elimination heals the killer by this much, health first (up to max), the
// rest as shield. 60 HP + 50 -> 100 HP and 10 shield.
export const SIPHON = 50;

// Assists: damage you dealt to someone who was then eliminated by another player.
export const ASSIST_DAMAGE = 50;

export const KNOCK = {
  downHp: 100,
  bleed: 2.5, // down HP per second (40 s to bleed out)
  crawlSpeed: 0.35,
  reviveTime: 10,
  reviveHp: 30,
  reviveRange: 2.2,
  botReviveClear: 40, // m: bots only revive with no enemy this close
};

// Swimming: on the terrain inside a map water area (World.inWater) you swim: slower, no
// sprint / jump / aim, and no shooting, building or healing until you are out. The body sinks
// to the chest (Character.setSwim).
export const SWIM = { speed: 0.6, sink: 0.75, strokeT: 0.55 };

// Reboot vans (team modes): an eliminated player drops a reboot card; a teammate picks it up
// and holds interact at one of Catfish Ken's reboot vans (one per DROP_ZONES POI) to bring
// them back next to the van with REBOOT.loadout. See game/Reboot.js.
export const REBOOT = {
  cardTime: 90, // s a dropped card waits for a teammate before it is gone
  cardRange: 2.4, // m to pick a card up
  useRange: 1.9, // m from the van's side to use it
  time: 8, // s holding interact at the van
  cooldown: 60, // s before the same van can reboot again
  health: 100,
  loadout: {
    items: [{ type: 'weapon', id: 'pistol', rarity: 'common' }],
    ammo: { light: 48 },
    mats: { wood: 100 },
    selected: 0,
  },
};

// Bot building: buildChance = odds a build roll in a fight succeeds; buildPieces = most
// pieces in one response (1 wall / 2 wall+ramp / 3+ ramp rush / 5 box: 4 walls + cone);
// buildCooldown = seconds between responses; buildRate = seconds between pieces in one.
// Game sense (competitive habits): wallOnHit = odds of throwing a wall (or a box when low)
// at whoever just shot them; boxHeal = odds of boxing up before healing after a fight;
// pushWeak = odds of pushing a target whose shield is cracked / that is healing;
// thirdParty = odds of moving in on gunfire they hear; rotateEarly = extra slack on rotations.
// boxFight = odds a close fight is taken from a full 1x1 box with edit peeks (window / door
// edited into the wall facing the enemy, shoot, reset the edit); peekOpen / peekClosed =
// seconds the edit stays open / closed.
// Only matches against HARD bots count toward the RANKS boards (wins + eliminations).
export const RANKED_DIFFICULTY = 'hard';
export const isRankedDifficulty = (d) => d === RANKED_DIFFICULTY;
export const RANKED_NOTE = 'Only matches on HARD bot difficulty count toward the ranks (wins and eliminations).';

// closeMiss: aim scatter in METRES at the target (sd), on top of the angular aimError: an angle
// alone shrinks to nothing up close, so without it a bot could not miss at shotgun range.
export const DIFFICULTY = {
  easy: { lead: 0.5, aimError: 0.085, closeMiss: 0.7, reaction: 0.9, burst: 0.55, buildChance: 0.35, buildPieces: 2, buildCooldown: 6, buildRate: 0.45, sight: 80, damageScale: 0.6, wallOnHit: 0.25, boxHeal: 0, pushWeak: 0.2, thirdParty: 0, rotateEarly: 0.3 },
  normal: {
    lead: 0.8, aimError: 0.05, closeMiss: 0.5, reaction: 0.55, burst: 0.7, buildChance: 0.75, buildPieces: 6, buildCooldown: 2.5, buildRate: 0.18, sight: 100, damageScale: 0.8,
    wallOnHit: 0.7, boxHeal: 0.6, pushWeak: 0.5, thirdParty: 0.25, rotateEarly: 0.6, boxFight: 0.35, peekOpen: 1.1, peekClosed: 0.8,
  },
  hard: {
    // aimError 0.017 -> 0.02 and closeMiss: hard bots used to never miss up close
    lead: 1, aimError: 0.02, closeMiss: 0.36, reaction: 0.18, burst: 0.92, buildChance: 1, buildPieces: 16, buildCooldown: 0.5, buildRate: 0.06, sight: 150, damageScale: 1,
    wallOnHit: 1, boxHeal: 1, pushWeak: 0.95, thirdParty: 0.7, rotateEarly: 1, boxFight: 0.9, peekOpen: 0.6, peekClosed: 0.32, // quick edits (was 0.9 / 0.55)
    peekWindow: true, // edit a window first, even up close (a door only when the window does not line up)
    trap: 0.55, // chance to full-box a close, grounded target and window-peek it (Bots._maybeTrap)
    rushFloors: true, // ramp rushes are ramp + wall + floor (cover ahead and overhead)
    highGround: 0.6, // chance to take height on a level target 8-45 m away instead of a lone wall
  },
};

// outline / bloom: post passes (render/Post.js); both off = plain render (cheapest).
// renderScale multiplies the device pixel ratio (internal resolution).
export const QUALITY = {
  // Chromebook / weak GPU: half-res, no post, short draw distances.
  performance: { pixelRatio: 1, renderScale: 0.5, outline: false, bloom: false, msaa: false, buildingDist: 420, treeDist: 160, propDist: 70, charDist: 80 },
  low: { pixelRatio: 1, renderScale: 1, outline: false, bloom: false, buildingDist: 1100, treeDist: 380, propDist: 160, charDist: 160 },
  medium: { pixelRatio: 1.5, renderScale: 1, outline: true, bloom: true, buildingDist: 1700, treeDist: 620, propDist: 260, charDist: 240 },
  high: { pixelRatio: 2, renderScale: 1, outline: true, bloom: true, buildingDist: 2400, treeDist: 950, propDist: 380, charDist: 320 },
};

// Drop zones: each match the first circle is centred near one of these.
// Keys match `landmarks` in the map data. The six named POIs (Phase 2); the other
// map landmarks (momentary, market_8th, compton_gardens, courthouse, ...) stay in
// the data for HUD location names and minimap labels but are no longer drop zones.
export const DROP_ZONES = [
  { key: 'bentonville_west', label: 'Bentonville West' },
  { key: 'bentonville_high', label: 'Bentonville High' },
  { key: 'square', label: 'Downtown Square' },
  { key: 'community_center', label: 'Community Center' },
  { key: 'crystal_bridges', label: 'Crystal Bridges' },
  { key: 'memorial_park', label: 'Memorial Park' },
];

export const BOT_NAMES = [
  'OzarkOtter', 'TrailMix', 'SquareDancer', 'CreekWader', 'PawpawPete', 'BluffRunner', 'DogwoodDee', 'GravelGrinder',
  'PorchSwing', 'HoneyBiscuit', 'MuddyBoots', 'FireflyFinn', 'SwitchbackSue', 'TaterTot', 'RedDirtRay', 'CicadaSong',
  'HickoryHank', 'LimestoneLou', 'SweetTeaTess', 'BanjoBlue', 'CrawdadCal', 'MossyOak', 'SundaySkillet', 'PedalPusher',
  'HollerHero', 'QuartzQuinn', 'RidgeRascal', 'PecanPie', 'ThunderGap', 'FoxfireFay', 'CopperCreek', 'WillowWisp',
  'DustyTrail', 'MapleMoon', 'BramblePatch', 'SkipperStone', 'LanternJack', 'PrairiePip', 'CedarSmoke', 'RiverRook',
];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/** Shortest signed angle from a to b. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Small seedable PRNG (mulberry32). */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
