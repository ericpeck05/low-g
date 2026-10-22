import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { TOWERS, type TowerSpec, towerPosition } from './layout';
import { Face, RECESS } from './facade';
import { MATERIALS, lightStrip, prismCollider, solidBox } from './kit';
import type { RoomStyle, WindowBatch } from './windows';

// The towers. Each one is built like a real building: a ground floor of shopfronts
// under a dark sign band, then floors of recessed windows between solid floor bands
// and piers (some with tall fins), corner columns, and a crown with a lit reveal and
// a parapet round the roof. On the roof: a stair hut, air handlers and a mast.
// The collision is the same simple prism as before, so nothing about moving around,
// the rooftop targets or the Siege spawn points changes.

const PODIUM = 4; // the shopfront floor, meters
const PARAPET = 0.9; // the low wall round the roof
const HANGAR_SHARE = 0.7; // tall towers' hangar bays sit this far up (see siege/spawnPoints.ts)

// How each tower looks: the window rhythm and which skins go where.
interface Look {
  bay: number; // about how wide each window is, meters
  band: THREE.Material; // the floor bands
  pier: THREE.Material; // the wall between windows
  corner: THREE.Material; // corner columns (prisms only)
  fin: THREE.Material | null; // full-height fins between windows
  finDepth: number; // how far the fins stand out
  roomSpan: number; // windows per room (they share their lighting)
  room: RoomStyle;
  sill: number; // solid wall under each window, meters
  head: number; // and above it
  balconies: boolean; // small balconies on some windows
  crown: 'fins' | 'frame' | null; // something on top that makes the skyline
}

const HOME = { room: 'home' as RoomStyle, sill: 0.9, head: 0.45, balconies: true, crown: null };
const LOOKS: Look[] = [
  // Bearing 40: homes. White bands, graphite piers.
  { ...HOME, bay: 1.7, band: MATERIALS.facade, pier: MATERIALS.graphite, corner: MATERIALS.facade, fin: null, finDepth: 0, roomSpan: 2 },
  // Bearing 140: the round office tower, a dark glass curtain wall with bronze fins that rise into a crown.
  { bay: 2, band: MATERIALS.graphite, pier: MATERIALS.graphite, corner: MATERIALS.graphite, fin: MATERIALS.bronze, finDepth: 0.55, roomSpan: 3, room: 'office', sill: 0.3, head: 0.3, balconies: false, crown: 'fins' },
  // Bearing 220: homes in dark graphite with white corners.
  { ...HOME, bay: 1.6, band: MATERIALS.graphite, pier: MATERIALS.graphite, corner: MATERIALS.facade, fin: null, finDepth: 0, roomSpan: 2 },
  // Bearing 270: the tallest, a white grid with graphite fins and an open frame on top.
  { bay: 2.1, band: MATERIALS.facade, pier: MATERIALS.facade, corner: MATERIALS.facade, fin: MATERIALS.graphite, finDepth: 0.35, roomSpan: 2, room: 'office', sill: 0.55, head: 0.35, balconies: false, crown: 'frame' },
  // Bearing 320: homes, white with bronze corners.
  { ...HOME, bay: 1.8, band: MATERIALS.facade, pier: MATERIALS.facade, corner: MATERIALS.bronze, fin: null, finDepth: 0, roomSpan: 1 },
];

export function buildTowers(scene: THREE.Object3D, world: RAPIER.World, windows: WindowBatch) {
  TOWERS.forEach((tower, i) => buildTower(scene, world, windows, tower, i));
}

