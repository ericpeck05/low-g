import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';

// Draws every hostile drone at once. Each part of the drone (the dark body, the red
// glow, the spinning rotors) is one InstancedMesh holding a copy per drone, so the whole
// fleet costs three draws no matter how many are flying. Drones face down their -z axis.

/** Where the glowing core sits on the drone, in its own space. It's the weak point. */
export const CORE_OFFSET = new THREE.Vector3(0, -0.03, -0.36);
export const CORE_RADIUS = 0.14; // the hit area, a little bigger than the glowing ball you see
export const BODY_RADIUS = 0.4;
const CORE_VISIBLE_RADIUS = 0.115;

const ROTORS = 4;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const ROTOR_TIPS = Array.from({ length: ROTORS }, (_, i) => {
  const angle = (i / ROTORS) * Math.PI * 2 + Math.PI / 4;
  return new THREE.Vector3(Math.cos(angle) * 0.52, 0.08, Math.sin(angle) * 0.52);
});

const BODY = new THREE.MeshStandardMaterial({ color: 0x2b2927, roughness: 0.45, metalness: 0.6 });
// Unlit and brighter than white, so bloom makes it glow. Its color is set per drone.
const GLOW = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

export class DroneFleet {
  readonly group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private glow: THREE.InstancedMesh;
  private rotors: THREE.InstancedMesh;
  // A soft red glow around each core, so drones read as hostile even far away.
  private halos: THREE.Sprite[] = [];
  private matrix = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private color = new THREE.Color();
  private red = new THREE.Color(...CONFIG.siege.glowColor);

  constructor(scene: THREE.Scene, count: number) {
    this.body = this.batch(bodyGeometry(), BODY, count, true);
    this.glow = this.batch(glowGeometry(), GLOW, count, false);
    this.rotors = this.batch(new THREE.BoxGeometry(0.34, 0.012, 0.045), BODY, count * ROTORS, true);
    this.glow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const haloTexture = softDot();
    for (let i = 0; i < count; i++) {
      const material = new THREE.SpriteMaterial({ map: haloTexture, color: this.red, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const halo = new THREE.Sprite(material);
      this.halos.push(halo);
      this.group.add(halo);
      this.hide(i);
    }
    scene.add(this.group);
  }

  /**
   * Place drone `i`. glow: 0 normally, rising to 1 just before it fires.
   * spin: the rotor angle in radians.
   */
  set(i: number, position: THREE.Vector3, rotation: THREE.Quaternion, glow: number, spin: number, scale = 1) {
    this.matrix.compose(position, rotation, new THREE.Vector3(scale, scale, scale));
    this.body.setMatrixAt(i, this.matrix);
    this.glow.setMatrixAt(i, this.matrix);
    for (let k = 0; k < ROTORS; k++) {
      const tip = ROTOR_TIPS[k];
      this.part.makeRotationY(spin + k * 1.3).setPosition(tip);
      this.rotors.setMatrixAt(i * ROTORS + k, this.part.premultiply(this.matrix));
    }
    const { glowIdle, glowCharged, haloSize } = CONFIG.siege;
    const brightness = THREE.MathUtils.lerp(glowIdle, glowCharged, glow * glow);
    this.glow.setColorAt(i, this.color.copy(this.red).multiplyScalar(brightness));
    const halo = this.halos[i];
    halo.visible = true;
    halo.position.copy(CORE_OFFSET).multiplyScalar(scale).applyQuaternion(rotation).add(position);
    halo.scale.setScalar(haloSize * scale * (1 + glow * 1.4));
    (halo.material as THREE.SpriteMaterial).opacity = 0.55 + glow * 0.45;
    this.changed();
  }

  hide(i: number) {
    this.halos[i].visible = false;
    this.body.setMatrixAt(i, HIDDEN);
    this.glow.setMatrixAt(i, HIDDEN);
    for (let k = 0; k < ROTORS; k++) this.rotors.setMatrixAt(i * ROTORS + k, HIDDEN);
    this.changed();
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects(): THREE.Object3D[] {
    return [this.glow, ...this.halos];
  }

  private changed() {
    this.body.instanceMatrix.needsUpdate = true;
    this.glow.instanceMatrix.needsUpdate = true;
    this.rotors.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
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

// The dark parts: a flattened round hull, four arms out to the rotors, and a socket
// around the core.
function bodyGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const hull = new THREE.SphereGeometry(BODY_RADIUS + 0.02, 22, 14);
  hull.scale(1, 0.6, 1);
  parts.push(hull);
  for (const tip of ROTOR_TIPS) {
    const arm = new THREE.BoxGeometry(0.5, 0.04, 0.06);
    arm.rotateY(-Math.atan2(tip.z, tip.x));
    arm.translate(tip.x * 0.55, 0.03, tip.z * 0.55);
    const hub = new THREE.CylinderGeometry(0.035, 0.045, 0.07, 10);
    hub.translate(tip.x, 0.045, tip.z);
    parts.push(arm, hub);
  }
  const socket = new THREE.TorusGeometry(CORE_VISIBLE_RADIUS + 0.025, 0.035, 8, 24);
  socket.translate(CORE_OFFSET.x, CORE_OFFSET.y, CORE_OFFSET.z + 0.04);
  parts.push(socket);
  return mergeGeometries(parts.map(withoutUv))!;
}

// The red glowing parts: the core (full brightness) and a thin band around the hull
// (dimmer, through its vertex colors), so a drone reads as hostile from any side.
function glowGeometry() {
  const core = new THREE.SphereGeometry(CORE_VISIBLE_RADIUS, 18, 12);
  core.translate(CORE_OFFSET.x, CORE_OFFSET.y, CORE_OFFSET.z);
  const band = new THREE.TorusGeometry(BODY_RADIUS + 0.035, 0.018, 6, 40);
  band.rotateX(Math.PI / 2);
  const tint = (geometry: THREE.BufferGeometry, shade: number) => {
    const colors = new Float32Array(geometry.attributes.position.count * 3).fill(shade);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return withoutUv(geometry);
  };
  return mergeGeometries([tint(core, 1), tint(band, 0.35)])!;
}

// A round soft glow, bright at the center and fading out.
function softDot() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function withoutUv(geometry: THREE.BufferGeometry) {
  geometry.deleteAttribute('uv');
  return geometry.index ? geometry.toNonIndexed() : geometry;
}
