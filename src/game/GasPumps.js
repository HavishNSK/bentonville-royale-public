// BENTONVILLE ROYALE — gas pumps: the hand-held nozzle that refuels cars, and pumps that burn and
// blow up (a whole station goes up in a chain).
//
//   const gp = new GasPumps({ world, fx, sfx, combat, vehicles, hoseView });
//   gp.setup(stations)                // after buildGasStations: one record per pump (4 a station)
//   gp.reset({ authoritative })       // match start: every pump whole, every nozzle hung up
//
// Nozzle (on foot): within STATION.grabRange of a live pump, interact grabs its nozzle (one holder
// per pump). Walking more than STATION.hoseLen from the pump snaps it back; interact again, a slot
// switch, a car seat, going down or dying hangs it up. Holding fire within STATION.fuelRange of a
// live car's body pumps STATION.refuelRate fuel a second into it, up to a full tank.
//   gp.grab(actor, pump) / gp.hangUp(actor) / gp.setFueling(actor, car)   (authoritative)
//   gp.heldPump(actor) / gp.pumpFor(actor) / gp.fuelTarget(actor)          (queries, any side)
//
// Damage: every pump has STATION.pumpHp. Bullets, the pickaxe, grenades / rockets and cars driven
// into it take hp off. At STATION.fireAt of its hp it catches fire and burns down by itself; at 0
// it explodes (actors and cars nearby take a falloff blast), leaves a scorched stump and, after a
// short random delay each, sets every other pump of the same station on fire: a chain.
//   gp.damage(pump, amount, info) / gp.blast(pos, radius, damage, info)    (authoritative)
//
// Multiplayer: the host (or solo) decides everything and emits events through onEvent:
//   { e: 'pmd', p, hp }  pump hp            { e: 'pmf', p }  caught fire
//   { e: 'pmx', p }      exploded           { e: 'pmn', a, p, r }  actor a holds pump p (-1: none;
//                                                                 r = 1 when it snapped back)
// Clients mirror them with applyEvent; a client's nozzle requests travel as 'pmp' actions (see
// HostSession) and the host re-checks every one with a little lag slack. Fuel reaches clients
// through the cars' usual 'vf' events (Vehicles.pumpFuel).

import { STATION, stationToWorld, pumpSpots, pumpHoseLocal } from './vehicles/gasStations.js';
import { CAR } from './vehicles/cars.js';
import { distToCar } from './vehicles/carHit.js';

export const PUMP_NET_SLACK = 1.5; // m of lag allowance when the host checks a remote player
const RAM_SPEED = 5; // m/s: a car slower than this only bumps a pump
const RAM_BASE = 30; // pump damage from a car hitting it at RAM_SPEED...
const RAM_MUL = 12; // ...plus this per m/s faster (20 m/s: 210, a pump and a half)
const SMOKE_AT = 0.6; // hp fraction: a hurt pump smokes (fire below STATION.fireAt)
const FX_DIST = 160; // m: no smoke / fire puffs further than this from the camera

export class GasPumps {
  constructor({ world = null, fx = null, sfx = null, combat = null, vehicles = null, hoseView = null, rng = Math.random } = {}) {
    this.world = world;
    this.fx = fx;
    this.sfx = sfx;
    this.combat = combat;
    this.vehicles = vehicles;
    this.hoseView = hoseView;
    this.rng = rng;
    this.pumps = [];
    this.byId = new Map();
    this.holders = new Map(); // actor id -> { actor, pump, car }
    this.authoritative = true;
    this.onEvent = null;
    this.viewer = null; // camera position (effects culling)
    this.time = 0;
    this._fxT = 0;
  }

  _emit(e) {
    if (this.authoritative && this.onEvent) this.onEvent(e);
  }

  // ---------------------------------------------------------------- setup

