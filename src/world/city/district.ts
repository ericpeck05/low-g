import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { domeCeiling } from './dome';
import { Face, RECESS } from './facade';
import type { GlassBatch } from './glass';
import { MATERIALS, lightStrip, solidBox } from './kit';
import { BLOCKS, type Block, DISTRICT_START, type Kind, RING_ROAD, blockHeight } from './layout';
import { Bollards, type Greenery, LampPosts, bench, planter, rover } from './props';
import { signPanel } from './signs';
import type { RoomStyle, WindowBatch } from './windows';

// The outer district: a ring of low buildings between the ring road and the dome wall.
// Homes, a row of shops, greenhouses and a life-support plant, with alleys between them.
// Each building is a solid box for collision and movement; what you see is built up
// from real parts: shopfronts, windows into rooms, floor bands, parapets, canopies,
// signs and rooftop machinery.

const PARAPET = 0.9;

export function buildDistrict(scene: THREE.Object3D, world: RAPIER.World, windows: WindowBatch, green: Greenery, glass: GlassBatch) {
  const lamps = new LampPosts();
  const bollards = new Bollards();
  BLOCKS.forEach((block, i) => {
    const b = THREE.MathUtils.degToRad(block.bearing);
    const out = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
    const center = out.clone().multiplyScalar(DISTRICT_START + block.depth / 2);
    const front = out.clone().negate();
    const lot = { center, front, width: block.width, depth: block.depth };
    if (block.kind === 'hydro') greenhouse(scene, world, lot, block, glass, green);
    else building(scene, world, windows, lot, block, i);

    // Along the sidewalk in front: a lamp, and a planter or bollards beside the door.
    const side = new THREE.Vector3(front.z, 0, -front.x);
    const curb = out.clone().multiplyScalar(DISTRICT_START - 1.2);
    const lamp = curb.clone().addScaledVector(side, block.width / 2 - 1);
    lamps.add(world, lamp.x, lamp.z, Math.atan2(-out.x, -out.z));
    if (i % 2 === 0) {
      const p = curb.clone().addScaledVector(side, -block.width / 2 + 2.2).addScaledVector(out, 0.1);
      planter(scene, world, green, p.x, p.z, 3, 1.1, Math.atan2(side.x, side.z) + Math.PI / 2, false);
      const seat = curb.clone().addScaledVector(side, -block.width / 2 + 4.9).addScaledVector(out, 0.3);
      bench(scene, world, seat.x, seat.z, Math.atan2(-out.x, -out.z), 2.0);
    } else {
      for (const s of [-2.2, -3.4]) {
        const p = curb.clone().addScaledVector(side, s);
        bollards.add(world, p.x, p.z);
      }
    }
  });
  lamps.build(scene);
  bollards.build(scene);

  // Rovers parked along the outer curb of the ring road.
  for (const bearing of [118, 205, 335]) {
    const b = THREE.MathUtils.degToRad(bearing);
    const r = RING_ROAD.outer - 1.7;
    rover(scene, world, Math.sin(b) * r, Math.cos(b) * r, b + Math.PI / 2);
  }
}

interface Lot {
  center: THREE.Vector3;
  front: THREE.Vector3; // the way the front faces (toward the city center)
  width: number;
  depth: number;
}

/** The faces of a box-shaped lot: front, back, left, right, each with its width. */
function faces(scene: THREE.Object3D, world: RAPIER.World, lot: Lot) {
  const side = new THREE.Vector3(lot.front.z, 0, -lot.front.x);
  return [
    { face: new Face(scene, world, lot.center, lot.front.clone(), lot.depth / 2), width: lot.width, which: 'front' },
    { face: new Face(scene, world, lot.center, lot.front.clone().negate(), lot.depth / 2), width: lot.width, which: 'back' },
    { face: new Face(scene, world, lot.center, side.clone(), lot.width / 2), width: lot.depth, which: 'side' },
    { face: new Face(scene, world, lot.center, side.clone().negate(), lot.width / 2), width: lot.depth, which: 'side' },
  ];
}

// How the buildings of each kind look.
const STYLE: Record<Exclude<Kind, 'hydro'>, { floors: number; ground: number; floorHeight: number; room: RoomStyle; bay: number; sill: number; head: number; band: THREE.Material; pier: THREE.Material }> = {
  hab: { floors: 2, ground: 4, floorHeight: 3.6, room: 'home', bay: 1.6, sill: 0.9, head: 0.5, band: MATERIALS.facade, pier: MATERIALS.facade },
  shops: { floors: 1, ground: 4.4, floorHeight: 3.8, room: 'office', bay: 2.2, sill: 0.5, head: 0.4, band: MATERIALS.graphite, pier: MATERIALS.graphite },
  utility: { floors: 1, ground: 5, floorHeight: 4, room: 'office', bay: 3, sill: 0, head: 0, band: MATERIALS.graphite, pier: MATERIALS.graphite },
};

