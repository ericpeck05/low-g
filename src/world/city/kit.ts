import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchTriplanar } from '../../core/materialPatches';
import { concreteDetail, metalDetail, panelDetail } from '../detailTextures';
import { fbm2D, seededRandom } from '../noise';

// Shared building blocks for the city: materials, procedural textures, and
// helpers that add a mesh and its matching collider in one call.

const AMBER = 0xffa31a;

export const MATERIALS = {
  concrete: new THREE.MeshStandardMaterial({ color: 0xb4ada2, roughness: 0.92 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3835, roughness: 0.45, metalness: 0.75 }),
  lightPanel: new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.55, metalness: 0.1 }),
  trim: new THREE.MeshStandardMaterial({ color: 0x5c5853, roughness: 0.6, metalness: 0.3 }),
  // Glowing materials: their emissive brightness is above the bloom threshold.
  amberLight: new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER, emissiveIntensity: 1.6 }),
  whiteLight: new THREE.MeshStandardMaterial({ color: 0xfff3e0, emissive: 0xfff3e0, emissiveIntensity: 1.4 }),
  // Just at the bloom threshold: reads as a light without glaring up close (ceiling panels).
  // Gold-amber thermal foil, crinkled, like the wrapping on real landers.
  foil: new THREE.MeshStandardMaterial({ color: 0xd9a64e, metalness: 1, roughness: 0.32, normalMap: foilNormals(), normalScale: new THREE.Vector2(1.4, 1.4) }),
  softLight: new THREE.MeshStandardMaterial({ color: 0xfff3e0, emissive: 0xfff3e0, emissiveIntensity: 0.95 }),
  orangeLight: new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff6a1a, emissiveIntensity: 1.8 }),
  // Building skins: warm white composite cladding, graphite panels, and bronze fins.
  facade: new THREE.MeshStandardMaterial({ color: 0xe4ded3, roughness: 0.48, metalness: 0.05 }),
  graphite: new THREE.MeshStandardMaterial({ color: 0x34322f, roughness: 0.42, metalness: 0.55 }),
  bronze: new THREE.MeshStandardMaterial({ color: 0x7a6043, roughness: 0.34, metalness: 0.85 }),
  // A dark recess with no light of its own (behind louvres, inside openings).
  shadow: new THREE.MeshStandardMaterial({ color: 0x0b0b0a, roughness: 0.9 }),
};

type Vec3 = { x: number; y: number; z: number };

// Real surfaces: world-space panel seams, concrete grain and brushed metal, plus
// lunar dust on everything outside the dome (low down and on top surfaces).
patchTriplanar(MATERIALS.concrete, { ...concreteDetail(), metersPerTile: 2, bumpScale: 0.6, dust: 1 });
patchTriplanar(MATERIALS.lightPanel, { ...panelDetail(), metersPerTile: 4, bumpScale: 1.2, dust: 1 });
patchTriplanar(MATERIALS.trim, { ...panelDetail(), metersPerTile: 4, bumpScale: 1.0, dust: 1 });
patchTriplanar(MATERIALS.darkMetal, { ...metalDetail(), metersPerTile: 0.5, bumpScale: 0.3, dust: 0.7 });
patchTriplanar(MATERIALS.facade, { ...panelDetail(), metersPerTile: 4, bumpScale: 1.1, dust: 1 });
patchTriplanar(MATERIALS.graphite, { ...panelDetail(), metersPerTile: 4, bumpScale: 0.9, dust: 0.8 });
patchTriplanar(MATERIALS.bronze, { ...metalDetail(), metersPerTile: 0.6, bumpScale: 0.25, dust: 0.6 });

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
  prismCollider(world, x, bottom, z, radius, height, sides);
  return mesh;
}

/** Just the collision for an upright prism or cylinder (see solidCylinder). */
export function prismCollider(world: RAPIER.World, x: number, bottom: number, z: number, radius: number, height: number, sides = 24) {
  // For few-sided shapes, use the exact outline so you can stand on the corners.
  const desc =
    sides <= 8
      ? RAPIER.ColliderDesc.convexHull(prismPoints(radius, height, sides))!
      : RAPIER.ColliderDesc.cylinder(height / 2, radius);
  return world.createCollider(desc.setTranslation(x, bottom + height / 2, z));
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

/** Where one copy of a repeated prop goes: its center, and optionally its turn and tilt. */
export interface Placement {
  position: Vec3;
  rotation?: THREE.Euler;
}

/**
 * Many copies of one shape drawn as a single batch (an InstancedMesh): the graphics card
 * gets the shape once, plus a list of where each copy goes. Used for repeated props like
 * solar panels and lamps. No collision; add colliders separately where needed.
 */
export function instanced(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
  castShadow = true,
) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  placements.forEach(({ position, rotation: euler }, i) => {
    rotation.setFromEuler(euler ?? new THREE.Euler());
    matrix.compose(new THREE.Vector3(position.x, position.y, position.z), rotation, one);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.computeBoundingSphere(); // around all the copies, so the batch is culled as a whole
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** An invisible solid box: collision only (for props drawn with `instanced`). */
export function boxCollider(world: RAPIER.World, center: Vec3, size: Vec3, rotation = new THREE.Euler()) {
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setRotation(new THREE.Quaternion().setFromEuler(rotation)),
  );
}

/**
 * Combines every static mesh under `root` that shares a material into one mesh.
 * Hundreds of separate boxes become a handful of draws, which matters because each
 * one is drawn again for the shadow map and ambient occlusion every frame.
 * Skips moving or color-changing parts (userData.dynamic), meshes built as one batch
 * already (userData.merged), see-through glass,
 * instanced meshes, and meshes with several materials.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>();
  const merged: THREE.Mesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.dynamic || mesh.userData.merged) return;
    if (Array.isArray(mesh.material) || mesh.material.transparent) return;
    const key = `${mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key, { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] });
    let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    buckets.get(key)!.parts.push(geometry);
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  for (const { material, cast, receive, parts } of buckets.values()) {
    const geometry = mergeGeometries(parts);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    root.add(mesh);
  }
  return { before: merged.length, after: buckets.size };
}

/** Crinkle creases for thermal foil, as a normal map. */
function foilNormals() {
  const size = 256;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 6;
      const v = (y / size) * 6;
      // Sharp ridges where crumpled foil folds: the creases of two noise layers.
      const a = 1 - Math.abs(fbm2D(u, v, 13, 3, 6) * 2 - 1);
      const b = 1 - Math.abs(fbm2D(u * 2.3, v * 2.3, 29, 2, 14) * 2 - 1);
      height[y * size + x] = a * a * 1.2 + b * b * 0.5;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = height[y * size + ((x + 1) % size)] - height[y * size + ((x - 1 + size) % size)];
      const dy = height[((y + 1) % size) * size + x] - height[((y - 1 + size) % size) * size + x];
      const n = new THREE.Vector3(-dx * 6, -dy * 6, 1).normalize();
      data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
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
