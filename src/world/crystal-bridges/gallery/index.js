// BENTONVILLE ROYALE — Crystal Bridges galleries (musewalk-style presentation inside the museum).
//
//   const gallery = await createGallery({ game, site })
//   gallery.update(dt)                          // every frame (Game)
//   gallery.interact(player, input, hud) -> bool // prompt + [E] focus; true when it handled the key
//   gallery.cameraOverride(cam, dt) -> bool      // focus mode drives the camera
//   gallery.portals                              // [{ i, x, y, z, w, h, nx, nz, to, heading, name }]
//
// Config: public/data/crystal-bridges.config.json (musewalk gallery.config.json shape). For testing,
// ?cbConfig=/data/<name>.json swaps it (same-origin /data/*.json only). Art: public/art/sources.json
// (scripts/fetch-cb-art.mjs). Outside the museum the game keeps its OG look; inside, the fog, light,
// bloom and a vignette crossfade (~1 s, like musewalk's wing transitions) to the wing's palette.

import * as THREE from 'three';
import { PAVILIONS, pavilionAt } from '../site.js';
import { placeArt, obstaclesFrom } from './hang.js';
import { buildFrame, buildPlaque, buildLightPool, buildBeam, standInTexture } from './frames.js';
import { createGalleryUI } from './ui.js';
import { Ambience } from './ambience.js';
import { runPortal } from './portal.js';
import { configUrl, sanitizeConfig, DEFAULT_PALETTE, interiorBlend } from './config.js';

export { configUrl, sanitizeConfig };

