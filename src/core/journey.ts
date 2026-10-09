import type { ActivityState } from './activity';
import type { JourneyPhase } from './motion';
import { findVariant, planPath, resolveEnv, type EnvParams, type JourneyPack, type SceneKind, type SceneNode } from './packs';
import { emptyCounters, type SessionCounters } from './workspace';

/**
 * Journey Engine (PRD §11, §38, §40). Progress is intentionally abstract
 * (PRD §22): it accrues with productive time, never with keystrokes or lines,
 * and it holds at the final approach until the journey's objective is
 * actually complete (PRD §4.5).
 */

export type ScopeId = 'coffee-run' | 'day-trip' | 'scenic-drive' | 'road-trip' | 'expedition' | 'free-drive';

export interface ScopeInfo {
  id: ScopeId;
  label: string;
  range: string;
  blurb: string;
  /** Productive minutes to reach the final approach. null = no destination. */
  nominalMinutes: number | null;
  multiSession: boolean;
}

export const SCOPES: ScopeInfo[] = [
  { id: 'coffee-run', label: 'Coffee Run', range: '15–30 min', blurb: 'A quick fix or small task', nominalMinutes: 25, multiSession: false },
  { id: 'day-trip', label: 'Day Trip', range: '45–90 min', blurb: 'One focused coding session', nominalMinutes: 70, multiSession: false },
  { id: 'scenic-drive', label: 'Scenic Drive', range: '1–3 hours', blurb: 'A feature, start to finish', nominalMinutes: 140, multiSession: false },
  { id: 'road-trip', label: 'Road Trip', range: 'Several sessions', blurb: 'A larger feature over a few sittings', nominalMinutes: 6 * 60, multiSession: true },
  { id: 'expedition', label: 'Expedition', range: 'Multi-day project', blurb: 'A milestone or project phase', nominalMinutes: 24 * 60, multiSession: true },
  { id: 'free-drive', label: 'Free Drive', range: 'No destination', blurb: 'Ambient travel while you code', nominalMinutes: null, multiSession: true },
];

export function scopeInfo(id: ScopeId): ScopeInfo {
  return SCOPES.find((s) => s.id === id) ?? SCOPES[1];
}

/** Progress is held here until the objective is complete. */
export const APPROACH_CAP = 0.92;
/** Travel time spent on the final approach once the objective is complete. */
export const APPROACH_MS = 90_000;
const DEPARTURE_MS = 45_000;
const EXTENDED_SCENE_MS = 4 * 60_000;
const FREE_SCENE_MS = 5 * 60_000;

/** Momentum per activity state: abstract, generous to thinking (PRD §4.4). */
const MOMENTUM: Partial<Record<ActivityState, number>> = {
  ACTIVE: 1,
  AGENT_ACTIVE: 1,
  VERIFYING: 1,
  THINKING: 0.75,
};

export interface JourneyStats extends SessionCounters {
  files: string[];
  activeMs: number;
  agentMs: number;
}

export function emptyStats(): JourneyStats {
  return { ...emptyCounters(), files: [], activeMs: 0, agentMs: 0 };
}

export interface JourneyRecord {
  id: string;
  packId: string;
  variantId: string;
  scope: ScopeId;
  objective?: string;
  project?: string;
  seed: number;
  createdAt: number;
  lastActiveAt: number;
  progress: number;
  productiveMs: number;
  travelMs: number;
  sessions: number;
  phase: JourneyPhase;
  /** Phase to restore after a park. */
  resumePhase?: JourneyPhase;
  extendedAtTravelMs?: number;
  approachFrom?: number;
  completedAt?: number;
  arrivedAt?: number;
  path: string[];
  stats: JourneyStats;
}

export interface SceneInfo {
  id: string;
  index: number;
  kind: SceneKind;
  label: string;
  env: EnvParams;
}

export interface LocationInfo {
  label: string;
  /** Index of the last waypoint passed. */
  waypointIndex: number;
  next?: string;
}

const MAX_FILES = 2_000;

export class JourneyEngine {
  constructor(
    public readonly record: JourneyRecord,
    public readonly pack: JourneyPack,
  ) {}

  static create(
    pack: JourneyPack,
    opts: { id: string; scope: ScopeId; variantId?: string; objective?: string; project?: string; now: number; seed?: number },
  ): JourneyEngine {
    const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    const variant = findVariant(pack, opts.variantId);
    const record: JourneyRecord = {
      id: opts.id,
      packId: pack.id,
      variantId: variant.id,
      scope: opts.scope,
      objective: opts.objective?.trim() || undefined,
      project: opts.project,
      seed,
      createdAt: opts.now,
      lastActiveAt: opts.now,
      progress: 0,
      productiveMs: 0,
      travelMs: 0,
      sessions: 1,
      phase: 'departing',
      path: planPath(pack, seed),
      stats: emptyStats(),
    };
    return new JourneyEngine(record, pack);
  }

  get phase(): JourneyPhase {
    return this.record.phase;
  }

  get isFreeDrive(): boolean {
    return this.record.scope === 'free-drive';
  }

  get moving(): boolean {
    const p = this.record.phase;
    return p === 'departing' || p === 'cruising' || p === 'extended' || p === 'final-approach';
  }

