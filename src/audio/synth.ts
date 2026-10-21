import { seededRandom } from '../world/noise';

// Sound effects made from scratch: filtered noise, falling tones and short metallic
// "pings", mixed into audio buffers once at startup. No sound files needed.

type Fill = (out: Float32Array, rate: number, random: () => number) => void;

function make(context: BaseAudioContext, seconds: number, seed: number, fill: Fill, peak = 0.9) {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(seconds * rate), rate);
  const data = buffer.getChannelData(0);
  fill(data, rate, seededRandom(seed));
  // Fade the last few milliseconds so nothing clicks when it ends, then set the loudness.
  const fade = Math.min(data.length, Math.floor(rate * 0.005));
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / max;
  return buffer;
}

// ---- Building blocks ----

function noise(length: number, random: () => number) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = random() * 2 - 1;
  return out;
}

/** A standard two-pole filter (the same kind as Web Audio's BiquadFilter). */
function filter(data: Float32Array, rate: number, type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q = 0.707) {
  const w = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else if (type === 'highpass') [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  else [b0, b1, b2] = [alpha, 0, -alpha];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    data[i] = y;
  }
  return data;
}

/** Add `source` into `out` from `startSeconds`, shaped by a quick attack and exponential decay. */
function add(out: Float32Array, rate: number, source: Float32Array, startSeconds: number, gain: number, decay: number, attack = 0.001) {
  const start = Math.floor(startSeconds * rate);
  for (let i = 0; i < source.length && start + i < out.length; i++) {
    const t = i / rate;
    const env = Math.min(1, t / attack) * Math.exp(-t / decay);
    out[start + i] += source[i] * env * gain;
  }
}

/** A struck-metal ring: a few tones that die away. */
function ping(out: Float32Array, rate: number, startSeconds: number, freqs: number[], decay: number, gain: number) {
  const start = Math.floor(startSeconds * rate);
  const length = Math.floor(decay * 6 * rate);
  for (let i = 0; i < length && start + i < out.length; i++) {
    const t = i / rate;
    let v = 0;
    freqs.forEach((f, k) => (v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (decay / (1 + k * 0.5)))));
    out[start + i] += (v / freqs.length) * gain * Math.min(1, t / 0.0005);
  }
}

/** A low thump: a tone that drops in pitch as it fades (a kick-drum shape). */
function thump(out: Float32Array, rate: number, startSeconds: number, from: number, to: number, decay: number, gain: number) {
  const start = Math.floor(startSeconds * rate);
  let phase = 0;
  for (let i = 0; start + i < out.length && i < decay * 8 * rate; i++) {
    const t = i / rate;
    const f = to + (from - to) * Math.exp(-t / (decay * 0.3));
    phase += (2 * Math.PI * f) / rate;
    out[start + i] += Math.sin(phase) * Math.exp(-t / decay) * gain * Math.min(1, t / 0.002);
  }
}

const seconds = (s: number, rate: number) => Math.floor(s * rate);

// ---- The sounds ----

/** Rifle shot: a sharp crack, the blast's body, a deep thump, then the bolt cycling. */
export function gunshot(c: BaseAudioContext, seed: number) {
  return make(c, 0.7, seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.1, rate), random), rate, 'highpass', 1800), 0, 1.0, 0.005);
    add(out, rate, filter(filter(noise(seconds(0.5, rate), random), rate, 'lowpass', 1100), rate, 'lowpass', 900), 0, 1.3, 0.05);
    thump(out, rate, 0, 140, 42, 0.09, 1.1);
    const bolt = 0.032 + random() * 0.008;
    add(out, rate, filter(noise(seconds(0.02, rate), random), rate, 'bandpass', 3500, 2), bolt, 0.25, 0.003);
    ping(out, rate, bolt, [2100 + random() * 200, 3400, 5300], 0.012, 0.18);
    ping(out, rate, bolt + 0.045, [1800, 3000], 0.01, 0.12); // bolt slamming home
  });
}

