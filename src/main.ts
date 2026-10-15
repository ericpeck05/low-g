import * as THREE from 'three';
import { playHitSound, unlockAudio } from './audio/sfx';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createComposer } from './core/postprocessing';
import { createScene } from './core/scene';
import { submitHighScore } from './core/highScores';
import { Session, type Mode } from './core/session';
import { CameraEffects } from './player/cameraEffects';
import { Footsteps } from './player/footsteps';
import { Oxygen } from './player/oxygen';
import { Look } from './player/look';
import { Player } from './player/player';
import { Scoring } from './targets/scoring';
import { TargetManager } from './targets/targetManager';
import { placeCityTargets } from './targets/cityTargets';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import type { HitResult } from './targets/target';
import { applySpread, castShot } from './weapons/hitscan';
import { ImpactEffects } from './weapons/impactEffects';
import { Recoil } from './weapons/recoil';
import { Rifle } from './weapons/rifle';
import { Viewmodel } from './weapons/viewmodel';
import { Sun } from './world/lighting';
import { scatterRocks } from './world/rocks';
import { Sky } from './world/sky';
import { buildTerrain } from './world/terrain';
import { buildCity } from './world/city';
import { isInsideDome } from './world/city/dome';

async function boot() {
  const world = await createPhysicsWorld();
  const { renderer, scene, camera } = createScene();
  buildTerrain(scene, world);
  scatterRocks(scene, world);
  const city = buildCity(scene, world);
  const sun = new Sun(scene);
  const sky = new Sky(scene);

  const input = new Input(renderer.domElement);
  const look = new Look();
  const player = new Player(world);
  const cameraFx = new CameraEffects();
  const rifle = new Rifle();
  const recoil = new Recoil();
  const viewmodel = new Viewmodel();
  const impacts = new ImpactEffects(scene);
  const footsteps = new Footsteps(scene, impacts);
  const targets = new TargetManager(scene, world);
  placeCityTargets(targets);
  const composer = createComposer(renderer, scene, camera);
  const scoring = new Scoring();
  const session = new Session();
  const oxygen = new Oxygen();
  let inside = true; // breathing dome air (inside the dome or an airlock chamber)
  const hud = new Hud();
  const menu = new Menu({
    start: startRun,
    resume: () => lockMouse(),
    quitToMenu: () => {
      // Range has no end screen, so its best score is saved when you leave it.
      if (session.mode === 'range' && session.state === 'playing') submitHighScore('range', scoring.score);
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

  // A fresh run: to the mode's start spot, full air and magazine, all targets up, score zeroed.
  function startRun(mode: Mode) {
    session.start(mode);
    scoring.reset();
    targets.reset();
    footsteps.clear();
    rifle.reset();
    oxygen.reset();
    // The oxygen run keeps you outside: the airlocks stay sealed.
    for (const airlock of city.airlocks) airlock.locked = mode === 'oxygenRun';
    placePlayer(mode === 'oxygenRun' ? CONFIG.scoring.oxygenRunStart : CONFIG.scoring.rangeStart);
    menu.hide();
    void lockMouse();
  }

  // bearing: the compass direction to face (180 = toward -z), same as the sky and city layout.
  function placePlayer(spot: { x: number; y: number; z: number; bearing: number }) {
    player.teleport(spot.x, spot.y, spot.z);
    look.yaw = THREE.MathUtils.degToRad(spot.bearing + 180);
    look.pitch = 0;
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
      footsteps.update(dt, player, look.yaw);
      // These move colliders (targets, airlock doors), so they go before the physics step.
      targets.update(dt, player.feet);
      city.update(dt, player.feet);
      world.timestep = dt;
      world.step();
      recoil.update(dt);

      // Air: the dome and the airlock chambers are pressurized; everywhere else is vacuum.
      const feet = player.feet;
      inside = isInsideDome(feet) || city.airlocks.some((airlock) => airlock.inChamber(feet));
      if (oxygen.update(dt, inside, session.drainScale)) outOfOxygen();

      if (session.update(dt)) endRun();
    }

    // Place the camera: zoom for aiming, look direction plus recoil, then position.
    camera.fov = THREE.MathUtils.lerp(CONFIG.camera.fov, CONFIG.rifle.adsFov, rifle.aimBlend);
    camera.updateProjectionMatrix();
    look.applyTo(camera, recoil.pitch, recoil.yaw);
    cameraFx.update(dt, player, camera, look.yaw);
    sun.update(player.feet);
    sky.update(camera);

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
    const survived = session.mode === 'oxygenRun' ? session.elapsed : null;
    hud.update(dt, player, rifle, scoring, oxygen, inside, session.timeLeft, survived, spread, camera.fov, CONFIG.rifle.magazineSize);

    // Draw the world (with bloom), then the gun on top of it.
    composer.render(dt);
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
      // Out on the surface, every hit buys a little air.
      const bonus = inside ? 0 : oxygenReward(targetHit);
      oxygen.reward(bonus);
      hud.showHit(earned, targetHit.label, targetHit.bullseye, scoring.multiplier, bonus);
      playHitSound(targetHit.bullseye);
    }

    recoil.kick(rifle.aimBlend);
    viewmodel.fire();
    muzzleLight.position.copy(camera.localToWorld(new THREE.Vector3(0.2, -0.15, -0.9)));
    muzzleLight.intensity = 20;
  }

  function oxygenReward(hit: HitResult) {
    const cfg = CONFIG.oxygen;
    if (hit.label === 'DRONE') return cfg.droneReward;
    return hit.bullseye ? cfg.bullseyeReward : cfg.hitReward;
  }

  function outOfOxygen() {
    if (session.mode === 'range') {
      // Practice is forgiving: you black out and wake up back in the plaza.
      placePlayer(CONFIG.scoring.rangeStart);
      oxygen.reset();
      hud.showToast('OXYGEN DEPLETED: RETURNED TO THE DOME');
      return;
    }
    session.end('oxygen');
    endRun();
  }

  // Shows the results and records a high score. Time Trial and Range rank by score,
  // the Oxygen Run by how long you survived.
  function endRun() {
    const mode = session.mode;
    const value = mode === 'oxygenRun' ? Math.floor(session.elapsed) : scoring.score;
    const newBest = submitHighScore(mode, value);
    menu.showResults({ mode, reason: session.endReason ?? 'timeUp', scoring, survived: session.elapsed, newBest });
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
      lowg: { input, look, player, camera, world, city, oxygen, rifle, recoil, viewmodel, impacts, targets, scoring, session, menu, tick, startRun },
    });
  }
}

boot();
