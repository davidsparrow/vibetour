import { ActivityEngine, DEFAULT_ACTIVITY_CONFIG, type ActivityConfig, type ActivityReading } from './activity';
import type { DevEvent, ProcessKind } from './events';
import { JourneyEngine, SCOPES, scopeInfo, type JourneyRecord, type ScopeId } from './journey';
import { DEFAULT_MOTION_CONFIG, MotionController, type MotionConfig, type MotionReading } from './motion';
import { findVariant, planPath, rng, variantForHour, type JourneyPack } from './packs';
import { makeStamp, passportStats, updateLibrary, type LibraryEntry, type Stamp, type TravelMemory } from './passport';
import type { Catalog, ClientCommand, Gear, JourneySnapshot, TourSnapshot } from './protocol';
import { WorkspaceTracker, type HistoryItem } from './workspace';

/**
 * VibeTourSession composes the Activity, Motion and Journey engines with the
 * State Store (PRD §17). It is host-agnostic: the VS Code extension, the
 * standalone CLI and the browser demo all drive the same session.
 */

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly data = new Map<string, string>();
  get<T>(key: string): T | undefined {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  set(key: string, value: unknown): void {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, JSON.stringify(value));
  }
}

export const KEYS = {
  journey: 'vibetour.journey',
  stamps: 'vibetour.stamps',
  library: 'vibetour.library',
  memories: 'vibetour.memories',
} as const;

export interface SessionOptions {
  packs: JourneyPack[];
  /** Cross-project state: passport, library, memories. */
  globalStore: KeyValueStore;
  /** Per-project state: the persistent journey (PRD §11 Project Journey). */
  projectStore: KeyValueStore;
  project?: string;
  now?: () => number;
  newId?: () => string;
  streaming?: boolean;
  /** Resume a journey parked by closing the app as soon as work starts. */
  autoResume?: boolean;
  activityConfig?: ActivityConfig;
  motionConfig?: MotionConfig;
}

type PersistedJourney = JourneyRecord & { parkedBy?: 'user' | 'close' };

const MAX_TICK_MS = 5_000;
const SAVE_EVERY_MS = 10_000;
const AGENT_EXPIRY_MS = 15 * 60_000;

const KIND_LABEL: Record<ProcessKind, string> = {
  test: 'Tests',
  build: 'Build',
  lint: 'Checks',
  install: 'Install',
  run: 'App',
  agent: 'Agent',
  git: 'Git',
  other: 'Command',
};

