import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevEventBody } from '../src/core/events';
import type { ClientCommand, HostMessage } from '../src/core/protocol';
import { CompanionServer, generateToken } from '../src/server/companionServer';
import { readSessionFile, removeSessionFile, sessionFilePath, writeSessionFile } from '../src/server/sessionFile';
import { makeSession } from './helpers';

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function call(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers: opts.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

function postJson(port: number, path: string, value: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  return call(port, { method: 'POST', path, body: JSON.stringify(value), headers: { 'content-type': 'application/json', ...headers } });
}

/** Reads `count` SSE messages, then disconnects. */
function readEvents(port: number, path: string, count: number): Promise<HostMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: HostMessage[] = [];
    let buffer = '';
    const req = request({ host: '127.0.0.1', port, path }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`status ${res.statusCode}`));
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of frame.split('\n')) if (line.startsWith('data: ')) messages.push(JSON.parse(line.slice(6)));
          if (messages.length >= count) {
            req.destroy();
            resolve(messages.slice(0, count));
            return;
          }
        }
      });
    });
    req.on('error', (err) => (messages.length >= count ? undefined : reject(err)));
    req.end();
  });
}

const SECRET = 'sk-live-SUPER-SECRET-123';

describe('CompanionServer', () => {
  let home: string;
  let staticDir: string;
  let server: CompanionServer;
  let port: number;
  const token = generateToken();
  const commands: ClientCommand[] = [];
  const agentEvents: DevEventBody[][] = [];
  const { session } = makeSession();
  const q = `?token=${token}`;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'vibetour-home-'));
    staticDir = mkdtempSync(join(tmpdir(), 'vibetour-static-'));
    process.env.VIBETOUR_HOME = home;
    writeFileSync(join(staticDir, 'app.js'), 'console.log("app")');
    writeFileSync(join(staticDir, 'app.css'), 'body{}');
    writeFileSync(join(staticDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    session.startJourney('california-coast', 'day-trip');
    server = new CompanionServer({
      port: 0,
      token,
      staticDir,
      hostInfo: () => ({ kind: 'cli', version: 'test', capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false } }),
      catalog: () => session.catalog(),
      snapshot: () => session.latestSnapshot,
      prefs: () => ({ mode: 'tour' }),
      onCommand: (cmd) => {
        commands.push(cmd);
        session.handleCommand(cmd);
      },
      onAgentEvents: (events) => agentEvents.push(events),
      sessionFile: true,
    });
    ({ port } = await server.start());
  });

  afterAll(async () => {
    await server.stop();
    rmSync(home, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    commands.length = 0;
    agentEvents.length = 0;
  });

  it('answers the health check without a token', async () => {
    const r = await call(port, { path: '/api/health' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, name: 'vibetour' });
  });

  it('requires the token on protected routes', async () => {
    expect((await call(port, { path: '/events' })).status).toBe(401);
    expect((await call(port, { path: '/events?token=nope' })).status).toBe(401);
    expect((await postJson(port, '/command', { type: 'park' })).status).toBe(401);
    expect((await postJson(port, '/api/agent-event', { hook_event_name: 'Stop' })).status).toBe(401);
    const page = await call(port, { path: '/' });
    expect(page.status).toBe(401);
    expect(page.body).toMatch(/Open Companion Display/);
    expect(page.body).not.toContain(token);
  });

  it('rejects foreign Host headers (DNS rebinding) and cross-site origins', async () => {
    expect((await call(port, { path: `/${q}`, headers: { host: `evil.example:${port}` } })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { host: `127.0.0.1.evil.example:${port}` } })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { host: `localhost:${port}` } })).status).toBe(200);
    expect((await call(port, { path: '/api/health', headers: { host: `[::1]:${port}` } })).status).toBe(200);
    const crossSite = await postJson(port, `/command${q}`, { type: 'park' }, { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
    expect(commands).toHaveLength(0);
  });

  it('serves the app page with the boot object, a nonce and a CSP', async () => {
    const r = await call(port, { path: `/${q}` });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const csp = String(r.headers['content-security-policy']);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(r.body).toContain(`<script nonce="${nonce}">window.__VIBETOUR_BOOT__ = {"host":"companion","token":"${token}"};</script>`);
    expect(r.body).toContain(`<script nonce="${nonce}" src="app.js"></script>`);
    expect(r.body).toContain('<link rel="stylesheet" href="app.css">');
    expect(r.body).toContain('<div id="app"></div>');
    // A fresh nonce per page.
    const again = await call(port, { path: `/${q}` });
    expect(again.headers['content-security-policy']).not.toBe(csp);
  });

  it('serves static assets with the right content types and nothing else', async () => {
    const js = await call(port, { path: '/app.js' });
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    expect((await call(port, { path: '/app.css' })).headers['content-type']).toMatch(/^text\/css/);
    expect((await call(port, { path: '/favicon.svg' })).headers['content-type']).toBe('image/svg+xml');
    expect((await call(port, { path: '/missing.js' })).status).toBe(404);
    expect((await call(port, { path: '/..%2fpackage.json' })).status).toBe(404);
    expect((await call(port, { path: '/../package.json' })).status).toBe(404);
    expect((await call(port, { path: '/%2e%2e/%2e%2e/package.json' })).status).toBe(404);
    expect((await call(port, { path: '/.env' })).status).toBe(404);
  });

  it('streams hello then the latest snapshot to a new display', async () => {
    session.tick();
    const [hello, snapshot] = await readEvents(port, `/events${q}`, 2);
    expect(hello.type).toBe('hello');
    if (hello.type !== 'hello') throw new Error('unreachable');
    expect(hello.host.kind).toBe('cli');
    expect(hello.catalog.activeJourney?.packId).toBe('california-coast');
    expect(hello.prefs).toEqual({ mode: 'tour' });
    expect(snapshot.type).toBe('snapshot');
  });

  it('broadcasts to connected displays', async () => {
    // Let the previous test's stream finish closing, then count ours.
    await vi.waitFor(() => expect(server.clientCount).toBe(0));
    const pending = readEvents(port, `/events${q}`, 3);
    await vi.waitFor(() => expect(server.clientCount).toBe(1));
    server.broadcast({ type: 'toast', text: 'Hello from the host' });
    const messages = await pending;
    expect(messages[2]).toEqual({ type: 'toast', text: 'Hello from the host' });
    await vi.waitFor(() => expect(server.clientCount).toBe(0));
  });

  it('passes valid commands to the host and rejects invalid ones', async () => {
    const ok = await postJson(port, `/command${q}`, { type: 'setObjective', objective: 'Ship it' });
    expect(ok.status).toBe(204);
    expect(commands).toEqual([{ type: 'setObjective', objective: 'Ship it' }]);
    expect(session.activeJourney?.objective).toBe('Ship it');
    expect((await postJson(port, `/command${q}`, { type: 'rm -rf' })).status).toBe(400);
    expect((await call(port, { method: 'POST', path: `/command${q}`, body: '{not json' })).status).toBe(400);
    expect((await call(port, { method: 'GET', path: `/command${q}` })).status).toBe(405);
    expect(commands).toHaveLength(1);
  });

  it('answers `ready` with hello itself instead of forwarding it', async () => {
    expect((await postJson(port, `/command${q}`, { type: 'ready' })).status).toBe(204);
    expect(commands).toHaveLength(0);
  });

  it('maps Claude Code hook payloads without passing their content on', async () => {
    const r = await postJson(
      port,
      '/api/agent-event',
      {
        hook_event_name: 'PreToolUse',
        session_id: 'abcdef1234567890',
        tool_name: 'Bash',
        tool_input: { command: `curl -H "Authorization: ${SECRET}" https://api.example.com` },
        transcript_path: '/home/me/.claude/projects/secret.jsonl',
        cwd: '/home/me/secret-project',
      },
      { authorization: `Bearer ${token}` },
    );
    expect(r.status).toBe(202);
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0]).toEqual([{ type: 'agent', agentId: 'claude:abcdef12', name: 'Claude', role: 'copilot', status: 'tool', detail: 'Using Bash' }]);
    const json = JSON.stringify(agentEvents);
    for (const leak of [SECRET, 'api.example.com', 'secret.jsonl', 'secret-project']) expect(json).not.toContain(leak);
  });

  it('accepts provider-neutral agent events and rejects junk', async () => {
    const r = await postJson(port, `/api/agent-event${q}`, { type: 'agent', agentId: 'aider:1', name: 'Aider', status: 'working', context: 0.4 });
    expect(r.status).toBe(202);
    expect(agentEvents[0]).toEqual([{ type: 'agent', agentId: 'aider:1', name: 'Aider', status: 'working', context: 0.4 }]);
    expect((await postJson(port, `/api/agent-event${q}`, { hello: 'world' })).status).toBe(400);
    expect((await postJson(port, `/api/agent-event${q}`, [1, 2])).status).toBe(400);
    expect(agentEvents).toHaveLength(1);
  });

  it('limits request bodies', async () => {
    const big = { type: 'agent', agentId: 'x', name: 'X', status: 'working', detail: 'y'.repeat(17 * 1024) };
    expect((await postJson(port, `/api/agent-event${q}`, big)).status).toBe(413);
    const huge = { type: 'setObjective', objective: 'z'.repeat(65 * 1024) };
    expect((await postJson(port, `/command${q}`, huge)).status).toBe(413);
    expect(agentEvents).toHaveLength(0);
    expect(commands).toHaveLength(0);
  });

  it('writes a private session file for hooks to find', () => {
    const info = readSessionFile(home);
    expect(info).toMatchObject({ port, token, pid: process.pid, url: server.url });
    expect(server.url).toBe(`http://127.0.0.1:${port}/?token=${token}`);
    if (process.platform !== 'win32') {
      expect(statSync(sessionFilePath(home)).mode & 0o777).toBe(0o600);
      expect(statSync(home).mode & 0o777).toBe(0o700);
    }
  });
});

