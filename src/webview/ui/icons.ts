import { s } from './dom';

/**
 * Line icons for the dashboard, drawn on a 16-unit grid in the style of the
 * editor's own: a branch for Source Control, a pull request for PRs.
 */

function icon(cls: string, ...parts: SVGElement[]): SVGSVGElement {
  return s('svg', { viewBox: '0 0 16 16', class: `icon ${cls}`, 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, ...parts);
}

/** Two commits on a trunk and a branch curving off it. */
export function branchIcon(): SVGSVGElement {
  return icon(
    'icon-branch',
    s('circle', { cx: 4.5, cy: 3.5, r: 1.6 }),
    s('circle', { cx: 4.5, cy: 12.5, r: 1.6 }),
    s('circle', { cx: 11.5, cy: 5, r: 1.6 }),
    s('path', { d: 'M4.5 5.1v5.8M11.5 6.6c0 3-7 2.2-7 4.3' }),
  );
}

/** A bell, for alerts. */
export function bellIcon(): SVGSVGElement {
  return icon('icon-bell', s('path', { d: 'M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8zM6.6 14.2a1.5 1.5 0 0 0 2.8 0' }));
}

/** A branch's head flowing back into its base. */
export function pullRequestIcon(): SVGSVGElement {
  return icon(
    'icon-pr',
    s('circle', { cx: 4.5, cy: 3.5, r: 1.6 }),
    s('circle', { cx: 4.5, cy: 12.5, r: 1.6 }),
    s('circle', { cx: 11.5, cy: 12.5, r: 1.6 }),
    s('path', { d: 'M4.5 5.1v5.8M11.5 10.9V6.5c0-1.4-.9-2.2-2.2-2.2H7.5M9 2.8 7.5 4.3 9 5.8' }),
  );
}

/**
 * A glovebox lid seen from the passenger seat: a dark panel with a chrome pull
 * handle in its recess, and a keyhole beside it. Drawn on a 160 × 56 grid.
 */
export function gloveboxArt(): SVGSVGElement {
  const stops = (id: string, ...colours: [number, string][]) =>
    s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, ...colours.map(([offset, colour]) => s('stop', { offset, 'stop-color': colour })));
  return s(
    'svg',
    { viewBox: '0 0 160 56', class: 'glovebox-art', 'aria-hidden': 'true' },
    s(
      'defs',
      {},
      stops('gb-lid', [0, '#20242d'], [1, '#0e1116']),
      stops('gb-pocket', [0, '#020304'], [1, '#161a21']),
      stops('gb-chrome', [0, '#f3f5f8'], [0.45, '#aab2bc'], [0.56, '#69717d'], [1, '#c6ccd3']),
    ),
    s('rect', { class: 'gb-lid', x: 1, y: 1, width: 158, height: 54, rx: 9, fill: 'url(#gb-lid)' }),
    // Light catching the lid's top edge.
    s('path', { d: 'M10 2.2h140', stroke: 'rgba(255,255,255,0.14)', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    s('rect', { x: 45, y: 12, width: 70, height: 20, rx: 10, fill: 'url(#gb-pocket)', stroke: 'rgba(0,0,0,0.65)', 'stroke-width': 1 }),
    s('path', { d: 'M55 31.6h50', stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    s(
      'g',
      { class: 'gb-handle' },
      s('rect', { x: 51, y: 16.5, width: 58, height: 10, rx: 5, fill: 'url(#gb-chrome)', stroke: 'rgba(255,255,255,0.45)', 'stroke-width': 0.6 }),
      s('path', { d: 'M55.5 18.6h49', stroke: 'rgba(255,255,255,0.8)', 'stroke-width': 1, 'stroke-linecap': 'round' }),
    ),
    // The lock.
    s('circle', { cx: 128, cy: 22, r: 4, fill: 'url(#gb-chrome)', stroke: 'rgba(0,0,0,0.5)', 'stroke-width': 0.6 }),
    s('rect', { x: 127.3, y: 19.6, width: 1.4, height: 4.8, rx: 0.7, fill: '#2a2f37' }),
  );
}
