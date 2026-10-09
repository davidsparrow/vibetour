import { defaultVariant, type JourneyPack, type TimeOfDay } from '../../core/packs';
import { s } from './dom';

/** Stylised destination artwork for Journey cards and tickets (PRD §46, §48). */

const SKY: Record<TimeOfDay, [string, string, string]> = {
  dawn: ['#2c3d6e', '#f2a98c', '#ffd2b0'],
  morning: ['#4f86cf', '#cfe3f2', '#fff4dc'],
  day: ['#3473cf', '#b9d6ef', '#ffffff'],
  golden: ['#41629f', '#f3c48a', '#ffe1a8'],
  sunset: ['#2b3b74', '#ff9a64', '#ffd0a0'],
  dusk: ['#151c40', '#7e5c8e', '#ffb3a0'],
  night: ['#050915', '#1c2850', '#e6ecff'],
};

function ridge(seed: number, base: number, amp: number, jag: number): string {
  let d = `M 0 100 L 0 ${base}`;
  for (let x = 0; x <= 100; x += 4) {
    const n = Math.sin(x * 0.11 + seed) * 0.5 + Math.sin(x * 0.27 + seed * 2.3) * 0.3 + Math.sin(x * 0.9 + seed) * 0.2 * jag;
    d += ` L ${x} ${(base - amp * (0.5 + n * 0.5)).toFixed(1)}`;
  }
  return `${d} L 100 100 Z`;
}

function skyline(seed: number, base: number): string {
  let d = `M 0 100 L 0 ${base}`;
  let x = 0;
  let i = 0;
  while (x < 100) {
    const w = 3 + ((Math.sin(seed + i * 12.9) + 1) / 2) * 6;
    const hgt = 6 + ((Math.sin(seed * 3 + i * 7.7) + 1) / 2) * 26 + (i % 7 === 3 ? 14 : 0);
    d += ` L ${x.toFixed(1)} ${base - hgt} L ${(x + w).toFixed(1)} ${base - hgt}`;
    x += w;
    i++;
  }
  return `${d} L 100 ${base} L 100 100 Z`;
}

export function coverArt(pack: JourneyPack, timeOfDay?: TimeOfDay, skyTint?: string): SVGSVGElement {
  const tod = timeOfDay ?? defaultVariant(pack).timeOfDay;
  const [top, horizon, sun] = SKY[tod];
  const id = `g-${pack.id}-${tod}`;
  const svg = s('svg', { viewBox: '0 0 100 60', preserveAspectRatio: 'xMidYMid slice', class: 'cover-art', 'aria-hidden': 'true' });
  const defs = s('defs');
  const grad = s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(s('stop', { offset: '0', 'stop-color': skyTint ? mixHex(top, skyTint, 0.6) : top }));
  grad.append(s('stop', { offset: '0.75', 'stop-color': skyTint ? mixHex(horizon, skyTint, 0.7) : horizon }));
  defs.append(grad);
  svg.append(defs, s('rect', { x: 0, y: 0, width: 100, height: 60, fill: `url(#${id})` }));
  const night = tod === 'night' || tod === 'dusk';
  if (night) {
    for (let i = 0; i < 26; i++) {
      svg.append(s('circle', { cx: (i * 37) % 100, cy: (i * 13) % 30, r: i % 5 === 0 ? 0.45 : 0.25, fill: '#fff', opacity: 0.8 }));
    }
  }
  const sunY = tod === 'day' ? 10 : tod === 'morning' ? 18 : tod === 'night' ? 12 : 34;
  svg.append(s('circle', { cx: tod === 'night' ? 78 : 66, cy: sunY, r: tod === 'night' ? 3 : 5, fill: sun, opacity: 0.95 }));
  const p = pack.palette;
  const seed = pack.id.length * 1.7;
  const env = pack.environment;
  const kinds = [env.left?.terrain, env.right?.terrain];
  const g = s('g', { transform: 'translate(0,-40)' });
  if (kinds.includes('city')) {
    g.append(s('path', { d: skyline(seed, 92), fill: mixHex(p.building, '#000000', 0.55), opacity: 0.9 }));
    g.append(s('path', { d: skyline(seed + 4, 98), fill: mixHex(p.building, '#000000', 0.75) }));
    if (night) {
      for (let i = 0; i < 40; i++) {
        g.append(s('rect', { x: (i * 23) % 100, y: 78 + ((i * 7) % 18), width: 0.8, height: 1, fill: p.accents[i % p.accents.length], opacity: 0.9 }));
      }
    }
  } else {
    const mountains = kinds.includes('mountains');
    g.append(s('path', { d: ridge(seed, mountains ? 80 : 88, mountains ? 30 : 12, mountains ? 1 : 0.2), fill: mixHex(p.rock, horizon, 0.45) }));
    if (mountains && pack.moods.includes('mountains')) {
      g.append(s('path', { d: ridge(seed, 80, 30, 1), fill: p.snow, opacity: 0.35, 'clip-path': 'none' }));
    }
    g.append(s('path', { d: ridge(seed + 2, 94, 10, 0.3), fill: mixHex(p.ground, '#000000', night ? 0.6 : 0.15) }));
  }
  if (kinds.includes('ocean') || kinds.includes('cliffs') || kinds.includes('lake')) {
    g.append(s('rect', { x: 55, y: 93, width: 45, height: 8, fill: mixHex(p.water, horizon, 0.25) }));
    g.append(s('rect', { x: 60, y: 94.5, width: 30, height: 0.5, fill: sun, opacity: 0.5 }));
  }
  if (pack.moods.includes('fantasy')) {
    g.append(s('circle', { cx: 22, cy: 58, r: 2.2, fill: '#e9e0d4', opacity: 0.85 }));
  }
  // Road vanishing into the scene.
  g.append(s('path', { d: 'M 38 100 L 49.4 92 L 50.6 92 L 62 100 Z', fill: mixHex(p.road, '#000000', 0.2) }));
  g.append(s('path', { d: 'M 50 100 L 50 92', stroke: p.roadLine, 'stroke-width': 0.4, 'stroke-dasharray': '1.2 1.2' }));
  svg.append(g);
  return svg;
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (v: number, shift: number) => (v >> shift) & 255;
  const m = (shift: number) => Math.round(ch(pa, shift) + (ch(pb, shift) - ch(pa, shift)) * t);
  return `#${((m(16) << 16) | (m(8) << 8) | m(0)).toString(16).padStart(6, '0')}`;
}

export function flagFor(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '✦';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
