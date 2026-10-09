import type { EnvParams, JourneyPack, LandmarkKind, Palette, PropKind, SideEnv } from '../../core/packs';
import { PROP_KINDS } from '../../core/packs';
import { clamp, fbm, lerp, noise2, ridged, smoothstep } from './noise';

/**
 * Procedural world model: the road centreline, the environment schedule along
 * it, special features (bridges, tunnels, landmarks) and terrain heights.
 * Pure math — no three.js — so it can be unit tested.
 *
 * Distances are metres along the road (`s`). World coordinates use three.js
 * conventions: heading 0 travels towards −Z, +X is to the right.
 */

export const STEP = 4;
export const VIEW = 1000;
export const SEA_LEVEL = -30;
export const FAR_LEVEL = -4;
export const LANE = 3.6;
export const ROAD_HALF = 4.2;
export const ROAD_EDGE = 5.6;
const BLEND = 260;
const MAX_CURVATURE = 1 / 260;

export interface ResolvedEnv {
  left: Required<SideEnv>;
  right: Required<SideEnv>;
  props: Record<PropKind, number>;
  curvature: number;
  hilliness: number;
  guardrail: boolean;
  bridge: boolean;
  tunnel: boolean;
  landmark: LandmarkKind | null;
  landmarkSide: 'left' | 'right';
  checkpoint: 'tunnel' | 'gallery' | 'straight';
  sunAzimuth: number;
  palette: Palette;
}

const DEFAULT_HEIGHT: Record<SideEnv['terrain'], number> = {
  ocean: 0,
  cliffs: 40,
  hills: 40,
  mountains: 120,
  flat: 0,
  city: 0,
  lake: 40,
  dunes: 18,
};

export function resolveEnv(pack: JourneyPack, env: EnvParams): ResolvedEnv {
  const side = (s?: SideEnv): Required<SideEnv> => {
    const terrain = s?.terrain ?? 'hills';
    return { terrain, height: s?.height ?? DEFAULT_HEIGHT[terrain] };
  };
  const props = Object.fromEntries(PROP_KINDS.map((k) => [k, env.props?.[k] ?? 0])) as Record<PropKind, number>;
  return {
    left: side(env.left),
    right: side(env.right),
    props,
    curvature: env.curvature ?? 1,
    hilliness: env.hilliness ?? 0.5,
    guardrail: env.guardrail ?? false,
    bridge: env.bridge ?? false,
    tunnel: env.tunnel ?? false,
    landmark: env.landmark ?? null,
    landmarkSide: env.landmarkSide ?? 'left',
    checkpoint: env.checkpoint ?? pack.environment.checkpoint ?? 'tunnel',
    sunAzimuth: env.sunAzimuth ?? pack.environment.sunAzimuth ?? 35,
    palette: { ...pack.palette, ...(env.palette ?? {}) } as Palette,
  };
}

export type FeatureKind = 'bridge' | 'tunnel' | 'gallery' | 'landmark' | 'gantry';

export interface Feature {
  id: number;
  kind: FeatureKind;
  s0: number;
  s1: number;
  side?: 'left' | 'right';
  landmark?: LandmarkKind;
  /** Lateral offset for landmarks (metres from centreline, positive). */
  lateral?: number;
}

interface ScheduleEntry {
  s: number;
  key: string;
  env: ResolvedEnv;
}

export interface EnvBlend {
  a: ResolvedEnv;
  b: ResolvedEnv;
  w: number;
}

/** Environment changes keyed by distance, cross-faded over BLEND metres. */
export class EnvSchedule {
  private entries: ScheduleEntry[] = [];

  reset(env: ResolvedEnv, key: string, s = -1e9): void {
    this.entries = [{ s, key, env }];
  }

  get lastKey(): string | undefined {
    return this.entries[this.entries.length - 1]?.key;
  }

  get last(): ResolvedEnv {
    return this.entries[this.entries.length - 1].env;
  }

  push(s: number, env: ResolvedEnv, key: string): boolean {
    if (this.lastKey === key) return false;
    const last = this.entries[this.entries.length - 1];
    // Never schedule two changes inside one blend window.
    this.entries.push({ s: Math.max(s, last.s + BLEND), key, env });
    return true;
  }

  at(s: number): EnvBlend {
    const e = this.entries;
    let i = e.length - 1;
    while (i > 0 && e[i].s > s) i--;
    const cur = e[i];
    const prev = e[Math.max(0, i - 1)];
    if (i === 0) return { a: cur.env, b: cur.env, w: 1 };
    const w = smoothstep(cur.s, cur.s + BLEND, s);
    return { a: prev.env, b: cur.env, w };
  }

