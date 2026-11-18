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
// Drag to turn the line-up. Characters load lazily (the GLBs are shared with the match load).

import * as THREE from 'three';
import { loadGLB, loadJSON } from '../core/assets.js';
import { CharacterKit, Character, registerKits, cosmeticMesh } from '../game/Character.js';
import { skinDef, SKINS, PICKAXES, BACKBLINGS, cosmeticDef } from '../game/Cosmetics.js';
import { nameplate } from '../net/devs.js';

const SPOTS = [0, -1.25, 1.25, -2.4]; // x of member i (you in the middle)

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
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 1.22, 6.15);
  camera.lookAt(0, 0.92, 0);
  scene.add(new THREE.HemisphereLight(0xfff1d6, 0x4b2f9a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2.5, 5, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff9a5a, 1.4);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  // a soft pedestal disc under each character
  const discGeo = new THREE.CircleGeometry(0.62, 40);
  const discMat = new THREE.MeshBasicMaterial({ color: 0x15103a, transparent: true, opacity: 0.35, depthWrite: false });

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
  let emoteId = null;
  let active = false;
  let last = 0;
  let gen = 0;

  async function build() {
    const my = ++gen;
    const want = members.slice(0, SPOTS.length).map((m, i) =>
      i === 0 ? { ...m, skin: previewSkin || m.skin, pickaxe: previewPick || m.pickaxe, backbling: previewBB || m.backbling } : m
    );
    let weapons = {};
    try {
      weapons = await loadExtras();
    } catch {
      /* accessories are optional */
    }
    if (my !== gen) return;
    // keep characters that did not change
    for (let i = 0; i < SPOTS.length; i++) {
      const w = want[i];
      const s = slots[i];
      const key = w ? skinDef(w.skin).model + '|' + skinDef(w.skin).tint : null;
      if (s && s.key === key) {
        s.ch.setLoadout({ pickaxe: w.pickaxe || 'pick_default', backbling: w.backbling || 'bb_outfit' });
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
      const ch = new Character(kit, { weapons, tint: def.tint ?? undefined, pickaxe: w.pickaxe || 'pick_default', backbling: w.backbling || 'bb_outfit' });
      const holder = new THREE.Group();
      holder.position.set(SPOTS[i], 0, i === 0 ? 0.4 : -0.3);
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.01;
      holder.add(disc, ch.root);
      ch.root.position.set(0, 0, 0);
      turn.add(holder);
      slots[i] = { key, ch, holder };
      if (i === 0 && emoteId) ch.emote(true, emoteId);
    }
    plate.replaceChildren();
    want.forEach((m, i) => {
      if (!m || !m.name) return;
      const tag = document.createElement('span');
      tag.className = i === 0 ? 'is-you' : '';
      tag.style.setProperty('--x', String(SPOTS[i]));
      const plateName = m.you ? nameplate(m.name) : { name: m.name, title: '', color: '' };
      if (plateName.title) {
        const badge = document.createElement('em');
        badge.className = 'br-title-tag';
        badge.textContent = plateName.title;
        badge.style.color = plateName.color;
        tag.style.color = plateName.color;
        tag.append(badge, document.createTextNode(' ' + plateName.name));
      } else tag.textContent = m.name;
      plate.appendChild(tag);
    });
  }

  function resize() {
    if (!renderer) return;
    const w = canvas.clientWidth | 0;
    const h = canvas.clientHeight | 0;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep the line-up framed on narrow canvases
      camera.position.z = Math.max(5.35, 6.15 / Math.min(1, camera.aspect / 0.75));
      camera.updateProjectionMatrix();
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
    turn.rotation.y = spin;
    for (const s of slots) if (s) s.ch.update(dt, { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: Math.PI, pitch: 0 });
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

  async function drawThumb(id) {
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
    let obj = null;
    let ch = null;
    if (c.kind === 'backbling' && c.def.none) return null;
    const ownCape = c.kind === 'backbling' && !c.def.src; // "outfit's own cape": the rogue from behind
    if (c.kind === 'skin' || c.kind === 'emote' || ownCape) {
      const def = skinDef(c.kind === 'skin' ? id : 'skin_rogue');
      const kit = await kitFor(def.model);
      ch = new Character(kit, { weapons: {}, tint: def.tint ?? undefined });
      const st = { fwd: 0, side: 0, speed: 0, grounded: true, gliding: false, heading: Math.PI, pitch: 0 };
      if (c.kind === 'emote') {
        ch.emote(true, id);
        for (let i = 0; i < 24; i++) ch.update(0.05, st); // into the move, fully faded in
      } else for (let i = 0; i < 4; i++) ch.update(0.05, st);
      obj = ch.root;
      obj.rotation.y = ownCape ? Math.PI * 0.82 : 0.35;
      tCam.position.set(0, 1.05, 3.9);
      tCam.lookAt(0, 0.88, 0);
    } else {
      const m = cosmeticMesh(id, weapons.pickaxe);
      if (!m) return null;
      obj = new THREE.Group();
      obj.add(m);
      m.position.set(0, 0, 0);
      m.quaternion.identity();
      if (c.kind === 'pickaxe') m.rotation.z = -0.65; // a jaunty diagonal
      else if (c.def.src && c.def.src[2] === 'back') m.rotation.y = 0.35; // shields / books: their face
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

  return {
    el: wrap,
    thumb(id) {
      if (!thumbs.has(id)) {
        const p = (thumbQ = thumbQ.then(() => drawThumb(id)).catch(() => null));
        thumbs.set(id, p);
      }
      return thumbs.get(id);
    },
    setMembers(list) {
      const next = (list || []).slice(0, SPOTS.length);
      const same =
        next.length === members.length &&
        next.every((m, i) => m.skin === members[i].skin && m.name === members[i].name && m.pickaxe === members[i].pickaxe && m.backbling === members[i].backbling);
      members = next;
      if (!same) build();
    },
    preview(id) {
      const was = [previewSkin, previewPick, previewBB].join();
      previewSkin = SKINS[id] ? id : null;
      previewPick = PICKAXES[id] ? id : null;
      previewBB = BACKBLINGS[id] ? id : null;
      if ([previewSkin, previewPick, previewBB].join() === was) return;
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
