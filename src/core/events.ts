/**
 * Provider-neutral development event model (PRD §16).
 *
 * Adapters (VS Code, the standalone CLI, agent hooks, the demo script) translate
 * whatever they observe into these events. Events carry metadata only — never
 * source contents (PRD §26).
 */

export interface FileRef {
  /** Workspace-relative path. */
  path: string;
  /** Base name, e.g. `auth.ts`. */
  name: string;
  language?: string;
}

export type ProcessKind = 'test' | 'build' | 'lint' | 'install' | 'run' | 'agent' | 'git' | 'other';

export type AgentStatus = 'working' | 'tool' | 'waiting' | 'idle' | 'done' | 'error';

/** What a waiting agent is waiting for: an answer, a plan's approval, or permission to use a tool. */
export type AgentAsk = 'question' | 'plan' | 'approval';

/** Aviation-style crew roles (PRD §15). */
export type AgentRole = 'copilot' | 'nav' | 'eng' | 'qa' | 'comms' | 'ops' | 'crew';

export type EditOrigin = 'user' | 'agent' | 'unknown';

/** Where the pull request feed stands: off until the user connects GitHub. */
export type PullRequestFeedState = 'off' | 'ok' | 'signed-out' | 'no-remote' | 'error';

/** One open pull request, as GitHub reports it. Metadata only: no diffs, no comments. */
export interface PullRequestRef {
  number: number;
  title: string;
  url: string;
  /** Its head branch, e.g. `feat/refuel`. */
  branch: string;
  base: string;
  author?: string;
  draft: boolean;
  createdAt: number;
  /** Opened from a fork: its branch is not one of this repository's. */
  crossRepo: boolean;
  ci: 'passing' | 'failing' | 'pending' | 'none';
  /** The head commit's latest deployment, when one reports to GitHub (Vercel, Netlify, Actions…). */
  deploy?: 'ok' | 'failing' | 'pending';
  /** That deployment's environment, e.g. `Preview`. */
  deployEnv?: string;
  review: 'approved' | 'changes-requested' | 'review-required' | 'none';
  conflict: boolean;
  /** Commits on the branch that the base lacks, and the base's commits it lacks. */
  ahead?: number;
  behind?: number;
}

export interface DiagnosticRef {
  file: FileRef;
  line: number;
  severity: 'error' | 'warning';
  message: string;
}

export type DevEventBody =
  | { type: 'editor.focus'; file: FileRef }
  | { type: 'editor.edit'; file: FileRef; origin: EditOrigin; magnitude: number }
  | { type: 'editor.save'; file: FileRef }
  | { type: 'editor.navigate' }
  | { type: 'editor.review'; file?: FileRef }
  | { type: 'window.focus'; focused: boolean }
  | { type: 'diagnostics'; errors: number; warnings: number; top?: DiagnosticRef[] }
  | { type: 'process.start'; id: string; kind: ProcessKind; label: string }
  | { type: 'process.end'; id: string; kind: ProcessKind; label: string; exitCode?: number }
  | {
      type: 'git';
      branch?: string;
      repo?: string;
      changes: number;
      staged: number;
      ahead: number;
      behind: number;
      /** The changed files (staged, unstaged, untracked), repository-relative; at most 50. */
      files?: string[];
    }
  | { type: 'git.commit'; message?: string }
  | { type: 'git.branch'; branch: string }
  | {
      type: 'agent';
      agentId: string;
      name: string;
      role?: AgentRole;
      status: AgentStatus;
      detail?: string;
      /** While waiting: what for. */
      ask?: AgentAsk;
      /** While waiting for approval: the tool it wants to use, e.g. `Bash`. */
      tool?: string;
      /** Context-window usage 0..1 when the provider reports it. */
      context?: number;
      /** Set for background/sub-agents: the crew, counted on the Agents dial. */
      parentId?: string;
    }
  | { type: 'agent.remove'; agentId: string }
  /** A new context-window reading (0..1) for an agent already in the cockpit. Changes nothing else. */
  | { type: 'agent.context'; agentId: string; context: number }
  /** The repository's open pull requests, or why there are none to show. */
  | { type: 'github.prs'; state: PullRequestFeedState; repo?: string; viewer?: string; items: PullRequestRef[] }
  | { type: 'fs.external'; file: FileRef }
  | { type: 'terminal.open' };

export type DevEventType = DevEventBody['type'];

export type DevEvent = DevEventBody & { at: number };

export function fileRef(path: string, language?: string): FileRef {
  const clean = path.replace(/\\/g, '/');
  const name = clean.split('/').pop() || clean;
  return language ? { path: clean, name, language } : { path: clean, name };
}