  /** True if any terrain in [s0, s1] is water on either side. */
  anyWater(s0: number, s1: number): boolean {
    const water = (env: ResolvedEnv) => isWater(env.left.terrain) || isWater(env.right.terrain) || env.bridge;
    for (let i = 0; i < this.entries.length; i++) {
      const start = this.entries[i].s;
      const end = i + 1 < this.entries.length ? this.entries[i + 1].s + BLEND : Infinity;
      if (end >= s0 && start <= s1 && water(this.entries[i].env)) return true;
    }
    return false;
  }

  prune(sMin: number): void {
    while (this.entries.length > 2 && this.entries[1].s + BLEND < sMin) this.entries.shift();
  }
}

export function isWater(t: SideEnv['terrain']): boolean {
  return t === 'ocean' || t === 'cliffs' || t === 'lake';
}

export interface RoadSample {
  s: number;
  x: number;
  z: number;
  /** Heading in radians, 0 = −Z. */
  h: number;
  /** Road elevation. */
  e: number;
}

/**
 * The road centreline, integrated incrementally from curvature so that it can
 * be extended forever while keeping its shape stable once computed.
 */
export class RoadPath {
  private samples: RoadSample[] = [];
  private k0 = 0;
  private readonly phase: number[];

  constructor(
    seed: number,
    private readonly schedule: EnvSchedule,
    private readonly features: () => Feature[],
  ) {
    const r = (n: number) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    this.phase = [0, 1, 2, 3, 4, 5].map((n) => r(n) * Math.PI * 2);
  }

  reset(s: number): void {
    const k = Math.floor(s / STEP);
    this.k0 = k;
    this.samples = [{ s: k * STEP, x: 0, z: 0, h: 0, e: this.elevation(k * STEP) }];
  }

  get computedUntil(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].s : 0;
  }

  get computedFrom(): number {
    return this.samples.length ? this.samples[0].s : 0;
  }

  private flatten(s: number): number {
    let f = 0;
    for (const feat of this.features()) {
      if (feat.kind !== 'bridge') continue;
      f = Math.max(f, smoothstep(feat.s0 - 120, feat.s0, s) * (1 - smoothstep(feat.s1, feat.s1 + 120, s)));
    }
    return f;
  }

  curvature(s: number, h: number): number {
    const { a, b, w } = this.schedule.at(s);
    const c = lerp(a.curvature, b.curvature, w) * (1 - this.flatten(s));
    const p = this.phase;
    let k =
      c *
      ((0.32 / 190) * Math.cos(s / 190 + p[0]) + (0.16 / 73) * Math.cos(s / 73 + p[1]) + (0.05 / 29) * Math.cos(s / 29 + p[2]));
    k -= h / 4000; // gently restore the overall heading
    return clamp(k, -MAX_CURVATURE, MAX_CURVATURE);
  }

  private rawElevation(s: number): number {
    const { a, b, w } = this.schedule.at(s);
    const hill = lerp(a.hilliness, b.hilliness, w);
    const p = this.phase;
    return 6 + hill * (9 * Math.sin(s / 260 + p[3]) + 4 * Math.sin(s / 97 + p[4]) + 1.5 * Math.sin(s / 41 + p[5]));
  }

  /** Road elevation; level across bridge spans so bridge models sit flush. */
  elevation(s: number): number {
    const raw = this.rawElevation(s);
    for (const feat of this.features()) {
      if (feat.kind !== 'bridge') continue;
      const f = smoothstep(feat.s0 - 140, feat.s0, s) * (1 - smoothstep(feat.s1, feat.s1 + 140, s));
      if (f > 0) return lerp(raw, this.rawElevation((feat.s0 + feat.s1) / 2), f);
    }
    return raw;
  }

  /** Extends the path to at least sMax. */
  ensure(sMax: number): void {
    if (!this.samples.length) this.reset(0);
    let last = this.samples[this.samples.length - 1];
    while (last.s < sMax) {
      const s = last.s + STEP;
      const k = this.curvature(last.s + STEP / 2, last.h);
      const hMid = last.h + (k * STEP) / 2;
      const next: RoadSample = {
        s,
        x: last.x + Math.sin(hMid) * STEP,
        z: last.z - Math.cos(hMid) * STEP,
        h: last.h + k * STEP,
        e: this.elevation(s),
      };
      this.samples.push(next);
      last = next;
    }
  }

  prune(sMin: number): void {
    const drop = Math.floor((sMin - this.computedFrom) / STEP);
    if (drop > 64) {
      this.samples.splice(0, drop);
      this.k0 += drop;
    }
  }

  /** Interpolated centreline sample at distance s (clamped to computed range). */
  sample(s: number, out: RoadSample = { s: 0, x: 0, z: 0, h: 0, e: 0 }): RoadSample {
    const n = this.samples.length;
    const f = (s - this.samples[0].s) / STEP;
    const i = clamp(Math.floor(f), 0, n - 2);
    const t = clamp(f - i, 0, 1);
    const a = this.samples[i];
    const b = this.samples[i + 1] ?? a;
    out.s = s;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.h = a.h + (b.h - a.h) * t;
    out.e = a.e + (b.e - a.e) * t;
    return out;
  }

  /** World position of a point `lat` metres to the right of the centreline. */
  offset(s: number, lat: number, out: { x: number; z: number; h: number; e: number }): void {
    const c = this.sample(s);
    out.x = c.x + Math.cos(c.h) * lat;
    out.z = c.z + Math.sin(c.h) * lat;
    out.h = c.h;
    out.e = c.e;
  }
}

