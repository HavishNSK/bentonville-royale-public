// BENTONVILLE ROYALE — flyer studio: the in-page half of tools/flyer/capture.mjs. Loaded into a
// running DEV build with `await import('/tools/flyer/page/studio.js')` (Vite serves it from the
// repo root, so 'three' and /src modules resolve to the same instances the game uses). Never
// imported by the game, so it is not in a production build. Needs window.__game.raw (dev only).
//
//   const S = await import('/tools/flyer/page/studio.js');
//   S.hideUi(true); await S.placeScene(shot); await S.runActions(shot.setup); S.reset();
//   const png = await S.renderItem({ item: 'grenade', size: 360 })   // data: URL
import * as THREE from 'three';
import { WEAPONS, CONSUMABLES, RARITY_COLOR, CAMERA } from '/src/core/config.js';
import { grenadeModel, smokeGrenadeModel, launcherModel } from '/src/game/Grenades.js';
import { toonize } from '/src/render/Toon.js';
import { PAVILIONS } from '/src/world/crystal-bridges/site.js';

const D2R = Math.PI / 180;

function game() {
  const g = window.__game && window.__game.raw;
  if (!g) throw new Error('window.__game.raw is missing: the studio needs a Vite dev build');
  return g;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n = 2) => new Promise((r) => {
  const step = () => (--n <= 0 ? r() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});

// ------------------------------------------------------------------ UI

/** Hides every DOM element over the canvas (HUD, crosshair, tags, toasts, chat, menus, FPS). */
export function hideUi(on = true) {
  let st = document.getElementById('flyer-studio-hide');
  if (on && !st) {
    st = document.createElement('style');
    st.id = 'flyer-studio-hide';
    // descendants too: a shown HUD element with its own `visibility: visible` (the round banner)
    // would otherwise override its hidden parent
    st.textContent = 'body > :not(#game), body > :not(#game) * { visibility: hidden !important; } #game { cursor: none !important; }';
    document.head.appendChild(st);
  } else if (!on && st) st.remove();
  const g = window.__game && window.__game.raw;
  if (g && g.hud && g.hud.setVisible) g.hud.setVisible(!on);
}

// ------------------------------------------------------------------ points

/** {x, y, z} for a point spec: {x, y?, z}, a ref string, or {ref, dx, dy, dz}. */
export function resolvePoint(spec) {
  const g = game();
  const w = g.world;
  let p;
  let off = { dx: 0, dy: 0, dz: 0 };
  if (spec && typeof spec === 'object' && spec.ref) {
    off = { dx: spec.dx || 0, dy: spec.dy || 0, dz: spec.dz || 0 };
    spec = spec.ref;
  }
  if (typeof spec === 'string') {
    const [kind, key] = spec.split(':');
    if (kind === 'player') p = { x: g.player.pos.x, y: g.player.pos.y + CAMERA.pivotHeight, z: g.player.pos.z };
    else if (kind === 'landmark') {
      const l = (w.landmarks || {})[key];
      if (!l) throw new Error(`no landmark "${key}" (have: ${Object.keys(w.landmarks || {}).join(', ')})`);
      p = { x: l.x, z: l.z };
    } else if (kind === 'van') {
      const vans = (g.reboot && g.reboot.vans) || [];
      const v = vans.find((x) => x.key === key);
      if (!v) throw new Error(`no reboot van "${key}" (have: ${vans.map((x) => x.key).join(', ')})`);
      p = { x: v.x, y: v.y + 1.2, z: v.z };
    } else if (kind === 'pavilion') {
      const pv = PAVILIONS.find((x) => x.id === key);
      if (!pv) throw new Error(`no pavilion "${key}"`);
      p = { x: (pv.x0 + pv.x1) / 2, y: pv.floor, z: (pv.z0 + pv.z1) / 2 };
    } else if (kind === 'door') {
      const d = w.siteDoors && w.siteDoors.doors.find((x) => x.id === key);
      if (!d) throw new Error(`no Crystal Bridges door "${key}"`);
      p = { x: d.cx, y: d.y0, z: d.cz };
    } else throw new Error(`unknown ref "${spec}"`);
  } else p = { x: spec.x, y: spec.y, z: spec.z };
  if (p.y == null) p.y = w.groundHeight(p.x, p.z, 1e4);
  return { x: p.x + off.dx, y: p.y + off.dy, z: p.z + off.dz };
}

// ------------------------------------------------------------------ camera

const _cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: null, active: false, hidePlayer: false };

