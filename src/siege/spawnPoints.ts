import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { MATERIALS } from '../world/city/kit';
import { LANDING_PAD, MODULES_CENTER, TOWERS, towerPosition } from '../world/city/layout';
import { terrainHeight } from '../world/terrain';
import { glowTexture } from './glowTexture';

// Where hostile drones come in: vents high in the dome's glass roof, hangar bays on
// the two tall towers, hatches on the short towers' rooftop huts, and, out on the
// surface, drops from high above. Each one glows red for a moment before a drone
// comes out, so you can see where it's coming from.

export type SpawnKind = 'roofVent' | 'hangar' | 'hatch' | 'skyDrop';

export interface SpawnPoint {
  kind: SpawnKind;
  /** Which part of the map it serves. Siege phase 5 splits the dome into sections behind doors. */
  area: string;
  position: THREE.Vector3; // where the drone appears
  exit: THREE.Vector3; // the way it flies out
  inside: boolean; // inside the dome
  warning: boolean; // glowing: a drone is about to come out
  warmup: number; // 0 to 1: how far along the warning is
  cooldown: number; // seconds before it can be used again
  glow: THREE.MeshBasicMaterial | null; // the red light on its fixture (sky drops have none)
  flare: THREE.Sprite;
}

const HOSTILE = new THREE.Color(...CONFIG.siege.glowColor);
const FLARE_SIZE: Record<SpawnKind, number> = { roofVent: 6, hangar: 4, hatch: 3.2, skyDrop: 8 }; // meters across

export class SpawnPoints {
  readonly points: SpawnPoint[] = [];
  /** The lights and flares, shown only during Drone Siege (the dark fixtures are always there). */
  readonly lights = new THREE.Group();
  /** Areas whose spawn points are in use. Everything is open until Siege phase 5 adds doors. */
  readonly unlocked = new Set(['dome', 'surface']);
  private frames: THREE.BufferGeometry[] = []; // light metal rims
  private openings: THREE.BufferGeometry[] = []; // the black holes inside them
  private time = 0;

