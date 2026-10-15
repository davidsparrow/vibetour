import { Transform, type Readable } from 'node:stream';
import type { MusicState, NowPlaying, RadioStation } from '../../core/music';
import type { JourneyPack } from '../../core/packs';
import type { ClientCommand, HostMessage } from '../../core/protocol';
import { VERSION } from '../version';
import { RadioDirectory, type DirectoryStation } from './directory';
import { IcyDemuxer } from './icy';
import { openIcy, RadioError, type IcyStream } from './icyClient';
import { publicStation, SOMAFM_PRESETS, type PresetStation } from './presets';

/**
 * The radio's host side: the curated presets, the Radio Browser directory, and
 * the stream proxy behind the companion server's `/radio/stream`. Displays
 * only ever see station ids; the stream URLs stay here. Host-agnostic.
 */

export const RADIO_USER_AGENT = `VibeTour/${VERSION} (+https://github.com/davidsparrow/vibetour)`;
/** Open streams across all displays. */
export const MAX_RADIO_STREAMS = 4;
/** A display that stops sending `musicWatch` heartbeats is no longer watching. */
const WATCH_TTL_MS = 25_000;
/** At most four `music` messages a second. */
const PUBLISH_MS = 250;
const LOCAL_LIMIT = 20;

export interface RadioStream {
  contentType: string;
  /** Audio only: the ICY metadata is taken out. */
  body: Readable;
  close(): void;
}

export interface RadioServiceOptions {
  pack(id: string): JourneyPack | undefined;
  /** Sends a `music` message to one display. */
  publish(display: string, msg: HostMessage): void;
  log?(msg: string): void;
  userAgent?: string;
  presets?: PresetStation[];
  directory?: RadioDirectory;
  maxStreams?: number;
  /** Tests only: directory stations may be on loopback. */
  allowPrivateStreams?: boolean;
}

interface Playing extends NowPlaying {
  refs: number;
}

