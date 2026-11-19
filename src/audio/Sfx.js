/**
 * Sfx.js — fully synthesized sound effects, ambient loops and music.
 *
 * Web Audio API only: every sound is built at runtime from oscillators, noise
 * buffers, filters and envelopes. Weapon/impact sounds may also carry recorded
 * CC0 samples (public/assets/sfx, credits/audio.md) that are fetched + decoded
 * on unlock and preferred when ready; the synth recipe is always the fallback.
 *
 *   import { sfx } from './audio/Sfx.js';
 *   window.addEventListener('pointerdown', () => sfx.unlock());
 *   sfx.setListener(cam.x, cam.y, cam.z, forwardX, forwardZ);   // every frame
 *   sfx.play('shot_rifle', { x, y, z });
 *
 * Every public method is a silent no-op (never throws) when audio is
 * unavailable or has not been unlocked yet. See README.md for the name list.
 */

const EPS = 0.0001;
const NO_OPTS = Object.freeze({});
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const mtof = (note) => 440 * Math.pow(2, (note - 69) / 12);
const wallNow = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// ---------------------------------------------------------------------------
// Noise buffers (generated once per AudioContext)
// ---------------------------------------------------------------------------

function makeNoiseBuffers(ctx) {
  const sr = ctx.sampleRate || 44100;
  const make = (seconds, fill) => {
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, n, sr);
    fill(buf.getChannelData(0), n);
    return buf;
  };
  // Coloured noise is correlated sample to sample, so the tail is cross-faded
  // into the head to make the buffer loop without a click.
  const coloured = (seconds, gen) => make(seconds, (out, n) => {
    const x = Math.floor(sr * 0.25);
    const raw = new Float32Array(n + x);
    gen(raw);
    let mean = 0;
    for (let i = 0; i < raw.length; i++) mean += raw[i];
    mean /= raw.length;
    let peak = EPS;
    for (let i = 0; i < raw.length; i++) {
      raw[i] -= mean;
      const a = Math.abs(raw[i]);
      if (a > peak) peak = a;
    }
    const k = 0.95 / peak;
    for (let i = 0; i < n; i++) out[i] = raw[i] * k;
    for (let i = 0; i < x; i++) {
      const a = i / x;
      out[i] = (raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a)) * k;
    }
  });
  return {
    white: make(2, (out, n) => {
      for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1;
    }),
    pink: coloured(4, (raw) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < raw.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        raw[i] = b0 + b1 + b2 + w * 0.1848;
      }
    }),
    brown: coloured(4, (raw) => {
      let last = 0;
      for (let i = 0; i < raw.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        raw[i] = last;
      }
    }),
  };
}

// ---------------------------------------------------------------------------
// Output guard. The compressor's 4 ms attack lets transients through, and
// summed gunshots measured well above full scale, which the sound card would
// hard-clip. After the compressor the mix gets a fixed trim and then a soft
// clipper that is exactly linear below CLIP_KNEE and can never exceed 1.0.
// ---------------------------------------------------------------------------

const OUT_TRIM = 0.8;
const CLIP_KNEE = 0.75;
const CLIP_RANGE = 4; // shaper input span: the curve covers -4 .. +4

function makeClipCurve() {
  const n = 4097; // knots land exactly on 0 and on +/- CLIP_KNEE
  const curve = new Float32Array(n);
  const span = 1 - CLIP_KNEE;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    const y = a <= CLIP_KNEE ? a : CLIP_KNEE + span * Math.tanh((a - CLIP_KNEE) / span);
    curve[i] = Math.min(1, y) * Math.sign(x);
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Voice: a tiny synth toolkit used by every recipe (one-shots and music)
// ---------------------------------------------------------------------------

/**
 * tone({ type, at, f, f2, ft, fenv, dur, g, a, hold, env, detune, flt, am, vib, fm, dest })
 * noise({ type: 'white'|'pink'|'brown', at, dur, g, a, hold, env, flt, rate, dest })
 *   at    start offset (s)            dur   length (s)
 *   f/f2  start/end frequency, ft = sweep time; fenv = [[t, hz], ...]
 *   g     peak gain; a = attack; default envelope is percussive (exp decay)
 *   env   [[t, level], ...] linear breakpoints (level * g) instead of percussive
 *   flt   { type, f, f2, ft, fenv, q } per-source biquad
 *   am    { f, f2, depth, type }  tremolo;  vib { f, cents }  vibrato
 *   fm    { ratio, index, index2 } simple 2-operator FM (bells, metal)
 */
class Voice {
  constructor(ctx, dest, t0, pitch, noise) {
    this.ctx = ctx;
    this.dest = dest;
    this.t0 = t0;
    this.pitch = pitch;
    this.noiseBufs = noise;
    this.sources = [];
    this.end = t0;
    this.last = null;
  }

  _reg(src, start, stop, offset) {
    if (offset === undefined) src.start(start);
    else src.start(start, offset);
    src.stop(stop);
    this.sources.push(src);
    if (stop > this.end) {
      this.end = stop;
      this.last = src;
    }
  }

  _env(param, t, dur, o) {
    const g = Math.max(EPS, o.g === undefined ? 0.5 : o.g);
    if (o.env) {
      const e = o.env;
      let i = 0;
      if (e[0][0] <= 0) {
        param.setValueAtTime(Math.max(0, e[0][1] * g), t);
        i = 1;
      } else {
        param.setValueAtTime(0, t);
      }
      for (; i < e.length; i++) param.linearRampToValueAtTime(Math.max(0, e[i][1] * g), t + e[i][0]);
      return;
    }
    const a = Math.min(o.a === undefined ? 0.002 : o.a, dur * 0.5);
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(g, t + a);
    if (o.hold) param.setValueAtTime(g, Math.min(t + a + o.hold, t + dur * 0.9));
    param.exponentialRampToValueAtTime(EPS, t + dur);
  }

  _sweep(param, t, dur, o, max) {
    const k = this.pitch;
    const lim = (hz) => clamp(hz * k, 1, max);
    param.setValueAtTime(lim(o.f), t);
    if (o.fenv) {
      for (let i = 0; i < o.fenv.length; i++) param.exponentialRampToValueAtTime(lim(o.fenv[i][1]), t + o.fenv[i][0]);
    } else if (o.f2 !== undefined) {
      param.exponentialRampToValueAtTime(lim(o.f2), t + (o.ft === undefined ? dur : o.ft));
    }
  }

  _filter(t, dur, f) {
    const flt = this.ctx.createBiquadFilter();
    flt.type = f.type || 'lowpass';
    flt.Q.value = f.q === undefined ? 0.7 : f.q;
    this._sweep(flt.frequency, t, dur, f, 18000);
    return flt;
  }

  _lfo(t, stop, type, f, f2, dur, amount, target) {
    const ctx = this.ctx;
    const lfo = ctx.createOscillator();
    lfo.type = type || 'sine';
    lfo.frequency.setValueAtTime(Math.max(0.01, f), t);
    if (f2 !== undefined) lfo.frequency.exponentialRampToValueAtTime(Math.max(0.01, f2), t + dur);
    const depth = ctx.createGain();
    depth.gain.value = amount;
    lfo.connect(depth);
    depth.connect(target);
    this._reg(lfo, t, stop);
  }

  tone(o) {
    const ctx = this.ctx;
    const t = this.t0 + (o.at || 0);
    const dur = o.dur === undefined ? 0.1 : o.dur;
    const stop = t + dur + 0.02;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    this._sweep(osc.frequency, t, dur, o, 20000);
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) this._lfo(t, stop, 'sine', o.vib.f, undefined, dur, o.vib.cents, osc.detune);
    if (o.fm) {
      const mf = clamp(o.f * this.pitch * o.fm.ratio, 1, 20000);
      const mod = ctx.createOscillator();
      mod.frequency.value = mf;
      const depth = ctx.createGain();
      const i2 = o.fm.index2 === undefined ? o.fm.index * 0.1 : o.fm.index2;
      depth.gain.setValueAtTime(Math.max(EPS, mf * o.fm.index), t);
      depth.gain.exponentialRampToValueAtTime(Math.max(EPS, mf * i2), t + dur);
      mod.connect(depth);
      depth.connect(osc.frequency);
      this._reg(mod, t, stop);
    }
    let node = osc;
    if (o.flt) {
      const flt = this._filter(t, dur, o.flt);
      node.connect(flt);
      node = flt;
    }
    if (o.am) {
      const amp = ctx.createGain();
      amp.gain.value = 1 - o.am.depth * 0.5;
      this._lfo(t, stop, o.am.type, o.am.f, o.am.f2, dur, o.am.depth * 0.5, amp.gain);
      node.connect(amp);
      node = amp;
    }
    const env = ctx.createGain();
    this._env(env.gain, t, dur, o);
    node.connect(env);
    env.connect(o.dest || this.dest);
    this._reg(osc, t, stop);
  }

  noise(o) {
    const ctx = this.ctx;
    const t = this.t0 + (o.at || 0);
    const dur = o.dur === undefined ? 0.1 : o.dur;
    const buf = this.noiseBufs[o.type || 'white'];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    let node = src;
    if (o.flt) {
      const flt = this._filter(t, dur, o.flt);
      node.connect(flt);
      node = flt;
    }
    const env = ctx.createGain();
    this._env(env.gain, t, dur, o);
    node.connect(env);
    env.connect(o.dest || this.dest);
    this._reg(src, t, t + dur + 0.02, Math.random() * Math.max(0, buf.duration - 0.1));
  }
}

// Small shared building blocks -------------------------------------------------

const thump = (v, at, f, f2, dur, g) => v.tone({ at, f, f2, ft: dur * 0.6, dur, g, a: 0.002 });
const tick = (v, at, f, dur, g, type = 'bandpass', q = 1.2) =>
  v.noise({ at, dur, g, a: 0.001, flt: { type, f, q } });
const bell = (v, at, f, dur, g, dest) => {
  v.tone({ at, f, dur, g, a: 0.002, fm: { ratio: 3.01, index: 1.1, index2: 0.03 }, dest });
  v.tone({ at, f: f * 2, dur: dur * 0.45, g: g * 0.22, a: 0.002, dest });
};
const blip = (v, at, f, dur, g, type = 'triangle') => {
  v.tone({ type, at, f, dur, g, a: 0.003 });
  v.tone({ at, f: f * 2, dur: dur * 0.6, g: g * 0.3, a: 0.003 });
};

// ---------------------------------------------------------------------------
// One-shot recipes
//   vol   base gain            ref/max  full-volume radius / silence radius (m)
//   roll  falloff exponent     vary     random pitch spread (+/- fraction)
//   pri   priority multiplier used when voices have to be dropped
//   sample   optional recorded variants: a URL list (round-robin) or
//            { key: [urls], default: [urls] } chosen by opts[sampleBy]
//   sgain    extra gain applied to the sample (balances it against the synth)
// When a sample is decoded it plays through the same gain / distance lowpass /
// pan / throttle / voice-steal chain; otherwise the synth recipe `fn` runs.
// ---------------------------------------------------------------------------

const SOUNDS = Object.create(null);
const def = (name, cfg, fn) => {
  SOUNDS[name] = { vol: 1, ref: 8, max: 120, roll: 2, vary: 0.04, pri: 1, ...cfg, name, fn };
};

