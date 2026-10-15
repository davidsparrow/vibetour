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
  await expect(page.locator('.chip-task')).toHaveText('Onboarding flow');
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
  await expect(page.locator('.mirror-list')).toContainText('Agent edited');
  await page.getByRole('button', { name: 'Tests pass' }).click();
  await expect(page.locator('.hud-chips')).toContainText('npm test · running');
  await page.getByRole('button', { name: 'Agent asks' }).click();
  await expect(page.locator('.stop-card.show')).toContainText('Claude is waiting for you', { timeout: 20_000 });
  await expect(page.locator('.light-agent')).toHaveClass(/on/);
  await page.getByRole('button', { name: 'Answer' }).click();
  await expect(page.locator('.stop-card')).not.toHaveClass(/show/, { timeout: 20_000 });
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
  await expect(page.locator('.hud-chips')).toContainText('npm test · running');
  await page.getByRole('button', { name: 'Go idle' }).click();
  await expect(page.locator('.mirror-list')).toContainText('Tests passed', { timeout: 10_000 });
  await expect(page.locator('.hud-chips')).not.toContainText('running');
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
  await expect(page.locator('.stop-card.show')).toContainText('Refuelling · a Carmel Highlands gas station');
  await expect(page.locator('.hud-caption')).toContainText('Departing Monterey', { timeout: 15_000 });
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

test('the radio: CB has the agents, FM needs a real host, and the lights follow the Focus Mix', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await page.keyboard.press('t');
  await page.keyboard.press('r');
  await expect(page.locator('.vt')).toHaveClass(/mode-dashboard/);
  await expect(page.getByRole('tab', { name: 'Radio' })).toHaveAttribute('aria-selected', 'true');
  // FM: the demo host has no internet radio, and says so.
  await expect(page.locator('.deck-note')).toHaveText('Internet radio needs the VS Code extension or the CLI.');
  await expect(page.locator('.deck-power')).toBeDisabled();
  const eq = page.locator('canvas.deck-eq');
  await expect(eq).toBeVisible();
  // Lit segments are drawn nearly opaque; the dark grid is faint.
  const litPixels = () =>
    eq.evaluate((c: HTMLCanvasElement) => {
      const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 150) lit++;
      return lit;
    });
  expect(await litPixels()).toBe(0);
  // Sound on: the Focus Mix plays into the equalizer.
  await page.keyboard.press('m');
  await expect.poll(litPixels, { timeout: 15_000 }).toBeGreaterThan(0);
  // CB: the agents.
  await page.locator('.demo-panel summary').click();
  await page.getByRole('button', { name: 'Agent asks' }).click();
  await page.getByRole('button', { name: 'CB', exact: true }).click();
  await expect(page.locator('.deck-cb')).toContainText('Claude');
  await expect(page.locator('.deck-fm')).toBeHidden();
  await expect(page.locator('.band-cb')).toHaveClass(/alert/);
  await page.evaluate(() => localStorage.removeItem('vibetour.prefs.demo'));
});

test('announces journey changes to screen readers', async ({ page }) => {
  await page.goto('/?fresh&autopilot=0');
  await bookFirstJourney(page);
  await expect(page.locator('[aria-live="polite"]')).not.toBeEmpty();
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
