import { loudest, waitingFor } from '../../core/attention';
import { APPROACH_CAP } from '../../core/journey';
import type { JourneyPack } from '../../core/packs';
import type { PullRequestSnapshot, TourSnapshot } from '../../core/protocol';
import type { CacheSnapshot } from '../../core/workspace';
import { ROLE_LABEL, STATUS_LABEL } from './agents';
import { alertPill, AlertsPane, bell, lightBell, litBells, notePill, orderedPullRequests } from './alerts';
import type { AppContext } from './context';
import { clear, formatDuration, formatElapsed, h, renderKeyed, text, timeAgo, toggle } from './dom';
import { Gauge, RED_ZONE_FROM } from './gauges';
import { batteryIcon, branchIcon, gloveboxArt } from './icons';
import { RouteMap } from './map';
import type { RadioDeck } from './radioDeck';

/**
 * The cockpit as a spatial development interface (PRD §8): instruments,
 * mirrors, HUD, console and the Work Mode panels.
 */

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

export type Tab = 'nav' | 'radio' | 'prs' | 'trip' | 'console' | 'alerts';
const TABS: Tab[] = ['nav', 'radio', 'prs', 'trip', 'console', 'alerts'];
const TAB_LABEL: Record<Tab, string> = { nav: 'Nav', radio: 'Radio', prs: 'PRs', trip: 'Trip', console: 'Console', alerts: 'Alerts' };

