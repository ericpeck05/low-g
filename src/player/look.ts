import * as THREE from 'three';
import { CONFIG } from '../config';

// Turns mouse movement into where the player is looking.
// yaw = left/right turn, pitch = up/down tilt.
export class Look {
  yaw = 0;
  pitch = 0;
  sensitivity = CONFIG.look.sensitivity;

  update(mouse: { x: number; y: number }) {
    this.yaw -= mouse.x * this.sensitivity;
    this.pitch -= mouse.y * this.sensitivity;
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

  applyTo(camera: THREE.Camera) {
    // 'YXZ' turns left/right first, then tilts. This stops the view from rolling.
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
