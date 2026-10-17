import { expect, test } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { openMapOptions } from './mapControls';
import { openViewMenu } from './dockControls';

test('Terminal keeps geographic controls, live packets and device display choices', async ({ page }, info) => {
  test.slow();
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await visualFixture(page); await page.goto('/terminal/');
  const map = page.locator('#map'), grid = page.locator('#terminal-map');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10000 });
  await expect.poll(async () => Number(await grid.getAttribute('data-cells'))).toBeGreaterThan(100);
  await expect.poll(async () => Number(await grid.getAttribute('data-labels'))).toBeGreaterThan(0);
  await expect(page.locator('.dock-views [aria-current="page"]')).toHaveText('Terminal');
  await expect(page.locator('#fatal')).toBeHidden();
  await page.screenshot({ path: info.outputPath('terminal-ansi.png') });
  if (info.project.name === 'desktop') {
    await page.locator('#terrain-shortcut').click();
    await expect(map).toHaveAttribute('data-terrain3d','true');
    await expect(map).toHaveAttribute('data-camera-moving','false');
    await page.screenshot({path:info.outputPath('terminal-terrain.png')});
    await page.locator('#terrain-shortcut').click();
    await expect(map).toHaveAttribute('data-terrain3d','false');
  }
  const saved = await page.evaluate(() => [localStorage.getItem('cartolite:ui:v1'), localStorage.getItem('cartolite-server:ui:v1')]);
  await openMapOptions(page);
  await page.getByLabel('Terminal palette').selectOption('amber');
  await page.getByLabel('Terminal characters').selectOption('ascii');
  await page.getByLabel('Terminal cell size').selectOption('16');
  expect(await page.evaluate(() => [localStorage.getItem('cartolite:ui:v1'), localStorage.getItem('cartolite-server:ui:v1')])).toEqual(saved);
  await page.keyboard.press('Escape');
  await expect(grid).toHaveAttribute('data-glyphs', 'ascii');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-terminal-palette', 'amber');
  await expect(grid).toHaveAttribute('data-glyphs', 'ascii');
  await openMapOptions(page); await page.locator('#routes-button').click(); await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-routes-visible', 'false');
  await page.locator('#follow-button').click();
  await visualPacket(page, 1, 'Text');
  await expect(page.locator('#follow-card')).toBeVisible();
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-active-count', '1');
  await expect.poll(async () => Number(await page.locator('#terminal-packets').getAttribute('data-cells'))).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('terminal-amber-packet.png') });
  await page.locator('#follow-close').click();
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
  await page.getByRole('option', { name: /Visual Alpha/ }).click();
  await expect(map).toHaveAttribute('data-selected-node-id', 'visual-a');
  await expect(page.locator('#node-inspector-sheet')).toContainText('Visual Alpha');
  await page.keyboard.press('Escape');
  await openMapOptions(page); await page.getByLabel('Terminal palette').selectOption('green'); await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('terminal-green.png') });
  expect(errors).toEqual([]);
});

test('Terminal stays compact and keeps selection when switching views', async ({ page }, info) => {
  if (info.project.name !== 'desktop') await page.setViewportSize(info.project.name.includes('landscape') ? { width:568,height:320 } : { width:320,height:640 });
  await visualFixture(page); await page.goto('/terminal/?node=visual-a');
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a', {timeout:10000});
  await page.keyboard.press('Escape');
  await openViewMenu(page);
  const links = page.locator('.dock-views a');
  expect((await links.allTextContents()).slice(0,3)).toEqual(['Map','Netgraph','Terminal']);
  const controls = (await page.locator('.controls').boundingBox())!;
  expect(controls.x).toBeGreaterThanOrEqual(0); expect(controls.x+controls.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({path:info.outputPath('terminal-navigation.png')});
  await page.getByRole('link', {name:'Open CartoLite Netgraph',exact:true}).click();
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  await expect(page.locator('#terminal-map')).toHaveCount(0);
});

test('unavailable character readback falls back without stopping the feed', async ({page}) => {
  await visualFixture(page);
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.clientWaitSync;
    WebGL2RenderingContext.prototype.clientWaitSync = function (...args: Parameters<typeof original>) {
      if (document.documentElement.dataset.terminal && !document.documentElement.dataset.readbackFailedOnce) {
        document.documentElement.dataset.readbackFailedOnce = 'true'; return this.WAIT_FAILED;
      }
      return original.apply(this,args);
    };
  });
  await page.goto('/terminal/');
  await expect(page.locator('.terminal-notice')).toBeVisible();
  await expect(page.locator('#fatal')).toBeHidden();
  expect(await page.locator('.maplibregl-canvas').evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.getByRole('button',{name:'Retry Terminal',exact:true}).click();
  await expect(page.locator('.terminal-notice')).toBeHidden();
  await expect.poll(async () => Number(await page.locator('#terminal-map').getAttribute('data-cells'))).toBeGreaterThan(100);
});

test('Map and Netgraph never download the optional Terminal renderer', async ({page}) => {
  const terminalAssets: string[] = [];
  page.on('request', request => { if (/\/terminal-[^/]+\.(?:js|css)(?:\?|$)/.test(request.url())) terminalAssets.push(request.url()); });
  await visualFixture(page);
  for (const path of ['/', '/netgraph/']) {
    await page.goto(path);
    await expect(page.locator(path === '/' ? '#map' : '#netgraph-stage')).toHaveAttribute('data-render-state','idle',{timeout:10000});
  }
  expect(terminalAssets).toEqual([]);
});
