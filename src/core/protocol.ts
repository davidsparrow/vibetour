import type { ActivityState } from './activity';
import type { AgentStatus, AgentRole, ProcessKind } from './events';
import type { LocationInfo, ScopeId, ScopeInfo } from './journey';
import type { Moment } from './moments';
import { isStationId, normalizeDeck, type DeckPrefs, type MusicState, type RadioStation } from './music';
import type { Behavior, JourneyPhase, StopReason } from './motion';
import type { EnvParams, JourneyPack, Mood, SceneKind, TimeOfDay, Weather } from './packs';
import type { LibraryEntry, PassportStats, Stamp, TravelMemory } from './passport';
import type { HistoryKind, ResultInfo, SessionCounters } from './workspace';

/**
 * Messages between a VibeTour host (VS Code extension, standalone CLI, or the
 * in-browser demo) and its displays (webview panel, companion browser tabs).
 * Snapshots carry metadata only; privacy redaction is applied host-side.
 */

export type DisplayMode = 'tour' | 'dashboard' | 'work';
export type Gear = 'P' | 'R' | 'N' | 'D';

export interface JourneySnapshot {
  id: string;
  packId: string;
  variantId: string;
  scope: ScopeId;
  scopeLabel: string;
  objective?: string;
  progress: number;
  phase: JourneyPhase;
  scene: { id: string; index: number; kind: SceneKind; label: string };
  env: EnvParams;
  location: LocationInfo;
  timeOfDay: TimeOfDay;
  arrivalTimeOfDay?: TimeOfDay;
  weather: Weather;
  travelMs: number;
  productiveMs: number;
  sessions: number;
  createdAt: number;
  arrivedAt?: number;
  stats: SessionCounters & { filesChanged: number; activeMs: number; agentMs: number };
}

export interface AgentSnapshot {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  detail?: string;
  since: number;
  parentId?: string;
  context?: number;
}

export interface TourSnapshot {
  v: 1;
  at: number;
  journey: JourneySnapshot | null;
  motion: {
    behavior: Behavior;
    targetSpeed: number;
    stopped: boolean;
    stopReason?: StopReason;
    stopName?: string;
    caption: string;
    since: number;
    hazard: boolean;
  };
  activity: {
    state: ActivityState;
    basis: ActivityState;
    since: number;
    gear: Gear;
    devActivity: number;
    agentActivity: number;
    errorIntensity: number;
    checkEngine: { on: boolean; reason?: string };
    warning: boolean;
    reviewing: boolean;
    context: number | null;
    waitingAgent?: string;
    blockedReason?: string;
    /** The agent whose finished turn makes it your move. */
    yourTurnAgent?: string;
  };
  /** Every moment that holds right now, in signal-map order. Displays map them to cues. */
  moments: Moment[];
  ide: {
    project?: string;
    activeFile?: { name: string; path?: string; language?: string };
    git?: {
      branch?: string;
      repo?: string;
      changes: number;
      staged: number;
      ahead: number;
      behind: number;
      lastCommit?: { message?: string; at: number };
    };
    diagnostics: {
      errors: number;
      warnings: number;
      top: Array<{ file: string; path?: string; line: number; severity: 'error' | 'warning'; message: string }>;
    };
    processes: Array<{ id: string; kind: ProcessKind; label: string; startedAt: number }>;
    results: Partial<Record<'test' | 'build' | 'lint', ResultInfo>>;
    agents: AgentSnapshot[];
    history: Array<{ at: number; kind: HistoryKind; label: string; tone: 'good' | 'bad' | 'neutral' | 'agent' }>;
    session: SessionCounters & { filesChanged: number; startedAt: number };
  };
  privacy: { streaming: boolean };
  /** Text for screen readers when the situation meaningfully changes. */
  announce?: string;
}

