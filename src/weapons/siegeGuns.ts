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

// ---- Singularity Launcher: a squat launcher with a containment chamber you can see into ----

function buildSingularity(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  // A heavy receiver, white on top and dark below.
  mesh(profile([[-0.13, 0.006], [0.16, 0.006], [0.16, 0.085], [0.145, 0.095], [-0.11, 0.095], [-0.13, 0.08]], 0.07, 0.005), M.thermal, root);
  mesh(profile([[-0.1, 0.006], [0.13, 0.006], [0.13, -0.03], [0.1, -0.04], [-0.08, -0.04], [-0.1, -0.026]], 0.064), M.receiver, root);
  // The chamber: a dark sphere held in a cage, ringed with light.
  const glow = glowMaterial(1.6);
  const core = mesh(new THREE.SphereGeometry(0.038, 20, 14), M.rubber, root);
  core.position.set(0, 0.05, -0.22);
  const ring = mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 32), glow, root);
  ring.position.copy(core.position);
  ring.rotation.x = Math.PI / 2;
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const bar = box(root, [0.006, 0.006, 0.11], [Math.cos(a) * 0.052, 0.05 + Math.sin(a) * 0.052, -0.22], M.receiver);
    bar.rotation.z = a;
  }
  // A wide, short barrel with an emitter ring at the mouth.
  tube(root, 0.04, 0.28, 0.44, 0.05, M.receiver, 10).rotation.y = Math.PI / 10;
  const mouth = mesh(new THREE.TorusGeometry(0.036, 0.007, 8, 28), glow, root);
  mouth.position.set(0, 0.05, -0.445);
  tube(root, 0.03, 0.44, 0.45, 0.05, M.rubber, 20);
  // A handle on top with a simple sight.
  box(root, [0.016, 0.04, 0.012], [0, 0.115, 0.04], M.receiver);
  box(root, [0.016, 0.04, 0.012], [0, 0.115, -0.12], M.receiver);
  box(root, [0.018, 0.012, 0.18], [0, 0.138, -0.04], M.polymer);
  const sightY = 0.152;
  const sightRing = mesh(new THREE.TorusGeometry(0.008, 0.0018, 8, 24), M.receiver, root);
  sightRing.position.set(0, sightY, 0.03);
  mesh(new THREE.SphereGeometry(0.003, 10, 8), M.amber, root).position.set(0, sightY, -0.12);
  // Stubby stock.
  mesh(profile([[-0.13, 0.08], [-0.3, 0.06], [-0.31, -0.06], [-0.27, -0.065], [-0.17, -0.02], [-0.13, -0.02]], 0.05, 0.004), M.polymer, root);
  // The containment cell: a squat canister with a glowing window.
  const magazine = new THREE.Group();
  const can = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 16), M.polymer, magazine);
  can.position.set(0, -0.04, 0);
  box(magazine, [0.008, 0.05, 0.004], [0, -0.04, -0.03], glow);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.035, -0.09),
    sight: new THREE.Vector3(0, sightY, 0.03),
    muzzle: new THREE.Vector3(0, 0.05, -0.455),
    flash: buildMuzzleFlash(0xfff0d8),
    flashSize: 1.2,
    glow,
  });
}

// ---- Arc Caster: a coil gun with three prongs that throw lightning ----

