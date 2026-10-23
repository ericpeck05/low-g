import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { mergeRigidParts } from '../core/mergeMeshes';
import { glowTexture } from '../siege/glowTexture';
import { MATERIALS } from '../world/city/kit';
import { seededRandom } from '../world/noise';
import { terrainHeight } from '../world/terrain';

// Salvage Run's wreck sites: where the convoy's cargo came down across the plain. A set of
// candidate spots is worked out once (clear of the base's buildings, spaced apart); each
// run picks sixteen of them and puts a cache at each: scrap crates near the city, cargo pods
// farther out, armored vaults farther still, and one black box at the edge. Every site has
// a scorched impact ring, its cache, and a beacon of light so you can find it.

export type CacheKind = keyof typeof CONFIG.salvage.caches;
export const CACHE_KINDS: CacheKind[] = ['scrap', 'cargo', 'vault', 'blackBox'];

/** Beacon colors by kind: soft white, amber, gold, and white-gold (never blue; red means drones). */
export const KIND_COLORS: Record<CacheKind, THREE.Color> = {
  scrap: new THREE.Color(0.9, 0.85, 0.75),
  cargo: new THREE.Color(1.3, 0.72, 0.22),
  vault: new THREE.Color(1.6, 0.95, 0.25),
  blackBox: new THREE.Color(2.4, 2.0, 1.2),
};
export const KIND_CSS: Record<CacheKind, string> = { scrap: '#e8e0d0', cargo: '#ffa31a', vault: '#ffcc33', blackBox: '#fff3d6' };

export interface Site {
  kind: CacheKind;
  position: THREE.Vector3; // on the ground at the cache's middle
  value: number; // salvage inside
  opened: boolean;
  progress: number; // 0 to 1 while being opened
  root: THREE.Group;
  lid: THREE.Object3D; // the part that opens
  lamp: THREE.Mesh; // the distress beacon's lamp (goes dark when opened)
  beacon: THREE.Mesh; // the shaft of light over it
  beaconWidth: number;
  marker: THREE.Sprite; // the lamp's glow
  colliders: RAPIER.Collider[];
  openAnim: number; // 0 closed, 1 fully open (eases)
  alarmed: boolean; // its alarm has gone off (vaults and the black box call drones in)
  extras: THREE.Object3D[]; // parts laid out in world space (the beacon, marker and scorch ring)
}

// Places the base's own things stand, kept clear of wreckage and drone drops (center x, z and radius).
export const KEEP_OUT: [number, number, number][] = [
  [0, 128, 36], // landing pad, containers, tanks, control hut
  [-46, 126, 14], // power station
  [-62, 124, 14], // its cables
  [100, -100, 32], // habitat modules
  [-70, 112, 7],
  [128, 48, 7],
  [-112, -82, 7], // antennas
  [0, -230, 5],
  [190, -70, 5],
  [-175, 160, 5],
  [210, 170, 5], // target posts
];

/** All the spots a cache could go: worked out once, the same every time. */
function candidates() {
  const random = seededRandom(2024);
  const spots: THREE.Vector3[] = [];
  for (let tries = 0; tries < 4000 && spots.length < 70; tries++) {
    const r = 100 + random() * 150;
    const a = random() * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (KEEP_OUT.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + 6)) continue;
    // The solar field.
    if (x < -96 && x > -150 && Math.abs(z) < 40) continue;
    if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 26)) continue;
    spots.push(new THREE.Vector3(x, terrainHeight(x, z), z));
  }
  return spots;
}

