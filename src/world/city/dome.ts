import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { patchFresnelGlass } from '../../core/materialPatches';
import { MATERIALS } from './kit';

// The pressurized dome: a huge glass shell over the whole city.
// The same grid of points makes the glass, the frame and the solid collision,
// with a gap at each airlock so the tunnels can pass through.

const MERIDIANS = 96; // lines running from the ground to the top
const RINGS = 24; // horizontal rings from the ground to the top
const AIRLOCK_GAP_COLUMNS = 1; // grid cells cleared each side of an airlock's center line
const AIRLOCK_GAP_ROWS = 2; // grid cells cleared from the ground up

/** Is this point inside the dome's air? (Used for oxygen and sound later.) */
export function isInsideDome(p: { x: number; y: number; z: number }) {
  const { domeRadius: r, domeHeight: h } = CONFIG.city;
  return (p.x * p.x + p.z * p.z) / (r * r) + (p.y * p.y) / (h * h) < 1;
}

/** Height of the dome's ceiling above a spot at this distance from the center. */
export function domeCeiling(distanceFromCenter: number) {
  const { domeRadius: r, domeHeight: h } = CONFIG.city;
  const t = distanceFromCenter / r;
  return t >= 1 ? 0 : h * Math.sqrt(1 - t * t);
}

/** Grid columns that line up with each airlock (airlocks sit on a meridian). */
export function airlockColumns() {
  return CONFIG.city.airlockBearings.map((bearing) => Math.round((bearing / 360) * MERIDIANS) % MERIDIANS);
}

/** The bearing an airlock really sits at, snapped to the dome grid. */
export function snappedAirlockBearing(index: number) {
  return (airlockColumns()[index] / MERIDIANS) * 360;
}

function gridPoint(column: number, ring: number) {
  const { domeRadius: r, domeHeight: h } = CONFIG.city;
  const bearing = (column / MERIDIANS) * Math.PI * 2;
  const lift = (ring / RINGS) * (Math.PI / 2); // 0 at the ground, 90 degrees at the top
  const spread = Math.cos(lift);
  // Same bearing convention as the sun and Earth: 0 = +z, 90 = +x.
  return new THREE.Vector3(Math.sin(bearing) * r * spread, h * Math.sin(lift), Math.cos(bearing) * r * spread);
}

// Is this grid cell part of an airlock opening?
function isGap(column: number, ring: number) {
  if (ring >= AIRLOCK_GAP_ROWS) return false;
  return airlockColumns().some((center) => {
    const offset = (((column - center) % MERIDIANS) + MERIDIANS) % MERIDIANS;
    // Cells just left and right of the center line (the line is the left edge of cell `center`).
    return offset < AIRLOCK_GAP_COLUMNS || offset >= MERIDIANS - AIRLOCK_GAP_COLUMNS;
  });
}

export function buildDome(scene: THREE.Object3D, world: RAPIER.World) {
  // Build the shell as triangles, skipping the airlock gaps.
  const vertices: number[] = [];
  for (let ring = 0; ring < RINGS; ring++) {
    for (let col = 0; col < MERIDIANS; col++) {
      if (isGap(col, ring)) continue;
      const a = gridPoint(col, ring);
      const b = gridPoint(col + 1, ring);
      const c = gridPoint(col + 1, ring + 1);
      const d = gridPoint(col, ring + 1);
      vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      vertices.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
  }
  const positions = new Float32Array(vertices);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  // Glass: black color so it shows only reflections. Nearly clear looking straight
  // through it, mirror-like at shallow angles, and the sun glints off it.
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x000000,
    transparent: true,
    roughness: 0.04,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  patchFresnelGlass(glassMaterial, 0.05, 0.7);
  const glass = new THREE.Mesh(geometry, glassMaterial);
  glass.renderOrder = 1; // draw after the dust and other see-through things
  scene.add(glass);

  // Solid shell: you can't walk or jetpack out through the glass.
  const indices = new Uint32Array(positions.length / 3).map((_, i) => i);
  const collider = world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices));

  buildFrame(scene);
  return { glass, collider };
}

const PRIMARY_EVERY = 8; // every 8th meridian is a heavy main rib
const OCULUS_RING = 21; // the ribs end at a compression ring this far up, round an open crown

