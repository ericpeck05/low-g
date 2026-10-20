import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildMagazine } from './rifleModel';

// Things the rifle throws out into the world: spent brass casings on every shot
// and empty magazines on a reload. They fly in slow arcs under moon gravity with
// no air to slow them, bounce off whatever is below, and lie there for a while.

interface Piece {
  object: THREE.Object3D | null; // magazines are their own meshes; casings live in an instanced mesh
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3; // radians per second
  rotation: THREE.Quaternion;
  radius: number; // how far the piece sits above the floor when resting
  floor: number;
  floorCheck: number; // seconds until we look for the floor again
  age: number;
  life: number;
  resting: boolean;
}

/** A casing or magazine hitting something, for its sound. */
export interface BounceEvent {
  magazine: boolean;
  position: THREE.Vector3;
  loudness: number; // 0 to 1, from how fast it hit
}

const MAX_CASINGS = 90;
const MAX_MAGAZINES = 6;
const BRASS = new THREE.MeshStandardMaterial({ color: 0xc69b4c, metalness: 1, roughness: 0.28 });

export class Ejecta {
  private casings: Piece[] = [];
  private magazines: Piece[] = [];
  private casingMesh: THREE.InstancedMesh;
  // Every dropped magazine is a copy of this one (they share its shape and materials).
  // It sits in the scene hidden, so its shaders get compiled at load with everything else.
  private magazineTemplate = buildMagazine();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private bounces: BounceEvent[] = [];

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    private ignore: RAPIER.Collider,
  ) {
    this.casingMesh = new THREE.InstancedMesh(casingGeometry(), BRASS, MAX_CASINGS);
    this.casingMesh.count = 0;
    this.casingMesh.castShadow = true;
    this.casingMesh.frustumCulled = false;
    scene.add(this.casingMesh);
    this.magazineTemplate.visible = false;
    scene.add(this.magazineTemplate);
  }

  casing(position: THREE.Vector3, velocity: THREE.Vector3) {
    if (this.casings.length >= MAX_CASINGS) this.casings.shift();
    this.casings.push(this.makePiece(null, position, velocity, 0.005, 8, new THREE.Vector3(rand(25), rand(40), rand(25))));
  }

  /** `matrix` is the magazine's world transform at the moment it comes out of the gun. */
  magazine(matrix: THREE.Matrix4, velocity: THREE.Vector3) {
    if (this.magazines.length >= MAX_MAGAZINES) {
      const old = this.magazines.shift()!;
      this.scene.remove(old.object!);
    }
    const mag = this.magazineTemplate.clone();
    mag.visible = true;
    this.scene.add(mag);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    matrix.decompose(position, rotation, new THREE.Vector3());
    const piece = this.makePiece(mag, position, velocity, 0.014, 25, new THREE.Vector3(rand(2.5), rand(1), rand(2.5)));
    piece.rotation.copy(rotation);
    this.magazines.push(piece);
  }

  update(dt: number) {
    const matrix = new THREE.Matrix4();
    for (const list of [this.casings, this.magazines]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age > p.life) {
          if (p.object) this.scene.remove(p.object);
          list.splice(i, 1);
          continue;
        }
        if (!p.resting) this.simulate(p, dt);
        // Shrink away at the very end.
        const fade = Math.min(1, (p.life - p.age) / 0.6);
        if (p.object) {
          p.object.position.copy(p.position);
          p.object.quaternion.copy(p.rotation);
          p.object.scale.setScalar(fade);
        }
      }
    }
    this.casings.forEach((p, i) => {
      matrix.compose(p.position, p.rotation, new THREE.Vector3(1, 1, 1).multiplyScalar(Math.min(1, (p.life - p.age) / 0.6)));
      this.casingMesh.setMatrixAt(i, matrix);
    });
    this.casingMesh.count = this.casings.length;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }

  /** Bounces since the last call (and forget them). */
  takeBounces() {
    const bounces = this.bounces;
    this.bounces = [];
    return bounces;
  }

  clear() {
    for (const m of this.magazines) this.scene.remove(m.object!);
    this.magazines = [];
    this.casings = [];
    this.casingMesh.count = 0;
  }

  private makePiece(object: THREE.Object3D | null, position: THREE.Vector3, velocity: THREE.Vector3, radius: number, life: number, spin: THREE.Vector3): Piece {
    const piece: Piece = {
      object,
      position: position.clone(),
      velocity: velocity.clone(),
      spin,
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(3), rand(3), rand(3))),
      radius,
      floor: -1000,
      floorCheck: 0,
      age: 0,
      life,
      resting: false,
    };
    this.findFloor(piece);
    return piece;
  }

  private simulate(p: Piece, dt: number) {
    p.velocity.y -= CONFIG.gravity * dt;
    p.position.addScaledVector(p.velocity, dt);
    const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt));
    p.rotation.multiply(turn);

    p.floorCheck -= dt;
    if (p.floorCheck <= 0) this.findFloor(p);
    if (p.position.y < p.floor + p.radius && p.velocity.y < 0) {
      p.position.y = p.floor + p.radius;
      const loudness = Math.min(1, -p.velocity.y / 2.5);
      if (loudness > 0.08) this.bounces.push({ magazine: p.object !== null, position: p.position.clone(), loudness });
      // Bounce: lose most of the speed, keep tumbling a little less each time.
      p.velocity.y *= -0.32;
      p.velocity.x *= 0.55;
      p.velocity.z *= 0.55;
      p.spin.multiplyScalar(0.5);
      if (p.velocity.lengthSq() < 0.04) {
        p.resting = true;
        // Lie flat: keep only the turn around the vertical axis.
        const euler = new THREE.Euler().setFromQuaternion(p.rotation, 'YXZ');
        p.rotation.setFromEuler(new THREE.Euler(Math.PI / 2, euler.y, 0, 'YXZ'));
        if (p.object) p.rotation.setFromEuler(new THREE.Euler(0, euler.y, Math.PI / 2, 'YXZ'));
      }
    }
  }

  // Look straight down for the nearest surface (ground, floor, rooftop).
  private findFloor(p: Piece) {
    p.floorCheck = 0.12;
    this.ray.origin = { x: p.position.x, y: p.position.y + 0.2, z: p.position.z };
    const hit = this.world.castRay(this.ray, 60, true, undefined, undefined, this.ignore);
    p.floor = hit ? p.position.y + 0.2 - hit.timeOfImpact : -1000;
  }
}

function rand(amount: number) {
  return (Math.random() * 2 - 1) * amount;
}

// A 5.56 mm-style casing: straight body, shoulder, neck, rim. Lying along its length (y).
function casingGeometry() {
  const points = [
    [0, -0.0225],
    [0.0047, -0.0225],
    [0.0047, -0.0215],
    [0.0043, -0.0205],
    [0.0048, -0.019],
    [0.0045, 0.012],
    [0.0032, 0.0165],
    [0.0031, 0.0225],
    [0, 0.0225],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const geometry = new THREE.LatheGeometry(points, 12);
  geometry.computeVertexNormals();
  return geometry;
}
