import { findVariant, resolveEnv, type JourneyPack } from '../core/packs';
import { mergePrefs, type Catalog, type ClientPrefs, type DisplayMode, type HostInfo, type HostMessage, type TourSnapshot } from '../core/protocol';
import { Soundscape } from './audio/soundscape';
import { hashString, TourRenderer, type RenderState } from './renderer/TourRenderer';
import type { Transport } from './transport';
import { captionFor, composeCapture, downloadCanvas } from './ui/capture';
import { Cockpit } from './ui/cockpit';
import type { AppContext } from './ui/context';
import { h, icon, text, toggle } from './ui/dom';
import { ArrivalCard, PassportView } from './ui/passport';
import { Picker } from './ui/picker';
import { helpOverlay, SettingsPanel } from './ui/settings';
import type { DemoAction } from './demo';

type Overlay = 'picker' | 'passport' | 'settings' | 'help' | undefined;

const MODES: DisplayMode[] = ['tour', 'dashboard', 'work'];

/**
 * The VibeTour display: renderer + cockpit + overlays. One codebase serves the
 * VS Code webview (Tour/Dashboard/Work), the Companion display and the demo.
 */
export class App implements AppContext {
  host?: HostInfo;
  catalog?: Catalog;
  snapshot?: TourSnapshot;
  prefs: ClientPrefs;

  private readonly root: HTMLElement;
  private readonly sceneEl = h('div', { class: 'scene' });
  private readonly canvas = h('canvas', { class: 'scene-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  private renderer?: TourRenderer;
  private readonly cockpit: Cockpit;
  private readonly picker: Picker;
  private readonly passport: PassportView;
  private readonly settings: SettingsPanel;
  private readonly arrival: ArrivalCard;
  private helpEl?: HTMLElement;
  private overlay: Overlay;
  private preview?: { packId: string; variantId?: string };
  private previewTimer = 0;
  private readonly sound = new Soundscape();
  private readonly announcer = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  private readonly summary = h('div', { class: 'sr-only', 'aria-live': 'off' });
  private readonly toastEl = h('div', { class: 'toast', role: 'status' });
  private readonly offline = h('div', { class: 'offline' }, 'Reconnecting to VibeTour…');
  private toastTimer = 0;
  private openedPicker = false;
  private idleTimer = 0;
  private lastPackId?: string;

  constructor(
    mount: HTMLElement,
    private readonly transport: Transport,
  ) {
    this.prefs = mergePrefs(transport.loadPrefs());
    this.cockpit = new Cockpit(this);
    this.picker = new Picker(this);
    this.passport = new PassportView(this);
    this.settings = new SettingsPanel(this, (on) => this.setSound(on), () => this.renderer?.stats ?? { fps: 0, pixelRatio: 0 });
    this.arrival = new ArrivalCard(this);
    this.sceneEl.append(this.canvas, h('div', { class: 'scene-fallback' }));

    const modeButtons = MODES.map((m) =>
      h('button', { class: 'mode-btn', 'data-mode': m, 'aria-pressed': 'false', onclick: () => this.setMode(m), title: `${m[0].toUpperCase()}${m.slice(1)} mode (${m[0].toUpperCase()})` }, m === 'dashboard' ? 'Dash' : m[0].toUpperCase() + m.slice(1)),
    );
    const topbar = h(
      'nav',
      { class: 'topbar', 'aria-label': 'VibeTour controls' },
      h('div', { class: 'seg modes', role: 'group', 'aria-label': 'Display mode' }, ...modeButtons),
      h('button', { class: 'top-btn', onclick: () => this.open('picker'), title: 'Destinations (G)', 'aria-label': 'Destinations' }, icon('pin')),
      h('button', { class: 'top-btn', onclick: () => this.open('passport'), title: 'Passport (P)', 'aria-label': 'Passport' }, icon('passport')),
      h('button', { class: 'top-btn', onclick: () => this.capture(), title: 'Capture my workplace (C)', 'aria-label': 'Capture my workplace' }, icon('camera')),
      h('button', { class: 'top-btn sound-btn', onclick: () => this.setSound(!this.prefs.audio.enabled), title: 'Sound (M)', 'aria-label': 'Sound', 'aria-pressed': 'false' }, icon('sound')),
      h('button', { class: 'top-btn', onclick: () => this.open('settings'), title: 'Settings (S)', 'aria-label': 'Settings' }, icon('settings')),
    );

    this.root = h(
      'div',
      { class: 'vt', id: 'vibetour' },
      this.sceneEl,
      this.cockpit.root,
      topbar,
      this.arrival.el,
      this.picker.el,
      this.passport.el,
      this.settings.el,
      this.toastEl,
      this.offline,
      this.announcer,
      this.summary,
    );
    if (transport.demo) this.root.append(this.demoPanel());
    mount.append(this.root);

    try {
      this.renderer = new TourRenderer(this.canvas, this.prefs);
      this.renderer.start();
      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.root.classList.add('no-webgl');
      });
    } catch (err) {
      // Graceful fallback for machines without WebGL (PRD §25).
      console.warn('VibeTour: WebGL unavailable', err);
      this.root.classList.add('no-webgl');
    }

    this.applyPrefs();
    transport.onMessage((m) => this.onMessage(m));
    transport.onStatus((ok) => toggle(this.offline, 'show', !ok));
    transport.send({ type: 'ready' });
    this.bindKeys();
    this.bindIdle();
    this.watchBattery();
    window.setInterval(() => this.tickSound(), 400);
  }

