// BENTONVILLE ROYALE — explosives: thrown grenades (arc, bounces, fuse, blast) and the
// Rocket Launcher's rockets (straight flight, blast on impact).
//
//   const grenades = new Grenades({ scene, world, combat, structures, fx, sfx });
//   grenades.throw(owner, origin, dir)   // one grenade from `origin` along `dir` (see GRENADE in config.js)
//   grenades.update(dt)                  // every frame
//   grenades.preview(origin, dir)        // aim arc for the local player; preview(null) hides it
//   grenades.clear()
//   grenades.fireRocket(owner, muzzle, origin, dir, damage)   // Rocket Launcher (see ROCKET in config.js)
//
// A rocket leaves the muzzle toward whatever the aim ray (origin, dir) is on, flies straight
// and explodes on the first thing it touches: full `damage` for a clean hit, fading to
// ROCKET.minDamage at the edge of ROCKET.radius, ROCKET.structureDamage to builds and props.
//
// A grenade flies under gravity, bounces off the ground, buildings, props, built pieces
// and characters, and explodes when its fuse (started at the throw) runs out. The blast
// deals GRENADE.damage to every character within GRENADE.radius that it has a clear line
// to (the thrower included; walls give cover), and GRENADE.structureDamage to built
// pieces, building wall and floor panels, trees, rocks and props in range.
//
// Multiplayer: the host simulates and explodes them (onThrow / onExplode feed its event
// stream). A client (`combat.authoritative === false`) draws the same flight from
// spawn(id, owner, pos, vel) and waits for explodeAt(id, pos); it never applies damage.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toToon } from '../render/Toon.js';
import { GRENADE, ROCKET, PLAYER } from '../core/config.js';

const UP_BIAS = 0.35; // m the blast origin is lifted off the surface it rests on
const PREVIEW_STEP = 0.05; // s per arc segment
const PREVIEW_POINTS = 48;
const CLIENT_LINGER = 1.5; // s a client keeps a spent grenade while waiting for the host's blast

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

let _model = null;
/**
 * The grenade mesh parts: { geometry, material[] }, centred on the body. Shared by the
 * projectiles here and the floor pickups in Loot.js. `grounded` returns a copy standing
 * on y = 0 instead.
 */
export function grenadeModel(grounded = false) {
  if (!_model) {
    const body = new THREE.SphereGeometry(0.1, 14, 10);
    body.scale(1, 1.18, 1);
    const band = new THREE.CylinderGeometry(0.104, 0.104, 0.035, 14);
    const neck = new THREE.CylinderGeometry(0.045, 0.055, 0.07, 10);
    neck.translate(0, 0.14, 0);
    const lever = new THREE.BoxGeometry(0.03, 0.15, 0.022);
    lever.rotateZ(-0.5);
    lever.translate(0.075, 0.1, 0);
    const ring = new THREE.TorusGeometry(0.035, 0.008, 6, 12);
    ring.translate(-0.07, 0.15, 0);
    const geometry = mergeGeometries([mergeGeometries([body]), mergeGeometries([band, neck, lever, ring])], true);
    geometry.computeBoundingBox();
    const material = [
      toToon(new THREE.MeshStandardMaterial({ color: 0x4d6b3c, roughness: 0.8 }), { saturate: 1.15 }),
      toToon(new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.5 }), { saturate: 1.1 }),
    ];
    _model = { geometry, material };
  }
  if (!grounded) return _model;
  const geometry = _model.geometry.clone();
  geometry.translate(0, 0.118, 0);
  geometry.computeBoundingBox();
  return { geometry, material: _model.material };
}

let _rocket = null;
/** The rocket mesh parts: { geometry, material[] }, nose toward +Z, centred on the body. */
export function rocketModel() {
  if (!_rocket) {
    const body = new THREE.CylinderGeometry(0.06, 0.06, 0.42, 10);
    const tail = new THREE.CylinderGeometry(0.035, 0.06, 0.1, 10);
    tail.translate(0, -0.26, 0);
    const fins = [];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.BoxGeometry(0.012, 0.14, 0.11);
      f.translate(0, -0.18, 0.09);
      f.rotateY((i * Math.PI) / 2);
      fins.push(f);
    }
    const nose = new THREE.ConeGeometry(0.075, 0.2, 10);
    nose.translate(0, 0.31, 0);
    const geometry = mergeGeometries([mergeGeometries([body, tail, ...fins]), mergeGeometries([nose])], true);
    geometry.rotateX(Math.PI / 2); // +Y -> +Z
    const material = [
      toToon(new THREE.MeshStandardMaterial({ color: 0x8a94a3, roughness: 0.6 }), { saturate: 1.1 }),
      toToon(new THREE.MeshStandardMaterial({ color: 0xe04a3a, roughness: 0.6 }), { saturate: 1.15 }),
    ];
    _rocket = { geometry, material };
  }
  return _rocket;
}

