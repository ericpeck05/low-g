import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// Collision for Drone Siege's own fixtures (terminals, mod stations, the Supply Drop, the
// Overclock station). They only exist during a Siege game, so their colliders start off
// and are switched on and off with them.

export class SiegeColliders {
  private colliders: RAPIER.Collider[] = [];

  constructor(private world: RAPIER.World) {}

  /** A box, `size` across, centered at `center`, turned `yaw` about the vertical. */
  box(center: THREE.Vector3, size: THREE.Vector3, yaw = 0) {
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
        .setTranslation(center.x, center.y, center.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)),
    );
    collider.setEnabled(false);
    this.colliders.push(collider);
    return collider;
  }

  setEnabled(enabled: boolean) {
    for (const c of this.colliders) c.setEnabled(enabled);
  }
}