// Recorded samples live in public/assets/sfx/<stem>_<n>.mp3 (see credits/audio.md).
const SAMPLE_BASE = (() => {
  try {
    const b = import.meta.env && import.meta.env.BASE_URL;
    return (typeof b === 'string' && b ? b.replace(/\/?$/, '/') : '/') + 'assets/sfx/';
  } catch (e) {
    return '/assets/sfx/';
  }
})();
const smp = (stem, n) => Array.from({ length: n }, (_, i) => `${SAMPLE_BASE}${stem}_${i + 1}.mp3`);
// surface names the game uses -> sample keys
const SAMPLE_ALIAS = { brick: 'stone', concrete: 'stone', dirt: 'stone', rock: 'stone', flesh: 'body', player: 'body' };

// --- Weapons ---------------------------------------------------------------

def('shot_rifle', { sample: smp('rifle', 3), sgain: 0.72, vol: 0.8, ref: 10, max: 170, roll: 1.7, vary: 0.05, pri: 1.2 }, (v) => {
  v.noise({ dur: 0.2, g: 0.9, a: 0.001, flt: { type: 'lowpass', f: 7000, f2: 700, ft: 0.13, q: 0.7 } });
  v.noise({ dur: 0.03, g: 0.5, a: 0.001, flt: { type: 'highpass', f: 3200 } });
  v.tone({ type: 'triangle', f: 190, f2: 52, ft: 0.09, dur: 0.16, g: 0.85, a: 0.001 });
  v.noise({ type: 'pink', at: 0.03, dur: 0.42, g: 0.16, a: 0.02, flt: { type: 'lowpass', f: 1100, f2: 300 } });
});

def('shot_smg', { sample: smp('smg', 3), sgain: 0.95, vol: 0.7, ref: 10, max: 140, roll: 1.8, vary: 0.06, pri: 1.1 }, (v) => {
  v.noise({ dur: 0.075, g: 0.85, a: 0.001, flt: { type: 'bandpass', f: 2600, f2: 1500, q: 0.8 } });
  v.noise({ dur: 0.014, g: 0.45, a: 0.001, flt: { type: 'highpass', f: 5000 } });
  v.tone({ type: 'square', f: 330, f2: 115, ft: 0.04, dur: 0.065, g: 0.3, a: 0.001, flt: { type: 'lowpass', f: 1800 } });
  v.noise({ type: 'pink', at: 0.02, dur: 0.14, g: 0.08, a: 0.01, flt: { type: 'lowpass', f: 1500 } });
});

def('shot_shotgun', { sample: smp('shotgun', 3), sgain: 1, vol: 0.85, ref: 12, max: 170, roll: 1.7, vary: 0.05, pri: 1.3 }, (v) => {
  v.noise({ dur: 0.4, g: 1.0, a: 0.001, flt: { type: 'lowpass', f: 4200, f2: 280, ft: 0.26, q: 0.5 } });
  v.noise({ dur: 0.045, g: 0.55, a: 0.001, flt: { type: 'highpass', f: 2200 } });
  v.tone({ f: 120, f2: 36, ft: 0.17, dur: 0.3, g: 1.0, a: 0.001 });
  v.tone({ type: 'triangle', f: 240, f2: 70, ft: 0.08, dur: 0.12, g: 0.4, a: 0.001 });
  v.noise({ type: 'brown', at: 0.04, dur: 0.6, g: 0.45, a: 0.03, flt: { type: 'lowpass', f: 600, f2: 150 } });
});

def('shot_sniper', { sample: smp('sniper', 3), sgain: 1, vol: 0.85, ref: 14, max: 230, roll: 1.5, vary: 0.04, pri: 1.4 }, (v) => {
  v.noise({ dur: 0.06, g: 0.95, a: 0.001, flt: { type: 'highpass', f: 1700 } });
  v.noise({ dur: 0.95, g: 0.55, a: 0.001, flt: { type: 'lowpass', f: 6000, f2: 420, ft: 0.55, q: 0.6 } });
  v.tone({ f: 250, f2: 42, ft: 0.22, dur: 0.34, g: 0.9, a: 0.001 });
  v.tone({ f: 2600, f2: 700, ft: 0.09, dur: 0.1, g: 0.1, a: 0.001 });
  v.noise({ type: 'pink', at: 0.19, dur: 0.5, g: 0.14, a: 0.03, flt: { type: 'bandpass', f: 800, f2: 400, q: 0.6 } });
});

def('shot_pistol', { sample: smp('pistol', 3), sgain: 1, vol: 0.75, ref: 10, max: 140, roll: 1.8, vary: 0.05, pri: 1.1 }, (v) => {
  v.noise({ dur: 0.1, g: 0.8, a: 0.001, flt: { type: 'bandpass', f: 1900, f2: 900, q: 0.7 } });
  v.noise({ dur: 0.018, g: 0.4, a: 0.001, flt: { type: 'highpass', f: 4000 } });
  v.tone({ type: 'triangle', f: 270, f2: 85, ft: 0.055, dur: 0.1, g: 0.65, a: 0.001 });
  v.noise({ type: 'pink', at: 0.02, dur: 0.2, g: 0.09, a: 0.01, flt: { type: 'lowpass', f: 1200 } });
});

def('reload', { sample: { default: smp('reload', 2), shotgun: smp('pump', 3) }, sampleBy: 'weapon', sgain: 0.56, vol: 0.7, ref: 3, max: 25, vary: 0.03 }, (v) => {
  // magazine out
  tick(v, 0, 1800, 0.03, 0.5);
  v.tone({ type: 'square', f: 220, f2: 150, dur: 0.035, g: 0.15, flt: { type: 'lowpass', f: 1500 } });
  // hand movement
  v.noise({ at: 0.14, dur: 0.16, g: 0.12, env: [[0.07, 1], [0.16, 0]], flt: { type: 'bandpass', f: 1200, f2: 2600, q: 1 } });
  // magazine in
  tick(v, 0.4, 1200, 0.04, 0.55);
  thump(v, 0.4, 170, 90, 0.07, 0.5);
  // bolt
  tick(v, 0.6, 3200, 0.02, 0.4, 'highpass');
  tick(v, 0.68, 2200, 0.03, 0.55);
  v.tone({ at: 0.68, f: 1900, dur: 0.06, g: 0.08 });
  thump(v, 0.68, 240, 150, 0.04, 0.3);
});

// Pump/rack after a shotgun shot or reload: sfx.play('shotgun_pump', { x, y, z })
def('shotgun_pump', { sample: smp('pump', 3), sgain: 0.58, vol: 0.65, ref: 3, max: 25, vary: 0.03 }, (v) => {
  // slide back
  tick(v, 0, 1400, 0.035, 0.5);
  thump(v, 0, 200, 110, 0.05, 0.35);
  v.noise({ at: 0.02, dur: 0.12, g: 0.12, env: [[0.04, 1], [0.12, 0]], flt: { type: 'bandpass', f: 900, f2: 1800, q: 1.2 } });
  // slide forward and lock
  tick(v, 0.2, 2200, 0.03, 0.6);
  thump(v, 0.2, 260, 140, 0.05, 0.45);
  v.tone({ at: 0.2, f: 1600, dur: 0.05, g: 0.07 });
});

def('empty_click', { sample: smp('empty', 2), sgain: 1, vol: 0.6, ref: 3, max: 20, vary: 0.03 }, (v) => {
  tick(v, 0, 2600, 0.018, 0.6, 'highpass');
  v.tone({ type: 'square', f: 900, f2: 600, dur: 0.015, g: 0.14 });
  tick(v, 0.035, 1500, 0.02, 0.2);
});

def('weapon_switch', { sample: smp('equip', 3), sgain: 1, vol: 0.6, ref: 3, max: 20, vary: 0.04 }, (v) => {
  v.noise({ dur: 0.1, g: 0.3, env: [[0.05, 1], [0.1, 0]], flt: { type: 'bandpass', f: 800, f2: 2400, q: 1 } });
  tick(v, 0.09, 2000, 0.025, 0.45);
  v.tone({ at: 0.09, f: 520, f2: 380, dur: 0.045, g: 0.22 });
});

def('bullet_impact', {
  sample: { default: smp('impact_stone', 3), wood: smp('impact_wood', 3), stone: smp('impact_stone', 3), metal: smp('impact_metal', 2), body: smp('impact_body', 2) },
  sampleBy: 'surface', sgain: 0.6, vol: 0.6, ref: 5, max: 70, vary: 0.12 }, (v) => {
  v.noise({ dur: 0.05, g: 0.6, a: 0.001, flt: { type: 'bandpass', f: 2800, q: 1.5 } });
  v.tone({ f: 420, f2: 140, dur: 0.055, g: 0.35, a: 0.001 });
  v.noise({ type: 'pink', at: 0.01, dur: 0.13, g: 0.18, flt: { type: 'lowpass', f: 1200 } });
});

def('hitmarker', { vol: 0.55, vary: 0.02, pri: 2 }, (v) => {
  v.tone({ type: 'triangle', f: 1900, dur: 0.045, g: 0.5, a: 0.001 });
  tick(v, 0, 5000, 0.012, 0.25, 'highpass');
});

def('headshot', { vol: 0.6, vary: 0.015, pri: 2 }, (v) => {
  bell(v, 0, 2093, 0.3, 0.42);
  v.tone({ f: 3136, dur: 0.22, g: 0.22, a: 0.001 });
  tick(v, 0, 6000, 0.012, 0.25, 'highpass');
});

def('elimination', { vol: 0.65, vary: 0.01, pri: 2.5 }, (v) => {
  thump(v, 0, 160, 55, 0.14, 0.6);
  tick(v, 0, 2500, 0.05, 0.3);
  const notes = [784, 988, 1175, 1760];
  for (let i = 0; i < notes.length; i++) {
    const at = 0.03 + i * 0.055;
    const last = i === notes.length - 1;
    v.tone({ type: 'triangle', at, f: notes[i], dur: last ? 0.45 : 0.14, g: 0.4, a: 0.003 });
    v.tone({ at, f: notes[i] * 2, dur: last ? 0.3 : 0.08, g: 0.12, a: 0.003 });
  }
  bell(v, 0.195, 1760, 0.5, 0.2);
  v.noise({ at: 0.18, dur: 0.35, g: 0.06, a: 0.03, flt: { type: 'highpass', f: 7000 } });
});

// --- Harvest ---------------------------------------------------------------

def('hit_wood', { sample: smp('harvest_wood', 3), sgain: 1.4, vol: 0.75, ref: 6, max: 70, vary: 0.07 }, (v) => {
  thump(v, 0, 190, 95, 0.13, 0.8);
  v.tone({ type: 'triangle', f: 380, f2: 240, dur: 0.05, g: 0.3, a: 0.001 });
  tick(v, 0, 900, 0.045, 0.5);
  v.noise({ type: 'pink', dur: 0.08, g: 0.25, flt: { type: 'lowpass', f: 400 } });
});

def('hit_stone', { sample: smp('harvest_stone', 3), sgain: 1.1, vol: 0.75, ref: 6, max: 70, vary: 0.07 }, (v) => {
  tick(v, 0, 1500, 0.03, 0.7, 'highpass');
  v.noise({ dur: 0.08, g: 0.5, a: 0.001, flt: { type: 'bandpass', f: 3200, q: 2 } });
  v.tone({ f: 520, f2: 300, dur: 0.04, g: 0.3, a: 0.001 });
  thump(v, 0, 125, 70, 0.08, 0.5);
  for (let i = 0; i < 3; i++) tick(v, rnd(0.05, 0.18), rnd(2500, 5000), 0.025, 0.12, 'bandpass', 3);
});

