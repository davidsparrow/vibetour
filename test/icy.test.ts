import { describe, expect, it } from 'vitest';
import { firstPlaylistEntry, IcyDemuxer, parseHeaders, parseStatusLine, parseStreamTitle, streamKind } from '../src/host/radio/icy';

/** An ICY metadata block: length byte (×16), then the text padded with NULs. */
function metaBlock(text: string | Buffer): Buffer {
  const body = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
  const len = Math.ceil(body.length / 16);
  const block = Buffer.alloc(1 + len * 16);
  block[0] = len;
  body.copy(block, 1);
  return block;
}

/** Feeds `stream` to a demuxer in chunks of `size` bytes. */
function demux(metaint: number, stream: Buffer, size: number): { audio: Buffer; titles: string[] } {
  const d = new IcyDemuxer(metaint);
  const audio: Buffer[] = [];
  const titles: string[] = [];
  for (let i = 0; i < stream.length; i += size) {
    const r = d.push(stream.subarray(i, i + size));
    audio.push(r.audio);
    titles.push(...r.titles);
  }
  return { audio: Buffer.concat(audio), titles };
}

describe('IcyDemuxer', () => {
  const a1 = Buffer.alloc(16, 1);
  const a2 = Buffer.alloc(16, 2);
  const a3 = Buffer.alloc(16, 3);
  const stream = Buffer.concat([a1, metaBlock("StreamTitle='First Song';"), a2, Buffer.from([0]), a3, metaBlock("StreamTitle='Second Song';StreamUrl='';")]);

  it('takes metadata out, whole or straddling chunk boundaries', () => {
    for (const size of [1, 3, 7, 16, 17, 1000]) {
      const r = demux(16, stream, size);
      expect(r.audio, `chunk size ${size}`).toEqual(Buffer.concat([a1, a2, a3]));
      expect(r.titles).toEqual(['First Song', 'Second Song']);
    }
  });

  it('skips a zero-length metadata byte without a title', () => {
    const r = demux(16, Buffer.concat([a1, Buffer.from([0]), a2]), 5);
    expect(r.audio).toEqual(Buffer.concat([a1, a2]));
    expect(r.titles).toEqual([]);
  });

  it('passes everything through without a metaint', () => {
    expect(demux(0, stream, 9).audio).toEqual(stream);
  });
});

describe('parseStreamTitle', () => {
  it('keeps quotes inside the title', () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='Guns N' Roses - Sweet Child O' Mine';StreamUrl='http://x';\0\0"))).toBe("Guns N' Roses - Sweet Child O' Mine");
    expect(parseStreamTitle(Buffer.from("StreamTitle='It's';"))).toBe("It's");
  });

  it('reads Latin-1 when the bytes are not UTF-8', () => {
    const latin1 = Buffer.from("StreamTitle='Sigur Rós - Hoppípolla';", 'latin1');
    expect(parseStreamTitle(latin1)).toBe('Sigur Rós - Hoppípolla');
    expect(parseStreamTitle(Buffer.from("StreamTitle='Björk - Jóga';", 'utf8'))).toBe('Björk - Jóga');
  });

  it('gives an empty title, or none without StreamTitle', () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='';"))).toBe('');
    expect(parseStreamTitle(Buffer.from("StreamUrl='x';"))).toBeUndefined();
  });

  it('strips control characters and caps the length', () => {
    expect(parseStreamTitle(Buffer.from("StreamTitle='a\u0007b';"))).toBe('ab');
    expect(parseStreamTitle(Buffer.from(`StreamTitle='${'x'.repeat(500)}';`))!.length).toBe(200);
  });
});

describe('ICY responses', () => {
  it("accepts HTTP/1.x and Shoutcast's ICY status lines", () => {
    expect(parseStatusLine('ICY 200 OK')).toEqual({ protocol: 'ICY', status: 200 });
    expect(parseStatusLine('HTTP/1.0 302 Found')).toEqual({ protocol: 'HTTP', status: 302 });
    expect(parseStatusLine('HTTP/1.1 200 OK\r')).toEqual({ protocol: 'HTTP', status: 200 });
    expect(parseStatusLine('HTTP/2 404')).toEqual({ protocol: 'HTTP', status: 404 });
    expect(parseStatusLine('SSH-2.0-OpenSSH')).toBeUndefined();
  });

  it('lower-cases header names', () => {
    expect(parseHeaders(['Content-Type: audio/mpeg', 'icy-metaint:16000', 'bad line'])).toEqual({ 'content-type': 'audio/mpeg', 'icy-metaint': '16000' });
  });

  it('tells audio from playlists and pages', () => {
    expect(streamKind('audio/mpeg', 'http://a/stream')).toBe('audio');
    expect(streamKind('application/ogg', 'http://a/stream')).toBe('audio');
    expect(streamKind('audio/x-scpls', 'http://a/listen')).toBe('playlist');
    expect(streamKind('audio/x-mpegurl', 'http://a/listen')).toBe('playlist');
    expect(streamKind('text/plain', 'http://a/listen.pls?x=1')).toBe('playlist');
    expect(streamKind('application/vnd.apple.mpegurl', 'http://a/live.m3u8')).toBe('other');
    expect(streamKind('text/html; charset=utf-8', 'http://a/')).toBe('other');
  });

  it("reads a playlist's first stream", () => {
    expect(firstPlaylistEntry('[playlist]\nNumberOfEntries=2\nFile1=https://ice1.example/one\nFile2=https://ice2.example/two\n')).toBe('https://ice1.example/one');
    expect(firstPlaylistEntry('#EXTM3U\r\n#EXTINF:-1,Station\r\nhttp://stream.example/live\r\n')).toBe('http://stream.example/live');
    expect(firstPlaylistEntry('File1=javascript:alert(1)\n')).toBeUndefined();
  });
});
