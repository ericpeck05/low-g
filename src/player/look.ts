import * as THREE from 'three';
import { CONFIG } from '../config';

// Turns mouse movement into where the player is looking.
// yaw = left/right turn, pitch = up/down tilt.
export class Look {
  yaw = 0;
  pitch = 0;
  sensitivity = CONFIG.look.sensitivity;

  // zoomScale slows the mouse while aiming down sights, so zoomed aim feels the same.
  update(mouse: { x: number; y: number }, zoomScale = 1) {
    this.yaw -= mouse.x * this.sensitivity * zoomScale;
    this.pitch -= mouse.y * this.sensitivity * zoomScale;
    const limit = THREE.MathUtils.degToRad(CONFIG.look.maxPitch);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -limit, limit);
  }

  changeSensitivity(direction: 1 | -1) {
    const { sensitivityStep, sensitivityMin, sensitivityMax } = CONFIG.look;
    this.sensitivity = THREE.MathUtils.clamp(
      this.sensitivity + direction * sensitivityStep,
      sensitivityMin,
      sensitivityMax,
    );
  }

  // Extra pitch and yaw (from recoil) are added on top without changing where you aim long-term.
  applyTo(camera: THREE.Camera, extraPitch = 0, extraYaw = 0) {
    // 'YXZ' turns left/right first, then tilts. This stops the view from rolling.
    camera.rotation.order = 'YXZ';
    const limit = THREE.MathUtils.degToRad(CONFIG.look.maxPitch);
    camera.rotation.set(THREE.MathUtils.clamp(this.pitch + extraPitch, -limit, limit), this.yaw + extraYaw, 0);
  }
}
