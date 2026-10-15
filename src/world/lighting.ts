import * as THREE from 'three';
import { CONFIG } from '../config';

/** Unit vector pointing from the ground toward the sun. */
export function sunDirection() {
  const { elevation, bearing } = CONFIG.sun;
  return directionFromAngles(elevation, bearing);
}

/** A direction from degrees above the horizon and degrees around (180 = straight ahead of spawn). */
export function directionFromAngles(elevationDegrees: number, bearingDegrees: number) {
  const el = THREE.MathUtils.degToRad(elevationDegrees);
  const az = THREE.MathUtils.degToRad(bearingDegrees);
  // Bearing 180 points toward -z, which is the way the player faces at spawn.
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

// One harsh sun and almost no fill light: with no air, shadows are nearly black.
// The shadow area follows the player, because a 1 km map can't all have sharp shadows at once.
export class Sun {
  private light: THREE.DirectionalLight;
  private direction = sunDirection();
  private mapSize = CONFIG.sun.shadowMapSize;

  constructor(scene: THREE.Scene) {
    const { lighting, sun } = CONFIG;
    this.light = new THREE.DirectionalLight(lighting.sunColor, lighting.sunIntensity);
    this.light.castShadow = true;
    const shadow = this.light.shadow;
    shadow.mapSize.set(sun.shadowMapSize, sun.shadowMapSize);
    shadow.camera.left = -sun.shadowRange;
    shadow.camera.right = sun.shadowRange;
    shadow.camera.top = sun.shadowRange;
    shadow.camera.bottom = -sun.shadowRange;
    shadow.camera.near = 1;
    shadow.camera.far = 600;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03; // stops the ground from shadowing itself in stripes ("shadow acne")
    scene.add(this.light, this.light.target);

    scene.add(new THREE.AmbientLight(0xffffff, lighting.ambientIntensity));

    // Earthshine: a dim, slightly cool light from the Earth's side of the sky.
    const earthshine = new THREE.DirectionalLight(0xdfe4ea, lighting.earthshineIntensity);
    earthshine.position.copy(directionFromAngles(CONFIG.sky.earthElevation, CONFIG.sky.earthBearing));
    scene.add(earthshine);
  }

  /** Shadow detail (from the graphics quality setting). */
  setShadowMapSize(size: number) {
    if (size === this.mapSize) return;
    this.mapSize = size;
    this.light.shadow.mapSize.set(size, size);
    this.light.shadow.map?.dispose();
    this.light.shadow.map = null; // three.js makes a new one at the new size
  }

  /** Keep the sharp-shadow area centered on the player. */
  update(focus: THREE.Vector3) {
    // Snap to whole shadow-map pixels, so shadow edges don't crawl as you walk.
    const texel = (CONFIG.sun.shadowRange * 2) / this.mapSize;
    const center = new THREE.Vector3(
      Math.round(focus.x / texel) * texel,
      Math.round(focus.y / texel) * texel,
      Math.round(focus.z / texel) * texel,
    );
    this.light.target.position.copy(center);
    this.light.position.copy(center).addScaledVector(this.direction, 300);
  }
}
