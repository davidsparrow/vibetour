import { execFile } from 'node:child_process';
import type { BranchRef, DevEventBody } from '../core/events';
import { isBranchName } from '../core/protocol';

/**
 * The branches beside main, for the Alerts tab: each local branch with
 * commits main lacks, plus the one checked out, and how far each is ahead of
 * and behind main. Shared by the VS Code extension and the standalone CLI,
 * which each bring their own way to run `git`. Two cheap commands per look:
 * `for-each-ref` lists the branches, `rev-list --count` counts only the
 * branches that moved since the last look.
 */

export type BranchesEvent = Extract<DevEventBody, { type: 'git.branches' }>;

/** Runs `git` with these arguments in the repository and resolves with its output. */
export type GitRun = (args: string[]) => Promise<string>;

export interface RefList {
  /** Local branches, most recently committed first. */
  local: Array<{ name: string; commit: string }>;
  /** Remote-tracking branches by their short name, e.g. `origin/main`. */
  remote: Array<{ name: string; commit: string }>;
  /** The checked-out branch; none when HEAD is detached. */
  head?: string;
  /** The `origin` remote is on GitHub, so GitHub can compare pushed branches. */
  github: boolean;
}

export interface BranchSource {
  listRefs(): Promise<RefList>;
  /** Commits `branch` has that `base` lacks (ahead), and the other way round (behind). Both are full ref names. */
  count(base: string, branch: string): Promise<{ ahead: number; behind: number }>;
}

/** The newest this many local branches are compared. */
const MAX_BRANCHES = 30;
/** Counts stop here; the display shows anything past 999 as 999+. */
export const MAX_COUNT = 1000;
/** Fetches and new branches show within this; a switch or a commit shows at once. */
export const BRANCHES_INTERVAL_MS = 30_000;

/** What branches are compared with, best first: the remote's main, because that's what GitHub compares. */
const BASES: ReadonlyArray<{ ref: string; name: string; remote: boolean }> = [
  { ref: 'origin/main', name: 'main', remote: true },
  { ref: 'origin/master', name: 'master', remote: true },
  { ref: 'main', name: 'main', remote: false },
  { ref: 'master', name: 'master', remote: false },
];

export function pickBase(refs: RefList): { ref: string; name: string; commit: string; remote: boolean } | undefined {
  for (const b of BASES) {
    const commit = (b.remote ? refs.remote : refs.local).find((r) => r.name === b.ref)?.commit;
    if (commit) return { ref: b.remote ? `refs/remotes/${b.ref}` : `refs/heads/${b.ref}`, name: b.name, commit, remote: b.remote };
  }
  return undefined;
}

/** `for-each-ref --format=%(HEAD)%09%(refname)%09%(objectname)` output as branches; anything odd is skipped. */
export function parseRefs(output: string, github: boolean): RefList {
  const refs: RefList = { local: [], remote: [], github };
  for (const line of output.split('\n')) {
    const [mark, full, commit] = line.split('\t');
    if (!full || !commit) continue;
    if (full.startsWith('refs/heads/')) {
      const name = full.slice('refs/heads/'.length);
      if (!isBranchName(name)) continue;
      refs.local.push({ name, commit });
      if (mark === '*') refs.head = name;
    } else if (full.startsWith('refs/remotes/')) {
      const name = full.slice('refs/remotes/'.length);
      // origin/HEAD only points at origin's default branch.
      if (!name.endsWith('/HEAD')) refs.remote.push({ name, commit });
    }
  }
  return refs;
}

/** A branch source that asks `git` itself. */
export function gitBranchSource(run: GitRun, github: () => boolean | Promise<boolean>): BranchSource {
  return {
    async listRefs() {
      const out = await run(['for-each-ref', '--sort=-committerdate', '--format=%(HEAD)%09%(refname)%09%(objectname)', 'refs/heads', 'refs/remotes/origin']);
      return parseRefs(out, await github());
    },
    async count(base, branch) {
      // Left is base-only (behind), right is branch-only (ahead). Full ref names never read as options.
      const [behind, ahead] = (await run(['rev-list', '--left-right', '--count', `${base}...${branch}`])).trim().split(/\s+/).map(Number);
      if (!Number.isInteger(ahead) || !Number.isInteger(behind)) throw new Error('git rev-list gave no counts');
      return { ahead, behind };
    },
  };
}

