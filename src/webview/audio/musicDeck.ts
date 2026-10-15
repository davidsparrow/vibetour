import type { DeckPrefs } from '../../core/music';

/**
 * The head unit's sound: an internet radio stream through real DSP.
 *
 *   <audio> → bass → treble → stereo mix → surround → fader → balance ─┬→ volume → speakers
 *                                                                     └→ analyser (EQ lights)
 *
 * The stream comes from the host's loopback proxy with CORS, so Web Audio may
 * read it. The deck has its own output gain: it plays while tour audio is off.
 */

export type DeckEvent = 'playing' | 'waiting' | 'paused' | 'error';

/** The MIME type a station's codec plays as, for `canPlayType`. */
const CODEC_TYPES: Record<string, string> = {
  MP3: 'audio/mpeg',
  AAC: 'audio/aac',
  'AAC+': 'audio/aac',
  OGG: 'audio/ogg',
};

/** Whether this browser decodes a codec (VS Code's webview has no AAC). Unknown codecs get the benefit of the doubt. */
export function canPlayCodec(codec: string | undefined, probe: HTMLMediaElement = document.createElement('audio')): boolean {
  const type = codec ? CODEC_TYPES[codec.toUpperCase()] : undefined;
  return !type || probe.canPlayType(type) !== '';
}

/** A short, decaying stereo noise burst: the surround's "room". */
function roomImpulse(ctx: BaseAudioContext, seconds = 0.6): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}

export class MusicDeck {
  readonly audio: HTMLAudioElement;
  private readonly bass: BiquadFilterNode;
  private readonly treble: BiquadFilterNode;
  /** Stereo mix: L/R → mid/side gains → L/R. */
  private readonly widthGains: GainNode[];
  private readonly widthOut: ChannelMergerNode;
  private readonly haasSplit: ChannelSplitterNode;
  private readonly wet: GainNode;
  private wetConnected = false;
  private readonly front: BiquadFilterNode;
  private readonly rear: BiquadFilterNode;
  private readonly panner: StereoPannerNode;
  private readonly out: GainNode;
  private listeners: Array<(e: DeckEvent) => void> = [];
  private volume = 0.7;
  private url?: string;
  private wantPlay = false;

  constructor(
    private readonly ctx: AudioContext,
    analyser: AnalyserNode,
  ) {
    const audio = (this.audio = document.createElement('audio'));
    audio.crossOrigin = 'anonymous';
    audio.preload = 'none';
    const src = ctx.createMediaElementSource(audio);

    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 120;
    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 6000;
    src.connect(this.bass).connect(this.treble);

    // Stereo mix: outL = mid + w·side, outR = mid − w·side.
    const split = ctx.createChannelSplitter(2);
    this.widthOut = ctx.createChannelMerger(2);
    this.treble.connect(split);
    this.widthGains = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([from, to]) => {
      const g = ctx.createGain();
      split.connect(g, from);
      g.connect(this.widthOut, 0, to);
      return g;
    });

    // Surround: the dry signal, plus a room fed with one side delayed (Haas).
    const mix = ctx.createGain();
    this.widthOut.connect(mix);
    this.haasSplit = ctx.createChannelSplitter(2);
    const haasMerge = ctx.createChannelMerger(2);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.015;
    this.haasSplit.connect(haasMerge, 0, 0);
    this.haasSplit.connect(delay, 1).connect(haasMerge, 0, 1);
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    haasMerge.connect(room).connect(this.wet).connect(mix);

    // Fader: front adds presence, rear adds body (and a touch more room).
    this.front = ctx.createBiquadFilter();
    this.front.type = 'highshelf';
    this.front.frequency.value = 3000;
    this.rear = ctx.createBiquadFilter();
    this.rear.type = 'lowshelf';
    this.rear.frequency.value = 220;
    this.panner = ctx.createStereoPanner();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    mix.connect(this.front).connect(this.rear).connect(this.panner);
    this.panner.connect(analyser);
    this.panner.connect(this.out).connect(ctx.destination);

    audio.addEventListener('playing', () => this.emit('playing'));
    audio.addEventListener('waiting', () => this.wantPlay && this.emit('waiting'));
    audio.addEventListener('stalled', () => this.wantPlay && this.emit('waiting'));
    audio.addEventListener('error', () => this.wantPlay && this.emit('error'));
    audio.addEventListener('ended', () => this.wantPlay && this.emit('error'));
  }

  /** Something is (or should be) coming out of the speakers. */
  get active(): boolean {
    return this.wantPlay;
  }

  get playing(): boolean {
    return this.wantPlay && !this.audio.paused && this.audio.readyState >= 3;
  }

  onEvent(cb: (e: DeckEvent) => void): void {
    this.listeners.push(cb);
  }

  tune(url: string | undefined): void {
    this.url = url;
    if (this.wantPlay) void this.play();
  }

  /** Needs a user gesture the first time (autoplay rules): Power is the gesture. */
  async play(): Promise<void> {
    if (!this.url) return;
    this.wantPlay = true;
    this.emit('waiting');
    await this.ctx.resume();
    // Live radio has no pause: every play joins the stream where it is now.
    this.audio.src = this.url;
    this.audio.load();
    this.ramp(this.volume * this.volume);
    try {
      await this.audio.play();
    } catch (err) {
      // A newer tune or a pause interrupted this one; anything else is a failure.
      if ((err as DOMException)?.name !== 'AbortError' && this.wantPlay) this.emit('error');
    }
  }

  pause(): void {
    if (!this.wantPlay) return;
    this.wantPlay = false;
    this.ramp(0);
    this.audio.pause();
    // Drop the connection, so the host closes the upstream stream too.
    this.audio.removeAttribute('src');
    this.audio.load();
    this.emit('paused');
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.wantPlay) this.ramp(this.volume * this.volume);
  }

  setDsp(d: DeckPrefs): void {
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.05);
    set(this.bass.gain, d.bass);
    set(this.treble.gain, d.treble);
    const w = d.width;
    // [L→L, R→L, L→R, R→R]
    [(1 + w) / 2, (1 - w) / 2, (1 - w) / 2, (1 + w) / 2].forEach((g, i) => set(this.widthGains[i].gain, g));
    const rear = Math.max(0, -d.fader);
    const wet = (d.surround ? 0.22 : 0) + rear * 0.1;
    // Off means off: with no wet signal the room is disconnected, leaving the dry path untouched.
    if (wet > 0 && !this.wetConnected) this.widthOut.connect(this.haasSplit);
    if (wet === 0 && this.wetConnected) this.widthOut.disconnect(this.haasSplit);
    this.wetConnected = wet > 0;
    set(this.wet.gain, wet);
    set(this.front.gain, d.fader * 4);
    set(this.rear.gain, -d.fader * 3);
    set(this.panner.pan, d.balance);
    this.setVolume(d.volume);
  }

  private ramp(gain: number): void {
    this.out.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.08);
  }

  private emit(e: DeckEvent): void {
    for (const cb of this.listeners) cb(e);
  }
}
