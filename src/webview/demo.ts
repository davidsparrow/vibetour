import { fileRef, type DevEventBody, type PullRequestRef } from '../core/events';
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

const RADIO_NOTE = 'Internet radio needs the VS Code extension or the CLI.';

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
  /** The autopilot's own intervals; consequences scheduled with later() are not in here. */
  private timers: number[] = [];
  private phaseTimer?: number;
  private phaseIndex = 0;
  private autopilot: boolean;
  private changes = 0;
  private staged = 0;
  private fileIndex = 0;
  private context = 0.2;
  private procId = 0;

  constructor(
    private readonly speed = 1,
    autopilot = true,
    persist = true,
    yourTurnStopMs: number | null = null,
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
      yourTurnStopMs,
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
          capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false, focusAgent: true, openScm: true, openLinks: true, connectGitHub: true, radio: false },
          radioNote: RADIO_NOTE,
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
    if (cmd.type === 'radioSearch' || cmd.type === 'radioLocal' || cmd.type === 'radioTune') {
      this.listener?.({ type: 'toast', text: RADIO_NOTE });
      return;
    }
    if (cmd.type === 'musicWatch') return;
    if (cmd.type === 'focusAgent') {
      this.listener?.({ type: 'toast', text: 'In VS Code this takes you to Claude.' });
      return;
    }
    if (cmd.type === 'openSourceControl') {
      this.listener?.({ type: 'toast', text: 'In VS Code this opens Source Control.' });
      return;
    }
    if (cmd.type === 'openProblems') {
      this.listener?.({ type: 'toast', text: 'In VS Code this opens Problems.' });
      return;
    }
    if (cmd.type === 'openPullRequest') {
      this.listener?.({ type: 'toast', text: `In VS Code this opens PR #${cmd.number} on GitHub.` });
      return;
    }
    if (cmd.type === 'connectGitHub') {
      this.showPullRequests();
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

  /** Made-up pull requests: one on this branch with failing CI, so it lights the branch and raises an alert. */
  private showPullRequests(): void {
    const ago = (hours: number) => this.now() - hours * 3_600_000;
    const pr = (number: number, title: string, branch: string, author: string, hours: number, more: Partial<PullRequestRef>): PullRequestRef => ({
      number,
      title,
      url: `https://github.com/atlas/atlas/pull/${number}`,
      branch,
      base: 'main',
      author,
      draft: false,
      createdAt: ago(hours),
      crossRepo: false,
      ci: 'passing',
      review: 'review-required',
      conflict: false,
      ...more,
    });
    this.ev({
      type: 'github.prs',
      state: 'ok',
      repo: 'atlas/atlas',
      viewer: 'you',
      items: [
        pr(42, 'Onboarding flow', 'feature/onboarding', 'you', 3, { ci: 'failing', ahead: 4, behind: 1 }),
        pr(41, 'Faster session refresh', 'fix/session-refresh', 'sam', 26, { review: 'approved', ahead: 2, behind: 0 }),
        pr(39, 'Dark mode tokens', 'feat/dark-mode', 'alex', 75, { draft: true, ahead: 7, behind: 12 }),
      ],
    });
  }

  private gitStatus(): void {
    // The files the session has touched, as many as there are changes.
    const files = FILES.slice(0, Math.min(FILES.length, this.changes + this.staged));
    this.ev({ type: 'git', branch: 'feature/onboarding', repo: 'atlas', changes: this.changes, staged: this.staged, ahead: 1, behind: 0, files });
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
        // The context window fills as Claude works, then a compaction frees it up.
        this.context = this.context >= 0.85 ? 0.3 : this.context + 0.05;
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'tool', detail: ['Using Edit', 'Using Bash', 'Using Read', 'Using Grep'][this.fileIndex % 4], context: this.context });
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
        this.ev({ type: 'agent', agentId: 'claude:demo', name: 'Claude', role: 'copilot', status: 'waiting', ask: 'question', detail: 'Has a question for you' });
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

  /**
   * Schedules the consequence of an action (tests finishing, errors clearing).
   * It always happens: stopping the autopilot must not leave a test run going forever.
   */
  private later(ms: number, fn: () => void): void {
    window.setTimeout(fn, ms);
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearInterval(t);
    this.timers = [];
    if (this.phaseTimer) window.clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
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
