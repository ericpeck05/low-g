import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Debris } from './debris';
import { discGeometry, discMaterials, scoreRing } from './discs';
import type { HitResult, Target } from './target';

const UP = new THREE.Vector3(0, 1, 0);

// A round target that stays in one place. Breaks when shot, comes back a moment later.
export class BullseyeTarget implements Target {
  readonly collider: RAPIER.Collider;
  private disc: THREE.Mesh;
  private brokenTimer = 0;
  private respawnScale = 1; // grows from 0 to 1 when the target comes back

  /**
   * center: middle of the disc. facing: the direction its painted face points.
   * stand: if true, adds a post from the ground (or a ledge) up to the disc.
   */
  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    private debris: Debris,
    center: THREE.Vector3,
    facing: THREE.Vector3,
    standBase: number | null = null,
  ) {
    const { discRadius, discThickness } = CONFIG.targets;
    this.disc = new THREE.Mesh(discGeometry(), discMaterials());
    this.disc.position.copy(center);
    this.disc.quaternion.setFromUnitVectors(UP, facing.clone().normalize());
    this.disc.castShadow = true;
    scene.add(this.disc);

    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(discThickness / 2, discRadius)
        .setTranslation(center.x, center.y, center.z)
        .setRotation(this.disc.quaternion),
    );

    if (standBase !== null) addStand(scene, world, center, discRadius, standBase);
  }

  update(dt: number) {
    if (this.brokenTimer > 0) {
      this.brokenTimer -= dt;
      if (this.brokenTimer <= 0) this.show();
    }
    // Pop back in with a quick grow instead of appearing instantly.
    if (this.respawnScale < 1) {
      this.respawnScale = Math.min(1, this.respawnScale + dt * 5);
      this.disc.scale.setScalar(this.respawnScale);
    }
  }

  hit(point: THREE.Vector3): HitResult {
    const result = scoreRing(this.disc.worldToLocal(point.clone()));
    this.debris.shatterDisc(this.disc);
    this.disc.visible = false;
    this.collider.setEnabled(false);
    this.brokenTimer = CONFIG.targets.respawnTime;
    return result;
  }

  reset() {
    this.brokenTimer = 0;
    this.show();
    this.respawnScale = 1;
    this.disc.scale.setScalar(1);
  }

  private show() {
    this.disc.visible = true;
    this.collider.setEnabled(true);
    this.respawnScale = 0;
  }
}

// A thin post holding the disc up. It's solid, so it blocks shots and the player.
function addStand(scene: THREE.Scene, world: RAPIER.World, center: THREE.Vector3, radius: number, base: number) {
  const top = center.y - radius;
  const height = top - base;
  if (height <= 0) return;
  const post = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, height, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x4a4743, roughness: 0.8 }),
  );
  post.position.set(center.x, base + height / 2, center.z);
  post.castShadow = true;
  scene.add(post);
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.04, height / 2, 0.04).setTranslation(post.position.x, post.position.y, post.position.z),
  );
}
