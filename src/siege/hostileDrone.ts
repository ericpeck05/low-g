import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { applySpread } from '../weapons/hitscan';
import { terrainHeight } from '../world/terrain';
import { DESIGNS, type DroneDesign } from './droneDesigns';
import type { NavGraph } from './navGraph';
import type { DroneStats, DroneType } from './rounds';

// One hostile drone's mind and body. It comes out of a spawn point, then does what its
// type does:
//  scout     circles you at range, charges (its core glows brighter, so you can react), fires a bolt
//  gunner    the same, closer in, firing bursts from its two gun pods
//  shielded  flies shield-first and only turns to face you when it shoots
//  sniper    hangs far back, tracks you with a red beam, then fires one hard shot down it
//  repair    keeps near the most damaged drone and repairs everything close by
//  kamikaze  flies straight at you and blows up
//  carrier   the boss: circles high, fires fans of bolts and launches scouts from its bay
// Every type steers around buildings and the dome glass, and if it loses track of you for
// a while it comes hunting.

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
  nav: NavGraph; // the open-air routes through the dome, for finding the player
  routeBlocked: (a: THREE.Vector3, b: THREE.Vector3) => boolean; // a way sealed by a barrier
}

export type DroneEvent =
  | { kind: 'charge'; drone: HostileDrone }
  | { kind: 'fire'; drone: HostileDrone; from: THREE.Vector3; direction: THREE.Vector3 }
  | { kind: 'aim'; drone: HostileDrone } // a sniper starts its beam
  | { kind: 'snipe'; drone: HostileDrone; from: THREE.Vector3; to: THREE.Vector3 }
  | { kind: 'detonate'; drone: HostileDrone }
  | { kind: 'launch'; drone: HostileDrone };

/** What a hit did. */
export interface DroneDamage {
  core: boolean; // hit the core (or a carrier's weak point)
  destroyed: boolean;
  blocked: boolean; // stopped by a shield
  armored: boolean; // hit a carrier's armor (barely scratched)
  weakPointDestroyed: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const EMERGE_TIME = 1.1; // seconds it spends flying out of its spawn point
const EMERGE_SPEED = 3.5; // m/s
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
  stats: DroneStats = { type: 'scout', health: 0, fireRate: 1, aimSpread: 0, aimLead: 0 };
  /** The carrier that launched it, if any (a carrier keeps count of its scouts). */
  parent: HostileDrone | null = null;
  /** Carrier: each weak point's health (0 once destroyed). */
  weakPoints: number[] = [];
  /** Sniper: where the beam points while it's charging, or null. */
  readonly aimPoint = new THREE.Vector3();
  aimingBeam = false;
  shieldFlash = 0;
  /** Repair drones: the drones it mended this frame (for drawing its tethers). */
  healing: HostileDrone[] = [];

  readonly body: RAPIER.Collider;
  readonly core: RAPIER.Collider;
  readonly hull: RAPIER.Collider; // the carrier's flat armored body
  readonly weakPointColliders: RAPIER.Collider[];

  private orbit = 0; // angle around the player
  private orbitDirection = 1;
  private flipTimer = 0;
  private range = 15;
  private height = 4;
  private fireTimer = 0;
  private chargeTimer = 0;
  private charging = false;
  private burstLeft = 0;
  private burstTimer = 0;
  private muzzle = 0; // which gun pod fires next
  private launchTimer = 0;
  private sees = false;
  private sightTimer = 0;
  private dodgeTimer = 0;
  private roll = 0;
  private emergeTimer = 0;
  private emergeDirection = new THREE.Vector3();
  private route: THREE.Vector3[] = []; // waypoints toward the player while hunting
  private routeTimer = 0;
  private orbitReach = Infinity; // open space from the player toward its circling spot
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private look = new THREE.Matrix4();
  private facing = new THREE.Quaternion();

