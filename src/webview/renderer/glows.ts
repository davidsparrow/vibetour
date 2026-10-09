import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  Points,
  PointsMaterial,
} from 'three';

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

class Layer {
  readonly points: Points<BufferGeometry, PointsMaterial>;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  n = 0;

  constructor(
    private readonly capacity: number,
    size: number,
    tex: CanvasTexture,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage));
    this.points = new Points(
      geo,
      new PointsMaterial({
        size,
        map: tex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  add(x: number, y: number, z: number, c: Color, k: number): void {
    if (this.n >= this.capacity) return;
    const o = this.n * 3;
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
    this.col[o] = c.r * k;
    this.col[o + 1] = c.g * k;
    this.col[o + 2] = c.b * k;
    this.n++;
  }

  commit(opacity: number): void {
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    this.points.material.opacity = opacity;
    this.points.visible = this.n > 0 && opacity > 0.01;
  }
}

/** Additive light halos for lamps, windows and headlights at night. */
export class Glows {
  readonly group = new Group();
  private readonly tex = glowTexture();
  private readonly small = new Layer(900, 2.6, this.tex);
  private readonly big = new Layer(200, 14, this.tex);
  private fogFar = 880;

  constructor() {
    this.group.add(this.small.points, this.big.points);
  }

  begin(fogFar: number): void {
    this.small.n = 0;
    this.big.n = 0;
    this.fogFar = fogFar;
  }

  add(x: number, y: number, z: number, color: Color, big = false): void {
    // Manual fade with distance since additive points ignore fog.
    const dist = Math.hypot(x, y, z);
    const k = Math.max(0, 1 - dist / (this.fogFar * 1.1));
    if (k <= 0) return;
    (big ? this.big : this.small).add(x, y, z, color, k);
  }

  commit(opacity: number): void {
    this.small.commit(opacity);
    this.big.commit(opacity);
  }

  dispose(): void {
    this.tex.dispose();
    for (const l of [this.small, this.big]) {
      l.points.geometry.dispose();
      l.points.material.dispose();
    }
  }
}
