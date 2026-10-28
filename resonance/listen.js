// Microphone layer for Resonance. Everything runs on this device: the audio is
// analysed in memory and never stored or sent anywhere.
//  - level(): a 56-band log-mel snapshot for the landscape (same band layout as the terrain)
//  - a 1978-style isolated-word recogniser: energy endpointing + log-mel features +
//    dynamic time warping against templates made from the synthetic voice.

const WORKLET = `class Tap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor('resonance-tap', Tap);`;

const hzToMel = f => 2595 * Math.log10(1 + f / 700);
const melToHz = m => 700 * (10 ** (m / 2595) - 1);

function melBank(sr, nfft, bands, fmin, fmax) {
  const edges = Array.from({ length: bands + 2 }, (_, i) => melToHz(hzToMel(fmin) + (hzToMel(fmax) - hzToMel(fmin)) * i / (bands + 1)));
  const bins = nfft / 2 + 1;
  return Array.from({ length: bands }, (_, b) => {
    const w = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const f = k * sr / nfft;
      w[k] = Math.max(0, Math.min((f - edges[b]) / (edges[b + 1] - edges[b]), (edges[b + 2] - f) / (edges[b + 2] - edges[b + 1])));
    }
    return w;
  });
}

// in-place iterative radix-2 FFT
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function decodeTemplates(spectra) {
  const spec = spectra.templateSpec, out = [];
  for (const [sig, list] of Object.entries(spectra.templates)) {
    for (const t of list) {
      const bytes = Uint8Array.from(atob(t.data), c => c.charCodeAt(0));
      const q = new Int8Array(bytes.buffer);
      const frames = [];
      for (let i = 0; i < t.frames; i++) frames.push(Float32Array.from(q.subarray(i * spec.bands, (i + 1) * spec.bands), v => v / spec.scale));
      out.push({ sig, voice: t.voice, frames });
    }
  }
  return out;
}

