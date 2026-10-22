import * as THREE from 'three';
import { CONFIG } from '../config';
import { glowTexture } from './glowTexture';
import { type IconId, drawIcon } from './icons';

// Power-ups, dropped now and then by destroyed drones (and always by the last drone of a
// swarm round). They hang in the air, bobbing, for twenty seconds, blinking toward the
// end; walk into one to take it.
//   Max Ammo      - every gun full
//   Double Points - all points doubled for 30 s
//   One Shot      - every hit destroys a drone for 30 s (not the carrier)
//   EMP Blast     - every drone flying goes down at once (not the carrier)
//   O2 Surge      - a full tank of oxygen

export type PowerUpKind = 'maxAmmo' | 'doublePoints' | 'oneShot' | 'emp' | 'o2';
export const POWER_UP_NAMES: Record<PowerUpKind, string> = {
  maxAmmo: 'MAX AMMO',
  doublePoints: 'DOUBLE POINTS',
  oneShot: 'ONE SHOT',
  emp: 'EMP BLAST',
  o2: 'O2 SURGE',
};
const WEIGHTS: Record<PowerUpKind, number> = { maxAmmo: 1.2, doublePoints: 1, oneShot: 0.9, emp: 0.6, o2: 0.6 };
const MAX_OUT = 6;

interface Token {
  kind: PowerUpKind;
  active: boolean;
  age: number;
  position: THREE.Vector3;
  root: THREE.Group;
}

export class PowerUps {
  readonly group = new THREE.Group();
  /** Seconds left on the timed ones (0 when off). */
  readonly timers: Record<'doublePoints' | 'oneShot', number> = { doublePoints: 0, oneShot: 0 };
  private tokens: Token[] = [];
  private icons = new Map<PowerUpKind, THREE.SpriteMaterial>();
  private ring: THREE.MeshBasicMaterial;
  private droppedThisRound = 0;
  private time = 0;

  constructor(scene: THREE.Scene) {
    for (const kind of Object.keys(POWER_UP_NAMES) as PowerUpKind[]) {
      this.icons.set(kind, new THREE.SpriteMaterial({ map: iconTexture(kind), color: new THREE.Color(2.2, 1.8, 1.4), transparent: true, depthWrite: false }));
    }
    this.ring = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.3, 0.35) });
    const halo = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.2, 0.7, 0.25), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < MAX_OUT; i++) {
      const root = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 40), this.ring);
      root.add(ring);
      const glow = new THREE.Sprite(halo);
      glow.scale.setScalar(2.6);
      root.add(glow);
      const icon = new THREE.Sprite(this.icons.get('maxAmmo')!);
      icon.scale.setScalar(0.85);
      icon.name = 'icon';
      root.add(icon);
      root.visible = false;
      this.group.add(root);
      this.tokens.push({ kind: 'maxAmmo', active: false, age: 0, position: new THREE.Vector3(), root });
    }
    scene.add(this.group);
  }

  get glowObjects(): THREE.Object3D[] {
    return [this.group];
  }

  reset() {
    for (const token of this.tokens) {
      token.active = false;
      token.root.visible = false;
    }
    this.timers.doublePoints = 0;
    this.timers.oneShot = 0;
    this.droppedThisRound = 0;
  }

  /** A new round: the drop allowance starts over. */
  newRound() {
    this.droppedThisRound = 0;
  }

  /** A drone went down here in round n: maybe drop something. Returns what dropped, if anything. */
  maybeDrop(position: THREE.Vector3, round: number): PowerUpKind | null {
    const { chance, perRound } = CONFIG.siege.powerUps;
    if (this.droppedThisRound >= Math.round(perRound[0] + perRound[1] * round)) return null;
    if (Math.random() > chance) return null;
    // Not one that's already lying out there.
    const out = new Set(this.tokens.filter((t) => t.active).map((t) => t.kind));
    const choices = (Object.keys(WEIGHTS) as PowerUpKind[]).filter((k) => !out.has(k));
    if (choices.length === 0) return null;
    let roll = Math.random() * choices.reduce((sum, k) => sum + WEIGHTS[k], 0);
    let kind = choices[0];
    for (const k of choices) {
      roll -= WEIGHTS[k];
      if (roll <= 0) {
        kind = k;
        break;
      }
    }
    this.droppedThisRound++;
    this.spawn(kind, position);
    return kind;
  }

  /** Put one out (a drop, or the swarm round's Max Ammo). It floats down to head height. */
  spawn(kind: PowerUpKind, position: THREE.Vector3) {
    const token = this.tokens.find((t) => !t.active) ?? this.tokens.reduce((a, b) => (a.age > b.age ? a : b));
    token.kind = kind;
    token.active = true;
    token.age = 0;
    // Bring it within reach: no higher than a jump, never into the floor.
    token.position.copy(position).setY(THREE.MathUtils.clamp(position.y, 1.2, 3.5));
    (token.root.getObjectByName('icon') as THREE.Sprite).material = this.icons.get(kind)!;
    token.root.visible = true;
  }

  /** One frame. Returns the power-ups you walked into, and any that faded away (for their sound). */
  update(dt: number, feet: THREE.Vector3) {
    this.time += dt;
    this.timers.doublePoints = Math.max(0, this.timers.doublePoints - dt);
    this.timers.oneShot = Math.max(0, this.timers.oneShot - dt);
    const picked: PowerUpKind[] = [];
    const faded: THREE.Vector3[] = [];
    const { life, pickupRadius } = CONFIG.siege.powerUps;
    for (const token of this.tokens) {
      if (!token.active) continue;
      token.age += dt;
      token.root.position.copy(token.position).setY(token.position.y + Math.sin(this.time * 2 + token.position.x) * 0.15);
      token.root.rotation.y += dt * 1.8;
      // The last few seconds it blinks, faster and faster.
      const left = life - token.age;
      token.root.visible = left > 6 || Math.sin(token.age * (8 + (6 - left) * 3)) > -0.2;
      const close = Math.hypot(feet.x - token.position.x, feet.z - token.position.z) < pickupRadius && feet.y < token.position.y + 1 && feet.y > token.position.y - 3;
      if (close) {
        token.active = false;
        token.root.visible = false;
        picked.push(token.kind);
      } else if (left <= 0) {
        token.active = false;
        token.root.visible = false;
        faded.push(token.position.clone());
      }
    }
    return { picked, faded };
  }

  /** Show one for a frame at load (to compile its shaders). */
  showForWarmUp(shown: boolean) {
    this.tokens[0].root.visible = shown;
  }
}

function iconTexture(kind: PowerUpKind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  drawIcon(canvas.getContext('2d')!, kind as IconId, 14, 14, 100, '#ffffff');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
