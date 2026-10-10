import * as vscode from 'vscode';
import { SCOPES, scopeInfo, type ScopeInfo } from '../core/journey';
import type { JourneyPack, Mood } from '../core/packs';
import { pickSurprise, scopeForDuration, type DurationChoice } from '../core/passport';
import { MOOD_LABELS } from '../core/protocol';
import type { VibeTourSession } from '../core/session';
import { claudeHooksConfig, hookCommand } from './helpers';

/**
 * Command palette entry points. Every immersive action has a fast,
 * conventional equivalent here (PRD §4.2): destinations, journey control,
 * display modes, the companion display, the glovebox and agent hooks.
 */

export interface CommandHost {
  readonly context: vscode.ExtensionContext;
  readonly session: VibeTourSession;
  openTour(): void;
  toggleWork(): Promise<void>;
  cycleDisplayMode(): void;
  show(view: 'picker' | 'passport' | 'settings' | 'capture'): void;
  /** The companion URL as reachable from the user's browser; undefined when the server is off. */
  companionUrl(): Promise<string | undefined>;
  enableCompanion(): Promise<void>;
  /** Path of the hook forwarder that agent configs should run. */
  hookScriptPath(): string;
}

type MoodChoice = Mood | 'anywhere' | 'surprise';

const DURATIONS: Array<{ label: string; id: DurationChoice }> = [
  { label: '30 minutes', id: '30m' },
  { label: '1 hour', id: '1h' },
  { label: 'Afternoon', id: 'afternoon' },
  { label: 'Entire workday', id: 'workday' },
];

export function registerCommands(host: CommandHost): vscode.Disposable[] {
  const reg = (id: string, fn: () => unknown) => vscode.commands.registerCommand(id, fn);
  return [
    reg('vibetour.open', () => host.openTour()),
    reg('vibetour.toggleWork', () => host.toggleWork()),
    reg('vibetour.chooseDestination', () => chooseDestination(host)),
    reg('vibetour.takeMeSomewhere', () => takeMeSomewhere(host)),
    reg('vibetour.completeObjective', () => completeObjective(host)),
    reg('vibetour.setObjective', () => setObjective(host)),
    reg('vibetour.park', () => withJourney(host, () => host.session.park('user'))),
    reg('vibetour.resume', () => withJourney(host, () => host.session.resume())),
    reg('vibetour.endJourney', () => endJourney(host)),
    reg('vibetour.cycleDisplayMode', () => host.cycleDisplayMode()),
    reg('vibetour.openCompanion', () => openCompanion(host)),
    reg('vibetour.copyCompanionUrl', () => copyCompanionUrl(host)),
    reg('vibetour.openGlovebox', () => openGlovebox()),
    reg('vibetour.showPassport', () => host.show('passport')),
    reg('vibetour.capture', () => host.show('capture')),
    reg('vibetour.toggleStreamingMode', () => toggleStreamingMode()),
    reg('vibetour.copyClaudeHooks', () => copyClaudeHooks(host)),
  ];
}

// -------------------------------------------------------------- destinations

function packDetail(pack: JourneyPack): string {
  const moods = pack.moods.map((m) => MOOD_LABELS[m]).join(', ');
  return `${pack.route.name} · ${pack.ticket.approxMinutes} min · ${moods}`;
}

async function pickScope(title: string): Promise<ScopeInfo | undefined> {
  const items = SCOPES.map((scope) => ({ label: scope.label, description: scope.range, detail: scope.blurb, scope }));
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'How long is this journey?', matchOnDescription: true });
  return picked?.scope;
}

