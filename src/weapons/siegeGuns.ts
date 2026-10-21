import * as THREE from 'three';
import { type GunModel, SUPPORT_GRIP } from './gunModel';
import { RIFLE_MATERIALS as M, addGripAndTrigger, addHoloSight, box, buildMuzzleFlash, mesh, profile, tube } from './rifleModel';
import type { WeaponId } from './weaponSpec';

// Drone Siege's guns, built from the same kinds of parts as the rifle. Every one puts
// its pistol grip at the origin (where the right glove holds it), and the two-handed
// ones put a handguard where the left glove was shaped to hold one (SUPPORT_GRIP).
// Player energy weapons glow amber: red belongs to the hostile drones.

const BORE = 0.03;
const AMBER_GLOW = 0xffa31a;

/** A glowing amber material (one per gun, since its glow flares when that gun fires). */
function glowMaterial(intensity = 1.2) {
  return new THREE.MeshStandardMaterial({ color: 0x40280a, emissive: AMBER_GLOW, emissiveIntensity: intensity, roughness: 0.4 });
}

function base(parts: Partial<GunModel> & Pick<GunModel, 'root' | 'magazine' | 'magazineWell' | 'sight' | 'muzzle'>): GunModel {
  const flash = parts.flash ?? buildMuzzleFlash();
  flash.position.copy(parts.muzzle);
  parts.root.add(flash);
  parts.magazine.position.copy(parts.magazineWell);
  parts.root.add(parts.magazine);
  return {
    flash,
    flashSize: 1,
    ejectionPort: null,
    support: SUPPORT_GRIP.clone(),
    action: null,
    hipOffset: new THREE.Vector3(),
    glow: null,
    setAmmoDisplay: null,
    scope: null,
    ...parts,
    moving: [parts.magazine, flash, ...(parts.action ? [parts.action.part] : []), ...(parts.moving ?? [])],
  };
}

// ---- P-9 sidearm: a compact pistol, held in one hand ----

function buildSidearm(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  // Polymer frame with the trigger guard area.
  mesh(profile([[-0.08, -0.004], [0.125, -0.004], [0.125, -0.026], [0.03, -0.03], [0.02, -0.042], [-0.06, -0.042], [-0.08, -0.03]], 0.028), M.polymer, root);
  // The slide, which cycles on each shot, with grip serrations and sights.
  const slide = new THREE.Group();
  mesh(profile([[-0.085, 0], [0.13, 0], [0.13, 0.03], [0.122, 0.036], [-0.078, 0.036], [-0.085, 0.03]], 0.03, 0.003), M.receiver, slide);
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) box(slide, [0.002, 0.024, 0.003], [side * 0.0152, 0.018, 0.06 - i * 0.006], M.rubber);
  box(slide, [0.004, 0.007, 0.006], [0, 0.0395, -0.12], M.receiver); // front post
  box(slide, [0.002, 0.002, 0.001], [0, 0.04, -0.1165], M.amber); // its glowing dot
  for (const side of [-1, 1]) box(slide, [0.008, 0.007, 0.006], [side * 0.0075, 0.0395, 0.07], M.receiver); // rear notch
  box(slide, [0.004, 0.012, 0.022], [0.0152, 0.026, -0.005], M.rubber); // ejection port
  root.add(slide);
  tube(root, 0.0065, 0.125, 0.131, 0.018, M.steel, 16); // the barrel's end
  // The magazine sits inside the grip; only its base plate shows. It drops out the bottom.
  const magazine = new THREE.Group();
  const body = box(magazine, [0.022, 0.11, 0.032], [0, -0.055, 0.012], M.polymer);
  body.rotation.x = -0.27;
  box(magazine, [0.03, 0.012, 0.05], [0, -0.108, 0.035], M.polymer).rotation.x = -0.27;
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.035, 0.05),
    sight: new THREE.Vector3(0, 0.041, -0.12),
    muzzle: new THREE.Vector3(0, 0.018, -0.133),
    flashSize: 0.6,
    ejectionPort: new THREE.Vector3(0.016, 0.026, -0.005),
    support: null,
    action: { part: slide, travel: 0.028, delay: 0, carriesHand: false },
    hipOffset: new THREE.Vector3(-0.025, 0.055, -0.03),
  });
}

// ---- Plasma SMG: short and boxy, with glowing vents along a stubby shroud ----

