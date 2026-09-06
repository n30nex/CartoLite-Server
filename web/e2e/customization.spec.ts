import { expect, test, type Page } from '@playwright/test';
import type { StateV2 } from '../src/types';
import { openMapOptions } from './mapControls';

test('map options are compact, persistent, and preserve live layers through style changes', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixture(page);
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(page.locator('#layers-panel')).toBeHidden();
  await expect(page.locator('#find-button')).toBeVisible();
  await openMapOptions(page);
  await page.locator('#basemap-style').selectOption('light');
  await expect(map).toHaveAttribute('data-basemap-style', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#interface-theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#node-labels-button').click();
  await page.locator('#map-labels-button').click();
  await page.locator('#roads-button').click();
  await page.locator('#route-opacity').press('Home');
  for (let step = 0; step < 6; step++) await page.locator('#route-opacity').press('ArrowRight');
  await page.locator('#terrain-relief').press('Home');
  for (let step = 0; step < 8; step++) await page.locator('#terrain-relief').press('ArrowRight');
  await page.locator('#basemap-style').selectOption('streets');
  await expect(map).toHaveAttribute('data-roads-visible', 'false');
  await expect(map).toHaveAttribute('data-node-labels', 'false');
  await expect(map).toHaveAttribute('data-map-labels', 'false');
  await expect(map).toHaveAttribute('data-route-opacity', '0.5');
  await page.locator('#live-packets-button').click();
  await expect(page.locator('#packet-canvas')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers-summary')).toBeFocused();
  await expect(page.locator('#layers-panel')).toBeHidden();
  await page.reload();
  await expect(map).toHaveAttribute('data-render-state', 'idle');
  await expect(map).toHaveAttribute('data-basemap-style', 'streets');
  await expect(map).toHaveAttribute('data-node-labels', 'false');
  await expect(page.locator('#packet-canvas')).toBeHidden();
  await openMapOptions(page);
  await expect(page.locator('#terrain-relief')).toHaveValue('40');
  const bounds = await page.locator('#layers-panel').boundingBox();
  const size = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
  await page.screenshot({ path: testInfo.outputPath('map-options-streets.png') });
  await page.locator('#reset-appearance').click();
  await expect(map).toHaveAttribute('data-basemap-style', 'dark');
  await expect(map).toHaveAttribute('data-node-labels', 'true');
  await expect(page.locator('#packet-canvas')).toBeVisible();
  await page.locator('#layers-close').click();
  await expect(page.locator('#layers-panel')).toBeHidden();
  expect(errors).toEqual([]);
});

test('Live Follow holds its activity card for ten seconds and pauses when the user takes control', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator('#follow-button').click();
  await emit(page, 1, 'Text');
  await expect(page.locator('#follow-title')).toHaveText('Valley Fixture → Ridge Fixture');
  await expect(page.locator('#follow-detail')).toHaveText('Text · 2 confirmed hops');
  await expect(page.locator('#follow-countdown')).toHaveText('10s');
  await page.clock.fastForward(4000);
  await emit(page, 2, 'Advert');
  await expect(page.locator('#follow-detail')).toHaveText('Text · 2 confirmed hops');
  await expect(page.locator('#follow-countdown')).toHaveText('6s');
  await page.clock.fastForward(5000);
  await expect(page.locator('#follow-detail')).toHaveText('Text · 2 confirmed hops');
  await expect(page.locator('#follow-countdown')).toHaveText('1s');
  await page.clock.fastForward(1000);
  await expect(page.locator('#follow-detail')).toHaveText('Advert · 2 confirmed hops');
  await expect(page.locator('#follow-countdown')).toHaveText('10s');
  await page.clock.runFor(80);
  await page.screenshot({ path: testInfo.outputPath('live-follow-card.png') });
  await page.locator('#follow-pause').click();
  await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'paused');
  await emit(page, 3, 'Trace');
  await page.clock.fastForward(11_000);
  await expect(page.locator('#follow-detail')).toHaveText('Advert · 2 confirmed hops');
  await page.locator('#follow-pause').click();
  await emit(page, 4, 'Trace');
  await expect(page.locator('#follow-detail')).toHaveText('Trace · 2 confirmed hops');
  // Native map gestures need their animation callbacks after the timed assertions.
  await page.clock.resume();
  if (testInfo.project.name === 'desktop') {
    await page.mouse.move(1000, 450);
    await page.mouse.down();
    await page.mouse.move(1100, 460, { steps: 4 });
    await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'paused');
    await page.mouse.up();
  }
  await page.locator('#find-button').click();
  await page.locator('#node-search').fill('Summit');
  await page.locator('.node-search-result').first().click();
  await page.locator('#follow-button').click();
  await emit(page, 5, 'Text');
  await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'following');
  await expect(page.locator('.node-inspector')).toBeHidden();
  // A new neighbour is a feed update, not a manual selection or a pause request.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-packet', { detail: {
    seq: 6, id: 'fixture-new-neighbour', at: Date.now(), mode: 'route', payloadType: 'Advert',
    segments: [{ routeId: 'new-neighbour', fromId: 'summit', toId: 'meadow' }],
  } })));
  await expect(page.locator('#map')).toHaveAttribute('data-neighbor-route-count', '3');
  await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'following');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await page.clock.fastForward(10_000);
  await page.clock.fastForward(10_000);
  await expect(page.locator('#follow-card')).toHaveAttribute('data-state', 'following');
  await expect(page.locator('#follow-title')).toHaveText('Waiting for activity');
  await expect(page.locator('#follow-countdown')).toHaveText('');
  await expect(page.locator('#follow-card')).not.toHaveAttribute('data-packet-at', /.+/);
  await expect(page.locator('#map')).toHaveAttribute('data-follow-feature-count', '0');
  await page.locator('#follow-close').click();
  await expect(page.locator('#follow-card')).toBeHidden();
});

