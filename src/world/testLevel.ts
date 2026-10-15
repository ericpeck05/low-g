import * as THREE from 'three';
import { CONFIG } from '../config';

// The phase 0 test level: a flat gray floor lit by one sun.
export function buildTestLevel(scene: THREE.Scene) {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.floor.size, CONFIG.floor.size),
    new THREE.MeshStandardMaterial({ color: CONFIG.floor.color }),
  );
  floor.rotation.x = -Math.PI / 2; // planes start upright, so lay it flat
  floor.receiveShadow = true;
  scene.add(floor);

  // A grid helps judge distance and movement until the floor gets a texture.
  const grid = new THREE.GridHelper(CONFIG.floor.size, CONFIG.floor.size, 0x555555, 0x555555);
  grid.position.y = 0.01; // just above the floor so it doesn't flicker
  scene.add(grid);

  const sun = new THREE.DirectionalLight(CONFIG.lighting.sunColor, CONFIG.lighting.sunIntensity);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  scene.add(sun);

  scene.add(new THREE.AmbientLight(0xffffff, CONFIG.lighting.ambientIntensity));
}
