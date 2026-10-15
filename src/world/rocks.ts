import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { fbm3D, seededRandom } from './noise';
import { getCraters, terrainHeight, terrainNormal } from './terrain';

const SHAPES = 4; // how many different rock shapes to make

// Rocks and boulders scattered over the surface.
// Each shape is drawn many times in one go (an "instanced" mesh), which is
// far cheaper than thousands of separate rocks.
export function scatterRocks(scene: THREE.Scene, world: RAPIER.World) {
  const random = seededRandom(CONFIG.terrain.seed + 100);
  const shapes = Array.from({ length: SHAPES }, (_, i) => rockGeometry(i));
  const material = new THREE.MeshStandardMaterial({ color: 0x7d7a74, roughness: 0.95, flatShading: true });

  const placements: { shape: number; matrix: THREE.Matrix4; size: number }[] = [];
  const { pebbles, boulders, boulderMinSize, boulderMaxSize } = CONFIG.rocks;
  const craters = getCraters();

  for (let i = 0; i < pebbles + boulders; i++) {
    const isBoulder = i >= pebbles;
    const size = isBoulder
      ? boulderMinSize + (boulderMaxSize - boulderMinSize) * random() ** 2
      : 0.1 + random() ** 3 * 0.7;

    // Boulders gather around crater rims (thrown out by the impact); pebbles go anywhere.
    const spot = isBoulder && random() < 0.6 ? nearCraterRim(craters, random) : randomSpot(random);
    if (!spot) continue;
    const minDistance = CONFIG.terrain.flatRadius + (isBoulder ? 20 : 3);
    if (Math.hypot(spot.x, spot.z) < minDistance) continue;

    // Sit the rock on the ground, tilted to the slope, partly buried.
    const ground = terrainHeight(spot.x, spot.z);
    const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), terrainNormal(spot.x, spot.z));
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    const scale = new THREE.Vector3(size * (0.8 + random() * 0.5), size * (0.45 + random() * 0.35), size * (0.8 + random() * 0.5));
    const position = new THREE.Vector3(spot.x, ground + scale.y * 0.25, spot.z);
    const matrix = new THREE.Matrix4().compose(position, tilt.multiply(spin), scale);
    placements.push({ shape: Math.floor(random() * SHAPES), matrix, size });

    if (isBoulder) addBoulderCollider(world, shapes[placements[placements.length - 1].shape], matrix);
  }

  // One instanced mesh per shape.
  for (let s = 0; s < SHAPES; s++) {
    const mine = placements.filter((p) => p.shape === s);
    const mesh = new THREE.InstancedMesh(shapes[s], material, mine.length);
    mine.forEach((p, i) => mesh.setMatrixAt(i, p.matrix));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// A lumpy rock: a ball with its surface pushed in and out by noise.
function rockGeometry(variant: number) {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    // Noise is based on position, so corners shared by several faces move together.
    const bump = fbm3D(v.x * 1.4 + variant * 10, v.y * 1.4, v.z * 1.4, 50 + variant, 3);
    v.multiplyScalar(0.7 + bump * 0.6);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Boulders are solid: a convex shell wrapped around the rock's points.
function addBoulderCollider(world: RAPIER.World, shape: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  const source = shape.getAttribute('position') as THREE.BufferAttribute;
  const points = new Float32Array(source.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < source.count; i++) {
    v.fromBufferAttribute(source, i).applyMatrix4(matrix);
    points.set([v.x, v.y, v.z], i * 3);
  }
  const desc = RAPIER.ColliderDesc.convexHull(points);
  if (desc) world.createCollider(desc);
}

function randomSpot(random: () => number) {
  const half = CONFIG.terrain.size / 2 - 10;
  return { x: (random() * 2 - 1) * half, z: (random() * 2 - 1) * half };
}

function nearCraterRim(craters: ReturnType<typeof getCraters>, random: () => number) {
  const crater = craters[Math.floor(random() * craters.length)];
  if (!crater) return null;
  const angle = random() * Math.PI * 2;
  const distance = crater.radius * (0.95 + random() * 0.6);
  return { x: crater.x + Math.cos(angle) * distance, z: crater.z + Math.sin(angle) * distance };
}
