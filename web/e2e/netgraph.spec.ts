import { expect, test, type Page } from '@playwright/test';
import type { StateV2 } from '../src/types';

test('Netgraph renders stable topology, inspection, and synchronized musical hops', async ({ page }, testInfo) => {
  const now = Date.now();
  const state = netgraphState(now);
  await instrumentAudioContext(page);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const packet = {
      seq: 1,
      id: 'netgraph-packet',
      at: now,
      payloadType: 'Text',
      mode: 'route',
      segments: [
        { routeId: 'a-b', fromId: 'a', toId: 'b' },
        { routeId: 'b-c', fromId: 'b', toId: 'c' },
        { routeId: 'c-d', fromId: 'c', toId: 'd' },
        { routeId: 'd-e', fromId: 'd', toId: 'e' },
      ],
    };
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `retry: 60000\n\nevent: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\nid: 1\nevent: packet\ndata: ${JSON.stringify(packet)}\n\n`,
    });
  });

  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await expect(stage).toHaveAttribute('data-connected-nodes', '4');
  await expect(page.locator('#route-window')).toHaveValue('15m');
  await expect(stage).toHaveAttribute('data-visible-routes', '3');
  await page.locator('#route-window').selectOption('24h');
  await expect(stage).toHaveAttribute('data-visible-routes', '4');
  await expect(stage).toHaveAttribute('data-areas', /[2-9]/);
  expect(Number(await stage.getAttribute('data-region-assignments'))).toBeGreaterThan(0);
  await expect(page.locator('#area-count')).not.toHaveText('0');
  await expect(page.locator('#graph-canvas')).toBeVisible();
  await expect.poll(() => canvasHasPixels(page, '#graph-canvas')).toBe(true);

  await page.locator('#sound-button').click();
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-state')).toHaveText('On');
  await expect.poll(() => page.locator('#sound-activity').getAttribute('data-scheduled').then(Number), { timeout: 6_000 }).toBe(4);
  expect(await page.evaluate(() => (window as unknown as { __netgraphOscillators: number }).__netgraphOscillators)).toBe(4);
  await expect(stage).toHaveAttribute('data-last-packet-hops', '4');
  await expect(stage).toHaveAttribute('data-last-region-traffic', 'long-haul');
  await expect.poll(() => stage.getAttribute('data-active-region-labels').then(Number), { timeout: 8_000 }).toBeGreaterThan(0);
  await expect(stage).toHaveAttribute('data-active-region-roles', /OUT/);
  await expect.poll(() => canvasHasPixels(page, '#packet-canvas'), { timeout: 5_000 }).toBe(true);

  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Alpha');
  await page.locator('.node-search-result').first().click();
  await expect(stage).toHaveAttribute('data-selected-node-id', 'a');
  await expect(page.locator('#node-inspector-sheet')).toBeVisible();
  await expect(page.locator('#node-inspector-sheet')).toContainText('Alpha Repeater');
  await expect(page.locator('#node-inspector-sheet .neighbor-row').first()).toContainText('Bravo');
  expect(Number(await stage.getAttribute('data-node-search-apply-ms'))).toBeLessThan(100);
  expect(Number(await stage.getAttribute('data-node-selection-apply-ms'))).toBeLessThan(100);

  const initialScale = Number(await stage.getAttribute('data-view-scale'));
  await stage.dispatchEvent('wheel', { deltaY: -180, clientX: 500, clientY: 400 });
  await expect.poll(() => stage.getAttribute('data-view-scale').then(Number)).toBeGreaterThan(initialScale);
  await expect(stage).toHaveAttribute('data-visible-routes', '5');
  await expect(stage).toHaveAttribute('data-areas', /[2-9]/);

  await page.locator('#route-window').selectOption('15m');
  await expect(stage).toHaveAttribute('data-visible-routes', '4');
  await expect(page.locator('#node-inspector-sheet')).not.toContainText('Delta Sensor');

  if (testInfo.project.name !== 'desktop') {
    const targets = await page.locator('.control-button:visible, #route-window').evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(38);
    }
    const overflow = await page.locator('#topbar, .controls').evaluateAll((elements) => elements.some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -0.5 || rect.right > innerWidth + 0.5 || rect.top < -0.5 || rect.bottom > innerHeight + 0.5;
    }));
    expect(overflow).toBe(false);
  }
  expect(consoleErrors).toEqual([]);
});

