// BENTONVILLE ROYALE — the storm circle. Pure logic, no rendering.
//
// World convention: metres, x = east, z = south, y up.
//
// API (see agents/CONTRACTS.md)
// -----------------------------
//   const storm = new Storm({ world });
//   storm.reset(rng, { x, z })     // rng() -> [0,1); {x,z} = drop-zone landmark to bias the circles toward
//   storm.update(dt)               // advance the timeline; safe with any dt (crosses stage boundaries)
//
//   storm.cx, cz, r                // current (live) circle
//   storm.nextCx, nextCz, nextR    // target circle of the current phase
//   storm.phase                    // 1-based, for display (STORM.phases.length once done)
//   storm.mode                     // 'waiting' | 'shrinking' | 'final' | 'done'
//                                  //   'final' = the last phase (closing to radius 0), wait and shrink
//                                  //   'done'  = circle is gone; everyone is outside
//   storm.secondsLeft              // seconds left in the current wait / shrink stage (0 when done)
//   storm.dps                      // damage per second to anyone outside (current phase)
//   storm.isOutside(x, z), storm.distanceOutside(x, z), storm.intensityAt(x, z)
//   storm.hudState(x, z)           // -> { phase, secondsLeft, state, outside } for hud.setStorm()
//   storm.dormant                  // true during phase 1's wait when STORM.openStart is on: the
//                                  //   live circle (r) covers the map (up to STORM.openMaxRadius) and dps is 0. nextR still
//                                  //   holds phase 1's real target (bots path toward it); views should
//                                  //   hide the next ring while dormant (see Game._updateHud). Derived
//                                  //   from phase + mode, so it holds on clients fed by host snapshots.
//
// Extras
//   storm.shrinking                // true while the circle is moving (also in the final phase)
//   storm.phaseIndex               // 0-based index into STORM.phases
//   storm.elapsed, storm.totalTime // seconds since reset / sum of every wait + shrink
//   storm.skip()                   // debug: jump to the end of the current stage
//   The Storm object itself has the { cx, cz, r, nextCx, nextCz, nextR } shape that
//   Minimap.update({ storm }) and Atmosphere.setStorm() take, so pass it directly.
//
// Circle placement
//   Start circle: STORM.startRadius, centred on the map's origin (downtown) pulled toward
//   the drop zone so the drop zone sits well inside it, then clamped so the whole circle is
//   inside world.bounds. Each next circle lies fully inside the current one (|dc| <= r - nextR),
//   so every circle is inside the map. The first target is biased toward the drop zone; later
//   ones drift randomly. Small circles avoid water / blocked centres when the world can tell.
//   During a shrink, centre and radius share one eased parameter, which keeps every
//   intermediate circle inside the previous one and around the target.

import { STORM, clamp, lerp } from '../core/config.js';

const EDGE_WARN = 18; // metres inside the edge where intensity starts to rise
const DEEP = 90; // metres outside the edge for full intensity

const ease = (t) => t * t * (3 - 2 * t);

export class Storm {
  constructor({ world } = {}) {
    this.world = world || null;
    this.phases = STORM.phases;
    this.totalTime = this.phases.reduce((s, p) => s + p.wait + p.shrink, 0);
    this._rng = Math.random;
    this._center = { x: 0, z: 0 };
    this._from = { x: 0, z: 0, r: STORM.startRadius };
    this.cx = 0;
    this.cz = 0;
    this.r = STORM.startRadius;
    this.nextCx = 0;
    this.nextCz = 0;
    this.nextR = STORM.startRadius;
    this.phaseIndex = 0;
    this.phase = 1;
    this.mode = 'waiting';
    this.shrinking = false;
    this.secondsLeft = 0;
    this.dps = this.phases[0].dps;
    this.elapsed = 0;
    this._stageT = 0; // seconds into the current stage
    this._hud = { phase: 1, secondsLeft: 0, state: 'waiting', outside: false };
  }

  /** Opening state: the storm has not formed yet (phase 1, still waiting). */
  get dormant() {
    return !!STORM.openStart && this.phase === 1 && this.mode === 'waiting';
  }

