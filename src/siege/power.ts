import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import { MATERIALS, boxCollider } from '../world/city/kit';
import { signPanel, signMaterial } from '../world/city/signs';
import { roomLight } from '../world/city/windows';
import { terrainHeight } from '../world/terrain';

// The city's power. In Drone Siege it's off when a game starts: the city is dark but for
// a faint emergency glow. The power station is out on the surface, west of the landing
// pad, so getting it back on means going out through airlock S with your air running
// down and drones dropping in. Throw the breaker and the lights come up across the city,
// and the suit mod and Overclock stations wake up. In every other mode it's simply on.

export const STATION_SPOT = { x: -46, z: 126 }; // the power station, on the surface
const LEVER_OFF = -2.3; // the breaker's handle hangs down and out from the wall...
const LEVER_ON = -0.7; // ...and swings up when it's thrown

export class CityPower {
  on = true;
  private level = 1; // 0 dark, 1 fully lit (eases between)
  private flicker = 0;
  private materials = [MATERIALS.amberLight, MATERIALS.whiteLight, MATERIALS.softLight, MATERIALS.orangeLight];
  private baseIntensity: number[];
  private lights: THREE.PointLight[] = [];
  private lightBase: number[] = [];
  private signBase: number;

  /** keep: lights that aren't the city's (the gun's flash, explosions). */
  constructor(scene: THREE.Scene, keep: THREE.Light[]) {
    this.baseIntensity = this.materials.map((m) => m.emissiveIntensity);
    scene.traverse((object) => {
      const light = object as THREE.PointLight;
      if (light.isPointLight && !keep.includes(light)) {
        this.lights.push(light);
        this.lightBase.push(light.intensity);
      }
    });
    this.signBase = signMaterial().emissiveIntensity;
  }

  /** Switch the city's power. `instantly` skips the lights coming up (a new game, leaving the mode). */
  set(on: boolean, instantly = false) {
    this.on = on;
    if (instantly) {
      this.level = on ? 1 : 0;
      this.apply();
    } else if (on) {
      this.flicker = 0;
    }
  }

  update(dt: number) {
    const target = this.on ? 1 : 0;
    if (this.level === target) return;
    // Coming back on: up over a couple of seconds, stuttering like old tubes.
    this.flicker += dt;
    this.level = THREE.MathUtils.clamp(this.level + Math.sign(target - this.level) * (dt / CONFIG.siege.power.restoreTime), 0, 1);
    this.apply();
  }

  private apply() {
    const { darkLights, darkRooms } = CONFIG.siege.power;
    const stutter = this.level > 0 && this.level < 1 ? (Math.sin(this.flicker * 37) > 0.2 ? 1 : 0.55) : 1;
    const lit = THREE.MathUtils.lerp(darkLights, 1, this.level * this.level) * stutter;
    this.materials.forEach((m, i) => (m.emissiveIntensity = this.baseIntensity[i] * lit));
    this.lights.forEach((light, i) => (light.intensity = this.lightBase[i] * lit));
    signMaterial().emissiveIntensity = this.signBase * lit;
    roomLight.value = CONFIG.city.roomBrightness * THREE.MathUtils.lerp(darkRooms, 1, this.level) * stutter;
  }
}

