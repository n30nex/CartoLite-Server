import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';
import { visualFixture } from './visualFixtures';

// Inspect the real production renderer with synthetic traffic only. Trace/video
// readbacks distort GPU timings and retain their own history during this check.
test.use({ screenshot: 'off', trace: 'off' });

test('long session releases completed source updates while newer work is queued', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await visualFixture(page);
  await page.addInitScript(() => window.addEventListener('cartolite-map-ready', event => {
    (window as any).__sessionMap = (event as CustomEvent).detail.view.map;
  }, { once: true }));
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await page.evaluate(async () => {
    const map = (window as any).__sessionMap;
    map.addSource('session-pressure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const source = map.getSource('session-pressure');
    const actor = await source.actorPromise;
    const send = actor.sendAsync.bind(actor);
    // Test-only worker latency models a busy device. MapLibre's public setData
    // path still processes real data; no private runtime patch ships to users.
    actor.sendAsync = async (message: any, ...args: any[]) => {
      if (message.data?.source === 'session-pressure') await new Promise(resolve => setTimeout(resolve, 60));
      return send(message, ...args);
    };
    const refs: WeakRef<object>[] = [];
    (window as any).__sessionRefs = refs;
    let tick = 0;
    (window as any).__sessionTimer = setInterval(() => {
      const data = { type: 'FeatureCollection', features: Array.from({ length: 400 }, (_, i) => ({
        type: 'Feature', id: i, properties: { label: `Update ${tick} node ${i}` },
        geometry: { type: 'Point', coordinates: [-80.4 + i * .0001, 43.45 + (tick % 10) * .00001] },
      })) };
      if (tick++ < 100) refs.push(new WeakRef(data));
      void source.setData(data);
    }, 15);
  });
  await page.waitForTimeout(4_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const retained = await page.evaluate(() => (window as any).__sessionRefs.filter((ref: WeakRef<object>) => ref.deref()).length);
  await page.evaluate(() => clearInterval((window as any).__sessionTimer));
  await cdp.detach();
  console.log('COMPLETED_SOURCE_UPDATES_RETAINED', retained);
  expect(retained, 'completed GeoJSON must be collectable before continuous updates stop').toBeLessThanOrEqual(2);
});

for (const scene of ['map', 'terrain', 'terminal', 'netgraph'] as const) {
  test(`long session resource sampling: ${scene}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    test.setTimeout(150_000);
    await visualFixture(page, 10.2, true);
    const now = Date.now();
    const state: StateV2 = {
      schemaVersion: 2, bootId: 'visual-fixture', seq: 0, serverTime: now,
      status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
      map: { center: [-80.35, 43.45], zoom: 10.2 },
      nodes: Array.from({ length: 600 }, (_, i) => ({ id: `session-${i}`, label: `Session ${i}`, role: 'repeater', observer: false,
        lng: -80.55 + (i % 30) * .014, lat: 43.3 + Math.floor(i / 30) * .014, lastSeen: now })),
      routes: Array.from({ length: 900 }, (_, i) => ({ id: `hop-${i}`, fromId: `session-${i % 600}`, toId: `session-${(i + 31) % 600}`,
        packetCount: 4, intensity: 2, lastKind: 'Text', traffic: 4, lastHeard: now })),
    };
    await page.route('**/api/state', route => route.fulfill({ json: state }));
    await page.addInitScript(() => {
      const counts: Record<string, number> = {};
      (window as any).__sessionResources = counts;
      for (const name of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray']) {
        const proto = WebGL2RenderingContext.prototype as any;
        const create = proto[`create${name}`], remove = proto[`delete${name}`];
        if (!create || !remove) continue;
        const live = new WeakSet<object>();
        counts[name] = 0;
        proto[`create${name}`] = function (...args: unknown[]) {
          const object = create.apply(this, args);
          if (object) { live.add(object); counts[name]!++; }
          return object;
        };
        proto[`delete${name}`] = function (object: object) {
          if (object && live.delete(object)) counts[name]!--;
          return remove.call(this, object);
        };
      }
      window.addEventListener('cartolite-map-ready', event => {
        (window as any).__sessionMap = (event as CustomEvent).detail.view.map;
      }, { once: true });
    });
    const path = scene === 'terminal' ? '/terminal/' : scene === 'netgraph' ? '/netgraph/' : '/';
    await page.goto(path);
    const stage = page.locator(scene === 'netgraph' ? '#netgraph-stage' : '#map');
    await expect(stage).toHaveAttribute('data-render-state', 'idle', { timeout: 15_000 });
    if (scene === 'terrain') {
      await page.locator('#terrain-shortcut').click();
      await expect(stage).toHaveAttribute('data-terrain3d', 'true');
      await expect(stage).toHaveAttribute('data-route-mesh-busy', 'false', { timeout: 15_000 });
    }
    await page.locator('#sound-button').click();
    await page.locator('#sound-toggle').click();
    await expect(page.locator('#sound-state')).toHaveText('On');
    await page.keyboard.press('Escape');
    await page.evaluate(state => {
      let seq = 0, tick = 0;
      const metrics = { ticks: 0, maxDelay: 0, totalDelay: 0 };
      (window as any).__sessionTiming = metrics;
      let last = performance.now();
      (window as any).__sessionTimer = window.setInterval(() => {
        const now = performance.now(), delay = Math.max(0, now - last - 100);
        last = now; metrics.ticks++; metrics.maxDelay = Math.max(metrics.maxDelay, delay); metrics.totalDelay += delay;
        const route = state.routes[tick % state.routes.length]!;
        if (tick % 5 === 0) {
          const node = state.nodes[tick % state.nodes.length]!;
          window.dispatchEvent(new CustomEvent('visual-node', { detail: { seq: ++seq, node: { ...node, lastSeen: Date.now() } } }));
        }
        window.dispatchEvent(new CustomEvent('visual-packet', { detail: { seq: ++seq, id: `session-${seq}`, at: Date.now(),
          payloadType: ['Text', 'Advert', 'Trace', 'ACK'][tick % 4], mode: 'route',
          segments: [{ routeId: route.id, fromId: route.fromId, toId: route.toId }] } }));
        tick++;
      }, 100);
    }, state);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const samples = [];
    for (let sample = 0; sample < 6; sample++) {
      await page.waitForTimeout(8_000);
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const dom = await cdp.send('Memory.getDOMCounters');
      samples.push({ sample, dom, heap: metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value,
        ...await page.evaluate(() => ({ resources: (window as any).__sessionResources, timing: (window as any).__sessionTiming,
          performanceEntries: performance.getEntries().length, stage: { ...document.querySelector<HTMLElement>('#map, #netgraph-stage')!.dataset } })) });
    }
    await page.evaluate(() => clearInterval((window as any).__sessionTimer));
    await info.attach(`session-${scene}`, { body: JSON.stringify(samples), contentType: 'application/json' });
    console.log('SESSION', scene, JSON.stringify(samples.map(({ heap, dom, resources, timing }) => ({ heap, dom, resources, timing }))));
    await cdp.detach();
    await page.locator('#find-button').click();
    await expect(page.locator('#node-search')).toBeVisible();
    await page.locator('#node-search').fill('Session 42');
    await expect(page.locator('.node-search-result').first()).toBeVisible();
  });
}

test('long session background tabs close their feed and refresh once on return', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  for (const path of ['/', '/terminal/', '/netgraph/']) {
    let snapshots = 0;
    const countSnapshot = (request: import('@playwright/test').Request) => { if (new URL(request.url()).pathname === '/api/state') snapshots++; };
    page.on('request', countSnapshot);
    await visualFixture(page);
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
    await page.evaluate(() => {
      (window as any).__closedFeeds = 0;
      const close = EventSource.prototype.close;
      EventSource.prototype.close = function () { (window as any).__closedFeeds++; close.call(this); };
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => (window as any).__closedFeeds), { message: `${path} must stop background ingestion` }).toBe(1);
    const before = snapshots;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(300);
    expect(snapshots, 'hidden network changes must not restart snapshot work').toBe(before);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'active');
    await expect.poll(() => snapshots).toBe(before + 1);
    page.off('request', countSnapshot);
  }
});
