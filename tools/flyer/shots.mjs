// BENTONVILLE ROYALE — update-flyer shot lists: the format, budgets and a validator (pure Node,
// no browser; used by capture.mjs and tests/flyer-assets.test.mjs). See README.md.
//
// A shot list lives in tools/flyer/shots/<version>.mjs and default-exports
//
//   {
//     version: '0.17.0',            // must equal FLYER.version
//     reuse: ['bb-old.jpg'],        // optional: flyer images kept as they are (no shot)
//     shots: [ <scene shot> | <item shot>, ... ],
//   }
//
// Every shot writes exactly one file, public/ui/news/<file> (or <--out>/<file>), and that file
// must be one the FLYER references. Every FLYER image must have a shot or be listed in `reuse`.
//
// Scene shot (JPEG, the in-game world with every HUD / menu element hidden):
//   {
//     kind: 'scene', file: 'bb-van.jpg',
//     mode: 'sandbox' | 'museum',           // default 'sandbox' (title-screen SANDBOX / MUSEUM)
//     size: [1100, 618],                     // default SCENE_SIZE
//     quality: 82,                           // JPEG quality 40..95, default 82
//     player: { x, z, y?, heading?, pitch? } | '<ref>',  // where the player stands (y: ground)
//     camera: one of
//       { pos: <point>, lookAt: <point>, fov? }               // free camera
//       { target: <point>, heading, pitch, distance, fov? }   // orbit: look at target from
//                                    // `distance` m; heading 0 = looking north (-z), pitch > 0
//                                    // looks up (radians, like player.heading / pitch)
//       omitted: orbit around the player's head with player.heading / pitch and `distance`
//     distance: 4.4,                          // only for the player-orbit camera
//     hidePlayer: true,                       // default: true unless the camera follows the player
//     settle: 2500,                           // ms to let streaming / culling / textures catch up
//     setup: [ <action>, ... ],               // run in order after settling, before the capture
//     fresh: false,                           // true: reload the game for this shot
//   }
//   <point> is { x, y?, z } (y omitted: ground height there) or a ref string:
//     'landmark:<key>' (map landmarks, e.g. landmark:crystal_bridges), 'van:<poi key>' (Catfish
//     Ken's reboot van, e.g. van:square), 'pavilion:<id>' (a Crystal Bridges pavilion's centre on
//     its floor, ids in src/world/crystal-bridges/site.js PAVILIONS), 'door:<id>' (south | library),
//     'player'. A ref may carry an offset: { ref: 'van:square', dx, dy, dz }.
//
// Setup actions (the whitelist; anything else is rejected):
//   { do: 'wait', ms }
//   { do: 'spawnBots', difficulty: 'easy'|'normal'|'hard', count: 1..6, near?: <point> }
//   { do: 'placePieces', pieces: [{ kind: 'wall'|'floor'|'ramp'|'cone', at: <point>, heading, pitch? }] }
//   { do: 'rocket', from: <point>, to: <point> }   // a real rocket: blast, debris, destruction
//   { do: 'breakRoof', at: <point> }               // a rocket fired straight up into `at`
//   { do: 'smoke', at: <point> }                   // a smoke cloud pops at `at`
//   { do: 'openDoor', id: 'south' | 'library' }    // Crystal Bridges sliding glass doors
//   { do: 'give', item: '<weapon or consumable id>', rarity? }  // and hold it
//   { do: 'eval', js: '...' }                      // DEV ONLY escape hatch: `game` is in scope,
//                                                   // may return a promise; prefer the above
//
// Item shot (transparent PNG of one model with the game's toon lighting, fixed 3/4 angle):
//   {
//     kind: 'item', file: 'bb-item-grenade.png',
//     item: 'grenade',          // weapon id (WEAPONS), consumable id (CONSUMABLES), or a loot
//                               // model name: chest | ammo | crate
//     size: 360,                // square px, default ITEM_SIZE
//     yaw: 55, elev: 18,        // camera azimuth / elevation in degrees (default 55 / 18)
//     rotate: [0, 0, 0],        // model rotation in degrees before framing, if it needs it
//     fill: 0.82,               // how much of the frame the model's bounding sphere spans
//     glow: false | true | '<rarity>',  // soft rarity glow behind it (true: the item's rarity)
//     rarity: 'epic',           // optional, for the glow
//   }

