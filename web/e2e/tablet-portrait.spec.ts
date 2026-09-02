import { expect, test } from '@playwright/test';

test('keeps tablet portrait controls compact, separated, and touch sized', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const stateResponse = page.waitForResponse((response) => response.url().endsWith('/api/state') && response.ok());
  await page.goto('/');
  await stateResponse;

  await expect(page.locator('html')).toHaveAttribute('data-view-class', 'mobile');
  await expect(page.locator('#map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });

  const summary = page.locator('#layers-summary');
  const disclosure = page.locator('#layers-disclosure');
  await expect(summary).toBeVisible();
  await expect(disclosure).not.toHaveAttribute('open', '');
  await expect(page.locator('#follow-button, #sound-button, #reset-button')).toHaveCount(3);
  await expect(page.locator('#routes-button')).toBeHidden();

  const chrome = await page.locator('#topbar, .controls').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
  }));
  expect(chrome).toHaveLength(2);
  expect(chrome[0].right).toBeLessThanOrEqual(chrome[1].left);

  const primarySizes = await page.locator('#follow-button, #sound-button, #reset-button, #layers-summary').evaluateAll(
    (elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }),
  );
  for (const size of primarySizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  await summary.click();
  await expect(disclosure).toHaveAttribute('open', '');
  const layerButtons = ['routes', 'heatmap', 'clusters', 'hillshade', 'terrain'];
  for (const id of layerButtons) await expect(page.locator(`#${id}-button`)).toBeVisible();
  await expect(page.locator('#route-window')).toBeVisible();

  const overflow = await page.locator('#topbar, .controls, .layers-panel').evaluateAll((elements) => elements.some((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left < -0.5 || bounds.right > innerWidth + 0.5 || bounds.top < -0.5 || bounds.bottom > innerHeight + 0.5;
  }));
  expect(overflow).toBe(false);
  expect(consoleErrors).toEqual([]);
});
