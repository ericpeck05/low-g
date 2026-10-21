import * as THREE from 'three';

let shared: THREE.CanvasTexture | null = null;

/**
 * A soft round glow (white, bright in the middle and fading to nothing at the edge),
 * tinted by whatever uses it: drone halos, spawn point flares, explosion flashes.
 * Made once and shared.
 */
export function glowTexture() {
  if (shared) return shared;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  shared = new THREE.CanvasTexture(canvas);
  return shared;
}
