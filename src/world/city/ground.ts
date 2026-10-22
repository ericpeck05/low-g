import * as THREE from 'three';
import { CONFIG } from '../../config';
import { patchTriplanar } from '../../core/materialPatches';
import { concreteDetail } from '../detailTextures';
import { seededRandom } from '../noise';
import { MATERIALS, pavingTexture } from './kit';
import { PLAZA_RADIUS, RANGE, RING_ROAD } from './layout';

// The floor of the city: pale paving everywhere, a ring road for carts and rovers
// between the towers and the outer district, avenues out to both airlocks, curbs,
// and crossings where they meet.

const AVENUE_HALF = 4; // the avenues are 8 m wide
const PAINT = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.7 }); // road markings
const AIRLOCK_START = CONFIG.city.domeRadius - 7; // where an airlock's housing begins

export function buildGround(scene: THREE.Object3D) {
  buildPaving(scene);
  const road = roadMaterial();
  const { inner, outer } = RING_ROAD;
  const gap = rangeGap();

  // The ring road runs all the way round except where the range hall stands across it.
  const ring = annulus(inner, outer, 90 + gap, 450 - gap, 8);
  const mesh = new THREE.Mesh(ring, road);
  mesh.position.y = 0.03; // well clear of the paving (0.012), so they never flicker at a distance
  mesh.receiveShadow = true;
  scene.add(mesh);
  curbRing(scene, inner, 90 + gap, 450 - gap);
  curbRing(scene, outer, 90 + gap, 450 - gap);

  // Avenues from the plaza to each airlock, broken where they cross the ring road.
  for (const bearing of CONFIG.city.airlockBearings) {
    for (const [from, to] of [
      [PLAZA_RADIUS + 0.4, inner],
      [outer, AIRLOCK_START],
    ]) {
      const avenue = straightRoad(from, to, bearing, road);
      scene.add(avenue);
    }
    crossing(scene, bearing);
  }
}

/** Degrees either side of due east the ring road stops short, so it meets the range hall's sides. */
function rangeGap() {
  const middle = (RING_ROAD.inner + RING_ROAD.outer) / 2;
  return THREE.MathUtils.radToDeg(Math.asin((RANGE.halfWidth + 1.2) / middle));
}

function buildPaving(scene: THREE.Object3D) {
  const radius = CONFIG.city.domeRadius - 0.6;
  const texture = pavingTexture();
  texture.repeat.set((radius * 2) / 8, (radius * 2) / 8); // 8 m per texture tile (four 2 m slabs)
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  // Fine concrete grain on top of the slab pattern, so it isn't flat up close.
  patchTriplanar(material, { ...concreteDetail(), metersPerTile: 2, bumpScale: 0.5 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012; // just above the flat ground underneath
  floor.receiveShadow = true;
  scene.add(floor);
}

/**
 * A flat ring (or part of one) lying on the ground, with UVs that run along it:
 * u in tiles of `tile` meters round the middle of the ring, v from the inner edge (0) to the outer (1).
 * Bearings in degrees, 0 = +z, 90 = +x.
 */
function annulus(inner: number, outer: number, fromBearing: number, toBearing: number, tile: number) {
  const steps = Math.ceil((toBearing - fromBearing) / 1.5);
  const middle = (inner + outer) / 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const bearing = THREE.MathUtils.degToRad(fromBearing + ((toBearing - fromBearing) * i) / steps);
    const u = (bearing * middle) / tile;
    for (const [r, v] of [
      [inner, 0],
      [outer, 1],
    ]) {
      positions.push(Math.sin(bearing) * r, 0, Math.cos(bearing) * r);
      uvs.push(u, v);
    }
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals(); // the triangles wind so this faces up
  return geometry;
}

/** A straight stretch of road out along a bearing, from one distance to another. */
function straightRoad(from: number, to: number, bearing: number, material: THREE.Material) {
  const length = to - from;
  const geometry = new THREE.PlaneGeometry(AVENUE_HALF * 2, length);
  // The road texture is 8 m along by 6 m across; here "along" runs the length of the avenue.
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getY(i) * length) / 8, uv.getX(i));
  const mesh = new THREE.Mesh(geometry, material);
  const b = THREE.MathUtils.degToRad(bearing);
  const middle = (from + to) / 2;
  mesh.rotation.set(-Math.PI / 2, b, 0, 'YXZ'); // lie flat, then turn to run out along the bearing
  mesh.position.set(Math.sin(b) * middle, 0.03, Math.cos(b) * middle);
  mesh.receiveShadow = true;
  return mesh;
}

