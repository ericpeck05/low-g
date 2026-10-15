import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { addStaticBox } from '../core/physics';

// Colors for the test props. Warm grays, with amber on things you need the jetpack for.
const GRAY_LIGHT = 0xa8a49e;
const GRAY_DARK = 0x5e5b57;
const AMBER = 0xc77a1c;

// The movement sandbox: a flat floor with crates, ramps, steps, a crouch
// tunnel and tall pillars, so every movement ability has something to test on.
export function buildTestLevel(scene: THREE.Scene, world: RAPIER.World) {
  addLights(scene);
  addFloor(scene, world);

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

function addLights(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(CONFIG.lighting.sunColor, CONFIG.lighting.sunIntensity);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  // The shadow camera has to cover the whole test area.
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0xffffff, CONFIG.lighting.ambientIntensity));
}

function addFloor(scene: THREE.Scene, world: RAPIER.World) {
  const size = CONFIG.floor.size;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: CONFIG.floor.color }),
  );
  floor.rotation.x = -Math.PI / 2; // planes start upright, so lay it flat
  floor.receiveShadow = true;
  scene.add(floor);

  // A grid helps judge distance and speed until the floor gets a real texture.
  const grid = new THREE.GridHelper(size, size, 0x555555, 0x555555);
  grid.position.y = 0.01; // just above the floor so it doesn't flicker
  scene.add(grid);

  // The physics floor is a thick slab whose top surface sits at y = 0.
  addStaticBox(world, { x: 0, y: -0.5, z: 0 }, { x: size / 2, y: 0.5, z: size / 2 });

  // Invisible walls around the edge so you can't jetpack off the world.
  const half = size / 2;
  const wallHeight = 50;
  addStaticBox(world, { x: 0, y: wallHeight / 2, z: half + 0.5 }, { x: half, y: wallHeight / 2, z: 0.5 });
  addStaticBox(world, { x: 0, y: wallHeight / 2, z: -half - 0.5 }, { x: half, y: wallHeight / 2, z: 0.5 });
  addStaticBox(world, { x: half + 0.5, y: wallHeight / 2, z: 0 }, { x: 0.5, y: wallHeight / 2, z: half });
  addStaticBox(world, { x: -half - 0.5, y: wallHeight / 2, z: 0 }, { x: 0.5, y: wallHeight / 2, z: half });
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
