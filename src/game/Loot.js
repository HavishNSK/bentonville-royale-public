// BENTONVILLE ROYALE — world loot: chests, ammo boxes and floor items.
//
//   const loot = new Loot({ scene, world, models, fx, sfx });
//   loot.spawnMatch(rng);                 // or spawnMatch(rng, { area: { x, z, r } }) to keep loot inside a circle
//   loot.update(dt, camera.position);     // every frame
//   const n = loot.nearest(player.pos);   // { id, kind, label, position, item?, rarity }
//   if (n.kind === 'item') { const left = inv.add(loot.take(n.id)); if (left) loot.drop(left, player.pos); }
//   else loot.open(n.id);
//
// `models` is { key: gltf } (null values are fine; a coloured box stands in). Keys:
//   chest, ammo (ammo box), crate, medkit, potion       — public/assets/loot/<key>.glb
//   rifle, smg, shotgun, sniper, pistol                 — public/assets/weapons/<key>.glb
//
// Rendering: every visual kind is one InstancedMesh (chest body, chest lid, ammo
// box body, ammo box lid, one per weapon, medkit, potion, grenade, and a tinted crate for
// ammo/material pickups) — 12 draw calls at most. Matrices are rewritten each
// frame only for records inside `cullDist` of the viewer. Loot beams, chest glows
// and the chest hum loop are attached only to nearby records (the Effects pools
// hold 128 beams / 64 glows, fewer than the match spawns).
//
// No DOM access; constructs in Node with stubbed scene/fx/sfx.

import * as THREE from 'three';
import { flattenModel } from '../core/assets.js';
import { toToon } from '../render/Toon.js';
import { grenadeModel, smokeGrenadeModel } from './Grenades.js';
import {
  WEAPONS, WEAPON_IDS, weaponStats, clampWeaponRarity, CONSUMABLES, AMMO, MATERIALS, MATERIAL_COLOR, RARITIES, MATCH,
  DROP_ZONES, STORM, QUALITY, TAU,
} from '../core/config.js';

// ---------------------------------------------------------------- tunables
export const LOOT = {
  floorRarity: [40, 30, 18, 9, 3], // weights for common..legendary
  chestRarity: [10, 32, 33, 18, 7],
  highChestRarity: [0, 0, 25, 45, 30], // hard-to-reach landmark chests (world.fixedLoot tier 'high')
  weaponWeights: Object.fromEntries(WEAPON_IDS.map((id) => [id, WEAPONS[id].lootWeight ?? 10])),
  floorMix: { weapon: 0.45, consumable: 0.25, ammo: 0.2, material: 0.1 },
  matPickup: 30,
  chestMats: 30,
  spacing: { chest: 9, ammoBox: 7, item: 3 },
  cullDist: 260,
  beamDist: 70,
  glowDist: 55,
  humDist: 24,
  maxBeams: 110,
  maxGlows: 56,
  pickupRange: 2.4,
  autoRange: 2.4, // floor ammo / ammo boxes are collected automatically inside this
  verticalReach: 2.2,
  scale: { chest: 2.0, ammo: 1.0, w: 1.3, medkit: 1.7, potion: 1.3, grenade: 1.8, crateAmmo: 0.7, crateMat: 0.9 },
  grenadeShare: 0.2, // of consumable rolls; the rest split medkit / tonic as before
  gasCanShare: 0.1, // of the non-grenade consumable rolls: a gas can (cars)
  ammoTint: { light: 0xbfe6ff, medium: 0x9ee08a, shells: 0xffa477, heavy: 0xa9b2ff, rockets: 0xff5a4d },
};

// placement (spawnMatch): see the comment above Loot._interiorGrid
const PLACE = {
  indoor: { chest: 0.65, ammoBox: 0.4, item: 0.45 }, // share placed inside enterable buildings
  candidates: { chest: 14, ammoBox: 12, item: 8 }, // best-of-K (indoor passes try 2K)
  poiMin: { chest: 12, ammoBox: 5, item: 14 }, // every drop zone gets at least this many spots
  reachMargin: 450, // playable area fades out over this beyond the storm circle / drop-zone disks
  settledR: 120, // an enterable building within this = settled; else filler
  fillerDensity: 0.2, // relative loot density in woods / meadow filler
  poiMinR: 120,
  poiMaxR: 350,
  poiPad: 40,
  dropBias: 0.65, // POI factor 1 - bias at a drop zone's heart (density there ~ 1/(1-bias)^2)
  landmarkBias: 0.35,
  indoorSearch: 70, // buildings within this of a candidate point
  minInteriorArea: 30,
  interiorCell: 100,
  kindCell: 80,
  scoreCap: 400,
};

const WEAPON_KEYS = Object.keys(WEAPONS);
const MIN_ROOM_AREA = 4; // m^2: interior rooms smaller than this (slivers, closets) get no loot spots

/** Walkable floor area (m^2) of a buildingInteriors() entry: every storey of its plan, at least its footprint area. */
function floorAreaOf(b) {
  const plan = b.collider && b.collider.shell && b.collider.shell.plan;
  let a = 0;
  if (plan && plan.levels) for (const L of plan.levels) a += L.floorArea || 0;
  return Math.max(a, b.area || 0);
}
const AMMO_KINDS = Object.keys(AMMO);
const AMMO_WEIGHTS = Object.fromEntries(AMMO_KINDS.map((k) => [k, AMMO[k].weight ?? 1]));
const CAP = { chest: MATCH.chests + 16, ammo: MATCH.ammoBoxes + 16, weapon: 120 + MATCH.floorLoot, consumable: 120 + MATCH.floorLoot, crate: 200 + MATCH.floorLoot * 2 };

const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _o = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _p = new THREE.Vector3();

const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function pickWeighted(rng, weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = rng() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r < 0) return k;
  }
  return Object.keys(weights)[0];
}

function rollRarity(rng, table) {
  let total = 0;
  for (const w of table) total += w;
  let r = rng() * total;
  for (let i = 0; i < table.length; i++) {
    r -= table[i];
    if (r < 0) return RARITIES[i];
  }
  return RARITIES[0];
}

export function itemRarity(item) {
  if (!item) return 'common';
  if (item.type === 'weapon') return RARITIES.includes(item.rarity) ? item.rarity : 'common';
  if (item.type === 'consumable') return CONSUMABLES[item.id] ? CONSUMABLES[item.id].rarity : 'common';
  return 'common';
}

export function itemLabel(item) {
  if (!item) return '';
  switch (item.type) {
    case 'weapon':
      return `${cap1(itemRarity(item))} ${WEAPONS[item.id] ? WEAPONS[item.id].name : item.id}`;
    case 'consumable': {
      const c = CONSUMABLES[item.id];
      return (c ? c.name : item.id) + (item.count > 1 ? ` x${item.count}` : '');
    }
    case 'ammo':
      return `${AMMO[item.ammo] ? AMMO[item.ammo].name : item.ammo} x${item.count}`;
    case 'material':
      return `${cap1(item.mat)} x${item.count}`;
  }
  return '';
}