function buildSmg(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  // White upper and dark lower receiver.
  mesh(profile([[-0.11, 0.008], [0.2, 0.008], [0.2, 0.06], [0.19, 0.068], [-0.1, 0.068], [-0.11, 0.058]], 0.05), M.thermal, root);
  mesh(profile([[-0.09, 0.008], [0.15, 0.008], [0.15, -0.025], [0.13, -0.034], [0.03, -0.042], [-0.07, -0.042], [-0.09, -0.026]], 0.046), M.receiver, root);
  // Rail and holographic sight.
  box(root, [0.021, 0.005, 0.2], [0, 0.0685, -0.03], M.receiver);
  const sight = addHoloSight(root, 0.01);
  // The shroud: dark, eight-sided, with glowing slots down each side.
  const shroud = tube(root, 0.031, 0.2, 0.4, BORE, M.receiver, 8);
  shroud.rotation.y = Math.PI / 8;
  const glow = glowMaterial(1.1);
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) box(root, [0.004, 0.006, 0.02], [side * 0.03, BORE + 0.008, -(0.22 + i * 0.03)], glow);
  for (let i = 0; i < 6; i++) box(root, [0.01, 0.004, 0.02], [0, BORE - 0.031, -(0.22 + i * 0.03)], glow);
  tube(root, 0.024, 0.4, 0.416, BORE, M.steel, 12); // muzzle cap
  box(root, [0.012, 0.004, 0.004], [0, BORE, -0.417], glow); // the emitter's lip
  // A folding wire stock along the right side.
  for (const y of [0.05, -0.012]) box(root, [0.006, 0.006, 0.17], [0.022, y, 0.2], M.steel);
  box(root, [0.03, 0.08, 0.012], [0.022, 0.018, 0.29], M.rubber);
  // A power cell instead of a magazine, with amber charge marks.
  const magazine = new THREE.Group();
  box(magazine, [0.034, 0.1, 0.045], [0, -0.05, 0], M.polymer);
  for (const side of [-1, 1]) box(magazine, [0.002, 0.06, 0.006], [side * 0.0175, -0.05, -0.012], glow);
  box(magazine, [0.026, 0.006, 0.03], [0, 0.002, 0], M.steel);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.03, -0.09),
    sight,
    muzzle: new THREE.Vector3(0, BORE, -0.42),
    flash: buildMuzzleFlash(0xffb347),
    flashSize: 0.75,
    glow,
  });
}

// ---- Scatter Cannon: a heavy pump-action shotgun ----

function buildScatter(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  mesh(profile([[-0.12, -0.03], [0.2, -0.03], [0.2, 0.075], [0.185, 0.083], [-0.1, 0.083], [-0.12, 0.07]], 0.062, 0.004), M.receiver, root);
  // A wide barrel with a reinforcing band at the muzzle.
  tube(root, 0.019, 0.2, 0.62, BORE, M.steel, 16);
  tube(root, 0.023, 0.59, 0.63, BORE, M.receiver, 12);
  // The pump: slides back after each shot to chamber the next shell, taking your hand with it.
  const pump = new THREE.Group();
  const grip = tube(pump, 0.036, 0.24, 0.4, BORE, M.polymer, 8);
  grip.rotation.y = Math.PI / 8;
  for (let i = 0; i < 6; i++) tube(pump, 0.0372, 0.255 + i * 0.024, 0.262 + i * 0.024, BORE, M.rubber, 8).rotation.y = Math.PI / 8;
  root.add(pump);
  // Sights: a ghost ring on a post at the back of the receiver and an amber bead on a
  // post at the muzzle, both standing well clear of the receiver so it doesn't block the view.
  const sightY = 0.118;
  const ring = mesh(new THREE.TorusGeometry(0.0085, 0.0018, 8, 24), M.receiver, root);
  ring.position.set(0, sightY, 0.08);
  box(root, [0.006, sightY - 0.083 - 0.008, 0.01], [0, (sightY + 0.083 - 0.008) / 2, 0.08], M.receiver);
  box(root, [0.004, sightY - 0.049, 0.006], [0, (sightY + 0.049) / 2 - 0.003, -0.6], M.receiver);
  mesh(new THREE.SphereGeometry(0.0035, 10, 8), M.amber, root).position.set(0, sightY, -0.6);
  // Solid stock and butt pad.
  mesh(profile([[-0.12, 0.07], [-0.15, 0.075], [-0.36, 0.05], [-0.37, -0.075], [-0.33, -0.08], [-0.2, -0.03], [-0.12, -0.02]], 0.05, 0.004), M.polymer, root);
  mesh(profile([[-0.37, 0.052], [-0.385, 0.052], [-0.385, -0.08], [-0.37, -0.076]], 0.054, 0.003), M.rubber, root);
  // A stubby box magazine of six shells.
  const magazine = new THREE.Group();
  box(magazine, [0.05, 0.09, 0.075], [0, -0.045, 0], M.polymer);
  for (let i = 0; i < 2; i++) box(magazine, [0.052, 0.004, 0.06], [0, -0.065 - i * 0.012, 0], M.rubber);
  const shell = mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.06, 14), M.amber, magazine);
  shell.rotation.x = Math.PI / 2;
  shell.position.set(0, 0.006, 0);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.03, -0.065),
    sight: new THREE.Vector3(0, sightY, 0.08),
    muzzle: new THREE.Vector3(0, BORE, -0.635),
    flashSize: 1.5,
    ejectionPort: new THREE.Vector3(0.032, 0.04, 0.02),
    action: { part: pump, travel: 0.075, delay: 0.26, carriesHand: true },
  });
}

