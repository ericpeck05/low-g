import * as THREE from 'three';
import { CONFIG } from '../config';

// The sound system's plumbing. Every sound goes into one of three "buses":
//   suit  - inside your helmet: breathing, alarms, the hit tick. Always clear.
//   body  - things you feel through your suit: your gun, footsteps, jetpack.
//           Outside the dome they arrive as dull thumps.
//   world - everything else. Outside the dome there's no air to carry it,
//           so it's cut down to a faint low rumble. Inside, it echoes off the dome.
export type Bus = 'suit' | 'body' | 'world';

export interface PlayOptions {
  bus: Bus;
  gain?: number;
  rate?: number; // playback speed: >1 higher and shorter
  position?: THREE.Vector3; // place the sound in the world (3D)
  delay?: number; // seconds from now
}

export class AudioEngine {
  readonly context: AudioContext;
  readonly buses: Record<Bus, GainNode>;
  private master: GainNode; // the volume setting
  readonly limiter: DynamicsCompressorNode;
  private game: GainNode; // fades out when paused
  private worldFilter: BiquadFilterNode;
  private worldGain: GainNode;
  private bodyFilter: BiquadFilterNode;
  private reverbSend: GainNode;
  private outside = 0; // 0 = dome air, 1 = vacuum (smoothed)

  constructor() {
    this.context = new AudioContext();
    const c = this.context;
    // A limiter at the very end: loud moments (a burst of fire in the echoing dome)
    // get held down smoothly instead of distorting.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.2;
    this.limiter.connect(c.destination);
    this.master = c.createGain();
    this.master.connect(this.limiter);
    this.game = c.createGain();
    this.game.connect(this.master);

    // Dome reverb: a big, hard space. World and body sounds feed it when you're inside.
    const reverb = c.createConvolver();
    reverb.buffer = this.impulse(2.4);
    this.reverbSend = c.createGain();
    this.reverbSend.connect(reverb).connect(this.game);

    const suit = c.createGain();
    suit.connect(this.game);

    const body = c.createGain();
    this.bodyFilter = c.createBiquadFilter();
    this.bodyFilter.type = 'lowpass';
    body.connect(this.bodyFilter).connect(this.game);
    body.connect(this.reverbSend);

    const world = c.createGain();
    this.worldFilter = c.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldGain = c.createGain();
    world.connect(this.worldFilter).connect(this.worldGain).connect(this.game);
    world.connect(this.reverbSend);

    this.buses = { suit, body, world };
    this.applyOutside();
  }

  setVolume(volume: number) {
    this.master.gain.setTargetAtTime(volume, this.context.currentTime, 0.02);
  }

  /** Fade game sound out while paused, back in when playing. */
  setPaused(paused: boolean) {
    this.game.gain.setTargetAtTime(paused ? 0 : 1, this.context.currentTime, 0.08);
  }

  resume() {
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Call every frame: where the ears are, and whether there's air around them. */
  update(dt: number, camera: THREE.Camera, inside: boolean) {
    // Ears follow the camera.
    const l = this.context.listener;
    const p = camera.getWorldPosition(new THREE.Vector3());
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    if (l.positionX) {
      const t = this.context.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }

    // Ease between dome air and vacuum (like an airlock filling or emptying).
    const target = inside ? 0 : 1;
    this.outside += (target - this.outside) * Math.min(1, dt / CONFIG.audio.muffleTime * 3);
    this.applyOutside();
  }

  /** 0 in dome air, 1 in vacuum. */
  get vacuum() {
    return this.outside;
  }

  play(buffer: AudioBuffer, options: PlayOptions) {
    const c = this.context;
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 1;
    const gain = c.createGain();
    gain.gain.value = options.gain ?? 1;
    source.connect(gain);
    if (options.position) {
      const panner = c.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3;
      panner.rolloffFactor = 1;
      panner.maxDistance = 400;
      panner.positionX.value = options.position.x;
      panner.positionY.value = options.position.y;
      panner.positionZ.value = options.position.z;
      gain.connect(panner).connect(this.buses[options.bus]);
    } else {
      gain.connect(this.buses[options.bus]);
    }
    source.start(c.currentTime + (options.delay ?? 0));
    return source;
  }

  private applyOutside() {
    const a = CONFIG.audio;
    const m = this.outside;
    const t = this.context.currentTime;
    // Brightness falls off exponentially, which sounds even to the ear.
    this.worldFilter.frequency.setTargetAtTime(18000 * Math.pow(a.worldMuffleHz / 18000, m), t, 0.03);
    this.worldGain.gain.setTargetAtTime(THREE.MathUtils.lerp(1, a.worldMuffleGain, m), t, 0.03);
    this.bodyFilter.frequency.setTargetAtTime(18000 * Math.pow(a.bodyMuffleHz / 18000, m), t, 0.03);
    this.reverbSend.gain.setTargetAtTime(a.domeReverb * (1 - m), t, 0.03);
  }

  // A reverb "fingerprint" of a big hard dome: a few early echoes off the
  // floor and towers, then a long, darkening wash.
  private impulse(seconds: number) {
    const rate = this.context.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.context.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const noise = Math.random() * 2 - 1;
        // Later echoes lose their highs (simple low-pass that closes over time).
        const k = 0.6 - 0.5 * Math.min(1, t / seconds);
        low += (noise - low) * k;
        data[i] = low * Math.exp(-t / 0.55) * 0.6;
      }
      for (const [time, level] of [[0.031, 0.5], [0.058, 0.35], [0.093, 0.3], [0.141, 0.22]]) {
        data[Math.floor((time + ch * 0.004) * rate)] += level;
      }
    }
    return buffer;
  }
}
