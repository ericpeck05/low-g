import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { seededRandom } from '../noise';

// Shared building blocks for the city: materials, procedural textures, and
// helpers that add a mesh and its matching collider in one call.

const AMBER = 0xffa31a;

export const MATERIALS = {
  concrete: new THREE.MeshStandardMaterial({ color: 0xb4ada2, roughness: 0.9 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3835, roughness: 0.6, metalness: 0.3 }),
  lightPanel: new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.7 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x5c5853, roughness: 0.7 }),
  // Glowing materials: their emissive brightness is above the bloom threshold.
  amberLight: new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 1.6 }),
  whiteLight: new THREE.MeshStandardMaterial({ color: 0xfff3e0, emissive: 0xfff3e0, emissiveIntensity: 1.4 }),
  // Just at the bloom threshold: reads as a light without glaring up close (ceiling panels).
  softLight: new THREE.MeshStandardMaterial({ color: 0xfff3e0, emissive: 0xfff3e0, emissiveIntensity: 0.95 }),
  orangeLight: new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff6a1a, emissiveIntensity: 1.8 }),
};

type Vec3 = { x: number; y: number; z: number };

/** A solid box: mesh plus collider. `center` is the middle of the box. */
export function solidBox(
  parent: THREE.Object3D,
  world: RAPIER.World,
  center: Vec3,
  size: Vec3,
  material: THREE.Material | THREE.Material[],
  rotationY = 0,
  collide = true,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(center.x, center.y, center.z);
  mesh.rotation.y = rotationY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  if (collide) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(center.x, center.y, center.z)
        .setRotation(mesh.quaternion),
    );
  }
  return mesh;
}

/** A box tilted by a full rotation (for ramps and solar panels). */
export function solidTiltedBox(
  parent: THREE.Object3D,
  world: RAPIER.World,
  center: THREE.Vector3,
  size: Vec3,
  rotation: THREE.Euler,
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.copy(center);
  mesh.rotation.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setRotation(mesh.quaternion),
  );
  return mesh;
}

/** A solid upright cylinder. `sides` = 6 makes a hexagon. `bottom` is the y of its base. */
export function solidCylinder(
  parent: THREE.Object3D,
  world: RAPIER.World,
  x: number,
  bottom: number,
  z: number,
  radius: number,
  height: number,
  material: THREE.Material | THREE.Material[],
  sides = 24,
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, sides), material);
  mesh.position.set(x, bottom + height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  // For few-sided shapes, use the exact outline so you can stand on the corners.
  const desc =
    sides <= 8
      ? RAPIER.ColliderDesc.convexHull(prismPoints(radius, height, sides))!
      : RAPIER.ColliderDesc.cylinder(height / 2, radius);
  world.createCollider(desc.setTranslation(x, bottom + height / 2, z));
  return mesh;
}

/** A solid cylinder lying between two points (tubes, modules). */
export function solidTube(
  parent: THREE.Object3D,
  world: RAPIER.World,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
  material: THREE.Material | THREE.Material[],
) {
  const length = from.distanceTo(to);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 24), material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  // Cylinders point up the y axis; turn it to run from `from` to `to`.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setRotation(mesh.quaternion),
  );
  return mesh;
}

/** A glowing strip or block with no collision. */
export function lightStrip(parent: THREE.Object3D, center: Vec3, size: Vec3, material = MATERIALS.amberLight, rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(center.x, center.y, center.z);
  mesh.rotation.y = rotationY;
  parent.add(mesh);
  return mesh;
}

function prismPoints(radius: number, height: number, sides: number) {
  const points: number[] = [];
  for (let i = 0; i < sides; i++) {
    // Match three.js cylinder corner positions.
    const angle = (i / sides) * Math.PI * 2;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    points.push(x, -height / 2, z, x, height / 2, z);
  }
  return new Float32Array(points);
}

/**
 * A tower facade: dark wall with rows of windows, some lit warm white or amber.
 * Returns a color map and a glow map; the glow map makes lit windows bloom.
 */
export function windowTextures(seed: number) {
  const w = 256;
  const h = 512;
  const color = document.createElement('canvas');
  const glow = document.createElement('canvas');
  color.width = glow.width = w;
  color.height = glow.height = h;
  const c = color.getContext('2d')!;
  const g = glow.getContext('2d')!;
  const random = seededRandom(seed);

  c.fillStyle = '#4a4744';
  c.fillRect(0, 0, w, h);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);

  const cols = 4;
  const rows = 8;
  const cw = w / cols;
  const rh = h / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw + cw * 0.12;
      const y = row * rh + rh * 0.22;
      const ww = cw * 0.76;
      const wh = rh * 0.5;
      const roll = random();
      c.fillStyle = '#1e1d1b'; // dark glass
      c.fillRect(x, y, ww, wh);
      if (roll < 0.55) {
        const lit = roll < 0.12 ? '#ffa31a' : roll < 0.4 ? '#ffe8c4' : '#b89a70';
        c.fillStyle = lit;
        c.fillRect(x, y, ww, wh);
        g.fillStyle = lit;
        g.fillRect(x, y, ww, wh);
      }
    }
    // A thin floor line between stories.
    c.fillStyle = '#5c5853';
    c.fillRect(0, row * rh, w, 3);
  }
  const map = new THREE.CanvasTexture(color);
  const emissiveMap = new THREE.CanvasTexture(glow);
  for (const t of [map, emissiveMap]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  return { map, emissiveMap };
}

/** Pale concrete paving in 2 m squares, with seams. Tiles seamlessly. */
export function pavingTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const random = seededRandom(5);
  const tiles = 4;
  const t = size / tiles;
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const shade = 128 + Math.floor(random() * 20);
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      ctx.fillRect(x * t, y * t, t, t);
    }
  }
  ctx.strokeStyle = 'rgb(96,92,86)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= tiles; i++) {
    ctx.beginPath();
    ctx.moveTo(i * t, 0);
    ctx.lineTo(i * t, size);
    ctx.moveTo(0, i * t);
    ctx.lineTo(size, i * t);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}
