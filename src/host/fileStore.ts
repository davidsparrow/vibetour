import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyValueStore } from '../core/session';

/**
 * A KeyValueStore persisted as one JSON file (used by the standalone CLI).
 * Values are copied in and out, like MemoryStore, so callers can never mutate
 * stored state by accident. Writes are coalesced (at most one per `delayMs`)
 * and atomic: a temp file is written and renamed over the original.
 */
export class JsonFileStore implements KeyValueStore {
  private data: Record<string, unknown> = {};
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;

  constructor(
    readonly file: string,
    private readonly delayMs = 1_000,
    private readonly log?: (msg: string) => void,
  ) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.data = parsed as Record<string, unknown>;
    } catch {
      // Keep the unreadable file for the user instead of silently overwriting it.
      const aside = `${file}.corrupt-${Date.now()}`;
      try {
        renameSync(file, aside);
      } catch {
        /* best effort */
      }
      this.log?.(`Could not read ${file}; moved it to ${aside} and started fresh.`);
    }
  }

  get<T>(key: string): T | undefined {
    const value = this.data[key];
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  }

  set(key: string, value: unknown): void {
    if (value === undefined) delete this.data[key];
    else this.data[key] = JSON.parse(JSON.stringify(value));
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** Writes pending changes now. Safe to call from exit handlers. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      this.log?.(`Could not save ${this.file}: ${(err as Error).message}`);
    }
  }
}
