import { expect, test, type Locator, type Page } from '@playwright/test';
import { DESTINATION_BLOOM_MS, routeDuration } from '../src/packetAnimator';
import { NEIGHBOR_ROUTE_RECENT_MS } from '../src/routeFocus';
import type { StateV2 } from '../src/types';

test('renders the live route map and privacy-safe state', async ({ page }, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);
  await instrumentAudioContext(page);
  const mapStyleErrors = captureMapStyleErrors(page);
  const consoleErrors = captureConsoleErrors(page);
  const cartoResponses = { tileJSON: 0, vector: 0, glyph: 0 };
  const terrainResponses = { tileJSON: 0, dem: 0 };
  const rasterRequests: string[] = [];
  page.on('request', (request) => {
    if (/basemaps\.cartocdn\.com\/.+\.(?:png|jpg)(?:\?|$)|dark_all/i.test(request.url())) rasterRequests.push(request.url());
  });
  page.on('response', (response) => {
    if (!response.ok()) return;
    const url = response.url();
    if (url.includes('/vector/carto.streets/v1/tiles.json')) cartoResponses.tileJSON += 1;
    else if (url.includes('/vectortiles/carto.streets/') && url.includes('.mvt')) cartoResponses.vector += 1;
    else if (url.includes('/fonts/') && url.includes('.pbf')) cartoResponses.glyph += 1;
    else if (url.includes('tiles.mapterhorn.com/tilejson.json')) terrainResponses.tileJSON += 1;
    else if (url.includes('tiles.mapterhorn.com/') && !url.includes('/tilejson.json')) terrainResponses.dem += 1;
  });
  const stateResponse = page.waitForResponse((response) => response.url().endsWith('/api/state') && response.ok());
  await page.goto('/');
  const response = await stateResponse;
  const state = await response.json() as Record<string, unknown>;

  await expect(page.locator('#map .maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.map-grade')).toBeVisible();
  await expect(page.locator('.map-grade')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
  expect(mapStyleErrors, 'MapLibre should accept every installed layer expression').toEqual([]);
  await expect.poll(() => cartoResponses.tileJSON, { message: 'CARTO vector TileJSON should load' }).toBeGreaterThan(0);
  await expect.poll(() => cartoResponses.vector, { message: 'CARTO vector PBF tiles should load' }).toBeGreaterThan(0);
  await expect.poll(() => cartoResponses.glyph, { message: 'CARTO glyph PBFs should load' }).toBeGreaterThan(0);
  expect(rasterRequests, 'the vector-only release must not request a raster basemap').toEqual([]);
  await expect(page.locator('#route-canvas')).toHaveCount(0);
  await expect(page.locator('#map')).toHaveAttribute('data-route-renderer', 'maplibre-webgl');
  await expect(page.locator('#packet-canvas')).toBeVisible();
  await expect(page.locator('#traffic-meter i')).toHaveCount(5);
  expect(await page.locator('#map-grade').evaluate((element) => {
    const overlay = getComputedStyle(element, '::before');
    return { animationName: overlay.animationName, backgroundImage: overlay.backgroundImage };
  }), 'live traffic must not add a full-map colour pulse overlay').toEqual({
    animationName: 'none',
    backgroundImage: 'none',
  });
  await expect(page.locator('#status-text')).not.toHaveText('Starting…');
  const routeWindow = page.locator('#route-window');
  const layersSummary = page.locator('#layers-summary');
  if (mobile) {
    await expect(layersSummary).toBeVisible();
    await expect(page.locator('#layers-disclosure')).not.toHaveAttribute('open', '');
    await expect(routeWindow).toBeHidden();
    await layersSummary.click();
  } else {
    await expect(layersSummary).toBeHidden();
  }
  await expect(routeWindow).toBeVisible();
  await expect(routeWindow).toHaveValue('auto');
  const autoRouteWindow = routeWindow.locator('option[value="auto"]');
  await expect(autoRouteWindow).toHaveText(/^Auto · (?:15m|1h|6h|24h)$/);
  await routeWindow.selectOption('15m');
  await expect(routeWindow).toHaveValue('15m');
  await expect(autoRouteWindow).toHaveText(/^Auto · (?:15m|1h|6h|24h)$/);
  await routeWindow.selectOption('auto');
  await expect(routeWindow).toHaveValue('auto');
  const aboutDialog = page.locator('#about-dialog');
  await page.locator('#about-button').click();
  await expect(aboutDialog).toBeVisible();
  await expect(aboutDialog).toContainText('No public keys, packet payloads, message text, raw paths, or visitor analytics');
  await page.locator('#about-close').click();
  await expect(aboutDialog).toBeHidden();
  if (mobile) await openLayers(page);
  const nodeLegend = page.locator('#legend-items');
  await expect(nodeLegend).toContainText('Repeater');
  await expect(nodeLegend).toContainText('Companion');
  await expect(nodeLegend).toContainText('Room');
  await expect(nodeLegend).not.toContainText('RF route');
  const routeLegend = page.locator('#route-legend');
  await expect(routeLegend).toBeHidden();
  await expect(routeLegend).toHaveAttribute('aria-label', 'Route colors show the latest packet type');
  await expect(routeLegend.locator('.route-legend-item')).toHaveCount(5);
  if (mobile) {
    const targetSizes = await page.locator('#about-button, .control-button:visible, #route-window, #legend-toggle').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
    for (const size of targetSizes) {
      expect(size.width, 'mobile control target width').toBeGreaterThanOrEqual(44);
      expect(size.height, 'mobile control target height').toBeGreaterThanOrEqual(44);
    }
    const overflow = await page.locator('#topbar, .controls, .layers-panel').evaluateAll((elements) => elements.some((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left < -0.5 || bounds.right > window.innerWidth + 0.5 || bounds.top < -0.5 || bounds.bottom > window.innerHeight + 0.5;
    }));
    expect(overflow, 'mobile controls should stay inside portrait and landscape viewports').toBe(false);
    await expect(page.locator('#legend-toggle')).toBeVisible();
    await expect(page.locator('#legend')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.locator('#legend-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#legend-items')).toBeHidden();
    await page.locator('#legend-toggle').click();
    await expect(page.locator('#legend-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#legend-toggle')).toHaveAttribute('aria-label', 'Hide map legend');
    await expect(page.locator('#legend-items')).toBeVisible();
    await page.locator('#legend-toggle').click();
    await openLayers(page);
  } else {
    await expect(page.locator('#legend-items')).toBeVisible();
  }
  const routesButton = page.locator('#routes-button');
  await expect(routesButton).toBeVisible();
  await expect(routesButton).toHaveAttribute('aria-pressed', 'false');
  await expect(routesButton).toHaveAttribute('title', 'Show routes');
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible', 'false');
  const heatmapButton = page.locator('#heatmap-button');
  await expect(heatmapButton).toBeVisible();
  await expect(heatmapButton).toHaveAttribute('aria-label', 'Heatmap');
  await expect(heatmapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(heatmapButton).toHaveAttribute('title', 'Hide heatmap');
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'true');
  const clustersButton = page.locator('#clusters-button');
  const hillshadeButton = page.locator('#hillshade-button');
  const terrainButton = page.locator('#terrain-button');
  await expect(clustersButton).toHaveAttribute('aria-pressed', 'true');
  await clustersButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-clusters-visible', 'false');
  await expect(clustersButton).toHaveAttribute('title', 'Show clusters');
  await clustersButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-clusters-visible', 'true');
  await expect(hillshadeButton).toHaveAttribute('aria-pressed', 'false');
  await hillshadeButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-hillshade-visible', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-terrain-ready', 'true');
  await expect.poll(() => terrainResponses.tileJSON, { message: 'terrain TileJSON should load' }).toBeGreaterThan(0);
  await expect.poll(() => terrainResponses.dem, { message: 'terrain elevation tiles should load' }).toBeGreaterThan(0);
  await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText('Mapterhorn');
  await terrainButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-terrain3d', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-camera-pitch', '52');
  await terrainButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-terrain3d', 'false');
  await expect(page.locator('#map')).toHaveAttribute('data-camera-pitch', '0');
  const soundButton = page.locator('#sound-button');
  const soundPanel = page.locator('#sound-panel');
  const soundToggle = page.locator('#sound-toggle');
  await expect(soundButton).toBeVisible();
  await expect(soundButton).toHaveAttribute('aria-label', 'Sound');
  await expect(soundButton).toHaveAttribute('aria-pressed', 'false');
  await expect(soundButton).toHaveAttribute('title', 'Sound off — Aurora · 80%');
  await expect(page.locator('#sound-state')).toHaveText('Off');
  await soundButton.click();
  await expect(soundPanel).toBeVisible();
  await expect(page.locator('#sound-panel-state')).toHaveText('Off');
  await expect(page.locator('#sound-volume-output')).toHaveText('80%');
  await expect(page.locator('#sound-scene')).toHaveValue('aurora');
  await page.locator('#sound-scene').selectOption('wood');
  await expect(soundButton).toHaveAttribute('title', 'Sound off — Wood · 80%');
  await soundToggle.click();
  await expect(soundButton).toHaveAttribute('aria-pressed', 'true');
  await expect(soundButton).toHaveAttribute('title', 'Sound on — Wood · 80% · visible live hops only');
  await expect(page.locator('#sound-panel-state')).toHaveText('On');
  await expect(soundButton).toHaveClass(/sounding/, { timeout: 15_000 });
  const audioCounts = await page.evaluate(() => ({
    oscillators: (window as unknown as { __cartoliteOscillators: number }).__cartoliteOscillators,
    unlocks: (window as unknown as { __cartoliteAudioUnlocks: number }).__cartoliteAudioUnlocks,
    scheduled: Number(document.getElementById('sound-activity')?.dataset.scheduled ?? 0)
  }));
  expect(audioCounts.unlocks, 'mobile-safe silent audio unlock should run inside the tap').toBe(1);
  expect(audioCounts.scheduled).toBeGreaterThan(0);
  expect(audioCounts.oscillators, 'one oscillator should be created for every scheduled visible hop').toBe(audioCounts.scheduled);
  await page.locator('#sound-volume').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '65';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#sound-volume-output')).toHaveText('65%');
  await soundToggle.click();
  await expect(soundButton).toHaveAttribute('aria-pressed', 'false');
  await expect(soundButton).toHaveAttribute('title', 'Sound off — Wood · 65%');
  await expect(page.locator('#sound-panel-state')).toHaveText('Off');
  await soundButton.click();
  await expect(soundPanel).toBeHidden();
  if (mobile) await openLayers(page);

  await routesButton.click();
  await expect(routesButton).toHaveAttribute('aria-pressed', 'true');
  await expect(routeLegend).toBeVisible();
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-route-representation', 'individual-routes');
  await expect.poll(() => page.locator('#map').getAttribute('data-eligible-routes').then(Number)).toBeGreaterThan(0);
  await expect(page.locator('#map')).toHaveAttribute('data-trunk-representations-loaded', '');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  if (mobile) await openLayers(page);
  await routesButton.click();
  await expect(routesButton).toHaveAttribute('aria-pressed', 'false');
  await expect(routesButton).toHaveAttribute('title', 'Show routes');
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible', 'false');
  await expect(routeLegend).toBeHidden();
  await expect(routeLegend.locator('.route-legend-item')).toHaveCount(5);
  await expect(heatmapButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'true');
  await expect.poll(() => canvasHasPixels(page.locator('#packet-canvas')), { message: 'packet animation canvas should receive a live frame while routes are hidden', timeout: 15_000 }).toBe(true);
  await heatmapButton.click();
  await expect(heatmapButton).toHaveAttribute('aria-pressed', 'false');
  await expect(heatmapButton).toHaveAttribute('title', 'Show heatmap');
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'false');
  await expect(routesButton).toHaveAttribute('aria-pressed', 'false');
  await routesButton.click();
  await expect(routesButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible', 'true');

  await heatmapButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'true');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.screenshot({ path: testInfo.outputPath('cartolite-overlays.png'), fullPage: true });
  await expect(routesButton).toHaveAttribute('aria-pressed', 'true');
  await heatmapButton.click();
  await expect(page.locator('#map')).toHaveAttribute('data-heatmap-visible', 'false');
  expect(mapStyleErrors, 'route styling should remain MapLibre-valid after data and layer visibility changes').toEqual([]);
  expect(consoleErrors, 'browser should not emit console errors').toEqual([]);
  expect(state.schemaVersion).toBe(2);

  const serialized = JSON.stringify(state).toLowerCase();
  for (const forbidden of ['packet_hash', 'raw_payload', 'raw_path', 'public_key', 'observer_public_key', 'resolver_reason', 'message_text']) {
    expect(serialized, `public state contains ${forbidden}`).not.toContain(forbidden);
  }

  await page.screenshot({ path: testInfo.outputPath('cartolite.png'), fullPage: true });
});

