import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRANCHES_INTERVAL_MS, BranchTracker, gitBranchSource, parseRefs, pickBase, type BranchesEvent, type BranchSource, type RefList } from '../src/host/branches';

/** A repository in memory: its refs, and how far each branch is from main. */
function fakeSource(refs: RefList, counts: Record<string, { ahead: number; behind: number }>) {
  const calls: string[] = [];
  const source: BranchSource = {
    listRefs: async () => refs,
    count: async (base, branch) => {
      calls.push(`${base}...${branch}`);
      const c = counts[branch.replace('refs/heads/', '')];
      if (!c) throw new Error(`no ${branch}`);
      return c;
    },
  };
  return { source, calls, refs, counts };
}

function tracker(source: BranchSource) {
  const events: BranchesEvent[] = [];
  const t = new BranchTracker(source, (e) => events.push(e));
  return { t, events };
}

const repo = (): RefList => ({
  local: [
    { name: 'feat/a', commit: 'a1' },
    { name: 'main', commit: 'm1' },
    { name: 'old/merged', commit: 'o1' },
    { name: 'spike', commit: 's1' },
  ],
  remote: [
    { name: 'origin/main', commit: 'm2' },
    { name: 'origin/feat/a', commit: 'a1' },
  ],
  head: 'spike',
  github: true,
});

describe('branches beside main', () => {
  afterEach(() => vi.useRealTimers());

  it("compares with the remote's main, and lists the checkout first, then branches with commits main lacks", async () => {
    const { source, calls } = fakeSource(repo(), {
      'feat/a': { ahead: 3, behind: 1 },
      main: { ahead: 0, behind: 2 },
      'old/merged': { ahead: 0, behind: 40 },
      spike: { ahead: 1, behind: 5000 },
    });
    const { t, events } = tracker(source);
    t.update('spike@s1');
    await t.idle();
    expect(calls[0]).toBe('refs/remotes/origin/main...refs/heads/spike');
    expect(events).toEqual([
      {
        type: 'git.branches',
        base: 'main',
        items: [
          // Never pushed, so GitHub can't compare it; counts stop at 1000.
          { name: 'spike', ahead: 1, behind: 1000, current: true, link: false },
          { name: 'feat/a', ahead: 3, behind: 1, current: false, link: true },
        ],
      },
    ]);
  });

  it('shows the checkout even with nothing ahead, but not a local main level with the remote one', async () => {
    const refs = { ...repo(), head: 'old/merged' };
    const counts = { 'feat/a': { ahead: 3, behind: 1 }, main: { ahead: 0, behind: 0 }, 'old/merged': { ahead: 0, behind: 40 }, spike: { ahead: 1, behind: 2 } };
    let { t, events } = tracker(fakeSource(refs, counts).source);
    t.update('old/merged@o1');
    await t.idle();
    expect(events[0].items.map((b) => [b.name, b.current])).toEqual([
      ['old/merged', true],
      ['feat/a', false],
      ['spike', false],
    ]);

    ({ t, events } = tracker(fakeSource({ ...repo(), head: 'main' }, counts).source));
    t.update('main@m1');
    await t.idle();
    expect(events[0].items.map((b) => b.name)).toEqual(['feat/a', 'spike']);
  });

  it('falls back to a local main, which is then the base and not a branch', async () => {
    const refs: RefList = { local: [{ name: 'main', commit: 'm1' }, { name: 'feat/a', commit: 'a1' }], remote: [], head: 'main', github: false };
    const { source, calls } = fakeSource(refs, { 'feat/a': { ahead: 2, behind: 0 } });
    expect(pickBase(refs)).toMatchObject({ ref: 'refs/heads/main', name: 'main' });
    const { t, events } = tracker(source);
    t.update('main@m1');
    await t.idle();
    expect(calls).toEqual(['refs/heads/main...refs/heads/feat/a']);
    expect(events[0]).toEqual({ type: 'git.branches', base: 'main', items: [{ name: 'feat/a', ahead: 2, behind: 0, current: false, link: false }] });
  });

  it('reports no base when there is no main or master', async () => {
    const { t, events } = tracker(fakeSource({ local: [{ name: 'trunk', commit: 't1' }], remote: [], head: 'trunk', github: true }, {}).source);
    t.update('trunk@t1');
    await t.idle();
    expect(events).toEqual([{ type: 'git.branches', items: [] }]);
  });

  it('recounts only the branches that moved, and reports only changes', async () => {
    vi.useFakeTimers();
    const fake = fakeSource(repo(), { 'feat/a': { ahead: 3, behind: 1 }, main: { ahead: 0, behind: 2 }, 'old/merged': { ahead: 0, behind: 40 }, spike: { ahead: 1, behind: 2 } });
    const { t, events } = tracker(fake.source);
    t.update('spike@s1');
    await t.idle();
    expect(fake.calls).toHaveLength(4);

    // Nothing moved: a look half a minute later counts nothing and says nothing.
    vi.advanceTimersByTime(BRANCHES_INTERVAL_MS);
    t.update('spike@s1');
    await t.idle();
    expect(fake.calls).toHaveLength(4);
    expect(events).toHaveLength(1);

    // A commit on spike: only spike is counted again, at once.
    fake.refs.local[3] = { name: 'spike', commit: 's2' };
    fake.counts.spike = { ahead: 2, behind: 2 };
    t.update('spike@s2');
    await t.idle();
    expect(fake.calls.slice(4)).toEqual(['refs/remotes/origin/main...refs/heads/spike']);
    expect(events.at(-1)!.items[0]).toMatchObject({ name: 'spike', ahead: 2 });
    t.dispose();
  });

  it('looks at once when the checkout moves, otherwise at most every 30 seconds', async () => {
    vi.useFakeTimers();
    let looks = 0;
    const base = fakeSource(repo(), { 'feat/a': { ahead: 3, behind: 1 }, main: { ahead: 0, behind: 2 }, 'old/merged': { ahead: 0, behind: 40 }, spike: { ahead: 1, behind: 2 } });
    const source: BranchSource = { ...base.source, listRefs: async () => (looks++, base.refs) };
    const { t } = tracker(source);
    t.update('spike@s1');
    await t.idle();
    t.update('spike@s1');
    t.update('spike@s1');
    await t.idle();
    expect(looks).toBe(1);
    // A fetch or a new branch shows once the interval is up.
    await vi.advanceTimersByTimeAsync(BRANCHES_INTERVAL_MS);
    await t.idle();
    expect(looks).toBe(2);
    t.update('feat/a@a1');
    await t.idle();
    expect(looks).toBe(3);
    t.dispose();
    await vi.advanceTimersByTimeAsync(BRANCHES_INTERVAL_MS * 2);
    expect(looks).toBe(3);
  });

  it('logs a failing look once, and keeps going', async () => {
    const log = vi.fn();
    let fail = true;
    const ok = fakeSource(repo(), { 'feat/a': { ahead: 3, behind: 1 } });
    const source: BranchSource = { ...ok.source, listRefs: async () => (fail ? Promise.reject(new Error('not a git repository')) : ok.refs) };
    const events: BranchesEvent[] = [];
    const t = new BranchTracker(source, (e) => events.push(e), log);
    t.update('a');
    await t.idle();
    t.update('b');
    await t.idle();
    expect(log).toHaveBeenCalledTimes(1);
    fail = false;
    t.update('c');
    await t.idle();
    // Branches it couldn't count are left out, not guessed.
    expect(events[0].items.map((b) => b.name)).toEqual(['feat/a']);
  });

  it('gives only plain branch names a link', async () => {
    const refs: RefList = { local: [{ name: 'feat/a&b', commit: 'x' }], remote: [{ name: 'origin/main', commit: 'm' }, { name: 'origin/feat/a&b', commit: 'x' }], github: true };
    const { t, events } = tracker(fakeSource(refs, { 'feat/a&b': { ahead: 1, behind: 0 } }).source);
    t.update('x');
    await t.idle();
    expect(events[0].items[0]).toMatchObject({ name: 'feat/a&b', link: false });
  });
});

