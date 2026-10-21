import * as THREE from 'three';
import { CONFIG } from '../config';
import type { DroneDesign } from './droneDesigns';
import { glowTexture } from './glowTexture';

// Draws every hostile drone of one type at once. Each part (the dark body, the red glow,
// the spinning rotors, and a shield or weak points if the type has them) is one
// InstancedMesh holding a copy per drone, so a whole fleet costs a handful of draws no
// matter how many are flying. A fleet with no drones out isn't drawn at all.

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const BODY = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.45, metalness: 0.6 });
// Unlit and brighter than white, so bloom makes it glow. Its color is set per drone.
const GLOW = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

/** How one drone looks this frame. */
export interface DroneLook {
  glow: number; // 0 normally, rising to 1 as it charges a shot
  spin: number; // rotor angle, radians
  shieldFlash?: number; // 0 to 1: a shot just hit the shield
  weakPoints?: boolean[]; // the carrier: which weak points are still intact
}

export class DroneFleet {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private rotors: THREE.InstancedMesh | null = null;
  private shield: THREE.InstancedMesh | null = null;
  private points: THREE.InstancedMesh | null = null; // the carrier's weak points
  private halos: THREE.Sprite[][] = []; // per drone: one round the core, or one per weak point
  private live = new Set<number>();
  private shown = false;
  private matrix = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private color = new THREE.Color();
  private red = new THREE.Color(...CONFIG.siege.glowColor);
  private haloPoints: THREE.Vector3[];

  constructor(
    scene: THREE.Scene,
    private design: DroneDesign,
    count: number,
  ) {
    this.body = this.batch(design.body, BODY, count, true);
    this.glow = this.batch(design.glow, GLOW, count, false);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    if (design.rotors.length > 0) {
      this.rotors = this.batch(new THREE.BoxGeometry(design.rotorLength, 0.012, design.rotorLength * 0.13), BODY, count * design.rotors.length, true);
    }
    if (design.shield) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.shield = this.batch(design.shield, material, count, false);
      this.shield.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    }
    if (design.weakPoints) {
      this.points = this.batch(new THREE.SphereGeometry(design.weakPointRadius!, 18, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }), count * design.weakPoints.length, false);
      this.points.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * design.weakPoints.length * 3), 3);
    }
    this.haloPoints = design.weakPoints ?? (design.core ? [design.core] : []);
    const texture = glowTexture();
    for (let i = 0; i < count; i++) {
      this.halos.push(
        this.haloPoints.map(() => {
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: this.red, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          halo.visible = false;
          this.group.add(halo);
          return halo;
        }),
      );
      this.hide(i);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  /** Only drawn during Drone Siege (and only while it has drones out). */
  setShown(shown: boolean) {
    this.shown = shown;
    this.group.visible = shown && this.live.size > 0;
  }

  /** At load: draw the whole fleet once (all copies hidden) so its shaders compile then. */
  showForWarmUp(shown: boolean) {
    this.group.visible = shown || (this.shown && this.live.size > 0);
  }

  set(i: number, position: THREE.Vector3, rotation: THREE.Quaternion, look: DroneLook) {
    if (!this.live.has(i)) {
      this.live.add(i);
      this.group.visible = this.shown;
    }
    this.matrix.compose(position, rotation, new THREE.Vector3(1, 1, 1));
    this.body.setMatrixAt(i, this.matrix);
    this.glow.setMatrixAt(i, this.matrix);
    const rotors = this.design.rotors;
    if (this.rotors) {
      rotors.forEach((tip, k) => {
        this.part.makeRotationY(look.spin + k * 1.3).setPosition(tip);
        this.rotors!.setMatrixAt(i * rotors.length + k, this.part.premultiply(this.matrix));
      });
    }
    const { glowIdle, glowCharged } = CONFIG.siege;
    const brightness = THREE.MathUtils.lerp(glowIdle, glowCharged, look.glow * look.glow);
    this.glow.setColorAt(i, this.color.copy(this.red).multiplyScalar(brightness));
    if (this.shield) {
      this.shield.setMatrixAt(i, this.matrix);
      this.shield.setColorAt(i, this.color.copy(this.red).multiplyScalar(0.9 + (look.shieldFlash ?? 0) * 5));
    }
    const weakPoints = this.design.weakPoints;
    if (this.points && weakPoints) {
      weakPoints.forEach((p, k) => {
        const intact = look.weakPoints?.[k] ?? true;
        this.part.makeTranslation(p.x, p.y, p.z).premultiply(this.matrix);
        this.points!.setMatrixAt(i * weakPoints.length + k, intact ? this.part : HIDDEN);
        this.points!.setColorAt(i * weakPoints.length + k, this.color.copy(this.red).multiplyScalar(brightness * 1.4));
      });
    }
    this.haloPoints.forEach((p, k) => {
      const halo = this.halos[i][k];
      halo.visible = look.weakPoints?.[k] ?? true;
      halo.position.copy(p).applyQuaternion(rotation).add(position);
      halo.scale.setScalar(this.design.haloSize * (1 + look.glow * 1.4));
      (halo.material as THREE.SpriteMaterial).opacity = 0.55 + look.glow * 0.45;
    });
    this.changed();
  }

  hide(i: number) {
    this.live.delete(i);
    if (this.live.size === 0) this.group.visible = false;
    for (const halo of this.halos[i] ?? []) halo.visible = false;
    this.body.setMatrixAt(i, HIDDEN);
    this.glow.setMatrixAt(i, HIDDEN);
    this.shield?.setMatrixAt(i, HIDDEN);
    const rotorCount = this.design.rotors.length;
    for (let k = 0; k < rotorCount; k++) this.rotors!.setMatrixAt(i * rotorCount + k, HIDDEN);
    const pointCount = this.design.weakPoints?.length ?? 0;
    for (let k = 0; k < pointCount; k++) this.points!.setMatrixAt(i * pointCount + k, HIDDEN);
    this.changed();
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects(): THREE.Object3D[] {
    return [this.glow, ...(this.shield ? [this.shield] : []), ...(this.points ? [this.points] : []), ...this.halos.flat()];
  }

  private changed() {
    for (const mesh of [this.body, this.glow, this.rotors, this.shield, this.points]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  private batch(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, shadows: boolean) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // drones fly everywhere; checking each batch's bounds isn't worth it
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.group.add(mesh);
    return mesh;
  }
}
