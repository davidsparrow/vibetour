import { isVerification } from './classify';
import type { AgentRole, AgentStatus, DevEvent, DiagnosticRef, FileRef, ProcessKind } from './events';

/**
 * Aggregates raw development events into the workspace picture shown on the
 * cockpit instruments: active file, Git, diagnostics, processes, agents and the
 * rear-view-mirror history.
 */

export interface AgentInfo {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  detail?: string;
  since: number;
  lastActivityAt: number;
  parentId?: string;
  context?: number;
}

export interface ProcessInfo {
  id: string;
  kind: ProcessKind;
  label: string;
  startedAt: number;
}

export interface ResultInfo {
  ok: boolean;
  at: number;
  label: string;
  durationMs?: number;
}

export interface GitInfo {
  branch?: string;
  repo?: string;
  changes: number;
  staged: number;
  ahead: number;
  behind: number;
  lastCommit?: { message?: string; at: number };
}

export type HistoryKind = 'save' | 'test' | 'build' | 'lint' | 'commit' | 'branch' | 'agent' | 'process' | 'journey' | 'external';

export interface HistoryItem {
  at: number;
  kind: HistoryKind;
  /** Always-safe part of the label, e.g. "Saved". */
  verb: string;
  /** Potentially private detail, e.g. a file name. Hidden in streaming mode. */
  subject?: string;
  tone: 'good' | 'bad' | 'neutral' | 'agent';
}

export interface SessionCounters {
  saves: number;
  edits: number;
  testRuns: number;
  testPasses: number;
  testFailures: number;
  builds: number;
  commits: number;
  agentEdits: number;
}

export function emptyCounters(): SessionCounters {
  return { saves: 0, edits: 0, testRuns: 0, testPasses: 0, testFailures: 0, builds: 0, commits: 0, agentEdits: 0 };
}

const HISTORY_MAX = 30;
const MERGE_WINDOW_MS = 8_000;

export class WorkspaceTracker {
  activeFile?: FileRef;
  git?: GitInfo;
  diagnostics: { errors: number; warnings: number; top: DiagnosticRef[] } = { errors: 0, warnings: 0, top: [] };
  readonly processes = new Map<string, ProcessInfo>();
  readonly agents = new Map<string, AgentInfo>();
  readonly results: Partial<Record<'test' | 'build' | 'lint', ResultInfo>> = {};
  readonly history: HistoryItem[] = [];
  counters: SessionCounters = emptyCounters();
  /** Paths touched (edited or saved) since the tracker was created/reset. */
  readonly touched = new Set<string>();

  lastUserInputAt = Number.NEGATIVE_INFINITY;
  lastUserEditAt = Number.NEGATIVE_INFINITY;
  lastReviewAt = Number.NEGATIVE_INFINITY;
  lastExternalEditAt = Number.NEGATIVE_INFINITY;
  lastAgentEditAt = Number.NEGATIVE_INFINITY;
  windowFocused = true;
  /**
   * Notified on every touch, not just a path's first: `touched` lasts the
   * whole session, but each journey keeps its own file list.
   */
  onTouch?: (path: string) => void;
  onCounter?: (key: keyof SessionCounters) => void;