function buildTower(scene: THREE.Object3D, world: RAPIER.World, windows: WindowBatch, tower: TowerSpec, index: number) {
  const look = LOOKS[index % LOOKS.length];
  const p = towerPosition(tower);
  const { radius, height, sides } = tower;
  const round = sides > 8;
  const d = radius * Math.cos(Math.PI / sides); // center to the middle of a face
  const faceWidth = 2 * radius * Math.sin(Math.PI / sides);

  // Collision: the full prism, exactly as before.
  prismCollider(world, p.x, 0, p.z, radius, height, sides);
  // The core, drawn just behind the glass. Its top is the roof.
  const coreRadius = (d - RECESS - 0.02) / Math.cos(Math.PI / sides);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(coreRadius, coreRadius, height, sides), MATERIALS.graphite);
  core.position.set(p.x, height / 2, p.z);
  core.castShadow = core.receiveShadow = true;
  scene.add(core);
  // (One material per mesh, so it merges with the rest of the city into one draw.)
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(coreRadius, coreRadius, 0.04, sides), MATERIALS.concrete);
  roof.position.set(p.x, height, p.z);
  roof.receiveShadow = true;
  scene.add(roof);

  // Floors above the shopfronts, as close to 3.8 m each as fits.
  const usable = height - PODIUM - 0.6;
  const floors = Math.max(1, Math.round(usable / 3.8));
  const floorHeight = usable / floors;
  const crownBase = PODIUM + floors * floorHeight - look.head;
  const hangarY = height > 25 ? height * HANGAR_SHARE : null;

  // Which face looks at the plaza (stations and hangar bays go there), and which has the door.
  const toPlaza = p.clone().negate().setY(0).normalize();
  const faceNormal = (k: number) => {
    const angle = ((k + 0.5) / sides) * Math.PI * 2;
    return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
  };
  let plazaFace = 0;
  for (let k = 1; k < sides; k++) if (faceNormal(k).dot(toPlaza) > faceNormal(plazaFace).dot(toPlaza)) plazaFace = k;
  const doorFaces = round ? [plazaFace] : [(plazaFace + 1) % sides, (plazaFace + sides - 1) % sides];
  // The hangar bay (tall towers only) is a 3.8 m frame centered on the plaza face; keep
  // windows and fins clear of it, on that face and on any neighbor it overlaps.
  const hangarNormal = faceNormal(plazaFace);
  const hangarRight = new THREE.Vector3(hangarNormal.z, 0, -hangarNormal.x);
  const inHangar = (point: THREE.Vector3, y0: number, y1: number) =>
    hangarY !== null && y1 > hangarY - 1.7 && y0 < hangarY + 1.7 && point.clone().sub(p).dot(hangarNormal) > d * 0.6 && Math.abs(point.clone().sub(p).dot(hangarRight)) < 2.3;

  const corner = round ? 0 : 0.32; // the corner columns cover this much of each end of a face
  const half = faceWidth / 2 - corner;
  const bays = Math.max(1, Math.round((half * 2) / look.bay));
  const edges = Array.from({ length: bays + 1 }, (_, j) => -half + (j / bays) * half * 2);
  const pier = round ? 0.07 : 0.11; // half the width of the wall between windows
  const back = -RECESS - 0.02; // the solid parts reach back to the core

  for (let k = 0; k < sides; k++) {
    const face = new Face(scene, world, p, faceNormal(k), d);
    const atPlaza = k === plazaFace;

    // ---- Ground floor: plinth, shopfronts, sign band ----
    const fullHalf = faceWidth / 2;
    face.box(MATERIALS.graphite, -fullHalf, fullHalf, 0, 0.35, back, 0.04);
    face.box(MATERIALS.graphite, -fullHalf, fullHalf, 3.4, 4.0, back, 0.08);
    face.glow(MATERIALS.amberLight, -fullHalf + 0.1, fullHalf - 0.1, 3.4, 3.44, 0.08, 0.1);
    // On the plaza side of the hex towers, a solid panel to hang a Siege weapon station on.
    const station = atPlaza && !round;
    const shopEdges = station ? [-half, -1.4, 1.4, half] : [-half, half];
    for (let r = 0; r + 1 < shopEdges.length; r++) {
      const s0 = shopEdges[r];
      const s1 = shopEdges[r + 1];
      if (station && r === 1) {
        face.box(MATERIALS.facade, s0, s1, 0.35, 3.4, back, 0);
        continue;
      }
      const panes = Math.max(1, Math.round((s1 - s0) / 1.6));
      for (let j = 0; j < panes; j++) {
        const a = s0 + ((s1 - s0) * j) / panes;
        const b = s0 + ((s1 - s0) * (j + 1)) / panes;
        face.window(windows, a + 0.05, b - 0.05, 0.35, 3.4, index * 997 + 900 + k * 7 + r, 'shop');
        face.box(MATERIALS.graphite, b - 0.06, b + 0.06, 0.35, 3.4, back, 0.0); // mullion
      }
      face.box(MATERIALS.graphite, s0 - 0.06, s0 + 0.06, 0.35, 3.4, back, 0.0);
    }
    if (doorFaces.includes(k)) {
      // A canopy over the door, lit underneath.
      const w = Math.min(1.7, fullHalf - 0.2);
      face.box(MATERIALS.graphite, -w, w, 3.42, 3.6, 0.08, 1.9, true);
      face.glow(MATERIALS.softLight, -w + 0.15, w - 0.15, 3.38, 3.42, 0.5, 1.6);
    }

    // ---- The floors above ----
    for (let f = 0; f <= floors; f++) {
      const line = PODIUM + f * floorHeight;
      // The solid band between one floor's windows and the next.
      const y0 = f === 0 ? PODIUM : line - look.head;
      const y1 = f === floors ? height + PARAPET : line + look.sill;
      face.box(f === floors ? look.corner : look.band, -fullHalf, fullHalf, y0, y1, back, 0.06, f === floors);
      if (f === floors) break;
      // Windows, with piers between them.
      for (let j = 0; j < bays; j++) {
        const s0 = edges[j] + (j === 0 && !round ? 0 : pier);
        const s1 = edges[j + 1] - (j === bays - 1 && !round ? 0 : pier);
        const wy0 = line + look.sill;
        const wy1 = line + floorHeight - look.head;
        const middle = (s0 + s1) / 2;
        // Leave the wall solid where a hangar bay goes.
        if (inHangar(face.at(middle, 0, 0), wy0, wy1)) {
          face.box(look.pier, s0, s1, wy0, wy1, back, 0.02);
          continue;
        }
        const room = Math.floor((k * bays + j) / look.roomSpan);
        face.window(windows, s0, s1, wy0, wy1, index * 997 + f * 61 + room + 0.25, look.room);
        // A small balcony on some windows (not at the walkway, where the deck already is).
        const nearWalkway = Math.abs(line - CONFIG.city.walkwayHeight) < 2;
        if (look.balconies && !nearWalkway && f > 0 && (j + f + k) % 3 === 0 && !atPlaza) homeBalcony(face, s0, s1, line + 0.05, look);
      }
    }
    for (let j = 0; j <= bays; j++) {
      if (!round && (j === 0 || j === bays)) continue; // the corner columns are there
      face.box(look.pier, edges[j] - pier, edges[j] + pier, PODIUM, crownBase, back, 0.02);
      if (look.fin && !round) {
        const crosses = inHangar(face.at(edges[j], 0, 0), hangarY ?? 0, hangarY ?? 0) && hangarY !== null;
        const runs = crosses ? [[PODIUM + look.sill, hangarY! - 1.9], [hangarY! + 1.9, crownBase]] : [[PODIUM + look.sill, crownBase]];
        for (const [y0, y1] of runs) face.box(look.fin, edges[j] - 0.07, edges[j] + 0.07, y0, y1, 0.02, look.finDepth);
      }
    }
    // A lit reveal round the crown.
    face.glow(MATERIALS.amberLight, -fullHalf + 0.05, fullHalf - 0.05, height - 0.62, height - 0.52, 0.06, 0.1);
  }

  // Corner columns on the prisms, and fins on the round tower's corners.
  for (let k = 0; k < sides; k++) {
    const angle = (k / sides) * Math.PI * 2;
    const out = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    if (!round) {
      // The frame crown carries the corner columns on up past the roof.
      const top = height + PARAPET + (look.crown === 'frame' ? 3.4 : 0.15);
      const c = p.clone().addScaledVector(out, radius - 0.26);
      solidBox(scene, world, { x: c.x, y: top / 2, z: c.z }, { x: 0.62, y: top, z: 0.62 }, look.corner, angle, look.crown === 'frame');
    } else if (look.fin) {
      // The fin crown: every fin rises past the roof, tallest toward the plaza.
      const rise = look.crown === 'fins' ? 1.6 + 1.6 * (0.5 + 0.5 * out.dot(toPlaza)) : 0;
      const top = (look.crown === 'fins' ? height + PARAPET + rise : crownBase + 0.2);
      const c = p.clone().addScaledVector(out, radius - 0.2 + look.finDepth / 2);
      // A fin that would cross the hangar bay stops below it and starts again above.
      const runs = inHangar(p.clone().addScaledVector(out, radius), hangarY ?? 0, hangarY ?? 0) && hangarY !== null
        ? [[PODIUM, hangarY - 1.9], [hangarY + 1.9, top]]
        : [[PODIUM, top]];
      for (const [y0, y1] of runs) solidBox(scene, world, { x: c.x, y: (y0 + y1) / 2, z: c.z }, { x: 0.12, y: y1 - y0, z: look.finDepth + 0.4 }, look.fin, angle, false);
    }
  }
  if (look.crown === 'frame') {
    // A ring beam joining the columns, lit underneath.
    const y = height + PARAPET + 3.1;
    for (let k = 0; k < sides; k++) {
      const face = new Face(scene, world, p, faceNormal(k), d);
      face.box(look.corner, -faceWidth / 2, faceWidth / 2, y, y + 0.45, -0.5, 0.06, true);
      face.glow(MATERIALS.amberLight, -faceWidth / 2 + 0.4, faceWidth / 2 - 0.4, y - 0.03, y, -0.3, -0.1);
    }
  }

  buildRoof(scene, world, tower, p);
}