export class Cockpit {
  readonly root: HTMLElement;
  /** What just happened, newest first: in the Console tab now the rear-view mirror is gone. */
  private readonly recent = h('ul', { class: 'recent-list', 'aria-label': 'Recent' });
  /** Why the car stopped, as one pill: the alert that stopped it, and what resumes the drive. */
  private readonly stopCard = h('div', { class: 'stop-card', role: 'status' });
  /** The Alerts icon on the rear-view mirror's top-right corner: lit by the loudest alert, opens the Alerts tab. */
  private readonly topBell = h('button', { class: 'alert-bell' }, bell());
  private readonly alertsPane: AlertsPane;
  /** Your coding. Like a speedometer, it reads zero while the car is stopped. */
  private readonly speedo = new Gauge({ label: 'Activity', tone: 'amber', zone: 'high', ariaLabel: 'Speedometer: development activity' });
  /** How many agents are at work: the main agent and its crew. Red from six at once. */
  private readonly agentsGauge = new Gauge({ label: 'Agents', tone: 'cyan', ticks: AGENTS_FULL + 1, zone: 'high', ariaLabel: 'Agents at work' });
  /** Tool calls and commands in the last minute. No red zone: a busy agent is no fault. */
  private readonly toolsGauge = new Gauge({ label: 'Tools', tone: 'violet', ticks: 7, ariaLabel: 'Tool calls in the last minute' });
  /** The left dials' readings the last time the car moved; they become pins when it stops. */
  private lastMoving: { activity: number; agents: number; tools: number } | null = null;
  private stopPins: { activity: number; agents: number; tools: number } | null = null;
  /** How far along the journey is: empty at the start, full on arrival. */
  private readonly fuel = new Gauge({ label: 'Journey', size: 'small', tone: 'green', ticks: 5, ariaLabel: 'Journey progress' });
  private readonly contextGauge = new Gauge({ label: 'Context', size: 'small', tone: 'cyan', ends: ['E', 'F'], ticks: 5, zone: 'low', ariaLabel: 'Agent context window left' });
  /** Under Context, beside the gear: the prompt cache's hit share and the time until it goes cold. */
  private readonly cacheHit = h('div', { class: 'cache-dot', role: 'img' });
  private readonly cacheTimer = h('div', { class: 'cache-dot', role: 'img' });
  private readonly cacheDots = h('div', { class: 'cache-dots' }, this.cacheHit, this.cacheTimer);
  /** This computer's battery: five lights in a stack, a battery for their label. */
  private readonly batteryLeds = h('div', { class: 'battery-leds', 'aria-hidden': 'true' }, ...Array.from({ length: BATTERY_LEDS }, () => h('span', {})));
  private readonly battery = h(
    'div',
    { class: 'battery-meter', role: 'meter', 'aria-label': 'Battery', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    this.batteryLeds,
    h('div', { class: 'gauge-label' }, batteryIcon()),
  );
  private readonly temp = new Gauge({ label: 'Issues', size: 'small', tone: 'red', ends: ['C', 'H'], ticks: 5, zone: 'high', ariaLabel: 'Temperature: warnings and errors' });
  /** Files changed and not committed, like the editor's Source Control badge; clicking opens it. */
  private readonly changesGauge = new Gauge({ label: 'Changes', size: 'small', tone: 'blue', ticks: 5, needle: false, zone: 'high', ariaLabel: 'Uncommitted changes' });
  private readonly changesButton = h('button', { class: 'gauge-btn', onclick: () => this.openSourceControl() }, this.changesGauge.el);
  private readonly gear = h('div', { class: 'gear', 'aria-label': 'Gear selector' }, ...['P', 'R', 'N', 'D'].map((g) => h('span', { 'data-gear': g }, g)));
  private readonly gearHint = h('div', { class: 'gear-hint' });
  /** The dials in a row, the battery's lights at its end; under them the cache's dots (under Context), then the gear. */
  private readonly instruments = h(
    'div',
    { class: 'instruments' },
    this.contextGauge.el,
    this.temp.el,
    this.changesButton,
    this.fuel.el,
    this.battery,
    this.cacheDots,
    h('div', { class: 'gear-wrap' }, this.gear, this.gearHint),
  );
  /** The glovebox: its handle opens the project's docs. The browser demo hangs its Demo pill here. */
  private readonly glovebox = h(
    'div',
    { class: 'glovebox-wrap' },
    h(
      'button',
      { class: 'glovebox', 'aria-label': 'Glovebox: project docs', title: 'Glovebox: project docs (also in the command palette)', onclick: () => this.ctx.send({ type: 'openDocs' }) },
      gloveboxArt(),
      h('span', { class: 'glovebox-label', 'aria-hidden': 'true' }, 'glovebox'),
    ),
  );
  private readonly tabs = new Map<Tab, HTMLElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly map = new RouteMap();
  private readonly navInfo = h('div', { class: 'nav-info' });
  private readonly radio = h('div', { class: 'radio' });
  private readonly prs = h('div', { class: 'prs' });
  private readonly prsBadge = h('span', { class: 'tab-badge' });
  private readonly trip = h('div', { class: 'trip' });
  private readonly console = h('div', { class: 'console' });
  private readonly arriveButton: HTMLButtonElement;
  private readonly work = h('div', { class: 'work', 'aria-label': 'Work mode panels' });
  private readonly workPanels: Record<string, HTMLElement> = {};
  private readonly workMap = new RouteMap(true);
  private tab: Tab = 'nav';
  /** The car is stopped and the stop pill is up: Tour mode brings the dashboard up too. */
  private stopShown = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly deck: RadioDeck,
  ) {
    this.alertsPane = new AlertsPane(ctx);
    this.topBell.addEventListener('click', () => this.showAlerts());
    for (const t of TABS) {
      // Alerts is a bell, lit by the loudest alert; the other tabs are words.
      const content = t === 'alerts' ? [bell()] : [TAB_LABEL[t], t === 'prs' ? this.prsBadge : null];
      const tabEl = h('button', { class: `tab tab-${t}`, role: 'tab', 'aria-selected': t === 'nav' ? 'true' : 'false', onclick: () => this.setTab(t) }, ...content);
      this.tabs.set(t, tabEl);
    }
    this.panes.set('nav', h('div', { class: 'pane pane-nav' }, this.map.el, this.navInfo));
    this.radio.append(deck.el);
    this.panes.set('radio', h('div', { class: 'pane pane-radio' }, this.radio));
    this.panes.set('prs', h('div', { class: 'pane' }, this.prs));
    this.panes.set('trip', h('div', { class: 'pane' }, this.trip));
    this.panes.set('console', h('div', { class: 'pane' }, this.console, h('h4', { class: 'recent-title' }, 'Recent'), this.recent));
    this.panes.set('alerts', h('div', { class: 'pane pane-alerts' }, this.alertsPane.el));

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
      h('div', { class: 'cluster cluster-left' }, this.speedo.el, this.agentsGauge.el, this.toolsGauge.el),
      screen,
      h(
        'div',
        { class: 'cluster cluster-right' },
        this.instruments,
        this.glovebox,
      ),
    );

