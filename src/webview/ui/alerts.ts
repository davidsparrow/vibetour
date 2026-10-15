import type { AlertKind, Attention } from '../../core/attention';
import type { ClientPrefs, HostInfo } from '../../core/protocol';
import type { AppContext } from './context';
import { h, renderKeyed } from './dom';
import { pullRequestIcon } from './icons';

/** At most this many alerts on the glass; the rest fold into "+N". */
export const MAX_ALERTS = 4;

/** What each switch in Settings › HUD alerts covers. */
export const ALERT_LABELS: Record<AlertKind, { label: string; hint: string }> = {
  question: { label: 'Questions', hint: 'An agent asks you something' },
  plan: { label: 'Plans to approve', hint: "An agent's plan is ready for you" },
  approval: { label: 'Approvals', hint: 'An agent needs permission to use a tool' },
  problem: { label: 'Agent stopped', hint: 'An agent hit an error or a rate limit' },
  turn: { label: 'Your turn', hint: 'An agent finished its turn' },
  pr: { label: 'Pull requests', hint: 'A PR on your branch, or yours, has a conflict, failing CI or requested changes' },
};

/** The alerts this display shows: the kinds its driver switched on, most urgent first. */
export function shownAlerts(attention: readonly Attention[], prefs: Pick<ClientPrefs, 'hudAlerts'>): { shown: Attention[]; more: Attention[] } {
  const on = attention.filter((a) => prefs.hudAlerts[a.kind]);
  return { shown: on.slice(0, MAX_ALERTS), more: on.slice(MAX_ALERTS) };
}

/** Whether this host can act on a click, so the chip is a button. */
export function alertClickable(a: Attention, host: HostInfo | undefined): boolean {
  return a.target.type === 'agent' ? !!host?.capabilities.focusAgent : !!host?.capabilities.openLinks;
}

const GLYPH: Record<Exclude<AlertKind, 'pr'>, string> = { question: '?', plan: '✓', approval: '!', problem: '!', turn: '↩' };

/**
 * The HUD's alert row: one glowing chip per thing that needs you, only while
 * it does. Clicking one goes where you act: the agent, or the PR on GitHub.
 */
export class HudAlerts {
  readonly el = h('div', { class: 'hud-alerts', role: 'region', 'aria-label': 'Needs you', 'aria-live': 'polite' });

  constructor(private readonly ctx: AppContext) {}

  update(attention: readonly Attention[]): void {
    const { shown, more } = shownAlerts(attention, this.ctx.prefs);
    const host = this.ctx.host;
    const key = JSON.stringify([shown.map((a) => [a.id, a.text, alertClickable(a, host)]), more.length]);
    renderKeyed(this.el, key, () => {
      for (const a of shown) this.el.append(this.chip(a, alertClickable(a, host)));
      if (more.length) this.el.append(h('span', { class: 'alert alert-more', title: more.map((a) => a.text).join('\n') }, `+${more.length}`));
    });
  }

  private chip(a: Attention, clickable: boolean): HTMLElement {
    const mark = a.kind === 'pr' ? pullRequestIcon() : h('i', { class: 'alert-glyph', 'aria-hidden': 'true' }, GLYPH[a.kind]);
    const where = a.target.type === 'pr' ? 'Open this pull request on GitHub' : 'Go to the agent';
    if (!clickable) return h('span', { class: `alert alert-${a.kind}` }, mark, h('span', {}, a.text));
    const onclick = () => this.ctx.send(a.target.type === 'pr' ? { type: 'openPullRequest', number: a.target.number } : { type: 'focusAgent', agentId: a.target.agentId });
    return h('button', { class: `alert alert-${a.kind}`, title: where, onclick }, mark, h('span', {}, a.text));
  }
}