describe('CompanionServer lifecycle', () => {
  const base = {
    token: generateToken(),
    staticDir: tmpdir(),
    hostInfo: () => ({ kind: 'cli' as const, version: 'test', capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false } }),
    catalog: () => makeSession().session.catalog(),
    snapshot: () => undefined,
    onCommand: () => undefined,
    onAgentEvents: () => undefined,
  };

  it('falls back to a free port when the preferred one is busy', async () => {
    const first = new CompanionServer({ ...base, port: 0 });
    const { port } = await first.start();
    const second = new CompanionServer({ ...base, port });
    const started = await second.start();
    expect(started.port).not.toBe(port);
    expect((await call(started.port, { path: '/api/health' })).status).toBe(200);
    await Promise.all([first.stop(), second.stop()]);
  });

  it('removes its session file on stop, but never one another process wrote', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vibetour-home-'));
    process.env.VIBETOUR_HOME = home;
    try {
      const server = new CompanionServer({ ...base, port: 0, sessionFile: true });
      await server.start();
      expect(existsSync(sessionFilePath(home))).toBe(true);
      await server.stop();
      expect(existsSync(sessionFilePath(home))).toBe(false);

      writeSessionFile({ port: 1, token: 't', pid: process.pid + 1, url: '', startedAt: 0 }, home);
      expect(removeSessionFile(process.pid, home)).toBe(false);
      expect(JSON.parse(readFileSync(sessionFilePath(home), 'utf8')).pid).toBe(process.pid + 1);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('takes the session file over when the server that owned it closes or dies', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vibetour-home-'));
    process.env.VIBETOUR_HOME = home;
    try {
      const server = new CompanionServer({ ...base, port: 0, sessionFile: true });
      const { port } = await server.start();
      // A newer window that is still running owns it: leave it alone.
      writeSessionFile({ port: 1, token: 't', pid: process.ppid, url: '', startedAt: 0 }, home);
      server.claimSessionFile();
      expect(readSessionFile(home)?.port).toBe(1);
      // That window closed and removed it.
      rmSync(sessionFilePath(home));
      server.claimSessionFile();
      expect(readSessionFile(home)).toMatchObject({ port, pid: process.pid });
      // Or it crashed and left it behind.
      writeSessionFile({ port: 1, token: 't', pid: 2_147_483_646, url: '', startedAt: 0 }, home);
      server.claimSessionFile();
      expect(readSessionFile(home)?.port).toBe(port);
      await server.stop();
      expect(existsSync(sessionFilePath(home))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
