/**
 * Shoutcast/Icecast "ICY" stream helpers, kept pure for testing. With
 * `Icy-MetaData: 1`, a server interleaves a metadata block every `metaint`
 * audio bytes: one length byte (×16), then `StreamTitle='…';` padded with NULs.
 */

export interface DemuxResult {
  audio: Buffer;
  titles: string[];
}

/** Splits a stream into audio and song titles, across any chunk boundaries. */
export class IcyDemuxer {
  /** Audio bytes left before the next metadata length byte. */
  private audioLeft: number;
  /** Metadata bytes still to read, or -1 while waiting for the length byte. */
  private metaLeft = -1;
  private meta: Buffer[] = [];

  constructor(private readonly metaint: number) {
    this.audioLeft = metaint;
  }

  push(chunk: Buffer): DemuxResult {
    if (!this.metaint) return { audio: chunk, titles: [] };
    const audio: Buffer[] = [];
    const titles: string[] = [];
    let i = 0;
    while (i < chunk.length) {
      if (this.audioLeft > 0) {
        const n = Math.min(this.audioLeft, chunk.length - i);
        audio.push(chunk.subarray(i, i + n));
        this.audioLeft -= n;
        i += n;
      } else if (this.metaLeft < 0) {
        this.metaLeft = chunk[i++] * 16;
        if (this.metaLeft === 0) this.endBlock(titles);
      } else {
        const n = Math.min(this.metaLeft, chunk.length - i);
        this.meta.push(chunk.subarray(i, i + n));
        this.metaLeft -= n;
        i += n;
        if (this.metaLeft === 0) this.endBlock(titles);
      }
    }
    return { audio: audio.length === 1 ? audio[0] : Buffer.concat(audio), titles };
  }

  private endBlock(titles: string[]): void {
    if (this.meta.length) {
      const title = parseStreamTitle(Buffer.concat(this.meta));
      if (title !== undefined) titles.push(title);
    }
    this.meta = [];
    this.metaLeft = -1;
    this.audioLeft = this.metaint;
  }
}

function decode(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8');
  // Older servers send Latin-1; invalid UTF-8 decodes to U+FFFD.
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}

/** The song in a metadata block. Titles may contain quotes ("Guns N' Roses"). */
export function parseStreamTitle(block: Buffer): string | undefined {
  const text = decode(block).replace(/\0+$/, '');
  const key = "StreamTitle='";
  const start = text.indexOf(key);
  if (start < 0) return undefined;
  const from = start + key.length;
  // The title ends at the `';` followed by the end or by the next `Key=`.
  for (let end = text.indexOf("';", from); end >= 0; end = text.indexOf("';", end + 1)) {
    const rest = text.slice(end + 2);
    if (rest.trim() === '' || /^[A-Za-z_]+=/.test(rest)) return clean(text.slice(from, end));
  }
  return clean(text.slice(from).replace(/'?;?\s*$/, ''));
}

function clean(title: string): string {
  return title.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

export interface StatusLine {
  protocol: 'HTTP' | 'ICY';
  status: number;
}

/** `HTTP/1.x 200 OK`, or Shoutcast's `ICY 200 OK` that Node's HTTP parser rejects. */
export function parseStatusLine(line: string): StatusLine | undefined {
  const m = /^(HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})(?:\s.*)?$/.exec(line.trim());
  if (!m) return undefined;
  return { protocol: m[1] === 'ICY' ? 'ICY' : 'HTTP', status: Number(m[2]) };
}

/** Header names lower-cased; the last value wins. */
export function parseHeaders(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

const PLAYLIST_TYPES = ['audio/x-scpls', 'application/pls+xml', 'audio/x-mpegurl', 'audio/mpegurl', 'application/x-mpegurl'];

export type StreamKind = 'audio' | 'playlist' | 'other';

/** What a response holds, from its content type, or the URL's extension when the type is vague. */
export function streamKind(contentType: string | undefined, url: string): StreamKind {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/vnd.apple.mpegurl') return 'other'; // HLS
  if (PLAYLIST_TYPES.includes(type)) return 'playlist';
  if (type.startsWith('audio/') || type === 'application/ogg') return 'audio';
  const path = url.split(/[?#]/)[0].toLowerCase();
  if ((!type || type === 'text/plain' || type === 'application/octet-stream') && /\.(pls|m3u)$/.test(path)) return 'playlist';
  return 'other';
}

/** The first stream URL in a .pls or .m3u playlist. */
export function firstPlaylistEntry(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const pls = /^File\d+=(.+)$/i.exec(line);
    const url = pls ? pls[1].trim() : line.startsWith('#') ? '' : line;
    if (/^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}
