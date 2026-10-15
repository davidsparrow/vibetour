import { PRESET_COUNT, type DeckBand, type DeckPrefs, type MusicState, type NowPlaying, type RadioStation } from '../../core/music';
import type { AgentSnapshot } from '../../core/protocol';
import { canPlayCodec, type DeckEvent, type MusicDeck } from '../audio/musicDeck';
import type { Soundscape } from '../audio/soundscape';
import { ROLE_LABEL, STATUS_LABEL } from './agents';
import type { AppContext } from './context';
import { h, renderKeyed, text, toggle } from './dom';
import { EqLights } from './eqLights';

/**
 * The car radio on the dashboard's Radio tab: FM plays internet radio through
 * the head unit's DSP, CB lists your agents. Built once and only mutated, so
 * the 4 Hz snapshots never swap a control out from under a click.
 */

const SOMAFM_SUPPORT = 'https://somafm.com/support/';
const HOLD_MS = 600;
const WATCH_MS = 10_000;
/** No sound this long after tuning: try once more, then give up. */
const TUNE_TIMEOUT_MS = 15_000;
const PRESETS_REQUEST = 'presets';

type Status = 'off' | 'tuning' | 'live' | 'error';
type Knob = 'bass' | 'treble' | 'fader' | 'balance';

const MIX_STEPS: Array<[number, string]> = [
  [1, 'STEREO'],
  [1.5, 'WIDE'],
  [0, 'MONO'],
];

function stationMeta(s: RadioStation | undefined): string {
  if (!s) return '';
  return [s.codec, s.bitrate ? `${s.bitrate} kbps` : '', s.countryCode].filter(Boolean).join(' · ');
}

export class RadioDeck {
  readonly el: HTMLElement;
  private readonly eq: EqLights;
  private readonly eqCanvas = h('canvas', { class: 'deck-eq', 'aria-hidden': 'true' });
  private readonly bands = {} as Record<DeckBand, HTMLButtonElement>;
  private readonly live = h('span', { class: 'deck-live' }, h('i'), h('b', {}, 'OFF'));
  private readonly stationEl = h('div', { class: 'deck-station' });
  private readonly titleEl = h('div', { class: 'deck-title' });
  private readonly metaEl = h('div', { class: 'deck-meta' });
  private readonly powerBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly volume: HTMLInputElement;
  private readonly knobs = {} as Record<Knob, HTMLInputElement>;
  private readonly surroundBtn: HTMLButtonElement;
  private readonly mixBtn: HTMLButtonElement;
  private readonly presetBtns: HTMLButtonElement[] = [];
  private readonly setBtn: HTMLButtonElement;
  private readonly presetRow: HTMLElement;
  private readonly dspRow: HTMLElement;
  private readonly fmBody = h('div', { class: 'deck-body deck-fm' });
  private readonly cbBody = h('div', { class: 'deck-body deck-cb' });
  private readonly cbList = h('div', { class: 'deck-cb-list' });
  private readonly note = h('p', { class: 'deck-note small muted' });
  private readonly localTitle = h('h4', {}, 'Local stations');
  private readonly localList = h('div', { class: 'deck-list' });
  private readonly presetList = h('div', { class: 'deck-list' });
  private readonly searchInput: HTMLInputElement;
  private readonly results = h('div', { class: 'deck-list deck-results' });
  private status: Status = 'off';
  private error = '';
  private visible = false;
  private readonly stations = new Map<string, RadioStation>();
  private music?: MusicState;
  private requestSeq = 0;
  private searchRequest?: string;
  private presetsRequested = false;
  private localPack?: string;
  private currentPack?: string;
  private watchTimer = 0;
  private tuneTimer = 0;
  private retried = false;
  private setArmed = false;
  private audio?: MusicDeck;
  /** Knobs being dragged: snapshots must not move them. */
  private readonly dragging = new Set<HTMLInputElement>();

