import { resolve } from 'node:path';
import { SCOPES, type ScopeId } from '../core/journey';
import { BUILTIN_PACKS } from '../packs';

/** Command-line parsing for the standalone companion (kept apart from its side effects). */

export const USAGE = `Usage: vibetour [dir] [options]

VibeTour as a standalone companion for any editor or terminal coding agent.
Shows the tour in your browser while you work in <dir> (default: current directory).

Options:
  --port <n>              Companion Display port (default 47477; 0 picks a free port)
  --no-open               Don't open the browser
  --pack <id>             Start a journey to this destination (${BUILTIN_PACKS.map((p) => p.id).join(', ')})
  --scope <id>            Journey length with --pack (${SCOPES.map((s) => s.id).join(', ')}; default day-trip)
  --streaming             Streaming Mode: hide file names, branches, commands and messages
  --your-turn-stop <s>    When an agent finishes its turn, pull over after <s> quiet seconds (5-3600)
  --prs                   Show the repository's open pull requests (GitHub; uses GITHUB_TOKEN or gh's sign-in)
  --no-radio              No internet radio: the companion makes no network requests
  -h, --help              Show this help
  -v, --version           Show the version
`;

export interface CliOptions {
  dir: string;
  port: number;
  open: boolean;
  pack?: string;
  scope: ScopeId;
  streaming: boolean;
  /** Pull over this long after an agent finishes its turn; unset keeps driving. */
  yourTurnStopMs?: number;
  /** Ask GitHub for the repository's open pull requests. */
  prs: boolean;
  /** Internet radio (FM band); off makes no network requests. */
  radio: boolean;
}

export type Parsed = { kind: 'run'; opts: CliOptions } | { kind: 'help' } | { kind: 'version' } | { kind: 'error'; message: string };

export function parseArgs(argv: string[], cwd = process.cwd()): Parsed {
  const opts: CliOptions = { dir: cwd, port: 47477, open: true, scope: 'day-trip', streaming: false, prs: false, radio: true };
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '-h':
      case '--help':
        return { kind: 'help' };
      case '-v':
      case '--version':
        return { kind: 'version' };
      case '--no-open':
        opts.open = false;
        break;
      case '--streaming':
        opts.streaming = true;
        break;
      case '--prs':
        opts.prs = true;
        break;
      case '--no-radio':
        opts.radio = false;
        break;
      case '--port': {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 0 || port > 65535) return { kind: 'error', message: '--port needs a number between 0 and 65535' };
        opts.port = port;
        break;
      }
      case '--pack': {
        const id = value();
        if (!id || !BUILTIN_PACKS.some((p) => p.id === id)) {
          return { kind: 'error', message: `Unknown destination "${id ?? ''}". Choose one of: ${BUILTIN_PACKS.map((p) => p.id).join(', ')}` };
        }
        opts.pack = id;
        break;
      }
      case '--your-turn-stop': {
        const seconds = Number(value());
        if (!Number.isFinite(seconds) || seconds < 5 || seconds > 3600) return { kind: 'error', message: '--your-turn-stop needs a number of seconds between 5 and 3600' };
        opts.yourTurnStopMs = seconds * 1000;
        break;
      }
      case '--scope': {
        const id = value();
        if (!SCOPES.some((s) => s.id === id)) return { kind: 'error', message: `Unknown scope "${id ?? ''}". Choose one of: ${SCOPES.map((s) => s.id).join(', ')}` };
        opts.scope = id as ScopeId;
        break;
      }
      default:
        if (arg.startsWith('-')) return { kind: 'error', message: `Unknown option ${arg}` };
        if (dir !== undefined) return { kind: 'error', message: `Unexpected argument ${arg}` };
        dir = arg;
    }
  }
  opts.dir = resolve(cwd, dir ?? '.');
  return { kind: 'run', opts };
}