function defaultId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export class VibeTourSession {
  readonly packs: Map<string, JourneyPack>;
  private readonly now: () => number;
  private readonly newId: () => string;
  private tracker: WorkspaceTracker;
  private activity: ActivityEngine;
  private motion: MotionController;
  private journey?: JourneyEngine;
  private parkedBy?: 'user' | 'close';
  private lastTick: number;
  private lastSave = 0;
  private readonly sessionStartedAt: number;
  private lastCaption = '';
  private stopName?: string;
  private stopKey?: string;
  private lastStampId?: string;
  private streaming: boolean;
  private autoResume: boolean;
  private readonly listeners = new Set<(s: TourSnapshot) => void>();
  private readonly catalogListeners = new Set<(c: Catalog) => void>();
  private latest?: TourSnapshot;

  constructor(private readonly opts: SessionOptions) {
    this.packs = new Map(opts.packs.map((p) => [p.id, p]));
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? defaultId;
    this.streaming = !!opts.streaming;
    this.autoResume = opts.autoResume !== false;
    const now = this.now();
    this.lastTick = now;
    this.sessionStartedAt = now;
    this.tracker = new WorkspaceTracker();
    this.activity = new ActivityEngine(this.tracker, now, opts.activityConfig ?? DEFAULT_ACTIVITY_CONFIG);
    this.motion = new MotionController(now, opts.motionConfig ?? DEFAULT_MOTION_CONFIG);
    this.wireTracker();
    this.restoreJourney();
  }

  // ---------------------------------------------------------------- events

  ingest(event: DevEvent): void {
    this.tracker.ingest(event);
    this.activity.ingest(event);
    const productive =
      event.type === 'editor.edit' || event.type === 'editor.save' || event.type === 'fs.external' || (event.type === 'agent' && (event.status === 'working' || event.status === 'tool'));
    if (productive && this.journey?.phase === 'parked' && this.parkedBy === 'close' && this.autoResume) {
      this.resume();
    }
  }

  onSnapshot(listener: (s: TourSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onCatalog(listener: (c: Catalog) => void): () => void {
    this.catalogListeners.add(listener);
    return () => this.catalogListeners.delete(listener);
  }

  setStreaming(on: boolean): void {
    this.streaming = on;
    this.emitCatalog();
  }

  setAutoResume(on: boolean): void {
    this.autoResume = on;
  }

  get latestSnapshot(): TourSnapshot | undefined {
    return this.latest;
  }

  get activeJourney(): JourneyRecord | undefined {
    return this.journey?.record;
  }

  // -------------------------------------------------------------- commands

  startJourney(packId: string, scope: ScopeId, variantId?: string, objective?: string): boolean {
    const pack = this.packs.get(packId);
    if (!pack) return false;
    const now = this.now();
    const resolvedVariant = variantId === 'local' ? variantForHour(pack, new Date(now).getHours()).id : variantId;
    this.journey = JourneyEngine.create(pack, {
      id: this.newId(),
      scope: SCOPES.some((s) => s.id === scope) ? scope : 'day-trip',
      variantId: resolvedVariant,
      objective,
      project: this.opts.project,
      now,
    });
    this.parkedBy = undefined;
    this.lastStampId = undefined;
    this.tracker.lastUserInputAt = now;
    this.motion.force('cruise', now);
    this.rememberVisit(pack);
    this.updateLibraryEntry(pack.id, (e) => {
      e.lastVisitedAt = now;
      e.saved = false;
    });
    this.persist(true);
    this.emitCatalog();
    this.tick();
    return true;
  }

  completeObjective(): void {
    if (!this.journey) return;
    this.parkedBy = undefined;
    if (this.journey.completeObjective(this.now())) {
      this.motion.force('approach', this.now());
      this.persist(true);
      this.tick();
    }
  }

  setObjective(objective: string): void {
    if (!this.journey) return;
    this.journey.record.objective = objective.trim().slice(0, 140) || undefined;
    this.persist(true);
    this.tick();
  }

  park(by: 'user' | 'close' = 'user'): void {
    if (!this.journey) return;
    const phase = this.journey.phase;
    if (phase === 'arrived' || phase === 'staying') return;
    this.journey.park(this.now());
    this.parkedBy = by;
    this.motion.force('parked', this.now());
    this.persist(true);
    this.emitCatalog();
    this.tick();
  }

  resume(): void {
    if (!this.journey || this.journey.phase !== 'parked') return;
    this.journey.resume(this.now());
    this.tracker.lastUserInputAt = Math.max(this.tracker.lastUserInputAt, this.now());
    this.parkedBy = undefined;
    this.motion.force('gentle', this.now());
    this.persist(true);
    this.emitCatalog();
    this.tick();
  }

  stay(): void {
    this.journey?.stay(this.now());
    this.persist(true);
    this.tick();
  }

  /** Leaves the current journey (abandoning it if it has not arrived). */
  endJourney(): void {
    this.journey = undefined;
    this.parkedBy = undefined;
    this.motion.force('parked', this.now());
    this.opts.projectStore.set(KEYS.journey, undefined);
    this.emitCatalog();
    this.tick();
  }

  saveTicket(packId: string, saved: boolean): void {
    if (!this.packs.has(packId)) return;
    this.updateLibraryEntry(packId, (e) => (e.saved = saved));
    this.emitCatalog();
  }

  toggleFavorite(packId: string): void {
    if (!this.packs.has(packId)) return;
    this.updateLibraryEntry(packId, (e) => (e.favorite = !e.favorite));
    this.emitCatalog();
  }

  saveMemory(stampId: string, note: string): void {
    const stamps = this.stamps().map((s) => (s.id === stampId ? { ...s, note: note.trim().slice(0, 280) || undefined } : s));
    this.opts.globalStore.set(KEYS.stamps, stamps);
    this.emitCatalog();
  }

  /** Handles the commands every host supports. Returns false for host-specific ones. */
  handleCommand(cmd: ClientCommand): boolean {
    switch (cmd.type) {
      case 'startJourney':
        this.startJourney(cmd.packId, cmd.scope, cmd.variantId, cmd.objective);
        return true;
      case 'saveTicket':
        this.saveTicket(cmd.packId, cmd.saved);
        return true;
      case 'toggleFavorite':
        this.toggleFavorite(cmd.packId);
        return true;
      case 'completeObjective':
        this.completeObjective();
        return true;
      case 'setObjective':
        this.setObjective(cmd.objective);
        return true;
      case 'park':
        this.park('user');
        return true;
      case 'resume':
        this.resume();
        return true;
      case 'stay':
        this.stay();
        return true;
      case 'endJourney':
        this.endJourney();
        return true;
      case 'saveMemory':
        this.saveMemory(cmd.stampId, cmd.note);
        return true;
      default:
        return false;
    }
  }

  /** Called when the host shuts down: the journey parks in the garage (PRD §10). */
  shutdown(): void {
    if (this.journey && this.journey.moving) this.park('close');
    else this.persist(true);
  }

  // ------------------------------------------------------------------ tick

  tick(): TourSnapshot {
    const now = this.now();
    const dt = Math.max(0, Math.min(MAX_TICK_MS, now - this.lastTick));
    this.lastTick = now;
    this.tracker.expireAgents(now, AGENT_EXPIRY_MS);

    const journey = this.journey;
    this.activity.setComplete(journey?.phase === 'arrived' || journey?.phase === 'staying');
    const reading = this.activity.evaluate(now);
    const phase = journey?.phase ?? 'parked';
    const motion = this.motion.update(reading, phase, now);

    if (journey) {
      const before = journey.phase;
      journey.tick(dt, reading.basis, !motion.stopped, now);
      if (before !== 'arrived' && journey.phase === 'arrived') this.onArrived(journey);
      this.persist(before !== journey.phase);
    }

    const snapshot = this.buildSnapshot(now, reading, this.motion.reading);
    this.latest = snapshot;
    for (const l of this.listeners) l(snapshot);
    return snapshot;
  }

  catalog(): Catalog {
    const stamps = this.stamps();
    const j = this.journey;
    const pack = j ? this.packs.get(j.record.packId) : undefined;
    const memory = this.memoryForProject();
    return {
      packs: [...this.packs.values()],
      scopes: SCOPES,
      library: this.library(),
      stamps: this.streaming ? stamps.map((s) => ({ ...s, project: undefined, objective: undefined, note: undefined })) : stamps,
      passport: passportStats(stamps),
      memory: memory && !this.streaming ? memory : memory ? { ...memory, project: '' } : undefined,
      activeJourney:
        j && pack
          ? {
              id: j.record.id,
              packId: pack.id,
              title: pack.title,
              subtitle: pack.subtitle,
              scope: j.record.scope,
              phase: j.phase,
              progress: j.record.progress,
              sessions: j.record.sessions,
            }
          : null,
      lastStampId: this.lastStampId,
    };
  }

  // -------------------------------------------------------------- internals

  private wireTracker(): void {
    this.tracker.onTouch = (path) => this.journey?.recordFile(path);
    this.tracker.onCounter = (key) => {
      if (this.journey?.moving) this.journey.recordCounter(key);
    };
  }

  private restoreJourney(): void {
    const saved = this.opts.projectStore.get<PersistedJourney>(KEYS.journey);
    if (!saved) return;
    const pack = this.packs.get(saved.packId);
    if (!pack || saved.phase === 'arrived' || saved.phase === 'staying') {
      this.opts.projectStore.set(KEYS.journey, undefined);
      return;
    }
    const { parkedBy, ...record } = saved;
    // The pack may have changed since the path was planned: plan again, arrival included.
    if (!record.path.every((id) => pack.sceneGraph.nodes[id])) record.path = planPath(pack, record.seed);
    this.journey = new JourneyEngine(record, pack);
    if (record.phase !== 'parked') {
      this.journey.park(this.now());
      this.parkedBy = 'close';
    } else {
      this.parkedBy = parkedBy ?? 'user';
    }
  }

  private persist(force: boolean): void {
    const now = this.now();
    if (!this.journey) return;
    if (!force && now - this.lastSave < SAVE_EVERY_MS) return;
    this.lastSave = now;
    const value: PersistedJourney = { ...this.journey.record, parkedBy: this.parkedBy };
    this.opts.projectStore.set(KEYS.journey, value);
  }

  private onArrived(journey: JourneyEngine): void {
    const now = this.now();
    const pack = journey.pack;
    const stamp = makeStamp(journey.record, pack, this.newId(), now);
    const stamps = [stamp, ...this.stamps()].slice(0, 500);
    this.opts.globalStore.set(KEYS.stamps, stamps);
    this.lastStampId = stamp.id;
    this.updateLibraryEntry(pack.id, (e) => {
      e.trips += 1;
      e.codingMs += stamp.codingMs;
      e.lastVisitedAt = now;
    });
    this.rememberVisit(pack);
    this.emitCatalog();
  }

  private stamps(): Stamp[] {
    return this.opts.globalStore.get<Stamp[]>(KEYS.stamps) ?? [];
  }

  private library(): LibraryEntry[] {
    return this.opts.globalStore.get<LibraryEntry[]>(KEYS.library) ?? [];
  }

  private updateLibraryEntry(packId: string, change: (e: LibraryEntry) => void): void {
    this.opts.globalStore.set(KEYS.library, updateLibrary(this.library(), packId, change));
  }

  private rememberVisit(pack: JourneyPack): void {
    const project = this.opts.project;
    if (!project) return;
    const memories = (this.opts.globalStore.get<TravelMemory[]>(KEYS.memories) ?? []).filter((m) => m.project !== project);
    memories.unshift({ project, packId: pack.id, title: pack.arrival.name, at: this.now() });
    this.opts.globalStore.set(KEYS.memories, memories.slice(0, 100));
  }

  private memoryForProject(): TravelMemory | undefined {
    const project = this.opts.project;
    if (!project) return undefined;
    return (this.opts.globalStore.get<TravelMemory[]>(KEYS.memories) ?? []).find((m) => m.project === project && this.packs.has(m.packId));
  }

  private emitCatalog(): void {
    if (!this.catalogListeners.size) return;
    const c = this.catalog();
    for (const l of this.catalogListeners) l(c);
  }

  private pickStopName(motion: MotionReading, now: number): string | undefined {
    const pack = this.journey?.pack;
    if (!pack || !motion.stopped) {
      this.stopKey = undefined;
      this.stopName = undefined;
      return undefined;
    }
    const key = `${motion.behavior}:${motion.since}`;
    if (this.stopKey !== key) {
      this.stopKey = key;
      if (motion.behavior === 'pull-over') this.stopName = 'the shoulder';
      else if (motion.behavior === 'arrived') this.stopName = pack.arrival.scene;
      else if (motion.behavior === 'parked') this.stopName = undefined;
      else {
        const r = rng(Math.floor(now / 1000) ^ this.journey!.record.seed);
        this.stopName = pack.scenicStops[Math.floor(r() * pack.scenicStops.length)].name;
      }
    }
    return this.stopName;
  }

  private caption(motion: MotionReading, a: ActivityReading, stopName?: string): string {
    const j = this.journey;
    if (!j) return 'Where do you want to go today?';
    const to = j.pack.route.to;
    const working = a.basis === 'AGENT_ACTIVE';
    switch (motion.behavior) {
      case 'cruise':
        return working ? 'Steady autopilot cruise — agent at work' : j.phase === 'departing' ? `Departing ${j.pack.route.from}` : 'Cruising';
      case 'review':
        return 'Easy pace — reviewing changes';
      case 'gentle':
        return 'Gentle cruising — thinking time';
      case 'slow':
        return 'Slowing down — taking a breather';
      case 'checkpoint':
        return j.scene().env.tunnel ? 'Through the tunnel — verification running' : 'Checkpoint — verification running';
      case 'scenic-stop':
        if (motion.stopReason === 'waiting') return `Scenic stop at ${stopName} — ${a.waitingAgent ?? 'your agent'} is waiting for you`;
        return `Parked at ${stopName} — resume whenever you're ready`;
      case 'pull-over':
        return `Pulled over safely — ${a.blockedReason ?? 'something needs attention'}`;
      case 'approach':
        return `Final approach to ${to}`;
      case 'arrived':
        return `Arrived in ${to}`;
      case 'parked':
        return j.phase === 'parked' ? 'Parked — your journey is saved' : 'Parked';
    }
  }

  private gear(motion: MotionReading, a: ActivityReading): Gear {
    if (motion.stopped) return 'P';
    if (a.reviewing && (a.basis === 'ACTIVE' || a.basis === 'THINKING')) return 'R';
    if (a.basis === 'ACTIVE' || a.basis === 'AGENT_ACTIVE' || a.basis === 'VERIFYING' || motion.behavior === 'approach') return 'D';
    return 'N';
  }

  private journeySnapshot(): JourneySnapshot | null {
    const j = this.journey;
    if (!j) return null;
    const r = j.record;
    const variant = findVariant(j.pack, r.variantId);
    const scene = j.scene();
    const stats = r.stats;
    return {
      id: r.id,
      packId: r.packId,
      variantId: variant.id,
      scope: r.scope,
      scopeLabel: scopeInfo(r.scope).label,
      objective: this.streaming ? undefined : r.objective,
      progress: r.progress,
      phase: r.phase,
      scene: { id: scene.id, index: scene.index, kind: scene.kind, label: scene.label },
      env: scene.env,
      location: j.location(),
      timeOfDay: variant.timeOfDay,
      arrivalTimeOfDay: variant.arrivalTimeOfDay,
      weather: variant.weather,
      travelMs: r.travelMs,
      productiveMs: r.productiveMs,
      sessions: r.sessions,
      createdAt: r.createdAt,
      arrivedAt: r.arrivedAt,
      stats: {
        saves: stats.saves,
        edits: stats.edits,
        testRuns: stats.testRuns,
        testPasses: stats.testPasses,
        testFailures: stats.testFailures,
        builds: stats.builds,
        commits: stats.commits,
        agentEdits: stats.agentEdits,
        filesChanged: stats.files.length,
        activeMs: stats.activeMs,
        agentMs: stats.agentMs,
      },
    };
  }

  private historyLabel(h: HistoryItem): string {
    if (!h.subject || this.streaming) return h.verb;
    return `${h.verb} ${h.subject}`;
  }

  private buildSnapshot(now: number, a: ActivityReading, motion: MotionReading): TourSnapshot {
    const ws = this.tracker;
    const s = this.streaming;
    const stopName = this.pickStopName(motion, now);
    const caption = this.caption(motion, a, stopName);
    let announce: string | undefined;
    if (caption !== this.lastCaption) {
      announce = caption;
      this.lastCaption = caption;
    }
    const kindLabel = (kind: ProcessKind, label: string) => (s ? KIND_LABEL[kind] : label);
    const results: TourSnapshot['ide']['results'] = {};
    for (const key of ['test', 'build', 'lint'] as const) {
      const r = ws.results[key];
      if (r) results[key] = { ...r, label: kindLabel(key, r.label) };
    }
    return {
      v: 1,
      at: now,
      journey: this.journeySnapshot(),
      motion: {
        behavior: motion.behavior,
        targetSpeed: motion.targetSpeed,
        stopped: motion.stopped,
        stopReason: motion.stopReason,
        stopName,
        caption,
        since: motion.since,
        hazard: motion.behavior === 'pull-over',
      },
      activity: {
        state: a.state,
        basis: a.basis,
        since: a.since,
        gear: this.gear(motion, a),
        devActivity: a.devActivity,
        agentActivity: a.agentActivity,
        errorIntensity: a.errorIntensity,
        checkEngine: a.checkEngine,
        warning: a.warning,
        reviewing: a.reviewing,
        context: a.context,
        waitingAgent: a.waitingAgent,
        blockedReason: a.blockedReason,
      },
      ide: {
        project: s ? undefined : this.opts.project,
        activeFile: ws.activeFile
          ? s
            ? { name: ws.activeFile.language ? `${ws.activeFile.language} file` : 'Current file', language: ws.activeFile.language }
            : { name: ws.activeFile.name, path: ws.activeFile.path, language: ws.activeFile.language }
          : undefined,
        git: ws.git
          ? {
              ...ws.git,
              branch: s ? undefined : ws.git.branch,
              repo: s ? undefined : ws.git.repo,
              lastCommit: ws.git.lastCommit ? { at: ws.git.lastCommit.at, message: s ? undefined : ws.git.lastCommit.message } : undefined,
            }
          : undefined,
        diagnostics: {
          errors: ws.diagnostics.errors,
          warnings: ws.diagnostics.warnings,
          top: s
            ? []
            : ws.diagnostics.top.slice(0, 12).map((d) => ({ file: d.file.name, path: d.file.path, line: d.line, severity: d.severity, message: d.message })),
        },
        processes: [...ws.processes.values()].map((p) => ({ ...p, label: kindLabel(p.kind, p.label) })),
        results,
        agents: [...ws.agents.values()].map((ag) => ({
          id: ag.id,
          name: ag.name,
          role: ag.role,
          status: ag.status,
          detail: s ? undefined : ag.detail,
          since: ag.since,
          parentId: ag.parentId,
          context: ag.context,
        })),
        history: ws.history.slice(0, 12).map((h) => ({ at: h.at, kind: h.kind, label: this.historyLabel(h), tone: h.tone })),
        session: { ...ws.counters, filesChanged: ws.touched.size, startedAt: this.sessionStartedAt },
      },
      privacy: { streaming: s },
      announce,
    };
  }
}