    this.buildWork();

    this.root = h(
      'div',
      { class: 'cockpit' },
      h('div', { class: 'frame', 'aria-hidden': 'true' }, h('div', { class: 'roof' }), h('div', { class: 'pillar left' }), h('div', { class: 'pillar right' })),
      // The rear-view mirror is just a mirror now; its only display is the Alerts bell on its corner.
      h('div', { class: 'mirror-wrap' }, h('div', { class: 'mirror', 'aria-hidden': 'true' }, h('div', { class: 'mirror-glass' })), this.topBell),
      // Nothing sits on the windshield's lower edge, in any mode: places are named on signs outside and on the Nav screen.
      this.stopCard,
      dash,
      this.work,
    );
    this.setTab('nav');
  }

  /** The browser demo's Demo pill, on the glovebox's lower-left corner. */
  addDemoButton(el: HTMLElement): void {
    this.glovebox.append(el);
  }

  showTab(t: Tab): void {
    this.setTab(t);
  }

  /** The top bell: bring up the dash, open on Alerts. */
  private showAlerts(): void {
    if (this.ctx.prefs.mode !== 'dashboard') this.ctx.setMode('dashboard');
    this.setTab('alerts');
  }

  private setTab(t: Tab): void {
    this.tab = t;
    for (const [k, el] of this.tabs) el.setAttribute('aria-selected', k === t ? 'true' : 'false');
    for (const [k, el] of this.panes) toggle(el, 'active', k === t);
    this.syncRadio();
  }

  /** The radio runs its lights and follows song titles only while its pane is on screen. */
  syncRadio(): void {
    const mode = this.ctx.prefs.mode;
    const dashUp = mode === 'dashboard' || (mode === 'tour' && this.stopShown);
    this.deck.setVisible(this.tab === 'radio' && dashUp);
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

    // Recent activity / Git timeline, in the Console tab.
    clear(this.recent);
    for (const item of snap.ide.history.slice(0, 8)) {
      this.recent.append(h('li', { class: `tone-${item.tone}` }, h('span', {}, item.label), h('time', {}, timeAgo(item.at, now))));
    }
    if (!snap.ide.history.length) this.recent.append(h('li', { class: 'empty' }, 'Open road behind you'));

    this.updateAlerts(snap);
    this.updateStopCard(snap, pack);

    // Instruments.
    this.updateLeftDials(snap);
    this.updateFuel(snap);
    this.updateContextGauge(snap);
    this.updateBattery();
    this.updateChangesGauge(snap);
    this.layoutInstruments();
    const issues = snap.ide.diagnostics.errors;
    this.temp.set(issuesDial(a.errorIntensity), String(issues), `${issues} errors, ${snap.ide.diagnostics.warnings} warnings`);
    for (const el of this.gear.children) toggle(el, 'on', (el as HTMLElement).dataset.gear === a.gear);
    text(this.gearHint, { P: 'Paused', R: 'Review', N: 'Thinking', D: 'Build' }[a.gear]);

    this.updateNav(snap, pack);
    this.deck.updateAgents(snap.ide.agents);
    this.deck.setPack(j?.packId);
    this.updatePullRequests(snap);
    this.updateTrip(snap);
    this.updateConsole(snap);
    this.updateWork(snap, pack);
  }

  /**
   * Activity, Agents and Tools. Activity is the car's speedometer, so it reads zero while the
   * car is stopped; Agents and Tools keep reading what runs. When the car stops, each dial
   * leaves a pin where it stood, until the drive resumes.
   */
  private updateLeftDials(snap: TourSnapshot): void {
    const a = snap.activity;
    const stopped = !!snap.journey && (snap.motion.stopped || snap.journey.phase === 'parked');
    const live = { activity: a.devActivity, agents: agentsDial(a.agentsWorking), tools: toolsDial(a.toolCalls) };
    if (stopped) this.stopPins ??= this.lastMoving;
    else {
      this.stopPins = null;
      this.lastMoving = live;
    }
    const pins = this.stopPins;
    if (stopped) this.speedo.set(0, '0', pins && pins.activity > 0.02 ? `Stopped. It read ${Math.round(pins.activity * 100)} before the stop` : 'Stopped');
    else this.speedo.set(a.devActivity, String(Math.round(a.devActivity * 100)), `${Math.round(a.devActivity * 100)} percent — ${STATE_LABEL[a.state]}`);
    const n = a.agentsWorking;
    this.agentsGauge.set(live.agents, String(n), `${n} agent${n === 1 ? '' : 's'} at work`);
    this.toolsGauge.set(live.tools, String(a.toolCalls), `${a.toolCalls} tool call${a.toolCalls === 1 ? '' : 's'} and commands in the last minute`);
    this.speedo.pin(pins?.activity ?? null);
    this.agentsGauge.pin(pins?.agents ?? null);
    this.toolsGauge.pin(pins?.tools ?? null);
  }

  /** Journey fills as you go: empty on the left at the start, full on the right on arrival. A free drive has no end: ∞. */
  private updateFuel(snap: TourSnapshot): void {
    const j = snap.journey;
    const done = j && j.scope !== 'free-drive' ? j.progress : 0;
    const pct = Math.round(done * 100);
    this.fuel.set(done, j && j.scope !== 'free-drive' ? `${pct}%` : '∞', j?.scope === 'free-drive' ? 'Free drive: no destination' : `Journey ${pct} percent complete`);
  }

  /** One column per instrument showing; the gear starts under Issues, or under the first dial when Context is off. */
  private layoutInstruments(): void {
    const row = [this.contextGauge.el, this.temp.el, this.changesButton, this.fuel.el, this.battery].filter((el) => !el.hidden);
    this.instruments.style.setProperty('--cols', String(Math.max(1, row.length)));
    this.instruments.dataset.count = String(row.filter((el) => el !== this.battery).length);
    toggle(this.instruments, 'no-context', this.contextGauge.el.hidden);
  }

  private updateContextGauge(snap: TourSnapshot): void {
    this.contextGauge.el.hidden = !this.ctx.prefs.contextGauge;
    this.updateCacheDots(snap);
    const used = snap.activity.context;
    if (used === null) return this.contextGauge.setUnknown('No agent has reported its context window yet');
    const left = Math.round((1 - used) * 100);
    this.contextGauge.set(1 - used, `${left}%`, `${left} percent of the agent context window left`);
  }

  private updateCacheDots(snap: TourSnapshot): void {
    const p = this.ctx.prefs;
    const dots = cacheDots(snap.activity.cache, snap.at, { hitPct: p.cacheHitWarn, minutes: p.cacheTimerWarn });
    this.cacheDots.hidden = !p.contextGauge || (!dots.hit && !dots.timer);
    for (const [el, dot] of [
      [this.cacheHit, dots.hit],
      [this.cacheTimer, dots.timer],
    ] as const) {
      el.hidden = !dot;
      if (!dot) continue;
      text(el, dot.text);
      el.dataset.level = dot.level;
      if (el.title !== dot.label) {
        el.title = dot.label;
        el.setAttribute('aria-label', dot.label);
      }
    }
  }

  private updateBattery(): void {
    const b = this.ctx.battery;
    this.battery.hidden = !this.ctx.prefs.batteryGauge || b.kind !== 'battery';
    if (b.kind !== 'battery') return;
    const lit = batteryLit(b.level);
    [...this.batteryLeds.children].forEach((led, i) => {
      toggle(led, 'on', i < lit);
      // Charging: the top light that's on pulses.
      toggle(led, 'pulse', b.charging && i === lit - 1);
    });
    this.battery.dataset.level = b.level <= 0.1 ? 'critical' : b.level <= 0.25 ? 'low' : 'ok';
    const pct = Math.round(b.level * 100);
    const said = `Battery ${pct} percent${b.charging ? ', charging' : ''}`;
    this.battery.setAttribute('aria-valuenow', String(pct));
    this.battery.setAttribute('aria-valuetext', said);
    this.battery.title = said;
  }

  private updateChangesGauge(snap: TourSnapshot): void {
    const g = snap.ide.git;
    this.changesButton.hidden = !this.ctx.prefs.changesGauge || !g;
    if (!g) return;
    const files = g.changes + g.staged;
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const said = [
      files ? `${plural(files, 'file', 'files')} changed, not committed` : 'Nothing to commit',
      g.staged ? `${g.staged} staged` : '',
      g.ahead ? `${plural(g.ahead, 'commit', 'commits')} to push` : '',
    ]
      .filter(Boolean)
      .join(', ');
    // The number is the count; the ring reaches its red zone past twenty files.
    this.changesGauge.set(changesDial(files), String(files), said);
    this.changesGauge.setNote(g.ahead ? `↑${g.ahead}` : '');
    toggle(this.changesGauge.el, 'gauge-lit', files > 0);
    const canOpen = !!this.ctx.host?.capabilities.openScm;
    this.changesButton.disabled = !canOpen;
    this.changesButton.title = canOpen ? `${said}. Open Source Control` : said;
    this.changesButton.setAttribute('aria-label', this.changesButton.title);
  }

  private openSourceControl(): void {
    if (this.ctx.host?.capabilities.openScm) this.ctx.send({ type: 'openSourceControl' });
  }

  private updatePullRequests(snap: TourSnapshot): void {
    const feed = snap.ide.pullRequests;
    const caps = this.ctx.host?.capabilities;
    const needYou = snap.attention.filter((a) => a.kind === 'pr').length;
    text(this.prsBadge, feed.items.length ? String(feed.items.length) : '');
    toggle(this.prsBadge, 'hot', needYou > 0);
    const minutes = Math.floor(snap.at / 60_000);
    const key = JSON.stringify([feed.state, feed.items, !!caps?.openLinks, !!caps?.connectGitHub, this.ctx.host?.kind, minutes]);
    renderKeyed(this.prs, key, () => this.renderPullRequests(snap, feed.items));
  }

  private renderPullRequests(snap: TourSnapshot, items: PullRequestSnapshot[]): void {
    const feed = snap.ide.pullRequests;
    const caps = this.ctx.host?.capabilities;
    const connect = (label: string) =>
      caps?.connectGitHub
        ? h('button', { class: 'btn btn-primary', onclick: () => this.ctx.send({ type: 'connectGitHub' }) }, label)
        : h('p', { class: 'small muted' }, this.ctx.host?.kind === 'cli' ? 'Start the companion with --prs to show them (it uses GITHUB_TOKEN or the gh CLI’s sign-in).' : 'Shown in VS Code once you connect GitHub.');
    if (feed.state === 'off') {
      this.prs.append(h('p', { class: 'muted' }, "See this repository's open pull requests here, and get an alert when one of yours needs you."), connect('Connect GitHub'));
      return;
    }
    if (feed.state === 'signed-out') {
      this.prs.append(h('p', { class: 'muted' }, 'Signed out of GitHub.'), connect('Sign in to GitHub'));
      return;
    }
    if (feed.state === 'no-remote') {
      this.prs.append(h('p', { class: 'muted' }, 'This repository has no GitHub remote.'));
      return;
    }
    if (!items.length) {
      this.prs.append(h('p', { class: 'muted' }, feed.state === 'error' ? "GitHub didn't answer. Trying again in a few minutes." : 'No open pull requests.'));
      return;
    }
    // Yours on this branch first, then yours, then the newest.
    const ordered = orderedPullRequests(items);
    const trouble = new Set(snap.attention.filter((a) => a.kind === 'pr' && a.target.type === 'pr').map((a) => (a.target as { number: number }).number));
    for (const pr of ordered) this.prs.append(this.pullRequestRow(pr, snap.at, trouble.has(pr.number), !!caps?.openLinks));
    if (feed.state === 'error') this.prs.append(h('p', { class: 'small muted' }, "GitHub didn't answer the last check; this list may be out of date."));
  }

  private pullRequestRow(pr: PullRequestSnapshot, now: number, needsYou: boolean, openable: boolean): HTMLElement {
    const ci = { passing: 'CI passing', failing: 'CI failing', pending: 'CI running', none: 'No CI' }[pr.ci];
    const tags = [pr.draft ? 'draft' : '', pr.conflict ? 'conflict' : '', pr.review === 'changes-requested' ? 'changes requested' : pr.review === 'approved' ? 'approved' : ''].filter(Boolean);
    // Ahead/behind when GitHub could compare the branch, when it was opened, and by whom.
    const opened = openedAt(pr.createdAt, now);
    const meta = [pr.ahead !== undefined && pr.behind !== undefined ? `↑${pr.ahead} ↓${pr.behind}` : '', opened, pr.author ? `@${pr.author}` : '', ...tags].filter(Boolean);
    const label = `Pull request ${pr.number}${pr.title ? `: ${pr.title}` : ''}. ${ci}${tags.length ? `, ${tags.join(', ')}` : ''}. ${pr.onBranch ? 'On your branch. ' : ''}${
      pr.ahead !== undefined ? `${pr.ahead} ahead, ${pr.behind} behind. ` : ''
    }Opened ${opened}${pr.author ? ` by ${pr.author}` : ''}.`;
    const children = [
      h('span', { class: 'pr-branch', title: pr.onBranch ? 'On your current branch' : '' }, pr.onBranch ? branchIcon() : null),
      h('span', { class: 'pr-num' }, `#${pr.number}`),
      h('span', { class: 'pr-body' }, h('strong', {}, pr.title ?? 'Pull request'), h('em', {}, meta.join(' · '))),
      h('i', { class: `pr-ci ci-${pr.ci}`, title: ci }),
    ];
    const cls = `pr-row${pr.onBranch ? ' on-branch' : ''}${needsYou ? ' needs-you' : ''}`;
    if (!openable) return h('div', { class: cls, 'aria-label': label }, ...children);
    return h('button', { class: cls, title: 'Open on GitHub', 'aria-label': label, onclick: () => this.ctx.send({ type: 'openPullRequest', number: pr.number }) }, ...children);
  }

  private updateStopCard(snap: TourSnapshot, pack?: JourneyPack): void {
    const m = snap.motion;
    const j = snap.journey;
    const show = !!j && (m.stopped || j.phase === 'parked') && m.behavior !== 'arrived';
    toggle(this.stopCard, 'show', show);
    // In Tour mode the dashboard comes up while the car is stopped, and goes when it drives on.
    toggle(this.root, 'car-stopped', show);
    if (show !== this.stopShown) {
      this.stopShown = show;
      this.syncRadio();
    }
    if (!show) return;
    const a = snap.activity;
    const parked = j!.phase === 'parked';
    // The alert that stopped the car leads the pill, whatever this display's switches say.
    const trigger = m.stopAlert ? snap.attention.find((x) => x.id === m.stopAlert) : undefined;
    let title = trigger?.text ?? '';
    let note = '';
    if (parked) {
      title = `Parked. Your journey to ${pack?.route.to ?? 'your destination'} is saved`;
      note = 'Pick it up whenever you like.';
    } else if (m.behavior === 'pull-over') {
      title ||= a.blockedReason ?? 'Something needs your attention';
      note = m.stopAlert === 'build' ? 'Pulled over until the build passes.' : 'Pulled over until you get it going again.';
    } else if (m.stopReason === 'waiting') {
      title ||= waitingFor(a.waitingAgent ?? 'Your agent', a.waitingAsk);
      note = a.waitingAsk === 'question' ? 'Answer to resume your journey.' : 'Reply to resume your journey.';
    } else if (m.stopReason === 'your-turn') {
      title ||= `${a.yourTurnAgent ?? 'Your agent'} finished · your turn`;
      note = 'Reply or get back to work to drive on.';
    } else if (m.stopReason === 'refuel') {
      title = `Refuelling at ${m.stopName ?? 'the gas station'}`;
      note = `Then ${pack?.route.from ?? 'the start'} to ${pack?.route.to ?? 'your destination'} again, by a different way where the road allows.`;
    } else {
      title = 'Taking a breather';
      note = 'Start working again to drive on.';
    }
    const key = JSON.stringify([trigger?.id, title, note, parked]);
    renderKeyed(this.stopCard, key, () => {
      this.stopCard.append(
        trigger
          ? alertPill(trigger, this.ctx, note, title)
          : notePill(m.behavior === 'pull-over' ? 'blocking' : 'general', m.behavior === 'pull-over' ? '!' : 'P', title, note),
      );
      if (parked) this.stopCard.append(h('button', { class: 'btn btn-primary', onclick: () => this.ctx.send({ type: 'resume' }) }, 'Resume journey'));
    });
  }

  /** The Alerts tab and both bells. */
  private updateAlerts(snap: TourSnapshot): void {
    this.alertsPane.update(snap);
    const lit = litBells(snap, this.ctx.prefs);
    const level = loudest(lit);
    lightBell(this.topBell, level, lit.length);
    lightBell(this.tabs.get('alerts')!, level, lit.length);
  }

  private updateNav(snap: TourSnapshot, pack?: JourneyPack): void {
    const j = snap.journey;
    if (!j || !pack) {
      renderKeyed(this.navInfo, 'none', () =>
        this.navInfo.append(h('p', { class: 'muted' }, 'No journey yet.'), h('button', { class: 'btn btn-primary', onclick: () => this.ctx.open('picker') }, 'Choose a destination')),
      );
      return;
    }
    const here = stoppedAt(snap);
    this.map.update(pack, j.scope === 'free-drive' ? (j.travelMs / 3_600_000) % 1 : j.progress, `${pack.route.from} → ${pack.route.to}`, here);
    const capped = j.progress >= APPROACH_CAP - 0.001 && j.phase === 'extended';
    const canArrive = j.phase !== 'arrived' && j.phase !== 'staying' && j.phase !== 'final-approach' && j.phase !== 'parked';
    const percent = j.scope === 'free-drive' ? -1 : Math.round(j.progress * 100);
    const key = [pack.id, j.location.label, j.scene.label, j.scopeLabel, percent, j.objective ?? '', capped, canArrive, here ?? ''].join('\n');
    renderKeyed(this.navInfo, key, () => this.renderNav(j, pack, capped, canArrive, here));
  }

  private renderNav(j: NonNullable<TourSnapshot['journey']>, pack: JourneyPack, capped: boolean, canArrive: boolean, here?: string): void {
    // At a scenic stop, its name; otherwise where, and the scene, unless they say the same thing ("Leaving Monterey" twice at the start).
    const where = here ? `Stopped at ${here}` : j.scene.label === j.location.label ? j.location.label : `${j.location.label} · ${j.scene.label}`;
    this.navInfo.append(
      h('div', { class: 'nav-route' }, h('strong', {}, pack.title), h('span', {}, ` · ${pack.route.name}`)),
      h('div', { class: 'nav-loc' }, where),
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
      this.workMap.update(pack, j.progress, `${pack.route.from} → ${pack.route.to}`, stoppedAt(snap));
      jp.append(h('div', { class: 'kv' }, h('span', {}, j.location.label), h('strong', {}, snap.motion.caption)));
    } else {
      jp.append(h('p', { class: 'muted' }, 'No journey in progress.'));
    }
  }
}

