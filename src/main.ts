import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config';
import { createScene } from './core/scene';
import { buildTestLevel } from './world/testLevel';

async function boot() {
  // Rapier ships as WebAssembly and must load before any physics is used.
  await RAPIER.init();
  const physicsWorld = new RAPIER.World({ x: 0, y: -CONFIG.gravity, z: 0 });

  const { renderer, scene, camera } = createScene();
  buildTestLevel(scene);

  camera.position.set(0, CONFIG.camera.startHeight, 8);
  camera.lookAt(0, 0, 0);

  // The game loop: step physics, then draw a frame, about 60 times a second.
  renderer.setAnimationLoop(() => {
    physicsWorld.step();
    renderer.render(scene, camera);
  });
}

boot();
