import type { Page } from '@playwright/test';

export async function openViewMenu(page: Page): Promise<void> {
  if (await page.locator('#view-button').isVisible() && await page.locator('#view-panel').isHidden()) await page.locator('#view-button').click();
}
export async function viewTool(page: Page, selector: string): Promise<void> {
  if (!await page.locator(selector).isVisible()) await openViewMenu(page);
  await page.locator(selector).click();
}
export async function switchView(page: Page, view: 'map' | 'Netgraph' | 'Labs'): Promise<void> {
  const link = page.getByRole('link', { name: `Open CartoLite ${view}`, exact: true });
  if (!await link.isVisible()) await openViewMenu(page);
  await link.click();
}
export async function openDisplay(page: Page): Promise<void> {
  await viewTool(page, '#display-button,#display-shortcut,#labs-display-button');
}
export async function graphFilters(page: Page): Promise<void> {
  if (await page.locator('html').getAttribute('data-mobile-dock') === 'true' && await page.locator('#display-panel').isHidden()) await page.locator('#display-button').click();
}
export async function graphWindow(page: Page, value: string): Promise<void> {
  await graphFilters(page); await page.locator('#route-window').selectOption(value);
  if (await page.locator('html').getAttribute('data-mobile-dock') === 'true') await page.keyboard.press('Escape');
}
export async function graphRoutes(page: Page): Promise<void> {
  await graphFilters(page); await page.locator('#graph-routes-button').click();
  if (await page.locator('html').getAttribute('data-mobile-dock') === 'true') await page.keyboard.press('Escape');
}
export async function graphFocus(page: Page, value: string): Promise<void> {
  await graphFilters(page); await page.getByLabel('Topology focus').selectOption(value);
  if (await page.locator('html').getAttribute('data-mobile-dock') === 'true') await page.keyboard.press('Escape');
}
