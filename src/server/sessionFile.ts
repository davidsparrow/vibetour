import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Files in `~/.vibetour` (or `$VIBETOUR_HOME`) that let agent hooks find a
 * running VibeTour: `companion.json` names the Companion server's port and
 * token, and `bin/vibetour-hook.js` is a stable copy of the hook forwarder
 * that survives extension updates. The directory is private to the user.
 */

export interface CompanionSessionInfo {
  port: number;
  token: string;
  pid: number;
  url: string;
  startedAt: number;
}

export function vibetourHome(): string {
  return process.env.VIBETOUR_HOME || join(homedir(), '.vibetour');
}

export function sessionFilePath(home = vibetourHome()): string {
  return join(home, 'companion.json');
}

function writePrivate(file: string, content: string, mode = 0o600): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, file);
}

export function writeSessionFile(info: CompanionSessionInfo, home = vibetourHome()): void {
  writePrivate(sessionFilePath(home), JSON.stringify(info, null, 2));
}

export function readSessionFile(home = vibetourHome()): CompanionSessionInfo | undefined {
  try {
    const raw = JSON.parse(readFileSync(sessionFilePath(home), 'utf8')) as Partial<CompanionSessionInfo>;
    if (typeof raw.port !== 'number' || typeof raw.token !== 'string' || typeof raw.pid !== 'number') return undefined;
    return { port: raw.port, token: raw.token, pid: raw.pid, url: String(raw.url ?? ''), startedAt: Number(raw.startedAt ?? 0) };
  } catch {
    return undefined;
  }
}

/** True when a process with this pid exists (EPERM: it exists but belongs to another user). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Removes the session file, but only if this process wrote it (another window may own it now). */
export function removeSessionFile(pid = process.pid, home = vibetourHome()): boolean {
  const info = readSessionFile(home);
  if (!info || info.pid !== pid) return false;
  try {
    unlinkSync(sessionFilePath(home));
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies the hook forwarder to `<home>/bin/vibetour-hook.js` (when missing or
 * changed) and returns its path. Hook configs point at this copy so they keep
 * working when the extension's install directory changes on update.
 */
export function installHookScript(source: string, home = vibetourHome()): string {
  const target = join(home, 'bin', 'vibetour-hook.js');
  const wanted = readFileSync(source);
  let current: Buffer | undefined;
  try {
    current = readFileSync(target);
  } catch {
    current = undefined;
  }
  if (!current || !current.equals(wanted)) {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const tmp = `${target}.${process.pid}.tmp`;
    copyFileSync(source, tmp);
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
  }
  return target;
}
