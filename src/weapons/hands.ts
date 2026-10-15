import * as THREE from 'three';
import { seededRandom } from '../world/noise';

// Spacesuit gloves and sleeves holding the rifle, built from simple rounded shapes.
// Positions are in gun space (see rifleModel.ts): x right, y up, -z forward.

const GLOVE = new THREE.MeshStandardMaterial({ color: 0xe6e1d7, roughness: 0.86, bumpMap: fabricTexture(), bumpScale: 0.8 });
const PAD = new THREE.MeshStandardMaterial({ color: 0x3a3835, roughness: 0.75 }); // rubber grip pads
const RING = new THREE.MeshStandardMaterial({ color: 0xd08422, roughness: 0.32, metalness: 0.85 }); // anodized wrist disconnect
const SLEEVE = new THREE.MeshStandardMaterial({ color: 0xdedad1, roughness: 0.92, bumpMap: fabricTexture(), bumpScale: 1.2 });

function part(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A rounded segment (finger bone, thumb) between two points. */
function segment(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material = GLOVE) {
  const length = from.distanceTo(to);
  const m = part(new THREE.CapsuleGeometry(radius, length, 4, 10), material, parent);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return m;
}

/** A soft rounded lump (palm, back of the hand). */
function lump(parent: THREE.Object3D, center: THREE.Vector3, radii: THREE.Vector3, rotation = new THREE.Euler()) {
  const m = part(new THREE.SphereGeometry(1, 20, 14), GLOVE, parent);
  m.position.copy(center);
  m.scale.copy(radii);
  m.rotation.copy(rotation);
  return m;
}

/**
 * Fingers wrapped around a handle: curved tubes around `axis` through `center`.
 * Angles are measured around the axis from `zero` (a direction at right angles to it),
 * turning from `zero` toward axis x zero. Each finger runs from its tip at `tipAngle`
 * through `sweep` radians back to the knuckles.
 */
function wrapFingers(
  parent: THREE.Object3D,
  center: THREE.Vector3,
  axis: THREE.Vector3,
  zero: THREE.Vector3,
  handleRadius: number,
  offsets: number[],
  tipAngle: number,
  sweep: number,
) {
  const tubeRadius = 0.0105;
  const ringRadius = handleRadius + tubeRadius * 0.9;
  const x = zero.clone().normalize();
  const z = axis.clone().normalize();
  const y = z.clone().cross(x).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, y, z);
  offsets.forEach((offset, i) => {
    // The little finger is shorter: its tip doesn't reach as far around.
    const shorten = i === offsets.length - 1 ? sweep * 0.15 : 0;
    const start = tipAngle + shorten;
    const finger = part(new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 20, sweep - shorten), GLOVE, parent);
    finger.quaternion.setFromRotationMatrix(basis);
    finger.rotateZ(start);
    finger.position.copy(center).addScaledVector(z, offset);
    // A rubber pad on the fingertip.
    const tip = center
      .clone()
      .addScaledVector(z, offset)
      .addScaledVector(x, Math.cos(start) * ringRadius)
      .addScaledVector(y, Math.sin(start) * ringRadius);
    const pad = part(new THREE.SphereGeometry(tubeRadius * 1.05, 10, 8), PAD, parent);
    pad.position.copy(tip);
  });
}

/** Wrist ring and a folded fabric sleeve running from the wrist toward the elbow. */
function forearm(parent: THREE.Object3D, wrist: THREE.Vector3, direction: THREE.Vector3, seed: number) {
  const dir = direction.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const turn = new THREE.Quaternion().setFromUnitVectors(up, dir);

  // Glove gauntlet between the hand and the ring.
  const gauntlet = part(new THREE.CylinderGeometry(0.04, 0.036, 0.06, 20), GLOVE, parent);
  gauntlet.quaternion.copy(turn);
  gauntlet.position.copy(wrist).addScaledVector(dir, -0.025);
  // The ring (EVA suits lock gloves on with a metal bearing ring at the wrist).
  const ring = part(new THREE.CylinderGeometry(0.047, 0.047, 0.022, 28), RING, parent);
  ring.quaternion.copy(turn);
  ring.position.copy(wrist).addScaledVector(dir, 0.012);
  // Sleeve with soft folds.
  const length = 0.55;
  const sleeveGeometry = new THREE.CylinderGeometry(0.06, 0.05, length, 28, 24, true);
  const random = seededRandom(seed);
  const phases = [random() * 6, random() * 6, random() * 6];
  const p = sleeveGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const angle = Math.atan2(z, x);
    // Rings of folds along the arm, uneven around it.
    const fold = Math.sin(y * 55 + phases[0] + Math.sin(angle * 2 + phases[1]) * 1.5) * 0.004 + Math.sin(angle * 3 + phases[2]) * 0.002;
    const scale = 1 + fold / 0.055;
    p.setXYZ(i, x * scale, y, z * scale);
  }
  sleeveGeometry.computeVertexNormals();
  const sleeve = part(sleeveGeometry, SLEEVE, parent);
  sleeve.quaternion.copy(turn);
  sleeve.position.copy(wrist).addScaledVector(dir, 0.022 + length / 2);
}

