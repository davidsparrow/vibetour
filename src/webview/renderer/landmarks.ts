import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { LandmarkKind, Palette } from '../../core/packs';
import { hash3 } from './noise';
import { jitter, merge, type Part } from './props';
import type { Glows } from './glows';
import { toLocal, type Pose } from './terrain';
import { SEA_LEVEL, VIEW, type Feature, type RoadPath } from './world';

interface GlowSpec {
  p: Vector3;
  color: Color;
  big?: boolean;
}

interface Built {
  root: Group;
  glows: GlowSpec[];
  animate?: (time: number, night: number) => void;
}

const CONCRETE = '#c8c1b3';
const WHITE = '#f1efe9';

/** A box spanning two points — used for arch segments, cables and legs. */
function beam(a: Vector3, b: Vector3, w: number, d = w): BoxGeometry {
  const g = new BoxGeometry(w, a.distanceTo(b), d);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

const lambert = () => new MeshLambertMaterial({ vertexColors: true, flatShading: true });

function meshOf(parts: Part[]): Mesh {
  return new Mesh(merge(parts), lambert());
}

/** Bridge structures are built along −Z with the deck surface at y = 0. */
function archBridge(L: number, depth: number): Built {
  const parts: Part[] = [];
  parts.push([new BoxGeometry(11.5, 1.7, L + 20).translate(0, -0.95, 0), CONCRETE]);
  const a = L * 0.36;
  const H = Math.max(18, depth - 3);
  const arch = (z: number) => -2.6 - H * (1 - Math.sqrt(Math.max(0, 1 - (z / a) ** 2)));
  for (const x of [-3.6, 3.6]) {
    const N = 26;
    for (let i = 0; i < N; i++) {
      const z0 = -a + (2 * a * i) / N;
      const z1 = -a + (2 * a * (i + 1)) / N;
      parts.push([beam(new Vector3(x, arch(z0), z0), new Vector3(x, arch(z1), z1), 2.2, 1.6), CONCRETE]);
    }
    for (let z = -a + 9; z < a - 4; z += 9.5) {
      const y0 = arch(z);
      if (-1.8 - y0 > 0.6) parts.push([new BoxGeometry(1.1, -1.8 - y0, 1.1).translate(x, (y0 - 1.8) / 2, z), CONCRETE]);
    }
    for (const sign of [-1, 1]) {
      for (let z = a + 4; z < L / 2 + 6; z += 12) {
        parts.push([new BoxGeometry(1.6, depth, 1.6).translate(x, -1.8 - depth / 2, sign * z), CONCRETE]);
      }
    }
  }
  return { root: new Group().add(meshOf(parts)), glows: [] };
}

function suspensionBridge(L: number, depth: number, pal: Palette): Built {
  const parts: Part[] = [];
  const glows: GlowSpec[] = [];
  parts.push([new BoxGeometry(13, 2.4, L + 40).translate(0, -1.3, 0), '#d9dadc']);
  const towerZ = L * 0.3;
  const top = 68;
  for (const z of [-towerZ, towerZ]) {
    for (const x of [-8, 8]) {
      parts.push([new BoxGeometry(2.6, top + depth, 3).translate(x, (top - depth) / 2, z), WHITE]);
    }
    for (const y of [top - 4, top * 0.55, 10]) parts.push([new BoxGeometry(18, 2.2, 2.4).translate(0, y, z), WHITE]);
    glows.push({ p: new Vector3(-8, top + 1, z), color: new Color('#ff5b5b'), big: true });
    glows.push({ p: new Vector3(8, top + 1, z), color: new Color('#ff5b5b'), big: true });
  }
  const cable = (z: number) => {
    const t = (z + towerZ) / (2 * towerZ);
    if (Math.abs(z) <= towerZ) return 3 + (top - 3) * Math.pow(2 * t - 1, 2);
    const u = (Math.abs(z) - towerZ) / (L / 2 + 20 - towerZ);
    return top - (top - 1) * u;
  };
  const accents = pal.accents;
  for (const x of [-7.6, 7.6]) {
    const N = 40;
    const zA = -(L / 2 + 20);
    for (let i = 0; i < N; i++) {
      const z0 = zA + ((L + 40) * i) / N;
      const z1 = zA + ((L + 40) * (i + 1)) / N;
      parts.push([beam(new Vector3(x, cable(z0), z0), new Vector3(x, cable(z1), z1), 0.6), '#e6e6e6']);
      if (i % 2 === 0) glows.push({ p: new Vector3(x, cable(z0), z0), color: new Color(accents[i % accents.length]) });
    }
    for (let z = -towerZ + 8; z < towerZ - 4; z += 8) {
      const y = cable(z);
      if (y > 2) parts.push([new BoxGeometry(0.2, y, 0.2).translate(x, y / 2, z), '#e6e6e6']);
    }
  }
  return { root: new Group().add(meshOf(parts)), glows };
}

/** Side landmarks are built with the road on their −X side and ground at y = 0. */
function lighthouse(seaY: number): Built {
  const parts: Part[] = [];
  const top = Math.max(seaY + 16, 10);
  parts.push([jitter(new IcosahedronGeometry(34, 1), 0.3, 11).scale(1, 0.5, 1.1).translate(0, top - 17, 0), '#6f5d50']);
  parts.push([new CylinderGeometry(1.6, 2.3, 15, 12).translate(0, top + 7.5, 0), WHITE]);
  parts.push([new CylinderGeometry(1.7, 1.7, 2.4, 12).translate(0, top + 16.2, 0), '#2b2f36']);
  parts.push([new ConeGeometry(2.0, 2.2, 12).translate(0, top + 18.5, 0), '#b23a2f']);
  parts.push([new BoxGeometry(10, 5, 7).translate(-9, top + 2.5, 4), '#e9e2d4']);
  parts.push([new CylinderGeometry(0.01, 7.4, 2.2, 4).rotateY(Math.PI / 4).scale(1, 1, 0.75).translate(-9, top + 6.1, 4), '#8a4a3a']);
  const built: Built = { root: new Group().add(meshOf(parts)), glows: [{ p: new Vector3(0, top + 16.2, 0), color: new Color('#fff3c4'), big: true }] };
  return built;
}

function latticeTower(): Built {
  const parts: Part[] = [];
  const glows: GlowSpec[] = [];
  const H = 150;
  const width = (y: number) => 17 * Math.pow(1 - y / 165, 1.7) + 1.4;
  const orange = '#e4572e';
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    for (let i = 0; i < 10; i++) {
      const y0 = (H * i) / 10;
      const y1 = (H * (i + 1)) / 10;
      parts.push([beam(new Vector3(sx * width(y0), y0, sz * width(y0)), new Vector3(sx * width(y1), y1, sz * width(y1)), 1.3), i % 2 ? WHITE : orange]);
    }
  }
  for (let y = 8; y < H; y += 11) {
    const w = width(y);
    const c = Math.floor(y / 22) % 2 ? WHITE : orange;
    parts.push([new BoxGeometry(2 * w, 0.7, 0.7).translate(0, y, w), c]);
    parts.push([new BoxGeometry(2 * w, 0.7, 0.7).translate(0, y, -w), c]);
    parts.push([new BoxGeometry(0.7, 0.7, 2 * w).translate(w, y, 0), c]);
    parts.push([new BoxGeometry(0.7, 0.7, 2 * w).translate(-w, y, 0), c]);
    glows.push({ p: new Vector3(w, y, w), color: new Color('#ffb36b') });
    glows.push({ p: new Vector3(-w, y, -w), color: new Color('#ffb36b') });
  }
  parts.push([new BoxGeometry(17, 7, 17).translate(0, 72, 0), '#f6f3ee']);
  parts.push([new BoxGeometry(8, 4, 8).translate(0, 128, 0), '#f6f3ee']);
  parts.push([new BoxGeometry(1, 40, 1).translate(0, H + 20, 0), orange]);
  glows.push({ p: new Vector3(0, 72, 0), color: new Color('#ffcf8a'), big: true });
  glows.push({ p: new Vector3(0, H + 40, 0), color: new Color('#ff4040'), big: true });
  return { root: new Group().add(meshOf(parts)), glows };
}