/** The power station out on the surface, with the breaker you throw to turn the power on. */
export class PowerStation {
  readonly group = new THREE.Group();
  /** Where you stand to throw the breaker, and which way the panel faces. */
  readonly panel: { position: THREE.Vector3; facing: THREE.Vector3 };
  private lever: THREE.Object3D;
  private lamp: THREE.Mesh;
  private leverAngle = LEVER_OFF;
  private time = 0;
  private lampOff = new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xffa31a, emissiveIntensity: 2 });

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    const { x, z } = STATION_SPOT;
    const ground = terrainHeight(x, z);
    this.group.position.set(x, ground, z);
    scene.add(this.group);
    const statics = new THREE.Group();
    this.group.add(statics);
    const part = (material: THREE.Material, px: number, py: number, pz: number, sx: number, sy: number, sz: number, collide = false) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
      mesh.position.set(px, py, pz);
      mesh.castShadow = mesh.receiveShadow = true;
      statics.add(mesh);
      if (collide) boxCollider(world, { x: x + px, y: ground + py, z: z + pz }, { x: sx, y: sy, z: sz });
      return mesh;
    };
    // The hall: white walls on a dark plinth, a graphite roof with a lip, vents on top.
    part(MATERIALS.graphite, 0, 0.2, 0, 8.4, 0.4, 6.4);
    part(MATERIALS.facade, 0, 2.3, 0, 8, 4, 6, true);
    part(MATERIALS.graphite, 0, 4.4, 0, 8.4, 0.25, 6.4);
    for (const vx of [-2.5, 0, 2.5]) part(MATERIALS.trim, vx, 4.75, -1.2, 1.2, 0.45, 1.2);
    // The breaker panel on the east wall, facing the pad and the airlock.
    part(MATERIALS.graphite, 4.15, 1.6, 0, 0.3, 2.6, 2.4, true);
    part(MATERIALS.shadow, 4.31, 1.7, 0, 0.04, 1.9, 1.7);
    part(MATERIALS.orangeLight, 4.32, 0.36, 0, 0.04, 0.08, 2.2);
    for (let i = 0; i < 4; i++) part(MATERIALS.trim, 4.33, 1.1 + i * 0.32, 0.55, 0.03, 0.14, 0.42);
    // Transformers down the south side, with cooling fins and insulators.
    for (const tx of [-2.6, 0, 2.6]) {
      part(MATERIALS.graphite, tx, 1.1, 4.2, 1.7, 2.2, 1.6, true);
      for (let f = 0; f < 6; f++) part(MATERIALS.trim, tx - 0.7 + f * 0.28, 1.1, 5.05, 0.06, 1.9, 0.12);
      for (const ix of [-0.45, 0, 0.45]) {
        const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.6, 10), MATERIALS.lightPanel);
        insulator.position.set(tx + ix, 2.5, 4.2);
        insulator.castShadow = true;
        statics.add(insulator);
      }
    }
    // Cable trays running off west toward the solar field.
    for (const side of [-0.4, 0.4]) part(MATERIALS.trim, -16, 0.35, -2 + side, 24, 0.15, 0.3);
    for (let cx = -27; cx <= -5; cx += 4) part(MATERIALS.graphite, cx, 0.15, -2, 0.2, 0.3, 1.2);
    // A floodlight mast at the corner.
    part(MATERIALS.graphite, 4.6, 3.5, -3.6, 0.2, 7, 0.2, true);
    const flood = part(MATERIALS.whiteLight, 4.9, 6.9, -3.2, 0.9, 0.06, 0.4);
    flood.rotation.x = 0.4;
    mergeRigidParts(statics);

    // The lever (it swings up when the power comes on) and the status lamp over the panel.
    const pivot = new THREE.Group();
    pivot.position.set(4.36, 1.65, -0.5);
    this.group.add(pivot);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), MATERIALS.lightPanel);
    arm.position.y = 0.35;
    arm.castShadow = true;
    pivot.add(arm);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.12), MATERIALS.orangeLight);
    handle.position.y = 0.75;
    pivot.add(handle);
    this.lever = pivot;
    this.lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), this.lampOff);
    this.lamp.position.set(4.35, 3.1, 0);
    this.group.add(this.lamp);
    const sign = signPanel('Power station', 0.42, 'amber');
    sign.position.set(4.32, 3.65, 0);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);

    this.panel = {
      position: new THREE.Vector3(x + 4.4, ground, z),
      facing: new THREE.Vector3(1, 0, 0),
    };
    this.setOn(true);
  }

  /** Show the breaker thrown (on) or down (off). */
  setOn(on: boolean) {
    this.leverAngle = on ? LEVER_ON : LEVER_OFF;
    this.lever.rotation.z = this.leverAngle;
    this.lamp.material = on ? MATERIALS.whiteLight : this.lampOff;
  }

  update(dt: number, on: boolean) {
    this.time += dt;
    // Off: the lamp blinks to draw you to it.
    if (!on) this.lampOff.emissiveIntensity = Math.sin(this.time * 5) > 0 ? 3 : 0.3;
  }
}
