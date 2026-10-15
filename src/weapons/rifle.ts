import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Input } from '../core/input';

// The rifle's rules: trigger, fire rate, magazine, reload, aiming down sights
// and spread. It doesn't draw anything or know what it hits; main.ts does that
// with the shots this returns.
export class Rifle {
  ammo = CONFIG.rifle.magazineSize;
  reloading = false;
  reloadProgress = 0; // 0 to 1 while reloading
  aimBlend = 0; // 0 = hip fire, 1 = fully aimed down sights
  bloom = 0; // extra spread from holding the trigger, in degrees

  private cooldown = 0; // seconds until the next shot is allowed
  private reloadTimer = 0;

  get aiming() {
    return this.aimBlend > 0.5;
  }

  /**
   * Runs the trigger for one frame. Returns how many shots fired (usually 0 or 1).
   */
  update(dt: number, input: Input): number {
    const cfg = CONFIG.rifle;

    // Raise or lower the sights. No aiming during a reload.
    const wantsAim = input.isDown('Mouse2') && !this.reloading;
    const target = wantsAim ? 1 : 0;
    this.aimBlend += (target - this.aimBlend) * Math.min(1, cfg.adsSpeed * dt);

    this.bloom = Math.max(0, this.bloom - cfg.spreadRecovery * dt);
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloading) {
      this.reloadTimer -= dt;
      this.reloadProgress = 1 - this.reloadTimer / cfg.reloadTime;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.ammo = cfg.magazineSize;
      }
      return 0;
    }

    if (input.wasPressed('KeyR') && this.ammo < cfg.magazineSize) {
      this.startReload();
      return 0;
    }

    if (!input.isDown('Mouse0')) return 0;

    // Pulling the trigger on an empty magazine reloads it.
    if (this.ammo === 0) {
      this.startReload();
      return 0;
    }

    // Holding the trigger fires at a steady rate. Counting shots in a loop keeps
    // the rate correct even if a frame is slower than the gap between shots.
    let shots = 0;
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 1 / cfg.fireRate;
      this.ammo--;
      shots++;
    }
    this.bloom += shots * cfg.spreadPerShot;
    return shots;
  }

  /** Current spread in degrees, given how the player is moving. */
  spread(horizontalSpeed: number, grounded: boolean) {
    const cfg = CONFIG.rifle;
    const base = THREE.MathUtils.lerp(cfg.hipSpread, cfg.adsSpread, this.aimBlend);
    const moving = cfg.moveSpread * Math.min(1, horizontalSpeed / CONFIG.player.sprintSpeed);
    const air = grounded ? 0 : cfg.airSpread;
    // Aiming steadies everything, not just the base spread.
    const steadiness = THREE.MathUtils.lerp(1, 0.3, this.aimBlend);
    return base + (moving + air + this.bloom) * steadiness;
  }

  private startReload() {
    this.reloading = true;
    this.reloadTimer = CONFIG.rifle.reloadTime;
    this.reloadProgress = 0;
  }
}