export const SCENE_SIZE = [1100, 618];
export const ITEM_SIZE = 360;
// Budgets from the shipped 0.17.0 images: scene JPEGs 58-156 KB at 1100x618 q~82, item PNGs
// 26-30 KB at 360x360. Roughly 1.6x / 2.7x headroom so a busy shot still fits.
export const BUDGET = { jpg: 250 * 1024, png: 80 * 1024 };
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const MODES = ['sandbox', 'museum'];
export const ACTIONS = ['wait', 'spawnBots', 'placePieces', 'rocket', 'breakRoof', 'smoke', 'openDoor', 'give', 'eval'];
export const PIECES = ['wall', 'floor', 'ramp', 'cone'];
export const REF_RE = /^(landmark|van|pavilion|door):[a-z0-9_-]+$|^player$/;
export const FILE_RE = /^[a-z0-9-]+\.(png|jpg)$/;

const SCENE_KEYS = new Set(['kind', 'file', 'mode', 'size', 'quality', 'player', 'camera', 'distance', 'hidePlayer', 'settle', 'setup', 'fresh', 'note']);
const ITEM_KEYS = new Set(['kind', 'file', 'item', 'size', 'yaw', 'elev', 'rotate', 'fill', 'glow', 'rarity', 'note']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);

function checkPoint(p, where, errs, { needY = false } = {}) {
  if (typeof p === 'string') {
    if (!REF_RE.test(p)) errs.push(`${where}: unknown ref "${p}"`);
    return;
  }
  if (!p || typeof p !== 'object') return errs.push(`${where}: expected {x, y?, z} or a ref string`);
  if (p.ref != null) {
    if (!REF_RE.test(p.ref)) errs.push(`${where}: unknown ref "${p.ref}"`);
    for (const k of ['dx', 'dy', 'dz']) if (p[k] != null && !num(p[k])) errs.push(`${where}.${k}: number`);
    return;
  }
  if (!num(p.x) || !num(p.z)) errs.push(`${where}: x and z must be numbers`);
  if (p.y != null && !num(p.y)) errs.push(`${where}.y: number`);
  if (needY && p.y == null) errs.push(`${where}.y: required here`);
}

function checkAction(a, where, errs) {
  if (!a || typeof a !== 'object' || !ACTIONS.includes(a.do)) return errs.push(`${where}: unknown action ${JSON.stringify(a && a.do)} (allowed: ${ACTIONS.join(', ')})`);
  switch (a.do) {
    case 'wait':
      if (!num(a.ms) || a.ms < 0 || a.ms > 60000) errs.push(`${where}.ms: 0..60000`);
      break;
    case 'spawnBots':
      if (!['easy', 'normal', 'hard'].includes(a.difficulty || 'normal')) errs.push(`${where}.difficulty: easy | normal | hard`);
      if (a.count != null && (!Number.isInteger(a.count) || a.count < 1 || a.count > 6)) errs.push(`${where}.count: 1..6`);
      if (a.near != null) checkPoint(a.near, where + '.near', errs);
      break;
    case 'placePieces':
      if (!Array.isArray(a.pieces) || !a.pieces.length || a.pieces.length > 40) errs.push(`${where}.pieces: 1..40 pieces`);
      else
        a.pieces.forEach((p, i) => {
          if (!PIECES.includes(p.kind)) errs.push(`${where}.pieces[${i}].kind: ${PIECES.join(' | ')}`);
          checkPoint(p.at, `${where}.pieces[${i}].at`, errs);
          if (p.heading != null && !num(p.heading)) errs.push(`${where}.pieces[${i}].heading: number`);
        });
      break;
    case 'rocket':
      checkPoint(a.from, where + '.from', errs);
      checkPoint(a.to, where + '.to', errs);
      break;
    case 'breakRoof':
    case 'smoke':
      checkPoint(a.at, where + '.at', errs);
      break;
    case 'openDoor':
      if (!['south', 'library'].includes(a.id)) errs.push(`${where}.id: south | library`);
      break;
    case 'give':
      if (typeof a.item !== 'string' || !/^[a-z_]+$/.test(a.item)) errs.push(`${where}.item: an item id`);
      if (a.rarity != null && !RARITIES.includes(a.rarity)) errs.push(`${where}.rarity: ${RARITIES.join(' | ')}`);
      break;
    case 'eval':
      if (typeof a.js !== 'string' || !a.js.trim() || a.js.length > 4000) errs.push(`${where}.js: non-empty string under 4000 chars`);
      break;
  }
}

