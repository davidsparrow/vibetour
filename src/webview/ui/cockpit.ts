import { APPROACH_CAP } from '../../core/journey';
import type { JourneyPack } from '../../core/packs';
import type { AgentSnapshot, TourSnapshot } from '../../core/protocol';
import type { AppContext } from './context';
import { clear, formatDuration, formatElapsed, h, renderKeyed, text, timeAgo, toggle } from './dom';
import { Gauge } from './gauges';
import { RouteMap } from './map';

/**
 * The cockpit as a spatial development interface (PRD §8): instruments,
 * mirrors, HUD, console and the Work Mode panels.
 */

const ROLE_LABEL: Record<AgentSnapshot['role'], string> = {
  copilot: 'CO-PILOT',
  nav: 'NAV',
  eng: 'ENG',
  qa: 'QA',
  comms: 'COMMS',
  ops: 'OPS',
  crew: 'CREW',
};

const STATUS_LABEL: Record<AgentSnapshot['status'], string> = {
  working: 'Working',
  tool: 'Using tools',
  waiting: 'Waiting for you',
  idle: 'Standing by',
  done: 'Finished',
  error: 'Needs help',
};

const STATE_LABEL: Record<string, string> = {
  IDLE: 'Idle',
  THINKING: 'Thinking',
  ACTIVE: 'Building',
  AGENT_ACTIVE: 'Agent at work',
  VERIFYING: 'Verifying',
  WAITING_FOR_USER: 'Waiting for you',
  WARNING: 'Heads-up',
  BLOCKED: 'Blocked',
  COMPLETE: 'Arrived',
};

type Tab = 'nav' | 'radio' | 'trip' | 'console';

function light(name: string, label: string): HTMLElement {
  return h('span', { class: `light light-${name}`, title: label, 'aria-label': label, role: 'img' }, h('i'), h('b', {}, label));
}

export class Cockpit {
  readonly root: HTMLElement;
  private readonly mirrorList = h('ul', { class: 'mirror-list' });
  private readonly hudLocation = h('div', { class: 'hud-location' });
  private readonly hudCaption = h('div', { class: 'hud-caption' });
  private readonly hudChips = h('div', { class: 'hud-chips' });
  private readonly stopCard = h('div', { class: 'stop-card', role: 'status' });
  private readonly sideLeft = h('div', { class: 'side-mirror left', 'aria-label': 'Side mirror: background agents' });
  private readonly sideRight = h('div', { class: 'side-mirror right', 'aria-label': 'Side mirror: background agents' });
  private readonly speedo = new Gauge({ label: 'Activity', tone: 'amber', ariaLabel: 'Speedometer: development activity' });
  private readonly tacho = new Gauge({ label: 'Agents & tools', tone: 'cyan', ariaLabel: 'Tachometer: agent and tool activity' });
  private readonly fuel = new Gauge({ label: 'Journey', size: 'small', tone: 'green', ends: ['E', 'F'], ticks: 5, ariaLabel: 'Fuel gauge' });
  private readonly temp = new Gauge({ label: 'Issues', size: 'small', tone: 'red', ends: ['C', 'H'], ticks: 5, ariaLabel: 'Temperature: warnings and errors' });
  private readonly lights = h(
    'div',
    { class: 'lights' },
    light('check', 'Check engine'),
    light('warn', 'Warnings'),
    light('hazard', 'Hazard'),
    light('agent', 'Agent waiting'),
    light('head', 'Headlights'),
  );
  private readonly gear = h('div', { class: 'gear', 'aria-label': 'Gear selector' }, ...['P', 'R', 'N', 'D'].map((g) => h('span', { 'data-gear': g }, g)));
  private readonly gearHint = h('div', { class: 'gear-hint' });
  private readonly tabs = new Map<Tab, HTMLElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly map = new RouteMap();
  private readonly navInfo = h('div', { class: 'nav-info' });
  private readonly radio = h('div', { class: 'radio' });
  private readonly trip = h('div', { class: 'trip' });
  private readonly console = h('div', { class: 'console' });
  private readonly strip = h('div', { class: 'tour-strip' });
  private readonly stripProgress = h('div', { class: 'strip-fill' });
  private readonly stripCar = h('div', { class: 'strip-car' });
  private readonly stripTicks = h('div', { class: 'strip-ticks' });
  private readonly stripTitle = h('div', { class: 'strip-title' });
  private readonly stripLoc = h('div', { class: 'strip-loc' });
  private readonly stripLights = h('div', { class: 'strip-lights' });
  private readonly arriveButton: HTMLButtonElement;
  private readonly work = h('div', { class: 'work', 'aria-label': 'Work mode panels' });
  private readonly workPanels: Record<string, HTMLElement> = {};
  private readonly workMap = new RouteMap(true);
  private stripPack = '';