def('hit_metal', { sample: smp('harvest_metal', 2), sgain: 0.7, vol: 0.6, ref: 6, max: 80, vary: 0.05 }, (v) => {
  const base = 430;
  const ratios = [1, 1.47, 2.09, 2.56, 3.39, 4.18];
  for (let i = 0; i < ratios.length; i++) {
    v.tone({ f: base * ratios[i], dur: 0.6 - i * 0.085, g: 0.34 - i * 0.045, a: 0.001 });
  }
  tick(v, 0, 3000, 0.02, 0.5, 'highpass');
  thump(v, 0, 210, 120, 0.05, 0.35);
});

const WEAK_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
def('weakpoint', { vol: 0.6, ref: 6, max: 60, vary: 0, pri: 1.8 }, (v, o) => {
  const step = clamp(Math.round(isNum(o.step) ? o.step : 0), 0, 7);
  const f = 587.33 * Math.pow(2, WEAK_SCALE[step] / 12);
  v.tone({ type: 'triangle', f, dur: 0.2, g: 0.5, a: 0.002 });
  v.tone({ f: f * 2, dur: 0.13, g: 0.24, a: 0.002 });
  v.tone({ f: f * 3, dur: 0.06, g: 0.1, a: 0.002 });
  tick(v, 0, 4000, 0.015, 0.2, 'highpass');
  thump(v, 0, 200, 110, 0.06, 0.3);
  if (step === 7) bell(v, 0.05, f * 2, 0.4, 0.16);
});

def('tree_fall', { vol: 0.85, ref: 10, max: 110, vary: 0.06, pri: 1.3 }, (v) => {
  // creak: stuttering saw through a resonant band
  v.tone({
    type: 'sawtooth', f: 150, f2: 62, dur: 0.85, g: 0.4,
    env: [[0.05, 0.5], [0.5, 1], [0.85, 0]],
    flt: { type: 'bandpass', f: 900, f2: 450, q: 5 },
    am: { type: 'sawtooth', f: 26, f2: 9, depth: 1 },
  });
  v.noise({ type: 'pink', dur: 0.95, g: 0.14, env: [[0.6, 1], [0.95, 0.4]], flt: { type: 'bandpass', f: 3000, q: 0.6 } });
  // thud
  thump(v, 0.92, 95, 34, 0.45, 1.0);
  v.noise({ at: 0.92, dur: 0.35, g: 0.6, a: 0.002, flt: { type: 'lowpass', f: 900, f2: 200 } });
  v.noise({ at: 0.92, dur: 0.25, g: 0.22, a: 0.002, flt: { type: 'highpass', f: 2200 } });
  for (let i = 0; i < 3; i++) tick(v, 0.95 + rnd(0.02, 0.25), rnd(1200, 3000), 0.04, 0.15);
});

def('building_collapse', { vol: 0.95, ref: 14, max: 190, roll: 1.6, vary: 0.06, pri: 1.6 }, (v) => {
  v.noise({ dur: 0.5, g: 0.8, a: 0.002, flt: { type: 'lowpass', f: 4000, f2: 400, ft: 0.35, q: 0.5 } });
  v.noise({ type: 'brown', dur: 1.9, g: 1.0, env: [[0.05, 1], [0.7, 0.7], [1.9, 0]], flt: { type: 'lowpass', f: 320, f2: 80 } });
  v.tone({ f: 62, f2: 27, ft: 0.9, dur: 1.3, g: 0.9, a: 0.004 });
  for (let i = 0; i < 10; i++) {
    const at = rnd(0.03, 1.2);
    const g = rnd(0.2, 0.5) * (1 - at * 0.5);
    tick(v, at, rnd(600, 3000), rnd(0.05, 0.15), g, 'bandpass', 1.5);
    if (i % 2 === 0) {
      const f = rnd(110, 250);
      thump(v, at, f, f * 0.5, 0.12, g);
    }
  }
});

// --- Cars ------------------------------------------------------------------

def('horn', { vol: 0.7, ref: 14, max: 160, roll: 1.4, vary: 0.02, pri: 1.2 }, (v) => {
  // two-tone car horn, a little brassy
  v.tone({ type: 'square', f: 392, dur: 0.55, g: 0.28, a: 0.01, env: [[0.02, 1], [0.48, 0.9], [0.55, 0]], flt: { type: 'lowpass', f: 2200 } });
  v.tone({ type: 'square', f: 494, dur: 0.55, g: 0.24, a: 0.01, env: [[0.02, 1], [0.48, 0.9], [0.55, 0]], flt: { type: 'lowpass', f: 2200 } });
  v.tone({ type: 'sawtooth', f: 196, dur: 0.55, g: 0.1, a: 0.01, env: [[0.02, 1], [0.48, 0.8], [0.55, 0]], flt: { type: 'lowpass', f: 900 } });
});

def('glass_break', { vol: 0.75, ref: 6, max: 70, vary: 0.08, pri: 1.1 }, (v) => {
  v.noise({ dur: 0.06, g: 0.9, a: 0.001, flt: { type: 'highpass', f: 2500 } });
  for (let i = 0; i < 9; i++) tick(v, rnd(0.0, 0.35), rnd(2500, 7000), rnd(0.02, 0.06), rnd(0.15, 0.4), 'bandpass', 6);
  v.noise({ type: 'pink', at: 0.02, dur: 0.4, g: 0.35, env: [[0.03, 1], [0.4, 0]], flt: { type: 'highpass', f: 3500 } });
});

def('car_door', { vol: 0.55, ref: 4, max: 30, vary: 0.1 }, (v) => {
  thump(v, 0, 140, 70, 0.12, 0.7);
  tick(v, 0.01, 1300, 0.04, 0.3, 'bandpass', 2);
});

def('car_crash', { vol: 0.85, ref: 10, max: 120, roll: 1.6, vary: 0.08, pri: 1.4 }, (v) => {
  thump(v, 0, 110, 40, 0.25, 0.9);
  v.noise({ dur: 0.35, g: 0.7, a: 0.001, env: [[0.02, 1], [0.35, 0]], flt: { type: 'bandpass', f: 1200, q: 0.6 } });
  for (let i = 0; i < 6; i++) tick(v, rnd(0.0, 0.3), rnd(900, 3200), rnd(0.03, 0.08), rnd(0.15, 0.35));
});

// --- Grenades --------------------------------------------------------------

def('explosion', { vol: 1, ref: 16, max: 240, roll: 1.5, vary: 0.05, pri: 2 }, (v) => {
  v.noise({ dur: 0.05, g: 0.9, a: 0.001, flt: { type: 'highpass', f: 1800 } });
  v.noise({ dur: 0.7, g: 1.0, a: 0.001, flt: { type: 'lowpass', f: 5200, f2: 240, ft: 0.4, q: 0.5 } });
  v.tone({ f: 110, f2: 28, ft: 0.35, dur: 0.7, g: 1.0, a: 0.001 });
  v.tone({ type: 'triangle', f: 210, f2: 48, ft: 0.14, dur: 0.25, g: 0.5, a: 0.001 });
  v.noise({ type: 'brown', at: 0.05, dur: 1.5, g: 0.7, env: [[0.04, 1], [0.5, 0.5], [1.5, 0]], flt: { type: 'lowpass', f: 420, f2: 90 } });
  for (let i = 0; i < 5; i++) tick(v, rnd(0.15, 0.9), rnd(700, 2600), rnd(0.04, 0.1), rnd(0.08, 0.2));
});

def('rocket_launch', { vol: 0.9, ref: 12, max: 180, roll: 1.5, vary: 0.05, pri: 1.5 }, (v) => {
  v.noise({ dur: 0.08, g: 0.8, a: 0.001, flt: { type: 'highpass', f: 1200 } });
  v.tone({ f: 160, f2: 45, ft: 0.2, dur: 0.3, g: 0.8, a: 0.001 });
  v.noise({ dur: 0.9, g: 0.7, env: [[0.03, 1], [0.25, 0.6], [0.9, 0]], flt: { type: 'bandpass', f: 900, fenv: [[0.15, 2600], [0.9, 500]], q: 0.8 } });
  v.noise({ type: 'brown', at: 0.02, dur: 0.6, g: 0.5, env: [[0.05, 1], [0.6, 0]], flt: { type: 'lowpass', f: 500, f2: 120 } });
});

def('grenade_bounce', { vol: 0.5, ref: 4, max: 40, vary: 0.1 }, (v) => {
  tick(v, 0, 1900, 0.035, 0.6, 'bandpass', 3);
  thump(v, 0, 320, 170, 0.05, 0.4);
});

def('grenade_beep', { vol: 0.4, ref: 4, max: 35, vary: 0 }, (v) => {
  v.tone({ type: 'square', f: 1900, dur: 0.05, g: 0.25, a: 0.002, flt: { type: 'lowpass', f: 4000 } });
});

def('grenade_throw', { vol: 0.5, ref: 3, max: 20, vary: 0.1 }, (v) => {
  v.noise({
    dur: 0.24, g: 0.5, env: [[0.09, 1], [0.24, 0]],
    flt: { type: 'bandpass', f: 400, fenv: [[0.1, 1800], [0.24, 600]], q: 1.2 },
  });
});

def('swing', { sample: smp('swing', 2), sgain: 0.66, vol: 0.5, ref: 3, max: 20, vary: 0.1 }, (v) => {
  v.noise({
    dur: 0.2, g: 0.5, env: [[0.07, 1], [0.2, 0]],
    flt: { type: 'bandpass', f: 500, fenv: [[0.08, 2400], [0.2, 700]], q: 1.4 },
  });
  v.noise({ type: 'pink', dur: 0.16, g: 0.15, env: [[0.06, 1], [0.16, 0]], flt: { type: 'highpass', f: 3000 } });
});

// --- Building --------------------------------------------------------------

def('build_wood', { vol: 0.65, ref: 6, max: 80, vary: 0.05 }, (v) => {
  const f = [220, 277, 330];
  for (let i = 0; i < 3; i++) {
    const at = i * 0.06;
    thump(v, at, f[i], f[i] * 0.6, 0.075, 0.6);
    tick(v, at, 1000, 0.03, 0.35);
  }
  v.tone({ at: 0.19, f: 520, f2: 700, dur: 0.07, g: 0.2, a: 0.004 });
});

def('build_stone', { vol: 0.65, ref: 6, max: 80, vary: 0.05 }, (v) => {
  const f = [150, 175, 130];
  for (let i = 0; i < 3; i++) {
    const at = i * 0.065;
    v.noise({ at, dur: 0.045, g: 0.5, a: 0.001, flt: { type: 'bandpass', f: 2200 + i * 300, q: 2 } });
    thump(v, at, f[i], f[i] * 0.7, 0.07, 0.55);
  }
  v.noise({ at: 0.15, dur: 0.14, g: 0.2, env: [[0.03, 1], [0.14, 0]], flt: { type: 'bandpass', f: 1500, f2: 800, q: 1.2 } });
});

def('build_metal', { vol: 0.55, ref: 6, max: 80, vary: 0.04 }, (v) => {
  const f = [700, 880, 1100];
  for (let i = 0; i < 3; i++) {
    const at = i * 0.06;
    v.tone({ at, f: f[i], dur: 0.13, g: 0.35, a: 0.001 });
    v.tone({ at, f: f[i] * 2.76, dur: 0.07, g: 0.16, a: 0.001 });
    tick(v, at, 4000, 0.012, 0.3, 'highpass');
  }
  for (let i = 0; i < 4; i++) tick(v, 0.17 + i * 0.02, 3200, 0.012, 0.22, 'highpass');
  thump(v, 0.25, 260, 150, 0.06, 0.4);
  v.tone({ at: 0.25, f: 1480, dur: 0.16, g: 0.12, a: 0.001 });
});

