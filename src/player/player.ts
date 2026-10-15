import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Input } from '../core/input';
import { Jetpack } from './jetpack';

// Rapier measures a capsule by the half-length of its straight middle part.
function capsuleHalfHeight(totalHeight: number) {
  return totalHeight / 2 - CONFIG.player.radius;
}

// The player's body: a capsule moved by Rapier's character controller.
// We track velocity ourselves (gravity, jumping, jetpack) and ask Rapier
// how far we can actually move each frame without going through anything.
export class Player {
  readonly jetpack = new Jetpack();
  readonly velocity = new THREE.Vector3();
  grounded = false;
  crouched = false;
  /** Downward speed at the moment we touched the ground this frame, else 0. */
  landingSpeed = 0;

  private center = new THREE.Vector3(); // capsule center
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private airTime = 0;

  constructor(private world: RAPIER.World) {
    const cfg = CONFIG.player;
    const start = cfg.startPosition;
    this.center.set(start.x, start.y + cfg.standHeight / 2, start.z);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        this.center.x,
        this.center.y,
        this.center.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(capsuleHalfHeight(cfg.standHeight), cfg.radius),
      this.body,
    );

    this.controller = world.createCharacterController(cfg.skinWidth);
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(cfg.maxSlopeDegrees));
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(cfg.maxSlopeDegrees));
    this.controller.enableAutostep(cfg.stepHeight, cfg.radius, false);
    this.controller.enableSnapToGround(cfg.snapToGround);
  }

  get height() {
    return this.crouched ? CONFIG.player.crouchHeight : CONFIG.player.standHeight;
  }

  /** Bottom of the capsule, i.e. where the feet are. */
  get feet() {
    return new THREE.Vector3(this.center.x, this.center.y - this.height / 2, this.center.z);
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt: number, input: Input, yaw: number) {
    const cfg = CONFIG.player;
    const wasGrounded = this.grounded;

    this.updateCrouch(input.isDown('KeyC'));

    // Which way the keys are pushing, turned to match where the camera faces.
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const wish = new THREE.Vector3();
    if (input.isDown('KeyW')) wish.add(forward);
    if (input.isDown('KeyS')) wish.sub(forward);
    if (input.isDown('KeyD')) wish.add(right);
    if (input.isDown('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    const sprinting = input.isDown('ShiftLeft', 'ShiftRight') && !this.crouched;
    const speed = this.crouched ? cfg.crouchWalkSpeed : sprinting ? cfg.sprintSpeed : cfg.walkSpeed;

    // Ease horizontal velocity toward the target. In the air you only steer
    // a little, and with no keys held you keep your momentum.
    if (this.grounded || wish.lengthSq() > 0) {
      const accel = cfg.groundAccel * (this.grounded ? 1 : cfg.airControl);
      const target = wish.clone().multiplyScalar(speed);
      const change = new THREE.Vector3(target.x - this.velocity.x, 0, target.z - this.velocity.z);
      const maxChange = accel * dt;
      if (change.length() > maxChange) change.setLength(maxChange);
      this.velocity.x += change.x;
      this.velocity.z += change.z;
    }

    // Jump
    if (this.grounded && input.wasPressed('Space')) {
      this.velocity.y = cfg.jumpSpeed;
      this.grounded = false;
    }

    // Moon gravity
    this.velocity.y = Math.max(this.velocity.y - CONFIG.gravity * dt, -cfg.maxFallSpeed);

    // Jetpack: hold Space in the air (after a short delay so a held jump doesn't trigger it)
    this.airTime = this.grounded ? 0 : this.airTime + dt;
    const wantsThrust = input.isDown('Space') && this.airTime > CONFIG.jetpack.holdDelay;
    this.jetpack.update(dt, this.grounded, wantsThrust);
    if (this.jetpack.thrusting) {
      const jp = CONFIG.jetpack;
      if (this.velocity.y < jp.maxUpSpeed) this.velocity.y += jp.upThrust * dt;
      // Extra push in the direction you're steering. With no keys held it goes straight up.
      this.velocity.x += wish.x * jp.forwardThrust * dt;
      this.velocity.z += wish.z * jp.forwardThrust * dt;
    }

    this.move(dt);

    this.landingSpeed = !wasGrounded && this.grounded ? Math.max(0, -this.velocity.y) : 0;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
  }

  // Ask Rapier how far we can really go, then apply it.
  private move(dt: number) {
    const desired = this.velocity.clone().multiplyScalar(dt);
    this.controller.computeColliderMovement(this.collider, desired);
    const allowed = this.controller.computedMovement();

    this.center.x += allowed.x;
    this.center.y += allowed.y;
    this.center.z += allowed.z;
    this.body.setNextKinematicTranslation(this.center);
    this.grounded = this.controller.computedGrounded();

    // Bumped our head: stop rising.
    if (desired.y > 0 && allowed.y < desired.y * 0.5) this.velocity.y = 0;

    // Hit a wall in the air: lose the speed that went into it, keep the part that
    // slides along it. Skipped on the ground, where walking re-sets your speed every
    // frame anyway and stepping up a ledge would otherwise look like hitting a wall.
    const desiredFlat = Math.hypot(desired.x, desired.z);
    const allowedFlat = Math.hypot(allowed.x, allowed.z);
    if (!this.grounded && desiredFlat > 1e-5 && allowedFlat < desiredFlat * 0.99) {
      this.velocity.x = allowed.x / dt;
      this.velocity.z = allowed.z / dt;
    }
  }

  // Crouching shrinks the capsule and keeps the feet where they are.
  private updateCrouch(wantsCrouch: boolean) {
    if (wantsCrouch === this.crouched) return;
    const cfg = CONFIG.player;
    const shift = (cfg.standHeight - cfg.crouchHeight) / 2;

    if (wantsCrouch) {
      this.crouched = true;
      this.center.y -= shift;
    } else {
      // Only stand up if there's room above our head.
      const standingCenter = { x: this.center.x, y: this.center.y + shift, z: this.center.z };
      const standingShape = new RAPIER.Capsule(capsuleHalfHeight(cfg.standHeight), cfg.radius);
      const blocked = this.world.intersectionWithShape(
        standingCenter,
        { x: 0, y: 0, z: 0, w: 1 },
        standingShape,
        undefined,
        undefined,
        this.collider,
      );
      if (blocked) return;
      this.crouched = false;
      this.center.y += shift;
    }

    this.collider.setHalfHeight(capsuleHalfHeight(this.height));
    this.body.setTranslation(this.center, true);
  }
}
