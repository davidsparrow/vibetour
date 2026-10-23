import type { AgentAsk, CacheReading, DevEventBody } from './events';

/**
 * Maps coding-agent hook payloads onto provider-neutral agent events
 * (PRD §15, §16). Only metadata is read: event names, tool names and ids.
 * Prompts, tool inputs and outputs are never needed and should be stripped by
 * the forwarder before they leave the agent process.
 */

export interface AgentHookPayload {
  hook_event_name?: string;
  session_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  notification_type?: string;
  subagent_type?: string;
  agent_id?: string;
  /** Codex `notify` payloads use `type`. */
  type?: string;
  /** Generic forwarders may pass a provider name. */
  provider?: string;
  /** How full the session's context window is, 0..1, worked out by the forwarder. */
  context?: number;
  /** The last reply's prompt-cache counts and time, or on a prompt just the time. */
  cache?: CacheReading;
  /** `StopFailure`: the kind of API error that ended the turn, e.g. `rate_limit`. */
  error?: string;
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

/** Tools that stop and wait for you: a question to answer, a plan to approve. */
const ASKING_TOOLS = new Map<string, { ask: AgentAsk; detail: string }>([
  ['AskUserQuestion', { ask: 'question', detail: 'Has a question for you' }],
  ['ExitPlanMode', { ask: 'plan', detail: 'Has a plan for you to approve' }],
]);

/** Notifications that ask for your input; anything else that isn't a permission prompt asks nothing. */
const INPUT_NOTIFICATIONS = new Set(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']);

/** `StopFailure` error kinds, as the cockpit says them. */
const STOP_FAILURES = new Map<string, string>([
  ['rate_limit', 'rate limit'],
  ['overloaded', 'API overloaded'],
  ['authentication_failed', 'sign-in failed'],
  ['oauth_org_not_allowed', 'organisation not allowed'],
  ['account_on_hold', 'account on hold'],
  ['billing_error', 'billing problem'],
  ['invalid_request', 'invalid request'],
  ['model_not_found', 'model not found'],
  ['server_error', 'server error'],
  ['max_output_tokens', 'reply too long'],
  ['cloud_credential_error', 'cloud credentials'],
  ['unknown', 'API error'],
]);

/** Keeps only the metadata fields VibeTour uses. */
export function sanitizeHookPayload(raw: unknown): AgentHookPayload {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: AgentHookPayload = {};
  const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  out.hook_event_name = str(src.hook_event_name, 40);
  out.session_id = str(src.session_id, 80);
  out.tool_name = str(src.tool_name, 60);
  out.tool_use_id = str(src.tool_use_id, 80);
  out.notification_type = str(src.notification_type, 40);
  out.agent_id = str(src.agent_id, 80);
  out.type = str(src.type, 40);
  out.provider = str(src.provider, 30);
  const input = src.tool_input as Record<string, unknown> | undefined;
  out.subagent_type = str(src.subagent_type ?? src.agent_type ?? input?.subagent_type, 40);
  // Only the error's kind, never its details or the message shown in the conversation.
  if (typeof src.error === 'string' && /^[a-z][a-z_]{0,39}$/.test(src.error)) out.error = src.error;
  if (typeof src.context === 'number' && src.context >= 0 && src.context <= 1) out.context = src.context;
  out.cache = sanitizeCache(src.cache);
  for (const k of Object.keys(out) as Array<keyof AgentHookPayload>) if (out[k] === undefined) delete out[k];
  return out;
}

/** A cache reading needs a time; its counts must be whole and non-negative, its ttl 5 minutes or an hour. */
function sanitizeCache(raw: unknown): CacheReading | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const src = raw as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!n(src.at) || !(Number(src.at) > 0)) return undefined;
  const out: CacheReading = { at: src.at as number };
  const counts = [src.read, src.write, src.fresh];
  if (counts.every(n)) {
    out.read = Math.round(src.read as number);
    out.write = Math.round(src.write as number);
    out.fresh = Math.round(src.fresh as number);
  }
  if (typeof src.id === 'string' && src.id) out.id = src.id.slice(0, 80);
  if (src.ttl === 300 || src.ttl === 3600) out.ttl = src.ttl;
  return out;
}

function prettyTool(tool: string): string {
  if (/^mcp__/.test(tool)) return tool.split('__').slice(1).join(' ');
  return tool;
}

