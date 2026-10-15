import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';

// Draws the world through a bloom filter, so bright lights (windows, light
// strips, the beacon) glow softly into their surroundings.
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const { strength, radius, threshold } = CONFIG.bloom;
  // Bloom works at half resolution: it's a blur, so it looks the same and costs a quarter.
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass()); // converts to screen colors at the end

  window.addEventListener('resize', () => {
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.resolution.set(window.innerWidth / 2, window.innerHeight / 2);
  });
  return composer;
}