/** Reload mechanics. */
export function magazineRelease(c: BaseAudioContext) {
  return make(c, 0.25, 11, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.02, rate), random), rate, 'highpass', 2500), 0, 0.5, 0.002);
    ping(out, rate, 0, [1700, 3100], 0.018, 0.6);
    add(out, rate, filter(noise(seconds(0.1, rate), random), rate, 'lowpass', 900), 0.03, 0.4, 0.03); // magazine sliding out
  }, 0.6);
}

export function magazineInsert(c: BaseAudioContext) {
  return make(c, 0.35, 12, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.06, rate), random), rate, 'bandpass', 1200, 1.2), 0, 0.9, 0.015);
    thump(out, rate, 0, 220, 110, 0.03, 0.6);
    ping(out, rate, 0.004, [2500, 4200], 0.025, 0.5);
    add(out, rate, filter(noise(seconds(0.02, rate), random), rate, 'highpass', 3000), 0.07, 0.6, 0.003); // catch clicks in
    ping(out, rate, 0.07, [3000, 4900], 0.012, 0.35);
  }, 0.75);
}

export function boltRelease(c: BaseAudioContext) {
  return make(c, 0.5, 13, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.03, rate), random), rate, 'highpass', 1500), 0, 1, 0.004);
    thump(out, rate, 0, 180, 80, 0.04, 0.7);
    ping(out, rate, 0, [1500, 2900, 4700], 0.07, 0.45); // buffer spring ringing
  }, 0.85);
}

/** A spent casing landing: a few bright tinks as it bounces. */
export function casing(c: BaseAudioContext, seed: number) {
  return make(c, 0.5, 100 + seed, (out, rate, random) => {
    const base = 3200 + random() * 1800;
    let t = 0;
    let level = 1;
    for (let i = 0; i < 4; i++) {
      ping(out, rate, t, [base, base * 1.48, base * 2.1], 0.03 + random() * 0.03, level);
      t += 0.09 * Math.pow(0.6, i);
      level *= 0.45;
    }
  }, 0.45);
}

/** A footstep. On the dusty surface: a soft crunch. On hard floors: a heel click too. */
export function footstep(c: BaseAudioContext, seed: number, hard: boolean, landing = false) {
  return make(c, landing ? 0.45 : 0.25, 200 + seed + (hard ? 50 : 0) + (landing ? 99 : 0), (out, rate, random) => {
    const length = seconds(landing ? 0.35 : 0.18, rate);
    // Crunch: low noise broken into grains, like dust and grit compacting.
    const crunch = filter(noise(length, random), rate, 'lowpass', hard ? 1400 : 520);
    let grain = 1;
    for (let i = 0; i < crunch.length; i++) {
      if (i % Math.floor(rate * 0.0015) === 0) grain = 0.25 + random() * 0.75;
      crunch[i] *= grain;
    }
    add(out, rate, crunch, 0, hard ? 0.6 : 1, landing ? 0.11 : 0.05, 0.006);
    thump(out, rate, 0, landing ? 120 : 140, landing ? 45 : 65, landing ? 0.09 : 0.035, landing ? 1.2 : 0.6);
    if (hard) {
      add(out, rate, filter(noise(seconds(0.01, rate), random), rate, 'bandpass', 2600, 1.5), 0, 0.5, 0.004);
      ping(out, rate, 0, [700 + random() * 100, 1500], 0.02, 0.15);
    }
  }, landing ? 0.9 : 0.7);
}

/** A target shattering: a crack and a spray of small pieces. */
export function targetBreak(c: BaseAudioContext, seed: number) {
  return make(c, 0.9, 300 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.08, rate), random), rate, 'bandpass', 2200, 1), 0, 1, 0.02);
    add(out, rate, filter(noise(seconds(0.3, rate), random), rate, 'lowpass', 3000), 0.005, 0.45, 0.07);
    for (let i = 0; i < 18; i++) {
      const at = Math.pow(random(), 2) * 0.4;
      ping(out, rate, at, [2500 + random() * 4500], 0.02 + random() * 0.04, 0.05 + random() * 0.15);
    }
  }, 0.85);
}

