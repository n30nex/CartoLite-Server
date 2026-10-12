import { expect, test, type Page } from '@playwright/test';
import { visualFixture, visualPacket } from './visualFixtures';
import type { StateV2 } from '../src/types';

async function fixture(page: Page, dateLine = false): Promise<StateV2> {
  await visualFixture(page);
  const now = Date.now();
  const nodes = [
    { id: 'visual-a', label: 'Visual Alpha', lat: 43.65, lng: -79.4, role: 'repeater' as const },
    { id: 'visual-b', label: 'Visual Bravo', lat: 43.25, lng: -79.88, role: 'repeater' as const },
    { id: 'visual-c', label: 'Visual Charlie', lat: 45.51, lng: -73.57, role: 'companion' as const },
    { id: 'visual-d', label: 'Visual Delta', lat: 49.16, lng: -123.93, role: 'room_server' as const },
  ].map(node => ({ ...node, observer: node.id === 'visual-b', lastSeen: now }));
  if (dateLine) for (const [index, node] of nodes.entries()) { node.lat = 0; node.lng = index % 2 ? -179.9 : 179.9; }
  const state: StateV2 = { schemaVersion: 2, bootId: 'graph-3d-fixture', seq: 0, serverTime: now,
    status: { feed: 'connected', activity: 'active', dropped: 0, version: 'test', gitSha: 'synthetic' },
    map: { center: [-79.4, 43.65], zoom: 7 }, nodes,
    routes: [['visual-hop', 'visual-a', 'visual-b'], ['hop-bc', 'visual-b', 'visual-c'], ['hop-cd', 'visual-c', 'visual-d']].map(([id, fromId, toId]) =>
      ({ id: id!, fromId: fromId!, toId: toId!, packetCount: 12, lastHeard: now, intensity: 2, lastKind: 'Text', traffic: 12 })),
  };
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  return state;
}

async function selectAlpha(page: Page) {
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Alpha');
  await page.locator('.node-search-result').first().click();
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-selected-node-id', 'visual-a');
}

test('3D starts top-down, frames neighbours, inspects the drawn curve and preserves styles @regions', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage'), inspector = page.locator('#node-inspector-sheet');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await expect(stage).toHaveAttribute('data-view-mode', 'top-down');
  await page.screenshot({ path: info.outputPath('netgraph-top-down.png') });
  const before = await page.locator('#graph-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.locator('#graph-3d-button').click();
  await expect(stage).toHaveAttribute('data-view-mode', '3d');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  expect(await page.locator('#graph-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(before);
  await page.screenshot({ path: info.outputPath('netgraph-3d-overview.png') });
  await selectAlpha(page);
  await expect(inspector).toContainText('heard within 15 min');
  await expect(inspector).toContainText('Visual Bravo');
  const point = (await stage.getAttribute('data-selected-node-screen'))!.split(',').map(Number);
  const card = (await inspector.boundingBox())!;
  expect(point[0]).toBeGreaterThan(10); expect(point[1]).toBeGreaterThan(70);
  expect(point[0]! < card.x || point[1]! < card.y).toBe(true);
  await page.getByRole('button', { name: 'Inspect connection to Visual Bravo', exact: true }).click();
  await expect(inspector).toContainText('Confirmed connection');
  await expect(inspector).toContainText('12 total observations');
  await expect(inspector).toContainText('Endpoint distance');
  await expect(stage).toHaveAttribute('data-selected-route-id', 'visual-hop');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  const center = await stage.getAttribute('data-view-center');
  const scenes = info.project.name === 'desktop' ? ['dark', 'light', 'streets'] : ['light'];
  const presets = info.project.name === 'desktop' ? ['crisp', 'neon', 'dashed', 'dotted', 'ribbon', 'comet'] : ['crisp'];
  for (const scene of scenes) {
    await page.locator('#display-button').click(); await page.getByLabel('Scene style', { exact: true }).selectOption(scene);
    for (const preset of presets) {
      await page.getByLabel('Route style', { exact: true }).selectOption(preset);
      await expect(stage).toHaveAttribute('data-route-preset', preset);
      await expect(stage).toHaveAttribute('data-view-mode', '3d');
      await expect(stage).toHaveAttribute('data-view-center', center!);
      await expect(stage).toHaveAttribute('data-visible-routes', '3');
    }
    await page.keyboard.press('Escape');
    await page.screenshot({ path: info.outputPath(`netgraph-3d-${scene}.png`) });
  }
  const midpoint = (await stage.getAttribute('data-selected-route-screen'))!.split(',').map(Number);
  if (info.project.name === 'mobile') {
    expect((await page.locator('.controls').boundingBox())!.height).toBeLessThanOrEqual(100);
    expect(midpoint[1]).toBeLessThan((await inspector.boundingBox())!.y - 8);
  }
  await page.getByRole('button', { name: 'Close connection details' }).click();
  await expect(inspector).toBeHidden(); await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await stage.click({ position: { x: midpoint[0]!, y: midpoint[1]! } });
  const choice = inspector.locator('button[data-route-id="visual-hop"]');
  if (await choice.isVisible()) await choice.click();
  await expect(stage).toHaveAttribute('data-selected-route-id', 'visual-hop');
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Close connection details' }).click();
  await page.locator('#graph-routes-button').click();
  await expect(stage).toHaveAttribute('data-history-routes', 'false');
  await stage.click({ position: { x: midpoint[0]!, y: midpoint[1]! } });
  await expect(stage).toHaveAttribute('data-selected-route-id', '');
  // Nearby node markers remain inspectable when historical lines are hidden.
  if (await inspector.isVisible()) await expect(inspector).toHaveAttribute('aria-label', 'Selected node details');
  await page.locator('#graph-routes-button').click();
  await page.locator('#display-button').click();
  await page.getByRole('button', { name: 'Rotate topology right' }).click();
  await expect.poll(() => stage.getAttribute('data-view-yaw').then(Number)).toBeGreaterThan(0.2);
  await page.getByRole('button', { name: 'Top-down', exact: true }).click();
  await expect(stage).toHaveAttribute('data-view-mode', 'top-down');
  await page.keyboard.press('Escape');
  await page.locator('#graph-3d-button').click(); await page.reload();
  await expect(stage).toHaveAttribute('data-view-mode', 'top-down');
});

test('3D camera gestures keep selection and packets/audio on the shared live clock', async ({ page, context }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/netgraph/'); const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#graph-3d-button').click(); await selectAlpha(page);
  // Close the sheet without changing the camera before exercising native gestures.
  await page.getByRole('button', { name: 'Close node details' }).click();
  const { width, height } = page.viewportSize()!;
  const x = width * 0.4, y = Math.max(160, Math.min(height * 0.4, height - 150));
  const session = await context.newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Array<{ id: number; x: number; y: number }>) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  };
  const zoom = Number(await stage.getAttribute('data-view-scale'));
  await touch('touchStart', [{ id: 1, x: x - 25, y }, { id: 2, x: x + 25, y }]);
  await touch('touchMove', [{ id: 1, x: x - 40, y: y - 20 }, { id: 2, x: x + 40, y: y + 20 }]);
  expect(Number(await stage.getAttribute('data-view-scale'))).toBeGreaterThan(zoom);
  expect(Math.abs(Number(await stage.getAttribute('data-view-yaw')))).toBeGreaterThan(0.2);
  await touch('touchCancel', []); await expect(stage).not.toHaveClass(/is-dragging/); await session.detach();
  await selectAlpha(page);
  await page.locator('#display-button').click(); await page.getByLabel('Motion preference').selectOption('full');
  await page.keyboard.press('Escape');
  await page.locator('#sound-button').click(); await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-state')).toHaveText('On'); await page.keyboard.press('Escape');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-stream', 'ready');
  await visualPacket(page, 1, 'Text');
  await expect(page.locator('#sound-activity')).toHaveAttribute('data-scheduled', '1');
  await expect(stage).toHaveAttribute('data-last-packet-hops', '1');
  await expect(stage).toHaveAttribute('data-active-packets', '1');
  await page.screenshot({ path: info.outputPath('netgraph-3d-live-packet.png') });
  await page.locator('#graph-3d-button').click();
  await expect.poll(() => stage.getAttribute('data-view-tilt').then(Number)).toBe(0);
  await visualPacket(page, 2, 'Text');
  await expect(page.locator('#sound-activity')).toHaveAttribute('data-scheduled', '2');
  await expect(stage).toHaveAttribute('data-last-packet-hops', '1');
});


