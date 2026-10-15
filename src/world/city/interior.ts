import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import {
  BALCONY_EXTRA,
  PLAZA_RADIUS,
  RANGE,
  TOWERS,
  type TowerSpec,
  towerPosition,
} from './layout';
import { MATERIALS, lightStrip, pavingTexture, solidBox, solidCylinder, solidTiltedBox, windowTextures } from './kit';

// Everything under the dome: paving, the central plaza and beacon, towers,
// the ring of walkways between them, ramps, lamps, and the indoor shooting range.
export function buildInterior(scene: THREE.Scene, world: RAPIER.World) {
  buildPaving(scene);
  buildPlaza(scene, world);
  TOWERS.forEach((tower, i) => buildTower(scene, world, tower, i));
  buildWalkways(scene, world);
  buildRange(scene, world);
}

function buildPaving(scene: THREE.Scene) {
  const radius = CONFIG.city.domeRadius - 0.6;
  const texture = pavingTexture();
  texture.repeat.set((radius * 2) / 8, (radius * 2) / 8); // 8 m per texture tile (four 2 m slabs)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012; // just above the flat ground underneath
  floor.receiveShadow = true;
  scene.add(floor);
}

function buildPlaza(scene: THREE.Scene, world: RAPIER.World) {
  // A low round platform (low enough to step onto) with a ring of light set into it.
  solidCylinder(scene, world, 0, 0, 0, PLAZA_RADIUS, 0.2, MATERIALS.concrete, 48);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_RADIUS - 1.5, 0.08, 6, 96), MATERIALS.amberLight);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.21;
  scene.add(ring);

  // The beacon: a tall dark obelisk banded with light. The city's landmark.
  solidCylinder(scene, world, 0, 0.2, 0, 1.3, 13, MATERIALS.darkMetal, 6);
  for (const y of [3, 6, 9, 12]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.36, 0.3, 6), MATERIALS.amberLight);
    band.position.y = y;
    scene.add(band);
  }
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), MATERIALS.whiteLight);
  cap.position.y = 14.4;
  scene.add(cap);
  const glow = new THREE.PointLight(0xffa31a, 25, 35, 1.6);
  glow.position.set(0, 7, 0);
  scene.add(glow);

  // Lamp posts around the plaza.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.sin(a) * (PLAZA_RADIUS + 3);
    const z = Math.cos(a) * (PLAZA_RADIUS + 3);
    solidBox(scene, world, { x, y: 2, z }, { x: 0.2, y: 4, z: 0.2 }, MATERIALS.darkMetal);
    lightStrip(scene, { x, y: 4.1, z }, { x: 0.6, y: 0.2, z: 0.6 }, MATERIALS.whiteLight);
  }

  // Benches facing the beacon.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.sin(a) * 9;
    const z = Math.cos(a) * 9;
    solidBox(scene, world, { x, y: 0.45, z }, { x: 3.2, y: 0.5, z: 0.8 }, MATERIALS.trim, a);
  }
}

function buildTower(scene: THREE.Scene, world: RAPIER.World, tower: TowerSpec, index: number) {
  const p = towerPosition(tower);
  const { map, emissiveMap } = windowTextures(20 + index);
  // About one texture tile (4 windows by 8 floors) per 10 m around and 28 m up.
  const around = (2 * Math.PI * tower.radius) / 10;
  map.repeat.set(around, tower.height / 28);
  emissiveMap.repeat.copy(map.repeat);
  const walls = new THREE.MeshStandardMaterial({
    map,
    emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 1.05,
    roughness: 0.6,
  });
  // Cylinder materials: [sides, top, bottom].
  solidCylinder(scene, world, p.x, 0, p.z, tower.radius, tower.height, [walls, MATERIALS.trim, MATERIALS.trim], tower.sides);

  // Roof: a parapet light ring and a small rooftop hut.
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(tower.radius + 0.05, tower.radius + 0.05, 0.25, tower.sides),
    MATERIALS.amberLight,
  );
  crown.position.set(p.x, tower.height - 0.4, p.z);
  scene.add(crown);
  solidBox(scene, world, { x: p.x, y: tower.height + 1.2, z: p.z }, { x: 2.5, y: 2.4, z: 2.5 }, MATERIALS.lightPanel);
  // A blinking-style marker light on the tall ones.
  if (tower.height > 25) lightStrip(scene, { x: p.x, y: tower.height + 2.6, z: p.z }, { x: 0.4, y: 0.4, z: 0.4 }, MATERIALS.orangeLight);

  // Balcony ring at walkway height, where the bridges meet the tower.
  const h = CONFIG.city.walkwayHeight;
  solidCylinder(scene, world, p.x, h - 0.4, p.z, tower.radius + BALCONY_EXTRA, 0.4, MATERIALS.concrete, 32);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(tower.radius + BALCONY_EXTRA, 0.06, 6, 48), MATERIALS.amberLight);
  edge.rotation.x = Math.PI / 2;
  edge.position.set(p.x, h + 0.02, p.z);
  scene.add(edge);
}

