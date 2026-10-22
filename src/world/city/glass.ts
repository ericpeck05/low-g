import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patchFresnelGlass } from '../../core/materialPatches';

// See-through glass (balustrades, greenhouse roofs). See-through things can't be merged
// with the rest of the city by material, so every pane is collected here and drawn as
// one mesh: one draw for all the glass in the city.

export class GlassBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a pane already placed in the world. */
  add(geometry: THREE.BufferGeometry) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    this.parts.push(g);
  }

  /** Add a pane shaped by `geometry`, placed where `object` is (after its world matrix is up to date). */
  addAt(geometry: THREE.BufferGeometry, object: THREE.Object3D) {
    object.updateWorldMatrix(true, false);
    this.add(geometry.applyMatrix4(object.matrixWorld));
  }

  build(scene: THREE.Object3D) {
    if (!this.parts.length) return null;
    // Black, so it shows only reflections: clear looking straight through, mirror-like at an angle.
    const material = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false });
    patchFresnelGlass(material, 0.1, 0.8);
    const mesh = new THREE.Mesh(mergeGeometries(this.parts)!, material);
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  }
}
