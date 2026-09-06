import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';

function stateFixture(): StateV2 {
  const now = Date.now();
  return {
    schemaVersion: 2, bootId: 'audit-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [-80.3, 43.5], zoom: 8 },
    nodes: ['Alpha', 'Bravo', 'Charlie'].map((label, index) => ({
      id: `audit-${index}`, label: `Audit ${label}`, lat: 43.5 + index * 0.01, lng: -80.3,
      role: 'repeater', observer: false, lastSeen: now,
    })),
    routes: [1, 2].map((index) => ({
      id: `audit-route-${index}`, fromId: 'audit-0', toId: `audit-${index}`,
      lastHeard: now, packetCount: 1, intensity: 0, lastKind: 'Advert', traffic: 1,
    })),
  };
}

for (const path of ['/', '/netgraph/']) {
  test(`${path} Finder keeps typing focus while selecting results with the keyboard`, async ({ page }) => {
    await page.route('**/api/state', (route) => route.fulfill({ json: stateFixture() }));
    await page.route('**/api/events**', (route) => route.fulfill({
      contentType: 'text/event-stream', body: 'retry: 60000\n\n: waiting\n\n',
    }));
    await page.goto(path);
    if (path === '/') await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
    else await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
    const layers = page.locator('#layers-summary');
    if (await layers.isVisible()) await layers.click();
    await page.locator('#find-button').click();
    const input = page.locator('#node-search');
    await input.fill('Audit');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Audit');
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    await expect(page.locator('[role="option"][aria-selected="true"]')).toContainText('Audit Bravo');
    await input.press('Enter');
    await expect(page.locator('.node-inspector[data-node-id="audit-1"]')).toBeVisible();
    await expect(page.locator('#find-panel')).toBeHidden();
    if (path === '/netgraph/' && page.viewportSize()!.height <= 520) {
      const inspector = await page.locator('#node-inspector-sheet').boundingBox();
      const controls = await page.locator('.controls').boundingBox();
      expect(inspector!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
    }

    if (await layers.isVisible()) await layers.click();
    await page.locator('#find-button').click();
    await input.fill('Audit ');
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.+/);
    await input.press('ArrowUp');
    await expect(page.locator('[role="option"][aria-selected="true"]')).toContainText('Audit Charlie');
    // Pointer selection must also work when the details panel is still open.
    await page.locator('[role="option"][aria-selected="true"]').click();
    await expect(page.locator('.node-inspector[data-node-id="audit-2"]')).toBeVisible();
    if (await layers.isVisible()) await layers.click();
    await page.locator('#find-button').click();
    await input.press('Escape');
    await expect(page.locator('#find-panel')).toBeHidden();
    await expect(page.locator('#find-button')).toBeFocused();
  });
}

for (const path of ['/', '/netgraph/']) {
  test(`${path} offers a working retry after its initial state request fails`, async ({ page }) => {
    let requests = 0;
    await page.route('**/api/state', (route) => {
      requests += 1;
      return requests === 1
        ? route.fulfill({ status: 503, body: 'unavailable' })
        : route.fulfill({ json: stateFixture() });
    });
    await page.route('**/api/events**', (route) => route.fulfill({
      contentType: 'text/event-stream', body: 'retry: 60000\n\n: waiting\n\n',
    }));
    await page.goto(path);
    const retry = page.getByRole('link', { name: 'Try again', exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Check your connection');
    await retry.click();
    if (path === '/') await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
    else await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
    await expect(retry).toBeHidden();
    expect(requests).toBe(2);
  });
}

test('map navigation and controls remain separate across laptop and narrow phone widths', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This test explicitly traverses the responsive breakpoints.');
  await page.route('**/api/state', (route) => route.fulfill({ json: stateFixture() }));
  await page.route('**/api/events**', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'retry: 60000\n\n' }));
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  for (const width of [1440, 1280, 1180, 1000, 900, 800, 620, 520, 393, 360, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator('html')).toHaveAttribute('data-view-class', width <= 900 ? 'mobile' : 'desktop');
    await expect.poll(() => page.locator('#topbar, .controls').evaluateAll((elements) => {
      const [navigation, controls] = elements.map((element) => element.getBoundingClientRect());
      return [navigation, controls].every((rect) => rect.left >= 0 && rect.right <= innerWidth)
        && (navigation.right <= controls.left || navigation.bottom <= controls.top);
    }), { message: `Toolbar should not overlap at ${width}px` }).toBe(true);
    await expect(page.locator('#status-text')).toBeVisible();
  }
  await page.locator('#layers-summary').click();
  for (const id of ['routes', 'heatmap', 'clusters', 'hillshade', 'terrain']) {
    await expect(page.locator(`#${id}-button > span`).last()).toBeVisible();
  }
});
