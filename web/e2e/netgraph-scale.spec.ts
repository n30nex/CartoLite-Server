import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';

// Synthetic grid centres across the world, safely inside 24 distinct squares.
const SCALE_AREAS = Array.from({ length: 24 }, (_, index) => ({
  lat: -59.5 + Math.floor(index / 8) * 55,
  lng: -169 + (index % 8) * 44,
}));

function scaleState(): StateV2 {
  const now = Date.now();
  const nodes = Array.from({ length: 4_000 }, (_, index) => {
    const area = SCALE_AREAS[index % SCALE_AREAS.length]!;
    const ring = Math.floor(index / SCALE_AREAS.length);
    return {
      id: `node-${index}`,
      label: `Scale Node ${index.toString().padStart(4, '0')}`,
      lat: area.lat + (ring % 9 - 4) * 0.0001,
      lng: area.lng + (ring % 7 - 3) * 0.0001,
      role: index % 5 === 0 ? 'companion' as const : 'repeater' as const,
      observer: false,
      lastSeen: now - index,
    };
  });
  const routes = Array.from({ length: 7_000 }, (_, index) => ({
    id: `route-${index}`,
    fromId: `node-${index % nodes.length}`,
    toId: `node-${index < nodes.length ? (index + 1) % nodes.length : (index * 17 + 31) % nodes.length}`,
    packetCount: 1 + index % 32,
    lastHeard: now - index,
    intensity: Math.min(4, index % 5) as 0 | 1 | 2 | 3 | 4,
    lastKind: (['Advert', 'Trace', 'Text', 'ACK', 'Control'] as const)[index % 5]!,
    traffic: 1 + index % 32,
  }));
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'netgraph-scale',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'quiet', dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [0, 20], zoom: 1.4 },
    nodes,
    routes,
  };
  return state;
}

test('Netgraph keeps all 4,000 nodes and 7,000 links responsive', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the scale timing gate runs once on desktop');
  const state = scaleState();
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\n`,
  }));

  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-connected-nodes', '4000', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-connected-nodes', '4000');
  await expect(stage).toHaveAttribute('data-visible-routes', '7000');
  const areaCount = Number(await stage.getAttribute('data-areas'));
  expect(areaCount).toBe(SCALE_AREAS.length);
  expect(Number(await stage.getAttribute('data-region-assignments'))).toBeGreaterThan(1_000);
  expect(Number(await stage.getAttribute('data-render-apply-ms')), 'topology indexing and layout should stay bounded').toBeLessThan(250);
  expect(Number(await stage.getAttribute('data-static-draw-ms')), 'drawing every link should not block interaction').toBeLessThan(100);

  await page.locator('#route-window').selectOption('15m');
  await expect(stage).toHaveAttribute('data-visible-routes', '7000');
  expect(Number(await stage.getAttribute('data-route-window-apply-ms')), 'age-window filtering should finish within one task').toBeLessThan(100);

  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Scale Node 3999');
  await page.locator('.node-search-result').first().click();
  await expect(stage).toHaveAttribute('data-selected-node-id', 'node-3999');
  await expect(page.locator('#node-inspector-sheet')).toBeVisible();
  expect(Number(await stage.getAttribute('data-node-search-apply-ms'))).toBeLessThan(100);
  expect(Number(await stage.getAttribute('data-node-selection-apply-ms'))).toBeLessThan(100);
});

test('Netgraph does not repaint 4,000 nodes for last-heard updates', async ({ page }) => {
  const state = scaleState();
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.addInitScript(() => {
    const probe = window as unknown as { feed: EventTarget; graphPaints: number; inkPaints: number };
    probe.graphPaints = 0;
    probe.inkPaints = 0;
    window.EventSource = class extends EventTarget {
      onopen?: () => void;
      constructor() {
        super();
        probe.feed = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      close(): void { /* Controlled synthetic stream. */ }
    } as unknown as typeof EventSource;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'graph-canvas') probe.graphPaints += 1;
      if (this.canvas.id === 'packet-canvas') probe.inkPaints += 1;
      return clear.apply(this, args);
    };
  });
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-connected-nodes', '4000', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const paints = await page.evaluate(() => (window as unknown as { graphPaints: number }).graphPaints);
  await page.evaluate((nodes) => {
    const probe = window as unknown as { feed: EventTarget };
    nodes.slice(0, 100).forEach((node, index) => probe.feed.dispatchEvent(new MessageEvent('node', {
      data: JSON.stringify({ seq: index + 1, node: { ...node, lastSeen: Date.now() } }),
    })));
  }, state.nodes);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as unknown as { graphPaints: number }).graphPaints)).toBe(paints);
  await expect(stage).toHaveAttribute('data-visible-routes', '7000');
  await expect(stage).toHaveAttribute('data-connected-nodes', '4000');

  // Changed labels still invalidate the cached node ink and reach inspection.
  await page.evaluate((node) => (window as unknown as { feed: EventTarget }).feed.dispatchEvent(new MessageEvent('node', {
    data: JSON.stringify({ seq: 101, node: { ...node, label: 'Updated scale repeater' } }),
  })), state.nodes[0]!);
  await expect.poll(() => page.evaluate(() => (window as unknown as { graphPaints: number }).graphPaints)).toBeGreaterThan(paints);
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Updated scale repeater');
  await page.locator('.node-search-result').first().click();
  await expect(page.locator('#node-inspector-sheet')).toContainText('Updated scale repeater');

  // Mobile backing stores have a bounded pixel budget, including landscape.
  const raster = await page.locator('#packet-canvas').evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width, cssWidth: canvas.clientWidth,
    coarse: matchMedia('(max-width: 700px), (pointer: coarse)').matches,
  }));
  expect(raster.width).toBeLessThanOrEqual(Math.ceil(raster.cssWidth * (raster.coarse ? 1.25 : 1.5)));
  expect(await page.evaluate(() => (window as unknown as { inkPaints: number }).inkPaints)).toBe(0);
});
