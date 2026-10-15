import { EQ_BANDS, type MusicLevels } from '../../core/music';

/**
 * What the equalizer lights show, measured from an AnalyserNode: twelve
 * log-spaced bands, bass/mid/treble, and a bass-drum onset for the beat.
 * The maths is in pure helpers so it can be tested with a fake spectrum.
 */

export const SILENT: MusicLevels = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, playing: false, bands: new Array(EQ_BANDS).fill(0) };

/** `count + 1` log-spaced band edges in Hz. */
export function bandEdges(count = EQ_BANDS, lo = 40, hi = 16_000): number[] {
  return Array.from({ length: count + 1 }, (_, i) => lo * Math.pow(hi / lo, i / count));
}

/** Mean of the spectrum bins (0..255) between two frequencies, as 0..1; at least one bin. */
export function rangeLevel(spectrum: ArrayLike<number>, binHz: number, lo: number, hi: number): number {
  const from = Math.max(0, Math.min(spectrum.length - 1, Math.round(lo / binHz)));
  const to = Math.max(from + 1, Math.min(spectrum.length, Math.round(hi / binHz)));
  let sum = 0;
  for (let k = from; k < to; k++) sum += spectrum[k];
  return sum / (to - from) / 255;
}

/**
 * One 0..1 level per band. Higher bands get a gentle lift: music has less
 * energy up there, and a flat display would leave the right side dark.
 */
export function bandsFromSpectrum(spectrum: ArrayLike<number>, binHz: number, edges = bandEdges()): number[] {
  const n = edges.length - 1;
  return Array.from({ length: n }, (_, i) => {
    const v = rangeLevel(spectrum, binHz, edges[i], edges[i + 1]) * (1 + (0.3 * i) / Math.max(1, n - 1));
    // The analyser's floor reads as a faint glow: keep it dark.
    return Math.min(1, Math.max(0, (v - 0.12) / 0.8));
  });
}

/** Bass-drum hits: energy well above its one-second running mean, at most one per 300 ms. */
export class OnsetDetector {
  private mean = -1;
  private last = -Infinity;

  constructor(
    private readonly windowMs = 1000,
    private readonly refractoryMs = 300,
    private readonly ratio = 1.3,
    private readonly floor = 0.15,
  ) {}

  /** `t` and `dt` in milliseconds. */
  push(energy: number, t: number, dt: number): boolean {
    // The first reading only sets the baseline: a song already playing is not one long beat.
    if (this.mean < 0) {
      this.mean = energy;
      return false;
    }
    const hit = energy > this.floor && energy > this.mean * this.ratio && t - this.last >= this.refractoryMs;
    this.mean += (energy - this.mean) * Math.min(1, dt / this.windowMs);
    if (hit) this.last = t;
    return hit;
  }
}

/** Fast rise, slower fall, so lights jump with the music and settle back. */
export function smooth(prev: number, next: number, dtMs: number, riseMs = 30, fallMs = 160): number {
  return prev + (next - prev) * Math.min(1, dtMs / (next > prev ? riseMs : fallMs));
}

export class AnalyserLevels {
  private readonly spectrum: Uint8Array<ArrayBuffer>;
  private readonly edges = bandEdges();
  private readonly onset = new OnsetDetector();
  private state: MusicLevels = { ...SILENT, bands: [...SILENT.bands] };
  private lastT = 0;

  constructor(private readonly analyser: AnalyserNode) {
    this.spectrum = new Uint8Array(analyser.frequencyBinCount);
  }

  read(playing: boolean, t = performance.now()): MusicLevels {
    const dt = this.lastT ? Math.min(250, t - this.lastT) : 16;
    this.lastT = t;
    const s = this.state;
    if (!playing) {
      // Let the lights fall rather than snap off.
      const fall = (v: number) => smooth(v, 0, dt);
      this.state = { level: fall(s.level), bass: fall(s.bass), mid: fall(s.mid), treble: fall(s.treble), beat: fall(s.beat), playing: false, bands: s.bands.map(fall) };
      return this.state;
    }
    this.analyser.getByteFrequencyData(this.spectrum);
    const binHz = this.analyser.context.sampleRate / this.analyser.fftSize;
    const bands = bandsFromSpectrum(this.spectrum, binHz, this.edges);
    const bass = rangeLevel(this.spectrum, binHz, 40, 160);
    const mid = rangeLevel(this.spectrum, binHz, 160, 2000);
    const treble = rangeLevel(this.spectrum, binHz, 2000, 12_000);
    const hit = this.onset.push(bass, t, dt);
    this.state = {
      level: smooth(s.level, (bass + mid + treble) / 3, dt),
      bass: smooth(s.bass, bass, dt),
      mid: smooth(s.mid, mid, dt),
      treble: smooth(s.treble, treble, dt),
      beat: hit ? 1 : smooth(s.beat, 0, dt, 30, 220),
      playing: true,
      bands: bands.map((v, i) => smooth(s.bands[i] ?? 0, v, dt)),
    };
    return this.state;
  }
}
