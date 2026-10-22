import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildDistrict } from './district';
import { buildGround } from './ground';
import { buildPlaza } from './plaza';
import { signPanel } from './signs';
import { Greenery } from './props';
import { Face } from './facade';
import { MATERIALS, lightStrip, solidBox } from './kit';
import { RANGE } from './layout';
import { buildTowers } from './towers';
import { buildWalkways } from './walkways';
import { GlassBatch } from './glass';
import { WindowBatch } from './windows';

// Everything under the dome: the streets, the central plaza and monument, the towers,
// the ring of walkways between them and the ramps up to it, the indoor shooting range,
// and the outer district of low buildings, greenhouses and shops.
export function buildInterior(scene: THREE.Object3D, world: RAPIER.World) {
  const windows = new WindowBatch();
  const green = new Greenery();
  const glass = new GlassBatch();
  buildGround(scene);
  buildPlaza(scene, world, green);
  buildTowers(scene, world, windows);
  buildWalkways(scene, world, glass);
  buildRange(scene, world);
  buildDistrict(scene, world, windows, green, glass);
  windows.build(scene);
  green.build(scene, world);
  return { glass: glass.build(scene) };
}

// An enclosed hall with a doorway facing the plaza, a firing line, and lanes.
function buildRange(scene: THREE.Object3D, world: RAPIER.World) {
  const { xStart, xEnd, halfWidth, height } = RANGE;
  const length = xEnd - xStart;
  const midX = (xStart + xEnd) / 2;
  const t = 0.6; // wall thickness

  // Side walls, back wall, roof.
  for (const s of [-1, 1]) {
    solidBox(scene, world, { x: midX, y: height / 2, z: s * (halfWidth + t / 2) }, { x: length, y: height, z: t }, MATERIALS.lightPanel);
  }
  solidBox(scene, world, { x: xEnd + t / 2, y: height / 2, z: 0 }, { x: t, y: height, z: halfWidth * 2 + t * 2 }, MATERIALS.lightPanel);
  solidBox(scene, world, { x: midX, y: height + 0.2, z: 0 }, { x: length + t * 2, y: 0.4, z: halfWidth * 2 + t * 2 }, MATERIALS.trim);

  // Front wall with a 6 m wide, 4 m tall doorway.
  const door = 3;
  const sideWidth = halfWidth + t - door;
  for (const s of [-1, 1]) {
    solidBox(scene, world, { x: xStart - t / 2, y: height / 2, z: s * (door + sideWidth / 2) }, { x: t, y: height, z: sideWidth }, MATERIALS.lightPanel);
  }
  solidBox(scene, world, { x: xStart - t / 2, y: (height + 4) / 2, z: 0 }, { x: t, y: height - 4, z: door * 2 }, MATERIALS.lightPanel);
  rangeExterior(scene, world);

  // Dark floor inside, lane lines, and the firing-line counter.
  solidBox(scene, world, { x: midX, y: 0.03, z: 0 }, { x: length, y: 0.06, z: halfWidth * 2 }, MATERIALS.darkMetal, 0, false);
  const firingLine = xStart + 5;
  solidBox(scene, world, { x: firingLine, y: 0.55, z: 0 }, { x: 0.6, y: 1.1, z: halfWidth * 2 }, MATERIALS.trim);
  lightStrip(scene, { x: firingLine + 0.31, y: 1.0, z: 0 }, { x: 0.02, y: 0.08, z: halfWidth * 2 }, MATERIALS.amberLight);
  for (const z of [-4, 0, 4]) {
    lightStrip(scene, { x: (firingLine + xEnd) / 2, y: 0.07, z }, { x: xEnd - firingLine, y: 0.02, z: 0.08 }, MATERIALS.amberLight);
  }

  // Ceiling lights and two warm lamps so the hall isn't lit only by the doorway.
  for (const z of [-5, 0, 5]) {
    lightStrip(scene, { x: midX, y: height - 0.05, z }, { x: length - 4, y: 0.06, z: 0.18 }, MATERIALS.softLight);
  }
  for (const x of [xStart + 10, xEnd - 10]) {
    // Hung well below the ceiling so the ceiling right above doesn't blow out to white.
    const lamp = new THREE.PointLight(0xffd7a0, 12, 30, 1.6);
    lamp.position.set(x, height - 3, 0);
    scene.add(lamp);
  }
}

