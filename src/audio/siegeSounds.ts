import { add, filter, make, noise, ping, seconds, thump, zap } from './synth';

// Drone Siege's progression sounds: the rare guns, barriers, power, suit mods, the
// Supply Drop, Overclock and power-ups. Made from the same building blocks as the rest.

/** A soft tone with a quick attack and an exponential fade, added into `out`. */
function tone(out: Float32Array, rate: number, start: number, freq: number, length: number, gain: number, decay: number, shape: 'sine' | 'tri' = 'sine') {
  const begin = seconds(start, rate);
  for (let i = 0; i < seconds(length, rate) && begin + i < out.length; i++) {
    const t = i / rate;
    const w = 2 * Math.PI * freq * t;
    const v = shape === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(w)) : Math.sin(w);
    out[begin + i] += v * gain * Math.min(1, t / 0.004) * Math.exp(-t / decay);
  }
}

/** Notes played one after another (a jingle). */
function jingle(out: Float32Array, rate: number, notes: number[], step: number, length = 0.5, decay = 0.18) {
  notes.forEach((freq, k) => {
    tone(out, rate, k * step, freq, length, 0.32, decay, 'tri');
    tone(out, rate, k * step, freq * 2, length, 0.08, decay * 0.6);
  });
}

// ---- The rare guns ----

/** Singularity Launcher: a deep cough and a rising whine as the round leaves. */
export function singularityShot(c: BaseAudioContext) {
  return make(c, 1.0, 5000, (out, rate, random) => {
    thump(out, rate, 0, 120, 38, 0.18, 1.3);
    add(out, rate, filter(noise(seconds(0.4, rate), random), rate, 'lowpass', 600), 0, 0.9, 0.08);
    let phase = 0;
    for (let i = 0; i < seconds(0.8, rate); i++) {
      const t = i / rate;
      phase += (200 + 900 * Math.min(1, t / 0.6)) / rate;
      out[i] += Math.sin(2 * Math.PI * phase) * 0.25 * Math.min(1, t / 0.05) * Math.exp(-t / 0.35);
    }
  });
}

/** The black hole working: a low, wobbling rumble with a grinding edge. */
export function singularityHum(c: BaseAudioContext) {
  return make(c, 3.2, 5100, (out, rate, random) => {
    const grit = filter(noise(out.length, random), rate, 'lowpass', 300);
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const wobble = 1 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t);
      phase += (45 * wobble + 20 * t) / rate;
      const level = Math.min(1, t / 0.15) * Math.min(1, (3.2 - t) / 0.2);
      out[i] = (Math.sin(2 * Math.PI * phase) * 0.7 + grit[i] * 1.6) * level;
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.8);
  }, 0.8);
}

/** The black hole collapsing: a sucking sweep up, then a hard thud. */
export function singularityCollapse(c: BaseAudioContext) {
  return make(c, 1.4, 5200, (out, rate, random) => {
    const sweep = filter(noise(seconds(0.35, rate), random), rate, 'bandpass', 900, 1.2);
    for (let i = 0; i < sweep.length; i++) out[i] += sweep[i] * (i / sweep.length) * 1.2;
    thump(out, rate, 0.35, 140, 30, 0.3, 1.6);
    add(out, rate, filter(noise(seconds(0.8, rate), random), rate, 'lowpass', 500), 0.35, 1.2, 0.2);
  });
}

/** Arc Caster: a sharp electric crack with a buzzing tail. */
export function arcShot(c: BaseAudioContext, seed: number) {
  return make(c, 0.45, 5300 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.08, rate), random), rate, 'highpass', 3000), 0, 1.1, 0.012);
    add(out, rate, filter(zap(rate, 0.3, 2400 + random() * 500, 300, 0.05), rate, 'bandpass', 1800, 0.8), 0, 0.9, 0.08);
    for (let i = 0; i < 10; i++) add(out, rate, filter(noise(seconds(0.006, rate), random), rate, 'highpass', 5000), random() * 0.25, 0.6, 0.003);
    thump(out, rate, 0, 200, 70, 0.03, 0.5);
  }, 0.75);
}

// ---- The city ----

/** An energy barrier switching off: a falling hum, a crackle, and a latch. */
export function barrierDown(c: BaseAudioContext) {
  return make(c, 2.2, 5400, (out, rate, random) => {
    let phase = 0;
    for (let i = 0; i < seconds(1.6, rate); i++) {
      const t = i / rate;
      phase += (220 * Math.exp(-t / 0.6) + 40) / rate;
      out[i] += ((phase % 1) * 2 - 1) * 0.35 * Math.min(1, t / 0.02) * Math.exp(-t / 0.7);
    }
    for (let i = 0; i < 14; i++) add(out, rate, filter(noise(seconds(0.01, rate), random), rate, 'highpass', 3500), random() * 0.8, 0.5, 0.004);
    thump(out, rate, 1.2, 110, 50, 0.08, 0.9);
    ping(out, rate, 1.2, [700, 1150], 0.05, 0.3);
  }, 0.8);
}

