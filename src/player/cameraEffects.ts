import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Player } from './player';

// Small camera motions that make movement feel physical:
// head bob while walking, a dip when landing, and a smooth crouch.
export class CameraEffects {
  private bobPhase = 0;
  private bobWeight = 0; // 0 = standing still or airborne, 1 = full bob
  private dip = 0; // current landing dip in meters
  private eyeHeight = CONFIG.player.standHeight - CONFIG.player.eyeFromTop;

  update(dt: number, player: Player, camera: THREE.Camera, yaw: number) {
    const fx = CONFIG.cameraFx;

    // Crouch: slide the eyes toward the new height instead of snapping.
    const targetEye = player.height - CONFIG.player.eyeFromTop;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, CONFIG.player.crouchSpeed * dt);

    // Head bob: advances with distance walked, fades out in the air.
    const speed = player.horizontalSpeed;
    const bobTarget = player.grounded ? Math.min(1, speed / CONFIG.player.walkSpeed) : 0;
    this.bobWeight += (bobTarget - this.bobWeight) * Math.min(1, 10 * dt);
    this.bobPhase += speed * dt * fx.bobFrequency * Math.PI;
    const bobY = Math.sin(this.bobPhase * 2) * fx.bobAmountY * this.bobWeight;
    const bobX = Math.sin(this.bobPhase) * fx.bobAmountX * this.bobWeight;

    // Landing dip: kick down on impact, then spring back up.
    if (player.landingSpeed > 0) {
      this.dip = Math.min(fx.landingDipMax, this.dip + player.landingSpeed * fx.landingDipPerSpeed);
    }
    this.dip -= this.dip * Math.min(1, fx.landingRecover * dt);

    // Sway goes sideways relative to where we're facing.
    const feet = player.feet;
    camera.position.set(
      feet.x + Math.cos(yaw) * bobX,
      feet.y + this.eyeHeight + bobY - this.dip,
      feet.z - Math.sin(yaw) * bobX,
    );
  }
}
