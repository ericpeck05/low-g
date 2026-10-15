import * as THREE from 'three';
import { playHitSound, unlockAudio } from './audio/sfx';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createScene } from './core/scene';
import { Session } from './core/session';
import { CameraEffects } from './player/cameraEffects';
import { Look } from './player/look';
import { Player } from './player/player';
import { Scoring } from './targets/scoring';
import { TargetManager } from './targets/targetManager';
import { placeTestLevelTargets } from './targets/testLevelTargets';
import { Hud } from './ui/hud';
import { Menu, type Mode } from './ui/menu';
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
  const targets = new TargetManager(scene, world);
  placeTestLevelTargets(targets);
  const scoring = new Scoring();
  const session = new Session();
  const hud = new Hud();
  const menu = new Menu({
    start: startRun,
    resume: () => lockMouse(),
    quitToMenu: () => {
      session.state = 'menu';
      menu.showMain();
    },
  });

  // A warm light at the gun that flashes on each shot and lights up nearby walls.
  const muzzleLight = new THREE.PointLight(0xffb050, 0, 12);
  scene.add(muzzleLight);

  async function lockMouse() {
    unlockAudio(); // browsers only allow sound after a click, and this runs from one
    if (await input.requestLock()) return;
    // The browser said no (it can refuse right after Esc). Show the pause screen
    // so there's a button to try again instead of a frozen game.
    hud.showToast('COULD NOT LOCK THE MOUSE: CLICK RESUME');
    if (session.state === 'playing') menu.showPaused();
  }

  // A fresh run: back to the spawn point, full magazine, all targets up, score zeroed.
  function startRun(mode: Mode) {
    session.start(mode);
    scoring.reset();
    targets.reset();
    rifle.reset();
    const start = CONFIG.player.startPosition;
    player.teleport(start.x, start.y, start.z);
    look.yaw = 0;
    look.pitch = 0;
    menu.hide();
    void lockMouse();
  }

  // Show the right overlay when the mouse is released (Esc) or the run ends.
  document.addEventListener('pointerlockchange', () => {
    if (input.locked) menu.hide();
    else if (session.state === 'playing') menu.showPaused();
  });

  // Everything that happens in one frame. dt is the frame time in seconds.
  function tick(dt: number) {
    const playing = input.locked && session.state === 'playing';
    hud.setVisible(session.state === 'playing');
    let mouse = { x: 0, y: 0 };
    let spread = 0;

    if (playing) {
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
      targets.update(dt); // moves target colliders, so it goes before the physics step
      world.timestep = dt;
      world.step();
      recoil.update(dt);

      if (session.update(dt)) endRun();
    }

    // Place the camera: zoom for aiming, look direction plus recoil, then position.
    camera.fov = THREE.MathUtils.lerp(CONFIG.camera.fov, CONFIG.rifle.adsFov, rifle.aimBlend);
    camera.updateProjectionMatrix();
    look.applyTo(camera, recoil.pitch, recoil.yaw);
    cameraFx.update(dt, player, camera, look.yaw);

    if (playing) {
      spread = rifle.spread(player.horizontalSpeed, player.grounded);
      const shots = rifle.update(dt, input);
      for (let i = 0; i < shots; i++) fireShot(spread);
    }
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 400 * dt);

    // Shake goes on last so it moves the view without moving the aim.
    camera.rotation.x += recoil.shakePitch;
    camera.rotation.y += recoil.shakeYaw;

    viewmodel.update(dt, rifle, mouse, player.horizontalSpeed, player.grounded);
    impacts.update(playing ? dt : 0, camera);
    hud.update(dt, player, rifle, scoring, session.timeLeft, spread, camera.fov, CONFIG.rifle.magazineSize);

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
    const targetHit = hit ? targets.tryHit(hit.collider, hit.point, direction) : null;
    if (hit) impacts.spawn(hit.point, hit.normal);

    const earned = scoring.recordShot(targetHit);
    if (targetHit) {
      hud.showHit(earned, targetHit.label, targetHit.bullseye, scoring.multiplier);
      playHitSound(targetHit.bullseye);
    }

    recoil.kick(rifle.aimBlend);
    viewmodel.fire();
    muzzleLight.position.copy(camera.localToWorld(new THREE.Vector3(0.2, -0.15, -0.9)));
    muzzleLight.intensity = 20;
  }

  function endRun() {
    menu.showResults(scoring);
    document.exitPointerLock();
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
    Object.assign(window, {
      lowg: { input, look, player, camera, world, rifle, recoil, viewmodel, impacts, targets, scoring, session, menu, tick, startRun },
    });
  }
}

boot();
