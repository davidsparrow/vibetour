import { loudest, severityOf, type AlertKind, type AlertSeverity, type Attention } from '../../core/attention';
import type { ClientPrefs, HostInfo, TourSnapshot } from '../../core/protocol';
import type { AppContext } from './context';
import { h, renderKeyed, toggle } from './dom';
import { bellIcon, pullRequestIcon } from './icons';

/** What each switch in Settings › Alerts covers. */
export const ALERT_LABELS: Record<AlertKind, { label: string; hint: string }> = {
  question: { label: 'Questions', hint: 'An agent asks you something' },
  plan: { label: 'Plans to approve', hint: "An agent's plan is ready for you" },
  approval: { label: 'Approvals', hint: 'An agent needs permission to use a tool' },
  problem: { label: 'Agent stopped', hint: 'An agent hit an error or a rate limit' },
  build: { label: 'Build failing', hint: 'A failed build was left alone and the car pulled over' },
  turn: { label: 'Your turn', hint: 'An agent finished its turn' },
  pr: { label: 'Pull requests', hint: 'A PR on your branch, or yours, has a conflict, failing CI or requested changes' },
};

/** The alerts this display lists: the kinds its driver switched on, most urgent first. */
export function shownAlerts(attention: readonly Attention[], prefs: Pick<ClientPrefs, 'hudAlerts'>): Attention[] {
  return attention.filter((a) => prefs.hudAlerts[a.kind]);
}

/**
 * What lights the Alerts icon, and how loud: red when something stopped the
 * car, orange when something needs you, blue for uncommitted files.
 */
export function alertLevel(snap: Pick<TourSnapshot, 'attention' | 'ide'>, prefs: Pick<ClientPrefs, 'hudAlerts' | 'alertOnChanges'>): AlertSeverity | undefined {
  const levels = shownAlerts(snap.attention, prefs).map((a) => severityOf(a.kind));
  const g = snap.ide.git;
  if (prefs.alertOnChanges && g && g.changes + g.staged > 0) levels.push('general');
  return loudest(levels);
}

/** Whether this host can act on a click, so the pill is a button. */
export function alertClickable(a: Attention, host: HostInfo | undefined): boolean {
  if (a.target.type === 'agent') return !!host?.capabilities.focusAgent;
  if (a.target.type === 'pr') return !!host?.capabilities.openLinks;
  return !!host?.capabilities.openFiles;
}

const GLYPH: Record<Exclude<AlertKind, 'pr'>, string> = { question: '?', plan: '✓', approval: '!', problem: '!', build: '!', turn: '↩' };
const TITLE: Record<Attention['target']['type'], string> = { agent: 'Go to the agent', pr: 'Open this pull request on GitHub', problems: 'Open Problems' };

/**
 * One alert as a glowing pill, coloured by how loud it is. Clicking it goes
 * where you act: the agent, the PR on GitHub, or Problems.
 */
export function alertPill(a: Attention, ctx: AppContext): HTMLElement {
  const mark = a.kind === 'pr' ? pullRequestIcon() : h('i', { class: 'alert-glyph', 'aria-hidden': 'true' }, GLYPH[a.kind]);
  const cls = `alert alert-${severityOf(a.kind)} alert-${a.kind}`;
  if (!alertClickable(a, ctx.host)) return h('span', { class: cls }, mark, h('span', {}, a.text));
  const t = a.target;
  const onclick = () =>
    ctx.send(t.type === 'pr' ? { type: 'openPullRequest', number: t.number } : t.type === 'agent' ? { type: 'focusAgent', agentId: t.agentId } : { type: 'openProblems' });
  return h('button', { class: cls, title: TITLE[t.type], onclick }, mark, h('span', {}, a.text));
}

/** A bell, for the Alerts tab and the icon at the top of the windshield. */
export function bell(): SVGSVGElement {
  return bellIcon();
}

/** Lights a bell button by the loudest alert, and says so to screen readers. */
export function lightBell(el: HTMLElement, level: AlertSeverity | undefined, count: number): void {
  for (const s of ['blocking', 'moderate', 'general'] as const) el.classList.toggle(`lit-${s}`, level === s);
  const label = level ? `Alerts: ${count} ${level === 'blocking' ? '— the car stopped for one' : level === 'moderate' ? '— something needs you' : '— files changed'}` : 'Alerts: none';
  el.setAttribute('aria-label', label);
  el.title = 'Alerts';
}

/** Fades a column's bottom edge while more of it is below, out of sight. */
function moreBelow(col: HTMLElement): void {
  toggle(col, 'more-below', col.scrollHeight - col.scrollTop - col.clientHeight > 2);
}

/**
 * The Alerts tab: everything that needs you on the left, the file you're in
 * and the files changed on the right.
 */
export class AlertsPane {
  readonly el = h('div', { class: 'alerts-pane' });
  private readonly list = h('div', { class: 'alerts-list', role: 'region', 'aria-label': 'Needs you', 'aria-live': 'polite' });
  private readonly files = h('div', { class: 'alerts-files', role: 'region', 'aria-label': 'Files' });

  constructor(private readonly ctx: AppContext) {
    this.el.append(this.list, this.files);
    for (const col of [this.list, this.files]) col.addEventListener('scroll', () => moreBelow(col), { passive: true });
  }

  update(snap: TourSnapshot): void {
    const shown = shownAlerts(snap.attention, this.ctx.prefs);
    const host = this.ctx.host;
    renderKeyed(this.list, JSON.stringify([shown.map((a) => [a.id, a.text, alertClickable(a, host)])]), () => {
      this.list.append(h('h4', {}, 'Needs you'));
      if (!shown.length) this.list.append(h('p', { class: 'muted small' }, 'Nothing right now. Questions, plans, approvals, stops, your turn and PRs that need you show here.'));
      for (const a of shown) this.list.append(alertPill(a, this.ctx));
    });

    const g = snap.ide.git;
    const active = snap.ide.activeFile;
    const files = g?.files ?? [];
    const count = g ? g.changes + g.staged : 0;
    const openable = !!host?.capabilities.openFiles;
    renderKeyed(this.files, JSON.stringify([active?.path ?? active?.name, files, count, openable]), () => {
      if (active) {
        this.files.append(h('h4', {}, 'Editing'), this.filePill(active.path ?? active.name, active.name, openable && !!active.path, 'file-active'));
      }
      this.files.append(h('h4', {}, count ? `Changed · ${count}` : 'Changed'));
      if (!count) {
        this.files.append(h('p', { class: 'muted small' }, 'Nothing to commit.'));
        return;
      }
      // Streaming mode hides the names; the count still shows.
      if (!files.length) this.files.append(h('p', { class: 'muted small' }, `${count} file${count === 1 ? '' : 's'} not committed.`));
      const wrap = h('div', { class: 'file-pills' });
      for (const path of files) wrap.append(this.filePill(path, path.split('/').pop() ?? path, openable));
      if (files.length) this.files.append(wrap);
    });
    moreBelow(this.list);
    moreBelow(this.files);
  }

  private filePill(path: string, name: string, openable: boolean, extra = ''): HTMLElement {
    const cls = `file-pill ${extra}`.trim();
    if (!openable) return h('span', { class: cls, title: path }, name);
    return h('button', { class: cls, title: `Open ${path}`, onclick: () => this.ctx.send({ type: 'openFile', path }) }, name);
  }
}
