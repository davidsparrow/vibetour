/**
 * Journey Pack manifest schema (PRD §35–§41, §79).
 *
 * V0/V1 packs are "Inspired Tours": procedurally rendered environments described
 * by parameters rather than footage. The same manifest carries the ticket,
 * route, scene graph and provenance metadata a footage-based pack would.
 */

export type PackType = 'scenic' | 'route' | 'landmark' | 'fantasy';
export type Authenticity = 'dream' | 'scenic' | 'route' | 'documentary';
export type TimeOfDay = 'dawn' | 'morning' | 'day' | 'golden' | 'sunset' | 'dusk' | 'night';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'fog' | 'snow';
export type Mood = 'warm' | 'mountains' | 'city-night' | 'ocean' | 'rain' | 'quiet' | 'fantasy';
export type TravelMode = 'drive' | 'fly' | 'rail' | 'sail' | 'walk' | 'orbit';

export type TerrainKind = 'ocean' | 'cliffs' | 'hills' | 'mountains' | 'flat' | 'city' | 'lake' | 'dunes';

export const PROP_KINDS = [
  'pine',
  'cypress',
  'broadleaf',
  'palm',
  'rock',
  'bush',
  'building',
  'neon',
  'streetlight',
  'vineyard',
  'farmhouse',
  'chalet',
  'stonewall',
  'sheep',
  'pole',
  'dome',
  'snowpole',
  'lantern',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

export const LANDMARK_KINDS = [
  'arch-bridge',
  'lighthouse',
  'lattice-tower',
  'suspension-bridge',
  'hill-town',
  'bell-tower',
  'waterfall',
  'castle',
  'dome-city',
  'chapel',
  'pagoda',
] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

export interface SideEnv {
  terrain: TerrainKind;
  /** Peak height in metres for hills/mountains/cliff drop. */
  height?: number;
}

export interface Palette {
  ground: string;
  groundFar: string;
  rock: string;
  snow: string;
  sand: string;
  road: string;
  roadLine: string;
  foliage: string;
  foliageDark: string;
  water: string;
  building: string;
  accents: string[];
}

export interface EnvParams {
  left?: SideEnv;
  right?: SideEnv;
  /** Instances per 100 m per side. */
  props?: Partial<Record<PropKind, number>>;
  landmark?: LandmarkKind | null;
  landmarkSide?: 'left' | 'right';
  /** 0 = straight, 1 = typical winding road. */
  curvature?: number;
  /** 0 = flat, 1 = rolling. */
  hilliness?: number;
  tunnel?: boolean;
  bridge?: boolean;
  /** How "tests running" is staged on this road (PRD §41). */
  checkpoint?: 'tunnel' | 'gallery' | 'straight';
  guardrail?: boolean;
  palette?: Partial<Palette>;
}

export type SceneKind = 'departure' | 'cruise' | 'landmark' | 'transition' | 'scenic' | 'arrival';

export interface SceneNode {
  kind: SceneKind;
  label: string;
  /** Relative share of the journey this scene occupies. */
  weight: number;
  env?: EnvParams;
  next?: string[];
}

export interface Variant {
  id: string;
  label: string;
  timeOfDay: TimeOfDay;
  /** Optional time of day reached at arrival ("the sun is setting"). */
  arrivalTimeOfDay?: TimeOfDay;
  weather: Weather;
  default?: boolean;
}

export interface Waypoint {
  name: string;
  /** Position along the journey 0..1. */
  at: number;
  /** Map coordinates, normalised 0..1. */
  x: number;
  y: number;
}

export interface ScenicStop {
  name: string;
  kind: 'overlook' | 'cafe' | 'beach' | 'village' | 'station' | 'hotel' | 'viewpoint' | 'rest-area';
}

export interface JourneyPack {
  id: string;
  version: string;
  title: string;
  subtitle: string;
  region: string;
  country: string;
  countryCode: string;
  continent: string;
  type: PackType;
  authenticity: Authenticity;
  travelMode: TravelMode;
  drivingSide: 'left' | 'right';
  description: string;
  tags: string[];
  moods: Mood[];
  /** Cruising speed in m/s for this road. */
  cruiseSpeed: number;
  route: {
    name: string;
    from: string;
    to: string;
    distanceLabel: string;
    waypoints: Waypoint[];
  };
  ticket: {
    priceLabel: string;
    original: boolean;
    badges: string[];
    approxMinutes: number;
  };
  variants: Variant[];
  palette: Palette;
  environment: EnvParams;
  sceneGraph: {
    start: string;
    nodes: Record<string, SceneNode>;
  };
  scenicStops: ScenicStop[];
  arrival: { name: string; scene: string };
  facts: string[];
  audio: { ambience: Array<'ocean' | 'city' | 'birds' | 'wind' | 'rain' | 'stream' | 'hum'> };
  provenance: {
    creator: string;
    generation: 'procedural' | 'ai-video' | 'captured';
    license: string;
    sources: string[];
  };
}

const TIMES: TimeOfDay[] = ['dawn', 'morning', 'day', 'golden', 'sunset', 'dusk', 'night'];
const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'fog', 'snow'];
const MOODS: Mood[] = ['warm', 'mountains', 'city-night', 'ocean', 'rain', 'quiet', 'fantasy'];
const TERRAINS: TerrainKind[] = ['ocean', 'cliffs', 'hills', 'mountains', 'flat', 'city', 'lake', 'dunes'];
const SCENE_KINDS: SceneKind[] = ['departure', 'cruise', 'landmark', 'transition', 'scenic', 'arrival'];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isColor(v: unknown): boolean {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}