  constructor(scene: THREE.Scene) {
    const flareTexture = glowTexture();
    const add = (kind: SpawnKind, area: string, position: THREE.Vector3, exit: THREE.Vector3, glow: THREE.Mesh | null) => {
      const flare = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: flareTexture, color: HOSTILE, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      flare.position.copy(position);
      flare.visible = false;
      this.lights.add(flare);
      if (glow) this.lights.add(glow);
      this.points.push({
        kind,
        area,
        position,
        exit: exit.normalize(),
        inside: area !== 'surface',
        warning: false,
        warmup: 0,
        cooldown: 0,
        glow: glow ? (glow.material as THREE.MeshBasicMaterial) : null,
        flare,
      });
    };

    // Vents in the glass roof, opening downward into the dome.
    const { domeRadius: R, domeHeight: H } = CONFIG.city;
    for (const bearing of [20, 110, 200, 290]) {
      const b = THREE.MathUtils.degToRad(bearing);
      const across = 30;
      const surface = new THREE.Vector3(Math.sin(b) * across, H * Math.sqrt(1 - (across / R) ** 2), Math.cos(b) * across);
      const inward = new THREE.Vector3(-surface.x / (R * R), -surface.y / (H * H), -surface.z / (R * R)).normalize();
      const at = surface.clone().addScaledVector(inward, 0.35);
      this.frame(new THREE.TorusGeometry(1.9, 0.2, 8, 32), at, inward);
      this.opening(new THREE.CircleGeometry(1.8, 32), surface.clone().addScaledVector(inward, 0.3), inward);
      add('roofVent', 'dome', surface.clone().addScaledVector(inward, 2.6), inward, this.ring(1.6, at, inward));
    }

    TOWERS.forEach((tower) => {
      const p = towerPosition(tower);
      if (tower.height > 25) {
        // Tall towers: a hangar bay on the face looking toward the plaza.
        const { normal, distance } = plazaFace(p, tower.radius, tower.sides);
        const at = p.clone().addScaledVector(normal, distance).setY(tower.height * 0.7);
        this.hangarFrame(at, normal);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.14, 0.14), glowMaterial());
        strip.position.copy(at).addScaledVector(normal, 0.68).setY(at.y + 1.25); // along the front of the lintel
        strip.lookAt(strip.position.clone().add(normal));
        add('hangar', 'dome', at.clone().addScaledVector(normal, 1.6), normal.clone().setY(0.15), strip);
      } else {
        // Short towers: a hatch on top of the rooftop hut, opening upward.
        const at = new THREE.Vector3(p.x, tower.height + 2.42, p.z);
        const up = new THREE.Vector3(0, 1, 0);
        this.frame(new THREE.TorusGeometry(0.85, 0.11, 8, 24), at, up);
        this.opening(new THREE.CircleGeometry(0.8, 24), at.clone().setY(at.y + 0.01), up);
        add('hatch', 'dome', at.clone().setY(at.y + 1.3), up, this.ring(0.68, at.clone().setY(at.y + 0.04), up));
      }
    });

    // Out on the surface, drones drop in from high above (no air to slow them, so they
    // brake on their own thrusters).
    const drop = (x: number, z: number) => {
      const position = new THREE.Vector3(x, terrainHeight(x, z) + 42, z);
      const towardDome = new THREE.Vector3(-x, 0, -z).normalize().multiplyScalar(0.3);
      add('skyDrop', 'surface', position, new THREE.Vector3(0, -1, 0).add(towardDome), null);
    };
    for (const bearing of [45, 135, 225, 315]) {
      const b = THREE.MathUtils.degToRad(bearing);
      drop(Math.sin(b) * 135, Math.cos(b) * 135);
    }
    drop(MODULES_CENTER.x, MODULES_CENTER.z);
    drop(LANDING_PAD.x + 20, LANDING_PAD.z + 10);

    const frames = new THREE.Mesh(mergeGeometries(this.frames)!, MATERIALS.lightPanel);
    frames.castShadow = true;
    frames.receiveShadow = true;
    // Unlit black, so the openings read as holes into the dark whatever the light.
    const openings = new THREE.Mesh(mergeGeometries(this.openings)!, new THREE.MeshBasicMaterial({ color: 0x050505 }));
    scene.add(frames, openings, this.lights);
    this.lights.visible = false;
  }

  /** Choose where the next drone comes in: a free point on your side of the dome, near-ish to you. */
  pick(player: THREE.Vector3, playerInside: boolean, nearest?: number) {
    const [usualMin, max] = CONFIG.siege.rounds.spawnRange;
    const min = nearest ?? usualMin;
    const usable = this.points.filter(
      (p) => this.unlocked.has(p.area) && p.inside === playerInside && !p.warning && p.cooldown <= 0,
    );
    const inRange = usable.filter((p) => {
      const d = p.position.distanceTo(player);
      return d >= min && d <= max;
    });
    const choices = inRange.length > 0 ? inRange : usable;
    if (choices.length === 0) return null;
    // Nearer points are a little likelier, so the drones come to you.
    const weights = choices.map((p) => 1 / (1 + p.position.distanceTo(player) / 30));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < choices.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return choices[i];
    }
    return choices[choices.length - 1];
  }

  /** Light a point up: a drone is coming out of it shortly. */
  warn(point: SpawnPoint) {
    point.warning = true;
    point.warmup = 0;
  }

  /** The drone has come out: the point rests a moment before it can be used again. */
  release(point: SpawnPoint) {
    point.warning = false;
    point.cooldown = 0.6;
  }

  setActive(active: boolean) {
    this.lights.visible = active;
    if (!active) {
      for (const p of this.points) {
        p.warning = false;
        p.cooldown = 0;
      }
    }
  }

  update(dt: number) {
    this.time += dt;
    for (const p of this.points) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.warning) p.warmup = Math.min(1, p.warmup + dt / CONFIG.siege.rounds.spawnWarning);
      // A quickening red pulse while a drone is on its way out; a dim glow otherwise, so
      // you learn where they come from.
      const pulse = p.warning ? 0.5 + 0.5 * Math.sin(this.time * (10 + p.warmup * 18)) : 0;
      if (p.glow) p.glow.color.copy(HOSTILE).multiplyScalar(p.warning ? 1.5 + pulse * 4 : 1);
      p.flare.visible = p.warning;
      if (p.warning) {
        p.flare.scale.setScalar(FLARE_SIZE[p.kind] * (0.6 + p.warmup * 0.5 + pulse * 0.2));
        (p.flare.material as THREE.SpriteMaterial).opacity = 0.35 + p.warmup * 0.5;
      }
    }
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects() {
    return [this.lights];
  }

  // A dark fixture ring, facing `normal`, merged into one mesh with the others.
  private frame(geometry: THREE.BufferGeometry, at: THREE.Vector3, normal: THREE.Vector3) {
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    geometry.translate(at.x, at.y, at.z);
    this.frames.push(clean(geometry));
  }

  // A black opening (a flat shape facing `normal`), merged with the others.
  private opening(geometry: THREE.BufferGeometry, at: THREE.Vector3, normal: THREE.Vector3) {
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal));
    geometry.translate(at.x, at.y, at.z);
    this.openings.push(clean(geometry));
  }

  // A glowing ring inside a fixture.
  private ring(radius: number, at: THREE.Vector3, normal: THREE.Vector3) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 6, 28), glowMaterial());
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.position.copy(at);
    return mesh;
  }

  // A hangar bay: a frame around a dark opening, on a tower wall facing `normal`.
  private hangarFrame(at: THREE.Vector3, normal: THREE.Vector3) {
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const box = new THREE.BoxGeometry(w, h, d).translate(x, y, z).applyQuaternion(turn);
      box.translate(at.x, at.y, at.z);
      this.frames.push(clean(box));
    };
    const back = new THREE.PlaneGeometry(3.3, 2.3).translate(0, 0, 0.24).applyQuaternion(turn);
    back.translate(at.x, at.y, at.z);
    this.openings.push(clean(back)); // the dark inside of the bay
    part(3.8, 0.3, 0.6, 0, 1.25, 0.3); // lintel
    part(3.8, 0.3, 0.6, 0, -1.25, 0.3); // sill
    part(0.3, 2.8, 0.6, -1.75, 0, 0.3); // sides
    part(0.3, 2.8, 0.6, 1.75, 0, 0.3);
  }
}

/** The face of a tower (a prism with `sides` faces) that looks most toward the plaza. */
export function plazaFace(position: THREE.Vector3, radius: number, sides: number) {
  const toward = position.clone().setY(0).negate().normalize();
  let best = new THREE.Vector3();
  let bestDot = -Infinity;
  for (let k = 0; k < sides; k++) {
    const angle = ((k + 0.5) / sides) * Math.PI * 2; // faces sit between the corners
    const normal = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const dot = normal.dot(toward);
    if (dot > bestDot) {
      bestDot = dot;
      best = normal;
    }
  }
  return { normal: best, distance: radius * Math.cos(Math.PI / sides) };
}

function glowMaterial() {
  return new THREE.MeshBasicMaterial({ color: HOSTILE.clone().multiplyScalar(0.25) });
}

// Same attributes on every part, so they can be merged into one mesh.
function clean(geometry: THREE.BufferGeometry) {
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  return geometry.index ? geometry.toNonIndexed() : geometry;
}
