import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Float32BufferAttribute,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROP_KINDS, type Palette, type PropKind } from '../../core/packs';
import { hash3 } from './noise';
import { toLocal, type Pose } from './terrain';
import { canyonFactor, inSpan, ROAD_EDGE, SEA_LEVEL, VIEW, type EnvSchedule, type Feature, type RoadPath } from './world';
import type { Glows } from './glows';

export type Part = [BufferGeometry, string];

export function paint(geo: BufferGeometry, hex: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

export function merge(parts: Part[]): BufferGeometry {
  return mergeGeometries(parts.map(([g, c]) => paint(g, c)), false)!;
}

export function jitter(geo: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = hash3(Math.round(p.getX(i) * 100), Math.round(p.getY(i) * 100), Math.round(p.getZ(i) * 100) + seed);
    const f = 1 + (k - 0.5) * amount;
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * (1 + (k - 0.5) * amount * 0.6), p.getZ(i) * f);
  }
  return geo;
}

const TRUNK = '#5b4636';

/** Unit-scale procedural geometry for each prop kind, coloured from the pack palette. */
export function buildPropGeometry(kind: PropKind, pal: Palette): BufferGeometry {
  switch (kind) {
    case 'pine':
      return merge([
        [new CylinderGeometry(0.22, 0.32, 3, 5).translate(0, 1.5, 0), TRUNK],
        [new ConeGeometry(2.6, 4.2, 7).translate(0, 4.2, 0), pal.foliageDark],
        [new ConeGeometry(2.1, 3.6, 7).translate(0, 6.3, 0), pal.foliageDark],
        [new ConeGeometry(1.4, 3.2, 7).translate(0, 8.4, 0), pal.foliage],
      ]);
    case 'cypress':
      return merge([
        [new CylinderGeometry(0.18, 0.25, 1.2, 5).translate(0, 0.6, 0), TRUNK],
        [new SphereGeometry(1.15, 7, 9).scale(1, 5.4, 1).translate(0, 6.4, 0), pal.foliageDark],
      ]);
    case 'windswept':
      return merge([
        [new CylinderGeometry(0.25, 0.4, 3.8, 5).rotateZ(0.25).translate(0.45, 1.8, 0), TRUNK],
        [jitter(new IcosahedronGeometry(3.2, 1), 0.25, 1).scale(1.5, 0.42, 1.1).translate(1.6, 4.3, 0), pal.foliageDark],
        [jitter(new IcosahedronGeometry(2.2, 1), 0.25, 2).scale(1.4, 0.45, 1.1).translate(-1.2, 3.7, 0.6), pal.foliage],
      ]);
    case 'broadleaf':
      return merge([
        [new CylinderGeometry(0.25, 0.38, 3.2, 5).translate(0, 1.6, 0), TRUNK],
        [jitter(new IcosahedronGeometry(2.6, 1), 0.3, 3).translate(0, 4.6, 0), pal.foliage],
        [jitter(new IcosahedronGeometry(1.8, 1), 0.3, 4).translate(1.3, 5.6, 0.5), pal.foliageDark],
      ]);
    case 'palm': {
      const parts: Part[] = [[new CylinderGeometry(0.18, 0.3, 9, 6).rotateZ(0.08).translate(0.35, 4.5, 0), '#7a6150']];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push([
          new BoxGeometry(3.4, 0.08, 0.7).translate(1.7, 0, 0).rotateZ(-0.45).rotateY(a).translate(0.7, 9, 0),
          pal.foliage,
        ]);
      }
      return merge(parts);
    }
    case 'rock':
      return merge([[jitter(new IcosahedronGeometry(1.4, 0), 0.6, 5).scale(1.2, 0.8, 1).translate(0, 0.5, 0), pal.rock]]);
    case 'bush':
      return merge([[jitter(new IcosahedronGeometry(1.1, 0), 0.4, 6).scale(1.3, 0.7, 1.2).translate(0, 0.45, 0), pal.foliageDark]]);
    case 'building': {
      const g = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      g.deleteAttribute('uv');
      const n = g.attributes.position.count;
      g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      return g;
    }
    case 'neon': {
      const g = new BoxGeometry(1.1, 4.5, 0.25).translate(0, 2.25, 0);
      g.deleteAttribute('uv');
      return g;
    }
    case 'streetlight':
      return merge([
        [new CylinderGeometry(0.1, 0.14, 8, 5).translate(0, 4, 0), '#5d6066'],
        [new BoxGeometry(2.2, 0.12, 0.14).translate(-1.05, 7.95, 0), '#5d6066'],
        [new BoxGeometry(0.7, 0.18, 0.35).translate(-2.0, 7.85, 0), '#f6e7c2'],
      ]);
    case 'vineyard': {
      const parts: Part[] = [];
      for (let i = 0; i < 6; i++) {
        parts.push([new BoxGeometry(12, 1.3, 0.7).translate(0, 0.65, i * 2.6 - 6.5), i % 2 ? pal.foliage : pal.foliageDark]);
      }
      return merge(parts);
    }
    case 'farmhouse':
      return merge([
        [new BoxGeometry(12, 6.5, 9).translate(0, 3.25, 0), pal.building],
        [new CylinderGeometry(0.01, 7.6, 2.6, 4, 1).rotateY(Math.PI / 4).scale(1.15, 1, 0.86).translate(0, 7.8, 0), '#a8553a'],
        [new BoxGeometry(4.2, 11, 4.2).translate(4.5, 5.5, 2), pal.building],
        [new CylinderGeometry(0.01, 3.3, 1.6, 4, 1).rotateY(Math.PI / 4).translate(4.5, 11.8, 2), '#a8553a'],
      ]);
    case 'chalet':
      return merge([
        [new BoxGeometry(9, 4, 7).translate(0, 2, 0), '#f1ece2'],
        [new BoxGeometry(9.2, 3, 7.2).translate(0, 5.5, 0), '#7a4f31'],
        [new CylinderGeometry(0.01, 7.4, 3.8, 4, 1).rotateY(Math.PI / 4).scale(1.0, 1, 0.82).translate(0, 8.9, 0), '#4a3a32'],
      ]);
    case 'stonewall':
      return merge([[jitter(new BoxGeometry(10, 1.05, 0.7, 6, 1, 1), 0.08, 7).translate(0, 0.5, 0), '#8f8a80']]);
    case 'sheep':
      return merge([
        [jitter(new BoxGeometry(1.2, 0.75, 0.7, 2, 2, 2), 0.2, 8).translate(0, 0.85, 0), '#f1efe8'],
        [new BoxGeometry(0.35, 0.4, 0.32).translate(0.72, 1.05, 0), '#2a2522'],
        [new BoxGeometry(0.9, 0.45, 0.5).translate(0, 0.25, 0), '#3a332e'],
      ]);
    case 'pole':
      return merge([
        [new CylinderGeometry(0.13, 0.16, 9, 5).translate(0, 4.5, 0), '#6b5444'],
        [new BoxGeometry(0.14, 0.14, 2.4).translate(0, 8.3, 0), '#6b5444'],
      ]);
    case 'dome':
      return merge([
        [new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), pal.building],
        [new CylinderGeometry(1.03, 1.06, 0.12, 16).translate(0, 0.06, 0), '#6d6a72'],
      ]);
    case 'snowpole':
      return merge([
        [new CylinderGeometry(0.05, 0.05, 1.2, 4).translate(0, 0.6, 0), '#e2632f'],
        [new CylinderGeometry(0.05, 0.05, 0.8, 4).translate(0, 1.6, 0), '#1b1b1b'],
      ]);
    case 'lantern':
      return merge([
        [new CylinderGeometry(0.09, 0.12, 3.2, 5).translate(0, 1.6, 0), '#3e3a36'],
        [new BoxGeometry(0.45, 0.6, 0.45).translate(0, 3.45, 0), '#f3d6a0'],
        [new ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4).translate(0, 3.9, 0), '#3e3a36'],
      ]);
  }
}