// The outside of the range hall: pilasters down its long sides, a plinth and a deep
// fascia, louvres high up, a portal and canopy round the door with the hall's name over
// it, and air handlers on the roof. (Inside is untouched.)
function rangeExterior(scene: THREE.Object3D, world: RAPIER.World) {
  const { xStart, xEnd, halfWidth, height } = RANGE;
  const t = 0.6;
  const center = new THREE.Vector3((xStart + xEnd) / 2, 0, 0);
  const halfLength = (xEnd - xStart) / 2 + t;
  const sides = [
    { face: new Face(scene, world, center, new THREE.Vector3(0, 0, 1), halfWidth + t), width: halfLength * 2, front: false },
    { face: new Face(scene, world, center, new THREE.Vector3(0, 0, -1), halfWidth + t), width: halfLength * 2, front: false },
    { face: new Face(scene, world, center, new THREE.Vector3(1, 0, 0), halfLength), width: (halfWidth + t) * 2, front: false },
    { face: new Face(scene, world, center, new THREE.Vector3(-1, 0, 0), halfLength), width: (halfWidth + t) * 2, front: true },
  ];
  for (const { face, width, front } of sides) {
    const half = width / 2;
    face.box(MATERIALS.graphite, -half - 0.05, half + 0.05, 0, 0.5, -0.02, 0.06);
    face.box(MATERIALS.graphite, -half - 0.2, half + 0.2, height - 0.5, height + 0.6, -0.02, 0.2);
    face.glow(MATERIALS.amberLight, -half, half, height - 0.54, height - 0.5, 0.12, 0.18);
    const bays = Math.max(1, Math.round(width / 4));
    for (let j = 0; j <= bays; j++) {
      const sAt = -half + (width * j) / bays;
      if (!(front && Math.abs(sAt) < 4.2)) face.box(MATERIALS.graphite, sAt - 0.25, sAt + 0.25, 0, height - 0.5, -0.02, 0.32);
      if (j === bays) continue;
      const mid = sAt + width / bays / 2;
      if (front && Math.abs(mid) < 4.5) continue;
      // Louvres high up in each bay.
      face.box(MATERIALS.shadow, mid - 1.3, mid + 1.3, height - 2.2, height - 0.9, -0.02, 0.02);
      for (let y = height - 2.1; y < height - 0.95; y += 0.22) face.box(MATERIALS.trim, mid - 1.25, mid + 1.25, y, y + 0.05, 0.02, 0.12);
    }
    if (front) {
      // The portal round the door, a canopy, and the hall's name.
      face.box(MATERIALS.graphite, -3.7, -3.0, 0, 4.6, -0.02, 0.7, true);
      face.box(MATERIALS.graphite, 3.0, 3.7, 0, 4.6, -0.02, 0.7, true);
      face.box(MATERIALS.graphite, -4.2, 4.2, 4.0, 4.6, -0.02, 2.6, true);
      face.glow(MATERIALS.softLight, -3.6, 3.6, 3.97, 4.0, 0.9, 2.3);
      face.glow(MATERIALS.amberLight, -4.2, 4.2, 4.0, 4.04, 2.6, 2.64);
      const sign = signPanel('Firing range 01', 0.42, 'amber');
      sign.position.copy(face.at(0, 5.3, 0.08));
      sign.rotation.y = face.yaw;
      scene.add(sign);
    }
  }
  // Air handlers on the roof.
  for (const x of [xStart + 9, xEnd - 9]) {
    solidBox(scene, world, { x, y: height + 1.0, z: 3 }, { x: 3.2, y: 1.2, z: 1.8 }, MATERIALS.lightPanel);
    for (const dx of [-0.8, 0.8]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20), MATERIALS.graphite);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x + dx, height + 1.62, 3);
      scene.add(rim);
      const blades = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 16), MATERIALS.shadow);
      blades.position.set(x + dx, height + 1.59, 3);
      scene.add(blades);
    }
  }
}
