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
