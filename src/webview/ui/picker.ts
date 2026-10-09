import type { ScopeId } from '../../core/journey';
import { defaultVariant, findVariant, type JourneyPack, type Mood } from '../../core/packs';
import { pickSurprise, scopeForDuration, type DurationChoice } from '../../core/passport';
import { MOOD_LABELS } from '../../core/protocol';
import type { AppContext } from './context';
import { coverArt, flagFor } from './covers';
import { clear, formatDuration, h, timeAgo } from './dom';

/**
 * The opening experience (PRD §6, §83): "Where do you want to go today?",
 * Journey cards, tickets (§36, §48) and "Take me somewhere" (§55).
 */

type Filter = 'all' | 'saved' | 'visited' | 'favorites';

const MOODS: Array<Mood | 'anywhere' | 'surprise'> = ['anywhere', 'warm', 'mountains', 'city-night', 'ocean', 'rain', 'quiet', 'fantasy', 'surprise'];
const DURATIONS: Array<[DurationChoice, string]> = [
  ['30m', '30 minutes'],
  ['1h', '1 hour'],
  ['afternoon', 'Afternoon'],
  ['workday', 'Entire workday'],
];

export class Picker {
  readonly el = h('div', { class: 'overlay picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Where do you want to go today?' });
  private filter: Filter = 'all';
  private mood: Mood | 'anywhere' | 'surprise' = 'anywhere';
  private duration: DurationChoice = '1h';
  private ticket?: { pack: JourneyPack; variantId: string; scope: ScopeId; objective: string; booked: boolean };

  constructor(private readonly ctx: AppContext) {}

  open(packId?: string): void {
    const pack = packId ? this.ctx.pack(packId) : undefined;
    this.ticket = pack ? this.newTicket(pack, false) : undefined;
    this.render();
  }

  private newTicket(pack: JourneyPack, booked: boolean, variantId?: string, scope?: ScopeId): NonNullable<Picker['ticket']> {
    return {
      pack,
      variantId: variantId ?? defaultVariant(pack).id,
      scope: scope ?? (pack.ticket.approxMinutes <= 60 ? 'day-trip' : 'scenic-drive'),
      objective: '',
      booked,
    };
  }

  render(): void {
    clear(this.el);
    if (this.ticket) this.renderTicket();
    else this.renderBoard();
  }