/**
 * The Rocket Launcher as a scene (there is no .glb for it): barrel toward -Z like the gun
 * models, about a rifle long. Plain materials; the character / loot code toons them.
 */
export function launcherModel() {
  const g = new THREE.Group();
  g.name = 'rocket_launcher';
  const mat = (color, roughness = 0.7) => new THREE.MeshStandardMaterial({ color, roughness });
  const olive = mat(0x5f7a48);
  const dark = mat(0x33363d, 0.6);
  const add = (geo, m, x, y, z, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    g.add(mesh);
    return mesh;
  };
  const H = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.075, 0.075, 1.0, 12), olive, 0, 0.05, -0.05, H); // tube
  add(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 12), dark, 0, 0.05, -0.5, H); // muzzle ring
  add(new THREE.CylinderGeometry(0.085, 0.12, 0.2, 12), dark, 0, 0.05, 0.53, H); // flared exhaust
  add(new THREE.ConeGeometry(0.068, 0.2, 10), mat(0xe04a3a, 0.6), 0, 0.05, -0.64, -H); // loaded rocket's nose
  add(new THREE.BoxGeometry(0.05, 0.2, 0.07), dark, 0, -0.1, 0.05, 0.25); // grip
  add(new THREE.BoxGeometry(0.05, 0.14, 0.06), dark, 0, -0.08, -0.25, 0); // fore grip
  add(new THREE.BoxGeometry(0.05, 0.08, 0.16), dark, 0, 0.16, -0.1, 0); // sight
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12), mat(0xd9b23c, 0.5), 0, 0.05, 0.3, H); // band
  return g;
}

/** Launch velocity for a throw along `dir` (unit). */
export function throwVelocity(dir, out = new THREE.Vector3()) {
  out.copy(dir).normalize().multiplyScalar(GRENADE.speed);
  out.y += GRENADE.lift;
  return out;
}

