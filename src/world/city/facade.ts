import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { lightStrip, solidBox } from './kit';
import type { RoomStyle, WindowBatch } from './windows';

// Helpers for building walls: a Face is one flat side of a building, and lets you place
// boxes, light strips and windows on it in its own terms (along it, up it, out from it).

export const RECESS = 0.28; // how far window glass sits behind the face of the wall

/** One flat face of a building, with helpers to place things on it in its own terms. */
export class Face {
  readonly right: THREE.Vector3; // along the face, left to right seen from outside
  readonly yaw: number;

  constructor(
    private scene: THREE.Object3D,
    private world: RAPIER.World,
    private origin: THREE.Vector3,
    readonly normal: THREE.Vector3,
    private distance: number, // from the tower's center to the face
  ) {
    this.right = new THREE.Vector3(normal.z, 0, -normal.x);
    this.yaw = Math.atan2(normal.x, normal.z);
  }

  /** s: meters along the face from its middle; y: up; e: out from the face (negative goes into the wall). */
  at(s: number, y: number, e: number) {
    return this.origin.clone().addScaledVector(this.normal, this.distance + e).addScaledVector(this.right, s).setY(y);
  }

  box(material: THREE.Material, s0: number, s1: number, y0: number, y1: number, e0: number, e1: number, collide = false) {
    const center = this.at((s0 + s1) / 2, (y0 + y1) / 2, (e0 + e1) / 2);
    return solidBox(this.scene, this.world, center, { x: s1 - s0, y: y1 - y0, z: e1 - e0 }, material, this.yaw, collide);
  }

  glow(material: THREE.MeshStandardMaterial, s0: number, s1: number, y0: number, y1: number, e0: number, e1: number) {
    const center = this.at((s0 + s1) / 2, (y0 + y1) / 2, (e0 + e1) / 2);
    return lightStrip(this.scene, center, { x: s1 - s0, y: y1 - y0, z: e1 - e0 }, material, this.yaw);
  }

  window(batch: WindowBatch, s0: number, s1: number, y0: number, y1: number, seed: number, style: RoomStyle) {
    batch.add({
      center: this.at((s0 + s1) / 2, (y0 + y1) / 2, -RECESS),
      right: this.right,
      normal: this.normal,
      width: s1 - s0,
      height: y1 - y0,
      seed,
      style,
    });
  }
}