/** Zebra stripes across the ring road where an avenue crosses it. */
function crossing(scene: THREE.Object3D, bearing: number) {
  const b = THREE.MathUtils.degToRad(bearing);
  const along = new THREE.Vector3(Math.sin(b), 0, Math.cos(b)); // out along the avenue
  const { inner, outer } = RING_ROAD;
  // Bars lying along the ring road, one after another across it.
  for (let r = inner + 0.7; r < outer - 0.4; r += 1.0) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.5, AVENUE_HALF * 2 - 1), PAINT);
    stripe.rotation.set(-Math.PI / 2, b - Math.PI / 2, 0, 'YXZ');
    stripe.position.copy(along).multiplyScalar(r).setY(0.05);
    stripe.receiveShadow = true;
    scene.add(stripe);
  }
}

/** A low curb along a ring at radius r. */
function curbRing(scene: THREE.Object3D, r: number, fromBearing: number, toBearing: number) {
  const steps = Math.ceil((toBearing - fromBearing) / 2);
  for (let i = 0; i < steps; i++) {
    const a0 = fromBearing + ((toBearing - fromBearing) * i) / steps;
    const a1 = fromBearing + ((toBearing - fromBearing) * (i + 1)) / steps;
    const middle = THREE.MathUtils.degToRad((a0 + a1) / 2);
    // Leave a gap where the avenues cross.
    const bearing = ((a0 + a1) / 2) % 360;
    const offAxis = Math.min(...CONFIG.city.airlockBearings.map((ab) => Math.abs(((bearing - ab + 540) % 360) - 180)));
    if (Math.sin(THREE.MathUtils.degToRad(offAxis)) * r < AVENUE_HALF + 0.5) continue;
    const length = (THREE.MathUtils.degToRad(a1 - a0) * r) + 0.02;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, length), MATERIALS.concrete);
    curb.position.set(Math.sin(middle) * r, 0.06, Math.cos(middle) * r);
    curb.rotation.y = middle + Math.PI / 2;
    curb.receiveShadow = true;
    scene.add(curb);
  }
}

// Road surface: dark composite with amber edge lines, a dashed white center line,
// and a joint across it every 8 m. One tile is 8 m along by 6 m across.
let road: THREE.MeshStandardMaterial | null = null;

export function roadMaterial() {
  if (road) return road;
  road = makeRoad();
  return road;
}

function makeRoad() {
  const w = 512;
  const h = 384;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a4744';
  ctx.fillRect(0, 0, w, h);
  // Speckle, so it isn't a flat color.
  const random = seededRandom(17);
  for (let i = 0; i < 6000; i++) {
    const shade = 60 + Math.floor(random() * 30);
    ctx.fillStyle = `rgba(${shade},${shade - 2},${shade - 5},0.5)`;
    ctx.fillRect(random() * w, random() * h, 2, 2);
  }
  const m = h / 6; // pixels per meter across
  ctx.fillStyle = '#d99a2b';
  for (const y of [0.3, 6 - 0.42]) ctx.fillRect(0, y * m, w, 0.12 * m);
  ctx.fillStyle = '#ddd6ca';
  ctx.fillRect(0, 3 * m - 0.06 * m, w * (3 / 8), 0.12 * m);
  ctx.fillStyle = '#3a3835';
  ctx.fillRect(0, 0, 2, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78 });
  patchTriplanar(material, { ...concreteDetail(), metersPerTile: 2, bumpScale: 0.35 });
  return material;
}