  constructor(
    private readonly ctx: AppContext,
    private readonly sound: Soundscape,
  ) {
    this.eq = new EqLights(
      this.eqCanvas,
      {
        levels: () => this.sound.levels(),
        gain: () => (this.audio?.playing ? this.deckPrefs.volume : 0) || (this.ctx.prefs.audio.enabled ? this.ctx.prefs.audio.master : 0),
        reducedMotion: () => this.ctx.prefs.reducedMotion,
      },
      10,
      (beat) => (this.live.style.opacity = this.status === 'live' ? String(0.65 + 0.35 * beat) : ''),
    );

    for (const b of ['fm', 'cb'] as DeckBand[]) {
      this.bands[b] = h(
        'button',
        { class: `band band-${b}`, 'aria-pressed': 'false', title: b === 'fm' ? 'FM: music' : 'CB: your agents', onclick: () => this.update((d) => (d.band = b)) },
        b.toUpperCase(),
      );
    }

    const btn = (cls: string, label: string, title: string, run: () => void) => h('button', { class: `deck-btn ${cls}`, title, 'aria-label': title, onclick: run }, label);
    this.powerBtn = btn('deck-power', '⏻', 'Power', () => this.power());
    this.playBtn = btn('deck-play', '▶', 'Play', () => (this.status === 'off' || this.status === 'error' ? this.start() : this.stop()));
    const prev = btn('deck-prev', '⏮', 'Previous preset', () => this.step(-1));
    const next = btn('deck-next', '⏭', 'Next preset', () => this.step(1));
    this.volume = this.range('deck-volume', 'Volume', 0, 1, 0.05, (v) => (d) => (d.volume = v));

    const knob = (key: Knob, label: string, min: number, max: number, step: number, title: string) => {
      this.knobs[key] = this.range(`deck-knob knob-${key}`, title, min, max, step, (v) => (d) => (d[key] = v));
      return h('label', { class: 'deck-knob-wrap', title }, h('span', {}, label), this.knobs[key]);
    };
    this.surroundBtn = h('button', { class: 'deck-toggle', 'aria-pressed': 'false', title: 'Surround: a little room around the music', onclick: () => this.update((d) => (d.surround = !d.surround)) }, 'SURROUND');
    this.mixBtn = h('button', { class: 'deck-toggle', title: 'Stereo mix: stereo, wide or mono', onclick: () => this.cycleMix() }, 'ST MIX');

    for (let i = 0; i < PRESET_COUNT; i++) this.presetBtns.push(this.presetButton(i));
    this.setBtn = h('button', { class: 'deck-set', 'aria-pressed': 'false', title: 'Save the station to the next preset you press (or hold a preset, or Shift+click it)', onclick: () => this.armSet(!this.setArmed) }, 'SET');

    this.searchInput = h('input', { type: 'search', class: 'deck-search', maxlength: 100, placeholder: 'Search stations, or #tag', 'aria-label': 'Search radio stations' });
    const search = h(
      'form',
      { class: 'deck-search-row', role: 'search' },
      this.searchInput,
      h('button', { class: 'btn btn-sm', type: 'submit' }, 'Search'),
    );
    search.addEventListener('submit', (e) => {
      e.preventDefault();
      this.search(this.searchInput.value);
    });

    this.fmBody.append(
      this.note,
      h('section', { class: 'deck-section deck-local' }, this.localTitle, this.localList),
      h('section', { class: 'deck-section' }, h('h4', {}, 'Search'), search, this.results),
      h('section', { class: 'deck-section' }, h('h4', {}, 'Presets from SomaFM'), this.presetList),
      h(
        'p',
        { class: 'deck-credit small muted' },
        'Presets by SomaFM, listener-supported and commercial-free radio from San Francisco. ',
        h('a', { href: SOMAFM_SUPPORT, target: '_blank', rel: 'noopener noreferrer' }, 'Support SomaFM'),
        '. Other stations come from the Radio Browser directory.',
      ),
    );
    this.cbBody.append(this.cbList);

    this.el = h(
      'div',
      { class: 'deck' },
      h(
        'div',
        { class: 'deck-head' },
        this.eqCanvas,
        h(
          'div',
          { class: 'deck-main' },
          h('div', { class: 'deck-top' }, h('div', { class: 'band-switch', role: 'group', 'aria-label': 'Band' }, this.bands.fm, this.bands.cb), this.live),
          h('div', { class: 'deck-now' }, this.stationEl, this.titleEl, this.metaEl),
          h('div', { class: 'deck-transport' }, this.powerBtn, prev, this.playBtn, next, h('label', { class: 'deck-vol', title: 'Volume' }, h('span', { 'aria-hidden': 'true' }, 'VOL'), this.volume)),
        ),
      ),
      (this.presetRow = h('div', { class: 'deck-presets', role: 'group', 'aria-label': 'Presets' }, ...this.presetBtns, this.setBtn)),
      (this.dspRow = h(
        'div',
        { class: 'deck-dsp', role: 'group', 'aria-label': 'Sound' },
        knob('bass', 'BASS', -12, 12, 1, 'Bass'),
        knob('treble', 'TREB', -12, 12, 1, 'Treble'),
        knob('fader', 'FADE', -1, 1, 0.1, 'Fader: rear to front'),
        knob('balance', 'BAL', -1, 1, 0.1, 'Balance: left to right'),
        this.surroundBtn,
        this.mixBtn,
      )),
      this.fmBody,
      this.cbBody,
    );
    this.applyPrefs();
    this.renderDisplay();
  }

