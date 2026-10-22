import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import type { GunModel } from '../weapons/gunModel';
import type { SiegeWeaponId } from '../weapons/weaponSpec';
import { MATERIALS } from '../world/city/kit';
import type { AreaId } from './sections';

// The Supply Drop, Drone Siege's Mystery Box: a cargo pod with a beam of light over it
// so you can find it. Pay, and its lid lifts while weapons flick past over it; when it
// settles on one you have a few seconds to take it. Every few uses it gives you nothing
// (your points back) and lifts off to land somewhere else in the city.

const SPOTS: { area: AreaId; x: number; z: number; yaw: number }[] = [
  { area: 'plaza', x: -9.7, z: -24.1, yaw: 0.38 },
  { area: 'towers', x: -28, z: 26, yaw: 2.4 },
  { area: 'south', x: -9.5, z: 80, yaw: Math.PI / 2 },
  { area: 'north', x: 9.5, z: -80, yaw: -Math.PI / 2 },
];

export type SupplyState = 'closed' | 'spinning' | 'ready' | 'leaving' | 'arriving';

export class SupplyDrop {
  readonly group = new THREE.Group();
  state: SupplyState = 'closed';
  /** The weapon on offer once it's done spinning. */
  pick: SiegeWeaponId | null = null;
  private spot = 0;
  private timer = 0;
  private uses = 0;
  private movesAfter = 5;
  private moving = false; // this open ends with it leaving
  private pod = new THREE.Group();
  private lid = new THREE.Group();
  private beam: THREE.Mesh;
  private shown = new Map<SiegeWeaponId, THREE.Group>();
  private holder = new THREE.Group(); // the weapon floating over the open pod
  private flick = 0;
  private spin = 0;

  private collider: RAPIER.Collider;
  private active = false;