function buildArc(): GunModel {
  const root = new THREE.Group();
  addGripAndTrigger(root);
  mesh(profile([[-0.12, 0.008], [0.15, 0.008], [0.15, 0.064], [0.14, 0.072], [-0.1, 0.072], [-0.12, 0.062]], 0.052), M.receiver, root);
  mesh(profile([[-0.09, 0.008], [0.12, 0.008], [0.12, -0.028], [0.1, -0.036], [-0.07, -0.036], [-0.09, -0.024]], 0.048), M.thermal, root);
  box(root, [0.021, 0.005, 0.18], [0, 0.0725, -0.03], M.receiver);
  const sight = addHoloSight(root, 0.01);
  // A central rod wound with glowing coils.
  const glow = glowMaterial(1.3);
  tube(root, 0.008, 0.15, 0.46, BORE, M.steel, 12);
  for (let i = 0; i < 7; i++) {
    const coil = mesh(new THREE.TorusGeometry(0.022 - i * 0.0012, 0.005, 8, 22), glow, root);
    coil.position.set(0, BORE, -(0.18 + i * 0.035));
  }
  // Three prongs splayed around the tip.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2;
    const prong = box(root, [0.006, 0.006, 0.12], [Math.cos(a) * 0.03, BORE + Math.sin(a) * 0.03, -0.43], M.receiver);
    prong.rotation.set(Math.sin(a) * 0.25, -Math.cos(a) * 0.25, 0);
    mesh(new THREE.SphereGeometry(0.006, 8, 6), glow, root).position.set(Math.cos(a) * 0.04, BORE + Math.sin(a) * 0.04, -0.49);
  }
  // Side battery with charge marks, and a skeleton stock.
  box(root, [0.016, 0.04, 0.12], [-0.034, 0.03, -0.08], M.polymer);
  for (let i = 0; i < 4; i++) box(root, [0.002, 0.026, 0.012], [-0.0425, 0.03, -0.03 - i * 0.025], glow);
  for (const y of [0.05, -0.015]) box(root, [0.01, 0.01, 0.19], [0, y, 0.21], M.receiver);
  mesh(profile([[-0.3, 0.06], [-0.32, 0.06], [-0.32, -0.06], [-0.3, -0.055]], 0.044, 0.003), M.rubber, root);
  // A cell for a magazine.
  const magazine = new THREE.Group();
  box(magazine, [0.032, 0.09, 0.05], [0, -0.045, 0], M.polymer);
  for (const side of [-1, 1]) box(magazine, [0.002, 0.05, 0.006], [side * 0.0165, -0.045, -0.014], glow);
  return base({
    root,
    magazine,
    magazineWell: new THREE.Vector3(0, -0.03, -0.085),
    sight,
    muzzle: new THREE.Vector3(0, BORE, -0.5),
    flash: buildMuzzleFlash(0xfff4e0),
    flashSize: 0.9,
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
    case 'singularity':
      return buildSingularity();
    case 'arc':
      return buildArc();
  }
}

// Overclocked guns look the part: bronze and gold metal with an inner amber glow, and
// energy parts burning white-hot.
let overclockMaterials: Map<THREE.Material, THREE.Material> | null = null;

function overclockPalette() {
  if (overclockMaterials) return overclockMaterials;
  const grain = (M.receiver as THREE.MeshStandardMaterial).bumpMap;
  const metal = (color: number, roughness: number, glow: number) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.9, bumpMap: grain, bumpScale: 0.3, emissive: 0xff7a10, emissiveIntensity: glow });
  overclockMaterials = new Map<THREE.Material, THREE.Material>([
    [M.receiver, metal(0x6e4a22, 0.3, 0.06)],
    [M.steel, metal(0x9a7a4a, 0.25, 0.04)],
    [M.thermal, new THREE.MeshStandardMaterial({ color: 0xd8a050, roughness: 0.4, metalness: 0.6, emissive: 0xff9a30, emissiveIntensity: 0.3 })],
    [M.polymer, new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 0.35, metalness: 0.3, emissive: 0xff7a10, emissiveIntensity: 0.04 })],
    [M.amber, new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xfff0d0, emissiveIntensity: 1.6 })],
  ]);
  return overclockMaterials;
}

/** Turn a freshly built gun model into its overclocked look (in place). */
export function overclockLook(model: GunModel) {
  const palette = overclockPalette();
  const hot = model.glow ? model.glow.clone() : null;
  if (hot) {
    hot.emissive.set(0xffe2b8);
    hot.emissiveIntensity = model.glow!.emissiveIntensity * 1.6;
  }
  const swap = (object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (hot && mesh.material === model.glow) mesh.material = hot;
    else mesh.material = palette.get(mesh.material as THREE.Material) ?? mesh.material;
  };
  model.root.traverse(swap);
  model.magazine.traverse(swap);
  if (hot) model.glow = hot;
  return model;
}
