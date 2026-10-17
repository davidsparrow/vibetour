// Steps that put the demo (or the CLI companion) into a state worth a picture.

/** Books the first destination on the board and departs. A journey already under way (the companion keeps one) is kept. */
export async function depart(page, objective = 'Onboarding flow') {
  const board = page.locator('.picker.show .card').first();
  if (!(await board.waitFor({ timeout: 4_000 }).then(() => true, () => false))) return;
  await board.getByRole('button', { name: /Get ticket/ }).click();
  await page.getByLabel('Journey objective').fill(objective);
  await page.getByRole('button', { name: 'Depart now' }).click();
  await page.locator('.picker.show').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** Opens the demo's panel from its pill on the glovebox, presses its buttons ("Agent edits", "Agent asks"…), then closes it. */
export async function demo(page, ...buttons) {
  await page.locator('.demo-pill').click();
  for (const name of buttons) {
    await page.locator('.demo-panel').getByRole('button', { name, exact: true }).click();
    await page.waitForTimeout(250);
  }
  await page.locator('.demo-close').click();
}

/** Switches the display mode by its key: `t` Tour, `d` Dash, `w` Work. */
export async function mode(page, key) {
  await page.keyboard.press(key);
  await page.waitForTimeout(700);
}

/** Opens a console tab on the dash. */
export async function tab(page, id) {
  await page.locator(`.tab-${id}`).click();
  await page.waitForTimeout(500);
}

/** Lets the scene settle: gauges ease, the renderer draws a few frames. */
export const settle = (page, ms = 1_500) => page.waitForTimeout(ms);