  reset(rng, center) {
    this._rng = typeof rng === 'function' ? rng : Math.random;
    const b = this._bounds();
    const R = STORM.startRadius;
    const tx = center && Number.isFinite(center.x) ? center.x : 0;
    const tz = center && Number.isFinite(center.z) ? center.z : 0;
    this._center.x = tx;
    this._center.z = tz;

    // Map centre = projection origin (downtown); pull it toward the drop zone so the drop
    // zone is at most 0.4 R from the start centre, then keep the whole circle in bounds.
    let sx = 0;
    let sz = 0;
    const dx = tx - sx;
    const dz = tz - sz;
    const d = Math.hypot(dx, dz);
    const keep = R * 0.4;
    if (d > keep) {
      sx += (dx / d) * (d - keep);
      sz += (dz / d) * (d - keep);
    }
    const c = this._clampIn(sx, sz, R, b);
    this.cx = c.x;
    this.cz = c.z;
    this.r = R;

    this.phaseIndex = 0;
    this.phase = 1;
    this.elapsed = 0;
    this._stageT = 0;
    this.shrinking = false;
    this.mode = 'waiting';
    this._pickNext(true); // phase 1's target is picked inside the STORM.startRadius circle
    // Dormant opening: the live circle covers the whole map until phase 1's shrink, which then
    // closes from here straight to the target picked above (the target lies inside it).
    if (STORM.openStart) this.r = this._coverRadius(this.cx, this.cz, b);
    this._syncFrom();
    this._refresh();
    return this;
  }

  update(dt) {
    if (!(dt > 0) || this.mode === 'done') return;
    let left = dt;
    // loop so a huge dt walks through every stage it crosses
    while (left > 0 && this.mode !== 'done') {
      const p = this.phases[this.phaseIndex];
      const len = this.shrinking ? p.shrink : p.wait;
      const step = Math.min(left, len - this._stageT);
      this._stageT += step;
      this.elapsed += step;
      left -= step;
      if (this._stageT >= len - 1e-9) this._advance();
      else if (this.shrinking) this._interp(this._stageT / len);
    }
    this._refresh();
  }

  /** Debug: jump to the end of the current stage (wait -> shrink, shrink -> next phase). */
  skip() {
    if (this.mode === 'done') return;
    const p = this.phases[this.phaseIndex];
    const len = this.shrinking ? p.shrink : p.wait;
    this.update(Math.max(1e-6, len - this._stageT));
  }

  isOutside(x, z) {
    if (this.r <= 0) return true;
    const dx = x - this.cx;
    const dz = z - this.cz;
    return dx * dx + dz * dz > this.r * this.r;
  }

  distanceOutside(x, z) {
    return Math.max(0, Math.hypot(x - this.cx, z - this.cz) - this.r);
  }

  /** 0 = safely inside ... 1 = deep in the storm. Rises a little just inside the edge. */
  intensityAt(x, z) {
    if (this.r <= 0) return 1;
    const s = Math.hypot(x - this.cx, z - this.cz) - this.r; // signed distance, > 0 outside
    if (s <= -EDGE_WARN) return 0;
    if (s <= 0) return 0.25 * (1 + s / EDGE_WARN);
    return clamp(0.55 + 0.45 * (s / DEEP), 0, 1);
  }

  /** Reuses one object; hud.setStorm copies what it needs. */
  hudState(x, z) {
    const h = this._hud;
    h.phase = this.phase;
    h.secondsLeft = this.secondsLeft;
    h.state = this.mode === 'done' ? 'final' : this.mode;
    h.outside = Number.isFinite(x) && Number.isFinite(z) ? this.isOutside(x, z) : false;
    return h;
  }

  // ------------------------------------------------------------------ internals

  _advance() {
    this._stageT = 0;
    if (!this.shrinking) {
      this.shrinking = true;
      this._syncFrom();
      return;
    }
    // shrink finished: snap to the target, move to the next phase
    this.cx = this.nextCx;
    this.cz = this.nextCz;
    this.r = this.nextR;
    this.shrinking = false;
    if (this.phaseIndex >= this.phases.length - 1 || this.r <= 0) {
      this.r = Math.max(0, this.r);
      this.nextR = this.r;
      this.mode = 'done';
      return;
    }
    this.phaseIndex++;
    this.phase = this.phaseIndex + 1;
    this._pickNext(false);
    this._syncFrom();
  }

