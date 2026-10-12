import { expect, test, type Page } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import type { StateV2 } from '../src/types';

const key = 'cartolite:netgraph-layout:v1';
async function fixture(page: Page): Promise<void> {
  await visualFixture(page);
  const now = Date.now();
  const nodes = [
    { id: 'visual-a', label: 'Visual Alpha', lat: 43.65, lng: -79.4 },
    { id: 'visual-b', label: 'Visual Bravo', lat: 43.651, lng: -79.401 },
    { id: 'visual-c', label: 'Visual Charlie', lat: 49.16, lng: -123.93 },
  ].map(n => ({ ...n, role: 'repeater' as const, observer: false, lastSeen: now }));
  const state: StateV2 = { schemaVersion: 2, bootId: 'arrange-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: [-79.4, 43.65], zoom: 8 }, nodes,
    routes: [{ id: 'visual-hop', fromId: 'visual-a', toId: 'visual-b', packetCount: 4, lastHeard: now, intensity: 2, lastKind: 'Text', traffic: 4 },
      { id: 'cross-hop', fromId: 'visual-b', toId: 'visual-c', packetCount: 2, lastHeard: now, intensity: 1, lastKind: 'Advert', traffic: 2 }] };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.addInitScript(() => {
    const probe = window as unknown as { regionHandles: Record<string, { x: number; y: number }> };
    probe.regionHandles = {};
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args: Parameters<typeof fill>) {
      const match = /^([A-Z0-9.-]+) · /.exec(args[0]);
      if (this.canvas.id === 'graph-canvas' && match) probe.regionHandles[match[1]!] = { x: args[1], y: args[2] };
      return fill.apply(this, args);
    };
  });
}
async function saved(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}'), key); }
async function layoutPanel(page: Page) {
  await page.locator('#display-button').click();
  await page.locator('.graph-layout > summary').click();
}

test('spacing and dragging survive refresh while live packets keep their routes and clock', async ({ page, context }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await layoutPanel(page);
  await page.getByLabel('Region spacing', { exact: true }).focus(); await page.keyboard.press('Home');
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-region-spacing', '2');
  await expect(stage).toHaveAttribute('data-visible-routes', '2');
  await page.getByRole('button', { name: 'Move region right', exact: true }).click();
  const first = await saved(page); expect(Object.keys(first.centres)).toHaveLength(1);
  await page.getByLabel('Motion preference').selectOption('full');
  await page.keyboard.press('Escape');
  await page.locator('#reset-button').click();
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#graph-3d-button').click();
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await expect.poll(() => stage.getAttribute('data-view-tilt').then(Number)).toBeCloseTo(Math.PI / 4, 3);
  const code = Object.keys(first.centres)[0]!;
  const point = await page.evaluate(code => (window as unknown as { regionHandles: Record<string, { x: number; y: number }> }).regionHandles[code]!, code);
  const camera = await stage.getAttribute('data-view-center');
  const touch = info.project.name !== 'desktop' ? await context.newCDPSession(page) : null;
  if (touch) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x + 30, y: point.y + 24 }] });
  } else {
    await page.mouse.move(point.x, point.y); await page.mouse.down();
    await page.mouse.move(point.x + 30, point.y + 24, { steps: 4 });
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('visual-packet', { detail: { seq: 1, id: 'new-connection', at: Date.now(), payloadType: 'Text', mode: 'route', segments: [{ routeId: 'reverse-hop', fromId: 'visual-b', toId: 'visual-a' }] } })));
  await expect(stage).toHaveAttribute('data-visible-routes', '3');
  await expect(stage).toHaveAttribute('data-active-packets', '1');
  if (touch) { await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await touch.detach(); }
  else await page.mouse.up();
  await expect(stage).toHaveAttribute('data-view-center', camera!);
  await expect(stage).toHaveAttribute('data-visible-routes', '3');
  const moved = await saved(page); expect(moved.centres[code]).not.toEqual(first.centres[code]);
  await page.locator('#graph-routes-button').click();
  await expect(stage).toHaveAttribute('data-history-routes', 'false');
  await visualPacket(page, 2, 'Text');
  await expect(stage).toHaveAttribute('data-last-packet-hops', '1');
  await expect.poll(() => stage.getAttribute('data-active-packets').then(Number)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('netgraph-arranged-live-only.png') });
  await expect(stage).toHaveAttribute('data-active-packets', '0', { timeout: 12_000 });
  await expect(stage).toHaveAttribute('data-residue-count', '0', { timeout: 5_000 });
  await page.reload(); await expect(stage).toHaveAttribute('data-render-state', 'idle');
  expect(await saved(page)).toEqual({ ...moved, routes: false });
  await expect(stage).toHaveAttribute('data-region-spacing', '2');
  await expect(stage).toHaveAttribute('data-history-routes', 'false');
  await layoutPanel(page); await page.getByRole('button', { name: 'Reset region layout', exact: true }).click();
  expect((await saved(page)).centres).toEqual({}); expect((await saved(page)).spacing).toBe(1);
  expect((await saved(page)).routes).toBe(false);
  await page.keyboard.press('Escape');
  // The checkbox disclosure stays bounded and supports Back/Escape on touch screens.
  await page.locator('#region-filter > summary').click();
  const box = (await page.locator('.region-options').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThan((await page.locator('.controls').boundingBox())!.y);
  await page.keyboard.press('Escape'); await expect(page.locator('#region-filter')).not.toHaveAttribute('open', '');
  await expect(page.locator('#region-filter > summary')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => history.state?.cartolitePanel)).toBe('region-options');
  await page.goBack(); await expect(page.locator('#region-filter')).not.toHaveAttribute('open', '');
  expect(page.url()).toContain('/netgraph/');
});

