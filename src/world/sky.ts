import * as THREE from 'three';
import { CONFIG } from '../config';
import { directionFromAngles, sunDirection } from './lighting';
import { fbm3D, seededRandom } from './noise';

// The black lunar sky: stars (with the Milky Way), the sun's disc and a big Earth.
// It all moves with the camera, so it always looks infinitely far away.
export class Sky {
  readonly group = new THREE.Group();
  private earth: THREE.Group;
  private clouds: THREE.ShaderMaterial;
  private time = 0;

  constructor(scene: THREE.Scene) {
    const earth = buildEarth();
    this.earth = earth.group;
    this.clouds = earth.material;
    this.group.add(buildStars(), buildSunDisc(), this.earth);
    scene.add(this.group);
  }

  update(camera: THREE.Camera, dt = 0) {
    this.group.position.copy(camera.position);
    // The Earth turns once a day; the clouds drift a little on top.
    this.time += dt;
    this.earth.rotation.y = 1.2 + this.time * 0.0005;
    this.clouds.uniforms.uTime.value = this.time;
  }
}

function buildStars() {
  const { starCount } = CONFIG.sky;
  const random = seededRandom(3);
  const radius = 1800;
  const milkyWay = 7000; // extra faint stars crowded along a band across the sky
  const total = starCount + milkyWay;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  // The galaxy's plane, tilted across the sky.
  const bandNormal = new THREE.Vector3(0.35, 0.6, -0.72).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < total; i++) {
    if (i < starCount) {
      // Evenly over the sphere.
      const y = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - y * y);
      v.set(Math.cos(angle) * ring, y, Math.sin(angle) * ring);
    } else {
      // Near the band: a random direction pulled toward the galactic plane.
      v.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      const off = v.dot(bandNormal);
      // Keep only part of the distance from the plane, so stars crowd into a soft band.
      v.addScaledVector(bandNormal, -off * (0.72 + random() * 0.24)).normalize();
    }
    positions.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    // Brightness: most stars faint (the eye is adjusted for sunlit ground), a few bright.
    const faint = i >= starCount;
    const brightness = faint ? 0.05 + random() * 0.12 : 0.12 + Math.pow(random(), 5) * 0.9;
    // Star colors range from warm orange to white.
    const warmth = random() < 0.3 ? random() * 0.3 : random() * 0.06;
    colors.set([brightness, brightness * (1 - warmth * 0.35), brightness * (1 - warmth)], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true, depthWrite: false }),
  );
  stars.frustumCulled = false;
  return stars;
}

// The sun itself: a small white-hot disc with a tight glow (no air, so no big haze).
// Its color is far brighter than white, so the bloom filter makes it glare.
function buildSunDisc() {
  const texture = glowTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.16, 'rgba(255,253,246,1)'],
    [0.2, 'rgba(255,240,215,0.25)'],
    [1, 'rgba(255,220,170,0)'],
  ]);
  const material = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending, depthWrite: false });
  material.color.setScalar(12);
  const sun = new THREE.Sprite(material);
  sun.position.copy(sunDirection()).multiplyScalar(1700);
  sun.scale.setScalar(150);
  return sun;
}

function buildEarth() {
  const { earthDistance, earthAngularSize, earthElevation, earthBearing } = CONFIG.sky;
  const radius = earthDistance * Math.tan(THREE.MathUtils.degToRad(earthAngularSize / 2));
  const group = new THREE.Group();
  group.position.copy(directionFromAngles(earthElevation, earthBearing)).multiplyScalar(earthDistance);

  const { day, clouds, night } = earthTextures();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: day },
      uClouds: { value: clouds },
      uNight: { value: night },
      uSun: { value: sunDirection() },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform sampler2D uDay; uniform sampler2D uClouds; uniform sampler2D uNight;
      uniform vec3 uSun; uniform float uTime;
      varying vec3 vNormal; varying vec3 vView; varying vec2 vUv;
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float light = dot(n, uSun);
        float lit = max(light, 0.0);
        float dayside = smoothstep(-0.1, 0.2, light);

        vec4 ground = texture2D(uDay, vUv);
        float ocean = ground.a;
        float cloud = texture2D(uClouds, vUv + vec2(uTime * 0.00002, 0.0)).r;

        // Sunlit surface, a glint of sun off the oceans, and clouds on top.
        vec3 color = ground.rgb * lit * 1.4;
        vec3 h = normalize(uSun + v);
        color += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 80.0) * ocean * lit * 1.5;
        // Kept just under the bloom threshold: no air between us, so no glowing haze around it.
        vec3 cloudColor = vec3(1.0) * (0.02 + lit * 0.95);
        color = mix(color, cloudColor, cloud);

        // City lights on the night side, dimmed where clouds cover them.
        color += texture2D(uNight, vUv).rgb * (1.0 - dayside) * (1.0 - cloud * 0.8) * 1.5;

        // Air scattering: a pale haze toward the edge of the lit side.
        float edge = pow(1.0 - max(dot(n, v), 0.0), 2.5);
        color += vec3(0.45, 0.62, 1.0) * edge * smoothstep(-0.2, 0.4, light) * 0.5;
        gl_FragColor = vec4(color, 1.0);
      }`,
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 48), material);

  // A thin glowing rim just outside the edge: the atmosphere seen edge-on.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.04, 64, 32),
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
          float rim = pow(1.0 - abs(dot(vNormal, vView)), 4.0);
          float lit = clamp(dot(-vNormal, uSun) * 0.8 + 0.3, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.5, 0.7, 1.0) * rim * lit * 0.7, rim * lit);
        }`,
    }),
  );
  group.rotation.set(0.41, 1.2, 0.1); // axial tilt
  group.add(globe, atmosphere);
  return { group, material };
}

