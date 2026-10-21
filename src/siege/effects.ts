import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { ImpactEffects } from '../weapons/impactEffects';
import { glowTexture } from './glowTexture';

// What a hostile drone leaves behind when it blows up. In a vacuum there's no fireball
// or smoke: a blinding flash of its plasma core, sparks flying in clean arcs, and chunks
// of hull that tumble and drift slowly down in the low gravity, then lie on the ground.
// Everything is made once up front and reused.

interface Flash {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
}

interface Piece {
  alive: boolean;
  settled: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  spin: THREE.Vector3; // radians per second around each axis
  size: THREE.Vector3;
  age: number;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const FLASH_COLOR = new THREE.Color(7, 1.6, 0.6); // red-orange, far brighter than white
const HOT_SPARK = new THREE.Color(1, 0.45, 0.25);

export class SiegeEffects {
  readonly debris: THREE.InstancedMesh;
  readonly light = new THREE.PointLight(0xff5a2a, 0, CONFIG.siege.explosion.lightRange, 1.6);
  private flashes: Flash[] = [];
  private pieces: Piece[] = [];
  private nextPiece = 0;
  private lightTime = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private matrix = new THREE.Matrix4();
  private turn = new THREE.Quaternion();
  private euler = new THREE.Euler();

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
    private blocks: (collider: RAPIER.Collider) => boolean,
    private impacts: ImpactEffects,
  ) {
    // The flash light always exists (at zero brightness), so the number of lights never
    // changes: changing it would make every shader rebuild mid-fight.
    scene.add(this.light);

    const texture = glowTexture();
    for (let i = 0; i < 10; i++) {
      const material = new THREE.SpriteMaterial({ map: texture, color: FLASH_COLOR, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.flashes.push({ sprite, material, age: 0, life: 0, size: 0 });
    }

    const count = CONFIG.siege.explosion.maxDebris;
    const hull = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.5, metalness: 0.6 });
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hull, count);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.frustumCulled = false;
    this.debris.castShadow = true;
    this.debris.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      this.pieces.push({
        alive: false,
        settled: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        spin: new THREE.Vector3(),
        size: new THREE.Vector3(),
        age: 0,
      });
      this.debris.setMatrixAt(i, HIDDEN);
    }
    scene.add(this.debris);
  }

  /** The sprites, for leaving out of ambient occlusion. */
  get glowObjects() {
    return this.flashes.map((f) => f.sprite);
  }

  /** A drone blowing apart at `position`, moving at `velocity`. */
  explode(position: THREE.Vector3, velocity: THREE.Vector3) {
    const cfg = CONFIG.siege.explosion;
    this.flash(position, 3.6, cfg.flashTime);
    this.flash(position, 1.4, cfg.flashTime * 2.2); // a smaller, longer afterglow
    this.light.position.copy(position);
    this.light.intensity = cfg.lightIntensity;
    this.lightTime = cfg.flashTime;
    this.impacts.burst(position, cfg.sparks, 9, 1.4);
    for (let i = 0; i < cfg.debris; i++) {
      const piece = this.pieces[this.nextPiece];
      this.nextPiece = (this.nextPiece + 1) % this.pieces.length; // reuse the oldest when full
      const out = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.25, Math.random() - 0.5).normalize();
      piece.alive = true;
      piece.settled = false;
      piece.age = 0;
      piece.position.copy(position).addScaledVector(out, 0.2);
      piece.velocity.copy(velocity).multiplyScalar(0.5).addScaledVector(out, 1.5 + Math.random() * 3.5);
      piece.rotation.setFromEuler(this.euler.set(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      piece.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(9);
      const s = 0.05 + Math.random() * 0.14;
      piece.size.set(s * (0.6 + Math.random()), s * (0.25 + Math.random() * 0.5), s * (0.6 + Math.random()));
    }
  }

  /** A bolt splashing against a wall or the ground. */
  boltImpact(point: THREE.Vector3, normal: THREE.Vector3) {
    this.flash(point.clone().addScaledVector(normal, 0.1), 0.9, 0.16);
    this.impacts.metalSparks(point, normal, 7, HOT_SPARK);
  }

  /** A small flash where a drone arrives. */
  arrive(position: THREE.Vector3) {
    this.flash(position, 1.6, 0.3);
  }

  update(dt: number) {
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.35 + Math.sqrt(t) * 0.65));
      f.material.opacity = (1 - t) * (1 - t);
    }

    if (this.lightTime > 0) {
      this.lightTime -= dt;
      this.light.intensity = Math.max(0, CONFIG.siege.explosion.lightIntensity * (this.lightTime / CONFIG.siege.explosion.flashTime));
    }

    const life = CONFIG.siege.explosion.debrisLife;
    this.pieces.forEach((p, i) => {
      if (!p.alive) return;
      p.age += dt;
      if (p.age > life) {
        p.alive = false;
        this.debris.setMatrixAt(i, HIDDEN);
        return;
      }
      if (!p.settled) this.fall(p, dt);
      const shrink = Math.min(1, (life - p.age) / 0.8); // shrink away over the last moment
      this.matrix.compose(p.position, p.rotation, p.size.clone().multiplyScalar(Math.max(0.001, shrink)));
      this.debris.setMatrixAt(i, this.matrix);
    });
    this.debris.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const f of this.flashes) f.sprite.visible = false;
    this.light.intensity = 0;
    this.lightTime = 0;
    this.pieces.forEach((p, i) => {
      p.alive = false;
      this.debris.setMatrixAt(i, HIDDEN);
    });
    this.debris.instanceMatrix.needsUpdate = true;
  }

  // Moon gravity and nothing else: no air to slow it. It lands on whatever is below,
  // skidding to a stop on floors and bouncing weakly off walls.
  private fall(p: Piece, dt: number) {
    p.velocity.y -= CONFIG.gravity * dt;
    const speed = p.velocity.length();
    const step = speed * dt;
    if (step > 1e-5) {
      const direction = p.velocity.clone().divideScalar(speed);
      this.ray.origin = p.position;
      this.ray.dir = direction;
      const hit = this.world.castRayAndGetNormal(this.ray, step + p.size.y * 0.5, true, undefined, undefined, undefined, undefined, this.blocks);
      if (hit) {
        const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        p.position.addScaledVector(direction, hit.timeOfImpact).addScaledVector(normal, p.size.y * 0.5);
        if (normal.y > 0.6) {
          p.settled = true; // resting on the ground or a roof
          return;
        }
        p.velocity.reflect(normal).multiplyScalar(0.3);
        return;
      }
    }
    p.position.addScaledVector(p.velocity, dt);
    this.turn.setFromEuler(this.euler.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
    p.rotation.multiply(this.turn);
  }

  private flash(position: THREE.Vector3, size: number, life: number) {
    const f = this.flashes.find((x) => !x.sprite.visible) ?? this.flashes[0];
    f.sprite.visible = true;
    f.sprite.position.copy(position);
    f.age = 0;
    f.life = life;
    f.size = size;
    f.sprite.scale.setScalar(size * 0.35);
    f.material.opacity = 1;
  }
}
