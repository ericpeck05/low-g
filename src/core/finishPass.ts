import * as THREE from 'three';
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CONFIG } from '../config';
import type { GlowPass } from './glowPass';

// The last step of every frame, drawn straight to the screen:
//  - adds the glow (bloom) and the corner shading (ambient occlusion), which earlier
//    passes worked out on the side,
//  - converts the bright, linear image to screen colors (tone mapping),
//  - then darkens the corners a little (vignette) and adds a light film grain.
// The grain also hides the color banding that smooth dark gradients get on screens.

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tGlow;
  uniform sampler2D tShade;
  uniform float glowAmount;
  uniform float shadeAmount;
  uniform float grain;
  uniform float vignette;
  uniform float vignetteStart;
  uniform float seed;
  uniform vec3 tint;
  varying vec2 vUv;

  // A cheap random number from 0 to 1 for each pixel (no sine, so it's the same on every GPU).
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec4 scene = texture2D(tScene, vUv);
    // Alpha marks the world (1) apart from the gun and hands (0): the world's corner
    // shading was measured without the gun, so it must not land on it.
    float shade = mix(1.0, texture2D(tShade, vUv).r, shadeAmount * scene.a);
    gl_FragColor = vec4(scene.rgb * shade + texture2D(tGlow, vUv).rgb * glowAmount, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>

    // A color grade over everything (white normally; Drone Siege's swarm rounds turn it red).
    gl_FragColor.rgb *= tint;

    // Vignette: darker toward the corners, like a real lens.
    float fromCenter = length(vUv - 0.5) * 1.4142; // 0 at the center, 1 in the corners
    gl_FragColor.rgb *= 1.0 - vignette * smoothstep(vignetteStart, 1.0, fromCenter);

    // Film grain: a little random brightness per pixel, new every frame. Strongest in the
    // mid-tones like real film, and none in pure black, so the sky stays black.
    float luma = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
    float noise = hash(gl_FragCoord.xy + seed) - 0.5;
    gl_FragColor.rgb += noise * grain * smoothstep(0.0, 0.25, luma) * (1.2 - luma);
  }
`;

export class FinishPass extends Pass {
  private material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  // glow: the bloom pass. shade: the ambient occlusion pass (its result is used only while it's on).
  constructor(
    private glow: GlowPass,
    private shade: GTAOPass,
  ) {
    super();
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tGlow: { value: null },
        tShade: { value: null },
        glowAmount: { value: 1 },
        shadeAmount: { value: 0 },
        grain: { value: CONFIG.film.grain },
        vignette: { value: CONFIG.film.vignette },
        vignetteStart: { value: CONFIG.film.vignetteStart },
        seed: { value: 0 },
        tint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tScene.value = readBuffer.texture;
    u.tGlow.value = this.glow.texture;
    u.glowAmount.value = this.glow.enabled ? 1 : 0;
    u.tShade.value = this.shade.pdRenderTarget.texture;
    u.shadeAmount.value = this.shade.enabled ? this.shade.blendIntensity : 0;
    u.seed.value = Math.random() * 1000; // new grain every frame
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  /** Multiply the whole picture by this color (white for none). */
  setTint(color: THREE.Color) {
    this.material.uniforms.tint.value.copy(color);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}
