import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '../noise';
import { MATERIALS, type Placement, boxCollider, instanced, solidBox } from './kit';

// Street furniture and greenery: trees and shrubs in planters, lamp posts, benches,
// bollards and bins. Things that repeat are collected first and then drawn as one
// batch each (instanced), so a few hundred of them cost a handful of draws.

const random = seededRandom(73);

const FOLIAGE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
const BARK = new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.9 });
const SOIL = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });
export const WOOD = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.62 });

/** A leafy clump: several lumpy balls merged, each a slightly different green. */
function foliage(blobs: number, spread: number, size: number, lift: number, seed: number, detail = 2) {
  const rand = seededRandom(seed);
  const parts: THREE.BufferGeometry[] = [];
  const greens = [0x3f5a2a, 0x4f6b34, 0x5d7a3b, 0x36502a, 0x6b8441];
  for (let i = 0; i < blobs; i++) {
    const r = size * (0.7 + rand() * 0.5);
    const raw = new THREE.IcosahedronGeometry(r, detail);
    raw.deleteAttribute('uv');
    raw.deleteAttribute('normal');
    const ball = mergeVertices(raw); // shared corners, so the shading comes out smooth
    // Push the surface in and out in lumps, so it reads as clusters of leaves, not a ball.
    const pos = ball.attributes.position as THREE.BufferAttribute;
    const phase = rand() * 10;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v) / r;
      const y = pos.getY(v) / r;
      const z = pos.getZ(v) / r;
      const lumps = Math.sin(x * 5.1 + phase) * Math.sin(y * 4.3 + phase * 0.7) * Math.sin(z * 4.7 + phase * 1.3);
      const k = 0.9 + lumps * 0.16 + (rand() - 0.5) * 0.06;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.82, pos.getZ(v) * k);
    }
    ball.computeVertexNormals();
    const a = (i / blobs) * Math.PI * 2 + rand();
    const out = i === 0 ? 0 : spread * (0.5 + rand() * 0.5);
    ball.translate(Math.cos(a) * out, lift + (rand() - 0.3) * size * 0.8 + (i === 0 ? size * 0.4 : 0), Math.sin(a) * out);
    const color = new THREE.Color(greens[Math.floor(rand() * greens.length)]);
    const colors = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      // Lighter on top, darker underneath and deeper in.
      const shade = 0.6 + 0.5 * THREE.MathUtils.clamp((pos.getY(v) - lift) / (size * 2) + 0.5, 0, 1);
      colors.set([color.r * shade, color.g * shade, color.b * shade], v * 3);
    }
    ball.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(ball);
  }
  return mergeGeometries(parts)!;
}

/** Collects trees, shrubs and other repeated props, then draws each kind as one batch. */
export class Greenery {
  private trees: Placement[] = [];
  private shrubs: Placement[] = [];

  /** A tree whose trunk stands on `base` (a planter's soil, or the ground). */
  tree(x: number, base: number, z: number) {
    this.trees.push({ position: { x, y: base, z }, rotation: new THREE.Euler(0, random() * Math.PI * 2, 0) });
  }

  shrub(x: number, base: number, z: number) {
    this.shrubs.push({ position: { x, y: base, z }, rotation: new THREE.Euler(0, random() * Math.PI * 2, 0) });
  }

  build(scene: THREE.Object3D, world: RAPIER.World) {
    if (this.trees.length) {
      const trunk = new THREE.CylinderGeometry(0.09, 0.15, 2.8, 7).translate(0, 1.4, 0);
      instanced(scene, trunk, BARK, this.trees);
      instanced(scene, foliage(8, 1.05, 0.82, 3.3, 5), FOLIAGE, this.trees);
      for (const t of this.trees) boxCollider(world, { x: t.position.x, y: t.position.y + 1.4, z: t.position.z }, { x: 0.3, y: 2.8, z: 0.3 });
    }
    if (this.shrubs.length) instanced(scene, foliage(4, 0.35, 0.38, 0.3, 9, 1), FOLIAGE, this.shrubs);
  }
}

/**
 * A raised concrete planter (0.55 m tall), `width` by `depth`, turned `yaw`, with soil
 * and shrubs, and trees if it's big enough. Collision is the box.
 */
export function planter(scene: THREE.Object3D, world: RAPIER.World, green: Greenery, x: number, z: number, width: number, depth: number, yaw = 0, trees = true) {
  const height = 0.55;
  solidBox(scene, world, { x, y: height / 2, z }, { x: width, y: height, z: depth }, MATERIALS.concrete, yaw);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, 0.02, depth - 0.3), SOIL);
  soil.position.set(x, height + 0.012, z);
  soil.rotation.y = yaw;
  soil.receiveShadow = true;
  scene.add(soil);
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  // Shrubs along it, and a tree every 4 m or so.
  const count = Math.max(1, Math.round(width / 1.1));
  for (let i = 0; i < count; i++) {
    const s = ((i + 0.5) / count - 0.5) * (width - 0.6);
    const across = (random() - 0.5) * (depth - 0.8);
    green.shrub(x + right.x * s + forward.x * across, height, z + right.z * s + forward.z * across);
  }
  if (trees && depth >= 1.4) {
    const treeCount = Math.max(1, Math.round(width / 4.5));
    for (let i = 0; i < treeCount; i++) {
      const s = ((i + 0.5) / treeCount - 0.5) * (width - 1);
      green.tree(x + right.x * s, height, z + right.z * s);
    }
  }
}

/** Lamp posts: a slim pole with an arm and a long light head. `facing` turns the arm. */
export class LampPosts {
  private poles: Placement[] = [];
  private heads: Placement[] = [];

