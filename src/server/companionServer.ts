import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { setInterval, clearInterval } from 'node:timers';
import type { DevEventBody } from '../core/events';
import { AgentHookMapper, parseNeutralAgentEvent, sanitizeHookPayload } from '../core/hooks';
import { isClientCommand, type Catalog, type ClientCommand, type ClientPrefs, type HostInfo, type HostMessage, type TourSnapshot } from '../core/protocol';
import { companionCsp, makeNonce, renderAppHtml } from '../host/html';
import { removeSessionFile, vibetourHome, writeSessionFile } from './sessionFile';

/**
 * Companion Mode server (PRD §7 Mode D, §33): serves the browser app to a
 * second screen over Server-Sent Events and receives coding-agent hook events.
 *
 * Bound to loopback and token-protected. Requests must carry a loopback Host
 * header (DNS-rebinding guard); every route except the health check needs the
 * token. No CORS headers are ever sent. Host-agnostic: no `vscode` import.
 */

export interface CompanionServerOptions {
  /** Preferred port; 0 picks a free one. Falls back to a free port when busy. */
  port: number;
  host?: string;
  token: string;
  /** Directory holding the built browser app (app.js, app.css, favicon.svg). */
  staticDir: string;
  hostInfo(): HostInfo;
  catalog(): Catalog;
  snapshot(): TourSnapshot | undefined;
  prefs?(): Partial<ClientPrefs> | undefined;
  onCommand(cmd: ClientCommand): void | Promise<void>;
  onAgentEvents(events: DevEventBody[]): void;
  /** Write `~/.vibetour/companion.json` on start and remove it on stop. */
  sessionFile?: boolean;
  log?(msg: string): void;
}

export const COMMAND_LIMIT = 64 * 1024;
export const AGENT_EVENT_LIMIT = 16 * 1024;
const KEEPALIVE_MS = 20_000;
const MAX_STREAMS = 32;
/** A display this far behind on the stream is dropped (it will reconnect). */
const MAX_BUFFERED = 4 * 1024 * 1024;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

