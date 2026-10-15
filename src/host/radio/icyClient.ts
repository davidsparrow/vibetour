import { lookup } from 'node:dns/promises';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { firstPlaylistEntry, parseHeaders, parseStatusLine, streamKind } from './icy';

/**
 * A raw socket client for internet radio. Node's HTTP parser rejects
 * Shoutcast's `ICY 200 OK`, so this speaks just enough HTTP/1.0 itself: no
 * keep-alive and no chunked bodies, which HTTP/1.0 servers never send.
 */

/** A failure worth showing as-is ("Station offline"). */
export class RadioError extends Error {}

export interface IcyOpenOptions {
  userAgent: string;
  /** Connect and response-header timeout. */
  timeoutMs?: number;
  /** A stream this quiet is dropped. */
  stallMs?: number;
  maxRedirects?: number;
  /** Refuse loopback and private addresses (any URL from the directory). */
  publicOnly?: boolean;
}

export interface IcyStream {
  /** The URL that finally answered with audio. */
  url: string;
  contentType: string;
  /** Audio bytes between metadata blocks; 0 when the server sends none. */
  metaint: number;
  headers: Record<string, string>;
  /** Audio interleaved with metadata. Paused until read. */
  body: Socket;
  close(): void;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_PLAYLIST_BYTES = 64 * 1024;

export async function openIcy(url: string, opts: IcyOpenOptions): Promise<IcyStream> {
  let current = url;
  let playlists = 0;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 5); hop++) {
    const res = await request(current, opts);
    if (REDIRECTS.has(res.status)) {
      res.body.destroy();
      const next = res.headers.location;
      if (!next) throw new RadioError('Station offline (bad redirect)');
      current = new URL(next, current).toString();
      continue;
    }
    if (res.status !== 200) {
      res.body.destroy();
      throw new RadioError(`Station offline (${res.status})`);
    }
    if (/chunked/i.test(res.headers['transfer-encoding'] ?? '')) {
      res.body.destroy();
      throw new RadioError('Station format not supported');
    }
    const kind = streamKind(res.headers['content-type'], current);
    if (kind === 'playlist') {
      // One level of .pls/.m3u, as directory entries sometimes point at one.
      const text = await readAll(res.body, MAX_PLAYLIST_BYTES, opts.timeoutMs ?? 10_000);
      const next = playlists++ === 0 ? firstPlaylistEntry(text) : undefined;
      if (!next) throw new RadioError('Station offline (empty playlist)');
      current = next;
      continue;
    }
    if (kind !== 'audio') {
      res.body.destroy();
      throw new RadioError('Station format not supported');
    }
    const metaint = Number(res.headers['icy-metaint'] ?? 0);
    const body = res.body;
    body.setTimeout(opts.stallMs ?? 30_000, () => body.destroy(new RadioError('Station stalled')));
    return {
      url: current,
      contentType: safeType(res.headers['content-type']),
      metaint: Number.isInteger(metaint) && metaint > 0 && metaint <= 1_000_000 ? metaint : 0,
      headers: res.headers,
      body,
      close: () => body.destroy(),
    };
  }
  throw new RadioError('Station offline (too many redirects)');
}

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Socket;
}

async function request(raw: string, opts: IcyOpenOptions): Promise<RawResponse> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new RadioError('Station offline (bad address)');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new RadioError('Station offline (bad address)');
  if (u.username || u.password) throw new RadioError('Station offline (bad address)');
  const tls = u.protocol === 'https:';
  const hostname = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port || (tls ? 443 : 80));
  const address = await resolveAddress(hostname, !!opts.publicOnly);
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return new Promise<RawResponse>((done, fail) => {
    const socket: Socket = tls
      ? tlsConnect({ host: address, port, servername: isIP(hostname) ? undefined : hostname, ALPNProtocols: ['http/1.1'] })
      : netConnect({ host: address, port });
    let head = Buffer.alloc(0);
    let settled = false;
    const finish = (err?: Error, res?: RawResponse) => {
      if (settled) return;
      settled = true;
      socket.off('data', onData);
      socket.setTimeout(0);
      if (err) {
        socket.destroy();
        fail(err);
      } else done(res!);
    };
    const onData = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      let end = head.indexOf('\r\n\r\n');
      let sep = 4;
      if (end < 0) {
        end = head.indexOf('\n\n');
        sep = 2;
      }
      if (end < 0) {
        if (head.length > MAX_HEADER_BYTES) finish(new RadioError('Station offline (bad reply)'));
        return;
      }
      const lines = head.subarray(0, end).toString('latin1').split(/\r?\n/);
      const status = parseStatusLine(lines[0] ?? '');
      if (!status) return finish(new RadioError('Station offline (bad reply)'));
      socket.pause();
      const rest = head.subarray(end + sep);
      if (rest.length) socket.unshift(rest);
      finish(undefined, { status: status.status, headers: parseHeaders(lines.slice(1)), body: socket });
    };
    socket.setTimeout(timeoutMs, () => finish(new RadioError('Station offline (no answer)')));
    socket.on('data', onData);
    socket.once('error', (err) => finish(err instanceof RadioError ? err : new RadioError('Station offline')));
    socket.once('close', () => finish(new RadioError('Station offline (closed)')));
    socket.once(tls ? 'secureConnect' : 'connect', () => {
      const path = `${u.pathname || '/'}${u.search}`;
      const hostHeader = u.port ? `${u.hostname}:${u.port}` : u.hostname;
      socket.write(
        [`GET ${path} HTTP/1.0`, `Host: ${hostHeader}`, `User-Agent: ${opts.userAgent}`, 'Accept: */*', 'Icy-MetaData: 1', 'Connection: close', '', ''].join('\r\n'),
      );
    });
  });
}

/** The upstream audio type, safe to echo in our own response header. */
function safeType(raw: string | undefined): string {
  const type = (raw ?? '').split(';')[0].trim().toLowerCase();
  return /^(audio|application)\/[\w.+-]{1,60}$/.test(type) ? type : 'audio/mpeg';
}

async function resolveAddress(hostname: string, publicOnly: boolean): Promise<string> {
  let address = hostname;
  if (!isIP(hostname)) {
    try {
      address = (await lookup(hostname)).address;
    } catch {
      throw new RadioError('Station offline (unknown host)');
    }
  }
  // Directory entries are third-party data: never let one reach into the user's network.
  if (publicOnly && !isPublicAddress(address)) throw new RadioError('Station offline (private address)');
  return address;
}

/** False for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicAddress(mapped[1]);
    if (s === '::' || s === '::1') return false;
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff')) return false;
    return true;
  }
  return false;
}

function readAll(socket: Socket, limit: number, timeoutMs: number): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    socket.setTimeout(timeoutMs, () => socket.destroy(new RadioError('Station offline (no answer)')));
    socket.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) return socket.destroy(new RadioError('Station offline (bad playlist)'));
      chunks.push(c);
    });
    socket.once('end', () => done(Buffer.concat(chunks).toString('utf8')));
    socket.once('error', (err) => fail(err instanceof RadioError ? err : new RadioError('Station offline')));
    socket.resume();
  });
}
