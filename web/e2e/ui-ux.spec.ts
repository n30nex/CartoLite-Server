import { expect, test } from '@playwright/test';
import { openMapOptions } from './mapControls';
import { visualFixture, visualPacket } from './visualFixtures';

test('puts everyday layers first and keeps close reachable while scrolling options', async ({ page }, info) => {
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#layers-summary').click();
  await expect(page.locator('#map-appearance')).not.toHaveAttribute('open');
  await expect(page.locator('#terrain-options')).not.toHaveAttribute('open');
  await expect(page.locator('#basemap-style')).toBeHidden();
  const panel = await page.locator('#layers-panel').boundingBox();
  for (const id of ['routes-button', 'live-packets-button', 'heatmap-button', 'clusters-button']) {
    const box = await page.locator('#' + id).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(panel!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
  }
  await expect(page.locator('#layer-summary')).toContainText('layers on');
  await page.screenshot({ path: info.outputPath('layers-first.png') });
  await openMapOptions(page);
  await page.locator('.display-advanced > summary').click();
  await page.getByLabel('After-trails', { exact: true }).press('End');
  const close = await page.locator('#layers-close').boundingBox();
  expect(close!.y).toBeGreaterThanOrEqual(panel!.y);
  expect(close!.y + close!.height).toBeLessThan(panel!.y + 80);
  await page.locator('#layers-close').click();
  await expect(page.locator('#layers-summary')).toBeFocused();
});

test('resets layers without discarding appearance or sound preferences', async ({ page }) => {
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#sound-button').click();
  await page.locator('#sound-volume').press('Home');
  await page.locator('#sound-volume').press('ArrowRight');
  await openMapOptions(page);
  await page.locator('#basemap-style').selectOption('streets');
  await page.getByLabel('Route style', { exact: true }).selectOption('neon');
  await page.locator('#terrain-button').click();
  await page.locator('#reset-layers').click();
  await expect(page.locator('#map')).toHaveAttribute('data-basemap-style', 'streets');
  await expect(page.locator('#map')).toHaveAttribute('data-route-preset', 'neon');
  await expect(page.locator('#terrain-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#routes-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#heatmap-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sound-volume')).toHaveValue('1');
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#reset-appearance').click();
  await expect(page.locator('#map')).toHaveAttribute('data-basemap-style', 'dark');
  await expect(page.locator('#map')).toHaveAttribute('data-route-preset', 'crisp');
  await expect(page.locator('#sound-volume')).toHaveValue('1');
});

test('explains zoom-dependent buildings and enables camera controls only in 3D', async ({ page }, info) => {
  await visualFixture(page);
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await openMapOptions(page);
  await page.locator('#buildings-button').click();
  await expect(page.locator('#building-status')).toContainText('Zoom in');
  await expect(page.locator('#camera-pitch')).toBeDisabled();
  await expect(page.locator('#terrain-height')).toBeDisabled();
  await expect(page.locator('#terrain-relief')).toBeDisabled();
  await page.locator('#terrain-button').click();
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#camera-pitch')).toBeEnabled();
  await expect(page.locator('#terrain-height')).toBeEnabled();
  await expect(page.locator('#terrain-relief')).toBeEnabled();
  await page.keyboard.press('Escape');
  for (let step = 0; step < 3; step++) {
    await page.locator('.maplibregl-canvas').press('Equal');
    await expect(map).toHaveAttribute('data-camera-moving', 'false');
  }
  await openMapOptions(page);
  await expect(page.locator('#building-status')).toHaveText(info.project.name === 'desktop'
    ? 'Mapped building heights are shown where available.' : 'Building footprints are enabled.');
});

test('Netgraph menus are exclusive for keyboard users and its camera supports keys', async ({ page }, info) => {
  await visualFixture(page);
  await page.goto('/netgraph/');
  await expect(page.locator('#connected-count')).toHaveText('2');
  await page.locator('#find-button').press('Enter');
  await page.locator('#display-button').press('Enter');
  await expect(page.locator('#find-panel')).toBeHidden();
  await expect(page.locator('#display-panel')).toBeVisible();
  await page.locator('#sound-button').press('Enter');
  await expect(page.locator('#display-panel')).toBeHidden();
  await expect(page.locator('#sound-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-button')).toBeFocused();
  if (info.project.name === 'desktop') {
    const stage = page.locator('#netgraph-stage');
    const center = await stage.getAttribute('data-view-center');
    const scale = Number(await stage.getAttribute('data-view-scale'));
    await stage.press('ArrowRight');
    await expect(stage).not.toHaveAttribute('data-view-center', center!);
    await stage.press('Equal');
    await expect.poll(async () => Number(await stage.getAttribute('data-view-scale'))).toBeGreaterThan(scale);
    await stage.press('Home');
    await expect(page.locator('#connected-count')).toHaveText('2');
  }
  if (page.viewportSize()!.width <= 480) {
    for (const label of ['nodes', 'links', 'areas', 'groups']) await expect(page.locator('.summary-compact').filter({ hasText: label })).toBeVisible();
    const summary = await page.locator('#graph-summary').boundingBox();
    const controls = await page.locator('.controls').boundingBox();
    expect(summary!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
  }
});

test('node details keep a named close button after live updates and explain totals', async ({ page }) => {
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Visual Alpha');
  await page.getByRole('option', { name: /Visual Alpha/ }).click();
  await visualPacket(page, 1);
  await expect(page.locator('.neighbor-row')).toContainText('total observations');
  await expect(page.locator('.inspector-window-note')).toContainText('earlier observations');
  await page.getByRole('button', { name: 'Close node details', exact: true }).click();
  await expect(page.locator('.node-inspector')).toBeHidden();
});

test('pausing Follow stops a camera transition immediately', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'camera timing is checked once');
  await visualFixture(page, 15);
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#follow-button').click();
  await visualPacket(page, 1);
  await expect(map).toHaveAttribute('data-camera-moving', 'true');
  await page.locator('#follow-pause').click();
  await expect(map).toHaveAttribute('data-camera-moving', 'false');
  await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'paused');
});

test('blocked browser storage does not prevent Map, Netgraph, or Labs startup', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'storage behavior does not depend on viewport');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true, get() { throw new DOMException('Storage disabled', 'SecurityError'); },
  }));
  await page.goto('/');
  await expect(page.locator('#status-text')).not.toHaveText('Starting…');
  await expect(page.locator('#fatal')).toBeHidden();
  const hasLabs = await page.locator('#labs-link').count() > 0;
  await page.locator('#layers-summary').click();
  await expect(page.locator('#layers-panel')).toBeVisible();
  await page.goto('/netgraph/');
  await expect(page.locator('#status-text')).not.toHaveText('Starting…');
  await expect(page.locator('#fatal')).toBeHidden();
  if (hasLabs) {
    await page.goto('/labs/?demo=1');
    await expect(page.locator('#labs-app')).toHaveAttribute('data-loading', 'false');
    await expect(page.locator('#labs-fatal')).toBeHidden();
  }
  expect(errors).toEqual([]);
});
