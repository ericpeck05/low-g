import * as THREE from 'three';

// Thin glowing lines between two points, drawn fresh every frame: a sniper's aiming
// beam and its shot, and the tethers from repair drones to the drones they're mending.
// A small pool of meshes, reused; call begin(), draw() each line, then end().

const UP = new THREE.Vector3(0, 1, 0);

export class Beams {
  readonly group = new THREE.Group();
  private lines: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial }[] = [];
  private used = 0;
  private direction = new THREE.Vector3();

  constructor(scene: THREE.Scene, count = 40) {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.lines.push({ mesh, material });
    }
    scene.add(this.group);
  }

  begin() {
    this.used = 0;
  }

  /** color can be brighter than white (it glows through bloom). */
  draw(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, width: number, opacity = 1) {
    const line = this.lines[this.used];
    if (!line) return; // pool used up this frame: skip it
    this.used++;
    const length = from.distanceTo(to);
    if (length < 1e-4) return;
    this.direction.copy(to).sub(from).divideScalar(length);
    line.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    line.mesh.quaternion.setFromUnitVectors(UP, this.direction);
    line.mesh.scale.set(width, length, width);
    line.material.color.copy(color);
    line.material.opacity = opacity;
    line.mesh.visible = true;
  }

  /** Hide whatever wasn't drawn this frame. */
  end() {
    for (let i = this.used; i < this.lines.length; i++) this.lines[i].mesh.visible = false;
  }
}
