import * as THREE from 'three';
import { patchFresnelGlass } from '../core/materialPatches';
import { seededRandom } from '../world/noise';
import { type GunModel, SUPPORT_GRIP } from './gunModel';

// The rifle, built in code from extruded side profiles (so the silhouette and
// bevelled edges look machined, not boxy) plus turned parts for the barrel.
//
// Gun space: x = right, y = up, -z = forward (toward the muzzle), meters.
// The origin sits at the trigger. The bore runs along y = 0.03.


export const RIFLE_MATERIALS = makeMaterials();

function makeMaterials() {
  const grain = grainTexture();
  const metal = (color: number, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, bumpMap: grain, bumpScale: 0.3 });
  return {
    // Hard anodizing is a dyed oxide layer: it shades like a dark non-metal, not like bare metal.
    receiver: metal(0x3e3c39, 0.5, 0.15),
    steel: metal(0x6a6a6c, 0.32, 0.9), // barrel, bolt, pins: bare, reflects the bright ground
    thermal: new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.68, bumpMap: grain, bumpScale: 0.6 }), // white thermal coating
    polymer: new THREE.MeshStandardMaterial({ color: 0x242322, roughness: 0.78, bumpMap: grain, bumpScale: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.95 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8a00, emissiveIntensity: 0.6, roughness: 0.4 }),
    reticle: new THREE.MeshBasicMaterial({ color: 0xffb340, toneMapped: false }),
    glass: (() => {
      const glass = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide });
      patchFresnelGlass(glass, 0.07, 0.6);
      return glass;
    })(),
  };
}

// A side profile (forward, up) pairs, extruded sideways to `width`, with bevelled edges.
export function profile(points: [number, number][], width: number, bevel = 0.0025) {
  const shape = new THREE.Shape(points.map(([f, y]) => new THREE.Vector2(f, y)));
  const depth = Math.max(0.0005, width - bevel * 2);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: 8,
  });
  // Shape x is "forward": turn it so forward is -z and the extrusion runs along x.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-depth / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

export function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A cylinder running along the barrel axis between two forward distances. */
export function tube(parent: THREE.Object3D, radius: number, from: number, to: number, y: number, material: THREE.Material, sides = 24) {
  const m = mesh(new THREE.CylinderGeometry(radius, radius, to - from, sides), material, parent);
  m.rotation.x = Math.PI / 2;
  m.position.set(0, y, -(from + to) / 2);
  return m;
}

export function box(parent: THREE.Object3D, size: [number, number, number], at: [number, number, number], material: THREE.Material) {
  const m = mesh(new THREE.BoxGeometry(...size), material, parent);
  m.position.set(...at);
  return m;
}

