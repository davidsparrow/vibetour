import type { PullRequestRef } from '../core/events';

/**
 * The repository's open pull requests from GitHub's GraphQL API: number,
 * title, branches, author, CI, review and merge state, and how far each
 * branch is ahead of and behind its base. Metadata only: no diffs, no
 * comments. Shared by the VS Code extension and the standalone CLI, which
 * each bring their own sign-in.
 */

export interface GitHubRepo {
  owner: string;
  name: string;
}

/** `owner/name` from an https or ssh remote on github.com; anything else isn't ours to ask about. */
export function parseGitHubRemote(url: string | undefined): GitHubRepo | undefined {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    (url ?? '').trim(),
  );
  return m ? { owner: m[1], name: m[2] } : undefined;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    /** HTTP status, when GitHub answered with one: 401 means the sign-in no longer works. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const ENDPOINT = 'https://api.github.com/graphql';
const MAX_PRS = 50;
/** Ahead/behind costs one comparison each: the newest this many. */
const MAX_COMPARE = 30;

export const LIST_QUERY = `query VibeTourPullRequests($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${MAX_PRS}, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        isDraft
        createdAt
        mergeable
        reviewDecision
        headRefName
        baseRefName
        isCrossRepository
        author { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

/** One query for every branch's ahead/behind: an aliased comparison per pull request. */
export function compareQuery(items: readonly PullRequestRef[]): { query: string; variables: Record<string, string>; aliases: Map<string, number> } {
  const vars: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, string> = {};
  const aliases = new Map<string, number>();
  items
    .filter((pr) => !pr.crossRepo)
    .slice(0, MAX_COMPARE)
    .forEach((pr, i) => {
      vars.push(`$b${i}: String!`, `$h${i}: String!`);
      fields.push(`p${i}: ref(qualifiedName: $b${i}) { compare(headRef: $h${i}) { aheadBy behindBy } }`);
      variables[`b${i}`] = `refs/heads/${pr.base}`;
      variables[`h${i}`] = pr.branch;
      aliases.set(`p${i}`, pr.number);
    });
  const query = `query VibeTourCompare($owner: String!, $name: String!${vars.length ? `, ${vars.join(', ')}` : ''}) {
  repository(owner: $owner, name: $name) {
    ${fields.join('\n    ')}
  }
}`;
  return { query, variables, aliases };
}

async function graphql(fetchImpl: FetchLike, token: string, query: string, variables: Record<string, unknown>): Promise<{ data?: unknown; errors?: unknown[] }> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'VibeTour' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GitHubError(`GitHub answered ${res.status}`, res.status);
  const body = (await res.json()) as { data?: unknown; errors?: unknown[] };
  return body && typeof body === 'object' ? body : {};
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function ciOf(state: unknown): PullRequestRef['ci'] {
  switch (state) {
    case 'SUCCESS':
      return 'passing';
    case 'FAILURE':
    case 'ERROR':
      return 'failing';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

function reviewOf(decision: unknown): PullRequestRef['review'] {
  if (decision === 'APPROVED') return 'approved';
  if (decision === 'CHANGES_REQUESTED') return 'changes-requested';
  if (decision === 'REVIEW_REQUIRED') return 'review-required';
  return 'none';
}

/** The list query's answer as pull requests; anything malformed is skipped, not guessed. */
export function parsePullRequests(data: unknown): { viewer?: string; items: PullRequestRef[] } {
  const d = obj(data);
  const nodes = obj(obj(obj(d.repository).pullRequests)).nodes;
  const items: PullRequestRef[] = [];
  for (const raw of Array.isArray(nodes) ? nodes : []) {
    const n = obj(raw);
    const number = n.number;
    const url = str(n.url);
    const createdAt = Date.parse(str(n.createdAt) ?? '');
    if (!Number.isInteger(number) || !url?.startsWith('https://github.com/') || !Number.isFinite(createdAt)) continue;
    const commitNodes = obj(n.commits).nodes;
    const head = Array.isArray(commitNodes) ? obj(commitNodes[0]) : {};
    items.push({
      number: number as number,
      title: (str(n.title) ?? '').slice(0, 200),
      url,
      branch: str(n.headRefName) ?? '',
      base: str(n.baseRefName) ?? '',
      author: str(obj(n.author).login),
      draft: n.isDraft === true,
      createdAt,
      crossRepo: n.isCrossRepository === true,
      ci: ciOf(obj(obj(obj(head).commit).statusCheckRollup).state),
      review: reviewOf(n.reviewDecision),
      conflict: n.mergeable === 'CONFLICTING',
    });
  }
  return { viewer: str(obj(d.viewer).login), items };
}

/** Adds ahead/behind from the comparison query's answer; a branch it couldn't compare keeps none. */
export function applyComparisons(items: PullRequestRef[], data: unknown, aliases: Map<string, number>): void {
  const repo = obj(obj(data).repository);
  for (const [alias, number] of aliases) {
    const cmp = obj(obj(repo[alias]).compare);
    const pr = items.find((p) => p.number === number);
    if (pr && Number.isInteger(cmp.aheadBy) && Number.isInteger(cmp.behindBy)) {
      pr.ahead = cmp.aheadBy as number;
      pr.behind = cmp.behindBy as number;
    }
  }
}

export async function fetchPullRequests(repo: GitHubRepo, token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ viewer?: string; items: PullRequestRef[] }> {
  const vars = { owner: repo.owner, name: repo.name };
  const list = await graphql(fetchImpl, token, LIST_QUERY, vars);
  if (!obj(list.data).repository) {
    const first = obj(list.errors?.[0]);
    throw new GitHubError(str(first.message) ?? `No repository ${repo.owner}/${repo.name}`);
  }
  const result = parsePullRequests(list.data);
  const cmp = compareQuery(result.items);
  if (cmp.aliases.size) {
    try {
      // Partial answers are fine: a deleted branch just has no ahead/behind.
      const answer = await graphql(fetchImpl, token, cmp.query, { ...vars, ...cmp.variables });
      applyComparisons(result.items, answer.data, cmp.aliases);
    } catch {
      /* the list still stands; the display falls back to when each was opened */
    }
  }
  return result;
}
