import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';

// Rapier ships as WebAssembly and must load before any physics is used.
export async function createPhysicsWorld() {
  await RAPIER.init();
  return new RAPIER.World({ x: 0, y: -CONFIG.gravity, z: 0 });
}

// Adds an immovable box collider (floor, crate, wall, ramp).
// halfSize is half the width/height/depth, which is how Rapier measures boxes.
export function addStaticBox(
  world: RAPIER.World,
  position: { x: number; y: number; z: number },
  halfSize: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 },
) {
  const desc = RAPIER.ColliderDesc.cuboid(halfSize.x, halfSize.y, halfSize.z)
    .setTranslation(position.x, position.y, position.z)
    .setRotation(rotation);
  return world.createCollider(desc);
}
