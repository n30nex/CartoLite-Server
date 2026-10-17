import { expect, test } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import { graphFilters, graphFocus } from './dockControls';
import type { StateV2 } from '../src/types';

test.describe('UI audit', () => {
  for (const path of ['/', '/terminal/']) {
    test(`About closes with Escape without clearing the inspected node ${path}`, async ({ page }, info) => {
      await visualFixture(page); await page.goto(path);
      await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
      await page.locator('.node-search-result').first().click();
      await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a');
      await page.locator('#about-button').click();
      await page.screenshot({ path: info.outputPath('about-with-selection.png') });
      await page.keyboard.press('Escape');
      await expect(page.locator('#about-dialog')).not.toBeVisible();
      await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', 'visual-a');
      await expect(page.locator('#about-button')).toBeFocused();
    });

    test(`Back dismisses About without leaving the current view ${path}`, async ({ page }) => {
      await visualFixture(page); await page.goto(path);
      await page.locator('#about-button').click();
      await expect(page.locator('#about-dialog')).toBeVisible();
      await page.evaluate(() => history.back());
      await expect(page.locator('#about-dialog')).not.toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('#about-button')).toBeFocused();
    });
  }

  test('dismissed tile errors stay quiet while a different problem remains recoverable', async ({ page }, info) => {
    await visualFixture(page);
    await page.addInitScript(() => window.addEventListener('cartolite-map-ready', event => {
      Object.assign(window, { auditMap: (event as CustomEvent).detail.view.map });
    }, { once: true }));
    await page.goto('/'); await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
    const error = async (message: string) => page.evaluate(message => {
      (window as unknown as { auditMap: { fire: (name: string, event: { error: Error }) => void } }).auditMap.fire('error', { error: new Error(message) });
    }, message);
    await error('HTTP 503 tile https://fixture.invalid/?key=synthetic-browser-secret');
    const notice = page.locator('#map-notice'); await expect(notice).toBeVisible();
    await page.screenshot({ path: info.outputPath('recoverable-map-notice.png') });
    await page.getByRole('button', { name: 'Dismiss map notice' }).click();
    await error('HTTP 503 tile another fixture');
    await expect(notice).toBeHidden();
    await error('Terrain elevation could not load');
    await expect(notice).toBeVisible();
    await expect(notice).not.toContainText('synthetic-browser-secret');
    await expect(notice.getByRole('link', { name: 'Open Netgraph' })).toHaveAttribute('href', '/netgraph/');
  });

  test('empty Netgraph offers a direct region recovery without resetting the layout', async ({ page }, info) => {
    await visualFixture(page); await page.goto('/netgraph/');
    await expect(page.locator('#connected-count')).toHaveText('2');
    await graphFilters(page); await page.locator('#region-filter > summary').click();
    await page.locator('[data-none]').click(); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    const stage = page.locator('#netgraph-stage'), empty = page.locator('#empty-state');
    await expect(stage).toHaveAttribute('data-visible-routes', '0');
    await page.screenshot({ path: info.outputPath('empty-filter-recovery.png') });
    const spacing = await stage.getAttribute('data-region-spacing');
    await empty.getByRole('button', { name: 'Show all regions', exact: true }).click();
    await expect(stage).toHaveAttribute('data-visible-routes', '1');
    await expect(empty).toBeHidden();
    await expect(stage).toHaveAttribute('data-region-spacing', spacing!);
  });

  for (const older of [false, true]) test(`empty Netgraph recovers ${older ? 'older connections' : 'a focus with no internal links'}`, async ({ page }) => {
    await visualFixture(page);
    const now = Date.now();
    const state: StateV2 = {
      schemaVersion: 2, bootId: 'empty-fixture', seq: 0, serverTime: now,
      status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
      map: { center: [-79.4, 43.65], zoom: 8 },
      nodes: [
        { id: 'visual-a', label: 'Visual Alpha', lng: -79.4, lat: 43.65, role: 'repeater', observer: false, lastSeen: now },
        { id: 'visual-b', label: 'Visual Bravo', lng: -123.93, lat: 49.16, role: 'repeater', observer: false, lastSeen: now },
      ],
      routes: [{ id: 'visual-hop', fromId: 'visual-a', toId: 'visual-b', packetCount: 1, lastHeard: now - (older ? 7_200_000 : 0), intensity: 1, lastKind: 'Text', traffic: 1 }],
    };
    await page.route('**/api/state', route => route.fulfill({ json: state }));
    await page.goto('/netgraph/'); await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
    if (!older) {
      await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
      await page.locator('.node-search-result').first().click();
      await graphFocus(page, 'area');
    }
    const empty = page.locator('#empty-state'); await expect(empty).toBeVisible();
    await empty.getByRole('button', { name: older ? 'Use 24h window' : 'Clear focus', exact: true }).click();
    await expect(empty).toBeHidden();
    if (older) await expect(page.locator('#route-window')).toHaveValue('24h');
    else await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-focus-mode', 'all');
  });

  for (const path of ['/', '/netgraph/', '/terminal/']) test(`Follow actions stay completely visible in short landscape ${path}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await visualFixture(page); await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
    await page.locator('#follow-button').click(); await visualPacket(page, 1);
    const card = page.locator('#follow-card'); await expect(card).toContainText('Visual Alpha');
    await page.screenshot({ path: info.outputPath('follow-short-landscape.png') });
    const visible = await card.evaluate(card => {
      const box = card.getBoundingClientRect();
      return [...card.querySelectorAll<HTMLElement>('header button,.follow-actions button')].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= box.top && rect.bottom <= box.bottom && rect.left >= box.left && rect.right <= box.right
          && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
    });
    expect(visible).toBe(true);
  });
});
