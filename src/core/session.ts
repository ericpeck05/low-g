import { CONFIG } from '../config';

// The three ways to play:
//  range      - free practice, no timer
//  timeTrial  - 60 seconds, highest score wins
//  oxygenRun  - locked outside the dome; survive as long as you can by hitting targets for air
export type Mode = 'range' | 'timeTrial' | 'oxygenRun';

export const MODE_NAMES: Record<Mode, string> = {
  range: 'RANGE',
  timeTrial: 'TIME TRIAL',
  oxygenRun: 'OXYGEN RUN',
};

export type EndReason = 'timeUp' | 'oxygen';

// Tracks which mode is running, its clock, and whether it's over.
export class Session {
  state: 'menu' | 'playing' | 'results' = 'menu';
  mode: Mode = 'range';
  elapsed = 0; // seconds since the run started (paused time doesn't count)
  endReason: EndReason | null = null;

  start(mode: Mode) {
    this.mode = mode;
    this.state = 'playing';
    this.elapsed = 0;
    this.endReason = null;
  }

  /** Seconds left in a time trial, or null in modes without a countdown. */
  get timeLeft() {
    return this.mode === 'timeTrial' ? Math.max(0, CONFIG.scoring.timeTrialSeconds - this.elapsed) : null;
  }

  /** How much faster oxygen drains in this mode right now. */
  get drainScale() {
    if (this.mode !== 'oxygenRun') return 1;
    return 1 + (this.elapsed / 60) * CONFIG.oxygen.runDrainGrowthPerMinute;
  }

  /** Advances the clock. Returns true on the frame a time trial runs out. */
  update(dt: number) {
    if (this.state !== 'playing') return false;
    this.elapsed += dt;
    if (this.timeLeft === 0) {
      this.end('timeUp');
      return true;
    }
    return false;
  }

  end(reason: EndReason) {
    this.state = 'results';
    this.endReason = reason;
  }
}