interface Rule {
  min?: number;
  max?: number;
  fixed?: number;
  regular?: number;
  scale: [number, number];
  water?: boolean;
  align?: boolean;
  capacity: number;
  oneSide?: boolean;
}

const RULES: Record<PropKind, Rule> = {
  pine: { min: 9, max: 160, scale: [0.8, 1.5], capacity: 1000 },
  cypress: { min: 8, max: 120, scale: [0.85, 1.35], capacity: 700 },
  windswept: { min: 8, max: 70, scale: [0.75, 1.35], capacity: 500 },
  broadleaf: { min: 9, max: 140, scale: [0.8, 1.4], capacity: 700 },
  palm: { min: 7.5, max: 26, scale: [0.9, 1.25], capacity: 200 },
  rock: { min: 7, max: 170, scale: [0.5, 2.8], water: true, capacity: 800 },
  bush: { min: 6.8, max: 75, scale: [0.6, 1.5], capacity: 1300 },
  building: { min: 13, max: 70, scale: [1, 1], align: true, capacity: 500 },
  neon: { scale: [1, 1], capacity: 500 },
  streetlight: { fixed: ROAD_EDGE + 0.8, regular: 38, scale: [1, 1], align: true, capacity: 140 },
  vineyard: { min: 18, max: 150, scale: [0.9, 1.2], align: true, capacity: 600 },
  farmhouse: { min: 32, max: 180, scale: [0.9, 1.3], capacity: 90 },
  chalet: { min: 18, max: 150, scale: [0.9, 1.3], align: true, capacity: 140 },
  stonewall: { fixed: ROAD_EDGE + 3.4, regular: 10, scale: [1, 1], align: true, capacity: 240 },
  sheep: { min: 12, max: 90, scale: [0.9, 1.1], capacity: 240 },
  pole: { fixed: ROAD_EDGE + 2.6, regular: 46, scale: [1, 1], align: true, capacity: 60, oneSide: true },
  dome: { min: 26, max: 200, scale: [6, 22], capacity: 90 },
  snowpole: { fixed: ROAD_EDGE + 0.5, regular: 25, scale: [1, 1], align: true, capacity: 160 },
  lantern: { min: 7, max: 11, scale: [0.9, 1.1], align: true, capacity: 120 },
};