test('keeps the map primary with reduced motion and releases live follow on drag', async ({ page }, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#map')).toHaveAttribute('data-follow-dwell-ms', '5000');
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-motion-mode', 'static');
  await expect(page.locator('#follow-button')).toBeVisible();
  if (mobile) await openLayers(page);
  await expect(page.locator('#routes-button')).toBeVisible();
  await expect(page.locator('#routes-button')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#routes-button').click();
  await expect(page.locator('#routes-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#reset-button')).toBeVisible();
  await page.locator('#follow-button').click();
  await expect(page.locator('#follow-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#follow-button')).toHaveClass(/selected/);
  await expect(page.locator('#follow-button')).toHaveAttribute('title', 'Stop following live packets');
  const mapCanvas = page.locator('#map .maplibregl-canvas');
  const box = await mapCanvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  if (!mobile) {
    await page.mouse.move(box.x + box.width * 0.54, box.y + box.height * 0.54);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.58, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#follow-button')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#follow-button')).not.toHaveClass(/selected/);
    await expect(page.locator('#follow-button')).toHaveAttribute('title', 'Follow live packets');
    await page.locator('#follow-button').click();
    await expect(page.locator('#follow-button')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('#reset-button').click();
  await expect(page.locator('#follow-button')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => canvasHasPixels(page.locator('#packet-canvas')), {
    message: 'reduced motion should render a restrained static traffic cue',
    timeout: 15_000
  }).toBe(true);
});

test('keeps mobile awake and refreshes live state after the page resumes', async ({ page }, testInfo) => {
  test.skip(!isMobileProject(testInfo.project.name), 'mobile lifecycle behavior');
  const consoleErrors = captureConsoleErrors(page);
  const requests = { state: 0, events: 0 };
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/state') requests.state += 1;
    if (path === '/api/events') requests.events += 1;
  });
  await page.addInitScript(() => {
    const lifecycle = { hidden: false, requests: 0, releases: 0 };
    Object.defineProperty(window, '__cartoliteLifecycle', { configurable: true, value: lifecycle });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => lifecycle.hidden });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => lifecycle.hidden ? 'hidden' : 'visible'
    });
    Object.defineProperty(window, '__setCartoliteHidden', {
      configurable: true,
      value(hidden: boolean) {
        lifecycle.hidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      }
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        async request(type: string) {
          if (type !== 'screen') throw new TypeError('unsupported wake lock');
          lifecycle.requests += 1;
          const sentinel = new EventTarget() as EventTarget & { released: boolean; release(): Promise<void> };
          sentinel.released = false;
          sentinel.release = async () => {
            if (sentinel.released) return;
            sentinel.released = true;
            lifecycle.releases += 1;
            sentinel.dispatchEvent(new Event('release'));
          };
          return sentinel;
        }
      }
    });
  });

  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle', { timeout: 10_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-screen-awake', 'true');
  await expect.poll(() => requests.state).toBe(1);
  await expect.poll(() => requests.events).toBeGreaterThanOrEqual(1);

  await page.evaluate(() => (window as unknown as { __setCartoliteHidden(hidden: boolean): void }).__setCartoliteHidden(true));
  await expect(page.locator('#app')).toHaveAttribute('data-screen-awake', 'false');
  await page.evaluate(() => (window as unknown as { __setCartoliteHidden(hidden: boolean): void }).__setCartoliteHidden(false));

  await expect(page.locator('#app')).toHaveAttribute('data-screen-awake', 'true');
  await expect.poll(() => requests.state, { message: 'resume must fetch a fresh state snapshot' }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => requests.events, { message: 'resume must replace the frozen event stream' }).toBeGreaterThanOrEqual(2);
  const lifecycle = await page.evaluate(() => (window as unknown as {
    __cartoliteLifecycle: { requests: number; releases: number };
  }).__cartoliteLifecycle);
  expect(lifecycle).toEqual({ hidden: false, requests: 2, releases: 1 });
  expect(consoleErrors).toEqual([]);
});

