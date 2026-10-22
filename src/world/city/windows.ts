import * as THREE from 'three';
import { CONFIG } from '../../config';
import { addPatch } from '../../core/materialPatches';

// Windows you can see into. Each pane is a single flat rectangle, but the shader traces
// the view ray into a box-shaped room behind it ("interior mapping") and draws its walls,
// floor and ceiling, so every window has depth and parallax as you walk past. Rooms are
// lit or dark at random, some warm, some amber, some with the blinds half down. The glass
// itself is ordinary shiny glass, so it also reflects the bright ground and the sun.

export type RoomStyle = 'office' | 'home' | 'shop';
const STYLE_CODE: Record<RoomStyle, number> = { office: 0, home: 1, shop: 2 };

export interface WindowPane {
  center: THREE.Vector3;
  right: THREE.Vector3; // along the glass, left to right as seen from outside
  normal: THREE.Vector3; // out of the building
  width: number;
  height: number;
  /** Panes with the same seed show the same room lighting (one wide room behind several windows). */
  seed: number;
  style?: RoomStyle;
  depth?: number; // meters from the glass to the room's back wall
}

/** Collects window panes and draws them all as one mesh. */
export class WindowBatch {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private tangents: number[] = [];
  private rooms: number[] = [];
  private styles: number[] = [];

  add(pane: WindowPane) {
    const up = new THREE.Vector3().crossVectors(pane.normal, pane.right).normalize();
    const hw = pane.width / 2;
    const hh = pane.height / 2;
    const corner = (sx: number, sy: number) =>
      pane.center.clone().addScaledVector(pane.right, sx * hw).addScaledVector(up, sy * hh);
    const a = corner(-1, -1);
    const b = corner(1, -1);
    const c = corner(1, 1);
    const d = corner(-1, 1);
    const style = STYLE_CODE[pane.style ?? 'office'];
    const depth = pane.depth ?? (style === 2 ? 6 : 4.5);
    for (const [p, u, v] of [
      [a, 0, 0],
      [b, 1, 0],
      [c, 1, 1],
      [a, 0, 0],
      [c, 1, 1],
      [d, 0, 1],
    ] as [THREE.Vector3, number, number][]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(pane.normal.x, pane.normal.y, pane.normal.z);
      this.uvs.push(u, v);
      this.tangents.push(pane.right.x, pane.right.y, pane.right.z);
      this.rooms.push(pane.width, pane.height, depth, pane.seed);
      this.styles.push(style);
    }
  }

  get count() {
    return this.positions.length / 18;
  }

  build(parent: THREE.Object3D) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('aTangent', new THREE.Float32BufferAttribute(this.tangents, 3));
    geometry.setAttribute('aRoom', new THREE.Float32BufferAttribute(this.rooms, 4));
    geometry.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.styles, 1));
    const mesh = new THREE.Mesh(geometry, windowMaterial());
    mesh.receiveShadow = true;
    mesh.userData.merged = true; // already one mesh (and its extra attributes must survive)
    parent.add(mesh);
    return mesh;
  }
}

let shared: THREE.MeshStandardMaterial | null = null;

