import { jingle, tone } from './siegeSounds';
import { add, filter, make, noise, ping, seconds, thump } from './synth';

// Salvage Run's sounds: working a cache open, its latch giving, banking a haul, the
// storm's sirens and arrival, a vault's alarm, the threat rising, and the Geiger
// counter's clicks. Built from the same pieces as the rest.

/** Working a cache open: a short ratchet click from the tool in your hand. */
export function cacheWork(c: BaseAudioContext) {
  return make(c, 0.12, 7100, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.03, rate), random), rate, 'bandpass', 2600, 3), 0, 0.9, 0.008);
    thump(out, rate, 0.004, 900, 420, 0.012, 0.35);
  }, 0.5);
}

/** A crate or pod giving way: the latch, a puff of trapped air, and a bright chime. */
export function cacheOpen(c: BaseAudioContext) {
  return make(c, 1.3, 7200, (out, rate, random) => {
    thump(out, rate, 0, 260, 90, 0.05, 1.1);
    add(out, rate, filter(noise(seconds(0.06, rate), random), rate, 'bandpass', 1800, 2), 0, 0.8, 0.015);
    const puff = filter(noise(seconds(0.5, rate), random), rate, 'highpass', 1200);
    add(out, rate, puff, 0.04, 0.5, 0.14, 0.02);
    jingle(out, rate, [784, 1047, 1319], 0.07, 0.6, 0.22);
  }, 0.7);
}

/** A vault's doors parting: a heavy unlocking clank, a grinding slide, and a deeper chime. */
export function vaultOpen(c: BaseAudioContext) {
  return make(c, 2.0, 7300, (out, rate, random) => {
    thump(out, rate, 0, 180, 50, 0.09, 1.5);
    ping(out, rate, 0, [620, 1130, 1700], 0.05, 0.4);
    const grind = filter(noise(seconds(0.9, rate), random), rate, 'bandpass', 420, 1.4);
    for (let i = 0; i < grind.length; i++) {
      const t = i / rate;
      const wobble = 0.6 + 0.4 * Math.sin(2 * Math.PI * 23 * t);
      out[seconds(0.12, rate) + i] += grind[i] * wobble * Math.min(1, t / 0.1) * Math.min(1, (0.9 - t) / 0.2) * 1.2;
    }
    thump(out, rate, 1.0, 120, 45, 0.08, 1.2);
    jingle(out, rate, [523, 659, 784, 1047], 0.08, 0.8, 0.3);
  }, 0.8);
}

/** Banking a haul: a rising run of notes with a soft shimmer, the best sound in the mode. */
export function banked(c: BaseAudioContext) {
  return make(c, 2.0, 7400, (out, rate, random) => {
    jingle(out, rate, [523, 659, 784, 1047, 1319], 0.075, 0.9, 0.35);
    tone(out, rate, 0.38, 1568, 1.4, 0.12, 0.5);
    tone(out, rate, 0.38, 2093, 1.4, 0.06, 0.4);
    const shimmer = filter(noise(seconds(1.2, rate), random), rate, 'highpass', 6000);
    for (let i = 0; i < shimmer.length; i++) {
      const t = i / rate;
      out[seconds(0.3, rate) + i] += shimmer[i] * 0.12 * Math.min(1, t / 0.2) * Math.exp(-t / 0.4);
    }
    thump(out, rate, 0, 140, 60, 0.06, 0.6);
  }, 0.7);
}

/** A storm warning: a slow siren rising and falling twice, from the suit's alert system. */
export function stormSiren(c: BaseAudioContext) {
  return make(c, 2.8, 7500, (out, rate) => {
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const sweep = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / 1.3));
      const f = 420 + 380 * sweep;
      phase += f / rate;
      const level = Math.min(1, t / 0.08) * Math.min(1, (2.8 - t) / 0.3);
      const v = Math.sin(2 * Math.PI * phase) * 0.7 + Math.sin(2 * Math.PI * phase * 2) * 0.18;
      out[i] = Math.tanh(v * 1.6) * level * 0.7;
    }
  }, 0.6);
}

/** The storm arriving: a deep roll and a burst of crackling static through the suit's radio. */
export function stormHit(c: BaseAudioContext) {
  return make(c, 3.6, 7600, (out, rate, random) => {
    thump(out, rate, 0, 70, 28, 0.6, 1.6);
    const roar = filter(noise(out.length, random), rate, 'lowpass', 260);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] += roar[i] * 1.6 * Math.min(1, t / 0.3) * Math.exp(-t / 1.4);
    }
    for (let k = 0; k < 90; k++) {
      const at = random() * 3;
      add(out, rate, filter(noise(seconds(0.01 + random() * 0.03, rate), random), rate, 'bandpass', 2000 + random() * 3000, 1.5), at, 0.5 * Math.exp(-at / 1.5), 0.01);
    }
  }, 0.85);
}

/** A vault's alarm: a hard, pulsing two-tone whoop. */
export function cacheAlarm(c: BaseAudioContext) {
  return make(c, 1.8, 7700, (out, rate) => {
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const pulse = Math.floor(t / 0.3);
      const into = (t % 0.3) / 0.3;
      const f = pulse % 2 === 0 ? 600 + 500 * into : 1100 - 500 * into;
      phase += f / rate;
      const square = Math.sin(2 * Math.PI * phase) > 0 ? 1 : -1;
      const gate = Math.min(1, into / 0.05) * Math.min(1, (1 - into) / 0.08);
      out[i] = square * 0.35 * gate * Math.min(1, (1.8 - t) / 0.2);
    }
  }, 0.5);
}

/** The threat going up: two falling notes, low and uneasy. */
export function threatUp(c: BaseAudioContext) {
  return make(c, 1.1, 7800, (out, rate) => {
    tone(out, rate, 0, 392, 0.6, 0.35, 0.22, 'tri');
    tone(out, rate, 0.18, 277, 0.8, 0.4, 0.3, 'tri');
    tone(out, rate, 0.18, 138.5, 0.8, 0.2, 0.3);
  }, 0.55);
}

/** One Geiger counter click. */
export function geigerClick(c: BaseAudioContext, seed: number) {
  return make(c, 0.03, 7900 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.004, rate), random), rate, 'highpass', 2500), 0, 1, 0.0015);
    thump(out, rate, 0, 3200, 1800, 0.002, 0.3);
  }, 0.5);
}
