// BENTONVILLE ROYALE — animated character (player and bots share this).
//
// The KayKit rig's clips are full-body. Each clip is split once into a lower
// half (root, hips, legs) and an upper half (spine, chest, head, arms), so
// legs can run while the arms aim, swing or drink.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { damp, clamp, WEAPONS } from '../core/config.js';
import { toToon } from '../render/Toon.js';

// Characters and their weapons are cel-shaded; colours get a small saturation lift.
const TOON_CHAR = { saturate: 1.2 };

// three's GLTFLoader strips dots from node names: "upperarm.l" -> "upperarml"
const UPPER = new Set(['spine', 'chest', 'head', 'upperarml', 'lowerarml', 'wristl', 'handl', 'handslotl', 'upperarmr', 'lowerarmr', 'wristr', 'handr', 'handslotr']);
const LOCO = ['idle', 'run', 'back', 'left', 'right', 'air'];
const LOCO_CLIP = { idle: 'Idle', run: 'Running_A', back: 'Walking_Backwards', left: 'Running_Strafe_Left', right: 'Running_Strafe_Right', air: 'Jump_Idle' };
const UPPER_CLIP = { aim2: '2H_Ranged_Aiming', aim1: '1H_Ranged_Aiming', shoot2: '2H_Ranged_Shoot', shoot1: '1H_Ranged_Shoot', swing: '2H_Melee_Attack_Chop', use: 'Use_Item', reload: '2H_Ranged_Reload' };
const FULL_CLIP = { death: 'Death_A', emote: 'Cheer' };
const HEIGHT = 1.8;
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
    for (const k in FULL_CLIP) {
      const c = byName.get(FULL_CLIP[k]);
      if (c) this.full[k] = c;
    }
  }
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Character {
  /**
   * @param {CharacterKit} kit
   * @param {{ weapons: Object<string, THREE.Object3D>, canopyColor?: number }} opts
   *        weapons: source scenes keyed by weapon id (+ 'pickaxe'); cloned here.
   */
  constructor(kit, opts = {}) {
    this.kit = kit;
    this.root = new THREE.Group();
    this.model = cloneSkinned(kit.scene);
    this.model.scale.setScalar(kit.scale);
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.material = toToon(o.material, TOON_CHAR); // cached per source: all clones share it
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
        g.scale.setScalar(0.62);
        g.position.set(0, 0.1, 0);
        const slot = this.bones.handslotr;
        (slot || this.gunPivot).add(g);
        this.pickaxe = g;
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
    this.equipped = 'pickaxe';
    this.gunKey = 'pickaxe';
    this.twoHanded = true;

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
    if (this.pickaxe) this.pickaxe.visible = id === 'pickaxe';
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

  swing() {
    this._oneShot('swing', 3.2);
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

  die() {
    if (this.mode === 'dead') return;
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
    this.canopy.visible = false;
  }

  emote(on) {
    if (this.mode === 'dead') return;
    const a = this.fullActions.emote;
    if (!a) return;
    if (on && this.mode !== 'emote') {
      this.mode = 'emote';
      a.reset();
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.setEffectiveWeight(1);
      a.play();
    } else if (!on && this.mode === 'emote') {
      this.mode = 'alive';
      a.setEffectiveWeight(0);
      a.stop();
    }
  }

  /** Back to a fresh, standing state (match restart). */
  reset() {
    this.mode = 'alive';
    for (const k in this.fullActions) {
      this.fullActions[k].stop();
      this.fullActions[k].setEffectiveWeight(0);
    }
    this.shot = null;
    this.shotW = 0;
    this.aim = 0;
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
    this.heading = s.heading;
    this.pitch = s.pitch || 0;
    this.root.rotation.y = Math.PI - s.heading;
    this.canopy.visible = !!s.gliding && this.mode !== 'dead';
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
    else if (s.speed < 0.4) ti = 1;
    else {
      const f = s.fwd;
      const sd = s.side;
      const sum = Math.abs(f) + Math.abs(sd) || 1;
      if (f >= 0) tr = f / sum;
      else tb = -f / sum;
      if (sd > 0) tg = sd / sum;
      else tl = -sd / sum;
    }
    const w = this.w;
    const k = 12;
    w.idle = damp(w.idle, ti, k, dt);
    w.run = damp(w.run, tr, k, dt);
    w.back = damp(w.back ?? 0, tb, k, dt);
    w.left = damp(w.left ?? 0, tl, k, dt);
    w.right = damp(w.right ?? 0, tg, k, dt);
    w.air = damp(w.air ?? 0, ta, k, dt);

    // upper-body override: aim pose while a gun is out, plus one-shots
    const wantAim = !full && this.equipped && this.equipped !== 'pickaxe' ? 1 : 0;
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
    const fullW = full ? 0 : 1;
    const over = Math.max(this.aim, this.shotW);
    const aimKey = this.twoHanded ? 'aim2' : 'aim1';
    for (const key in this.ov) {
      const a = this.ov[key];
      if (a === this.shot) a.setEffectiveWeight(this.shotW * fullW);
      else if (key === aimKey) a.setEffectiveWeight(this.aim * (1 - this.shotW) * fullW);
      else a.setEffectiveWeight(0);
    }
    const rate = clamp(s.speed / 6.6, 0.55, 1.45);
    for (const key of LOCO) {
      const lo = this.lo[key];
      if (!lo) continue;
      const wk = w[key] || 0;
      lo.setEffectiveWeight(wk * fullW);
      this.up[key].setEffectiveWeight(wk * (1 - over) * fullW);
      const ts = key === 'idle' || key === 'air' ? 1 : rate;
      lo.timeScale = ts;
      this.up[key].timeScale = ts;
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
    if (gun && hand && !dead) {
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
  }
}

export const CHARACTER_HEIGHT = HEIGHT;
void _q;
