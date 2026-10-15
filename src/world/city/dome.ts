import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
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

export function buildDome(scene: THREE.Scene, world: RAPIER.World) {
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

  // Glass: nearly clear with a faint warm tint. The sun still glints off it.
  const glass = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xfff0dc,
      transparent: true,
      opacity: 0.07,
      roughness: 0.08,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  glass.renderOrder = 1; // draw after the dust and other see-through things
  scene.add(glass);

  // Solid shell: you can't walk or jetpack out through the glass.
  const indices = new Uint32Array(positions.length / 3).map((_, i) => i);
  world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices));

  buildFrame(scene);
}

// Struts along every other meridian and every third ring, plus a concrete footing.
function buildFrame(scene: THREE.Scene) {
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  for (let col = 0; col < MERIDIANS; col += 2) {
    for (let ring = 0; ring < RINGS; ring++) {
      if (isGap(col, ring) && isGap(col - 1, ring)) continue;
      if (airlockColumns().includes(col) && ring < AIRLOCK_GAP_ROWS) continue;
      segments.push([gridPoint(col, ring), gridPoint(col, ring + 1)]);
    }
  }
  for (let ring = 3; ring < RINGS; ring += 3) {
    for (let col = 0; col < MERIDIANS; col++) {
      if (isGap(col, ring)) continue;
      segments.push([gridPoint(col, ring), gridPoint(col + 1, ring)]);
    }
  }

  const strut = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 1), MATERIALS.darkMetal, segments.length);
  const matrix = new THREE.Matrix4();
  const forward = new THREE.Vector3(0, 0, 1);
  segments.forEach(([a, b], i) => {
    const direction = b.clone().sub(a);
    const length = direction.length();
    const rotation = new THREE.Quaternion().setFromUnitVectors(forward, direction.normalize());
    matrix.compose(a.clone().add(b).multiplyScalar(0.5), rotation, new THREE.Vector3(1, 1, length));
    strut.setMatrixAt(i, matrix);
  });
  strut.castShadow = true; // the frame throws a lattice of shadows across the city
  scene.add(strut);

  // Footing: a low concrete curb where the glass meets the ground (open at the airlocks).
  const footing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.5, 1), MATERIALS.concrete, MERIDIANS);
  let count = 0;
  for (let col = 0; col < MERIDIANS; col++) {
    if (isGap(col, 0)) continue;
    const a = gridPoint(col, 0);
    const b = gridPoint(col + 1, 0);
    const rotation = new THREE.Quaternion().setFromUnitVectors(forward, b.clone().sub(a).normalize());
    const middle = a.clone().add(b).multiplyScalar(0.5).setY(0.25);
    matrix.compose(middle, rotation, new THREE.Vector3(1, 1, a.distanceTo(b)));
    footing.setMatrixAt(count++, matrix);
  }
  footing.count = count;
  footing.receiveShadow = true;
  scene.add(footing);
}
