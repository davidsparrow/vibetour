import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import type { JourneyPack } from '../../core/packs';
import { toLocal, type Pose } from './terrain';
import { inSpan, isWater, LANE, ROAD_EDGE, ROAD_HALF, STEP, VIEW, type EnvSchedule, type Feature, type RoadPath } from './world';

const ROWS = Math.ceil((VIEW + 24) / STEP) + 2;
const DASH = 12;
const RAIL_PERIOD = 4;

function makeRoadTexture(pack: JourneyPack, renderer: WebGLRenderer): CanvasTexture {
  const W = 256;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const road = new Color(pack.palette.road);
  g.fillStyle = `#${road.getHexString()}`;
  g.fillRect(0, 0, W, H);
  // Aggregate speckle so the asphalt reads as a surface, not a flat colour.
  for (let i = 0; i < 2600; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const u = (lat: number) => ((lat + ROAD_EDGE) / (2 * ROAD_EDGE)) * W;
  // Shoulders a touch lighter.
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, 0, u(-ROAD_HALF), H);
  g.fillRect(u(ROAD_HALF), 0, W - u(ROAD_HALF), H);
  // Edge lines.
  g.fillStyle = 'rgba(240,240,232,0.9)';
  g.fillRect(u(-ROAD_HALF) - 2, 0, 3, H);
  g.fillRect(u(ROAD_HALF) - 1, 0, 3, H);
  // Centre line: double yellow in the US, dashed elsewhere.
  g.fillStyle = pack.palette.roadLine;
  if (pack.countryCode === 'US') {
    g.fillRect(u(0) - 4, 0, 2.5, H);
    g.fillRect(u(0) + 1.5, 0, 2.5, H);
  } else {
    g.fillRect(u(0) - 1.5, 0, 3, H * 0.33);
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeRailTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#9aa0a6';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = '#c9ced4';
  g.fillRect(0, 6, 64, 10);
  g.fillStyle = '#6b7076';
  g.fillRect(0, 15, 64, 2);
  g.fillRect(28, 0, 6, 32);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Road surface plus guardrails / bridge parapets, rebuilt in camera space each frame. */
export class Road {
  readonly surface: Mesh<BufferGeometry, MeshPhongMaterial>;
  readonly rails: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly pos = new Float32Array(ROWS * 3 * 3);
  private readonly uv = new Float32Array(ROWS * 3 * 2);
  private readonly col = new Float32Array(ROWS * 3 * 3);
  private readonly railPos = new Float32Array(ROWS * 4 * 3);
  private readonly railUv = new Float32Array(ROWS * 4 * 2);
  private readonly railCol = new Float32Array(ROWS * 4 * 3);
  private readonly concrete = new Color('#d8d2c6');
  private readonly metal = new Color('#ffffff');

  constructor(
    private readonly path: RoadPath,
    private readonly schedule: EnvSchedule,
    private readonly features: () => Feature[],
  ) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('uv', new BufferAttribute(this.uv, 2).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (let c = 0; c < 2; c++) {
        const a = r * 3 + c;
        idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
    geo.setIndex(idx);
    this.surface = new Mesh(geo, new MeshPhongMaterial({ vertexColors: true, shininess: 8, specular: new Color('#111111') }));
    this.surface.frustumCulled = false;
    this.surface.renderOrder = 1;

    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(this.railPos, 3).setUsage(DynamicDrawUsage));
    rg.setAttribute('uv', new BufferAttribute(this.railUv, 2).setUsage(DynamicDrawUsage));
    rg.setAttribute('color', new BufferAttribute(this.railCol, 3).setUsage(DynamicDrawUsage));
    const ridx: number[] = [];
    for (let r = 0; r < ROWS - 1; r++) {
      for (const side of [0, 2]) {
        const a = r * 4 + side;
        const b = a + 4;
        ridx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    rg.setIndex(ridx);
    this.rails = new Mesh(rg, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, map: makeRailTexture() }));
    this.rails.frustumCulled = false;
  }

  setPack(pack: JourneyPack, renderer: WebGLRenderer): void {
    const m = this.surface.material;
    m.map?.dispose();
    m.map = makeRoadTexture(pack, renderer);
    m.needsUpdate = true;
  }

  setWet(wet: number): void {
    const m = this.surface.material;
    m.shininess = 8 + wet * 70;
    m.specular.setScalar(0.07 + wet * 0.45);
    m.color.setScalar(1 - wet * 0.3);
  }

  update(pose: Pose): void {
    const k0 = Math.floor((pose.d - 12) / STEP);
    const base = Math.floor(pose.d / (DASH * 100)) * DASH * 100;
    const feats = this.features();
    const p = this.pos;
    const uv = this.uv;
    const col = this.col;
    const rp = this.railPos;
    const ruv = this.railUv;
    const rc = this.railCol;
    const sample = { s: 0, x: 0, z: 0, h: 0, e: 0 };
    for (let r = 0; r < ROWS; r++) {
      const s = (k0 + r) * STEP;
      const c = this.path.sample(s, sample);
      const cos = Math.cos(c.h);
      const sin = Math.sin(c.h);
      const tunnel = inSpan(feats, 'tunnel', s);
      const gallery = inSpan(feats, 'gallery', s);
      const shade = tunnel ? 0.32 : gallery ? 0.62 : 1;
      const v = (s - base) / DASH;
      for (let i = 0; i < 3; i++) {
        const lat = (i - 1) * ROAD_EDGE;
        const o = (r * 3 + i) * 3;
        toLocal(pose, c.x + cos * lat, c.e + (i === 1 ? 0.06 : 0), c.z + sin * lat, p, o);
        uv[(r * 3 + i) * 2] = i / 2;
        uv[(r * 3 + i) * 2 + 1] = v;
        col[o] = col[o + 1] = col[o + 2] = shade;
      }

      const bridge = inSpan(feats, 'bridge', s);
      const blend = this.schedule.at(s);
      const env = blend.w > 0.5 ? blend.b : blend.a;
      const sides: Array<[number, boolean]> = [
        [-1, !!bridge || (env.guardrail && isWater(env.left.terrain))],
        [1, !!bridge || (env.guardrail && isWater(env.right.terrain))],
      ];
      for (let si = 0; si < 2; si++) {
        const [sign, on] = sides[si];
        const active = on && !tunnel;
        const lat = sign * (ROAD_EDGE + 0.2);
        const bottom = bridge ? c.e - 1.8 : c.e + 0.2;
        const top = active ? (bridge ? c.e + 0.72 : c.e + 0.8) : bottom;
        const o = (r * 4 + si * 2) * 3;
        toLocal(pose, c.x + cos * lat, bottom, c.z + sin * lat, rp, o);
        toLocal(pose, c.x + cos * lat, top, c.z + sin * lat, rp, o + 3);
        const u = (s - base) / RAIL_PERIOD;
        const uo = (r * 4 + si * 2) * 2;
        ruv[uo] = u;
        ruv[uo + 1] = bridge ? 0 : 0.05;
        ruv[uo + 2] = u;
        ruv[uo + 3] = bridge ? 0.05 : 1;
        const colr = bridge ? this.concrete : this.metal;
        rc[o] = rc[o + 3] = colr.r * shade;
        rc[o + 1] = rc[o + 4] = colr.g * shade;
        rc[o + 2] = rc[o + 5] = colr.b * shade;
      }
    }
    const g = this.surface.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    const rgeo = this.rails.geometry;
    rgeo.attributes.position.needsUpdate = true;
    rgeo.attributes.uv.needsUpdate = true;
    rgeo.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.surface.geometry.dispose();
    this.surface.material.map?.dispose();
    this.surface.material.dispose();
    this.rails.geometry.dispose();
    this.rails.material.map?.dispose();
    this.rails.material.dispose();
  }
}

export const LANE_CENTRE = LANE / 2;
