import { readdirSync, statSync, watch, type Dirent, type FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { isIgnoredPath } from '../host/paths';

/**
 * Watches a project tree for file changes, skipping dependency, build and
 * cache directories. macOS and Windows get one native recursive watcher. On
 * Linux, Node's recursive mode would walk and watch node_modules too, so we
 * watch each relevant directory ourselves (bounded), adding new ones as they
 * appear — which is also the fallback wherever recursive watching fails.
 */

const MAX_DIRS = 4_000;
const MAX_DEPTH = 12;

export class TreeWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private warnedLimit = false;

  constructor(
    private readonly root: string,
    /** Called with a root-relative path (forward slashes) for every change outside ignored dirs. */
    private readonly onChange: (relPath: string) => void,
    private readonly log: (msg: string) => void = () => undefined,
  ) {}

  /** Number of OS watchers in use. */
  get size(): number {
    return this.watchers.size;
  }

  start(): void {
    if (process.platform !== 'linux') {
      try {
        const w = watch(this.root, { recursive: true }, (_event, name) => {
          if (name) this.report(name.toString());
        });
        w.on('error', (err) => this.log(`File watching stopped: ${err.message}`));
        this.watchers.set(this.root, w);
        return;
      } catch {
        this.log('Recursive file watching is unavailable here; watching directories individually.');
      }
    }
    this.addTree(this.root, 0);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  private rel(abs: string): string {
    return relative(this.root, abs).split(sep).join('/');
  }

  private report(relPath: string): void {
    const clean = relPath.split(sep).join('/');
    if (clean && !isIgnoredPath(clean)) this.onChange(clean);
  }

  private addTree(dir: string, depth: number): void {
    if (this.watchers.has(dir)) return;
    if (this.watchers.size >= MAX_DIRS) {
      if (!this.warnedLimit) this.log(`Watching the first ${MAX_DIRS} directories only.`);
      this.warnedLimit = true;
      return;
    }
    let w: FSWatcher;
    try {
      w = watch(dir, (event, name) => name && this.onDirEvent(dir, depth, event, name.toString()));
    } catch {
      return;
    }
    w.on('error', () => {
      w.close();
      this.watchers.delete(dir);
    });
    this.watchers.set(dir, w);
    if (depth >= MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = join(dir, e.name);
      if (!isIgnoredPath(this.rel(child))) this.addTree(child, depth + 1);
    }
  }

  private onDirEvent(dir: string, depth: number, event: string, name: string): void {
    const abs = join(dir, name);
    const rel = this.rel(abs);
    if (isIgnoredPath(rel)) return;
    if (event === 'rename') {
      let isDir = false;
      try {
        isDir = statSync(abs).isDirectory();
      } catch {
        // Gone: stop watching it if it was a directory.
        this.watchers.get(abs)?.close();
        this.watchers.delete(abs);
      }
      if (isDir) {
        if (depth < MAX_DEPTH) this.addTree(abs, depth + 1);
        return;
      }
    }
    this.report(rel);
  }
}