/** A shot splashing on a barrier: a short fizz. */
export function barrierHit(c: BaseAudioContext) {
  return make(c, 0.3, 5450, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.2, rate), random), rate, 'bandpass', 2400, 1.5), 0, 0.8, 0.05);
    tone(out, rate, 0, 620, 0.25, 0.4, 0.08);
  }, 0.45);
}

/** The power coming back on: a heavy breaker, a generator spinning up, and the lights buzzing to life. */
export function powerOn(c: BaseAudioContext) {
  return make(c, 4, 5500, (out, rate, random) => {
    thump(out, rate, 0, 90, 40, 0.15, 1.4);
    ping(out, rate, 0, [500, 820, 1300], 0.06, 0.5);
    let a = 0;
    let b = 0;
    for (let i = seconds(0.2, rate); i < out.length; i++) {
      const t = i / rate - 0.2;
      const f = 30 + 70 * Math.min(1, t / 2.5);
      a += f / rate;
      b += (f * 2.01) / rate;
      const level = Math.min(1, t / 1.5) * Math.min(1, (3.8 - t) / 0.8);
      out[i] += (Math.sin(2 * Math.PI * a) * 0.5 + ((b % 1) * 2 - 1) * 0.15) * level;
    }
    for (let i = 0; i < 8; i++) add(out, rate, filter(noise(seconds(0.04, rate), random), rate, 'bandpass', 3000, 2), 1.2 + i * 0.22 + random() * 0.1, 0.35, 0.02);
  }, 0.85);
}

/** A suit mod installing: servos whirring, a clamp, and a rising chime. */
export function modInstall(c: BaseAudioContext) {
  return make(c, 1.6, 5600, (out, rate) => {
    let phase = 0;
    for (let i = 0; i < seconds(0.6, rate); i++) {
      const t = i / rate;
      phase += (300 + 500 * t) / rate;
      out[i] += ((phase % 1) * 2 - 1) * 0.15 * Math.min(1, t / 0.05) * Math.min(1, (0.6 - t) / 0.05);
    }
    thump(out, rate, 0.6, 160, 70, 0.05, 0.9);
    jingle(out.subarray(seconds(0.7, rate)), rate, [659, 880, 1175], 0.1);
  }, 0.7);
}

// ---- The Supply Drop ----

/** The pod's lid unlocking and lifting. */
export function supplyOpen(c: BaseAudioContext) {
  return make(c, 1.2, 5700, (out, rate, random) => {
    thump(out, rate, 0, 130, 60, 0.06, 0.9);
    ping(out, rate, 0, [900, 1400], 0.03, 0.4);
    add(out, rate, filter(noise(seconds(0.9, rate), random), rate, 'bandpass', 1200, 0.8), 0.1, 0.5, 0.25, 0.2);
  }, 0.7);
}

/** The weapons flicking past: ticks that slow down over four seconds. */
export function supplySpin(c: BaseAudioContext) {
  return make(c, 4.2, 5800, (out, rate) => {
    let t = 0;
    let gap = 0.06;
    let k = 0;
    while (t < 3.9) {
      tone(out, rate, t, k % 2 ? 1250 : 1050, 0.08, 0.5, 0.02, 'tri');
      t += gap;
      gap *= 1.07;
      k++;
    }
  }, 0.5);
}

/** The pick revealed: a bright chord. */
export function supplyReveal(c: BaseAudioContext) {
  return make(c, 1.4, 5900, (out, rate) => {
    for (const f of [523, 659, 784]) tone(out, rate, 0, f, 1.2, 0.3, 0.45, 'tri');
    tone(out, rate, 0, 1568, 0.8, 0.1, 0.2);
  }, 0.6);
}

/** The pod lifting off on its thrusters to go somewhere else. */
export function supplyMove(c: BaseAudioContext) {
  return make(c, 3, 6000, (out, rate, random) => {
    const roar = filter(filter(noise(out.length, random), rate, 'lowpass', 900), rate, 'lowpass', 700);
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] += roar[i] * 1.4 * Math.min(1, t / 0.4) * Math.min(1, (3 - t) / 1.5);
    }
    jingle(out, rate, [784, 659, 523, 392], 0.14, 0.4, 0.15);
  }, 0.75);
}

// ---- Overclock ----

