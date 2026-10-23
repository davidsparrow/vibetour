import type { ActivityState } from './activity';
import { ALERT_KINDS, severityOf, type AlertKind, type AlertSeverity, type Attention } from './attention';
import type { AgentAsk, AgentStatus, AgentRole, BranchRef, ProcessKind, PullRequestFeedState } from './events';
import type { LocationInfo, ScopeId, ScopeInfo } from './journey';
import type { Moment } from './moments';
import { isStationId, normalizeDeck, type DeckPrefs, type MusicState, type RadioStation } from './music';
import type { Behavior, JourneyPhase, StopReason } from './motion';
import type { EnvParams, JourneyPack, Mood, SceneKind, TimeOfDay, Weather } from './packs';
import type { LibraryEntry, PassportStats, Stamp, TravelMemory } from './passport';
import type { CacheSnapshot, HistoryKind, ResultInfo, SessionCounters } from './workspace';

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
  /** The session's prompt cache, when the agent reports it. */
  cache?: CacheSnapshot;
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
    /** The attention id of the alert that stopped the car, if one did: it rides on the stop card. */
    stopAlert?: string;
  };
  activity: {
    state: ActivityState;
    basis: ActivityState;
    since: number;
    gear: Gear;
    devActivity: number;
    agentActivity: number;
    /** Agents at work right now, the main agent and its crew. */
    agentsWorking: number;
    /** Tool calls and commands started in the last minute. */
    toolCalls: number;
    errorIntensity: number;
    checkEngine: { on: boolean; reason?: string };
    warning: boolean;
    reviewing: boolean;
    context: number | null;
    /** The prompt cache of the session the Context gauge shows. */
    cache: CacheSnapshot | null;
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
      /** The changed files, repository-relative. Hidden in streaming mode. */
      files?: string[];
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
    /** The local branches with commits main lacks, and the one checked out, from Git. */
    branches?: {
      /** What they're compared with, e.g. `main`. */
      base: string;
      count: number;
      /** How many have commits main lacks: the checkout may have none. */
      unmerged: number;
      /** Hidden in streaming mode; the counts still show. */
      items?: BranchRef[];
    };
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
    /** Internet radio on the FM band. */
    radio: boolean;
  };
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
  /** The prompt cache's dots beside the gear turn orange: the hit share under this percent… */
  cacheHitWarn: number;
  /** …and the time until it goes cold under this many minutes. */
  cacheTimerWarn: number;
  /** Show this computer's battery as a stack of lights, where the browser reports one. */
  batteryGauge: boolean;
  /** Show a gauge for the files changed and not yet committed. */
  changesGauge: boolean;
  /** The bell colour each thing in the Alerts tab lights on this display. Off hides an alert; files, PRs and branches still show. */
  bells: Record<BellItem, BellTone>;
  captureIncludeProject: boolean;
  audio: AudioPrefs;
  /** The car radio's band, station, tone controls and presets. */
  deck: DeckPrefs;
}

/** Everything in the Alerts tab that can light the bells: each kind of alert, then the changed files, open PRs and branches. */
export const BELL_ITEMS = [...ALERT_KINDS, 'changes', 'openPrs', 'branches'] as const;
export type BellItem = (typeof BELL_ITEMS)[number];
/** The bell colour a thing lights: red (blocking), orange (moderate), blue (general), or none. */
export type BellTone = AlertSeverity | 'off';
const BELL_TONES: readonly BellTone[] = ['off', 'general', 'moderate', 'blocking'];

/**
 * Each alert lights its own colour, uncommitted files blue. Open PRs and
 * branches ahead of main are nearly always there, so they light nothing
 * until the driver picks a colour for them.
 */
export const DEFAULT_BELLS: Readonly<Record<BellItem, BellTone>> = {
  ...(Object.fromEntries(ALERT_KINDS.map((k) => [k, severityOf(k)])) as Record<AlertKind, BellTone>),
  changes: 'general',
  openPrs: 'off',
  branches: 'off',
};

/** Before the bell colours, each kind of alert had an on/off switch, and changed files one more. */
interface LegacyAlertPrefs {
  hudAlerts?: Partial<Record<AlertKind, boolean>>;
  alertOnChanges?: boolean;
}

/** Saved bell colours over the defaults; a display's prefs are untrusted, so anything else keeps its default. */
function mergeBells(saved: (Partial<ClientPrefs> & LegacyAlertPrefs) | undefined): Record<BellItem, BellTone> {
  const bells = { ...DEFAULT_BELLS };
  for (const k of ALERT_KINDS) if (saved?.hudAlerts?.[k] === false) bells[k] = 'off';
  if (saved?.alertOnChanges === false) bells.changes = 'off';
  const chosen: Record<string, unknown> = saved?.bells && typeof saved.bells === 'object' ? saved.bells : {};
  for (const k of BELL_ITEMS) if (BELL_TONES.includes(chosen[k] as BellTone)) bells[k] = chosen[k] as BellTone;
  return bells;
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
  cacheHitWarn: 50,
  cacheTimerWarn: 15,
  batteryGauge: true,
  changesGauge: true,
  bells: { ...DEFAULT_BELLS },
  captureIncludeProject: false,
  audio: { enabled: false, master: 0.6, engine: 0.5, road: 0.5, wind: 0.4, weather: 0.6, ambience: 0.6, music: 0.35 },
  deck: normalizeDeck(undefined),
};

export function mergePrefs(saved: (Partial<ClientPrefs> & LegacyAlertPrefs) | undefined): ClientPrefs {
  // Prefs saved before the battery became a stack of lights (they have no cache warnings yet) kept the old
  // dial's default, off: the lights take their own default, on.
  const { batteryGauge, hudAlerts: _hudAlerts, alertOnChanges: _alertOnChanges, ...rest } = saved ?? {};
  return {
    ...DEFAULT_PREFS,
    ...rest,
    ...(batteryGauge !== undefined && saved?.cacheHitWarn !== undefined ? { batteryGauge } : {}),
    audio: { ...DEFAULT_PREFS.audio, ...(saved?.audio ?? {}) },
    bells: mergeBells(saved),
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
  | { type: 'focusAgent'; agentId?: string }
  | { type: 'openSourceControl' }
  | { type: 'openProblems' }
  | { type: 'openPullRequest'; number: number }
  /** Open GitHub's comparison of this branch with main. */
  | { type: 'openBranchCompare'; branch: string }
  | { type: 'connectGitHub' }
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

/** A name Git would accept for a branch, and that can never be read as a command-line option. */
export function isBranchName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !name.startsWith('-') && !/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|^\/|\/$|\.lock$|\.$/.test(name);
}

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
    case 'openProblems':
    case 'connectGitHub':
      return true;
    case 'focusAgent':
      return c.agentId === undefined || isStr(c.agentId, 120);
    case 'openPullRequest':
      return Number.isInteger(c.number) && (c.number as number) > 0;
    case 'openBranchCompare':
      return isBranchName(c.branch);
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