test('Netgraph defaults to 15 minutes and preserves an explicit window choice', async ({ page }) => {
  await page.route('**/api/state', (route) => route.fulfill({ json: netgraphState(Date.now()) }));
  await page.route('**/api/events**', (route) => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.goto('/netgraph/');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-visible-routes', '3');
  await expect(page.locator('#route-window')).toHaveValue('15m');
  await page.locator('#route-window').selectOption('1h');
  await page.reload();
  await expect(page.locator('#route-window')).toHaveValue('1h');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-visible-routes', '4');
  await page.evaluate(() => localStorage.setItem('cartolite-server:netgraph:v1', '{invalid'));
  await page.reload();
  await expect(page.locator('#route-window')).toHaveValue('15m');
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-visible-routes', '3');
});

test('native touch pinches, pans, lifts and cancels without jumping or losing selection', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Camera easing is covered above; exact positions here make jump regressions measurable.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/state', (route) => route.fulfill({ json: netgraphState(Date.now()) }));
  await page.route('**/api/events**', (route) => route.fulfill({ contentType: 'text/event-stream', body: ': waiting\n\n' }));
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Alpha');
  await page.locator('.node-search-result').first().click();
  await expect(stage).toHaveAttribute('data-selected-node-id', 'a');
  const view = () => stage.evaluate((element) => ({
    scale: Number(element.dataset.viewScale),
    center: element.dataset.viewCenter!.split(',').map(Number),
  }));
  const session = await context.newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { id: number; x: number; y: number }[]) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    // Chromium coalesces native pointer moves until the next animation frame.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  const { width, height } = page.viewportSize()!;
  const x = Math.round(width * 0.3);
  const y = Math.min(250, Math.round(height * 0.4));
  let first = { id: 1, x: x - 30, y };
  let second = { id: 2, x: x + 30, y };
  const before = await view();
  await touch('touchStart', [first]);
  await touch('touchStart', [first, second]);
  first = { ...first, x: x - 60 };
  second = { ...second, x: x + 60 };
  await touch('touchMove', [first, second]);
  const pinched = await view();
  expect(pinched.scale).toBeCloseTo(before.scale * 2, 3);
  // The geographic point under the pinch midpoint stays under those fingers.
  expect(pinched.center[0]! + (x - width / 2) / pinched.scale)
    .toBeCloseTo(before.center[0]! + (x - width / 2) / before.scale, 1);
  expect(pinched.center[1]! + (y - height / 2) / pinched.scale)
    .toBeCloseTo(before.center[1]! + (y - height / 2) / before.scale, 1);
  first = { ...first, x: first.x + 20, y: y + 15 };
  second = { ...second, x: second.x + 20, y: y + 15 };
  await touch('touchMove', [first, second]);
  const panned = await view();
  expect(panned.scale).toBe(pinched.scale);
  expect(panned.center[0]).toBeCloseTo(pinched.center[0]! - 20 / pinched.scale, 1);
  expect(panned.center[1]).toBeCloseTo(pinched.center[1]! - 15 / pinched.scale, 1);
  await touch('touchEnd', [second]); // Release only the second contact.
  expect(await view()).toEqual(panned);
  first = { ...first, x: first.x + 18 };
  await touch('touchMove', [first]);
  expect((await view()).center[0]).toBeCloseTo(panned.center[0]! - 18 / panned.scale, 1);
  await touch('touchEnd', []);
  await expect(stage).not.toHaveClass(/is-dragging/);
  await expect(stage).toHaveAttribute('data-selected-node-id', 'a');

  // Pinch back out, then cancel: the next one-finger gesture must start fresh.
  first = { id: 1, x: x - 60, y };
  second = { id: 2, x: x + 60, y };
  await touch('touchStart', [first, second]);
  await touch('touchMove', [{ ...first, x: x - 30 }, { ...second, x: x + 30 }]);
  expect((await view()).scale).toBeCloseTo(before.scale, 3);
  await touch('touchCancel', []);
  await expect(stage).not.toHaveClass(/is-dragging/);
  const cancelled = await view();
  await touch('touchStart', [{ id: 3, x, y }]);
  await touch('touchMove', [{ id: 3, x: x + 24, y }]);
  expect((await view()).center[0]).toBeCloseTo(cancelled.center[0]! - 24 / cancelled.scale, 1);
  await touch('touchEnd', []);
  await expect(stage).toHaveAttribute('data-selected-node-id', 'a');

  const zoomStart = (await view()).scale;
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect((await view()).scale).toBeCloseTo(zoomStart * 1.5, 3);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect((await view()).scale).toBeCloseTo(zoomStart, 3);
  const buttons = await page.locator('.zoom-controls button').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, visible: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element };
  }));
  for (const button of buttons) expect(button).toEqual({ width: 44, height: 44, visible: true });
  expect(errors).toEqual([]);
  await session.detach();
});

