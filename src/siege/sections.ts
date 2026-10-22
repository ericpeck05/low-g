import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { domeCeiling } from '../world/city/dome';
import { MATERIALS } from '../world/city/kit';
import { RANGE } from '../world/city/layout';
import { SiegeColliders } from './props';

// Drone Siege's sections, like the rooms behind Zombies' doors. A game starts in the
// plaza. Energy barriers, floor to glass, seal off the rest of the city:
//   plaza   - the center, out to 32 m (the range hall counts as part of it)
//   towers  - the tower ring and the walkway, out to the ring road
//   south   - the outer district's south half, with airlock S (the way to the power station)
//   north   - its north half, with airlock N
// Pay at a barrier's terminal and it switches off. The barriers are see-through, so the
// whole city is still in view; they stop people, drones and shots alike.

export type AreaId = 'plaza' | 'towers' | 'south' | 'north' | 'surface';
export type SectionId = keyof typeof CONFIG.siege.sections;

export const PLAZA_EDGE = 32; // meters from the center
export const DISTRICT_EDGE = 65.6; // just outside the ring road
const SPLIT_BEARINGS = [101, 281]; // the district halves meet here (in gaps between buildings)
const THICKNESS = 0.3;

/** Is a bearing (degrees) in the south half of the district (281 round through 0 to 101)? */
export function isSouthBearing(bearing: number) {
  const b = ((bearing % 360) + 360) % 360;
  return b >= SPLIT_BEARINGS[1] || b <= SPLIT_BEARINGS[0];
}

/** Which area a point is in (by where it stands). */
export function areaAt(p: THREE.Vector3): AreaId {
  const r = Math.hypot(p.x, p.z);
  if (r > CONFIG.city.domeRadius) return 'surface';
  if (r < PLAZA_EDGE) return 'plaza';
  // The range hall is reached through its door in the plaza, so all of it counts as the plaza.
  if (p.x > RANGE.xStart - 1 && p.x < RANGE.xEnd + 1 && Math.abs(p.z) < RANGE.halfWidth + 0.6 && p.y < RANGE.height + 0.5) return 'plaza';
  if (r < DISTRICT_EDGE) return 'towers';
  return isSouthBearing(THREE.MathUtils.radToDeg(Math.atan2(p.x, p.z))) ? 'south' : 'north';
}

interface Barrier {
  mesh: THREE.Mesh;
  colliders: RAPIER.Collider[];
  /** Open once these sections are bought. */
  needs: SectionId[];
  open: number; // 0 = up, 1 = gone (animates)
  /** Does the line from a to b pass through this barrier (where it's solid)? */
  crosses(a: THREE.Vector3, b: THREE.Vector3): boolean;
}

/** A terminal at a barrier, where its section is bought. */
export interface Terminal {
  section: SectionId;
  position: THREE.Vector3;
  facing: THREE.Vector3;
}

