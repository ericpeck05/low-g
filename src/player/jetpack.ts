import { CONFIG } from '../config';

// Tracks jetpack fuel. Burns while thrusting, recharges after a short time on the ground.
export class Jetpack {
  fuel = CONFIG.jetpack.maxFuel;
  thrusting = false;
  /** The tank's size and how fast it refills (Drone Siege's Thruster Mk II raises both). */
  capacity: number = CONFIG.jetpack.maxFuel;
  rechargeScale = 1;
  private timeOnGround = 0;

  update(dt: number, grounded: boolean, wantsThrust: boolean) {
    const cfg = CONFIG.jetpack;
    this.thrusting = wantsThrust && !grounded && this.fuel > 0;

    if (this.thrusting) {
      this.fuel = Math.max(0, this.fuel - cfg.burnRate * dt);
    }

    this.timeOnGround = grounded ? this.timeOnGround + dt : 0;
    if (this.timeOnGround > cfg.rechargeDelay) {
      this.fuel = Math.min(this.capacity, this.fuel + cfg.rechargeRate * this.rechargeScale * dt);
    }
  }

  get fraction() {
    return this.fuel / this.capacity;
  }
}
