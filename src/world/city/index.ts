import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Airlock } from './airlock';
import { buildDome, snappedAirlockBearing } from './dome';
import { buildExterior } from './exterior';
import { buildInterior } from './interior';
import { mergeStatic } from './kit';

// The whole city: dome, airlocks, everything inside, everything outside.
export function buildCity(scene: THREE.Scene, world: RAPIER.World) {
  const root = new THREE.Group();
  scene.add(root);
  const dome = buildDome(root, world);
  const interior = buildInterior(root, world);
  const exterior = buildExterior(root, world);
  const airlocks = CONFIG.city.airlockBearings.map((_, i) => new Airlock(root, world, snappedAirlockBearing(i)));
  const merge = mergeStatic(root);

  return {
    airlocks,
    merge,
    /** Everything see-through: the dome, balustrades and greenhouse roofs. */
    glass: [dome.glass, ...(interior.glass ? [interior.glass] : [])],
    /** The dome's solid shell (sunlight passes through it; bullets and people don't). */
    glassCollider: dome.collider,
    /** Moves doors and blinking lights. Returns airlock sound events. */
    update(dt: number, player: THREE.Vector3) {
      for (const airlock of airlocks) airlock.update(dt, player);
      exterior.update(dt);
      return airlocks.flatMap((airlock) => airlock.takeEvents());
    },
  };
}
