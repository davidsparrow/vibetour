import { resolveSrv } from 'node:dns/promises';
import type { RadioStation } from '../../core/music';

/**
 * Radio Browser (radio-browser.info): a free, keyless, community directory of
 * internet radio. Following its etiquette, requests carry a descriptive
 * User-Agent, ask for working stations only, are cached, and count one click
 * per tune. Entries are third-party data, so every field is sanitised.
 */

export interface DirectoryStation extends RadioStation {
  url: string;
}

export interface DirectoryQuery {
  name?: string;
  countryCode?: string;
  /** Region within the country, e.g. "California". */
  state?: string;
  tag?: string;
  limit?: number;
}

export interface DirectoryOptions {
  userAgent: string;
  fetch?: typeof fetch;
  /** API hosts to use instead of DNS discovery (tests). */
  hosts?: string[];
  timeoutMs?: number;
  cacheMs?: number;
  log?(msg: string): void;
}

const FALLBACK_HOST = 'all.api.radio-browser.info';
const CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG']);

type Raw = Record<string, unknown>;

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

const httpUrl = (v: unknown, max: number): string | undefined => {
  const s = str(v, 2048);
  if (!s || s.length > max) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
};

/** A directory entry as a station, or undefined when it can't play here (HLS, odd codec, bad URL). */
export function sanitizeStation(raw: Raw): DirectoryStation | undefined {
  const uuid = str(raw.stationuuid, 64);
  if (!uuid || !/^[\w-]{1,64}$/.test(uuid)) return undefined;
  const codec = str(raw.codec, 10)?.toUpperCase();
  if (!codec || !CODECS.has(codec)) return undefined;
  if (Number(raw.hls) !== 0) return undefined;
  const url = httpUrl(raw.url_resolved, 1024) ?? httpUrl(raw.url, 1024);
  const name = str(raw.name, 80);
  if (!url || !name) return undefined;
  const bitrate = Number(raw.bitrate);
  const countryCode = str(raw.countrycode, 2)?.toUpperCase();
  return {
    id: `rb:${uuid}`,
    name,
    codec,
    ...(Number.isInteger(bitrate) && bitrate > 0 && bitrate <= 1024 ? { bitrate } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
    ...(str(raw.country, 60) ? { country: str(raw.country, 60) } : {}),
    tags: (str(raw.tags, 400) ?? '')
      .split(',')
      .map((t) => t.trim().toLowerCase().slice(0, 30))
      .filter(Boolean)
      .slice(0, 6),
    ...(httpUrl(raw.homepage, 300) ? { homepage: httpUrl(raw.homepage, 300) } : {}),
    source: 'directory',
    url,
  };
}

export class RadioDirectory {
  private hosts?: Promise<string[]>;
  private readonly cache = new Map<string, { at: number; stations: DirectoryStation[] }>();
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: DirectoryOptions) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  async search(q: DirectoryQuery): Promise<DirectoryStation[]> {
    const params = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(Math.min(50, Math.max(1, q.limit ?? 30))) });
    if (q.name) params.set('name', q.name);
    if (q.countryCode) params.set('countrycode', q.countryCode);
    if (q.state) params.set('state', q.state);
    if (q.tag) params.set('tag', q.tag);
    return this.stations(`/json/stations/search?${params}`);
  }

  async byUuid(uuid: string): Promise<DirectoryStation | undefined> {
    return (await this.stations(`/json/stations/byuuid/${encodeURIComponent(uuid)}`))[0];
  }

  /** Tells the directory someone listened, which keeps its popularity order honest. */
  async click(uuid: string): Promise<void> {
    await this.get(`/json/url/${encodeURIComponent(uuid)}`).catch((err: unknown) => this.opts.log?.(`Radio Browser click failed: ${String(err)}`));
  }

  private async stations(path: string): Promise<DirectoryStation[]> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < (this.opts.cacheMs ?? 600_000)) return hit.stations;
    const body = await this.get(path);
    const stations = (Array.isArray(body) ? body : [])
      .map((r) => (r && typeof r === 'object' ? sanitizeStation(r as Raw) : undefined))
      .filter((s): s is DirectoryStation => !!s);
    this.cache.set(path, { at: Date.now(), stations });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return stations;
  }

  private async get(path: string): Promise<unknown> {
    const hosts = await this.apiHosts();
    let lastErr: unknown;
    // Mirrors come and go: try two before giving up.
    for (const host of hosts.slice(0, 2)) {
      try {
        const res = await this.fetchFn(`https://${host}${path}`, {
          headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Radio Browser is unreachable');
  }

  /** The API mirrors, from DNS (SRV `_api._tcp.radio-browser.info`), shuffled. */
  private apiHosts(): Promise<string[]> {
    if (this.opts.hosts) return Promise.resolve(this.opts.hosts);
    this.hosts ??= resolveSrv('_api._tcp.radio-browser.info')
      .then((records) => {
        const names = records.map((r) => r.name).filter((n) => /^[a-z0-9.-]+\.radio-browser\.info$/i.test(n));
        return [...shuffle(names), FALLBACK_HOST];
      })
      .catch(() => [FALLBACK_HOST]);
    return this.hosts;
  }
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
