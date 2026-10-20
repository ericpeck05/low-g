import * as THREE from 'three';
import { CONFIG } from '../config';
import { AudioEngine, type Bus } from './engine';
import * as synth from './synth';

// Every sound in the game, in one place. main.ts calls the event methods
// (gunshot, footstep...) and update() once per frame for the continuous sounds.

export interface AudioFrame {
  dt: number;
  camera: THREE.Camera;
  inside: boolean; // breathing dome air
  playing: boolean; // false while paused or in menus
  oxygenLevel: number;
  oxygenLow: boolean;
  thrusting: boolean;
  exertion: number; // 0 resting, 1 sprinting or flying
  suitLow: boolean; // Drone Siege: suit integrity critical
}

export class GameAudio {
  private engine: AudioEngine;
  private sounds: ReturnType<typeof buildSounds>;
  private jetpack: GainNode;
  private hum: GainNode;
  private fan: GainNode;
  private breathTimer = 1;
  private breathCount = 0;
  private stress = 0;
  private alarmTimer = 0;
  private suitAlarmTimer = 0;
  private lastPlayed = new Map<string, number>(); // for spacing out sounds many drones make at once
  private variant = 0;

  constructor() {
    this.engine = new AudioEngine();
    this.sounds = buildSounds(this.engine.context);
    const noise = synth.noiseLoop(this.engine.context);
    this.jetpack = this.buildJetpack(noise);
    this.hum = this.buildHum(noise);
    this.fan = this.buildFan(noise);
  }

  /** Browsers only allow sound after a click: call this from one. */
  unlock() {
    this.engine.resume();
  }

  setVolume(volume: number) {
    this.engine.setVolume(volume);
  }

  // ---- One-off sounds ----

  gunshot() {
    this.play(this.pick(this.sounds.gunshots), 'body', { gain: 0.55, rate: 0.96 + Math.random() * 0.08 });
  }

  magazineRelease() {
    this.play(this.sounds.magRelease, 'body', { gain: 0.7 });
  }

  magazineInsert() {
    this.play(this.sounds.magInsert, 'body', { gain: 0.8 });
  }

  boltRelease() {
    this.play(this.sounds.boltRelease, 'body', { gain: 0.8 });
  }

  /** The helmet display's hit confirmation (always clear: it's inside your helmet). */
  hitConfirm(bullseye: boolean) {
    this.play(bullseye ? this.sounds.tickBullseye : this.sounds.tick, 'suit', { gain: 0.7 });
  }

  targetBreak(position: THREE.Vector3, drone: boolean) {
    const list = drone ? this.sounds.droneBreaks : this.sounds.breaks;
    this.play(this.pick(list), 'world', { gain: 0.9, position, rate: 0.92 + Math.random() * 0.16 });
  }

  impact(position: THREE.Vector3) {
    this.play(this.pick(this.sounds.impacts), 'world', { gain: 0.7, position, rate: 0.85 + Math.random() * 0.3 });
  }

  /** Footsteps travel up through your own body, so they're on the body bus. */
  footstep(hard: boolean, landing: boolean, strength = 1) {
    const list = landing ? (hard ? this.sounds.landHard : this.sounds.landDust) : hard ? this.sounds.stepsHard : this.sounds.stepsDust;
    this.play(this.pick(list), 'body', { gain: (landing ? 0.9 : 0.55) * strength, rate: 0.9 + Math.random() * 0.2 });
  }

  casing(position: THREE.Vector3, loudness: number) {
    this.play(this.pick(this.sounds.casings), 'world', { gain: 0.35 * loudness, position, rate: 0.9 + Math.random() * 0.25 });
  }

  doorMoving(position: THREE.Vector3) {
    this.play(this.sounds.doorMotor, 'world', { gain: 0.9, position });
  }

  doorStopped(position: THREE.Vector3) {
    this.play(this.sounds.doorClunk, 'world', { gain: 1, position });
  }

  airHiss(position: THREE.Vector3) {
    this.play(this.sounds.hiss, 'world', { gain: 0.9, position });
  }

  // ---- Drone Siege ----

  /** A drone's core whining up before it fires: your cue to move. */
  droneCharge(position: THREE.Vector3) {
    if (this.tooSoon('charge', 0.15)) return;
    this.play(this.sounds.plasmaCharge, 'world', { gain: 0.55, position });
  }

  droneFire(position: THREE.Vector3) {
    if (this.tooSoon('fire', 0.07)) return;
    this.play(this.pick(this.sounds.plasmaShots), 'world', { gain: 0.8, position, rate: 0.94 + Math.random() * 0.12 });
  }

