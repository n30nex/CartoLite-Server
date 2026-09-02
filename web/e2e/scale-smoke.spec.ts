import { expect, test } from '@playwright/test';
import type { NodeV2, RouteV2, StateV2 } from '../src/types';

// Playwright trace screencasts read back the WebGL canvas and create synthetic
// GPU stalls. Keep this timing gate capture-free; it writes evidence explicitly
// after every timing assertion has completed.
test.use({ screenshot: 'off', trace: 'off' });

test('keeps a 4k-node / 7k-route first view responsive', async ({ page }, testInfo) => {
  const state = scaleState();
  const firstRoute = state.routes[0];
  if (!firstRoute) throw new Error('scale fixture has no routes');
  const packet = {
    seq: 1,
    id: 'scale-packet',
    at: Date.now(),
    payloadType: 'Text',
    mode: 'route',
    segments: [{ routeId: firstRoute.id, fromId: firstRoute.fromId, toId: firstRoute.toId }]
  };

  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\nid: 1\nevent: packet\ndata: ${JSON.stringify(packet)}\n\n`
  }));

  const started = Date.now();
  await page.goto('/');
  await expect(page.locator('#status')).toHaveAttribute('title', '4000 nodes · 7000 routes', { timeout: 10_000 });
  await expect(page.locator('#map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-power-mode', testInfo.project.name.startsWith('mobile') ? 'low' : 'full');
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-quality-mode', testInfo.project.name.startsWith('mobile') ? 'low' : 'full');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
  expect(Date.now() - started, 'large topology should hydrate inside the first-view budget').toBeLessThan(10_000);
  const map = page.locator('#map');
  await expect(page.locator('#route-canvas')).toHaveCount(0);
  await expect(map).toHaveAttribute('data-route-renderer', 'maplibre-webgl');
  await expect(map).toHaveAttribute('data-exact-routes-ready', 'true', { timeout: 15_000 });
  await expect(map).toHaveAttribute('data-rendered-route-segments', '7000');
  await installLongTaskObserver(page);

  const heatmapButton = page.locator('#heatmap-button');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.locator('#layers-summary').click();
    await expect(page.locator('#layers-disclosure')).toHaveAttribute('open', '');
  }
  const routeSourceRevision = await map.getAttribute('data-route-source-revision');
  await resetLongTasks(page);
  await page.locator('#route-window').selectOption('24h');
  await expect.poll(() => map.getAttribute('data-eligible-routes').then(Number), {
    message: 'the 24-hour source must keep every route, with no visual cap'
  }).toBe(7_000);
  await expect(map).toHaveAttribute('data-trunk-representations-loaded', '');
  await expect(map).toHaveAttribute('data-national-route-trunks', '0');
  await expect(map).toHaveAttribute('data-regional-route-trunks', '0');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
  await expect(map).toHaveAttribute('data-exact-routes-loaded', 'true');
  await expect(map).toHaveAttribute('data-route-source-revision', routeSourceRevision ?? '');
  const routeTimings = await map.evaluate((element) => ({
    buildMaxSliceMS: element.dataset.routeBuildMaxSliceMs,
    sourceDispatchMS: element.dataset.routeSourceDispatchMs,
    windowApplyMS: element.dataset.routeWindowApplyMs,
    nationalTrunks: element.dataset.nationalRouteTrunks,
    regionalTrunks: element.dataset.regionalRouteTrunks
  }));
  expect(
    await maximumLongTask(page),
    `selecting the complete 24-hour window must not block the main thread for 100 ms; ${JSON.stringify(routeTimings)}`
  ).toBeLessThan(100);
  await expect(heatmapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'true');
  const routesButton = page.locator('#routes-button');
  await resetLongTasks(page);
  await routesButton.click();
  await expect(routesButton).toHaveAttribute('aria-pressed', 'true');
  await expect(map).toHaveAttribute('data-routes-visible', 'true');
  await expect(map).toHaveAttribute('data-route-representation', 'individual-routes');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
  expect(Number(await map.getAttribute('data-route-toggle-apply-ms')), 'the Routes interaction itself must finish within 100 ms').toBeLessThan(100);
  expect(
    await maximumLongTask(page),
    'a complete software-rendered map frame after enabling Routes must remain below 750 ms'
  ).toBeLessThan(750);

  const clustersButton = page.locator('#clusters-button');
  await resetLongTasks(page);
  await clustersButton.click();
  await expect(map).toHaveAttribute('data-clusters-visible', 'false');
  expect(await maximumLongTask(page), 'showing all individual nodes must keep the software-rendered frame below 750 ms').toBeLessThan(750);
  await clustersButton.click();
  await expect(map).toHaveAttribute('data-clusters-visible', 'true');

  await resetLongTasks(page);
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('MC 0');
  await expect(page.locator('.node-search-result').first()).toContainText('MC 0');
  expect(Number(await map.getAttribute('data-node-search-apply-ms')), 'searching 4,000 public labels must finish within 100 ms').toBeLessThan(100);
  expect(await maximumLongTask(page), 'the concurrent software-rendered frame must remain below 750 ms while searching').toBeLessThan(750);
  await resetLongTasks(page);
  await page.locator('.node-search-result').first().click();
  await expect(map).toHaveAttribute('data-selected-node-id', 'node-0');
  const inspector = testInfo.project.name.startsWith('mobile')
    ? page.locator('#node-inspector-sheet')
    : page.locator('.node-inspector-popup');
  await expect(inspector).toBeVisible();
  await expect(inspector.locator('.neighbor-row').first()).toBeVisible();
  expect(Number(await map.getAttribute('data-node-selection-apply-ms')), 'opening an indexed node inspector must finish within 100 ms').toBeLessThan(100);
  expect(await maximumLongTask(page), 'opening an indexed node inspector must keep the software-rendered frame below 750 ms').toBeLessThan(750);
  const firstNeighborID = await inspector.locator('.neighbor-row').first().getAttribute('data-node-id');
  await resetLongTasks(page);
  await inspector.locator('.neighbor-row').first().click();
  if (firstNeighborID) await expect(map).toHaveAttribute('data-selected-node-id', firstNeighborID);
  expect(Number(await map.getAttribute('data-node-selection-apply-ms')), 'selecting an indexed neighbour must finish within 100 ms').toBeLessThan(100);
  expect(await maximumLongTask(page), 'selecting an indexed neighbour must keep the software-rendered frame below 750 ms').toBeLessThan(750);
  await page.keyboard.press('Escape');

  const mapBox = await page.locator('#map .maplibregl-canvas').boundingBox();
  expect(mapBox).not.toBeNull();
  if (mapBox) {
    const cameraRouteSourceRevision = await map.getAttribute('data-route-source-revision');
    await resetLongTasks(page);
    await page.mouse.move(mapBox.x + mapBox.width * 0.58, mapBox.y + mapBox.height * 0.52);
    await page.mouse.down();
    await page.mouse.move(mapBox.x + mapBox.width * 0.42, mapBox.y + mapBox.height * 0.45, { steps: 8 });
    await page.mouse.up();
    await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
    await expect(map).toHaveAttribute('data-eligible-routes', '7000');
    await expect(map).toHaveAttribute('data-route-source-revision', cameraRouteSourceRevision ?? '');
    expect(await maximumLongTask(page), 'camera movement with all routes visible must keep each software-rendered frame below 750 ms').toBeLessThan(750);
  }

  const eventLoopWindow = await page.evaluate(() => new Promise<number>((resolve) => {
    const start = performance.now();
    let turns = 0;
    const tick = (): void => {
      turns += 1;
      if (turns >= 50) resolve(performance.now() - start);
      else window.setTimeout(tick, 0);
    };
    window.setTimeout(tick, 0);
  }));
  expect(eventLoopWindow, 'main thread should remain interactive with the complete topology visible').toBeLessThan(2_000);
  await page.screenshot({ path: testInfo.outputPath('cartolite-scale.png') });
});

test('coalesces a busy live burst into one historical-route refresh', async ({ page }) => {
  const now = Date.now();
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'cadence-smoke',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'cadence' },
    map: { center: [-80.35, 43.48], zoom: 8 },
    nodes: [
      { id: 'a', label: 'Alpha', role: 'repeater', observer: false, lat: 43.45, lng: -80.42, lastSeen: now },
      { id: 'b', label: 'Bravo', role: 'companion', observer: false, lat: 43.5, lng: -80.28, lastSeen: now }
    ],
    routes: [{ id: 'a-b', fromId: 'a', toId: 'b', packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 }]
  };
  const events = Array.from({ length: 80 }, (_, index) => {
    const packet = {
      seq: index + 1,
      id: `cadence-${index}`,
      at: now + index,
      payloadType: 'Text',
      mode: 'route',
      segments: [{ routeId: 'a-b', fromId: 'a', toId: 'b' }]
    };
    return `id: ${packet.seq}\nevent: packet\ndata: ${JSON.stringify(packet)}\n\n`;
  }).join('');

  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\n${events}`
  }));
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
  await page.waitForTimeout(8_800);
  await expect(map).toHaveAttribute('data-render-state', 'idle', { timeout: 5_000 });
  expect(Number(await map.getAttribute('data-route-source-revision'))).toBeLessThanOrEqual(3);
});

