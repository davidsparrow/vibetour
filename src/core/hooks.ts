import type { DevEventBody } from './events';

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
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

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
  for (const k of Object.keys(out) as Array<keyof AgentHookPayload>) if (out[k] === undefined) delete out[k];
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
  private counter = 0;

  map(payload: AgentHookPayload): DevEventBody[] {
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
        return [...this.retireCrew(agentId), { ...base, status: 'working', detail: 'Working on your request' }];
      case 'PreToolUse': {
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
      case 'Notification':
        // idle_prompt only repeats Stop a minute later ("still your turn"), and
        // auth_success asks nothing: neither should pull the car over.
        if (payload.notification_type === 'idle_prompt' || payload.notification_type === 'auth_success') return [];
        return [{ ...base, status: 'waiting', detail: 'Needs your approval' }];
      case 'Stop':
        return [...this.retireCrew(agentId), { ...base, status: 'done', detail: 'Finished — your turn' }];
      case 'PreCompact':
        return [{ ...base, status: 'tool', detail: 'Compacting context' }];
      case 'SessionEnd':
        return [{ type: 'agent.remove', agentId }, ...this.retireCrew(agentId)];
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
  return {
    type: 'agent',
    agentId,
    name,
    status: r.status as 'working',
    role: typeof r.role === 'string' && roles.includes(r.role) ? (r.role as 'copilot') : undefined,
    detail: str(r.detail, 80),
    parentId: str(r.parentId, 120),
    context: ctx,
  };
}