  constructor(private readonly ctx: AppContext) {
    for (const t of ['nav', 'radio', 'trip', 'console'] as Tab[]) {
      const label = { nav: 'Nav', radio: 'Radio', trip: 'Trip', console: 'Console' }[t];
      const tabEl = h('button', { class: 'tab', role: 'tab', 'aria-selected': t === 'nav' ? 'true' : 'false', onclick: () => this.setTab(t) }, label);
      this.tabs.set(t, tabEl);
    }
    this.panes.set('nav', h('div', { class: 'pane pane-nav' }, this.map.el, this.navInfo));
    this.panes.set('radio', h('div', { class: 'pane' }, this.radio));
    this.panes.set('trip', h('div', { class: 'pane' }, this.trip));
    this.panes.set('console', h('div', { class: 'pane' }, this.console));

    this.arriveButton = h(
      'button',
      { class: 'btn btn-arrive', onclick: () => this.ctx.send({ type: 'completeObjective' }), title: 'Mark the objective complete and begin the final approach' },
      'Arrive — objective complete',
    );

    const screen = h(
      'div',
      { class: 'screen' },
      h('div', { class: 'tabs', role: 'tablist' }, ...this.tabs.values()),
      ...this.panes.values(),
    );
    const dash = h(
      'div',
      { class: 'dash' },
      h('div', { class: 'cluster cluster-left' }, this.speedo.el, this.tacho.el),
      screen,
      h(
        'div',
        { class: 'cluster cluster-right' },
        h('div', { class: 'mini-gauges' }, this.fuel.el, this.temp.el),
        this.lights,
        h('div', { class: 'gear-wrap' }, this.gear, this.gearHint),
        h('button', { class: 'glovebox', onclick: () => this.ctx.send({ type: 'openDocs' }), title: 'Glovebox: project docs (also in the command palette)' }, 'Glovebox'),
      ),
    );

    this.strip.append(
      h('div', { class: 'strip-text' }, this.stripTitle, this.stripLoc),
      h('div', { class: 'strip-track' }, this.stripTicks, this.stripProgress, this.stripCar),
      this.stripLights,
    );

    this.buildWork();

    this.root = h(
      'div',
      { class: 'cockpit' },
      h('div', { class: 'frame', 'aria-hidden': 'true' }, h('div', { class: 'roof' }), h('div', { class: 'pillar left' }), h('div', { class: 'pillar right' })),
      h('div', { class: 'mirror', 'aria-label': 'Rear-view mirror: recent activity' }, h('div', { class: 'mirror-glass' }, h('div', { class: 'mirror-title' }, 'Rear view'), this.mirrorList)),
      h('div', { class: 'hud', 'aria-hidden': 'true' }, this.hudLocation, this.hudCaption, this.hudChips),
      this.stopCard,
      this.sideLeft,
      this.sideRight,
      dash,
      this.strip,
      this.work,
    );
    this.setTab('nav');
  }

  private setTab(t: Tab): void {
    for (const [k, el] of this.tabs) el.setAttribute('aria-selected', k === t ? 'true' : 'false');
    for (const [k, el] of this.panes) toggle(el, 'active', k === t);
  }

  private buildWork(): void {
    const panel = (key: string, title: string) => {
      const body = h('div', { class: 'work-body' });
      this.workPanels[key] = body;
      return h('section', { class: `work-panel work-${key}`, 'aria-label': title }, h('h3', {}, title), body);
    };
    this.work.append(
      h(
        'header',
        { class: 'work-header' },
        h('div', {}, h('strong', {}, 'Work Mode'), h('span', {}, ' — the journey continues quietly in the background')),
        h('button', { class: 'btn', onclick: () => this.ctx.setMode('tour') }, 'Back to the view  (T)'),
      ),
      h(
        'div',
        { class: 'work-grid' },
        panel('explorer', 'Explorer'),
        panel('problems', 'Problems'),
        panel('agents', 'Agents'),
        panel('terminal', 'Terminal'),
        h('section', { class: 'work-panel work-journey', 'aria-label': 'Journey' }, h('h3', {}, 'Journey'), this.workMap.el, (this.workPanels.journey = h('div', { class: 'work-body' }))),
      ),
    );
  }