async function chooseDestination(host: CommandHost): Promise<void> {
  const catalog = host.session.catalog();
  const active = catalog.activeJourney;
  const entry = (id: string) => catalog.library.find((e) => e.packId === id);
  const items = catalog.packs
    .map((pack) => {
      const lib = entry(pack.id);
      const marks = [lib?.favorite ? 'Favorite' : '', lib?.trips ? `Visited ${lib.trips}×` : '', lib?.saved ? 'Saved' : ''].filter(Boolean);
      return {
        label: `${lib?.favorite ? '$(star-full) ' : ''}${pack.title}`,
        description: [pack.subtitle, ...marks].join(' · '),
        detail: packDetail(pack),
        pack,
        favorite: !!lib?.favorite,
      };
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const leaving = active && active.phase !== 'arrived' && active.phase !== 'staying';
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Where do you want to go today?',
    placeHolder: leaving ? `Choosing a destination leaves your journey to ${active.title}` : 'Choose a destination',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;
  const pack = picked.pack;
  const scope = await pickScope(`${pack.title} — journey length`);
  if (!scope) return;
  const objective = await vscode.window.showInputBox({
    title: `${pack.title} · ${scope.label}`,
    prompt: 'What are you building? Optional — press Enter to skip.',
    placeHolder: 'e.g. Build the onboarding flow',
  });
  if (objective === undefined) return;
  host.session.startJourney(pack.id, scope.id, undefined, objective.trim() || undefined);
  vscode.window.setStatusBarMessage(`$(compass) Departing ${pack.route.from} for ${pack.route.to}`, 4_000);
}

/** For moods that are about conditions, prefer a variant with those conditions. */
function variantForMood(pack: JourneyPack, mood: MoodChoice): string | undefined {
  if (mood === 'rain') return pack.variants.find((v) => v.weather === 'rain')?.id;
  if (mood === 'city-night') return (pack.variants.find((v) => v.timeOfDay === 'night') ?? pack.variants.find((v) => v.timeOfDay === 'dusk'))?.id;
  return undefined;
}

async function takeMeSomewhere(host: CommandHost): Promise<void> {
  const moods = (Object.entries(MOOD_LABELS) as Array<[MoodChoice, string]>).map(([id, label]) => ({ label, id }));
  const mood = await vscode.window.showQuickPick(moods, { title: 'Take me somewhere', placeHolder: 'Where would you like to go?' });
  if (!mood) return;
  const duration = await vscode.window.showQuickPick(
    DURATIONS.map((d) => ({ ...d, description: scopeInfo(scopeForDuration(d.id)).label })),
    { title: `Take me somewhere — ${mood.label}`, placeHolder: 'How long do you have?' },
  );
  if (!duration) return;
  const catalog = host.session.catalog();
  const current = catalog.activeJourney?.packId;
  const pack =
    pickSurprise(catalog.packs, catalog.library, mood.id, Math.random, current) ?? pickSurprise(catalog.packs, catalog.library, mood.id);
  if (!pack) {
    void vscode.window.showInformationMessage(`No destinations match "${mood.label}" yet. Try another mood.`);
    return;
  }
  const scope = scopeForDuration(duration.id);
  host.session.startJourney(pack.id, scope, variantForMood(pack, mood.id));
  const open = await vscode.window.showInformationMessage(
    `Taking you to ${pack.route.to} — ${pack.title}, ${scopeInfo(scope).label.toLowerCase()}.`,
    'Open Tour',
  );
  if (open) host.openTour();
}

// -------------------------------------------------------------- journey

async function withJourney(host: CommandHost, action: () => void): Promise<void> {
  if (host.session.activeJourney) {
    action();
    return;
  }
  const pick = await vscode.window.showInformationMessage('No journey in progress.', 'Choose Destination');
  if (pick) await vscode.commands.executeCommand('vibetour.chooseDestination');
}

function completeObjective(host: CommandHost): Promise<void> {
  return withJourney(host, () => {
    host.session.completeObjective();
    const to = host.session.packs.get(host.session.activeJourney!.packId)?.route.to;
    if (to) vscode.window.setStatusBarMessage(`$(compass) Objective complete — final approach to ${to}`, 4_000);
  });
}

async function setObjective(host: CommandHost): Promise<void> {
  const journey = host.session.activeJourney;
  if (!journey) return withJourney(host, () => undefined);
  const objective = await vscode.window.showInputBox({
    title: 'Journey objective',
    prompt: 'What are you building on this journey?',
    value: journey.objective ?? '',
    placeHolder: 'e.g. Build the onboarding flow',
  });
  if (objective !== undefined) host.session.setObjective(objective);
}

async function endJourney(host: CommandHost): Promise<void> {
  const journey = host.session.activeJourney;
  if (!journey) return withJourney(host, () => undefined);
  if (journey.phase !== 'arrived' && journey.phase !== 'staying') {
    const to = host.session.packs.get(journey.packId)?.route.to ?? 'your destination';
    const ok = await vscode.window.showWarningMessage(
      `End your journey to ${to}?`,
      { modal: true, detail: 'You have not arrived yet. Progress toward this destination will be lost.' },
      'End Journey',
    );
    if (!ok) return;
  }
  host.session.endJourney();
}

// -------------------------------------------------------------- companion

async function companionUrlOrOffer(host: CommandHost): Promise<string | undefined> {
  const url = await host.companionUrl();
  if (url) return url;
  const pick = await vscode.window.showWarningMessage('The VibeTour Companion Display is turned off.', 'Turn On');
  if (!pick) return undefined;
  await host.enableCompanion();
  const started = await host.companionUrl();
  if (!started) void vscode.window.showErrorMessage('The Companion Display could not start. See the VibeTour output for details.');
  return started;
}

async function openCompanion(host: CommandHost): Promise<void> {
  const url = await companionUrlOrOffer(host);
  if (url) await vscode.env.openExternal(vscode.Uri.parse(url, true));
}

async function copyCompanionUrl(host: CommandHost): Promise<void> {
  const url = await companionUrlOrOffer(host);
  if (!url) return;
  await vscode.env.clipboard.writeText(url);
  void vscode.window.showInformationMessage('Companion Display URL copied. Open it in a browser on this computer — keep it private, it carries an access token.');
}

// -------------------------------------------------------------- glovebox

const DOC_RANK = [/^readme/i, /^contributing/i, /^changelog/i];

/** Glovebox (PRD §8): the project's own documentation, one keystroke away. */
async function openGlovebox(): Promise<void> {
  const found = await vscode.workspace.findFiles('{README*,CONTRIBUTING*,CHANGELOG*,docs/**/*.md}', '**/node_modules/**', 60);
  if (!found.length) {
    void vscode.window.showInformationMessage('No project docs found (README, CONTRIBUTING, CHANGELOG or docs/).');
    return;
  }
  const rank = (uri: vscode.Uri) => {
    const name = uri.path.split('/').pop() ?? '';
    const i = DOC_RANK.findIndex((re) => re.test(name));
    return i < 0 ? DOC_RANK.length : i;
  };
  const items = found
    .map((uri) => {
      const rel = vscode.workspace.asRelativePath(uri);
      const slash = rel.lastIndexOf('/');
      return { label: `$(book) ${rel.slice(slash + 1)}`, description: slash > 0 ? rel.slice(0, slash) : undefined, uri, rel };
    })
    .sort((a, b) => rank(a.uri) - rank(b.uri) || a.rel.localeCompare(b.rel));
  const picked = await vscode.window.showQuickPick(items, { title: 'Glovebox', placeHolder: 'Open project documentation', matchOnDescription: true });
  if (!picked) return;
  if (/\.(md|markdown)$/i.test(picked.uri.path)) await vscode.commands.executeCommand('markdown.showPreview', picked.uri);
  else await vscode.window.showTextDocument(picked.uri, { preview: true });
}

// -------------------------------------------------------------- privacy

async function toggleStreamingMode(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('vibetour');
  const on = !cfg.get<boolean>('privacy.streamingMode', false);
  // A workspace value would shadow a global change, so update where it is set.
  const target =
    cfg.inspect<boolean>('privacy.streamingMode')?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await cfg.update('privacy.streamingMode', on, target);
  vscode.window.setStatusBarMessage(
    on ? '$(eye-closed) VibeTour Streaming Mode on — private details hidden' : '$(eye) VibeTour Streaming Mode off',
    4_000,
  );
}

// -------------------------------------------------------------- agents

async function copyClaudeHooks(host: CommandHost): Promise<void> {
  const config = claudeHooksConfig(hookCommand(host.hookScriptPath()));
  await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
  const docs = vscode.Uri.joinPath(host.context.extensionUri, 'docs', 'agent-integration.md');
  let hasDocs = false;
  try {
    await vscode.workspace.fs.stat(docs);
    hasDocs = true;
  } catch {
    hasDocs = false;
  }
  const pick = await vscode.window.showInformationMessage(
    'Claude Code hook configuration copied. Merge it into .claude/settings.json in your project, or ~/.claude/settings.json for every project.',
    ...(hasDocs ? ['Open docs'] : []),
  );
  if (pick === 'Open docs') await vscode.commands.executeCommand('markdown.showPreview', docs);
}