test('checkbox regions filter topology, search and Follow and retain their device selection', async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage'); await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Charlie');
  await page.locator('.node-search-result').first().click();
  await page.getByLabel('Topology focus').selectOption('area');
  await page.getByRole('button', { name: 'Close node details' }).click();
  await page.locator('#region-filter > summary').click();
  const codes = await page.locator('.region-checks input').evaluateAll(inputs => inputs.map(i => (i as HTMLInputElement).dataset.region!));
  expect(codes).toHaveLength(2);
  await page.locator('[data-none]').click(); await expect(stage).toHaveAttribute('data-visible-routes', '0');
  await expect(stage).toHaveAttribute('data-components', '0');
  await expect(stage).toHaveAttribute('data-focus-mode', 'all');
  await expect(page.locator('#empty-state')).toContainText('No regions selected');
  // Find the two-node Toronto region without coupling either edition to a particular code system.
  const labels = await page.locator('.region-checks label').allTextContents();
  const index = labels.findIndex(text => text.includes('Toronto') || text.includes('43.5'));
  expect(index).toBeGreaterThanOrEqual(0);
  const region = codes[index]!;
  await page.getByLabel('Search regions', { exact: true }).fill(region);
  await page.locator('.region-checks input').nth(index).check();
  await expect(stage).toHaveAttribute('data-visible-routes', '1');
  await expect(stage).toHaveAttribute('data-connected-nodes', '2');
  await expect(stage).toHaveAttribute('data-areas', '1');
  await page.getByLabel('Search regions', { exact: true }).fill('');
  await page.locator('.region-checks input').nth(1 - index).check();
  await expect(stage).toHaveAttribute('data-areas', '2');
  await expect(stage).toHaveAttribute('data-visible-routes', '2');
  await page.locator('.region-checks input').nth(1 - index).uncheck();
  await expect(stage).toHaveAttribute('data-areas', '1');
  await page.keyboard.press('Escape');
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Charlie');
  await expect(page.locator('.node-search-result')).toHaveCount(0); await page.keyboard.press('Escape');
  await page.reload(); await expect(stage).toHaveAttribute('data-region-filter', region);
  await expect(stage).toHaveAttribute('data-visible-routes', '1');
  await page.getByRole('button', { name: 'Follow', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('visual-packet', { detail: { seq: 1, id: 'outside', at: Date.now(), payloadType: 'Text', mode: 'route', segments: [{ routeId: 'cross-hop', fromId: 'visual-b', toId: 'visual-c' }] } })));
  await expect(page.locator('#follow-card')).toContainText('Waiting for activity');
  await visualPacket(page, 2, 'Text'); await expect(page.locator('#follow-card [data-title]')).toContainText('Visual');
  await page.screenshot({ path: info.outputPath('netgraph-region-filter.png') });
  await page.locator('#region-filter > summary').click(); await page.locator('[data-all]').click();
  await expect(stage).toHaveAttribute('data-visible-routes', '2'); await expect(stage).toHaveAttribute('data-areas', '2');
});