async function fixture(page: Page): Promise<void> {
  const now = Date.now();
  const nodes = [
    { id: 'valley', label: 'Valley Fixture', lng: -80.4, lat: 43.5 },
    { id: 'summit', label: 'Summit Fixture', lng: -80.2, lat: 43.65 },
    { id: 'ridge', label: 'Ridge Fixture', lng: -80.0, lat: 43.55 },
    { id: 'meadow', label: 'Meadow Fixture', lng: -80.3, lat: 43.65 },
  ].map((node) => ({ ...node, role: 'repeater' as const, observer: false, lastSeen: now }));
  const state: StateV2 = {
    schemaVersion: 2, bootId: 'customization-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: [-80.2, 43.6], zoom: 7 }, nodes,
    routes: nodes.slice(1).map((node, index) => ({ id: `hop-${index}`, fromId: nodes[index]!.id, toId: node.id, packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 })),
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.addInitScript(() => {
    class FixtureStream extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      private receive = (event: Event) => this.dispatchEvent(new MessageEvent('packet', { data: JSON.stringify((event as CustomEvent).detail) }));
      constructor() {
        super();
        window.addEventListener('fixture-packet', this.receive);
        setTimeout(() => { this.onopen?.(new Event('open')); document.documentElement.dataset.fixtureStream = 'ready'; }, 0);
      }
      close(): void { this.readyState = 2; window.removeEventListener('fixture-packet', this.receive); }
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureStream });
  });
}

async function emit(page: Page, seq: number, payloadType: string): Promise<void> {
  await page.evaluate(({ seq, payloadType }) => window.dispatchEvent(new CustomEvent('fixture-packet', { detail: {
    seq, id: `fixture-${seq}`, at: Date.now(), mode: 'route', payloadType,
    segments: [{ routeId: 'hop-0', fromId: 'valley', toId: 'summit' }, { routeId: 'hop-1', fromId: 'summit', toId: 'ridge' }],
  } })), { seq, payloadType });
}
