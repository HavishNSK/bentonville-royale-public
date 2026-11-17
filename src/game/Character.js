// BENTONVILLE ROYALE — animated character (player and bots share this).
//
// The KayKit rig's clips are full-body. Each clip is split once into a lower
// half (root, hips, legs) and an upper half (spine, chest, head, arms), so
// legs can run while the arms aim, swing or drink.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { damp, clamp, WEAPONS, SWIM } from '../core/config.js';
import { toToon } from '../render/Toon.js';
import { emoteClips, emoteDef, pickaxeDef, backblingDef, swingClips } from './Cosmetics.js';
import { buildPaddle } from '../render/Paddle.js';
import { grenadeModel } from './Grenades.js';

// Characters and their weapons are cel-shaded; colours get a small saturation lift.
const TOON_CHAR = { saturate: 1.2 };

// three's GLTFLoader strips dots from node names: "upperarm.l" -> "upperarml"
const UPPER = new Set(['spine', 'chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr']);
const LOCO = ['idle', 'run', 'back', 'left', 'right', 'air'];
const LOCO_CLIP = { idle: 'Idle', run: 'Running_A', back: 'Walking_Backwards', left: 'Running_Strafe_Left', right: 'Running_Strafe_Right', air: 'Jump_Idle' };
const UPPER_CLIP = { aim2: '2H_Ranged_Aiming', aim1: '1H_Ranged_Aiming', shoot2: '2H_Ranged_Shoot', shoot1: '1H_Ranged_Shoot', swing: '2H_Melee_Attack_Chop', use: 'Use_Item', reload: '2H_Ranged_Reload' };
const FULL_CLIP = { death: 'Death_A', emote: 'Cheer' };
const HEIGHT = 1.8;
const GAIT_SECONDS = 0.8; // one run cycle at normal speed (all locomotion loops share its phase)
const GUN_SCALE = 1.45;

/** Per-model shared data: the source scene and the split clips. */
export class CharacterKit {
  constructor(gltf, info) {
    this.scene = gltf.scene;
    this.info = info;
    this.scale = HEIGHT / (info.heightUnits || 2.25);
    this.hide = new Set(info.hideMeshes || []);
    const byName = new Map(gltf.animations.map((c) => [c.name, c]));
    const part = (clip, upper, name) => {
      const tracks = clip.tracks.filter((t) => UPPER.has(t.name.slice(0, t.name.lastIndexOf('.'))) === upper);
      return new THREE.AnimationClip(name, clip.duration, tracks);
    };
    this.lower = {};
    this.upper = {};
    this.over = {};
    this.full = {};
    for (const k of LOCO) {
      const c = byName.get(LOCO_CLIP[k]);
      if (!c) continue;
      this.lower[k] = part(c, false, k + '_lo');
      this.upper[k] = part(c, true, k + '_up');
    }
    for (const k in UPPER_CLIP) {
      const c = byName.get(UPPER_CLIP[k]);
      if (c) this.over[k] = part(c, true, k);
    }
    // pickaxe swings (Cosmetics.PICKAXES[].swing), keyed 'sw:<clip>', each with the time scale
    // that makes it last as long as the classic chop (so every pickaxe hits at the same rate)
    this.swingScale = {};
    const chop = byName.get(UPPER_CLIP.swing);
    const want = chop ? chop.duration / 3.2 : 0.35;
    for (const name of swingClips()) {
      const c = byName.get(name);
      if (!c) continue;
      this.over['sw:' + name] = part(c, true, 'sw:' + name);
      this.swingScale[name] = c.duration / want;
    }
    for (const k in FULL_CLIP) {
      const c = byName.get(FULL_CLIP[k]);
      if (c) this.full[k] = c;
    }
    // every emote clip (Cosmetics.EMOTES), keyed 'e:<clip>'
    for (const name of emoteClips()) {
      const c = byName.get(name);
      if (c) this.full['e:' + name] = c;
    }
  }
}

