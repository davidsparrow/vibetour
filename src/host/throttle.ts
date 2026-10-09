/**
 * Rate limiters used by the adapters to turn noisy editor and file-system
 * signals into a calm stream of development events.
 */

type Timer = ReturnType<typeof setTimeout>;

const PRUNE_AT = 512;

/**
 * Per-key throttle. The first value for a key is emitted immediately; values
 * arriving within `intervalMs` of the last emission are merged and emitted
 * once the interval has passed, so bursts are coalesced without losing their
 * total. With `trailing: false` they are dropped instead — right for signals
 * that carry no payload worth keeping, such as "this file changed".
 */
export class Throttle<V> {
  private readonly last = new Map<string, number>();
  private readonly pending = new Map<string, { value: V; timer: Timer }>();

  constructor(
    private readonly intervalMs: number,
    private readonly merge: (prev: V, next: V) => V,
    private readonly emit: (key: string, value: V) => void,
    private readonly trailing = true,
  ) {}

  push(key: string, value: V): void {
    const queued = this.pending.get(key);
    if (queued) {
      queued.value = this.merge(queued.value, value);
      return;
    }
    const now = Date.now();
    const last = this.last.get(key);
    if (last === undefined || now - last >= this.intervalMs) {
      this.fire(key, value, now);
      return;
    }
    if (!this.trailing) return;
    const timer = setTimeout(() => this.flushKey(key), this.intervalMs - (now - last));
    this.pending.set(key, { value, timer });
  }

  /** Emits everything that is waiting for its interval to pass. */
  flush(): void {
    for (const key of [...this.pending.keys()]) this.flushKey(key);
  }

  dispose(): void {
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    this.last.clear();
  }

  private flushKey(key: string): void {
    const queued = this.pending.get(key);
    if (!queued) return;
    clearTimeout(queued.timer);
    this.pending.delete(key);
    this.fire(key, queued.value, Date.now());
  }

  private fire(key: string, value: V, now: number): void {
    this.last.set(key, now);
    if (this.last.size > PRUNE_AT) {
      for (const [k, at] of this.last) if (now - at >= this.intervalMs && !this.pending.has(k)) this.last.delete(k);
    }
    this.emit(key, value);
  }
}

/** Runs `fn` once triggers have been quiet for `delayMs`. */
export class Debouncer {
  private timer?: Timer;

  constructor(
    private readonly delayMs: number,
    private readonly fn: () => void,
  ) {}

  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fn();
    }, this.delayMs);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