export class Grenades {
  constructor({ scene, world, combat, structures = null, fx = null, sfx = null }) {
    this.scene = scene;
    this.world = world;
    this.combat = combat;
    this.structures = structures;
    this.fx = fx;
    this.sfx = sfx;
    this.list = [];
    this._pool = [];
    this._rpool = []; // rocket meshes
    this._nextId = 1;
    this.onThrow = null; // (grenade) => {}   host: replicate the throw
    this.onExplode = null; // (grenade) => {} host: replicate the blast

    this.group = new THREE.Group();
    this.group.name = 'grenades';
    if (scene) scene.add(this.group);

    // aim arc + landing ring (local player only)
    const arc = new THREE.BufferGeometry();
    arc.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_POINTS * 3), 3));
    this._arc = new THREE.Line(arc, new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.85, depthWrite: false, fog: false }));
    this._arc.frustumCulled = false;
    this._arc.visible = false;
    // dots along the same points: a 1 px line alone is hard to see against the sky
    const dots = new THREE.Points(arc, new THREE.PointsMaterial({ color: 0xffffff, size: 5, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
    dots.frustumCulled = false;
    this._arc.add(dots);
    const ring = new THREE.RingGeometry(0.32, 0.42, 24);
    ring.rotateX(-Math.PI / 2);
    this._mark = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xff6a3d, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this._mark.visible = false;
    this.group.add(this._arc, this._mark);
  }

  get authoritative() {
    return !this.combat || this.combat.authoritative !== false;
  }

  // ---------------------------------------------------------------- spawn

  /** Throws one grenade. `dir` need not be normalised. Returns the grenade. */
  throw(owner, origin, dir) {
    const g = this.spawn(this._nextId++, owner, origin, throwVelocity(dir, _v));
    if (this.sfx) this.sfx.play('grenade_throw', { x: origin.x, y: origin.y, z: origin.z, volume: 0.7 });
    if (this.onThrow) this.onThrow(g);
    return g;
  }

  /** Adds a grenade already in flight (a client replays the host's throw with this). */
  spawn(id, owner, pos, vel) {
    const m = grenadeModel();
    const mesh = this._pool.pop() || new THREE.Mesh(m.geometry, m.material);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    mesh.visible = true;
    this.group.add(mesh);
    const g = {
      id,
      owner: owner || null,
      pos: new THREE.Vector3().copy(pos),
      vel: new THREE.Vector3().copy(vel),
      fuse: GRENADE.fuse,
      age: 0,
      resting: false,
      spent: false,
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      mesh,
      beepAt: 0,
    };
    this.list.push(g);
    return g;
  }

  // ---------------------------------------------------------------- rockets

  /**
   * Fires a rocket from `muzzle` at whatever the aim ray (origin, dir) is on. `damage`: a
   * clean hit. Returns the rocket.
   */
  fireRocket(owner, muzzle, origin, dir, damage) {
    const w = this.world;
    _d.copy(dir).normalize();
    let t = 300;
    const hit = w.raycast(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, t, null);
    if (hit) t = hit.t;
    const ah = this.combat ? this.combat.rayActors(origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, t, owner) : null;
    if (ah) t = ah.t;
    _p.copy(origin).addScaledVector(_d, t); // what the crosshair is on
    // leave from the muzzle, unless that pokes through a wall we are hugging
    const start = _s.copy(muzzle);
    if (owner && owner.pos) {
      const cx = owner.pos.x, cy = owner.pos.y + 1.3, cz = owner.pos.z;
      _v.set(start.x - cx, start.y - cy, start.z - cz);
      const len = _v.length();
      if (len > 1e-3 && w.raycast(cx, cy, cz, _v.x / len, _v.y / len, _v.z / len, len + ROCKET.size, null)) start.set(cx, cy, cz);
    }
    _v.copy(_p).sub(start);
    if (_v.lengthSq() < 2.25) _v.copy(_d); // point blank: straight along the aim
    _v.normalize().multiplyScalar(ROCKET.speed);
    const g = this.spawnRocket(this._nextId++, owner, start, _v, damage);
    if (this.onThrow) this.onThrow(g);
    return g;
  }

  /** Adds a rocket already in flight (a client replays the host's launch with this). */
  spawnRocket(id, owner, pos, vel, damage = 100) {
    const m = rocketModel();
    const mesh = this._rpool.pop() || new THREE.Mesh(m.geometry, m.material);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    mesh.lookAt(pos.x + vel.x, pos.y + vel.y, pos.z + vel.z);
    mesh.visible = true;
    this.group.add(mesh);
    const g = {
      id,
      rocket: true,
      owner: owner || null,
      pos: new THREE.Vector3().copy(pos),
      vel: new THREE.Vector3().copy(vel),
      damage,
      fuse: ROCKET.life,
      age: 0,
      resting: false,
      spent: false,
      trailAt: 0,
      mesh,
    };
    this.list.push(g);
    return g;
  }

  /** One frame of a rocket. Returns true when it left the list. */
  _updateRocket(g, dt, auth) {
    g.age += dt;
    g.fuse -= dt;
    if (g.spent) {
      // client: waiting for the host's blast
      if (g.fuse < -CLIENT_LINGER) this._remove(g);
      return;
    }
    let boom = g.fuse <= 0;
    let direct = null;
    const speed = g.vel.length();
    const dist = speed * dt;
    if (!boom && dist > 1e-5) {
      const w = this.world;
      const p = g.pos;
      _d.copy(g.vel).multiplyScalar(1 / speed);
      const hit = w.raycast(p.x, p.y, p.z, _d.x, _d.y, _d.z, dist + ROCKET.size, null);
      let t = hit ? hit.t : Infinity;
      const ah = this.combat ? this.combat.rayActors(p.x, p.y, p.z, _d.x, _d.y, _d.z, Math.min(t, dist + ROCKET.size), g.owner) : null;
      if (ah) {
        t = ah.t;
        direct = ah.actor;
      }
      if (t < Infinity) {
        p.addScaledVector(_d, Math.max(0, t - 0.05));
        boom = true;
      } else {
        p.addScaledVector(_d, dist);
        if (w.terrainHeight && p.y < w.terrainHeight(p.x, p.z) + ROCKET.size) boom = true;
      }
      g.mesh.position.copy(p);
      if (this.fx && this.fx.rocketTrail && g.age >= g.trailAt) {
        g.trailAt = g.age + 0.03;
        this.fx.rocketTrail(_v.copy(p).addScaledVector(_d, -0.35));
      }
    }
    if (!boom) return;
    if (auth) {
      this._remove(g);
      this._explode(g, direct);
    } else {
      // client: the host decides where it goes off
      g.spent = true;
      g.fuse = 0;
      g.mesh.visible = false;
    }
  }

  clear() {
    for (const g of this.list) this._free(g);
    this.list.length = 0;
    this._nextId = 1;
    this.preview(null);
  }

  _free(g) {
    g.mesh.visible = false;
    g.mesh.removeFromParent();
    (g.rocket ? this._rpool : this._pool).push(g.mesh);
  }

  _remove(g) {
    const i = this.list.indexOf(g);
    if (i >= 0) this.list.splice(i, 1);
    this._free(g);
  }

  // ---------------------------------------------------------------- flight

  /**
   * Advances `pos` / `vel` by dt with gravity and one bounce. Returns the surface kind
   * it bounced on ('ground', 'actor', a collider kind) or null. `actors`: bounce off
   * characters too (never the thrower in the first moments).
   */
  _step(pos, vel, dt, g) {
    const w = this.world;
    const r = GRENADE.size;
    vel.y -= GRENADE.gravity * dt;
    const speed = vel.length();
    const dist = speed * dt;
    let bounced = null;
    if (dist > 1e-5) {
      _d.copy(vel).multiplyScalar(1 / speed);
      const hit = w.raycast(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, dist + r, null);
      let t = hit ? hit.t : Infinity;
      let nx = 0, ny = 1, nz = 0;
      if (hit) {
        nx = hit.nx;
        ny = hit.ny;
        nz = hit.nz;
        bounced = hit.kind || 'ground';
      }
      if (g && this.combat) {
        const ah = this.combat.rayActors(pos.x, pos.y, pos.z, _d.x, _d.y, _d.z, Math.min(t, dist + r), g.age < 0.3 ? g.owner : null);
        if (ah) {
          t = ah.t;
          // push straight back out of the body, flattened so it drops at their feet
          nx = pos.x + _d.x * t - ah.actor.pos.x;
          nz = pos.z + _d.z * t - ah.actor.pos.z;
          const l = Math.hypot(nx, nz) || 1;
          nx /= l;
          nz /= l;
          ny = 0;
          bounced = 'actor';
        }
      }
      if (bounced) {
        pos.addScaledVector(_d, Math.max(0, t - r));
        const vn = vel.x * nx + vel.y * ny + vel.z * nz;
        if (vn < 0) {
          // split into normal + tangent, damp each
          const tx = vel.x - vn * nx, ty = vel.y - vn * ny, tz = vel.z - vn * nz;
          const f = bounced === 'actor' ? 0.3 : GRENADE.friction;
          vel.set(tx * f - vn * nx * GRENADE.bounce, ty * f - vn * ny * GRENADE.bounce, tz * f - vn * nz * GRENADE.bounce);
        }
      } else pos.addScaledVector(_d, dist);
    }
    // never under the terrain (a ray that starts below it cannot see it)
    const floor = (w.terrainHeight ? w.terrainHeight(pos.x, pos.z) : 0) + r;
    if (pos.y < floor) {
      pos.y = floor;
      if (vel.y < 0) {
        vel.y = -vel.y * GRENADE.bounce;
        vel.x *= GRENADE.friction;
        vel.z *= GRENADE.friction;
        bounced = bounced || 'ground';
      }
    }
    return bounced;
  }

  /** Something solid right under `pos` (terrain, a roof, a built floor). */
  _supported(pos) {
    const r = GRENADE.size;
    const w = this.world;
    if (w.terrainHeight && pos.y - w.terrainHeight(pos.x, pos.z) <= r + 0.1) return true;
    return !!w.raycast(pos.x, pos.y, pos.z, 0, -1, 0, r + 0.12, null);
  }

  update(dt) {
    if (!this.list.length) return;
    const auth = this.authoritative;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const g = this.list[i];
      if (g.rocket) {
        this._updateRocket(g, dt, auth);
        continue;
      }
      g.age += dt;
      g.fuse -= dt;
      // at rest it only checks that what it lies on is still there (a floor can be shot out)
      if (g.resting && !this._supported(g.pos)) g.resting = false;
      if (!g.resting) {
        const before = g.vel.lengthSq();
        const hit = this._step(g.pos, g.vel, dt, g);
        if (hit) {
          const v = Math.sqrt(before);
          if (v > 2.5 && this.sfx) this.sfx.play('grenade_bounce', { x: g.pos.x, y: g.pos.y, z: g.pos.z, volume: Math.min(1, v / 14) });
          // slow, with something underneath: stay put
          if (g.vel.lengthSq() < 1.2 && this._supported(g.pos)) {
            g.vel.set(0, 0, 0);
            g.resting = true;
          }
        }
        g.mesh.position.copy(g.pos);
        if (!g.resting) g.mesh.rotateOnAxis(g.spin, Math.min(14, 3 + Math.sqrt(before)) * dt);
      }
      // fuse: faster beeps and a blink as it runs down
      if (!g.spent && g.age >= g.beepAt) {
        g.beepAt = g.age + Math.max(0.09, g.fuse * 0.28);
        if (this.sfx && g.fuse > 0.05) this.sfx.play('grenade_beep', { x: g.pos.x, y: g.pos.y, z: g.pos.z, volume: 0.5 });
        if (this.fx && this.fx.grenadeBlink) this.fx.grenadeBlink(g.pos);
      }
      if (g.fuse > 0) continue;
      if (auth) {
        this.list.splice(i, 1);
        this._free(g);
        this._explode(g);
      } else {
        // client: the host decides where and when it goes off
        g.spent = true;
        if (g.fuse < -CLIENT_LINGER) this._remove(g);
      }
    }
  }

  // ---------------------------------------------------------------- blast

  /** Client: the host's grenade / rocket `id` exploded at `pos`. */
  explodeAt(id, pos, rocket = false) {
    const g = this.list.find((x) => x.id === id);
    if (g) this._remove(g);
    this._blastFx(pos, (g ? g.rocket : rocket) ? ROCKET.radius : GRENADE.radius);
  }

  _blastFx(pos, radius = GRENADE.radius) {
    if (this.fx) {
      if (this.fx.explosion) this.fx.explosion(pos, { radius });
      else this.fx.ring(pos, { color: 0xffb060, radius, duration: 0.45 });
    }
    if (this.sfx) this.sfx.play('explosion', { x: pos.x, y: pos.y, z: pos.z });
  }

  /**
   * True when nothing solid lies between the blast and `a`'s chest or feet.
   * The surface the grenade is lying on is not cover: the check starts a short
   * step toward the target, so the thrower standing next to their own grenade
   * still takes the blast. A wall between them still blocks it.
   */
  _sees(o, a, h) {
    const w = this.world;
    const STEP = 0.45;
    for (const up of [h * 0.6, 0.4, h * 0.95]) {
      _d.set(a.pos.x - o.x, a.pos.y + up - o.y, a.pos.z - o.z);
      const len = _d.length();
      if (len < 1.2) return true; // on top of it, or close enough that the ground isn't cover
      _d.multiplyScalar(1 / len);
      const remain = len - STEP;
      if (remain <= 0.15) return true;
      if (!w.raycast(o.x + _d.x * STEP, o.y + _d.y * STEP, o.z + _d.z * STEP, _d.x, _d.y, _d.z, remain, null)) return true;
    }
    return false;
  }

  /** `direct`: the character a rocket struck (always a clean hit). */
  _explode(g, direct = null) {
    const rk = !!g.rocket;
    const R = rk ? ROCKET.radius : GRENADE.radius;
    const structureDamage = rk ? ROCKET.structureDamage : GRENADE.structureDamage;
    const c = g.pos;
    this._blastFx(c, R);
    if (this.onExplode) this.onExplode(g);
    const combat = this.combat;
    if (!combat) return;
    const o = _p.set(c.x, c.y + UP_BIAS, c.z).clone();

    // ---- characters: flat damage inside the radius, unless something solid is in the way
    for (const a of combat.actors.slice()) {
      if (!a.alive || a.inBus) continue;
      const h = (a.height || PLAYER.height) * (a.crouching ? 0.7 : 1);
      const dx = a.pos.x - c.x;
      const dz = a.pos.z - c.z;
      const dy = c.y < a.pos.y ? a.pos.y - c.y : c.y > a.pos.y + h ? c.y - (a.pos.y + h) : 0;
      const horiz = Math.max(0, Math.hypot(dx, dz) - (a.radius || PLAYER.radius));
      const dist = Math.hypot(horiz, dy);
      if (dist > R && a !== direct) continue;
      if (a !== direct && !this._sees(o, a, h)) continue;
      let dmg = GRENADE.damage;
      if (rk) {
        // clean hit: full damage; further out the blast fades
        const k = a === direct || dist <= ROCKET.cleanRadius ? 0 : (dist - ROCKET.cleanRadius) / Math.max(0.01, R - ROCKET.cleanRadius);
        dmg = g.damage + (ROCKET.minDamage - g.damage) * Math.min(1, k);
      }
      combat.applyDamage(a, dmg, { source: g.owner, weapon: rk ? 'rocket_launcher' : 'grenade', explosive: true, point: new THREE.Vector3(a.pos.x, a.pos.y + h * 0.75, a.pos.z) });
    }

    // ---- built pieces
    const st = this.structures;
    if (st && st.pieces) {
      for (const piece of st.pieces.slice()) {
        if (!piece.alive) continue; // lost its support to an earlier piece of this blast
        st._center(piece, _v);
        if (_v.distanceToSquared(c) > (R + 1.5) * (R + 1.5)) continue;
        st.damage(piece, structureDamage, _v);
      }
    }

    // ---- map buildings: a hole in each wall or floor panel the blast reaches
    if (combat.damagePanel) {
      const buildings = new Set();
      this.world._each(c.x - R, c.z - R, c.x + R, c.z + R, false, (cell) => {
        for (const k of cell.polys) {
          if (!k.shell || !k.shell.panels || buildings.has(k)) continue;
          if (c.x < k.minX - R || c.x > k.maxX + R || c.z < k.minZ - R || c.z > k.maxZ + R) continue;
          buildings.add(k);
        }
      });
      const reach2 = (R + 0.6) * (R + 0.6);
      for (const bld of buildings) {
        for (const pn of bld.shell.panels) {
          if (!pn.alive) continue;
          const yGap = c.y < pn.y0 ? pn.y0 - c.y : c.y > pn.y1 ? c.y - pn.y1 : 0;
          const dx = pn.x - c.x;
          const dz = pn.z - c.z;
          if (dx * dx + dz * dz + yGap * yGap > reach2) continue;
          combat.damagePanel(bld, pn, structureDamage, new THREE.Vector3(pn.x, (pn.y0 + pn.y1) * 0.5, pn.z), g.owner);
        }
      }
    }

    // ---- trees, rocks, props, vehicles
    const hits = new Set();
    this.world._each(c.x - R, c.z - R, c.x + R, c.z + R, false, (cell) => {
      for (const k of cell.circles) {
        if (hits.has(k) || !combat._isHarvestable(k)) continue;
        if (Math.hypot(k.x - c.x, k.z - c.z) - k.r <= R && c.y > k.y0 - R && c.y < k.h + R) hits.add(k);
      }
      for (const k of cell.polys) {
        if (hits.has(k) || !combat._isHarvestable(k)) continue;
        const px = Math.max(k.minX, Math.min(c.x, k.maxX));
        const pz = Math.max(k.minZ, Math.min(c.z, k.maxZ));
        if (Math.hypot(px - c.x, pz - c.z) <= R && c.y > k.y0 - R && c.y < k.h + R) hits.add(k);
      }
    });
    for (const k of hits) {
      k.hp -= structureDamage;
      if (k.hp <= 0) {
        const x = k.type === 'poly' ? (k.minX + k.maxX) / 2 : k.x;
        const z = k.type === 'poly' ? (k.minZ + k.maxZ) / 2 : k.z;
        combat._destroyCollider(k, new THREE.Vector3(x, k.y0 + Math.min(3, (k.h - k.y0) * 0.5), z));
      }
    }
  }

  // ---------------------------------------------------------------- aim arc

  /** Draws where a throw from `origin` along `dir` would go; null hides it. */
  preview(origin, dir) {
    if (!origin || !dir) {
      this._arc.visible = false;
      this._mark.visible = false;
      return;
    }
    const attr = this._arc.geometry.attributes.position;
    const pos = _p.copy(origin);
    const vel = throwVelocity(dir, _v);
    let n = 0;
    let landed = false;
    attr.setXYZ(n++, pos.x, pos.y, pos.z);
    while (n < PREVIEW_POINTS) {
      const hit = this._step(pos, vel, PREVIEW_STEP, null);
      attr.setXYZ(n++, pos.x, pos.y, pos.z);
      if (hit) {
        landed = true;
        break;
      }
    }
    attr.needsUpdate = true;
    this._arc.geometry.setDrawRange(0, n);
    this._arc.visible = true;
    this._mark.visible = landed;
    if (landed) this._mark.position.set(pos.x, pos.y - GRENADE.size + 0.06, pos.z);
  }
}
