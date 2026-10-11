import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../src/cli/args';
import { GitPoller } from '../src/cli/gitPoller';
import { TreeWatcher } from '../src/cli/watch';
import type { DevEventBody } from '../src/core/events';
import { JsonFileStore } from '../src/host/fileStore';
import { CommitTracker, commitSubject, parsePorcelainStatus } from '../src/host/git';
import { companionCsp, renderAppHtml, webviewCsp } from '../src/host/html';
import { isIgnoredPath, isSafeRelativePath, languageForPath, languageName } from '../src/host/paths';
import { Debouncer, Throttle } from '../src/host/throttle';
import { VERSION } from '../src/host/version';

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), `vibetour-${prefix}-`));

describe('Throttle', () => {
  afterEach(() => vi.useRealTimers());

  it('emits the first value at once and merges a burst into one trailing emission', () => {
    vi.useFakeTimers();
    const out: Array<[string, number]> = [];
    const t = new Throttle<number>(500, (a, b) => a + b, (k, v) => out.push([k, v]));
    t.push('a.ts', 1);
    t.push('a.ts', 2);
    t.push('a.ts', 3);
    t.push('b.ts', 10);
    expect(out).toEqual([
      ['a.ts', 1],
      ['b.ts', 10],
    ]);
    vi.advanceTimersByTime(499);
    expect(out).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(out).toEqual([
      ['a.ts', 1],
      ['b.ts', 10],
      ['a.ts', 5],
    ]);
    vi.advanceTimersByTime(2_000);
    t.push('a.ts', 7);
    expect(out.at(-1)).toEqual(['a.ts', 7]);
  });

  it('drops values inside the interval when trailing is off', () => {
    vi.useFakeTimers();
    const out: string[] = [];
    const t = new Throttle<string>(1_000, (_a, b) => b, (_k, v) => out.push(v), false);
    t.push('f', 'one');
    t.push('f', 'two');
    vi.advanceTimersByTime(5_000);
    expect(out).toEqual(['one']);
    t.push('f', 'three');
    expect(out).toEqual(['one', 'three']);
  });

  it('flush emits pending values immediately', () => {
    vi.useFakeTimers();
    const out: number[] = [];
    const t = new Throttle<number>(500, (a, b) => a + b, (_k, v) => out.push(v));
    t.push('x', 1);
    t.push('x', 1);
    t.flush();
    expect(out).toEqual([1, 1]);
    t.dispose();
  });

  it('Debouncer waits for quiet', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = new Debouncer(300, fn);
    d.trigger();
    vi.advanceTimersByTime(200);
    d.trigger();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('paths', () => {
  it('ignores dependency, build and cache directories and temp files', () => {
    for (const p of ['node_modules/x/index.js', '.git/HEAD', 'packages/web/dist/app.js', 'out/a.js', 'build/x', 'src/__pycache__/a.pyc', 'target/debug/app', '.venv/lib/x.py', 'src/.a.ts.swp', 'notes.txt~', '.DS_Store']) {
      expect(isIgnoredPath(p), p).toBe(true);
    }
    for (const p of ['src/app.ts', 'README.md', 'docs/build-guide.md', 'src/distance.ts', 'output.txt']) expect(isIgnoredPath(p), p).toBe(false);
  });

  it('accepts only plain workspace-relative paths', () => {
    expect(isSafeRelativePath('src/app.ts')).toBe(true);
    for (const p of ['../etc/passwd', 'src/../../x', '/etc/passwd', 'C:\\Windows\\x', '', 42, 'a\0b']) expect(isSafeRelativePath(p), String(p)).toBe(false);
  });

  it('names languages for display', () => {
    expect(languageName('typescriptreact')).toBe('TypeScript');
    expect(languageName('elm')).toBe('Elm');
    expect(languageForPath('src/main.rs')).toBe('Rust');
    expect(languageForPath('Makefile')).toBeUndefined();
  });
});

describe('git helpers', () => {
  it('parses porcelain v1 status with branch info', () => {
    const out = ['## feature/login...origin/feature/login [ahead 2, behind 1]', 'M  staged.ts', ' M changed.ts', 'MM both.ts', '?? new.ts', 'R  old.ts -> renamed.ts', ''].join('\n');
    expect(parsePorcelainStatus(out)).toEqual({ branch: 'feature/login', hasUpstream: true, changes: 3, staged: 3, ahead: 2, behind: 1 });
    expect(parsePorcelainStatus('## No commits yet on main\n?? a\n')).toMatchObject({ branch: 'main', changes: 1, hasUpstream: false });
    expect(parsePorcelainStatus('## HEAD (no branch)\n').branch).toBeUndefined();
    expect(parsePorcelainStatus('## main\n')).toMatchObject({ branch: 'main', hasUpstream: false, ahead: 0 });
  });

  it('reports commits, not pulls, checkouts or the first look', () => {
    const t = new CommitTracker();
    const at = (branch: string, head: string, ahead = 0, hasUpstream = false) => t.update({ repo: 'r', branch, head, ahead, hasUpstream });
    expect(at('main', 'a1')).toEqual({ branchChanged: false, committed: false });
    expect(at('main', 'b2')).toEqual({ branchChanged: false, committed: true });
    expect(at('feature', 'c3')).toEqual({ branchChanged: true, committed: false });
    expect(at('main', 'b2')).toEqual({ branchChanged: true, committed: false });
    // Tracking an upstream: a commit moves us ahead, a pull does not.
    expect(at('main', 'd4', 1, true).committed).toBe(true);
    expect(at('main', 'e5', 1, true).committed).toBe(false);
    // Back to a commit we have already seen (reset): not a commit.
    expect(at('main', 'd4', 1, true).committed).toBe(false);
  });

  it('trims commit subjects', () => {
    expect(commitSubject('Fix the thing\n\nLong body')).toBe('Fix the thing');
    expect(commitSubject('x'.repeat(100))).toHaveLength(72);
    expect(commitSubject('  ')).toBeUndefined();
  });
});

describe('JsonFileStore', () => {
  afterEach(() => vi.useRealTimers());

  it('coalesces writes, writes atomically and privately, and copies values', () => {
    vi.useFakeTimers();
    const dir = temp('store');
    const file = join(dir, 'nested', 'state.json');
    try {
      const store = new JsonFileStore(file, 1_000);
      const value = { trips: 1, list: [1, 2] };
      store.set('a', value);
      value.trips = 99;
      expect(store.get('a')).toEqual({ trips: 1, list: [1, 2] });
      store.get<{ list: number[] }>('a')!.list.push(3);
      expect(store.get('a')).toEqual({ trips: 1, list: [1, 2] });
      expect(existsSync(file)).toBe(false);
      vi.advanceTimersByTime(1_000);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: { trips: 1, list: [1, 2] } });
      store.set('a', undefined);
      store.set('b', 'x');
      store.flush();
      expect(new JsonFileStore(file).get('b')).toBe('x');
      expect(new JsonFileStore(file).get('a')).toBeUndefined();
      expect(readdirSync(join(dir, 'nested'))).toEqual(['state.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets several processes share one file without losing each other\'s keys', () => {
    const dir = temp('store');
    try {
      const file = join(dir, 'state.json');
      const a = new JsonFileStore(file, 1_000);
      const b = new JsonFileStore(file, 1_000);
      a.set('stamps', ['from-a']);
      a.flush();
      expect(b.get('stamps')).toEqual(['from-a']);
      b.set('library', ['from-b']);
      b.flush();
      a.set('memories', ['from-a']);
      expect(a.get('library')).toEqual(['from-b']);
      a.flush();
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ stamps: ['from-a'], library: ['from-b'], memories: ['from-a'] });
      b.set('stamps', undefined);
      b.flush();
      expect(a.get('stamps')).toBeUndefined();
      expect(a.get('memories')).toEqual(['from-a']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sets a corrupt file aside instead of overwriting it', () => {
    const dir = temp('store');
    try {
      const file = join(dir, 'state.json');
      writeFileSync(file, '{oops');
      const log = vi.fn();
      const store = new JsonFileStore(file, 1_000, log);
      expect(store.get('x')).toBeUndefined();
      expect(log).toHaveBeenCalledOnce();
      expect(readdirSync(dir).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('app page', () => {
  it('renders the boot object and nonce, escaping hostile values', () => {
    const html = renderAppHtml({ boot: { host: 'companion', token: '</script><script>alert(1)' }, nonce: 'n"once', asset: (n) => `https://cdn/${n}?a=1&b="2"` });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('nonce="n&quot;once"');
    expect(html).toContain('href="https://cdn/app.css?a=1&amp;b=&quot;2&quot;"');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });

  it('puts the webview CSP in a meta tag before any resource', () => {
    const csp = webviewCsp('vscode-resource:', 'abc');
    const html = renderAppHtml({ boot: { host: 'vscode' }, nonce: 'abc', csp });
    expect(csp).toContain("script-src 'nonce-abc'");
    expect(csp).toContain("connect-src 'none'");
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<link'));
    expect(html).toContain('window.__VIBETOUR_BOOT__ = {"host":"vscode"};');
    expect(companionCsp('abc')).toContain("frame-ancestors 'none'");
  });

  it('has a version even when not bundled', () => {
    expect(VERSION).toBe('0.0.0-dev');
  });
});

describe('CLI arguments', () => {
  it('parses the documented options', () => {
    expect(parseArgs(['proj', '--port', '0', '--no-open', '--pack', 'california-coast', '--scope=coffee-run', '--streaming'], '/work')).toEqual({
      kind: 'run',
      opts: { dir: '/work/proj', port: 0, open: false, pack: 'california-coast', scope: 'coffee-run', streaming: true },
    });
    expect(parseArgs([], '/work')).toEqual({ kind: 'run', opts: { dir: '/work', port: 47477, open: true, scope: 'day-trip', streaming: false } });
    expect(parseArgs(['--help']).kind).toBe('help');
    expect(parseArgs(['--port', 'abc']).kind).toBe('error');
    expect(parseArgs(['--pack', 'atlantis']).kind).toBe('error');
    expect(parseArgs(['--scope', 'forever']).kind).toBe('error');
    expect(parseArgs(['a', 'b']).kind).toBe('error');
  });
});

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasGit)('GitPoller', () => {
  it('reports status, then a new commit with its subject', async () => {
    const dir = temp('git');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    try {
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'dev@example.com');
      git('config', 'user.name', 'Dev');
      writeFileSync(join(dir, 'a.txt'), 'a');
      git('add', '.');
      git('commit', '-qm', 'First');
      writeFileSync(join(dir, 'b.txt'), 'b');

      const events: DevEventBody[] = [];
      const poller = new GitPoller(dir, (e) => events.push(e), () => undefined, 60_000);
      await poller.poll();
      expect(events).toEqual([{ type: 'git', branch: 'main', repo: dir.split(/[\\/]/).pop(), changes: 1, staged: 0, ahead: 0, behind: 0 }]);

      git('add', '.');
      git('commit', '-qm', 'Add b\n\nWith a body');
      await poller.poll();
      expect(events.slice(1)).toEqual([
        { type: 'git', branch: 'main', repo: dir.split(/[\\/]/).pop(), changes: 0, staged: 0, ahead: 0, behind: 0 },
        { type: 'git.commit', message: 'Add b' },
      ]);

      git('checkout', '-qb', 'feature');
      await poller.poll();
      expect(events.at(-1)).toEqual({ type: 'git.branch', branch: 'feature' });
      poller.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TreeWatcher', () => {
  it('reports changed files but not ignored directories', async () => {
    const dir = temp('watch');
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules'));
    const seen = new Set<string>();
    const watcher = new TreeWatcher(dir, (rel) => seen.add(rel));
    try {
      watcher.start();
      writeFileSync(join(dir, 'node_modules', 'dep.js'), 'x');
      writeFileSync(join(dir, 'src', 'app.ts'), 'x');
      await vi.waitFor(() => expect(seen.has('src/app.ts')).toBe(true), { timeout: 2_000, interval: 25 });
      mkdirSync(join(dir, 'src', 'feature'));
      await new Promise((r) => setTimeout(r, 50));
      writeFileSync(join(dir, 'src', 'feature', 'new.ts'), 'x');
      await vi.waitFor(() => expect(seen.has('src/feature/new.ts')).toBe(true), { timeout: 2_000, interval: 25 });
      expect([...seen].some((p) => p.startsWith('node_modules'))).toBe(false);
    } finally {
      watcher.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
