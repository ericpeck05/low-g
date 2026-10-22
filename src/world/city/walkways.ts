import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import type { GlassBatch } from './glass';
import { MATERIALS, boxCollider, lightStrip, prismCollider, solidBox } from './kit';
import { BALCONY_EXTRA, TOWERS, towerPosition } from './layout';

// The walkway ring 8 m up: a round deck around each tower, bridges between neighboring
// towers, and two ramps down to the plaza. Built like real footbridges: a slab on steel
// edge girders with cross beams, downlights underneath, and glass balustrades with posts
// and a handrail lit from below. Walking surfaces and their collision are unchanged.

const RAIL_HEIGHT = 1.05;
const POST_SPACING = 1.6;
const RAMP_TOWERS = [0, 2]; // ramps come down from these towers' decks toward the plaza
const RAMP_ANGLE = THREE.MathUtils.degToRad(18); // an easy walk

export function buildWalkways(scene: THREE.Object3D, world: RAPIER.World, glass: GlassBatch) {
  const h = CONFIG.city.walkwayHeight;
  // Where each deck's railing must open: toward each bridge and down each ramp.
  const openings: number[][] = TOWERS.map(() => []);

  for (let i = 0; i < TOWERS.length; i++) {
    const j = (i + 1) % TOWERS.length;
    const pa = towerPosition(TOWERS[i]);
    const pb = towerPosition(TOWERS[j]);
    const direction = pb.clone().sub(pa).normalize();
    openings[i].push(Math.atan2(direction.x, direction.z));
    openings[j].push(Math.atan2(-direction.x, -direction.z));
    // Start and end at each deck's edge, overlapping a little so there's no seam.
    const start = pa.clone().addScaledVector(direction, TOWERS[i].radius + BALCONY_EXTRA - 0.5);
    const end = pb.clone().addScaledVector(direction, -(TOWERS[j].radius + BALCONY_EXTRA - 0.5));
    bridge(scene, world, glass, start.setY(h), end.setY(h));
  }
  for (const index of RAMP_TOWERS) {
    const p = towerPosition(TOWERS[index]);
    const inward = p.clone().negate().normalize();
    openings[index].push(Math.atan2(inward.x, inward.z));
    ramp(scene, world, glass, TOWERS[index].radius, p, inward, h);
  }
  TOWERS.forEach((tower, i) => deck(scene, world, glass, towerPosition(tower), tower.radius + BALCONY_EXTRA, h, openings[i]));
}

/**
 * A straight run of walkway in its own frame: x across, y up from the walking surface,
 * z along. `frame` is a group already placed and turned; parts are added to it.
 */
function span(frame: THREE.Group, length: number, glass: GlassBatch, world: RAPIER.World) {
  const part = (material: THREE.Material, x: number, y: number, z: number, w: number, hgt: number, d: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    frame.add(mesh);
    return mesh;
  };
  const glow = (material: THREE.Material, x: number, y: number, z: number, w: number, hgt: number, d: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), material);
    mesh.position.set(x, y, z);
    frame.add(mesh);
  };
  // Slab, edge girders and cross beams.
  part(MATERIALS.concrete, 0, -0.15, 0, 4, 0.3, length);
  for (const s of [-1, 1]) {
    part(MATERIALS.graphite, s * 1.86, -0.45, 0, 0.32, 0.8, length);
    glow(MATERIALS.amberLight, s * 2.03, -0.82, 0, 0.03, 0.05, length - 0.2);
  }
  for (let z = -length / 2 + 1.5; z < length / 2 - 1; z += 3) {
    part(MATERIALS.graphite, 0, -0.42, z, 3.4, 0.22, 0.16);
    glow(MATERIALS.softLight, 0, -0.31, z + 1.5, 0.5, 0.03, 0.5);
  }
  // Balustrades: posts, a glass panel between them, and a handrail lit from underneath.
  for (const s of [-1, 1]) {
    const x = s * 1.9;
    const posts = Math.max(1, Math.round(length / POST_SPACING));
    for (let k = 0; k <= posts; k++) part(MATERIALS.graphite, x, RAIL_HEIGHT / 2, -length / 2 + (length * k) / posts, 0.06, RAIL_HEIGHT, 0.06);
    part(MATERIALS.graphite, x, RAIL_HEIGHT, 0, 0.1, 0.07, length);
    glow(MATERIALS.amberLight, x - s * 0.02, RAIL_HEIGHT - 0.045, 0, 0.04, 0.02, length - 0.1);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(length, RAIL_HEIGHT - 0.2));
    pane.position.set(x, RAIL_HEIGHT / 2 - 0.02, 0);
    pane.rotation.y = Math.PI / 2;
    frame.add(pane);
    glass.addAt(pane.geometry.clone(), pane);
    pane.removeFromParent();
    // Collision for the railing (solid, so you can't walk off the side).
    const collider = new THREE.Object3D();
    collider.position.set(x, RAIL_HEIGHT / 2, 0);
    frame.add(collider);
    collider.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    collider.matrixWorld.decompose(position, rotation, new THREE.Vector3());
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, RAIL_HEIGHT / 2, length / 2).setTranslation(position.x, position.y, position.z).setRotation(rotation));
    collider.removeFromParent();
  }
}