/** A drone breaking: an electrical pop and buzz, a fizz, and parts clattering. */
export function droneBreak(c: BaseAudioContext, seed: number) {
  return make(c, 1.0, 400 + seed, (out, rate, random) => {
    add(out, rate, noise(seconds(0.05, rate), random), 0, 1, 0.01);
    const buzz = new Float32Array(seconds(0.5, rate));
    for (let i = 0; i < buzz.length; i++) buzz[i] = ((i * 140) / rate) % 1 > 0.5 ? 0.6 : -0.6; // square-ish hum
    add(out, rate, filter(buzz, rate, 'lowpass', 1500), 0, 0.5, 0.12);
    add(out, rate, filter(noise(seconds(0.6, rate), random), rate, 'highpass', 3500), 0.02, 0.35, 0.18);
    for (let i = 0; i < 8; i++) ping(out, rate, random() * 0.5, [800 + random() * 1700], 0.03, 0.2);
  }, 0.85);
}

/** A bullet striking rock or metal. */
export function impact(c: BaseAudioContext, seed: number) {
  return make(c, 0.25, 500 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.12, rate), random), rate, 'lowpass', 1600), 0, 1, 0.02);
    thump(out, rate, 0, 200, 90, 0.03, 0.5);
    ping(out, rate, 0, [1100 + random() * 900], 0.015, 0.2);
  }, 0.6);
}

/** Airlock door sliding: an electric motor with a mechanical rumble. */
export function doorMotor(c: BaseAudioContext) {
  return make(c, 1.1, 600, (out, rate, random) => {
    const length = seconds(1.05, rate);
    const motor = new Float32Array(length);
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      phase += (85 + 25 * Math.min(1, t * 3)) / rate;
      const saw = (phase % 1) * 2 - 1;
      const env = Math.min(1, t / 0.08) * Math.min(1, (1.05 - t) / 0.15);
      motor[i] = (saw * 0.7 + Math.sin(phase * 2 * Math.PI * 5) * 0.08) * env;
    }
    add(out, rate, filter(motor, rate, 'lowpass', 700), 0, 1, 100);
    const rumble = filter(noise(length, random), rate, 'lowpass', 160);
    for (let i = 0; i < length; i++) rumble[i] *= Math.min(1, i / rate / 0.1) * Math.min(1, (1.05 - i / rate) / 0.2);
    add(out, rate, rumble, 0, 1.5, 100);
  }, 0.7);
}

/** The door hitting its stop. */
export function doorClunk(c: BaseAudioContext) {
  return make(c, 0.6, 601, (out, rate, random) => {
    thump(out, rate, 0, 120, 55, 0.08, 1);
    add(out, rate, filter(noise(seconds(0.1, rate), random), rate, 'lowpass', 900), 0, 0.6, 0.03);
    ping(out, rate, 0.002, [420, 980, 1650], 0.15, 0.3);
  }, 0.85);
}

/** Air rushing into (or out of) the airlock chamber. */
export function hiss(c: BaseAudioContext) {
  return make(c, 1.5, 602, (out, rate, random) => {
    const hissNoise = filter(filter(noise(seconds(1.5, rate), random), rate, 'highpass', 1800), rate, 'lowpass', 9000);
    for (let i = 0; i < hissNoise.length; i++) {
      const t = i / rate;
      // Strong at first, then tailing off as the pressure evens out.
      hissNoise[i] *= Math.min(1, t / 0.06) * Math.exp(-t / 0.5);
    }
    add(out, rate, hissNoise, 0, 1, 100);
  }, 0.6);
}

