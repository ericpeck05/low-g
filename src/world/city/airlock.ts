import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { MATERIALS, lightStrip, solidBox } from './kit';

type Side = 'inside' | 'outside';

const PASSAGE_HALF_WIDTH = 2.5; // the walkway is 5 m wide
const PASSAGE_HEIGHT = 4.5;
const HOUSING_HALF_WIDTH = 6.8; // wide enough to cover the gap in the dome glass
const HOUSING_HEIGHT = 7.6;
const DOOR_THICKNESS = 0.4;

// One door: two halves that slide apart into the walls.
class Door {
  open = 0; // 0 = shut, 1 = fully open
  target = 0;
  private halves: { mesh: THREE.Mesh; collider: RAPIER.Collider; side: number }[] = [];

  constructor(
    scene: THREE.Object3D,
    world: RAPIER.World,
    private place: (u: number, v: number, y: number) => THREE.Vector3,
    rotationY: number,
    readonly u: number,
    material: THREE.Material,
  ) {
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(PASSAGE_HALF_WIDTH, PASSAGE_HEIGHT, DOOR_THICKNESS), material);
      mesh.rotation.y = rotationY;
      mesh.castShadow = true;
      mesh.userData.dynamic = true; // it moves, so it can't be merged with the static city
      scene.add(mesh);
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(PASSAGE_HALF_WIDTH / 2, PASSAGE_HEIGHT / 2, DOOR_THICKNESS / 2).setRotation(mesh.quaternion),
      );
      this.halves.push({ mesh, collider, side });
    }
    this.apply();
  }

  get closed() {
    return this.open === 0;
  }

  get fullyOpen() {
    return this.open === 1;
  }

  update(dt: number, blocked: boolean) {
    const step = (CONFIG.city.airlockDoorSpeed / PASSAGE_HALF_WIDTH) * dt;
    // Never close onto someone standing in the doorway.
    const target = blocked ? Math.max(this.target, this.open) : this.target;
    this.open = target > this.open ? Math.min(target, this.open + step) : Math.max(target, this.open - step);
    this.apply();
  }

  private apply() {
    for (const half of this.halves) {
      // Closed: the halves meet in the middle. Open: each slides fully into its wall.
      const v = half.side * (PASSAGE_HALF_WIDTH / 2 + this.open * PASSAGE_HALF_WIDTH);
      const position = this.place(this.u, v, PASSAGE_HEIGHT / 2);
      half.mesh.position.copy(position);
      half.collider.setTranslation(position);
    }
  }
}

// An airlock: a tunnel through the dome wall with a door at each end.
// Only one door is ever open, so the city keeps its air:
// step into the chamber, the door behind you closes, it pressurizes, the far door opens.
export class Airlock {
  /** When locked, both doors stay shut (used to keep you outside in the oxygen run). */
  locked = false;
  private inner: Door;
  private outer: Door;
  private radial: THREE.Vector3; // points out of the dome
  private lateral: THREE.Vector3; // sideways across the tunnel
  private lastSide: Side = 'inside';
  private enteredFrom: Side | null = null;
  private cycleTimer = 0;
  private lamps: THREE.Mesh[] = [];
  private cycleStrip: THREE.Mesh;
  private time = 0;

