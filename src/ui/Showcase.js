// BENTONVILLE ROYALE — lobby showcase: your outfit (and your party's) standing on the title
// screen in 3D, idling, emoting on request. Its own small renderer, drawn only while shown.
//
//   const sc = createShowcase(parentEl);
//   sc.setMembers([{ skin: 'skin_knight', pickaxe, backbling, name: 'You', you: true }, { skin, name }, ...])  // up to 4
//   sc.emote('emote_spin')      // the "you" character plays it (null stops)
//   sc.setActive(on)            // render loop on / off (title screen visible)
//   sc.preview(id|null)         // shop / locker: try an outfit, pickaxe or back bling on (null = back)
//   await sc.thumb(id)          // PNG data URL of any cosmetic (shop / locker cards), cached
//
// Up to MAX_SHOWN members stand in a shallow V; the camera refits so nobody is ever cropped,
// and name tags follow each character's feet. Drag to turn them. Characters load lazily (the GLBs are shared with the match load).

import * as THREE from 'three';
import { loadGLB, loadJSON } from '../core/assets.js';
import { CharacterKit, Character, registerKits, cosmeticMesh } from '../game/Character.js';
import { skinDef, SKINS, PICKAXES, BACKBLINGS, GLIDERS, BUNDLES, cosmeticDef } from '../game/Cosmetics.js';

import { LINEUP_MAX as MAX_SHOWN, lineUpSpots as spots, lineUpHalfWidth } from './lineup.js';

const FOV = 22; // a longer lens from further back: less big-head distortion than a close wide shot
const TOP = 2.1; // frame from just under the feet to just over the head (metres)
const BOTTOM = -0.62; // below the plinth's foot (0.34 tall under y = 0) + its nameplate
const HEADROOM = 1.25;

/** Rebuild key of an outfit: model + tint, plus the id for recipe skins (parts / colours / addons). */
function skinKey(id) {
  const def = skinDef(id);
  return def.model + '|' + def.tint + '|' + (def.parts || def.colors || def.addons ? id : '');
}

