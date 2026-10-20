import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { applySpread } from '../weapons/hitscan';
import { terrainHeight } from '../world/terrain';
import { BODY_RADIUS, CORE_OFFSET, CORE_RADIUS } from './droneFleet';

// One hostile scout drone's mind and body. It circles the player at a comfortable
// range, steers around buildings and the dome glass, and every few seconds charges up
// (its core glows brighter, so you can react) and fires a slow plasma bolt.

/** What a drone needs to know about the world and the player each frame. */
export interface DroneContext {
  world: RAPIER.World;
  blocks: (collider: RAPIER.Collider) => boolean; // true for obstacles (everything but drones)
  feet: THREE.Vector3; // the player's feet
  head: THREE.Vector3;
  velocity: THREE.Vector3;
  collider: RAPIER.Collider; // the player's body
  insideDome: boolean; // which side of the dome glass the player is on
  others: HostileDrone[];
}

export type DroneEvent =
  | { kind: 'charge'; drone: HostileDrone }
  | { kind: 'fire'; drone: HostileDrone; from: THREE.Vector3; direction: THREE.Vector3 };

const UP = new THREE.Vector3(0, 1, 0);
const random = (range: number[]) => range[0] + Math.random() * (range[1] - range[0]);

export class HostileDrone {
  active = false;
  health = 0;
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly rotation = new THREE.Quaternion();
  spin = 0; // rotor angle
  /** Seconds since it last saw the player. */
  unseenTime = 0;
  readonly body: RAPIER.Collider;
  readonly core: RAPIER.Collider;

  private orbit = 0; // angle around the player
  private orbitDirection = 1;
  private flipTimer = 0;
  private range = 15;
  private height = 4;
  private fireTimer = 0;
  private chargeTimer = 0;
  private charging = false;
  private sees = false;
  private sightTimer = 0;
  private dodgeTimer = 0;
  private roll = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private look = new THREE.Matrix4();
  private facing = new THREE.Quaternion();

  constructor(
    world: RAPIER.World,
    readonly index: number, // its slot in the pool (and in the fleet's drawing)
  ) {
    this.body = world.createCollider(RAPIER.ColliderDesc.ball(BODY_RADIUS));
    this.core = world.createCollider(RAPIER.ColliderDesc.ball(CORE_RADIUS));
    this.body.setEnabled(false);
    this.core.setEnabled(false);
  }

  /** Appear at `position`, facing the point `toward` (the player). */
  spawn(position: THREE.Vector3, toward: THREE.Vector3, health: number) {
    const cfg = CONFIG.siege.scout;
    this.active = true;
    this.health = health;
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.orbit = Math.atan2(position.x - toward.x, position.z - toward.z);
    this.orbitDirection = Math.random() < 0.5 ? 1 : -1;
    this.flipTimer = random([2.5, 6]);
    this.range = random(cfg.range);
    this.height = random(cfg.height);
    this.fireTimer = random(cfg.fireInterval) + 0.8; // a moment to get its bearings first
    this.charging = false;
    this.sees = false;
    this.unseenTime = 0;
    this.sightTimer = Math.random() * 0.15; // spread the sight checks over different frames
    this.look.lookAt(position, toward, UP);
    this.rotation.setFromRotationMatrix(this.look);
    this.body.setEnabled(true);
    this.core.setEnabled(true);
    this.placeColliders();
  }

  despawn() {
    this.active = false;
    this.charging = false;
    this.body.setEnabled(false);
    this.core.setEnabled(false);
  }

  /** 0 normally, rising to 1 as it charges a shot. */
  get glow() {
    return this.charging ? 1 - this.chargeTimer / CONFIG.siege.scout.telegraph : 0;
  }

  /** Where the glowing core (and its gun) is in the world. */
  corePosition(out = new THREE.Vector3()) {
    return out.copy(CORE_OFFSET).applyQuaternion(this.rotation).add(this.position);
  }

  /** Takes damage. Returns true if that destroyed it. */
  damage(amount: number) {
    this.health -= amount;
    return this.health <= 0;
  }

