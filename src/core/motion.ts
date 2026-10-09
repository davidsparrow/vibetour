import type { ActivityReading } from './activity';

/**
 * Motion rules (PRD §10, §23, §41). Converts the activity reading into a calm
 * driving behaviour. Behaviour changes are debounced so the vehicle never
 * twitches between states; resuming from a stop is immediate so returning to
 * work feels responsive.
 */

export type Behavior =
  | 'cruise'
  | 'review'
  | 'gentle'
  | 'slow'
  | 'checkpoint'
  | 'scenic-stop'
  | 'pull-over'
  | 'approach'
  | 'arrived'
  | 'parked';

export type JourneyPhase = 'departing' | 'cruising' | 'extended' | 'final-approach' | 'arrived' | 'staying' | 'parked';

export interface MotionReading {
  behavior: Behavior;
  /** Fraction of the pack's cruise speed, 0..1. */
  targetSpeed: number;
  since: number;
  stopped: boolean;
  stopReason?: 'idle' | 'waiting' | 'blocked';
}

export const SPEEDS: Record<Behavior, number> = {
  cruise: 1,
  review: 0.8,
  gentle: 0.65,
  slow: 0.35,
  checkpoint: 0.85,
  'scenic-stop': 0,
  'pull-over': 0,
  approach: 0.6,
  arrived: 0,
  parked: 0,
};

const STOPS: Behavior[] = ['scenic-stop', 'pull-over', 'arrived', 'parked'];

export interface MotionConfig {
  /** IDLE time after which the vehicle pulls into a scenic stop. */
  scenicStopAfterMs: number;
  holdMs: Partial<Record<Behavior, number>>;
  defaultHoldMs: number;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  scenicStopAfterMs: 3 * 60_000,
  holdMs: { checkpoint: 4_000, 'scenic-stop': 2_000, 'pull-over': 2_000 },
  defaultHoldMs: 1_500,
};

export function desiredBehavior(
  a: ActivityReading,
  phase: JourneyPhase,
  now: number,
  cfg: MotionConfig = DEFAULT_MOTION_CONFIG,
): { behavior: Behavior; stopReason?: MotionReading['stopReason'] } {
  if (phase === 'parked') return { behavior: 'parked' };
  if (phase === 'arrived' || phase === 'staying') return { behavior: 'arrived' };
  switch (a.basis) {
    case 'BLOCKED':
      return { behavior: 'pull-over', stopReason: 'blocked' };
    case 'WAITING_FOR_USER':
      return { behavior: 'scenic-stop', stopReason: 'waiting' };
    case 'IDLE':
      return now - a.since >= cfg.scenicStopAfterMs ? { behavior: 'scenic-stop', stopReason: 'idle' } : { behavior: 'slow' };
    default:
      break;
  }
  if (phase === 'final-approach') return { behavior: 'approach' };
  switch (a.basis) {
    case 'VERIFYING':
      return { behavior: 'checkpoint' };
    case 'AGENT_ACTIVE':
      return { behavior: 'cruise' };
    case 'ACTIVE':
      return { behavior: a.reviewing ? 'review' : 'cruise' };
    case 'THINKING':
      return { behavior: 'gentle' };
    case 'COMPLETE':
      return { behavior: 'approach' };
    default:
      return { behavior: 'gentle' };
  }
}

export class MotionController {
  private current: MotionReading;
  private candidate?: { behavior: Behavior; stopReason?: MotionReading['stopReason']; since: number };

  constructor(
    now: number,
    private readonly cfg: MotionConfig = DEFAULT_MOTION_CONFIG,
  ) {
    this.current = { behavior: 'parked', targetSpeed: 0, since: now, stopped: true };
  }

  get reading(): MotionReading {
    return this.current;
  }

  /** Forces a behaviour immediately (journey start, park, arrival). */
  force(behavior: Behavior, now: number, stopReason?: MotionReading['stopReason']): MotionReading {
    this.candidate = undefined;
    this.current = { behavior, targetSpeed: SPEEDS[behavior], since: now, stopped: STOPS.includes(behavior), stopReason };
    return this.current;
  }

  update(a: ActivityReading, phase: JourneyPhase, now: number): MotionReading {
    const want = desiredBehavior(a, phase, now, this.cfg);
    if (want.behavior === this.current.behavior) {
      this.candidate = undefined;
      if (want.stopReason !== this.current.stopReason) this.current = { ...this.current, stopReason: want.stopReason };
      return this.current;
    }
    const resuming = this.current.stopped && !STOPS.includes(want.behavior);
    const terminal = want.behavior === 'parked' || want.behavior === 'arrived';
    if (resuming || terminal) return this.force(want.behavior, now, want.stopReason);

    if (!this.candidate || this.candidate.behavior !== want.behavior) {
      this.candidate = { ...want, since: now };
    }
    const hold = this.cfg.holdMs[want.behavior] ?? this.cfg.defaultHoldMs;
    if (now - this.candidate.since >= hold) return this.force(want.behavior, now, want.stopReason);
    return this.current;
  }
}