  ingest(e: DevEvent): void {
    switch (e.type) {
      case 'editor.focus':
        this.activeFile = e.file;
        this.lastUserInputAt = e.at;
        break;
      case 'editor.edit':
        if (e.origin === 'agent') {
          this.lastAgentEditAt = e.at;
          this.bump('agentEdits');
        } else {
          this.lastUserInputAt = e.at;
          this.lastUserEditAt = e.at;
        }
        this.bump('edits');
        this.touch(e.file.path);
        break;
      case 'editor.save':
        this.lastUserInputAt = Math.max(this.lastUserInputAt, e.at);
        this.bump('saves');
        this.touch(e.file.path);
        this.push({ at: e.at, kind: 'save', verb: 'Saved', subject: e.file.name, tone: 'neutral' });
        break;
      case 'editor.navigate':
        this.lastUserInputAt = e.at;
        break;
      case 'editor.review':
        this.lastUserInputAt = e.at;
        this.lastReviewAt = e.at;
        break;
      case 'window.focus':
        this.windowFocused = e.focused;
        if (e.focused) this.lastUserInputAt = Math.max(this.lastUserInputAt, e.at - 1);
        break;
      case 'diagnostics': {
        const before = this.diagnostics.errors;
        this.diagnostics = { errors: e.errors, warnings: e.warnings, top: e.top ?? [] };
        if (before > 0 && e.errors === 0) {
          this.push({ at: e.at, kind: 'build', verb: 'Problems cleared', tone: 'good' });
        }
        break;
      }
      case 'process.start':
        this.processes.set(e.id, { id: e.id, kind: e.kind, label: e.label, startedAt: e.at });
        if (isVerification(e.kind)) {
          this.push({ at: e.at, kind: e.kind as HistoryKind, verb: verbFor(e.kind, 'start'), subject: e.label, tone: 'neutral' });
        }
        break;
      case 'process.end': {
        const proc = this.processes.get(e.id);
        this.processes.delete(e.id);
        if (isVerification(e.kind) && e.exitCode !== undefined) {
          const ok = e.exitCode === 0;
          const key = e.kind as 'test' | 'build' | 'lint';
          this.results[key] = { ok, at: e.at, label: e.label, durationMs: proc ? e.at - proc.startedAt : undefined };
          if (key === 'test') {
            this.bump('testRuns');
            this.bump(ok ? 'testPasses' : 'testFailures');
          }
          if (key === 'build') this.bump('builds');
          this.replaceLatest(e.kind as HistoryKind, {
            at: e.at,
            kind: e.kind as HistoryKind,
            verb: verbFor(e.kind, ok ? 'pass' : 'fail'),
            subject: e.label,
            tone: ok ? 'good' : 'bad',
          });
        }
        break;
      }
      case 'git': {
        const prev = this.git;
        this.git = {
          branch: e.branch,
          repo: e.repo,
          changes: e.changes,
          staged: e.staged,
          ahead: e.ahead,
          behind: e.behind,
          lastCommit: prev?.lastCommit,
        };
        break;
      }
      case 'git.commit':
        this.git = { ...(this.git ?? { changes: 0, staged: 0, ahead: 0, behind: 0 }), lastCommit: { message: e.message, at: e.at } };
        this.bump('commits');
        this.push({ at: e.at, kind: 'commit', verb: 'Committed', subject: e.message, tone: 'good' });
        break;
      case 'git.branch':
        if (this.git) this.git.branch = e.branch;
        this.push({ at: e.at, kind: 'branch', verb: 'Switched branch', subject: e.branch, tone: 'neutral' });
        break;
      case 'agent': {
        const prev = this.agents.get(e.agentId);
        const changed = !prev || prev.status !== e.status;
        this.agents.set(e.agentId, {
          id: e.agentId,
          name: e.name,
          role: e.role ?? prev?.role ?? (e.parentId ? 'crew' : 'copilot'),
          status: e.status,
          detail: e.detail,
          since: changed ? e.at : prev!.since,
          lastActivityAt: e.status === 'working' || e.status === 'tool' ? e.at : prev?.lastActivityAt ?? e.at,
          parentId: e.parentId ?? prev?.parentId,
          context: e.context ?? prev?.context,
        });
        if (changed && (e.status === 'waiting' || e.status === 'done' || e.status === 'error')) {
          const verb = e.status === 'waiting' ? `${e.name} needs you` : e.status === 'done' ? `${e.name} finished` : `${e.name} hit a problem`;
          this.push({ at: e.at, kind: 'agent', verb, subject: e.detail, tone: e.status === 'error' ? 'bad' : 'agent' });
        }
        break;
      }
      case 'agent.remove':
        this.agents.delete(e.agentId);
        break;
      case 'fs.external':
        this.lastExternalEditAt = e.at;
        this.bump('agentEdits');
        this.touch(e.file.path);
        this.mergeExternal(e.at, e.file.name);
        break;
      case 'terminal.open':
        this.lastUserInputAt = e.at;
        break;
    }
  }

  runningVerification(): ProcessInfo[] {
    return [...this.processes.values()].filter((p) => isVerification(p.kind));
  }

  /** Forgets agents that have been silent for a long time (lost hook events). */
  expireAgents(now: number, maxSilenceMs: number): void {
    for (const [id, a] of this.agents) {
      const silentFor = now - Math.max(a.lastActivityAt, a.since);
      if ((a.status === 'done' || a.status === 'idle') && silentFor > maxSilenceMs) this.agents.delete(id);
      else if (silentFor > maxSilenceMs * 4) this.agents.delete(id);
    }
  }

  private bump(key: keyof SessionCounters): void {
    this.counters[key]++;
    this.onCounter?.(key);
  }

  private touch(path: string): void {
    this.touched.add(path);
    this.onTouch?.(path);
  }

  private push(item: HistoryItem): void {
    this.history.unshift(item);
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
  }

  /** Replaces the "Tests running" entry with its result instead of stacking both. */
  private replaceLatest(kind: HistoryKind, item: HistoryItem): void {
    const idx = this.history.findIndex((h) => h.kind === kind);
    if (idx >= 0 && this.history[idx].tone === 'neutral') this.history.splice(idx, 1);
    this.push(item);
  }

  /** Collapses a burst of external edits into one "Agent edited N files" entry. */
  private mergeExternal(at: number, name: string): void {
    const head = this.history[0];
    if (head && head.kind === 'external' && this.externalBatch && at - head.at < MERGE_WINDOW_MS) {
      this.externalBatch.add(name);
      head.at = at;
      if (this.externalBatch.size > 1) {
        head.verb = `Agent edited ${this.externalBatch.size} files`;
        head.subject = undefined;
      }
      return;
    }
    this.externalBatch = new Set([name]);
    this.push({ at, kind: 'external', verb: 'Agent edited', subject: name, tone: 'agent' });
  }

  private externalBatch?: Set<string>;
}

function verbFor(kind: ProcessKind, phase: 'start' | 'pass' | 'fail'): string {
  const noun = kind === 'test' ? 'Tests' : kind === 'build' ? 'Build' : 'Checks';
  if (phase === 'start') return `${noun} running`;
  if (phase === 'pass') return kind === 'test' ? 'Tests passed' : kind === 'build' ? 'Build succeeded' : 'Checks passed';
  return kind === 'test' ? 'Tests failed' : kind === 'build' ? 'Build failed' : 'Checks failed';
}
