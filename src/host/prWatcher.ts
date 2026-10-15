import type { DevEventBody, PullRequestFeedState } from '../core/events';
import { fetchPullRequests, GitHubError, type FetchLike, type GitHubRepo } from './github';

/**
 * Keeps the open pull requests fresh: every couple of minutes while it is on,
 * sooner after a push or a branch switch, and backing off when GitHub fails.
 * Off until the user connects GitHub; each host supplies the repository and
 * the sign-in.
 */

export interface PrWatcherOptions {
  /** The repository's GitHub remote, if it has one. */
  repo(): GitHubRepo | undefined;
  /** A GitHub token, or undefined when signed out. Never prompts. */
  token(): Promise<string | undefined>;
  emit(event: DevEventBody): void;
  log(msg: string): void;
  intervalMs?: number;
  fetchImpl?: FetchLike;
}

const INTERVAL_MS = 2 * 60_000;
const RETRY_MS = 5 * 60_000;
/** No remote yet (the editor's Git may still be loading) or no sign-in: cheap to look again, nothing goes out. */
const NO_REMOTE_MS = 15_000;
const SIGNED_OUT_MS = 60_000;
/** A push or branch switch asks again after this long, at most this often. */
const SOON_MS = 8_000;
const MIN_GAP_MS = 20_000;

export class PrWatcher {
  private on = false;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private lastPoll = 0;
  private lastState?: PullRequestFeedState;
  private failing = false;

  constructor(private readonly opts: PrWatcherOptions) {}

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.clear();
    if (on) void this.poll();
    else this.report('off');
  }

  /** Something changed on GitHub's side, probably: a push, a new branch. */
  refreshSoon(): void {
    if (!this.on) return;
    const wait = Math.max(SOON_MS, this.lastPoll + MIN_GAP_MS - Date.now());
    this.schedule(wait);
  }

  stop(): void {
    this.on = false;
    this.clear();
  }

  /** One fetch, then the next is scheduled. Exposed for tests. */
  async poll(): Promise<void> {
    if (!this.on || this.running) return;
    this.running = true;
    this.clear();
    this.lastPoll = Date.now();
    let next = this.opts.intervalMs ?? INTERVAL_MS;
    try {
      const repo = this.opts.repo();
      const token = repo ? await this.opts.token() : undefined;
      if (!this.on) return;
      if (!repo) {
        this.report('no-remote');
        next = Math.min(next, NO_REMOTE_MS);
      } else if (!token) {
        this.report('signed-out', repo);
        next = Math.min(next, SIGNED_OUT_MS);
      } else {
        const { viewer, items } = await fetchPullRequests(repo, token, this.opts.fetchImpl);
        if (!this.on) return;
        if (this.failing) this.opts.log('Pull requests are back.');
        this.failing = false;
        this.lastState = 'ok';
        this.opts.emit({ type: 'github.prs', state: 'ok', repo: `${repo.owner}/${repo.name}`, viewer, items });
      }
    } catch (err) {
      const signedOut = err instanceof GitHubError && err.status === 401;
      if (!this.failing) this.opts.log(`Could not fetch pull requests (${err instanceof Error ? err.message : String(err)}); retrying every ${RETRY_MS / 60_000} min.`);
      this.failing = true;
      const repo = this.opts.repo();
      if (this.on) this.report(signedOut ? 'signed-out' : 'error', repo);
      next = RETRY_MS;
    } finally {
      this.running = false;
      if (this.on) this.schedule(next);
    }
  }

  private report(state: Exclude<PullRequestFeedState, 'ok'>, repo?: GitHubRepo): void {
    // An error repeats the last list (the workspace keeps it); other states say so once.
    if (state === this.lastState && state !== 'error') return;
    this.lastState = state;
    this.opts.emit({ type: 'github.prs', state, repo: repo ? `${repo.owner}/${repo.name}` : undefined, items: [] });
  }

  private schedule(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => void this.poll(), ms);
    this.timer.unref?.();
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
