import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CONFIG } from '../config';

// Draws the world through three filters:
//  1. Ambient occlusion: darkens corners, crevices and where things meet the ground,
//     which is what makes objects look like they sit in the world instead of floating.
//  2. Bloom: bright lights (windows, light strips, the sun) glow into their surroundings.
//  3. Output: tone mapping and conversion to screen colors.
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  // Render into a multisampled target so edges stay smooth (the browser's own
  // anti-aliasing doesn't apply once we draw through post-processing).
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: CONFIG.render.msaaSamples,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.updateGtaoMaterial({
    radius: CONFIG.render.aoRadius,
    distanceExponent: 1,
    thickness: 1.5,
    scale: 1,
    samples: 12,
  });
  ao.blendIntensity = CONFIG.render.aoIntensity;
  // Work out occlusion at half resolution: it's soft shading, so it looks the same
  // and costs a quarter as much.
  const aoSetSize = ao.setSize.bind(ao);
  ao.setSize = (width: number, height: number) => aoSetSize(Math.ceil(width / 2), Math.ceil(height / 2));
  ao.setSize(size.x, size.y);
  ao.enabled = CONFIG.render.ambientOcclusion;
  composer.addPass(ao);

  // Things that shouldn't cast occlusion: see-through glass, dust particles, and the sky.
  // They're hidden only while the occlusion pass draws its depth and normals.
  const aoHidden: THREE.Object3D[] = [];
  const pass = ao as unknown as { _renderOverride: (...args: unknown[]) => void };
  const renderOverride = pass._renderOverride.bind(ao);
  pass._renderOverride = (...args: unknown[]) => {
    const was = aoHidden.map((o) => o.visible);
    aoHidden.forEach((o) => (o.visible = false));
    renderOverride(...args);
    aoHidden.forEach((o, i) => (o.visible = was[i]));
  };

  const { strength, radius, threshold } = CONFIG.bloom;
  // Bloom works at half resolution: it's a blur, so it looks the same and costs a quarter.
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.resolution.set(window.innerWidth / 2, window.innerHeight / 2);
  });

  return {
    composer,
    passes: { ao, bloom },
    /** Change resolution, anti-aliasing and ambient occlusion (from the graphics quality setting). */
    setQuality(options: { pixelRatio: number; antialiasSamples: number; ambientOcclusion: boolean }) {
      renderer.setPixelRatio(options.pixelRatio);
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== options.antialiasSamples) {
          t.samples = options.antialiasSamples;
          t.dispose(); // rebuilt with the new sample count next frame
        }
      }
      composer.setPixelRatio(options.pixelRatio);
      composer.setSize(window.innerWidth, window.innerHeight);
      ao.enabled = options.ambientOcclusion;
    },
    render: (dt: number) => composer.render(dt),
    /** Leave these out of ambient occlusion (glass, particles, sky). */
    excludeFromAO: (...objects: THREE.Object3D[]) => aoHidden.push(...objects),
  };
}
