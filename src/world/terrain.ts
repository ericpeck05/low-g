import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { patchLunarSurface } from '../core/materialPatches';
import { addStaticBox } from '../core/physics';
import { sunDirection } from './lighting';
import { fbm2D, seededRandom } from './noise';
import { regolithTextures } from './regolithTexture';

// The lunar surface: rolling hills, craters at every size, a flat middle for the
// city, and a ring of tall hills at the edge so the world doesn't just stop.
//
// Everything comes from terrainHeight(x, z), so the visible ground, the physics
// ground, rocks and footprints all agree on where the surface is.

export interface Crater {
  x: number;
  z: number;
  radius: number;
  depth: number; // how far the floor sits below the surroundings
  rim: number; // how high the rim stands
  floorShape: number; // 2 = bowl, higher = flatter floor (older, bigger craters)
  fresh: boolean; // young: sharp, with bright ejecta rays
  wobble: [number, number, number, number]; // rim irregularity (amounts and phases)
}

let craters: Crater[] | null = null;
const GRID_CELL = 25; // meters per lookup cell
let grid: Map<number, Crater[]> | null = null;

/** All craters on the map (built once from the seed). */
export function getCraters() {
  if (craters) return craters;
  const t = CONFIG.terrain;
  const random = seededRandom(t.seed);
  const half = t.size / 2;
  const spread = half - t.edgeHillWidth * 0.4;
  craters = [];

  const tiers: [number, number, number][] = [
    [t.largeCraters, 25, 70],
    [t.mediumCraters, 6, 25],
    [t.smallCraters, 2.5, 6],
  ];
  for (const [count, minR, maxR] of tiers) {
    let made = 0;
    let attempts = 0;
    while (made < count && attempts++ < count * 20) {
      // Many small, few big: sizes follow a power law, like real crater counts.
      const radius = minR * Math.pow(maxR / minR, Math.pow(random(), 1.8));
      const x = (random() * 2 - 1) * spread;
      const z = (random() * 2 - 1) * spread;
      if (Math.hypot(x, z) < t.blendRadius + radius) continue; // keep the city's ground flat
      const fresh = random() < t.freshFraction;
      const age = fresh ? random() * 0.2 : 0.35 + random() * 0.65; // 0 = brand new, 1 = worn smooth
      craters.push({
        x,
        z,
        radius,
        depth: radius * THREE.MathUtils.lerp(0.21, 0.08, age),
        rim: radius * THREE.MathUtils.lerp(0.05, 0.012, age),
        floorShape: 2 + age * 1.5 + (radius > 30 ? 1.5 : 0),
        fresh,
        wobble: [0.04 + random() * 0.05, random() * 6.3, 0.02 + random() * 0.04, random() * 6.3],
      });
      made++;
    }
  }

  // A coarse grid, so each point only checks the craters that can reach it.
  grid = new Map();
  for (const c of craters) {
    const reach = c.radius * 2.6;
    for (let gx = Math.floor((c.x - reach) / GRID_CELL); gx <= Math.floor((c.x + reach) / GRID_CELL); gx++) {
      for (let gz = Math.floor((c.z - reach) / GRID_CELL); gz <= Math.floor((c.z + reach) / GRID_CELL); gz++) {
        const key = gx * 100000 + gz;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(c);
      }
    }
  }
  return craters;
}

function nearbyCraters(x: number, z: number) {
  getCraters();
  return grid!.get(Math.floor(x / GRID_CELL) * 100000 + Math.floor(z / GRID_CELL)) ?? [];
}

// Distance from a crater's center as a fraction of its (slightly irregular) radius.
function craterU(c: Crater, x: number, z: number) {
  const dx = x - c.x;
  const dz = z - c.z;
  const angle = Math.atan2(dz, dx);
  const [a1, p1, a2, p2] = c.wobble;
  const radius = c.radius * (1 + a1 * Math.sin(3 * angle + p1) + a2 * Math.sin(7 * angle + p2));
  return { u: Math.hypot(dx, dz) / radius, angle };
}

