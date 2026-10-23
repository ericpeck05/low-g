import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GameAudio } from './audio/gameAudio';
import { CONFIG } from './config';
import { Input } from './core/input';
import { createPhysicsWorld } from './core/physics';
import { createComposer } from './core/postprocessing';
import { createScene } from './core/scene';
import { submitHighScore, submitSiegeKills } from './core/highScores';
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
import { Hud, type SiegeReadout } from './ui/hud';
import { loading } from './ui/loading';
import { Menu } from './ui/menu';
import { RoundHud } from './ui/roundHud';
import { SuitHud } from './ui/suitHud';
import { type DroneHit, type SiegeEvent, type SiegePlayer, SiegeMode } from './siege/siege';
import { WeaponStations } from './siege/stations';
import { AlertLighting } from './siege/alertLighting';
import { Progression } from './siege/progression';
import { SiegeHud } from './ui/siegeHud';
import { SalvageHud } from './ui/salvageHud';
import { SalvageRun } from './salvage/salvage';
import { recordRun } from './salvage/quartermaster';
import { setAnnouncerVolume } from './audio/announcer';
import type { HitResult } from './targets/target';
import { Ejecta } from './weapons/ejecta';
import { applySpread, castShot } from './weapons/hitscan';
import { ImpactEffects } from './weapons/impactEffects';
import { Recoil } from './weapons/recoil';
import type { Gun } from './weapons/gun';
import { Loadout } from './weapons/loadout';
import { buildSiegeGun } from './weapons/siegeGuns';
import { Tracers } from './weapons/tracers';
import { type WeaponId, type WeaponSpec, damageAt, rangeRifle, siegeWeapon } from './weapons/weaponSpec';
import { Viewmodel } from './weapons/viewmodel';
import { createEnvironment } from './world/environment';
import { Sun, sunDirection } from './world/lighting';
import { scatterRocks } from './world/rocks';
import { Sky } from './world/sky';
import { buildTerrain } from './world/terrain';
import { buildCity } from './world/city';
import { isInsideDome } from './world/city/dome';

