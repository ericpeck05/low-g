import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { ImpactEffects } from '../weapons/impactEffects';
import { isInsideDome } from '../world/city/dome';
import { Bolts } from './bolts';
import { DroneFleet } from './droneFleet';
import { SiegeEffects } from './effects';
import { type DroneContext, type DroneEvent, HostileDrone } from './hostileDrone';
import { NavGraph } from './navGraph';
import { type DroneStats, RoundDirector, droneStats } from './rounds';
import { type SpawnPoint, SpawnPoints } from './spawnPoints';
import { Suit } from './suit';

// Drone Siege: rounds of hostile drones that hunt you and shoot back. This owns the
// drone pool, the spawn points, their plasma bolts, your suit integrity and the
// explosions, and reports what happened each frame (for sounds and the HUD).

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
  | { kind: 'roundStart'; round: number }
  | { kind: 'roundEnd'; round: number };

/** What a shot did to a drone. */
export interface DroneHit {
  core: boolean;
  destroyed: boolean;
  position: THREE.Vector3;
}

/** A drone on its way out of a spawn point. */
interface Arrival {
  point: SpawnPoint;
  timer: number;
  stats: DroneStats;
}

export class SiegeMode {
  readonly suit = new Suit();
  readonly rounds = new RoundDirector();
  readonly fleet: DroneFleet;
  readonly spawnPoints: SpawnPoints;
  readonly bolts: Bolts;
  readonly effects: SiegeEffects;
  readonly nav: NavGraph;
  active = false;
  kills = 0;
  coreKills = 0;
  private drones: HostileDrone[] = [];
  private byCollider = new Map<number, HostileDrone>(); // collider handle -> drone
  private arrivals: Arrival[] = [];
  private events: SiegeEvent[] = [];
  private droneEvents: DroneEvent[] = [];

