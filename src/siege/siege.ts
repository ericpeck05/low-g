import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { ImpactEffects } from '../weapons/impactEffects';
import { isInsideDome } from '../world/city/dome';
import { Beams } from './beams';
import { Bolts, segmentDistance } from './bolts';
import { DESIGNS } from './droneDesigns';
import { DroneFleet } from './droneFleet';
import { SiegeEffects } from './effects';
import { type DroneContext, type DroneEvent, HostileDrone } from './hostileDrone';
import { NavGraph } from './navGraph';
import { type DroneStats, type DroneType, type RoundKind, RoundDirector, droneStats } from './rounds';
import { type SpawnPoint, SpawnPoints } from './spawnPoints';
import { Suit } from './suit';

// Drone Siege: rounds of hostile drones that hunt you and shoot back. This owns the
// drone pool, the spawn points, their plasma bolts, your suit integrity and the
// explosions, works out what each kind of drone's attacks and hits do, and reports
// what happened each frame (for sounds and the HUD).

/** The player, as the siege sees them. */
export interface SiegePlayer {
  feet: THREE.Vector3;
  head: THREE.Vector3;
  height: number;
  velocity: THREE.Vector3;
  collider: RAPIER.Collider;
}

export type SiegeEvent =
  | { kind: 'charge'; position: THREE.Vector3 }
  | { kind: 'fire'; position: THREE.Vector3 }
  | { kind: 'boltImpact'; position: THREE.Vector3 }
  | { kind: 'whiz'; position: THREE.Vector3 }
  | { kind: 'playerHit'; damage: number; from: THREE.Vector3 }
  | { kind: 'suitDestroyed' }
  | { kind: 'spawnWarning'; position: THREE.Vector3 }
  | { kind: 'arrived'; position: THREE.Vector3 }
  | { kind: 'roundStart' | 'roundEnd'; round: number; special: RoundKind }
  | { kind: 'shieldBlock'; position: THREE.Vector3 }
  | { kind: 'sniperAim'; position: THREE.Vector3 }
  | { kind: 'sniperShot'; position: THREE.Vector3 }
  | { kind: 'launch'; position: THREE.Vector3 }
  | { kind: 'blast'; position: THREE.Vector3 } // a kamikaze going off
  | { kind: 'beep'; position: THREE.Vector3 } // a kamikaze closing in
  | { kind: 'weakPoint'; position: THREE.Vector3 } // one of the carrier's weak points destroyed
  | { kind: 'carrierDown'; position: THREE.Vector3 }
  | { kind: 'maxAmmo' }; // a swarm round's reward

/** What a shot did to a drone. */
export interface DroneHit {
  type: DroneType;
  core: boolean;
  destroyed: boolean;
  blocked: boolean; // stopped by a shield
  armored: boolean; // bounced off a carrier's armor
  position: THREE.Vector3;
  points: number; // earned by this hit
  colliders: number[]; // the drone's collider handles (a piercing shot passes them by)
}

/** A drone on its way out of a spawn point. */
interface Arrival {
  point: SpawnPoint;
  timer: number;
  stats: DroneStats;
}

const BEAM_RED = new THREE.Color(...CONFIG.siege.glowColor);
const TYPES = Object.keys(DESIGNS) as DroneType[];