function bridge(scene: THREE.Object3D, world: RAPIER.World, glass: GlassBatch, start: THREE.Vector3, end: THREE.Vector3) {
  const length = start.distanceTo(end);
  const direction = end.clone().sub(start).normalize();
  const middle = start.clone().add(end).multiplyScalar(0.5);
  const yaw = Math.atan2(direction.x, direction.z);
  // The walking surface's collision, exactly as before.
  boxCollider(world, { x: middle.x, y: middle.y - 0.2, z: middle.z }, { x: 4, y: 0.4, z: length }, new THREE.Euler(0, yaw, 0));
  const frame = new THREE.Group();
  frame.position.copy(middle);
  frame.rotation.y = yaw;
  scene.add(frame);
  span(frame, length, glass, world);
}

function ramp(scene: THREE.Object3D, world: RAPIER.World, glass: GlassBatch, towerRadius: number, p: THREE.Vector3, inward: THREE.Vector3, h: number) {
  const run = h / Math.tan(RAMP_ANGLE);
  const top = p.clone().addScaledVector(inward, towerRadius + BALCONY_EXTRA - 0.3).setY(h);
  const bottom = top.clone().addScaledVector(inward, run).setY(0);
  const length = top.distanceTo(bottom);
  const thickness = 0.4;
  const yaw = Math.atan2(top.x - bottom.x, top.z - bottom.z);
  // The walking surface's collision, exactly as before (its top runs from the ground to the deck).
  const center = top.clone().add(bottom).multiplyScalar(0.5);
  center.y -= thickness / 2 / Math.cos(RAMP_ANGLE);
  boxCollider(world, center, { x: 4, y: thickness, z: length }, new THREE.Euler(-RAMP_ANGLE, yaw, 0, 'YXZ'));
  // Drawn in its own tilted frame, from the middle of its walking surface.
  const frame = new THREE.Group();
  frame.position.copy(top).add(bottom).multiplyScalar(0.5);
  frame.rotation.set(-RAMP_ANGLE, yaw, 0, 'YXZ');
  scene.add(frame);
  span(frame, length, glass, world);
}

/** A round deck around a tower, with a railing that opens where bridges and ramps meet it. */
function deck(scene: THREE.Object3D, world: RAPIER.World, glass: GlassBatch, p: THREE.Vector3, radius: number, h: number, openings: number[]) {
  // Slab with a deep graphite fascia under it (collision: the same 0.4 m disc as before).
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.3, 72), MATERIALS.concrete);
  slab.position.set(p.x, h - 0.15, p.z);
  slab.castShadow = slab.receiveShadow = true;
  scene.add(slab);
  const fascia = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.03, radius - 0.4, 0.5, 72), MATERIALS.graphite);
  fascia.position.set(p.x, h - 0.55, p.z);
  fascia.castShadow = fascia.receiveShadow = true;
  scene.add(fascia);
  prismCollider(world, p.x, h - 0.4, p.z, radius, 0.4, 32);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.04, 0.03, 4, 96), MATERIALS.amberLight);
  edge.rotation.x = Math.PI / 2;
  edge.position.set(p.x, h - 0.33, p.z);
  scene.add(edge);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    lightStrip(scene, { x: p.x + Math.sin(a) * (radius - 1.1), y: h - 0.81, z: p.z + Math.cos(a) * (radius - 1.1) }, { x: 0.4, y: 0.03, z: 0.4 }, MATERIALS.softLight, a);
  }

  // The railing, in arcs between the openings.
  const r = radius - 0.12;
  const half = (gap: number) => Math.asin(Math.min(1, gap / r));
  const blocked = (a: number) => openings.some((o) => Math.abs(Math.atan2(Math.sin(a - o), Math.cos(a - o))) < half(2.25));
  const steps = Math.round((2 * Math.PI * r) / POST_SPACING);
  const step = (Math.PI * 2) / steps;
  for (let k = 0; k < steps; k++) {
    const a0 = k * step;
    const a1 = a0 + step;
    if (blocked(a0) || blocked(a1)) continue;
    const at = (a: number, rr = r) => new THREE.Vector3(p.x + Math.sin(a) * rr, 0, p.z + Math.cos(a) * rr);
    // A post at the start of each bay, and one more where an arc of railing ends.
    for (const a of blocked(a1 + step) ? [a0, a1] : [a0]) {
      const post = at(a);
      solidBox(scene, world, { x: post.x, y: h + RAIL_HEIGHT / 2, z: post.z }, { x: 0.06, y: RAIL_HEIGHT, z: 0.06 }, MATERIALS.graphite, a, false);
    }
    // Handrail, lit strip and glass for this bay, and its collision.
    const mid = (a0 + a1) / 2;
    const chord = 2 * r * Math.sin(step / 2);
    const m = at(mid, r * Math.cos(step / 2));
    solidBox(scene, world, { x: m.x, y: h + RAIL_HEIGHT, z: m.z }, { x: chord + 0.02, y: 0.07, z: 0.1 }, MATERIALS.graphite, mid, false);
    lightStrip(scene, { x: m.x, y: h + RAIL_HEIGHT - 0.045, z: m.z }, { x: chord, y: 0.02, z: 0.04 }, MATERIALS.amberLight, mid);
    const pane = new THREE.PlaneGeometry(chord - 0.06, RAIL_HEIGHT - 0.2);
    pane.rotateY(mid);
    pane.translate(m.x, h + RAIL_HEIGHT / 2 - 0.02, m.z);
    glass.add(pane);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(chord / 2, RAIL_HEIGHT / 2, 0.05)
        .setTranslation(m.x, h + RAIL_HEIGHT / 2, m.z)
        .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), mid)),
    );
  }
}
