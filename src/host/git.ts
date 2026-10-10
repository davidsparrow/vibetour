/**
 * Git helpers shared by the VS Code Git adapter and the standalone CLI:
 * parsing `git status --porcelain=v1 --branch` and deciding when a HEAD move
 * is a commit worth celebrating (rather than a pull, checkout or reset).
 */

export interface GitStatusSummary {
  /** Undefined when HEAD is detached. */
  branch?: string;
  hasUpstream: boolean;
  /** Working-tree changes plus untracked files. */
  changes: number;
  /** Changes in the index. */
  staged: number;
  ahead: number;
  behind: number;
}

export function parsePorcelainStatus(output: string): GitStatusSummary {
  const summary: GitStatusSummary = { hasUpstream: false, changes: 0, staged: 0, ahead: 0, behind: 0 };
  for (const line of output.split('\n')) {
    if (line.startsWith('## ')) {
      parseBranchLine(line.slice(3), summary);
      continue;
    }
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    if (x === '!' && y === '!') continue;
    if (x === '?' && y === '?') {
      summary.changes++;
      continue;
    }
    if (x !== ' ') summary.staged++;
    if (y !== ' ') summary.changes++;
  }
  return summary;
}

function parseBranchLine(rest: string, out: GitStatusSummary): void {
  for (const prefix of ['No commits yet on ', 'Initial commit on ']) {
    if (rest.startsWith(prefix)) {
      out.branch = rest.slice(prefix.length).trim();
      return;
    }
  }
  if (rest.startsWith('HEAD (no branch)')) return;
  const bracket = rest.indexOf(' [');
  const names = bracket >= 0 ? rest.slice(0, bracket) : rest;
  const info = bracket >= 0 ? rest.slice(bracket) : '';
  const [local, upstream] = names.split('...');
  out.branch = local.trim() || undefined;
  out.hasUpstream = !!upstream;
  out.ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0);
  out.behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0);
}

/** First line of a commit message, truncated for the cockpit. */
export function commitSubject(message: string | undefined, max = 72): string | undefined {
  const first = (message ?? '').split('\n', 1)[0].trim();
  if (!first) return undefined;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

export interface HeadObservation {
  /** Identifies the repository; a different key starts over. */
  repo: string;
  branch?: string;
  head?: string;
  ahead: number;
  hasUpstream: boolean;
}

const SEEN_MAX = 256;

/**
 * Watches HEAD over time. A new commit is reported when HEAD moves to a hash
 * we have not seen, on the same branch, and — when the branch tracks an
 * upstream — the branch got further ahead (so a pull is not a "commit").
 */
export class CommitTracker {
  private last?: HeadObservation;
  private readonly seen = new Set<string>();

  update(obs: HeadObservation): { branchChanged: boolean; committed: boolean } {
    const prev = this.last;
    this.last = obs;
    if (!prev || prev.repo !== obs.repo) {
      this.seen.clear();
      this.remember(obs.head);
      return { branchChanged: false, committed: false };
    }
    const branchChanged = !!obs.branch && prev.branch !== obs.branch;
    const moved = !!obs.head && obs.head !== prev.head;
    const committed =
      !branchChanged &&
      moved &&
      prev.branch === obs.branch &&
      !this.seen.has(obs.head!) &&
      (!obs.hasUpstream || obs.ahead > prev.ahead);
    this.remember(obs.head);
    return { branchChanged, committed };
  }

  private remember(head?: string): void {
    if (!head) return;
    this.seen.add(head);
    if (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value!);
  }
}
