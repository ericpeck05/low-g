import * as THREE from 'three';
import { CONFIG } from '../config';
import type { ImpactEffects } from '../weapons/impactEffects';
import { isInsideDome } from '../world/city/dome';
import { terrainHeight, terrainNormal } from '../world/terrain';
import type { Player } from './player';

const UP = new THREE.Vector3(0, 1, 0);

// Boot prints pressed into the dust, and little puffs kicked up with each step.
// Prints only appear on the lunar surface, not on crates or buildings.
export class Footsteps {
  private prints: THREE.InstancedMesh;
  private next = 0; // which print slot to reuse next
  private distance = 0; // meters walked since the last step
  private leftFoot = true;

  constructor(
    scene: THREE.Scene,
    private dust: ImpactEffects,
  ) {
    const material = new THREE.MeshStandardMaterial({
      map: bootprintTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
      // Mirroring the left boot flips its triangles, so draw both sides.
      side: THREE.DoubleSide,
      // Draw slightly in front of the ground so the print doesn't flicker into it.
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const geometry = new THREE.PlaneGeometry(0.14, 0.32).rotateX(-Math.PI / 2);
    this.prints = new THREE.InstancedMesh(geometry, material, CONFIG.footsteps.footprintLife);
    this.prints.count = 0;
    this.prints.receiveShadow = true;
    this.prints.frustumCulled = false; // prints are spread all over the map
    scene.add(this.prints);
  }

  update(dt: number, player: Player, yaw: number) {
    const feet = player.feet;
    // Only the bare lunar surface takes prints: not the paved city, not rooftops.
    const onDust = !isInsideDome(feet) && Math.abs(feet.y - terrainHeight(feet.x, feet.z)) < 0.15;

    if (player.landingSpeed > 1 && onDust) {
      // Both feet hit at once.
      this.stamp(feet, yaw, true);
      this.stamp(feet, yaw, false);
      this.dust.kickDust(feet, CONFIG.footsteps.landingDust, 0.4 + player.landingSpeed * 0.15);
      this.distance = 0;
      return;
    }

    if (!player.grounded) return;
    this.distance += player.horizontalSpeed * dt;
    if (this.distance < CONFIG.footsteps.strideLength) return;
    this.distance = 0;
    this.leftFoot = !this.leftFoot;
    if (!onDust) return;

    // Face the print the way the player is moving, not just looking.
    const moveYaw = Math.atan2(-player.velocity.x, -player.velocity.z);
    this.stamp(feet, moveYaw, this.leftFoot);
    this.dust.kickDust(feet, CONFIG.footsteps.dustPerStep, 0.35 + player.horizontalSpeed * 0.05);
  }

  private stamp(feet: THREE.Vector3, yaw: number, left: boolean) {
    // Offset sideways from the body's center line.
    const side = left ? -0.12 : 0.12;
    const x = feet.x + Math.cos(yaw) * side;
    const z = feet.z - Math.sin(yaw) * side;
    const position = new THREE.Vector3(x, terrainHeight(x, z) + 0.01, z);
    const rotation = new THREE.Quaternion()
      .setFromUnitVectors(UP, terrainNormal(x, z))
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    const scale = new THREE.Vector3(left ? -1 : 1, 1, 1); // mirror for the left boot
    this.prints.setMatrixAt(this.next, new THREE.Matrix4().compose(position, rotation, scale));
    this.prints.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % CONFIG.footsteps.footprintLife;
    this.prints.count = Math.max(this.prints.count, this.next === 0 ? CONFIG.footsteps.footprintLife : this.next);
  }

  clear() {
    this.prints.count = 0;
    this.next = 0;
  }
}

// A chunky space-boot sole with tread bars, drawn on a canvas.
function bootprintTexture() {
  const w = 64;
  const h = 144;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(40,38,35,0.75)';
  // Toe (top of the texture is the front of the boot) and heel.
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.32, w * 0.44, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.8, w * 0.36, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tread bars: slightly lighter ridges across the sole.
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let y = 12; y < h - 8; y += 14) ctx.fillRect(6, y, w - 12, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
