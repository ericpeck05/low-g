import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Debris } from './debris';
import { discGeometry, discMaterials, scoreRing } from './discs';
import type { HitResult, Target } from './target';

type State = 'down' | 'rising' | 'up' | 'falling';

// A bullseye on a hinge. It lies flat until the pop-up field raises it, stands
// for a few seconds, then drops. Worth more points because it's only up briefly.
export class PopupTarget implements Target {
  readonly collider: RAPIER.Collider;
  readonly position: THREE.Vector3; // where its base sits
  state: State = 'down';

  private hinge = new THREE.Group(); // tips the disc up and down
  private disc: THREE.Mesh;
  private progress = 0; // 0 = lying flat, 1 = standing up
  private upTimer = 0;

  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    private debris: Debris,
    base: THREE.Vector3,
    facing: THREE.Vector3,
  ) {
    const { discRadius, discThickness } = CONFIG.targets;
    this.position = base.clone();

    // The base plate the target folds down onto.
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(discRadius * 2.2, 0.06, discRadius * 2.4),
      new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.9 }),
    );
    plate.receiveShadow = true;

    // pivot: sits at the base, turned to face `facing`.
    const pivot = new THREE.Group();
    pivot.position.copy(base);
    pivot.rotation.y = Math.atan2(facing.x, facing.z);
    plate.position.set(0, 0.03, -discRadius * 1.1);
    pivot.add(plate, this.hinge);
    this.hinge.position.y = 0.06;

    // In the hinge, the disc stands with its face toward +z (the pivot's front).
    this.disc = new THREE.Mesh(discGeometry(), discMaterials());
    this.disc.rotation.x = Math.PI / 2;
    this.disc.position.y = discRadius + 0.05;
    this.disc.castShadow = true;
    this.hinge.add(this.disc);
    scene.add(pivot);

    this.collider = world.createCollider(RAPIER.ColliderDesc.cylinder(discThickness / 2, discRadius));
    this.collider.setEnabled(false);
    this.applyPose();
  }

  raise() {
    if (this.state !== 'down') return;
    this.state = 'rising';
    this.disc.visible = true;
  }

  update(dt: number) {
    const t = CONFIG.targets;
    const step = dt / t.popupFlipTime;
    if (this.state === 'rising') {
      this.progress = Math.min(1, this.progress + step);
      if (this.progress === 1) {
        this.state = 'up';
        this.upTimer = t.popupUpTime;
      }
    } else if (this.state === 'up') {
      this.upTimer -= dt;
      if (this.upTimer <= 0) this.state = 'falling';
    } else if (this.state === 'falling') {
      this.progress = Math.max(0, this.progress - step);
      if (this.progress === 0) this.state = 'down';
    }
    this.applyPose();
  }

  hit(point: THREE.Vector3): HitResult {
    const ring = scoreRing(this.disc.worldToLocal(point.clone()));
    this.debris.shatterDisc(this.disc);
    // Reappear lying flat, ready to pop up again later.
    this.state = 'down';
    this.progress = 0;
    this.applyPose();
    return { ...ring, points: ring.points * CONFIG.targets.popupMultiplier, label: `POP-UP ${ring.label}` };
  }

  reset() {
    this.state = 'down';
    this.progress = 0;
    this.applyPose();
  }

  /** Lie flat and stay there (it's only raised by the target manager). */
  standDown() {
    this.reset();
  }

  // Tip the hinge to match progress and move the collider with the disc.
  private applyPose() {
    // Ease in and out so the flip has some snap.
    const eased = this.progress * this.progress * (3 - 2 * this.progress);
    this.hinge.rotation.x = -(Math.PI / 2) * (1 - eased);

    this.disc.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    this.disc.matrixWorld.decompose(position, rotation, new THREE.Vector3());
    this.collider.setTranslation(position);
    this.collider.setRotation(rotation);
    // Only shootable when it's mostly upright.
    this.collider.setEnabled(this.progress > 0.7);
  }
}
