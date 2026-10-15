import * as THREE from 'three';
import { CONFIG } from '../config';
import { terrainHeight } from '../world/terrain';
import { discMaterials } from './discs';

interface Piece {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3; // radians per second around each axis
  age: number;
  settled: boolean;
}

const SHARD_COUNT = 10;
const REST_HEIGHT = 0.03; // pieces come to rest just above the ground

// Broken target pieces. They fly apart slowly and tumble, follow moon gravity
// with no air drag, settle on the ground, then shrink away.
export class Debris {
  private pieces: Piece[] = [];
  private shardGeometries: THREE.BufferGeometry[] = [];
  private shardCenters: THREE.Vector3[] = [];

  constructor(private scene: THREE.Scene) {
    // Pre-cut a disc into pie slices. Each slice is moved so its own center sits
    // at the origin, so it tumbles around itself instead of the disc's middle.
    const { discRadius, discThickness } = CONFIG.targets;
    const slice = (Math.PI * 2) / SHARD_COUNT;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const geometry = new THREE.CylinderGeometry(discRadius, discRadius, discThickness, 4, 1, false, i * slice, slice);
      const mid = i * slice + slice / 2;
      const center = new THREE.Vector3(Math.sin(mid), 0, Math.cos(mid)).multiplyScalar(discRadius * 0.6);
      geometry.translate(-center.x, -center.y, -center.z);
      this.shardGeometries.push(geometry);
      this.shardCenters.push(center);
    }
  }

  /**
   * Smash a bullseye disc into pie slices flying outward from its center.
   * They pop off the painted face (toward the shooter) rather than along the bullet,
   * so targets mounted on a wall don't throw their pieces through it.
   */
  shatterDisc(disc: THREE.Object3D) {
    disc.updateMatrixWorld();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    disc.matrixWorld.decompose(position, rotation, new THREE.Vector3());
    const faceDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);

    for (let i = 0; i < SHARD_COUNT; i++) {
      const mesh = new THREE.Mesh(this.shardGeometries[i], discMaterials());
      const outward = this.shardCenters[i].clone().applyQuaternion(rotation);
      mesh.position.copy(position).add(outward);
      mesh.quaternion.copy(rotation);
      this.launch(mesh, outward.normalize(), faceDirection);
    }
  }

  /** Break something into a handful of small blocks (used for drones). */
  shatterBlocks(center: THREE.Vector3, shotDirection: THREE.Vector3, materials: THREE.Material[], count: number) {
    for (let i = 0; i < count; i++) {
      const size = 0.08 + Math.random() * 0.14;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * (0.4 + Math.random()), size),
        materials[i % materials.length],
      );
      const outward = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      mesh.position.copy(center).addScaledVector(outward, 0.15);
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.launch(mesh, outward, shotDirection);
    }
  }

  update(dt: number) {
    const cfg = CONFIG.debris;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;

      if (!p.settled) {
        p.velocity.y -= CONFIG.gravity * dt;
        p.mesh.position.addScaledVector(p.velocity, dt);
        p.mesh.rotation.x += p.spin.x * dt;
        p.mesh.rotation.y += p.spin.y * dt;
        p.mesh.rotation.z += p.spin.z * dt;
        const floor = terrainHeight(p.mesh.position.x, p.mesh.position.z) + REST_HEIGHT;
        if (p.mesh.position.y < floor) {
          p.mesh.position.y = floor;
          p.settled = true;
        }
      }

      // Shrink away over the last part of its life, then remove it.
      const remaining = cfg.life - p.age;
      if (remaining < 0.8) p.mesh.scale.setScalar(Math.max(0.001, remaining / 0.8));
      if (remaining <= 0) {
        this.scene.remove(p.mesh);
        this.pieces.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.pieces) this.scene.remove(p.mesh);
    this.pieces = [];
  }

  // push: the direction the hit knocks the pieces (on top of flying outward).
  private launch(mesh: THREE.Mesh, outward: THREE.Vector3, push: THREE.Vector3) {
    const cfg = CONFIG.debris;
    mesh.castShadow = true;
    this.scene.add(mesh);
    const velocity = outward
      .multiplyScalar(cfg.burstSpeed * (0.5 + Math.random()))
      .addScaledVector(push, cfg.shotPush * (0.5 + Math.random()));
    velocity.y += 0.5 * Math.random(); // a little lift so pieces drift up before falling
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(
      cfg.spin * 2,
    );
    this.pieces.push({ mesh, velocity, spin, age: 0, settled: false });
  }
}