/** Breathing inside the helmet: a breath in, and a breath out. */
export function breath(c: BaseAudioContext, seed: number, inhale: boolean) {
  const length = inhale ? 1.1 : 1.3;
  return make(c, length, 700 + seed + (inhale ? 0 : 50), (out, rate, random) => {
    const n = seconds(length, rate);
    const mouth = filter(noise(n, random), rate, 'bandpass', inhale ? 1100 : 650, inhale ? 0.9 : 0.8);
    const edge = filter(noise(n, random), rate, 'bandpass', inhale ? 2400 : 1500, 2);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // In: swells and stops. Out: starts strong and trails off.
      const env = inhale ? Math.pow(Math.sin(Math.PI * t), 1.4) * (0.6 + 0.4 * t) : Math.min(1, t / 0.1) * Math.pow(1 - t, 1.3);
      out[i] = (mouth[i] + edge[i] * 0.35) * env;
    }
  }, inhale ? 0.5 : 0.6);
}

/** Suit alarm: two short tones. */
export function alarm(c: BaseAudioContext) {
  return make(c, 0.3, 800, (out, rate) => {
    for (const [start, freq] of [[0, 1760], [0.11, 1320]]) {
      const begin = seconds(start, rate);
      for (let i = 0; i < seconds(0.08, rate); i++) {
        const t = i / rate;
        out[begin + i] += Math.sin(2 * Math.PI * freq * t) * Math.min(1, t / 0.003) * Math.min(1, (0.08 - t) / 0.01);
      }
    }
  }, 0.5);
}

/** Hit confirmation tick from the helmet display; brighter for a bullseye. */
export function hitTick(c: BaseAudioContext, bullseye: boolean) {
  return make(c, bullseye ? 0.18 : 0.08, 900, (out, rate) => {
    const tone = (start: number, freq: number, length: number) => {
      const begin = seconds(start, rate);
      for (let i = 0; i < seconds(length, rate); i++) {
        const t = i / rate;
        const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * freq * t)); // triangle wave
        out[begin + i] += tri * Math.min(1, t / 0.004) * Math.exp(-t / (length / 3));
      }
    };
    tone(0, 1400, 0.06);
    if (bullseye) tone(0.05, 2100, 0.09);
  }, bullseye ? 0.45 : 0.35);
}

// ---- Drone Siege weapons ----

/** The P-9 sidearm: a sharp, light crack and the slide snapping back. */
export function pistolShot(c: BaseAudioContext, seed: number) {
  return make(c, 0.45, 2000 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.06, rate), random), rate, 'highpass', 2200), 0, 1, 0.004);
    add(out, rate, filter(noise(seconds(0.3, rate), random), rate, 'lowpass', 1500), 0, 1.0, 0.035);
    thump(out, rate, 0, 190, 60, 0.06, 0.9);
    ping(out, rate, 0.03 + random() * 0.006, [2400 + random() * 300, 3800], 0.01, 0.15);
  });
}

/** The plasma SMG: a bright electric snap with a crackle (higher than the drones' shots). */
export function smgShot(c: BaseAudioContext, seed: number) {
  return make(c, 0.25, 2100 + seed, (out, rate, random) => {
    add(out, rate, filter(zap(rate, 0.14, 2800 + random() * 400, 700, 0.025), rate, 'lowpass', 6500), 0, 0.7, 0.04);
    add(out, rate, filter(noise(seconds(0.05, rate), random), rate, 'highpass', 3500), 0, 0.5, 0.012);
    thump(out, rate, 0, 230, 90, 0.025, 0.6);
  }, 0.75);
}

/** The Scatter Cannon: a huge blast, then the pump worked back and forward. */
export function scatterShot(c: BaseAudioContext, seed: number) {
  return make(c, 1.0, 2200 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.08, rate), random), rate, 'highpass', 1500), 0, 0.9, 0.006);
    add(out, rate, filter(filter(noise(seconds(0.7, rate), random), rate, 'lowpass', 900), rate, 'lowpass', 700), 0, 1.5, 0.12);
    thump(out, rate, 0, 115, 32, 0.16, 1.4);
    for (const at of [0.3, 0.42]) {
      add(out, rate, filter(noise(seconds(0.03, rate), random), rate, 'bandpass', 1800, 1.5), at, 0.35, 0.01);
      ping(out, rate, at, [1300 + random() * 200, 2600], 0.015, 0.25);
    }
  });
}

