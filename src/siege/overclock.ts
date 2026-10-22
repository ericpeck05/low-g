import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import { MATERIALS } from '../world/city/kit';
import { signPanel } from '../world/city/signs';
import { SiegeColliders } from './props';
import type { AreaId } from './sections';

// The Overclock station, Drone Siege's Pack-a-Punch: an industrial gantry deep in the north
// district. Once the power is on, hand it the gun you're holding and a lot of points, and
// after a few seconds of crackling energy you get it back much stronger, with a new name.

export class OverclockStation {
  readonly group = new THREE.Group();
  readonly area: AreaId = 'north';
  readonly position = new THREE.Vector3(-9.5, 0, -74);
  readonly facing = new THREE.Vector3(1, 0, 0);
  /** Seconds left on the job in progress (0 when idle). */
  working = 0;
  private core: THREE.Mesh;
  private coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2, 0.9) });
  private arcs: THREE.Mesh[] = [];
  private screen: THREE.Mesh;
  private screens: { on: THREE.Material; off: THREE.Material };
  private time = 0;

  private colliders: SiegeColliders;

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.colliders = new SiegeColliders(world);
    const yaw = Math.atan2(this.facing.x, this.facing.z);
    const local = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(this.position);
    for (const x of [-1.25, 1.25]) this.colliders.box(local(x, 1.6, -0.2), new THREE.Vector3(0.5, 3.2, 0.9), yaw);
    this.colliders.box(local(0, 0.55, 0), new THREE.Vector3(3, 1.1, 1.9), yaw);
    this.colliders.box(local(0, 3.2, -0.2), new THREE.Vector3(3, 0.45, 1), yaw);
    this.group.position.copy(this.position);
    this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z);
    const frame = new THREE.Group();
    const part = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      frame.add(mesh);
    };
    // Base, two heavy pillars, a crossbeam with lights, and a work bed between them.
    part(MATERIALS.graphite, 0, 0.15, 0, 3.0, 0.3, 1.9);
    for (const x of [-1.25, 1.25]) {
      part(MATERIALS.facade, x, 1.6, -0.2, 0.5, 2.9, 0.9);
      part(MATERIALS.amberLight, x * 0.82, 1.6, 0.26, 0.04, 2.4, 0.04);
    }
    part(MATERIALS.graphite, 0, 3.2, -0.2, 3.0, 0.45, 1.0);
    part(MATERIALS.whiteLight, 0, 2.96, 0.0, 1.8, 0.04, 0.3);
    part(MATERIALS.trim, 0, 0.75, 0, 1.6, 0.4, 0.9);
    part(MATERIALS.shadow, 0, 0.96, 0, 1.4, 0.02, 0.7);
    // Coils over the bed that crackle while it works.
    for (const x of [-0.6, 0, 0.6]) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.04, 8, 20), MATERIALS.trim);
      coil.position.set(x, 2.75, -0.1);
      coil.rotation.x = Math.PI / 2;
      frame.add(coil);
    }
    mergeRigidParts(frame);
    this.group.add(frame);
    // The glowing core it forges into the gun, and the arcs that play over it.
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), this.coreMaterial);
    this.core.position.set(0, 1.45, 0);
    this.core.visible = false;
    this.group.add(this.core);
    const arcMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 3; i++) {
      const arc = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 4), arcMaterial);
      arc.visible = false;
      this.group.add(arc);
      this.arcs.push(arc);
    }
    // Its name across the top.
    const sign = signPanel('Overclock', 0.36, 'amber');
    sign.position.set(0, 3.2, 0.31);
    this.group.add(sign);
    // Its screen on the right pillar.
    this.screens = { on: new THREE.MeshBasicMaterial({ map: screenTexture(true) }), off: new THREE.MeshBasicMaterial({ map: screenTexture(false) }) };
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), this.screens.off);
    this.screen.position.set(1.25, 1.75, 0.26);
    this.group.add(this.screen);
    scene.add(this.group);
    this.group.visible = false;
  }

  get glowObjects(): THREE.Object3D[] {
    return [this.core, ...this.arcs];
  }

  setActive(active: boolean) {
    this.group.visible = active;
    this.colliders.setEnabled(active);
    this.working = 0;
    this.core.visible = false;
    for (const arc of this.arcs) arc.visible = false;
  }

  setPowered(on: boolean) {
    this.screen.material = on ? this.screens.on : this.screens.off;
  }

  /** Start a job. */
  start() {
    this.working = CONFIG.siege.overclock.time;
  }

  /** One frame. Returns true when a job finishes. */
  update(dt: number) {
    this.time += dt;
    if (this.working <= 0) return false;
    this.working = Math.max(0, this.working - dt);
    const progress = 1 - this.working / CONFIG.siege.overclock.time;
    this.core.visible = true;
    this.core.scale.setScalar(0.6 + progress * 0.8 + Math.sin(this.time * 30) * 0.08);
    this.core.rotation.y += dt * 6;
    this.coreMaterial.color.setRGB(3 + progress * 4, 2 + progress * 3, 0.9 + progress * 2);
    // Arcs from the coils down to the core, re-struck every frame.
    this.arcs.forEach((arc, i) => {
      const from = new THREE.Vector3(-0.6 + i * 0.6, 2.7, -0.1);
      const to = this.core.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3));
      arc.visible = Math.random() < 0.8;
      arc.position.copy(from).add(to).multiplyScalar(0.5);
      arc.scale.set(1 + progress, from.distanceTo(to), 1 + progress);
      arc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    });
    if (this.working > 0) return false;
    this.core.visible = false;
    for (const arc of this.arcs) arc.visible = false;
    return true;
  }
}

function screenTexture(powered: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 210;
  canvas.height = 280;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0a08';
  ctx.fillRect(0, 0, 210, 280);
  const ink = powered ? '#ffa31a' : '#4a3b25';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.strokeRect(8, 8, 194, 264);
  ctx.textAlign = 'center';
  ctx.fillStyle = powered ? '#fff1dc' : '#5a5246';
  ctx.font = 'bold 30px "SF Mono", Menlo, monospace';
  ctx.fillText('OVER', 105, 80);
  ctx.fillText('CLOCK', 105, 116);
  ctx.font = '15px "SF Mono", Menlo, monospace';
  ctx.fillStyle = powered ? '#c8b9a0' : '#4f483e';
  ctx.fillText('WEAPON UPGRADE', 105, 152);
  ctx.fillStyle = ink;
  ctx.font = 'bold 40px "SF Mono", Menlo, monospace';
  ctx.fillText(powered ? String(CONFIG.siege.overclock.price) : 'NO POWER', 105, 225, 190);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