// Continents, oceans, ice caps, clouds and night-side city lights, made from 3D noise
// wrapped around the sphere (so there's no seam). The Earth keeps its real colors:
// blue oceans are part of the view from the Moon.
function earthTextures() {
  const width = 1024;
  const height = 512;
  const day = new Uint8Array(width * height * 4);
  const clouds = new Uint8Array(width * height * 4);
  const night = new Uint8Array(width * height * 4);
  const random = seededRandom(19);

  for (let y = 0; y < height; y++) {
    const lat = (0.5 - y / height) * Math.PI;
    const cosLat = Math.cos(lat);
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const px = cosLat * Math.cos(lon);
      const py = Math.sin(lat);
      const pz = cosLat * Math.sin(lon);

      // Bent ("domain warped") noise makes coastlines look natural instead of blobby.
      const wx = fbm3D(px * 1.5 + 3, py * 1.5, pz * 1.5, 41, 2) - 0.5;
      const wz = fbm3D(px * 1.5, py * 1.5 + 7, pz * 1.5, 43, 2) - 0.5;
      const land = fbm3D(px * 1.8 + wx * 1.4, py * 1.8, pz * 1.8 + wz * 1.4, 5, 5);
      const isLand = land > 0.54;
      const polar = Math.abs(py);
      const ice = polar > 0.9 || (polar > 0.8 && isLand);

      let rgb: number[];
      let ocean = 0;
      if (ice) rgb = [232, 236, 240];
      else if (isLand) {
        // Deserts near the subtropics, forests and grassland elsewhere, rocky highlands.
        const dryness = fbm3D(px * 4, py * 4, pz * 4, 8, 3) + (1 - Math.abs(Math.abs(py) - 0.42) * 3) * 0.25;
        const high = (land - 0.54) * 6;
        if (dryness > 0.62) rgb = [190, 160, 112];
        else if (dryness > 0.5) rgb = [140, 132, 90];
        else rgb = [62 + high * 30, 86 + high * 20, 52 + high * 15];
      } else {
        const depth = Math.min(1, (0.54 - land) * 5);
        rgb = [12 + (1 - depth) * 20, 34 + (1 - depth) * 40, 74 + (1 - depth) * 40]; // shallow water is lighter
        ocean = 255;
      }
      const i = (y * width + x) * 4;
      day.set([rgb[0], rgb[1], rgb[2], ocean], i);

      // Clouds: swirling bands, thicker over the oceans and in storm belts.
      const swirl = fbm3D(px * 2 + 30, py * 5 + 30, pz * 2 + 30, 13, 2) - 0.5;
      const c = fbm3D(px * 3 + swirl * 2, py * 6, pz * 3 - swirl * 2, 17, 5);
      const cloud = THREE.MathUtils.clamp((c - 0.52) * 3.2, 0, 1);
      clouds.set([cloud * 255, cloud * 255, cloud * 255, 255], i);

      // City lights: clusters on land, away from the ice.
      const cluster = isLand && !ice && fbm3D(px * 14, py * 14, pz * 14, 23, 2) > 0.62 && random() > 0.55;
      const glow = cluster ? 120 + random() * 135 : 0;
      night.set([glow, glow * 0.7, glow * 0.35, 255], i);
    }
  }

  const make = (data: Uint8Array, srgb: boolean) => {
    const texture = new THREE.DataTexture(data, width, height);
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { day: make(day, true), clouds: make(clouds, false), night: make(night, true) };
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