  private renderBoard(): void {
    const cat = this.ctx.catalog;
    if (!cat) return;
    const lib = new Map(cat.library.map((e) => [e.packId, e]));
    const banners: HTMLElement[] = [];
    const active = cat.activeJourney;
    if (active && active.phase !== 'arrived' && active.phase !== 'staying') {
      banners.push(
        h(
          'div',
          { class: 'banner' },
          h('div', {}, h('strong', {}, `${active.phase === 'parked' ? 'Parked' : 'On the road'}: ${active.title}`), h('span', {}, ` · ${active.subtitle} · ${Math.round(active.progress * 100)}%`)),
          h(
            'div',
            { class: 'banner-actions' },
            h(
              'button',
              {
                class: 'btn btn-primary',
                onclick: () => {
                  if (active.phase === 'parked') this.ctx.send({ type: 'resume' });
                  this.ctx.close();
                },
              },
              active.phase === 'parked' ? 'Continue journey' : 'Back to the road',
            ),
            h('button', { class: 'btn', onclick: () => this.ctx.send({ type: 'endJourney' }) }, 'End it here'),
          ),
        ),
      );
    } else if (cat.memory && this.ctx.pack(cat.memory.packId)) {
      const pack = this.ctx.pack(cat.memory.packId)!;
      banners.push(
        h(
          'div',
          { class: 'banner memory' },
          h('div', {}, h('span', {}, cat.memory.project ? `You last visited ${cat.memory.title} while building ${cat.memory.project}.` : `You last visited ${cat.memory.title}.`)),
          h('button', { class: 'btn btn-primary', onclick: () => this.showTicket(pack) }, `Return to ${cat.memory.title}`),
        ),
      );
    }

    const filters = (['all', 'saved', 'visited', 'favorites'] as Filter[]).map((f) =>
      h('button', { class: `chip-btn${this.filter === f ? ' on' : ''}`, 'aria-pressed': this.filter === f ? 'true' : 'false', onclick: () => ((this.filter = f), this.render()) }, { all: 'All journeys', saved: 'Saved tickets', visited: 'Ticket stubs', favorites: 'Favourites' }[f]),
    );
    const packs = cat.packs.filter((p) => {
      const e = lib.get(p.id);
      if (this.filter === 'saved') return !!e?.saved;
      if (this.filter === 'visited') return (e?.trips ?? 0) > 0;
      if (this.filter === 'favorites') return !!e?.favorite;
      return true;
    });

    const grid = h('div', { class: 'cards' });
    for (const pack of packs) grid.append(this.card(pack));
    if (!packs.length) grid.append(h('p', { class: 'muted' }, 'Nothing here yet.'));

    const surprise = h(
      'section',
      { class: 'surprise' },
      h('h2', {}, 'Take me somewhere'),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Mood' }, ...MOODS.map((m) => h('button', { class: `chip-btn${this.mood === m ? ' on' : ''}`, 'aria-pressed': this.mood === m ? 'true' : 'false', onclick: () => ((this.mood = m), this.render()) }, MOOD_LABELS[m]))),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'How long' }, ...DURATIONS.map(([d, label]) => h('button', { class: `chip-btn${this.duration === d ? ' on' : ''}`, 'aria-pressed': this.duration === d ? 'true' : 'false', onclick: () => ((this.duration = d), this.render()) }, label))),
      h('button', { class: 'btn btn-primary btn-lg', onclick: () => this.surprise() }, 'Take me somewhere'),
    );

    this.el.append(
      h(
        'div',
        { class: 'picker-inner' },
        h('header', { class: 'picker-head' }, h('div', { class: 'brand' }, 'VIBETOUR'), h('h1', {}, 'Where do you want to go today?'), h('p', { class: 'muted' }, 'Pick a destination. Then start coding — the journey moves with your work.')),
        ...banners,
        h('div', { class: 'chips filters' }, ...filters),
        grid,
        surprise,
        h('footer', { class: 'picker-foot' }, h('button', { class: 'btn btn-ghost', onclick: () => this.ctx.open('passport') }, 'My passport'), active ? h('button', { class: 'btn btn-ghost', onclick: () => this.ctx.close() }, 'Close') : null),
      ),
    );
  }

