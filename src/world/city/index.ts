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
  buildInterior(root, world);
  const exterior = buildExterior(root, world);
  const airlocks = CONFIG.city.airlockBearings.map((_, i) => new Airlock(root, world, snappedAirlockBearing(i)));
  const merge = mergeStatic(root);

  return {
    airlocks,
    merge,
    glass: dome.glass,
    /** The dome's solid shell (sunlight passes through it; bullets and people don't). */
    glassCollider: dome.collider,
    update(dt: number, player: THREE.Vector3) {
      for (const airlock of airlocks) airlock.update(dt, player);
      exterior.update(dt);
    },
  };
}
