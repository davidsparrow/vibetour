import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, type Stats } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyValueStore } from '../core/session';

/**
 * A KeyValueStore persisted as one JSON file (used by the standalone CLI).
 * Values are copied in and out, like MemoryStore, so callers can never mutate
 * stored state by accident. Writes are coalesced (at most one per `delayMs`)
 * and atomic: a temp file is written and renamed over the original.
 *
 * Several CLIs (one per project) share the global file, so each one reloads
 * it when another process has written it, and a flush writes only the keys
 * this process changed on top of what is on disk.
 */
export class JsonFileStore implements KeyValueStore {
  private data: Record<string, unknown> = {};
  /** Keys set or deleted here since the last flush. */
  private readonly pending = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  /** Identity of the file as this process last read or wrote it (see `version`). */
  private seen = '';

  constructor(
    readonly file: string,
    private readonly delayMs = 1_000,
    private readonly log?: (msg: string) => void,
  ) {
    const disk = this.readDisk();
    if (disk === 'corrupt') {
      // Keep the unreadable file for the user instead of silently overwriting it.
      const aside = `${file}.corrupt-${Date.now()}`;
      try {
        renameSync(file, aside);
      } catch {
        /* best effort */
      }
      this.log?.(`Could not read ${file}; moved it to ${aside} and started fresh.`);
    } else if (disk) {
      this.data = disk.data;
      this.seen = disk.version;
    }
  }

  get<T>(key: string): T | undefined {
    this.sync();
    const value = this.data[key];
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  }

  set(key: string, value: unknown): void {
    if (value === undefined) delete this.data[key];
    else this.data[key] = JSON.parse(JSON.stringify(value));
    this.pending.add(key);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes pending changes now. Safe to call from exit handlers. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending.size) return;
    this.sync();
    this.pending.clear();
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      const written = version(statSync(tmp));
      renameSync(tmp, this.file);
      this.seen = written;
    } catch (err) {
      this.log?.(`Could not save ${this.file}: ${(err as Error).message}`);
    }
  }

  /** Picks up another process's write, keeping this process's unsaved changes on top. */
  private sync(): void {
    let current: string;
    try {
      current = version(statSync(this.file));
    } catch {
      return;
    }
    if (current === this.seen) return;
    const disk = this.readDisk();
    if (!disk || disk === 'corrupt') return;
    const mine = this.data;
    this.data = disk.data;
    for (const key of this.pending) {
      if (key in mine) this.data[key] = mine[key];
      else delete this.data[key];
    }
    this.seen = disk.version;
  }

  private readDisk(): { data: Record<string, unknown>; version: string } | 'corrupt' | undefined {
    let raw: string;
    let v: string;
    try {
      v = version(statSync(this.file));
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
      return { data, version: v };
    } catch {
      return 'corrupt';
    }
  }
}

/** Every save renames a fresh file into place, so the inode changes too: writes stay distinguishable where mtimes are coarse. */
function version(s: Stats): string {
  return `${s.ino}:${s.mtimeMs}:${s.size}`;
}
