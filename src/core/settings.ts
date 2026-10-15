import { CONFIG } from '../config';

// Player settings, saved in this browser (localStorage) so they stick between visits.

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number; // radians of turn per pixel of mouse movement
  fov: number; // degrees, vertical field of view when not aiming
  volume: number; // 0 to 1
  quality: Quality;
  showStats: boolean; // the F3 overlay: frame rate and movement numbers
}

// What each graphics quality level turns on. "medium" is the target for a normal laptop.
export const QUALITY_PRESETS: Record<Quality, { label: string; note: string; maxPixelRatio: number; ambientOcclusion: boolean; shadowMapSize: number; antialiasSamples: number; rockDistance: number }> = {
  low: { label: 'LOW', note: 'Lower resolution, smaller shadows, no corner shading', maxPixelRatio: 0.75, ambientOcclusion: false, shadowMapSize: 2048, antialiasSamples: 0, rockDistance: 0.5 },
  medium: { label: 'MEDIUM', note: 'Full resolution, sharp shadows, no corner shading', maxPixelRatio: 1, ambientOcclusion: false, shadowMapSize: 4096, antialiasSamples: 4, rockDistance: 1 },
  high: { label: 'HIGH', note: 'Sharpest image and soft corner shading (ambient occlusion)', maxPixelRatio: 2, ambientOcclusion: true, shadowMapSize: 4096, antialiasSamples: 4, rockDistance: 1.3 },
};

const DEFAULTS: Settings = {
  sensitivity: CONFIG.look.sensitivity,
  fov: CONFIG.camera.fov,
  volume: 0.8,
  quality: 'high',
  showStats: false,
};

export const LIMITS = {
  sensitivity: { min: CONFIG.look.sensitivityMin, max: CONFIG.look.sensitivityMax },
  fov: { min: 60, max: 100 },
};

const KEY = 'lowg.settings.v1';
type Listener = (settings: Settings) => void;

class SettingsStore {
  private values: Settings = load();
  private listeners: Listener[] = [];

  get(): Readonly<Settings> {
    return this.values;
  }

  /** Change some settings, save them, and tell everyone listening. */
  set(changes: Partial<Settings>) {
    this.values = { ...this.values, ...changes };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      // Storage blocked: the change still applies for this visit.
    }
    for (const listener of this.listeners) listener(this.values);
  }

  reset() {
    this.set({ ...DEFAULTS });
  }

  /** Calls `listener` now and after every change. */
  watch(listener: Listener) {
    this.listeners.push(listener);
    listener(this.values);
  }
}

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const merged = { ...DEFAULTS, ...saved };
    if (!(merged.quality in QUALITY_PRESETS)) merged.quality = DEFAULTS.quality;
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = new SettingsStore();