export function buildRifle(): GunModel {
  const M = RIFLE_MATERIALS;
  const root = new THREE.Group();
  const BORE = 0.03;

  // Upper receiver, with a tapered front where it meets the handguard.
  mesh(profile([[-0.13, 0.008], [0.14, 0.008], [0.14, 0.057], [0.128, 0.062], [-0.118, 0.062], [-0.13, 0.054]], 0.052), M.receiver, root);
  // Lower receiver with the magazine well and trigger housing.
  mesh(
    profile(
      [[-0.1, 0.008], [0.13, 0.008], [0.13, -0.02], [0.114, -0.03], [0.11, -0.082], [0.034, -0.082], [0.03, -0.042], [-0.074, -0.042], [-0.1, -0.026]],
      0.048,
    ),
    M.receiver,
    root,
  );
  // Flared magwell lip.
  mesh(profile([[0.03, -0.074], [0.114, -0.074], [0.116, -0.088], [0.028, -0.088]], 0.054, 0.002), M.receiver, root);

  addGripAndTrigger(root);

  // Handguard: an eight-sided tube in white thermal coating, with dark M-LOK slots.
  const handguard = tube(root, 0.033, 0.14, 0.43, BORE, M.thermal, 8);
  handguard.rotation.y = Math.PI / 8; // flat faces on the sides and bottom
  const slot = new THREE.BoxGeometry(0.003, 0.008, 0.024);
  for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2, (3 * Math.PI) / 4, -(3 * Math.PI) / 4]) {
    for (let i = 0; i < 5; i++) {
      const s = mesh(slot, M.rubber, root);
      const r = 0.0305;
      s.position.set(Math.cos(angle) * r, BORE + Math.sin(angle) * r, -(0.17 + i * 0.05));
      s.rotation.z = angle;
    }
  }
  tube(root, 0.035, 0.425, 0.435, BORE, M.receiver, 8).rotation.y = Math.PI / 8; // end cap

  // Picatinny rail along the top: a base with evenly spaced teeth.
  box(root, [0.021, 0.006, 0.55], [0, 0.065, -0.15], M.receiver);
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.022, 0.0045, 0.0052), M.receiver, 54);
  for (let i = 0; i < 54; i++) teeth.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0.0703, 0.12 - i * 0.01));
  teeth.castShadow = true;
  teeth.receiveShadow = true;
  root.add(teeth);

  // Barrel and muzzle brake (with side ports).
  tube(root, 0.0095, 0.43, 0.535, BORE, M.steel);
  tube(root, 0.0135, 0.53, 0.59, BORE, M.steel, 12);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) box(root, [0.004, 0.012, 0.007], [side * 0.012, BORE, -(0.545 + i * 0.015)], M.rubber);
  }

  // Buffer tube and adjustable stock with a cheek rest and rubber butt pad.
  tube(root, 0.0155, -0.31, -0.12, 0.034, M.receiver);
  mesh(profile([[-0.19, 0.016], [-0.2, 0.056], [-0.355, 0.062], [-0.362, -0.06], [-0.33, -0.065], [-0.26, -0.012], [-0.2, 0.004]], 0.042, 0.004), M.thermal, root);
  mesh(profile([[-0.362, 0.064], [-0.375, 0.064], [-0.375, -0.068], [-0.362, -0.064]], 0.046, 0.003), M.rubber, root);

  // Charging handle (T-shaped, at the back of the upper).
  const chargingHandle = new THREE.Group();
  box(chargingHandle, [0.012, 0.008, 0.03], [0, 0.058, 0.118], M.receiver);
  box(chargingHandle, [0.05, 0.007, 0.012], [0, 0.058, 0.13], M.receiver);
  root.add(chargingHandle);

  // Ejection port on the right with the bolt carrier showing through, and the open dust cover.
  box(root, [0.002, 0.022, 0.07], [0.0265, 0.034, 0], M.rubber);
  const bolt = new THREE.Group();
  box(bolt, [0.003, 0.014, 0.06], [0.0272, 0.035, 0], M.steel);
  root.add(bolt);
  const dustCover = box(root, [0.0015, 0.02, 0.07], [0.03, 0.016, 0], M.receiver);
  dustCover.rotation.z = -0.9;

  // Controls on the left side, the side you see: selector lever, bolt catch, mag release.
  const selector = box(root, [0.003, 0.006, 0.022], [-0.0265, -0.014, 0.055], M.steel);
  selector.rotation.x = 0.4;
  box(root, [0.003, 0.004, 0.006], [-0.0275, -0.014, 0.045], M.amber); // painted fire-mode mark
  box(root, [0.004, 0.018, 0.01], [-0.0255, -0.02, -0.025], M.receiver); // bolt catch
  // Small pins through the lower receiver.
  for (const [f, y] of [[0.035, -0.012], [-0.06, -0.014], [0.1, 0.0]]) {
    const pin = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 10), M.steel, root);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0, y, -f);
  }

  // Ammo counter: a small screen on the left of the receiver showing rounds left.
  const display = ammoDisplay();
  const screen = mesh(new THREE.PlaneGeometry(0.036, 0.018), display.material, root);
  screen.position.set(-0.0268, 0.036, -0.075);
  screen.rotation.y = -Math.PI / 2;

  // Magazine: a curved polymer magazine with ribs and a base plate.
  const magazine = buildMagazine();
  const magazineWell = new THREE.Vector3(0, -0.074, -0.072);
  magazine.position.copy(magazineWell);
  root.add(magazine);

  const sightDot = addHoloSight(root);

  // Folded backup iron sights at each end of the rail.
  box(root, [0.02, 0.008, 0.02], [0, 0.072, 0.1], M.receiver);
  box(root, [0.016, 0.008, 0.016], [0, 0.072, -0.4], M.receiver);

  const flash = buildMuzzleFlash();
  const muzzle = new THREE.Vector3(0, BORE, -0.595);
  flash.position.copy(muzzle);
  root.add(flash);

  return {
    root,
    flash,
    flashSize: 1,
    magazine,
    magazineWell,
    sight: sightDot,
    muzzle,
    ejectionPort: new THREE.Vector3(0.03, 0.035, 0),
    support: SUPPORT_GRIP.clone(),
    action: { part: bolt, travel: 0.04, delay: 0, carriesHand: false },
    hipOffset: new THREE.Vector3(),
    glow: null,
    setAmmoDisplay: display.set,
    moving: [bolt, magazine, chargingHandle, flash],
  };
}