/** The Burst Carbine: a tight, punchy crack (it comes three at a time). */
export function carbineShot(c: BaseAudioContext, seed: number) {
  return make(c, 0.5, 2300 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.08, rate), random), rate, 'highpass', 2000), 0, 1, 0.005);
    add(out, rate, filter(noise(seconds(0.4, rate), random), rate, 'lowpass', 1300), 0, 1.2, 0.04);
    thump(out, rate, 0, 150, 48, 0.07, 1.0);
    ping(out, rate, 0.03, [2000 + random() * 200, 3300], 0.01, 0.15);
  });
}

/** The Rail Rifle: a split-second charge whine, a cracking boom, and the rails ringing. */
export function railShot(c: BaseAudioContext, seed: number) {
  return make(c, 1.5, 2400 + seed, (out, rate, random) => {
    let phase = 0;
    for (let i = 0; i < seconds(0.12, rate); i++) {
      const t = i / rate;
      phase += (400 + 2600 * (t / 0.12) ** 2) / rate;
      out[i] += Math.sin(2 * Math.PI * phase) * 0.25 * (t / 0.12);
    }
    const at = 0.12;
    add(out, rate, filter(noise(seconds(0.1, rate), random), rate, 'highpass', 1000), at, 1.3, 0.02);
    thump(out, rate, at, 85, 25, 0.25, 1.4);
    ping(out, rate, at, [3100, 4700, 6200], 0.12, 0.35);
    add(out, rate, filter(zap(rate, 0.6, 5000, 200, 0.18), rate, 'lowpass', 5000), at, 0.4, 0.2);
  });
}

/** Pulling the trigger on an empty gun with nothing to reload. */
export function dryFire(c: BaseAudioContext) {
  return make(c, 0.08, 2500, (out, rate, random) => {
    ping(out, rate, 0, [2600, 4100], 0.004, 0.6);
    add(out, rate, filter(noise(seconds(0.02, rate), random), rate, 'highpass', 3000), 0, 0.3, 0.004);
  }, 0.5);
}

/** Switching weapons: a rustle of the suit and a click as the next one comes up. */
export function weaponSwap(c: BaseAudioContext) {
  return make(c, 0.4, 2600, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.2, rate), random), rate, 'bandpass', 900, 0.7), 0, 0.5, 0.06, 0.04);
    ping(out, rate, 0.22, [1900, 3100], 0.008, 0.4);
  }, 0.5);
}

/** Buying from a station: a heavy latch and a rising two-note chime. */
export function purchase(c: BaseAudioContext) {
  return make(c, 0.9, 2700, (out, rate) => {
    thump(out, rate, 0, 140, 60, 0.05, 0.8);
    ping(out, rate, 0, [900, 1500], 0.02, 0.4);
    for (const [start, freq] of [[0.12, 880], [0.26, 1320]]) {
      const begin = seconds(start, rate);
      for (let i = 0; i < seconds(0.35, rate); i++) {
        const t = i / rate;
        const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * freq * t));
        out[begin + i] += tri * 0.4 * Math.min(1, t / 0.005) * Math.exp(-t / 0.12);
      }
    }
  }, 0.6);
}

/** Can't afford it: a short low buzz. */
export function denied(c: BaseAudioContext) {
  return make(c, 0.3, 2800, (out, rate) => {
    for (let i = 0; i < seconds(0.25, rate); i++) {
      const t = i / rate;
      const square = Math.sign(Math.sin(2 * Math.PI * 140 * t));
      out[i] += square * 0.5 * Math.min(1, t / 0.005) * Math.min(1, (0.25 - t) / 0.02);
    }
  }, 0.4);
}

// ---- Drone Siege ----

/** A falling electric zap: a buzzy tone that drops from `from` to `to` Hz. */
function zap(rate: number, length: number, from: number, to: number, fall: number) {
  const out = new Float32Array(seconds(length, rate));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    phase += (to + (from - to) * Math.exp(-t / fall)) / rate;
    out[i] = (phase % 1) * 2 - 1; // sawtooth: bright and buzzy
  }
  return out;
}