/** Pins the game camera (dev only): replaces player.updateCamera on the instance. */
function pinCamera(pos, look, fov) {
  const g = game();
  const p = g.player;
  _cam.pos.set(pos.x, pos.y, pos.z);
  _cam.look.set(look.x, look.y, look.z);
  _cam.fov = fov || g.settings.fov || CAMERA.fov;
  if (!_cam.active) {
    p.updateCamera = function (cam) {
      // Player.update shows the body every frame; this runs after it, before the render
      if (_cam.hidePlayer && p.character) p.character.root.visible = false;
      cam.position.copy(_cam.pos);
      cam.lookAt(_cam.look);
      if (Math.abs(cam.fov - _cam.fov) > 0.01) {
        cam.fov = _cam.fov;
        cam.updateProjectionMatrix();
      }
      cam.updateMatrixWorld();
    };
    _cam.active = true;
  }
}

function unpinCamera() {
  const g = window.__game && window.__game.raw;
  if (g && g.player && Object.prototype.hasOwnProperty.call(g.player, 'updateCamera')) delete g.player.updateCamera;
  _cam.active = false;
}

/** Camera position for an orbit: look at `t` along heading / pitch from `dist` m away. */
function orbit(t, heading, pitch, dist) {
  const fx = Math.sin(heading) * Math.cos(pitch);
  const fz = -Math.cos(heading) * Math.cos(pitch);
  const fy = Math.sin(pitch);
  return { x: t.x - fx * dist, y: t.y - fy * dist, z: t.z - fz * dist };
}

function teleport(g, x, y, z) {
  const p = g.player;
  p.pos.set(x, y, z);
  if (p.vel) p.vel.set(0, 0, 0);
  p.grounded = true;
  if (p.character) p.character.root.position.copy(p.pos);
}

/** Puts the player and the camera where a scene shot wants them. */
export async function placeScene(shot) {
  const g = game();
  const p = g.player;
  p.god = true;
  const c = shot.camera;
  let pos;
  let look;
  let follow = false;
  if (c && (c.pos || c.lookAt)) {
    pos = resolvePoint(c.pos);
    look = resolvePoint(c.lookAt);
  } else if (c && c.target) {
    look = resolvePoint(c.target);
    pos = orbit(look, c.heading, c.pitch, c.distance);
  }
  // the player: where asked, else on the ground under the camera (culling, interiors and the
  // gallery lighting follow the player / camera)
  let pl = shot.player != null ? resolvePoint(shot.player) : null;
  if (pl && typeof shot.player === 'string' && shot.player !== 'player') pl.y = g.world.groundHeight(pl.x, pl.z, pl.y + 2);
  if (!pl && pos) pl = { x: pos.x, y: g.world.groundHeight(pos.x, pos.z, pos.y + 0.5), z: pos.z };
  if (pl) teleport(g, pl.x, pl.y, pl.z);
  const sp = shot.player && typeof shot.player === 'object' && !shot.player.ref ? shot.player : {};
  if (sp.heading != null) p.heading = sp.heading;
  if (sp.pitch != null) p.pitch = sp.pitch;
  if (!pos) {
    // the player's own third-person orbit, at `distance`
    follow = true;
    look = { x: p.pos.x, y: p.pos.y + CAMERA.pivotHeight, z: p.pos.z };
    pos = orbit(look, p.heading, p.pitch, shot.distance || CAMERA.distance);
  }
  pinCamera(pos, look, c && c.fov);
  _cam.hidePlayer = shot.hidePlayer != null ? !!shot.hidePlayer : !follow;
  await frames(3);
  return { camera: pos, lookAt: look, player: { x: p.pos.x, y: p.pos.y, z: p.pos.z } };
}

// ------------------------------------------------------------------ actions

async function waitRockets(g, ms = 6000) {
  const t0 = performance.now();
  while (g.grenades.list.some((x) => x.rocket) && performance.now() - t0 < ms) await frames(1);
}

