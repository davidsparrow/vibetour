import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { DevEventBody } from '../core/events';
import type { ClientCommand, ClientPrefs, DisplayMode, HostInfo, HostMessage } from '../core/protocol';
import { VibeTourSession, type KeyValueStore, type SessionOptions } from '../core/session';
import { VERSION } from '../host/version';
import { BUILTIN_PACKS } from '../packs';
import { CompanionServer } from '../server/companionServer';
import { installHookScript, vibetourHome } from '../server/sessionFile';
import { registerCommands, type CommandHost } from './commands';
import { openWorkspaceFile, saveCapture } from './displayCommands';
import { GitAdapter } from './gitAdapter';
import { nextDisplayMode } from './helpers';
import { IdeAdapter } from './ideAdapter';
import { StatusBar } from './statusBar';
import { TourPanel } from './tourPanel';

/**
 * VS Code host: wires the IDE and Git adapters into a VibeTourSession and
 * shows it in the tour panel, the status bar and Companion displays.
 */

const TICK_MS = 250;
const TOKEN_KEY = 'vibetour.companionToken';
const PREFS_KEY = { panel: 'vibetour.prefs.panel', companion: 'vibetour.prefs.companion' } as const;
const TOUR_MODE_KEY = 'vibetour.lastTourMode';

type Display = 'panel' | 'companion';

/** KeyValueStore over a Memento: synchronous reads, fire-and-forget writes. */
class MementoStore implements KeyValueStore {
  private readonly pending = new Set<Thenable<void>>();

  constructor(
    private readonly memento: vscode.Memento,
    private readonly onError: (err: unknown) => void,
  ) {}

