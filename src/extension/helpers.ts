import { fileRef, type DiagnosticRef, type EditOrigin } from '../core/events';
import type { JourneyPack } from '../core/packs';
import type { DisplayMode, TourSnapshot } from '../core/protocol';

/**
 * Pure helpers behind the VS Code adapters. Nothing here imports `vscode`, so
 * it can be unit tested; the adapters stay thin wrappers around these.
 */

// ------------------------------------------------------------------ status bar

export interface StatusText {
  text: string;
  tooltip: string;
  /** Screen-reader label (codicons read badly). */
  ariaLabel: string;
}

type PackRoute = Pick<JourneyPack, 'title' | 'route'>;

/** "Steady autopilot cruise — agent at work" → "Steady autopilot cruise". */
export function shortCaption(caption: string, max = 40): string {
  const head = caption.split(' — ')[0].trim();
  return head.length > max ? `${head.slice(0, max - 1)}…` : head;
}

export function formatStatus(snapshot: TourSnapshot | undefined, pack: PackRoute | undefined): StatusText {
  const j = snapshot?.journey;
  if (!snapshot || !j || !pack) {
    return {
      text: '$(compass) VibeTour',
      tooltip: 'VibeTour — where do you want to go today?\nClick to open the tour.',
      ariaLabel: 'VibeTour: no journey. Open the tour.',
    };
  }
  const to = pack.route.to;
  const caption = shortCaption(snapshot.motion.caption);
  const pct = `${Math.round(j.progress * 100)}%`;
  let parts: string[];
  if (j.phase === 'parked') parts = ['Parked', to];
  else if (j.phase === 'arrived' || j.phase === 'staying') parts = ['Arrived', to];
  else if (j.scope === 'free-drive') parts = ['Free drive', caption];
  else parts = [to, pct, caption];
  const lines = [
    `${pack.title}: ${pack.route.from} → ${to} (${pack.route.name})`,
    j.location.label,
    j.objective ? `${j.scopeLabel} · ${j.objective}` : j.scopeLabel,
    '',
    'Click to switch between the tour and your code.',
  ];
  return {
    text: `$(compass) ${parts.join(' · ')}`,
    tooltip: lines.join('\n'),
    ariaLabel: `VibeTour: ${parts.join(', ').replace(/%/, ' percent')}`,
  };
}

// ----------------------------------------------------------------- diagnostics

export interface DiagnosticInput {
  /** Workspace-relative path. */
  path: string;
  language?: string;
  diagnostics: Array<{ severity: 'error' | 'warning'; /** 1-based. */ line: number; message: string }>;
}

export interface DiagnosticSummary {
  errors: number;
  warnings: number;
  top: DiagnosticRef[];
}

export const DIAGNOSTIC_TOP = 12;
const MESSAGE_MAX = 140;

function oneLine(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > MESSAGE_MAX ? `${flat.slice(0, MESSAGE_MAX - 1)}…` : flat;
}

/** Workspace totals plus the first few problems, errors before warnings. */
export function summarizeDiagnostics(files: DiagnosticInput[]): DiagnosticSummary {
  let errors = 0;
  let warnings = 0;
  const errorRefs: DiagnosticRef[] = [];
  const warningRefs: DiagnosticRef[] = [];
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    const file = fileRef(f.path, f.language);
    const diags = [...f.diagnostics].sort((a, b) => a.line - b.line);
    for (const d of diags) {
      const ref: DiagnosticRef = { file, line: d.line, severity: d.severity, message: oneLine(d.message) };
      if (d.severity === 'error') {
        errors++;
        if (errorRefs.length < DIAGNOSTIC_TOP) errorRefs.push(ref);
      } else {
        warnings++;
        if (warningRefs.length < DIAGNOSTIC_TOP) warningRefs.push(ref);
      }
    }
  }
  return { errors, warnings, top: [...errorRefs, ...warningRefs].slice(0, DIAGNOSTIC_TOP) };
}

// ------------------------------------------------------------------ edit origin

export interface EditContext {
  /** The changed document is the active editor's. */
  active: boolean;
  /** The changed document is shown in some visible editor. */
  visible: boolean;
  /** Change came from undo/redo. */
  undoRedo: boolean;
}

/**
 * Who made an edit, as best the editor can tell: typing happens in the active
 * editor; agents (Copilot agent mode, Claude Code's IDE integration…) apply
 * workspace edits to documents nobody is looking at.
 */
export function editOrigin(ctx: EditContext): EditOrigin {
  if (ctx.undoRedo || ctx.active) return 'user';
  if (!ctx.visible) return 'agent';
  return 'unknown';
}

export function mergeOrigin(a: EditOrigin, b: EditOrigin): EditOrigin {
  return a === b ? a : 'unknown';
}

// ------------------------------------------------------------------ display mode

const MODE_CYCLE: DisplayMode[] = ['tour', 'dashboard', 'work'];

export function nextDisplayMode(mode: DisplayMode | undefined): DisplayMode {
  const i = MODE_CYCLE.indexOf(mode ?? 'work');
  return MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
}

// --------------------------------------------------------------------- capture

const PNG_PREFIX = 'data:image/png;base64,';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CAPTURE_MAX_BYTES = 40 * 1024 * 1024;

/** Decodes a PNG data URL from the capture feature; undefined unless it is really a PNG. */
export function decodePngDataUrl(dataUrl: unknown): Uint8Array | undefined {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) return undefined;
  const b64 = dataUrl.slice(PNG_PREFIX.length);
  if (b64.length > (CAPTURE_MAX_BYTES * 4) / 3 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return undefined;
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return undefined;
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length);
}

/** A plain file name ending in .png, whatever the display asked for. */
export function safeCaptureName(name: unknown, now = new Date()): string {
  const base = (typeof name === 'string' ? name : '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f<>:"|?*]+/g, '')
    .replace(/^\.+/, '')
    .replace(/\.png$/i, '')
    .trim()
    .slice(0, 80);
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${base || `vibetour-${stamp}`}.png`;
}

// ------------------------------------------------------------ Claude Code hooks

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd',
] as const;

const TOOL_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse']);

interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: 'command'; command: string; timeout: number }>;
}

/** `node "<script>"`, quoted for the POSIX shell Claude Code runs hooks with. */
export function hookCommand(scriptPath: string): string {
  const p = scriptPath.replace(/\\/g, '/').replace(/(["$`])/g, '\\$1');
  return `node "${p}"`;
}

/** The `hooks` block for `.claude/settings.json`. Matchers apply to tool events only. */
export function claudeHooksConfig(command: string): { hooks: Record<string, HookEntry[]> } {
  const hooks: Record<string, HookEntry[]> = {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    const entry: HookEntry = { hooks: [{ type: 'command', command, timeout: 5 }] };
    hooks[event] = [TOOL_EVENTS.has(event) ? { matcher: '*', ...entry } : entry];
  }
  return { hooks };
}