interface SubAgent {
  id: string;
  toolUseId?: string;
}

/**
 * Stateful mapper: remembers which crew agent belongs to which delegating tool
 * call, so parallel sub-agents are retired correctly.
 */
export class AgentHookMapper {
  private readonly subagents = new Map<string, SubAgent[]>();
  /** Each session's tool call in flight, so a permission prompt can say what it is for. */
  private readonly pending = new Map<string, string>();
  private counter = 0;

  map(payload: AgentHookPayload): DevEventBody[] {
    const events = this.mapEvent(payload);
    const { context, cache } = payload;
    if (context === undefined && cache === undefined) return events;
    // The readings belong to the co-pilot whose session sent them, never to its crew.
    return events.map((e) =>
      e.type === 'agent' && e.role === 'copilot' ? { ...e, ...(context !== undefined ? { context } : {}), ...(cache ? { cache } : {}) } : e,
    );
  }

  private mapEvent(payload: AgentHookPayload): DevEventBody[] {
    if (payload.type === 'agent-turn-complete') {
      return [{ type: 'agent', agentId: 'codex', name: 'Codex', role: 'copilot', status: 'done', detail: 'Turn complete — your move' }];
    }
    const name = payload.provider === 'codex' ? 'Codex' : 'Claude';
    const session = (payload.session_id ?? 'default').slice(0, 8);
    const agentId = `${name.toLowerCase()}:${session}`;
    const base = { type: 'agent' as const, agentId, name, role: 'copilot' as const };
    const tool = payload.tool_name ?? '';
    const subs = this.subagents.get(agentId) ?? [];

    switch (payload.hook_event_name) {
      case 'SessionStart':
        return [{ ...base, status: 'idle', detail: 'Session started' }];
      case 'UserPromptSubmit':
        this.pending.delete(agentId);
        return [...this.retireCrew(agentId), { ...base, status: 'working', detail: 'Working on your request' }];
      case 'PreToolUse': {
        if (tool) this.pending.set(agentId, tool);
        else this.pending.delete(agentId);
        const asking = ASKING_TOOLS.get(tool);
        if (asking) return [{ ...base, status: 'waiting', ask: asking.ask, detail: asking.detail }];
        if (SUBAGENT_TOOLS.has(tool)) {
          const sub: SubAgent = { id: `${agentId}:sub:${payload.tool_use_id?.slice(-12) ?? ++this.counter}`, toolUseId: payload.tool_use_id };
          this.subagents.set(agentId, [...subs, sub]);
          return [
            { ...base, status: 'tool', detail: 'Delegating to a crew agent' },
            {
              type: 'agent',
              agentId: sub.id,
              name: crewName(payload.subagent_type),
              role: crewRole(payload.subagent_type),
              status: 'working',
              detail: payload.subagent_type,
              parentId: agentId,
            },
          ];
        }
        return [{ ...base, status: 'tool', detail: tool ? `Using ${prettyTool(tool)}` : 'Using a tool' }];
      }
      case 'PostToolUse': {
        this.pending.delete(agentId);
        const events: DevEventBody[] = [{ ...base, status: 'working', detail: 'Working' }];
        if (SUBAGENT_TOOLS.has(tool)) {
          // Match the exact delegating call; fall back to the oldest only without an id.
          const sub = payload.tool_use_id ? subs.find((x) => x.toolUseId === payload.tool_use_id) : subs[0];
          if (sub) {
            this.subagents.set(
              agentId,
              subs.filter((x) => x !== sub),
            );
            events.push({ type: 'agent.remove', agentId: sub.id });
          }
        }
        return events;
      }
      case 'SubagentStart':
      case 'SubagentStop':
        // The matching PostToolUse retires the crew agent with its exact id;
        // SubagentStop fires first and does not say which one finished.
        return [];
      case 'Notification': {
        const kind = payload.notification_type;
        if (kind && INPUT_NOTIFICATIONS.has(kind)) return [{ ...base, status: 'waiting', ask: 'question', detail: 'Needs your input' }];
        // Only a permission prompt (or an older Claude Code that doesn't say) waits for you.
        // idle_prompt repeats Stop a minute later ("still your turn"); auth_success,
        // quota and completion notices ask nothing. None of them should stop the car.
        if (kind && kind !== 'permission_prompt') return [];
        const inFlight = this.pending.get(agentId);
        const asking = inFlight ? ASKING_TOOLS.get(inFlight) : undefined;
        if (asking) return [{ ...base, status: 'waiting', ask: asking.ask, detail: asking.detail }];
        const named = inFlight ? prettyTool(inFlight) : undefined;
        return [
          {
            ...base,
            status: 'waiting',
            ask: 'approval',
            detail: named ? `Needs your approval to use ${named}` : 'Needs your approval',
            ...(named ? { tool: named } : {}),
          },
        ];
      }
      case 'Stop':
        this.pending.delete(agentId);
        return [...this.retireCrew(agentId), { ...base, status: 'done', detail: 'Finished — your turn' }];
      case 'StopFailure': {
        // The turn ended on an API error (Stop doesn't fire): Claude has stopped and needs you.
        this.pending.delete(agentId);
        const kind = payload.error ?? 'unknown';
        const why = STOP_FAILURES.get(kind) ?? kind.replace(/_/g, ' ');
        return [...this.retireCrew(agentId), { ...base, status: 'error', detail: `Stopped: ${why}` }];
      }
      case 'PreCompact':
        return [{ ...base, status: 'tool', detail: 'Compacting context' }];
      case 'SessionEnd':
        this.pending.delete(agentId);
        return [{ type: 'agent.remove', agentId }, ...this.retireCrew(agentId)];
      case 'StatusLine':
        // Sent by the forwarder's --statusline mode after each reply: a reading, not activity.
        return payload.context === undefined ? [] : [{ type: 'agent.context', agentId, context: payload.context }];
      default:
        return [];
    }
  }

