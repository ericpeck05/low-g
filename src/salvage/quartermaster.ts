import { CONFIG } from '../config';

// The Quartermaster: Salvage Run's progress from one run to the next. Everything you bank
// adds to a lifetime total (plus a share of what you lose out there, as insurance), and
// the total unlocks perks that every later run starts with. Saved in this browser only.

const KEY = 'lowg.salvage.v1';

export type PerkId = 'tank' | 'thruster' | 'smg' | 'scanner' | 'medic';

/** The perks, in the order they unlock (at CONFIG.salvage.quartermaster's totals). */
export const PERKS: { id: PerkId; name: string; blurb: string }[] = [
  { id: 'tank', name: 'BIG TANK', blurb: 'OXYGEN +30%' },
  { id: 'thruster', name: 'THRUSTER MK II', blurb: 'BIGGER JETPACK, FASTER REFILL' },
  { id: 'smg', name: 'PLASMA SMG', blurb: 'START WITH A THIRD GUN' },
  { id: 'scanner', name: 'SCANNER', blurb: 'CACHE VALUES ON THE COMPASS' },
  { id: 'medic', name: 'AUTO-MEDIC', blurb: 'GET BACK UP ONCE A RUN' },
];

export interface SalvageRecord {
  lifetime: number; // salvage counted toward the Quartermaster, over every run
  runs: number;
}

export function loadRecord(): SalvageRecord {
  // Storage can be blocked (private windows, strict settings): start from nothing.
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { lifetime: Number(saved.lifetime) || 0, runs: Number(saved.runs) || 0 };
  } catch {
    return { lifetime: 0, runs: 0 };
  }
}

/** How many perks a lifetime total has unlocked (0 to 5). */
export function quartermasterLevel(lifetime: number) {
  return CONFIG.salvage.quartermaster.filter((needed) => lifetime >= needed).length;
}

export function hasPerk(lifetime: number, id: PerkId) {
  return PERKS.findIndex((p) => p.id === id) < quartermasterLevel(lifetime);
}

/** The next perk to unlock and the total it needs, or null once they're all yours. */
export function nextPerk(lifetime: number) {
  const level = quartermasterLevel(lifetime);
  if (level >= PERKS.length) return null;
  return { perk: PERKS[level], needed: CONFIG.salvage.quartermaster[level] };
}

/** Add a finished run to the record. Returns the totals before and after, and any perks it unlocked. */
export function recordRun(banked: number, lost: number) {
  const before = loadRecord();
  const counted = banked + Math.floor(lost * CONFIG.salvage.insurance);
  const after = { lifetime: before.lifetime + counted, runs: before.runs + 1 };
  try {
    localStorage.setItem(KEY, JSON.stringify(after));
  } catch {
    // Couldn't save; the results still show what this run earned.
  }
  const unlocked = PERKS.slice(quartermasterLevel(before.lifetime), quartermasterLevel(after.lifetime));
  return { before, after, counted, unlocked };
}

/** Forget the Quartermaster's record (with the other saved results). */
export function clearRecord() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing saved to clear.
  }
}