/** Absolute terrain height for one side of the road. `lat` ≥ 0 from centreline. */
export function sideHeight(side: Required<SideEnv>, s: number, lat: number, e: number, seed: number): number {
  const t = lat - ROAD_EDGE;
  const base = e - 0.35;
  if (t <= 0) return base;
  const H = side.height;
  switch (side.terrain) {
    case 'flat':
      return base + smoothstep(0, 40, t) * (fbm(s / 90 + seed, lat / 90) - 0.45) * 5;
    case 'city':
      return base + smoothstep(0, 4, t) * 0.15;
    case 'hills': {
      const r = smoothstep(1, 95, t);
      const n = fbm(s / 170 + seed, lat / 150, 3);
      return base + r * H * (0.3 + 0.85 * n);
    }
    case 'mountains': {
      const r = smoothstep(6, 170, t);
      const n = ridged(s / 280 + seed, lat / 230, 4);
      return base + r * H * (0.25 + 0.95 * n) + smoothstep(110, 220, t) * H * 0.35;
    }
    case 'dunes': {
      const r = smoothstep(4, 90, t);
      const crest = Math.sin(s / 70 + lat / 38 + fbm(s / 160 + seed, lat / 140) * 6);
      const n = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * crest, 1.6);
      return base + r * H * n + fbm(s / 40, lat / 40 + seed) * 2;
    }
    case 'cliffs': {
      const verge = 3 + fbm(s / 70 + seed, 3.1) * 9;
      const drop = smoothstep(verge, verge + 10 + H * 0.25, t);
      const top = base + (fbm(s / 40, lat / 30 + seed) - 0.5) * 1.6;
      const bottom = SEA_LEVEL - 6 - fbm(s / 80 + seed, lat / 60) * 12;
      const face = (noise2(s / 9, lat / 7 + seed) - 0.5) * 6 * drop * (1 - drop) * 4;
      // Sea stacks beyond the cliff foot.
      const stack = Math.max(0, ridged(s / 60 + seed, lat / 60) - 0.78) * 160 * smoothstep(60, 90, t);
      return lerp(top, bottom, drop) + face + stack;
    }
    case 'ocean': {
      const slope = smoothstep(1, 55, t);
      let y = lerp(base, SEA_LEVEL + 0.6, slope);
      y = lerp(y, SEA_LEVEL - 14, smoothstep(65, 130, t));
      return y + (fbm(s / 30 + seed, lat / 30) - 0.5) * 1.2 * (1 - slope * 0.5);
    }
    case 'lake': {
      const slope = smoothstep(1, 40, t);
      let y = lerp(base, SEA_LEVEL - 6, slope);
      const farShore = smoothstep(150, 225, t);
      y = lerp(y, base + H * (0.5 + 0.6 * fbm(s / 200 + seed, 7.7)), farShore);
      return y;
    }
  }
}

/** Blended absolute terrain height at (s, signed lateral offset). */
export function terrainHeight(blend: EnvBlend, s: number, latSigned: number, e: number, seed: number): number {
  const lat = Math.abs(latSigned);
  const key = latSigned < 0 ? 'left' : 'right';
  const sideSeed = seed + (latSigned < 0 ? 17.3 : 0);
  const ha = sideHeight(blend.a[key], s, lat, e, sideSeed);
  if (blend.w >= 1 || blend.a === blend.b) return blend.w >= 1 ? sideHeight(blend.b[key], s, lat, e, sideSeed) : ha;
  const hb = sideHeight(blend.b[key], s, lat, e, sideSeed);
  return lerp(ha, hb, blend.w);
}

/** Depth factor 0..1 for a canyon under a bridge span. */
export function canyonFactor(features: Feature[], s: number): number {
  let f = 0;
  for (const feat of features) {
    if (feat.kind !== 'bridge') continue;
    f = Math.max(f, smoothstep(feat.s0 - 10, feat.s0 + 35, s) * (1 - smoothstep(feat.s1 - 35, feat.s1 + 10, s)));
  }
  return f;
}

export function inSpan(features: Feature[], kind: FeatureKind | FeatureKind[], s: number, margin = 0): Feature | undefined {
  const kinds = Array.isArray(kind) ? kind : [kind];
  return features.find((f) => kinds.includes(f.kind) && s >= f.s0 - margin && s <= f.s1 + margin);
}