async function boot() {
  // Each step shows on the loading screen. The fractions are how far along the whole
  // load is when that step starts (measured: the terrain and the sky take longest).
  await loading.step(0.02, 'STARTING PHYSICS');
  const world = await createPhysicsWorld();
  const { renderer, scene, camera } = createScene();
  renderer.info.autoReset = false; // counted per frame (not per pass) for the F3 readout
  await loading.step(0.04, 'SHAPING THE TERRAIN');
  buildTerrain(scene, world);
  await loading.step(0.3, 'SCATTERING ROCKS');
  const rocks = scatterRocks(scene, world);
  await loading.step(0.4, 'BUILDING THE CITY');
  const city = buildCity(scene, world);
  await loading.step(0.42, 'LIGHTING THE SKY');
  // Reflections and fill light come from the sunlit ground, not the black sky.
  scene.environment = createEnvironment(renderer);
  const sun = new Sun(scene);
  const sky = new Sky(scene);
  await loading.step(0.7, 'ASSEMBLING THE RIFLE');

  const input = new Input(renderer.domElement);
  const look = new Look();
  const player = new Player(world);
  const cameraFx = new CameraEffects();
  // The guns you carry: just the rifle, except in Drone Siege.
  const loadout = new Loadout();
  loadout.equip([rangeRifle()]);
  const recoil = new Recoil();
  const viewmodel = new Viewmodel();
  viewmodel.scene.environment = scene.environment;
  const impacts = new ImpactEffects(scene);
  const ejecta = new Ejecta(scene, world, player.collider);
  // Empty magazines fall out of the gun into the world.
  viewmodel.onMagazineDrop = (matrixFromEye, weapon) => {
    camera.updateMatrixWorld();
    const matrix = camera.matrixWorld.clone().multiply(matrixFromEye);
    const push = new THREE.Vector3(0, -0.6, 0).add(player.velocity);
    ejecta.magazine(matrix, push, weapon);
  };
  for (const id of ['sidearm', 'smg', 'scatter', 'carbine', 'rail', 'singularity', 'arc'] as const) ejecta.addMagazineTemplate(id, viewmodel.modelFor(id).magazine);
  const tracers = new Tracers(scene);
  const toSun = sunDirection();
  const sunRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, toSun);
  const footsteps = new Footsteps(scene, impacts);
  const targets = new TargetManager(scene, world);
  placeCityTargets(targets);
  const siege = new SiegeMode(scene, world, impacts);
  const stations = new WeaponStations(scene, buildSiegeGun);
  const composer = createComposer(renderer, scene, camera, viewmodel);
  composer.excludeFromAO(sky.group, ...city.glass, footsteps.prints, ...impacts.objects, ...siege.glowObjects, tracers.group);
  const scoring = new Scoring();
  const session = new Session();
  const oxygen = new Oxygen();
  let inside = true; // breathing dome air (inside the dome or an airlock chamber)
  const hud = new Hud();
  const suitHud = new SuitHud(hud);
  const roundHud = new RoundHud(hud); // added after the suit readout, so it sits above it
  const siegeHud = new SiegeHud(hud);
  await loading.step(0.71, 'RECORDING SOUNDS');
  const audio = new GameAudio();
  let lastReloadProgress = 0; // for timing reload sounds to the animation
  let frameTime = 1 / 60; // how long the last frame really took, for the F3 readout
  const menu = new Menu({
    start: startRun,
    resume: () => lockMouse(),
    quitToMenu: () => {
      // Range has no end screen, so its best score is saved when you leave it.
      if (session.mode === 'range' && session.state === 'playing') submitHighScore('range', scoring.score);
      session.state = 'menu';
      siege.stop();
      progression.reset(false);
      salvage.reset(false);
      composer.setTint(NO_TINT);
      suitHud.setActive(false);
      roundHud.setActive(false);
      siegeHud.setActive(false);
      salvageHud.setActive(false);
      menu.showMain();
    },
  });

  // Settings: apply them now and whenever they change in the menu.
  let baseFov = CONFIG.camera.fov;
  let appliedQuality: Quality | null = null;
  settings.watch((s) => {
    look.sensitivity = s.sensitivity;
    baseFov = s.fov;
    audio.setVolume(s.volume);
    audio.setMusicVolume(s.music);
    setAnnouncerVolume(s.volume);
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
  // Salvage Run's storm warms the whole picture as its radiation builds.
  const NO_TINT = new THREE.Color(1, 1, 1);
  const STORM_TINT = new THREE.Color(1, 0.84, 0.66);
  const stormTint = new THREE.Color();

  // A warm light at the gun that flashes on each shot and lights up nearby walls.
  const muzzleLight = new THREE.PointLight(0xffb050, 0, 12);
  const MUZZLE_LIGHT: Record<WeaponId, number> = { rifle: 14, sidearm: 10, smg: 8, scatter: 22, carbine: 14, rail: 26, singularity: 18, arc: 16 }; // how bright, per gun
  const CASING_SIZE: Partial<Record<string, number>> = { sidearm: 0.75, scatter: 2 }; // shells are bigger than rifle cases
  scene.add(muzzleLight);
  // Swarm rounds turn the city's lights red (not the gun's flash or explosions).
  const alertLighting = new AlertLighting(scene, composer.setTint, [muzzleLight, siege.effects.light]);
  // Drone Siege's sections, power, suit mods, Supply Drop, Overclock and power-ups.
  const progression = new Progression({
    scene,
    world,
    siege,
    stations,
    loadout,
    player,
    oxygen,
    audio,
    hud,
    roundHud,
    buildGun: buildSiegeGun,
    keepLights: [muzzleLight, siege.effects.light],
  });
  composer.excludeFromAO(...progression.glowObjects);
  // Salvage Run's caches, storm clock, banking and threat (its drones are Drone Siege's).
  const salvageHud = new SalvageHud(hud);
  const salvage = new SalvageRun({ scene, world, siege, player, oxygen, loadout, audio, hud, salvageHud });
  composer.excludeFromAO(...salvage.glowObjects);

  async function lockMouse() {
    audio.unlock(); // browsers only allow sound after a click, and this runs from one
    if (await input.requestLock()) return;
    // The browser said no (it can refuse right after Esc). Show the pause screen
    // so there's a button to try again instead of a frozen game.
    hud.showToast('COULD NOT LOCK THE MOUSE: CLICK RESUME');
    if (session.state === 'playing') menu.showPaused();
  }

  // A fresh run: to the mode's start spot, full air and magazine, all targets up, score zeroed.
  function startRun(mode: Mode) {
    const drones = mode === 'siege' || mode === 'salvage';
    session.start(mode);
    scoring.reset();
    targets.reset();
    footsteps.clear();
    ejecta.clear();
    tracers.clear();
    salvageHud.setActive(mode === 'salvage');
    composer.setTint(NO_TINT);
    progression.reset(mode === 'siege');
    salvage.reset(mode === 'salvage'); // (puts the Quartermaster's perks on you)
    // Drone Siege starts you with a sidearm and an empty slot, Salvage Run with a sidearm and
    // a carbine; everything else, the rifle.
    loadout.equip(mode === 'siege' ? [siegeWeapon('sidearm'), null] : mode === 'salvage' ? salvage.startingGuns() : [rangeRifle()]);
    viewmodel.setWeapon(loadout.current.spec.id);
    stations.setActive(mode === 'siege');
    oxygen.reset();
    // The oxygen run keeps you outside: the airlocks stay sealed.
    for (const airlock of city.airlocks) airlock.locked = mode === 'oxygenRun';
    placePlayer(mode === 'oxygenRun' ? CONFIG.scoring.oxygenRunStart : mode === 'salvage' ? CONFIG.salvage.start : CONFIG.scoring.rangeStart);
    // With drones about, the practice targets stand down.
    targets.setActive(!drones);
    suitHud.setActive(drones);
    roundHud.setActive(mode === 'siege');
    siegeHud.setActive(mode === 'siege');
    if (drones) siege.start();
    else siege.stop();
    // Salvage Run brings its drones in itself, so the rounds don't run.
    siege.autoRounds = mode === 'siege';
    menu.hide();
    void lockMouse();
  }

  // The player as the hostile drones see them.
  function siegePlayer(): SiegePlayer {
    const feet = player.feet;
    return {
      feet,
      head: feet.clone().setY(feet.y + player.height - 0.15),
      height: player.height,
      velocity: player.velocity,
      collider: player.collider,
    };
  }

  // Sounds and visor feedback for what happened in the fight this frame.
  function onSiegeEvents(events: SiegeEvent[]) {
    for (const event of events) {
      if (event.kind === 'charge') audio.droneCharge(event.position);
      else if (event.kind === 'fire') audio.droneFire(event.position);
      else if (event.kind === 'boltImpact') audio.boltImpact(event.position);
      else if (event.kind === 'whiz') audio.boltWhiz(event.position);
      else if (event.kind === 'spawnWarning') audio.spawnWarning(event.position);
      else if (event.kind === 'roundStart') {
        if (event.special === 'normal') audio.roundStart();
        else audio.specialRound(event.special);
        roundHud.roundStarted(event.round, event.special);
        progression.onRoundStart();
      } else if (event.kind === 'roundEnd') {
        audio.roundEnd();
        roundHud.roundEnded(event.round, event.special);
      } else if (event.kind === 'shieldBlock') audio.shieldBlock(event.position);
      else if (event.kind === 'sniperAim') audio.sniperAim(event.position);
      else if (event.kind === 'sniperShot') audio.sniperShot(event.position);
      else if (event.kind === 'launch') audio.carrierLaunch(event.position);
      else if (event.kind === 'blast' || event.kind === 'weakPoint') audio.droneExplosion(event.position);
      else if (event.kind === 'beep') audio.kamikazeBeep(event.position);
      else if (event.kind === 'carrierDown') audio.carrierDown(event.position);
      else if (event.kind === 'maxAmmo') progression.dropMaxAmmo(event.position, player.feet);
      else if (event.kind === 'killed') {
        if (session.mode === 'salvage') salvage.onKill();
        else progression.onKill(event.position);
      }
      else if (event.kind === 'singularity') {
        if (event.formed) audio.singularityHum(event.position);
        else audio.singularityCollapse(event.position);
      }
      else if (event.kind === 'playerHit') {
        audio.suitHit();
        suitHud.hit(event.from);
        if (session.mode === 'salvage') salvage.onPlayerHit();
      } else if (event.kind === 'suitDestroyed') suitBroke();
    }
  }

  // Your suit broke. Auto-Medic may get you back up; otherwise that's the game (and in a
  // Salvage Run, what you were carrying is lost).
  function suitBroke() {
    if (session.state !== 'playing') return;
    if (session.mode === 'siege' && progression.revive('suit')) return;
    if (session.mode === 'salvage') {
      if (salvage.revive('suit')) return;
      salvage.lose();
    }
    session.end('destroyed');
    endRun();
  }

  // How much faster than usual oxygen drains outside right now: the Oxygen Run speeds up,
  // Drone Siege's O2 Recycler slows it, and Salvage Run drains slower so the far wrecks are in reach.
  function oxygenDrain() {
    const mode = session.mode === 'siege' ? progression.oxygenDrain : session.mode === 'salvage' ? CONFIG.salvage.oxygenDrain : 1;
    return session.drainScale * mode;
  }

  // Drone Siege and Salvage Run both have hostile drones.
  function dronesOn() {
    return session.mode === 'siege' || session.mode === 'salvage';
  }

  // How hard the solar storm's radiation is hitting you, 0 to 1: it creeps in over the
  // storm's last minute, and is at full strength outside once the storm hits.
  function radiation() {
    if (session.mode !== 'salvage' || session.state !== 'playing') return 0;
    if (salvage.stormHit) return inside ? 0.2 : 1;
    const k = Math.max(0, 1 - salvage.timeLeft / CONFIG.salvage.radiationBuild);
    return k * k * (inside ? 0.25 : 0.6);
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
    let stationPrompt: SiegeReadout['prompt'] = null;

    if (playing) {
      // Weapons: 1 and 2 pick a slot, the scroll wheel cycles through what you carry.
      const wasSwitching = loadout.switching;
      if (input.wasPressed('Digit1')) loadout.select(0);
      if (input.wasPressed('Digit2')) loadout.select(1);
      if (input.wasPressed('Digit3')) loadout.select(2);
      const wheel = input.takeWheel();
      if (wheel !== 0) loadout.cycle(Math.sign(wheel));
      if (!wasSwitching && loadout.switching) audio.weaponSwap();
      loadout.update(dt);
      viewmodel.setWeapon(loadout.current.spec.id, loadout.current.spec.overclocked);
      if (session.mode === 'siege') {
        // Whatever you're standing at and facing: its offer on the visor, E to take it.
        const spot = progression.nearest(player.feet, camera.getWorldDirection(new THREE.Vector3()));
        stationPrompt = spot?.offer ?? null;
        if (spot && input.wasPressed('KeyE')) spot.use();
      }
    }
    const gun = loadout.current;

    if (playing) {
      mouse = input.takeMouseDelta();
      // Zoomed in, the same mouse movement turns you less, so aim feels the same.
      const zoomScale = THREE.MathUtils.lerp(1, gun.spec.adsFov / CONFIG.camera.fov, gun.aimBlend);
      look.update(mouse, zoomScale);
      if (input.wasPressed('BracketRight')) look.changeSensitivity(1);
      if (input.wasPressed('BracketLeft')) look.changeSensitivity(-1);
      if (input.wasPressed('BracketLeft', 'BracketRight')) {
        settings.set({ sensitivity: look.sensitivity }); // remember it
        hud.showToast(`SENSITIVITY ${(look.sensitivity * 1000).toFixed(1)}`);
      }

      player.update(dt, input, look.yaw, gun.aiming);
      const step = footsteps.update(dt, player, look.yaw);
      if (step) audio.footstep(step.hard, step.landing, step.strength);
      // These move colliders (targets, drones, airlock doors), so they go before the physics step.
      targets.update(dt, player.feet);
      if (dronesOn()) onSiegeEvents(siege.update(dt, siegePlayer()));
      if (session.mode === 'siege') progression.update(dt, player.feet);
      for (const event of city.update(dt, player.feet)) {
        if (event.kind === 'doorMoving') audio.doorMoving(event.position);
        else if (event.kind === 'doorStopped') audio.doorStopped(event.position);
        else audio.airHiss(event.position);
      }
      world.timestep = dt;
      world.step();
      recoil.update(dt);

      // Air: the dome and the airlock chambers are pressurized; everywhere else is vacuum.
      const feet = player.feet;
      inside = isInsideDome(feet) || city.airlocks.some((airlock) => airlock.inChamber(feet));
      if (oxygen.update(dt, inside, oxygenDrain())) outOfOxygen();

      if (session.update(dt)) endRun();

      // Salvage Run: the storm clock, the caches, banking and the drones' threat.
      if (session.mode === 'salvage' && session.state === 'playing') {
        const end = salvage.update(dt, { feet, look: camera.getWorldDirection(new THREE.Vector3()), inside, holdingUse: input.isDown('KeyE') });
        stationPrompt = salvage.prompt;
        if (end === 'sheltered') {
          session.end('sheltered');
          endRun();
        } else if (end === 'destroyed') suitBroke();
      }
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
      const aimedFov = baseFov * (gun.spec.adsFov / CONFIG.camera.fov);
      camera.fov = THREE.MathUtils.lerp(baseFov, aimedFov, gun.aimBlend);
      camera.updateProjectionMatrix();
      look.applyTo(camera, recoil.pitch, recoil.yaw);
      cameraFx.update(dt, player, camera, look.yaw);
      sun.update(player.feet);
    }
    rocks.update(player.feet);
    sky.update(camera, playing ? dt : 0);

    if (playing) {
      spread = gun.spread(player.horizontalSpeed, player.grounded);
      // No shooting until the gun is back up from a sprint or a weapon switch.
      const shots = gun.update(dt, input, viewmodel.sprintBlend < 0.3 && !loadout.switching);
      for (let i = 0; i < shots; i++) fireShot(gun, spread);
      if (gun.dryFire) audio.dryFire();
      reloadSounds(gun);
    }
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - 400 * dt);

    // Shake goes on last so it moves the view without moving the aim.
    if (!backdrop) {
      camera.rotation.x += recoil.shakePitch;
      camera.rotation.y += recoil.shakeYaw;
    }

    camera.updateMatrixWorld();
    viewmodel.update(dt, gun, loadout.lowered, mouse, {
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
    tracers.update(playing ? dt : 0);
    const swarm = session.mode === 'siege' && session.state === 'playing' && siege.rounds.kind === 'swarm' && siege.rounds.state === 'fighting';
    alertLighting.update(dt, swarm);
    if (playing) {
      ejecta.update(dt);
      for (const bounce of ejecta.takeBounces()) {
        if (bounce.magazine) audio.impact(bounce.position);
        else audio.casing(bounce.position, bounce.loudness);
      }
    }
    audio.update({
      dt,
      camera,
      inside,
      playing,
      oxygenLevel: oxygen.level,
      oxygenLow: oxygen.low,
      thrusting: player.jetpack.thrusting,
      exertion: player.jetpack.thrusting || player.sprinting ? 1 : 0,
      suitLow: playing && dronesOn() && siege.suit.low,
      radiation: playing ? radiation() : 0,
      // Salvage Run's music builds with the threat while drones are after you outside.
      music:
        session.mode === 'salvage'
          ? {
              playing,
              fighting: !inside && siege.incoming > 0,
              round: 2 + salvage.level,
              special: salvage.stormHit || salvage.timeLeft <= 30,
              danger: siege.suit.low,
            }
          : {
              playing: playing && session.mode === 'siege',
              fighting: siege.rounds.state === 'fighting',
              round: siege.rounds.round,
              special: siege.rounds.state === 'fighting' && siege.rounds.kind !== 'normal',
              danger: siege.suit.low,
            },
    });
    if (dronesOn()) suitHud.update(playing ? dt : 0, siege.suit, player.feet, look.yaw);
    if (session.mode === 'siege') {
      roundHud.update(playing ? dt : 0, siege.rounds, siege.boss);
      siegeHud.update({ powered: progression.power.on, mods: progression.mods.owned, timers: progression.powerUps.timers });
    }
    if (session.mode === 'salvage') {
      composer.setTint(stormTint.copy(NO_TINT).lerp(STORM_TINT, radiation() * 0.75));
      const timeLeft = salvage.timeLeft;
      salvageHud.update({
        dt: playing ? dt : 0,
        heading: (((-THREE.MathUtils.radToDeg(look.yaw)) % 360) + 360) % 360,
        feet: player.feet,
        sites: salvage.sites.sites,
        scanner: salvage.perks.has('scanner'),
        inside,
        level: salvage.level,
        heat: salvage.director.heat,
        stormFloor: CONFIG.salvage.stormFloor.some((f) => timeLeft <= f.timeLeft),
        holdProgress: playing ? salvage.holdProgress : null,
        radiation: radiation(),
        medicReady: salvage.medicReady,
      });
    }
    hud.update({
      dt,
      player,
      gun,
      scope: viewmodel.scopeView(gun.aimBlend),
      scoring,
      oxygen,
      inside,
      mode: session.mode,
      timeLeft: session.timeLeft,
      survived: session.mode === 'oxygenRun' ? session.elapsed : null,
      drainPerSecond: CONFIG.oxygen.drainRate * oxygenDrain(),
      spread,
      fov: camera.fov,
      heading: (((-THREE.MathUtils.radToDeg(look.yaw)) % 360) + 360) % 360,
      mouse,
      showStats: settings.get().showStats,
      frameTime,
      siege: dronesOn() ? { points: siege.points, kills: siege.kills, slots: loadout.slots, slot: loadout.index, prompt: stationPrompt } : null,
      salvage:
        session.mode === 'salvage'
          ? {
              banked: salvage.banked,
              carried: salvage.carried,
              load: salvage.loadName,
              burden: salvage.burden / CONFIG.salvage.maxSlow,
              caches: salvage.cachesOpened,
              cachesTotal: salvage.sites.sites.length,
              kills: salvage.kills,
              timeLeft: salvage.timeLeft,
              stormHit: salvage.stormHit,
            }
          : null,
      render: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        quality: settings.get().quality.toUpperCase(),
      },
    });

    // Draw the world with the gun on top (no gun behind the main menu). The draw counts
    // add up over the frame's several passes, for the F3 readout.
    renderer.info.reset();
    composer.render(dt, !backdrop);
    input.endFrame();
  }

  // One trigger pull: every pellet's ray, what it hit, the points, and all the feedback.
  function fireShot(gun: Gun, spread: number) {
    const spec = gun.spec;
    const aim = camera.getWorldDirection(new THREE.Vector3());
    if (dronesOn()) siege.beginShot();
    if (session.mode === 'salvage') salvage.onShot();
    audio.gunshot(spec.id);

    // The Singularity Launcher fires a slow round instead of a hitscan shot.
    if (spec.id === 'singularity') {
      const muzzle = camera.localToWorld(viewmodel.muzzlePoint());
      if (dronesOn()) siege.launchSingularity(muzzle, applySpread(aim, spread), spec.overclocked, player.collider);
      recoil.kick(gun.aimBlend, spec.recoil);
      viewmodel.fire();
      muzzleLight.position.copy(muzzle);
      muzzleLight.intensity = MUZZLE_LIGHT[spec.id];
      return;
    }

    const droneHits: DroneHit[] = [];
    let targetHit: HitResult | null = null;
    let firstEnd: THREE.Vector3 | null = null;
    for (let i = 0; i < spec.pellets; i++) {
      const ray = traceRay(applySpread(aim, spread), spec);
      droneHits.push(...ray.drones);
      targetHit ??= ray.target;
      firstEnd ??= ray.end;
    }

    // The Arc Caster's lightning jumps on from the first drone it hits to others nearby.
    const muzzleAt = camera.localToWorld(viewmodel.muzzlePoint());
    let chainPoints = 0;
    if (spec.id === 'arc' && dronesOn()) {
      const first = droneHits.find((h) => !h.blocked);
      if (first) {
        const chain = siege.chainLightning(first.index, spec.damage, CONFIG.siege.arc.chains + (spec.overclocked ? 2 : 0));
        chainPoints = chain.points;
        siege.zap([muzzleAt, ...chain.path]);
      } else if (firstEnd) {
        siege.zap([muzzleAt, firstEnd]);
      }
    }

    // Hostile drones: one marker for the shot, points earned, and a blast for each kill.
    if (droneHits.length > 0) {
      const core = droneHits.some((h) => h.core);
      const kills = droneHits.filter((h) => h.destroyed);
      audio.hitConfirm(core);
      hud.flashHitmarker(core);
      for (const kill of kills) audio.droneExplosion(kill.position);
      const coreKill = kills.some((h) => h.core);
      if (session.mode === 'salvage') {
        // Salvage Run has no points: a kill is worth a little salvage.
        hud.showPoints(kills.length * CONFIG.salvage.killSalvage, 'SALVAGE', true);
      } else {
        const points = droneHits.reduce((sum, h) => sum + h.points, 0) + chainPoints;
        hud.showPoints(points, kills.length > 1 ? `×${kills.length}` : coreKill ? 'CORE KILL' : kills.length ? 'KILL' : '', kills.length > 0);
      }
    }
    const anyDrone = droneHits[0];
    const earned = scoring.recordShot(targetHit ?? (anyDrone ? { points: 0, label: 'DRONE', bullseye: anyDrone.core } : null));
    if (targetHit) {
      // Out on the surface, every hit buys a little air.
      const bonus = inside ? 0 : oxygenReward(targetHit);
      oxygen.reward(bonus);
      hud.showHit(earned, targetHit.label, targetHit.bullseye, scoring.multiplier, bonus);
      audio.hitConfirm(targetHit.bullseye);
    }

    recoil.kick(gun.aimBlend, spec.recoil);
    viewmodel.fire();
    const muzzle = camera.localToWorld(viewmodel.muzzlePoint());
    muzzleLight.position.copy(muzzle);
    muzzleLight.intensity = MUZZLE_LIGHT[spec.id];
    // Energy weapons draw their shot; powder guns throw burning grains and spent cases.
    if (spec.id === 'arc') {
      // (its lightning is already drawn)
    } else if (spec.id === 'smg' || spec.id === 'rail') {
      if (firstEnd) tracers.fire(spec.id === 'rail' ? 'rail' : 'plasma', muzzle, firstEnd);
    } else {
      impacts.muzzleSparks(muzzle, aim);
    }
    const port = viewmodel.ejectionPortPoint();
    if (port) {
      const out = viewmodel.ejectionDirection().transformDirection(camera.matrixWorld);
      const speed = CONFIG.viewmodel.casingSpeed * (0.85 + Math.random() * 0.3);
      ejecta.casing(camera.localToWorld(port), out.multiplyScalar(speed).add(player.velocity), CASING_SIZE[spec.id] ?? 1);
    }
  }

  // One ray of a shot. It stops at the first thing in its way, except that a piercing
  // gun (the rail rifle) carries on through hostile drones, up to spec.pierce of them.
  function traceRay(direction: THREE.Vector3, spec: WeaponSpec) {
    const drones: DroneHit[] = [];
    let target: HitResult | null = null;
    const passedThrough = new Set<number>();
    const passes = (c: { handle: number }) => !passedThrough.has(c.handle);
    let end = camera.position.clone().addScaledVector(direction, spec.range);
    for (;;) {
      const hit = castShot(world, camera.position, direction, spec.range, player.collider, passes);
      if (!hit) break;
      const distance = camera.position.distanceTo(hit.point);
      const drone = dronesOn() ? siege.tryHit(hit.collider, damageAt(spec, distance), direction) : null;
      if (drone) {
        impacts.metalSparks(hit.point, hit.normal, drone.core ? 14 : 8);
        end = hit.point;
        // A shield stops everything, even a rail shot.
        if (drone.blocked) break;
        drones.push(drone);
        if (!drone.destroyed) audio.impact(hit.point);
        if (drones.length >= spec.pierce) break;
        for (const handle of drone.colliders) passedThrough.add(handle);
        continue;
      }
      // A Drone Siege barrier: the shot splashes on it.
      if (session.mode === 'siege' && progression.sections.isBarrier(hit.collider)) {
        impacts.metalSparks(hit.point, hit.normal, 6);
        audio.barrierHit(hit.point);
        end = hit.point;
        break;
      }
      target = targets.tryHit(hit.collider, hit.point, direction);
      impacts.spawn(hit.point, hit.normal);
      if (target) audio.targetBreak(hit.point, target.label === 'DRONE');
      else audio.impact(hit.point);
      end = hit.point;
      break;
    }
    return { drones, target, end };
  }

  // Reload sounds, timed to the animation: magazine out, new one in, bolt slams home.
  function reloadSounds(gun: Gun) {
    if (!gun.reloading) {
      lastReloadProgress = 0; // ready for the next reload
      return;
    }
    const p = gun.reloadProgress;
    const crossed = (mark: number) => lastReloadProgress < mark && p >= mark;
    if (crossed(0.1)) audio.magazineRelease();
    if (crossed(0.58)) audio.magazineInsert();
    if (crossed(0.69)) audio.boltRelease();
    lastReloadProgress = p;
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
    if (session.mode === 'siege' && progression.revive('oxygen')) return;
    if (session.mode === 'salvage') {
      if (salvage.revive('oxygen')) return;
      salvage.lose();
    }
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
  // the Oxygen Run by how long you survived, Drone Siege by the round you reached,
  // Salvage Run by the salvage you banked (which also goes to the Quartermaster).
  function endRun() {
    const mode = session.mode;
    const value = mode === 'oxygenRun' ? Math.floor(session.elapsed) : mode === 'siege' ? siege.rounds.round : mode === 'salvage' ? salvage.banked : scoring.score;
    const newBest = submitHighScore(mode, value);
    const siegeStats =
      mode === 'siege'
        ? { round: siege.rounds.round, kills: siege.kills, coreKills: siege.coreKills, weakPoints: siege.weakPointKills, points: siege.pointsEarned, mostKills: submitSiegeKills(siege.kills) }
        : undefined;
    let haul;
    if (mode === 'salvage') {
      const record = recordRun(salvage.banked, salvage.lost);
      haul = {
        banked: salvage.banked,
        caches: salvage.cachesOpened,
        cachesTotal: salvage.sites.sites.length,
        trips: salvage.trips,
        kills: salvage.kills,
        lost: salvage.lost,
        timeOutside: salvage.timeOutside,
        counted: record.counted,
        lifetimeBefore: record.before.lifetime,
        lifetimeAfter: record.after.lifetime,
      };
      salvageHud.setActive(false);
    }
    menu.showResults({ mode, reason: session.endReason ?? 'timeUp', scoring, survived: session.elapsed, newBest, siege: siegeStats, salvage: haul });
    document.exitPointerLock();
  }

  // Compile every shader now, behind the loading screen. Otherwise each one compiles the
  // first time its object is drawn, which freezes the game for a moment mid-play.
  await loading.step(0.82, 'PREPARING SHADERS');
  // The world draws into the post-processing image, not straight to the screen, and
  // shaders are built differently for each, so compile them for that image.
  renderer.setRenderTarget(composer.composer.renderTarget1);
  await renderer.compileAsync(scene, camera);
  await renderer.compileAsync(viewmodel.scene, viewmodel.camera);
  renderer.setRenderTarget(null);
  // Drawing one frame, gun included, compiles the rest (shadows and post-processing).
  // Drone Siege's things are shown for it too, since its shadows use shaders of their own.
  await loading.step(0.94, 'PRESSURIZING THE DOME');
  siege.showForWarmUp(true);
  stations.setActive(true);
  progression.showForWarmUp(true);
  salvage.showForWarmUp(true);
  tick(0);
  composer.render(0, true);
  siege.showForWarmUp(false);
  stations.setActive(false);
  progression.showForWarmUp(false);
  salvage.showForWarmUp(false);

  // The game loop runs once per screen refresh.
  // Cap the frame time so a stall can't make us skip through walls.
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    frameTime = timer.getDelta();
    tick(Math.min(frameTime, CONFIG.maxFrameTime));
  });
  await loading.step(1, 'READY');
  loading.done();

  // Dev-only handle for poking at the game from the browser console.
  // lowg.tick(1 / 60) advances one frame by hand, which is handy for testing.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      lowg: { renderer, scene, composer, audio, ejecta, input, look, player, camera, world, city, oxygen, recoil, viewmodel, impacts, targets, scoring, session, menu, settings, sun, rocks, sky, siege, suitHud, roundHud, siegeHud, salvage, salvageHud, hud, loadout, stations, progression, tracers, tick, startRun },
    });
  }
}

boot().catch((error) => {
  console.error(error);
  loading.fail(error);
});
