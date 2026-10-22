import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import { MATERIALS } from '../world/city/kit';
import { type IconId, drawIcon } from './icons';
import { SiegeColliders } from './props';
import type { AreaId } from './sections';

// Suit mods, Drone Siege's perks. Each is installed at its own station, once the city's
// power is on, and lasts until you die. You can have four at a time. Auto-Medic is used
// up when it saves you, and can be bought again (three times a game).

export type ModId = 'plating' | 'cycler' | 'thruster' | 'overcharge' | 'recycler' | 'medic';
export const MOD_IDS: ModId[] = ['plating', 'cycler', 'thruster', 'overcharge', 'recycler', 'medic'];

/** One line on what each mod does, for its station and the HUD. */
export const MOD_BLURBS: Record<ModId, string> = {
  plating: 'MORE SUIT INTEGRITY',
  cycler: 'FASTER RELOADS',
  thruster: 'BIGGER JETPACK, FASTER REFILL',
  overcharge: 'ALL GUNS FIRE FASTER',
  recycler: 'OXYGEN LASTS LONGER OUTSIDE',
  medic: 'GET BACK UP ONCE',
};

export class SuitMods {
  readonly owned = new Set<ModId>();
  medicsBought = 0;

  reset() {
    this.owned.clear();
    this.medicsBought = 0;
  }

  has(id: ModId) {
    return this.owned.has(id);
  }

  /** Why you can't buy this one right now, or null if you can. */
  blocker(id: ModId): string | null {
    if (this.owned.has(id)) return 'INSTALLED';
    if (id === 'medic' && this.medicsBought >= CONFIG.siege.mods.medic.maxPerGame) return 'NONE LEFT';
    if (this.owned.size >= CONFIG.siege.mods.max) return `${CONFIG.siege.mods.max} MODS MAX`;
    return null;
  }
}

/** Where each mod's station stands: its section, the spot, and which way its screen faces. */
const STATIONS: { mod: ModId; area: AreaId; x: number; z: number; face: [number, number] }[] = [
  { mod: 'medic', area: 'plaza', x: -26.1, z: 7.0, face: [26.1, -7.0] },
  { mod: 'plating', area: 'towers', x: -38, z: 8, face: [1, -0.2] },
  { mod: 'cycler', area: 'towers', x: 20, z: -30, face: [-0.55, 0.83] },
  { mod: 'thruster', area: 'south', x: 9.5, z: 74, face: [-1, 0] },
  { mod: 'recycler', area: 'south', x: -9.5, z: 74, face: [1, 0] },
  { mod: 'overcharge', area: 'north', x: 9.5, z: -74, face: [-1, 0] },
];

export interface ModStation {
  mod: ModId;
  area: AreaId;
  position: THREE.Vector3;
  facing: THREE.Vector3;
}

/** The mod stations: tall dispensers with a lit screen (dark while the power's off). */
export class ModStations {
  readonly group = new THREE.Group();
  readonly stations: ModStation[] = [];
  private screens: { on: THREE.Material; off: THREE.Material; mesh: THREE.Mesh }[] = [];

  private colliders: SiegeColliders;

  constructor(scene: THREE.Scene, world: RAPIER.World) {
    this.colliders = new SiegeColliders(world);
    for (const s of STATIONS) {
      const position = new THREE.Vector3(s.x, 0, s.z);
      const facing = new THREE.Vector3(s.face[0], 0, s.face[1]).normalize();
      this.stations.push({ mod: s.mod, area: s.area, position, facing });
      this.group.add(this.build(s.mod, position, facing));
      this.colliders.box(position.clone().setY(1.2), new THREE.Vector3(1.2, 2.4, 0.85), Math.atan2(facing.x, facing.z));
    }
    scene.add(this.group);
    this.group.visible = false;
  }

  setActive(active: boolean) {
    this.group.visible = active;
    this.colliders.setEnabled(active);
  }

  /** Light the screens (power on) or show them dark. */
  setPowered(on: boolean) {
    for (const screen of this.screens) screen.mesh.material = on ? screen.on : screen.off;
  }

  private build(mod: ModId, position: THREE.Vector3, facing: THREE.Vector3) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.y = Math.atan2(facing.x, facing.z);
    const body = new THREE.Group();
    const part = (material: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      body.add(mesh);
    };
    part(MATERIALS.graphite, 0, 1.15, 0, 1.1, 2.3, 0.75);
    part(MATERIALS.facade, 0, 2.35, 0, 1.2, 0.14, 0.85);
    part(MATERIALS.facade, 0, 0.08, 0, 1.2, 0.16, 0.85);
    for (const side of [-1, 1]) part(MATERIALS.amberLight, side * 0.56, 1.2, 0.36, 0.03, 1.9, 0.03);
    part(MATERIALS.shadow, 0, 0.55, 0.38, 0.7, 0.32, 0.02); // the hatch the mod comes out of
    mergeRigidParts(body);
    group.add(body);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15));
    screen.position.set(0, 1.42, 0.38);
    group.add(screen);
    this.screens.push({
      on: new THREE.MeshBasicMaterial({ map: screenTexture(mod, true) }),
      off: new THREE.MeshBasicMaterial({ map: screenTexture(mod, false) }),
      mesh: screen,
    });
    screen.material = this.screens[this.screens.length - 1].off;
    return group;
  }
}

function screenTexture(mod: ModId, powered: boolean) {
  const { name, price } = CONFIG.siege.mods[mod];
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 410;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0b0a08';
  ctx.fillRect(0, 0, 320, 410);
  const ink = powered ? '#ffa31a' : '#4a3b25';
  const text = powered ? '#fff1dc' : '#5a5246';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 296, 386);
  ctx.textAlign = 'center';
  ctx.fillStyle = powered ? '#c8b9a0' : '#4f483e';
  ctx.font = 'bold 22px "SF Mono", Menlo, monospace';
  ctx.fillText('SUIT MOD', 160, 52);
  drawIcon(ctx, mod as IconId, 95, 72, 130, ink);
  ctx.fillStyle = text;
  ctx.font = 'bold 30px "SF Mono", Menlo, monospace';
  ctx.fillText(name, 160, 248, 280);
  ctx.font = '18px "SF Mono", Menlo, monospace';
  ctx.fillStyle = powered ? '#c8b9a0' : '#4f483e';
  ctx.fillText(MOD_BLURBS[mod], 160, 284, 280);
  ctx.fillStyle = ink;
  ctx.font = 'bold 46px "SF Mono", Menlo, monospace';
  ctx.fillText(powered ? String(price) : 'NO POWER', 160, 360, 280);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