function checkScene(s, where, errs) {
  for (const k of Object.keys(s)) if (!SCENE_KEYS.has(k)) errs.push(`${where}: unknown key "${k}"`);
  if (!/\.jpg$/.test(s.file || '')) errs.push(`${where}.file: scene shots are .jpg`);
  if (s.mode != null && !MODES.includes(s.mode)) errs.push(`${where}.mode: ${MODES.join(' | ')}`);
  if (s.size != null && !(Array.isArray(s.size) && s.size.length === 2 && s.size.every((n) => Number.isInteger(n) && n >= 200 && n <= 2400))) errs.push(`${where}.size: [w, h], 200..2400 px`);
  if (s.quality != null && !(Number.isInteger(s.quality) && s.quality >= 40 && s.quality <= 95)) errs.push(`${where}.quality: 40..95`);
  if (s.player != null) checkPoint(s.player, where + '.player', errs);
  if (s.player && typeof s.player === 'object' && !s.player.ref) {
    for (const k of ['heading', 'pitch']) if (s.player[k] != null && !num(s.player[k])) errs.push(`${where}.player.${k}: number`);
  }
  const c = s.camera;
  if (c != null) {
    if (typeof c !== 'object') errs.push(`${where}.camera: object`);
    else if (c.pos != null || c.lookAt != null) {
      checkPoint(c.pos, where + '.camera.pos', errs);
      checkPoint(c.lookAt, where + '.camera.lookAt', errs);
    } else if (c.target != null) {
      checkPoint(c.target, where + '.camera.target', errs);
      if (!num(c.distance) || c.distance <= 0 || c.distance > 400) errs.push(`${where}.camera.distance: 0..400`);
      for (const k of ['heading', 'pitch']) if (!num(c[k])) errs.push(`${where}.camera.${k}: number (radians)`);
    } else errs.push(`${where}.camera: needs {pos, lookAt} or {target, heading, pitch, distance}`);
    if (c.fov != null && !(num(c.fov) && c.fov >= 20 && c.fov <= 110)) errs.push(`${where}.camera.fov: 20..110`);
    for (const k of ['time', 'timeOfDay', 'weather']) if (c[k] != null) errs.push(`${where}.camera.${k}: not supported (the game has one fixed afternoon sky)`);
  } else if (!s.player) errs.push(`${where}: needs a camera or a player`);
  if (s.settle != null && !(num(s.settle) && s.settle >= 0 && s.settle <= 60000)) errs.push(`${where}.settle: 0..60000 ms`);
  if (s.setup != null) {
    if (!Array.isArray(s.setup)) errs.push(`${where}.setup: array`);
    else s.setup.forEach((a, i) => checkAction(a, `${where}.setup[${i}]`, errs));
  }
}

