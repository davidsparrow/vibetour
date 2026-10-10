import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
      hostInfo: () => ({ kind: 'cli', version: 'test', capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false } }),
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
