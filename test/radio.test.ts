import { describe, expect, it, vi } from 'vitest';
import type { HostMessage } from '../src/core/protocol';
import { RadioDirectory, sanitizeStation } from '../src/host/radio/directory';
import { isPublicAddress } from '../src/host/radio/icyClient';
import { SOMAFM_PRESETS } from '../src/host/radio/presets';
import { RadioService } from '../src/host/radio/service';
import { BUILTIN_PACKS } from '../src/packs';

const UA = 'VibeTour/test (+https://github.com/davidsparrow/vibetour)';

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stationuuid: '9617a958-0601-11e8-ae97-52543be04c81',
    name: 'KXYZ Coast Radio',
    url: 'http://stream.example/kxyz',
    url_resolved: 'http://stream.example/kxyz.mp3',
    homepage: 'https://kxyz.example/',
    tags: 'jazz,California,  coast ',
    country: 'The United States Of America',
    countrycode: 'US',
    state: 'California',
    codec: 'MP3',
    bitrate: 128,
    hls: 0,
    ...over,
  };
}

/** A fetch stub answering every request with `body`, recording the calls. */
function stubFetch(body: unknown = [entry()]) {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function directory(body?: unknown) {
  const stub = stubFetch(body);
  return { dir: new RadioDirectory({ userAgent: UA, fetch: stub.fetch, hosts: ['api.test'] }), calls: stub.calls };
}

function service(body?: unknown) {
  const { dir, calls } = directory(body);
  const published: Array<[string, HostMessage]> = [];
  const radio = new RadioService({
    pack: (id) => BUILTIN_PACKS.find((p) => p.id === id),
    publish: (display, msg) => published.push([display, msg]),
    directory: dir,
  });
  return { radio, calls, published };
}

describe('Radio Browser directory', () => {
  it('searches politely: User-Agent, working stations only, most played first', async () => {
    const { dir, calls } = directory();
    const found = await dir.search({ name: 'coast', countryCode: 'US', state: 'California', tag: 'jazz', limit: 20 });
    expect(found).toHaveLength(1);
    const { url, headers } = calls[0];
    expect(url.origin).toBe('https://api.test');
    expect(url.pathname).toBe('/json/stations/search');
    expect(headers['User-Agent']).toBe(UA);
    expect(Object.fromEntries(url.searchParams)).toEqual({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '20', name: 'coast', countrycode: 'US', state: 'California', tag: 'jazz' });
  });

  it('caches searches', async () => {
    const { dir, calls } = directory();
    await dir.search({ tag: 'jazz' });
    await dir.search({ tag: 'jazz' });
    expect(calls).toHaveLength(1);
  });

  it('turns entries into stations, keeping the stream URL host-side', () => {
    expect(sanitizeStation(entry())).toEqual({
      id: 'rb:9617a958-0601-11e8-ae97-52543be04c81',
      name: 'KXYZ Coast Radio',
      codec: 'MP3',
      bitrate: 128,
      countryCode: 'US',
      country: 'The United States Of America',
      tags: ['jazz', 'california', 'coast'],
      homepage: 'https://kxyz.example/',
      source: 'directory',
      url: 'http://stream.example/kxyz.mp3',
    });
  });

  it('sanitises hostile fields and drops what cannot play', () => {
    const s = sanitizeStation(entry({ name: `${'A'.repeat(300)}\u0000\n`, homepage: 'javascript:alert(1)', tags: 'x,'.repeat(50), bitrate: 'lots', countrycode: '<b>' }))!;
    expect(s.name).toHaveLength(80);
    expect(s.homepage).toBeUndefined();
    expect(s.tags.length).toBeLessThanOrEqual(6);
    expect(s.bitrate).toBeUndefined();
    expect(s.countryCode).toBeUndefined();
    expect(sanitizeStation(entry({ codec: 'FLAC' }))).toBeUndefined();
    expect(sanitizeStation(entry({ codec: 'aac+' }))?.codec).toBe('AAC+');
    expect(sanitizeStation(entry({ hls: 1 }))).toBeUndefined();
    expect(sanitizeStation(entry({ url_resolved: 'file:///etc/passwd', url: 'ftp://x/' }))).toBeUndefined();
    expect(sanitizeStation(entry({ stationuuid: '../../json' }))).toBeUndefined();
    expect(sanitizeStation(entry({ name: '   ' }))).toBeUndefined();
  });
});

describe('RadioService', () => {
  it('lists the curated presets without touching the network', async () => {
    const { radio, calls } = service();
    const presets = await radio.search({});
    expect(presets.map((s) => s.id)).toEqual(SOMAFM_PRESETS.map((s) => s.id));
    expect(presets.every((s) => !('url' in s))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('never hands stream URLs to displays', async () => {
    const { radio } = service();
    const [found] = await radio.search({ query: 'coast' });
    expect(found).not.toHaveProperty('url');
    expect(JSON.stringify(found)).not.toContain('stream.example');
  });

  it('refuses unknown stations', async () => {
    const { radio } = service([]);
    await expect(radio.openStream('soma:nope')).rejects.toThrow('Station not found');
    await expect(radio.openStream('rb:missing')).rejects.toThrow('Station not found');
  });

  it('counts one click per tune', async () => {
    const { radio, calls } = service();
    const replies: HostMessage[] = [];
    expect(radio.handleCommand({ type: 'radioTune', stationId: 'rb:abc-123' }, 'panel', (m) => replies.push(m))).toBe(true);
    expect(radio.handleCommand({ type: 'radioTune', stationId: 'soma:lush' }, 'panel', (m) => replies.push(m))).toBe(true);
    expect(radio.handleCommand({ type: 'radioTune' }, 'panel', (m) => replies.push(m))).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url.pathname).toBe('/json/url/abc-123');
    expect(replies).toEqual([]);
  });

  it('finds local stations by the journey’s country and region, once per pack', async () => {
    const { radio, calls } = service();
    const replies: HostMessage[] = [];
    radio.handleCommand({ type: 'radioLocal', packId: 'california-coast' }, 'panel', (m) => replies.push(m));
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ type: 'radioLocal', packId: 'california-coast', stations: [{ id: 'rb:9617a958-0601-11e8-ae97-52543be04c81' }] });
    expect(calls.map((c) => [c.url.searchParams.get('countrycode'), c.url.searchParams.get('state')])).toEqual([
      ['US', 'California'],
      ['US', null],
    ]);
    await radio.local('california-coast');
    expect(calls).toHaveLength(2);
  });

  it('plays space stations on Mars', async () => {
    const { radio, calls } = service();
    const mars = await radio.local('mars-colony');
    expect(mars.length).toBeGreaterThan(0);
    expect(mars.every((s) => s.id.startsWith('soma:') && s.tags.includes('space'))).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('answers a search with an error the display can show', async () => {
    const failing = new RadioDirectory({ userAgent: UA, hosts: ['api.test'], fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch });
    const radio = new RadioService({ pack: () => undefined, publish: () => undefined, directory: failing });
    const replies: HostMessage[] = [];
    radio.handleCommand({ type: 'radioSearch', requestId: 'r1', query: 'jazz' }, 'panel', (m) => replies.push(m));
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toEqual({ type: 'radioStations', requestId: 'r1', stations: [], error: 'The station directory is unreachable' });
  });

  it('sends the music state to a display that starts watching', () => {
    const { radio, published } = service();
    radio.handleCommand({ type: 'musicWatch', watching: true }, 'companion', () => undefined);
    expect(published).toHaveLength(1);
    expect(published[0][0]).toBe('companion');
    expect(published[0][1]).toMatchObject({ type: 'music', music: { radio: { nowPlaying: [], streams: 0 } } });
  });
});

describe('isPublicAddress', () => {
  it('refuses loopback, private, link-local and reserved addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '45.79.123.4', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPublicAddress(ip), ip).toBe(true);
  });
});
