import * as THREE from 'three';

// What the viewmodel needs from any gun's 3D model: the mesh, and the points it lines
// up with (the sight with your eye, the grip with your right hand, the support with
// your left), plus the parts that move.
//
// Gun space: x = right, y = up, -z = forward (toward the muzzle), meters. The origin
// sits at the trigger, where the right hand's grip is on every gun.
export interface GunModel {
  root: THREE.Group;
  flash: THREE.Group;
  flashSize: number;
  magazine: THREE.Group; // comes out during a reload
  magazineWell: THREE.Vector3; // where the magazine attaches
  /** Where the eye lines up when aiming: the reticle's dot, a rear sight, or a scope's eyepiece. */
  sight: THREE.Vector3;
  muzzle: THREE.Vector3;
  /** Where spent casings come out; null for energy weapons, which have none. */
  ejectionPort: THREE.Vector3 | null;
  /** Where the left hand holds it; null for a one-handed gun. */
  support: THREE.Vector3 | null;
  /** A part that cycles on each shot (bolt, slide, pump): how far back, and how long after the shot. */
  action: { part: THREE.Object3D; travel: number; delay: number; carriesHand: boolean } | null;
  /** A nudge from the usual hip position (a pistol sits closer in). */
  hipOffset: THREE.Vector3;
  /** A glowing material that flares on each shot and fades (energy weapons). */
  glow: THREE.MeshStandardMaterial | null;
  setAmmoDisplay: ((ammo: number, capacity: number, reloading: boolean) => void) | null;
  /** Parts that move on their own, kept out of the mesh merge. */
  moving: THREE.Object3D[];
  /**
   * A magnified scope: fully aimed, the view switches to looking through it (the HUD's
   * scope overlay with this reticle). A real tube in front of the eye would show only a
   * pinhole of the far lens, so scopes are drawn this way in most shooters.
   */
  scope: 'cross' | 'ring' | null;
}

/** Where the left glove was shaped to hold a handguard (see hands.ts). */
export const SUPPORT_GRIP = new THREE.Vector3(0, 0.03, -0.31);
