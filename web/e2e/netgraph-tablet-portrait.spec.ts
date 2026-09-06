import { expect, test } from '@playwright/test';
import type { StateV2 } from '../src/types';

test('Netgraph keeps tablet portrait controls spacious and in bounds', async ({ page }) => {
  const now = Date.now();
  const state: StateV2 = {
    schemaVersion: 2,
    bootId: 'tablet-netgraph',
    seq: 0,
    serverTime: now,
    status: { feed: 'connected', activity: 'quiet', dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [-79, 44], zoom: 5 },
    nodes: [
      { id: 'a', label: 'Alpha', lat: 44, lng: -80, role: 'repeater', observer: false, lastSeen: now },
      { id: 'b', label: 'Bravo', lat: 45, lng: -79, role: 'companion', observer: false, lastSeen: now },
    ],
    routes: [{ id: 'a-b', fromId: 'a', toId: 'b', packetCount: 1, lastHeard: now, intensity: 0, lastKind: 'Advert', traffic: 1 }],
  };
  await page.route('**/api/state', (route) => route.fulfill({ json: state }));
  await page.route('**/api/events**', (route) => route.fulfill({
    contentType: 'text/event-stream',
    body: `event: hello\ndata: ${JSON.stringify({ seq: 0, bootId: state.bootId })}\n\n`,
  }));
  await page.goto('/netgraph/');
  await expect(page.locator('#netgraph-app')).toHaveAttribute('data-loading', 'false');
  const controls = await page.locator('#topbar, .controls, .control-button:visible, #route-window').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { id: element.id || element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  for (const control of controls) {
    expect(control.left, `${control.id} left`).toBeGreaterThanOrEqual(-0.5);
    expect(control.right, `${control.id} right`).toBeLessThanOrEqual(800.5);
    expect(control.top, `${control.id} top`).toBeGreaterThanOrEqual(-0.5);
    expect(control.bottom, `${control.id} bottom`).toBeLessThanOrEqual(1280.5);
    if (String(control.id).includes('control-button')) expect(control.height).toBeGreaterThanOrEqual(44);
  }
  const topbar = controls.find((control) => control.id === 'topbar')!;
  const toolbar = controls.find((control) => control.id === 'controls glass')!;
  expect(toolbar.top).toBeGreaterThanOrEqual(topbar.bottom + 7);
});
