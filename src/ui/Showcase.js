// BENTONVILLE ROYALE — lobby showcase: your outfit (and your party's) standing on the title
// screen in 3D, idling, emoting on request. Its own small renderer, drawn only while shown.
//
//   const sc = createShowcase(parentEl);
//   sc.setMembers([{ skin: 'skin_knight', name: 'You', you: true }, { skin, name }, ...])  // up to 4
//   sc.emote('emote_spin')      // the "you" character plays it (null stops)
//   sc.setActive(on)            // render loop on / off (title screen visible)
//   sc.preview(skinId|null)     // locker: try an outfit on without equipping (null = back)
//
// Drag to turn the line-up. Characters load lazily (the GLBs are shared with the match load).

import * as THREE from 'three';
import { loadGLB, loadJSON } from '../core/assets.js';
import { CharacterKit, Character } from '../game/Character.js';
import { skinDef } from '../game/Cosmetics.js';

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
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.35, 7.2);
  camera.lookAt(0, 0.95, 0);
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

  const slots = []; // { key, ch, holder, name }
  let members = [];
  let previewSkin = null;
  let emoteId = null;
  let active = false;
  let last = 0;
  let gen = 0;

  async function build() {
    const my = ++gen;
    const want = members.slice(0, SPOTS.length).map((m, i) => ({ ...m, skin: i === 0 && previewSkin ? previewSkin : m.skin }));
    // keep characters that did not change
    for (let i = 0; i < SPOTS.length; i++) {
      const w = want[i];
      const s = slots[i];
      const key = w ? skinDef(w.skin).model + '|' + skinDef(w.skin).tint : null;
      if (s && s.key === key) continue;
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
      const ch = new Character(kit, { weapons: {}, tint: def.tint ?? undefined });
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
      tag.textContent = m.name;
      tag.className = i === 0 ? 'is-you' : '';
      tag.style.setProperty('--x', String(SPOTS[i]));
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
      camera.position.z = Math.max(6.2, 7.2 / Math.min(1, camera.aspect / 0.75));
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

  return {
    el: wrap,
    setMembers(list) {
      const next = (list || []).slice(0, SPOTS.length);
      const same = next.length === members.length && next.every((m, i) => m.skin === members[i].skin && m.name === members[i].name);
      members = next;
      if (!same) build();
    },
    preview(skin) {
      if (previewSkin === skin) return;
      previewSkin = skin || null;
      build();
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
