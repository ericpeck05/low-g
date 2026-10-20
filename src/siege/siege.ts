import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { ImpactEffects } from '../weapons/impactEffects';
import { isInsideDome } from '../world/city/dome';
import { terrainHeight } from '../world/terrain';
import { Bolts } from './bolts';
import { DroneFleet } from './droneFleet';
import { SiegeEffects } from './effects';
import { type DroneContext, type DroneEvent, HostileDrone } from './hostileDrone';
import { Suit } from './suit';

// Drone Siege: hostile drones that hunt you and shoot back. This owns the drone pool,
// their plasma bolts, your suit integrity and the explosions, and reports what happened
// each frame (for sounds and the HUD). For now (before rounds) it keeps a few scouts
// alive at a time and replaces each one shortly after it's destroyed.

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
  | { kind: 'arrived'; position: THREE.Vector3 };

/** What a shot did to a drone. */
export interface DroneHit {
  core: boolean;
  destroyed: boolean;
  position: THREE.Vector3;
}

export class SiegeMode {
  readonly suit = new Suit();
  readonly fleet: DroneFleet;
  readonly bolts: Bolts;
  readonly effects: SiegeEffects;
  active = false;
  kills = 0;
  coreKills = 0;
  private drones: HostileDrone[] = [];
  private byCollider = new Map<number, HostileDrone>(); // collider handle -> drone
  private respawns: number[] = []; // seconds until each queued replacement scout arrives
  private events: SiegeEvent[] = [];
  private droneEvents: DroneEvent[] = [];
  private test = new RAPIER.Ball(0.8);

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
    this.bolts = new Bolts(scene, world, this.blocks);
    this.effects = new SiegeEffects(scene, world, this.blocks, impacts);
    this.setShown(false);
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects() {
    return [...this.fleet.glowObjects, this.bolts.mesh, ...this.effects.glowObjects];
  }

  get alive() {
    return this.drones.filter((d) => d.active).length;
  }

  start(player: SiegePlayer) {
    this.stop();
    this.active = true;
    this.setShown(true);
    this.kills = 0;
    this.coreKills = 0;
    this.suit.reset();
    for (let i = 0; i < CONFIG.siege.testDrones; i++) this.spawn(player);
  }

  /** Clear everything away (leaving the mode). */
  stop() {
    this.active = false;
    for (const drone of this.drones) {
      drone.despawn();
      this.fleet.hide(drone.index);
    }
    this.respawns = [];
    this.bolts.clear();
    this.effects.clear();
    this.setShown(false);
  }

  // The drone, bolt and debris batches are drawn even when every copy is hidden, so
  // outside Drone Siege they're switched off entirely.
  private setShown(shown: boolean) {
    this.fleet.group.visible = shown;
    this.bolts.mesh.visible = shown;
    this.effects.debris.visible = shown;
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
      this.respawns.push(CONFIG.siege.testRespawnDelay);
    }
    return { core, destroyed, position };
  }

  /** One frame of the fight. Returns what happened, for sounds and the HUD. */
  update(dt: number, player: SiegePlayer) {
    this.events.length = 0;
    this.effects.update(dt);
    if (!this.active) return this.events;

    const ctx: DroneContext = {
      world: this.world,
      blocks: this.blocks,
      feet: player.feet,
      head: player.head,
      velocity: player.velocity,
      collider: player.collider,
      insideDome: isInsideDome(player.feet),
      others: this.drones,
    };
    this.droneEvents.length = 0;
    for (const drone of this.drones) {
      if (!drone.active) continue;
      drone.update(dt, ctx, this.droneEvents);
      // Lost you behind walls for too long: it gives up there and comes in from
      // somewhere it can find you.
      if (drone.unseenTime > CONFIG.siege.lostSightTime) this.relocate(drone, player);
      this.fleet.set(drone.index, drone.position, drone.rotation, drone.glow, drone.spin);
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

    // Replacements for destroyed scouts.
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      this.respawns[i] -= dt;
      if (this.respawns[i] <= 0 && this.spawn(player)) this.respawns.splice(i, 1);
    }
    return this.events;
  }

  /** Bring in a scout somewhere around the player. Returns false if the pool is full or no spot was free. */
  spawn(player: SiegePlayer) {
    const drone = this.drones.find((d) => !d.active);
    if (!drone) return false;
    const spot = this.findSpawnSpot(player);
    if (!spot) return false;
    drone.spawn(spot, player.head, CONFIG.siege.scout.health);
    this.fleet.set(drone.index, drone.position, drone.rotation, 0, 0);
    this.effects.arrive(spot);
    this.events.push({ kind: 'arrived', position: spot.clone() });
    return true;
  }

  private relocate(drone: HostileDrone, player: SiegePlayer) {
    const spot = this.findSpawnSpot(player);
    if (!spot) return;
    this.effects.arrive(drone.position);
    drone.spawn(spot, player.head, drone.health);
    this.effects.arrive(spot);
  }

  // A random open spot at spawn distance and height around the player, on the same side
  // of the dome glass, and not inside a building.
  private findSpawnSpot(player: SiegePlayer) {
    const { spawnDistance, spawnHeight } = CONFIG.siege;
    const inside = isInsideDome(player.feet);
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      // Closer in after a few failed tries (a small room has less space).
      const shrink = 1 - attempt / 24;
      const distance = (spawnDistance[0] + Math.random() * (spawnDistance[1] - spawnDistance[0])) * shrink;
      const spot = new THREE.Vector3(
        player.feet.x + Math.sin(angle) * distance,
        player.feet.y + spawnHeight[0] + Math.random() * (spawnHeight[1] - spawnHeight[0]),
        player.feet.z + Math.cos(angle) * distance,
      );
      if (spot.y < terrainHeight(spot.x, spot.z) + 2) continue; // under a hill
      if (isInsideDome(spot) !== inside) continue;
      if (inside && !isInsideDome(spot.clone().multiplyScalar(1.08))) continue; // too close to the glass
      const blocked = this.world.intersectionWithShape(spot, { x: 0, y: 0, z: 0, w: 1 }, this.test, undefined, undefined, undefined, undefined, this.blocks);
      if (!blocked) return spot;
    }
    return null;
  }
}