  constructor(
    world: RAPIER.World,
    readonly index: number, // its slot in the pool (and in its fleet's drawing)
  ) {
    const disabled = (desc: RAPIER.ColliderDesc) => {
      const collider = world.createCollider(desc);
      collider.setEnabled(false);
      return collider;
    };
    this.body = disabled(RAPIER.ColliderDesc.ball(0.4));
    this.core = disabled(RAPIER.ColliderDesc.ball(0.14));
    const hull = DESIGNS.carrier.hull!;
    this.hull = disabled(RAPIER.ColliderDesc.cylinder(hull.halfHeight, hull.radius));
    this.weakPointColliders = DESIGNS.carrier.weakPoints!.map(() => disabled(RAPIER.ColliderDesc.ball(DESIGNS.carrier.weakPointRadius! + 0.05)));
  }

  get type(): DroneType {
    return this.stats.type;
  }

  get design(): DroneDesign {
    return DESIGNS[this.stats.type];
  }

  /** Its full health (for repairs). */
  get maxHealth() {
    return this.stats.health;
  }

  /**
   * Appear at `position`, facing the point `toward` (the player), with this round's stats.
   * exit: the way out of its spawn point, which it flies along for a moment first.
   */
  spawn(position: THREE.Vector3, toward: THREE.Vector3, stats: DroneStats, exit: THREE.Vector3 | null = null) {
    this.stats = stats;
    const cfg = this.config();
    const design = this.design;
    this.active = true;
    this.health = stats.health;
    this.parent = null;
    this.weakPoints = design.weakPoints ? design.weakPoints.map(() => stats.health) : [];
    this.emergeTimer = exit ? EMERGE_TIME : 0;
    if (exit) this.emergeDirection.copy(exit);
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.orbit = Math.atan2(position.x - toward.x, position.z - toward.z);
    this.orbitDirection = Math.random() < 0.5 ? 1 : -1;
    this.flipTimer = random([2.5, 6]);
    this.range = random(cfg.range);
    this.height = random(cfg.height);
    this.fireTimer = random(cfg.fireInterval) / stats.fireRate + 0.8; // a moment to get its bearings first
    this.launchTimer = CONFIG.siege.carrier.launchInterval * 0.5;
    this.charging = false;
    this.aimingBeam = false;
    this.burstLeft = 0;
    this.sees = false;
    this.unseenTime = 0;
    this.route = [];
    this.orbitReach = Infinity;
    this.shieldFlash = 0;
    this.sightTimer = Math.random() * 0.15; // spread the sight checks over different frames
    this.look.lookAt(position, toward, UP);
    this.rotation.setFromRotationMatrix(this.look);
    // Its colliders: the body sized for its type, a core if it has one, the carrier's hull and weak points.
    this.body.setRadius(design.radius);
    this.body.setEnabled(true);
    this.core.setEnabled(design.core !== null && design.coreRadius > 0);
    if (design.coreRadius > 0) this.core.setRadius(design.coreRadius);
    this.hull.setEnabled(design.hull !== undefined);
    this.weakPointColliders.forEach((c, k) => c.setEnabled(k < this.weakPoints.length));
    this.placeColliders();
  }

  despawn() {
    this.active = false;
    this.charging = false;
    this.aimingBeam = false;
    for (const c of [this.body, this.core, this.hull, ...this.weakPointColliders]) c.setEnabled(false);
  }

  /** 0 normally, rising to 1 as it charges a shot. */
  get glow() {
    const telegraph = this.config().telegraph;
    return this.charging && telegraph > 0 ? 1 - this.chargeTimer / telegraph : 0;
  }

  /** Lost track of you, so it's flying straight for you instead of circling at range. */
  get hunting() {
    return this.type === 'kamikaze' || this.unseenTime > CONFIG.siege.lostSightTime;
  }

  /** Where the glowing core (and its gun) is in the world. */
  corePosition(out = new THREE.Vector3()) {
    return out.copy(this.design.core ?? new THREE.Vector3()).applyQuaternion(this.rotation).add(this.position);
  }

  /** A point on the drone (in its own space) in the world. */
  worldPoint(local: THREE.Vector3, out = new THREE.Vector3()) {
    return out.copy(local).applyQuaternion(this.rotation).add(this.position);
  }

