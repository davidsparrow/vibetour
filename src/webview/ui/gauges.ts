import { h, s, text } from './dom';

/**
 * Cockpit instruments (PRD §8): analogue-style SVG gauges whose needles show
 * development activity rather than vehicle telemetry.
 */
export interface GaugeOptions {
  label: string;
  /** Labels at the start and end of the scale, e.g. E / F. */
  ends?: [string, string];
  ticks?: number;
  tone?: 'amber' | 'cyan' | 'green' | 'red' | 'blue';
  size?: 'large' | 'small';
  /** False: a digital dial, its number large in the middle of a lit ring. */
  needle?: boolean;
  /** Shown before the label, e.g. a branch for Changes. */
  icon?: SVGElement;
  /**
   * A red zone, like a tachometer's redline: the top quarter of the dial (`high`), or the
   * bottom quarter for a gauge that runs out (`low`). It is marked faintly all the time and
   * saturates where the value reaches it.
   */
  zone?: 'high' | 'low';
  ariaLabel: string;
}

/** Where a high red zone starts, and a low one ends. */
export const RED_ZONE_FROM = 0.75;
const RED_ZONE_TO = 0.25;

/**
 * How a value splits between the gauge's own colour and its red zone. `main` is how far the
 * coloured arc runs (0–1 of the dial); `hot` how much of a high zone is lit (0–1 of the zone);
 * `inZone` whether the value is in the red. A low zone turns the whole arc red instead.
 */
export function zoneSplit(value: number, zone?: 'high' | 'low'): { main: number; hot: number; inZone: boolean } {
  const v = Math.max(0, Math.min(1, value));
  if (zone === 'high') return { main: Math.min(v, RED_ZONE_FROM), hot: Math.max(0, v - RED_ZONE_FROM) / (1 - RED_ZONE_FROM), inZone: v >= RED_ZONE_FROM };
  if (zone === 'low') return { main: v, hot: 0, inZone: v <= RED_ZONE_TO };
  return { main: v, hot: 0, inZone: false };
}

