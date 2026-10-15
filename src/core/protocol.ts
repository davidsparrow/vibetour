import type { ActivityState } from './activity';
import { ALERT_KINDS, type AlertKind, type Attention } from './attention';
import type { AgentAsk, AgentStatus, AgentRole, ProcessKind, PullRequestFeedState } from './events';
import type { LocationInfo, ScopeId, ScopeInfo } from './journey';
import type { Moment } from './moments';
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
  /** While waiting: what for. */
  ask?: AgentAsk;
  /** While waiting for approval: the tool. Hidden in streaming mode. */
  tool?: string;
  since: number;
  parentId?: string;
  context?: number;
}

export interface PullRequestSnapshot {
  number: number;
  /** Hidden in streaming mode, like the branch and the author. */
  title?: string;
  branch?: string;
  author?: string;
  draft: boolean;
  createdAt: number;
  ahead?: number;
  behind?: number;
  ci: 'passing' | 'failing' | 'pending' | 'none';
  review: 'approved' | 'changes-requested' | 'review-required' | 'none';
  conflict: boolean;
  /** Its branch is the one checked out here. */
  onBranch: boolean;
  /** The signed-in GitHub user opened it. */
  mine: boolean;
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
    /** Why the car stopped for the waiting agent: a question, a plan or an approval. */
    waitingAsk?: AgentAsk;
    /** The tool the waiting agent wants approved. Hidden in streaming mode. */
    waitingTool?: string;
    blockedReason?: string;
    /** The blocking agent's own words, e.g. "Stopped: rate limit". Hidden in streaming mode. */
    blockedDetail?: string;
    /** The agent whose finished turn makes it your move. */
    yourTurnAgent?: string;
  };
  /** Every moment that holds right now, in signal-map order. Displays map them to cues. */
  moments: Moment[];
  /** What needs you right now, most urgent first. Displays show the kinds their driver switched on. */
  attention: Attention[];
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
    /** The repository's open pull requests, once the user connects GitHub. */
    pullRequests: { state: PullRequestFeedState; items: PullRequestSnapshot[]; fetchedAt?: number };
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
  capabilities: {
    openFiles: boolean;
    openDocs: boolean;
    saveFiles: boolean;
    focusIde: boolean;
    /** Bring up the agent that needs you: its terminal, else the editor. */
    focusAgent?: boolean;
    /** Open the editor's Source Control view. */
    openScm?: boolean;
    /** Open a pull request in the browser. */
    openLinks?: boolean;
    /** Ask the user to connect GitHub for the PR list. */
    connectGitHub?: boolean;
  };
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
  /** Show a gauge for the files changed and not yet committed. */
  changesGauge: boolean;
  /** Dashboard cue for the your-turn moment on this display. */
  yourTurnCue: 'none' | 'light';
  /** Which kinds of HUD alert this display shows. */
  hudAlerts: Record<AlertKind, boolean>;
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
  contextGauge: true,
  batteryGauge: false,
  changesGauge: true,
  yourTurnCue: 'none',
  hudAlerts: Object.fromEntries(ALERT_KINDS.map((k) => [k, true])) as Record<AlertKind, boolean>,
  captureIncludeProject: false,
  audio: { enabled: false, master: 0.6, engine: 0.5, road: 0.5, wind: 0.4, weather: 0.6, ambience: 0.6, music: 0.35 },
};

export function mergePrefs(saved: Partial<ClientPrefs> | undefined): ClientPrefs {
  return {
    ...DEFAULT_PREFS,
    ...(saved ?? {}),
    audio: { ...DEFAULT_PREFS.audio, ...(saved?.audio ?? {}) },
    hudAlerts: { ...DEFAULT_PREFS.hudAlerts, ...(saved?.hudAlerts ?? {}) },
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
  | { type: 'refuel' }
  | { type: 'saveMemory'; stampId: string; note: string }
  | { type: 'openDocs' }
  | { type: 'openFile'; path: string; line?: number }
  | { type: 'focusIde' }
  | { type: 'focusAgent'; agentId?: string }
  | { type: 'openSourceControl' }
  | { type: 'openPullRequest'; number: number }
  | { type: 'connectGitHub' }
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
    case 'openSourceControl':
    case 'connectGitHub':
      return true;
    case 'focusAgent':
      return c.agentId === undefined || isStr(c.agentId, 120);
    case 'openPullRequest':
      return Number.isInteger(c.number) && (c.number as number) > 0;
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
    default:
      return false;
  }
}
