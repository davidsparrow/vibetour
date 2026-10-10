import { BoxGeometry, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial } from 'three';
import { merge } from './props';
import type { Glows } from './glows';
import { toLocal, type Pose } from './terrain';
import { inSpan, LANE, VIEW, type Feature, type RoadPath } from './world';

interface Car {
  s: number;
  speed: number;
  color: Color;
}

const MAX = 8;
const HEAD = new Color('#fff6dc');

/** Occasional oncoming traffic, so the road feels lived-in but never busy. */
export class Traffic {
  readonly mesh: InstancedMesh;
  private cars: Car[] = [];
  private nextAt = 8;
  private side = 1;
  private density = 1;
  private accents: Color[] = [new Color('#c7c7c7')];

  constructor(private readonly path: RoadPath) {
    const geo = merge([
      [new BoxGeometry(1.9, 0.75, 4.4).translate(0, 0.65, 0), '#ffffff'],
      [new BoxGeometry(1.7, 0.6, 2.4).translate(0, 1.3, 0.3), '#d8dde3'],
    ]);
    this.mesh = new InstancedMesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }), MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3).fill(1), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  configure(drivingSide: 'left' | 'right', accents: string[], density: number): void {
    this.side = drivingSide === 'right' ? 1 : -1;
    this.accents = [...accents, '#d9d9d9', '#2b2f36', '#8c1d1d', '#f0f0f0'].map((c) => new Color(c));
    this.cars = [];
    this.nextAt = density > 0 ? 4 : Infinity;
    this.density = density;
  }

  update(pose: Pose, dt: number, time: number, features: Feature[], night: number, glows: Glows, enabled: boolean): void {
    if (enabled && this.density > 0 && time > this.nextAt && this.cars.length < MAX) {
      this.cars.push({
        s: pose.d + VIEW - 40,
        speed: 14 + Math.random() * 8,
        color: this.accents[Math.floor(Math.random() * this.accents.length)],
      });
      this.nextAt = time + (14 + Math.random() * 40) / this.density;
    }
    this.cars = this.cars.filter((c) => c.s > pose.d - 30);
    const local = [0, 0, 0];
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const col = this.mesh.instanceColor!.array as Float32Array;
    let n = 0;
    const sample = { s: 0, x: 0, z: 0, h: 0, e: 0 };
    for (const car of this.cars) {
      car.s -= car.speed * dt;
      if (inSpan(features, ['tunnel', 'gallery'], car.s, 10)) continue;
      const c = this.path.sample(car.s, sample);
      const lat = -this.side * (LANE / 2);
      toLocal(pose, c.x + Math.cos(c.h) * lat, c.e, c.z + Math.sin(c.h) * lat, local, 0);
      // Oncoming: faces back towards the camera.
      const yaw = -c.h + pose.h + Math.PI;
      const cs = Math.cos(yaw);
      const sn = Math.sin(yaw);
      arr.set([cs, 0, -sn, 0, 0, 1, 0, 0, sn, 0, cs, 0, local[0], local[1], local[2], 1], n * 16);
      col.set([car.color.r, car.color.g, car.color.b], n * 3);
      n++;
      if (night > 0.05) {
        for (const dx of [-0.65, 0.65]) {
          // Headlights sit at the car's front, which points at the camera.
          glows.add(local[0] + dx * cs - 2.2 * sn, local[1] + 0.7, local[2] - dx * sn - 2.2 * cs, HEAD);
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.dispose();
  }
}