// tinted outfits: one toon material per (shared source material, tint)
const _tinted = new WeakMap();
function tinted(mat, tint) {
  if (Array.isArray(mat)) return mat.map((m) => tinted(m, tint));
  let byTint = _tinted.get(mat);
  if (!byTint) _tinted.set(mat, (byTint = new Map()));
  let m = byTint.get(tint);
  if (!m) {
    m = mat.clone();
    m.color.multiply(new THREE.Color(tint));
    byTint.set(tint, m);
  }
  return m;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

// Every loaded CharacterKit by model key: pickaxes and back blings are cut from their scenes.
const KITS = {};
/** Game / Showcase register their kits so any Character can wear any kit's accessories. */
export function registerKits(kits) {
  for (const k in kits) if (kits[k]) KITS[k] = kits[k];
}

/** A toon-shaded copy of accessory `name` from kit `key` (local transform kept), or null. */
function accessory(key, name, tint) {
  const kit = KITS[key];
  const src = kit && kit.scene.getObjectByName(name);
  if (!src) return null;
  const g = src.clone(true);
  g.visible = true;
  g.traverse((o) => {
    o.visible = true;
    if (o.isMesh) {
      o.castShadow = true;
      o.material = toToon(o.material, TOON_CHAR);
      if (tint != null) o.material = tinted(o.material, tint);
    }
  });
  return g;
}
/**
 * A pickaxe / back bling on its own (shop thumbnails): a toon copy of its mesh, or null.
 * pickSrc: the classic pickaxe scene for src-less pickaxes.
 */
export function cosmeticMesh(id, pickSrc) {
  const pk = PICKAXES_ID.test(id) ? pickaxeDef(id) : null;
  const bb = !pk ? backblingDef(id) : null;
  const def = pk || bb;
  if (!def) return null;
  if (def.src) return accessory(def.src[0], def.src[1], def.tint);
  if (pk && pk.proc) return proceduralPickaxe(pk.proc);
  if (pk && pickSrc) {
    const g = pickSrc.clone(true);
    g.traverse((o) => {
      if (o.isMesh) {
        o.material = toToon(o.material, TOON_CHAR);
        if (def.tint != null) o.material = tinted(o.material, def.tint);
      }
    });
    return g;
  }
  return null;
}
const PICKAXES_ID = /^pick_/;

/** Pickaxes built in code (Cosmetics PICKAXES[id].proc), toon-shaded like the kit meshes. */
function proceduralPickaxe(kind) {
  if (kind !== 'paddle') return null;
  return buildPaddle((color) => toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), TOON_CHAR));
}

// a hand item moved onto the back (chest bone frame: +Y up the spine, +Z forward)
const BACK_POSE = {
  Round_Shield: { p: [0, 0.18, -0.42], r: [0, Math.PI, 0], s: 0.75 },
  Spike_Shield: { p: [0, 0.18, -0.42], r: [0, Math.PI, 0], s: 0.72 },
  Badge_Shield: { p: [0, 0.18, -0.42], r: [0, Math.PI, 0], s: 0.75 },
  Spellbook: { p: [0, 0.15, -0.42], r: [0, Math.PI / 2, 0], s: 1 },
};

