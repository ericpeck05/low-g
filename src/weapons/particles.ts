import * as THREE from 'three';
import { CONFIG } from '../config';

// A pool of simple particles drawn as camera-facing dots.
// They follow moon gravity with no air drag, so they fly in clean arcs and
// fall slowly instead of drifting or billowing like smoke would on Earth.

interface Particle {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
  floorY: number; // the particle comes to rest when it falls to this height
  fadeTime: number; // seconds of fade-out at the end of its life
}

const VERTEX_SHADER = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    // Shrink with distance so particles have a real size in meters.
    gl_PointSize = aSize * uScale / -viewPosition.z;
  }
`;

const FRAGMENT_SHADER = `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    // Round, soft-edged dots instead of squares.
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.5, 0.2, d));
  }
`;

export class ParticleSystem {
  private particles: Particle[] = [];
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  private next = 0;

  constructor(scene: THREE.Scene, capacity: number, additive: boolean) {
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        age: 0,
        life: 1,
        size: 0,
        color: new THREE.Color(),
        floorY: 0,
        fadeTime: 0,
      });
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uScale: { value: window.innerHeight } },
      transparent: true,
      depthWrite: false, // particles shouldn't hide each other
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // particles move around; always draw them
    scene.add(this.points);
  }

  spawn(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    life: number,
    size: number,
    color: THREE.Color,
    floorY: number,
    fadeTime: number,
  ) {
    // Reuse the oldest slot when the pool is full.
    const p = this.particles[this.next];
    this.next = (this.next + 1) % this.particles.length;
    p.alive = true;
    p.position.copy(position);
    p.velocity.copy(velocity);
    p.age = 0;
    p.life = life;
    p.size = size;
    p.color.copy(color);
    p.floorY = floorY;
    p.fadeTime = fadeTime;
  }

  update(dt: number, camera: THREE.PerspectiveCamera) {
    const positions = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const sizes = this.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const alphas = this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      if (!p.alive) {
        alphas.setX(i, 0);
        continue;
      }

      // Moon gravity, no drag.
      p.velocity.y -= CONFIG.gravity * dt;
      p.position.addScaledVector(p.velocity, dt);
      if (p.position.y < p.floorY) {
        p.position.y = p.floorY;
        p.velocity.set(0, 0, 0); // dust settles where it lands
      }

      const remaining = p.life - p.age;
      positions.setXYZ(i, p.position.x, p.position.y, p.position.z);
      colors.setXYZ(i, p.color.r, p.color.g, p.color.b);
      sizes.setX(i, p.size);
      alphas.setX(i, Math.min(1, remaining / p.fadeTime));
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    sizes.needsUpdate = true;
    alphas.needsUpdate = true;

    // Point sizes are in pixels, so they depend on screen height and zoom (FOV).
    const fovScale = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.material.uniforms.uScale.value = (window.innerHeight / 2) * fovScale * window.devicePixelRatio;
  }
}
