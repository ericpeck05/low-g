import { CONFIG } from '../config';

// The suit's air supply. It drains on the surface (vacuum) and refills under
// the dome. When it hits zero, the run is over.
export class Oxygen {
  level = CONFIG.oxygen.max;

  /** Returns true on the frame the tank runs dry. `drainScale` speeds up the drain. */
  update(dt: number, inside: boolean, drainScale = 1) {
    const cfg = CONFIG.oxygen;
    if (this.level <= 0) return false; // already empty; reported once
    if (inside) {
      this.level = Math.min(cfg.max, this.level + cfg.refillRate * dt);
      return false;
    }
    this.level = Math.max(0, this.level - cfg.drainRate * drainScale * dt);
    return this.level === 0;
  }

  reward(amount: number) {
    if (this.level <= 0) return;
    this.level = Math.min(CONFIG.oxygen.max, this.level + amount);
  }

  get fraction() {
    return this.level / CONFIG.oxygen.max;
  }

  get low() {
    return this.level < CONFIG.oxygen.lowWarning;
  }

  reset() {
    this.level = CONFIG.oxygen.max;
  }
}