function building(scene: THREE.Object3D, world: RAPIER.World, windows: WindowBatch, lot: Lot, block: Block, index: number) {
  const style = STYLE[block.kind as Exclude<Kind, 'hydro'>];
  const height = blockHeight(block.kind);
  // Never into the dome glass: check the back corners against the ceiling.
  const backCorner = Math.hypot(DISTRICT_START + lot.depth, lot.width / 2);
  if (domeCeiling(backCorner) < height + PARAPET + 2) console.warn(`District: ${block.sign} is too tall for its spot under the dome.`);
  const yaw = Math.atan2(lot.front.x, lot.front.z);

  // Collision: the whole box. Drawn: a core just behind the glass, roofed in concrete.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(lot.width / 2, height / 2, lot.depth / 2)
      .setTranslation(lot.center.x, height / 2, lot.center.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)),
  );
  const inset = (RECESS + 0.02) * 2;
  solidBox(scene, world, { x: lot.center.x, y: height / 2, z: lot.center.z }, { x: lot.width - inset, y: height, z: lot.depth - inset }, MATERIALS.graphite, yaw, false);
  solidBox(scene, world, { x: lot.center.x, y: height, z: lot.center.z }, { x: lot.width - inset, y: 0.04, z: lot.depth - inset }, MATERIALS.concrete, yaw, false);

  const back = -RECESS - 0.02;
  for (const { face, width, which } of faces(scene, world, lot)) {
    const half = width / 2;
    face.box(MATERIALS.graphite, -half, half, 0, 0.3, back, 0.04);
    if (block.kind === 'utility') {
      utilityWall(face, half, height, which === 'front');
    } else {
      // Ground floor: shopfronts on the front of shops (and the middle of the homes' front), windows elsewhere.
      const shopfront = which === 'front';
      const groundTop = style.ground - 0.6;
      const panes = Math.max(1, Math.round((width - 0.8) / (shopfront ? 1.7 : style.bay + 0.4)));
      for (let j = 0; j < panes; j++) {
        const s0 = -half + 0.4 + ((width - 0.8) * j) / panes;
        const s1 = -half + 0.4 + ((width - 0.8) * (j + 1)) / panes;
        if (shopfront) face.window(windows, s0 + 0.05, s1 - 0.05, 0.3, groundTop, index * 131 + j * 0.37 + 0.5, 'shop');
        else face.window(windows, s0 + 0.2, s1 - 0.2, 1.0, groundTop - 0.3, index * 131 + 40 + j, style.room);
        face.box(MATERIALS.graphite, s1 - 0.06, s1 + 0.06, 0.3, groundTop, back, 0);
      }
      if (!shopfront) {
        face.box(style.pier, -half, half, 0.3, 1.0, back, 0.02);
        face.box(style.pier, -half, half, groundTop - 0.3, groundTop, back, 0.02);
        for (let j = 0; j <= panes; j++) {
          const s = -half + 0.4 + ((width - 0.8) * j) / panes;
          face.box(style.pier, s - 0.2, s + 0.2, 1.0, groundTop - 0.3, back, 0.02);
        }
      }
      face.box(MATERIALS.graphite, -half, half, groundTop, style.ground, back, 0.1);
      face.glow(MATERIALS.amberLight, -half + 0.2, half - 0.2, groundTop, groundTop + 0.04, 0.1, 0.12);

      // Floors above.
      const bays = Math.max(1, Math.round((width - 0.8) / style.bay));
      for (let f = 0; f <= style.floors; f++) {
        const line = style.ground + f * style.floorHeight;
        const y0 = f === 0 ? style.ground : line - style.head;
        const y1 = f === style.floors ? height + PARAPET : line + style.sill;
        face.box(f === style.floors ? MATERIALS.facade : style.band, -half, half, y0, y1, back, 0.06, f === style.floors);
        if (f === style.floors) break;
        for (let j = 0; j < bays; j++) {
          const s0 = -half + 0.4 + ((width - 0.8) * j) / bays + 0.11;
          const s1 = -half + 0.4 + ((width - 0.8) * (j + 1)) / bays - 0.11;
          face.window(windows, s0, s1, line + style.sill, line + style.floorHeight - style.head, index * 131 + 60 + f * 17 + Math.floor(j / 2), style.room);
        }
      }
      for (let j = 0; j <= bays; j++) {
        const s = -half + 0.4 + ((width - 0.8) * j) / bays;
        const w = j === 0 || j === bays ? 0.5 : 0.11;
        face.box(style.pier, s - w, s + w, style.ground, height - style.head, back, 0.02);
      }
      face.glow(MATERIALS.amberLight, -half + 0.1, half - 0.1, height - 0.3, height - 0.22, 0.06, 0.09);
    }

    if (which === 'front') {
      // A canopy over the entrance, lit underneath, and the building's name.
      const canopyWidth = block.kind === 'shops' ? half - 0.3 : 2.2;
      const canopyY = block.kind === 'utility' ? 5.6 : style.ground - 0.62;
      face.box(MATERIALS.graphite, -canopyWidth, canopyWidth, canopyY - 0.16, canopyY, 0.1, 2.0, true);
      face.glow(MATERIALS.softLight, -canopyWidth + 0.3, canopyWidth - 0.3, canopyY - 0.19, canopyY - 0.16, 0.6, 1.6);
      const sign = signPanel(block.sign, block.kind === 'shops' ? 0.42 : 0.34, block.kind === 'hab' ? 'white' : 'amber');
      sign.position.copy(face.at(0, canopyY + 0.36, 0.12));
      sign.rotation.y = face.yaw;
      scene.add(sign);
    }
  }

  // Corner columns.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const side = new THREE.Vector3(lot.front.z, 0, -lot.front.x);
      const c = lot.center.clone().addScaledVector(side, sx * (lot.width / 2 - 0.25)).addScaledVector(lot.front, sz * (lot.depth / 2 - 0.25));
      solidBox(scene, world, { x: c.x, y: (height + PARAPET + 0.1) / 2, z: c.z }, { x: 0.56, y: height + PARAPET + 0.1, z: 0.56 }, MATERIALS.facade, yaw, false);
    }
  }
  roofGear(scene, world, lot, height, index);
}

