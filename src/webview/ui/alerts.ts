import { loudest, severityOf, type AlertKind, type AlertSeverity, type Attention } from '../../core/attention';
import type { BranchRef } from '../../core/events';
import type { BellItem, ClientPrefs, HostInfo, PullRequestSnapshot, TourSnapshot } from '../../core/protocol';
import type { AppContext } from './context';
import { h, renderKeyed, toggle } from './dom';
import { bellIcon, branchIcon, pullRequestIcon } from './icons';

/** What each row in Settings › Alerts covers. */
export const BELL_LABELS: Record<BellItem, { label: string; hint: string }> = {
  question: { label: 'Questions', hint: 'An agent asks you something' },
  plan: { label: 'Plans to approve', hint: "An agent's plan is ready for you" },
  approval: { label: 'Approvals', hint: 'An agent needs permission to use a tool' },
  problem: { label: 'Agent stopped', hint: 'An agent hit an error or a rate limit' },
  build: { label: 'Build failing', hint: 'A failed build was left alone and the car pulled over' },
  turn: { label: 'Your turn', hint: 'An agent finished its turn' },
  pr: { label: 'PRs that need you', hint: 'A PR on your branch, or yours, has a conflict, failing CI or requested changes' },
  changes: { label: 'Changed files', hint: 'Files changed and not yet committed' },
  openPrs: { label: 'Open PRs', hint: "The repository's open pull requests, once GitHub is connected" },
  branches: { label: 'Branches ahead of main', hint: 'Local branches with commits main lacks' },
};

/** The alerts this display lists: the kinds its driver gave a bell colour, most urgent first. */
export function shownAlerts(attention: readonly Attention[], prefs: Pick<ClientPrefs, 'bells'>): Attention[] {
  return attention.filter((a) => prefs.bells[a.kind] !== 'off');
}

/** The colour an alert shows on this display: the one its driver picked, else its own. */
export function alertTone(kind: AlertKind, prefs: Pick<ClientPrefs, 'bells'>): AlertSeverity {
  const tone = prefs.bells[kind];
  return tone === 'off' ? severityOf(kind) : tone;
}

/** The quieter things in the tab that are there right now: uncommitted files, open PRs, branches ahead of main. */
function presentExtras(snap: Pick<TourSnapshot, 'ide'>): Array<Extract<BellItem, 'changes' | 'openPrs' | 'branches'>> {
  const out: Array<Extract<BellItem, 'changes' | 'openPrs' | 'branches'>> = [];
  const g = snap.ide.git;
  if (g && g.changes + g.staged > 0) out.push('changes');
  if (snap.ide.pullRequests?.items.length) out.push('openPrs');
  if (snap.ide.branches?.unmerged) out.push('branches');
  return out;
}

/** One colour per thing lighting the bells: each listed alert, and each quieter thing its driver gave a colour. */
export function litBells(snap: Pick<TourSnapshot, 'attention' | 'ide'>, prefs: Pick<ClientPrefs, 'bells'>): AlertSeverity[] {
  const tones = shownAlerts(snap.attention, prefs).map((a) => alertTone(a.kind, prefs));
  for (const item of presentExtras(snap)) {
    const tone = prefs.bells[item];
    if (tone !== 'off') tones.push(tone);
  }
  return tones;
}

/**
 * What lights the Alerts icon, and how loud: by default red when something
 * stopped the car, orange when something needs you, blue for uncommitted
 * files. Each display's driver can pick another colour, or none, per thing.
 */
export function alertLevel(snap: Pick<TourSnapshot, 'attention' | 'ide'>, prefs: Pick<ClientPrefs, 'bells'>): AlertSeverity | undefined {
  return loudest(litBells(snap, prefs));
}

/** Whether this host can act on a click, so the pill is a button. */
export function alertClickable(a: Attention, host: HostInfo | undefined): boolean {
  if (a.target.type === 'agent') return !!host?.capabilities.focusAgent;
  if (a.target.type === 'pr') return !!host?.capabilities.openLinks;
  return !!host?.capabilities.openFiles;
}

/** Open PRs as the PRs tab lists them: yours on this branch first, then yours, then the newest. */
export function orderedPullRequests(items: readonly PullRequestSnapshot[]): PullRequestSnapshot[] {
  return [...items].sort((a, b) => Number(b.onBranch) - Number(a.onBranch) || Number(b.mine) - Number(a.mine) || b.createdAt - a.createdAt);
}

const GLYPH: Record<Exclude<AlertKind, 'pr'>, string> = { question: '?', plan: '✓', approval: '!', problem: '!', build: '!', turn: '↩' };
const TITLE: Record<Attention['target']['type'], string> = { agent: 'Go to the agent', pr: 'Open this pull request on GitHub', problems: 'Open Problems' };

