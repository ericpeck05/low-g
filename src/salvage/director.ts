import * as THREE from 'three';
import { CONFIG } from '../config';
import type { DroneType } from '../siege/rounds';
import type { SiegeMode } from '../siege/siege';
import { terrainHeight } from '../world/terrain';
import { KEEP_OUT } from './sites';

// Salvage Run's threat: how much attention you've drawn, and the drones it brings.
// Heat (0 to 100) builds the longer you're outside, with each cache you open and with
// gunfire, and cools off while you're in the dome. Heat sets the threat level (1 to 5):
// how many drones can be out at once, how often another drops in, and which kinds come.
// As the storm closes in, the threat never falls below a floor. Drones only come while
// you're outside, dropping out of the sky somewhere near you after a red warning flare.

export class SalvageDirector {
  heat = 0;
  private dropTimer = 0; // seconds to the next drop
  private turn = 0; // which of the level's drone types comes next
  private guards: { type: DroneType; at: THREE.Vector3 }[] = []; // called by an alarm, still to drop

  constructor(private siege: SiegeMode) {}

  reset() {
    this.heat = 0;
    this.dropTimer = CONFIG.salvage.firstDrop;
    this.turn = Math.floor(Math.random() * 5);
    this.guards = [];
  }

  /** The threat level, 1 to 5, with `timeLeft` seconds to the storm. */
  level(timeLeft: number) {
    const s = CONFIG.salvage;
    let level = 1 + s.threatSteps.filter((h) => this.heat >= h).length;
    for (const floor of s.stormFloor) if (timeLeft <= floor.timeLeft) level = Math.max(level, floor.level);
    return level;
  }

  addHeat(amount: number) {
    this.heat = THREE.MathUtils.clamp(this.heat + amount, 0, 100);
  }

  /** A cache's alarm: `count` drones drop in around `at`, picked from a level above the current one. */
  callGuards(count: number, at: THREE.Vector3, level: number) {
    const types = CONFIG.salvage.threat[Math.min(level, 4)].types as DroneType[];
    for (let k = 0; k < count; k++) this.guards.push({ type: types[(this.turn + k) % types.length], at: at.clone() });
  }

  /** One frame. `outside`: on the surface (drones only come for you there). */
  update(dt: number, feet: THREE.Vector3, outside: boolean, timeLeft: number) {
    const s = CONFIG.salvage;
    if (!outside) {
      this.heat = Math.max(0, this.heat - s.heatCooling * dt);
      this.guards = []; // an alarm you ran from goes quiet
      this.dropTimer = s.firstDrop; // a moment's grace each time you step back out
      return;
    }
    this.heat = Math.min(100, this.heat + s.heatOutside * dt);
    const level = this.level(timeLeft);
    const threat = s.threat[level - 1];
    const round = s.droneRound + level - 1;

    // An alarm's drones come first, on top of the usual limit.
    if (this.guards.length > 0) {
      const guard = this.guards[0];
      const spot = this.dropSpot(guard.at, s.guardDistance);
      if (spot && this.siege.dropDrone(spot, guard.type, round + 1)) this.guards.shift();
    }

    this.dropTimer -= dt;
    if (this.dropTimer > 0) return;
    if (this.siege.incoming >= threat.alive) {
      this.dropTimer = threat.interval * 0.4; // full up: look again a little later
      return;
    }
    const types = threat.types as DroneType[];
    const spot = this.dropSpot(feet, s.dropDistance);
    if (spot && this.siege.dropDrone(spot, types[this.turn % types.length], round)) {
      this.turn++;
      this.dropTimer = threat.interval * (0.85 + Math.random() * 0.3);
    } else {
      this.dropTimer = 0.5; // nowhere free to drop right now: try again shortly
    }
  }

  // Somewhere a drone can come down: `distance` meters from `around`, out on the open
  // surface (not over the dome, not into the base's buildings), high above the ground.
  private dropSpot(around: THREE.Vector3, [min, max]: number[]) {
    const s = CONFIG.salvage;
    for (let tries = 0; tries < 16; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      const x = around.x + Math.sin(a) * d;
      const z = around.z + Math.cos(a) * d;
      if (Math.hypot(x, z) < CONFIG.city.domeRadius + 14) continue;
      if (KEEP_OUT.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
      return new THREE.Vector3(x, terrainHeight(x, z) + s.dropHeight, z);
    }
    return null;
  }
}