function townCluster(pal: Palette, seed: number, radius: number, houses: number, towers: number, towerColor: string): { parts: Part[]; glows: GlowSpec[] } {
  const parts: Part[] = [];
  const glows: GlowSpec[] = [];
  for (let i = 0; i < houses; i++) {
    const r = (n: number) => hash3(i, n, seed);
    const a = r(1) * Math.PI * 2;
    const d = Math.sqrt(r(2)) * radius;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const w = 6 + r(3) * 7;
    const h = 6 + r(4) * 8;
    const dd = 6 + r(5) * 7;
    parts.push([new BoxGeometry(w, h, dd).translate(x, h / 2, z), new Color(pal.building).multiplyScalar(0.85 + r(6) * 0.25).getStyle()]);
    parts.push([new CylinderGeometry(0.01, Math.max(w, dd) * 0.72, 2.2, 4).rotateY(Math.PI / 4).scale(w / Math.max(w, dd), 1, dd / Math.max(w, dd)).translate(x, h + 1.1, z), '#a9573a']);
    if (r(7) > 0.5) glows.push({ p: new Vector3(x - w / 2 - 0.2, h * 0.5, z), color: new Color('#ffcf8a') });
  }
  for (let i = 0; i < towers; i++) {
    const r = (n: number) => hash3(i, n + 40, seed);
    const a = r(1) * Math.PI * 2;
    const d = Math.sqrt(r(2)) * radius * 0.7;
    const h = 28 + r(3) * 26;
    parts.push([new BoxGeometry(5, h, 5).translate(Math.cos(a) * d, h / 2, Math.sin(a) * d), towerColor]);
  }
  return { parts, glows };
}