function checkEnv(env: EnvParams | undefined, where: string, errors: string[]): void {
  if (!env) return;
  for (const side of ['left', 'right'] as const) {
    const s = env[side];
    if (s && !TERRAINS.includes(s.terrain)) errors.push(`${where}.${side}.terrain "${s.terrain}" is not a known terrain`);
  }
  if (env.props) {
    for (const [k, v] of Object.entries(env.props)) {
      if (!(PROP_KINDS as readonly string[]).includes(k)) errors.push(`${where}.props.${k} is not a known prop`);
      if (typeof v !== 'number' || v < 0 || v > 20) errors.push(`${where}.props.${k} must be a number 0..20`);
    }
  }
  if (env.checkpoint && !['tunnel', 'gallery', 'straight'].includes(env.checkpoint)) {
    errors.push(`${where}.checkpoint must be tunnel, gallery or straight`);
  }
  if (env.landmark && !(LANDMARK_KINDS as readonly string[]).includes(env.landmark)) {
    errors.push(`${where}.landmark "${env.landmark}" is not a known landmark`);
  }
  if (env.palette) {
    for (const [k, v] of Object.entries(env.palette)) {
      if (k === 'accents') continue;
      if (!isColor(v)) errors.push(`${where}.palette.${k} must be a #rrggbb colour`);
    }
  }
}

/** Validates an untrusted manifest. Used for built-in packs (tests) and imports. */
export function validatePack(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const p = raw as Partial<JourneyPack>;
  if (!p || typeof p !== 'object') return { ok: false, errors: ['manifest must be an object'] };
  for (const key of ['id', 'version', 'title', 'subtitle', 'region', 'country', 'countryCode', 'description'] as const) {
    if (typeof p[key] !== 'string' || !(p[key] as string).trim()) errors.push(`${key} is required`);
  }
  if (p.id && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(p.id)) errors.push('id must be kebab-case');
  if (typeof p.cruiseSpeed !== 'number' || p.cruiseSpeed < 5 || p.cruiseSpeed > 60) errors.push('cruiseSpeed must be 5..60 m/s');
  if (!Array.isArray(p.moods) || p.moods.some((m) => !MOODS.includes(m))) errors.push('moods must list known moods');
  if (!p.route || !Array.isArray(p.route.waypoints) || p.route.waypoints.length < 2) {
    errors.push('route.waypoints needs at least two entries');
  } else {
    let last = -1;
    for (const w of p.route.waypoints) {
      if (typeof w.at !== 'number' || w.at < 0 || w.at > 1 || w.at < last) errors.push(`waypoint "${w.name}" must be ordered 0..1`);
      last = w.at;
    }
  }
  if (!Array.isArray(p.variants) || p.variants.length === 0) {
    errors.push('at least one variant is required');
  } else {
    for (const v of p.variants) {
      if (!TIMES.includes(v.timeOfDay)) errors.push(`variant ${v.id}: unknown timeOfDay ${v.timeOfDay}`);
      if (v.arrivalTimeOfDay && !TIMES.includes(v.arrivalTimeOfDay)) errors.push(`variant ${v.id}: unknown arrivalTimeOfDay`);
      if (!WEATHERS.includes(v.weather)) errors.push(`variant ${v.id}: unknown weather ${v.weather}`);
    }
  }
  if (!p.palette) errors.push('palette is required');
  else {
    for (const [k, v] of Object.entries(p.palette)) {
      if (k === 'accents') {
        if (!Array.isArray(v) || v.length === 0 || v.some((c) => !isColor(c))) errors.push('palette.accents must be colours');
      } else if (!isColor(v)) errors.push(`palette.${k} must be a #rrggbb colour`);
    }
  }
  checkEnv(p.environment, 'environment', errors);
  if (!Array.isArray(p.scenicStops) || p.scenicStops.length === 0) errors.push('at least one scenic stop is required');
  const graph = p.sceneGraph;
  if (!graph || !graph.nodes || !graph.nodes[graph.start]) {
    errors.push('sceneGraph.start must reference a node');
  } else {
    const ids = Object.keys(graph.nodes);
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (!SCENE_KINDS.includes(node.kind)) errors.push(`scene ${id}: unknown kind ${node.kind}`);
      if (!(node.weight > 0)) errors.push(`scene ${id}: weight must be > 0`);
      for (const n of node.next ?? []) if (!ids.includes(n)) errors.push(`scene ${id}: next "${n}" does not exist`);
      if (node.kind !== 'arrival' && !(node.next && node.next.length)) errors.push(`scene ${id}: only arrival scenes may be terminal`);
      checkEnv(node.env, `scene ${id}.env`, errors);
    }
    // Every node reachable from start must be able to reach an arrival.
    const canArrive = new Map<string, boolean>();
    const visit = (id: string, stack: Set<string>): boolean => {
      if (canArrive.has(id)) return canArrive.get(id)!;
      const node = graph.nodes[id];
      if (node.kind === 'arrival') {
        canArrive.set(id, true);
        return true;
      }
      if (stack.has(id)) return false;
      stack.add(id);
      const ok = (node.next ?? []).some((n) => visit(n, stack));
      stack.delete(id);
      canArrive.set(id, ok);
      return ok;
    };
    if (!visit(graph.start, new Set())) errors.push('sceneGraph has no path from start to an arrival');
    if (!Object.values(graph.nodes).some((n) => n.kind === 'cruise')) errors.push('sceneGraph needs at least one cruise scene');
  }
  return { ok: errors.length === 0, errors };
}

