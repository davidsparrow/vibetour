import type { DevEvent } from './events';
import type { WorkspaceTracker } from './workspace';

/**
 * Activity Engine (PRD §9): normalises development events into one abstract
 * state plus a handful of instrument readings. It deliberately uses long,
 * forgiving windows so that a few seconds without keystrokes never stops the
 * journey (PRD §4.4, §10).
 */

export type ActivityState =
  | 'IDLE'
  | 'THINKING'
  | 'ACTIVE'
  | 'AGENT_ACTIVE'
  | 'VERIFYING'
  | 'WAITING_FOR_USER'
  | 'WARNING'
  | 'BLOCKED'
  | 'COMPLETE';

export interface ActivityConfig {
  /** User input within this window counts as ACTIVE. */
  activeWindowMs: number;
  /** Focused-but-quiet time that still counts as THINKING. */
  thinkingWindowMs: number;
  /** Same, while the IDE window is unfocused (reading docs elsewhere). */
  unfocusedThinkingMs: number;
  /** External file changes within this window imply an agent is working. */
  externalEditWindowMs: number;
  /** An agent in working/tool state is trusted for this long without news. */
  agentStaleMs: number;
  /** Waiting-for-user expires after this long (hook events can get lost). */
  waitingExpiryMs: number;
  /** A failed build with nobody acting on it becomes BLOCKED after this. */
  blockedAfterMs: number;
  /** Diff/review views within this window put the gear in R. */
  reviewWindowMs: number;
}

export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  activeWindowMs: 20_000,
  thinkingWindowMs: 5 * 60_000,
  unfocusedThinkingMs: 2 * 60_000,
  externalEditWindowMs: 15_000,
  agentStaleMs: 10 * 60_000,
  waitingExpiryMs: 30 * 60_000,
  blockedAfterMs: 30_000,
  reviewWindowMs: 60_000,
};

export interface ActivityReading {
  state: ActivityState;
  /** For WARNING: the state it overlays (ACTIVE or THINKING). Otherwise equals state. */
  basis: ActivityState;
  /** When `state` last changed. */
  since: number;
  /** Speedometer: overall development activity 0..1. */
  devActivity: number;
  /** Tachometer: tool/agent activity 0..1. */
  agentActivity: number;
  /** Temperature gauge: warning/error intensity 0..1. */
  errorIntensity: number;
  checkEngine: { on: boolean; reason?: string };
  warning: boolean;
  reviewing: boolean;
  /** Context-window usage reported by an agent, if any. */
  context: number | null;
  waitingAgent?: string;
  blockedReason?: string;
}

class Decay {
  private value = 0;
  private at = 0;
  constructor(private readonly halfLifeMs: number) {}
  get(now: number): number {
    if (this.value === 0) return 0;
    return this.value * Math.pow(0.5, Math.max(0, now - this.at) / this.halfLifeMs);
  }
  add(now: number, amount: number): void {
    this.value = this.get(now) + amount;
    this.at = now;
  }
}

const saturate = (score: number, k: number) => 1 - Math.exp(-score / k);

export class ActivityEngine {
  private readonly dev = new Decay(15_000);
  private readonly agent = new Decay(20_000);
  private state: ActivityState = 'IDLE';
  private since: number;
  private complete = false;

  constructor(
    private readonly ws: WorkspaceTracker,
    now: number,
    private readonly cfg: ActivityConfig = DEFAULT_ACTIVITY_CONFIG,
  ) {
    this.since = now;
  }

  /** Feed an event (after the WorkspaceTracker has ingested it). */
  ingest(e: DevEvent): void {
    switch (e.type) {
      case 'editor.edit': {
        const weight = 0.25 + Math.min(e.magnitude, 400) / 400;
        this.dev.add(e.at, weight);
        if (e.origin === 'agent') this.agent.add(e.at, 0.6);
        break;
      }
      case 'editor.save':
        this.dev.add(e.at, 0.5);
        break;
      case 'editor.navigate':
      case 'editor.review':
        this.dev.add(e.at, 0.12);
        break;
      case 'editor.focus':
        this.dev.add(e.at, 0.2);
        break;
      case 'fs.external':
        this.dev.add(e.at, 0.3);
        this.agent.add(e.at, 0.6);
        break;
      case 'agent':
        if (e.status === 'working' || e.status === 'tool') this.agent.add(e.at, 0.5);
        break;
      case 'process.start':
        this.agent.add(e.at, 0.4);
        break;
      default:
        break;
    }
  }