const ART_DRAW_RADIUS = 260; // metres from the museum's centre (0, -300): paintings drawn inside this
const SPOT_POOL = 3; // real lights moved onto the nearest works (fixed count: no shader recompiles)
const FOCUS_RANGE = 4.2;
const PORTAL_COOLDOWN = 10;
const ART_LOAD_RADIUS = 220; // start loading textures when this close to the museum

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function createGallery({ game, site, sfx = null }) {
  const scene = game.scene;
  const ui = createGalleryUI(game.uiRoot || document.body);
  let cfg;
  let manifest;
  let catalog = { works: {} };
  try {
    [cfg, manifest, catalog] = await Promise.all([
      getJSON(configUrl()),
      getJSON('/art/sources.json').catch(() => ({ files: {} })),
      getJSON('/art/catalog.json').catch(() => ({ works: {} })),
    ]);
  } catch (err) {
    console.warn('Crystal Bridges gallery config unavailable:', err.message);
    cfg = { wings: [] };
    manifest = { files: {} };
  }
  cfg = sanitizeConfig(cfg);
  const artIndex = {};
  for (const f of Object.values((manifest && manifest.files) || {})) {
    if (f && typeof f.workId === 'string' && typeof f.url === 'string' && /^\/art\/crystal-bridges\/[a-z0-9-]+\.jpg$/.test(f.url) && f.width > 0 && f.height > 0) artIndex[f.workId] = f;
  }
  const wingById = new Map(cfg.wings.map((w) => [w.id, w]));

  const group = new THREE.Group();
  group.name = 'cb-gallery';
  scene.add(group);

  // ---- hang the works
  const placements = placeArt(site.hangLines, cfg.wings, artIndex, obstaclesFrom(site));
  const loader = new THREE.TextureLoader();
  const items = [];
  let seed = 7;
  for (const pl of placements) {
    const wing = wingById.get(pl.wing) || DEFAULT_PALETTE;
    const work = pl.work;
    const entry = pl.entry;
    const isArt = !!(entry && !work.placeholder);
    const g = new THREE.Group();
    g.position.set(pl.x, pl.y, pl.z);
    g.rotation.y = Math.atan2(pl.nx, pl.nz);
    const frame = buildFrame(wing.frameStyle, pl.w, pl.h);
    g.add(frame);
    let canvasMesh = null;
    if (isArt) {
      canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(pl.w, pl.h), new THREE.MeshBasicMaterial({ color: 0x3a342c }));
      canvasMesh.position.z = frame.userData.canvasZ;
      g.add(canvasMesh);
    } else {
      // copyrighted works and images not downloaded get an original stand-in canvas, never an
      // empty frame (the plaque says which it is)
      canvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(pl.w, pl.h), new THREE.MeshBasicMaterial({ map: standInTexture(++seed * 7919, wing.accent) }));
      canvasMesh.position.z = frame.userData.canvasZ;
      g.add(canvasMesh);
    }
    const pool = buildLightPool(pl.w, pl.h, wing.lightColor, wing.frameStyle === 'float' ? 0.22 : 0.32);
    pool.position.set(0, 0.25, 0.02);
    g.add(pool);
    group.add(g);
    const cat = (work.art && catalog.works && catalog.works[work.art]) || {};
    const str = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
    const title = isArt ? entry.title : work.title || str(cat.title) || 'Untitled';
    const artist = isArt ? entry.artist : work.artist || str(cat.artist);
    const year = isArt ? entry.year : work.year || str(cat.year);
    const note = isArt ? '' : work.art && !work.placeholder ? 'Stand-in: image not downloaded' : 'Stand-in: the real work is in copyright';
    const plq = buildPlaque({ title, artist, year }, wing.accent, { note });
    plq.mesh.position.set(pl.plaque.x + pl.plaque.nx * 0.24, pl.plaque.y, pl.plaque.z + pl.plaque.nz * 0.24);
    plq.mesh.rotation.y = Math.atan2(pl.plaque.nx, pl.plaque.nz);
    group.add(plq.mesh);
    items.push({
      pl, wing, group: g, canvasMesh, isArt, entry, texture: null, loading: false,
      center: new THREE.Vector3(pl.x + pl.nx * 0.1, pl.y, pl.z + pl.nz * 0.1),
      normal: new THREE.Vector3(pl.nx, 0, pl.nz),
      info: {
        title, artist, year, desc: work.desc || '', line: work.line || '', placeholder: !isArt,
        wingNo: wing.no || '', wingName: wing.name || '',
        license: isArt ? entry.licenseShortName : null,
        credit: isArt ? `${entry.commonsFileTitle} · Wikimedia Commons · ${entry.licenseShortName}` : note,
        portal: isArt && work.portal ? work.portal : null,
      },
    });
  }

  // ---- labels for the Infinity Room, Eleven's sculpture plinth and the outdoor sculptures (not reproduced)
  const labelAt = (x, y, z, yaw, work, accent) => {
    const plq = buildPlaque(work, accent, { note: 'In copyright: not reproduced' });
    plq.mesh.position.set(x, y, z);
    plq.mesh.rotation.y = yaw;
    group.add(plq.mesh);
  };
  const plinthMat = new THREE.MeshLambertMaterial({ color: 0xe9e4d8 });
  for (const wing of cfg.wings) {
    for (const r of wing.rooms) {
      const room = PAVILIONS.flatMap((p) => (p.rooms || []).map((q) => ({ ...q, pv: p }))).find((q) => q.id === r.room);
      if (room) labelAt(room.x1 + 0.2, room.pv.floor + 1.42, (room.z0 + room.z1) / 2 + 2.2, Math.PI / 2, r, wing.accent);
    }
    for (const r of wing.plinths) {
      const pv = PAVILIONS.find((p) => p.wing === wing.id);
      if (!pv) continue;
      const x = (pv.x0 + pv.x1) / 2;
      const z = (pv.z0 + pv.z1) / 2;
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 1.2), plinthMat);
      plinth.position.set(x, pv.floor + 0.5, z);
      group.add(plinth);
      labelAt(x, pv.floor + 1.3, z + 0.62, 0, r, wing.accent);
    }
  }
  for (const o of cfg.outdoor) {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.6), plinthMat);
    plinth.position.set(o.at[0], game.world.groundHeight(o.at[0], o.at[2], o.at[1] + 1) + 0.3, o.at[2]);
    group.add(plinth);
    labelAt(o.at[0], plinth.position.y + 0.75, o.at[2] + 0.82, 0, o, '#d4af5a');
  }

  // ---- spot pool (musewalk per-painting SpotLight values) + beams
  const spots = [];
  const spotTargets = new Set();
  let artShown = true;
  for (let i = 0; i < SPOT_POOL; i++) {
    const s = new THREE.SpotLight(0xffd9a8, 0, 17, 0.6, 0.78, 1.7);
    s.castShadow = false;
    group.add(s, s.target);
    spotTargets.add(s.target);
    spots.push(s);
  }
  const beams = [];
  for (let i = 0; i < SPOT_POOL; i++) {
    const b = buildBeam(0.4, 1.6, 4.2, 0xffd9a8, 0);
    b.visible = false;
    group.add(b);
    beams.push(b);
  }

  // ---- portals (only real paintings with a configured destination)
  const portals = items
    .filter((it) => it.info.portal)
    .map((it, i) => ({ i, item: it, x: it.pl.x, y: it.pl.y, z: it.pl.z, w: it.pl.w, h: it.pl.h, nx: it.pl.nx, nz: it.pl.nz, floor: it.pl.floor, ...it.info.portal }));

  // ---- state
  const ambience = new Ambience(sfx);
  const tmpCam = new THREE.PerspectiveCamera();
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  let k = 0; // interior factor (smoothed)
  let pal = { ...DEFAULT_PALETTE };
  let inside = false;
  let wasInSite = false;
  let focus = null; // { item, pos, look, t, startPos, hp, released }
  let release = null; // { t, pos, look } blend back to the player camera
  let portal = null;
  const cooldown = new Map(); // actor id -> time when usable again
  let lastHp = null;
  let combatT = 0;
  let time = 0;

  function nearestItem(px, pz, py, maxD) {
    let best = null;
    let bd = maxD;
    for (const it of items) {
      const dx = px - it.center.x;
      const dz = pz - it.center.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(py - it.pl.floor) > 1.5) continue;
      if (dx * it.normal.x + dz * it.normal.z < 0.3) continue; // must be in front
      bd = d;
      best = it;
    }
    return best;
  }

  function loadTexture(it) {
    if (it.loading || !it.isArt) return;
    it.loading = true;
    loader.load(it.entry.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      it.texture = tex;
      it.canvasMesh.material.dispose();
      it.canvasMesh.material = new THREE.MeshBasicMaterial({ map: tex });
    }, undefined, () => {
      it.loading = 'failed';
    });
  }

  function focusPose(it, cam) {
    // musewalk main.js focus framing (desktop branch)
    const vfov = (cam.fov * Math.PI) / 180;
    const hTan = Math.tan(vfov / 2) * cam.aspect;
    const W = window.innerWidth;
    const panelPx = Math.min(440, W * 0.94);
    const visibleFrac = W < 900 ? 1 : (W - panelPx) / W;
    const dist = Math.min(5.4, Math.max(1.7, Math.max(it.pl.h / 2 / Math.tan(vfov / 2), it.pl.w / 2 / (hTan * visibleFrac)) * 1.3 + 0.55));
    const pos = it.center.clone().addScaledVector(it.normal, dist);
    // shift right (cross(-n, up)) so the work centres in the area left of the 440 px panel
    if (visibleFrac < 1) pos.addScaledVector(_w.set(it.normal.z, 0, -it.normal.x), dist * hTan * (1 - visibleFrac));
    pos.y = it.center.y - 0.12;
    // look straight at the wall (parallel to the normal), pitched up by musewalk's 0.9 * atan2
    const pitch = Math.atan2(it.center.y - pos.y, dist) * 0.9;
    const look = pos.clone().addScaledVector(it.normal, -dist);
    look.y = pos.y + Math.tan(pitch) * dist;
    return { pos, look };
  }

  function exitFocus() {
    if (!focus) return;
    release = { t: 0, pos: game.camera.position.clone(), look: focus.look.clone() };
    focus = null;
    ui.panel(null);
    ui.setVignette(k * 0.9, false);
  }

  function tryPortal(p) {
    if (portal || !p.alive || p.downed) return;
    const now = time;
    if ((cooldown.get(p.id) || 0) > now) return;
    if (game.storm && game.storm.hudState && game.storm.hudState(p.pos.x, p.pos.z).outside) return;
    for (const pt of portals) {
      const dx = p.pos.x - pt.x;
      const dz = p.pos.z - pt.z;
      const d = dx * pt.nx + dz * pt.nz; // distance in front of the wall face
      const lat = Math.abs(dx * pt.nz - dz * pt.nx);
      if (d > 0.95 || d < -0.2 || lat > pt.w / 2 - 0.2 || Math.abs(p.pos.y - pt.floor) > 1) continue;
      const vin = -(p.vel.x * pt.nx + p.vel.z * pt.nz);
      if (vin < 0.8) continue; // walking into it
      start(pt, p);
      return;
    }
  }

  function start(pt, p) {
    cooldown.set(p.id, time + PORTAL_COOLDOWN);
    exitFocus();
    const tex = pt.item.texture;
    if (!tex) return;
    ambience.chime();
    portal = runPortal({
      scene, placement: pt.item.pl, texture: tex, ui, canvasMesh: pt.item.canvasMesh,
      onArrive: () => {
        const [x, y, z] = pt.to;
        const net = game.net && game.net.isClient ? game.net : null;
        if (net && net.portal) net.portal(pt.i);
        const gy = game.world.groundHeight(x, z, y + 1.5);
        p.pos.set(x, gy, z);
        p.vel.set(0, 0, 0);
        p.heading = pt.heading;
        ui.hint(pt.name ? pt.name.toUpperCase() : '', 3500);
      },
    });
  }

  /** Host-side validation of a client's portal request (peer messages are untrusted). */
  function validatePortal(actor, i) {
    const pt = portals[i | 0];
    if (!pt || !actor || !actor.alive || actor.downed || actor.inBus || actor.airborneDrop) return null;
    if ((cooldown.get('a' + actor.id) || 0) > time) return null;
    if (Math.hypot(actor.pos.x - pt.x, actor.pos.z - pt.z) > 4 || Math.abs(actor.pos.y - pt.floor) > 1.5) return null;
    if (game.storm && game.storm.hudState && game.storm.hudState(actor.pos.x, actor.pos.z).outside) return null;
    cooldown.set('a' + actor.id, time + PORTAL_COOLDOWN);
    return pt.to;
  }

  return {
    portals,
    items,
    validatePortal,
    get focused() {
      return !!focus;
    },
    get interior() {
      return k;
    },
    update(dt) {
      time += dt;
      const p = game.player;
      if (!p) return;
      const cam = game.camera;
      // the ~400 paintings, frames and labels are only drawn near the museum (they cost every
      // frame from anywhere on the map); the spot lights stay so no shader has to recompile
      const nearArt = Math.hypot(cam.position.x, cam.position.z + 300) < ART_DRAW_RADIUS;
      if (nearArt !== artShown) {
        artShown = nearArt;
        for (const c of group.children) if (!c.isLight && !spotTargets.has(c) && !beams.includes(c)) c.visible = nearArt;
      }
      // interior factor: inside a pavilion, below its roof
      const pv = pavilionAt(p.pos.x, p.pos.z, p.pos.y);
      inside = !!pv && !(game.state !== 'play' && game.state !== 'over');
      if (pv && pv.wing && wingById.has(pv.wing)) pal = wingById.get(pv.wing);
      else if (pv) pal = DEFAULT_PALETTE;
      // galleries take the musewalk mist; glass halls and the ravine between pavilions keep a haze
      const glassy = pv && (pv.bridge || !pv.wing || ['lobby', 'corridor', 'great-hall', 'eleven', 'library'].includes(pv.wing));
      const inSite = Math.abs(p.pos.x) < 75 && p.pos.z < -150 && p.pos.z > -470 && (game.state === 'play' || game.state === 'over');
      if (!inside && inSite) pal = DEFAULT_PALETTE;
      const target = interiorBlend({ inside, glassy, inSite });
      k += (target - k) * (1 - Math.exp(-dt * 3)); // ~1 s crossfade (musewalk wing transitions)
      if (game.atmosphere && game.atmosphere.setInterior) game.atmosphere.setInterior(k, pal);
      if (game.post && game.post._bloom) game.post._bloom.strength = 0.32 + (0.55 - 0.32) * k; // musewalk hall bloom target 0.55
      if (!focus) ui.setVignette(k * 0.9, false);

      // NOW ENTERING
      if (inSite && game.state === 'play' && !wasInSite) ui.entering(true);
      wasInSite = inSite && game.state === 'play';

      // damage cancels focus; recent combat blocks it
      const hp = (p.health || 0) + (p.shield || 0);
      if (lastHp !== null && hp < lastHp - 0.01) {
        combatT = time + 4;
        exitFocus();
      }
      lastHp = hp;
      if (p.shotAt && performance.now() / 1000 - p.shotAt < 0.2) combatT = Math.max(combatT, time + 2);

      // textures: load once the player is near the museum
      if (Math.hypot(p.pos.x, p.pos.z + 300) < ART_LOAD_RADIUS) for (const it of items) if (!it.loading) loadTexture(it);

      // spot pool on the nearest works (inside only)
      const near = inside ? items.map((it) => [it, it.center.distanceToSquared(p.pos)]).filter(([, d]) => d < 400).sort((a, b) => a[1] - b[1]).slice(0, SPOT_POOL) : [];
      for (let i = 0; i < SPOT_POOL; i++) {
        const s = spots[i];
        const b = beams[i];
        const it = near[i] && near[i][0];
        if (!it) {
          s.intensity = Math.max(0, s.intensity - dt * 200);
          b.visible = false;
          continue;
        }
        const top = it.pl.floor + Math.min(6.9, it.pl.h + 3.4);
        s.color.set(it.wing.lightColor);
        s.intensity = (it.wing.frameStyle === 'float' ? 44 : 76) * 0.55 * k; // musewalk 76 / 44, scaled to the game's exposure
        s.position.set(it.center.x + it.normal.x * 3.0, top, it.center.z + it.normal.z * 3.0);
        s.target.position.copy(it.center);
        s.target.updateMatrixWorld();
        b.visible = k > 0.05;
        b.material.uniforms.uColor.value.set(it.wing.lightColor);
        b.material.uniforms.uOpacity.value = 0.1 * k;
        b.position.set(it.center.x + it.normal.x * 1.4, top - 2.1, it.center.z + it.normal.z * 1.4);
        b.lookAt(it.center.x, it.center.y - 2, it.center.z);
        b.rotateX(Math.PI / 2);
      }

      // focus: leaving the spot, or moving, ends it
      if (focus) {
        focus.t += dt;
        if (p.pos.distanceTo(focus.startPos) > 0.25 || !p.alive) exitFocus();
        else if (!focus.paneled && (focus.t > 1.3 || cam.position.distanceTo(focus.pos) < 0.08)) {
          focus.paneled = true;
          ui.panel(focus.item.info, { key: game.input && game.input.label ? game.input.label('interact') : 'E' });
          ambience.chime();
        }
      } else if (inside && !portal) {
        const it = nearestItem(p.pos.x, p.pos.z, p.pos.y, FOCUS_RANGE);
        ui.caption(it ? it.info : null, game.input && game.input.label ? game.input.label('interact') : 'E');
      } else ui.caption(null);

      // portals (the local player; bots never use them)
      if (portal) {
        if (portal.update(dt)) {
          portal.dispose();
          portal = null;
        }
      } else if (inside && game.state === 'play') tryPortal(p);

      // ambience (ducked by nearby gunfire and the storm)
      let duck = 0;
      if (game.combat) {
        const now = performance.now() / 1000;
        for (const a of game.combat.actors) {
          if (a.shotAt && now - a.shotAt < 2.5 && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 80) duck = 1;
        }
      }
      if (game.storm && game.storm.hudState && game.storm.hudState(p.pos.x, p.pos.z).outside) duck = 1;
      ambience.update(dt, k, duck, pv && pv.id === 'lobby' ? 'lobby' : 'hall');
    },

    /** Player._interact hook: prompt + focus toggle. Returns true when the gallery owns the prompt. */
    interact(p, input, hud) {
      if (focus) {
        if (input.actionHit('interact')) exitFocus();
        hud.prompt(null);
        return true;
      }
      if (!inside || combatT > time || portal) return false;
      const it = nearestItem(p.pos.x, p.pos.z, p.pos.y, FOCUS_RANGE);
      if (!it) return false;
      hud.prompt('[' + (input.label ? input.label('interact') : 'E') + '] View ' + it.info.title);
      if (input.actionHit('interact')) {
        const pose = focusPose(it, game.camera);
        focus = { item: it, pos: pose.pos, look: pose.look, t: 0, startPos: p.pos.clone(), paneled: false };
        ui.caption(null);
        ui.setVignette(1, true);
      }
      return true;
    },

    /** Drives the camera while focused (and blends back afterwards). Returns true when it did. */
    cameraOverride(cam, dt) {
      if (focus) {
        // critically damped approach, musewalk SMOOTH_CINEMA 0.8 s
        const a = 1 - Math.exp(-dt / 0.28);
        cam.position.lerp(focus.pos, a);
        if (!focus.lookCur) focus.lookCur = cam.position.clone().add(cam.getWorldDirection(_v).multiplyScalar(4));
        focus.lookCur.lerp(focus.look, a);
        cam.lookAt(focus.lookCur);
        return true;
      }
      if (release) {
        release.t += dt;
        const p = game.player;
        tmpCam.copy(cam);
        p.updateCamera(tmpCam, dt, game.world, game.settings.fov || 70);
        const f = Math.min(1, release.t / 0.55); // musewalk release smoothTime 0.55
        const e = f * f * (3 - 2 * f);
        cam.position.lerpVectors(release.pos, tmpCam.position, e);
        cam.quaternion.slerpQuaternions(cam.quaternion, tmpCam.quaternion, e);
        if (f >= 1) release = null;
        return true;
      }
      return false;
    },

    dispose() {
      ui.dispose();
      scene.remove(group);
    },
  };
}
