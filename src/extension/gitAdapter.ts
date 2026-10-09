import { isAbsolute, relative } from 'node:path';
import * as vscode from 'vscode';
import type { DevEventBody } from '../core/events';
import { CommitTracker, commitSubject } from '../host/git';
import { Debouncer } from '../host/throttle';

/**
 * Git adapter: reads repository state from VS Code's built-in Git extension
 * (no extra `git` processes) and reports the rear-view-mirror events —
 * working-tree counts, branch switches and new commits.
 */

// Minimal slice of the `vscode.git` extension API (extensions/git/src/api/git.d.ts).
interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: vscode.Event<boolean>;
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: RepositoryState;
  getCommit(ref: string): Promise<{ hash: string; message: string }>;
}

interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly workingTreeChanges: readonly unknown[];
  readonly indexChanges: readonly unknown[];
  readonly mergeChanges: readonly unknown[];
  /** Only populated when `git.untrackedChanges` is "separate". */
  readonly untrackedChanges?: readonly unknown[];
  readonly onDidChange: vscode.Event<void>;
}

interface Branch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { remote: string; name: string };
  readonly ahead?: number;
  readonly behind?: number;
}

const DEBOUNCE_MS = 300;

export class GitAdapter implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repos = new Map<Repository, vscode.Disposable>();
  private readonly commits = new CommitTracker();
  private readonly debouncer = new Debouncer(DEBOUNCE_MS, () => void this.publish());
  private api?: GitAPI;
  private lastState = '';
  private disposed = false;

  constructor(
    private readonly emit: (event: DevEventBody) => void,
    private readonly log: (msg: string) => void,
  ) {}

  async start(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      this.log('The built-in Git extension is not available; Git instruments are off.');
      return;
    }
    let git: GitExtension;
    try {
      git = ext.isActive ? ext.exports : await ext.activate();
    } catch (err) {
      this.log(`Could not activate the Git extension: ${String(err)}`);
      return;
    }
    if (this.disposed) return;
    if (git.enabled) this.attach(git);
    this.disposables.push(git.onDidChangeEnablement((on) => on && this.attach(git)));
  }

  dispose(): void {
    this.disposed = true;
    this.debouncer.dispose();
    for (const d of this.repos.values()) d.dispose();
    this.repos.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }

  private attach(git: GitExtension): void {
    if (this.api) return;
    let api: GitAPI;
    try {
      api = git.getAPI(1);
    } catch (err) {
      this.log(`Git API unavailable: ${String(err)}`);
      return;
    }
    this.api = api;
    this.disposables.push(
      api.onDidOpenRepository((r) => this.watch(r)),
      api.onDidCloseRepository((r) => {
        this.repos.get(r)?.dispose();
        this.repos.delete(r);
        this.debouncer.trigger();
      }),
    );
    for (const r of api.repositories) this.watch(r);
  }

  private watch(repo: Repository): void {
    if (this.repos.has(repo)) return;
    this.repos.set(repo, repo.state.onDidChange(() => this.debouncer.trigger()));
    this.debouncer.trigger();
  }

  /** The repository for the first workspace folder, else the first one opened. */
  private primary(): Repository | undefined {
    const repos = [...this.repos.keys()];
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) {
      const contains = (root: string) => {
        const rel = relative(root, folder);
        return !rel.startsWith('..') && !isAbsolute(rel);
      };
      // The innermost repository containing the folder.
      const owning = repos.filter((r) => contains(r.rootUri.fsPath)).sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length)[0];
      if (owning) return owning;
    }
    return repos[0];
  }

  private async publish(): Promise<void> {
    const repo = this.primary();
    if (!repo || this.disposed) return;
    const s = repo.state;
    const head = s.HEAD;
    const ahead = head?.ahead ?? 0;
    const state: DevEventBody = {
      type: 'git',
      branch: head?.name,
      repo: repo.rootUri.path.split('/').filter(Boolean).pop(),
      changes: s.workingTreeChanges.length + s.mergeChanges.length + (s.untrackedChanges?.length ?? 0),
      staged: s.indexChanges.length,
      ahead,
      behind: head?.behind ?? 0,
    };
    const key = JSON.stringify(state);
    if (key !== this.lastState) {
      this.lastState = key;
      this.emit(state);
    }

    const { branchChanged, committed } = this.commits.update({
      repo: repo.rootUri.toString(),
      branch: head?.name,
      head: head?.commit,
      ahead,
      hasUpstream: !!head?.upstream,
    });
    if (branchChanged && head?.name) this.emit({ type: 'git.branch', branch: head.name });
    if (committed && head?.commit) {
      let message: string | undefined;
      try {
        message = commitSubject((await repo.getCommit(head.commit)).message);
      } catch {
        message = undefined;
      }
      if (!this.disposed) this.emit({ type: 'git.commit', message });
    }
  }
}
