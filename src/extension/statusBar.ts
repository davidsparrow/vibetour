import * as vscode from 'vscode';
import type { JourneyPack } from '../core/packs';
import type { TourSnapshot } from '../core/protocol';
import { formatStatus } from './helpers';

/**
 * The journey at a glance in the status bar; clicking it is the Tour / Work
 * toggle (PRD §32). Updates at most once a second.
 */

const MIN_INTERVAL_MS = 1_000;

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private lastUpdate = 0;
  private lastText = '';
  private latest?: TourSnapshot;

  constructor(
    private readonly packFor: (packId: string) => JourneyPack | undefined,
    enabled: boolean,
  ) {
    this.item = vscode.window.createStatusBarItem('vibetour.status', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'VibeTour';
    this.item.command = 'vibetour.toggleWork';
    this.render();
    this.setEnabled(enabled);
  }

  setEnabled(on: boolean): void {
    if (on) this.item.show();
    else this.item.hide();
  }

  update(snapshot: TourSnapshot, force = false): void {
    this.latest = snapshot;
    const now = Date.now();
    if (!force && now - this.lastUpdate < MIN_INTERVAL_MS) return;
    this.lastUpdate = now;
    this.render();
  }

  /** The next snapshot renders immediately (e.g. a journey just started). */
  invalidate(): void {
    this.lastUpdate = 0;
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    const s = this.latest;
    const pack = s?.journey ? this.packFor(s.journey.packId) : undefined;
    const status = formatStatus(s, pack);
    const key = `${status.text}\n${status.tooltip}`;
    if (key === this.lastText) return;
    this.lastText = key;
    this.item.text = status.text;
    this.item.tooltip = status.tooltip;
    this.item.accessibilityInformation = { label: status.ariaLabel, role: 'button' };
  }
}