/** A hostile drone's plasma shot: a sharp snap that drops in pitch, with a crackle. */
export function plasmaShot(c: BaseAudioContext, seed: number) {
  return make(c, 0.4, 1000 + seed, (out, rate, random) => {
    add(out, rate, filter(zap(rate, 0.25, 1700 + random() * 300, 200, 0.045), rate, 'lowpass', 4500), 0, 0.8, 0.07);
    add(out, rate, filter(noise(seconds(0.12, rate), random), rate, 'highpass', 2600), 0, 0.4, 0.025);
    thump(out, rate, 0, 190, 60, 0.04, 0.55);
  }, 0.8);
}

/** A drone charging a shot: a whine that rises and builds for half a second. */
export function plasmaCharge(c: BaseAudioContext) {
  return make(c, 0.55, 1100, (out, rate) => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      const p = t / 0.55;
      const f = 320 + 1500 * p * p;
      a += f / rate;
      b += (f * 1.5) / rate;
      const level = Math.min(1, t / 0.05) * (0.25 + 0.75 * p) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 32 * t));
      out[i] = (Math.sin(2 * Math.PI * a) * 0.7 + Math.sin(2 * Math.PI * b) * 0.3) * level;
    }
  }, 0.5);
}

/** A plasma bolt splashing on a wall: a fizzing crackle. */
export function boltImpact(c: BaseAudioContext, seed: number) {
  return make(c, 0.35, 1200 + seed, (out, rate, random) => {
    add(out, rate, filter(noise(seconds(0.25, rate), random), rate, 'bandpass', 1900, 0.8), 0, 1, 0.06);
    thump(out, rate, 0, 140, 55, 0.035, 0.5);
    for (let i = 0; i < 6; i++) add(out, rate, filter(noise(seconds(0.01, rate), random), rate, 'highpass', 4000), random() * 0.2, 0.4, 0.004);
  }, 0.6);
}

/** A bolt flying past your helmet: a fizz that falls in pitch as it goes by. */
export function boltWhiz(c: BaseAudioContext, seed: number) {
  return make(c, 0.45, 1300 + seed, (out, rate, random) => {
    const hiss = noise(seconds(0.4, rate), random);
    add(out, rate, filter(hiss.slice(0, seconds(0.2, rate)), rate, 'bandpass', 3200, 1.5), 0, 0.8, 0.12, 0.08);
    add(out, rate, filter(hiss.slice(seconds(0.2, rate)), rate, 'bandpass', 1500, 1.5), 0.16, 0.6, 0.1);
    add(out, rate, filter(zap(rate, 0.35, 900, 300, 0.12), rate, 'lowpass', 1200), 0.04, 0.25, 0.12, 0.06);
  }, 0.55);
}

/** A plasma hit on your suit: a heavy thud, a sizzle, and the visor glass creaking. */
export function suitHit(c: BaseAudioContext, seed: number) {
  return make(c, 0.6, 1400 + seed, (out, rate, random) => {
    thump(out, rate, 0, 120, 38, 0.12, 1.2);
    add(out, rate, filter(noise(seconds(0.35, rate), random), rate, 'highpass', 3000), 0.005, 0.5, 0.09);
    add(out, rate, filter(noise(seconds(0.08, rate), random), rate, 'lowpass', 700), 0, 0.8, 0.03);
    ping(out, rate, 0.03 + random() * 0.03, [2500 + random() * 400, 3900], 0.03, 0.18);
  }, 0.85);
}

/** A drone blowing apart: a deep blast, plasma crackling as it discharges, parts ringing. */
export function droneExplosion(c: BaseAudioContext, seed: number) {
  return make(c, 1.6, 1500 + seed, (out, rate, random) => {
    thump(out, rate, 0, 95, 28, 0.35, 1.3);
    add(out, rate, filter(filter(noise(seconds(0.8, rate), random), rate, 'lowpass', 900), rate, 'lowpass', 700), 0, 1.2, 0.22);
    add(out, rate, filter(noise(seconds(0.05, rate), random), rate, 'highpass', 2000), 0, 0.7, 0.015);
    for (let i = 0; i < 26; i++) {
      add(out, rate, filter(noise(seconds(0.012, rate), random), rate, 'bandpass', 2500 + random() * 3000, 2), Math.pow(random(), 1.6) * 0.7, 0.35, 0.006);
    }
    for (let i = 0; i < 8; i++) ping(out, rate, 0.05 + random() * 0.6, [700 + random() * 1800], 0.04, 0.12);
  }, 0.95);
}

