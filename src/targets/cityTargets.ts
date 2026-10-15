import * as THREE from 'three';
import { CONFIG } from '../config';
import {
  BALCONY_EXTRA,
  LANDING_PAD,
  MODULES_CENTER,
  RANGE,
  SOLAR_FIELD,
  TOWERS,
  towerPosition,
} from '../world/city/layout';
import { terrainHeight } from '../world/terrain';
import type { TargetManager } from './targetManager';

// Target courses around the city: the plaza, rooftops, walkways, the indoor range,
// and out on the surface.

const r = () => CONFIG.targets.discRadius;
const POST = 1.4; // height of a target post, from its base to the bottom of the disc

/** A bullseye on a post standing on `base` height, facing `facing`. */
function onPost(targets: TargetManager, x: number, base: number, z: number, facing: THREE.Vector3) {
  targets.addBullseye(new THREE.Vector3(x, base + POST + r(), z), facing.clone().setY(0).normalize(), base);
}

/** Direction from a spot toward the dome's center. */
function towardCenter(x: number, z: number) {
  return new THREE.Vector3(-x, 0, -z);
}

export function placeCityTargets(targets: TargetManager) {
  // Plaza: three around the beacon, facing out.
  for (const bearing of [60, 180, 300]) {
    const b = THREE.MathUtils.degToRad(bearing);
    onPost(targets, Math.sin(b) * 12, 0.2, Math.cos(b) * 12, new THREE.Vector3(Math.sin(b), 0, Math.cos(b)));
  }

  // Walkway balconies: one per tower, on the plaza side.
  // Rooftops: on every tower you can reach (a jetpack climb from the walkway).
  for (const tower of TOWERS) {
    const p = towerPosition(tower);
    const inward = towardCenter(p.x, p.z).normalize();
    const balcony = p.clone().addScaledVector(inward, tower.radius + BALCONY_EXTRA - 1);
    onPost(targets, balcony.x, CONFIG.city.walkwayHeight, balcony.z, inward);
    if (tower.height <= 17) {
      const roof = p.clone().addScaledVector(inward, tower.radius - 1.5);
      onPost(targets, roof.x, tower.height, roof.z, inward);
    }
  }

  // Drones drifting under the dome, above the beacon and between the towers.
  targets.addDrone(new THREE.Vector3(0, 22, 0), new THREE.Vector3(28, 4, 28), 0.7);
  targets.addDrone(new THREE.Vector3(0, 30, 0), new THREE.Vector3(20, 3, 20), 0.5);

  // The indoor range: shoot from the counter toward +x.
  const back = new THREE.Vector3(-1, 0, 0);
  for (const z of [-6, -2, 2, 6]) targets.addBullseye(new THREE.Vector3(RANGE.xEnd - 0.05, 2.2, z), back);
  for (const z of [-5, 0, 5]) targets.addPopup(new THREE.Vector3(50, 0.06, z), back);
  for (const z of [-3, 3]) onPost(targets, 42, 0.06, z, back);

  // Landing pad: drones circling, pop-ups on the deck.
  targets.addDrone(new THREE.Vector3(LANDING_PAD.x, 9, LANDING_PAD.z), new THREE.Vector3(14, 3, 12), 0.9);
  targets.addDrone(new THREE.Vector3(-30, 6, 125), new THREE.Vector3(8, 2, 10), 0.8);
  for (const [x, z] of [
    [-9, 120],
    [9, 136],
    [-6, 138],
  ]) {
    targets.addPopup(new THREE.Vector3(x, 0.3, z), towardCenter(x, z));
  }
  // On top of the stacked containers.
  onPost(targets, -24, 5.2, 122, new THREE.Vector3(1, 0, -1));

  // Solar field: pop-ups in front of the first row, bullseyes down the aisles.
  const east = new THREE.Vector3(1, 0, 0);
  for (const z of [-24, -8, 8, 24]) targets.addPopup(new THREE.Vector3(SOLAR_FIELD.xStart + 5, 0, z), east);
  for (const [row, z] of [
    [0, -18],
    [2, 6],
    [4, 20],
  ]) {
    const x = SOLAR_FIELD.xStart - (row + 0.5) * SOLAR_FIELD.rowSpacing;
    onPost(targets, x, 0, z, east);
  }

  // On top of two habitat modules (7.5 m: a jump plus the jetpack).
  for (const [x, z] of [
    [MODULES_CENTER.x - 8, MODULES_CENTER.z - 10],
    [MODULES_CENTER.x + 12, MODULES_CENTER.z + 4],
  ]) {
    onPost(targets, x, 7.5, z, towardCenter(x, z));
  }

  // Out in the open, past the edge of the flat ground.
  for (const [x, z] of [
    [0, -230],
    [190, -70],
    [-175, 160],
    [210, 170],
  ]) {
    onPost(targets, x, terrainHeight(x, z), z, towardCenter(x, z));
  }
}
