import * as vscode from 'vscode';
import { classifyCommand, classifyTask, type Classification } from '../core/classify';
import { fileRef, type DevEventBody, type EditOrigin, type FileRef } from '../core/events';
import { isIgnoredPath, languageForPath, languageName } from '../host/paths';
import { Debouncer, Throttle } from '../host/throttle';
import { editOrigin, mergeOrigin, summarizeDiagnostics, type DiagnosticInput } from './helpers';

/**
 * IDE Adapter (PRD §16, §17): turns VS Code editor, terminal, task, debug and
 * file-system signals into provider-neutral development events. Metadata only
 * (PRD §26): file paths, sizes of edits, diagnostic counts and short messages,
 * and command *classifications* — never document contents or raw command lines.
 */

export interface IdeAdapterOptions {
  emit(event: DevEventBody): void;
  /** `vibetour.agents.detectExternalEdits`, read live. */
  detectExternalEdits(): boolean;
  log(msg: string): void;
}

const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-remote']);
const EDIT_INTERVAL_MS = 500;
const NAVIGATE_INTERVAL_MS = 2_000;
const EXTERNAL_INTERVAL_MS = 1_000;
const DIAGNOSTICS_DEBOUNCE_MS = 500;
const OWN_SAVE_WINDOW_MS = 3_000;

interface PendingEdit {
  file: FileRef;
  origin: EditOrigin;
  magnitude: number;
}

interface RunningProcess extends Classification {
  id: string;
}

