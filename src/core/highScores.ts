import type { Mode } from './session';

// Best results for each mode, saved in this browser only (localStorage).
// Range and Time Trial keep the best score; Oxygen Run keeps the longest survival time;
// Drone Siege keeps the highest round reached.

const KEY = 'lowg.highScores.v1';

export type HighScores = Record<Mode, number>;

const EMPTY: HighScores = { range: 0, timeTrial: 0, oxygenRun: 0, siege: 0 };

// Drone Siege's record is saved as "siegeRound". (Its first test version saved drone
// counts as "siege"; those are ignored rather than shown as rounds.)
const SIEGE_KEY = 'siegeRound';

export function loadHighScores(): HighScores {
  // Storage can be blocked (private windows, strict settings): fall back to no records.
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...EMPTY, ...saved, siege: saved[SIEGE_KEY] ?? 0 };
  } catch {
    return { ...EMPTY };
  }
}

/** Records a result. Returns true if it beat the old best. */
export function submitHighScore(mode: Mode, value: number): boolean {
  const scores = loadHighScores();
  if (value <= scores[mode]) return false;
  scores[mode] = value;
  const { siege, ...others } = scores;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...others, [SIEGE_KEY]: siege }));
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