export class Sites {
  readonly group = new THREE.Group();
  /** The beacons, markers and salvage chunks: they glow, so they're left out of ambient occlusion. */
  readonly glowGroup = new THREE.Group();
  sites: Site[] = [];
  private spots = candidates();
  private chunks: { mesh: THREE.Mesh; velocity: THREE.Vector3; age: number; spin: THREE.Vector3 }[] = [];
  private chunkMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xffa31a, emissiveIntensity: 2.4, roughness: 0.4 });
  private shaftTexture = shaftTexture();
  private shaftGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0); // stands on its bottom edge
  private scarMaterial = new THREE.MeshStandardMaterial({ map: scarTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  private glow = glowTexture();
  private time = 0;

  constructor(
    scene: THREE.Scene,
    private world: RAPIER.World,
  ) {
    scene.add(this.group, this.glowGroup);
    // A pool of glowing salvage chunks that pop out of an opened cache.
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.12), this.chunkMaterial);
      mesh.visible = false;
      this.glowGroup.add(mesh);
      this.chunks.push({ mesh, velocity: new THREE.Vector3(), age: 9, spin: new THREE.Vector3() });
    }
  }

  get glowObjects(): THREE.Object3D[] {
    return [this.glowGroup];
  }

  /** Shown or hidden as a whole (only during a Salvage Run). */
  setShown(shown: boolean) {
    this.group.visible = this.glowGroup.visible = shown;
  }

  /** A new run: clear the old sites, pick new spots and fill them (or clear everything if not active). */
  reset(active: boolean) {
    for (const site of this.sites) {
      site.root.removeFromParent();
      for (const extra of site.extras) extra.removeFromParent();
      for (const c of site.colliders) this.world.removeCollider(c, false);
      site.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      // Each site's own beacon and marker glow, and its scorch shape (shared things stay).
      (site.beacon.material as THREE.Material).dispose();
      site.marker.material.dispose();
      (site.extras[2] as THREE.Mesh).geometry.dispose();
    }
    this.sites = [];
    for (const chunk of this.chunks) chunk.mesh.visible = false;
    if (!active) return;
    const free = [...this.spots];
    const take = (min: number, max: number, farthest = false) => {
      let pool = free.filter((p) => Math.hypot(p.x, p.z) >= min && Math.hypot(p.x, p.z) <= max);
      if (pool.length === 0) pool = free;
      if (farthest) pool.sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z)).splice(4);
      const spot = pool[Math.floor(Math.random() * pool.length)];
      free.splice(free.indexOf(spot), 1);
      return spot;
    };
    for (const kind of CACHE_KINDS) {
      const cfg = CONFIG.salvage.caches[kind];
      for (let i = 0; i < cfg.count; i++) {
        const spot = take(cfg.range[0], cfg.range[1], kind === 'blackBox');
        const value = Math.round((cfg.value[0] + Math.random() * (cfg.value[1] - cfg.value[0])) / 5) * 5;
        this.sites.push(this.build(kind, spot.clone(), value));
      }
    }
  }

  /** The closed site you're close enough to open (within reach and roughly in front of you), if any. */
  nearest(feet: THREE.Vector3, look: THREE.Vector3) {
    const flat = look.clone().setY(0).normalize();
    let best: Site | null = null;
    let bestDistance = 3.2;
    for (const site of this.sites) {
      if (site.opened) continue;
      const toward = site.position.clone().sub(feet).setY(0);
      const d = toward.length();
      if (d > bestDistance || Math.abs(feet.y - site.position.y) > 3) continue;
      if (d > 0.8 && flat.dot(toward.normalize()) < 0.35) continue;
      best = site;
      bestDistance = d;
    }
    return best;
  }

  /** Mark a site opened: its lid swings, salvage chunks fly out, and its beacon goes out. */
  open(site: Site) {
    site.opened = true;
    site.progress = 1;
    site.lamp.material = MATERIALS.trim; // the distress beacon goes dark
    const count = site.kind === 'scrap' ? 5 : site.kind === 'cargo' ? 8 : 12;
    for (let k = 0; k < count; k++) {
      const chunk = this.chunks.find((c) => c.age > CHUNK_LIFE) ?? this.chunks[k];
      chunk.age = 0;
      chunk.mesh.visible = true;
      chunk.mesh.position.copy(site.position).setY(site.position.y + 1);
      chunk.velocity.set((Math.random() - 0.5) * 2.2, 1.4 + Math.random() * 1.2, (Math.random() - 0.5) * 2.2);
      chunk.spin.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      chunk.mesh.scale.setScalar(site.kind === 'blackBox' ? 1.4 : 1);
    }
  }

  update(dt: number, feet: THREE.Vector3) {
    this.time += dt;
    for (const site of this.sites) {
      const distance = site.position.distanceTo(feet);
      // The shaft turns to face you, is drawn wider far off (so it can be found from across
      // the plain), fades up close (so it never hides the cache), and goes out once opened.
      const beacon = site.beacon;
      beacon.rotation.y = Math.atan2(feet.x - beacon.position.x, feet.z - beacon.position.z);
      beacon.scale.x = site.beaconWidth * (1 + distance / 70);
      const pulse = 0.82 + 0.18 * Math.sin(this.time * 2 + site.position.x);
      const near = THREE.MathUtils.smoothstep(distance, 3, 22);
      const fade = site.opened ? Math.max(0, 1 - site.openAnim * 1.5) : 1;
      (beacon.material as THREE.MeshBasicMaterial).opacity = 0.9 * pulse * (0.12 + 0.88 * near) * fade;
      beacon.visible = fade > 0.01;
      // The lamp's glow: small up close, bigger far off, beating slowly like a distress light.
      site.marker.visible = !site.opened;
      const far = Math.min(1, distance / 120);
      const beat = Math.max(0, Math.sin(this.time * 3.2 + site.position.z)) ** 6;
      site.marker.scale.setScalar((0.45 + far * 2.6) * (0.8 + beat * 0.5));
      if (site.opened && site.openAnim < 1) {
        site.openAnim = Math.min(1, site.openAnim + dt * 1.6);
        openPose(site);
      }
    }
    // Salvage chunks: they pop up out of the cache, hang a moment in the low gravity, then
    // streak into your chest (you've picked them up) and are gone.
    const chest = feet.clone().setY(feet.y + 1.2);
    for (const chunk of this.chunks) {
      if (chunk.age > CHUNK_LIFE) continue;
      chunk.age += dt;
      const toYou = chest.clone().sub(chunk.mesh.position);
      const distance = toYou.length();
      if (chunk.age < 0.55) {
        chunk.velocity.y -= CONFIG.gravity * dt;
      } else {
        const pull = Math.min(1, (chunk.age - 0.55) * 3);
        chunk.velocity.lerp(toYou.normalize().multiplyScalar(4 + pull * 14), Math.min(1, dt * (2 + pull * 10)));
      }
      chunk.mesh.position.addScaledVector(chunk.velocity, dt);
      chunk.mesh.rotation.x += chunk.spin.x * dt;
      chunk.mesh.rotation.y += chunk.spin.y * dt;
      if ((chunk.age > 0.55 && distance < 0.45) || chunk.age > CHUNK_LIFE) {
        chunk.age = CHUNK_LIFE + 1;
        chunk.mesh.visible = false;
      }
    }
    this.chunkMaterial.emissiveIntensity = 1.6 + Math.sin(this.time * 12) * 0.4;
  }

  // ---- Building a site ----

  private build(kind: CacheKind, position: THREE.Vector3, value: number): Site {
    const root = new THREE.Group();
    root.position.copy(position);
    root.rotation.y = Math.random() * Math.PI * 2;
    this.group.add(root);
    const statics = new THREE.Group();
    root.add(statics);
    const colliders: RAPIER.Collider[] = [];
    const part = (material: THREE.Material, size: [number, number, number], at: [number, number, number], rot: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = statics) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...at);
      mesh.rotation.set(...rot);
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const solid = (size: [number, number, number], at: [number, number, number]) => {
      const center = new THREE.Vector3(...at).applyAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y).add(position);
      colliders.push(
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
            .setTranslation(center.x, center.y, center.z)
            .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y)),
        ),
      );
    };
    const lid = new THREE.Group();
    root.add(lid);

    // A small label plate, cut from the shared label sheet (row: which label).
    const label = (row: number, w: number, h: number, at: [number, number, number], turn: number, parent: THREE.Object3D) => {
      const geometry = new THREE.PlaneGeometry(w, h);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / LABEL_ROWS);
      const mesh = new THREE.Mesh(geometry, labelMaterial());
      mesh.position.set(...at);
      mesh.rotation.y = turn;
      mesh.receiveShadow = true;
      parent.add(mesh);
    };
    // Every cache has a little distress beacon on a whip antenna; its lamp's glow is the marker.
    const antenna = (x: number, y: number, z: number, height: number) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, height, 6), MATERIALS.trim);
      pole.position.set(x, y + height / 2, z);
      statics.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8), MATERIALS.graphite);
      base.position.set(x, y + 0.04, z);
      statics.add(base);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), MATERIALS.whiteLight);
      lamp.position.set(x, y + height + 0.04, z);
      root.add(lamp);
      return lamp;
    };
    let lamp: THREE.Mesh;

    if (kind === 'scrap') {
      // A rugged crate half sunk in the dust, strapped and stenciled, with dented debris around it.
      const crate = new THREE.Group();
      crate.rotation.set(0.06, 0, 0.04);
      statics.add(crate);
      part(MATERIALS.graphite, [1.3, 0.7, 0.9], [0, 0.25, 0], [0, 0, 0], crate);
      for (const x of [-0.4, 0.4]) part(MATERIALS.lightPanel, [0.08, 0.74, 0.94], [x, 0.26, 0], [0, 0, 0], crate);
      for (const [x, z] of [[-0.65, -0.45], [0.65, -0.45], [-0.65, 0.45], [0.65, 0.45]]) part(MATERIALS.orangeLight, [0.07, 0.07, 0.07], [x, 0.6, z], [0, 0, 0], crate);
      for (const side of [-1, 1]) label(0, 0.66, 0.17, [0, 0.36, side * 0.456], side > 0 ? 0 : Math.PI, crate);
      lid.position.set(0, 0.62, -0.45);
      lid.rotation.x = 0.06;
      part(MATERIALS.graphite, [1.32, 0.08, 0.92], [0, 0.02, 0.45], [0, 0, 0], lid);
      for (let k = 0; k < 5; k++) part(k % 2 ? MATERIALS.trim : MATERIALS.lightPanel, [0.3 + Math.random() * 0.5, 0.04, 0.2 + Math.random() * 0.3], [Math.cos(k * 1.3) * (1.6 + k * 0.2), 0.03, Math.sin(k * 1.3) * (1.6 + k * 0.2)], [Math.random() * 0.4, Math.random() * 3, Math.random() * 0.3]);
      lamp = antenna(0.74, 0, -0.3, 1.6);
      solid([1.3, 0.9, 0.9], [0, 0.3, 0]);
    } else if (kind === 'cargo') {
      // A cargo pod on its side: white hull, a band of gold foil, fins, a crumpled nose, a lifting hatch.
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 20), MATERIALS.lightPanel);
      hull.rotation.z = Math.PI / 2;
      hull.position.y = 0.7;
      hull.castShadow = hull.receiveShadow = true;
      statics.add(hull);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.9, 20), MATERIALS.foil);
      band.rotation.z = Math.PI / 2;
      band.position.set(-0.6, 0.7, 0);
      statics.add(band);
      for (const x of [0.55, 1.45]) {
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.875, 0.875, 0.06, 20), MATERIALS.trim);
        rib.rotation.z = Math.PI / 2;
        rib.position.set(x, 0.7, 0);
        statics.add(rib);
      }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.1, 20, 1, true), MATERIALS.trim);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(2.15, 0.6, 0);
      nose.scale.set(1, 1, 0.75); // crumpled flat on landing
      nose.castShadow = true;
      statics.add(nose);
      for (let k = 0; k < 4; k++) {
        const fin = part(MATERIALS.graphite, [0.6, 0.05, 0.7], [-1.75, 0.7, 0]);
        fin.rotation.x = (k / 4) * Math.PI * 2 + 0.4;
        fin.position.set(-1.75, 0.7 + Math.sin(fin.rotation.x) * 0.9, Math.cos(fin.rotation.x) * 0.9);
      }
      for (const side of [-1, 1]) label(1, 0.8, 0.26, [1.0, 0.82, side * 0.872], side > 0 ? 0 : Math.PI, statics);
      // The hatch on top, which lifts open.
      lid.position.set(0.3, 1.52, -0.3);
      part(MATERIALS.graphite, [1.2, 0.08, 0.6], [0, 0, 0.3], [0, 0, 0], lid);
      part(MATERIALS.orangeLight, [1.0, 0.02, 0.04], [0, 0.05, 0.58], [0, 0, 0], lid);
      lamp = antenna(-1.1, 1.5, 0.3, 1.0);
      solid([3.6, 1.6, 1.7], [0, 0.75, 0]);
    } else if (kind === 'vault') {
      // An armored vault pod: heavy bands, a stenciled plate, and a glowing lock ring on its doors.
      part(MATERIALS.graphite, [1.6, 1.4, 1.6], [0, 0.7, 0]);
      for (const y of [0.25, 1.15]) part(MATERIALS.facade, [1.66, 0.16, 1.66], [0, y, 0]);
      for (const x of [-0.78, 0.78]) for (const z of [-0.78, 0.78]) part(MATERIALS.trim, [0.12, 1.45, 0.12], [x, 0.72, z]);
      for (const turn of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const side = new THREE.Group();
        side.rotation.y = turn;
        statics.add(side);
        label(2, 1.2, 0.3, [0, 0.7, 0.805], 0, side);
      }
      // Two door halves on the front, which part.
      lid.position.set(0, 0.7, 0.81);
      const left = part(MATERIALS.lightPanel, [0.62, 0.8, 0.08], [-0.31, 0, 0], [0, 0, 0], lid);
      const right = part(MATERIALS.lightPanel, [0.62, 0.8, 0.08], [0.31, 0, 0], [0, 0, 0], lid);
      left.name = 'left';
      right.name = 'right';
      const lock = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), MATERIALS.amberLight);
      lock.position.set(0, 0, 0.06);
      lock.name = 'lock';
      lid.add(lock);
      part(MATERIALS.shadow, [1.2, 0.78, 0.02], [0, 0.7, 0.795]); // the dark inside, seen when the doors part
      lamp = antenna(0.6, 1.4, -0.6, 1.0);
      solid([1.7, 1.45, 1.7], [0, 0.72, 0]);
    } else {
      // A crashed satellite: its gold-foiled body on its side, one solar wing snapped and
      // dug in, the other lying in pieces, a dish thrown clear, a bent boom, and in front,
      // in its own little crater, the orange flight recorder.
      const bus = new THREE.Group();
      bus.position.set(-2.4, 0.62, 0.7);
      bus.rotation.set(0.1, 0.5, 1.32);
      statics.add(bus);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.9, 6), MATERIALS.foil);
      body.castShadow = body.receiveShadow = true;
      bus.add(body);
      for (const y of [-0.97, 0.97]) {
        const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.06, 6), MATERIALS.lightPanel);
        plate.position.y = y;
        plate.castShadow = true;
        bus.add(plate);
      }
      const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.4, 12, 1, true), MATERIALS.darkMetal);
      thruster.position.y = -1.18;
      bus.add(thruster);
      // A wing still attached, snapped down into the dust.
      const wing = new THREE.Group();
      wing.position.set(0, 0.4, 0.9);
      wing.rotation.set(0.5, 0, -0.25);
      bus.add(wing);
      for (let k = 0; k < 3; k++) solarPanel(wing, 0, 0, 0.75 + k * 1.12, k === 2 ? 0.18 : 0);
      // The other wing, torn off and lying flat in two pieces.
      const loose = new THREE.Group();
      loose.position.set(1.6, 0.08, -2.3);
      loose.rotation.set(0.05, 0.6, 0.03);
      statics.add(loose);
      solarPanel(loose, 0, 0, 0, 0);
      solarPanel(loose, 0.15, 0.06, 1.2, -0.12);
      // The dish, thrown clear and lying tipped over.
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 8, 0, Math.PI * 2, 0, 0.85), dishMaterial());
      dish.position.set(-0.4, 0.42, -2.5);
      dish.rotation.set(-1.9, 0.3, 0.2);
      dish.castShadow = dish.receiveShadow = true;
      statics.add(dish);
      part(MATERIALS.trim, [0.04, 0.6, 0.04], [-0.4, 0.62, -2.15], [-0.4, 0, 0.2]);
      // The boom, bent where it hit.
      part(MATERIALS.trim, [1.6, 0.07, 0.07], [-1.2, 0.35, -0.6], [0, 0.7, 0.15]);
      part(MATERIALS.trim, [1.1, 0.07, 0.07], [-0.3, 0.2, -1.2], [0, -0.3, -0.1]);
      for (let k = 0; k < 6; k++) part(k % 2 ? MATERIALS.foil : MATERIALS.lightPanel, [0.2 + Math.random() * 0.35, 0.03, 0.15 + Math.random() * 0.3], [Math.cos(k * 1.1 + 0.5) * (2.8 + k * 0.3), 0.03, Math.sin(k * 1.1 + 0.5) * (2.8 + k * 0.3)], [Math.random() * 0.4, Math.random() * 3, Math.random() * 0.4]);
      // The flight recorder: painted orange, reflective bands, its label, a carry handle.
      part(paintMaterial(), [0.8, 0.46, 0.56], [0, 0.22, 0]);
      for (const x of [-0.26, 0.26]) part(MATERIALS.lightPanel, [0.07, 0.465, 0.565], [x, 0.22, 0]);
      label(3, 0.4, 0.15, [0, 0.24, 0.283], 0, statics);
      label(3, 0.4, 0.15, [0, 0.24, -0.283], Math.PI, statics);
      lid.position.set(0, 0.45, -0.28);
      part(paintMaterial(), [0.82, 0.07, 0.58], [0, 0.035, 0.28], [0, 0, 0], lid);
      part(MATERIALS.trim, [0.36, 0.04, 0.04], [0, 0.12, 0.28], [0, 0, 0], lid);
      for (const x of [-0.18, 0.18]) part(MATERIALS.trim, [0.04, 0.09, 0.04], [x, 0.08, 0.28], [0, 0, 0], lid);
      lamp = antenna(0.5, 0, 0.12, 0.9);
      solid([0.85, 0.55, 0.6], [0, 0.25, 0]);
      solid([2.2, 1.4, 1.8], [-2.4, 0.7, 0.7]);
    }
    mergeRigidParts(statics);
    const scar = this.scar(position, kind === 'blackBox' ? 7 : kind === 'vault' ? 5.5 : kind === 'cargo' ? 4.5 : 3.2);

    // The beacon: a soft shaft of light in the cache's color, and the glow of its lamp.
    const color = KIND_COLORS[kind];
    const beacon = new THREE.Mesh(
      this.shaftGeometry,
      new THREE.MeshBasicMaterial({ map: this.shaftTexture, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beacon.position.copy(position);
    beacon.scale.set(1, kind === 'blackBox' ? 60 : 42, 1);
    beacon.frustumCulled = false;
    this.glowGroup.add(beacon);
    root.updateMatrixWorld(true);
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: color.clone().multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    marker.position.copy(lamp.getWorldPosition(new THREE.Vector3()));
    this.glowGroup.add(marker);
    const beaconWidth = { scrap: 1.1, cargo: 1.3, vault: 1.6, blackBox: 2.4 }[kind];
    return { kind, position, value, opened: false, progress: 0, root, lid, lamp, beacon, beaconWidth, marker, colliders, openAnim: 0, alarmed: false, extras: [beacon, marker, scar] };
  }

  // A scorched ring of disturbed dust round the impact, laid over the ground's shape.
  private scar(center: THREE.Vector3, radius: number) {
    const rings = 6;
    const segments = 28;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let r = 0; r <= rings; r++) {
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const d = (r / rings) * radius;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        positions.push(x, terrainHeight(center.x + x, center.z + z) - center.y + 0.14, z);
        uvs.push(0.5 + (x / radius) * 0.5, 0.5 + (z / radius) * 0.5);
        if (r < rings && s < segments) {
          const i = r * (segments + 1) + s;
          indices.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1); // facing up
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, this.scarMaterial);
    mesh.receiveShadow = true;
    mesh.position.copy(center);
    this.group.add(mesh);
    return mesh;
  }
}