  update(dt: number, ctx: DroneContext, events: DroneEvent[]) {
    this.spin += dt * 38;

    // Can it see the player? Checked a few times a second, not every frame.
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.15;
      this.sees = this.canSee(ctx);
    }
    this.unseenTime = this.sees ? 0 : this.unseenTime + dt;

    this.steer(dt, ctx);
    this.face(dt, ctx);
    this.placeColliders();
    this.shoot(dt, ctx, events);
  }

  // Head for a spot on a circle around the player, at its own range and height,
  // circling one way and now and then switching. Then dodge walls and other drones.
  private steer(dt: number, ctx: DroneContext) {
    const cfg = CONFIG.siege.scout;
    this.flipTimer -= dt;
    if (this.flipTimer <= 0) {
      this.orbitDirection *= -1;
      this.flipTimer = random([2.5, 6]);
    }
    this.orbit += this.orbitDirection * (cfg.strafeSpeed / this.range) * dt;
    const goal = new THREE.Vector3(
      ctx.feet.x + Math.sin(this.orbit) * this.range,
      ctx.feet.y + this.height,
      ctx.feet.z + Math.cos(this.orbit) * this.range,
    );
    keepOnSide(goal, ctx.insideDome);
    goal.y = Math.max(goal.y, terrainHeight(goal.x, goal.z) + 2);

    // Fly toward the goal, easing off as it gets close.
    const toGoal = goal.sub(this.position);
    const distance = toGoal.length();
    const desired = toGoal.multiplyScalar(Math.min(cfg.speed, distance * 1.2) / Math.max(distance, 1e-3));
    const accel = desired.sub(this.velocity).multiplyScalar(2);

    // Keep apart from other drones.
    for (const other of ctx.others) {
      if (other === this || !other.active) continue;
      const away = this.position.clone().sub(other.position);
      const d = away.length();
      if (d < 3 && d > 1e-3) accel.addScaledVector(away, ((3 - d) / d) * 5);
    }

    // Look ahead along its flight for anything solid, and steer away from it.
    let avoiding = false;
    const speed = this.velocity.length();
    if (speed > 0.3) {
      const direction = this.velocity.clone().divideScalar(speed);
      const reach = BODY_RADIUS + 1.2 + speed * 0.8;
      const hit = this.cast(ctx, this.position, direction, reach);
      if (hit) {
        avoiding = true;
        const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        const closeness = 1 - hit.timeOfImpact / reach;
        accel.addScaledVector(normal, cfg.acceleration * 3 * closeness);
        // Flying straight at a wall: go around it the other way, and a little higher.
        if (this.dodgeTimer <= 0 && direction.dot(normal) < -0.6) {
          this.orbitDirection *= -1;
          this.height = Math.min(cfg.height[1] + 3, this.height + 1.5);
          this.dodgeTimer = 1.5;
        }
      }
    }
    this.dodgeTimer -= dt;
    accel.clampLength(0, cfg.acceleration * (avoiding ? 2.5 : 1));
    this.velocity.addScaledVector(accel, dt).clampLength(0, cfg.speed);

    // Move, but never into anything: if the step would touch a wall, stop at it and
    // lose the speed that was going into it.
    const step = this.velocity.length() * dt;
    if (step > 1e-5) {
      const direction = this.velocity.clone().normalize();
      const hit = this.cast(ctx, this.position, direction, step + BODY_RADIUS);
      if (hit) {
        const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        this.position.addScaledVector(direction, Math.max(0, hit.timeOfImpact - BODY_RADIUS - 0.05));
        this.velocity.addScaledVector(normal, -Math.min(0, this.velocity.dot(normal)));
      } else {
        this.position.addScaledVector(this.velocity, dt);
      }
    }
    // Keep its body clear of walls it slides along (the check above only looks ahead).
    const near = ctx.world.projectPoint(this.position, false, undefined, undefined, ctx.collider, undefined, ctx.blocks);
    if (near) {
      const out = this.position.clone().sub(near.point); // from the wall's surface out to the drone
      if (near.isInside) out.negate();
      const gap = near.isInside ? -out.length() : out.length();
      if (gap < BODY_RADIUS && out.lengthSq() > 1e-8) {
        out.normalize();
        this.position.copy(near.point).addScaledVector(out, BODY_RADIUS);
        this.velocity.addScaledVector(out, -Math.min(0, this.velocity.dot(out)));
      }
    }
    // Never sink to the ground.
    const floor = terrainHeight(this.position.x, this.position.z) + 1.2;
    if (this.position.y < floor) {
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
  }

  // Keep the core pointed at the player, and lean into turns.
  private face(dt: number, ctx: DroneContext) {
    this.look.lookAt(this.position, ctx.head, UP); // a camera-style look: -z toward the player
    this.facing.setFromRotationMatrix(this.look);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.facing);
    const sideways = this.velocity.dot(right);
    this.roll += (THREE.MathUtils.clamp(-sideways * 0.07, -0.4, 0.4) - this.roll) * Math.min(1, dt * 4);
    this.facing.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    this.rotation.slerp(this.facing, 1 - Math.exp(-8 * dt));
  }

  // Charge (glowing brighter) for a moment, then fire, unless it loses sight of you.
  private shoot(dt: number, ctx: DroneContext, events: DroneEvent[]) {
    const cfg = CONFIG.siege.scout;
    if (this.charging) {
      this.chargeTimer -= dt;
      if (!this.sees) {
        this.charging = false; // you ducked behind something: the shot is cancelled
        this.fireTimer = 0.8;
      } else if (this.chargeTimer <= 0) {
        this.charging = false;
        this.fireTimer = random(cfg.fireInterval);
        const from = this.corePosition();
        events.push({ kind: 'fire', drone: this, from, direction: this.aim(from, ctx) });
      }
      return;
    }
    if (!this.sees || this.position.distanceTo(ctx.head) > cfg.sightRange) return;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.charging = true;
      this.chargeTimer = cfg.telegraph;
      events.push({ kind: 'charge', drone: this });
    }
  }

  // Aim at your chest, partly leading your movement, with a little error.
  private aim(from: THREE.Vector3, ctx: DroneContext) {
    const cfg = CONFIG.siege.scout;
    const target = ctx.head.clone().setY(ctx.head.y - 0.45);
    const flightTime = from.distanceTo(target) / CONFIG.siege.bolt.speed;
    target.addScaledVector(ctx.velocity, flightTime * cfg.aimLead);
    return applySpread(target.sub(from).normalize(), cfg.aimSpread);
  }

  // A clear line from its core to your head (the first thing the ray meets is you).
  private canSee(ctx: DroneContext) {
    const from = this.corePosition();
    const toHead = ctx.head.clone().sub(from);
    const distance = toHead.length();
    if (distance > CONFIG.siege.scout.sightRange * 1.3) return false;
    this.ray.origin = from;
    this.ray.dir = toHead.divideScalar(distance);
    const hit = ctx.world.castRay(this.ray, distance, true, undefined, undefined, undefined, undefined, ctx.blocks);
    return !hit || hit.collider.handle === ctx.collider.handle || hit.timeOfImpact > distance - 0.4;
  }

  private cast(ctx: DroneContext, from: THREE.Vector3, direction: THREE.Vector3, distance: number) {
    this.ray.origin = from;
    this.ray.dir = direction;
    return ctx.world.castRayAndGetNormal(this.ray, distance, true, undefined, undefined, ctx.collider, undefined, ctx.blocks);
  }

  private placeColliders() {
    this.body.setTranslation(this.position);
    this.core.setTranslation(this.corePosition());
  }
}

/**
 * Keep a drone's goal on the player's side of the dome glass, with room to spare:
 * inside, it's pulled in from the glass; outside, it's pushed out away from it.
 */
function keepOnSide(goal: THREE.Vector3, inside: boolean) {
  const { domeRadius, domeHeight } = CONFIG.city;
  const margin = inside ? -6 : 6;
  const r = domeRadius + margin;
  const h = domeHeight + margin;
  const value = (goal.x * goal.x + goal.z * goal.z) / (r * r) + (goal.y * goal.y) / (h * h);
  if (inside ? value > 1 : value < 1) goal.multiplyScalar(1 / Math.sqrt(Math.max(value, 1e-6)));
}
