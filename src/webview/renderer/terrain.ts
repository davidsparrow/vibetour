import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Fog,
} from 'three';
import type { Palette } from '../../core/packs';
import { fbm, lerp, smoothstep } from './noise';
import {
  canyonFactor,
  FAR_LEVEL,
  isWater,
  ROAD_EDGE,
  SEA_LEVEL,
  terrainHeight,
  VIEW,
  type EnvSchedule,
  type Feature,
  type RoadPath,
} from './world';

/** Camera pose shared by every scenery layer for one frame. */
export interface Pose {
  d: number;
  x: number;
  z: number;
  y: number;
  h: number;
  cos: number;
  sin: number;
}

/** World → camera-relative coordinates (camera at origin looking down −Z). */
export function toLocal(p: Pose, x: number, y: number, z: number, out: Float32Array | number[], o: number): void {
  const dx = x - p.x;
  const dz = z - p.z;
  out[o] = dx * p.cos + dz * p.sin;
  out[o + 1] = y - p.y;
  out[o + 2] = -dx * p.sin + dz * p.cos;
}

export const TSTEP = 12;
/** Signed lateral offsets of terrain columns (metres from centreline). */
export const COLS = [
  -240, -200, -160, -125, -95, -70, -52, -38, -27, -19, -13, -9, -6.5, -4.6, 4.6, 6.5, 9, 13, 19, 27, 38, 52, 70, 95, 125, 160,
  200, 240,
];
const NC = COLS.length;
const ROWS = Math.ceil((VIEW + 48) / TSTEP) + 2;

interface Row {
  pos: Float64Array;
  col: Float32Array;
}

/**
 * Terrain ribbon that follows the road. Rows are computed once per world
 * position and cached, then re-projected into camera space every frame.
 */
export class Terrain {
  readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly rows = new Map<number, Row>();
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private palette!: Palette;
  private colorsCache!: Record<string, Color>;

