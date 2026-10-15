import * as THREE from 'three';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createScene } from './core/scene';
import { CameraEffects } from './player/cameraEffects';
import { Look } from './player/look';
import { Player } from './player/player';
import { Hud } from './ui/hud';
import { buildTestLevel } from './world/testLevel';

async function boot() {
  const world = await createPhysicsWorld();
  const { renderer, scene, camera } = createScene();
  buildTestLevel(scene, world);

  const input = new Input(renderer.domElement);
  const look = new Look();
  const player = new Player(world);
  const cameraFx = new CameraEffects();
  const hud = new Hud(async () => {
    if (!(await input.requestLock())) hud.showToast('MOUSE LOCK BLOCKED: OPEN IN A NORMAL BROWSER TAB');
  });

  // Everything that happens in one frame. dt is the frame time in seconds.
  function tick(dt: number) {
    hud.setPaused(!input.locked);

    // Without the mouse locked the game is paused: nothing moves.
    if (input.locked) {
      look.update(input.takeMouseDelta());
      if (input.wasPressed('BracketRight')) look.changeSensitivity(1);
      if (input.wasPressed('BracketLeft')) look.changeSensitivity(-1);
      if (input.wasPressed('BracketLeft', 'BracketRight')) {
        hud.showToast(`SENSITIVITY ${(look.sensitivity * 1000).toFixed(1)}`);
      }

      player.update(dt, input, look.yaw);
      world.timestep = dt;
      world.step();
    }

    look.applyTo(camera);
    cameraFx.update(dt, player, camera, look.yaw);
    hud.update(player);
    renderer.render(scene, camera);
    input.endFrame();
  }

  // The game loop runs once per screen refresh.
  // Cap the frame time so a stall can't make us skip through walls.
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    tick(Math.min(timer.getDelta(), CONFIG.maxFrameTime));
  });

  // Dev-only handle for poking at the game from the browser console.
  // lowg.tick(1 / 60) advances one frame by hand, which is handy for testing.
  if (import.meta.env.DEV) Object.assign(window, { lowg: { input, look, player, camera, world, tick } });
}

boot();
