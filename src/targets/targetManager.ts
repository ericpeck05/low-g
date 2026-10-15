import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { BullseyeTarget } from './bullseyeTarget';
import { Debris } from './debris';
import { DroneTarget } from './droneTarget';
import { PopupTarget } from './popupTarget';
import type { HitResult, Target } from './target';

// Owns every target in the level: updates them, raises pop-ups at random,
// and finds which target (if any) a shot hit.
export class TargetManager {
  readonly debris: Debris;
  private targets: Target[] = [];
  private popups: PopupTarget[] = [];
  private byCollider = new Map<number, Target>(); // collider handle -> target
  private nextPopup = 1;

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
  ) {
    this.debris = new Debris(scene);
  }

  addBullseye(center: THREE.Vector3, facing: THREE.Vector3, standBase: number | null = null) {
    this.add(new BullseyeTarget(this.scene, this.world, this.debris, center, facing, standBase));
  }

  addPopup(base: THREE.Vector3, facing: THREE.Vector3) {
    const popup = new PopupTarget(this.scene, this.world, this.debris, base, facing);
    this.popups.push(popup);
    this.add(popup);
  }

  addDrone(anchor: THREE.Vector3, reach: THREE.Vector3, speed: number) {
    this.add(new DroneTarget(this.scene, this.world, this.debris, anchor, reach, speed));
  }

  update(dt: number, player: THREE.Vector3) {
    // Every so often, raise a random pop-up that's lying down near the player.
    // (There's no point raising one on the far side of the map.)
    this.nextPopup -= dt;
    if (this.nextPopup <= 0) {
      const [min, max] = CONFIG.targets.popupInterval;
      this.nextPopup = min + Math.random() * (max - min);
      const waiting = this.popups.filter(
        (p) => p.state === 'down' && p.position.distanceTo(player) < CONFIG.targets.popupRange,
      );
      if (waiting.length > 0) waiting[Math.floor(Math.random() * waiting.length)].raise();
    }

    for (const target of this.targets) target.update(dt);
    this.debris.update(dt);
  }

  /** If the collider belongs to a target, break it and return the score. Otherwise null. */
  tryHit(collider: RAPIER.Collider, point: THREE.Vector3, shotDirection: THREE.Vector3): HitResult | null {
    const target = this.byCollider.get(collider.handle);
    return target ? target.hit(point, shotDirection) : null;
  }

  reset() {
    for (const target of this.targets) target.reset();
    this.debris.clear();
    this.nextPopup = 1;
  }

  private add(target: Target) {
    this.targets.push(target);
    this.byCollider.set(target.collider.handle, target);
  }
}
