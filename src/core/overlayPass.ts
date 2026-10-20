import * as THREE from 'three';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

// Draws a second scene on top of the world: the gun and hands, with their own camera.
// The depth is cleared first, so the gun never pokes into walls you stand next to.
// It draws into the same smooth-edged (multisampled) image as the world, so it gets
// the same anti-aliasing, glow and film look.
export class OverlayPass extends Pass {
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
    // Solid parts write alpha 0, which tells the finish pass "this pixel is the gun, not
    // the world" (the world writes 1). See-through parts blend as usual.
    scene.traverse((object) => {
      const materials = (object as THREE.Mesh).material;
      if (!materials) return;
      for (const material of Array.isArray(materials) ? materials : [materials]) {
        if (material.transparent) continue;
        material.blending = THREE.CustomBlending;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.ZeroFactor;
        material.blendSrcAlpha = THREE.ZeroFactor;
        material.blendDstAlpha = THREE.ZeroFactor;
      }
    });
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
