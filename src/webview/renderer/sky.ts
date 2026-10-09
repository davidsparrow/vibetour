import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Lighting } from './lighting';
import { fbm, ridged, smoothstep } from './noise';

const GLSL_HASH = /* glsl */ `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p *= 2.02; a *= 0.5; } return s; }
`;

/** Gradient sky with sun/moon, procedural clouds and stars. */
export class SkyDome {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uSun: { value: new Color() },
        uSunDir: { value: new Vector3(0, 0.2, -1).normalize() },
        uSunSize: { value: 0.0009 },
        uStars: { value: 0 },
        uClouds: { value: 0.3 },
        uNight: { value: 0 },
        uTime: { value: 0 },
        uOffset: { value: new Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDir;
        uniform float uSunSize; uniform float uStars; uniform float uClouds; uniform float uNight; uniform float uTime;
        uniform vec3 uOffset;
        varying vec3 vDir;
        ${GLSL_HASH}
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
          if (h < 0.0) col = mix(uHorizon, uHorizon * 0.7, clamp(-h * 3.0, 0.0, 1.0));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
          col += uSun * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.45) * sunUp * (1.0 - uNight * 0.7);
          float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.5, sd) * smoothstep(-0.04, 0.0, h);
          col = mix(col, uSun * 2.2 + vec3(0.25), disc * sunUp);
          if (uStars > 0.0 && h > 0.0) {
            vec2 sp = floor(vec2(atan(d.x, d.z) * 260.0, h * 420.0));
            float n = hash12(sp);
            float tw = 0.65 + 0.35 * sin(uTime * 1.7 + n * 60.0);
            col += vec3(step(0.998, n) * uStars * smoothstep(0.02, 0.3, h) * tw) * (1.0 - uClouds * 0.6);
          }
          if (h > 0.0 && uClouds > 0.0) {
            vec2 uv = d.xz / (h + 0.15) * 1.6 + uOffset.xz * 0.00008 + vec2(uTime * 0.003, 0.0);
            float c = fbm2(uv);
            float thr = 0.72 - uClouds * 0.34;
            float cover = smoothstep(thr, thr + 0.16, c) * smoothstep(0.0, 0.18, h);
            vec3 lit = mix(uHorizon, vec3(1.0), 0.25 * (1.0 - uNight)) + uSun * 0.12 * sunUp;
            vec3 cloud = mix(lit, uTop * 0.7, smoothstep(0.55, 0.95, c) * 0.45);
            col = mix(col, cloud, cover * 0.6);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(3000, 48, 24), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(l: Lighting, sunDir: Vector3, time: number, travel: number): void {
    const u = this.material.uniforms;
    (u.uTop.value as Color).copy(l.skyTop);
    (u.uHorizon.value as Color).copy(l.skyHorizon);
    (u.uSun.value as Color).copy(l.sun);
    (u.uSunDir.value as Vector3).copy(sunDir);
    u.uSunSize.value = l.night > 0.6 ? 0.00035 : 0.0009;
    u.uStars.value = l.stars;
    u.uClouds.value = l.clouds;
    u.uNight.value = l.night;
    u.uTime.value = time;
    (u.uOffset.value as Vector3).set(0, 0, -travel);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

export type BackdropKind = 'mountains' | 'hills' | 'skyline' | 'none';

interface RingSpec {
  radius: number;
  scale: number;
  haze: number;
}

/**
 * Distant silhouettes (mountain ranges, hills, skylines) drawn as rings
 * around the camera, always fog-free but tinted with atmospheric haze.
 */
export class Backdrop {
  readonly group = new Group();
  private rings: Array<Mesh<BufferGeometry, ShaderMaterial>> = [];
  private fading: Array<Mesh<BufferGeometry, ShaderMaterial>> = [];
  private key = '';
  private fade = 1;

  setKinds(left: BackdropKind, right: BackdropKind, seed: number, color: Color): void {
    const key = `${left}|${right}|${seed}`;
    if (key === this.key) return;
    this.key = key;
    for (const r of this.fading) this.disposeRing(r);
    this.fading = this.rings;
    this.rings = [];
    const specs: RingSpec[] = [
      { radius: 2500, scale: 1.6, haze: 0.62 },
      { radius: 1500, scale: 0.9, haze: 0.42 },
    ];
    for (const spec of specs) {
      const ring = this.buildRing(left, right, seed + spec.radius, spec, color);
      if (ring) {
        this.rings.push(ring);
        this.group.add(ring);
      }
    }
    this.fade = this.fading.length ? 0 : 1;
  }

  private buildRing(left: BackdropKind, right: BackdropKind, seed: number, spec: RingSpec, color: Color) {
    if (left === 'none' && right === 'none') return undefined;
    const N = 360;
    const pos = new Float32Array((N + 1) * 2 * 3);
    const t = new Float32Array((N + 1) * 2);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const heightFor = (kind: BackdropKind, a: number) => {
      const x = a * 6;
      switch (kind) {
        case 'mountains':
          return (60 + ridged(x + seed, 1.3, 4) * 260 + fbm(x * 3 + seed, 2.1) * 40) * spec.scale;
        case 'hills':
          return (18 + fbm(x * 1.4 + seed, 4.2, 3) * 70) * spec.scale;
        case 'skyline': {
          const block = Math.floor(a * 900);
          const r = Math.abs(Math.sin(block * 12.9898 + seed) * 43758.5453) % 1;
          return (20 + r * r * 140 + (r > 0.92 ? 120 : 0)) * spec.scale;
        }
        case 'none':
          return -40;
      }
    };
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const side = Math.sin(a);
      const wRight = smoothstep(-0.3, 0.3, side);
      const hl = heightFor(left, i / N);
      const hr = heightFor(right, i / N);
      const h = hl + (hr - hl) * wRight;
      const x = Math.sin(a) * spec.radius;
      const z = -Math.cos(a) * spec.radius;
      const o = i * 6;
      pos.set([x, -120, z, x, Math.max(-60, h), z], o);
      t.set([0, 1], i * 2);
      uv.set([i / N, 0, i / N, Math.max(0, h) / 4], i * 4);
    }
    const index: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aT', new BufferAttribute(t, 1));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(index);
    const city = left === 'skyline' || right === 'skyline';
    const mat = new ShaderMaterial({
      fog: false,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: color.clone() },
        uHaze: { value: new Color() },
        uHazeAmt: { value: spec.haze },
        uWindows: { value: 0 },
        uCity: { value: city ? 1 : 0 },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aT; varying float vT; varying vec2 vUv;
        void main() { vT = aT; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uHaze; uniform float uHazeAmt; uniform float uWindows; uniform float uCity; uniform float uOpacity;
        varying float vT; varying vec2 vUv;
        ${GLSL_HASH}
        void main() {
          vec3 c = mix(uColor, uHaze, clamp(uHazeAmt + (1.0 - vT) * 0.35, 0.0, 1.0));
          if (uCity > 0.5 && uWindows > 0.0) {
            vec2 g = floor(vec2(vUv.x * 2600.0, vUv.y));
            float r = hash12(g);
            float lit = step(0.86, r) * step(1.0, vUv.y);
            c += vec3(1.0, 0.78, 0.5) * lit * uWindows * 0.9;
          }
          gl_FragColor = vec4(c, uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -5;
    return mesh;
  }

  update(dt: number, heading: number, camY: number, haze: Color, night: number, baseColor: Color): void {
    this.group.rotation.y = heading;
    this.group.position.y = -camY;
    this.fade = Math.min(1, this.fade + dt / 4);
    for (const r of this.rings) {
      const u = r.material.uniforms;
      (u.uHaze.value as Color).copy(haze);
      (u.uColor.value as Color).copy(baseColor);
      u.uWindows.value = night;
      u.uOpacity.value = this.fade;
    }
    for (const r of this.fading) {
      r.material.uniforms.uOpacity.value = 1 - this.fade;
      (r.material.uniforms.uHaze.value as Color).copy(haze);
    }
    if (this.fade >= 1 && this.fading.length) {
      for (const r of this.fading) this.disposeRing(r);
      this.fading = [];
    }
  }

  private disposeRing(r: Mesh<BufferGeometry, ShaderMaterial>): void {
    this.group.remove(r);
    r.geometry.dispose();
    r.material.dispose();
  }

  dispose(): void {
    for (const r of [...this.rings, ...this.fading]) this.disposeRing(r);
    this.rings = [];
    this.fading = [];
  }
}
