import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';

// Plasma bolts fired by hostile drones. They're real projectiles, not instant hits:
// slow and bright enough to see coming and dodge. A fixed pool is made up front and
// reused, so a busy fight never creates new objects.

interface Bolt {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  origin: THREE.Vector3; // where it was fired from, for the hit-direction marker
  life: number;
  damage: number;
  whizzed: boolean; // already made its fly-by sound
  closest: number; // nearest it has come to your head so far (meters)
}

export type BoltEvent =
  | { kind: 'hitPlayer'; damage: number; from: THREE.Vector3 }
  | { kind: 'impact'; point: THREE.Vector3; normal: THREE.Vector3 }
  | { kind: 'whiz'; point: THREE.Vector3 };

/** The player as the bolts see them: a capsule standing on its feet. */
export interface BoltTarget {
  feet: THREE.Vector3;
  height: number;
  collider: RAPIER.Collider;
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

export class Bolts {
  readonly mesh: THREE.InstancedMesh;
  private bolts: Bolt[] = [];
  private events: BoltEvent[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private matrix = new THREE.Matrix4();
  private rotation = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private next = new THREE.Vector3();
  private direction = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
    private blocks: (collider: RAPIER.Collider) => boolean, // true for what stops a bolt (not the drones)
  ) {
    const count = CONFIG.siege.maxBolts;
    // A stretched glowing ball, far brighter than white: bloom turns it into a hot streak.
    const [r, g, b] = CONFIG.siege.glowColor;
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(r * 7, 0.9 + g * 7, 0.35 + b * 7) });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      this.bolts.push({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        origin: new THREE.Vector3(),
        life: 0,
        damage: 0,
        whizzed: false,
        closest: Infinity,
      });
      this.mesh.setMatrixAt(i, HIDDEN);
    }
    scene.add(this.mesh);
  }

  fire(from: THREE.Vector3, direction: THREE.Vector3, speed: number, damage: number) {
    const bolt = this.bolts.find((b) => !b.alive);
    if (!bolt) return; // every bolt is in flight: skip this shot rather than make a new one
    bolt.alive = true;
    bolt.position.copy(from);
    bolt.origin.copy(from);
    bolt.velocity.copy(direction).normalize().multiplyScalar(speed);
    bolt.life = CONFIG.siege.bolt.life;
    bolt.damage = damage;
    bolt.whizzed = false;
    bolt.closest = Infinity;
  }

  /** Moves every bolt and returns what they hit this frame. */
  update(dt: number, target: BoltTarget) {
    this.events.length = 0;
    const radius = CONFIG.siege.bolt.radius;
    const reach = radius + CONFIG.player.radius;
    const capsuleBottom = target.feet.clone().setY(target.feet.y + CONFIG.player.radius);
    const capsuleTop = target.feet.clone().setY(target.feet.y + target.height - CONFIG.player.radius);
    const head = capsuleTop.clone();

    this.bolts.forEach((bolt, i) => {
      if (!bolt.alive) return;
      bolt.life -= dt;
      this.next.copy(bolt.position).addScaledVector(bolt.velocity, dt);

      // Did it pass through the player this frame?
      if (segmentDistance(bolt.position, this.next, capsuleBottom, capsuleTop) < reach) {
        this.events.push({ kind: 'hitPlayer', damage: bolt.damage, from: bolt.origin.clone() });
        return this.kill(bolt, i);
      }
      // A close miss makes a fizzing fly-by, once it's past you (a bolt that hits doesn't).
      const fromHead = this.next.distanceTo(head);
      if (!bolt.whizzed && bolt.closest < 1.6 && fromHead > bolt.closest) {
        bolt.whizzed = true;
        this.events.push({ kind: 'whiz', point: this.next.clone() });
      }
      bolt.closest = Math.min(bolt.closest, fromHead);
      // Did it hit a wall, the ground or anything else solid?
      const direction = this.direction.copy(bolt.velocity).normalize();
      const step = bolt.velocity.length() * dt;
      this.ray.origin = bolt.position;
      this.ray.dir = direction;
      const hit = this.world.castRayAndGetNormal(this.ray, step + radius, true, undefined, undefined, target.collider, undefined, this.blocks);
      if (hit) {
        const point = bolt.position.clone().addScaledVector(direction, hit.timeOfImpact);
        this.events.push({ kind: 'impact', point, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z) });
        return this.kill(bolt, i);
      }
      if (bolt.life <= 0) return this.kill(bolt, i);

      bolt.position.copy(this.next);
      // Stretched along its flight, like a streak of light.
      this.rotation.setFromUnitVectors(FORWARD, direction);
      this.matrix.compose(bolt.position, this.rotation, this.scale.set(radius, radius, radius * 4.5));
      this.mesh.setMatrixAt(i, this.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    return this.events;
  }

  clear() {
    this.bolts.forEach((bolt, i) => this.kill(bolt, i));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private kill(bolt: Bolt, i: number) {
    bolt.alive = false;
    this.mesh.setMatrixAt(i, HIDDEN);
  }
}

/** The shortest distance between two line segments (a1-a2 and b1-b2). */
export function segmentDistance(a1: THREE.Vector3, a2: THREE.Vector3, b1: THREE.Vector3, b2: THREE.Vector3) {
  const d1 = a2.clone().sub(a1);
  const d2 = b2.clone().sub(b1);
  const r = a1.clone().sub(b1);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a < 1e-9 && e < 1e-9) return a1.distanceTo(b1);
  if (a < 1e-9) {
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e < 1e-9) {
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const pa = a1.clone().addScaledVector(d1, s);
  const pb = b1.clone().addScaledVector(d2, t);
  return pa.distanceTo(pb);
}
