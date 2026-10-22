import * as THREE from 'three';
import { CONFIG } from '../../config';

// Where the main pieces of the city sit. Buildings and target courses both read this,
// so moving a tower here moves its rooftop targets with it.

export interface TowerSpec {
  bearing: number; // degrees around the plaza (0 = +z, 90 = +x)
  radius: number; // the tower's own size
  height: number;
  sides: number; // 4 = square, 6 = hexagon, 24 = round
}

export const TOWER_RING = 50; // towers stand this far from the center
export const BALCONY_EXTRA = 3.5; // the ring platform sticks out this far around each tower

// Heights of 15-17 m can be reached by jetpacking up from the 8 m walkway.
// The two tall ones are skyline.
export const TOWERS: TowerSpec[] = [
  { bearing: 40, radius: 7, height: 16, sides: 6 },
  { bearing: 140, radius: 8, height: 30, sides: 24 },
  { bearing: 220, radius: 6.5, height: 17, sides: 6 },
  { bearing: 270, radius: 7.5, height: 36, sides: 4 },
  { bearing: 320, radius: 6, height: 15, sides: 6 },
];

export const PLAZA_RADIUS = 16;

// A road for carts and rovers round the city, between the towers and the outer district.
export const RING_ROAD = { inner: 59.5, outer: 65.5 };
export const DISTRICT_START = 67.5; // the outer buildings start this far from the center

export type Kind = 'hab' | 'shops' | 'hydro' | 'utility';

export interface Block {
  bearing: number; // degrees round the city where the middle of its front sits
  width: number; // along the ring road
  depth: number; // back toward the dome wall
  kind: Kind;
  sign: string;
}

// Two arcs of buildings, east and west, leaving the avenues to the airlocks clear.
export const BLOCKS: Block[] = [
  { bearing: 17, width: 16, depth: 12, kind: 'shops', sign: 'Tranquility Café' },
  { bearing: 34, width: 15, depth: 12, kind: 'hab', sign: 'Hab 1' },
  { bearing: 52, width: 18, depth: 13, kind: 'hydro', sign: 'Hydroponics A' },
  { bearing: 70, width: 14, depth: 12, kind: 'hab', sign: 'Hab 2' },
  { bearing: 90, width: 20, depth: 12, kind: 'utility', sign: 'Life support 1' },
  { bearing: 110, width: 14, depth: 12, kind: 'hab', sign: 'Hab 3' },
  { bearing: 127, width: 16, depth: 12, kind: 'shops', sign: 'Mare Market' },
  { bearing: 145, width: 18, depth: 13, kind: 'hydro', sign: 'Hydroponics B' },
  { bearing: 163, width: 15, depth: 12, kind: 'hab', sign: 'Hab 4' },
  { bearing: 197, width: 15, depth: 12, kind: 'shops', sign: 'Clinic' },
  { bearing: 214, width: 15, depth: 12, kind: 'hab', sign: 'Hab 5' },
  { bearing: 232, width: 18, depth: 13, kind: 'hydro', sign: 'Hydroponics C' },
  { bearing: 250, width: 14, depth: 12, kind: 'hab', sign: 'Hab 6' },
  { bearing: 270, width: 20, depth: 12, kind: 'utility', sign: 'Power' },
  { bearing: 290, width: 14, depth: 12, kind: 'hab', sign: 'Hab 7' },
  { bearing: 307, width: 16, depth: 12, kind: 'shops', sign: 'Outfitters' },
  { bearing: 325, width: 15, depth: 12, kind: 'hab', sign: 'Hab 8' },
  { bearing: 343, width: 15, depth: 12, kind: 'shops', sign: 'Noodle bar' },
];

/** How tall a district building of this kind is, to its roof (greenhouses: to the top of the vault). */
export function blockHeight(kind: Kind, depth = 12) {
  if (kind === 'hab') return 4 + 2 * 3.6;
  if (kind === 'shops') return 4.4 + 3.8;
  if (kind === 'utility') return 5 + 4;
  return 1.2 + depth / 2;
}


// The indoor shooting range: a long hall east of the plaza.
export const RANGE = { xStart: 26, xEnd: 64, halfWidth: 8, height: 7 };

// Outside the dome.
export const LANDING_PAD = { x: 0, z: 128, radius: 16 };
export const SOLAR_FIELD = { xStart: -104, rows: 6, rowSpacing: 7, halfLength: 32 };
export const MODULES_CENTER = { x: 100, z: -100 };
export const ANTENNAS = [
  { x: -70, z: 112, height: 24 },
  { x: 128, z: 48, height: 20 },
  { x: -112, z: -82, height: 26 },
];

export function towerPosition(tower: TowerSpec) {
  const b = THREE.MathUtils.degToRad(tower.bearing);
  return new THREE.Vector3(Math.sin(b) * TOWER_RING, 0, Math.cos(b) * TOWER_RING);
}

export function walkwayHeight() {
  return CONFIG.city.walkwayHeight;
}