test('keeps a recent packet trail after stable routes are hidden', async ({ page }, testInfo) => {
  test.skip(isMobileProject(testInfo.project.name), 'trail lifetime is covered once on desktop');
  const now = Date.now();
  const from = { id: 'a', label: 'Alpha', lat: 43.45, lng: -80.42 };
  const to = { id: 'b', label: 'Bravo', lat: 43.5, lng: -80.28 };
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'trail-smoke',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'trail' },
    map: { center: [-80.35, 43.45], zoom: 8.25 },
    nodes: [
      { ...from, role: 'repeater', observer: false, lastSeen: now },
      { ...to, role: 'companion', observer: false, lastSeen: now }
    ],
    routes: [{ id: 'route-a-b', fromId: from.id, toId: to.id, packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 }]
  };
  const packet = {
    seq: 1,
    id: 'trail-packet',
    at: now,
    payloadType: 'Text',
    mode: 'route' as const,
    segments: [{ routeId: 'route-a-b', fromId: from.id, toId: to.id }]
  };

  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  let eventStreamRequested = false;
  await page.route('**/api/events**', (route) => {
    eventStreamRequested = true;
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\nid: 1\nevent: packet\ndata: ${JSON.stringify(packet)}\n\n`
    });
  });

  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await expect.poll(() => eventStreamRequested, { message: 'mock event stream should receive the query-bearing SSE request' }).toBe(true);
  await expect(page.locator('#map')).toHaveAttribute('data-routes-visible', 'false');
  const packetCanvas = page.locator('#packet-canvas');
  await expect.poll(() => canvasHasPixels(packetCanvas), { timeout: 5_000 }).toBe(true);
  await expect(packetCanvas).toHaveAttribute('data-last-packet-kind', 'Text');
  await expect(packetCanvas).toHaveAttribute('data-last-signature', 'orbit');
  await expect.poll(() => packetCanvas.getAttribute('data-wakes-scheduled').then(Number)).toBeGreaterThan(0);
  await expect(page.locator('#app')).toHaveAttribute('data-traffic-kind', 'text');
  const afterglowWindow = routeDuration([{ routeId: 'route-a-b', from, to }]) + DESTINATION_BLOOM_MS + 600;
  await page.waitForTimeout(afterglowWindow);
  await expect.poll(() => canvasHasPixels(packetCanvas), { message: '45-second trail should outlive the moving comet and afterglow', timeout: 2_000 }).toBe(true);
  await page.waitForTimeout(Math.max(0, 15_500 - afterglowWindow));
  await expect.poll(() => canvasHasPixels(packetCanvas), { message: 'recent packet trail should remain visible beyond the former 15-second lifetime', timeout: 2_000 }).toBe(true);
});

test('focuses recent route neighbors and clears selection on the map', async ({ page }, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);
  const now = Date.now();
  const center: [number, number] = [-80.35, 43.45];
  const alpha = { id: 'a', label: 'Alpha', lng: center[0], lat: center[1] };
  const bravo = { id: 'b', label: 'Bravo', lng: -80.1, lat: 43.45 };
  const charlie = { id: 'c', label: 'Charlie', lng: -80.35, lat: 43.6 };
  const delta = { id: 'd', label: 'Delta', lng: -80.6, lat: 43.3 };
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'neighbor-smoke',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'neighbor' },
    map: { center, zoom: 8.25 },
    nodes: [
      { ...alpha, role: 'repeater', observer: false, lastSeen: now },
      { ...bravo, role: 'companion', observer: false, lastSeen: now },
      { ...charlie, role: 'room_server', observer: false, lastSeen: now },
      { ...delta, role: 'sensor', observer: false, lastSeen: now }
    ],
    routes: [
      { id: 'a-b', fromId: alpha.id, toId: bravo.id, packetCount: 12, lastHeard: now, intensity: 3, lastKind: 'Text', traffic: 12 },
      { id: 'a-c', fromId: alpha.id, toId: charlie.id, packetCount: 7, lastHeard: now - NEIGHBOR_ROUTE_RECENT_MS + 60 * 60_000, intensity: 2, lastKind: 'Trace', traffic: 7 },
      { id: 'a-d', fromId: alpha.id, toId: delta.id, packetCount: 3, lastHeard: now - NEIGHBOR_ROUTE_RECENT_MS - 60 * 60_000, intensity: 1, lastKind: 'Advert', traffic: 3 },
      { id: 'b-c', fromId: bravo.id, toId: charlie.id, packetCount: 5, lastHeard: now, intensity: 2, lastKind: 'ACK', traffic: 5 }
    ]
  };

  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\n`
  }));
  await page.addInitScript(({ key, view }) => {
    window.localStorage.setItem(key, JSON.stringify(view));
  }, { key: `cartolite:view:v3:${mobile ? 'mobile' : 'desktop'}`, view: { center, zoom: state.map.zoom } });

  await page.goto('/');
  const map = page.locator('#map');
  const canvas = page.locator('#map .maplibregl-canvas');
  const tooltip = page.locator('#tooltip');
  const focusChip = page.locator('#focus-chip');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  const routesButton = page.locator('#routes-button');
  if (mobile) await openLayers(page);
  await routesButton.click();
  await expect(map).toHaveAttribute('data-routes-visible', 'true');
  if (mobile) await closeLayers(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const alphaPoint = projectToViewport(alpha, center, state.map.zoom, box);
  const bravoPoint = projectToViewport(bravo, center, state.map.zoom, box);
  const charliePoint = projectToViewport(charlie, center, state.map.zoom, box);
  const deltaPoint = projectToViewport(delta, center, state.map.zoom, box);

  await clickPoint(page, { x: alphaPoint.x + (mobile ? 12 : 0), y: alphaPoint.y }, mobile);
  await expect(map).toHaveAttribute('data-selected-node-id', 'a');
  const inspector = mobile ? page.locator('#node-inspector-sheet') : page.locator('.node-inspector-popup');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Alpha');
  await expect(inspector.locator('.neighbor-row')).toHaveCount(1);
  await expect(inspector.locator('.neighbor-row').first()).toContainText('Bravo');
  await expect(map).toHaveAttribute('data-neighbor-route-count', '1');
  await expect(map).toHaveAttribute('data-focused-route-count', '1');
  await expect(focusChip).toBeVisible();
  await expect(focusChip).toContainText('Alpha · 1 neighbor');
  if (mobile) await openLayers(page);
  await page.locator('#route-window').selectOption('24h');
  if (mobile) await closeLayers(page);
  await expect(map).toHaveAttribute('data-neighbor-route-count', '2');
  await expect(map).toHaveAttribute('data-focused-route-count', '2');
  await expect(inspector.locator('.neighbor-row')).toHaveCount(2);
  await expect(inspector.locator('.neighbor-row strong')).toHaveText(['Bravo', 'Charlie']);
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(focusChip).toContainText('Alpha · 2 neighbors');
  await expect(page.locator('#legend')).toHaveAttribute('data-focused', 'true');
  await expect(page.locator('#legend-items')).toBeHidden();
  await expect(page.locator('#legend-toggle')).toBeHidden();

  await inspectRoute(page, alphaPoint, bravoPoint, mobile);
  await expect(map).toHaveAttribute('data-hovered-route-id', 'a-b');
  await expect(tooltip).toHaveAttribute('data-kind', 'route');
  await expect(tooltip).toContainText('Alpha ↔ Bravo');
  await expect(tooltip).toContainText('12 packets');
  await expectTooltipInsideViewport(tooltip, page);
  await page.screenshot({ path: testInfo.outputPath(`cartolite-neighbors-focus-${testInfo.project.name}.png`) });

  if (!mobile) {
    await hoverMidpoint(page, bravoPoint, charliePoint);
    await expect(tooltip).toBeHidden();
    await expect(map).toHaveAttribute('data-hovered-route-id', '');
    await hoverMidpoint(page, alphaPoint, deltaPoint);
    await expect(tooltip).toBeHidden();
  }

  if (mobile) await openLayers(page);
  await routesButton.click();
  await expect(map).toHaveAttribute('data-routes-visible', 'false');
  await expect(map).toHaveAttribute('data-selected-node-id', 'a');
  await expect(map).toHaveAttribute('data-hovered-route-id', '');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(tooltip).toBeHidden();
  await expect(focusChip).toContainText('Alpha · 2 neighbors');
  await expect(page.locator('#legend')).toHaveAttribute('data-focused', 'true');

  if (mobile) await openLayers(page);
  await routesButton.click();
  await expect(map).toHaveAttribute('data-routes-visible', 'true');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  if (mobile) await closeLayers(page);
  await inspectRoute(page, alphaPoint, charliePoint, mobile);
  await expect(map).toHaveAttribute('data-hovered-route-id', 'a-c');
  await expect(tooltip).toHaveAttribute('data-kind', 'route');
  await expect(tooltip).toContainText('Alpha ↔ Charlie');
  if (mobile) await openLayers(page);
  await page.locator('#route-window').selectOption('15m');
  await expect(map).toHaveAttribute('data-hovered-route-id', '');
  await expect(tooltip).toBeHidden();
  await page.locator('#route-window').selectOption('24h');
  if (mobile) await closeLayers(page);

  await clickPoint(page, bravoPoint, mobile);
  await expect(map).toHaveAttribute('data-selected-node-id', 'b');
  await expect(inspector).toContainText('Bravo');
  await expect(map).toHaveAttribute('data-neighbor-route-count', '2');
  await expect(map).toHaveAttribute('data-focused-route-count', '2');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(focusChip).toContainText('Bravo · 2 neighbors');
  await inspectRoute(page, bravoPoint, charliePoint, mobile);
  await expect(map).toHaveAttribute('data-hovered-route-id', 'b-c');
  await expect(tooltip).toHaveAttribute('data-kind', 'route');
  await expect(tooltip).toContainText('Bravo ↔ Charlie');
  if (!mobile) {
    await hoverMidpoint(page, alphaPoint, charliePoint);
    await expect(tooltip).toBeHidden();
  }

  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.wheel(0, -120);
  await expect(map).toHaveAttribute('data-selected-node-id', 'b');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Bravo');

  await clickPoint(page, {
    x: box.x + box.width * 0.84,
    y: box.y + box.height * (mobile ? 0.30 : 0.82),
  }, mobile);
  await expect(map).toHaveAttribute('data-selected-node-id', '');
  await expect(map).toHaveAttribute('data-neighbor-route-count', '0');
  await expect(map).toHaveAttribute('data-focused-route-count', '0');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(tooltip).toBeHidden();
  await expect(focusChip).toBeHidden();
  await expect(page.locator('#legend')).toHaveAttribute('data-focused', 'false');
  if (mobile) {
    await expect(page.locator('#legend-toggle')).toBeVisible();
    await expect(page.locator('#legend')).toHaveAttribute('data-collapsed', 'true');
    await expect(page.locator('#legend-items')).toBeHidden();
  } else {
    await expect(page.locator('#legend-items')).toBeVisible();
  }

  if (mobile) await openLayers(page);
  await page.locator('#find-button').click();
  await expect(page.locator('#find-panel')).toBeVisible();
  await page.locator('#node-search').fill('alpha');
  await expect(page.locator('.node-search-result')).toHaveCount(1);
  await expect(page.locator('.node-search-result')).toContainText('Alpha');
  await page.locator('.node-search-result').click();
  await expect(map).toHaveAttribute('data-selected-node-id', 'a');
  await expect(inspector).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(map).toHaveAttribute('data-selected-node-id', '');
  await expect(inspector).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('cartolite-neighbors.png') });
});