export interface Hands {
  right: THREE.Group;
  left: THREE.Group;
}

export function buildHands(): Hands {
  return { right: buildRightHand(), left: buildLeftHand() };
}

// Right hand on the pistol grip. The palm is on the right side of the grip, the
// fingers wrap around the front to the left side, and the thumb lies along the left.
function buildRightHand() {
  const hand = new THREE.Group();
  const gripTop = new THREE.Vector3(0, -0.04, 0.05);
  const gripBottom = new THREE.Vector3(0, -0.14, 0.083);
  const axis = gripBottom.clone().sub(gripTop).normalize();
  const center = gripTop.clone().lerp(gripBottom, 0.08);
  // Middle, ring and little finger: tips on the left side, wrapping around the
  // front of the grip to the knuckles on the right. (Here angle 0 is the right
  // side and -90 degrees is the front of the grip.)
  wrapFingers(hand, center, axis, new THREE.Vector3(1, 0, 0), 0.022, [0.028, 0.05, 0.072], -Math.PI - 0.25, Math.PI * 1.2);

  // Index finger along the frame and onto the trigger.
  const knuckle = new THREE.Vector3(0.027, -0.044, 0.028);
  const middle = new THREE.Vector3(0.018, -0.05, -0.004);
  const tip = new THREE.Vector3(0.004, -0.06, -0.008);
  segment(hand, knuckle, middle, 0.0095);
  segment(hand, middle, tip, 0.009);

  // Palm and back of the hand, wrapped behind the grip.
  lump(hand, new THREE.Vector3(0.026, -0.08, 0.085), new THREE.Vector3(0.03, 0.05, 0.042), new THREE.Euler(0.3, 0, 0.1));
  lump(hand, new THREE.Vector3(0.012, -0.056, 0.098), new THREE.Vector3(0.036, 0.034, 0.036));

  // Thumb: from the base of the hand up and along the left side of the receiver.
  const thumbBase = new THREE.Vector3(-0.012, -0.05, 0.085);
  const thumbMiddle = new THREE.Vector3(-0.03, -0.034, 0.055);
  const thumbTip = new THREE.Vector3(-0.034, -0.026, 0.025);
  segment(hand, thumbBase, thumbMiddle, 0.012);
  segment(hand, thumbMiddle, thumbTip, 0.0105);
  part(new THREE.SphereGeometry(0.0108, 10, 8), PAD, hand).position.copy(thumbTip);

  // Wrist and arm going back toward the shoulder (down and to the right on screen).
  forearm(hand, new THREE.Vector3(0.03, -0.1, 0.15), new THREE.Vector3(0.45, -0.42, 0.78), 3);
  return hand;
}

// Left hand under the handguard: palm below, fingers up the right side,
// thumb along the left side.
function buildLeftHand() {
  const hand = new THREE.Group();
  const center = new THREE.Vector3(0, 0.03, -0.31);
  const axis = new THREE.Vector3(0, 0, -1);
  // Fingers: tips up on the top-right, wrapping down the right side to the palm
  // underneath. (Here angle 0 is the right side and +90 degrees is straight down.)
  wrapFingers(hand, center, axis, new THREE.Vector3(1, 0, 0), 0.034, [-0.03, -0.009, 0.012, 0.033], -Math.PI / 4 - 0.1, Math.PI * 0.95);

  // Palm under the handguard and slightly to the left.
  lump(hand, new THREE.Vector3(-0.012, -0.022, -0.31), new THREE.Vector3(0.04, 0.026, 0.054), new THREE.Euler(0, 0, 0.35));
  // Thumb along the left side, pointing forward.
  const thumbBase = new THREE.Vector3(-0.035, -0.012, -0.29);
  const thumbMiddle = new THREE.Vector3(-0.044, 0.018, -0.33);
  const thumbTip = new THREE.Vector3(-0.04, 0.034, -0.37);
  segment(hand, thumbBase, thumbMiddle, 0.012);
  segment(hand, thumbMiddle, thumbTip, 0.0105);
  part(new THREE.SphereGeometry(0.0108, 10, 8), PAD, hand).position.copy(thumbTip);

  // Wrist and arm going down and back to the left.
  forearm(hand, new THREE.Vector3(-0.035, -0.07, -0.27), new THREE.Vector3(-0.4, -0.62, 0.68), 7);
  return hand;
}

// A fine woven-fabric bump texture for the gloves and sleeves.
function fabricTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(91);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = Math.sin((x / size) * Math.PI * 16) * Math.sin((y / size) * Math.PI * 16);
      const v = 128 + weave * 40 + (random() - 0.5) * 30;
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