  /** True for anything solid that isn't a hostile drone (for rays that should pass through them). */
  readonly blocks = (collider: RAPIER.Collider) => !this.byCollider.has(collider.handle);

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
    impacts: ImpactEffects,
  ) {
    const count = CONFIG.siege.maxDrones;
    this.fleet = new DroneFleet(scene, count);
    for (let i = 0; i < count; i++) {
      const drone = new HostileDrone(world, i);
      this.drones.push(drone);
      this.byCollider.set(drone.body.handle, drone);
      this.byCollider.set(drone.core.handle, drone);
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
    this.setShown(false);
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects() {
    return [...this.fleet.glowObjects, this.bolts.mesh, ...this.effects.glowObjects, ...this.spawnPoints.glowObjects];
  }

  /** Drones flying right now. */
  get alive() {
    return this.drones.filter((d) => d.active).length;
  }

  /** A new game: round 1 starts after a short quiet. */
  start() {
    this.stop();
    this.active = true;
    this.setShown(true);
    this.kills = 0;
    this.coreKills = 0;
    this.suit.reset();
    this.rounds.start();
  }

  /** Clear everything away (leaving the mode). */
  stop() {
    this.active = false;
    for (const drone of this.drones) {
      drone.despawn();
      this.fleet.hide(drone.index);
    }
    this.arrivals = [];
    this.bolts.clear();
    this.effects.clear();
    this.setShown(false);
  }

  /** If the collider is part of a hostile drone, damage it. Otherwise null. */
  tryHit(collider: RAPIER.Collider, damage: number): DroneHit | null {
    const drone = this.byCollider.get(collider.handle);
    if (!drone || !drone.active) return null;
    const core = collider.handle === drone.core.handle;
    const position = drone.position.clone();
    const destroyed = drone.damage(damage * (core ? CONFIG.siege.coreMultiplier : 1));
    if (destroyed) {
      this.effects.explode(drone.position, drone.velocity);
      drone.despawn();
      this.fleet.hide(drone.index);
      this.kills++;
      if (core) this.coreKills++;
      this.rounds.onDestroyed();
    }
    return { core, destroyed, position };
  }

  /** One frame of the fight. Returns what happened, for sounds and the HUD. */
  update(dt: number, player: SiegePlayer) {
    this.events.length = 0;
    this.effects.update(dt);
    if (!this.active) return this.events;
    const inside = isInsideDome(player.feet);

    // The rounds: when to start one, and when the next drone comes in.
    for (const event of this.rounds.update(dt, this.alive + this.arrivals.length)) this.events.push(event);
    if (this.rounds.wantsSpawn) this.sendDrone(player, inside);
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
      else this.fleet.set(drone.index, drone.position, drone.rotation, drone.glow, drone.spin);
    }
    for (const event of this.droneEvents) {
      if (event.kind === 'charge') this.events.push({ kind: 'charge', position: event.drone.position.clone() });
      else {
        const { speed, damage } = CONFIG.siege.bolt;
        this.bolts.fire(event.from, event.direction, speed, damage);
        this.events.push({ kind: 'fire', position: event.from });
      }
    }

    for (const event of this.bolts.update(dt, player)) {
      if (event.kind === 'hitPlayer') {
        this.events.push({ kind: 'playerHit', damage: event.damage, from: event.from });
        if (this.suit.damage(event.damage)) this.events.push({ kind: 'suitDestroyed' });
      } else if (event.kind === 'impact') {
        this.effects.boltImpact(event.point, event.normal);
        this.events.push({ kind: 'boltImpact', position: event.point });
      } else {
        this.events.push({ kind: 'whiz', position: event.point });
      }
    }
    this.suit.update(dt);
    return this.events;
  }

  /** Bring in one drone of the current round: light up a spawn point, then send it out. */
  sendDrone(player: SiegePlayer, inside = isInsideDome(player.feet)) {
    const point = this.spawnPoints.pick(player.feet, inside);
    if (!point) {
      this.rounds.onSpawnFailed();
      return;
    }
    this.spawnPoints.warn(point);
    this.arrivals.push({ point, timer: CONFIG.siege.rounds.spawnWarning, stats: droneStats(Math.max(1, this.rounds.round)) });
    this.events.push({ kind: 'spawnWarning', position: point.position.clone() });
  }

  // Drones coming out of spawn points once their warning glow is done.
  private updateArrivals(dt: number, player: SiegePlayer) {
    for (let i = this.arrivals.length - 1; i >= 0; i--) {
      const arrival = this.arrivals[i];
      arrival.timer -= dt;
      if (arrival.timer > 0) continue;
      const drone = this.drones.find((d) => !d.active);
      if (!drone) continue; // every drone is flying: wait for one to go down
      drone.spawn(arrival.point.position, player.head, arrival.stats, arrival.point.exit);
      this.fleet.set(drone.index, drone.position, drone.rotation, 0, 0);
      this.spawnPoints.release(arrival.point);
      this.effects.arrive(arrival.point.position);
      this.events.push({ kind: 'arrived', position: arrival.point.position.clone() });
      this.arrivals.splice(i, 1);
    }
  }

  // Hunting got nowhere: it gives up and goes back to come in again from a spawn point
  // near you, so a round never stalls on a drone stuck somewhere. Straight away if it's on
  // the other side of the dome glass, where it could never reach you.
  private lost(drone: HostileDrone, playerInside: boolean) {
    if (!drone.hunting) return false;
    const wrongSide = isInsideDome(drone.position) !== playerInside;
    return wrongSide || drone.unseenTime > CONFIG.siege.lostSightTime + CONFIG.siege.huntTimeout;
  }

  private recall(drone: HostileDrone) {
    this.effects.arrive(drone.position);
    drone.despawn();
    this.fleet.hide(drone.index);
    this.rounds.onRecalled();
  }

  // The drone, bolt and debris batches are drawn even when every copy is hidden, so
  // outside Drone Siege they're switched off entirely.
  private setShown(shown: boolean) {
    this.fleet.group.visible = shown;
    this.bolts.mesh.visible = shown;
    this.effects.debris.visible = shown;
    this.spawnPoints.setActive(shown);
  }
}