test('slow renderers adapt decoration without losing hops and composite camera gestures', async ({ page }) => {
  await instrumentAudioContext(page);
  await page.route('**/api/state', (route) => route.fulfill({ json: netgraphState(Date.now()) }));
  await page.addInitScript(() => {
    const probe = window as unknown as { feed: EventTarget; slow: boolean; timer: number; packets: number; graphPaints: number };
    probe.slow = true;
    probe.packets = probe.graphPaints = 0;
    window.EventSource = class extends EventTarget {
      onopen?: () => void;
      constructor() { super(); probe.feed = this; setTimeout(() => this.onopen?.(), 0); }
      close(): void {}
    } as unknown as typeof EventSource;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.id === 'graph-canvas') probe.graphPaints++;
      if (this.canvas.id === 'packet-canvas' && probe.slow) {
        const until = performance.now() + 14;
        while (performance.now() < until) { /* Reproducible slow drawing, not device guessing. */ }
      }
      return clear.apply(this, args);
    };
  });
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
  await expect(stage).toHaveAttribute('data-quality-mode', 'full');
  await page.locator('#sound-button').click();
  await page.locator('#sound-toggle').click();
  await page.locator('#sound-button').click();
  await page.evaluate(() => {
    const probe = window as unknown as { feed: EventTarget; timer: number; packets: number };
    probe.timer = window.setInterval(() => {
      probe.packets++;
      probe.feed.dispatchEvent(new MessageEvent('packet', { data: JSON.stringify({
        seq: probe.packets, id: `adaptive-${probe.packets}`, at: Date.now(), payloadType: 'Text', mode: 'route',
        segments: [{ routeId: 'a-b', fromId: 'a', toId: 'b' }, { routeId: 'b-c', fromId: 'b', toId: 'c' }],
      }) }));
    }, 200);
  });
  await expect(stage).toHaveAttribute('data-quality-mode', 'low', { timeout: 8_000 });
  const packetCount = await page.evaluate(() => {
    const probe = window as unknown as { slow: boolean; timer: number; packets: number };
    probe.slow = false;
    clearInterval(probe.timer);
    return probe.packets;
  });
  expect(Number(await page.locator('#sound-activity').getAttribute('data-scheduled'))).toBe(packetCount * 2);
  expect(await page.evaluate(() => (window as unknown as { __netgraphOscillators: number }).__netgraphOscillators)).toBe(packetCount * 2);
  await expect(stage).toHaveAttribute('data-visible-routes', '3');
  await expect(page.locator('#netgraph-residue-canvas')).toBeVisible();
  await expect.poll(() => canvasHasPixels(page, '#netgraph-residue-canvas')).toBe(true);
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await page.mouse.move(100, 250);
  await page.mouse.down();
  const paints = await page.evaluate(() => (window as unknown as { graphPaints: number }).graphPaints);
  await page.mouse.move(160, 280, { steps: 6 });
  await expect(stage).toHaveAttribute('data-render-state', 'composited');
  expect(await page.evaluate(() => (window as unknown as { graphPaints: number }).graphPaints)).toBe(paints);
  await expect(page.locator('#graph-canvas')).not.toHaveCSS('transform', 'none');
  await page.mouse.up();
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await expect(page.locator('#graph-canvas')).toHaveCSS('transform', 'none');
});

test('Netgraph alone renders paired regional OUT and IN cues', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the cue renderer uses one shared Canvas2D path');
  const now = Date.now();
  const source = { id: 'ham-node', label: 'Hamilton sender', role: 'repeater' as const, observer: false, lat: 43.243158, lng: -79.94833, lastSeen: now };
  const destination = { id: 'pec-node', label: 'Prince Edward receiver', role: 'repeater' as const, observer: false, lat: 44.0, lng: -77.25, lastSeen: now };
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'netgraph-region-traffic',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'region-traffic' },
    map: { center: [-78.6, 43.65], zoom: 6.2 },
    nodes: [source, destination],
    routes: [{ id: 'ham-pec', fromId: source.id, toId: destination.id, packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 }],
  };
  const packet = {
    seq: 1,
    id: 'netgraph-region-dx-packet',
    at: now,
    payloadType: 'Text',
    mode: 'route',
    segments: [{ routeId: 'ham-pec', fromId: source.id, toId: destination.id }],
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `retry: 60000

event: hello
data: ${JSON.stringify({ seq: 0, bootId: state.bootId })}

id: 1
event: packet
data: ${JSON.stringify(packet)}

`,
    });
  });

  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false', { timeout: 15_000 });
  await expect(stage).toHaveAttribute('data-region-assignments', '2');
  await expect(stage).toHaveAttribute('data-last-region-from', 'FN03');
  await expect(stage).toHaveAttribute('data-last-region-to', 'FN14');
  await expect(stage).toHaveAttribute('data-last-region-traffic', 'long-haul');
  await expect.poll(() => stage.getAttribute('data-active-region-labels').then(Number), { timeout: 8_000 }).toBe(2);
  await expect(stage).toHaveAttribute('data-active-region-roles', 'FN03:OUT,FN14:IN');
  await page.screenshot({ path: testInfo.outputPath('netgraph-paired-region-cues.png') });
});

