import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Debris } from './debris';
import type { HitResult, Target } from './target';

const HULL = new THREE.MeshStandardMaterial({ color: 0x8a847a, roughness: 0.6, metalness: 0.2 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.7 });
// The glowing eye. It has no real light: every light in the scene costs shading time on
// every pixel on screen, and a lamp this small isn't worth it. Bloom makes it glow.
const LAMP = new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8a00, emissiveIntensity: 1.5 });

// A small hovering drone that drifts along a slow looping path.
export class DroneTarget implements Target {
  readonly collider: RAPIER.Collider;
  private body = new THREE.Group();
  private rotors: THREE.Mesh[] = [];
  private time: number;
  private brokenTimer = 0;
  private respawnScale = 1;

  /**
   * anchor: the middle of the drone's path. reach: how far it wanders on each axis.
   * speed: how fast it moves along the path (1 is a gentle drift).
   */
  constructor(
    scene: THREE.Scene,
    world: RAPIER.World,
    private debris: Debris,
    private anchor: THREE.Vector3,
    private reach: THREE.Vector3,
    private speed: number,
  ) {
    this.time = Math.random() * 100; // start each drone at a different point on its loop
    buildDrone(this.body, this.rotors);
    scene.add(this.body);
    this.collider = world.createCollider(RAPIER.ColliderDesc.ball(CONFIG.targets.droneRadius));
    this.update(0);
  }

  update(dt: number) {
    this.time += dt * this.speed;
    const t = this.time;
    // A looping path made from sine waves at different rates, so it never quite repeats.
    const position = new THREE.Vector3(
      this.anchor.x + Math.sin(t * 0.31) * this.reach.x,
      this.anchor.y + Math.sin(t * 0.53) * this.reach.y,
      this.anchor.z + Math.sin(t * 0.23 + 1.3) * this.reach.z,
    );
    this.body.position.copy(position);
    this.body.rotation.z = Math.sin(t * 0.7) * 0.12; // a gentle wobble
    for (const rotor of this.rotors) rotor.rotation.y += dt * 30;
    this.collider.setTranslation(position);

    if (this.brokenTimer > 0) {
      this.brokenTimer -= dt;
      if (this.brokenTimer <= 0) this.show();
    }
    if (this.respawnScale < 1) {
      this.respawnScale = Math.min(1, this.respawnScale + dt * 4);
      this.body.scale.setScalar(this.respawnScale);
    }
  }

  hit(_point: THREE.Vector3, shotDirection: THREE.Vector3): HitResult {
    this.debris.shatterBlocks(this.body.position, shotDirection, [HULL, HULL, DARK, LAMP], 12);
    this.body.visible = false;
    this.collider.setEnabled(false);
    this.brokenTimer = CONFIG.targets.droneRespawnTime;
    return { points: CONFIG.targets.dronePoints, label: 'DRONE', bullseye: false };
  }

  standDown() {
    this.body.visible = false;
    this.collider.setEnabled(false);
    this.brokenTimer = 0; // so it doesn't come back by itself
  }

  reset() {
    this.brokenTimer = 0;
    this.show();
    this.respawnScale = 1;
    this.body.scale.setScalar(1);
  }

  private show() {
    this.body.visible = true;
    this.collider.setEnabled(true);
    this.respawnScale = 0;
  }
}

function buildDrone(body: THREE.Group, rotors: THREE.Mesh[]) {
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 12), HULL);
  core.scale.y = 0.6;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), LAMP);
  eye.position.set(0, -0.08, 0.22);
  body.add(core, eye);

  // Four arms with spinning rotor blades.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.05), DARK);
    arm.position.set(Math.cos(angle) * 0.3, 0.02, Math.sin(angle) * 0.3);
    arm.rotation.y = -angle;
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.01, 0.03), DARK);
    rotor.position.set(Math.cos(angle) * 0.48, 0.06, Math.sin(angle) * 0.48);
    body.add(arm, rotor);
    rotors.push(rotor);
  }
  body.traverse((child) => (child.castShadow = true));
}
