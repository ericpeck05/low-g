import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3; // which way the hit surface faces
  collider: RAPIER.Collider;
}

// Fires an instant, invisible line from the eye and returns the first thing it touches.
// "Hitscan" means there is no bullet travel time: the hit happens the same frame.
export function castShot(
  world: RAPIER.World,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  range: number,
  ignore: RAPIER.Collider,
  passes?: (collider: RAPIER.Collider) => boolean, // false for colliders the shot goes through
): Hit | null {
  const ray = new RAPIER.Ray(origin, direction);
  const result = world.castRayAndGetNormal(ray, range, true, undefined, undefined, ignore, undefined, passes);
  if (!result) return null;

  const point = origin.clone().addScaledVector(direction, result.timeOfImpact);
  const normal = new THREE.Vector3(result.normal.x, result.normal.y, result.normal.z);
  return { point, normal, collider: result.collider };
}

// Turns the aim direction by a random amount inside a cone of `spreadDegrees`.
export function applySpread(direction: THREE.Vector3, spreadDegrees: number) {
  if (spreadDegrees <= 0) return direction.clone();
  // Pick a random point in a disc so shots cluster evenly, not toward the edges.
  const radius = Math.tan(THREE.MathUtils.degToRad(spreadDegrees)) * Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;

  // Two directions at right angles to the aim, to offset along.
  const side = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, direction).normalize();

  return direction
    .clone()
    .addScaledVector(side, Math.cos(angle) * radius)
    .addScaledVector(up, Math.sin(angle) * radius)
    .normalize();
}
