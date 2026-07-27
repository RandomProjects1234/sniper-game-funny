/* =========================================================================
   LONGSHOT — procedural audio. Everything is synthesised, no asset files.
   ========================================================================= */
(function (global) {
  'use strict';

  const AUD = {
    ctx: null,
    master: null,
    muted: false,
    _noise: null,

    init() {
      if (this.ctx) return;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 8;
      this.master.connect(comp).connect(this.ctx.destination);
    },

    resume() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : 0.55;
    },

    /* One second of white noise, reused by every noise-based voice. */
    noiseBuffer() {
      if (this._noise) return this._noise;
      const sr = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, sr, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
      return buf;
    },

    noise(dur, { gain = 0.4, type = 'lowpass', freq = 1200, q = 1, sweepTo = null, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + delay;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      if (sweepTo != null) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.008, dur * 0.2));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t); src.stop(t + dur + 0.05);
    },

    tone(freq, dur, { gain = 0.2, type = 'sine', to = null, delay = 0 } = {}) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to != null) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    },

    /* ------------------------------ voices ----------------------------- */

    shot() {
      this.noise(0.16, { gain: 0.85, type: 'lowpass', freq: 5200, sweepTo: 320 });
      this.noise(0.5, { gain: 0.25, type: 'lowpass', freq: 700, sweepTo: 120, delay: 0.02 });
      this.tone(160, 0.22, { gain: 0.5, type: 'square', to: 42 });
      this.tone(72, 0.55, { gain: 0.35, type: 'sine', to: 30, delay: 0.01 });
      // canyon slap-back
      this.noise(0.42, { gain: 0.10, type: 'bandpass', freq: 900, q: 0.8, delay: 0.26 });
      this.noise(0.55, { gain: 0.05, type: 'bandpass', freq: 600, q: 0.8, delay: 0.52 });
    },

    bolt() {
      this.noise(0.05, { gain: 0.2, type: 'highpass', freq: 2400 });
      this.tone(880, 0.05, { gain: 0.09, type: 'square', to: 520, delay: 0.05 });
      this.noise(0.06, { gain: 0.16, type: 'highpass', freq: 1800, delay: 0.11 });
    },

    reload() {
      this.noise(0.07, { gain: 0.22, type: 'highpass', freq: 1600 });
      this.tone(420, 0.06, { gain: 0.10, type: 'square', to: 260, delay: 0.16 });
      this.noise(0.09, { gain: 0.26, type: 'lowpass', freq: 2600, delay: 0.34 });
      this.tone(300, 0.08, { gain: 0.12, type: 'square', to: 180, delay: 0.46 });
    },

    empty() {
      this.tone(1400, 0.04, { gain: 0.12, type: 'square', to: 700 });
      this.noise(0.05, { gain: 0.12, type: 'highpass', freq: 3000, delay: 0.03 });
    },

    /* Impact is delayed by travel time from the game code. */
    hitBody(delay) {
      this.noise(0.14, { gain: 0.45, type: 'lowpass', freq: 420, sweepTo: 90, delay });
      this.tone(120, 0.12, { gain: 0.22, type: 'sine', to: 55, delay });
    },

    hitHead(delay) {
      this.tone(1750, 0.30, { gain: 0.30, type: 'sine', to: 900, delay });
      this.tone(2600, 0.22, { gain: 0.16, type: 'triangle', to: 1400, delay: delay + 0.01 });
      this.noise(0.18, { gain: 0.35, type: 'bandpass', freq: 1800, q: 2, delay });
    },

    hitArmor(delay) {
      this.tone(2200, 0.16, { gain: 0.22, type: 'square', to: 1500, delay });
      this.noise(0.10, { gain: 0.22, type: 'highpass', freq: 2600, delay });
    },

    hitDirt(delay) {
      this.noise(0.20, { gain: 0.24, type: 'lowpass', freq: 900, sweepTo: 160, delay });
    },

    enemyShot(delay) {
      this.noise(0.10, { gain: 0.25, type: 'bandpass', freq: 1100, q: 0.7, delay });
      this.tone(90, 0.28, { gain: 0.20, type: 'sine', to: 40, delay: delay + 0.02 });
    },

    incoming() {
      this.tone(280, 0.5, { gain: 0.16, type: 'sawtooth', to: 180 });
      this.noise(0.5, { gain: 0.10, type: 'bandpass', freq: 500, q: 3 });
    },

    breach() {
      this.tone(180, 0.7, { gain: 0.30, type: 'sawtooth', to: 60 });
      this.noise(0.6, { gain: 0.20, type: 'lowpass', freq: 500, sweepTo: 100 });
    },

    focusIn() {
      this.tone(300, 0.6, { gain: 0.16, type: 'sine', to: 1200 });
      this.noise(0.6, { gain: 0.10, type: 'bandpass', freq: 700, q: 4, sweepTo: 3000 });
    },

    focusOut() {
      this.tone(900, 0.4, { gain: 0.12, type: 'sine', to: 240 });
    },

    waveStart(n) {
      for (let i = 0; i < 3; i++) {
        this.tone(330 * Math.pow(1.26, i), 0.22, { gain: 0.13, type: 'triangle', delay: i * 0.13 });
      }
      if (n % 5 === 0) this.tone(110, 1.2, { gain: 0.16, type: 'sawtooth', to: 90, delay: 0.4 });
    },

    waveClear() {
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone(f, 0.35, { gain: 0.14, type: 'triangle', delay: i * 0.09 }));
    },

    ui() { this.tone(660, 0.05, { gain: 0.08, type: 'square', to: 880 }); },

    upgrade() {
      [440, 554, 659, 880].forEach((f, i) =>
        this.tone(f, 0.5, { gain: 0.12, type: 'sine', delay: i * 0.06 }));
    },

    gameOver() {
      [392, 330, 262, 196].forEach((f, i) =>
        this.tone(f, 0.9, { gain: 0.18, type: 'sawtooth', delay: i * 0.22 }));
      this.noise(1.6, { gain: 0.10, type: 'lowpass', freq: 700, sweepTo: 80, delay: 0.2 });
    },

    heartbeat() {
      this.tone(58, 0.16, { gain: 0.22, type: 'sine', to: 34 });
      this.tone(52, 0.13, { gain: 0.15, type: 'sine', to: 30, delay: 0.19 });
    },

    gasp() {
      this.noise(0.45, { gain: 0.22, type: 'bandpass', freq: 900, q: 1.2, sweepTo: 2200 });
    },
  };

  global.AUD = AUD;
})(window);
