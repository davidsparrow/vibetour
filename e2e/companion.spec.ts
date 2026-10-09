import { expect, test } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Companion Mode end to end (PRD §7 Mode D): the standalone CLI watches a
 * project, serves the display, and receives a Claude Code hook event.
 */

const root = resolve(__dirname, '..');
let cli: ChildProcess;
let url: string;
let project: string;
let home: string;

test.beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), 'vibetour-project-'));
  home = mkdtempSync(join(tmpdir(), 'vibetour-home-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project });
  writeFileSync(join(project, 'README.md'), '# demo\n');
  cli = spawn(process.execPath, [join(root, 'dist/cli.js'), project, '--port', '0', '--no-open'], {
    env: { ...process.env, VIBETOUR_HOME: home },
  });
  url = await new Promise<string>((ok, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`CLI did not print a URL:\n${out}`)), 15_000);
    cli.stdout!.on('data', (d) => {
      out += String(d);
      const m = out.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+/);
      if (m) {
        clearTimeout(timer);
        ok(m[0]);
      }
    });
    cli.stderr!.on('data', (d) => (out += String(d)));
  });
});

test.afterAll(() => {
  cli?.kill('SIGTERM');
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test('a browser companion follows a project and its coding agent', async ({ page }) => {
  await page.goto(url);
  await expect(page.locator('.vt')).toHaveAttribute('data-host', 'cli');
  await expect(page.getByRole('heading', { name: 'Where do you want to go today?' })).toBeVisible();

  await page.locator('.card', { hasText: 'Tokyo After Dark' }).getByRole('button', { name: /Get ticket/ }).click();
  await page.getByRole('button', { name: 'Depart now' }).click();
  await expect(page.locator('.hud-location')).toHaveText(/Shibuya/);

  writeFileSync(join(project, 'feature.ts'), 'export const answer = 42;\n');
  await expect(page.locator('.mirror-list')).toContainText('feature.ts', { timeout: 15_000 });

  // A Claude Code hook reports the agent waiting for approval; the forwarder strips content.
  const hook = spawnSync(process.execPath, [join(root, 'bin/vibetour-hook.js')], {
    input: JSON.stringify({ hook_event_name: 'Notification', session_id: 'abc12345', notification_type: 'permission_prompt', message: 'secret prompt text' }),
    env: { ...process.env, VIBETOUR_HOME: home },
  });
  expect(hook.status).toBe(0);
  expect(String(hook.stdout)).toBe('');
  await page.keyboard.press('d');
  await page.getByRole('tab', { name: 'Radio' }).click();
  await expect(page.locator('.radio')).toContainText('Claude');
  await expect(page.locator('.radio')).toContainText('Needs your approval');
  await expect(page.locator('.radio')).not.toContainText('secret prompt text');
});

test('rejects requests without the token', async ({ request }) => {
  const base = new URL(url);
  const res = await request.get(`${base.origin}/events`);
  expect(res.status()).toBe(401);
  const cmd = await request.post(`${base.origin}/command`, { data: { type: 'park' } });
  expect(cmd.status()).toBe(401);
});