// Each kind's lid opening, by how far along it is (0 to 1).
function openPose(site: Site) {
  const t = site.openAnim * site.openAnim * (3 - 2 * site.openAnim);
  if (site.kind === 'vault') {
    site.lid.getObjectByName('left')!.position.x = -0.31 - t * 0.55;
    site.lid.getObjectByName('right')!.position.x = 0.31 + t * 0.55;
    site.lid.getObjectByName('lock')!.visible = t < 0.2;
  } else {
    site.lid.rotation.x = -t * (site.kind === 'cargo' ? 1.9 : 1.6);
  }
}

/** A soft shaft of light: a bright core with a faint halo across it, fading out upward. */
function shaftTexture() {
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const up = y / h; // 0 at the top, 1 at the ground
    const rise = Math.pow(up, 1.7) * Math.min(1, (1 - up) / 0.03);
    for (let x = 0; x < w; x++) {
      const across = (x + 0.5 - w / 2) / (w / 2);
      const glow = Math.exp(-((across / 0.22) ** 2)) + 0.3 * Math.exp(-((across / 0.6) ** 2));
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.min(255, glow * rise * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// A solar panel section: a dark cell plate in a light frame, with its cell grid.
function solarPanel(parent: THREE.Object3D, x: number, y: number, z: number, tilt: number) {
  const panel = new THREE.Group();
  panel.position.set(x, y, z);
  panel.rotation.x = tilt;
  parent.add(panel);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 1.05), MATERIALS.graphite);
  plate.castShadow = plate.receiveShadow = true;
  panel.add(plate);
  for (const [w, d, px, pz] of [[1.04, 0.04, 0, 0.53], [1.04, 0.04, 0, -0.53], [0.04, 1.06, 0.51, 0], [0.04, 1.06, -0.51, 0], [1.0, 0.02, 0, 0], [0.02, 1.05, 0, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), MATERIALS.trim);
    bar.position.set(px, 0.006, pz);
    panel.add(bar);
  }
}

const LABEL_ROWS = 4;
const CHUNK_LIFE = 2.4; // seconds a salvage chunk can be in the air at most
let labels: THREE.MeshStandardMaterial | null = null;
let dish: THREE.MeshStandardMaterial | null = null;
let paint: THREE.MeshStandardMaterial | null = null;

/** The stenciled labels, one sheet for all of them: crate, pod, vault, flight recorder. */
function labelMaterial() {
  if (labels) return labels;
  const w = 512;
  const row = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = row * LABEL_ROWS;
  const ctx = canvas.getContext('2d')!;
  const stripes = (x: number, y: number, width: number, height: number, ink: string) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.fillStyle = '#121110';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = ink;
    for (let k = -height; k < width + height; k += 28) {
      ctx.beginPath();
      ctx.moveTo(x + k, y + height);
      ctx.lineTo(x + k + 14, y + height);
      ctx.lineTo(x + k + 14 + height, y);
      ctx.lineTo(x + k + height, y);
      ctx.fill();
    }
    ctx.restore();
  };
  const text = (y: number, big: string, small: string, ink: string, left = 110) => {
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.font = 'bold 44px "SF Mono", Menlo, monospace';
    ctx.fillText(big, left, y + 62, w - left - 16);
    ctx.font = '22px "SF Mono", Menlo, monospace';
    ctx.fillText(small, left, y + 100, w - left - 16);
  };
  // 0: the scrap crate.
  ctx.fillStyle = '#d6cfc2';
  ctx.fillRect(0, 0, w, row);
  stripes(0, 0, 90, row, '#ffa31a');
  text(0, 'SALVAGE', 'CONVOY 7 · LOT 0419', '#1a1816');
  // 1: the cargo pod.
  ctx.fillStyle = '#e8e2d6';
  ctx.fillRect(0, row, w, row);
  stripes(0, row, 90, row, '#ffa31a');
  text(row, 'CARGO 7-C', '2,400 KG · HANDLE IN VACUUM', '#1a1816');
  // 2: the armored vault.
  ctx.fillStyle = '#141311';
  ctx.fillRect(0, row * 2, w, row);
  stripes(0, row * 2, 70, row, '#ffa31a');
  stripes(w - 70, row * 2, 70, row, '#ffa31a');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffa31a';
  ctx.font = 'bold 46px "SF Mono", Menlo, monospace';
  ctx.fillText('ARMORED', w / 2, row * 2 + 62);
  ctx.font = '22px "SF Mono", Menlo, monospace';
  ctx.fillStyle = '#d6cfc2';
  ctx.fillText('CLASS IV · ALARMED', w / 2, row * 2 + 100);
  // 3: the flight recorder.
  ctx.fillStyle = '#f2ede4';
  ctx.fillRect(0, row * 3, w, row);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#111';
  ctx.font = 'bold 40px "SF Mono", Menlo, monospace';
  ctx.fillText('FLIGHT RECORDER', w / 2, row * 3 + 56);
  ctx.font = 'bold 30px "SF Mono", Menlo, monospace';
  ctx.fillText('DO NOT OPEN', w / 2, row * 3 + 100);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  labels = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return labels;
}

/** The satellite dish: seen from both sides. */
function dishMaterial() {
  dish ??= new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide });
  return dish;
}

/** Flight recorder orange (they're painted bright so they can be found). */
function paintMaterial() {
  paint ??= new THREE.MeshStandardMaterial({ color: 0xe86a12, roughness: 0.45, metalness: 0.15 });
  return paint;
}

/** Dark scorched dust in the middle, thrown-out streaks, and a soft edge. */
function scarTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const random = seededRandom(91);
  const core = ctx.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, 'rgba(20,18,16,0.85)');
  core.addColorStop(0.45, 'rgba(40,37,33,0.55)');
  core.addColorStop(1, 'rgba(60,56,50,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(30,28,25,0.35)';
  for (let k = 0; k < 60; k++) {
    const a = random() * Math.PI * 2;
    const r0 = c * (0.3 + random() * 0.2);
    const r1 = c * (0.6 + random() * 0.4);
    ctx.lineWidth = 1 + random() * 4;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
