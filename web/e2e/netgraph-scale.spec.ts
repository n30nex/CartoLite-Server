import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';

const CANADIAN_TEST_AREAS = [
  { code: 'MVRD', name: 'Metro Vancouver', lat: 49.28173, lng: -123.11928 },
  { code: 'CRD', name: 'Capital', lat: 48.43719, lng: -123.361624 },
  { code: 'FVRD', name: 'Fraser Valley', lat: 49.023309, lng: -122.368297 },
  { code: 'CVRD', name: 'Cowichan Valley', lat: 48.8359655, lng: -124.1502799 },
  { code: 'CXRD', name: 'Comox Valley', lat: 49.671948, lng: -125.016697 },
  { code: 'RDN', name: 'Nanaimo', lat: 49.164167, lng: -123.936389 },
  { code: 'ACRD', name: 'Alberni-Clayoquot', lat: 49.1977734, lng: -125.4363938 },
  { code: 'SRD', name: 'Strathcona', lat: 49.99008, lng: -125.26207 },
  { code: 'RDMW', name: 'Mount Waddington', lat: 50.5901579, lng: -127.0872202 },
  { code: 'SCRD', name: 'Sunshine Coast', lat: 49.7650789, lng: -123.7644501 },
  { code: 'QRD', name: 'qathet', lat: 50.1526491, lng: -124.3939674 },
  { code: 'SLRD', name: 'Squamish-Lillooet', lat: 49.694255, lng: -123.161963 },
] as const;

const CROSS_BORDER_TEST_AREAS = [
  { lat: 46.1879, lng: -123.8313 },
  { lat: 48.7519, lng: -122.4787 },
  { lat: 42.8864, lng: -78.8784 },
  { lat: 47.4235, lng: -120.3103 },
  { lat: 44.0521, lng: -123.0868 },
  { lat: 47.6588, lng: -117.426 },
  { lat: 42.3265, lng: -122.8756 },
  { lat: 47.0379, lng: -122.9007 },
  { lat: 45.5152, lng: -122.6784 },
  { lat: 46.2396, lng: -119.1006 },
  { lat: 43.1566, lng: -77.6088 },
  { lat: 47.6062, lng: -122.3321 },
  { lat: 44.9429, lng: -123.0351 },
  { lat: 43.0481, lng: -76.1474 },
] as const;

const SCALE_AREAS = [...CANADIAN_TEST_AREAS, ...CROSS_BORDER_TEST_AREAS];

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
    map: { center: [-96, 56], zoom: 3 },
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
  expect(areaCount).toBeGreaterThan(20);
  expect(areaCount).toBeLessThanOrEqual(193 + CROSS_BORDER_TEST_AREAS.length);
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
