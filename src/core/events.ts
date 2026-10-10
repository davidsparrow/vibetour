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

/** Aviation-style crew roles (PRD §15). */
export type AgentRole = 'copilot' | 'nav' | 'eng' | 'qa' | 'comms' | 'ops' | 'crew';

export type EditOrigin = 'user' | 'agent' | 'unknown';

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
      /** Context-window usage 0..1 when the provider reports it. */
      context?: number;
      /** Set for background/sub-agents shown in the side mirrors. */
      parentId?: string;
    }
  | { type: 'agent.remove'; agentId: string }
  | { type: 'fs.external'; file: FileRef }
  | { type: 'terminal.open' };

export type DevEventType = DevEventBody['type'];

export type DevEvent = DevEventBody & { at: number };

export function fileRef(path: string, language?: string): FileRef {
  const clean = path.replace(/\\/g, '/');
  const name = clean.split('/').pop() || clean;
  return language ? { path: clean, name, language } : { path: clean, name };
}
