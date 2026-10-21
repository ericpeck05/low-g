import * as THREE from 'three';
import { CONFIG } from '../config';

// Recoil kicks the view up (and a little sideways) on each shot, then settles back.
// Shake is a quick random jitter on top. Neither changes where you were aiming:
// they're offsets added to the camera, and they fade back to zero.
export class Recoil {
  pitch = 0; // radians of upward kick
  yaw = 0; // radians of sideways kick
  shakePitch = 0;
  shakeYaw = 0;
  private shake = 0;

  /** One shot's kick. `gun` is that gun's recoil (degrees up, degrees sideways, shake). */
  kick(aimBlend: number, gun: { pitch: number; yaw: number; shake: number }) {
    const scale = THREE.MathUtils.lerp(1, CONFIG.recoil.adsScale, aimBlend);
    this.pitch += THREE.MathUtils.degToRad(gun.pitch) * scale;
    this.yaw += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * gun.yaw) * scale;
    this.shake += gun.shake * scale;
  }

  update(dt: number) {
    const cfg = CONFIG.recoil;
    const settle = Math.min(1, cfg.recovery * dt);
    this.pitch -= this.pitch * settle;
    this.yaw -= this.yaw * settle;

    this.shake -= this.shake * Math.min(1, cfg.shakeDecay * dt);
    this.shakePitch = (Math.random() * 2 - 1) * this.shake;
    this.shakeYaw = (Math.random() * 2 - 1) * this.shake;
  }
}