  boltImpact(position: THREE.Vector3) {
    if (this.tooSoon('boltImpact', 0.05)) return;
    this.play(this.pick(this.sounds.boltImpacts), 'world', { gain: 0.6, position, rate: 0.9 + Math.random() * 0.2 });
  }

  boltWhiz(position: THREE.Vector3) {
    this.play(this.pick(this.sounds.boltWhizzes), 'world', { gain: 0.75, position, rate: 0.9 + Math.random() * 0.2 });
  }

  /** You were hit: felt through the suit itself, so it's clear even in vacuum. */
  suitHit() {
    this.play(this.pick(this.sounds.suitHits), 'body', { gain: 1 });
  }

  droneExplosion(position: THREE.Vector3) {
    this.play(this.pick(this.sounds.droneExplosions), 'world', { gain: 1, position, rate: 0.92 + Math.random() * 0.16 });
  }

  // ---- Continuous sounds, once per frame ----

  update(f: AudioFrame) {
    const t = this.engine.context.currentTime;
    this.engine.setPaused(!f.playing);
    this.engine.update(f.dt, f.camera, f.inside);
    const vacuum = this.engine.vacuum;

    // Jetpack: on while thrusting, with a quick fade so it doesn't click.
    this.jetpack.gain.setTargetAtTime(f.playing && f.thrusting ? 0.5 : 0, t, f.thrusting ? 0.04 : 0.12);

    // The city's hum lives in the dome's air: gone in vacuum.
    this.hum.gain.setTargetAtTime(f.playing ? 0.55 * (1 - vacuum) : 0, t, 0.3);
    // Your suit's life-support fan, a little more noticeable when it's all you can hear.
    this.fan.gain.setTargetAtTime(f.playing ? 0.035 + 0.04 * vacuum : 0, t, 0.3);

    if (!f.playing) return;
    this.breathe(f, vacuum);
    this.alarm(f);
    this.suitAlarm(f);
  }

  // Suit integrity critical: a fast warble, inside or out, until it repairs.
  private suitAlarm(f: AudioFrame) {
    if (!f.suitLow) {
      this.suitAlarmTimer = 0;
      return;
    }
    this.suitAlarmTimer -= f.dt;
    if (this.suitAlarmTimer > 0) return;
    this.suitAlarmTimer = 0.75;
    this.play(this.sounds.suitAlarm, 'suit', { gain: 0.32 });
  }