  update(snap: TourSnapshot): void {
    const j = snap.journey;
    const pack = j ? this.ctx.pack(j.packId) : undefined;
    const a = snap.activity;
    const now = snap.at;

    // Rear-view mirror: recent activity / Git timeline.
    clear(this.mirrorList);
    for (const item of snap.ide.history.slice(0, 4)) {
      this.mirrorList.append(h('li', { class: `tone-${item.tone}` }, h('span', {}, item.label), h('time', {}, timeAgo(item.at, now))));
    }
    if (!snap.ide.history.length) this.mirrorList.append(h('li', { class: 'empty' }, 'Open road behind you'));

    // HUD: where we are, what is happening, current file and task.
    text(this.hudLocation, j ? j.location.label : 'Where do you want to go today?');
    text(this.hudCaption, snap.motion.caption);
    clear(this.hudChips);
    if (snap.ide.activeFile) this.hudChips.append(h('span', { class: 'chip chip-file' }, snap.ide.activeFile.name));
    if (j?.objective) this.hudChips.append(h('span', { class: 'chip chip-task' }, j.objective));
    const running = snap.ide.processes.find((p) => p.kind === 'test' || p.kind === 'build' || p.kind === 'lint');
    if (running) this.hudChips.append(h('span', { class: 'chip chip-verify' }, `${running.label} · running`));

    this.updateStopCard(snap, pack);
    this.updateSideMirrors(snap.ide.agents);

    // Instruments.
    this.speedo.set(a.devActivity, String(Math.round(a.devActivity * 100)), `${Math.round(a.devActivity * 100)} percent — ${STATE_LABEL[a.state]}`);
    const rpm = a.agentActivity * 8;
    this.tacho.set(a.agentActivity, rpm.toFixed(1), `${Math.round(a.agentActivity * 100)} percent agent and tool activity`);
    this.updateFuel(snap);
    const issues = snap.ide.diagnostics.errors;
    this.temp.set(a.errorIntensity, String(issues), `${issues} errors, ${snap.ide.diagnostics.warnings} warnings`);
    const setLight = (name: string, on: boolean, title?: string) => {
      const el = this.lights.querySelector(`.light-${name}`)!;
      toggle(el, 'on', on);
      if (title) el.setAttribute('title', title);
    };
    setLight('check', a.checkEngine.on, a.checkEngine.reason ?? 'Check engine: build/test failures');
    setLight('warn', snap.ide.diagnostics.errors + snap.ide.diagnostics.warnings > 0, `${snap.ide.diagnostics.errors} errors, ${snap.ide.diagnostics.warnings} warnings`);
    setLight('hazard', snap.motion.hazard);
    setLight('agent', a.state === 'WAITING_FOR_USER', a.waitingAgent ? `${a.waitingAgent} is waiting for you` : 'Agent waiting');
    setLight('head', !!j && (j.timeOfDay === 'night' || j.timeOfDay === 'dusk' || j.weather === 'rain' || j.weather === 'fog'));
    for (const el of this.gear.children) toggle(el, 'on', (el as HTMLElement).dataset.gear === a.gear);
    text(this.gearHint, { P: 'Paused', R: 'Review', N: 'Thinking', D: 'Build / edit' }[a.gear]);

    this.updateNav(snap, pack);
    this.updateRadio(snap);
    this.updateTrip(snap);
    this.updateConsole(snap);
    this.updateStrip(snap, pack);
    this.updateWork(snap, pack);
  }

  private updateFuel(snap: TourSnapshot): void {
    const mode = this.ctx.prefs.fuel;
    const j = snap.journey;
    if (mode === 'context' && snap.activity.context !== null) {
      const left = 1 - snap.activity.context;
      this.fuel.setLabel('Context');
      this.fuel.set(left, `${Math.round(left * 100)}%`, `${Math.round(left * 100)} percent of the agent context window left`);
      return;
    }
    if (mode === 'battery' && this.battery) {
      this.fuel.setLabel('Battery');
      this.fuel.set(this.battery.level, `${Math.round(this.battery.level * 100)}%`, `Battery ${Math.round(this.battery.level * 100)} percent`);
      return;
    }
    this.fuel.setLabel('Journey');
    const remaining = j ? (j.scope === 'free-drive' ? 1 : 1 - j.progress) : 1;
    this.fuel.set(remaining, j && j.scope !== 'free-drive' ? `${Math.round(j.progress * 100)}%` : '∞', `Journey ${j ? Math.round(j.progress * 100) : 0} percent complete`);
  }