export class Sections {
  readonly bought = new Set<SectionId>();
  readonly terminals: Terminal[] = [];
  readonly group = new THREE.Group();
  private barriers: Barrier[] = [];
  private material: THREE.ShaderMaterial;
  private time = 0;
  private fixtures: SiegeColliders;

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
  ) {
    this.material = barrierMaterial();
    this.fixtures = new SiegeColliders(world);
    // The plaza's ring, with the range hall passing through it below its roof.
    this.barriers.push(this.ring(PLAZA_EDGE, 0, 360, ['towers'], (x, z) => x > 0 && Math.abs(z) < RANGE.halfWidth + 0.6 ? RANGE.height + 0.45 : 0));
    // The district's edge, in two halves.
    const [east, west] = SPLIT_BEARINGS;
    this.barriers.push(this.ring(DISTRICT_EDGE, west - 360, east, ['south'], () => 0));
    this.barriers.push(this.ring(DISTRICT_EDGE, east, west, ['north'], () => 0));
    // The walls between the halves, open once both are bought.
    for (const bearing of SPLIT_BEARINGS) this.barriers.push(this.radial(bearing, ['south', 'north']));

    // Terminals: inside the plaza's ring, and on the tower-ring side of the district's.
    const terminal = (section: SectionId, r: number, bearing: number) => {
      const b = THREE.MathUtils.degToRad(bearing);
      const out = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
      this.terminals.push({ section, position: out.clone().multiplyScalar(r), facing: out.clone().negate() });
    };
    for (const bearing of [16, 70, 130, 196, 250, 310]) terminal('towers', PLAZA_EDGE - 1.4, bearing);
    for (const bearing of [12, 58, 302, 348]) terminal('south', DISTRICT_EDGE - 1.3, bearing);
    for (const bearing of [122, 168, 192, 238]) terminal('north', DISTRICT_EDGE - 1.3, bearing);
    for (const t of this.terminals) {
      this.group.add(terminalModel(t, CONFIG.siege.sections[t.section]));
      this.fixtures.box(t.position.clone().setY(0.55), new THREE.Vector3(0.65, 1.1, 0.5), Math.atan2(t.facing.x, t.facing.z));
    }

    scene.add(this.group);
    this.setShown(false);
  }

  /** The barrier meshes, for leaving out of ambient occlusion. */
  get glowObjects(): THREE.Object3D[] {
    return this.barriers.map((b) => b.mesh);
  }

  /** Areas you can be in right now (the surface counts once an airlock is reachable). */
  get unlockedAreas(): Set<AreaId> {
    const areas = new Set<AreaId>(['plaza', 'surface']);
    for (const id of this.bought) areas.add(id);
    return areas;
  }

  /** A new game: every barrier up, nothing bought. Barriers only exist in Drone Siege. */
  reset(active: boolean) {
    this.bought.clear();
    for (const barrier of this.barriers) {
      barrier.open = active ? 0 : 1;
      for (const c of barrier.colliders) c.setEnabled(active);
    }
    this.fixtures.setEnabled(active);
    this.setShown(active);
  }

  /** Open a section: its barriers start to fade, and stop blocking straight away. */
  buy(section: SectionId) {
    this.bought.add(section);
    for (const barrier of this.barriers) {
      if (barrier.open > 0 || !barrier.needs.every((s) => this.bought.has(s))) continue;
      barrier.open = 0.001;
      for (const c of barrier.colliders) c.setEnabled(false);
    }
  }

  /** For the drones' route finding: is the way from a to b sealed by a barrier that's up? */
  blocked = (a: THREE.Vector3, b: THREE.Vector3) => this.barriers.some((barrier) => barrier.open === 0 && barrier.crosses(a, b));

  /** True for a barrier's collider (a shot that hits one splashes on it). */
  isBarrier(collider: RAPIER.Collider) {
    return this.barriers.some((b) => b.colliders.includes(collider));
  }

  /** Every barrier's collider, so drone routes can be built as if they were all open. */
  setCollidersEnabled(enabled: boolean) {
    for (const barrier of this.barriers) for (const c of barrier.colliders) c.setEnabled(enabled && barrier.open === 0);
  }

  update(dt: number) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    for (const barrier of this.barriers) {
      if (barrier.open > 0 && barrier.open < 1) barrier.open = Math.min(1, barrier.open + dt / 1.3);
      (barrier.mesh.material as THREE.ShaderMaterial).uniforms.uOpen.value = barrier.open;
      barrier.mesh.visible = barrier.open < 1 && this.group.visible;
    }
  }

  private setShown(shown: boolean) {
    this.group.visible = shown;
    for (const barrier of this.barriers) barrier.mesh.visible = shown && barrier.open < 1;
  }

  // A curved barrier along a circle of radius r, from one bearing to another (degrees),
  // floor to glass. `floor` lifts its bottom edge at a spot (to let a building through).
  private ring(r: number, from: number, to: number, needs: SectionId[], floor: (x: number, z: number) => number): Barrier {
    const top = domeCeiling(r) - 0.2;
    const steps = Math.ceil(((to - from) / 360) * Math.PI * 2 * r / 1.6);
    const positions: number[] = [];
    const uvs: number[] = [];
    const colliders: RAPIER.Collider[] = [];
    for (let i = 0; i < steps; i++) {
      const a0 = THREE.MathUtils.degToRad(from + ((to - from) * i) / steps);
      const a1 = THREE.MathUtils.degToRad(from + ((to - from) * (i + 1)) / steps);
      const am = (a0 + a1) / 2;
      const bottom = floor(Math.sin(am) * r, Math.cos(am) * r);
      const p0 = [Math.sin(a0) * r, Math.cos(a0) * r];
      const p1 = [Math.sin(a1) * r, Math.cos(a1) * r];
      const u0 = a0 * r;
      const u1 = a1 * r;
      positions.push(p0[0], bottom, p0[1], p1[0], bottom, p1[1], p1[0], top, p1[1], p0[0], bottom, p0[1], p1[0], top, p1[1], p0[0], top, p0[1]);
      uvs.push(u0, bottom, u1, bottom, u1, top, u0, bottom, u1, top, u0, top);
      const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + 0.05;
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(length / 2, (top - bottom) / 2, THICKNESS / 2)
          .setTranslation(Math.sin(am) * r, (top + bottom) / 2, Math.cos(am) * r)
          .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), am)),
      );
      collider.setEnabled(false);
      colliders.push(collider);
    }
    const lo = THREE.MathUtils.degToRad(from);
    const hi = THREE.MathUtils.degToRad(to);
    return {
      mesh: this.mesh(positions, uvs),
      colliders,
      needs,
      open: 1,
      crosses: (a, b) => {
        const ra = Math.hypot(a.x, a.z);
        const rb = Math.hypot(b.x, b.z);
        if (ra < r === rb < r) return false;
        // Where the line crosses the circle (near enough: interpolate by radius).
        const t = (r - ra) / (rb - ra);
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        const z = a.z + (b.z - a.z) * t;
        // Bring the bearing into the barrier's range of angles (which may start below zero).
        let bearing = Math.atan2(x, z);
        while (bearing < lo) bearing += Math.PI * 2;
        while (bearing >= lo + Math.PI * 2) bearing -= Math.PI * 2;
        if (bearing > hi) return false;
        return y >= floor(x, z);
      },
    };
  }

  // A straight barrier running out from the district's edge to the dome wall along a bearing.
  private radial(bearing: number, needs: SectionId[]): Barrier {
    const b = THREE.MathUtils.degToRad(bearing);
    const out = new THREE.Vector3(Math.sin(b), 0, Math.cos(b));
    const R = CONFIG.city.domeRadius;
    const positions: number[] = [];
    const uvs: number[] = [];
    const colliders: RAPIER.Collider[] = [];
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const r0 = DISTRICT_EDGE + ((R - DISTRICT_EDGE) * i) / steps;
      const r1 = DISTRICT_EDGE + ((R - DISTRICT_EDGE) * (i + 1)) / steps;
      const h0 = Math.max(0.5, domeCeiling(r0) - 0.2);
      const h1 = Math.max(0.5, domeCeiling(r1) - 0.2);
      positions.push(out.x * r0, 0, out.z * r0, out.x * r1, 0, out.z * r1, out.x * r1, h1, out.z * r1, out.x * r0, 0, out.z * r0, out.x * r1, h1, out.z * r1, out.x * r0, h0, out.z * r0);
      uvs.push(r0, 0, r1, 0, r1, h1, r0, 0, r1, h1, r0, h0);
      const mid = out.clone().multiplyScalar((r0 + r1) / 2);
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(THICKNESS / 2, h0 / 2, (r1 - r0) / 2 + 0.02)
          .setTranslation(mid.x, h0 / 2, mid.z)
          .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b)),
      );
      collider.setEnabled(false);
      colliders.push(collider);
    }
    const normal = new THREE.Vector3(out.z, 0, -out.x); // across the barrier
    return {
      mesh: this.mesh(positions, uvs),
      colliders,
      needs,
      open: 1,
      crosses: (a, c) => {
        const da = a.x * normal.x + a.z * normal.z;
        const dc = c.x * normal.x + c.z * normal.z;
        if (da < 0 === dc < 0) return false;
        const t = da / (da - dc);
        const x = a.x + (c.x - a.x) * t;
        const z = a.z + (c.z - a.z) * t;
        const along = x * out.x + z * out.z;
        return along > DISTRICT_EDGE && along < R;
      },
    };
  }

  private mesh(positions: number[], uvs: number[]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    const material = this.material.clone();
    material.uniforms.uTime = this.material.uniforms.uTime; // all barriers share one clock
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.userData.dynamic = true;
    this.group.add(mesh);
    return mesh;
  }
}

