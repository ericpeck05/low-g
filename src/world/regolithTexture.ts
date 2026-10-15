import * as THREE from 'three';
import { fbm2D, seededRandom } from './noise';

// Moon dust (regolith), made in code: a color map and a normal map covering 8 m.
// The surface is pocked with tiny craters and strewn with pebbles at every scale,
// so up close it catches the low sun like the real thing. Both tile seamlessly.
export function regolithTextures() {
  const size = 1024;
  const random = seededRandom(11);
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);

  // Base: soft undulation plus fine grain.
  const period = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * period;
      const v = (y / size) * period;
      const broad = fbm2D(u, v, 21, 4, period);
      const grain = random();
      height[y * size + x] = broad * 1.4 + grain * 0.25;
      tone[y * size + x] = 0.92 + (broad - 0.5) * 0.25 + (grain - 0.5) * 0.12;
    }
  }

  // Stamp a shape into the maps, wrapping around the edges so it tiles.
  const stamp = (cx: number, cy: number, r: number, fn: (d: number) => [number, number]) => {
    const reach = Math.ceil(r * 2.2);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 2.2) continue;
        const x = (((Math.round(cx) + dx) % size) + size) % size;
        const y = (((Math.round(cy) + dy) % size) + size) % size;
        const [dh, dt] = fn(d);
        height[y * size + x] += dh;
        tone[y * size + x] += dt;
      }
    }
  };

  // Micro-craters: a dent with a raised lip. Many small, a few larger.
  for (let i = 0; i < 260; i++) {
    const r = 2 + Math.pow(random(), 3) * 40;
    const depth = r * 0.09;
    stamp(random() * size, random() * size, r, (d) => {
      if (d < 1) return [depth * (d * d - 1) + depth * 0.25 * d ** 6, -0.03];
      return [depth * 0.25 * Math.pow(d, -4) * Math.max(0, (2.2 - d) / 1.2), 0.02];
    });
  }
  // Pebbles and clods: small bumps, a little lighter than the dust.
  for (let i = 0; i < 900; i++) {
    const r = 1 + Math.pow(random(), 2.5) * 6;
    const lift = r * (0.4 + random() * 0.5);
    const shade = 0.04 + random() * 0.12;
    stamp(random() * size, random() * size, r, (d) => (d < 1 ? [lift * Math.sqrt(1 - d * d), shade] : [0, 0]));
  }

  // Color: neutral gray, a hint warm.
  const colorData = new Uint8Array(size * size * 4);
  let total = 0;
  for (let i = 0; i < size * size; i++) {
    const g = THREE.MathUtils.clamp(tone[i] * 140, 0, 255);
    colorData.set([g, g * 0.985, g * 0.955, 255], i * 4);
    total += g;
  }
  // Normal map from the height slopes.
  const normalData = new Uint8Array(size * size * 4);
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x - 1 + size) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const d = height[((y - 1 + size) % size) * size + x];
      const u = height[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      normalData.set([((nx / len) * 0.5 + 0.5) * 255, ((ny / len) * 0.5 + 0.5) * 255, ((1 / len) * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
    }
  }

  const map = new THREE.DataTexture(colorData, size, size);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.DataTexture(normalData, size, size);
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 8; // keeps the ground sharp at shallow viewing angles
    texture.needsUpdate = true;
  }
  // The average brightness (as the shader will see it, after sRGB decoding) for the tiling fix.
  const averageBrightness = Math.pow(total / (size * size) / 255, 2.2);
  return { map, normalMap, averageBrightness };
}
