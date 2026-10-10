import type { ProcessKind } from './events';

/**
 * Classifies a shell command line or task name into a coarse process kind.
 * Only the kind and a short, scrubbed label leave this module — the raw
 * command line may contain secrets and is never forwarded.
 */

const AGENT_BINARIES = new Set([
  'claude',
  'codex',
  'aider',
  'gemini',
  'opencode',
  'amp',
  'goose',
  'cursor-agent',
  'copilot',
  'qwen',
  'crush',
  'claude-code',
]);

const TEST_RE =
  /(^|[\s:/_-])(test|tests|spec|jest|vitest|mocha|ava|tap|pytest|rspec|phpunit|ctest|tox|nox|karma|cypress|playwright\s+test|e2e)([\s:_-]|$)/i;
const BUILD_RE =
  /(^|[\s:/_-])(build|compile|tsc|webpack|rollup|esbuild|parcel|make|cmake|ninja|bazel|gradle|gradlew|mvn|msbuild|javac|gcc|g\+\+|clang|rustc|swiftc|xcodebuild|bundle|package|assemble)([\s:_-]|$)/i;
const LINT_RE =
  /(^|[\s:/_-])(lint|eslint|prettier|ruff|flake8|pylint|mypy|pyright|clippy|golangci-lint|rubocop|stylelint|typecheck|type-check|biome|fmt|format|check)([\s:_-]|$)/i;
const INSTALL_RE = /^(npm|pnpm|yarn|bun)\s+(i|install|ci|add)\b|^pip3?\s+install\b|^(bundle|poetry|uv)\s+(install|sync|add)\b|^cargo\s+fetch\b|^go\s+mod\s+(download|tidy)\b/i;
const RUN_RE = /^(npm|pnpm|yarn|bun)\s+(start|run\s+(dev|start|serve|watch))\b|^(node|deno|python3?|ruby|php|java|dotnet\s+run|go\s+run|cargo\s+run|flask|uvicorn|rails\s+s)/i;

export interface Classification {
  kind: ProcessKind;
  /** Short, privacy-safe label such as `npm test` or `pytest`. */
  label: string;
}

/** Strips env assignments, sudo and path prefixes; returns the meaningful tokens. */
function tokens(commandLine: string): string[] {
  const parts = commandLine
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let i = 0;
  while (i < parts.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i]) || parts[i] === 'sudo' || parts[i] === 'env')) i++;
  return parts.slice(i).map((p, idx) => (idx === 0 ? p.split(/[\\/]/).pop() || p : p));
}

/** The program name: anything that looks like a plain executable name. */
function scrubProgram(token: string): string | undefined {
  return /^[A-Za-z0-9][\w.+-]{0,30}$/.test(token) && !/[0-9a-f]{12,}/i.test(token) ? token : undefined;
}

/**
 * Sub-commands must be plain words (`test`, `run`, `test:unit`). Anything with
 * digits, dots, slashes, quotes or `=` might be a path, value or secret.
 */
function scrubWord(token: string): string | undefined {
  return token.length <= 24 && /^[a-z]+(?:[:-][a-z]+)*$/i.test(token) ? token : undefined;
}

export function safeLabel(commandLine: string, maxTokens = 3): string {
  const t = tokens(commandLine);
  const out: string[] = [];
  for (const tok of t) {
    if (out.length >= maxTokens) break;
    if (/^(&&|\|\||;|\|)$/.test(tok)) break;
    const s = out.length === 0 ? scrubProgram(tok) : scrubWord(tok);
    if (!s) break;
    out.push(s);
  }
  return out.join(' ') || 'command';
}

export function classifyCommand(commandLine: string): Classification {
  const first = commandLine.split(/&&|\|\||;|\|/)[0] ?? commandLine;
  const t = tokens(first);
  const label = safeLabel(first);
  if (t.length === 0) return { kind: 'other', label };
  const bin = t[0].toLowerCase().replace(/\.(exe|cmd|bat|sh)$/, '');
  const viaRunner = (bin === 'npx' || bin === 'bunx' || bin === 'pnpx') && t[1] ? t[1].replace(/^@[^/]+\//, '').replace(/@.*$/, '') : undefined;
  const agent = AGENT_BINARIES.has(bin) ? bin : viaRunner && AGENT_BINARIES.has(viaRunner) ? viaRunner : undefined;
  if (agent) return { kind: 'agent', label: agent === 'claude-code' ? 'claude' : agent };
  if (bin === 'git' || bin === 'gh') return { kind: 'git', label };
  const rest = t.join(' ');
  if (INSTALL_RE.test(rest)) return { kind: 'install', label };
  if (TEST_RE.test(rest)) return { kind: 'test', label };
  if (LINT_RE.test(rest)) return { kind: 'lint', label };
  if (BUILD_RE.test(rest)) return { kind: 'build', label };
  if (RUN_RE.test(rest)) return { kind: 'run', label };
  return { kind: 'other', label };
}

/** Classifies a VS Code task by its group and name. */
export function classifyTask(name: string, group?: string): Classification {
  const g = (group || '').toLowerCase();
  const label = name.length > 32 ? name.slice(0, 31) + '…' : name;
  if (g === 'test') return { kind: 'test', label };
  if (g === 'build') return { kind: 'build', label };
  const c = classifyCommand(name);
  return { kind: c.kind === 'other' ? 'other' : c.kind, label };
}

/** True for kinds whose run means "verification is underway" (PRD §9 VERIFYING). */
export function isVerification(kind: ProcessKind): boolean {
  return kind === 'test' || kind === 'build' || kind === 'lint';
}
