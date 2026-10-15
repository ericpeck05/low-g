import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { addStaticBox } from '../core/physics';
import { fbm2D, seededRandom } from './noise';
import { regolithTextures } from './regolithTexture';

// The lunar surface: rolling hills, craters, a flat middle for the city,
// and a ring of tall hills at the edge so the world doesn't just stop.
//
// Everything comes from terrainHeight(x, z), so the visible ground, the physics
// ground, rocks and footprints all agree on where the surface is.

interface Crater {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

let craters: Crater[] | null = null;

export function getCraters() {
  if (craters) return craters;
  const t = CONFIG.terrain;
  const random = seededRandom(t.seed);
  const half = t.size / 2;
  const spread = half - t.edgeHillWidth * 0.5;
  craters = [];
  while (craters.length < t.craterCount) {
    // Many small craters, few big ones.
    const radius = t.craterMinRadius + (t.craterMaxRadius - t.craterMinRadius) * Math.pow(random(), 2.5);
    const x = (random() * 2 - 1) * spread;
    const z = (random() * 2 - 1) * spread;
    // Keep craters out of the flat middle.
    if (Math.hypot(x, z) < t.blendRadius + radius) continue;
    craters.push({ x, z, radius, depth: radius * 0.22 });
  }
  return craters;
}

// The cross-section of one crater: a bowl that dips below the ground, with a
// raised rim around it. u is distance from the center divided by the radius.
function craterShape(u: number) {
  const bowl = u < 1 ? u * u - 1 : 0; // -1 at the center, 0 at the rim
  const rim = 0.35 * Math.exp(-(((u - 1) / 0.28) ** 2)); // bump at the rim
  return bowl + rim;
}

/** Height of the ground at any (x, z), in meters. */
export function terrainHeight(x: number, z: number) {
  const t = CONFIG.terrain;
  const half = t.size / 2;

  // Gentle hills: noise centered on zero.
  let height = (fbm2D(x / t.hillScale + 50, z / t.hillScale + 50, t.seed, 4) - 0.5) * 2 * t.hillHeight;

  for (const c of getCraters()) {
    const u = Math.hypot(x - c.x, z - c.z) / c.radius;
    if (u < 2) height += craterShape(u) * c.depth;
  }

  // Tall, lumpy hills rising toward the map edge.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const edgeT = THREE.MathUtils.clamp((edge - (half - t.edgeHillWidth)) / t.edgeHillWidth, 0, 1);
  if (edgeT > 0) {
    const lumps = 0.5 + 0.5 * fbm2D(x / 60, z / 60, t.seed + 9, 3);
    height += t.edgeHillHeight * edgeT * edgeT * lumps;
  }

  // Flatten the middle and blend smoothly into the landscape around it.
  const blend = THREE.MathUtils.smoothstep(Math.hypot(x, z), t.flatRadius, t.blendRadius);
  return height * blend;
}

/** Which way the ground faces at (x, z). Straight up on flat ground. */
export function terrainNormal(x: number, z: number) {
  const e = 0.5;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return new THREE.Vector3(-dx, 2 * e, -dz).normalize();
}

export function buildTerrain(scene: THREE.Scene, world: RAPIER.World) {
  const t = CONFIG.terrain;
  const n = t.resolution;
  const half = t.size / 2;
  const cell = t.size / n;

  // Work out every grid height once. Both the mesh and the physics use this list.
  // heights[col * (n + 1) + row]: col steps along x, row steps along z.
  const heights = new Float32Array((n + 1) * (n + 1));
  for (let col = 0; col <= n; col++) {
    for (let row = 0; row <= n; row++) {
      heights[col * (n + 1) + row] = terrainHeight(-half + col * cell, -half + row * cell);
    }
  }

  // Visible ground
  const geometry = new THREE.PlaneGeometry(t.size, t.size, n, n);
  geometry.rotateX(-Math.PI / 2); // lay it flat
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const col = Math.round((x + half) / cell);
    const row = Math.round((z + half) / cell);
    positions.setY(i, heights[col * (n + 1) + row]);

    // Large, soft patches of lighter and darker ground so it isn't one flat gray.
    const shade = 0.78 + 0.32 * fbm2D(x / 90, z / 90, t.seed + 3, 3);
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade * 0.985;
    colors[i * 3 + 2] = shade * 0.96;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const { map, bumpMap } = regolithTextures();
  const repeat = t.size / t.textureMeters;
  map.repeat.set(repeat, repeat);
  bumpMap.repeat.set(repeat, repeat);
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 1.5, vertexColors: true, roughness: 0.95 }),
  );
  ground.receiveShadow = true;
  ground.castShadow = true; // crater rims and hills shade the ground behind them
  scene.add(ground);

  // Physics ground: a heightfield with the same grid.
  world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, heights, { x: t.size, y: 1, z: t.size }));

  // Invisible walls at the edge of the map.
  const wallHeight = 200;
  const thick = 1;
  addStaticBox(world, { x: 0, y: 0, z: half + thick }, { x: half, y: wallHeight, z: thick });
  addStaticBox(world, { x: 0, y: 0, z: -half - thick }, { x: half, y: wallHeight, z: thick });
  addStaticBox(world, { x: half + thick, y: 0, z: 0 }, { x: thick, y: wallHeight, z: half });
  addStaticBox(world, { x: -half - thick, y: 0, z: 0 }, { x: thick, y: wallHeight, z: half });
}