def('build_break', { vol: 0.8, ref: 8, max: 100, vary: 0.08, pri: 1.2 }, (v) => {
  v.noise({ dur: 0.26, g: 0.8, a: 0.001, flt: { type: 'lowpass', f: 3000, f2: 500, q: 0.6 } });
  thump(v, 0, 150, 60, 0.2, 0.7);
  v.tone({ type: 'triangle', f: 400, f2: 120, dur: 0.18, g: 0.3, a: 0.002 });
  for (let i = 0; i < 5; i++) tick(v, rnd(0.03, 0.3), rnd(800, 3500), rnd(0.03, 0.07), rnd(0.15, 0.35), 'bandpass', 2);
});

def('build_denied', { vol: 0.5, vary: 0.01, pri: 1.5 }, (v) => {
  const buzz = (at, f) => v.tone({
    type: 'square', at, f, dur: 0.1, g: 0.3,
    env: [[0.005, 1], [0.08, 0.9], [0.1, 0]], flt: { type: 'lowpass', f: 1200 },
  });
  buzz(0, 196);
  buzz(0.12, 156);
});

// --- Loot / UI -------------------------------------------------------------

def('pickup', { vol: 0.55, ref: 4, max: 30, vary: 0.02, pri: 1.5 }, (v) => {
  blip(v, 0, 660, 0.07, 0.4);
  blip(v, 0.06, 990, 0.14, 0.4);
  tick(v, 0, 2500, 0.015, 0.15);
});

def('pickup_ammo', { vol: 0.55, ref: 4, max: 30, vary: 0.04, pri: 1.5 }, (v) => {
  const t = [0, 0.04, 0.075];
  const f = [1200, 1500, 1350];
  for (let i = 0; i < 3; i++) {
    tick(v, t[i], 3000, 0.02, 0.4, 'bandpass', 2);
    v.tone({ at: t[i], f: f[i], dur: 0.04, g: 0.15, a: 0.001 });
  }
  v.tone({ type: 'triangle', at: 0.11, f: 880, f2: 1100, dur: 0.07, g: 0.25, a: 0.003 });
});

def('chest_open', { vol: 0.6, ref: 5, max: 45, vary: 0.01, pri: 2 }, (v) => {
  thump(v, 0, 180, 90, 0.1, 0.6);
  tick(v, 0, 800, 0.04, 0.4);
  v.noise({ dur: 0.35, g: 0.18, env: [[0.2, 1], [0.35, 0]], flt: { type: 'bandpass', f: 400, f2: 1800, q: 1 } });
  const notes = [880, 987.8, 1108.7, 1318.5, 1480, 1760, 2217.5];
  for (let i = 0; i < notes.length; i++) bell(v, 0.14 + i * 0.062, notes[i], 0.55, 0.2);
  v.tone({ at: 0.52, f: 880, dur: 0.8, g: 0.1, env: [[0.1, 1], [0.8, 0]] });
  v.tone({ at: 0.52, f: 1318.5, dur: 0.8, g: 0.07, env: [[0.1, 1], [0.8, 0]] });
  v.noise({ at: 0.15, dur: 1.0, g: 0.05, env: [[0.4, 1], [1.0, 0]], flt: { type: 'highpass', f: 7000 } });
});

def('drink_shield', { vol: 0.55, ref: 3, max: 20, vary: 0.03 }, (v) => {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    const f = (300 + 620 * p) * rnd(0.92, 1.08);
    v.tone({ at: p * 0.85 + rnd(0, 0.03), f, f2: f * 1.6, ft: 0.05, dur: 0.07, g: 0.32, a: 0.004 });
  }
  v.tone({ f: 200, f2: 620, dur: 0.95, g: 0.1, env: [[0.2, 1], [0.8, 1], [0.95, 0]] });
  v.tone({ at: 0.95, f: 880, dur: 0.4, g: 0.2, a: 0.01 });
  v.tone({ at: 0.95, f: 1320, dur: 0.4, g: 0.14, a: 0.01 });
});

def('heal', { vol: 0.55, ref: 3, max: 20, vary: 0.01 }, (v) => {
  const notes = [392, 523.25, 659.25];
  for (let i = 0; i < 3; i++) {
    v.tone({ at: i * 0.12, f: notes[i], dur: 0.55, g: 0.3, a: 0.04 });
    v.tone({ type: 'triangle', at: i * 0.12, f: notes[i], dur: 0.4, g: 0.1, a: 0.04 });
  }
  v.tone({ at: 0.36, f: 1318.5, dur: 0.5, g: 0.1, a: 0.02 });
  v.noise({ type: 'pink', dur: 0.7, g: 0.05, env: [[0.3, 1], [0.7, 0]], flt: { type: 'bandpass', f: 1500, f2: 3000, q: 0.8 } });
});

def('ui_click', { vol: 0.5, vary: 0.01, pri: 2 }, (v) => {
  v.tone({ f: 880, f2: 660, dur: 0.04, g: 0.4, a: 0.001 });
  tick(v, 0, 3000, 0.008, 0.15, 'highpass');
});

def('ui_hover', { vol: 0.4, vary: 0.01, pri: 0.8 }, (v) => {
  v.tone({ f: 1200, dur: 0.035, g: 0.2, a: 0.006 });
});

def('zone_enter', { vol: 0.55, vary: 0, pri: 1.5 }, (v) => {
  const pad = (at, f, g) => {
    v.tone({ at, f, dur: 1.5, g, env: [[0.09, 1], [0.5, 0.6], [1.5, 0]] });
    v.tone({ type: 'triangle', at, f, dur: 1.2, g: g * 0.35, env: [[0.06, 1], [1.2, 0]], detune: 6 });
  };
  pad(0, 293.66, 0.3);
  pad(0, 440, 0.22);
  pad(0.2, 587.33, 0.25);
  pad(0.2, 880, 0.14);
  bell(v, 0.4, 1318.5, 0.9, 0.08);
  v.noise({ dur: 1.2, g: 0.03, env: [[0.3, 1], [1.2, 0]], flt: { type: 'highpass', f: 5000 } });
});

// --- Player ----------------------------------------------------------------

def('footstep', { vol: 0.45, ref: 3, max: 32, vary: 0.09, pri: 0.6 }, (v, o) => {
  if (o.surface === 'road') {
    v.noise({ dur: 0.045, g: 0.45, a: 0.001, flt: { type: 'bandpass', f: 1400, q: 1 } });
    thump(v, 0, 140, 80, 0.05, 0.4);
    tick(v, 0, 3500, 0.01, 0.12, 'highpass');
  } else if (o.surface === 'wood') {
    thump(v, 0, 210, 120, 0.07, 0.55);
    v.tone({ type: 'triangle', f: 420, f2: 300, dur: 0.03, g: 0.15, a: 0.001 });
    tick(v, 0, 700, 0.04, 0.3);
  } else {
    v.noise({ type: 'pink', dur: 0.1, g: 0.5, a: 0.008, flt: { type: 'lowpass', f: 900 } });
    v.noise({ dur: 0.06, g: 0.1, a: 0.01, flt: { type: 'bandpass', f: 2500, q: 0.8 } });
    thump(v, 0, 110, 70, 0.05, 0.2);
  }
});

// Swimming: entering the water (louder) and each stroke: sfx.play('splash', { x, y, z, volume })
def('splash', { vol: 0.5, ref: 3, max: 30, vary: 0.12, pri: 0.6 }, (v) => {
  v.noise({ type: 'pink', dur: 0.32, g: 0.6, a: 0.01, flt: { type: 'bandpass', f: 850, q: 0.7 } });
  v.noise({ dur: 0.2, g: 0.22, a: 0.02, flt: { type: 'highpass', f: 2600 } });
  thump(v, 0, 90, 60, 0.08, 0.25);
});

def('jump', { vol: 0.45, ref: 3, max: 25, vary: 0.05 }, (v) => {
  v.tone({ f: 260, f2: 520, ft: 0.12, dur: 0.16, g: 0.3, a: 0.01 });
  v.noise({ dur: 0.13, g: 0.14, env: [[0.05, 1], [0.13, 0]], flt: { type: 'bandpass', f: 900, f2: 2400, q: 1 } });
});

def('land', { vol: 0.6, ref: 4, max: 35, vary: 0.07 }, (v) => {
  thump(v, 0, 150, 55, 0.13, 0.7);
  v.noise({ type: 'pink', dur: 0.1, g: 0.45, a: 0.002, flt: { type: 'lowpass', f: 700 } });
  tick(v, 0, 2000, 0.04, 0.1);
});

def('hurt', { vol: 0.6, ref: 5, max: 45, vary: 0.06, pri: 1.5 }, (v) => {
  v.tone({ type: 'sawtooth', f: 240, f2: 140, ft: 0.13, dur: 0.18, g: 0.6, a: 0.004, flt: { type: 'bandpass', f: 900, f2: 600, q: 2 } });
  v.tone({ f: 300, f2: 160, ft: 0.13, dur: 0.16, g: 0.3, a: 0.004 });
  v.noise({ dur: 0.05, g: 0.35, a: 0.001, flt: { type: 'bandpass', f: 1400, q: 1 } });
  thump(v, 0, 110, 70, 0.1, 0.4);
});

def('shield_break', { vol: 0.6, ref: 6, max: 60, vary: 0.05, pri: 1.6 }, (v) => {
  v.noise({ dur: 0.3, g: 0.5, a: 0.001, flt: { type: 'highpass', f: 3500 } });
  for (let i = 0; i < 6; i++) v.tone({ at: rnd(0, 0.04), f: rnd(1800, 5200), dur: rnd(0.08, 0.3), g: 0.12, a: 0.001 });
  v.tone({ f: 1600, f2: 300, ft: 0.22, dur: 0.28, g: 0.25, a: 0.002 });
  for (let i = 0; i < 5; i++) tick(v, rnd(0.04, 0.3), rnd(4000, 8000), 0.02, 0.15, 'bandpass', 4);
});

def('death', { vol: 0.65, ref: 6, max: 60, vary: 0.03, pri: 2 }, (v) => {
  v.tone({
    type: 'sawtooth', f: 392, f2: 98, ft: 0.6, dur: 0.75, g: 0.35, a: 0.01,
    flt: { type: 'lowpass', f: 2400, f2: 500, ft: 0.6 }, vib: { f: 9, cents: 25 },
  });
  v.tone({ type: 'triangle', at: 0.04, f: 294, f2: 73, ft: 0.6, dur: 0.75, g: 0.3, a: 0.01 });
  v.noise({ dur: 0.7, g: 0.12, a: 0.02, flt: { type: 'bandpass', f: 2500, f2: 400, ft: 0.6, q: 1 } });
  thump(v, 0.5, 110, 38, 0.5, 0.7);
  v.noise({ type: 'pink', at: 0.5, dur: 0.3, g: 0.3, a: 0.002, flt: { type: 'lowpass', f: 800 } });
});

// --- Storm -----------------------------------------------------------------

