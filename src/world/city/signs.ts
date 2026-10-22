import * as THREE from 'three';

// Lit signs with words on them ("HYDROPONICS", "AIRLOCK N"...). Every sign's text is
// drawn into one shared texture, one line per sign, so all the signs in the city are a
// single material and get merged into a single draw.

const WIDTH = 1024;
const ROW = 64; // pixels per sign
const ROWS = 32;

const AMBER = '#ffa31a';
const WHITE = '#fff1dc';

let canvas: HTMLCanvasElement | null = null;
let material: THREE.MeshStandardMaterial | null = null;
let used = 0;

function atlas() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = ROW * ROWS;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    material = new THREE.MeshStandardMaterial({
      color: 0x111110,
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 2.2,
    });
  }
  return { canvas, material: material! };
}

/** The shared material for every sign (Drone Siege dims it while the power is off). */
export function signMaterial() {
  return atlas().material;
}

/**
 * A flat lit sign `height` meters tall, as wide as its words need (plus `pad` letter
 * widths of dark panel at each end). Faces +z; place and turn it like any mesh.
 */
export function signPanel(text: string, height: number, color: 'amber' | 'white' = 'amber', pad = 1) {
  const { canvas, material } = atlas();
  const row = used++ % ROWS;
  const ctx = canvas.getContext('2d')!;
  const y = row * ROW;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, y, WIDTH, ROW);
  ctx.fillStyle = color === 'amber' ? AMBER : WHITE;
  ctx.font = 'bold 40px "SF Mono", Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // Spread the letters out a little, like real signage.
  const spaced = text.toUpperCase().split('').join('\u200a');
  ctx.fillText(spaced, WIDTH / 2, y + ROW / 2 + 2, WIDTH - 48);
  (material.emissiveMap as THREE.CanvasTexture).needsUpdate = true;

  // Use only the middle of the line, where the words are.
  const letter = ctx.measureText('M').width;
  const span = Math.min(WIDTH, ctx.measureText(spaced).width + letter * pad * 2);
  const u0 = 0.5 - span / WIDTH / 2;
  const u1 = 0.5 + span / WIDTH / 2;
  const geometry = new THREE.PlaneGeometry((height * span) / ROW, height);
  // Point the UVs at this sign's piece of the shared texture (canvas rows run top down).
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const top = 1 - row / ROWS;
  const bottom = 1 - (row + 1) / ROWS;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) > 0.5 ? u1 : u0, uv.getY(i) > 0.5 ? top : bottom);
  return new THREE.Mesh(geometry, material);
}