/**
 * One alert as a glowing pill, coloured by how loud it is. Clicking it goes
 * where you act: the agent, the PR on GitHub, or Problems. A `note` adds a
 * second, quieter sentence under the alert, and the pill grows taller to fit.
 */
export function alertPill(a: Attention, ctx: AppContext, note?: string, title = a.text, tone: AlertSeverity = severityOf(a.kind)): HTMLElement {
  const mark = a.kind === 'pr' ? pullRequestIcon() : h('i', { class: 'alert-glyph', 'aria-hidden': 'true' }, GLYPH[a.kind]);
  const cls = `alert alert-${tone} alert-${a.kind}${note ? ' alert-noted' : ''}`;
  const words = pillText(title, note);
  if (!alertClickable(a, ctx.host)) return h('span', { class: cls }, mark, words);
  const t = a.target;
  const onclick = () =>
    ctx.send(t.type === 'pr' ? { type: 'openPullRequest', number: t.number } : t.type === 'agent' ? { type: 'focusAgent', agentId: t.agentId } : { type: 'openProblems' });
  return h('button', { class: cls, title: TITLE[t.type], onclick }, mark, words);
}

/** A pill like an alert's for a stop no alert caused: parked, refuelling, a breather. */
export function notePill(severity: AlertSeverity, glyph: string, title: string, note: string): HTMLElement {
  return h('span', { class: `alert alert-${severity} alert-noted` }, h('i', { class: 'alert-glyph', 'aria-hidden': 'true' }, glyph), pillText(title, note));
}

function pillText(title: string, note?: string): HTMLElement {
  if (!note) return h('span', {}, title);
  return h('span', { class: 'alert-words' }, h('span', { class: 'alert-title' }, title), h('span', { class: 'alert-note' }, note));
}

/** A bell, for the Alerts tab and the icon at the top of the windshield. */
export function bell(): SVGSVGElement {
  return bellIcon();
}

/** Lights a bell button by the loudest alert, and says so to screen readers. */
export function lightBell(el: HTMLElement, level: AlertSeverity | undefined, count: number): void {
  for (const s of ['blocking', 'moderate', 'general'] as const) el.classList.toggle(`lit-${s}`, level === s);
  const label = level ? `Alerts: ${count} ${level === 'blocking' ? '— the loudest is red' : level === 'moderate' ? '— the loudest is orange' : '— something to look at'}` : 'Alerts: none';
  el.setAttribute('aria-label', label);
  el.title = 'Alerts';
}

/** Fades a column's bottom edge while more of it is below, out of sight. */
function moreBelow(col: HTMLElement): void {
  toggle(col, 'more-below', col.scrollHeight - col.scrollTop - col.clientHeight > 2);
}

/** Up to 999, then 999+: the host stops counting at 1000. */
function commits(n: number): string {
  return n > 999 ? '999+' : String(n);
}

/** Why the Open PRs list is empty, in a sentence. */
function noPullRequests(state: TourSnapshot['ide']['pullRequests']['state'], host: HostInfo | undefined): string {
  if (state === 'off' || state === 'signed-out') return host?.kind === 'cli' ? 'Start the companion with --prs to list them here.' : 'Connect GitHub in the PRs tab to list them here.';
  if (state === 'no-remote') return 'This repository has no GitHub remote.';
  if (state === 'error') return "GitHub didn't answer. Trying again in a few minutes.";
  return 'No open pull requests.';
}

/**
 * The Alerts tab: on the left, everything that needs you, then the open PRs
 * and the branches beside main; on the right, the file you're in and the
 * files changed.
 */
export class AlertsPane {
  readonly el = h('div', { class: 'alerts-pane' });
  private readonly list = h('div', { class: 'alerts-list' });
  private readonly needs = h('div', { class: 'alerts-group', role: 'region', 'aria-label': 'Needs you', 'aria-live': 'polite' });
  private readonly prs = h('div', { class: 'alerts-group', role: 'region', 'aria-label': 'Open PRs' });
  private readonly branches = h('div', { class: 'alerts-group', role: 'region', 'aria-label': 'Branches' });
  private readonly files = h('div', { class: 'alerts-files', role: 'region', 'aria-label': 'Files' });

  constructor(private readonly ctx: AppContext) {
    this.list.append(this.needs, this.prs, this.branches);
    this.el.append(this.list, this.files);
    for (const col of [this.list, this.files]) col.addEventListener('scroll', () => moreBelow(col), { passive: true });
  }

