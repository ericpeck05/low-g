import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Combines the meshes inside `group` that share a material into one mesh each,
 * kept in the group's own space so the group can still move as a whole.
 * Each separate mesh costs a draw call (in every render pass), so a model built
 * from a hundred small parts draws far faster this way.
 *
 * Leaves alone: anything in `keep` (and everything inside it), see-through
 * materials, instanced meshes, and meshes with several materials.
 */
export function mergeRigidParts(group: THREE.Object3D, keep: THREE.Object3D[] = []) {
  group.updateMatrixWorld(true);
  const toLocal = group.matrixWorld.clone().invert();
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => kept.add(o));

  const buckets = new Map<THREE.Material, { cast: boolean; receive: boolean; parts: THREE.BufferGeometry[] }>();
  const merged: THREE.Mesh[] = [];
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || kept.has(mesh) || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    if (Array.isArray(mesh.material) || mesh.material.transparent) return;
    const relative = toLocal.clone().multiply(mesh.matrixWorld);
    let geometry = mesh.geometry.clone().applyMatrix4(relative);
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    }
    if (!geometry.attributes.uv) {
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    }
    if (!buckets.has(mesh.material)) buckets.set(mesh.material, { cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] });
    buckets.get(mesh.material)!.parts.push(geometry);
    merged.push(mesh);
  });
  for (const mesh of merged) mesh.removeFromParent();
  for (const [material, { cast, receive, parts }] of buckets) {
    const geometry = mergeGeometries(parts);
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
  }
  return { before: merged.length, after: buckets.size };
}
