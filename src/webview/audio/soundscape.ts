import type { AudioPrefs, TourSnapshot } from '../../core/protocol';
import type { JourneyPack } from '../../core/packs';

/**
 * Procedural tour audio (PRD §14): engine, road, wind, weather, ambience and a
 * gentle generative "Focus Mix" — every layer independently adjustable and
 * nothing loaded from the network.
 */

type Layer = 'engine' | 'road' | 'wind' | 'weather' | 'ambience' | 'music';

function noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown' | 'pink'): AudioBuffer {
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }
  return buf;
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];

export class Soundscape {
  private ctx?: AudioContext;
  private master?: GainNode;
  private readonly layers = new Map<Layer, GainNode>();
  private engineOsc: OscillatorNode[] = [];
  private engineFilter?: BiquadFilterNode;
  private roadFilter?: BiquadFilterNode;
  private roadGain?: GainNode;
  private windGain?: GainNode;
  private rainGain?: GainNode;
  private oceanGain?: GainNode;
  private cityGain?: GainNode;
  private streamGain?: GainNode;
  private humGain?: GainNode;
  private musicFilter?: BiquadFilterNode;
  private musicVoices: OscillatorNode[] = [];
  private birdTimer = 0;
  private chordTimer = 0;
  private chord = 0;
  private prefs?: AudioPrefs;
  private pack?: JourneyPack;
  private weather = 'clear';
  private night = 0;

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (browser autoplay rules). */
  async start(prefs: AudioPrefs): Promise<void> {
    this.prefs = prefs;
    if (!this.ctx) this.build();
    await this.ctx!.resume();
    this.applyVolumes();
  }

  async stop(): Promise<void> {
    await this.ctx?.suspend();
  }

  setPrefs(prefs: AudioPrefs): void {
    this.prefs = prefs;
    this.applyVolumes();
  }

  setScene(pack: JourneyPack | undefined, weather: string, night: number): void {
    this.pack = pack;
    this.weather = weather;
    this.night = night;
  }

  private build(): void {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    const layer = (name: Layer) => {
      const g = ctx.createGain();
      g.connect(this.master!);
      this.layers.set(name, g);
      return g;
    };
    const white = noiseBuffer(ctx, 'white');
    const brown = noiseBuffer(ctx, 'brown');
    const pink = noiseBuffer(ctx, 'pink');
    const loop = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start(0, Math.random() * 2);
      return src;
    };