  // ------------------------------------------------------------ AppContext

  send(cmd: Parameters<Transport['send']>[0]): void {
    this.transport.send(cmd);
  }

  pack(id: string): JourneyPack | undefined {
    return this.catalog?.packs.find((p) => p.id === id);
  }

  setMode(mode: DisplayMode): void {
    if (mode === 'work' && this.host?.capabilities.focusIde && this.host.kind === 'vscode') {
      // In VS Code, Work Mode *is* the IDE (PRD §32).
      this.send({ type: 'focusIde' });
    }
    this.updatePrefs((p) => (p.mode = mode));
  }

  open(view: 'picker' | 'passport' | 'settings' | 'help'): void {
    this.close();
    this.overlay = view;
    if (view === 'picker') this.picker.open();
    if (view === 'passport') this.passport.render();
    if (view === 'settings') this.settings.render();
    if (view === 'help') {
      this.helpEl = helpOverlay(() => this.close());
      this.root.append(this.helpEl);
    }
    this.syncOverlays();
    queueMicrotask(() => (this.root.querySelector('.overlay.show button, .overlay.show [tabindex="0"]') as HTMLElement | null)?.focus());
  }

  close(): void {
    this.overlay = undefined;
    this.helpEl?.remove();
    this.helpEl = undefined;
    this.preview = undefined;
    this.syncOverlays();
    this.pushRenderState();
  }

