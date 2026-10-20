import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CONFIG } from '../config';
import { FinishPass } from './finishPass';
import { GlowPass } from './glowPass';
import { OverlayPass } from './overlayPass';

// Draws each frame in five steps:
//  1. The world, into a multisampled image so edges stay smooth.
//  2. The gun and hands on top of it (their own scene and camera).
//  3. Ambient occlusion (high quality only): works out where corners, crevices and the
//     ground under things should be darker, which makes objects sit in the world.
//  4. Glow (bloom): bright lights (windows, light strips, the muzzle flash) blurred.
//  5. Finish: adds 3 and 4 to the image, converts it to screen colors, and adds a
//     light vignette and film grain.
// Only steps 1 and 2 write into the multisampled image: writing into one again later
// is expensive, so steps 3 and 4 keep their results on the side for step 5.
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  overlay: { scene: THREE.Scene; camera: THREE.Camera },
) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: CONFIG.render.msaaSamples,
    resolveDepthBuffer: false, // nothing reads the depth afterwards, so don't copy it
  });
  const composer = new EffectComposer(renderer, target);
  const world = new RenderPass(scene, camera);
  world.clear = false; // the black sky background already clears the image
  composer.addPass(world);
  const gun = new OverlayPass(overlay.scene, overlay.camera);
  composer.addPass(gun);

  const ao = new GTAOPass(scene, camera, size.x, size.y);
  ao.updateGtaoMaterial({
    radius: CONFIG.render.aoRadius,
    distanceExponent: 1,
    thickness: 1.5,
    scale: 1,
    samples: 12,
  });
  ao.blendIntensity = CONFIG.render.aoIntensity;
  ao.output = GTAOPass.OUTPUT.Off; // keep the result to itself; the finish pass applies it
  ao.needsSwap = false;
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

  // The glow is a blur, so it can start at a quarter of the resolution and look the same.
  // (The pass halves whatever size it's given, so give it half.)
  const { strength, radius, threshold } = CONFIG.bloom;
  const glow = new GlowPass(size, strength, radius, threshold);
  const glowSetSize = glow.setSize.bind(glow);
  glow.setSize = (width: number, height: number) => glowSetSize(Math.ceil(width / 2), Math.ceil(height / 2));
  glow.setSize(size.x, size.y);
  composer.addPass(glow);
  composer.addPass(new FinishPass(glow, ao));

  window.addEventListener('resize', () => composer.setSize(window.innerWidth, window.innerHeight));

  return {
    composer,
    passes: { ao, glow, gun },
    /** Change resolution, anti-aliasing and ambient occlusion (from the graphics quality setting). */
    setQuality(options: { pixelRatio: number; antialiasSamples: number; ambientOcclusion: boolean }) {
      renderer.setPixelRatio(options.pixelRatio);
      // With ambient occlusion the image needs an alpha channel to mark the gun (see
      // overlayPass.ts). Without it, a color format half the size is much faster to
      // draw into: three small floating-point numbers per pixel, still bright enough for bloom.
      const [type, format] = options.ambientOcclusion
        ? [THREE.HalfFloatType, THREE.RGBAFormat]
        : [THREE.UnsignedInt101111Type, THREE.RGBFormat];
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== options.antialiasSamples || t.texture.type !== type) {
          t.samples = options.antialiasSamples;
          t.texture.type = type;
          t.texture.format = format;
          t.dispose(); // rebuilt with the new settings next frame
        }
      }
      composer.setPixelRatio(options.pixelRatio);
      composer.setSize(window.innerWidth, window.innerHeight);
      ao.enabled = options.ambientOcclusion;
    },
    /** Draw a frame. showGun: false behind the main menu, where there's no player. */
    render(dt: number, showGun: boolean) {
      gun.enabled = showGun;
      composer.render(dt);
    },
    /** Leave these out of ambient occlusion (glass, particles, sky). */
    excludeFromAO: (...objects: THREE.Object3D[]) => aoHidden.push(...objects),
  };
}