// ---- Burst Carbine: a short rifle with a magnified scope ----

function buildCarbine(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  mesh(profile([[-0.13, 0.008], [0.14, 0.008], [0.14, 0.057], [0.128, 0.062], [-0.118, 0.062], [-0.13, 0.054]], 0.052), M.receiver, root);
  mesh(profile([[-0.1, 0.008], [0.13, 0.008], [0.13, -0.02], [0.114, -0.03], [0.11, -0.082], [0.034, -0.082], [0.03, -0.042], [-0.074, -0.042], [-0.1, -0.026]], 0.048), M.polymer, root);
  // A round dark handguard with an amber stripe, then the barrel and a flash hider.
  tube(root, 0.032, 0.13, 0.37, BORE, M.receiver, 20);
  box(root, [0.003, 0.004, 0.2], [-0.032, BORE + 0.006, -0.25], M.amber);
  tube(root, 0.009, 0.37, 0.47, BORE, M.steel);
  tube(root, 0.012, 0.45, 0.49, BORE, M.receiver, 6);
  // Rail, scope rings and the scope: a tube with a wider objective lens at the front.
  box(root, [0.021, 0.006, 0.34], [0, 0.065, -0.08], M.receiver);
  for (const z of [0.0, -0.11]) box(root, [0.026, 0.026, 0.014], [0, 0.08, z], M.receiver);
  const scopeY = 0.1;
  tube(root, 0.016, -0.06, 0.13, scopeY, M.receiver, 20);
  tube(root, 0.021, 0.1, 0.16, scopeY, M.receiver, 20);
  tube(root, 0.019, -0.075, -0.04, scopeY, M.rubber, 20); // rubber eyepiece
  for (const z of [-0.16, 0.06]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(z < 0 ? 0.019 : 0.016, 24), M.glass);
    lens.position.set(0, scopeY, z);
    root.add(lens);
  }
  // The reticle inside: fine dark crosshairs with an amber dot.
  const reticle = new THREE.Group();
  box(reticle, [0.026, 0.0004, 0.0004], [0, 0, 0], M.rubber);
  box(reticle, [0.0004, 0.026, 0.0004], [0, 0, 0], M.rubber);
  mesh(new THREE.CircleGeometry(0.0009, 12), M.reticle, reticle).position.z = 0.0003;
  reticle.position.set(0, scopeY, -0.02);
  root.add(reticle);
  // Fixed stock.
  tube(root, 0.0155, -0.28, -0.12, 0.034, M.receiver);
  mesh(profile([[-0.18, 0.016], [-0.19, 0.056], [-0.33, 0.06], [-0.335, -0.055], [-0.3, -0.06], [-0.24, -0.012], [-0.19, 0.004]], 0.042, 0.004), M.polymer, root);
  // Bolt in the ejection port.
  const bolt = new THREE.Group();
  box(bolt, [0.003, 0.014, 0.06], [0.0272, 0.035, 0], M.steel);
  root.add(bolt);
  box(root, [0.002, 0.022, 0.07], [0.0265, 0.034, 0], M.rubber);
  // A straight box magazine.
  const magazine = new THREE.Group();
  box(magazine, [0.024, 0.15, 0.06], [0, -0.075, -0.015], M.polymer);
  for (let i = 0; i < 4; i++) box(magazine, [0.026, 0.003, 0.05], [0, -0.05 - i * 0.02, -0.015], M.rubber);
  box(magazine, [0.03, 0.012, 0.068], [0, -0.155, -0.015], M.polymer);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.074, -0.072),
    sight: new THREE.Vector3(0, scopeY, 0.06),
    scope: 'cross',
    muzzle: new THREE.Vector3(0, BORE, -0.49),
    flashSize: 0.9,
    ejectionPort: new THREE.Vector3(0.03, 0.035, 0),
    action: { part: bolt, travel: 0.04, delay: 0, carriesHand: false },
  });
}

