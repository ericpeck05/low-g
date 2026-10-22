import { seededRandom } from '../world/noise';
import { filter } from './synth';

// Drone Siege's music: four layers that loop together and fade in as the fight builds.
//   bed    - a dark pad, always there during a game (quietly between rounds)
//   pulse  - a driving bass line, in during a round
//   drums  - from round 4, and in every special round
//   strings- a high, uneasy tremolo for late rounds, swarms and the carrier
// All four are rendered once at load (8 seconds each, 120 beats a minute) and started
// together, so they stay in time; only their volumes change.

const LOOP = 8; // seconds: four bars of four beats
const BEAT = 0.5;
const CROSSFADE = 0.5; // the loop's end blends into its start so it never clicks

// The chords, one per bar (root notes in Hz): D minor, B flat, C, A minor.
const ROOTS = [73.42, 58.27, 65.41, 55.0];
const CHORDS = [
  [73.42, 110.0, 174.61],
  [58.27, 87.31, 146.83],
  [65.41, 98.0, 164.81],
  [55.0, 82.41, 130.81],
];

export interface MusicState {
  playing: boolean; // in a Drone Siege game, not paused
  fighting: boolean; // a round is on
  round: number;
  special: boolean; // a swarm or carrier round
  danger: boolean; // suit integrity low
}

export class Music {
  private layers: { name: string; gain: GainNode }[] = [];
  private buffers: AudioBuffer[] = [];
  private volume: GainNode;
  private started = false;

  constructor(
    private context: AudioContext,
    output: AudioNode,
  ) {
    const volume = context.createGain();
    volume.gain.value = 0.42;
    volume.connect(output);
    this.volume = volume;
    for (const [name, render] of [
      ['bed', bed],
      ['pulse', pulse],
      ['drums', drums],
      ['strings', strings],
    ] as const) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(volume);
      this.layers.push({ name, gain });
      this.buffers.push(this.loop(render));
    }
  }

  /** Music volume (from the settings). */
  setVolume(level: number) {
    this.volume.gain.setTargetAtTime(0.42 * level, this.context.currentTime, 0.05);
  }

  update(state: MusicState) {
    if (!this.started && this.context.state === 'running') this.start();
    const target: Record<string, number> = { bed: 0, pulse: 0, drums: 0, strings: 0 };
    if (state.playing) {
      target.bed = state.fighting ? 0.9 : 0.55;
      if (state.fighting) {
        target.pulse = 0.75;
        if (state.round >= 4 || state.special) target.drums = state.round >= 10 || state.special ? 0.9 : 0.6;
        if (state.round >= 10 || state.special || state.danger) target.strings = state.special ? 0.7 : 0.45;
      }
    }
    const t = this.context.currentTime;
    for (const layer of this.layers) layer.gain.gain.setTargetAtTime(target[layer.name], t, target[layer.name] > layer.gain.gain.value ? 0.8 : 1.6);
  }

  // Start every layer at the same moment, looping forever (silent until faded in).
  private start() {
    this.started = true;
    const when = this.context.currentTime + 0.05;
    this.layers.forEach((layer, k) => {
      const source = this.context.createBufferSource();
      source.buffer = this.buffers[k];
      source.loop = true;
      source.connect(layer.gain);
      source.start(when);
    });
  }

  // Render a layer a little longer than the loop, then fold the extra back over the start.
  private loop(render: (out: Float32Array, rate: number) => void) {
    const rate = this.context.sampleRate;
    const length = Math.floor(LOOP * rate);
    const extra = Math.floor(CROSSFADE * rate);
    const data = new Float32Array(length + extra);
    render(data, rate);
    const buffer = this.context.createBuffer(1, length, rate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) out[i] = data[i];
    for (let i = 0; i < extra; i++) {
      const fade = i / extra;
      out[i] = out[i] * fade + data[length + i] * (1 - fade);
    }
    let max = 0;
    for (const v of out) max = Math.max(max, Math.abs(v));
    if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.8 / max;
    return buffer;
  }
}

// ---- The layers ----

function saw(phase: number) {
  return (phase % 1) * 2 - 1;
}

