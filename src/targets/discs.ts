import * as THREE from 'three';
import { CONFIG } from '../config';
import type { HitResult } from './target';

// Shared pieces for the round bullseye face used by static and pop-up targets.

let faceMaterials: THREE.Material[] | null = null;

/** Materials for a disc: [edge, front face, back face]. Made once and shared. */
export function discMaterials() {
  if (!faceMaterials) {
    const edge = new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.8 });
    const face = new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.7 });
    faceMaterials = [edge, face, edge];
  }
  return faceMaterials;
}

/** A thin cylinder whose flat front faces +y. Rotate it to aim it. */
export function discGeometry() {
  const { discRadius, discThickness } = CONFIG.targets;
  return new THREE.CylinderGeometry(discRadius, discRadius, discThickness, 40);
}

/** Works out which ring a shot landed in. `localPoint` is in the disc's own space. */
export function scoreRing(localPoint: THREE.Vector3): HitResult {
  const t = CONFIG.targets;
  const fromCenter = Math.hypot(localPoint.x, localPoint.z) / t.discRadius;
  if (fromCenter <= t.bullseyeRadius) return { points: t.bullseyePoints, label: 'BULLSEYE', bullseye: true };
  if (fromCenter <= t.innerRadius) return { points: t.innerPoints, label: 'INNER', bullseye: false };
  return { points: t.outerPoints, label: 'OUTER', bullseye: false };
}

// The painted rings, drawn on a canvas so there's no image file.
// The canvas maps onto the cylinder's flat cap, center to center.
function ringTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const t = CONFIG.targets;

  const ring = (fraction: number, color: string) => {
    ctx.beginPath();
    ctx.arc(c, c, c * fraction, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  ring(1, '#ece6da'); // outer: soft white
  ring(0.8, '#d6cfc2'); // a faint line inside the outer ring
  ring(0.79, '#ece6da');
  ring(t.innerRadius, '#1c1b19'); // inner: near black
  ring(t.innerRadius - 0.02, '#2a2825');
  ring(t.bullseyeRadius + 0.02, '#ece6da'); // white edge around the bullseye
  ring(t.bullseyeRadius, '#ffa31a'); // bullseye: amber

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