// The frame: heavy main ribs, lighter struts on every other meridian, rings every third
// row, a compression ring near the top where the ribs end (so they don't all crowd into
// one point), and a base wall with a buttress under each main rib.
function buildFrame(scene: THREE.Object3D) {
  const light: [THREE.Vector3, THREE.Vector3][] = [];
  const heavy: [THREE.Vector3, THREE.Vector3][] = [];
  for (let col = 0; col < MERIDIANS; col += 2) {
    for (let ring = 0; ring < OCULUS_RING; ring++) {
      if (isGap(col, ring) && isGap(col - 1, ring)) continue;
      if (airlockColumns().includes(col) && ring < AIRLOCK_GAP_ROWS) continue;
      (col % PRIMARY_EVERY === 0 ? heavy : light).push([gridPoint(col, ring), gridPoint(col, ring + 1)]);
    }
  }
  for (let ring = 3; ring < OCULUS_RING; ring += 3) {
    for (let col = 0; col < MERIDIANS; col++) {
      if (isGap(col, ring)) continue;
      light.push([gridPoint(col, ring), gridPoint(col + 1, ring)]);
    }
  }
  // The compression ring, and spokes across the crown to a small hub at the top.
  for (let col = 0; col < MERIDIANS; col++) heavy.push([gridPoint(col, OCULUS_RING), gridPoint(col + 1, OCULUS_RING)]);
  const top = new THREE.Vector3(0, CONFIG.city.domeHeight, 0);
  for (let col = 0; col < MERIDIANS; col += PRIMARY_EVERY * 2) {
    const from = gridPoint(col, OCULUS_RING);
    const hub = from.clone().lerp(top, 0.8);
    light.push([from, gridPoint(col, OCULUS_RING + 1)], [gridPoint(col, OCULUS_RING + 1), gridPoint(col, OCULUS_RING + 2)], [gridPoint(col, OCULUS_RING + 2), hub]);
  }
  for (let col = 0; col < MERIDIANS; col += 4) {
    const a = gridPoint(col, OCULUS_RING).lerp(top, 0.8);
    const b = gridPoint(col + 4, OCULUS_RING).lerp(top, 0.8);
    heavy.push([a, b]);
  }

  struts(scene, light, 0.32, 0.32);
  struts(scene, heavy, 0.7, 0.95);

  // Nodes where the main ribs cross the rings.
  const nodes: THREE.Vector3[] = [];
  for (let col = 0; col < MERIDIANS; col += PRIMARY_EVERY) {
    for (let ring = 3; ring <= OCULUS_RING; ring += 3) if (!isGap(col, ring)) nodes.push(gridPoint(col, ring));
  }
  const node = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), MATERIALS.graphite, nodes.length);
  const matrix = new THREE.Matrix4();
  nodes.forEach((p, i) => {
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.clone().setY(0).normalize());
    node.setMatrixAt(i, matrix.compose(p, turn, new THREE.Vector3(1, 1, 1)));
  });
  node.castShadow = true;
  scene.add(node);

  // Base wall: a low graphite wall just inside the glass, a buttress under each main rib,
  // and a line of light along it (open at the airlocks).
  const forward = new THREE.Vector3(0, 0, 1);
  const wall = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.5, 1), MATERIALS.graphite, MERIDIANS);
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), MATERIALS.amberLight, MERIDIANS);
  let count = 0;
  for (let col = 0; col < MERIDIANS; col++) {
    if (isGap(col, 0)) continue;
    const a = gridPoint(col, 0);
    const b = gridPoint(col + 1, 0);
    const rotation = new THREE.Quaternion().setFromUnitVectors(forward, b.clone().sub(a).normalize());
    const inward = a.clone().add(b).multiplyScalar(0.5).setY(0).normalize().multiplyScalar(-0.55);
    const middle = a.clone().add(b).multiplyScalar(0.5).add(inward);
    wall.setMatrixAt(count, matrix.compose(middle.clone().setY(0.75), rotation, new THREE.Vector3(0.5, 1, a.distanceTo(b) + 0.02)));
    glow.setMatrixAt(count, matrix.compose(middle.clone().addScaledVector(inward, 0.48).setY(1.3), rotation, new THREE.Vector3(0.05, 1, a.distanceTo(b) - 0.6)));
    count++;
  }
  wall.count = glow.count = count;
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall, glow);
  const buttresses: THREE.Vector3[] = [];
  for (let col = 0; col < MERIDIANS; col += PRIMARY_EVERY) if (!isGap(col, 0)) buttresses.push(gridPoint(col, 0));
  const buttress = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 3.2, 2.4), MATERIALS.concrete, buttresses.length);
  buttresses.forEach((p, i) => {
    const turn = new THREE.Quaternion().setFromUnitVectors(forward, p.clone().normalize());
    buttress.setMatrixAt(i, matrix.compose(p.clone().multiplyScalar(1 - 1.2 / p.length()).setY(1.6), turn, new THREE.Vector3(1, 1, 1)));
  });
  buttress.castShadow = buttress.receiveShadow = true;
  scene.add(buttress);
}

/** Box struts (width by depth across) between pairs of points, drawn as one batch. */
function struts(scene: THREE.Object3D, segments: [THREE.Vector3, THREE.Vector3][], width: number, depth: number) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, depth, 1), MATERIALS.darkMetal, segments.length);
  const matrix = new THREE.Matrix4();
  const forward = new THREE.Vector3(0, 0, 1);
  segments.forEach(([a, b], i) => {
    const direction = b.clone().sub(a);
    const length = direction.length();
    // Point along the strut, with its depth facing the dome's center (so heavy ribs stand proud).
    const along = direction.normalize();
    const middle = a.clone().add(b).multiplyScalar(0.5);
    const out = middle.clone().normalize();
    const side = new THREE.Vector3().crossVectors(out, along).normalize();
    const up = new THREE.Vector3().crossVectors(along, side).normalize();
    const basis = new THREE.Matrix4().makeBasis(side, up, along);
    const rotation = new THREE.Quaternion().setFromRotationMatrix(basis);
    if (!Number.isFinite(rotation.x)) rotation.setFromUnitVectors(forward, along);
    // Heavy ribs sit just inside the glass.
    const inset = middle.clone().addScaledVector(out, -depth / 2);
    matrix.compose(inset, rotation, new THREE.Vector3(1, 1, length + width * 0.5));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.castShadow = true; // the frame throws a lattice of shadows across the city
  scene.add(mesh);
}
