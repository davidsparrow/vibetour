import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three';
import { toLocal, type Pose } from './terrain';
import { STEP, VIEW, type Feature, type RoadPath } from './world';

/** Tunnel cross-section (lateral, height) from left wall to right wall. */
const TUNNEL: Array<[number, number]> = [
  [-7.2, -0.3],
  [-7.2, 4.6],
  [-6, 6.5],
  [-3, 7.5],
  [3, 7.5],
  [6, 6.5],
  [7.2, 4.6],
  [7.2, -0.3],
];

const MAX_ROWS = Math.ceil(VIEW / STEP) + 4;
const MAX_LAMPS = 320;
const MAX_PILLARS = 160;

function profile(kind: Feature['kind'], openSide: number): Array<[number, number]> {
  if (kind === 'tunnel') return TUNNEL;
  // Gallery: a rock shed open towards the view (PRD §41 "transitional sequence").
  const wall = -openSide * 7.2;
  const roofEdge: [number, number] = [openSide * 7.6, 6.2];
  // Padded to eight points so it shares the tunnel's index buffer.
  return [[wall, -0.3], [wall, 6.2], [openSide * 7.6, 6.8], roofEdge, roofEdge, roofEdge, roofEdge, roofEdge];
}

function portalGeometry(kind: Feature['kind'], openSide: number): ShapeGeometry {
  const outer = kind === 'tunnel' ? { w: 46, top: 30, bottom: -6 } : { w: 10, top: 8.4, bottom: -1 };
  const shape = new Shape();
  shape.moveTo(-outer.w, outer.bottom);
  shape.lineTo(outer.w, outer.bottom);
  shape.lineTo(outer.w, outer.top);
  shape.lineTo(-outer.w, outer.top);
  shape.closePath();
  const hole = new Path();
  const pts =
    kind === 'tunnel'
      ? TUNNEL.map(([x, y]) => new Vector2(x, y))
      : [
          new Vector2(-openSide * 7.2, -0.3),
          new Vector2(-openSide * 7.2, 6.2),
          new Vector2(openSide * 7.6, 6.8),
          new Vector2(openSide * 7.6, -0.3),
        ];
  hole.setFromPoints(pts);
  shape.holes.push(hole);
  return new ShapeGeometry(shape);
}

/**
 * Tunnels and galleries staged while verification runs (tests in a tunnel,
 * "the road opens up" when they pass). Geometry follows the road each frame.
 */
export class Tunnels {
  readonly group = new Group();
  private readonly shell: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly lamps: InstancedMesh;
  private readonly pillars: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly portals = new Map<string, Mesh<ShapeGeometry, MeshLambertMaterial>>();
  private readonly portalMat: MeshLambertMaterial;

