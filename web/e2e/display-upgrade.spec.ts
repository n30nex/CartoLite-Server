import { expect, test, type Page } from '@playwright/test';
import { openMapOptions } from './mapControls';
import { visualFixture, visualPacket } from './visualFixtures';

test('shares presets and custom styling across Map and Netgraph without losing context', async ({ page, context }, info) => {
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Visual Alpha');
  await page.getByRole('option', { name: /Visual Alpha/ }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a');
  const source = await page.locator('#map').getAttribute('data-route-source-revision');
  await openMapOptions(page);
  await page.locator('#interface-theme').selectOption('light');
  expect(await page.locator('.route-legend-item[aria-label="Trace"] i').evaluate((element) => getComputedStyle(element, '::after').backgroundColor)).toBe('rgb(255, 209, 90)');
  await page.locator('#interface-theme').selectOption('map');
  for (const preset of ['crisp', 'neon', 'dashed', 'dotted', 'ribbon', 'comet']) {
    await page.getByLabel('Route style', { exact: true }).selectOption(preset);
    await expect(page.locator('#map')).toHaveAttribute('data-route-preset', preset);
    await expect(page.locator('#map')).toHaveAttribute('data-route-source-revision', source!);
  }
  await page.locator('.display-advanced > summary').click();
  await page.getByLabel('Line width', { exact: true }).press('Home');
  await page.getByLabel('Line width', { exact: true }).press('ArrowRight');
  await expect(page.getByLabel('Route style', { exact: true })).toHaveValue('custom');
  await page.locator('#basemap-style').selectOption('light');
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-summary')).toBeFocused();
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a');
  const graph = await context.newPage();
  await visualFixture(graph);
  await graph.goto('/netgraph/');
  await expect(graph.locator('#connected-count')).toHaveText('2');
  await expect(graph.locator('html')).toHaveAttribute('data-basemap', 'light');
  await graph.locator('#display-button').click();
  await expect(graph.getByLabel('Route style', { exact: true })).toHaveValue('custom');
  await graph.getByLabel('Route style', { exact: true }).selectOption('ribbon');
  await graph.getByLabel('Scene style', { exact: true }).selectOption('streets');
  await expect(page.locator('#map')).toHaveAttribute('data-basemap-style', 'streets');
  await expect(page.locator('#map')).toHaveAttribute('data-route-preset', 'ribbon');
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a');
  await expect(graph.locator('#netgraph-stage')).toHaveAttribute('data-route-preset', 'ribbon');
  await graph.keyboard.press('Escape');
  await expect(graph.locator('#display-button')).toBeFocused();
  await graph.reload();
  await expect(graph.locator('html')).toHaveAttribute('data-basemap', 'streets');
  await graph.screenshot({ path: info.outputPath('netgraph-paper.png') });
  await graph.close();
  await expect(page.locator('#map-notice')).toBeHidden();
});

test('uses bright packet ink at night and dark ink on both light scenes', async ({ page }, info) => {
  await visualFixture(page);
  let sequence = 0;
  for (const path of ['/', '/netgraph/']) {
    sequence = 0;
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
    for (const scene of ['dark', 'light', 'streets']) {
      if (path === '/') { await openMapOptions(page); await page.locator('#basemap-style').selectOption(scene); }
      else { await page.locator('#display-button').click(); await page.getByLabel('Scene style', { exact: true }).selectOption(scene); }
      await page.keyboard.press('Escape');
      await visualPacket(page, ++sequence);
      await expect.poll(() => packetInk(page, scene !== 'dark'), { timeout: 3000 }).toBeGreaterThan(2);
      await page.screenshot({ path: info.outputPath(`${path === '/' ? 'map' : 'netgraph'}-${scene}.png`) });
    }
  }
});

test('reports missing tiles while keeping node data and Netgraph available', async ({ page }) => {
  await visualFixture(page);
  await page.route('https://tiles.openfreemap.org/fixture/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('title', '3 nodes · 1 routes');
  await expect(page.locator('#map-notice')).toBeVisible();
  await expect(page.locator('#map-notice')).toContainText('Some map details could not load');
  await page.goto('/netgraph/');
  await expect(page.locator('#connected-count')).toHaveText('2');
  await expect(page.locator('#fatal')).toBeHidden();
});

test('shows matching region colors in a viewport legend only when Regions is enabled', async ({ page }, info) => {
  await visualFixture(page);
  await page.goto('/');
  test.skip(await page.locator('#regions-button').count() === 0, 'Canada region layer only');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await openMapOptions(page);
  await page.locator('#regions-button').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#region-legend > summary')).toHaveText(/Regions in view \([1-9]\d*\)/);
  if (await page.locator('#region-legend').getAttribute('open') === null) await page.locator('#region-legend > summary').click();
  await expect(page.locator('.region-legend-list > span').first()).toBeVisible();
  const colors = await page.locator('.region-legend-list i').evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
  expect(colors.every((color) => color !== 'rgba(0, 0, 0, 0)')).toBe(true);
  const regionBounds = await page.locator('.region-legend-list').boundingBox();
  const packetBounds = await page.locator('#route-legend').boundingBox();
  if (regionBounds && packetBounds) {
    const overlap = Math.max(0, Math.min(regionBounds.x + regionBounds.width, packetBounds.x + packetBounds.width) - Math.max(regionBounds.x, packetBounds.x))
      * Math.max(0, Math.min(regionBounds.y + regionBounds.height, packetBounds.y + packetBounds.height) - Math.max(regionBounds.y, packetBounds.y));
    expect(overlap, 'packet and region legends must not cover each other').toBe(0);
  }
  await page.screenshot({ path: info.outputPath('region-colors-legend.png') });
  await openMapOptions(page);
  await page.locator('#regions-button').click();
  await expect(page.locator('#region-legend')).toBeHidden();
});

test('renders buildings in desktop 3D and preserves controllable camera orientation', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop 3D feature; mobile controls are covered separately');
  await visualFixture(page, 15);
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await openMapOptions(page);
  await page.locator('#routes-button').click();
  await page.locator('#terrain-button').click();
  await expect(page.locator('#hillshade-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#buildings-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(map).toHaveAttribute('data-buildings-loaded', 'true');
  await expect(map).toHaveAttribute('data-camera-moving', 'false');
  await page.locator('#buildings-button').click();
  await page.keyboard.press('Escape');
  const size = page.viewportSize()!;
  const clip = { x: size.width / 2 - 150, y: size.height / 2 - 150, width: 300, height: 300 };
  const without = await page.screenshot({ clip });
  await openMapOptions(page);
  await page.locator('#buildings-button').click();
  await expect(map).toHaveAttribute('data-buildings-loaded', 'true');
  await page.keyboard.press('Escape');
  const withBuildings = await page.screenshot({ clip, path: info.outputPath('synthetic-buildings.png') });
  expect(await changedPixels(page, without, withBuildings), 'synthetic building geometry must actually draw').toBeGreaterThan(300);
  await openMapOptions(page);
  await page.locator('.camera-settings > summary').click();
  await page.locator('#camera-pitch').press('End');
  await page.locator('#camera-pitch').press('ArrowLeft');
  await expect(map).toHaveAttribute('data-camera-pitch', '64');
  await page.locator('#terrain-height').press('End');
  await expect(page.locator('#terrain-height-output')).toHaveText('2×');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(map).toHaveAttribute('data-camera-pitch', '64');
  await expect(map).toHaveAttribute('data-buildings-visible', 'true');
  await expect(page.locator('#map-notice')).toBeHidden();
  await page.setViewportSize({ width: 800, height: 1000 });
  await expect(map).toHaveAttribute('data-building-extrusions', 'false');
  await expect(map).toHaveAttribute('data-buildings-visible', 'true');
  await page.setViewportSize(size);
  await expect(map).toHaveAttribute('data-building-extrusions', 'true');
});

test('can disable lingering trails without disabling live packets', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'lifetime is checked once');
  await visualFixture(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
  await openMapOptions(page);
  await page.locator('.display-advanced > summary').click();
  await page.getByLabel('After-trails', { exact: true }).press('Home');
  await expect(page.getByLabel('After-trails', { exact: true })).toHaveValue('0');
  await page.keyboard.press('Escape');
  await visualPacket(page, 1);
  await expect.poll(() => packetInk(page, false)).toBeGreaterThan(2);
  // Includes the existing six-second node wake, independently of route residue.
  await page.waitForTimeout(9500);
  const painted = await page.locator('#packet-canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(painted).toBe(false);
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-enabled', 'true');
});

async function packetInk(page: Page, light: boolean): Promise<number> {
  return page.locator('#packet-canvas').evaluate((element, light) => {
    const canvas = element as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let found = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! < 180) continue;
      if (light ? pixels[i]! < 40 && pixels[i + 1]! > 45 && pixels[i + 1]! < 145 && pixels[i + 2]! < 140
        : pixels[i]! > 40 && pixels[i]! < 110 && pixels[i + 1]! > 180 && pixels[i + 2]! > 150) found++;
    }
    return found;
  }, light);
}

async function changedPixels(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(async (images) => {
    const decode = async (data: string): Promise<Uint8ClampedArray> => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [a, b] = await Promise.all(images.map(decode)); let changed = 0;
    for (let i = 0; i < a!.length; i += 4) if (Math.abs(a![i]! - b![i]!) + Math.abs(a![i + 1]! - b![i + 1]!) + Math.abs(a![i + 2]! - b![i + 2]!) > 35) changed++;
    return changed;
  }, [before.toString('base64'), after.toString('base64')]);
}