function checkItem(s, where, errs) {
  for (const k of Object.keys(s)) if (!ITEM_KEYS.has(k)) errs.push(`${where}: unknown key "${k}"`);
  if (!/\.png$/.test(s.file || '')) errs.push(`${where}.file: item shots are .png`);
  if (typeof s.item !== 'string' || !/^[a-z_]+$/.test(s.item)) errs.push(`${where}.item: an item id`);
  if (s.size != null && !(Number.isInteger(s.size) && s.size >= 64 && s.size <= 1024)) errs.push(`${where}.size: 64..1024`);
  for (const k of ['yaw', 'elev']) if (s[k] != null && !num(s[k])) errs.push(`${where}.${k}: degrees`);
  if (s.rotate != null && !(Array.isArray(s.rotate) && s.rotate.length === 3 && s.rotate.every(num))) errs.push(`${where}.rotate: [x, y, z] degrees`);
  if (s.fill != null && !(num(s.fill) && s.fill > 0.2 && s.fill <= 1.2)) errs.push(`${where}.fill: 0.2..1.2`);
  if (s.rarity != null && !RARITIES.includes(s.rarity)) errs.push(`${where}.rarity: ${RARITIES.join(' | ')}`);
  if (s.glow != null && typeof s.glow !== 'boolean' && !RARITIES.includes(s.glow)) errs.push(`${where}.glow: boolean or a rarity`);
}

/** Problems with a shot list (an array of strings; empty = valid). */
export function validateShotList(list) {
  const errs = [];
  if (!list || typeof list !== 'object') return ['shot list: default export must be an object'];
  if (typeof list.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(list.version)) errs.push('version: "x.y.z"');
  if (list.reuse != null && !(Array.isArray(list.reuse) && list.reuse.every((f) => FILE_RE.test(f)))) errs.push('reuse: file names like "bb-old.jpg"');
  if (!Array.isArray(list.shots)) return [...errs, 'shots: array'];
  const files = new Set();
  list.shots.forEach((s, i) => {
    const where = `shots[${i}]${s && s.file ? ' (' + s.file + ')' : ''}`;
    if (!s || typeof s !== 'object') return errs.push(`${where}: object`);
    if (!FILE_RE.test(s.file || '')) errs.push(`${where}.file: lower-case name like "bb-van.jpg" (written to public/ui/news/)`);
    if (files.has(s.file)) errs.push(`${where}.file: duplicate`);
    files.add(s.file);
    if (s.kind === 'scene') checkScene(s, where, errs);
    else if (s.kind === 'item') checkItem(s, where, errs);
    else errs.push(`${where}.kind: 'scene' | 'item'`);
  });
  return errs;
}

/** Every image a FLYER shows, as { src, file, alt, where }. */
export function flyerImages(flyer) {
  const out = [{ src: flyer.hero.src, alt: flyer.hero.alt, where: 'hero' }];
  for (const s of flyer.sections || []) {
    for (const it of s.items || []) out.push({ src: it.img, alt: it.name, where: `${s.id} item ${it.name}`, rarity: it.rarity });
    for (const im of s.images || []) out.push({ src: im.src, alt: im.alt, where: `${s.id} image` });
  }
  for (const o of out) o.file = String(o.src || '').replace(/^\/ui\/news\//, '');
  return out;
}

/** Flyer images neither shot nor reused, and shots the flyer does not show. */
export function coverage(flyer, list) {
  const wanted = new Set(flyerImages(flyer).map((i) => i.file));
  const shot = new Set((list.shots || []).map((s) => s.file));
  const reuse = new Set(list.reuse || []);
  return {
    missing: [...wanted].filter((f) => !shot.has(f) && !reuse.has(f)),
    orphans: [...shot, ...reuse].filter((f) => !wanted.has(f)),
  };
}

/** Loads tools/flyer/shots/<version>.mjs (null if there is none). */
export async function loadShotList(version) {
  const { existsSync } = await import('node:fs');
  const url = new URL(`./shots/${version}.mjs`, import.meta.url);
  if (!existsSync(url)) return null;
  return (await import(url.href)).default;
}