    // Engine: two detuned low oscillators through a low-pass.
    const engine = layer('engine');
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    const eg = ctx.createGain();
    eg.gain.value = 0.12;
    for (const [type, mult] of [
      ['sawtooth', 1],
      ['triangle', 2.01],
    ] as Array<[OscillatorType, number]>) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 38 * mult;
      o.connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }
    this.engineFilter.connect(eg).connect(engine);

    // Road: brown noise rumble.
    const road = layer('road');
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 300;
    this.roadGain = ctx.createGain();
    loop(brown).connect(this.roadFilter).connect(this.roadGain).connect(road);

    // Wind: band-passed white noise.
    const wind = layer('wind');
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 0.6;
    this.windGain = ctx.createGain();
    loop(white).connect(wf).connect(this.windGain).connect(wind);

    // Weather: rain hiss.
    const weather = layer('weather');
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 2500;
    this.rainGain = ctx.createGain();
    loop(white).connect(rf).connect(this.rainGain).connect(weather);

    // Ambience: ocean swell, city murmur, stream, low hum.
    const amb = layer('ambience');
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 520;
    this.oceanGain = ctx.createGain();
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.09;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.12;
    swell.connect(swellDepth).connect(this.oceanGain.gain);
    swell.start();
    loop(brown).connect(of).connect(this.oceanGain).connect(amb);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 420;
    this.cityGain = ctx.createGain();
    loop(pink).connect(cf).connect(this.cityGain).connect(amb);
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1400;
    sf.Q.value = 0.8;
    this.streamGain = ctx.createGain();
    loop(pink).connect(sf).connect(this.streamGain).connect(amb);
    const hum = ctx.createOscillator();
    hum.frequency.value = 55;
    this.humGain = ctx.createGain();
    hum.connect(this.humGain).connect(amb);
    hum.start();

    // Focus Mix: a soft generative pad whose brightness follows the work.
    const music = layer('music');
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 900;
    const mg = ctx.createGain();
    mg.gain.value = 0.05;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = 220;
      o.detune.value = (i - 1) * 6;
      o.connect(this.musicFilter);
      o.start();
      this.musicVoices.push(o);
    }
    this.musicFilter.connect(mg).connect(music);
    this.nextChord();
  }

  private nextChord(): void {
    if (!this.ctx) return;
    this.chord = (this.chord + 3) % SCALE.length;
    const root = 196;
    const notes = [SCALE[this.chord], SCALE[(this.chord + 2) % SCALE.length], SCALE[(this.chord + 4) % SCALE.length]];
    const t = this.ctx.currentTime;
    this.musicVoices.forEach((o, i) => o.frequency.setTargetAtTime(root * Math.pow(2, notes[i] / 12), t, 1.6));
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.prefs || !this.master) return;
    const p = this.prefs;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.enabled ? p.master : 0, t, 0.3);
    for (const [name, g] of this.layers) g.gain.setTargetAtTime(p[name], t, 0.3);
  }

  /** Called a few times per second with the latest snapshot and vehicle speed (m/s). */
  update(snapshot: TourSnapshot | undefined, speed: number, cruise: number, inTunnel: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const v = cruise > 0 ? Math.min(1.2, speed / cruise) : 0;
    const amb = new Set(this.pack?.audio.ambience ?? []);
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(34 + v * 40 * (o === this.engineOsc[1] ? 2.01 : 1), t, 0.4);
    this.engineFilter!.frequency.setTargetAtTime(140 + v * 260, t, 0.4);
    this.roadGain!.gain.setTargetAtTime(0.25 * v, t, 0.5);
    this.roadFilter!.frequency.setTargetAtTime(200 + v * 500, t, 0.5);
    this.windGain!.gain.setTargetAtTime(0.03 + 0.12 * v * v + (amb.has('wind') ? 0.04 : 0), t, 0.8);
    const raining = this.weather === 'rain';
    this.rainGain!.gain.setTargetAtTime(raining ? 0.16 * (1 - inTunnel * 0.85) : 0, t, 1.2);
    this.oceanGain!.gain.setTargetAtTime(amb.has('ocean') ? 0.35 : 0, t, 1.5);
    this.cityGain!.gain.setTargetAtTime(amb.has('city') ? 0.22 : 0, t, 1.5);
    this.streamGain!.gain.setTargetAtTime(amb.has('stream') ? 0.05 : 0, t, 1.5);
    this.humGain!.gain.setTargetAtTime(amb.has('hum') ? 0.015 : 0, t, 1.5);

    // Focus Mix: brighter while building, softer while thinking or stopped.
    const state = snapshot?.activity.basis;
    const bright = state === 'ACTIVE' || state === 'AGENT_ACTIVE' ? 1400 : state === 'VERIFYING' ? 1100 : snapshot?.motion.stopped ? 500 : 750;
    this.musicFilter!.frequency.setTargetAtTime(bright, t, 2.5);

    const now = performance.now();
    if (now > this.chordTimer) {
      this.chordTimer = now + 9000;
      this.nextChord();
    }
    if (amb.has('birds') && this.night < 0.5 && now > this.birdTimer) {
      this.birdTimer = now + 2500 + Math.random() * 6000;
      this.chirp();
    }
  }

  private chirp(): void {
    const ctx = this.ctx!;
    const out = this.layers.get('ambience')!;
    const t = ctx.currentTime;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const start = t + i * 0.13;
      const f = 2600 + Math.random() * 1600;
      o.frequency.setValueAtTime(f, start);
      o.frequency.exponentialRampToValueAtTime(f * 1.5, start + 0.08);
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.025, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
      o.connect(g).connect(out);
      o.start(start);
      o.stop(start + 0.12);
    }
  }
}
