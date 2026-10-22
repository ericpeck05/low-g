import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { seededRandom } from '../noise';
import { MATERIALS, boxCollider, lightStrip, solidBox, solidCylinder } from './kit';
import { PLAZA_RADIUS, RING_ROAD } from './layout';
import { Bollards, type Greenery, LampPosts, bench, planter } from './props';
import { signPanel } from './signs';

// The heart of the city: a round stone plaza with a monument in the middle, benches,
// lamps, and planted beds round its edge, and tree-lined avenues out to the airlocks.
// The plaza's bullseye targets stand 12 m out at bearings 60, 180 and 300, and ramps
// come down onto its edge at bearings 40 and 220, so those spots stay clear.

const PLATFORM = 0.2; // the plaza is a low step up from the street

export function buildPlaza(scene: THREE.Object3D, world: RAPIER.World, green: Greenery) {
  // The platform: stone laid in rings, with a ring of light set into it.
  solidCylinder(scene, world, 0, 0, 0, PLAZA_RADIUS, PLATFORM, MATERIALS.concrete, 96);
  const stone = new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS, 96), new THREE.MeshStandardMaterial({ map: plazaStone(), roughness: 0.7 }));
  stone.rotation.x = -Math.PI / 2;
  stone.position.y = PLATFORM + 0.015;
  stone.receiveShadow = true;
  scene.add(stone);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_RADIUS - 1.5, 0.08, 6, 128), MATERIALS.amberLight);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PLATFORM + 0.01;
  scene.add(ring);
  // A dark granite edge band round the rim.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_RADIUS - 0.15, 0.16, 4, 128), MATERIALS.graphite);
  rim.rotation.x = Math.PI / 2;
  rim.scale.z = 0.6;
  rim.position.y = PLATFORM - 0.04;
  scene.add(rim);

  monument(scene, world);

  // Benches facing out, between the targets.
  for (const bearing of [0, 120, 240]) {
    const b = THREE.MathUtils.degToRad(bearing);
    for (const side of [-1, 1]) {
      const a = b + side * 0.32;
      bench(scene, world, Math.sin(a) * 8.6, Math.cos(a) * 8.6, a, 2.6, PLATFORM);
    }
  }

  // Lamps round the edge of the platform.
  const lamps = new LampPosts();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    lamps.add(world, Math.sin(a) * (PLAZA_RADIUS + 2.5), Math.cos(a) * (PLAZA_RADIUS + 2.5), a + Math.PI);
  }

  // Planted beds in a ring just off the plaza, clear of the ramps, avenues and the range path.
  for (const bearing of [68, 118, 152, 250, 292, 328]) {
    const b = THREE.MathUtils.degToRad(bearing);
    planter(scene, world, green, Math.sin(b) * 23, Math.cos(b) * 23, 6, 1.8, b + Math.PI / 2);
  }

  // Trees down both sides of each avenue, and bollards where the avenues meet the ring road.
  const bollards = new Bollards();
  for (const bearing of CONFIG.city.airlockBearings) {
    const b = THREE.MathUtils.degToRad(bearing);
    const out = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
    const side = new THREE.Vector3(out.z, 0, -out.x);
    for (let r = 26; r < RING_ROAD.inner - 4; r += 9) {
      for (const s of [-1, 1]) {
        const p = out.clone().multiplyScalar(r).addScaledVector(side, s * 6.4);
        planter(scene, world, green, p.x, p.z, 1.6, 1.6, b);
        if (r + 4.5 < RING_ROAD.inner - 4) {
          const lamp = out.clone().multiplyScalar(r + 4.5).addScaledVector(side, s * 5.2);
          lamps.add(world, lamp.x, lamp.z, Math.atan2(-side.x * s, -side.z * s));
        }
      }
    }
    for (const r of [RING_ROAD.inner - 1, RING_ROAD.outer + 1]) {
      for (const s of [-4.6, 4.6]) {
        const p = out.clone().multiplyScalar(r).addScaledVector(side, s);
        bollards.add(world, p.x, p.z);
      }
    }
    // A sign where each avenue meets the ring road, naming the airlock it leads to.
    const signAt = out.clone().multiplyScalar(RING_ROAD.inner - 2.5).addScaledVector(side, 7.4);
    wayfinding(scene, world, signAt, Math.atan2(-out.x, -out.z), bearing === 180 ? 'Airlock N · Earthside' : 'Airlock S · Landing pad');
  }
  lamps.build(scene);
  bollards.build(scene);
}

