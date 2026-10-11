import type { ActivityReading, ActivityState } from './activity';
import type { JourneyPhase, MotionReading } from './motion';

/**
 * Moments: the named situations a dashboard can react to (see the signal map
 * in docs/architecture.md). Several hold at once, say thinking + problems +
 * your-turn. The host works them out once per snapshot; each display decides
 * which cues they switch on.
 */
export const MOMENTS = [
  'no-journey',
  'parked',
  'arrived',
  'final-approach',
  /** The car pulled over because an agent reported an error. */
  'agent-problem',
  /** The car pulled over because a failed build was left alone. */
  'build-failing',
  'agent-waiting',
  'verifying',
  'agent-working',
  'coding',
  'thinking',
  'idle',
  /** Problems or failed checks while coding or thinking (the WARNING state). */
  'heads-up',
  /** Any errors or warnings in Problems. */
  'problems',
  /** The last test, build or lint run failed. */
  'checks-failing',
  /** An agent finished its turn and nothing else is going on. */
  'your-turn',
] as const;

export type Moment = (typeof MOMENTS)[number];

const BY_BASIS: Partial<Record<ActivityState, Moment>> = {
  WAITING_FOR_USER: 'agent-waiting',
  VERIFYING: 'verifying',
  AGENT_ACTIVE: 'agent-working',
  ACTIVE: 'coding',
  THINKING: 'thinking',
  IDLE: 'idle',
};

export function momentsOf(phase: JourneyPhase | undefined, a: ActivityReading, motion: MotionReading, diagnostics: { errors: number; warnings: number }): Moment[] {
  const on = new Set<Moment>();
  if (!phase) on.add('no-journey');
  else if (phase === 'parked') on.add('parked');
  else if (phase === 'arrived' || phase === 'staying') on.add('arrived');
  else if (phase === 'final-approach') on.add('final-approach');
  if (motion.behavior === 'pull-over') on.add(a.blockedBy === 'agent' ? 'agent-problem' : 'build-failing');
  const basis = BY_BASIS[a.basis];
  if (basis) on.add(basis);
  if (a.state === 'WARNING') on.add('heads-up');
  if (diagnostics.errors + diagnostics.warnings > 0) on.add('problems');
  if (a.checkEngine.on) on.add('checks-failing');
  if (a.yourTurn) on.add('your-turn');
  return MOMENTS.filter((m) => on.has(m));
}
