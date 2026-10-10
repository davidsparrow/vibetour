import type { ClientCommand, ClientPrefs, HostMessage } from '../core/protocol';
import type { DemoHost } from './demo';

/** How the browser app talks to whichever host is driving it. */
export interface Transport {
  readonly kind: 'vscode' | 'companion' | 'demo';
  send(cmd: ClientCommand): void;
  onMessage(cb: (msg: HostMessage) => void): void;
  onStatus(cb: (connected: boolean) => void): void;
  /** Display-local preferences (a companion screen may differ from the IDE panel). */
  loadPrefs(): Partial<ClientPrefs> | undefined;
  savePrefs(prefs: ClientPrefs): void;
  readonly demo?: DemoHost;
}

export function safeStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    const k = '__vt_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return undefined;
  }
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = safeStorage()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    safeStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode, blocked site data) */
  }
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export class VsCodeTransport implements Transport {
  readonly kind = 'vscode' as const;
  private readonly api = acquireVsCodeApi();
  private handlers: Array<(m: HostMessage) => void> = [];

  constructor() {
    window.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data as HostMessage;
      if (msg && typeof msg === 'object' && 'type' in msg) for (const h of this.handlers) h(msg);
    });
  }
  send(cmd: ClientCommand): void {
    this.api.postMessage(cmd);
  }
  onMessage(cb: (msg: HostMessage) => void): void {
    this.handlers.push(cb);
  }
  onStatus(cb: (connected: boolean) => void): void {
    cb(true);
  }
  loadPrefs(): Partial<ClientPrefs> | undefined {
    return (this.api.getState() as { prefs?: Partial<ClientPrefs> } | undefined)?.prefs;
  }
  savePrefs(prefs: ClientPrefs): void {
    this.api.setState({ prefs });
    this.send({ type: 'savePrefs', prefs });
  }
}

export class CompanionTransport implements Transport {
  readonly kind = 'companion' as const;
  private handlers: Array<(m: HostMessage) => void> = [];
  private statusHandlers: Array<(c: boolean) => void> = [];
  private source?: EventSource;

  constructor(private readonly token: string) {
    this.connect();
  }

  private connect(): void {
    this.source = new EventSource(`/events?token=${encodeURIComponent(this.token)}`);
    this.source.onopen = () => this.statusHandlers.forEach((h) => h(true));
    this.source.onerror = () => this.statusHandlers.forEach((h) => h(false));
    this.source.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as HostMessage;
        for (const h of this.handlers) h(msg);
      } catch {
        /* ignore malformed frames */
      }
    };
  }

  send(cmd: ClientCommand): void {
    fetch(`/command?token=${encodeURIComponent(this.token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    }).catch(() => this.statusHandlers.forEach((h) => h(false)));
  }
  onMessage(cb: (msg: HostMessage) => void): void {
    this.handlers.push(cb);
  }
  onStatus(cb: (connected: boolean) => void): void {
    this.statusHandlers.push(cb);
  }
  loadPrefs(): Partial<ClientPrefs> | undefined {
    return readJson('vibetour.prefs.companion');
  }
  savePrefs(prefs: ClientPrefs): void {
    writeJson('vibetour.prefs.companion', prefs);
  }
}

export class DemoTransport implements Transport {
  readonly kind = 'demo' as const;
  private handlers: Array<(m: HostMessage) => void> = [];

  constructor(readonly demo: DemoHost) {
    demo.connect((msg) => {
      for (const h of this.handlers) h(msg);
    });
  }
  send(cmd: ClientCommand): void {
    // Hand off asynchronously, like a real host.
    queueMicrotask(() => this.demo.handle(cmd));
  }
  onMessage(cb: (msg: HostMessage) => void): void {
    this.handlers.push(cb);
  }
  onStatus(cb: (connected: boolean) => void): void {
    cb(true);
  }
  loadPrefs(): Partial<ClientPrefs> | undefined {
    return readJson('vibetour.prefs.demo');
  }
  savePrefs(prefs: ClientPrefs): void {
    writeJson('vibetour.prefs.demo', prefs);
  }
}