/** The suit integrity alarm: a fast, urgent warble, unlike the oxygen beep. */
export function suitAlarm(c: BaseAudioContext) {
  return make(c, 0.4, 1600, (out, rate) => {
    for (let n = 0; n < 4; n++) {
      const begin = seconds(n * 0.09, rate);
      const freq = n % 2 === 0 ? 990 : 740;
      for (let i = 0; i < seconds(0.075, rate); i++) {
        const t = i / rate;
        const square = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.6 + Math.sin(2 * Math.PI * freq * t) * 0.4;
        out[begin + i] += square * Math.min(1, t / 0.003) * Math.min(1, (0.075 - t) / 0.008);
      }
    }
  }, 0.45);
}

/** A round starting: a two-blast klaxon over a deep boom. */
export function roundStart(c: BaseAudioContext) {
  return make(c, 2.4, 1700, (out, rate, random) => {
    thump(out, rate, 0, 70, 30, 0.6, 1.2);
    for (const start of [0.05, 0.75]) {
      const begin = seconds(start, rate);
      let phase = 0;
      for (let i = 0; i < seconds(0.6, rate); i++) {
        const t = i / rate;
        phase += (200 + 140 * Math.min(1, t / 0.25)) / rate; // a siren swelling up
        const level = Math.min(1, t / 0.04) * Math.min(1, (0.6 - t) / 0.1);
        out[begin + i] += ((phase % 1) * 2 - 1) * 0.35 * level;
      }
    }
    add(out, rate, filter(noise(seconds(1.2, rate), random), rate, 'lowpass', 300), 0, 0.5, 0.4);
  }, 0.75);
}

/** A round cleared: a low chord that sinks and fades, like a breath out. */
export function roundEnd(c: BaseAudioContext) {
  return make(c, 3.2, 1800, (out, rate) => {
    for (const [from, to] of [[220, 165], [261.6, 196], [329.6, 247]]) {
      let phase = 0;
      for (let i = 0; i < out.length; i++) {
        const t = i / rate;
        phase += (to + (from - to) * Math.exp(-t / 0.9)) / rate;
        const level = Math.min(1, t / 0.15) * Math.exp(-t / 1.1);
        out[i] += (Math.sin(2 * Math.PI * phase) + 0.25 * Math.sin(4 * Math.PI * phase)) * level * 0.33;
      }
    }
  }, 0.6);
}

/** A spawn point opening: a hatch clank and a rising electronic chirp. */
export function spawnWarning(c: BaseAudioContext) {
  return make(c, 0.9, 1900, (out, rate, random) => {
    thump(out, rate, 0, 160, 70, 0.05, 0.7);
    ping(out, rate, 0.01, [620, 1180, 1750], 0.05, 0.4);
    let phase = 0;
    const begin = seconds(0.15, rate);
    for (let i = 0; i < seconds(0.6, rate); i++) {
      const t = i / rate;
      phase += (500 + 1400 * (t / 0.6) ** 2) / rate;
      out[begin + i] += Math.sin(2 * Math.PI * phase) * 0.3 * Math.min(1, t / 0.05) * (1 - t / 0.6);
    }
    add(out, rate, filter(noise(seconds(0.3, rate), random), rate, 'bandpass', 2400, 1), 0.02, 0.3, 0.08);
  }, 0.7);
}

/** A few seconds of plain noise, for looping sounds built from live filters. */
export function noiseLoop(c: BaseAudioContext) {
  return make(c, 3, 999, (out, _rate, random) => out.set(noise(out.length, random)), 0.9);
}
