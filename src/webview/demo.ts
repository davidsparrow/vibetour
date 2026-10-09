import { fileRef, type DevEventBody } from '../core/events';
import type { ClientCommand, HostMessage } from '../core/protocol';
import { MemoryStore, VibeTourSession, type KeyValueStore } from '../core/session';
import { VERSION } from '../host/version';
import { BUILTIN_PACKS } from '../packs';
import { safeStorage } from './transport';

/**
 * Browser-only demo host: runs the real VibeTour engine with a simulated
 * coding session so anyone can try VibeTour without an IDE (and so the UI can
 * be tested end to end). Nothing here touches real source code.
 */

class LocalStore implements KeyValueStore {
  private readonly fallback = new MemoryStore();
  constructor(private readonly prefix: string) {}
  get<T>(key: string): T | undefined {
    try {
      const raw = safeStorage()?.getItem(this.prefix + key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* fall through */
    }
    return this.fallback.get<T>(key);
  }
  set(key: string, value: unknown): void {
    this.fallback.set(key, value);
    try {
      const s = safeStorage();
      if (!s) return;
      if (value === undefined) s.removeItem(this.prefix + key);
      else s.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked */
    }
  }
}

export type DemoAction =
  | 'type'
  | 'agent'
  | 'tests-pass'
  | 'tests-fail'
  | 'ask'
  | 'answer'
  | 'commit'
  | 'errors'
  | 'idle'
  | 'review';

const FILES = [
  'src/onboarding/OnboardingFlow.tsx',
  'src/onboarding/steps.ts',
  'src/api/session.ts',
  'src/components/Button.tsx',
  'src/hooks/useProfile.ts',
  'tests/onboarding.test.ts',
];

interface Phase {
  name: string;
  seconds: number;
  enter?: () => void;
  every?: { seconds: number; run: (i: number) => void };
  exit?: () => void;
}

export class DemoHost {
  readonly session: VibeTourSession;
  private listener?: (m: HostMessage) => void;
  private readonly t0 = Date.now();
  private timers: number[] = [];
  private phaseTimer?: number;
  private phaseIndex = 0;
  private autopilot: boolean;
  private changes = 0;
  private staged = 0;
  private fileIndex = 0;
  private procId = 0;

  constructor(
    private readonly speed = 1,
    autopilot = true,
    persist = true,
  ) {
    this.autopilot = autopilot;
    const store = (scope: string) => (persist ? new LocalStore(`vibetour.demo.${scope}.`) : new MemoryStore());
    this.session = new VibeTourSession({
      packs: BUILTIN_PACKS,
      globalStore: store('global'),
      projectStore: store('project'),
      project: 'atlas',
      now: () => this.t0 + (Date.now() - this.t0) * this.speed,
      autoResume: true,
    });
    this.session.onSnapshot((snapshot) => this.listener?.({ type: 'snapshot', snapshot }));
    this.session.onCatalog((catalog) => this.listener?.({ type: 'catalog', catalog }));
    window.setInterval(() => this.session.tick(), 250);
    this.ev({ type: 'window.focus', focused: true });
    this.ev({ type: 'git', branch: 'feature/onboarding', repo: 'atlas', changes: 0, staged: 0, ahead: 0, behind: 0 });
    this.ev({ type: 'editor.focus', file: fileRef(FILES[0], 'TypeScript React') });
    if (autopilot) this.startPhase(0);
  }

  connect(listener: (m: HostMessage) => void): void {
    this.listener = listener;
  }

  get isAutopilot(): boolean {
    return this.autopilot;
  }

  setAutopilot(on: boolean): void {
    this.autopilot = on;
    this.clearTimers();
    if (on) this.startPhase(this.phaseIndex);
  }

  handle(cmd: ClientCommand): void {
    if (cmd.type === 'ready') {
      this.listener?.({
        type: 'hello',
        host: {
          kind: 'demo',
          version: VERSION,
          projectName: 'atlas',
          capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false },
        },
        catalog: this.session.catalog(),
      });
      this.session.tick();
      return;
    }
    if (cmd.type === 'openDocs' || cmd.type === 'openFile' || cmd.type === 'focusIde') {
      this.listener?.({ type: 'toast', text: 'In VS Code this opens right in your editor.' });
      return;
    }
    this.session.handleCommand(cmd);
  }

  // ------------------------------------------------------------- simulation

  private now(): number {
    return this.t0 + (Date.now() - this.t0) * this.speed;
  }

  private ev(body: DevEventBody): void {
    this.session.ingest({ ...body, at: this.now() } as never);
  }

  private nextFile(): string {
    this.fileIndex = (this.fileIndex + 1) % FILES.length;
    return FILES[this.fileIndex];
  }

  private gitStatus(): void {
    this.ev({ type: 'git', branch: 'feature/onboarding', repo: 'atlas', changes: this.changes, staged: this.staged, ahead: 1, behind: 0 });
  }

