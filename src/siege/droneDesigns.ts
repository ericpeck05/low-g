import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { DroneType } from './rounds';

// What each kind of hostile drone looks like, and how big it is to hit. Every drone is
// a dark body, red glowing parts, and (mostly) spinning rotors; they face down their -z
// axis. The glowing core is the weak point (double damage). The carrier has no core:
// it has separate glowing weak points instead.

export interface DroneDesign {
  body: THREE.BufferGeometry; // the dark parts
  glow: THREE.BufferGeometry; // the glowing parts; vertex colors set how bright each part is
  rotors: THREE.Vector3[]; // where rotor blades spin
  rotorLength: number;
  radius: number; // the body's size for collisions and hits
  core: THREE.Vector3 | null; // the weak point, also where its shots come from
  coreRadius: number;
  haloSize: number; // the soft red glow around the core (or each weak point)
  hull?: { radius: number; halfHeight: number }; // a big flat body (the carrier) hit as a disc, not a ball
  shield?: THREE.BufferGeometry; // shielded drones: the energy shield over the front
  weakPoints?: THREE.Vector3[]; // the carrier's targets
  weakPointRadius?: number;
  muzzles?: THREE.Vector3[]; // where bolts come from, if not the core (a gunner's pods)
}

const tips = (count: number, radius: number, y: number, offset = Math.PI / 4) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + offset;
    return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
  });

/** Merge parts into one geometry (all with the same attributes). */
function merge(parts: THREE.BufferGeometry[]) {
  return mergeGeometries(parts.map((g) => {
    if (g.attributes.uv) g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  }))!;
}

/** Glowing parts: `shade` sets how bright this part glows compared with the core. */
function tint(geometry: THREE.BufferGeometry, shade: number) {
  const colors = new Float32Array(geometry.attributes.position.count * 3).fill(shade);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function at<T extends THREE.BufferGeometry>(geometry: T, x: number, y: number, z: number) {
  geometry.translate(x, y, z);
  return geometry;
}

// Arms from the hull out to each rotor, and a hub under each.
function arms(rotors: THREE.Vector3[], thickness: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (const tip of rotors) {
    const length = Math.hypot(tip.x, tip.z);
    const arm = new THREE.BoxGeometry(length * 0.95, thickness, thickness * 1.5);
    arm.rotateY(-Math.atan2(tip.z, tip.x));
    arm.translate(tip.x * 0.52, tip.y - 0.05, tip.z * 0.52);
    parts.push(arm, at(new THREE.CylinderGeometry(thickness, thickness * 1.3, thickness * 2, 10), tip.x, tip.y - 0.035, tip.z));
  }
  return parts;
}

function scout(): DroneDesign {
  const rotors = tips(4, 0.52, 0.08);
  const core = new THREE.Vector3(0, -0.03, -0.36);
  const hull = new THREE.SphereGeometry(0.42, 22, 14).scale(1, 0.6, 1);
  const socket = at(new THREE.TorusGeometry(0.14, 0.035, 8, 24), core.x, core.y, core.z + 0.04);
  const glowCore = at(new THREE.SphereGeometry(0.115, 18, 12), core.x, core.y, core.z);
  const band = new THREE.TorusGeometry(0.435, 0.018, 6, 40).rotateX(Math.PI / 2);
  return {
    body: merge([hull, socket, ...arms(rotors, 0.03)]),
    glow: merge([tint(glowCore, 1), tint(band, 0.35)]),
    rotors,
    rotorLength: 0.34,
    radius: 0.4,
    core,
    coreRadius: 0.14,
    haloSize: CONFIG.siege.haloSize,
  };
}

// Bigger, with a gun pod on each side.
function gunner(): DroneDesign {
  const rotors = tips(4, 0.74, 0.1);
  const core = new THREE.Vector3(0, -0.05, -0.5);
  const hull = new THREE.SphereGeometry(0.58, 24, 16).scale(1, 0.58, 1);
  const parts = [hull, at(new THREE.TorusGeometry(0.19, 0.045, 8, 24), core.x, core.y, core.z + 0.05), ...arms(rotors, 0.04)];
  const muzzles: THREE.Vector3[] = [];
  const glows = [tint(at(new THREE.SphereGeometry(0.15, 18, 12), core.x, core.y, core.z), 1)];
  for (const side of [-1, 1]) {
    parts.push(at(new THREE.BoxGeometry(0.13, 0.13, 0.5), side * 0.45, -0.06, -0.18));
    parts.push(at(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 10).rotateX(Math.PI / 2), side * 0.45, -0.06, -0.47));
    muzzles.push(new THREE.Vector3(side * 0.45, -0.06, -0.54));
    glows.push(tint(at(new THREE.SphereGeometry(0.04, 10, 8), side * 0.45, -0.06, -0.535), 0.8));
  }
  glows.push(tint(new THREE.TorusGeometry(0.595, 0.022, 6, 44).rotateX(Math.PI / 2), 0.35));
  return {
    body: merge(parts),
    glow: merge(glows),
    rotors,
    rotorLength: 0.44,
    radius: 0.58,
    core,
    coreRadius: 0.18,
    haloSize: 1.5,
    muzzles,
  };
}

// A scout with a curved energy shield over its front.
function shielded(): DroneDesign {
  const design = scout();
  const arc = THREE.MathUtils.degToRad(CONFIG.siege.shielded.shieldArc);
  // A cap of a sphere around +y, turned to face forward (-z).
  design.shield = new THREE.SphereGeometry(0.8, 28, 10, 0, Math.PI * 2, 0, arc).rotateX(-Math.PI / 2);
  return design;
}

