import { CONFIG } from '../config';
import type { HitResult } from './target';

// Keeps score for a run: points, accuracy and the combo multiplier.
// A combo is hits in a row; any shot that misses a target ends it.
export class Scoring {
  score = 0;
  shotsFired = 0;
  shotsHit = 0;
  combo = 0;
  bestCombo = 0;
  bullseyes = 0;

  get multiplier() {
    const { comboStep, maxMultiplier } = CONFIG.scoring;
    return Math.min(maxMultiplier, 1 + Math.floor(this.combo / comboStep));
  }

  /** Accuracy from 0 to 100, or null before the first shot. */
  get accuracy() {
    return this.shotsFired === 0 ? null : (this.shotsHit / this.shotsFired) * 100;
  }

  /** Records one shot. Returns the points earned (after the multiplier), or 0 for a miss. */
  recordShot(hit: HitResult | null) {
    this.shotsFired++;
    if (!hit) {
      this.combo = 0;
      return 0;
    }
    this.shotsHit++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (hit.bullseye) this.bullseyes++;
    const earned = hit.points * this.multiplier;
    this.score += earned;
    return earned;
  }

  reset() {
    this.score = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.bullseyes = 0;
  }
}
