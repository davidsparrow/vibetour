import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end checks of the browser app against the in-page demo host, which
 * runs the real VibeTour engine with a simulated coding session.
 */

async function bookFirstJourney(page: Page, objective = 'Onboarding flow') {
  await page.locator('.picker.show .card').first().getByRole('button', { name: /Get ticket/ }).click();
  await expect(page.locator('.ticket')).toBeVisible();
  await expect(page.getByText('Your ticket is ready.')).toBeVisible();
  await page.getByLabel('Journey objective').fill(objective);
  await page.getByRole('button', { name: 'Depart now' }).click();
  await expect(page.locator('.picker')).not.toHaveClass(/show/);
}

test('opens on "Where do you want to go today?" with every destination', async ({ page }) => {
  await page.goto('/?fresh');
  await expect(page.getByRole('heading', { name: 'Where do you want to go today?' })).toBeVisible();
  await expect(page.locator('.picker.show .card')).toHaveCount(7);
  for (const title of ['California Coast', 'Tokyo After Dark', 'Swiss Alpine Morning', 'Tuscany Golden Hour', 'Iceland South Coast', 'Scottish Highlands', 'Mars Colony Drive']) {
    await expect(page.locator('.card h3', { hasText: title })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Take me somewhere' })).toBeVisible();
});

test('departs on a journey and renders the drive', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await expect(page.locator('.hud-location')).toHaveText(/Monterey/);
  await expect(page.locator('.nav-objective')).toContainText('Onboarding flow');
  await expect.poll(() => page.evaluate(() => (window as any).vibetour.renderer.renderer.info.render.frame), { timeout: 20_000 }).toBeGreaterThan(3);
  await expect(page.locator('.nav-route')).toContainText('California Coast');
});

test('switches between Tour, Dashboard and Work modes from the keyboard', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  const root = page.locator('.vt');
  await page.keyboard.press('t');
  await expect(root).toHaveClass(/mode-tour/);
  await expect(page.locator('.tour-strip')).toBeVisible();
  await page.keyboard.press('w');
  await expect(root).toHaveClass(/mode-work/);
  await expect(page.locator('.work-panel h3', { hasText: 'Problems' })).toBeVisible();
  await page.keyboard.press('d');
  await expect(root).toHaveClass(/mode-dashboard/);
  await expect(page.getByRole('meter', { name: /Speedometer/ })).toBeVisible();
});

test('the demo story drives the cockpit: agent work, tests and a scenic stop', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Agent edits' }).click();
  await expect(page.locator('.recent-list')).toContainText('Agent edited');
  await page.getByRole('button', { name: 'Tests pass' }).click();
  await expect(page.locator('.console')).toContainText('npm test');
  await page.getByRole('button', { name: 'Agent asks' }).click();
  // The card says why the car stopped, with the alert that stopped it on its top edge, in red.
  await expect(page.locator('.stop-card.show')).toContainText('Claude has a question for you. The journey resumes when you answer.', { timeout: 20_000 });
  const pill = page.locator('.stop-pill').getByRole('button', { name: 'Claude has a question' });
  await expect(pill).toHaveClass(/alert-blocking/);
  await expect(page.locator('.alert-bell')).toHaveClass(/lit-blocking/);
  await expect(page.locator('.light-agent')).toHaveClass(/on/);
  await pill.click();
  await expect(page.locator('.toast')).toContainText('In VS Code this takes you to Claude.');
  // The top bell opens the Alerts tab, which lists it too.
  await page.locator('.alert-bell').click();
  await expect(page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'Claude has a question' })).toBeVisible();
  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page.locator('.stop-card')).not.toHaveClass(/show/, { timeout: 20_000 });
  await expect(page.getByRole('region', { name: 'Needs you' })).not.toContainText('Claude has a question');
});

test('the Changes gauge counts uncommitted files and opens Source Control', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  const gauge = page.getByRole('button', { name: /Open Source Control/ });
  await expect(gauge).toHaveAttribute('aria-label', /Nothing to commit/);
  await expect(page.locator('.gauge-digital')).not.toHaveClass(/gauge-lit/);
  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Agent edits' }).click();
  await expect(gauge).toHaveAttribute('aria-label', /^1 file changed, not committed, 1 commit to push/);
  await expect(page.locator('.gauge-digital')).toHaveClass(/gauge-lit/);
  await expect(page.locator('.gauge-digital .gauge-readout')).toHaveText('1');
  await gauge.click();
  await expect(page.locator('.toast')).toContainText('In VS Code this opens Source Control.');
  // Changed files light the bells blue and are listed in the Alerts tab.
  await expect(page.locator('.alert-bell')).toHaveClass(/lit-general/);
  await page.locator('.tab-alerts').click();
  await expect(page.locator('.alerts-files')).toContainText('Changed · 1');
  await expect(page.locator('.alerts-files .file-pill:not(.file-active)')).toHaveText(['OnboardingFlow.tsx']);
  await page.keyboard.press('s');
  await page.getByLabel(/Changes gauge/).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(gauge).toBeHidden();
});

