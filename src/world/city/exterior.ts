import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { ANTENNAS, LANDING_PAD, MODULES_CENTER, SOLAR_FIELD } from './layout';
import { MATERIALS, type Placement, boxCollider, instanced, lightStrip, pavingTexture, solidBox, solidCylinder, solidTube } from './kit';

// Everything outside the dome: the landing pad and lander, solar arrays,
// habitat modules joined by tubes, and antenna masts. Returns an update
// function for the few things that animate (blinking lights).
export function buildExterior(scene: THREE.Object3D, world: RAPIER.World) {
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

function buildLandingPad(scene: THREE.Object3D, world: RAPIER.World) {
  const { x, z, radius } = LANDING_PAD;
  // Low enough (0.3 m) to step onto.
  const top = new THREE.MeshStandardMaterial({ map: padMarkings(), roughness: 0.8 });
  solidCylinder(scene, world, x, 0, z, radius, 0.3, [MATERIALS.trim, top, MATERIALS.trim], 48);
  // Edge lights, drawn as one batch.
  const lights: Placement[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lights.push({ position: { x: x + Math.sin(a) * (radius - 0.4), y: 0.36, z: z + Math.cos(a) * (radius - 0.4) } });
  }
  instanced(scene, new THREE.BoxGeometry(0.3, 0.1, 0.3), MATERIALS.amberLight, lights, false);

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

  buildLander(scene, world, x + 3, z - 2);

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

// A parked lander, like the real ones: a gold-foil-wrapped descent stage on four
// sprung legs, a white crew cabin on top with windows, thruster pods and an engine bell.
function buildLander(scene: THREE.Object3D, world: RAPIER.World, lx: number, lz: number) {
  const base = 0.3; // the pad deck
  // Descent stage: an octagonal box in foil.
  solidCylinder(scene, world, lx, base + 1.8, lz, 2.6, 1.8, [MATERIALS.foil, MATERIALS.trim, MATERIALS.trim], 8);
  // Engine bell underneath.
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, 1.0, 24, 1, true), MATERIALS.darkMetal);
  bell.position.set(lx, base + 1.35, lz);
  scene.add(bell);
  // Crew cabin: white panels, two dark windows and a hatch.
  solidCylinder(scene, world, lx, base + 3.6, lz, 1.9, 2.2, [MATERIALS.lightPanel, MATERIALS.trim, MATERIALS.trim], 6);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.05, metalness: 0.2 });
  for (const angle of [-0.35, 0.35]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.5), glass);
    const a = Math.PI + angle; // facing the dome
    pane.position.set(lx + Math.sin(a) * 1.72, base + 5.0, lz + Math.cos(a) * 1.72);
    pane.rotation.y = a;
    scene.add(pane);
  }
  solidBox(scene, world, { x: lx, y: base + 4.4, z: lz - 1.78 }, { x: 0.9, y: 1.2, z: 0.12 }, MATERIALS.trim);
  // Docking ring and antenna on top.
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 20), MATERIALS.trim);
  ring.position.set(lx, base + 6.0, lz);
  ring.castShadow = true;
  scene.add(ring);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, 0.8), new THREE.MeshStandardMaterial({ color: 0xe6e0d6, roughness: 0.5, side: THREE.DoubleSide }));
  dish.position.set(lx + 1.2, base + 6.2, lz + 0.6);
  dish.rotation.set(Math.PI, 0, 0.6);
  scene.add(dish);
  // Thruster pods at four corners of the cabin.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    solidBox(scene, world, { x: lx + Math.sin(a) * 2.0, y: base + 4.0, z: lz + Math.cos(a) * 2.0 }, { x: 0.35, y: 0.35, z: 0.35 }, MATERIALS.darkMetal);
  }
  // Legs: a main strut and a brace to each round footpad, and a ladder on the front leg.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const foot = new THREE.Vector3(lx + Math.sin(a) * 4.4, base + 0.15, lz + Math.cos(a) * 4.4);
    const hip = new THREE.Vector3(lx + Math.sin(a) * 2.4, base + 3.3, lz + Math.cos(a) * 2.4);
    const knee = new THREE.Vector3(lx + Math.sin(a) * 2.5, base + 1.9, lz + Math.cos(a) * 2.5);
    solidTube(scene, world, foot, hip, 0.11, MATERIALS.foil);
    solidTube(scene, world, foot.clone().setY(base + 0.4), knee, 0.06, MATERIALS.darkMetal);
    const pad = solidCylinder(scene, world, foot.x, base, foot.z, 0.55, 0.12, MATERIALS.foil, 16);
    pad.receiveShadow = true;
  }
}

// Rows of solar panels on legs. Every panel is a copy of the same shape, so the whole
// field (over 700 panels) is drawn in one batch.
function buildSolarField(scene: THREE.Object3D, world: RAPIER.World) {
  const { xStart, rows, rowSpacing, halfLength } = SOLAR_FIELD;
  const tilt = THREE.MathUtils.degToRad(40);
  const rowTilt = new THREE.Euler(0, 0, -tilt); // rows lean toward the sun in the east
  const panelWidth = 1.75; // up the slope; two panels make a row 3.5 m wide
  const panelLength = 1; // along the row
  const gap = 0.04;
  // Glass-covered cells: glossy, so the rows mirror the bright ground and glint in the sun.
  const cells = solarCells();
  cells.repeat.set(2.5, 1.5); // 10 x 6 cells per panel
  const glass = new THREE.MeshStandardMaterial({ map: cells, roughness: 0.12, metalness: 0.25 });

  const panels: Placement[] = [];
  const legs: Placement[] = [];
  for (let r = 0; r < rows; r++) {
    const x = xStart - r * rowSpacing;
    for (let z = -halfLength + panelLength / 2; z <= halfLength - panelLength / 2; z += panelLength + gap) {
      for (const side of [-1, 1]) {
        const offset = side * (panelWidth + gap) * 0.5; // up or down the slope
        panels.push({ position: { x: x + Math.cos(tilt) * offset, y: 2.2 - Math.sin(tilt) * offset, z }, rotation: rowTilt });
      }
    }
    // The rail the panels sit on, and one solid slab for walking and shooting into.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, halfLength * 2), MATERIALS.darkMetal);
    rail.position.set(x - Math.sin(tilt) * 0.09, 2.2 - Math.cos(tilt) * 0.09, 0);
    rail.rotation.copy(rowTilt);
    rail.castShadow = rail.receiveShadow = true;
    scene.add(rail);
    boxCollider(world, { x, y: 2.2, z: 0 }, { x: panelWidth * 2, y: 0.12, z: halfLength * 2 }, rowTilt);
    for (let z = -halfLength + 2; z <= halfLength - 2; z += 8) {
      legs.push({ position: { x, y: 1.05, z } });
      boxCollider(world, { x, y: 1.05, z }, { x: 0.2, y: 2.1, z: 0.2 });
    }
  }
  instanced(scene, new THREE.BoxGeometry(panelWidth, 0.05, panelLength), glass, panels);
  instanced(scene, new THREE.BoxGeometry(0.2, 2.1, 0.2), MATERIALS.darkMetal, legs);
}

function buildModules(scene: THREE.Object3D, world: RAPIER.World) {
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
function buildAntenna(scene: THREE.Object3D, world: RAPIER.World, x: number, z: number, height: number) {
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