  /** Which way it's facing (the way its core points). */
  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.rotation);
  }

  /** Takes a hit on one of its colliders, from a shot going `direction`. */
  takeHit(collider: RAPIER.Collider, damage: number, direction: THREE.Vector3): DroneDamage {
    const result: DroneDamage = { core: false, destroyed: false, blocked: false, armored: false, weakPointDestroyed: false };
    // A shielded drone's shield stops anything coming at its front.
    if (this.type === 'shielded') {
      const arc = THREE.MathUtils.degToRad(CONFIG.siege.shielded.shieldArc);
      if (-direction.dot(this.forward()) > Math.cos(arc)) {
        this.shieldFlash = 1;
        result.blocked = true;
        return result;
      }
    }
    if (this.type === 'carrier') {
      const k = this.weakPointColliders.indexOf(collider);
      if (k >= 0 && this.weakPoints[k] > 0) {
        result.core = true;
        this.weakPoints[k] -= damage;
        if (this.weakPoints[k] <= 0) {
          this.weakPoints[k] = 0;
          this.weakPointColliders[k].setEnabled(false);
          result.weakPointDestroyed = true;
        }
      } else {
        // Armor: a little gets through, shared across the weak points still standing.
        result.armored = true;
        const intact = this.weakPoints.filter((h) => h > 0).length;
        this.weakPoints = this.weakPoints.map((h) => (h > 0 ? Math.max(1, h - (damage * CONFIG.siege.carrier.armor) / intact) : 0));
      }
      result.destroyed = this.weakPoints.every((h) => h <= 0);
      return result;
    }
    result.core = collider.handle === this.core.handle;
    this.health -= damage * (result.core ? CONFIG.siege.coreMultiplier : 1);
    result.destroyed = this.health <= 0;
    return result;
  }

  update(dt: number, ctx: DroneContext, events: DroneEvent[]) {
    this.spin += dt * 38;
    this.shieldFlash = Math.max(0, this.shieldFlash - dt * 4);

    // Coming out of its spawn point: straight out, before it starts thinking.
    if (this.emergeTimer > 0) {
      this.emergeTimer -= dt;
      this.velocity.copy(this.emergeDirection).multiplyScalar(EMERGE_SPEED);
      this.move(dt, ctx);
      this.face(dt, ctx);
      this.placeColliders();
      return;
    }

    // Can it see the player? Checked a few times a second, not every frame.
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = 0.15;
      const wasHunting = this.hunting;
      this.sees = this.canSee(ctx);
      // Found you again: take up circling from where it is now.
      if (this.sees && wasHunting) this.orbit = Math.atan2(this.position.x - ctx.feet.x, this.position.z - ctx.feet.z);
      this.orbitReach = this.openSpace(ctx);
    }
    this.unseenTime = this.sees ? 0 : this.unseenTime + dt;

    this.steer(dt, ctx);
    this.face(dt, ctx);
    this.placeColliders();
    if (this.type === 'kamikaze') {
      // Close enough to you: it goes off.
      if (this.position.distanceTo(ctx.head.clone().setY(ctx.head.y - 0.5)) < CONFIG.siege.kamikaze.triggerDistance) {
        events.push({ kind: 'detonate', drone: this });
      }
      return;
    }
    if (this.type === 'carrier') this.launchScouts(dt, events);
    if (this.type !== 'repair') this.shoot(dt, ctx, events);
  }

  // ---- Moving ----

  // Head for its goal (circling spot, a damaged ally, or straight at you), then dodge
  // walls and other drones.
  private steer(dt: number, ctx: DroneContext) {
    const cfg = this.config();
    this.flipTimer -= dt;
    if (this.flipTimer <= 0) {
      this.orbitDirection *= -1;
      this.flipTimer = random([2.5, 6]);
    }
    let goal: THREE.Vector3;
    let topSpeed = cfg.speed;
    if (this.hunting) {
      goal = this.huntGoal(dt, ctx);
      if (this.type !== 'kamikaze') topSpeed *= CONFIG.siege.huntSpeed;
    } else if (this.type === 'repair' && this.supportGoal(ctx)) {
      goal = this.supportGoal(ctx)!;
    } else {
      this.orbit += this.orbitDirection * (cfg.strafeSpeed / this.range) * dt;
      goal = this.orbitSpot(ctx);
      // Stay in the same open space as the player: indoors or under a walkway, its
      // circling spot is pulled in short of the first wall between you and it.
      const out = goal.clone().sub(ctx.head);
      const room = this.orbitReach - 1.5;
      if (out.length() > room) goal.copy(ctx.head).addScaledVector(out.normalize(), Math.max(4, room));
      keepOnSide(goal, ctx.insideDome);
      goal.y = Math.max(goal.y, terrainHeight(goal.x, goal.z) + 2 + this.design.radius);
    }

    // Fly toward the goal, easing off as it gets close (a kamikaze doesn't ease off).
    const toGoal = goal.sub(this.position);
    const distance = toGoal.length();
    const ease = this.type === 'kamikaze' ? topSpeed : Math.min(topSpeed, distance * 1.2);
    const desired = toGoal.multiplyScalar(ease / Math.max(distance, 1e-3));
    const accel = desired.sub(this.velocity).multiplyScalar(2);

    // Keep apart from other drones (bigger ones need more room).
    for (const other of ctx.others) {
      if (other === this || !other.active) continue;
      const away = this.position.clone().sub(other.position);
      const d = away.length();
      const room = 2.2 + this.design.radius + other.design.radius;
      if (d < room && d > 1e-3) accel.addScaledVector(away, ((room - d) / d) * 5);
    }

    // Look ahead along its flight for anything solid, and steer away from it.
    let avoiding = false;
    const radius = this.design.radius;
    const speed = this.velocity.length();
    if (speed > 0.3) {
      const direction = this.velocity.clone().divideScalar(speed);
      const reach = radius + 1.2 + speed * 0.8;
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
        // Hunting: slide along the wall and climb, to find a way around or over it.
        if (this.hunting) {
          const along = new THREE.Vector3().crossVectors(normal, UP).multiplyScalar(this.orbitDirection);
          accel.addScaledVector(along, cfg.acceleration * 1.5).addScaledVector(UP, cfg.acceleration);
        }
      }
    }
    this.dodgeTimer -= dt;
    accel.clampLength(0, cfg.acceleration * (avoiding ? 2.5 : 1));
    this.velocity.addScaledVector(accel, dt).clampLength(0, topSpeed);
    this.move(dt, ctx);
  }

  // Move, but never into anything: if the step would touch a wall, stop at it and
  // lose the speed that was going into it.
  private move(dt: number, ctx: DroneContext) {
    const radius = this.design.radius;
    const step = this.velocity.length() * dt;
    if (step > 1e-5) {
      const direction = this.velocity.clone().normalize();
      const hit = this.cast(ctx, this.position, direction, step + radius);
      if (hit) {
        const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
        this.position.addScaledVector(direction, Math.max(0, hit.timeOfImpact - radius - 0.05));
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
      if (gap < radius && out.lengthSq() > 1e-8) {
        out.normalize();
        this.position.copy(near.point).addScaledVector(out, radius);
        this.velocity.addScaledVector(out, -Math.min(0, this.velocity.dot(out)));
      }
    }
    // Never sink to the ground.
    const floor = terrainHeight(this.position.x, this.position.z) + 0.8 + radius;
    if (this.position.y < floor) {
      this.position.y = floor;
      this.velocity.y = Math.max(0, this.velocity.y);
    }
  }

  // Where it would circle to right now, at its range and height around the player.
  private orbitSpot(ctx: DroneContext) {
    return new THREE.Vector3(
      ctx.feet.x + Math.sin(this.orbit) * this.range,
      ctx.feet.y + this.height,
      ctx.feet.z + Math.cos(this.orbit) * this.range,
    );
  }

  // Hunting: inside the dome, follow a route through the open air to somewhere it can
  // see you (refreshed every so often, as you move). Outside, the ground is open, so it
  // flies straight for you. A kamikaze that can see you just flies straight in.
  private huntGoal(dt: number, ctx: DroneContext) {
    const target = this.type === 'kamikaze' ? ctx.head.clone().setY(ctx.head.y - 0.4) : ctx.head.clone().setY(ctx.head.y + 2);
    if (this.type === 'kamikaze' && this.sees) return target;
    this.routeTimer -= dt;
    if (ctx.insideDome && this.routeTimer <= 0) {
      this.route = ctx.nav.route(this.position, ctx.head, ctx.collider, ctx.routeBlocked);
      this.routeTimer = 1.5;
    }
    while (this.route.length > 0 && this.position.distanceTo(this.route[0]) < 2.5) this.route.shift();
    return this.route.length > 0 ? this.route[0].clone() : target;
  }

  // Repair drones: hover beside the most damaged drone nearby, on the side away from you.
  private supportGoal(ctx: DroneContext) {
    let patient: HostileDrone | null = null;
    let worst = 0.999;
    for (const other of ctx.others) {
      if (other === this || !other.active || other.type === 'carrier' || other.type === 'repair') continue;
      if (other.position.distanceTo(this.position) > 45) continue;
      const share = other.health / other.maxHealth;
      if (share < worst) {
        worst = share;
        patient = other;
      }
    }
    if (!patient) return null;
    const away = patient.position.clone().sub(ctx.head).setY(0).normalize();
    const spot = patient.position.clone().addScaledVector(away, 3).setY(patient.position.y + 1.5);
    // But not too close to you.
    const fromPlayer = spot.clone().sub(ctx.head);
    const keep = CONFIG.siege.repair.keepAway;
    if (fromPlayer.length() < keep) spot.copy(ctx.head).addScaledVector(fromPlayer.normalize(), keep);
    return spot;
  }

  // Keep the core pointed at the player and lean into turns. A shielded drone instead
  // flies shield-first and only swings round (slowly) to shoot; a kamikaze or repair
  // drone points where it's going.
  private face(dt: number, ctx: DroneContext) {
    const forwardTarget =
      this.type === 'kamikaze' || this.type === 'repair' || (this.type === 'shielded' && !this.charging)
        ? this.position.clone().addScaledVector(this.velocity.lengthSq() > 0.25 ? this.velocity : this.forward(), 10)
        : ctx.head;
    this.look.lookAt(this.position, forwardTarget, UP); // a camera-style look: -z toward the target
    this.facing.setFromRotationMatrix(this.look);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.facing);
    const sideways = this.velocity.dot(right);
    const lean = this.type === 'carrier' ? 0.03 : 0.07;
    this.roll += (THREE.MathUtils.clamp(-sideways * lean, -0.4, 0.4) - this.roll) * Math.min(1, dt * 4);
    this.facing.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    const turnRate = this.type === 'shielded' ? CONFIG.siege.shielded.turnRate : this.type === 'carrier' ? 0.7 : 0;
    if (turnRate > 0) this.rotation.rotateTowards(this.facing, turnRate * dt);
    else this.rotation.slerp(this.facing, 1 - Math.exp(-8 * dt));
  }

  // ---- Fighting ----

  // Charge (glowing brighter) for a moment, then fire, unless it loses sight of you.
  private shoot(dt: number, ctx: DroneContext, events: DroneEvent[]) {
    const cfg = this.config();
    // A gunner's burst carries on once started.
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      while (this.burstLeft > 0 && this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer += CONFIG.siege.gunner.burstGap;
        this.fireBolt(ctx, events, this.design.muzzles![this.muzzle++ % this.design.muzzles!.length]);
      }
      return;
    }
    if (this.charging) {
      this.chargeTimer -= dt;
      // A sniper's beam follows you until just before it fires, then holds still.
      if (this.type === 'sniper' && this.chargeTimer > CONFIG.siege.sniper.lockTime) this.aimPoint.copy(this.target(ctx));
      if (!this.sees) {
        this.charging = false; // you ducked behind something: the shot is cancelled
        this.aimingBeam = false;
        this.fireTimer = 0.8;
      } else if (this.chargeTimer <= 0) {
        this.charging = false;
        this.fireTimer = random(cfg.fireInterval) / this.stats.fireRate;
        this.release(ctx, events);
      }
      return;
    }
    if (!this.sees || this.position.distanceTo(ctx.head) > cfg.sightRange) return;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.charging = true;
      this.chargeTimer = cfg.telegraph;
      if (this.type === 'sniper') {
        this.aimingBeam = true;
        this.aimPoint.copy(this.target(ctx));
        events.push({ kind: 'aim', drone: this });
      } else {
        events.push({ kind: 'charge', drone: this });
      }
    }
  }

  // The charge is done: let it go, in this type's way.
  private release(ctx: DroneContext, events: DroneEvent[]) {
    if (this.type === 'sniper') {
      this.aimingBeam = false;
      events.push({ kind: 'snipe', drone: this, from: this.worldPoint(this.design.muzzles![0]), to: this.aimPoint.clone() });
    } else if (this.type === 'gunner') {
      this.burstLeft = CONFIG.siege.gunner.burst;
      this.burstTimer = 0;
    } else if (this.type === 'carrier') {
      // A fan of bolts spread side to side.
      const from = this.worldPoint(new THREE.Vector3(0, -0.6, -1.6));
      const aim = this.aim(from, ctx);
      const count = CONFIG.siege.carrier.fan;
      for (let k = 0; k < count; k++) {
        const angle = THREE.MathUtils.degToRad((k - (count - 1) / 2) * 7);
        events.push({ kind: 'fire', drone: this, from, direction: aim.clone().applyAxisAngle(UP, angle) });
      }
    } else {
      this.fireBolt(ctx, events);
    }
  }

  private fireBolt(ctx: DroneContext, events: DroneEvent[], muzzle?: THREE.Vector3) {
    const from = muzzle ? this.worldPoint(muzzle) : this.corePosition();
    events.push({ kind: 'fire', drone: this, from, direction: this.aim(from, ctx) });
  }

  // The carrier sends out a scout every so often, from the bay underneath.
  private launchScouts(dt: number, events: DroneEvent[]) {
    this.launchTimer -= dt;
    if (this.launchTimer > 0) return;
    this.launchTimer = CONFIG.siege.carrier.launchInterval;
    events.push({ kind: 'launch', drone: this });
  }

  // Your chest, partly leading your movement.
  private target(ctx: DroneContext) {
    const target = ctx.head.clone().setY(ctx.head.y - 0.45);
    const flightTime = this.position.distanceTo(target) / CONFIG.siege.bolt.speed;
    return target.addScaledVector(ctx.velocity, flightTime * this.stats.aimLead);
  }

  // Aim at your chest with a little error. Both get sharper in later rounds.
  private aim(from: THREE.Vector3, ctx: DroneContext) {
    return applySpread(this.target(ctx).sub(from).normalize(), this.stats.aimSpread);
  }

  // ---- Senses ----

  // A clear line from its core to your head (the first thing the ray meets is you).
  private canSee(ctx: DroneContext) {
    const from = this.design.core ? this.corePosition() : this.worldPoint(new THREE.Vector3(0, -0.6, -1.6));
    const toHead = ctx.head.clone().sub(from);
    const distance = toHead.length();
    if (distance > this.config().sightRange * 1.3) return false;
    this.ray.origin = from;
    this.ray.dir = toHead.divideScalar(distance);
    const hit = ctx.world.castRay(this.ray, distance, true, undefined, undefined, undefined, undefined, ctx.blocks);
    return !hit || hit.collider.handle === ctx.collider.handle || hit.timeOfImpact > distance - 0.4;
  }

  // How far you can see from your head toward its circling spot before something's in the way.
  private openSpace(ctx: DroneContext) {
    const out = this.orbitSpot(ctx).sub(ctx.head);
    const distance = out.length();
    if (distance < 1e-3) return Infinity;
    this.ray.origin = ctx.head;
    this.ray.dir = out.divideScalar(distance);
    const hit = ctx.world.castRay(this.ray, distance, true, undefined, undefined, ctx.collider, undefined, ctx.blocks);
    return hit ? hit.timeOfImpact : Infinity;
  }

  private cast(ctx: DroneContext, from: THREE.Vector3, direction: THREE.Vector3, distance: number) {
    this.ray.origin = from;
    this.ray.dir = direction;
    return ctx.world.castRayAndGetNormal(this.ray, distance, true, undefined, undefined, ctx.collider, undefined, ctx.blocks);
  }

  /** The settings for this drone's type. */
  private config() {
    return CONFIG.siege[this.stats.type];
  }

  private placeColliders() {
    this.body.setTranslation(this.position);
    if (this.design.core) this.core.setTranslation(this.corePosition());
    if (this.design.hull) {
      this.hull.setTranslation(this.position);
      this.hull.setRotation(this.rotation);
    }
    this.design.weakPoints?.forEach((p, k) => this.weakPointColliders[k].setTranslation(this.worldPoint(p)));
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
