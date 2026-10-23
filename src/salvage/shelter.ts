import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { formatTime } from '../core/highScores';
import { mergeRigidParts } from '../core/mergeMeshes';
import { SiegeColliders } from '../siege/props';
import { MATERIALS } from '../world/city/kit';

// Storm shelter consoles: one inside each airlock. Hold E at one to seal yourself in and
// end the run early, keeping what you've banked. Their screens show the storm's
// countdown and your banked salvage, redrawn once a second.

export interface ShelterConsole {
  position: THREE.Vector3;
  facing: THREE.Vector3;
}

const WIDTH = 320;
const HEIGHT = 300;

export class ShelterConsoles {
  readonly group = new THREE.Group();
  readonly consoles: ShelterConsole[] = [];
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private colliders: SiegeColliders;
  private shown = '';

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.colliders = new SiegeColliders(world);
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const screen = new THREE.MeshBasicMaterial({ map: this.texture });
    const R = CONFIG.city.domeRadius;
    for (const bearing of CONFIG.city.airlockBearings) {
      const b = THREE.MathUtils.degToRad(bearing);
      const out = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
      const across = new THREE.Vector3(Math.cos(b), 0, -Math.sin(b));
      // Beside the way in, a few steps inside the inner door, turned toward the path.
      const position = out.clone().multiplyScalar(R - 10).addScaledVector(across, 4.4);
      const facing = across.clone().negate().addScaledVector(out, -0.35).normalize();
      this.consoles.push({ position, facing });
      this.group.add(this.build(position, facing, screen));
      this.colliders.box(position.clone().setY(0.8), new THREE.Vector3(1.1, 1.6, 0.7), Math.atan2(facing.x, facing.z));
    }
    scene.add(this.group);
    this.setActive(false);
  }

  setActive(active: boolean) {
    this.group.visible = active;
    this.colliders.setEnabled(active);
    this.shown = '';
  }

  /** The console you're standing at and facing, if any. */
  nearest(feet: THREE.Vector3, look: THREE.Vector3) {
    const flat = look.clone().setY(0).normalize();
    for (const console of this.consoles) {
      const toward = console.position.clone().sub(feet).setY(0);
      if (toward.length() > 2.4) continue;
      if (flat.dot(toward.normalize()) < 0.3) continue;
      return console;
    }
    return null;
  }

  /** Redraw the screens (only when what they show has changed). */
  update(timeLeft: number, banked: number, stormHit: boolean) {
    const key = `${Math.ceil(timeLeft)}|${banked}|${stormHit}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.canvas.getContext('2d')!;
    const urgent = stormHit || timeLeft <= 120;
    const ink = urgent ? '#ff7a1a' : '#ffa31a';
    ctx.fillStyle = '#0b0a08';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, WIDTH - 20, HEIGHT - 20);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#c8b9a0';
    ctx.font = 'bold 22px "SF Mono", Menlo, monospace';
    ctx.fillText('STORM SHELTER', WIDTH / 2, 50);
    ctx.fillStyle = ink;
    ctx.font = 'bold 64px "SF Mono", Menlo, monospace';
    ctx.fillText(stormHit ? 'NOW' : formatTime(Math.ceil(timeLeft)), WIDTH / 2, 128);
    ctx.fillStyle = '#c8b9a0';
    ctx.font = '18px "SF Mono", Menlo, monospace';
    ctx.fillText(stormHit ? 'THE STORM IS HERE' : 'UNTIL THE STORM', WIDTH / 2, 156);
    ctx.fillStyle = '#fff1dc';
    ctx.font = 'bold 30px "SF Mono", Menlo, monospace';
    ctx.fillText(`${banked.toLocaleString('en-US')} BANKED`, WIDTH / 2, 212, WIDTH - 40);
    ctx.fillStyle = ink;
    ctx.font = 'bold 18px "SF Mono", Menlo, monospace';
    ctx.fillText('HOLD E TO SEAL UP', WIDTH / 2, 258);
    this.texture.needsUpdate = true;
  }

  get glowObjects() {
    return [this.group];
  }

  // A squat terminal on a plinth, its lit screen tipped back toward you.
  private build(position: THREE.Vector3, facing: THREE.Vector3, screenMaterial: THREE.Material) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = Math.atan2(facing.x, facing.z);
    const body = new THREE.Group();
    const part = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, tilt = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.rotation.x = tilt;
      mesh.castShadow = mesh.receiveShadow = true;
      body.add(mesh);
    };
    part(MATERIALS.facade, 0, 0.06, 0, 1.2, 0.12, 0.8);
    part(MATERIALS.graphite, 0, 0.62, -0.05, 0.95, 1.0, 0.55);
    part(MATERIALS.graphite, 0, 1.5, 0.02, 1.05, 0.98, 0.14, -0.3);
    part(MATERIALS.amberLight, 0, 0.16, 0.36, 0.9, 0.03, 0.03);
    for (const side of [-1, 1]) part(MATERIALS.trim, side * 0.5, 0.62, 0.23, 0.05, 0.95, 0.05);
    mergeRigidParts(body);
    group.add(body);
    // The screen, on the front of the tilted head (the same shape as its picture).
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92 * (HEIGHT / WIDTH)), screenMaterial);
    screen.position.set(0, 1.5, 0.02).add(new THREE.Vector3(0, Math.sin(0.3), Math.cos(0.3)).multiplyScalar(0.075));
    screen.rotation.x = -0.3;
    group.add(screen);
    return group;
  }
}
