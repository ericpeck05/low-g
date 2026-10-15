import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { patchLunarSurface, patchTriplanar } from '../core/materialPatches';
import { rockDetail } from './detailTextures';
import { fbm3D, seededRandom } from './noise';
import { type Crater, getCraters, terrainHeight, terrainNormal } from './terrain';

const SHAPES = 3; // different rock shapes per size class

interface SizeClass {
  count: number;
  minSize: number; // meters
  maxSize: number;
  detail: number; // how finely the shape is built (more = rounder, more triangles)
  solid: boolean;
  drawDistance: number; // beyond this they're smaller than a pixel, so don't draw them
}

// Rocks and boulders scattered over the surface, in three sizes.
// All of them go into one "batched" mesh: three.js draws the whole lot in a few calls
// and skips each rock the camera (or the sun's shadow camera) can't see.
// Returns an update function that hides small rocks far from the player.
export function scatterRocks(scene: THREE.Scene, world: RAPIER.World) {
  const cfg = CONFIG.rocks;
  const random = seededRandom(CONFIG.terrain.seed + 100);
  const craters = getCraters();

  const classes: SizeClass[] = [
    { count: cfg.pebbles, minSize: 0.06, maxSize: 0.35, detail: 1, solid: false, drawDistance: 220 },
    { count: cfg.stones, minSize: 0.35, maxSize: 1.2, detail: 2, solid: false, drawDistance: 500 },
    { count: cfg.boulders, minSize: 1.2, maxSize: 5, detail: 5, solid: true, drawDistance: Infinity },
  ];
  const shapes = classes.map((sizeClass, classIndex) =>
    Array.from({ length: SHAPES }, (_, i) => rockGeometry(sizeClass.detail, classIndex * 10 + i)),
  );
  let vertices = 0;
  let indices = 0;
  for (const geometry of shapes.flat()) {
    vertices += geometry.attributes.position.count;
    indices += geometry.index!.count;
  }
  const total = classes.reduce((sum, c) => sum + c.count, 0);
  const rocks = new THREE.BatchedMesh(total, vertices, indices, rockMaterial());
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const geometryIds = shapes.map((list) => list.map((geometry) => rocks.addGeometry(geometry)));
  const placed: { id: number; x: number; z: number; drawDistance: number }[] = [];

  classes.forEach((sizeClass, classIndex) => {
    for (let i = 0; i < sizeClass.count; i++) {
      // Sizes: many small, few large.
      const size = sizeClass.minSize * Math.pow(sizeClass.maxSize / sizeClass.minSize, Math.pow(random(), 2));
      const spot = random() < cfg.nearCraterShare ? nearCraterRim(craters, random) : randomSpot(random);
      const minDistance = CONFIG.terrain.flatRadius + (sizeClass.solid ? 25 : 4);
      if (Math.hypot(spot.x, spot.z) < minDistance) continue;

      // Sit the rock on the slope, partly buried in the dust.
      const ground = terrainHeight(spot.x, spot.z);
      const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), terrainNormal(spot.x, spot.z));
      const spin = new THREE.Quaternion().setFromEuler(
        new THREE.Euler((random() - 0.5) * 0.5, random() * Math.PI * 2, (random() - 0.5) * 0.5),
      );
      const scale = new THREE.Vector3(
        size * (0.75 + random() * 0.5),
        size * (0.45 + random() * 0.4),
        size * (0.75 + random() * 0.5),
      );
      const buried = scale.y * (0.25 + random() * 0.2);
      const position = new THREE.Vector3(spot.x, ground + scale.y * 0.5 - buried, spot.z);
      const matrix = new THREE.Matrix4().compose(position, tilt.multiply(spin), scale);
      // Small color differences between rocks: some darker, some a touch warmer.
      const shade = 0.78 + random() * 0.35;
      const tint = new THREE.Color(shade, shade * (0.97 + random() * 0.03), shade * (0.93 + random() * 0.05));
      const shape = Math.floor(random() * SHAPES);
      const id = rocks.addInstance(geometryIds[classIndex][shape]);
      rocks.setMatrixAt(id, matrix);
      rocks.setColorAt(id, tint);
      placed.push({ id, x: spot.x, z: spot.z, drawDistance: sizeClass.drawDistance });
      if (sizeClass.solid) addBoulderCollider(world, shapes[classIndex][shape], matrix);
    }
  });
  scene.add(rocks);

  const lastUpdate = new THREE.Vector3(Infinity, 0, Infinity);
  return {
    /** Hide small rocks that are too far away to see (rechecked every 15 m you move). */
    update(player: THREE.Vector3) {
      if (Math.hypot(player.x - lastUpdate.x, player.z - lastUpdate.z) < 15) return;
      lastUpdate.copy(player);
      for (const rock of placed) {
        if (rock.drawDistance === Infinity) continue;
        rocks.setVisibleAt(rock.id, Math.hypot(rock.x - player.x, rock.z - player.z) < rock.drawDistance);
      }
    },
  };
}

function rockMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 });
  patchTriplanar(material, { ...rockDetail(), metersPerTile: 1.2, bumpScale: 1.6 });
  patchLunarSurface(material);
  return material;
}

// A broken-looking rock: a lumpy ball cut by several flat "fracture" planes,
// with dust settled on its upper surfaces.
function rockGeometry(detail: number, variant: number) {
  const random = seededRandom(500 + variant);
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry); // shared corners, so the surface shades smoothly

  // Fracture planes: each one shaves the rock flat on one side.
  const planes = Array.from({ length: 4 + Math.floor(random() * 4) }, () => ({
    normal: new THREE.Vector3(random() - 0.5, (random() - 0.5) * 1.4, random() - 0.5).normalize(),
    offset: 0.55 + random() * 0.3,
  }));

  const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i);
    // Lumps first (noise based on position, so shared corners move together)...
    const bump = fbm3D(v.x * 1.6 + variant * 7, v.y * 1.6, v.z * 1.6, 70 + variant, 4);
    v.multiplyScalar(0.72 + bump * 0.55);
    // ...then cut by the fracture planes.
    for (const plane of planes) {
      const along = v.dot(plane.normal);
      if (along > plane.offset) v.addScaledVector(plane.normal, plane.offset - along);
    }
    positions.setXYZ(i, v.x, v.y, v.z);

    // Color: mottled gray rock, lighter where dust has settled on top.
    const mottle = 0.85 + (fbm3D(v.x * 4, v.y * 4, v.z * 4, 90 + variant, 3) - 0.5) * 0.5;
    const up = THREE.MathUtils.smoothstep(v.y / v.length(), 0.35, 0.9);
    // Values are linear albedo, matched to the regolith (about 0.25): rock a bit darker, dust a bit lighter.
    const shade = THREE.MathUtils.lerp(mottle * 0.2, 0.27, up * 0.75);
    colors.set([shade, shade * 0.985, shade * 0.955], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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

// Somewhere around a crater's rim, thinning out with distance (ejecta).
function nearCraterRim(craters: Crater[], random: () => number) {
  const crater = craters[Math.floor(random() * craters.length)];
  const angle = random() * Math.PI * 2;
  const distance = crater.radius * (0.85 + Math.pow(random(), 2) * 1.4);
  return { x: crater.x + Math.cos(angle) * distance, z: crater.z + Math.sin(angle) * distance };
}
