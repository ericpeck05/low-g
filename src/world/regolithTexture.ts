import * as THREE from 'three';
import { fbm2D, seededRandom } from './noise';

// Moon dust (regolith), drawn on a canvas so there are no image files.
// Two textures: a color map (fine gray grain) and a bump map (tiny pits and
// pebbles that catch the low sun). Both tile seamlessly.
export function regolithTextures() {
  const size = 512;
  const period = 8; // noise cells across the texture; whole numbers tile cleanly
  const color = makeCanvas(size);
  const bump = makeCanvas(size);
  const colorPixels = color.ctx.createImageData(size, size);
  const bumpPixels = bump.ctx.createImageData(size, size);
  const random = seededRandom(11);

  // A list of small pits, drawn into the bump map as dents.
  const pits = Array.from({ length: 90 }, () => ({
    x: random() * size,
    y: random() * size,
    r: 2 + random() ** 3 * 14,
  }));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      const broad = fbm2D(u, v, 21, 5, period); // soft blotches
      const grain = random(); // salt-and-pepper speckle of dust grains
      const gray = 118 + broad * 70 + (grain - 0.5) * 34;

      let height = broad * 150 + grain * 50;
      for (const pit of pits) {
        // Distance that wraps around the edges, so pits tile too.
        const dx = Math.min(Math.abs(x - pit.x), size - Math.abs(x - pit.x));
        const dy = Math.min(Math.abs(y - pit.y), size - Math.abs(y - pit.y));
        const d = Math.hypot(dx, dy) / pit.r;
        if (d < 1.4) height += d < 1 ? -60 * (1 - d * d) : 25 * (1.4 - d); // dent with a small lip
      }

      const i = (y * size + x) * 4;
      colorPixels.data.set([gray, gray * 0.985, gray * 0.95, 255], i);
      const b = THREE.MathUtils.clamp(height, 0, 255);
      bumpPixels.data.set([b, b, b, 255], i);
    }
  }
  color.ctx.putImageData(colorPixels, 0, 0);
  bump.ctx.putImageData(bumpPixels, 0, 0);

  const map = new THREE.CanvasTexture(color.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bump.canvas);
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8; // keeps the ground sharp at shallow viewing angles
  }
  return { map, bumpMap };
}

function makeCanvas(size: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d')! };
}
