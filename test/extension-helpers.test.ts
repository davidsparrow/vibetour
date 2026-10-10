import { describe, expect, it } from 'vitest';
import {
  claudeHooksConfig,
  decodePngDataUrl,
  editOrigin,
  formatStatus,
  hookCommand,
  nextDisplayMode,
  safeCaptureName,
  shortCaption,
  summarizeDiagnostics,
} from '../src/extension/helpers';
import { BUILTIN_PACKS } from '../src/packs';
import { makeSession } from './helpers';

const coast = BUILTIN_PACKS.find((p) => p.id === 'california-coast')!;

describe('status bar text', () => {
  it('shows destination, progress and a short caption while travelling', () => {
    const { session, clock, type } = makeSession();
    expect(formatStatus(undefined, undefined).text).toBe('$(compass) VibeTour');
    session.startJourney('california-coast', 'coffee-run', undefined, 'Onboarding');
    type();
    clock.advance(6 * 60_000, 1_000);
    const s = session.latestSnapshot!;
    const status = formatStatus(s, coast);
    expect(status.text.startsWith(`$(compass) ${coast.route.to} · `)).toBe(true);
    expect(status.text).toContain(`${Math.round(s.journey!.progress * 100)}%`);
    expect(status.text).not.toContain(' — ');
    expect(status.tooltip).toContain(`${coast.route.from} → ${coast.route.to}`);
    expect(status.tooltip).toContain('Onboarding');
    expect(status.ariaLabel).toContain('percent');

    session.park();
    expect(formatStatus(session.latestSnapshot, coast).text).toBe(`$(compass) Parked · ${coast.route.to}`);
  });

  it('cuts captions at the dash', () => {
    expect(shortCaption('Steady autopilot cruise — agent at work')).toBe('Steady autopilot cruise');
    expect(shortCaption('x'.repeat(80))).toHaveLength(40);
  });
});

describe('summarizeDiagnostics', () => {
  it('counts the workspace and lists errors before warnings', () => {
    const warnings = Array.from({ length: 20 }, (_, i) => ({ severity: 'warning' as const, line: i + 1, message: `unused ${i}` }));
    const summary = summarizeDiagnostics([
      { path: 'src/b.ts', diagnostics: warnings },
      {
        path: 'src/a.ts',
        language: 'TypeScript',
        diagnostics: [
          { severity: 'error', line: 9, message: `Type 'string' is not assignable\n  to type 'number'. ${'x'.repeat(200)}` },
          { severity: 'error', line: 3, message: 'Cannot find name' },
        ],
      },
    ]);
    expect(summary.errors).toBe(2);
    expect(summary.warnings).toBe(20);
    expect(summary.top).toHaveLength(12);
    expect(summary.top.slice(0, 2).map((d) => [d.file.path, d.line, d.severity])).toEqual([
      ['src/a.ts', 3, 'error'],
      ['src/a.ts', 9, 'error'],
    ]);
    expect(summary.top[0].file).toEqual({ path: 'src/a.ts', name: 'a.ts', language: 'TypeScript' });
    expect(summary.top[1].message).not.toContain('\n');
    expect(summary.top[1].message.length).toBeLessThanOrEqual(140);
    expect(summary.top[2]).toMatchObject({ severity: 'warning', line: 1 });
  });
});

describe('edit origin', () => {
  it('attributes typing to the user and unseen edits to agents', () => {
    expect(editOrigin({ active: true, visible: true, undoRedo: false })).toBe('user');
    expect(editOrigin({ active: false, visible: false, undoRedo: false })).toBe('agent');
    expect(editOrigin({ active: false, visible: true, undoRedo: false })).toBe('unknown');
    expect(editOrigin({ active: false, visible: false, undoRedo: true })).toBe('user');
  });
});

describe('display modes', () => {
  it('cycles tour → dashboard → work', () => {
    expect(nextDisplayMode('tour')).toBe('dashboard');
    expect(nextDisplayMode('dashboard')).toBe('work');
    expect(nextDisplayMode('work')).toBe('tour');
    expect(nextDisplayMode(undefined)).toBe('tour');
  });
});

describe('capture', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('decodes only real PNG data URLs', () => {
    expect(Array.from(decodePngDataUrl(`data:image/png;base64,${png.toString('base64')}`)!)).toEqual(Array.from(png));
    expect(decodePngDataUrl(`data:image/jpeg;base64,${png.toString('base64')}`)).toBeUndefined();
    expect(decodePngDataUrl(`data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`)).toBeUndefined();
    expect(decodePngDataUrl('data:image/png;base64,***')).toBeUndefined();
    expect(decodePngDataUrl(42)).toBeUndefined();
  });

  it('makes safe file names', () => {
    expect(safeCaptureName('Coding from Tokyo.png')).toBe('Coding from Tokyo.png');
    expect(safeCaptureName('../../.ssh/authorized_keys')).toBe('authorized_keys.png');
    expect(safeCaptureName('a<b>:c?.PNG')).toBe('abc.png');
    expect(safeCaptureName(undefined, new Date('2026-10-09T18:30:00Z'))).toBe('vibetour-2026-10-09-18-30.png');
  });
});

describe('Claude Code hooks snippet', () => {
  it('runs the forwarder for every lifecycle event, with matchers only on tool events', () => {
    const command = hookCommand('/Users/me/.vibetour/bin/vibetour-hook.js');
    expect(command).toBe('node "/Users/me/.vibetour/bin/vibetour-hook.js"');
    const { hooks } = claudeHooksConfig(command);
    expect(Object.keys(hooks)).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'SessionEnd']);
    expect(hooks.PreToolUse).toEqual([{ matcher: '*', hooks: [{ type: 'command', command, timeout: 5 }] }]);
    expect(hooks.Stop).toEqual([{ hooks: [{ type: 'command', command, timeout: 5 }] }]);
    expect(hooks.Notification[0].matcher).toBeUndefined();
  });

  it('quotes awkward paths for the shell', () => {
    expect(hookCommand('C:\\Users\\Dev $ "x"\\hook.js')).toBe('node "C:/Users/Dev \\$ \\"x\\"/hook.js"');
  });
});