  battery?: { level: number };

  private updateStopCard(snap: TourSnapshot, pack?: JourneyPack): void {
    const m = snap.motion;
    const j = snap.journey;
    const show = !!j && (m.stopped || j.phase === 'parked') && m.behavior !== 'arrived';
    toggle(this.stopCard, 'show', show);
    if (!show) return;
    const parked = j!.phase === 'parked';
    let title = '';
    let line = '';
    if (parked) {
      title = 'Parked';
      line = `Your journey to ${pack?.route.to ?? 'your destination'} is saved. Pick it up whenever you like.`;
    } else if (m.behavior === 'pull-over') {
      title = 'Pulled over safely';
      line = snap.activity.blockedReason ?? 'Something needs your attention.';
    } else if (m.stopReason === 'waiting') {
      title = `Scenic stop · ${m.stopName ?? ''}`;
      line = `${snap.activity.waitingAgent ?? 'Your agent'} is waiting for you. The journey resumes when you reply.`;
    } else {
      title = `Scenic stop · ${m.stopName ?? ''}`;
      line = 'Taking a breather. Start working again to continue the drive.';
    }
    renderKeyed(this.stopCard, `${title}\n${line}`, () => {
      this.stopCard.append(h('div', { class: 'stop-title' }, title), h('div', { class: 'stop-line' }, line));
      if (parked) this.stopCard.append(h('button', { class: 'btn btn-primary', onclick: () => this.ctx.send({ type: 'resume' }) }, 'Resume journey'));
    });
  }

  private updateSideMirrors(agents: AgentSnapshot[]): void {
    const crew = agents.filter((ag) => ag.parentId || agents.length > 1).filter((ag) => ag.parentId || ag !== agents[0]);
    const render = (el: HTMLElement, list: AgentSnapshot[]) => {
      clear(el);
      toggle(el, 'show', list.length > 0);
      for (const ag of list) {
        el.append(
          h(
            'div',
            { class: `crew status-${ag.status}`, title: `${ag.name}: ${STATUS_LABEL[ag.status]}${ag.detail ? ` — ${ag.detail}` : ''}` },
            h('span', { class: 'crew-role' }, ROLE_LABEL[ag.role] ?? ag.role.toUpperCase()),
            h('span', { class: 'crew-name' }, ag.name),
            h('i', { class: 'dot' }),
          ),
        );
      }
    };
    render(this.sideLeft, crew.filter((_, i) => i % 2 === 0).slice(0, 3));
    render(this.sideRight, crew.filter((_, i) => i % 2 === 1).slice(0, 3));
  }

  private updateNav(snap: TourSnapshot, pack?: JourneyPack): void {
    const j = snap.journey;
    if (!j || !pack) {
      renderKeyed(this.navInfo, 'none', () =>
        this.navInfo.append(h('p', { class: 'muted' }, 'No journey yet.'), h('button', { class: 'btn btn-primary', onclick: () => this.ctx.open('picker') }, 'Choose a destination')),
      );
      return;
    }
    this.map.update(pack, j.scope === 'free-drive' ? (j.travelMs / 3_600_000) % 1 : j.progress, `${pack.route.from} → ${pack.route.to}`);
    const capped = j.progress >= APPROACH_CAP - 0.001 && j.phase === 'extended';
    const canArrive = j.phase !== 'arrived' && j.phase !== 'staying' && j.phase !== 'final-approach' && j.phase !== 'parked';
    const percent = j.scope === 'free-drive' ? -1 : Math.round(j.progress * 100);
    const key = [pack.id, j.location.label, j.scene.label, j.scopeLabel, percent, j.objective ?? '', capped, canArrive].join('\n');
    renderKeyed(this.navInfo, key, () => this.renderNav(j, pack, capped, canArrive));
  }

  private renderNav(j: NonNullable<TourSnapshot['journey']>, pack: JourneyPack, capped: boolean, canArrive: boolean): void {
    this.navInfo.append(
      h('div', { class: 'nav-route' }, h('strong', {}, pack.title), h('span', {}, ` · ${pack.route.name}`)),
      h('div', { class: 'nav-loc' }, `${j.location.label} · ${j.scene.label}`),
      h(
        'div',
        { class: 'nav-meta' },
        h('span', {}, j.scopeLabel),
        j.scope === 'free-drive' ? h('span', {}, 'No destination') : h('span', {}, `${Math.round(j.progress * 100)}% of the way`),
      ),
      h('div', { class: `nav-objective${j.objective ? '' : ' muted'}` }, h('span', {}, 'Objective'), j.objective ?? 'None set — arrive whenever the work is done'),
    );
    if (canArrive) {
      if (capped) this.navInfo.append(h('p', { class: 'nav-hint' }, 'Final approach is waiting on you: arrive when the work is truly done.'));
      this.navInfo.append(this.arriveButton);
    }
  }