def('storm_warning', { vol: 0.5, vary: 0, pri: 2 }, (v) => {
  const note = (at, f) => {
    const env = [[0.012, 1], [0.19, 0.9], [0.22, 0]];
    v.tone({ type: 'sawtooth', at, f, dur: 0.22, g: 0.3, env, flt: { type: 'lowpass', f: 2000 }, vib: { f: 7, cents: 12 } });
    v.tone({ at, f: f / 2, dur: 0.22, g: 0.22, env });
  };
  for (let i = 0; i < 2; i++) {
    note(i * 0.5, 622.25);
    note(i * 0.5 + 0.24, 466.16);
  }
});

def('storm_tick', { vol: 0.5, vary: 0.08, pri: 1.2 }, (v) => {
  v.noise({ dur: 0.09, g: 0.35, a: 0.001, flt: { type: 'bandpass', f: 3000, f2: 1200, q: 2 } });
  v.tone({ type: 'sawtooth', f: 90, f2: 60, dur: 0.1, g: 0.4, a: 0.002, flt: { type: 'lowpass', f: 700 } });
  v.tone({ f: 1400, f2: 500, dur: 0.045, g: 0.16, a: 0.001 });
});

def('countdown_beep', { vol: 0.5, vary: 0, pri: 2 }, (v, o) => {
  const f = o.final ? 1318.5 : 880;
  const dur = o.final ? 0.45 : 0.13;
  const env = [[0.005, 1], [dur * 0.7, 0.8], [dur, 0]];
  v.tone({ f, dur, g: 0.4, env });
  v.tone({ type: 'triangle', f: f * 2, dur, g: 0.07, env });
});

// ---------------------------------------------------------------------------
// Continuous loops. build() wires sources into `out` and returns the sources.
// ---------------------------------------------------------------------------

function loopKit(ctx, noise, t, sources) {
  const gain = (value, dest) => {
    const g = ctx.createGain();
    g.gain.value = value;
    g.connect(dest);
    return g;
  };
  return {
    gain,
    // oscillator -> gain -> dest (dest may be an AudioParam, which makes it an LFO)
    osc(type, f, amount, dest) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(gain(amount, dest));
      o.start(t);
      sources.push(o);
    },
    noise(kind, fltType, f, q, dest) {
      const src = ctx.createBufferSource();
      src.buffer = noise[kind];
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = fltType;
      flt.frequency.value = f;
      flt.Q.value = q;
      src.connect(flt);
      flt.connect(dest);
      src.start(t, Math.random() * Math.max(0, noise[kind].duration - 0.1));
      sources.push(src);
      return flt;
    },
  };
}

const LOOPS = {
  // Soft magical hum with a slow shimmer. Positional; nearest 4 are audible.
  chest_hum: {
    vol: 0.2, ref: 2.5, max: 22, roll: 1.6, positional: true, maxActive: 4,
    build(ctx, out, noise, t) {
      const src = [];
      const k = loopKit(ctx, noise, t, src);
      const d = rnd(0.994, 1.006); // per-chest detune so neighbours do not phase-lock
      const body = k.gain(0.7, out);
      k.osc('sine', 196 * d, 0.5, body);
      k.osc('sine', 197.7 * d, 0.4, body);
      k.osc('triangle', 294.4 * d, 0.16, body);
      k.osc('sine', rnd(2.2, 3), 0.25, body.gain);
      const shimmer = k.gain(0.06, out);
      k.osc('sine', 1176 * d, 1, shimmer);
      k.osc('sine', 1569 * d, 0.6, shimmer);
      k.osc('sine', rnd(0.35, 0.55), 0.05, shimmer.gain);
      return src;
    },
  },
  // Heavy, gusting storm wind. Non-positional; scale with setLoopGain.
  storm_wind: {
    vol: 0.55,
    build(ctx, out, noise, t) {
      const src = [];
      const k = loopKit(ctx, noise, t, src);
      const main = k.noise('pink', 'bandpass', 420, 0.7, k.gain(0.9, out));
      k.osc('sine', 0.11, 170, main.frequency);
      k.osc('sine', 0.37, 60, main.frequency);
      const whistleGain = k.gain(0.22, out);
      const whistle = k.noise('pink', 'bandpass', 1150, 3.5, whistleGain);
      k.osc('sine', 0.23, 380, whistle.frequency);
      k.osc('sine', 0.17, 0.14, whistleGain.gain);
      k.noise('brown', 'lowpass', 180, 0.7, k.gain(0.8, out));
      return src;
    },
  },
  // Car engine (the car you ride in): a low idle hum; setLoopGain with the revs.
  engine: {
    vol: 0.32,
    build(ctx, out, noise, t) {
      const src = [];
      const k = loopKit(ctx, noise, t, src);
      const body = k.gain(0.6, out);
      k.osc('sawtooth', 46, 0.5, body);
      k.osc('square', 92, 0.12, body);
      k.osc('sine', 9, 0.18, body.gain);
      k.noise('brown', 'lowpass', 240, 0.7, k.gain(0.7, out));
      return src;
    },
  },
  // Lighter rushing air for gliding / skydiving.
  glide_wind: {
    vol: 0.45,
    build(ctx, out, noise, t) {
      const src = [];
      const k = loopKit(ctx, noise, t, src);
      const rush = k.noise('white', 'bandpass', 1300, 0.6, k.gain(0.5, out));
      k.osc('sine', 0.7, 320, rush.frequency);
      const airGain = k.gain(0.2, out);
      k.noise('pink', 'highpass', 2500, 0.7, airGain);
      k.osc('sine', 5.5, 0.06, airGain.gain);
      k.noise('pink', 'lowpass', 300, 0.7, k.gain(0.5, out));
      return src;
    },
  },
};

// ---------------------------------------------------------------------------
// Music (original). Sequenced against the AudioContext clock.
// ---------------------------------------------------------------------------

// Menu theme: 16 bars, D major, IV-V-iii-vi-IV-V-I-V. 16th-note grid.
// Each bar: [bass root, chord, lead [[step, note, length], ...], optional 2nd-half chord]
const MENU_BPM = 112;
const MENU_STEP = 60 / MENU_BPM / 4;
const MENU_BARS = [
  [43, [59, 62, 66], [[0, 78, 3], [3, 74, 3], [6, 71, 2], [8, 74, 4], [12, 76, 2], [14, 78, 2]]],
  [45, [57, 61, 64], [[0, 76, 3], [3, 73, 3], [6, 69, 2], [8, 73, 4], [12, 76, 4]]],
  [42, [57, 61, 64], [[0, 81, 3], [3, 78, 3], [6, 76, 2], [8, 73, 4], [12, 76, 2], [14, 78, 2]]],
  [47, [59, 62, 66], [[0, 74, 4], [4, 71, 4], [8, 78, 8]]],
  [43, [59, 62, 66], [[0, 79, 3], [3, 78, 3], [6, 74, 2], [8, 71, 4], [12, 74, 2], [14, 76, 2]]],
  [45, [57, 61, 64], [[0, 76, 3], [3, 81, 3], [6, 79, 2], [8, 76, 4], [12, 73, 2], [14, 76, 2]]],
  [50, [57, 62, 66], [[0, 78, 3], [3, 81, 3], [6, 86, 2], [8, 81, 4], [12, 78, 4]]],
  [45, [57, 62, 64], [[0, 76, 4], [4, 74, 4], [8, 73, 4], [12, 76, 4]], [57, 61, 64]],
  [43, [59, 62, 66], [[0, 83, 4], [6, 81, 2], [8, 78, 4], [12, 74, 4]]],
  [45, [57, 61, 64], [[0, 76, 4], [6, 73, 2], [8, 76, 4], [12, 81, 4]]],
  [42, [57, 61, 64], [[0, 81, 2], [2, 85, 2], [4, 81, 2], [6, 78, 2], [8, 76, 4], [12, 73, 4]]],
  [47, [59, 62, 66], [[0, 74, 3], [3, 78, 3], [6, 83, 10]]],
  [43, [59, 62, 66], [[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 3], [11, 79, 3], [14, 78, 2]]],
  [45, [57, 61, 64], [[0, 76, 3], [3, 79, 3], [6, 81, 2], [8, 85, 4], [12, 81, 4]]],
  [50, [57, 62, 66], [[0, 86, 3], [3, 81, 3], [6, 78, 2], [8, 74, 2], [10, 76, 2], [12, 78, 2], [14, 81, 2]]],
  [45, [57, 62, 64], [[0, 76, 6], [8, 69, 2], [10, 73, 2], [12, 76, 2], [14, 81, 2]], [57, 61, 64]],
];

// Flatten the bars into per-step event lists: [kind, note(s), length]
const MENU_EVENTS = (() => {
  const steps = [];
  for (let i = 0; i < MENU_BARS.length * 16; i++) steps.push([]);
  MENU_BARS.forEach((bar, b) => {
    const at = (s) => steps[b * 16 + s];
    const root = bar[0];
    at(0).push(['bass', root, 6]);
    at(6).push(['bass', root, 2]);
    at(8).push(['bass', root + 7, 4]);
    at(12).push(['bass', root, 4]);
    for (const s of [2, 6, 10, 14]) {
      at(s).push(['chord', s >= 8 && bar[3] ? bar[3] : bar[1], 1]);
      at(s).push(['hat', 0, 1]);
    }
    for (const n of bar[2]) at(n[0]).push(['lead', n[1], n[2]]);
    if (b >= 4) {
      at(0).push(['kick', 0, 1]);
      at(8).push(['kick', 0, 1]);
    }
    if (b >= 8) {
      at(4).push(['snap', 0, 1]);
      at(12).push(['snap', 0, 1]);
      if (b % 2 === 1) at(11).push(['kick', 0, 1]);
    }
  });
  return steps;
})();

const brass = (v, at, note, dur, g) => {
  const f = mtof(note);
  const env = [[0.025, 1], [Math.max(0.03, dur - 0.07), 0.8], [dur, 0]];
  const flt = { type: 'lowpass', f: 700, fenv: [[0.05, 3400], [0.3, 1900]], q: 1 };
  v.tone({ type: 'sawtooth', at, f, dur, g, env, flt });
  v.tone({ type: 'sawtooth', at, f, dur, g: g * 0.6, env, flt, detune: 9 });
};