  constructor(
    private readonly path: RoadPath,
    private readonly schedule: EnvSchedule,
    private readonly features: () => Feature[],
    private seed: number,
  ) {
    this.positions = new Float32Array(ROWS * NC * 3);
    this.colors = new Float32Array(ROWS * NC * 3);
    const geo = new BufferGeometry();
    const posAttr = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    const colAttr = new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('color', colAttr);
    const index: number[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < NC - 1; c++) {
        const a = r * NC + c;
        const b = a + 1;
        const cc = a + NC;
        const dd = cc + 1;
        index.push(a, b, cc, b, dd, cc);
      }
    }
    geo.setIndex(index);
    this.mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.mesh.frustumCulled = false;
  }

  reset(seed: number, palette: Palette): void {
    this.seed = seed;
    this.palette = palette;
    this.colorsCache = {};
    this.rows.clear();
  }

  private color(hex: string): Color {
    return (this.colorsCache[hex] ??= new Color(hex));
  }

  private computeRow(k: number): Row {
    const s = k * TSTEP;
    const c = this.path.sample(s);
    const blend = this.schedule.at(s);
    const feats = this.features();
    const canyon = canyonFactor(feats, s);
    const pos = new Float64Array(NC * 3);
    const col = new Float32Array(NC * 3);
    const cos = Math.cos(c.h);
    const sin = Math.sin(c.h);
    const env = blend.w > 0.5 ? blend.b : blend.a;
    const pal = { ...this.palette, ...env.palette };
    const ground = this.color(pal.ground);
    const far = this.color(pal.groundFar);
    const rock = this.color(pal.rock);
    const snow = this.color(pal.snow);
    const sand = this.color(pal.sand);
    const road = this.color(pal.road);
    const building = this.color(pal.building);
    const tmp = new Color();
    const heights = new Float64Array(NC);

    for (let i = 0; i < NC; i++) {
      const lat = COLS[i];
      const a = Math.abs(lat);
      const sideEnv = lat < 0 ? env.left : env.right;
      let y: number;
      if (a < ROAD_EDGE) y = c.e - 0.45;
      else y = terrainHeight(blend, s, lat, c.e, this.seed);
      if (canyon > 0) {
        const depth = isWater(sideEnv.terrain) ? 1 : 1 - smoothstep(70, 200, a);
        const floor = SEA_LEVEL - 8 + fbm(s / 30, lat / 20) * 5;
        y = lerp(y, Math.min(y, floor), canyon * depth);
      }
      if (i === 0 || i === NC - 1) {
        // Skirt: drop out of sight at the ribbon's outer edge.
        y = isWater(sideEnv.terrain) ? SEA_LEVEL - 25 : Math.min(y, FAR_LEVEL - 1);
      }
      heights[i] = y;
      pos[i * 3] = c.x + cos * lat;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = c.z + sin * lat;
    }

    for (let i = 0; i < NC; i++) {
      const lat = COLS[i];
      const a = Math.abs(lat);
      const y = heights[i];
      const sideEnv = lat < 0 ? env.left : env.right;
      const neighbour = heights[lat < 0 ? Math.min(i + 1, NC - 1) : Math.max(i - 1, 0)];
      const run = Math.max(1, Math.abs(COLS[lat < 0 ? Math.min(i + 1, NC - 1) : Math.max(i - 1, 0)] - lat));
      const slope = Math.abs(y - neighbour) / run;
      const rel = y - c.e;
      const n = fbm(s / 23 + this.seed, lat / 19, 2);
      if (a < 7.5) tmp.copy(road).lerp(far, 0.45);
      else if (sideEnv.terrain === 'city' && a < 90) tmp.copy(building).multiplyScalar(0.5).lerp(road, 0.4);
      else if (sideEnv.terrain === 'dunes') tmp.copy(sand).lerp(ground, 0.35 + 0.4 * n).multiplyScalar(0.8 + Math.min(0.35, Math.max(0, rel) / 60));
      else tmp.copy(ground).lerp(far, smoothstep(15, 180, a) * 0.8);
      if (y < SEA_LEVEL + 2.8) tmp.copy(sand).multiplyScalar(y < SEA_LEVEL - 1 ? 0.6 : 1);
      else if (slope > 0.9) tmp.lerp(rock, smoothstep(0.9, 1.6, slope));
      if (sideEnv.terrain === 'mountains' && sideEnv.height >= 140 && rel > sideEnv.height * 0.62 + n * 25) tmp.copy(snow);
      tmp.multiplyScalar(0.88 + n * 0.24);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    return { pos, col };
  }

  /** Terrain height at (s, lat) consistent with the rendered triangles. */
  heightAt(s: number, lat: number): number {
    const k = Math.floor(s / TSTEP);
    const t = s / TSTEP - k;
    const r0 = this.row(k);
    const r1 = this.row(k + 1);
    let i = 0;
    while (i < NC - 2 && COLS[i + 1] < lat) i++;
    const u = Math.min(1, Math.max(0, (lat - COLS[i]) / (COLS[i + 1] - COLS[i])));
    const h0 = lerp(r0.pos[i * 3 + 1], r0.pos[(i + 1) * 3 + 1], u);
    const h1 = lerp(r1.pos[i * 3 + 1], r1.pos[(i + 1) * 3 + 1], u);
    return lerp(h0, h1, t);
  }

  private row(k: number): Row {
    let row = this.rows.get(k);
    if (!row) {
      row = this.computeRow(k);
      this.rows.set(k, row);
    }
    return row;
  }

  update(pose: Pose): void {
    const k0 = Math.floor((pose.d - 36) / TSTEP);
    for (const key of this.rows.keys()) if (key < k0 - 4) this.rows.delete(key);
    const p = this.positions;
    const col = this.colors;
    for (let r = 0; r < ROWS; r++) {
      const row = this.row(k0 + r);
      for (let i = 0; i < NC; i++) {
        const o = (r * NC + i) * 3;
        toLocal(pose, row.pos[i * 3], row.pos[i * 3 + 1], row.pos[i * 3 + 2], p, o);
        col[o] = row.col[i * 3];
        col[o + 1] = row.col[i * 3 + 1];
        col[o + 2] = row.col[i * 3 + 2];
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Animated sea/lake surface at SEA_LEVEL with sun glint and manual fog. */
export class Water {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    const geo = new PlaneGeometry(12000, 12000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new ShaderMaterial({
      fog: false,
      uniforms: {
        uWater: { value: new Color('#2a6a8c') },
        uSky: { value: new Color() },
        uSun: { value: new Color() },
        uSunDir: { value: new Vector3(0, 0.3, -1) },
        uFog: { value: new Color() },
        uFogNear: { value: 60 },
        uFogFar: { value: 880 },
        uCam: { value: new Vector3() },
        uHeading: { value: 0 },
        uTime: { value: 0 },
        uNight: { value: 0 },
        uAmbient: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vLocal;
        void main() {
          vLocal = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vLocal, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uWater; uniform vec3 uSky; uniform vec3 uSun; uniform vec3 uSunDir; uniform vec3 uFog;
        uniform float uFogNear; uniform float uFogFar; uniform vec3 uCam; uniform float uHeading; uniform float uTime;
        uniform float uNight; uniform float uAmbient;
        varying vec3 vLocal;
        float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
        float waves(vec2 p) {
          return vnoise(p * 0.08 + vec2(uTime * 0.05, uTime * 0.03)) * 0.6 + vnoise(p * 0.21 - vec2(uTime * 0.09, 0.0)) * 0.3 + vnoise(p * 0.6 + uTime * 0.2) * 0.1;
        }
        void main() {
          float c = cos(uHeading), s = sin(uHeading);
          vec2 world = uCam.xz + vec2(vLocal.x * c - vLocal.z * s, vLocal.x * s + vLocal.z * c);
          float e = 0.6;
          float h0 = waves(world);
          vec3 n = normalize(vec3(h0 - waves(world + vec2(e, 0.0)), 0.35, h0 - waves(world + vec2(0.0, e))));
          vec3 view = normalize(-vLocal);
          float fres = pow(1.0 - max(dot(view, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          vec3 col = mix(uWater * (0.12 + 0.88 * uAmbient * uAmbient), uSky, 0.06 + fres * 0.4);
          vec3 r = reflect(-view, n);
          float glint = pow(max(dot(r, normalize(uSunDir)), 0.0), 120.0) * smoothstep(-0.05, 0.1, uSunDir.y);
          col += uSun * glint * (2.0 - uNight);
          float foam = smoothstep(0.78, 0.95, h0) * 0.12 * (1.0 - uNight * 0.7);
          col += vec3(foam);
          // Open water stays visible further out, fading into the horizon haze.
          float dist = length(vLocal);
          float f = smoothstep(uFogNear * 1.5, uFogFar * 2.2, dist);
          col = mix(col, mix(uFog, uSky, 0.5), f);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  update(pose: Pose, opts: { water: Color; sky: Color; sun: Color; sunDir: Vector3; fog: Fog; time: number; night: number; ambient: number }): void {
    this.mesh.position.set(0, SEA_LEVEL - pose.y, 0);
    const u = this.mesh.material.uniforms;
    (u.uWater.value as Color).copy(opts.water);
    (u.uSky.value as Color).copy(opts.sky);
    (u.uSun.value as Color).copy(opts.sun);
    (u.uSunDir.value as Vector3).copy(opts.sunDir);
    (u.uFog.value as Color).copy(opts.fog.color);
    u.uFogNear.value = opts.fog.near;
    u.uFogFar.value = opts.fog.far;
    (u.uCam.value as Vector3).set(pose.x, 0, pose.z);
    u.uHeading.value = pose.h;
    u.uTime.value = opts.time;
    u.uNight.value = opts.night;
    u.uAmbient.value = opts.ambient;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Flat far ground used when no water is in view, hiding the ribbon's edge. */
export class FarGround {
  readonly mesh: Mesh<PlaneGeometry, MeshLambertMaterial>;
  constructor() {
    const geo = new PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, new MeshLambertMaterial({ color: '#777' }));
    this.mesh.frustumCulled = false;
  }
  update(pose: Pose, color: Color, visible: boolean): void {
    this.mesh.visible = visible;
    this.mesh.position.set(0, FAR_LEVEL - 1.5 - pose.y, 0);
    this.mesh.material.color.copy(color);
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
