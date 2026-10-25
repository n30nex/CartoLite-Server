import { expect, test } from '@playwright/test';
import { visualFixture } from './visualFixtures';
import { openViewMenu } from './dockControls';

for (const path of ['/', '/netgraph/']) test(`operator pages control desktop and phone navigation ${path}`, async ({ page }) => {
  await visualFixture(page);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  // The HTTP/Compose tests exercise the startup setting and direct URL gate.
  // These synthetic documents cover the same marker's dock/picker behaviour.
  let extraPages = '';
  await page.route(url => url.pathname === path, async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace(/data-extra-pages="[^"]*"/, `data-extra-pages="${extraPages}"`);
    await route.fulfill({ response, body });
  });
  for (const extras of ['', 'terminal,firehose', 'pachinko']) {
    extraPages = extras;
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-cinematic', 'true');
    await openViewMenu(page);
    await expect(page.getByRole('link', { name: 'Open CartoLite map', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open CartoLite Netgraph', exact: true })).toBeVisible();
    for (const label of ['Terminal', 'Chronoscope', 'Firehose', 'Pachinko']) {
      const link = page.getByRole('link', { name: `Open CartoLite ${label}`, exact: true });
      if (extras.includes(label.toLowerCase())) await expect(link).toBeVisible();
      else await expect(link).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: /Labs/ })).toHaveCount(0);
  }
  expect(requests.filter(url => /\/assets\/(?:firehose|chronoscope|terminal|pachinko|arcade|scene3d)[^/]*\.js/.test(url))).toEqual([]);
});
