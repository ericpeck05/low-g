import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { ANTENNAS, LANDING_PAD, MODULES_CENTER, SOLAR_FIELD } from './layout';
import { MATERIALS, lightStrip, pavingTexture, solidBox, solidCylinder, solidTiltedBox, solidTube } from './kit';

// Everything outside the dome: the landing pad and lander, solar arrays,
// habitat modules joined by tubes, and antenna masts. Returns an update
// function for the few things that animate (blinking lights).
export function buildExterior(scene: THREE.Scene, world: RAPIER.World) {
  buildLandingPad(scene, world);
  buildSolarField(scene, world);
  buildModules(scene, world);
  const blinkers = ANTENNAS.map((a) => buildAntenna(scene, world, a.x, a.z, a.height));

  let time = 0;
  return {
    update(dt: number) {
      time += dt;
      blinkers.forEach((material, i) => {
        // Each mast blinks on its own beat.
        material.emissiveIntensity = Math.sin(time * 2.2 + i * 1.7) > 0.7 ? 5 : 0.15;
      });
    },
  };
}

function buildLandingPad(scene: THREE.Scene, world: RAPIER.World) {
  const { x, z, radius } = LANDING_PAD;
  // Low enough (0.3 m) to step onto.
  const top = new THREE.MeshStandardMaterial({ map: padMarkings(), roughness: 0.8 });
  solidCylinder(scene, world, x, 0, z, radius, 0.3, [MATERIALS.trim, top, MATERIALS.trim], 48);
  // Edge lights.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lightStrip(scene, { x: x + Math.sin(a) * (radius - 0.4), y: 0.36, z: z + Math.cos(a) * (radius - 0.4) }, { x: 0.3, y: 0.1, z: 0.3 }, MATERIALS.amberLight);
  }

  // Paved path from the south airlock to the pad.
  const pathStart = CONFIG.city.domeRadius + 9;
  const pathEnd = z - radius;
  const texture = pavingTexture();
  texture.repeat.set(6 / 8, (pathEnd - pathStart) / 8);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(6, pathEnd - pathStart), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 }));
  path.rotation.x = -Math.PI / 2;
  path.position.set(x, 0.012, (pathStart + pathEnd) / 2);
  path.receiveShadow = true;
  scene.add(path);

  // A parked lander: a squat body on four legs with a cone on top.
  const lx = x + 3;
  const lz = z - 2;
  solidCylinder(scene, world, lx, 2.3, lz, 3, 3.6, [MATERIALS.lightPanel, MATERIALS.trim, MATERIALS.trim], 8);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.4, 8), MATERIALS.lightPanel);
  cone.position.set(lx, 7.1, lz);
  cone.castShadow = true;
  scene.add(cone);
  lightStrip(scene, { x: lx, y: 4.1, z: lz }, { x: 6.1, y: 0.2, z: 0.2 }, MATERIALS.amberLight);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const foot = new THREE.Vector3(lx + Math.sin(a) * 4.2, 0.3, lz + Math.cos(a) * 4.2);
    const hip = new THREE.Vector3(lx + Math.sin(a) * 2.6, 2.8, lz + Math.cos(a) * 2.6);
    solidTube(scene, world, foot, hip, 0.15, MATERIALS.darkMetal);
    solidCylinder(scene, world, foot.x, 0.3, foot.z, 0.6, 0.15, MATERIALS.darkMetal, 12);
  }

  // Cargo containers beside the pad: cover, and something to jump onto.
  // [x, z, turn in radians, level: 0 on the ground, 1 stacked on top]
  const containers: [number, number, number, number][] = [
    [-24, 120.75, 0, 0],
    [-24, 123.25, 0, 0],
    [-24, 122, 0, 1],
    [24, 136, 0.3, 0],
    [27, 120, 1.2, 0],
    [-14, 146, 0.8, 0],
  ];
  for (const [cx, cz, yaw, level] of containers) {
    solidBox(scene, world, { x: cx, y: 1.3 + level * 2.6, z: cz }, { x: 6, y: 2.6, z: 2.5 }, MATERIALS.lightPanel, yaw);
  }
}

function buildSolarField(scene: THREE.Scene, world: RAPIER.World) {
  const { xStart, rows, rowSpacing, halfLength } = SOLAR_FIELD;
  const tilt = THREE.MathUtils.degToRad(40);
  const material = new THREE.MeshStandardMaterial({ map: solarCells(), roughness: 0.35, metalness: 0.4 });
  material.map!.repeat.set(1, (halfLength * 2) / 4);
  for (let r = 0; r < rows; r++) {
    const x = xStart - r * rowSpacing;
    // Rows run north to south and lean toward the sun in the east.
    solidTiltedBox(scene, world, new THREE.Vector3(x, 2.2, 0), { x: 3.6, y: 0.12, z: halfLength * 2 }, new THREE.Euler(0, 0, -tilt), material);
    for (let z = -halfLength + 2; z <= halfLength - 2; z += 8) {
      solidBox(scene, world, { x, y: 1.05, z }, { x: 0.2, y: 2.1, z: 0.2 }, MATERIALS.darkMetal);
    }
  }
}

