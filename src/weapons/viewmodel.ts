import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Rifle } from './rifle';

// Where the holo sight's red-dot (here: amber dot) sits on the gun model.
// When aiming down sights we move the gun so this point lines up with screen center.
const SIGHT_DOT = new THREE.Vector3(0, 0.078, -0.03);
const MUZZLE = new THREE.Vector3(0, 0.005, -0.57);
const SIGHT_DISTANCE = 0.2; // how far in front of the eye the sight sits when aiming

// The rifle you see in your hands, built from simple shapes.
// It lives in its own little scene drawn on top of the world with its own camera,
// so it never pokes through walls and doesn't stretch when the main view zooms.
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private gun = new THREE.Group();
  private flash: THREE.Group;
  private flashLight = new THREE.PointLight(0xffb050, 0, 2);
  private flashTimer = 0;

  private kick = 0; // 0 to 1-ish, how much recent shooting is pushing the gun back
  private sway = new THREE.Vector2();
  private bobPhase = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.viewmodel.fov,
      window.innerWidth / window.innerHeight,
      0.01,
      10,
    );
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    // The gun gets its own lights, matched roughly to the world's harsh sun.
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(0.6, 1, 0.4);
    this.scene.add(sun, new THREE.AmbientLight(0xffffff, 0.35), this.flashLight);

    buildRifle(this.gun);
    this.flash = buildMuzzleFlash();
    this.flash.position.copy(MUZZLE);
    this.gun.add(this.flash);
    this.flashLight.position.copy(MUZZLE);
    this.gun.add(this.flashLight);
    this.scene.add(this.gun);
  }

  fire() {
    this.kick = Math.min(1.5, this.kick + 1);
    this.flashTimer = CONFIG.viewmodel.muzzleFlashTime;
    // A new random twist each shot so the flash never looks the same twice.
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  update(dt: number, rifle: Rifle, mouse: { x: number; y: number }, speed: number, grounded: boolean) {
    const cfg = CONFIG.viewmodel;
    const aim = rifle.aimBlend;

    // Position: blend from the bottom-right hip spot to centered behind the sight.
    const hip = new THREE.Vector3(cfg.hipPosition.x, cfg.hipPosition.y, cfg.hipPosition.z);
    const ads = new THREE.Vector3(-SIGHT_DOT.x, -SIGHT_DOT.y, -SIGHT_DISTANCE - SIGHT_DOT.z);
    const position = hip.lerp(ads, aim);

    // Sway: the gun lags a little behind fast mouse movement (less when aiming).
    const swayTarget = new THREE.Vector2(-mouse.x, mouse.y).multiplyScalar(cfg.swayAmount * (1 - aim * 0.8));
    swayTarget.clampLength(0, 0.03);
    this.sway.lerp(swayTarget, Math.min(1, 10 * dt));
    position.x += this.sway.x;
    position.y += this.sway.y;

    // Bob while walking, matching the camera's rhythm.
    this.bobPhase += speed * dt * CONFIG.cameraFx.bobFrequency * Math.PI;
    const bobScale = grounded ? Math.min(1, speed / CONFIG.player.walkSpeed) * (1 - aim * 0.85) : 0;
    position.x += Math.sin(this.bobPhase) * 0.008 * bobScale;
    position.y += Math.abs(Math.sin(this.bobPhase)) * 0.008 * bobScale;

    // Kick: slide back and tilt up on each shot, then settle.
    this.kick -= this.kick * Math.min(1, cfg.kickRecovery * dt);
    position.z += this.kick * cfg.kickBack * (1 - aim * 0.5);
    let tiltX = THREE.MathUtils.degToRad(cfg.kickUp) * this.kick * (1 - aim * 0.6);
    let rollZ = 0;

    // Reload: dip the gun down and roll it over, peaking halfway through.
    if (rifle.reloading) {
      const dip = Math.sin(rifle.reloadProgress * Math.PI);
      position.y -= 0.12 * dip;
      tiltX -= 0.5 * dip;
      rollZ += 0.6 * dip;
    }

    this.gun.position.copy(position);
    // At the hip the gun angles slightly toward the screen center.
    this.gun.rotation.set(tiltX, 0.04 * (1 - aim), rollZ);

    // Muzzle flash
    this.flashTimer -= dt;
    const flashing = this.flashTimer > 0;
    this.flash.visible = flashing;
    this.flashLight.intensity = flashing ? 3 : 0;
  }
}

function buildRifle(gun: THREE.Group) {
  // Low metalness on purpose: shiny metal looks black when there's no environment to reflect.
  const metal = new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 0.55, metalness: 0.25 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x6b655c, roughness: 0.85 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffa31a, emissive: 0xff8a00, emissiveIntensity: 0.6 });

  // [width, height, depth], [x, y, z], material, optional tilt around x
  const boxes: [number[], number[], THREE.Material, number?][] = [
    [[0.06, 0.08, 0.3], [0, 0, 0], metal], // receiver
    [[0.056, 0.06, 0.24], [0, -0.004, -0.27], polymer], // handguard
    [[0.04, 0.13, 0.07], [0, -0.1, -0.05], metal, 0.2], // magazine
    [[0.036, 0.1, 0.045], [0, -0.085, 0.1], polymer, -0.35], // grip
    [[0.045, 0.075, 0.2], [0, -0.015, 0.25], polymer], // stock
    [[0.062, 0.008, 0.18], [0, 0.0, -0.06], amber], // accent stripe (sticks out slightly each side)
    [[0.035, 0.014, 0.08], [0, 0.047, -0.03], metal], // sight base
    [[0.006, 0.05, 0.012], [-0.022, 0.078, -0.06], metal], // sight frame left
    [[0.006, 0.05, 0.012], [0.022, 0.078, -0.06], metal], // sight frame right
    [[0.05, 0.006, 0.012], [0, 0.103, -0.06], metal], // sight frame top
  ];
  for (const [[w, h, d], [x, y, z], material, tilt] of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    if (tilt) mesh.rotation.x = tilt;
    gun.add(mesh);
  }

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 12), metal);
  barrel.rotation.x = Math.PI / 2; // cylinders stand upright by default
  barrel.position.set(0, 0.005, -0.47);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.045, 12), metal);
  brake.rotation.x = Math.PI / 2;
  brake.position.set(0, 0.005, -0.55);
  gun.add(barrel, brake);

  // Holo sight: a faintly tinted glass pane with a glowing aiming dot.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, 0.045),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.08, depthWrite: false }),
  );
  glass.position.set(0, 0.078, -0.06);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 16), new THREE.MeshBasicMaterial({ color: 0xffa31a }));
  dot.position.copy(SIGHT_DOT);
  gun.add(glass, dot);
}

// A few crossed glowing planes make a star-shaped flash.
function buildMuzzleFlash() {
  const texture = radialGlowTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xffc070,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flash = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), material);
  flash.add(front);
  for (const angle of [0, Math.PI / 2]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.24), material);
    // Lay the plane along the barrel, then spin it around the barrel: one flat, one upright.
    side.rotation.order = 'ZYX';
    side.rotation.set(Math.PI / 2, 0, angle);
    side.position.z = -0.08;
    flash.add(side);
  }
  flash.visible = false;
  return flash;
}

// A soft white blob that fades to transparent, drawn on a canvas so we need no image file.
function radialGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,220,160,0.8)');
  gradient.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
