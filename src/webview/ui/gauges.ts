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
  tone?: 'amber' | 'cyan' | 'green' | 'red';
  size?: 'large' | 'small';
  ariaLabel: string;
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
  private readonly needle: SVGGElement;
  private readonly readout: SVGTextElement;
  private readonly length: number;
  private last = -1;

  constructor(opts: GaugeOptions) {
    const r = 42;
    const svg = s('svg', { viewBox: '0 0 100 100', class: 'gauge-svg', 'aria-hidden': 'true' });
    svg.append(s('path', { d: arc(50, 50, r, START, START + SWEEP), class: 'gauge-track' }));
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
    this.needle = s('g', { class: 'gauge-needle' }, s('line', { x1: 50, y1: 50, x2: 50 + r - 14, y2: 50 }), s('circle', { cx: 50, cy: 50, r: 3.2 }));
    this.needle.style.transform = `rotate(${START}deg)`;
    svg.append(this.needle);
    this.readout = s('text', { x: 50, y: 66, class: 'gauge-readout', 'text-anchor': 'middle' }, '0');
    svg.append(this.readout);
    if (opts.ends) {
      const [lx, ly] = polar(50, 50, r - 2, START + 8);
      const [rx, ry] = polar(50, 50, r - 2, START + SWEEP - 8);
      svg.append(s('text', { x: lx + 4, y: ly + 10, class: 'gauge-end' }, opts.ends[0]));
      svg.append(s('text', { x: rx - 9, y: ry + 10, class: 'gauge-end' }, opts.ends[1]));
    }
    this.el = h(
      'div',
      {
        class: `gauge gauge-${opts.size ?? 'large'} tone-${opts.tone ?? 'amber'}`,
        role: 'meter',
        'aria-label': opts.ariaLabel,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': 0,
      },
      svg,
      h('div', { class: 'gauge-label' }, opts.label),
    );
  }

  set(value: number, readout: string, valueText?: string): void {
    const v = Math.max(0, Math.min(1, value));
    if (Math.abs(v - this.last) > 0.004) {
      this.last = v;
      this.valueArc.style.strokeDashoffset = `${this.length * (1 - v)}`;
      this.needle.style.transform = `rotate(${START + SWEEP * v}deg)`;
      this.el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    }
    text(this.readout, readout);
    if (valueText) this.el.setAttribute('aria-valuetext', valueText);
  }

  setLabel(label: string): void {
    text(this.el.querySelector('.gauge-label')!, label);
  }
}