/** The glass: dark and glossy, with the room behind it added as light coming through. */
export function windowMaterial() {
  if (shared) return shared;
  const material = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, metalness: 0 });
  addPatch(material, 'interiorWindows', (shader) => {
    shader.uniforms.uLgLitShare = { value: CONFIG.city.litWindows };
    shader.uniforms.uLgRoomLight = { value: CONFIG.city.roomBrightness };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aTangent;
        attribute vec4 aRoom;
        attribute float aStyle;
        varying vec3 vLgRay;
        varying vec2 vLgWin;
        varying vec4 vLgRoom;
        varying float vLgStyle;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        // The view ray in the window's own space: x to the right, y up, z into the room.
        vec3 lgN = normalize( normalMatrix * objectNormal );
        vec3 lgT = normalize( ( modelViewMatrix * vec4( aTangent, 0.0 ) ).xyz );
        vec3 lgB = cross( lgN, lgT );
        vLgRay = vec3( dot( mvPosition.xyz, lgT ), dot( mvPosition.xyz, lgB ), -dot( mvPosition.xyz, lgN ) );
        vLgWin = uv * aRoom.xy;
        vLgRoom = aRoom;
        vLgStyle = aStyle;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uLgLitShare;
        uniform float uLgRoomLight;
        varying vec3 vLgRay;
        varying vec2 vLgWin;
        varying vec4 vLgRoom;
        varying float vLgStyle;
        float lgHash( float n ) { return fract( sin( n * 12.9898 + 4.1414 ) * 43758.5453 ); }
        ${ROOM_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float lgFacing = saturate( dot( normal, normalize( vViewPosition ) ) );
        float lgFresnel = 0.04 + 0.96 * pow( 1.0 - lgFacing, 5.0 );
        totalEmissiveRadiance += lgRoom( vLgRay, vLgWin, vLgRoom, vLgStyle ) * uLgRoomLight * ( 1.0 - lgFresnel );`,
      );
  });
  shared = material;
  return material;
}

// The room behind one window. Returns the light coming out of it.
const ROOM_GLSL = /* glsl */ `
vec3 lgRoom( vec3 ray, vec2 win, vec4 room, float style ) {
  float w = room.x;
  float h = room.y;
  float seed = room.w;
  // The room is a little wider than the window, with the floor below the sill.
  float sill = style > 1.5 ? 0.35 : 0.85;
  vec3 lo = vec3( -0.35, -sill, 0.0 );
  vec3 hi = vec3( w + 0.35, h + 0.45, room.z );
  vec3 dir = normalize( ray );
  dir.z = max( dir.z, 1e-3 );
  vec3 o = vec3( win, 0.0 );
  vec3 toWall = ( mix( lo, hi, step( 0.0, dir ) ) - o ) / dir;
  float t = min( min( toWall.x, toWall.y ), toWall.z );
  vec3 p = o + dir * t;
  vec3 q = ( p - lo ) / ( hi - lo ); // 0 to 1 across the room

  // This room's light: on or off, and what color.
  float lit = step( lgHash( seed * 1.37 ), style > 1.5 ? 0.92 : uLgLitShare );
  float pick = lgHash( seed * 2.71 );
  vec3 tint = pick < 0.12 ? vec3( 1.0, 0.58, 0.2 ) : mix( vec3( 1.0, 0.8, 0.58 ), vec3( 1.0, 0.93, 0.84 ), lgHash( seed * 3.3 ) );
  float power = mix( 0.7, 1.15, lgHash( seed * 4.9 ) );
  // Wall and floor finishes: offices in light grays, homes in warmer colors, shops in white.
  float finish = lgHash( seed * 5.3 );
  vec3 wall = style < 0.5 ? mix( vec3( 0.5, 0.49, 0.47 ), vec3( 0.6, 0.57, 0.52 ), finish )
    : style < 1.5 ? ( finish < 0.25 ? vec3( 0.58, 0.49, 0.38 ) : finish < 0.5 ? vec3( 0.44, 0.47, 0.38 ) : finish < 0.75 ? vec3( 0.6, 0.55, 0.48 ) : vec3( 0.5, 0.36, 0.26 ) )
    : vec3( 0.5, 0.47, 0.42 );
  vec3 floorColor = style < 0.5 ? vec3( 0.2, 0.2, 0.2 ) : style < 1.5 ? mix( vec3( 0.32, 0.21, 0.12 ), vec3( 0.42, 0.3, 0.19 ), lgHash( seed * 5.9 ) ) : vec3( 0.42, 0.4, 0.37 );

  vec3 albedo;
  float light; // how lit this spot is by the ceiling lamp
  float glow = 0.0; // the lamp itself
  if ( t == toWall.z ) {
    // Back wall: furniture along the bottom, and now and then a lit screen or a doorway.
    albedo = wall;
    light = mix( 0.45, 0.9, q.y );
    float desk = step( 0.12, q.y ) * step( q.y, 0.36 ) * step( 0.18 + 0.3 * lgHash( seed * 6.1 ), q.x ) * step( q.x, 0.7 + 0.25 * lgHash( seed * 6.7 ) );
    albedo = mix( albedo, style > 0.5 && style < 1.5 ? vec3( 0.3, 0.2, 0.13 ) : vec3( 0.14, 0.13, 0.12 ), desk );
    // Shops: shelves of goods across the back.
    if ( style > 1.5 ) {
      float row = floor( q.y * 6.0 );
      float slot = floor( q.x * 9.0 + row * 3.1 );
      float goods = step( 0.12, q.y ) * step( q.y, 0.8 ) * step( 0.25, fract( q.y * 6.0 ) );
      vec3 product = mix( vec3( 0.75, 0.32, 0.12 ), vec3( 0.32, 0.5, 0.26 ), lgHash( slot + seed ) );
      product = mix( product, vec3( 0.85, 0.78, 0.62 ), step( 0.6, lgHash( slot * 1.7 + seed ) ) );
      albedo = mix( albedo, product, goods );
    }
    float door = step( 0.75, lgHash( seed * 7.7 ) ) * step( 0.8, q.x ) * step( q.x, 0.95 ) * step( q.y, 0.78 );
    albedo = mix( albedo, vec3( 0.32, 0.3, 0.28 ), door );
    float screen = step( 0.6, lgHash( seed * 8.3 ) ) * step( 0.38, q.y ) * step( q.y, 0.56 ) * step( 0.3, q.x ) * step( q.x, 0.48 );
    glow += screen * 1.6;
  } else if ( t == toWall.y ) {
    if ( dir.y > 0.0 ) {
      // Ceiling, with a long light panel down the middle.
      albedo = wall * 1.05;
      light = 0.75;
      float panel = step( abs( q.x - 0.5 ), 0.32 ) * step( abs( q.z - 0.45 ), 0.08 );
      glow += panel * 4.0;
    } else {
      // Floor: darker, with a pool of light under the lamp.
      albedo = floorColor;
      float pool = 1.0 - smoothstep( 0.0, 0.55, length( vec2( q.x - 0.5, q.z - 0.45 ) ) );
      light = 0.35 + 0.5 * pool;
    }
  } else {
    // Side walls: a little darker than the back, brightest up by the ceiling.
    albedo = wall * 0.9;
    light = mix( 0.35, 0.8, q.y );
    float shelf = step( 0.55, lgHash( seed * 9.1 + step( 0.0, dir.x ) ) ) * step( 0.2, q.z ) * step( q.z, 0.7 ) * step( 0.1, q.y ) * step( q.y, 0.62 );
    albedo = mix( albedo, vec3( 0.22, 0.2, 0.18 ), shelf * 0.8 );
  }
  // Deeper in is darker, and corners get a little shade.
  float shade = 1.0 - 0.4 * q.z;
  vec3 color = albedo * light * shade * tint * power * lit + glow * tint * lit;
  // Dark rooms: just a faint glow from outside.
  color += albedo * 0.02 * ( 1.0 - lit );

  // How big a pixel is on the glass, in meters: fine lines fade to their average far away
  // instead of shimmering.
  float px = max( fwidth( win.x ), fwidth( win.y ) );
  // Blinds, part way down some windows.
  float blinds = step( lgHash( seed * 10.7 ), 0.35 ) * mix( 0.15, 0.75, lgHash( seed * 11.3 ) );
  if ( style < 1.5 && win.y > h * ( 1.0 - blinds ) ) {
    float slat = mix( 0.75 + 0.25 * step( 0.5, fract( win.y * 14.0 ) ), 0.875, smoothstep( 0.02, 0.06, px ) );
    color = vec3( 0.86, 0.8, 0.7 ) * slat * ( 0.04 + 0.5 * lit * power ) * tint;
  }
  // The frame around the glass, and a mullion down the middle of wide panes.
  float edge = min( min( win.x, w - win.x ), min( win.y, h - win.y ) );
  float mullion = w > 2.6 ? abs( win.x - w * 0.5 ) : 1.0;
  float transom = style > 1.5 ? abs( win.y - h * 0.78 ) : 1.0;
  float near = min( edge, min( mullion, transom ) );
  float frame = 1.0 - smoothstep( 0.045 - px * 0.5, 0.045 + px * 0.5, near );
  frame = mix( frame, 0.12, smoothstep( 0.04, 0.12, px ) );
  return mix( color, vec3( 0.012 ), frame );
}
`;