export class Character {
  /**
   * @param {CharacterKit} kit
   * @param {{ weapons: Object<string, THREE.Object3D>, canopyColor?: number, tint?: number }} opts
   *        weapons: source scenes keyed by weapon id (+ 'pickaxe'); cloned here.
   *        tint: outfit colour multiplied into the body texture (Cosmetics.SKINS).
   */
  constructor(kit, opts = {}) {
    this.kit = kit;
    this.root = new THREE.Group();
    this.model = cloneSkinned(kit.scene);
    this.model.scale.setScalar(kit.scale);
    this.root.add(this.model);
    this._modelPos = this.model.position.clone();
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.material = toToon(o.material, TOON_CHAR); // cached per source: all clones share it
        if (opts.tint != null) o.material = tinted(o.material, opts.tint);
        o.frustumCulled = false; // skinned bounds are unreliable; the Group is culled by distance instead
        if (kit.hide.has(o.name)) o.visible = false;
      }
    });

    this.mixer = new THREE.AnimationMixer(this.model);
    this.lo = {};
    this.up = {};
    this.w = {};
    for (const k of LOCO) {
      if (!kit.lower[k]) continue;
      this.lo[k] = this.mixer.clipAction(kit.lower[k]);
      this.up[k] = this.mixer.clipAction(kit.upper[k]);
      this.lo[k].play();
      this.up[k].play();
      this.w[k] = k === 'idle' ? 1 : 0;
    }
    this.ov = {};
    for (const k in kit.over) {
      if (k.startsWith('sw:')) continue; // pickaxe swings: created on first use (swing())
      const a = this.mixer.clipAction(kit.over[k]);
      a.play();
      a.setEffectiveWeight(0);
      this.ov[k] = a;
    }
    this.fullActions = {};
    for (const k in kit.full) {
      const a = this.mixer.clipAction(kit.full[k]);
      a.setEffectiveWeight(0);
      this.fullActions[k] = a;
    }

    // weapons: guns ride on the root and are aimed in code; the pickaxe sits in the hand
    this.guns = {};
    this.gunPivot = new THREE.Group();
    this.model.add(this.gunPivot);
    const src = opts.weapons || {};
    for (const id in src) {
      if (!src[id]) continue;
      const g = src[id].clone(true);
      g.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.material = toToon(o.material, TOON_CHAR);
        }
      });
      if (id === 'pickaxe') {
        this._pickSrc = src[id]; // the classic pickaxe (setLoadout)
      } else {
        const holder = new THREE.Group();
        g.rotation.y = Math.PI; // model barrel is -Z; the character faces +Z
        g.scale.setScalar(GUN_SCALE);
        g.position.set(0, 0.02, 0.22);
        holder.add(g);
        holder.visible = false;
        this.gunPivot.add(holder);
        this.guns[id] = holder;
      }
    }
    // a grenade held in the right hand while its slot is selected
    const gm = grenadeModel();
    this.grenade = new THREE.Mesh(gm.geometry, gm.material);
    this.grenade.castShadow = true;
    this.grenade.scale.setScalar(1.5);
    this.grenade.position.set(0, 0.1, 0);
    this.grenade.visible = false;
    (this.bones.handslotr || this.gunPivot).add(this.grenade);
    this.equipped = 'pickaxe';
    this.gunKey = 'pickaxe';
    this.twoHanded = true;
    this.pickaxe = null;
    this._backItem = null;
    this.pickaxeId = null;
    this.backblingId = null;
    this.setLoadout({ pickaxe: opts.pickaxe || 'pick_default', backbling: opts.backbling || 'bb_outfit' });

    // a simple canopy shown while gliding in
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 14, 5, 0, Math.PI * 2, 0, Math.PI / 2.4),
      toToon(new THREE.MeshLambertMaterial({ color: opts.canopyColor ?? 0xff7a45, side: THREE.DoubleSide }))
    );
    canopy.scale.set(1, 0.55, 1);
    canopy.position.y = 2.6;
    canopy.visible = false;
    this.root.add(canopy);
    this.canopy = canopy;

    // knocked (team modes): a pulsing red ring on the ground under the crawling body (its own
    // material: the toon materials above are shared by every clone and must not be tinted)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    ring.visible = false;
    ring.renderOrder = 2;
    this.root.add(ring);
    this.downRing = ring;
    this.downed = false;
    this._down = 0; // 0..1 blend into the prone pose
    this.swimming = false; // setSwim(): sunk to the chest, hands (and what they hold) hidden
    this._swim = 0;
    this._downClock = 0;

    this.heading = 0;
    this.pitch = 0;
    this.aim = 0; // 0..1 how much the upper body is in the aim pose
    this.shot = null; // one-shot upper action in progress
    this.shotW = 0;
    this.mode = 'alive'; // 'alive' | 'dead' | 'emote'
    this.animate = true;
    this._muzzle = new THREE.Vector3();
  }

  setEquipped(id, twoHanded = true) {
    if (id === this.equipped) return;
    this.equipped = id;
    this.twoHanded = twoHanded;
    // several guns share one mesh (WEAPONS[id].model), e.g. burst rifle -> rifle
    this.gunKey = WEAPONS[id] && this.guns[WEAPONS[id].model] ? WEAPONS[id].model : id;
    for (const k in this.guns) this.guns[k].visible = k === this.gunKey;
    if (this.pickaxe) this.pickaxe.visible = id === 'pickaxe' && this._swim < 0.5;
    this.grenade.visible = id === 'grenade' && this._swim < 0.5;
  }

  _oneShot(key, speed = 1) {
    const a = this.ov[key];
    if (!a) return;
    if (this.shot && this.shot !== a) this.shot.setEffectiveWeight(0);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    a.play();
    this.shot = a;
    this.shotLeft = a.getClip().duration / speed;
  }

  fire() {
    this._oneShot(this.twoHanded ? 'shoot2' : 'shoot1', 2.6);
  }

  /** One pickaxe hit: the next move of this pickaxe's combo (Cosmetics swing list). */
  swing() {
    const list = pickaxeDef(this.pickaxeId).swing;
    const n = this._swingN || 0;
    this._swingN = n + 1;
    const clip = list && list.length ? list[n % list.length] : null;
    const key = clip && 'sw:' + clip;
    if (key && !this.ov[key] && this.kit.over[key]) {
      const a = this.mixer.clipAction(this.kit.over[key]);
      a.play();
      a.setEffectiveWeight(0);
      this.ov[key] = a;
    }
    if (key && this.ov[key]) this._oneShot(key, this.kit.swingScale[clip] || 3.2);
    else this._oneShot('swing', 3.2);
  }

  useItem(seconds) {
    const a = this.ov.use;
    if (a) this._oneShot('use', a.getClip().duration / Math.max(0.3, seconds));
  }

  reload(seconds) {
    const a = this.ov.reload;
    if (a) this._oneShot('reload', a.getClip().duration / Math.max(0.3, seconds));
  }

  cancelOneShot() {
    this.shotLeft = 0;
  }

  /** Knocked: low prone crawl pose, weapons away, red ring underneath. Idempotent. */
  setDowned(on) {
    on = !!on && this.mode !== 'dead';
    if (on === this.downed) return;
    this.downed = on;
    if (on && this.mode === 'emote') this.emote(false);
    for (const k in this.guns) this.guns[k].visible = !on && k === this.gunKey;
    if (this.pickaxe) this.pickaxe.visible = !on && this.equipped === 'pickaxe';
    if (on) this.cancelOneShot();
  }

  /** Swimming: the body sinks to the chest and the held item is hidden. Idempotent. */
  setSwim(on) {
    this.swimming = !!on;
  }

  die() {
    if (this.mode === 'dead') return;
    if (this._emA) {
      this._emFade = this._emA; // stopped by update() as the death pose takes over
      this._emA = this._emHold = null;
    }
    this.mode = 'dead';
    const a = this.fullActions.death;
    if (a) {
      a.reset();
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      a.setEffectiveWeight(1);
      a.play();
    }
    for (const k in this.guns) this.guns[k].visible = false;
    if (this.pickaxe) this.pickaxe.visible = false;
    this.grenade.visible = false;
    this.canopy.visible = false;
    this.downed = false;
    this.downRing.visible = false;
  }

  /**
   * Starts (on) or stops an emote. id: a Cosmetics.EMOTES id (default: the cheer). A new id
   * while already emoting switches to it.
   */
  /**
   * Pickaxe (Cosmetics.PICKAXES id) in the right hand and back bling (BACKBLINGS id) on the
   * chest; swapped in place (no rebuild), keeping whether the pickaxe is currently shown.
   */
  setLoadout({ pickaxe, backbling } = {}) {
    if (pickaxe && pickaxe !== this.pickaxeId) {
      const def = pickaxeDef(pickaxe);
      let g = null;
      if (def.src) g = accessory(def.src[0], def.src[1], def.tint);
      else if (def.proc) g = proceduralPickaxe(def.proc);
      else if (this._pickSrc) {
        g = this._pickSrc.clone(true);
        g.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.material = toToon(o.material, TOON_CHAR);
            if (def.tint != null) o.material = tinted(o.material, def.tint);
          }
        });
        g.scale.setScalar(0.62);
        g.position.set(0, 0.1, 0);
      }
      const shown = this.pickaxe ? this.pickaxe.visible : this.equipped === 'pickaxe' && this.mode !== 'emote';
      if (this.pickaxe && this.pickaxe.parent) this.pickaxe.parent.remove(this.pickaxe);
      this.pickaxe = g;
      if (g) {
        g.visible = shown;
        (this.bones.handslotr || this.gunPivot).add(g);
      }
      this.pickaxeId = pickaxe;
    }
    if (backbling && backbling !== this.backblingId) {
      const def = backblingDef(backbling);
      if (this._backItem && this._backItem.parent) this._backItem.parent.remove(this._backItem);
      this._backItem = null;
      // the outfit's own cape shows only with 'bb_outfit'
      const own = !def.src && !def.none;
      this.model.traverse((o) => {
        if (o.isMesh && !o.isSkinnedMesh && (/_Cape/.test(o.name) || (o.parent && /_Cape/.test(o.parent.name)))) o.visible = own;
      });
      if (def.src) {
        const [key, name, slot] = def.src;
        const g = accessory(key, name, def.tint);
        const chest = this.bones.chest;
        if (g && chest) {
          const pose = slot === 'back' && BACK_POSE[name];
          if (pose) {
            g.position.set(...pose.p);
            g.rotation.set(...pose.r);
            g.scale.setScalar(pose.s);
          }
          chest.add(g);
          this._backItem = g;
        }
      }
      this.backblingId = backbling;
    }
  }

  emote(on, id = null) {
    if (this.mode === 'dead') return;
    if (!on) {
      if (this.mode !== 'emote') return;
      this.mode = 'alive';
      // the playing clip fades out in update(); any other part stops now
      for (const a of [this._emA, this._emHold]) if (a && a !== this._emA) a.stop();
      if (this._emFade && this._emFade !== this._emA) this._emFade.stop();
      this._emFade = this._emA;
      this._emA = this._emHold = null;
      for (const k in this.guns) this.guns[k].visible = !this.downed && k === this.gunKey;
      if (this.pickaxe) this.pickaxe.visible = !this.downed && this.equipped === 'pickaxe';
      return;
    }
    const def = emoteDef(id);
    const a = (def && this.fullActions['e:' + def.clip]) || this.fullActions.emote;
    if (!a) return;
    if (this.mode === 'emote' && this._emA === a) return;
    if (this.mode === 'emote') {
      this.emote(false);
      if (this._emFade) {
        this._emFade.stop();
        this._emFade = null;
      }
    }
    this.mode = 'emote';
    this.emoteId = id;
    const hold = def && def.hold ? this.fullActions['e:' + def.hold] : null;
    a.reset();
    if (hold || (def && def.once)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.setEffectiveWeight(this._fw || 0); // update() fades it in
    a.play();
    this._emA = a;
    this._emHold = hold;
    this._emHoldOn = false;
    // hands free while dancing
    for (const k in this.guns) this.guns[k].visible = false;
    if (this.pickaxe) this.pickaxe.visible = false;
  }

  /** Two-part emotes (sit down -> sitting): switch to the loop once the intro has played. */
  _emoteTick() {
    if (this.mode !== 'emote' || !this._emHold || this._emHoldOn) return;
    const a = this._emA;
    if (a.time < a.getClip().duration - 0.02) return;
    this._emHoldOn = true;
    a.setEffectiveWeight(0);
    a.stop();
    const h = this._emHold;
    h.reset();
    h.setLoop(THREE.LoopRepeat, Infinity);
    h.setEffectiveWeight(this._fw || 1);
    h.play();
    this._emA = h;
  }

  /** Back to a fresh, standing state (match restart). */
  reset() {
    this.mode = 'alive';
    this._emA = this._emHold = this._emFade = null;
    this._fw = 0;
    for (const k in this.fullActions) {
      this.fullActions[k].stop();
      this.fullActions[k].setEffectiveWeight(0);
    }
    this.shot = null;
    this.shotW = 0;
    this.aim = 0;
    this.downed = false;
    this._down = 0;
    this.downRing.visible = false;
    this.model.rotation.x = 0;
    this.model.position.copy(this._modelPos);
    const eq = this.equipped;
    this.equipped = null;
    this.setEquipped(eq || 'pickaxe', this.twoHanded);
    this.root.visible = true;
  }

  /**
   * @param {number} dt
   * @param {{ fwd:number, side:number, speed:number, grounded:boolean, gliding:boolean, heading:number, pitch:number }} s
   *        fwd/side: movement relative to facing, -1..1 (side > 0 = moving to the character's right)
   */
  update(dt, s) {
    this._emoteTick();
    this.heading = s.heading;
    this.pitch = damp(this.pitch, s.pitch || 0, 18, dt);
    // body yaw eases toward the heading (shortest way round): no snapping when a bot or a
    // remote player's heading arrives in steps
    if (this._yaw == null) this._yaw = s.heading;
    let dy = s.heading - this._yaw;
    dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
    this._yaw += Math.abs(dy) > 2.6 ? dy : dy * (1 - Math.exp(-20 * dt));
    this.root.rotation.y = Math.PI - this._yaw;
    this.canopy.visible = !!s.gliding && this.mode !== 'dead';
    // prone blend (runs even when the skeleton is not animated this frame)
    const downT = this.downed ? 1 : 0;
    if (this._down !== downT || this.downed) {
      this._down = damp(this._down, downT, 8, dt);
      if (Math.abs(this._down - downT) < 0.002) this._down = downT;
      // tip forward around the feet and slide back so the body lies over the actor's position
      this.model.rotation.x = this._down * 1.32;
      this.model.position.set(this._modelPos.x, this._modelPos.y + this._down * 0.22, this._modelPos.z - this._down * 0.8);
      this._downClock += dt;
      this.downRing.visible = this.downed;
      if (this.downed) this.downRing.material.opacity = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(this._downClock * 6));
    }
    // swim sink (also runs when the skeleton is not animated this frame)
    const swimT = this.swimming && this.mode !== 'dead' && !this.downed ? 1 : 0;
    if (this._swim !== swimT) {
      this._swim = damp(this._swim, swimT, 7, dt);
      if (Math.abs(this._swim - swimT) < 0.002) this._swim = swimT;
      this.model.position.y = this._modelPos.y + this._down * 0.22 - this._swim * SWIM.sink;
      const dry = this._swim < 0.5;
      this.gunPivot.visible = dry;
      if (this.pickaxe) this.pickaxe.visible = dry && this.equipped === 'pickaxe' && this.mode !== 'emote';
      if (this.grenade) this.grenade.visible = dry && this.equipped === 'grenade';
    }
    if (!this.animate) return;

    const dead = this.mode === 'dead';
    const full = this.mode !== 'alive';

    // locomotion blend targets
    let ti = 0;
    let tr = 0;
    let tb = 0;
    let tl = 0;
    let tg = 0;
    let ta = 0;
    if (!s.grounded) ta = 1;
    else {
      // idle <-> moving fades with speed instead of flipping at a threshold
      const move = clamp((s.speed - 0.25) / 1.6, 0, 1);
      ti = 1 - move;
      if (move > 0) {
        const f = s.fwd;
        const sd = s.side;
        const sum = Math.abs(f) + Math.abs(sd) || 1;
        if (f >= 0) tr = (f / sum) * move;
        else tb = (-f / sum) * move;
        if (sd > 0) tg = (sd / sum) * move;
        else tl = (-sd / sum) * move;
        if (tr + tb + tg + tl < 1e-3) tr = move;
      }
    }
    const w = this.w;
    const k = 10;
    w.idle = damp(w.idle, ti, k, dt);
    w.run = damp(w.run, tr, k, dt);
    w.back = damp(w.back ?? 0, tb, k, dt);
    w.left = damp(w.left ?? 0, tl, k, dt);
    w.right = damp(w.right ?? 0, tg, k, dt);
    w.air = damp(w.air ?? 0, ta, k, dt);

    // upper-body override: aim pose while a gun is out, plus one-shots
    const wantAim = !full && !this.downed && this.equipped && this.equipped !== 'pickaxe' ? 1 : 0;
    this.aim = damp(this.aim, wantAim, 14, dt);
    let shotTarget = 0;
    if (this.shot) {
      this.shotLeft -= dt;
      shotTarget = this.shotLeft > 0.08 ? 1 : 0;
      if (this.shotLeft <= -0.2) {
        this.shot.setEffectiveWeight(0);
        this.shot = null;
      }
    }
    this.shotW = damp(this.shotW, shotTarget, 22, dt);
    // full-body actions (emote / death) cross-fade in and out instead of popping
    this._fw = damp(this._fw || 0, full ? 1 : 0, dead ? 14 : 9, dt);
    if (this._fw > 0.999) this._fw = 1;
    const fullW = 1 - this._fw;
    const fa = dead ? this.fullActions.death : this._emA;
    if (fa) fa.setEffectiveWeight(this._fw);
    if (this._emFade) {
      // an emote that just ended fades with the blend, then stops
      this._emFade.setEffectiveWeight(Math.max(0, this._fw));
      if (this._fw < 0.01 || full) {
        if (!full || this._emFade !== this._emA) this._emFade.stop();
        this._emFade = null;
      }
    }
    const over = Math.max(this.aim, this.shotW);
    const aimKey = this.twoHanded ? 'aim2' : 'aim1';
    for (const key in this.ov) {
      const a = this.ov[key];
      if (a === this.shot) a.setEffectiveWeight(this.shotW * fullW);
      else if (key === aimKey) a.setEffectiveWeight(this.aim * (1 - this.shotW) * fullW);
      else a.setEffectiveWeight(0);
    }
    const rateT = this.downed ? 0.45 : clamp(s.speed / 6.6, 0.55, 1.45);
    this._rate = damp(this._rate || rateT, rateT, 8, dt);
    // run / backpedal / strafes share one gait phase so blending between them never makes
    // the feet slide or stutter
    const gait = this.lo.run ? this.lo.run.getClip().duration : GAIT_SECONDS;
    this._phase = ((this._phase || 0) + (dt * this._rate) / gait) % 1;
    for (const key of LOCO) {
      const lo = this.lo[key];
      if (!lo) continue;
      const wk = w[key] || 0;
      lo.setEffectiveWeight(wk * fullW);
      this.up[key].setEffectiveWeight(wk * (1 - over) * fullW);
      if (key === 'idle' || key === 'air') {
        lo.timeScale = 1;
        this.up[key].timeScale = 1;
      } else {
        const d = lo.getClip().duration;
        lo.timeScale = 0;
        this.up[key].timeScale = 0;
        lo.time = this._phase * d;
        this.up[key].time = this._phase * d;
      }
    }

    this.mixer.update(dt);

    if (!dead && this.aim > 0.02) {
      // lean the torso with the aim pitch
      const lean = -this.pitch * 0.45 * this.aim;
      if (this.bones.spine) this.bones.spine.rotateX(lean);
      if (this.bones.chest) this.bones.chest.rotateX(lean);
    }

    // keep the gun in the right hand, pointing exactly where the character aims
    const hand = this.bones.handslotr || this.bones.handr;
    const gun = this.guns[this.gunKey];
    if (gun && hand && !dead && !this.downed) {
      this.model.updateWorldMatrix(true, false);
      hand.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(hand.matrixWorld);
      this.model.worldToLocal(_v);
      this.gunPivot.position.copy(_v);
      this.gunPivot.rotation.set(-this.pitch, 0, 0);
    }
  }

  /** World position of the equipped gun's muzzle (or the chest when unarmed). */
  muzzle(out = this._muzzle) {
    const gun = this.guns[this.gunKey];
    if (gun) {
      this.root.updateWorldMatrix(true, true);
      out.set(0, 0.06, 0.85).applyMatrix4(gun.matrixWorld);
    } else {
      out.copy(this.root.position);
      out.y += 1.3;
    }
    return out;
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
    this.canopy.geometry.dispose();
    this.canopy.material.dispose();
    this.downRing.geometry.dispose();
    this.downRing.material.dispose();
  }
}

export const CHARACTER_HEIGHT = HEIGHT;
void _q;