// ---- Rail Rifle: a long electromagnetic launcher with glowing coils between two rails ----

function buildRail(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  mesh(profile([[-0.14, -0.035], [0.22, -0.035], [0.22, 0.07], [0.2, 0.078], [-0.12, 0.078], [-0.14, 0.065]], 0.056, 0.004), M.receiver, root);
  for (const side of [-1, 1]) box(root, [0.002, 0.05, 0.24], [side * 0.0285, 0.025, -0.06], M.thermal); // side panels
  // The rails above and below the bore, and the coils between them.
  for (const y of [0.058, 0.002]) box(root, [0.012, 0.01, 0.52], [0, y, -0.48], M.steel);
  const glow = glowMaterial(0.8);
  for (let i = 0; i < 9; i++) {
    const coil = mesh(new THREE.TorusGeometry(0.024, 0.0055, 8, 24), glow, root);
    coil.position.set(0, BORE, -(0.42 + i * 0.037));
  }
  // A white sleeve to hold, and a heavy emitter at the end.
  const sleeve = tube(root, 0.034, 0.24, 0.39, BORE, M.thermal, 8);
  sleeve.rotation.y = Math.PI / 8;
  tube(root, 0.02, 0.73, 0.76, BORE, M.receiver, 8);
  // A long scope.
  for (const z of [0.02, -0.12]) box(root, [0.024, 0.03, 0.014], [0, 0.09, z], M.receiver);
  const scopeY = 0.108;
  tube(root, 0.018, -0.06, 0.18, scopeY, M.receiver, 20);
  tube(root, 0.023, 0.15, 0.21, scopeY, M.receiver, 20);
  tube(root, 0.02, -0.075, -0.04, scopeY, M.rubber, 20);
  for (const z of [-0.21, 0.06]) {
    const lens = new THREE.Mesh(new THREE.CircleGeometry(z < 0 ? 0.021 : 0.018, 24), M.glass);
    lens.position.set(0, scopeY, z);
    root.add(lens);
  }
  const reticle = new THREE.Group();
  box(reticle, [0.03, 0.0004, 0.0004], [0, 0, 0], M.rubber);
  box(reticle, [0.0004, 0.03, 0.0004], [0, 0, 0], M.rubber);
  mesh(new THREE.RingGeometry(0.0016, 0.0022, 24), M.reticle, reticle).position.z = 0.0003;
  reticle.position.set(0, scopeY, -0.02);
  root.add(reticle);
  // Skeleton stock.
  for (const y of [0.05, -0.03]) box(root, [0.012, 0.012, 0.2], [0, y, 0.24], M.receiver);
  mesh(profile([[-0.33, 0.06], [-0.35, 0.06], [-0.35, -0.07], [-0.33, -0.065]], 0.046, 0.003), M.rubber, root);
  // The power cell, with a window showing its charge.
  const magazine = new THREE.Group();
  box(magazine, [0.04, 0.085, 0.06], [0, -0.042, 0], M.polymer);
  box(magazine, [0.0025, 0.05, 0.03], [-0.0205, -0.042, 0], glow);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.035, -0.07),
    sight: new THREE.Vector3(0, scopeY, 0.06),
    scope: 'ring',
    muzzle: new THREE.Vector3(0, BORE, -0.77),
    flash: buildMuzzleFlash(0xfff2dc),
    flashSize: 1.6,
    glow,
  });
}

/** Build the model for one of Drone Siege's guns. */
export function buildSiegeGun(id: Exclude<WeaponId, 'rifle'>): GunModel {
  switch (id) {
    case 'sidearm':
      return buildSidearm();
    case 'smg':
      return buildSmg();
    case 'scatter':
      return buildScatter();
    case 'carbine':
      return buildCarbine();
    case 'rail':
      return buildRail();
  }
}