describe('asking git about branches', () => {
  it("reads for-each-ref's list, skipping origin/HEAD and names that could pass for options", () => {
    const out = ['*\trefs/heads/feat/a\taaa', ' \trefs/heads/main\tmmm', ' \trefs/heads/-rf\tbad', ' \trefs/remotes/origin/HEAD\tmmm', ' \trefs/remotes/origin/main\tmmm', 'junk', ''].join('\n');
    expect(parseRefs(out, true)).toEqual({
      local: [
        { name: 'feat/a', commit: 'aaa' },
        { name: 'main', commit: 'mmm' },
      ],
      remote: [{ name: 'origin/main', commit: 'mmm' }],
      head: 'feat/a',
      github: true,
    });
  });

  it('counts with rev-list: behind on the left, ahead on the right', async () => {
    const runs: string[][] = [];
    const source = gitBranchSource(
      async (args) => (runs.push(args), args[0] === 'rev-list' ? '7\t2\n' : ''),
      () => false,
    );
    expect(await source.count('refs/remotes/origin/main', 'refs/heads/feat/a')).toEqual({ ahead: 2, behind: 7 });
    expect(runs[0]).toEqual(['rev-list', '--left-right', '--count', 'refs/remotes/origin/main...refs/heads/feat/a']);
    await expect(gitBranchSource(async () => 'fatal', () => false).count('a', 'b')).rejects.toThrow();
  });
});