  update(snap: TourSnapshot): void {
    const prefs = this.ctx.prefs;
    const shown = shownAlerts(snap.attention, prefs);
    const host = this.ctx.host;
    renderKeyed(this.needs, JSON.stringify([shown.map((a) => [a.id, a.text, alertClickable(a, host), alertTone(a.kind, prefs)])]), () => {
      this.needs.append(h('h4', {}, 'Needs you'));
      if (!shown.length) this.needs.append(h('p', { class: 'muted small' }, 'Nothing right now. Questions, plans, approvals, stops, your turn and PRs that need you show here.'));
      for (const a of shown) this.needs.append(alertPill(a, this.ctx, undefined, a.text, alertTone(a.kind, prefs)));
    });
    this.updatePullRequests(snap);
    this.updateBranches(snap);

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

  private updatePullRequests(snap: TourSnapshot): void {
    const feed = snap.ide.pullRequests;
    const items = orderedPullRequests(feed.items);
    const host = this.ctx.host;
    const openable = !!host?.capabilities.openLinks;
    renderKeyed(this.prs, JSON.stringify([feed.state, items.map((p) => [p.number, p.title, p.onBranch]), openable, host?.kind]), () => {
      this.prs.append(h('h4', {}, items.length ? `Open PRs · ${items.length}` : 'Open PRs'));
      if (!items.length) {
        this.prs.append(h('p', { class: 'muted small' }, noPullRequests(feed.state, host)));
        return;
      }
      const wrap = h('div', { class: 'file-pills' });
      for (const pr of items) wrap.append(this.pullRequestPill(pr, openable));
      this.prs.append(wrap);
    });
  }

  private pullRequestPill(pr: PullRequestSnapshot, openable: boolean): HTMLElement {
    const cls = 'file-pill file-pill-pr';
    // Streaming mode hides the title; the number still shows.
    const words = h('span', { class: 'pill-text' }, pr.title ? `#${pr.number} ${pr.title}` : `#${pr.number}`);
    const about = `${pr.title ? `#${pr.number}: ${pr.title}` : `Pull request #${pr.number}`}${pr.onBranch ? ' · on your branch' : ''}`;
    if (!openable) return h('span', { class: cls, title: about }, pullRequestIcon(), words);
    const onclick = () => this.ctx.send({ type: 'openPullRequest', number: pr.number });
    return h('button', { class: cls, title: `${about}. Open it on GitHub`, onclick }, pullRequestIcon(), words);
  }

  private updateBranches(snap: TourSnapshot): void {
    const b = snap.ide.branches;
    this.branches.hidden = !b;
    if (!b) return;
    const openable = !!this.ctx.host?.capabilities.openLinks;
    renderKeyed(this.branches, JSON.stringify([b, openable]), () => {
      this.branches.append(h('h4', {}, b.count ? `Branches vs ${b.base} · ${b.count}` : `Branches vs ${b.base}`));
      if (!b.count) {
        this.branches.append(h('p', { class: 'muted small' }, `Nothing ahead of ${b.base}.`));
        return;
      }
      // Streaming mode hides the names; the count still shows.
      if (!b.items) {
        this.branches.append(h('p', { class: 'muted small' }, `${b.unmerged} branch${b.unmerged === 1 ? '' : 'es'} ahead of ${b.base}.`));
        return;
      }
      const wrap = h('div', { class: 'file-pills' });
      for (const item of b.items) wrap.append(this.branchPill(item, b.base, openable));
      this.branches.append(wrap);
    });
  }

  private branchPill(b: BranchRef, base: string, openable: boolean): HTMLElement {
    const cls = `file-pill file-pill-branch${b.current ? ' branch-current' : ''}`;
    const counts = `${commits(b.behind)} behind | ${commits(b.ahead)} ahead`;
    // Behind | ahead, in arrows as the PRs tab writes them, so the name keeps most of a narrow column.
    const arrows = h('span', { class: 'pill-counts', 'aria-hidden': 'true' }, `↓${commits(b.behind)} | ↑${commits(b.ahead)}`);
    const kids = [branchIcon(), h('span', { class: 'pill-text' }, b.name), arrows, h('span', { class: 'sr-only' }, `, ${counts} of ${base}`)];
    const about = `${b.name}${b.current ? ', checked out here' : ''}: ${counts} of ${base}`;
    if (!b.link || !openable) return h('span', { class: cls, title: b.link ? about : `${about}. Not on GitHub yet` }, ...kids);
    const onclick = () => this.ctx.send({ type: 'openBranchCompare', branch: b.name });
    const title = `${about}. Compare it with ${base} on GitHub`;
    return h('button', { class: cls, title, 'aria-label': title, onclick }, ...kids);
  }

  private filePill(path: string, name: string, openable: boolean, extra = ''): HTMLElement {
    const cls = `file-pill ${extra}`.trim();
    if (!openable) return h('span', { class: cls, title: path }, name);
    return h('button', { class: cls, title: `Open ${path}`, onclick: () => this.ctx.send({ type: 'openFile', path }) }, name);
  }
}