// Life support and power: solid walls with tall louvre panels, a big service door on the front.
function utilityWall(face: Face, half: number, height: number, front: boolean) {
  const back = -RECESS - 0.02;
  face.box(MATERIALS.graphite, -half, half, 0.3, height + PARAPET, back, 0.02, true);
  const panels = Math.max(1, Math.floor((half * 2 - 1) / 3));
  for (let j = 0; j < panels; j++) {
    const s = -half + 0.5 + ((half * 2 - 1) * (j + 0.5)) / panels;
    if (front && s > -2.6 && s < 6) continue; // the door goes here, and a Siege weapon station beside it
    face.box(MATERIALS.shadow, s - 1.1, s + 1.1, 1.2, height - 1.2, 0.02, 0.05);
    for (let y = 1.35; y < height - 1.3; y += 0.32) face.box(MATERIALS.trim, s - 1.05, s + 1.05, y, y + 0.06, 0.05, 0.16);
  }
  face.box(MATERIALS.facade, -half, half, height - 0.9, height + PARAPET, back, 0.08);
  face.glow(MATERIALS.amberLight, -half + 0.1, half - 0.1, height - 0.95, height - 0.9, 0.06, 0.09);
  if (front) {
    // A roll-up service door with a hazard-striped frame.
    face.box(MATERIALS.lightPanel, -2.2, 2.2, 0.3, 4.6, 0.02, 0.1);
    for (let y = 0.5; y < 4.5; y += 0.3) face.box(MATERIALS.trim, -2.15, 2.15, y, y + 0.05, 0.1, 0.13);
    face.box(MATERIALS.orangeLight, -2.5, -2.2, 0.3, 4.9, 0.02, 0.12);
    face.box(MATERIALS.orangeLight, 2.2, 2.5, 0.3, 4.9, 0.02, 0.12);
    face.box(MATERIALS.orangeLight, -2.5, 2.5, 4.6, 4.9, 0.02, 0.12);
  }
}

// Air handlers, vents and a mast on the roof.
function roofGear(scene: THREE.Object3D, world: RAPIER.World, lot: Lot, height: number, index: number) {
  const side = new THREE.Vector3(lot.front.z, 0, -lot.front.x);
  const yaw = Math.atan2(lot.front.x, lot.front.z);
  const at = (across: number, back: number) => lot.center.clone().addScaledVector(side, across).addScaledVector(lot.front, -back);
  const unit = at(lot.width * (index % 2 ? 0.2 : -0.2), lot.depth * 0.15);
  solidBox(scene, world, { x: unit.x, y: height + 0.6, z: unit.z }, { x: 3.2, y: 1.2, z: 1.8 }, MATERIALS.lightPanel, yaw);
  for (const s of [-0.8, 0.8]) {
    const fan = unit.clone().addScaledVector(side, s);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 6, 20), MATERIALS.graphite);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(fan.x, height + 1.22, fan.z);
    scene.add(rim);
    const blades = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 16), MATERIALS.shadow);
    blades.position.set(fan.x, height + 1.19, fan.z);
    scene.add(blades);
  }
  for (const s of [-0.35, 0.05, 0.3]) {
    const vent = at(lot.width * s, -lot.depth * 0.2);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.0, 10), MATERIALS.trim);
    pipe.position.set(vent.x, height + 0.5, vent.z);
    pipe.castShadow = true;
    scene.add(pipe);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.12, 10), MATERIALS.graphite);
    cap.position.set(vent.x, height + 1.06, vent.z);
    scene.add(cap);
  }
  if (index % 3 === 0) {
    const mast = at(-lot.width * 0.38, lot.depth * 0.3);
    solidBox(scene, world, { x: mast.x, y: height + 1.6, z: mast.z }, { x: 0.1, y: 3.2, z: 0.1 }, MATERIALS.darkMetal, 0, false);
    lightStrip(scene, { x: mast.x, y: height + 3.25, z: mast.z }, { x: 0.15, y: 0.15, z: 0.15 }, MATERIALS.orangeLight);
  }
}