export class IdeAdapter implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly edits: Throttle<PendingEdit>;
  private readonly navigation: Throttle<DevEventBody>;
  private readonly external: Throttle<FileRef>;
  private readonly diagnostics: Debouncer;
  private readonly savedAt = new Map<string, number>();
  private readonly executions = new WeakMap<vscode.TerminalShellExecution, RunningProcess>();
  private readonly terminalProcesses = new Map<vscode.Terminal, Map<string, RunningProcess>>();
  private seq = 0;
  private lastDiagnostics = '';
  private focused: boolean;

  constructor(private readonly opts: IdeAdapterOptions) {
    const emit = opts.emit;
    this.edits = new Throttle<PendingEdit>(
      EDIT_INTERVAL_MS,
      (a, b) => ({ file: b.file, origin: mergeOrigin(a.origin, b.origin), magnitude: a.magnitude + b.magnitude }),
      (_key, e) => emit({ type: 'editor.edit', file: e.file, origin: e.origin, magnitude: e.magnitude }),
    );
    this.navigation = new Throttle<DevEventBody>(NAVIGATE_INTERVAL_MS, (_a, b) => b, (_key, e) => emit(e), false);
    this.external = new Throttle<FileRef>(EXTERNAL_INTERVAL_MS, (_a, b) => b, (_key, file) => emit({ type: 'fs.external', file }), false);
    this.diagnostics = new Debouncer(DIAGNOSTICS_DEBOUNCE_MS, () => this.publishDiagnostics());
    this.focused = vscode.window.state.focused;
  }

  start(): void {
    const w = vscode.window;
    const ws = vscode.workspace;
    this.disposables.push(
      w.onDidChangeActiveTextEditor((ed) => ed && this.focus(ed.document)),
      ws.onDidChangeTextDocument((e) => this.onEdit(e)),
      ws.onDidSaveTextDocument((doc) => this.onSave(doc)),
      w.onDidChangeTextEditorSelection((e) => {
        const k = e.kind;
        if (k === vscode.TextEditorSelectionChangeKind.Keyboard || k === vscode.TextEditorSelectionChangeKind.Mouse) this.navigate();
      }),
      w.onDidChangeTextEditorVisibleRanges(() => this.navigate()),
      w.tabGroups.onDidChangeTabs(() => this.onTabs()),
      w.onDidChangeWindowState((s) => this.onWindowState(s)),
      vscode.languages.onDidChangeDiagnostics(() => this.diagnostics.trigger()),
      w.onDidOpenTerminal(() => this.opts.emit({ type: 'terminal.open' })),
      w.onDidCloseTerminal((t) => this.onTerminalClosed(t)),
      vscode.tasks.onDidStartTaskProcess((e) => this.onTask(e.execution, 'start')),
      vscode.tasks.onDidEndTaskProcess((e) => this.onTask(e.execution, 'end', e.exitCode)),
      vscode.debug.onDidStartDebugSession((s) => this.onDebug(s, 'start')),
      vscode.debug.onDidTerminateDebugSession((s) => this.onDebug(s, 'end')),
    );
    // Shell integration may be missing in older forks of VS Code.
    if (typeof w.onDidStartTerminalShellExecution === 'function') {
      this.disposables.push(
        w.onDidStartTerminalShellExecution((e) => this.onShellStart(e)),
        w.onDidEndTerminalShellExecution((e) => this.onShellEnd(e)),
      );
    }
    const watcher = ws.createFileSystemWatcher('**/*', false, false, true);
    this.disposables.push(watcher, watcher.onDidChange((u) => this.onDiskChange(u)), watcher.onDidCreate((u) => this.onDiskChange(u)));

    if (w.activeTextEditor) this.focus(w.activeTextEditor.document);
    this.diagnostics.trigger();
  }

  dispose(): void {
    this.edits.flush();
    this.edits.dispose();
    this.navigation.dispose();
    this.external.dispose();
    this.diagnostics.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  // ---------------------------------------------------------------- editors

  private tracked(uri: vscode.Uri): boolean {
    return TRACKED_SCHEMES.has(uri.scheme);
  }

  /** Workspace-relative path, or undefined for files we should not report. */
  private relative(uri: vscode.Uri): string | undefined {
    if (!this.tracked(uri)) return undefined;
    if (uri.scheme !== 'untitled' && vscode.workspace.workspaceFolders?.length && !vscode.workspace.getWorkspaceFolder(uri)) {
      return undefined;
    }
    const rel = vscode.workspace.asRelativePath(uri);
    return isIgnoredPath(rel) ? undefined : rel;
  }

  private ref(doc: vscode.TextDocument): FileRef | undefined {
    const rel = this.relative(doc.uri);
    return rel === undefined ? undefined : fileRef(rel, languageName(doc.languageId));
  }

  private focus(doc: vscode.TextDocument): void {
    const file = this.ref(doc);
    if (file) this.opts.emit({ type: 'editor.focus', file });
  }

  private onEdit(e: vscode.TextDocumentChangeEvent): void {
    if (!e.contentChanges.length) return;
    const doc = e.document;
    const file = this.ref(doc);
    if (!file) return;
    const w = vscode.window;
    const undoRedo = e.reason !== undefined;
    const active = w.activeTextEditor?.document === doc && this.focused;
    // A document that is clean right after a change nobody typed is VS Code
    // reloading a file something else rewrote on disk: an external edit.
    if (!doc.isDirty && !undoRedo && !active && doc.uri.scheme !== 'untitled') {
      if (this.opts.detectExternalEdits()) this.external.push(doc.uri.toString(), file);
      return;
    }
    const origin = editOrigin({ active, visible: w.visibleTextEditors.some((ed) => ed.document === doc), undoRedo });
    const magnitude = e.contentChanges.reduce((sum, c) => sum + c.text.length + c.rangeLength, 0);
    this.edits.push(doc.uri.toString(), { file, origin, magnitude });
  }

  private onSave(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    this.savedAt.set(key, Date.now());
    if (this.savedAt.size > 256) {
      const cutoff = Date.now() - OWN_SAVE_WINDOW_MS;
      for (const [k, at] of this.savedAt) if (at < cutoff) this.savedAt.delete(k);
    }
    const file = this.ref(doc);
    if (!file) return;
    this.edits.flush();
    this.opts.emit({ type: 'editor.save', file });
  }

  private navigate(): void {
    this.navigation.push('navigate', { type: 'editor.navigate' });
  }

  private onTabs(): void {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (!(input instanceof vscode.TabInputTextDiff)) return;
    const rel = this.relative(input.modified);
    const file = rel === undefined ? undefined : fileRef(rel, languageForPath(rel));
    this.navigation.push('review', file ? { type: 'editor.review', file } : { type: 'editor.review' });
  }

  private onWindowState(state: vscode.WindowState): void {
    if (state.focused === this.focused) return;
    this.focused = state.focused;
    this.opts.emit({ type: 'window.focus', focused: state.focused });
  }

  // ------------------------------------------------------------ diagnostics

  private publishDiagnostics(): void {
    const files: DiagnosticInput[] = [];
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      const relevant = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error || d.severity === vscode.DiagnosticSeverity.Warning);
      if (!relevant.length) continue;
      const rel = this.relative(uri);
      if (rel === undefined) continue;
      files.push({
        path: rel,
        language: languageForPath(rel),
        diagnostics: relevant.map((d) => ({
          severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
          line: d.range.start.line + 1,
          message: d.message,
        })),
      });
    }
    const summary = summarizeDiagnostics(files);
    const key = JSON.stringify(summary);
    if (key === this.lastDiagnostics) return;
    this.lastDiagnostics = key;
    this.opts.emit({ type: 'diagnostics', ...summary });
  }

  // -------------------------------------------------------------- processes

  private processStarted(proc: RunningProcess): void {
    this.opts.emit({ type: 'process.start', id: proc.id, kind: proc.kind, label: proc.label });
  }

  private processEnded(proc: RunningProcess, exitCode?: number): void {
    this.opts.emit({ type: 'process.end', id: proc.id, kind: proc.kind, label: proc.label, exitCode });
  }

  private onShellStart(e: vscode.TerminalShellExecutionStartEvent): void {
    // Only the classification leaves this function: the raw command line may hold secrets.
    const proc: RunningProcess = { id: `shell:${++this.seq}`, ...classifyCommand(e.execution.commandLine.value) };
    this.executions.set(e.execution, proc);
    let running = this.terminalProcesses.get(e.terminal);
    if (!running) this.terminalProcesses.set(e.terminal, (running = new Map()));
    running.set(proc.id, proc);
    this.processStarted(proc);
  }

  private onShellEnd(e: vscode.TerminalShellExecutionEndEvent): void {
    let proc = this.executions.get(e.execution);
    if (proc) {
      this.executions.delete(e.execution);
      this.terminalProcesses.get(e.terminal)?.delete(proc.id);
    } else {
      // Started before VibeTour was watching; still report the result.
      proc = { id: `shell:${++this.seq}`, ...classifyCommand(e.execution.commandLine.value) };
    }
    this.processEnded(proc, e.exitCode);
  }

  private onTerminalClosed(terminal: vscode.Terminal): void {
    const running = this.terminalProcesses.get(terminal);
    this.terminalProcesses.delete(terminal);
    for (const proc of running?.values() ?? []) this.processEnded(proc);
  }

  private onTask(execution: vscode.TaskExecution, phase: 'start' | 'end', exitCode?: number): void {
    const task = execution.task;
    const source = typeof task.source === 'string' ? task.source : '';
    const proc: RunningProcess = { id: `task:${source}:${task.name}`, ...classifyTask(task.name, task.group?.id) };
    if (phase === 'start') this.processStarted(proc);
    else this.processEnded(proc, exitCode);
  }

  private onDebug(session: vscode.DebugSession, phase: 'start' | 'end'): void {
    if (session.parentSession) return;
    const proc: RunningProcess = { id: `debug:${session.id}`, kind: 'run', label: 'Debugging' };
    if (phase === 'start') this.processStarted(proc);
    else this.processEnded(proc);
  }

  // ---------------------------------------------------------- external edits

  private onDiskChange(uri: vscode.Uri): void {
    if (uri.scheme !== 'file' || !this.opts.detectExternalEdits()) return;
    const key = uri.toString();
    const saved = this.savedAt.get(key);
    if (saved !== undefined && Date.now() - saved < OWN_SAVE_WINDOW_MS) return;
    if (vscode.workspace.textDocuments.some((d) => d.isDirty && d.uri.toString() === key)) return;
    const rel = this.relative(uri);
    if (rel === undefined) return;
    this.external.push(key, fileRef(rel, languageForPath(rel)));
  }
}
