import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import type { GunModel } from '../weapons/gunModel';
import type { SiegeWeaponId } from '../weapons/weaponSpec';
import { MATERIALS } from '../world/city/kit';
import { RANGE, TOWERS, towerPosition } from '../world/city/layout';
import { plazaFace } from './spawnPoints';

// Weapon stations on the city's walls, Drone Siege's answer to Zombies' wall buys: a
// backboard with the gun itself mounted on it and a lit label with its name and price.
// Walk up to one, face it, and press E. Buying a gun you already carry refills its ammo.

export interface Station {
  weapon: SiegeWeaponId;
  area: string; // which part of the map it's in (Siege phase 5 locks some away)
  position: THREE.Vector3; // the middle of the board
  facing: THREE.Vector3; // straight out from the wall
}

const UP = new THREE.Vector3(0, 1, 0);
// Amber, lit just enough to read in shadow, but not so bright that it blooms into a haze in sunlight.
const FRAME = new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8a00, emissiveIntensity: 0.35, roughness: 0.5 });
const BOARD_HEIGHT = 1.45; // meters up the wall

export class WeaponStations {
  readonly group = new THREE.Group();
  readonly stations: Station[] = [];

  /** build: makes a fresh model of a gun (the same builders the viewmodel uses). */
  constructor(scene: THREE.Scene, build: (id: SiegeWeaponId) => GunModel) {
    // The cheap one by the range hall's door, the others on tower bases facing the plaza.
    const t = 0.6; // the range hall's wall thickness
    this.add('smg', 'dome', new THREE.Vector3(RANGE.xStart - t - 0.05, BOARD_HEIGHT, -5.8), new THREE.Vector3(-1, 0, 0), build);
    const onTower = (index: number, weapon: SiegeWeaponId) => {
      const tower = TOWERS[index];
      const p = towerPosition(tower);
      const { normal, distance } = plazaFace(p, tower.radius, tower.sides);
      this.add(weapon, 'dome', p.clone().addScaledVector(normal, distance + 0.05).setY(BOARD_HEIGHT), normal, build);
    };
    onTower(4, 'scatter'); // the tower at bearing 320
    onTower(0, 'carbine'); // bearing 40
    onTower(2, 'rail'); // bearing 220, across the plaza from the start
    scene.add(this.group);
    this.group.visible = false;
  }

  /** Stations only exist in Drone Siege. */
  setActive(active: boolean) {
    this.group.visible = active;
  }

  /** The station you're standing at and facing, if any. */
  nearest(feet: THREE.Vector3, lookDirection: THREE.Vector3) {
    let best: Station | null = null;
    let bestDistance: number = CONFIG.siege.stationReach;
    for (const station of this.stations) {
      const away = feet.clone().sub(station.position).setY(0);
      const distance = away.length();
      if (distance > bestDistance) continue;
      // In front of the board, and looking more or less at it.
      if (away.dot(station.facing) < 0) continue;
      const look = lookDirection.clone().setY(0).normalize();
      if (look.dot(station.facing) > -0.35) continue;
      best = station;
      bestDistance = distance;
    }
    return best;
  }

  private add(weapon: SiegeWeaponId, area: string, position: THREE.Vector3, facing: THREE.Vector3, build: (id: SiegeWeaponId) => GunModel) {
    const n = facing.clone().normalize();
    this.stations.push({ weapon, area, position: position.clone(), facing: n });
    const board = new THREE.Group();
    // Seen from the front, "right" along the board.
    const right = new THREE.Vector3().crossVectors(UP, n);
    board.matrix.makeBasis(right, UP, n).setPosition(position);
    board.matrixAutoUpdate = false;

    // The board: a pale plate (so the dark gun stands out against it) with an amber frame.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.06), MATERIALS.lightPanel);
    plate.receiveShadow = true;
    board.add(plate);
    for (const [w, h, x, y] of [[1.5, 0.03, 0, 0.375], [1.5, 0.03, 0, -0.375], [0.03, 0.75, -0.75, 0], [0.03, 0.75, 0.75, 0]]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), FRAME);
      edge.position.set(x, y, 0.005);
      board.add(edge);
    }

    // The gun, lying on its side with its muzzle to the right.
    const model = build(weapon);
    model.flash.removeFromParent(); // no muzzle flash on a gun hanging on a wall
    mergeRigidParts(model.root);
    // Gun space has forward as -z; turn it so forward is the board's +x and its right side faces out.
    model.root.rotation.set(0, -Math.PI / 2, 0);
    model.root.position.set(-0.15, 0.06, 0.09);
    model.root.traverse((part) => (part.castShadow = true));
    board.add(model.root);

    // The label under it: the name in white, the price in amber.
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.2), new THREE.MeshBasicMaterial({ map: labelTexture(weapon), transparent: true }));
    label.position.set(0, -0.26, 0.035);
    board.add(label);
    this.group.add(board);
  }
}

function labelTexture(weapon: SiegeWeaponId) {
  const { name, price } = CONFIG.siege.weapons[weapon];
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 54px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f5f0e8';
  ctx.fillText(name, 28, 66);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffa31a';
  ctx.fillText(String(price), canvas.width - 28, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
