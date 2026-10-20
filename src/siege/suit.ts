import { CONFIG } from '../config';

// Suit integrity: your health in Drone Siege. Plasma hits wear it down; after a few
// seconds without being hit, the suit's self-sealing layers repair it.
export class Suit {
  integrity: number = CONFIG.siege.suit.max;
  private calm = Infinity; // seconds since the last hit

  get max() {
    return CONFIG.siege.suit.max;
  }

  get fraction() {
    return this.integrity / this.max;
  }

  /** Low enough to crack the visor and sound the alarm. */
  get low() {
    return this.integrity < CONFIG.siege.suit.lowWarning;
  }

  /** Repairing itself right now. */
  get repairing() {
    return this.calm > CONFIG.siege.suit.regenDelay && this.integrity < this.max && this.integrity > 0;
  }

  reset() {
    this.integrity = this.max;
    this.calm = Infinity;
  }

  /** Take a hit. Returns true if it broke the suit. */
  damage(amount: number) {
    if (this.integrity <= 0) return false;
    this.integrity = Math.max(0, this.integrity - amount);
    this.calm = 0;
    return this.integrity <= 0;
  }

  update(dt: number) {
    this.calm += dt;
    if (this.repairing) this.integrity = Math.min(this.max, this.integrity + CONFIG.siege.suit.regenRate * dt);
  }
}
