import * as THREE from 'three';
import { CONFIG } from '../config';

// Small additions to three.js's standard material shader, for looks it can't do on its own.
// Each patch can stack with the others on the same material.

type Shader = THREE.WebGLProgramParametersWithUniforms;

function addPatch(material: THREE.Material, key: string, patch: (shader: Shader) => void) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patch(shader);
  };
  // Materials with different patches need different compiled shaders.
  material.customProgramCacheKey = () => `${previousKey()}|${key}`;
  material.needsUpdate = true;
}

const WORLD_VARYINGS = 'varying vec3 vLgWorldPos;\nvarying vec3 vLgWorldNormal;\n';

// World position and normal for the fragment shader (works with instanced meshes too).
function addWorldVaryings(shader: Shader) {
  if (shader.vertexShader.includes('vLgWorldPos')) return;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`)
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vec4 lgWorld = vec4( transformed, 1.0 );
      vec3 lgNormal = objectNormal;
      #ifdef USE_BATCHING
        lgWorld = batchingMatrix * lgWorld;
        lgNormal = mat3( batchingMatrix ) * lgNormal;
      #endif
      #ifdef USE_INSTANCING
        lgWorld = instanceMatrix * lgWorld;
        lgNormal = mat3( instanceMatrix ) * lgNormal;
      #endif
      vLgWorldPos = ( modelMatrix * lgWorld ).xyz;
      vLgWorldNormal = normalize( mat3( modelMatrix ) * lgNormal );`,
    );
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${WORLD_VARYINGS}`);
}

const DIFFUSE_LINE = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const SPECULAR_LINE = 'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;';

/**
 * Moon dust reflects light differently from ordinary surfaces: shading is flatter
 * (slopes facing away from you don't darken much), and ground seen with the sun
 * directly behind you is noticeably brighter (the "opposition surge").
 * With `bakedShadow`, a per-vertex `sunVis` attribute (0 = in a far shadow) also blocks the sun.
 */
export function patchLunarSurface(material: THREE.Material, bakedShadow = false) {
  addPatch(material, bakedShadow ? 'lunarBaked' : 'lunar', (shader) => {
    shader.uniforms.uLgOpposition = { value: CONFIG.lighting.opposition };
    const sunVis = bakedShadow ? 'vLgSunVis' : '1.0';
    if (bakedShadow) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sunVis;\nvarying float vLgSunVis;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLgSunVis = sunVis;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLgSunVis;');
    }
    const lights = THREE.ShaderChunk.lights_physical_pars_fragment;
    if (!lights.includes(DIFFUSE_LINE) || !lights.includes(SPECULAR_LINE)) {
      console.warn('Lunar shading patch: three.js shader changed; using standard shading.');
      return;
    }
    const lunarLights = lights
      .replace(
        DIFFUSE_LINE,
        `float lgCosI = saturate( dot( geometryNormal, directLight.direction ) );
        float lgCosE = saturate( dot( geometryNormal, geometryViewDir ) );
        // Lunar-Lambert: a blend of Lambert and Lommel-Seeliger scattering.
        float lgLunar = min( 3.0, 0.3 + 1.4 / ( lgCosI + lgCosE + 0.05 ) );
        float lgPhase = acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) );
        float lgSurge = 1.0 + uLgOpposition * exp( - lgPhase / 0.15 );
        reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F ) * lgLunar * lgSurge * ${sunVis};`,
      )
      .replace(SPECULAR_LINE, SPECULAR_LINE.replace(';', ` * ${sunVis};`));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLgOpposition;')
      .replace('#include <lights_physical_pars_fragment>', lunarLights);
  });
}

export interface TriplanarOptions {
  detail?: THREE.Texture; // linear grayscale-ish color detail, 0.5 = no change
  height?: THREE.Texture; // bump height
  metersPerTile: number;
  bumpScale?: number;
  dust?: number; // 0 = clean, 1 = full lunar dust on low and upward-facing surfaces outside the dome
}

/**
 * Textures a material by world position instead of its UVs, so long walls, boxes and
 * tubes all get evenly sized panel seams and grain with no stretching.
 * Optionally dusts the lower parts and top surfaces of things outside the dome.
 */
export function patchTriplanar(material: THREE.Material, options: TriplanarOptions) {
  const key = `tri${options.detail ? 'D' : ''}${options.height ? 'H' : ''}${options.dust ? 'S' : ''}`;
  addPatch(material, key, (shader) => {
    addWorldVaryings(shader);
    shader.uniforms.uLgDetail = { value: options.detail ?? null };
    shader.uniforms.uLgHeight = { value: options.height ?? null };
    shader.uniforms.uLgScale = { value: 1 / options.metersPerTile };
    shader.uniforms.uLgBump = { value: options.bumpScale ?? 1 };
    shader.uniforms.uLgDust = { value: options.dust ?? 0 };
    shader.uniforms.uLgDomeRadius = { value: CONFIG.city.domeRadius };

    // Goes right after the world varyings, since these helpers read them.
    shader.fragmentShader = shader.fragmentShader.replace(
      WORLD_VARYINGS,
      `${WORLD_VARYINGS}
      uniform sampler2D uLgDetail; uniform sampler2D uLgHeight;
      uniform float uLgScale; uniform float uLgBump; uniform float uLgDust; uniform float uLgDomeRadius;
      vec3 lgWeights() { vec3 w = pow( abs( vLgWorldNormal ), vec3( 4.0 ) ); return w / ( w.x + w.y + w.z ); }
      vec4 lgTri( sampler2D t, vec3 p, vec3 w ) {
        return texture2D( t, p.zy ) * w.x + texture2D( t, p.xz ) * w.y + texture2D( t, p.xy ) * w.z;
      }
      vec3 lgPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
        vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
        vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
        vec3 R1 = cross( vSigmaY, surf_norm );
        vec3 R2 = cross( surf_norm, vSigmaX );
        float fDet = dot( vSigmaX, R1 ) * faceDir;
        vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
        return normalize( abs( fDet ) * surf_norm - vGrad );
      }`,
    );

    let colorCode = '';
    if (options.detail) {
      colorCode += 'diffuseColor.rgb *= lgTri( uLgDetail, vLgWorldPos * uLgScale, lgWeights() ).rgb * 2.0;\n';
    }
    if (options.dust) {
      colorCode += `
      float lgOutside = step( uLgDomeRadius, length( vLgWorldPos.xz ) );
      float lgDust = ( 1.0 - smoothstep( 0.0, 1.8, vLgWorldPos.y ) ) * mix( 0.12, 0.6, lgOutside );
      lgDust = max( lgDust, smoothstep( 0.55, 0.95, vLgWorldNormal.y ) * 0.3 * lgOutside );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.26, 0.25, 0.235 ), lgDust * uLgDust );\n`;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>\n${colorCode}`);

    if (options.height) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        float lgH = lgTri( uLgHeight, vLgWorldPos * uLgScale, lgWeights() ).x;
        normal = lgPerturb( - vViewPosition, normal, vec2( dFdx( lgH ), dFdy( lgH ) ) * uLgBump, faceDirection );`,
      );
    }
  });
}

/**
 * Glass that behaves like glass: nearly invisible looking straight through it,
 * increasingly mirror-like at shallow angles (the Fresnel effect).
 * Give the material a black color so it shows only reflections.
 */
export function patchFresnelGlass(material: THREE.Material, minOpacity = 0.04, maxOpacity = 0.75) {
  addPatch(material, 'fresnelGlass', (shader) => {
    shader.uniforms.uLgMin = { value: minOpacity };
    shader.uniforms.uLgMax = { value: maxOpacity };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLgMin; uniform float uLgMax;')
      .replace(
        '#include <opaque_fragment>',
        `float lgFresnel = pow( 1.0 - saturate( abs( dot( normal, geometryViewDir ) ) ), 5.0 );
        gl_FragColor = vec4( outgoingLight, mix( uLgMin, uLgMax, lgFresnel ) );`,
      );
  });
}