/** Runs one `git` binary in one directory, without a shell and without Git's optional locks. */
export function execGit(gitPath: string, cwd: string): GitRun {
  return (args) =>
    new Promise((done, fail) => {
      execFile(
        gitPath,
        args,
        { cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
        (err, stdout) => (err ? fail(err) : done(stdout)),
      );
    });
}

type Count = { ahead: number; behind: number };

/**
 * Looks at the branches when the checkout moves, and otherwise at most every
 * 30 seconds, and reports them only when they changed. Counts are kept per
 * pair of commits, so a look recounts only the branches that moved.
 */
export class BranchTracker {
  private counts = new Map<string, Count>();
  private head?: string;
  private lastRun = -Infinity;
  private last = '';
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private again = false;
  private failing = false;
  private disposed = false;

  constructor(
    private readonly source: BranchSource,
    private readonly emit: (event: BranchesEvent) => void,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** The repository changed. `head` names the checkout (its branch and commit): when it moves, look at once. */
  update(head: string): void {
    if (this.disposed) return;
    const now = Date.now();
    if (head !== this.head || now - this.lastRun >= BRANCHES_INTERVAL_MS) {
      this.head = head;
      this.start();
      return;
    }
    // Something else changed, such as a fetch or a new branch: look again once the interval is up.
    this.timer ??= setTimeout(() => this.start(), BRANCHES_INTERVAL_MS - (now - this.lastRun));
  }

  /** Resolves once no look is under way. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private start(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.lastRun = Date.now();
    this.running = this.run().finally(() => {
      this.running = undefined;
      if (this.again) {
        this.again = false;
        this.start();
      }
    });
  }

  private async run(): Promise<void> {
    let event: BranchesEvent;
    try {
      event = await this.look();
      this.failing = false;
    } catch (err) {
      if (!this.failing) this.log(`Could not compare branches with main: ${String(err)}`);
      this.failing = true;
      return;
    }
    const key = JSON.stringify(event);
    if (this.disposed || key === this.last) return;
    this.last = key;
    this.emit(event);
  }

  private async look(): Promise<BranchesEvent> {
    const refs = await this.source.listRefs();
    const base = pickBase(refs);
    if (!base) {
      this.counts.clear();
      return { type: 'git.branches', items: [] };
    }
    const pushed = new Set(refs.remote.map((r) => r.name));
    // A local main is the base itself when there's no remote one.
    const local = refs.local.filter((b) => base.remote || b.name !== base.name);
    const current = local.find((b) => b.name === refs.head);
    const branches = [...(current ? [current] : []), ...local.filter((b) => b !== current)].slice(0, MAX_BRANCHES);
    const counts = new Map<string, Count>();
    const items: BranchRef[] = [];
    for (const b of branches) {
      const key = `${base.commit}:${b.commit}`;
      let c = counts.get(key) ?? this.counts.get(key);
      if (!c) {
        try {
          const raw = await this.source.count(base.ref, `refs/heads/${b.name}`);
          c = { ahead: Math.min(raw.ahead, MAX_COUNT), behind: Math.min(raw.behind, MAX_COUNT) };
        } catch {
          continue;
        }
      }
      counts.set(key, c);
      const isCurrent = b === current;
      // The checkout always shows, unless it's a local main level with the remote one.
      if (c.ahead > 0 || (isCurrent && !(b.name === base.name && c.behind === 0))) {
        // Only plain names get a link: it is opened by the system's browser launcher, a shell on Windows.
        const link = refs.github && pushed.has(`origin/${b.name}`) && /^[\w./-]+$/.test(b.name);
        items.push({ name: b.name, ahead: c.ahead, behind: c.behind, current: isCurrent, link });
      }
    }
    this.counts = counts;
    return { type: 'git.branches', base: base.name, items };
  }
}