/** The scenic stop the car is stopped at, by name; undefined between stops, while refuelling and on the road. */
export function stoppedAt(snap: Pick<TourSnapshot, 'motion'>): string | undefined {
  const m = snap.motion;
  return m.stopped && m.behavior === 'scenic-stop' && m.stopReason !== 'refuel' ? m.stopName : undefined;
}

/** The Agents dial runs to eight at full scale, so six at once reach its red zone (75%). */
export const AGENTS_FULL = 8;
export function agentsDial(working: number): number {
  return Math.min(1, working / AGENTS_FULL);
}

/** The Tools dial is full at thirty tool calls and commands a minute. */
export const TOOLS_FULL = 30;
export function toolsDial(perMinute: number): number {
  return Math.min(1, perMinute / TOOLS_FULL);
}

/** The Changes ring: twenty files sit at the start of its red zone (75%), so 21 and up are in the red. */
export function changesDial(files: number): number {
  return Math.min(1, (files * RED_ZONE_FROM) / 20);
}

/**
 * The Issues dial, from the engine's error intensity (1 − e^(−score/5), a score of one
 * per error, 0.2 per warning, 2 for a failing check). Re-scaled so a score of 4, more
 * than three issues, reaches the red zone at 75%: 1 − e^(−score/k) with k = 4 / ln 4.
 */
