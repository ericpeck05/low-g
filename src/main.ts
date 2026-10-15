import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { playHitSound, setMasterVolume, unlockAudio } from './audio/sfx';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createComposer } from './core/postprocessing';
import { createScene } from './core/scene';
import { submitHighScore } from './core/highScores';
import { Session, type Mode } from './core/session';
import { QUALITY_PRESETS, type Quality, settings } from './core/settings';
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
import { Ejecta } from './weapons/ejecta';
import { applySpread, castShot } from './weapons/hitscan';
import { ImpactEffects } from './weapons/impactEffects';
import { Recoil } from './weapons/recoil';
import { Rifle } from './weapons/rifle';
import { Viewmodel } from './weapons/viewmodel';
import { createEnvironment } from './world/environment';
import { Sun, sunDirection } from './world/lighting';
import { scatterRocks } from './world/rocks';
import { Sky } from './world/sky';
import { buildTerrain } from './world/terrain';
import { buildCity } from './world/city';
import { isInsideDome } from './world/city/dome';

async function boot() {
  const world = await createPhysicsWorld();
  const { renderer, scene, camera } = createScene();
  buildTerrain(scene, world);
  const rocks = scatterRocks(scene, world);
  const city = buildCity(scene, world);
  // Reflections and fill light come from the sunlit ground, not the black sky.
  scene.environment = createEnvironment(renderer);
  const sun = new Sun(scene);
  const sky = new Sky(scene);

  const input = new Input(renderer.domElement);
  const look = new Look();
  const player = new Player(world);
  const cameraFx = new CameraEffects();
  const rifle = new Rifle();
  const recoil = new Recoil();
  const viewmodel = new Viewmodel();
  viewmodel.scene.environment = scene.environment;
  const impacts = new ImpactEffects(scene);
  const ejecta = new Ejecta(scene, world, player.collider);
  // Empty magazines fall out of the gun into the world.
  viewmodel.onMagazineDrop = (matrixFromEye) => {
    camera.updateMatrixWorld();
    const matrix = camera.matrixWorld.clone().multiply(matrixFromEye);
    const push = new THREE.Vector3(0, -0.6, 0).add(player.velocity);
    ejecta.magazine(matrix, push);
  };
  const toSun = sunDirection();
  const sunRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, toSun);
  const footsteps = new Footsteps(scene, impacts);
  const targets = new TargetManager(scene, world);
  placeCityTargets(targets);
  const composer = createComposer(renderer, scene, camera);
  composer.excludeFromAO(sky.group, city.glass, footsteps.prints, ...impacts.objects);
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

  // Settings: apply them now and whenever they change in the menu.
  let baseFov = CONFIG.camera.fov;
  let appliedQuality: Quality | null = null;
  settings.watch((s) => {
    look.sensitivity = s.sensitivity;
    baseFov = s.fov;
    setMasterVolume(s.volume);
    if (s.quality !== appliedQuality) {
      appliedQuality = s.quality;
      const q = QUALITY_PRESETS[s.quality];
      composer.setQuality({
        pixelRatio: Math.min(window.devicePixelRatio, q.maxPixelRatio),
        antialiasSamples: q.antialiasSamples,
        ambientOcclusion: q.ambientOcclusion,
      });
      sun.setShadowMapSize(q.shadowMapSize);
      rocks.setDrawScale(q.rockDistance);
    }
  });
  // F3 shows the frame rate and movement numbers, any time.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F3') return;
    e.preventDefault();
    settings.set({ showStats: !settings.get().showStats });
  });
  // On the main menu the camera drifts slowly around the city behind the menu.
  let menuOrbit = 0.6;

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
    ejecta.clear();
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
        settings.set({ sensitivity: look.sensitivity }); // remember it
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

    const backdrop = session.state === 'menu';
    if (backdrop) {
      // Main menu: a slow orbit around the dome.
      menuOrbit += dt * 0.025;
      camera.fov = 50;
      camera.updateProjectionMatrix();
      camera.position.set(Math.sin(menuOrbit) * 178, 34, Math.cos(menuOrbit) * 178);
      camera.lookAt(0, 16, 0);
      sun.update(new THREE.Vector3(0, 0, 0));
    } else {
      // Place the camera: zoom for aiming (relative to your chosen field of view),
      // look direction plus recoil, then position.
      const aimedFov = baseFov * (CONFIG.rifle.adsFov / CONFIG.camera.fov);
      camera.fov = THREE.MathUtils.lerp(baseFov, aimedFov, rifle.aimBlend);
      camera.updateProjectionMatrix();
      look.applyTo(camera, recoil.pitch, recoil.yaw);
      cameraFx.update(dt, player, camera, look.yaw);
      sun.update(player.feet);
    }
    rocks.update(player.feet);
    sky.update(camera, playing ? dt : 0);

    if (playing) {
      spread = rifle.spread(player.horizontalSpeed, player.grounded);
      // No shooting until the gun is back up from a sprint.
      const shots = rifle.update(dt, input, viewmodel.sprintBlend < 0.3);
      for (let i = 0; i < shots; i++) fireShot(spread);
    }
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 400 * dt);

    // Shake goes on last so it moves the view without moving the aim.
    if (!backdrop) {
      camera.rotation.x += recoil.shakePitch;
      camera.rotation.y += recoil.shakeYaw;
    }

    camera.updateMatrixWorld();
    viewmodel.update(dt, rifle, mouse, {
      speed: player.horizontalSpeed,
      grounded: player.grounded,
      sprinting: player.sprinting,
      verticalSpeed: player.velocity.y,
      landingSpeed: player.landingSpeed,
      sunDirection: toSun.clone().applyQuaternion(camera.quaternion.clone().invert()),
      sunlit: inSunlight() ? 1 : 0,
      inside,
    });
    impacts.update(playing ? dt : 0, camera);
    if (playing) ejecta.update(dt);
    hud.update({
      dt,
      player,
      rifle,
      scoring,
      oxygen,
      inside,
      mode: session.mode,
      timeLeft: session.timeLeft,
      survived: session.mode === 'oxygenRun' ? session.elapsed : null,
      drainPerSecond: CONFIG.oxygen.drainRate * session.drainScale,
      spread,
      fov: camera.fov,
      heading: (((-THREE.MathUtils.radToDeg(look.yaw)) % 360) + 360) % 360,
      mouse,
      showStats: settings.get().showStats,
    });

    // Draw the world (with bloom), then the gun on top of it (not behind the main menu).
    composer.render(dt);
    if (!backdrop) {
      renderer.clearDepth();
      renderer.render(viewmodel.scene, viewmodel.camera);
    }
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
    const muzzle = camera.localToWorld(viewmodel.muzzlePoint());
    muzzleLight.position.copy(muzzle);
    muzzleLight.intensity = 14;
    impacts.muzzleSparks(muzzle, aim);
    // Spent brass flies out of the ejection port to the right and tumbles away.
    const port = camera.localToWorld(viewmodel.ejectionPortPoint());
    const out = viewmodel.ejectionDirection().transformDirection(camera.matrixWorld);
    const speed = CONFIG.viewmodel.casingSpeed * (0.85 + Math.random() * 0.3);
    ejecta.casing(port, out.multiplyScalar(speed).add(player.velocity));
  }

  // Is the player's head in sunlight? (The dome glass lets the sun through.)
  function inSunlight() {
    sunRay.origin = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const glass = city.glassCollider.handle;
    const hit = world.castRay(sunRay, 400, true, undefined, undefined, player.collider, undefined, (c) => c.handle !== glass);
    return hit === null;
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
      lowg: { renderer, scene, composer, ejecta, input, look, player, camera, world, city, oxygen, rifle, recoil, viewmodel, impacts, targets, scoring, session, menu, tick, startRun },
    });
  }
}

boot();