/** The pistol grip, trigger and trigger guard every gun shares, around the origin (the trigger). */
export function addGripAndTrigger(root: THREE.Object3D) {
  const M = RIFLE_MATERIALS;
  // Trigger guard: a loop under the trigger.
  const guardShape = new THREE.Shape([new THREE.Vector2(-0.05, -0.04), new THREE.Vector2(0.03, -0.04), new THREE.Vector2(0.03, -0.076), new THREE.Vector2(-0.05, -0.076)]);
  guardShape.holes.push(new THREE.Path([new THREE.Vector2(-0.044, -0.042), new THREE.Vector2(0.024, -0.042), new THREE.Vector2(0.024, -0.07), new THREE.Vector2(-0.044, -0.07)].reverse()));
  const guard = new THREE.ExtrudeGeometry(guardShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1 });
  guard.rotateY(Math.PI / 2);
  guard.translate(-0.006, 0, 0);
  mesh(guard, M.receiver, root);
  // Trigger blade.
  const trigger = new THREE.Shape();
  trigger.moveTo(0.004, -0.04);
  trigger.quadraticCurveTo(0.012, -0.055, 0.004, -0.066);
  trigger.lineTo(-0.002, -0.064);
  trigger.quadraticCurveTo(0.004, -0.054, -0.003, -0.04);
  const triggerGeometry = new THREE.ExtrudeGeometry(trigger, { depth: 0.006, bevelEnabled: false });
  triggerGeometry.rotateY(Math.PI / 2);
  triggerGeometry.translate(-0.003, 0, 0);
  mesh(triggerGeometry, M.steel, root);

  // Pistol grip, raked back, with finger grooves on the front edge.
  const grip = new THREE.Shape();
  grip.moveTo(-0.018, -0.036);
  grip.quadraticCurveTo(-0.034, -0.06, -0.03, -0.075);
  grip.quadraticCurveTo(-0.04, -0.09, -0.04, -0.1);
  grip.quadraticCurveTo(-0.05, -0.115, -0.048, -0.128);
  grip.lineTo(-0.058, -0.146);
  grip.lineTo(-0.108, -0.142);
  grip.quadraticCurveTo(-0.104, -0.1, -0.078, -0.036);
  const gripGeometry = new THREE.ExtrudeGeometry(grip, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 3, curveSegments: 8 });
  gripGeometry.rotateY(Math.PI / 2);
  gripGeometry.translate(-0.013, 0, 0);
  gripGeometry.computeVertexNormals();
  mesh(gripGeometry, M.polymer, root);
}

/**
 * A holographic sight on a mount, sitting on a rail at y = 0.071: a hooded housing with a
 * window, two panes of glass and a glowing reticle. Returns where the reticle's dot is.
 * `forward` slides the whole sight along the gun.
 */