export function defaultVariant(pack: JourneyPack): Variant {
  return pack.variants.find((v) => v.default) ?? pack.variants[0];
}

export function findVariant(pack: JourneyPack, id?: string): Variant {
  return pack.variants.find((v) => v.id === id) ?? defaultVariant(pack);
}

const TIME_HOURS: Record<TimeOfDay, number> = { dawn: 6, morning: 9, day: 13, golden: 17, sunset: 19, dusk: 20.5, night: 23 };

/** "Match my clock": the variant whose time of day is closest to the local hour. */
export function variantForHour(pack: JourneyPack, hour: number): Variant {
  const dist = (t: TimeOfDay) => {
    const d = Math.abs(TIME_HOURS[t] - hour);
    return Math.min(d, 24 - d);
  };
  return [...pack.variants].sort((a, b) => dist(a.timeOfDay) - dist(b.timeOfDay))[0];
}

/** Merges a scene's env over the pack's base environment. */
export function resolveEnv(pack: JourneyPack, node?: SceneNode): EnvParams {
  const base = pack.environment;
  const over = node?.env ?? {};
  return {
    ...base,
    ...over,
    props: over.props ? { ...over.props } : { ...(base.props ?? {}) },
    palette: { ...(base.palette ?? {}), ...(over.palette ?? {}) },
    left: over.left ?? base.left,
    right: over.right ?? base.right,
  };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Walks the scene graph from start to an arrival, choosing branches with a
 * seeded RNG so each trip can vary (PRD §40) while staying reproducible.
 */
export function planPath(pack: JourneyPack, seed: number): string[] {
  const rand = rng(seed);
  const { nodes, start } = pack.sceneGraph;
  const path: string[] = [];
  const visits = new Map<string, number>();
  let current: string | undefined = start;
  while (current && path.length < 48) {
    path.push(current);
    visits.set(current, (visits.get(current) ?? 0) + 1);
    const node: SceneNode = nodes[current];
    if (node.kind === 'arrival') break;
    const options = (node.next ?? []).filter((n) => (visits.get(n) ?? 0) < 2);
    const choices = options.length ? options : node.next ?? [];
    if (!choices.length) break;
    // Once the path is long, prefer moves that head towards an arrival.
    const towardArrival = choices.filter((n) => nodes[n].kind === 'arrival');
    current = path.length > 24 && towardArrival.length ? towardArrival[0] : choices[Math.floor(rand() * choices.length)];
  }
  const last = path[path.length - 1];
  if (!last || nodes[last].kind !== 'arrival') {
    const arrival = Object.entries(nodes).find(([, n]) => n.kind === 'arrival');
    if (arrival) path.push(arrival[0]);
  }
  return path;
}

export function packMoodMatches(pack: JourneyPack, mood: Mood | 'anywhere' | 'surprise'): boolean {
  if (mood === 'anywhere' || mood === 'surprise') return true;
  return pack.moods.includes(mood) || (mood === 'rain' && pack.variants.some((v) => v.weather === 'rain'));
}