  private card(pack: JourneyPack): HTMLElement {
    const e = this.ctx.catalog?.library.find((l) => l.packId === pack.id);
    const v = defaultVariant(pack);
    const meta = [
      `≈ ${pack.ticket.approxMinutes} min`,
      v.label,
      e?.trips ? `${e.trips} trip${e.trips > 1 ? 's' : ''}` : null,
      e?.codingMs ? `${formatDuration(e.codingMs)} coded here` : null,
      e?.lastVisitedAt ? `Last visited ${timeAgo(e.lastVisitedAt, Date.now())}` : null,
    ].filter(Boolean) as string[];
    const card = h(
      'article',
      { class: `card${e?.trips ? ' stub' : ''}`, tabindex: '0', 'aria-label': `${pack.title}, ${pack.subtitle}` },
      h('div', { class: 'card-art' }, coverArt(pack, v.timeOfDay, v.skyTint ?? pack.palette.skyTint), e?.trips ? h('span', { class: 'stub-mark' }, 'TRAVELED') : null),
      h(
        'div',
        { class: 'card-body' },
        h('div', { class: 'card-region' }, `${flagFor(pack.countryCode)} ${pack.region.toUpperCase()}`),
        h('h3', {}, pack.title),
        h('div', { class: 'card-route' }, pack.subtitle, h('span', {}, ` · ${pack.route.name}`)),
        h('div', { class: 'badges' }, ...pack.ticket.badges.map((b) => h('span', { class: 'badge' }, b))),
        h('div', { class: 'card-meta' }, meta.join(' · ')),
        h(
          'div',
          { class: 'card-actions' },
          h('button', { class: 'btn btn-primary', onclick: (ev: Event) => (ev.stopPropagation(), this.showTicket(pack)) }, `Get ticket — ${pack.ticket.priceLabel}`),
          h(
            'button',
            {
              class: `btn btn-icon fav${e?.favorite ? ' on' : ''}`,
              'aria-pressed': e?.favorite ? 'true' : 'false',
              'aria-label': e?.favorite ? 'Remove from favourites' : 'Add to favourites',
              onclick: (ev: Event) => (ev.stopPropagation(), this.ctx.send({ type: 'toggleFavorite', packId: pack.id })),
            },
            e?.favorite ? '★' : '☆',
          ),
        ),
      ),
    );
    card.addEventListener('mouseenter', () => this.ctx.previewPack(pack.id));
    card.addEventListener('focus', () => this.ctx.previewPack(pack.id));
    card.addEventListener('click', () => this.showTicket(pack));
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target === card) this.showTicket(pack);
    });
    return card;
  }

  private showTicket(pack: JourneyPack, variantId?: string, scope?: ScopeId): void {
    this.ticket = this.newTicket(pack, true, variantId, scope);
    this.ctx.previewPack(pack.id, this.ticket.variantId);
    this.render();
  }

  private surprise(): void {
    const cat = this.ctx.catalog;
    if (!cat) return;
    const exclude = cat.activeJourney?.packId;
    const pack = pickSurprise(cat.packs, cat.library, this.mood, Math.random, exclude) ?? pickSurprise(cat.packs, cat.library, 'anywhere');
    if (!pack) return;
    let variantId: string | undefined;
    if (this.mood === 'rain') variantId = pack.variants.find((v) => v.weather === 'rain')?.id;
    if (this.mood === 'city-night') variantId = pack.variants.find((v) => v.timeOfDay === 'night')?.id;
    if (this.mood === 'surprise') variantId = pack.variants[Math.floor(Math.random() * pack.variants.length)].id;
    this.ctx.toast(`Taking you to ${pack.title}.`);
    this.showTicket(pack, variantId, scopeForDuration(this.duration));
  }

  private renderTicket(): void {
    const t = this.ticket!;
    const pack = t.pack;
    const scopes = this.ctx.catalog?.scopes ?? [];
    const variant = findVariant(pack, t.variantId);
    const variantChips = [
      ...pack.variants.map((v) =>
        h('button', { class: `chip-btn${t.variantId === v.id ? ' on' : ''}`, 'aria-pressed': t.variantId === v.id ? 'true' : 'false', onclick: () => ((t.variantId = v.id), this.ctx.previewPack(pack.id, v.id), this.render()) }, v.label),
      ),
      h('button', { class: `chip-btn${t.variantId === 'local' ? ' on' : ''}`, 'aria-pressed': t.variantId === 'local' ? 'true' : 'false', title: 'Use the time of day closest to your local clock', onclick: () => ((t.variantId = 'local'), this.render()) }, 'Match my clock'),
    ];
    const scopeChips = scopes.map((sc) =>
      h(
        'button',
        { class: `scope${t.scope === sc.id ? ' on' : ''}`, 'aria-pressed': t.scope === sc.id ? 'true' : 'false', onclick: () => ((t.scope = sc.id), this.render()) },
        h('strong', {}, sc.label),
        h('span', {}, sc.range),
        h('em', {}, sc.blurb),
      ),
    );
    const objective = h('input', {
      class: 'objective',
      type: 'text',
      maxlength: '140',
      placeholder: 'What are you building? (optional — e.g. "Onboarding flow")',
      'aria-label': 'Journey objective',
      value: t.objective,
    }) as HTMLInputElement;
    objective.addEventListener('input', () => (t.objective = objective.value));
    objective.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') depart();
    });
    const depart = () => {
      this.ctx.send({ type: 'startJourney', packId: pack.id, variantId: t.variantId, scope: t.scope, objective: t.objective.trim() || undefined });
      this.ctx.close();
    };

    const pass = h(
      'div',
      { class: 'ticket' },
      h(
        'div',
        { class: 'ticket-main' },
        h('div', { class: 'ticket-brand' }, h('span', {}, 'VIBETOUR'), h('span', {}, 'BOARDING PASS')),
        h('div', { class: 'ticket-title' }, pack.title.toUpperCase()),
        h('div', { class: 'ticket-route' }, h('div', {}, pack.route.from.toUpperCase()), h('div', { class: 'arrow' }, '↓'), h('div', {}, pack.route.to.toUpperCase())),
        h('div', { class: 'ticket-road' }, pack.route.name.toUpperCase()),
        h(
          'div',
          { class: 'ticket-fields' },
          h('div', {}, h('span', {}, 'DEPARTURE'), h('strong', {}, 'WHEN YOU START CODING')),
          h('div', {}, h('span', {}, 'SEAT'), h('strong', {}, 'DRIVER')),
          h('div', {}, h('span', {}, 'CONDITIONS'), h('strong', {}, t.variantId === 'local' ? 'MATCH MY CLOCK' : variant.label.toUpperCase())),
          h('div', {}, h('span', {}, 'STATUS'), h('strong', { class: 'ready' }, t.booked ? 'READY' : 'AVAILABLE')),
        ),
      ),
      h('div', { class: 'ticket-stub' }, coverArt(pack, variant.timeOfDay, variant.skyTint ?? pack.palette.skyTint), h('div', { class: 'stub-code' }, flagFor(pack.countryCode)), h('div', { class: 'stub-price' }, pack.ticket.priceLabel)),
    );

    this.el.append(
      h(
        'div',
        { class: 'picker-inner ticket-view' },
        h('button', { class: 'btn btn-ghost back', onclick: () => ((this.ticket = undefined), this.render()) }, '← All destinations'),
        h('p', { class: 'ticket-ready' }, 'Your ticket is ready.'),
        pass,
        h('p', { class: 'ticket-desc' }, pack.description),
        h('h4', {}, 'Conditions'),
        h('div', { class: 'chips' }, ...variantChips),
        h('h4', {}, 'Journey length'),
        h('div', { class: 'scopes' }, ...scopeChips),
        h('h4', {}, 'Objective'),
        objective,
        h('p', { class: 'small muted' }, 'Arrival is earned: the final approach waits until you mark the objective complete. Progress follows productive time, never keystrokes or lines of code.'),
        h(
          'div',
          { class: 'ticket-actions' },
          h('button', { class: 'btn btn-primary btn-lg', onclick: depart }, 'Depart now'),
          h(
            'button',
            {
              class: 'btn btn-lg',
              onclick: () => {
                this.ctx.send({ type: 'saveTicket', packId: pack.id, saved: true });
                this.ctx.toast(`Ticket to ${pack.route.to} saved for later.`);
                this.ticket = undefined;
                this.render();
              },
            },
            'Save for later',
          ),
        ),
        h('details', { class: 'facts' }, h('summary', {}, 'About this journey'), h('ul', {}, ...pack.facts.map((f) => h('li', {}, f))), h('p', { class: 'small muted' }, `${pack.provenance.creator} · ${pack.provenance.generation} · ${pack.authenticity} authenticity · ${pack.provenance.sources.join('; ')}`)),
      ),
    );
    queueMicrotask(() => (this.el.querySelector('.ticket-actions .btn-primary') as HTMLElement | null)?.focus());
  }
}
