import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { glowTexture } from './glowTexture';

// The Singularity Launcher's shots. A round flies out glowing, and where it hits something
// (or after a moment in the air) it collapses into a small black hole for a few seconds:
// drones nearby are dragged toward it, and the ones that get close are crushed. When it
// ends it lets go in one last burst. Pooled: at most a few at once.

const MAX = 4;
const SPIRAL = 10; // glowing motes circling in, per black hole

export interface Pull {
  center: THREE.Vector3;
  radius: number;
  strength: number; // m/s² at the middle
  crushRadius: number;
  damagePerSecond: number;
}

interface Shot {
  active: boolean;
  phase: 'flying' | 'hole';
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  timer: number;
  scale: number; // overclocked shots make bigger holes
  root: THREE.Group;
  round: THREE.Mesh;
  hole: THREE.Group;
  disk: THREE.Mesh;
  halo: THREE.Sprite;
  motes: THREE.Sprite[];
}

export type SingularityEvent = { kind: 'formed' | 'collapsed'; position: THREE.Vector3; radius: number };

export class Singularities {
  readonly group = new THREE.Group();
  private shots: Shot[] = [];
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private ignore: RAPIER.Collider | undefined; // the player who fired (the round starts inside their reach)

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
  ) {
    const glow = glowTexture();
    const roundMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 2.4) });
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const diskMaterial = new THREE.MeshBasicMaterial({ map: diskTexture(), color: new THREE.Color(4, 2.2, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const rimMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.6) });
    for (let i = 0; i < MAX; i++) {
      const root = new THREE.Group();
      const round = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), roundMaterial);
      root.add(round);
      const hole = new THREE.Group();
      hole.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), coreMaterial));
      // A thin white-hot ring hugging the dark core, so it stands out even against black sky.
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 8, 48), rimMaterial);
      hole.add(rim);
      const disk = new THREE.Mesh(new THREE.RingGeometry(0.62, 2.2, 64, 1), diskMaterial);
      disk.rotation.x = -Math.PI / 2 + 0.35;
      hole.add(disk);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(2.4, 1.2, 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      halo.scale.setScalar(7);
      hole.add(halo);
      const motes: THREE.Sprite[] = [];
      for (let k = 0; k < SPIRAL; k++) {
        const mote = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(3, 2, 1.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        mote.scale.setScalar(0.35);
        hole.add(mote);
        motes.push(mote);
      }
      root.add(hole);
      root.visible = false;
      this.group.add(root);
      this.shots.push({ active: false, phase: 'flying', position: new THREE.Vector3(), velocity: new THREE.Vector3(), timer: 0, scale: 1, root, round, hole, disk, halo, motes });
    }
    scene.add(this.group);
  }

  get glowObjects(): THREE.Object3D[] {
    return [this.group];
  }

  /** Fire one from `from` along `direction`. */
  launch(from: THREE.Vector3, direction: THREE.Vector3, overclocked: boolean, shooter: RAPIER.Collider) {
    this.ignore = shooter;
    const shot = this.shots.find((s) => !s.active) ?? this.shots[0];
    shot.active = true;
    shot.phase = 'flying';
    shot.position.copy(from);
    shot.velocity.copy(direction).multiplyScalar(CONFIG.siege.singularity.speed);
    shot.timer = CONFIG.siege.singularity.life;
    shot.scale = overclocked ? 1.4 : 1;
    shot.root.visible = true;
    shot.round.visible = true;
    shot.hole.visible = false;
  }

  /** The black holes pulling right now (for the drones). */
  pulls(): Pull[] {
    const c = CONFIG.siege.singularity;
    return this.shots
      .filter((s) => s.active && s.phase === 'hole')
      .map((s) => ({ center: s.position, radius: c.pullRadius * s.scale, strength: c.pull, crushRadius: c.crushRadius * s.scale, damagePerSecond: c.damagePerSecond * s.scale }));
  }

  update(dt: number, events: SingularityEvent[]) {
    const c = CONFIG.siege.singularity;
    for (const shot of this.shots) {
      if (!shot.active) continue;
      shot.timer -= dt;
      if (shot.phase === 'flying') {
        // Fly on, and collapse on whatever's in the way (a drone or a wall) or when its time is up.
        const step = shot.velocity.length() * dt;
        this.ray.origin = shot.position;
        this.ray.dir = shot.velocity.clone().normalize();
        const hit = this.world.castRay(this.ray, step + 0.2, true, undefined, undefined, this.ignore);
        if (hit) shot.position.addScaledVector(shot.velocity.clone().normalize(), Math.max(0, hit.timeOfImpact - 0.6));
        else shot.position.addScaledVector(shot.velocity, dt);
        if (hit || shot.timer <= 0) {
          shot.phase = 'hole';
          shot.timer = c.duration;
          shot.round.visible = false;
          shot.hole.visible = true;
          events.push({ kind: 'formed', position: shot.position.clone(), radius: c.pullRadius * shot.scale });
        }
      } else {
        // The hole: swells in, spins, shrinks away at the end.
        const age = c.duration - shot.timer;
        const size = Math.min(1, age / 0.3) * Math.min(1, shot.timer / 0.35 + 0.2) * shot.scale;
        shot.hole.scale.setScalar(Math.max(0.01, size));
        shot.disk.rotation.z += dt * 4;
        shot.halo.material.opacity = 0.6 + 0.3 * Math.sin(age * 9);
        shot.motes.forEach((mote, k) => {
          const t = (age * 0.9 + k / SPIRAL) % 1;
          const a = k * 2.4 + age * (3 + k * 0.2);
          const r = 3.2 * (1 - t);
          mote.position.set(Math.cos(a) * r, (k % 2 ? 1 : -1) * 0.4 * (1 - t), Math.sin(a) * r);
          mote.material.opacity = t;
        });
        if (shot.timer <= 0) {
          shot.active = false;
          shot.root.visible = false;
          events.push({ kind: 'collapsed', position: shot.position.clone(), radius: c.crushRadius * 1.6 * shot.scale });
        }
      }
      shot.root.position.copy(shot.position);
    }
  }

  clear() {
    for (const shot of this.shots) {
      shot.active = false;
      shot.root.visible = false;
    }
  }

  /** Show one of each part for a frame at load, so their shaders compile then. */
  showForWarmUp(shown: boolean) {
    const shot = this.shots[0];
    shot.root.visible = shown;
    shot.round.visible = shown;
    shot.hole.visible = shown;
  }
}

/** The accretion disk: bright at its inner edge, fading out, with streaks for spin. */
function diskTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  for (let a = 0; a < 360; a += 3) {
    const radians = (a * Math.PI) / 180;
    const streak = 0.5 + 0.5 * Math.sin(a * 0.31) * Math.sin(a * 0.07);
    const gradient = ctx.createLinearGradient(c, c, c + Math.cos(radians) * c, c + Math.sin(radians) * c);
    gradient.addColorStop(0.25, `rgba(255,255,255,${0.9 * (0.6 + 0.4 * streak)})`);
    gradient.addColorStop(0.55, `rgba(255,255,255,${0.35 * streak})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(radians) * c, c + Math.sin(radians) * c);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}