function hillTown(pal: Palette, seed: number): Built {
  const mound: Part = [new SphereGeometry(130, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1), pal.groundFar];
  const town = townCluster(pal, seed, 55, 46, 9, '#b9a58a');
  for (const p of town.parts) p[0].translate(0, 37, 0);
  for (const g of town.glows) g.p.y += 37;
  return { root: new Group().add(meshOf([mound, ...town.parts])), glows: town.glows };
}

function bellTower(pal: Palette, seed: number): Built {
  const town = townCluster(pal, seed, 70, 40, 0, '#a4553a');
  const parts = town.parts;
  parts.push([new BoxGeometry(7, 64, 7).translate(-10, 32, 0), '#9c4f36']);
  parts.push([new BoxGeometry(9, 6, 9).translate(-10, 67, 0), '#efe7da']);
  parts.push([new BoxGeometry(5, 6, 5).translate(-10, 73, 0), '#efe7da']);
  parts.push([new ConeGeometry(3.2, 4, 4).rotateY(Math.PI / 4).translate(-10, 78, 0), '#7b6a5c']);
  // Cathedral with a striped campanile and dome.
  parts.push([new BoxGeometry(18, 20, 40).translate(30, 10, 10), '#efe9df']);
  for (let i = 0; i < 12; i++) parts.push([new BoxGeometry(6, 3.5, 6).translate(42, 1.75 + i * 3.5, -12), i % 2 ? '#2f3a34' : '#f2ede4']);
  parts.push([new SphereGeometry(8, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(30, 20, 0), '#d8cfc2']);
  town.glows.push({ p: new Vector3(-10, 67, 0), color: new Color('#ffd28a'), big: true });
  return { root: new Group().add(meshOf(parts)), glows: town.glows };
}

function waterfall(): Built {
  const parts: Part[] = [];
  parts.push([jitter(new BoxGeometry(46, 72, 160, 4, 6, 10), 0.08, 21).translate(30, 30, 0), '#4a4740']);
  parts.push([new BoxGeometry(60, 6, 170).translate(36, 68, 0), '#6d7a4a']);
  const root = new Group().add(meshOf(parts));
  const mat = new ShaderMaterial({
    transparent: true,
    side: DoubleSide,
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uLight; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float col = floor(vUv.x * 18.0);
        float streak = h(vec2(col, floor(vUv.y * 6.0 + uTime * 2.0 + h(vec2(col, 1.0)) * 6.0)));
        float a = (0.55 + 0.45 * streak) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        gl_FragColor = vec4(vec3(0.92, 0.95, 0.97) * uLight, a);
        #include <colorspace_fragment>
      }`,
  });
  const fall = new Mesh(new PlaneGeometry(10, 66), mat);
  fall.rotation.y = Math.PI / 2;
  fall.position.set(6.8, 35, -20);
  root.add(fall);
  return {
    root,
    glows: [],
    animate: (time, night) => {
      mat.uniforms.uTime.value = time;
      mat.uniforms.uLight.value = 1 - night * 0.6;
    },
  };
}

function castle(seaY: number): Built {
  const base = Math.max(0, seaY + 2);
  const parts: Part[] = [];
  const stone = '#8a8276';
  parts.push([jitter(new IcosahedronGeometry(26, 1), 0.2, 31).scale(1, 0.35, 1).translate(0, base - 4, 0), '#5f6a46']);
  parts.push([new BoxGeometry(14, 18, 16).translate(0, base + 9, 0), stone]);
  for (let i = -3; i <= 3; i++) {
    parts.push([new BoxGeometry(1.4, 1.6, 1.4).translate(i * 2, base + 18.8, 8), stone]);
    parts.push([new BoxGeometry(1.4, 1.6, 1.4).translate(i * 2, base + 18.8, -8), stone]);
  }
  parts.push([new CylinderGeometry(3.2, 3.6, 13, 10).translate(-9, base + 6.5, 8), stone]);
  parts.push([new BoxGeometry(22, 6, 1.4).translate(0, base + 3, 13), stone]);
  for (let i = 0; i < 3; i++) parts.push([new BoxGeometry(12, 4, 3).translate(-24 - i * 12, base + 1, 0), stone]);
  return { root: new Group().add(meshOf(parts)), glows: [{ p: new Vector3(-7, base + 12, 0), color: new Color('#ffcf8a') }] };
}

function domeCity(pal: Palette, seed: number): Built {
  const parts: Part[] = [];
  const glows: GlowSpec[] = [];
  for (let i = 0; i < 8; i++) {
    const r = (n: number) => hash3(i, n, seed);
    const R = 14 + r(1) * 30;
    const x = 20 + r(2) * 120;
    const z = (r(3) - 0.5) * 220;
    parts.push([new SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(x, 0, z), pal.building]);
    parts.push([new CylinderGeometry(R * 1.02, R * 1.05, 1.4, 20).translate(x, 0.7, z), '#5d5a63']);
    glows.push({ p: new Vector3(x - R * 0.9, R * 0.2, z), color: new Color(pal.accents[i % pal.accents.length]), big: true });
  }
  parts.push([new CylinderGeometry(3, 5, 90, 8).translate(70, 45, 0), '#cfcac4']);
  parts.push([new SphereGeometry(7, 12, 8).translate(70, 92, 0), '#e8e2da']);
  glows.push({ p: new Vector3(70, 95, 0), color: new Color('#9fe3ff'), big: true });
  return { root: new Group().add(meshOf(parts)), glows };
}

function chapel(roof: string): Built {
  const parts: Part[] = [];
  parts.push([new BoxGeometry(8, 6.5, 14).translate(0, 3.25, 0), WHITE]);
  parts.push([new CylinderGeometry(0.01, 6.3, 3.6, 4).rotateY(Math.PI / 4).scale(0.9, 1, 1.6).translate(0, 8.3, 0), roof]);
  parts.push([new BoxGeometry(3.4, 11, 3.4).translate(0, 5.5, -8), WHITE]);
  parts.push([new ConeGeometry(2.6, 6, 4).rotateY(Math.PI / 4).translate(0, 14, -8), roof]);
  return { root: new Group().add(meshOf(parts)), glows: [{ p: new Vector3(-4.2, 3, 0), color: new Color('#ffd590') }] };
}

function pagoda(): Built {
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const w = 11 - i * 1.6;
    const y = i * 6;
    parts.push([new BoxGeometry(w, 4.2, w).translate(0, y + 2.1, 0), '#a9322a']);
    parts.push([new CylinderGeometry(0.4 * w, w * 0.95, 1.6, 4).rotateY(Math.PI / 4).translate(0, y + 4.9, 0), '#2c2a2b']);
  }
  parts.push([new CylinderGeometry(0.2, 0.3, 9, 6).translate(0, 34, 0), '#c9a64b']);
  return { root: new Group().add(meshOf(parts)), glows: [{ p: new Vector3(-6, 3, 0), color: new Color('#ffb070') }] };
}

/** Places landmark structures for scheduled landmark/bridge features. */
export class Landmarks {
  readonly group = new Group();
  private readonly built = new Map<number, Built>();

  constructor(
    private readonly path: RoadPath,
    private readonly heightAt: (s: number, lat: number) => number,
    private palette: Palette,
    private seed: number,
  ) {}

  reset(palette: Palette, seed: number): void {
    this.palette = palette;
    this.seed = seed;
    for (const id of [...this.built.keys()]) this.remove(id);
  }

  private build(f: Feature, groundY: number): Built | undefined {
    const seaY = SEA_LEVEL - groundY;
    switch (f.landmark) {
      case 'arch-bridge':
        return archBridge(f.s1 - f.s0, Math.max(20, -seaY + 6));
      case 'suspension-bridge':
        return suspensionBridge(f.s1 - f.s0, Math.max(20, -seaY + 6), this.palette);
      case 'lighthouse':
        return lighthouse(seaY);
      case 'lattice-tower':
        return latticeTower();
      case 'hill-town':
        return hillTown(this.palette, this.seed + f.id);
      case 'bell-tower':
        return bellTower(this.palette, this.seed + f.id);
      case 'waterfall':
        return waterfall();
      case 'castle':
        return castle(seaY);
      case 'dome-city':
        return domeCity(this.palette, this.seed + f.id);
      case 'chapel':
        return chapel(this.palette.accents[2] ?? '#8a3b2c');
      case 'pagoda':
        return pagoda();
      default:
        return undefined;
    }
  }

  private remove(id: number): void {
    const b = this.built.get(id);
    if (!b) return;
    this.group.remove(b.root);
    b.root.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
    });
    this.built.delete(id);
  }

  update(pose: Pose, features: Feature[], glows: Glows, time: number, night: number): void {
    const live = new Set<number>();
    const local = [0, 0, 0];
    for (const f of features) {
      if (f.kind !== 'landmark' || !f.landmark) continue;
      if (f.s1 < pose.d - 450 || f.s0 > pose.d + VIEW + 300) continue;
      live.add(f.id);
      const sMid = (f.s0 + f.s1) / 2;
      const c = this.path.sample(sMid);
      const side = f.side === 'left' ? -1 : 1;
      const lat = side * (f.lateral ?? 0);
      const bridgeLike = f.landmark === 'arch-bridge' || f.landmark === 'suspension-bridge';
      let b = this.built.get(f.id);
      const groundY = bridgeLike ? c.e : Math.max(this.heightAt(sMid, lat), SEA_LEVEL - 16);
      if (!b) {
        b = this.build(f, groundY);
        if (!b) continue;
        b.root.userData.groundY = groundY;
        this.built.set(f.id, b);
        this.group.add(b.root);
      }
      const gy = b.root.userData.groundY as number;
      const wx = c.x + Math.cos(c.h) * lat;
      const wz = c.z + Math.sin(c.h) * lat;
      toLocal(pose, wx, gy, wz, local, 0);
      b.root.position.set(local[0], local[1], local[2]);
      const yaw = -c.h + pose.h + (side < 0 && !bridgeLike ? Math.PI : 0);
      b.root.rotation.y = yaw;
      b.animate?.(time, night);
      if (night > 0.05) {
        const cs = Math.cos(yaw);
        const sn = Math.sin(yaw);
        for (const g of b.glows) {
          glows.add(local[0] + g.p.x * cs + g.p.z * sn, local[1] + g.p.y, local[2] - g.p.x * sn + g.p.z * cs, g.color, g.big);
        }
      }
    }
    for (const id of [...this.built.keys()]) if (!live.has(id)) this.remove(id);
  }

  dispose(): void {
    for (const id of [...this.built.keys()]) this.remove(id);
  }
}

export const LANDMARK_LATERAL: Record<LandmarkKind, number> = {
  'arch-bridge': 0,
  'suspension-bridge': 0,
  lighthouse: 150,
  'lattice-tower': 230,
  'hill-town': 380,
  'bell-tower': 95,
  waterfall: 70,
  castle: 165,
  'dome-city': 120,
  chapel: 55,
  pagoda: 80,
};

export function landmarkLength(kind: LandmarkKind): number {
  return kind === 'arch-bridge' ? 220 : kind === 'suspension-bridge' ? 520 : 60;
}