  private updateRadio(snap: TourSnapshot): void {
    clear(this.radio);
    const agents = snap.ide.agents;
    if (!agents.length) {
      this.radio.append(
        h('p', { class: 'muted' }, 'No agents on the air.'),
        h('p', { class: 'small muted' }, 'Connect Claude Code or another agent with hooks to see your co-pilot here.'),
      );
      return;
    }
    for (const ag of agents) {
      this.radio.append(
        h(
          'div',
          { class: `station status-${ag.status}` },
          h('span', { class: 'station-role' }, ROLE_LABEL[ag.role] ?? ag.role),
          h('div', { class: 'station-body' }, h('strong', {}, ag.name), h('span', {}, ag.detail ?? STATUS_LABEL[ag.status])),
          h('span', { class: 'station-status' }, STATUS_LABEL[ag.status]),
        ),
      );
    }
  }

  private updateTrip(snap: TourSnapshot): void {
    clear(this.trip);
    const j = snap.journey;
    const st = j?.stats;
    const row = (k: string, v: string) => h('div', { class: 'trip-row' }, h('span', {}, k), h('strong', {}, v));
    this.trip.append(
      row('Coding time', j ? formatDuration(j.productiveMs) : '—'),
      row('Time on the road', j ? formatDuration(j.travelMs) : '—'),
      row('Sessions', j ? String(j.sessions) : '—'),
      row('Files touched', String(st?.filesChanged ?? snap.ide.session.filesChanged)),
      row('Test runs passed', String(st?.testPasses ?? snap.ide.session.testPasses)),
      row('Commits', String(st?.commits ?? snap.ide.session.commits)),
      row('Agent time', j ? formatDuration(j.stats.agentMs) : '—'),
    );
  }

  private updateConsole(snap: TourSnapshot): void {
    clear(this.console);
    const procs = snap.ide.processes;
    if (procs.length) {
      for (const p of procs) {
        this.console.append(h('div', { class: 'proc running' }, h('i', { class: 'spinner' }), h('span', {}, p.label), h('time', {}, formatElapsed(snap.at - p.startedAt))));
      }
    }
    for (const key of ['test', 'build', 'lint'] as const) {
      const r = snap.ide.results[key];
      if (r) this.console.append(h('div', { class: `proc ${r.ok ? 'ok' : 'fail'}` }, h('i', {}, r.ok ? '✓' : '✕'), h('span', {}, `${r.label}`), h('time', {}, timeAgo(r.at, snap.at))));
    }
    if (!this.console.childElementCount) this.console.append(h('p', { class: 'muted' }, 'Terminal is quiet.'));
  }

  private updateStrip(snap: TourSnapshot, pack?: JourneyPack): void {
    const j = snap.journey;
    toggle(this.strip, 'empty', !j);
    if (!j || !pack) {
      text(this.stripTitle, 'VibeTour');
      text(this.stripLoc, 'See the world while you code.');
      return;
    }
    if (this.stripPack !== pack.id) {
      this.stripPack = pack.id;
      clear(this.stripTicks);
      for (const w of pack.route.waypoints) this.stripTicks.append(h('i', { style: `left:${w.at * 100}%`, title: w.name }));
    }
    text(this.stripTitle, `${pack.route.from} → ${pack.route.to}`);
    text(this.stripLoc, snap.motion.caption === j.location.label ? j.location.label : `${j.location.label} · ${snap.motion.caption}`);
    const p = j.scope === 'free-drive' ? (j.travelMs / 3_600_000) % 1 : j.progress;
    this.stripProgress.style.width = `${(p * 100).toFixed(2)}%`;
    this.stripCar.style.left = `${(p * 100).toFixed(2)}%`;
    clear(this.stripLights);
    const d = snap.ide.diagnostics;
    const ind = (cls: string, label: string, title: string) => h('span', { class: `ind ${cls}`, title }, label);
    if (snap.ide.processes.some((pr) => pr.kind === 'test' || pr.kind === 'build')) this.stripLights.append(ind('verify', 'Verifying', 'Tests or build running'));
    if (snap.activity.checkEngine.on) this.stripLights.append(ind('bad', '⚠', snap.activity.checkEngine.reason ?? 'Check engine'));
    if (d.errors) this.stripLights.append(ind('bad', `${d.errors} errors`, 'Diagnostics'));
    const working = snap.ide.agents.filter((ag) => ag.status === 'working' || ag.status === 'tool').length;
    if (working) this.stripLights.append(ind('agent', `${working} agent${working > 1 ? 's' : ''}`, 'Agents working'));
    this.stripLights.append(ind('gear', snap.activity.gear, 'Gear'));
  }

