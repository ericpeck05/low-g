import { CONFIG } from '../config';

// The suit's air supply. It drains on the surface (vacuum) and refills under
// the dome. When it hits zero, the run is over.
export class Oxygen {
  level = CONFIG.oxygen.max;
  /** The tank's size (Salvage Run's Quartermaster can make it bigger). */
  capacity: number = CONFIG.oxygen.max;

  /** Returns true on the frame the tank runs dry. `drainScale` speeds up the drain. */
  update(dt: number, inside: boolean, drainScale = 1) {
    const cfg = CONFIG.oxygen;
    if (this.level <= 0) return false; // already empty; reported once
    if (inside) {
      this.level = Math.min(this.capacity, this.level + cfg.refillRate * dt);
      return false;
    }
    this.level = Math.max(0, this.level - cfg.drainRate * drainScale * dt);
    return this.level === 0;
  }

  reward(amount: number) {
    if (this.level <= 0) return;
    this.level = Math.min(this.capacity, this.level + amount);
  }

  get fraction() {
    return this.level / this.capacity;
  }

  get low() {
    return this.level < CONFIG.oxygen.lowWarning;
  }

  reset() {
    this.level = this.capacity;
  }
}
