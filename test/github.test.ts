import { describe, expect, it } from 'vitest';
import { attentionOf, type AttentionInput } from '../src/core/attention';
import type { DevEventBody, PullRequestRef } from '../src/core/events';
import { isClientCommand } from '../src/core/protocol';
import { applyComparisons, compareQuery, fetchPullRequests, GitHubError, parseGitHubRemote, parsePullRequests, type FetchLike } from '../src/host/github';
import { PrWatcher } from '../src/host/prWatcher';
import { makeSession } from './helpers';

/** GitHub's answer to the list query, as documented in its GraphQL schema. */
function listAnswer(nodes: unknown[], viewer = 'me') {
  return { data: { viewer: { login: viewer }, repository: { pullRequests: { nodes } } } };
}

function node(number: number, more: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/atlas/pull/${number}`,
    isDraft: false,
    createdAt: '2026-10-14T12:00:00Z',
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    headRefName: `feat/${number}`,
    baseRefName: 'main',
    isCrossRepository: false,
    author: { login: 'me' },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    ...more,
  };
}

function pr(number: number, more: Partial<PullRequestRef> = {}): PullRequestRef {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/atlas/pull/${number}`,
    branch: `feat/${number}`,
    base: 'main',
    author: 'me',
    draft: false,
    createdAt: 0,
    crossRepo: false,
    ci: 'passing',
    review: 'none',
    conflict: false,
    ...more,
  };
}

/** A fetch that answers each GraphQL call in turn and records what was asked. */
function fakeFetch(...answers: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Array<{ query: string; variables: Record<string, string>; auth: string }> = [];
  const impl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, string> };
    calls.push({ query: body.query, variables: body.variables, auth: init.headers.authorization });
    const next = answers.shift() ?? new Error('no more answers');
    if (next instanceof Error) throw next;
    return { ok: (next.status ?? 200) < 400, status: next.status ?? 200, json: async () => next.body };
  };
  return { impl, calls };
}

describe('GitHub remotes', () => {
  it('reads owner and name from https and ssh remotes on github.com only', () => {
    for (const url of ['https://github.com/acme/atlas.git', 'https://github.com/acme/atlas', 'git@github.com:acme/atlas.git', 'ssh://git@github.com/acme/atlas.git', 'https://x-token@github.com/acme/atlas.git']) {
      expect(parseGitHubRemote(url), url).toEqual({ owner: 'acme', name: 'atlas' });
    }
    expect(parseGitHubRemote('https://github.com/acme/my.repo-v2.git')).toEqual({ owner: 'acme', name: 'my.repo-v2' });
    for (const url of ['https://gitlab.com/acme/atlas.git', 'https://github.com.evil.io/acme/atlas', 'https://github.com/acme', '', undefined]) {
      expect(parseGitHubRemote(url), String(url)).toBeUndefined();
    }
  });
});