  constructor(public path: RoadPath) {
    const verts = MAX_ROWS * 8;
    this.pos = new Float32Array(verts * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    const idx: number[] = [];
    for (let r = 0; r < MAX_ROWS - 1; r++) {
      for (let c = 0; c < 7; c++) {
        const a = r * 8 + c;
        idx.push(a, a + 8, a + 1, a + 1, a + 8, a + 9);
      }
    }
    geo.setIndex(idx);
    this.shell = new Mesh(geo, new MeshLambertMaterial({ color: '#3a3b40', emissive: new Color('#121214'), side: DoubleSide, flatShading: true }));
    this.shell.frustumCulled = false;
    this.lamps = new InstancedMesh(new BoxGeometry(0.5, 0.14, 1.6), new MeshBasicMaterial({ color: '#ffb35c' }), MAX_LAMPS);
    this.lamps.frustumCulled = false;
    this.pillars = new InstancedMesh(new BoxGeometry(0.8, 1, 0.8).translate(0, 0.5, 0), new MeshLambertMaterial({ color: '#b5afa4' }), MAX_PILLARS);
    this.pillars.frustumCulled = false;
    this.portalMat = new MeshLambertMaterial({ color: '#6c655d', side: DoubleSide, flatShading: true });
    this.group.add(this.shell, this.lamps, this.pillars);
  }

  setRock(color: string): void {
    this.portalMat.color.set(color).multiplyScalar(0.85);
  }

  /** Returns how far "inside" the camera is (0..1) for exposure dimming. */
  update(pose: Pose, features: Feature[]): number {
    let rows = 0;
    let lamps = 0;
    let pillars = 0;
    let inside = 0;
    const live = new Set<string>();
    const local = [0, 0, 0];
    const lampM = this.lamps.instanceMatrix.array as Float32Array;
    const pillarM = this.pillars.instanceMatrix.array as Float32Array;
    const writeMatrix = (arr: Float32Array, i: number, yaw: number, x: number, y: number, z: number, sy = 1) => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      arr.set([c, 0, -s, 0, 0, sy, 0, 0, s, 0, c, 0, x, y, z, 1], i * 16);
    };
    const sample = { s: 0, x: 0, z: 0, h: 0, e: 0 };

    for (const f of features) {
      if (f.kind !== 'tunnel' && f.kind !== 'gallery') continue;
      const end = Number.isFinite(f.s1) ? f.s1 : pose.d + VIEW;
      if (end < pose.d - 20 || f.s0 > pose.d + VIEW) continue;
      const openSide = f.side === 'left' ? -1 : 1;
      const prof = profile(f.kind, openSide);
      if (pose.d > f.s0 && pose.d < end) {
        const depth = Math.min(pose.d - f.s0, end - pose.d);
        inside = Math.max(inside, Math.min(1, depth / 40) * (f.kind === 'tunnel' ? 1 : 0.45));
      }
      const from = Math.max(f.s0, Math.floor((pose.d - 12) / STEP) * STEP);
      const to = Math.min(end, pose.d + VIEW);
      // Shell rows (one strip per tunnel; rows are appended to the shared buffer).
      const first = rows;
      for (let s = from; s <= to && rows < MAX_ROWS; s += STEP) {
        const c = this.path.sample(s, sample);
        const cos = Math.cos(c.h);
        const sin = Math.sin(c.h);
        for (let i = 0; i < 8; i++) {
          const [lat, hgt] = prof[i];
          toLocal(pose, c.x + cos * lat, c.e + hgt, c.z + sin * lat, this.pos, (rows * 8 + i) * 3);
        }
        rows++;
        const sLamp = Math.round(s / STEP);
        if (sLamp % 2 === 0 && lamps < MAX_LAMPS - 1) {
          for (const lat of f.kind === 'tunnel' ? [-3.4, 3.4] : [-openSide * 3]) {
            toLocal(pose, c.x + cos * lat, c.e + (f.kind === 'tunnel' ? 7.35 : 6.4), c.z + sin * lat, local, 0);
            writeMatrix(lampM, lamps++, -c.h + pose.h, local[0], local[1], local[2]);
          }
        }
        if (f.kind === 'gallery' && sLamp % 2 === 0 && pillars < MAX_PILLARS) {
          const lat = openSide * 7.2;
          toLocal(pose, c.x + cos * lat, c.e - 0.3, c.z + sin * lat, local, 0);
          writeMatrix(pillarM, pillars++, -c.h + pose.h, local[0], local[1], local[2], 6.8);
        }
      }
      // Collapse the seam between consecutive strips into degenerate triangles.
      if (rows > first && first > 0) {
        for (let i = 0; i < 8; i++) {
          const o = ((first - 1) * 8 + i) * 3;
          const n = (first * 8 + i) * 3;
          this.pos[o] = this.pos[n];
          this.pos[o + 1] = this.pos[n + 1];
          this.pos[o + 2] = this.pos[n + 2];
        }
      }
      // Portals at the entrance and (once known) the exit.
      for (const [key, s] of [
        [`${f.id}:in`, f.s0],
        [`${f.id}:out`, Number.isFinite(f.s1) ? f.s1 : NaN],
      ] as Array<[string, number]>) {
        if (!Number.isFinite(s) || s < pose.d - 30 || s > pose.d + VIEW) continue;
        live.add(key);
        let portal = this.portals.get(key);
        if (!portal) {
          portal = new Mesh(portalGeometry(f.kind, openSide), this.portalMat);
          portal.frustumCulled = false;
          this.portals.set(key, portal);
          this.group.add(portal);
        }
        const c = this.path.sample(s, sample);
        toLocal(pose, c.x, c.e, c.z, local, 0);
        portal.position.set(local[0], local[1], local[2]);
        portal.rotation.y = -c.h + pose.h;
      }
    }
    for (const [key, portal] of this.portals) {
      if (!live.has(key)) {
        this.group.remove(portal);
        portal.geometry.dispose();
        this.portals.delete(key);
      }
    }
    const geo = this.shell.geometry;
    geo.setDrawRange(0, Math.max(0, rows - 1) * 7 * 6);
    geo.attributes.position.needsUpdate = true;
    this.shell.visible = rows > 1;
    this.lamps.count = lamps;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.pillars.count = pillars;
    this.pillars.instanceMatrix.needsUpdate = true;
    return inside;
  }

  dispose(): void {
    this.shell.geometry.dispose();
    this.shell.material.dispose();
    this.lamps.geometry.dispose();
    (this.lamps.material as MeshBasicMaterial).dispose();
    this.pillars.geometry.dispose();
    (this.pillars.material as MeshLambertMaterial).dispose();
    for (const p of this.portals.values()) p.geometry.dispose();
    this.portalMat.dispose();
  }
}
