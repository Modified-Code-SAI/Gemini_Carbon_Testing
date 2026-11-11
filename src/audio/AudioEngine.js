export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.initialized = false;

    this._noiseBuffer = null;
    this._rainGain = null;
    this._turbineOsc = null;
    this._turbineGain = null;
    this._jetNoiseGain = null;
  }

  init() {
    if (this.initialized) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0.0 : 0.68;

    // Gentle master dynamics compressor so missile salvos + thunder never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    this._buildNoiseBuffer();
    this._startAmbientRainAndTurbine();
    this.initialized = true;
  }

  _buildNoiseBuffer() {
    const len = this.ctx.sampleRate * 2.5;
    this._noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
  }

  _startAmbientRainAndTurbine() {
    // 1. Continuous Monsoon Rain Wash
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = this._noiseBuffer;
    rainSrc.loop = true;

    const rainBp = this.ctx.createBiquadFilter();
    rainBp.type = 'bandpass';
    rainBp.frequency.value = 1050;
    rainBp.Q.value = 0.65;

    this._rainGain = this.ctx.createGain();
    this._rainGain.gain.value = 0.14;

    rainSrc.connect(rainBp);
    rainBp.connect(this._rainGain);
    this._rainGain.connect(this.master);
    rainSrc.start();

    // 2. Continuous Mech Vernier Turbine Idle / Skate Whine
    this._turbineOsc = this.ctx.createOscillator();
    this._turbineOsc.type = 'sawtooth';
    this._turbineOsc.frequency.value = 78;

    const turbLp = this.ctx.createBiquadFilter();
    turbLp.type = 'lowpass';
    turbLp.frequency.value = 320;

    this._turbineGain = this.ctx.createGain();
    this._turbineGain.gain.value = 0.025;

    this._turbineOsc.connect(turbLp);
    turbLp.connect(this._turbineGain);
    this._turbineGain.connect(this.master);
    this._turbineOsc.start();

    // Jet air rush noise during skate boost
    const jetSrc = this.ctx.createBufferSource();
    jetSrc.buffer = this._noiseBuffer;
    jetSrc.loop = true;
    const jetBp = this.ctx.createBiquadFilter();
    jetBp.type = 'bandpass';
    jetBp.frequency.value = 460;
    jetBp.Q.value = 0.9;
    this._jetNoiseGain = this.ctx.createGain();
    this._jetNoiseGain.gain.value = 0.0;
    jetSrc.connect(jetBp);
    jetBp.connect(this._jetNoiseGain);
    this._jetNoiseGain.connect(this.master);
    jetSrc.start();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0.0 : 0.68, this.ctx.currentTime, 0.04);
    }
  }

  setThrusterLevel(level) {
    if (!this.initialized || !this.ctx) return;
    const t = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, level));
    this._turbineOsc.frequency.setTargetAtTime(75 + clamped * 155, t, 0.08);
    this._turbineGain.gain.setTargetAtTime(0.02 + clamped * 0.065, t, 0.08);
    this._jetNoiseGain.gain.setTargetAtTime(clamped * 0.16, t, 0.08);
  }

  playFootstep(scale = 1.0) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;

    // Sub-bass armored chassis thud
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 0.16);
    g.gain.setValueAtTime(0.24 * scale, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);

    // Floodwater splash burst
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1250;
    bp.Q.value = 0.9;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.11 * scale, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp);
    bp.connect(sg);
    sg.connect(this.master);
    src.start(t, Math.random() * 1.2, 0.24);
  }

  playQuickBoost() {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.34);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.8, 0.38);
  }

  playAutocannon() {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    const base = 135 + (Math.random() - 0.5) * 24;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.065);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.08);

    const snap = this.ctx.createBufferSource();
    snap.buffer = this._noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 950;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.14, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    snap.connect(hp);
    hp.connect(ng);
    ng.connect(this.master);
    snap.start(t, Math.random() * 1.5, 0.06);
  }

  playRailCharge() {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(1180, t + 0.44);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.01, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.38);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.46);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.47);
  }

  playRailCannon(charge = 1.0) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;

    // Hyper-velocity crack + deep electromagnetic discharge
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(260 * (0.7 + charge * 0.4), t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.42);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.46);

    this.playExplosion(0.65);
  }

  playLockChirp(lockIndex = 1) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    const freq = 760 + Math.min(12, lockIndex) * 58;
    osc.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.065, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.048);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  playMissileLaunch(count = 4) {
    if (!this.initialized || this.muted) return;
    const launches = Math.min(5, count);
    for (let i = 0; i < launches; i++) {
      const t = this.ctx.currentTime + i * 0.045;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1650, t);
      bp.frequency.exponentialRampToValueAtTime(520, t + 0.24);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.master);
      src.start(t, Math.random() * 1.0, 0.28);
    }
  }

  playPulseArmor() {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  playArmorHit() {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(195, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.14);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  playCoverFracture(scale = 1.0) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, t);
    lp.frequency.exponentialRampToValueAtTime(95, t + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.38 * scale, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.6, 0.6);
  }

  playExplosion(scale = 1.0) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(720, t);
    lp.frequency.exponentialRampToValueAtTime(68, t + 0.62 * scale);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.55, 0.34 * scale), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.66 * scale);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5, 0.7 * scale);
  }

  playThunder(intensity = 0.85) {
    if (!this.initialized || this.muted) return;
    const t = this.ctx.currentTime + 0.24;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(240, t);
    lp.frequency.exponentialRampToValueAtTime(48, t + 1.65);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.32 * intensity, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.75);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start(t, 0, 1.8);
  }
}