const MUSIC = {
  menu: {
    loop: true, vol: 0.6, stepDur: MENU_STEP, steps: MENU_EVENTS.length,
    setup(ctx, track) {
      const mk = (g, dest) => {
        const n = ctx.createGain();
        n.gain.value = g;
        n.connect(dest);
        return n;
      };
      const lead = mk(0.5, track);
      // dotted-eighth echo on the lead for a wistful tail
      const delay = ctx.createDelay(1);
      delay.delayTime.value = MENU_STEP * 3;
      const feedback = mk(0.3, delay);
      const wet = mk(0.28, track);
      lead.connect(delay);
      delay.connect(feedback);
      delay.connect(wet);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2200;
      tone.connect(track);
      return {
        buses: { lead, bass: mk(0.5, track), chord: mk(0.34, tone), perc: mk(0.4, track) },
        nodes: [lead, delay, feedback, wet, tone],
      };
    },
    step(v, m, i) {
      const events = MENU_EVENTS[i];
      const b = m.buses;
      for (let e = 0; e < events.length; e++) {
        const kind = events[e][0];
        const note = events[e][1];
        const len = events[e][2] * MENU_STEP;
        if (kind === 'lead') {
          const f = mtof(note);
          const dur = Math.min(0.6, len * 1.5 + 0.12);
          v.tone({ type: 'triangle', f, dur, g: 0.5, a: 0.004, dest: b.lead });
          v.tone({ f: f * 2, dur: 0.12, g: 0.16, a: 0.003, dest: b.lead });
          v.tone({ type: 'square', f, dur: 0.07, g: 0.07, a: 0.003, flt: { type: 'lowpass', f: 3000 }, dest: b.lead });
        } else if (kind === 'bass') {
          const f = mtof(note);
          const dur = len * 0.95;
          const env = [[0.012, 1], [dur * 0.6, 0.7], [dur, 0]];
          v.tone({ f, dur, g: 0.6, env, dest: b.bass });
          v.tone({ type: 'triangle', f, dur, g: 0.16, env, dest: b.bass });
        } else if (kind === 'chord') {
          for (let n = 0; n < note.length; n++) {
            v.tone({ type: 'triangle', f: mtof(note[n]), dur: 0.17, g: 0.3, a: 0.005, dest: b.chord });
          }
        } else if (kind === 'kick') {
          v.tone({ f: 120, f2: 45, ft: 0.08, dur: 0.15, g: 0.55, a: 0.002, dest: b.perc });
        } else if (kind === 'hat') {
          v.noise({ dur: 0.035, g: 0.1, a: 0.001, flt: { type: 'highpass', f: 7000 }, dest: b.perc });
        } else if (kind === 'snap') {
          v.noise({ dur: 0.075, g: 0.24, a: 0.001, flt: { type: 'bandpass', f: 1800, q: 1 }, dest: b.perc });
          v.noise({ dur: 0.02, g: 0.12, a: 0.001, flt: { type: 'highpass', f: 5000 }, dest: b.perc });
        }
      }
    },
  },

  // Rising D-major fanfare: I - IV - V - I, about 3.9 s with tail.
  victory: {
    loop: false, vol: 0.55, dur: 4.1,
    play(v) {
      const B = 60 / 138;
      const melody = [
        [0, 69, 0.5], [0.5, 74, 0.5], [1, 78, 1], [2, 79, 0.5], [2.5, 78, 0.5],
        [3, 79, 0.5], [3.5, 83, 0.5], [4, 81, 0.5], [4.5, 85, 0.5], [5, 86, 3],
      ];
      for (const [beat, note, len] of melody) brass(v, beat * B, note, len * B * 0.94, 0.22);
      const chords = [[0, 2, [62, 66, 69]], [2, 2, [62, 67, 71]], [4, 1, [61, 64, 69]], [5, 3, [62, 66, 69, 74]]];
      for (const [beat, len, notes] of chords) {
        for (const n of notes) brass(v, beat * B, n, len * B * 0.97, 0.08);
      }
      const bass = [[0, 2, 50], [2, 2, 43], [4, 1, 45], [5, 3, 38], [5, 3, 50]];
      for (const [beat, len, n] of bass) {
        const dur = len * B * 0.97;
        v.tone({ type: 'triangle', at: beat * B, f: mtof(n), dur, g: 0.3, env: [[0.015, 1], [dur * 0.7, 0.7], [dur, 0]] });
      }
      for (const beat of [0, 2, 4, 4.5, 5]) {
        thump(v, beat * B, 95, 58, 0.45, beat === 5 ? 0.7 : 0.45);
        v.noise({ type: 'pink', at: beat * B, dur: 0.12, g: 0.2, a: 0.002, flt: { type: 'lowpass', f: 500 } });
      }
      // cymbal wash + sparkle on the final chord
      v.noise({ at: 5 * B, dur: 1.7, g: 0.16, a: 0.004, flt: { type: 'highpass', f: 5000 } });
      v.noise({ at: 5 * B, dur: 1.2, g: 0.1, a: 0.004, flt: { type: 'bandpass', f: 9000, q: 1 } });
      const sparkle = [86, 90, 93, 98];
      for (let i = 0; i < sparkle.length; i++) bell(v, (5.25 + i * 0.25) * B, mtof(sparkle[i]), 0.7, 0.07);
    },
  },

  // Short descending D-minor phrase.
  defeat: {
    loop: false, vol: 0.55, dur: 2.6,
    play(v) {
      const notes = [[0, 69, 0.32], [0.32, 65, 0.32], [0.64, 64, 0.32], [0.96, 62, 1.4]];
      for (const [at, note, dur] of notes) {
        const f = mtof(note);
        const last = dur > 1;
        const env = [[0.02, 1], [dur * 0.5, 0.7], [dur, 0]];
        v.tone({ type: 'triangle', at, f, f2: last ? f * 0.97 : undefined, dur, g: 0.4, env, vib: last ? { f: 5, cents: 14 } : undefined });
        v.tone({ at, f: f / 2, dur, g: 0.2, env });
      }
      for (const n of [50, 53, 57]) {
        v.tone({ at: 0.96, f: mtof(n), dur: 1.5, g: 0.11, env: [[0.08, 1], [0.7, 0.6], [1.5, 0]] });
      }
      v.tone({ type: 'triangle', at: 0.96, f: mtof(38), dur: 1.5, g: 0.3, env: [[0.03, 1], [0.8, 0.6], [1.5, 0]] });
      thump(v, 0.96, 90, 50, 0.4, 0.4);
    },
  },
};