test('the worldwide map exposes Netgraph', async ({ page }) => {
  await page.route('**/api/state', (route) => route.fulfill({ json: netgraphState(Date.now()) }));
  await page.route('**/api/events**', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: hello\ndata: ${JSON.stringify({ seq: 0, bootId: 'netgraph-test' })}\n\n`,
  }));
  await page.goto('/');
  await expect(page.locator('#netgraph-link')).toHaveAttribute('href', '/netgraph/');
});

function netgraphState(now: number): StateV2 {
  return {
    schemaVersion: 2,
    bootId: 'netgraph-test',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'active', lastPacketAt: now, dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [-79, 44], zoom: 5 },
    nodes: [
      { id: 'a', label: 'Alpha Repeater', lat: 44, lng: -80, role: 'repeater', observer: false, lastSeen: now },
      { id: 'b', label: 'Bravo Companion', lat: 45, lng: -79, role: 'companion', observer: false, lastSeen: now - 1_000 },
      { id: 'c', label: 'Charlie Room', lat: 46, lng: -78, role: 'room_server', observer: false, lastSeen: now - 2_000 },
      { id: 'd', label: 'Delta Sensor', lat: 47, lng: -77, role: 'sensor', observer: false, lastSeen: now - 3_000 },
      { id: 'e', label: 'Echo Repeater', lat: 48, lng: -76, role: 'repeater', observer: false, lastSeen: now - 4_000 },
      { id: 'isolated', label: 'Isolated', lat: 48, lng: -76, role: 'unknown', observer: false, lastSeen: now },
    ],
    routes: [
      { id: 'a-b', fromId: 'a', toId: 'b', packetCount: 12, lastHeard: now, intensity: 3, lastKind: 'Text', traffic: 12 },
      { id: 'b-c', fromId: 'b', toId: 'c', packetCount: 8, lastHeard: now - 30_000, intensity: 3, lastKind: 'ACK', traffic: 8 },
      { id: 'c-d', fromId: 'c', toId: 'd', packetCount: 5, lastHeard: now - 60_000, intensity: 2, lastKind: 'Trace', traffic: 5 },
      { id: 'a-d', fromId: 'a', toId: 'd', packetCount: 2, lastHeard: now - 30 * 60_000, intensity: 1, lastKind: 'Advert', traffic: 2 },
    ],
  };
}

async function canvasHasPixels(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const context = element.getContext('2d');
    if (!context || element.width === 0 || element.height === 0) return false;
    const sample = context.getImageData(0, 0, element.width, element.height).data;
    for (let index = 3; index < sample.length; index += 64) if ((sample[index] ?? 0) > 0) return true;
    return false;
  });
}

async function instrumentAudioContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const parameter = () => ({
      value: 0,
      cancelScheduledValues() {},
      exponentialRampToValueAtTime() {},
      setTargetAtTime() {},
      setValueAtTime() {},
    });
    const audioNode = (extra: Record<string, unknown> = {}) => Object.assign(extra, {
      connect(destination: unknown) { return destination; },
      disconnect() {},
    });
    class TestAudioContext {
      currentTime = 0;
      destination = audioNode();
      sampleRate = 48_000;
      state = 'running';
      onstatechange: (() => void) | null = null;
      createGain() { return audioNode({ gain: parameter() }); }
      createDelay() { return audioNode({ delayTime: parameter() }); }
      createBiquadFilter() { return audioNode({ type: 'lowpass', frequency: parameter(), Q: parameter() }); }
      createStereoPanner() { return audioNode({ pan: parameter() }); }
      createDynamicsCompressor() { return audioNode({ threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() }); }
      createPeriodicWave() { return {}; }
      createBuffer() { return {}; }
      createBufferSource() { return audioNode({ buffer: null, onended: null, start() {} }); }
      createOscillator() {
        (window as unknown as { __netgraphOscillators: number }).__netgraphOscillators += 1;
        return audioNode({ frequency: parameter(), onended: null, setPeriodicWave() {}, start() {}, stop() {} });
      }
      async resume() { this.state = 'running'; this.onstatechange?.(); }
      async close() {}
    }
    (window as unknown as { __netgraphOscillators: number }).__netgraphOscillators = 0;
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext });
  });
}