export class SiegeMode {
  readonly suit = new Suit();
  readonly rounds = new RoundDirector();
  readonly spawnPoints: SpawnPoints;
  readonly bolts: Bolts;
  readonly effects: SiegeEffects;
  readonly nav: NavGraph;
  active = false;
  kills = 0;
  coreKills = 0;
  points = 0;
  pointsEarned = 0; // over the whole game, for the results
  private fleets = {} as Record<DroneType, DroneFleet>;
  private drawnAs: (DroneType | null)[] = []; // per drone: which fleet is drawing it
  private beams: Beams;
  private snipeFlashes: { from: THREE.Vector3; to: THREE.Vector3; age: number }[] = [];
  private beepTimers: number[] = [];
  private shot = 0; // counts trigger pulls, so one blast scores each drone it hits once
  private scoredShot: number[] = []; // per drone: the last shot that scored on it...
  private scoredPoints: number[] = []; // ...and how much that shot has scored on it so far
  private drones: HostileDrone[] = [];
  private byCollider = new Map<number, HostileDrone>(); // collider handle -> drone
  private arrivals: Arrival[] = [];
  private events: SiegeEvent[] = []; // this frame's
  private pending: SiegeEvent[] = []; // caused by your shots since the last frame
  private updating = false;
  private droneEvents: DroneEvent[] = [];
  private player: SiegePlayer | null = null;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  /** True for anything solid that isn't a hostile drone (for rays that should pass through them). */
  readonly blocks = (collider: RAPIER.Collider) => !this.byCollider.has(collider.handle);

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
    impacts: ImpactEffects,
  ) {
    const count = CONFIG.siege.maxDrones;
    for (const type of TYPES) this.fleets[type] = new DroneFleet(scene, DESIGNS[type], type === 'carrier' ? count : count);
    for (let i = 0; i < count; i++) {
      const drone = new HostileDrone(world, i);
      this.drones.push(drone);
      this.drawnAs.push(null);
      for (const collider of this.collidersOf(drone)) this.byCollider.set(collider.handle, drone);
    }
    this.spawnPoints = new SpawnPoints(scene);
    // Collision queries only see colliders once the physics world has stepped, and at
    // load it hasn't yet. Nothing moves in a step this early.
    world.step();
    const started = performance.now();
    this.nav = new NavGraph(world, this.blocks);
    if (import.meta.env.DEV) console.debug(`Drone routes: ${this.nav.size} points in ${Math.round(performance.now() - started)} ms`);
    this.bolts = new Bolts(scene, world, this.blocks);
    this.effects = new SiegeEffects(scene, world, this.blocks, impacts);
    this.beams = new Beams(scene);
    this.setShown(false);
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects() {
    return [
      ...TYPES.flatMap((type) => this.fleets[type].glowObjects),
      this.bolts.mesh,
      this.beams.group,
      ...this.effects.glowObjects,
      ...this.spawnPoints.glowObjects,
    ];
  }

  /** Drones flying right now. */
  get alive() {
    return this.drones.filter((d) => d.active).length;
  }

  /** The carrier, if one is out: how much of each weak point is left (0 to 1), for the HUD. */
  get boss() {
    const carrier = this.drones.find((d) => d.active && d.type === 'carrier');
    return carrier ? carrier.weakPoints.map((h) => h / carrier.maxHealth) : null;
  }

  /** A new game: round 1 starts after a short quiet. */
  start() {
    this.stop();
    this.active = true;
    this.setShown(true);
    this.kills = 0;
    this.coreKills = 0;
    this.points = CONFIG.siege.points.start;
    this.pointsEarned = 0;
    this.suit.reset();
    this.rounds.start();
  }

  /** Clear everything away (leaving the mode). */
  stop() {
    this.active = false;
    for (const drone of this.drones) this.remove(drone);
    this.arrivals = [];
    this.snipeFlashes = [];
    this.bolts.clear();
    this.effects.clear();
    this.beams.begin();
    this.beams.end();
    this.setShown(false);
  }

  /** Call once per trigger pull, before its pellets or beam hit anything. */
  beginShot() {
    this.shot++;
  }

  /** If the collider is part of a hostile drone, damage it (and score it). Otherwise null. */
  tryHit(collider: RAPIER.Collider, damage: number, direction: THREE.Vector3): DroneHit | null {
    const drone = this.byCollider.get(collider.handle);
    if (!drone || !drone.active) return null;
    const type = drone.type;
    const position = drone.position.clone();
    const colliders = this.collidersOf(drone).map((c) => c.handle);
    const hit = drone.takeHit(collider, damage, direction);
    const result: DroneHit = { type, core: hit.core, destroyed: hit.destroyed, blocked: hit.blocked, armored: hit.armored, position, points: 0, colliders };
    if (hit.blocked) {
      this.emit({ kind: 'shieldBlock', position });
      return result;
    }
    if (hit.weakPointDestroyed && !hit.destroyed) {
      this.effects.explode(this.weakPointPosition(drone, collider), drone.velocity, 0.6);
      this.emit({ kind: 'weakPoint', position });
    }
    if (hit.destroyed) this.destroy(drone, hit.core);
    // Points: a drone hit by this shot is worth `hit` once; destroying it is worth `kill`
    // (or `coreKill`) instead. Later pellets on the same drone add only the difference.
    // A carrier's weak points are worth a kill each, and the carrier itself far more.
    const P = CONFIG.siege.points;
    const i = drone.index;
    const already = this.scoredShot[i] === this.shot ? this.scoredPoints[i] : 0;
    const due = hit.destroyed
      ? type === 'carrier'
        ? CONFIG.siege.carrier.points
        : hit.core
          ? P.coreKill
          : P.kill
      : hit.weakPointDestroyed
        ? P.kill
        : P.hit;
    result.points = Math.max(0, due - already);
    this.scoredShot[i] = this.shot;
    this.scoredPoints[i] = Math.max(already, due);
    this.addPoints(result.points);
    return result;
  }

  addPoints(points: number) {
    this.points += points;
    this.pointsEarned += points;
  }

  /** Pay for something. Returns false (and charges nothing) if you can't afford it. */
  spend(price: number) {
    if (this.points < price) return false;
    this.points -= price;
    return true;
  }

  /** One frame of the fight. Returns what happened, for sounds and the HUD. */
  update(dt: number, player: SiegePlayer) {
    this.player = player;
    this.effects.update(dt);
    // This frame's events start with what your shots caused since the last one.
    this.events = this.pending;
    this.pending = [];
    if (!this.active) return this.events;
    this.updating = true;
    const inside = isInsideDome(player.feet);

    // The rounds: when to start one, and when the next drone comes in.
    for (const event of this.rounds.update(dt, this.alive + this.arrivals.length)) {
      this.emit(event);
      // Clearing a swarm round earns a Max Ammo.
      if (event.kind === 'roundEnd' && event.special === 'swarm') this.emit({ kind: 'maxAmmo' });
    }
    if (this.rounds.wantsSpawn) this.sendDrone(player, this.rounds.wantsSpawn, inside);
    this.spawnPoints.update(dt);
    this.updateArrivals(dt, player);

    const ctx: DroneContext = {
      world: this.world,
      blocks: this.blocks,
      feet: player.feet,
      head: player.head,
      velocity: player.velocity,
      collider: player.collider,
      insideDome: inside,
      others: this.drones,
      nav: this.nav,
    };
    this.droneEvents.length = 0;
    for (const drone of this.drones) {
      if (!drone.active) continue;
      drone.update(dt, ctx, this.droneEvents);
      if (this.lost(drone, inside)) this.recall(drone);
    }
    for (const event of this.droneEvents) this.handle(event, player);
    this.repairs(dt);
    this.beeps(dt, player);
    this.draw(dt);

    for (const event of this.bolts.update(dt, player)) {
      if (event.kind === 'hitPlayer') this.hurtPlayer(event.damage, event.from);
      else if (event.kind === 'impact') {
        this.effects.boltImpact(event.point, event.normal);
        this.emit({ kind: 'boltImpact', position: event.point });
      } else {
        this.emit({ kind: 'whiz', position: event.point });
      }
    }
    this.suit.update(dt);
    this.updating = false;
    return this.events;
  }

  // Report something that happened (in this frame's list, or the next one's if it was
  // caused by a shot between frames).
  private emit(event: SiegeEvent) {
    (this.updating ? this.events : this.pending).push(event);
  }

  /** Bring in one drone: light up a spawn point, then send it out. */
  sendDrone(player: SiegePlayer, type: DroneType, inside = isInsideDome(player.feet)) {
    const point = this.spawnPoints.pick(player.feet, inside);
    if (!point) {
      this.rounds.onSpawnFailed(type);
      return;
    }
    this.spawnPoints.warn(point);
    this.arrivals.push({ point, timer: CONFIG.siege.rounds.spawnWarning, stats: droneStats(Math.max(1, this.rounds.round), type) });
    this.emit({ kind: 'spawnWarning', position: point.position.clone() });
  }

  /** Testing (F4 menu, dev tools): a drone of any type, out of the nearest spawn point now. */
  debugSpawn(type: DroneType) {
    if (!this.player) return;
    this.rounds.onLaunched(); // it counts toward the round
    this.sendDrone(this.player, type);
  }

  /** Show everything for one frame at load, so its shadow shaders compile then and not mid-game. */
  showForWarmUp(shown: boolean) {
    this.setShown(shown);
    for (const type of TYPES) this.fleets[type].showForWarmUp(shown);
  }

  // ---- What drones do ----

  private handle(event: DroneEvent, player: SiegePlayer) {
    const drone = event.drone;
    if (event.kind === 'charge') this.emit({ kind: 'charge', position: drone.position.clone() });
    else if (event.kind === 'fire') {
      const { speed, damage } = CONFIG.siege.bolt;
      this.bolts.fire(event.from, event.direction, speed, damage);
      this.emit({ kind: 'fire', position: event.from });
    } else if (event.kind === 'aim') this.emit({ kind: 'sniperAim', position: drone.position.clone() });
    else if (event.kind === 'snipe') this.snipe(event.from, event.to, player);
    else if (event.kind === 'detonate') this.blast(drone, true);
    else if (event.kind === 'launch') this.launch(drone, player);
  }

  // A sniper's shot: instant, straight down its locked beam, stopped by whatever's in the way.
  private snipe(from: THREE.Vector3, to: THREE.Vector3, player: SiegePlayer) {
    const direction = to.clone().sub(from).normalize();
    this.ray.origin = from;
    this.ray.dir = direction;
    const wall = this.world.castRayAndGetNormal(this.ray, 160, true, undefined, undefined, player.collider, undefined, this.blocks);
    const end = from.clone().addScaledVector(direction, wall ? wall.timeOfImpact : 160);
    const bottom = player.feet.clone().setY(player.feet.y + CONFIG.player.radius);
    const top = player.feet.clone().setY(player.feet.y + player.height - CONFIG.player.radius);
    if (segmentDistance(from, end, bottom, top) < CONFIG.player.radius + 0.12) this.hurtPlayer(CONFIG.siege.sniper.damage, from);
    else if (wall) this.effects.boltImpact(end, new THREE.Vector3(wall.normal.x, wall.normal.y, wall.normal.z));
    this.snipeFlashes.push({ from, to: end, age: 0 });
    this.emit({ kind: 'sniperShot', position: from.clone() });
  }

  // A carrier sends a scout out of its bay (if it doesn't already have too many out).
  private launch(carrier: HostileDrone, player: SiegePlayer) {
    const out = this.drones.filter((d) => d.active && d.parent === carrier).length;
    if (out >= CONFIG.siege.carrier.maxLaunched) return;
    const drone = this.drones.find((d) => !d.active);
    if (!drone) return;
    const bay = carrier.worldPoint(new THREE.Vector3(0, -1.2, 0));
    drone.spawn(bay, player.head, droneStats(this.rounds.round, 'scout'), new THREE.Vector3(0, -1, 0));
    drone.parent = carrier;
    this.rounds.onLaunched();
    this.effects.arrive(bay);
    this.emit({ kind: 'launch', position: bay });
  }

  // A kamikaze going off (on reaching you, or when shot): it hurts you if you're close.
  private blast(drone: HostileDrone, reachedYou: boolean) {
    const at = drone.position.clone();
    this.effects.explode(at, drone.velocity, 1.3);
    this.emit({ kind: 'blast', position: at });
    if (this.player) {
      // Full damage within its trigger distance, fading to 40% at the edge of the blast.
      const { blastRadius, damage, triggerDistance } = CONFIG.siege.kamikaze;
      const chest = this.player.head.clone().setY(this.player.head.y - 0.5);
      const distance = chest.distanceTo(at);
      const fade = Math.max(0, distance - triggerDistance) / (blastRadius - triggerDistance);
      if (distance < blastRadius) this.hurtPlayer(Math.round(damage * (1 - fade * 0.6)), at);
    }
    if (reachedYou) {
      this.remove(drone);
      this.rounds.onDestroyed();
    }
  }

  // Repair drones mend every drone within reach (not carriers, not each other).
  private repairs(dt: number) {
    const { healRate, healRange } = CONFIG.siege.repair;
    for (const medic of this.drones) {
      if (!medic.active || medic.type !== 'repair') continue;
      for (const other of this.drones) {
        if (!other.active || other === medic || other.type === 'carrier' || other.type === 'repair') continue;
        if (other.health >= other.maxHealth || other.position.distanceTo(medic.position) > healRange) continue;
        other.health = Math.min(other.maxHealth, other.health + healRate * dt);
        medic.healing.push(other);
      }
    }
  }

  // Kamikazes beep as they come, faster the closer they get.
  private beeps(dt: number, player: SiegePlayer) {
    for (const drone of this.drones) {
      if (!drone.active || drone.type !== 'kamikaze') continue;
      const i = drone.index;
      this.beepTimers[i] = (this.beepTimers[i] ?? 0) - dt;
      if (this.beepTimers[i] > 0) continue;
      const distance = drone.position.distanceTo(player.head);
      this.beepTimers[i] = THREE.MathUtils.clamp(distance / 40, 0.1, 0.9);
      this.emit({ kind: 'beep', position: drone.position.clone() });
    }
  }

  private hurtPlayer(damage: number, from: THREE.Vector3) {
    this.emit({ kind: 'playerHit', damage, from: from.clone() });
    if (this.suit.damage(damage)) this.emit({ kind: 'suitDestroyed' });
  }

  // ---- Drawing ----

  private draw(dt: number) {
    this.beams.begin();
    for (const drone of this.drones) {
      if (!drone.active) continue;
      this.show(drone);
      // A sniper's aiming beam, brightening as it charges.
      if (drone.aimingBeam) {
        const muzzle = drone.worldPoint(drone.design.muzzles![0]);
        const far = drone.aimPoint.clone().sub(muzzle).setLength(160).add(muzzle);
        this.beams.draw(muzzle, far, BEAM_RED.clone().multiplyScalar(2 + drone.glow * 6), 0.008 + drone.glow * 0.008, 0.35 + drone.glow * 0.5);
      }
      // A repair drone's tethers to the drones it's mending.
      for (const patient of drone.healing) {
        const flicker = 0.6 + 0.4 * Math.sin(performance.now() / 60 + patient.index);
        this.beams.draw(drone.corePosition(), patient.position, BEAM_RED.clone().multiplyScalar(3 * flicker).lerp(new THREE.Color(3, 2.6, 2.2), 0.4), 0.012, 0.6);
      }
      drone.healing.length = 0;
    }
    // Sniper shots: a bright line that fades in a moment.
    for (let k = this.snipeFlashes.length - 1; k >= 0; k--) {
      const flash = this.snipeFlashes[k];
      flash.age += dt;
      if (flash.age > 0.3) {
        this.snipeFlashes.splice(k, 1);
        continue;
      }
      const fade = 1 - flash.age / 0.3;
      this.beams.draw(flash.from, flash.to, BEAM_RED.clone().multiplyScalar(8).lerp(new THREE.Color(8, 7, 6), 0.5), 0.03 * fade + 0.01, fade);
    }
    this.beams.end();
  }

  // Draw a drone in its type's fleet (moving it over if its slot was last a different type).
  private show(drone: HostileDrone) {
    const i = drone.index;
    const was = this.drawnAs[i];
    if (was && was !== drone.type) this.fleets[was].hide(i);
    this.drawnAs[i] = drone.type;
    this.fleets[drone.type].set(i, drone.position, drone.rotation, {
      glow: drone.glow,
      spin: drone.spin,
      shieldFlash: drone.shieldFlash,
      weakPoints: drone.type === 'carrier' ? drone.weakPoints.map((h) => h > 0) : undefined,
    });
  }

  // ---- Coming and going ----

  // Drones coming out of spawn points once their warning glow is done.
  private updateArrivals(dt: number, player: SiegePlayer) {
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const arrival = this.arrivals[i];
      arrival.timer -= dt;
      if (arrival.timer > 0) continue;
      const drone = this.drones.find((d) => !d.active);
      if (!drone) continue; // every drone is flying: wait for one to go down
      drone.spawn(arrival.point.position, player.head, arrival.stats, arrival.point.exit);
      this.show(drone);
      this.spawnPoints.release(arrival.point);
      this.effects.arrive(arrival.point.position, arrival.stats.type === 'carrier' ? 5 : 1.6);
      this.emit({ kind: 'arrived', position: arrival.point.position.clone() });
      this.arrivals.splice(i, 1);
    }
  }

  // Shot down: an explosion (a big one for the carrier), and it counts for the round.
  private destroy(drone: HostileDrone, byCore: boolean) {
    const at = drone.position.clone();
    if (drone.type === 'carrier') {
      for (let k = 0; k < 4; k++) {
        const offset = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(2.5);
        this.effects.explode(at.clone().add(offset), drone.velocity, 1.8);
      }
      this.emit({ kind: 'carrierDown', position: at });
    } else if (drone.type === 'kamikaze') {
      this.blast(drone, false);
    } else {
      this.effects.explode(at, drone.velocity);
    }
    this.remove(drone);
    this.kills++;
    if (byCore && drone.type !== 'carrier') this.coreKills++;
    this.rounds.onDestroyed();
  }

  private remove(drone: HostileDrone) {
    drone.despawn();
    const was = this.drawnAs[drone.index];
    if (was) this.fleets[was].hide(drone.index);
    this.drawnAs[drone.index] = null;
  }

  // Hunting got nowhere: it gives up and goes back to come in again from a spawn point
  // near you, so a round never stalls on a drone stuck somewhere. Straight away if it's on
  // the other side of the dome glass, where it could never reach you.
  private lost(drone: HostileDrone, playerInside: boolean) {
    if (!drone.hunting || drone.type === 'carrier') return false;
    const wrongSide = isInsideDome(drone.position) !== playerInside;
    return wrongSide || drone.unseenTime > CONFIG.siege.lostSightTime + CONFIG.siege.huntTimeout;
  }

  private recall(drone: HostileDrone) {
    this.effects.arrive(drone.position);
    this.remove(drone);
    this.rounds.onRecalled(drone.type);
  }

  private collidersOf(drone: HostileDrone) {
    return [drone.body, drone.core, drone.hull, ...drone.weakPointColliders];
  }

  private weakPointPosition(drone: HostileDrone, collider: RAPIER.Collider) {
    const k = drone.weakPointColliders.indexOf(collider);
    return k >= 0 ? drone.worldPoint(drone.design.weakPoints![k]) : drone.position.clone();
  }

  // The drone, bolt and debris batches are drawn even when every copy is hidden, so
  // outside Drone Siege they're switched off entirely.
  private setShown(shown: boolean) {
    for (const type of TYPES) this.fleets[type].setShown(shown);
    this.bolts.mesh.visible = shown;
    this.effects.debris.visible = shown;
    this.beams.group.visible = shown;
    this.spawnPoints.setActive(shown);
  }
}
