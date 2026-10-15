import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

// What a target reports when it gets hit.
export interface HitResult {
  points: number; // before the combo multiplier
  label: string; // shown on screen, e.g. "BULLSEYE"
  bullseye: boolean; // best possible hit (used for oxygen bonuses later)
}

// Every kind of target (bullseye, pop-up, drone) follows these rules.
export interface Target {
  readonly collider: RAPIER.Collider;
  /** Moves or animates the target. Called before the physics step. */
  update(dt: number): void;
  /** Breaks the target and returns the score. Only called while it's hittable. */
  hit(point: THREE.Vector3, shotDirection: THREE.Vector3): HitResult;
  /** Puts the target back to its starting state for a new run. */
  reset(): void;
}