  private updateWork(snap: TourSnapshot, pack?: JourneyPack): void {
    if (!this.root.closest('.mode-work')) return;
    const caps = this.ctx.host?.capabilities;
    const ex = this.workPanels.explorer;
    clear(ex);
    const f = snap.ide.activeFile;
    ex.append(h('div', { class: 'kv' }, h('span', {}, 'Active file'), h('strong', {}, f ? f.path ?? f.name : '—')));
    const g = snap.ide.git;
    if (g) {
      ex.append(
        h('div', { class: 'kv' }, h('span', {}, 'Branch'), h('strong', {}, g.branch ?? 'hidden')),
        h('div', { class: 'kv' }, h('span', {}, 'Changes'), h('strong', {}, `${g.changes} changed · ${g.staged} staged`)),
        h('div', { class: 'kv' }, h('span', {}, 'Sync'), h('strong', {}, `↑${g.ahead} ↓${g.behind}`)),
      );
      if (g.lastCommit) ex.append(h('div', { class: 'kv' }, h('span', {}, 'Last commit'), h('strong', {}, `${g.lastCommit.message ?? 'Committed'} · ${timeAgo(g.lastCommit.at, snap.at)}`)));
    }
    ex.append(h('div', { class: 'kv' }, h('span', {}, 'Files touched this session'), h('strong', {}, String(snap.ide.session.filesChanged))));

    const pr = this.workPanels.problems;
    const d = snap.ide.diagnostics;
    const openable = !!caps?.openFiles;
    renderKeyed(pr, JSON.stringify([d.errors, d.warnings, d.top, openable]), () => {
      pr.append(h('div', { class: 'kv' }, h('span', {}, 'Errors / warnings'), h('strong', {}, `${d.errors} / ${d.warnings}`)));
      for (const item of d.top) {
        const row = h(
          openable && item.path ? 'button' : 'div',
          { class: `problem ${item.severity}`, title: item.path ? `${item.path}:${item.line}` : '' },
          h('i', {}, item.severity === 'error' ? '✕' : '!'),
          h('span', {}, item.message),
          h('em', {}, `${item.file}:${item.line}`),
        );
        if (openable && item.path) row.addEventListener('click', () => this.ctx.send({ type: 'openFile', path: item.path!, line: item.line }));
        pr.append(row);
      }
      if (!d.top.length) pr.append(h('p', { class: 'muted' }, d.errors + d.warnings ? 'Details hidden.' : 'No problems. Clear skies.'));
    });

    const ag = this.workPanels.agents;
    clear(ag);
    if (!snap.ide.agents.length) ag.append(h('p', { class: 'muted' }, 'No agents connected.'));
    for (const a of snap.ide.agents) {
      ag.append(h('div', { class: `station status-${a.status}` }, h('span', { class: 'station-role' }, ROLE_LABEL[a.role]), h('div', { class: 'station-body' }, h('strong', {}, a.name), h('span', {}, a.detail ?? STATUS_LABEL[a.status]))));
    }

    const term = this.workPanels.terminal;
    clear(term);
    term.append(this.console.cloneNode(true));
    for (const item of snap.ide.history.slice(0, 8)) term.append(h('div', { class: `hist tone-${item.tone}` }, h('span', {}, item.label), h('time', {}, timeAgo(item.at, snap.at))));

    const jp = this.workPanels.journey;
    clear(jp);
    const j = snap.journey;
    if (j && pack) {
      this.workMap.update(pack, j.progress, `${pack.route.from} → ${pack.route.to}`);
      jp.append(h('div', { class: 'kv' }, h('span', {}, j.location.label), h('strong', {}, snap.motion.caption)));
    } else {
      jp.append(h('p', { class: 'muted' }, 'No journey in progress.'));
    }
  }
}