test('the PRs tab lists open pull requests, lights the ones on this branch and raises an alert', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.getByRole('tab', { name: /PRs/ }).click();
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  const rows = page.locator('.pr-row');
  await expect(rows).toHaveCount(3);
  // The PR on the checked-out branch comes first, with its branch lit.
  await expect(rows.first()).toHaveClass(/on-branch/);
  await expect(rows.first()).toContainText('#42');
  await expect(rows.first()).toContainText('↑4 ↓1');
  await expect(rows.first().locator('.icon-branch')).toBeVisible();
  await expect(page.locator('.pr-row.on-branch')).toHaveCount(1);
  await expect(page.locator('.tab-badge')).toHaveText('3');
  await expect(page.locator('.tab-badge')).toHaveClass(/hot/);

  await expect(rows.first().locator('.pr-num')).toHaveText('#42');
  await expect(rows.first()).toContainText('@you');
  await rows.first().click();
  await expect(page.locator('.toast')).toContainText('opens PR #42 on GitHub');

  // A PR that needs you lights the bells orange and is listed in the Alerts tab.
  await expect(page.locator('.alert-bell')).toHaveClass(/lit-moderate/);
  await page.locator('.tab-alerts').click();
  const alert = page.getByRole('region', { name: 'Needs you' }).getByRole('button', { name: 'PR #42 · CI failing' });
  await expect(alert).toHaveClass(/alert-moderate/);

  // Each kind of alert has its own switch on each screen.
  await page.keyboard.press('s');
  await page.getByLabel(/Pull requests/).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(alert).toBeHidden();
  await expect(page.locator('.alert-bell')).not.toHaveClass(/lit-/);
  await page.evaluate(() => localStorage.removeItem('vibetour.prefs.demo'));
});

test('a slow click on the stop card still lands while snapshots stream in', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.evaluate(() => (window as any).vibetour.send({ type: 'park' }));
  const resume = page.locator('.stop-card.show').getByRole('button', { name: 'Resume journey' });
  await expect(resume).toBeVisible();
  // Several 250 ms snapshots arrive between press and release.
  await resume.hover();
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.locator('.stop-card')).not.toHaveClass(/show/);
});

test('ending or replacing a journey that has not arrived takes a second click', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.keyboard.press('g');
  const banner = page.locator('.picker.show .banner', { hasText: 'On the road' });
  await banner.getByRole('button', { name: 'End it here' }).click();
  await expect(banner).toBeVisible();
  // Clicking elsewhere disarms it; there is no countdown to race.
  await page.getByRole('heading', { name: 'Where do you want to go today?' }).click();
  await banner.getByRole('button', { name: 'End it here' }).click();
  await banner.getByRole('button', { name: 'Lose progress? Click again' }).click();
  await expect(banner).toHaveCount(0);

  await bookFirstJourney(page);
  await page.keyboard.press('g');
  await page.locator('.picker.show .card').nth(1).getByRole('button', { name: /Get ticket/ }).click();
  await expect(page.getByText(/Departing ends your journey to California Coast/)).toBeVisible();
  await page.getByRole('button', { name: 'Depart now' }).click();
  await expect(page.locator('.picker')).toHaveClass(/show/);
  await page.getByRole('button', { name: 'Leave current journey? Click again' }).click();
  await expect(page.locator('.picker')).not.toHaveClass(/show/);
  await expect(page.locator('.nav-route')).toContainText('Tokyo After Dark');
});

test('a test run started before "Go idle" still finishes', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0&speed=10');
  await bookFirstJourney(page);
  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Tests pass' }).click();
  await expect(page.locator('.console .proc.running')).toContainText('npm test');
  await page.getByRole('button', { name: 'Go idle' }).click();
  await expect(page.locator('.recent-list')).toContainText('Tests passed', { timeout: 10_000 });
  await expect(page.locator('.console .proc.running')).toHaveCount(0);
});

