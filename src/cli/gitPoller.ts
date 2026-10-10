import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import type { DevEventBody } from '../core/events';
import { CommitTracker, commitSubject, parsePorcelainStatus } from '../host/git';

/**
 * Polls `git` for the standalone companion (no editor Git API here): working
 * tree counts, branch switches and new commits. Commands run via execFile
 * without a shell and without taking Git's optional locks, so they never get
 * in the way of the user's own Git commands.
 */

const RETRY_MS = 30_000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    execFile(
      'git',
      args,
      { cwd, timeout: 5_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
      (err, stdout) => (err ? fail(err) : done(stdout)),
    );
  });
}

export class GitPoller {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private readonly commits = new CommitTracker();
  private lastState = '';
  private repoName?: string;
  private failing = false;

  constructor(
    private readonly dir: string,
    private readonly emit: (event: DevEventBody) => void,
    private readonly log: (msg: string) => void,
    private readonly intervalMs = 4_000,
  ) {}

  start(): void {
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One poll; exposed for tests. */
  async poll(): Promise<void> {
    if (this.stopped) return;
    let next = this.intervalMs;
    try {
      await this.read();
      this.failing = false;
    } catch (err) {
      if (!this.failing) this.log(`Git status unavailable (${firstLine(err)}); retrying every ${RETRY_MS / 1000} s.`);
      this.failing = true;
      next = RETRY_MS;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), next);
  }

  private async read(): Promise<void> {
    const status = parsePorcelainStatus(await git(this.dir, ['status', '--porcelain=v1', '--branch']));
    this.repoName ??= basename((await git(this.dir, ['rev-parse', '--show-toplevel'])).trim());
    const head = (await git(this.dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).catch(() => '')).trim() || undefined;
    if (this.stopped) return;

    const state: DevEventBody = {
      type: 'git',
      branch: status.branch,
      repo: this.repoName,
      changes: status.changes,
      staged: status.staged,
      ahead: status.ahead,
      behind: status.behind,
    };
    const key = JSON.stringify(state);
    if (key !== this.lastState) {
      this.lastState = key;
      this.emit(state);
    }

    const { branchChanged, committed } = this.commits.update({
      repo: this.dir,
      branch: status.branch,
      head,
      ahead: status.ahead,
      hasUpstream: status.hasUpstream,
    });
    if (branchChanged && status.branch) this.emit({ type: 'git.branch', branch: status.branch });
    if (committed) {
      const subject = await git(this.dir, ['log', '-1', '--format=%s']).catch(() => '');
      if (!this.stopped) this.emit({ type: 'git.commit', message: commitSubject(subject) });
    }
  }
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n').find((l) => l.trim() && !l.startsWith('Command failed'))?.trim() ?? msg.split('\n')[0];
}
