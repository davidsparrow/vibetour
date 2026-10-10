import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { ClientCommand, HostMessage } from '../core/protocol';
import { isSafeRelativePath } from '../host/paths';
import { decodePngDataUrl, safeCaptureName } from './helpers';

/**
 * Host-side work requested by a display (the tour panel or a companion
 * browser): saving a capture and opening a file from the cockpit. The rest of
 * the display commands map directly onto the session or other commands.
 */

type Reply = (msg: HostMessage) => void;

/** "Capture my workplace" (PRD §29): save the PNG the display rendered. */
export async function saveCapture(cmd: Extract<ClientCommand, { type: 'saveCapture' }>, reply: Reply): Promise<void> {
  const png = decodePngDataUrl(cmd.dataUrl);
  if (!png) {
    reply({ type: 'toast', text: 'Capture failed — the image was not a PNG.' });
    return;
  }
  const pictures = join(homedir(), 'Pictures');
  const dir = existsSync(pictures) ? pictures : homedir();
  const target = await vscode.window.showSaveDialog({
    title: 'Save VibeTour Capture',
    saveLabel: 'Save Capture',
    defaultUri: vscode.Uri.file(join(dir, safeCaptureName(cmd.fileName))),
    filters: { 'PNG image': ['png'] },
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, png);
  reply({ type: 'toast', text: `Saved ${target.path.split('/').pop()}` });
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a workspace-relative path (as `asRelativePath` printed it) to a file in the workspace. */
async function resolveWorkspaceFile(relPath: string): Promise<vscode.Uri | undefined> {
  if (!isSafeRelativePath(relPath)) return undefined;
  const clean = relPath.replace(/\\/g, '/');
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    // Multi-root workspaces prefix paths with the folder name.
    const rest = clean.startsWith(`${folder.name}/`) ? clean.slice(folder.name.length + 1) : undefined;
    for (const candidate of rest ? [rest, clean] : [clean]) {
      const uri = vscode.Uri.joinPath(folder.uri, candidate);
      if (await exists(uri)) return uri;
    }
  }
  return undefined;
}

/** Opens a file from the cockpit (a diagnostic, the active file) as a regular editor. */
export async function openWorkspaceFile(relPath: string, line: number | undefined, reply: Reply): Promise<void> {
  const uri = await resolveWorkspaceFile(relPath);
  if (!uri) {
    reply({ type: 'toast', text: 'That file is not in this workspace.' });
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const wanted = typeof line === 'number' && Number.isFinite(line) ? Math.floor(line) : 1;
  const lineIndex = Math.min(Math.max(0, wanted - 1), Math.max(0, doc.lineCount - 1));
  const at = new vscode.Position(lineIndex, 0);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
    selection: new vscode.Range(at, at),
  });
}
