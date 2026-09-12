import { expect, test } from '@playwright/test';
import { visualCenter, visualFixture } from './visualFixtures';
import { openMapOptions } from './mapControls';
import type { NodeV2, RouteV2, StateV2 } from '../src/types';

test.use({ trace: 'off', screenshot: 'off' });

test('keeps close 3D inspection responsive with 7000 retained routes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop terrain scale gate');
  await visualFixture(page, 15);
  const now = Date.now();
  const nodes: NodeV2[] = Array.from({ length: 4000 }, (_, i) => ({
    id: `far-${i}`, label: `Remote ${i}`, role: 'repeater', observer: false,
    lng: -123 + (i % 40) / 1000, lat: 49 + Math.floor(i / 40) / 1000, lastSeen: now,
  }));
  nodes.push(
    { id: 'local-a', label: 'Local Alpha', role: 'repeater', observer: false, lng: visualCenter[0], lat: visualCenter[1], lastSeen: now },
    { id: 'local-b', label: 'Local Bravo', role: 'repeater', observer: false, lng: visualCenter[0] + 0.003, lat: visualCenter[1] + 0.003, lastSeen: now },
  );
  const routes: RouteV2[] = Array.from({ length: 6999 }, (_, i) => ({
    id: `far-route-${i}`, fromId: `far-${i % 4000}`, toId: `far-${(i + 1 + Math.floor(i / 4000)) % 4000}`,
    packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Advert', traffic: 1,
  }));
  routes.push({ id: 'local-route', fromId: 'local-a', toId: 'local-b', packetCount: 1, lastHeard: now, intensity: 1, lastKind: 'Text', traffic: 1 });
  const state: StateV2 = { schemaVersion: 2, bootId: 'terrain-scale', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: visualCenter, zoom: 15 }, nodes, routes };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.goto('/');
  const map = page.locator('#map');
  await expect(map).toHaveAttribute('data-exact-routes-ready', 'true', { timeout: 10000 });
  await openMapOptions(page);
  await page.locator('#terrain-button').click();
  await expect(map).toHaveAttribute('data-camera-moving', 'false');
  await expect(map).toHaveAttribute('data-buildings-loaded', 'true', { timeout: 10000 });
  await expect.poll(() => map.getAttribute('data-route-terrain-samples').then(Number)).toBeGreaterThan(0);
  expect(Number(await map.getAttribute('data-route-terrain-samples')), 'distant routes must not request terrain projection').toBeLessThan(100);
  expect(Number(await map.getAttribute('data-route-mesh-upload-ms')), 'close terrain mesh work must stay within 100 ms').toBeLessThan(100);
  await expect(map).toHaveAttribute('data-eligible-routes', '7000');
  await expect(page.locator('#map-notice')).toBeHidden();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: info.outputPath('terrain-scale-close.png') });
});
