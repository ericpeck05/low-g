import type { Mode } from './session';

// Best results for each mode, saved in this browser only (localStorage).
// Range and Time Trial keep the best score; Oxygen Run keeps the longest survival time.

const KEY = 'lowg.highScores.v1';

export type HighScores = Record<Mode, number>;

const EMPTY: HighScores = { range: 0, timeTrial: 0, oxygenRun: 0 };

export function loadHighScores(): HighScores {
  // Storage can be blocked (private windows, strict settings): fall back to no records.
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...EMPTY, ...saved };
  } catch {
    return { ...EMPTY };
  }
}

/** Records a result. Returns true if it beat the old best. */
export function submitHighScore(mode: Mode, value: number): boolean {
  const scores = loadHighScores();
  if (value <= scores[mode]) return false;
  scores[mode] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(scores));
  } catch {
    // Couldn't save; the result still counts for this screen.
  }
  return true;
}

/** "1:23" style time from seconds. */
export function formatTime(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Forget every saved best result. */
export function clearHighScores() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing saved to clear.
  }
}
