// Our own metronome and count-in clicks (Web Audio), and WAV encoding for audio export.
// alphaTab's built-in metronome has one sound, no accent and a fixed one-bar count-in, and is silent
// with YouTube audio; these fill those gaps. Pure helpers are exported for the unit tests.

export const CLICK_SOUNDS = { woodblock: 'Woodblock', click: 'Click', beep: 'Beep', cowbell: 'Cowbell' };
const TICKS_PER_QUARTER = 960;

/**
 * Beats in playback order from alphaTab's tick lookup ({ start, masterBar } per played bar).
 * One beat per time-signature denominator; the first beat of each bar is accented.
 */
export function beatsFromBars(bars) {
  const beats = [];
  for (const { start, end, masterBar } of bars) {
    const step = (TICKS_PER_QUARTER * 4) / (masterBar.timeSignatureDenominator || 4);
    const stop = end ?? start + step * (masterBar.timeSignatureNumerator || 4);
    for (let tick = start, i = 0; tick < stop - 1; tick += step, i++) beats.push({ tick, accent: i === 0 });
  }
  return beats;
}

/** Index of the first beat at or after `tick` (binary search). */
export function firstBeatFrom(beats, tick) {
  let lo = 0, hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid].tick < tick) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Seconds per beat for a bar at a tempo (quarter-note BPM, already including playback speed). */
export function beatSeconds(tempo, denominator = 4) {
  return (60 / Math.max(1, tempo)) * (4 / (denominator || 4));
}

/** Count-in clicks before playback: `bars` bars of the bar's time signature. Offsets in seconds. */
export function countInPlan({ bars = 1, numerator = 4, denominator = 4, tempo = 120 }) {
  const each = beatSeconds(tempo, denominator);
  const clicks = [];
  for (let i = 0; i < bars * numerator; i++) clicks.push({ at: i * each, accent: i % numerator === 0 });
  return { clicks, duration: bars * numerator * each };
}

/** Synthesised click sounds. */
export class Clicker {
  constructor() { this.ctx = null; this.pending = new Set(); }
  get context() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  get now() { return this.context.currentTime; }

  /** Plays one click at AudioContext time `when`. */
  play(when, { sound = 'woodblock', accent = false, volume = 0.8 } = {}) {
    const ctx = this.context;
    const out = ctx.createGain();
    out.connect(ctx.destination);
    this.pending.add(out);
    setTimeout(() => this.pending.delete(out), Math.max(0, when - ctx.currentTime + 0.5) * 1000);
    const level = Math.max(0, volume) * (accent ? 1 : 0.6);
    const env = (g, attack, decay) => {
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    };
    const tone = (type, freq, attack, decay, dest = out) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, when);
      env(g, attack, decay);
      o.connect(g).connect(dest);
      o.start(when);
      o.stop(when + attack + decay + 0.02);
    };
    if (sound === 'beep') {
      tone('square', accent ? 1320 : 880, 0.002, 0.06);
      out.gain.value = 0.25;
    } else if (sound === 'cowbell') {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = accent ? 900 : 760;
      band.Q.value = 3;
      band.connect(out);
      tone('square', accent ? 587 : 540, 0.002, 0.16, band);
      tone('square', accent ? 870 : 800, 0.002, 0.16, band);
      out.gain.value = 1.4;
    } else if (sound === 'click') {
      const len = Math.ceil(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 4;
      const src = ctx.createBufferSource(), high = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf;
      high.type = 'highpass';
      high.frequency.value = accent ? 2500 : 1800;
      g.gain.value = level * 1.6;
      src.connect(high).connect(g).connect(out);
      src.start(when);
    } else { // woodblock
      tone('sine', accent ? 1700 : 1250, 0.001, 0.05);
      tone('triangle', accent ? 2600 : 1900, 0.001, 0.025);
    }
  }

  /** Cuts off clicks that are scheduled but not played yet (a cancelled count-in). */
  silence() {
    for (const out of this.pending) out.disconnect();
    this.pending.clear();
  }
}

/** 16-bit PCM WAV from interleaved float samples. */
export function encodeWav(samples, { sampleRate = 44100, channels = 2 } = {}) {
  const bytes = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(view.buffer);
}