// The cross-section of a crater: a bowl (flatter for old or big ones) rising to a
// raised rim, then an ejecta apron that fades out to about 2.6 radii.
function craterHeight(c: Crater, u: number) {
  if (u >= 2.6) return 0;
  let h: number;
  if (u < 1) h = c.depth * (Math.pow(u, c.floorShape) - 1) + c.rim * Math.pow(u, 6);
  else h = c.rim * Math.pow(u, -3.5) * THREE.MathUtils.smoothstep(2.6 - u, 0, 0.9);
  if (c.radius > 40) h += c.depth * 0.3 * Math.exp(-((u / 0.18) ** 2)); // central peak in big craters
  return h;
}

/** Height of the ground at any (x, z), in meters. */
export function terrainHeight(x: number, z: number) {
  const t = CONFIG.terrain;
  const half = t.size / 2;

  // Gentle hills: noise centered on zero, plus finer lumps.
  let height = (fbm2D(x / t.hillScale + 50, z / t.hillScale + 50, t.seed, 4) - 0.5) * 2 * t.hillHeight;
  height += (fbm2D(x / 18 + 9, z / 18 + 9, t.seed + 5, 2) - 0.5) * 0.8;

  for (const c of nearbyCraters(x, z)) {
    const { u } = craterU(c, x, z);
    if (u < 2.6) height += craterHeight(c, u);
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

/**
 * How light or dark the ground is here (1 = average). Young craters are ringed by
 * bright, freshly dug-up dust thrown out in streaks ("rays"); older ground is darker.
 */
function terrainBrightness(x: number, z: number) {
  const t = CONFIG.terrain;
  let shade = 0.82 + 0.3 * fbm2D(x / 90, z / 90, t.seed + 3, 3); // broad light and dark patches
  for (const c of nearbyCraters(x, z)) {
    if (!c.fresh) continue;
    const { u, angle } = craterU(c, x, z);
    if (u > 2.6) continue;
    const rays = Math.pow(0.5 + 0.5 * Math.sin(angle * 9 + c.wobble[1] + 2 * Math.sin(angle * 4)), 4);
    const halo = u < 1 ? 0.18 : Math.exp(-(u - 1) * 1.6) * (0.12 + 0.25 * rays);
    shade += halo;
  }
  return shade;
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
  const sunVisibility = bakeSunShadows(heights, n, cell, half);

  // Visible ground, cut into square tiles. Only tiles the camera (or the sun's shadow
  // camera) can see get drawn, which matters a lot: the shadow map only covers the area
  // around the player, so it skips almost all of a 1 km landscape.
  const { map, normalMap, averageBrightness } = regolithTextures();
  const repeat = t.size / t.textureMeters;
  map.repeat.set(repeat, repeat);
  normalMap.repeat.set(repeat, repeat);
  const groundMaterial = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    vertexColors: true,
    roughness: 0.97,
  });
  hideTiling(groundMaterial, averageBrightness);
  patchLunarSurface(groundMaterial, true);

  const tileCells = 50; // 100 m tiles at 2 m per cell
  const at = (col: number, row: number) => heights[THREE.MathUtils.clamp(col, 0, n) * (n + 1) + THREE.MathUtils.clamp(row, 0, n)];
  const indices: number[] = [];
  for (let r = 0; r < tileCells; r++) {
    for (let c = 0; c < tileCells; c++) {
      const i = c * (tileCells + 1) + r;
      const right = i + tileCells + 1;
      indices.push(i, i + 1, right, right, i + 1, right + 1);
    }
  }
  for (let tc = 0; tc < n; tc += tileCells) {
    for (let tr = 0; tr < n; tr += tileCells) {
      const count = (tileCells + 1) * (tileCells + 1);
      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      const uvs = new Float32Array(count * 2);
      const colors = new Float32Array(count * 3);
      const sunVis = new Float32Array(count);
      let k = 0;
      for (let c = 0; c <= tileCells; c++) {
        for (let r = 0; r <= tileCells; r++, k++) {
          const col = tc + c;
          const row = tr + r;
          const x = -half + col * cell;
          const z = -half + row * cell;
          positions.set([x, at(col, row), z], k * 3);
          // Normals from the whole grid, so neighboring tiles shade seamlessly.
          const normal = new THREE.Vector3(at(col - 1, row) - at(col + 1, row), 2 * cell, at(col, row - 1) - at(col, row + 1)).normalize();
          normals.set([normal.x, normal.y, normal.z], k * 3);
          uvs.set([(x + half) / t.size, (z + half) / t.size], k * 2);
          const shade = terrainBrightness(x, z);
          colors.set([shade, shade * 0.985, shade * 0.955], k * 3);
          sunVis[k] = sunVisibility[col * (n + 1) + row];
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('sunVis', new THREE.BufferAttribute(sunVis, 1));
      geometry.setIndex(indices);
      geometry.computeBoundingSphere();
      const tile = new THREE.Mesh(geometry, groundMaterial);
      tile.receiveShadow = true;
      tile.castShadow = true; // nearby crater rims and hills shade the ground in the live shadow map too
      scene.add(tile);
    }
  }

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

// The live shadow map only covers the area around the player. For the rest of the map,
// trace a line from every grid point toward the sun once at load time: if the ground
// rises above that line anywhere along the way, the point is in shadow.
function bakeSunShadows(heights: Float32Array, n: number, cell: number, half: number) {
  const sun = sunDirection();
  const flat = Math.hypot(sun.x, sun.z);
  const stepX = sun.x / flat;
  const stepZ = sun.z / flat;
  const rise = sun.y / flat; // meters the sunbeam climbs per meter across the ground
  let highest = -Infinity;
  for (const h of heights) highest = Math.max(highest, h);

  const sample = (x: number, z: number) => {
    // Bilinear height lookup in the grid.
    const fx = THREE.MathUtils.clamp((x + half) / cell, 0, n - 0.001);
    const fz = THREE.MathUtils.clamp((z + half) / cell, 0, n - 0.001);
    const c0 = Math.floor(fx);
    const r0 = Math.floor(fz);
    const tx = fx - c0;
    const tz = fz - r0;
    const h00 = heights[c0 * (n + 1) + r0];
    const h10 = heights[(c0 + 1) * (n + 1) + r0];
    const h01 = heights[c0 * (n + 1) + r0 + 1];
    const h11 = heights[(c0 + 1) * (n + 1) + r0 + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  const visibility = new Float32Array(heights.length);
  const maxDistance = CONFIG.terrain.shadowBakeDistance;
  for (let col = 0; col <= n; col++) {
    for (let row = 0; row <= n; row++) {
      const x = -half + col * cell;
      const z = -half + row * cell;
      const start = heights[col * (n + 1) + row] + 0.05;
      let lit = 1;
      for (let d = cell; d < maxDistance; d += cell) {
        const beam = start + d * rise;
        if (beam > highest) break; // the beam is above every hill: nothing left to block it
        const ground = sample(x + stepX * d, z + stepZ * d);
        // Soft edge: a small blur that widens with distance (the sun is a disc, not a point).
        const softness = 0.25 + d * 0.012;
        lit = Math.min(lit, THREE.MathUtils.clamp((beam - ground) / softness + 0.5, 0, 1));
        if (lit === 0) break;
      }
      visibility[col * (n + 1) + row] = lit;
    }
  }
  return visibility;
}

// One texture repeated every 8 m makes a visible pattern at a distance. Mixing in a
// second, much larger copy of it at an offset breaks the repetition up.
function hideTiling(material: THREE.MeshStandardMaterial, averageBrightness: number) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLgAverage = { value: averageBrightness };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLgAverage;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          vec4 lgFar = texture2D( map, vMapUv * 0.173 + vec2( 0.37, 0.71 ) );
          sampledDiffuseColor.rgb *= mix( 1.0, lgFar.r / uLgAverage, 0.6 );
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          vec3 lgFarN = texture2D( normalMap, vNormalMapUv * 0.173 + vec2( 0.37, 0.71 ) ).xyz * 2.0 - 1.0;
          mapN = normalize( vec3( mapN.xy + lgFarN.xy * 0.8, mapN.z * lgFarN.z ) );`,
        ),
      );
  };
  material.customProgramCacheKey = () => 'hideTiling';
}
