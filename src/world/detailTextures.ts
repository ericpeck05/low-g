import * as THREE from 'three';
import { fbm2D, seededRandom } from './noise';

// Seamless detail textures drawn in code, used by the world-space (triplanar) texturing.
// Each comes as a pair: `detail` multiplies the surface color (mid-gray = no change)
// and `height` adds small bumps (seams, rivets, grain) that catch the low sun.

export interface DetailPair {
  detail: THREE.Texture;
  height: THREE.Texture;
}

type Painter = (x: number, y: number, u: number, v: number) => [number, number]; // [detail 0-255, height 0-255]

function paint(size: number, painter: Painter): DetailPair {
  const detail = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [d, h] = painter(x, y, x / size, y / size);
      const i = (y * size + x) * 4;
      const dc = Math.max(0, Math.min(255, d));
      const hc = Math.max(0, Math.min(255, h));
      detail[i] = detail[i + 1] = detail[i + 2] = dc;
      height[i] = height[i + 1] = height[i + 2] = hc;
      detail[i + 3] = height[i + 3] = 255;
    }
  }
  const make = (data: Uint8Array) => {
    const texture = new THREE.DataTexture(data, size, size);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
  };
  return { detail: make(detail), height: make(height) };
}

const cache = new Map<string, DetailPair>();
function cached(name: string, build: () => DetailPair) {
  if (!cache.has(name)) cache.set(name, build());
  return cache.get(name)!;
}

/** Cladding panels, 1 m wide by 2 m tall, with seams, rivets and streaks. One tile = 4 m. */
export function panelDetail() {
  return cached('panel', () => {
    const size = 512;
    const random = seededRandom(41);
    const tones = Array.from({ length: 32 }, () => (random() - 0.5) * 22); // each panel slightly different
    return paint(size, (_x, _y, u, v) => {
      const col = Math.floor(u * 4);
      const row = Math.floor(v * 2);
      const px = (u * 4) % 1; // position inside this panel
      const py = (v * 2) % 1;
      const seam = Math.min(px, 1 - px) * 128 < 1.5 || Math.min(py, 1 - py) * 256 < 1.5;
      const rivet = [0.06, 0.94].some((rx) => [0.04, 0.5, 0.96].some((ry) => Math.hypot((px - rx) * 128, (py - ry) * 256) < 2.6));
      const grain = (fbm2D(u * 16, v * 16, 3, 3, 16) - 0.5) * 18;
      const streak = (fbm2D(u * 64, v * 2, 9, 2, 64) - 0.5) * 16 * (1 - py); // grime runs down from the top
      let d = 128 + tones[(row * 4 + col) % 32] + grain + streak;
      let h = 150 + grain * 0.5;
      if (seam) {
        d = 70;
        h = 30;
      } else if (rivet) {
        d -= 18;
        h = 235;
      }
      return [d, h];
    });
  });
}

/** Poured concrete: aggregate speckle, pores and faint formwork lines. One tile = 2 m. */
export function concreteDetail() {
  return cached('concrete', () => {
    const random = seededRandom(17);
    return paint(512, (_x, _y, u, v) => {
      const blotch = (fbm2D(u * 6, v * 6, 5, 4, 6) - 0.5) * 34;
      const speck = (random() - 0.5) * 26;
      const pore = random() < 0.004 ? -60 : 0;
      const form = Math.abs(((v * 2) % 1) - 0.5) < 0.004 ? -22 : 0; // a board line every meter
      return [128 + blotch + speck * 0.6 + pore + form, 140 + blotch + speck + pore * 1.5 + form * 2];
    });
  });
}

/** Brushed and lightly scuffed metal. One tile = 0.5 m. */
export function metalDetail() {
  return cached('metal', () => {
    const random = seededRandom(23);
    const rows = Array.from({ length: 256 }, () => (random() - 0.5) * 14); // brush marks run sideways
    return paint(256, (_x, y, u, v) => {
      const smudge = (fbm2D(u * 4, v * 4, 31, 3, 4) - 0.5) * 20;
      const brush = rows[y] + (random() - 0.5) * 6;
      return [128 + smudge + brush, 128 + brush * 0.6];
    });
  });
}

/** Rock: coarse grain, small cracks and pits. One tile = 1.2 m. */
export function rockDetail() {
  return cached('rock', () => {
    const random = seededRandom(57);
    return paint(512, (_x, _y, u, v) => {
      const coarse = fbm2D(u * 8, v * 8, 61, 5, 8);
      const crack = Math.abs(fbm2D(u * 5, v * 5, 67, 3, 5) - 0.5) < 0.012 ? 1 : 0; // thin dark fissures
      const grain = random();
      return [100 + coarse * 70 + (grain - 0.5) * 40 - crack * 45, coarse * 200 + grain * 40 - crack * 90];
    });
  });
}
