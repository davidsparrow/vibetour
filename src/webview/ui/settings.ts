import type { AudioPrefs, ClientPrefs, DisplayMode } from '../../core/protocol';
import type { AppContext } from './context';
import { clear, h } from './dom';

/** Settings: display, comfort & accessibility (PRD §24), performance (§25), sound (§14), privacy (§29). */
export class SettingsPanel {
  readonly el = h('div', { class: 'overlay settings', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' });

  constructor(
    private readonly ctx: AppContext,
    private readonly onSound: (enable: boolean) => void,
    private readonly stats: () => { fps: number; pixelRatio: number },
  ) {}

  render(): void {
    clear(this.el);
    const p = this.ctx.prefs;
    const set = (change: (p: ClientPrefs) => void) => {
      this.ctx.updatePrefs(change);
      this.render();
    };
    const toggleRow = (label: string, hint: string, value: boolean, change: (p: ClientPrefs, v: boolean) => void) => {
      const id = `set-${label.replace(/\W+/g, '-').toLowerCase()}`;
      const input = h('input', { type: 'checkbox', id, checked: value }) as HTMLInputElement;
      input.addEventListener('change', () => set((pr) => change(pr, input.checked)));
      return h('label', { class: 'set-row', for: id }, input, h('span', {}, h('strong', {}, label), h('em', {}, hint)));
    };
    const slider = (label: string, key: keyof AudioPrefs) => {
      const id = `vol-${key}`;
      const input = h('input', { type: 'range', id, min: '0', max: '1', step: '0.05', value: String(p.audio[key]) }) as HTMLInputElement;
      input.addEventListener('input', () => this.ctx.updatePrefs((pr) => ((pr.audio[key] as number) = Number(input.value))));
      return h('label', { class: 'set-slider', for: id }, h('span', {}, label), input);
    };
    const segmented = <T extends string | number>(label: string, options: Array<[T, string]>, value: T, change: (p: ClientPrefs, v: T) => void) =>
      h(
        'div',
        { class: 'set-row seg-row', role: 'group', 'aria-label': label },
        h('span', {}, h('strong', {}, label)),
        h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: v === value ? 'on' : '', 'aria-pressed': v === value ? 'true' : 'false', onclick: () => set((pr) => change(pr, v)) }, l))),
      );
    const st = this.stats();
    const host = this.ctx.host;

    this.el.append(
      h(
        'div',
        { class: 'settings-sheet' },
        h('header', { class: 'settings-head' }, h('h1', {}, 'Settings'), h('button', { class: 'btn btn-ghost', onclick: () => this.ctx.close() }, 'Done')),
        h(
          'section',
          {},
          h('h2', {}, 'Display'),
          segmented<DisplayMode>('Mode', [['tour', 'Tour'], ['dashboard', 'Dashboard'], ['work', 'Work']], p.mode, (pr, v) => (pr.mode = v)),
          segmented<number>('Interface scale', [[0.85, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], p.uiScale, (pr, v) => (pr.uiScale = v)),
          toggleRow('High-contrast instruments', 'Solid panels, bolder gauges', p.highContrast, (pr, v) => (pr.highContrast = v)),
          segmented<ClientPrefs['fuel']>('Fuel gauge shows', [['journey', 'Journey'], ['context', 'Agent context'], ['battery', 'Battery']], p.fuel, (pr, v) => (pr.fuel = v)),
        ),
        h(
          'section',
          {},
          h('h2', {}, 'Comfort & accessibility'),
          toggleRow('Reduced motion', 'Slower, smoother travel; no sway or bob', p.reducedMotion, (pr, v) => (pr.reducedMotion = v)),
          toggleRow('Static scenery', 'No vehicle motion — a rotating series of scenic stops', p.staticScenery, (pr, v) => (pr.staticScenery = v)),
          toggleRow('Disable camera movement', 'Keep the horizon perfectly still', p.noCameraMotion, (pr, v) => (pr.noCameraMotion = v)),
          toggleRow('Disable weather effects', 'No rain, snow or fog particles', p.noWeather, (pr, v) => (pr.noWeather = v)),
        ),
        h(
          'section',
          {},
          h('h2', {}, 'Performance'),
          segmented<30 | 60>('Frame rate', [[30, '30 FPS · low power'], [60, '60 FPS']], p.fps, (pr, v) => (pr.fps = v)),
          toggleRow('Low GPU mode', 'Lower resolution and fewer props for integrated graphics', p.lowGpu, (pr, v) => (pr.lowGpu = v)),
          toggleRow('Automatic GPU throttling', 'Lower resolution when frames take too long', p.autoThrottle, (pr, v) => (pr.autoThrottle = v)),
          h('p', { class: 'small muted' }, `Currently ${st.fps} FPS at ${st.pixelRatio.toFixed(2)}× resolution. Rendering pauses whenever VibeTour is hidden.`),
        ),
        h(
          'section',
          {},
          h('h2', {}, 'Sound'),
          toggleRow('Tour audio', 'Engine, road, wind, weather, ambience and Focus Mix', p.audio.enabled, (pr, v) => {
            pr.audio.enabled = v;
            this.onSound(v);
          }),
          slider('Master', 'master'),
          slider('Engine', 'engine'),
          slider('Road', 'road'),
          slider('Wind', 'wind'),
          slider('Weather', 'weather'),
          slider('Ambience', 'ambience'),
          slider('Focus Mix music', 'music'),
        ),
        h(
          'section',
          {},
          h('h2', {}, 'Privacy'),
          toggleRow('Include project name in captures', 'Off by default — file names are never included', p.captureIncludeProject, (pr, v) => (pr.captureIncludeProject = v)),
          h(
            'p',
            { class: 'small muted' },
            this.ctx.snapshot?.privacy.streaming
              ? 'Streaming mode is ON: file names, paths, branches, commands and messages are hidden at the source.'
              : host?.kind === 'vscode' || host?.kind === 'companion'
                ? 'Streaming mode hides file names, paths, branches, commands and messages. Toggle it with “VibeTour: Toggle Streaming Mode”.'
                : 'Streaming mode hides file names, paths, branches, commands and messages (start the companion with --streaming).',
          ),
          h('p', { class: 'small muted' }, 'VibeTour reads activity metadata only — never your source code — and nothing leaves your machine.'),
        ),
        h(
          'section',
          {},
          h('h2', {}, 'About'),
          h('p', { class: 'small muted' }, `VibeTour ${host?.version ?? ''} · ${host?.kind ?? 'offline'} display${host?.projectName ? ` · project ${host.projectName}` : ''}`),
          host?.companionUrl ? h('p', { class: 'small muted' }, 'Companion display: open “VibeTour: Open Companion Display” for a second screen.') : null,
          h('button', { class: 'btn btn-ghost', onclick: () => this.ctx.open('help') }, 'Keyboard shortcuts'),
        ),
      ),
    );
  }
}

export function helpOverlay(close: () => void): HTMLElement {
  const row = (k: string, v: string) => h('div', { class: 'key-row' }, h('kbd', {}, k), h('span', {}, v));
  return h(
    'div',
    { class: 'overlay help', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' },
    h(
      'div',
      { class: 'settings-sheet help-sheet' },
      h('header', { class: 'settings-head' }, h('h1', {}, 'Keyboard'), h('button', { class: 'btn btn-ghost', onclick: close }, 'Done')),
      row('T', 'Tour mode — the view'),
      row('D', 'Dashboard mode — instruments'),
      row('W', 'Work mode — information dense'),
      row('G', 'Where do you want to go today?'),
      row('P', 'Passport'),
      row('C', 'Capture my workplace'),
      row('M', 'Sound on / off'),
      row('S', 'Settings'),
      row('A', 'Arrive — objective complete'),
      row('Esc', 'Close panels'),
      h('p', { class: 'small muted' }, 'In VS Code, Ctrl+Alt+V (⌘⌥V) switches between the tour and your full IDE.'),
    ),
  );
}
