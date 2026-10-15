import * as THREE from 'three';
import { CONFIG } from '../config';
import { sunDirection } from './lighting';

// The light that reaches you from every direction except the sun.
// On the Moon the sky is black, so the only "ambient" light is sunlight bouncing
// off the bright ground. We bake that into an environment map: black above the
// horizon, sunlit regolith below. Metal and glass reflect it, and anything facing
// down or sideways picks up a little fill light from it.
export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const envScene = new THREE.Scene();
  const sun = sunDirection();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uGround: { value: CONFIG.lighting.groundBounce },
      uSun: { value: new THREE.Vector3(sun.x, 0, sun.z).normalize() },
      uOpposition: { value: CONFIG.lighting.opposition },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uGround; uniform vec3 uSun; uniform float uOpposition;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        // Below the horizon: lit regolith, a touch warm. Ground on the far side from
        // the sun (seen with the sun behind you) looks brighter.
        float below = smoothstep(0.02, -0.06, d.y);
        float away = max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), -uSun));
        vec3 ground = vec3(1.0, 0.97, 0.92) * uGround * (1.0 + uOpposition * away * away);
        gl_FragColor = vec4(ground * below, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  pmrem.dispose();
  return texture;
}
