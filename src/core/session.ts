import { CONFIG } from '../config';
import type { Mode } from '../ui/menu';

// Tracks which mode is running and, for the time trial, how much time is left.
export class Session {
  state: 'menu' | 'playing' | 'results' = 'menu';
  mode: Mode = 'practice';
  timeLeft: number | null = null; // null means no timer

  start(mode: Mode) {
    this.mode = mode;
    this.state = 'playing';
    this.timeLeft = mode === 'timeTrial' ? CONFIG.scoring.timeTrialSeconds : null;
  }

  /** Counts the timer down. Returns true on the frame the time runs out. */
  update(dt: number) {
    if (this.state !== 'playing' || this.timeLeft === null) return false;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft === 0) {
      this.state = 'results';
      return true;
    }
    return false;
  }
}