  _syncFrom() {
    this._from.x = this.cx;
    this._from.z = this.cz;
    this._from.r = this.r;
  }

  _interp(t) {
    const e = ease(clamp(t, 0, 1));
    const f = this._from;
    this.cx = lerp(f.x, this.nextCx, e);
    this.cz = lerp(f.z, this.nextCz, e);
    this.r = lerp(f.r, this.nextR, e);
  }

  _pickNext(first) {
    const p = this.phases[this.phaseIndex];
    const nr = Math.max(0, Math.min(p.radius, this.r));
    const slack = Math.max(0, this.r - nr) * 0.999; // tiny margin against float error
    const rng = this._rng;
    let bestX = this.cx;
    let bestZ = this.cz;
    let found = false;
    const tries = nr < 120 ? 12 : 1;
    for (let i = 0; i < tries && !found; i++) {
      let ox;
      let oz;
      if (first) {
        // toward the drop zone, plus some jitter
        const a = rng() * Math.PI * 2;
        const j = slack * 0.35 * Math.sqrt(rng());
        ox = this._center.x - this.cx + Math.cos(a) * j;
        oz = this._center.z - this.cz + Math.sin(a) * j;
      } else {
        const a = rng() * Math.PI * 2;
        const d = slack * Math.sqrt(rng());
        ox = Math.cos(a) * d;
        oz = Math.sin(a) * d;
      }
      const len = Math.hypot(ox, oz);
      if (len > slack && len > 0) {
        ox *= slack / len;
        oz *= slack / len;
      }
      bestX = this.cx + ox;
      bestZ = this.cz + oz;
      found = tries === 1 || this._goodCentre(bestX, bestZ);
    }
    if (!found) {
      bestX = this.cx;
      bestZ = this.cz;
    }
    this.nextCx = bestX;
    this.nextCz = bestZ;
    this.nextR = nr;
  }

  _goodCentre(x, z) {
    const w = this.world;
    if (!w) return true;
    try {
      if (typeof w.areaAt === 'function' && w.areaAt(x, z) === 'water') return false;
      if (typeof w.blockedAt === 'function' && w.blockedAt(x, z, 1)) return false;
    } catch {
      return true;
    }
    return true;
  }

  /** Radius (from cx, cz) that reaches past every map corner, plus STORM.openMargin. */
  _coverRadius(cx, cz, b) {
    const margin = STORM.openMargin || 0;
    if (!b) return STORM.startRadius * 6 + margin;
    let m = 0;
    for (const x of [b.minX, b.maxX]) for (const z of [b.minZ, b.maxZ]) m = Math.max(m, Math.hypot(x - cx, z - cz));
    // Capped (STORM.openMaxRadius): on a large map the far corners could be many km away and
    // phase 1's shrink would race inward. Corners past the cap start outside the (dps 0) circle.
    return Math.min(m + margin, STORM.openMaxRadius ?? Infinity);
  }

  _bounds() {
    const b = this.world && this.world.bounds;
    if (b && Number.isFinite(b.minX)) return b;
    return null;
  }

  _clampIn(x, z, r, b) {
    if (!b) return { x, z };
    const fit = (v, lo, hi) => (lo + r <= hi - r ? clamp(v, lo + r, hi - r) : (lo + hi) / 2);
    return { x: fit(x, b.minX, b.maxX), z: fit(z, b.minZ, b.maxZ) };
  }

  _refresh() {
    const last = this.phaseIndex >= this.phases.length - 1;
    const p = this.phases[this.phaseIndex];
    this.dps = p.dps;
    if (this.mode === 'done') {
      this.secondsLeft = 0;
      return;
    }
    this.mode = last ? 'final' : this.shrinking ? 'shrinking' : 'waiting';
    if (this.dormant) this.dps = 0; // the opening storm never hurts
    const len = this.shrinking ? p.shrink : p.wait;
    this.secondsLeft = Math.max(0, len - this._stageT);
  }
}