function fireRocket(g, from, to) {
  const o = new THREE.Vector3(from.x, from.y, from.z);
  const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize();
  const dmg = (WEAPONS.rocket_launcher && WEAPONS.rocket_launcher.damage) || 100;
  return g.grenades.fireRocket(g.player, o, o, dir, dmg);
}

const ACTIONS = {
  async wait(a) {
    await sleep(a.ms);
  },
  async spawnBots(a) {
    const g = game();
    const out = [];
    for (let i = 0; i < (a.count || 1); i++) {
      const bot = g.spawnSandboxBot(a.difficulty || 'normal');
      if (!bot) throw new Error('spawnBots: refused (sandbox mode only, at most 12 bots)');
      if (a.near) {
        const n = resolvePoint(a.near);
        const ang = (i / (a.count || 1)) * Math.PI * 2;
        const x = n.x + Math.cos(ang) * 2.5;
        const z = n.z + Math.sin(ang) * 2.5;
        bot.pos.set(x, g.world.groundHeight(x, z, n.y + 2), z);
        if (bot.character) bot.character.root.position.copy(bot.pos);
      }
      out.push(bot.name);
    }
    return out;
  },
  async placePieces(a) {
    const g = game();
    const p = g.player;
    const back = p.pos.clone();
    const h0 = p.heading;
    const pt0 = p.pitch;
    let placed = 0;
    for (const pc of a.pieces) {
      const at = resolvePoint(pc.at);
      teleport(g, at.x, at.y, at.z);
      p.heading = pc.heading || 0;
      p.pitch = pc.pitch || 0;
      const r = window.__game.debug.build(pc.kind);
      if (r && r.placed) placed++;
    }
    teleport(g, back.x, back.y, back.z);
    p.heading = h0;
    p.pitch = pt0;
    p.setBuildPiece && p.setBuildPiece(null);
    if (!placed) throw new Error('placePieces: nothing could be placed');
    return { placed, of: a.pieces.length };
  },
  async rocket(a) {
    const g = game();
    fireRocket(g, resolvePoint(a.from), resolvePoint(a.to));
    await waitRockets(g);
  },
  async breakRoof(a) {
    const g = game();
    const at = resolvePoint(a.at);
    fireRocket(g, { x: at.x, y: at.y - 6, z: at.z }, at);
    await waitRockets(g);
  },
  async smoke(a) {
    const g = game();
    const at = resolvePoint(a.at);
    g.grenades.explodeAt(-1, new THREE.Vector3(at.x, at.y, at.z), false, true);
  },
  async openDoor(a) {
    const g = game();
    if (!g.world.siteDoors || !g.world.siteDoors.setOpen) throw new Error('openDoor: no Crystal Bridges doors');
    g.world.siteDoors.setOpen(a.id, true);
  },
  async give(a) {
    const g = game();
    window.__game.debug.give(a.item, a.rarity || 'epic');
    const i = g.player.inventory.slots.findIndex((s) => s && s.id === a.item);
    if (i >= 0) window.__game.debug.select(i);
    return { slot: i };
  },
  async eval(a) {
    const g = game();
    // dev-only escape hatch for shot lists written by the repo's own agents (never user input)
    return await new Function('game', 'THREE', 'studio', `return (async () => { ${a.js} })();`)(g, THREE, { resolvePoint, frames, sleep });
  },
};

/** Runs setup actions in order; returns their results. */
export async function runActions(list = []) {
  const out = [];
  for (const a of list) {
    const fn = ACTIONS[a.do];
    if (!fn) throw new Error('unknown action ' + a.do);
    out.push({ do: a.do, result: (await fn(a)) ?? null });
  }
  await frames(2);
  return out;
}

/** Undoes what shots leave behind (best effort; destructive shots can use `fresh`). */
export function reset() {
  const g = game();
  try {
    g.clearSandboxBots && g.clearSandboxBots();
    if (g.structures && g.structures.clear) g.structures.clear();
    if (g.grenades && g.grenades.clear) g.grenades.clear();
    if (g.world && g.world.restoreAllPanels) g.world.restoreAllPanels();
  } catch (err) {
    console.warn('flyer studio reset:', err && err.message);
  }
  _cam.hidePlayer = false;
  unpinCamera();
}

// ------------------------------------------------------------------ items

