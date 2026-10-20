import * as THREE from 'three';
import type { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// The parts of three's bloom pass we reach into (they aren't in its public types).
type BloomInternals = {
  _fsQuad: FullScreenQuad;
  highPassUniforms: Record<string, THREE.IUniform>;
};
const ACROSS = new THREE.Vector2(1, 0); // blur directions
const DOWN = new THREE.Vector2(0, 1);

// Bloom (bright things glow), the same as three's UnrealBloomPass except for the last
// step. Three's version adds the glow back into the scene image. Our scene image is
// multisampled for smooth edges, and writing into one of those a second time costs
// several milliseconds, so instead the glow stays in its own texture and the finish
// pass adds it while it converts the image to screen colors.
export class GlowPass extends UnrealBloomPass {
  constructor(resolution: THREE.Vector2, strength: number, radius: number, threshold: number) {
    super(resolution, strength, radius, threshold);
    this.needsSwap = false;
  }

  /** The finished glow, ready to be added on top of the scene. */
  get texture() {
    return this.renderTargetsHorizontal[0].texture;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const self = this as unknown as BloomInternals;
    const quad = self._fsQuad;
    const oldAutoClear = renderer.autoClear;
    const oldClearColor = renderer.getClearColor(new THREE.Color());
    const oldClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // 1. Keep only the parts brighter than the threshold.
    self.highPassUniforms.tDiffuse.value = readBuffer.texture;
    self.highPassUniforms.luminosityThreshold.value = this.threshold;
    quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    quad.render(renderer);

    // 2. Blur them at five sizes, each half the last, for a soft wide glow.
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      quad.material = blur;
      blur.uniforms.colorTexture.value = input.texture;
      blur.uniforms.direction.value = ACROSS;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      quad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = DOWN;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // 3. Combine the five blurs into one glow image (read by `texture`).
    const composite = this.compositeMaterial.uniforms;
    composite.bloomStrength.value = this.strength;
    composite.bloomRadius.value = this.radius;
    composite.bloomTintColors.value = this.bloomTintColors;
    quad.material = this.compositeMaterial;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    quad.render(renderer);

    renderer.setClearColor(oldClearColor, oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}