/** Random loot rolls (exported for bots/tests). */
export function rollWeapon(rng, rarityTable = LOOT.floorRarity) {
  const id = pickWeighted(rng, LOOT.weaponWeights);
  let rarity = clampWeaponRarity(id, rollRarity(rng, rarityTable));
  // per-gun nudge after the roll (WEAPONS[id].rarityShift: { rarity: [to, chance] })
  const shift = WEAPONS[id].rarityShift && WEAPONS[id].rarityShift[rarity];
  if (shift && rng() < shift[1]) rarity = clampWeaponRarity(id, shift[0]);
  const st = weaponStats(id, rarity);
  return { type: 'weapon', id, rarity, mag: (st && st.mag) || WEAPONS[id].mag };
}
export function ammoFor(weaponId) {
  const kind = WEAPONS[weaponId].ammo;
  return { type: 'ammo', ammo: kind, count: AMMO[kind].pickup };
}
/** opts.noGas: never a gas can (chests: gas comes from floor loot and the gas stations). */
export function rollConsumable(rng, opts = null) {
  if (rng() < LOOT.grenadeShare) {
    const id = rng() < 0.4 ? 'smoke' : 'grenade';
    return { type: 'consumable', id, count: CONSUMABLES[id].pickup };
  }
  // gas cans for the drivable cars: an occasional drop
  if (!(opts && opts.noGas) && rng() < LOOT.gasCanShare) return { type: 'consumable', id: 'gascan', count: 1 };
  const id = rng() < 0.55 ? 'medkit' : 'tonic';
  return { type: 'consumable', id, count: id === 'medkit' ? 1 : 1 + (rng() < 0.3 ? 1 : 0) };
}
export function rollAmmo(rng) {
  const kind = pickWeighted(rng, AMMO_WEIGHTS);
  return { type: 'ammo', ammo: kind, count: AMMO[kind].pickup };
}

// ---------------------------------------------------------------- model prep

function boxFlat(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  g.computeBoundingBox();
  return { geometry: g, material: toToon(new THREE.MeshStandardMaterial({ color, roughness: 0.7 }), { saturate: 1.15 }) };
}

/** Splits a gltf into body + lid flats with the lid hinge (pivot + axis) in model space. */
function prepLidded(gltf, fallbackColor, size) {
  const scene = gltf && gltf.scene;
  if (!scene) {
    const body = boxFlat(size[0], size[1] * 0.6, size[2], fallbackColor);
    const lid = boxFlat(size[0], size[1] * 0.4, size[2], fallbackColor);
    lid.geometry.translate(0, size[1] * 0.6, 0);
    return { body, lid, pivot: new THREE.Vector3(0, size[1] * 0.6, -size[2] / 2), axis: new THREE.Vector3(-1, 0, 0) };
  }
  const a = scene.clone(true);
  a.updateMatrixWorld(true);
  const lidA = a.getObjectByName('lid');
  if (!lidA) return { body: flattenModel(a), lid: null, pivot: null, axis: null };
  const pivot = lidA.getWorldPosition(new THREE.Vector3());
  lidA.parent.remove(lidA);
  const body = flattenModel(a);
  // lid alone, keeping its parent's world transform
  const b = scene.clone(true);
  b.updateMatrixWorld(true);
  const lidB = b.getObjectByName('lid');
  const holder = new THREE.Group();
  holder.applyMatrix4(lidB.parent.matrixWorld);
  holder.add(lidB.clone(true));
  const lid = flattenModel(holder);
  if (!lid) return { body, lid: null, pivot: null, axis: null };
  // hinge axis: horizontal, perpendicular to pivot -> lid centre, so the far edge lifts
  const centre = lid.geometry.boundingBox.getCenter(new THREE.Vector3());
  const d = new THREE.Vector3(centre.x - pivot.x, 0, centre.z - pivot.z);
  let axis = new THREE.Vector3(1, 0, 0);
  if (d.lengthSq() > 1e-6) axis = d.normalize().cross(new THREE.Vector3(0, 1, 0)).normalize();
  return { body, lid, pivot, axis };
}

function prepFlat(gltf, fallback) {
  const scene = gltf && gltf.scene;
  if (scene) {
    const f = flattenModel(scene.clone(true));
    if (f) return f;
  }
  return fallback();
}