export const SOUND_NAMES = Object.freeze(Object.keys(SOUNDS));
export const LOOP_NAMES = Object.freeze(Object.keys(LOOPS));
export const MUSIC_NAMES = Object.freeze(Object.keys(MUSIC));

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class Sfx {
  constructor() {
    this.ctx = null;
    this.config = {
      maxVoices: 24, // one-shot polyphony (loops and music are not counted)
      throttle: 0.025, // seconds; identical names inside this window are dropped
      panWidth: 0.85, // maximum stereo pan
      invertPan: false, // flip left/right if the world is left-handed
      musicVolume: 0.6,
      sfxVolume: 1, // settings channel: scales one-shots + loops
      uiVolume: 1, // settings channel: scales ui_* one-shots
      debug: false, // console.warn exceptions that public methods swallow
    };
    this._volume = 0.8;
    this._muted = false;
    this._listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this._sp = { att: 1, pan: 0, far: 0 };
    this._voices = [];
    this._lastPlay = new Map();
    this._loops = new Map(); // "name|id" -> emitter
    this._loopLevel = Object.create(null);
    this._loopT = -1;
    this._music = null;
    this._wantMusic = null;
    this._custom = Object.create(null); // music name -> audio file URL (local override)
    this._smp = new Map(); // sample URL -> { url, state, bytes, buf, error }
    this._smpLoad = null; // preloadSamples() promise (fetch phase)
    this._rr = Object.create(null); // round-robin position per "name|key"
    /** How one-shots were rendered: decoded sample vs synth fallback. */
    this.stats = { sample: 0, synth: 0, last: null };
    this._grace = 0;
    this._noise = null;
    this._autoBound = false;
    this._offline = false;
    this._offlineEnd = 0;
    /** Last exception swallowed by a public method (debugging aid), or null. */
    this.lastError = null;
  }

  /**
   * Tooling/tests: an engine bound to an OfflineAudioContext so sounds can be
   * rendered to a buffer and measured without a sound card.
   *   const e = Sfx.offline({ seconds: 2 });
   *   e.play('shot_rifle');
   *   const buffer = await e.ctx.startRendering();
   * opts: { seconds = 2, sampleRate = 44100, volume, musicVolume }. Looping
   * music is scheduled in full up front (timers cannot follow an offline
   * clock). Returns null when OfflineAudioContext is unavailable.
   */
  static offline(opts) {
    try {
      const o = opts || NO_OPTS;
      const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
      if (!OAC) return null;
      const rate = isNum(o.sampleRate) ? o.sampleRate : 44100;
      const seconds = isNum(o.seconds) ? Math.max(0.05, o.seconds) : 2;
      const e = new Sfx();
      e._offline = true;
      e._offlineEnd = seconds;
      if (isNum(o.volume)) e._volume = clamp(o.volume, 0, 1);
      if (isNum(o.musicVolume)) e.config.musicVolume = clamp(o.musicVolume, 0, 1);
      e._init(new OAC(2, Math.ceil(rate * seconds), rate));
      return e;
    } catch (err) {
      return null;
    }
  }

  _fail(err) {
    this.lastError = err;
    if (this.config.debug && typeof console !== 'undefined') console.warn('[sfx]', err);
  }

  // --- lifecycle -------------------------------------------------------------

  /** Create/resume the AudioContext. Call from a user gesture; safe to repeat. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return false;
        let ctx;
        try {
          ctx = new AC({ latencyHint: 'interactive' });
        } catch (e) {
          ctx = new AC();
        }
        this._init(ctx);
      }
      const ctx = this.ctx;
      // Sounds triggered by the same gesture that unlocks should still play,
      // even though resume() resolves a moment later.
      const ua = typeof navigator !== 'undefined' ? navigator.userActivation : null;
      if (!ua || ua.isActive) this._grace = wallNow() + 300;
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') p.then(() => this._onRunning(), () => {});
      }
      if (ctx.state === 'running') this._onRunning();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Convenience: unlock on the first pointer/key/touch event on `target`. */
  autoUnlock(target) {
    try {
      const el = target || (typeof window !== 'undefined' ? window : null);
      if (!el || this._autoBound) return;
      const go = () => this.unlock();
      const types = ['pointerdown', 'keydown', 'touchend'];
      for (const type of types) el.addEventListener(type, go, { passive: true });
      // dispose() removes these again; otherwise the next click would quietly
      // build a new AudioContext on an engine the game has thrown away.
      this._autoBound = () => {
        for (const type of types) el.removeEventListener(type, go);
      };
    } catch (e) { /* ignore */ }
  }

  _init(ctx) {
    this.ctx = ctx;
    this._noise = makeNoiseBuffers(ctx);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    const master = ctx.createGain();
    master.gain.value = this._masterTarget();
    // comp -> trim -> soft clipper -> master volume -> speakers
    const trim = ctx.createGain();
    trim.gain.value = OUT_TRIM / CLIP_RANGE;
    comp.connect(trim);
    let guard = trim;
    if (typeof ctx.createWaveShaper === 'function') {
      const clip = ctx.createWaveShaper();
      clip.curve = makeClipCurve();
      trim.connect(clip);
      guard = clip;
    } else {
      trim.gain.value = OUT_TRIM;
    }
    guard.connect(master);
    master.connect(ctx.destination);
    const bus = (g) => {
      const n = ctx.createGain();
      n.gain.value = g;
      n.connect(comp);
      return n;
    };
    this.comp = comp;
    this.master = master;
    this.sfxBus = bus(0.9 * this.config.sfxVolume);
    this.loopBus = bus(0.9 * this.config.sfxVolume);
    this.musicBus = bus(this.config.musicVolume);
    ctx.onstatechange = () => {
      if (ctx.state === 'running') this._onRunning();
    };
    // recorded samples: fetch (once) and decode now that a context exists
    if (this._smpLoad) this._decodeAll();
    else if (!this._offline) this.preloadSamples();
  }

  // --- recorded samples --------------------------------------------------------

  /**
   * Fetch every recorded sample and decode it once an AudioContext exists.
   * Called automatically on unlock; the game may call it earlier (e.g. while
   * loading) so the bytes are already downloaded when the player clicks.
   * Resolves (never rejects) with sampleInfo(). Missing or undecodable files
   * just leave that sound on its synth recipe.
   */
  preloadSamples() {
    try {
      if (!this._smpLoad) {
        const urls = new Set();
        for (const name in SOUNDS) {
          const s = SOUNDS[name].sample;
          if (!s) continue;
          const lists = Array.isArray(s) ? [s] : Object.values(s);
          for (const l of lists) for (const u of l) urls.add(u);
        }
        if (typeof fetch !== 'function' || !urls.size) {
          this._smpLoad = Promise.resolve();
        } else {
          const jobs = [];
          for (const url of urls) {
            const e = { url, state: 'fetch', bytes: null, buf: null, error: null };
            this._smp.set(url, e);
            jobs.push(
              fetch(url)
                .then((r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  return r.arrayBuffer();
                })
                .then((b) => {
                  e.bytes = b;
                  e.state = 'fetched';
                  return this._decode(e);
                })
                .catch((err) => {
                  e.state = 'error';
                  e.error = String((err && err.message) || err);
                })
            );
          }
          this._smpLoad = Promise.all(jobs);
        }
      }
      return this._smpLoad.then(() => this._decodeAll()).then(() => this.sampleInfo(), () => this.sampleInfo());
    } catch (err) {
      this._fail(err);
      return Promise.resolve(this.sampleInfo());
    }
  }

  _decodeAll() {
    const jobs = [];
    for (const e of this._smp.values()) if (e.state === 'fetched') jobs.push(this._decode(e));
    return Promise.all(jobs);
  }

  _decode(e) {
    const ctx = this.ctx;
    if (!ctx || e.state !== 'fetched' || !e.bytes) return Promise.resolve();
    e.state = 'decoding';
    const bytes = e.bytes;
    e.bytes = null;
    return new Promise((resolve) => {
      let settled = false;
      const ok = (buf) => {
        if (settled) return;
        settled = true;
        e.buf = buf;
        e.state = buf ? 'ok' : 'error';
        resolve();
      };
      const bad = (err) => {
        if (settled) return;
        settled = true;
        e.state = 'error';
        e.error = String((err && err.message) || err || 'decode failed');
        resolve();
      };
      try {
        // callback form for older Safari; the promise form is handled too
        const p = ctx.decodeAudioData(bytes, ok, bad);
        if (p && typeof p.then === 'function') p.then(ok, bad);
      } catch (err) {
        bad(err);
      }
    });
  }

  /** Sample loading state, for tooling: { total, ok, pending, failed, errors, played, synth }. */
  sampleInfo() {
    let ok = 0;
    let failed = 0;
    let pending = 0;
    const errors = [];
    for (const e of this._smp.values()) {
      if (e.state === 'ok') ok++;
      else if (e.state === 'error') {
        failed++;
        errors.push(`${e.url}: ${e.error}`);
      } else pending++;
    }
    return { total: this._smp.size, ok, pending, failed, errors, played: this.stats.sample, synth: this.stats.synth };
  }

  /** A decoded buffer for this sound (round-robin over its variants), or null. */
  _pickSample(d, o) {
    const s = d.sample;
    let list = s;
    let key = '';
    if (!Array.isArray(s)) {
      const raw = d.sampleBy ? o[d.sampleBy] : undefined;
      key = typeof raw === 'string' ? SAMPLE_ALIAS[raw] || raw : 'default';
      if (!s[key]) key = 'default';
      list = s[key];
    }
    if (!list || !list.length) return null;
    const rk = d.name + '|' + key;
    const n = list.length;
    // start after the last variant played, with a random skip so long runs don't loop audibly
    const prev = this._rr[rk];
    const start = prev === undefined ? Math.floor(Math.random() * n) : prev + 1 + (n > 2 && Math.random() < 0.35 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      const e = this._smp.get(list[i]);
      if (e && e.buf) {
        this._rr[rk] = i;
        return e.buf;
      }
    }
    return null;
  }

  _ok() {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (this._offline) return ctx.state !== 'closed';
    if (ctx.state === 'running') return true;
    return ctx.state === 'suspended' && wallNow() < this._grace;
  }

  _onRunning() {
    try {
      if (!this.ctx || this.ctx.state !== 'running') return;
      this._updateLoops(this.ctx.currentTime, true);
      const want = this._wantMusic;
      if (want && (!this._music || this._music.name !== want)) this._startMusic(want);
    } catch (e) { /* ignore */ }
  }

  /** True once audio is created and running. */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get volume() {
    return this._volume;
  }

  get muted() {
    return this._muted;
  }

  /** Number of one-shot voices currently sounding. */
  get voiceCount() {
    return this._voices.length;
  }

  has(name) {
    return name in SOUNDS || name in LOOPS || name in MUSIC;
  }

  // --- master ----------------------------------------------------------------

  _masterTarget() {
    return this._muted ? 0 : this._volume * this._volume; // squared: perceptual taper
  }

  _applyMaster() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this._masterTarget(), this.ctx.currentTime, 0.02);
  }

  setVolume(v) {
    try {
      this._volume = clamp(isNum(v) ? v : 0, 0, 1);
      this._applyMaster();
    } catch (e) { /* ignore */ }
  }

  setMuted(muted) {
    try {
      this._muted = !!muted;
      this._applyMaster();
    } catch (e) { /* ignore */ }
  }

  setMusicVolume(v) {
    try {
      this.config.musicVolume = clamp(isNum(v) ? v : 0, 0, 1);
      if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(this.config.musicVolume, this.ctx.currentTime, 0.03);
    } catch (e) { /* ignore */ }
  }

  /** Effects channel (one-shots and ambient loops), 0..1. */
  setSfxVolume(v) {
    try {
      this.config.sfxVolume = clamp(isNum(v) ? v : 0, 0, 1);
      if (!this.ctx) return;
      for (const b of [this.sfxBus, this.loopBus]) if (b) b.gain.setTargetAtTime(0.9 * this.config.sfxVolume, this.ctx.currentTime, 0.03);
    } catch (e) { /* ignore */ }
  }

  /** Menu click / hover sounds, 0..1 (multiplies on top of the effects channel). */
  setUiVolume(v) {
    try {
      this.config.uiVolume = clamp(isNum(v) ? v : 0, 0, 1);
    } catch (e) { /* ignore */ }
  }

  // --- listener / spatial ----------------------------------------------------

  /** Listener position and horizontal facing (right-handed, Y up, as in three.js). */
  setListener(x, y, z, forwardX, forwardZ) {
    try {
      const L = this._listener;
      if (isNum(x)) L.x = x;
      if (isNum(y)) L.y = y;
      if (isNum(z)) L.z = z;
      if (isNum(forwardX) && isNum(forwardZ)) {
        const len = Math.sqrt(forwardX * forwardX + forwardZ * forwardZ);
        if (len > 1e-6) {
          L.fx = forwardX / len;
          L.fz = forwardZ / len;
        }
      }
      if (this._loops.size && this._ok()) this._updateLoops(this.ctx.currentTime, false);
    } catch (e) { /* ignore */ }
  }

  _spatial(x, y, z, ref, max, roll) {
    const L = this._listener;
    const s = this._sp;
    const dx = x - L.x;
    const dy = y - L.y;
    const dz = z - L.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    s.far = 0;
    s.att = 1;
    if (dist > ref) {
      s.far = max > ref ? Math.min(1, (dist - ref) / (max - ref)) : 1;
      s.att = Math.pow(1 - s.far, roll);
    }
    // right = forward x up; sources within ~1.5 m collapse toward the centre
    const side = dx * -L.fz + dz * L.fx;
    let pan = (side / Math.sqrt(dx * dx + dz * dz + 2.25)) * this.config.panWidth;
    if (this.config.invertPan) pan = -pan;
    s.pan = clamp(pan, -1, 1);
    return s;
  }

  // --- one-shots -------------------------------------------------------------

  /**
   * Play a one-shot.
   * opts: { x, y, z } world position (omit for UI), { volume }, { pitch },
   * plus per-sound extras: weakpoint { step: 0..7 }, footstep
   * { surface: 'grass'|'road'|'wood' }, countdown_beep { final: true }.
   * Returns true if a voice actually started.
   */
  play(name, opts) {
    try {
      return this._play(name, opts || NO_OPTS);
    } catch (e) {
      this._fail(e);
      return false;
    }
  }

  _play(name, o) {
    const d = SOUNDS[name];
    if (!d || !this._ok()) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const last = this._lastPlay.get(name);
    if (last !== undefined && now - last < this.config.throttle && now >= last) return false;

    let gain = d.vol * (isNum(o.volume) ? Math.max(0, o.volume) : 1);
    if (name.startsWith('ui_')) gain *= this.config.uiVolume;
    let pan = 0;
    let far = 0;
    const positional = isNum(o.x) && isNum(o.z);
    if (positional) {
      const s = this._spatial(o.x, isNum(o.y) ? o.y : this._listener.y, o.z, d.ref, d.max, d.roll);
      gain *= s.att;
      pan = s.pan;
      far = s.far;
    }
    if (gain < 0.001) return false;

    this._prune(now);
    const loud = gain * d.pri;
    if (this._voices.length >= this.config.maxVoices && !this._steal(now, loud)) return false;
    this._lastPlay.set(name, now);

    const out = ctx.createGain();
    out.gain.value = gain;
    const nodes = [out];
    let tail = out;
    if (far > 0.15) {
      // distant sounds lose their top end
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900 + 17000 * (1 - far) * (1 - far);
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
    if (positional && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      tail.connect(p);
      tail = p;
      nodes.push(p);
    }
    tail.connect(this.sfxBus);

    const pitch = clamp((isNum(o.pitch) ? o.pitch : 1) * (1 + (Math.random() * 2 - 1) * d.vary), 0.25, 4);
    const buf = d.sample && this._smp.size ? this._pickSample(d, o) : null;
    if (buf) {
      // recorded variant: same gain / lowpass / pan chain, pitch via playbackRate
      if (d.sgain !== undefined) out.gain.value = gain * d.sgain;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = pitch;
      src.connect(out);
      src.start(now);
      nodes.push(src);
      const voice = { name, out, nodes, sources: [src], t0: now, end: now + buf.duration / pitch, loud, done: false, sample: true };
      src.onended = () => this._release(voice);
      this._voices.push(voice);
      this.stats.sample++;
      this.stats.last = 'sample';
      return true;
    }
    this.stats.synth++;
    this.stats.last = 'synth';
    const v = new Voice(ctx, out, now, pitch, this._noise);
    const voice = { name, out, nodes, sources: v.sources, t0: now, end: now, loud, done: false };
    try {
      d.fn(v, o);
    } catch (e) {
      this._fail(e);
      voice.end = v.end;
      this._kill(voice, now);
      return false;
    }
    voice.end = v.end;
    if (v.last) v.last.onended = () => this._release(voice);
    this._voices.push(voice);
    return true;
  }

  _release(voice) {
    if (voice.done) return;
    voice.done = true;
    const i = this._voices.indexOf(voice);
    if (i >= 0) this._voices.splice(i, 1);
    for (const n of voice.nodes) {
      try {
        n.disconnect();
      } catch (e) { /* ignore */ }
    }
  }

  _prune(now) {
    const list = this._voices;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].end < now - 0.05) this._release(list[i]);
    }
  }

  // Drop the quietest voice (older voices count as quieter; ties go to the
  // oldest). Returns false if the new sound is itself the quietest.
  _steal(now, loud) {
    const list = this._voices;
    let pick = -1;
    let min = Infinity;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const span = v.end - v.t0;
      const left = span > 0 ? clamp((v.end - now) / span, 0.1, 1) : 0.1;
      const score = v.loud * left;
      if (score < min) {
        min = score;
        pick = i;
      }
    }
    if (pick < 0 || min > loud) return false;
    const victim = list[pick];
    list.splice(pick, 1);
    this._kill(victim, now);
    return true;
  }

  _kill(voice, now) {
    try {
      voice.out.gain.cancelScheduledValues(now);
      voice.out.gain.setTargetAtTime(0, now, 0.006);
    } catch (e) { /* ignore */ }
    for (const s of voice.sources) {
      try {
        s.stop(now + 0.04);
      } catch (e) { /* ignore */ }
    }
    const i = this._voices.indexOf(voice);
    if (i >= 0) this._voices.splice(i, 1);
    setTimeout(() => this._release(voice), 120);
  }

  // --- loops -----------------------------------------------------------------

  /**
   * Start (or update) a continuous sound.
   * opts: { id, x, y, z, volume }. `chest_hum` is positional: give each chest
   * an id; only the nearest 4 in range are synthesized. Calling again with the
   * same id just moves it. Requests made before unlock start once unlocked.
   */
  startLoop(name, opts) {
    try {
      const def = LOOPS[name];
      if (!def) return;
      const o = opts || NO_OPTS;
      const id = o.id === undefined || o.id === null ? '' : String(o.id);
      const key = name + '|' + id;
      let e = this._loops.get(key);
      if (!e) {
        const level = this._loopLevel[name];
        e = { name, id, def, x: 0, y: 0, z: 0, pos: false, vol: 1, level: level === undefined ? 1 : level, att: 1, pan: 0, want: false, inst: null };
        this._loops.set(key, e);
      }
      if (def.positional && isNum(o.x) && isNum(o.z)) {
        e.pos = true;
        e.x = o.x;
        e.y = isNum(o.y) ? o.y : this._listener.y;
        e.z = o.z;
      }
      if (isNum(o.volume)) e.vol = Math.max(0, o.volume);
      if (this._ok()) this._updateLoops(this.ctx.currentTime, true);
    } catch (e) {
      this._fail(e);
    }
  }

  /** Stop a loop. `id` (or { id }) selects one instance; omit to stop all of that name. */
  stopLoop(name, id) {
    try {
      const want = id !== null && typeof id === 'object' ? id.id : id;
      const all = want === undefined || want === null;
      const now = this.ctx ? this.ctx.currentTime : 0;
      for (const [key, e] of this._loops) {
        if (e.name !== name || (!all && e.id !== String(want))) continue;
        this._loopOff(e, now);
        this._loops.delete(key);
      }
    } catch (e) { /* ignore */ }
  }

  /** Scale a loop's level 0..1 (e.g. storm intensity). Optional id for one instance. */
  setLoopGain(name, gain, id) {
    try {
      if (!LOOPS[name]) return;
      const g = clamp(isNum(gain) ? gain : 0, 0, 1);
      const all = id === undefined || id === null;
      if (all) this._loopLevel[name] = g;
      const now = this.ctx ? this.ctx.currentTime : 0;
      for (const e of this._loops.values()) {
        if (e.name !== name || (!all && e.id !== String(id))) continue;
        e.level = g;
        if (e.inst) e.inst.gain.gain.setTargetAtTime(e.def.vol * e.vol * e.level * e.att, now, 0.08);
      }
    } catch (e) { /* ignore */ }
  }

  _updateLoops(now, force) {
    if (!force && now - this._loopT < 0.06 && now >= this._loopT) return;
    this._loopT = now;
    let groups = null;
    for (const e of this._loops.values()) {
      if (e.pos) {
        const s = this._spatial(e.x, e.y, e.z, e.def.ref, e.def.max, e.def.roll);
        e.att = s.att;
        e.pan = s.pan;
      } else {
        e.att = 1;
        e.pan = 0;
      }
      e.want = e.att > 0.002;
      if (e.want && e.pos && e.def.maxActive) {
        groups = groups || {};
        (groups[e.name] = groups[e.name] || []).push(e);
      }
    }
    if (groups) {
      for (const name in groups) {
        const g = groups[name];
        const cap = LOOPS[name].maxActive;
        if (g.length <= cap) continue;
        // nearest first; a small bonus for already-playing emitters avoids flicker
        g.sort((a, b) => b.att * (b.inst ? 1.1 : 1) - a.att * (a.inst ? 1.1 : 1));
        for (let i = cap; i < g.length; i++) g[i].want = false;
      }
    }
    for (const e of this._loops.values()) {
      if (e.want && !e.inst) this._loopOn(e, now);
      else if (!e.want && e.inst) this._loopOff(e, now);
      if (e.inst) {
        e.inst.gain.gain.setTargetAtTime(e.def.vol * e.vol * e.level * e.att, now, e.inst.fresh ? 0.15 : 0.08);
        e.inst.fresh = false;
        if (e.inst.pan) e.inst.pan.pan.setTargetAtTime(e.pan, now, 0.08);
      }
    }
  }

  _loopOn(e, now) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let pan = null;
    if (e.pos && typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = e.pan;
      gain.connect(pan);
      pan.connect(this.loopBus);
    } else {
      gain.connect(this.loopBus);
    }
    let sources = [];
    try {
      sources = e.def.build(ctx, gain, this._noise, now);
    } catch (err) {
      this._fail(err);
      try {
        gain.disconnect();
      } catch (e2) { /* ignore */ }
      return;
    }
    e.inst = { gain, pan, sources, fresh: true };
  }

  _loopOff(e, now) {
    const inst = e.inst;
    if (!inst) return;
    e.inst = null;
    try {
      inst.gain.gain.cancelScheduledValues(now);
      inst.gain.gain.setTargetAtTime(0, now, 0.08);
    } catch (err) { /* ignore */ }
    for (const s of inst.sources) {
      try {
        s.stop(now + 0.6);
      } catch (err) { /* ignore */ }
    }
    setTimeout(() => {
      try {
        inst.gain.disconnect();
        if (inst.pan) inst.pan.disconnect();
      } catch (err) { /* ignore */ }
    }, 800);
  }

  // --- music -----------------------------------------------------------------

  /**
   * 'menu' loops until stopMusic(); 'victory' and 'defeat' play once (and
   * replace whatever was playing). A looping track requested before unlock
   * starts as soon as audio is unlocked.
   */
  playMusic(name) {
    try {
      const M = MUSIC[name];
      if (!M) return;
      this._wantMusic = M.loop ? name : null;
      if (!this._ok()) return;
      if (M.loop && this._music && this._music.name === name) return;
      this._startMusic(name);
    } catch (e) {
      this._fail(e);
    }
  }

  /**
   * Replace a music track with an audio file (e.g. a local, git-ignored MP3).
   * The file plays through the music bus, so volume settings apply; it loops
   * when the track it replaces loops. Pass null to go back to the synth track.
   */
  setCustomMusic(name, url) {
    if (!(name in MUSIC)) return;
    if (url) this._custom[name] = url;
    else delete this._custom[name];
    if (this._music && this._music.name === name && this._ok()) this._startMusic(name);
  }

  stopMusic() {
    try {
      this._wantMusic = null;
      this._endMusic(0.12);
    } catch (e) { /* ignore */ }
  }

  _startMusic(name) {
    const M = MUSIC[name];
    const ctx = this.ctx;
    this._endMusic(0.05);
    const now = ctx.currentTime;
    const track = ctx.createGain();
    track.gain.value = M.vol;
    track.connect(this.musicBus);
    const m = { name, M, track, nodes: [track], buses: null, step: 0, next: now + 0.06, timer: null, endTimer: null, audio: null };
    this._music = m;
    const customUrl = this._custom[name];
    if (customUrl && !this._offline && typeof Audio !== 'undefined') {
      const audio = new Audio(customUrl);
      audio.loop = !!M.loop;
      audio.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(audio);
      src.connect(track);
      m.nodes.push(src);
      m.audio = audio;
      track.gain.value = 0.9; // recorded music is already mixed; skip the synth track level
      audio.addEventListener('ended', () => {
        if (this._music === m) this._endMusic(0.05);
      });
      audio.play().catch((e) => {
        // file missing or blocked: fall back to the synthesized track
        if (this._music !== m) return;
        delete this._custom[name];
        this._fail(e);
        this._startMusic(name);
      });
      return;
    }
    if (M.loop) {
      const rig = M.setup(ctx, track);
      m.buses = rig.buses;
      for (const n of rig.nodes) m.nodes.push(n);
      if (this._offline) {
        for (; m.next < this._offlineEnd; m.step++, m.next += M.stepDur) {
          M.step(new Voice(ctx, m.track, m.next, 1, this._noise), m, m.step % M.steps);
        }
        return;
      }
      m.timer = setInterval(() => this._musicTick(m), 40);
      this._musicTick(m);
    } else {
      M.play(new Voice(ctx, track, now + 0.05, 1, this._noise));
      if (this._offline) return;
      m.endTimer = setTimeout(() => {
        if (this._music === m) this._endMusic(0.05);
      }, (M.dur + 0.4) * 1000);
    }
  }

  // Look-ahead scheduler: notes are queued a little ahead on the audio clock.
  _musicTick(m) {
    try {
      const ctx = this.ctx;
      if (!ctx || this._music !== m || ctx.state !== 'running') return;
      const M = m.M;
      const now = ctx.currentTime;
      // background tabs throttle timers to ~1 Hz, so queue further ahead there
      const hidden = typeof document !== 'undefined' && document.hidden;
      const ahead = hidden ? 1.5 : 0.2;
      if (m.next < now - 0.05) {
        // fell behind (suspended / throttled): skip forward, staying on the grid
        const skip = Math.ceil((now + 0.02 - m.next) / M.stepDur);
        m.step += skip;
        m.next += skip * M.stepDur;
      }
      let guard = 0;
      while (m.next < now + ahead && guard++ < 64) {
        M.step(new Voice(ctx, m.track, m.next, 1, this._noise), m, m.step % M.steps);
        m.step++;
        m.next += M.stepDur;
      }
    } catch (e) {
      this._fail(e);
    }
  }

  _endMusic(fade) {
    const m = this._music;
    if (!m) return;
    this._music = null;
    if (m.timer) clearInterval(m.timer);
    if (m.endTimer) clearTimeout(m.endTimer);
    try {
      const now = this.ctx.currentTime;
      m.track.gain.cancelScheduledValues(now);
      m.track.gain.setTargetAtTime(0, now, fade);
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (m.audio) {
        try {
          m.audio.pause();
          m.audio.removeAttribute('src');
          m.audio.load();
        } catch (e) { /* ignore */ }
      }
      for (const n of m.nodes) {
        try {
          n.disconnect();
        } catch (e) { /* ignore */ }
      }
    }, fade * 6000 + 100);
  }

  /** Name of the music track currently playing, or null. */
  get musicPlaying() {
    return this._music ? this._music.name : null;
  }

  /** Stop everything, drop the autoUnlock listeners and close the AudioContext. */
  dispose() {
    try {
      if (typeof this._autoBound === 'function') this._autoBound();
      this._autoBound = false;
      this._wantMusic = null;
      this._endMusic(0.01);
      const now = this.ctx ? this.ctx.currentTime : 0;
      for (const e of this._loops.values()) this._loopOff(e, now);
      this._loops.clear();
      for (const v of this._voices.slice()) this._kill(v, now);
      this._lastPlay.clear();
      const ctx = this.ctx;
      this.ctx = null;
      this.comp = this.master = this.sfxBus = this.loopBus = this.musicBus = null;
      this._noise = null;
      if (ctx) {
        ctx.onstatechange = null;
        if (typeof ctx.close === 'function') {
          const p = ctx.close();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      }
    } catch (e) { /* ignore */ }
  }
}

export const sfx = new Sfx();
export default sfx;