export interface ActiveJourneySummary {
  id: string;
  packId: string;
  title: string;
  subtitle: string;
  scope: ScopeId;
  phase: JourneyPhase;
  progress: number;
  sessions: number;
}

export interface Catalog {
  packs: JourneyPack[];
  scopes: ScopeInfo[];
  library: LibraryEntry[];
  stamps: Stamp[];
  passport: PassportStats;
  /** "You last visited Big Sur while building Atlas" (PRD §67). */
  memory?: TravelMemory;
  activeJourney: ActiveJourneySummary | null;
  /** Stamp earned by the most recent arrival, for the arrival card. */
  lastStampId?: string;
}

export interface HostInfo {
  kind: 'vscode' | 'companion' | 'cli' | 'demo';
  version: string;
  projectName?: string;
  companionUrl?: string;
  capabilities: { openFiles: boolean; openDocs: boolean; saveFiles: boolean; focusIde: boolean; radio: boolean };
  /** Where this display loads radio streams: `<base>&station=<id>`. Absent without radio. */
  radioStreamBase?: string;
  /** Why there is no radio on this display, in a sentence. */
  radioNote?: string;
}

export interface AudioPrefs {
  enabled: boolean;
  master: number;
  engine: number;
  road: number;
  wind: number;
  weather: number;
  ambience: number;
  music: number;
}

export interface ClientPrefs {
  mode: DisplayMode;
  reducedMotion: boolean;
  staticScenery: boolean;
  noCameraMotion: boolean;
  noWeather: boolean;
  highContrast: boolean;
  uiScale: number;
  fps: 30 | 60;
  lowGpu: boolean;
  autoThrottle: boolean;
  /** Show a gauge for how much of the agent's context window is left. */
  contextGauge: boolean;
  /** Show a gauge for this computer's battery, where the browser reports one. */
  batteryGauge: boolean;
  /** Dashboard cue for the your-turn moment on this display. */
  yourTurnCue: 'none' | 'light';
  captureIncludeProject: boolean;
  audio: AudioPrefs;
  /** The car radio's band, station, tone controls and presets. */
  deck: DeckPrefs;
}

export const DEFAULT_PREFS: ClientPrefs = {
  mode: 'dashboard',
  reducedMotion: false,
  staticScenery: false,
  noCameraMotion: false,
  noWeather: false,
  highContrast: false,
  uiScale: 1,
  fps: 60,
  lowGpu: false,
  autoThrottle: true,
  contextGauge: true,
  batteryGauge: false,
  yourTurnCue: 'none',
  captureIncludeProject: false,
  audio: { enabled: false, master: 0.6, engine: 0.5, road: 0.5, wind: 0.4, weather: 0.6, ambience: 0.6, music: 0.35 },
  deck: normalizeDeck(undefined),
};

export function mergePrefs(saved: Partial<ClientPrefs> | undefined): ClientPrefs {
  return {
    ...DEFAULT_PREFS,
    ...(saved ?? {}),
    audio: { ...DEFAULT_PREFS.audio, ...(saved?.audio ?? {}) },
    deck: normalizeDeck({ ...DEFAULT_PREFS.deck, ...(saved?.deck ?? {}) }),
  };
}

export type HostMessage =
  | { type: 'hello'; host: HostInfo; catalog: Catalog; prefs?: Partial<ClientPrefs> }
  | { type: 'snapshot'; snapshot: TourSnapshot }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'setMode'; mode: DisplayMode }
  | { type: 'show'; view: 'picker' | 'passport' | 'settings' | 'capture' | 'radio' }
  | { type: 'toast'; text: string }
  | { type: 'music'; music: MusicState }
  | { type: 'radioStations'; requestId: string; stations: RadioStation[]; error?: string }
  | { type: 'radioLocal'; packId: string; stations: RadioStation[]; error?: string };

