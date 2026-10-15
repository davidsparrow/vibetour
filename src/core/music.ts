/**
 * The car radio (Cockpit › Radio): internet radio on the FM band, your agents
 * on CB. Host-agnostic types shared by the hosts (which proxy the streams)
 * and the displays (which play them through Web Audio).
 */

export type DeckBand = 'fm' | 'cb';

/** A station as displays see it. Stream URLs never leave the host: displays only know the id. */
export interface RadioStation {
  /** `soma:<channel>` for the curated presets, `rb:<uuid>` for the Radio Browser directory. */
  id: string;
  name: string;
  codec?: string;
  bitrate?: number;
  countryCode?: string;
  country?: string;
  tags: string[];
  homepage?: string;
  source: 'preset' | 'directory';
}

export interface NowPlaying {
  stationId: string;
  station?: RadioStation;
  /** The song, from the stream's ICY metadata. */
  title?: string;
  at: number;
}

export interface MusicState {
  at: number;
  /** One entry per station a display is playing. */
  radio: { nowPlaying: NowPlaying[]; streams: number };
}

/** What the equalizer lights show, measured from the audio (all 0..1). */
export interface MusicLevels {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  /** 1 on a bass-drum hit, decaying to 0. */
  beat: number;
  playing: boolean;
  bands: number[];
}

export const EQ_BANDS = 12;
export const PRESET_COUNT = 6;

export interface DeckPrefs {
  band: DeckBand;
  /** The station the deck was last tuned to. */
  stationId?: string;
  volume: number;
  /** Shelf gains in dB, -12..12. */
  bass: number;
  treble: number;
  /** -1 rear .. 1 front. */
  fader: number;
  /** -1 left .. 1 right. */
  balance: number;
  /** Stereo mix: 0 mono, 1 stereo, 1.5 wide. */
  width: number;
  surround: boolean;
  /** Show the equalizer lights. */
  lights: boolean;
  /** Station ids on preset buttons 1–6. */
  presets: Array<string | null>;
}

export const DEFAULT_DECK: DeckPrefs = {
  band: 'fm',
  volume: 0.7,
  bass: 0,
  treble: 0,
  fader: 0,
  balance: 0,
  width: 1,
  surround: false,
  lights: true,
  presets: ['soma:groovesalad', 'soma:dronezone', 'soma:spacestation', 'soma:lush', 'soma:secretagent', 'soma:bootliquor'],
};

const STATION_ID = /^(soma|rb):[\w-]{1,64}$/;

export function isStationId(v: unknown): v is string {
  return typeof v === 'string' && STATION_ID.test(v);
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Fills defaults and clamps every field, so stored prefs from any display are safe to use. */
export function normalizeDeck(raw: unknown): DeckPrefs {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const presets = Array.isArray(d.presets) ? d.presets : DEFAULT_DECK.presets;
  return {
    band: d.band === 'cb' ? 'cb' : 'fm',
    ...(isStationId(d.stationId) ? { stationId: d.stationId } : {}),
    volume: clampNum(d.volume, 0, 1, DEFAULT_DECK.volume),
    bass: clampNum(d.bass, -12, 12, 0),
    treble: clampNum(d.treble, -12, 12, 0),
    fader: clampNum(d.fader, -1, 1, 0),
    balance: clampNum(d.balance, -1, 1, 0),
    width: clampNum(d.width, 0, 1.5, 1),
    surround: d.surround === true,
    lights: d.lights !== false,
    presets: Array.from({ length: PRESET_COUNT }, (_, i) => (isStationId(presets[i]) ? (presets[i] as string) : null)),
  };
}
