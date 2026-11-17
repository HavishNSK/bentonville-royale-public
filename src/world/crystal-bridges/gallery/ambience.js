// BENTONVILLE ROYALE — Crystal Bridges ambience: musewalk's synthesized gallery sound.
// Port of musewalk src/audio.js (MIT License, Copyright (c) 2026 Musewalk contributors): the
// same graph and constants (drone 55/110 Hz -> LP 160; triangle pad on 146.83/220/293.66/
// 329.63/440 Hz -> LP per mode; looped noise "tide" HP 110 / LP 480 swept by a 6.5 s tide
// clock; pentatonic chimes into a 0.309 / 0.473 s cross-feedback delay; master LP 3200 ->
// compressor -2.5:1). Adaptations: it feeds the game's music bus (so the music-volume setting
// and mute apply) through its own gain, which `update()` drives from the interior factor and
// ducks under nearby gunfire or the storm. Built lazily on the first update with a running context.

const MASTER_LEVEL = 0.42;
const CHIME_LEVEL = 0.0085;
const CHIME_DECAY = 6.5;
const TIDE_PERIOD = 6.5;
const PENTA = [440, 493.88, 554.37, 659.25, 739.99, 880];
const MODES = { hall: { pad: 0.019, cutoff: 560, tide: 0.7, chime: [14, 26] }, lobby: { pad: 0.022, cutoff: 680, tide: 0.9, chime: [12, 24] } };

export class Ambience {
  constructor(sfx) {
    this.sfx = sfx;
    this.ready = false;
    this.level = 0;
    this._chimeT = 6;
    this._t = 0;
    this.mode = 'hall';
  }

  _build() {
    const ctx = this.sfx && this.sfx.ctx;
    const out = this.sfx && (this.sfx.musicBus || this.sfx.master);
    if (!ctx || !out || ctx.state !== 'running') return false;
    this.ctx = ctx;
    const masterLP = ctx.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = 3200;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.25;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    masterLP.connect(comp);
    comp.connect(this.master);
    this.master.connect(out);
    this.bus = masterLP;
    // drone
    const droneLP = ctx.createBiquadFilter();
    droneLP.type = 'lowpass';
    droneLP.frequency.value = 160;
    const droneG = ctx.createGain();
    droneG.gain.value = 0.02;
    droneLP.connect(droneG);
    droneG.connect(this.bus);
    for (const f of [55, 55, 110]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(droneLP);
      o.start();
    }
    // pad
    this.padLP = ctx.createBiquadFilter();
    this.padLP.type = 'lowpass';
    this.padLP.Q.value = 0.5;
    this.padLP.frequency.value = MODES.hall.cutoff;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = MODES.hall.pad;
    this.padLP.connect(this.padGain);
    this.padGain.connect(this.bus);
    [146.83, 220, 293.66, 329.63, 440].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = i % 2 ? 4 : -4;
      o.connect(this.padLP);
      o.start();
    });
    // tide: 2 s looped white noise
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    this.tideLP = ctx.createBiquadFilter();
    this.tideLP.type = 'lowpass';
    this.tideLP.frequency.value = 480;
    this.tideLP.Q.value = 0.4;
    this.tideGain = ctx.createGain();
    this.tideGain.gain.value = 0;
    src.connect(hp);
    hp.connect(this.tideLP);
    this.tideLP.connect(this.tideGain);
    this.tideGain.connect(this.bus);
    src.start();
    // chimes -> cross-feedback delay
    const d1 = ctx.createDelay(2);
    d1.delayTime.value = 0.309;
    const d2 = ctx.createDelay(2);
    d2.delayTime.value = 0.473;
    const fb1 = ctx.createGain();
    fb1.gain.value = 0.34;
    const fb2 = ctx.createGain();
    fb2.gain.value = 0.3;
    d1.connect(fb1);
    fb1.connect(d2);
    d2.connect(fb2);
    fb2.connect(d1);
    const wetLP = ctx.createBiquadFilter();
    wetLP.type = 'lowpass';
    wetLP.frequency.value = 1600;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    d1.connect(wetLP);
    d2.connect(wetLP);
    wetLP.connect(wet);
    wet.connect(this.bus);
    this.chimeBus = ctx.createGain();
    this.chimeBus.connect(d1);
    this.chimeBus.connect(this.bus);
    this.ready = true;
    return true;
  }

  /** 0..1 tide (musewalk tide01: asymmetric 42% rise / 58% fall). */
  tide01() {
    const ph = (this._t % TIDE_PERIOD) / TIDE_PERIOD;
    const q = ph < 0.42 ? (ph / 0.42) * 0.5 : 0.5 + ((ph - 0.42) / 0.58) * 0.5;
    return 0.5 - 0.5 * Math.cos(q * Math.PI * 2);
  }

  chime() {
    if (!this.ready || this.level < 0.05) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const base = PENTA[(Math.random() * PENTA.length) | 0] * 0.5;
    for (const [f, amp] of [[base, 1], [base * 2.004, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(CHIME_LEVEL * amp, t0 + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + CHIME_DECAY);
      o.connect(g);
      g.connect(this.chimeBus);
      o.start(t0);
      o.stop(t0 + CHIME_DECAY + 0.5);
    }
  }

  /** k: 0 outside .. 1 deep in a gallery; duck: 0..1 (gunfire / storm nearby). */
  update(dt, k, duck = 0, mode = 'hall') {
    this._t += dt;
    if (!this.ready) {
      if (k < 0.02 || !this._build()) return;
    }
    const ctx = this.ctx;
    const target = MASTER_LEVEL * k * (1 - Math.min(1, duck));
    this.level = target;
    this.master.gain.setTargetAtTime(target, ctx.currentTime, duck > 0.3 ? 0.25 : 1.2);
    const m = MODES[mode] || MODES.hall;
    if (mode !== this.mode) {
      this.mode = mode;
      this.padLP.frequency.setTargetAtTime(m.cutoff, ctx.currentTime, 2.2);
    }
    this._tick = (this._tick || 0) - dt;
    if (this._tick <= 0) {
      this._tick = 0.08;
      const tide = this.tide01();
      this.padGain.gain.setTargetAtTime(m.pad * (0.82 + 0.34 * tide), ctx.currentTime, 0.12);
      this.tideGain.gain.setTargetAtTime(0.02 * m.tide * (0.3 + 0.95 * (1 - tide)), ctx.currentTime, 0.18);
      this.tideLP.frequency.setTargetAtTime(380 + 320 * tide, ctx.currentTime, 0.18);
    }
    this._chimeT -= dt;
    if (this._chimeT <= 0) {
      this._chimeT = m.chime[0] + Math.random() * (m.chime[1] - m.chime[0]);
      if (k > 0.5 && duck < 0.2) this.chime();
    }
  }
}
