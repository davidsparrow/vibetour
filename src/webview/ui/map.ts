import type { JourneyPack } from '../../core/packs';
import { h, s, text } from './dom';

/** Position along the route polyline for a journey progress 0..1. */
export function routePoint(pack: JourneyPack, progress: number): { x: number; y: number } {
  const w = pack.route.waypoints;
  if (progress <= w[0].at) return { x: w[0].x, y: w[0].y };
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i];
    const b = w[i + 1];
    if (progress <= b.at) {
      const t = (progress - a.at) / Math.max(1e-6, b.at - a.at);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  const last = w[w.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Navigation display (PRD §8): a stylised route map with the vehicle's
 * position, waypoints and the destination.
 */
export class RouteMap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private done?: SVGPolylineElement;
  private car?: SVGCircleElement;
  private halo?: SVGCircleElement;
  private packId = '';
  private readonly caption: HTMLElement;

  constructor(private readonly compact = false) {
    this.svg = s('svg', { viewBox: '0 0 100 100', class: 'route-svg', 'aria-hidden': 'true' });
    this.caption = h('div', { class: 'route-caption' });
    this.el = h('div', { class: `route-map${compact ? ' compact' : ''}` }, this.svg, this.caption);
  }

  private build(pack: JourneyPack): void {
    this.packId = pack.id;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const pts = pack.route.waypoints.map((w) => `${(w.x * 100).toFixed(1)},${(w.y * 100).toFixed(1)}`).join(' ');
    // Faint graticule for a cartographic feel.
    for (let i = 1; i < 5; i++) {
      this.svg.append(s('line', { x1: i * 20, y1: 0, x2: i * 20, y2: 100, class: 'route-grid' }));
      this.svg.append(s('line', { x1: 0, y1: i * 20, x2: 100, y2: i * 20, class: 'route-grid' }));
    }
    this.svg.append(s('polyline', { points: pts, class: 'route-line' }));
    this.done = s('polyline', { points: '', class: 'route-done' });
    this.svg.append(this.done);
    pack.route.waypoints.forEach((w, i) => {
      const last = i === pack.route.waypoints.length - 1;
      this.svg.append(s('circle', { cx: w.x * 100, cy: w.y * 100, r: last || i === 0 ? 2.2 : 1.3, class: last ? 'route-dest' : 'route-wp' }));
      if (!this.compact && (i === 0 || last)) {
        const anchor = w.x > 0.7 ? 'end' : w.x < 0.3 ? 'start' : 'middle';
        this.svg.append(s('text', { x: w.x * 100, y: w.y * 100 + (w.y > 0.85 ? -4 : 6.5), class: 'route-label', 'text-anchor': anchor }, w.name));
      }
    });
    this.halo = s('circle', { cx: 0, cy: 0, r: 5, class: 'route-halo' });
    this.car = s('circle', { cx: 0, cy: 0, r: 2.4, class: 'route-car' });
    this.svg.append(this.halo, this.car);
  }

  update(pack: JourneyPack, progress: number, caption: string): void {
    if (pack.id !== this.packId) this.build(pack);
    const p = Math.max(0, Math.min(1, progress));
    const pos = routePoint(pack, p);
    this.car!.setAttribute('cx', (pos.x * 100).toFixed(2));
    this.car!.setAttribute('cy', (pos.y * 100).toFixed(2));
    this.halo!.setAttribute('cx', (pos.x * 100).toFixed(2));
    this.halo!.setAttribute('cy', (pos.y * 100).toFixed(2));
    const passed = pack.route.waypoints.filter((w) => w.at <= p).map((w) => `${w.x * 100},${w.y * 100}`);
    passed.push(`${pos.x * 100},${pos.y * 100}`);
    this.done!.setAttribute('points', passed.join(' '));
    text(this.caption, caption);
  }
}
