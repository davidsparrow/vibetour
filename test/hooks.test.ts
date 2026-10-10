import { describe, expect, it } from 'vitest';
import type { DevEventBody } from '../src/core/events';
import { AgentHookMapper, parseNeutralAgentEvent, sanitizeHookPayload } from '../src/core/hooks';
import { makeSession } from './helpers';

const SESSION = 'f00dcafe-1234-5678';

describe('AgentHookMapper', () => {
  it('follows a Claude Code session from start to end, crew included', () => {
    const { session, clock, emit } = makeSession();
    const mapper = new AgentHookMapper();
    const hook = (payload: Record<string, unknown>) => {
      const events = mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
      for (const e of events) emit(e);
      clock.advance(250);
      return events;
    };
    const agents = () => session.latestSnapshot!.ide.agents;
    const claude = () => agents().find((a) => a.id === 'claude:f00dcafe');

    hook({ hook_event_name: 'SessionStart', source: 'startup' });
    expect(claude()).toMatchObject({ name: 'Claude', role: 'copilot', status: 'idle' });

    hook({ hook_event_name: 'UserPromptSubmit', prompt: 'refactor the billing module' });
    expect(claude()?.status).toBe('working');

    const pre = hook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_01ABCDEFGH', tool_input: { subagent_type: 'test-runner', prompt: 'run all tests' } });
    expect(pre.map((e) => e.type)).toEqual(['agent', 'agent']);
    expect(claude()?.status).toBe('tool');
    const crew = agents().find((a) => a.parentId === 'claude:f00dcafe');
    expect(crew).toMatchObject({ name: 'QA', role: 'qa', status: 'working', detail: 'test-runner' });

    hook({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id: 'toolu_01ABCDEFGH', tool_response: { content: 'all green' } });
    expect(agents().some((a) => a.parentId)).toBe(false);
    expect(claude()?.status).toBe('working');

    hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    expect(claude()?.status).toBe('waiting');
    expect(session.latestSnapshot!.activity.waitingAgent).toBe('Claude');

    hook({ hook_event_name: 'Stop' });
    expect(claude()?.status).toBe('done');

    hook({ hook_event_name: 'SessionEnd', reason: 'exit' });
    expect(claude()).toBeUndefined();
  });

  it('retires parallel sub-agents by their own tool call, not by SubagentStop order', () => {
    const mapper = new AgentHookMapper();
    const a = mapper.map({ hook_event_name: 'PreToolUse', session_id: SESSION, tool_name: 'Task', tool_use_id: 'toolu_a', subagent_type: 'Explore' })[1] as Extract<DevEventBody, { type: 'agent' }>;
    const b = mapper.map({ hook_event_name: 'PreToolUse', session_id: SESSION, tool_name: 'Task', tool_use_id: 'toolu_b', subagent_type: 'test-runner' })[1] as Extract<DevEventBody, { type: 'agent' }>;
    expect(a.name).toBe('COMMS');
    expect(b.name).toBe('QA');
    // Claude Code fires SubagentStop before PostToolUse and does not say which one finished.
    expect(mapper.map({ hook_event_name: 'SubagentStop', session_id: SESSION })).toEqual([]);
    const post = mapper.map({ hook_event_name: 'PostToolUse', session_id: SESSION, tool_name: 'Task', tool_use_id: 'toolu_b' });
    expect(post).toContainEqual({ type: 'agent.remove', agentId: b.agentId });
    expect(post).not.toContainEqual({ type: 'agent.remove', agentId: a.agentId });
    expect(mapper.map({ hook_event_name: 'SomethingNew', session_id: SESSION })).toEqual([]);
  });

  it('keeps "your turn" after Stop: idle reminders and auth notices are not questions', () => {
    const mapper = new AgentHookMapper();
    const map = (payload: Record<string, unknown>) => mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
    expect(map({ hook_event_name: 'Stop' })).toMatchObject([{ status: 'done' }]);
    expect(map({ hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })).toEqual([]);
    expect(map({ hook_event_name: 'Notification', notification_type: 'auth_success' })).toEqual([]);
    expect(map({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toMatchObject([{ status: 'waiting' }]);
    expect(map({ hook_event_name: 'Notification' })).toMatchObject([{ status: 'waiting' }]);
  });

  it('retires crew agents whose delegating call never reported back when the turn ends', () => {
    const mapper = new AgentHookMapper();
    const map = (payload: Record<string, unknown>) => mapper.map({ session_id: SESSION, ...payload });
    const denied = map({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_denied', subagent_type: 'Explore' })[1] as Extract<DevEventBody, { type: 'agent' }>;
    expect(map({ hook_event_name: 'Stop' })).toEqual([
      { type: 'agent.remove', agentId: denied.agentId },
      expect.objectContaining({ type: 'agent', status: 'done' }),
    ]);
    expect(map({ hook_event_name: 'Stop' })).toHaveLength(1);

    const interrupted = map({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'toolu_esc' })[1] as Extract<DevEventBody, { type: 'agent' }>;
    expect(map({ hook_event_name: 'UserPromptSubmit' })).toEqual([
      { type: 'agent.remove', agentId: interrupted.agentId },
      expect.objectContaining({ type: 'agent', status: 'working' }),
    ]);
  });

  it('maps Codex turn-complete notifications', () => {
    const events = new AgentHookMapper().map(sanitizeHookPayload({ type: 'agent-turn-complete', 'last-assistant-message': 'secret diff' }));
    expect(events).toEqual([{ type: 'agent', agentId: 'codex', name: 'Codex', role: 'copilot', status: 'done', detail: 'Turn complete — your move' }]);
  });
});

describe('sanitizeHookPayload', () => {
  it('keeps metadata and drops prompts, tool inputs and outputs', () => {
    const clean = sanitizeHookPayload({
      hook_event_name: 'PreToolUse',
      session_id: SESSION,
      transcript_path: '/Users/me/.claude/projects/acme/123.jsonl',
      cwd: '/Users/me/acme',
      prompt: 'the password is hunter2',
      tool_name: 'Task',
      tool_use_id: 'toolu_1',
      tool_input: { subagent_type: 'code-reviewer', prompt: 'review hunter2.ts', command: 'cat .env' },
      tool_response: { stdout: 'API_KEY=sk-123' },
      message: 'hunter2',
    });
    expect(clean).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: SESSION,
      tool_name: 'Task',
      tool_use_id: 'toolu_1',
      subagent_type: 'code-reviewer',
    });
    expect(JSON.stringify(clean)).not.toMatch(/hunter2|sk-123|acme|\.env/);
  });

  it('copes with junk', () => {
    expect(sanitizeHookPayload(null)).toEqual({});
    expect(sanitizeHookPayload('PreToolUse')).toEqual({});
    expect(sanitizeHookPayload({ hook_event_name: 42, tool_input: 'x' })).toEqual({});
    expect(sanitizeHookPayload({ hook_event_name: 'x'.repeat(500) }).hook_event_name).toHaveLength(40);
  });
});

describe('parseNeutralAgentEvent', () => {
  it('validates provider-neutral events', () => {
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'Aider', status: 'tool', role: 'eng', detail: 'Editing' })).toMatchObject({
      status: 'tool',
      role: 'eng',
    });
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'Aider', status: 'dancing' })).toBeUndefined();
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'A', status: 'idle', context: 7 })).toMatchObject({ context: undefined });
    expect(parseNeutralAgentEvent({ type: 'agent.remove', agentId: 'a' })).toEqual({ type: 'agent.remove', agentId: 'a' });
  });
});
