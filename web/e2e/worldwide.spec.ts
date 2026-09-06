import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';

test.use({ trace: 'off' });

test('worldwide map preferences and Netgraph include multiple continents', { tag: '@world' }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'global geography is shared across viewports');
  const now = Date.now();
  const places = [
    ['London', 51.5, -0.12], ['Tokyo', 35.68, 139.65], ['Sydney', -33.86, 151.2],
    ['Cape Town', -33.92, 18.42], ['Buenos Aires', -34.6, -58.4], ['Seattle', 47.61, -122.33],
  ] as const;
  const nodes = places.flatMap(([label, lat, lng], area) => [0, 1].map((offset) => ({
    id: `world-${area}-${offset}`, label: `${label} Fixture ${offset}`, lat: lat + offset * 0.01, lng: lng + offset * 0.01,
    role: 'repeater' as const, observer: false, lastSeen: now,
  })));
  const state: StateV2 = {
    schemaVersion: 2, bootId: 'world-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'world' },
    map: { center: [0, 20], zoom: 1.4 }, nodes,
    routes: places.map((_, area) => ({ id: `world-${area}`, fromId: `world-${area}-0`, toId: `world-${area}-1`, packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 })),
  };
  const countryAssets: string[] = [];
  page.on('request', (request) => { if (/meshcore-canada|meshmapper|canadaverse/.test(request.url())) countryAssets.push(request.url()); });
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({ contentType: 'text/event-stream', body: ': idle\n\n' }));
  await page.addInitScript(() => localStorage.setItem('cartolite-server:view:v1:desktop', JSON.stringify({ center: [151.2, -33.86], zoom: 8 })));
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-view-source', 'saved');
  await expect(page.locator('#map')).toHaveAttribute('data-rendered-route-segments', '6');
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Sydney Fixture 0');
  await page.locator('.node-search-result').first().click();
  await expect(page.locator('.node-inspector[data-node-id="world-2-0"]')).toBeVisible();
  await page.goto('/netgraph');
  await expect(page).toHaveURL(/\/netgraph\/$/);
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-areas', '6');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-connected-nodes', '12');
  await page.screenshot({ path: testInfo.outputPath('worldwide-netgraph.png') });
  expect(countryAssets).toEqual([]);
});

test('date-line packets paint the map edges without a false route across the world', { tag: '@world' }, async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the canonical world seam is viewport independent');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = Date.now();
  const state: StateV2 = {
    schemaVersion: 2, bootId: 'seam-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'seam' },
    map: { center: [0, 0], zoom: 1.4 },
    nodes: [179, -179].map((lng, index) => ({ id: `seam-${index}`, label: `Seam Fixture ${index}`, lat: 0, lng, role: 'repeater', observer: false, lastSeen: now })),
    routes: [{ id: 'seam', fromId: 'seam-0', toId: 'seam-1', packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 }],
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/events**', async (route) => {
    await ready;
    const packet = { seq: 1, id: 'seam', at: now, mode: 'route', payloadType: 'Text', segments: [{ routeId: 'seam', fromId: 'seam-0', toId: 'seam-1' }] };
    await route.fulfill({ contentType: 'text/event-stream', body: `retry: 60000\n\nevent: packet\ndata: ${JSON.stringify(packet)}\n\n` });
  });
  await page.addInitScript(() => {
    localStorage.setItem('cartolite-server:ui:v1', JSON.stringify({ routes: true, clusters: false, heatmap: false }));
  });
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  release();
  const canvas = page.locator('#packet-canvas');
  await expect(canvas).toHaveAttribute('data-motion-mode', 'static');
  await expect.poll(() => canvas.getAttribute('data-wakes-scheduled').then(Number)).toBeGreaterThan(0);
  const pixels = await canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let edge = 0;
    let middle = 0;
    for (let index = 3; index < data.length; index += 4) {
      if (!data[index]) continue;
      const x = ((index - 3) / 4) % canvas.width;
      if (x > canvas.width * 0.25 && x < canvas.width * 0.75) middle += 1;
      else edge += 1;
    }
    return { edge, middle };
  });
  expect(pixels.edge).toBeGreaterThan(0);
  expect(pixels.middle).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('date-line-packet.png') });
});