test('an agent finishing its turn can pull over and light this display\'s your-turn cue', async ({ page }) => {
  // 10× time with a 30 s pull-over: the stop comes about 3 s after the turn ends.
  await page.goto('/?fresh&autopilot=0&speed=10&turnStop=30');
  await bookFirstJourney(page);
  await expect(page.locator('.light-turn')).toHaveClass(/unused/);
  await page.keyboard.press('s');
  await page.getByRole('group', { name: 'Your-turn cue' }).getByRole('button', { name: 'Blue light' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.light-turn')).not.toHaveClass(/unused/);
  await expect(page.locator('.light-turn')).not.toHaveClass(/\bon\b/);

  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Go idle' }).click();
  await expect(page.locator('.light-turn')).toHaveClass(/\bon\b/);
  await expect(page.locator('.stop-card.show')).toContainText('Claude finished its turn', { timeout: 15_000 });
  await expect(page.locator('.stop-pill .alert')).toHaveText('↩Claude finished · your turn');
  await expect(page.locator('.stop-pill .alert')).toHaveClass(/alert-moderate/);
  await expect(page.locator('.hud-caption')).toContainText('Claude finished, your turn');

  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page.locator('.stop-card')).not.toHaveClass(/show/);
  await expect(page.locator('.light-turn')).not.toHaveClass(/\bon\b/);
});

test('arriving stamps the passport', async ({ page }) => {
  // 20× time: the 90 s final approach takes ~5 s, well before the driver counts as idle.
  await page.goto('/?fresh&autopilot=0&speed=20');
  await bookFirstJourney(page, 'Billing system');
  await page.keyboard.press('a');
  const card = page.locator('.arrival.show');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Monterey → Big Sur');
  await expect(card).toContainText('Completed: Billing system');
  await expect(card).toContainText('Passport stamped');
  await card.getByRole('button', { name: 'Passport' }).click();
  await expect(page.locator('.passport.show .stamp')).toHaveCount(1);
  await expect(page.locator('.stamp-title')).toHaveText('California Coast');
  await expect(page.locator('.pstat', { hasText: 'Routes completed' })).toContainText('1');
});

test('refuelling after arriving stops for fuel, then drives the same route again', async ({ page }) => {
  // 8× time: the final approach takes ~11 s and the 15 s refuel stop about 2 s.
  await page.goto('/?fresh&autopilot=0&speed=8');
  await bookFirstJourney(page, 'Billing system');
  await page.keyboard.press('a');
  const card = page.locator('.arrival.show');
  await expect(card).toBeVisible({ timeout: 40_000 });
  await card.getByRole('button', { name: 'Refuel and drive again' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.stop-card.show')).toContainText('Refuelling at a Carmel Highlands gas station');
  // Keep coding through the stop: at 8× the 20 s that counts as coding is 2.5 s, so
  // without it the car could drive off already in "thinking" and say so instead.
  await page.locator('.demo-panel summary').click();
  const typing = setInterval(() => void page.getByRole('button', { name: 'Type code' }).click().catch(() => undefined), 400);
  try {
    await expect(page.locator('.hud-caption')).toContainText('Departing Monterey', { timeout: 15_000 });
  } finally {
    clearInterval(typing);
  }
  await expect(page.locator('.stop-card')).not.toHaveClass(/show/);
  await page.keyboard.press('p');
  await expect(page.locator('.passport.show .stamp')).toHaveCount(1);
});

test('captures the workplace as a PNG without private details', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  const download = page.waitForEvent('download');
  await page.keyboard.press('c');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^vibetour-california-coast-\d{4}-\d{2}-\d{2}\.png$/);
});

test('settings persist and accessibility options apply', async ({ page }) => {
  await page.goto('/?fresh');
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByText('Reduced motion', { exact: true }).click();
  await page.getByText('High-contrast instruments', { exact: true }).click();
  await expect(page.locator('.vt')).toHaveClass(/reduced-motion/);
  await expect(page.locator('.vt')).toHaveClass(/high-contrast/);
  await page.reload();
  await expect(page.locator('.vt')).toHaveClass(/reduced-motion/);
  // Restore defaults for other tests.
  await page.evaluate(() => localStorage.removeItem('vibetour.prefs.demo'));
});

test('announces journey changes to screen readers', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await expect(page.locator('.sr-only[aria-live="polite"]')).not.toBeEmpty();
});

test('fits a phone screen without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?fresh');
  await expect(page.locator('.picker.show .card').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const cardWidth = await page.locator('.card').first().evaluate((el) => el.getBoundingClientRect().width);
  expect(cardWidth).toBeLessThanOrEqual(390 - 32 + 1);
});

test('the context and battery gauges follow Settings', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'getBattery', {
      configurable: true,
      value: () => Promise.resolve({ level: 0.42, charging: false, dischargingTime: 5400, addEventListener() {} }),
    });
  });
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  const context = page.getByRole('meter', { name: 'Agent context window left' });
  const battery = page.getByRole('meter', { name: 'Battery', exact: true });
  await expect(context).toBeVisible();
  await expect(context).toHaveAttribute('aria-valuetext', /No agent has reported/);
  await expect(battery).toBeHidden();

  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Agent edits' }).click();
  await expect(context).toHaveAttribute('aria-valuetext', /percent of the agent context window left/);

  await page.keyboard.press('s');
  await page.getByLabel(/Battery gauge/).check();
  await page.getByLabel(/Context gauge/).uncheck();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(battery).toBeVisible();
  await expect(battery).toHaveAttribute('aria-valuetext', 'Battery 42 percent');
  await expect(context).toBeHidden();
});

test('the battery gauge stays hidden, and says why, where the browser reports no battery', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as { getBattery?: unknown }).getBattery;
  });
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.keyboard.press('s');
  await expect(page.locator('.battery-note')).toContainText('Always hidden in Safari and Firefox');
  await page.getByLabel(/Battery gauge/).check();
  await expect(page.locator('.battery-note')).toContainText("Hidden on this screen: this browser doesn't report battery.");
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('meter', { name: 'Battery', exact: true })).toBeHidden();
});