// ---- Greenhouses ----

const GLASS_RIB = 2; // meters between the arches

// A long glass vault over beds of plants under warm grow lights, on a low wall.
function greenhouse(scene: THREE.Object3D, world: RAPIER.World, lot: Lot, block: Block, glass: GlassBatch, green: Greenery) {
  const side = new THREE.Vector3(lot.front.z, 0, -lot.front.x);
  const yaw = Math.atan2(lot.front.x, lot.front.z);
  const wall = 1.2;
  const radius = lot.depth / 2;
  const length = lot.width;
  const top = wall + radius;
  // Collision: the low wall all round, and a box roughly the shape of the vault.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(length / 2, (wall + radius * 0.82) / 2, radius)
      .setTranslation(lot.center.x, (wall + radius * 0.82) / 2, lot.center.z)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)),
  );
  // Low walls.
  for (const { face, width } of faces(scene, world, lot)) {
    face.box(MATERIALS.facade, -width / 2, width / 2, 0, wall, -0.3, 0.05);
    face.box(MATERIALS.graphite, -width / 2, width / 2, wall - 0.08, wall + 0.04, -0.32, 0.08);
  }
  // The vault: a half cylinder lying along the lot, glass between dark arches.
  const vault = new THREE.CylinderGeometry(radius, radius, length, 32, 1, true, 0, Math.PI);
  vault.rotateZ(Math.PI / 2); // lie along x, open side down
  vault.rotateY(yaw);
  vault.translate(lot.center.x, wall, lot.center.z);
  glass.add(vault);
  for (const end of [-1, 1]) {
    const cap = new THREE.CircleGeometry(radius, 32, 0, Math.PI);
    cap.rotateY(Math.PI / 2 + yaw);
    const at = lot.center.clone().addScaledVector(side, end * length / 2);
    cap.translate(at.x, wall, at.z);
    glass.add(cap);
  }
  for (let s = -length / 2; s <= length / 2 + 0.01; s += GLASS_RIB) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 6, 28, Math.PI), MATERIALS.graphite);
    const at = lot.center.clone().addScaledVector(side, s);
    rib.position.set(at.x, wall, at.z);
    rib.rotation.set(0, yaw + Math.PI / 2, 0);
    rib.castShadow = true;
    scene.add(rib);
  }
  // Ridge beam and the grow lights hung under it.
  const ridge = lot.center.clone();
  solidBox(scene, world, { x: ridge.x, y: top - 0.05, z: ridge.z }, { x: length, y: 0.12, z: 0.16 }, MATERIALS.graphite, yaw, false);
  for (const across of [-1.8, 0, 1.8]) {
    const at = lot.center.clone().addScaledVector(lot.front, across);
    lightStrip(scene, { x: at.x, y: top - 1.5 - Math.abs(across) * 0.5, z: at.z }, { x: 0.12, y: 0.05, z: length - 2 }, MATERIALS.softLight, yaw + Math.PI / 2);
  }
  // Beds of plants down the length, with a path between.
  for (const across of [-radius * 0.55, radius * 0.55]) {
    const at = lot.center.clone().addScaledVector(lot.front, across);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(length - 1.5, 0.7, radius * 0.6), MATERIALS.trim);
    bed.position.set(at.x, 0.35, at.z);
    bed.rotation.y = yaw;
    bed.receiveShadow = true;
    scene.add(bed);
    for (let s = -length / 2 + 1.3; s < length / 2 - 1; s += 0.9) {
      const plant = at.clone().addScaledVector(side, s);
      green.shrub(plant.x, 0.7, plant.z);
    }
  }
  // The name over the door, on the front wall.
  const sign = signPanel(block.sign, 0.34, 'amber');
  const front = lot.center.clone().addScaledVector(lot.front, radius + 0.1);
  sign.position.set(front.x, wall - 0.5, front.z);
  sign.rotation.y = yaw;
  scene.add(sign);
}