  /** One record per pump of every station (ids: station index * 4 + pump index). */
  setup(stations) {
    this.pumps = [];
    this.byId.clear();
    const spots = pumpSpots();
    for (const st of stations || []) {
      const cols = new Map();
      for (const c of st.colliders || []) if (c.pumpIdx != null) cols.set(c.pumpIdx, c);
      for (const sp of spots) {
        const p = stationToWorld(st, sp.u, sp.v);
        const hl = pumpHoseLocal(sp);
        const h = stationToWorld(st, hl.u, hl.v);
        const y = Number.isFinite(st.y) ? st.y : 0;
        const pump = {
          id: st.i * spots.length + sp.k,
          st,
          k: sp.k,
          x: p.x,
          y,
          z: p.z,
          hose: { x: h.x, y: y + hl.y, z: h.z },
          maxHp: STATION.pumpHp,
          hp: STATION.pumpHp,
          burning: false,
          dead: false,
          chainT: -1,
          holder: null,
          lastAttacker: null,
          col: cols.get(sp.k) || null,
          _ramT: -Infinity,
          _fxT: 0,
        };
        if (pump.col) {
          pump.col.pump = pump;
          pump.colTop = pump.col.y1;
        }
        this.pumps.push(pump);
        this.byId.set(pump.id, pump);
      }
    }
    return this.pumps;
  }

  /** Match start: every pump whole, nobody holding a nozzle. */
  reset({ authoritative = true } = {}) {
    this.authoritative = authoritative;
    this.time = 0;
    for (const h of [...this.holders.values()]) this._release(h.actor, false);
    this.holders.clear();
    for (const p of this.pumps) {
      Object.assign(p, { hp: p.maxHp, burning: false, dead: false, chainT: -1, holder: null, lastAttacker: null, _ramT: -Infinity });
      this._setCollider(p);
      this._show(p);
    }
    if (this.hoseView) this.hoseView.sync([]);
  }

  // ---------------------------------------------------------------- queries