test('3D frames worldwide date-line neighbours without a false long-distance connection', async ({ page }, info) => {
  await fixture(page, true); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage');
  await expect(stage).toHaveAttribute('data-render-state', 'idle');
  await page.locator('#graph-3d-button').click(); await selectAlpha(page);
  await page.getByRole('button', { name: 'Inspect connection to Visual Bravo', exact: true }).click();
  await expect(page.locator('#node-inspector-sheet')).toContainText('22 km approx.');
  await page.locator('#display-button').click();
  await page.getByRole('button', { name: 'Rotate topology right' }).click();
  await page.keyboard.press('Escape');
  const point = (await stage.getAttribute('data-selected-route-screen'))!.split(',').map(Number);
  expect(point.every(Number.isFinite)).toBe(true);
  expect(point[0]).toBeGreaterThan(0); expect(point[0]).toBeLessThan(page.viewportSize()!.width);
  expect(point[1]).toBeGreaterThan(0); expect(point[1]).toBeLessThan(page.viewportSize()!.height);
  await expect(stage).toHaveAttribute('data-visible-routes', '3');
  await page.screenshot({ path: info.outputPath('netgraph-3d-date-line.png') });
});


test('explicit selection reveals a quiet node outside an active area focus', async ({ page }) => {
  const state = await fixture(page);
  state.routes[2]!.lastHeard -= 2 * 60 * 60_000;
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/netgraph/');
  const stage = page.locator('#netgraph-stage'), focus = page.getByLabel('Topology focus');
  await page.locator('#graph-3d-button').click(); await selectAlpha(page);
  await focus.selectOption('area');
  await page.getByRole('button', { name: 'Close node details' }).click();
  await focus.selectOption('component');
  await expect(focus).toHaveValue('area');
  await page.locator('#find-button').click(); await page.locator('#node-search').fill('Visual Delta');
  await page.locator('.node-search-result').first().click();
  await expect(stage).toHaveAttribute('data-selected-node-id', 'visual-d');
  await expect(stage).toHaveAttribute('data-focus-mode', 'all');
  await expect(focus).toHaveValue('all');
  await expect(page.locator('#node-inspector-sheet')).toContainText('No neighbours');
});


test('graph controls wait for the initial snapshot before accepting interaction', async ({ page }) => {
  const state = await fixture(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/state', async route => { await pending; await route.fulfill({ json: state }); });
  await page.goto('/netgraph/');
  await expect(page.locator('#find-button')).toBeDisabled();
  await expect(page.locator('#graph-3d-button')).toBeDisabled();
  release();
  await expect(page.locator('#graph-3d-button')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#graph-3d-button').click(); await selectAlpha(page);
  await expect(page.locator('#netgraph-stage')).toHaveAttribute('data-view-mode', '3d');
});
