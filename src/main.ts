import * as THREE from 'three';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createScene } from './core/scene';
import { CameraEffects } from './player/cameraEffects';
import { Look } from './player/look';
import { Player } from './player/player';
import { Hud } from './ui/hud';
import { applySpread, castShot } from './weapons/hitscan';
import { ImpactEffects } from './weapons/impactEffects';
import { Recoil } from './weapons/recoil';
import { Rifle } from './weapons/rifle';
import { Viewmodel } from './weapons/viewmodel';
import { buildTestLevel } from './world/testLevel';

async function boot() {
  const world = await createPhysicsWorld();
  const { renderer, scene, camera } = createScene();
  buildTestLevel(scene, world);

  const input = new Input(renderer.domElement);
  const look = new Look();
  const player = new Player(world);
  const cameraFx = new CameraEffects();
  const rifle = new Rifle();
  const recoil = new Recoil();
  const viewmodel = new Viewmodel();
  const impacts = new ImpactEffects(scene);
  const hud = new Hud(async () => {
    if (!(await input.requestLock())) hud.showToast('MOUSE LOCK BLOCKED: OPEN IN A NORMAL BROWSER TAB');
  });

  // A warm light at the gun that flashes on each shot and lights up nearby walls.
  const muzzleLight = new THREE.PointLight(0xffb050, 0, 12);
  scene.add(muzzleLight);

  // Everything that happens in one frame. dt is the frame time in seconds.
  function tick(dt: number) {
    hud.setPaused(!input.locked);
    let mouse = { x: 0, y: 0 };
    let spread = 0;

    // Without the mouse locked the game is paused: nothing moves.
    if (input.locked) {
      mouse = input.takeMouseDelta();
      // Zoomed in, the same mouse movement turns you less, so aim feels the same.
      const zoomScale = THREE.MathUtils.lerp(1, CONFIG.rifle.adsFov / CONFIG.camera.fov, rifle.aimBlend);
      look.update(mouse, zoomScale);
      if (input.wasPressed('BracketRight')) look.changeSensitivity(1);
      if (input.wasPressed('BracketLeft')) look.changeSensitivity(-1);
      if (input.wasPressed('BracketLeft', 'BracketRight')) {
        hud.showToast(`SENSITIVITY ${(look.sensitivity * 1000).toFixed(1)}`);
      }

      player.update(dt, input, look.yaw, rifle.aiming);
      world.timestep = dt;
      world.step();
      recoil.update(dt);
    }

    // Place the camera: zoom for aiming, look direction plus recoil, then position.
    camera.fov = THREE.MathUtils.lerp(CONFIG.camera.fov, CONFIG.rifle.adsFov, rifle.aimBlend);
    camera.updateProjectionMatrix();
    look.applyTo(camera, recoil.pitch, recoil.yaw);
    cameraFx.update(dt, player, camera, look.yaw);

    if (input.locked) {
      spread = rifle.spread(player.horizontalSpeed, player.grounded);
      const shots = rifle.update(dt, input);
      for (let i = 0; i < shots; i++) fireShot(spread);
    }
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 400 * dt);

    // Shake goes on last so it moves the view without moving the aim.
    camera.rotation.x += recoil.shakePitch;
    camera.rotation.y += recoil.shakeYaw;

    viewmodel.update(dt, rifle, mouse, player.horizontalSpeed, player.grounded);
    impacts.update(input.locked ? dt : 0, camera);
    hud.update(player, rifle, spread, camera.fov, CONFIG.rifle.magazineSize);

    // Draw the world, then the gun on top of it.
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodel.camera);
    input.endFrame();
  }

  function fireShot(spread: number) {
    const aim = camera.getWorldDirection(new THREE.Vector3());
    const direction = applySpread(aim, spread);
    const hit = castShot(world, camera.position, direction, CONFIG.rifle.range, player.collider);
    if (hit) impacts.spawn(hit.point, hit.normal);

    recoil.kick(rifle.aimBlend);
    viewmodel.fire();
    muzzleLight.position.copy(camera.localToWorld(new THREE.Vector3(0.2, -0.15, -0.9)));
    muzzleLight.intensity = 20;
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
  if (import.meta.env.DEV) {
    Object.assign(window, { lowg: { input, look, player, camera, world, rifle, recoil, viewmodel, impacts, tick } });
  }
}

boot();