// The monument: a dark six-sided column (its collision is unchanged from before) with
// glowing slots up each face, standing on stepped round plinths, wrapped by three tall
// bronze blades, with the old diamond light on top and a warm light under it.
function monument(scene: THREE.Object3D, world: RAPIER.World) {
  let y = PLATFORM;
  for (const [radius, height] of [
    [3.4, 0.22],
    [2.7, 0.22],
    [2.0, 0.22],
  ]) {
    solidCylinder(scene, world, 0, y, 0, radius, height, MATERIALS.graphite, 48);
    y += height;
  }
  const lift = PLATFORM; // the column itself still starts on the platform, as before
  solidCylinder(scene, world, 0, lift, 0, 1.3, 13, MATERIALS.graphite, 6); // the same column the targets and drones knew
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI * 2;
    const d = 1.3 * Math.cos(Math.PI / 6) + 0.01;
    lightStrip(scene, { x: Math.sin(a) * d, y: lift + 7.3, z: Math.cos(a) * d }, { x: 0.14, y: 10.6, z: 0.02 }, MATERIALS.softLight, a);
  }
  for (const by of [lift + 1.2, lift + 12.6]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.3, 6), MATERIALS.amberLight);
    band.position.y = by;
    scene.add(band);
  }
  // Three blades round the column.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const height = 15.2;
    const blade = new THREE.Mesh(bladeShape(height), MATERIALS.bronze);
    blade.position.copy(out.clone().multiplyScalar(1.55)).setY(y);
    blade.rotation.y = a;
    blade.castShadow = blade.receiveShadow = true;
    scene.add(blade);
    const c = out.clone().multiplyScalar(2.0);
    boxCollider(world, { x: c.x, y: y + 5, z: c.z }, { x: 0.22, y: 10, z: 1.0 }, new THREE.Euler(0, a, 0));
  }
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), MATERIALS.whiteLight);
  cap.position.y = 14.4;
  scene.add(cap);
  const glow = new THREE.PointLight(0xffa31a, 25, 35, 1.6);
  glow.position.set(0, 7, 0);
  scene.add(glow);
}

/** A tall thin blade, wide at the bottom and tapering to a point, standing out from the column (local +z out). */
function bladeShape(height: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.25, 0);
  shape.lineTo(1.25, 0);
  shape.quadraticCurveTo(1.0, height * 0.55, 0.2, height);
  shape.lineTo(-0.25, height * 0.98);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
  // The shape is drawn in x (out) and y (up); turn it so "out" is +z and center its thickness.
  geometry.translate(0, 0, -0.1);
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

/** A free-standing sign post with an arrow-style lit panel. */
function wayfinding(scene: THREE.Object3D, world: RAPIER.World, at: THREE.Vector3, yaw: number, text: string) {
  solidBox(scene, world, { x: at.x, y: 1.3, z: at.z }, { x: 0.16, y: 2.6, z: 0.16 }, MATERIALS.graphite, yaw);
  const sign = signPanel(text, 0.32, 'white');
  const width = (sign.geometry as THREE.PlaneGeometry).parameters.width;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const panelCenter = at.clone().addScaledVector(right, width / 2 + 0.1);
  solidBox(scene, world, { x: panelCenter.x, y: 2.3, z: panelCenter.z }, { x: width + 0.2, y: 0.5, z: 0.1 }, MATERIALS.graphite, yaw, false);
  for (const flip of [0, Math.PI]) {
    const face = sign.clone();
    const normal = new THREE.Vector3(Math.sin(yaw + flip), 0, Math.cos(yaw + flip));
    face.position.copy(panelCenter).addScaledVector(normal, 0.052).setY(2.3);
    face.rotation.y = yaw + flip;
    scene.add(face);
  }
}

// The plaza's stone: rings of pale slabs with dark joints, cut by radial joints, with a
// band of darker stone partway out. Mapped flat over the round top (one texture across it).
function plazaStone() {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const m = c / PLAZA_RADIUS; // pixels per meter
  const random = seededRandom(31);
  ctx.fillStyle = '#9d978d';
  ctx.fillRect(0, 0, size, size);
  // Rings of slabs, each slab its own shade.
  for (let r = 0; r < PLAZA_RADIUS; r += 1.6) {
    const pieces = Math.max(6, Math.round((2 * Math.PI * (r + 0.8)) / 1.8));
    for (let k = 0; k < pieces; k++) {
      const a0 = (k / pieces) * Math.PI * 2;
      const a1 = ((k + 1) / pieces) * Math.PI * 2;
      const band = r > 9.5 && r < 11.5;
      const shade = band ? 86 + random() * 10 : 150 + random() * 22;
      ctx.fillStyle = `rgb(${shade},${shade - 4},${shade - 10})`;
      ctx.beginPath();
      ctx.arc(c, c, (r + 1.6) * m, a0, a1);
      ctx.arc(c, c, r * m, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      // Radial joint.
      ctx.strokeStyle = 'rgba(70,66,60,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a0) * r * m, c + Math.sin(a0) * r * m);
      ctx.lineTo(c + Math.cos(a0) * (r + 1.6) * m, c + Math.sin(a0) * (r + 1.6) * m);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,66,60,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, r * m, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Brass compass points inlaid in the dark band.
  ctx.fillStyle = '#b08850';
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(a) * 10.5 * m, c + Math.sin(a) * 10.5 * m);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-0.9 * m, 0);
    ctx.lineTo(0, (k % 2 ? -0.18 : -0.3) * m);
    ctx.lineTo(0.9 * m, 0);
    ctx.lineTo(0, (k % 2 ? 0.18 : 0.3) * m);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