  setComplete(done: boolean): void {
    this.complete = done;
  }

  evaluate(now: number): ActivityReading {
    const ws = this.ws;
    const cfg = this.cfg;
    const sinceInput = now - ws.lastUserInputAt;
    const sinceEdit = now - ws.lastUserEditAt;
    const userActive = sinceInput < cfg.activeWindowMs;

    const agents = [...ws.agents.values()];
    const working = agents.filter((a) => (a.status === 'working' || a.status === 'tool') && now - a.lastActivityAt < cfg.agentStaleMs);
    const externalActive =
      now - ws.lastExternalEditAt < cfg.externalEditWindowMs || now - ws.lastAgentEditAt < cfg.externalEditWindowMs;
    const agentActive = working.length > 0 || externalActive;
    const waiting = agents.find((a) => a.status === 'waiting' && now - a.since < cfg.waitingExpiryMs);
    const errored = agents.find((a) => a.status === 'error' && now - a.since < cfg.agentStaleMs);
    const verifying = ws.runningVerification().length > 0;
    const agentProcess = [...ws.processes.values()].some((p) => p.kind === 'agent');

    const build = ws.results.build;
    const test = ws.results.test;
    const lint = ws.results.lint;
    const buildFailed = !!build && !build.ok;
    const stuckOnBuild =
      buildFailed &&
      now - build!.at > cfg.blockedAfterMs &&
      sinceInput > cfg.blockedAfterMs &&
      !agentActive &&
      !verifying;

    const thinking =
      (ws.windowFocused && sinceInput < cfg.thinkingWindowMs) ||
      (!ws.windowFocused && sinceInput < cfg.unfocusedThinkingMs) ||
      (agentProcess && sinceInput < cfg.thinkingWindowMs);

    let basis: ActivityState;
    let blockedReason: string | undefined;
    if (this.complete) basis = 'COMPLETE';
    else if (errored || stuckOnBuild) {
      basis = 'BLOCKED';
      blockedReason = errored ? `${errored.name} needs help` : 'Build is failing';
    } else if (waiting && !(sinceEdit < cfg.activeWindowMs)) basis = 'WAITING_FOR_USER';
    else if (verifying) basis = 'VERIFYING';
    else if (agentActive) basis = 'AGENT_ACTIVE';
    else if (userActive) basis = 'ACTIVE';
    else if (thinking) basis = 'THINKING';
    else basis = 'IDLE';

    const testFailed = !!test && !test.ok;
    const lintFailed = !!lint && !lint.ok;
    const warning = ws.diagnostics.errors > 0 || testFailed || lintFailed || buildFailed;
    const state: ActivityState = warning && (basis === 'ACTIVE' || basis === 'THINKING') ? 'WARNING' : basis;

    if (state !== this.state) {
      this.state = state;
      this.since = now;
    }

    const checkReason = buildFailed ? 'Build failing' : testFailed ? 'Tests failing' : lintFailed ? 'Checks failing' : undefined;
    const running = ws.processes.size;
    const contexts = agents.map((a) => a.context).filter((c): c is number => typeof c === 'number');

    return {
      state,
      basis,
      since: this.since,
      devActivity: saturate(this.dev.get(now), 3),
      agentActivity: Math.min(1, saturate(this.agent.get(now), 2.5) + Math.min(running, 3) * 0.12 + working.length * 0.1),
      errorIntensity: saturate(ws.diagnostics.errors + ws.diagnostics.warnings * 0.2 + (checkReason ? 2 : 0), 5),
      checkEngine: { on: !!checkReason, reason: checkReason },
      warning,
      reviewing: now - ws.lastReviewAt < cfg.reviewWindowMs,
      context: contexts.length ? Math.max(...contexts) : null,
      waitingAgent: basis === 'WAITING_FOR_USER' ? waiting?.name : undefined,
      blockedReason,
    };
  }
}
