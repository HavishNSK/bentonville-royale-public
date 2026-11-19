// BENTONVILLE ROYALE — the one bot profile Box Fights bots fight with.
//
// Fairness rule: every bot in a Box Fights match (both teams, every slot) uses the SAME preset,
// picked by the host (easy | normal | hard), the same loadout and the same personality. Presets
// only change these numbers. Bots.js turns a preset into its tuning table with
// profileToDifficulty() (layered over DIFFICULTY for the arena), so the values here are what
// the bots actually run on, not a description of them.
//
// No THREE, no DOM: shared by the game, the lobby UI and tests.

/**
 * reactionTimeMs: delay before the first shot at a newly seen enemy.
 * aimAccuracy: 0-1, close-range accuracy (1 = no scatter); aimJitterDeg: angular aim error.
 * buildSpeed: pieces placed per second while building.
 * editsAllowed: may box up and edit-peek / trap (window and door edits). Off: plain walls, ramps, cover.
 * loadout: the Box Fights kit id (BoxFights.boxLoadout); 'standard' is the one kit for everyone.
 * pushesWhenEnemyHp: pushes an enemy whose health + shield is below this.
 * personality: fixed caution / aggression (other modes roll these per bot).
 */
export const BOT_PROFILES = Object.freeze({
  easy: Object.freeze({
    difficulty: 'easy',
    reactionTimeMs: 900,
    aimAccuracy: 0.42,
    aimJitterDeg: 4.9,
    buildSpeed: 3.3,
    editsAllowed: false,
    loadout: 'standard',
    pushesWhenEnemyHp: 75,
    caution: 0.5,
    aggression: 0.6,
  }),
  normal: Object.freeze({
    difficulty: 'normal',
    reactionTimeMs: 550,
    aimAccuracy: 0.58,
    aimJitterDeg: 2.9,
    buildSpeed: 5.5,
    editsAllowed: true,
    loadout: 'standard',
    pushesWhenEnemyHp: 75,
    caution: 0.5,
    aggression: 0.6,
  }),
  hard: Object.freeze({
    difficulty: 'hard',
    reactionTimeMs: 180,
    aimAccuracy: 0.7,
    aimJitterDeg: 1.15,
    buildSpeed: 8.3,
    editsAllowed: true,
    loadout: 'standard',
    pushesWhenEnemyHp: 75,
    caution: 0.5,
    aggression: 0.6,
  }),
});

export const BOT_DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);

/** The default preset (what a new lobby starts with). */
export const BOT_PROFILE = BOT_PROFILES.normal;

/** The preset for a difficulty name; anything unknown is 'normal'. Whitelist lookup only. */
export function botProfile(difficulty) {
  return BOT_DIFFICULTIES.includes(difficulty) ? BOT_PROFILES[difficulty] : BOT_PROFILE;
}

// closeMiss (aim scatter in metres at the target, see config.js DIFFICULTY) = (1 - aimAccuracy) * this
const CLOSE_MISS_SCALE = 1.2;

/** The Bots.js tuning fields a profile sets (merged over DIFFICULTY for arena bots). */
export function profileToDifficulty(p) {
  const out = {
    reaction: p.reactionTimeMs / 1000,
    aimError: (p.aimJitterDeg * Math.PI) / 180,
    closeMiss: (1 - p.aimAccuracy) * CLOSE_MISS_SCALE,
    buildRate: 1 / p.buildSpeed,
    pushHp: p.pushesWhenEnemyHp,
  };
  if (!p.editsAllowed) {
    out.boxFight = 0; // no box-and-edit-peek fights
    out.trap = 0; // no window-peek traps
    out.peekWindow = false;
  }
  return out;
}

// NATO alphabet: "Bot Alpha", "Bot Bravo", ... (six slots is the most a lobby holds)
const CALLSIGNS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

/** `n` Box Fights bot names in slot order: Bot Alpha, Bot Bravo, ... then numbered repeats. */
export function boxBotNames(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = CALLSIGNS[i % CALLSIGNS.length];
    out.push(i < CALLSIGNS.length ? `Bot ${c}` : `Bot ${c} ${Math.floor(i / CALLSIGNS.length) + 1}`);
  }
  return out;
}

/** True for a name made by boxBotNames (the scoreboard tags these with a robot). */
export const isBoxBotName = (name) => typeof name === 'string' && /^Bot [A-Z][a-z]+( \d+)?$/.test(name);
