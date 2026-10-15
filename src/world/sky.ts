import * as THREE from 'three';
import { CONFIG } from '../config';
import { directionFromAngles, sunDirection } from './lighting';
import { fbm3D, seededRandom } from './noise';

// The black lunar sky: stars, the sun's disc and a big Earth.
// It all moves with the camera, so it always looks infinitely far away.
export class Sky {
  private group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.group.add(buildStars(), buildSunDisc(), buildEarth());
    scene.add(this.group);
  }

  update(camera: THREE.Camera) {
    this.group.position.copy(camera.position);
  }
}

function buildStars() {
  const { starCount } = CONFIG.sky;
  const random = seededRandom(3);
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  const radius = 1800;
  for (let i = 0; i < starCount; i++) {
    // An even spread over a sphere.
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - y * y);
    positions.set([Math.cos(angle) * ring * radius, y * radius, Math.sin(angle) * ring * radius], i * 3);
    // Mostly dim stars, a few bright ones. White to faintly warm.
    const brightness = 0.25 + Math.pow(random(), 4) * 0.75;
    const warmth = random() * 0.12;
    colors.set([brightness, brightness * (1 - warmth * 0.4), brightness * (1 - warmth)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }),
  );
  stars.frustumCulled = false;
  return stars;
}

// The sun itself: a small white-hot disc with a tight glow (no air, so no big haze).
function buildSunDisc() {
  const texture = glowTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.18, 'rgba(255,252,240,1)'],
    [0.24, 'rgba(255,240,210,0.35)'],
    [1, 'rgba(255,220,170,0)'],
  ]);
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sun.position.copy(sunDirection()).multiplyScalar(1700);
  sun.scale.setScalar(160);
  return sun;
}

function buildEarth() {
  const { earthDistance, earthAngularSize, earthElevation, earthBearing } = CONFIG.sky;
  const radius = earthDistance * Math.tan(THREE.MathUtils.degToRad(earthAngularSize / 2));
  const earth = new THREE.Group();
  earth.position.copy(directionFromAngles(earthElevation, earthBearing)).multiplyScalar(earthDistance);

  const { surface, clouds } = earthTextures();
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    // Emissive keeps the dark side faintly visible (city lights and earthshine).
    new THREE.MeshStandardMaterial({ map: surface, roughness: 0.8, emissive: 0x1a1612, emissiveIntensity: 0.4 }),
  );
  const cloudLayer = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.01, 64, 32),
    new THREE.MeshStandardMaterial({ map: clouds, transparent: true, depthWrite: false, roughness: 1 }),
  );
  // A thin glowing rim: the Earth's atmosphere seen edge-on.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.05, 64, 32),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { uSun: { value: sunDirection() } },
      vertexShader: `
        varying vec3 vNormal; varying vec3 vView;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `
        uniform vec3 uSun; varying vec3 vNormal; varying vec3 vView;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
          float lit = clamp(dot(-vNormal, uSun) * 0.8 + 0.3, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.55, 0.72, 1.0) * rim * lit, rim * lit);
        }`,
    }),
  );
  // Tilt it so the poles aren't straight up and down.
  earth.rotation.set(0.4, 1.2, 0.2);
  earth.add(globe, cloudLayer, atmosphere);
  return earth;
}

// Continents, oceans, ice caps and clouds, made from 3D noise wrapped around the sphere.
// The Earth keeps its real colors: blue oceans are part of the view from the Moon.
function earthTextures() {
  const width = 512;
  const height = 256;
  const surface = document.createElement('canvas');
  const clouds = document.createElement('canvas');
  surface.width = clouds.width = width;
  surface.height = clouds.height = height;
  const surfaceCtx = surface.getContext('2d')!;
  const cloudCtx = clouds.getContext('2d')!;
  const surfacePixels = surfaceCtx.createImageData(width, height);
  const cloudPixels = cloudCtx.createImageData(width, height);

  for (let y = 0; y < height; y++) {
    const lat = (y / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      // The point on a unit sphere for this pixel.
      const px = Math.cos(lat) * Math.cos(lon);
      const py = Math.sin(lat);
      const pz = Math.cos(lat) * Math.sin(lon);

      const land = fbm3D(px * 2 + 10, py * 2 + 10, pz * 2 + 10, 5, 5);
      const ice = Math.abs(py) > 0.88 || (Math.abs(py) > 0.78 && land > 0.5);
      let rgb: number[];
      if (ice) rgb = [235, 238, 240];
      else if (land > 0.53) {
        // Land: deserts to darker green-brown.
        const dry = fbm3D(px * 4, py * 4, pz * 4, 8, 3);
        rgb = dry > 0.5 ? [176, 150, 108] : [86, 104, 62];
      } else {
        const depth = (0.53 - land) * 3;
        rgb = [18, 46 - depth * 10, 92 - depth * 20]; // deep ocean
      }
      const i = (y * width + x) * 4;
      surfacePixels.data.set([rgb[0], rgb[1], rgb[2], 255], i);

      const cloud = fbm3D(px * 3 + 40, py * 6 + 40, pz * 3 + 40, 13, 5);
      const alpha = THREE.MathUtils.clamp((cloud - 0.5) * 4, 0, 1) * 235;
      cloudPixels.data.set([255, 255, 255, alpha], i);
    }
  }
  surfaceCtx.putImageData(surfacePixels, 0, 0);
  cloudCtx.putImageData(cloudPixels, 0, 0);

  const surfaceTexture = new THREE.CanvasTexture(surface);
  surfaceTexture.colorSpace = THREE.SRGBColorSpace;
  return { surface: surfaceTexture, clouds: new THREE.CanvasTexture(clouds) };
}

function glowTexture(stops: [number, string][]) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [stop, color] of stops) gradient.addColorStop(stop, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
