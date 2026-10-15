// Small, dependable random-number and noise helpers for building the world.
// Everything takes a seed, so the same seed always builds the same landscape.

/** A seeded random number generator (mulberry32). Returns numbers from 0 to 1. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A repeatable "random" value for each whole-number grid point.
function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Smoothstep curve so values blend without visible creases.
const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smooth 2D noise from 0 to 1. `period` makes it repeat every that many units,
 * which lets a texture tile without seams.
 */
export function valueNoise2D(x: number, y: number, seed: number, period = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const wrap = (n: number) => (period > 0 ? ((n % period) + period) % period : n);
  const v = (ix: number, iy: number) => hash(wrap(ix), wrap(iy), 0, seed);
  return lerp(lerp(v(x0, y0), v(x0 + 1, y0), tx), lerp(v(x0, y0 + 1), v(x0 + 1, y0 + 1), tx), ty);
}

/** Smooth 3D noise from 0 to 1. Used for wrapping patterns around a sphere (the Earth). */
export function valueNoise3D(x: number, y: number, z: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  const v = (ix: number, iy: number, iz: number) => hash(ix, iy, iz, seed);
  const layer = (iz: number) =>
    lerp(lerp(v(x0, y0, iz), v(x0 + 1, y0, iz), tx), lerp(v(x0, y0 + 1, iz), v(x0 + 1, y0 + 1, iz), tx), ty);
  return lerp(layer(z0), layer(z0 + 1), tz);
}

/**
 * "Fractal" noise: several layers of noise, each finer and fainter than the last.
 * Gives natural-looking detail. Returns roughly 0 to 1.
 */
export function fbm2D(x: number, y: number, seed: number, octaves: number, period = 0) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise2D(x * frequency, y * frequency, seed + i * 31, period * frequency) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / max;
}

export function fbm3D(x: number, y: number, z: number, seed: number, octaves: number) {
  let total = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += valueNoise3D(x * frequency, y * frequency, z * frequency, seed + i * 31) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / max;
}