class Batch {
  constructor(group, flat, cap, { colored = false, shadow = false, name = '' } = {}) {
    this.mesh = new THREE.InstancedMesh(flat.geometry, flat.material, cap);
    this.mesh.name = 'loot_' + name;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // distance-culled by Loot.update
    this.mesh.castShadow = shadow;
    this.mesh.count = 0;
    this.cap = cap;
    this.n = 0;
    if (colored) {
      for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, _c.set(0xffffff));
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    group.add(this.mesh);
  }
  begin() {
    this.n = 0;
  }
  push(m, color) {
    if (this.n >= this.cap) return;
    this.mesh.setMatrixAt(this.n, m);
    if (color != null && this.mesh.instanceColor) this.mesh.setColorAt(this.n, _c.set(color));
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n) {
      // upload only the instances in use, not the whole buffer (hundreds of KB a frame)
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, this.n * 16);
      im.needsUpdate = true;
      const ic = this.mesh.instanceColor;
      if (ic) {
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, this.n * 3);
        ic.needsUpdate = true;
      }
    }
  }
  dispose() {
    this.mesh.parent && this.mesh.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------- Loot

export class Loot {
  constructor({ scene, world, models = {}, fx = null, sfx = null }) {
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.sfx = sfx;
    this.group = new THREE.Group();
    this.group.name = 'loot';
    if (scene) scene.add(this.group);

    this.records = [];
    this.byId = new Map();
    this._nextId = 1;
    this._rng = Math.random;
    this.time = 0;
    this.cullDist = LOOT.cullDist;
    this._beams = 0;
    this._glows = 0;
    this._blips = [];
    this._blipsDirty = true;
    this._iGrid = null;
    this.lastSpawn = null;

    const m = models || {};
    const chest = prepLidded(m.chest, 0xc58a3a, [0.5, 0.45, 0.5]);
    const ammo = prepLidded(m.ammo, 0x5f7a4a, [0.55, 0.37, 1.0]);
    this._lids = { chest, ammo };
    const g = this.group;
    this.batches = {
      chestBody: new Batch(g, chest.body, CAP.chest, { shadow: true, name: 'chest' }),
      chestLid: chest.lid ? new Batch(g, chest.lid, CAP.chest, { shadow: true, name: 'chestLid' }) : null,
      ammoBody: new Batch(g, ammo.body, CAP.ammo, { shadow: true, name: 'ammoBox' }),
      ammoLid: ammo.lid ? new Batch(g, ammo.lid, CAP.ammo, { shadow: true, name: 'ammoLid' }) : null,
      medkit: new Batch(g, prepFlat(m.medkit, () => boxFlat(0.22, 0.29, 0.14, 0xd83a3a)), CAP.consumable, { name: 'medkit' }),
      potion: new Batch(g, prepFlat(m.potion, () => boxFlat(0.2, 0.4, 0.2, 0x3b9cff)), CAP.consumable, { name: 'potion' }),
      gascan: new Batch(g, prepFlat(null, () => boxFlat(0.26, 0.32, 0.14, 0xd8342c)), CAP.consumable, { name: 'gascan' }),
      grenade: new Batch(g, grenadeModel(true), CAP.consumable, { name: 'grenade' }),
      smoke: new Batch(g, smokeGrenadeModel(true), CAP.consumable, { name: 'smoke' }),
      crate: new Batch(g, prepFlat(m.crate, () => boxFlat(0.5, 0.5, 0.5, 0xffffff)), CAP.crate, { colored: true, name: 'crate' }),
    };
    for (const id of WEAPON_KEYS) {
      this.batches['w_' + id] = new Batch(g, prepFlat(m[WEAPONS[id].model] || m[id], () => boxFlat(0.12, 0.2, 0.7, 0x55606a)), CAP.weapon, { name: id });
    }
  }

  setQuality(q) {
    const Q = QUALITY[q];
    if (Q) this.cullDist = Math.max(LOOT.cullDist * 0.6, Q.propDist * 1.1);
  }

  get count() {
    return this.records.length;
  }

  // -------------------------------------------------------------- records

  _add(kind, x, y, z, yaw, item, forcedId = 0) {
    const id = forcedId || this._nextId++;
    if (id >= this._nextId) this._nextId = id + 1;
    const rec = {
      id, kind, x, y, z, yaw, item: item || null,
      rarity: kind === 'item' ? itemRarity(item) : kind === 'chest' ? 'legendary' : 'common',
      opened: false, open01: 0, phase: (id * 2.399) % TAU,
      beam: null, glow: null, hum: false, spill: null, idx: this.records.length,
      info: null,
    };
    rec.info = {
      id, kind,
      label: kind === 'chest' ? 'Open Chest' : kind === 'ammoBox' ? 'Open Ammo Box' : itemLabel(item),
      position: new THREE.Vector3(x, y, z),
      item: rec.item,
      rarity: rec.rarity,
    };
    this.records.push(rec);
    this.byId.set(id, rec);
    this._blipsDirty = true;
    return rec;
  }

  /**
   * Collider c was just destroyed (already removed from the world): every unopened record resting on
   * its top drops to the highest surface left below it. Returns the number of records moved.
   */
  dropFrom(c) {
    if (!c || !this.world) return 0;
    const top = c.h != null ? c.h : c.y1;
    if (!Number.isFinite(top)) return 0;
    const x0 = c.minX ?? (c.x != null ? c.x - (c.r || 0) : -Infinity);
    const x1 = c.maxX ?? (c.x != null ? c.x + (c.r || 0) : Infinity);
    const z0 = c.minZ ?? (c.z != null ? c.z - (c.r || 0) : -Infinity);
    const z1 = c.maxZ ?? (c.z != null ? c.z + (c.r || 0) : Infinity);
    let moved = 0;
    for (const r of this.records) {
      if (r.opened || Math.abs(r.y - top) > 0.2 || r.x < x0 || r.x > x1 || r.z < z0 || r.z > z1) continue;
      const below = this.world.groundHeight(r.x, r.z, r.y - 0.1, 0);
      if (!Number.isFinite(below) || below >= r.y - 0.05) continue;
      r.y = below;
      if (r.info && r.info.position) r.info.position.y = below;
      moved++;
    }
    if (moved) this._blipsDirty = true;
    return moved;
  }

  _remove(rec) {
    this._fxOff(rec);
    const last = this.records.pop();
    if (last !== rec) {
      this.records[rec.idx] = last;
      last.idx = rec.idx;
    }
    this.byId.delete(rec.id);
    this._blipsDirty = true;
  }

  _fxOff(rec) {
    if (rec.beam) {
      rec.beam.remove();
      rec.beam = null;
      this._beams--;
    }
    if (rec.glow) {
      rec.glow.remove();
      rec.glow = null;
      this._glows--;
    }
    if (rec.hum) {
      this.sfx && this.sfx.stopLoop('chest_hum', rec.id);
      rec.hum = false;
    }
  }

  clear() {
    for (const r of this.records) this._fxOff(r);
    this.records.length = 0;
    this.byId.clear();
    this._beams = this._glows = 0;
    this._blipsDirty = true;
    for (const k in this.batches) {
      const b = this.batches[k];
      if (b) {
        b.begin();
        b.end();
      }
    }
  }

  dispose() {
    this.clear();
    for (const k in this.batches) this.batches[k] && this.batches[k].dispose();
    this.group.parent && this.group.parent.remove(this.group);
  }

  // -------------------------------------------------------------- placement
  //
  // Playable area (all derived at runtime from world.bounds, DROP_ZONE landmarks,
  // the storm circle and world.buildingInteriors(); no hard-coded extents):
  //   reach(p)  = 1 inside the storm's opening circle (opts.area; every later circle
  //               lies inside it) or a DROP_ZONE disk, fading to 0 over
  //               PLACE.reachMargin beyond them, clipped to the map bounds. On the
  //               compact map that is the whole map; on a huge map it keeps loot off
  //               empty fields km from the fight.
  //   settled(p)= 1 with an enterable building within PLACE.settledR, else
  //               PLACE.fillerDensity (woods / meadow filler gets sparse loot).
  // Each DROP_ZONE first gets PLACE.poiMin spots of every kind inside its disk; the
  // rest are spread by Mitchell's best-candidate sampling: each spot is the best of K
  // uniform candidates, scored nearest-same-kind distance x sqrt(reach x settled) /
  // poiFactor (poiFactor < 1 near landmarks, so they end up denser). Even blue-noise
  // spread, exact counts, bounded work. A share of each kind goes inside enterable
  // buildings at the building's floorY, capped per building (_cap).

  /** Enterable buildings bucketed on a coarse grid (cached per world). */
  _interiorGrid() {
    const w = this.world;
    const list = typeof w.buildingInteriors === 'function' ? w.buildingInteriors() : [];
    if (this._iGrid && this._iGrid.list === list) return this._iGrid;
    const C = PLACE.interiorCell;
    const cells = new Map();
    for (const b of list) {
      if (!(b.area >= PLACE.minInteriorArea)) continue;
      const k = Math.floor(b.x / C) * 73856093 ^ Math.floor(b.z / C) * 19349663;
      let cell = cells.get(k);
      if (!cell) cells.set(k, (cell = []));
      cell.push(b);
    }
    this._iGrid = { list, cells, C };
    return this._iGrid;
  }

  /** Interior buildings whose centre is within r of (x, z), pushed into out. */
  _interiorsNear(x, z, r, out) {
    const g = this._interiorGrid();
    out.length = 0;
    const C = g.C;
    const x0 = Math.floor((x - r) / C), x1 = Math.floor((x + r) / C);
    const z0 = Math.floor((z - r) / C), z1 = Math.floor((z + r) / C);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = g.cells.get(ix * 73856093 ^ iz * 19349663);
        if (!cell) continue;
        for (const b of cell) if ((b.x - x) ** 2 + (b.z - z) ** 2 < r * r) out.push(b);
      }
    }
    return out;
  }

  /** Playable-area description for this match (see the block comment). */
  _playable(area) {
    const w = this.world;
    const lms = w.landmarks || {};
    const main = area || { x: 0, z: 0, r: STORM.startRadius * 1.15 };
    const disks = [{ key: 'circle', x: main.x, z: main.z, r: main.r }];
    for (const zd of DROP_ZONES) {
      const lm = lms[zd.key];
      if (!lm || !Number.isFinite(lm.x)) continue;
      const r = Math.max(PLACE.poiMinR, Math.min(lm.r || 100, PLACE.poiMaxR)) + PLACE.poiPad;
      disks.push({ key: zd.key, x: lm.x, z: lm.z, r, poi: true });
    }
    const M = PLACE.reachMargin;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of disks) {
      minX = Math.min(minX, d.x - d.r - M);
      maxX = Math.max(maxX, d.x + d.r + M);
      minZ = Math.min(minZ, d.z - d.r - M);
      maxZ = Math.max(maxZ, d.z + d.r + M);
    }
    const b = w.bounds;
    const inset = 20;
    // Composed (compact) map: the dormant opening storm covers all of it and players can drop
    // anywhere along the bus route, so every composed area gets full reach, not just the disks.
    this._comp = undefined;
    this._inComposed(0, 0);
    if (this._comp) {
      return { disks, whole: true, minX: b.minX + inset, maxX: b.maxX - inset, minZ: b.minZ + inset, maxZ: b.maxZ - inset };
    }
    return {
      disks,
      minX: Math.max(minX, b.minX + inset),
      maxX: Math.min(maxX, b.maxX - inset),
      minZ: Math.max(minZ, b.minZ + inset),
      maxZ: Math.min(maxZ, b.maxZ - inset),
    };
  }

  /** reach(p) x settled(p) in [0, 1]; 0 = outside the playable area. */
  _weight(x, z) {
    const M = PLACE.reachMargin;
    let reach = this._play.whole ? 1 : 0;
    if (!reach) for (const d of this._play.disks) {
      const e = Math.sqrt((x - d.x) ** 2 + (z - d.z) ** 2) - d.r;
      const v = e <= 0 ? 1 : 1 - e / M;
      if (v > reach) reach = v;
      if (reach >= 1) break;
    }
    if (reach <= 0) return 0;
    if (!this._inComposed(x, z)) return 0;
    return reach * this._settled(x, z);
  }

  /**
   * Compact composed maps (meta.composition from scripts/compose-map.mjs): loot only on the
   * downtown core, the moved islands (padded a little) and along the connector roads between
   * them, never in the countryside filler that pads the bounds rectangle. Maps without a
   * composition allow everything.
   */
  _inComposed(x, z) {
    let c = this._comp;
    if (c === undefined) {
      const meta = this.world.data && this.world.data.meta;
      const comp = meta && meta.composition;
      c = null;
      if (comp && ((comp.core && Array.isArray(comp.core.rect)) || Array.isArray(comp.tiles))) {
        const pad = 60;
        // core + islands (the old layout) or the tile pack; connectors = island roads / gap streets
        const rects = [comp.core && comp.core.rect, ...(comp.islands || []).map((i) => i.rect), ...(comp.tiles || []).map((t) => t.rect)]
          .filter((r) => Array.isArray(r) && r.length === 4)
          .map(([x0, z0, x1, z1]) => [Math.min(x0, x1) - pad, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, Math.max(z0, z1) + pad]);
        const roads = (comp.connectors || []).filter((s) => Array.isArray(s.from) && Array.isArray(s.to));
        c = { rects, roads, roadR: 70 };
      }
      this._comp = c;
    }
    if (!c) return true;
    for (const r of c.rects) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true;
    for (const s of c.roads) {
      const ax = s.from[0], az = s.from[1], bx = s.to[0], bz = s.to[1];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= c.roadR) return true;
    }
    return false;
  }

  /** 1 with an enterable building near (x, z), else PLACE.fillerDensity (cached per 40 m cell). */
  _settled(x, z) {
    const S = 40;
    const cx = Math.floor(x / S), cz = Math.floor(z / S);
    const key = cx * 73856093 ^ cz * 19349663;
    let v = this._settledCache.get(key);
    if (v !== undefined) return v;
    v = PLACE.fillerDensity;
    const g = this._interiorGrid();
    const C = g.C, r = PLACE.settledR, px = (cx + 0.5) * S, pz = (cz + 0.5) * S;
    outer: for (let ix = Math.floor((px - r) / C); ix <= Math.floor((px + r) / C); ix++) {
      for (let iz = Math.floor((pz - r) / C); iz <= Math.floor((pz + r) / C); iz++) {
        const cell = g.cells.get(ix * 73856093 ^ iz * 19349663);
        if (!cell) continue;
        for (const b of cell) {
          if ((b.x - px) ** 2 + (b.z - pz) ** 2 < r * r) {
            v = 1;
            break outer;
          }
        }
      }
    }
    this._settledCache.set(key, v);
    return v;
  }

  /** Landmark richness: 1 away from POIs, down to 1 - bias at a POI's heart. */
  _poiFactor(x, z) {
    let f = 1;
    for (const p of this._pois) {
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 >= p.r * p.r * 1.69) continue;
      const d = Math.sqrt(d2);
      const t = d <= p.r * 0.6 ? 1 : 1 - (d - p.r * 0.6) / (p.r * 0.7);
      const v = 1 - p.bias * t * t * (3 - 2 * t);
      if (v < f) f = v;
    }
    return f;
  }

  _collectPois() {
    const lms = this.world.landmarks || {};
    const drop = new Set(DROP_ZONES.map((z) => z.key));
    const out = [];
    for (const k in lms) {
      const lm = lms[k];
      if (!lm || !Number.isFinite(lm.x)) continue;
      const isDrop = drop.has(k);
      if (!isDrop && (lm.r || 0) > PLACE.poiMaxR) continue; // trails / greenway: too big to be a "place"
      out.push({ x: lm.x, z: lm.z, r: Math.max(PLACE.poiMinR * (isDrop ? 1 : 0.5), Math.min(lm.r || 60, PLACE.poiMaxR)), bias: isDrop ? PLACE.dropBias : PLACE.landmarkBias });
    }
    return out;
  }

  /** Nearest same-kind spot distance (capped at PLACE.scoreCap); grid rings, nearest first. */
  _nearestSame(kind, x, z) {
    const g = this._kindGrid[kind];
    const C = PLACE.kindCell;
    const R = Math.ceil(PLACE.scoreCap / C);
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    let best = PLACE.scoreCap * PLACE.scoreCap;
    for (let ring = 0; ring <= R; ring++) {
      // every point in ring k is at least (k - 1) * C away
      if (ring > 1 && ((ring - 1) * C) ** 2 >= best) break;
      for (let ix = gx - ring; ix <= gx + ring; ix++) {
        const edge = ix === gx - ring || ix === gx + ring;
        for (let iz = gz - ring; iz <= gz + ring; iz += edge ? 1 : 2 * ring) {
          const cell = g.get(ix * 73856093 ^ iz * 19349663);
          if (!cell) continue;
          for (let i = 0; i < cell.length; i += 2) {
            const d = (cell[i] - x) ** 2 + (cell[i + 1] - z) ** 2;
            if (d < best) best = d;
          }
        }
      }
    }
    return Math.sqrt(best);
  }

  _markKind(kind, x, z) {
    const C = PLACE.kindCell;
    const g = this._kindGrid[kind];
    const k = Math.floor(x / C) * 73856093 ^ Math.floor(z / C) * 19349663;
    let cell = g.get(k);
    if (!cell) g.set(k, (cell = []));
    cell.push(x, z);
  }

  /** Uniform point inside `disk` (or the playable rectangle) with weight > 0; null if unlucky. */
  _samplePoint(rng, disk) {
    const P = this._play;
    for (let i = 0; i < 30; i++) {
      let x, z;
      if (disk) {
        const a = rng() * TAU, d = Math.sqrt(rng()) * disk.r;
        x = disk.x + Math.cos(a) * d;
        z = disk.z + Math.sin(a) * d;
      } else {
        x = P.minX + rng() * (P.maxX - P.minX);
        z = P.minZ + rng() * (P.maxZ - P.minZ);
      }
      if (!this.world.inBounds(x, z, 20)) continue;
      const wt = this._weight(x, z);
      if (wt > 0) return { x, z, wt };
    }
    return null;
  }

  _okSpot(x, z, clearance) {
    const w = this.world;
    if (!w.inBounds(x, z, 20)) return false;
    if (w.blockedAt(x, z, clearance)) return false;
    if (w.areaAt && w.areaAt(x, z) === 'water') return false;
    if (w.reservedAt && w.reservedAt(x, z)) return false; // bespoke landmark: it places its own loot
    return true;
  }

  /** An open ground candidate near p, or null. */
  _outdoorCandidate(rng, p, clearance) {
    const w = this.world;
    for (let t = 0; t < 3; t++) {
      const x = t ? p.x + (rng() - 0.5) * 16 : p.x;
      const z = t ? p.z + (rng() - 0.5) * 16 : p.z;
      if (this._okSpot(x, z, clearance)) return { x, z, y: w.groundHeight(x, z, 0.3), yaw: rng() * TAU, b: null };
    }
    return null;
  }

  /** A floor point inside an enterable building near p (not in a wall), or null. */
  _indoorCandidate(rng, p, kind, clearance) {
    const w = this.world;
    const near = this._interiorsNear(p.x, p.z, PLACE.indoorSearch, this._nearBuf);
    if (!near.length) return null;
    const used = this._used[kind];
    let tot = 0;
    const wts = this._wBuf;
    wts.length = 0;
    for (const b of near) {
      const v = (used.get(b) || 0) >= this._cap(kind, b) ? 0 : Math.sqrt(floorAreaOf(b));
      wts.push(v);
      tot += v;
    }
    if (tot <= 0) return null;
    let pick = rng() * tot, b = near[near.length - 1];
    for (let i = 0; i < near.length; i++) {
      pick -= wts[i];
      if (pick < 0) {
        b = near[i];
        break;
      }
    }
    const c = b.collider;
    const plan = c.shell && c.shell.plan;
    if (plan && plan.lootSpots && plan.lootSpots.length) {
      const s = this._spotCandidate(rng, b, plan, clearance);
      if (s) return s;
    }
    for (let k = 0; k < 10; k++) {
      const x = c.minX + rng() * (c.maxX - c.minX);
      const z = c.minZ + rng() * (c.maxZ - c.minZ);
      if (w.interiorAt(x, z) !== c) continue;
      if (w.blockedAt(x, z, clearance, true)) continue;
      return { x, z, y: Math.max(b.floorY, w.surfaceHeight(x, z)), yaw: rng() * TAU, b, level: 0 };
    }
    return null;
  }

  /**
   * A spot from the building's interior plan (plan.lootSpots { x, y, z, level, room }): a storey
   * picked by floor area (among storeys with spots), then one of its spots, jittered inside the
   * spot's room on the ground storey (clear of partitions; blockedAt samples that storey only).
   * Upper-storey spots are used as given and sit at their own y. -> candidate or null.
   */
  _spotCandidate(rng, b, plan, clearance) {
    const w = this.world;
    const c = b.collider;
    const spots = plan.lootSpots;
    const levels = plan.levels || [];
    // storey pick: weight = floorArea of every storey that has a spot
    let tot = 0;
    const lw = this._lvBuf || (this._lvBuf = []);
    lw.length = 0;
    for (let k = 0; k < levels.length; k++) {
      let has = false;
      for (let i = 0; i < spots.length && !has; i++) if ((spots[i].level | 0) === k) has = true;
      const v = has ? Math.max(1, levels[k].floorArea || 0) : 0;
      lw.push(v);
      tot += v;
    }
    if (tot <= 0) return null;
    let pick = rng() * tot;
    let lv = 0;
    for (let k = 0; k < lw.length; k++) {
      pick -= lw[k];
      if (pick < 0) {
        lv = k;
        break;
      }
    }
    // spot pick on that storey: weight sqrt(room area) (a hall holds more than a closet; a
    // room with several spots shares its weight), rooms under MIN_ROOM_AREA m^2 skipped
    const L = levels[lv];
    const rooms = (L && L.rooms) || [];
    const per = this._perRoom || (this._perRoom = new Map());
    per.clear();
    for (let i = 0; i < spots.length; i++) if ((spots[i].level | 0) === lv) per.set(spots[i].room, (per.get(spots[i].room) || 0) + 1);
    const sw = (q) => {
      const r = rooms[q.room];
      const a = r ? r.area : MIN_ROOM_AREA;
      return a < MIN_ROOM_AREA ? 0 : Math.sqrt(a) / (per.get(q.room) || 1);
    };
    let stot = 0;
    for (let i = 0; i < spots.length; i++) if ((spots[i].level | 0) === lv) stot += sw(spots[i]);
    if (stot <= 0) return null;
    let sp = null;
    let spick = rng() * stot;
    for (let i = 0; i < spots.length; i++) {
      if ((spots[i].level | 0) !== lv) continue;
      const v = sw(spots[i]);
      if (v <= 0) continue;
      spick -= v;
      sp = spots[i];
      if (spick < 0) break;
    }
    if (!sp) return null;
    const yaw = rng() * TAU;
    if (lv > 0) return { x: sp.x, z: sp.z, y: sp.y ?? (L ? L.y : b.floorY), yaw, b, level: lv };
    // ground storey: somewhere in the spot's room (frame-local rect, shrunk by a margin)
    const room = L && L.rooms && L.rooms[sp.room];
    const F = plan.frame;
    const m = clearance + 0.4;
    if (room && F && room.a1 - room.a0 > 2 * m && room.b1 - room.b0 > 2 * m) {
      for (let k = 0; k < 3; k++) {
        const la = room.a0 + m + rng() * (room.a1 - room.a0 - 2 * m);
        const lb = room.b0 + m + rng() * (room.b1 - room.b0 - 2 * m);
        const x = F.ox + la * F.ux + lb * F.vx;
        const z = F.oz + la * F.uz + lb * F.vz;
        if (w.interiorAt(x, z) !== c || w.blockedAt(x, z, clearance, true)) continue;
        return { x, z, y: Math.max(L.y, w.surfaceHeight(x, z)), yaw, b, level: 0 };
      }
    }
    if (w.interiorAt(sp.x, sp.z) !== c || w.blockedAt(sp.x, sp.z, clearance, true)) return null;
    return { x: sp.x, z: sp.z, y: Math.max(L ? L.y : b.floorY, w.surfaceHeight(sp.x, sp.z)), yaw, b, level: 0 };
  }

  /** Most spots of `kind` one building may hold (by its walkable floor area over every storey). */
  _cap(kind, b) {
    const a = floorAreaOf(b);
    // small houses 1, mid-size 2, big halls 3-6 (schools / Community Center)
    if (kind === 'chest') return a < 800 ? 1 : a < 5000 ? 2 : a < 15000 ? 3 : 4 + Math.min(2, Math.floor(a / 30000));
    if (kind === 'ammoBox') return a < 3000 ? 1 : a < 15000 ? 2 : 3;
    return a < 400 ? 1 : a < 2500 ? 2 : 3 + Math.min(3, Math.floor(a / 6000));
  }

  /** Best-of-K spot for `kind` (inside `disk` when given); indoor tries interiors first. */
  _bestSpot(rng, kind, disk, indoor) {
    const baseSpacing = LOOT.spacing[kind];
    const clr = kind === 'item' ? 0.5 : 0.9;
    const K = PLACE.candidates[kind];
    // pass 0: indoor (if wanted); pass 1: outdoor; pass 2: last resort with more candidates and
    // half spacing, so exact counts survive on a compact map where land is scarcer
    for (let pass = 0; pass < 3; pass++) {
      const wantIn = indoor && pass === 0;
      const spacing = pass === 2 ? baseSpacing * 0.5 : baseSpacing;
      const tries = pass === 2 ? K * 4 : K * (wantIn ? 2 : 1);
      let best = null, bestScore = -1;
      for (let k = 0; k < tries; k++) {
        const p = this._samplePoint(rng, disk);
        if (!p) continue;
        const s = wantIn ? this._indoorCandidate(rng, p, kind, clr) : this._outdoorCandidate(rng, p, clr);
        if (!s) continue;
        if (disk && (s.x - disk.x) ** 2 + (s.z - disk.z) ** 2 > disk.r * disk.r) continue;
        if (!this._spaced(s.x, s.z, spacing, s.b ? s.level | 0 : -1)) continue;
        const wt = s.b ? this._weight(s.x, s.z) : p.wt;
        if (wt <= 0) continue;
        const score = (this._nearestSame(kind, s.x, s.z) * Math.sqrt(wt)) / this._poiFactor(s.x, s.z);
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      if (best) {
        this._mark(best.x, best.z, spacing, best.b ? best.level | 0 : -1);
        this._markKind(kind, best.x, best.z);
        if (best.b) this._used[kind].set(best.b, (this._used[kind].get(best.b) || 0) + 1);
        return best;
      }
    }
    return null;
  }

  /**
   * Is (x, z) at least d (or the marked spot's own spacing) from every marked spot? lv = storey
   * of an indoor spot (-1 outdoors): spots on different storeys of a building (3 m apart
   * vertically) are not neighbours.
   */
  _spaced(x, z, d, lv = -1) {
    const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
    const C = 16;
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    const r = Math.ceil(d / C);
    for (let ix = gx - r; ix <= gx + r; ix++) {
      for (let iz = gz - r; iz <= gz + r; iz++) {
        const cell = this._grid.get(key(ix, iz));
        if (!cell) continue;
        for (const p of cell) {
          if (lv >= 0 && p.lv >= 0 && p.lv !== lv) continue;
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.d > d ? p.d : d) ** 2) return false;
        }
      }
    }
    return true;
  }

  _mark(x, z, d, lv = -1) {
    const C = 16;
    const k = Math.floor(x / C) * 73856093 ^ Math.floor(z / C) * 19349663;
    let cell = this._grid.get(k);
    if (!cell) this._grid.set(k, (cell = []));
    cell.push({ x, z, d, lv });
  }

  /**
   * Places MATCH.chests chests, MATCH.ammoBoxes ammo boxes and MATCH.floorLoot
   * floor spots (a weapon spot also gets its ammo beside it) over the playable
   * area: opts.area = { x, z, r } (the storm's opening circle) plus every
   * DROP_ZONE landmark. Deterministic for a given rng sequence.
   * Returns { chests, ammoBoxes, items, indoorChests, ms }.
   */
  spawnMatch(rng = Math.random, opts = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.clear();
    this._rng = rng;
    this._grid = new Map();
    this._kindGrid = { chest: new Map(), ammoBox: new Map(), item: new Map() };
    this._used = { chest: new Map(), ammoBox: new Map(), item: new Map() };
    this._nearBuf = [];
    this._wBuf = [];
    this._pois = this._collectPois();
    this._settledCache = new Map();
    const area = opts.area && opts.area.r > 0 ? opts.area : null;
    const play = (this._play = this._playable(area));
    const w = this.world;

    const counts = {
      chest: opts.chests ?? MATCH.chests,
      ammoBox: opts.ammoBoxes ?? MATCH.ammoBoxes,
      item: opts.floorLoot ?? MATCH.floorLoot,
    };
    let indoorChests = 0;
    // fixed spots authored by bespoke landmarks (world.fixedLoot: { kind, x, y, z, yaw, tier?, item? })
    for (const f of w.fixedLoot || []) {
      if (area && Math.hypot(f.x - area.x, f.z - area.z) > area.r) continue;
      if (f.kind === 'item') {
        if (f.item && f.item.type) {
          // a fixed item (a gas station's gas can): no roll
          this._add('item', f.x, f.y, f.z, f.yaw || 0, { ...f.item });
          continue;
        }
        const mix = pickWeighted(rng, LOOT.floorMix);
        const item = mix === 'weapon' ? rollWeapon(rng, LOOT.floorRarity) : mix === 'consumable' ? rollConsumable(rng) : rollAmmo(rng);
        this._add('item', f.x, f.y, f.z, f.yaw || 0, item);
        continue;
      }
      const rec = this._add(f.kind === 'ammoBox' ? 'ammoBox' : 'chest', f.x, f.y, f.z, f.yaw || 0, null);
      if (f.tier === 'high') rec.tier = 'high';
      if (rec.kind === 'chest') indoorChests++;
    }
    const pois = play.disks.filter((d) => d.poi);
    for (const kind of ['chest', 'ammoBox', 'item']) {
      const pIn = PLACE.indoor[kind];
      const total = counts[kind];
      // drop-zone minimum first (inside each POI's own footprint), then the whole area
      const plan = [];
      const per = Math.min(PLACE.poiMin[kind], Math.floor(total / Math.max(1, pois.length) / 2));
      for (const d of pois) for (let i = 0; i < per; i++) plan.push({ x: d.x, z: d.z, r: d.r - PLACE.poiPad });
      while (plan.length < total) plan.push(null);
      for (let i = 0; i < plan.length; i++) {
        // exact indoor share: spot i goes indoors when floor((i+1)p) steps up
        const indoor = Math.floor((i + 1) * pIn) > Math.floor(i * pIn);
        const s = this._bestSpot(rng, kind, plan[i], indoor);
        if (!s) continue;
        if (kind !== 'item') {
          this._add(kind, s.x, s.y, s.z, s.yaw, null);
          if (kind === 'chest' && s.b) indoorChests++;
          continue;
        }
        const mix = pickWeighted(rng, LOOT.floorMix);
        let item;
        if (mix === 'weapon') item = rollWeapon(rng, LOOT.floorRarity);
        else if (mix === 'consumable') item = rollConsumable(rng);
        else if (mix === 'ammo') item = rollAmmo(rng);
        else item = { type: 'material', mat: MATERIALS[Math.floor(rng() * MATERIALS.length)], count: LOOT.matPickup };
        this._add('item', s.x, s.y, s.z, s.yaw, item);
        if (item.type === 'weapon' && rng() < 0.7) {
          const ax = s.x + Math.cos(s.yaw) * 0.9, az = s.z - Math.sin(s.yaw) * 0.9;
          const ok = s.b
            ? w.interiorAt(ax, az) === s.b.collider && !w.blockedAt(ax, az, 0.3, true)
            : !w.blockedAt(ax, az, 0.3);
          const px = ok ? ax : s.x, pz = ok ? az : s.z;
          const py = s.b ? (s.level > 0 ? s.y : Math.max(s.b.floorY, w.surfaceHeight(px, pz))) : w.groundHeight(px, pz, 0.3);
          this._add('item', px, py, pz, s.yaw, ammoFor(item.id));
        }
      }
    }
    this._grid = this._kindGrid = this._used = null;
    let chests = 0, ammoBoxes = 0, items = 0;
    for (const r of this.records) {
      if (r.kind === 'chest') chests++;
      else if (r.kind === 'ammoBox') ammoBoxes++;
      else items++;
    }
    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this._play = this._settledCache = null;
    this.lastSpawn = { chests, ammoBoxes, items, indoorChests, ms };
    return { chests, ammoBoxes, items, indoorChests, ms };
  }

  // -------------------------------------------------------------- interaction

  _spawnItem(item, fromX, fromY, fromZ, toX, toZ, hintY) {
    const w = this.world;
    // inside an enterable building only its walls block (the footprint itself would)
    const inside = w.interiorAt ? w.interiorAt(fromX, fromZ) : null;
    const blocked = inside
      ? w.interiorAt(toX, toZ) !== inside || w.blockedAt(toX, toZ, 0.25, true)
      : w.blockedAt(toX, toZ, 0.25);
    if (blocked) {
      toX = fromX;
      toZ = fromZ;
    }
    // the floor under the landing point at the source's height (hintY): an upper storey keeps
    // its loot; a landing point over a stairwell / void (floor far below) falls back to the source
    let y = w.groundHeight(toX, toZ, hintY + 0.6);
    if (inside && hintY - y > 1 && (toX !== fromX || toZ !== fromZ)) {
      toX = fromX;
      toZ = fromZ;
      y = w.groundHeight(toX, toZ, hintY + 0.6);
    }
    const rec = this._add('item', toX, y, toZ, this._rng() * TAU, item);
    rec.spill = { fx: fromX, fy: fromY, fz: fromZ, t: 0 };
    rec.info.position.set(toX, y, toZ);
    return rec;
  }

  /** Opens a chest or ammo box and spills its contents in front of it. */
  open(id) {
    const rec = this.byId.get(id);
    if (!rec || rec.kind === 'item' || rec.opened) return false;
    rec.opened = true;
    this._fxOff(rec);
    this._blipsDirty = true;
    _p.set(rec.x, rec.y, rec.z);
    if (this.fx) rec.kind === 'chest' ? this.fx.chestOpen(_p) : this.fx.pickupBurst(_p, 'common');
    if (this.sfx) this.sfx.play('chest_open', { x: rec.x, y: rec.y, z: rec.z });

    const rng = this._rng;
    const items = [];
    if (rec.kind === 'chest') {
      const wpn = rollWeapon(rng, rec.tier === 'high' ? LOOT.highChestRarity : LOOT.chestRarity);
      items.push(wpn, ammoFor(wpn.id));
      items.push(rng() < 0.65 ? rollConsumable(rng, { noGas: true }) : rollAmmo(rng)); // no gas cans from chests
      items.push({ type: 'material', mat: 'wood', count: LOOT.chestMats });
    } else {
      items.push(rollAmmo(rng), rollAmmo(rng));
      if (rng() < 0.3) items.push(rollAmmo(rng));
    }
    const fy = rec.y + 0.6;
    const n = items.length;
    for (let i = 0; i < n; i++) {
      const a = rec.yaw + (n > 1 ? (i / (n - 1) - 0.5) * 1.8 : 0);
      const d = 1.4 + rng() * 0.6;
      this._spawnItem(items[i], rec.x, fy, rec.z, rec.x + Math.sin(a) * d, rec.z + Math.cos(a) * d, rec.y);
    }
    return true;
  }

  /**
   * Explosion: dump the chest / ammo box (same spill as `open`) then remove the container
   * so the mesh is gone. An already-open container is removed without spilling again.
   */
  smash(id) {
    const rec = this.byId.get(id);
    if (!rec || rec.kind === 'item') return false;
    if (!rec.opened) this.open(id);
    const gone = this.byId.get(id);
    if (gone) this._remove(gone);
    return true;
  }

  /** Removes a floor item and returns it (plays pickup sound/burst). */
  take(id) {
    const rec = this.byId.get(id);
    if (!rec || rec.kind !== 'item') return null;
    const item = rec.item;
    _p.set(rec.x, rec.y, rec.z);
    if (this.fx) this.fx.pickupBurst(_p, rec.rarity);
    if (this.sfx) this.sfx.play(item.type === 'ammo' || item.type === 'material' ? 'pickup_ammo' : 'pickup', { x: rec.x, y: rec.y, z: rec.z });
    this._remove(rec);
    return item;
  }

  /** Places an item on the ground near `position` (scattered a little). Returns its id. */
  drop(item, position) {
    if (!item || !item.type) return null;
    if (item.count != null && item.count <= 0) return null;
    const rng = this._rng;
    const a = rng() * TAU, d = 0.5 + rng() * 0.9;
    const py = position.y || 0;
    const rec = this._spawnItem(item, position.x, py + 0.8, position.z, position.x + Math.cos(a) * d, position.z + Math.sin(a) * d, py);
    return rec.id;
  }

  /** Host snapshot: every live record. Items are plain JSON. */
  exportNet() {
    const out = [];
    for (const r of this.records) out.push([r.id, r.kind, Math.round(r.x * 10), Math.round(r.y * 10), Math.round(r.z * 10), r.opened ? 1 : 0, r.item || 0]);
    return out;
  }

  /** Client: add, open, or remove records so the ground matches the host. */
  importNet(rows) {
    if (!rows) return;
    const seen = new Set();
    for (const row of rows) {
      const [id, kind, x, y, z, opened, item] = row;
      seen.add(id);
      let rec = this.byId.get(id);
      if (!rec) rec = this._add(kind, x / 10, y / 10, z / 10, 0, item || null, id);
      if (opened && !rec.opened) {
        rec.opened = true;
        this._fxOff(rec);
        this._blipsDirty = true;
      }
    }
    for (const rec of this.records.slice()) if (!seen.has(rec.id)) this._remove(rec);
  }

  // -------------------------------------------------------------- queries

  _interactable(r) {
    return r.kind === 'item' || !r.opened;
  }

  nearest(pos, maxDist = LOOT.pickupRange) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const r of this.records) {
      if (!this._interactable(r)) continue;
      if (Math.abs(r.y - pos.y) > LOOT.verticalReach) continue;
      const d = (r.x - pos.x) ** 2 + (r.z - pos.z) ** 2;
      if (d <= bd) {
        bd = d;
        best = r;
      }
    }
    return best ? best.info : null;
  }

  /** Every interactable record within `radius` (horizontal), nearest first. */
  near(pos, radius) {
    const r2 = radius * radius;
    const out = [];
    for (const r of this.records) {
      if (!this._interactable(r)) continue;
      const d = (r.x - pos.x) ** 2 + (r.z - pos.z) ** 2;
      if (d <= r2) out.push({ d, info: r.info });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.info);
  }

  /**
   * Auto-pickup candidates within `radius` of `pos` (horizontal, within verticalReach):
   * settled floor ammo items and unopened ammo boxes. Fills and returns `out`.
   */
  autoPickups(pos, radius = LOOT.autoRange, out = []) {
    out.length = 0;
    const r2 = radius * radius;
    for (const r of this.records) {
      if (r.kind === 'item') {
        if (r.spill || !r.item || (r.item.type !== 'ammo' && r.item.type !== 'material')) continue;
      } else if (r.kind !== 'ammoBox' || r.opened) continue;
      if (Math.abs(r.y - pos.y) > LOOT.verticalReach) continue;
      if ((r.x - pos.x) ** 2 + (r.z - pos.z) ** 2 <= r2) out.push(r.info);
    }
    return out;
  }

  /** Minimap blips. The array is rebuilt only when loot changes. */
  blips() {
    if (!this._blipsDirty) return this._blips;
    const out = (this._blips = []);
    for (const r of this.records) {
      if (r.kind === 'chest' && !r.opened) out.push({ x: r.x, z: r.z, kind: 'chest' });
      else if (r.kind === 'item') out.push({ x: r.x, z: r.z, kind: 'loot' });
    }
    this._blipsDirty = false;
    return out;
  }

  // -------------------------------------------------------------- per frame

  update(dt, viewerPos) {
    this.time += dt;
    const t = this.time;
    const B = this.batches;
    for (const k in B) B[k] && B[k].begin();
    const hasViewer = !!viewerPos;
    const vx = hasViewer ? viewerPos.x : 0, vz = hasViewer ? viewerPos.z : 0;
    const cull2 = this.cullDist * this.cullDist;
    const S = LOOT.scale;

    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];

      if (r.spill) {
        const s = r.spill;
        s.t = Math.min(1, s.t + dt / 0.45);
        if (s.t >= 1) {
          r.spill = null;
          this._blipsDirty = true;
        }
      }
      if (r.kind !== 'item' && r.opened && r.open01 < 1) r.open01 = Math.min(1, r.open01 + dt * 2.6);

      const dx = r.x - vx, dz = r.z - vz;
      const d2 = hasViewer ? dx * dx + dz * dz : 0;
      if (hasViewer) this._effects(r, d2);
      if (d2 > cull2) continue;

      if (r.kind === 'item') {
        let x = r.x, y = r.y, z = r.z;
        if (r.spill) {
          const s = r.spill, k = s.t;
          x = s.fx + (r.x - s.fx) * k;
          z = s.fz + (r.z - s.fz) * k;
          y = s.fy + (r.y + 0.3 - s.fy) * k + Math.sin(Math.PI * k) * 1.1;
        } else y += 0.3 + Math.sin(t * 2.2 + r.phase) * 0.07;
        const it = r.item;
        let batch, sc, col = null, yaw = r.yaw + t * 1.1;
        switch (it.type) {
          case 'weapon':
            batch = B['w_' + it.id];
            sc = S.w;
            break;
          case 'consumable':
            batch = it.id === 'medkit' ? B.medkit : it.id === 'grenade' ? B.grenade : it.id === 'smoke' ? B.smoke : it.id === 'gascan' ? B.gascan : B.potion;
            sc = it.id === 'medkit' ? S.medkit : it.id === 'grenade' || it.id === 'smoke' ? S.grenade : it.id === 'gascan' ? S.medkit : S.potion;
            break;
          case 'ammo':
            batch = B.crate;
            sc = S.crateAmmo;
            col = LOOT.ammoTint[it.ammo] || 0xffffff;
            yaw = r.yaw;
            break;
          default:
            batch = B.crate;
            sc = S.crateMat;
            col = MATERIAL_COLOR[it.mat] || 0xffffff;
            yaw = r.yaw;
        }
        if (!batch) continue;
        _m.makeRotationY(yaw);
        _m.scale(_s.set(sc, sc, sc));
        _m.setPosition(x, y, z);
        batch.push(_m, col);
      } else {
        const chest = r.kind === 'chest';
        const sc = chest ? S.chest : S.ammo;
        _m.makeRotationY(r.yaw);
        _m.scale(_s.set(sc, sc, sc));
        _m.setPosition(r.x, r.y, r.z);
        (chest ? B.chestBody : B.ammoBody).push(_m);
        const lidB = chest ? B.chestLid : B.ammoLid;
        if (lidB) {
          const L = this._lids[chest ? 'chest' : 'ammo'];
          const ang = easeOutBack(r.open01) * 1.9;
          _l.makeRotationAxis(L.axis, ang);
          _v.copy(L.pivot).applyMatrix4(_l);
          _l.setPosition(L.pivot.x - _v.x, L.pivot.y - _v.y, L.pivot.z - _v.z);
          _o.multiplyMatrices(_m, _l);
          lidB.push(_o);
        }
      }
    }
    for (const k in B) B[k] && B[k].end();
  }

  _effects(r, d2) {
    const fx = this.fx;
    if (r.kind === 'item') {
      if (!fx) return;
      const D = LOOT.beamDist;
      if (!r.beam && !r.spill && d2 < D * D && this._beams < LOOT.maxBeams) {
        _p.set(r.x, r.y, r.z);
        r.beam = fx.lootBeam(_p, r.rarity);
        if (r.beam) this._beams++;
      } else if (r.beam && d2 > D * D * 1.32) {
        r.beam.remove();
        r.beam = null;
        this._beams--;
      }
      return;
    }
    if (r.kind !== 'chest' || r.opened) return;
    if (fx) {
      const G = LOOT.glowDist;
      if (!r.glow && d2 < G * G && this._glows < LOOT.maxGlows) {
        _p.set(r.x, r.y, r.z);
        r.glow = fx.chestGlow(_p);
        if (r.glow) this._glows++;
      } else if (r.glow && d2 > G * G * 1.32) {
        r.glow.remove();
        r.glow = null;
        this._glows--;
      }
    }
    if (this.sfx) {
      const H = LOOT.humDist;
      if (!r.hum && d2 < H * H) {
        this.sfx.startLoop('chest_hum', { id: r.id, x: r.x, y: r.y + 0.4, z: r.z });
        r.hum = true;
      } else if (r.hum && d2 > H * H * 1.44) {
        this.sfx.stopLoop('chest_hum', r.id);
        r.hum = false;
      }
    }
  }
}
