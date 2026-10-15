import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../../config';
import { Airlock } from './airlock';
import { buildDome, snappedAirlockBearing } from './dome';
import { buildExterior } from './exterior';
import { buildInterior } from './interior';

// The whole city: dome, airlocks, everything inside, everything outside.
export function buildCity(scene: THREE.Scene, world: RAPIER.World) {
  buildDome(scene, world);
  buildInterior(scene, world);
  const exterior = buildExterior(scene, world);
  const airlocks = CONFIG.city.airlockBearings.map((_, i) => new Airlock(scene, world, snappedAirlockBearing(i)));

  return {
    airlocks,
    update(dt: number, player: THREE.Vector3) {
      for (const airlock of airlocks) airlock.update(dt, player);
      exterior.update(dt);
    },
  };
}