// The roof: a stair hut in the middle (the short towers' Siege hatch sits on top of it),
// air handlers and a mast on the side away from the plaza (rooftop targets stand on the
// near side), and a beacon on the tall ones.
function buildRoof(scene: THREE.Object3D, world: RAPIER.World, tower: TowerSpec, p: THREE.Vector3) {
  const top = tower.height;
  const outward = p.clone().setY(0).normalize();
  const side = new THREE.Vector3(outward.z, 0, -outward.x);
  const yaw = Math.atan2(outward.x, outward.z);
  const spot = (out: number, across: number) => p.clone().addScaledVector(outward, out).addScaledVector(side, across);

  // Stair hut: 2.5 m square and 2.4 m tall (spawnPoints.ts puts the hatch on its roof).
  solidBox(scene, world, { x: p.x, y: top + 1.2, z: p.z }, { x: 2.5, y: 2.4, z: 2.5 }, MATERIALS.facade, yaw);
  solidBox(scene, world, { x: p.x, y: top + 2.36, z: p.z }, { x: 2.7, y: 0.12, z: 2.7 }, MATERIALS.graphite, yaw, false);
  const door = spot(-1.26, 0);
  solidBox(scene, world, { x: door.x, y: top + 1.05, z: door.z }, { x: 0.95, y: 2.0, z: 0.06 }, MATERIALS.graphite, yaw, false);
  const lamp = spot(-1.3, 0);
  lightStrip(scene, { x: lamp.x, y: top + 2.2, z: lamp.z }, { x: 0.5, y: 0.06, z: 0.08 }, MATERIALS.softLight, yaw);
  // Louvres down one side of the hut.
  for (let i = 0; i < 6; i++) {
    const at = spot(0, 1.27);
    solidBox(scene, world, { x: at.x, y: top + 0.6 + i * 0.22, z: at.z }, { x: 1.6, y: 0.04, z: 0.1 }, MATERIALS.graphite, yaw + Math.PI / 2, false);
  }

  // Two air handlers with fans on top.
  for (const [out, across] of [
    [0.48, -0.36],
    [0.2, -0.62],
  ]) {
    const at = spot(tower.radius * out, tower.radius * across);
    solidBox(scene, world, { x: at.x, y: top + 0.65, z: at.z }, { x: 2.0, y: 1.1, z: 1.3 }, MATERIALS.lightPanel, yaw);
    solidBox(scene, world, { x: at.x, y: top + 0.08, z: at.z }, { x: 2.2, y: 0.16, z: 1.5 }, MATERIALS.graphite, yaw, false);
    for (const along of [-0.5, 0.5]) {
      const fan = at.clone().addScaledVector(side, along);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 6, 20), MATERIALS.graphite);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(fan.x, top + 1.22, fan.z);
      scene.add(rim);
      const blades = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 16), MATERIALS.shadow);
      blades.position.set(fan.x, top + 1.19, fan.z);
      scene.add(blades);
    }
  }
  // A pipe run from the air handlers into the hut.
  const pipeFrom = spot(tower.radius * 0.2, -tower.radius * 0.36);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, pipeFrom.distanceTo(p) - 1.2, 10), MATERIALS.trim);
  pipe.position.copy(pipeFrom).add(p).multiplyScalar(0.5).setY(top + 0.3);
  pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().sub(pipeFrom).setY(0).normalize());
  pipe.castShadow = true;
  scene.add(pipe);

  // A mast with a warning light.
  const mast = spot(tower.radius * 0.55, tower.radius * 0.4);
  const mastHeight = tower.height > 25 ? 5 : 3.2;
  solidBox(scene, world, { x: mast.x, y: top + mastHeight / 2, z: mast.z }, { x: 0.14, y: mastHeight, z: 0.14 }, MATERIALS.darkMetal);
  for (const y of [mastHeight * 0.45, mastHeight * 0.8]) {
    solidBox(scene, world, { x: mast.x, y: top + y, z: mast.z }, { x: 0.9, y: 0.05, z: 0.05 }, MATERIALS.darkMetal, yaw, false);
  }
  lightStrip(scene, { x: mast.x, y: top + mastHeight + 0.08, z: mast.z }, { x: 0.18, y: 0.18, z: 0.18 }, MATERIALS.orangeLight);
  if (tower.height > 25) lightStrip(scene, { x: p.x, y: top + 2.6, z: p.z }, { x: 0.4, y: 0.4, z: 0.4 }, MATERIALS.orangeLight);
}

// A small balcony in front of a window: a slab and a solid front, with collision.
function homeBalcony(face: Face, s0: number, s1: number, floor: number, look: Look) {
  const depth = 1.0;
  face.box(look.band, s0 - 0.15, s1 + 0.15, floor - 0.16, floor, 0, depth, true);
  face.box(look.corner, s0 - 0.15, s1 + 0.15, floor, floor + 0.95, depth - 0.08, depth, true);
  face.box(look.corner, s0 - 0.15, s0 - 0.07, floor, floor + 0.95, 0, depth - 0.08, true);
  face.box(look.corner, s1 + 0.07, s1 + 0.15, floor, floor + 0.95, 0, depth - 0.08, true);
  face.glow(MATERIALS.softLight, s0 + 0.2, s1 - 0.2, floor - 0.19, floor - 0.16, 0.3, 0.7);
}
