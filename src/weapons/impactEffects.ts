import * as THREE from 'three';
import { CONFIG } from '../config';
import { terrainHeight } from '../world/terrain';
import { ParticleSystem } from './particles';

const DUST_COLOR = new THREE.Color(0.55, 0.53, 0.5); // gray regolith
const SPARK_COLOR = new THREE.Color(1.0, 0.75, 0.4); // hot orange-white

// What happens where a bullet lands: a puff of dust that hangs and falls
// slowly in the low gravity, and a few quick sparks.
export class ImpactEffects {
  private dust: ParticleSystem;
  private sparks: ParticleSystem;

  constructor(scene: THREE.Scene) {
    this.dust = new ParticleSystem(scene, 2500, false);
    this.sparks = new ParticleSystem(scene, 400, true);
  }

  spawn(point: THREE.Vector3, normal: THREE.Vector3) {
    const cfg = CONFIG.impacts;
    // Dust that lands on a flat top rests there; dust off a wall falls to the ground.
    const floorY = normal.y > 0.7 ? point.y : terrainHeight(point.x, point.z);
    const start = point.clone().addScaledVector(normal, 0.02);

    for (let i = 0; i < cfg.dustCount; i++) {
      // Mostly outward from the surface, scattered in a wide cone.
      const dir = normal.clone().add(randomInSphere().multiplyScalar(0.9)).normalize();
      const speed = cfg.dustSpeed * (0.3 + Math.random() * 0.7);
      const velocity = dir.multiplyScalar(speed);
      // A small upward toss, so the puff rises and hangs before it settles.
      velocity.y += cfg.dustLift * (0.4 + Math.random() * 0.6);
      const shade = 0.85 + Math.random() * 0.3;
      this.dust.spawn(
        start,
        velocity,
        cfg.dustLife * (0.6 + Math.random() * 0.4),
        cfg.dustSize * (0.5 + Math.random()),
        DUST_COLOR.clone().multiplyScalar(shade),
        floorY,
        1.5,
      );
    }

    for (let i = 0; i < cfg.sparkCount; i++) {
      const dir = normal.clone().add(randomInSphere().multiplyScalar(0.7)).normalize();
      this.sparks.spawn(
        start,
        dir.multiplyScalar(cfg.sparkSpeed * (0.5 + Math.random() * 0.5)),
        cfg.sparkLife * (0.5 + Math.random() * 0.5),
        0.035,
        SPARK_COLOR,
        floorY,
        cfg.sparkLife,
      );
    }
  }

  /**
   * Burning powder grains thrown out of the muzzle. With no air to slow them they
   * fly straight and fast, then simply go out.
   */
  muzzleSparks(position: THREE.Vector3, direction: THREE.Vector3) {
    for (let i = 0; i < 5; i++) {
      const dir = direction.clone().add(randomInSphere().multiplyScalar(0.12)).normalize();
      this.sparks.spawn(position, dir.multiplyScalar(18 + Math.random() * 20), 0.08 + Math.random() * 0.14, 0.02, SPARK_COLOR, -1000, 0.06);
    }
  }

  /**
   * A low puff of dust kicked up from the ground (footsteps, landings).
   * It rises a little, hangs, and settles, with no drifting.
   */
  kickDust(position: THREE.Vector3, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const out = speed * (0.3 + Math.random() * 0.7);
      const velocity = new THREE.Vector3(Math.cos(angle) * out, speed * (0.4 + Math.random() * 0.8), Math.sin(angle) * out);
      this.dust.spawn(
        position,
        velocity,
        2 + Math.random() * 1.5,
        CONFIG.impacts.dustSize * (0.6 + Math.random() * 0.8),
        DUST_COLOR.clone().multiplyScalar(0.9 + Math.random() * 0.25),
        position.y,
        1,
      );
    }
  }

  /** The particle clouds, so post-processing can leave them out of ambient occlusion. */
  get objects() {
    return [this.dust.points, this.sparks.points];
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    this.dust.update(dt, camera);
    this.sparks.update(dt, camera);
  }
}

function randomInSphere() {
  const v = new THREE.Vector3();
  do {
    v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  } while (v.lengthSq() > 1);
  return v;
}
