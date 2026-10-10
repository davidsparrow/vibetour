/** Tiny DOM helpers — the UI is plain TypeScript, no framework. */

type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Sets textContent only when it changed (avoids layout churn at 4 Hz). */
export function text(el: Element, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const renderKeys = new WeakMap<Element, string>();

/**
 * Rebuilds `el` only when `key` changes. Snapshots arrive at 4 Hz: rebuilding
 * on each one would swap buttons out from under a click and drop their focus.
 */
export function renderKeyed(el: Element, key: string, build: () => void): void {
  if (renderKeys.get(el) === key) return;
  renderKeys.set(el, key);
  clear(el);
  build();
}

const CONFIRM_MS = 4_000;

/**
 * A button for actions that lose progress: while `needsConfirm()` holds, the
 * first click only arms it (showing `confirmLabel`) and a second click within
 * a few seconds acts. Webviews cannot show `window.confirm`.
 */
export function confirmButton(attrs: Attrs, label: string, confirmLabel: string, run: () => void, needsConfirm: () => boolean = () => true): HTMLButtonElement {
  const btn = h('button', attrs, label);
  let armed = 0;
  const disarm = () => {
    window.clearTimeout(armed);
    armed = 0;
    btn.textContent = label;
    btn.classList.remove('btn-confirm');
  };
  btn.addEventListener('click', () => {
    if (armed || !needsConfirm()) {
      disarm();
      run();
      return;
    }
    btn.textContent = confirmLabel;
    btn.classList.add('btn-confirm');
    armed = window.setTimeout(disarm, CONFIRM_MS);
  });
  btn.addEventListener('blur', () => armed && disarm());
  return btn;
}

export function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** How long something has been running: seconds for the first minute, then like formatDuration. */
export function formatElapsed(ms: number): string {
  return ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : formatDuration(ms);
}

export function timeAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

export function formatDate(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

const ICONS: Record<string, string> = {
  pin: 'M12 21s-6.5-7.2-6.5-11.5a6.5 6.5 0 0 1 13 0C18.5 13.8 12 21 12 21z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  passport: 'M6.5 3h10A1.5 1.5 0 0 1 18 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z M11.5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M8.5 17h6',
  camera: 'M4 8h3l1.8-2.5h6.4L17 8h3v11H4z M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  sound: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15.5 9a4 4 0 0 1 0 6 M17.8 6.8a7 7 0 0 1 0 10.4',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 5v4 M9 15v4 M4 12h5 M13 12h7 M11 10v4',
};

/** Stroke icon from a tiny built-in set. */
export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  return s('svg', { viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true' }, s('path', { d: ICONS[name] ?? '' }));
}