  private get deckPrefs(): DeckPrefs {
    return this.ctx.prefs.deck;
  }

  private get canPlay(): boolean {
    return !!this.ctx.host?.capabilities.radio && !!this.ctx.host.radioStreamBase;
  }

  // ------------------------------------------------------------------ app

  /** The pane is on screen: run the lights and follow the station's titles. */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.eq.setVisible(on && this.deckPrefs.lights);
    window.clearInterval(this.watchTimer);
    if (on) {
      this.watch(true);
      this.watchTimer = window.setInterval(() => this.watch(true), WATCH_MS);
      this.loadFm();
    } else if (this.ctx.host) this.watch(false);
  }

  /** A host said hello (first, or after reconnecting). */
  onHost(): void {
    // Radio turned off (or no server) while playing: stop cleanly rather than fail.
    if (!this.canPlay && this.status !== 'off') this.stop();
    this.presetsRequested = false;
    this.localPack = undefined;
    if (this.visible) {
      this.watch(true);
      this.loadFm();
    }
    this.renderNote();
    this.renderDisplay();
  }

  applyPrefs(): void {
    const d = this.deckPrefs;
    for (const b of ['fm', 'cb'] as DeckBand[]) {
      toggle(this.bands[b], 'on', d.band === b);
      this.bands[b].setAttribute('aria-pressed', d.band === b ? 'true' : 'false');
    }
    // Presets and tone belong to FM; on CB the agents come straight under the display.
    this.fmBody.hidden = this.presetRow.hidden = this.dspRow.hidden = d.band !== 'fm';
    this.cbBody.hidden = d.band !== 'cb';
    this.setRange(this.volume, d.volume);
    for (const k of Object.keys(this.knobs) as Knob[]) this.setRange(this.knobs[k], d[k]);
    toggle(this.surroundBtn, 'on', d.surround);
    this.surroundBtn.setAttribute('aria-pressed', d.surround ? 'true' : 'false');
    const mix = MIX_STEPS.find(([w]) => w === d.width) ?? MIX_STEPS[0];
    text(this.mixBtn, `ST MIX · ${mix[1]}`);
    toggle(this.mixBtn, 'on', mix[0] !== 1);
    this.presetBtns.forEach((b, i) => {
      const id = d.presets[i];
      const name = id ? this.stations.get(id)?.name : undefined;
      b.title = id ? `${name ?? `Preset ${i + 1}`}: press to tune, hold to save` : `Empty: hold (or Shift+click) to save the station here`;
      b.setAttribute('aria-label', `Preset ${i + 1}${id ? (name ? `: ${name}` : '') : ', empty'}`);
      toggle(b, 'empty', !id);
      toggle(b, 'on', !!id && id === d.stationId && this.status !== 'off');
    });
    this.eqCanvas.hidden = !d.lights;
    this.eq.setVisible(this.visible && d.lights);
    this.audio?.setDsp(d);
    if (d.band === 'fm' && this.visible) this.loadFm();
  }

  /** The journey's destination, for "Local stations near …". */
  setPack(packId: string | undefined): void {
    if (packId === this.currentPack) return;
    this.currentPack = packId;
    if (this.visible) this.loadFm();
  }

  updateAgents(agents: AgentSnapshot[]): void {
    toggle(this.bands.cb, 'alert', agents.some((a) => a.status === 'waiting' || a.status === 'error'));
    const key = JSON.stringify(agents.map((a) => [a.id, a.name, a.role, a.status, a.detail]));
    renderKeyed(this.cbList, key, () => {
      if (!agents.length) {
        this.cbList.append(
          h('p', { class: 'muted' }, 'No agents on the air.'),
          h('p', { class: 'small muted' }, 'Connect Claude Code or another agent with hooks to see your co-pilot here.'),
        );
        return;
      }
      for (const ag of agents) {
        this.cbList.append(
          h(
            'div',
            { class: `station status-${ag.status}` },
            h('span', { class: 'station-role' }, ROLE_LABEL[ag.role] ?? ag.role),
            h('div', { class: 'station-body' }, h('strong', {}, ag.name), h('span', {}, ag.detail ?? STATUS_LABEL[ag.status])),
            h('span', { class: 'station-status' }, STATUS_LABEL[ag.status]),
          ),
        );
      }
    });
  }

  onMusic(music: MusicState): void {
    this.music = music;
    for (const n of music.radio.nowPlaying) if (n.station) this.stations.set(n.stationId, n.station);
    this.renderDisplay();
  }

  onStations(requestId: string, stations: RadioStation[], error?: string): void {
    if (requestId === PRESETS_REQUEST) {
      this.renderList(this.presetList, stations, error, 'No presets.');
      this.applyPrefs();
    } else if (requestId === this.searchRequest) {
      this.renderList(this.results, stations, error, 'No stations found. Try another name, or a #tag such as #jazz.');
    }
  }

  onLocal(packId: string, stations: RadioStation[], error?: string): void {
    if (packId === this.localPack) this.renderList(this.localList, stations, error, 'No local stations found.');
  }

  // ------------------------------------------------------------- the radio

  private power(): void {
    if (this.status === 'off' || this.status === 'error') this.start();
    else this.stop();
  }

  private start(): void {
    const d = this.deckPrefs;
    const id = d.stationId ?? d.presets.find((p): p is string => !!p);
    if (!id) return this.ctx.toast('Pick a station from the list first.');
    this.tune(id);
  }

  private stop(): void {
    window.clearTimeout(this.tuneTimer);
    this.audio?.pause();
    this.status = 'off';
    this.error = '';
    this.sound.deckStopped();
    this.ctx.send({ type: 'radioTune' });
    this.renderDisplay();
    this.applyPrefs();
  }

  private tune(id: string): void {
    if (!this.canPlay) return this.ctx.toast(this.ctx.host?.radioNote ?? 'Internet radio is unavailable here.');
    const station = this.stations.get(id);
    if (station && !canPlayCodec(station.codec)) {
      this.status = 'error';
      this.error = `This station's format (${station.codec}) doesn't play here. Try another.`;
      this.renderDisplay();
      return;
    }
    if (!this.audio) {
      this.audio = this.sound.deck();
      this.audio.onEvent((e) => this.onAudio(e));
    }
    this.update((d) => (d.stationId = id));
    this.ctx.send({ type: 'radioTune', stationId: id });
    this.retried = false;
    this.status = 'tuning';
    this.error = '';
    this.audio.setDsp(this.deckPrefs);
    this.audio.tune(`${this.ctx.host!.radioStreamBase}&station=${encodeURIComponent(id)}`);
    void this.audio.play();
    this.armWatchdog();
    this.renderDisplay();
    this.applyPrefs();
  }

  private step(dir: 1 | -1): void {
    const list = this.deckPrefs.presets.filter((p): p is string => !!p);
    if (!list.length) return;
    const at = list.indexOf(this.deckPrefs.stationId ?? '');
    this.tune(list[(at + dir + list.length) % list.length] ?? list[0]);
  }

  private onAudio(e: DeckEvent): void {
    if (e === 'playing') {
      window.clearTimeout(this.tuneTimer);
      this.status = 'live';
      this.retried = false;
    } else if (e === 'waiting' && this.status !== 'off') {
      this.status = 'tuning';
      this.armWatchdog();
    } else if (e === 'error' && this.status !== 'off') {
      this.fail();
    }
    this.renderDisplay();
    this.applyPrefs();
  }

  private armWatchdog(): void {
    window.clearTimeout(this.tuneTimer);
    this.tuneTimer = window.setTimeout(() => this.status === 'tuning' && this.fail(), TUNE_TIMEOUT_MS);
  }

  /** One quiet retry (stations drop connections), then "Station offline". */
  private fail(): void {
    if (!this.retried && this.audio) {
      this.retried = true;
      void this.audio.play();
      this.armWatchdog();
      return;
    }
    window.clearTimeout(this.tuneTimer);
    this.audio?.pause();
    this.sound.deckStopped();
    this.status = 'error';
    const codec = this.stations.get(this.deckPrefs.stationId ?? '')?.codec;
    this.error = codec && !canPlayCodec(codec) ? `This station's format (${codec}) doesn't play here. Try another.` : 'Station offline. Try another.';
    this.renderDisplay();
    this.applyPrefs();
  }

  // --------------------------------------------------------------- presets

  private presetButton(i: number): HTMLButtonElement {
    const b = h('button', { class: 'deck-preset' }, String(i + 1));
    let timer = 0;
    let held = false;
    b.addEventListener('pointerdown', () => {
      held = false;
      timer = window.setTimeout(() => {
        held = true;
        this.savePreset(i);
      }, HOLD_MS);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => window.clearTimeout(timer));
    b.addEventListener('click', (e) => {
      if (held) return;
      if (e.shiftKey || this.setArmed) return this.savePreset(i);
      const id = this.deckPrefs.presets[i];
      if (id) this.tune(id);
      else this.ctx.toast(`Preset ${i + 1} is empty: tune a station, then hold this button to save it.`);
    });
    return b;
  }

  private savePreset(i: number): void {
    this.armSet(false);
    const id = this.deckPrefs.stationId;
    if (!id) return this.ctx.toast('Tune a station first, then save it to a preset.');
    this.update((d) => (d.presets[i] = id));
    this.ctx.toast(`Saved ${this.stations.get(id)?.name ?? 'the station'} to preset ${i + 1}.`);
  }

  private armSet(on: boolean): void {
    this.setArmed = on;
    toggle(this.setBtn, 'on', on);
    this.setBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  private cycleMix(): void {
    const at = MIX_STEPS.findIndex(([w]) => w === this.deckPrefs.width);
    this.update((d) => (d.width = MIX_STEPS[(at + 1) % MIX_STEPS.length][0]));
  }

  // ----------------------------------------------------------------- lists

  private loadFm(): void {
    if (this.deckPrefs.band !== 'fm' || !this.canPlay) return;
    if (!this.presetsRequested) {
      this.presetsRequested = true;
      this.ctx.send({ type: 'radioSearch', requestId: PRESETS_REQUEST });
    }
    const pack = this.currentPack ? this.ctx.pack(this.currentPack) : undefined;
    text(this.localTitle, pack ? `Local stations near ${pack.region}` : 'Local stations');
    if (!pack) {
      this.localPack = undefined;
      renderKeyed(this.localList, 'none', () => this.localList.append(h('p', { class: 'small muted' }, 'Start a journey to hear stations from where you are driving.')));
      return;
    }
    if (this.localPack === pack.id) return;
    this.localPack = pack.id;
    renderKeyed(this.localList, `loading:${pack.id}`, () => this.localList.append(h('p', { class: 'small muted' }, 'Tuning in local stations…')));
    this.ctx.send({ type: 'radioLocal', packId: pack.id });
  }

  private search(raw: string): void {
    const q = raw.trim();
    if (!q) return;
    if (!this.canPlay) return this.ctx.toast(this.ctx.host?.radioNote ?? 'Internet radio is unavailable here.');
    const requestId = `search-${++this.requestSeq}`;
    this.searchRequest = requestId;
    const tag = q.startsWith('#') ? q.slice(1).trim().toLowerCase().slice(0, 40) : undefined;
    renderKeyed(this.results, requestId, () => this.results.append(h('p', { class: 'small muted' }, 'Searching…')));
    this.ctx.send(tag ? { type: 'radioSearch', requestId, tag, limit: 30 } : { type: 'radioSearch', requestId, query: q.slice(0, 100), limit: 30 });
  }

  private renderList(el: HTMLElement, stations: RadioStation[], error: string | undefined, empty: string): void {
    for (const s of stations) this.stations.set(s.id, s);
    const probe = document.createElement('audio');
    const playable = stations.filter((s) => canPlayCodec(s.codec, probe));
    const hidden = stations.length - playable.length;
    renderKeyed(el, JSON.stringify([error, stations.map((s) => s.id)]), () => {
      if (error) el.append(h('p', { class: 'small deck-error' }, error));
      else if (!playable.length) el.append(h('p', { class: 'small muted' }, hidden ? `${hidden} stations found, but their format doesn't play here.` : empty));
      for (const s of playable) {
        el.append(
          h(
            'button',
            { class: 'deck-row', 'data-station': s.id, title: s.tags.length ? s.tags.join(', ') : s.name, onclick: () => this.tune(s.id) },
            h('strong', {}, s.name),
            h('span', {}, [stationMeta(s), s.tags.slice(0, 2).join(', ')].filter(Boolean).join(' · ')),
          ),
        );
      }
      if (playable.length && hidden) el.append(h('p', { class: 'small muted' }, `${hidden} more in formats that don't play here.`));
    });
    this.markCurrent();
  }

  private markCurrent(): void {
    const id = this.status === 'off' ? undefined : this.deckPrefs.stationId;
    for (const row of this.el.querySelectorAll<HTMLElement>('.deck-row')) {
      const on = row.dataset.station === id;
      toggle(row, 'on', on);
      if (on) row.setAttribute('aria-current', 'true');
      else row.removeAttribute('aria-current');
    }
  }

  // --------------------------------------------------------------- display

  private renderNote(): void {
    const note = this.canPlay ? '' : (this.ctx.host?.radioNote ?? (this.ctx.host ? 'Internet radio is unavailable here.' : ''));
    text(this.note, note);
    this.note.hidden = !note;
    for (const s of this.fmBody.querySelectorAll<HTMLElement>('.deck-section, .deck-credit')) s.hidden = !this.canPlay;
    this.powerBtn.disabled = this.playBtn.disabled = !this.canPlay;
  }

  private renderDisplay(): void {
    const d = this.deckPrefs;
    const id = d.stationId;
    const now: NowPlaying | undefined = id ? this.music?.radio.nowPlaying.find((n) => n.stationId === id) : undefined;
    const station = (id && this.stations.get(id)) || now?.station;
    const presetIndex = id ? d.presets.indexOf(id) : -1;
    text(this.stationEl, station?.name ?? (presetIndex >= 0 ? `Preset ${presetIndex + 1}` : 'VibeTour Radio'));
    let line: string;
    if (!this.canPlay) line = 'FM is off on this screen';
    else if (this.status === 'error') line = this.error;
    else if (this.status === 'tuning') line = 'Tuning…';
    else if (this.status === 'live') line = now?.title || 'Live';
    else line = id ? 'Press Power to resume' : 'Press Power, or pick a station';
    text(this.titleEl, line);
    text(this.metaEl, this.status === 'off' ? '' : stationMeta(station));
    this.live.className = `deck-live is-${this.status}`;
    text(this.live.querySelector('b')!, { off: 'OFF', tuning: '···', live: 'LIVE', error: 'NO SIGNAL' }[this.status]);
    toggle(this.powerBtn, 'on', this.status !== 'off');
    this.powerBtn.setAttribute('aria-pressed', this.status !== 'off' ? 'true' : 'false');
    const playing = this.status === 'live' || this.status === 'tuning';
    text(this.playBtn, playing ? '❚❚' : '▶');
    this.playBtn.title = playing ? 'Stop' : 'Play';
    this.playBtn.setAttribute('aria-label', this.playBtn.title);
    this.renderNote();
    this.markCurrent();
  }

  // --------------------------------------------------------------- helpers

  private watch(watching: boolean): void {
    if (this.canPlay) this.ctx.send({ type: 'musicWatch', watching });
  }

  private update(change: (d: DeckPrefs) => void): void {
    this.ctx.updatePrefs((p) => change(p.deck));
  }

  /** A slider that plays live while dragged and saves on release. */
  private range(cls: string, label: string, min: number, max: number, step: number, change: (v: number) => (d: DeckPrefs) => void): HTMLInputElement {
    const input = h('input', { type: 'range', class: cls, min, max, step, 'aria-label': label });
    input.addEventListener('pointerdown', () => this.dragging.add(input));
    for (const ev of ['pointerup', 'pointercancel']) input.addEventListener(ev, () => queueMicrotask(() => this.dragging.delete(input)));
    input.addEventListener('input', () => {
      const live = structuredClone(this.deckPrefs);
      change(Number(input.value))(live);
      this.audio?.setDsp(live);
    });
    input.addEventListener('change', () => {
      this.dragging.delete(input);
      this.update(change(Number(input.value)));
    });
    return input;
  }

  private setRange(input: HTMLInputElement, value: number): void {
    if (this.dragging.has(input)) return;
    if (input.value !== String(value)) input.value = String(value);
  }
}
