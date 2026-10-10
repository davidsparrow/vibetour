import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileRef, type DevEventBody } from '../core/events';
import type { ClientCommand, ClientPrefs, HostInfo, HostMessage } from '../core/protocol';
import { VibeTourSession } from '../core/session';
import { JsonFileStore } from '../host/fileStore';
import { languageForPath } from '../host/paths';
import { Throttle } from '../host/throttle';
import { VERSION } from '../host/version';
import { BUILTIN_PACKS } from '../packs';
import { CompanionServer, generateToken } from '../server/companionServer';
import { vibetourHome } from '../server/sessionFile';
import { parseArgs, USAGE, type CliOptions } from './args';
import { GitPoller } from './gitPoller';
import { TreeWatcher } from './watch';

/**
 * Standalone companion (PRD §33): VibeTour for any editor or terminal agent.
 *
 *   vibetour [dir] [--port N] [--no-open] [--pack id] [--scope id] [--streaming]
 *
 * Watches the project directory and Git, receives agent hook events, and
 * serves the Companion Display in the browser. State lives in $VIBETOUR_HOME.
 */

const TICK_MS = 250;
const SAVE_THROTTLE_MS = 1_000;
const TOKEN_KEY = 'vibetour.companionToken';
const PREFS_KEY = 'vibetour.prefs.companion';

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* no browser: the URL is printed */
  }
}

async function run(opts: CliOptions): Promise<void> {
  const log = (msg: string) => console.error(`[vibetour] ${msg}`);
  const { dir } = opts;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`vibetour: ${dir} is not a directory`);
    process.exit(1);
  }
  const project = basename(dir);
  const home = vibetourHome();
  const projectKey = createHash('sha1').update(dir).digest('hex').slice(0, 16);
  const globalStore = new JsonFileStore(join(home, 'state.json'), 1_000, log);
  const projectStore = new JsonFileStore(join(home, 'projects', `${projectKey}.json`), 1_000, log);
  const session = new VibeTourSession({ packs: BUILTIN_PACKS, globalStore, projectStore, project, streaming: opts.streaming, autoResume: true });
  const ingest = (body: DevEventBody) => session.ingest({ ...body, at: Date.now() });

  let token = globalStore.get<string>(TOKEN_KEY);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    token = generateToken();
    globalStore.set(TOKEN_KEY, token);
  }

  const staticDir = join(__dirname, 'webview');
  if (!existsSync(join(staticDir, 'app.js'))) log(`The browser app is missing from ${staticDir} — run "npm run build" first.`);

  let server: CompanionServer;
  /** Last time an agent reported working; snapshots lag events by up to one tick. */
  let agentWorkingAt = 0;
  let stopping = false;
  const hostInfo = (): HostInfo => ({
    kind: 'cli',
    version: VERSION,
    projectName: opts.streaming ? undefined : project,
    companionUrl: opts.streaming ? undefined : server.url,
    capabilities: { openFiles: false, openDocs: false, saveFiles: false, focusIde: false },
  });
  const onCommand = (cmd: ClientCommand) => {
    if (session.handleCommand(cmd)) return;
    if (cmd.type === 'savePrefs' && cmd.prefs && typeof cmd.prefs === 'object') globalStore.set(PREFS_KEY, cmd.prefs);
  };
  server = new CompanionServer({
    port: opts.port,
    token,
    staticDir,
    hostInfo,
    catalog: () => session.catalog(),
    snapshot: () => session.latestSnapshot,
    prefs: () => globalStore.get<Partial<ClientPrefs>>(PREFS_KEY),
    onCommand,
    onAgentEvents: (events) => {
      for (const e of events) {
        if (e.type === 'agent' && (e.status === 'working' || e.status === 'tool')) agentWorkingAt = Date.now();
        ingest(e);
      }
    },
    sessionFile: true,
    log,
  });

  session.onSnapshot((snapshot) => {
    if (server.clientCount) server.broadcast({ type: 'snapshot', snapshot } satisfies HostMessage);
  });
  session.onCatalog((catalog) => server.broadcast({ type: 'catalog', catalog }));

  // File changes: the CLI cannot see who typed them. While an agent reports
  // that it is working, attribute them to the agent; otherwise to the user.
  const saves = new Throttle<string>(
    SAVE_THROTTLE_MS,
    (_a, b) => b,
    (_key, rel) => {
      stat(join(dir, rel)).then(
        (s) => {
          if (stopping || !s.isFile()) return;
          const file = fileRef(rel, languageForPath(rel));
          const agentBusy =
            Date.now() - agentWorkingAt < 2_000 || !!session.latestSnapshot?.ide.agents.some((a) => a.status === 'working' || a.status === 'tool');
          ingest(agentBusy ? { type: 'fs.external', file } : { type: 'editor.save', file });
        },
        () => undefined,
      );
    },
    false,
  );
  const watcher = new TreeWatcher(dir, (rel) => saves.push(rel, rel), log);
  const git = new GitPoller(dir, ingest, log);

  if (opts.pack) session.startJourney(opts.pack, opts.scope);

  const { url } = await server.start();
  watcher.start();
  git.start();
  const ticker = setInterval(() => session.tick(), TICK_MS);
  session.tick();

  const hook = join(__dirname, '..', 'bin', 'vibetour-hook.js');
  const journey = session.catalog().activeJourney;
  console.log(
    [
      `VibeTour ${VERSION} · ${opts.streaming ? 'streaming mode' : project}`,
      `  Display   ${url}`,
      `  Journey   ${journey ? `${journey.title} (${journey.phase})` : 'none yet — choose a destination in the display'}`,
      `  Agents    Claude Code hooks: node "${hook}"`,
      '  Ctrl+C parks the journey and quits.',
    ].join('\n'),
  );
  if (opts.open) openBrowser(url);

  const shutdown = async (code: number) => {
    if (stopping) process.exit(code);
    stopping = true;
    clearInterval(ticker);
    // Silence every event source first: activity arriving after the park
    // below would auto-resume the journey we are about to put away.
    watcher.close();
    git.stop();
    saves.dispose();
    await server.stop().catch(() => undefined);
    try {
      session.shutdown();
    } catch (err) {
      log(`Shutdown failed: ${String(err)}`);
    }
    globalStore.flush();
    projectStore.flush();
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => void shutdown(0));
  process.on('uncaughtException', (err) => {
    log(`Unexpected error: ${err.stack ?? err.message}`);
    void shutdown(1);
  });
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  switch (parsed.kind) {
    case 'help':
      process.stdout.write(USAGE);
      return;
    case 'version':
      console.log(VERSION);
      return;
    case 'error':
      console.error(`vibetour: ${parsed.message}\n\n${USAGE}`);
      process.exit(2);
      return;
    case 'run':
      run(parsed.opts).catch((err: unknown) => {
        console.error(`vibetour: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      });
  }
}

main();