export class RadioService {
  private readonly presets: PresetStation[];
  private readonly directory: RadioDirectory;
  /** Directory stations seen in searches, so tuning one needs no second lookup. */
  private readonly known = new Map<string, DirectoryStation>();
  private readonly localCache = new Map<string, RadioStation[]>();
  private readonly playing = new Map<string, Playing>();
  private readonly open = new Set<RadioStream>();
  private readonly watchers = new Map<string, number>();
  /** Streams still connecting: they count toward the cap too. */
  private connecting = 0;
  private publishTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly opts: RadioServiceOptions) {
    this.presets = opts.presets ?? SOMAFM_PRESETS;
    this.directory = opts.directory ?? new RadioDirectory({ userAgent: opts.userAgent ?? RADIO_USER_AGENT, log: opts.log });
  }

  get streams(): number {
    return this.open.size;
  }

  get full(): boolean {
    return this.open.size + this.connecting >= (this.opts.maxStreams ?? MAX_RADIO_STREAMS);
  }

  state(): MusicState {
    const nowPlaying = [...this.playing.values()].map(({ refs: _refs, ...p }) => p);
    return { at: Date.now(), radio: { nowPlaying, streams: this.open.size } };
  }

  /** Handles the radio's display commands; false for any other command. */
  handleCommand(cmd: ClientCommand, display: string, reply: (msg: HostMessage) => void): boolean {
    switch (cmd.type) {
      case 'radioSearch':
        this.search(cmd).then(
          (stations) => reply({ type: 'radioStations', requestId: cmd.requestId, stations }),
          (err: unknown) => reply({ type: 'radioStations', requestId: cmd.requestId, stations: [], error: this.problem(err, 'The station directory is unreachable') }),
        );
        return true;
      case 'radioLocal':
        this.local(cmd.packId).then(
          (stations) => reply({ type: 'radioLocal', packId: cmd.packId, stations }),
          (err: unknown) => reply({ type: 'radioLocal', packId: cmd.packId, stations: [], error: this.problem(err, 'Local stations are unavailable') }),
        );
        return true;
      case 'radioTune':
        if (cmd.stationId?.startsWith('rb:')) void this.directory.click(cmd.stationId.slice(3));
        return true;
      case 'musicWatch':
        if (cmd.watching) {
          this.watchers.set(display, Date.now());
          this.opts.publish(display, { type: 'music', music: this.state() });
        } else this.watchers.delete(display);
        return true;
      default:
        return false;
    }
  }

  /** The curated presets without a query; otherwise the directory. */
  async search(q: { query?: string; countryCode?: string; tag?: string; limit?: number }): Promise<RadioStation[]> {
    const query = q.query?.trim();
    if (!query && !q.countryCode && !q.tag) return this.presets.map(publicStation);
    return this.remember(await this.directory.search({ name: query || undefined, countryCode: q.countryCode, tag: q.tag, limit: q.limit }));
  }

  /** Stations near a journey: its region first, then the rest of its country. */
  async local(packId: string): Promise<RadioStation[]> {
    const cached = this.localCache.get(packId);
    if (cached) return cached;
    const pack = this.opts.pack(packId);
    if (!pack) return [];
    let stations: RadioStation[];
    if (!/^[A-Z]{2}$/.test(pack.countryCode)) {
      // Off-world: nothing on the directory broadcasts from there yet.
      stations = this.presets.filter((s) => s.tags.includes('space')).map(publicStation);
    } else {
      const [region, country] = await Promise.allSettled([
        this.directory.search({ countryCode: pack.countryCode, state: pack.region, limit: LOCAL_LIMIT }),
        this.directory.search({ countryCode: pack.countryCode, limit: LOCAL_LIMIT }),
      ]);
      if (region.status === 'rejected' && country.status === 'rejected') throw country.reason;
      const seen = new Set<string>();
      const merged = [...(region.status === 'fulfilled' ? region.value : []), ...(country.status === 'fulfilled' ? country.value : [])].filter((s) => !seen.has(s.id) && !!seen.add(s.id));
      stations = this.remember(merged.slice(0, LOCAL_LIMIT));
    }
    this.localCache.set(packId, stations);
    return stations;
  }

  /** Opens a station for one display. Rejects with a RadioError the display can show. */
  async openStream(stationId: string): Promise<RadioStream> {
    if (this.disposed) throw new RadioError('Radio is off');
    if (this.full) throw new RadioError('Too many radio streams');
    this.connecting++;
    const { station, icy } = await this.connect(stationId).finally(() => this.connecting--);
    if (this.disposed) {
      icy.close();
      throw new RadioError('Radio is off');
    }
    const demux = new IcyDemuxer(icy.metaint);
    const entry = this.playing.get(stationId) ?? { stationId, station: publicStation(station as PresetStation), at: Date.now(), refs: 0 };
    entry.refs++;
    this.playing.set(stationId, entry);
    const body = new Transform({
      transform: (chunk: Buffer, _enc, done) => {
        const { audio, titles } = demux.push(chunk);
        const title = titles.at(-1);
        if (title !== undefined && (title || undefined) !== entry.title) {
          entry.title = title || undefined;
          entry.at = Date.now();
          this.changed();
        }
        done(null, audio.length ? audio : undefined);
      },
    });
    icy.body.on('error', (err) => body.destroy(err));
    icy.body.pipe(body);
    let closed = false;
    const stream: RadioStream = {
      contentType: icy.contentType,
      body,
      close: () => {
        if (closed) return;
        closed = true;
        icy.close();
        body.destroy();
        this.open.delete(stream);
        if (--entry.refs <= 0) this.playing.delete(stationId);
        this.changed();
      },
    };
    body.on('close', () => stream.close());
    body.on('error', () => stream.close());
    this.open.add(stream);
    this.changed();
    return stream;
  }

  dispose(): void {
    this.disposed = true;
    if (this.publishTimer) clearTimeout(this.publishTimer);
    for (const s of [...this.open]) s.close();
    this.watchers.clear();
  }

  // ---------------------------------------------------------------- helpers

  private async connect(stationId: string): Promise<{ station: PresetStation | DirectoryStation; icy: IcyStream }> {
    const station = await this.resolve(stationId);
    if (!station) throw new RadioError('Station not found');
    const publicOnly = station.source === 'directory' && !this.opts.allowPrivateStreams;
    return { station, icy: await openIcy(station.url, { userAgent: this.opts.userAgent ?? RADIO_USER_AGENT, publicOnly }) };
  }

  private async resolve(stationId: string): Promise<PresetStation | DirectoryStation | undefined> {
    const preset = this.presets.find((s) => s.id === stationId);
    if (preset) return preset;
    if (!stationId.startsWith('rb:')) return undefined;
    const known = this.known.get(stationId);
    if (known) return known;
    const found = await this.directory.byUuid(stationId.slice(3));
    if (found) this.remember([found]);
    return found;
  }

  private remember(stations: DirectoryStation[]): RadioStation[] {
    for (const s of stations) this.known.set(s.id, s);
    while (this.known.size > 500) this.known.delete(this.known.keys().next().value!);
    return stations.map(({ url: _url, ...s }) => s);
  }

  /** Publishes the state to watching displays, at most four times a second. */
  private changed(): void {
    if (this.publishTimer || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      const now = Date.now();
      const msg: HostMessage = { type: 'music', music: this.state() };
      for (const [display, at] of this.watchers) {
        if (now - at > WATCH_TTL_MS) this.watchers.delete(display);
        else this.opts.publish(display, msg);
      }
    }, PUBLISH_MS);
    this.publishTimer.unref?.();
  }

  private problem(err: unknown, fallback: string): string {
    this.opts.log?.(`Radio: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof RadioError ? err.message : fallback;
  }
}
