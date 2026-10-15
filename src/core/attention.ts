import type { AgentAsk } from './events';

/**
 * What needs you right now: an agent's question, a plan to approve, a
 * permission prompt, an agent that stopped on an error, a build left failing,
 * your turn after an agent finished, and a pull request of yours that needs
 * action. The host works the list out once per snapshot. Each display lists
 * the kinds its driver switched on in its Alerts tab; the one that stopped
 * the car also rides on the stop card.
 */

export const ALERT_KINDS = ['problem', 'build', 'question', 'plan', 'approval', 'turn', 'pr'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * How loud an alert is. Blocking: it stopped the car (red). Moderate: it
 * needs you but the car may drive on (orange). General: worth a look, no
 * stop (blue), such as uncommitted files.
 */
export type AlertSeverity = 'blocking' | 'moderate' | 'general';

export function severityOf(kind: AlertKind): AlertSeverity {
  return kind === 'turn' || kind === 'pr' ? 'moderate' : 'blocking';
}

/** The loudest of several, or undefined for none. */
export function loudest(severities: Iterable<AlertSeverity>): AlertSeverity | undefined {
  let best: AlertSeverity | undefined;
  for (const s of severities) {
    if (s === 'blocking') return s;
    if (s === 'moderate' || !best) best = s;
  }
  return best;
}

export interface Attention {
  /** Stable per thing, so a display can keep its chip. */
  id: string;
  kind: AlertKind;
  /** The chip, e.g. "Claude has a question". */
  text: string;
  since: number;
  /** What a click opens. */
  target: { type: 'agent'; agentId: string } | { type: 'pr'; number: number } | { type: 'problems' };
}

/** The car's reason for stopping, e.g. "Claude has a question for you". */
export function waitingFor(name: string, ask?: AgentAsk): string {
  switch (ask) {
    case 'question':
      return `${name} has a question for you`;
    case 'plan':
      return `${name} has a plan for you to approve`;
    case 'approval':
      return `${name} needs your approval`;
    default:
      return `${name} is waiting for you`;
  }
}

export interface AttentionAgent {
  id: string;
  name: string;
  status: string;
  ask?: AgentAsk;
  tool?: string;
  detail?: string;
  since: number;
}

export interface AttentionPullRequest {
  number: number;
  ci: 'passing' | 'failing' | 'pending' | 'none';
  review: 'approved' | 'changes-requested' | 'review-required' | 'none';
  conflict: boolean;
  onBranch: boolean;
  mine: boolean;
  createdAt: number;
}

export interface AttentionInput {
  now: number;
  agents: readonly AttentionAgent[];
  /** The agent whose finished turn makes it your move. */
  yourTurn?: { agentId: string; agent: string; since: number };
  /** A failed build left alone: the car pulled over for it. */
  buildFailing?: { since: number };
  pullRequests: readonly AttentionPullRequest[];
  /** A wait older than this is a lost hook event, not a question. */
  waitingExpiryMs: number;
  /** An error older than this no longer blocks. */
  errorExpiryMs: number;
  /** Streaming mode: no tool names or error details. */
  streaming: boolean;
}

/** Why a pull request needs you, most urgent first; none if it doesn't. */
export function pullRequestTrouble(pr: AttentionPullRequest): string[] {
  if (!pr.onBranch && !pr.mine) return [];
  const out: string[] = [];
  if (pr.conflict) out.push('merge conflict');
  if (pr.ci === 'failing') out.push('CI failing');
  if (pr.review === 'changes-requested') out.push('changes requested');
  return out;
}

export function attentionOf(input: AttentionInput): Attention[] {
  const out: Attention[] = [];
  for (const ag of input.agents) {
    const age = input.now - ag.since;
    const target = { type: 'agent' as const, agentId: ag.id };
    if (ag.status === 'waiting' && age < input.waitingExpiryMs) {
      const kind: AlertKind = ag.ask ?? 'approval';
      const text =
        kind === 'question'
          ? `${ag.name} has a question`
          : kind === 'plan'
            ? `${ag.name} has a plan to approve`
            : `${ag.name} needs approval${ag.tool && !input.streaming ? ` · ${ag.tool}` : ''}`;
      out.push({ id: `agent:${ag.id}`, kind, text, since: ag.since, target });
    } else if (ag.status === 'error' && age < input.errorExpiryMs) {
      const stopped = !input.streaming && ag.detail?.startsWith('Stopped: ') ? ag.detail.slice('Stopped: '.length) : undefined;
      out.push({ id: `agent:${ag.id}`, kind: 'problem', text: stopped ? `${ag.name} stopped · ${stopped}` : `${ag.name} hit a problem`, since: ag.since, target });
    }
  }
  if (input.buildFailing) out.push({ id: 'build', kind: 'build', text: 'Build failing', since: input.buildFailing.since, target: { type: 'problems' } });
  const turn = input.yourTurn;
  if (turn) out.push({ id: `turn:${turn.agentId}`, kind: 'turn', text: `${turn.agent} finished · your turn`, since: turn.since, target: { type: 'agent', agentId: turn.agentId } });
  // The PR on your branch first, then yours, oldest first.
  const prs = [...input.pullRequests].sort((a, b) => Number(b.onBranch) - Number(a.onBranch) || a.createdAt - b.createdAt);
  for (const pr of prs) {
    const trouble = pullRequestTrouble(pr);
    if (trouble.length) out.push({ id: `pr:${pr.number}`, kind: 'pr', text: `PR #${pr.number} · ${trouble.join(', ')}`, since: pr.createdAt, target: { type: 'pr', number: pr.number } });
  }
  const rank = (k: AlertKind) => ALERT_KINDS.indexOf(k);
  // Stable: PRs keep the order above; everything else waits longest first.
  return out.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.kind === 'pr' ? 0 : a.since - b.since));
}
