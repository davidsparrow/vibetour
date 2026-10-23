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

  it('stops for a question or a plan and says which, even when a permission prompt follows', () => {
    const { session, clock, emit } = makeSession();
    session.startJourney('california-coast', 'day-trip');
    const mapper = new AgentHookMapper();
    const hook = (payload: Record<string, unknown>) => {
      for (const e of mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }))) emit(e);
      clock.advance(250);
    };
    const snap = () => session.latestSnapshot!;
    const claude = () => snap().ide.agents.find((a) => a.id === 'claude:f00dcafe');

    hook({ hook_event_name: 'UserPromptSubmit' });
    hook({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'hunter2?' }] } });
    expect(claude()).toMatchObject({ status: 'waiting', ask: 'question', detail: 'Has a question for you' });
    clock.advance(5_000);
    expect(snap().motion).toMatchObject({ stopped: true, stopReason: 'waiting' });
    expect(snap().activity.waitingAsk).toBe('question');
    expect(snap().motion.caption).toMatch(/Claude has a question for you$/);
    expect(snap().attention).toEqual([expect.objectContaining({ kind: 'question', text: 'Claude has a question', target: { type: 'agent', agentId: 'claude:f00dcafe' } })]);
    // The stop card shows the alert that stopped the car.
    expect(snap().motion.stopAlert).toBe(snap().attention[0].id);
    expect(snap().ide.history[0].label).toBe('Claude has a question');

    hook({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' });
    expect(claude()?.status).toBe('working');
    expect(snap().attention).toEqual([]);

    hook({ hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode' });
    hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    expect(claude()).toMatchObject({ status: 'waiting', ask: 'plan' });
    expect(snap().attention[0]).toMatchObject({ kind: 'plan', text: 'Claude has a plan to approve' });
  });

  it('names the tool a permission prompt is for', () => {
    const mapper = new AgentHookMapper();
    const map = (payload: Record<string, unknown>) => mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
    expect(map({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf hunter2' } })).toMatchObject([{ status: 'tool', detail: 'Using Bash' }]);
    expect(map({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toEqual([
      { type: 'agent', agentId: 'claude:f00dcafe', name: 'Claude', role: 'copilot', status: 'waiting', ask: 'approval', tool: 'Bash', detail: 'Needs your approval to use Bash' },
    ]);
    // Once the tool has run, a later prompt can't be pinned on it.
    map({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    expect(map({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toMatchObject([{ ask: 'approval', detail: 'Needs your approval' }]);
  });

  it('waits for MCP input requests and ignores notices that ask nothing', () => {
    const mapper = new AgentHookMapper();
    const map = (payload: Record<string, unknown>) => mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
    expect(map({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' })).toMatchObject([{ status: 'waiting', ask: 'question', detail: 'Needs your input' }]);
    for (const notification_type of ['elicitation_complete', 'elicitation_response', 'agent_completed', 'quota_auto_resume_fired', 'something_new']) {
      expect(map({ hook_event_name: 'Notification', notification_type }), notification_type).toEqual([]);
    }
  });

  it('pulls over when a turn ends on an API error, and says which', () => {
    const { session, clock, emit } = makeSession();
    session.startJourney('california-coast', 'day-trip');
    const mapper = new AgentHookMapper();
    const hook = (payload: Record<string, unknown>) => {
      const events = mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
      for (const e of events) emit(e);
      clock.advance(250);
      return events;
    };
    hook({ hook_event_name: 'UserPromptSubmit' });
    const crew = hook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_x', subagent_type: 'Explore' })[1] as Extract<DevEventBody, { type: 'agent' }>;
    const events = hook({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429 hunter2', last_assistant_message: 'API Error: hunter2' });
    expect(events).toEqual([
      { type: 'agent.remove', agentId: crew.agentId },
      { type: 'agent', agentId: 'claude:f00dcafe', name: 'Claude', role: 'copilot', status: 'error', detail: 'Stopped: rate limit' },
    ]);
    clock.advance(5_000);
    const snap = session.latestSnapshot!;
    expect(snap.motion.behavior).toBe('pull-over');
    expect(snap.activity.blockedDetail).toBe('Stopped: rate limit');
    expect(snap.attention).toEqual([expect.objectContaining({ kind: 'problem', text: 'Claude stopped · rate limit' })]);
    expect(snap.motion.stopAlert).toBe('agent:claude:f00dcafe');

    // Unknown kinds are read out plainly; prototype names are just names.
    expect(mapper.map(sanitizeHookPayload({ session_id: SESSION, hook_event_name: 'StopFailure', error: 'new_kind' }))).toMatchObject([{ detail: 'Stopped: new kind' }]);
    expect(mapper.map(sanitizeHookPayload({ session_id: SESSION, hook_event_name: 'StopFailure', error: 'constructor' }))).toMatchObject([{ detail: 'Stopped: constructor' }]);
    expect(mapper.map(sanitizeHookPayload({ session_id: SESSION, hook_event_name: 'StopFailure' }))).toMatchObject([{ detail: 'Stopped: API error' }]);
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

describe('context readings', () => {
  it('gives the co-pilot the reading its hooks carry, and the status line updates it without counting as activity', () => {
    const { session, clock, emit } = makeSession();
    const mapper = new AgentHookMapper();
    const hook = (payload: Record<string, unknown>) => {
      const events = mapper.map(sanitizeHookPayload({ session_id: SESSION, ...payload }));
      for (const e of events) emit(e);
      clock.advance(250);
      return events;
    };
    const snap = () => session.latestSnapshot!;

    hook({ hook_event_name: 'UserPromptSubmit' });
    expect(snap().activity.context).toBeNull();

    const pre = hook({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_use_id: 'toolu_1', tool_input: { subagent_type: 'Explore' }, context: 0.31 });
    expect(pre).toMatchObject([{ role: 'copilot', context: 0.31 }, { parentId: 'claude:f00dcafe' }]);
    expect(pre[1]).not.toHaveProperty('context');
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_use_id: 'toolu_1', context: 0.42 });
    expect(snap().activity.context).toBeCloseTo(0.42);

    hook({ hook_event_name: 'Stop', context: 0.45 });
    clock.advance(60_000);
    const before = snap().activity;
    expect(hook({ hook_event_name: 'StatusLine', context: 0.47 })).toEqual([{ type: 'agent.context', agentId: 'claude:f00dcafe', context: 0.47 }]);
    expect(snap().activity.context).toBeCloseTo(0.47);
    expect(snap().activity.agentActivity).toBeLessThanOrEqual(before.agentActivity);
    expect(snap().ide.agents.find((a) => a.id === 'claude:f00dcafe')?.status).toBe('done');

    // A status line without a reading, or for a session that never sent a hook, changes nothing.
    expect(hook({ hook_event_name: 'StatusLine' })).toEqual([]);
    expect(mapper.map(sanitizeHookPayload({ hook_event_name: 'StatusLine', session_id: 'beefbeef', context: 0.9 }))).toHaveLength(1);
    emit({ type: 'agent.context', agentId: 'claude:beefbeef', context: 0.9 });
    clock.advance(250);
    expect(snap().activity.context).toBeCloseTo(0.47);
  });

  it('keeps only readings between 0 and 1', () => {
    expect(sanitizeHookPayload({ hook_event_name: 'Stop', context: 0.5 }).context).toBe(0.5);
    for (const context of [-0.1, 1.5, '0.5', Number.NaN, null]) expect(sanitizeHookPayload({ hook_event_name: 'Stop', context })).not.toHaveProperty('context');
  });
});

describe('cache readings', () => {
  const T = Date.UTC(2026, 9, 21, 9, 0);
  const reply = (id: string, at: number, read: number, write: number, ttl?: number) => ({ id, at, read, write, fresh: 2, ...(ttl ? { ttl } : {}) });

  it("adds up the session's hit share once per reply, keeps the latest call, and follows the Context gauge's session", () => {
    const { session, clock, emit } = makeSession();
    const mapper = new AgentHookMapper();
    const hook = (payload: Record<string, unknown>, sessionId = SESSION) => {
      const events = mapper.map(sanitizeHookPayload({ session_id: sessionId, ...payload }));
      for (const e of events) emit(e);
      clock.advance(250);
      return events;
    };
    const cache = () => session.latestSnapshot!.activity.cache;

    hook({ hook_event_name: 'SessionStart' });
    expect(cache()).toBeNull();
    // A prompt brings only the time: no hit share yet, and no lifetime to count down.
    hook({ hook_event_name: 'UserPromptSubmit', cache: { at: T } });
    expect(cache()).toEqual({ hit: null, at: T });

    // A cold first reply writes everything; the crew never gets the reading.
    const pre = hook({ hook_event_name: 'PostToolUse', tool_name: 'Read', context: 0.1, cache: reply('msg_1', T + 5_000, 0, 9_998, 3600) });
    expect(pre.filter((e) => e.type === 'agent' && e.role !== 'copilot').some((e) => 'cache' in e)).toBe(false);
    expect(cache()).toEqual({ hit: 0, at: T + 5_000, ttl: 3600 });
    // Parallel tool calls bring the same reply back: it counts once.
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Grep', context: 0.1, cache: reply('msg_1', T + 5_000, 0, 9_998, 3600) });
    expect(cache()?.hit).toBe(0);
    // The next reply reads it all back and writes only its new turn; a reply that writes nothing keeps the lifetime.
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', context: 0.11, cache: reply('msg_2', T + 9_000, 10_000, 0) });
    expect(cache()).toEqual({ hit: 0.5, at: T + 9_000, ttl: 3600 });
    hook({ hook_event_name: 'Stop', context: 0.12, cache: reply('msg_3', T + 12_000, 10_000, 1_998, 3600) });
    expect(cache()?.hit).toBeCloseTo(20_000 / 32_000, 3);
    expect(session.latestSnapshot!.ide.agents.find((a) => a.id === 'claude:f00dcafe')?.cache).toEqual(cache());

    // Another session with a fuller window takes both readouts; a new session starts from nothing.
    hook({ hook_event_name: 'Stop', context: 0.6, cache: reply('msg_9', T + 20_000, 900, 98, 300) }, 'beefbeef-1');
    expect(cache()).toEqual({ hit: 0.9, at: T + 20_000, ttl: 300 });
  });

  it('keeps only well-formed readings', () => {
    expect(sanitizeHookPayload({ hook_event_name: 'Stop', cache: { id: 'msg_1', at: T, read: 5, write: 1, fresh: 2, ttl: 3600 } }).cache).toEqual({ id: 'msg_1', at: T, read: 5, write: 1, fresh: 2, ttl: 3600 });
    // A reading needs a time; bad counts are dropped together; a lifetime is 5 minutes or an hour.
    for (const cache of [{ read: 5 }, { at: -1 }, { at: 'now' }, 'cache', null]) expect(sanitizeHookPayload({ hook_event_name: 'Stop', cache })).not.toHaveProperty('cache');
    expect(sanitizeHookPayload({ hook_event_name: 'Stop', cache: { at: T, read: -5, write: 1, fresh: 2, ttl: 60 } }).cache).toEqual({ at: T });
    expect(sanitizeHookPayload({ hook_event_name: 'Stop', cache: { at: T, id: 'x'.repeat(200) } }).cache?.id).toHaveLength(80);
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

  it("keeps a StopFailure's error kind, never its details", () => {
    expect(sanitizeHookPayload({ hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '429', last_assistant_message: 'API Error' })).toEqual({
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
    });
    for (const error of ['Rate limit', 'rate-limit; rm -rf', 'x'.repeat(41), 42]) expect(sanitizeHookPayload({ error })).not.toHaveProperty('error');
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
    // What a waiting agent waits for, and the tool it wants approved.
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'Aider', status: 'waiting', ask: 'approval', tool: 'shell' })).toMatchObject({ ask: 'approval', tool: 'shell' });
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'Aider', status: 'waiting', ask: 'bribe' })).not.toHaveProperty('ask');
    expect(parseNeutralAgentEvent({ type: 'agent', agentId: 'a', name: 'Aider', status: 'working', ask: 'question' })).not.toHaveProperty('ask');
  });
});