const START = 135;
const SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export class Gauge {
  readonly el: HTMLElement;
  private readonly valueArc: SVGPathElement;
  /** A high zone's lit part, drawn over the zone's mark. */
  private readonly hotArc?: SVGPathElement;
  private readonly hotLength: number;
  private readonly zone?: 'high' | 'low';
  private readonly needle: SVGGElement;
  private readonly readout: SVGTextElement;
  /** Inside a digital dial, under its number. */
  private readonly note: SVGTextElement;
  private readonly length: number;
  private last = -1;

  constructor(opts: GaugeOptions) {
    const r = 42;
    const svg = s('svg', { viewBox: '0 0 100 100', class: 'gauge-svg', 'aria-hidden': 'true' });
    svg.append(s('path', { d: arc(50, 50, r, START, START + SWEEP), class: 'gauge-track' }));
    this.zone = opts.zone;
    if (opts.zone) {
      const [from, to] = opts.zone === 'high' ? [RED_ZONE_FROM, 1] : [0, RED_ZONE_TO];
      // Painted on the scale just inside the track, like a redline, so a filled arc never hides it.
      svg.append(s('path', { d: arc(50, 50, r - 6, START + SWEEP * from, START + SWEEP * to), class: 'gauge-zone' }));
    }
    const ticks = opts.ticks ?? 9;
    for (let i = 0; i < ticks; i++) {
      const deg = START + (SWEEP * i) / (ticks - 1);
      const [x1, y1] = polar(50, 50, r - 6, deg);
      const [x2, y2] = polar(50, 50, r - (i % 2 ? 9 : 12), deg);
      svg.append(s('line', { x1, y1, x2, y2, class: 'gauge-tick' }));
    }
    this.valueArc = s('path', { d: arc(50, 50, r, START, START + SWEEP), class: 'gauge-value' });
    this.length = (Math.PI * 2 * r * SWEEP) / 360;
    this.valueArc.style.strokeDasharray = `${this.length}`;
    this.valueArc.style.strokeDashoffset = `${this.length}`;
    svg.append(this.valueArc);
    this.hotLength = this.length * (1 - RED_ZONE_FROM);
    if (opts.zone === 'high') {
      this.hotArc = s('path', { d: arc(50, 50, r, START + SWEEP * RED_ZONE_FROM, START + SWEEP), class: 'gauge-hot' });
      this.hotArc.style.strokeDasharray = `${this.hotLength}`;
      this.hotArc.style.strokeDashoffset = `${this.hotLength}`;
      svg.append(this.hotArc);
    }
    const digital = opts.needle === false;
    this.needle = s('g', { class: 'gauge-needle' }, s('line', { x1: 50, y1: 50, x2: 50 + r - 14, y2: 50 }), s('circle', { cx: 50, cy: 50, r: 3.2 }));
    this.needle.style.transform = `rotate(${START}deg)`;
    if (!digital) svg.append(this.needle);
    this.readout = s('text', digital ? { x: 50, y: 50, class: 'gauge-readout', 'text-anchor': 'middle', 'dominant-baseline': 'central' } : { x: 50, y: 66, class: 'gauge-readout', 'text-anchor': 'middle' }, '0');
    svg.append(this.readout);
    this.note = s('text', { x: 50, y: 72, class: 'gauge-note', 'text-anchor': 'middle' });
    if (digital) svg.append(this.note);
    if (opts.ends) {
      const [lx, ly] = polar(50, 50, r - 2, START + 8);
      const [rx, ry] = polar(50, 50, r - 2, START + SWEEP - 8);
      svg.append(s('text', { x: lx + 4, y: ly + 10, class: 'gauge-end' }, opts.ends[0]));
      svg.append(s('text', { x: rx - 9, y: ry + 10, class: 'gauge-end' }, opts.ends[1]));
    }
    this.el = h(
      'div',
      {
        class: `gauge gauge-${opts.size ?? 'large'} tone-${opts.tone ?? 'amber'}${digital ? ' gauge-digital' : ''}${opts.zone ? ` gauge-zone-${opts.zone}` : ''}`,
        role: 'meter',
        'aria-label': opts.ariaLabel,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': 0,
      },
      svg,
      h('div', { class: 'gauge-label' }, opts.icon ?? null, opts.label),
    );
  }

  /** A short note under a digital dial's number, e.g. "↑2" for commits to push. */
  setNote(value: string): void {
    text(this.note, value);
  }

  set(value: number, readout: string, valueText?: string): void {
    this.el.classList.remove('gauge-unknown');
    const v = Math.max(0, Math.min(1, value));
    if (Math.abs(v - this.last) > 0.004) {
      this.last = v;
      const split = zoneSplit(v, this.zone);
      this.valueArc.style.strokeDashoffset = `${this.length * (1 - split.main)}`;
      if (this.hotArc) this.hotArc.style.strokeDashoffset = `${this.hotLength * (1 - split.hot)}`;
      this.el.classList.toggle('gauge-in-zone', split.inZone);
      this.needle.style.transform = `rotate(${START + SWEEP * v}deg)`;
      this.el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    }
    text(this.readout, readout);
    if (valueText) this.el.setAttribute('aria-valuetext', valueText);
  }

  /** No reading yet: an empty dial with a dash and no needle. */
  setUnknown(valueText: string): void {
    this.el.classList.add('gauge-unknown');
    this.el.classList.remove('gauge-in-zone');
    this.last = -1;
    this.valueArc.style.strokeDashoffset = `${this.length}`;
    if (this.hotArc) this.hotArc.style.strokeDashoffset = `${this.hotLength}`;
    this.el.removeAttribute('aria-valuenow');
    this.el.setAttribute('aria-valuetext', valueText);
    text(this.readout, '—');
  }
}