function scaleState(): StateV2 {
  const now = Date.now();
  const kinds: readonly RouteV2['lastKind'][] = ['Advert', 'Trace', 'Text', 'ACK', 'Control', 'Other'];
  const trafficLevels = [0.25, 1, 4, 12, 32, 64] as const;
  const routeAges = [0, 5 * 60_000, 20 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000, 23 * 60 * 60_000] as const;
  const nodes: NodeV2[] = Array.from({ length: 4_000 }, (_, index): NodeV2 => ({
    id: `node-${index}`,
    label: `MC ${index}`,
    role: index % 11 === 0 ? 'room_server' : index % 3 === 0 ? 'repeater' : 'companion',
    observer: index % 17 === 0,
    lat: 42.1 + (index % 40) * 0.075,
    lng: -83.5 + (Math.floor(index / 40) % 50) * 0.09,
    lastSeen: now - (index % 120) * 60_000
  }));
  const routes: RouteV2[] = Array.from({ length: 7_000 }, (_, index) => {
    const from = nodes[index % nodes.length]!;
    const to = nodes[(index * 37 + 113) % nodes.length]!;
    return {
      id: `route-${index}`,
      fromId: from.id,
      toId: to.id,
      packetCount: 1 + index % 31,
      lastHeard: now - routeAges[index % routeAges.length]!,
      intensity: (index % 5) as RouteV2['intensity'],
      lastKind: kinds[index % kinds.length]!,
      traffic: trafficLevels[index % trafficLevels.length]!
    };
  });
  return {
    schemaVersion: 2,
    bootId: 'scale-smoke',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'scale' },
    map: { center: [0, 20], zoom: 1.4 },
    nodes,
    routes
  };
}

async function installLongTaskObserver(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = { durations: [] as number[], since: performance.now() };
    Object.defineProperty(window, '__cartoliteLongTasks', { configurable: true, value: state });
    if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime >= state.since) state.durations.push(entry.duration);
      }
    }).observe({ type: 'longtask', buffered: false });
  });
}

async function resetLongTasks(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as {
      __cartoliteLongTasks: { durations: number[]; since: number };
    }).__cartoliteLongTasks;
    state.durations = [];
    state.since = performance.now();
  });
}

async function maximumLongTask(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => Math.max(0, ...(window as unknown as {
    __cartoliteLongTasks: { durations: number[] };
  }).__cartoliteLongTasks.durations));
}

async function canvasHasPixels(canvas: import('@playwright/test').Locator): Promise<boolean> {
  return canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0 || element.height === 0) return false;
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return true;
    }
    return false;
  });
}
