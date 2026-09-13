import type { Page } from '@playwright/test';

export async function openMapOptions(page: Page): Promise<void> {
  const summary = page.locator('#layers-summary');
  if (await summary.count() && await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
  // Interaction tests need the complete options; the layer UX test checks the collapsed default.
  for (const id of ['terrain-options', 'map-appearance']) {
    const group = page.locator('#' + id);
    if (await group.count() && await group.getAttribute('open') === null) await group.locator('summary').first().click();
  }
}