  constructor(scene: THREE.Object3D, world: RAPIER.World, bearingDegrees: number) {
    const b = THREE.MathUtils.degToRad(bearingDegrees);
    this.radial = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
    this.lateral = new THREE.Vector3(Math.cos(b), 0, -Math.sin(b));
    const R = CONFIG.city.domeRadius;
    const start = R - 7;
    const end = R + 9;
    const length = end - start;
    const mid = (start + end) / 2;

    // Gatehouse: two thick side walls and a roof, leaving a 5 m x 4.5 m passage.
    const wallThickness = HOUSING_HALF_WIDTH - PASSAGE_HALF_WIDTH;
    for (const side of [-1, 1]) {
      const v = side * (PASSAGE_HALF_WIDTH + wallThickness / 2);
      solidBox(scene, world, this.place(mid, v, HOUSING_HEIGHT / 2), { x: wallThickness, y: HOUSING_HEIGHT, z: length }, MATERIALS.lightPanel, b);
      // An amber stripe along each outer wall.
      lightStrip(scene, this.place(mid, side * (HOUSING_HALF_WIDTH + 0.02), 2.2), { x: 0.06, y: 0.25, z: length - 1 }, MATERIALS.amberLight, b);
    }
    const roofHeight = HOUSING_HEIGHT - PASSAGE_HEIGHT;
    solidBox(scene, world, this.place(mid, 0, PASSAGE_HEIGHT + roofHeight / 2), { x: HOUSING_HALF_WIDTH * 2, y: roofHeight, z: length }, MATERIALS.lightPanel, b);
    solidBox(scene, world, this.place(mid, 0, 0.05), { x: PASSAGE_HALF_WIDTH * 2, y: 0.1, z: length }, MATERIALS.trim, b, false);
    // Ceiling light running the length of the tunnel.
    lightStrip(scene, this.place(mid, 0, PASSAGE_HEIGHT - 0.05), { x: 0.3, y: 0.06, z: length - 2 }, MATERIALS.softLight, b);

    const doorMaterial = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.2 });
    const place = (u: number, v: number, y: number) => this.place(u, v, y);
    this.inner = new Door(scene, world, place, b, R - 5, doorMaterial);
    this.outer = new Door(scene, world, place, b, R + 7, doorMaterial);

    // Status lamps above each door, on both faces.
    for (const u of [R - 5.6, R - 4.4, R + 6.4, R + 7.6]) {
      const lamp = lightStrip(scene, this.place(u, 0, PASSAGE_HEIGHT + 0.35), { x: 1.6, y: 0.3, z: 0.1 }, MATERIALS.amberLight, b);
      lamp.userData.dynamic = true; // changes color
      this.lamps.push(lamp);
    }
    // A strip in the chamber that pulses while it cycles.
    this.cycleStrip = lightStrip(
      scene,
      this.place(mid, PASSAGE_HALF_WIDTH - 0.05, 1.2),
      { x: 0.06, y: 0.15, z: 8 },
      new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xffa31a, emissiveIntensity: 0 }),
      b,
    );
  }

  /** u = meters out from the dome center along the tunnel, v = meters sideways. */
  private place(u: number, v: number, y: number) {
    return this.radial.clone().multiplyScalar(u).addScaledVector(this.lateral, v).setY(y);
  }

  /** Is this point in the chamber between the two doors? */
  inChamber(p: THREE.Vector3) {
    const { u, v } = this.local(p);
    return u > this.inner.u && u < this.outer.u && Math.abs(v) < PASSAGE_HALF_WIDTH;
  }

  update(dt: number, player: THREE.Vector3) {
    this.time += dt;
    const { u, v } = this.local(player);
    const inPassage = Math.abs(v) < PASSAGE_HALF_WIDTH + 1.5;
    const inChamber = this.inChamber(player);
    const nearInside = inPassage && u > this.inner.u - 8 && u <= this.inner.u;
    const nearOutside = inPassage && u >= this.outer.u && u < this.outer.u + 8;

    if (this.locked) {
      this.inner.target = 0;
      this.outer.target = 0;
    } else if (inChamber) {
      this.enteredFrom ??= this.lastSide;
      const behind = this.enteredFrom === 'inside' ? this.inner : this.outer;
      const ahead = this.enteredFrom === 'inside' ? this.outer : this.inner;
      behind.target = 0;
      if (behind.closed) this.cycleTimer += dt;
      if (this.cycleTimer >= CONFIG.city.airlockCycleTime) ahead.target = 1;
    } else {
      this.enteredFrom = null;
      this.cycleTimer = 0;
      if (nearInside) {
        this.lastSide = 'inside';
        this.outer.target = 0;
        this.inner.target = this.outer.closed ? 1 : 0;
      } else if (nearOutside) {
        this.lastSide = 'outside';
        this.inner.target = 0;
        this.outer.target = this.inner.closed ? 1 : 0;
      } else {
        this.inner.target = 0;
        this.outer.target = 0;
      }
    }

    const inDoorway = (door: Door) => Math.abs(u - door.u) < 0.9 && Math.abs(v) < PASSAGE_HALF_WIDTH;
    this.inner.update(dt, inDoorway(this.inner));
    this.outer.update(dt, inDoorway(this.outer));

    // Lamps: white when that door is open, amber otherwise. The chamber strip pulses while cycling.
    this.lamps.forEach((lamp, i) => {
      const door = i < 2 ? this.inner : this.outer;
      lamp.material = this.locked ? MATERIALS.orangeLight : door.fullyOpen ? MATERIALS.whiteLight : MATERIALS.amberLight;
    });
    const cycling = inChamber && this.cycleTimer > 0 && this.cycleTimer < CONFIG.city.airlockCycleTime;
    (this.cycleStrip.material as THREE.MeshStandardMaterial).emissiveIntensity = cycling
      ? 1.5 + Math.sin(this.time * 18) * 1.5
      : 0.2;
  }

  private local(p: THREE.Vector3) {
    return { u: p.x * this.radial.x + p.z * this.radial.z, v: p.x * this.lateral.x + p.z * this.lateral.z };
  }
}

// Dark door panels with amber and black warning stripes along the edges.
function hazardTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2f2d2a';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, 18);
  ctx.rect(0, size - 18, size, 18);
  ctx.clip();
  for (let x = -size; x < size * 2; x += 24) {
    ctx.fillStyle = '#ffa31a';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 12, 0);
    ctx.lineTo(x + 12 - size, size);
    ctx.lineTo(x - size, size);
    ctx.fill();
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
