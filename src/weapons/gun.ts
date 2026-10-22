import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Input } from '../core/input';
import type { WeaponSpec } from './weaponSpec';

// One gun's rules: trigger (full auto, single shots or bursts), fire rate, magazine
// and spare ammo, reload, aiming down sights and spread. It doesn't draw anything or
// know what it hits; main.ts does that with the shots this returns.
export class Gun {
  ammo: number;
  reserve: number;
  reloading = false;
  reloadProgress = 0; // 0 to 1 while reloading
  aimBlend = 0; // 0 = hip fire, 1 = fully aimed down sights
  bloom = 0; // extra spread from firing fast, in degrees
  /** Set when the trigger is pulled on an empty gun with nothing left to load. */
  dryFire = false;
  /** Drone Siege's suit mods: Overcharge speeds up firing, Rapid Cycler shortens reloads. */
  fireRateScale = 1;
  reloadScale = 1;

  private cooldown = 0; // seconds until the next shot (or burst) is allowed
  private reloadTimer = 0;
  private burstLeft = 0; // shots still to come in the current burst
  private burstTimer = 0;

  constructor(readonly spec: WeaponSpec) {
    this.ammo = spec.magazine;
    this.reserve = spec.reserve;
  }

  get aiming() {
    return this.aimBlend > 0.5;
  }

  /** Runs the trigger for one frame. Returns how many shots fired (usually 0 or 1). */
  // canFire is false while the gun is lowered (sprinting, switching) and still coming up.
  update(dt: number, input: Input, canFire = true): number {
    const spec = this.spec;
    this.dryFire = false;

    // Raise or lower the sights. No aiming during a reload.
    const wantsAim = input.isDown('Mouse2') && !this.reloading;
    this.aimBlend += ((wantsAim ? 1 : 0) - this.aimBlend) * Math.min(1, spec.adsSpeed * dt);

    this.bloom = Math.max(0, this.bloom - spec.spreadRecovery * dt);
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.reloading) {
      this.reloadTimer -= dt / this.reloadScale;
      this.reloadProgress = 1 - this.reloadTimer / spec.reloadTime;
      if (this.reloadTimer <= 0) this.finishReload();
      return 0;
    }

    if (input.wasPressed('KeyR') && this.canReload) {
      this.startReload();
      return 0;
    }

    // A burst keeps going once it has started, even if the trigger is let go.
    if (this.burstLeft > 0) return this.continueBurst(dt);

    const held = input.isDown('Mouse0');
    const pulled = input.wasPressed('Mouse0');
    if (!canFire || !(spec.fireMode === 'semi' ? pulled : held)) return 0;

    // Pulling the trigger on an empty magazine reloads it (or clicks, with no spares).
    if (this.ammo === 0) {
      if (this.canReload) this.startReload();
      else if (pulled) this.dryFire = true;
      return 0;
    }
    if (this.cooldown > 0) return 0;

    if (spec.fireMode === 'burst') {
      this.burstLeft = spec.burstCount;
      this.burstTimer = 0;
      this.cooldown = 1 / (spec.fireRate * this.fireRateScale);
      return this.continueBurst(dt);
    }

    // Full auto: holding the trigger fires at a steady rate. Counting shots in a loop
    // keeps the rate right even when a frame is slower than the gap between shots.
    let shots = 0;
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 1 / (spec.fireRate * this.fireRateScale);
      this.ammo--;
      shots++;
      if (spec.fireMode === 'semi') break;
    }
    this.bloom += shots * spec.spreadPerShot;
    return shots;
  }

  /** Current spread in degrees, given how the player is moving. */
  spread(horizontalSpeed: number, grounded: boolean) {
    const spec = this.spec;
    const base = THREE.MathUtils.lerp(spec.hipSpread, spec.adsSpread, this.aimBlend);
    const moving = spec.moveSpread * Math.min(1, horizontalSpeed / CONFIG.player.sprintSpeed);
    const air = grounded ? 0 : spec.airSpread;
    // Aiming steadies everything, not just the base spread.
    const steadiness = THREE.MathUtils.lerp(1, 0.3, this.aimBlend);
    return base + (moving + air + this.bloom) * steadiness;
  }

  /** Full magazine and spare ammo, sights down, ready for a new run. */
  reset() {
    this.ammo = this.spec.magazine;
    this.reserve = this.spec.reserve;
    this.reloading = false;
    this.reloadProgress = 0;
    this.aimBlend = 0;
    this.bloom = 0;
    this.cooldown = 0;
    this.burstLeft = 0;
  }

  /** A full magazine and full spare ammo (buying ammo at a station). */
  refill() {
    this.ammo = this.spec.magazine;
    this.reserve = this.spec.reserve;
  }

  /** Nothing to add: magazine and spares are both full. */
  get full() {
    return this.ammo === this.spec.magazine && this.reserve >= this.spec.reserve;
  }

  /** Put away mid-reload or mid-burst: those stop, and the sights come down. */
  holster() {
    this.reloading = false;
    this.reloadProgress = 0;
    this.burstLeft = 0;
    this.aimBlend = 0;
  }

  private get canReload() {
    return this.ammo < this.spec.magazine && this.reserve > 0;
  }

  private continueBurst(dt: number) {
    let shots = 0;
    this.burstTimer -= dt;
    while (this.burstLeft > 0 && this.burstTimer <= 0) {
      if (this.ammo === 0) {
        this.burstLeft = 0;
        break;
      }
      this.burstTimer += 1 / (this.spec.burstRate * this.fireRateScale);
      this.burstLeft--;
      this.ammo--;
      shots++;
    }
    this.bloom += shots * this.spec.spreadPerShot;
    return shots;
  }

  private startReload() {
    this.reloading = true;
    this.reloadTimer = this.spec.reloadTime;
    this.reloadProgress = 0;
  }

  // The magazine fills from the spare ammo (which never runs out on the range rifle).
  private finishReload() {
    this.reloading = false;
    const needed = this.spec.magazine - this.ammo;
    const loaded = Math.min(needed, this.reserve);
    this.ammo += loaded;
    if (Number.isFinite(this.reserve)) this.reserve -= loaded;
  }
}
