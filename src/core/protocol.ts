import type { ActivityState } from './activity';
import type { AgentStatus, AgentRole, ProcessKind } from './events';
import type { LocationInfo, ScopeId, ScopeInfo } from './journey';
import type { Behavior, JourneyPhase } from './motion';
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
    stopReason?: 'idle' | 'waiting' | 'blocked';
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
  };
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
  capabilities: { openFiles: boolean; openDocs: boolean; saveFiles: boolean; focusIde: boolean };
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
  fuel: 'journey' | 'context' | 'battery';
  captureIncludeProject: boolean;
  audio: AudioPrefs;
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
  fuel: 'journey',
  captureIncludeProject: false,
  audio: { enabled: false, master: 0.6, engine: 0.5, road: 0.5, wind: 0.4, weather: 0.6, ambience: 0.6, music: 0.35 },
};

export function mergePrefs(saved: Partial<ClientPrefs> | undefined): ClientPrefs {
  return {
    ...DEFAULT_PREFS,
    ...(saved ?? {}),
    audio: { ...DEFAULT_PREFS.audio, ...(saved?.audio ?? {}) },
  };
}

export type HostMessage =
  | { type: 'hello'; host: HostInfo; catalog: Catalog; prefs?: Partial<ClientPrefs> }
  | { type: 'snapshot'; snapshot: TourSnapshot }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'setMode'; mode: DisplayMode }
  | { type: 'show'; view: 'picker' | 'passport' | 'settings' | 'capture' }
  | { type: 'toast'; text: string };

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
  | { type: 'saveMemory'; stampId: string; note: string }
  | { type: 'openDocs' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'focusIde' }
  | { type: 'savePrefs'; prefs: ClientPrefs }
  | { type: 'saveCapture'; dataUrl: string; fileName: string };

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

export function isClientCommand(raw: unknown): raw is ClientCommand {
  if (!raw || typeof raw !== 'object') return false;
  const t = (raw as { type?: unknown }).type;
  return (
    typeof t === 'string' &&
    [
      'ready',
      'startJourney',
      'saveTicket',
      'toggleFavorite',
      'completeObjective',
      'setObjective',
      'park',
      'resume',
      'stay',
      'endJourney',
      'saveMemory',
      'openDocs',
      'openFile',
      'focusIde',
      'savePrefs',
      'saveCapture',
    ].includes(t)
  );
}