export function issuesDial(errorIntensity: number): number {
  const ei = Math.max(0, Math.min(1, errorIntensity));
  return 1 - Math.pow(1 - ei, (5 * Math.log(4)) / 4);
}

/** The battery's lights: five, one per fifth of a charge, so 62% lights four. */
export const BATTERY_LEDS = 5;
export function batteryLit(level: number): number {
  return Math.max(0, Math.min(BATTERY_LEDS, Math.ceil(Math.round(Math.max(0, level) * 100) / (100 / BATTERY_LEDS))));
}

export interface CacheDot {
  text: string;
  label: string;
  /** Blue; orange under the driver's threshold; red once the cache has gone cold. */
  level: 'ok' | 'warn' | 'cold';
}

/**
 * The prompt cache's two dots beside the gear: the session's hit share ("96%") and the time
 * until the cache goes cold ("42m", "45s", then "0"), from its latest call and its lifetime.
 * Each turns orange under the driver's threshold. A threshold as long as the cache itself (15
 * minutes on a 5-minute cache) would never be anything but orange, so there it is a fifth of it.
 */
export function cacheDots(cache: CacheSnapshot | null, now: number, warn: { hitPct: number; minutes: number }): { hit?: CacheDot; timer?: CacheDot } {
  const dots: { hit?: CacheDot; timer?: CacheDot } = {};
  if (!cache) return dots;
  if (cache.hit !== null) {
    const pct = Math.round(cache.hit * 100);
    const low = pct < warn.hitPct;
    dots.hit = { text: `${pct}%`, level: low ? 'warn' : 'ok', label: `Prompt cache: ${pct}% of this session's input read from the cache${low ? `, under your ${warn.hitPct}%` : ''}` };
  }
  if (cache.ttl) {
    const left = (cache.at + cache.ttl * 1000 - now) / 1000;
    const life = cache.ttl >= 3600 ? '1-hour cache' : `${Math.round(cache.ttl / 60)}-minute cache`;
    const threshold = warn.minutes * 60 < cache.ttl ? warn.minutes * 60 : cache.ttl / 5;
    if (left <= 0) dots.timer = { text: '0', level: 'cold', label: `Prompt cache gone cold: the next reply writes it again (${life})` };
    else {
      const min = Math.floor(left / 60);
      const when = left < 60 ? `${Math.ceil(left)} seconds` : `${min} minute${min === 1 ? '' : 's'}`;
      dots.timer = { text: left < 60 ? `${Math.ceil(left)}s` : `${min}m`, level: left <= threshold ? 'warn' : 'ok', label: `Prompt cache goes cold in ${when} (${life})` };
    }
  }
  return dots;
}

/** When a PR was opened, exactly: "Oct 14, 3:12 PM", with the year when it isn't this one. */
export function openedAt(at: number, now: number): string {
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}