const NO_TOKEN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VibeTour</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; line-height: 1.5">
<h1>VibeTour Companion</h1>
<p>This display needs its access link. In VS Code run <b>VibeTour: Open Companion Display</b>
or <b>VibeTour: Copy Companion Display URL</b>; from a terminal, use the URL printed by <code>vibetour</code>.</p>
</body></html>
`;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Stream {
  res: ServerResponse;
}

export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Loopback hostname with any port: what a browser sends for our own pages. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(host.trim().toLowerCase());
  return !!m && LOOPBACK_HOSTS.has(m[1]);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && isLoopbackHost(u.host);
  } catch {
    return false;
  }
}

export class CompanionServer {
  private readonly server: Server;
  private readonly streams = new Set<Stream>();
  private readonly mapper = new AgentHookMapper();
  private readonly tokenDigest: Buffer;
  private readonly staticRoot: string;
  private keepAlive?: ReturnType<typeof setInterval>;
  private boundPort = 0;
  /** Where this server wrote its session file, if it did. */
  private sessionHome?: string;

  constructor(private readonly opts: CompanionServerOptions) {
    this.tokenDigest = digest(opts.token);
    this.staticRoot = resolve(opts.staticDir);
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => this.fail(res, err));
    });
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 30_000;
    this.server.on('clientError', (_err, socket) => socket.destroy());
  }

  get port(): number {
    return this.boundPort;
  }

  get url(): string {
    return this.boundPort ? `http://127.0.0.1:${this.boundPort}/?token=${this.opts.token}` : '';
  }

  /** Base URL for agent integrations (`VIBETOUR_URL`). */
  get origin(): string {
    return this.boundPort ? `http://127.0.0.1:${this.boundPort}` : '';
  }

  get clientCount(): number {
    return this.streams.size;
  }

  async start(): Promise<{ port: number; url: string }> {
    const host = this.opts.host ?? '127.0.0.1';
    try {
      await this.listen(this.opts.port, host);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || this.opts.port === 0) throw err;
      this.log(`Port ${this.opts.port} is busy; using a free port instead.`);
      await this.listen(0, host);
    }
    this.boundPort = (this.server.address() as AddressInfo).port;
    this.server.on('error', (err) => this.log(`Companion server error: ${err.message}`));
    this.keepAlive = setInterval(() => this.writeAll(': keep-alive\n\n'), KEEPALIVE_MS);
    this.keepAlive.unref();
    if (this.opts.sessionFile) {
      const home = vibetourHome();
      try {
        writeSessionFile({ port: this.boundPort, token: this.opts.token, pid: process.pid, url: this.url, startedAt: Date.now() }, home);
        this.sessionHome = home;
      } catch (err) {
        this.log(`Could not write the companion session file: ${(err as Error).message}`);
      }
    }
    return { port: this.boundPort, url: this.url };
  }

  broadcast(msg: HostMessage): void {
    if (!this.streams.size) return;
    const frame = `data: ${JSON.stringify(msg)}\n\n`;
    for (const s of this.streams) {
      // Snapshots supersede each other: skip them for a display that is behind.
      if (msg.type === 'snapshot' && s.res.writableNeedDrain) continue;
      this.write(s, frame);
    }
  }

  async stop(): Promise<void> {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    for (const s of this.streams) s.res.end();
    this.streams.clear();
    if (this.sessionHome) {
      removeSessionFile(process.pid, this.sessionHome);
      this.sessionHome = undefined;
    }
    if (!this.server.listening) return;
    await new Promise<void>((done) => {
      this.server.close(() => done());
      this.server.closeAllConnections?.();
    });
    this.boundPort = 0;
  }

  // ------------------------------------------------------------------ routing

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackHost(req.headers.host)) return this.send(res, 403, 'Forbidden');
    const rawUrl = req.url ?? '/';
    const q = rawUrl.indexOf('?');
    const path = q < 0 ? rawUrl : rawUrl.slice(0, q);
    const query = new URLSearchParams(q < 0 ? '' : rawUrl.slice(q + 1));
    const method = req.method ?? 'GET';
    const origin = req.headers.origin;
    if (method !== 'GET' && method !== 'HEAD' && origin !== undefined && !isLoopbackOrigin(origin)) {
      return this.send(res, 403, 'Forbidden');
    }

    switch (path) {
      case '/api/health':
        return this.json(res, 200, { ok: true, name: 'vibetour' });
      case '/':
      case '/index.html':
        if (method !== 'GET' && method !== 'HEAD') return this.send(res, 405, 'Method Not Allowed');
        if (!this.authorized(req, query)) return this.send(res, 401, NO_TOKEN_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });
        return this.page(res);
      case '/events':
        if (method !== 'GET') return this.send(res, 405, 'Method Not Allowed');
        if (!this.authorized(req, query)) return this.send(res, 401, 'Unauthorized');
        return this.openStream(res);
      case '/command':
        if (method !== 'POST') return this.send(res, 405, 'Method Not Allowed');
        if (!this.authorized(req, query)) return this.send(res, 401, 'Unauthorized');
        return this.command(req, res);
      case '/api/agent-event':
        if (method !== 'POST') return this.send(res, 405, 'Method Not Allowed');
        if (!this.authorized(req, query)) return this.send(res, 401, 'Unauthorized');
        return this.agentEvent(req, res);
      default:
        if (method !== 'GET' && method !== 'HEAD') return this.send(res, 404, 'Not Found');
        return this.asset(res, path, method === 'HEAD');
    }
  }

  private authorized(req: IncomingMessage, query: URLSearchParams): boolean {
    const auth = req.headers.authorization;
    const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, '').trim() : undefined;
    const token = query.get('token') ?? bearer;
    if (!token) return false;
    // Compare fixed-length digests so neither content nor length leaks through timing.
    return timingSafeEqual(digest(token), this.tokenDigest);
  }

  private page(res: ServerResponse): void {
    const nonce = makeNonce();
    const html = renderAppHtml({ boot: { host: 'companion', token: this.opts.token }, nonce });
    this.send(res, 200, html, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': companionCsp(nonce),
    });
  }

  private async asset(res: ServerResponse, rawPath: string, headOnly: boolean): Promise<void> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      return this.send(res, 404, 'Not Found');
    }
    const segments = decoded.split(/[\\/]+/).filter(Boolean);
    const type = MIME[extname(decoded).toLowerCase()];
    const file = resolve(this.staticRoot, ...segments);
    if (
      !type ||
      decoded.includes('\0') ||
      segments.some((s) => s.startsWith('.')) ||
      !file.startsWith(this.staticRoot + sep)
    ) {
      return this.send(res, 404, 'Not Found');
    }
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return this.send(res, 404, 'Not Found');
    }
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
    res.end(headOnly ? undefined : body);
  }

  private openStream(res: ServerResponse): void {
    if (this.streams.size >= MAX_STREAMS) return this.send(res, 503, 'Too many displays');
    res.writeHead(200, {
      ...BASE_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.socket?.setNoDelay(true);
    res.socket?.setKeepAlive(true);
    const stream: Stream = { res };
    this.streams.add(stream);
    res.on('close', () => this.streams.delete(stream));
    res.on('error', () => this.streams.delete(stream));
    this.write(stream, 'retry: 2000\n\n');
    this.greet(stream);
  }

  private greet(stream: Stream): void {
    this.write(stream, `data: ${JSON.stringify(this.hello())}\n\n`);
    const snapshot = this.opts.snapshot();
    if (snapshot) this.write(stream, `data: ${JSON.stringify({ type: 'snapshot', snapshot } satisfies HostMessage)}\n\n`);
  }

  private hello(): HostMessage {
    const prefs = this.opts.prefs?.();
    return { type: 'hello', host: this.opts.hostInfo(), catalog: this.opts.catalog(), ...(prefs ? { prefs } : {}) };
  }

  private async command(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cmd = parseJson(await readBody(req, COMMAND_LIMIT));
    if (!isClientCommand(cmd)) return this.send(res, 400, 'Bad Request');
    if (cmd.type === 'ready') {
      // A display (re)connected: greeting everyone again is harmless.
      for (const s of this.streams) this.greet(s);
    } else {
      try {
        // Commands may open dialogs; answer the display without waiting for them.
        Promise.resolve(this.opts.onCommand(cmd)).catch((err: unknown) => this.log(`Command ${cmd.type} failed: ${String(err)}`));
      } catch (err) {
        this.log(`Command ${cmd.type} failed: ${String(err)}`);
        return this.send(res, 500, 'Internal Server Error');
      }
    }
    this.send(res, 204, '');
  }

  private async agentEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = parseJson(await readBody(req, AGENT_EVENT_LIMIT));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return this.send(res, 400, 'Bad Request');
    const body = raw as Record<string, unknown>;
    let events: DevEventBody[];
    if (typeof body.hook_event_name === 'string' || body.type === 'agent-turn-complete') {
      events = this.mapper.map(sanitizeHookPayload(body));
    } else {
      const event = parseNeutralAgentEvent(body);
      if (!event) return this.send(res, 400, 'Bad Request');
      events = [event];
    }
    if (events.length) this.opts.onAgentEvents(events);
    this.send(res, 202, '');
  }

  // ------------------------------------------------------------------ helpers

  private listen(port: number, host: string): Promise<void> {
    return new Promise((done, fail) => {
      const onError = (err: Error) => fail(err);
      this.server.once('error', onError);
      this.server.listen(port, host, () => {
        this.server.off('error', onError);
        done();
      });
    });
  }

  private write(stream: Stream, frame: string): void {
    const res = stream.res;
    if (res.writableEnded || res.destroyed) {
      this.streams.delete(stream);
      return;
    }
    if (res.writableLength > MAX_BUFFERED) {
      this.streams.delete(stream);
      res.destroy();
      return;
    }
    res.write(frame);
  }

  private writeAll(frame: string): void {
    for (const s of this.streams) this.write(s, frame);
  }

  private send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const payload = status === 204 ? '' : body;
    res.writeHead(status, {
      ...BASE_HEADERS,
      'Cache-Control': 'no-store',
      ...(payload ? { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers,
      ...(status === 413 ? { Connection: 'close' } : {}),
    });
    res.end(payload);
  }

  private json(res: ServerResponse, status: number, value: unknown): void {
    this.send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  private fail(res: ServerResponse, err: unknown): void {
    if (err instanceof HttpError) return this.send(res, err.status, err.message);
    this.log(`Companion request failed: ${String(err)}`);
    this.send(res, 500, 'Internal Server Error');
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((done, fail) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      req.resume();
      fail(new HttpError(413, 'Payload Too Large'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        fail(new HttpError(413, 'Payload Too Large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!over) done(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(err));
  });
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Bad Request');
  }
}