export function createShowcase(parent) {
  const wrap = document.createElement('div');
  wrap.className = 'mn-showcase';
  const canvas = document.createElement('canvas');
  canvas.className = 'mn-showcase-canvas';
  canvas.setAttribute('aria-label', 'Your outfit');
  canvas.setAttribute('role', 'img');
  const plate = document.createElement('div');
  plate.className = 'mn-showcase-names';
  wrap.append(canvas, plate);
  parent.appendChild(wrap);

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    wrap.classList.add('is-off'); // no WebGL: the title works without the line-up
  }
  if (renderer) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  let shownCount = 1; // how many members the camera is framed for
  scene.add(new THREE.HemisphereLight(0xfff1d6, 0x4b2f9a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff9a5a, 1.4);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  // a pedestal under each character: ink disc, sun-gold rim for you, cream rim for the party
  // a solid plinth under each character so nobody floats: ink-violet drum, a gold (you) or
  // cream (party) band round the top edge, and a dark contact shadow on its top face
  const PED_H = 0.34;
  const pedGeo = new THREE.CylinderGeometry(0.43, 0.49, PED_H, 40) // < LINEUP_GAP across: neighbours never touch;
  const pedMat = new THREE.MeshStandardMaterial({ color: 0x3a2c8f, roughness: 0.85, metalness: 0 });
  const bandGeo = new THREE.CylinderGeometry(0.442, 0.442, 0.07, 40, 1, true);
  const bandYou = new THREE.MeshStandardMaterial({ color: 0xffc21f, roughness: 0.6, emissive: 0x3a2a00 });
  const bandMate = new THREE.MeshStandardMaterial({ color: 0xfff6dc, roughness: 0.7 });
  const shadowGeo = new THREE.CircleGeometry(0.32, 32);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0d0927, transparent: true, opacity: 0.5, depthWrite: false });

  const turn = new THREE.Group();
  scene.add(turn);

  let manifest = null;
  const kits = new Map(); // model -> Promise<CharacterKit>
  function kitFor(model) {
    if (!kits.has(model)) {
      kits.set(
        model,
        (async () => {
          manifest = manifest || (await loadJSON('/assets/characters/manifest.json'));
          const info = manifest.characters[model] || manifest.characters.player;
          const g = await loadGLB(`/assets/characters/${info.file}`);
          return new CharacterKit(g, info);
        })()
      );
    }
    return kits.get(model);
  }

  // every model's accessories (pickaxes / back blings come from all four files) + the classic pick
  let extras = null;
  function loadExtras() {
    if (!extras) {
      extras = (async () => {
        manifest = manifest || (await loadJSON('/assets/characters/manifest.json'));
        const all = await Promise.all(Object.keys(manifest.characters).map(async (k) => [k, await kitFor(k).catch(() => null)]));
        registerKits(Object.fromEntries(all));
        let pick = null;
        try {
          pick = (await loadGLB('/assets/weapons/pickaxe.glb')).scene;
        } catch {
          /* no classic pickaxe: the hand stays empty */
        }
        return { pickaxe: pick };
      })();
    }
    return extras;
  }

  const slots = []; // { key, ch, holder, name }
  let members = [];
  let previewSkin = null;
  let previewPick = null;
  let previewBB = null;
  let previewGlider = null; // a glider being tried on: the front character shows its glide pose
  let emoteId = null;
  let active = false;
  let last = 0;
  let gen = 0;

  async function build() {
    const my = ++gen;
    const want = members.slice(0, MAX_SHOWN).map((m, i) =>
      i === 0 ? { ...m, skin: previewSkin || m.skin, pickaxe: previewPick || m.pickaxe, backbling: previewBB || m.backbling, glider: previewGlider || m.glider } : m
    );
    let weapons = {};
    try {
      weapons = await loadExtras();
    } catch {
      /* accessories are optional */
    }
    if (my !== gen) return;
    const at = spots(want.length);
    shownCount = Math.max(1, want.length);
    lastFit = '';
    // keep characters that did not change
    for (let i = 0; i < MAX_SHOWN; i++) {
      const w = want[i];
      const s = slots[i];
      const key = w ? skinKey(w.skin) : null;
      if (s && s.key === key) {
        s.ch.setLoadout({ pickaxe: w.pickaxe || 'pick_default', backbling: w.backbling || 'bb_outfit', glider: w.glider || 'gl_default' });
        s.holder.position.set(at[i].x, 0, at[i].z);
        continue;
      }
      if (s) {
        turn.remove(s.holder);
        if (s.ch && s.ch.dispose) s.ch.dispose();
        slots[i] = null;
      }
      if (!w) continue;
      const def = skinDef(w.skin);
      let kit;
      try {
        kit = await kitFor(def.model);
      } catch (e) {
        console.warn('showcase: outfit failed to load', e);
        continue;
      }
      if (my !== gen) return;
      const ch = new Character(kit, { weapons, tint: def.tint ?? undefined, skin: def, pickaxe: w.pickaxe || 'pick_default', backbling: w.backbling || 'bb_outfit', glider: w.glider || 'gl_default' });
      const holder = new THREE.Group();
      holder.position.set(at[i].x, 0, at[i].z);
      const ped = new THREE.Mesh(pedGeo, pedMat);
      ped.position.y = -PED_H / 2; // top face at y = 0, where the feet are
      const band = new THREE.Mesh(bandGeo, i === 0 ? bandYou : bandMate);
      band.position.y = -0.035;
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.005;
      holder.add(ped, band, shadow, ch.root);
      ch.root.position.set(0, 0, 0);
      turn.add(holder);
      slots[i] = { key, ch, holder };
      if (i === 0 && emoteId) ch.emote(true, emoteId);
    }
    // name tags, placed under each character's feet every frame (see placeTags)
    plate.replaceChildren();
    tags = want.map((m, i) => {
      if (!m) return null;
      const tag = document.createElement('span');
      tag.className = (i === 0 ? 'is-you' : '') + (m.ready ? ' is-ready' : '');
      const name = document.createElement('b');
      name.textContent = m.name || (i === 0 ? 'You' : '');
      tag.appendChild(name);
      if (i > 0 && m.ready != null) {
        const st = document.createElement('small');
        st.textContent = m.ready ? 'Ready' : 'Not ready';
        tag.appendChild(st);
      }
      if (!name.textContent) return null;
      plate.appendChild(tag);
      return { el: tag, x: at[i].x, z: at[i].z, last: '' };
    });
    placeTags();
  }

  // ---- framing: fit the whole line-up into the canvas, whatever its size and the party size
  let tags = [];
  let lastFit = '';
  const _p = new THREE.Vector3();
  function frameCamera() {
    const aspect = camera.aspect || 1;
    const tanV = Math.tan((FOV * Math.PI) / 360);
    const halfW = lineUpHalfWidth(shownCount);
    // headroom: a character fills ~80% of the height, never a wall-to-wall close-up
    const halfH = ((TOP - BOTTOM) / 2) * HEADROOM;
    const dist = Math.max(halfH / tanV, halfW / (tanV * aspect)) + 0.6;
    // feet stay near the bottom edge; the spare room goes above the heads (the sun shows there)
    const lookY = BOTTOM + (dist - 0.6) * tanV;
    // just above the plinths, so their top faces show and they read as solid
    camera.position.set(0, lookY + 0.35, dist);
    camera.lookAt(0, lookY, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  function placeTags() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    for (const t of tags) {
      if (!t) continue;
      _p.set(t.x, -0.12, t.z + 0.48).project(camera); // a nameplate on the plinth's front face
      const css = `translate(${Math.round(((_p.x + 1) / 2) * w)}px, ${Math.round(((1 - _p.y) / 2) * h)}px) translateX(-50%)`;
      if (css === t.last) continue;
      t.last = css;
      t.el.style.transform = css;
    }
  }

  function resize() {
    if (!renderer) return;
    const w = canvas.clientWidth | 0;
    const h = canvas.clientHeight | 0;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      lastFit = '';
    }
    const fit = `${w}x${h}x${shownCount}`;
    if (fit !== lastFit) {
      lastFit = fit;
      frameCamera();
      for (const t of tags) if (t) t.last = '';
    }
    return true;
  }

  // drag to turn
  let drag = null;
  let spin = 0.35;
  let spinV = 0;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    spin += dx * 0.012;
    spinV = dx * 0.012;
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    if (!active) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (!resize()) return;
    if (!drag) {
      spinV *= Math.exp(-4 * dt);
      spin += spinV;
      if (!reduced) spin += Math.sin(now / 2600) * 0.0009; // a slow sway when idle
    }
    // each character turns on its own pedestal (the row never swings out of frame), angled a
    // touch toward the middle like a squad photo
    for (const s of slots) if (s) s.holder.rotation.y = spin - s.holder.position.x * 0.12;
    placeTags();
    for (const s of slots) {
      if (!s) continue;
      const glide = !!previewGlider && s === slots[0];
      s.ch.update(dt, { fwd: 0, side: 0, speed: 0, grounded: !glide, gliding: glide, heading: Math.PI, pitch: 0 });
      s.ch.root.position.y = glide ? 0.7 : 0; // a glider being tried on hovers over the pedestal
    }
    renderer.render(scene, camera);
  }

  // ---- item thumbnails: one small offscreen renderer, items drawn one at a time
  const THUMB = 200;
  const thumbs = new Map(); // id -> Promise<dataURL|null>
  let thumbQ = Promise.resolve();
  let tr = null;
  let trIdle = 0;
  const tScene = new THREE.Scene();
  tScene.add(new THREE.HemisphereLight(0xfff1d6, 0x4b2f9a, 1.7));
  const tSun = new THREE.DirectionalLight(0xffffff, 2.4);
  tSun.position.set(2, 4, 5);
  tScene.add(tSun);
  const tRim = new THREE.DirectionalLight(0xffb27a, 1.2);
  tRim.position.set(-3, 2, -2);
  tScene.add(tRim);
  const tCam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const _box = new THREE.Box3();
  const _c = new THREE.Vector3();
  const _sz = new THREE.Vector3();

  /**
   * One cosmetic drawn alone on a transparent square. size: pixels; skin: the outfit wearing an
   * emote / glider (default the rogue).
   */
  async function drawThumb(id, { size = THUMB, skin = null } = {}) {
    const c = cosmeticDef(id);
    if (!c) return null;
    let weapons = {};
    try {
      weapons = await loadExtras();
    } catch {
      /* no accessories */
    }
    if (!tr) {
      try {
        tr = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      } catch {
        return null;
      }
      tr.outputColorSpace = THREE.SRGBColorSpace;
      tr.setPixelRatio(1);
      tr.setSize(THUMB, THUMB, false);
      tr.setClearColor(0x000000, 0);
    }
    clearTimeout(trIdle);
    tr.setSize(size, size, false);
    let obj = null;
    let ch = null;
    if (c.kind === 'backbling' && c.def.none) return null;
    const ownCape = c.kind === 'backbling' && !c.def.src && !c.def.proc; // "outfit's own cape": the rogue from behind
    if (c.kind === 'skin' || c.kind === 'emote' || c.kind === 'glider' || ownCape) {
      const def = skinDef(c.kind === 'skin' ? id : skin || 'skin_rogue');
      const kit = await kitFor(def.model);
      const glide = c.kind === 'glider';
      ch = new Character(kit, { weapons: {}, tint: def.tint ?? undefined, skin: def, glider: glide ? id : undefined });
      const st = { fwd: 0, side: 0, speed: 0, grounded: !glide, gliding: glide, heading: Math.PI, pitch: 0 };
      if (c.kind === 'emote') {
        ch.emote(true, id);
        for (let i = 0; i < 24; i++) ch.update(0.05, st); // into the move, fully faded in
      } else for (let i = 0; i < (glide ? 24 : 4); i++) ch.update(0.05, st); // a glider eases into its pose
      obj = ch.root;
      obj.rotation.y = ownCape ? Math.PI * 0.82 : glide ? 1.15 : 0.35; // a glider shows its pose side-on
      tCam.position.set(0, 1.05, 3.9);
      tCam.lookAt(0, 0.88, 0);
      if (glide) {
        // the glide pose tips the body over: fit the camera to it instead of the standing frame
        obj.updateMatrixWorld(true);
        _box.makeEmpty();
        obj.traverseVisible((o) => {
          if (o.isMesh) _box.expandByObject(o, true); // visible parts only: the hidden canopy would skew the fit
        });
        _box.getCenter(_c);
        _box.getSize(_sz);
        const d = (Math.max(_sz.x, _sz.y, _sz.z) * 0.62) / Math.tan((tCam.fov * Math.PI) / 360);
        tCam.position.set(_c.x, _c.y + d * 0.15, _c.z + d);
        tCam.lookAt(_c);
      }
    } else {
      const m = cosmeticMesh(id, weapons.pickaxe);
      if (!m) return null;
      obj = new THREE.Group();
      obj.add(m);
      m.position.set(0, 0, 0);
      m.quaternion.identity();
      if (c.kind === 'pickaxe') m.rotation.z = -0.65; // a jaunty diagonal
      else if ((c.def.src && c.def.src[2] === 'back') || c.def.proc) m.rotation.y = 0.35; // shields / books / built-in back blings: the side that faces out
      else m.rotation.y = Math.PI * 0.85; // a cape shows its outside
      obj.updateMatrixWorld(true);
      _box.setFromObject(obj);
      _box.getCenter(_c);
      _box.getSize(_sz);
      m.position.sub(_c);
      const r = Math.max(_sz.x, _sz.y, _sz.z) * 0.62;
      const d = r / Math.tan((tCam.fov * Math.PI) / 360);
      tCam.position.set(d * 0.18, d * 0.12, d);
      tCam.lookAt(0, 0, 0);
    }
    tScene.add(obj);
    tCam.updateProjectionMatrix();
    tr.render(tScene, tCam);
    const url = tr.domElement.toDataURL('image/png');
    tScene.remove(obj);
    if (ch && ch.dispose) ch.dispose();
    trIdle = setTimeout(() => {
      // free the extra GL context once the cards are drawn
      if (tr) {
        tr.dispose();
        tr.forceContextLoss();
        tr = null;
      }
    }, 4000);
    return url;
  }

  /**
   * A bundle's shop banner (16:9): violet backdrop with sun-gold corner wedges, the outfit large on
   * the right, the other items (glider worn by the outfit, pickaxe, back bling) around the left.
   */
  async function bundleArt(id) {
    const b = BUNDLES[id];
    const skin = b.items.find((x) => SKINS[x]) || null;
    const rest = b.items.filter((x) => x !== skin);
    const W = 800;
    const H = 450;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    const bg = g.createRadialGradient(W * 0.66, H * 0.45, 30, W * 0.5, H * 0.5, W * 0.72);
    bg.addColorStop(0, '#8b6cf2');
    bg.addColorStop(0.55, '#5a3fc6');
    bg.addColorStop(1, '#271a66');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // sun-gold wedges in the corners
    g.fillStyle = '#ffc21f';
    const wedge = (pts) => {
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.closePath();
      g.fill();
    };
    wedge([W * 0.1, 0, W * 0.24, 0, W * 0.2, H * 0.07]);
    wedge([W * 0.78, 0, W * 0.92, 0, W * 0.8, H * 0.08]);
    wedge([0, H * 0.82, 0, H, W * 0.16, H]);
    wedge([W, H * 0.8, W, H, W * 0.84, H]);
    const load = (url) =>
      new Promise((res) => {
        if (!url) return res(null);
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => res(null);
        im.src = url;
      });
    if (skin) {
      const hero = await load(await drawThumb(skin, { size: 560 }));
      if (hero) g.drawImage(hero, W * 0.42, -H * 0.04, H * 1.26, H * 1.26); // big, cropped at the knees
    }
    // left side, like a shop poster: glider top, pickaxe across the middle, back bling low
    const spots = { glider: [W * 0.04, -H * 0.04, H * 0.62], pickaxe: [W * 0.22, H * 0.3, H * 0.62], backbling: [W * 0.02, H * 0.46, H * 0.5] };
    for (const it of rest) {
      const c = cosmeticDef(it);
      const at = c && spots[c.kind];
      if (!at) continue;
      const im = await load(await drawThumb(it, { size: 320, skin }));
      if (im) g.drawImage(im, at[0], at[1], at[2], at[2]);
    }
    return cv.toDataURL('image/png');
  }

  return {
    el: wrap,
    thumb(id) {
      if (!thumbs.has(id)) {
        const p = (thumbQ = thumbQ.then(() => (BUNDLES[id] ? bundleArt(id) : drawThumb(id))).catch(() => null));
        thumbs.set(id, p);
      }
      return thumbs.get(id);
    },
    setMembers(list) {
      const next = (list || []).slice(0, MAX_SHOWN);
      const same =
        next.length === members.length &&
        next.every(
          (m, i) =>
            m.skin === members[i].skin &&
            m.name === members[i].name &&
            m.ready === members[i].ready &&
            m.pickaxe === members[i].pickaxe &&
            m.backbling === members[i].backbling
        );
      members = next;
      if (!same) build();
    },
    preview(id) {
      const was = [previewSkin, previewPick, previewBB, previewGlider].join();
      // a bundle tries on everything in it at once (its glider pose included)
      const ids = BUNDLES[id] ? BUNDLES[id].items : [id];
      const pick = (table) => ids.find((x) => table[x]) || null;
      previewSkin = pick(SKINS);
      previewPick = pick(PICKAXES);
      previewBB = pick(BACKBLINGS);
      previewGlider = BUNDLES[id] ? null : pick(GLIDERS); // a bundle stands on the pedestal to show the outfit
      if ([previewSkin, previewPick, previewBB, previewGlider].join() === was) return;
      build().then(() => {
        // a pickaxe preview shows it off with a swing; a back bling turns the line-up around
        const s = slots[0];
        if (previewPick && s && s.ch.swing) {
          // show the whole combo: one swing per move, then back to idle
          const moves = Math.max(1, (PICKAXES[previewPick].swing || []).length);
          s.ch._swingN = 0;
          for (let i = 0; i < moves * 2; i++) setTimeout(() => slots[0] === s && previewPick && s.ch.swing(), i * 520);
        }
        if (previewBB) spinV = 0.2;
      });
    },
    emote(id) {
      emoteId = id || null;
      const s = slots[0];
      if (!s) return;
      if (emoteId) s.ch.emote(true, emoteId);
      else s.ch.emote(false);
    },
    setActive(on) {
      on = !!on && !!renderer;
      if (on === active) return;
      active = on;
      last = 0;
      if (on) requestAnimationFrame(frame);
    },
  };
}
