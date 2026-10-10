import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
} from 'three';
import type { Weather } from '../../core/packs';

const RAIN = 1800;
const SNOW = 1400;
const BOX = { x: 45, y: 26, zNear: 12, zFar: -70 };

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function flakeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/** Camera-relative rain streaks and snowfall. */
export class WeatherFx {
  readonly group = new Group();
  private readonly rain: LineSegments<BufferGeometry, LineBasicMaterial>;
  private readonly snow: Points<BufferGeometry, PointsMaterial>;
  private readonly drops: Float32Array;
  private readonly flakes: Float32Array;
  private readonly rainPos: Float32Array;
  private kind: Weather = 'clear';
  private intensity = 1;

  constructor() {
    this.drops = new Float32Array(RAIN * 3);
    this.rainPos = new Float32Array(RAIN * 6);
    for (let i = 0; i < RAIN; i++) this.drops.set([rand(-BOX.x, BOX.x), rand(0, BOX.y), rand(BOX.zFar, BOX.zNear)], i * 3);
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(this.rainPos, 3).setUsage(DynamicDrawUsage));
    this.rain = new LineSegments(rg, new LineBasicMaterial({ color: '#c9d4e2', transparent: true, opacity: 0.32, fog: false }));
    this.rain.frustumCulled = false;

    this.flakes = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW; i++) this.flakes.set([rand(-BOX.x, BOX.x), rand(0, BOX.y), rand(BOX.zFar, BOX.zNear)], i * 3);
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(this.flakes, 3).setUsage(DynamicDrawUsage));
    this.snow = new Points(
      sg,
      new PointsMaterial({ size: 0.22, map: flakeTexture(), transparent: true, depthWrite: false, opacity: 0.9, fog: false }),
    );
    this.snow.frustumCulled = false;
    this.group.add(this.rain, this.snow);
  }

  set(kind: Weather, intensity: number): void {
    this.kind = kind;
    this.intensity = intensity;
  }

  update(dt: number, speed: number, time: number, sheltered: number): void {
    const rainOn = this.kind === 'rain' && this.intensity > 0;
    const snowOn = this.kind === 'snow' && this.intensity > 0;
    this.rain.visible = rainOn && sheltered < 0.9;
    this.snow.visible = snowOn && sheltered < 0.9;
    const wrap = (arr: Float32Array, i: number) => {
      const o = i * 3;
      if (arr[o + 1] < -2) {
        arr[o] = rand(-BOX.x, BOX.x);
        arr[o + 1] = BOX.y;
        arr[o + 2] = rand(BOX.zFar, BOX.zNear);
      }
      if (arr[o + 2] > BOX.zNear) {
        arr[o + 2] = BOX.zFar;
        arr[o] = rand(-BOX.x, BOX.x);
      }
    };
    if (this.rain.visible) {
      const count = Math.floor(RAIN * this.intensity);
      const fall = 22;
      for (let i = 0; i < RAIN; i++) {
        const o = i * 3;
        this.drops[o + 1] -= fall * dt;
        this.drops[o + 2] += speed * dt;
        wrap(this.drops, i);
        const p = i * 6;
        if (i >= count) {
          this.rainPos.fill(0, p, p + 6);
          continue;
        }
        this.rainPos[p] = this.drops[o];
        this.rainPos[p + 1] = this.drops[o + 1];
        this.rainPos[p + 2] = this.drops[o + 2];
        this.rainPos[p + 3] = this.drops[o];
        this.rainPos[p + 4] = this.drops[o + 1] + fall * 0.045;
        this.rainPos[p + 5] = this.drops[o + 2] - speed * 0.045;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.material.opacity = 0.32 * (1 - sheltered);
    }
    if (this.snow.visible) {
      for (let i = 0; i < SNOW; i++) {
        const o = i * 3;
        this.flakes[o] += Math.sin(time * 0.8 + i) * 0.4 * dt;
        this.flakes[o + 1] -= (1.4 + (i % 7) * 0.12) * dt;
        this.flakes[o + 2] += speed * dt;
        wrap(this.flakes, i);
      }
      this.snow.geometry.setDrawRange(0, Math.floor(SNOW * this.intensity));
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.material.opacity = 0.9 * (1 - sheltered);
    }
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.snow.geometry.dispose();
    this.snow.material.map?.dispose();
    this.snow.material.dispose();
  }
}
