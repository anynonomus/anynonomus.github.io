// All sounds are synthesized with Web Audio. No files, no network.
let ctx, out, noise, ambient, muted = false;

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  // iOS: play through the silent switch like a media app would
  if (navigator.audioSession) navigator.audioSession.type = 'playback';
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  out = ctx.createGain();
  out.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  document.addEventListener('visibilitychange', () => document.hidden ? ctx.suspend() : ctx.resume());
}

export function setMuted(m) {
  muted = m;
  if (out) out.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

const now = () => ctx.currentTime;

function env(g, t, a, peak, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
}

function noiseSrc(t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noise; s.loop = true;
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  return s;
}

function tone(type, f0, f1, t, a, peak, decay, dest = out) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + decay);
  env(g, t, a, peak, decay);
  o.connect(g).connect(dest);
  o.start(t); o.stop(t + a + decay + 0.05);
}

export function bounce(strength = 1) {
  if (!ctx) return;
  const t = now(), s = Math.min(1, strength);
  tone('sine', 150, 52, t, 0.004, 0.9 * s, 0.2);
  tone('sine', 240, 180, t, 0.002, 0.25 * s, 0.07);
  const n = noiseSrc(t, 0.05), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 1100;
  env(g, t, 0.002, 0.35 * s, 0.035);
  n.connect(f).connect(g).connect(out);
}

export function swish() {
  if (!ctx) return;
  const t = now();
  const n = noiseSrc(t, 0.6), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 0.9;
  f.frequency.setValueAtTime(4200, t);
  f.frequency.exponentialRampToValueAtTime(1300, t + 0.4);
  env(g, t, 0.05, 0.55, 0.42);
  n.connect(f).connect(g).connect(out);
}

export function rim(strength = 1) {
  if (!ctx) return;
  const t = now(), s = Math.min(1, strength);
  [[587, 0.5], [1361, 0.32], [2207, 0.2], [3119, 0.12]].forEach(([f, d], i) =>
    tone('sine', f, f * 0.995, t, 0.002, (0.32 / (i + 1)) * s, d));
  tone('triangle', 260, 200, t, 0.002, 0.25 * s, 0.12);
}

export function board(strength = 1) {
  if (!ctx) return;
  const t = now(), s = Math.min(1, strength);
  tone('sine', 110, 70, t, 0.003, 0.6 * s, 0.16);
  const n = noiseSrc(t, 0.1), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 700;
  env(g, t, 0.002, 0.4 * s, 0.08);
  n.connect(f).connect(g).connect(out);
}

export function cheer(dur = 2.6, level = 1) {
  if (!ctx) return;
  const t = now();
  [[700, 0.6], [1400, 0.8], [2600, 1.2]].forEach(([fc, q]) => {
    const n = noiseSrc(t, dur + 1.6), f = ctx.createBiquadFilter(), g = ctx.createGain();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * level, t + 0.45);
    g.gain.setValueAtTime(0.16 * level, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.5);
    lfo.frequency.value = 3 + Math.random() * 4; lg.gain.value = 0.05 * level;
    lfo.connect(lg).connect(g.gain);
    lfo.start(t); lfo.stop(t + dur + 1.6);
    n.connect(f).connect(g).connect(out);
  });
  for (let i = 0; i < 5; i++) {
    const st = t + 0.2 + Math.random() * dur * 0.7, f0 = 800 + Math.random() * 500;
    tone('sine', f0, f0 * 1.6, st, 0.08, 0.035 * level, 0.45);
  }
}

export function buzzer() {
  if (!ctx) return;
  const t = now(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 1600;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
  g.gain.setValueAtTime(0.22, t + 1.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
  [[118, 'square'], [236, 'sawtooth'], [177, 'square']].forEach(([fr, ty]) => {
    const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr;
    o.connect(f); o.start(t); o.stop(t + 1.3);
  });
  f.connect(g).connect(out);
}

export function whoosh() {
  if (!ctx) return;
  const t = now(), n = noiseSrc(t, 0.5), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.Q.value = 1.4;
  f.frequency.setValueAtTime(400, t);
  f.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
  env(g, t, 0.12, 0.18, 0.3);
  n.connect(f).connect(g).connect(out);
}

export function tap() {
  if (!ctx) return;
  tone('sine', 900, 520, now(), 0.003, 0.12, 0.08);
}

export function chime() {
  if (!ctx) return;
  const t = now();
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone('triangle', f, f, t + i * 0.09, 0.01, 0.16, 0.7);
    tone('sine', f * 2, f * 2, t + i * 0.09, 0.01, 0.04, 0.5);
  });
}

export function wrong() {
  if (!ctx) return;
  const t = now();
  tone('triangle', 330, 300, t, 0.01, 0.14, 0.14);
  tone('triangle', 262, 240, t + 0.12, 0.01, 0.14, 0.2);
}

export function startAmbient() {
  if (!ctx || ambient) return;
  const t = now(), n = noiseSrc(t, 1e5), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 2);
  n.connect(f).connect(g).connect(out);
  ambient = g;
}