function dtw(a, b) {
  const n = a.length, m = b.length, band = Math.max(8, Math.round(0.4 * Math.max(n, m)));
  let prev = new Float32Array(m + 1).fill(Infinity), cur = new Float32Array(m + 1);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const centre = Math.round(i * m / n);
    for (let j = Math.max(1, centre - band); j <= Math.min(m, centre + band); j++) {
      let d = 0;
      const x = a[i - 1], y = b[j - 1];
      for (let k = 0; k < x.length; k++) { const t = x[k] - y[k]; d += t * t; }
      cur[j] = Math.sqrt(d) + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

export class Listener {
  constructor(spectra, { onLevel, onUtterance, onState } = {}) {
    this.spectra = spectra;
    this.onLevel = onLevel; this.onUtterance = onUtterance; this.onState = onState;
    this.templates = null;
    this.active = false;
  }

  async start() {
    if (this.active) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.35;
    src.connect(this.analyser);
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    // 56 display bands, laid out like the terrain rows (70 Hz – 7.6 kHz, mel)
    const sr = this.ctx.sampleRate, nfft = this.analyser.fftSize;
    this.display = melBank(sr, nfft, this.spectra.bins, this.spectra.fmin, this.spectra.fmax);
    this.levels = new Float32Array(this.spectra.bins);
    // raw samples for the recogniser
    const spec = this.spectra.templateSpec;
    this.win = Math.round(spec.win * sr); this.hop = Math.round(spec.hop * sr);
    this.nfft = 1 << Math.ceil(Math.log2(this.win));
    this.window = Float32Array.from({ length: this.win }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (this.win - 1)));
    this.bank = melBank(sr, this.nfft, spec.bands, spec.fmin, spec.fmax);
    this.templates = this.templates || decodeTemplates(this.spectra);
    this.samples = []; this.pending = new Float32Array(0);
    this.frameDb = []; this.floor = null; this.speechRun = 0; this.silenceRun = 0; this.inUtt = false; this.uttStart = 0;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.tap = new AudioWorkletNode(this.ctx, 'resonance-tap');
      this.tap.port.onmessage = e => this.push(e.data);
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      src.connect(this.tap); this.tap.connect(mute); mute.connect(this.ctx.destination);
    } catch { this.tap = null; /* the landscape still listens; word matching is skipped */ }
    this.active = true;
    this.onState?.('listening', { recogniser: !!this.tap });
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.stream?.getTracks().forEach(t => t.stop());
    this.tap?.port.close();
    this.ctx?.close();
    this.levels?.fill(0);
    this.onState?.('stopped');
  }

  // called every animation frame; returns smoothed 0..1 levels per display band
  level() {
    if (!this.active) return null;
    this.analyser.getFloatFrequencyData(this.freq);
    let total = 0;
    for (let b = 0; b < this.display.length; b++) {
      const w = this.display[b];
      let p = 0, ws = 0;
      for (let k = 0; k < w.length; k++) if (w[k] > 0) { p += w[k] * 10 ** (this.freq[k] / 10); ws += w[k]; }
      const db = 10 * Math.log10(p / Math.max(ws, 1e-6) + 1e-12);
      const v = Math.min(1, Math.max(0, (db + 92) / 58));
      this.levels[b] = v > this.levels[b] ? v : this.levels[b] * 0.9 + v * 0.1;
      total += this.levels[b];
    }
    this.onLevel?.(total / this.display.length);
    return this.levels;
  }

  push(chunk) {
    // accumulate, cut into hop-sized frames for endpointing, keep a rolling buffer
    const merged = new Float32Array(this.pending.length + chunk.length);
    merged.set(this.pending); merged.set(chunk, this.pending.length);
    let off = 0;
    while (merged.length - off >= this.hop) {
      const frame = merged.subarray(off, off + this.hop);
      let e = 0; for (let i = 0; i < frame.length; i++) e += frame[i] * frame[i];
      const db = 10 * Math.log10(e / frame.length + 1e-12);
      this.samples.push(Float32Array.from(frame));
      this.endpoint(db);
      off += this.hop;
    }
    this.pending = merged.slice(off);
    const maxFrames = Math.round(6 / this.spectra.templateSpec.hop);
    if (this.samples.length > maxFrames && !this.inUtt) this.samples.splice(0, this.samples.length - maxFrames);
  }

  endpoint(db) {
    // noise floor follows the quietest frames; speech = 12 dB above it
    this.floor = this.floor === null ? db : (db < this.floor ? db : this.floor + 0.02);
    const speech = db > this.floor + 12 && db > -62;
    const idx = this.samples.length - 1;
    if (!this.inUtt) {
      this.speechRun = speech ? this.speechRun + 1 : 0;
      if (this.speechRun >= 3) { this.inUtt = true; this.uttStart = Math.max(0, idx - 8); this.silenceRun = 0; this.onState?.('hearing'); }
    } else {
      this.silenceRun = speech ? 0 : this.silenceRun + 1;
      const len = idx - this.uttStart;
      if (this.silenceRun >= 28 || len > 220) {
        const frames = this.samples.slice(this.uttStart, idx + 1);
        this.inUtt = false; this.speechRun = 0;
        this.samples = [];
        if (len >= 18) this.recognise(frames); else this.onState?.('listening');
      }
    }
  }

  features(frames) {
    // re-frame the hop-sized pieces into overlapping analysis windows (same constants as tools/make_spectra.py)
    const total = frames.length * this.hop, x = new Float32Array(total);
    frames.forEach((f, i) => x.set(f, i * this.hop));
    for (let i = total - 1; i > 0; i--) x[i] -= this.spectra.templateSpec.preemph * x[i - 1];
    const count = Math.max(1, 1 + Math.floor((total - this.win) / this.hop));
    const re = new Float32Array(this.nfft), im = new Float32Array(this.nfft);
    const rows = [], energy = [];
    for (let f = 0; f < count; f++) {
      re.fill(0); im.fill(0);
      for (let i = 0; i < this.win; i++) re[i] = x[f * this.hop + i] * this.window[i];
      fft(re, im);
      const half = this.nfft / 2 + 1, pw = new Float32Array(half);
      let sum = 0;
      for (let k = 0; k < half; k++) { pw[k] = re[k] * re[k] + im[k] * im[k]; sum += pw[k]; }
      energy.push(10 * Math.log10(sum + 1e-12));
      rows.push(this.bank.map(w => { let s = 0; for (let k = 0; k < half; k++) s += w[k] * pw[k]; return Math.log(s + 1e-8); }));
    }
    const top = Math.max(...energy), keep = energy.map(e => e > top - this.spectra.templateSpec.trimDb);
    const first = keep.indexOf(true), last = keep.lastIndexOf(true);
    const feats = rows.slice(first, last + 1).map(r => Float32Array.from(r));
    const mean = new Float32Array(feats[0].length);
    feats.forEach(r => r.forEach((v, k) => { mean[k] += v / feats.length; }));
    feats.forEach(r => r.forEach((v, k) => { r[k] = v - mean[k]; }));
    return feats;
  }

  recognise(frames) {
    this.onState?.('thinking');
    setTimeout(() => {
      const feats = this.features(frames);
      if (feats.length < 12) { this.onState?.('listening'); return; }
      const best = new Map();
      for (const t of this.templates) {
        const d = dtw(feats, t.frames);
        if (!best.has(t.sig) || d < best.get(t.sig)) best.set(t.sig, d);
      }
      const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
      const margin = (ranked[1][1] - ranked[0][1]) / ranked[1][1];
      this.onUtterance?.({ ranked, margin, seconds: frames.length * this.spectra.templateSpec.hop });
      this.onState?.('listening');
    }, 30);
  }
}