  add(world: RAPIER.World, x: number, z: number, facing: number) {
    const rotation = new THREE.Euler(0, facing, 0);
    this.poles.push({ position: { x, y: 0, z }, rotation });
    this.heads.push({ position: { x, y: 0, z }, rotation });
    boxCollider(world, { x, y: 2.5, z }, { x: 0.2, y: 5, z: 0.2 });
  }

  build(scene: THREE.Object3D) {
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.05, 0.08, 5.2, 8).translate(0, 2.6, 0),
      new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8).translate(0, 0.25, 0), // foot
      new THREE.BoxGeometry(0.06, 0.06, 1.3).translate(0, 5.05, 0.6), // arm
      new THREE.BoxGeometry(0.34, 0.1, 1.0).translate(0, 5.0, 1.2), // head housing
    ])!;
    instanced(scene, pole, MATERIALS.graphite, this.poles);
    const light = new THREE.BoxGeometry(0.26, 0.03, 0.9).translate(0, 4.94, 1.2);
    instanced(scene, light, MATERIALS.whiteLight, this.heads, false);
  }
}

/** A bench: concrete ends and a timber seat and back, standing on `base`. Faces `yaw`. */
export function bench(scene: THREE.Object3D, world: RAPIER.World, x: number, z: number, yaw: number, length = 2.4, base = 0) {
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  for (const s of [-1, 1]) {
    const leg = { x: x + right.x * s * (length / 2 - 0.15), z: z + right.z * s * (length / 2 - 0.15) };
    solidBox(scene, world, { x: leg.x, y: base + 0.22, z: leg.z }, { x: 0.18, y: 0.44, z: 0.5 }, MATERIALS.concrete, yaw, false);
  }
  solidBox(scene, world, { x, y: base + 0.47, z }, { x: length, y: 0.07, z: 0.55 }, WOOD, yaw, false);
  const back = { x: x - forward.x * 0.25, z: z - forward.z * 0.25 };
  const backrest = solidBox(scene, world, { x: back.x, y: base + 0.78, z: back.z }, { x: length, y: 0.36, z: 0.06 }, WOOD, yaw, false);
  backrest.rotation.set(-0.15, yaw, 0, 'YXZ');
  boxCollider(world, { x, y: base + 0.45, z }, { x: length, y: 0.9, z: 0.6 }, new THREE.Euler(0, yaw, 0));
}

/** Short posts with a lit band near the top, along paths. */
export class Bollards {
  private spots: Placement[] = [];

  add(world: RAPIER.World, x: number, z: number) {
    this.spots.push({ position: { x, y: 0, z } });
    boxCollider(world, { x, y: 0.45, z }, { x: 0.24, y: 0.9, z: 0.24 });
  }

  build(scene: THREE.Object3D) {
    if (!this.spots.length) return;
    instanced(scene, new THREE.CylinderGeometry(0.11, 0.12, 0.9, 10).translate(0, 0.45, 0), MATERIALS.graphite, this.spots);
    instanced(scene, new THREE.CylinderGeometry(0.115, 0.115, 0.06, 10).translate(0, 0.78, 0), MATERIALS.amberLight, this.spots, false);
  }
}

/** A six-wheeled pressurized rover, parked: cab at the front (local +z), cargo bed behind. */
export function rover(scene: THREE.Object3D, world: RAPIER.World, x: number, z: number, yaw: number, base = 0) {
  const group = new THREE.Group();
  group.position.set(x, base, z);
  group.rotation.y = yaw;
  scene.add(group);
  const part = (material: THREE.Material, px: number, py: number, pz: number, sx: number, sy: number, sz: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(px, py, pz);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  part(MATERIALS.graphite, 0, 0.85, 0, 2.2, 0.45, 4.4); // chassis
  part(MATERIALS.lightPanel, 0, 1.75, 0.95, 2.1, 1.35, 2.3); // cab
  part(MATERIALS.shadow, 0, 1.95, 2.11, 1.8, 0.55, 0.02); // windscreen
  for (const s of [-1, 1]) part(MATERIALS.shadow, s * 1.06, 1.95, 1.1, 0.02, 0.45, 1.5); // side windows
  part(MATERIALS.graphite, 0, 2.47, 0.95, 2.2, 0.1, 2.4); // roof rim
  part(MATERIALS.lightPanel, 0, 1.25, -1.35, 2.1, 0.35, 1.7); // cargo bed
  for (const s of [-1, 1]) part(MATERIALS.graphite, s * 1.0, 1.55, -1.35, 0.08, 0.3, 1.7);
  part(MATERIALS.trim, 0, 1.6, -1.2, 1.2, 0.5, 0.9); // a crate in the bed
  part(MATERIALS.whiteLight, 0, 1.3, 2.12, 1.6, 0.08, 0.04); // headlights
  for (const s of [-1, 1]) part(MATERIALS.amberLight, s * 0.95, 1.05, -2.21, 0.2, 0.1, 0.04); // tail lights
  const mast = part(MATERIALS.darkMetal, 0.7, 3.0, 0.4, 0.04, 1.0, 0.04);
  mast.castShadow = false;
  const wheel = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 16).rotateZ(Math.PI / 2);
  for (const along of [-1.45, 0, 1.45]) {
    for (const s of [-1, 1]) {
      const tire = new THREE.Mesh(wheel, MATERIALS.graphite);
      tire.position.set(s * 1.22, 0.46, along);
      tire.castShadow = tire.receiveShadow = true;
      group.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 10).rotateZ(Math.PI / 2), MATERIALS.trim);
      hub.position.copy(tire.position);
      group.add(hub);
    }
  }
  boxCollider(world, { x, y: base + 1.3, z }, { x: 2.6, y: 2.6, z: 4.4 }, new THREE.Euler(0, yaw, 0));
}