  /**
   * Removes crew agents whose delegating call never reported back (denied,
   * interrupted or failed): none can outlive the turn that started them.
   */
  private retireCrew(agentId: string): DevEventBody[] {
    const subs = this.subagents.get(agentId) ?? [];
    this.subagents.delete(agentId);
    return subs.map((x) => ({ type: 'agent.remove' as const, agentId: x.id }));
  }
}

function crewName(type?: string): string {
  const t = (type ?? '').toLowerCase();
  if (/plan|architect/.test(t)) return 'NAV';
  if (/test|qa|review/.test(t)) return 'QA';
  if (/doc|search|explore|research|fetch/.test(t)) return 'COMMS';
  if (/deploy|ops|ci/.test(t)) return 'OPS';
  return 'ENG';
}

function crewRole(type?: string): 'nav' | 'qa' | 'comms' | 'ops' | 'eng' {
  return crewName(type).toLowerCase() as 'nav' | 'qa' | 'comms' | 'ops' | 'eng';
}

/** Validates a provider-neutral agent event posted by any integration. */
export function parseNeutralAgentEvent(raw: unknown): DevEventBody | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined);
  if (r.type === 'agent.remove') {
    const agentId = str(r.agentId, 120);
    return agentId ? { type: 'agent.remove', agentId } : undefined;
  }
  if (r.type !== 'agent') return undefined;
  const agentId = str(r.agentId, 120);
  const name = str(r.name, 40);
  const statuses = ['working', 'tool', 'waiting', 'idle', 'done', 'error'];
  const roles = ['copilot', 'nav', 'eng', 'qa', 'comms', 'ops', 'crew'];
  if (!agentId || !name || typeof r.status !== 'string' || !statuses.includes(r.status)) return undefined;
  const ctx = typeof r.context === 'number' && r.context >= 0 && r.context <= 1 ? r.context : undefined;
  const asks = ['question', 'plan', 'approval'];
  const ask = r.status === 'waiting' && typeof r.ask === 'string' && asks.includes(r.ask) ? (r.ask as AgentAsk) : undefined;
  return {
    type: 'agent',
    agentId,
    name,
    status: r.status as 'working',
    role: typeof r.role === 'string' && roles.includes(r.role) ? (r.role as 'copilot') : undefined,
    detail: str(r.detail, 80),
    parentId: str(r.parentId, 120),
    context: ctx,
    ...(ask ? { ask } : {}),
    ...(ask === 'approval' && str(r.tool, 40) ? { tool: str(r.tool, 40) } : {}),
  };
}
