import type { Stamp } from '../../core/passport';
import type { TourSnapshot } from '../../core/protocol';
import type { AppContext } from './context';
import { flagFor } from './covers';
import { clear, formatDate, formatDuration, h } from './dom';

/** VibeTour Passport (PRD §21, §47): elegant stamps, not points. */
export class PassportView {
  readonly el = h('div', { class: 'overlay passport', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'VibeTour Passport' });

  constructor(private readonly ctx: AppContext) {}

  render(): void {
    clear(this.el);
    const cat = this.ctx.catalog;
    if (!cat) return;
    const st = cat.passport;
    const stat = (label: string, value: string) => h('div', { class: 'pstat' }, h('strong', {}, value), h('span', {}, label));
    const stamps = cat.stamps;
    this.el.append(
      h(
        'div',
        { class: 'passport-book' },
        h(
          'header',
          { class: 'passport-head' },
          h('div', {}, h('div', { class: 'brand' }, 'VIBETOUR'), h('h1', {}, 'Passport')),
          h('button', { class: 'btn btn-ghost', onclick: () => this.ctx.close(), 'aria-label': 'Close passport' }, 'Close'),
        ),
        h(
          'div',
          { class: 'pstats' },
          stat('Countries visited', String(st.countries)),
          stat('Routes completed', String(st.routesCompleted)),
          stat('Coding hours traveled', st.codingHours.toFixed(1)),
          stat('Favourite destination', st.favoriteDestination ?? '—'),
          stat('Night journeys', String(st.nightJourneys)),
          stat('Mountain journeys', String(st.mountainJourneys)),
          stat('Longest expedition', st.longestExpeditionMs ? formatDuration(st.longestExpeditionMs) : '—'),
        ),
        stamps.length
          ? h('div', { class: 'stamps' }, ...stamps.map((s, i) => this.stamp(s, i)))
          : h('div', { class: 'empty-passport' }, h('p', {}, 'Your first stamp is one journey away.'), h('button', { class: 'btn btn-primary', onclick: () => this.ctx.open('picker') }, 'Choose a destination')),
      ),
    );
  }

  private stamp(s: Stamp, i: number): HTMLElement {
    const tilt = ((i * 37) % 9) - 4;
    return h(
      'article',
      { class: `stamp tone-${i % 4}`, style: `--tilt:${tilt}deg`, 'aria-label': `${s.title}, visited ${formatDate(s.arrivedAt)}` },
      h('div', { class: 'stamp-country' }, `${flagFor(s.countryCode)} ${s.country.toUpperCase()}`),
      h('div', { class: 'stamp-title' }, s.title),
      h('div', { class: 'stamp-route' }, s.subtitle),
      h('div', { class: 'stamp-date' }, `Visited ${formatDate(s.arrivedAt)}`),
      h('div', { class: 'stamp-time' }, `Coding time ${formatDuration(s.codingMs)}`),
      s.objective ? h('div', { class: 'stamp-obj' }, s.objective) : null,
      s.project ? h('div', { class: 'stamp-proj' }, `Project: ${s.project}`) : null,
      s.note ? h('blockquote', {}, s.note) : null,
    );
  }
}

/** Arrival card (PRD §34, §68): subtle, no confetti. */
export class ArrivalCard {
  readonly el = h('div', { class: 'arrival', role: 'dialog', 'aria-label': 'Arrived' });
  private shownFor = '';
  private dismissed = '';

  constructor(private readonly ctx: AppContext) {}

  update(snap: TourSnapshot): void {
    const j = snap.journey;
    const show = !!j && j.phase === 'arrived' && this.dismissed !== j.id;
    this.el.classList.toggle('show', show);
    if (!show || this.shownFor === j!.id) return;
    this.shownFor = j!.id;
    const pack = this.ctx.pack(j!.packId);
    if (!pack) return;
    const stampId = this.ctx.catalog?.lastStampId;
    const tests = snap.ide.results.test;
    const lines = [
      `${formatDuration(j!.travelMs)} traveling`,
      `${j!.sessions} coding session${j!.sessions > 1 ? 's' : ''}`,
      j!.objective ? `Completed: ${j!.objective}` : 'Objective complete',
      j!.stats.filesChanged ? `${j!.stats.filesChanged} file${j!.stats.filesChanged > 1 ? 's' : ''} changed` : null,
      tests ? (tests.ok ? 'Tests passing' : 'Tests need attention') : null,
    ].filter(Boolean) as string[];
    const note = h('textarea', { class: 'memory-note', rows: '2', maxlength: '280', placeholder: 'Save a memory of this trip (optional)', 'aria-label': 'Travel memory' }) as HTMLTextAreaElement;
    const memory = h('div', { class: 'memory hidden' }, note, h('button', { class: 'btn', onclick: () => {
      if (stampId) this.ctx.send({ type: 'saveMemory', stampId, note: note.value });
      this.ctx.toast('Memory saved to your passport.');
      memory.classList.add('hidden');
    } }, 'Save'));
    clear(this.el);
    this.el.append(
      h('div', { class: 'arrival-kicker' }, 'Arrived'),
      h('div', { class: 'arrival-title' }, `${pack.route.from} → ${pack.route.to}`),
      h('div', { class: 'arrival-scene' }, pack.arrival.scene),
      h('ul', { class: 'arrival-lines' }, ...lines.map((l) => h('li', {}, l))),
      h('div', { class: 'arrival-stamped' }, '✓ Passport stamped'),
      memory,
      h(
        'div',
        { class: 'arrival-actions' },
        h('button', { class: 'btn', onclick: () => memory.classList.toggle('hidden') }, 'Save memory'),
        h('button', { class: 'btn', onclick: () => this.ctx.open('passport') }, 'Passport'),
        h('button', { class: 'btn', onclick: () => this.ctx.capture(`Arrived in ${pack.route.to}.`) }, 'Share'),
        h('button', { class: 'btn', onclick: () => {
          this.dismissed = j!.id;
          this.ctx.send({ type: 'stay' });
          this.el.classList.remove('show');
        } }, 'Stay here'),
        h('button', { class: 'btn btn-primary', onclick: () => {
          this.dismissed = j!.id;
          this.ctx.send({ type: 'endJourney' });
          this.ctx.open('picker');
        } }, 'Choose next destination'),
      ),
    );
  }
}