/** The Overclock machine at work: a rising charge with heavy clunks. */
export function overclockWork(c: BaseAudioContext) {
  return make(c, 3.2, 6100, (out, rate, random) => {
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      phase += (80 + 600 * (t / 3.2) ** 2) / rate;
      const level = Math.min(1, t / 0.3) * (0.4 + 0.6 * (t / 3.2));
      out[i] += (((phase % 1) * 2 - 1) * 0.25 + Math.sin(2 * Math.PI * phase * 2) * 0.2) * level;
    }
    for (const at of [0.2, 1.1, 2.0]) {
      thump(out, rate, at, 120, 50, 0.08, 1);
      ping(out, rate, at, [600, 950], 0.04, 0.35);
    }
    for (let i = 0; i < 20; i++) add(out, rate, filter(noise(seconds(0.008, rate), random), rate, 'highpass', 4000), 2.2 + random() * 0.9, 0.5, 0.004);
  }, 0.8);
}

/** Overclock done: a big electric bloom and a triumphant chord. */
export function overclockDone(c: BaseAudioContext) {
  return make(c, 2, 6200, (out, rate, random) => {
    add(out, rate, filter(zap(rate, 0.6, 3000, 200, 0.15), rate, 'lowpass', 3000), 0, 0.6, 0.2);
    thump(out, rate, 0, 160, 40, 0.15, 1);
    for (const f of [392, 523, 659, 784]) tone(out, rate, 0.1, f, 1.6, 0.25, 0.6, 'tri');
    add(out, rate, filter(noise(seconds(0.5, rate), random), rate, 'highpass', 3000), 0, 0.3, 0.1);
  }, 0.75);
}

// ---- Power-ups ----

/** A power-up appearing: a shimmering sparkle. */
export function powerUpSpawn(c: BaseAudioContext) {
  return make(c, 1.0, 6300, (out, rate, random) => {
    for (let i = 0; i < 9; i++) tone(out, rate, i * 0.06, 1400 + random() * 1600, 0.3, 0.2, 0.08);
  }, 0.5);
}

/** A power-up fading away unpicked: a sinking blip. */
export function powerUpGone(c: BaseAudioContext) {
  return make(c, 0.6, 6350, (out, rate) => {
    let phase = 0;
    for (let i = 0; i < seconds(0.5, rate); i++) {
      const t = i / rate;
      phase += (900 * Math.exp(-t / 0.2) + 200) / rate;
      out[i] += Math.sin(2 * Math.PI * phase) * 0.4 * Math.exp(-t / 0.2);
    }
  }, 0.4);
}

export function doublePoints(c: BaseAudioContext) {
  return make(c, 1.2, 6400, (out, rate) => jingle(out, rate, [523, 784, 523, 784, 1047], 0.08), 0.6);
}

export function oneShot(c: BaseAudioContext) {
  return make(c, 1.3, 6500, (out, rate, random) => {
    jingle(out, rate, [392, 392, 784], 0.12, 0.6, 0.25);
    add(out, rate, filter(noise(seconds(0.3, rate), random), rate, 'highpass', 2500), 0.24, 0.3, 0.1);
  }, 0.6);
}

/** EMP Blast: a deep whump and a crackling wave rolling outward. */
export function emp(c: BaseAudioContext) {
  return make(c, 2.6, 6600, (out, rate, random) => {
    thump(out, rate, 0, 100, 25, 0.5, 1.6);
    const wave = filter(noise(seconds(2, rate), random), rate, 'bandpass', 700, 0.6);
    add(out, rate, wave, 0.05, 1.2, 0.6, 0.15);
    for (let i = 0; i < 40; i++) add(out, rate, filter(noise(seconds(0.006, rate), random), rate, 'highpass', 4500), 0.1 + random() * 1.8, 0.4, 0.003);
  }, 0.9);
}

/** O2 Surge: air rushing in and a clean high chime. */
export function o2Surge(c: BaseAudioContext) {
  return make(c, 1.6, 6700, (out, rate, random) => {
    const rush = filter(noise(seconds(1.2, rate), random), rate, 'highpass', 1500);
    for (let i = 0; i < rush.length; i++) {
      const t = i / rate;
      out[i] += rush[i] * 0.6 * Math.min(1, t / 0.4) * Math.exp(-t / 0.5);
    }
    jingle(out, rate, [880, 1175, 1568], 0.09);
  }, 0.6);
}

/** Auto-Medic bringing you back: a defibrillator thump and a hopeful two-note rise. */
export function revive(c: BaseAudioContext) {
  return make(c, 1.8, 6800, (out, rate, random) => {
    thump(out, rate, 0, 180, 45, 0.12, 1.4);
    add(out, rate, filter(noise(seconds(0.15, rate), random), rate, 'bandpass', 1500, 1), 0, 0.6, 0.04);
    tone(out, rate, 0.5, 587, 1, 0.3, 0.35, 'tri');
    tone(out, rate, 0.75, 880, 1, 0.3, 0.45, 'tri');
  }, 0.75);
}