/** A slow, dark pad: each bar's chord on detuned saws, softened, swelling in and out. */
function bed(out: Float32Array, rate: number) {
  const phases = new Float64Array(12);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const bar = Math.floor(t / 2) % 4;
    const inBar = t % 2;
    const swell = Math.min(1, inBar / 0.6) * (0.75 + 0.25 * Math.cos((inBar / 2) * Math.PI * 2));
    let v = 0;
    CHORDS[bar].forEach((f, k) => {
      for (const d of [-0.004, 0.004]) {
        const index = k * 2 + (d > 0 ? 1 : 0);
        phases[index] += (f * (1 + d)) / rate;
        v += saw(phases[index]);
      }
    });
    out[i] = v * swell * 0.12;
  }
  filter(out, rate, 'lowpass', 520, 0.9);
  filter(out, rate, 'lowpass', 900);
}

/** Eighth-note bass on the bar's root, with a plucked envelope and an accent on the beat. */
function pulse(out: Float32Array, rate: number) {
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const bar = Math.floor(t / 2) % 4;
    const step = Math.floor(t / (BEAT / 2));
    const inStep = t % (BEAT / 2);
    const f = ROOTS[bar] * (step % 8 === 6 ? 1.5 : 1); // a lift near the end of each bar
    phase += f / rate;
    const accent = step % 2 === 0 ? 1 : 0.65;
    out[i] = (saw(phase) * 0.7 + Math.sin(2 * Math.PI * phase) * 0.5) * Math.exp(-inStep / 0.09) * Math.min(1, inStep / 0.003) * accent;
  }
  filter(out, rate, 'lowpass', 700, 1.2);
}

/** Kick on 1 and 3 (and a push before 3), a snare on 2 and 4, and ticking hats. */
function drums(out: Float32Array, rate: number) {
  const random = seededRandom(77);
  const hit = (at: number, render: (i: number, t: number) => number, length: number) => {
    const start = Math.floor(at * rate);
    for (let i = 0; i < length * rate && start + i < out.length; i++) out[start + i] += render(i, i / rate);
  };
  const beats = (LOOP + CROSSFADE) / BEAT;
  for (let b = 0; b < beats; b++) {
    const at = b * BEAT;
    const inBar = b % 4;
    if (inBar === 0 || inBar === 2) {
      let phase = 0;
      hit(at, (_i, t) => {
        phase += (45 + 110 * Math.exp(-t / 0.03)) / rate;
        return Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.18) * 0.9;
      }, 0.6);
    }
    if (inBar === 1 || inBar === 3) {
      hit(at, (_i, t) => (random() * 2 - 1) * Math.exp(-t / 0.07) * 0.45 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.05) * 0.4, 0.3);
    }
    if (inBar === 1) {
      let phase = 0;
      hit(at + BEAT * 0.75, (_i, t) => {
        phase += (45 + 90 * Math.exp(-t / 0.03)) / rate;
        return Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.12) * 0.6;
      }, 0.4);
    }
  }
  // Hats: short bright ticks on every eighth.
  const hats = new Float32Array(out.length);
  for (let e = 0; e < beats * 2; e++) {
    const start = Math.floor(e * (BEAT / 2) * rate);
    const level = e % 2 ? 0.35 : 0.2;
    for (let i = 0; i < 0.05 * rate && start + i < hats.length; i++) hats[start + i] += (random() * 2 - 1) * Math.exp(-i / rate / 0.012) * level;
  }
  filter(hats, rate, 'highpass', 6000);
  for (let i = 0; i < out.length; i++) out[i] += hats[i];
}

/** High strings a half step apart, trembling: unease. */
function strings(out: Float32Array, rate: number) {
  const phases = [0, 0, 0];
  const freqs = [587.33, 622.25, 880];
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const tremolo = 0.6 + 0.4 * Math.sin(2 * Math.PI * 7.5 * t);
    const breath = 0.7 + 0.3 * Math.sin((2 * Math.PI * t) / 4);
    let v = 0;
    freqs.forEach((f, k) => {
      phases[k] += (f * (1 + 0.002 * Math.sin(2 * Math.PI * (0.3 + k * 0.1) * t))) / rate;
      v += saw(phases[k]) * (k === 2 ? 0.4 : 1);
    });
    out[i] = v * tremolo * breath * 0.2;
  }
  filter(out, rate, 'lowpass', 2600);
  filter(out, rate, 'highpass', 300);
}
