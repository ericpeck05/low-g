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

  kick(aimBlend: number) {
    const cfg = CONFIG.recoil;
    const scale = THREE.MathUtils.lerp(1, cfg.adsScale, aimBlend);
    this.pitch += THREE.MathUtils.degToRad(cfg.kickPitch) * scale;
    this.yaw += THREE.MathUtils.degToRad((Math.random() * 2 - 1) * cfg.kickYaw) * scale;
    this.shake += cfg.shakeAmount * scale;
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
