import * as THREE from 'three';

// What you see of an energy weapon's shot. Shots hit instantly, so these are drawn
// from the muzzle to where the shot landed: the plasma SMG's short amber streak that
// races out to the hit, and the rail rifle's white-hot beam that hangs for a moment.
// Amber and white on purpose: red belongs to the hostile drones. A small reused pool.

export type TracerKind = 'plasma' | 'rail';

interface Beam {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  kind: TracerKind;
  from: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  age: number;
}

const STYLE = {
  plasma: { color: new THREE.Color(6, 2.4, 0.5), width: 0.014, life: 0.3, speed: 260, streak: 3.5 },
  rail: { color: new THREE.Color(7, 5.6, 3.6), width: 0.03, life: 0.45, speed: Infinity, streak: Infinity },
};
const UP = new THREE.Vector3(0, 1, 0);

export class Tracers {
  readonly group = new THREE.Group();
  private beams: Beam[] = [];
  private next = 0;
  private middle = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // A thin open tube one meter long along y, stretched and turned for each shot.
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    for (let i = 0; i < 24; i++) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.beams.push({ mesh, material, kind: 'plasma', from: new THREE.Vector3(), direction: new THREE.Vector3(), length: 0, age: 0 });
    }
    scene.add(this.group);
  }

  fire(kind: TracerKind, from: THREE.Vector3, to: THREE.Vector3) {
    const beam = this.beams[this.next];
    this.next = (this.next + 1) % this.beams.length; // reuse the oldest
    beam.kind = kind;
    beam.from.copy(from);
    beam.length = from.distanceTo(to);
    beam.direction.copy(to).sub(from).divideScalar(Math.max(beam.length, 1e-6));
    beam.age = 0;
    beam.material.color.copy(STYLE[kind].color);
    beam.mesh.visible = true;
    beam.mesh.quaternion.setFromUnitVectors(UP, beam.direction);
  }

  update(dt: number) {
    for (const beam of this.beams) {
      if (!beam.mesh.visible) continue;
      beam.age += dt;
      const style = STYLE[beam.kind];
      // The streak's front races out to the hit; its back follows a few meters behind.
      const head = Math.min(beam.length, style.speed * beam.age);
      const tail = Math.max(0, head - style.streak);
      const arrived = head >= beam.length;
      const fade = arrived ? 1 - (beam.age - beam.length / style.speed) / style.life : 1;
      if (fade <= 0 || head - tail < 1e-4) {
        beam.mesh.visible = false;
        continue;
      }
      this.middle.copy(beam.from).addScaledVector(beam.direction, (head + tail) / 2);
      beam.mesh.position.copy(this.middle);
      const width = style.width * (beam.kind === 'rail' ? 0.4 + fade * 0.6 : 1);
      beam.mesh.scale.set(width, head - tail, width);
      beam.material.opacity = fade;
    }
  }

  clear() {
    for (const beam of this.beams) beam.mesh.visible = false;
  }
}