function buildModules(scene: THREE.Scene, world: RAPIER.World) {
  const { x: cx, z: cz } = MODULES_CENTER;
  const y = 4.5;
  // [center x, center z, runs along x?, length]
  const modules: [number, number, boolean, number][] = [
    [cx - 8, cz - 10, true, 14],
    [cx + 12, cz + 4, false, 14],
    [cx - 10, cz + 12, false, 12],
    [cx + 14, cz - 18, true, 12],
  ];
  const centers = modules.map(([mx, mz]) => new THREE.Vector3(mx, y, mz));

  for (const [mx, mz, alongX, length] of modules) {
    const half = alongX ? new THREE.Vector3(length / 2, 0, 0) : new THREE.Vector3(0, 0, length / 2);
    const center = new THREE.Vector3(mx, y, mz);
    solidTube(scene, world, center.clone().sub(half), center.clone().add(half), 3, MATERIALS.lightPanel);
    // A band of lit windows around the middle and amber stripes near the ends.
    for (const [offset, material, width] of [
      [0, MATERIALS.whiteLight, 1.2],
      [0.4, MATERIALS.amberLight, 0.3],
      [-0.4, MATERIALS.amberLight, 0.3],
    ] as [number, THREE.Material, number][]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(3.03, 3.03, width, 24, 1, true), material);
      band.position.copy(center).addScaledVector(half, offset * 2);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), half.clone().normalize());
      scene.add(band);
    }
    // Four legs.
    for (const along of [-0.35, 0.35]) {
      for (const across of [-1.8, 1.8]) {
        const leg = center.clone().addScaledVector(half, along * 2);
        if (alongX) leg.z += across;
        else leg.x += across;
        solidBox(scene, world, { x: leg.x, y: 0.9, z: leg.z }, { x: 0.35, y: 1.8, z: 0.35 }, MATERIALS.darkMetal);
      }
    }
  }

  // Pressurized tubes between modules (they run center to center; the ends hide inside).
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 3],
    [0, 3],
  ]) {
    solidTube(scene, world, centers[a], centers[b], 1.3, MATERIALS.concrete);
  }
}

// A lattice mast with a dish on top and a blinking warning light. Returns the light's material.
function buildAntenna(scene: THREE.Scene, world: RAPIER.World, x: number, z: number, height: number) {
  const half = 0.8;
  for (const [dx, dz] of [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]) {
    solidBox(scene, world, { x: x + dx, y: height / 2, z: z + dz }, { x: 0.12, y: height, z: 0.12 }, MATERIALS.darkMetal, 0, false);
  }
  for (let y = 2; y < height; y += 3) {
    solidBox(scene, world, { x, y, z: z - half }, { x: half * 2, y: 0.08, z: 0.08 }, MATERIALS.darkMetal, 0, false);
    solidBox(scene, world, { x, y, z: z + half }, { x: half * 2, y: 0.08, z: 0.08 }, MATERIALS.darkMetal, 0, false);
    solidBox(scene, world, { x: x - half, y, z }, { x: 0.08, y: 0.08, z: half * 2 }, MATERIALS.darkMetal, 0, false);
    solidBox(scene, world, { x: x + half, y, z }, { x: 0.08, y: 0.08, z: half * 2 }, MATERIALS.darkMetal, 0, false);
  }
  // One simple solid block stands in for the whole lattice.
  world.createCollider(RAPIER.ColliderDesc.cuboid(half + 0.1, height / 2, half + 0.1).setTranslation(x, height / 2, z));

  // Dish: an open bowl tipped toward the Earth.
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(2.6, 24, 8, 0, Math.PI * 2, 0, 0.75),
    new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 0.5, side: THREE.DoubleSide }),
  );
  dish.position.set(x, height + 1.6, z);
  dish.rotation.x = Math.PI; // open side up
  dish.rotation.z = 0.5;
  dish.castShadow = true;
  scene.add(dish);

  const blink = MATERIALS.orangeLight.clone();
  lightStrip(scene, { x, y: height + 0.3, z }, { x: 0.35, y: 0.35, z: 0.35 }, blink);
  return blink;
}

// Landing pad paint: dark deck, amber outer ring, white aiming circle and cross.
function padMarkings() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  ctx.fillStyle = '#4b4844';
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#ffa31a';
  ctx.beginPath();
  ctx.arc(c, c, c * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ece6da';
  ctx.beginPath();
  ctx.arc(c, c, c * 0.45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ece6da';
  ctx.fillRect(c - 6, c - c * 0.7, 12, c * 1.4);
  ctx.fillRect(c - c * 0.7, c - 6, c * 1.4, 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Dark solar cells in a grid with thin warm-gray lines (no blue-tinted panels here).
function solarCells() {
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#7a756d';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1c1b1a';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
