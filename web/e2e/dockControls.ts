import { expect, type Page } from '@playwright/test';

async function settledDock(page: Page): Promise<void> {
  // A resize can finish scene framing before the media-query callback rehomes
  // controls. Inspect one settled layout before choosing a mobile/desktop path.
  await expect.poll(() => page.evaluate(() => {
    const compact = matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    const button = document.getElementById('view-button');
    const navigation = document.querySelector('.dock-views');
    return document.documentElement.dataset.mobileDock === String(compact)
      && Boolean(button?.getClientRects().length) === compact
      && Boolean(navigation?.closest('#view-panel')) === compact;
  })).toBe(true);
}

export async function openViewMenu(page: Page, group: 'Experimental' | 'Labs' | false = 'Experimental'): Promise<void> {
  await settledDock(page);
  if (await page.locator('#view-button').isVisible() && await page.locator('#view-panel').isHidden()) await page.locator('#view-button').click();
  if (group) { const selector = group === 'Labs' ? '#labs-options' : '#experimental-options'; const list = page.locator(selector); if (await list.count() && !await list.isVisible()) await list.locator('..').locator('summary').click(); }
}
export async function viewTool(page: Page, selector: string): Promise<void> {
  await settledDock(page);
  if (!await page.locator(selector).isVisible()) await openViewMenu(page, false);
  await page.locator(selector).click();
}
export async function switchView(page: Page, view: 'map' | 'Netgraph' | 'Labs'): Promise<void> {
  const link = page.getByRole('link', { name: `Open CartoLite ${view === 'Labs' ? 'Packet Pond' : view}`, exact: true });
  if (!await link.isVisible()) await openViewMenu(page, view === 'Labs' ? 'Labs' : 'Experimental');
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