// Long and thin, with a long barrel and two rotors: a sniper.
function sniper(): DroneDesign {
  const rotors = [new THREE.Vector3(0.5, 0.06, 0.05), new THREE.Vector3(-0.5, 0.06, 0.05)];
  const core = new THREE.Vector3(0, -0.07, -0.34);
  const hull = new THREE.CapsuleGeometry(0.21, 0.62, 6, 16).rotateX(Math.PI / 2);
  const barrel = at(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 12).rotateX(Math.PI / 2), 0, 0.04, -0.75);
  const fin = at(new THREE.BoxGeometry(0.02, 0.28, 0.22), 0, 0.2, 0.42);
  const glows = [
    tint(at(new THREE.SphereGeometry(0.095, 16, 10), core.x, core.y, core.z), 1),
    tint(at(new THREE.SphereGeometry(0.03, 10, 8), 0, 0.04, -1.18), 0.7),
    tint(at(new THREE.TorusGeometry(0.215, 0.014, 6, 32), 0, 0, 0.08), 0.35),
  ];
  return {
    body: merge([hull, barrel, fin, at(new THREE.TorusGeometry(0.12, 0.03, 8, 20), core.x, core.y, core.z + 0.03), ...arms(rotors, 0.03)]),
    glow: merge(glows),
    rotors,
    rotorLength: 0.5,
    radius: 0.42,
    core,
    coreRadius: 0.13,
    haloSize: 1,
    muzzles: [new THREE.Vector3(0, 0.04, -1.18)],
  };
}

// A ring with a glowing core in the middle: the repair drone.
function repair(): DroneDesign {
  const rotors = tips(4, 0.43, 0.15, 0);
  const core = new THREE.Vector3(0, -0.04, 0);
  const ring = new THREE.TorusGeometry(0.42, 0.1, 10, 32).rotateX(Math.PI / 2);
  const struts = [0, Math.PI / 2].map((a) => new THREE.BoxGeometry(0.84, 0.05, 0.06).rotateY(a));
  const hub = at(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 16), 0, 0.06, 0);
  const lights = tips(4, 0.42, -0.07, Math.PI / 4).map((p) => tint(at(new THREE.SphereGeometry(0.045, 10, 8), p.x, p.y, p.z), 0.8));
  return {
    body: merge([ring, ...struts, hub, ...arms(rotors, 0.025)]),
    glow: merge([tint(at(new THREE.SphereGeometry(0.13, 18, 12), core.x, core.y, core.z), 1), ...lights]),
    rotors,
    rotorLength: 0.28,
    radius: 0.52,
    core,
    coreRadius: 0.16,
    haloSize: 1.3,
  };
}

// Small and spiky, with no rotors: a thruster flare behind it. A kamikaze.
function kamikaze(): DroneDesign {
  const parts: THREE.BufferGeometry[] = [new THREE.IcosahedronGeometry(0.2, 0)];
  for (const p of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1]]) {
    const spike = new THREE.ConeGeometry(0.045, 0.16, 6);
    spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...p)));
    spike.translate(p[0] * 0.24, p[1] * 0.24, p[2] * 0.24);
    parts.push(spike);
  }
  return {
    body: merge(parts),
    // The glow ball sits just outside the faces of the body, so a red spot shows on each one.
    glow: merge([tint(new THREE.SphereGeometry(0.167, 24, 16), 1), tint(at(new THREE.SphereGeometry(0.09, 12, 8), 0, 0, 0.22), 0.9)]),
    rotors: [],
    rotorLength: 0,
    radius: 0.3,
    core: new THREE.Vector3(0, 0, 0),
    coreRadius: 0, // too small for a weak point: any hit counts
    haloSize: 0.9,
  };
}

// The boss: a big armored saucer with six rotors, a launch bay underneath and three
// glowing weak points.
function carrier(): DroneDesign {
  const rotors = tips(6, 2.3, 0.34, 0);
  const hull = new THREE.SphereGeometry(1.9, 36, 18).scale(1, 0.42, 1);
  const plates: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const plate = new THREE.BoxGeometry(0.9, 0.12, 0.6).rotateY(-a);
    plates.push(at(plate, Math.cos(a) * 1.35, 0.5, Math.sin(a) * 1.35));
  }
  const bay = at(new THREE.BoxGeometry(1.1, 0.3, 1.1), 0, -0.7, 0);
  const weakPoints = [new THREE.Vector3(-1.25, -0.25, -1.0), new THREE.Vector3(1.25, -0.25, -1.0), new THREE.Vector3(0, -0.72, 1.15)];
  const sockets = weakPoints.map((p) => at(new THREE.SphereGeometry(0.38, 16, 10).scale(1, 0.7, 1), p.x, p.y + 0.06, p.z));
  return {
    body: merge([hull, ...plates, bay, ...sockets, ...arms(rotors, 0.09)]),
    glow: merge([
      tint(new THREE.TorusGeometry(1.92, 0.05, 6, 64).rotateX(Math.PI / 2), 0.4),
      tint(at(new THREE.BoxGeometry(0.9, 0.04, 0.9), 0, -0.86, 0), 0.5), // the bay's lit edge
    ]),
    rotors,
    rotorLength: 1.1,
    radius: 1, // the center; the hull disc below takes most hits
    core: null,
    coreRadius: 0,
    haloSize: 1.4,
    hull: { radius: 1.9, halfHeight: 0.42 },
    weakPoints,
    weakPointRadius: 0.32,
  };
}

export const DESIGNS: Record<DroneType, DroneDesign> = {
  scout: scout(),
  gunner: gunner(),
  shielded: shielded(),
  sniper: sniper(),
  repair: repair(),
  kamikaze: kamikaze(),
  carrier: carrier(),
};