// Bridges between neighboring towers at walkway height, plus ramps up from the ground.
function buildWalkways(scene: THREE.Scene, world: RAPIER.World) {
  const h = CONFIG.city.walkwayHeight;
  for (let i = 0; i < TOWERS.length; i++) {
    const a = TOWERS[i];
    const b = TOWERS[(i + 1) % TOWERS.length];
    const pa = towerPosition(a);
    const pb = towerPosition(b);
    const direction = pb.clone().sub(pa);
    const distance = direction.length();
    direction.normalize();
    // Start and end at each balcony's edge, overlapping a little so there's no seam.
    const start = pa.clone().addScaledVector(direction, a.radius + BALCONY_EXTRA - 0.5);
    const end = pb.clone().addScaledVector(direction, -(b.radius + BALCONY_EXTRA - 0.5));
    const length = start.distanceTo(end);
    const middle = start.clone().add(end).multiplyScalar(0.5);
    const yaw = Math.atan2(direction.x, direction.z);
    if (length <= 0 || distance <= 0) continue;

    solidBox(scene, world, { x: middle.x, y: h - 0.2, z: middle.z }, { x: 4, y: 0.4, z: length }, MATERIALS.concrete, yaw);
    // Railings with a glowing top rail.
    const side = new THREE.Vector3(direction.z, 0, -direction.x);
    for (const s of [-1, 1]) {
      const rail = middle.clone().addScaledVector(side, s * 1.95);
      solidBox(scene, world, { x: rail.x, y: h + 0.5, z: rail.z }, { x: 0.1, y: 1, z: length }, MATERIALS.darkMetal, yaw);
      lightStrip(scene, { x: rail.x, y: h + 1.03, z: rail.z }, { x: 0.12, y: 0.06, z: length }, MATERIALS.amberLight, yaw);
    }
  }

  // Ramps from the plaza up to two of the balconies (18 degrees: an easy walk).
  for (const index of [0, 2]) {
    const tower = TOWERS[index];
    const p = towerPosition(tower);
    const inward = p.clone().negate().normalize();
    const angle = THREE.MathUtils.degToRad(18);
    const run = h / Math.tan(angle);
    const top = p.clone().addScaledVector(inward, tower.radius + BALCONY_EXTRA - 0.3).setY(h);
    const bottom = top.clone().addScaledVector(inward, run).setY(0);
    const length = top.distanceTo(bottom);
    const thickness = 0.4;
    const yaw = Math.atan2(top.x - bottom.x, top.z - bottom.z);
    // Center the slab so its top surface runs from the ground to the balcony.
    const center = top.clone().add(bottom).multiplyScalar(0.5);
    center.y -= (thickness / 2) / Math.cos(angle);
    solidTiltedBox(scene, world, center, { x: 4, y: thickness, z: length }, new THREE.Euler(-angle, yaw, 0, 'YXZ'), MATERIALS.concrete);
    // Light strips along the ramp's edges.
    const side = new THREE.Vector3(inward.z, 0, -inward.x);
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, length), MATERIALS.amberLight);
      strip.position.copy(center).addScaledVector(side, s * 1.95);
      strip.position.y += 0.25;
      strip.rotation.set(-angle, yaw, 0, 'YXZ');
      scene.add(strip);
    }
  }
}

// An enclosed hall with a doorway facing the plaza, a firing line, and lanes.
function buildRange(scene: THREE.Scene, world: RAPIER.World) {
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
  // Sign strip over the door.
  lightStrip(scene, { x: xStart - t - 0.02, y: 5.2, z: 0 }, { x: 0.05, y: 0.35, z: 5 }, MATERIALS.amberLight);

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