  /** Runs one scripted action; also used by the interactive demo controls. */
  trigger(action: DemoAction): void {
    switch (action) {
      case 'type': {
        const f = FILES[this.fileIndex];
        this.ev({ type: 'editor.focus', file: fileRef(f, 'TypeScript') });
        this.ev({ type: 'editor.edit', file: fileRef(f, 'TypeScript'), origin: 'user', magnitude: 18 });
        break;
      }
      case 'agent': {
        const f = this.nextFile();
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'tool', detail: ['Using Edit', 'Using Bash', 'Using Read', 'Using Grep'][this.fileIndex % 4] });
        this.ev({ type: 'fs.external', file: fileRef(f, 'TypeScript') });
        this.changes = Math.min(12, this.changes + 1);
        this.gitStatus();
        break;
      }
      case 'tests-pass':
      case 'tests-fail': {
        const id = `t${++this.procId}`;
        this.ev({ type: 'process.start', id, kind: 'test', label: 'npm test' });
        this.later(this.scaled(action === 'tests-pass' ? 22 : 12), () =>
          this.ev({ type: 'process.end', id, kind: 'test', label: 'npm test', exitCode: action === 'tests-pass' ? 0 : 1 }),
        );
        break;
      }
      case 'ask':
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'waiting', detail: 'Needs your approval' });
        break;
      case 'answer':
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'working', detail: 'Working on your request' });
        break;
      case 'commit':
        this.ev({ type: 'git.commit', message: 'Add onboarding flow' });
        this.changes = 0;
        this.staged = 0;
        this.gitStatus();
        break;
      case 'errors':
        this.ev({
          type: 'diagnostics',
          errors: 2,
          warnings: 3,
          top: [
            { file: fileRef('src/onboarding/steps.ts'), line: 42, severity: 'error', message: "Property 'next' does not exist on type 'Step'." },
            { file: fileRef('src/api/session.ts'), line: 17, severity: 'error', message: 'Cannot find name "refreshToken".' },
            { file: fileRef('src/components/Button.tsx'), line: 8, severity: 'warning', message: "'variant' is declared but never read." },
          ],
        });
        this.later(this.scaled(20), () => this.ev({ type: 'diagnostics', errors: 0, warnings: 1, top: [] }));
        break;
      case 'review':
        this.ev({ type: 'editor.review', file: fileRef(FILES[0], 'TypeScript React') });
        break;
      case 'idle':
        this.clearTimers();
        this.autopilot = false;
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'done', detail: 'Finished — your turn' });
        break;
    }
  }

  private scaled(seconds: number): number {
    return (seconds * 1000) / this.speed;
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    this.timers = [];
    if (this.phaseTimer) window.clearTimeout(this.phaseTimer);
  }

  /** The PRD §6 story on a loop: code, agent, tests, a question, review, think. */
  private readonly phases: Phase[] = [
    {
      name: 'coding',
      seconds: 50,
      every: {
        seconds: 1.6,
        run: (i) => {
          this.trigger('type');
          if (i % 6 === 5) {
            this.ev({ type: 'editor.save', file: fileRef(FILES[this.fileIndex], 'TypeScript') });
            this.changes = Math.min(12, this.changes + 1);
            this.gitStatus();
          }
          if (i === 8) this.trigger('errors');
        },
      },
    },
    {
      name: 'agent',
      seconds: 45,
      enter: () => {
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'working', detail: 'Working on your request' });
        this.ev({ type: 'agent', agentId: 'claude:demo:qa', name: 'QA', role: 'qa', status: 'working', detail: 'Writing tests', parentId: 'claude:demo' });
        this.later(this.scaled(24), () => this.ev({ type: 'agent.remove', agentId: 'claude:demo:qa' }));
      },
      every: { seconds: 2.6, run: () => this.trigger('agent') },
    },
    { name: 'tests', seconds: 28, enter: () => this.trigger('tests-pass') },
    {
      name: 'question',
      seconds: 26,
      enter: () => this.trigger('ask'),
      exit: () => this.trigger('answer'),
    },
    {
      name: 'review',
      seconds: 30,
      every: { seconds: 3, run: (i) => (i % 3 === 2 ? this.trigger('type') : this.trigger('review')) },
      exit: () => this.trigger('commit'),
    },
    {
      name: 'thinking',
      seconds: 35,
      enter: () => this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'done', detail: 'Finished — your turn' }),
    },
  ];

  private startPhase(index: number): void {
    if (!this.autopilot) return;
    this.phaseIndex = index % this.phases.length;
    const phase = this.phases[this.phaseIndex];
    phase.enter?.();
    if (phase.every) {
      let i = 0;
      const id = window.setInterval(() => phase.every!.run(i++), this.scaled(phase.every.seconds));
      this.timers.push(id);
      phase.every.run(i++);
    }
    this.phaseTimer = window.setTimeout(() => {
      phase.exit?.();
      this.clearTimers();
      this.startPhase(this.phaseIndex + 1);
    }, this.scaled(phase.seconds));
  }
}