describe('pull request answers', () => {
  it('maps CI, reviews and conflicts, and skips anything malformed', () => {
    const { viewer, items } = parsePullRequests(
      listAnswer([
        node(9, { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] }, reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING' }),
        node(8, { commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, reviewDecision: 'APPROVED', isDraft: true, author: null }),
        node(7, { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'EXPECTED' } } }] }, isCrossRepository: true }),
        node(6, { url: 'javascript:alert(1)' }),
        { number: 'five' },
        null,
      ]).data,
    );
    expect(viewer).toBe('me');
    expect(items.map((p) => p.number)).toEqual([9, 8, 7]);
    expect(items[0]).toMatchObject({ ci: 'failing', review: 'changes-requested', conflict: true, branch: 'feat/9', base: 'main', createdAt: Date.parse('2026-10-14T12:00:00Z') });
    expect(items[1]).toMatchObject({ ci: 'none', review: 'approved', draft: true, author: undefined });
    expect(items[2]).toMatchObject({ ci: 'pending', crossRepo: true });
  });

  it('compares each branch with its base in one query, forks aside', () => {
    const items = [pr(9), pr(8, { branch: 'fix/"quoted"' }), pr(7, { crossRepo: true })];
    const { query, variables, aliases } = compareQuery(items);
    expect([...aliases]).toEqual([
      ['p0', 9],
      ['p1', 8],
    ]);
    // Branch names travel as variables, never inside the query text.
    expect(variables).toEqual({ b0: 'refs/heads/main', h0: 'feat/9', b1: 'refs/heads/main', h1: 'fix/"quoted"' });
    expect(query).not.toContain('quoted');
    applyComparisons(items, { repository: { p0: { compare: { aheadBy: 3, behindBy: 1 } }, p1: null } }, aliases);
    expect(items[0]).toMatchObject({ ahead: 3, behind: 1 });
    expect(items[1].ahead).toBeUndefined();
  });

  it('fetches the list, then ahead/behind, and keeps the list when the comparison fails', async () => {
    const ok = fakeFetch({ body: listAnswer([node(9)]) }, { body: { data: { repository: { p0: { compare: { aheadBy: 2, behindBy: 0 } } } } } });
    const result = await fetchPullRequests({ owner: 'acme', name: 'atlas' }, 'tok', ok.impl);
    expect(result.items[0]).toMatchObject({ number: 9, ahead: 2, behind: 0 });
    expect(ok.calls[0]).toMatchObject({ variables: { owner: 'acme', name: 'atlas' }, auth: 'bearer tok' });

    const noCompare = fakeFetch({ body: listAnswer([node(9)]) }, { status: 502 });
    expect((await fetchPullRequests({ owner: 'acme', name: 'atlas' }, 'tok', noCompare.impl)).items[0].ahead).toBeUndefined();

    const missing = fakeFetch({ body: { data: { viewer: { login: 'me' }, repository: null }, errors: [{ message: "Could not resolve to a Repository with the name 'acme/gone'." }] } });
    await expect(fetchPullRequests({ owner: 'acme', name: 'gone' }, 'tok', missing.impl)).rejects.toThrow(/Could not resolve/);
    await expect(fetchPullRequests({ owner: 'acme', name: 'atlas' }, 'tok', fakeFetch({ status: 401 }).impl)).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('PrWatcher', () => {
  const repo = { owner: 'acme', name: 'atlas' };
  function watcher(opts: { repo?: typeof repo; token?: string; answers?: Parameters<typeof fakeFetch> }) {
    const events: DevEventBody[] = [];
    const logs: string[] = [];
    const { impl } = fakeFetch(...(opts.answers ?? []));
    const w = new PrWatcher({ repo: () => opts.repo, token: async () => opts.token, emit: (e) => events.push(e), log: (m) => logs.push(m), fetchImpl: impl, intervalMs: 3_600_000 });
    return { w, events, logs };
  }

  it('says why there is no list: off, no remote, signed out', async () => {
    const off = watcher({ repo });
    off.w.setEnabled(true);
    off.w.setEnabled(false);
    expect(off.events.at(-1)).toMatchObject({ type: 'github.prs', state: 'off' });

    const noRemote = watcher({});
    noRemote.w.setEnabled(true);
    await noRemote.w.poll();
    expect(noRemote.events).toEqual([{ type: 'github.prs', state: 'no-remote', items: [] }]);
    noRemote.w.stop();

    const signedOut = watcher({ repo });
    signedOut.w.setEnabled(true);
    await signedOut.w.poll();
    expect(signedOut.events).toEqual([{ type: 'github.prs', state: 'signed-out', repo: 'acme/atlas', items: [] }]);
    signedOut.w.stop();
  });

  it('reports the list, then an error without dropping it, and a revoked sign-in as signed out', async () => {
    const t = watcher({ repo, token: 'tok', answers: [{ body: listAnswer([]) }, { status: 502 }, { status: 401 }] });
    t.w.setEnabled(true);
    await new Promise((r) => setTimeout(r, 0));
    await t.w.poll();
    await t.w.poll();
    expect(t.events.map((e) => (e as { state: string }).state)).toEqual(['ok', 'error', 'signed-out']);
    expect(t.logs).toHaveLength(1);
    t.w.stop();
  });
});

describe('what needs you', () => {
  const base: AttentionInput = { now: 100_000, agents: [], pullRequests: [], waitingExpiryMs: 30 * 60_000, errorExpiryMs: 10 * 60_000, streaming: false };
  const prState = (n: number, more: Partial<AttentionInput['pullRequests'][number]>) => ({ number: n, ci: 'passing' as const, review: 'none' as const, conflict: false, onBranch: false, mine: false, createdAt: 0, ...more });

  it('lists questions, plans, approvals, stops, your turn and PRs, most urgent first', () => {
    const list = attentionOf({
      ...base,
      agents: [
        { id: 'a', name: 'Claude', status: 'waiting', ask: 'approval', tool: 'Bash', since: 90_000 },
        { id: 'b', name: 'Codex', status: 'waiting', ask: 'question', since: 95_000 },
        { id: 'c', name: 'Aider', status: 'error', detail: 'Stopped: rate limit', since: 99_000 },
        { id: 'd', name: 'Old', status: 'waiting', since: -40 * 60_000 },
        { id: 'e', name: 'Busy', status: 'working', since: 0 },
      ],
      yourTurn: { agentId: 'f', agent: 'Gemini', since: 50_000 },
      pullRequests: [prState(12, { onBranch: true, ci: 'failing', conflict: true }), prState(11, { ci: 'failing' }), prState(10, { mine: true, review: 'changes-requested' })],
    });
    expect(list.map((a) => a.text)).toEqual([
      'Aider stopped · rate limit',
      'Codex has a question',
      'Claude needs approval · Bash',
      'Gemini finished · your turn',
      'PR #12 · merge conflict, CI failing',
      'PR #10 · changes requested',
    ]);
    expect(list[0].target).toEqual({ type: 'agent', agentId: 'c' });
    expect(list.at(-1)?.target).toEqual({ type: 'pr', number: 10 });
  });

  it('keeps tool names and error details off the glass in streaming mode', () => {
    const list = attentionOf({
      ...base,
      streaming: true,
      agents: [
        { id: 'a', name: 'Claude', status: 'waiting', ask: 'approval', tool: 'Bash', since: 90_000 },
        { id: 'c', name: 'Claude', status: 'error', detail: 'Stopped: rate limit', since: 90_000 },
      ],
    });
    expect(list.map((a) => a.text)).toEqual(['Claude hit a problem', 'Claude needs approval']);
  });
});

describe('pull requests in the session', () => {
  it('marks the PR on the checked-out branch and yours, notes new ones, and hides titles when streaming', () => {
    const { session, clock, emit } = makeSession();
    emit({ type: 'git', branch: 'feat/9', repo: 'atlas', changes: 0, staged: 0, ahead: 0, behind: 0 });
    emit({ type: 'github.prs', state: 'ok', repo: 'acme/atlas', viewer: 'me', items: [pr(9, { ci: 'failing' }), pr(8, { author: 'sam' })] });
    clock.advance(250);
    let snap = session.latestSnapshot!;
    expect(snap.ide.pullRequests.items.map((p) => [p.number, p.onBranch, p.mine])).toEqual([
      [9, true, true],
      [8, false, false],
    ]);
    expect(snap.attention).toEqual([expect.objectContaining({ kind: 'pr', text: 'PR #9 · CI failing' })]);
    expect(session.pullRequestUrl(9)).toBe('https://github.com/acme/atlas/pull/9');
    // The first list is what was already open; a higher number later is new.
    expect(snap.ide.history.some((h) => h.kind === 'pr')).toBe(false);

    emit({ type: 'github.prs', state: 'ok', repo: 'acme/atlas', viewer: 'me', items: [pr(10, { title: 'Secret plan' }), pr(9), pr(8)] });
    emit({ type: 'github.prs', state: 'error', repo: 'acme/atlas', items: [] });
    clock.advance(250);
    snap = session.latestSnapshot!;
    expect(snap.ide.history[0]).toMatchObject({ kind: 'pr', label: 'PR #10 opened Secret plan', tone: 'good' });
    expect(snap.ide.pullRequests).toMatchObject({ state: 'error' });
    expect(snap.ide.pullRequests.items).toHaveLength(3);

    session.setStreaming(true);
    clock.advance(250);
    snap = session.latestSnapshot!;
    expect(snap.ide.pullRequests.items[0]).toMatchObject({ number: 10, title: undefined, branch: undefined, author: undefined });
    expect(snap.ide.history[0].label).toBe('PR #10 opened');
    expect(JSON.stringify(snap)).not.toContain('Secret plan');
  });
});

describe('display commands', () => {
  it('accepts the new clicks and nothing malformed', () => {
    for (const cmd of [{ type: 'focusAgent' }, { type: 'focusAgent', agentId: 'claude:1' }, { type: 'openSourceControl' }, { type: 'openPullRequest', number: 9 }, { type: 'connectGitHub' }]) {
      expect(isClientCommand(cmd), JSON.stringify(cmd)).toBe(true);
    }
    for (const cmd of [{ type: 'openPullRequest', number: '9' }, { type: 'openPullRequest', number: 0 }, { type: 'openPullRequest', number: 1.5 }, { type: 'focusAgent', agentId: 7 }]) {
      expect(isClientCommand(cmd), JSON.stringify(cmd)).toBe(false);
    }
  });
});