  get<T>(key: string): T | undefined {
    const value = this.memento.get<T>(key);
    // Copy, like MemoryStore: the session must never mutate the memento's cache.
    return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as T);
  }

  set(key: string, value: unknown): void {
    const copy: unknown = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const write: Thenable<void> = this.memento.update(key, copy).then(
      () => void this.pending.delete(write),
      (err: unknown) => {
        this.pending.delete(write);
        this.onError(err);
      },
    );
    this.pending.add(write);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

class VibeTourHost implements CommandHost {
  readonly session: VibeTourSession;
  private readonly log: vscode.LogOutputChannel;
  private readonly sessionOptions: SessionOptions;
  private readonly globalStore: MementoStore;
  private readonly projectStore: MementoStore;
  private readonly panel: TourPanel;
  private readonly statusBar: StatusBar;
  private readonly ide: IdeAdapter;
  private readonly git: GitAdapter;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly project?: string;
  private ticker?: ReturnType<typeof setInterval>;
  private server?: CompanionServer;
  private companionChange: Promise<void> = Promise.resolve();
  private externalCompanionUrl?: string;
  private lastEditor?: vscode.TextEditor;
  private panelMode: DisplayMode = 'tour';
  private streaming: boolean;
  private detectExternalEdits: boolean;
  private tickFailed = false;

  constructor(readonly context: vscode.ExtensionContext) {
    this.log = vscode.window.createOutputChannel('VibeTour', { log: true });
    const cfg = this.cfg();
    const onStoreError = (err: unknown) => this.log.error(`Could not save VibeTour state: ${String(err)}`);
    this.globalStore = new MementoStore(context.globalState, onStoreError);
    this.projectStore = new MementoStore(context.workspaceState, onStoreError);
    this.project = vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name;
    this.streaming = cfg.get<boolean>('privacy.streamingMode', false);
    this.detectExternalEdits = cfg.get<boolean>('agents.detectExternalEdits', true);
    this.sessionOptions = {
      packs: BUILTIN_PACKS,
      globalStore: this.globalStore,
      projectStore: this.projectStore,
      project: this.project,
      streaming: this.streaming,
      autoResume: cfg.get<boolean>('journey.autoResume', true),
    };
    this.session = new VibeTourSession(this.sessionOptions);
    this.panel = new TourPanel({
      extensionUri: context.extensionUri,
      hello: () => this.hello('panel', true),
      latest: () => {
        const snapshot = this.session.latestSnapshot;
        return snapshot ? { type: 'snapshot', snapshot } : undefined;
      },
      onCommand: (cmd) => this.runDisplayCommand(cmd, 'panel'),
      onVisibilityChange: (visible) => void vscode.commands.executeCommand('setContext', 'vibetour.tourVisible', visible),
    });
    this.statusBar = new StatusBar((id) => this.session.packs.get(id), cfg.get<boolean>('statusBar.enabled', true));
    this.ide = new IdeAdapter({
      emit: (e) => this.ingest(e),
      detectExternalEdits: () => this.detectExternalEdits,
      log: (m) => this.log.info(m),
    });
    this.git = new GitAdapter(
      (e) => this.ingest(e),
      (m) => this.log.info(m),
    );
  }

  async start(): Promise<void> {
    const ctx = this.context;
    this.disposables.push(
      this.panel,
      this.statusBar,
      this.ide,
      this.git,
      ...registerCommands(this),
      vscode.window.onDidChangeActiveTextEditor((ed) => ed && (this.lastEditor = ed)),
      vscode.workspace.onDidChangeConfiguration((e) => this.onConfigChange(e)),
    );
    this.lastEditor = vscode.window.activeTextEditor;

    this.session.onSnapshot((snapshot) => {
      const msg: HostMessage = { type: 'snapshot', snapshot };
      if (this.panel.visible) this.panel.post(msg);
      if (this.server?.clientCount) this.server.broadcast(msg);
      this.statusBar.update(snapshot);
    });
    this.session.onCatalog((catalog) => {
      const msg: HostMessage = { type: 'catalog', catalog };
      this.panel.post(msg);
      this.server?.broadcast(msg);
      this.statusBar.invalidate();
    });

    this.ide.start();
    void this.git.start();
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.tick();

    this.refreshHookScript();
    this.companionChange = this.startCompanion();
    await this.companionChange;
    void vscode.commands.executeCommand('setContext', 'vibetour.tourVisible', false);
    ctx.subscriptions.push(this.log);
  }

  async dispose(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    // Silence every event source first: activity arriving after the park
    // below would auto-resume the journey we are about to put away.
    this.ide.dispose();
    this.git.dispose();
    await this.companionChange.catch(() => undefined);
    await this.stopCompanion();
    try {
      // Parks a moving journey "by closing", so it resumes when work starts again.
      this.session.shutdown();
    } catch (err) {
      this.log.error(`Shutdown failed: ${String(err)}`);
    }
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    await Promise.all([this.globalStore.flush(), this.projectStore.flush()]);
  }

  // ------------------------------------------------------------ the session

  private ingest(body: DevEventBody): void {
    this.session.ingest({ ...body, at: Date.now() });
  }

  private tick(): void {
    try {
      this.session.tick();
    } catch (err) {
      // Log once rather than every 250 ms.
      if (!this.tickFailed) this.log.error(`Tick failed: ${err instanceof Error ? err.stack : String(err)}`);
      this.tickFailed = true;
    }
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('vibetour');
  }

  private onConfigChange(e: vscode.ConfigurationChangeEvent): void {
    if (!e.affectsConfiguration('vibetour')) return;
    const cfg = this.cfg();
    if (e.affectsConfiguration('vibetour.privacy.streamingMode')) {
      this.streaming = cfg.get<boolean>('privacy.streamingMode', false);
      this.session.setStreaming(this.streaming);
      // The project name lives in the hello message.
      this.panel.post(this.hello('panel'));
      this.server?.broadcast(this.hello('companion'));
    }
    if (e.affectsConfiguration('vibetour.journey.autoResume')) this.session.setAutoResume(cfg.get<boolean>('journey.autoResume', true));
    if (e.affectsConfiguration('vibetour.statusBar.enabled')) this.statusBar.setEnabled(cfg.get<boolean>('statusBar.enabled', true));
    if (e.affectsConfiguration('vibetour.agents.detectExternalEdits')) this.detectExternalEdits = cfg.get<boolean>('agents.detectExternalEdits', true);
    if (e.affectsConfiguration('vibetour.companion')) {
      this.companionChange = this.companionChange.then(async () => {
        await this.stopCompanion();
        await this.startCompanion();
      });
    }
  }

  // ------------------------------------------------------------ displays

  private hostInfo(display: Display): HostInfo {
    const panel = display === 'panel';
    return {
      kind: panel ? 'vscode' : 'companion',
      version: VERSION,
      projectName: this.streaming ? undefined : this.project,
      companionUrl: this.streaming || !this.server ? undefined : (this.externalCompanionUrl ?? this.server.url),
      // A companion screen can open files in VS Code, but saves its captures as browser downloads.
      capabilities: { openFiles: true, openDocs: true, saveFiles: panel, focusIde: panel },
    };
  }

  /** `opening`: the panel is (re)loading, i.e. the user is returning to the tour. */
  private hello(display: Display, opening = false): HostMessage {
    const saved = this.context.globalState.get<Partial<ClientPrefs>>(PREFS_KEY[display]);
    let prefs = saved;
    if (display === 'panel') {
      // Returning to the tour lands in the last non-work mode (PRD §32).
      if (opening) this.panelMode = this.lastTourMode();
      prefs = { ...saved, mode: this.panelMode };
    }
    return { type: 'hello', host: this.hostInfo(display), catalog: this.session.catalog(), ...(prefs ? { prefs } : {}) };
  }

  private lastTourMode(): DisplayMode {
    const mode = this.context.globalState.get<DisplayMode>(TOUR_MODE_KEY);
    return mode === 'dashboard' || mode === 'tour' ? mode : 'tour';
  }

  private rememberPanelMode(mode: DisplayMode): void {
    this.panelMode = mode;
    if (mode !== 'work') void this.context.globalState.update(TOUR_MODE_KEY, mode);
  }

  private runDisplayCommand(cmd: ClientCommand, display: Display): void {
    this.onDisplayCommand(cmd, display).catch((err: unknown) => this.log.error(`Command ${cmd.type} failed: ${String(err)}`));
  }

  private async onDisplayCommand(cmd: ClientCommand, display: Display): Promise<void> {
    if (this.session.handleCommand(cmd)) return;
    const reply = (msg: HostMessage) => (display === 'panel' ? this.panel.post(msg) : this.server?.broadcast(msg));
    switch (cmd.type) {
      case 'savePrefs': {
        if (!cmd.prefs || typeof cmd.prefs !== 'object') return;
        await this.context.globalState.update(PREFS_KEY[display], cmd.prefs);
        if (display === 'panel' && ['tour', 'dashboard', 'work'].includes(cmd.prefs.mode)) this.rememberPanelMode(cmd.prefs.mode);
        return;
      }
      case 'saveCapture':
        return saveCapture(cmd, reply);
      case 'openFile':
        return openWorkspaceFile(cmd.path, cmd.line, reply);
      case 'openDocs':
        await vscode.commands.executeCommand('vibetour.openGlovebox');
        return;
      case 'focusIde':
        return this.goToWork();
      default:
        return;
    }
  }

  openTour(): void {
    const beside = this.cfg().get<boolean>('tour.openBeside', false);
    this.panel.show(beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active);
  }

  /** Work mode = the IDE itself: close the tour and put the cursor back where it was. */
  async goToWork(): Promise<void> {
    this.panel.close();
    const ed = this.lastEditor;
    if (ed && !ed.document.isClosed) {
      try {
        await vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, preview: false, selection: ed.selection });
        return;
      } catch {
        /* fall through */
      }
    }
    await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  }

  /** The signature interaction (PRD §32): one shortcut between the tour and the IDE. */
  async toggleWork(): Promise<void> {
    if (this.panel.visible) await this.goToWork();
    else this.openTour();
  }

  cycleDisplayMode(): void {
    if (!this.panel.visible) {
      this.openTour();
      return;
    }
    const mode = nextDisplayMode(this.panelMode);
    this.rememberPanelMode(mode);
    this.panel.post({ type: 'setMode', mode }, true);
  }

  show(view: 'picker' | 'passport' | 'settings' | 'capture'): void {
    this.openTour();
    this.panel.post({ type: 'show', view }, true);
  }

  // ------------------------------------------------------------ companion

  private companionToken(): string {
    let token = this.context.globalState.get<string>(TOKEN_KEY);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      token = randomBytes(32).toString('hex');
      void this.context.globalState.update(TOKEN_KEY, token);
    }
    return token;
  }

  private async startCompanion(): Promise<void> {
    const cfg = this.cfg();
    if (this.server || !cfg.get<boolean>('companion.enabled', true)) return;
    const port = cfg.get<number>('companion.port', 47477);
    const token = this.companionToken();
    const server = new CompanionServer({
      port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 47477,
      token,
      staticDir: vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview').fsPath,
      hostInfo: () => this.hostInfo('companion'),
      catalog: () => this.session.catalog(),
      snapshot: () => this.session.latestSnapshot,
      prefs: () => this.context.globalState.get<Partial<ClientPrefs>>(PREFS_KEY.companion),
      onCommand: (cmd) => this.onDisplayCommand(cmd, 'companion'),
      onAgentEvents: (events) => events.forEach((e) => this.ingest(e)),
      sessionFile: true,
      log: (m) => this.log.info(m),
    });
    try {
      await server.start();
    } catch (err) {
      this.log.error(`Companion Display could not start: ${String(err)}`);
      return;
    }
    this.server = server;
    this.externalCompanionUrl = undefined;
    // Agents started in VS Code's terminals report to this window, even with several open.
    const env = this.context.environmentVariableCollection;
    env.persistent = false;
    env.description = 'Lets coding agents started in this terminal report to VibeTour.';
    env.replace('VIBETOUR_URL', server.origin);
    env.replace('VIBETOUR_TOKEN', token);
    this.log.info(`Companion Display listening on ${server.origin}`);
  }

  private async stopCompanion(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    this.externalCompanionUrl = undefined;
    this.context.environmentVariableCollection.clear();
    await server.stop();
  }

  async companionUrl(): Promise<string | undefined> {
    await this.companionChange.catch(() => undefined);
    const server = this.server;
    if (!server) return undefined;
    if (!this.externalCompanionUrl) {
      // Remote windows (SSH, WSL, containers) need the port forwarded to the local browser.
      try {
        const external = await vscode.env.asExternalUri(vscode.Uri.parse(server.url));
        this.externalCompanionUrl = external.toString(true);
      } catch {
        this.externalCompanionUrl = server.url;
      }
    }
    return this.externalCompanionUrl;
  }

  async enableCompanion(): Promise<void> {
    await this.cfg().update('companion.enabled', true, vscode.ConfigurationTarget.Global);
    // The configuration listener restarts the server; wait for it.
    await this.companionChange.catch(() => undefined);
    if (!this.server) await this.startCompanion();
  }

  // ------------------------------------------------------------ agent hooks

  private bundledHookScript(): string {
    return vscode.Uri.joinPath(this.context.extensionUri, 'bin', 'vibetour-hook.js').fsPath;
  }

  hookScriptPath(): string {
    try {
      return installHookScript(this.bundledHookScript());
    } catch (err) {
      this.log.warn(`Could not install the hook script in ${vibetourHome()}: ${String(err)}`);
      return this.bundledHookScript();
    }
  }

  /** Keeps an installed hook forwarder in step with this extension version. */
  private refreshHookScript(): void {
    if (!existsSync(join(vibetourHome(), 'bin', 'vibetour-hook.js'))) return;
    try {
      installHookScript(this.bundledHookScript());
    } catch (err) {
      this.log.warn(`Could not update the hook script: ${String(err)}`);
    }
  }
}

let host: VibeTourHost | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  host = new VibeTourHost(context);
  await host.start();
}

export async function deactivate(): Promise<void> {
  const h = host;
  host = undefined;
  await h?.dispose();
}
