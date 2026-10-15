import type { MusicLevels } from '../../core/music';

/**
 * The radio's equalizer lights: columns of orange segments with red tips,
 * like an old head unit's "distorting" registers. Columns fall at a steady
 * rate and leave a peak dot that holds, then drops.
 */

export interface EqFrame {
  /** Column heights in segments (fractional). */
  heights: number[];
  /** Lit segments per column. */
  lit: number[];
  peaks: number[];
  /** Seconds each peak still holds. */
  holds: number[];
}

/** Segments per second. */
const FALL = 16;
const PEAK_FALL = 5;
const PEAK_HOLD = 0.6;

/** The next frame from 0..1 band levels. `dt` in seconds; `gain` follows the volume. */
export function eqColumns(bands: number[], prev: EqFrame | undefined, dt: number, segs = 10, gain = 1): EqFrame {
  const heights: number[] = [];
  const lit: number[] = [];
  const peaks: number[] = [];
  const holds: number[] = [];
  bands.forEach((v, i) => {
    const target = Math.min(1, Math.max(0, v * gain)) * segs;
    const height = Math.max(target, (prev?.heights[i] ?? 0) - FALL * dt);
    let peak = prev?.peaks[i] ?? 0;
    let hold = (prev?.holds[i] ?? 0) - dt;
    if (height >= peak) {
      peak = height;
      hold = PEAK_HOLD;
    } else if (hold <= 0) {
      peak = Math.max(height, peak - PEAK_FALL * dt);
    }
    heights.push(height);
    lit.push(Math.round(height));
    peaks.push(peak);
    holds.push(hold);
  });
  return { heights, lit, peaks, holds };
}

/** Segment colour, counted from the bottom (0): the top two are red. */
export function segmentTone(seg: number, segs = 10): 'amber' | 'red' {
  return seg >= segs - 2 ? 'red' : 'amber';
}

export interface EqSource {
  levels(): MusicLevels;
  /** 0..1: the lights fall when the volume goes down. */
  gain(): number;
  reducedMotion(): boolean;
}

export class EqLights {
  private frame?: EqFrame;
  private raf = 0;
  private visible = false;
  private lastDraw = 0;
  private colors?: { amber: string; red: string };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly source: EqSource,
    private readonly segs = 10,
    /** Called with each frame's beat (0..1), e.g. to pulse the live dot. */
    private readonly onBeat?: (beat: number) => void,
  ) {}

  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    if (on) this.raf = requestAnimationFrame(this.loop);
    else cancelAnimationFrame(this.raf);
  }

  private readonly loop = (t: number): void => {
    if (!this.visible) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.canvas.isConnected || this.canvas.offsetParent === null) return;
    // 15 fps under reduced motion.
    if (this.source.reducedMotion() && t - this.lastDraw < 66) return;
    const dt = this.lastDraw ? Math.min(0.25, (t - this.lastDraw) / 1000) : 0.016;
    this.lastDraw = t;
    const levels = this.source.levels();
    this.frame = eqColumns(levels.bands, this.frame, dt, this.segs, Math.sqrt(Math.max(0, this.source.gain())));
    this.onBeat?.(levels.beat);
    this.draw(this.frame, levels.beat);
  };

  private draw(frame: EqFrame, beat: number): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const hgt = Math.round(c.clientHeight * dpr);
    if (!w || !hgt) return;
    if (c.width !== w || c.height !== hgt) {
      c.width = w;
      c.height = hgt;
    }
    if (!this.colors) {
      const css = getComputedStyle(c);
      this.colors = { amber: css.getPropertyValue('--amber').trim() || '#ffb35c', red: css.getPropertyValue('--red').trim() || '#ff6b5b' };
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, hgt);
    const cols = frame.lit.length;
    const gap = Math.max(1, Math.round(2 * dpr));
    const colW = (w - gap * (cols - 1)) / cols;
    const segH = (hgt - gap * (this.segs - 1)) / this.segs;
    for (let i = 0; i < cols; i++) {
      const x = i * (colW + gap);
      const peak = Math.min(this.segs - 1, Math.floor(frame.peaks[i]));
      for (let s = 0; s < this.segs; s++) {
        const y = hgt - (s + 1) * segH - s * gap;
        const on = s < frame.lit[i];
        const isPeak = !on && s === peak && frame.peaks[i] >= 1;
        g.fillStyle = segmentTone(s, this.segs) === 'red' ? this.colors.red : this.colors.amber;
        // Lit segments glow brighter on a bass-drum hit; off ones stay faintly visible.
        g.globalAlpha = on ? 0.82 + 0.18 * beat : isPeak ? 0.7 : 0.09;
        g.fillRect(x, y, colW, isPeak ? Math.max(1, segH * 0.4) : segH);
      }
    }
    g.globalAlpha = 1;
  }
}
