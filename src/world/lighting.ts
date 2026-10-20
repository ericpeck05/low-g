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
  // The shadow map's own sideways and upward directions, as seen looking down the sun's rays.
  private across = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const { lighting, sun } = CONFIG;
    this.light = new THREE.DirectionalLight(lighting.sunColor, lighting.sunIntensity);
    this.light.castShadow = true;
    const shadow = this.light.shadow;
    shadow.mapSize.set(sun.shadowMapSize, sun.shadowMapSize);
    // The shadow map is a box seen from the sun. With the sun low, ground stretches out
    // along its rays: ground d meters toward or away from the sun fills only
    // d × sin(elevation) of the box. So the box is sized for exactly what needs sharp
    // shadows, the ground within shadowRange all around plus anything up to shadowHeight
    // tall, which wastes far fewer pixels (sharper shadows) and draws fewer rocks into it.
    // In the box, down is toward the sun and up is away from it (and up from the ground).
    const el = THREE.MathUtils.degToRad(sun.elevation);
    const groundSpan = sun.shadowRange * Math.sin(el);
    shadow.camera.left = -sun.shadowRange;
    shadow.camera.right = sun.shadowRange;
    shadow.camera.bottom = -groundSpan - 6 * Math.cos(el); // a little extra for crater floors
    shadow.camera.top = groundSpan + sun.shadowHeight * Math.cos(el);
    shadow.camera.near = 1;
    shadow.camera.far = 600;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03; // stops the ground from shadowing itself in stripes ("shadow acne")
    const basis = new THREE.Matrix4().lookAt(this.direction, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    basis.extractBasis(this.across, this.up, new THREE.Vector3());
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
    // Snap to whole shadow-map pixels (measured across the sun's rays), so shadow edges
    // don't crawl as you walk.
    const camera = this.light.shadow.camera;
    const texelAcross = (camera.right - camera.left) / this.mapSize;
    const texelUp = (camera.top - camera.bottom) / this.mapSize;
    const center = new THREE.Vector3()
      .addScaledVector(this.across, Math.round(focus.dot(this.across) / texelAcross) * texelAcross)
      .addScaledVector(this.up, Math.round(focus.dot(this.up) / texelUp) * texelUp)
      .addScaledVector(this.direction, focus.dot(this.direction));
    this.light.target.position.copy(center);
    this.light.position.copy(center).addScaledVector(this.direction, 300);
  }
}