  /**
   * Advance the journey. `basis` is the activity state (WARNING resolved to its
   * basis); `moving` says whether the vehicle is currently travelling.
   */
  tick(dtMs: number, basis: ActivityState, moving: boolean, now: number): void {
    const r = this.record;
    if (dtMs <= 0 || !this.moving) return;
    const momentum = MOMENTUM[basis] ?? 0;
    if (momentum > 0) {
      r.productiveMs += dtMs * momentum;
      r.lastActiveAt = now;
    }
    if (basis === 'ACTIVE' || basis === 'VERIFYING') r.stats.activeMs += dtMs;
    if (basis === 'AGENT_ACTIVE') r.stats.agentMs += dtMs;
    if (moving) r.travelMs += dtMs;

    if (r.phase === 'final-approach') {
      if (moving) {
        const from = r.approachFrom ?? r.progress;
        r.progress = Math.min(1, r.progress + ((1 - from) * dtMs) / APPROACH_MS);
      }
      if (r.progress >= 1) {
        r.progress = 1;
        r.phase = 'arrived';
        r.arrivedAt = now;
      }
      return;
    }
    if (r.phase === 'departing' && r.travelMs >= DEPARTURE_MS) r.phase = 'cruising';
    const nominal = scopeInfo(r.scope).nominalMinutes;
    if (nominal === null) return;
    if (momentum > 0) {
      r.progress = Math.min(APPROACH_CAP, r.progress + (dtMs * momentum) / (nominal * 60_000) * APPROACH_CAP);
    }
    if (r.progress >= APPROACH_CAP && r.phase !== 'extended') {
      r.phase = 'extended';
      r.extendedAtTravelMs = r.travelMs;
    }
  }

  /** The journey's objective is done: begin the final approach (PRD §10). */
  completeObjective(now: number): boolean {
    const r = this.record;
    if (r.phase === 'arrived' || r.phase === 'staying' || r.phase === 'final-approach') return false;
    if (r.phase === 'parked') r.sessions += 1;
    r.phase = 'final-approach';
    r.approachFrom = r.progress;
    r.completedAt = now;
    r.lastActiveAt = now;
    return true;
  }

  park(now: number): void {
    const r = this.record;
    if (r.phase === 'parked') return;
    r.resumePhase = r.phase;
    r.phase = 'parked';
    r.lastActiveAt = now;
  }

  resume(now: number): void {
    const r = this.record;
    if (r.phase !== 'parked') return;
    r.phase = r.resumePhase && r.resumePhase !== 'parked' ? r.resumePhase : 'cruising';
    r.resumePhase = undefined;
    r.sessions += 1;
    r.lastActiveAt = now;
  }

  stay(now: number): void {
    if (this.record.phase === 'arrived') {
      this.record.phase = 'staying';
      this.record.lastActiveAt = now;
    }
  }

  recordFile(path: string): void {
    const files = this.record.stats.files;
    if (files.length < MAX_FILES && !files.includes(path)) files.push(path);
  }

  recordCounter(key: keyof SessionCounters): void {
    this.record.stats[key]++;
  }

  scene(): SceneInfo {
    const r = this.record;
    const nodes = this.pack.sceneGraph.nodes;
    const path = r.path;
    const make = (index: number): SceneInfo => {
      const id = path[Math.max(0, Math.min(path.length - 1, index))];
      const node: SceneNode = nodes[id];
      return { id, index, kind: node.kind, label: node.label, env: resolveEnv(this.pack, node) };
    };
    const arrivalIndex = path.length - 1;
    if (r.phase === 'final-approach' || r.phase === 'arrived' || r.phase === 'staying') return make(arrivalIndex);

    const body = path.slice(0, arrivalIndex);
    if (this.isFreeDrive || r.phase === 'extended') {
      // Keep the scenery varied while the journey stretches (PRD §38).
      const loop = body
        .map((id, index) => ({ id, index }))
        .filter(({ id }) => nodes[id].kind !== 'departure');
      if (!loop.length) return make(0);
      if (this.isFreeDrive && r.travelMs < FREE_SCENE_MS * nodes[path[0]].weight) return make(0);
      const unit = this.isFreeDrive ? FREE_SCENE_MS : EXTENDED_SCENE_MS;
      const t = this.isFreeDrive ? r.travelMs : r.travelMs - (r.extendedAtTravelMs ?? r.travelMs);
      const extendedLoop = this.isFreeDrive ? loop : loop.filter(({ id }) => nodes[id].kind !== 'transition');
      const pick = extendedLoop.length ? extendedLoop : loop;
      return make(pick[Math.floor(t / unit) % pick.length].index);
    }

    const weights = body.map((id) => nodes[id].weight);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const target = (r.progress / APPROACH_CAP) * total;
    let acc = 0;
    for (let i = 0; i < body.length; i++) {
      acc += weights[i];
      if (target < acc) return make(i);
    }
    return make(Math.max(0, body.length - 1));
  }

  location(): LocationInfo {
    const wps = this.pack.route.waypoints;
    const r = this.record;
    if (this.isFreeDrive && (r.phase === 'departing' || r.phase === 'cruising' || r.phase === 'extended' || r.phase === 'parked')) {
      return { label: `Free drive · ${this.pack.route.name}`, waypointIndex: 0 };
    }
    if (r.phase === 'arrived' || r.phase === 'staying') {
      return { label: `Arrived in ${this.pack.route.to}`, waypointIndex: wps.length - 1 };
    }
    const p = r.progress;
    let idx = 0;
    for (let i = 0; i < wps.length; i++) if (wps[i].at <= p) idx = i;
    const next = wps[idx + 1];
    let label: string;
    if (r.phase === 'final-approach') label = `Final approach to ${this.pack.route.to}`;
    else if (idx === 0 && p - wps[0].at < 0.06) label = `Leaving ${wps[0].name}`;
    else if (next && next.at - p < 0.07) label = `Approaching ${next.name}`;
    else label = `Near ${wps[idx].name}`;
    return { label, waypointIndex: idx, next: next?.name };
  }
}
