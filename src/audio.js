// Audio sintetizado (WebAudio) - sin ficheros externos
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.ambientOn = false;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
    this.startAmbient();
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }
  startAmbient() {
    if (!this.ctx || this.ambientOn) return;
    this.ambientOn = true;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.05; g.connect(this.master);
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 320; filt.connect(g);
    for (const f of [55, 82.5, 110.3]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const og = c.createGain(); og.gain.value = 0.25;
      o.connect(og); og.connect(filt); o.start();
      const lfo = c.createOscillator(); lfo.frequency.value = 0.05 + Math.random() * 0.1;
      const lg = c.createGain(); lg.gain.value = 0.12;
      lfo.connect(lg); lg.connect(og.gain); lfo.start();
    }
    this.ambientGain = g;
  }
  tone(freq, dur, type = 'sine', vol = 0.25, slide = 0) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol = 0.3, freq = 1200, q = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  play(kind) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume().catch(() => {});
    switch (kind) {
      case 'shot': this.noise(0.12, 0.35, 900, 0.8); this.tone(160, 0.1, 'square', 0.12, -100); break;
      case 'kill': this.tone(90, 0.35, 'sawtooth', 0.18, -40); this.noise(0.2, 0.15, 400); break;
      case 'subdue': this.tone(220, 0.18, 'sine', 0.15, -120); break;
      case 'good': this.tone(660, 0.1, 'sine', 0.16); setTimeout(() => this.tone(990, 0.14, 'sine', 0.14), 90); break;
      case 'bad': this.tone(180, 0.3, 'square', 0.16, -60); break;
      case 'warn': this.tone(420, 0.12, 'triangle', 0.12); break;
      case 'alarm': this.tone(880, 0.18, 'square', 0.2); setTimeout(() => this.tone(660, 0.25, 'square', 0.2), 180); setTimeout(() => this.tone(880, 0.3, 'square', 0.18), 420); break;
      case 'ui': this.tone(1200, 0.04, 'square', 0.06); break;
      case 'poison': this.tone(520, 0.25, 'sine', 0.12, 260); break;
      case 'spark': this.noise(0.3, 0.3, 3200, 0.6); this.tone(1400, 0.15, 'sawtooth', 0.1, -900); break;
      case 'coin': this.tone(1800, 0.08, 'triangle', 0.12); setTimeout(() => this.tone(2400, 0.1, 'triangle', 0.09), 70); break;
      case 'crash': this.noise(0.7, 0.45, 500, 0.4); this.tone(70, 0.6, 'sawtooth', 0.25, -30); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'triangle', 0.16), i * 160)); break;
      case 'lose': [400, 320, 240, 160].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'sawtooth', 0.16), i * 200)); break;
      case 'instinct': this.tone(300, 0.5, 'sine', 0.1, 500); break;
      case 'hack':
        this.tone(740, 0.08, 'sine', 0.13, 380);
        setTimeout(() => this.tone(1180, 0.11, 'triangle', 0.12, 220), 65);
        break;
      case 'overheat':
        this.noise(0.28, 0.28, 2400, 0.9);
        this.tone(240, 0.26, 'sawtooth', 0.16, 620);
        break;
      case 'cam_hop':
        this.noise(0.06, 0.14, 4200, 1.4);
        this.tone(920, 0.09, 'sine', 0.11, -240);
        break;
      case 'trace_warn':
        this.tone(620, 0.14, 'square', 0.15);
        setTimeout(() => this.tone(780, 0.16, 'square', 0.15), 140);
        break;
      case 'link_lost':
        this.noise(0.16, 0.22, 1500, 0.7);
        this.tone(480, 0.22, 'sawtooth', 0.14, -310);
        break;
    }
  }
}