  toast(message: string): void {
    text(this.toastEl, message);
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 3200);
  }

  updatePrefs(change: (p: ClientPrefs) => void): void {
    const next = structuredClone(this.prefs);
    change(next);
    this.prefs = next;
    this.transport.savePrefs(next);
    this.applyPrefs();
  }

  previewPack(packId: string | undefined, variantId?: string): void {
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.preview = packId ? { packId, variantId } : undefined;
      this.pushRenderState();
    }, 180);
  }

  capture(caption?: string): void {
    if (!this.renderer || !this.catalog) {
      this.toast('Capture needs WebGL.');
      return;
    }
    const j = this.snapshot?.journey;
    const pack = (j && this.pack(j.packId)) ?? this.catalog.packs[0];
    const source = this.renderer.capture();
    const project = this.prefs.captureIncludeProject && !this.snapshot?.privacy.streaming ? this.snapshot?.ide.project ?? this.host?.projectName : undefined;
    const canvas = composeCapture(source, pack, { caption: caption ?? captionFor(pack, this.snapshot), project, snapshot: this.snapshot });
    const fileName = `vibetour-${pack.id}-${new Date().toISOString().slice(0, 10)}.png`;
    if (this.host?.capabilities.saveFiles) {
      this.send({ type: 'saveCapture', dataUrl: canvas.toDataURL('image/png'), fileName });
    } else {
      downloadCanvas(canvas, fileName);
      this.toast('Workplace captured.');
    }
  }

  // ------------------------------------------------------------- messages

  private onMessage(m: HostMessage): void {
    switch (m.type) {
      case 'hello':
        this.host = m.host;
        this.catalog = m.catalog;
        if (m.prefs) {
          this.prefs = mergePrefs({ ...this.prefs, ...m.prefs, audio: { ...this.prefs.audio, ...(m.prefs.audio ?? {}) } });
          this.applyPrefs();
        }
        this.root.dataset.host = m.host.kind;
        this.onCatalog();
        break;
      case 'catalog':
        this.catalog = m.catalog;
        this.onCatalog();
        break;
      case 'snapshot':
        this.onSnapshot(m.snapshot);
        break;
      case 'setMode':
        this.updatePrefs((p) => (p.mode = m.mode));
        break;
      case 'show':
        if (m.view === 'capture') this.capture();
        else this.open(m.view);
        break;
      case 'toast':
        this.toast(m.text);
        break;
    }
  }

  private onCatalog(): void {
    if (this.overlay === 'picker') this.picker.render();
    if (this.overlay === 'passport') this.passport.render();
    // The opening experience is the destination board (PRD §83).
    if (!this.openedPicker && this.catalog) {
      this.openedPicker = true;
      const active = this.catalog.activeJourney;
      if (!active || active.phase === 'arrived' || active.phase === 'staying') this.open('picker');
    }
    this.pushRenderState();
  }

  private onSnapshot(snap: TourSnapshot): void {
    const prev = this.snapshot;
    this.snapshot = snap;
    if (snap.journey) this.lastPackId = snap.journey.packId;
    if (snap.announce) text(this.announcer, snap.announce);
    text(this.summary, this.describe(snap));
    this.cockpit.update(snap);
    this.arrival.update(snap);
    toggle(this.root, 'has-journey', !!snap.journey);
    toggle(this.root, 'stopped', snap.motion.stopped);
    if (!prev || prev.journey?.id !== snap.journey?.id || prev.journey?.scene.id !== snap.journey?.scene.id || prev.motion.behavior !== snap.motion.behavior || Math.abs((prev.journey?.progress ?? 0) - (snap.journey?.progress ?? 0)) > 0.002 || prev.motion.targetSpeed !== snap.motion.targetSpeed) {
      this.pushRenderState();
    }
  }

  private describe(snap: TourSnapshot): string {
    const j = snap.journey;
    const parts = [snap.motion.caption];
    if (j) parts.push(`${j.location.label}. Journey ${Math.round(j.progress * 100)} percent.`);
    parts.push(`Activity state ${snap.activity.state.toLowerCase().replace(/_/g, ' ')}.`);
    if (snap.ide.diagnostics.errors) parts.push(`${snap.ide.diagnostics.errors} errors.`);
    return parts.join(' ');
  }

  private renderState(): RenderState | undefined {
    const cat = this.catalog;
    if (!cat?.packs.length) return undefined;
    const j = this.snapshot?.journey;
    const previewing = this.preview && (this.overlay === 'picker' || !j);
    if (!j || previewing) {
      const pack =
        (this.preview ? this.pack(this.preview.packId) : undefined) ?? (this.lastPackId ? this.pack(this.lastPackId) : undefined) ?? cat.packs[0];
      const variant = findVariant(pack, this.preview?.variantId === 'local' ? undefined : this.preview?.variantId);
      const nodes = pack.sceneGraph.nodes;
      const nodeId = Object.keys(nodes).find((id) => nodes[id].kind === 'cruise') ?? pack.sceneGraph.start;
      return {
        pack,
        worldKey: `show:${pack.id}:${variant.id}`,
        seed: hashString(pack.id),
        timeOfDay: variant.timeOfDay,
        weather: variant.weather,
        skyTint: variant.skyTint,
        progress: 0.2,
        sceneKey: `show:${nodeId}`,
        env: resolveEnv(pack, nodes[nodeId]),
        behavior: 'cruise',
        targetSpeed: 0.55,
      };
    }
    const pack = this.pack(j.packId);
    if (!pack) return undefined;
    const variant = findVariant(pack, j.variantId);
    return {
      pack,
      worldKey: `${j.id}:${j.variantId}`,
      seed: hashString(j.id),
      timeOfDay: j.timeOfDay,
      arrivalTimeOfDay: j.arrivalTimeOfDay,
      weather: j.weather,
      skyTint: variant.skyTint,
      progress: j.progress,
      sceneKey: `${j.scene.id}:${j.scene.index}`,
      env: j.env,
      behavior: this.snapshot!.motion.behavior,
      targetSpeed: this.snapshot!.motion.targetSpeed,
    };
  }

  private pushRenderState(): void {
    const st = this.renderState();
    if (st && this.renderer) {
      this.renderer.setState(st);
      this.sound.setScene(st.pack, this.prefs.noWeather ? 'clear' : st.weather, st.timeOfDay === 'night' || st.timeOfDay === 'dusk' ? 1 : 0);
    }
  }

  // ----------------------------------------------------------------- prefs

  private applyPrefs(): void {
    const p = this.prefs;
    for (const m of MODES) toggle(this.root, `mode-${m}`, p.mode === m);
    toggle(this.root, 'high-contrast', p.highContrast);
    toggle(this.root, 'reduced-motion', p.reducedMotion);
    this.root.style.setProperty('--ui-scale', String(p.uiScale));
    for (const b of this.root.querySelectorAll<HTMLElement>('.mode-btn')) {
      const on = b.dataset.mode === p.mode;
      toggle(b, 'on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const soundBtn = this.root.querySelector('.sound-btn');
    if (soundBtn) {
      toggle(soundBtn, 'on', p.audio.enabled);
      soundBtn.setAttribute('aria-pressed', p.audio.enabled ? 'true' : 'false');
    }
    this.renderer?.setPrefs(p);
    this.renderer?.setMode(p.mode);
    this.sound.setPrefs(p.audio);
    if (this.snapshot) this.cockpit.update(this.snapshot);
  }

  private setSound(on: boolean): void {
    this.updatePrefs((p) => (p.audio.enabled = on));
    if (on) {
      this.sound.start(this.prefs.audio).catch(() => this.toast('Sound could not start in this browser.'));
      this.pushRenderState();
    } else this.sound.stop();
  }

  private tickSound(): void {
    const st = this.renderState();
    if (!this.renderer || !st) return;
    this.sound.update(this.snapshot, this.renderer.stats.speed, st.pack.cruiseSpeed, 0);
  }

  private syncOverlays(): void {
    toggle(this.picker.el, 'show', this.overlay === 'picker');
    toggle(this.passport.el, 'show', this.overlay === 'passport');
    toggle(this.settings.el, 'show', this.overlay === 'settings');
    toggle(this.root, 'overlay-open', !!this.overlay);
  }

  // ------------------------------------------------------------ keyboard

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      const actions: Record<string, () => void> = {
        t: () => this.setMode('tour'),
        d: () => this.setMode('dashboard'),
        w: () => this.setMode('work'),
        g: () => (this.overlay === 'picker' ? this.close() : this.open('picker')),
        p: () => (this.overlay === 'passport' ? this.close() : this.open('passport')),
        s: () => (this.overlay === 'settings' ? this.close() : this.open('settings')),
        c: () => this.capture(),
        m: () => this.setSound(!this.prefs.audio.enabled),
        a: () => this.snapshot?.journey && this.send({ type: 'completeObjective' }),
        '?': () => this.open('help'),
        escape: () => this.close(),
      };
      const run = actions[key];
      if (run) {
        e.preventDefault();
        run();
      }
    });
  }

  private bindIdle(): void {
    const wake = () => {
      this.root.classList.remove('idle');
      window.clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.root.classList.add('idle'), 4000);
    };
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'focusin']) window.addEventListener(ev, wake, { passive: true });
    wake();
  }

  private watchBattery(): void {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener(t: string, cb: () => void): void }> };
    nav
      .getBattery?.()
      .then((b) => {
        this.cockpit.battery = b;
      })
      .catch(() => undefined);
  }

  // ------------------------------------------------------------------ demo

  private demoPanel(): HTMLElement {
    const demo = this.transport.demo!;
    const button = (label: string, action: DemoAction) => h('button', { class: 'btn btn-sm', onclick: () => demo.trigger(action) }, label);
    const auto = h('input', { type: 'checkbox', checked: demo.isAutopilot, id: 'demo-auto' }) as HTMLInputElement;
    auto.addEventListener('change', () => demo.setAutopilot(auto.checked));
    const panel = h(
      'details',
      { class: 'demo-panel' },
      h('summary', {}, 'Demo controls'),
      h('p', { class: 'small muted' }, 'This is a simulated coding session. Install the VS Code extension to drive VibeTour with your real work.'),
      h('label', { class: 'demo-auto', for: 'demo-auto' }, auto, ' Autopilot story'),
      h(
        'div',
        { class: 'demo-buttons' },
        button('Type code', 'type'),
        button('Agent edits', 'agent'),
        button('Tests pass', 'tests-pass'),
        button('Tests fail', 'tests-fail'),
        button('Agent asks', 'ask'),
        button('Answer', 'answer'),
        button('Errors', 'errors'),
        button('Review', 'review'),
        button('Commit', 'commit'),
        button('Go idle', 'idle'),
      ),
    );
    return panel;
  }
}
