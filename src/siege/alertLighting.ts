import * as THREE from 'three';
import { MATERIALS } from '../world/city/kit';

// The lights shift during a swarm round: the city's warm lamps and strips go a deep
// warning red and the whole picture takes on a red cast, easing in and back out.

const ALERT_LIGHT = new THREE.Color(1, 0.12, 0.05);
const ALERT_TINT = new THREE.Color(1, 0.8, 0.76);
const WHITE = new THREE.Color(1, 1, 1);

export class AlertLighting {
  private level = 0; // 0 normal, 1 full alert
  private materials = [MATERIALS.amberLight, MATERIALS.whiteLight, MATERIALS.softLight, MATERIALS.orangeLight];
  private materialColors: THREE.Color[];
  private lights: THREE.PointLight[] = [];
  private lightColors: THREE.Color[] = [];
  private tint = new THREE.Color();

  /** keep: lights that aren't the city's (the gun's flash, explosions). */
  constructor(
    scene: THREE.Scene,
    private setTint: (color: THREE.Color) => void,
    keep: THREE.Light[],
  ) {
    this.materialColors = this.materials.map((m) => m.emissive.clone());
    scene.traverse((object) => {
      const light = object as THREE.PointLight;
      if (light.isPointLight && !keep.includes(light)) {
        this.lights.push(light);
        this.lightColors.push(light.color.clone());
      }
    });
  }

  /** Ease toward full alert (on) or back to normal, over about a second. */
  update(dt: number, on: boolean) {
    const target = on ? 1 : 0;
    if (this.level === target) return;
    this.level = THREE.MathUtils.clamp(this.level + Math.sign(target - this.level) * dt, 0, 1);
    const t = this.level * this.level * (3 - 2 * this.level);
    this.materials.forEach((m, i) => m.emissive.copy(this.materialColors[i]).lerp(ALERT_LIGHT, t * 0.85));
    this.lights.forEach((light, i) => light.color.copy(this.lightColors[i]).lerp(ALERT_LIGHT, t * 0.8));
    this.setTint(this.tint.copy(WHITE).lerp(ALERT_TINT, t));
  }

  /** Straight back to normal (leaving the mode). */
  reset() {
    this.level = 0.0001;
    this.update(1, false);
  }
}
