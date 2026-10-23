import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DevEventBody } from '../src/core/events';
import { CompanionServer, generateToken } from '../src/server/companionServer';
import { writeSessionFile } from '../src/server/sessionFile';

const HOOK = resolve(__dirname, '../bin/vibetour-hook.js');
const SECRET = 'ghp_TOTALLYSECRETTOKEN0123456789';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/** Runs the hook like an agent would, with a clean environment pointing at `home`. */
function runHook(home: string, opts: { stdin?: string; args?: string[]; env?: Record<string, string> } = {}): Promise<Run> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('VIBETOUR_')) env[k] = v;
  Object.assign(env, { VIBETOUR_HOME: home }, opts.env);
  const started = Date.now();
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [HOOK, ...(opts.args ?? [])], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', fail);
    child.on('close', (code) => done({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.on('error', () => undefined);
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
  });
}

describe('bin/vibetour-hook.js', () => {
  let home: string;
  let server: CompanionServer;
  const received: DevEventBody[][] = [];
  const token = generateToken();

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'vibetour-hook-'));
    process.env.VIBETOUR_HOME = home;
    server = new CompanionServer({
      port: 0,
      token,
      staticDir: home,
      hostInfo: () => ({ kind: 'cli', version: 'test', capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false, radio: false } }),
      catalog: () => {
        throw new Error('not needed');
      },
      snapshot: () => undefined,
      onCommand: () => undefined,
      onAgentEvents: (events) => received.push(events),
      sessionFile: true,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    rmSync(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    received.length = 0;
  });

  it('forwards a sanitized Claude Code hook event found via the session file', async () => {
    const payload = {
      session_id: '0123456789abcdef',
      transcript_path: '/home/me/.claude/projects/x.jsonl',
      cwd: '/home/me/project',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01',
      tool_input: { command: `git push https://${SECRET}@github.com/me/repo` },
    };
    const run = await runHook(home, { stdin: JSON.stringify(payload) });
    expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(received).toEqual([[{ type: 'agent', agentId: 'claude:01234567', name: 'Claude', role: 'copilot', status: 'tool', detail: 'Using Bash' }]]);
    expect(JSON.stringify(received)).not.toContain(SECRET);
  });

  it('forwards the kind of API error that ended a turn, never its details', async () => {
    const payload = {
      session_id: '0123456789abcdef',
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: `429 Too Many Requests ${SECRET}`,
      last_assistant_message: `API Error: ${SECRET}`,
    };
    const run = await runHook(home, { stdin: JSON.stringify(payload) });
    expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(received).toEqual([[{ type: 'agent', agentId: 'claude:01234567', name: 'Claude', role: 'copilot', status: 'error', detail: 'Stopped: rate limit' }]]);
    expect(JSON.stringify(received)).not.toContain(SECRET);
  });

  it('accepts Codex notify payloads as the last argument', async () => {
    const notify = { type: 'agent-turn-complete', 'turn-id': '1', 'last-assistant-message': SECRET, 'input-messages': ['secret'] };
    const run = await runHook(home, { args: ['--provider', 'codex', JSON.stringify(notify)] });
    expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(received).toEqual([[{ type: 'agent', agentId: 'codex', name: 'Codex', role: 'copilot', status: 'done', detail: 'Turn complete — your move' }]]);
  });

  it('prefers VIBETOUR_URL / VIBETOUR_TOKEN from the environment', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'vibetour-hook-empty-'));
    try {
      const run = await runHook(empty, {
        stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 'feedface' }),
        env: { VIBETOUR_URL: `http://127.0.0.1:${server.port}`, VIBETOUR_TOKEN: token },
      });
      expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(received[0]?.[0]).toMatchObject({ agentId: 'claude:feedface', status: 'done' });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('falls back to the session file when the environment target rejects the event', async () => {
    // A terminal that kept an old token after the companion restarted.
    const run = await runHook(home, {
      stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 'feedface' }),
      env: { VIBETOUR_URL: `http://127.0.0.1:${server.port}`, VIBETOUR_TOKEN: 'stale-token' },
    });
    expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(received).toHaveLength(1);
    expect(received[0][0]).toMatchObject({ agentId: 'claude:feedface', status: 'done' });
  });

  it('adds how full the context window is, from the transcript, and nothing else from it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibetour-transcript-'));
    const transcript = (name: string, entries: unknown[]) => {
      const file = join(dir, `${name}.jsonl`);
      writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
      return file;
    };
    const reply = (model: string, tokens: number, extra: Record<string, unknown> = {}) => ({
      type: 'assistant',
      isSidechain: false,
      ...extra,
      message: { model, content: [{ type: 'text', text: SECRET }], usage: { input_tokens: 2, cache_creation_input_tokens: 998, cache_read_input_tokens: tokens - 1000, output_tokens: 900 } },
    });
    const hook = async (event: string, file: string, env: Record<string, string> = {}) => {
      received.length = 0;
      const run = await runHook(home, { stdin: JSON.stringify({ hook_event_name: event, session_id: 'feedface', transcript_path: file, tool_name: 'Read' }), env });
      expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(JSON.stringify(received)).not.toContain(SECRET);
      return received[0]?.[0] as { context?: number } | undefined;
    };
    try {
      // A current model has a 1M window; the sub-agent's reply after it is not the session's.
      const opus = transcript('opus', [{ type: 'user', message: { content: SECRET } }, reply('claude-opus-5-5', 250_000), reply('claude-opus-5-5', 900_000, { isSidechain: true }), { type: 'user', message: { content: [{ type: 'tool_result', content: SECRET }] } }]);
      expect(await hook('Stop', opus)).toEqual({ type: 'agent', agentId: 'claude:feedface', name: 'Claude', role: 'copilot', status: 'done', detail: 'Finished — your turn', context: 0.25 });
      // Older models have 200K, unless the session has already gone past it.
      expect((await hook('PostToolUse', transcript('sonnet', [reply('claude-sonnet-4-5-20250929', 50_000)])))?.context).toBe(0.25);
      expect((await hook('PostToolUse', transcript('big', [reply('claude-sonnet-4-5-20250929', 300_000)])))?.context).toBe(0.3);
      expect((await hook('PostToolUse', opus, { VIBETOUR_CONTEXT_WINDOW: '500000' }))?.context).toBe(0.5);
      const opus150 = transcript('opus150', [reply('claude-opus-5-5', 150_000)]);
      expect((await hook('PostToolUse', opus150))?.context).toBe(0.15);
      expect((await hook('PostToolUse', opus150, { CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' }))?.context).toBe(0.75);
      // Just after a compaction there's no reading until the next reply.
      const compacted = transcript('compacted', [reply('claude-opus-5-5', 900_000), { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } }]);
      expect(await hook('Stop', compacted)).not.toHaveProperty('context');
      // Other events, a missing file and a relative path send no reading.
      expect(await hook('PreToolUse', opus)).not.toHaveProperty('context');
      expect(await hook('Stop', join(dir, 'missing.jsonl'))).not.toHaveProperty('context');
      expect(await hook('Stop', 'opus.jsonl')).not.toHaveProperty('context');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the last reply's cache counts, id, time and lifetime, and on a prompt just the time", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibetour-transcript-'));
    const transcript = (name: string, entries: unknown[]) => {
      const file = join(dir, `${name}.jsonl`);
      writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
      return file;
    };
    const at = '2026-10-21T08:24:43.186Z';
    const reply = (id: string, created: Record<string, number> | undefined, extra: Record<string, unknown> = {}) => ({
      type: 'assistant',
      isSidechain: false,
      timestamp: at,
      ...extra,
      message: {
        id,
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: SECRET }],
        usage: { input_tokens: 2, cache_creation_input_tokens: 382, cache_read_input_tokens: 88_818, output_tokens: 406, ...(created ? { cache_creation: created } : {}) },
      },
    });
    const hook = async (event: string, file?: string) => {
      received.length = 0;
      const run = await runHook(home, { stdin: JSON.stringify({ hook_event_name: event, session_id: 'feedface', transcript_path: file, prompt: SECRET }) });
      expect(run).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(JSON.stringify(received)).not.toContain(SECRET);
      return received[0]?.[0] as { context?: number; cache?: Record<string, unknown> } | undefined;
    };
    try {
      const expected = { id: 'msg_01', at: Date.parse(at), read: 88_818, write: 382, fresh: 2 };
      // An hour-long cache write, then a five-minute one; the sub-agent's reply after it is not the session's.
      const hour = transcript('hour', [reply('msg_01', { ephemeral_1h_input_tokens: 382, ephemeral_5m_input_tokens: 0 }), reply('msg_sub', { ephemeral_5m_input_tokens: 9 }, { isSidechain: true })]);
      expect((await hook('Stop', hour))?.cache).toEqual({ ...expected, ttl: 3600 });
      const five = transcript('five', [reply('msg_01', { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 382 })]);
      expect((await hook('PostToolUse', five))?.cache).toEqual({ ...expected, ttl: 300 });
      // No breakdown of the write: no lifetime. One reply over several entries is the same reply.
      const split = transcript('split', [reply('msg_01', undefined), reply('msg_01', undefined)]);
      expect((await hook('PostToolUse', split))?.cache).toEqual(expected);
      // No time, or just after a compaction: no cache reading.
      expect(await hook('Stop', transcript('untimed', [reply('msg_01', undefined, { timestamp: undefined })]))).not.toHaveProperty('cache');
      expect(await hook('Stop', transcript('compacted', [reply('msg_01', undefined), { type: 'system', subtype: 'compact_boundary' }]))).not.toHaveProperty('cache');
      // A prompt starts a call: the time, and nothing from the prompt.
      const before = Date.now();
      const prompt = await hook('UserPromptSubmit');
      expect(prompt?.cache).toEqual({ at: expect.any(Number) });
      expect(prompt?.cache?.at as number).toBeGreaterThanOrEqual(before);
      expect(await hook('PreToolUse', hour)).not.toHaveProperty('cache');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("in status line mode, sends Claude Code's own reading and prints a status line", async () => {
    const input = JSON.stringify({ session_id: 'cafebabe-1234', model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 42, context_window_size: 1_000_000 } });
    const run = await runHook(home, { args: ['--statusline'], stdin: input });
    expect(run).toMatchObject({ code: 0, stdout: 'Opus 5.5 · 58% context left', stderr: '' });
    expect(received).toEqual([[{ type: 'agent.context', agentId: 'claude:cafebabe', context: 0.42 }]]);

    // Wrapping the user's own status line: it gets the same input, and its output is what shows.
    received.length = 0;
    const echo = `"${process.execPath}" -e "process.stdin.pipe(process.stdout)"`;
    const wrapped = await runHook(home, { args: ['--statusline', echo], stdin: input });
    expect(wrapped).toMatchObject({ code: 0, stdout: input });
    expect(received).toHaveLength(1);

    // Before the first reply Claude Code has no reading yet.
    received.length = 0;
    const early = await runHook(home, { args: ['--statusline'], stdin: JSON.stringify({ session_id: 'cafebabe-1234', model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: null } }) });
    expect(early).toMatchObject({ code: 0, stdout: 'Opus 5.5' });
    expect(received).toHaveLength(0);
  });

  it('exits 0 quickly and silently when VibeTour is not running', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'vibetour-hook-empty-'));
    try {
      const none = await runHook(empty, { stdin: JSON.stringify({ hook_event_name: 'Stop' }) });
      expect(none).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(none.ms).toBeLessThan(1_500);

      // A stale session file pointing at a closed port.
      writeSessionFile({ port: 1, token: 'x', pid: process.pid, url: '', startedAt: 0 }, empty);
      const stale = await runHook(empty, { stdin: JSON.stringify({ hook_event_name: 'Stop' }) });
      expect(stale).toMatchObject({ code: 0, stdout: '', stderr: '' });
      expect(stale.ms).toBeLessThan(1_500);

      const junk = await runHook(empty, { stdin: 'not json at all' });
      expect(junk).toMatchObject({ code: 0, stdout: '', stderr: '' });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(received).toHaveLength(0);
  });
});
