import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import { buildHands } from './hands';
import type { Rifle } from './rifle';
import { buildRifle, type RifleModel } from './rifleModel';

// What the player's body is doing, for animating the gun.
export interface ViewState {
  speed: number; // horizontal m/s
  grounded: boolean;
  sprinting: boolean;
  verticalSpeed: number;
  landingSpeed: number; // > 0 on the frame you land
  sunDirection: THREE.Vector3; // toward the sun, in camera space
  sunlit: number; // 0 = the player is in shadow, 1 = in full sun
  inside: boolean; // under the dome (warm city light around you)
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const phase = (p: number, from: number, to: number) => smooth(THREE.MathUtils.clamp((p - from) / (to - from), 0, 1));

// The rifle and the gloved hands holding it. They live in their own little scene,
// drawn on top of the world with their own camera, so they never poke through
// walls and don't stretch when the main view zooms in.
//
// The scene's origin is the eye, looking down -z, the same as the main camera,
// so a point here can be turned into a world position with camera.localToWorld.
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Called with the magazine's transform (in this scene's space) when it drops out on a reload. */
  onMagazineDrop: ((matrix: THREE.Matrix4) => void) | null = null;
  sprintBlend = 0; // 0 = gun up and ready, 1 = lowered for sprinting

  private rig = new THREE.Group(); // gun and hands together
  private model: RifleModel;
  private leftHand: THREE.Group;
  private sun = new THREE.DirectionalLight(CONFIG.lighting.sunColor, 0);
  private fill = new THREE.AmbientLight(0xffd2a0, 0);

  // Animation state
  private time = 0;
  private kick = 0;
  private kickVelocity = 0;
  private kickYaw = 0;
  private bolt = 0;
  private flashTimer = 0;
  private sway = new THREE.Vector2();
  private bobPhase = 0;
  private landing = 0;
  private landingVelocity = 0;
  private vertical = 0;
  private reloadPose = 0;
  private magazineDropped = false;
  private sunlit = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CONFIG.viewmodel.fov, window.innerWidth / window.innerHeight, 0.01, 10);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    this.model = buildRifle();
    const hands = buildHands();
    this.leftHand = hands.left;
    // Fuse each rigid piece's many parts into a few meshes; the moving parts stay separate.
    const m = this.model;
    mergeRigidParts(m.root, [m.bolt, m.magazine, m.chargingHandle, m.flash]);
    mergeRigidParts(m.magazine);
    mergeRigidParts(hands.right);
    mergeRigidParts(hands.left);
    this.rig.add(this.model.root, hands.right, hands.left);
    this.scene.add(this.rig);

    // The same sun as the world, turned to match where you're looking, with its own
    // small shadow map so the hands and sight shade the gun.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -0.6;
    s.right = s.top = 0.6;
    s.near = 0.05;
    s.far = 4;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.002;
    this.scene.add(this.sun, this.sun.target, this.fill);
  }

  fire() {
    this.kickVelocity += 2.6; // a sharp shove; the spring brings it back
    this.kickYaw = (Math.random() - 0.5) * 0.02;
    this.bolt = 1;
    this.flashTimer = CONFIG.viewmodel.muzzleFlashTime;
    this.model.flash.rotation.z = Math.random() * Math.PI;
    this.model.flash.scale.setScalar(0.7 + Math.random() * 0.45);
  }

  /** A point on the gun (gun space) in this scene's space, i.e. relative to the eye. */
  private gunPoint(point: THREE.Vector3) {
    this.rig.updateMatrixWorld();
    return this.model.root.localToWorld(point.clone());
  }

  muzzlePoint() {
    return this.gunPoint(this.model.muzzle);
  }

  ejectionPortPoint() {
    return this.gunPoint(this.model.ejectionPort);
  }

  /** Which way spent casings fly out (right, up and a little back), in this scene's space. */
  ejectionDirection() {
    this.rig.updateMatrixWorld();
    return new THREE.Vector3(1, 0.55, 0.25).normalize().transformDirection(this.model.root.matrixWorld);
  }

  update(dt: number, rifle: Rifle, mouse: { x: number; y: number }, state: ViewState) {
    const cfg = CONFIG.viewmodel;
    this.time += dt;
    const aim = rifle.aimBlend;
    const steady = 1 - aim * 0.8;

    // Sprinting lowers the gun across the body; aiming or firing raises it.
    const sprintTarget = state.sprinting && !rifle.reloading ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * Math.min(1, (sprintTarget ? 6 : 12) * dt);

    // Reload: tip the gun to show the magazine well.
    const reloadTarget = rifle.reloading && rifle.reloadProgress < 0.86 ? 1 : 0;
    this.reloadPose += (reloadTarget - this.reloadPose) * Math.min(1, 9 * dt);

    // Base pose: from the hip to behind the sight.
    const hip = new THREE.Vector3(cfg.hipPosition.x, cfg.hipPosition.y, cfg.hipPosition.z);
    const sight = this.model.sightDot;
    const ads = new THREE.Vector3(-sight.x, -sight.y, -cfg.eyeRelief - sight.z);
    const position = hip.lerp(ads, aim);
    // At the hip the gun turns in a little and rolls so you see more of its left side.
    const rotation = new THREE.Euler(0.02 * (1 - aim), 0.085 * (1 - aim), -0.16 * (1 - aim));

    // Pose blends: sprint (gun down and canted across the chest) and reload (tilted).
    position.add(new THREE.Vector3(-0.05, -0.04, 0.035).multiplyScalar(this.sprintBlend));
    rotation.x += -0.3 * this.sprintBlend;
    rotation.y += 0.55 * this.sprintBlend;
    rotation.z += 0.3 * this.sprintBlend;
    position.add(new THREE.Vector3(-0.04, 0.035, 0.03).multiplyScalar(this.reloadPose));
    rotation.x += 0.12 * this.reloadPose;
    rotation.y += 0.25 * this.reloadPose;
    rotation.z += 0.5 * this.reloadPose;

    // Breathing: a slow drift, much smaller when aiming.
    position.y += Math.sin(this.time * 1.5) * 0.0022 * steady;
    rotation.x += Math.sin(this.time * 1.5 + 1) * 0.0035 * steady;
    rotation.y += Math.sin(this.time * 0.7) * 0.0025 * steady;

    // Sway: the gun lags behind fast mouse movement.
    const swayTarget = new THREE.Vector2(-mouse.x, mouse.y).multiplyScalar(cfg.swayAmount * steady).clampLength(0, 0.03);
    this.sway.lerp(swayTarget, Math.min(1, 9 * dt));
    position.x += this.sway.x;
    position.y += this.sway.y;
    rotation.y += this.sway.x * 1.5;
    rotation.x -= this.sway.y * 1.5;

    // Walking: the slow, loping bounce of moon gait, with a little roll each step.
    this.bobPhase += state.speed * dt * CONFIG.cameraFx.bobFrequency * Math.PI;
    const bob = state.grounded ? Math.min(1, state.speed / CONFIG.player.walkSpeed) * (1 - aim * 0.85) : 0;
    position.x += Math.sin(this.bobPhase) * 0.01 * bob;
    position.y += -Math.abs(Math.sin(this.bobPhase)) * 0.012 * bob;
    rotation.z += Math.sin(this.bobPhase) * 0.015 * bob;

    // In the air the gun floats up a little as you fall and sinks as you rise;
    // landing gives it a springy dip.
    const verticalTarget = THREE.MathUtils.clamp(-state.verticalSpeed * 0.005, -0.02, 0.02);
    this.vertical += (verticalTarget - this.vertical) * Math.min(1, 5 * dt);
    position.y += this.vertical * steady;
    if (state.landingSpeed > 0) this.landingVelocity -= Math.min(0.5, state.landingSpeed * 0.12);
    this.landingVelocity += (-160 * this.landing - 18 * this.landingVelocity) * dt;
    this.landing += this.landingVelocity * dt;
    position.y += this.landing * steady;

    // Recoil: a spring that snaps back after each shot.
    this.kickVelocity += (-420 * this.kick - 38 * this.kickVelocity) * dt;
    this.kick += this.kickVelocity * dt;
    const recoil = 1 - aim * 0.5;
    position.z += this.kick * cfg.kickBack * recoil;
    rotation.x += THREE.MathUtils.degToRad(cfg.kickUp) * this.kick * recoil;
    rotation.y += this.kickYaw * this.kick;

    this.rig.position.copy(position);
    this.rig.rotation.copy(rotation);

    this.animateParts(dt, rifle);
    this.light(dt, state);
  }

  private animateParts(dt: number, rifle: Rifle) {
    const m = this.model;
    // Bolt carrier: slams back on each shot and runs home again.
    this.bolt = Math.max(0, this.bolt - dt * 30);
    let boltBack = this.bolt * 0.04;

    // Reload choreography, keyed to how far through the reload we are.
    const p = rifle.reloading ? rifle.reloadProgress : 1;
    const hand = this.leftHand;
    hand.position.set(0, 0, 0);
    hand.rotation.set(0, 0, 0);
    m.magazine.visible = true;
    m.magazine.position.copy(m.magazineWell);
    if (rifle.reloading) {
      // 1. Release: the old magazine drops out (handed to the world as a real object).
      if (p >= 0.1 && !this.magazineDropped) {
        this.magazineDropped = true;
        this.rig.updateMatrixWorld();
        this.onMagazineDrop?.(m.magazine.matrixWorld.clone());
      }
      // The bolt locks back on an empty gun until the new magazine is in.
      if (p >= 0.1 && p < 0.7) boltBack = 0.04;
      // 2. The left hand leaves the handguard and goes down for a fresh magazine...
      const down = phase(p, 0.1, 0.3);
      // 3. ...brings it up to the well...
      const up = phase(p, 0.32, 0.55);
      // 4. ...seats it with a push...
      const seat = phase(p, 0.55, 0.62);
      // 5. ...slaps the bolt release, and goes back to the handguard.
      const slap = phase(p, 0.62, 0.7);
      const back = phase(p, 0.72, 0.88);

      const magDrop = new THREE.Vector3(0, -0.32, 0.06);
      const belowWell = new THREE.Vector3(0, -0.04, 0.01);
      const magOffset = p < 0.32 ? magDrop : magDrop.clone().lerp(belowWell, up).lerp(new THREE.Vector3(), seat);
      m.magazine.visible = p < 0.1 || p >= 0.32;
      m.magazine.position.copy(m.magazineWell).add(magOffset);

      // The hand holds the magazine from underneath while it's carrying it.
      const handOnMag = new THREE.Vector3(0.012, -0.27, 0.26).add(m.magazineWell).add(magOffset);
      const boltCatch = new THREE.Vector3(-0.02, 0.02, 0.29);
      const offscreen = new THREE.Vector3(-0.02, -0.38, 0.3);
      const target = new THREE.Vector3();
      if (p < 0.32) target.copy(offscreen).multiplyScalar(down);
      else if (p < 0.62) target.copy(handOnMag);
      else if (p < 0.72) target.copy(handOnMag).lerp(boltCatch, slap);
      else target.copy(boltCatch).lerp(new THREE.Vector3(), back);
      hand.position.copy(target);
      const holdingMag = p >= 0.32 && p < 0.62 ? 1 : 0;
      hand.rotation.set(0.35 * holdingMag + 0.3 * down * (p < 0.32 ? 1 : 0), 0, -0.2 * holdingMag);
    } else {
      this.magazineDropped = false;
    }
    m.bolt.position.z = boltBack;
    m.chargingHandle.position.z = 0;

    // Muzzle flash
    this.flashTimer -= dt;
    m.flash.visible = this.flashTimer > 0;
    m.setAmmoDisplay(rifle.ammo, CONFIG.rifle.magazineSize, rifle.reloading);
  }

  // Match the world's sun: same direction relative to your view, dark when you
  // stand in shadow, plus warm city light when you're under the dome.
  private light(dt: number, state: ViewState) {
    this.sunlit += (state.sunlit - this.sunlit) * Math.min(1, 8 * dt);
    this.sun.intensity = CONFIG.lighting.sunIntensity * this.sunlit;
    const center = this.rig.position;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(state.sunDirection, 2);
    const fillTarget = state.inside ? 0.35 : 0;
    this.fill.intensity += (fillTarget - this.fill.intensity) * Math.min(1, 3 * dt);
  }
}