export function addHoloSight(root: THREE.Object3D, forward = 0) {
  const M = RIFLE_MATERIALS;
  // Holographic sight: a mount, a hooded housing with a window, glass, and the reticle.
  const sight = new THREE.Group();
  box(sight, [0.03, 0.012, 0.075], [0, 0.077, -0.02], M.receiver);
  // The hood: thin walls around a big window, so aiming through it feels open.
  const hood = new THREE.Shape([
    new THREE.Vector2(-0.026, 0),
    new THREE.Vector2(0.026, 0),
    new THREE.Vector2(0.026, 0.044),
    new THREE.Vector2(0.02, 0.05),
    new THREE.Vector2(-0.02, 0.05),
    new THREE.Vector2(-0.026, 0.044),
  ]);
  hood.holes.push(new THREE.Path([new THREE.Vector2(-0.0225, 0.006), new THREE.Vector2(-0.0225, 0.045), new THREE.Vector2(0.0225, 0.045), new THREE.Vector2(0.0225, 0.006)]));
  const hoodGeometry = new THREE.ExtrudeGeometry(hood, { depth: 0.036, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.001, bevelSegments: 2 });
  hoodGeometry.translate(0, 0.083, -0.052);
  hoodGeometry.computeVertexNormals();
  mesh(hoodGeometry, M.receiver, sight);
  // A base block under the window holds the electronics.
  box(sight, [0.05, 0.008, 0.05], [0, 0.087, -0.03], M.receiver);
  // Two panes of glass, front and back of the window.
  const windowCenter = 0.083 + 0.0255;
  for (const z of [-0.05, -0.017]) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.039), M.glass);
    pane.position.set(0, windowCenter, z);
    sight.add(pane);
  }
  // Reticle: a ring with a center dot, glowing on the front glass.
  const sightDot = new THREE.Vector3(0, windowCenter, -0.049);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0052, 0.0058, 48), M.reticle);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.00075, 16), M.reticle);
  ring.position.copy(sightDot);
  dot.position.copy(sightDot);
  sight.add(ring, dot);
  // Buttons and a status light on the right side of the hood.
  box(sight, [0.004, 0.006, 0.007], [0.027, 0.095, -0.036], M.rubber);
  box(sight, [0.004, 0.006, 0.007], [0.027, 0.095, -0.026], M.rubber);
  box(sight, [0.002, 0.003, 0.003], [-0.0265, 0.095, -0.03], M.amber);
  sight.position.z = -forward;
  root.add(sight);
  return sightDot.clone().setZ(sightDot.z - forward);

}

/** A magazine on its own (also used for the dropped ones). Its origin is at the top, where it locks in. */
export function buildMagazine() {
  const M = RIFLE_MATERIALS;
  const magazine = new THREE.Group();
  // Curved body: front and back edges bow forward as they go down.
  const body = new THREE.Shape();
  body.moveTo(0.036, 0.004);
  body.lineTo(-0.036, 0.004);
  body.quadraticCurveTo(-0.03, -0.1, -0.006, -0.19);
  body.lineTo(0.064, -0.196);
  body.quadraticCurveTo(0.044, -0.1, 0.036, 0.004);
  const geometry = new THREE.ExtrudeGeometry(body, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.0025, bevelSize: 0.002, bevelSegments: 2, curveSegments: 12 });
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-0.011, 0, 0);
  geometry.computeVertexNormals();
  mesh(geometry, M.polymer, magazine);
  // Grip ribs near the bottom and a wider base plate.
  for (let i = 0; i < 3; i++) box(magazine, [0.029, 0.004, 0.06], [0, -0.14 - i * 0.012, -0.022 - i * 0.002], M.polymer);
  const base = box(magazine, [0.032, 0.012, 0.078], [0, -0.198, -0.03], M.polymer);
  base.rotation.x = -0.12;
  // Top round showing in the feed lips.
  const round = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 1, roughness: 0.3 }), magazine);
  round.rotation.x = Math.PI / 2;
  round.position.set(0, 0.006, 0);
  return magazine;
}

// In vacuum there's no air for leftover powder gases to burn in, so the flash is
// small and short: a hot white core and a few sparks, no big fireball.
export function buildMuzzleFlash(color = 0xffd9a0) {
  const material = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const flash = new THREE.Group();
  flash.add(new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), material));
  for (const angle of [0, Math.PI / 2]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.11), material);
    side.rotation.order = 'ZYX';
    side.rotation.set(Math.PI / 2, 0, angle);
    side.position.z = -0.04;
    flash.add(side);
  }
  flash.visible = false;
  return flash;
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,230,180,0.9)');
  g.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// A fine, even grain (machining marks on metal, stippling on polymer) used as a bump map.
function grainTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(77);
  for (let i = 0; i < size * size; i++) {
    const v = 110 + random() * 60;
    data.set([v, v, v, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(40, 40);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// The ammo counter screen: amber digits on black, redrawn when the count changes.
function ammoDisplay() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xffffff, emissiveMap: texture, roughness: 0.2 });
  let shown = '';
  const set = (ammo: number, capacity: number, reloading: boolean) => {
    const text = reloading ? '--' : String(ammo).padStart(2, '0');
    if (text === shown) return;
    shown = text;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 64);
    const low = !reloading && ammo <= capacity / 4;
    ctx.fillStyle = low ? '#ff5a1f' : '#ffa31a';
    ctx.font = 'bold 50px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 34);
    texture.needsUpdate = true;
  };
  set(30, 30, false);
  return { material, set };
}