// The barrier's look: a faint amber sheet with a hexagonal mesh drifting up it, brighter
// near the floor and where you see it edge-on, dissolving in sparks when it opens.
function barrierMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // Distance to the nearest edge of a hexagonal grid cell.
      float hexEdge(vec2 p) {
        p.x *= 1.1547;
        p.y += mod(floor(p.x), 2.0) * 0.5;
        p = abs(fract(p) - 0.5);
        return abs(max(p.x * 1.5 + p.y, p.y * 2.0) - 1.0);
      }
      void main() {
        vec2 p = vUv * 0.45 + vec2(0.0, -uTime * 0.06);
        float lines = 1.0 - smoothstep(0.0, 0.035 + fwidth(p.y) * 1.5, hexEdge(p));
        float px = max(fwidth(vUv.x), fwidth(vUv.y));
        lines *= 1.0 - smoothstep(0.15, 0.5, px); // far away the grid fades to an even glow
        vec3 toEye = normalize(cameraPosition - vWorld);
        float edgeOn = 1.0 - abs(dot(toEye, vNormal));
        float floorGlow = exp(-vUv.y * 0.9) * 0.9;
        float sweep = smoothstep(0.92, 1.0, sin(vUv.y * 0.25 - uTime * 1.6)) * 0.35;
        float alpha = 0.005 + lines * 0.03 + floorGlow * 0.13 + edgeOn * edgeOn * 0.04 + sweep * 0.2;
        // Opening: holes eat through it from the floor up, leaving a bright edge.
        float n = hash(floor(vUv * vec2(1.4, 1.4)));
        float cut = uOpen * 1.3 - n * 0.3 - vUv.y * 0.004;
        if (cut > 0.0) {
          if (cut > 0.08) discard;
          alpha = 1.4;
        }
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.12) * alpha, 1.0);
      }`,
  });
}

// A terminal: a pedestal with a slanted lit screen showing the section's name and price.
function terminalModel(t: Terminal, section: { name: string; price: number }) {
  const group = new THREE.Group();
  group.position.copy(t.position);
  group.rotation.y = Math.atan2(t.facing.x, t.facing.z);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.0, 0.4), MATERIALS.graphite);
  base.position.y = 0.5;
  base.castShadow = base.receiveShadow = true;
  group.add(base);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.5), MATERIALS.graphite);
  head.position.set(0, 1.06, 0.03);
  head.rotation.x = -0.5;
  group.add(head);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshBasicMaterial({ map: screenTexture(section.name, section.price), toneMapped: false }));
  screen.position.set(0, 1.105, 0.05);
  screen.rotation.x = -Math.PI / 2 + 1.07;
  group.add(screen);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.02), MATERIALS.amberLight);
  light.position.set(0, 0.2, 0.205);
  group.add(light);
  return group;
}

function screenTexture(name: string, price: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0d0b08';
  ctx.fillRect(0, 0, 384, 256);
  ctx.strokeStyle = '#ffa31a';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 364, 236);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#c8b9a0';
  ctx.font = 'bold 26px "SF Mono", Menlo, monospace';
  ctx.fillText('BARRIER OVERRIDE', 192, 66);
  ctx.fillStyle = '#fff1dc';
  ctx.font = 'bold 34px "SF Mono", Menlo, monospace';
  ctx.fillText(name, 192, 132, 340);
  ctx.fillStyle = '#ffa31a';
  ctx.font = 'bold 48px "SF Mono", Menlo, monospace';
  ctx.fillText(String(price), 192, 204);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