export type ClientCommand =
  | { type: 'ready' }
  | { type: 'startJourney'; packId: string; variantId?: string; scope: ScopeId; objective?: string }
  | { type: 'saveTicket'; packId: string; saved: boolean }
  | { type: 'toggleFavorite'; packId: string }
  | { type: 'completeObjective' }
  | { type: 'setObjective'; objective: string }
  | { type: 'park' }
  | { type: 'resume' }
  | { type: 'stay' }
  | { type: 'endJourney' }
  | { type: 'refuel' }
  | { type: 'saveMemory'; stampId: string; note: string }
  | { type: 'openDocs' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'focusIde' }
  | { type: 'savePrefs'; prefs: ClientPrefs }
  | { type: 'saveCapture'; dataUrl: string; fileName: string }
  /** No query, country or tag: the curated presets. */
  | { type: 'radioSearch'; requestId: string; query?: string; countryCode?: string; tag?: string; limit?: number }
  | { type: 'radioLocal'; packId: string }
  /** The display tuned in (or stopped, without a station): the host counts the click. */
  | { type: 'radioTune'; stationId?: string }
  /** The display shows the radio and wants `music` messages; sent again every 10 s while it does. */
  | { type: 'musicWatch'; watching: boolean };

export const MOOD_LABELS: Record<Mood | 'anywhere' | 'surprise', string> = {
  anywhere: 'Anywhere',
  warm: 'Somewhere Warm',
  mountains: 'Mountains',
  'city-night': 'City at Night',
  ocean: 'Ocean',
  rain: 'Rain',
  quiet: 'Quiet',
  fantasy: 'Off-World',
  surprise: 'Surprise Me Completely',
};

const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const SCOPE_IDS = ['coffee-run', 'day-trip', 'scenic-drive', 'road-trip', 'expedition', 'free-drive'];

/** Validates a command from an untrusted display (e.g. a companion browser tab). */
export function isClientCommand(raw: unknown): raw is ClientCommand {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'ready':
    case 'completeObjective':
    case 'park':
    case 'resume':
    case 'stay':
    case 'endJourney':
    case 'refuel':
    case 'openDocs':
    case 'focusIde':
      return true;
    case 'startJourney':
      return (
        isStr(c.packId, 64) &&
        typeof c.scope === 'string' &&
        SCOPE_IDS.includes(c.scope) &&
        (c.variantId === undefined || isStr(c.variantId, 64)) &&
        (c.objective === undefined || isStr(c.objective, 500))
      );
    case 'saveTicket':
      return isStr(c.packId, 64) && typeof c.saved === 'boolean';
    case 'toggleFavorite':
      return isStr(c.packId, 64);
    case 'setObjective':
      return isStr(c.objective, 500);
    case 'saveMemory':
      return isStr(c.stampId, 100) && isStr(c.note, 2000);
    case 'openFile':
      return isStr(c.path, 1024) && (c.line === undefined || (Number.isInteger(c.line) && (c.line as number) >= 0));
    case 'savePrefs':
      return !!c.prefs && typeof c.prefs === 'object' && !Array.isArray(c.prefs);
    case 'saveCapture':
      return isStr(c.dataUrl, 20_000_000) && (c.dataUrl as string).startsWith('data:image/png;base64,') && isStr(c.fileName, 200);
    case 'radioSearch':
      return (
        isStr(c.requestId, 64) &&
        (c.query === undefined || isStr(c.query, 100)) &&
        (c.countryCode === undefined || (typeof c.countryCode === 'string' && /^[A-Z]{2}$/.test(c.countryCode))) &&
        (c.tag === undefined || isStr(c.tag, 40)) &&
        (c.limit === undefined || (Number.isInteger(c.limit) && (c.limit as number) >= 1 && (c.limit as number) <= 50))
      );
    case 'radioLocal':
      return isStr(c.packId, 64);
    case 'radioTune':
      return c.stationId === undefined || isStationId(c.stationId);
    case 'musicWatch':
      return typeof c.watching === 'boolean';
    default:
      return false;
  }
}