function itemSource(id) {
  const g = game();
  const models = g.models || {};
  const sceneOf = (name) => (models[name] && models[name].scene ? models[name].scene.clone(true) : null);
  if (id === 'grenade' || id === 'smoke') {
    const m = id === 'smoke' ? smokeGrenadeModel() : grenadeModel();
    return { obj: new THREE.Mesh(m.geometry, m.material), rarity: CONSUMABLES[id].rarity };
  }
  if (WEAPONS[id]) {
    const obj = sceneOf(WEAPONS[id].model) || (id === 'rocket_launcher' ? launcherModel() : null);
    if (!obj) throw new Error(`no model for weapon "${id}"`);
    return { obj, rarity: null };
  }
  if (CONSUMABLES[id]) {
    const obj = sceneOf(CONSUMABLES[id].model);
    if (!obj) throw new Error(`no model for consumable "${id}" (model "${CONSUMABLES[id].model}" is built in code)`);
    return { obj, rarity: CONSUMABLES[id].rarity };
  }
  const obj = sceneOf(id);
  if (!obj) throw new Error(`unknown item "${id}"`);
  return { obj, rarity: null };
}

let _r = null;
function itemRenderer(px) {
  const g = game();
  if (!_r) {
    const canvas = document.createElement('canvas');
    _r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    _r.setClearColor(0x000000, 0);
  }
  _r.outputColorSpace = g.renderer.outputColorSpace;
  _r.toneMapping = g.renderer.toneMapping;
  _r.toneMappingExposure = g.renderer.toneMappingExposure;
  _r.setPixelRatio(1);
  _r.setSize(px, px, false);
  return _r;
}

/**
 * One item alone on a transparent square: the game's toon materials, its sun + sky fill, a 3/4
 * view. Returns a PNG data: URL. Rendered at 2x and scaled down for clean edges.
 */
export async function renderItem(spec) {
  const g = game();
  const size = spec.size || 360;
  const { obj, rarity } = itemSource(spec.item);
  toonize(obj, { saturate: 1.15 });
  const rot = spec.rotate || [0, 0, 0];
  obj.rotation.set(rot[0] * D2R, rot[1] * D2R, rot[2] * D2R);
  const holder = new THREE.Group();
  holder.add(obj);
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const centre = box.getCenter(new THREE.Vector3());
  obj.position.sub(centre);
  holder.updateMatrixWorld(true);
  const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());

  const scene = new THREE.Scene();
  scene.add(holder);
  const sun = g.atmosphere && g.atmosphere.sun;
  const fillSrc = g.scene.getObjectByName('AtmosphereFill');
  const key = new THREE.DirectionalLight(sun ? sun.color : 0xfff2dd, sun ? sun.intensity : 2.4);
  key.position.set(-2, 4, 3);
  scene.add(key);
  const fill = new THREE.HemisphereLight(fillSrc ? fillSrc.color : 0xbfd6ff, fillSrc ? fillSrc.groundColor : 0x6b5a45, fillSrc ? fillSrc.intensity : 1.1);
  scene.add(fill);

  const fov = 30;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  const fillFrac = spec.fill || 0.82;
  const dist = sphere.radius / Math.sin((fov * D2R) / 2) / fillFrac;
  const yaw = (spec.yaw ?? 55) * D2R;
  const elev = (spec.elev ?? 18) * D2R;
  cam.position.set(Math.cos(elev) * Math.sin(yaw) * dist, Math.sin(elev) * dist, Math.cos(elev) * Math.cos(yaw) * dist);
  cam.lookAt(0, 0, 0);
  // the key light keeps its place relative to the camera (upper left, in front)
  key.position.copy(cam.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6).add(new THREE.Vector3(0, dist * 0.8, 0));

  const px = size * 2;
  const r = itemRenderer(px);
  r.render(scene, cam);

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  const glow = spec.glow === true ? spec.rarity || rarity : spec.glow || null;
  if (glow) {
    const col = new THREE.Color(RARITY_COLOR[glow] || 0xffffff);
    const rgb = `${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)}`;
    const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, `rgba(${rgb}, 0.55)`);
    grd.addColorStop(0.55, `rgba(${rgb}, 0.18)`);
    grd.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(r.domElement, 0, 0, px, px, 0, 0, size, size);
  // free the clone's GPU copies (materials / geometries are shared with the game: keep those)
  r.renderLists.dispose();
  return out.toDataURL('image/png');
}
