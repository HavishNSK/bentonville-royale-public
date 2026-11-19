// BENTONVILLE ROYALE — dynamic resolution (settings: dynamicResolution).
//
// On a 60 Hz screen with vsync, a frame that takes a little over 33 ms is shown every third
// refresh, so a heavy moment (storm, lots of builds, a big monitor with Windows display
// scaling) drops straight to exactly 20 fps and stays there: it looks like an fps cap.
// This lowers the internal render resolution while the GPU can't keep up and brings it back
// once there is headroom again.
//
//   const dyn = new DynamicResolution();
//   if (dyn.update(frameMs, cpuMs)) renderer.setPixelRatio(basePr * dyn.scale);
//
// Pure (no DOM / three.js), so it can be tested.

const EMA_K = 0.1; // smoothing of the frame interval
const SLOW_FPS = 48; // below this counts as struggling
const FAST_FPS = 52; // at or above this counts as having headroom
const DROP_AFTER = 0.75; // s struggling before the resolution drops one step
const RAISE_AFTER = 4; // s with headroom before it tries one step up
const RAISE_BACKOFF_MAX = 60; // s: a step that failed is retried less and less often
const SETTLE = 0.5; // s ignored after every change (new render targets, first frames)
const CPU_BOUND = 0.8; // CPU work above this share of the frame: resolution won't help

export class DynamicResolution {
  constructor({ min = 0.5, step = 0.1 } = {}) {
    this.min = min;
    this.step = step;
    this.reset();
  }

  reset() {
    this.scale = 1;
    this._ema = 0;
    this._slowT = 0;
    this._fastT = 0;
    this._settle = SETTLE;
    this._fails = new Map(); // scale (rounded) -> times stepping up to it went back to slow
    this._lastUp = 0; // scale we last stepped up to (0: none pending)
    this._upHeld = 0; // s since that step up; once it held a while, it counts as fine
  }

  /**
   * One rendered frame. frameMs: interval since the previous frame, cpuMs: main-thread
   * work in it (simulation + present). Returns true when `scale` changed.
   */
  update(frameMs, cpuMs = 0) {
    if (!(frameMs > 0) || frameMs > 250) return false; // hitch / tab switch: not a reading
    const dt = frameMs / 1000;
    this._ema = this._ema ? this._ema + (frameMs - this._ema) * EMA_K : frameMs;
    const ema = this._ema;
    if (this._lastUp && (this._upHeld += dt) > 10) this._lastUp = 0;
    if (this._settle > 0) {
      this._settle -= dt;
      return false;
    }

    const slow = ema > 1000 / SLOW_FPS;
    const fast = ema <= 1000 / FAST_FPS;
    const gpuBound = cpuMs < ema * CPU_BOUND;

    if (slow && gpuBound) {
      this._fastT = 0;
      this._slowT += dt;
      if (this._slowT >= DROP_AFTER && this.scale > this.min + 1e-6) {
        if (this._lastUp) {
          const key = this._lastUp.toFixed(2);
          this._fails.set(key, (this._fails.get(key) || 0) + 1);
        }
        return this._set(this.scale - this.step);
      }
      return false;
    }
    this._slowT = 0;
    if (fast && this.scale < 1 - 1e-6) {
      this._fastT += dt;
      const next = Math.min(1, this.scale + this.step);
      const fails = this._fails.get(next.toFixed(2)) || 0;
      const wait = Math.min(RAISE_BACKOFF_MAX, RAISE_AFTER * 2 ** fails);
      if (this._fastT >= wait) {
        const changed = this._set(next);
        this._lastUp = this.scale;
        this._upHeld = 0;
        return changed;
      }
    } else {
      this._fastT = 0;
    }
    return false;
  }

  _set(s) {
    s = Math.round(Math.min(1, Math.max(this.min, s)) * 100) / 100;
    this._slowT = 0;
    this._fastT = 0;
    this._settle = SETTLE;
    this._lastUp = 0;
    if (s === this.scale) return false;
    this.scale = s;
    return true;
  }
}