  /** Nearest pump in reach of `actor` whose nozzle it could grab (alive, free), or null. */
  pumpFor(actor, range = STATION.grabRange) {
    if (!actor || !actor.pos) return null;
    let best = null;
    let bd = range;
    for (const p of this.pumps) {
      if (p.dead || (p.holder && p.holder !== actor)) continue;
      if (Math.abs(p.x - actor.pos.x) > range + 1 || Math.abs(p.z - actor.pos.z) > range + 1) continue;
      if (Math.abs(actor.pos.y - p.y) > 2) continue;
      const d = Math.hypot(p.x - actor.pos.x, p.z - actor.pos.z);
      if (d <= bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** The pump whose nozzle `actor` holds, or null. */
  heldPump(actor) {
    const h = actor && this.holders.get(actor.id);
    return h ? h.pump : null;
  }

  /** The car (alive, not full or full) the holder could fuel from where it stands, or null. */
  fuelTarget(actor, range = STATION.fuelRange) {
    const V = this.vehicles;
    if (!actor || !actor.pos || !V || !V.cars) return null;
    let best = null;
    let bd = range;
    for (const car of V.cars) {
      if (!car.alive) continue;
      if (Math.abs(actor.pos.y - car.y) > 2.5) continue;
      const d = distToCar(car, actor.pos.x, actor.pos.z);
      if (d <= bd) {
        bd = d;
        best = car;
      }
    }
    return best;
  }

  /** Can `actor` take `pump`'s nozzle now? `slack` m extra reach (host checking a remote). */
  canGrab(actor, pump, slack = 0) {
    if (!actor || !pump || pump.dead || !actor.alive || actor.downed || actor.vehicle || actor.inBus || actor.airborneDrop || actor.carrying) return false;
    if (pump.holder && pump.holder !== actor) return false;
    if (Math.abs(actor.pos.y - pump.y) > 2 + slack) return false;
    return Math.hypot(pump.x - actor.pos.x, pump.z - actor.pos.z) <= STATION.grabRange + slack;
  }

  // ---------------------------------------------------------------- nozzle (authoritative)

  grab(actor, pump, slack = 0) {
    if (!this.authoritative || !this.canGrab(actor, pump, slack)) return false;
    const had = this.holders.get(actor.id);
    if (had && had.pump === pump) return true;
    if (had) this._release(actor, false);
    this._hold(actor, pump);
    this._emit({ e: 'pmn', a: actor.id, p: pump.id });
    return true;
  }

  /** Hang the nozzle back up (or it snapped back: `snap`). Returns true when one was held. */
  hangUp(actor, snap = false) {
    if (!this.authoritative || !actor || !this.holders.has(actor.id)) return false;
    this._release(actor, snap);
    this._emit({ e: 'pmn', a: actor.id, p: -1, r: snap ? 1 : 0 });
    return true;
  }

  /** Start (car) / stop (null) pumping into a car; checked again every frame in update(). */
  setFueling(actor, car) {
    const h = actor && this.holders.get(actor.id);
    if (!h) return false;
    if (h.car && h.car !== car) this._fuelDone(h.car);
    h.car = car && car.alive ? car : null;
    return !!h.car;
  }

  _hold(actor, pump) {
    pump.holder = actor;
    this.holders.set(actor.id, { actor, pump, car: null });
    this._show(pump);
    if (this.sfx) this.sfx.play('weapon_switch', { x: pump.x, y: pump.y + 1, z: pump.z, volume: 0.6 });
  }

  _release(actor, snap) {
    const h = this.holders.get(actor.id);
    if (!h) return;
    this.holders.delete(actor.id);
    if (h.car) this._fuelDone(h.car);
    if (h.pump.holder === actor) h.pump.holder = null;
    this._show(h.pump);
    if (this.sfx) {
      const at = actor.pos || h.pump;
      if (snap) this.sfx.play('hit_metal', { x: at.x, y: (at.y || 0) + 1, z: at.z, volume: 0.9 });
      else this.sfx.play('weapon_switch', { x: h.pump.x, y: h.pump.y + 1, z: h.pump.z, volume: 0.5 });
    }
  }

  _fuelDone(car) {
    const V = this.vehicles;
    if (V && V.pumpFuelDone) V.pumpFuelDone(car);
  }

  /** Authoritative: keeps every holder honest and pumps the fuel. */
  _tickNozzles(dt) {
    const V = this.vehicles;
    for (const h of [...this.holders.values()]) {
      const a = h.actor;
      const p = h.pump;
      const slack = a.isRemote ? PUMP_NET_SLACK : 0;
      if (!a.alive || a.downed || a.vehicle || a.carrying || p.dead) {
        this.hangUp(a, false);
        continue;
      }
      if (Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > STATION.hoseLen + slack || Math.abs(a.pos.y - p.y) > 4) {
        this.hangUp(a, true);
        continue;
      }
      const car = h.car;
      if (!car) continue;
      if (!car.alive || distToCar(car, a.pos.x, a.pos.z) > STATION.fuelRange + slack || Math.abs(a.pos.y - car.y) > 3) {
        this.setFueling(a, null);
        continue;
      }
      if (!(car.fuel < CAR.fuelMax)) continue;
      let add = Math.min(CAR.fuelMax - car.fuel, STATION.refuelRate * dt);
      if (CAR.fuelMax - car.fuel - add < 0.05) add = CAR.fuelMax - car.fuel; // no 99.99
      if (V && V.pumpFuel) V.pumpFuel(car, add);
      else car.fuel = Math.min(CAR.fuelMax, Math.max(0, car.fuel) + add);
    }
  }

  // ---------------------------------------------------------------- damage (authoritative)

  damage(pump, amount, info = {}) {
    if (!this.authoritative || !pump || pump.dead || !(amount > 0)) return 0;
    if (info.source) pump.lastAttacker = info.source;
    pump.hp = Math.max(0, pump.hp - amount);
    if (pump.hp <= 0) {
      this.explode(pump, info);
      return amount;
    }
    this._emit({ e: 'pmd', p: pump.id, hp: Math.round(pump.hp) });
    if (!pump.burning && pump.hp <= pump.maxHp * STATION.fireAt) this.ignite(pump);
    return amount;
  }

  /** Area damage (grenades, rockets, other pumps): falls off to 40% at the edge. */
  blast(pos, radius, damage, info = {}, except = null) {
    if (!this.authoritative || !pos) return;
    for (const p of this.pumps) {
      if (p.dead || p === except) continue;
      if (Math.abs(p.x - pos.x) > radius + 1 || Math.abs(p.z - pos.z) > radius + 1) continue;
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d > radius || Math.abs((pos.y || 0) - (p.y + 1)) > radius) continue;
      this.damage(p, damage * (1 - 0.6 * (d / radius)), info);
    }
  }

  ignite(pump) {
    if (!pump || pump.dead || pump.burning) return;
    pump.burning = true;
    pump.chainT = -1;
    this._emit({ e: 'pmf', p: pump.id });
  }

  explode(pump, info = {}) {
    if (!pump || pump.dead) return;
    pump.dead = true;
    pump.burning = false;
    pump.hp = 0;
    pump.chainT = -1;
    if (pump.holder) {
      if (this.authoritative) this.hangUp(pump.holder, false);
      else this._release(pump.holder, false);
    }
    this._setCollider(pump);
    this._show(pump);
    this._blowFx(pump);
    this._emit({ e: 'pmx', p: pump.id });
    if (!this.authoritative) return;
    // the same station's other pumps catch fire, one after another
    const [d0, d1] = STATION.chainDelay;
    for (const o of this.pumps) {
      if (o.st !== pump.st || o === pump || o.dead || o.burning || o.chainT >= 0) continue;
      o.chainT = d0 + this.rng() * (d1 - d0);
    }
    const source = pump.lastAttacker || info.source || null;
    const point = { x: pump.x, y: pump.y + 1, z: pump.z };
    const R = STATION.blastRadius;
    const c = this.combat;
    if (c && c.applyDamage) {
      for (const a of c.actors || []) {
        if (!a.alive || a.inBus || a.vehicle) continue;
        const d = Math.hypot(a.pos.x - pump.x, a.pos.z - pump.z);
        if (d > R || Math.abs(a.pos.y - pump.y) > 3) continue;
        const dmg = STATION.blastDamage + (STATION.blastMinDamage - STATION.blastDamage) * (d / R);
        c.applyDamage(a, dmg, { source, weapon: 'pump_explosion', explosive: true, point });
      }
    }
    if (this.vehicles && this.vehicles.blast) this.vehicles.blast(point, R, STATION.blastCarDamage, { source, weapon: 'pump_explosion' });
    // pumps of another station close enough (none today) take the blast too
    for (const o of this.pumps) {
      if (o.dead || o.st === pump.st) continue;
      const d = Math.hypot(o.x - pump.x, o.z - pump.z);
      if (d <= R) this.damage(o, STATION.blastPumpDamage * (1 - 0.6 * (d / R)), { source });
    }
  }

  /** Cars driven into a pump dent it (authoritative). */
  _rams() {
    const V = this.vehicles;
    if (!V || !V.cars) return;
    for (const car of V.cars) {
      const sp = Math.max(Math.abs(car.speed || 0), car._gpPrev || 0);
      car._gpPrev = Math.abs(car.speed || 0);
      if (!car.alive || sp < RAM_SPEED) continue;
      for (const p of this.pumps) {
        if (p.dead || Math.abs(p.x - car.x) > 8 || Math.abs(p.z - car.z) > 8) continue;
        if (this.time - p._ramT < 0.6) continue;
        if (Math.abs(car.y - p.y) > 2) continue;
        if (distToCar(car, p.x, p.z) > STATION.pump.hu + 0.35) continue;
        p._ramT = this.time;
        if (this.sfx) this.sfx.play('car_crash', { x: p.x, y: p.y + 1, z: p.z, volume: 0.8 });
        this.damage(p, RAM_BASE + (sp - RAM_SPEED) * RAM_MUL, { source: car.seats ? car.seats[0] || null : null, weapon: 'car_ram' });
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt, actors = []) {
    if (!(dt > 0)) return;
    void actors;
    this.time += dt;
    if (this.authoritative) {
      for (const p of this.pumps) {
        if (p.dead) continue;
        if (p.chainT >= 0) {
          p.chainT -= dt;
          if (p.chainT < 0) {
            // chain fire: it is already as good as gone
            p.hp = Math.min(p.hp, p.maxHp * STATION.fireAt);
            this._emit({ e: 'pmd', p: p.id, hp: Math.round(p.hp) });
            this.ignite(p);
          }
        }
        if (p.burning) {
          p.hp -= STATION.burnRate * dt;
          if (p.hp <= 0) this.explode(p, { source: p.lastAttacker });
        }
      }
      this._rams();
      this._tickNozzles(dt);
    }
    this._present(dt);
  }

  _near(x, z, d) {
    const v = this.viewer;
    return !v || Math.abs(v.x - x) + Math.abs(v.z - z) < d * 1.4;
  }

  /** Effects (smoke / fire on hurt pumps) and the hoses in people's hands. */
  _present(dt) {
    if (this.fx && this.fx.carSmoke) {
      for (const p of this.pumps) {
        if (p.dead || p.hp > p.maxHp * SMOKE_AT) continue;
        p._fxT -= dt;
        if (p._fxT > 0 || !this._near(p.x, p.z, FX_DIST)) continue;
        p._fxT = p.burning ? 0.07 : 0.3;
        const at = { x: p.x + (this.rng() - 0.5) * 0.4, y: p.y + STATION.pump.h - 0.1, z: p.z + (this.rng() - 0.5) * 0.3 };
        if (p.burning && this.fx.flames) this.fx.flames(at, 1.8);
        else this.fx.carSmoke(at, p.burning);
      }
    }
    if (this.hoseView) {
      const list = [];
      for (const h of this.holders.values()) {
        const a = h.actor;
        if (!a || !a.pos || (a.character && a.character.root && a.character.root.visible === false)) continue;
        list.push({ id: a.id, from: h.pump.hose, to: handPos(a), ground: h.pump.y });
      }
      this.hoseView.sync(list);
    }
  }

  _blowFx(pump) {
    const p = { x: pump.x, y: pump.y + 1, z: pump.z };
    if (this.fx) {
      if (this.fx.explosion) this.fx.explosion(p, { radius: STATION.blastRadius * 0.8 });
      if (this.fx.debris) this.fx.debris({ x: p.x, y: p.y + 0.4, z: p.z }, 'metal', { count: 14, size: 0.18, spread: 2.5 });
    }
    if (this.sfx) this.sfx.play('explosion', { x: p.x, y: p.y, z: p.z, volume: 1 });
  }

  /** A dead pump is a 0.4 m stump: shots and people pass over it. */
  _setCollider(p) {
    const c = p.col;
    if (!c || !Number.isFinite(p.colTop)) return;
    const top = p.dead ? c.y0 + 0.4 : p.colTop;
    c.y1 = top;
    c.h = top;
    c.hgt = top - c.y0;
  }

  /** The station mesh's pump: whole / stump, nozzle in its holster or out. */
  _show(p) {
    const m = p.st && p.st.mesh && p.st.mesh.userData;
    if (m && m.setPump) m.setPump(p.k, { dead: p.dead, held: !!p.holder });
  }

  // ---------------------------------------------------------------- network

  /** Client: mirror the host's events. actorById(id) -> actor (or a Map). */
  applyEvent(e, actorById) {
    const find = (id) => (typeof actorById === 'function' ? actorById(id) : actorById && actorById.get ? actorById.get(id) : null);
    if (e.e === 'pmn') {
      const a = find(e.a);
      if (!a) return;
      if (this.holders.has(a.id)) this._release(a, !!e.r);
      const p = this.byId.get(e.p);
      if (p && !p.dead) {
        if (p.holder && p.holder !== a) this._release(p.holder, false);
        this._hold(a, p);
      }
      return;
    }
    const p = this.byId.get(e.p);
    if (!p) return;
    switch (e.e) {
      case 'pmd':
        if (!p.dead) p.hp = Math.max(1, Math.min(p.maxHp, +e.hp || 1));
        return;
      case 'pmf':
        if (!p.dead) {
          p.burning = true;
          p.hp = Math.min(p.hp, p.maxHp * STATION.fireAt);
        }
        return;
      case 'pmx':
        this.explode(p);
        return;
    }
  }

  /** Host: the pumps' state for a client joining mid-match: [[id, hp, flags]] of hurt pumps. */
  snapshot() {
    const rows = [];
    for (const p of this.pumps) if (p.dead || p.burning || p.hp < p.maxHp) rows.push([p.id, Math.round(p.hp), (p.dead ? 1 : 0) | (p.burning ? 2 : 0)]);
    return rows;
  }

  /** Client: applies snapshot() rows (no explosions replayed: dead pumps are just stumps). */
  applySnapshot(rows) {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      const p = Array.isArray(r) ? this.byId.get(r[0]) : null;
      if (!p) continue;
      const dead = !!(r[2] & 1);
      p.dead = dead;
      p.burning = !dead && !!(r[2] & 2);
      p.hp = dead ? 0 : Math.max(1, Math.min(p.maxHp, +r[1] || 1));
      if (dead && p.holder) this._release(p.holder, false);
      this._setCollider(p);
      this._show(p);
    }
  }
}

/** World position of an actor's right hand (the character's hand bone, else a guess). */
export function handPos(a, out = { x: 0, y: 0, z: 0 }) {
  const ch = a.character;
  const b = ch && ch.bones && (ch.bones.handslotr || ch.bones.handr);
  if (b && b.matrixWorld && b.matrixWorld.elements) {
    const e = b.matrixWorld.elements;
    out.x = e[12];
    out.y = e[13];
    out.z = e[14];
    return out;
  }
  const h = Number.isFinite(a.heading) ? a.heading : 0;
  out.x = a.pos.x + Math.sin(h) * 0.35 + Math.cos(h) * 0.25;
  out.y = a.pos.y + 1.1;
  out.z = a.pos.z - Math.cos(h) * 0.35 + Math.sin(h) * 0.25;
  return out;
}