  // With a couple of dozen drones, the same sound can be asked for many times a second.
  // Skipping repeats closer together than `gap` seconds keeps a big fight readable.
  private tooSoon(name: string, gap: number) {
    const now = this.engine.context.currentTime;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < gap) return true;
    this.lastPlayed.set(name, now);
    return false;
  }

  // Breathing: calm and slow normally, faster and louder when exerted or short of air.
  // Heard mainly outside, where it's the loudest thing in your helmet.
  private breathe(f: AudioFrame, vacuum: number) {
    const lowAir = THREE.MathUtils.clamp(1 - f.oxygenLevel / 40, 0, 1);
    const target = Math.max(lowAir, f.exertion * 0.55);
    this.stress += (target - this.stress) * Math.min(1, f.dt * 0.5); // breathing settles slowly
    this.breathTimer -= f.dt;
    if (this.breathTimer > 0) return;
    const a = CONFIG.audio;
    const period = THREE.MathUtils.lerp(a.breathPeriodCalm, a.breathPeriodPanic, this.stress);
    this.breathTimer = period * (0.92 + Math.random() * 0.16);
    const loudness = THREE.MathUtils.lerp(0.06, 0.5, vacuum) * (0.7 + this.stress * 0.6);
    if (loudness < 0.03) return;
    const rate = 1 + this.stress * 0.25; // quick, shallow breaths when panicking
    const k = this.breathCount++ % 2;
    this.play(this.sounds.inhales[k], 'suit', { gain: loudness, rate });
    this.play(this.sounds.exhales[k], 'suit', { gain: loudness, rate, delay: period * 0.42 });
  }

  // Low oxygen alarm: a two-tone beep, every second, twice as often near empty.
  private alarm(f: AudioFrame) {
    if (!f.oxygenLow || f.inside) {
      this.alarmTimer = 0;
      return;
    }
    this.alarmTimer -= f.dt;
    if (this.alarmTimer > 0) return;
    this.alarmTimer = f.oxygenLevel < 10 ? 0.5 : 1;
    this.play(this.sounds.alarm, 'suit', { gain: 0.5 });
  }

  private play(buffer: AudioBuffer, bus: Bus, options: { gain?: number; rate?: number; position?: THREE.Vector3; delay?: number } = {}) {
    if (this.engine.context.state !== 'running') return;
    this.engine.play(buffer, { bus, ...options });
  }

  private pick<T>(list: T[]) {
    this.variant = (this.variant + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    return list[this.variant];
  }

  // Jetpack roar: noise through a fluttering band filter plus a low rumble, felt through the suit.
  private buildJetpack(noise: AudioBuffer) {
    const c = this.engine.context;
    const out = c.createGain();
    out.gain.value = 0;
    const roar = this.loop(noise, 1);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 650;
    band.Q.value = 0.8;
    const flutter = c.createOscillator();
    flutter.frequency.value = 9;
    const depth = c.createGain();
    depth.gain.value = 140;
    flutter.connect(depth).connect(band.frequency);
    flutter.start();
    const rumble = this.loop(noise, 0.5);
    const low = c.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 110;
    const rumbleGain = c.createGain();
    rumbleGain.gain.value = 2.5;
    roar.connect(band).connect(out);
    rumble.connect(low).connect(rumbleGain).connect(out);
    out.connect(this.engine.buses.body);
    return out;
  }

  // City hum: transformers and machinery (a low electrical tone and its overtones)
  // plus the air handling's soft rush.
  private buildHum(noise: AudioBuffer) {
    const c = this.engine.context;
    const out = c.createGain();
    out.gain.value = 0;
    for (const [freq, level] of [[50, 0.09], [100, 0.06], [150, 0.025], [200, 0.012]]) {
      const osc = c.createOscillator();
      osc.frequency.value = freq + Math.random() * 0.3;
      const g = c.createGain();
      g.gain.value = level;
      osc.connect(g).connect(out);
      osc.start();
    }
    const air = this.loop(noise, 0.7);
    const airFilter = c.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 500;
    const airGain = c.createGain();
    airGain.gain.value = 0.12;
    air.connect(airFilter).connect(airGain).connect(out);
    out.connect(this.engine.buses.world);
    return out;
  }

  // The suit's fan: a faint, steady whir inside the helmet.
  private buildFan(noise: AudioBuffer) {
    const c = this.engine.context;
    const out = c.createGain();
    out.gain.value = 0;
    const source = this.loop(noise, 1.3);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 1.2;
    source.connect(band).connect(out);
    const whine = c.createOscillator();
    whine.frequency.value = 233;
    const whineGain = c.createGain();
    whineGain.gain.value = 0.06;
    whine.connect(whineGain).connect(out);
    whine.start();
    out.connect(this.engine.buses.suit);
    return out;
  }

  private loop(buffer: AudioBuffer, rate: number) {
    const source = this.engine.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    source.start(0, Math.random() * buffer.duration);
    return source;
  }
}

function buildSounds(c: BaseAudioContext) {
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  return {
    gunshots: range(4).map((i) => synth.gunshot(c, i)),
    magRelease: synth.magazineRelease(c),
    magInsert: synth.magazineInsert(c),
    boltRelease: synth.boltRelease(c),
    tick: synth.hitTick(c, false),
    tickBullseye: synth.hitTick(c, true),
    breaks: range(3).map((i) => synth.targetBreak(c, i)),
    droneBreaks: range(2).map((i) => synth.droneBreak(c, i)),
    impacts: range(3).map((i) => synth.impact(c, i)),
    stepsDust: range(4).map((i) => synth.footstep(c, i, false)),
    stepsHard: range(4).map((i) => synth.footstep(c, i, true)),
    landDust: range(2).map((i) => synth.footstep(c, i, false, true)),
    landHard: range(2).map((i) => synth.footstep(c, i, true, true)),
    casings: range(4).map((i) => synth.casing(c, i)),
    doorMotor: synth.doorMotor(c),
    doorClunk: synth.doorClunk(c),
    hiss: synth.hiss(c),
    inhales: range(2).map((i) => synth.breath(c, i, true)),
    exhales: range(2).map((i) => synth.breath(c, i, false)),
    alarm: synth.alarm(c),
    plasmaShots: range(3).map((i) => synth.plasmaShot(c, i)),
    plasmaCharge: synth.plasmaCharge(c),
    boltImpacts: range(3).map((i) => synth.boltImpact(c, i)),
    boltWhizzes: range(2).map((i) => synth.boltWhiz(c, i)),
    suitHits: range(3).map((i) => synth.suitHit(c, i)),
    droneExplosions: range(2).map((i) => synth.droneExplosion(c, i)),
    suitAlarm: synth.suitAlarm(c),
  };
}