interface Instance {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  lat: number;
  s: number;
  tint: number;
  color?: Color;
  glow?: { y: number; dx: number; color: Color; big?: boolean };
}

const CELL = 10;
const KIND_INDEX = Object.fromEntries(PROP_KINDS.map((k, i) => [k, i])) as Record<PropKind, number>;

/** Shader patch: procedural lit windows on building facades at night. */
function buildingMaterial(night: { value: number }): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vFacade; varying float vRoof; varying float vSeed;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 sp = position * sc;
        vFacade = vec2(abs(normal.x) > 0.5 ? sp.z : sp.x, sp.y);
        vRoof = step(0.5, normal.y);
        vSeed = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11 + normal.x * 3.0 + normal.z * 7.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uNight; varying vec2 vFacade; varying float vRoof; varying float vSeed;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 cell = floor(vFacade / vec2(3.0, 3.3));
        vec2 f = fract(vFacade / vec2(3.0, 3.3));
        float win = step(0.26, f.x) * step(f.x, 0.74) * step(0.32, f.y) * step(f.y, 0.74) * (1.0 - vRoof) * step(1.0, cell.y);
        float lit = step(0.52, wHash(cell + vec2(floor(vSeed * 13.0), floor(vSeed * 5.0))));
        diffuseColor.rgb *= 1.0 - win * 0.45;
        totalEmissiveRadiance += win * lit * uNight * vec3(1.0, 0.78, 0.5) * 0.5;`,
      );
  };
  return m;
}

/**
 * Instanced scenery placed deterministically along the road. Placements are
 * computed per 10 m cell once and re-projected each frame.
 */
export class Props {
  readonly meshes = new Map<PropKind, InstancedMesh>();
  private readonly cells = new Map<number, Instance[]>();
  private readonly night = { value: 0 };
  private density = 1;
  private neonMat?: MeshBasicMaterial;

  constructor(
    private readonly path: RoadPath,
    private readonly schedule: EnvSchedule,
    private readonly features: () => Feature[],
    private readonly heightAt: (s: number, lat: number) => number,
    private seed: number,
  ) {}

  /** (Re)builds geometry for a pack palette. Returns meshes to add to the scene. */
  setPalette(pal: Palette, seed: number): InstancedMesh[] {
    this.dispose();
    this.seed = seed;
    this.cells.clear();
    const out: InstancedMesh[] = [];
    for (const kind of PROP_KINDS) {
      const geo = buildPropGeometry(kind, pal);
      let mat: Material;
      if (kind === 'building') mat = buildingMaterial(this.night);
      else if (kind === 'neon') mat = this.neonMat = new MeshBasicMaterial({ color: '#ffffff' });
      else mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
      const mesh = new InstancedMesh(geo, mat, RULES[kind].capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(RULES[kind].capacity * 3).fill(1), 3);
      mesh.instanceColor.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.meshes.set(kind, mesh);
      out.push(mesh);
    }
    return out;
  }

  setDensity(d: number): void {
    if (d !== this.density) {
      this.density = d;
      this.cells.clear();
    }
  }

  reset(): void {
    this.cells.clear();
  }

  private place(k: number): Instance[] {
    const out: Instance[] = [];
    const sMid = (k + 0.5) * CELL;
    const blend = this.schedule.at(sMid);
    const feats = this.features();
    if (canyonFactor(feats, sMid) > 0.05) return out;
    const pick = hash3(k, 991, this.seed) < blend.w ? blend.b : blend.a;
    const pal = pick.palette;
    const sample = { s: 0, x: 0, z: 0, h: 0, e: 0 };
    for (const kind of PROP_KINDS) {
      const density = pick.props[kind] * this.density;
      if (kind === 'neon' || density <= 0) continue;
      const rule = RULES[kind];
      for (const side of [-1, 1]) {
        if (rule.oneSide && side !== (hash3(Math.floor(k / 50), 3, this.seed) < 0.5 ? -1 : 1)) continue;
        const ki = KIND_INDEX[kind];
        let count: number;
        const positions: number[] = [];
        if (rule.regular) {
          const spacing = rule.regular / Math.min(2, Math.max(0.5, density));
          const first = Math.ceil((k * CELL) / spacing) * spacing;
          for (let s = first; s < (k + 1) * CELL; s += spacing) positions.push(s);
          count = positions.length;
        } else {
          const expected = density / 10;
          count = Math.floor(expected) + (hash3(k, ki * 2 + (side > 0 ? 1 : 0), this.seed) < expected % 1 ? 1 : 0);
        }
        for (let j = 0; j < count; j++) {
          const r = (n: number) => hash3(k * 7 + j, ki * 13 + n + (side > 0 ? 100 : 0), this.seed);
          const s = rule.regular ? positions[j] : k * CELL + r(1) * CELL;
          let lat = rule.fixed ?? (rule.min! + Math.pow(r(2), 1.6) * (rule.max! - rule.min!));
          let sx = 1;
          let sy = 1;
          let sz = 1;
          let tint = 0.85 + r(4) * 0.25;
          let color: Color | undefined;
          if (kind === 'building') {
            const city = (side < 0 ? pick.left : pick.right).terrain === 'city';
            sx = 9 + r(5) * 13;
            sz = 10 + r(6) * 18;
            sy = city ? 9 + Math.pow(r(7), 2.2) * 70 : 5 + r(7) * 6;
            lat = (city ? 12 : 16) + sx / 2 + r(8) * (city ? 10 : 40);
            const accent = pal.accents[Math.floor(r(9) * pal.accents.length)];
            color = new Color(pal.building).lerp(new Color(accent), r(10) * 0.25).multiplyScalar(0.75 + r(11) * 0.35);
          } else if (kind === 'dome' || kind === 'rock' || !rule.align) {
            const sc = rule.scale[0] + r(5) * (rule.scale[1] - rule.scale[0]);
            sx = sy = sz = sc;
            if (kind === 'dome') sy = sc * (0.6 + r(6) * 0.5);
          } else {
            const sc = rule.scale[0] + r(5) * (rule.scale[1] - rule.scale[0]);
            sx = sy = sz = sc;
          }
          this.path.sample(s, sample);
          const signedLat = side * lat;
          const y = this.heightAt(s, signedLat);
          if (!rule.water && y < SEA_LEVEL + 1.5) continue;
          if (kind !== 'rock' && kind !== 'building' && y - sample.e > 60) continue;
          const cos = Math.cos(sample.h);
          const sin = Math.sin(sample.h);
          const x = sample.x + cos * signedLat;
          const z = sample.z + sin * signedLat;
          // Aligned props face the road; others get a random yaw.
          const yaw = rule.align || kind === 'building' ? -sample.h + (side < 0 ? Math.PI : 0) : r(12) * Math.PI * 2;
          const inst: Instance = { kind, x, y: y - 0.25, z, yaw, sx, sy, sz, lat: signedLat, s, tint, color };
          if (kind === 'streetlight') inst.glow = { y: 7.75, dx: -2.0, color: new Color('#ffd9a0') };
          if (kind === 'lantern') inst.glow = { y: 3.45, dx: 0, color: new Color('#ffcf88') };
          if (kind === 'dome') inst.glow = { y: sy * 0.35, dx: 0, color: new Color(pal.accents[0]), big: true };
          out.push(inst);

          if (kind === 'building') {
            const neonChance = (pick.props.neon ?? 0) / 10;
            const facade = side * (lat - sx / 2 - 0.4);
            for (let q = 0; q < 2; q++) {
              if (hash3(k * 7 + j, 501 + q, this.seed) >= neonChance) continue;
              const ns = s + (q - 0.5) * sz * 0.5;
              this.path.sample(ns, sample);
              const c2 = Math.cos(sample.h);
              const s2 = Math.sin(sample.h);
              const accent = pal.accents[Math.floor(hash3(k, 777 + q + j, this.seed) * pal.accents.length)];
              out.push({
                kind: 'neon',
                x: sample.x + c2 * facade,
                y: y + 3 + hash3(k, 888 + q, this.seed) * Math.min(10, sy - 6),
                z: sample.z + s2 * facade,
                yaw: -sample.h,
                sx: 1,
                sy: 0.7 + hash3(k, 889 + q, this.seed) * 0.8,
                sz: 1,
                lat: facade,
                s: ns,
                tint: 1,
                color: new Color(accent),
              });
            }
          }
        }
      }
    }
    return out;
  }

  update(pose: Pose, night: number, glows: Glows): void {
    this.night.value = night;
    if (this.neonMat) this.neonMat.color.setScalar(0.55 + night * 0.9);
    const k0 = Math.floor((pose.d - 30) / CELL);
    const k1 = Math.floor((pose.d + VIEW) / CELL);
    for (const key of this.cells.keys()) if (key < k0 - 2) this.cells.delete(key);
    const counts = new Map<PropKind, number>();
    const feats = this.features();
    const local = [0, 0, 0];
    for (let k = k0; k <= k1; k++) {
      let cell = this.cells.get(k);
      if (!cell) {
        cell = this.place(k);
        this.cells.set(k, cell);
      }
      for (const inst of cell) {
        const mesh = this.meshes.get(inst.kind)!;
        const n = counts.get(inst.kind) ?? 0;
        if (n >= RULES[inst.kind].capacity) continue;
        if (Math.abs(inst.lat) < 15 && inSpan(feats, ['tunnel', 'gallery'], inst.s, 4)) continue;
        toLocal(pose, inst.x, inst.y, inst.z, local, 0);
        const yaw = inst.yaw + pose.h;
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const te = mesh.instanceMatrix.array as Float32Array;
        const o = n * 16;
        te[o] = c * inst.sx;
        te[o + 1] = 0;
        te[o + 2] = -s * inst.sx;
        te[o + 3] = 0;
        te[o + 4] = 0;
        te[o + 5] = inst.sy;
        te[o + 6] = 0;
        te[o + 7] = 0;
        te[o + 8] = s * inst.sz;
        te[o + 9] = 0;
        te[o + 10] = c * inst.sz;
        te[o + 11] = 0;
        te[o + 12] = local[0];
        te[o + 13] = local[1];
        te[o + 14] = local[2];
        te[o + 15] = 1;
        const ic = mesh.instanceColor!.array as Float32Array;
        if (inst.color) {
          ic[n * 3] = inst.color.r * inst.tint;
          ic[n * 3 + 1] = inst.color.g * inst.tint;
          ic[n * 3 + 2] = inst.color.b * inst.tint;
        } else {
          ic[n * 3] = ic[n * 3 + 1] = ic[n * 3 + 2] = inst.tint;
        }
        counts.set(inst.kind, n + 1);
        if (inst.glow && night > 0.05) {
          const gx = local[0] + c * inst.glow.dx * inst.sx;
          const gz = local[2] - s * inst.glow.dx * inst.sx;
          glows.add(gx, local[1] + inst.glow.y * inst.sy, gz, inst.glow.color, inst.glow.big);
        }
      }
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
      mesh.dispose();
    }
    this.meshes.clear();
  }
}
