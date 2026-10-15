import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { addStaticBox } from '../core/physics';

// Colors for the test props. Warm grays, with amber on things you need the jetpack for.
const GRAY_LIGHT = 0xa8a49e;
const GRAY_DARK = 0x5e5b57;
const AMBER = 0xc77a1c;

// The movement sandbox in the flat middle of the map: crates, ramps, steps, a
// crouch tunnel and tall pillars, so every movement ability has something to test on.
// Phase 5 replaces this with the city.
export function buildTestLevel(scene: THREE.Scene, world: RAPIER.World) {
  // Crates of rising height. The jump reaches about 3.2 m.
  addBox(scene, world, [-6, 0, 0], [2, 1, 2], GRAY_LIGHT);
  addBox(scene, world, [-9, 0, 0], [2, 2, 2], GRAY_LIGHT);
  addBox(scene, world, [-12, 0, 0], [2, 3, 2], GRAY_DARK);
  addBox(scene, world, [-15, 0, 0], [2, 4, 2], GRAY_DARK); // too high to jump: needs a little jetpack

  // Ramps leading up to platforms: gentle, steep, and too steep to climb.
  addRampWithPlatform(scene, world, 6, 0, 15);
  addRampWithPlatform(scene, world, 11, 0, 30);
  addRampWithPlatform(scene, world, 16, 0, 55); // steeper than maxSlopeDegrees: you slide off

  // Small steps you can walk up without jumping.
  for (let i = 0; i < 6; i++) {
    addBox(scene, world, [0, 0, -8 - i * 0.6], [3, 0.25 * (i + 1), 0.6], GRAY_LIGHT);
  }

  // A long wall to run and slide along.
  addBox(scene, world, [0, 0, -20], [24, 4, 0.5], GRAY_DARK);

  // Crouch tunnel: the roof is lower than standing height but higher than crouch height.
  const roofBottom = 1.4;
  addBox(scene, world, [-12, 0, -12], [0.4, roofBottom, 6], GRAY_DARK);
  addBox(scene, world, [-9.6, 0, -12], [0.4, roofBottom, 6], GRAY_DARK);
  addBox(scene, world, [-10.8, roofBottom, -12], [2.8, 0.3, 6], GRAY_LIGHT);

  // Jetpack pillars: too tall to reach with a jump alone.
  addBox(scene, world, [12, 0, -12], [3, 6, 3], AMBER);
  addBox(scene, world, [18, 0, -14], [3, 9, 3], AMBER);
}

// A box sitting on the ground. position is [x, bottom y, z], size is [width, height, depth].
function addBox(
  scene: THREE.Scene,
  world: RAPIER.World,
  [x, bottom, z]: number[],
  [w, h, d]: number[],
  color: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color }),
  );
  mesh.position.set(x, bottom + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  addStaticBox(world, mesh.position, { x: w / 2, y: h / 2, z: d / 2 });
}

// A ramp rising toward -z from the given spot, with a platform at the top.
function addRampWithPlatform(
  scene: THREE.Scene,
  world: RAPIER.World,
  x: number,
  z: number,
  angleDegrees: number,
) {
  const length = 7;
  const width = 3;
  const thickness = 0.2;
  const angle = THREE.MathUtils.degToRad(angleDegrees);
  const rise = Math.sin(angle) * length;
  const run = Math.cos(angle) * length;

  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(width, thickness, length),
    new THREE.MeshStandardMaterial({ color: GRAY_LIGHT }),
  );
  ramp.position.set(x, rise / 2, z - run / 2);
  ramp.rotation.x = angle; // tilting around x lifts the far (-z) end
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  scene.add(ramp);
  addStaticBox(world, ramp.position, { x: width / 2, y: thickness / 2, z: length / 2 }, ramp.quaternion);

  addBox(scene, world, [x, 0, z - run - 1.5], [width, rise, 3], GRAY_DARK);
}