test('restores remembered sound as Tap to Resume without autoplay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the browser autoplay contract is identical across viewports');
  await page.addInitScript(() => {
    localStorage.setItem('cartolite:sound:v1', JSON.stringify({ enabled: true, volume: 0.63 }));
    const native = window.AudioContext;
    const state = { constructions: 0 };
    Object.defineProperty(window, '__cartoliteAudioConstruction', { configurable: true, value: state });
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: new Proxy(native, {
        construct(target, argumentsList) {
          state.constructions += 1;
          return Reflect.construct(target, argumentsList);
        }
      })
    });
  });

  await page.goto('/');
  await expect(page.locator('#sound-state')).toHaveText('Tap to Resume');
  await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'false');
  expect(await audioConstructionCount(page)).toBe(0);
  await page.locator('#sound-button').click();
  await expect(page.locator('#sound-panel-state')).toHaveText('Tap to Resume');
  await expect(page.locator('#sound-volume-output')).toHaveText('63%');
  expect(await audioConstructionCount(page)).toBe(0);
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-panel-state')).toHaveText('On');
  expect(await audioConstructionCount(page)).toBe(1);
});

test('re-homes when the saved viewport has no current activity', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop and mobile key separation is covered by unit tests');
  const now = Date.now();
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'saved-view-smoke',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'saved-view' },
    map: { center: [151.21, -33.87], zoom: 8 },
    nodes: [{ id: 'sydney', label: 'Sydney', role: 'repeater', observer: false, lat: -33.87, lng: 151.21, lastSeen: now }],
    routes: []
  };
  await page.addInitScript(() => {
    localStorage.setItem('cartolite-server:view:v1:desktop', JSON.stringify({ center: [-0.13, 51.51], zoom: 12 }));
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\n`
  }));

  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-view-source', 'home-no-activity');
});

async function canvasHasPixels(canvas: Locator): Promise<boolean> {
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

function captureMapStyleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && text.includes('layers.') && text.includes('.paint.')) errors.push(text);
  });
  return errors;
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    // Cloudflare may inject its optional beacon after the origin response. The
    // app deliberately blocks it because visitor analytics are out of scope.
    if (message.type() === 'error' && !text.includes('static.cloudflareinsights.com/beacon.min.js')) errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function instrumentAudioContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { count: 0, unlocks: 0 };
    Object.defineProperty(window, '__cartoliteOscillators', {
      configurable: true,
      get: () => state.count
    });
    Object.defineProperty(window, '__cartoliteAudioUnlocks', {
      configurable: true,
      get: () => state.unlocks
    });
    const original = window.AudioContext.prototype.createOscillator;
    window.AudioContext.prototype.createOscillator = function createInstrumentedOscillator(): OscillatorNode {
      state.count += 1;
      return original.call(this);
    };
    const originalBufferStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function startInstrumentedBuffer(...args: Parameters<AudioBufferSourceNode['start']>): void {
      state.unlocks += 1;
      originalBufferStart.apply(this, args);
    };
  });
}

async function audioConstructionCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as {
    __cartoliteAudioConstruction: { constructions: number };
  }).__cartoliteAudioConstruction.constructions);
}

async function openLayers(page: Page): Promise<void> {
  const disclosure = page.locator('#layers-disclosure');
  if (!await disclosure.evaluate((element) => element.hasAttribute('open'))) {
    await page.locator('#layers-summary').click();
  }
  await expect(disclosure).toHaveAttribute('open', '');
}

async function closeLayers(page: Page): Promise<void> {
  const disclosure = page.locator('#layers-disclosure');
  if (await disclosure.evaluate((element) => element.hasAttribute('open'))) {
    await page.locator('#layers-summary').click();
  }
  await expect(disclosure).not.toHaveAttribute('open', '');
}

function isMobileProject(projectName: string): boolean {
  return projectName.startsWith('mobile');
}

interface ViewportBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewportPoint {
  x: number;
  y: number;
}

function projectToViewport(
  endpoint: { lng: number; lat: number },
  center: [number, number],
  zoom: number,
  box: ViewportBox
): ViewportPoint {
  const worldSize = 512 * (2 ** zoom);
  const projected = mercator(endpoint.lng, endpoint.lat);
  const projectedCenter = mercator(center[0], center[1]);
  return {
    x: box.x + box.width / 2 + (projected.x - projectedCenter.x) * worldSize,
    y: box.y + box.height / 2 + (projected.y - projectedCenter.y) * worldSize
  };
}

function mercator(lng: number, lat: number): ViewportPoint {
  const sin = Math.sin(lat * Math.PI / 180);
  return {
    x: (lng + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)
  };
}

async function hoverMidpoint(page: Page, from: ViewportPoint, to: ViewportPoint): Promise<void> {
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
}

async function inspectRoute(page: Page, from: ViewportPoint, to: ViewportPoint, mobile: boolean): Promise<void> {
  const x = (from.x + to.x) / 2;
  const y = (from.y + to.y) / 2;
  if (mobile) {
    await page.touchscreen.tap(x, y);
    // Prove the tap stays pinned after Chromium's delayed synthetic mouseleave.
    await page.waitForTimeout(550);
    return;
  }
  await page.mouse.move(x, y, { steps: 4 });
}

async function clickPoint(page: Page, point: ViewportPoint, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.touchscreen.tap(point.x, point.y);
    return;
  }
  await page.mouse.click(point.x, point.y);
}

async function expectTooltipInsideViewport(tooltip: Locator, page: Page): Promise<void> {
  const box = await tooltip.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(7);
  expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
}
