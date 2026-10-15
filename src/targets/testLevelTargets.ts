import * as THREE from 'three';
import { CONFIG } from '../config';
import type { TargetManager } from './targetManager';

// Where the targets go in the movement sandbox. Most of them face the spawn point.
const SPAWN = new THREE.Vector3(CONFIG.player.startPosition.x, 1.5, CONFIG.player.startPosition.z);

function facingSpawn(from: THREE.Vector3) {
  return SPAWN.clone().sub(from).setY(0).normalize();
}

export function placeTestLevelTargets(targets: TargetManager) {
  const r = CONFIG.targets.discRadius;
  const south = new THREE.Vector3(0, 0, 1);

  // A row on the long wall (its front face is at z = -19.75).
  for (const x of [-8, -3, 3, 8]) {
    targets.addBullseye(new THREE.Vector3(x, 2.2, -19.7), south);
  }

  // Free-standing targets on posts around the field.
  for (const [x, z] of [
    [-24, -6],
    [-30, 14],
    [26, -22],
  ]) {
    const center = new THREE.Vector3(x, 1.4 + r, z);
    targets.addBullseye(center, facingSpawn(center), 0);
  }

  // Rewards for climbing: on the 4 m crate and the 6 m jetpack pillar.
  const onCrate = new THREE.Vector3(-15, 4 + 0.6 + r, 0);
  targets.addBullseye(onCrate, facingSpawn(onCrate), 4);
  const onPillar = new THREE.Vector3(12, 6 + 0.6 + r, -12);
  targets.addBullseye(onPillar, facingSpawn(onPillar), 6);

  // The pop-up field, off to the right.
  for (const [x, z] of [
    [24, 6],
    [27, 12],
    [30, 3],
    [32, 15],
    [35, 8],
    [28, -2],
  ]) {
    const base = new THREE.Vector3(x, 0, z);
    targets.addPopup(base, facingSpawn(base));
  }

  // Drones drifting over the field at different heights and speeds.
  targets.addDrone(new THREE.Vector3(-20, 6, 8), new THREE.Vector3(6, 1.5, 5), 1);
  targets.addDrone(new THREE.Vector3(0, 9, -4), new THREE.Vector3(10, 2, 4), 0.8);
  targets.addDrone(new THREE.Vector3(18, 12, -28), new THREE.Vector3(8, 2, 5), 1.2);
  targets.addDrone(new THREE.Vector3(-26, 4, -26), new THREE.Vector3(5, 1, 6), 0.7);
}
