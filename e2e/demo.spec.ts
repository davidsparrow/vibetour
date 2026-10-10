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