  constructor(scene: THREE.Scene, world: RAPIER.World, build: (id: SiegeWeaponId) => GunModel) {
    this.collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.02, 0.5, 0.6));
    this.collider.setEnabled(false);
    // The pod: a dark armored crate with amber bands, a lid that lifts, and a light on top.
    const body = new THREE.Group();
    const part = (parent: THREE.Group, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    };
    part(body, MATERIALS.graphite, 0, 0.45, 0, 1.9, 0.9, 1.05);
    part(body, MATERIALS.facade, 0, 0.06, 0, 2.05, 0.12, 1.2);
    for (const x of [-0.7, 0.7]) part(body, MATERIALS.amberLight, x, 0.45, 0.53, 0.08, 0.7, 0.02);
    for (const x of [-0.93, 0.93]) for (const z of [-0.5, 0.5]) part(body, MATERIALS.facade, x, 0.45, z, 0.1, 0.92, 0.1);
    mergeRigidParts(body);
    this.pod.add(body);
    part(this.lid, MATERIALS.graphite, 0, 0.06, 0, 1.92, 0.12, 1.07);
    part(this.lid, MATERIALS.facade, 0, 0.13, 0, 1.4, 0.04, 0.6);
    part(this.lid, MATERIALS.amberLight, 0, 0.16, 0, 0.5, 0.03, 0.12);
    mergeRigidParts(this.lid);
    this.lid.position.y = 0.9;
    this.pod.add(this.lid);
    this.pod.add(this.holder);
    this.holder.position.y = 1.55;
    // Each weapon it can give, ready to show over the pod (bigger than life, so you can read it).
    for (const id of Object.keys(CONFIG.siege.supplyDrop.weights) as SiegeWeaponId[]) {
      const model = build(id);
      model.flash.removeFromParent();
      mergeRigidParts(model.root);
      const holder = new THREE.Group();
      model.root.rotation.y = Math.PI / 2;
      holder.add(model.root);
      holder.scale.setScalar(2.2);
      holder.visible = false;
      this.holder.add(holder);
      this.shown.set(id, holder);
    }
    // A soft column of amber light over it, so it can be found from across the city.
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.35, 36, 16, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTexture(), color: new THREE.Color(0.75, 0.42, 0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beam.position.y = 18.5;
    this.pod.add(this.beam);
    this.group.add(this.pod);
    scene.add(this.group);
    this.group.visible = false;
  }

  /** Where it is now: its section and the spot to stand at to use it. */
  get area() {
    return SPOTS[this.spot].area;
  }

  get position() {
    const s = SPOTS[this.spot];
    return new THREE.Vector3(s.x, 0, s.z);
  }

  get glowObjects(): THREE.Object3D[] {
    return [this.beam];
  }

  /** A new game: closed, back in the plaza. */
  reset(active: boolean) {
    this.active = active;
    this.group.visible = active;
    this.spot = 0;
    this.uses = 0;
    this.movesAfter = this.rollMoves();
    this.close();
    this.place();
  }

  /** Paid for: start spinning. */
  open() {
    this.state = 'spinning';
    this.timer = CONFIG.siege.supplyDrop.spinTime;
    this.uses++;
    this.moving = this.uses >= this.movesAfter;
    this.pick = null;
  }

  /** The weapon was taken. */
  take() {
    this.close();
  }

  /**
   * One frame. `choose` picks the weapon it settles on (so it never offers one you're
   * carrying). Returns what happened: 'revealed' when the spin ends, 'leaving' when it
   * gives nothing and lifts off instead, 'expired' if the offer runs out, 'landed'.
   */
  update(dt: number, choose: () => SiegeWeaponId, unlocked: Set<AreaId>): 'revealed' | 'leaving' | 'expired' | 'landed' | null {
    this.spin += dt;
    this.holder.rotation.y = this.spin * 0.9;
    this.holder.position.y = 1.55 + Math.sin(this.spin * 2) * 0.05;
    const lidTarget = this.state === 'spinning' || this.state === 'ready' ? 1.55 : 0.9;
    this.lid.position.y += (lidTarget - this.lid.position.y) * Math.min(1, dt * 6);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = this.state === 'leaving' || this.state === 'arriving' ? 0.3 : 0.75;
    if (this.state === 'closed') return null;
    this.timer -= dt;
    if (this.state === 'spinning') {
      // Flick through the weapons, slowing down toward the end.
      this.flick -= dt;
      if (this.flick <= 0) {
        const ids = [...this.shown.keys()];
        this.show(ids[Math.floor(Math.random() * ids.length)]);
        this.flick = 0.06 + 0.3 * (1 - this.timer / CONFIG.siege.supplyDrop.spinTime) ** 2;
      }
      if (this.timer <= 0) {
        if (this.moving) {
          this.show(null);
          this.state = 'leaving';
          this.timer = 2.4;
          return 'leaving';
        }
        this.pick = choose();
        this.show(this.pick);
        this.state = 'ready';
        this.timer = CONFIG.siege.supplyDrop.takeTime;
        return 'revealed';
      }
    } else if (this.state === 'ready') {
      // The weapon sinks back into the pod as the offer runs out.
      this.holder.position.y = 1.55 - 0.6 * Math.max(0, 1 - this.timer / CONFIG.siege.supplyDrop.takeTime);
      if (this.timer <= 0) {
        this.close();
        return 'expired';
      }
    } else if (this.state === 'leaving') {
      // Up and away on its thrusters...
      this.collider.setEnabled(false);
      this.pod.position.y += dt * (2 + (2.4 - this.timer) * 14);
      if (this.timer <= 0) {
        const choices = SPOTS.map((_, i) => i).filter((i) => i !== this.spot && unlocked.has(SPOTS[i].area));
        if (choices.length > 0) this.spot = choices[Math.floor(Math.random() * choices.length)];
        this.place();
        this.pod.position.y = 40;
        this.state = 'arriving';
        this.timer = 2;
      }
    } else if (this.state === 'arriving') {
      // ...and down somewhere else.
      this.pod.position.y = Math.max(0, 40 * (this.timer / 2) ** 2);
      if (this.timer <= 0) {
        this.uses = 0;
        this.movesAfter = this.rollMoves();
        this.close();
        return 'landed';
      }
    }
    return null;
  }

  private close() {
    this.state = 'closed';
    this.pick = null;
    this.show(null);
    this.pod.position.y = 0;
  }

  private place() {
    const s = SPOTS[this.spot];
    this.group.position.set(s.x, 0, s.z);
    this.group.rotation.y = s.yaw;
    // Solid while it sits on the ground in a game.
    this.collider.setTranslation({ x: s.x, y: 0.5, z: s.z });
    this.collider.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw));
    this.collider.setEnabled(this.active);
  }

  private show(id: SiegeWeaponId | null) {
    for (const [key, holder] of this.shown) holder.visible = key === id;
  }

  private rollMoves() {
    const [min, max] = CONFIG.siege.supplyDrop.movesAfter;
    return min + Math.floor(Math.random() * (max - min + 1));
  }
}

/** A vertical fade for the light column: bright at the bottom, gone at the top. */
function beamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(0.97, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 128);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
