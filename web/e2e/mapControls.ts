import type { Page } from '@playwright/test';

export async function openMapOptions(page: Page): Promise<void> {
  const summary = page.locator('#layers-summary');
  if (await summary.count() && await summary.getAttribute('aria-expanded') !== 'true') await summary.click();
}
